use spacetimedb::ReducerContext;

use super::marketplace_orders::{order_food_commodity, order_water_commodity, MarketGoldPayer};
use super::marketplace_trade_policy::{
    manual_trade_cooldown_seconds, manual_trade_ready, trade_receive, trade_spend, TradeReceive,
    TradeSpend,
};
use super::regional_market::{
    ensure_market_state, price_multiplier_for, record_market_trade, scaled_gold_cost,
    scaled_gold_yield,
};
use super::regional_market_policy::MarketTradeDirection;
use super::storage::{
    available_unreserved_building_stone, available_unreserved_building_timber,
    available_unreserved_treasury_stone, available_unreserved_treasury_timber,
};
use crate::balance_generated::TradeResource;
use crate::balance_generated::{
    market_commodity_offer, market_water_commodity_offer, marketplace_trade_offer,
    MarketplaceTradeKind, MarketplaceTradeOffer, TIMBER_DELIVERY_SPEED_MPS,
    TIMBER_DELIVERY_UNLOAD_SEC,
};
use crate::constants::BUILDING_ROAD_ACCESS_DISTANCE;
use crate::db::*;
use crate::economy::{
    building_commodity_room, credit_treasury_gold, deposit_building_commodity, spend_treasury_gold,
    CommodityKind,
};
use crate::granary_policy::granary_exportable_grain;
use crate::marketplace_procurement_policy::{
    next_standing_marketplace_import, StandingMarketplaceImport, MARKETPLACE_IRONWORK_IMPORT_LOT,
    MARKETPLACE_IRON_IMPORT_LOT, MARKETPLACE_SALT_IMPORT_LOT, MARKETPLACE_SEED_GRAIN_IMPORT_LOT,
};
use crate::roads::RoadNetwork;
use crate::season_policy::environment_for;
use crate::simulation::{
    building_has_active_trip, building_has_inbound_commodity_trip, game_clock,
    labor_and_logistics_paused, try_start_building_supply_trip, GameClock, MarketCaravanDispatch,
    SimTickContext,
};
use crate::tables::Building;

pub fn execute_marketplace_trade(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    building_id: u64,
    trade_id: &str,
) -> Result<(), String> {
    let tick = SimTickContext::new(ctx);
    let marketplace = validate_marketplace(ctx, &tick, owner, building_id)?;

    let outcome = if let Some(commodity) = market_commodity_offer(trade_id) {
        execute_food_commodity_trade(ctx, &tick, owner, building_id, commodity)?;
        MarketplaceTradeOutcome::Settled
    } else if let Some(commodity) = market_water_commodity_offer(trade_id) {
        execute_water_commodity_trade(ctx, &tick, owner, building_id, commodity)?;
        MarketplaceTradeOutcome::Settled
    } else {
        let offer = marketplace_trade_offer(trade_id)
            .ok_or_else(|| format!("Unknown trade offer: {trade_id}"))?;
        if offer.id == "buy_ironwork"
            && !ctx
                .db
                .world_config()
                .id()
                .find(&0)
                .is_some_and(|config| config.conflict_enabled)
        {
            return Err(
                "Imported military ironwork is only available in contested-frontier worlds."
                    .to_string(),
            );
        }
        let network = tick
            .road_network(owner)
            .ok_or_else(|| "Connect the marketplace to a road before trading.".to_string())?;
        let clock = current_game_clock(ctx);
        apply_marketplace_trade(
            ctx,
            &tick,
            &clock,
            owner,
            building_id,
            &marketplace,
            network,
            offer,
        )?
    };
    if outcome == MarketplaceTradeOutcome::Staged {
        let mut updated = ctx
            .db
            .building()
            .id()
            .find(&building_id)
            .ok_or_else(|| "Marketplace not found.".to_string())?;
        updated.marketplace_pending_trade_code = pending_trade_code(trade_id)
            .ok_or_else(|| "This trade cannot be persisted as a staged order.".to_string())?;
        ctx.db.building().id().update(updated);
    }
    start_manual_trade_cooldown(
        ctx,
        building_id,
        marketplace.assigned_labor,
        current_road_speed_multiplier(ctx),
    );
    Ok(())
}

pub fn try_execute_standing_marketplace_import(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    building_id: u64,
    road_speed_multiplier: f64,
) -> bool {
    let Some(marketplace) = ctx.db.building().id().find(&building_id) else {
        return false;
    };
    if marketplace.kind != "marketplace"
        || !marketplace.construction_complete
        || tick.building_disabled_by_fire(ctx, marketplace.id)
        || marketplace.assigned_labor == 0
        || marketplace.action_cooldown > 1e-6
        || marketplace.marketplace_pending_trade_code != 0
        || labor_and_logistics_paused(ctx, tick, marketplace.owner, clock)
    {
        return false;
    }

    let conflict_enabled = ctx
        .db
        .world_config()
        .id()
        .find(&0)
        .is_some_and(|config| config.conflict_enabled);
    let Some(next_import) = next_standing_marketplace_import(
        marketplace.grain,
        marketplace.marketplace_seed_grain_target,
        marketplace.ironwork,
        marketplace.marketplace_ironwork_target,
        marketplace.iron,
        marketplace.marketplace_iron_target,
        marketplace.salt,
        marketplace.marketplace_salt_target,
        conflict_enabled,
    ) else {
        return false;
    };

    let Some(network) = tick.road_network(marketplace.owner) else {
        return false;
    };
    if network.nearest_distance(marketplace.x, marketplace.z) > BUILDING_ROAD_ACCESS_DISTANCE {
        return false;
    }

    let (trade_id, expected_resource, expected_lot) = match next_import {
        StandingMarketplaceImport::SeedGrain => (
            "buy_seed_grain",
            TradeResource::Grain,
            MARKETPLACE_SEED_GRAIN_IMPORT_LOT,
        ),
        StandingMarketplaceImport::Ironwork => (
            "buy_ironwork",
            TradeResource::Ironwork,
            MARKETPLACE_IRONWORK_IMPORT_LOT,
        ),
        StandingMarketplaceImport::Iron => (
            "buy_iron",
            TradeResource::Iron,
            MARKETPLACE_IRON_IMPORT_LOT,
        ),
        StandingMarketplaceImport::Salt => (
            "buy_salt",
            TradeResource::Salt,
            MARKETPLACE_SALT_IMPORT_LOT,
        ),
    };
    let Some(offer) = marketplace_trade_offer(trade_id) else {
        return false;
    };
    let MarketplaceTradeKind::GoldBuy {
        resource, amount, ..
    } = offer.kind
    else {
        return false;
    };
    if resource != expected_resource || (amount - expected_lot).abs() > 1e-6 {
        return false;
    }

    if apply_marketplace_trade(
        ctx,
        tick,
        clock,
        marketplace.owner,
        building_id,
        &marketplace,
        network,
        offer,
    ) != Ok(MarketplaceTradeOutcome::Settled)
    {
        return false;
    }
    start_manual_trade_cooldown(
        ctx,
        building_id,
        marketplace.assigned_labor,
        road_speed_multiplier,
    );
    true
}

fn execute_food_commodity_trade(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    owner: spacetimedb::Identity,
    building_id: u64,
    commodity: &crate::balance_generated::MarketCommodityOffer,
) -> Result<(), String> {
    ensure_market_state(ctx, owner);
    let market = ctx
        .db
        .market_state()
        .owner()
        .find(&owner)
        .ok_or_else(|| "Market state unavailable.".to_string())?;
    let gold_cost = scaled_gold_cost(commodity.base_gold_cost, market.food_price_mult);
    let sim_tick = ctx
        .db
        .world_config()
        .id()
        .find(&0)
        .map(|config| config.sim_tick)
        .unwrap_or(0);
    let clock = game_clock(sim_tick);
    order_food_commodity(
        ctx,
        tick,
        &clock,
        building_id,
        owner,
        commodity,
        gold_cost,
        MarketGoldPayer::Treasury,
        None,
        MarketCaravanDispatch::default(),
    )?;
    Ok(())
}

fn execute_water_commodity_trade(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    owner: spacetimedb::Identity,
    building_id: u64,
    commodity: &crate::balance_generated::MarketWaterCommodityOffer,
) -> Result<(), String> {
    ensure_market_state(ctx, owner);
    let market = ctx
        .db
        .market_state()
        .owner()
        .find(&owner)
        .ok_or_else(|| "Market state unavailable.".to_string())?;
    let gold_cost = scaled_gold_cost(commodity.base_gold_cost, market.firewood_price_mult);
    let sim_tick = ctx
        .db
        .world_config()
        .id()
        .find(&0)
        .map(|config| config.sim_tick)
        .unwrap_or(0);
    let clock = game_clock(sim_tick);
    order_water_commodity(
        ctx,
        tick,
        &clock,
        building_id,
        owner,
        commodity,
        gold_cost,
        MarketGoldPayer::Treasury,
        None,
        MarketCaravanDispatch::default(),
    )?;
    Ok(())
}

fn validate_marketplace(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    owner: spacetimedb::Identity,
    building_id: u64,
) -> Result<Building, String> {
    let building = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Marketplace not found.".to_string())?;
    if building.owner != owner {
        return Err("You do not own this marketplace.".to_string());
    }
    if building.kind != "marketplace" {
        return Err("Only marketplaces can broker foreign trade.".to_string());
    }
    if !building.construction_complete {
        return Err("The marketplace is still under construction.".to_string());
    }
    if tick.building_disabled_by_fire(ctx, building.id) {
        return Err("Repair the fire-damaged marketplace before trading.".to_string());
    }
    if building.marketplace_pending_trade_code != 0 {
        return Err(
            "This marketplace is already staging a bulk order. Let it settle or cancel it first."
                .to_string(),
        );
    }
    let has_road_access = tick
        .road_network(owner)
        .map(|network| {
            network.nearest_distance(building.x, building.z) <= BUILDING_ROAD_ACCESS_DISTANCE
        })
        .unwrap_or(false);
    if !manual_trade_ready(
        building.assigned_labor,
        building.action_cooldown,
        has_road_access,
    ) {
        if building.assigned_labor == 0 {
            return Err("Assign at least one broker before placing a manual trade.".to_string());
        }
        if !has_road_access {
            return Err("Connect the marketplace to a road before trading.".to_string());
        }
        return Err(format!(
            "The brokers need another {:.1} seconds before the next trade.",
            building.action_cooldown
        ));
    }
    Ok(building)
}

fn start_manual_trade_cooldown(
    ctx: &ReducerContext,
    building_id: u64,
    assigned_labor: u32,
    road_speed_multiplier: f64,
) {
    if let Some(mut marketplace) = ctx.db.building().id().find(&building_id) {
        marketplace.action_cooldown =
            manual_trade_cooldown_seconds(assigned_labor, road_speed_multiplier);
        ctx.db.building().id().update(marketplace);
    }
}

fn current_road_speed_multiplier(ctx: &ReducerContext) -> f64 {
    let clock = current_game_clock(ctx);
    ctx.db
        .world_config()
        .id()
        .find(&0)
        .map(|config| {
            environment_for(config.seed, config.hydrology, &clock).road_speed_multiplier()
        })
        .unwrap_or(1.0)
}

fn current_game_clock(ctx: &ReducerContext) -> GameClock {
    game_clock(
        ctx.db
            .world_config()
            .id()
            .find(&0)
            .map(|config| config.sim_tick)
            .unwrap_or(0),
    )
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum MarketplaceTradeOutcome {
    Settled,
    Staged,
}

// These codes are explicit rather than derived from balance-file ordering.
// Once written to a save they must continue to identify the same order even if
// its presentation order changes later.
fn pending_trade_code(trade_id: &str) -> Option<u8> {
    match trade_id {
        "sell_timber" => Some(1),
        "sell_stone" => Some(2),
        "sell_firewood" => Some(3),
        "sell_food" => Some(4),
        "timber_for_stone" => Some(5),
        "stone_for_timber" => Some(6),
        "timber_for_firewood" => Some(7),
        "sell_pottery" => Some(8),
        _ => None,
    }
}

fn pending_trade_offer(code: u8) -> Option<&'static MarketplaceTradeOffer> {
    let trade_id = match code {
        1 => "sell_timber",
        2 => "sell_stone",
        3 => "sell_firewood",
        4 => "sell_food",
        5 => "timber_for_stone",
        6 => "stone_for_timber",
        7 => "timber_for_firewood",
        8 => "sell_pottery",
        _ => return None,
    };
    marketplace_trade_offer(trade_id)
}

fn apply_marketplace_trade(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    owner: spacetimedb::Identity,
    building_id: u64,
    marketplace: &Building,
    network: &RoadNetwork,
    offer: &MarketplaceTradeOffer,
) -> Result<MarketplaceTradeOutcome, String> {
    ensure_market_state(ctx, owner);
    let market = ctx
        .db
        .market_state()
        .owner()
        .find(&owner)
        .ok_or_else(|| "Market state unavailable.".to_string())?;

    if let TradeReceive::Resource(leg) = trade_receive(offer) {
        ensure_marketplace_room(marketplace, leg.resource, leg.amount)?;
    }

    match trade_spend(offer) {
        TradeSpend::Gold(amount) => {
            let resource = trade_resource_for_buy(offer);
            let multiplier = price_multiplier_for(&market, resource);
            let gold_cost = scaled_gold_cost(amount, multiplier);
            if physical_trade_staging_enabled(ctx, owner) {
                spend_marketplace_coffer_gold(ctx, building_id, gold_cost)?;
            } else {
                spend_treasury_gold(ctx, owner, gold_cost)?;
            }
        }
        TradeSpend::Resource(leg) => {
            if physical_trade_staging_enabled(ctx, owner) {
                if stage_or_spend_physical_market_resource(
                    ctx,
                    tick,
                    clock,
                    owner,
                    marketplace,
                    network,
                    leg.resource,
                    leg.amount,
                )? == PhysicalMarketSpend::Staged
                {
                    // The first click orders a visible inbound cart. Regional
                    // prices and payment change only after the persistent order
                    // has its full lot physically present at this market.
                    return Ok(MarketplaceTradeOutcome::Staged);
                }
            } else {
                spend_market_accessible_resource(
                    ctx,
                    tick,
                    owner,
                    marketplace,
                    network,
                    leg.resource,
                    leg.amount,
                )?;
            }
        }
    }

    match trade_receive(offer) {
        TradeReceive::Gold(amount) => {
            let resource = trade_resource_for_sell(offer);
            let multiplier = price_multiplier_for(&market, resource);
            let mut settlement_market = ctx
                .db
                .building()
                .id()
                .find(&building_id)
                .ok_or_else(|| "Marketplace not found.".to_string())?;
            credit_marketplace_receipt_gold(
                ctx,
                &mut settlement_market,
                scaled_gold_yield(amount, multiplier),
            );
            ctx.db.building().id().update(settlement_market);
        }
        TradeReceive::Resource(leg) => {
            deposit_marketplace_resource(ctx, building_id, leg.resource, leg.amount)?
        }
    }

    record_trade_effects(ctx, owner, offer);
    Ok(MarketplaceTradeOutcome::Settled)
}

/// Advances one save-persistent physical export order. It is called on the
/// marketplace scheduler's existing staggered cadence, so inactive markets add
/// no route-search work. Failed attempts remain pending: fire, Sabbath, labor,
/// storage pressure, busy carts, and lost road access are all readable pauses
/// rather than destructive failures.
pub(crate) fn try_advance_pending_marketplace_trade(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    building_id: u64,
    road_speed_multiplier: f64,
) -> bool {
    let Some(marketplace) = ctx.db.building().id().find(&building_id) else {
        return false;
    };
    if marketplace.marketplace_pending_trade_code == 0 {
        return false;
    }

    let Some(offer) = pending_trade_offer(marketplace.marketplace_pending_trade_code) else {
        clear_pending_marketplace_trade(ctx, building_id);
        return true;
    };
    if !physical_trade_staging_enabled(ctx, marketplace.owner)
        || !matches!(trade_spend(offer), TradeSpend::Resource(_))
    {
        clear_pending_marketplace_trade(ctx, building_id);
        return true;
    }
    if marketplace.kind != "marketplace"
        || !marketplace.construction_complete
        || tick.building_disabled_by_fire(ctx, marketplace.id)
        || marketplace.assigned_labor == 0
        || marketplace.action_cooldown > 1e-6
        || labor_and_logistics_paused(ctx, tick, marketplace.owner, clock)
    {
        return false;
    }
    let Some(network) = tick.road_network(marketplace.owner) else {
        return false;
    };
    if network.nearest_distance(marketplace.x, marketplace.z) > BUILDING_ROAD_ACCESS_DISTANCE {
        return false;
    }

    match apply_marketplace_trade(
        ctx,
        tick,
        clock,
        marketplace.owner,
        building_id,
        &marketplace,
        network,
        offer,
    ) {
        Ok(MarketplaceTradeOutcome::Settled) => {
            clear_pending_marketplace_trade(ctx, building_id);
            start_manual_trade_cooldown(
                ctx,
                building_id,
                marketplace.assigned_labor,
                road_speed_multiplier,
            );
            true
        }
        Ok(MarketplaceTradeOutcome::Staged) => {
            start_manual_trade_cooldown(
                ctx,
                building_id,
                marketplace.assigned_labor,
                road_speed_multiplier,
            );
            true
        }
        Err(_) => false,
    }
}

pub(crate) fn pending_marketplace_trade_commodity(building: &Building) -> Option<CommodityKind> {
    let offer = pending_trade_offer(building.marketplace_pending_trade_code)?;
    match trade_spend(offer) {
        TradeSpend::Resource(leg) => Some(trade_commodity(leg.resource)),
        TradeSpend::Gold(_) => None,
    }
}

fn clear_pending_marketplace_trade(ctx: &ReducerContext, building_id: u64) {
    if let Some(mut marketplace) = ctx.db.building().id().find(&building_id) {
        marketplace.marketplace_pending_trade_code = 0;
        ctx.db.building().id().update(marketplace);
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PhysicalMarketSpend {
    Spent,
    Staged,
}

fn physical_trade_staging_enabled(ctx: &ReducerContext, owner: spacetimedb::Identity) -> bool {
    ctx.db
        .player_resources()
        .owner()
        .find(&owner)
        .is_some_and(|resources| resources.physical_founding_site_enabled)
}

fn spend_marketplace_coffer_gold(
    ctx: &ReducerContext,
    marketplace_id: u64,
    amount: f64,
) -> Result<(), String> {
    if amount <= 1e-9 {
        return Ok(());
    }
    let mut marketplace = ctx
        .db
        .building()
        .id()
        .find(&marketplace_id)
        .ok_or_else(|| "Marketplace not found.".to_string())?;
    if marketplace.gold + 1e-6 < amount {
        return Err(format!(
            "Marketplace coffer needs {} more gold. Raise its cash reserve or wait for a treasury cart.",
            (amount - marketplace.gold.max(0.0)).ceil() as i64
        ));
    }
    marketplace.gold = (marketplace.gold - amount).max(0.0);
    ctx.db.building().id().update(marketplace);
    Ok(())
}

/// New settlements keep foreign-trade proceeds and local market tolls in the
/// market row until a visible cart delivers them to a civic lockbox. Legacy
/// saves preserve their abstract treasury credit so the additive founding-site
/// flag remains the compatibility boundary for the whole physical economy.
pub(crate) fn credit_marketplace_receipt_gold(
    ctx: &ReducerContext,
    marketplace: &mut Building,
    amount: f64,
) {
    if !amount.is_finite() || amount <= 1e-6 {
        return;
    }
    if physical_trade_staging_enabled(ctx, marketplace.owner) {
        deposit_building_commodity(marketplace, CommodityKind::Gold, amount);
    } else {
        credit_treasury_gold(ctx, marketplace.owner, amount);
    }
}

fn stage_or_spend_physical_market_resource(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    owner: spacetimedb::Identity,
    marketplace: &Building,
    network: &RoadNetwork,
    resource: TradeResource,
    amount: f64,
) -> Result<PhysicalMarketSpend, String> {
    if amount <= 1e-6 {
        return Ok(PhysicalMarketSpend::Spent);
    }
    let commodity = trade_commodity(resource);
    let mut market = ctx
        .db
        .building()
        .id()
        .find(&marketplace.id)
        .ok_or_else(|| "Marketplace not found.".to_string())?;
    let local_stock = market_exportable_building_stock(&market, resource);
    if local_stock + 1e-6 >= amount {
        let withdrawn = crate::economy::withdraw_building_commodity(&mut market, commodity, amount);
        if withdrawn + 1e-6 < amount {
            return Err(format!(
                "Marketplace needs {} more staged {}.",
                (amount - withdrawn).ceil() as i64,
                trade_resource_name(resource)
            ));
        }
        ctx.db.building().id().update(market);
        return Ok(PhysicalMarketSpend::Spent);
    }

    if building_has_inbound_commodity_trip(ctx, marketplace.id, commodity) {
        return Err(format!(
            "A {} staging cart is already inbound to this marketplace.",
            trade_resource_name(resource)
        ));
    }

    let needed = amount - local_stock;
    let unreserved_budget = match resource {
        TradeResource::Timber => available_unreserved_building_timber(ctx, owner),
        TradeResource::Stone => available_unreserved_building_stone(ctx, owner),
        TradeResource::Firewood
        | TradeResource::Food
        | TradeResource::Grain
        | TradeResource::Barley
        | TradeResource::Ironwork
        | TradeResource::Iron
        | TradeResource::Salt
        | TradeResource::Pottery => f64::INFINITY,
    };
    let remote_budget = (unreserved_budget - local_stock).max(0.0);
    let mut candidates = Vec::new();
    let mut candidate_points = Vec::new();
    for source in ctx
        .db
        .building()
        .owner()
        .filter(&owner)
        .filter(|building| building.id != marketplace.id && building.construction_complete)
    {
        if tick.building_disabled_by_fire(ctx, source.id)
            || building_has_active_trip(ctx, source.id)
        {
            continue;
        }
        let exportable = market_exportable_building_stock(&source, resource);
        if exportable <= 1e-6 {
            continue;
        }
        candidate_points.push((source.x, source.z));
        candidates.push((source, exportable));
    }
    let distances =
        network.road_path_distances_from(marketplace.x, marketplace.z, &candidate_points);
    let mut accessible = 0.0;
    let mut best: Option<(Building, f64)> = None;
    for ((source, exportable), distance) in candidates.into_iter().zip(distances) {
        let Some(distance) = distance else {
            continue;
        };
        accessible += exportable;
        let replace = best.as_ref().is_none_or(|(current, current_distance)| {
            distance < *current_distance - 1e-6
                || ((distance - *current_distance).abs() <= 1e-6 && source.id < current.id)
        });
        if replace {
            best = Some((source, distance));
        }
    }

    let stageable = accessible.min(remote_budget);
    if stageable + 1e-6 < needed {
        return Err(format!(
            "Not enough cart-ready {} to stage this trade (need {} more). Construction reserves, busy carts, fire-damaged stores, and disconnected stock remain protected.",
            trade_resource_name(resource),
            (needed - stageable).ceil() as i64
        ));
    }
    let Some((mut source, _)) = best else {
        return Err(format!(
            "No free road-linked source can stage {} at this marketplace.",
            trade_resource_name(resource)
        ));
    };
    let load = needed
        .min(stageable)
        .min(market_exportable_building_stock(&source, resource));
    let workers = marketplace.assigned_labor.clamp(1, 2);
    if !try_start_building_supply_trip(
        ctx,
        tick,
        clock,
        network,
        &mut source,
        marketplace,
        workers,
        commodity,
        TIMBER_DELIVERY_SPEED_MPS,
        TIMBER_DELIVERY_UNLOAD_SEC,
        load / workers as f64,
        load,
    ) {
        return Err(format!(
            "The selected {} source cannot dispatch its staging cart.",
            trade_resource_name(resource)
        ));
    }
    ctx.db.building().id().update(source);
    Ok(PhysicalMarketSpend::Staged)
}

fn record_trade_effects(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    offer: &MarketplaceTradeOffer,
) {
    match offer.kind {
        MarketplaceTradeKind::GoldBuy {
            resource, amount, ..
        } => record_market_trade(ctx, owner, resource, MarketTradeDirection::Import, amount),
        MarketplaceTradeKind::GoldSell {
            resource, amount, ..
        } => record_market_trade(ctx, owner, resource, MarketTradeDirection::Export, amount),
        MarketplaceTradeKind::Barter {
            give,
            give_amount,
            receive,
            receive_amount,
        } => {
            record_market_trade(ctx, owner, give, MarketTradeDirection::Export, give_amount);
            record_market_trade(
                ctx,
                owner,
                receive,
                MarketTradeDirection::Import,
                receive_amount,
            );
        }
    }
}

fn trade_resource_for_buy(offer: &MarketplaceTradeOffer) -> TradeResource {
    match offer.kind {
        MarketplaceTradeKind::GoldBuy { resource, .. } => resource,
        _ => TradeResource::Timber,
    }
}

fn trade_resource_for_sell(offer: &MarketplaceTradeOffer) -> TradeResource {
    match offer.kind {
        MarketplaceTradeKind::GoldSell { resource, .. } => resource,
        _ => TradeResource::Timber,
    }
}

fn trade_commodity(resource: TradeResource) -> CommodityKind {
    match resource {
        TradeResource::Timber => CommodityKind::Timber,
        TradeResource::Stone => CommodityKind::Stone,
        TradeResource::Firewood => CommodityKind::Firewood,
        TradeResource::Food => CommodityKind::Food,
        TradeResource::Grain => CommodityKind::Grain,
        TradeResource::Barley => CommodityKind::Barley,
        TradeResource::Ironwork => CommodityKind::Ironwork,
        TradeResource::Iron => CommodityKind::Iron,
        TradeResource::Salt => CommodityKind::Salt,
        TradeResource::Pottery => CommodityKind::Pottery,
    }
}

fn trade_resource_name(resource: TradeResource) -> &'static str {
    match resource {
        TradeResource::Timber => "timber",
        TradeResource::Stone => "stone",
        TradeResource::Firewood => "firewood",
        TradeResource::Food => "food",
        TradeResource::Grain => "grain",
        TradeResource::Barley => "barley",
        TradeResource::Ironwork => "ironwork",
        TradeResource::Iron => "iron",
        TradeResource::Salt => "salt",
        TradeResource::Pottery => "pottery",
    }
}

fn ensure_marketplace_room(
    marketplace: &Building,
    resource: TradeResource,
    amount: f64,
) -> Result<(), String> {
    let room = building_commodity_room(marketplace, trade_commodity(resource));
    if room + 1e-6 >= amount {
        return Ok(());
    }
    Err(format!(
        "Marketplace {} storage needs {} more free capacity.",
        trade_resource_name(resource),
        (amount - room).ceil() as i64
    ))
}

fn spend_market_accessible_resource(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    owner: spacetimedb::Identity,
    marketplace: &Building,
    network: &RoadNetwork,
    resource: TradeResource,
    amount: f64,
) -> Result<(), String> {
    if amount <= 1e-6 {
        return Ok(());
    }

    let mut connected: Vec<Building> = ctx
        .db
        .building()
        .owner()
        .filter(&owner)
        .filter(|building| building.construction_complete)
        .filter(|building| !tick.building_disabled_by_fire(ctx, building.id))
        .filter(|building| {
            network.road_connected(marketplace.x, marketplace.z, building.x, building.z)
        })
        .collect();
    connected.sort_by(|left, right| {
        let left_distance = (left.x - marketplace.x).powi(2) + (left.z - marketplace.z).powi(2);
        let right_distance = (right.x - marketplace.x).powi(2) + (right.z - marketplace.z).powi(2);
        left_distance
            .total_cmp(&right_distance)
            .then_with(|| left.id.cmp(&right.id))
    });

    let commodity = trade_commodity(resource);
    let connected_stock: f64 = connected
        .iter()
        .map(|building| market_exportable_building_stock(building, resource))
        .sum();
    let treasury_available = treasury_trade_stock(ctx, owner, resource);
    let building_budget = match resource {
        TradeResource::Timber => {
            connected_stock.min(available_unreserved_building_timber(ctx, owner))
        }
        TradeResource::Stone => {
            connected_stock.min(available_unreserved_building_stone(ctx, owner))
        }
        TradeResource::Firewood
        | TradeResource::Food
        | TradeResource::Grain
        | TradeResource::Barley
        | TradeResource::Ironwork
        | TradeResource::Iron
        | TradeResource::Salt
        | TradeResource::Pottery => connected_stock,
    };
    if treasury_available + building_budget + 1e-6 < amount {
        let shortfall = amount - treasury_available - building_budget;
        return Err(format!(
            "Not enough market-accessible {} (need {} more). Household reserves and disconnected stores are protected.",
            trade_resource_name(resource),
            shortfall.ceil() as i64
        ));
    }

    let mut remaining = amount;
    let mut remaining_building_budget = building_budget;
    for mut building in connected {
        if remaining <= 1e-6 || remaining_building_budget <= 1e-6 {
            break;
        }
        let exportable = market_exportable_building_stock(&building, resource);
        if exportable <= 1e-6 {
            continue;
        }
        let withdrawn = crate::economy::withdraw_building_commodity(
            &mut building,
            commodity,
            remaining.min(remaining_building_budget).min(exportable),
        );
        if withdrawn <= 1e-6 {
            continue;
        }
        ctx.db.building().id().update(building);
        remaining -= withdrawn;
        remaining_building_budget -= withdrawn;
    }

    if remaining > 1e-6 {
        withdraw_treasury_trade_stock(ctx, owner, resource, remaining)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{pending_trade_code, pending_trade_offer};

    #[test]
    fn pending_trade_codes_are_stable_and_reversible() {
        let expected = [
            (1, "sell_timber"),
            (2, "sell_stone"),
            (3, "sell_firewood"),
            (4, "sell_food"),
            (5, "timber_for_stone"),
            (6, "stone_for_timber"),
            (7, "timber_for_firewood"),
            (8, "sell_pottery"),
        ];
        for (code, trade_id) in expected {
            assert_eq!(pending_trade_code(trade_id), Some(code));
            assert_eq!(
                pending_trade_offer(code).map(|offer| offer.id),
                Some(trade_id)
            );
        }
        assert_eq!(pending_trade_code("buy_timber"), None);
        assert!(pending_trade_offer(0).is_none());
        assert!(pending_trade_offer(255).is_none());
    }
}

fn market_exportable_building_stock(building: &Building, resource: TradeResource) -> f64 {
    let stock =
        crate::economy::building_commodity_stock(building, trade_commodity(resource)).max(0.0);
    match resource {
        TradeResource::Grain if building.kind == "granary" => {
            granary_exportable_grain(stock, building.granary_grain_reserve)
        }
        _ => stock,
    }
}

fn treasury_trade_stock(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    resource: TradeResource,
) -> f64 {
    match resource {
        TradeResource::Timber => available_unreserved_treasury_timber(ctx, owner),
        TradeResource::Stone => available_unreserved_treasury_stone(ctx, owner),
        TradeResource::Firewood => ctx
            .db
            .player_resources()
            .owner()
            .find(&owner)
            .map(|row| row.firewood)
            .unwrap_or(0.0),
        TradeResource::Food => ctx
            .db
            .player_resources()
            .owner()
            .find(&owner)
            .map(|row| row.food)
            .unwrap_or(0.0),
        TradeResource::Grain => ctx
            .db
            .player_resources()
            .owner()
            .find(&owner)
            .map(|row| row.grain)
            .unwrap_or(0.0),
        TradeResource::Barley => ctx
            .db
            .player_resources()
            .owner()
            .find(&owner)
            .map(|row| row.barley)
            .unwrap_or(0.0),
        TradeResource::Ironwork => ctx
            .db
            .player_resources()
            .owner()
            .find(&owner)
            .map(|row| row.ironwork)
            .unwrap_or(0.0),
        TradeResource::Iron => ctx
            .db
            .player_resources()
            .owner()
            .find(&owner)
            .map(|row| row.iron)
            .unwrap_or(0.0),
        TradeResource::Salt => ctx
            .db
            .player_resources()
            .owner()
            .find(&owner)
            .map(|row| row.salt)
            .unwrap_or(0.0),
        TradeResource::Pottery => ctx
            .db
            .player_resources()
            .owner()
            .find(&owner)
            .map(|row| row.pottery)
            .unwrap_or(0.0),
    }
}

fn withdraw_treasury_trade_stock(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    resource: TradeResource,
    amount: f64,
) -> Result<(), String> {
    let available = treasury_trade_stock(ctx, owner, resource);
    if available + 1e-6 < amount {
        return Err(format!(
            "Not enough market-accessible {}.",
            trade_resource_name(resource)
        ));
    }
    let mut treasury = ctx
        .db
        .player_resources()
        .owner()
        .find(&owner)
        .ok_or_else(|| "Settlement treasury not found.".to_string())?;
    match resource {
        TradeResource::Timber => treasury.timber -= amount,
        TradeResource::Stone => treasury.stone -= amount,
        TradeResource::Firewood => treasury.firewood -= amount,
        TradeResource::Food => treasury.food -= amount,
        TradeResource::Grain => treasury.grain -= amount,
        TradeResource::Barley => treasury.barley -= amount,
        TradeResource::Ironwork => treasury.ironwork -= amount,
        TradeResource::Iron => treasury.iron -= amount,
        TradeResource::Salt => treasury.salt -= amount,
        TradeResource::Pottery => treasury.pottery -= amount,
    }
    ctx.db.player_resources().owner().update(treasury);
    Ok(())
}

fn deposit_marketplace_resource(
    ctx: &ReducerContext,
    building_id: u64,
    resource: TradeResource,
    amount: f64,
) -> Result<(), String> {
    let mut marketplace = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Marketplace not found.".to_string())?;
    let deposited = deposit_building_commodity(&mut marketplace, trade_commodity(resource), amount);
    if deposited + 1e-6 < amount {
        return Err(format!(
            "Marketplace {} storage cannot receive the full shipment.",
            trade_resource_name(resource)
        ));
    }
    ctx.db.building().id().update(marketplace);
    Ok(())
}
