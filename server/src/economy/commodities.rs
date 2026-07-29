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
    Barley,
    Malt,
    Flax,
    Iron,
    Clay,
    Salt,
    Charcoal,
    Pottery,
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
            Self::Barley => 16,
            Self::Malt => 17,
            Self::Flax => 18,
            Self::Iron => 19,
            Self::Clay => 20,
            Self::Salt => 21,
            Self::Charcoal => 22,
            Self::Pottery => 23,
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
            16 => Some(Self::Barley),
            17 => Some(Self::Malt),
            18 => Some(Self::Flax),
            19 => Some(Self::Iron),
            20 => Some(Self::Clay),
            21 => Some(Self::Salt),
            22 => Some(Self::Charcoal),
            23 => Some(Self::Pottery),
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
        CommodityKind::Barley => building.barley,
        CommodityKind::Malt => building.malt,
        CommodityKind::Flax => building.flax,
        CommodityKind::Iron => building.iron,
        CommodityKind::Clay => building.clay,
        CommodityKind::Salt => building.salt,
        CommodityKind::Charcoal => building.charcoal,
        CommodityKind::Pottery => building.pottery,
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
            if matches!(
                kind,
                "founders_camp"
                    | "salvage_pile"
                    | "chapel"
                    | "monastery"
                    | "town_hall"
                    | "marketplace"
                    | "ferry_landing"
                    | "guardhouse"
            ) {
                f64::MAX
            } else {
                0.0
            }
        }
        CommodityKind::Barley => def.storage_barley,
        CommodityKind::Malt => def.storage_malt,
        CommodityKind::Flax => def.storage_flax,
        CommodityKind::Iron => def.storage_iron,
        CommodityKind::Clay => def.storage_clay,
        CommodityKind::Salt => def.storage_salt,
        CommodityKind::Charcoal => def.storage_charcoal,
        CommodityKind::Pottery => def.storage_pottery,
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
        CommodityKind::Barley => building.barley -= withdrawn,
        CommodityKind::Malt => building.malt -= withdrawn,
        CommodityKind::Flax => building.flax -= withdrawn,
        CommodityKind::Iron => building.iron -= withdrawn,
        CommodityKind::Clay => building.clay -= withdrawn,
        CommodityKind::Salt => building.salt -= withdrawn,
        CommodityKind::Charcoal => building.charcoal -= withdrawn,
        CommodityKind::Pottery => building.pottery -= withdrawn,
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
        CommodityKind::Barley => building.barley += deposited,
        CommodityKind::Malt => building.malt += deposited,
        CommodityKind::Flax => building.flax += deposited,
        CommodityKind::Iron => building.iron += deposited,
        CommodityKind::Clay => building.clay += deposited,
        CommodityKind::Salt => building.salt += deposited,
        CommodityKind::Charcoal => building.charcoal += deposited,
        CommodityKind::Pottery => building.pottery += deposited,
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
        CommodityKind::Barley => treasury.barley += amount,
        CommodityKind::Malt => treasury.malt += amount,
        CommodityKind::Flax => treasury.flax += amount,
        CommodityKind::Iron => treasury.iron += amount,
        CommodityKind::Clay => treasury.clay += amount,
        CommodityKind::Salt => treasury.salt += amount,
        CommodityKind::Charcoal => treasury.charcoal += amount,
        CommodityKind::Pottery => treasury.pottery += amount,
    }
    let physical = treasury.physical_founding_site_enabled;
    ctx.db.player_resources().owner().update(treasury);
    if physical {
        if let Err(error) = crate::simulation::materialize_physical_resource_ledger(ctx, owner) {
            log::warn!("Could not materialize physical treasury credit: {error}");
        }
    }
}
