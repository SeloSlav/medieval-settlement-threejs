use spacetimedb::ReducerContext;

use crate::balance_generated::CIVILIAN_TOOL_IRONWORK_PER_CYCLE;
use crate::building_defs::building_def;
use crate::civilian_tool_policy::{civilian_tool_throughput_multiplier, civilian_tools_maintained};
use crate::constants::{MILL_WATER_PER_HARVEST, TICK_DT};
use crate::db::*;
use crate::economy::{
    building_storage_caps, building_water_storage_cap, deposit_building,
    withdraw_building_commodity, withdraw_building_water, CommodityKind,
};
use crate::simulation::delivery_trips::onsite_building_labor;
use crate::simulation::game_calendar::GameClock;
use crate::simulation::spatial::find_nearest_mature_tree;
use crate::simulation::tick_context::SimTickContext;
use crate::simulation::{commute_adjusted_labor, labor_and_logistics_paused};
use crate::tables::{Building, TreeEntity};

pub fn step_lumber_mill(
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
    let productive_labor = commute_adjusted_labor(ctx, tick, &building, onsite_labor);
    if productive_labor <= 1e-9 {
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

    let labor_interval = interval / productive_labor;

    let caps = building_storage_caps(&building.kind);
    let timber_room = (caps.timber - building.timber).max(0.0);
    if timber_room <= 1e-6 {
        ctx.db.building().id().update(Building {
            action_cooldown: labor_interval,
            ..building
        });
        return;
    }

    let mill = building;
    if mill.water + 1e-6 < MILL_WATER_PER_HARVEST {
        ctx.db.building().id().update(Building {
            action_cooldown: labor_interval,
            ..mill
        });
        return;
    }

    let Some(target) = find_nearest_mature_tree(ctx, mill.x, mill.z, work_radius) else {
        ctx.db.building().id().update(Building {
            action_cooldown: labor_interval,
            ..mill
        });
        return;
    };

    let (timber_deposited, _, _, updated) =
        deposit_building(&mill, caps, target.wood_yield, 0.0, 0.0);
    if timber_deposited <= 1e-6 {
        ctx.db.building().id().update(Building {
            action_cooldown: labor_interval,
            ..mill
        });
        return;
    }

    let (_, mut harvested) = withdraw_building_water(&updated, MILL_WATER_PER_HARVEST);
    if tools_maintained {
        withdraw_building_commodity(
            &mut harvested,
            CommodityKind::Ironwork,
            CIVILIAN_TOOL_IRONWORK_PER_CYCLE,
        );
    }
    let water_cap = building_water_storage_cap(&mill.kind);
    harvested.water = harvested.water.min(water_cap);

    ctx.db.tree_entity().tree_id().update(TreeEntity {
        phase: "stump".to_string(),
        growth_progress: 0.0,
        ..target
    });

    harvested.action_cooldown = labor_interval;
    ctx.db.building().id().update(harvested);
}
