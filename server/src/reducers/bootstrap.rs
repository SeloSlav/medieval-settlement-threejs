use spacetimedb::{reducer, ReducerContext};

use crate::building_defs::building_def;
use crate::construction_priority::CONSTRUCTION_PRIORITY_NORMAL;
use crate::db::*;
use crate::foraging_policy::preserves_runtime_location_during_bootstrap;
use crate::granary_policy::GRANARY_FRESH_FOOD_TARGET_DEFAULT_PERCENT;
use crate::lifecycle::ensure_player_resources;
use crate::processor_output_policy::PROCESSOR_OUTPUT_TARGET_DEFAULT_PERCENT;
use crate::quarry_balance::preserve_extracted_stone;
use crate::reducers::buildings::next_available_building_id;
use crate::storehouse_policy::STOREHOUSE_STOCK_TARGET_DEFAULT_PERCENT;
use crate::tables::{Building, ForagingNode, Quarry, TreeEntity, WorldConfig};
use crate::types::{ForagingBootstrap, QuarryBootstrap, TreeBootstrap};

#[reducer]
pub fn bootstrap_quarries(
    ctx: &ReducerContext,
    quarries: Vec<QuarryBootstrap>,
) -> Result<(), String> {
    for quarry in quarries {
        if quarry.quarry_id.is_empty() || quarry.max_yield <= 0.0 {
            continue;
        }
        if let Some(existing) = ctx.db.quarry().quarry_id().find(&quarry.quarry_id) {
            // Preserve the absolute amount already extracted when a balance update
            // expands a deposit, so existing worlds receive the additional reserve.
            let rebalanced_remaining =
                preserve_extracted_stone(existing.max_yield, existing.remaining, quarry.max_yield);
            ctx.db.quarry().quarry_id().update(Quarry {
                x: quarry.x,
                z: quarry.z,
                max_yield: quarry.max_yield,
                remaining: rebalanced_remaining,
                is_rich: quarry.is_rich,
                ..existing
            });
        } else {
            ctx.db.quarry().insert(Quarry {
                quarry_id: quarry.quarry_id,
                x: quarry.x,
                z: quarry.z,
                max_yield: quarry.max_yield,
                remaining: quarry.max_yield,
                is_rich: quarry.is_rich,
            });
        }
    }
    Ok(())
}

#[reducer]
pub fn bootstrap_foraging(
    ctx: &ReducerContext,
    nodes: Vec<ForagingBootstrap>,
) -> Result<(), String> {
    for node in nodes {
        if node.node_id.is_empty() || node.max_yield <= 0.0 {
            continue;
        }
        if let Some(existing) = ctx.db.foraging_node().node_id().find(&node.node_id) {
            let preserve_runtime_location =
                preserves_runtime_location_during_bootstrap(&node.node_kind);
            ctx.db.foraging_node().node_id().update(ForagingNode {
                // Disturbed game habitats may have migrated, but plants and
                // fish are static world-layout sites and must stay aligned
                // with the resources rendered by reconnecting clients.
                x: if preserve_runtime_location {
                    existing.x
                } else {
                    node.x
                },
                z: if preserve_runtime_location {
                    existing.z
                } else {
                    node.z
                },
                max_yield: node.max_yield,
                remaining: existing.remaining.min(node.max_yield),
                node_kind: node.node_kind,
                anchor_x: if preserve_runtime_location {
                    existing.anchor_x
                } else {
                    node.anchor_x
                },
                anchor_z: if preserve_runtime_location {
                    existing.anchor_z
                } else {
                    node.anchor_z
                },
                ..existing
            });
        } else {
            ctx.db.foraging_node().insert(ForagingNode {
                node_id: node.node_id,
                node_kind: node.node_kind,
                x: node.x,
                z: node.z,
                max_yield: node.max_yield,
                remaining: node.max_yield,
                respawn_cooldown: 0.0,
                anchor_x: node.anchor_x,
                anchor_z: node.anchor_z,
            });
        }
    }
    Ok(())
}

#[reducer]
pub fn bootstrap_trees(ctx: &ReducerContext, trees: Vec<TreeBootstrap>) -> Result<(), String> {
    for tree in trees {
        if tree.tree_id.is_empty() {
            continue;
        }
        if ctx.db.tree_entity().tree_id().find(&tree.tree_id).is_some() {
            continue;
        }
        ctx.db.tree_entity().insert(TreeEntity {
            tree_id: tree.tree_id,
            layout_index: tree.layout_index,
            phase: "mature".to_string(),
            growth_progress: 1.0,
            wood_yield: tree.wood_yield.max(1.0),
            x: tree.x,
            z: tree.z,
        });
    }
    Ok(())
}

/// Establishes the one physical starting point for a new settlement. Existing
/// saves with any player-authored settlement rows keep their legacy accounting;
/// repeated bootstrap calls are intentionally idempotent.
#[reducer]
pub fn bootstrap_founding_site(ctx: &ReducerContext, x: f64, z: f64) -> Result<(), String> {
    if !x.is_finite() || !z.is_finite() || x.abs() > 10_000.0 || z.abs() > 10_000.0 {
        return Err("Founding-site coordinates are invalid.".into());
    }

    let owner = ctx.sender();
    ensure_player_resources(ctx, owner);
    let Some(mut resources) = ctx.db.player_resources().owner().find(&owner) else {
        return Err("Player resources are unavailable.".into());
    };
    if resources.physical_founding_site_enabled {
        return Ok(());
    }

    let has_existing_settlement = ctx.db.building().owner().filter(&owner).next().is_some()
        || ctx.db.residence().owner().filter(&owner).next().is_some()
        || ctx
            .db
            .burgage_zone()
            .owner()
            .filter(&owner)
            .next()
            .is_some();
    if has_existing_settlement {
        // Additive migration rule: never inject a free camp into a developed
        // legacy save or reinterpret its established population.
        return Ok(());
    }

    let def = building_def("founders_camp")
        .ok_or_else(|| "Founders' camp balance definition is missing.".to_string())?;
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
        kind: "founders_camp".into(),
        x,
        z,
        work_radius: 0.0,
        action_cooldown: 0.0,
        timber: resources.timber.max(0.0),
        firewood: resources.firewood.max(0.0),
        stone: resources.stone.max(0.0),
        water: resources.water.max(0.0),
        food: resources.food.max(0.0),
        grain: resources.grain.max(0.0),
        flour: resources.flour.max(0.0),
        ale: resources.ale.max(0.0),
        preserved_food: resources.preserved_food.max(0.0),
        honey: resources.honey.max(0.0),
        wine: resources.wine.max(0.0),
        ironwork: resources.ironwork.max(0.0),
        polearms: resources.polearms.max(0.0),
        wool: resources.wool.max(0.0),
        cloth: resources.cloth.max(0.0),
        water_capacity: def.storage_water,
        assigned_labor: 0,
        storehouse_accepts_timber: true,
        storehouse_accepts_stone: true,
        storehouse_accepts_firewood: true,
        gold: resources.gold.max(0.0),
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
        carpenter_polearm_reserve: 0,
        guardhouse_pay_priority: 0,
        marketplace_ironwork_target: 0,
        marketplace_specialty_export_policy: 0,
        granary_fresh_food_target_percent: GRANARY_FRESH_FOOD_TARGET_DEFAULT_PERCENT,
        storehouse_timber_target_percent: STOREHOUSE_STOCK_TARGET_DEFAULT_PERCENT,
        storehouse_stone_target_percent: STOREHOUSE_STOCK_TARGET_DEFAULT_PERCENT,
        storehouse_firewood_target_percent: STOREHOUSE_STOCK_TARGET_DEFAULT_PERCENT,
        processor_output_target_percent: PROCESSOR_OUTPUT_TARGET_DEFAULT_PERCENT,
        guardhouse_food_reserve: 0,
        marketplace_seed_grain_target: 0,
        marketplace_pending_trade_code: 0,
        founding_shelter_active: true,
        chapel_monastery_tithe_due: 0.0,
    });

    resources.timber = 0.0;
    resources.firewood = 0.0;
    resources.stone = 0.0;
    resources.water = 0.0;
    resources.food = 0.0;
    resources.grain = 0.0;
    resources.flour = 0.0;
    resources.ale = 0.0;
    resources.preserved_food = 0.0;
    resources.honey = 0.0;
    resources.wine = 0.0;
    resources.ironwork = 0.0;
    resources.polearms = 0.0;
    resources.wool = 0.0;
    resources.cloth = 0.0;
    resources.gold = 0.0;
    resources.physical_founding_site_enabled = true;
    ctx.db.player_resources().owner().update(resources);

    let clearance = def.pick_radius * 1.35;
    let clearance_sq = clearance * clearance;
    let cleared_tree_ids = ctx
        .db
        .tree_entity()
        .iter()
        .filter(|tree| (tree.x - x).powi(2) + (tree.z - z).powi(2) <= clearance_sq)
        .map(|tree| tree.tree_id)
        .collect::<Vec<_>>();
    for tree_id in cleared_tree_ids {
        ctx.db.tree_entity().tree_id().delete(&tree_id);
    }

    ctx.db.world_config().id().update(WorldConfig {
        next_building_id: building_id
            .checked_add(1)
            .ok_or_else(|| "No building IDs remain available.".to_string())?,
        ..config
    });
    Ok(())
}
