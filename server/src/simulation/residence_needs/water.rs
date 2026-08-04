use crate::constants::{
    RESIDENCE_WATER_PER_PERSON_PER_SEC, RESIDENCE_WATER_REORDER_FRACTION, TICK_DT,
};
use crate::economy::residence_water_capacity;
use crate::simulation::residence_needs::kinds::ResidenceNeedKind;
use crate::simulation::residence_needs::state::NeedState;
use crate::simulation::residence_needs::supply::ResidenceNeedSupplyContext;
use crate::tables::Residence;

#[derive(Clone, Copy, Debug)]
pub enum ConsumeOutcome {
    Met(NeedState),
    Unmet,
}

pub fn consume(residence: &Residence, need: &NeedState) -> ConsumeOutcome {
    let demand = residence.population as f64 * RESIDENCE_WATER_PER_PERSON_PER_SEC * TICK_DT;
    if demand <= 1e-9 {
        return ConsumeOutcome::Met(*need);
    }

    if need.stock + 1e-9 >= demand {
        return ConsumeOutcome::Met(NeedState {
            stock: need.stock - demand,
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

pub fn evaluate_recovery(
    need: &NeedState,
    supply: &ResidenceNeedSupplyContext,
    stock_min: f64,
) -> bool {
    supply.has_route(ResidenceNeedKind::Water) && need.stock + 1e-9 >= stock_min
}

pub fn apply_delivery(need: &NeedState, delivered: f64) -> NeedState {
    NeedState {
        stock: need.stock + delivered,
        deficit_ticks: 0,
        ..*need
    }
}

pub fn stock_capacity() -> f64 {
    residence_water_capacity()
}

pub fn has_stock_room(stock: f64) -> bool {
    stock + 1e-6 < stock_capacity() * RESIDENCE_WATER_REORDER_FRACTION
}

#[cfg(test)]
mod tests {
    use super::{has_stock_room, stock_capacity};
    use crate::balance_generated::{
        CALENDAR_SECONDS_PER_DAY, RESIDENCE_WATER_PER_PERSON_PER_SEC,
        RESIDENCE_WATER_REORDER_FRACTION, WELL_WATER_PER_DELIVERY,
    };

    #[test]
    fn households_wait_for_a_substantial_water_refill() {
        let reorder_stock = stock_capacity() * RESIDENCE_WATER_REORDER_FRACTION;
        assert!(!has_stock_room(stock_capacity()));
        assert!(!has_stock_room(reorder_stock));
        assert!(has_stock_room(reorder_stock - 0.01));
        assert!((stock_capacity() - reorder_stock - WELL_WATER_PER_DELIVERY).abs() < 1e-9);
    }

    #[test]
    fn one_water_run_last_multiple_days_for_each_household_size() {
        let days_per_load = |population: f64| {
            WELL_WATER_PER_DELIVERY
                / (population * RESIDENCE_WATER_PER_PERSON_PER_SEC * CALENDAR_SECONDS_PER_DAY)
        };
        assert!(days_per_load(2.0) > 5.5);
        assert!(days_per_load(3.0) > 3.7);
        assert!(days_per_load(4.0) > 2.7);
    }
}
