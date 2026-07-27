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
    Ironwork,
    Polearms,
    Wool,
    Cloth,
    Gold,
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
            Self::Polearms => 11,
            Self::Ironwork => 12,
            Self::Wool => 13,
            Self::Cloth => 14,
            Self::Gold => 15,
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
            11 => Some(Self::Polearms),
            12 => Some(Self::Ironwork),
            13 => Some(Self::Wool),
            14 => Some(Self::Cloth),
            15 => Some(Self::Gold),
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
        CommodityKind::Ironwork => building.ironwork,
        CommodityKind::Polearms => building.polearms,
        CommodityKind::Wool => building.wool,
        CommodityKind::Cloth => building.cloth,
        CommodityKind::Gold => building.gold,
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
        CommodityKind::Ironwork => def.storage_ironwork,
        CommodityKind::Polearms => def.storage_polearms,
        CommodityKind::Wool => def.storage_wool,
        CommodityKind::Cloth => def.storage_cloth,
        CommodityKind::Gold => {
            if matches!(kind, "founders_camp" | "salvage_pile" | "town_hall") {
                f64::MAX
            } else {
                0.0
            }
        }
    }
}

pub fn building_commodity_room(building: &Building, kind: CommodityKind) -> f64 {
    (building_commodity_cap(&building.kind, kind) - building_commodity_stock(building, kind))
        .max(0.0)
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
        CommodityKind::Ironwork => building.ironwork -= withdrawn,
        CommodityKind::Polearms => building.polearms -= withdrawn,
        CommodityKind::Wool => building.wool -= withdrawn,
        CommodityKind::Cloth => building.cloth -= withdrawn,
        CommodityKind::Gold => building.gold -= withdrawn,
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
        CommodityKind::Ironwork => building.ironwork += deposited,
        CommodityKind::Polearms => building.polearms += deposited,
        CommodityKind::Wool => building.wool += deposited,
        CommodityKind::Cloth => building.cloth += deposited,
        CommodityKind::Gold => building.gold += deposited,
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
    if kind == CommodityKind::Gold {
        crate::economy::credit_treasury_gold(ctx, owner, amount);
        return;
    }
    let Some(mut treasury) = ctx.db.player_resources().owner().find(&owner) else {
        return;
    };
    if treasury.physical_founding_site_enabled {
        if let Some(mut depot) = physical_resource_depot(ctx, owner, kind) {
            add_building_commodity(&mut depot, kind, amount);
            ctx.db.building().id().update(depot);
            return;
        }
    }
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
        CommodityKind::Ironwork => treasury.ironwork += amount,
        CommodityKind::Polearms => treasury.polearms += amount,
        CommodityKind::Wool => treasury.wool += amount,
        CommodityKind::Cloth => treasury.cloth += amount,
        CommodityKind::Gold => unreachable!("gold uses the physical treasury seat"),
    }
    ctx.db.player_resources().owner().update(treasury);
}

fn physical_resource_depot(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    kind: CommodityKind,
) -> Option<Building> {
    ctx.db
        .building()
        .owner()
        .filter(&owner)
        .filter(|building| {
            building.construction_complete
                && building.kind != "salvage_pile"
                && (building.kind == "founders_camp"
                    || building_commodity_cap(&building.kind, kind) > 0.0
                    || building.kind == "town_hall")
        })
        .min_by_key(|building| match building.kind.as_str() {
            "founders_camp" => (0_u8, building.id),
            "village_storehouse" if building_commodity_cap(&building.kind, kind) > 0.0 => {
                (1, building.id)
            }
            "town_hall" => (3, building.id),
            _ => (2, building.id),
        })
}

fn add_building_commodity(building: &mut Building, kind: CommodityKind, amount: f64) {
    match kind {
        CommodityKind::Firewood => building.firewood += amount,
        CommodityKind::Water => building.water += amount,
        CommodityKind::Food => building.food += amount,
        CommodityKind::Timber => building.timber += amount,
        CommodityKind::Grain => building.grain += amount,
        CommodityKind::Flour => building.flour += amount,
        CommodityKind::Ale => building.ale += amount,
        CommodityKind::PreservedFood => building.preserved_food += amount,
        CommodityKind::Honey => building.honey += amount,
        CommodityKind::Wine => building.wine += amount,
        CommodityKind::Stone => building.stone += amount,
        CommodityKind::Ironwork => building.ironwork += amount,
        CommodityKind::Polearms => building.polearms += amount,
        CommodityKind::Wool => building.wool += amount,
        CommodityKind::Cloth => building.cloth += amount,
        CommodityKind::Gold => building.gold += amount,
    }
}
