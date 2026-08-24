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

/// Imports share one civic treasury, so a stable commodity-code ordering can
/// otherwise let the first recurring deficit consume every exchange's coin
/// forever. Keep the ordering deterministic for replay/save compatibility,
/// but rotate which import gets the first funding opportunity each window.
pub fn import_rule_rotation_offset(current_exchange: u64, import_count: usize) -> usize {
    if import_count == 0 {
        return 0;
    }
    (current_exchange % import_count as u64) as usize
}

/// Compare recurring imports by how much of their requested public buffer is
/// already present. The least-served rule receives the next real-gold funding
/// opportunity; a value of one means the target is already satisfied.
pub fn import_target_fulfillment(public_stock: f64, target_surplus: f64) -> f64 {
    let target = clamp_trade_surplus(target_surplus);
    if target <= 1e-9 {
        return 1.0;
    }
    (public_stock.max(0.0) / target).clamp(0.0, 1.0)
}

/// Trading Posts reuse their otherwise idle `Building::action_cooldown` as a
/// saved route cursor. Advancing it only after a successful dispatch prevents
/// cart travel time from phase-locking one commodity to `sim_tick % routes`.
pub fn trading_post_service_route_order(cursor: f64, route_count: usize) -> Vec<usize> {
    if route_count == 0 {
        return Vec::new();
    }
    let start = if cursor.is_finite() && cursor >= 0.0 {
        cursor.floor() as usize % route_count
    } else {
        0
    };
    (0..route_count)
        .map(|offset| (start + offset) % route_count)
        .collect()
}

pub fn trading_post_service_cursor_after_success(
    dispatched_route_index: usize,
    route_count: usize,
) -> f64 {
    if route_count == 0 {
        return 0.0;
    }
    ((dispatched_route_index + 1) % route_count) as f64
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
        .min(gold.max(0.0) / unit_price)
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
        assert_eq!(affordable_import_units(deficit, 20.0, 17.0, 2.0), 8.5);
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
        let export_revenue = 10.0;
        assert_eq!(
            affordable_import_units(10.0, 10.0, export_revenue, 2.0),
            5.0
        );
    }

    #[test]
    fn recurring_imports_rotate_the_first_funding_opportunity() {
        assert_eq!(import_rule_rotation_offset(0, 0), 0);
        assert_eq!(import_rule_rotation_offset(0, 3), 0);
        assert_eq!(import_rule_rotation_offset(1, 3), 1);
        assert_eq!(import_rule_rotation_offset(2, 3), 2);
        assert_eq!(import_rule_rotation_offset(3, 3), 0);

        let sorted_commodity_codes = [6_u8, 14, 60];
        let count = sorted_commodity_codes.len();
        let mut exchange_one = sorted_commodity_codes;
        exchange_one.rotate_left(import_rule_rotation_offset(1, count));
        assert_eq!(exchange_one, [14, 60, 6]);
        let mut exchange_two = sorted_commodity_codes;
        exchange_two.rotate_left(import_rule_rotation_offset(2, count));
        assert_eq!(exchange_two, [60, 6, 14]);
    }

    #[test]
    fn the_least_fulfilled_import_gets_first_claim_on_real_coin() {
        assert_eq!(import_target_fulfillment(0.0, 12.0), 0.0);
        assert_eq!(import_target_fulfillment(3.0, 12.0), 0.25);
        assert_eq!(import_target_fulfillment(12.0, 12.0), 1.0);
        assert_eq!(import_target_fulfillment(20.0, 12.0), 1.0);
        assert_eq!(import_target_fulfillment(0.0, 0.0), 1.0);

        let ale_fulfillment = import_target_fulfillment(0.0, 12.0);
        let cloth_fulfillment = import_target_fulfillment(4.85, 12.0);
        assert!(ale_fulfillment < cloth_fulfillment);
    }

    #[test]
    fn successful_local_carts_advance_a_saved_starvation_free_route_cursor() {
        let mut eligible = [false; 12];
        for index in [4_usize, 7, 8, 9] {
            eligible[index] = true;
        }
        let mut cursor = 0.0;
        let mut selected = Vec::new();
        for _ in 0..8 {
            let route = trading_post_service_route_order(cursor, eligible.len())
                .into_iter()
                .find(|index| eligible[*index])
                .expect("one imported service route remains eligible");
            selected.push(route);
            cursor = trading_post_service_cursor_after_success(route, eligible.len());
        }
        assert_eq!(selected, [4, 7, 8, 9, 4, 7, 8, 9]);
        assert_eq!(trading_post_service_route_order(f64::NAN, 3), [0, 1, 2]);
        assert_eq!(
            trading_post_service_route_order(8.0, 0),
            Vec::<usize>::new()
        );
    }

    #[test]
    fn treasury_limited_repeated_exchanges_fund_every_recurring_import() {
        let unit_prices = [1.5_f64, 2.75, 3.25];
        let mut imported = [0.0_f64; 3];
        let mut treasury = 0.0_f64;
        let mut total_export_revenue = 0.0_f64;
        let mut total_spent = 0.0_f64;

        for _exchange in 0..6 {
            // Real staged exports add only three gold each window. Treat all
            // imported stock as consumed before the next exchange, reproducing
            // recurring zero-public-stock demand rather than a one-shot fill.
            treasury += 3.0;
            total_export_revenue += 3.0;
            for index in 0..unit_prices.len() {
                let remaining = unit_prices.len() - index;
                let budget = (treasury / remaining as f64).floor();
                let units = affordable_import_units(12.0, 100.0, budget, unit_prices[index]);
                let expense = (units * unit_prices[index]).floor();
                assert!(expense <= budget + 1e-9);
                treasury = (treasury - expense).max(0.0);
                total_spent += expense;
                imported[index] += units;
            }
        }

        assert!(imported.into_iter().all(|units| units > 0.0));
        assert!(total_spent <= total_export_revenue + 1e-9);
        assert!((total_export_revenue - total_spent - treasury).abs() < 1e-9);
    }
}
