//! Small, legible local price bands driven by real service-point stock.

use crate::balance_generated::{
    LOCAL_MARKET_PRICE_MULTIPLIER_MAX, LOCAL_MARKET_PRICE_MULTIPLIER_MIN,
};

pub fn local_market_price_multiplier(stock: f64, capacity: f64) -> f64 {
    if !stock.is_finite() || !capacity.is_finite() || capacity <= 1e-9 {
        return LOCAL_MARKET_PRICE_MULTIPLIER_MAX;
    }
    let fullness = (stock.max(0.0) / capacity).clamp(0.0, 1.0);
    LOCAL_MARKET_PRICE_MULTIPLIER_MAX
        - fullness * (LOCAL_MARKET_PRICE_MULTIPLIER_MAX - LOCAL_MARKET_PRICE_MULTIPLIER_MIN)
}

pub fn local_market_unit_price(base_price: f64, stock: f64, capacity: f64) -> f64 {
    base_price.max(0.0) * local_market_price_multiplier(stock, capacity)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fuller_stalls_are_cheaper_within_the_authored_band() {
        let scarce = local_market_price_multiplier(0.0, 100.0);
        let fair = local_market_price_multiplier(50.0, 100.0);
        let abundant = local_market_price_multiplier(100.0, 100.0);
        assert_eq!(scarce, LOCAL_MARKET_PRICE_MULTIPLIER_MAX);
        assert!(scarce > fair && fair > abundant);
        assert_eq!(abundant, LOCAL_MARKET_PRICE_MULTIPLIER_MIN);
    }
}
