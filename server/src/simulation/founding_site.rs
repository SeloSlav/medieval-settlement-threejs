//! Lifecycle for the temporary founders' shelter and its open stockyard.

use spacetimedb::ReducerContext;

use crate::balance_generated::{
    STARTING_POPULATION, STOREHOUSE_HAUL_PER_WORKER, TIMBER_DELIVERY_SPEED_MPS,
    TIMBER_DELIVERY_UNLOAD_SEC,
};
use crate::db::*;
use crate::economy::{building_commodity_cap, building_commodity_stock, CommodityKind};
use crate::residence_upgrade_policy::residence_project_active;
use crate::simulation::delivery_trips::{
    available_free_haulers, building_has_active_trip, building_has_inbound_supply_trip,
    try_start_building_supply_trip,
};
use crate::simulation::{GameClock, SimTickContext};
use crate::storehouse_policy::{
    compare_storehouse_destination, storehouse_filtered_collection_headroom,
};
use crate::tables::Building;

const EPSILON: f64 = 1e-6;
const FOUNDING_RELOCATION_COMMODITIES: [CommodityKind; 3] = [
    CommodityKind::Timber,
    CommodityKind::Stone,
    CommodityKind::Firewood,
];

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

        if !site.founding_shelter_active
            && !building_has_active_trip(ctx, site.id)
            && available_free_haulers(ctx, site.owner) > 0
            && try_start_stockyard_relocation(ctx, tick, clock, &mut site)
        {
            site_changed = true;
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

/// Once the founders have permanent homes, one free villager at a time moves
/// uncommitted material out of the temporary yard. Storehouse filters and
/// collection ceilings remain meaningful: clearing the camp is a logistics
/// decision, not an inventory teleport.
fn try_start_stockyard_relocation(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    site: &mut Building,
) -> bool {
    let Some(network) = tick.road_network(site.owner) else {
        return false;
    };

    for commodity in FOUNDING_RELOCATION_COMMODITIES {
        let relocatable = relocatable_stock(ctx, site, commodity);
        if relocatable <= EPSILON {
            continue;
        }

        let target = ctx
            .db
            .building()
            .owner()
            .filter(&site.owner)
            .filter(|candidate| {
                candidate.kind == "village_storehouse"
                    && candidate.construction_complete
                    && !tick.building_disabled_by_fire(ctx, candidate.id)
                    && !building_has_inbound_supply_trip(ctx, candidate.id)
                    && founding_storehouse_room(candidate, commodity) > EPSILON
            })
            .filter_map(|candidate| {
                let distance =
                    network.road_path_distance(site.x, site.z, candidate.x, candidate.z)?;
                Some((candidate, distance))
            })
            .min_by(|(candidate_a, distance_a), (candidate_b, distance_b)| {
                compare_storehouse_destination(
                    *distance_a,
                    candidate_a.id,
                    *distance_b,
                    candidate_b.id,
                )
            })
            .map(|(candidate, _)| candidate);
        let Some(target) = target else {
            continue;
        };
        let requested = relocatable.min(founding_storehouse_room(&target, commodity));
        if try_start_building_supply_trip(
            ctx,
            tick,
            clock,
            network,
            site,
            &target,
            1,
            commodity,
            TIMBER_DELIVERY_SPEED_MPS,
            TIMBER_DELIVERY_UNLOAD_SEC,
            STOREHOUSE_HAUL_PER_WORKER,
            requested,
        ) {
            return true;
        }
    }
    false
}

fn relocatable_stock(ctx: &ReducerContext, site: &Building, commodity: CommodityKind) -> f64 {
    let stock = building_commodity_stock(site, commodity).max(0.0);
    let reserved = match commodity {
        CommodityKind::Timber | CommodityKind::Stone => {
            let construction_reserved: f64 = ctx
                .db
                .building()
                .owner()
                .filter(&site.owner)
                .filter(|building| !building.construction_complete)
                .map(|building| match commodity {
                    CommodityKind::Timber => (building.construction_reserved_timber
                        - building.construction_treasury_timber)
                        .max(0.0),
                    CommodityKind::Stone => (building.construction_reserved_stone
                        - building.construction_treasury_stone)
                        .max(0.0),
                    _ => 0.0,
                })
                .sum();
            let residence_reserved: f64 = ctx
                .db
                .residence()
                .owner()
                .filter(&site.owner)
                .filter(|residence| {
                    residence_project_active(
                        residence.upgrade_target_tier,
                        residence.tier,
                        residence.backyard_project_kind,
                    )
                })
                .map(|residence| match commodity {
                    CommodityKind::Timber => residence.upgrade_reserved_timber.max(0.0),
                    CommodityKind::Stone => residence.upgrade_reserved_stone.max(0.0),
                    _ => 0.0,
                })
                .sum();
            construction_reserved + residence_reserved
        }
        _ => 0.0,
    };
    (stock - reserved).max(0.0)
}

fn founding_storehouse_room(storehouse: &Building, commodity: CommodityKind) -> f64 {
    let accepts = match commodity {
        CommodityKind::Timber => storehouse.storehouse_accepts_timber,
        CommodityKind::Stone => storehouse.storehouse_accepts_stone,
        CommodityKind::Firewood => storehouse.storehouse_accepts_firewood,
        _ => false,
    };
    let target_percent = match commodity {
        CommodityKind::Timber => storehouse.storehouse_timber_target_percent,
        CommodityKind::Stone => storehouse.storehouse_stone_target_percent,
        CommodityKind::Firewood => storehouse.storehouse_firewood_target_percent,
        _ => return 0.0,
    };
    storehouse_filtered_collection_headroom(
        accepts,
        building_commodity_stock(storehouse, commodity),
        building_commodity_cap(&storehouse.kind, commodity),
        target_percent,
    )
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
