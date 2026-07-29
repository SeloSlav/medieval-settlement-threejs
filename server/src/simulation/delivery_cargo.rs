//! Delivery cargo withdraw/deposit — one path for all residence need kinds.

use spacetimedb::ReducerContext;

use crate::economy::{
    withdraw_building, withdraw_building_commodity, withdraw_building_food,
    withdraw_building_water, CommodityKind,
};
use crate::simulation::residence_needs::{firewood, food, provisions, water};
use crate::simulation::residence_needs::{load_needs, need_stock, ResidenceNeedKind};
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
    pub ironwork: f64,
    pub stone: f64,
    pub polearms: f64,
    pub wool: f64,
    pub cloth: f64,
    pub gold: f64,
    pub barley: f64,
    pub malt: f64,
    pub flax: f64,
    pub iron: f64,
    pub clay: f64,
    pub salt: f64,
    pub charcoal: f64,
    pub pottery: f64,
    pub manure: f64,
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
            CommodityKind::Ironwork => self.ironwork += amount,
            CommodityKind::Stone => self.stone += amount,
            CommodityKind::Polearms => self.polearms += amount,
            CommodityKind::Wool => self.wool += amount,
            CommodityKind::Cloth => self.cloth += amount,
            CommodityKind::Gold => self.gold += amount,
            CommodityKind::Barley => self.barley += amount,
            CommodityKind::Malt => self.malt += amount,
            CommodityKind::Flax => self.flax += amount,
            CommodityKind::Iron => self.iron += amount,
            CommodityKind::Clay => self.clay += amount,
            CommodityKind::Salt => self.salt += amount,
            CommodityKind::Charcoal => self.charcoal += amount,
            CommodityKind::Pottery => self.pottery += amount,
            CommodityKind::Manure => self.manure += amount,
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
        ResidenceNeedKind::Cloth => building.cloth,
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
        ResidenceNeedKind::Cloth => {
            withdraw_building_commodity(building, CommodityKind::Cloth, amount)
        }
    }
}

pub fn delivery_stock_room(kind: ResidenceNeedKind, stock: f64) -> f64 {
    match kind {
        ResidenceNeedKind::Firewood => (firewood::stock_capacity() - stock).max(0.0),
        ResidenceNeedKind::Water => (water::stock_capacity() - stock).max(0.0),
        ResidenceNeedKind::Food => (food::stock_capacity() - stock).max(0.0),
        ResidenceNeedKind::Ale | ResidenceNeedKind::PreservedFood | ResidenceNeedKind::Cloth => {
            (provisions::stock_capacity(kind) - stock).max(0.0)
        }
    }
}

pub fn has_delivery_stock_room(kind: ResidenceNeedKind, stock: f64) -> bool {
    match kind {
        ResidenceNeedKind::Firewood => firewood::has_stock_room(stock),
        ResidenceNeedKind::Water => water::has_stock_room(stock),
        ResidenceNeedKind::Food => food::has_stock_room(stock),
        ResidenceNeedKind::Ale | ResidenceNeedKind::PreservedFood | ResidenceNeedKind::Cloth => {
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

pub fn pick_delivery_target(
    ctx: &ReducerContext,
    available: f64,
    batch: f64,
    targets: &[crate::tables::Residence],
    kind: ResidenceNeedKind,
    target_is_operational: impl Fn(u64) -> bool,
) -> Option<(u64, f64, f64, f64)> {
    for residence in targets {
        if !target_is_operational(residence.id) {
            continue;
        }
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
