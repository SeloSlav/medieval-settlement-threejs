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
    MarketplaceTradeKind, MarketplaceTradeOffer,
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
    MARKETPLACE_SEED_GRAIN_IMPORT_LOT,
};
use crate::roads::RoadNetwork;
use crate::season_policy::environment_for;
use crate::simulation::{
    game_clock, labor_and_logistics_paused, GameClock, MarketCaravanDispatch, SimTickContext,
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

    let result = if let Some(commodity) = market_commodity_offer(trade_id) {
        execute_food_commodity_trade(ctx, &tick, owner, building_id, commodity)
    } else if let Some(commodity) = market_water_commodity_offer(trade_id) {
        execute_water_commodity_trade(ctx, &tick, owner, building_id, commodity)
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
        apply_marketplace_trade(ctx, owner, building_id, &marketplace, network, offer)
    };
    result?;
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
        marketplace.owner,
        building_id,
        &marketplace,
        network,
        offer,
    )
    .is_err()
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
    ctx.db
        .world_config()
        .id()
        .find(&0)
        .map(|config| {
            environment_for(config.seed, config.hydrology, &game_clock(config.sim_tick))
                .road_speed_multiplier()
        })
        .unwrap_or(1.0)
}

fn apply_marketplace_trade(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    building_id: u64,
    marketplace: &Building,
    network: &RoadNetwork,
    offer: &MarketplaceTradeOffer,
) -> Result<(), String> {
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
            spend_treasury_gold(ctx, owner, scaled_gold_cost(amount, multiplier))?;
        }
        TradeSpend::Resource(leg) => spend_market_accessible_resource(
            ctx,
            owner,
            marketplace,
            network,
            leg.resource,
            leg.amount,
        )?,
    }

    match trade_receive(offer) {
        TradeReceive::Gold(amount) => {
            let resource = trade_resource_for_sell(offer);
            let multiplier = price_multiplier_for(&market, resource);
            credit_treasury_gold(ctx, owner, scaled_gold_yield(amount, multiplier));
        }
        TradeReceive::Resource(leg) => {
            deposit_marketplace_resource(ctx, building_id, leg.resource, leg.amount)?
        }
    }

    record_trade_effects(ctx, owner, offer);
    Ok(())
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
        TradeResource::Ironwork => CommodityKind::Ironwork,
    }
}

fn trade_resource_name(resource: TradeResource) -> &'static str {
    match resource {
        TradeResource::Timber => "timber",
        TradeResource::Stone => "stone",
        TradeResource::Firewood => "firewood",
        TradeResource::Food => "food",
        TradeResource::Grain => "grain",
        TradeResource::Ironwork => "ironwork",
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
        | TradeResource::Ironwork => connected_stock,
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
        TradeResource::Ironwork => ctx
            .db
            .player_resources()
            .owner()
            .find(&owner)
            .map(|row| row.ironwork)
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
        TradeResource::Ironwork => treasury.ironwork -= amount,
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
