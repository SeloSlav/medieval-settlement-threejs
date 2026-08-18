use std::collections::BinaryHeap;

use crate::balance_generated::CONSTRUCTION_MAX_BUILDERS;
use crate::construction_priority::{CONSTRUCTION_PRIORITY_NORMAL, CONSTRUCTION_PRIORITY_URGENT};

/// Keep a small material-cart pipeline available when a new worksite opens.
/// One villager can be returning with the first empty cart while the other
/// starts the next material haul; without both, a five-person founding crew
/// appears to deadlock between stone and timber deliveries.
const INITIAL_CONSTRUCTION_HAULER_RESERVE: u32 = 2;

pub fn initial_construction_labor(available_labor: u32) -> u32 {
    if available_labor == 0 {
        return 0;
    }

    available_labor
        .saturating_sub(INITIAL_CONSTRUCTION_HAULER_RESERVE)
        .max(1)
        .min(CONSTRUCTION_MAX_BUILDERS)
}

/// Labor requests cannot increase a building beyond the settlement's current population.
pub fn population_limit_blocks_labor_request(
    current_labor: u32,
    requested_labor: u32,
    total_population: u32,
    assigned_elsewhere: u32,
) -> bool {
    requested_labor > current_labor
        && requested_labor > total_population.saturating_sub(assigned_elsewhere)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct LaborAssignment {
    pub building_id: u64,
    pub assigned_labor: u32,
    pub minimum_labor: u32,
    pub construction_complete: bool,
    pub priority: u8,
}

/// Returns only the building assignments that must change after population loss.
///
/// Construction crews are released before permanent jobs. Construction queue
/// priority remains relevant for unfinished sites; completed jobs share one
/// neutral automatic tier and release newer assignments before older ones.
pub fn labor_reconciliation_updates(
    assignments: Vec<LaborAssignment>,
    total_population: u32,
) -> Vec<(u64, u32)> {
    let total_assigned = assignments
        .iter()
        .map(|assignment| assignment.assigned_labor)
        .sum::<u32>();
    let mut excess = total_assigned.saturating_sub(total_population);
    if excess == 0 {
        return Vec::new();
    }

    let mut targets = assignments
        .iter()
        .map(|assignment| assignment.assigned_labor)
        .collect::<Vec<_>>();
    let mut bucket_members: [Vec<usize>; 8] = std::array::from_fn(|_| Vec::new());
    for (index, assignment) in assignments.iter().enumerate() {
        let group = usize::from(assignment.construction_complete);
        let priority = effective_labor_priority(*assignment) as usize;
        bucket_members[group * 4 + priority].push(index);
    }
    let mut changed = vec![false; assignments.len()];
    let mut changed_order = Vec::new();
    release_labor_by_priority(
        &assignments,
        &mut targets,
        &bucket_members,
        &mut excess,
        false,
        &mut changed,
        &mut changed_order,
    );

    // If every worker who is physically at a workplace has already been
    // released, mark in-transit cart crews for release on return. The database
    // adapter moves that portion into the trip reservation, so it remains
    // committed until the cart row disappears instead of becoming free early.
    if excess > 0 {
        release_labor_by_priority(
            &assignments,
            &mut targets,
            &bucket_members,
            &mut excess,
            true,
            &mut changed,
            &mut changed_order,
        );
    }
    changed_order
        .into_iter()
        .map(|index| (assignments[index].building_id, targets[index]))
        .collect()
}

#[allow(clippy::too_many_arguments)]
fn release_labor_by_priority(
    assignments: &[LaborAssignment],
    targets: &mut [u32],
    bucket_members: &[Vec<usize>; 8],
    excess: &mut u32,
    include_cart_floor: bool,
    changed: &mut [bool],
    changed_order: &mut Vec<usize>,
) {
    for members in bucket_members {
        if *excess == 0 {
            return;
        }
        // Heap construction is linear. Population loss normally releases only
        // a few people, so we avoid sorting an entire 100k-building settlement
        // merely to find the newest entries in the first eligible bucket.
        let mut newest = BinaryHeap::from(
            members
                .iter()
                .map(|index| (assignments[*index].building_id, *index))
                .collect::<Vec<_>>(),
        );
        while let Some((_building_id, index)) = newest.pop() {
            if *excess == 0 {
                return;
            }
            let assignment = assignments[index];
            let available = if include_cart_floor {
                targets[index].min(assignment.minimum_labor)
            } else {
                targets[index].saturating_sub(assignment.minimum_labor)
            };
            let released = available.min(*excess);
            if released == 0 {
                continue;
            }
            targets[index] -= released;
            *excess -= released;
            if !changed[index] {
                changed[index] = true;
                changed_order.push(index);
            }
        }
    }
}

fn effective_labor_priority(assignment: LaborAssignment) -> u8 {
    if assignment.construction_complete {
        return CONSTRUCTION_PRIORITY_NORMAL;
    }
    assignment.priority.min(CONSTRUCTION_PRIORITY_URGENT)
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use super::{
        initial_construction_labor, labor_reconciliation_updates,
        population_limit_blocks_labor_request, LaborAssignment, CONSTRUCTION_MAX_BUILDERS,
    };

    #[test]
    fn new_construction_preserves_an_early_material_cart_pipeline() {
        assert_eq!(initial_construction_labor(0), 0);
        assert_eq!(initial_construction_labor(1), 1);
        assert_eq!(initial_construction_labor(2), 1);
        assert_eq!(initial_construction_labor(4), 2);
        assert_eq!(initial_construction_labor(5), 3);
        assert_eq!(initial_construction_labor(6), CONSTRUCTION_MAX_BUILDERS);
        assert_eq!(initial_construction_labor(20), CONSTRUCTION_MAX_BUILDERS);
    }

    #[test]
    fn overassigned_settlements_can_reduce_building_labor() {
        assert!(!population_limit_blocks_labor_request(2, 1, 5, 6));
        assert!(!population_limit_blocks_labor_request(2, 0, 5, 6));
        assert!(!population_limit_blocks_labor_request(2, 2, 5, 6));
    }

    #[test]
    fn population_limit_still_blocks_labor_increases() {
        assert!(population_limit_blocks_labor_request(2, 3, 5, 6));
        assert!(population_limit_blocks_labor_request(1, 2, 5, 4));
        assert!(!population_limit_blocks_labor_request(1, 2, 6, 4));
    }

    #[test]
    fn population_loss_releases_construction_then_newest_productive_labor() {
        let updates = labor_reconciliation_updates(
            vec![
                LaborAssignment {
                    building_id: 10,
                    assigned_labor: 3,
                    minimum_labor: 0,
                    construction_complete: true,
                    priority: 2,
                },
                LaborAssignment {
                    building_id: 20,
                    assigned_labor: 2,
                    minimum_labor: 0,
                    construction_complete: true,
                    priority: 2,
                },
                LaborAssignment {
                    building_id: 30,
                    assigned_labor: 4,
                    minimum_labor: 0,
                    construction_complete: false,
                    priority: 2,
                },
            ],
            4,
        );

        assert_eq!(updates, vec![(30, 0), (20, 1)]);
    }

    #[test]
    fn valid_assignments_are_left_untouched() {
        assert!(labor_reconciliation_updates(
            vec![LaborAssignment {
                building_id: 10,
                assigned_labor: 2,
                minimum_labor: 0,
                construction_complete: true,
                priority: 2,
            }],
            5,
        )
        .is_empty());
    }

    #[test]
    fn population_loss_ignores_legacy_job_priority_and_releases_newest_first() {
        let updates = labor_reconciliation_updates(
            vec![
                LaborAssignment {
                    building_id: 10,
                    assigned_labor: 2,
                    minimum_labor: 0,
                    construction_complete: true,
                    priority: 1,
                },
                LaborAssignment {
                    building_id: 20,
                    assigned_labor: 2,
                    minimum_labor: 0,
                    construction_complete: true,
                    priority: 2,
                },
                LaborAssignment {
                    building_id: 30,
                    assigned_labor: 2,
                    minimum_labor: 0,
                    construction_complete: true,
                    priority: 3,
                },
            ],
            4,
        );

        assert_eq!(updates, vec![(30, 0)]);
    }

    #[test]
    fn construction_crews_still_release_before_permanent_low_priority_jobs() {
        let updates = labor_reconciliation_updates(
            vec![
                LaborAssignment {
                    building_id: 10,
                    assigned_labor: 2,
                    minimum_labor: 0,
                    construction_complete: true,
                    priority: 1,
                },
                LaborAssignment {
                    building_id: 20,
                    assigned_labor: 2,
                    minimum_labor: 0,
                    construction_complete: false,
                    priority: 3,
                },
            ],
            2,
        );

        assert_eq!(updates, vec![(20, 0)]);
    }

    #[test]
    fn population_loss_releases_on_site_workers_before_cart_crews() {
        let updates = labor_reconciliation_updates(
            vec![
                LaborAssignment {
                    building_id: 10,
                    assigned_labor: 2,
                    minimum_labor: 2,
                    construction_complete: true,
                    priority: 1,
                },
                LaborAssignment {
                    building_id: 20,
                    assigned_labor: 2,
                    minimum_labor: 0,
                    construction_complete: true,
                    priority: 2,
                },
            ],
            2,
        );

        assert_eq!(updates, vec![(20, 0)]);
    }

    #[test]
    fn unavoidable_cart_crew_release_is_deferred_until_return() {
        let updates = labor_reconciliation_updates(
            vec![LaborAssignment {
                building_id: 10,
                assigned_labor: 2,
                minimum_labor: 2,
                construction_complete: true,
                priority: 1,
            }],
            0,
        );

        assert_eq!(updates, vec![(10, 0)]);
    }

    #[test]
    fn legacy_zero_priority_on_completed_buildings_behaves_as_normal() {
        let updates = labor_reconciliation_updates(
            vec![
                LaborAssignment {
                    building_id: 10,
                    assigned_labor: 1,
                    minimum_labor: 0,
                    construction_complete: true,
                    priority: 0,
                },
                LaborAssignment {
                    building_id: 20,
                    assigned_labor: 1,
                    minimum_labor: 0,
                    construction_complete: true,
                    priority: 1,
                },
            ],
            1,
        );

        assert_eq!(updates, vec![(20, 0)]);
    }

    #[test]
    fn neutral_reconciliation_stays_bounded_at_large_settlement_scale() {
        let assignments = (0..100_000u64)
            .map(|building_id| LaborAssignment {
                building_id,
                assigned_labor: 1,
                minimum_labor: 0,
                construction_complete: true,
                priority: (building_id % 3 + 1) as u8,
            })
            .collect();
        let started = Instant::now();
        let updates = labor_reconciliation_updates(assignments, 99_900);
        let elapsed = started.elapsed();

        assert_eq!(updates.len(), 100);
        assert!(updates
            .iter()
            .all(|(building_id, labor)| { *building_id >= 99_900 && *labor == 0 }));
        assert!(
            elapsed < Duration::from_millis(250),
            "100k labor assignments should reconcile only during a rare population-loss event"
        );
    }
}
