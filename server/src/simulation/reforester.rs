use spacetimedb::ReducerContext;

use crate::building_defs::building_def;
use crate::constants::{REFORESTER_REGROW_PER_SEC, TICK_DT};
use crate::db::*;
use crate::simulation::game_calendar::GameClock;
use crate::simulation::labor_and_logistics_paused;
use crate::simulation::SimTickContext;
use crate::tables::{Building, TreeEntity};

enum ReforesterTreeUpdate {
    StartGrowing { growth_progress: f64 },
    AdvanceGrowing { growth_progress: f64 },
    Mature,
}

pub fn step_reforester(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    building: Building,
) {
    if labor_and_logistics_paused(ctx, tick, building.owner, clock) {
        return;
    }

    let Some(def) = building_def(&building.kind) else {
        return;
    };
    if building.assigned_labor == 0 {
        return;
    }

    let work_radius = def.work_radius;
    let radius_sq = work_radius * work_radius;
    let regrow_rate = REFORESTER_REGROW_PER_SEC * building.assigned_labor as f64;
    let mut pending_updates: Vec<(String, ReforesterTreeUpdate)> = Vec::new();

    for tree in ctx.db.tree_entity().iter() {
        let dx = tree.x - building.x;
        let dz = tree.z - building.z;
        if dx * dx + dz * dz > radius_sq {
            continue;
        }

        match tree.phase.as_str() {
            "stump" => {
                pending_updates.push((
                    tree.tree_id.clone(),
                    ReforesterTreeUpdate::StartGrowing {
                        growth_progress: regrow_rate * TICK_DT,
                    },
                ));
            }
            "growing" => {
                let progress = tree.growth_progress + regrow_rate * TICK_DT;
                if progress >= 1.0 {
                    pending_updates.push((tree.tree_id.clone(), ReforesterTreeUpdate::Mature));
                } else {
                    pending_updates.push((
                        tree.tree_id.clone(),
                        ReforesterTreeUpdate::AdvanceGrowing {
                            growth_progress: progress,
                        },
                    ));
                }
            }
            _ => {}
        }
    }

    for (tree_id, update) in pending_updates {
        let Some(tree) = ctx.db.tree_entity().tree_id().find(&tree_id) else {
            continue;
        };
        match update {
            ReforesterTreeUpdate::StartGrowing { growth_progress } => {
                ctx.db.tree_entity().tree_id().update(TreeEntity {
                    phase: "growing".to_string(),
                    growth_progress,
                    ..tree
                });
            }
            ReforesterTreeUpdate::AdvanceGrowing { growth_progress } => {
                ctx.db.tree_entity().tree_id().update(TreeEntity {
                    growth_progress,
                    ..tree
                });
            }
            ReforesterTreeUpdate::Mature => {
                ctx.db.tree_entity().tree_id().update(TreeEntity {
                    phase: "mature".to_string(),
                    growth_progress: 1.0,
                    ..tree
                });
            }
        }
    }
}
