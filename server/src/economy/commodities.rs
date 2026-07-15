use spacetimedb::ReducerContext;

use crate::building_defs::building_def;
use crate::db::*;
use crate::tables::Building;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
pub enum CommodityKind {
    Firewood,
    Water,
    Food,
    Timber,
    Grain,
    Flour,
    Ale,
    PreservedFood,
    Honey,
    Wine,
    Stone,
}

impl CommodityKind {
    pub fn as_u8(self) -> u8 {
        match self {
            Self::Firewood => 0,
            Self::Water => 1,
            Self::Food => 2,
            Self::Timber => 3,
            Self::Grain => 4,
            Self::Flour => 5,
            Self::Ale => 6,
            Self::PreservedFood => 7,
            Self::Honey => 8,
            Self::Wine => 9,
            Self::Stone => 10,
        }
    }

    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            0 => Some(Self::Firewood),
            1 => Some(Self::Water),
            2 => Some(Self::Food),
            3 => Some(Self::Timber),
            4 => Some(Self::Grain),
            5 => Some(Self::Flour),
            6 => Some(Self::Ale),
            7 => Some(Self::PreservedFood),
            8 => Some(Self::Honey),
            9 => Some(Self::Wine),
            10 => Some(Self::Stone),
            _ => None,
        }
    }
}

pub fn building_commodity_stock(building: &Building, kind: CommodityKind) -> f64 {
    match kind {
        CommodityKind::Firewood => building.firewood,
        CommodityKind::Water => building.water,
        CommodityKind::Food => building.food,
        CommodityKind::Timber => building.timber,
        CommodityKind::Grain => building.grain,
        CommodityKind::Flour => building.flour,
        CommodityKind::Ale => building.ale,
        CommodityKind::PreservedFood => building.preserved_food,
        CommodityKind::Honey => building.honey,
        CommodityKind::Wine => building.wine,
        CommodityKind::Stone => building.stone,
    }
}

pub fn building_commodity_cap(kind: &str, commodity: CommodityKind) -> f64 {
    let Some(def) = building_def(kind) else {
        return 0.0;
    };
    match commodity {
        CommodityKind::Firewood => def.storage_firewood,
        CommodityKind::Water => def.storage_water,
        CommodityKind::Food => def.storage_food,
        CommodityKind::Timber => def.storage_timber,
        CommodityKind::Grain => def.storage_grain,
        CommodityKind::Flour => def.storage_flour,
        CommodityKind::Ale => def.storage_ale,
        CommodityKind::PreservedFood => def.storage_preserved_food,
        CommodityKind::Honey => def.storage_honey,
        CommodityKind::Wine => def.storage_wine,
        CommodityKind::Stone => def.storage_stone,
    }
}

pub fn building_commodity_room(building: &Building, kind: CommodityKind) -> f64 {
    (building_commodity_cap(&building.kind, kind) - building_commodity_stock(building, kind)).max(0.0)
}

pub fn withdraw_building_commodity(
    building: &mut Building,
    kind: CommodityKind,
    amount: f64,
) -> f64 {
    let withdrawn = building_commodity_stock(building, kind).min(amount.max(0.0));
    match kind {
        CommodityKind::Firewood => building.firewood -= withdrawn,
        CommodityKind::Water => building.water -= withdrawn,
        CommodityKind::Food => building.food -= withdrawn,
        CommodityKind::Timber => building.timber -= withdrawn,
        CommodityKind::Grain => building.grain -= withdrawn,
        CommodityKind::Flour => building.flour -= withdrawn,
        CommodityKind::Ale => building.ale -= withdrawn,
        CommodityKind::PreservedFood => building.preserved_food -= withdrawn,
        CommodityKind::Honey => building.honey -= withdrawn,
        CommodityKind::Wine => building.wine -= withdrawn,
        CommodityKind::Stone => building.stone -= withdrawn,
    }
    withdrawn
}

pub fn deposit_building_commodity(
    building: &mut Building,
    kind: CommodityKind,
    amount: f64,
) -> f64 {
    let deposited = building_commodity_room(building, kind).min(amount.max(0.0));
    match kind {
        CommodityKind::Firewood => building.firewood += deposited,
        CommodityKind::Water => building.water += deposited,
        CommodityKind::Food => building.food += deposited,
        CommodityKind::Timber => building.timber += deposited,
        CommodityKind::Grain => building.grain += deposited,
        CommodityKind::Flour => building.flour += deposited,
        CommodityKind::Ale => building.ale += deposited,
        CommodityKind::PreservedFood => building.preserved_food += deposited,
        CommodityKind::Honey => building.honey += deposited,
        CommodityKind::Wine => building.wine += deposited,
        CommodityKind::Stone => building.stone += deposited,
    }
    deposited
}

pub fn credit_treasury_commodity(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    kind: CommodityKind,
    amount: f64,
) {
    if amount <= 1e-6 {
        return;
    }
    let Some(mut treasury) = ctx.db.player_resources().owner().find(&owner) else {
        return;
    };
    match kind {
        CommodityKind::Firewood => treasury.firewood += amount,
        CommodityKind::Water => treasury.water += amount,
        CommodityKind::Food => treasury.food += amount,
        CommodityKind::Timber => treasury.timber += amount,
        CommodityKind::Grain => treasury.grain += amount,
        CommodityKind::Flour => treasury.flour += amount,
        CommodityKind::Ale => treasury.ale += amount,
        CommodityKind::PreservedFood => treasury.preserved_food += amount,
        CommodityKind::Honey => treasury.honey += amount,
        CommodityKind::Wine => treasury.wine += amount,
        CommodityKind::Stone => treasury.stone += amount,
    }
    ctx.db.player_resources().owner().update(treasury);
}
