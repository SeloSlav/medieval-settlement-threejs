pub const GRANARY_GRAIN_RESERVE_MIN: f64 = 0.0;
pub const GRANARY_GRAIN_RESERVE_MAX: f64 = 420.0;
pub const GRANARY_FRESH_FOOD_TARGET_DEFAULT_PERCENT: u8 = 75;
pub const GRANARY_FRESH_FOOD_TARGET_PERCENTS: [u8; 4] = [25, 50, 75, 90];

pub fn is_valid_granary_fresh_food_target_percent(percent: u8) -> bool {
    GRANARY_FRESH_FOOD_TARGET_PERCENTS.contains(&percent)
}

/// Invalid legacy or externally-authored values fall back to the former fixed
/// 75% target, preserving the pre-policy intake behavior.
pub fn normalize_granary_fresh_food_target_percent(percent: u8) -> u8 {
    if is_valid_granary_fresh_food_target_percent(percent) {
        percent
    } else {
        GRANARY_FRESH_FOOD_TARGET_DEFAULT_PERCENT
    }
}

pub fn granary_fresh_food_target(capacity: f64, percent: u8) -> f64 {
    if !capacity.is_finite() {
        return 0.0;
    }
    capacity.max(0.0) * normalize_granary_fresh_food_target_percent(percent) as f64 / 100.0
}

pub fn normalize_granary_grain_reserve(reserve: f64) -> f64 {
    if !reserve.is_finite() {
        return GRANARY_GRAIN_RESERVE_MIN;
    }
    reserve
        .round()
        .clamp(GRANARY_GRAIN_RESERVE_MIN, GRANARY_GRAIN_RESERVE_MAX)
}

/// Grain available to ordinary processors and foreign trade after the
/// granary's strategic floor is protected. Farmstead seed requests deliberately
/// bypass this helper so the reserve can still fulfil its primary purpose.
pub fn granary_exportable_grain(stock: f64, reserve: f64) -> f64 {
    if !stock.is_finite() {
        return 0.0;
    }
    (stock.max(0.0) - normalize_granary_grain_reserve(reserve)).max(0.0)
}

#[cfg(test)]
mod tests {
    use super::{
        granary_exportable_grain, granary_fresh_food_target,
        is_valid_granary_fresh_food_target_percent, normalize_granary_fresh_food_target_percent,
        normalize_granary_grain_reserve, GRANARY_FRESH_FOOD_TARGET_DEFAULT_PERCENT,
        GRANARY_GRAIN_RESERVE_MAX,
    };

    #[test]
    fn legacy_granary_food_target_preserves_the_fixed_seventy_five_percent_behavior() {
        assert_eq!(GRANARY_FRESH_FOOD_TARGET_DEFAULT_PERCENT, 75);
        assert_eq!(granary_fresh_food_target(340.0, 75), 255.0);
    }

    #[test]
    fn granary_food_target_accepts_only_readable_policy_steps() {
        for percent in [25, 50, 75, 90] {
            assert!(is_valid_granary_fresh_food_target_percent(percent));
            assert_eq!(
                normalize_granary_fresh_food_target_percent(percent),
                percent
            );
        }
        assert!(!is_valid_granary_fresh_food_target_percent(0));
        assert!(!is_valid_granary_fresh_food_target_percent(100));
        assert_eq!(
            normalize_granary_fresh_food_target_percent(99),
            GRANARY_FRESH_FOOD_TARGET_DEFAULT_PERCENT
        );
    }

    #[test]
    fn granary_food_target_is_bounded_by_capacity_and_rejects_invalid_capacity() {
        assert_eq!(granary_fresh_food_target(340.0, 25), 85.0);
        assert_eq!(granary_fresh_food_target(340.0, 90), 306.0);
        assert_eq!(granary_fresh_food_target(-10.0, 75), 0.0);
        assert_eq!(granary_fresh_food_target(f64::NAN, 75), 0.0);
    }

    #[test]
    fn legacy_zero_reserve_preserves_grain_release() {
        assert_eq!(granary_exportable_grain(90.0, 0.0), 90.0);
    }

    #[test]
    fn ordinary_consumers_leave_the_configured_floor() {
        assert_eq!(granary_exportable_grain(150.0, 120.0), 30.0);
        assert_eq!(granary_exportable_grain(90.0, 120.0), 0.0);
    }

    #[test]
    fn reserve_is_rounded_and_bounded_to_granary_capacity() {
        assert_eq!(normalize_granary_grain_reserve(-10.0), 0.0);
        assert_eq!(normalize_granary_grain_reserve(119.6), 120.0);
        assert_eq!(
            normalize_granary_grain_reserve(10_000.0),
            GRANARY_GRAIN_RESERVE_MAX
        );
    }
}
