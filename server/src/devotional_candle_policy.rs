//! Pure balance policy for the local devotional candle economy.
//!
//! Regional exports remain the strongest cash conversion. Local contracts pay
//! less, but keep money circulating inside the settlement and provision real
//! parish and monastic services.

pub const DEVOTIONAL_CANDLE_CONTRACT_UNITS: f64 = 4.0;
pub const DEVOTIONAL_CANDLE_CONTRACT_GOLD: f64 = 5.0;

pub const CHAPEL_CANDLE_CAPACITY: f64 = 8.0;
pub const CHAPEL_CANDLE_REORDER_POINT: f64 = 4.0;
pub const CHAPEL_CANDLE_TARGET: f64 = 8.0;
pub const CHAPEL_CANDLE_COFFER_RESERVE_GOLD: f64 = 120.0;
pub const CHAPEL_LITURGY_ATTENDANCE_BONUS: f64 = 0.05;

pub const MONASTERY_CANDLE_CAPACITY: f64 = 16.0;
pub const MONASTERY_CANDLE_REORDER_POINT: f64 = 8.0;
pub const MONASTERY_CANDLE_TARGET: f64 = 12.0;
pub const MONASTERY_CANDLE_PURSE_RESERVE_GOLD: f64 = 40.0;
pub const MONASTERY_CANDLE_USE_INTERVAL_DAYS: u64 = 3;
pub const MONASTERY_LITURGY_PRESTIGE_MULTIPLIER: f64 = 1.10;

pub fn devotional_candle_capacity(building_kind: &str) -> Option<f64> {
    match building_kind {
        "chapel" => Some(CHAPEL_CANDLE_CAPACITY),
        "monastery" => Some(MONASTERY_CANDLE_CAPACITY),
        _ => None,
    }
}

pub fn devotional_candle_target(building_kind: &str) -> Option<(f64, f64)> {
    match building_kind {
        "chapel" => Some((CHAPEL_CANDLE_REORDER_POINT, CHAPEL_CANDLE_TARGET)),
        "monastery" => Some((MONASTERY_CANDLE_REORDER_POINT, MONASTERY_CANDLE_TARGET)),
        _ => None,
    }
}

pub fn devotional_candle_spendable_gold(building_kind: &str, available_gold: f64) -> f64 {
    let reserve = match building_kind {
        "chapel" => CHAPEL_CANDLE_COFFER_RESERVE_GOLD,
        "monastery" => MONASTERY_CANDLE_PURSE_RESERVE_GOLD,
        _ => return 0.0,
    };
    (available_gold.max(0.0) - reserve).max(0.0).floor()
}

pub fn devotional_candle_contract_ready(
    building_kind: &str,
    candle_stock: f64,
    candle_room: f64,
    available_gold: f64,
) -> bool {
    let Some((reorder_point, target)) = devotional_candle_target(building_kind) else {
        return false;
    };
    candle_stock.is_finite()
        && candle_stock.max(0.0) <= reorder_point + 1e-6
        && target - candle_stock.max(0.0) + 1e-6 >= DEVOTIONAL_CANDLE_CONTRACT_UNITS
        && candle_room.is_finite()
        && candle_room + 1e-6 >= DEVOTIONAL_CANDLE_CONTRACT_UNITS
        && devotional_candle_spendable_gold(building_kind, available_gold) + 1e-6
            >= DEVOTIONAL_CANDLE_CONTRACT_GOLD
}

pub fn chapel_candle_use_due(is_sunday: bool) -> bool {
    is_sunday
}

pub fn monastery_candle_use_due(monastery_id: u64, total_days: u64) -> bool {
    let interval = MONASTERY_CANDLE_USE_INTERVAL_DAYS.max(1);
    total_days % interval == monastery_id % interval
}

pub fn devotional_candles_supplied(candle_stock: f64) -> bool {
    candle_stock.is_finite() && candle_stock >= 1.0
}

pub fn monastery_liturgy_prestige_multiplier(candle_stock: f64) -> f64 {
    if devotional_candles_supplied(candle_stock) {
        MONASTERY_LITURGY_PRESTIGE_MULTIPLIER
    } else {
        1.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_contract_preserves_the_regional_cash_premium() {
        let local_per_eight = DEVOTIONAL_CANDLE_CONTRACT_GOLD * 2.0;
        let regional_per_eight = 14.0;
        assert!(local_per_eight < regional_per_eight);
        assert_eq!(local_per_eight, 10.0);
    }

    #[test]
    fn parish_contract_never_spends_the_charity_reserve() {
        assert!(!devotional_candle_contract_ready(
            "chapel",
            4.0,
            4.0,
            CHAPEL_CANDLE_COFFER_RESERVE_GOLD + DEVOTIONAL_CANDLE_CONTRACT_GOLD - 1.0,
        ));
        assert!(devotional_candle_contract_ready(
            "chapel",
            4.0,
            4.0,
            CHAPEL_CANDLE_COFFER_RESERVE_GOLD + DEVOTIONAL_CANDLE_CONTRACT_GOLD,
        ));
    }

    #[test]
    fn full_or_well_stocked_institutions_do_not_duplicate_orders() {
        assert!(!devotional_candle_contract_ready("chapel", 5.0, 3.0, 500.0));
        assert!(!devotional_candle_contract_ready("monastery", 12.0, 4.0, 500.0));
        assert!(devotional_candle_contract_ready("monastery", 8.0, 8.0, 500.0));
    }

    #[test]
    fn monastic_consumption_is_staggered_across_three_days() {
        let due = (0..6)
            .filter(|day| monastery_candle_use_due(7, *day))
            .collect::<Vec<_>>();
        assert_eq!(due, vec![1, 4]);
    }
}
