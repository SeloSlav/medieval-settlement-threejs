//! Household auto-orders from marketplace when provender or water runway is critical.

use std::collections::HashMap;

use spacetimedb::ReducerContext;

use crate::balance_generated::{
    all_market_food_commodities, all_market_water_commodities, CALENDAR_SECONDS_PER_DAY,
    HOUSEHOLD_AUTO_BUY_COOLDOWN_TICKS, HOUSEHOLD_AUTO_BUY_RUNWAY_DAYS,
};
use crate::db::*;
use crate::economy::{
    best_affordable_food_commodity, best_affordable_water_commodity, ensure_market_state,
    order_food_commodity, order_water_commodity, scaled_gold_cost, MarketGoldPayer,
};
use crate::simulation::game_calendar::GameClock;
use crate::simulation::labor_and_logistics_paused;
use crate::simulation::marketplace_caravan::MarketCaravanDispatch;
use crate::simulation::residence_needs::{load_needs, need_stock, ResidenceNeedKind};
use crate::simulation::road_logistics::{
    residence_food_runway_seconds, residence_water_runway_seconds,
};
use crate::simulation::tick_context::SimTickContext;
use crate::tables::Building;

pub fn step_household_market_orders(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    sim_tick: u64,
) {
    let marketplaces: Vec<Building> = ctx
        .db
        .building()
        .iter()
        .filter(|building| {
            building.kind == "trading_post"
                && building.construction_complete
                && building.assigned_labor > 0
                && !tick.building_disabled_by_fire(ctx, building.id)
        })
        .collect();

    if marketplaces.is_empty() {
        return;
    }

    let owners: Vec<spacetimedb::Identity> = ctx
        .db
        .player_resources()
        .iter()
        .map(|row| row.owner)
        .collect();

    for owner in owners {
        ensure_market_state(ctx, owner);
        if labor_and_logistics_paused(ctx, tick, owner, clock) {
            continue;
        }

        let owner_marketplaces: Vec<Building> = marketplaces
            .iter()
            .filter(|building| building.owner == owner)
            .cloned()
            .collect();
        if owner_marketplaces.is_empty() {
            continue;
        }
        let import_duty_rate = ctx
            .db
            .player_resources()
            .owner()
            .find(&owner)
            .map(|resources| crate::fiscal_policy::clamp_import_duty_rate(resources.import_duty_rate))
            .unwrap_or(0.0);

        let residences: Vec<_> = ctx
            .db
            .residence()
            .owner()
            .filter(&owner)
            .filter(|residence| {
                !residence.abandoned
                    && residence.population > 0
                    && residence.household_wealth > 1e-9
                    && !tick.residence_disabled_by_fire(ctx, residence.id)
                    && sim_tick.saturating_sub(residence.last_household_market_tick)
                        >= HOUSEHOLD_AUTO_BUY_COOLDOWN_TICKS
            })
            .collect();
        if residences.is_empty() {
            continue;
        }

        let marketplaces_by_id: HashMap<u64, &Building> = owner_marketplaces
            .iter()
            .map(|marketplace| (marketplace.id, marketplace))
            .collect();

        for residence in residences {
            let Some(marketplace) = tick
                .marketplace_for_residence(ctx, owner, residence.id)
                .and_then(|marketplace_id| marketplaces_by_id.get(&marketplace_id))
            else {
                continue;
            };

            let needs = load_needs(ctx, residence.id);
            let food_stock = need_stock(&needs, ResidenceNeedKind::Food);
            let water_stock = need_stock(&needs, ResidenceNeedKind::Water);
            let food_runway_days =
                residence_food_runway_seconds(&residence, food_stock) / CALENDAR_SECONDS_PER_DAY;
            let water_runway_days =
                residence_water_runway_seconds(&residence, water_stock) / CALENDAR_SECONDS_PER_DAY;

            let food_critical = food_runway_days <= HOUSEHOLD_AUTO_BUY_RUNWAY_DAYS;
            let water_critical = ResidenceNeedKind::Water.is_active_for_tier(residence.tier)
                && water_runway_days <= HOUSEHOLD_AUTO_BUY_RUNWAY_DAYS;
            if !food_critical && !water_critical {
                continue;
            }

            let wealth = residence.household_wealth;
            let Some(market) = ctx.db.market_state().owner().find(&owner) else {
                continue;
            };

            let mut ordered = false;

            if food_critical {
                if let Some(commodity) = best_affordable_food_commodity(
                    all_market_food_commodities(),
                    wealth,
                    market.food_price_mult * (1.0 + import_duty_rate),
                ) {
                    let gold_cost =
                        scaled_gold_cost(commodity.base_gold_cost, market.food_price_mult);
                    if order_food_commodity(
                        ctx,
                        tick,
                        clock,
                        marketplace.id,
                        owner,
                        commodity,
                        gold_cost,
                        MarketGoldPayer::Household,
                        Some(&residence),
                        MarketCaravanDispatch {
                            include_abandoned: false,
                            priority_residence_id: Some(residence.id),
                            exact_load_amount: Some(commodity.food_amount),
                        },
                    ) == Ok(true)
                    {
                        ordered = true;
                    }
                }
            }

            if !ordered && water_critical {
                if let Some(commodity) = best_affordable_water_commodity(
                    all_market_water_commodities(),
                    wealth,
                    market.firewood_price_mult * (1.0 + import_duty_rate),
                ) {
                    let gold_cost =
                        scaled_gold_cost(commodity.base_gold_cost, market.firewood_price_mult);
                    if order_water_commodity(
                        ctx,
                        tick,
                        clock,
                        marketplace.id,
                        owner,
                        commodity,
                        gold_cost,
                        MarketGoldPayer::Household,
                        Some(&residence),
                        MarketCaravanDispatch {
                            include_abandoned: false,
                            priority_residence_id: Some(residence.id),
                            exact_load_amount: Some(commodity.water_amount),
                        },
                    ) == Ok(true)
                    {
                        ordered = true;
                    }
                }
            }

            if ordered {
                if let Some(mut updated) = ctx.db.residence().id().find(&residence.id) {
                    updated.last_household_market_tick = sim_tick;
                    ctx.db.residence().id().update(updated);
                }
            }
        }
    }
}
