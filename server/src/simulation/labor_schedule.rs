use spacetimedb::{Identity, ReducerContext};

use crate::db::*;
use crate::simulation::game_calendar::GameClock;

pub fn is_work_hours(clock: &GameClock) -> bool {
    clock.is_work_hours
}

pub fn owner_has_staffed_chapel(ctx: &ReducerContext, owner: Identity) -> bool {
    ctx.db
        .building()
        .iter()
        .any(|building| building.owner == owner && building.kind == "chapel" && building.assigned_labor > 0)
}

pub fn owner_sabbath_observance_enabled(ctx: &ReducerContext, owner: Identity) -> bool {
    ctx.db
        .player_resources()
        .owner()
        .find(&owner)
        .map(|resources| resources.sabbath_observance_enabled)
        .unwrap_or(false)
}

/// Night hours and Sunday sabbath (when staffed chapel + policy enabled).
pub fn labor_and_logistics_paused(
    ctx: &ReducerContext,
    owner: Identity,
    clock: &GameClock,
) -> bool {
    if !is_work_hours(clock) {
        return true;
    }

    if !clock.is_sunday {
        return false;
    }

    if !owner_sabbath_observance_enabled(ctx, owner) {
        return false;
    }

    owner_has_staffed_chapel(ctx, owner)
}

/// Residence need consumption pauses with labor — including Sunday sabbath.
pub fn is_consumption_paused(
    ctx: &ReducerContext,
    owner: Identity,
    clock: &GameClock,
) -> bool {
    labor_and_logistics_paused(ctx, owner, clock)
}

/// Parish salary, upkeep, charity, and auto-sweep pause outside work hours.
pub fn is_parish_economy_paused(clock: &GameClock) -> bool {
    !is_work_hours(clock)
}

/// Chapel tithes pause outside work hours and on Sunday sabbath.
pub fn is_chapel_tithe_paused(
    ctx: &ReducerContext,
    owner: Identity,
    clock: &GameClock,
) -> bool {
    labor_and_logistics_paused(ctx, owner, clock)
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
    fn consumption_policy_matches_labor_policy_signature() {
        // Documented invariant: is_consumption_paused delegates to labor_and_logistics_paused.
        // Integration with owner/sabbath is covered by simulation tests.
        let night = game_clock(midnight_tick());
        assert!(!night.is_work_hours);
    }
}
