//! Marketplace caravan deliveries — haul provender and water from the market to homes.

use spacetimedb::ReducerContext;

use crate::balance_generated::{
    BUILDING_ROAD_ACCESS_DISTANCE, FIREWOOD_DELIVERY_SPEED_MPS, FIREWOOD_DELIVERY_UNLOAD_SEC,
    FOOD_DELIVERY_SPEED_MPS, FOOD_DELIVERY_UNLOAD_SEC, MARKET_CARAVAN_DELIVERY_WORKERS,
    MARKET_CARAVAN_FIREWOOD_PER_DELIVERY, MARKET_CARAVAN_LABOR_PER_WORKER,
    SPECIALTY_EXPORT_GOLD_PER_ALE, SPECIALTY_EXPORT_GOLD_PER_CLOTH,
    SPECIALTY_EXPORT_GOLD_PER_HONEY, SPECIALTY_EXPORT_GOLD_PER_WINE, TICK_DT,
    WATER_DELIVERY_SPEED_MPS, WATER_DELIVERY_UNLOAD_SEC,
};
use crate::db::*;
use crate::economy::{
    building_commodity_stock, credit_treasury_gold, record_specialty_market_export,
    try_execute_standing_marketplace_import, withdraw_building_commodity, CommodityKind,
};
use crate::season_policy::EnvironmentState;
use crate::simulation::delivery_cargo::{delivery_stock_room, has_delivery_stock_room};
use crate::simulation::delivery_supplier::{dispatch_delivery_if_ready, DeliveryDispatchConfig};
use crate::simulation::delivery_trips::building_has_active_trip;
use crate::simulation::game_calendar::GameClock;
use crate::simulation::labor_and_logistics_paused;
use crate::simulation::residence_needs::{load_needs, need_stock, ResidenceNeedKind};
use crate::simulation::road_logistics::select_residence_for_need_delivery;
use crate::simulation::tick_context::SimTickContext;
use crate::specialty_trade_policy::{
    specialty_export_capacity, specialty_export_order, specialty_export_policy_allows,
};
use crate::tables::{Building, Residence};

#[derive(Clone, Copy, Debug, Default)]
pub struct MarketCaravanDispatch {
    pub include_abandoned: bool,
    pub priority_residence_id: Option<u64>,
    /// A paid household or relief lot must fit and load in full. Routine
    /// marketplace distribution keeps its worker-scaled carrying capacity.
    pub exact_load_amount: Option<f64>,
}

pub fn marketplace_caravan_workers(building: &Building) -> u32 {
    MARKET_CARAVAN_DELIVERY_WORKERS
        + building
            .assigned_labor
            .saturating_mul(MARKET_CARAVAN_LABOR_PER_WORKER)
}

pub fn try_dispatch_marketplace_caravan(
    ctx: &ReducerContext,
    clock: &GameClock,
    tick: &SimTickContext,
    building: &mut Building,
    need_kind: ResidenceNeedKind,
    per_delivery_amount: f64,
    dispatch: MarketCaravanDispatch,
) -> bool {
    if building.kind != "marketplace" {
        return false;
    }

    let stock = match need_kind {
        ResidenceNeedKind::Firewood => building.firewood,
        ResidenceNeedKind::Food => building.food,
        ResidenceNeedKind::Water => building.water,
        _ => return false,
    };
    if stock <= 1e-6 || building_has_active_trip(ctx, building.id) {
        return false;
    }

    let Some(network) = tick.road_network(building.owner) else {
        return false;
    };

    let residence_is_eligible = |residence: &Residence| {
        if residence.owner != building.owner || !need_kind.is_active_for_tier(residence.tier) {
            return false;
        }
        dispatch.include_abandoned || (!residence.abandoned && residence.population > 0)
    };
    let eligible: Vec<Residence> = match dispatch.priority_residence_id {
        Some(residence_id) => ctx
            .db
            .residence()
            .id()
            .find(&residence_id)
            .filter(residence_is_eligible)
            .into_iter()
            .collect(),
        None => ctx
            .db
            .residence()
            .owner()
            .filter(&building.owner)
            .filter(residence_is_eligible)
            .collect(),
    };
    let targets: Vec<Residence> = select_residence_for_need_delivery(
        network,
        building,
        eligible,
        dispatch.priority_residence_id,
        None,
        |residence| need_stock(&load_needs(ctx, residence.id), need_kind),
        |stock| {
            dispatch.exact_load_amount.map_or_else(
                || has_delivery_stock_room(need_kind, stock),
                |amount| delivery_stock_room(need_kind, stock) + 1e-6 >= amount,
            )
        },
    )
    .into_iter()
    .collect();
    if targets.is_empty() {
        return false;
    }

    let delivery_workers = marketplace_caravan_workers(building);
    let per_worker_amount = match dispatch.exact_load_amount {
        Some(amount) if amount.is_finite() && amount > 1e-6 => {
            amount / delivery_workers.max(1) as f64
        }
        Some(_) => return false,
        None => per_delivery_amount,
    };
    let (speed_mps, unload_seconds) = match need_kind {
        ResidenceNeedKind::Firewood => (FIREWOOD_DELIVERY_SPEED_MPS, FIREWOOD_DELIVERY_UNLOAD_SEC),
        ResidenceNeedKind::Food => (FOOD_DELIVERY_SPEED_MPS, FOOD_DELIVERY_UNLOAD_SEC),
        ResidenceNeedKind::Water => (WATER_DELIVERY_SPEED_MPS, WATER_DELIVERY_UNLOAD_SEC),
        _ => return false,
    };

    dispatch_delivery_if_ready(
        ctx,
        tick,
        clock,
        network,
        building,
        delivery_workers,
        &targets,
        DeliveryDispatchConfig {
            need_kind,
            speed_mps,
            unload_seconds,
            per_delivery: per_worker_amount,
        },
    )
}

pub fn step_marketplace_caravans(
    ctx: &ReducerContext,
    clock: &GameClock,
    tick: &SimTickContext,
    environment: EnvironmentState,
) {
    let marketplace_ids: Vec<u64> = ctx
        .db
        .building()
        .iter()
        .filter(|building| {
            building.kind == "marketplace"
                && building.construction_complete
                && (building.action_cooldown > 1e-6
                    || building.marketplace_seed_grain_target > 0
                    || building.marketplace_ironwork_target > 0
                    || building.firewood > 1e-6
                    || building.food > 1e-6
                    || building.water > 1e-6
                    || building.ale > 1e-6
                    || building.honey > 1e-6
                    || building.wine > 1e-6
                    || building.cloth > 1e-6)
        })
        .map(|building| building.id)
        .collect();

    let dispatch = MarketCaravanDispatch::default();

    for building_id in marketplace_ids {
        if clock.sim_tick % 5 == building_id % 5 {
            try_execute_standing_marketplace_import(
                ctx,
                tick,
                clock,
                building_id,
                environment.road_speed_multiplier(),
            );
        }
        let Some(mut building) = ctx.db.building().id().find(&building_id) else {
            continue;
        };
        let mut changed = false;
        if building.action_cooldown > 1e-6
            && building.assigned_labor > 0
            && !labor_and_logistics_paused(ctx, tick, building.owner, clock)
        {
            building.action_cooldown = (building.action_cooldown - TICK_DT).max(0.0);
            changed = true;
        }
        changed |= sell_marketplace_specialties(ctx, tick, clock, &mut building);
        if building.firewood > 1e-6 {
            changed |= try_dispatch_marketplace_caravan(
                ctx,
                clock,
                tick,
                &mut building,
                ResidenceNeedKind::Firewood,
                MARKET_CARAVAN_FIREWOOD_PER_DELIVERY,
                dispatch,
            );
        }
        if !building_has_active_trip(ctx, building.id) && building.food > 1e-6 {
            changed |= try_dispatch_marketplace_caravan(
                ctx,
                clock,
                tick,
                &mut building,
                ResidenceNeedKind::Food,
                crate::balance_generated::MARKET_CARAVAN_FOOD_PER_DELIVERY,
                dispatch,
            );
        }
        if !building_has_active_trip(ctx, building.id) && building.water > 1e-6 {
            changed |= try_dispatch_marketplace_caravan(
                ctx,
                clock,
                tick,
                &mut building,
                ResidenceNeedKind::Water,
                crate::balance_generated::MARKET_CARAVAN_WATER_PER_DELIVERY,
                dispatch,
            );
        }
        if changed {
            ctx.db.building().id().update(building);
        }
    }
}

fn sell_marketplace_specialties(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    building: &mut Building,
) -> bool {
    if building.assigned_labor == 0
        || labor_and_logistics_paused(ctx, tick, building.owner, clock)
        || (building.ale <= 1e-6
            && building.honey <= 1e-6
            && building.wine <= 1e-6
            && building.cloth <= 1e-6)
    {
        return false;
    }
    let market_rate = ctx
        .db
        .market_state()
        .owner()
        .find(&building.owner)
        .map(|state| state.specialty_price_mult)
        .unwrap_or(1.0);
    if !specialty_export_policy_allows(building.marketplace_specialty_export_policy, market_rate) {
        return false;
    }
    let Some(network) = tick.road_network(building.owner) else {
        return false;
    };
    if network.nearest_distance(building.x, building.z) > BUILDING_ROAD_ACCESS_DISTANCE {
        return false;
    }

    let mut remaining =
        specialty_export_capacity(building.assigned_labor, building.action_cooldown, TICK_DT);
    if remaining <= 1e-6 {
        return false;
    }
    let specialties = [
        (CommodityKind::Ale, SPECIALTY_EXPORT_GOLD_PER_ALE),
        (CommodityKind::Honey, SPECIALTY_EXPORT_GOLD_PER_HONEY),
        (CommodityKind::Wine, SPECIALTY_EXPORT_GOLD_PER_WINE),
        (CommodityKind::Cloth, SPECIALTY_EXPORT_GOLD_PER_CLOTH),
    ];
    let mut revenue = 0.0;
    let mut units_sold = 0.0;
    for index in specialty_export_order(clock.sim_tick) {
        let (commodity, gold_per_unit) = specialties[index];
        let available = building_commodity_stock(building, commodity);
        let sold = withdraw_building_commodity(building, commodity, available.min(remaining));
        revenue += sold * gold_per_unit * market_rate;
        units_sold += sold;
        remaining -= sold;
        if remaining <= 1e-6 {
            break;
        }
    }
    credit_treasury_gold(ctx, building.owner, revenue);
    record_specialty_market_export(ctx, building.owner, units_sold);
    revenue > 1e-6
}
