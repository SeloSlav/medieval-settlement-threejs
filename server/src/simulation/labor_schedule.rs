use spacetimedb::{Identity, ReducerContext};

use crate::simulation::game_calendar::{household_consumption_paused, GameClock};
use crate::simulation::SimTickContext;

pub fn is_work_hours(clock: &GameClock) -> bool {
    clock.is_work_hours
}

pub fn owner_has_staffed_chapel(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    owner: Identity,
) -> bool {
    tick.owner_has_staffed_chapel(ctx, owner)
}

pub fn owner_sabbath_observance_enabled(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    owner: Identity,
) -> bool {
    tick.sabbath_observance_enabled(ctx, owner)
}

/// Night hours and Sunday sabbath (when staffed chapel + policy enabled).
pub fn labor_and_logistics_paused(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    owner: Identity,
    clock: &GameClock,
) -> bool {
    if !is_work_hours(clock) {
        return true;
    }

    if !clock.is_sunday {
        return false;
    }

    if !owner_sabbath_observance_enabled(ctx, tick, owner) {
        return false;
    }

    owner_has_staffed_chapel(ctx, tick, owner)
}

/// Household consumption keeps its daytime cadence on Sundays even when work
/// and delivery carts rest, requiring homes to be provisioned in advance.
pub fn is_consumption_paused(_ctx: &ReducerContext, _owner: Identity, clock: &GameClock) -> bool {
    household_consumption_paused(clock)
}

/// Parish salary, upkeep, charity, and auto-sweep pause outside work hours.
pub fn is_parish_economy_paused(clock: &GameClock) -> bool {
    !is_work_hours(clock)
}

/// Chapel tithes pause outside work hours and on Sunday sabbath.
pub fn is_chapel_tithe_paused(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    owner: Identity,
    clock: &GameClock,
) -> bool {
    labor_and_logistics_paused(ctx, tick, owner, clock)
}

#[cfg(test)]
mod tests {
    use super::is_work_hours;
    use crate::balance_generated::{CALENDAR_SECONDS_PER_DAY, TICK_DT};
    use crate::simulation::game_calendar::game_clock;

    fn midnight_tick() -> u64 {
        ((CALENDAR_SECONDS_PER_DAY / 2.0) / TICK_DT) as u64
    }

    #[test]
    fn night_hours_pause_labor_without_db() {
        let clock = game_clock(midnight_tick());
        assert!(!is_work_hours(&clock));
    }

    #[test]
    fn night_still_pauses_household_consumption() {
        let night = game_clock(midnight_tick());
        assert!(!night.is_work_hours);
        assert!(super::household_consumption_paused(&night));
    }
}
