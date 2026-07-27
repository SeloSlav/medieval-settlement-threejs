//! Physical recovery of goods left where a structure was dismantled.

use spacetimedb::ReducerContext;

use crate::balance_generated::{
    STOREHOUSE_HAUL_PER_WORKER, TIMBER_DELIVERY_SPEED_MPS, TIMBER_DELIVERY_UNLOAD_SEC,
};
use crate::db::*;
use crate::economy::{building_commodity_room, building_commodity_stock, CommodityKind};
use crate::simulation::delivery_trips::{
    available_free_haulers, building_has_active_trip, building_has_inbound_supply_trip,
    try_start_building_supply_trip,
};
use crate::simulation::{labor_and_logistics_paused, GameClock, SimTickContext};
use crate::tables::Building;

const EPSILON: f64 = 1e-6;
const RECOVERY_ORDER: [CommodityKind; 16] = [
    CommodityKind::Gold,
    CommodityKind::Food,
    CommodityKind::Grain,
    CommodityKind::Flour,
    CommodityKind::PreservedFood,
    CommodityKind::Ale,
    CommodityKind::Honey,
    CommodityKind::Wine,
    CommodityKind::Cloth,
    CommodityKind::Wool,
    CommodityKind::Ironwork,
    CommodityKind::Polearms,
    CommodityKind::Firewood,
    CommodityKind::Stone,
    CommodityKind::Timber,
    CommodityKind::Water,
];

/// One free hauler at each reachable pile moves one cartload per economy step.
/// Construction has already had first claim on reclaimed timber and stone, so
/// permanent stores clear only what an active worksite did not reserve.
pub fn step_reclamation_piles(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    pile_ids: Vec<u64>,
) {
    for pile_id in pile_ids {
        let Some(mut pile) = ctx.db.building().id().find(&pile_id) else {
            continue;
        };
        if pile.kind != "salvage_pile" {
            continue;
        }
        if building_has_active_trip(ctx, pile.id) || building_has_inbound_supply_trip(ctx, pile.id)
        {
            continue;
        }
        if !has_portable_stock(&pile) {
            ctx.db.building().id().delete(pile.id);
            continue;
        }
        if available_free_haulers(ctx, pile.owner) == 0
            || labor_and_logistics_paused(ctx, tick, pile.owner, clock)
        {
            continue;
        }
        let Some(network) = tick.road_network(pile.owner) else {
            continue;
        };

        for commodity in RECOVERY_ORDER {
            let stock = building_commodity_stock(&pile, commodity);
            if stock <= EPSILON {
                continue;
            }
            let target = tick
                .owner_building_ids(ctx, pile.owner)
                .into_iter()
                .filter_map(|target_id| ctx.db.building().id().find(&target_id))
                .filter_map(|target| {
                    if target.id == pile.id
                        || target.kind == "salvage_pile"
                        || !target.construction_complete
                        || tick.building_disabled_by_fire(ctx, target.id)
                        || building_has_inbound_supply_trip(ctx, target.id)
                        || building_commodity_room(&target, commodity) <= EPSILON
                    {
                        return None;
                    }
                    let priority = reclamation_destination_priority(commodity, &target.kind)?;
                    let distance =
                        network.road_path_distance(pile.x, pile.z, target.x, target.z)?;
                    (distance > EPSILON).then_some((target, priority, distance))
                })
                .min_by(|a, b| {
                    a.1.cmp(&b.1)
                        .then_with(|| a.2.total_cmp(&b.2))
                        .then_with(|| a.0.id.cmp(&b.0.id))
                })
                .map(|candidate| candidate.0);
            let Some(target) = target else {
                continue;
            };

            if try_start_building_supply_trip(
                ctx,
                tick,
                clock,
                network,
                &mut pile,
                &target,
                1,
                commodity,
                TIMBER_DELIVERY_SPEED_MPS,
                TIMBER_DELIVERY_UNLOAD_SEC,
                STOREHOUSE_HAUL_PER_WORKER,
                stock,
            ) {
                ctx.db.building().id().update(pile);
                break;
            }
        }
    }
}

fn reclamation_destination_priority(commodity: CommodityKind, kind: &str) -> Option<u8> {
    match commodity {
        CommodityKind::Gold => match kind {
            "town_hall" => Some(0),
            "founders_camp" => Some(1),
            _ => None,
        },
        CommodityKind::Timber | CommodityKind::Stone => match kind {
            "village_storehouse" => Some(0),
            "founders_camp" => Some(1),
            "marketplace" => Some(2),
            _ => Some(3),
        },
        CommodityKind::Firewood => match kind {
            "village_storehouse" => Some(0),
            "founders_camp" => Some(1),
            "marketplace" | "woodcutters_lodge" => Some(2),
            _ => Some(3),
        },
        CommodityKind::Food
        | CommodityKind::Grain
        | CommodityKind::Flour
        | CommodityKind::PreservedFood => match kind {
            "granary" => Some(0),
            "marketplace" => Some(1),
            "founders_camp" => Some(2),
            _ => Some(3),
        },
        CommodityKind::Ale | CommodityKind::Honey | CommodityKind::Wine => match kind {
            "marketplace" => Some(0),
            "monastery" => Some(1),
            "founders_camp" => Some(2),
            _ => Some(3),
        },
        CommodityKind::Ironwork => match kind {
            "carpenter" => Some(0),
            "marketplace" => Some(1),
            "founders_camp" => Some(2),
            _ => Some(3),
        },
        CommodityKind::Polearms => match kind {
            "guardhouse" => Some(0),
            "carpenter" => Some(1),
            "founders_camp" => Some(2),
            _ => Some(3),
        },
        CommodityKind::Wool => match kind {
            "weaver" => Some(0),
            "pastoral_farmstead" => Some(1),
            "founders_camp" => Some(2),
            _ => Some(3),
        },
        CommodityKind::Cloth => match kind {
            "marketplace" => Some(0),
            "weaver" => Some(1),
            "founders_camp" => Some(2),
            _ => Some(3),
        },
        CommodityKind::Water => match kind {
            "well" => Some(0),
            "founders_camp" => Some(1),
            _ => Some(2),
        },
    }
}

fn has_portable_stock(building: &Building) -> bool {
    RECOVERY_ORDER
        .into_iter()
        .any(|commodity| building_commodity_stock(building, commodity) > EPSILON)
}
