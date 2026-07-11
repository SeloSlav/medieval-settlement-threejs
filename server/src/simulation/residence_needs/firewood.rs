use crate::constants::{
    RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC, RESIDENCE_RECOVERY_FIREWOOD_MIN, TICK_DT,
};
use crate::economy::residence_firewood_capacity;
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
    let demand = residence.population as f64 * RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC * TICK_DT;
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

pub fn evaluate_recovery(need: &NeedState, supply: &ResidenceNeedSupplyContext) -> bool {
    supply.has_route(ResidenceNeedKind::Firewood)
        && need.stock + 1e-9 >= RESIDENCE_RECOVERY_FIREWOOD_MIN
}

pub fn apply_delivery(need: &NeedState, delivered: f64) -> NeedState {
    NeedState {
        stock: need.stock + delivered,
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
