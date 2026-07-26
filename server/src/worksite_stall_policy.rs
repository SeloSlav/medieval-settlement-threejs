//! Shared policy and spatial lookup for explicit stalled-worksite recalls.
//!
//! This stays independent of SpacetimeDB row types so the native logic crate
//! can verify the authoritative reducer's safety and scaling rules.

use std::collections::HashMap;

pub const WORKSITE_SPATIAL_BUCKET_SIZE: f64 = 96.0;
pub const RICH_DEPOSIT_CENTER_TOLERANCE: f64 = 2.5;

pub fn is_production_labor_kind(kind: &str) -> bool {
    matches!(
        kind,
        "watermill"
            | "granary"
            | "brewery"
            | "smokehouse"
            | "weaver"
            | "stone_quarry"
            | "large_quarry"
            | "hunters_hall"
    )
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct SourceState {
    pub relevant: bool,
    pub usable: bool,
}

struct Positioned<T> {
    x: f64,
    z: f64,
    value: T,
}

pub struct SpatialBuckets<T> {
    buckets: HashMap<(i32, i32), Vec<Positioned<T>>>,
}

impl<T> SpatialBuckets<T> {
    pub fn new() -> Self {
        Self {
            buckets: HashMap::new(),
        }
    }

    pub fn insert(&mut self, x: f64, z: f64, value: T) {
        self.buckets
            .entry(spatial_cell(x, z))
            .or_default()
            .push(Positioned { x, z, value });
    }

    pub fn source_state_within_radius(
        &self,
        x: f64,
        z: f64,
        radius: f64,
        mut is_relevant: impl FnMut(&T) -> bool,
        mut is_usable: impl FnMut(&T) -> bool,
    ) -> SourceState {
        let safe_radius = radius.max(0.0);
        let radius_sq = safe_radius * safe_radius;
        let min_cell_x = ((x - safe_radius) / WORKSITE_SPATIAL_BUCKET_SIZE).floor() as i32;
        let max_cell_x = ((x + safe_radius) / WORKSITE_SPATIAL_BUCKET_SIZE).floor() as i32;
        let min_cell_z = ((z - safe_radius) / WORKSITE_SPATIAL_BUCKET_SIZE).floor() as i32;
        let max_cell_z = ((z + safe_radius) / WORKSITE_SPATIAL_BUCKET_SIZE).floor() as i32;
        let mut relevant = false;

        for cell_x in min_cell_x..=max_cell_x {
            for cell_z in min_cell_z..=max_cell_z {
                let Some(bucket) = self.buckets.get(&(cell_x, cell_z)) else {
                    continue;
                };
                for candidate in bucket {
                    if !is_relevant(&candidate.value) {
                        continue;
                    }
                    let distance_sq = (candidate.x - x).powi(2) + (candidate.z - z).powi(2);
                    if distance_sq > radius_sq {
                        continue;
                    }
                    relevant = true;
                    if is_usable(&candidate.value) {
                        return SourceState {
                            relevant: true,
                            usable: true,
                        };
                    }
                }
            }
        }

        SourceState {
            relevant,
            usable: false,
        }
    }
}

fn spatial_cell(x: f64, z: f64) -> (i32, i32) {
    (
        (x / WORKSITE_SPATIAL_BUCKET_SIZE).floor() as i32,
        (z / WORKSITE_SPATIAL_BUCKET_SIZE).floor() as i32,
    )
}

/// Returns a lower labor target only when a site is authoritatively stalled.
/// Matching inbound supply protects a recovering site; stored output or an
/// already-active cart keeps one dispatcher.
pub fn stalled_labor_target(
    assigned_labor: u32,
    stalled: bool,
    supply_en_route: bool,
    has_dispatch_duty: bool,
) -> Option<u32> {
    if assigned_labor == 0 || !stalled || supply_en_route {
        return None;
    }
    let target = u32::from(has_dispatch_duty).min(assigned_labor);
    (target < assigned_labor).then_some(target)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[derive(Clone, Copy)]
    struct TestSource {
        remaining: f64,
    }

    #[test]
    fn recall_preserves_recovering_sites_and_one_dispatcher() {
        assert_eq!(stalled_labor_target(3, true, false, false), Some(0));
        assert_eq!(stalled_labor_target(3, true, false, true), Some(1));
        assert_eq!(stalled_labor_target(1, true, false, true), None);
        assert_eq!(stalled_labor_target(3, true, true, false), None);
        assert_eq!(stalled_labor_target(3, false, false, false), None);
    }

    #[test]
    fn source_bound_producers_share_the_explicit_production_labor_control() {
        for kind in [
            "watermill",
            "granary",
            "brewery",
            "smokehouse",
            "weaver",
            "stone_quarry",
            "large_quarry",
            "hunters_hall",
        ] {
            assert!(is_production_labor_kind(kind), "{kind}");
        }
        for kind in ["well", "chapel", "fishing_camp", "foragers_shed"] {
            assert!(!is_production_labor_kind(kind), "{kind}");
        }
    }

    #[test]
    fn spatial_lookup_distinguishes_absent_exhausted_and_usable_sources() {
        let mut buckets = SpatialBuckets::new();
        buckets.insert(-10.0, -10.0, TestSource { remaining: 0.0 });
        buckets.insert(40.0, 0.0, TestSource { remaining: 12.0 });

        assert_eq!(
            buckets.source_state_within_radius(
                -10.0,
                -10.0,
                5.0,
                |_| true,
                |source| source.remaining > 1e-6,
            ),
            SourceState {
                relevant: true,
                usable: false,
            },
        );
        assert_eq!(
            buckets.source_state_within_radius(
                0.0,
                0.0,
                50.0,
                |_| true,
                |source| source.remaining > 1e-6,
            ),
            SourceState {
                relevant: true,
                usable: true,
            },
        );
        assert_eq!(
            buckets.source_state_within_radius(
                500.0,
                500.0,
                20.0,
                |_| true,
                |source| source.remaining > 1e-6,
            ),
            SourceState::default(),
        );
    }

    #[test]
    fn distant_sources_do_not_turn_queries_into_global_scans() {
        let mut buckets = SpatialBuckets::new();
        for index in 0..20_000 {
            buckets.insert(index as f64 * 200.0, 0.0, TestSource { remaining: 1.0 });
        }
        let inspected = Cell::new(0usize);
        let state = buckets.source_state_within_radius(
            2_000_000.0,
            0.0,
            68.0,
            |_| {
                inspected.set(inspected.get() + 1);
                true
            },
            |source| source.remaining > 1e-6,
        );
        assert!(state.usable);
        assert!(
            inspected.get() < 8,
            "local spatial query inspected {} candidates",
            inspected.get(),
        );
    }
}
