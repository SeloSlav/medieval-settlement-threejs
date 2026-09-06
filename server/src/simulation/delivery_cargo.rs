//! Delivery cargo withdraw/deposit — one path for all residence need kinds.

use spacetimedb::ReducerContext;

use crate::balance_generated::CHARCOAL_HOUSEHOLD_FUEL_VALUE;
use crate::economy::{
    building_commodity_stock, building_edible_food_stock, building_savory_preserves_stock,
    food_category, food_commodity_advances_residence_progression, residence_food_category_mask,
    residence_fresh_food_stock, residence_savory_preserves_stock, withdraw_building,
    withdraw_building_commodity, withdraw_building_water, CommodityKind,
};
use crate::resource_units::whole_units;
use crate::simulation::residence_needs::{firewood, food, provisions, water};
use crate::simulation::residence_needs::{load_needs, need_stock, ResidenceNeedKind};
use crate::tables::Building;

#[derive(Clone, Copy, Debug, Default)]
pub struct DeliveryCargoTotals {
    pub timber: f64,
    pub firewood: f64,
    pub water: f64,
    pub ale: f64,
    pub cider: f64,
    pub mead: f64,
    pub honey: f64,
    pub wax: f64,
    pub candles: f64,
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
    pub dressed_stone: f64,
    pub meat: f64,
    pub fish: f64,
    pub berries: f64,
    pub mushrooms: f64,
    pub milk: f64,
    pub apples: f64,
    pub cherries: f64,
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
    pub jam: f64,
    pub animal_feed: f64,
}

impl DeliveryCargoTotals {
    pub fn add_commodity(&mut self, kind: CommodityKind, amount: f64) {
        let amount = whole_units(amount);
        if amount < 1.0 {
            return;
        }
        match kind {
            CommodityKind::Timber => self.timber += amount,
            CommodityKind::Firewood => self.firewood += amount,
            CommodityKind::Water => self.water += amount,
            CommodityKind::Ale => self.ale += amount,
            CommodityKind::Cider => self.cider += amount,
            CommodityKind::Mead => self.mead += amount,
            CommodityKind::Honey => self.honey += amount,
            CommodityKind::Wax => self.wax += amount,
            CommodityKind::Candles => self.candles += amount,
            CommodityKind::Pelts => self.pelts += amount,
            CommodityKind::Yarn => self.yarn += amount,
            CommodityKind::Linen => self.linen += amount,
            CommodityKind::Sidearms => self.sidearms += amount,
            CommodityKind::Shields => self.shields += amount,
            CommodityKind::Bows => self.bows += amount,
            CommodityKind::Crossbows => self.crossbows += amount,
            CommodityKind::PaddedArmor => self.padded_armor += amount,
            CommodityKind::MailArmor => self.mail_armor += amount,
            CommodityKind::Ammunition => self.ammunition += amount,
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
            CommodityKind::DressedStone => self.dressed_stone += amount,
            CommodityKind::Meat => self.meat += amount,
            CommodityKind::Fish => self.fish += amount,
            CommodityKind::Berries => self.berries += amount,
            CommodityKind::Mushrooms => self.mushrooms += amount,
            CommodityKind::Milk => self.milk += amount,
            CommodityKind::Apples => self.apples += amount,
            CommodityKind::Cherries => self.cherries += amount,
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
            CommodityKind::Jam => self.jam += amount,
            CommodityKind::AnimalFeed => self.animal_feed += amount,
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
            building.ale + building.cider + building.mead
        }
        ResidenceNeedKind::SavoryPreserves => building_savory_preserves_stock(building),
        ResidenceNeedKind::Cloth => building.cloth,
        ResidenceNeedKind::Shoes => building.shoes,
        ResidenceNeedKind::Pottery => building.pottery,
        ResidenceNeedKind::Luxury => building.candles + building.wine + building.honey,
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
            let requested_equivalent = whole_units(amount);
            let charcoal_value = whole_units(CHARCOAL_HOUSEHOLD_FUEL_VALUE).max(1.0);
            let charcoal_withdrawn = withdraw_building_commodity(
                building,
                CommodityKind::Charcoal,
                (requested_equivalent / charcoal_value).floor(),
            );
            let charcoal_equivalent = charcoal_withdrawn * charcoal_value;
            let (_, firewood_withdrawn, _, updated) = withdraw_building(
                building,
                0.0,
                (requested_equivalent - charcoal_equivalent).max(0.0),
                0.0,
            );
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
        ResidenceNeedKind::SavoryPreserves => selected_food_delivery_commodity(building, kind)
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
            let candles_used =
                withdraw_building_commodity(building, CommodityKind::Candles, remaining);
            remaining = (remaining - candles_used).max(0.0);
            let wine_used = withdraw_building_commodity(building, CommodityKind::Wine, remaining);
            remaining = (remaining - wine_used).max(0.0);
            let honey_used = withdraw_building_commodity(building, CommodityKind::Honey, remaining);
            candles_used + wine_used + honey_used
        }
        ResidenceNeedKind::Church | ResidenceNeedKind::FoodVariety => 0.0,
    }
}

/// Withdraws the same aggregate cargo as `withdraw_delivery_cargo` while also
/// reporting the commodity that contributed the largest amount of need value.
/// This preserves existing mixed-refill behavior without losing UI provenance.
pub fn withdraw_delivery_cargo_with_source(
    building: &mut Building,
    kind: ResidenceNeedKind,
    amount: f64,
) -> (f64, Option<CommodityKind>) {
    const FIREWOOD_SOURCES: [CommodityKind; 2] = [CommodityKind::Charcoal, CommodityKind::Firewood];
    const WATER_SOURCES: [CommodityKind; 1] = [CommodityKind::Water];
    const FOOD_SOURCES: [CommodityKind; 0] = [];
    const BEVERAGE_SOURCES: [CommodityKind; 3] = [
        CommodityKind::Cider,
        CommodityKind::Ale,
        CommodityKind::Mead,
    ];
    const CLOTH_SOURCES: [CommodityKind; 1] = [CommodityKind::Cloth];
    const SHOES_SOURCES: [CommodityKind; 1] = [CommodityKind::Shoes];
    const POTTERY_SOURCES: [CommodityKind; 1] = [CommodityKind::Pottery];
    const LUXURY_SOURCES: [CommodityKind; 3] = [
        CommodityKind::Candles,
        CommodityKind::Wine,
        CommodityKind::Honey,
    ];

    let candidates: &[CommodityKind] = match kind {
        ResidenceNeedKind::Firewood => &FIREWOOD_SOURCES,
        ResidenceNeedKind::Water => &WATER_SOURCES,
        ResidenceNeedKind::Ale => &BEVERAGE_SOURCES,
        ResidenceNeedKind::Cloth => &CLOTH_SOURCES,
        ResidenceNeedKind::Shoes => &SHOES_SOURCES,
        ResidenceNeedKind::Pottery => &POTTERY_SOURCES,
        ResidenceNeedKind::Luxury => &LUXURY_SOURCES,
        ResidenceNeedKind::Food
        | ResidenceNeedKind::SavoryPreserves
        | ResidenceNeedKind::Church
        | ResidenceNeedKind::FoodVariety => &FOOD_SOURCES,
    };
    let before = building.clone();
    let delivered = withdraw_delivery_cargo(building, kind, amount);
    let mut primary = None;
    let mut primary_value = 0.0;
    for commodity in candidates {
        let withdrawn = (building_commodity_stock(&before, *commodity)
            - building_commodity_stock(building, *commodity))
        .max(0.0);
        let need_value = withdrawn * delivery_commodity_need_value(kind, *commodity);
        if need_value > primary_value + 1e-9 {
            primary = Some(*commodity);
            primary_value = need_value;
        }
    }
    (delivered, primary)
}

/// Maps an exact cart commodity back to the household need it fulfills. This
/// must be explicit because commodity ids overlap later residence-need ids.
pub fn residence_need_for_delivery_commodity(
    commodity: CommodityKind,
) -> Option<ResidenceNeedKind> {
    match commodity {
        CommodityKind::Firewood | CommodityKind::Charcoal => Some(ResidenceNeedKind::Firewood),
        CommodityKind::Water => Some(ResidenceNeedKind::Water),
        CommodityKind::Ale
        | CommodityKind::Cider
        | CommodityKind::Mead => Some(ResidenceNeedKind::Ale),
        CommodityKind::Cloth => Some(ResidenceNeedKind::Cloth),
        CommodityKind::Shoes => Some(ResidenceNeedKind::Shoes),
        CommodityKind::Pottery => Some(ResidenceNeedKind::Pottery),
        CommodityKind::Candles | CommodityKind::Wine => Some(ResidenceNeedKind::Luxury),
        _ => None,
    }
}

/// Select one physical provision for a cart. Fast-spoiling foods leave first;
/// durable stores remain the fallback. A cart carries one
/// traceable commodity even though every edible type satisfies the Food need.
pub fn selected_food_delivery_commodity(
    building: &Building,
    need_kind: ResidenceNeedKind,
) -> Option<CommodityKind> {
    const FRESH_ORDER: [CommodityKind; 20] = [
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
        CommodityKind::Eggs,
        CommodityKind::RyeBread,
        CommodityKind::MaslinBread,
        CommodityKind::OatGrain,
        CommodityKind::Honey,
        CommodityKind::Jam,
    ];
    const PRESERVED_ORDER: [CommodityKind; 3] = [
        CommodityKind::Cheese,
        CommodityKind::SmokedFish,
        CommodityKind::CuredMeat,
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
            PRESERVED_ORDER[0],
            PRESERVED_ORDER[1],
            PRESERVED_ORDER[2],
            FRESH_ORDER[18],
            FRESH_ORDER[19],
        ],
        ResidenceNeedKind::SavoryPreserves => &PRESERVED_ORDER,
        _ => return None,
    };
    candidates
        .iter()
        .copied()
        .find(|commodity| building_commodity_stock(building, *commodity) > 1e-6)
}

/// Select one physical commodity for a household cart. Keeping the commodity
/// identity on the trip prevents returned cider, charcoal, or wine from being
/// silently converted into the generic need it satisfies.
pub fn selected_need_delivery_commodity(
    building: &Building,
    need_kind: ResidenceNeedKind,
) -> Option<CommodityKind> {
    match need_kind {
        ResidenceNeedKind::Firewood => [CommodityKind::Firewood, CommodityKind::Charcoal]
            .into_iter()
            .find(|commodity| building_commodity_stock(building, *commodity) >= 1.0),
        ResidenceNeedKind::Water => (building.water >= 1.0).then_some(CommodityKind::Water),
        ResidenceNeedKind::Food | ResidenceNeedKind::SavoryPreserves => {
            selected_food_delivery_commodity(building, need_kind)
        }
        ResidenceNeedKind::Ale => [
            CommodityKind::Cider,
            CommodityKind::Ale,
            CommodityKind::Mead,
        ]
        .into_iter()
        .find(|commodity| building_commodity_stock(building, *commodity) >= 1.0),
        ResidenceNeedKind::Cloth => (building.cloth >= 1.0).then_some(CommodityKind::Cloth),
        ResidenceNeedKind::Shoes => (building.shoes >= 1.0).then_some(CommodityKind::Shoes),
        ResidenceNeedKind::Pottery => (building.pottery >= 1.0).then_some(CommodityKind::Pottery),
        // Honey remains an edible pantry commodity and therefore cannot encode
        // a distinct Luxury destination on the existing one-kind cart row.
        ResidenceNeedKind::Luxury => [CommodityKind::Candles, CommodityKind::Wine]
            .into_iter()
            .find(|commodity| building_commodity_stock(building, *commodity) >= 1.0),
        ResidenceNeedKind::Church | ResidenceNeedKind::FoodVariety => None,
    }
}

pub fn delivery_commodity_need_value(
    need_kind: ResidenceNeedKind,
    commodity: CommodityKind,
) -> f64 {
    match (need_kind, commodity) {
        (ResidenceNeedKind::Firewood, CommodityKind::Charcoal) => {
            whole_units(CHARCOAL_HOUSEHOLD_FUEL_VALUE).max(1.0)
        }
        _ => 1.0,
    }
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
    const ORDER: [CommodityKind; 23] = [
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
        CommodityKind::Eggs,
        CommodityKind::RyeBread,
        CommodityKind::MaslinBread,
        CommodityKind::OatGrain,
        CommodityKind::Jam,
        CommodityKind::Cheese,
        CommodityKind::SmokedFish,
        CommodityKind::CuredMeat,
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
    whole_units(match kind {
        ResidenceNeedKind::Firewood => (firewood::stock_capacity() - stock).max(0.0),
        ResidenceNeedKind::Water => (water::stock_capacity() - stock).max(0.0),
        ResidenceNeedKind::Food => (food::stock_capacity() - stock).max(0.0),
        ResidenceNeedKind::Ale
        | ResidenceNeedKind::SavoryPreserves
        | ResidenceNeedKind::Cloth
        | ResidenceNeedKind::Shoes
        | ResidenceNeedKind::Pottery
        | ResidenceNeedKind::Luxury => (provisions::stock_capacity(kind) - stock).max(0.0),
        ResidenceNeedKind::Church | ResidenceNeedKind::FoodVariety => 0.0,
    })
}

pub fn has_delivery_stock_room(kind: ResidenceNeedKind, stock: f64) -> bool {
    match kind {
        ResidenceNeedKind::Firewood => firewood::has_stock_room(stock),
        ResidenceNeedKind::Water => water::has_stock_room(stock),
        ResidenceNeedKind::Food => food::has_stock_room(stock),
        ResidenceNeedKind::Ale
        | ResidenceNeedKind::SavoryPreserves
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
        return whole_units(
            (provisions::stock_capacity(ResidenceNeedKind::SavoryPreserves)
                - residence_savory_preserves_stock(residence))
            .max(0.0)
                / commodity.meal_value().max(1e-9),
        );
    }
    if commodity.is_fresh_food() || commodity == CommodityKind::Honey {
        return whole_units(
            (food::stock_capacity() - residence_fresh_food_stock(residence)).max(0.0)
                / commodity.meal_value().max(1e-9),
        );
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
            |physical| {
                if physical.is_edible() {
                    residence_commodity_delivery_room(residence, physical)
                } else {
                    let stock = need_stock(&load_needs(ctx, residence.id), kind);
                    let need_room = delivery_stock_room(kind, stock);
                    let value = delivery_commodity_need_value(kind, physical);
                    whole_units(need_room / value)
                }
            },
        );
        if room <= 1e-6 {
            continue;
        }
        let batch = commodity.map_or(batch, |physical| {
            whole_units(batch / delivery_commodity_need_value(kind, physical))
        });
        let load = whole_units(available.min(room).min(batch));
        if load <= 1e-6 {
            continue;
        }
        return Some((residence.id, residence.x, residence.z, load));
    }
    None
}
