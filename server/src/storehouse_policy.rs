use std::cmp::Ordering;

pub const STOREHOUSE_STOCK_TARGET_DEFAULT_PERCENT: u8 = 100;
pub const STOREHOUSE_STOCK_TARGET_PERCENTS: [u8; 4] = [25, 50, 75, 100];

pub fn is_valid_storehouse_stock_target_percent(percent: u8) -> bool {
    STOREHOUSE_STOCK_TARGET_PERCENTS.contains(&percent)
}

/// Invalid legacy or externally-authored values fall back to the former
/// fill-to-capacity behavior.
pub fn normalize_storehouse_stock_target_percent(percent: u8) -> u8 {
    if is_valid_storehouse_stock_target_percent(percent) {
        percent
    } else {
        STOREHOUSE_STOCK_TARGET_DEFAULT_PERCENT
    }
}

pub fn storehouse_stock_target(capacity: f64, percent: u8) -> f64 {
    if !capacity.is_finite() {
        return 0.0;
    }
    capacity.max(0.0) * normalize_storehouse_stock_target_percent(percent) as f64 / 100.0
}

/// Material below the selected collection ceiling. Construction and household
/// fuel may still draw stock below this level; this is not a protected floor.
pub fn storehouse_collection_headroom(stock: f64, capacity: f64, percent: u8) -> f64 {
    if !stock.is_finite() {
        return 0.0;
    }
    (storehouse_stock_target(capacity, percent) - stock.max(0.0)).max(0.0)
}

/// Applies the depot's intake gate before evaluating its selected collection
/// ceiling. Founding-yard clearance and routine overflow collection share this
/// rule so neither path can silently bypass the player's storage policy.
pub fn storehouse_filtered_collection_headroom(
    accepts: bool,
    stock: f64,
    capacity: f64,
    percent: u8,
) -> f64 {
    if !accepts {
        return 0.0;
    }
    storehouse_collection_headroom(stock, capacity, percent)
}

/// Fullest producers are relieved first. Stable ids make simultaneous overflow
/// independent of table iteration and building construction order.
pub fn compare_storehouse_source_priority(
    fill_ratio_a: f64,
    source_id_a: u64,
    fill_ratio_b: f64,
    source_id_b: u64,
) -> Ordering {
    fill_ratio_b
        .total_cmp(&fill_ratio_a)
        .then_with(|| source_id_a.cmp(&source_id_b))
}

/// Once a producer has priority, its closest compatible idle depot wins.
/// Stable ids resolve exact route ties without reintroducing iteration bias.
pub fn compare_storehouse_destination(
    distance_a: f64,
    storehouse_id_a: u64,
    distance_b: f64,
    storehouse_id_b: u64,
) -> Ordering {
    distance_a
        .total_cmp(&distance_b)
        .then_with(|| storehouse_id_a.cmp(&storehouse_id_b))
}

#[cfg(test)]
mod tests {
    use super::{
        compare_storehouse_destination, compare_storehouse_source_priority,
        is_valid_storehouse_stock_target_percent, normalize_storehouse_stock_target_percent,
        storehouse_collection_headroom, storehouse_filtered_collection_headroom,
        storehouse_stock_target, STOREHOUSE_STOCK_TARGET_DEFAULT_PERCENT,
    };

    #[test]
    fn legacy_storehouses_keep_filling_to_capacity() {
        assert_eq!(STOREHOUSE_STOCK_TARGET_DEFAULT_PERCENT, 100);
        assert_eq!(normalize_storehouse_stock_target_percent(0), 100);
        assert_eq!(storehouse_stock_target(360.0, 100), 360.0);
        assert_eq!(storehouse_collection_headroom(110.0, 360.0, 0), 250.0);
    }

    #[test]
    fn depot_targets_use_four_readable_steps() {
        for percent in [25, 50, 75, 100] {
            assert!(is_valid_storehouse_stock_target_percent(percent));
            assert_eq!(normalize_storehouse_stock_target_percent(percent), percent);
        }
        assert!(!is_valid_storehouse_stock_target_percent(50 - 1));
        assert!(!is_valid_storehouse_stock_target_percent(101));
    }

    #[test]
    fn collection_stops_at_the_selected_ceiling_without_reserving_stock() {
        assert_eq!(storehouse_stock_target(360.0, 25), 90.0);
        assert_eq!(storehouse_collection_headroom(40.0, 360.0, 25), 50.0);
        assert_eq!(storehouse_collection_headroom(90.0, 360.0, 25), 0.0);
        assert_eq!(storehouse_collection_headroom(120.0, 360.0, 25), 0.0);
    }

    #[test]
    fn physical_relocation_cannot_bypass_an_intake_filter() {
        assert_eq!(
            storehouse_filtered_collection_headroom(false, 0.0, 360.0, 100),
            0.0
        );
        assert_eq!(
            storehouse_filtered_collection_headroom(true, 40.0, 360.0, 25),
            50.0
        );
    }

    #[test]
    fn malformed_stock_or_capacity_cannot_create_collection_room() {
        assert_eq!(storehouse_stock_target(f64::NAN, 100), 0.0);
        assert_eq!(storehouse_stock_target(-10.0, 100), 0.0);
        assert_eq!(storehouse_collection_headroom(f64::NAN, 360.0, 100), 0.0);
    }

    #[test]
    fn fuller_sources_claim_carts_before_building_order_can_bias_routing() {
        let mut sources = [(91.0, 40), (98.0, 90), (98.0, 12)];
        sources.sort_by(|a, b| compare_storehouse_source_priority(a.0, a.1, b.0, b.1));
        assert_eq!(sources, [(98.0, 12), (98.0, 90), (91.0, 40)]);
    }

    #[test]
    fn nearest_depot_wins_with_stable_ties() {
        let mut destinations = [(35.0, 3), (12.0, 80), (12.0, 9)];
        destinations.sort_by(|a, b| compare_storehouse_destination(a.0, a.1, b.0, b.1));
        assert_eq!(destinations, [(12.0, 9), (12.0, 80), (35.0, 3)]);
    }
}
