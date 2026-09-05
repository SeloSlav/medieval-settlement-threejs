use spacetimedb::ReducerContext;
use crate::tables::Building;
use super::{SimTickContext, GameClock};
pub fn step_lumber_mill(ctx: &ReducerContext, tick: &SimTickContext, clock: &GameClock, building: Building) {
    super::forestry::step_forestry(ctx, tick, clock, building);
}
