//! Delivery cargo withdraw/deposit — one path for all residence need kinds.

use spacetimedb::ReducerContext;

use crate::balance_generated::CHARCOAL_HOUSEHOLD_FUEL_VALUE;
use crate::economy::{
    building_commodity_stock, building_edible_food_stock, building_preserved_food_stock,
    food_category, food_commodity_advances_residence_progression, residence_food_category_mask,
    residence_fresh_food_stock, residence_preserved_food_stock, withdraw_building,
    withdraw_building_commodity, withdraw_building_water, CommodityKind,
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
    pub ale: f64,
    pub cider: f64,
    pub pear_cider: f64,
    pub mead: f64,
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
    pub maslin_grain: f64,
    pub rye_flour: f64,
    pub maslin_flour: f64,
    pub rye_bread: f64,
    pub maslin_bread: f64,
    pub hides: f64,
    pub leather: f64,
    pub shoes: f64,
    pub pears: f64,
    pub aronia: f64,
    pub rosehips: f64,
    pub cabbage: f64,
    pub carrots: f64,
    pub beetroot: f64,
    pub aronia_jam: f64,
    pub rosehip_jam: f64,
}

impl DeliveryCargoTotals {
    pub fn add_commodity(&mut self, kind: CommodityKind, amount: f64) {
        match kind {
            CommodityKind::Timber => self.timber += amount,
            CommodityKind::Firewood => self.firewood += amount,
            CommodityKind::Water => self.water += amount,
            CommodityKind::Food => self.food += amount,
            CommodityKind::Ale => self.ale += amount,
            CommodityKind::Cider => self.cider += amount,
            CommodityKind::PearCider => self.pear_cider += amount,
            CommodityKind::Mead => self.mead += amount,
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
            CommodityKind::Remedies => self.remedies += amount,
            CommodityKind::RoofTiles => self.roof_tiles += amount,
            CommodityKind::Meat => self.meat += amount,
            CommodityKind::Fish => self.fish += amount,
            CommodityKind::Berries => self.berries += amount,
            CommodityKind::Mushrooms => self.mushrooms += amount,
            CommodityKind::Milk => self.milk += amount,
            CommodityKind::Apples => self.apples += amount,
            CommodityKind::Cherries => self.cherries += amount,
            CommodityKind::Vegetables => self.vegetables += amount,
            CommodityKind::Eggs => self.eggs += amount,
            CommodityKind::Grapes => self.grapes += amount,
            CommodityKind::CuredMeat => self.cured_meat += amount,
            CommodityKind::SmokedFish => self.smoked_fish += amount,
            CommodityKind::Cheese => self.cheese += amount,
            CommodityKind::RyeSheaves => self.rye_sheaves += amount,
            CommodityKind::OatSheaves => self.oat_sheaves += amount,
            CommodityKind::BarleySheaves => self.barley_sheaves += amount,
            CommodityKind::MaslinSheaves => self.maslin_sheaves += amount,
            CommodityKind::RyeGrain => self.rye_grain += amount,
            CommodityKind::OatGrain => self.oat_grain += amount,
            CommodityKind::MaslinGrain => self.maslin_grain += amount,
            CommodityKind::RyeFlour => self.rye_flour += amount,
            CommodityKind::MaslinFlour => self.maslin_flour += amount,
            CommodityKind::RyeBread => self.rye_bread += amount,
            CommodityKind::MaslinBread => self.maslin_bread += amount,
            CommodityKind::Hides => self.hides += amount,
            CommodityKind::Leather => self.leather += amount,
            CommodityKind::Shoes => self.shoes += amount,
            CommodityKind::Pears => self.pears += amount,
            CommodityKind::Aronia => self.aronia += amount,
            CommodityKind::Rosehips => self.rosehips += amount,
            CommodityKind::Cabbage => self.cabbage += amount,
            CommodityKind::Carrots => self.carrots += amount,
            CommodityKind::Beetroot => self.beetroot += amount,
            CommodityKind::AroniaJam => self.aronia_jam += amount,
            CommodityKind::RosehipJam => self.rosehip_jam += amount,
        }
    }
}

pub fn building_delivery_stock(building: &Building, kind: ResidenceNeedKind) -> f64 {
    match kind {
        ResidenceNeedKind::Firewood => {
            building.firewood + building.charcoal * CHARCOAL_HOUSEHOLD_FUEL_VALUE
        }
        ResidenceNeedKind::Water => building.water,
        ResidenceNeedKind::Food => building_edible_food_stock(building),
        ResidenceNeedKind::Ale => {
            building.ale + building.cider + building.pear_cider + building.mead
        }
        ResidenceNeedKind::PreservedFood => building_preserved_food_stock(building),
        ResidenceNeedKind::Cloth => building.cloth,
        ResidenceNeedKind::Shoes => building.shoes,
        ResidenceNeedKind::Pottery => building.pottery,
        ResidenceNeedKind::Luxury => building.wine + building.honey,
        ResidenceNeedKind::Church | ResidenceNeedKind::FoodVariety => 0.0,
    }
}

pub fn withdraw_delivery_cargo(
    building: &mut Building,
    kind: ResidenceNeedKind,
    amount: f64,
) -> f64 {
    match kind {
        ResidenceNeedKind::Firewood => {
            let charcoal_withdrawn = withdraw_building_commodity(
                building,
                CommodityKind::Charcoal,
                amount.max(0.0) / CHARCOAL_HOUSEHOLD_FUEL_VALUE.max(1e-9),
            );
            let charcoal_equivalent = charcoal_withdrawn * CHARCOAL_HOUSEHOLD_FUEL_VALUE;
            let (_, firewood_withdrawn, _, updated) =
                withdraw_building(building, 0.0, (amount - charcoal_equivalent).max(0.0), 0.0);
            *building = updated;
            charcoal_equivalent + firewood_withdrawn
        }
        ResidenceNeedKind::Water => {
            let (withdrawn, updated) = withdraw_building_water(building, amount);
            *building = updated;
            withdrawn
        }
        ResidenceNeedKind::Food => selected_food_delivery_commodity(building, kind)
            .map(|commodity| withdraw_building_commodity(building, commodity, amount))
            .unwrap_or(0.0),
        ResidenceNeedKind::Ale => {
            let mut remaining = amount.max(0.0);
            let mut withdrawn = 0.0;
            for beverage in [
                CommodityKind::Cider,
                CommodityKind::PearCider,
                CommodityKind::Ale,
                CommodityKind::Mead,
            ] {
                let used = withdraw_building_commodity(building, beverage, remaining);
                withdrawn += used;
                remaining = (remaining - used).max(0.0);
                if remaining <= 1e-9 {
                    break;
                }
            }
            withdrawn
        }
        ResidenceNeedKind::PreservedFood => selected_food_delivery_commodity(building, kind)
            .map(|commodity| withdraw_building_commodity(building, commodity, amount))
            .unwrap_or(0.0),
        ResidenceNeedKind::Cloth => {
            withdraw_building_commodity(building, CommodityKind::Cloth, amount)
        }
        ResidenceNeedKind::Shoes => {
            withdraw_building_commodity(building, CommodityKind::Shoes, amount)
        }
        ResidenceNeedKind::Pottery => {
            withdraw_building_commodity(building, CommodityKind::Pottery, amount)
        }
        ResidenceNeedKind::Luxury => {
            let mut remaining = amount.max(0.0);
            let wine_used = withdraw_building_commodity(building, CommodityKind::Wine, remaining);
            remaining = (remaining - wine_used).max(0.0);
            let honey_used = withdraw_building_commodity(building, CommodityKind::Honey, remaining);
            wine_used + honey_used
        }
        ResidenceNeedKind::Church | ResidenceNeedKind::FoodVariety => 0.0,
    }
}

/// Select one physical provision for a cart. Fast-spoiling foods leave first;
/// durable and legacy mixed stores remain the fallback. A cart carries one
/// traceable commodity even though every edible type satisfies the Food need.
pub fn selected_food_delivery_commodity(
    building: &Building,
    need_kind: ResidenceNeedKind,
) -> Option<CommodityKind> {
    const FRESH_ORDER: [CommodityKind; 21] = [
        CommodityKind::Meat,
        CommodityKind::Fish,
        CommodityKind::Milk,
        CommodityKind::Aronia,
        CommodityKind::Rosehips,
        CommodityKind::Mushrooms,
        CommodityKind::Berries,
        CommodityKind::Grapes,
        CommodityKind::Cherries,
        CommodityKind::Apples,
        CommodityKind::Pears,
        CommodityKind::Cabbage,
        CommodityKind::Carrots,
        CommodityKind::Beetroot,
        CommodityKind::Vegetables,
        CommodityKind::Eggs,
        CommodityKind::RyeBread,
        CommodityKind::MaslinBread,
        CommodityKind::OatGrain,
        CommodityKind::Food,
        CommodityKind::Honey,
    ];
    const PRESERVED_ORDER: [CommodityKind; 6] = [
        CommodityKind::AroniaJam,
        CommodityKind::RosehipJam,
        CommodityKind::Cheese,
        CommodityKind::SmokedFish,
        CommodityKind::CuredMeat,
        CommodityKind::PreservedFood,
    ];

    let candidates: &[CommodityKind] = match need_kind {
        ResidenceNeedKind::Food => &[
            FRESH_ORDER[0],
            FRESH_ORDER[1],
            FRESH_ORDER[2],
            FRESH_ORDER[3],
            FRESH_ORDER[4],
            FRESH_ORDER[5],
            FRESH_ORDER[6],
            FRESH_ORDER[7],
            FRESH_ORDER[8],
            FRESH_ORDER[9],
            FRESH_ORDER[10],
            FRESH_ORDER[11],
            FRESH_ORDER[12],
            FRESH_ORDER[13],
            FRESH_ORDER[14],
            FRESH_ORDER[15],
            FRESH_ORDER[16],
            FRESH_ORDER[17],
            FRESH_ORDER[18],
            PRESERVED_ORDER[0],
            PRESERVED_ORDER[1],
            PRESERVED_ORDER[2],
            PRESERVED_ORDER[3],
            PRESERVED_ORDER[4],
            PRESERVED_ORDER[5],
            FRESH_ORDER[19],
            FRESH_ORDER[20],
        ],
        ResidenceNeedKind::PreservedFood => &PRESERVED_ORDER,
        _ => return None,
    };
    candidates
        .iter()
        .copied()
        .find(|commodity| building_commodity_stock(building, *commodity) > 1e-6)
}

/// Prefer a food category that the destination pantry does not yet contain,
/// then fall back to the normal perishability order. This makes market variety
/// a physical allocation result instead of a global-stock checkbox.
pub fn selected_food_delivery_commodity_for_residence(
    building: &Building,
    residence: &crate::tables::Residence,
    need_kind: ResidenceNeedKind,
) -> Option<CommodityKind> {
    if need_kind != ResidenceNeedKind::Food {
        return selected_food_delivery_commodity(building, need_kind);
    }
    const ORDER: [CommodityKind; 27] = [
        CommodityKind::Meat,
        CommodityKind::Fish,
        CommodityKind::Milk,
        CommodityKind::Aronia,
        CommodityKind::Rosehips,
        CommodityKind::Mushrooms,
        CommodityKind::Berries,
        CommodityKind::Grapes,
        CommodityKind::Cherries,
        CommodityKind::Apples,
        CommodityKind::Pears,
        CommodityKind::Cabbage,
        CommodityKind::Carrots,
        CommodityKind::Beetroot,
        CommodityKind::Vegetables,
        CommodityKind::Eggs,
        CommodityKind::RyeBread,
        CommodityKind::MaslinBread,
        CommodityKind::OatGrain,
        CommodityKind::Food,
        CommodityKind::AroniaJam,
        CommodityKind::RosehipJam,
        CommodityKind::Cheese,
        CommodityKind::SmokedFish,
        CommodityKind::CuredMeat,
        CommodityKind::PreservedFood,
        CommodityKind::Honey,
    ];
    let present = residence_food_category_mask(residence);
    ORDER
        .into_iter()
        .find(|commodity| {
            building_commodity_stock(building, *commodity) > 1e-6
                && food_commodity_advances_residence_progression(
                    residence,
                    residence.tier,
                    *commodity,
                )
        })
        .or_else(|| {
            ORDER.into_iter().find(|commodity| {
                building_commodity_stock(building, *commodity) > 1e-6
                    && food_category(*commodity)
                        .is_some_and(|category| present & category.bit() == 0)
            })
        })
        .or_else(|| selected_food_delivery_commodity(building, need_kind))
}

pub fn delivery_stock_room(kind: ResidenceNeedKind, stock: f64) -> f64 {
    match kind {
        ResidenceNeedKind::Firewood => (firewood::stock_capacity() - stock).max(0.0),
        ResidenceNeedKind::Water => (water::stock_capacity() - stock).max(0.0),
        ResidenceNeedKind::Food => (food::stock_capacity() - stock).max(0.0),
        ResidenceNeedKind::Ale
        | ResidenceNeedKind::PreservedFood
        | ResidenceNeedKind::Cloth
        | ResidenceNeedKind::Shoes
        | ResidenceNeedKind::Pottery
        | ResidenceNeedKind::Luxury => (provisions::stock_capacity(kind) - stock).max(0.0),
        ResidenceNeedKind::Church | ResidenceNeedKind::FoodVariety => 0.0,
    }
}

pub fn has_delivery_stock_room(kind: ResidenceNeedKind, stock: f64) -> bool {
    match kind {
        ResidenceNeedKind::Firewood => firewood::has_stock_room(stock),
        ResidenceNeedKind::Water => water::has_stock_room(stock),
        ResidenceNeedKind::Food => food::has_stock_room(stock),
        ResidenceNeedKind::Ale
        | ResidenceNeedKind::PreservedFood
        | ResidenceNeedKind::Cloth
        | ResidenceNeedKind::Shoes
        | ResidenceNeedKind::Pottery
        | ResidenceNeedKind::Luxury => stock + 1e-6 < provisions::stock_capacity(kind),
        ResidenceNeedKind::Church | ResidenceNeedKind::FoodVariety => false,
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

pub fn residence_commodity_delivery_room(
    residence: &crate::tables::Residence,
    commodity: CommodityKind,
) -> f64 {
    if commodity.is_preserved_food() {
        return (provisions::stock_capacity(ResidenceNeedKind::PreservedFood)
            - residence_preserved_food_stock(residence))
        .max(0.0)
            / commodity.meal_value().max(1e-9);
    }
    if commodity.is_fresh_food() || commodity == CommodityKind::Honey {
        return (food::stock_capacity() - residence_fresh_food_stock(residence)).max(0.0)
            / commodity.meal_value().max(1e-9);
    }
    0.0
}

pub fn pick_delivery_target(
    ctx: &ReducerContext,
    available: f64,
    batch: f64,
    targets: &[crate::tables::Residence],
    kind: ResidenceNeedKind,
    commodity: Option<CommodityKind>,
    target_is_operational: impl Fn(u64) -> bool,
) -> Option<(u64, f64, f64, f64)> {
    for residence in targets {
        if !target_is_operational(residence.id) {
            continue;
        }
        let room = commodity.map_or_else(
            || {
                let stock = need_stock(&load_needs(ctx, residence.id), kind);
                if has_delivery_stock_room(kind, stock) {
                    delivery_stock_room(kind, stock)
                } else {
                    0.0
                }
            },
            |physical| residence_commodity_delivery_room(residence, physical),
        );
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
