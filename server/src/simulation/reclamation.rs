//! Physical recovery of goods left where a structure was dismantled.

use std::collections::{HashMap, HashSet};

use spacetimedb::ReducerContext;

use crate::balance_generated::{
    STOREHOUSE_HAUL_PER_WORKER, TIMBER_DELIVERY_SPEED_MPS, TIMBER_DELIVERY_UNLOAD_SEC,
};
use crate::building_defs::building_def;
use crate::construction_priority::CONSTRUCTION_PRIORITY_NORMAL;
use crate::db::*;
use crate::economy::{
    building_commodity_room, building_commodity_stock, deposit_building_commodity,
    storage_accepts_commodity, CommodityKind,
};
use crate::placement_validation::{
    building_overlaps_road_surface, resolved_building_placement_yaw,
};
use crate::reducers::buildings::next_available_building_id;
use crate::resource_units::whole_units;
use crate::roads::load_owner_road_network;
use crate::simulation::delivery_cargo::DeliveryCargoTotals;
use crate::simulation::delivery_trips::{
    available_free_haulers, building_has_active_trip, building_has_inbound_supply_trip,
    try_start_free_building_supply_trip,
};
use crate::simulation::road_logistics::local_delivery_distance;
use crate::simulation::{labor_and_logistics_paused, GameClock, SimTickContext};
use crate::tables::{Building, PlayerResources, WorldConfig};

const EPSILON: f64 = 1e-6;
const RECOVERY_ORDER: [CommodityKind; 75] = [
    CommodityKind::Gold,
    CommodityKind::Remedies,
    CommodityKind::RyeSheaves,
    CommodityKind::OatSheaves,
    CommodityKind::BarleySheaves,
    CommodityKind::MaslinSheaves,
    CommodityKind::RyeGrain,
    CommodityKind::OatGrain,
    CommodityKind::AnimalFeed,
    CommodityKind::MaslinGrain,
    CommodityKind::Barley,
    CommodityKind::Malt,
    CommodityKind::RyeFlour,
    CommodityKind::MaslinFlour,
    CommodityKind::PreservedFood,
    CommodityKind::RyeBread,
    CommodityKind::MaslinBread,
    CommodityKind::Meat,
    CommodityKind::Fish,
    CommodityKind::Berries,
    CommodityKind::Mushrooms,
    CommodityKind::Milk,
    CommodityKind::Apples,
    CommodityKind::Pears,
    CommodityKind::Aronia,
    CommodityKind::Rosehips,
    CommodityKind::Cherries,
    CommodityKind::Vegetables,
    CommodityKind::Cabbage,
    CommodityKind::Carrots,
    CommodityKind::Beetroot,
    CommodityKind::Eggs,
    CommodityKind::Grapes,
    CommodityKind::CuredMeat,
    CommodityKind::SmokedFish,
    CommodityKind::Cheese,
    CommodityKind::AroniaJam,
    CommodityKind::RosehipJam,
    CommodityKind::Ale,
    CommodityKind::Cider,
    CommodityKind::PearCider,
    CommodityKind::Mead,
    CommodityKind::Honey,
    CommodityKind::Candles,
    CommodityKind::Wine,
    CommodityKind::Cloth,
    CommodityKind::Pelts,
    CommodityKind::Yarn,
    CommodityKind::Linen,
    CommodityKind::Shoes,
    CommodityKind::Leather,
    CommodityKind::Hides,
    CommodityKind::Wax,
    CommodityKind::Flax,
    CommodityKind::Iron,
    CommodityKind::Salt,
    CommodityKind::Pottery,
    CommodityKind::RoofTiles,
    CommodityKind::Charcoal,
    CommodityKind::Clay,
    CommodityKind::Manure,
    CommodityKind::Wool,
    CommodityKind::Ironwork,
    CommodityKind::Polearms,
    CommodityKind::Sidearms,
    CommodityKind::Shields,
    CommodityKind::Bows,
    CommodityKind::Crossbows,
    CommodityKind::PaddedArmor,
    CommodityKind::MailArmor,
    CommodityKind::Ammunition,
    CommodityKind::Firewood,
    CommodityKind::Stone,
    CommodityKind::Timber,
    CommodityKind::Water,
];

#[derive(Clone, Copy, Debug, Default)]
pub struct ReclamationStock {
    pub timber: f64,
    pub firewood: f64,
    pub stone: f64,
    pub water: f64,
    pub ale: f64,
    pub cider: f64,
    pub pear_cider: f64,
    pub mead: f64,
    pub preserved_food: f64,
    pub honey: f64,
    pub wax: f64,
    pub candles: f64,
    pub wine: f64,
    pub ironwork: f64,
    pub polearms: f64,
    pub wool: f64,
    pub cloth: f64,
    pub pelts: f64,
    pub yarn: f64,
    pub linen: f64,
    pub sidearms: f64,
    pub shields: f64,
    pub bows: f64,
    pub crossbows: f64,
    pub padded_armor: f64,
    pub mail_armor: f64,
    pub ammunition: f64,
    pub hides: f64,
    pub leather: f64,
    pub shoes: f64,
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
    pub remedies: f64,
    pub roof_tiles: f64,
    pub meat: f64,
    pub fish: f64,
    pub berries: f64,
    pub mushrooms: f64,
    pub milk: f64,
    pub apples: f64,
    pub cherries: f64,
    pub vegetables: f64,
    pub eggs: f64,
    pub grapes: f64,
    pub cured_meat: f64,
    pub smoked_fish: f64,
    pub cheese: f64,
    pub rye_sheaves: f64,
    pub oat_sheaves: f64,
    pub barley_sheaves: f64,
    pub maslin_sheaves: f64,
    pub rye_grain: f64,
    pub oat_grain: f64,
    pub animal_feed: f64,
    pub maslin_grain: f64,
    pub rye_flour: f64,
    pub maslin_flour: f64,
    pub rye_bread: f64,
    pub maslin_bread: f64,
    pub pears: f64,
    pub aronia: f64,
    pub rosehips: f64,
    pub cabbage: f64,
    pub carrots: f64,
    pub beetroot: f64,
    pub aronia_jam: f64,
    pub rosehip_jam: f64,
}

impl ReclamationStock {
    pub fn from_commodity(commodity: CommodityKind, amount: f64) -> Self {
        let amount = whole_units(amount);
        match commodity {
            CommodityKind::Timber => Self {
                timber: amount,
                ..Self::default()
            },
            CommodityKind::Firewood => Self {
                firewood: amount,
                ..Self::default()
            },
            CommodityKind::Stone => Self {
                stone: amount,
                ..Self::default()
            },
            CommodityKind::Water => Self {
                water: amount,
                ..Self::default()
            },
            CommodityKind::Ale => Self {
                ale: amount,
                ..Self::default()
            },
            CommodityKind::Cider => Self {
                cider: amount,
                ..Self::default()
            },
            CommodityKind::PearCider => Self {
                pear_cider: amount,
                ..Self::default()
            },
            CommodityKind::Mead => Self {
                mead: amount,
                ..Self::default()
            },
            CommodityKind::PreservedFood => Self {
                preserved_food: amount,
                ..Self::default()
            },
            CommodityKind::Honey => Self {
                honey: amount,
                ..Self::default()
            },
            CommodityKind::Wax => Self {
                wax: amount,
                ..Self::default()
            },
            CommodityKind::Candles => Self {
                candles: amount,
                ..Self::default()
            },
            CommodityKind::Wine => Self {
                wine: amount,
                ..Self::default()
            },
            CommodityKind::Ironwork => Self {
                ironwork: amount,
                ..Self::default()
            },
            CommodityKind::Polearms => Self {
                polearms: amount,
                ..Self::default()
            },
            CommodityKind::Wool => Self {
                wool: amount,
                ..Self::default()
            },
            CommodityKind::Cloth => Self {
                cloth: amount,
                ..Self::default()
            },
            CommodityKind::Pelts => Self {
                pelts: amount,
                ..Self::default()
            },
            CommodityKind::Yarn => Self {
                yarn: amount,
                ..Self::default()
            },
            CommodityKind::Linen => Self {
                linen: amount,
                ..Self::default()
            },
            CommodityKind::Sidearms => Self { sidearms: amount, ..Self::default() },
            CommodityKind::Shields => Self { shields: amount, ..Self::default() },
            CommodityKind::Bows => Self { bows: amount, ..Self::default() },
            CommodityKind::Crossbows => Self { crossbows: amount, ..Self::default() },
            CommodityKind::PaddedArmor => Self { padded_armor: amount, ..Self::default() },
            CommodityKind::MailArmor => Self { mail_armor: amount, ..Self::default() },
            CommodityKind::Ammunition => Self { ammunition: amount, ..Self::default() },
            CommodityKind::Hides => Self {
                hides: amount,
                ..Self::default()
            },
            CommodityKind::Leather => Self {
                leather: amount,
                ..Self::default()
            },
            CommodityKind::Shoes => Self {
                shoes: amount,
                ..Self::default()
            },
            CommodityKind::Gold => Self {
                gold: amount,
                ..Self::default()
            },
            CommodityKind::Barley => Self {
                barley: amount,
                ..Self::default()
            },
            CommodityKind::Malt => Self {
                malt: amount,
                ..Self::default()
            },
            CommodityKind::Flax => Self {
                flax: amount,
                ..Self::default()
            },
            CommodityKind::Iron => Self {
                iron: amount,
                ..Self::default()
            },
            CommodityKind::Clay => Self {
                clay: amount,
                ..Self::default()
            },
            CommodityKind::Salt => Self {
                salt: amount,
                ..Self::default()
            },
            CommodityKind::Charcoal => Self {
                charcoal: amount,
                ..Self::default()
            },
            CommodityKind::Pottery => Self {
                pottery: amount,
                ..Self::default()
            },
            CommodityKind::Manure => Self {
                manure: amount,
                ..Self::default()
            },
            CommodityKind::Remedies => Self {
                remedies: amount,
                ..Self::default()
            },
            CommodityKind::RoofTiles => Self {
                roof_tiles: amount,
                ..Self::default()
            },
            CommodityKind::Meat => Self {
                meat: amount,
                ..Self::default()
            },
            CommodityKind::Fish => Self {
                fish: amount,
                ..Self::default()
            },
            CommodityKind::Berries => Self {
                berries: amount,
                ..Self::default()
            },
            CommodityKind::Mushrooms => Self {
                mushrooms: amount,
                ..Self::default()
            },
            CommodityKind::Milk => Self {
                milk: amount,
                ..Self::default()
            },
            CommodityKind::Apples => Self {
                apples: amount,
                ..Self::default()
            },
            CommodityKind::Cherries => Self {
                cherries: amount,
                ..Self::default()
            },
            CommodityKind::Vegetables => Self {
                vegetables: amount,
                ..Self::default()
            },
            CommodityKind::Eggs => Self {
                eggs: amount,
                ..Self::default()
            },
            CommodityKind::Grapes => Self {
                grapes: amount,
                ..Self::default()
            },
            CommodityKind::CuredMeat => Self {
                cured_meat: amount,
                ..Self::default()
            },
            CommodityKind::SmokedFish => Self {
                smoked_fish: amount,
                ..Self::default()
            },
            CommodityKind::Cheese => Self {
                cheese: amount,
                ..Self::default()
            },
            CommodityKind::RyeSheaves => Self {
                rye_sheaves: amount,
                ..Self::default()
            },
            CommodityKind::OatSheaves => Self {
                oat_sheaves: amount,
                ..Self::default()
            },
            CommodityKind::BarleySheaves => Self {
                barley_sheaves: amount,
                ..Self::default()
            },
            CommodityKind::MaslinSheaves => Self {
                maslin_sheaves: amount,
                ..Self::default()
            },
            CommodityKind::RyeGrain => Self {
                rye_grain: amount,
                ..Self::default()
            },
            CommodityKind::OatGrain => Self {
                oat_grain: amount,
                ..Self::default()
            },
            CommodityKind::AnimalFeed => Self {
                animal_feed: amount,
                ..Self::default()
            },
            CommodityKind::MaslinGrain => Self {
                maslin_grain: amount,
                ..Self::default()
            },
            CommodityKind::RyeFlour => Self {
                rye_flour: amount,
                ..Self::default()
            },
            CommodityKind::MaslinFlour => Self {
                maslin_flour: amount,
                ..Self::default()
            },
            CommodityKind::RyeBread => Self {
                rye_bread: amount,
                ..Self::default()
            },
            CommodityKind::MaslinBread => Self {
                maslin_bread: amount,
                ..Self::default()
            },
            CommodityKind::Pears => Self {
                pears: amount,
                ..Self::default()
            },
            CommodityKind::Aronia => Self {
                aronia: amount,
                ..Self::default()
            },
            CommodityKind::Rosehips => Self {
                rosehips: amount,
                ..Self::default()
            },
            CommodityKind::Cabbage => Self {
                cabbage: amount,
                ..Self::default()
            },
            CommodityKind::Carrots => Self {
                carrots: amount,
                ..Self::default()
            },
            CommodityKind::Beetroot => Self {
                beetroot: amount,
                ..Self::default()
            },
            CommodityKind::AroniaJam => Self {
                aronia_jam: amount,
                ..Self::default()
            },
            CommodityKind::RosehipJam => Self {
                rosehip_jam: amount,
                ..Self::default()
            },
        }
    }

    /// Convert every portable inventory field to its authoritative whole-unit
    /// representation. Salvage ratios may be fractional, but the goods they
    /// produce are indivisible and fractions are never carried into a pile.
    pub fn normalized(mut self) -> Self {
        macro_rules! normalize_fields {
            ($($field:ident),+ $(,)?) => {
                $(self.$field = whole_units(self.$field);)+
            };
        }
        normalize_fields!(
            timber,
            firewood,
            stone,
            water,
            ale,
            cider,
            pear_cider,
            mead,
            preserved_food,
            honey,
            wax,
            candles,
            wine,
            ironwork,
            polearms,
            wool,
            cloth,
            pelts,
            yarn,
            linen,
            sidearms,
            shields,
            bows,
            crossbows,
            padded_armor,
            mail_armor,
            ammunition,
            hides,
            leather,
            shoes,
            gold,
            barley,
            malt,
            flax,
            iron,
            clay,
            salt,
            charcoal,
            pottery,
            manure,
            remedies,
            roof_tiles,
            meat,
            fish,
            berries,
            mushrooms,
            milk,
            apples,
            cherries,
            vegetables,
            eggs,
            grapes,
            cured_meat,
            smoked_fish,
            cheese,
            rye_sheaves,
            oat_sheaves,
            barley_sheaves,
            maslin_sheaves,
            rye_grain,
            oat_grain,
            animal_feed,
            maslin_grain,
            rye_flour,
            maslin_flour,
            rye_bread,
            maslin_bread,
            pears,
            aronia,
            rosehips,
            cabbage,
            carrots,
            beetroot,
            aronia_jam,
            rosehip_jam,
        );
        self
    }

    /// Capture all portable inventory in a building without preserving legacy
    /// fractional stock.
    pub fn from_building(building: &Building) -> Self {
        RECOVERY_ORDER
            .into_iter()
            .fold(Self::default(), |stock, commodity| {
                stock.merged(Self::from_commodity(
                    commodity,
                    building_commodity_stock(building, commodity),
                ))
            })
    }

    /// Capture cart cargo before a source or destination row is retired.
    pub fn from_delivery_cargo(cargo: &DeliveryCargoTotals) -> Self {
        Self {
            timber: cargo.timber,
            firewood: cargo.firewood,
            stone: cargo.stone,
            water: cargo.water,
            ale: cargo.ale,
            cider: cargo.cider,
            pear_cider: cargo.pear_cider,
            mead: cargo.mead,
            preserved_food: cargo.preserved_food,
            honey: cargo.honey,
            wax: cargo.wax,
            candles: cargo.candles,
            wine: cargo.wine,
            ironwork: cargo.ironwork,
            polearms: cargo.polearms,
            wool: cargo.wool,
            cloth: cargo.cloth,
            pelts: cargo.pelts,
            yarn: cargo.yarn,
            linen: cargo.linen,
            sidearms: cargo.sidearms,
            shields: cargo.shields,
            bows: cargo.bows,
            crossbows: cargo.crossbows,
            padded_armor: cargo.padded_armor,
            mail_armor: cargo.mail_armor,
            ammunition: cargo.ammunition,
            hides: cargo.hides,
            leather: cargo.leather,
            shoes: cargo.shoes,
            gold: cargo.gold,
            barley: cargo.barley,
            malt: cargo.malt,
            flax: cargo.flax,
            iron: cargo.iron,
            clay: cargo.clay,
            salt: cargo.salt,
            charcoal: cargo.charcoal,
            pottery: cargo.pottery,
            manure: cargo.manure,
            remedies: cargo.remedies,
            roof_tiles: cargo.roof_tiles,
            meat: cargo.meat,
            fish: cargo.fish,
            berries: cargo.berries,
            mushrooms: cargo.mushrooms,
            milk: cargo.milk,
            apples: cargo.apples,
            cherries: cargo.cherries,
            vegetables: cargo.vegetables,
            eggs: cargo.eggs,
            grapes: cargo.grapes,
            cured_meat: cargo.cured_meat,
            smoked_fish: cargo.smoked_fish,
            cheese: cargo.cheese,
            rye_sheaves: cargo.rye_sheaves,
            oat_sheaves: cargo.oat_sheaves,
            barley_sheaves: cargo.barley_sheaves,
            maslin_sheaves: cargo.maslin_sheaves,
            rye_grain: cargo.rye_grain,
            oat_grain: cargo.oat_grain,
            animal_feed: cargo.animal_feed,
            maslin_grain: cargo.maslin_grain,
            rye_flour: cargo.rye_flour,
            maslin_flour: cargo.maslin_flour,
            rye_bread: cargo.rye_bread,
            maslin_bread: cargo.maslin_bread,
            pears: cargo.pears,
            aronia: cargo.aronia,
            rosehips: cargo.rosehips,
            cabbage: cargo.cabbage,
            carrots: cargo.carrots,
            beetroot: cargo.beetroot,
            aronia_jam: cargo.aronia_jam,
            rosehip_jam: cargo.rosehip_jam,
        }
        .normalized()
    }

    pub fn commodities() -> [CommodityKind; 75] {
        RECOVERY_ORDER
    }

    /// Merge two recovery ledgers without creating fractional cargo.
    pub fn merged(self, other: Self) -> Self {
        let mut merged = self.normalized();
        let other = other.normalized();
        macro_rules! merge_fields {
            ($($field:ident),+ $(,)?) => {
                $(merged.$field = whole_units(merged.$field + other.$field);)+
            };
        }
        merge_fields!(
            timber,
            firewood,
            stone,
            water,
            ale,
            cider,
            pear_cider,
            mead,
            preserved_food,
            honey,
            wax,
            candles,
            wine,
            ironwork,
            polearms,
            wool,
            cloth,
            pelts,
            yarn,
            linen,
            sidearms,
            shields,
            bows,
            crossbows,
            padded_armor,
            mail_armor,
            ammunition,
            hides,
            leather,
            shoes,
            gold,
            barley,
            malt,
            flax,
            iron,
            clay,
            salt,
            charcoal,
            pottery,
            manure,
            remedies,
            roof_tiles,
            meat,
            fish,
            berries,
            mushrooms,
            milk,
            apples,
            cherries,
            vegetables,
            eggs,
            grapes,
            cured_meat,
            smoked_fish,
            cheese,
            rye_sheaves,
            oat_sheaves,
            barley_sheaves,
            maslin_sheaves,
            rye_grain,
            oat_grain,
            animal_feed,
            maslin_grain,
            rye_flour,
            maslin_flour,
            rye_bread,
            maslin_bread,
            pears,
            aronia,
            rosehips,
            cabbage,
            carrots,
            beetroot,
            aronia_jam,
            rosehip_jam,
        );
        merged
    }

    pub fn is_empty(self) -> bool {
        let stock = self.normalized();
        RECOVERY_ORDER
            .into_iter()
            .all(|commodity| stock.amount(commodity) <= EPSILON)
    }

    pub(crate) fn from_resource_ledger(resources: &PlayerResources) -> Self {
        Self {
            timber: resources.timber.max(0.0),
            firewood: resources.firewood.max(0.0),
            stone: resources.stone.max(0.0),
            water: resources.water.max(0.0),
            ale: resources.ale.max(0.0),
            cider: resources.cider.max(0.0),
            pear_cider: resources.pear_cider.max(0.0),
            mead: resources.mead.max(0.0),
            preserved_food: resources.preserved_food.max(0.0),
            honey: resources.honey.max(0.0),
            wax: resources.wax.max(0.0),
            candles: resources.candles.max(0.0),
            wine: resources.wine.max(0.0),
            ironwork: resources.ironwork.max(0.0),
            polearms: resources.polearms.max(0.0),
            wool: resources.wool.max(0.0),
            cloth: resources.cloth.max(0.0),
            pelts: resources.pelts.max(0.0),
            yarn: resources.yarn.max(0.0),
            linen: resources.linen.max(0.0),
            sidearms: resources.sidearms.max(0.0),
            shields: resources.shields.max(0.0),
            bows: resources.bows.max(0.0),
            crossbows: resources.crossbows.max(0.0),
            padded_armor: resources.padded_armor.max(0.0),
            mail_armor: resources.mail_armor.max(0.0),
            ammunition: resources.ammunition.max(0.0),
            hides: resources.hides.max(0.0),
            leather: resources.leather.max(0.0),
            shoes: resources.shoes.max(0.0),
            gold: resources.gold.max(0.0),
            barley: resources.barley.max(0.0),
            malt: resources.malt.max(0.0),
            flax: resources.flax.max(0.0),
            iron: resources.iron.max(0.0),
            clay: resources.clay.max(0.0),
            salt: resources.salt.max(0.0),
            charcoal: resources.charcoal.max(0.0),
            pottery: resources.pottery.max(0.0),
            manure: 0.0,
            remedies: 0.0,
            roof_tiles: resources.roof_tiles.max(0.0),
            meat: resources.meat.max(0.0),
            fish: resources.fish.max(0.0),
            berries: resources.berries.max(0.0),
            mushrooms: resources.mushrooms.max(0.0),
            milk: resources.milk.max(0.0),
            apples: resources.apples.max(0.0),
            cherries: resources.cherries.max(0.0),
            vegetables: resources.vegetables.max(0.0),
            eggs: resources.eggs.max(0.0),
            grapes: resources.grapes.max(0.0),
            cured_meat: resources.cured_meat.max(0.0),
            smoked_fish: resources.smoked_fish.max(0.0),
            cheese: resources.cheese.max(0.0),
            rye_sheaves: resources.rye_sheaves.max(0.0),
            oat_sheaves: resources.oat_sheaves.max(0.0),
            barley_sheaves: resources.barley_sheaves.max(0.0),
            maslin_sheaves: resources.maslin_sheaves.max(0.0),
            rye_grain: resources.rye_grain.max(0.0),
            oat_grain: resources.oat_grain.max(0.0),
            animal_feed: 0.0,
            maslin_grain: resources.maslin_grain.max(0.0),
            rye_flour: resources.rye_flour.max(0.0),
            maslin_flour: resources.maslin_flour.max(0.0),
            rye_bread: resources.rye_bread.max(0.0),
            maslin_bread: resources.maslin_bread.max(0.0),
            pears: resources.pears.max(0.0),
            aronia: resources.aronia.max(0.0),
            rosehips: resources.rosehips.max(0.0),
            cabbage: resources.cabbage.max(0.0),
            carrots: resources.carrots.max(0.0),
            beetroot: resources.beetroot.max(0.0),
            aronia_jam: resources.aronia_jam.max(0.0),
            rosehip_jam: resources.rosehip_jam.max(0.0),
        }
        .normalized()
    }

    pub fn amount(self, commodity: CommodityKind) -> f64 {
        match commodity {
            CommodityKind::Timber => self.timber,
            CommodityKind::Firewood => self.firewood,
            CommodityKind::Stone => self.stone,
            CommodityKind::Water => self.water,
            CommodityKind::Ale => self.ale,
            CommodityKind::Cider => self.cider,
            CommodityKind::PearCider => self.pear_cider,
            CommodityKind::Mead => self.mead,
            CommodityKind::PreservedFood => self.preserved_food,
            CommodityKind::Honey => self.honey,
            CommodityKind::Wax => self.wax,
            CommodityKind::Candles => self.candles,
            CommodityKind::Wine => self.wine,
            CommodityKind::Ironwork => self.ironwork,
            CommodityKind::Polearms => self.polearms,
            CommodityKind::Wool => self.wool,
            CommodityKind::Cloth => self.cloth,
            CommodityKind::Pelts => self.pelts,
            CommodityKind::Yarn => self.yarn,
            CommodityKind::Linen => self.linen,
            CommodityKind::Sidearms => self.sidearms,
            CommodityKind::Shields => self.shields,
            CommodityKind::Bows => self.bows,
            CommodityKind::Crossbows => self.crossbows,
            CommodityKind::PaddedArmor => self.padded_armor,
            CommodityKind::MailArmor => self.mail_armor,
            CommodityKind::Ammunition => self.ammunition,
            CommodityKind::Hides => self.hides,
            CommodityKind::Leather => self.leather,
            CommodityKind::Shoes => self.shoes,
            CommodityKind::Gold => self.gold,
            CommodityKind::Barley => self.barley,
            CommodityKind::Malt => self.malt,
            CommodityKind::Flax => self.flax,
            CommodityKind::Iron => self.iron,
            CommodityKind::Clay => self.clay,
            CommodityKind::Salt => self.salt,
            CommodityKind::Charcoal => self.charcoal,
            CommodityKind::Pottery => self.pottery,
            CommodityKind::Manure => self.manure,
            CommodityKind::Remedies => self.remedies,
            CommodityKind::RoofTiles => self.roof_tiles,
            CommodityKind::Meat => self.meat,
            CommodityKind::Fish => self.fish,
            CommodityKind::Berries => self.berries,
            CommodityKind::Mushrooms => self.mushrooms,
            CommodityKind::Milk => self.milk,
            CommodityKind::Apples => self.apples,
            CommodityKind::Cherries => self.cherries,
            CommodityKind::Vegetables => self.vegetables,
            CommodityKind::Eggs => self.eggs,
            CommodityKind::Grapes => self.grapes,
            CommodityKind::CuredMeat => self.cured_meat,
            CommodityKind::SmokedFish => self.smoked_fish,
            CommodityKind::Cheese => self.cheese,
            CommodityKind::RyeSheaves => self.rye_sheaves,
            CommodityKind::OatSheaves => self.oat_sheaves,
            CommodityKind::BarleySheaves => self.barley_sheaves,
            CommodityKind::MaslinSheaves => self.maslin_sheaves,
            CommodityKind::RyeGrain => self.rye_grain,
            CommodityKind::OatGrain => self.oat_grain,
            CommodityKind::AnimalFeed => self.animal_feed,
            CommodityKind::MaslinGrain => self.maslin_grain,
            CommodityKind::RyeFlour => self.rye_flour,
            CommodityKind::MaslinFlour => self.maslin_flour,
            CommodityKind::RyeBread => self.rye_bread,
            CommodityKind::MaslinBread => self.maslin_bread,
            CommodityKind::Pears => self.pears,
            CommodityKind::Aronia => self.aronia,
            CommodityKind::Rosehips => self.rosehips,
            CommodityKind::Cabbage => self.cabbage,
            CommodityKind::Carrots => self.carrots,
            CommodityKind::Beetroot => self.beetroot,
            CommodityKind::AroniaJam => self.aronia_jam,
            CommodityKind::RosehipJam => self.rosehip_jam,
        }
    }

    /// Replace a building's portable inventory with an exact, normalized
    /// recovery ledger. This is used when the source row itself becomes the
    /// reclamation pile.
    pub fn replace_building_inventory(self, building: &mut Building) {
        let merged = self.normalized();
        building.food = 0.0;
        macro_rules! replace_fields {
            ($($field:ident),+ $(,)?) => {
                $(building.$field = merged.$field;)+
            };
        }
        replace_fields!(
            timber,
            firewood,
            stone,
            water,
            ale,
            cider,
            pear_cider,
            mead,
            preserved_food,
            honey,
            wax,
            candles,
            wine,
            ironwork,
            polearms,
            wool,
            cloth,
            pelts,
            yarn,
            linen,
            sidearms,
            shields,
            bows,
            crossbows,
            padded_armor,
            mail_armor,
            ammunition,
            hides,
            leather,
            shoes,
            gold,
            barley,
            malt,
            flax,
            iron,
            clay,
            salt,
            charcoal,
            pottery,
            manure,
            remedies,
            roof_tiles,
            meat,
            fish,
            berries,
            mushrooms,
            milk,
            apples,
            cherries,
            vegetables,
            eggs,
            grapes,
            cured_meat,
            smoked_fish,
            cheese,
            rye_sheaves,
            oat_sheaves,
            barley_sheaves,
            maslin_sheaves,
            rye_grain,
            oat_grain,
            animal_feed,
            maslin_grain,
            rye_flour,
            maslin_flour,
            rye_bread,
            maslin_bread,
            pears,
            aronia,
            rosehips,
            cabbage,
            carrots,
            beetroot,
            aronia_jam,
            rosehip_jam,
        );
    }

    fn add_to_building(self, building: &mut Building) {
        Self::from_building(building)
            .merged(self)
            .replace_building_inventory(building);
    }
}

/// Credit recovered remote loot into immediately usable settlement inventory.
///
/// Ordinary reclamation remains physical and local to the loss site. Camp
/// clearance is deliberately different: requiring another cart expedition to
/// a defeated frontier camp makes the reward easy to miss and can strand it
/// beyond the owner's road network. Permanent stores receive what they have
/// room for, while the civic treasury seat accepts any remaining whole units
/// as an authoritative remote-clearance receipt. No salvage pile is created or
/// reused by this path.
pub fn credit_remote_recovery_to_settlement(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    stock: ReclamationStock,
) {
    let stock = stock.normalized();
    if stock.is_empty() {
        return;
    }

    let physical_storage = ctx
        .db
        .player_resources()
        .owner()
        .find(&owner)
        .is_some_and(|resources| resources.physical_founding_site_enabled);
    if !physical_storage {
        for commodity in RECOVERY_ORDER {
            crate::economy::credit_treasury_commodity(
                ctx,
                owner,
                commodity,
                stock.amount(commodity),
            );
        }
        return;
    }

    // Reserve the civic seat for overflow. Keeping it out of the ordinary
    // candidate list prevents a stale clone from overwriting earlier deposits.
    let mut civic_seat = crate::economy::physical_treasury_seat(ctx, owner);
    let mut stores = ctx
        .db
        .building()
        .owner()
        .filter(&owner)
        .filter(|building| {
            building.construction_complete
                && !matches!(
                    building.kind.as_str(),
                    "founders_camp" | "salvage_pile" | "town_hall"
                )
        })
        .collect::<Vec<_>>();
    stores.sort_by_key(|building| {
        (
            match building.kind.as_str() {
                "village_storehouse" => 0_u8,
                "granary" => 1,
                _ => 2,
            },
            building.id,
        )
    });

    let mut overflow = ReclamationStock::default();
    let mut changed_store_ids = HashSet::new();
    for commodity in RECOVERY_ORDER {
        let mut remaining = stock.amount(commodity);
        if remaining < 1.0 {
            continue;
        }
        for store in &mut stores {
            if remaining < 1.0 {
                break;
            }
            if !storage_accepts_commodity(store, commodity)
                || building_commodity_room(store, commodity) < 1.0
            {
                continue;
            }
            let deposited = deposit_building_commodity(store, commodity, remaining);
            if deposited >= 1.0 {
                changed_store_ids.insert(store.id);
            }
            remaining = (remaining - deposited).max(0.0);
        }
        if remaining >= 1.0 {
            overflow = overflow.merged(ReclamationStock::from_commodity(commodity, remaining));
        }
    }

    for store in stores {
        if changed_store_ids.contains(&store.id) {
            ctx.db.building().id().update(store);
        }
    }
    if overflow.is_empty() {
        return;
    }
    if let Some(ref mut seat) = civic_seat {
        overflow.add_to_building(seat);
        ctx.db.building().id().update(seat.clone());
        return;
    }

    // A physical realm should always have a completed camp or Town Hall. Keep
    // the reward lossless if an incomplete bootstrap state reaches this path.
    for commodity in RECOVERY_ORDER {
        crate::economy::credit_treasury_commodity(
            ctx,
            owner,
            commodity,
            overflow.amount(commodity),
        );
    }
}

fn clear_resource_ledger(resources: &mut PlayerResources) {
    resources.timber = 0.0;
    resources.firewood = 0.0;
    resources.stone = 0.0;
    resources.water = 0.0;
    resources.food = 0.0;
    resources.ale = 0.0;
    resources.cider = 0.0;
    resources.pear_cider = 0.0;
    resources.mead = 0.0;
    resources.preserved_food = 0.0;
    resources.honey = 0.0;
    resources.wax = 0.0;
    resources.candles = 0.0;
    resources.wine = 0.0;
    resources.ironwork = 0.0;
    resources.polearms = 0.0;
    resources.wool = 0.0;
    resources.cloth = 0.0;
    resources.pelts = 0.0;
    resources.yarn = 0.0;
    resources.linen = 0.0;
    resources.sidearms = 0.0;
    resources.shields = 0.0;
    resources.bows = 0.0;
    resources.crossbows = 0.0;
    resources.padded_armor = 0.0;
    resources.mail_armor = 0.0;
    resources.ammunition = 0.0;
    resources.hides = 0.0;
    resources.leather = 0.0;
    resources.shoes = 0.0;
    resources.gold = 0.0;
    resources.barley = 0.0;
    resources.malt = 0.0;
    resources.flax = 0.0;
    resources.iron = 0.0;
    resources.clay = 0.0;
    resources.salt = 0.0;
    resources.charcoal = 0.0;
    resources.pottery = 0.0;
    resources.roof_tiles = 0.0;
    resources.meat = 0.0;
    resources.fish = 0.0;
    resources.berries = 0.0;
    resources.mushrooms = 0.0;
    resources.milk = 0.0;
    resources.apples = 0.0;
    resources.cherries = 0.0;
    resources.vegetables = 0.0;
    resources.eggs = 0.0;
    resources.grapes = 0.0;
    resources.rye_sheaves = 0.0;
    resources.oat_sheaves = 0.0;
    resources.barley_sheaves = 0.0;
    resources.maslin_sheaves = 0.0;
    resources.rye_grain = 0.0;
    resources.oat_grain = 0.0;
    resources.maslin_grain = 0.0;
    resources.rye_flour = 0.0;
    resources.maslin_flour = 0.0;
    resources.rye_bread = 0.0;
    resources.maslin_bread = 0.0;
    resources.cured_meat = 0.0;
    resources.smoked_fish = 0.0;
    resources.cheese = 0.0;
    resources.pears = 0.0;
    resources.aronia = 0.0;
    resources.rosehips = 0.0;
    resources.cabbage = 0.0;
    resources.carrots = 0.0;
    resources.beetroot = 0.0;
    resources.aronia_jam = 0.0;
    resources.rosehip_jam = 0.0;
}

fn recovery_pile_position_beside_building(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    anchor: &Building,
) -> (f64, f64) {
    const DIRECTIONS: [(f64, f64); 8] = [
        (1.0, 0.0),
        (-1.0, 0.0),
        (0.0, 1.0),
        (0.0, -1.0),
        (0.707_106_781_18, 0.707_106_781_18),
        (-0.707_106_781_18, 0.707_106_781_18),
        (0.707_106_781_18, -0.707_106_781_18),
        (-0.707_106_781_18, -0.707_106_781_18),
    ];
    let anchor_radius = building_def(&anchor.kind)
        .map(|def| def.pick_radius)
        .unwrap_or(1.5);
    let pile_radius = building_def("salvage_pile")
        .map(|def| def.pick_radius)
        .unwrap_or(1.0);
    let offset = anchor_radius + pile_radius + 0.75;
    let network = load_owner_road_network(ctx, owner);
    let other_buildings = ctx
        .db
        .building()
        .owner()
        .filter(&owner)
        .filter(|building| building.id != anchor.id)
        .collect::<Vec<_>>();
    let mut best = None;

    for (index, (dx, dz)) in DIRECTIONS.into_iter().enumerate() {
        let x = anchor.x + dx * offset;
        let z = anchor.z + dz * offset;
        let overlaps_building = other_buildings.iter().any(|building| {
            let other_radius = building_def(&building.kind)
                .map(|def| def.pick_radius)
                .unwrap_or(1.0);
            (building.x - x).powi(2) + (building.z - z).powi(2)
                < (pile_radius + other_radius + 0.25).powi(2)
        });
        let blocked = overlaps_building
            || network
                .as_ref()
                .is_some_and(|roads| building_overlaps_road_surface(roads, "salvage_pile", x, z));
        let road_distance = network
            .as_ref()
            .map(|roads| roads.nearest_distance(x, z))
            .unwrap_or(0.0);
        let score = (u8::from(blocked), road_distance, index);
        if best
            .as_ref()
            .is_none_or(|(best_score, _): &((u8, f64, usize), (f64, f64))| {
                score.0 < best_score.0
                    || (score.0 == best_score.0
                        && (score.1 < best_score.1
                            || (score.1 == best_score.1 && score.2 < best_score.2)))
            })
        {
            best = Some((score, (x, z)));
        }
    }

    best.map(|(_, position)| position)
        .unwrap_or((anchor.x + offset, anchor.z))
}

/// Material recovered in the physical world must remain where it was left
/// rather than appearing in a remote depot. The temporary Building row reuses
/// the existing cart, marker, inspector, save, and collision paths. A legacy
/// settlement keeps its abstract refund path only until bootstrap migration.
pub fn insert_reclamation_pile(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    x: f64,
    z: f64,
    stock: ReclamationStock,
) -> Result<bool, String> {
    let stock = stock.normalized();
    let physical_reclamation = ctx
        .db
        .player_resources()
        .owner()
        .find(&owner)
        .is_some_and(|resources| resources.physical_founding_site_enabled);
    if !physical_reclamation {
        return Ok(false);
    }
    if stock.is_empty() {
        return Ok(true);
    }

    let salvage_def = building_def("salvage_pile")
        .ok_or_else(|| "Reclamation pile balance is missing.".to_string())?;
    let config = ctx
        .db
        .world_config()
        .id()
        .find(&0)
        .ok_or_else(|| "World not initialized.".to_string())?;
    let building_id = next_available_building_id(ctx, config.next_building_id)?;
    let settlement_id = crate::settlements::settlement_for_position(ctx, owner, x, z).unwrap_or(0);
    let road_network = load_owner_road_network(ctx, owner);
    let placement_yaw =
        resolved_building_placement_yaw(road_network.as_ref(), "salvage_pile", x, z);
    ctx.db.building().insert(Building {
        id: building_id,
        owner,
        kind: "salvage_pile".into(),
        x,
        z,
        placement_yaw,
        placement_yaw_locked: true,
        work_radius: salvage_def.work_radius,
        tree_work_area_x: 0.0,
        tree_work_area_z: 0.0,
        tree_work_area_radius: 0.0,
        action_cooldown: 0.0,
        timber: stock.timber.max(0.0),
        firewood: stock.firewood.max(0.0),
        stone: stock.stone.max(0.0),
        water: stock.water.max(0.0),
        food: 0.0,
        ale: stock.ale.max(0.0),
        cider: stock.cider.max(0.0),
        pear_cider: stock.pear_cider.max(0.0),
        mead: stock.mead.max(0.0),
        preserved_food: stock.preserved_food.max(0.0),
        honey: stock.honey.max(0.0),
        wax: stock.wax.max(0.0),
        candles: stock.candles.max(0.0),
        wine: stock.wine.max(0.0),
        ironwork: stock.ironwork.max(0.0),
        polearms: stock.polearms.max(0.0),
        sidearms: stock.sidearms.max(0.0),
        shields: stock.shields.max(0.0),
        bows: stock.bows.max(0.0),
        crossbows: stock.crossbows.max(0.0),
        padded_armor: stock.padded_armor.max(0.0),
        mail_armor: stock.mail_armor.max(0.0),
        ammunition: stock.ammunition.max(0.0),
        water_capacity: 0.0,
        assigned_labor: 0,
        storehouse_accepts_timber: true,
        storehouse_accepts_stone: true,
        storehouse_accepts_firewood: true,
        storehouse_accepts_iron: true,
        storehouse_accepts_clay: true,
        storehouse_accepts_salt: true,
        storehouse_accepts_charcoal: true,
        gold: stock.gold.max(0.0),
        construction_complete: true,
        construction_progress: 1.0,
        construction_required_timber: 0.0,
        construction_required_stone: 0.0,
        construction_required_ironwork: 0.0,
        construction_delivered_timber: 0.0,
        construction_delivered_stone: 0.0,
        construction_delivered_ironwork: 0.0,
        construction_reserved_timber: 0.0,
        construction_reserved_stone: 0.0,
        construction_reserved_ironwork: 0.0,
        construction_treasury_timber: 0.0,
        construction_treasury_stone: 0.0,
        construction_treasury_ironwork: 0.0,
        construction_required_roof_tiles: 0.0,
        construction_delivered_roof_tiles: 0.0,
        construction_reserved_roof_tiles: 0.0,
        construction_treasury_roof_tiles: 0.0,
        granary_accepts_fresh_food: true,
        granary_households_first: false,
        construction_priority: CONSTRUCTION_PRIORITY_NORMAL,
        woodcutter_timber_reserve: 0.0,
        granary_grain_reserve: 0.0,
        harvest_reserve_percent: 0,
        wool: stock.wool.max(0.0),
        cloth: stock.cloth.max(0.0),
        carpenter_polearm_reserve: 0,
        marketplace_ironwork_target: 0,
        marketplace_specialty_export_policy: 0,
        granary_fresh_food_target_percent:
            crate::granary_policy::GRANARY_FRESH_FOOD_TARGET_DEFAULT_PERCENT,
        storehouse_timber_target_percent:
            crate::storehouse_policy::STOREHOUSE_STOCK_TARGET_DEFAULT_PERCENT,
        storehouse_stone_target_percent:
            crate::storehouse_policy::STOREHOUSE_STOCK_TARGET_DEFAULT_PERCENT,
        storehouse_firewood_target_percent:
            crate::storehouse_policy::STOREHOUSE_STOCK_TARGET_DEFAULT_PERCENT,
        storehouse_iron_target_percent:
            crate::storehouse_policy::STOREHOUSE_STOCK_TARGET_DEFAULT_PERCENT,
        storehouse_clay_target_percent:
            crate::storehouse_policy::STOREHOUSE_STOCK_TARGET_DEFAULT_PERCENT,
        storehouse_salt_target_percent:
            crate::storehouse_policy::STOREHOUSE_STOCK_TARGET_DEFAULT_PERCENT,
        storehouse_charcoal_target_percent: 25,
        processor_output_target_percent:
            crate::processor_output_policy::PROCESSOR_OUTPUT_TARGET_DEFAULT_PERCENT,
        production_rate_percent:
            crate::production_rate_policy::DEFAULT_PRODUCTION_RATE_PERCENT,
        production_maintenance_progress: 0.0,
        marketplace_seed_grain_target: 0,
        founding_shelter_active: false,
        marketplace_pending_trade_code: 0,
        marketplace_gold_reserve_target:
            crate::marketplace_procurement_policy::MARKETPLACE_GOLD_RESERVE_DEFAULT,
        chapel_monastery_tithe_due: 0.0,
        civic_receipts_gold: 0.0,
        private_export_proceeds_gold: 0.0,
        vineyard_fermenting_grapes: 0.0,
        vineyard_fermentation_progress: 0.0,
        apiary_harvest_policy: 1,
        apiary_colony_health: 1.0,
        apiary_last_winter_year: 0,
        apiary_forage_score: 0.75,
        marketplace_drink_export_policy: 255,
        marketplace_provision_export_policy: 255,
        marketplace_wares_export_policy: 255,
        barley: stock.barley.max(0.0),
        malt: stock.malt.max(0.0),
        flax: stock.flax.max(0.0),
        guardhouse_muster_watchtower_id: 0,
        weaver_input_policy: 0,
        iron: stock.iron.max(0.0),
        clay: stock.clay.max(0.0),
        salt: stock.salt.max(0.0),
        charcoal: stock.charcoal.max(0.0),
        pottery: stock.pottery.max(0.0),
        roof_tiles: stock.roof_tiles.max(0.0),
        manure: stock.manure.max(0.0),
        remedies: stock.remedies.max(0.0),
        marketplace_iron_target: 0,
        marketplace_salt_target: 0,
        pottery_dispatch_policy: 0,
        potter_firing_policy: 0,
        carpenter_cart_service_target_trips: 0,
        remote_work_camp_enabled: false,
        linked_worksite_id: 0,
        commute_efficiency: 1.0,
        chapel_tier: 0,
        meat: stock.meat.max(0.0),
        fish: stock.fish.max(0.0),
        berries: stock.berries.max(0.0),
        mushrooms: stock.mushrooms.max(0.0),
        milk: stock.milk.max(0.0),
        apples: stock.apples.max(0.0),
        cherries: stock.cherries.max(0.0),
        vegetables: stock.vegetables.max(0.0),
        eggs: stock.eggs.max(0.0),
        grapes: stock.grapes.max(0.0),
        cured_meat: stock.cured_meat.max(0.0),
        smoked_fish: stock.smoked_fish.max(0.0),
        cheese: stock.cheese.max(0.0),
        pears: stock.pears.max(0.0),
        aronia: stock.aronia.max(0.0),
        rosehips: stock.rosehips.max(0.0),
        cabbage: stock.cabbage.max(0.0),
        carrots: stock.carrots.max(0.0),
        beetroot: stock.beetroot.max(0.0),
        aronia_jam: stock.aronia_jam.max(0.0),
        rosehip_jam: stock.rosehip_jam.max(0.0),
        rye_sheaves: stock.rye_sheaves.max(0.0),
        oat_sheaves: stock.oat_sheaves.max(0.0),
        barley_sheaves: stock.barley_sheaves.max(0.0),
        maslin_sheaves: stock.maslin_sheaves.max(0.0),
        rye_grain: stock.rye_grain.max(0.0),
        oat_grain: stock.oat_grain.max(0.0),
        animal_feed: stock.animal_feed.max(0.0),
        maslin_grain: stock.maslin_grain.max(0.0),
        rye_flour: stock.rye_flour.max(0.0),
        maslin_flour: stock.maslin_flour.max(0.0),
        rye_bread: stock.rye_bread.max(0.0),
        maslin_bread: stock.maslin_bread.max(0.0),
        threshing_priority: crate::farm_work_policy::THRESHING_PRIORITY_DEFAULT,
        fire_repair_active: false,
        brewery_recipe_policy: crate::brewery_recipe_policy::BREWERY_RECIPE_ALE,
        monastery_orchard_planting: crate::monastery_estate_policy::MONASTERY_ORCHARD_APPLES,
        monastery_croft_planting: crate::monastery_estate_policy::MONASTERY_CROFT_VEGETABLES,
        monastery_extensions: 0,
        monastery_next_extension: 0,
        monastery_orchard_planted_year: 0,
        monastery_orchard_maturity:
            crate::monastery_estate_policy::MONASTERY_ORCHARD_MATURITY_MATURE,
        monastery_croft_choice_year: 0,
        monastery_service_funding: 1.0,
        monastery_last_service_day: 0,
        hides: stock.hides.max(0.0),
        leather: stock.leather.max(0.0),
        shoes: stock.shoes.max(0.0),
        storage_acceptance_mask: u64::MAX,
        settlement_id,
        storage_acceptance_mask_high: u64::MAX,
        apiary_wax_cycle_progress: 0,
        pelts: stock.pelts.max(0.0),
        yarn: stock.yarn.max(0.0),
        linen: stock.linen.max(0.0),
        milk_use_policy: crate::livestock_policy::MILK_USE_BALANCED,
        smokehouse_recipe_policy: crate::smokehouse_recipe_policy::SMOKEHOUSE_RECIPE_AUTO,
        apiary_accumulated_honey: 0.0,
    });
    ctx.db.world_config().id().update(WorldConfig {
        next_building_id: building_id
            .checked_add(1)
            .ok_or_else(|| "No building IDs remain available.".to_string())?,
        ..config
    });
    Ok(true)
}

/// Keep returned overflow beside its source. A nearby pile is reused so a
/// repeatedly full storehouse cannot create unbounded marker and row churn.
pub fn recover_stock_beside_building(
    ctx: &ReducerContext,
    anchor: &Building,
    stock: ReclamationStock,
) -> Result<bool, String> {
    let (x, z) = recovery_pile_position_beside_building(ctx, anchor.owner, anchor);
    recover_stock_at(ctx, anchor.owner, x, z, stock)
}

/// Leave stranded cart cargo at its authoritative position. Nearby recovered
/// stock is coalesced to keep the physical ledger readable and inexpensive.
pub fn recover_stock_at(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    x: f64,
    z: f64,
    stock: ReclamationStock,
) -> Result<bool, String> {
    let stock = stock.normalized();
    let physical_reclamation = ctx
        .db
        .player_resources()
        .owner()
        .find(&owner)
        .is_some_and(|resources| resources.physical_founding_site_enabled);
    if !physical_reclamation {
        return Ok(false);
    }
    if stock.is_empty() {
        return Ok(true);
    }

    const LOCAL_PILE_REUSE_DISTANCE: f64 = 4.5;
    if let Some(mut pile) = ctx
        .db
        .building()
        .owner()
        .filter(&owner)
        .filter(|building| {
            building.kind == "salvage_pile"
                && (building.x - x).powi(2) + (building.z - z).powi(2)
                    <= LOCAL_PILE_REUSE_DISTANCE.powi(2)
        })
        .min_by(|a, b| {
            let a_distance = (a.x - x).powi(2) + (a.z - z).powi(2);
            let b_distance = (b.x - x).powi(2) + (b.z - z).powi(2);
            a_distance
                .total_cmp(&b_distance)
                .then_with(|| a.id.cmp(&b.id))
        })
    {
        stock.add_to_building(&mut pile);
        ctx.db.building().id().update(pile);
        return Ok(true);
    }

    insert_reclamation_pile(ctx, owner, x, z, stock)
}

/// Physical-world saves may still receive a legacy ledger balance from an old
/// schema, an interrupted delivery return, or a sandbox grant. Convert that
/// balance into a visible recovery pile before any planner can spend it.
///
/// Existing piles are reused to avoid marker churn. Otherwise the pile appears
/// beside the active civic treasury seat (Town Hall when complete, otherwise
/// the founders' camp), with a completed building or residence as a migration
/// fallback.
pub fn materialize_physical_resource_ledger(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
) -> Result<bool, String> {
    materialize_physical_resource_stock_at(ctx, owner, ReclamationStock::default(), None)
}

/// Merge an explicit stock grant with any legacy ledger balance and place the
/// result in the owner's physical stores. Unlike `PlayerResources`, a
/// `ReclamationStock` can represent every commodity, including physical-only
/// goods such as manure, remedies, and prepared animal feed.
pub(crate) fn materialize_physical_resource_stock(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    additional_stock: ReclamationStock,
) -> Result<bool, String> {
    materialize_physical_resource_stock_at(ctx, owner, additional_stock, None)
}

/// Variant used by the founding bootstrap when a legacy save contains only
/// zoning rows and therefore has no completed structure to anchor its migrated
/// stock. The deterministic founding-site coordinate keeps those goods on-map
/// without inventing a second founder population or a free permanent store.
pub fn materialize_physical_resource_ledger_at(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    fallback_position: Option<(f64, f64)>,
) -> Result<bool, String> {
    materialize_physical_resource_stock_at(
        ctx,
        owner,
        ReclamationStock::default(),
        fallback_position,
    )
}

fn materialize_physical_resource_stock_at(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    additional_stock: ReclamationStock,
    fallback_position: Option<(f64, f64)>,
) -> Result<bool, String> {
    let Some(mut resources) = ctx.db.player_resources().owner().find(&owner) else {
        return Ok(false);
    };
    if !resources.physical_founding_site_enabled {
        return Ok(false);
    }

    let stock = ReclamationStock::from_resource_ledger(&resources).merged(additional_stock);
    if stock.is_empty() {
        return Ok(true);
    }

    if let Some(mut pile) = ctx
        .db
        .building()
        .owner()
        .filter(&owner)
        .filter(|building| building.kind == "salvage_pile")
        .min_by_key(|building| building.id)
    {
        stock.add_to_building(&mut pile);
        ctx.db.building().id().update(pile);
        materialize_physical_construction_reservations(ctx, owner);
        clear_resource_ledger(&mut resources);
        ctx.db.player_resources().owner().update(resources);
        return Ok(true);
    }

    let building_anchor = crate::economy::physical_treasury_seat(ctx, owner).or_else(|| {
        ctx.db
            .building()
            .owner()
            .filter(&owner)
            .filter(|building| building.construction_complete)
            .min_by_key(|building| building.id)
            .or_else(|| {
                ctx.db
                    .building()
                    .owner()
                    .filter(&owner)
                    .min_by_key(|building| building.id)
            })
    });
    let position = if let Some(anchor) = building_anchor {
        recovery_pile_position_beside_building(ctx, owner, &anchor)
    } else if let Some(residence) = ctx
        .db
        .residence()
        .owner()
        .filter(&owner)
        .min_by_key(|residence| residence.id)
    {
        (residence.x + 3.25, residence.z)
    } else if let Some(position) = fallback_position {
        position
    } else {
        return Ok(false);
    };

    if !insert_reclamation_pile(ctx, owner, position.0, position.1, stock)? {
        return Ok(false);
    }
    materialize_physical_construction_reservations(ctx, owner);
    clear_resource_ledger(&mut resources);
    ctx.db.player_resources().owner().update(resources);
    Ok(true)
}

/// Legacy worksites reserve some of their materials directly against the
/// compatibility row. Once that row becomes a visible pile, preserve the
/// overall reservation but make its entire balance eligible for physical cart
/// dispatch. Otherwise the old share would be neither haulable nor spendable,
/// while another project could incorrectly reserve the same pile stock.
pub fn materialize_physical_construction_reservations(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
) {
    if !ctx
        .db
        .player_resources()
        .owner()
        .find(&owner)
        .is_some_and(|resources| resources.physical_founding_site_enabled)
    {
        return;
    }
    let sites = ctx
        .db
        .building()
        .owner()
        .filter(&owner)
        .filter(|building| {
            !building.construction_complete
                && (building.construction_treasury_timber > EPSILON
                    || building.construction_treasury_stone > EPSILON
                    || building.construction_treasury_ironwork > EPSILON
                    || building.construction_treasury_roof_tiles > EPSILON)
        })
        .collect::<Vec<_>>();
    for mut site in sites {
        site.construction_treasury_timber = 0.0;
        site.construction_treasury_stone = 0.0;
        site.construction_treasury_ironwork = 0.0;
        site.construction_treasury_roof_tiles = 0.0;
        ctx.db.building().id().update(site);
    }
}

/// The player table is tiny, while a full building scan is only needed for an
/// owner who actually has a stray positive balance.
pub fn materialize_all_physical_resource_ledgers(ctx: &ReducerContext) {
    let owners = ctx
        .db
        .player_resources()
        .iter()
        .filter(|resources| {
            resources.physical_founding_site_enabled
                && !ReclamationStock::from_resource_ledger(resources).is_empty()
        })
        .map(|resources| resources.owner)
        .collect::<Vec<_>>();
    for owner in owners {
        if let Err(error) = materialize_physical_resource_ledger(ctx, owner) {
            log::warn!("Could not materialize physical resource ledger: {error}");
        }
    }
}

/// One free hauler at each reachable pile moves one cartload per economy step.
/// Construction has already had first claim on reclaimed timber and stone, so
/// permanent stores clear only what an active worksite did not reserve.
pub fn step_reclamation_piles(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    pile_ids: Vec<u64>,
) {
    let mut free_haulers_by_owner = HashMap::new();
    let mut destination_ids_by_owner = HashMap::new();
    for pile_id in pile_ids {
        let Some(mut pile) = ctx.db.building().id().find(&pile_id) else {
            continue;
        };
        if pile.kind != "salvage_pile" {
            continue;
        }
        if building_has_active_trip(ctx, pile.id) || building_has_inbound_supply_trip(ctx, pile.id)
        {
            continue;
        }
        if !has_portable_stock(&pile) {
            ctx.db.building().id().delete(pile.id);
            continue;
        }
        let free_haulers = *free_haulers_by_owner
            .entry(pile.owner)
            .or_insert_with(|| available_free_haulers(ctx, pile.owner));
        if free_haulers == 0 || labor_and_logistics_paused(ctx, tick, pile.owner, clock) {
            continue;
        }
        let Some(network) = tick.road_network(pile.owner) else {
            continue;
        };
        let destination_ids = destination_ids_by_owner
            .entry(pile.owner)
            .or_insert_with(|| tick.owner_building_ids(ctx, pile.owner));

        for commodity in RECOVERY_ORDER {
            let stock = building_commodity_stock(&pile, commodity);
            if stock <= EPSILON {
                continue;
            }
            let target = destination_ids
                .iter()
                .filter_map(|target_id| ctx.db.building().id().find(target_id))
                .filter_map(|target| {
                    if target.id == pile.id
                        || target.kind == "salvage_pile"
                        || !target.construction_complete
                        || tick.building_disabled_by_fire(ctx, target.id)
                        || building_has_inbound_supply_trip(ctx, target.id)
                        || !storage_accepts_commodity(&target, commodity)
                        || building_commodity_room(&target, commodity) <= EPSILON
                    {
                        return None;
                    }
                    let priority = reclamation_destination_priority(commodity, &target.kind)?;
                    let distance =
                        local_delivery_distance(&network, pile.x, pile.z, target.x, target.z)?;
                    (distance > EPSILON).then_some((target, priority, distance))
                })
                .min_by(|a, b| {
                    a.1.cmp(&b.1)
                        .then_with(|| a.2.total_cmp(&b.2))
                        .then_with(|| a.0.id.cmp(&b.0.id))
                })
                .map(|candidate| candidate.0);
            let Some(target) = target else {
                continue;
            };

            if try_start_free_building_supply_trip(
                ctx,
                tick,
                clock,
                network,
                &mut pile,
                &target,
                commodity,
                TIMBER_DELIVERY_SPEED_MPS,
                TIMBER_DELIVERY_UNLOAD_SEC,
                STOREHOUSE_HAUL_PER_WORKER,
                stock,
            ) {
                ctx.db.building().id().update(pile);
                if let Some(remaining) = free_haulers_by_owner.get_mut(&target.owner) {
                    *remaining = remaining.saturating_sub(1);
                }
                break;
            }
        }
    }
}

pub(crate) fn reclamation_destination_priority(commodity: CommodityKind, kind: &str) -> Option<u8> {
    match commodity {
        CommodityKind::Gold => match kind {
            "town_hall" => Some(0),
            "founders_camp" => Some(1),
            _ => None,
        },
        CommodityKind::Timber | CommodityKind::Stone => match kind {
            "village_storehouse" => Some(0),
            "founders_camp" => Some(1),
            "marketplace" => Some(2),
            _ => Some(3),
        },
        CommodityKind::Firewood => match kind {
            "village_storehouse" => Some(0),
            "founders_camp" => Some(1),
            "marketplace" | "woodcutters_lodge" => Some(2),
            _ => Some(3),
        },
        CommodityKind::AnimalFeed => match kind {
            "pastoral_farmstead" => Some(0),
            "swineherd" => Some(1),
            _ => None,
        },
        CommodityKind::RyeBread
        | CommodityKind::MaslinBread
        | CommodityKind::Meat
        | CommodityKind::Fish
        | CommodityKind::Berries
        | CommodityKind::Mushrooms
        | CommodityKind::Milk
        | CommodityKind::Apples
        | CommodityKind::Pears
        | CommodityKind::Aronia
        | CommodityKind::Rosehips
        | CommodityKind::Cherries
        | CommodityKind::Vegetables
        | CommodityKind::Cabbage
        | CommodityKind::Carrots
        | CommodityKind::Beetroot
        | CommodityKind::Eggs
        | CommodityKind::Grapes
        | CommodityKind::CuredMeat
        | CommodityKind::SmokedFish
        | CommodityKind::Cheese
        | CommodityKind::AroniaJam
        | CommodityKind::RosehipJam
        | CommodityKind::RyeSheaves
        | CommodityKind::OatSheaves
        | CommodityKind::BarleySheaves
        | CommodityKind::MaslinSheaves
        | CommodityKind::RyeGrain
        | CommodityKind::OatGrain
        | CommodityKind::MaslinGrain
        | CommodityKind::Barley
        | CommodityKind::RyeFlour
        | CommodityKind::MaslinFlour
        | CommodityKind::PreservedFood => match kind {
            "granary" => Some(0),
            "brewery" if commodity == CommodityKind::Barley => Some(0),
            "marketplace" => Some(1),
            "founders_camp" => Some(2),
            _ => Some(3),
        },
        CommodityKind::Malt => match kind {
            "brewery" => Some(0),
            "founders_camp" => Some(1),
            _ => Some(2),
        },
        CommodityKind::Ale
        | CommodityKind::Cider
        | CommodityKind::PearCider
        | CommodityKind::Mead => match kind {
            "tavern" => Some(0),
            "founders_camp" => Some(1),
            _ => Some(2),
        },
        CommodityKind::Honey | CommodityKind::Wine => match kind {
            "marketplace" => Some(0),
            "monastery" => Some(1),
            "founders_camp" => Some(2),
            _ => Some(3),
        },
        CommodityKind::Wax => match kind {
            "chandlery" => Some(0),
            "village_storehouse" | "trading_post" => Some(1),
            "founders_camp" => Some(2),
            _ => Some(3),
        },
        CommodityKind::Candles => match kind {
            "marketplace" => Some(0),
            "village_storehouse" | "trading_post" | "chandlery" => Some(1),
            "founders_camp" => Some(2),
            _ => Some(3),
        },
        CommodityKind::Ironwork => match kind {
            "carpenter" => Some(0),
            "marketplace" => Some(1),
            "founders_camp" => Some(2),
            _ => Some(3),
        },
        CommodityKind::Polearms => match kind {
            "guardhouse" => Some(0),
            "town_hall" | "weaponsmith_armorer" | "carpenter" => Some(1),
            "founders_camp" => Some(2),
            _ => Some(3),
        },
        CommodityKind::Sidearms
        | CommodityKind::Shields
        | CommodityKind::PaddedArmor
        | CommodityKind::MailArmor => match kind {
            "guardhouse" | "town_hall" => Some(0),
            "weaponsmith_armorer" | "village_storehouse" | "trading_post" => Some(1),
            "founders_camp" => Some(2),
            _ => Some(3),
        },
        CommodityKind::Bows | CommodityKind::Crossbows | CommodityKind::Ammunition => match kind {
            "guardhouse" | "town_hall" => Some(0),
            "bowyer_fletcher" | "village_storehouse" | "trading_post" => Some(1),
            "founders_camp" => Some(2),
            _ => Some(3),
        },
        CommodityKind::Wool => match kind {
            "spinning_retting_house" => Some(0),
            "pastoral_farmstead" | "village_storehouse" => Some(1),
            "founders_camp" => Some(2),
            _ => Some(3),
        },
        CommodityKind::Flax => match kind {
            "spinning_retting_house" => Some(0),
            "threshing_barn" | "granary" => Some(1),
            "founders_camp" => Some(2),
            _ => Some(3),
        },
        CommodityKind::Cloth => match kind {
            "marketplace" => Some(0),
            "weaver" => Some(1),
            "founders_camp" => Some(2),
            _ => Some(3),
        },
        CommodityKind::Pelts => match kind {
            "trading_post" => Some(0),
            "village_storehouse" | "hunters_hall" => Some(1),
            "founders_camp" => Some(2),
            _ => Some(3),
        },
        CommodityKind::Yarn | CommodityKind::Linen => match kind {
            "weaver" => Some(0),
            "village_storehouse" | "trading_post" => Some(1),
            "founders_camp" => Some(2),
            _ => Some(3),
        },
        CommodityKind::Hides => match kind {
            "tannery" => Some(0),
            "village_storehouse" | "marketplace" => Some(1),
            "founders_camp" => Some(2),
            _ => Some(3),
        },
        CommodityKind::Leather => match kind {
            "cobbler" => Some(0),
            "village_storehouse" | "marketplace" => Some(1),
            "founders_camp" => Some(2),
            _ => Some(3),
        },
        CommodityKind::Shoes => match kind {
            "marketplace" => Some(0),
            "village_storehouse" | "cobbler" => Some(1),
            "founders_camp" => Some(2),
            _ => Some(3),
        },
        CommodityKind::Iron => match kind {
            "smithy" => Some(0),
            "marketplace" => Some(1),
            "founders_camp" => Some(2),
            _ => Some(3),
        },
        CommodityKind::Clay => match kind {
            "potter_kiln" => Some(0),
            "founders_camp" => Some(1),
            _ => Some(3),
        },
        CommodityKind::Salt => match kind {
            "smokehouse" => Some(0),
            "marketplace" => Some(1),
            "founders_camp" => Some(2),
            _ => Some(3),
        },
        CommodityKind::Charcoal => match kind {
            "smithy" => Some(0),
            "charcoal_burner" => Some(1),
            "founders_camp" => Some(2),
            _ => Some(3),
        },
        CommodityKind::Pottery => match kind {
            "smokehouse" => Some(0),
            "marketplace" => Some(1),
            "potter_kiln" => Some(2),
            "founders_camp" => Some(3),
            _ => Some(4),
        },
        CommodityKind::Manure => match kind {
            "threshing_barn" => Some(0),
            _ => None,
        },
        CommodityKind::Remedies => match kind {
            "foragers_shed" => Some(0),
            _ => None,
        },
        CommodityKind::RoofTiles => match kind {
            "potter_kiln" => Some(0),
            "founders_camp" => Some(1),
            _ => None,
        },
        CommodityKind::Water => match kind {
            "well" => Some(0),
            "founders_camp" => Some(1),
            _ => Some(2),
        },
    }
}

fn has_portable_stock(building: &Building) -> bool {
    RECOVERY_ORDER
        .into_iter()
        .any(|commodity| whole_units(building_commodity_stock(building, commodity)) >= 1.0)
}

#[cfg(test)]
mod tests {
    use super::ReclamationStock;

    #[test]
    fn empty_reclamation_stock_ignores_numeric_dust() {
        assert!(ReclamationStock::default().is_empty());
        assert!(ReclamationStock {
            timber: 1e-8,
            stone: 0.0,
            ..ReclamationStock::default()
        }
        .is_empty());
        assert!(ReclamationStock {
            timber: 0.99,
            ..ReclamationStock::default()
        }
        .is_empty());
        assert!(!ReclamationStock {
            timber: 0.0,
            stone: 1.0,
            ..ReclamationStock::default()
        }
        .is_empty());
        assert!(!ReclamationStock {
            gold: 1.0,
            ..ReclamationStock::default()
        }
        .is_empty());
    }

    #[test]
    fn constructors_and_merges_keep_whole_units() {
        let recovered =
            ReclamationStock::from_commodity(crate::economy::CommodityKind::Timber, 3.9).merged(
                ReclamationStock {
                    timber: 2.8,
                    gold: 1.9,
                    ..ReclamationStock::default()
                },
            );
        assert_eq!(recovered.timber, 5.0);
        assert_eq!(recovered.gold, 1.0);
        assert_eq!(recovered.stone, 0.0);
    }
}
