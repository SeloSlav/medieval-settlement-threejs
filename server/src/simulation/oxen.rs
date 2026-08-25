//! Database adapter for deterministic draft-ox work assignment.

use std::collections::{HashMap, HashSet};

use spacetimedb::{Identity, ReducerContext};

use crate::db::*;
use crate::ox_policy::{
    assign_oxen_to_worksites, available_ox_for_workplace, is_ox_production_workplace,
    is_ox_supported_workplace, OxCandidate, OxWorksiteCandidate,
};
use crate::simulation::{game_clock, production_labor_paused, SimTickContext};
use crate::tables::Building;

use super::delivery_trips::onsite_building_labor;

fn operational_oxen_for_owner(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    owner: Identity,
) -> Vec<OxCandidate> {
    let mut candidates = Vec::new();
    for ox in ctx.db.stable_ox().owner().filter(&owner) {
        let Some(stable) = ctx.db.building().id().find(&ox.stable_id) else {
            continue;
        };
        if stable.owner != owner
            || stable.kind != "stable"
            || !stable.construction_complete
            || tick.building_disabled_by_fire(ctx, stable.id)
        {
            continue;
        }
        candidates.push(OxCandidate {
            ox_id: ox.id,
            stable_id: ox.stable_id,
            stable_slot: ox.slot,
            assigned_building_id: ox.assigned_building_id,
            x: stable.x,
            z: stable.z,
        });
    }
    candidates
}

fn active_trip_ox_ids(ctx: &ReducerContext, owner: Identity) -> HashSet<u64> {
    ctx.db
        .delivery_trip()
        .owner()
        .filter(&owner)
        .filter_map(|trip| (trip.ox_id != 0).then_some(trip.ox_id))
        .collect()
}

fn build_production_assignments(
    ctx: &ReducerContext,
    tick: &SimTickContext,
) -> HashMap<u64, Vec<u64>> {
    let Some(config) = ctx.db.world_config().id().find(&0) else {
        return HashMap::new();
    };
    let clock = game_clock(config.sim_tick);
    let mut oxen_by_owner: HashMap<Identity, Vec<OxCandidate>> = HashMap::new();
    for ox in ctx.db.stable_ox().iter() {
        oxen_by_owner.entry(ox.owner).or_default();
    }

    let mut worksites_by_owner: HashMap<Identity, Vec<OxWorksiteCandidate>> = HashMap::new();
    for building in ctx.db.building().iter() {
        if !is_operational_production_worksite(ctx, tick, &clock, &building) {
            continue;
        }
        let onsite_labor = onsite_building_labor(ctx, &building);
        if onsite_labor == 0 {
            continue;
        }
        worksites_by_owner
            .entry(building.owner)
            .or_default()
            .push(OxWorksiteCandidate {
                building_id: building.id,
                x: building.x,
                z: building.z,
                worker_slots: onsite_labor,
            });
    }

    let used_ox_ids = tick.used_ox_ids();
    let mut by_building: HashMap<u64, Vec<u64>> = HashMap::new();
    for owner in oxen_by_owner.keys().copied().collect::<Vec<_>>() {
        let oxen = operational_oxen_for_owner(ctx, tick, owner);
        let mut unavailable: Vec<u64> = active_trip_ox_ids(ctx, owner).into_iter().collect();
        unavailable.extend(used_ox_ids.iter().copied());
        let worksites = worksites_by_owner.remove(&owner).unwrap_or_default();
        for assignment in assign_oxen_to_worksites(&oxen, &worksites, &unavailable) {
            by_building
                .entry(assignment.building_id)
                .or_default()
                .push(assignment.ox_id);
        }
    }
    by_building
}

fn is_operational_production_worksite(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &crate::simulation::GameClock,
    building: &Building,
) -> bool {
    is_ox_production_workplace(&building.kind)
        && building.construction_complete
        && building.assigned_labor > 0
        && !tick.building_disabled_by_fire(ctx, building.id)
        && !production_labor_paused(ctx, tick, building, clock)
}

/// Claims the oxen already paired to this worksite for the current simulation
/// substep. Repeated labor queries for the same building are idempotent.
pub(crate) fn paired_production_ox_count(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    building: &Building,
    human_workers: u32,
) -> u32 {
    if human_workers == 0 || !is_ox_production_workplace(&building.kind) {
        return 0;
    }
    if let Some(claimed) = tick.claimed_production_ox_ids(building.id) {
        return (claimed.len() as u32).min(human_workers);
    }

    let assignments = if let Some(cached) = tick.cached_production_ox_assignments() {
        cached
    } else {
        let built = build_production_assignments(ctx, tick);
        tick.cache_production_ox_assignments(built.clone());
        built
    };
    let active_trip_oxen = active_trip_ox_ids(ctx, building.owner);
    let mut claimed = Vec::new();
    for ox_id in assignments.get(&building.id).into_iter().flatten().copied() {
        if claimed.len() >= human_workers as usize {
            break;
        }
        if active_trip_oxen.contains(&ox_id) {
            continue;
        }
        if tick.try_mark_ox_used(ox_id) {
            claimed.push(ox_id);
        }
    }
    let count = claimed.len() as u32;
    tick.record_production_ox_claims(building.id, claimed);
    count
}

/// Reserves one ox for a local cart operated by `workplace_id`. A posted ox at
/// that workplace wins; otherwise the nearest unposted automatic ox may help.
/// Oxen posted elsewhere, active trip rows, and production already performed
/// in this substep are unavailable.
pub(crate) fn claim_haul_ox_for_workplace(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    owner: Identity,
    workplace_id: u64,
    x: f64,
    z: f64,
) -> u64 {
    let Some(workplace) = ctx.db.building().id().find(&workplace_id) else {
        return 0;
    };
    if workplace.owner != owner
        || !workplace.construction_complete
        || !is_ox_supported_workplace(&workplace.kind)
        || tick.building_disabled_by_fire(ctx, workplace.id)
    {
        return 0;
    }
    let oxen = operational_oxen_for_owner(ctx, tick, owner);
    let mut unavailable: Vec<u64> = active_trip_ox_ids(ctx, owner).into_iter().collect();
    unavailable.extend(tick.used_ox_ids());
    let Some(ox_id) = available_ox_for_workplace(&oxen, &unavailable, workplace_id, x, z) else {
        return 0;
    };
    if !tick.try_mark_ox_used(ox_id) {
        return 0;
    }
    tick.invalidate_production_ox_assignments();
    ox_id
}

pub(crate) fn release_haul_ox(tick: &SimTickContext, ox_id: u64) {
    tick.release_ox_use(ox_id);
}
