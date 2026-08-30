//! Labor-scaled Tavern household beverage service.

use crate::balance_generated::building_def;

/// Return the beverage lot a Tavern can issue to one household during a
/// market-distribution check. Every on-site innkeeper contributes an equal
/// share of the Tavern's configured labor capacity.
pub fn tavern_household_issue_lot(onsite_labor: u32, daily_lot: f64) -> f64 {
    let max_labor = building_def("tavern")
        .map(|definition| definition.max_labor)
        .unwrap_or(1)
        .max(1);
    daily_lot.max(0.0) * f64::from(onsite_labor.min(max_labor)) / f64::from(max_labor)
}

#[cfg(test)]
mod tests {
    use super::tavern_household_issue_lot;

    #[test]
    fn each_innkeeper_adds_one_third_of_tavern_household_service_pace() {
        assert_eq!(
            crate::balance_generated::building_def("tavern").map(|definition| definition.max_labor),
            Some(3),
        );
        assert!((tavern_household_issue_lot(0, 1.0) - 0.0).abs() < 1e-9);
        assert!((tavern_household_issue_lot(1, 1.0) - 1.0 / 3.0).abs() < 1e-9);
        assert!((tavern_household_issue_lot(2, 1.0) - 2.0 / 3.0).abs() < 1e-9);
        assert!((tavern_household_issue_lot(3, 1.0) - 1.0).abs() < 1e-9);
        assert!((tavern_household_issue_lot(4, 1.0) - 1.0).abs() < 1e-9);
    }
}
