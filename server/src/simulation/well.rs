use spacetimedb::ReducerContext;

use crate::balance_generated::CALENDAR_SECONDS_PER_DAY;
use crate::building_defs::building_def;
use crate::constants::{
    TICK_DT, WELL_SURGE_AMOUNT_MAX, WELL_SURGE_AMOUNT_MIN, WELL_SURGE_CHANCE_PER_TICK,
    WELL_SURGE_COOLDOWN_SEC,
};
use crate::construction_priority::CONSTRUCTION_PRIORITY_NORMAL;
use crate::db::*;
use crate::economy::{deposit_building_commodity, CommodityKind};
use crate::hydrology::{drought_groundwater_score, sample_world_well_groundwater_score};
use crate::residence_consumption_policy::daily_household_bill_due;
use crate::resident_welfare_policy::deterministic_unit;
use crate::resource_units::{whole_room, whole_units};
use crate::roads::RoadNetwork;
use crate::season_policy::{EnvironmentState, WeatherKind};
use crate::simulation::delivery_trips::{available_free_haulers, building_has_inbound_supply_trip};
use crate::simulation::expanded_economy::{processor_accepts_input, processor_requests_input};
use crate::simulation::game_calendar::GameClock;
use crate::simulation::road_logistics::local_delivery_distance;
use crate::simulation::tick_context::SimTickContext;
use crate::simulation::{
    distribute_well_water, fire_response_needed_for_well, release_fire_response,
    reserve_fire_response, select_fire_for_well, try_start_fire_response_trip,
};
use crate::tables::Building;
use crate::well_policy::{
    industrial_water_input_preference_rank, industrial_water_requirement, industrial_water_target,
    position_within_well_service_radius, select_industrial_water_candidate, well_refill_amount,
    IndustrialWaterCandidate, INDUSTRIAL_WATER_BUILDING_KINDS,
};

pub fn step_well(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    sim_tick: u64,
    world_seed: u64,
    world_hydrology: u8,
    well_aquifer_networks_enabled: bool,
    clock: &GameClock,
    environment: EnvironmentState,
    building: Building,
) {
    let Some(def) = building_def(&building.kind) else {
        return;
    };

    let mut well = building;
    // Compatibility for saves created while wells exposed worker slots.
    well.assigned_labor = 0;
    let base_hydrology = sample_world_well_groundwater_score(
        well.x,
        well.z,
        world_seed,
        world_hydrology,
        well_aquifer_networks_enabled,
    );
    let hydrology = if environment.weather == WeatherKind::Drought {
        drought_groundwater_score(base_hydrology)
    } else {
        base_hydrology
    };
    let capacity = whole_units(crate::hydrology::well_capacity_from_hydrology(
        def.storage_water,
        base_hydrology,
    ));

    well.water_capacity = capacity;
    well.water = whole_units(well.water).min(capacity);
    well.action_cooldown = (well.action_cooldown - TICK_DT).max(0.0);

    // A completed well is infrastructure, not a workplace. Groundwater
    // accumulates in one whole-unit daily draw, then supplies nearby connected
    // consumers directly without creating routine water-carrier agents. The
    // deterministic remainder roll preserves a fractional expected daily
    // yield without ever persisting a fractional bucket.
    if daily_household_bill_due(clock) {
        let expected_refill = well_refill_amount(
            hydrology,
            environment.well_refill_multiplier(),
            CALENDAR_SECONDS_PER_DAY,
        );
        let refill = rounded_expected_units(
            expected_refill,
            deterministic_unit(world_seed, clock.total_days, well.id, 0x5745_4C4C_5245_4649),
        )
        .min(whole_room(capacity, well.water));
        well.water += refill;

        if well.action_cooldown <= 0.0
            && should_surge(world_seed, well.id, clock.total_days, hydrology)
        {
            let surge = rounded_expected_units(
                lerp(WELL_SURGE_AMOUNT_MIN, WELL_SURGE_AMOUNT_MAX, hydrology),
                deterministic_unit(world_seed, clock.total_days, well.id, 0x5745_4C4C_5355_5247),
            )
            .min(whole_room(capacity, well.water));
            well.water += surge;
            well.action_cooldown = WELL_SURGE_COOLDOWN_SEC;
        }
    }

    let Some(network) = tick.road_network(well.owner) else {
        ctx.db.building().id().update(well);
        return;
    };

    // Fire response gets first claim on newly drawn water. Persist the refill
    // before selection because nearest-well eligibility reads the indexed
    // building rows, then launch as many independently staffed bucket trips as
    // the incident demand, stored water, and free labor pool can support.
    ctx.db.building().id().update(well.clone());
    let fire_response_needed = fire_response_needed_for_well(ctx, &well, sim_tick);
    if fire_response_needed {
        while available_free_haulers(ctx, well.owner) > 0 {
            let Some(incident) = select_fire_for_well(ctx, tick, network, &well, sim_tick) else {
                break;
            };
            if !reserve_fire_response(ctx, incident.id, well.id) {
                break;
            }
            if !try_start_fire_response_trip(ctx, tick, network, &mut well, &incident) {
                release_fire_response(ctx, incident.target_kind, incident.target_id, well.id);
                break;
            }
        }

        // Household and industrial draws wait until the emergency is over.
        // In particular, a dry well now accumulates a usable partial bucket
        // instead of having every sub-bucket refill consumed immediately.
        ctx.db.building().id().update(well);
        return;
    }

    // Domestic water has first claim. Nearby road-connected workshops then
    // fill their real input buffers from the remainder. Both transfers drain
    // this well and neither reserves a free hauler or creates a delivery trip.
    distribute_well_water(ctx, tick, &mut well);
    distribute_industrial_water(ctx, tick, network, &mut well);

    ctx.db.building().id().update(well);
}

fn distribute_industrial_water(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    network: &RoadNetwork,
    well: &mut Building,
) {
    while well.water > 1e-9 {
        let Some(mut target) = select_industrial_water_target(ctx, tick, network, well) else {
            break;
        };
        let needed =
            (industrial_water_target(&target.kind, target.processor_output_target_percent)
                - target.water)
                .max(0.0);
        let supplied =
            deposit_building_commodity(&mut target, CommodityKind::Water, needed.min(well.water));
        if supplied <= 1e-9 {
            break;
        }
        well.water = (well.water - supplied).max(0.0);
        ctx.db.building().id().update(target);
    }
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
                    || !processor_requests_input(&candidate, CommodityKind::Water)
                    || !processor_accepts_input(&candidate, CommodityKind::Water)
                    || candidate.water + 1e-6 >= desired_stock
                    || building_has_inbound_supply_trip(ctx, candidate.id)
                    || tick.building_disabled_by_fire(ctx, candidate.id)
                {
                    return None;
                }
                if candidate.kind == "spinning_retting_house" && candidate.flax <= 1e-6 {
                    return None;
                }
                if !position_within_well_service_radius(
                    well.x,
                    well.z,
                    well.work_radius,
                    candidate.x,
                    candidate.z,
                ) {
                    return None;
                }
                let distance =
                    local_delivery_distance(network, well.x, well.z, candidate.x, candidate.z)?;
                Some(IndustrialWaterCandidate {
                    building_id: candidate.id,
                    work_priority: CONSTRUCTION_PRIORITY_NORMAL,
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

fn should_surge(world_seed: u64, building_id: u64, total_days: u64, hydrology: f64) -> bool {
    if hydrology <= 0.05 {
        return false;
    }
    let ticks_per_day = (CALENDAR_SECONDS_PER_DAY / TICK_DT).round().max(1.0);
    let chance_per_tick = (WELL_SURGE_CHANCE_PER_TICK * hydrology).clamp(0.0, 1.0);
    let chance_per_day = 1.0 - (1.0 - chance_per_tick).powf(ticks_per_day);
    deterministic_unit(world_seed, total_days, building_id, 0x5745_4C4C_4348_414E) < chance_per_day
}

fn lerp(min: f64, max: f64, t: f64) -> f64 {
    min + (max - min) * t.clamp(0.0, 1.0)
}

fn rounded_expected_units(expected: f64, roll: f64) -> f64 {
    if !expected.is_finite() || expected <= 0.0 {
        return 0.0;
    }
    let base = expected.floor();
    whole_units(base + f64::from(roll < expected - base))
}

#[cfg(test)]
mod tests {
    use super::rounded_expected_units;

    #[test]
    fn expected_well_yield_is_always_a_whole_bucket() {
        assert_eq!(rounded_expected_units(3.25, 0.24), 4.0);
        assert_eq!(rounded_expected_units(3.25, 0.25), 3.0);
        assert_eq!(rounded_expected_units(0.75, 0.74), 1.0);
        assert_eq!(rounded_expected_units(0.75, 0.75), 0.0);
    }
}
