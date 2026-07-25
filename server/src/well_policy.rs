//! Pure well-yield policy shared by the authoritative simulation and native tests.

use crate::balance_generated::{WELL_BASE_REFILL_PER_SEC, WELL_MINIMUM_REFILL_HYDROLOGY};

pub fn effective_well_hydrology(hydrology: f64) -> f64 {
    hydrology.clamp(0.0, 1.0).max(WELL_MINIMUM_REFILL_HYDROLOGY)
}

pub fn well_refill_per_second(
    hydrology: f64,
    processing_workers: u32,
    weather_multiplier: f64,
) -> f64 {
    WELL_BASE_REFILL_PER_SEC
        * effective_well_hydrology(hydrology)
        * processing_workers as f64
        * weather_multiplier.max(0.0)
}

pub fn well_refill_amount(
    hydrology: f64,
    processing_workers: u32,
    weather_multiplier: f64,
    dt: f64,
) -> f64 {
    well_refill_per_second(hydrology, processing_workers, weather_multiplier) * dt.max(0.0)
}

pub fn prioritize_fire_response(
    fire_response_needed: bool,
    refill_ready: bool,
    normal_work: (bool, bool),
) -> (bool, bool) {
    if fire_response_needed {
        (false, refill_ready)
    } else {
        normal_work
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dry_wells_still_draw_a_useful_baseline_supply() {
        assert_eq!(effective_well_hydrology(0.0), WELL_MINIMUM_REFILL_HYDROLOGY);
        assert!(well_refill_per_second(0.0, 1, 1.0) > 0.0);
    }

    #[test]
    fn refill_is_faster_for_every_well_and_scales_with_labor() {
        let poor_site = well_refill_per_second(0.03, 1, 1.0);
        let good_site = well_refill_per_second(0.8, 1, 1.0);
        assert!(poor_site >= 0.1);
        assert!(good_site > poor_site);
        assert_eq!(well_refill_per_second(0.8, 2, 1.0), good_site * 2.0);
    }

    #[test]
    fn fire_calls_preempt_household_delivery_without_changing_refill_rules() {
        assert_eq!(
            prioritize_fire_response(true, true, (true, false)),
            (false, true)
        );
        assert_eq!(
            prioritize_fire_response(true, false, (true, true)),
            (false, false)
        );
        assert_eq!(
            prioritize_fire_response(false, true, (true, false)),
            (true, false)
        );
    }
}
