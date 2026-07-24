use spacetimedb::ReducerContext;

use crate::db::*;
use crate::simulation::{
    step_backyard_gardens,
    step_chapels, step_chapel_parish, step_construction_sites, step_delivery_trips, step_fishing_camp, step_foragers_shed, step_foraging_lifecycle,
    step_fresh_food_spoilage,
    step_household_market_orders, step_hunters_hall, step_lumber_mill, step_marketplace_caravans,
    step_large_quarry, step_reforester, step_residence, step_stone_quarry, step_well, step_woodcutters_lodge,
    step_fires, building_is_disabled_by_fire, residence_is_disabled_by_fire,
    step_apiary, step_brewery, step_carpenter, step_ferry_landing,
    step_granary, step_monastery, step_smokehouse, step_threshing_barn, step_vineyard,
    step_watermill, step_pastoral_farmstead, step_swineherd,
    step_village_storehouse,
    SimTickContext,
};
use crate::economy::{reconcile_all_building_labor, step_regional_markets};
use crate::tables::WorldConfig;
use crate::tables::{Building, Residence, SimPacingState};
use crate::balance_generated::{BASE_SPEED_DENOMINATOR, BASE_SPEED_NUMERATOR};

pub fn run_sim_tick(ctx: &ReducerContext, _schedule: crate::schedule::SimTickSchedule) {
    let Some(config) = ctx.db.world_config().id().find(&0) else {
        return;
    };
    if !config.configured || config.game_speed == 0 {
        return;
    }
    let speed = if matches!(config.game_speed, 1 | 4 | 12) {
        config.game_speed
    } else {
        1
    };
    let previous_credit = ctx
        .db
        .sim_pacing_state()
        .id()
        .find(&0)
        .map(|state| state.step_credit)
        .unwrap_or(0);
    let step_budget = previous_credit + speed as u16 * BASE_SPEED_NUMERATOR;
    let substeps = step_budget / BASE_SPEED_DENOMINATOR;
    let next_credit = step_budget % BASE_SPEED_DENOMINATOR;
    if ctx.db.sim_pacing_state().id().find(&0).is_some() {
        ctx.db.sim_pacing_state().id().update(SimPacingState {
            id: 0,
            step_credit: next_credit,
        });
    } else {
        ctx.db.sim_pacing_state().insert(SimPacingState {
            id: 0,
            step_credit: next_credit,
        });
    }
    for _ in 0..substeps {
        run_one_sim_tick(ctx);
    }
}

fn run_one_sim_tick(ctx: &ReducerContext) {
    let Some(config) = ctx.db.world_config().id().find(&0) else {
        return;
    };
    if !config.configured {
        return;
    }

    let world_seed = config.seed;
    let world_hydrology = config.hydrology;
    ctx.db.world_config().id().update(WorldConfig {
        sim_tick: config.sim_tick + 1,
        ..config
    });

    let sim_tick = ctx
        .db
        .world_config()
        .id()
        .find(&0)
        .map(|config| config.sim_tick)
        .unwrap_or(0);
    let clock = crate::simulation::game_clock(sim_tick);
    let environment =
        crate::season_policy::environment_for(world_seed, world_hydrology, &clock);
    step_foraging_lifecycle(ctx, &clock, environment);

    reconcile_all_building_labor(ctx);

    let tick = SimTickContext::new(ctx);
    step_delivery_trips(ctx, &tick, &clock);
    step_fires(ctx, &clock, environment, world_seed, sim_tick);
    step_construction_sites(ctx, &tick, &clock);
    step_household_market_orders(ctx, &tick, &clock, sim_tick);
    step_marketplace_caravans(ctx, &clock, &tick);
    step_regional_markets(ctx, sim_tick);

    let mut lumber_mill_ids: Vec<u64> = Vec::new();
    let mut reforester_ids: Vec<u64> = Vec::new();
    let mut stone_quarry_ids: Vec<u64> = Vec::new();
    let mut large_quarry_ids: Vec<u64> = Vec::new();
    let mut woodcutters_lodge_ids: Vec<u64> = Vec::new();
    let mut well_ids: Vec<u64> = Vec::new();
    let mut hunters_hall_ids: Vec<u64> = Vec::new();
    let mut foragers_shed_ids: Vec<u64> = Vec::new();
    let mut fishing_camp_ids: Vec<u64> = Vec::new();
    let mut expanded_ids: Vec<(crate::building_defs::BuildingSimKind, u64)> = Vec::new();

    for building in ctx.db.building().iter() {
        if !building.construction_complete || building_is_disabled_by_fire(ctx, building.id) {
            continue;
        }
        let Some(sim_kind) =
            crate::building_defs::building_def(&building.kind).and_then(|def| def.sim_kind)
        else {
            continue;
        };
        match sim_kind {
            crate::building_defs::BuildingSimKind::LumberMill => lumber_mill_ids.push(building.id),
            crate::building_defs::BuildingSimKind::Reforester => reforester_ids.push(building.id),
            crate::building_defs::BuildingSimKind::StoneQuarry => stone_quarry_ids.push(building.id),
            crate::building_defs::BuildingSimKind::LargeQuarry => large_quarry_ids.push(building.id),
            crate::building_defs::BuildingSimKind::WoodcuttersLodge => {
                woodcutters_lodge_ids.push(building.id)
            }
            crate::building_defs::BuildingSimKind::Well => well_ids.push(building.id),
            crate::building_defs::BuildingSimKind::HuntersHall => hunters_hall_ids.push(building.id),
            crate::building_defs::BuildingSimKind::ForagersShed => {
                foragers_shed_ids.push(building.id)
            }
            crate::building_defs::BuildingSimKind::FishingCamp => {
                fishing_camp_ids.push(building.id)
            }
            crate::building_defs::BuildingSimKind::ThreshingBarn
            | crate::building_defs::BuildingSimKind::Monastery
            | crate::building_defs::BuildingSimKind::Brewery
            | crate::building_defs::BuildingSimKind::Smokehouse
            | crate::building_defs::BuildingSimKind::Granary
            | crate::building_defs::BuildingSimKind::Apiary
            | crate::building_defs::BuildingSimKind::Watermill
            | crate::building_defs::BuildingSimKind::Carpenter
            | crate::building_defs::BuildingSimKind::FerryLanding
            | crate::building_defs::BuildingSimKind::Vineyard
            | crate::building_defs::BuildingSimKind::PastoralFarmstead
            | crate::building_defs::BuildingSimKind::Swineherd
            | crate::building_defs::BuildingSimKind::VillageStorehouse => {
                expanded_ids.push((sim_kind, building.id))
            }
        }
    }

    for building_id in reforester_ids {
        let Some(building) = ctx.db.building().id().find(&building_id) else {
            continue;
        };
        step_reforester(ctx, &clock, building);
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
        step_stone_quarry(ctx, &clock, building);
    }

    for building_id in large_quarry_ids {
        let Some(building) = ctx.db.building().id().find(&building_id) else {
            continue;
        };
        step_large_quarry(ctx, &clock, building);
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

    for building_id in fishing_camp_ids {
        let Some(building) = ctx.db.building().id().find(&building_id) else {
            continue;
        };
        step_fishing_camp(ctx, &tick, &clock, building);
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
        step_well(ctx, &tick, sim_tick, &clock, environment, building);
    }

    for (sim_kind, building_id) in expanded_ids {
        let Some(building) = ctx.db.building().id().find(&building_id) else {
            continue;
        };
        match sim_kind {
            crate::building_defs::BuildingSimKind::ThreshingBarn => {
                step_threshing_barn(ctx, &tick, &clock, environment, building)
            }
            crate::building_defs::BuildingSimKind::Monastery => {
                step_monastery(ctx, &tick, &clock, building)
            }
            crate::building_defs::BuildingSimKind::Brewery => {
                step_brewery(ctx, &tick, &clock, building)
            }
            crate::building_defs::BuildingSimKind::Smokehouse => {
                step_smokehouse(ctx, &tick, &clock, building)
            }
            crate::building_defs::BuildingSimKind::Granary => {
                step_granary(ctx, &tick, &clock, building)
            }
            crate::building_defs::BuildingSimKind::Apiary => {
                step_apiary(ctx, &tick, &clock, building)
            }
            crate::building_defs::BuildingSimKind::Watermill => {
                step_watermill(ctx, &tick, &clock, building)
            }
            crate::building_defs::BuildingSimKind::Carpenter => {
                step_carpenter(ctx, &clock, building)
            }
            crate::building_defs::BuildingSimKind::FerryLanding => {
                step_ferry_landing(ctx, &tick, &clock, building)
            }
            crate::building_defs::BuildingSimKind::Vineyard => {
                step_vineyard(ctx, &tick, &clock, building)
            }
            crate::building_defs::BuildingSimKind::PastoralFarmstead => {
                step_pastoral_farmstead(ctx, &tick, &clock, environment, building)
            }
            crate::building_defs::BuildingSimKind::Swineherd => {
                step_swineherd(ctx, &tick, &clock, environment, building)
            }
            crate::building_defs::BuildingSimKind::VillageStorehouse => {
                step_village_storehouse(ctx, &tick, &clock, building)
            }
            _ => {}
        }
    }

    step_backyard_gardens(ctx, &tick, &clock, environment);
    step_fresh_food_spoilage(ctx, environment);

    let chapels: Vec<Building> = ctx
        .db
        .building()
        .iter()
        .filter(|building| {
            building.kind == "chapel"
                && building.construction_complete
                && !building_is_disabled_by_fire(ctx, building.id)
        })
        .collect();
    let monasteries: Vec<Building> = ctx
        .db
        .building()
        .iter()
        .filter(|building| {
            building.kind == "monastery"
                && building.construction_complete
                && !building_is_disabled_by_fire(ctx, building.id)
        })
        .collect();

    step_chapels(ctx, &tick, sim_tick, &clock, &chapels, &monasteries);

    let residences: Vec<Residence> = ctx.db.residence().iter().collect();
    step_chapel_parish(ctx, &tick, sim_tick, &clock, &chapels, &residences);

    for residence in residences {
        if residence_is_disabled_by_fire(ctx, residence.id) {
            continue;
        }
        step_residence(
            ctx,
            &tick,
            &chapels,
            &monasteries,
            residence,
            &clock,
            environment,
        );
    }
}
