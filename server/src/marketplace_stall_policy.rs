//! Pure Marketplace stall-allocation policy shared by the authoritative
//! simulation and native Rust tests.

use std::collections::HashMap;

use crate::balance_generated::{MARKETPLACE_FOOD_STALL_SLOTS, MARKETPLACE_GOODS_STALL_SLOTS};
use crate::simulation::residence_needs::ResidenceNeedKind;

pub const MARKET_STALL_GROUP_FOOD: u8 = 0;
pub const MARKET_STALL_GROUP_GOODS: u8 = 1;
pub const MARKET_FOOD_STALL_NEEDS: [ResidenceNeedKind; 3] = [
    ResidenceNeedKind::Food,
    ResidenceNeedKind::PreservedFood,
    ResidenceNeedKind::Luxury,
];
pub const MARKET_GOODS_STALL_NEEDS: [ResidenceNeedKind; 4] = [
    ResidenceNeedKind::Firewood,
    ResidenceNeedKind::Cloth,
    ResidenceNeedKind::Shoes,
    ResidenceNeedKind::Pottery,
];

#[derive(Default)]
pub struct MarketplaceStallRoster {
    pub workplace_by_market_need: HashMap<(u64, ResidenceNeedKind), u64>,
    pub workers_by_market_group: HashMap<(u64, u8), Vec<u64>>,
}

#[derive(Clone, Copy)]
pub struct MarketplaceStallCandidate {
    pub marketplace_id: u64,
    pub workplace_id: u64,
    pub need_kind: ResidenceNeedKind,
    pub distance: f64,
    pub source_has_stock: bool,
}

pub fn assign_marketplace_stall_candidates(
    roster: &mut MarketplaceStallRoster,
    group: u8,
    mut candidates: Vec<MarketplaceStallCandidate>,
    workers_remaining: &mut HashMap<u64, u32>,
    slots_remaining: &mut HashMap<u64, u32>,
) {
    candidates.sort_by(|left, right| {
        left.distance
            .total_cmp(&right.distance)
            .then_with(|| right.source_has_stock.cmp(&left.source_has_stock))
            .then_with(|| stall_need_rank(left.need_kind).cmp(&stall_need_rank(right.need_kind)))
            .then_with(|| left.marketplace_id.cmp(&right.marketplace_id))
            .then_with(|| left.workplace_id.cmp(&right.workplace_id))
    });
    for candidate in candidates {
        let source_workers = workers_remaining
            .get(&candidate.workplace_id)
            .copied()
            .unwrap_or(0);
        let market_slots = slots_remaining
            .get(&candidate.marketplace_id)
            .copied()
            .unwrap_or(0);
        if source_workers == 0
            || market_slots == 0
            || roster
                .workplace_by_market_need
                .contains_key(&(candidate.marketplace_id, candidate.need_kind))
        {
            continue;
        }
        roster.workplace_by_market_need.insert(
            (candidate.marketplace_id, candidate.need_kind),
            candidate.workplace_id,
        );
        roster
            .workers_by_market_group
            .entry((candidate.marketplace_id, group))
            .or_default()
            .push(candidate.workplace_id);
        workers_remaining.insert(candidate.workplace_id, source_workers - 1);
        slots_remaining.insert(candidate.marketplace_id, market_slots - 1);
    }
}

pub fn stall_group_for_need(need_kind: ResidenceNeedKind) -> Option<u8> {
    match need_kind {
        ResidenceNeedKind::Food
        | ResidenceNeedKind::PreservedFood
        | ResidenceNeedKind::Ale
        | ResidenceNeedKind::Luxury => Some(MARKET_STALL_GROUP_FOOD),
        ResidenceNeedKind::Firewood
        | ResidenceNeedKind::Cloth
        | ResidenceNeedKind::Shoes
        | ResidenceNeedKind::Pottery => Some(MARKET_STALL_GROUP_GOODS),
        ResidenceNeedKind::Water | ResidenceNeedKind::Church | ResidenceNeedKind::FoodVariety => {
            None
        }
    }
}

pub fn stall_needs_for_group(group: u8) -> &'static [ResidenceNeedKind] {
    if group == MARKET_STALL_GROUP_FOOD {
        &MARKET_FOOD_STALL_NEEDS
    } else {
        &MARKET_GOODS_STALL_NEEDS
    }
}

pub fn stall_slots_for_group(group: u8) -> u32 {
    if group == MARKET_STALL_GROUP_FOOD {
        MARKETPLACE_FOOD_STALL_SLOTS
    } else {
        MARKETPLACE_GOODS_STALL_SLOTS
    }
}

fn stall_need_rank(need_kind: ResidenceNeedKind) -> u8 {
    match need_kind {
        ResidenceNeedKind::Food | ResidenceNeedKind::Firewood => 0,
        ResidenceNeedKind::PreservedFood | ResidenceNeedKind::Cloth => 1,
        ResidenceNeedKind::Shoes => 2,
        ResidenceNeedKind::Ale | ResidenceNeedKind::Pottery | ResidenceNeedKind::Luxury => 2,
        ResidenceNeedKind::Water | ResidenceNeedKind::Church | ResidenceNeedKind::FoodVariety => 3,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stocked_tier_four_goods_candidates() -> Vec<MarketplaceStallCandidate> {
        let mut candidates = Vec::new();
        for (workplace_id, workplace_x) in [(40_u64, 0.0_f64), (41, 1.0)] {
            for (marketplace_id, marketplace_x) in [(10_u64, 10.0_f64), (20, 100.0)] {
                for need_kind in MARKET_GOODS_STALL_NEEDS {
                    candidates.push(MarketplaceStallCandidate {
                        marketplace_id,
                        workplace_id,
                        need_kind,
                        distance: (marketplace_x - workplace_x).abs(),
                        source_has_stock: true,
                    });
                }
            }
        }
        candidates
    }

    fn assign_tier_four_goods(slots_per_market: u32) -> MarketplaceStallRoster {
        let mut roster = MarketplaceStallRoster::default();
        let mut workers_remaining = HashMap::from([(40_u64, 2_u32), (41, 2)]);
        let mut slots_remaining =
            HashMap::from([(10_u64, slots_per_market), (20, slots_per_market)]);
        assign_marketplace_stall_candidates(
            &mut roster,
            MARKET_STALL_GROUP_GOODS,
            stocked_tier_four_goods_candidates(),
            &mut workers_remaining,
            &mut slots_remaining,
        );
        roster
    }

    #[test]
    fn three_goods_slots_strand_tier_four_pottery_at_the_near_market() {
        let roster = assign_tier_four_goods(3);
        assert_eq!(
            roster
                .workplace_by_market_need
                .get(&(10, ResidenceNeedKind::Firewood)),
            Some(&41)
        );
        assert_eq!(
            roster
                .workplace_by_market_need
                .get(&(10, ResidenceNeedKind::Cloth)),
            Some(&41)
        );
        assert_eq!(
            roster
                .workplace_by_market_need
                .get(&(10, ResidenceNeedKind::Shoes)),
            Some(&40)
        );
        assert!(!roster
            .workplace_by_market_need
            .contains_key(&(10, ResidenceNeedKind::Pottery)));
        assert_eq!(
            roster
                .workplace_by_market_need
                .get(&(20, ResidenceNeedKind::Firewood)),
            Some(&40),
            "the fourth worker incorrectly duplicates firewood at the farther market"
        );
    }

    #[test]
    fn authoritative_goods_slots_serve_every_tier_four_need_at_one_market() {
        assert!(
            MARKETPLACE_GOODS_STALL_SLOTS as usize >= MARKET_GOODS_STALL_NEEDS.len(),
            "the authoritative goods-table count must cover every Tier-4 Marketplace need"
        );
        let roster = assign_tier_four_goods(stall_slots_for_group(MARKET_STALL_GROUP_GOODS));
        for (need_kind, workplace_id) in [
            (ResidenceNeedKind::Firewood, 41_u64),
            (ResidenceNeedKind::Cloth, 41),
            (ResidenceNeedKind::Shoes, 40),
            (ResidenceNeedKind::Pottery, 40),
        ] {
            assert_eq!(
                roster.workplace_by_market_need.get(&(10, need_kind)),
                Some(&workplace_id),
                "the nearest Marketplace must roster {need_kind:?}"
            );
        }
        assert!(MARKET_GOODS_STALL_NEEDS.iter().all(|need_kind| !roster
            .workplace_by_market_need
            .contains_key(&(20, *need_kind))));
    }
}
