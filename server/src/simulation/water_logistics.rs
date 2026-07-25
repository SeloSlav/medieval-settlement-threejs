//! Road-linked well supply for buildings (mills, etc.).

use spacetimedb::ReducerContext;

use crate::db::*;
use crate::economy::{building_water_storage_cap, deposit_building_water, withdraw_building_water};
use crate::roads::RoadNetwork;
use crate::simulation::road_logistics::{owner_wells, sort_wells_by_road_path};
use crate::simulation::tick_context::SimTickContext;
use crate::tables::Building;

pub fn building_has_road_connected_well(
    tick: &SimTickContext,
    ctx: &ReducerContext,
    building: &Building,
) -> bool {
    let Some(network) = tick.road_network(building.owner) else {
        return false;
    };
    owner_wells(ctx, building.owner).iter().any(|well| {
        tick.road_connected(building.owner, well.x, well.z, building.x, building.z)
            && road_path_connected(network, well, building)
    })
}

pub fn ensure_building_water(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    network: &RoadNetwork,
    mut building: Building,
    needed: f64,
) -> Building {
    if needed <= 1e-6 || building.water + 1e-6 >= needed {
        return building;
    }

    let cap = building_water_storage_cap(&building.kind);
    if cap <= 1e-6 {
        return building;
    }

    let mut remaining = needed - building.water;
    let mut wells: Vec<Building> = owner_wells(ctx, building.owner)
        .into_iter()
        .filter(|well| {
            well.water > 0.0
                && tick.road_connected(building.owner, well.x, well.z, building.x, building.z)
                && road_path_connected(network, well, &building)
        })
        .collect();
    sort_wells_by_road_path(network, &building, &mut wells);

    for well in wells {
        if remaining <= 1e-6 {
            break;
        }
        let building_room = (cap - building.water).max(0.0);
        if building_room <= 1e-6 {
            break;
        }
        let request = remaining.min(building_room).min(well.water);
        let (withdrawn, reduced_well) = withdraw_building_water(&well, request);
        if withdrawn <= 0.0 {
            continue;
        }
        ctx.db.building().id().update(reduced_well);
        let (deposited, updated_building) = deposit_building_water(&building, cap, withdrawn);
        if deposited <= 0.0 {
            continue;
        }
        building = updated_building;
        remaining = needed - building.water;
    }

    building
}

fn road_path_connected(network: &RoadNetwork, well: &Building, building: &Building) -> bool {
    crate::simulation::road_logistics::road_path_distance(
        network, well.x, well.z, building.x, building.z,
    )
    .is_some()
}
