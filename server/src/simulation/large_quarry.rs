use spacetimedb::ReducerContext;

use crate::balance_generated::CIVILIAN_TOOL_IRONWORK_PER_CYCLE;
use crate::building_defs::building_def;
use crate::civilian_tool_policy::{civilian_tool_throughput_multiplier, civilian_tools_maintained};
use crate::constants::{STONE_PER_HARVEST, TICK_DT};
use crate::db::*;
use crate::economy::{
    building_storage_caps, deposit_building, withdraw_building_commodity, CommodityKind,
};
use crate::simulation::delivery_trips::onsite_building_labor;
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

fn rich_deposit_beneath(ctx: &ReducerContext, x: f64, z: f64) -> Option<Quarry> {
    let tolerance_sq = RICH_DEPOSIT_CENTER_TOLERANCE * RICH_DEPOSIT_CENTER_TOLERANCE;
    ctx.db.quarry().iter().find(|quarry| {
        quarry.is_rich
            && (quarry.x - x) * (quarry.x - x) + (quarry.z - z) * (quarry.z - z) <= tolerance_sq
    })
}
