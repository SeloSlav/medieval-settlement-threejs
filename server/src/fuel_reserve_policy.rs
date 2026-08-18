//! Demand-driven household fuel reserves and industrial charcoal hysteresis.

use crate::balance_generated::{
    CALENDAR_SECONDS_PER_DAY, CHARCOAL_HOUSEHOLD_FUEL_VALUE, MARKETPLACE_FUEL_RESERVE_DAYS,
    RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC, SMITHY_CHARCOAL_PER_CYCLE,
    SMITHY_CHARCOAL_REORDER_CYCLES, SMITHY_CHARCOAL_TARGET_CYCLES,
};

pub fn combined_fuel_equivalent(firewood: f64, charcoal: f64) -> f64 {
    firewood.max(0.0) + charcoal.max(0.0) * CHARCOAL_HOUSEHOLD_FUEL_VALUE
}

pub fn household_fuel_demand_per_day(population: u32, seasonal_multiplier: f64) -> f64 {
    f64::from(population)
        * RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC
        * CALENDAR_SECONDS_PER_DAY
        * seasonal_multiplier.max(0.0)
}

pub fn marketplace_fuel_reserve_target(
    covered_population: u32,
    seasonal_multiplier: f64,
    firewood_capacity: f64,
    charcoal_capacity: f64,
) -> f64 {
    let demand_target = household_fuel_demand_per_day(covered_population, seasonal_multiplier)
        * MARKETPLACE_FUEL_RESERVE_DAYS;
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
    let reorder = SMITHY_CHARCOAL_PER_CYCLE * SMITHY_CHARCOAL_REORDER_CYCLES;
    let target = SMITHY_CHARCOAL_PER_CYCLE * SMITHY_CHARCOAL_TARGET_CYCLES;
    (stock.max(0.0) + 1e-9 < reorder).then_some(target)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn market_reserve_scales_with_people_and_season() {
        let fair = marketplace_fuel_reserve_target(10, 1.0, 80.0, 80.0);
        let winter = marketplace_fuel_reserve_target(10, 2.0, 80.0, 80.0);
        assert!((fair - 70.0).abs() < 1e-6);
        assert!((winter - 140.0).abs() < 1e-6);
        assert_eq!(marketplace_fuel_reserve_target(0, 2.0, 80.0, 80.0), 0.0);
        assert_eq!(marketplace_fuel_reserve_target(100, 2.0, 80.0, 80.0), 240.0);
    }

    #[test]
    fn charcoal_counts_twice_and_smithies_refill_three_to_six() {
        assert_eq!(combined_fuel_equivalent(20.0, 15.0), 50.0);
        assert_eq!(smithy_charcoal_refill_target(2.9), Some(6.0));
        assert_eq!(smithy_charcoal_refill_target(3.0), None);
    }
}
