use crate::balance_generated::{
    MARKET_PRICE_MULTIPLIER_MAX, MARKET_PRICE_MULTIPLIER_MIN, MARKET_REGIONAL_INDEX_DRIFT,
    MARKET_REGIONAL_INDEX_MEAN_REVERSION, MARKET_TRADE_IMPACT_PER_TEN_UNITS,
};
use crate::specialty_trade_policy::SpecialtyMarketFamily;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MarketTradeDirection {
    Import,
    Export,
}

pub fn drift_market_index(current: f64, random_unit: f64) -> f64 {
    let current = current.clamp(0.05, 0.95);
    let noise = (random_unit.clamp(0.0, 1.0) - 0.5) * 2.0 * MARKET_REGIONAL_INDEX_DRIFT;
    let recovery = (0.5 - current) * MARKET_REGIONAL_INDEX_MEAN_REVERSION;
    (current + recovery + noise).clamp(0.05, 0.95)
}

pub fn drift_market_index_toward(current: f64, target: f64, random_unit: f64) -> f64 {
    let current = current.clamp(0.05, 0.95);
    let target = target.clamp(0.05, 0.95);
    let noise = (random_unit.clamp(0.0, 1.0) - 0.5) * 2.0 * MARKET_REGIONAL_INDEX_DRIFT;
    let recovery = (target - current) * MARKET_REGIONAL_INDEX_MEAN_REVERSION;
    (current + recovery + noise).clamp(0.05, 0.95)
}

/// Neighboring demand follows readable seasonal rhythms without becoming a
/// fixed calendar exploit: random drift still moves each family around these
/// centers, while exports push only the family actually sold.
pub fn specialty_seasonal_demand_target(family: SpecialtyMarketFamily, month: u32) -> f64 {
    match family {
        SpecialtyMarketFamily::Drink => match month {
            9 | 10 => 0.62,
            11 | 12 | 1 => 0.70,
            4 | 5 => 0.44,
            _ => 0.52,
        },
        SpecialtyMarketFamily::Provision => match month {
            12 | 1 | 2 | 3 => 0.70,
            9 | 10 | 11 => 0.60,
            6 | 7 | 8 => 0.43,
            _ => 0.52,
        },
        SpecialtyMarketFamily::Wares => match month {
            2 | 3 | 4 | 9 | 10 | 11 => 0.63,
            6 | 7 => 0.44,
            _ => 0.53,
        },
    }
}

pub fn trade_impact(amount: f64) -> f64 {
    amount.max(0.0) / 10.0 * MARKET_TRADE_IMPACT_PER_TEN_UNITS
}

pub fn market_price_multiplier(supply: f64, demand: f64) -> f64 {
    let imbalance = demand.clamp(0.0, 1.0) - supply.clamp(0.0, 1.0);
    (1.0 + imbalance * 0.55).clamp(MARKET_PRICE_MULTIPLIER_MIN, MARKET_PRICE_MULTIPLIER_MAX)
}

pub fn specialty_price_multiplier(demand: f64) -> f64 {
    let demand = demand.clamp(0.0, 1.0);
    market_price_multiplier(1.0 - demand, demand)
}

pub fn adjust_supply_index(current: f64, direction: MarketTradeDirection, amount: f64) -> f64 {
    let signed_impact = match direction {
        MarketTradeDirection::Import => -trade_impact(amount),
        MarketTradeDirection::Export => trade_impact(amount),
    };
    (current + signed_impact).clamp(0.05, 0.95)
}

pub fn adjust_demand_index(current: f64, direction: MarketTradeDirection, amount: f64) -> f64 {
    let signed_impact = match direction {
        MarketTradeDirection::Import => trade_impact(amount),
        MarketTradeDirection::Export => -trade_impact(amount),
    };
    (current + signed_impact).clamp(0.05, 0.95)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imports_tighten_supply_and_raise_demand() {
        assert!(adjust_supply_index(0.5, MarketTradeDirection::Import, 10.0) < 0.5);
        assert!(adjust_demand_index(0.5, MarketTradeDirection::Import, 10.0) > 0.5);
    }

    #[test]
    fn exports_deepen_supply_and_relieve_demand() {
        assert!(adjust_supply_index(0.5, MarketTradeDirection::Export, 10.0) > 0.5);
        assert!(adjust_demand_index(0.5, MarketTradeDirection::Export, 10.0) < 0.5);
    }

    #[test]
    fn larger_trades_move_the_market_more() {
        let small = adjust_supply_index(0.5, MarketTradeDirection::Import, 5.0);
        let large = adjust_supply_index(0.5, MarketTradeDirection::Import, 20.0);
        assert!(large < small);
    }

    #[test]
    fn repeated_imports_raise_the_next_price() {
        let first_supply = adjust_supply_index(0.5, MarketTradeDirection::Import, 10.0);
        let second_supply = adjust_supply_index(first_supply, MarketTradeDirection::Import, 10.0);
        let first_price = market_price_multiplier(first_supply, 1.0 - first_supply);
        let second_price = market_price_multiplier(second_supply, 1.0 - second_supply);
        assert!(first_price > 1.0);
        assert!(second_price > first_price);
    }

    #[test]
    fn exports_lower_the_next_price() {
        let supply = adjust_supply_index(0.5, MarketTradeDirection::Export, 10.0);
        assert!(market_price_multiplier(supply, 1.0 - supply) < 1.0);
    }

    #[test]
    fn specialty_demand_maps_to_a_neutral_or_bounded_rate() {
        assert!((specialty_price_multiplier(0.5) - 1.0).abs() < 1e-9);
        assert_eq!(specialty_price_multiplier(0.0), MARKET_PRICE_MULTIPLIER_MIN);
        assert_eq!(specialty_price_multiplier(1.0), MARKET_PRICE_MULTIPLIER_MAX);
    }

    #[test]
    fn regional_drift_recovers_extreme_indices_toward_normal() {
        assert!(drift_market_index(0.9, 0.5) < 0.9);
        assert!(drift_market_index(0.1, 0.5) > 0.1);
    }

    #[test]
    fn specialty_families_have_distinct_seasons() {
        assert!(
            specialty_seasonal_demand_target(SpecialtyMarketFamily::Drink, 12)
                > specialty_seasonal_demand_target(SpecialtyMarketFamily::Drink, 5)
        );
        assert!(
            specialty_seasonal_demand_target(SpecialtyMarketFamily::Provision, 2)
                > specialty_seasonal_demand_target(SpecialtyMarketFamily::Provision, 7)
        );
        assert!(
            specialty_seasonal_demand_target(SpecialtyMarketFamily::Wares, 10)
                > specialty_seasonal_demand_target(SpecialtyMarketFamily::Wares, 7)
        );
    }

    #[test]
    fn market_indices_remain_bounded() {
        assert_eq!(
            adjust_supply_index(0.06, MarketTradeDirection::Import, 1000.0),
            0.05
        );
        assert_eq!(
            adjust_demand_index(0.94, MarketTradeDirection::Import, 1000.0),
            0.95
        );
    }
}
