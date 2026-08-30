use spacetimedb::ReducerContext;

use crate::balance_generated::CIVILIAN_TOOL_IRONWORK_PER_CYCLE;
use crate::building_defs::building_def;
use crate::civilian_tool_policy::{civilian_tool_throughput_multiplier, civilian_tools_maintained};
use crate::constants::{MILL_WATER_PER_HARVEST, TICK_DT};
use crate::db::*;
use crate::economy::{
    building_commodity_room, building_storage_caps, building_water_storage_cap, deposit_building,
    withdraw_building_water, CommodityKind,
};
use crate::production_maintenance::charge_completed_production_maintenance;
use crate::simulation::delivery_trips::onsite_building_labor;
use crate::simulation::game_calendar::GameClock;
use crate::simulation::spatial::find_nearest_mature_tree;
use crate::simulation::tick_context::SimTickContext;
use crate::simulation::{labor_and_logistics_paused, ox_amplified_production_labor};
use crate::tables::{Building, TreeEntity};
use crate::tree_work_area_policy::effective_tree_work_area;

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

    let onsite_labor = onsite_building_labor(ctx, &building);
    let productive_labor = ox_amplified_production_labor(ctx, tick, &building, onsite_labor);
    if productive_labor <= 1e-9 {
        return;
    }

    let tools_maintained = civilian_tools_maintained(building.ironwork);
    let selected_rate = crate::production_rate_policy::production_rate_multiplier(
        building.production_rate_percent,
    );
    if selected_rate <= 1e-9 {
        return;
    }
    let throughput_multiplier = civilian_tool_throughput_multiplier(building.ironwork)
        * selected_rate
        * tick.land_use_profile(ctx).forestry_multiplier();
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
    let timber_room = building_commodity_room(&building, CommodityKind::Timber);
    if timber_room <= 1e-6 {
        ctx.db.building().id().update(building);
        return;
    }

    let mill = building;
    if mill.water + 1e-6 < MILL_WATER_PER_HARVEST {
        ctx.db.building().id().update(mill);
        return;
    }

    let work_area = effective_tree_work_area(
        mill.x,
        mill.z,
        def.work_radius,
        mill.tree_work_area_x,
        mill.tree_work_area_z,
        mill.tree_work_area_radius,
    );
    let Some(target) = find_nearest_mature_tree(ctx, mill.x, mill.z, work_area) else {
        ctx.db.building().id().update(mill);
        return;
    };

    let tree_yield = crate::resource_units::whole_units(target.wood_yield);
    if tree_yield < 1.0 || timber_room + 1e-6 < tree_yield {
        ctx.db.building().id().update(mill);
        return;
    }

    let (timber_deposited, _, _, updated) = deposit_building(&mill, caps, tree_yield, 0.0, 0.0);
    if timber_deposited != tree_yield {
        ctx.db.building().id().update(mill);
        return;
    }

    let (_, mut harvested) = withdraw_building_water(&updated, MILL_WATER_PER_HARVEST);
    if tools_maintained {
        charge_completed_production_maintenance(
            &mut harvested,
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
