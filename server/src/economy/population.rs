use spacetimedb::ReducerContext;

use crate::building_defs::building_def;
use crate::constants::{
    NARROW_PARCEL_FRONTAGE_MAX, POPULATION_PER_RESIDENCE, RESIDENCE_POPULATION_NARROW,
    RESIDENCE_POPULATION_WIDE, STARTING_POPULATION, WIDE_PARCEL_FRONTAGE_MIN,
};
use crate::balance_generated::CONSTRUCTION_MAX_BUILDERS;
use crate::db::*;
use crate::tables::Building;

use super::population_policy::population_limit_blocks_labor_request;

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
    building_def(kind).map_or(0, |def| {
        if def.accepts_labor {
            def.max_labor
        } else {
            0
        }
    })
}

fn total_population(ctx: &ReducerContext, owner: spacetimedb::Identity) -> u32 {
    let from_residences: u32 = ctx
        .db
        .residence()
        .owner()
        .filter(&owner)
        .filter(|residence| !residence.abandoned)
        .map(|residence| residence.population)
        .sum();
    STARTING_POPULATION.saturating_add(from_residences)
}

fn total_assigned_labor(ctx: &ReducerContext, owner: spacetimedb::Identity) -> u32 {
    ctx.db
        .building()
        .owner()
        .filter(&owner)
        .map(|building| building.assigned_labor)
        .sum()
}

pub fn available_building_labor(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
) -> u32 {
    total_population(ctx, owner).saturating_sub(total_assigned_labor(ctx, owner))
}

pub fn initial_construction_labor(available_labor: u32) -> u32 {
    available_labor.min(CONSTRUCTION_MAX_BUILDERS)
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

    let assigned_elsewhere =
        total_assigned_labor(ctx, owner).saturating_sub(building.assigned_labor);
    let population = total_population(ctx, owner);
    let max_allowed = population.saturating_sub(assigned_elsewhere);
    if population_limit_blocks_labor_request(
        building.assigned_labor,
        requested_labor,
        population,
        assigned_elsewhere,
    ) {
        return Err(format!(
            "Only {} workers available ({} population assigned elsewhere).",
            max_allowed, assigned_elsewhere
        ));
    }

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
    use super::initial_construction_labor;
    use crate::balance_generated::CONSTRUCTION_MAX_BUILDERS;

    #[test]
    fn new_sites_take_available_builders_up_to_the_construction_cap() {
        assert_eq!(initial_construction_labor(0), 0);
        assert_eq!(initial_construction_labor(2), 2);
        assert_eq!(
            initial_construction_labor(CONSTRUCTION_MAX_BUILDERS + 3),
            CONSTRUCTION_MAX_BUILDERS,
        );
    }
}
