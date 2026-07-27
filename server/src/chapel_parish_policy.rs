use crate::balance_generated::{
    CALENDAR_HOURS_PER_DAY, CALENDAR_SECONDS_PER_DAY, CALENDAR_WORK_END_HOUR,
    CALENDAR_WORK_START_HOUR, CHAPEL_AUTO_SWEEP_INTERVAL_TICKS, CHAPEL_POOR_RELIEF_INTERVAL_DAYS,
    TICK_DT,
};

/// Configured "per day" parish rates accrue only while the parish office is
/// active, so normalize them over the same 06:00-20:00 work window.
pub fn chapel_workday_seconds() -> f64 {
    let work_hours = CALENDAR_WORK_END_HOUR.saturating_sub(CALENDAR_WORK_START_HOUR);
    CALENDAR_SECONDS_PER_DAY * work_hours as f64 / CALENDAR_HOURS_PER_DAY.max(1) as f64
}

pub fn chapel_daily_gold_per_work_tick(daily_rate: f64) -> f64 {
    daily_rate * TICK_DT / chapel_workday_seconds()
}

/// Auto-sweep is an accounting transfer rather than a cart journey. It follows
/// its configured global cadence even when an interval lands outside work hours.
pub fn chapel_auto_sweep_due(sim_tick: u64) -> bool {
    CHAPEL_AUTO_SWEEP_INTERVAL_TICKS > 0 && sim_tick % CHAPEL_AUTO_SWEEP_INTERVAL_TICKS == 0
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
        chapel_auto_sweep_due, chapel_daily_gold_per_work_tick, chapel_poor_relief_due,
        chapel_workday_seconds,
    };
    use crate::balance_generated::{
        CALENDAR_SECONDS_PER_DAY, CHAPEL_AUTO_SWEEP_INTERVAL_TICKS,
        CHAPEL_POOR_RELIEF_INTERVAL_DAYS, TICK_DT,
    };

    #[test]
    fn daily_gold_rates_are_normalized_over_the_workday() {
        assert!((chapel_workday_seconds() - 70.0).abs() < 1e-9);
        let daily_rate = 1.75;
        let work_ticks = chapel_workday_seconds() / TICK_DT;
        assert!(
            (chapel_daily_gold_per_work_tick(daily_rate) * work_ticks - daily_rate).abs() < 1e-9
        );
    }

    #[test]
    fn auto_sweep_keeps_its_global_cadence_outside_work_hours() {
        assert!(chapel_auto_sweep_due(0));
        assert!(!chapel_auto_sweep_due(CHAPEL_AUTO_SWEEP_INTERVAL_TICKS - 1));
        assert!(chapel_auto_sweep_due(CHAPEL_AUTO_SWEEP_INTERVAL_TICKS));
        assert!(chapel_auto_sweep_due(CHAPEL_AUTO_SWEEP_INTERVAL_TICKS * 2));
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
}
