use std::collections::HashMap;

use spacetimedb::{Identity, ReducerContext};

use crate::balance_generated::{
    STARTING_POPULATION, WORKFORCE_AVERAGE_WALK_SPEED_MPS, WORKFORCE_ROAD_SPEED_MULTIPLIER,
};
use crate::db::*;
use crate::labor_steward_policy::seasonal_labor_steward_review_due;
use crate::ox_policy::ox_amplified_worker_count;
use crate::tables::{Building, Residence};
use crate::workforce_commute_policy::{
    assign_target_travel_seconds, commute_efficiency_from_average_seconds,
    is_exposed_commute_worksite, is_visible_worker_workplace, productive_labor_after_commute,
    CommutePair,
};

use super::SimTickContext;

#[derive(Clone, Copy)]
struct WorkerOrigin {
    x: f64,
    z: f64,
    available: u32,
}

fn direct_distance(ax: f64, az: f64, bx: f64, bz: f64) -> f64 {
    (bx - ax).hypot(bz - az)
}

fn owner_worker_origins(ctx: &ReducerContext, owner: Identity) -> Vec<WorkerOrigin> {
    let mut residences: Vec<Residence> = ctx
        .db
        .residence()
        .owner()
        .filter(&owner)
        .filter(|residence| !residence.abandoned && residence.population > 0)
        .collect();
    residences.sort_by_key(|residence| residence.id);

    let healthy_housed: u32 = residences
        .iter()
        .map(|residence| {
            residence
                .population
                .saturating_sub(residence.sick_population)
        })
        .sum();
    let mut origins: Vec<WorkerOrigin> = residences
        .into_iter()
        .filter_map(|residence| {
            let available = residence
                .population
                .saturating_sub(residence.sick_population);
            (available > 0).then_some(WorkerOrigin {
                x: residence.x,
                z: residence.z,
                available,
            })
        })
        .collect();

    let legacy_bonus = ctx
        .db
        .player_resources()
        .owner()
        .find(&owner)
        .map_or(true, |resources| {
            resources.legacy_unhoused_population_bonus_enabled
        });
    let founding_origins = crate::settlements::active_settlement_founder_origins(ctx, owner);
    for (_, x, z, available) in founding_origins {
        origins.push(WorkerOrigin { x, z, available });
    }

    // Mature legacy saves retain their historical additive five-person pool,
    // but it is separate from every authoritative local founding cohort.
    if legacy_bonus {
        let fallback = ctx
            .db
            .building()
            .owner()
            .filter(&owner)
            .find(|building| building.kind == "founders_camp")
            .map(|camp| (camp.x, camp.z))
            .or_else(|| {
                ctx.db
                    .settlement()
                    .owner()
                    .filter(&owner)
                    .min_by_key(|settlement| settlement.id)
                    .map(|settlement| (settlement.anchor_x, settlement.anchor_z))
            });
        if let Some((x, z)) = fallback {
            origins.push(WorkerOrigin {
                x,
                z,
                available: STARTING_POPULATION,
            });
        }
    } else if ctx.db.settlement().owner().filter(&owner).next().is_none() {
        // Pre-migration fallback; client connection normally repairs this path.
        let unhoused = STARTING_POPULATION.saturating_sub(healthy_housed);
        if unhoused > 0 {
            if let Some(camp) = ctx
                .db
                .building()
                .owner()
                .filter(&owner)
                .find(|building| building.kind == "founders_camp")
            {
                origins.push(WorkerOrigin {
                    x: camp.x,
                    z: camp.z,
                    available: unhoused,
                });
            }
        }
    }
    origins
}

fn reconcile_owner_commutes(ctx: &ReducerContext, tick: &SimTickContext, owner: Identity) {
    let origins = owner_worker_origins(ctx, owner);
    let mut workplaces: Vec<Building> = ctx
        .db
        .building()
        .owner()
        .filter(&owner)
        .filter(|building| {
            building.assigned_labor > 0
                && (!building.construction_complete || is_visible_worker_workplace(&building.kind))
        })
        .collect();
    workplaces.sort_by_key(|building| building.id);

    let target_ids: Vec<u64> = workplaces
        .iter()
        .filter(|building| {
            building.construction_complete && is_exposed_commute_worksite(&building.kind)
        })
        .map(|building| building.id)
        .collect();
    if target_ids.is_empty() {
        return;
    }
    if origins.is_empty() {
        for worksite_id in target_ids {
            if let Some(mut worksite) = ctx.db.building().id().find(&worksite_id) {
                if (worksite.commute_efficiency - 1.0).abs() > 1e-6 {
                    worksite.commute_efficiency = 1.0;
                    ctx.db.building().id().update(worksite);
                }
            }
        }
        return;
    }

    let target_positions: Vec<(f64, f64)> =
        origins.iter().map(|origin| (origin.x, origin.z)).collect();
    let network = tick.road_network(owner);
    let mut pairs = Vec::with_capacity(workplaces.len().saturating_mul(origins.len()));
    for workplace in &workplaces {
        let road_distances = network.map(|network| {
            network.road_path_distances_from(workplace.x, workplace.z, &target_positions)
        });
        for (origin_index, origin) in origins.iter().enumerate() {
            let travel_effort = road_distances
                .as_ref()
                .and_then(|distances| distances.get(origin_index).copied().flatten())
                .map(|distance| distance / WORKFORCE_ROAD_SPEED_MULTIPLIER.max(1e-6))
                .unwrap_or_else(|| direct_distance(workplace.x, workplace.z, origin.x, origin.z));
            pairs.push(CommutePair {
                worksite_id: workplace.id,
                origin_index,
                travel_seconds: travel_effort / WORKFORCE_AVERAGE_WALK_SPEED_MPS.max(1e-6),
            });
        }
    }
    let remaining_by_worksite: HashMap<u64, u32> = workplaces
        .iter()
        .map(|building| (building.id, building.assigned_labor))
        .collect();
    let remaining_by_origin: Vec<u32> = origins.iter().map(|origin| origin.available).collect();
    let travel_seconds_by_target = assign_target_travel_seconds(
        &mut pairs,
        remaining_by_worksite,
        remaining_by_origin,
        &target_ids,
    );

    for worksite_id in target_ids {
        let Some(mut worksite) = ctx.db.building().id().find(&worksite_id) else {
            continue;
        };
        let average_seconds = travel_seconds_by_target
            .get(&worksite_id)
            .copied()
            .unwrap_or(0.0)
            / worksite.assigned_labor.max(1) as f64;
        let efficiency = commute_efficiency_from_average_seconds(average_seconds);
        if (worksite.commute_efficiency - efficiency).abs() > 1e-6 {
            worksite.commute_efficiency = efficiency;
            ctx.db.building().id().update(worksite);
        }
    }
}

/// Rebuilds the derived commute cache once per calendar day, after automatic
/// labor rotation has settled. Road solving stays outside the production loop.
pub fn step_workforce_commutes(ctx: &ReducerContext, tick: &SimTickContext, sim_tick: u64) {
    if !seasonal_labor_steward_review_due(sim_tick) {
        return;
    }
    let mut owners: Vec<Identity> = ctx
        .db
        .building()
        .iter()
        .filter(|building| {
            building.construction_complete && is_exposed_commute_worksite(&building.kind)
        })
        .map(|building| building.owner)
        .collect();
    owners.sort();
    owners.dedup();
    for owner in owners {
        reconcile_owner_commutes(ctx, tick, owner);
    }
}

/// Effective workers available for production. Household commute cost applies
/// only to exposed yards that can build a linked camp; completing a safe camp
/// restores the full local shift without changing the cached household route.
pub fn commute_adjusted_labor(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    building: &Building,
    onsite_labor: u32,
) -> f64 {
    if onsite_labor == 0 {
        return 0.0;
    }
    let exposed = is_exposed_commute_worksite(&building.kind);
    let active_remote_camp =
        exposed && tick.worksite_has_active_remote_camp(ctx, building.owner, building.id);
    let paired_oxen =
        crate::simulation::paired_production_ox_count(ctx, tick, building, onsite_labor);
    let amplified_labor = ox_amplified_worker_count(onsite_labor, paired_oxen);
    productive_labor_after_commute(
        amplified_labor,
        exposed,
        active_remote_camp,
        building.commute_efficiency,
    )
}
