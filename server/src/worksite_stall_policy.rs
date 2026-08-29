//! Shared policy and spatial lookup for explicit stalled-worksite recalls.
//!
//! This stays independent of SpacetimeDB row types so the native logic crate
//! can verify the authoritative reducer's safety and scaling rules.

use std::collections::HashMap;

use crate::brewery_recipe_policy::{
    normalize_brewery_recipe_policy, BREWERY_RECIPE_AUTO, BREWERY_RECIPE_CIDER,
    BREWERY_RECIPE_MEAD, BREWERY_RECIPE_PEAR_CIDER,
};
use crate::smokehouse_recipe_policy::{
    normalize_smokehouse_recipe_policy, SMOKEHOUSE_RECIPE_AUTO, SMOKEHOUSE_RECIPE_CHEESE,
    SMOKEHOUSE_RECIPE_CURED_MEAT, SMOKEHOUSE_RECIPE_SMOKED_FISH,
};
use crate::weaver_input_policy::{
    normalize_weaver_input_policy, WEAVER_INPUT_POLICY_AUTO, WEAVER_INPUT_POLICY_FLAX_FIRST,
    WEAVER_INPUT_POLICY_WOOL_FIRST,
};

pub const WORKSITE_SPATIAL_BUCKET_SIZE: f64 = 96.0;
pub const RICH_DEPOSIT_CENTER_TOLERANCE: f64 = 2.5;

/// Stock-or-inbound availability for processors whose valid recipes contain
/// alternatives. Keeping this policy outside the reducer makes authoritative
/// labor recall testable without SpacetimeDB host imports.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct ProcessorRecipeAvailability {
    pub rye_grain: bool,
    pub maslin_grain: bool,
    pub rye_flour: bool,
    pub maslin_flour: bool,
    pub barley: bool,
    pub malt: bool,
    pub water: bool,
    pub firewood: bool,
    pub apples: bool,
    pub pears: bool,
    pub honey: bool,
    pub food: bool,
    pub meat: bool,
    pub fish: bool,
    pub milk: bool,
    pub salt: bool,
    pub pottery: bool,
    pub wool: bool,
    pub flax: bool,
    pub yarn: bool,
    pub linen: bool,
}

/// Returns `Some` for processors with alternative recipes and `None` for
/// ordinary all-input recipes. A processor is ready when any complete recipe
/// can run; a reducer can call this once for on-site stock and again after
/// merging matching inbound carts to distinguish a stall from recovery.
pub fn alternative_processor_recipe_ready(
    kind: &str,
    recipe_policy: u8,
    available: ProcessorRecipeAvailability,
) -> Option<bool> {
    let ale_ready = (available.barley || available.malt) && available.water && available.firewood;
    let cider_ready = available.apples;
    let pear_cider_ready = available.pears;
    let mead_ready = available.honey;

    match kind {
        "watermill" | "windmill" => Some(available.rye_grain || available.maslin_grain),
        "bakery" => Some(
            (available.rye_flour || available.maslin_flour)
                && available.water
                && available.firewood,
        ),
        "brewery" => Some(
            match normalize_brewery_recipe_policy(recipe_policy) {
                BREWERY_RECIPE_CIDER => cider_ready,
                BREWERY_RECIPE_PEAR_CIDER => pear_cider_ready,
                BREWERY_RECIPE_MEAD => mead_ready,
                BREWERY_RECIPE_AUTO => ale_ready || cider_ready || pear_cider_ready || mead_ready,
                _ => ale_ready,
            },
        ),
        "smokehouse" => Some({
            let recipe_ready = match normalize_smokehouse_recipe_policy(recipe_policy) {
                SMOKEHOUSE_RECIPE_CURED_MEAT => available.meat,
                SMOKEHOUSE_RECIPE_SMOKED_FISH => available.fish,
                SMOKEHOUSE_RECIPE_CHEESE => available.milk,
                SMOKEHOUSE_RECIPE_AUTO => available.meat || available.fish || available.milk,
                _ => unreachable!("smokehouse recipe policy is normalized"),
            };
            recipe_ready && available.firewood && available.salt
        }),
        "spinning_retting_house" => Some(match normalize_weaver_input_policy(recipe_policy) {
            WEAVER_INPUT_POLICY_WOOL_FIRST => available.wool,
            WEAVER_INPUT_POLICY_FLAX_FIRST => available.flax && available.water,
            WEAVER_INPUT_POLICY_AUTO => available.wool || (available.flax && available.water),
            _ => unreachable!("textile recipe policy is normalized"),
        }),
        "weaver" => Some(match normalize_weaver_input_policy(recipe_policy) {
            WEAVER_INPUT_POLICY_WOOL_FIRST => available.yarn,
            WEAVER_INPUT_POLICY_FLAX_FIRST => available.linen,
            WEAVER_INPUT_POLICY_AUTO => available.yarn || available.linen,
            _ => unreachable!("textile recipe policy is normalized"),
        }),
        _ => None,
    }
}

pub fn is_production_labor_kind(kind: &str) -> bool {
    matches!(
        kind,
        "watermill"
            | "windmill"
            | "bakery"
            | "brewery"
            | "smokehouse"
            | "spinning_retting_house"
            | "weaver"
            | "stone_quarry"
            | "large_quarry"
            | "mine"
            | "charcoal_burner"
            | "smithy"
            | "potter_kiln"
            | "chandlery"
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

    pub fn nearest_usable_within_radius(
        &self,
        x: f64,
        z: f64,
        radius: f64,
        mut is_relevant: impl FnMut(&T) -> bool,
        mut is_usable: impl FnMut(&T) -> bool,
    ) -> Option<(&T, f64)> {
        let safe_radius = radius.max(0.0);
        let radius_sq = safe_radius * safe_radius;
        let min_cell_x = ((x - safe_radius) / WORKSITE_SPATIAL_BUCKET_SIZE).floor() as i32;
        let max_cell_x = ((x + safe_radius) / WORKSITE_SPATIAL_BUCKET_SIZE).floor() as i32;
        let min_cell_z = ((z - safe_radius) / WORKSITE_SPATIAL_BUCKET_SIZE).floor() as i32;
        let max_cell_z = ((z + safe_radius) / WORKSITE_SPATIAL_BUCKET_SIZE).floor() as i32;
        let mut nearest: Option<(&T, f64)> = None;

        for cell_x in min_cell_x..=max_cell_x {
            for cell_z in min_cell_z..=max_cell_z {
                let Some(bucket) = self.buckets.get(&(cell_x, cell_z)) else {
                    continue;
                };
                for candidate in bucket {
                    if !is_relevant(&candidate.value) || !is_usable(&candidate.value) {
                        continue;
                    }
                    let distance_sq = (candidate.x - x).powi(2) + (candidate.z - z).powi(2);
                    if distance_sq > radius_sq
                        || nearest.is_some_and(|(_, nearest_sq)| distance_sq >= nearest_sq)
                    {
                        continue;
                    }
                    nearest = Some((&candidate.value, distance_sq));
                }
            }
        }

        nearest
    }
}

fn spatial_cell(x: f64, z: f64) -> (i32, i32) {
    (
        (x / WORKSITE_SPATIAL_BUCKET_SIZE).floor() as i32,
        (z / WORKSITE_SPATIAL_BUCKET_SIZE).floor() as i32,
    )
}

/// Returns a lower labor target only when a site is authoritatively stalled.
/// Matching inbound supply protects a recovering site. Stored output and carts
/// do not retain production workers because logistics labor handles them.
pub fn stalled_labor_target(
    assigned_labor: u32,
    stalled: bool,
    supply_en_route: bool,
    _has_dispatch_duty: bool,
) -> Option<u32> {
    if assigned_labor == 0 || !stalled || supply_en_route {
        return None;
    }
    let target = 0;
    (target < assigned_labor).then_some(target)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::brewery_recipe_policy::{
        BREWERY_RECIPE_ALE, BREWERY_RECIPE_AUTO, BREWERY_RECIPE_CIDER,
    };
    use std::cell::Cell;

    #[derive(Clone, Copy)]
    struct TestSource {
        remaining: f64,
    }

    #[test]
    fn recall_preserves_recovering_sites_but_not_dispatchers() {
        assert_eq!(stalled_labor_target(3, true, false, false), Some(0));
        assert_eq!(stalled_labor_target(3, true, false, true), Some(0));
        assert_eq!(stalled_labor_target(1, true, false, true), Some(0));
        assert_eq!(stalled_labor_target(3, true, true, false), None);
        assert_eq!(stalled_labor_target(3, false, false, false), None);
    }

    #[test]
    fn source_bound_producers_share_the_explicit_production_labor_control() {
        for kind in [
            "watermill",
            "windmill",
            "bakery",
            "brewery",
            "smokehouse",
            "spinning_retting_house",
            "weaver",
            "stone_quarry",
            "large_quarry",
            "mine",
            "charcoal_burner",
            "smithy",
            "potter_kiln",
            "chandlery",
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
        buckets.insert(20.0, 0.0, TestSource { remaining: 7.0 });
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
        let (nearest, distance_sq) = buckets
            .nearest_usable_within_radius(
                0.0,
                0.0,
                50.0,
                |_| true,
                |source| source.remaining > 1e-6,
            )
            .expect("a usable source must be selected");
        assert_eq!(nearest.remaining, 7.0);
        assert_eq!(distance_sq, 400.0);
    }

    #[test]
    fn alternative_recipes_require_one_complete_attainable_path() {
        let maslin_mill = ProcessorRecipeAvailability {
            maslin_grain: true,
            ..Default::default()
        };
        assert_eq!(
            alternative_processor_recipe_ready("watermill", 0, maslin_mill),
            Some(true),
        );
        assert_eq!(
            alternative_processor_recipe_ready(
                "watermill",
                0,
                ProcessorRecipeAvailability::default(),
            ),
            Some(false),
        );

        let maslin_bakery = ProcessorRecipeAvailability {
            maslin_flour: true,
            water: true,
            firewood: true,
            ..Default::default()
        };
        assert_eq!(
            alternative_processor_recipe_ready("bakery", 0, maslin_bakery),
            Some(true),
        );
        assert_eq!(
            alternative_processor_recipe_ready(
                "bakery",
                0,
                ProcessorRecipeAvailability {
                    rye_flour: true,
                    water: true,
                    ..Default::default()
                },
            ),
            Some(false),
        );

        let typed_smokehouse = ProcessorRecipeAvailability {
            meat: true,
            firewood: true,
            salt: true,
            ..Default::default()
        };
        assert_eq!(
            alternative_processor_recipe_ready("smokehouse", 0, typed_smokehouse),
            Some(true),
        );
        assert_eq!(
            alternative_processor_recipe_ready(
                "smokehouse",
                SMOKEHOUSE_RECIPE_SMOKED_FISH,
                typed_smokehouse,
            ),
            Some(false),
        );
        assert_eq!(
            alternative_processor_recipe_ready(
                "spinning_retting_house",
                0,
                ProcessorRecipeAvailability {
                    flax: true,
                    water: true,
                    ..Default::default()
                },
            ),
            Some(true),
        );
        assert_eq!(
            alternative_processor_recipe_ready(
                "spinning_retting_house",
                WEAVER_INPUT_POLICY_WOOL_FIRST,
                ProcessorRecipeAvailability {
                    flax: true,
                    water: true,
                    ..Default::default()
                },
            ),
            Some(false),
        );
        assert_eq!(
            alternative_processor_recipe_ready(
                "weaver",
                0,
                ProcessorRecipeAvailability {
                    linen: true,
                    ..Default::default()
                },
            ),
            Some(true),
        );
        assert_eq!(
            alternative_processor_recipe_ready(
                "weaver",
                WEAVER_INPUT_POLICY_WOOL_FIRST,
                ProcessorRecipeAvailability {
                    linen: true,
                    ..Default::default()
                },
            ),
            Some(false),
        );
    }

    #[test]
    fn brewery_recipe_policy_does_not_invent_future_inputs() {
        let apples_only = ProcessorRecipeAvailability {
            apples: true,
            ..Default::default()
        };
        assert_eq!(
            alternative_processor_recipe_ready("brewery", BREWERY_RECIPE_CIDER, apples_only),
            Some(true),
        );
        assert_eq!(
            alternative_processor_recipe_ready("brewery", BREWERY_RECIPE_AUTO, apples_only),
            Some(true),
        );
        assert_eq!(
            alternative_processor_recipe_ready("brewery", BREWERY_RECIPE_ALE, apples_only),
            Some(false),
        );

        let malt_ale = ProcessorRecipeAvailability {
            malt: true,
            water: true,
            firewood: true,
            ..Default::default()
        };
        assert_eq!(
            alternative_processor_recipe_ready("brewery", BREWERY_RECIPE_ALE, malt_ale),
            Some(true),
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
