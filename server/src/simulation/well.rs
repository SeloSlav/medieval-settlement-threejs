use spacetimedb::ReducerContext;

use crate::building_defs::building_def;
use crate::constants::{
    TICK_DT, WATER_DELIVERY_SPEED_MPS, WATER_DELIVERY_UNLOAD_SEC, WELL_SURGE_AMOUNT_MAX,
    WELL_SURGE_AMOUNT_MIN, WELL_SURGE_CHANCE_PER_TICK, WELL_SURGE_COOLDOWN_SEC,
    WELL_WATER_PER_DELIVERY,
};
use crate::db::*;
use crate::hydrology::sample_hydrology_score;
use crate::roads::RoadNetwork;
use crate::season_policy::EnvironmentState;
use crate::simulation::delivery_cargo::{
    any_target_needs_delivery, collect_claimed_delivery_targets,
};
use crate::simulation::delivery_supplier::{
    delivery_work_ready, dispatch_delivery_if_ready, should_alternate_single_worker,
    DeliveryDispatchConfig,
};
use crate::simulation::delivery_trips::building_has_active_trip;
use crate::simulation::game_calendar::GameClock;
use crate::simulation::labor_and_logistics_paused;
use crate::simulation::residence_needs::{load_needs, need_stock, ResidenceNeedKind};
use crate::simulation::road_logistics::{
    claim_residences_for_wells, lodge_labor_split, owner_wells, sort_residences_for_water_delivery,
};
use crate::simulation::tick_context::SimTickContext;
use crate::simulation::{
    fire_response_needed_for_well, release_fire_response, reserve_fire_response,
    select_fire_for_well, try_start_fire_response_trip,
};
use crate::tables::{Building, Residence};
use crate::well_policy::{
    prioritize_fire_response, well_refill_amount, well_refill_workers,
};

pub fn step_well(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    sim_tick: u64,
    clock: &GameClock,
    environment: EnvironmentState,
    building: Building,
) {
    let Some(def) = building_def(&building.kind) else {
        return;
    };

    let Some(network) = tick.road_network(building.owner) else {
        ctx.db.building().id().update(Building {
            action_cooldown: (building.action_cooldown - TICK_DT).max(0.0),
            ..building
        });
        return;
    };

    let mut well = building;
    if !building_has_active_trip(ctx, well.id) {
        if let Some(incident) = select_fire_for_well(ctx, network, &well) {
            if reserve_fire_response(ctx, incident.id, well.id) {
                if try_start_fire_response_trip(ctx, network, &mut well, &incident) {
                    return;
                }
                release_fire_response(ctx, incident.target_kind, incident.target_id, well.id);
            }
        }
    }

    let fire_response_needed = fire_response_needed_for_well(ctx, &well);
    if labor_and_logistics_paused(ctx, well.owner, clock) && !fire_response_needed {
        return;
    }

    let hydrology = sample_hydrology_score(well.x, well.z);
    let capacity = if well.water_capacity > 0.0 {
        well.water_capacity
    } else {
        crate::hydrology::well_capacity_from_hydrology(def.storage_water, hydrology)
    };

    well.water_capacity = capacity;
    well.action_cooldown = (well.action_cooldown - TICK_DT).max(0.0);

    let workers_away = ctx
        .db
        .delivery_trip()
        .building_id()
        .filter(&well.id)
        .next()
        .map(|trip| trip.delivery_workers.min(well.assigned_labor))
        .unwrap_or(0);
    let available_labor = well.assigned_labor.saturating_sub(workers_away);
    let split = lodge_labor_split(available_labor);
    let single_worker = available_labor == 1;
    let delivery_ready = !fire_response_needed
        && delivery_work_ready(split.delivering, well.water > 0.0, well.id, ctx);

    let delivery_targets = if delivery_ready {
        collect_delivery_targets(ctx, network, &well)
    } else {
        Vec::new()
    };
    let has_target = any_target_needs_delivery(ctx, &delivery_targets, ResidenceNeedKind::Water);
    let delivery_ready = delivery_ready && has_target;
    let refill_workers = well_refill_workers(available_labor, has_target);
    let refill_ready = refill_workers > 0;

    let (do_deliver, do_refill) = prioritize_fire_response(
        fire_response_needed,
        refill_ready,
        should_alternate_single_worker(single_worker, refill_ready, delivery_ready, has_target),
    );

    if do_refill {
        well.water = (well.water
            + well_refill_amount(
                hydrology,
                refill_workers,
                environment.well_refill_multiplier(),
                TICK_DT,
            ))
        .min(capacity);

        if well.action_cooldown <= 0.0 && should_surge(well.id, sim_tick, hydrology) {
            let surge = lerp(WELL_SURGE_AMOUNT_MIN, WELL_SURGE_AMOUNT_MAX, hydrology);
            well.water = (well.water + surge).min(capacity);
            well.action_cooldown = WELL_SURGE_COOLDOWN_SEC;
        }
    }

    if do_deliver {
        dispatch_delivery_if_ready(
            ctx,
            clock,
            network,
            &mut well,
            split.delivering,
            &delivery_targets,
            DeliveryDispatchConfig {
                need_kind: ResidenceNeedKind::Water,
                speed_mps: WATER_DELIVERY_SPEED_MPS,
                unload_seconds: WATER_DELIVERY_UNLOAD_SEC,
                per_delivery: WELL_WATER_PER_DELIVERY,
            },
        );
    }

    ctx.db.building().id().update(well);
}

pub fn residence_has_well_supply(
    tick: &SimTickContext,
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    residence: &Residence,
) -> bool {
    let Some(network) = tick.road_network(owner) else {
        return false;
    };
    let wells = owner_wells(ctx, owner);
    let claims = claim_residences_for_wells(network, &wells, std::slice::from_ref(residence));
    claims.contains_key(&residence.id)
}

fn collect_delivery_targets(
    ctx: &ReducerContext,
    network: &RoadNetwork,
    well: &Building,
) -> Vec<Residence> {
    let wells = owner_wells(ctx, well.owner);
    let residences: Vec<Residence> = ctx
        .db
        .residence()
        .owner()
        .filter(&well.owner)
        .filter(|residence| ResidenceNeedKind::Water.is_active_for_tier(residence.tier))
        .collect();
    let claims = claim_residences_for_wells(network, &wells, &residences);

    collect_claimed_delivery_targets(residences, &claims, well.id, |targets| {
        sort_residences_for_water_delivery(network, well, targets, |residence| {
            need_stock(&load_needs(ctx, residence.id), ResidenceNeedKind::Water)
        });
    })
}

fn should_surge(building_id: u64, sim_tick: u64, hydrology: f64) -> bool {
    if hydrology <= 0.05 {
        return false;
    }
    let hash = building_id
        .wrapping_mul(0x9E37_79B9_7F4A_7C15)
        .wrapping_add(sim_tick.wrapping_mul(0x517c_c1b7_2722_0a95));
    let roll = (hash % 10_000) as f64 / 10_000.0;
    roll < WELL_SURGE_CHANCE_PER_TICK * hydrology
}

fn lerp(min: f64, max: f64, t: f64) -> f64 {
    min + (max - min) * t.clamp(0.0, 1.0)
}
