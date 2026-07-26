pub const WOODCUTTER_TIMBER_RESERVE_MIN: f64 = 0.0;
pub const WOODCUTTER_TIMBER_RESERVE_MAX: f64 = 240.0;

const STOCK_EPSILON: f64 = 1e-6;

pub fn normalize_woodcutter_timber_reserve(reserve: f64) -> f64 {
    if !reserve.is_finite() {
        return WOODCUTTER_TIMBER_RESERVE_MIN;
    }
    reserve
        .round()
        .clamp(WOODCUTTER_TIMBER_RESERVE_MIN, WOODCUTTER_TIMBER_RESERVE_MAX)
}

pub fn woodcutter_can_process(
    available_unreserved_timber: f64,
    timber_reserve: f64,
    timber_needed: f64,
) -> bool {
    if !available_unreserved_timber.is_finite() || !timber_needed.is_finite() {
        return false;
    }
    let reserve = normalize_woodcutter_timber_reserve(timber_reserve);
    available_unreserved_timber + STOCK_EPSILON >= reserve + timber_needed.max(0.0)
}

#[cfg(test)]
mod tests {
    use super::{
        normalize_woodcutter_timber_reserve, woodcutter_can_process, WOODCUTTER_TIMBER_RESERVE_MAX,
    };

    #[test]
    fn legacy_zero_reserve_preserves_processing_behavior() {
        assert!(woodcutter_can_process(3.0, 0.0, 3.0));
        assert!(!woodcutter_can_process(2.99, 0.0, 3.0));
    }

    #[test]
    fn processing_leaves_the_configured_floor_intact() {
        assert!(woodcutter_can_process(43.0, 40.0, 3.0));
        assert!(!woodcutter_can_process(42.99, 40.0, 3.0));
    }

    #[test]
    fn reserve_is_rounded_and_bounded() {
        assert_eq!(normalize_woodcutter_timber_reserve(-10.0), 0.0);
        assert_eq!(normalize_woodcutter_timber_reserve(39.6), 40.0);
        assert_eq!(
            normalize_woodcutter_timber_reserve(10_000.0),
            WOODCUTTER_TIMBER_RESERVE_MAX
        );
    }
}
