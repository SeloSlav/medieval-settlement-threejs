use spacetimedb::ReducerContext;

use crate::building_defs::building_def;
use crate::constants::{STONE_PER_HARVEST, TICK_DT};
use crate::db::*;
use crate::economy::{building_storage_caps, deposit_building};
use crate::simulation::game_calendar::GameClock;
use crate::simulation::labor_and_logistics_paused;
use crate::simulation::SimTickContext;
use crate::tables::{Building, Quarry};

const RICH_DEPOSIT_CENTER_TOLERANCE: f64 = 2.5;

/// Produces from the underground source of the rich deposit beneath the
/// building. This deliberately never mutates the finite surface reserve.
pub fn step_large_quarry(
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
    let interval = def.action_interval;
    let cooldown = (building.action_cooldown - TICK_DT).max(0.0);
    if cooldown > 0.0 {
        ctx.db.building().id().update(Building {
            action_cooldown: cooldown,
            ..building
        });
        return;
    }

    if building.assigned_labor == 0 {
        ctx.db.building().id().update(Building {
            action_cooldown: interval,
            ..building
        });
        return;
    }

    let labor_interval = interval / building.assigned_labor as f64;
    let caps = building_storage_caps(&building.kind);
    if building.stone >= caps.stone - 1e-6
        || rich_deposit_beneath(ctx, building.x, building.z).is_none()
    {
        ctx.db.building().id().update(Building {
            action_cooldown: labor_interval,
            ..building
        });
        return;
    }

    let produced = STONE_PER_HARVEST.min((caps.stone - building.stone).max(0.0));
    let (_, _, _, mut updated) = deposit_building(&building, caps, 0.0, 0.0, produced);
    updated.action_cooldown = labor_interval;
    ctx.db.building().id().update(updated);
}

fn rich_deposit_beneath(ctx: &ReducerContext, x: f64, z: f64) -> Option<Quarry> {
    let tolerance_sq = RICH_DEPOSIT_CENTER_TOLERANCE * RICH_DEPOSIT_CENTER_TOLERANCE;
    ctx.db.quarry().iter().find(|quarry| {
        quarry.is_rich
            && (quarry.x - x) * (quarry.x - x) + (quarry.z - z) * (quarry.z - z) <= tolerance_sq
    })
}
