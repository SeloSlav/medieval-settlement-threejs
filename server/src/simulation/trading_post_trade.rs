//! Trading Post rules: local carts stage exports continuously, while the
//! regional leg settles on a short balance-authoritative abstract cadence.

use spacetimedb::{Identity, ReducerContext};

use crate::balance_generated::{
    marketplace_trade_offer_for_resource, MarketplaceTradeKind, BUILDING_ROAD_ACCESS_DISTANCE,
    STOREHOUSE_HAUL_PER_WORKER, TIMBER_DELIVERY_SPEED_MPS, TIMBER_DELIVERY_UNLOAD_SEC,
};
use crate::db::*;
use crate::economy::{
    assign_building_labor, available_unreserved_building_ironwork,
    available_unreserved_building_roof_tiles, available_unreserved_building_stone,
    available_unreserved_building_timber, building_commodity_room, building_commodity_stock,
    credit_treasury_gold_for_settlement, deposit_building_commodity, ensure_market_state,
    price_multiplier_for, record_market_trade, spend_treasury_gold, trade_resource_for_commodity,
    treasury_gold, withdraw_building_commodity, CommodityKind, MarketTradeDirection,
};
use crate::granary_policy::granary_exportable_grain;
use crate::resource_units::{whole_cost, whole_signed_units, whole_units};
use crate::simulation::delivery_trips::{
    building_has_active_trip, building_has_inbound_commodity_trip, onsite_building_labor,
    try_start_building_supply_trip,
};
use crate::simulation::{labor_and_logistics_paused, GameClock, SimTickContext};
use crate::tables::{Building, TradingPostTradeRule};
use crate::trading_post_policy::{
    affordable_import_units, exportable_surplus, import_deficit, import_rule_rotation_offset,
    import_target_fulfillment, regional_exchange_sequence, trade_rule_settlement_key,
    TRADE_MODE_EXPORT, TRADE_MODE_IMPORT,
};

pub fn trading_post_exports_commodity(
    ctx: &ReducerContext,
    building_id: u64,
    commodity: CommodityKind,
) -> bool {
    let id = format!("{}:{}", building_id, commodity.as_u8());
    ctx.db
        .trading_post_trade_rule()
        .id()
        .find(&id)
        .is_some_and(|rule| rule.mode == TRADE_MODE_EXPORT)
}

pub fn step_trading_post_trade(ctx: &ReducerContext, tick: &SimTickContext, clock: &GameClock) {
    let mut post_ids: Vec<u64> = ctx
        .db
        .building()
        .iter()
        .filter(|building| building.kind == "trading_post")
        .map(|building| building.id)
        .collect();
    post_ids.sort_unstable();
    let current_exchange = regional_exchange_sequence(clock.sim_tick);

    for post_id in post_ids {
        let Some(mut post) = ctx.db.building().id().find(&post_id) else {
            continue;
        };
        // Older saves could retain the former five-worker broker roster.
        // Release surplus workers once, preserving any in-transit cart crew.
        if post.assigned_labor > 2 && assign_building_labor(ctx, post.owner, post.id, 2).is_ok() {
            post.assigned_labor = 2;
        }
        if !trading_post_operational(ctx, tick, clock, &post) {
            continue;
        }
        settle_due_rules(ctx, &post, current_exchange);
        if clock.sim_tick % 5 == post.id % 5 {
            stage_one_export(ctx, tick, clock, &post);
        }
    }
}

fn trading_post_operational(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    post: &Building,
) -> bool {
    if !post.construction_complete
        || onsite_building_labor(ctx, post) == 0
        || tick.building_disabled_by_fire(ctx, post.id)
        || labor_and_logistics_paused(ctx, tick, post.owner, clock)
    {
        return false;
    }
    tick.road_network(post.owner).is_some_and(|network| {
        network.nearest_distance(post.x, post.z) <= BUILDING_ROAD_ACCESS_DISTANCE
    })
}

fn settle_due_rules(ctx: &ReducerContext, post: &Building, current_exchange: u64) {
    let mut rules: Vec<TradingPostTradeRule> = ctx
        .db
        .trading_post_trade_rule()
        .building_id()
        .filter(&post.id)
        .filter(|rule| rule.last_settled_month < current_exchange)
        .collect();
    rules.sort_by_key(|rule| trade_rule_settlement_key(rule.mode, rule.commodity_kind));
    let mut import_count = 0;
    if let Some(import_start) = rules.iter().position(|rule| rule.mode == TRADE_MODE_IMPORT) {
        import_count = rules[import_start..]
            .iter()
            .take_while(|rule| rule.mode == TRADE_MODE_IMPORT)
            .count();
        let import_end = import_start + import_count;
        let rotation = import_rule_rotation_offset(current_exchange, import_count);
        let imports = &mut rules[import_start..import_end];
        imports.rotate_left(rotation);
        // `sort_by` is stable, so the exchange rotation remains the exact
        // deterministic tie-break among equally fulfilled targets.
        imports.sort_by(|left, right| {
            import_rule_fulfillment(ctx, post.owner, left)
                .total_cmp(&import_rule_fulfillment(ctx, post.owner, right))
        });
    }
    let mut remaining_imports = import_count;
    for mut rule in rules {
        let import_gold_budget = if rule.mode == TRADE_MODE_IMPORT {
            let budget =
                fair_whole_import_gold_budget(treasury_gold(ctx, post.owner), remaining_imports);
            remaining_imports = remaining_imports.saturating_sub(1);
            budget
        } else {
            0.0
        };
        let Some(commodity) = CommodityKind::from_u8(rule.commodity_kind) else {
            rule.last_settled_month = current_exchange;
            ctx.db.trading_post_trade_rule().id().update(rule);
            continue;
        };
        let (amount, gold) = match rule.mode {
            TRADE_MODE_EXPORT => settle_export(ctx, post.id, post.owner, commodity),
            TRADE_MODE_IMPORT => settle_import(
                ctx,
                post.id,
                post.owner,
                commodity,
                rule.target_surplus,
                import_gold_budget,
            ),
            _ => (0.0, 0.0),
        };
        rule.last_settled_month = current_exchange;
        rule.last_trade_amount = whole_units(amount);
        rule.last_trade_gold = whole_signed_units(gold);
        ctx.db.trading_post_trade_rule().id().update(rule);
    }
}

fn fair_whole_import_gold_budget(remaining_gold: f64, remaining_rules: usize) -> f64 {
    if remaining_rules == 0 {
        return 0.0;
    }
    (whole_units(remaining_gold) / remaining_rules as f64).floor()
}

fn import_rule_fulfillment(
    ctx: &ReducerContext,
    owner: Identity,
    rule: &TradingPostTradeRule,
) -> f64 {
    let Some(commodity) = CommodityKind::from_u8(rule.commodity_kind) else {
        return 1.0;
    };
    import_target_fulfillment(
        owner_public_stock(ctx, owner, commodity),
        rule.target_surplus,
    )
}

fn settle_export(
    ctx: &ReducerContext,
    post_id: u64,
    owner: Identity,
    commodity: CommodityKind,
) -> (f64, f64) {
    let Some(resource) = trade_resource_for_commodity(commodity) else {
        return (0.0, 0.0);
    };
    let Some(offer) = marketplace_trade_offer_for_resource(resource, false) else {
        return (0.0, 0.0);
    };
    let MarketplaceTradeKind::GoldSell {
        amount: lot_amount,
        gold_yield,
        ..
    } = offer.kind
    else {
        return (0.0, 0.0);
    };
    let Some(mut post) = ctx.db.building().id().find(&post_id) else {
        return (0.0, 0.0);
    };
    let units = whole_units(building_commodity_stock(&post, commodity));
    if units <= 1e-6 || lot_amount <= 1e-9 {
        return (0.0, 0.0);
    }
    let multiplier = current_price_multiplier(ctx, owner, resource);
    let unit_price = gold_yield / lot_amount * multiplier;
    let planned_revenue = whole_units(units * unit_price);
    if planned_revenue < 1.0 {
        return (0.0, 0.0);
    }
    let sold = withdraw_building_commodity(&mut post, commodity, units);
    if sold <= 1e-6 {
        return (0.0, 0.0);
    }
    let revenue = whole_units(sold * unit_price);
    let settlement_id = post.settlement_id;
    ctx.db.building().id().update(post);
    credit_treasury_gold_for_settlement(ctx, owner, settlement_id, revenue);
    let duty = whole_cost(
        revenue
            * crate::fiscal_policy::clamp_export_duty_rate(
                crate::settlement_policy::export_duty_rate(ctx, owner, settlement_id),
            ),
    )
    .min(revenue);
    record_customs_receipt(ctx, owner, settlement_id, 0.0, duty);
    record_market_trade(ctx, owner, resource, MarketTradeDirection::Export, sold);
    (sold, revenue)
}

fn settle_import(
    ctx: &ReducerContext,
    post_id: u64,
    owner: Identity,
    commodity: CommodityKind,
    target_surplus: f64,
    gold_budget: f64,
) -> (f64, f64) {
    let Some(resource) = trade_resource_for_commodity(commodity) else {
        return (0.0, 0.0);
    };
    let Some(offer) = marketplace_trade_offer_for_resource(resource, true) else {
        return (0.0, 0.0);
    };
    let MarketplaceTradeKind::GoldBuy {
        amount: lot_amount,
        gold_cost,
        ..
    } = offer.kind
    else {
        return (0.0, 0.0);
    };
    let Some(mut post) = ctx.db.building().id().find(&post_id) else {
        return (0.0, 0.0);
    };
    let settlement_id = post.settlement_id;
    if lot_amount <= 1e-9 {
        return (0.0, 0.0);
    }
    let public_stock = owner_public_stock(ctx, owner, commodity);
    let deficit = import_deficit(public_stock, target_surplus);
    let multiplier = current_price_multiplier(ctx, owner, resource);
    let unit_price = gold_cost / lot_amount * multiplier;
    let available_gold = whole_units(treasury_gold(ctx, owner).min(gold_budget.max(0.0)));
    let units = whole_units(affordable_import_units(
        deficit,
        building_commodity_room(&post, commodity),
        available_gold,
        unit_price,
    ));
    if units <= 1e-6 {
        return (0.0, 0.0);
    }
    let expense = whole_cost(units * unit_price);
    if expense <= 1e-9 || expense > available_gold + 1e-6 {
        return (0.0, 0.0);
    }
    if spend_treasury_gold(ctx, owner, expense).is_err() {
        return (0.0, 0.0);
    }
    let imported = deposit_building_commodity(&mut post, commodity, units);
    if imported <= 1e-6 {
        credit_treasury_gold_for_settlement(ctx, owner, settlement_id, expense);
        return (0.0, 0.0);
    }
    let actual_expense = whole_cost(imported * unit_price);
    if actual_expense + 1e-6 < expense {
        credit_treasury_gold_for_settlement(
            ctx,
            owner,
            settlement_id,
            expense - actual_expense,
        );
    }
    ctx.db.building().id().update(post);
    record_market_trade(ctx, owner, resource, MarketTradeDirection::Import, imported);
    let duty = whole_cost(
        actual_expense
            * crate::fiscal_policy::clamp_import_duty_rate(
                crate::settlement_policy::import_duty_rate(ctx, owner, settlement_id),
            ),
    );
    record_customs_receipt(ctx, owner, settlement_id, duty, 0.0);
    (imported, -actual_expense)
}

/// Customs on public Trading Post orders are a classification within the one
/// realm treasury, not a second town wallet. The local and realm ledgers both
/// record the same coins; no additional gold is created or destroyed.
fn record_customs_receipt(
    ctx: &ReducerContext,
    owner: Identity,
    settlement_id: u64,
    import_duty: f64,
    export_duty: f64,
) {
    let import_duty = whole_units(import_duty);
    let export_duty = whole_units(export_duty);
    if import_duty < 1.0 && export_duty < 1.0 {
        return;
    }
    if let Some(mut resources) = ctx.db.player_resources().owner().find(&owner) {
        resources.import_duty_collected_total =
            whole_units(resources.import_duty_collected_total) + import_duty;
        resources.export_duty_collected_total =
            whole_units(resources.export_duty_collected_total) + export_duty;
        ctx.db.player_resources().owner().update(resources);
    }
    if let Some(mut settlement) = ctx.db.settlement().id().find(&settlement_id) {
        if settlement.owner == owner {
            settlement.import_duty_collected_total =
                whole_units(settlement.import_duty_collected_total) + import_duty;
            settlement.export_duty_collected_total =
                whole_units(settlement.export_duty_collected_total) + export_duty;
            ctx.db.settlement().id().update(settlement);
        }
    }
}

fn current_price_multiplier(
    ctx: &ReducerContext,
    owner: Identity,
    resource: crate::balance_generated::TradeResource,
) -> f64 {
    ensure_market_state(ctx, owner);
    ctx.db
        .market_state()
        .owner()
        .find(&owner)
        .map(|state| price_multiplier_for(&state, resource))
        .unwrap_or(1.0)
}

fn stage_one_export(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    post: &Building,
) -> bool {
    if building_has_active_trip(ctx, post.id) {
        return false;
    }
    let Some(network) = tick.road_network(post.owner) else {
        return false;
    };
    let workers = onsite_building_labor(ctx, post).min(2);
    if workers == 0 {
        return false;
    }
    let mut rules: Vec<TradingPostTradeRule> = ctx
        .db
        .trading_post_trade_rule()
        .building_id()
        .filter(&post.id)
        .filter(|rule| rule.mode == TRADE_MODE_EXPORT)
        .collect();
    rules.sort_by_key(|rule| rule.commodity_kind);
    if rules.is_empty() {
        return false;
    }
    let start = (clock.sim_tick as usize / 5) % rules.len();
    for offset in 0..rules.len() {
        let rule = &rules[(start + offset) % rules.len()];
        let Some(commodity) = CommodityKind::from_u8(rule.commodity_kind) else {
            continue;
        };
        if building_commodity_room(post, commodity) <= 1e-6
            || building_has_inbound_commodity_trip(ctx, post.id, commodity)
        {
            continue;
        }
        let available = protected_outside_stock(ctx, post.owner, commodity);
        let needed = exportable_surplus(available, rule.target_surplus)
            .min(building_commodity_room(post, commodity));
        if needed <= 1e-6 {
            continue;
        }
        let mut candidates: Vec<(Building, f64)> = ctx
            .db
            .building()
            .owner()
            .filter(&post.owner)
            .filter(|source| {
                source.id != post.id
                    && source.kind != "trading_post"
                    && source.construction_complete
                    && !tick.building_disabled_by_fire(ctx, source.id)
                    && !building_has_active_trip(ctx, source.id)
                    && source_exportable_stock(source, commodity) > 1e-6
            })
            .filter_map(|source| {
                let distance = crate::simulation::local_delivery_distance(
                    network, source.x, source.z, post.x, post.z,
                )?;
                Some((source, distance))
            })
            .collect();
        candidates.sort_by(|left, right| {
            left.1
                .total_cmp(&right.1)
                .then_with(|| left.0.id.cmp(&right.0.id))
        });
        for (mut source, _) in candidates {
            let source_available = source_exportable_stock(&source, commodity).min(needed);
            if try_start_building_supply_trip(
                ctx,
                tick,
                clock,
                network,
                &mut source,
                post,
                workers,
                commodity,
                TIMBER_DELIVERY_SPEED_MPS,
                TIMBER_DELIVERY_UNLOAD_SEC,
                STOREHOUSE_HAUL_PER_WORKER,
                source_available,
            ) {
                ctx.db.building().id().update(source);
                return true;
            }
        }
    }
    false
}

fn owner_public_stock(ctx: &ReducerContext, owner: Identity, commodity: CommodityKind) -> f64 {
    ctx.db
        .building()
        .owner()
        .filter(&owner)
        .filter(|building| building.construction_complete)
        .map(|building| building_commodity_stock(&building, commodity).max(0.0))
        .sum()
}

fn protected_outside_stock(ctx: &ReducerContext, owner: Identity, commodity: CommodityKind) -> f64 {
    let all_raw: f64 = ctx
        .db
        .building()
        .owner()
        .filter(&owner)
        .filter(|building| building.construction_complete)
        .map(|building| building_commodity_stock(&building, commodity).max(0.0))
        .sum();
    let outside: f64 = ctx
        .db
        .building()
        .owner()
        .filter(&owner)
        .filter(|building| building.construction_complete && building.kind != "trading_post")
        .map(|building| source_exportable_stock(&building, commodity))
        .sum();
    let available_all = match commodity {
        CommodityKind::Timber => available_unreserved_building_timber(ctx, owner),
        CommodityKind::Stone => available_unreserved_building_stone(ctx, owner),
        CommodityKind::Ironwork => available_unreserved_building_ironwork(ctx, owner),
        CommodityKind::RoofTiles => available_unreserved_building_roof_tiles(ctx, owner),
        _ => all_raw,
    };
    let reserved = (all_raw - available_all).max(0.0);
    (outside - reserved).max(0.0)
}

fn source_exportable_stock(building: &Building, commodity: CommodityKind) -> f64 {
    let stock = building_commodity_stock(building, commodity).max(0.0);
    match commodity {
        CommodityKind::RyeGrain | CommodityKind::OatGrain | CommodityKind::MaslinGrain
            if building.kind == "granary" =>
        {
            let total = building.rye_grain.max(0.0)
                + building.oat_grain.max(0.0)
                + building.maslin_grain.max(0.0);
            let protected = (building.granary_grain_reserve.max(0.0) - (total - stock)).max(0.0);
            granary_exportable_grain(stock, protected)
        }
        _ => stock,
    }
}

#[cfg(test)]
mod tests {
    use super::fair_whole_import_gold_budget;

    #[test]
    fn recurring_import_budgets_apportion_only_whole_coins() {
        assert_eq!(fair_whole_import_gold_budget(10.9, 3), 3.0);
        assert_eq!(fair_whole_import_gold_budget(2.0, 3), 0.0);
        assert_eq!(fair_whole_import_gold_budget(2.0, 1), 2.0);
        assert_eq!(fair_whole_import_gold_budget(10.0, 0), 0.0);
    }
}
