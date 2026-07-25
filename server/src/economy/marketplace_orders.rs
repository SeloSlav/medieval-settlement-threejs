//! Shared marketplace provender and water ordering — treasury, household, or relief gold.

use spacetimedb::ReducerContext;

use crate::balance_generated::{
    MarketCommodityOffer, MarketWaterCommodityOffer, MARKET_CARAVAN_FOOD_PER_DELIVERY,
    MARKET_CARAVAN_WATER_PER_DELIVERY,
};
use crate::db::*;
use crate::economy::regional_market::scaled_gold_cost;
use crate::economy::{
    building_food_storage_cap, building_water_storage_cap, credit_treasury_food,
    credit_treasury_gold, credit_treasury_water, debit_residence_wealth, deposit_building_food,
    deposit_building_water, spend_treasury_gold,
};
use crate::simulation::residence_needs::ResidenceNeedKind;
use crate::simulation::{
    road_path_distance, try_dispatch_marketplace_caravan, GameClock, MarketCaravanDispatch,
    SimTickContext,
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

    pay_market_gold(ctx, owner, gold_cost, payer, residence)?;

    let mut building = ctx
        .db
        .building()
        .id()
        .find(&marketplace_id)
        .ok_or_else(|| "Marketplace not found.".to_string())?;

    let cap = building_food_storage_cap(&building.kind);
    let (deposited, updated) = deposit_building_food(&building, cap, commodity.food_amount);
    building = updated;
    if deposited <= 1e-6 {
        refund_market_gold(ctx, owner, gold_cost, payer, residence);
        return Err("Marketplace provender storage is full.".to_string());
    }
    ctx.db.building().id().update(building.clone());

    let overflow = commodity.food_amount - deposited;
    if overflow > 1e-6 {
        credit_treasury_food(ctx, owner, overflow);
    }

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
    ctx.db.building().id().update(dispatch_building);
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

    pay_market_gold(ctx, owner, gold_cost, payer, residence)?;

    let mut building = ctx
        .db
        .building()
        .id()
        .find(&marketplace_id)
        .ok_or_else(|| "Marketplace not found.".to_string())?;

    let cap = building
        .water_capacity
        .max(building_water_storage_cap(&building.kind));
    let (deposited, updated) = deposit_building_water(&building, cap, commodity.water_amount);
    building = updated;
    if deposited <= 1e-6 {
        refund_market_gold(ctx, owner, gold_cost, payer, residence);
        return Err("Marketplace water storage is full.".to_string());
    }
    ctx.db.building().id().update(building.clone());

    let overflow = commodity.water_amount - deposited;
    if overflow > 1e-6 {
        credit_treasury_water(ctx, owner, overflow);
    }

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
    ctx.db.building().id().update(dispatch_building);
    Ok(dispatched)
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

pub fn nearest_marketplace_for_residence<'a>(
    tick: &SimTickContext,
    owner: spacetimedb::Identity,
    residence: &Residence,
    marketplaces: &'a [Building],
) -> Option<&'a Building> {
    let mut best: Option<&Building> = None;
    let mut best_distance = f64::INFINITY;

    for marketplace in marketplaces {
        if marketplace.owner != owner || marketplace.kind != "marketplace" {
            continue;
        }
        let Some(distance) = tick.road_network(owner).and_then(|network| {
            road_path_distance(
                network,
                residence.x,
                residence.z,
                marketplace.x,
                marketplace.z,
            )
        }) else {
            continue;
        };
        if distance + 1e-6 < best_distance
            || ((distance - best_distance).abs() <= 1e-6
                && best.map_or(true, |current| marketplace.id < current.id))
        {
            best_distance = distance;
            best = Some(marketplace);
        }
    }

    best
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
            let paid = debit_residence_wealth(ctx, residence, gold_cost);
            if paid + 1e-6 < gold_cost {
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
