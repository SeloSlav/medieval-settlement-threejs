pub const WOODCUTTER_TIMBER_RESERVE_MIN: f64 = 0.0;
pub const WOODCUTTER_TIMBER_RESERVE_MAX: f64 = 240.0;

pub fn normalize_woodcutter_timber_reserve(reserve: f64) -> f64 {
    if !reserve.is_finite() {
        return WOODCUTTER_TIMBER_RESERVE_MIN;
    }
    reserve
        .round()
        .clamp(WOODCUTTER_TIMBER_RESERVE_MIN, WOODCUTTER_TIMBER_RESERVE_MAX)
}

#[cfg(test)]
mod tests {
    use super::{normalize_woodcutter_timber_reserve, WOODCUTTER_TIMBER_RESERVE_MAX};

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
