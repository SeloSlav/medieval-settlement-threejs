use spacetimedb::ReducerContext;

use crate::balance_generated::{
    STOREHOUSE_HAUL_PER_WORKER, STOREHOUSE_OVERFLOW_THRESHOLD,
    TIMBER_DELIVERY_SPEED_MPS, TIMBER_DELIVERY_UNLOAD_SEC,
};
use crate::db::*;
use crate::economy::{
    building_commodity_cap, building_commodity_room, building_commodity_stock, CommodityKind,
};
use crate::simulation::delivery_trips::{
    building_has_active_trip, building_has_inbound_supply_trip, try_start_building_supply_trip,
};
use crate::simulation::game_calendar::GameClock;
use crate::simulation::labor_and_logistics_paused;
use crate::simulation::tick_context::SimTickContext;
use crate::tables::Building;

struct OverflowSource {
    building: Building,
    commodity: CommodityKind,
    excess: f64,
    fill_ratio: f64,
    distance: f64,
}

/// A staffed storehouse uses its carts to clear road-linked producer overflow.
/// Food and grain are deliberately excluded so the granary and marketplace keep
/// their specialized roles.
pub fn step_village_storehouse(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    storehouse: Building,
) {
    if storehouse.assigned_labor == 0
        || labor_and_logistics_paused(ctx, storehouse.owner, clock)
        || building_has_inbound_supply_trip(ctx, storehouse.id)
    {
        return;
    }
    let Some(network) = tick.road_network(storehouse.owner) else {
        return;
    };

    let mut candidates = Vec::new();
    for source in ctx.db.building().owner().filter(&storehouse.owner) {
        let commodity = match source.kind.as_str() {
            "lumber_mill" if storehouse.storehouse_accepts_timber => CommodityKind::Timber,
            "stone_quarry" if storehouse.storehouse_accepts_stone => CommodityKind::Stone,
            "woodcutters_lodge" if storehouse.storehouse_accepts_firewood => CommodityKind::Firewood,
            _ => continue,
        };
        if building_has_active_trip(ctx, source.id)
            || building_commodity_room(&storehouse, commodity) <= 1e-6
        {
            continue;
        }
        let capacity = building_commodity_cap(&source.kind, commodity);
        if capacity <= 1e-6 {
            continue;
        }
        let stock = building_commodity_stock(&source, commodity);
        let excess = stock - capacity * STOREHOUSE_OVERFLOW_THRESHOLD;
        if excess <= 1e-6 {
            continue;
        }
        let Some(distance) = network.road_path_distance(
            source.x,
            source.z,
            storehouse.x,
            storehouse.z,
        ) else {
            continue;
        };
        candidates.push(OverflowSource {
            building: source,
            commodity,
            excess,
            fill_ratio: stock / capacity,
            distance,
        });
    }

    candidates.sort_by(|a, b| {
        b.fill_ratio
            .partial_cmp(&a.fill_ratio)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| {
                a.distance
                    .partial_cmp(&b.distance)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
    });

    let Some(mut source) = candidates.into_iter().next() else {
        return;
    };
    let room = building_commodity_room(&storehouse, source.commodity);
    let requested = source.excess.min(room);
    let workers = storehouse.assigned_labor.min(2).max(1);
    if try_start_building_supply_trip(
        ctx,
        clock,
        network,
        &mut source.building,
        &storehouse,
        workers,
        source.commodity,
        TIMBER_DELIVERY_SPEED_MPS,
        TIMBER_DELIVERY_UNLOAD_SEC,
        STOREHOUSE_HAUL_PER_WORKER,
        requested,
    ) {
        ctx.db.building().id().update(source.building);
    }
}
