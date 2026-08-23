use spacetimedb::ReducerContext;

use crate::db::*;
use crate::harvest_reserve_policy::protected_wild_stock;
use crate::tree_work_area_policy::{tree_work_area_contains, TreeWorkArea};

pub fn find_nearest_mature_tree(
    ctx: &ReducerContext,
    origin_x: f64,
    origin_z: f64,
    area: TreeWorkArea,
) -> Option<crate::tables::TreeEntity> {
    let mut best: Option<crate::tables::TreeEntity> = None;
    let mut best_dist = f64::INFINITY;

    for tree in ctx.db.tree_entity().iter() {
        if tree.phase != "mature" || !tree_work_area_contains(area, tree.x, tree.z) {
            continue;
        }
        let dx = tree.x - origin_x;
        let dz = tree.z - origin_z;
        let dist_sq = dx * dx + dz * dz;
        if dist_sq >= best_dist {
            continue;
        }
        best_dist = dist_sq;
        best = Some(tree);
    }

    best
}

pub fn find_nearest_harvestable_foraging_node(
    ctx: &ReducerContext,
    x: f64,
    z: f64,
    radius: f64,
    node_kind: &str,
    reserve_percent: u8,
) -> Option<crate::tables::ForagingNode> {
    let radius_sq = radius * radius;
    let mut best: Option<crate::tables::ForagingNode> = None;
    let mut best_dist = f64::INFINITY;

    for node in ctx.db.foraging_node().iter() {
        let protected_stock =
            protected_wild_stock(&node.node_kind, node.max_yield, reserve_percent);
        if node.node_kind != node_kind || node.remaining <= protected_stock + 1e-6 {
            continue;
        }
        let dx = node.x - x;
        let dz = node.z - z;
        let dist_sq = dx * dx + dz * dz;
        if dist_sq > radius_sq || dist_sq >= best_dist {
            continue;
        }
        best_dist = dist_sq;
        best = Some(node);
    }

    best
}
