use spacetimedb::ReducerContext;

use crate::building_defs::building_def;
use crate::db::*;
pub use crate::food_demand_policy::household_food_units_per_day_for_tier;
use crate::resource_units::{whole_room, whole_transfer, whole_units};
use crate::supply_policy::OAT_GRAIN_MEAL_VALUE;
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
    Hides,
    Leather,
    Shoes,
    Pears,
    Aronia,
    Rosehips,
    Cabbage,
    Carrots,
    Beetroot,
    AroniaJam,
    RosehipJam,
    PearCider,
    AnimalFeed,
}

/// Canonical exhaustive commodity iteration order. Systems that must prove a
/// physical holder is empty (temporary camps, reclamation piles, diagnostics)
/// use this list so adding a commodity cannot silently strand stock.
pub const ALL_COMMODITIES: &[CommodityKind; 64] = &[
    CommodityKind::Firewood,
    CommodityKind::Water,
    CommodityKind::Food,
    CommodityKind::Timber,
    CommodityKind::Ale,
    CommodityKind::PreservedFood,
    CommodityKind::Honey,
    CommodityKind::Wine,
    CommodityKind::Stone,
    CommodityKind::Ironwork,
    CommodityKind::Polearms,
    CommodityKind::Wool,
    CommodityKind::Cloth,
    CommodityKind::Gold,
    CommodityKind::Barley,
    CommodityKind::Malt,
    CommodityKind::Flax,
    CommodityKind::Iron,
    CommodityKind::Clay,
    CommodityKind::Salt,
    CommodityKind::Charcoal,
    CommodityKind::Pottery,
    CommodityKind::Manure,
    CommodityKind::Remedies,
    CommodityKind::RoofTiles,
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
    CommodityKind::CuredMeat,
    CommodityKind::SmokedFish,
    CommodityKind::Cheese,
    CommodityKind::RyeSheaves,
    CommodityKind::OatSheaves,
    CommodityKind::BarleySheaves,
    CommodityKind::MaslinSheaves,
    CommodityKind::RyeGrain,
    CommodityKind::OatGrain,
    CommodityKind::MaslinGrain,
    CommodityKind::RyeFlour,
    CommodityKind::MaslinFlour,
    CommodityKind::RyeBread,
    CommodityKind::MaslinBread,
    CommodityKind::Cider,
    CommodityKind::Mead,
    CommodityKind::Hides,
    CommodityKind::Leather,
    CommodityKind::Shoes,
    CommodityKind::Pears,
    CommodityKind::Aronia,
    CommodityKind::Rosehips,
    CommodityKind::Cabbage,
    CommodityKind::Carrots,
    CommodityKind::Beetroot,
    CommodityKind::AroniaJam,
    CommodityKind::RosehipJam,
    CommodityKind::PearCider,
    CommodityKind::AnimalFeed,
];

pub const FRESH_FOOD_COMMODITIES: [CommodityKind; 20] = [
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
    CommodityKind::Pears,
    CommodityKind::Aronia,
    CommodityKind::Rosehips,
    CommodityKind::Cabbage,
    CommodityKind::Carrots,
    CommodityKind::Beetroot,
];

pub const PRESERVED_FOOD_COMMODITIES: [CommodityKind; 6] = [
    CommodityKind::PreservedFood,
    CommodityKind::CuredMeat,
    CommodityKind::SmokedFish,
    CommodityKind::Cheese,
    CommodityKind::AroniaJam,
    CommodityKind::RosehipJam,
];

pub const PRESERVABLE_FOOD_COMMODITIES: [CommodityKind; 4] = [
    CommodityKind::Food,
    CommodityKind::Meat,
    CommodityKind::Fish,
    CommodityKind::Milk,
];

pub const EDIBLE_COMMODITIES: [CommodityKind; 27] = [
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
    CommodityKind::Pears,
    CommodityKind::Aronia,
    CommodityKind::Rosehips,
    CommodityKind::Cabbage,
    CommodityKind::Carrots,
    CommodityKind::Beetroot,
    CommodityKind::AroniaJam,
    CommodityKind::RosehipJam,
];

/// Consume the shortest-lived foods first so mixed pantries and institutions
/// naturally preserve durable reserves. Combined food buckets remain available
/// for producers whose output is intentionally not crop-specific.
pub const FOOD_CONSUMPTION_ORDER: [CommodityKind; 27] = [
    CommodityKind::Meat,
    CommodityKind::Fish,
    CommodityKind::Milk,
    CommodityKind::Berries,
    CommodityKind::Aronia,
    CommodityKind::Rosehips,
    CommodityKind::Mushrooms,
    CommodityKind::Grapes,
    CommodityKind::Cherries,
    CommodityKind::Eggs,
    CommodityKind::Apples,
    CommodityKind::Pears,
    CommodityKind::Vegetables,
    CommodityKind::Cabbage,
    CommodityKind::Carrots,
    CommodityKind::Beetroot,
    CommodityKind::RyeBread,
    CommodityKind::MaslinBread,
    CommodityKind::OatGrain,
    CommodityKind::Food,
    CommodityKind::Cheese,
    CommodityKind::SmokedFish,
    CommodityKind::CuredMeat,
    CommodityKind::PreservedFood,
    CommodityKind::AroniaJam,
    CommodityKind::RosehipJam,
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
        CommodityKind::Vegetables
        | CommodityKind::Cabbage
        | CommodityKind::Carrots
        | CommodityKind::Beetroot => Some(FoodCategory::Vegetables),
        CommodityKind::Apples
        | CommodityKind::Cherries
        | CommodityKind::Grapes
        | CommodityKind::Pears => Some(FoodCategory::Fruits),
        CommodityKind::Milk | CommodityKind::Eggs | CommodityKind::Cheese => {
            Some(FoodCategory::AnimalProduce)
        }
        CommodityKind::Meat | CommodityKind::CuredMeat => Some(FoodCategory::Meats),
        CommodityKind::Fish | CommodityKind::SmokedFish => Some(FoodCategory::Fishes),
        CommodityKind::Berries
        | CommodityKind::Mushrooms
        | CommodityKind::Aronia
        | CommodityKind::Rosehips
        | CommodityKind::AroniaJam
        | CommodityKind::RosehipJam => Some(FoodCategory::Foraged),
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
            Self::Hides => 58,
            Self::Leather => 59,
            Self::Shoes => 60,
            Self::Pears => 4,
            Self::Aronia => 5,
            Self::Rosehips => 27,
            Self::Cabbage => 38,
            Self::Carrots => 50,
            Self::Beetroot => 53,
            Self::PearCider => 57,
            Self::AroniaJam => 61,
            Self::RosehipJam => 62,
            Self::AnimalFeed => 63,
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
            58 => Some(Self::Hides),
            59 => Some(Self::Leather),
            60 => Some(Self::Shoes),
            4 => Some(Self::Pears),
            5 => Some(Self::Aronia),
            27 => Some(Self::Rosehips),
            38 => Some(Self::Cabbage),
            50 => Some(Self::Carrots),
            53 => Some(Self::Beetroot),
            57 => Some(Self::PearCider),
            61 => Some(Self::AroniaJam),
            62 => Some(Self::RosehipJam),
            63 => Some(Self::AnimalFeed),
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
        matches!(self, Self::Ale | Self::Cider | Self::PearCider | Self::Mead)
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

    /// Every ready-to-eat commodity is one indivisible household ration except
    /// oats: one whole oat unit remains edible but supplies only half a meal.
    pub fn meal_value(self) -> f64 {
        match self {
            Self::Food
            | Self::PreservedFood
            | Self::Honey
            | Self::Meat
            | Self::Fish
            | Self::Berries
            | Self::Mushrooms
            | Self::Milk
            | Self::Apples
            | Self::Cherries
            | Self::Vegetables
            | Self::Eggs
            | Self::Grapes
            | Self::CuredMeat
            | Self::SmokedFish
            | Self::Cheese
            | Self::RyeBread
            | Self::MaslinBread
            | Self::Pears
            | Self::Aronia
            | Self::Rosehips
            | Self::Cabbage
            | Self::Carrots
            | Self::Beetroot
            | Self::AroniaJam
            | Self::RosehipJam => 1.0,
            Self::OatGrain => OAT_GRAIN_MEAL_VALUE,
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
            Self::Aronia => 1.3,
            Self::Rosehips => 1.2,
            Self::Mushrooms => 1.6,
            Self::Milk => 2.4,
            Self::Apples => 0.75,
            Self::Pears => 0.8,
            Self::Cherries | Self::Vegetables | Self::Food | Self::Cheese => 1.0,
            Self::Cabbage => 0.8,
            Self::Carrots => 0.7,
            Self::Beetroot => 0.75,
            Self::Eggs => 0.9,
            Self::Grapes => 1.2,
            Self::PreservedFood => 0.75,
            Self::CuredMeat => 0.55,
            Self::SmokedFish => 0.7,
            Self::Honey => 0.0,
            Self::AroniaJam | Self::RosehipJam => 0.35,
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
        CommodityKind::Hides => building.hides,
        CommodityKind::Leather => building.leather,
        CommodityKind::Shoes => building.shoes,
        CommodityKind::Pears => building.pears,
        CommodityKind::Aronia => building.aronia,
        CommodityKind::Rosehips => building.rosehips,
        CommodityKind::Cabbage => building.cabbage,
        CommodityKind::Carrots => building.carrots,
        CommodityKind::Beetroot => building.beetroot,
        CommodityKind::AroniaJam => building.aronia_jam,
        CommodityKind::RosehipJam => building.rosehip_jam,
        CommodityKind::PearCider => building.pear_cider,
        CommodityKind::AnimalFeed => building.animal_feed,
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
        CommodityKind::Hides => def.storage_hides,
        CommodityKind::Leather => def.storage_leather,
        CommodityKind::Shoes => def.storage_shoes,
        CommodityKind::PearCider => def.storage_cider,
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
        CommodityKind::RyeFlour | CommodityKind::MaslinFlour => def.storage_flour,
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
        | CommodityKind::Grapes => def.storage_food,
        CommodityKind::Pears
        | CommodityKind::Aronia
        | CommodityKind::Rosehips
        | CommodityKind::Cabbage
        | CommodityKind::Carrots
        | CommodityKind::Beetroot => def.storage_food,
        CommodityKind::CuredMeat
        | CommodityKind::SmokedFish
        | CommodityKind::Cheese
        | CommodityKind::AroniaJam
        | CommodityKind::RosehipJam => def.storage_preserved_food,
        CommodityKind::AnimalFeed => def.storage_animal_feed,
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
    whole_room(building_commodity_cap(&building.kind, kind), occupied)
}

/// True when a completed storage building may receive a new physical cart of
/// this commodity. Existing stock always remains withdrawable after a policy
/// change. Legacy booleans remain authoritative for old saves and reducers.
pub fn storage_accepts_commodity(building: &Building, kind: CommodityKind) -> bool {
    if !crate::storage_acceptance_policy::storage_kind_supports_commodity(
        &building.kind,
        kind.as_u8(),
    ) {
        return !matches!(building.kind.as_str(), "village_storehouse" | "granary");
    }
    if !crate::storage_acceptance_policy::storage_mask_accepts(
        building.storage_acceptance_mask,
        kind.as_u8(),
    ) {
        return false;
    }
    match (building.kind.as_str(), kind) {
        ("village_storehouse", CommodityKind::Timber) => building.storehouse_accepts_timber,
        ("village_storehouse", CommodityKind::Stone) => building.storehouse_accepts_stone,
        ("village_storehouse", CommodityKind::Firewood) => building.storehouse_accepts_firewood,
        ("village_storehouse", CommodityKind::Charcoal) => building.storehouse_accepts_charcoal,
        ("village_storehouse", CommodityKind::Iron) => building.storehouse_accepts_iron,
        ("village_storehouse", CommodityKind::Clay) => building.storehouse_accepts_clay,
        ("village_storehouse", CommodityKind::Salt) => building.storehouse_accepts_salt,
        ("granary", commodity) if commodity.is_fresh_food() || commodity.is_preserved_food() => {
            building.granary_accepts_fresh_food
        }
        _ => true,
    }
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
    let withdrawn = whole_transfer(building_commodity_stock(building, kind), amount);
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
        CommodityKind::Hides => building.hides -= withdrawn,
        CommodityKind::Leather => building.leather -= withdrawn,
        CommodityKind::Shoes => building.shoes -= withdrawn,
        CommodityKind::Pears => building.pears -= withdrawn,
        CommodityKind::Aronia => building.aronia -= withdrawn,
        CommodityKind::Rosehips => building.rosehips -= withdrawn,
        CommodityKind::Cabbage => building.cabbage -= withdrawn,
        CommodityKind::Carrots => building.carrots -= withdrawn,
        CommodityKind::Beetroot => building.beetroot -= withdrawn,
        CommodityKind::AroniaJam => building.aronia_jam -= withdrawn,
        CommodityKind::RosehipJam => building.rosehip_jam -= withdrawn,
        CommodityKind::PearCider => building.pear_cider -= withdrawn,
        CommodityKind::AnimalFeed => building.animal_feed -= withdrawn,
    }
    withdrawn
}

pub fn deposit_building_commodity(
    building: &mut Building,
    kind: CommodityKind,
    amount: f64,
) -> f64 {
    let deposited = building_commodity_room(building, kind).min(whole_units(amount));
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
        CommodityKind::Hides => building.hides += deposited,
        CommodityKind::Leather => building.leather += deposited,
        CommodityKind::Shoes => building.shoes += deposited,
        CommodityKind::Pears => building.pears += deposited,
        CommodityKind::Aronia => building.aronia += deposited,
        CommodityKind::Rosehips => building.rosehips += deposited,
        CommodityKind::Cabbage => building.cabbage += deposited,
        CommodityKind::Carrots => building.carrots += deposited,
        CommodityKind::Beetroot => building.beetroot += deposited,
        CommodityKind::AroniaJam => building.aronia_jam += deposited,
        CommodityKind::RosehipJam => building.rosehip_jam += deposited,
        CommodityKind::PearCider => building.pear_cider += deposited,
        CommodityKind::AnimalFeed => building.animal_feed += deposited,
    }
    deposited
}

pub fn credit_treasury_commodity(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    kind: CommodityKind,
    amount: f64,
) {
    let amount = whole_units(amount);
    if amount < 1.0 {
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
        CommodityKind::Hides => treasury.hides += amount,
        CommodityKind::Leather => treasury.leather += amount,
        CommodityKind::Shoes => treasury.shoes += amount,
        CommodityKind::Pears => treasury.pears += amount,
        CommodityKind::Aronia => treasury.aronia += amount,
        CommodityKind::Rosehips => treasury.rosehips += amount,
        CommodityKind::Cabbage => treasury.cabbage += amount,
        CommodityKind::Carrots => treasury.carrots += amount,
        CommodityKind::Beetroot => treasury.beetroot += amount,
        CommodityKind::AroniaJam => treasury.aronia_jam += amount,
        CommodityKind::RosehipJam => treasury.rosehip_jam += amount,
        CommodityKind::PearCider => treasury.pear_cider += amount,
        // Prepared fodder exists only in physical livestock stores.
        CommodityKind::AnimalFeed => return,
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
        CommodityKind::Pears => residence.pears,
        CommodityKind::Aronia => residence.aronia,
        CommodityKind::Rosehips => residence.rosehips,
        CommodityKind::Cabbage => residence.cabbage,
        CommodityKind::Carrots => residence.carrots,
        CommodityKind::Beetroot => residence.beetroot,
        CommodityKind::AroniaJam => residence.aronia_jam,
        CommodityKind::RosehipJam => residence.rosehip_jam,
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

pub fn food_category_qualifying_stock(_population: u32) -> f64 {
    1.0
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

fn building_food_category_mask(building: &Building, population: u32) -> u8 {
    let qualifying_stock = food_category_qualifying_stock(population);
    FoodCategory::ALL.into_iter().fold(0_u8, |mask, category| {
        let stock = EDIBLE_COMMODITIES
            .into_iter()
            .filter(|commodity| food_category(*commodity) == Some(category))
            .map(|commodity| {
                building_commodity_stock(building, commodity).max(0.0) * commodity.meal_value()
            })
            .sum::<f64>();
        if stock + 1e-6 >= qualifying_stock {
            mask | category.bit()
        } else {
            mask
        }
    })
}

/// Count the food goals that matter at a residence tier. Tier 1 can live on
/// any qualifying food. Tier 2 establishes grain as the staple alongside one
/// other category. Tier 3+ keeps that staple and asks for produce/forage,
/// land-based animal food, and fish as distinct parts of the diet. Tier 4
/// splits animal produce from meat, so eggs/milk and pork no longer satisfy
/// the same late-game food goal. Its cured-food standard remains the separate
/// PreservedFood need.
pub fn residence_food_progression_slots(residence: &Residence, tier: u8) -> u8 {
    let categories = residence_food_category_mask(residence);
    food_progression_slots(categories, residence_grain_food_ready(residence), tier)
}

fn food_progression_slots(categories: u8, grain_ready: bool, tier: u8) -> u8 {
    if tier == 0 {
        return 0;
    }
    if tier == 1 {
        return u8::from(categories != 0);
    }

    if tier == 2 {
        let other_food_ready = categories & !FoodCategory::Grains.bit() != 0;
        return u8::from(grain_ready) + u8::from(other_food_ready);
    }

    let produce_or_forage = FoodCategory::Vegetables.bit()
        | FoodCategory::Fruits.bit()
        | FoodCategory::Foraged.bit()
        | FoodCategory::Honey.bit();
    if tier == 3 {
        let land_animal_food = FoodCategory::AnimalProduce.bit() | FoodCategory::Meats.bit();
        return u8::from(grain_ready)
            + u8::from(categories & produce_or_forage != 0)
            + u8::from(categories & land_animal_food != 0)
            + u8::from(categories & FoodCategory::Fishes.bit() != 0);
    }

    u8::from(grain_ready)
        + u8::from(categories & produce_or_forage != 0)
        + u8::from(categories & FoodCategory::AnimalProduce.bit() != 0)
        + u8::from(categories & FoodCategory::Meats.bit() != 0)
        + u8::from(categories & FoodCategory::Fishes.bit() != 0)
}

/// Whether one serving outlet holds every food slot required by a household's
/// current tier. Regional imports and local output share the same physical
/// Marketplace inventory, so promotion must not distinguish their origin.
pub fn building_food_progression_met(building: &Building, population: u32, tier: u8) -> bool {
    let categories = building_food_category_mask(building, population);
    let qualifying_stock = food_category_qualifying_stock(population);
    let grain_stock = [
        CommodityKind::Food,
        CommodityKind::OatGrain,
        CommodityKind::RyeBread,
        CommodityKind::MaslinBread,
    ]
    .into_iter()
    .map(|kind| building_commodity_stock(building, kind).max(0.0) * kind.meal_value())
    .sum::<f64>();
    food_progression_slots(categories, grain_stock + 1e-6 >= qualifying_stock, tier)
        >= residence_food_progression_required_slots(tier)
}

pub fn residence_food_progression_required_slots(tier: u8) -> u8 {
    match tier {
        0 => 0,
        1 => 1,
        2 => 2,
        3 => 4,
        _ => 5,
    }
}

pub fn residence_food_progression_met(residence: &Residence, tier: u8) -> bool {
    residence_food_progression_slots(residence, tier)
        >= residence_food_progression_required_slots(tier)
}

pub fn food_commodity_advances_residence_progression(
    residence: &Residence,
    tier: u8,
    commodity: CommodityKind,
) -> bool {
    let Some(category) = food_category(commodity) else {
        return false;
    };
    let categories = residence_food_category_mask(residence);
    if tier <= 1 {
        return categories == 0;
    }
    if tier == 2 {
        return (!residence_grain_food_ready(residence) && is_grain_food(commodity))
            || (categories & !FoodCategory::Grains.bit() == 0 && category != FoodCategory::Grains);
    }

    match category {
        FoodCategory::Grains => !residence_grain_food_ready(residence) && is_grain_food(commodity),
        FoodCategory::Vegetables
        | FoodCategory::Fruits
        | FoodCategory::Foraged
        | FoodCategory::Honey => {
            let produce_or_forage = FoodCategory::Vegetables.bit()
                | FoodCategory::Fruits.bit()
                | FoodCategory::Foraged.bit()
                | FoodCategory::Honey.bit();
            categories & produce_or_forage == 0
        }
        FoodCategory::AnimalProduce if tier >= 4 => {
            categories & FoodCategory::AnimalProduce.bit() == 0
        }
        FoodCategory::Meats if tier >= 4 => categories & FoodCategory::Meats.bit() == 0,
        FoodCategory::AnimalProduce | FoodCategory::Meats => {
            let land_animal_food = FoodCategory::AnimalProduce.bit() | FoodCategory::Meats.bit();
            categories & land_animal_food == 0
        }
        FoodCategory::Fishes => categories & FoodCategory::Fishes.bit() == 0,
    }
}

fn residence_grain_food_ready(residence: &Residence) -> bool {
    let qualifying_stock = food_category_qualifying_stock(residence.population);
    let grain_stock = [
        CommodityKind::Food,
        CommodityKind::OatGrain,
        CommodityKind::RyeBread,
        CommodityKind::MaslinBread,
    ]
    .into_iter()
    .map(|kind| residence_commodity_stock(residence, kind).max(0.0) * kind.meal_value())
    .sum::<f64>();
    grain_stock + 1e-6 >= qualifying_stock
}

fn is_grain_food(commodity: CommodityKind) -> bool {
    matches!(
        commodity,
        CommodityKind::Food
            | CommodityKind::OatGrain
            | CommodityKind::RyeBread
            | CommodityKind::MaslinBread
    )
}

pub fn withdraw_residence_commodity(
    residence: &mut Residence,
    kind: CommodityKind,
    amount: f64,
) -> f64 {
    let withdrawn = whole_transfer(residence_commodity_stock(residence, kind), amount);
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
        CommodityKind::Pears => residence.pears -= withdrawn,
        CommodityKind::Aronia => residence.aronia -= withdrawn,
        CommodityKind::Rosehips => residence.rosehips -= withdrawn,
        CommodityKind::Cabbage => residence.cabbage -= withdrawn,
        CommodityKind::Carrots => residence.carrots -= withdrawn,
        CommodityKind::Beetroot => residence.beetroot -= withdrawn,
        CommodityKind::AroniaJam => residence.aronia_jam -= withdrawn,
        CommodityKind::RosehipJam => residence.rosehip_jam -= withdrawn,
        _ => return 0.0,
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
    let deposited = whole_units(room / kind.meal_value().max(1e-9)).min(whole_units(amount));
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
        CommodityKind::Pears => residence.pears += deposited,
        CommodityKind::Aronia => residence.aronia += deposited,
        CommodityKind::Rosehips => residence.rosehips += deposited,
        CommodityKind::Cabbage => residence.cabbage += deposited,
        CommodityKind::Carrots => residence.carrots += deposited,
        CommodityKind::Beetroot => residence.beetroot += deposited,
        CommodityKind::AroniaJam => residence.aronia_jam += deposited,
        CommodityKind::RosehipJam => residence.rosehip_jam += deposited,
        _ => return 0.0,
    }
    deposited
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::{
        food_category, food_category_qualifying_stock, CommodityKind, FoodCategory, ALL_COMMODITIES,
    };

    #[test]
    fn commodity_ids_remain_stable_and_round_trip() {
        for id in 0_u8..=63 {
            let commodity =
                CommodityKind::from_u8(id).unwrap_or_else(|| panic!("missing commodity id {id}"));
            assert_eq!(commodity.as_u8(), id);
        }
        assert_eq!(CommodityKind::from_u8(64), None);
    }

    #[test]
    fn all_commodities_is_exhaustive_and_unique() {
        let ids = ALL_COMMODITIES
            .iter()
            .copied()
            .map(CommodityKind::as_u8)
            .collect::<HashSet<_>>();
        assert_eq!(ids.len(), 64);
        for id in 0_u8..=63 {
            assert!(ids.contains(&id), "ALL_COMMODITIES omits commodity id {id}");
        }
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
        assert_eq!(CommodityKind::OatGrain.meal_value(), 0.5);
        assert_eq!(CommodityKind::MaslinBread.meal_value(), 1.0);
        assert_eq!(CommodityKind::Meat.meal_value(), 1.0);
        assert_eq!(CommodityKind::Berries.meal_value(), 1.0);
        assert_eq!(CommodityKind::Fish.meal_value(), 1.0);
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
