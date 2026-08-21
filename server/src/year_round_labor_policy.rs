//! Explicit Town Hall balancing for ordinary year-round workplaces.
//!
//! Free villagers fill vacancies in stable worksite order. Seasonal sites,
//! output-target processors, construction sites, and the commanding Town Hall
//! retain their specialized or manual controls.

#[cfg(test)]
use crate::construction_priority::CONSTRUCTION_PRIORITY_URGENT;
use crate::construction_priority::{CONSTRUCTION_PRIORITY_LOW, CONSTRUCTION_PRIORITY_NORMAL};
use crate::seasonal_labor_policy::is_seasonal_labor_kind;
use crate::worksite_stall_policy::is_production_labor_kind;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct YearRoundLaborSite {
    pub building_id: u64,
    pub priority: u8,
    pub assigned_labor: u32,
    pub minimum_labor: u32,
    pub max_labor: u32,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct YearRoundLaborRotation {
    pub targets: Vec<(u64, u32)>,
    pub recalled_workers: u32,
    pub called_workers: u32,
}

fn normalize_staffing_priority(_priority: u8) -> u8 {
    CONSTRUCTION_PRIORITY_NORMAL
}

/// Identifies labor-using building kinds governed by ordinary year-round
/// balancing. The reducer separately verifies that the definition accepts
/// labor. Town Hall clerks stay manual so issuing an order cannot remove the
/// settlement's last command post.
pub fn is_year_round_labor_kind(kind: &str) -> bool {
    kind != "town_hall" && !is_seasonal_labor_kind(kind) && !is_production_labor_kind(kind)
}

/// Balances ordinary year-round workplaces with minimal displacement.
///
/// Each tier uses existing free labor before drawing from strictly lower
/// priorities. Donors release from the lowest tier first and, matching
/// population-loss reconciliation, newer stable IDs release before older
/// sites. Equal-priority crews are never reshuffled.
pub fn year_round_labor_rotation(
    sites: &[YearRoundLaborSite],
    available_labor: u32,
) -> YearRoundLaborRotation {
    let mut buckets: [Vec<(YearRoundLaborSite, u32)>; 3] = std::array::from_fn(|_| Vec::new());
    for site in sites.iter().copied() {
        let mut bounded = site;
        bounded.assigned_labor = bounded.assigned_labor.min(bounded.max_labor);
        bounded.minimum_labor = bounded.minimum_labor.min(bounded.assigned_labor);
        let priority = normalize_staffing_priority(bounded.priority);
        buckets[(priority - CONSTRUCTION_PRIORITY_LOW) as usize]
            .push((bounded, bounded.assigned_labor));
    }
    for bucket in &mut buckets {
        bucket.sort_unstable_by_key(|(site, _)| site.building_id);
    }

    let mut labor_remaining = available_labor;
    let mut recalled_workers = 0;
    let mut called_workers = 0;

    for destination_index in (0..buckets.len()).rev() {
        let vacancies = buckets[destination_index]
            .iter()
            .map(|(site, _)| site.max_labor.saturating_sub(site.assigned_labor))
            .sum::<u32>();
        if vacancies == 0 {
            continue;
        }

        let mut recall_needed = vacancies.saturating_sub(labor_remaining);
        if recall_needed > 0 {
            for donor_index in 0..destination_index {
                for (donor, _) in buckets[donor_index].iter_mut().rev() {
                    if recall_needed == 0 {
                        break;
                    }
                    let released = donor
                        .assigned_labor
                        .saturating_sub(donor.minimum_labor)
                        .min(recall_needed);
                    donor.assigned_labor -= released;
                    recall_needed -= released;
                    labor_remaining += released;
                    recalled_workers += released;
                }
                if recall_needed == 0 {
                    break;
                }
            }
        }

        while labor_remaining > 0 {
            let mut assigned_this_pass = false;
            for (site, _) in &mut buckets[destination_index] {
                if labor_remaining == 0 {
                    break;
                }
                if site.assigned_labor >= site.max_labor {
                    continue;
                }
                site.assigned_labor += 1;
                labor_remaining -= 1;
                called_workers += 1;
                assigned_this_pass = true;
            }
            if !assigned_this_pass {
                break;
            }
        }
    }

    let mut targets = buckets
        .into_iter()
        .flatten()
        .filter(|(site, original_labor)| site.assigned_labor != *original_labor)
        .map(|(site, _)| (site.building_id, site.assigned_labor))
        .collect::<Vec<_>>();
    targets.sort_unstable_by_key(|(building_id, _)| *building_id);
    YearRoundLaborRotation {
        targets,
        recalled_workers,
        called_workers,
    }
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use super::*;

    #[test]
    fn specialized_workplaces_and_command_clerks_keep_their_own_controls() {
        for kind in [
            "town_hall",
            "foragers_shed",
            "fishing_camp",
            "threshing_barn",
            "apiary",
            "watermill",
            "windmill",
            "bakery",
            "brewery",
            "smokehouse",
            "weaver",
            "stone_quarry",
            "large_quarry",
            "mine",
            "hunters_hall",
        ] {
            assert!(!is_year_round_labor_kind(kind), "{kind}");
        }
        for kind in [
            "chapel",
            "well",
            "lumber_mill",
            "guardhouse",
            "carpenter",
            "granary",
        ] {
            assert!(is_year_round_labor_kind(kind), "{kind}");
        }
    }

    #[test]
    fn free_labor_round_robins_in_stable_order_regardless_of_legacy_priority() {
        let rotation = year_round_labor_rotation(
            &[
                site(30, CONSTRUCTION_PRIORITY_NORMAL, 0, 2),
                site(20, CONSTRUCTION_PRIORITY_URGENT, 0, 3),
                site(10, CONSTRUCTION_PRIORITY_URGENT, 0, 3),
                site(40, CONSTRUCTION_PRIORITY_LOW, 0, 4),
            ],
            3,
        );
        assert_eq!(rotation.targets, vec![(10, 1), (20, 1), (30, 1)]);
        assert_eq!(rotation.recalled_workers, 0);
        assert_eq!(rotation.called_workers, 3);
    }

    #[test]
    fn full_employment_does_not_churn_crews_by_legacy_priority() {
        let rotation = year_round_labor_rotation(
            &[
                site(10, CONSTRUCTION_PRIORITY_URGENT, 1, 3),
                site(20, CONSTRUCTION_PRIORITY_NORMAL, 2, 2),
                site(30, CONSTRUCTION_PRIORITY_LOW, 3, 3),
                site(40, CONSTRUCTION_PRIORITY_LOW, 1, 2),
            ],
            0,
        );
        assert!(rotation.targets.is_empty());
        assert_eq!(rotation.recalled_workers, 0);
        assert_eq!(rotation.called_workers, 0);
    }

    #[test]
    fn legacy_priority_does_not_trigger_cross_worksite_reassignment() {
        let rotation = year_round_labor_rotation(
            &[
                site(10, CONSTRUCTION_PRIORITY_URGENT, 0, 2),
                site(20, CONSTRUCTION_PRIORITY_NORMAL, 2, 2),
                site(30, CONSTRUCTION_PRIORITY_LOW, 2, 2),
                site(40, CONSTRUCTION_PRIORITY_LOW, 2, 2),
            ],
            0,
        );
        assert!(rotation.targets.is_empty());
        assert_eq!(rotation.recalled_workers, 0);
        assert_eq!(rotation.called_workers, 0);
    }

    #[test]
    fn in_transit_cart_crews_cannot_fund_another_workplace() {
        let mut cart_source = site(30, CONSTRUCTION_PRIORITY_LOW, 2, 2);
        cart_source.minimum_labor = 2;
        let rotation = year_round_labor_rotation(
            &[site(10, CONSTRUCTION_PRIORITY_URGENT, 0, 2), cart_source],
            0,
        );

        assert!(rotation.targets.is_empty());
        assert_eq!(rotation.recalled_workers, 0);
        assert_eq!(rotation.called_workers, 0);
    }

    #[test]
    fn equal_priority_crews_are_not_reshuffled() {
        let rotation = year_round_labor_rotation(
            &[
                site(10, CONSTRUCTION_PRIORITY_NORMAL, 0, 3),
                site(20, CONSTRUCTION_PRIORITY_NORMAL, 3, 3),
            ],
            0,
        );
        assert_eq!(
            rotation,
            YearRoundLaborRotation {
                targets: Vec::new(),
                recalled_workers: 0,
                called_workers: 0,
            }
        );
    }

    #[test]
    fn legacy_priority_is_normal_and_targets_never_exceed_capacity() {
        let rotation = year_round_labor_rotation(
            &[site(10, 0, 1, 2), site(20, CONSTRUCTION_PRIORITY_LOW, 1, 4)],
            10,
        );
        assert_eq!(rotation.targets, vec![(10, 2), (20, 4)]);
        assert_eq!(rotation.recalled_workers, 0);
        assert_eq!(rotation.called_workers, 4);
    }

    #[test]
    fn large_full_employment_rotation_stays_interactive() {
        let sites = (0..100_000u64)
            .map(|building_id| {
                if building_id % 2 == 0 {
                    site(building_id, CONSTRUCTION_PRIORITY_URGENT, 0, 3)
                } else {
                    site(building_id, CONSTRUCTION_PRIORITY_LOW, 1, 3)
                }
            })
            .collect::<Vec<_>>();
        let started = Instant::now();
        let rotation = year_round_labor_rotation(&sites, 0);
        assert_eq!(rotation.recalled_workers, 0);
        assert_eq!(rotation.called_workers, 0);
        assert!(rotation.targets.is_empty());
        assert!(
            started.elapsed() < Duration::from_millis(250),
            "100k year-round worksite rotation should remain comfortably interactive"
        );
    }

    fn site(
        building_id: u64,
        priority: u8,
        assigned_labor: u32,
        max_labor: u32,
    ) -> YearRoundLaborSite {
        YearRoundLaborSite {
            building_id,
            priority,
            assigned_labor,
            minimum_labor: 0,
            max_labor,
        }
    }
}
