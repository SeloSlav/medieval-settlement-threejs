use crate::economy::residence_firewood_capacity;
use crate::resource_units::{whole_transfer, whole_units};
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
    residence_firewood_capacity()
}

pub fn has_stock_room(stock: f64) -> bool {
    stock + 1e-6 < stock_capacity()
}
