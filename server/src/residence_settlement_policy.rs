use crate::balance_generated::{
    CALENDAR_HOURS_PER_DAY, CALENDAR_SECONDS_PER_DAY, CALENDAR_WORK_END_HOUR,
    CALENDAR_WORK_START_HOUR, CHAPEL_RECOVERY_STOCK_MULTIPLIER,
    MONASTERY_RECOVERY_STOCK_MULTIPLIER, RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC,
    RESIDENCE_SETTLEMENT_BUFFER_DAYS, RESIDENCE_WATER_PER_PERSON_PER_SEC,
};
use crate::food_demand_policy::household_food_per_day;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ResidenceSettlementVitalNeed {
    Food,
    Firewood,
    Water,
}

/// Settlement readiness uses a population-scaled fraction of one ordinary
/// household day. This keeps the growth gate reachable through the same daily
/// market issues that sustain the household instead of requiring obsolete
/// fixed stockpiles many times larger than an ordinary ration.
pub fn residence_settlement_buffer_min(
    kind: ResidenceSettlementVitalNeed,
    population: u32,
    has_chapel_access: bool,
    has_monastery_coverage: bool,
) -> f64 {
    let population = population.max(1);
    let workday_seconds = CALENDAR_SECONDS_PER_DAY
        * f64::from(CALENDAR_WORK_END_HOUR.saturating_sub(CALENDAR_WORK_START_HOUR))
        / f64::from(CALENDAR_HOURS_PER_DAY.max(1));
    let daily_demand = match kind {
        ResidenceSettlementVitalNeed::Food => household_food_per_day(population),
        ResidenceSettlementVitalNeed::Firewood => {
            f64::from(population)
                * RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC
                * CALENDAR_SECONDS_PER_DAY
        }
        ResidenceSettlementVitalNeed::Water => {
            f64::from(population) * RESIDENCE_WATER_PER_PERSON_PER_SEC * workday_seconds
        }
    };
    let mut threshold = daily_demand * RESIDENCE_SETTLEMENT_BUFFER_DAYS.max(0.0);
    if has_chapel_access {
        threshold *= CHAPEL_RECOVERY_STOCK_MULTIPLIER;
    }
    if has_chapel_access && has_monastery_coverage {
        threshold *= MONASTERY_RECOVERY_STOCK_MULTIPLIER;
    }
    threshold.max(0.0)
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
            .all(|(stock, required)| stock + 1e-9 >= required.max(0.0))
}

#[cfg(test)]
mod tests {
    use super::{
        residence_settlement_buffer_min, settlement_buffers_ready, ResidenceSettlementVitalNeed,
    };
    use crate::balance_generated::{
        CHAPEL_RECOVERY_STOCK_MULTIPLIER, MONASTERY_RECOVERY_STOCK_MULTIPLIER,
        RESIDENCE_RECOVERY_FIREWOOD_MIN, RESIDENCE_RECOVERY_FOOD_MIN,
        RESIDENCE_RECOVERY_WATER_MIN,
    };
    use crate::food_demand_policy::household_food_per_day;
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
    fn settlement_buffers_scale_with_household_demand_and_fit_daily_issues() {
        let food = residence_settlement_buffer_min(
            ResidenceSettlementVitalNeed::Food,
            1,
            false,
            false,
        );
        let firewood = residence_settlement_buffer_min(
            ResidenceSettlementVitalNeed::Firewood,
            1,
            false,
            false,
        );
        let water = residence_settlement_buffer_min(
            ResidenceSettlementVitalNeed::Water,
            1,
            false,
            false,
        );

        assert!(food > 0.0 && food < household_food_per_day(1));
        assert!(firewood > 0.0 && firewood < 1.0 / 3.0);
        assert!(water > 0.0 && water < 0.84);
        assert!(residence_settlement_buffer_min(
            ResidenceSettlementVitalNeed::Food,
            2,
            false,
            false,
        ) > food);
    }

    #[test]
    fn parish_support_reduces_but_never_creates_the_vital_buffer() {
        let ordinary = residence_settlement_buffer_min(
            ResidenceSettlementVitalNeed::Food,
            3,
            false,
            false,
        );
        let parish = residence_settlement_buffer_min(
            ResidenceSettlementVitalNeed::Food,
            3,
            true,
            false,
        );
        let monastery = residence_settlement_buffer_min(
            ResidenceSettlementVitalNeed::Food,
            3,
            true,
            true,
        );

        assert!((parish - ordinary * CHAPEL_RECOVERY_STOCK_MULTIPLIER).abs() < 1e-9);
        assert!((monastery - parish * MONASTERY_RECOVERY_STOCK_MULTIPLIER).abs() < 1e-9);
        assert!(monastery > 0.0 && monastery < parish && parish < ordinary);
    }

    #[test]
    fn ordinary_market_buffers_unlock_growth_below_legacy_fixed_recovery_stockpiles() {
        let population = 1;
        let food = residence_settlement_buffer_min(
            ResidenceSettlementVitalNeed::Food,
            population,
            false,
            false,
        );
        let firewood = residence_settlement_buffer_min(
            ResidenceSettlementVitalNeed::Firewood,
            population,
            false,
            false,
        );
        let water = residence_settlement_buffer_min(
            ResidenceSettlementVitalNeed::Water,
            population,
            false,
            false,
        );

        assert!(food < RESIDENCE_RECOVERY_FOOD_MIN);
        assert!(firewood < RESIDENCE_RECOVERY_FIREWOOD_MIN);
        assert!(water < RESIDENCE_RECOVERY_WATER_MIN);
        assert!(settlement_buffers_ready(
            population,
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
