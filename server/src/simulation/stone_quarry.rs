use spacetimedb::ReducerContext;

use crate::building_defs::building_def;
use crate::constants::{STONE_PER_HARVEST, TICK_DT};
use crate::db::*;
use crate::economy::{building_storage_caps, deposit_building};
use crate::simulation::game_calendar::GameClock;
use crate::simulation::labor_and_logistics_paused;
use crate::simulation::spatial::find_nearest_quarry;
use crate::tables::{Building, Quarry};

pub fn step_stone_quarry(ctx: &ReducerContext, clock: &GameClock, building: Building) {
    if labor_and_logistics_paused(ctx, building.owner, clock) {
        return;
    }

    let Some(def) = building_def(&building.kind) else {
        return;
    };
    let interval = def.action_interval;
    let work_radius = def.work_radius;

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
    if building.stone >= caps.stone - 1e-6 {
        ctx.db.building().id().update(Building {
            action_cooldown: labor_interval,
            ..building
        });
        return;
    }

    let Some(quarry) = find_nearest_quarry(ctx, building.x, building.z, work_radius) else {
        ctx.db.building().id().update(Building {
            action_cooldown: labor_interval,
            ..building
        });
        return;
    };

    let extracted = STONE_PER_HARVEST.min(quarry.remaining);
    if extracted <= 0.0 {
        ctx.db.building().id().update(Building {
            action_cooldown: labor_interval,
            ..building
        });
        return;
    }

    ctx.db.quarry().quarry_id().update(Quarry {
        remaining: quarry.remaining - extracted,
        ..quarry
    });

    let (_, _, _, mut updated) = deposit_building(&building, caps, 0.0, 0.0, extracted);
    updated.action_cooldown = labor_interval;
    ctx.db.building().id().update(updated);
}
