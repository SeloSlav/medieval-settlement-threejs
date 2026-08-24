use crate::balance_generated::{CALENDAR_DAYS_PER_MONTH, RESIDENCE_FOOD_UNITS_PER_SLOT_PER_MONTH};
use crate::resource_units::whole_units;

/// Number of distinct monthly food obligations attached to each residence
/// tier. Population does not alter the household bill.
pub fn residence_food_requirement_slots(tier: u8) -> u32 {
    match tier {
        0 => 0,
        1 => 1,
        2 => 2,
        3 => 4,
        _ => 5,
    }
}

/// Whole food units charged to one household each month.
pub fn household_food_units_per_month(food_requirement_slots: u32) -> f64 {
    f64::from(food_requirement_slots) * whole_units(RESIDENCE_FOOD_UNITS_PER_SLOT_PER_MONTH)
}

/// Average daily runway demand derived from the discrete monthly bill. This
/// rate may be fractional because it is a forecast; persisted food and the
/// bill paid at month-end remain whole units.
pub fn household_food_units_per_day(food_requirement_slots: u32) -> f64 {
    household_food_units_per_month(food_requirement_slots)
        / f64::from(CALENDAR_DAYS_PER_MONTH.max(1))
}

pub fn household_food_units_per_day_for_tier(tier: u8) -> f64 {
    household_food_units_per_day(residence_food_requirement_slots(tier))
}

#[cfg(test)]
mod tests {
    use super::{
        household_food_units_per_day_for_tier, household_food_units_per_month,
        residence_food_requirement_slots,
    };

    #[test]
    fn tiers_pay_one_whole_unit_per_month_for_each_food_slot() {
        assert_eq!(residence_food_requirement_slots(0), 0);
        assert_eq!(residence_food_requirement_slots(1), 1);
        assert_eq!(residence_food_requirement_slots(2), 2);
        assert_eq!(residence_food_requirement_slots(3), 4);
        assert_eq!(residence_food_requirement_slots(4), 5);
        assert_eq!(household_food_units_per_month(0), 0.0);
        assert_eq!(household_food_units_per_month(1), 1.0);
        assert_eq!(household_food_units_per_month(5), 5.0);
    }

    #[test]
    fn daily_runway_is_derived_from_the_monthly_household_bill() {
        assert!((household_food_units_per_day_for_tier(1) - 1.0 / 30.0).abs() <= 1e-9);
        assert!((household_food_units_per_day_for_tier(4) - 5.0 / 30.0).abs() <= 1e-9);
    }
}
