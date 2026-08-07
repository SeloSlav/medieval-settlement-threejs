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

/// A seasonal harvest is one indivisible work batch. If either co-product
/// lacks room, the crop remains uncollected until a cart frees storage instead
/// of silently discarding the part that did not fit.
pub fn producer_output_batch_fits(outputs: impl IntoIterator<Item = (f64, f64, f64)>) -> bool {
    outputs.into_iter().all(|(stock, capacity, batch)| {
        stock.is_finite()
            && capacity.is_finite()
            && batch.is_finite()
            && capacity >= 0.0
            && batch >= 0.0
            && capacity - stock.max(0.0) + 1e-6 >= batch
    })
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
pub fn specialty_export_order(sim_tick: u64) -> [usize; 5] {
    let start = sim_tick as usize % 5;
    [
        start,
        (start + 1) % 5,
        (start + 2) % 5,
        (start + 3) % 5,
        (start + 4) % 5,
    ]
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
    fn seasonal_harvest_waits_for_every_co_product_store() {
        assert!(producer_output_batch_fits([
            (134.0, 140.0, 6.0),
            (37.0, 40.0, 3.0),
        ]));
        assert!(!producer_output_batch_fits([
            (134.01, 140.0, 6.0),
            (0.0, 40.0, 3.0),
        ]));
        assert!(!producer_output_batch_fits([
            (0.0, 140.0, 6.0),
            (37.01, 40.0, 3.0),
        ]));
        assert!(!producer_output_batch_fits([(f64::NAN, 140.0, 6.0,)]));
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
        assert_eq!(specialty_export_order(0), [0, 1, 2, 3, 4]);
        assert_eq!(specialty_export_order(1), [1, 2, 3, 4, 0]);
        assert_eq!(specialty_export_order(4), [4, 0, 1, 2, 3]);
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
