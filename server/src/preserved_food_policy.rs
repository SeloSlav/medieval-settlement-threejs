#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct PreservedMealAllocation {
    pub fresh_used: f64,
    pub preserved_rotation_used: f64,
    pub preserved_fallback_used: f64,
    pub unmet: f64,
}

impl PreservedMealAllocation {
    pub fn preserved_used(self) -> f64 {
        self.preserved_rotation_used + self.preserved_fallback_used
    }
}

/// Allocates one household meal without inventing a second calorie demand.
///
/// Prosperous households rotate a bounded amount of cured provisions into the
/// meal first. Fresh food covers the rest, and any remaining gap draws on the
/// same preserved stock as an emergency fallback. Lower-tier households pass
/// `rotation_enabled = false` and retain the ordinary fresh-food path.
pub fn allocate_preserved_meal(
    fresh_stock: f64,
    preserved_stock: f64,
    meal_demand: f64,
    rotation_demand: f64,
    rotation_enabled: bool,
) -> PreservedMealAllocation {
    let fresh_stock = finite_nonnegative(fresh_stock);
    let preserved_stock = finite_nonnegative(preserved_stock);
    let meal_demand = finite_nonnegative(meal_demand);
    let rotation_demand = finite_nonnegative(rotation_demand);

    let preserved_rotation_used = if rotation_enabled {
        preserved_stock.min(rotation_demand).min(meal_demand)
    } else {
        0.0
    };
    let after_rotation = (meal_demand - preserved_rotation_used).max(0.0);
    let fresh_used = fresh_stock.min(after_rotation);
    let after_fresh = (after_rotation - fresh_used).max(0.0);
    let preserved_fallback_used = (preserved_stock - preserved_rotation_used)
        .max(0.0)
        .min(after_fresh);
    let unmet = (after_fresh - preserved_fallback_used).max(0.0);

    PreservedMealAllocation {
        fresh_used,
        preserved_rotation_used,
        preserved_fallback_used,
        unmet,
    }
}

fn finite_nonnegative(value: f64) -> f64 {
    if value.is_finite() {
        value.max(0.0)
    } else {
        0.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    const EPSILON: f64 = 1e-9;

    #[test]
    fn lower_tiers_keep_the_full_fresh_meal() {
        let plan = allocate_preserved_meal(10.0, 10.0, 3.0, 1.0, false);
        assert_close(plan.fresh_used, 3.0);
        assert_close(plan.preserved_used(), 0.0);
        assert_close(plan.unmet, 0.0);
    }

    #[test]
    fn rotation_replaces_fresh_food_instead_of_adding_a_second_meal() {
        let plan = allocate_preserved_meal(10.0, 10.0, 3.0, 0.8, true);
        assert_close(plan.preserved_rotation_used, 0.8);
        assert_close(plan.fresh_used, 2.2);
        assert_close(plan.preserved_fallback_used, 0.0);
        assert_close(plan.unmet, 0.0);
        assert_close(plan.fresh_used + plan.preserved_used(), 3.0);
    }

    #[test]
    fn preserved_stock_covers_the_whole_meal_when_fresh_food_fails() {
        let plan = allocate_preserved_meal(0.0, 5.0, 3.0, 0.8, true);
        assert_close(plan.preserved_rotation_used, 0.8);
        assert_close(plan.preserved_fallback_used, 2.2);
        assert_close(plan.fresh_used, 0.0);
        assert_close(plan.unmet, 0.0);
    }

    #[test]
    fn partial_stores_are_consumed_before_hunger_is_recorded() {
        let plan = allocate_preserved_meal(1.0, 0.5, 3.0, 0.8, true);
        assert_close(plan.fresh_used, 1.0);
        assert_close(plan.preserved_rotation_used, 0.5);
        assert_close(plan.preserved_fallback_used, 0.0);
        assert_close(plan.unmet, 1.5);
    }

    #[test]
    fn malformed_inputs_cannot_create_food() {
        let plan = allocate_preserved_meal(f64::NAN, f64::INFINITY, -4.0, 1.0, true);
        assert_eq!(plan, PreservedMealAllocation::default());
    }

    #[test]
    fn meal_allocation_stays_cheap_at_settlement_scale() {
        let started = Instant::now();
        let mut checksum = 0.0;
        for index in 0..1_000_000 {
            let plan =
                allocate_preserved_meal((index % 9) as f64, (index % 5) as f64, 3.0, 0.8, true);
            checksum += plan.fresh_used + plan.preserved_used() + plan.unmet;
        }
        let elapsed = started.elapsed();
        assert_close(checksum, 3_000_000.0);
        assert!(
            elapsed.as_millis() < 250,
            "one million meal allocations regressed: {elapsed:?}"
        );
    }

    fn assert_close(actual: f64, expected: f64) {
        assert!(
            (actual - expected).abs() <= EPSILON,
            "expected {actual} to equal {expected}"
        );
    }
}
