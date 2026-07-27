use crate::balance_generated::STOREHOUSE_HAUL_PER_WORKER;

/// Local fares and visitor gifts leave their source in useful batches rather
/// than launching nearly empty carts every simulation tick. Callers pass one
/// ordinary day of source income as the collection threshold.
pub fn civic_receipt_cart_load(held_gold: f64, daily_income: f64) -> f64 {
    if !held_gold.is_finite() || !daily_income.is_finite() {
        return 0.0;
    }
    let threshold = daily_income.max(0.1);
    if held_gold + 1e-9 < threshold {
        return 0.0;
    }
    held_gold.clamp(0.0, STOREHOUSE_HAUL_PER_WORKER)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn receipts_wait_for_a_meaningful_daily_batch() {
        assert_eq!(civic_receipt_cart_load(1.99, 2.0), 0.0);
        assert_eq!(civic_receipt_cart_load(2.0, 2.0), 2.0);
    }

    #[test]
    fn collection_uses_one_bounded_handcart() {
        assert_eq!(
            civic_receipt_cart_load(STOREHOUSE_HAUL_PER_WORKER * 2.0, 2.0),
            STOREHOUSE_HAUL_PER_WORKER
        );
        assert_eq!(civic_receipt_cart_load(f64::NAN, 2.0), 0.0);
        assert_eq!(civic_receipt_cart_load(4.0, f64::NAN), 0.0);
    }
}
