//! Shared rules for indivisible economic inventory.
//!
//! Authoritative resource tables retain `f64` columns for save compatibility,
//! but every value stored in those columns represents a count of whole units.
//! Continuous work, growth, and probability may remain fractional in their
//! dedicated progress fields; inventory may not.

const WHOLE_UNIT_EPSILON: f64 = 1e-6;

/// Normalize a persisted resource count. Invalid and negative legacy values
/// become zero; tiny floating-point drift below an integer does not destroy a
/// legitimately completed unit.
pub fn whole_units(value: f64) -> f64 {
    if !value.is_finite() || value <= 0.0 {
        return 0.0;
    }
    (value + WHOLE_UNIT_EPSILON).floor()
}

/// Normalize a signed resource delta or accounting receipt while preserving
/// its direction. This is for fields such as a trade's last gold change; stock
/// itself always uses `whole_units` and remains non-negative.
pub fn whole_signed_units(value: f64) -> f64 {
    if !value.is_finite() {
        return 0.0;
    }
    if value < 0.0 {
        -whole_units(-value)
    } else {
        whole_units(value)
    }
}

/// Normalize a requested transfer or consumption amount to whole units.
pub fn whole_request(value: f64) -> f64 {
    whole_units(value)
}

/// Normalize a price or required input. A malformed fractional cost must not
/// become a free action, so positive partial units round up.
pub fn whole_cost(value: f64) -> f64 {
    if !value.is_finite() || value <= 0.0 {
        return 0.0;
    }
    (value - WHOLE_UNIT_EPSILON).ceil()
}

/// The whole-unit amount that can move between two inventories.
pub fn whole_transfer(available: f64, requested: f64) -> f64 {
    whole_units(available).min(whole_request(requested))
}

/// Whole units that fit under a capacity. Capacity definitions are also
/// treated as unit counts even though generated balance code stores them as
/// floating point values.
pub fn whole_room(capacity: f64, stock: f64) -> f64 {
    (whole_units(capacity) - whole_units(stock)).max(0.0)
}

#[cfg(test)]
pub fn is_whole_units(value: f64) -> bool {
    value.is_finite() && value >= 0.0 && (value - value.round()).abs() <= WHOLE_UNIT_EPSILON
}

#[cfg(test)]
mod tests {
    use super::{
        is_whole_units, whole_cost, whole_room, whole_signed_units, whole_transfer, whole_units,
    };

    #[test]
    fn inventories_are_non_negative_whole_units() {
        assert_eq!(whole_units(-2.0), 0.0);
        assert_eq!(whole_units(f64::NAN), 0.0);
        assert_eq!(whole_units(0.99), 0.0);
        assert_eq!(whole_units(3.75), 3.0);
        assert_eq!(whole_units(4.0 - 1e-7), 4.0);
        assert!(is_whole_units(12.0));
        assert!(!is_whole_units(12.25));
    }

    #[test]
    fn transfers_cannot_create_partial_units() {
        assert_eq!(whole_transfer(7.8, 3.9), 3.0);
        assert_eq!(whole_transfer(2.9, 9.0), 2.0);
        assert_eq!(whole_transfer(9.0, 0.9), 0.0);
        assert_eq!(whole_room(10.8, 7.2), 3.0);
        assert_eq!(whole_cost(0.25), 1.0);
        assert_eq!(whole_cost(3.0 + 1e-7), 3.0);
        assert_eq!(whole_signed_units(-3.75), -3.0);
    }
}
