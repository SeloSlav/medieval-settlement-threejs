use spacetimedb::{reducer, ReducerContext};

use crate::db::*;
use crate::tables::{ForagingNode, Quarry, TreeEntity};
use crate::types::{ForagingBootstrap, QuarryBootstrap, TreeBootstrap};

#[reducer]
pub fn bootstrap_quarries(ctx: &ReducerContext, quarries: Vec<QuarryBootstrap>) -> Result<(), String> {
    for quarry in quarries {
        if quarry.quarry_id.is_empty() || quarry.max_yield <= 0.0 {
            continue;
        }
        if let Some(existing) = ctx.db.quarry().quarry_id().find(&quarry.quarry_id) {
            ctx.db.quarry().quarry_id().update(Quarry {
                x: quarry.x,
                z: quarry.z,
                max_yield: quarry.max_yield,
                remaining: existing.remaining.min(quarry.max_yield),
                ..existing
            });
        } else {
            ctx.db.quarry().insert(Quarry {
                quarry_id: quarry.quarry_id,
                x: quarry.x,
                z: quarry.z,
                max_yield: quarry.max_yield,
                remaining: quarry.max_yield,
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
            ctx.db.foraging_node().node_id().update(ForagingNode {
                x: node.x,
                z: node.z,
                max_yield: node.max_yield,
                remaining: existing.remaining.min(node.max_yield),
                anchor_x: node.anchor_x,
                anchor_z: node.anchor_z,
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
