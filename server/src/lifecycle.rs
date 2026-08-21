use spacetimedb::{reducer, Identity, ReducerContext, ScheduleAt, TimeDuration};

use crate::balance_generated::{
    CHAPEL_COFFER_RESERVE_DEFAULT, ECONOMIC_ACTIVITY_TAX_RATE, STARTING_BREAD, STARTING_FIREWOOD,
    STARTING_IRONWORK,
};
use crate::constants::TICK_MICROS;
use crate::db::*;
use crate::economy::{
    ensure_market_state, reconcile_building_labor, STARTING_GOLD, STARTING_STONE, STARTING_TIMBER,
};
use crate::labor_steward_policy::{
    CONSTRUCTION_LABOR_STEWARD_DEFAULT, PRODUCTION_LABOR_STEWARD_DEFAULT,
    SEASONAL_LABOR_STEWARD_DEFAULT,
};
use crate::reducers::world_configuration::default_world_config;
use crate::schedule::SimTickSchedule;
use crate::simulation::{
    ensure_settlement_security, materialize_physical_construction_reservations,
    materialize_physical_resource_ledger,
};
use crate::tables::{ActiveGameSession, ForagingNode, PlayerResources, Quarry, TreeEntity};
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
    let owner = ctx.sender();
    ensure_player_resources(ctx, owner);
    // Repair legacy or interrupted saves once when their owner returns. Normal
    // population-loss events reconcile immediately at the mutation site, so
    // the hot simulation loop never needs a settlement-wide fallback scan.
    reconcile_building_labor(ctx, owner);
    // Old module versions could clear the compatibility row without converting
    // construction_treasury_* shares. Repair that bounded legacy case once on
    // reconnect rather than scanning every ordinary resource reducer.
    materialize_physical_construction_reservations(ctx, owner);
}

/// Marks this exact transport connection as an active gameplay client.
///
/// Connecting to the database is deliberately insufficient: startup probes
/// and clients that are still subscribing must not resume authoritative time.
/// The browser invokes this only after bootstrap and road hydration complete.
#[reducer]
pub fn enter_world(ctx: &ReducerContext) -> Result<(), String> {
    let connection_id = ctx
        .connection_id()
        .ok_or_else(|| "enter_world requires a live client connection".to_string())?;
    let identity = ctx.sender();

    if let Some(session) = ctx
        .db
        .active_game_session()
        .connection_id()
        .find(&connection_id)
    {
        if session.identity != identity {
            return Err("active gameplay connection belongs to another identity".to_string());
        }
        return Ok(());
    }

    ctx.db.active_game_session().insert(ActiveGameSession {
        connection_id,
        identity,
        entered_at: ctx.timestamp,
    });
    Ok(())
}

/// Removes only the terminated connection. Other tabs (and future co-op
/// clients) keep their rows, so simulation pauses only after the last active
/// gameplay connection leaves.
#[reducer(client_disconnected)]
pub fn client_disconnected(ctx: &ReducerContext) {
    let Some(connection_id) = ctx.connection_id() else {
        return;
    };
    ctx.db
        .active_game_session()
        .connection_id()
        .delete(&connection_id);
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
                is_rich: quarry.is_rich,
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
        ensure_market_state(ctx, owner);
        ensure_settlement_security(ctx, owner);
        if let Err(error) = materialize_physical_resource_ledger(ctx, owner) {
            log::warn!("Could not materialize connected player's resource ledger: {error}");
        }
        return;
    }
    ctx.db.player_resources().insert(PlayerResources {
        owner,
        timber: STARTING_TIMBER,
        stone: STARTING_STONE,
        firewood: STARTING_FIREWOOD,
        water: 0.0,
        gold: STARTING_GOLD,
        food: 0.0,
        ale: 0.0,
        preserved_food: 0.0,
        honey: 0.0,
        wine: 0.0,
        ironwork: STARTING_IRONWORK,
        polearms: 0.0,
        wool: 0.0,
        cloth: 0.0,
        economic_activity_tax_rate: ECONOMIC_ACTIVITY_TAX_RATE,
        chapel_auto_sweep_enabled: false,
        chapel_coffer_reserve_gold: CHAPEL_COFFER_RESERVE_DEFAULT,
        sabbath_observance_enabled: false,
        monastery_tithe_share: crate::balance_generated::MONASTERY_TITHE_SHARE_DEFAULT,
        monastery_feasts_enabled: true,
        parish_manual_collect_total: 0.0,
        parish_auto_sweep_total: 0.0,
        parish_salary_paid_total: 0.0,
        parish_upkeep_paid_total: 0.0,
        parish_charity_paid_total: 0.0,
        monastery_tithe_paid_total: 0.0,
        monastery_pilgrimage_gold_total: 0.0,
        monastery_food_charity_total: 0.0,
        monastery_levy_rate: 0.10,
        monastery_levy_collected_total: 0.0,
        monastery_feasts_held_total: 0,
        monastery_seed_rescue_total: 0.0,
        monastery_scriptorium_timber_saved_total: 0.0,
        monastery_scriptorium_stone_saved_total: 0.0,
        monastery_scriptorium_ironwork_saved_total: 0.0,
        monastery_scriptorium_roof_tiles_saved_total: 0.0,
        seasonal_labor_steward_enabled: SEASONAL_LABOR_STEWARD_DEFAULT,
        construction_labor_steward_enabled: CONSTRUCTION_LABOR_STEWARD_DEFAULT,
        production_labor_steward_enabled: PRODUCTION_LABOR_STEWARD_DEFAULT,
        labor_steward_reserve: crate::labor_steward_policy::LABOR_STEWARD_RESERVE_DEFAULT,
        physical_founding_site_enabled: false,
        legacy_unhoused_population_bonus_enabled: true,
        barley: 0.0,
        malt: 0.0,
        flax: 0.0,
        iron: 0.0,
        clay: 0.0,
        salt: 0.0,
        charcoal: 0.0,
        pottery: 0.0,
        night_watch_policy: 0,
        night_gathering_policy: 1,
        night_work_policy: 1,
        night_lighting_policy: 1,
        night_curfew_policy: 1,
        last_night_report_day: 0,
        last_night_households: 0,
        local_discretionary_spend_total: 0.0,
        local_producer_income_total: 0.0,
        last_night_well_rested_households: 0,
        last_night_cold_households: 0,
        last_night_social_households: 0,
        last_night_workers: 0,
        last_night_watch_strength: 0.0,
        last_night_incidents: 0,
        last_night_theft_gold: 0.0,
        last_night_wildlife_sightings: 0,
        last_night_lighting_fuel_used: 0.0,
        last_night_lighting_fuel_shortfall: 0.0,
        night_community_cohesion: 0.5,
        night_labor_fatigue: 0.0,
        roof_tiles: 0.0,
        meat: 0.0,
        fish: 0.0,
        berries: 0.0,
        mushrooms: 0.0,
        milk: 0.0,
        apples: 0.0,
        cherries: 0.0,
        vegetables: 0.0,
        eggs: 0.0,
        grapes: 0.0,
        cured_meat: 0.0,
        smoked_fish: 0.0,
        cheese: 0.0,
        land_levy_rate: crate::balance_generated::LAND_LEVY_RATE_DEFAULT,
        import_duty_rate: crate::balance_generated::IMPORT_DUTY_RATE_DEFAULT,
        export_duty_rate: crate::balance_generated::EXPORT_DUTY_RATE_DEFAULT,
        land_levy_assessed_total: 0.0,
        land_levy_collected_total: 0.0,
        import_duty_collected_total: 0.0,
        export_duty_collected_total: 0.0,
        private_export_income_total: 0.0,
        rye_sheaves: 0.0,
        oat_sheaves: 0.0,
        barley_sheaves: 0.0,
        maslin_sheaves: 0.0,
        rye_grain: 0.0,
        oat_grain: 0.0,
        maslin_grain: 0.0,
        rye_flour: 0.0,
        maslin_flour: 0.0,
        rye_bread: STARTING_BREAD,
        maslin_bread: 0.0,
        pantry_safeguard_policy: crate::pantry_safeguard_policy::PANTRY_SAFEGUARD_DEFAULT,
        cider: 0.0,
        mead: 0.0,
        hides: 0.0,
        leather: 0.0,
        shoes: 0.0,
    });
    ensure_market_state(ctx, owner);
    ensure_settlement_security(ctx, owner);
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
