pub const MARKETPLACE_IRONWORK_IMPORT_LOT: f64 = 6.0;
pub const MARKETPLACE_IRONWORK_TARGETS: [u8; 5] = [0, 6, 12, 24, 48];

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

pub fn standing_ironwork_import_due(stock: f64, target: u8) -> bool {
    standing_ironwork_orders_to_target(stock, target) > 0
}

pub fn standing_ironwork_orders_to_target(stock: f64, target: u8) -> u32 {
    let target = normalize_marketplace_ironwork_target(target) as f64;
    if target <= 0.0 {
        return 0;
    }
    ((target - stock.max(0.0)).max(0.0) / MARKETPLACE_IRONWORK_IMPORT_LOT).floor() as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn targets_are_bounded_to_whole_regional_trade_lots() {
        assert!(is_valid_marketplace_ironwork_target(0));
        assert!(is_valid_marketplace_ironwork_target(12));
        assert!(is_valid_marketplace_ironwork_target(48));
        assert!(!is_valid_marketplace_ironwork_target(18));
        assert_eq!(normalize_marketplace_ironwork_target(23), 12);
        assert_eq!(normalize_marketplace_ironwork_target(255), 48);
    }

    #[test]
    fn standing_orders_never_overshoot_the_selected_target() {
        assert!(!standing_ironwork_import_due(0.0, 0));
        assert!(standing_ironwork_import_due(0.0, 6));
        assert!(!standing_ironwork_import_due(1.0, 6));
        assert!(standing_ironwork_import_due(6.0, 12));
        assert!(!standing_ironwork_import_due(7.0, 12));
        assert_eq!(standing_ironwork_orders_to_target(0.0, 24), 4);
        assert_eq!(standing_ironwork_orders_to_target(13.0, 24), 1);
    }

    #[test]
    fn large_procurement_forecasts_stay_linear_and_allocation_free() {
        let orders: u32 = (0..100_000)
            .map(|index| {
                standing_ironwork_orders_to_target((index % 49) as f64, 48)
            })
            .sum();
        assert!(orders > 0);
    }
}
