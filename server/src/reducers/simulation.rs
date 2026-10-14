macro_rules! phase {
    ($timer:ident, $name:literal) => {
        #[cfg(feature = "local-loadtest")]
        drop($timer);
        #[cfg(feature = "local-loadtest")]
        let $timer = spacetimedb::log_stopwatch::LogStopwatch::new($name);
    };
}
use spacetimedb::ReducerContext;

use crate::balance_generated::{BASE_SPEED_DENOMINATOR, BASE_SPEED_NUMERATOR, TICK_DT};
use crate::db::*;
use crate::economy::step_regional_markets;
use crate::simulation::{
    capture_combat_motion_frame, materialize_all_physical_resource_ledgers,
    retire_legacy_food_items, retire_removed_buildings, step_apiary, step_backyard_gardens,
    step_bakery, step_bandit_world, step_bowyer_fletcher, step_brewery, step_burials,
    step_carpenter, step_chandlery, step_chapel_parish, step_chapels,
    step_charcoal_burner, step_cobbler, step_construction_labor_stewards, step_construction_sites,
    step_delivery_trips, step_devotional_candles, step_fires, step_fishing_camp,
    step_foragers_shed, step_foraging_lifecycle, step_founding_sites, step_fresh_food_spoilage,
    step_granary, step_guardhouse, step_household_discretionary_trade, step_hunters_hall,
    step_industrial_firewood_dispatch, step_institutional_food_dispatch, step_land_levies,
    step_large_quarry, step_live_raids, step_local_material_dispatch, step_lumber_mill,
    step_market_household_distribution, step_marketplace_caravans,
    step_marketplace_material_dispatch, step_military_requisitions, step_military_world, step_mine,
    step_monastery, step_natural_tree_regrowth, step_pastoral_farmstead, step_potter_kiln, step_stone_mason,
    step_production_labor_stewards, step_reclamation_piles, step_reforester, step_residence,
    step_residence_upgrades, step_seasonal_labor_stewards, step_seed_grain_distribution,
    step_settlement_security, step_smithy, step_smokehouse, step_spinning_retting_house,
    step_stone_quarry, step_storehouse_market_stalls, step_swineherd, step_tannery,
    step_threshing_barn, step_trading_post_trade, step_village_storehouse_overflow_collection,
    step_watermill, step_weaponsmith_armorer, step_weaver, step_well, step_wild_animal_world,
    step_windmill, step_woodcutters_lodge, SharedRoadNetworks, SimTickContext,
};
use crate::supply_policy::{INSTITUTIONAL_FOOD_SOURCE_KINDS, LOCAL_MATERIAL_SOURCE_KINDS};
use crate::tables::WorldConfig;
use crate::tables::{Building, Residence, SimPacingState};

pub fn run_sim_tick(ctx: &ReducerContext, _schedule: crate::schedule::SimTickSchedule) {
    #[cfg(feature = "local-loadtest")]
    let _heartbeat_timer = spacetimedb::log_stopwatch::LogStopwatch::new("realm heartbeat");
    #[cfg(feature = "local-loadtest")]
    let heartbeat_phase = spacetimedb::log_stopwatch::LogStopwatch::new("heartbeat setup");
    let Some(config) = ctx.db.world_config().id().find(&0) else {
        return;
    };
    if !config.configured {
        return;
    }
    // A database transport connection is not automatically a playing client.
    // Only clients that completed enter_world keep authoritative time moving;
    // probes, loading clients, and an entirely disconnected realm stay frozen.
    // Keep game_speed untouched so a returning player resumes their previous
    // 1x/4x/8x selection, while an intentional manual Pause remains Pause.
    if !crate::realm::ENABLED && ctx.db.active_game_session().iter().next().is_none() {
        return;
    }
    if !crate::realm::ENABLED { retire_removed_buildings(ctx); }
    // Pause is a hard gameplay boundary: no clock, economy, migration,
    // movement, combat, delivery, weather, or fire state may mutate.
    if config.game_speed == 0 {
        return;
    }
    // A physical settlement never exposes the compatibility ledger as a
    // spendable treasury. Repair this save invariant only while simulation is
    // running so Pause remains a true no-mutation boundary.
    materialize_all_physical_resource_ledgers(ctx);
    crate::resource_unit_migration::migrate_legacy_fractional_resources(ctx);
    crate::livestock_migration::migrate_legacy_livestock_herds(ctx);
    // A fresh world remains at its opening hour while the player surveys the
    // land. Placing the founders' camp creates the first building and starts
    // calendar/economy progression on the following scheduler heartbeat.
    if !crate::realm::ENABLED && ctx.db.building().iter().next().is_none() && ctx.db.residence().iter().next().is_none() {
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
    let (base_numerator, base_denominator) = if crate::realm::ENABLED {
        (crate::realm_policy::CLOCK_NUMERATOR, crate::realm_policy::CLOCK_DENOMINATOR)
    } else { (BASE_SPEED_NUMERATOR, BASE_SPEED_DENOMINATOR) };
    let step_budget = previous_credit + speed as u16 * base_numerator;
    let substeps = step_budget / base_denominator;
    let next_credit = step_budget % base_denominator;
    let realm_clock = crate::realm::ENABLED.then(|| crate::realm::advance_clock(ctx));
    let substeps = realm_clock.as_ref().map_or(substeps, |clock| clock.steps);
    let wall_seconds = realm_clock.as_ref().map_or(TICK_DT, |clock| clock.elapsed_micros as f64 / 1_000_000.0);
    phase!(heartbeat_phase, "heartbeat surveyors");
    crate::realm::step_scouts(ctx, wall_seconds);
    retire_legacy_food_items(ctx);
    let has_delivery_trips = ctx.db.delivery_trip().iter().next().is_some();
    let has_combat_agents = ctx.db.combat_agent().iter().next().is_some();
    phase!(heartbeat_phase, "heartbeat roads");
    let shared_road_networks = (has_delivery_trips || has_combat_agents || substeps > 0)
        .then(|| SimTickContext::load_road_networks(ctx));
    #[cfg(feature = "local-loadtest")]
    let route_cache_before = shared_road_networks.as_ref().map(|networks| {
        networks.values().map(|network| network.route_cache_stats()).fold((0, 0), |(queries, hits), stats| {
            (queries + stats.queries, hits + stats.hits)
        })
    });

    let heartbeat_sim_seconds = wall_seconds * speed as f64 * f64::from(base_numerator)
        / f64::from(base_denominator);
    let heartbeat_clock = crate::simulation::game_clock(config.sim_tick);
    let holiday_protected = crate::simulation::holiday_observance(&heartbeat_clock).is_some();
    // Delivery speeds are expressed in world metres per simulation second.
    // Advance already-departed carts on every scheduler heartbeat using the
    // same authoritative rate as the calendar and economy. Named holy days
    // block new dispatch below, but never strand a real crew or its cargo.
    phase!(heartbeat_phase, "heartbeat deliveries");
    if has_delivery_trips {
        let delivery_tick = SimTickContext::with_road_networks(
            shared_road_networks
                .as_ref()
                .expect("delivery trips require road networks")
                .clone(),
        );
        step_delivery_trips(ctx, &delivery_tick, &heartbeat_clock, heartbeat_sim_seconds);
        // A cancelled or over-capacity return can leave a compatibility-row
        // remainder. Materialize it in this same transaction so construction
        // can never reserve an invisible balance between scheduler heartbeats.
        materialize_all_physical_resource_ledgers(ctx);
    }
    // Live people and carts share the same wall-clock movement cadence. Raid
    // agents therefore advance on every scheduler heartbeat at the selected
    // speed instead of waiting for sparse economy/calendar substeps.
    phase!(heartbeat_phase, "heartbeat combat");
    if !holiday_protected {
        // One shared pre-heartbeat snapshot makes the final steering solve the
        // sole authoritative integration for every combat faction.
        capture_combat_motion_frame(ctx, shared_road_networks.as_ref());
        step_live_raids(
            ctx,
            config.sim_tick,
            config.seed,
            config.conflict_enabled,
            heartbeat_sim_seconds,
            shared_road_networks.as_ref(),
        );
        step_bandit_world(
            ctx,
            config.sim_tick,
            config.seed,
            config.map_size,
            config.bandit_camps_enabled,
            heartbeat_sim_seconds,
            shared_road_networks.as_ref(),
        );
        step_wild_animal_world(
            ctx,
            config.sim_tick,
            config.sim_tick + u64::from(substeps),
            config.seed,
            config.map_size,
            config.wild_animal_attacks_enabled,
            heartbeat_sim_seconds,
            shared_road_networks.as_ref(),
        );
        // Every CombatAgent faction has now performed its one behavior/path
        // integration. The military step updates player-company behavior and
        // finishes with one bounded global steering correction, so no later
        // mover can invalidate authoritative all-combatant separation.
        step_military_world(
            ctx,
            config.sim_tick,
            heartbeat_sim_seconds,
            shared_road_networks.as_ref(),
        );
    }
    if !crate::realm::ENABLED {
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
    }
    phase!(heartbeat_phase, "heartbeat economy");
    for _ in 0..substeps {
        run_one_sim_tick(
            ctx,
            shared_road_networks
                .as_ref()
                .expect("economy substeps require road networks")
                .clone(),
        );
    }
    phase!(heartbeat_phase, "heartbeat fog");
    crate::realm::refresh_fog(ctx);
    phase!(heartbeat_phase, "heartbeat entities");
    if substeps > 0 { crate::realm::refresh_entities(ctx); }
    else { crate::realm::refresh_mobile_entities(ctx); }
    #[cfg(feature = "local-loadtest")]
    if let (Some(networks), Some((queries_before, hits_before))) = (shared_road_networks.as_ref(), route_cache_before) {
        let (queries, hits, entries, points) = networks.values().map(|network| network.route_cache_stats())
            .fold((0, 0, 0, 0), |(queries, hits, entries, points), stats| {
                (queries + stats.queries, hits + stats.hits, entries + stats.entries, points + stats.points)
            });
        log::debug!("Canonical route cache heartbeat: {} queries, {} hits, {} entries, {} points",
            queries.saturating_sub(queries_before), hits.saturating_sub(hits_before), entries, points);
    }
}

fn run_one_sim_tick(ctx: &ReducerContext, road_networks: SharedRoadNetworks) {
    #[cfg(feature = "local-loadtest")]
    let preparation_timer = spacetimedb::log_stopwatch::LogStopwatch::new("realm preparation");
    let Some(config) = ctx.db.world_config().id().find(&0) else {
        return;
    };
    if !config.configured {
        return;
    }

    #[cfg(feature = "local-loadtest")]
    let _phase = spacetimedb::log_stopwatch::LogStopwatch::new("preparation start");
    let world_seed = config.seed;
    let world_map_size = config.map_size;
    let world_hydrology = config.hydrology;
    let well_aquifer_networks_enabled = config.well_aquifer_networks_enabled;
    let severe_weather_enabled = config.severe_weather_enabled;
    let food_spoilage_rate = config.food_spoilage_rate;
    let conflict_enabled = config.conflict_enabled;
    let enemy_pressure = config.enemy_pressure;
    let sim_tick = config.sim_tick + 1;
    let clock = crate::simulation::game_clock(sim_tick);
    let household_previous_tick = config.household_tick;
    let household_tick = household_previous_tick + u64::from(crate::simulation::holiday_observance(&clock).is_none());
    ctx.db.world_config().id().update(WorldConfig { sim_tick, household_tick, ..config });
    // A released tree completes its physical fall even as a rest day begins.
    crate::simulation::forestry::step_falling_trees(ctx);
    // Named holy days advance the calendar and presentation clock only. This
    // one boundary guarantees a true rest period: no production, carts,
    // consumption, spoilage, upkeep, illness, fire, raids, or other adverse
    // state can accrue because the settlement has stopped work to observe it.
    if crate::simulation::holiday_observance(&clock).is_some() {
        return;
    }
    let _need_cache = crate::simulation::residence_needs::cache_tick_needs(ctx, household_previous_tick, household_tick);
    let environment = crate::season_policy::environment_for(
        world_seed,
        world_hydrology,
        severe_weather_enabled,
        &clock,
    );
    if crate::labor_steward_policy::seasonal_labor_steward_review_due(sim_tick) {
        let labor_review_tick = SimTickContext::with_road_networks(road_networks.clone());
        step_seasonal_labor_stewards(ctx, &labor_review_tick, &clock, sim_tick, clock.month);
        // Time-critical seasonal work has first claim on the day's free labor.
        // Target-governed production then rotates its safe surplus before
        // construction claims the remaining pool and blocked builders.
        step_production_labor_stewards(ctx, &labor_review_tick, &clock, sim_tick);
        step_construction_labor_stewards(ctx, &labor_review_tick, &clock, sim_tick);
    }
    phase!(_phase, "foraging");
    step_foraging_lifecycle(ctx, &clock, world_seed, environment, &road_networks);

    phase!(_phase, "security");
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
    phase!(_phase, "tree regrowth");
    step_natural_tree_regrowth(ctx, sim_tick);
    phase!(_phase, "fires");
    step_fires(
        ctx,
        &clock,
        environment,
        severe_weather_enabled,
        world_seed,
        sim_tick,
    );
    phase!(_phase, "construction");
    step_construction_sites(ctx, &tick, &clock);
    phase!(_phase, "home upgrades");
    step_residence_upgrades(ctx, &tick, &clock);
    phase!(_phase, "levies");
    step_land_levies(ctx, &tick, &clock);

    #[cfg(feature = "local-loadtest")]
    drop(preparation_timer);
    #[cfg(feature = "local-loadtest")]
    let production_timer = spacetimedb::log_stopwatch::LogStopwatch::new("realm workshops");
    let labor_roster_cache = crate::economy::cache_production_labor_rosters();
    let mut lumber_mill_ids: Vec<u64> = Vec::new();
    let mut reforester_ids: Vec<u64> = Vec::new();
    let mut stone_quarry_ids: Vec<u64> = Vec::new();
    let mut large_quarry_ids: Vec<u64> = Vec::new();
    let mut woodcutters_lodge_ids: Vec<u64> = Vec::new();
    let mut well_ids: Vec<u64> = Vec::new();
    let mut hunters_hall_ids: Vec<u64> = Vec::new();
    let mut foragers_shed_ids: Vec<u64> = Vec::new();
    let mut fishing_camp_ids: Vec<u64> = Vec::new();
    let mut guardhouse_ids: Vec<u64> = Vec::new();
    let mut chapel_ids: Vec<u64> = Vec::new();
    let mut monastery_ids: Vec<u64> = Vec::new();
    let mut village_storehouse_ids: Vec<u64> = Vec::new();
    let mut reclamation_pile_ids: Vec<u64> = Vec::new();
    let mut trading_post_ids: Vec<u64> = Vec::new();
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
            "trading_post" => trading_post_ids.push(building.id),
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
            crate::building_defs::BuildingSimKind::Guardhouse => guardhouse_ids.push(building.id),
            crate::building_defs::BuildingSimKind::VillageStorehouse => {
                village_storehouse_ids.push(building.id)
            }
            crate::building_defs::BuildingSimKind::ThreshingBarn
            | crate::building_defs::BuildingSimKind::Mine
            | crate::building_defs::BuildingSimKind::CharcoalBurner
            | crate::building_defs::BuildingSimKind::Smithy
            | crate::building_defs::BuildingSimKind::WeaponsmithArmorer
            | crate::building_defs::BuildingSimKind::BowyerFletcher
            | crate::building_defs::BuildingSimKind::PotterKiln
            | crate::building_defs::BuildingSimKind::StoneMason
            | crate::building_defs::BuildingSimKind::Monastery
            | crate::building_defs::BuildingSimKind::Brewery
            | crate::building_defs::BuildingSimKind::Smokehouse
            | crate::building_defs::BuildingSimKind::Granary
            | crate::building_defs::BuildingSimKind::Bakery
            | crate::building_defs::BuildingSimKind::Apiary
            | crate::building_defs::BuildingSimKind::Watermill
            | crate::building_defs::BuildingSimKind::Windmill
            | crate::building_defs::BuildingSimKind::Carpenter
            | crate::building_defs::BuildingSimKind::SpinningRettingHouse
            | crate::building_defs::BuildingSimKind::Weaver
            | crate::building_defs::BuildingSimKind::Tannery
            | crate::building_defs::BuildingSimKind::Cobbler
            | crate::building_defs::BuildingSimKind::PastoralFarmstead
            | crate::building_defs::BuildingSimKind::Chandlery
            | crate::building_defs::BuildingSimKind::Swineherd => {
                expanded_ids.push((sim_kind, building.id))
            }
        }
    }

    // Export rules get first claim on newly available local carts and stock.
    // Carts stage only settlement surplus; the off-map exchange settles once
    // per month without spawning a regional caravan unit.
    phase!(_phase, "trade");
    step_trading_post_trade(ctx, &tick, &clock);
    step_household_discretionary_trade(ctx, &tick, &clock);
    step_marketplace_caravans(ctx, &clock, &tick, environment);
    step_seed_grain_distribution(ctx, &tick, &clock);
    let material_marketplaces = trading_post_ids
        .iter()
        .filter_map(|building_id| ctx.db.building().id().find(building_id))
        .collect();
    step_marketplace_material_dispatch(ctx, &tick, &clock, material_marketplaces);
    step_regional_markets(ctx, sim_tick);

    phase!(_phase, "reforesters");
    for building_id in reforester_ids {
        let Some(building) = ctx.db.building().id().find(&building_id) else {
            continue;
        };
        step_reforester(ctx, &tick, &clock, sim_tick, building);
    }

    phase!(_phase, "lumber");
    for building_id in lumber_mill_ids {
        let Some(building) = ctx.db.building().id().find(&building_id) else {
            continue;
        };
        step_lumber_mill(ctx, &tick, &clock, building);
    }

    phase!(_phase, "quarries");
    for building_id in stone_quarry_ids {
        let Some(building) = ctx.db.building().id().find(&building_id) else {
            continue;
        };
        step_stone_quarry(ctx, &tick, &clock, environment, building);
    }

    for building_id in large_quarry_ids {
        let Some(building) = ctx.db.building().id().find(&building_id) else {
            continue;
        };
        step_large_quarry(ctx, &tick, &clock, building);
    }

    phase!(_phase, "food suppliers");
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

    phase!(_phase, "woodcutters");
    for building_id in &woodcutters_lodge_ids {
        let Some(building) = ctx.db.building().id().find(building_id) else {
            continue;
        };
        step_woodcutters_lodge(ctx, &tick, &clock, building);
    }

    // Fresh lodge output may stage firewood at processors before their work
    // step. Depot carts are held until charcoal and market priorities have
    // been evaluated after production below.
    phase!(_phase, "firewood");
    let industrial_firewood_sources = woodcutters_lodge_ids
        .iter()
        .filter_map(|building_id| ctx.db.building().id().find(building_id))
        .collect();
    step_industrial_firewood_dispatch(ctx, &tick, &clock, industrial_firewood_sources);
    phase!(_phase, "wells");
    for building_id in well_ids {
        let Some(building) = ctx.db.building().id().find(&building_id) else {
            continue;
        };
        step_well(
            ctx,
            &tick,
            sim_tick,
            world_seed,
            world_hydrology,
            well_aquifer_networks_enabled,
            &clock,
            environment,
            building,
        );
    }

    phase!(_phase, "processors");
    for (sim_kind, building_id) in expanded_ids {
        let Some(building) = ctx.db.building().id().find(&building_id) else {
            continue;
        };
        match sim_kind {
            crate::building_defs::BuildingSimKind::ThreshingBarn => step_threshing_barn(
                ctx,
                &tick,
                &clock,
                environment,
                world_seed,
                world_map_size,
                building,
            ),
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
            crate::building_defs::BuildingSimKind::Bakery => {
                step_bakery(ctx, &tick, &clock, building)
            }
            crate::building_defs::BuildingSimKind::Apiary => {
                step_apiary(ctx, &tick, &clock, building)
            }
            crate::building_defs::BuildingSimKind::Watermill => {
                step_watermill(ctx, &tick, &clock, environment, building)
            }
            crate::building_defs::BuildingSimKind::Windmill => {
                step_windmill(ctx, &tick, &clock, environment, config.seed, building)
            }
            crate::building_defs::BuildingSimKind::Carpenter => {
                step_carpenter(ctx, &tick, &clock, building)
            }
            crate::building_defs::BuildingSimKind::SpinningRettingHouse => {
                step_spinning_retting_house(ctx, &tick, &clock, building)
            }
            crate::building_defs::BuildingSimKind::Weaver => {
                step_weaver(ctx, &tick, &clock, building)
            }
            crate::building_defs::BuildingSimKind::Tannery => {
                step_tannery(ctx, &tick, &clock, building)
            }
            crate::building_defs::BuildingSimKind::Cobbler => {
                step_cobbler(ctx, &tick, &clock, building)
            }
            crate::building_defs::BuildingSimKind::Chandlery => {
                step_chandlery(ctx, &tick, &clock, building)
            }
            crate::building_defs::BuildingSimKind::PastoralFarmstead => {
                step_pastoral_farmstead(ctx, &tick, &clock, environment, building)
            }
            crate::building_defs::BuildingSimKind::Swineherd => {
                step_swineherd(ctx, &tick, &clock, environment, building)
            }
            crate::building_defs::BuildingSimKind::Mine => step_mine(ctx, &tick, &clock, building),
            crate::building_defs::BuildingSimKind::CharcoalBurner => {
                step_charcoal_burner(ctx, &tick, &clock, environment, building)
            }
            crate::building_defs::BuildingSimKind::Smithy => {
                step_smithy(ctx, &tick, &clock, building)
            }
            crate::building_defs::BuildingSimKind::WeaponsmithArmorer => {
                step_weaponsmith_armorer(ctx, &tick, &clock, building)
            }
            crate::building_defs::BuildingSimKind::BowyerFletcher => {
                step_bowyer_fletcher(ctx, &tick, &clock, building)
            }
            crate::building_defs::BuildingSimKind::StoneMason => { step_stone_mason(ctx, &tick, &clock, building) },
            crate::building_defs::BuildingSimKind::PotterKiln => {
                step_potter_kiln(ctx, &tick, &clock, building)
            }
            _ => {}
        }
    }

    // Recruitment reserves complete finished kits, then ordinary carts bring
    // them to the mustering hall. Companies become selectable only once every
    // recruit and every physical weapon/armor item is onsite.
    #[cfg(feature = "local-loadtest")]
    drop(production_timer);
    #[cfg(feature = "local-loadtest")]
    drop(_phase);
    #[cfg(feature = "local-loadtest")]
    let logistics_timer = spacetimedb::log_stopwatch::LogStopwatch::new("realm logistics");
    #[cfg(feature = "local-loadtest")]
    let logistics_phase = spacetimedb::log_stopwatch::LogStopwatch::new("military requisitions");
    step_military_requisitions(ctx, &tick, &clock);

    // Local producers have now completed this tick's work. Match their free
    // carts together so workshop urgency and road length, rather than source
    // construction order, decide iron, salt, clay, charcoal, tool, and pottery routes.
    phase!(logistics_phase, "material dispatch");
    let local_material_sources = local_material_source_ids
        .into_iter()
        .filter_map(|building_id| ctx.db.building().id().find(&building_id))
        .collect();
    step_local_material_dispatch(ctx, &tick, &clock, environment, local_material_sources);

    // A depot's stored charcoal first had a chance to refill an active smithy
    // to its six-cycle target. Remaining carts maintain one combined,
    // population- and season-scaled Marketplace reserve, preferring charcoal
    // so processed fuel does not stagnate in storage.
    phase!(logistics_phase, "depot stalls");
    let household_storehouses = village_storehouse_ids
        .iter()
        .filter_map(|building_id| ctx.db.building().id().find(building_id))
        .collect();
    step_storehouse_market_stalls(ctx, &tick, &clock, environment, household_storehouses);

    // Depots whose carts remain free may feed other firewood-burning workshops.
    phase!(logistics_phase, "depot firewood");
    let industrial_firewood_sources = village_storehouse_ids
        .iter()
        .filter_map(|building_id| ctx.db.building().id().find(building_id))
        .collect();
    step_industrial_firewood_dispatch(ctx, &tick, &clock, industrial_firewood_sources);

    // Only then may an idle depot collect the fullest producer overflow.
    phase!(logistics_phase, "depot collection");
    let village_storehouses = village_storehouse_ids
        .iter()
        .filter_map(|building_id| ctx.db.building().id().find(building_id))
        .collect();
    step_village_storehouse_overflow_collection(ctx, &tick, &clock, village_storehouses);

    // Producers have finished their own specialty-reserve duties. Their output
    // now moves to staffed granaries or other institutional consumers; only
    // depot workers subsequently stock the household Marketplace stalls.
    phase!(logistics_phase, "institutional food");
    let institutional_food_sources = institutional_food_source_ids
        .into_iter()
        .filter_map(|building_id| ctx.db.building().id().find(&building_id))
        .collect();
    step_institutional_food_dispatch(ctx, &tick, &clock, institutional_food_sources);

    phase!(logistics_phase, "guardhouses");
    for building_id in guardhouse_ids {
        let Some(building) = ctx.db.building().id().find(&building_id) else {
            continue;
        };
        step_guardhouse(ctx, &tick, &clock, building);
    }

    phase!(logistics_phase, "backyard gardens");
    step_backyard_gardens(ctx, &tick, &clock, environment);
    phase!(logistics_phase, "food spoilage");
    step_fresh_food_spoilage(ctx, &clock, environment, world_seed, food_spoilage_rate);
    // Physical hauling ends at stalls. Several checks per game day issue real
    // market stock to connected homes after local production, intake, and
    // spoilage without multiplying the household's monthly target lot.
    #[cfg(feature = "local-loadtest")]
    drop(logistics_timer);
    #[cfg(feature = "local-loadtest")]
    drop(logistics_phase);
    #[cfg(feature = "local-loadtest")]
    let households_timer = spacetimedb::log_stopwatch::LogStopwatch::new("realm households");
    drop(labor_roster_cache);
    step_market_household_distribution(ctx, &tick, sim_tick, environment);

    // Religious houses buy only from staffed Trading Posts, never directly
    // from Household wares stalls. Players therefore route scarce candles to
    // Tier-4 comfort through the Storehouse/Marketplace branch, or to local
    // devotional contracts and regional export through the Trading Post.
    let devotional_institution_ids = chapel_ids
        .iter()
        .chain(monastery_ids.iter())
        .copied()
        .collect::<Vec<_>>();
    step_devotional_candles(ctx, &tick, &clock, &devotional_institution_ids);

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

    let infirmary_assignments =
        crate::simulation::monastery_infirmary_assignments(ctx, &tick, &residences, &monasteries);

    for residence in residences {
        if tick.residence_disabled_by_fire(ctx, residence.id) {
            continue;
        }
        step_residence(
            ctx,
            &tick,
            &chapels,
            &monasteries,
            infirmary_assignments.get(&residence.id).copied(),
            residence,
            &clock,
            environment,
            world_seed,
            sim_tick,
            food_spoilage_rate,
        );
    }
    #[cfg(feature = "local-loadtest")]
    drop(households_timer);
    // Household steps can change the healthy population. Start a fresh roster
    // cache for burial/reclamation/founders' hauling; cart and military labor
    // reservations are still read live, as in the production phase above.
    let _tail_labor_cache = crate::economy::cache_production_labor_rosters();
    #[cfg(feature = "local-loadtest")]
    let tail_phase = spacetimedb::log_stopwatch::LogStopwatch::new("burials");
    step_burials(ctx, &tick, &clock, TICK_DT);
    phase!(tail_phase, "reclamation");
    step_reclamation_piles(ctx, &tick, &clock, reclamation_pile_ids);
    phase!(tail_phase, "founding sites");
    step_founding_sites(ctx, &tick, &clock);
}
