//! Delivery cargo withdraw/deposit — one path for all residence need kinds.

use spacetimedb::ReducerContext;

use crate::economy::{
    withdraw_building, withdraw_building_food, withdraw_building_water,
    withdraw_building_commodity, CommodityKind,
};
use crate::simulation::residence_needs::{
    load_needs, need_stock, ResidenceNeedKind,
};
use crate::simulation::residence_needs::{firewood, food, provisions, water};
use crate::tables::Building;

#[derive(Clone, Copy, Debug, Default)]
pub struct DeliveryCargoTotals {
    pub timber: f64,
    pub firewood: f64,
    pub water: f64,
    pub food: f64,
    pub grain: f64,
    pub flour: f64,
    pub ale: f64,
    pub preserved_food: f64,
    pub honey: f64,
    pub wine: f64,
    pub stone: f64,
}

impl DeliveryCargoTotals {
    pub fn add_commodity(&mut self, kind: CommodityKind, amount: f64) {
        match kind {
            CommodityKind::Timber => self.timber += amount,
            CommodityKind::Firewood => self.firewood += amount,
            CommodityKind::Water => self.water += amount,
            CommodityKind::Food => self.food += amount,
            CommodityKind::Grain => self.grain += amount,
            CommodityKind::Flour => self.flour += amount,
            CommodityKind::Ale => self.ale += amount,
            CommodityKind::PreservedFood => self.preserved_food += amount,
            CommodityKind::Honey => self.honey += amount,
            CommodityKind::Wine => self.wine += amount,
            CommodityKind::Stone => self.stone += amount,
        }
    }
}

pub fn building_delivery_stock(building: &Building, kind: ResidenceNeedKind) -> f64 {
    match kind {
        ResidenceNeedKind::Firewood => building.firewood,
        ResidenceNeedKind::Water => building.water,
        ResidenceNeedKind::Food => building.food,
        ResidenceNeedKind::Ale => building.ale,
        ResidenceNeedKind::PreservedFood => building.preserved_food,
    }
}

pub fn withdraw_delivery_cargo(
    building: &mut Building,
    kind: ResidenceNeedKind,
    amount: f64,
) -> f64 {
    match kind {
        ResidenceNeedKind::Firewood => {
            let (_, firewood_withdrawn, _, updated) = withdraw_building(building, 0.0, amount, 0.0);
            *building = updated;
            firewood_withdrawn
        }
        ResidenceNeedKind::Water => {
            let (withdrawn, updated) = withdraw_building_water(building, amount);
            *building = updated;
            withdrawn
        }
        ResidenceNeedKind::Food => {
            let (withdrawn, updated) = withdraw_building_food(building, amount);
            *building = updated;
            withdrawn
        }
        ResidenceNeedKind::Ale => withdraw_building_commodity(building, CommodityKind::Ale, amount),
        ResidenceNeedKind::PreservedFood => {
            withdraw_building_commodity(building, CommodityKind::PreservedFood, amount)
        }
    }
}

pub fn delivery_stock_room(kind: ResidenceNeedKind, stock: f64) -> f64 {
    match kind {
        ResidenceNeedKind::Firewood => (firewood::stock_capacity() - stock).max(0.0),
        ResidenceNeedKind::Water => (water::stock_capacity() - stock).max(0.0),
        ResidenceNeedKind::Food => (food::stock_capacity() - stock).max(0.0),
        ResidenceNeedKind::Ale | ResidenceNeedKind::PreservedFood => {
            (provisions::stock_capacity(kind) - stock).max(0.0)
        }
    }
}

pub fn has_delivery_stock_room(kind: ResidenceNeedKind, stock: f64) -> bool {
    match kind {
        ResidenceNeedKind::Firewood => firewood::has_stock_room(stock),
        ResidenceNeedKind::Water => water::has_stock_room(stock),
        ResidenceNeedKind::Food => food::has_stock_room(stock),
        ResidenceNeedKind::Ale | ResidenceNeedKind::PreservedFood => {
            stock + 1e-6 < provisions::stock_capacity(kind)
        }
    }
}

pub fn residence_delivery_room(
    ctx: &ReducerContext,
    residence_id: u64,
    kind: ResidenceNeedKind,
) -> f64 {
    let stock = need_stock(&load_needs(ctx, residence_id), kind);
    delivery_stock_room(kind, stock)
}

pub fn any_target_needs_delivery(
    ctx: &ReducerContext,
    targets: &[crate::tables::Residence],
    kind: ResidenceNeedKind,
) -> bool {
    targets.iter().any(|residence| {
        has_delivery_stock_room(kind, need_stock(&load_needs(ctx, residence.id), kind))
    })
}

pub fn collect_claimed_delivery_targets<F>(
    residences: Vec<crate::tables::Residence>,
    claims: &std::collections::HashMap<u64, u64>,
    building_id: u64,
    mut sort: F,
) -> Vec<crate::tables::Residence>
where
    F: FnMut(&mut Vec<crate::tables::Residence>),
{
    let mut targets: Vec<crate::tables::Residence> = residences
        .into_iter()
        .filter(|residence| claims.get(&residence.id).copied() == Some(building_id))
        .collect();
    sort(&mut targets);
    targets
}

pub fn pick_delivery_target(
    ctx: &ReducerContext,
    available: f64,
    batch: f64,
    targets: &[crate::tables::Residence],
    kind: ResidenceNeedKind,
) -> Option<(u64, f64, f64, f64)> {
    for residence in targets {
        let stock = need_stock(&load_needs(ctx, residence.id), kind);
        if !has_delivery_stock_room(kind, stock) {
            continue;
        }
        let room = delivery_stock_room(kind, stock);
        if room <= 1e-6 {
            continue;
        }
        let load = available.min(room).min(batch);
        if load <= 1e-6 {
            continue;
        }
        return Some((residence.id, residence.x, residence.z, load));
    }
    None
}
