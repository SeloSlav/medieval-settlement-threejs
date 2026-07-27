//! Shared marketplace provender and water ordering — treasury, household, or relief gold.

use spacetimedb::ReducerContext;

use crate::balance_generated::{
    MarketCommodityOffer, MarketWaterCommodityOffer, TradeResource,
    MARKET_CARAVAN_FOOD_PER_DELIVERY, MARKET_CARAVAN_WATER_PER_DELIVERY,
};
use crate::db::*;
use crate::economy::marketplace_trade_policy::market_order_should_commit;
use crate::economy::regional_market::{record_market_trade, scaled_gold_cost};
use crate::economy::regional_market_policy::MarketTradeDirection;
use crate::economy::{
    building_food_storage_cap, building_water_storage_cap, credit_treasury_gold,
    debit_residence_wealth, deposit_building_food, deposit_building_water, spend_treasury_gold,
};
use crate::simulation::residence_needs::ResidenceNeedKind;
use crate::simulation::{
    try_dispatch_marketplace_caravan, GameClock, MarketCaravanDispatch, SimTickContext,
};
use crate::tables::{Building, Residence};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MarketGoldPayer {
    Treasury,
    Household,
    Relief,
}

pub fn order_food_commodity(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    marketplace_id: u64,
    owner: spacetimedb::Identity,
    commodity: &MarketCommodityOffer,
    gold_cost: f64,
    payer: MarketGoldPayer,
    residence: Option<&Residence>,
    dispatch: MarketCaravanDispatch,
) -> Result<bool, String> {
    if gold_cost <= 1e-9 {
        return Ok(false);
    }

    let mut building = ctx
        .db
        .building()
        .id()
        .find(&marketplace_id)
        .ok_or_else(|| "Marketplace not found.".to_string())?;
    validate_order_marketplace(ctx, tick, &building, owner)?;
    let original_building = building.clone();

    pay_market_gold(ctx, owner, gold_cost, payer, residence)?;

    let cap = building_food_storage_cap(&building.kind);
    let (deposited, updated) = deposit_building_food(&building, cap, commodity.food_amount);
    if deposited + 1e-6 < commodity.food_amount {
        refund_market_gold(ctx, owner, gold_cost, payer, residence);
        return Err("Marketplace needs room for the full provender order.".to_string());
    }
    building = updated;
    ctx.db.building().id().update(building.clone());

    let mut dispatch_building = ctx
        .db
        .building()
        .id()
        .find(&marketplace_id)
        .unwrap_or(building);
    let dispatched = try_dispatch_marketplace_caravan(
        ctx,
        clock,
        tick,
        &mut dispatch_building,
        ResidenceNeedKind::Food,
        MARKET_CARAVAN_FOOD_PER_DELIVERY,
        dispatch,
    );
    if !market_order_should_commit(dispatch.priority_residence_id.is_some(), dispatched) {
        ctx.db.building().id().update(original_building);
        refund_market_gold(ctx, owner, gold_cost, payer, residence);
        return Ok(false);
    }
    ctx.db.building().id().update(dispatch_building);

    record_market_trade(
        ctx,
        owner,
        TradeResource::Food,
        MarketTradeDirection::Import,
        commodity.food_amount,
    );
    Ok(dispatched)
}

pub fn order_water_commodity(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    marketplace_id: u64,
    owner: spacetimedb::Identity,
    commodity: &MarketWaterCommodityOffer,
    gold_cost: f64,
    payer: MarketGoldPayer,
    residence: Option<&Residence>,
    dispatch: MarketCaravanDispatch,
) -> Result<bool, String> {
    if gold_cost <= 1e-9 {
        return Ok(false);
    }

    let mut building = ctx
        .db
        .building()
        .id()
        .find(&marketplace_id)
        .ok_or_else(|| "Marketplace not found.".to_string())?;
    validate_order_marketplace(ctx, tick, &building, owner)?;
    let original_building = building.clone();

    pay_market_gold(ctx, owner, gold_cost, payer, residence)?;

    let cap = building
        .water_capacity
        .max(building_water_storage_cap(&building.kind));
    let (deposited, updated) = deposit_building_water(&building, cap, commodity.water_amount);
    if deposited + 1e-6 < commodity.water_amount {
        refund_market_gold(ctx, owner, gold_cost, payer, residence);
        return Err("Marketplace needs room for the full water order.".to_string());
    }
    building = updated;
    ctx.db.building().id().update(building.clone());

    let mut dispatch_building = ctx
        .db
        .building()
        .id()
        .find(&marketplace_id)
        .unwrap_or(building);
    let dispatched = try_dispatch_marketplace_caravan(
        ctx,
        clock,
        tick,
        &mut dispatch_building,
        ResidenceNeedKind::Water,
        MARKET_CARAVAN_WATER_PER_DELIVERY,
        dispatch,
    );
    if !market_order_should_commit(dispatch.priority_residence_id.is_some(), dispatched) {
        ctx.db.building().id().update(original_building);
        refund_market_gold(ctx, owner, gold_cost, payer, residence);
        return Ok(false);
    }
    ctx.db.building().id().update(dispatch_building);
    Ok(dispatched)
}

fn validate_order_marketplace(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    building: &Building,
    owner: spacetimedb::Identity,
) -> Result<(), String> {
    if building.owner != owner || building.kind != "marketplace" {
        return Err("Marketplace not found.".to_string());
    }
    if !building.construction_complete {
        return Err("Complete the marketplace before ordering goods.".to_string());
    }
    if tick.building_disabled_by_fire(ctx, building.id) {
        return Err("Repair the fire-damaged marketplace before ordering goods.".to_string());
    }
    Ok(())
}

pub fn best_affordable_food_commodity<'a>(
    commodities: &'a [MarketCommodityOffer],
    budget: f64,
    price_mult: f64,
) -> Option<&'a MarketCommodityOffer> {
    commodities
        .iter()
        .filter(|offer| scaled_gold_cost(offer.base_gold_cost, price_mult) <= budget + 1e-6)
        .max_by(|left, right| {
            let left_value = left.food_amount / scaled_gold_cost(left.base_gold_cost, price_mult);
            let right_value =
                right.food_amount / scaled_gold_cost(right.base_gold_cost, price_mult);
            left_value
                .partial_cmp(&right_value)
                .unwrap_or(std::cmp::Ordering::Equal)
        })
}

pub fn best_affordable_water_commodity<'a>(
    commodities: &'a [MarketWaterCommodityOffer],
    budget: f64,
    price_mult: f64,
) -> Option<&'a MarketWaterCommodityOffer> {
    commodities
        .iter()
        .filter(|offer| scaled_gold_cost(offer.base_gold_cost, price_mult) <= budget + 1e-6)
        .max_by(|left, right| {
            let left_value = left.water_amount / scaled_gold_cost(left.base_gold_cost, price_mult);
            let right_value =
                right.water_amount / scaled_gold_cost(right.base_gold_cost, price_mult);
            left_value
                .partial_cmp(&right_value)
                .unwrap_or(std::cmp::Ordering::Equal)
        })
}

fn pay_market_gold(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    gold_cost: f64,
    payer: MarketGoldPayer,
    residence: Option<&Residence>,
) -> Result<(), String> {
    match payer {
        MarketGoldPayer::Treasury => spend_treasury_gold(ctx, owner, gold_cost),
        MarketGoldPayer::Household => {
            let Some(residence) = residence else {
                return Err("Household payment requires a residence.".to_string());
            };
            let Some(current) = ctx.db.residence().id().find(&residence.id) else {
                return Err("Household not found.".to_string());
            };
            let paid = debit_residence_wealth(ctx, &current, gold_cost);
            if paid + 1e-6 < gold_cost {
                crate::economy::credit_residence_wealth(ctx, residence.id, paid);
                return Err("Household cannot afford this order.".to_string());
            }
            Ok(())
        }
        MarketGoldPayer::Relief => Ok(()),
    }
}

fn refund_market_gold(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    gold_cost: f64,
    payer: MarketGoldPayer,
    residence: Option<&Residence>,
) {
    match payer {
        MarketGoldPayer::Treasury => credit_treasury_gold(ctx, owner, gold_cost),
        MarketGoldPayer::Relief => {}
        MarketGoldPayer::Household => {
            if let Some(residence) = residence {
                crate::economy::credit_residence_wealth(ctx, residence.id, gold_cost);
            }
        }
    }
}
