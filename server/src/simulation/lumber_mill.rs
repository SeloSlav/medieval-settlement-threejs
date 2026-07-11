use spacetimedb::ReducerContext;

use crate::building_defs::building_def;
use crate::constants::{MILL_WATER_PER_HARVEST, TICK_DT};
use crate::db::*;
use crate::economy::{building_storage_caps, building_water_storage_cap, deposit_building, withdraw_building_water};
use crate::simulation::spatial::find_nearest_mature_tree;
use crate::simulation::tick_context::SimTickContext;
use crate::simulation::water_logistics::{building_has_road_connected_well, ensure_building_water};
use crate::tables::{Building, TreeEntity};

pub fn step_lumber_mill(ctx: &ReducerContext, tick: &SimTickContext, building: Building) {
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

    if !building_has_road_connected_well(tick, ctx, &building) {
        ctx.db.building().id().update(Building {
            action_cooldown: labor_interval,
            ..building
        });
        return;
    }

    let caps = building_storage_caps(&building.kind);
    let timber_room = (caps.timber - building.timber).max(0.0);
    if timber_room <= 1e-6 {
        ctx.db.building().id().update(Building {
            action_cooldown: labor_interval,
            ..building
        });
        return;
    }

    let Some(network) = tick.road_network(building.owner) else {
        ctx.db.building().id().update(Building {
            action_cooldown: labor_interval,
            ..building
        });
        return;
    };

    let mill = ensure_building_water(ctx, tick, network, building, MILL_WATER_PER_HARVEST);
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
