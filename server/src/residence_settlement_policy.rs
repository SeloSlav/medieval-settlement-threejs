use crate::balance_generated::{
    CALENDAR_DAYS_PER_MONTH, CHAPEL_RECOVERY_STOCK_MULTIPLIER, MONASTERY_RECOVERY_STOCK_MULTIPLIER,
    RESIDENCE_FIREWOOD_UNITS_PER_MONTH, RESIDENCE_SETTLEMENT_BUFFER_DAYS,
    RESIDENCE_WATER_UNITS_PER_DAY,
};
use crate::food_demand_policy::household_food_units_per_day_for_tier;
use crate::resource_units::{whole_cost, whole_units};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ResidenceSettlementVitalNeed {
    Food,
    Firewood,
    Water,
}

/// Settlement readiness requires a physically attainable whole-unit buffer
/// derived from the residence's discrete household bills. Population does not
/// multiply firewood or water demand; food varies only with tier slots.
pub fn residence_settlement_bill_buffer_min(
    kind: ResidenceSettlementVitalNeed,
    tier: u8,
    has_chapel_access: bool,
    has_monastery_coverage: bool,
) -> f64 {
    let daily_demand = match kind {
        ResidenceSettlementVitalNeed::Food => household_food_units_per_day_for_tier(tier),
        ResidenceSettlementVitalNeed::Firewood => {
            whole_units(RESIDENCE_FIREWOOD_UNITS_PER_MONTH)
                / f64::from(CALENDAR_DAYS_PER_MONTH.max(1))
        }
        ResidenceSettlementVitalNeed::Water => whole_units(RESIDENCE_WATER_UNITS_PER_DAY),
    };
    let mut threshold = daily_demand * RESIDENCE_SETTLEMENT_BUFFER_DAYS.max(0.0);
    if has_chapel_access {
        threshold *= CHAPEL_RECOVERY_STOCK_MULTIPLIER;
    }
    if has_chapel_access && has_monastery_coverage {
        threshold *= MONASTERY_RECOVERY_STOCK_MULTIPLIER;
    }
    whole_cost(threshold)
}

/// New households may occupy an empty cottage before local distribution is
/// established. Once a household exists, further arrivals require every
/// vital need to hold its market-aligned settlement buffer.
pub fn settlement_buffers_ready<I>(population: u32, buffers: I) -> bool
where
    I: IntoIterator<Item = (f64, f64)>,
{
    population == 0
        || buffers
            .into_iter()
            .all(|(stock, required)| whole_units(stock) >= whole_cost(required))
}

#[cfg(test)]
mod tests {
    use super::{
        residence_settlement_bill_buffer_min, settlement_buffers_ready,
        ResidenceSettlementVitalNeed,
    };
    use crate::balance_generated::{
        CHAPEL_RECOVERY_STOCK_MULTIPLIER, MONASTERY_RECOVERY_STOCK_MULTIPLIER,
        RESIDENCE_RECOVERY_FIREWOOD_MIN, RESIDENCE_RECOVERY_FOOD_MIN, RESIDENCE_RECOVERY_WATER_MIN,
    };
    use std::time::{Duration, Instant};

    #[test]
    fn first_settler_can_establish_an_empty_household() {
        assert!(settlement_buffers_ready(0, [(0.0, 6.0), (0.0, 8.0)]));
    }

    #[test]
    fn established_household_waits_for_every_active_buffer() {
        assert!(!settlement_buffers_ready(
            3,
            [(8.0, 8.0), (4.9, 5.0), (6.0, 6.0)]
        ));
        assert!(settlement_buffers_ready(
            3,
            [(8.0, 8.0), (5.0, 5.0), (6.0, 6.0)]
        ));
    }

    #[test]
    fn negative_thresholds_cannot_block_growth() {
        assert!(settlement_buffers_ready(2, [(0.0, -1.0)]));
    }

    #[test]
    fn settlement_buffers_are_whole_units_derived_from_household_bills() {
        let food = residence_settlement_bill_buffer_min(
            ResidenceSettlementVitalNeed::Food,
            1,
            false,
            false,
        );
        let firewood = residence_settlement_bill_buffer_min(
            ResidenceSettlementVitalNeed::Firewood,
            1,
            false,
            false,
        );
        let water = residence_settlement_bill_buffer_min(
            ResidenceSettlementVitalNeed::Water,
            1,
            false,
            false,
        );

        assert_eq!(food, 1.0);
        assert_eq!(firewood, 1.0);
        assert_eq!(water, 1.0);
        assert_eq!(
            residence_settlement_bill_buffer_min(
                ResidenceSettlementVitalNeed::Food,
                4,
                false,
                false,
            ),
            1.0
        );
    }

    #[test]
    fn parish_support_cannot_create_a_fractional_vital_buffer() {
        assert!(CHAPEL_RECOVERY_STOCK_MULTIPLIER > 0.0);
        assert!(MONASTERY_RECOVERY_STOCK_MULTIPLIER > 0.0);
        let ordinary = residence_settlement_bill_buffer_min(
            ResidenceSettlementVitalNeed::Food,
            3,
            false,
            false,
        );
        let parish = residence_settlement_bill_buffer_min(
            ResidenceSettlementVitalNeed::Food,
            3,
            true,
            false,
        );
        let monastery =
            residence_settlement_bill_buffer_min(ResidenceSettlementVitalNeed::Food, 3, true, true);

        assert_eq!(ordinary, 1.0);
        assert_eq!(parish, 1.0);
        assert_eq!(monastery, 1.0);
    }

    #[test]
    fn ordinary_market_buffers_unlock_growth_below_legacy_fixed_recovery_stockpiles() {
        let tier = 1;
        let food = residence_settlement_bill_buffer_min(
            ResidenceSettlementVitalNeed::Food,
            tier,
            false,
            false,
        );
        let firewood = residence_settlement_bill_buffer_min(
            ResidenceSettlementVitalNeed::Firewood,
            tier,
            false,
            false,
        );
        let water = residence_settlement_bill_buffer_min(
            ResidenceSettlementVitalNeed::Water,
            tier,
            false,
            false,
        );

        assert!(food < RESIDENCE_RECOVERY_FOOD_MIN);
        assert!(firewood < RESIDENCE_RECOVERY_FIREWOOD_MIN);
        assert!(water < RESIDENCE_RECOVERY_WATER_MIN);
        assert!(settlement_buffers_ready(
            1,
            [(food, food), (firewood, firewood), (water, water)],
        ));
    }

    #[test]
    fn large_settlement_forecasts_remain_allocation_free_and_fast() {
        let started = Instant::now();
        let mut ready = 0_u32;
        for index in 0..100_000 {
            if settlement_buffers_ready(
                6,
                [
                    (8.0, 8.0),
                    (5.0, 5.0),
                    (6.0, 6.0),
                    (4.0, 4.0),
                    (3.0, 3.0),
                    (if index % 2 == 0 { 2.0 } else { 1.0 }, 2.0),
                ],
            ) {
                ready += 1;
            }
        }
        assert_eq!(ready, 50_000);
        assert!(started.elapsed() < Duration::from_secs(1));
    }
}
