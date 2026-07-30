//! Pure well-yield policy shared by the authoritative simulation and native tests.

use crate::balance_generated::{
    BREWERY_BREWING_WATER_PER_CYCLE, BREWERY_MALTING_WATER_PER_CYCLE, GRANARY_WATER_PER_CYCLE,
    MILL_WATER_PER_HARVEST, SMITHY_WATER_PER_CYCLE, WEAVER_FLAX_WATER_PER_CYCLE,
    WELL_BASE_REFILL_PER_SEC, WELL_MINIMUM_REFILL_HYDROLOGY,
};
use crate::construction_priority::{
    CONSTRUCTION_PRIORITY_LOW, CONSTRUCTION_PRIORITY_NORMAL, CONSTRUCTION_PRIORITY_URGENT,
};
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

pub const INDUSTRIAL_WATER_BUILDING_KINDS: &[&str] = &["granary", "brewery", "weaver", "smithy"];

pub fn industrial_water_requirement(building_kind: &str) -> f64 {
    match building_kind {
        "granary" => GRANARY_WATER_PER_CYCLE,
        "brewery" => BREWERY_MALTING_WATER_PER_CYCLE + BREWERY_BREWING_WATER_PER_CYCLE,
        "weaver" => WEAVER_FLAX_WATER_PER_CYCLE,
        "smithy" => SMITHY_WATER_PER_CYCLE,
        "lumber_mill" => MILL_WATER_PER_HARVEST,
        _ => 0.0,
    }
}

/// Loom fibre policy doubles as its water-cart preference because only the
/// flax route consumes water. Other wet workshops and automatic looms occupy
/// the neutral middle tier; explicit building work priority still wins first.
pub fn industrial_water_input_preference_rank(building_kind: &str, weaver_input_policy: u8) -> u8 {
    if building_kind == "weaver" {
        weaver_fibre_delivery_preference_rank(weaver_input_policy, true)
    } else {
        1
    }
}

fn normalized_work_priority(priority: u8) -> u8 {
    match priority {
        CONSTRUCTION_PRIORITY_LOW | CONSTRUCTION_PRIORITY_NORMAL | CONSTRUCTION_PRIORITY_URGENT => {
            priority
        }
        _ => CONSTRUCTION_PRIORITY_NORMAL,
    }
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
/// water runway, and shortest cart route, using building id as a deterministic
/// final tie-break.
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

pub fn well_refill_workers(available_labor: u32, has_delivery_target: bool) -> u32 {
    if has_delivery_target {
        available_labor.saturating_sub(1)
    } else {
        available_labor
    }
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
    use std::time::Instant;

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

    #[test]
    fn idle_deliverers_join_the_drawing_crew_until_demand_appears() {
        assert_eq!(well_refill_workers(1, false), 1);
        assert_eq!(well_refill_workers(2, false), 2);
        assert_eq!(well_refill_workers(4, false), 4);
        assert_eq!(well_refill_workers(1, true), 0);
        assert_eq!(well_refill_workers(2, true), 1);
        assert_eq!(well_refill_workers(4, true), 3);
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
    fn industrial_water_honors_work_priority_before_runway() {
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
        assert_eq!(selected.building_id, 8);
    }

    #[test]
    fn industrial_water_honors_loom_policy_inside_one_work_tier() {
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
    fn industrial_water_requirements_only_include_wet_processors() {
        assert_eq!(
            INDUSTRIAL_WATER_BUILDING_KINDS,
            &["granary", "brewery", "weaver", "smithy"]
        );
        assert_eq!(
            industrial_water_requirement("granary"),
            GRANARY_WATER_PER_CYCLE
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
            industrial_water_requirement("weaver"),
            WEAVER_FLAX_WATER_PER_CYCLE
        );
        assert_eq!(
            industrial_water_requirement("smithy"),
            SMITHY_WATER_PER_CYCLE
        );
        assert_eq!(industrial_water_requirement("watermill"), 0.0);
        assert_eq!(
            industrial_water_input_preference_rank(
                "weaver",
                crate::weaver_input_policy::WEAVER_INPUT_POLICY_FLAX_FIRST,
            ),
            0
        );
        assert_eq!(
            industrial_water_input_preference_rank(
                "weaver",
                crate::weaver_input_policy::WEAVER_INPUT_POLICY_WOOL_FIRST,
            ),
            2
        );
        assert_eq!(industrial_water_input_preference_rank("granary", 2), 1);
    }

    #[test]
    fn industrial_water_targets_follow_the_workshop_stock_policy() {
        assert_eq!(industrial_water_target("granary", 25), 2.0);
        assert_eq!(industrial_water_target("granary", 50), 4.0);
        assert_eq!(industrial_water_target("granary", 75), 6.0);
        assert_eq!(industrial_water_target("granary", 100), 6.0);
        assert_eq!(industrial_water_target("brewery", 50), 6.0);
        assert_eq!(industrial_water_target("weaver", 25), 1.0);
        assert_eq!(industrial_water_target("weaver", 100), 3.0);
        assert_eq!(industrial_water_target("smithy", 25), 1.0);
        assert_eq!(industrial_water_target("smithy", 100), 3.0);
        assert_eq!(industrial_water_target("watermill", 25), 0.0);
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
