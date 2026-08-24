//! Demand-driven household fuel reserves and industrial charcoal hysteresis.

use crate::balance_generated::{
    CALENDAR_DAYS_PER_MONTH, CHARCOAL_HOUSEHOLD_FUEL_VALUE, MARKETPLACE_FUEL_RESERVE_DAYS,
    RESIDENCE_FIREWOOD_UNITS_PER_MONTH, SMITHY_CHARCOAL_PER_CYCLE, SMITHY_CHARCOAL_REORDER_CYCLES,
    SMITHY_CHARCOAL_TARGET_CYCLES,
};
use crate::resource_units::{whole_cost, whole_units};

pub fn combined_fuel_equivalent(firewood: f64, charcoal: f64) -> f64 {
    whole_units(firewood) + whole_units(charcoal) * whole_units(CHARCOAL_HOUSEHOLD_FUEL_VALUE)
}

/// Average daily demand for a known number of households. Actual residences
/// pay one whole monthly bill; this fractional rate exists only for runway and
/// reserve planning.
pub fn household_fuel_demand_for_households_per_day(
    household_count: u32,
    seasonal_multiplier: f64,
) -> f64 {
    f64::from(household_count) * whole_units(RESIDENCE_FIREWOOD_UNITS_PER_MONTH)
        / f64::from(CALENDAR_DAYS_PER_MONTH.max(1))
        * seasonal_multiplier.max(0.0)
}

pub fn marketplace_fuel_reserve_target_for_households(
    covered_households: u32,
    seasonal_multiplier: f64,
    firewood_capacity: f64,
    charcoal_capacity: f64,
) -> f64 {
    let demand_target = whole_cost(
        household_fuel_demand_for_households_per_day(covered_households, seasonal_multiplier)
            * MARKETPLACE_FUEL_RESERVE_DAYS,
    );
    let physical_capacity = combined_fuel_equivalent(firewood_capacity, charcoal_capacity);
    demand_target.min(physical_capacity).max(0.0)
}

pub fn fuel_runway_days(fuel_equivalent: f64, daily_demand: f64) -> f64 {
    if daily_demand <= 1e-9 {
        f64::INFINITY
    } else {
        fuel_equivalent.max(0.0) / daily_demand
    }
}

/// Smithies request a full six-cycle batch only after falling below three
/// complete charcoal cycles. This avoids one-cycle cart chatter while keeping
/// a useful production buffer ahead of household reserve hauling.
pub fn smithy_charcoal_refill_target(stock: f64) -> Option<f64> {
    let reorder = whole_cost(SMITHY_CHARCOAL_PER_CYCLE * SMITHY_CHARCOAL_REORDER_CYCLES);
    let target = whole_cost(SMITHY_CHARCOAL_PER_CYCLE * SMITHY_CHARCOAL_TARGET_CYCLES);
    (whole_units(stock) < reorder).then_some(target)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn market_reserve_scales_with_households_and_season_in_whole_units() {
        let fair = marketplace_fuel_reserve_target_for_households(10, 1.0, 80.0, 80.0);
        let winter = marketplace_fuel_reserve_target_for_households(10, 2.0, 80.0, 80.0);
        assert_eq!(fair, 7.0);
        assert_eq!(winter, 14.0);
        assert_eq!(
            marketplace_fuel_reserve_target_for_households(0, 2.0, 80.0, 80.0),
            0.0
        );
        assert_eq!(
            marketplace_fuel_reserve_target_for_households(100, 2.0, 80.0, 80.0),
            140.0
        );
    }

    #[test]
    fn charcoal_counts_twice_and_smithies_refill_three_to_six() {
        assert_eq!(combined_fuel_equivalent(20.0, 15.0), 50.0);
        assert_eq!(smithy_charcoal_refill_target(2.9), Some(6.0));
        assert_eq!(smithy_charcoal_refill_target(3.0), None);
    }
}
