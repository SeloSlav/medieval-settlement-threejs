//! Legacy stock-target validation still used by existing building rows.
//!
//! New regional imports are configured through `TradingPostTradeRule`. Iron
//! and salt targets remain active as local dispatch reserves, while the other
//! values are retained only as validated schema-compatible settings.

pub const MARKETPLACE_SEED_GRAIN_TARGETS: [u8; 5] = [0, 24, 48, 72, 96];
pub const MARKETPLACE_IRONWORK_TARGETS: [u8; 5] = [0, 6, 12, 24, 48];
pub const MARKETPLACE_IRON_TARGETS: [u8; 5] = [0, 12, 24, 36, 48];
pub const MARKETPLACE_SALT_TARGETS: [u8; 5] = [0, 12, 24, 48, 72];
pub const MARKETPLACE_GOLD_RESERVE_DEFAULT: u8 = 32;
pub const MARKETPLACE_GOLD_RESERVE_TARGETS: [u8; 4] = [0, 16, 32, 64];

pub fn is_valid_marketplace_seed_grain_target(target: u8) -> bool {
    MARKETPLACE_SEED_GRAIN_TARGETS.contains(&target)
}

pub fn is_valid_marketplace_ironwork_target(target: u8) -> bool {
    MARKETPLACE_IRONWORK_TARGETS.contains(&target)
}

pub fn is_valid_marketplace_iron_target(target: u8) -> bool {
    MARKETPLACE_IRON_TARGETS.contains(&target)
}

pub fn normalize_marketplace_iron_target(target: u8) -> u8 {
    MARKETPLACE_IRON_TARGETS
        .into_iter()
        .filter(|candidate| *candidate <= target)
        .max()
        .unwrap_or(0)
}

pub fn is_valid_marketplace_salt_target(target: u8) -> bool {
    MARKETPLACE_SALT_TARGETS.contains(&target)
}

pub fn normalize_marketplace_salt_target(target: u8) -> u8 {
    MARKETPLACE_SALT_TARGETS
        .into_iter()
        .filter(|candidate| *candidate <= target)
        .max()
        .unwrap_or(0)
}

pub fn is_valid_marketplace_gold_reserve_target(target: u8) -> bool {
    MARKETPLACE_GOLD_RESERVE_TARGETS.contains(&target)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn active_local_dispatch_targets_normalize_downward() {
        assert_eq!(normalize_marketplace_iron_target(35), 24);
        assert_eq!(normalize_marketplace_iron_target(255), 48);
        assert_eq!(normalize_marketplace_salt_target(47), 24);
        assert_eq!(normalize_marketplace_salt_target(255), 72);
    }

    #[test]
    fn persisted_target_catalogs_reject_arbitrary_values() {
        assert!(is_valid_marketplace_seed_grain_target(48));
        assert!(!is_valid_marketplace_seed_grain_target(47));
        assert!(is_valid_marketplace_ironwork_target(12));
        assert!(!is_valid_marketplace_ironwork_target(11));
        assert!(is_valid_marketplace_gold_reserve_target(32));
        assert!(!is_valid_marketplace_gold_reserve_target(31));
    }
}
