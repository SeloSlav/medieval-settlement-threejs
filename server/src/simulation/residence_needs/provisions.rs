use crate::balance_generated::{
    RESIDENCE_ALE_CAPACITY, RESIDENCE_ALE_PER_PERSON_PER_SEC, RESIDENCE_CLOTH_CAPACITY,
    RESIDENCE_CLOTH_PER_PERSON_PER_SEC, RESIDENCE_LUXURY_CAPACITY,
    RESIDENCE_LUXURY_JAM_PER_PERSON_PER_SEC, RESIDENCE_POTTERY_CAPACITY,
    RESIDENCE_SHOES_CAPACITY, RESIDENCE_SHOES_PER_PERSON_PER_SEC,
    RESIDENCE_POTTERY_PER_PERSON_PER_SEC, RESIDENCE_PRESERVED_FOOD_CAPACITY,
    RESIDENCE_PRESERVED_FOOD_PER_PERSON_PER_SEC, TICK_DT,
};
use crate::simulation::residence_needs::kinds::ResidenceNeedKind;
use crate::simulation::residence_needs::state::NeedState;
use crate::tables::Residence;

#[derive(Clone, Copy, Debug)]
pub enum ConsumeOutcome {
    Met(NeedState),
    Unmet,
}

pub fn consume_ale(residence: &Residence, need: &NeedState) -> ConsumeOutcome {
    consume(residence, need, RESIDENCE_ALE_PER_PERSON_PER_SEC)
}

pub fn consume_preserved_food(residence: &Residence, need: &NeedState) -> ConsumeOutcome {
    consume(residence, need, RESIDENCE_PRESERVED_FOOD_PER_PERSON_PER_SEC)
}

pub fn preserved_food_demand(residence: &Residence, seasonal_multiplier: f64) -> f64 {
    residence.population as f64
        * RESIDENCE_PRESERVED_FOOD_PER_PERSON_PER_SEC
        * TICK_DT
        * seasonal_multiplier.max(0.0)
}

pub fn consume_cloth(residence: &Residence, need: &NeedState) -> ConsumeOutcome {
    consume(residence, need, RESIDENCE_CLOTH_PER_PERSON_PER_SEC)
}

pub fn consume_shoes(residence: &Residence, need: &NeedState) -> ConsumeOutcome {
    consume(residence, need, RESIDENCE_SHOES_PER_PERSON_PER_SEC)
}

/// Models replacement of broken cooking, serving, and storage vessels rather
/// than literal daily consumption.
pub fn consume_pottery(residence: &Residence, need: &NeedState) -> ConsumeOutcome {
    consume(residence, need, RESIDENCE_POTTERY_PER_PERSON_PER_SEC)
}

pub fn consume_luxury(residence: &Residence, need: &NeedState) -> ConsumeOutcome {
    consume(residence, need, RESIDENCE_LUXURY_JAM_PER_PERSON_PER_SEC)
}

fn consume(residence: &Residence, need: &NeedState, rate: f64) -> ConsumeOutcome {
    let demand = residence.population as f64 * rate * TICK_DT;
    if demand <= 1e-9 || need.stock + 1e-9 >= demand {
        return ConsumeOutcome::Met(NeedState {
            stock: (need.stock - demand).max(0.0),
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
        stock: need.stock + delivered,
        deficit_ticks: 0,
        ..*need
    }
}

pub fn stock_capacity(kind: ResidenceNeedKind) -> f64 {
    match kind {
        ResidenceNeedKind::Ale => RESIDENCE_ALE_CAPACITY,
        ResidenceNeedKind::PreservedFood => RESIDENCE_PRESERVED_FOOD_CAPACITY,
        ResidenceNeedKind::Cloth => RESIDENCE_CLOTH_CAPACITY,
        ResidenceNeedKind::Shoes => RESIDENCE_SHOES_CAPACITY,
        ResidenceNeedKind::Pottery => RESIDENCE_POTTERY_CAPACITY,
        ResidenceNeedKind::Luxury => RESIDENCE_LUXURY_CAPACITY,
        _ => 0.0,
    }
}
