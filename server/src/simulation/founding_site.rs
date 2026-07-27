//! Lifecycle for the temporary founders' shelter and its open stockyard.

use spacetimedb::ReducerContext;

use crate::balance_generated::STARTING_POPULATION;
use crate::db::*;
use crate::simulation::building_has_active_trip;
use crate::tables::Building;

const EPSILON: f64 = 1e-6;

pub fn step_founding_sites(ctx: &ReducerContext) {
    let site_ids = ctx
        .db
        .building()
        .iter()
        .filter(|building| building.kind == "founders_camp")
        .map(|building| building.id)
        .collect::<Vec<_>>();

    for site_id in site_ids {
        let Some(mut site) = ctx.db.building().id().find(&site_id) else {
            continue;
        };
        let mut site_changed = false;

        let housed: u32 = ctx
            .db
            .residence()
            .owner()
            .filter(&site.owner)
            .filter(|residence| !residence.abandoned)
            .map(|residence| residence.population)
            .sum();
        if site.founding_shelter_active && housed >= STARTING_POPULATION {
            site.founding_shelter_active = false;
            site_changed = true;
        }

        let mut town_hall = first_completed_building(ctx, site.owner, "town_hall");
        if let Some(ref mut town_hall) = town_hall {
            if site.gold > EPSILON {
                town_hall.gold += site.gold;
                site.gold = 0.0;
                site_changed = true;
                ctx.db.building().id().update(town_hall.clone());
            }
        }

        if site_changed {
            ctx.db.building().id().update(site.clone());
        }
        let has_town_hall = town_hall.is_some();
        let has_storehouse =
            first_completed_building(ctx, site.owner, "village_storehouse").is_some();
        if site.founding_shelter_active
            || building_has_active_trip(ctx, site.id)
            || has_portable_stock(&site)
            || !has_town_hall
            || !has_storehouse
        {
            continue;
        }

        // Once housing, a permanent material depot, and a civic lockbox all
        // exist, an empty open stockyard no longer represents anything.
        ctx.db.building().id().delete(site.id);
    }
}

fn first_completed_building(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    kind: &str,
) -> Option<Building> {
    ctx.db
        .building()
        .owner()
        .filter(&owner)
        .filter(|building| building.kind == kind && building.construction_complete)
        .min_by_key(|building| building.id)
}

fn has_portable_stock(building: &Building) -> bool {
    [
        building.timber,
        building.firewood,
        building.stone,
        building.water,
        building.food,
        building.grain,
        building.flour,
        building.ale,
        building.preserved_food,
        building.honey,
        building.wine,
        building.ironwork,
        building.polearms,
        building.wool,
        building.cloth,
        building.gold,
    ]
    .into_iter()
    .any(|amount| amount > EPSILON)
}
