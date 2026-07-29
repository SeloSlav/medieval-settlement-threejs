use spacetimedb::ReducerContext;

use crate::building_defs::building_def;
use crate::constants::{
    TICK_DT, WATER_DELIVERY_SPEED_MPS, WATER_DELIVERY_UNLOAD_SEC, WELL_SURGE_AMOUNT_MAX,
    WELL_SURGE_AMOUNT_MIN, WELL_SURGE_CHANCE_PER_TICK, WELL_SURGE_COOLDOWN_SEC,
    WELL_WATER_PER_DELIVERY,
};
use crate::db::*;
use crate::economy::CommodityKind;
use crate::hydrology::sample_hydrology_score;
use crate::roads::RoadNetwork;
use crate::season_policy::EnvironmentState;
use crate::simulation::delivery_cargo::has_delivery_stock_room;
use crate::simulation::delivery_supplier::{
    delivery_work_ready, dispatch_delivery_if_ready, should_alternate_single_worker,
    DeliveryDispatchConfig,
};
use crate::simulation::delivery_trips::{
    building_has_active_trip, building_has_inbound_supply_trip, onsite_building_labor,
    try_start_building_supply_trip,
};
use crate::simulation::expanded_economy::processor_accepts_input;
use crate::simulation::game_calendar::GameClock;
use crate::simulation::labor_and_logistics_paused;
use crate::simulation::residence_needs::{load_needs, need_stock, ResidenceNeedKind};
use crate::simulation::road_logistics::{
    lodge_labor_split, road_path_distance, select_residence_for_need_delivery,
};
use crate::simulation::tick_context::SimTickContext;
use crate::simulation::{
    fire_response_needed_for_well, release_fire_response, reserve_fire_response,
    select_fire_for_well, try_start_fire_response_trip,
};
use crate::tables::{Building, Residence};
use crate::well_policy::{
    industrial_water_input_preference_rank, industrial_water_requirement, industrial_water_target,
    prioritize_fire_response, select_industrial_water_candidate, well_refill_amount,
    well_refill_workers, IndustrialWaterCandidate, INDUSTRIAL_WATER_BUILDING_KINDS,
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
        if let Some(incident) = select_fire_for_well(ctx, tick, network, &well, sim_tick) {
            if reserve_fire_response(ctx, incident.id, well.id) {
                if try_start_fire_response_trip(ctx, tick, network, &mut well, &incident) {
                    return;
                }
                release_fire_response(ctx, incident.target_kind, incident.target_id, well.id);
            }
        }
    }

    let fire_response_needed = fire_response_needed_for_well(ctx, &well, sim_tick);
    if labor_and_logistics_paused(ctx, tick, well.owner, clock) && !fire_response_needed {
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

    let available_labor = onsite_building_labor(ctx, &well);
    let split = lodge_labor_split(available_labor);
    let single_worker = available_labor == 1;
    let delivery_ready = !fire_response_needed
        && delivery_work_ready(split.delivering, well.water > 0.0, well.id, ctx);

    let household_targets = if delivery_ready {
        collect_delivery_targets(ctx, tick, network, &well)
    } else {
        Vec::new()
    };
    let industrial_target = if delivery_ready && household_targets.is_empty() {
        select_industrial_water_target(ctx, tick, network, &well)
    } else {
        None
    };
    let has_target = !household_targets.is_empty() || industrial_target.is_some();
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
        if !household_targets.is_empty() {
            dispatch_delivery_if_ready(
                ctx,
                tick,
                clock,
                network,
                &mut well,
                split.delivering,
                &household_targets,
                DeliveryDispatchConfig {
                    need_kind: ResidenceNeedKind::Water,
                    speed_mps: WATER_DELIVERY_SPEED_MPS,
                    unload_seconds: WATER_DELIVERY_UNLOAD_SEC,
                    per_delivery: WELL_WATER_PER_DELIVERY,
                },
            );
        } else if let Some(target) = industrial_target {
            let needed =
                (industrial_water_target(&target.kind, target.processor_output_target_percent)
                    - target.water)
                    .max(0.0);
            try_start_building_supply_trip(
                ctx,
                tick,
                clock,
                network,
                &mut well,
                &target,
                split.delivering,
                CommodityKind::Water,
                WATER_DELIVERY_SPEED_MPS,
                WATER_DELIVERY_UNLOAD_SEC,
                WELL_WATER_PER_DELIVERY,
                needed,
            );
        }
    }

    ctx.db.building().id().update(well);
}

fn collect_delivery_targets(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    network: &RoadNetwork,
    well: &Building,
) -> Vec<Residence> {
    let residences: Vec<Residence> = ctx
        .db
        .residence()
        .owner()
        .filter(&well.owner)
        .filter(|residence| ResidenceNeedKind::Water.is_active_for_tier(residence.tier))
        .filter(|residence| tick.well_supplier_for(ctx, well.owner, residence.id) == Some(well.id))
        .collect();
    select_residence_for_need_delivery(
        network,
        well,
        residences,
        None,
        None,
        |residence| need_stock(&load_needs(ctx, residence.id), ResidenceNeedKind::Water),
        |_, stock| has_delivery_stock_room(ResidenceNeedKind::Water, stock),
    )
    .into_iter()
    .collect()
}

fn select_industrial_water_target(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    network: &RoadNetwork,
    well: &Building,
) -> Option<Building> {
    let selected = select_industrial_water_candidate(
        tick.building_ids_for_kinds(ctx, well.owner, INDUSTRIAL_WATER_BUILDING_KINDS)
            .into_iter()
            .filter_map(|building_id| ctx.db.building().id().find(&building_id))
            .filter_map(|candidate| {
                let required_per_cycle = industrial_water_requirement(&candidate.kind);
                let desired_stock = industrial_water_target(
                    &candidate.kind,
                    candidate.processor_output_target_percent,
                );
                if required_per_cycle <= 1e-6
                    || desired_stock <= 1e-6
                    || !candidate.construction_complete
                    || candidate.assigned_labor == 0
                    || !processor_accepts_input(&candidate, CommodityKind::Water)
                    || candidate.water + 1e-6 >= desired_stock
                    || building_has_inbound_supply_trip(ctx, candidate.id)
                    || tick.building_disabled_by_fire(ctx, candidate.id)
                {
                    return None;
                }
                if candidate.kind == "weaver" && candidate.flax <= 1e-6 {
                    return None;
                }
                let distance =
                    road_path_distance(network, well.x, well.z, candidate.x, candidate.z)?;
                Some(IndustrialWaterCandidate {
                    building_id: candidate.id,
                    work_priority: candidate.construction_priority,
                    input_preference_rank: industrial_water_input_preference_rank(
                        &candidate.kind,
                        candidate.weaver_input_policy,
                    ),
                    stock_ratio: candidate.water.max(0.0) / desired_stock,
                    distance,
                })
            }),
    )?;
    ctx.db.building().id().find(&selected.building_id)
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
