use crate::balance_generated::{REGIONAL_EXCHANGE_INTERVAL_SECONDS, TICK_DT};

pub const TRADE_MODE_NONE: u8 = 0;
pub const TRADE_MODE_IMPORT: u8 = 1;
pub const TRADE_MODE_EXPORT: u8 = 2;
pub const MAX_TRADE_SURPLUS: f64 = 9_999.0;

pub fn valid_trade_mode(mode: u8) -> bool {
    matches!(
        mode,
        TRADE_MODE_NONE | TRADE_MODE_IMPORT | TRADE_MODE_EXPORT
    )
}

pub fn clamp_trade_surplus(value: f64) -> f64 {
    if !value.is_finite() {
        return 0.0;
    }
    value.round().clamp(0.0, MAX_TRADE_SURPLUS)
}

/// Monotonic regional-exchange window derived from authoritative simulation
/// time. `TradingPostTradeRule::last_settled_month` retains its established
/// field name and storage type for save compatibility, but now stores this
/// bounded window sequence rather than a calendar-month number.
pub fn regional_exchange_sequence(sim_tick: u64) -> u64 {
    let interval_ticks = (REGIONAL_EXCHANGE_INTERVAL_SECONDS / TICK_DT)
        .ceil()
        .max(1.0) as u64;
    sim_tick / interval_ticks
}

/// Export proceeds are civic funding for imports, so every exchange resolves
/// exports before imports regardless of stable commodity code.
pub fn trade_rule_settlement_key(mode: u8, commodity_kind: u8) -> (u8, u8) {
    let priority = match mode {
        TRADE_MODE_EXPORT => 0,
        TRADE_MODE_IMPORT => 1,
        _ => 2,
    };
    (priority, commodity_kind)
}

pub fn exportable_surplus(public_stock_outside_post: f64, target_surplus: f64) -> f64 {
    (public_stock_outside_post.max(0.0) - clamp_trade_surplus(target_surplus))
        .floor()
        .max(0.0)
}

pub fn import_deficit(public_stock: f64, target_surplus: f64) -> f64 {
    (clamp_trade_surplus(target_surplus) - public_stock.max(0.0))
        .floor()
        .max(0.0)
}

pub fn affordable_import_units(deficit: f64, room: f64, gold: f64, unit_price: f64) -> f64 {
    if !unit_price.is_finite() || unit_price <= 1e-9 {
        return 0.0;
    }
    deficit
        .max(0.0)
        .min(room.max(0.0))
        .min((gold.max(0.0) / unit_price).floor())
        .floor()
}

pub fn trade_gold(units: f64, unit_price: f64) -> f64 {
    if !units.is_finite() || !unit_price.is_finite() {
        return 0.0;
    }
    ((units.max(0.0) * unit_price.max(0.0)) * 100.0).round() / 100.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::balance_generated::{BASE_SPEED_DENOMINATOR, BASE_SPEED_NUMERATOR};

    #[test]
    fn export_never_crosses_the_player_floor() {
        assert_eq!(exportable_surplus(130.9, 100.0), 30.0);
        assert_eq!(exportable_surplus(99.0, 100.0), 0.0);
    }

    #[test]
    fn imports_are_partial_when_storage_or_gold_is_short() {
        let deficit = import_deficit(18.0, 50.0);
        assert_eq!(deficit, 32.0);
        assert_eq!(affordable_import_units(deficit, 20.0, 17.0, 2.0), 8.0);
    }

    #[test]
    fn targets_are_whole_bounded_units() {
        assert_eq!(clamp_trade_surplus(12.6), 13.0);
        assert_eq!(clamp_trade_surplus(20_000.0), MAX_TRADE_SURPLUS);
        assert_eq!(clamp_trade_surplus(f64::NAN), 0.0);
    }

    #[test]
    fn regional_exchange_repeats_twice_inside_thirty_real_seconds_at_four_x() {
        let real_seconds_per_exchange = REGIONAL_EXCHANGE_INTERVAL_SECONDS
            / (4.0 * BASE_SPEED_NUMERATOR as f64 / BASE_SPEED_DENOMINATOR as f64);
        assert!(real_seconds_per_exchange * 2.0 < 30.0);

        let interval_ticks = (REGIONAL_EXCHANGE_INTERVAL_SECONDS / TICK_DT).round() as u64;
        assert_eq!(regional_exchange_sequence(interval_ticks - 1), 0);
        assert_eq!(regional_exchange_sequence(interval_ticks), 1);
        assert_eq!(regional_exchange_sequence(interval_ticks * 2), 2);
    }

    #[test]
    fn exports_can_fund_imports_in_the_same_exchange() {
        assert!(
            trade_rule_settlement_key(TRADE_MODE_EXPORT, u8::MAX)
                < trade_rule_settlement_key(TRADE_MODE_IMPORT, 0)
        );
        let export_revenue = trade_gold(10.0, 1.0);
        assert_eq!(affordable_import_units(10.0, 10.0, export_revenue, 2.0), 5.0);
    }
}
