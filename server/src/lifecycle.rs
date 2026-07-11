use spacetimedb::{reducer, Identity, ReducerContext, ScheduleAt, TimeDuration};

use crate::balance_generated::{
    CHAPEL_COFFER_RESERVE_DEFAULT, ECONOMIC_ACTIVITY_TAX_RATE,
};
use crate::constants::TICK_MICROS;
use crate::reducers::world_configuration::default_world_config;
use crate::economy::{STARTING_GOLD, STARTING_STONE, STARTING_TIMBER};
use crate::db::*;
use crate::schedule::SimTickSchedule;
use crate::tables::{ForagingNode, PlayerResources, Quarry, TreeEntity};
use crate::world_gen;

#[reducer(init)]
pub fn init(ctx: &ReducerContext) {
    let config = default_world_config();
    let seed = config.seed;
    ctx.db.world_config().insert(config);
    // Deploy-time seed from embedded JSON. Connected clients replace this with
    // layout-derived bootstrap rows via configure_world + bootstrap_* reducers.
    seed_world_entities(ctx);
    ensure_sim_schedule(ctx);
    log::info!("Medieval Road System module initialized (seed={seed})");
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

    if ctx.db.foraging_node().iter().count() == 0 {
        for node in world_gen::bootstrap_foraging_rows() {
            ctx.db.foraging_node().insert(ForagingNode {
                node_id: node.node_id,
                node_kind: node.node_kind,
                x: node.x,
                z: node.z,
                max_yield: node.max_yield,
                remaining: node.max_yield,
                respawn_cooldown: 0.0,
                anchor_x: node.anchor_x,
                anchor_z: node.anchor_z,
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
        timber: STARTING_TIMBER,
        stone: STARTING_STONE,
        firewood: 0.0,
        water: 0.0,
        gold: STARTING_GOLD,
        food: 0.0,
        economic_activity_tax_rate: ECONOMIC_ACTIVITY_TAX_RATE,
        chapel_auto_sweep_enabled: false,
        chapel_coffer_reserve_gold: CHAPEL_COFFER_RESERVE_DEFAULT,
        sabbath_observance_enabled: false,
        parish_manual_collect_total: 0.0,
        parish_auto_sweep_total: 0.0,
        parish_salary_paid_total: 0.0,
        parish_upkeep_paid_total: 0.0,
        parish_charity_paid_total: 0.0,
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
