//! Lifecycle for the temporary founders' shelter and its open stockyard.

use spacetimedb::ReducerContext;

use crate::balance_generated::{
    STARTING_POPULATION, STOREHOUSE_HAUL_PER_WORKER, TIMBER_DELIVERY_SPEED_MPS,
    TIMBER_DELIVERY_UNLOAD_SEC,
};
use crate::db::*;
use crate::economy::CommodityKind;
use crate::simulation::delivery_trips::{
    available_free_haulers, building_has_active_trip, try_start_building_supply_trip,
};
use crate::simulation::{GameClock, SimTickContext};
use crate::tables::Building;

const EPSILON: f64 = 1e-6;

pub fn step_founding_sites(ctx: &ReducerContext, tick: &SimTickContext, clock: &GameClock) {
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

        let town_hall = first_completed_building(ctx, site.owner, "town_hall");
        if let Some(ref town_hall) = town_hall {
            if site.gold > EPSILON
                && !building_has_active_trip(ctx, site.id)
                && available_free_haulers(ctx, site.owner) > 0
            {
                if let Some(network) = tick.road_network(site.owner) {
                    let gold = site.gold;
                    if try_start_building_supply_trip(
                        ctx,
                        tick,
                        clock,
                        network,
                        &mut site,
                        town_hall,
                        1,
                        CommodityKind::Gold,
                        TIMBER_DELIVERY_SPEED_MPS,
                        TIMBER_DELIVERY_UNLOAD_SEC,
                        STOREHOUSE_HAUL_PER_WORKER,
                        gold,
                    ) {
                        site_changed = true;
                    }
                }
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
