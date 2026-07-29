use spacetimedb::ReducerContext;

use crate::db::*;
use crate::season_policy::EnvironmentState;
use crate::simulation::game_calendar::GameClock;
use crate::simulation::landmark_access::{
    residence_has_chapel_access, residence_has_monastery_coverage,
};
use crate::simulation::residence_needs::{
    load_needs, step_residence_decay, step_residence_needs, step_residence_recovery,
};
use crate::simulation::residence_settlement::step_residence_settlement;
use crate::simulation::tick_context::SimTickContext;
use crate::tables::{Building, Residence};

pub fn step_residence(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    chapels: &[Building],
    monasteries: &[Building],
    residence: Residence,
    clock: &GameClock,
    environment: EnvironmentState,
    world_seed: u64,
    sim_tick: u64,
) {
    let residence_id = residence.id;
    let has_chapel_access =
        residence_has_chapel_access(ctx, tick, residence.owner, &residence, chapels);
    let has_monastery_coverage =
        residence_has_monastery_coverage(ctx, tick, residence.owner, &residence, monasteries);

    step_residence_decay(ctx, residence);

    let Some(residence) = ctx.db.residence().id().find(&residence_id) else {
        return;
    };
    step_residence_recovery(
        ctx,
        tick,
        residence,
        has_chapel_access,
        has_monastery_coverage,
    );

    let Some(residence) = ctx.db.residence().id().find(&residence_id) else {
        return;
    };
    if residence.abandoned {
        return;
    }
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
        has_chapel_access,
        has_monastery_coverage,
        clock,
        environment,
        world_seed,
        sim_tick,
    );
}
