use spacetimedb::ReducerContext;

use crate::building_defs::building_def;
use crate::db::*;
use crate::simulation::game_calendar::GameClock;
use crate::simulation::labor_and_logistics_paused;
use crate::simulation::SimTickContext;
use crate::tables::{Building, TreeEntity};
use crate::tree_regrowth_policy::{
    natural_tree_growth_per_second, reforester_growth_per_tree_per_second,
    tree_regrowth_step_seconds, tree_regrowth_update_due, TREE_SAPLING_PHASE_THRESHOLD,
};

pub fn step_natural_tree_regrowth(ctx: &ReducerContext, sim_tick: u64) {
    if !tree_regrowth_update_due(sim_tick) {
        return;
    }

    let growth_increment = natural_tree_growth_per_second() * tree_regrowth_step_seconds();
    let pending_updates: Vec<TreeEntity> = ctx
        .db
        .tree_entity()
        .iter()
        .filter(|tree| matches!(tree.phase.as_str(), "stump" | "growing"))
        .map(|tree| grow_tree(tree, growth_increment))
        .collect();

    for tree in pending_updates {
        ctx.db.tree_entity().tree_id().update(tree);
    }
}

pub fn step_reforester(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    sim_tick: u64,
    building: Building,
) {
    if !tree_regrowth_update_due(sim_tick)
        || labor_and_logistics_paused(ctx, tick, building.owner, clock)
    {
        return;
    }

    let Some(def) = building_def(&building.kind) else {
        return;
    };
    if building.assigned_labor == 0 {
        return;
    }

    let radius_sq = def.work_radius * def.work_radius;
    let recovering_trees: Vec<TreeEntity> = ctx
        .db
        .tree_entity()
        .iter()
        .filter(|tree| {
            if !matches!(tree.phase.as_str(), "stump" | "growing") {
                return false;
            }
            let dx = tree.x - building.x;
            let dz = tree.z - building.z;
            dx * dx + dz * dz <= radius_sq
        })
        .collect();
    let growth_increment = reforester_growth_per_tree_per_second(
        recovering_trees.len(),
        building.assigned_labor,
    ) * tree_regrowth_step_seconds();
    if growth_increment <= 0.0 {
        return;
    }

    for tree in recovering_trees {
        ctx.db
            .tree_entity()
            .tree_id()
            .update(grow_tree(tree, growth_increment));
    }
}

fn grow_tree(tree: TreeEntity, growth_increment: f64) -> TreeEntity {
    let growth_progress = (tree.growth_progress.max(0.0) + growth_increment.max(0.0)).min(1.0);
    let phase = if growth_progress >= 1.0 {
        "mature"
    } else if growth_progress >= TREE_SAPLING_PHASE_THRESHOLD {
        "growing"
    } else {
        "stump"
    };
    TreeEntity {
        phase: phase.to_string(),
        growth_progress,
        ..tree
    }
}
