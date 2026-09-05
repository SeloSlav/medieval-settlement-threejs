use spacetimedb::ReducerContext;

use crate::building_defs::building_def;
use crate::db::*;
use crate::ox_policy::ox_amplified_worker_count;
use crate::simulation::delivery_trips::onsite_building_labor;
use crate::simulation::game_calendar::GameClock;
use crate::simulation::labor_and_logistics_paused;
use crate::simulation::SimTickContext;
use crate::tables::{Building, TreeEntity};
use crate::tree_regrowth_policy::{
    natural_tree_growth_per_second, reforester_growth_per_tree_per_second,
    tree_regrowth_step_seconds, tree_regrowth_update_due, TREE_SAPLING_PHASE_THRESHOLD,
};
use crate::tree_work_area_policy::{effective_tree_work_area, tree_work_area_contains};

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
    let onsite_labor = onsite_building_labor(ctx, &building);
    if onsite_labor == 0 {
        return;
    }

    let work_area = effective_tree_work_area(
        building.x,
        building.z,
        def.work_radius,
        building.tree_work_area_x,
        building.tree_work_area_z,
        building.tree_work_area_radius,
    );
    let recovering_trees: Vec<TreeEntity> = ctx
        .db
        .tree_entity()
        .iter()
        .filter(|tree| {
            if !matches!(tree.phase.as_str(), "stump" | "growing") {
                return false;
            }
            tree_work_area_contains(work_area, tree.x, tree.z)
        })
        .collect();
    let paired_oxen =
        crate::simulation::paired_production_ox_count(ctx, tick, &building, onsite_labor);
    let productive_labor = ox_amplified_worker_count(onsite_labor, paired_oxen);
    let growth_increment =
        reforester_growth_per_tree_per_second(recovering_trees.len(), productive_labor)
            * tree_regrowth_step_seconds()
            * tick.land_use_profile(ctx).forestry_multiplier();
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
        harvest_owner: if phase == "mature" { None } else { tree.harvest_owner },
        phase: phase.to_string(),
        growth_progress,
        ..tree
    }
}
