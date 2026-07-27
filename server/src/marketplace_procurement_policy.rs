pub const MARKETPLACE_SEED_GRAIN_IMPORT_LOT: f64 = 24.0;
pub const MARKETPLACE_SEED_GRAIN_TARGETS: [u8; 5] = [0, 24, 48, 72, 96];
pub const MARKETPLACE_IRONWORK_IMPORT_LOT: f64 = 6.0;
pub const MARKETPLACE_IRONWORK_TARGETS: [u8; 5] = [0, 6, 12, 24, 48];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StandingMarketplaceImport {
    SeedGrain,
    Ironwork,
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

pub fn next_standing_marketplace_import(
    grain_stock: f64,
    seed_grain_target: u8,
    ironwork_stock: f64,
    ironwork_target: u8,
    conflict_enabled: bool,
) -> Option<StandingMarketplaceImport> {
    let seed_target = normalize_marketplace_seed_grain_target(seed_grain_target);
    let iron_target = normalize_marketplace_ironwork_target(ironwork_target);
    let seed_due = standing_seed_grain_import_due(grain_stock, seed_target);
    let iron_due = conflict_enabled && standing_ironwork_import_due(ironwork_stock, iron_target);

    match (seed_due, iron_due) {
        (false, false) => None,
        (true, false) => Some(StandingMarketplaceImport::SeedGrain),
        (false, true) => Some(StandingMarketplaceImport::Ironwork),
        (true, true) => {
            let seed_fill = grain_stock.max(0.0) * iron_target as f64;
            let iron_fill = ironwork_stock.max(0.0) * seed_target as f64;
            if seed_fill <= iron_fill {
                Some(StandingMarketplaceImport::SeedGrain)
            } else {
                Some(StandingMarketplaceImport::Ironwork)
            }
        }
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
    }

    #[test]
    fn shared_broker_serves_the_most_depleted_enabled_target() {
        assert_eq!(
            next_standing_marketplace_import(0.0, 48, 0.0, 12, false),
            Some(StandingMarketplaceImport::SeedGrain),
            "peaceful worlds must ignore stale frontier targets"
        );
        assert_eq!(
            next_standing_marketplace_import(0.0, 48, 0.0, 12, true),
            Some(StandingMarketplaceImport::SeedGrain),
            "seed grain wins an exact fill-ratio tie"
        );
        assert_eq!(
            next_standing_marketplace_import(24.0, 72, 0.0, 12, true),
            Some(StandingMarketplaceImport::Ironwork)
        );
        assert_eq!(
            next_standing_marketplace_import(0.0, 72, 6.0, 12, true),
            Some(StandingMarketplaceImport::SeedGrain)
        );
        assert_eq!(
            next_standing_marketplace_import(60.0, 72, 7.0, 12, true),
            None,
            "neither target accepts a whole lot without overshooting"
        );
    }

    #[test]
    fn large_procurement_forecasts_stay_linear_and_allocation_free() {
        let orders: u32 = (0..100_000)
            .map(|index| {
                standing_seed_grain_orders_to_target((index % 97) as f64, 96)
                    + standing_ironwork_orders_to_target((index % 49) as f64, 48)
            })
            .sum();
        assert!(orders > 0);
    }
}
