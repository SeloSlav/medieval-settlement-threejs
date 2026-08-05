//! Trading Post provender and water ordering — treasury, household, or relief gold.

use spacetimedb::ReducerContext;

use crate::balance_generated::{
    MarketCommodityOffer, MarketWaterCommodityOffer, TradeResource, FOOD_DELIVERY_SPEED_MPS,
    FOOD_DELIVERY_UNLOAD_SEC, MARKET_CARAVAN_FOOD_PER_DELIVERY, MARKET_CARAVAN_WATER_PER_DELIVERY,
    WATER_DELIVERY_SPEED_MPS, WATER_DELIVERY_UNLOAD_SEC,
};
use crate::db::*;
use crate::economy::marketplace_trade_policy::market_order_should_commit;
use crate::economy::regional_market::{record_market_trade, scaled_gold_cost};
use crate::economy::regional_market_policy::MarketTradeDirection;
use crate::economy::{
    building_commodity_room, building_water_storage_cap, collectible_household_import_duty,
    credit_household_import_duty, credit_treasury_gold, debit_residence_wealth,
    deposit_building_commodity, deposit_building_water, spend_treasury_gold, CommodityKind,
};
use crate::simulation::residence_needs::ResidenceNeedKind;
use crate::simulation::residence_needs::{load_needs, need_stock};
use crate::simulation::{
    building_has_regional_market_trip, delivery_stock_room, regional_market_import_route,
    regional_market_import_route_to_residence, residence_commodity_delivery_room,
    start_external_market_import_trip,
    start_external_market_import_trip_to_residence, try_dispatch_marketplace_caravan, GameClock,
    MarketCaravanDispatch, SimTickContext,
};
use crate::tables::{Building, Residence};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MarketGoldPayer {
    Treasury,
    Household,
    Relief,
}

pub(crate) fn market_food_commodity_kind(
    commodity: &MarketCommodityOffer,
) -> Result<CommodityKind, String> {
    match commodity.resource_kind {
        "meat" => Ok(CommodityKind::Meat),
        "curedMeat" => Ok(CommodityKind::CuredMeat),
        "cheese" => Ok(CommodityKind::Cheese),
        kind => Err(format!("Unsupported regional food commodity: {kind}.")),
    }
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
        .ok_or_else(|| "Trading Post not found.".to_string())?;
    validate_order_marketplace(ctx, tick, &building, owner)?;
    let import_duty = if payer == MarketGoldPayer::Household {
        collectible_household_import_duty(ctx, &building, gold_cost)
    } else {
        0.0
    };
    let total_charge = gold_cost + import_duty;
    let physical_commodity = market_food_commodity_kind(commodity)?;
    if physical_market_orders_enabled(ctx, owner) {
        return order_physical_market_import(
            ctx,
            tick,
            &mut building,
            owner,
            physical_commodity,
            commodity.food_amount,
            gold_cost,
            import_duty,
            FOOD_DELIVERY_SPEED_MPS,
            FOOD_DELIVERY_UNLOAD_SEC,
            payer,
            residence,
            dispatch,
            Some(TradeResource::Food),
        );
    }
    let original_building = building.clone();

    let paid_from_market =
        pay_market_gold(ctx, owner, total_charge, payer, residence, &mut building)?;

    let deposited =
        deposit_building_commodity(&mut building, physical_commodity, commodity.food_amount);
    if deposited + 1e-6 < commodity.food_amount {
        refund_market_gold(ctx, owner, total_charge, payer, residence, paid_from_market);
        return Err("Trading Post needs room for the full provender order.".to_string());
    }
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
        refund_market_gold(ctx, owner, total_charge, payer, residence, paid_from_market);
        return Ok(false);
    }
    credit_household_import_duty(ctx, &mut dispatch_building, import_duty);
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
        .ok_or_else(|| "Trading Post not found.".to_string())?;
    validate_order_marketplace(ctx, tick, &building, owner)?;
    let import_duty = if payer == MarketGoldPayer::Household {
        collectible_household_import_duty(ctx, &building, gold_cost)
    } else {
        0.0
    };
    let total_charge = gold_cost + import_duty;
    if physical_market_orders_enabled(ctx, owner) {
        return order_physical_market_import(
            ctx,
            tick,
            &mut building,
            owner,
            CommodityKind::Water,
            commodity.water_amount,
            gold_cost,
            import_duty,
            WATER_DELIVERY_SPEED_MPS,
            WATER_DELIVERY_UNLOAD_SEC,
            payer,
            residence,
            dispatch,
            None,
        );
    }
    let original_building = building.clone();

    let paid_from_market =
        pay_market_gold(ctx, owner, total_charge, payer, residence, &mut building)?;

    let cap = building
        .water_capacity
        .max(building_water_storage_cap(&building.kind));
    let (deposited, updated) = deposit_building_water(&building, cap, commodity.water_amount);
    if deposited + 1e-6 < commodity.water_amount {
        refund_market_gold(ctx, owner, total_charge, payer, residence, paid_from_market);
        return Err("Trading Post needs room for the full water order.".to_string());
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
        refund_market_gold(ctx, owner, total_charge, payer, residence, paid_from_market);
        return Ok(false);
    }
    credit_household_import_duty(ctx, &mut dispatch_building, import_duty);
    ctx.db.building().id().update(dispatch_building);
    Ok(dispatched)
}

#[allow(clippy::too_many_arguments)]
fn order_physical_market_import(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    marketplace: &mut Building,
    owner: spacetimedb::Identity,
    commodity: CommodityKind,
    amount: f64,
    gold_cost: f64,
    import_duty: f64,
    speed_mps: f64,
    unload_seconds: f64,
    payer: MarketGoldPayer,
    residence: Option<&Residence>,
    dispatch: MarketCaravanDispatch,
    regional_trade_resource: Option<TradeResource>,
) -> Result<bool, String> {
    if amount <= 1e-6 || !amount.is_finite() {
        return Ok(false);
    }
    if building_has_regional_market_trip(ctx, marketplace.id) {
        return Err(
            "All regional trader route slots are occupied. Wait for a caravan to complete its round trip."
                .to_string(),
        );
    }
    let network = tick
        .road_network(owner)
        .ok_or_else(|| "Connect the Trading Post to a road before ordering goods.".to_string())?;
    if import_duty > 1e-9
        && building_commodity_room(marketplace, CommodityKind::Gold) + 1e-6 < import_duty
    {
        return Err("Trading Post needs coffer room for the full household import duty.".to_string());
    }

    let named_residence = match dispatch.priority_residence_id {
        Some(residence_id) => {
            if dispatch
                .exact_load_amount
                .is_some_and(|exact| (exact - amount).abs() > 1e-6)
            {
                return Err("The named household order has an invalid load size.".to_string());
            }
            let supplied_residence = residence
                .filter(|candidate| candidate.id == residence_id)
                .ok_or_else(|| "Named household order requires its residence.".to_string())?;
            let current = ctx
                .db
                .residence()
                .id()
                .find(&residence_id)
                .ok_or_else(|| "Household not found.".to_string())?;
            let need_kind = match commodity {
                kind if kind.is_edible() => ResidenceNeedKind::Food,
                CommodityKind::Water => ResidenceNeedKind::Water,
                _ => return Err("Unsupported named regional order.".to_string()),
            };
            if current.owner != owner
                || supplied_residence.owner != owner
                || !need_kind.is_active_for_tier(current.tier)
                || tick.residence_disabled_by_fire(ctx, current.id)
                || (!dispatch.include_abandoned && (current.abandoned || current.population == 0))
            {
                return Err("The named household can no longer receive this order.".to_string());
            }
            let current_stock = need_stock(&load_needs(ctx, current.id), need_kind);
            let room = if commodity.is_edible() {
                residence_commodity_delivery_room(&current, commodity)
            } else {
                delivery_stock_room(need_kind, current_stock)
            };
            if room + 1e-6 < amount {
                return Err("The named household needs room for the full order.".to_string());
            }
            Some(current)
        }
        None => {
            if residence.is_some() {
                return Err("A household order needs an exact destination.".to_string());
            }
            ensure_physical_market_import_room(marketplace, commodity, amount)?;
            None
        }
    };

    let route = match named_residence.as_ref() {
        Some(target) => {
            regional_market_import_route_to_residence(ctx, network, marketplace, target)?
        }
        None => regional_market_import_route(ctx, network, marketplace)?,
    };
    // Payment is performed only after every physical route and destination
    // check succeeds. Reducer transaction rollback still protects the rare
    // insertion failure below.
    let total_charge = gold_cost + import_duty;
    let charged_from_market =
        pay_market_gold(ctx, owner, total_charge, payer, residence, marketplace)?;
    let started = match named_residence.as_ref() {
        Some(target) => start_external_market_import_trip_to_residence(
            ctx,
            tick,
            network,
            marketplace,
            target,
            commodity,
            amount,
            speed_mps,
            unload_seconds,
            route,
        ),
        None => start_external_market_import_trip(
            ctx,
            tick,
            network,
            marketplace,
            commodity,
            amount,
            route,
        ),
    };
    if !started {
        refund_market_gold(
            ctx,
            owner,
            total_charge,
            payer,
            residence,
            charged_from_market,
        );
        return Err(
            "The regional caravan could not enter this Trading Post's road branch.".to_string(),
        );
    }
    credit_household_import_duty(ctx, marketplace, import_duty);
    ctx.db.building().id().update(marketplace.clone());
    if let Some(resource) = regional_trade_resource {
        record_market_trade(ctx, owner, resource, MarketTradeDirection::Import, amount);
    }
    Ok(true)
}

fn physical_market_orders_enabled(ctx: &ReducerContext, owner: spacetimedb::Identity) -> bool {
    ctx.db
        .player_resources()
        .owner()
        .find(&owner)
        .is_some_and(|resources| resources.physical_founding_site_enabled)
}

fn ensure_physical_market_import_room(
    marketplace: &Building,
    commodity: CommodityKind,
    amount: f64,
) -> Result<(), String> {
    let room = match commodity {
        kind if kind.is_edible() => building_commodity_room(marketplace, kind),
        CommodityKind::Water => (marketplace
            .water_capacity
            .max(building_water_storage_cap(&marketplace.kind))
            - marketplace.water)
            .max(0.0),
        _ => 0.0,
    };
    if room + 1e-6 < amount {
        return Err("Trading Post needs room for the full regional order.".to_string());
    }
    Ok(())
}

fn validate_order_marketplace(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    building: &Building,
    owner: spacetimedb::Identity,
) -> Result<(), String> {
    if building.owner != owner || building.kind != "trading_post" {
        return Err("Trading Post not found.".to_string());
    }
    if !building.construction_complete {
        return Err("Complete the Trading Post before ordering goods.".to_string());
    }
    if tick.building_disabled_by_fire(ctx, building.id) {
        return Err("Repair the fire-damaged Trading Post before ordering goods.".to_string());
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
    marketplace: &mut Building,
) -> Result<bool, String> {
    match payer {
        MarketGoldPayer::Treasury => {
            let physical = ctx
                .db
                .player_resources()
                .owner()
                .find(&owner)
                .is_some_and(|resources| resources.physical_founding_site_enabled);
            if physical {
                if marketplace.gold + 1e-6 < gold_cost {
                    return Err(format!(
                        "Trading Post coffer needs {} more gold. Raise its cash reserve or wait for a treasury cart.",
                        (gold_cost - marketplace.gold.max(0.0)).ceil() as i64
                    ));
                }
                marketplace.gold = (marketplace.gold - gold_cost).max(0.0);
                Ok(true)
            } else {
                spend_treasury_gold(ctx, owner, gold_cost)?;
                Ok(false)
            }
        }
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
            Ok(false)
        }
        MarketGoldPayer::Relief => Ok(false),
    }
}

fn refund_market_gold(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    gold_cost: f64,
    payer: MarketGoldPayer,
    residence: Option<&Residence>,
    paid_from_market: bool,
) {
    if paid_from_market {
        return;
    }
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
