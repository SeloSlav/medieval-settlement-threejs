use spacetimedb::{reducer, ReducerContext, ScheduleAt};

#[spacetimedb::table(accessor = sim_tick_schedule, scheduled(tick_sim))]
#[derive(Clone, Debug)]
pub struct SimTickSchedule {
    #[primary_key]
    #[auto_inc]
    pub schedule_id: u64,
    pub scheduled_at: ScheduleAt,
}

#[reducer]
pub fn tick_sim(ctx: &ReducerContext, schedule: SimTickSchedule) -> Result<(), String> {
    // The scheduled reducer is not a player-accessible time-advance command.
    if ctx.sender() != ctx.database_identity() { return Err("Only the server can advance the shared simulation.".into()); }
    crate::reducers::simulation::run_sim_tick(ctx, schedule);
    Ok(())
}
