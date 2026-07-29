use spacetimedb::ReducerContext;

use crate::building_defs::building_def;
use crate::civilian_tool_policy::{
    civilian_tool_throughput_multiplier, civilian_tools_maintained,
};
use crate::balance_generated::CIVILIAN_TOOL_IRONWORK_PER_CYCLE;
use crate::constants::{STONE_PER_HARVEST, TICK_DT};
use crate::db::*;
use crate::economy::{
    building_storage_caps, deposit_building, withdraw_building_commodity, CommodityKind,
};
use crate::simulation::delivery_trips::onsite_building_labor;
use crate::simulation::game_calendar::GameClock;
use crate::simulation::labor_and_logistics_paused;
use crate::simulation::spatial::find_nearest_quarry;
use crate::simulation::SimTickContext;
use crate::tables::{Building, Quarry};

pub fn step_stone_quarry(
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
    let work_radius = def.work_radius;

    let onsite_labor = onsite_building_labor(ctx, &building);
    if onsite_labor == 0 {
        return;
    }

    let tools_maintained = civilian_tools_maintained(building.ironwork);
    let throughput_multiplier = civilian_tool_throughput_multiplier(building.ironwork);
    let cooldown = (building.action_cooldown - TICK_DT * throughput_multiplier).max(0.0);
    if cooldown > 0.0 {
        ctx.db.building().id().update(Building {
            action_cooldown: cooldown,
            ..building
        });
        return;
    }

    let labor_interval = interval / onsite_labor as f64;

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
    if tools_maintained {
        withdraw_building_commodity(
            &mut updated,
            CommodityKind::Ironwork,
            CIVILIAN_TOOL_IRONWORK_PER_CYCLE,
        );
    }
    updated.action_cooldown = labor_interval;
    ctx.db.building().id().update(updated);
}
