//! Pure fire behavior shared by the authoritative simulation and native tests.

use crate::balance_generated::{
    fire_building_base_flammability, FIRE_BUCKET_WATER, FIRE_DAMAGE_PER_INTENSITY_SECOND,
    FIRE_DROUGHT_RISK_MULTIPLIER, FIRE_EXTINGUISH_CHANCE_BASE, FIRE_EXTINGUISH_CHANCE_PER_WATER,
    FIRE_EXTINGUISH_INTENSITY_THRESHOLD, FIRE_INTENSITY_GROWTH_PER_SECOND,
    FIRE_INTENSITY_REDUCTION_PER_WATER, FIRE_MINIMUM_BUCKET_WATER,
    FIRE_RAIN_INTENSITY_DAMPING_PER_SECOND, FIRE_RAIN_RISK_MULTIPLIER,
    RESIDENCE_TILE_ROOF_FLAMMABILITY_MULTIPLIER,
};
use crate::resource_units::{whole_cost, whole_transfer, whole_units};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FireStep {
    pub intensity: f64,
    pub damage: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SuppressionResult {
    pub intensity: f64,
    pub extinguish_chance: f64,
    pub extinguished: bool,
}

pub fn fire_response_load(available_water: f64) -> f64 {
    let available_water = whole_units(available_water);
    if available_water < whole_cost(FIRE_MINIMUM_BUCKET_WATER) {
        0.0
    } else {
        whole_transfer(available_water, whole_cost(FIRE_BUCKET_WATER))
    }
}

/// Water still worth dispatching for the current response wave. The initial
/// wave may claim as many free carriers as the incident's water estimate and
/// well stock support. If that whole estimate arrives without suppressing the
/// fire, one follow-up bucket is released at a time instead of abandoning a
/// still-burning structure or flooding the road with unbounded surplus water.
pub fn fire_response_water_needed(
    required_water: f64,
    delivered_water: f64,
    in_transit_water: f64,
) -> f64 {
    let required_water = whole_cost(required_water);
    let delivered_water = whole_units(delivered_water);
    let in_transit = whole_units(in_transit_water);
    let bucket_water = whole_cost(FIRE_BUCKET_WATER);
    let estimated_remaining = (required_water - delivered_water).max(0.0);
    let response_wave = if in_transit <= 1e-6 {
        estimated_remaining.max(bucket_water)
    } else {
        estimated_remaining
    };
    whole_units((response_wave - in_transit).max(0.0))
}

pub fn weather_risk_multiplier(is_raining: bool, is_drought: bool) -> f64 {
    if is_drought {
        FIRE_DROUGHT_RISK_MULTIPLIER
    } else if is_raining {
        FIRE_RAIN_RISK_MULTIPLIER
    } else {
        1.0
    }
}

/// Structural ignition policy shared by accident, lightning, spread, and raid
/// arson. The founding camp is an invariant bootstrap safeguard rather than a
/// balance-tunable fire risk.
pub fn building_base_flammability(kind: &str) -> f64 {
    if kind == "founders_camp" {
        return 0.0;
    }
    fire_building_base_flammability(kind)
}

pub fn residence_flammability(tier: u8, tiled_roof: bool) -> f64 {
    let base = 0.9 + tier as f64 * 0.12;
    if tiled_roof {
        base * RESIDENCE_TILE_ROOF_FLAMMABILITY_MULTIPLIER
    } else {
        base
    }
}

/// Combines repeated independent checks without inflating or suppressing the
/// probability when an expensive world scan is polled less often.
pub fn accumulated_event_chance(single_check_chance: f64, checks: u64) -> f64 {
    if checks == 0 {
        return 0.0;
    }
    let chance = single_check_chance.clamp(0.0, 1.0);
    1.0 - (1.0 - chance).powf(checks as f64)
}

pub fn step_fire(
    intensity: f64,
    damage: f64,
    dt: f64,
    is_raining: bool,
    is_drought: bool,
) -> FireStep {
    let weather_growth = if is_raining {
        -FIRE_RAIN_INTENSITY_DAMPING_PER_SECOND
    } else {
        FIRE_INTENSITY_GROWTH_PER_SECOND
            * if is_drought {
                FIRE_DROUGHT_RISK_MULTIPLIER
            } else {
                1.0
            }
    };
    let next_intensity = (intensity + weather_growth * dt).clamp(0.04, 1.0);
    let next_damage =
        (damage + next_intensity * FIRE_DAMAGE_PER_INTENSITY_SECOND * dt).clamp(0.0, 1.0);
    FireStep {
        intensity: next_intensity,
        damage: next_damage,
    }
}

pub fn suppression_result(intensity: f64, damage: f64, water: f64, roll: f64) -> SuppressionResult {
    let water = whole_units(water);
    let effective_water = water * (1.0 - damage.clamp(0.0, 1.0) * 0.2);
    let next_intensity =
        (intensity - effective_water * FIRE_INTENSITY_REDUCTION_PER_WATER).max(0.0);
    let threshold_bonus = if next_intensity <= FIRE_EXTINGUISH_INTENSITY_THRESHOLD {
        (FIRE_EXTINGUISH_INTENSITY_THRESHOLD - next_intensity) * 0.8
    } else {
        0.0
    };
    let chance = (FIRE_EXTINGUISH_CHANCE_BASE
        + water.max(0.0) * FIRE_EXTINGUISH_CHANCE_PER_WATER
        + threshold_bonus
        - next_intensity * 0.12
        - damage.clamp(0.0, 1.0) * 0.08)
        .clamp(0.04, 0.96);
    SuppressionResult {
        intensity: next_intensity,
        extinguish_chance: chance,
        extinguished: next_intensity <= 0.015
            || (next_intensity <= FIRE_EXTINGUISH_INTENSITY_THRESHOLD && roll < chance),
    }
}

pub fn distance_spread_factor(distance: f64, radius: f64) -> f64 {
    if radius <= 1e-6 || distance >= radius {
        return 0.0;
    }
    let normalized = 1.0 - distance.max(0.0) / radius;
    normalized * normalized
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tile_roof_reduces_but_does_not_remove_residence_fire_exposure() {
        let shingled = residence_flammability(3, false);
        let tiled = residence_flammability(3, true);

        assert!(tiled > 0.0);
        assert!(tiled < shingled);
        assert!((tiled / shingled - RESIDENCE_TILE_ROOF_FLAMMABILITY_MULTIPLIER).abs() < 1e-9);
    }

    #[test]
    fn rain_damps_while_drought_accelerates_fire() {
        let rain = step_fire(0.5, 0.0, 10.0, true, false);
        let fair = step_fire(0.5, 0.0, 10.0, false, false);
        let drought = step_fire(0.5, 0.0, 10.0, false, true);
        assert!(rain.intensity < fair.intensity);
        assert!(drought.intensity > fair.intensity);
    }

    #[test]
    fn buckets_cool_before_the_extinguish_roll() {
        let result = suppression_result(0.42, 0.2, 3.0, 1.0);
        assert!(result.intensity < 0.42);
        assert!(!result.extinguished);
        let follow_up = suppression_result(result.intensity, 0.2, 3.0, 0.0);
        assert!(follow_up.extinguished);
    }

    #[test]
    fn low_water_wells_send_only_whole_water_units() {
        assert_eq!(fire_response_load(0.99), 0.0);
        assert_eq!(fire_response_load(1.0), 1.0);
        assert_eq!(fire_response_load(1.9), 1.0);
        assert_eq!(fire_response_load(2.9), 2.0);
        assert_eq!(fire_response_load(3.0), 3.0);
        assert_eq!(fire_response_load(8.0), 3.0);
    }

    #[test]
    fn one_whole_water_unit_has_real_suppression_value() {
        let load = fire_response_load(1.9);
        assert_eq!(load, 1.0);
        let result = suppression_result(0.34, 0.2, load, 1.0);
        assert!(result.intensity < 0.34);
        assert!(result.extinguish_chance > FIRE_EXTINGUISH_CHANCE_BASE);
    }

    #[test]
    fn low_water_response_can_dispatch_and_refill_for_a_follow_up_trip() {
        let first_load = fire_response_load(1.9);
        assert_eq!(first_load, 1.0);
        assert_eq!(first_load.fract(), 0.0);

        let refilled = crate::well_policy::well_refill_amount(0.03, 1.0, 20.0);
        let second_load = fire_response_load(refilled);
        assert_eq!(second_load, FIRE_BUCKET_WATER);
        assert_eq!(second_load.fract(), 0.0);

        let first_suppression = suppression_result(0.42, 0.15, first_load, 1.0);
        let second_suppression =
            suppression_result(first_suppression.intensity, 0.25, second_load, 0.0);
        assert!(second_suppression.intensity < first_suppression.intensity);
        assert!(second_suppression.extinguished);
    }

    #[test]
    fn initial_response_wave_can_fill_several_bucket_carriers() {
        assert_eq!(fire_response_water_needed(9.0, 0.0, 0.0), 9.0);
        assert_eq!(fire_response_water_needed(9.0, 0.0, 3.0), 6.0);
        assert_eq!(fire_response_water_needed(9.0, 0.0, 6.0), 3.0);
        assert_eq!(fire_response_water_needed(9.0, 0.0, 9.0), 0.0);
    }

    #[test]
    fn failed_full_response_wave_requests_a_follow_up_bucket() {
        assert_eq!(fire_response_water_needed(9.0, 9.0, 0.0), FIRE_BUCKET_WATER);
        assert_eq!(fire_response_water_needed(9.0, 9.0, 3.0), 0.0);
    }

    #[test]
    fn coordinated_buckets_beat_growth_at_the_edge_of_well_range() {
        use crate::balance_generated::{
            FIRE_BUCKET_SPEED_MPS, FIRE_BUCKET_UNLOAD_SECONDS, FIRE_INITIAL_INTENSITY,
        };

        let first_arrival_seconds = 90.0 / FIRE_BUCKET_SPEED_MPS + FIRE_BUCKET_UNLOAD_SECONDS;
        let at_arrival = step_fire(
            FIRE_INITIAL_INTENSITY,
            0.0,
            first_arrival_seconds,
            false,
            false,
        );
        let first_bucket = suppression_result(
            at_arrival.intensity,
            at_arrival.damage,
            FIRE_BUCKET_WATER,
            1.0,
        );
        let second_bucket = suppression_result(
            first_bucket.intensity,
            at_arrival.damage,
            FIRE_BUCKET_WATER,
            1.0,
        );

        assert!(at_arrival.intensity < 0.55);
        assert!(second_bucket.extinguished);
    }

    #[test]
    fn spread_falls_off_quadratically() {
        assert_eq!(distance_spread_factor(26.0, 26.0), 0.0);
        assert!(distance_spread_factor(4.0, 26.0) > distance_spread_factor(18.0, 26.0));
    }

    #[test]
    fn accumulated_event_chance_preserves_repeated_rare_checks() {
        assert_eq!(accumulated_event_chance(0.4, 0), 0.0);
        assert!((accumulated_event_chance(0.4, 1) - 0.4).abs() < 1e-12);

        let per_tick = 0.001;
        let five_ticks = accumulated_event_chance(per_tick, 5);
        assert!(five_ticks < per_tick * 5.0);
        assert!(five_ticks > per_tick * 4.99);

        let two_windows = accumulated_event_chance(five_ticks, 2);
        let ten_ticks = accumulated_event_chance(per_tick, 10);
        assert!((two_windows - ten_ticks).abs() < 1e-12);
    }

    #[test]
    fn one_time_founding_anchor_is_structurally_fire_safe() {
        assert_eq!(building_base_flammability("founders_camp"), 0.0);
        assert_eq!(building_base_flammability("town_hall"), 0.0);
        assert!(building_base_flammability("lumber_mill") > 0.0);
    }
}
