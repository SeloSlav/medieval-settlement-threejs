use crate::constants::RESIDENCE_WATER_REORDER_FRACTION;
use crate::economy::residence_water_capacity;
use crate::resource_units::{whole_cost, whole_transfer, whole_units};
use crate::simulation::residence_needs::state::NeedState;

#[derive(Clone, Copy, Debug)]
pub enum ConsumeOutcome {
    Met(NeedState),
    Unmet,
}

pub fn consume(need: &NeedState, units: f64) -> ConsumeOutcome {
    let demand = whole_units(units);
    if demand < 1.0 {
        return ConsumeOutcome::Met(*need);
    }

    let consumed = whole_transfer(need.stock, demand);
    if consumed >= demand {
        return ConsumeOutcome::Met(NeedState {
            stock: whole_units(need.stock) - consumed,
            ..*need
        });
    }

    ConsumeOutcome::Unmet
}

pub fn on_unmet(need: &NeedState) -> NeedState {
    NeedState {
        stock: 0.0,
        ..*need
    }
}

pub fn apply_delivery(need: &NeedState, delivered: f64) -> NeedState {
    NeedState {
        stock: whole_units(need.stock) + whole_units(delivered),
        deficit_ticks: 0,
        ..*need
    }
}

pub fn stock_capacity() -> f64 {
    residence_water_capacity()
}

pub fn has_stock_room(stock: f64) -> bool {
    let reorder_stock = whole_cost(stock_capacity() * RESIDENCE_WATER_REORDER_FRACTION);
    whole_units(stock) < reorder_stock
}

#[cfg(test)]
mod tests {
    use super::{has_stock_room, stock_capacity};
    use crate::balance_generated::{
        RESIDENCE_WATER_REORDER_FRACTION, RESIDENCE_WATER_UNITS_PER_DAY, WELL_WATER_PER_DELIVERY,
    };

    #[test]
    fn households_wait_for_a_substantial_water_refill() {
        let reorder_stock = stock_capacity() * RESIDENCE_WATER_REORDER_FRACTION;
        assert!(!has_stock_room(stock_capacity()));
        assert!(!has_stock_room(reorder_stock));
        assert!(has_stock_room(reorder_stock - 1.0));
        assert!((stock_capacity() - reorder_stock - WELL_WATER_PER_DELIVERY).abs() < 1e-9);
    }

    #[test]
    fn one_water_run_is_measured_against_the_household_daily_bill() {
        let days_per_load = WELL_WATER_PER_DELIVERY / RESIDENCE_WATER_UNITS_PER_DAY;
        assert_eq!(days_per_load, 16.0);
    }
}
