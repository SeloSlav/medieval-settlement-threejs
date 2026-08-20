use spacetimedb::ReducerContext;

use crate::balance_generated::FOOD_CATEGORY_QUALIFYING_DAYS;
use crate::building_defs::building_def;
use crate::db::*;
pub use crate::food_demand_policy::household_food_per_day;
use crate::tables::{Building, Residence};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
pub enum CommodityKind {
    Firewood,
    Water,
    Food,
    Timber,
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
    Manure,
    Remedies,
    RoofTiles,
    Meat,
    Fish,
    Berries,
    Mushrooms,
    Milk,
    Apples,
    Cherries,
    Vegetables,
    Eggs,
    Grapes,
    CuredMeat,
    SmokedFish,
    Cheese,
    RyeSheaves,
    OatSheaves,
    BarleySheaves,
    MaslinSheaves,
    RyeGrain,
    OatGrain,
    MaslinGrain,
    RyeFlour,
    MaslinFlour,
    RyeBread,
    MaslinBread,
    Cider,
    Mead,
}

pub const FRESH_FOOD_COMMODITIES: [CommodityKind; 14] = [
    CommodityKind::Food,
    CommodityKind::OatGrain,
    CommodityKind::RyeBread,
    CommodityKind::MaslinBread,
    CommodityKind::Meat,
    CommodityKind::Fish,
    CommodityKind::Berries,
    CommodityKind::Mushrooms,
    CommodityKind::Milk,
    CommodityKind::Apples,
    CommodityKind::Cherries,
    CommodityKind::Vegetables,
    CommodityKind::Eggs,
    CommodityKind::Grapes,
];

pub const PRESERVED_FOOD_COMMODITIES: [CommodityKind; 4] = [
    CommodityKind::PreservedFood,
    CommodityKind::CuredMeat,
    CommodityKind::SmokedFish,
    CommodityKind::Cheese,
];

pub const PRESERVABLE_FOOD_COMMODITIES: [CommodityKind; 4] = [
    CommodityKind::Food,
    CommodityKind::Meat,
    CommodityKind::Fish,
    CommodityKind::Milk,
];

pub const EDIBLE_COMMODITIES: [CommodityKind; 19] = [
    CommodityKind::Food,
    CommodityKind::OatGrain,
    CommodityKind::RyeBread,
    CommodityKind::MaslinBread,
    CommodityKind::Meat,
    CommodityKind::Fish,
    CommodityKind::Berries,
    CommodityKind::Mushrooms,
    CommodityKind::Milk,
    CommodityKind::Apples,
    CommodityKind::Cherries,
    CommodityKind::Vegetables,
    CommodityKind::Eggs,
    CommodityKind::Grapes,
    CommodityKind::PreservedFood,
    CommodityKind::CuredMeat,
    CommodityKind::SmokedFish,
    CommodityKind::Cheese,
    CommodityKind::Honey,
];

/// Consume the shortest-lived foods first so mixed pantries and institutions
/// naturally preserve durable reserves. The legacy mixed buckets remain in
/// the order only so old saves drain cleanly after migration.
pub const FOOD_CONSUMPTION_ORDER: [CommodityKind; 19] = [
    CommodityKind::Meat,
    CommodityKind::Fish,
    CommodityKind::Milk,
    CommodityKind::Berries,
    CommodityKind::Mushrooms,
    CommodityKind::Grapes,
    CommodityKind::Cherries,
    CommodityKind::Eggs,
    CommodityKind::Apples,
    CommodityKind::Vegetables,
    CommodityKind::RyeBread,
    CommodityKind::MaslinBread,
    CommodityKind::OatGrain,
    CommodityKind::Food,
    CommodityKind::Cheese,
    CommodityKind::SmokedFish,
    CommodityKind::CuredMeat,
    CommodityKind::PreservedFood,
    CommodityKind::Honey,
];

/// Food need categories deliberately group close substitutes. Three visual
/// crops in a vegetable plot remain one variety; apples and legacy cherries
/// are both fruit; milk, eggs, and cheese are all animal produce.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
#[repr(u8)]
pub enum FoodCategory {
    Grains = 0,
    Vegetables = 1,
    Fruits = 2,
    AnimalProduce = 3,
    Meats = 4,
    Fishes = 5,
    Foraged = 6,
    Honey = 7,
}

impl FoodCategory {
    pub const ALL: [Self; 8] = [
        Self::Grains,
        Self::Vegetables,
        Self::Fruits,
        Self::AnimalProduce,
        Self::Meats,
        Self::Fishes,
        Self::Foraged,
        Self::Honey,
    ];

    pub fn bit(self) -> u8 {
        1 << self as u8
    }
}

pub fn food_category(kind: CommodityKind) -> Option<FoodCategory> {
    match kind {
        CommodityKind::Food
        | CommodityKind::OatGrain
        | CommodityKind::RyeBread
        | CommodityKind::MaslinBread
        | CommodityKind::PreservedFood => Some(FoodCategory::Grains),
        CommodityKind::Vegetables => Some(FoodCategory::Vegetables),
        CommodityKind::Apples | CommodityKind::Cherries | CommodityKind::Grapes => {
            Some(FoodCategory::Fruits)
        }
        CommodityKind::Milk | CommodityKind::Eggs | CommodityKind::Cheese => {
            Some(FoodCategory::AnimalProduce)
        }
        CommodityKind::Meat | CommodityKind::CuredMeat => Some(FoodCategory::Meats),
        CommodityKind::Fish | CommodityKind::SmokedFish => Some(FoodCategory::Fishes),
        CommodityKind::Berries | CommodityKind::Mushrooms => Some(FoodCategory::Foraged),
        CommodityKind::Honey => Some(FoodCategory::Honey),
        _ => None,
    }
}

impl CommodityKind {
    pub fn as_u8(self) -> u8 {
        match self {
            Self::Firewood => 0,
            Self::Water => 1,
            Self::Food => 2,
            Self::Timber => 3,
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
            Self::Manure => 24,
            Self::Remedies => 25,
            Self::RoofTiles => 26,
            Self::Meat => 28,
            Self::Fish => 29,
            Self::Berries => 30,
            Self::Mushrooms => 31,
            Self::Milk => 32,
            Self::Apples => 33,
            Self::Cherries => 34,
            Self::Vegetables => 35,
            Self::Eggs => 36,
            Self::Grapes => 37,
            Self::CuredMeat => 39,
            Self::SmokedFish => 40,
            Self::Cheese => 41,
            Self::RyeSheaves => 42,
            Self::OatSheaves => 43,
            Self::BarleySheaves => 44,
            Self::MaslinSheaves => 45,
            Self::RyeGrain => 46,
            Self::OatGrain => 47,
            Self::MaslinGrain => 48,
            Self::RyeFlour => 49,
            Self::MaslinFlour => 51,
            Self::RyeBread => 52,
            Self::MaslinBread => 54,
            Self::Cider => 55,
            Self::Mead => 56,
        }
    }

    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            0 => Some(Self::Firewood),
            1 => Some(Self::Water),
            2 => Some(Self::Food),
            3 => Some(Self::Timber),
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
            24 => Some(Self::Manure),
            25 => Some(Self::Remedies),
            26 => Some(Self::RoofTiles),
            28 => Some(Self::Meat),
            29 => Some(Self::Fish),
            30 => Some(Self::Berries),
            31 => Some(Self::Mushrooms),
            32 => Some(Self::Milk),
            33 => Some(Self::Apples),
            34 => Some(Self::Cherries),
            35 => Some(Self::Vegetables),
            36 => Some(Self::Eggs),
            37 => Some(Self::Grapes),
            39 => Some(Self::CuredMeat),
            40 => Some(Self::SmokedFish),
            41 => Some(Self::Cheese),
            42 => Some(Self::RyeSheaves),
            43 => Some(Self::OatSheaves),
            44 => Some(Self::BarleySheaves),
            45 => Some(Self::MaslinSheaves),
            46 => Some(Self::RyeGrain),
            47 => Some(Self::OatGrain),
            48 => Some(Self::MaslinGrain),
            49 => Some(Self::RyeFlour),
            51 => Some(Self::MaslinFlour),
            52 => Some(Self::RyeBread),
            54 => Some(Self::MaslinBread),
            55 => Some(Self::Cider),
            56 => Some(Self::Mead),
            _ => None,
        }
    }

    pub fn is_fresh_food(self) -> bool {
        FRESH_FOOD_COMMODITIES.contains(&self)
    }

    pub fn is_preserved_food(self) -> bool {
        PRESERVED_FOOD_COMMODITIES.contains(&self)
    }

    pub fn is_edible(self) -> bool {
        EDIBLE_COMMODITIES.contains(&self)
    }

    pub fn is_beverage(self) -> bool {
        matches!(self, Self::Ale | Self::Cider | Self::Mead)
    }

    pub fn is_bread_grain_bulk(self) -> bool {
        matches!(
            self,
            Self::RyeSheaves
                | Self::OatSheaves
                | Self::MaslinSheaves
                | Self::RyeGrain
                | Self::OatGrain
                | Self::MaslinGrain
        )
    }

    pub fn is_barley_bulk(self) -> bool {
        matches!(self, Self::Barley | Self::BarleySheaves)
    }

    pub fn is_flour_bulk(self) -> bool {
        matches!(self, Self::RyeFlour | Self::MaslinFlour)
    }

    /// Ready-to-eat meal equivalents. A unit remains a physical basket, loaf,
    /// crock, or joint; this value is the nourishment that basket contributes
    /// to household demand and settlement runway forecasts.
    pub fn meal_value(self) -> f64 {
        match self {
            Self::Food | Self::PreservedFood | Self::RyeBread | Self::Fish => 1.0,
            Self::Cheese => 0.9,
            Self::OatGrain => 0.65,
            Self::MaslinBread | Self::SmokedFish => 1.05,
            Self::Meat => 1.1,
            Self::CuredMeat => 1.15,
            Self::Honey => 1.2,
            Self::Milk | Self::Eggs => 0.75,
            Self::Vegetables => 0.7,
            Self::Mushrooms | Self::Apples | Self::Cherries | Self::Grapes => 0.6,
            Self::Berries => 0.55,
            _ => 0.0,
        }
    }

    /// Relative decay within the fresh or preserved storage class. Nutrition
    /// and shelf life are deliberately separate: cured meat is nourishing and
    /// durable, while milk is useful but must be eaten quickly.
    pub fn spoilage_multiplier(self) -> f64 {
        match self {
            Self::OatGrain => 0.35,
            Self::RyeBread => 0.55,
            Self::MaslinBread => 0.5,
            Self::Meat => 2.0,
            Self::Fish => 2.2,
            Self::Berries => 1.4,
            Self::Mushrooms => 1.6,
            Self::Milk => 2.4,
            Self::Apples => 0.75,
            Self::Cherries | Self::Vegetables | Self::Food | Self::Cheese => 1.0,
            Self::Eggs => 0.9,
            Self::Grapes => 1.2,
            Self::PreservedFood => 0.75,
            Self::CuredMeat => 0.55,
            Self::SmokedFish => 0.7,
            Self::Honey => 0.0,
            _ => 0.0,
        }
    }

    pub fn preservation_output(self) -> Option<Self> {
        match self {
            Self::Food => Some(Self::PreservedFood),
            Self::Meat => Some(Self::CuredMeat),
            Self::Fish => Some(Self::SmokedFish),
            Self::Milk => Some(Self::Cheese),
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
        CommodityKind::Ale => building.ale,
        CommodityKind::Cider => building.cider,
        CommodityKind::Mead => building.mead,
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
        CommodityKind::Manure => building.manure,
        CommodityKind::Remedies => building.remedies,
        CommodityKind::RoofTiles => building.roof_tiles,
        CommodityKind::Meat => building.meat,
        CommodityKind::Fish => building.fish,
        CommodityKind::Berries => building.berries,
        CommodityKind::Mushrooms => building.mushrooms,
        CommodityKind::Milk => building.milk,
        CommodityKind::Apples => building.apples,
        CommodityKind::Cherries => building.cherries,
        CommodityKind::Vegetables => building.vegetables,
        CommodityKind::Eggs => building.eggs,
        CommodityKind::Grapes => building.grapes,
        CommodityKind::CuredMeat => building.cured_meat,
        CommodityKind::SmokedFish => building.smoked_fish,
        CommodityKind::Cheese => building.cheese,
        CommodityKind::RyeSheaves => building.rye_sheaves,
        CommodityKind::OatSheaves => building.oat_sheaves,
        CommodityKind::BarleySheaves => building.barley_sheaves,
        CommodityKind::MaslinSheaves => building.maslin_sheaves,
        CommodityKind::RyeGrain => building.rye_grain,
        CommodityKind::OatGrain => building.oat_grain,
        CommodityKind::MaslinGrain => building.maslin_grain,
        CommodityKind::RyeFlour => building.rye_flour,
        CommodityKind::MaslinFlour => building.maslin_flour,
        CommodityKind::RyeBread => building.rye_bread,
        CommodityKind::MaslinBread => building.maslin_bread,
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
        CommodityKind::Ale => def.storage_ale,
        CommodityKind::Cider => def.storage_cider,
        CommodityKind::Mead => def.storage_mead,
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
                    | "tavern"
                    | "trading_post"
                    | "guardhouse"
            ) {
                f64::MAX
            } else {
                0.0
            }
        }
        CommodityKind::Barley => def.storage_barley,
        CommodityKind::RyeSheaves
        | CommodityKind::OatSheaves
        | CommodityKind::MaslinSheaves
        | CommodityKind::RyeGrain
        | CommodityKind::OatGrain
        | CommodityKind::MaslinGrain => def.storage_grain,
        CommodityKind::BarleySheaves => def.storage_barley,
        CommodityKind::RyeFlour | CommodityKind::MaslinFlour => {
            def.storage_flour
        }
        CommodityKind::Malt => def.storage_malt,
        CommodityKind::Flax => def.storage_flax,
        CommodityKind::Iron => def.storage_iron,
        CommodityKind::Clay => def.storage_clay,
        CommodityKind::Salt => def.storage_salt,
        CommodityKind::Charcoal => def.storage_charcoal,
        CommodityKind::Pottery => def.storage_pottery,
        CommodityKind::Manure => def.storage_manure,
        CommodityKind::Remedies => def.storage_remedies,
        CommodityKind::RoofTiles => def.storage_roof_tiles,
        CommodityKind::RyeBread
        | CommodityKind::MaslinBread
        | CommodityKind::Meat
        | CommodityKind::Fish
        | CommodityKind::Berries
        | CommodityKind::Mushrooms
        | CommodityKind::Milk
        | CommodityKind::Apples
        | CommodityKind::Cherries
        | CommodityKind::Vegetables
        | CommodityKind::Eggs
        | CommodityKind::Grapes
        => def.storage_food,
        CommodityKind::CuredMeat | CommodityKind::SmokedFish | CommodityKind::Cheese => {
            def.storage_preserved_food
        }
    }
}

pub fn building_commodity_room(building: &Building, kind: CommodityKind) -> f64 {
    let occupied = if kind.is_bread_grain_bulk() {
        bread_grain_bulk_stock(building)
    } else if kind.is_barley_bulk() {
        barley_bulk_stock(building)
    } else if kind.is_flour_bulk() {
        flour_bulk_stock(building)
    } else if kind.is_fresh_food() {
        building_fresh_food_stock(building)
    } else if kind.is_preserved_food() {
        building_preserved_food_stock(building)
    } else {
        building_commodity_stock(building, kind)
    };
    (building_commodity_cap(&building.kind, kind) - occupied).max(0.0)
}

pub fn bread_grain_bulk_stock(building: &Building) -> f64 {
    building.rye_sheaves.max(0.0)
        + building.oat_sheaves.max(0.0)
        + building.maslin_sheaves.max(0.0)
        + building.rye_grain.max(0.0)
        + building.oat_grain.max(0.0)
        + building.maslin_grain.max(0.0)
}

pub fn barley_bulk_stock(building: &Building) -> f64 {
    building.barley.max(0.0) + building.barley_sheaves.max(0.0)
}

pub fn flour_bulk_stock(building: &Building) -> f64 {
    building.rye_flour.max(0.0) + building.maslin_flour.max(0.0)
}

pub fn building_fresh_food_stock(building: &Building) -> f64 {
    FRESH_FOOD_COMMODITIES
        .into_iter()
        .map(|kind| building_commodity_stock(building, kind).max(0.0) * kind.meal_value())
        .sum()
}

pub fn building_preserved_food_stock(building: &Building) -> f64 {
    PRESERVED_FOOD_COMMODITIES
        .into_iter()
        .map(|kind| building_commodity_stock(building, kind).max(0.0) * kind.meal_value())
        .sum()
}

pub fn building_preservable_food_stock(building: &Building) -> f64 {
    PRESERVABLE_FOOD_COMMODITIES
        .into_iter()
        .map(|kind| building_commodity_stock(building, kind).max(0.0))
        .sum()
}

pub fn building_edible_food_stock(building: &Building) -> f64 {
    EDIBLE_COMMODITIES
        .into_iter()
        .map(|kind| building_commodity_stock(building, kind).max(0.0) * kind.meal_value())
        .sum()
}

pub fn first_building_edible_commodity(building: &Building) -> Option<CommodityKind> {
    FOOD_CONSUMPTION_ORDER
        .into_iter()
        .find(|kind| building_commodity_stock(building, *kind) > 1e-6)
}

pub fn withdraw_building_edible_food(building: &mut Building, meal_amount: f64) -> f64 {
    let mut remaining = meal_amount.max(0.0);
    let mut meals_withdrawn = 0.0;
    for kind in FOOD_CONSUMPTION_ORDER {
        if remaining <= 1e-9 {
            break;
        }
        let meal_value = kind.meal_value().max(1e-9);
        let units = withdraw_building_commodity(building, kind, remaining / meal_value);
        let meals = units * meal_value;
        meals_withdrawn += meals;
        remaining = (remaining - meals).max(0.0);
    }
    meals_withdrawn
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
        CommodityKind::Ale => building.ale -= withdrawn,
        CommodityKind::Cider => building.cider -= withdrawn,
        CommodityKind::Mead => building.mead -= withdrawn,
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
        CommodityKind::Manure => building.manure -= withdrawn,
        CommodityKind::Remedies => building.remedies -= withdrawn,
        CommodityKind::RoofTiles => building.roof_tiles -= withdrawn,
        CommodityKind::Meat => building.meat -= withdrawn,
        CommodityKind::Fish => building.fish -= withdrawn,
        CommodityKind::Berries => building.berries -= withdrawn,
        CommodityKind::Mushrooms => building.mushrooms -= withdrawn,
        CommodityKind::Milk => building.milk -= withdrawn,
        CommodityKind::Apples => building.apples -= withdrawn,
        CommodityKind::Cherries => building.cherries -= withdrawn,
        CommodityKind::Vegetables => building.vegetables -= withdrawn,
        CommodityKind::Eggs => building.eggs -= withdrawn,
        CommodityKind::Grapes => building.grapes -= withdrawn,
        CommodityKind::CuredMeat => building.cured_meat -= withdrawn,
        CommodityKind::SmokedFish => building.smoked_fish -= withdrawn,
        CommodityKind::Cheese => building.cheese -= withdrawn,
        CommodityKind::RyeSheaves => building.rye_sheaves -= withdrawn,
        CommodityKind::OatSheaves => building.oat_sheaves -= withdrawn,
        CommodityKind::BarleySheaves => building.barley_sheaves -= withdrawn,
        CommodityKind::MaslinSheaves => building.maslin_sheaves -= withdrawn,
        CommodityKind::RyeGrain => building.rye_grain -= withdrawn,
        CommodityKind::OatGrain => building.oat_grain -= withdrawn,
        CommodityKind::MaslinGrain => building.maslin_grain -= withdrawn,
        CommodityKind::RyeFlour => building.rye_flour -= withdrawn,
        CommodityKind::MaslinFlour => building.maslin_flour -= withdrawn,
        CommodityKind::RyeBread => building.rye_bread -= withdrawn,
        CommodityKind::MaslinBread => building.maslin_bread -= withdrawn,
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
        CommodityKind::Ale => building.ale += deposited,
        CommodityKind::Cider => building.cider += deposited,
        CommodityKind::Mead => building.mead += deposited,
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
        CommodityKind::Manure => building.manure += deposited,
        CommodityKind::Remedies => building.remedies += deposited,
        CommodityKind::RoofTiles => building.roof_tiles += deposited,
        CommodityKind::Meat => building.meat += deposited,
        CommodityKind::Fish => building.fish += deposited,
        CommodityKind::Berries => building.berries += deposited,
        CommodityKind::Mushrooms => building.mushrooms += deposited,
        CommodityKind::Milk => building.milk += deposited,
        CommodityKind::Apples => building.apples += deposited,
        CommodityKind::Cherries => building.cherries += deposited,
        CommodityKind::Vegetables => building.vegetables += deposited,
        CommodityKind::Eggs => building.eggs += deposited,
        CommodityKind::Grapes => building.grapes += deposited,
        CommodityKind::CuredMeat => building.cured_meat += deposited,
        CommodityKind::SmokedFish => building.smoked_fish += deposited,
        CommodityKind::Cheese => building.cheese += deposited,
        CommodityKind::RyeSheaves => building.rye_sheaves += deposited,
        CommodityKind::OatSheaves => building.oat_sheaves += deposited,
        CommodityKind::BarleySheaves => building.barley_sheaves += deposited,
        CommodityKind::MaslinSheaves => building.maslin_sheaves += deposited,
        CommodityKind::RyeGrain => building.rye_grain += deposited,
        CommodityKind::OatGrain => building.oat_grain += deposited,
        CommodityKind::MaslinGrain => building.maslin_grain += deposited,
        CommodityKind::RyeFlour => building.rye_flour += deposited,
        CommodityKind::MaslinFlour => building.maslin_flour += deposited,
        CommodityKind::RyeBread => building.rye_bread += deposited,
        CommodityKind::MaslinBread => building.maslin_bread += deposited,
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
        CommodityKind::Ale => treasury.ale += amount,
        CommodityKind::Cider => treasury.cider += amount,
        CommodityKind::Mead => treasury.mead += amount,
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
        // Manure exists only in physical building stores; there is no legacy
        // disembodied ledger slot to credit.
        CommodityKind::Manure => return,
        // Prepared remedies are produced and consumed only at physical sites.
        CommodityKind::Remedies => return,
        CommodityKind::RoofTiles => treasury.roof_tiles += amount,
        CommodityKind::Meat => treasury.meat += amount,
        CommodityKind::Fish => treasury.fish += amount,
        CommodityKind::Berries => treasury.berries += amount,
        CommodityKind::Mushrooms => treasury.mushrooms += amount,
        CommodityKind::Milk => treasury.milk += amount,
        CommodityKind::Apples => treasury.apples += amount,
        CommodityKind::Cherries => treasury.cherries += amount,
        CommodityKind::Vegetables => treasury.vegetables += amount,
        CommodityKind::Eggs => treasury.eggs += amount,
        CommodityKind::Grapes => treasury.grapes += amount,
        CommodityKind::CuredMeat => treasury.cured_meat += amount,
        CommodityKind::SmokedFish => treasury.smoked_fish += amount,
        CommodityKind::Cheese => treasury.cheese += amount,
        CommodityKind::RyeSheaves => treasury.rye_sheaves += amount,
        CommodityKind::OatSheaves => treasury.oat_sheaves += amount,
        CommodityKind::BarleySheaves => treasury.barley_sheaves += amount,
        CommodityKind::MaslinSheaves => treasury.maslin_sheaves += amount,
        CommodityKind::RyeGrain => treasury.rye_grain += amount,
        CommodityKind::OatGrain => treasury.oat_grain += amount,
        CommodityKind::MaslinGrain => treasury.maslin_grain += amount,
        CommodityKind::RyeFlour => treasury.rye_flour += amount,
        CommodityKind::MaslinFlour => treasury.maslin_flour += amount,
        CommodityKind::RyeBread => treasury.rye_bread += amount,
        CommodityKind::MaslinBread => treasury.maslin_bread += amount,
    }
    let physical = treasury.physical_founding_site_enabled;
    ctx.db.player_resources().owner().update(treasury);
    if physical {
        if let Err(error) = crate::simulation::materialize_physical_resource_ledger(ctx, owner) {
            log::warn!("Could not materialize physical treasury credit: {error}");
        }
    }
}

pub fn residence_commodity_stock(residence: &Residence, kind: CommodityKind) -> f64 {
    match kind {
        CommodityKind::Food => residence.food,
        CommodityKind::PreservedFood => residence.preserved_food,
        CommodityKind::Honey => residence.honey,
        CommodityKind::OatGrain => residence.oat_grain,
        CommodityKind::Meat => residence.meat,
        CommodityKind::Fish => residence.fish,
        CommodityKind::Berries => residence.berries,
        CommodityKind::Mushrooms => residence.mushrooms,
        CommodityKind::Milk => residence.milk,
        CommodityKind::Apples => residence.apples,
        CommodityKind::Cherries => residence.cherries,
        CommodityKind::Vegetables => residence.vegetables,
        CommodityKind::Eggs => residence.eggs,
        CommodityKind::Grapes => residence.grapes,
        CommodityKind::CuredMeat => residence.cured_meat,
        CommodityKind::SmokedFish => residence.smoked_fish,
        CommodityKind::Cheese => residence.cheese,
        CommodityKind::RyeBread => residence.rye_bread,
        CommodityKind::MaslinBread => residence.maslin_bread,
        _ => 0.0,
    }
}

pub fn residence_fresh_food_stock(residence: &Residence) -> f64 {
    FRESH_FOOD_COMMODITIES
        .into_iter()
        .map(|kind| residence_commodity_stock(residence, kind).max(0.0) * kind.meal_value())
        .sum::<f64>()
        + residence.honey.max(0.0) * CommodityKind::Honey.meal_value()
}

pub fn residence_preserved_food_stock(residence: &Residence) -> f64 {
    PRESERVED_FOOD_COMMODITIES
        .into_iter()
        .map(|kind| residence_commodity_stock(residence, kind).max(0.0) * kind.meal_value())
        .sum()
}

pub fn residence_edible_food_stock(residence: &Residence) -> f64 {
    residence_fresh_food_stock(residence) + residence_preserved_food_stock(residence)
}

pub fn food_category_qualifying_stock(population: u32) -> f64 {
    household_food_per_day(population) * FOOD_CATEGORY_QUALIFYING_DAYS.max(0.0)
}

pub fn residence_food_category_stock(residence: &Residence, category: FoodCategory) -> f64 {
    EDIBLE_COMMODITIES
        .into_iter()
        .filter(|commodity| food_category(*commodity) == Some(category))
        .map(|commodity| {
            residence_commodity_stock(residence, commodity).max(0.0) * commodity.meal_value()
        })
        .sum()
}

pub fn residence_food_category_mask(residence: &Residence) -> u8 {
    let qualifying_stock = food_category_qualifying_stock(residence.population);
    FoodCategory::ALL.into_iter().fold(0_u8, |mask, category| {
        if residence_food_category_stock(residence, category) + 1e-6 >= qualifying_stock {
            mask | category.bit()
        } else {
            mask
        }
    })
}

pub fn residence_food_variety_count(residence: &Residence) -> u8 {
    residence_food_category_mask(residence).count_ones() as u8
}

pub fn withdraw_residence_commodity(
    residence: &mut Residence,
    kind: CommodityKind,
    amount: f64,
) -> f64 {
    let withdrawn = residence_commodity_stock(residence, kind).min(amount.max(0.0));
    match kind {
        CommodityKind::Food => residence.food -= withdrawn,
        CommodityKind::PreservedFood => residence.preserved_food -= withdrawn,
        CommodityKind::Honey => residence.honey -= withdrawn,
        CommodityKind::OatGrain => residence.oat_grain -= withdrawn,
        CommodityKind::Meat => residence.meat -= withdrawn,
        CommodityKind::Fish => residence.fish -= withdrawn,
        CommodityKind::Berries => residence.berries -= withdrawn,
        CommodityKind::Mushrooms => residence.mushrooms -= withdrawn,
        CommodityKind::Milk => residence.milk -= withdrawn,
        CommodityKind::Apples => residence.apples -= withdrawn,
        CommodityKind::Cherries => residence.cherries -= withdrawn,
        CommodityKind::Vegetables => residence.vegetables -= withdrawn,
        CommodityKind::Eggs => residence.eggs -= withdrawn,
        CommodityKind::Grapes => residence.grapes -= withdrawn,
        CommodityKind::CuredMeat => residence.cured_meat -= withdrawn,
        CommodityKind::SmokedFish => residence.smoked_fish -= withdrawn,
        CommodityKind::Cheese => residence.cheese -= withdrawn,
        CommodityKind::RyeBread => residence.rye_bread -= withdrawn,
        CommodityKind::MaslinBread => residence.maslin_bread -= withdrawn,
        _ => return 0.0,
    }
    withdrawn
}

pub fn withdraw_residence_fresh_food(residence: &mut Residence, meal_amount: f64) -> f64 {
    let mut remaining = meal_amount.max(0.0);
    let mut withdrawn = 0.0;
    for kind in FOOD_CONSUMPTION_ORDER {
        if remaining <= 1e-9 {
            break;
        }
        if !(kind.is_fresh_food() || kind == CommodityKind::Honey) {
            continue;
        }
        let amount = withdraw_residence_commodity(
            residence,
            kind,
            remaining / kind.meal_value().max(1e-9),
        );
        withdrawn += amount * kind.meal_value();
        remaining = (remaining - amount * kind.meal_value()).max(0.0);
    }
    withdrawn
}

pub fn withdraw_residence_preserved_food(residence: &mut Residence, meal_amount: f64) -> f64 {
    let mut remaining = meal_amount.max(0.0);
    let mut withdrawn = 0.0;
    for kind in FOOD_CONSUMPTION_ORDER {
        if remaining <= 1e-9 {
            break;
        }
        if !kind.is_preserved_food() {
            continue;
        }
        let amount = withdraw_residence_commodity(
            residence,
            kind,
            remaining / kind.meal_value().max(1e-9),
        );
        withdrawn += amount * kind.meal_value();
        remaining = (remaining - amount * kind.meal_value()).max(0.0);
    }
    withdrawn
}

pub fn deposit_residence_commodity(
    residence: &mut Residence,
    kind: CommodityKind,
    amount: f64,
    fresh_capacity: f64,
    preserved_capacity: f64,
) -> f64 {
    let room = if kind.is_preserved_food() {
        (preserved_capacity - residence_preserved_food_stock(residence)).max(0.0)
    } else if kind.is_fresh_food() || kind == CommodityKind::Honey {
        (fresh_capacity - residence_fresh_food_stock(residence)).max(0.0)
    } else {
        return 0.0;
    };
    let deposited = (room / kind.meal_value().max(1e-9)).min(amount.max(0.0));
    match kind {
        CommodityKind::Food => residence.food += deposited,
        CommodityKind::PreservedFood => residence.preserved_food += deposited,
        CommodityKind::Honey => residence.honey += deposited,
        CommodityKind::OatGrain => residence.oat_grain += deposited,
        CommodityKind::Meat => residence.meat += deposited,
        CommodityKind::Fish => residence.fish += deposited,
        CommodityKind::Berries => residence.berries += deposited,
        CommodityKind::Mushrooms => residence.mushrooms += deposited,
        CommodityKind::Milk => residence.milk += deposited,
        CommodityKind::Apples => residence.apples += deposited,
        CommodityKind::Cherries => residence.cherries += deposited,
        CommodityKind::Vegetables => residence.vegetables += deposited,
        CommodityKind::Eggs => residence.eggs += deposited,
        CommodityKind::Grapes => residence.grapes += deposited,
        CommodityKind::CuredMeat => residence.cured_meat += deposited,
        CommodityKind::SmokedFish => residence.smoked_fish += deposited,
        CommodityKind::Cheese => residence.cheese += deposited,
        CommodityKind::RyeBread => residence.rye_bread += deposited,
        CommodityKind::MaslinBread => residence.maslin_bread += deposited,
        _ => return 0.0,
    }
    deposited
}

#[cfg(test)]
mod tests {
    use super::{food_category, food_category_qualifying_stock, CommodityKind, FoodCategory};

    #[test]
    fn commodity_ids_remain_stable_and_round_trip() {
        for id in 0_u8..=56 {
            if matches!(id, 4 | 5 | 27 | 50 | 53) {
                assert_eq!(CommodityKind::from_u8(id), None);
            } else {
                let commodity = CommodityKind::from_u8(id)
                    .unwrap_or_else(|| panic!("missing commodity id {id}"));
                assert_eq!(commodity.as_u8(), id);
            }
        }
        assert_eq!(CommodityKind::from_u8(57), None);
    }

    #[test]
    fn foods_keep_identity_through_preservation() {
        assert_eq!(
            CommodityKind::Meat.preservation_output(),
            Some(CommodityKind::CuredMeat),
        );
        assert_eq!(
            CommodityKind::Fish.preservation_output(),
            Some(CommodityKind::SmokedFish),
        );
        assert_eq!(
            CommodityKind::Milk.preservation_output(),
            Some(CommodityKind::Cheese),
        );
        assert_eq!(CommodityKind::RyeBread.preservation_output(), None);
        assert!(CommodityKind::RyeBread.is_fresh_food());
        assert!(CommodityKind::OatGrain.is_fresh_food());
        assert!(CommodityKind::OatGrain.is_edible());
        assert!(CommodityKind::MaslinBread.is_fresh_food());
        assert!(CommodityKind::CuredMeat.is_preserved_food());
        assert!(CommodityKind::Honey.is_edible());
        assert_eq!(CommodityKind::RyeBread.meal_value(), 1.0);
        assert_eq!(CommodityKind::OatGrain.meal_value(), 0.65);
        assert_eq!(CommodityKind::MaslinBread.meal_value(), 1.05);
        assert!(
            CommodityKind::Milk.spoilage_multiplier()
                > CommodityKind::RyeBread.spoilage_multiplier()
        );
        assert!(
            CommodityKind::CuredMeat.spoilage_multiplier()
                < CommodityKind::Meat.spoilage_multiplier()
        );
        assert_eq!(CommodityKind::RyeFlour.meal_value(), 0.0);
        assert_eq!(CommodityKind::MaslinFlour.meal_value(), 0.0);
    }

    #[test]
    fn vegetables_remain_an_independent_food_category() {
        assert_eq!(
            food_category(CommodityKind::Vegetables),
            Some(FoodCategory::Vegetables)
        );
        assert_ne!(
            food_category(CommodityKind::Vegetables),
            food_category(CommodityKind::Apples)
        );
        assert_eq!(
            food_category(CommodityKind::Milk),
            food_category(CommodityKind::Cheese)
        );
    }

    #[test]
    fn a_category_needs_one_household_day_of_meals() {
        assert!((food_category_qualifying_stock(1) - 1.0 / 3.0).abs() < 1e-9);
        assert!((food_category_qualifying_stock(6) - 2.0).abs() < 1e-9);
    }
}
