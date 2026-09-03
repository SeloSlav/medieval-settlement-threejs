//! Pure policy for staged residence improvement works.

use std::collections::HashSet;

use crate::balance_generated::HOUSEHOLD_PROJECT_WEALTH_RESERVE;
use crate::construction_priority::{
    construction_priority_bucket, CONSTRUCTION_PRIORITY_HOLD, CONSTRUCTION_PRIORITY_LEVELS,
};
use crate::resource_units::whole_units;
use crate::simulation::residence_needs::ResidenceNeedKind;

const EPSILON: f64 = 1e-6;

pub fn residence_project_active(
    target_tier: u8,
    current_tier: u8,
    backyard_project_kind: u8,
    fire_repair_active: bool,
    decay_repair_active: bool,
    roof_tile_retrofit_active: bool,
) -> bool {
    target_tier > current_tier
        || backyard_project_kind != 0
        || fire_repair_active
        || decay_repair_active
        || roof_tile_retrofit_active
}

/// Promotion proves the standards the household lives under today. Needs
/// introduced by the target tier do not become active until the physical
/// improvement works complete.
pub fn residence_promotion_needs(current_tier: u8) -> Vec<ResidenceNeedKind> {
    ResidenceNeedKind::ALL
        .into_iter()
        .filter(|kind| kind.is_active_for_tier(current_tier))
        .collect()
}

/// Physical goods already delivered to a household remain valid promotion
/// evidence even when the serving outlet has since emptied. Water and church
/// access deliberately stay route-backed ongoing services.
pub fn household_stock_satisfies_promotion_need(
    kind: ResidenceNeedKind,
    need_stock: f64,
    tier_one_food_ready: bool,
    current_food_standard_ready: bool,
    preserved_food_stock: f64,
    household_luxury_stock: f64,
) -> bool {
    match kind {
        ResidenceNeedKind::Water | ResidenceNeedKind::Church => false,
        ResidenceNeedKind::Food => tier_one_food_ready || need_stock > 1e-6,
        ResidenceNeedKind::FoodVariety => current_food_standard_ready,
        ResidenceNeedKind::SavoryPreserves => preserved_food_stock > 1e-6 || need_stock > 1e-6,
        ResidenceNeedKind::Luxury => household_luxury_stock > 1e-6 || need_stock > 1e-6,
        ResidenceNeedKind::Firewood
        | ResidenceNeedKind::Ale
        | ResidenceNeedKind::Cloth
        | ResidenceNeedKind::Shoes
        | ResidenceNeedKind::Pottery => need_stock > 1e-6,
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ResidenceUpgradeWork {
    pub progress: f64,
    pub required_timber: f64,
    pub required_stone: f64,
    pub required_gold: f64,
    pub required_roof_tiles: f64,
    pub delivered_timber: f64,
    pub delivered_stone: f64,
    pub delivered_gold: f64,
    pub delivered_roof_tiles: f64,
    pub assigned_labor: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ResidenceProjectLaborSite {
    pub residence_id: u64,
    pub priority: u8,
    pub assigned_labor: u32,
    pub work_ready: bool,
    pub inbound_supply: bool,
}

/// Split one already-rounded project total into whole-unit per-residence lots.
/// Floors are assigned first, then the remaining units go to the largest
/// fractional shares in stable parcel order. This preserves the zone cost
/// exactly without leaving a sub-unit reservation that no cart can carry.
pub fn allocate_whole_residence_project_costs(total_cost: f64, cost_weights: &[f64]) -> Vec<f64> {
    let total_units = whole_units(total_cost) as u64;
    if cost_weights.is_empty() {
        return Vec::new();
    }

    let weights = cost_weights
        .iter()
        .map(|weight| nonnegative(*weight))
        .collect::<Vec<_>>();
    let weight_total = weights.iter().sum::<f64>();
    if total_units == 0 || weight_total <= EPSILON {
        return vec![0.0; cost_weights.len()];
    }

    let mut allocated = Vec::with_capacity(weights.len());
    let mut remainders = Vec::with_capacity(weights.len());
    let mut allocated_units = 0u64;
    for (index, weight) in weights.into_iter().enumerate() {
        let exact = total_units as f64 * weight / weight_total;
        let base = exact.floor() as u64;
        allocated.push(base as f64);
        allocated_units = allocated_units.saturating_add(base);
        remainders.push((index, exact - base as f64));
    }

    remainders.sort_unstable_by(|left, right| {
        right
            .1
            .total_cmp(&left.1)
            .then_with(|| left.0.cmp(&right.0))
    });
    for (index, _) in remainders
        .into_iter()
        .take(total_units.saturating_sub(allocated_units) as usize)
    {
        allocated[index] += 1.0;
    }
    allocated
}

fn nonnegative(value: f64) -> f64 {
    if value.is_finite() {
        value.max(0.0)
    } else {
        0.0
    }
}

pub fn residence_upgrade_household_contribution(household_wealth: f64, gold_cost: f64) -> f64 {
    (nonnegative(household_wealth) - HOUSEHOLD_PROJECT_WEALTH_RESERVE)
        .max(0.0)
        .min(nonnegative(gold_cost))
}

pub fn residence_upgrade_material_readiness(work: ResidenceUpgradeWork) -> f64 {
    let required = nonnegative(work.required_timber)
        + nonnegative(work.required_stone)
        + nonnegative(work.required_roof_tiles);
    if required <= EPSILON {
        return 1.0;
    }
    let delivered = nonnegative(work.delivered_timber)
        + nonnegative(work.delivered_stone)
        + nonnegative(work.delivered_roof_tiles);
    (delivered / required).clamp(0.0, 1.0)
}

pub fn residence_upgrade_is_paid(work: ResidenceUpgradeWork) -> bool {
    nonnegative(work.delivered_gold) + EPSILON >= nonnegative(work.required_gold)
}

/// A residence builder should hold a work slot only while paid, delivered
/// material is ahead of the authored frame. When the frame catches up, the
/// worker returns to the free pool so the same settlement can run the next
/// material cart instead of deadlocking with an idle builder.
pub fn residence_upgrade_work_ready(work: ResidenceUpgradeWork) -> bool {
    residence_upgrade_is_paid(work)
        && nonnegative(work.progress).min(1.0) + EPSILON
            < residence_upgrade_material_readiness(work)
}

/// Rebalances the one-builder household-project slots without consuming labor
/// at an empty worksite. Existing productive or inbound-waiting builders are
/// kept within their priority tier before a new commute starts, while a higher
/// priority project may still preempt a lower tier.
pub fn residence_project_labor_targets(
    sites: &[ResidenceProjectLaborSite],
    available_labor: u32,
) -> Vec<(u64, u32)> {
    let current_builders = sites
        .iter()
        .map(|site| site.assigned_labor.min(1))
        .sum::<u32>();
    let mut remaining = current_builders.saturating_add(available_labor);
    let mut selected = HashSet::new();
    let mut buckets: [Vec<ResidenceProjectLaborSite>; CONSTRUCTION_PRIORITY_LEVELS] =
        std::array::from_fn(|_| Vec::new());

    for site in sites.iter().copied() {
        let priority = construction_priority_bucket(site.priority);
        if priority > CONSTRUCTION_PRIORITY_HOLD as usize {
            buckets[priority].push(site);
        }
    }
    for bucket in &mut buckets {
        bucket.sort_unstable_by_key(|site| site.residence_id);
    }

    for bucket in buckets.iter().skip(1).rev() {
        for site in bucket {
            if remaining == 0 {
                break;
            }
            if site.assigned_labor > 0 && (site.work_ready || site.inbound_supply) {
                selected.insert(site.residence_id);
                remaining -= 1;
            }
        }
        for site in bucket {
            if remaining == 0 {
                break;
            }
            if site.work_ready && selected.insert(site.residence_id) {
                remaining -= 1;
            }
        }
    }

    let mut targets = sites
        .iter()
        .filter_map(|site| {
            let target = u32::from(selected.contains(&site.residence_id));
            (site.assigned_labor.min(1) != target).then_some((site.residence_id, target))
        })
        .collect::<Vec<_>>();
    targets.sort_unstable_by_key(|(residence_id, _)| *residence_id);
    targets
}

pub fn advance_residence_upgrade(
    work: ResidenceUpgradeWork,
    elapsed_seconds: f64,
    work_per_worker_per_second: f64,
) -> f64 {
    let progress = nonnegative(work.progress).min(1.0);
    if work.assigned_labor == 0
        || !residence_upgrade_is_paid(work)
        || !elapsed_seconds.is_finite()
        || elapsed_seconds <= 0.0
    {
        return progress;
    }
    let structural_cost = nonnegative(work.required_timber)
        + nonnegative(work.required_stone)
        + nonnegative(work.required_roof_tiles);
    if structural_cost <= EPSILON {
        return 1.0;
    }
    let work_step =
        nonnegative(work_per_worker_per_second) * work.assigned_labor as f64 * elapsed_seconds
            / structural_cost;
    (progress + work_step)
        .min(residence_upgrade_material_readiness(work))
        .min(1.0)
}

pub fn residence_upgrade_complete(work: ResidenceUpgradeWork) -> bool {
    residence_upgrade_is_paid(work)
        && nonnegative(work.delivered_timber) + EPSILON >= nonnegative(work.required_timber)
        && nonnegative(work.delivered_stone) + EPSILON >= nonnegative(work.required_stone)
        && nonnegative(work.delivered_roof_tiles) + EPSILON >= nonnegative(work.required_roof_tiles)
        && nonnegative(work.progress) >= 1.0 - EPSILON
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ready_work() -> ResidenceUpgradeWork {
        ResidenceUpgradeWork {
            progress: 0.0,
            required_timber: 18.0,
            required_stone: 14.0,
            required_gold: 8.0,
            required_roof_tiles: 0.0,
            delivered_timber: 18.0,
            delivered_stone: 14.0,
            delivered_gold: 8.0,
            delivered_roof_tiles: 0.0,
            assigned_labor: 1,
        }
    }

    #[test]
    fn household_coin_reduces_but_never_overpays_the_civic_grant() {
        assert_eq!(residence_upgrade_household_contribution(3.0, 8.0), 0.0);
        assert_eq!(residence_upgrade_household_contribution(15.0, 8.0), 3.0);
        assert_eq!(residence_upgrade_household_contribution(20.0, 8.0), 8.0);
        assert_eq!(residence_upgrade_household_contribution(-2.0, 8.0), 0.0);
    }

    #[test]
    fn whole_cottage_costs_preserve_the_zone_total_without_fractional_lots() {
        let lots = allocate_whole_residence_project_costs(28.0, &[1.0, 1.1, 1.2]);
        assert_eq!(lots, vec![9.0, 9.0, 10.0]);
        assert_eq!(lots.iter().sum::<f64>(), 28.0);
        assert!(lots.iter().all(|lot| lot.fract() == 0.0));

        assert_eq!(
            allocate_whole_residence_project_costs(15.0, &[1.0, 1.0, 1.0]),
            vec![5.0, 5.0, 5.0],
            "equal parcels should remain equal and deterministic",
        );
        assert!(allocate_whole_residence_project_costs(10.0, &[]).is_empty());
    }

    #[test]
    fn household_projects_share_one_physical_work_slot() {
        assert!(residence_project_active(2, 1, 0, false, false, false));
        assert!(residence_project_active(0, 1, 3, false, false, false));
        assert!(residence_project_active(0, 1, 0, true, false, false));
        assert!(residence_project_active(0, 1, 0, false, true, false));
        assert!(residence_project_active(0, 3, 0, false, false, true));
        assert!(!residence_project_active(0, 1, 0, false, false, false));
    }

    #[test]
    fn promotion_checks_only_needs_active_at_the_current_tier() {
        assert_eq!(
            residence_promotion_needs(1),
            vec![
                ResidenceNeedKind::Firewood,
                ResidenceNeedKind::Water,
                ResidenceNeedKind::Food,
                ResidenceNeedKind::Church,
            ],
        );
        assert_eq!(
            residence_promotion_needs(2),
            vec![
                ResidenceNeedKind::Firewood,
                ResidenceNeedKind::Water,
                ResidenceNeedKind::Food,
                ResidenceNeedKind::Ale,
                ResidenceNeedKind::Cloth,
                ResidenceNeedKind::Church,
                ResidenceNeedKind::FoodVariety,
            ],
        );
        assert_eq!(
            residence_promotion_needs(3),
            vec![
                ResidenceNeedKind::Firewood,
                ResidenceNeedKind::Water,
                ResidenceNeedKind::Food,
                ResidenceNeedKind::Ale,
                ResidenceNeedKind::Cloth,
                ResidenceNeedKind::Shoes,
                ResidenceNeedKind::Church,
                ResidenceNeedKind::FoodVariety,
            ],
        );
        assert!(!residence_promotion_needs(1).contains(&ResidenceNeedKind::Ale));
        assert!(!residence_promotion_needs(2).contains(&ResidenceNeedKind::Shoes));
        assert!(!residence_promotion_needs(3).contains(&ResidenceNeedKind::SavoryPreserves));
        assert!(!residence_promotion_needs(3).contains(&ResidenceNeedKind::Pottery));
        assert!(!residence_promotion_needs(3).contains(&ResidenceNeedKind::Luxury));
    }

    #[test]
    fn delivered_household_goods_remain_valid_promotion_evidence() {
        for kind in [
            ResidenceNeedKind::Firewood,
            ResidenceNeedKind::Food,
            ResidenceNeedKind::Ale,
            ResidenceNeedKind::SavoryPreserves,
            ResidenceNeedKind::Cloth,
            ResidenceNeedKind::Shoes,
            ResidenceNeedKind::Pottery,
            ResidenceNeedKind::Luxury,
        ] {
            assert!(household_stock_satisfies_promotion_need(
                kind, 1.0, false, false, 0.0, 0.0,
            ));
        }
    }

    #[test]
    fn typed_food_and_virtual_food_standard_are_authoritative() {
        assert!(household_stock_satisfies_promotion_need(
            ResidenceNeedKind::Food,
            0.0,
            true,
            false,
            0.0,
            0.0,
        ));
        assert!(household_stock_satisfies_promotion_need(
            ResidenceNeedKind::FoodVariety,
            0.0,
            false,
            true,
            0.0,
            0.0,
        ));
        assert!(household_stock_satisfies_promotion_need(
            ResidenceNeedKind::SavoryPreserves,
            0.0,
            false,
            false,
            1.0,
            0.0,
        ));
        assert!(household_stock_satisfies_promotion_need(
            ResidenceNeedKind::Luxury,
            0.0,
            false,
            false,
            0.0,
            1.0,
        ));
    }

    #[test]
    fn pantry_rows_do_not_replace_well_or_church_service() {
        for kind in [ResidenceNeedKind::Water, ResidenceNeedKind::Church] {
            assert!(!household_stock_satisfies_promotion_need(
                kind, 10.0, true, true, 10.0, 10.0,
            ));
        }
    }

    #[test]
    fn unpaid_or_unstaffed_works_do_not_advance() {
        let mut work = ready_work();
        work.delivered_gold = 7.9;
        assert_eq!(advance_residence_upgrade(work, 1.0, 1.0), 0.0);
        work.delivered_gold = 8.0;
        work.assigned_labor = 0;
        assert_eq!(advance_residence_upgrade(work, 1.0, 1.0), 0.0);
    }

    #[test]
    fn builders_release_blocked_projects_and_return_when_material_is_ready() {
        let mut work = ready_work();
        work.delivered_timber = 0.0;
        work.delivered_stone = 0.0;
        assert!(!residence_upgrade_work_ready(work));

        work.delivered_timber = 9.0;
        work.delivered_stone = 7.0;
        assert!(residence_upgrade_work_ready(work));

        work.progress = 0.5;
        assert!(!residence_upgrade_work_ready(work));

        work.progress = 0.0;
        work.delivered_gold = 7.9;
        assert!(!residence_upgrade_work_ready(work));
    }

    #[test]
    fn lone_cottage_worker_hauls_first_then_returns_to_build() {
        let blocked = ResidenceProjectLaborSite {
            residence_id: 1,
            priority: 3,
            assigned_labor: 1,
            work_ready: false,
            inbound_supply: false,
        };
        assert_eq!(residence_project_labor_targets(&[blocked], 0), vec![(1, 0)]);

        let supplied = ResidenceProjectLaborSite {
            assigned_labor: 0,
            work_ready: true,
            ..blocked
        };
        assert_eq!(
            residence_project_labor_targets(&[supplied], 1),
            vec![(1, 1)]
        );

        let cart_approaching = ResidenceProjectLaborSite {
            assigned_labor: 1,
            work_ready: false,
            inbound_supply: true,
            ..blocked
        };
        assert!(residence_project_labor_targets(&[cart_approaching], 0).is_empty());
    }

    #[test]
    fn ready_urgent_project_can_preempt_a_lower_priority_builder() {
        let low = ResidenceProjectLaborSite {
            residence_id: 10,
            priority: 1,
            assigned_labor: 1,
            work_ready: true,
            inbound_supply: false,
        };
        let urgent = ResidenceProjectLaborSite {
            residence_id: 20,
            priority: 3,
            assigned_labor: 0,
            work_ready: true,
            inbound_supply: false,
        };
        assert_eq!(
            residence_project_labor_targets(&[low, urgent], 0),
            vec![(10, 0), (20, 1)],
        );
    }

    #[test]
    fn work_cannot_run_ahead_of_delivered_structure() {
        let mut work = ready_work();
        work.delivered_timber = 9.0;
        work.delivered_stone = 7.0;
        assert_eq!(residence_upgrade_material_readiness(work), 0.5);
        assert_eq!(advance_residence_upgrade(work, 100.0, 1.0), 0.5);
        assert!(!residence_upgrade_complete(work));
    }

    #[test]
    fn fully_paid_supplied_work_completes_at_a_bounded_rate() {
        let work = ready_work();
        let halfway = advance_residence_upgrade(work, 16.0, 1.0);
        assert_eq!(halfway, 0.5);
        let completed = ResidenceUpgradeWork {
            progress: advance_residence_upgrade(
                ResidenceUpgradeWork {
                    progress: halfway,
                    ..work
                },
                16.0,
                1.0,
            ),
            ..work
        };
        assert!(residence_upgrade_complete(completed));
    }

    #[test]
    fn an_initial_cottage_needs_material_and_labor_but_no_coin() {
        let work = ResidenceUpgradeWork {
            progress: 0.0,
            required_timber: 8.0,
            required_stone: 12.0,
            required_gold: 0.0,
            required_roof_tiles: 0.0,
            delivered_timber: 8.0,
            delivered_stone: 12.0,
            delivered_gold: 0.0,
            delivered_roof_tiles: 0.0,
            assigned_labor: 1,
        };
        assert_eq!(advance_residence_upgrade(work, 10.0, 1.0), 0.5);
        assert!(!residence_upgrade_complete(work));
        assert!(residence_upgrade_complete(ResidenceUpgradeWork {
            progress: 1.0,
            ..work
        }));
    }
}
