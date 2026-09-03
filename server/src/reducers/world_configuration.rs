use spacetimedb::{reducer, ReducerContext};

use crate::constants::DEFAULT_WORLD_SEED;
use crate::db::*;
use crate::tables::{SimPacingState, WorldConfig};
use crate::world_entities::{clear_global_world_entities, has_global_world_entities};

const MAP_SIZE_SMALL: u8 = 0;
const MAP_SIZE_MEDIUM: u8 = 1;
const MAP_SIZE_LARGE: u8 = 2;
const VALID_GAME_SPEEDS: [u8; 4] = [0, 1, 4, 8];

#[reducer]
pub fn set_game_speed(ctx: &ReducerContext, speed: u8) -> Result<(), String> {
    if !VALID_GAME_SPEEDS.contains(&speed) {
        return Err("speed must be 0 (paused), 1, 4, or 8".into());
    }
    let config = ctx
        .db
        .world_config()
        .id()
        .find(&0)
        .ok_or_else(|| "world_config row missing".to_string())?;
    // Reasserting the current speed must not discard a partial simulation step.
    if config.game_speed == speed {
        return Ok(());
    }
    ctx.db.world_config().id().update(WorldConfig {
        game_speed: speed,
        ..config
    });
    if ctx.db.sim_pacing_state().id().find(&0).is_some() {
        ctx.db.sim_pacing_state().id().update(SimPacingState {
            id: 0,
            step_credit: 0,
        });
    }
    Ok(())
}

#[reducer]
pub fn configure_world(
    ctx: &ReducerContext,
    seed: u64,
    map_size: u8,
    topography: u8,
    hydrology: u8,
    forest_density: u8,
    resource_abundance: u8,
    resource_variety: u8,
    conflict_enabled: bool,
    enemy_pressure: u8,
    bandit_camps_enabled: bool,
    severe_weather_enabled: bool,
    well_aquifer_networks_enabled: bool,
    approval_decline_rate: u8,
    food_spoilage_rate: u8,
    initial_goods_multiplier: u8,
    military_demands: u8,
    wild_animal_attacks_enabled: bool,
) -> Result<(), String> {
    validate_map_size(map_size)?;
    validate_percent(topography, "topography")?;
    validate_percent(hydrology, "hydrology")?;
    validate_percent(forest_density, "forest_density")?;
    validate_percent(resource_abundance, "resource_abundance")?;
    validate_percent(resource_variety, "resource_variety")?;
    validate_percent(enemy_pressure, "enemy_pressure")?;
    validate_difficulty_rate(approval_decline_rate, "approval_decline_rate")?;
    validate_difficulty_rate(food_spoilage_rate, "food_spoilage_rate")?;
    validate_initial_goods_multiplier(initial_goods_multiplier)?;
    validate_military_demands(military_demands)?;
    let enemy_pressure = if conflict_enabled {
        enemy_pressure.max(1)
    } else {
        0
    };

    let config = ctx
        .db
        .world_config()
        .id()
        .find(&0)
        .ok_or_else(|| "world_config row missing".to_string())?;

    let terrain_changed = config.seed != seed
        || config.map_size != map_size
        || config.topography != topography
        || config.hydrology != hydrology
        || config.forest_density != forest_density;
    let resources_changed = config.resource_abundance != resource_abundance
        || config.resource_variety != resource_variety;
    let rules_changed = config.conflict_enabled != conflict_enabled
        || config.enemy_pressure != enemy_pressure
        || config.bandit_camps_enabled != bandit_camps_enabled
        || config.severe_weather_enabled != severe_weather_enabled
        || config.well_aquifer_networks_enabled != well_aquifer_networks_enabled
        || config.approval_decline_rate != approval_decline_rate
        || config.food_spoilage_rate != food_spoilage_rate
        || config.initial_goods_multiplier != initial_goods_multiplier
        || config.military_demands != military_demands
        || config.wild_animal_attacks_enabled != wild_animal_attacks_enabled;
    let setup_changed = terrain_changed || resources_changed || rules_changed;

    // Only lock generation after a client has published settings. The sim scheduler
    // may be running while configured=false (e.g. idle server before first connect).
    if setup_changed && config.configured && config.sim_tick > 0 {
        return Err("Cannot change world setup after the simulation has started.".into());
    }

    if (terrain_changed || resources_changed) && has_global_world_entities(ctx) {
        clear_global_world_entities(ctx);
    }

    if setup_changed || !config.configured {
        ctx.db.world_config().id().update(WorldConfig {
            seed,
            map_size,
            topography,
            hydrology,
            forest_density,
            resource_abundance,
            resource_variety,
            conflict_enabled,
            enemy_pressure,
            bandit_camps_enabled,
            severe_weather_enabled,
            well_aquifer_networks_enabled,
            approval_decline_rate,
            food_spoilage_rate,
            initial_goods_multiplier,
            military_demands,
            wild_animal_attacks_enabled,
            configured: true,
            // Repair idle ticks that ran before the first client published settings.
            sim_tick: if !config.configured {
                0
            } else {
                config.sim_tick
            },
            ..config
        });
    }

    Ok(())
}

fn validate_map_size(map_size: u8) -> Result<(), String> {
    if map_size == MAP_SIZE_SMALL || map_size == MAP_SIZE_MEDIUM || map_size == MAP_SIZE_LARGE {
        return Ok(());
    }
    Err(format!(
        "map_size must be {MAP_SIZE_SMALL}, {MAP_SIZE_MEDIUM}, or {MAP_SIZE_LARGE}"
    ))
}

fn validate_percent(value: u8, label: &str) -> Result<(), String> {
    if value <= 100 {
        return Ok(());
    }
    Err(format!("{label} must be between 0 and 100"))
}

fn validate_difficulty_rate(value: u8, label: &str) -> Result<(), String> {
    if matches!(value, 0 | 100 | 150) {
        return Ok(());
    }
    Err(format!("{label} must be 0, 100, or 150"))
}

fn validate_initial_goods_multiplier(value: u8) -> Result<(), String> {
    if matches!(value, 1 | 2) {
        return Ok(());
    }
    Err("initial_goods_multiplier must be 1 or 2".into())
}

fn validate_military_demands(value: u8) -> Result<(), String> {
    if value <= 2 {
        return Ok(());
    }
    Err("military_demands must be 0, 1, or 2".into())
}

pub fn default_world_config() -> WorldConfig {
    WorldConfig {
        id: 0,
        seed: DEFAULT_WORLD_SEED,
        next_building_id: 1,
        sim_tick: 0,
        game_speed: 1,
        map_size: MAP_SIZE_MEDIUM,
        topography: 50,
        hydrology: 50,
        forest_density: 50,
        resource_abundance: 50,
        resource_variety: 50,
        conflict_enabled: false,
        enemy_pressure: 0,
        bandit_camps_enabled: false,
        severe_weather_enabled: false,
        well_aquifer_networks_enabled: false,
        approval_decline_rate: 100,
        food_spoilage_rate: 100,
        initial_goods_multiplier: 1,
        military_demands: 1,
        wild_animal_attacks_enabled: true,
        configured: false,
    }
}
