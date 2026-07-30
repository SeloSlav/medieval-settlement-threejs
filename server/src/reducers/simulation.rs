use spacetimedb::ReducerContext;

use crate::balance_generated::{BASE_SPEED_DENOMINATOR, BASE_SPEED_NUMERATOR, TICK_DT};
use crate::db::*;
use crate::economy::step_regional_markets;
use crate::frontier_economy_policy::{armed_guards, guardhouse_payroll_buckets};
use crate::simulation::{
    materialize_all_physical_resource_ledgers, step_apiary, step_backyard_gardens, step_brewery,
    step_burials, step_carpenter, step_chapel_parish, step_chapels, step_charcoal_burner,
    step_clay_pit, step_construction_labor_stewards, step_construction_sites, step_delivery_trips,
    step_ferry_landing, step_fires, step_fishing_camp, step_foragers_shed, step_foraging_lifecycle,
    step_founding_sites, step_fresh_food_spoilage, step_granary, step_guardhouse,
    step_household_market_orders, step_hunters_hall, step_industrial_firewood_dispatch,
    step_institutional_food_dispatch, step_large_quarry, step_live_raids,
    step_local_material_dispatch, step_lumber_mill, step_marketplace_caravans,
    step_marketplace_material_dispatch, step_monastery, step_night_cycle, step_pastoral_farmstead,
    step_potter_kiln, step_production_labor_stewards, step_reclamation_piles, step_reforester,
    step_residence, step_residence_upgrades, step_seasonal_labor_stewards,
    step_seed_grain_distribution, step_settlement_security, step_smithy, step_smokehouse,
    step_stone_quarry, step_swineherd, step_threshing_barn,
    step_village_storehouse_household_firewood, step_village_storehouse_overflow_collection,
    step_vineyard, step_watermill, step_weaver, step_well, step_woodcutters_lodge,
    try_dispatch_guardhouse_payroll, SharedRoadNetworks, SimTickContext,
};
use crate::supply_policy::{INSTITUTIONAL_FOOD_SOURCE_KINDS, LOCAL_MATERIAL_SOURCE_KINDS};
use crate::tables::WorldConfig;
use crate::tables::{Building, Residence, SimPacingState};

pub fn run_sim_tick(ctx: &ReducerContext, _schedule: crate::schedule::SimTickSchedule) {
    let Some(config) = ctx.db.world_config().id().find(&0) else {
        return;
    };
    if !config.configured {
        return;
    }
    // Pause is a hard gameplay boundary: no clock, economy, migration,
    // movement, combat, delivery, weather, or fire state may mutate.
    if config.game_speed == 0 {
        return;
    }
    // A physical settlement never exposes the compatibility ledger as a
    // spendable treasury. Repair this save invariant only while simulation is
    // running so Pause remains a true no-mutation boundary.
    materialize_all_physical_resource_ledgers(ctx);
    // A fresh world remains at its opening hour while the player surveys the
    // land. Placing the founders' camp creates the first building and starts
    // calendar/economy progression on the following scheduler heartbeat.
    if ctx.db.building().iter().next().is_none() && ctx.db.residence().iter().next().is_none() {
        return;
    }
    let speed = match config.game_speed {
        1 | 4 | 8 => config.game_speed,
        // Preserve the nearest intent for worlds saved with earlier controls.
        5 => 4,
        12 | 20 | 120 => 8,
        _ => 1,
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
    let has_delivery_trips = ctx.db.delivery_trip().iter().next().is_some();
    let has_combat_agents = ctx.db.combat_agent().iter().next().is_some();
    let shared_road_networks = (has_delivery_trips || has_combat_agents || substeps > 0)
        .then(|| SimTickContext::load_road_networks(ctx));

    let heartbeat_sim_seconds = TICK_DT * speed as f64 * f64::from(BASE_SPEED_NUMERATOR)
        / f64::from(BASE_SPEED_DENOMINATOR);
    // Delivery speeds are expressed in world metres per simulation second.
    // Advance them on every scheduler heartbeat using the same authoritative
    // rate as the calendar and economy.
    if has_delivery_trips {
        let delivery_clock = crate::simulation::game_clock(config.sim_tick);
        let delivery_tick = SimTickContext::with_road_networks(
            shared_road_networks
                .as_ref()
                .expect("delivery trips require road networks")
                .clone(),
        );
        step_delivery_trips(ctx, &delivery_tick, &delivery_clock, heartbeat_sim_seconds);
        // A cancelled or over-capacity return can leave a compatibility-row
        // remainder. Materialize it in this same transaction so construction
        // can never reserve an invisible balance between scheduler heartbeats.
        materialize_all_physical_resource_ledgers(ctx);
    }
    // Live people and carts share the same wall-clock movement cadence. Raid
    // agents therefore advance on every scheduler heartbeat at the selected
    // speed instead of waiting for sparse economy/calendar substeps.
    step_live_raids(
        ctx,
        config.sim_tick,
        config.seed,
        config.conflict_enabled,
        heartbeat_sim_seconds,
        shared_road_networks.as_ref(),
    );
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
        run_one_sim_tick(
            ctx,
            shared_road_networks
                .as_ref()
                .expect("economy substeps require road networks")
                .clone(),
        );
    }
}

fn run_one_sim_tick(ctx: &ReducerContext, road_networks: SharedRoadNetworks) {
    let Some(config) = ctx.db.world_config().id().find(&0) else {
        return;
    };
    if !config.configured {
        return;
    }

    let world_seed = config.seed;
    let world_map_size = config.map_size;
    let world_hydrology = config.hydrology;
    let world_resource_abundance = config.resource_abundance;
    let conflict_enabled = config.conflict_enabled;
    let enemy_pressure = config.enemy_pressure;
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
    let previous_clock = crate::simulation::game_clock(sim_tick.saturating_sub(1));
    step_night_cycle(ctx, &previous_clock, &clock, world_seed);
    let environment = crate::season_policy::environment_for(world_seed, world_hydrology, &clock);
    step_seasonal_labor_stewards(ctx, sim_tick, clock.month);
    // Time-critical seasonal work has first claim on the day's free labor.
    // Target-governed production then rotates its safe surplus before
    // construction claims the remaining pool and blocked builders.
    step_production_labor_stewards(ctx, sim_tick);
    step_construction_labor_stewards(ctx, sim_tick);
    step_foraging_lifecycle(ctx, &clock, environment);

    step_settlement_security(
        ctx,
        sim_tick,
        clock.month,
        world_seed,
        world_map_size,
        conflict_enabled,
        enemy_pressure,
        environment,
    );
    let tick = SimTickContext::with_road_networks(road_networks);
    step_fires(ctx, &clock, environment, world_seed, sim_tick);
    step_construction_sites(ctx, &tick, &clock);
    step_residence_upgrades(ctx, &tick, &clock);
    step_household_market_orders(ctx, &tick, &clock, sim_tick);

    let mut lumber_mill_ids: Vec<u64> = Vec::new();
    let mut reforester_ids: Vec<u64> = Vec::new();
    let mut stone_quarry_ids: Vec<u64> = Vec::new();
    let mut large_quarry_ids: Vec<u64> = Vec::new();
    let mut woodcutters_lodge_ids: Vec<u64> = Vec::new();
    let mut well_ids: Vec<u64> = Vec::new();
    let mut hunters_hall_ids: Vec<u64> = Vec::new();
    let mut foragers_shed_ids: Vec<u64> = Vec::new();
    let mut fishing_camp_ids: Vec<u64> = Vec::new();
    let mut chapel_ids: Vec<u64> = Vec::new();
    let mut monastery_ids: Vec<u64> = Vec::new();
    let mut guardhouse_payroll_ids: Vec<(u8, u64)> = Vec::new();
    let mut village_storehouse_ids: Vec<u64> = Vec::new();
    let mut reclamation_pile_ids: Vec<u64> = Vec::new();
    let mut marketplace_ids: Vec<u64> = Vec::new();
    let mut institutional_food_source_ids: Vec<u64> = Vec::new();
    let mut local_material_source_ids: Vec<u64> = Vec::new();
    let mut expanded_ids: Vec<(crate::building_defs::BuildingSimKind, u64)> = Vec::new();

    for building in ctx.db.building().iter() {
        if !building.construction_complete || tick.building_disabled_by_fire(ctx, building.id) {
            continue;
        }
        match building.kind.as_str() {
            "chapel" => chapel_ids.push(building.id),
            "monastery" => monastery_ids.push(building.id),
            "salvage_pile" => reclamation_pile_ids.push(building.id),
            "marketplace" => marketplace_ids.push(building.id),
            _ => {}
        }
        if INSTITUTIONAL_FOOD_SOURCE_KINDS.contains(&building.kind.as_str()) {
            institutional_food_source_ids.push(building.id);
        }
        if LOCAL_MATERIAL_SOURCE_KINDS.contains(&building.kind.as_str()) {
            local_material_source_ids.push(building.id);
        }
        let Some(sim_kind) =
            crate::building_defs::building_def(&building.kind).and_then(|def| def.sim_kind)
        else {
            continue;
        };
        match sim_kind {
            crate::building_defs::BuildingSimKind::LumberMill => lumber_mill_ids.push(building.id),
            crate::building_defs::BuildingSimKind::Reforester => reforester_ids.push(building.id),
            crate::building_defs::BuildingSimKind::StoneQuarry => {
                stone_quarry_ids.push(building.id)
            }
            crate::building_defs::BuildingSimKind::LargeQuarry => {
                large_quarry_ids.push(building.id)
            }
            crate::building_defs::BuildingSimKind::WoodcuttersLodge => {
                woodcutters_lodge_ids.push(building.id)
            }
            crate::building_defs::BuildingSimKind::Well => well_ids.push(building.id),
            crate::building_defs::BuildingSimKind::HuntersHall => {
                hunters_hall_ids.push(building.id)
            }
            crate::building_defs::BuildingSimKind::ForagersShed => {
                foragers_shed_ids.push(building.id)
            }
            crate::building_defs::BuildingSimKind::FishingCamp => {
                fishing_camp_ids.push(building.id)
            }
            crate::building_defs::BuildingSimKind::Guardhouse => {
                guardhouse_payroll_ids.push((building.guardhouse_pay_priority, building.id))
            }
            crate::building_defs::BuildingSimKind::VillageStorehouse => {
                village_storehouse_ids.push(building.id)
            }
            crate::building_defs::BuildingSimKind::ThreshingBarn
            | crate::building_defs::BuildingSimKind::ClayPit
            | crate::building_defs::BuildingSimKind::CharcoalBurner
            | crate::building_defs::BuildingSimKind::Smithy
            | crate::building_defs::BuildingSimKind::PotterKiln
            | crate::building_defs::BuildingSimKind::Monastery
            | crate::building_defs::BuildingSimKind::Brewery
            | crate::building_defs::BuildingSimKind::Smokehouse
            | crate::building_defs::BuildingSimKind::Granary
            | crate::building_defs::BuildingSimKind::Apiary
            | crate::building_defs::BuildingSimKind::Watermill
            | crate::building_defs::BuildingSimKind::Carpenter
            | crate::building_defs::BuildingSimKind::Weaver
            | crate::building_defs::BuildingSimKind::FerryLanding
            | crate::building_defs::BuildingSimKind::Vineyard
            | crate::building_defs::BuildingSimKind::PastoralFarmstead
            | crate::building_defs::BuildingSimKind::Swineherd => {
                expanded_ids.push((sim_kind, building.id))
            }
        }
    }

    // Residence-upgrade grants are already reserved by the treasury ledger.
    // Among unreserved coin, explicit company pay priorities get the first
    // chance to send a lockbox. Marketplace working-cash targets then compete
    // for the remaining free haulers, treasury chests, and gold. The later
    // guardhouse step sees the inbound trip and will not dispatch twice.
    let payroll_buckets = guardhouse_payroll_buckets(guardhouse_payroll_ids);
    if conflict_enabled {
        for payroll_bucket in payroll_buckets.iter().rev() {
            for building_id in payroll_bucket {
                let Some(building) = ctx.db.building().id().find(building_id) else {
                    continue;
                };
                try_dispatch_guardhouse_payroll(
                    ctx,
                    &tick,
                    &clock,
                    &building,
                    armed_guards(building.assigned_labor, building.polearms),
                );
            }
        }
    }

    step_marketplace_caravans(ctx, &clock, &tick, environment);
    step_seed_grain_distribution(ctx, &tick, &clock);
    let material_marketplaces = marketplace_ids
        .iter()
        .filter_map(|building_id| ctx.db.building().id().find(building_id))
        .collect();
    step_marketplace_material_dispatch(ctx, &tick, &clock, material_marketplaces);
    step_regional_markets(ctx, sim_tick);

    for building_id in reforester_ids {
        let Some(building) = ctx.db.building().id().find(&building_id) else {
            continue;
        };
        step_reforester(ctx, &tick, &clock, building);
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
        step_stone_quarry(ctx, &tick, &clock, building);
    }

    for building_id in large_quarry_ids {
        let Some(building) = ctx.db.building().id().find(&building_id) else {
            continue;
        };
        step_large_quarry(ctx, &tick, &clock, building);
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

    for building_id in &woodcutters_lodge_ids {
        let Some(building) = ctx.db.building().id().find(building_id) else {
            continue;
        };
        step_woodcutters_lodge(ctx, &tick, &clock, building);
    }

    // Homes below their protected winter-night floor claim a distributor's
    // first available cart. Sources left idle after those physical duties may
    // feed workshops, where work priority and fuel runway replace
    // construction-order bias.
    let village_storehouses = village_storehouse_ids
        .iter()
        .filter_map(|building_id| ctx.db.building().id().find(building_id))
        .collect();
    step_village_storehouse_household_firewood(ctx, &tick, &clock, village_storehouses);
    let industrial_firewood_sources = woodcutters_lodge_ids
        .iter()
        .chain(village_storehouse_ids.iter())
        .filter_map(|building_id| ctx.db.building().id().find(building_id))
        .collect();
    step_industrial_firewood_dispatch(ctx, &tick, &clock, industrial_firewood_sources);
    let village_storehouses = village_storehouse_ids
        .iter()
        .filter_map(|building_id| ctx.db.building().id().find(building_id))
        .collect();
    step_village_storehouse_overflow_collection(ctx, &tick, &clock, village_storehouses);

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
                step_watermill(ctx, &tick, &clock, environment, building)
            }
            crate::building_defs::BuildingSimKind::Carpenter => {
                step_carpenter(ctx, &tick, &clock, building)
            }
            crate::building_defs::BuildingSimKind::Weaver => {
                step_weaver(ctx, &tick, &clock, building)
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
            crate::building_defs::BuildingSimKind::ClayPit => step_clay_pit(
                ctx,
                &tick,
                &clock,
                environment,
                world_resource_abundance,
                building,
            ),
            crate::building_defs::BuildingSimKind::CharcoalBurner => {
                step_charcoal_burner(ctx, &tick, &clock, building)
            }
            crate::building_defs::BuildingSimKind::Smithy => {
                step_smithy(ctx, &tick, &clock, building)
            }
            crate::building_defs::BuildingSimKind::PotterKiln => {
                step_potter_kiln(ctx, &tick, &clock, building)
            }
            _ => {}
        }
    }

    // Local producers have now completed this tick's work. Match their free
    // carts together so workshop urgency and road length, rather than source
    // construction order, decide clay, charcoal, tool, and pottery routes.
    let local_material_sources = local_material_source_ids
        .into_iter()
        .filter_map(|building_id| ctx.db.building().id().find(&building_id))
        .collect();
    step_local_material_dispatch(ctx, &tick, &clock, local_material_sources);

    // Producers have now attempted their own household and specialty duties.
    // Their remaining free carts arbitrate all institutional fresh-food demand
    // together, so target construction order cannot decide who gets supplied.
    let institutional_food_sources = institutional_food_source_ids
        .into_iter()
        .filter_map(|building_id| ctx.db.building().id().find(&building_id))
        .collect();
    step_institutional_food_dispatch(ctx, &tick, &clock, institutional_food_sources);

    for payroll_bucket in payroll_buckets.into_iter().rev() {
        for building_id in payroll_bucket {
            let Some(building) = ctx.db.building().id().find(&building_id) else {
                continue;
            };
            step_guardhouse(ctx, &tick, &clock, building);
        }
    }

    step_backyard_gardens(ctx, &tick, &clock, environment);
    step_fresh_food_spoilage(ctx, environment);

    let chapels: Vec<Building> = chapel_ids
        .into_iter()
        .filter_map(|building_id| ctx.db.building().id().find(&building_id))
        .collect();
    let monasteries: Vec<Building> = monastery_ids
        .into_iter()
        .filter_map(|building_id| ctx.db.building().id().find(&building_id))
        .collect();

    step_chapels(ctx, &tick, sim_tick, &clock, &chapels, &monasteries);

    let residences: Vec<Residence> = ctx.db.residence().iter().collect();
    step_chapel_parish(ctx, &tick, sim_tick, &clock, &chapels, &residences);

    for residence in residences {
        if tick.residence_disabled_by_fire(ctx, residence.id) {
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
            world_seed,
            sim_tick,
        );
    }
    step_burials(ctx, &tick, &clock, TICK_DT);
    step_reclamation_piles(ctx, &tick, &clock, reclamation_pile_ids);
    step_founding_sites(ctx, &tick, &clock);
}
