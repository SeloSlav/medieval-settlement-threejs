use spacetimedb::{Identity, ReducerContext};

use crate::simulation::game_calendar::{holiday_observance, GameClock};
use crate::simulation::SimTickContext;
use crate::tables::Building;

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

fn sabbath_rest_applies(clock: &GameClock, policy_enabled: bool, staffed_chapel: bool) -> bool {
    clock.is_sunday && policy_enabled && staffed_chapel
}

pub fn owner_observes_sabbath(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    owner: Identity,
    clock: &GameClock,
) -> bool {
    if !clock.is_sunday {
        return false;
    }
    sabbath_rest_applies(
        clock,
        owner_sabbath_observance_enabled(ctx, tick, owner),
        owner_has_staffed_chapel(ctx, tick, owner),
    )
}

/// Ordinary work and logistics halt while a capable hostile raider remains on
/// the map, on named holy days, and during Sunday sabbath when a staffed chapel
/// and the policy are both active. Clock hours are cosmetic: an ordinary night
/// follows exactly the same rules as an ordinary day. Returning guards and
/// downed raiders remain visible aftermath, but no longer hold every civilian
/// at refuge. Fire-response trips deliberately bypass this helper.
pub fn labor_and_logistics_paused(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    owner: Identity,
    clock: &GameClock,
) -> bool {
    if holiday_observance(clock).is_some() {
        return true;
    }

    if tick.owner_has_active_raider_threat(ctx, owner) {
        return true;
    }

    owner_observes_sabbath(ctx, tick, owner, clock)
}

/// Named holy days and a policy-observed Sunday are protected household rest
/// days. Food, fuel, service shortages, and related health penalties freeze so
/// players are not punished for honoring a work prohibition.
pub fn protected_household_rest_day(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    owner: Identity,
    clock: &GameClock,
) -> bool {
    holiday_observance(clock).is_some() || owner_observes_sabbath(ctx, tick, owner, clock)
}

/// Parish wages, upkeep, and local alms accrue continuously outside holy days.
pub fn is_parish_economy_paused(clock: &GameClock) -> bool {
    holiday_observance(clock).is_some()
}

/// Chapel tithes pause on named holy days and an observed Sunday sabbath.
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
    use super::sabbath_rest_applies;
    use crate::balance_generated::{CALENDAR_SECONDS_PER_DAY, TICK_DT};
    use crate::simulation::game_calendar::{game_clock, household_consumption_paused};

    fn midnight_tick() -> u64 {
        ((CALENDAR_SECONDS_PER_DAY / 2.0) / TICK_DT) as u64
    }

    #[test]
    fn clock_still_describes_the_cosmetic_night_window() {
        let clock = game_clock(midnight_tick());
        assert!(!clock.is_work_hours);
    }

    #[test]
    fn ordinary_night_does_not_pause_household_simulation() {
        let night = game_clock(midnight_tick());
        assert!(!night.is_work_hours);
        assert!(!household_consumption_paused(&night));
    }

    #[test]
    fn sunday_rest_requires_both_policy_and_a_staffed_chapel() {
        let sunday = game_clock(0);
        assert!(sunday.is_sunday);
        assert!(sabbath_rest_applies(&sunday, true, true));
        assert!(!sabbath_rest_applies(&sunday, false, true));
        assert!(!sabbath_rest_applies(&sunday, true, false));

        let day_ticks = (CALENDAR_SECONDS_PER_DAY / TICK_DT) as u64;
        assert!(!sabbath_rest_applies(&game_clock(day_ticks), true, true));
    }
}

/// Production shares the same continuous calendar as logistics. The building
/// parameter remains useful to centralize the owner lookup for callers.
pub fn production_labor_paused(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    building: &Building,
    clock: &GameClock,
) -> bool {
    labor_and_logistics_paused(ctx, tick, building.owner, clock)
}
