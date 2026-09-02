pub use crate::balance_generated::{
    CARPENTER_IRONWORK_PER_POLEARM, CARPENTER_TIMBER_PER_POLEARM,
};
pub const CARPENTER_POLEARM_RESERVE_DEFAULT: u8 = 6;
pub const CARPENTER_POLEARM_RESERVE_MAX: u8 = 24;
pub const GUARDHOUSE_PAY_PRIORITY_LOW: u8 = 0;
pub const GUARDHOUSE_PAY_PRIORITY_NORMAL: u8 = 1;
pub const GUARDHOUSE_PAY_PRIORITY_HIGH: u8 = 2;
pub const GUARDHOUSE_FOOD_RESERVE_LEAN: u8 = 3;
pub const GUARDHOUSE_FOOD_RESERVE_STANDARD: u8 = 6;
pub const GUARDHOUSE_FOOD_RESERVE_DEEP: u8 = 12;

pub fn is_valid_carpenter_polearm_reserve(reserve: u8) -> bool {
    matches!(reserve, 0 | 2 | 6 | 12 | 24)
}

pub fn normalize_carpenter_polearm_reserve(reserve: u8) -> u8 {
    reserve.min(CARPENTER_POLEARM_RESERVE_MAX)
}

pub fn carpenter_polearm_shortfall(stock: f64, reserve: u8) -> f64 {
    (normalize_carpenter_polearm_reserve(reserve) as f64 - stock.max(0.0)).max(0.0)
}

pub fn is_valid_guardhouse_pay_priority(priority: u8) -> bool {
    (GUARDHOUSE_PAY_PRIORITY_LOW..=GUARDHOUSE_PAY_PRIORITY_HIGH).contains(&priority)
}

pub fn is_valid_guardhouse_food_reserve(reserve_per_guard: u8) -> bool {
    matches!(
        reserve_per_guard,
        GUARDHOUSE_FOOD_RESERVE_LEAN
            | GUARDHOUSE_FOOD_RESERVE_STANDARD
            | GUARDHOUSE_FOOD_RESERVE_DEEP
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn carpenter_reserve_turns_imported_fittings_into_an_explicit_choice() {
        assert!(is_valid_carpenter_polearm_reserve(0));
        assert!(is_valid_carpenter_polearm_reserve(6));
        assert!(is_valid_carpenter_polearm_reserve(24));
        assert!(!is_valid_carpenter_polearm_reserve(5));
        assert_eq!(normalize_carpenter_polearm_reserve(200), 24);
        assert_eq!(carpenter_polearm_shortfall(1.0, 6), 5.0);
        assert_eq!(carpenter_polearm_shortfall(8.0, 6), 0.0);
    }

}
