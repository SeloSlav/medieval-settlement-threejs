use crate::constants::{RESIDENCE_FOOD_PER_PERSON_PER_SEC, TICK_DT};
use crate::economy::residence_food_capacity;
use crate::simulation::residence_needs::state::NeedState;
use crate::tables::Residence;

#[derive(Clone, Copy, Debug)]
pub enum ConsumeOutcome {
    Met(NeedState),
    Unmet,
}

pub fn consume(
    residence: &Residence,
    need: &NeedState,
    spoilage_fraction_per_second: f64,
) -> ConsumeOutcome {
    let spoiled = spoil(need, spoilage_fraction_per_second);
    let demand = demand(residence);
    if demand <= 1e-9 {
        return ConsumeOutcome::Met(spoiled);
    }

    if spoiled.stock + 1e-9 >= demand {
        return ConsumeOutcome::Met(NeedState {
            stock: spoiled.stock - demand,
            ..spoiled
        });
    }

    ConsumeOutcome::Unmet
}

pub fn demand(residence: &Residence) -> f64 {
    residence.population as f64 * RESIDENCE_FOOD_PER_PERSON_PER_SEC * TICK_DT
}

pub fn spoil(need: &NeedState, spoilage_fraction_per_second: f64) -> NeedState {
    NeedState {
        stock: (need.stock - need.stock * spoilage_fraction_per_second.max(0.0) * TICK_DT).max(0.0),
        ..*need
    }
}

pub fn on_unmet(need: &NeedState) -> NeedState {
    NeedState {
        stock: 0.0,
        ..*need
    }
}

pub fn apply_delivery(need: &NeedState, delivered: f64) -> NeedState {
    NeedState {
        stock: need.stock + delivered,
        deficit_ticks: 0,
        ..*need
    }
}

pub fn stock_capacity() -> f64 {
    residence_food_capacity()
}

pub fn has_stock_room(stock: f64) -> bool {
    stock + 1e-6 < stock_capacity()
}
