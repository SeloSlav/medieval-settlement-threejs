use crate::balance_generated::{
    CHAPEL_COFFER_CAPACITY, CHAPEL_TIER1_COFFER_CAPACITY, CHAPEL_TIER1_TITHE_MULTIPLIER,
    CHAPEL_TIER2_TITHE_MULTIPLIER, CHAPEL_TIER2_UPGRADE_IRONWORK, CHAPEL_TIER2_UPGRADE_ROOF_TILES, CHAPEL_TIER2_UPGRADE_DRESSED_STONE,
    CHAPEL_TIER2_UPGRADE_STONE, CHAPEL_TIER2_UPGRADE_TIMBER, CHAPEL_TIER2_UPKEEP_MULTIPLIER,
    CHAPEL_TIER3_COFFER_CAPACITY, CHAPEL_TIER3_TITHE_MULTIPLIER, CHAPEL_TIER3_UPGRADE_IRONWORK,
    CHAPEL_TIER3_UPGRADE_ROOF_TILES, CHAPEL_TIER3_UPGRADE_DRESSED_STONE, CHAPEL_TIER3_UPGRADE_STONE, CHAPEL_TIER3_UPGRADE_TIMBER,
    CHAPEL_TIER3_UPKEEP_MULTIPLIER, CHAPEL_TIER4_COFFER_CAPACITY, CHAPEL_TIER4_TITHE_MULTIPLIER,
    CHAPEL_TIER4_UPGRADE_IRONWORK, CHAPEL_TIER4_UPGRADE_ROOF_TILES, CHAPEL_TIER4_UPGRADE_DRESSED_STONE, CHAPEL_TIER4_UPGRADE_STONE,
    CHAPEL_TIER4_UPGRADE_TIMBER, CHAPEL_TIER4_UPKEEP_MULTIPLIER,
};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ChapelUpgradeCost {
    pub target_tier: u8,
    pub timber: f64,
    pub stone: f64,
    pub ironwork: f64,
    pub roof_tiles: f64,
    pub dressed_stone: f64,
}

pub fn normalize_chapel_tier(tier: u8) -> u8 {
    tier.clamp(1, 4)
}

pub fn chapel_upgrade_cost(current_tier: u8) -> Option<ChapelUpgradeCost> {
    match normalize_chapel_tier(current_tier) {
        1 => Some(ChapelUpgradeCost {
            target_tier: 2,
            timber: CHAPEL_TIER2_UPGRADE_TIMBER,
            stone: CHAPEL_TIER2_UPGRADE_STONE,
            ironwork: CHAPEL_TIER2_UPGRADE_IRONWORK,
            roof_tiles: CHAPEL_TIER2_UPGRADE_ROOF_TILES,
            dressed_stone: CHAPEL_TIER2_UPGRADE_DRESSED_STONE,
        }),
        2 => Some(ChapelUpgradeCost {
            target_tier: 3,
            timber: CHAPEL_TIER3_UPGRADE_TIMBER,
            stone: CHAPEL_TIER3_UPGRADE_STONE,
            ironwork: CHAPEL_TIER3_UPGRADE_IRONWORK,
            roof_tiles: CHAPEL_TIER3_UPGRADE_ROOF_TILES,
            dressed_stone: CHAPEL_TIER3_UPGRADE_DRESSED_STONE,
        }),
        3 => Some(ChapelUpgradeCost {
            target_tier: 4,
            timber: CHAPEL_TIER4_UPGRADE_TIMBER,
            stone: CHAPEL_TIER4_UPGRADE_STONE,
            ironwork: CHAPEL_TIER4_UPGRADE_IRONWORK,
            roof_tiles: CHAPEL_TIER4_UPGRADE_ROOF_TILES,
            dressed_stone: CHAPEL_TIER4_UPGRADE_DRESSED_STONE,
        }),
        _ => None,
    }
}

pub fn chapel_coffer_capacity_for_tier(tier: u8) -> f64 {
    match normalize_chapel_tier(tier) {
        1 => CHAPEL_TIER1_COFFER_CAPACITY,
        2 => CHAPEL_COFFER_CAPACITY,
        3 => CHAPEL_TIER3_COFFER_CAPACITY,
        _ => CHAPEL_TIER4_COFFER_CAPACITY,
    }
}

pub fn chapel_tithe_multiplier(tier: u8) -> f64 {
    match normalize_chapel_tier(tier) {
        1 => CHAPEL_TIER1_TITHE_MULTIPLIER,
        2 => CHAPEL_TIER2_TITHE_MULTIPLIER,
        3 => CHAPEL_TIER3_TITHE_MULTIPLIER,
        _ => CHAPEL_TIER4_TITHE_MULTIPLIER,
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
        assert!(stone_upgrade.ironwork > 0.0);
        assert!(large_upgrade.ironwork > stone_upgrade.ironwork);
        assert!(stone_upgrade.roof_tiles > 0.0);
        assert!(chapel_coffer_capacity_for_tier(1) < chapel_coffer_capacity_for_tier(2));
        assert!(chapel_coffer_capacity_for_tier(2) < chapel_coffer_capacity_for_tier(3));
        assert!(chapel_tithe_multiplier(1) < chapel_tithe_multiplier(2));
        assert!(chapel_tithe_multiplier(2) < chapel_tithe_multiplier(3));
        let cathedral = chapel_upgrade_cost(3).expect("cathedral upgrade");
        assert_eq!(cathedral.target_tier, 4);
        assert!(cathedral.stone >= large_upgrade.stone * 3.0);
        assert_eq!(stone_upgrade.dressed_stone, 0.0);
        assert_eq!(large_upgrade.dressed_stone, 64.0);
        assert_eq!(cathedral.dressed_stone, 240.0);
        assert!(cathedral.timber > large_upgrade.timber);
        assert!(cathedral.ironwork > large_upgrade.ironwork);
        assert!(cathedral.roof_tiles > large_upgrade.roof_tiles);
        assert!(chapel_coffer_capacity_for_tier(4) > chapel_coffer_capacity_for_tier(3));
        assert!(chapel_tithe_multiplier(4) > chapel_tithe_multiplier(3));
        assert!(chapel_upgrade_cost(4).is_none());
    }
}

pub fn chapel_upkeep_multiplier(tier: u8) -> f64 {
    match normalize_chapel_tier(tier) {
        1 => 1.0,
        2 => CHAPEL_TIER2_UPKEEP_MULTIPLIER,
        3 => CHAPEL_TIER3_UPKEEP_MULTIPLIER,
        _ => CHAPEL_TIER4_UPKEEP_MULTIPLIER,
    }
}

/// A cathedral's serving clergy occupy the bishop's seat. Tier zero means no
/// staffed, reachable, undamaged parish; only the serving parish can apply this.
pub fn bishop_settlement_ticks(ticks: u32, chapel_tier: u8) -> u32 {
    if chapel_tier == 4 {
        ((ticks as f64) * crate::balance_generated::CATHEDRAL_BISHOP_SETTLEMENT_TICKS_MULTIPLIER)
            .ceil() as u32
    } else {
        ticks
    }
}

#[cfg(test)]
mod bishop_tests {
    #[test]
    fn bishop_shortens_settlement_once_and_only_for_cathedral_parish() {
        use super::bishop_settlement_ticks;
        for tier in 0..=3 {
            assert_eq!(bishop_settlement_ticks(175, tier), 175);
        }
        assert_eq!(bishop_settlement_ticks(175, 4), 132);
        assert_eq!(bishop_settlement_ticks(149, 4), 112);
        assert_eq!(bishop_settlement_ticks(135, 4), 102);
        assert_eq!(bishop_settlement_ticks(1, 4), 1);
        assert_eq!(super::chapel_upkeep_multiplier(4), 5.0);
    }
}
