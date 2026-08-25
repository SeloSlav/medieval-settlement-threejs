//! Pure draft-ox assignment and throughput rules.
//!
//! The database adapter supplies only operational, owner-matched candidates.
//! Keeping the matching policy free of SpacetimeDB types makes its ordering and
//! capacity rules host-testable and keeps the client contract explicit.

/// Every workplace whose workers may be accompanied by a stable ox. The final
/// three entries are logistics-only; the rest may receive a production boost.
pub const OX_SUPPORTED_WORKPLACE_KINDS: &[&str] = &[
    "lumber_mill",
    "reforester",
    "woodcutters_lodge",
    "stone_quarry",
    "large_quarry",
    "mine",
    "clay_pit",
    "charcoal_burner",
    "threshing_barn",
    "pastoral_farmstead",
    "swineherd",
    "carpenter",
    "village_storehouse",
    "granary",
    "trading_post",
];

pub fn is_ox_supported_workplace(kind: &str) -> bool {
    OX_SUPPORTED_WORKPLACE_KINDS.contains(&kind)
}

pub fn is_ox_production_workplace(kind: &str) -> bool {
    is_ox_supported_workplace(kind)
        && !matches!(kind, "village_storehouse" | "granary" | "trading_post")
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct OxCandidate {
    pub ox_id: u64,
    pub stable_id: u64,
    pub stable_slot: u8,
    pub x: f64,
    pub z: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct OxWorksiteCandidate {
    pub building_id: u64,
    pub x: f64,
    pub z: f64,
    pub worker_slots: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct OxWorkAssignment {
    pub ox_id: u64,
    pub building_id: u64,
    pub worker_slot: u32,
}

#[derive(Clone, Copy)]
struct OpenWorkerSlot {
    building_id: u64,
    worker_slot: u32,
    x: f64,
    z: f64,
    claimed: bool,
}

fn unavailable(ox_id: u64, unavailable_ox_ids: &[u64]) -> bool {
    unavailable_ox_ids.contains(&ox_id)
}

/// Assigns every available ox, in stable/bay order, to its nearest remaining
/// worker slot. Worksite id and worker slot make equal-distance choices stable.
/// Active-trip and already-used ox ids are supplied in `unavailable_ox_ids`.
pub fn assign_oxen_to_nearest_worksites(
    oxen: &[OxCandidate],
    worksites: &[OxWorksiteCandidate],
    unavailable_ox_ids: &[u64],
) -> Vec<OxWorkAssignment> {
    let mut ordered_oxen: Vec<OxCandidate> = oxen
        .iter()
        .copied()
        .filter(|ox| !unavailable(ox.ox_id, unavailable_ox_ids))
        .collect();
    ordered_oxen.sort_by_key(|ox| (ox.stable_id, ox.stable_slot, ox.ox_id));

    let mut slots = Vec::new();
    let mut ordered_worksites = worksites.to_vec();
    ordered_worksites.sort_by_key(|worksite| worksite.building_id);
    for worksite in ordered_worksites {
        for worker_slot in 0..worksite.worker_slots {
            slots.push(OpenWorkerSlot {
                building_id: worksite.building_id,
                worker_slot,
                x: worksite.x,
                z: worksite.z,
                claimed: false,
            });
        }
    }

    let mut assignments = Vec::with_capacity(ordered_oxen.len().min(slots.len()));
    for ox in ordered_oxen {
        let selected = slots
            .iter()
            .enumerate()
            .filter(|(_, slot)| !slot.claimed)
            .min_by(|(_, left), (_, right)| {
                let left_distance = (left.x - ox.x).powi(2) + (left.z - ox.z).powi(2);
                let right_distance = (right.x - ox.x).powi(2) + (right.z - ox.z).powi(2);
                left_distance
                    .total_cmp(&right_distance)
                    .then_with(|| left.building_id.cmp(&right.building_id))
                    .then_with(|| left.worker_slot.cmp(&right.worker_slot))
            })
            .map(|(index, _)| index);
        let Some(slot_index) = selected else {
            break;
        };
        let slot = &mut slots[slot_index];
        slot.claimed = true;
        assignments.push(OxWorkAssignment {
            ox_id: ox.ox_id,
            building_id: slot.building_id,
            worker_slot: slot.worker_slot,
        });
    }
    assignments
}

/// Picks the nearest unreserved ox for a local cart. Stable/bay/id ordering is
/// the deterministic tie-break, matching production assignment identity.
pub fn nearest_available_ox(
    oxen: &[OxCandidate],
    unavailable_ox_ids: &[u64],
    x: f64,
    z: f64,
) -> Option<u64> {
    oxen.iter()
        .filter(|ox| !unavailable(ox.ox_id, unavailable_ox_ids))
        .min_by(|left, right| {
            let left_distance = (left.x - x).powi(2) + (left.z - z).powi(2);
            let right_distance = (right.x - x).powi(2) + (right.z - z).powi(2);
            left_distance
                .total_cmp(&right_distance)
                .then_with(|| left.stable_id.cmp(&right.stable_id))
                .then_with(|| left.stable_slot.cmp(&right.stable_slot))
                .then_with(|| left.ox_id.cmp(&right.ox_id))
        })
        .map(|ox| ox.ox_id)
}

/// An ox doubles one worker, never more workers than are actually present.
pub fn ox_amplified_worker_count(human_workers: u32, paired_oxen: u32) -> u32 {
    human_workers.saturating_add(paired_oxen.min(human_workers))
}

/// Draft animals expand local cart capacity without becoming crew members.
/// Delivery speed and unload time continue to use `human_workers` alone.
pub fn ox_amplified_cart_capacity(per_worker_amount: f64, human_workers: u32, ox_id: u64) -> f64 {
    let capacity_workers = human_workers.saturating_add(u32::from(ox_id != 0));
    per_worker_amount.max(0.0) * f64::from(capacity_workers)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ox(ox_id: u64, stable_id: u64, stable_slot: u8, x: f64, z: f64) -> OxCandidate {
        OxCandidate {
            ox_id,
            stable_id,
            stable_slot,
            x,
            z,
        }
    }

    #[test]
    fn supported_scope_keeps_logistics_out_of_production() {
        assert!(is_ox_supported_workplace("village_storehouse"));
        assert!(is_ox_supported_workplace("granary"));
        assert!(is_ox_supported_workplace("trading_post"));
        assert!(!is_ox_production_workplace("village_storehouse"));
        assert!(is_ox_production_workplace("lumber_mill"));
        assert!(!is_ox_supported_workplace("smithy"));
    }

    #[test]
    fn nearest_assignment_is_one_ox_per_worker_slot() {
        let assignments = assign_oxen_to_nearest_worksites(
            &[
                ox(11, 100, 0, 0.0, 0.0),
                ox(12, 100, 1, 0.0, 0.0),
                ox(21, 200, 0, 100.0, 0.0),
            ],
            &[
                OxWorksiteCandidate {
                    building_id: 40,
                    x: 5.0,
                    z: 0.0,
                    worker_slots: 1,
                },
                OxWorksiteCandidate {
                    building_id: 50,
                    x: 90.0,
                    z: 0.0,
                    worker_slots: 2,
                },
            ],
            &[],
        );
        assert_eq!(
            assignments,
            vec![
                OxWorkAssignment {
                    ox_id: 11,
                    building_id: 40,
                    worker_slot: 0,
                },
                OxWorkAssignment {
                    ox_id: 12,
                    building_id: 50,
                    worker_slot: 0,
                },
                OxWorkAssignment {
                    ox_id: 21,
                    building_id: 50,
                    worker_slot: 1,
                },
            ]
        );
    }

    #[test]
    fn active_trip_reservations_win_before_production_assignment() {
        let assignments = assign_oxen_to_nearest_worksites(
            &[ox(1, 10, 0, 0.0, 0.0), ox(2, 10, 1, 0.0, 0.0)],
            &[OxWorksiteCandidate {
                building_id: 20,
                x: 1.0,
                z: 0.0,
                worker_slots: 2,
            }],
            &[1],
        );
        assert_eq!(assignments.len(), 1);
        assert_eq!(assignments[0].ox_id, 2);
        assert_eq!(assignments[0].worker_slot, 0);
    }

    #[test]
    fn stable_identity_breaks_equal_distance_haul_ties() {
        let oxen = [
            ox(20, 8, 1, -2.0, 0.0),
            ox(10, 8, 0, 2.0, 0.0),
            ox(5, 7, 2, 0.0, 2.0),
        ];
        assert_eq!(nearest_available_ox(&oxen, &[], 0.0, 0.0), Some(5));
        assert_eq!(nearest_available_ox(&oxen, &[5], 0.0, 0.0), Some(10));
    }

    #[test]
    fn one_ox_doubles_one_worker_without_multiplying_the_whole_crew() {
        assert_eq!(ox_amplified_worker_count(1, 1), 2);
        assert_eq!(ox_amplified_worker_count(3, 1), 4);
        assert_eq!(ox_amplified_worker_count(2, 8), 4);
        assert_eq!(ox_amplified_worker_count(0, 1), 0);
    }

    #[test]
    fn one_cart_ox_adds_one_workers_capacity_only() {
        assert_eq!(ox_amplified_cart_capacity(12.0, 1, 0), 12.0);
        assert_eq!(ox_amplified_cart_capacity(12.0, 1, 77), 24.0);
        assert_eq!(ox_amplified_cart_capacity(12.0, 3, 77), 48.0);
    }
}
