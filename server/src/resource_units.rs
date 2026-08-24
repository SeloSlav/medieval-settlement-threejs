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

/// Returns the whole-unit lot due for one period of a fractional authored
/// rate. The cumulative-floor schedule conserves the configured rate over
/// time without ever creating a fractional inventory mutation. `schedule_key`
/// staggers otherwise identical entities so they do not all consume together.
pub fn periodic_whole_units(units_per_period: f64, schedule_key: u64, period_index: u64) -> f64 {
    if !units_per_period.is_finite() || units_per_period <= 0.0 {
        return 0.0;
    }
    let offset = fractional_schedule_offset(schedule_key);
    let current = (units_per_period * period_index as f64 + offset).floor();
    let next = (units_per_period * period_index.saturating_add(1) as f64 + offset).floor();
    whole_units((next - current).max(0.0))
}

/// Quantizes a one-off expected yield into a deterministic whole lot. This is
/// useful when a production cycle is tracked elsewhere: sub-unit yields become
/// occasional full units instead of disappearing or leaking decimal stock.
pub fn deterministic_whole_lot(expected_units: f64, schedule_key: u64, event_index: u64) -> f64 {
    if !expected_units.is_finite() || expected_units <= 0.0 {
        return 0.0;
    }
    let base = expected_units.floor();
    let remainder = expected_units - base;
    if remainder <= WHOLE_UNIT_EPSILON {
        return base;
    }
    let roll = fractional_schedule_offset(schedule_key ^ event_index.rotate_left(23));
    base + if roll + 1e-12 < remainder { 1.0 } else { 0.0 }
}

fn fractional_schedule_offset(key: u64) -> f64 {
    // SplitMix64 gives every entity a stable, well-distributed phase without
    // storing a fractional accumulator row for each resource.
    let mut value = key.wrapping_add(0x9E37_79B9_7F4A_7C15);
    value = (value ^ (value >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    value = (value ^ (value >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    value ^= value >> 31;
    (value >> 11) as f64 / ((1u64 << 53) as f64)
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
        deterministic_whole_lot, is_whole_units, periodic_whole_units, whole_cost, whole_room,
        whole_signed_units, whole_transfer, whole_units,
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

    #[test]
    fn periodic_schedule_conserves_fractional_rates_with_whole_lots() {
        let lots = (0..20)
            .map(|period| periodic_whole_units(0.5, 7, period))
            .collect::<Vec<_>>();
        assert!(lots.iter().all(|amount| amount.fract() == 0.0));
        assert_eq!(lots.iter().sum::<f64>(), 10.0);

        let mixed = (0..10)
            .map(|period| periodic_whole_units(1.2, 11, period))
            .collect::<Vec<_>>();
        assert!(mixed.iter().all(|amount| amount.fract() == 0.0));
        assert_eq!(mixed.iter().sum::<f64>(), 12.0);
    }

    #[test]
    fn deterministic_lots_never_return_fractional_yields() {
        for event in 0..100 {
            let lot = deterministic_whole_lot(0.45, 19, event);
            assert!(matches!(lot, 0.0 | 1.0));
        }
        assert_eq!(deterministic_whole_lot(3.0, 19, 1), 3.0);
    }
}
