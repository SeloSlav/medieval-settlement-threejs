use std::collections::{HashMap, HashSet};

use spacetimedb::ReducerContext;

use crate::balance_generated::CONSTRUCTION_MAX_BUILDERS;
use crate::building_defs::building_def;
use crate::constants::{
    NARROW_PARCEL_FRONTAGE_MAX, POPULATION_PER_RESIDENCE, RESIDENCE_POPULATION_NARROW,
    RESIDENCE_POPULATION_WIDE, STARTING_POPULATION, WIDE_PARCEL_FRONTAGE_MIN,
};
use crate::construction_priority::CONSTRUCTION_PRIORITY_HOLD;
use crate::db::*;
use crate::raid_agent_policy::{
    combat_state_blocks_guard_slot, combat_state_commits_guard_labor, COMBAT_FACTION_GUARD,
};
use crate::residence_upgrade_policy::residence_project_active;
use crate::simulation::{
    building_fire_state, preserve_in_transit_cart_labor, staffed_cart_workers_by_building,
};
use crate::tables::Building;

use super::population_policy::{
    labor_reconciliation_updates, population_limit_blocks_labor_request, LaborAssignment,
};
pub use super::population_policy::initial_construction_labor;

pub fn residence_population_for_parcel(parcel_frontage: f64) -> u32 {
    if parcel_frontage >= WIDE_PARCEL_FRONTAGE_MIN {
        RESIDENCE_POPULATION_WIDE
    } else if parcel_frontage <= NARROW_PARCEL_FRONTAGE_MAX {
        RESIDENCE_POPULATION_NARROW
    } else {
        POPULATION_PER_RESIDENCE
    }
}

pub fn building_max_labor(kind: &str) -> u32 {
    building_def(kind).map_or(0, |def| if def.accepts_labor { def.max_labor } else { 0 })
}

fn total_population(ctx: &ReducerContext, owner: spacetimedb::Identity) -> u32 {
    let from_residences: u32 = ctx
        .db
        .residence()
        .owner()
        .filter(&owner)
        .filter(|residence| !residence.abandoned)
        .map(|residence| {
            residence
                .population
                .saturating_sub(residence.sick_population)
        })
        .sum();
    let legacy_unhoused_population_bonus_enabled = ctx
        .db
        .player_resources()
        .owner()
        .find(&owner)
        .map_or(true, |resources| {
            resources.legacy_unhoused_population_bonus_enabled
        });
    settlement_population(from_residences, legacy_unhoused_population_bonus_enabled)
}

pub fn settlement_population(housed: u32, legacy_unhoused_population_bonus_enabled: bool) -> u32 {
    if legacy_unhoused_population_bonus_enabled {
        STARTING_POPULATION.saturating_add(housed)
    } else {
        STARTING_POPULATION.max(housed)
    }
}

fn total_building_labor(ctx: &ReducerContext, owner: spacetimedb::Identity) -> u32 {
    let roster_floors = guardhouse_roster_floors(ctx, owner);
    if roster_floors.is_empty() {
        return ctx
            .db
            .building()
            .owner()
            .filter(&owner)
            .map(|building| building.assigned_labor)
            .sum();
    }
    ctx.db
        .building()
        .owner()
        .filter(&owner)
        .map(|building| {
            building
                .assigned_labor
                .max(roster_floors.get(&building.id).copied().unwrap_or(0))
        })
        .sum()
}

pub fn guardhouse_roster_floors(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
) -> HashMap<u64, u32> {
    let mut floors = HashMap::<u64, u32>::new();
    for agent in ctx
        .db
        .combat_agent()
        .owner()
        .filter(&owner)
        .filter(|agent| {
            agent.faction == COMBAT_FACTION_GUARD
                && agent.source_building_id > 0
                && combat_state_commits_guard_labor(agent.state)
        })
    {
        // Source slots identify individual villagers. A company cannot shrink
        // past a guard who is fighting, returning, or recovering and then
        // assign that same villager to another workplace.
        floors
            .entry(agent.source_building_id)
            .and_modify(|floor| *floor = (*floor).max(agent.source_slot.saturating_add(1)))
            .or_insert_with(|| agent.source_slot.saturating_add(1));
    }
    floors
}

pub fn guardhouse_roster_floor(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    building_id: u64,
) -> u32 {
    guardhouse_roster_floors(ctx, owner)
        .get(&building_id)
        .copied()
        .unwrap_or(0)
}

pub fn guardhouse_roster_count(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    building_id: u64,
) -> u32 {
    ctx.db
        .combat_agent()
        .owner()
        .filter(&owner)
        .filter(|agent| {
            agent.faction == COMBAT_FACTION_GUARD
                && agent.source_building_id == building_id
                && combat_state_commits_guard_labor(agent.state)
        })
        .map(|agent| agent.source_slot)
        .collect::<HashSet<_>>()
        .len() as u32
}

pub fn guardhouse_casualty_count(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    building_id: u64,
) -> u32 {
    ctx.db
        .combat_agent()
        .owner()
        .filter(&owner)
        .filter(|agent| {
            agent.faction == COMBAT_FACTION_GUARD
                && agent.source_building_id == building_id
                && combat_state_blocks_guard_slot(agent.state)
        })
        .map(|agent| agent.source_slot)
        .collect::<HashSet<_>>()
        .len() as u32
}

fn total_residence_project_labor(ctx: &ReducerContext, owner: spacetimedb::Identity) -> u32 {
    ctx.db
        .residence()
        .owner()
        .filter(&owner)
        .filter(|residence| {
            residence_project_active(
                residence.upgrade_target_tier,
                residence.tier,
                residence.backyard_project_kind,
                residence.fire_repair_active,
                residence.decay_repair_active,
                residence.roof_tile_retrofit_active,
            )
        })
        .map(|residence| residence.upgrade_assigned_labor.min(1))
        .sum()
}

fn total_assigned_labor(ctx: &ReducerContext, owner: spacetimedb::Identity) -> u32 {
    total_building_labor(ctx, owner).saturating_add(total_residence_project_labor(ctx, owner))
}

fn total_free_hauler_labor(ctx: &ReducerContext, owner: spacetimedb::Identity) -> u32 {
    ctx.db
        .delivery_trip()
        .owner()
        .filter(&owner)
        .map(|trip| trip.free_hauler_workers)
        .sum()
}

pub fn available_building_labor(ctx: &ReducerContext, owner: spacetimedb::Identity) -> u32 {
    total_population(ctx, owner).saturating_sub(
        total_assigned_labor(ctx, owner).saturating_add(total_free_hauler_labor(ctx, owner)),
    )
}

/// Clamp building assignments immediately after residence population is lost.
pub fn reconcile_building_labor(ctx: &ReducerContext, owner: spacetimedb::Identity) {
    let cart_floors = staffed_cart_workers_by_building(ctx, owner);
    let roster_floors = guardhouse_roster_floors(ctx, owner);
    let assignments = ctx
        .db
        .building()
        .owner()
        .filter(&owner)
        .map(|building| {
            let minimum_labor = cart_floors
                .get(&building.id)
                .copied()
                .unwrap_or(0)
                .max(roster_floors.get(&building.id).copied().unwrap_or(0));
            LaborAssignment {
                building_id: building.id,
                assigned_labor: building.assigned_labor.max(minimum_labor),
                minimum_labor,
                construction_complete: building.construction_complete,
                priority: building.construction_priority,
            }
        })
        .collect();

    let population_after_carts =
        total_population(ctx, owner).saturating_sub(total_free_hauler_labor(ctx, owner));
    let total_committed =
        total_building_labor(ctx, owner).saturating_add(total_residence_project_labor(ctx, owner));
    let mut excess = total_committed.saturating_sub(population_after_carts);
    if excess > 0 {
        let mut upgrades = ctx
            .db
            .residence()
            .owner()
            .filter(&owner)
            .filter(|residence| {
                residence_project_active(
                    residence.upgrade_target_tier,
                    residence.tier,
                    residence.backyard_project_kind,
                    residence.fire_repair_active,
                    residence.decay_repair_active,
                    residence.roof_tile_retrofit_active,
                ) && residence.upgrade_assigned_labor > 0
            })
            .collect::<Vec<_>>();
        upgrades.sort_by(|left, right| {
            left.upgrade_priority
                .cmp(&right.upgrade_priority)
                .then_with(|| right.id.cmp(&left.id))
        });
        for mut residence in upgrades {
            if excess == 0 {
                break;
            }
            residence.upgrade_assigned_labor = 0;
            excess -= 1;
            ctx.db.residence().id().update(residence);
        }
    }
    let assignable_population =
        population_after_carts.saturating_sub(total_residence_project_labor(ctx, owner));
    for (building_id, assigned_labor) in
        labor_reconciliation_updates(assignments, assignable_population)
    {
        let Some(building) = ctx.db.building().id().find(&building_id) else {
            continue;
        };
        preserve_in_transit_cart_labor(ctx, building_id, assigned_labor);
        ctx.db.building().id().update(Building {
            assigned_labor,
            ..building
        });
    }
}

pub fn assign_building_labor(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    building_id: u64,
    requested_labor: u32,
) -> Result<(), String> {
    let building = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Building not found.".to_string())?;
    if building.owner != owner {
        return Err("You do not own this building.".to_string());
    }
    if building.construction_complete && !building_accepts_labor(&building.kind) {
        return Err("This building does not use labor.".to_string());
    }
    if !building.construction_complete
        && building.construction_priority == CONSTRUCTION_PRIORITY_HOLD
        && requested_labor > 0
    {
        return Err("Resume this construction site before assigning builders.".to_string());
    }
    if requested_labor > building.assigned_labor && building_fire_state(ctx, building.id).is_some()
    {
        return Err("Repair this fire-damaged building before assigning more workers.".to_string());
    }
    let roster_floor = guardhouse_roster_floor(ctx, owner, building.id);
    if requested_labor < roster_floor {
        let roster_count = guardhouse_roster_count(ctx, owner, building.id);
        let casualty_count = guardhouse_casualty_count(ctx, owner, building.id);
        let fielded_count = roster_count.saturating_sub(casualty_count);
        let reason = match (fielded_count, casualty_count) {
            (fielded, 0) => format!(
                "{} guard{} remain deployed or are still returning to this company.",
                fielded,
                if fielded == 1 { "" } else { "s" },
            ),
            (0, casualties) => format!(
                "{} wounded guard{} remain committed to this company until recovery.",
                casualties,
                if casualties == 1 { "" } else { "s" },
            ),
            (fielded, casualties) => format!(
                "{} guard{} remain deployed or returning and {} wounded guard{} remain in recovery.",
                fielded,
                if fielded == 1 { "" } else { "s" },
                casualties,
                if casualties == 1 { "" } else { "s" },
            ),
        };
        return Err(format!(
            "{} Their roster positions through slot {} cannot be released.",
            reason, roster_floor
        ));
    }

    let building_cap = if building.construction_complete {
        building_max_labor(&building.kind)
    } else {
        CONSTRUCTION_MAX_BUILDERS
    };
    if requested_labor > building_cap {
        return Err(format!(
            "This building supports at most {} workers.",
            building_cap
        ));
    }

    let current_commitment =
        building
            .assigned_labor
            .max(guardhouse_roster_floor(ctx, owner, building.id));
    let assigned_elsewhere = total_assigned_labor(ctx, owner)
        .saturating_sub(current_commitment)
        .saturating_add(total_free_hauler_labor(ctx, owner));
    let population = total_population(ctx, owner);
    let max_allowed = population.saturating_sub(assigned_elsewhere);
    if population_limit_blocks_labor_request(
        building.assigned_labor,
        requested_labor,
        population,
        assigned_elsewhere,
    ) {
        return Err(format!(
            "Only {} workers available ({} population assigned elsewhere or hauling).",
            max_allowed, assigned_elsewhere
        ));
    }

    preserve_in_transit_cart_labor(ctx, building.id, requested_labor);
    ctx.db.building().id().update(Building {
        assigned_labor: requested_labor,
        ..building
    });
    Ok(())
}

pub fn building_accepts_labor(kind: &str) -> bool {
    building_def(kind).is_some_and(|def| def.accepts_labor)
}

#[cfg(test)]
mod tests {
    use super::settlement_population;
    use crate::balance_generated::STARTING_POPULATION;

    #[test]
    fn physical_founders_move_into_early_housing_while_legacy_population_stays_additive() {
        assert_eq!(settlement_population(0, false), STARTING_POPULATION);
        assert_eq!(
            settlement_population(STARTING_POPULATION - 1, false),
            STARTING_POPULATION
        );
        assert_eq!(
            settlement_population(STARTING_POPULATION + 2, false),
            STARTING_POPULATION + 2
        );
        assert_eq!(
            settlement_population(STARTING_POPULATION, true),
            STARTING_POPULATION * 2
        );
    }
}
