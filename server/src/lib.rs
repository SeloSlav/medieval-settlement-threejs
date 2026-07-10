//! Medieval Road System — SpacetimeDB server module.
//! Single-player localhost: anonymous identity per browser token; resources/buildings/roads scoped by owner.

mod world_gen;

use spacetimedb::{reducer, Identity, ReducerContext, ScheduleAt, Table, TimeDuration};

pub const DEFAULT_WORLD_SEED: u64 = 0x71a2e0d;
const TICK_MICROS: i64 = 200_000;
const TICK_DT: f64 = 0.2;

const LUMBER_MILL_RADIUS: f64 = 42.0;
const LUMBER_MILL_INTERVAL: f64 = 3.5;
const REFORESTER_RADIUS: f64 = 38.0;
const REFORESTER_REGROW_PER_SEC: f64 = 0.035;
const STONE_QUARRY_RADIUS: f64 = 55.0;
const STONE_QUARRY_INTERVAL: f64 = 4.0;
const STONE_PER_HARVEST: f64 = 10.0;

// --- Tables ---

#[spacetimedb::table(accessor = world_config, public)]
pub struct WorldConfig {
    #[primary_key]
    pub id: u8,
    pub seed: u64,
    pub next_building_id: u64,
    pub sim_tick: u64,
}

#[spacetimedb::table(accessor = player_resources, public)]
pub struct PlayerResources {
    #[primary_key]
    pub owner: Identity,
    pub wood: f64,
    pub stone: f64,
    pub water: f64,
}

#[spacetimedb::table(accessor = quarry, public)]
pub struct Quarry {
    #[primary_key]
    pub quarry_id: String,
    pub x: f64,
    pub z: f64,
    pub max_yield: f64,
    pub remaining: f64,
}

#[spacetimedb::table(accessor = tree_entity, public)]
pub struct TreeEntity {
    #[primary_key]
    pub tree_id: String,
    pub layout_index: u32,
    pub phase: String,
    pub growth_progress: f64,
    pub wood_yield: f64,
    pub x: f64,
    pub z: f64,
}

#[spacetimedb::table(accessor = building, public, index(accessor = owner, btree(columns = [owner])))]
pub struct Building {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub owner: Identity,
    pub kind: String,
    pub x: f64,
    pub z: f64,
    pub work_radius: f64,
    pub action_cooldown: f64,
}

#[spacetimedb::table(accessor = road_network_state, public)]
pub struct RoadNetworkState {
    #[primary_key]
    pub owner: Identity,
    pub snapshot_json: String,
}

#[spacetimedb::table(accessor = sim_tick_schedule, scheduled(tick_sim))]
#[derive(Clone, Debug)]
pub struct SimTickSchedule {
    #[primary_key]
    #[auto_inc]
    pub schedule_id: u64,
    pub scheduled_at: ScheduleAt,
}

// --- Bootstrap payloads ---

#[derive(spacetimedb::SpacetimeType, Clone, Debug)]
pub struct QuarryBootstrap {
    pub quarry_id: String,
    pub x: f64,
    pub z: f64,
    pub max_yield: f64,
}

#[derive(spacetimedb::SpacetimeType, Clone, Debug)]
pub struct TreeBootstrap {
    pub tree_id: String,
    pub layout_index: u32,
    pub wood_yield: f64,
    pub x: f64,
    pub z: f64,
}

// --- Lifecycle ---

#[reducer(init)]
pub fn init(ctx: &ReducerContext) {
    ctx.db.world_config().insert(WorldConfig {
        id: 0,
        seed: DEFAULT_WORLD_SEED,
        next_building_id: 1,
        sim_tick: 0,
    });
    seed_world_entities(ctx, DEFAULT_WORLD_SEED);
    ensure_sim_schedule(ctx);
    log::info!("Medieval Road System module initialized (seed={DEFAULT_WORLD_SEED})");
}

fn seed_world_entities(ctx: &ReducerContext, seed: u64) {
    if ctx.db.quarry().iter().count() == 0 {
        for quarry in world_gen::bootstrap_quarry_rows(seed) {
            ctx.db.quarry().insert(Quarry {
                quarry_id: quarry.quarry_id,
                x: quarry.x,
                z: quarry.z,
                max_yield: quarry.max_yield,
                remaining: quarry.max_yield,
            });
        }
    }

    if ctx.db.tree_entity().iter().count() == 0 {
        for tree in world_gen::bootstrap_tree_rows() {
            if tree.tree_id.is_empty() {
                continue;
            }
            ctx.db.tree_entity().insert(TreeEntity {
                tree_id: tree.tree_id,
                layout_index: tree.layout_index,
                phase: "mature".to_string(),
                growth_progress: 1.0,
                wood_yield: tree.wood_yield.max(1.0),
                x: tree.x,
                z: tree.z,
            });
        }
    }
}

#[reducer(client_connected)]
pub fn client_connected(ctx: &ReducerContext) {
    ensure_player_resources(ctx, ctx.sender());
}

fn ensure_player_resources(ctx: &ReducerContext, owner: Identity) {
    if ctx.db.player_resources().owner().find(&owner).is_some() {
        return;
    }
    ctx.db.player_resources().insert(PlayerResources {
        owner,
        wood: 0.0,
        stone: 0.0,
        water: 0.0,
    });
}

fn ensure_sim_schedule(ctx: &ReducerContext) {
    if ctx.db.sim_tick_schedule().iter().count() > 0 {
        return;
    }
    let tick = TimeDuration::from_micros(TICK_MICROS);
    let _ = ctx.db.sim_tick_schedule().try_insert(SimTickSchedule {
        schedule_id: 0,
        scheduled_at: ScheduleAt::Interval(tick),
    });
}

// --- World bootstrap (client sends deterministic layout once) ---

#[reducer]
pub fn bootstrap_quarries(ctx: &ReducerContext, quarries: Vec<QuarryBootstrap>) -> Result<(), String> {
    if !quarries.is_empty() {
        for quarry in quarries {
            if quarry.quarry_id.is_empty() || quarry.max_yield <= 0.0 {
                continue;
            }
            if let Some(existing) = ctx.db.quarry().quarry_id().find(&quarry.quarry_id) {
                ctx.db.quarry().quarry_id().update(Quarry {
                    x: quarry.x,
                    z: quarry.z,
                    max_yield: quarry.max_yield,
                    remaining: existing.remaining.min(quarry.max_yield),
                    ..existing
                });
            } else {
                ctx.db.quarry().insert(Quarry {
                    quarry_id: quarry.quarry_id,
                    x: quarry.x,
                    z: quarry.z,
                    max_yield: quarry.max_yield,
                    remaining: quarry.max_yield,
                });
            }
        }
        return Ok(());
    }

    if ctx.db.quarry().iter().count() > 0 {
        return Ok(());
    }

    let config = ctx
        .db
        .world_config()
        .id()
        .find(&0)
        .ok_or_else(|| "World not initialized.".to_string())?;
    seed_world_entities(ctx, config.seed);
    Ok(())
}

#[reducer]
pub fn bootstrap_trees(ctx: &ReducerContext, trees: Vec<TreeBootstrap>) -> Result<(), String> {
    if !trees.is_empty() {
        for tree in trees {
            if tree.tree_id.is_empty() {
                continue;
            }
            if ctx.db.tree_entity().tree_id().find(&tree.tree_id).is_some() {
                continue;
            }
            ctx.db.tree_entity().insert(TreeEntity {
                tree_id: tree.tree_id,
                layout_index: tree.layout_index,
                phase: "mature".to_string(),
                growth_progress: 1.0,
                wood_yield: tree.wood_yield.max(1.0),
                x: tree.x,
                z: tree.z,
            });
        }
        return Ok(());
    }

    if ctx.db.tree_entity().iter().count() > 0 {
        return Ok(());
    }

    seed_world_entities(ctx, DEFAULT_WORLD_SEED);
    Ok(())
}

// --- Player actions ---

#[reducer]
pub fn place_building(ctx: &ReducerContext, kind: String, x: f64, z: f64) -> Result<(), String> {
    let (work_radius, _) = building_params(&kind)?;
    let owner = ctx.sender();
    ensure_player_resources(ctx, owner);

    let config = ctx
        .db
        .world_config()
        .id()
        .find(&0)
        .ok_or_else(|| "World not initialized.".to_string())?;

    let building_id = config.next_building_id;
    ctx.db.building().insert(Building {
        id: 0,
        owner,
        kind,
        x,
        z,
        work_radius,
        action_cooldown: 0.0,
    });

    ctx.db.world_config().id().update(WorldConfig {
        next_building_id: building_id + 1,
        ..config
    });

    Ok(())
}

#[reducer]
pub fn sync_road_network(ctx: &ReducerContext, snapshot_json: String) -> Result<(), String> {
    if snapshot_json.is_empty() {
        return Err("Road snapshot must not be empty.".to_string());
    }
    let owner = ctx.sender();
    if let Some(existing) = ctx.db.road_network_state().owner().find(&owner) {
        ctx.db.road_network_state().owner().update(RoadNetworkState {
            snapshot_json,
            ..existing
        });
    } else {
        ctx.db.road_network_state().insert(RoadNetworkState {
            owner,
            snapshot_json,
        });
    }
    Ok(())
}

#[reducer]
pub fn remove_road_edge(ctx: &ReducerContext, edge_id: String) -> Result<(), String> {
    let owner = ctx.sender();
    let state = ctx
        .db
        .road_network_state()
        .owner()
        .find(&owner)
        .ok_or_else(|| "No road network to update.".to_string())?;

    let mut snapshot: serde_json::Value = serde_json::from_str(&state.snapshot_json)
        .map_err(|_| "Stored road snapshot is invalid JSON.".to_string())?;

    if let Some(edges) = snapshot.get_mut("edges").and_then(|v| v.as_array_mut()) {
        edges.retain(|edge| edge.get("id").and_then(|id| id.as_str()) != Some(edge_id.as_str()));
    } else {
        return Err("Road snapshot missing edges array.".to_string());
    }

    let updated = serde_json::to_string(&snapshot)
        .map_err(|_| "Failed to serialize road snapshot.".to_string())?;

    ctx.db.road_network_state().owner().update(RoadNetworkState {
        snapshot_json: updated,
        ..state
    });
    Ok(())
}

// --- Simulation tick ---

#[reducer]
pub fn tick_sim(ctx: &ReducerContext, _schedule: SimTickSchedule) {
    if let Some(config) = ctx.db.world_config().id().find(&0) {
        ctx.db.world_config().id().update(WorldConfig {
            sim_tick: config.sim_tick + 1,
            ..config
        });
    }

    let building_ids: Vec<u64> = ctx.db.building().iter().map(|b| b.id).collect();
    for building_id in building_ids {
        let Some(building) = ctx.db.building().id().find(&building_id) else {
            continue;
        };
        match building.kind.as_str() {
            "lumber_mill" => step_lumber_mill(ctx, building),
            "reforester" => step_reforester(ctx, building),
            "stone_quarry" => step_stone_quarry(ctx, building),
            _ => {}
        }
    }
}

fn step_lumber_mill(ctx: &ReducerContext, building: Building) {
    let cooldown = (building.action_cooldown - TICK_DT).max(0.0);
    if cooldown > 0.0 {
        ctx.db.building().id().update(Building {
            action_cooldown: cooldown,
            ..building
        });
        return;
    }

    let Some(target) = find_nearest_mature_tree(ctx, building.x, building.z, LUMBER_MILL_RADIUS) else {
        ctx.db.building().id().update(Building {
            action_cooldown: LUMBER_MILL_INTERVAL,
            ..building
        });
        return;
    };

    ctx.db.tree_entity().tree_id().update(TreeEntity {
        phase: "stump".to_string(),
        growth_progress: 0.0,
        ..target
    });

    if let Some(mut resources) = ctx.db.player_resources().owner().find(&building.owner) {
        resources.wood += target.wood_yield;
        ctx.db.player_resources().owner().update(resources);
    }

    ctx.db.building().id().update(Building {
        action_cooldown: LUMBER_MILL_INTERVAL,
        ..building
    });
}

fn step_reforester(ctx: &ReducerContext, building: Building) {
    for tree in ctx.db.tree_entity().iter() {
        let dx = tree.x - building.x;
        let dz = tree.z - building.z;
        if dx * dx + dz * dz > REFORESTER_RADIUS * REFORESTER_RADIUS {
            continue;
        }

        match tree.phase.as_str() {
            "stump" => {
                ctx.db.tree_entity().tree_id().update(TreeEntity {
                    phase: "growing".to_string(),
                    growth_progress: REFORESTER_REGROW_PER_SEC * TICK_DT,
                    ..tree
                });
            }
            "growing" => {
                let progress = tree.growth_progress + REFORESTER_REGROW_PER_SEC * TICK_DT;
                if progress >= 1.0 {
                    ctx.db.tree_entity().tree_id().update(TreeEntity {
                        phase: "mature".to_string(),
                        growth_progress: 1.0,
                        ..tree
                    });
                } else {
                    ctx.db.tree_entity().tree_id().update(TreeEntity {
                        growth_progress: progress,
                        ..tree
                    });
                }
            }
            _ => {}
        }
    }
}

fn step_stone_quarry(ctx: &ReducerContext, building: Building) {
    let cooldown = (building.action_cooldown - TICK_DT).max(0.0);
    if cooldown > 0.0 {
        ctx.db.building().id().update(Building {
            action_cooldown: cooldown,
            ..building
        });
        return;
    }

    let Some(quarry) = find_nearest_quarry(ctx, building.x, building.z, STONE_QUARRY_RADIUS) else {
        ctx.db.building().id().update(Building {
            action_cooldown: STONE_QUARRY_INTERVAL,
            ..building
        });
        return;
    };

    let extracted = STONE_PER_HARVEST.min(quarry.remaining);
    if extracted <= 0.0 {
        ctx.db.building().id().update(Building {
            action_cooldown: STONE_QUARRY_INTERVAL,
            ..building
        });
        return;
    }

    ctx.db.quarry().quarry_id().update(Quarry {
        remaining: quarry.remaining - extracted,
        ..quarry
    });

    if let Some(mut resources) = ctx.db.player_resources().owner().find(&building.owner) {
        resources.stone += extracted;
        ctx.db.player_resources().owner().update(resources);
    }

    ctx.db.building().id().update(Building {
        action_cooldown: STONE_QUARRY_INTERVAL,
        ..building
    });
}

fn find_nearest_mature_tree(
    ctx: &ReducerContext,
    x: f64,
    z: f64,
    radius: f64,
) -> Option<TreeEntity> {
    let radius_sq = radius * radius;
    let mut best: Option<TreeEntity> = None;
    let mut best_dist = f64::INFINITY;

    for tree in ctx.db.tree_entity().iter() {
        if tree.phase != "mature" {
            continue;
        }
        let dx = tree.x - x;
        let dz = tree.z - z;
        let dist_sq = dx * dx + dz * dz;
        if dist_sq > radius_sq || dist_sq >= best_dist {
            continue;
        }
        best_dist = dist_sq;
        best = Some(tree);
    }

    best
}

fn find_nearest_quarry(ctx: &ReducerContext, x: f64, z: f64, radius: f64) -> Option<Quarry> {
    let radius_sq = radius * radius;
    let mut best: Option<Quarry> = None;
    let mut best_dist = f64::INFINITY;

    for quarry in ctx.db.quarry().iter() {
        if quarry.remaining <= 0.0 {
            continue;
        }
        let dx = quarry.x - x;
        let dz = quarry.z - z;
        let dist_sq = dx * dx + dz * dz;
        if dist_sq > radius_sq || dist_sq >= best_dist {
            continue;
        }
        best_dist = dist_sq;
        best = Some(quarry);
    }

    best
}

fn building_params(kind: &str) -> Result<(f64, f64), String> {
    match kind {
        "lumber_mill" => Ok((LUMBER_MILL_RADIUS, LUMBER_MILL_INTERVAL)),
        "reforester" => Ok((REFORESTER_RADIUS, 0.0)),
        "stone_quarry" => Ok((STONE_QUARRY_RADIUS, STONE_QUARRY_INTERVAL)),
        _ => Err(format!("Unknown building kind: {kind}")),
    }
}
