//! Player-selected production pace for ironwork-maintained civilian worksites.
//!
//! Fifty percent preserves the existing simulation pace. Zero pauses new
//! production and one hundred runs at twice the normal rate. Maintenance is
//! deliberately superlinear: yearly ironwork demand follows the square of
//! production pace. Tool wear remains tied to completed work, so stalled,
//! empty, or full sites are not charged.

use crate::civilian_tool_policy::is_civilian_tool_site;

pub const DEFAULT_PRODUCTION_RATE_PERCENT: u8 = 50;
pub const MAX_PRODUCTION_RATE_PERCENT: u8 = 100;

pub fn is_production_rate_kind(kind: &str) -> bool {
    is_civilian_tool_site(kind)
}

pub fn is_valid_production_rate_percent(percent: u8) -> bool {
    percent <= MAX_PRODUCTION_RATE_PERCENT
}

pub fn normalize_production_rate_percent(percent: u8) -> u8 {
    percent.min(MAX_PRODUCTION_RATE_PERCENT)
}

pub fn production_rate_multiplier(percent: u8) -> f64 {
    normalize_production_rate_percent(percent) as f64
        / DEFAULT_PRODUCTION_RATE_PERCENT as f64
}

/// The yearly maintenance curve. A site at twice normal pace has four times
/// normal yearly wear; half pace has one quarter. Since completed cycles per
/// year already scale with pace, each completed cycle is charged one further
/// production-rate multiplier by `maintenance_wear_per_completed_work`.
pub fn maintenance_rate_multiplier(percent: u8) -> f64 {
    production_rate_multiplier(percent).powi(2)
}

pub fn maintenance_wear_per_completed_work(base_wear: f64, percent: u8) -> f64 {
    if !base_wear.is_finite() || base_wear <= 0.0 {
        return 0.0;
    }
    let pace = production_rate_multiplier(percent);
    if pace <= f64::EPSILON {
        0.0
    } else {
        // Annual wear is pace²; dividing by the pace-scaled number of cycles
        // yields the additional wear charged to each completed cycle.
        base_wear * maintenance_rate_multiplier(percent) / pace
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fifty_percent_preserves_normal_production() {
        assert_eq!(production_rate_multiplier(0), 0.0);
        assert_eq!(production_rate_multiplier(50), 1.0);
        assert_eq!(production_rate_multiplier(100), 2.0);
        assert_eq!(production_rate_multiplier(255), 2.0);
    }

    #[test]
    fn yearly_maintenance_uses_a_superlinear_square_curve() {
        assert_eq!(maintenance_rate_multiplier(0), 0.0);
        assert_eq!(maintenance_rate_multiplier(25), 0.25);
        assert_eq!(maintenance_rate_multiplier(50), 1.0);
        assert_eq!(maintenance_rate_multiplier(75), 2.25);
        assert_eq!(maintenance_rate_multiplier(100), 4.0);
        assert_eq!(maintenance_wear_per_completed_work(1.0, 25), 0.5);
        assert_eq!(maintenance_wear_per_completed_work(1.0, 100), 2.0);
    }

    #[test]
    fn only_ironwork_maintained_production_sites_are_adjustable() {
        for kind in [
            "lumber_mill",
            "woodcutters_lodge",
            "stone_quarry",
            "large_quarry",
            "mine",
            "clay_pit",
            "threshing_barn",
            "watermill",
            "windmill",
        ] {
            assert!(is_production_rate_kind(kind), "{kind}");
        }
        for kind in ["town_hall", "granary", "bakery", "smithy"] {
            assert!(!is_production_rate_kind(kind), "{kind}");
        }
    }
}
