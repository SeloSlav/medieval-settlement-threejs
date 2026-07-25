//! Marketplace caravan deliveries — haul provender and water from the market to homes.

use spacetimedb::ReducerContext;

use crate::balance_generated::{
    FOOD_DELIVERY_SPEED_MPS, FOOD_DELIVERY_UNLOAD_SEC, MARKET_CARAVAN_DELIVERY_WORKERS,
    MARKET_CARAVAN_LABOR_PER_WORKER, WATER_DELIVERY_SPEED_MPS, WATER_DELIVERY_UNLOAD_SEC,
};
use crate::db::*;
use crate::simulation::delivery_cargo::any_target_needs_delivery;
use crate::simulation::delivery_supplier::{dispatch_delivery_if_ready, DeliveryDispatchConfig};
use crate::simulation::delivery_trips::building_has_active_trip;
use crate::simulation::game_calendar::GameClock;
use crate::simulation::residence_needs::{load_needs, need_stock, ResidenceNeedKind};
use crate::simulation::road_logistics::{
    sort_residences_for_food_delivery, sort_residences_for_water_delivery,
};
use crate::simulation::tick_context::SimTickContext;
use crate::tables::{Building, Residence};

#[derive(Clone, Copy, Debug, Default)]
pub struct MarketCaravanDispatch {
    pub include_abandoned: bool,
    pub priority_residence_id: Option<u64>,
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

    let mut targets: Vec<Residence> = ctx
        .db
        .residence()
        .owner()
        .filter(&building.owner)
        .filter(|residence| {
            if !need_kind.is_active_for_tier(residence.tier) {
                return false;
            }
            if dispatch.include_abandoned {
                return true;
            }
            !residence.abandoned && residence.population > 0
        })
        .collect();

    if let Some(priority_id) = dispatch.priority_residence_id {
        if let Some(index) = targets
            .iter()
            .position(|residence| residence.id == priority_id)
        {
            let priority = targets.remove(index);
            targets.insert(0, priority);
        }
    }

    if targets.is_empty() {
        return false;
    }

    match need_kind {
        ResidenceNeedKind::Food => {
            sort_residences_for_food_delivery(network, building, &mut targets, |residence| {
                let needs = load_needs(ctx, residence.id);
                need_stock(&needs, ResidenceNeedKind::Food)
            });
        }
        ResidenceNeedKind::Water => {
            sort_residences_for_water_delivery(network, building, &mut targets, |residence| {
                let needs = load_needs(ctx, residence.id);
                need_stock(&needs, ResidenceNeedKind::Water)
            });
        }
        _ => return false,
    }

    if !any_target_needs_delivery(ctx, &targets, need_kind) {
        return false;
    }

    let delivery_workers = marketplace_caravan_workers(building);
    let (speed_mps, unload_seconds) = match need_kind {
        ResidenceNeedKind::Food => (FOOD_DELIVERY_SPEED_MPS, FOOD_DELIVERY_UNLOAD_SEC),
        ResidenceNeedKind::Water => (WATER_DELIVERY_SPEED_MPS, WATER_DELIVERY_UNLOAD_SEC),
        _ => return false,
    };

    dispatch_delivery_if_ready(
        ctx,
        clock,
        network,
        building,
        delivery_workers,
        &targets,
        DeliveryDispatchConfig {
            need_kind,
            speed_mps,
            unload_seconds,
            per_delivery: per_delivery_amount,
        },
    )
}

pub fn step_marketplace_caravans(ctx: &ReducerContext, clock: &GameClock, tick: &SimTickContext) {
    let marketplace_ids: Vec<u64> = ctx
        .db
        .building()
        .iter()
        .filter(|building| {
            building.kind == "marketplace"
                && building.construction_complete
                && (building.food > 1e-6 || building.water > 1e-6)
        })
        .map(|building| building.id)
        .collect();

    let dispatch = MarketCaravanDispatch::default();

    for building_id in marketplace_ids {
        let Some(mut building) = ctx.db.building().id().find(&building_id) else {
            continue;
        };
        let mut changed = false;
        if building.food > 1e-6 {
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
