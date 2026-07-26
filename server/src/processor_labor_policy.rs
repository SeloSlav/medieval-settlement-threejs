//! Explicit Town Hall call-up for managed production sites.
//!
//! Deployment is explicit, priority-aware, and round-robin within a tier; it
//! never displaces another crew. The reducer supplies only capacity-open
//! processors and source-ready extraction sites; settlement-wide stalled-site
//! recall lives in `worksite_stall_policy`.

use crate::construction_priority::{
    CONSTRUCTION_PRIORITY_LOW, CONSTRUCTION_PRIORITY_NORMAL, CONSTRUCTION_PRIORITY_URGENT,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ProcessorCallupCandidate {
    pub building_id: u64,
    pub priority: u8,
    pub assigned_labor: u32,
    pub max_labor: u32,
}

fn normalize_staffing_priority(priority: u8) -> u8 {
    match priority {
        CONSTRUCTION_PRIORITY_LOW | CONSTRUCTION_PRIORITY_NORMAL | CONSTRUCTION_PRIORITY_URGENT => {
            priority
        }
        _ => CONSTRUCTION_PRIORITY_NORMAL,
    }
}

/// Distributes free labor to reducer-approved production sites by staffing
/// priority. Equal-priority sites receive one worker per pass before any site
/// receives a second.
pub fn processor_callup_targets(
    candidates: &[ProcessorCallupCandidate],
    available_labor: u32,
) -> Vec<(u64, u32)> {
    let mut buckets: [Vec<(ProcessorCallupCandidate, u32)>; 3] =
        std::array::from_fn(|_| Vec::new());
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
    fn callup_fills_priority_before_round_robining_lower_tiers() {
        let targets = processor_callup_targets(
            &[
                ProcessorCallupCandidate {
                    building_id: 30,
                    priority: CONSTRUCTION_PRIORITY_NORMAL,
                    assigned_labor: 0,
                    max_labor: 3,
                },
                ProcessorCallupCandidate {
                    building_id: 20,
                    priority: CONSTRUCTION_PRIORITY_URGENT,
                    assigned_labor: 0,
                    max_labor: 3,
                },
                ProcessorCallupCandidate {
                    building_id: 10,
                    priority: CONSTRUCTION_PRIORITY_URGENT,
                    assigned_labor: 0,
                    max_labor: 3,
                },
            ],
            3,
        );
        assert_eq!(targets, vec![(10, 2), (20, 1)]);
    }

    #[test]
    fn legacy_priority_is_normal_and_targets_never_exceed_capacity() {
        let targets = processor_callup_targets(
            &[
                ProcessorCallupCandidate {
                    building_id: 10,
                    priority: 0,
                    assigned_labor: 1,
                    max_labor: 2,
                },
                ProcessorCallupCandidate {
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
    fn large_callup_plan_stays_interactive() {
        let candidates = (0..100_000u64)
            .map(|building_id| ProcessorCallupCandidate {
                building_id,
                priority: (building_id % 4) as u8,
                assigned_labor: 0,
                max_labor: 4,
            })
            .collect::<Vec<_>>();
        let started = Instant::now();
        let targets = processor_callup_targets(&candidates, 100_000);
        assert_eq!(
            targets.iter().map(|(_, target)| *target).sum::<u32>(),
            100_000
        );
        assert!(
            started.elapsed() < Duration::from_millis(250),
            "100k processor call-up sites should remain comfortably interactive"
        );
    }
}
