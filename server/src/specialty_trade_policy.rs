use crate::balance_generated::{
    APIARY_SEASON_END_MONTH, APIARY_SEASON_START_MONTH,
    MARKET_SPECIALTY_EXPORT_PER_BROKER_PER_SECOND, VINEYARD_HARVEST_END_MONTH,
    VINEYARD_HARVEST_START_MONTH,
};

pub const SPECIALTY_EXPORT_POLICY_ANY_RATE: u8 = 0;
pub const SPECIALTY_EXPORT_POLICY_FAIR_RATE: u8 = 1;
pub const SPECIALTY_EXPORT_POLICY_FAVORABLE_RATE: u8 = 2;

pub const SPECIALTY_EXPORT_FAIR_RATE_MIN: f64 = 0.98;
pub const SPECIALTY_EXPORT_FAVORABLE_RATE_MIN: f64 = 1.05;

pub fn is_valid_specialty_export_policy(policy: u8) -> bool {
    matches!(
        policy,
        SPECIALTY_EXPORT_POLICY_ANY_RATE
            | SPECIALTY_EXPORT_POLICY_FAIR_RATE
            | SPECIALTY_EXPORT_POLICY_FAVORABLE_RATE
    )
}

pub fn specialty_export_min_rate(policy: u8) -> Option<f64> {
    match policy {
        SPECIALTY_EXPORT_POLICY_ANY_RATE => Some(0.0),
        SPECIALTY_EXPORT_POLICY_FAIR_RATE => Some(SPECIALTY_EXPORT_FAIR_RATE_MIN),
        SPECIALTY_EXPORT_POLICY_FAVORABLE_RATE => Some(SPECIALTY_EXPORT_FAVORABLE_RATE_MIN),
        _ => None,
    }
}

pub fn specialty_export_policy_allows(policy: u8, market_rate: f64) -> bool {
    let minimum = specialty_export_min_rate(policy).unwrap_or(0.0);
    market_rate.is_finite() && market_rate + 1e-9 >= minimum
}

pub fn month_in_window(month: u8, start: u8, end: u8) -> bool {
    if start <= end {
        (start..=end).contains(&month)
    } else {
        month >= start || month <= end
    }
}

pub fn apiary_is_active(month: u8) -> bool {
    month_in_window(month, APIARY_SEASON_START_MONTH, APIARY_SEASON_END_MONTH)
}

pub fn vineyard_is_harvesting(month: u8) -> bool {
    month_in_window(
        month,
        VINEYARD_HARVEST_START_MONTH,
        VINEYARD_HARVEST_END_MONTH,
    )
}

/// One broker remains occupied while a manual caravan transaction settles.
pub fn specialty_export_workers(assigned_labor: u32, manual_trade_cooldown: f64) -> u32 {
    assigned_labor.saturating_sub(u32::from(manual_trade_cooldown > 1e-6))
}

pub fn specialty_export_capacity(
    assigned_labor: u32,
    manual_trade_cooldown: f64,
    seconds: f64,
) -> f64 {
    specialty_export_workers(assigned_labor, manual_trade_cooldown) as f64
        * MARKET_SPECIALTY_EXPORT_PER_BROKER_PER_SECOND
        * seconds.max(0.0)
}

/// Rotating priority prevents a continuously supplied high-value good from
/// starving the other specialty queues.
pub fn specialty_export_order(sim_tick: u64) -> [usize; 4] {
    let start = sim_tick as usize % 4;
    [start, (start + 1) % 4, (start + 2) % 4, (start + 3) % 4]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apiaries_rest_through_the_cold_half_of_the_year() {
        assert!(!apiary_is_active(3));
        assert!(apiary_is_active(4));
        assert!(apiary_is_active(9));
        assert!(!apiary_is_active(10));
    }

    #[test]
    fn vineyards_have_a_short_autumn_harvest() {
        assert!(!vineyard_is_harvesting(8));
        assert!(vineyard_is_harvesting(9));
        assert!(vineyard_is_harvesting(10));
        assert!(!vineyard_is_harvesting(11));
    }

    #[test]
    fn manual_trade_occupies_one_broker_without_freezing_a_larger_market() {
        assert_eq!(specialty_export_workers(0, 0.0), 0);
        assert_eq!(specialty_export_workers(1, 4.0), 0);
        assert_eq!(specialty_export_workers(2, 4.0), 1);
        assert!((specialty_export_capacity(2, 4.0, 1.0) - 0.45).abs() < 1e-9);
    }

    #[test]
    fn specialty_priority_rotates_fairly() {
        assert_eq!(specialty_export_order(0), [0, 1, 2, 3]);
        assert_eq!(specialty_export_order(1), [1, 2, 3, 0]);
        assert_eq!(specialty_export_order(3), [3, 0, 1, 2]);
    }

    #[test]
    fn specialty_export_policies_hold_for_the_selected_market_floor() {
        assert!(specialty_export_policy_allows(
            SPECIALTY_EXPORT_POLICY_ANY_RATE,
            0.78
        ));
        assert!(!specialty_export_policy_allows(
            SPECIALTY_EXPORT_POLICY_FAIR_RATE,
            0.97
        ));
        assert!(specialty_export_policy_allows(
            SPECIALTY_EXPORT_POLICY_FAIR_RATE,
            0.98
        ));
        assert!(!specialty_export_policy_allows(
            SPECIALTY_EXPORT_POLICY_FAVORABLE_RATE,
            1.049
        ));
        assert!(specialty_export_policy_allows(
            SPECIALTY_EXPORT_POLICY_FAVORABLE_RATE,
            1.05
        ));
        // Corrupt or pre-release policy values fail open so a marketplace
        // cannot become permanently blocked; the reducer still rejects them.
        assert!(specialty_export_policy_allows(3, 0.78));
    }
}
