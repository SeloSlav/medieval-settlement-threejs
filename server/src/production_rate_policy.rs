//! Player-selected production pace for ironwork-maintained civilian worksites.
//!
//! Fifty percent preserves the existing simulation pace. Zero pauses new
//! production and one hundred runs at twice the normal rate. Tool wear remains
//! tied to completed work, so yearly maintenance demand changes with pace
//! without charging stalled, empty, or full sites.

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
