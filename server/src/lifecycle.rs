use spacetimedb::{reducer, Identity, ReducerContext, ScheduleAt, TimeDuration};

use crate::constants::{DEFAULT_WORLD_SEED, TICK_MICROS};
use crate::economy::{STARTING_STONE, STARTING_WOOD};
use crate::db::*;
use crate::schedule::SimTickSchedule;
use crate::tables::{PlayerResources, Quarry, TreeEntity, WorldConfig};
use crate::world_gen;

#[reducer(init)]
pub fn init(ctx: &ReducerContext) {
    ctx.db.world_config().insert(WorldConfig {
        id: 0,
        seed: DEFAULT_WORLD_SEED,
        next_building_id: 1,
        sim_tick: 0,
    });
    seed_world_entities(ctx);
    ensure_sim_schedule(ctx);
    log::info!("Medieval Road System module initialized (seed={DEFAULT_WORLD_SEED})");
}

#[reducer(client_connected)]
pub fn client_connected(ctx: &ReducerContext) {
    ensure_player_resources(ctx, ctx.sender());
}

pub fn seed_world_entities(ctx: &ReducerContext) {
    if ctx.db.quarry().iter().count() == 0 {
        for quarry in world_gen::bootstrap_quarry_rows() {
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

pub fn ensure_player_resources(ctx: &ReducerContext, owner: Identity) {
    if ctx.db.player_resources().owner().find(&owner).is_some() {
        return;
    }
    ctx.db.player_resources().insert(PlayerResources {
        owner,
        wood: STARTING_WOOD,
        stone: STARTING_STONE,
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
