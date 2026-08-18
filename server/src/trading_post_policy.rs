use crate::balance_generated::CALENDAR_DAYS_PER_MONTH;

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

pub fn absolute_calendar_month(total_days: u64) -> u64 {
    total_days / CALENDAR_DAYS_PER_MONTH as u64
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
}
