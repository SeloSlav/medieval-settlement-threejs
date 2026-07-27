//! Physical recovery of goods left where a structure was dismantled.

use std::collections::HashMap;

use spacetimedb::ReducerContext;

use crate::balance_generated::{
    STOREHOUSE_HAUL_PER_WORKER, TIMBER_DELIVERY_SPEED_MPS, TIMBER_DELIVERY_UNLOAD_SEC,
};
use crate::building_defs::building_def;
use crate::construction_priority::CONSTRUCTION_PRIORITY_NORMAL;
use crate::db::*;
use crate::economy::{building_commodity_room, building_commodity_stock, CommodityKind};
use crate::reducers::buildings::next_available_building_id;
use crate::simulation::delivery_trips::{
    available_free_haulers, building_has_active_trip, building_has_inbound_supply_trip,
    try_start_building_supply_trip,
};
use crate::simulation::{labor_and_logistics_paused, GameClock, SimTickContext};
use crate::tables::{Building, WorldConfig};

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

#[derive(Clone, Copy, Debug, Default)]
pub struct ReclamationStock {
    pub timber: f64,
    pub stone: f64,
}

impl ReclamationStock {
    pub fn is_empty(self) -> bool {
        self.timber <= EPSILON && self.stone <= EPSILON
    }
}

/// Material produced by a physical-world demolition must begin at that
/// footprint rather than appearing in a remote depot. The temporary Building
/// row reuses the existing cart, marker, inspector, save, and collision paths.
/// Legacy settlements keep their old abstract refund path.
pub fn insert_reclamation_pile(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    x: f64,
    z: f64,
    stock: ReclamationStock,
) -> Result<bool, String> {
    let physical_reclamation = ctx
        .db
        .player_resources()
        .owner()
        .find(&owner)
        .is_some_and(|resources| resources.physical_founding_site_enabled);
    if !physical_reclamation {
        return Ok(false);
    }
    if stock.is_empty() {
        return Ok(true);
    }

    let salvage_def = building_def("salvage_pile")
        .ok_or_else(|| "Reclamation pile balance is missing.".to_string())?;
    let config = ctx
        .db
        .world_config()
        .id()
        .find(&0)
        .ok_or_else(|| "World not initialized.".to_string())?;
    let building_id = next_available_building_id(ctx, config.next_building_id)?;
    ctx.db.building().insert(Building {
        id: building_id,
        owner,
        kind: "salvage_pile".into(),
        x,
        z,
        work_radius: salvage_def.work_radius,
        action_cooldown: 0.0,
        timber: stock.timber.max(0.0),
        firewood: 0.0,
        stone: stock.stone.max(0.0),
        water: 0.0,
        food: 0.0,
        grain: 0.0,
        flour: 0.0,
        ale: 0.0,
        preserved_food: 0.0,
        honey: 0.0,
        wine: 0.0,
        ironwork: 0.0,
        polearms: 0.0,
        water_capacity: 0.0,
        assigned_labor: 0,
        storehouse_accepts_timber: true,
        storehouse_accepts_stone: true,
        storehouse_accepts_firewood: true,
        gold: 0.0,
        construction_complete: true,
        construction_progress: 1.0,
        construction_required_timber: 0.0,
        construction_required_stone: 0.0,
        construction_delivered_timber: 0.0,
        construction_delivered_stone: 0.0,
        construction_reserved_timber: 0.0,
        construction_reserved_stone: 0.0,
        construction_treasury_timber: 0.0,
        construction_treasury_stone: 0.0,
        granary_accepts_fresh_food: true,
        granary_households_first: false,
        construction_priority: CONSTRUCTION_PRIORITY_NORMAL,
        woodcutter_timber_reserve: 0.0,
        granary_grain_reserve: 0.0,
        harvest_reserve_percent: 0,
        wool: 0.0,
        cloth: 0.0,
        carpenter_polearm_reserve: 0,
        guardhouse_pay_priority: 0,
        marketplace_ironwork_target: 0,
        marketplace_specialty_export_policy: 0,
        granary_fresh_food_target_percent:
            crate::granary_policy::GRANARY_FRESH_FOOD_TARGET_DEFAULT_PERCENT,
        storehouse_timber_target_percent:
            crate::storehouse_policy::STOREHOUSE_STOCK_TARGET_DEFAULT_PERCENT,
        storehouse_stone_target_percent:
            crate::storehouse_policy::STOREHOUSE_STOCK_TARGET_DEFAULT_PERCENT,
        storehouse_firewood_target_percent:
            crate::storehouse_policy::STOREHOUSE_STOCK_TARGET_DEFAULT_PERCENT,
        processor_output_target_percent:
            crate::processor_output_policy::PROCESSOR_OUTPUT_TARGET_DEFAULT_PERCENT,
        guardhouse_food_reserve: 0,
        marketplace_seed_grain_target: 0,
        founding_shelter_active: false,
        marketplace_pending_trade_code: 0,
    });
    ctx.db.world_config().id().update(WorldConfig {
        next_building_id: building_id
            .checked_add(1)
            .ok_or_else(|| "No building IDs remain available.".to_string())?,
        ..config
    });
    Ok(true)
}

/// One free hauler at each reachable pile moves one cartload per economy step.
/// Construction has already had first claim on reclaimed timber and stone, so
/// permanent stores clear only what an active worksite did not reserve.
pub fn step_reclamation_piles(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    pile_ids: Vec<u64>,
) {
    let mut free_haulers_by_owner = HashMap::new();
    let mut destination_ids_by_owner = HashMap::new();
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
        let free_haulers = *free_haulers_by_owner
            .entry(pile.owner)
            .or_insert_with(|| available_free_haulers(ctx, pile.owner));
        if free_haulers == 0 || labor_and_logistics_paused(ctx, tick, pile.owner, clock) {
            continue;
        }
        let Some(network) = tick.road_network(pile.owner) else {
            continue;
        };
        let destination_ids = destination_ids_by_owner
            .entry(pile.owner)
            .or_insert_with(|| tick.owner_building_ids(ctx, pile.owner));

        for commodity in RECOVERY_ORDER {
            let stock = building_commodity_stock(&pile, commodity);
            if stock <= EPSILON {
                continue;
            }
            let target = destination_ids
                .iter()
                .filter_map(|target_id| ctx.db.building().id().find(target_id))
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
                if let Some(remaining) = free_haulers_by_owner.get_mut(&target.owner) {
                    *remaining = remaining.saturating_sub(1);
                }
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

#[cfg(test)]
mod tests {
    use super::ReclamationStock;

    #[test]
    fn empty_reclamation_stock_ignores_numeric_dust() {
        assert!(ReclamationStock::default().is_empty());
        assert!(ReclamationStock {
            timber: 1e-8,
            stone: 0.0,
        }
        .is_empty());
        assert!(!ReclamationStock {
            timber: 0.0,
            stone: 1.0,
        }
        .is_empty());
    }
}
