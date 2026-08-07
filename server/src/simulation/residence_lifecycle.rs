use spacetimedb::ReducerContext;

use crate::db::*;
use crate::season_policy::EnvironmentState;
use crate::simulation::game_calendar::GameClock;
use crate::simulation::landmark_access::{
    residence_chapel_tier, residence_has_monastery_coverage,
};
use crate::simulation::residence_needs::{load_needs, step_residence_needs};
use crate::simulation::residence_settlement::step_residence_settlement;
use crate::simulation::tick_context::SimTickContext;
use crate::tables::{Building, Residence};

pub fn step_residence(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    chapels: &[Building],
    monasteries: &[Building],
    mut residence: Residence,
    clock: &GameClock,
    environment: EnvironmentState,
    world_seed: u64,
    sim_tick: u64,
) {
    let residence_id = residence.id;
    // Save-compatible migration: completed homes are permanent housing stock.
    // Legacy rows are normalized in place instead of entering a recovery loop.
    if residence.abandoned
        || residence.vacancy_ticks != 0
        || residence.condition != 0
        || residence.decay_repair_active
    {
        residence.abandoned = false;
        residence.vacancy_ticks = 0;
        residence.condition = 0;
        residence.decay_repair_active = false;
        ctx.db.residence().id().update(residence.clone());
    }
    let chapel_tier =
        residence_chapel_tier(ctx, tick, residence.owner, &residence, chapels);
    let has_chapel_access = chapel_tier > 0;
    let has_monastery_coverage =
        residence_has_monastery_coverage(ctx, tick, residence.owner, &residence, monasteries);

    let Some(residence) = ctx.db.residence().id().find(&residence_id) else {
        return;
    };
    let needs = load_needs(ctx, residence.id);

    if !tick.owner_has_active_raider_threat(ctx, residence.owner) {
        let sabbath_observance =
            crate::simulation::labor_schedule::owner_sabbath_observance_enabled(
                ctx,
                tick,
                residence.owner,
            );
        step_residence_settlement(
            ctx,
            residence,
            has_chapel_access,
            has_monastery_coverage,
            sabbath_observance,
            &needs,
        );
    }

    let Some(residence) = ctx.db.residence().id().find(&residence_id) else {
        return;
    };

    step_residence_needs(
        ctx,
        tick,
        residence,
        needs,
        chapel_tier,
        has_monastery_coverage,
        clock,
        environment,
        world_seed,
        sim_tick,
    );
}
