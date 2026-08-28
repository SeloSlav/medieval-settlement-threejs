use crate::balance_generated::{
    CHAPEL_COFFER_CAPACITY, CHAPEL_TIER1_COFFER_CAPACITY, CHAPEL_TIER1_TITHE_MULTIPLIER,
    CHAPEL_TIER2_TITHE_MULTIPLIER, CHAPEL_TIER2_UPGRADE_IRONWORK, CHAPEL_TIER2_UPGRADE_ROOF_TILES,
    CHAPEL_TIER2_UPGRADE_STONE, CHAPEL_TIER2_UPGRADE_TIMBER, CHAPEL_TIER3_COFFER_CAPACITY,
    CHAPEL_TIER3_TITHE_MULTIPLIER, CHAPEL_TIER3_UPGRADE_IRONWORK, CHAPEL_TIER3_UPGRADE_ROOF_TILES,
    CHAPEL_TIER3_UPGRADE_STONE, CHAPEL_TIER3_UPGRADE_TIMBER,
};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ChapelUpgradeCost {
    pub target_tier: u8,
    pub timber: f64,
    pub stone: f64,
    pub ironwork: f64,
    pub roof_tiles: f64,
}

pub fn normalize_chapel_tier(tier: u8) -> u8 {
    tier.clamp(1, 3)
}

pub fn chapel_upgrade_cost(current_tier: u8) -> Option<ChapelUpgradeCost> {
    match normalize_chapel_tier(current_tier) {
        1 => Some(ChapelUpgradeCost {
            target_tier: 2,
            timber: CHAPEL_TIER2_UPGRADE_TIMBER,
            stone: CHAPEL_TIER2_UPGRADE_STONE,
            ironwork: CHAPEL_TIER2_UPGRADE_IRONWORK,
            roof_tiles: CHAPEL_TIER2_UPGRADE_ROOF_TILES,
        }),
        2 => Some(ChapelUpgradeCost {
            target_tier: 3,
            timber: CHAPEL_TIER3_UPGRADE_TIMBER,
            stone: CHAPEL_TIER3_UPGRADE_STONE,
            ironwork: CHAPEL_TIER3_UPGRADE_IRONWORK,
            roof_tiles: CHAPEL_TIER3_UPGRADE_ROOF_TILES,
        }),
        _ => None,
    }
}

pub fn chapel_coffer_capacity_for_tier(tier: u8) -> f64 {
    match normalize_chapel_tier(tier) {
        1 => CHAPEL_TIER1_COFFER_CAPACITY,
        2 => CHAPEL_COFFER_CAPACITY,
        _ => CHAPEL_TIER3_COFFER_CAPACITY,
    }
}

pub fn chapel_tithe_multiplier(tier: u8) -> f64 {
    match normalize_chapel_tier(tier) {
        1 => CHAPEL_TIER1_TITHE_MULTIPLIER,
        2 => CHAPEL_TIER2_TITHE_MULTIPLIER,
        _ => CHAPEL_TIER3_TITHE_MULTIPLIER,
    }
}

#[cfg(test)]
mod tests {
    use super::{chapel_coffer_capacity_for_tier, chapel_tithe_multiplier, chapel_upgrade_cost};

    #[test]
    fn church_tiers_grow_in_cost_and_benefit() {
        let stone_upgrade = chapel_upgrade_cost(1).expect("tier two upgrade");
        let large_upgrade = chapel_upgrade_cost(2).expect("tier three upgrade");
        assert_eq!(stone_upgrade.target_tier, 2);
        assert_eq!(large_upgrade.target_tier, 3);
        assert!(
            large_upgrade.timber
                + large_upgrade.stone
                + large_upgrade.ironwork
                + large_upgrade.roof_tiles
                > stone_upgrade.timber
                    + stone_upgrade.stone
                    + stone_upgrade.ironwork
                    + stone_upgrade.roof_tiles
        );
        assert_eq!(stone_upgrade.ironwork, 0.0);
        assert_eq!(large_upgrade.ironwork, 0.0);
        assert!(stone_upgrade.roof_tiles > 0.0);
        assert!(chapel_coffer_capacity_for_tier(1) < chapel_coffer_capacity_for_tier(2));
        assert!(chapel_coffer_capacity_for_tier(2) < chapel_coffer_capacity_for_tier(3));
        assert!(chapel_tithe_multiplier(1) < chapel_tithe_multiplier(2));
        assert!(chapel_tithe_multiplier(2) < chapel_tithe_multiplier(3));
        assert!(chapel_upgrade_cost(3).is_none());
    }
}
