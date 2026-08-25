use spacetimedb::{Identity, ReducerContext};

use crate::simulation::game_calendar::{holiday_observance, GameClock};
use crate::simulation::SimTickContext;
use crate::tables::Building;

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
/// the map, at night, and during Sunday sabbath when a staffed chapel and the
/// policy are both active. Returning guards and downed raiders remain visible
/// aftermath, but no longer hold every civilian at refuge. Fire-response trips
/// deliberately bypass this helper at their dispatch and movement call sites.
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

    if !is_work_hours(clock) {
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

/// Parish wages, upkeep, and local alms accrue during the workday.
pub fn is_parish_economy_paused(clock: &GameClock) -> bool {
    !is_work_hours(clock) || holiday_observance(clock).is_some()
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
    use super::{is_work_hours, sabbath_rest_applies};
    use crate::balance_generated::{CALENDAR_SECONDS_PER_DAY, TICK_DT};
    use crate::simulation::game_calendar::{game_clock, household_consumption_paused};

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
        assert!(household_consumption_paused(&night));
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

/// Processing may continue after dark according to civic policy, but this
/// deliberately does not unpause carts, field work, construction, or any
/// activity while raiders are an active threat.
pub fn production_labor_paused(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    building: &Building,
    clock: &GameClock,
) -> bool {
    if holiday_observance(clock).is_some() {
        return true;
    }
    if clock.is_work_hours {
        return labor_and_logistics_paused(ctx, tick, building.owner, clock);
    }
    if tick.owner_has_active_raider_threat(ctx, building.owner) {
        return true;
    }
    let policy = crate::settlement_policy::night(ctx, building.owner, building.settlement_id).work;
    !crate::night_policy::night_work_allowed(policy, &building.kind)
}
