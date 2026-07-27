use crate::balance_generated::{
    CALENDAR_DAY_START_OFFSET_SECONDS, CALENDAR_SECONDS_PER_DAY, TICK_DT,
};

pub const SEASONAL_LABOR_STEWARD_DEFAULT: bool = false;
pub const CONSTRUCTION_LABOR_STEWARD_DEFAULT: bool = false;
pub const PRODUCTION_LABOR_STEWARD_DEFAULT: bool = false;
pub const LABOR_STEWARD_RESERVE_DEFAULT: u32 = 0;
pub const LABOR_STEWARD_RESERVE_OPTIONS: [u32; 5] = [0, 1, 2, 4, 6];

pub fn is_valid_labor_steward_reserve(reserve: u32) -> bool {
    LABOR_STEWARD_RESERVE_OPTIONS.contains(&reserve)
}

pub fn steward_deployable_labor(available_labor: u32, reserve: u32) -> u32 {
    available_labor.saturating_sub(reserve)
}

/// Daily steward work is event-driven rather than checked against a fragile
/// tick modulus because the fictional day starts with a calendar offset.
pub fn seasonal_labor_steward_review_due(sim_tick: u64) -> bool {
    if sim_tick == 0 {
        return false;
    }
    calendar_day(sim_tick) > calendar_day(sim_tick - 1)
}

fn calendar_day(sim_tick: u64) -> u64 {
    let elapsed = sim_tick as f64 * TICK_DT + CALENDAR_DAY_START_OFFSET_SECONDS;
    (elapsed / CALENDAR_SECONDS_PER_DAY).floor().max(0.0) as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn daily_review_follows_the_offset_calendar_boundary() {
        let first_boundary = (0_u64..10_000)
            .find(|tick| seasonal_labor_steward_review_due(*tick))
            .expect("calendar should eventually cross midnight");
        assert!(first_boundary > 0);
        assert_eq!(calendar_day(first_boundary), 1);
        assert_eq!(calendar_day(first_boundary - 1), 0);

        let ticks_per_day = (CALENDAR_SECONDS_PER_DAY / TICK_DT).round() as u64;
        assert!(seasonal_labor_steward_review_due(
            first_boundary + ticks_per_day
        ));
        assert!(!seasonal_labor_steward_review_due(
            first_boundary + ticks_per_day - 1
        ));
    }

    #[test]
    fn existing_settlements_remain_manual() {
        assert!(!SEASONAL_LABOR_STEWARD_DEFAULT);
        assert!(!CONSTRUCTION_LABOR_STEWARD_DEFAULT);
        assert!(!PRODUCTION_LABOR_STEWARD_DEFAULT);
        assert_eq!(LABOR_STEWARD_RESERVE_DEFAULT, 0);
    }

    #[test]
    fn reserve_options_are_readable_and_never_create_labor() {
        assert_eq!(LABOR_STEWARD_RESERVE_OPTIONS, [0, 1, 2, 4, 6]);
        assert!(is_valid_labor_steward_reserve(4));
        assert!(!is_valid_labor_steward_reserve(3));
        assert_eq!(steward_deployable_labor(7, 2), 5);
        assert_eq!(steward_deployable_labor(1, 2), 0);
    }
}
