use spacetimedb::ReducerContext;

use crate::db::*;
use crate::harvest_reserve_policy::protected_wild_stock;

pub fn foraging_nodes_in_radius(ctx: &ReducerContext, x: f64, z: f64, radius: f64) -> Vec<crate::tables::ForagingNode> {
    if !crate::realm::ENABLED { return ctx.db.foraging_node().iter().collect(); }
    crate::realm_policy::chunks_in_radius(x, z, radius).into_iter()
        .flat_map(|chunk| ctx.db.foraging_node().chunk_id().filter(chunk)).collect()
}

pub fn quarries_in_radius(ctx: &ReducerContext, x: f64, z: f64, radius: f64) -> Vec<crate::tables::Quarry> {
    if !crate::realm::ENABLED { return ctx.db.quarry().iter().collect(); }
    crate::realm_policy::chunks_in_radius(x, z, radius).into_iter()
        .flat_map(|chunk| ctx.db.quarry().chunk_id().filter(chunk)).collect()
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

    for node in foraging_nodes_in_radius(ctx, x, z, radius) {
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
