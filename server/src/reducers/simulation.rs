use spacetimedb::ReducerContext;

use crate::db::*;
use crate::simulation::{
    labor_and_logistics_paused, step_backyard_gardens,
    step_chapels, step_chapel_parish, step_delivery_trips, step_foragers_shed, step_foraging_respawn,
    step_hunters_hall, step_lumber_mill, step_reforester, step_residence, step_stone_quarry,
    step_well, step_woodcutters_lodge, SimTickContext,
};
use crate::tables::WorldConfig;
use crate::tables::{Building, Residence};

pub fn run_sim_tick(ctx: &ReducerContext, _schedule: crate::schedule::SimTickSchedule) {
    if let Some(config) = ctx.db.world_config().id().find(&0) {
        ctx.db.world_config().id().update(WorldConfig {
            sim_tick: config.sim_tick + 1,
            ..config
        });
    }

    step_foraging_respawn(ctx);

    let sim_tick = ctx
        .db
        .world_config()
        .id()
        .find(&0)
        .map(|config| config.sim_tick)
        .unwrap_or(0);
    let clock = crate::simulation::game_clock(sim_tick);

    let tick = SimTickContext::new(ctx);
    step_delivery_trips(ctx, &tick, &clock);

    let mut lumber_mill_ids: Vec<u64> = Vec::new();
    let mut reforester_ids: Vec<u64> = Vec::new();
    let mut stone_quarry_ids: Vec<u64> = Vec::new();
    let mut woodcutters_lodge_ids: Vec<u64> = Vec::new();
    let mut well_ids: Vec<u64> = Vec::new();
    let mut hunters_hall_ids: Vec<u64> = Vec::new();
    let mut foragers_shed_ids: Vec<u64> = Vec::new();

    for building in ctx.db.building().iter() {
        let Some(sim_kind) =
            crate::building_defs::building_def(&building.kind).and_then(|def| def.sim_kind)
        else {
            continue;
        };
        match sim_kind {
            crate::building_defs::BuildingSimKind::LumberMill => lumber_mill_ids.push(building.id),
            crate::building_defs::BuildingSimKind::Reforester => reforester_ids.push(building.id),
            crate::building_defs::BuildingSimKind::StoneQuarry => stone_quarry_ids.push(building.id),
            crate::building_defs::BuildingSimKind::WoodcuttersLodge => {
                woodcutters_lodge_ids.push(building.id)
            }
            crate::building_defs::BuildingSimKind::Well => well_ids.push(building.id),
            crate::building_defs::BuildingSimKind::HuntersHall => hunters_hall_ids.push(building.id),
            crate::building_defs::BuildingSimKind::ForagersShed => {
                foragers_shed_ids.push(building.id)
            }
        }
    }

    for building_id in reforester_ids {
        let Some(building) = ctx.db.building().id().find(&building_id) else {
            continue;
        };
        if labor_and_logistics_paused(ctx, building.owner, &clock) {
            continue;
        }
        step_reforester(ctx, building);
    }

    for building_id in lumber_mill_ids {
        let Some(building) = ctx.db.building().id().find(&building_id) else {
            continue;
        };
        step_lumber_mill(ctx, &tick, &clock, building);
    }

    for building_id in stone_quarry_ids {
        let Some(building) = ctx.db.building().id().find(&building_id) else {
            continue;
        };
        if labor_and_logistics_paused(ctx, building.owner, &clock) {
            continue;
        }
        step_stone_quarry(ctx, building);
    }

    for building_id in hunters_hall_ids {
        let Some(building) = ctx.db.building().id().find(&building_id) else {
            continue;
        };
        step_hunters_hall(ctx, &tick, &clock, building);
    }

    for building_id in foragers_shed_ids {
        let Some(building) = ctx.db.building().id().find(&building_id) else {
            continue;
        };
        step_foragers_shed(ctx, &tick, &clock, building);
    }

    for building_id in woodcutters_lodge_ids {
        let Some(building) = ctx.db.building().id().find(&building_id) else {
            continue;
        };
        step_woodcutters_lodge(ctx, &tick, &clock, building);
    }

    for building_id in well_ids {
        let Some(building) = ctx.db.building().id().find(&building_id) else {
            continue;
        };
        step_well(ctx, &tick, sim_tick, &clock, building);
    }

    step_backyard_gardens(ctx, &tick, &clock);

    let chapels: Vec<Building> = ctx
        .db
        .building()
        .iter()
        .filter(|building| building.kind == "chapel")
        .collect();

    step_chapels(ctx, &tick, sim_tick, &chapels);

    let residences: Vec<Residence> = ctx.db.residence().iter().collect();
    step_chapel_parish(ctx, &tick, sim_tick, &chapels, &residences);

    for residence in residences {
        step_residence(ctx, &tick, &chapels, residence);
    }
}
