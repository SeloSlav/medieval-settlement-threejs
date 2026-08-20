use crate::balance_generated::{
    APIARY_SEASON_END_MONTH, APIARY_SEASON_START_MONTH, VINEYARD_HARVEST_END_MONTH,
    VINEYARD_HARVEST_START_MONTH,
};

pub const SPECIALTY_EXPORT_POLICY_ANY_RATE: u8 = 0;
pub const SPECIALTY_EXPORT_POLICY_FAIR_RATE: u8 = 1;
pub const SPECIALTY_EXPORT_POLICY_FAVORABLE_RATE: u8 = 2;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum SpecialtyMarketFamily {
    Drink = 0,
    Provision = 1,
    Wares = 2,
}

impl SpecialtyMarketFamily {
    pub fn from_id(id: u8) -> Option<Self> {
        match id {
            0 => Some(Self::Drink),
            1 => Some(Self::Provision),
            2 => Some(Self::Wares),
            _ => None,
        }
    }
}

pub fn is_valid_specialty_export_policy(policy: u8) -> bool {
    matches!(
        policy,
        SPECIALTY_EXPORT_POLICY_ANY_RATE
            | SPECIALTY_EXPORT_POLICY_FAIR_RATE
            | SPECIALTY_EXPORT_POLICY_FAVORABLE_RATE
    )
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
}
