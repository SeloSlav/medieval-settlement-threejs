use crate::balance_generated::{
    CALENDAR_HOURS_PER_DAY, CALENDAR_SECONDS_PER_DAY, CALENDAR_WORK_END_HOUR,
    CALENDAR_WORK_START_HOUR, EVENING_MEAL_PER_PERSON, RESIDENCE_FOOD_PER_PERSON_PER_SEC,
};

/// One ordinary household day includes daytime pantry draw plus the evening
/// meal consumed by the night cycle. Keeping the sum here prevents planning,
/// reserves, growth, and simulation from silently using different definitions.
pub fn household_food_per_day(population: u32) -> f64 {
    let workday_seconds = CALENDAR_SECONDS_PER_DAY
        * CALENDAR_WORK_END_HOUR.saturating_sub(CALENDAR_WORK_START_HOUR) as f64
        / CALENDAR_HOURS_PER_DAY.max(1) as f64;
    population.max(1) as f64
        * (RESIDENCE_FOOD_PER_PERSON_PER_SEC * workday_seconds + EVENING_MEAL_PER_PERSON)
}

#[cfg(test)]
mod tests {
    use super::household_food_per_day;

    #[test]
    fn canonical_day_includes_daytime_and_evening_meals() {
        assert!((household_food_per_day(1) - 1.13).abs() <= 1e-9);
        assert!((household_food_per_day(6) - 6.78).abs() <= 1e-9);
        assert_eq!(household_food_per_day(0), household_food_per_day(1));
    }
}
