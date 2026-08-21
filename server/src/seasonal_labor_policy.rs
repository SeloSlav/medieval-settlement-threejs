#[cfg(test)]
use crate::construction_priority::CONSTRUCTION_PRIORITY_URGENT;
use crate::construction_priority::{CONSTRUCTION_PRIORITY_LOW, CONSTRUCTION_PRIORITY_NORMAL};
use crate::foraging_policy::harvest_available;
use crate::specialty_trade_policy::apiary_is_active;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SeasonalCallupCandidate {
    pub building_id: u64,
    pub priority: u8,
    pub assigned_labor: u32,
    pub max_labor: u32,
}

fn normalize_staffing_priority(_priority: u8) -> u8 {
    CONSTRUCTION_PRIORITY_NORMAL
}

pub fn is_seasonal_labor_kind(kind: &str) -> bool {
    matches!(
        kind,
        "foragers_shed" | "fishing_camp" | "threshing_barn" | "apiary" | "watermill"
    )
}

/// Returns `None` for year-round workplaces. Seasonal sites report whether
/// their production crew can perform productive work in the current month.
pub fn seasonal_production_active(
    kind: &str,
    month: u32,
    farmstead_work_active: bool,
) -> Option<bool> {
    match kind {
        "foragers_shed" => {
            Some(harvest_available("berries", month) || harvest_available("mushrooms", month))
        }
        "fishing_camp" => Some(harvest_available("fish", month)),
        "threshing_barn" => Some(farmstead_work_active),
        "apiary" => Some(apiary_is_active(month as u8)),
        "watermill" => Some(!matches!(month, 12 | 1 | 2)),
        _ => None,
    }
}

/// Dormant seasonal sites release their full production roster. Stored goods
/// are collected by logistics labor, never by the seasonal crew.
pub fn seasonal_labor_target(
    kind: &str,
    month: u32,
    assigned_labor: u32,
    _has_dispatch_duty: bool,
    farmstead_work_active: bool,
) -> Option<u32> {
    let active = seasonal_production_active(kind, month, farmstead_work_active)?;
    if active {
        return Some(assigned_labor);
    }
    Some(0)
}

/// Distributes free labor to active seasonal sites. In stable worksite order,
/// one worker goes to every site before any site receives a second worker,
/// preventing the first farm or harvest camp from monopolizing a scarce crew.
pub fn seasonal_callup_targets(
    candidates: &[SeasonalCallupCandidate],
    available_labor: u32,
) -> Vec<(u64, u32)> {
    let mut buckets: [Vec<(SeasonalCallupCandidate, u32)>; 3] = std::array::from_fn(|_| Vec::new());
    for candidate in candidates
        .iter()
        .copied()
        .filter(|candidate| candidate.assigned_labor < candidate.max_labor)
    {
        let priority = normalize_staffing_priority(candidate.priority);
        buckets[(priority - CONSTRUCTION_PRIORITY_LOW) as usize]
            .push((candidate, candidate.assigned_labor));
    }
    for bucket in &mut buckets {
        bucket.sort_unstable_by_key(|(candidate, _)| candidate.building_id);
    }

    let mut labor_remaining = available_labor;
    let mut targets = Vec::new();
    for bucket in buckets.iter_mut().rev() {
        while labor_remaining > 0 {
            let mut assigned_this_pass = false;
            for (candidate, _) in bucket.iter_mut() {
                if labor_remaining == 0 {
                    break;
                }
                if candidate.assigned_labor >= candidate.max_labor {
                    continue;
                }
                candidate.assigned_labor += 1;
                labor_remaining -= 1;
                assigned_this_pass = true;
            }
            if !assigned_this_pass {
                break;
            }
        }
        targets.extend(
            bucket
                .iter()
                .filter(|(candidate, original_labor)| candidate.assigned_labor > *original_labor)
                .map(|(candidate, _)| (candidate.building_id, candidate.assigned_labor)),
        );
        if labor_remaining == 0 {
            break;
        }
    }
    targets
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use super::*;

    #[test]
    fn apiary_follows_its_existing_window() {
        assert_eq!(seasonal_production_active("apiary", 3, false), Some(false));
        assert_eq!(seasonal_production_active("apiary", 4, false), Some(true));
    }

    #[test]
    fn wild_food_crews_are_dormant_during_winter() {
        assert_eq!(
            seasonal_production_active("foragers_shed", 1, false),
            Some(false)
        );
        assert_eq!(
            seasonal_production_active("fishing_camp", 12, false),
            Some(false)
        );
        assert_eq!(
            seasonal_production_active("fishing_camp", 3, false),
            Some(true)
        );
    }

    #[test]
    fn watermill_crews_stop_for_winter_and_return_in_spring() {
        assert_eq!(
            seasonal_production_active("watermill", 1, false),
            Some(false)
        );
        assert_eq!(
            seasonal_production_active("watermill", 12, false),
            Some(false)
        );
        assert_eq!(
            seasonal_production_active("watermill", 3, false),
            Some(true)
        );
    }

    #[test]
    fn farmstead_uses_current_field_work_instead_of_a_coarse_month_window() {
        assert_eq!(
            seasonal_production_active("threshing_barn", 3, true),
            Some(true)
        );
        assert_eq!(
            seasonal_production_active("threshing_barn", 3, false),
            Some(false)
        );
    }

    #[test]
    fn dormant_site_releases_producers_even_when_stock_is_waiting() {
        assert_eq!(seasonal_labor_target("apiary", 1, 3, true, false), Some(0));
        assert_eq!(seasonal_labor_target("apiary", 1, 3, false, false), Some(0));
        assert_eq!(seasonal_labor_target("apiary", 4, 3, false, false), Some(3));
    }

    #[test]
    fn year_round_workplaces_are_not_part_of_seasonal_recall() {
        assert_eq!(seasonal_labor_target("granary", 1, 4, false, false), None);
    }

    #[test]
    fn callup_ignores_legacy_priority_and_round_robins_stably() {
        let targets = seasonal_callup_targets(
            &[
                SeasonalCallupCandidate {
                    building_id: 10,
                    priority: CONSTRUCTION_PRIORITY_LOW,
                    assigned_labor: 0,
                    max_labor: 3,
                },
                SeasonalCallupCandidate {
                    building_id: 20,
                    priority: CONSTRUCTION_PRIORITY_URGENT,
                    assigned_labor: 0,
                    max_labor: 2,
                },
                SeasonalCallupCandidate {
                    building_id: 30,
                    priority: CONSTRUCTION_PRIORITY_NORMAL,
                    assigned_labor: 0,
                    max_labor: 2,
                },
            ],
            3,
        );
        assert_eq!(targets, vec![(10, 1), (20, 1), (30, 1)]);
    }

    #[test]
    fn callup_round_robins_within_a_priority_tier() {
        let targets = seasonal_callup_targets(
            &[
                SeasonalCallupCandidate {
                    building_id: 20,
                    priority: CONSTRUCTION_PRIORITY_URGENT,
                    assigned_labor: 0,
                    max_labor: 3,
                },
                SeasonalCallupCandidate {
                    building_id: 10,
                    priority: CONSTRUCTION_PRIORITY_URGENT,
                    assigned_labor: 0,
                    max_labor: 3,
                },
            ],
            2,
        );
        assert_eq!(targets, vec![(10, 1), (20, 1)]);
    }

    #[test]
    fn legacy_priority_is_normal_and_callup_never_exceeds_limits() {
        let targets = seasonal_callup_targets(
            &[
                SeasonalCallupCandidate {
                    building_id: 10,
                    priority: 0,
                    assigned_labor: 1,
                    max_labor: 2,
                },
                SeasonalCallupCandidate {
                    building_id: 20,
                    priority: CONSTRUCTION_PRIORITY_LOW,
                    assigned_labor: 1,
                    max_labor: 4,
                },
            ],
            10,
        );
        assert_eq!(targets, vec![(10, 2), (20, 4)]);
    }

    #[test]
    fn large_callup_plan_stays_below_interactive_latency() {
        let candidates = (0..100_000u64)
            .map(|building_id| SeasonalCallupCandidate {
                building_id,
                priority: (building_id % 4) as u8,
                assigned_labor: 0,
                max_labor: 3,
            })
            .collect::<Vec<_>>();
        let started = Instant::now();
        let targets = seasonal_callup_targets(&candidates, 100_000);
        assert_eq!(
            targets.iter().map(|(_, target)| *target).sum::<u32>(),
            100_000
        );
        assert!(
            started.elapsed() < Duration::from_millis(250),
            "100k seasonal call-up sites should remain comfortably interactive"
        );
    }
}
