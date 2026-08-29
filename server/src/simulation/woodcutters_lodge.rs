use spacetimedb::ReducerContext;

use crate::balance_generated::CIVILIAN_TOOL_IRONWORK_PER_CYCLE;
use crate::building_defs::building_def;
use crate::civilian_tool_policy::{civilian_tool_throughput_multiplier, civilian_tools_maintained};
use crate::constants::TICK_DT;
use crate::db::*;
use crate::economy::{
    building_commodity_room, building_storage_caps, deposit_building, CommodityKind,
};
use crate::production_maintenance::charge_completed_production_maintenance;
use crate::simulation::delivery_trips::onsite_building_labor;
use crate::simulation::game_calendar::GameClock;
use crate::simulation::spatial::find_nearest_mature_tree;
use crate::simulation::tick_context::SimTickContext;
use crate::simulation::{labor_and_logistics_paused, ox_amplified_production_labor};
use crate::tables::{Building, TreeEntity};
use crate::tree_work_area_policy::effective_tree_work_area;

/// Woodcutters fell trees directly for firewood. Timber remains the lumber
/// mill's construction resource; it is not an input to this building.
pub fn step_woodcutters_lodge(
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
    let onsite_labor = onsite_building_labor(ctx, &building);
    let productive_labor = ox_amplified_production_labor(ctx, tick, &building, onsite_labor);
    if productive_labor <= 1e-9 {
        return;
    }

    let selected_rate = crate::production_rate_policy::production_rate_multiplier(
        building.production_rate_percent,
    );
    if selected_rate <= 1e-9 {
        return;
    }
    let tools_maintained = civilian_tools_maintained(building.ironwork);
    let throughput_multiplier =
        civilian_tool_throughput_multiplier(building.ironwork) * selected_rate;
    let cooldown = (building.action_cooldown - TICK_DT * throughput_multiplier).max(0.0);
    if cooldown > 0.0 {
        ctx.db.building().id().update(Building {
            action_cooldown: cooldown,
            ..building
        });
        return;
    }

    let caps = building_storage_caps(&building.kind);
    let firewood_room = building_commodity_room(&building, CommodityKind::Firewood);
    if firewood_room <= 1e-6 {
        ctx.db.building().id().update(building);
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
    let Some(target) = find_nearest_mature_tree(ctx, building.x, building.z, work_area) else {
        ctx.db.building().id().update(building);
        return;
    };

    // The shared tree yield gives both wood industries the same authored tree
    // value. A lodge converts that yield directly into split firewood instead
    // of manufacturing firewood from construction timber.
    let firewood_yield = crate::resource_units::whole_units(target.wood_yield);
    if firewood_yield < 1.0 || firewood_room + 1e-6 < firewood_yield {
        ctx.db.building().id().update(building);
        return;
    }

    let (_, firewood_deposited, _, mut harvested) =
        deposit_building(&building, caps, 0.0, firewood_yield, 0.0);
    if firewood_deposited != firewood_yield {
        ctx.db.building().id().update(building);
        return;
    }
    if tools_maintained {
        charge_completed_production_maintenance(
            &mut harvested,
            CIVILIAN_TOOL_IRONWORK_PER_CYCLE,
        );
    }

    ctx.db.tree_entity().tree_id().update(TreeEntity {
        phase: "stump".to_string(),
        growth_progress: 0.0,
        ..target
    });

    harvested.action_cooldown = def.action_interval / productive_labor;
    ctx.db.building().id().update(harvested);
}
