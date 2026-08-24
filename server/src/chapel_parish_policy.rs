use crate::balance_generated::{
    CALENDAR_DAYS_PER_MONTH, CALENDAR_HOURS_PER_DAY, CALENDAR_SECONDS_PER_DAY,
    CALENDAR_SUNDAY_WEEKDAY, CALENDAR_WORK_END_HOUR, CALENDAR_WORK_START_HOUR,
    CHAPEL_CHARITY_GOLD_PER_DAY, CHAPEL_POOR_RELIEF_INTERVAL_DAYS,
    CHAPEL_PRIEST_SALARY_GOLD_PER_DAY, CHAPEL_UNSTAFFED_UPKEEP_FRACTION,
    CHAPEL_UPKEEP_GOLD_PER_DAY, TICK_DT,
};
use crate::holiday_calendar::holiday_for_date;
use crate::resource_units::whole_units;
use crate::residence_consumption_policy::monthly_household_bill_due;
use crate::simulation::{game_clock, GameClock};

/// Configured "per day" parish rates accrue only while the parish office is
/// active, so normalize them over the same 06:00-20:00 work window.
pub fn chapel_workday_seconds() -> f64 {
    let work_hours = CALENDAR_WORK_END_HOUR.saturating_sub(CALENDAR_WORK_START_HOUR);
    CALENDAR_SECONDS_PER_DAY * work_hours as f64 / CALENDAR_HOURS_PER_DAY.max(1) as f64
}

fn rounded_whole_units(value: f64) -> f64 {
    whole_units(value + 0.5)
}

/// Convert a legacy daily accounting rate into one physical monthly purse.
/// Rates remain useful as balance inputs; only the posted inventory lot must
/// be integral.
pub fn chapel_monthly_gold_lot(daily_rate: f64) -> f64 {
    rounded_whole_units(daily_rate.max(0.0) * CALENDAR_DAYS_PER_MONTH as f64)
}

pub fn chapel_monthly_expense_due(chapel_id: u64, clock: &GameClock) -> bool {
    monthly_household_bill_due(chapel_id, clock)
}

fn chapel_service_day_started(clock: &GameClock) -> bool {
    clock.sim_tick > 0
        && clock.is_work_hours
        && !game_clock(clock.sim_tick.saturating_sub(1)).is_work_hours
}

fn weekday_for_month_day(clock: &GameClock, month_day: u32) -> u32 {
    (clock.weekday as i64 + month_day as i64 - clock.month_day as i64).rem_euclid(7) as u32
}

fn chapel_tithe_billing_day(residence_id: u64, clock: &GameClock) -> u32 {
    let preferred = 1 + (residence_id % u64::from(CALENDAR_DAYS_PER_MONTH.max(1))) as u32;
    let eligible = |day: u32| {
        holiday_for_date(clock.month, day, clock.year).is_none()
            && weekday_for_month_day(clock, day) != CALENDAR_SUNDAY_WEEKDAY
    };
    (preferred..=CALENDAR_DAYS_PER_MONTH)
        .find(|day| eligible(*day))
        .or_else(|| (1..preferred).rev().find(|day| eligible(*day)))
        .unwrap_or(preferred)
}

/// Household tithe days are staggered, shifted off named holy days, and
/// shifted off Sundays so sabbath observance never erases an entire month's
/// obligation merely because its single posting tick was paused.
pub fn chapel_monthly_tithe_due(residence_id: u64, clock: &GameClock) -> bool {
    chapel_service_day_started(clock)
        && clock.month_day == chapel_tithe_billing_day(residence_id, clock)
}

pub fn chapel_priest_salary_lot(assigned_labor: u32) -> f64 {
    if assigned_labor == 0 {
        return 0.0;
    }
    chapel_monthly_gold_lot(CHAPEL_PRIEST_SALARY_GOLD_PER_DAY * assigned_labor as f64)
}

pub fn chapel_upkeep_lot(assigned_labor: u32) -> f64 {
    let daily = if assigned_labor > 0 {
        CHAPEL_UPKEEP_GOLD_PER_DAY
    } else {
        CHAPEL_UPKEEP_GOLD_PER_DAY * CHAPEL_UNSTAFFED_UPKEEP_FRACTION
    };
    chapel_monthly_gold_lot(daily)
}

/// A physical-economy chapel batches its small continuous alms budget into one
/// purse per parish workday. The cooldown is stored on the chapel's existing
/// action clock, so a blocked courier order remains due without another save
/// field and long routes reduce the realized charity rate.
pub fn chapel_alms_dispatch_amount() -> f64 {
    if CHAPEL_CHARITY_GOLD_PER_DAY > 0.0 {
        1.0
    } else {
        0.0
    }
}

pub fn chapel_alms_dispatch_interval_seconds() -> f64 {
    let amount = chapel_alms_dispatch_amount();
    if amount < 1.0 {
        return f64::INFINITY;
    }
    chapel_workday_seconds() * amount / CHAPEL_CHARITY_GOLD_PER_DAY.max(f64::EPSILON)
}

/// Poor relief leaves each parish on Monday morning. Deriving the cadence from
/// the global tick preserves old saves without adding per-chapel timer state.
pub fn chapel_poor_relief_due(sim_tick: u64) -> bool {
    let ticks_per_day = (CALENDAR_SECONDS_PER_DAY / TICK_DT).round() as u64;
    let interval_ticks = ticks_per_day.saturating_mul(CHAPEL_POOR_RELIEF_INTERVAL_DAYS);
    interval_ticks > 0 && sim_tick % interval_ticks == ticks_per_day
}

#[cfg(test)]
mod tests {
    use super::{
        chapel_alms_dispatch_amount, chapel_alms_dispatch_interval_seconds,
        chapel_monthly_gold_lot, chapel_monthly_tithe_due, chapel_poor_relief_due,
        chapel_priest_salary_lot, chapel_upkeep_lot, chapel_workday_seconds,
    };
    use crate::balance_generated::{
        CALENDAR_DAYS_PER_MONTH, CALENDAR_SECONDS_PER_DAY, CHAPEL_CHARITY_GOLD_PER_DAY,
        CHAPEL_POOR_RELIEF_INTERVAL_DAYS, CHAPEL_PRIEST_SALARY_GOLD_PER_DAY,
        CHAPEL_UNSTAFFED_UPKEEP_FRACTION, CHAPEL_UPKEEP_GOLD_PER_DAY, TICK_DT,
    };

    #[test]
    fn monthly_expenses_are_posted_as_whole_coin_lots() {
        assert!((chapel_workday_seconds() - 70.0).abs() < 1e-9);
        assert_eq!(
            chapel_priest_salary_lot(1),
            (CHAPEL_PRIEST_SALARY_GOLD_PER_DAY * CALENDAR_DAYS_PER_MONTH as f64).round()
        );
        assert_eq!(
            chapel_upkeep_lot(1),
            (CHAPEL_UPKEEP_GOLD_PER_DAY * CALENDAR_DAYS_PER_MONTH as f64).round()
        );
        assert_eq!(
            chapel_upkeep_lot(0),
            (CHAPEL_UPKEEP_GOLD_PER_DAY
                * CHAPEL_UNSTAFFED_UPKEEP_FRACTION
                * CALENDAR_DAYS_PER_MONTH as f64)
                .round()
        );
        assert_eq!(chapel_monthly_gold_lot(0.01), 0.0);
    }

    #[test]
    fn physical_alms_accrue_until_one_whole_coin_can_leave() {
        assert_eq!(chapel_alms_dispatch_amount(), 1.0);
        let realized_daily_rate = chapel_alms_dispatch_amount() * chapel_workday_seconds()
            / chapel_alms_dispatch_interval_seconds();
        assert!((realized_daily_rate - CHAPEL_CHARITY_GOLD_PER_DAY).abs() < 1e-9);
    }

    #[test]
    fn poor_relief_leaves_on_monday_morning_every_seven_days() {
        let day_ticks = (CALENDAR_SECONDS_PER_DAY / TICK_DT).round() as u64;
        assert!(!chapel_poor_relief_due(0));
        assert!(chapel_poor_relief_due(day_ticks));
        assert!(!chapel_poor_relief_due(day_ticks * 2));
        assert!(chapel_poor_relief_due(
            day_ticks * (CHAPEL_POOR_RELIEF_INTERVAL_DAYS + 1),
        ));
    }

    #[test]
    fn monthly_tithe_never_posts_on_sunday() {
        let day_ticks = (CALENDAR_SECONDS_PER_DAY / TICK_DT).round() as u64;
        let first_work_tick = |day: u64| day * day_ticks - day_ticks / 3 + day_ticks / 4;
        let charges = (1..=30)
            .map(first_work_tick)
            .map(crate::simulation::game_clock)
            .filter(|clock| chapel_monthly_tithe_due(6, clock))
            .collect::<Vec<_>>();
        assert_eq!(charges.len(), 1);
        assert!(!charges[0].is_sunday);
    }
}
