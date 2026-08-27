//! Pure well-yield policy shared by the authoritative simulation and native tests.

#[cfg(test)]
use crate::balance_generated::CALENDAR_SECONDS_PER_DAY;
use crate::balance_generated::{
    BAKERY_WATER_PER_CYCLE, BREWERY_BREWING_WATER_PER_CYCLE, BREWERY_MALTING_WATER_PER_CYCLE,
    CATTLE_MAX_HERD, CATTLE_WATER_PER_HEAD_PER_CYCLE, MILL_WATER_PER_HARVEST,
    POTTER_WATER_PER_CYCLE, SHEEP_MAX_HERD, SHEEP_WATER_PER_HEAD_PER_CYCLE, SMITHY_WATER_PER_CYCLE,
    SPINNING_RETTING_FLAX_WATER_PER_CYCLE, SWINE_MAX_HERD, SWINE_WATER_PER_HEAD_PER_CYCLE,
    WELL_BASE_REFILL_PER_SEC, WELL_MINIMUM_REFILL_HYDROLOGY,
};
use crate::construction_priority::CONSTRUCTION_PRIORITY_NORMAL;
use crate::processor_output_policy::processor_input_staging_cycles;
use crate::weaver_input_policy::weaver_fibre_delivery_preference_rank;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct IndustrialWaterCandidate {
    pub building_id: u64,
    pub work_priority: u8,
    pub input_preference_rank: u8,
    pub stock_ratio: f64,
    pub distance: f64,
}

pub const INDUSTRIAL_WATER_BUILDING_KINDS: &[&str] = &[
    "bakery",
    "brewery",
    "spinning_retting_house",
    "smithy",
    "potter_kiln",
    "pastoral_farmstead",
    "swineherd",
];

pub fn industrial_water_requirement(building_kind: &str) -> f64 {
    match building_kind {
        "bakery" => BAKERY_WATER_PER_CYCLE,
        "brewery" => BREWERY_MALTING_WATER_PER_CYCLE + BREWERY_BREWING_WATER_PER_CYCLE,
        "spinning_retting_house" => SPINNING_RETTING_FLAX_WATER_PER_CYCLE,
        "smithy" => SMITHY_WATER_PER_CYCLE,
        "potter_kiln" => POTTER_WATER_PER_CYCLE,
        "pastoral_farmstead" => (f64::from(CATTLE_MAX_HERD) * CATTLE_WATER_PER_HEAD_PER_CYCLE)
            .max(f64::from(SHEEP_MAX_HERD) * SHEEP_WATER_PER_HEAD_PER_CYCLE),
        "swineherd" => f64::from(SWINE_MAX_HERD) * SWINE_WATER_PER_HEAD_PER_CYCLE,
        "lumber_mill" => MILL_WATER_PER_HARVEST,
        _ => 0.0,
    }
}

/// Textile route policy doubles as the spinner's automatic well-service preference because
/// only the flax route consumes water. Other wet workshops and automatic
/// workshops occupy the neutral middle tier.
pub fn industrial_water_input_preference_rank(building_kind: &str, weaver_input_policy: u8) -> u8 {
    if building_kind == "spinning_retting_house" {
        weaver_fibre_delivery_preference_rank(weaver_input_policy, true)
    } else {
        1
    }
}

fn normalized_work_priority(_priority: u8) -> u8 {
    CONSTRUCTION_PRIORITY_NORMAL
}

/// Workshop wells stage the same number of production cycles selected by the
/// building's stock policy. Non-policy consumers retain their single-cycle
/// requirement.
pub fn industrial_water_target(building_kind: &str, processor_output_target_percent: u8) -> f64 {
    let per_cycle = industrial_water_requirement(building_kind);
    if INDUSTRIAL_WATER_BUILDING_KINDS.contains(&building_kind) {
        per_cycle * processor_input_staging_cycles(processor_output_target_percent)
    } else {
        per_cycle
    }
}

/// Select the highest-priority workshop, then its input preference, least
/// water runway, and shortest road-equivalent service route, using building id
/// as a deterministic final tie-break.
pub fn select_industrial_water_candidate(
    candidates: impl IntoIterator<Item = IndustrialWaterCandidate>,
) -> Option<IndustrialWaterCandidate> {
    candidates
        .into_iter()
        .filter(|candidate| {
            candidate.stock_ratio.is_finite()
                && candidate.stock_ratio >= 0.0
                && candidate.distance.is_finite()
                && candidate.distance >= 0.0
        })
        .min_by(|a, b| {
            normalized_work_priority(b.work_priority)
                .cmp(&normalized_work_priority(a.work_priority))
                .then_with(|| a.input_preference_rank.cmp(&b.input_preference_rank))
                .then_with(|| a.stock_ratio.total_cmp(&b.stock_ratio))
                .then_with(|| a.distance.total_cmp(&b.distance))
                .then_with(|| a.building_id.cmp(&b.building_id))
        })
}

pub fn effective_well_hydrology(hydrology: f64) -> f64 {
    hydrology.clamp(0.0, 1.0).max(WELL_MINIMUM_REFILL_HYDROLOGY)
}

pub fn well_refill_per_second(hydrology: f64, weather_multiplier: f64) -> f64 {
    WELL_BASE_REFILL_PER_SEC * effective_well_hydrology(hydrology) * weather_multiplier.max(0.0)
}

pub fn well_refill_amount(hydrology: f64, weather_multiplier: f64, dt: f64) -> f64 {
    well_refill_per_second(hydrology, weather_multiplier) * dt.max(0.0)
}

#[cfg(test)]
pub fn well_refill_per_day(hydrology: f64, weather_multiplier: f64) -> f64 {
    well_refill_amount(hydrology, weather_multiplier, CALENDAR_SECONDS_PER_DAY)
}

pub fn position_within_well_service_radius(
    well_x: f64,
    well_z: f64,
    work_radius: f64,
    target_x: f64,
    target_z: f64,
) -> bool {
    if work_radius <= 0.0 {
        return false;
    }
    let dx = well_x - target_x;
    let dz = well_z - target_z;
    dx * dx + dz * dz <= work_radius * work_radius
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::balance_generated::{DROUGHT_WELL_REFILL_MULTIPLIER, RESIDENCE_WATER_UNITS_PER_DAY};
    use std::time::Instant;

    #[test]
    fn dry_wells_still_draw_a_useful_baseline_supply() {
        assert_eq!(effective_well_hydrology(0.0), WELL_MINIMUM_REFILL_HYDROLOGY);
        assert!(well_refill_per_second(0.0, 1.0) > 0.0);
    }

    #[test]
    fn refill_is_passive_and_faster_at_better_sites() {
        let poor_site = well_refill_per_second(0.03, 1.0);
        let good_site = well_refill_per_second(0.8, 1.0);
        assert!(poor_site >= 0.1);
        assert!(good_site > poor_site);
    }

    #[test]
    fn well_capacity_is_measured_against_daily_household_bills() {
        let household_daily_demand = RESIDENCE_WATER_UNITS_PER_DAY;
        let best_case_homes = well_refill_per_day(1.0, 1.0) / household_daily_demand;
        let dry_site_homes = well_refill_per_day(0.0, 1.0) / household_daily_demand;
        let drought_homes =
            well_refill_per_day(1.0, DROUGHT_WELL_REFILL_MULTIPLIER) / household_daily_demand;
        assert!((best_case_homes - 288.0).abs() < 1e-9);
        assert!(dry_site_homes < best_case_homes);
        assert!(drought_homes < best_case_homes);
    }

    #[test]
    fn service_radius_rejects_connected_but_unreachable_homes() {
        assert!(position_within_well_service_radius(
            0.0, 0.0, 80.0, 48.0, 64.0,
        ));
        assert!(!position_within_well_service_radius(
            0.0, 0.0, 80.0, 48.1, 64.0,
        ));
        assert!(!position_within_well_service_radius(
            0.0, 0.0, 0.0, 0.0, 0.0,
        ));
    }

    #[test]
    fn industrial_water_targets_prioritize_runway_then_route_then_id() {
        let selected = select_industrial_water_candidate([
            IndustrialWaterCandidate {
                building_id: 8,
                work_priority: 2,
                input_preference_rank: 1,
                stock_ratio: 0.5,
                distance: 10.0,
            },
            IndustrialWaterCandidate {
                building_id: 7,
                work_priority: 2,
                input_preference_rank: 1,
                stock_ratio: 0.0,
                distance: 30.0,
            },
            IndustrialWaterCandidate {
                building_id: 6,
                work_priority: 2,
                input_preference_rank: 1,
                stock_ratio: 0.0,
                distance: 30.0,
            },
        ])
        .expect("a valid workshop should be selected");
        assert_eq!(selected.building_id, 6);
    }

    #[test]
    fn industrial_water_ignores_legacy_priority_before_input_policy_and_runway() {
        let selected = select_industrial_water_candidate([
            IndustrialWaterCandidate {
                building_id: 8,
                work_priority: 3,
                input_preference_rank: 2,
                stock_ratio: 0.5,
                distance: 100.0,
            },
            IndustrialWaterCandidate {
                building_id: 7,
                work_priority: 1,
                input_preference_rank: 0,
                stock_ratio: 0.0,
                distance: 10.0,
            },
        ])
        .expect("a valid workshop should be selected");
        assert_eq!(selected.building_id, 7);
    }

    #[test]
    fn industrial_water_honors_fibre_house_policy_inside_one_work_tier() {
        let selected = select_industrial_water_candidate([
            IndustrialWaterCandidate {
                building_id: 8,
                work_priority: 2,
                input_preference_rank: 0,
                stock_ratio: 0.8,
                distance: 100.0,
            },
            IndustrialWaterCandidate {
                building_id: 7,
                work_priority: 2,
                input_preference_rank: 1,
                stock_ratio: 0.0,
                distance: 10.0,
            },
            IndustrialWaterCandidate {
                building_id: 6,
                work_priority: 2,
                input_preference_rank: 2,
                stock_ratio: 0.0,
                distance: 5.0,
            },
        ])
        .expect("a valid workshop should be selected");
        assert_eq!(selected.building_id, 8);
    }

    #[test]
    fn industrial_water_requirements_include_wet_processors_and_animal_troughs() {
        assert_eq!(
            INDUSTRIAL_WATER_BUILDING_KINDS,
            &[
                "bakery",
                "brewery",
                "spinning_retting_house",
                "smithy",
                "potter_kiln",
                "pastoral_farmstead",
                "swineherd",
            ]
        );
        assert_eq!(
            industrial_water_requirement("bakery"),
            BAKERY_WATER_PER_CYCLE
        );
        assert_eq!(
            industrial_water_requirement("brewery"),
            BREWERY_MALTING_WATER_PER_CYCLE + BREWERY_BREWING_WATER_PER_CYCLE
        );
        assert_eq!(
            industrial_water_requirement("lumber_mill"),
            MILL_WATER_PER_HARVEST
        );
        assert_eq!(
            industrial_water_requirement("spinning_retting_house"),
            SPINNING_RETTING_FLAX_WATER_PER_CYCLE
        );
        assert_eq!(
            industrial_water_requirement("smithy"),
            SMITHY_WATER_PER_CYCLE
        );
        assert_eq!(
            industrial_water_requirement("potter_kiln"),
            POTTER_WATER_PER_CYCLE
        );
        assert_eq!(
            industrial_water_requirement("pastoral_farmstead"),
            (f64::from(CATTLE_MAX_HERD) * CATTLE_WATER_PER_HEAD_PER_CYCLE)
                .max(f64::from(SHEEP_MAX_HERD) * SHEEP_WATER_PER_HEAD_PER_CYCLE)
        );
        assert_eq!(
            industrial_water_requirement("swineherd"),
            f64::from(SWINE_MAX_HERD) * SWINE_WATER_PER_HEAD_PER_CYCLE
        );
        assert_eq!(industrial_water_requirement("watermill"), 0.0);
        assert_eq!(industrial_water_requirement("windmill"), 0.0);
        assert_eq!(
            industrial_water_input_preference_rank(
                "spinning_retting_house",
                crate::weaver_input_policy::WEAVER_INPUT_POLICY_FLAX_FIRST,
            ),
            0
        );
        assert_eq!(
            industrial_water_input_preference_rank(
                "spinning_retting_house",
                crate::weaver_input_policy::WEAVER_INPUT_POLICY_WOOL_FIRST,
            ),
            2
        );
        assert_eq!(industrial_water_input_preference_rank("bakery", 2), 1);
    }

    #[test]
    fn industrial_water_targets_use_the_automatic_three_cycle_buffer() {
        assert_eq!(industrial_water_target("bakery", 25), 6.0);
        assert_eq!(industrial_water_target("bakery", 50), 6.0);
        assert_eq!(industrial_water_target("bakery", 75), 6.0);
        assert_eq!(industrial_water_target("bakery", 100), 6.0);
        assert_eq!(industrial_water_target("brewery", 50), 9.0);
        assert_eq!(industrial_water_target("spinning_retting_house", 25), 3.0);
        assert_eq!(industrial_water_target("spinning_retting_house", 100), 3.0);
        assert_eq!(industrial_water_target("smithy", 25), 3.0);
        assert_eq!(industrial_water_target("smithy", 100), 3.0);
        assert_eq!(industrial_water_target("potter_kiln", 25), 3.0);
        assert_eq!(industrial_water_target("potter_kiln", 100), 3.0);
        assert_eq!(industrial_water_target("watermill", 25), 0.0);
        assert_eq!(industrial_water_target("windmill", 25), 0.0);
    }

    #[test]
    fn industrial_water_selection_stays_linear_at_settlement_scale() {
        let candidates = (0..100_000).map(|index| IndustrialWaterCandidate {
            building_id: index,
            work_priority: 2,
            input_preference_rank: 1,
            stock_ratio: if index == 99_999 { 0.0 } else { 0.5 },
            distance: (100_000 - index) as f64,
        });
        let started = Instant::now();
        let selected =
            select_industrial_water_candidate(candidates).expect("the final workshop should win");
        assert_eq!(selected.building_id, 99_999);
        assert!(
            started.elapsed().as_millis() < 250,
            "100k workshop selection should remain comfortably interactive"
        );
    }
}
