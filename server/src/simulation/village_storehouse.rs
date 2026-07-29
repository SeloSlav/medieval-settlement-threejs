use std::collections::HashMap;

use spacetimedb::{Identity, ReducerContext};

use crate::balance_generated::{
    FIREWOOD_DELIVERY_SPEED_MPS, FIREWOOD_DELIVERY_UNLOAD_SEC, STOREHOUSE_FIREWOOD_PER_DELIVERY,
    STOREHOUSE_HAUL_PER_WORKER, STOREHOUSE_OVERFLOW_THRESHOLD, TIMBER_DELIVERY_SPEED_MPS,
    TIMBER_DELIVERY_UNLOAD_SEC,
};
use crate::db::*;
use crate::economy::{building_commodity_cap, building_commodity_stock, CommodityKind};
use crate::simulation::delivery_cargo::has_delivery_stock_room;
use crate::simulation::delivery_supplier::{dispatch_delivery_if_ready, DeliveryDispatchConfig};
use crate::simulation::delivery_trips::{
    building_has_active_trip, building_has_inbound_supply_trip, try_start_building_supply_trip,
};
use crate::simulation::game_calendar::GameClock;
use crate::simulation::labor_and_logistics_paused;
use crate::simulation::residence_needs::{load_needs, need_stock, ResidenceNeedKind};
use crate::simulation::road_logistics::select_residence_for_need_delivery;
use crate::simulation::tick_context::SimTickContext;
use crate::storehouse_policy::{
    compare_storehouse_destination, compare_storehouse_source_priority,
    storehouse_filtered_collection_headroom,
};
use crate::supply_policy::household_firewood_needs_priority;
use crate::tables::{Building, Residence};

const STOREHOUSE_OVERFLOW_SOURCE_KINDS: &[&str] = &[
    "lumber_mill",
    "stone_quarry",
    "large_quarry",
    "woodcutters_lodge",
];

struct OverflowSource {
    building: Building,
    commodity: CommodityKind,
    excess: f64,
    fill_ratio: f64,
}

/// Give each staffed depot its household-heating opportunity before either
/// industrial fuel or collection work may claim its cart.
pub fn step_village_storehouse_household_firewood(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    storehouses: Vec<Building>,
) {
    for mut storehouse in storehouses {
        if !storehouse.construction_complete
            || tick.building_disabled_by_fire(ctx, storehouse.id)
            || storehouse.assigned_labor == 0
            || labor_and_logistics_paused(ctx, tick, storehouse.owner, clock)
            || building_has_active_trip(ctx, storehouse.id)
            || building_has_inbound_supply_trip(ctx, storehouse.id)
        {
            continue;
        }
        let Some(network) = tick.road_network(storehouse.owner) else {
            continue;
        };

        if storehouse.storehouse_accepts_firewood && storehouse.firewood > 1e-6 {
            let targets = collect_firewood_delivery_targets(ctx, tick, network, &storehouse);
            let workers = storehouse.assigned_labor.min(2);
            if dispatch_delivery_if_ready(
                ctx,
                tick,
                clock,
                network,
                &mut storehouse,
                workers,
                &targets,
                DeliveryDispatchConfig {
                    need_kind: ResidenceNeedKind::Firewood,
                    speed_mps: FIREWOOD_DELIVERY_SPEED_MPS,
                    unload_seconds: FIREWOOD_DELIVERY_UNLOAD_SEC,
                    per_delivery: STOREHOUSE_FIREWOOD_PER_DELIVERY,
                },
            ) {
                ctx.db.building().id().update(storehouse);
            }
        }
    }
}

/// Once household and industrial firewood claims have run, remaining idle
/// depots clear producer overflow in one owner-wide pass. Fullest producers
/// claim the nearest compatible depot, so database iteration and construction
/// order cannot silently distort the logistics layout. Food and grain remain
/// excluded so the granary and marketplace keep their specialized roles.
pub fn step_village_storehouse_overflow_collection(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    storehouses: Vec<Building>,
) {
    let mut idle_by_owner: HashMap<Identity, Vec<Building>> = HashMap::new();
    for storehouse in storehouses {
        if !storehouse.construction_complete
            || tick.building_disabled_by_fire(ctx, storehouse.id)
            || storehouse.assigned_labor == 0
            || labor_and_logistics_paused(ctx, tick, storehouse.owner, clock)
            || building_has_active_trip(ctx, storehouse.id)
            || building_has_inbound_supply_trip(ctx, storehouse.id)
            || tick.road_network(storehouse.owner).is_none()
        {
            continue;
        }
        idle_by_owner
            .entry(storehouse.owner)
            .or_default()
            .push(storehouse);
    }

    for (owner, idle_storehouses) in idle_by_owner {
        dispatch_overflow_collection_for_owner(ctx, tick, clock, owner, idle_storehouses);
    }
}

fn dispatch_overflow_collection_for_owner(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    owner: Identity,
    mut idle_storehouses: Vec<Building>,
) {
    let Some(network) = tick.road_network(owner) else {
        return;
    };
    let mut sources: Vec<OverflowSource> = tick
        .building_ids_for_kinds(ctx, owner, STOREHOUSE_OVERFLOW_SOURCE_KINDS)
        .into_iter()
        .filter_map(|building_id| ctx.db.building().id().find(&building_id))
        .filter_map(|source| {
            if !source.construction_complete
                || tick.building_disabled_by_fire(ctx, source.id)
                || building_has_active_trip(ctx, source.id)
            {
                return None;
            }
            let commodity = match source.kind.as_str() {
                "lumber_mill" => CommodityKind::Timber,
                "stone_quarry" | "large_quarry" => CommodityKind::Stone,
                "woodcutters_lodge" => CommodityKind::Firewood,
                _ => return None,
            };
            let capacity = building_commodity_cap(&source.kind, commodity);
            if capacity <= 1e-6 {
                return None;
            }
            let stock = building_commodity_stock(&source, commodity);
            let excess = stock - capacity * STOREHOUSE_OVERFLOW_THRESHOLD;
            if excess <= 1e-6 {
                return None;
            }
            Some(OverflowSource {
                building: source,
                commodity,
                excess,
                fill_ratio: stock / capacity,
            })
        })
        .collect();
    sources.sort_by(|a, b| {
        compare_storehouse_source_priority(a.fill_ratio, a.building.id, b.fill_ratio, b.building.id)
    });

    for mut source in sources {
        let Some((storehouse_index, _)) = idle_storehouses
            .iter()
            .enumerate()
            .filter_map(|(index, storehouse)| {
                if storehouse_collection_room(storehouse, source.commodity) <= 1e-6 {
                    return None;
                }
                let distance = network.road_path_distance(
                    source.building.x,
                    source.building.z,
                    storehouse.x,
                    storehouse.z,
                )?;
                Some((index, distance))
            })
            .min_by(|(index_a, distance_a), (index_b, distance_b)| {
                compare_storehouse_destination(
                    *distance_a,
                    idle_storehouses[*index_a].id,
                    *distance_b,
                    idle_storehouses[*index_b].id,
                )
            })
        else {
            continue;
        };

        let storehouse = &idle_storehouses[storehouse_index];
        let room = storehouse_collection_room(storehouse, source.commodity);
        let requested = source.excess.min(room);
        let workers = storehouse.assigned_labor.min(2).max(1);
        if try_start_building_supply_trip(
            ctx,
            tick,
            clock,
            network,
            &mut source.building,
            storehouse,
            workers,
            source.commodity,
            TIMBER_DELIVERY_SPEED_MPS,
            TIMBER_DELIVERY_UNLOAD_SEC,
            STOREHOUSE_HAUL_PER_WORKER,
            requested,
        ) {
            ctx.db.building().id().update(source.building);
            idle_storehouses.swap_remove(storehouse_index);
            if idle_storehouses.is_empty() {
                break;
            }
        }
    }
}

fn storehouse_accepts_commodity(storehouse: &Building, commodity: CommodityKind) -> bool {
    match commodity {
        CommodityKind::Timber => storehouse.storehouse_accepts_timber,
        CommodityKind::Stone => storehouse.storehouse_accepts_stone,
        CommodityKind::Firewood => storehouse.storehouse_accepts_firewood,
        _ => false,
    }
}

fn storehouse_collection_room(storehouse: &Building, commodity: CommodityKind) -> f64 {
    let percent = match commodity {
        CommodityKind::Timber => storehouse.storehouse_timber_target_percent,
        CommodityKind::Stone => storehouse.storehouse_stone_target_percent,
        CommodityKind::Firewood => storehouse.storehouse_firewood_target_percent,
        _ => return 0.0,
    };
    storehouse_filtered_collection_headroom(
        storehouse_accepts_commodity(storehouse, commodity),
        building_commodity_stock(storehouse, commodity),
        building_commodity_cap(&storehouse.kind, commodity),
        percent,
    )
}

fn collect_firewood_delivery_targets(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    network: &crate::roads::RoadNetwork,
    storehouse: &Building,
) -> Vec<Residence> {
    let residences: Vec<Residence> = ctx
        .db
        .residence()
        .owner()
        .filter(&storehouse.owner)
        .filter(|residence| ResidenceNeedKind::Firewood.is_active_for_tier(residence.tier))
        .filter(|residence| {
            tick.firewood_supplier_for(ctx, storehouse.owner, residence.id) == Some(storehouse.id)
        })
        .collect();
    select_residence_for_need_delivery(
        network,
        storehouse,
        residences,
        None,
        None,
        |residence| need_stock(&load_needs(ctx, residence.id), ResidenceNeedKind::Firewood),
        |residence, stock| {
            has_delivery_stock_room(ResidenceNeedKind::Firewood, stock)
                && household_firewood_needs_priority(
                    residence.abandoned,
                    residence.population,
                    stock,
                )
        },
    )
    .into_iter()
    .collect()
}
