use std::collections::HashMap;

use crate::balance_generated::{
    CALENDAR_HOURS_PER_DAY, CALENDAR_SECONDS_PER_DAY, CALENDAR_WORK_END_HOUR,
    CALENDAR_WORK_START_HOUR,
};

#[derive(Clone, Copy)]
pub struct CommutePair {
    pub worksite_id: u64,
    pub origin_index: usize,
    pub travel_seconds: f64,
}

/// Completed rural worksites that may construct one separately linked
/// overnight workers' camp. Keep placement eligibility and commute relief on
/// this shared policy so a Mining Camp follows the same contract as a Lumber
/// Mill despite retaining the persisted `stone_quarry` kind.
pub fn supports_buildable_remote_work_camp(kind: &str) -> bool {
    matches!(
        kind,
        "lumber_mill" | "stone_quarry" | "large_quarry" | "mine" | "charcoal_burner"
    )
}

pub fn is_exposed_commute_worksite(kind: &str) -> bool {
    supports_buildable_remote_work_camp(kind) || kind == "clay_pit"
}

pub fn is_visible_worker_workplace(kind: &str) -> bool {
    matches!(
        kind,
        "lumber_mill"
            | "reforester"
            | "woodcutters_lodge"
            | "stone_quarry"
            | "large_quarry"
            | "mine"
            | "clay_pit"
            | "charcoal_burner"
            | "smithy"
            | "potter_kiln"
            | "well"
            | "hunters_hall"
            | "foragers_shed"
            | "fishing_camp"
            | "threshing_barn"
            | "pastoral_farmstead"
            | "swineherd"
            | "brewery"
            | "smokehouse"
            | "granary"
            | "bakery"
            | "apiary"
            | "watermill"
            | "windmill"
            | "carpenter"
            | "weaver"
            | "watchtower"
            | "guardhouse"
            | "monastery"
    )
}

fn workday_seconds() -> f64 {
    CALENDAR_SECONDS_PER_DAY * (CALENDAR_WORK_END_HOUR - CALENDAR_WORK_START_HOUR) as f64
        / CALENDAR_HOURS_PER_DAY as f64
}

pub fn commute_efficiency_from_average_seconds(average_one_way_seconds: f64) -> f64 {
    let workday = workday_seconds().max(1e-6);
    ((workday - average_one_way_seconds.max(0.0) * 2.0) / workday).clamp(0.0, 1.0)
}

pub fn productive_labor_after_commute(
    onsite_labor: u32,
    exposed_worksite: bool,
    active_remote_camp: bool,
    commute_efficiency: f64,
) -> f64 {
    if onsite_labor == 0 {
        return 0.0;
    }
    let efficiency = if !exposed_worksite || active_remote_camp {
        1.0
    } else {
        commute_efficiency.clamp(0.0, 1.0)
    };
    onsite_labor as f64 * efficiency
}

pub fn assign_target_travel_seconds(
    pairs: &mut [CommutePair],
    mut remaining_by_worksite: HashMap<u64, u32>,
    mut remaining_by_origin: Vec<u32>,
    target_ids: &[u64],
) -> HashMap<u64, f64> {
    pairs.sort_by(|left, right| {
        left.travel_seconds
            .total_cmp(&right.travel_seconds)
            .then_with(|| left.worksite_id.cmp(&right.worksite_id))
            .then_with(|| left.origin_index.cmp(&right.origin_index))
    });

    let mut travel_seconds_by_target: HashMap<u64, f64> = HashMap::new();
    for pair in pairs {
        let Some(worksite_remaining) = remaining_by_worksite.get_mut(&pair.worksite_id) else {
            continue;
        };
        let Some(origin_remaining) = remaining_by_origin.get_mut(pair.origin_index) else {
            continue;
        };
        let assigned = (*worksite_remaining).min(*origin_remaining);
        if assigned == 0 {
            continue;
        }
        *worksite_remaining -= assigned;
        *origin_remaining -= assigned;
        if target_ids.binary_search(&pair.worksite_id).is_ok() {
            *travel_seconds_by_target
                .entry(pair.worksite_id)
                .or_default() += pair.travel_seconds * assigned as f64;
        }
    }
    travel_seconds_by_target
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_commute_reduces_the_available_shift() {
        let workday = workday_seconds();
        assert_eq!(commute_efficiency_from_average_seconds(0.0), 1.0);
        assert!((commute_efficiency_from_average_seconds(workday * 0.125) - 0.75).abs() < 1e-9);
        assert_eq!(commute_efficiency_from_average_seconds(workday), 0.0);
    }

    #[test]
    fn only_exposed_yards_receive_the_cached_penalty() {
        assert!(is_exposed_commute_worksite("lumber_mill"));
        assert!(is_exposed_commute_worksite("stone_quarry"));
        assert!(is_exposed_commute_worksite("charcoal_burner"));
        assert!(!is_exposed_commute_worksite("hunters_hall"));
        assert!(!is_exposed_commute_worksite("smithy"));
    }

    #[test]
    fn mining_camp_and_lumber_mill_share_overnight_camp_eligibility() {
        assert!(supports_buildable_remote_work_camp("lumber_mill"));
        assert!(supports_buildable_remote_work_camp("stone_quarry"));
        assert!(!supports_buildable_remote_work_camp("clay_pit"));
        assert!(!supports_buildable_remote_work_camp("remote_work_camp"));
    }

    #[test]
    fn safe_remote_camp_restores_the_full_local_shift() {
        assert_eq!(productive_labor_after_commute(4, true, false, 0.625), 2.5);
        assert_eq!(productive_labor_after_commute(4, true, true, 0.625), 4.0);
        assert_eq!(productive_labor_after_commute(4, false, false, 0.625), 4.0);
        assert_eq!(productive_labor_after_commute(0, true, true, 0.625), 0.0);
    }

    #[test]
    fn scarce_nearby_households_are_claimed_globally_by_travel_time() {
        let mut pairs = vec![
            CommutePair {
                worksite_id: 10,
                origin_index: 0,
                travel_seconds: 1.0,
            },
            CommutePair {
                worksite_id: 10,
                origin_index: 1,
                travel_seconds: 10.0,
            },
            CommutePair {
                worksite_id: 20,
                origin_index: 0,
                travel_seconds: 2.0,
            },
            CommutePair {
                worksite_id: 20,
                origin_index: 1,
                travel_seconds: 3.0,
            },
        ];
        let travel = assign_target_travel_seconds(
            &mut pairs,
            HashMap::from([(10, 1), (20, 1)]),
            vec![1, 1],
            &[10, 20],
        );
        assert_eq!(travel.get(&10), Some(&1.0));
        assert_eq!(travel.get(&20), Some(&3.0));
    }

    #[test]
    fn daily_matching_stays_out_of_the_hot_loop_at_settlement_scale() {
        let workplace_count = 500_u64;
        let origin_count = 200_usize;
        let mut pairs = Vec::with_capacity(workplace_count as usize * origin_count);
        for worksite_id in 0..workplace_count {
            for origin_index in 0..origin_count {
                pairs.push(CommutePair {
                    worksite_id,
                    origin_index,
                    travel_seconds: ((worksite_id * 17 + origin_index as u64 * 31) % 10_000) as f64,
                });
            }
        }
        let started = std::time::Instant::now();
        let travel = assign_target_travel_seconds(
            &mut pairs,
            (0..workplace_count).map(|id| (id, 1)).collect(),
            vec![3; origin_count],
            &(0..workplace_count).collect::<Vec<_>>(),
        );
        let elapsed = started.elapsed();
        assert_eq!(travel.len(), workplace_count as usize);
        assert!(
            elapsed.as_millis() < 500,
            "100,000 commute pairs took {elapsed:?}"
        );
    }
}
