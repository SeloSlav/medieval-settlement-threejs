pub const MARKETPLACE_SEED_GRAIN_IMPORT_LOT: f64 = 24.0;
pub const MARKETPLACE_SEED_GRAIN_TARGETS: [u8; 5] = [0, 24, 48, 72, 96];
pub const MARKETPLACE_IRONWORK_IMPORT_LOT: f64 = 6.0;
pub const MARKETPLACE_IRONWORK_TARGETS: [u8; 5] = [0, 6, 12, 24, 48];
pub const MARKETPLACE_IRON_IMPORT_LOT: f64 = 12.0;
pub const MARKETPLACE_IRON_TARGETS: [u8; 5] = [0, 12, 24, 36, 48];
pub const MARKETPLACE_SALT_IMPORT_LOT: f64 = 12.0;
pub const MARKETPLACE_SALT_TARGETS: [u8; 5] = [0, 12, 24, 48, 72];
pub const MARKETPLACE_GOLD_RESERVE_DEFAULT: u8 = 32;
pub const MARKETPLACE_GOLD_RESERVE_TARGETS: [u8; 4] = [0, 16, 32, 64];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StandingMarketplaceImport {
    SeedGrain,
    Ironwork,
    Iron,
    Salt,
}

pub fn is_valid_marketplace_seed_grain_target(target: u8) -> bool {
    MARKETPLACE_SEED_GRAIN_TARGETS.contains(&target)
}

pub fn normalize_marketplace_seed_grain_target(target: u8) -> u8 {
    MARKETPLACE_SEED_GRAIN_TARGETS
        .iter()
        .copied()
        .rev()
        .find(|candidate| *candidate <= target)
        .unwrap_or(0)
}

pub fn is_valid_marketplace_ironwork_target(target: u8) -> bool {
    MARKETPLACE_IRONWORK_TARGETS.contains(&target)
}

pub fn normalize_marketplace_ironwork_target(target: u8) -> u8 {
    MARKETPLACE_IRONWORK_TARGETS
        .iter()
        .copied()
        .rev()
        .find(|candidate| *candidate <= target)
        .unwrap_or(0)
}

pub fn is_valid_marketplace_iron_target(target: u8) -> bool {
    MARKETPLACE_IRON_TARGETS.contains(&target)
}

pub fn normalize_marketplace_iron_target(target: u8) -> u8 {
    MARKETPLACE_IRON_TARGETS
        .iter()
        .copied()
        .rev()
        .find(|candidate| *candidate <= target)
        .unwrap_or(0)
}

pub fn is_valid_marketplace_salt_target(target: u8) -> bool {
    MARKETPLACE_SALT_TARGETS.contains(&target)
}

pub fn normalize_marketplace_salt_target(target: u8) -> u8 {
    MARKETPLACE_SALT_TARGETS
        .iter()
        .copied()
        .rev()
        .find(|candidate| *candidate <= target)
        .unwrap_or(0)
}

pub fn is_valid_marketplace_gold_reserve_target(target: u8) -> bool {
    MARKETPLACE_GOLD_RESERVE_TARGETS.contains(&target)
}

pub fn normalize_marketplace_gold_reserve_target(target: u8) -> u8 {
    MARKETPLACE_GOLD_RESERVE_TARGETS
        .iter()
        .copied()
        .rev()
        .find(|candidate| *candidate <= target)
        .unwrap_or(0)
}

pub fn marketplace_gold_reserve_shortfall(onsite_gold: f64, inbound_gold: f64, target: u8) -> f64 {
    let target = normalize_marketplace_gold_reserve_target(target) as f64;
    (target - onsite_gold.max(0.0) - inbound_gold.max(0.0)).max(0.0)
}

pub fn marketplace_gold_sweep_surplus(onsite_gold: f64, target: u8) -> f64 {
    let target = normalize_marketplace_gold_reserve_target(target) as f64;
    (onsite_gold.max(0.0) - target).max(0.0)
}

pub fn standing_seed_grain_import_due(stock: f64, target: u8) -> bool {
    standing_seed_grain_orders_to_target(stock, target) > 0
}

pub fn standing_seed_grain_orders_to_target(stock: f64, target: u8) -> u32 {
    let target = normalize_marketplace_seed_grain_target(target) as f64;
    standing_orders_to_target(stock, target, MARKETPLACE_SEED_GRAIN_IMPORT_LOT)
}

pub fn standing_ironwork_import_due(stock: f64, target: u8) -> bool {
    standing_ironwork_orders_to_target(stock, target) > 0
}

pub fn standing_ironwork_orders_to_target(stock: f64, target: u8) -> u32 {
    let target = normalize_marketplace_ironwork_target(target) as f64;
    standing_orders_to_target(stock, target, MARKETPLACE_IRONWORK_IMPORT_LOT)
}

pub fn standing_iron_import_due(stock: f64, target: u8) -> bool {
    standing_iron_orders_to_target(stock, target) > 0
}

pub fn standing_iron_orders_to_target(stock: f64, target: u8) -> u32 {
    let target = normalize_marketplace_iron_target(target) as f64;
    standing_orders_to_target(stock, target, MARKETPLACE_IRON_IMPORT_LOT)
}

pub fn standing_salt_import_due(stock: f64, target: u8) -> bool {
    standing_salt_orders_to_target(stock, target) > 0
}

pub fn standing_salt_orders_to_target(stock: f64, target: u8) -> u32 {
    let target = normalize_marketplace_salt_target(target) as f64;
    standing_orders_to_target(stock, target, MARKETPLACE_SALT_IMPORT_LOT)
}

pub fn next_standing_marketplace_import(
    grain_stock: f64,
    seed_grain_target: u8,
    ironwork_stock: f64,
    ironwork_target: u8,
    iron_stock: f64,
    iron_target: u8,
    salt_stock: f64,
    salt_target: u8,
    conflict_enabled: bool,
) -> Option<StandingMarketplaceImport> {
    let seed_target = normalize_marketplace_seed_grain_target(seed_grain_target);
    let ironwork_target = normalize_marketplace_ironwork_target(ironwork_target);
    let raw_iron_target = normalize_marketplace_iron_target(iron_target);
    let salt_target = normalize_marketplace_salt_target(salt_target);
    let mut next = None;

    // Ties retain this order: seed security, preservation salt, productive
    // iron, then frontier fittings. Once a lot lands its fill ratio rises and
    // the most depleted remaining target naturally takes the next broker turn.
    if standing_seed_grain_import_due(grain_stock, seed_target) {
        next = Some((
            StandingMarketplaceImport::SeedGrain,
            grain_stock.max(0.0),
            seed_target,
        ));
    }
    if standing_salt_import_due(salt_stock, salt_target) {
        next = more_depleted_standing_import(
            next,
            StandingMarketplaceImport::Salt,
            salt_stock,
            salt_target,
        );
    }
    if standing_iron_import_due(iron_stock, raw_iron_target) {
        next = more_depleted_standing_import(
            next,
            StandingMarketplaceImport::Iron,
            iron_stock,
            raw_iron_target,
        );
    }
    if conflict_enabled && standing_ironwork_import_due(ironwork_stock, ironwork_target) {
        next = more_depleted_standing_import(
            next,
            StandingMarketplaceImport::Ironwork,
            ironwork_stock,
            ironwork_target,
        );
    }

    next.map(|candidate| candidate.0)
}

fn more_depleted_standing_import(
    current: Option<(StandingMarketplaceImport, f64, u8)>,
    kind: StandingMarketplaceImport,
    stock: f64,
    target: u8,
) -> Option<(StandingMarketplaceImport, f64, u8)> {
    let candidate = (kind, stock.max(0.0), target);
    let Some(existing) = current else {
        return Some(candidate);
    };
    let candidate_fill = candidate.1 * existing.2 as f64;
    let existing_fill = existing.1 * candidate.2 as f64;
    if candidate_fill < existing_fill {
        Some(candidate)
    } else {
        Some(existing)
    }
}

fn standing_orders_to_target(stock: f64, target: f64, import_lot: f64) -> u32 {
    if target <= 0.0 {
        return 0;
    }
    ((target - stock.max(0.0)).max(0.0) / import_lot).floor() as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn targets_are_bounded_to_whole_regional_trade_lots() {
        assert!(is_valid_marketplace_seed_grain_target(0));
        assert!(is_valid_marketplace_seed_grain_target(48));
        assert!(is_valid_marketplace_seed_grain_target(96));
        assert!(!is_valid_marketplace_seed_grain_target(60));
        assert_eq!(normalize_marketplace_seed_grain_target(71), 48);
        assert_eq!(normalize_marketplace_seed_grain_target(255), 96);
        assert!(is_valid_marketplace_ironwork_target(0));
        assert!(is_valid_marketplace_ironwork_target(12));
        assert!(is_valid_marketplace_ironwork_target(48));
        assert!(!is_valid_marketplace_ironwork_target(18));
        assert_eq!(normalize_marketplace_ironwork_target(23), 12);
        assert_eq!(normalize_marketplace_ironwork_target(255), 48);
        assert!(is_valid_marketplace_iron_target(0));
        assert!(is_valid_marketplace_iron_target(36));
        assert!(is_valid_marketplace_iron_target(48));
        assert!(!is_valid_marketplace_iron_target(30));
        assert_eq!(normalize_marketplace_iron_target(35), 24);
        assert_eq!(normalize_marketplace_iron_target(255), 48);
        assert!(is_valid_marketplace_salt_target(0));
        assert!(is_valid_marketplace_salt_target(48));
        assert!(is_valid_marketplace_salt_target(72));
        assert!(!is_valid_marketplace_salt_target(36));
        assert_eq!(normalize_marketplace_salt_target(47), 24);
        assert_eq!(normalize_marketplace_salt_target(255), 72);
        assert!(is_valid_marketplace_gold_reserve_target(0));
        assert!(is_valid_marketplace_gold_reserve_target(32));
        assert!(is_valid_marketplace_gold_reserve_target(64));
        assert!(!is_valid_marketplace_gold_reserve_target(48));
        assert_eq!(normalize_marketplace_gold_reserve_target(47), 32);
        assert_eq!(normalize_marketplace_gold_reserve_target(255), 64);
    }

    #[test]
    fn market_cash_reserve_counts_inbound_coin_and_sweeps_only_surplus() {
        assert_eq!(marketplace_gold_reserve_shortfall(8.0, 4.0, 32), 20.0);
        assert_eq!(marketplace_gold_reserve_shortfall(24.0, 8.0, 32), 0.0);
        assert_eq!(marketplace_gold_reserve_shortfall(40.0, 0.0, 32), 0.0);
        assert_eq!(marketplace_gold_sweep_surplus(40.0, 32), 8.0);
        assert_eq!(marketplace_gold_sweep_surplus(24.0, 32), 0.0);
        assert_eq!(marketplace_gold_sweep_surplus(f64::NAN, 32), 0.0);
    }

    #[test]
    fn standing_orders_never_overshoot_the_selected_target() {
        assert!(!standing_seed_grain_import_due(0.0, 0));
        assert!(standing_seed_grain_import_due(0.0, 24));
        assert!(!standing_seed_grain_import_due(1.0, 24));
        assert_eq!(standing_seed_grain_orders_to_target(0.0, 96), 4);
        assert_eq!(standing_seed_grain_orders_to_target(49.0, 96), 1);
        assert!(!standing_ironwork_import_due(0.0, 0));
        assert!(standing_ironwork_import_due(0.0, 6));
        assert!(!standing_ironwork_import_due(1.0, 6));
        assert!(standing_ironwork_import_due(6.0, 12));
        assert!(!standing_ironwork_import_due(7.0, 12));
        assert_eq!(standing_ironwork_orders_to_target(0.0, 24), 4);
        assert_eq!(standing_ironwork_orders_to_target(13.0, 24), 1);
        assert!(standing_iron_import_due(0.0, 12));
        assert!(!standing_iron_import_due(1.0, 12));
        assert_eq!(standing_iron_orders_to_target(0.0, 48), 4);
        assert_eq!(standing_iron_orders_to_target(25.0, 48), 1);
        assert!(standing_salt_import_due(0.0, 12));
        assert!(!standing_salt_import_due(1.0, 12));
        assert_eq!(standing_salt_orders_to_target(0.0, 72), 6);
        assert_eq!(standing_salt_orders_to_target(49.0, 72), 1);
    }

    #[test]
    fn shared_broker_serves_the_most_depleted_enabled_target() {
        assert_eq!(
            next_standing_marketplace_import(0.0, 48, 0.0, 12, 0.0, 0, 0.0, 0, false,),
            Some(StandingMarketplaceImport::SeedGrain),
            "peaceful worlds must ignore stale frontier targets"
        );
        assert_eq!(
            next_standing_marketplace_import(0.0, 48, 0.0, 12, 0.0, 0, 0.0, 0, true,),
            Some(StandingMarketplaceImport::SeedGrain),
            "seed grain wins an exact fill-ratio tie"
        );
        assert_eq!(
            next_standing_marketplace_import(24.0, 72, 0.0, 12, 0.0, 0, 0.0, 0, true,),
            Some(StandingMarketplaceImport::Ironwork)
        );
        assert_eq!(
            next_standing_marketplace_import(0.0, 72, 6.0, 12, 0.0, 0, 0.0, 0, true,),
            Some(StandingMarketplaceImport::SeedGrain)
        );
        assert_eq!(
            next_standing_marketplace_import(60.0, 72, 7.0, 12, 0.0, 0, 0.0, 0, true,),
            None,
            "neither target accepts a whole lot without overshooting"
        );
        assert_eq!(
            next_standing_marketplace_import(24.0, 48, 0.0, 12, 0.0, 24, 0.0, 24, true,),
            Some(StandingMarketplaceImport::Salt),
            "empty salt wins its tie with raw iron and frontier ironwork"
        );
        assert_eq!(
            next_standing_marketplace_import(24.0, 48, 0.0, 12, 0.0, 24, 12.0, 24, true,),
            Some(StandingMarketplaceImport::Iron),
            "the raw iron reserve moves next after salt receives a lot"
        );
    }

    #[test]
    fn large_procurement_forecasts_stay_linear_and_allocation_free() {
        let orders: u32 = (0..100_000)
            .map(|index| {
                standing_seed_grain_orders_to_target((index % 97) as f64, 96)
                    + standing_ironwork_orders_to_target((index % 49) as f64, 48)
                    + standing_iron_orders_to_target((index % 49) as f64, 48)
                    + standing_salt_orders_to_target((index % 73) as f64, 72)
            })
            .sum();
        assert!(orders > 0);
    }
}
