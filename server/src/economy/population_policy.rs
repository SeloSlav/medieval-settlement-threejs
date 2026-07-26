use crate::construction_priority::{CONSTRUCTION_PRIORITY_NORMAL, CONSTRUCTION_PRIORITY_URGENT};

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
    pub construction_complete: bool,
    pub priority: u8,
}

/// Returns only the building assignments that must change after population loss.
///
/// Construction crews are released before permanent jobs. Within each group,
/// low-priority work releases first, then normal and high; equal priorities
/// release newer assignments before older ones.
pub fn labor_reconciliation_updates(
    mut assignments: Vec<LaborAssignment>,
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

    assignments.sort_by(|a, b| {
        a.construction_complete
            .cmp(&b.construction_complete)
            .then_with(|| effective_labor_priority(*a).cmp(&effective_labor_priority(*b)))
            .then_with(|| b.building_id.cmp(&a.building_id))
    });

    let mut updates = Vec::new();
    for assignment in assignments {
        if excess == 0 {
            break;
        }
        let released = assignment.assigned_labor.min(excess);
        if released == 0 {
            continue;
        }
        updates.push((assignment.building_id, assignment.assigned_labor - released));
        excess -= released;
    }
    updates
}

fn effective_labor_priority(assignment: LaborAssignment) -> u8 {
    if assignment.construction_complete && assignment.priority == 0 {
        return CONSTRUCTION_PRIORITY_NORMAL;
    }
    assignment.priority.min(CONSTRUCTION_PRIORITY_URGENT)
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use super::{
        labor_reconciliation_updates, population_limit_blocks_labor_request, LaborAssignment,
    };

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
                    construction_complete: true,
                    priority: 2,
                },
                LaborAssignment {
                    building_id: 20,
                    assigned_labor: 2,
                    construction_complete: true,
                    priority: 2,
                },
                LaborAssignment {
                    building_id: 30,
                    assigned_labor: 4,
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
                construction_complete: true,
                priority: 2,
            }],
            5,
        )
        .is_empty());
    }

    #[test]
    fn population_loss_releases_low_priority_jobs_before_newer_essential_work() {
        let updates = labor_reconciliation_updates(
            vec![
                LaborAssignment {
                    building_id: 10,
                    assigned_labor: 2,
                    construction_complete: true,
                    priority: 1,
                },
                LaborAssignment {
                    building_id: 20,
                    assigned_labor: 2,
                    construction_complete: true,
                    priority: 2,
                },
                LaborAssignment {
                    building_id: 30,
                    assigned_labor: 2,
                    construction_complete: true,
                    priority: 3,
                },
            ],
            4,
        );

        assert_eq!(updates, vec![(10, 0)]);
    }

    #[test]
    fn construction_crews_still_release_before_permanent_low_priority_jobs() {
        let updates = labor_reconciliation_updates(
            vec![
                LaborAssignment {
                    building_id: 10,
                    assigned_labor: 2,
                    construction_complete: true,
                    priority: 1,
                },
                LaborAssignment {
                    building_id: 20,
                    assigned_labor: 2,
                    construction_complete: false,
                    priority: 3,
                },
            ],
            2,
        );

        assert_eq!(updates, vec![(20, 0)]);
    }

    #[test]
    fn legacy_zero_priority_on_completed_buildings_behaves_as_normal() {
        let updates = labor_reconciliation_updates(
            vec![
                LaborAssignment {
                    building_id: 10,
                    assigned_labor: 1,
                    construction_complete: true,
                    priority: 0,
                },
                LaborAssignment {
                    building_id: 20,
                    assigned_labor: 1,
                    construction_complete: true,
                    priority: 1,
                },
            ],
            1,
        );

        assert_eq!(updates, vec![(20, 0)]);
    }

    #[test]
    fn priority_reconciliation_stays_bounded_at_large_settlement_scale() {
        let assignments = (0..100_000u64)
            .map(|building_id| LaborAssignment {
                building_id,
                assigned_labor: 1,
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
            .all(|(building_id, labor)| { building_id % 3 == 0 && *labor == 0 }));
        assert!(
            elapsed < Duration::from_millis(250),
            "100k staffing priorities should reconcile only during a rare population-loss event"
        );
    }
}
