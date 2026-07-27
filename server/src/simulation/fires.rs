//! Structural fires, deterministic ignition/spread, and well response coordination.

use std::collections::HashSet;

use spacetimedb::{Identity, ReducerContext};

use crate::balance_generated::{
    CALENDAR_SECONDS_PER_DAY, FIRE_ACCIDENT_IGNITION_CHANCE_PER_STRUCTURE_DAY,
    FIRE_INITIAL_INTENSITY, FIRE_LIGHTNING_IGNITION_CHANCE_PER_RAIN_DAY,
    FIRE_SPREAD_CHANCE_PER_SECOND, FIRE_SPREAD_RADIUS, TICK_DT,
};
use crate::db::*;
use crate::economy::reconcile_building_labor;
use crate::fire_policy::{
    accumulated_event_chance, distance_spread_factor, fire_response_load, step_fire,
    suppression_result, weather_risk_multiplier,
};
use crate::residence_upgrade_policy::residence_project_active;
use crate::roads::RoadNetwork;
use crate::season_policy::{EnvironmentState, WeatherKind};
use crate::simulation::game_calendar::GameClock;
use crate::simulation::tick_context::SimTickContext;
use crate::simulation::{
    cancel_trips_for_residence, clear_backyard_garden_for_residence, clear_residence_needs,
    clear_residence_project, drain_trips_for_building,
};
use crate::tables::{Building, FireIncident};

pub const FIRE_TARGET_BUILDING: u8 = 0;
pub const FIRE_TARGET_RESIDENCE: u8 = 1;
pub const FIRE_STATE_BURNING: u8 = 0;
pub const FIRE_STATE_EXTINGUISHED: u8 = 1;
pub const FIRE_STATE_DESTROYED: u8 = 2;
pub const FIRE_SOURCE_LIGHTNING: u8 = 0;
pub const FIRE_SOURCE_ACCIDENT: u8 = 1;
pub const FIRE_SOURCE_SPREAD: u8 = 2;
pub const FIRE_SOURCE_RAID: u8 = 3;

/// Idle settlements evaluate new ignition once per simulated second rather
/// than scanning every structure five times. Active fire progression and
/// spread remain on the normal 0.2-second simulation step.
const FIRE_IGNITION_CHECK_INTERVAL_TICKS: u64 = 5;

#[derive(Clone)]
struct FireCandidate {
    owner: Identity,
    target_kind: u8,
    target_id: u64,
    x: f64,
    z: f64,
    flammability: f64,
    required_water: f64,
}

pub fn step_fires(
    ctx: &ReducerContext,
    clock: &GameClock,
    environment: EnvironmentState,
    world_seed: u64,
    sim_tick: u64,
) {
    let active: Vec<FireIncident> = ctx
        .db
        .fire_incident()
        .iter()
        .filter(|incident| incident.state == FIRE_STATE_BURNING)
        .collect();
    let mut active_after_step = Vec::with_capacity(active.len());
    for mut incident in active {
        let next = step_fire(
            incident.intensity,
            incident.damage,
            TICK_DT,
            environment.weather == WeatherKind::Rain,
            environment.weather == WeatherKind::Drought,
        );
        incident.intensity = next.intensity;
        incident.damage = next.damage;
        if incident.damage >= 1.0 {
            destroy_target(ctx, &incident);
            incident.state = FIRE_STATE_DESTROYED;
            incident.intensity = 0.08;
            incident.damage = 1.0;
            incident.resolved_tick = sim_tick;
            incident.response_well_id = 0;
        }
        let still_burning = incident.state == FIRE_STATE_BURNING;
        ctx.db.fire_incident().id().update(incident.clone());
        if still_burning {
            active_after_step.push(incident);
        }
    }

    let ignition_due = sim_tick % FIRE_IGNITION_CHECK_INTERVAL_TICKS == 0;
    if active_after_step.is_empty() && !ignition_due {
        return;
    }

    let mut occupied_targets: HashSet<(u8, u64)> = ctx
        .db
        .fire_incident()
        .iter()
        .map(|incident| (incident.target_kind, incident.target_id))
        .collect();
    let candidates = collect_candidates(ctx, &occupied_targets);
    if ignition_due {
        maybe_ignite_from_lightning(
            ctx,
            &candidates,
            environment,
            world_seed,
            sim_tick,
            &mut occupied_targets,
            &mut active_after_step,
        );
        maybe_ignite_from_accidents(
            ctx,
            &candidates,
            environment,
            world_seed,
            sim_tick,
            &mut occupied_targets,
            &mut active_after_step,
        );
    }
    maybe_spread_fires(
        ctx,
        &candidates,
        environment,
        world_seed,
        sim_tick,
        &mut occupied_targets,
        &active_after_step,
    );

    let _ = clock;
}

pub fn building_fire_state(ctx: &ReducerContext, building_id: u64) -> Option<u8> {
    fire_for_target(ctx, FIRE_TARGET_BUILDING, building_id).map(|incident| incident.state)
}

pub fn residence_fire_state(ctx: &ReducerContext, residence_id: u64) -> Option<u8> {
    fire_for_target(ctx, FIRE_TARGET_RESIDENCE, residence_id).map(|incident| incident.state)
}

pub fn clear_fire_for_target(ctx: &ReducerContext, target_kind: u8, target_id: u64) {
    let incidents: Vec<FireIncident> = ctx
        .db
        .fire_incident()
        .target_id()
        .filter(&target_id)
        .filter(|incident| incident.target_kind == target_kind)
        .collect();
    for incident in incidents {
        ctx.db.fire_incident().id().delete(incident.id);
    }
}

/// Starts at most one indexed fire on a holding reached by a hostile raid.
/// Ordinary fire progression, wells, spreading, damage and reconstruction take
/// over after insertion, so raids do not need a parallel damage system.
pub fn ignite_raid_target(
    ctx: &ReducerContext,
    owner: Identity,
    target_kind: u8,
    target_id: u64,
    sim_tick: u64,
) -> bool {
    if fire_for_target(ctx, target_kind, target_id).is_some() {
        return false;
    }
    let candidate = match target_kind {
        FIRE_TARGET_BUILDING => {
            let Some(building) = ctx.db.building().id().find(&target_id) else {
                return false;
            };
            let flammability = building_flammability(&building);
            if building.owner != owner || !building.construction_complete || flammability <= 0.0 {
                return false;
            }
            FireCandidate {
                owner,
                target_kind,
                target_id,
                x: building.x,
                z: building.z,
                flammability,
                required_water: (7.0 + flammability * 2.0).clamp(6.0, 13.0),
            }
        }
        FIRE_TARGET_RESIDENCE => {
            let Some(residence) = ctx.db.residence().id().find(&target_id) else {
                return false;
            };
            if residence.owner != owner || residence.abandoned || residence.population == 0 {
                return false;
            }
            FireCandidate {
                owner,
                target_kind,
                target_id,
                x: residence.x,
                z: residence.z,
                flammability: 0.9 + residence.tier as f64 * 0.12,
                required_water: 5.0 + residence.tier as f64,
            }
        }
        _ => return false,
    };
    let mut occupied_targets = HashSet::new();
    ignite_candidate(
        ctx,
        &candidate,
        FIRE_SOURCE_RAID,
        sim_tick,
        &mut occupied_targets,
    )
    .is_some()
}

pub fn select_fire_for_well(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    network: &RoadNetwork,
    well: &Building,
) -> Option<FireIncident> {
    if well.kind != "well"
        || !well.construction_complete
        || well.assigned_labor == 0
        || fire_response_load(well.water) <= 0.0
        || well.work_radius <= 0.0
    {
        return None;
    }

    ctx.db
        .fire_incident()
        .owner()
        .filter(&well.owner)
        .filter(|incident| {
            incident.state == FIRE_STATE_BURNING
                && incident.response_well_id == 0
                && within_extent(well, incident.x, incident.z)
                && nearest_eligible_well_id(ctx, tick, network, incident) == Some(well.id)
        })
        .map(|incident| {
            let distance = distance(well.x, well.z, incident.x, incident.z);
            (incident, distance)
        })
        .min_by(|(a, distance_a), (b, distance_b)| {
            let urgency_a = a.damage * 1.4 + a.intensity;
            let urgency_b = b.damage * 1.4 + b.intensity;
            urgency_b
                .total_cmp(&urgency_a)
                .then_with(|| distance_a.total_cmp(distance_b))
                .then_with(|| a.id.cmp(&b.id))
        })
        .map(|(incident, _)| incident)
}

pub fn fire_response_needed_for_well(ctx: &ReducerContext, well: &Building) -> bool {
    if well.kind != "well"
        || !well.construction_complete
        || well.assigned_labor == 0
        || well.work_radius <= 0.0
    {
        return false;
    }

    ctx.db
        .fire_incident()
        .owner()
        .filter(&well.owner)
        .any(|incident| {
            incident.state == FIRE_STATE_BURNING
                && (incident.response_well_id == 0 || incident.response_well_id == well.id)
                && within_extent(well, incident.x, incident.z)
        })
}

pub fn reserve_fire_response(ctx: &ReducerContext, incident_id: u64, well_id: u64) -> bool {
    let Some(mut incident) = ctx.db.fire_incident().id().find(&incident_id) else {
        return false;
    };
    if incident.state != FIRE_STATE_BURNING || incident.response_well_id != 0 {
        return false;
    }
    incident.response_well_id = well_id;
    ctx.db.fire_incident().id().update(incident);
    true
}

pub fn release_fire_response(ctx: &ReducerContext, target_kind: u8, target_id: u64, well_id: u64) {
    let Some(mut incident) = fire_for_target(ctx, target_kind, target_id) else {
        return;
    };
    if incident.response_well_id != well_id {
        return;
    }
    incident.response_well_id = 0;
    ctx.db.fire_incident().id().update(incident);
}

pub fn apply_fire_water(
    ctx: &ReducerContext,
    target_kind: u8,
    target_id: u64,
    water: f64,
    sim_tick: u64,
) -> bool {
    let Some(mut incident) = fire_for_target(ctx, target_kind, target_id) else {
        return false;
    };
    if incident.state != FIRE_STATE_BURNING || water <= 1e-6 {
        return false;
    }
    let roll = unit_roll(
        incident
            .id
            .wrapping_mul(0x9e37_79b9_7f4a_7c15)
            .wrapping_add(sim_tick.wrapping_mul(0x517c_c1b7_2722_0a95))
            .wrapping_add(incident.water_delivered.to_bits()),
    );
    let result = suppression_result(incident.intensity, incident.damage, water, roll);
    incident.intensity = result.intensity;
    incident.extinguish_chance = result.extinguish_chance;
    incident.water_delivered += water;
    incident.last_water_tick = sim_tick;
    incident.response_well_id = 0;
    if result.extinguished {
        incident.state = FIRE_STATE_EXTINGUISHED;
        incident.intensity = 0.0;
        incident.resolved_tick = sim_tick;
    }
    ctx.db.fire_incident().id().update(incident);
    true
}

fn collect_candidates(
    ctx: &ReducerContext,
    occupied_targets: &HashSet<(u8, u64)>,
) -> Vec<FireCandidate> {
    let mut candidates = Vec::new();
    for building in ctx.db.building().iter() {
        let flammability = building_flammability(&building);
        if !building.construction_complete
            || flammability <= 0.0
            || occupied_targets.contains(&(FIRE_TARGET_BUILDING, building.id))
        {
            continue;
        }
        candidates.push(FireCandidate {
            owner: building.owner,
            target_kind: FIRE_TARGET_BUILDING,
            target_id: building.id,
            x: building.x,
            z: building.z,
            flammability,
            required_water: (7.0 + flammability * 2.0).clamp(6.0, 13.0),
        });
    }
    for residence in ctx.db.residence().iter() {
        if residence.abandoned
            || residence.population == 0
            || occupied_targets.contains(&(FIRE_TARGET_RESIDENCE, residence.id))
        {
            continue;
        }
        candidates.push(FireCandidate {
            owner: residence.owner,
            target_kind: FIRE_TARGET_RESIDENCE,
            target_id: residence.id,
            x: residence.x,
            z: residence.z,
            flammability: 0.9 + residence.tier as f64 * 0.12,
            required_water: 5.0 + residence.tier as f64,
        });
    }
    candidates
}

fn maybe_ignite_from_lightning(
    ctx: &ReducerContext,
    candidates: &[FireCandidate],
    environment: EnvironmentState,
    world_seed: u64,
    sim_tick: u64,
    occupied_targets: &mut HashSet<(u8, u64)>,
    active: &mut Vec<FireIncident>,
) {
    if environment.weather != WeatherKind::Rain || candidates.is_empty() {
        return;
    }
    let chance = accumulated_event_chance(
        FIRE_LIGHTNING_IGNITION_CHANCE_PER_RAIN_DAY * TICK_DT / CALENDAR_SECONDS_PER_DAY,
        FIRE_IGNITION_CHECK_INTERVAL_TICKS,
    );
    let hash = world_seed
        .wrapping_add(sim_tick.wrapping_mul(0xd6e8_feb8_6659_fd93))
        .wrapping_add(0x4c49_4748_544e_494e);
    if unit_roll(hash) >= chance {
        return;
    }
    let index = (mix64(hash ^ 0xa076_1d64_78bd_642f) as usize) % candidates.len();
    if let Some(incident) = ignite_candidate(
        ctx,
        &candidates[index],
        FIRE_SOURCE_LIGHTNING,
        sim_tick,
        occupied_targets,
    ) {
        active.push(incident);
    }
}

fn maybe_ignite_from_accidents(
    ctx: &ReducerContext,
    candidates: &[FireCandidate],
    environment: EnvironmentState,
    world_seed: u64,
    sim_tick: u64,
    occupied_targets: &mut HashSet<(u8, u64)>,
    active: &mut Vec<FireIncident>,
) {
    let risk = weather_risk_multiplier(
        environment.weather == WeatherKind::Rain,
        environment.weather == WeatherKind::Drought,
    );
    for candidate in candidates {
        let chance = accumulated_event_chance(
            FIRE_ACCIDENT_IGNITION_CHANCE_PER_STRUCTURE_DAY
                * candidate.flammability
                * risk
                * TICK_DT
                / CALENDAR_SECONDS_PER_DAY,
            FIRE_IGNITION_CHECK_INTERVAL_TICKS,
        );
        let hash = world_seed
            .wrapping_add(sim_tick.wrapping_mul(0x94d0_49bb_1331_11eb))
            .wrapping_add(candidate.target_id.wrapping_mul(0xbf58_476d_1ce4_e5b9))
            .wrapping_add(candidate.target_kind as u64);
        if unit_roll(hash) < chance {
            if let Some(incident) = ignite_candidate(
                ctx,
                candidate,
                FIRE_SOURCE_ACCIDENT,
                sim_tick,
                occupied_targets,
            ) {
                active.push(incident);
            }
        }
    }
}

fn maybe_spread_fires(
    ctx: &ReducerContext,
    candidates: &[FireCandidate],
    environment: EnvironmentState,
    world_seed: u64,
    sim_tick: u64,
    occupied_targets: &mut HashSet<(u8, u64)>,
    active: &[FireIncident],
) {
    let risk = weather_risk_multiplier(
        environment.weather == WeatherKind::Rain,
        environment.weather == WeatherKind::Drought,
    );
    for source in active {
        for candidate in candidates {
            if candidate.owner != source.owner
                || occupied_targets.contains(&(candidate.target_kind, candidate.target_id))
            {
                continue;
            }
            let separation = distance(source.x, source.z, candidate.x, candidate.z);
            let falloff = distance_spread_factor(separation, FIRE_SPREAD_RADIUS);
            if falloff <= 0.0 {
                continue;
            }
            let chance = FIRE_SPREAD_CHANCE_PER_SECOND
                * source.intensity
                * candidate.flammability
                * risk
                * falloff
                * TICK_DT;
            let hash = world_seed
                .wrapping_add(sim_tick.wrapping_mul(0x9e37_79b9_7f4a_7c15))
                .wrapping_add(source.id.wrapping_mul(0x94d0_49bb_1331_11eb))
                .wrapping_add(candidate.target_id.wrapping_mul(0xbf58_476d_1ce4_e5b9))
                .wrapping_add(candidate.target_kind as u64);
            if unit_roll(hash) < chance {
                let _ = ignite_candidate(
                    ctx,
                    candidate,
                    FIRE_SOURCE_SPREAD,
                    sim_tick,
                    occupied_targets,
                );
            }
        }
    }
}

fn ignite_candidate(
    ctx: &ReducerContext,
    candidate: &FireCandidate,
    source: u8,
    sim_tick: u64,
    occupied_targets: &mut HashSet<(u8, u64)>,
) -> Option<FireIncident> {
    if !occupied_targets.insert((candidate.target_kind, candidate.target_id)) {
        return None;
    }
    if candidate.target_kind == FIRE_TARGET_RESIDENCE {
        if let Some(mut residence) = ctx.db.residence().id().find(&candidate.target_id) {
            if residence_project_active(
                residence.upgrade_target_tier,
                residence.tier,
                residence.backyard_project_kind,
                residence.fire_repair_active,
            ) {
                // A new fire ends unfinished household works immediately:
                // source reservations are released, carts turn back, onsite
                // material is lost, and the builder returns to the labor pool.
                cancel_trips_for_residence(ctx, residence.id);
                clear_residence_project(&mut residence);
                ctx.db.residence().id().update(residence);
                reconcile_building_labor(ctx, candidate.owner);
            }
        }
    }
    Some(ctx.db.fire_incident().insert(FireIncident {
        id: 0,
        owner: candidate.owner,
        target_kind: candidate.target_kind,
        target_id: candidate.target_id,
        x: candidate.x,
        z: candidate.z,
        ignition_source: source,
        state: FIRE_STATE_BURNING,
        intensity: FIRE_INITIAL_INTENSITY,
        damage: 0.0,
        water_delivered: 0.0,
        required_water: candidate.required_water,
        extinguish_chance: 0.0,
        started_tick: sim_tick,
        last_water_tick: 0,
        resolved_tick: 0,
        response_well_id: 0,
    }))
}

fn fire_for_target(ctx: &ReducerContext, target_kind: u8, target_id: u64) -> Option<FireIncident> {
    ctx.db
        .fire_incident()
        .target_id()
        .filter(&target_id)
        .find(|incident| incident.target_kind == target_kind)
}

fn nearest_eligible_well_id(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    network: &RoadNetwork,
    incident: &FireIncident,
) -> Option<u64> {
    let mut best: Option<(u64, f64)> = None;
    for well in tick
        .building_ids_for_kinds(ctx, incident.owner, &["well"])
        .into_iter()
        .filter_map(|building_id| ctx.db.building().id().find(&building_id))
        .filter(|building| {
            building.kind == "well"
                && building.construction_complete
                && building.assigned_labor > 0
                && fire_response_load(building.water) > 0.0
                && within_extent(building, incident.x, incident.z)
        })
    {
        let road_distance = network
            .road_path_distance(well.x, well.z, incident.x, incident.z)
            .unwrap_or_else(|| distance(well.x, well.z, incident.x, incident.z));
        match best {
            None => best = Some((well.id, road_distance)),
            Some((best_id, best_distance))
                if road_distance + 1e-6 < best_distance
                    || ((road_distance - best_distance).abs() <= 1e-6 && well.id < best_id) =>
            {
                best = Some((well.id, road_distance))
            }
            _ => {}
        }
    }
    best.map(|(id, _)| id)
}

fn building_flammability(building: &Building) -> f64 {
    let base: f64 = match building.kind.as_str() {
        // The Town Hall is this game's manor analogue; Manor Lords makes manors nonflammable.
        "town_hall" | "well" | "marketplace" | "stone_quarry" | "large_quarry" => 0.0,
        "chapel" | "monastery" => 0.32,
        "smokehouse" => 2.2,
        "brewery" | "granary" => 1.45,
        "lumber_mill" | "woodcutters_lodge" | "reforester" | "carpenter" => 1.7,
        "threshing_barn" => 1.65,
        "apiary" | "fishing_camp" | "hunters_hall" | "foragers_shed" => 1.25,
        _ => 1.0,
    };
    if base <= 0.0 {
        return 0.0;
    }
    let stored_fuel = building.firewood + building.timber * 0.35 + building.grain * 0.08;
    base * (1.0 + (stored_fuel / 160.0).clamp(0.0, 0.75))
}

fn destroy_target(ctx: &ReducerContext, incident: &FireIncident) {
    match incident.target_kind {
        FIRE_TARGET_BUILDING => {
            let Some(mut building) = ctx.db.building().id().find(&incident.target_id) else {
                return;
            };
            let _lost_cargo = drain_trips_for_building(ctx, building.id);
            building.assigned_labor = 0;
            building.action_cooldown = 0.0;
            building.timber = 0.0;
            building.firewood = 0.0;
            building.stone = 0.0;
            building.water = 0.0;
            building.food = 0.0;
            building.grain = 0.0;
            building.flour = 0.0;
            building.ale = 0.0;
            building.preserved_food = 0.0;
            building.honey = 0.0;
            building.wine = 0.0;
            building.wool = 0.0;
            building.cloth = 0.0;
            building.gold = 0.0;
            building.civic_receipts_gold = 0.0;
            ctx.db.building().id().update(building);
        }
        FIRE_TARGET_RESIDENCE => {
            let Some(mut residence) = ctx.db.residence().id().find(&incident.target_id) else {
                return;
            };
            let owner = residence.owner;
            cancel_trips_for_residence(ctx, residence.id);
            clear_residence_project(&mut residence);
            clear_residence_needs(ctx, residence.id);
            clear_backyard_garden_for_residence(ctx, residence.id);
            residence.population = 0;
            residence.abandoned = true;
            residence.settlement_ticks = 0;
            ctx.db.residence().id().update(residence);
            reconcile_building_labor(ctx, owner);
        }
        _ => {}
    }
}

fn within_extent(well: &Building, x: f64, z: f64) -> bool {
    distance(well.x, well.z, x, z) <= well.work_radius + 1e-6
}

fn distance(ax: f64, az: f64, bx: f64, bz: f64) -> f64 {
    ((bx - ax).powi(2) + (bz - az).powi(2)).sqrt()
}

fn unit_roll(value: u64) -> f64 {
    (mix64(value) % 1_000_000) as f64 / 1_000_000.0
}

fn mix64(mut value: u64) -> u64 {
    value ^= value >> 30;
    value = value.wrapping_mul(0xbf58_476d_1ce4_e5b9);
    value ^= value >> 27;
    value = value.wrapping_mul(0x94d0_49bb_1331_11eb);
    value ^ (value >> 31)
}
