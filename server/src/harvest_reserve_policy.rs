pub const HARVEST_RESERVE_PERCENT_MAX: u8 = 90;

pub fn normalize_harvest_reserve_percent(percent: u8) -> u8 {
    percent.min(HARVEST_RESERVE_PERCENT_MAX)
}

pub fn protected_wild_stock(node_kind: &str, max_yield: f64, percent: u8) -> f64 {
    if !matches!(node_kind, "game" | "fish") {
        return 0.0;
    }
    max_yield.max(0.0) * normalize_harvest_reserve_percent(percent) as f64 / 100.0
}

pub fn harvestable_wild_stock(
    node_kind: &str,
    remaining: f64,
    max_yield: f64,
    percent: u8,
) -> f64 {
    (remaining.max(0.0) - protected_wild_stock(node_kind, max_yield, percent)).max(0.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_harvest_preserves_legacy_behavior() {
        assert_eq!(harvestable_wild_stock("game", 9.0, 12.0, 0), 9.0);
        assert_eq!(harvestable_wild_stock("fish", 80.0, 120.0, 0), 80.0);
    }

    #[test]
    fn reserve_protects_a_share_of_carrying_capacity() {
        assert_eq!(protected_wild_stock("game", 12.0, 25), 3.0);
        assert_eq!(harvestable_wild_stock("game", 9.0, 12.0, 25), 6.0);
        assert_eq!(protected_wild_stock("fish", 120.0, 50), 60.0);
        assert_eq!(harvestable_wild_stock("fish", 60.0, 120.0, 50), 0.0);
    }

    #[test]
    fn seasonal_forage_is_not_affected_by_wild_stock_policy() {
        assert_eq!(protected_wild_stock("berries", 60.0, 50), 0.0);
        assert_eq!(harvestable_wild_stock("mushrooms", 12.0, 42.0, 50), 12.0);
    }

    #[test]
    fn malformed_large_percentages_are_capped() {
        assert_eq!(normalize_harvest_reserve_percent(255), 90);
        assert_eq!(protected_wild_stock("fish", 100.0, 255), 90.0);
    }
}
