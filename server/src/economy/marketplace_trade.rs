use spacetimedb::ReducerContext;

use super::marketplace_orders::{order_food_commodity, order_water_commodity, MarketGoldPayer};
use super::marketplace_trade_policy::{trade_receive, trade_spend, TradeReceive, TradeSpend};
use super::regional_market::{
    ensure_market_state, price_multiplier_for, scaled_gold_cost, scaled_gold_yield,
};
use crate::balance_generated::TradeResource;
use crate::balance_generated::{
    market_commodity_offer, market_water_commodity_offer, marketplace_trade_offer,
    MarketplaceTradeKind, MarketplaceTradeOffer, TradeResourceSpendScope,
};
use crate::db::*;
use crate::economy::{
    credit_treasury_firewood, credit_treasury_food, credit_treasury_gold, credit_treasury_stone,
    credit_treasury_timber, spend_aggregate_firewood, spend_aggregate_food, spend_aggregate_stone,
    spend_aggregate_timber, spend_treasury_gold,
};
use crate::simulation::{game_clock, MarketCaravanDispatch, SimTickContext};

pub fn execute_marketplace_trade(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    building_id: u64,
    trade_id: &str,
) -> Result<(), String> {
    if let Some(commodity) = market_commodity_offer(trade_id) {
        return execute_food_commodity_trade(ctx, owner, building_id, commodity);
    }
    if let Some(commodity) = market_water_commodity_offer(trade_id) {
        return execute_water_commodity_trade(ctx, owner, building_id, commodity);
    }

    let offer = marketplace_trade_offer(trade_id)
        .ok_or_else(|| format!("Unknown trade offer: {trade_id}"))?;
    apply_marketplace_trade(ctx, owner, offer)
}

fn execute_food_commodity_trade(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    building_id: u64,
    commodity: &crate::balance_generated::MarketCommodityOffer,
) -> Result<(), String> {
    validate_marketplace(ctx, owner, building_id)?;
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
    let tick = SimTickContext::new(ctx);
    order_food_commodity(
        ctx,
        &tick,
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
    owner: spacetimedb::Identity,
    building_id: u64,
    commodity: &crate::balance_generated::MarketWaterCommodityOffer,
) -> Result<(), String> {
    validate_marketplace(ctx, owner, building_id)?;
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
    let tick = SimTickContext::new(ctx);
    order_water_commodity(
        ctx,
        &tick,
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
    owner: spacetimedb::Identity,
    building_id: u64,
) -> Result<(), String> {
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
    Ok(())
}

pub fn apply_marketplace_trade(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    offer: &MarketplaceTradeOffer,
) -> Result<(), String> {
    ensure_market_state(ctx, owner);
    let market = ctx
        .db
        .market_state()
        .owner()
        .find(&owner)
        .ok_or_else(|| "Market state unavailable.".to_string())?;

    match trade_spend(offer) {
        TradeSpend::Gold(amount) => {
            let resource = trade_resource_for_buy(offer);
            let multiplier = price_multiplier_for(&market, resource);
            spend_treasury_gold(ctx, owner, scaled_gold_cost(amount, multiplier))?;
        }
        TradeSpend::Resource(leg) => spend_trade_resource(ctx, owner, leg.resource, leg.amount)?,
    }

    match trade_receive(offer) {
        TradeReceive::Gold(amount) => {
            let resource = trade_resource_for_sell(offer);
            let multiplier = price_multiplier_for(&market, resource);
            credit_treasury_gold(ctx, owner, scaled_gold_yield(amount, multiplier));
        }
        TradeReceive::Resource(leg) => credit_trade_resource(ctx, owner, leg.resource, leg.amount)?,
    }

    Ok(())
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

fn spend_trade_resource(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    resource: TradeResource,
    amount: f64,
) -> Result<(), String> {
    match resource.spend_scope() {
        TradeResourceSpendScope::Aggregate => match resource {
            TradeResource::Timber => spend_aggregate_timber(ctx, owner, amount),
            TradeResource::Stone => spend_aggregate_stone(ctx, owner, amount),
            TradeResource::Firewood => spend_aggregate_firewood(ctx, owner, amount),
            TradeResource::Food => spend_aggregate_food(ctx, owner, amount),
        },
        TradeResourceSpendScope::Treasury => {
            Err(format!("Treasury spend is not supported for {resource:?}"))
        }
    }
}

fn credit_trade_resource(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    resource: TradeResource,
    amount: f64,
) -> Result<(), String> {
    match resource {
        TradeResource::Timber => credit_treasury_timber(ctx, owner, amount),
        TradeResource::Stone => credit_treasury_stone(ctx, owner, amount),
        TradeResource::Firewood => credit_treasury_firewood(ctx, owner, amount),
        TradeResource::Food => credit_treasury_food(ctx, owner, amount),
    }
    Ok(())
}
