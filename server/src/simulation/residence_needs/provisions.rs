use crate::balance_generated::{
    RESIDENCE_ALE_CAPACITY, RESIDENCE_CLOTH_CAPACITY, RESIDENCE_LUXURY_CAPACITY,
    RESIDENCE_POTTERY_CAPACITY, RESIDENCE_PRESERVED_FOOD_CAPACITY, RESIDENCE_SHOES_CAPACITY,
};
use crate::resource_units::{whole_transfer, whole_units};
use crate::simulation::residence_needs::kinds::ResidenceNeedKind;
use crate::simulation::residence_needs::state::NeedState;

#[derive(Clone, Copy, Debug)]
pub enum ConsumeOutcome {
    Met(NeedState),
    Unmet,
}

pub fn consume_units(need: &NeedState, units: f64) -> ConsumeOutcome {
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

pub fn stock_capacity(kind: ResidenceNeedKind) -> f64 {
    match kind {
        ResidenceNeedKind::Ale => RESIDENCE_ALE_CAPACITY,
        ResidenceNeedKind::SavoryPreserves => RESIDENCE_PRESERVED_FOOD_CAPACITY,
        ResidenceNeedKind::Cloth => RESIDENCE_CLOTH_CAPACITY,
        ResidenceNeedKind::Shoes => RESIDENCE_SHOES_CAPACITY,
        ResidenceNeedKind::Pottery => RESIDENCE_POTTERY_CAPACITY,
        ResidenceNeedKind::Luxury => RESIDENCE_LUXURY_CAPACITY,
        _ => 0.0,
    }
}
