use crate::economy::residence_food_capacity;
use crate::simulation::residence_needs::state::NeedState;

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
