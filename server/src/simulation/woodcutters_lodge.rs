use spacetimedb::ReducerContext;
use crate::tables::Building;
use super::{SimTickContext, GameClock};
pub fn step_woodcutters_lodge(ctx: &ReducerContext, tick: &SimTickContext, clock: &GameClock, building: Building) {
    super::forestry::step_forestry(ctx, tick, clock, building);
}
