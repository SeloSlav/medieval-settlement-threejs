use crate::balance_generated::{
    CALENDAR_DAYS_PER_MONTH, CALENDAR_DAYS_PER_WEEK, CALENDAR_DAY_START_OFFSET_SECONDS,
    CALENDAR_HOURS_PER_DAY, CALENDAR_MONTHS_PER_YEAR, CALENDAR_SECONDS_PER_DAY,
    CALENDAR_SUNDAY_WEEKDAY, CALENDAR_WORK_END_HOUR, CALENDAR_WORK_START_HOUR, TICK_DT,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct GameClock {
    pub sim_tick: u64,
    pub total_days: u64,
    pub hour: u32,
    pub minute: u32,
    pub weekday: u32,
    pub month_day: u32,
    pub month: u32,
    pub year: u32,
    pub is_sunday: bool,
    pub is_work_hours: bool,
}

pub fn sim_elapsed_seconds(sim_tick: u64) -> f64 {
    sim_tick as f64 * TICK_DT
}

pub fn game_clock(sim_tick: u64) -> GameClock {
    let elapsed = sim_elapsed_seconds(sim_tick);
    let calendar_elapsed = elapsed + CALENDAR_DAY_START_OFFSET_SECONDS;
    let total_days = (calendar_elapsed / CALENDAR_SECONDS_PER_DAY).floor() as u64;
    let seconds_into_day = calendar_elapsed % CALENDAR_SECONDS_PER_DAY;
    let hour = (seconds_into_day / 3600.0).floor() as u32;
    let minute = ((seconds_into_day % 3600.0) / 60.0).floor() as u32;
    let weekday = (total_days % CALENDAR_DAYS_PER_WEEK as u64) as u32;
    let days_per_year = CALENDAR_DAYS_PER_MONTH as u64 * CALENDAR_MONTHS_PER_YEAR as u64;
    let day_of_year = total_days % days_per_year;
    let month = (day_of_year / CALENDAR_DAYS_PER_MONTH as u64) as u32 + 1;
    let month_day = (day_of_year % CALENDAR_DAYS_PER_MONTH as u64) as u32 + 1;
    let year = (total_days / days_per_year) as u32 + 1;
    let is_sunday = weekday == CALENDAR_SUNDAY_WEEKDAY;
    let is_work_hours = hour >= CALENDAR_WORK_START_HOUR && hour < CALENDAR_WORK_END_HOUR;

    GameClock {
        sim_tick,
        total_days,
        hour: hour.min(CALENDAR_HOURS_PER_DAY.saturating_sub(1)),
        minute: minute.min(59),
        weekday,
        month_day,
        month,
        year,
        is_sunday,
        is_work_hours,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::balance_generated::CALENDAR_DAY_START_HOUR;

    #[test]
    fn new_game_starts_at_day_start_hour() {
        let clock = game_clock(0);
        assert_eq!(clock.hour, CALENDAR_DAY_START_HOUR);
        assert_eq!(clock.minute, 0);
    }

    #[test]
    fn rational_calendar_months_are_thirty_days() {
        let day_ticks = (CALENDAR_SECONDS_PER_DAY / TICK_DT) as u64;
        let clock = game_clock(day_ticks * 30);
        assert_eq!(clock.month_day, 1);
        assert_eq!(clock.month, 2);
        assert_eq!(clock.year, 1);
    }

    #[test]
    fn sunday_is_weekday_zero() {
        let day_ticks = (CALENDAR_SECONDS_PER_DAY / TICK_DT) as u64;
        assert!(game_clock(0).is_sunday);
        assert!(!game_clock(day_ticks).is_sunday);
    }
}
