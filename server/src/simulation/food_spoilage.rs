use spacetimedb::ReducerContext;

use crate::balance_generated::{
    FRESH_FOOD_STORAGE_CART_FACTOR, FRESH_FOOD_STORAGE_DEFAULT_BUILDING_FACTOR,
    FRESH_FOOD_STORAGE_GRANARY_FACTOR, FRESH_FOOD_STORAGE_MARKETPLACE_FACTOR,
    FRESH_FOOD_STORAGE_MONASTERY_FACTOR, FRESH_FOOD_STORAGE_SMOKEHOUSE_FACTOR,
    FRESH_FOOD_STORAGE_TREASURY_FACTOR, PRESERVED_FOOD_STORAGE_CART_FACTOR,
    PRESERVED_FOOD_STORAGE_DEFAULT_BUILDING_FACTOR, PRESERVED_FOOD_STORAGE_GRANARY_FACTOR,
    PRESERVED_FOOD_STORAGE_MARKETPLACE_FACTOR, PRESERVED_FOOD_STORAGE_MONASTERY_FACTOR,
    PRESERVED_FOOD_STORAGE_SMOKEHOUSE_FACTOR, PRESERVED_FOOD_STORAGE_TREASURY_FACTOR, TICK_DT,
};
use crate::db::*;
use crate::economy::{
    building_commodity_stock, building_fresh_food_stock, building_preserved_food_stock,
    withdraw_building_commodity, CommodityKind, FRESH_FOOD_COMMODITIES, PRESERVED_FOOD_COMMODITIES,
};
use crate::season_policy::EnvironmentState;
use crate::tables::{Building, DeliveryTrip, PlayerResources};

/// Fresh and cured food decay everywhere they can be held. Salted and smoked
/// provisions last far longer, but remain finite; cool, purpose-built stores
/// slow their quality loss. Grain, flour, honey, wine, and ale are deliberately
/// excluded.
pub fn step_fresh_food_spoilage(ctx: &ReducerContext, environment: EnvironmentState) {
    let fresh_rate = environment.fresh_food_spoilage_fraction_per_second();
    let preserved_rate = environment.preserved_food_spoilage_fraction_per_second();
    if fresh_rate <= 0.0 && preserved_rate <= 0.0 {
        return;
    }

    for mut building in ctx.db.building().iter().collect::<Vec<Building>>() {
        if building_fresh_food_stock(&building) <= 1e-9
            && building_preserved_food_stock(&building) <= 1e-9
        {
            continue;
        }
        let fresh_storage_factor = match building.kind.as_str() {
            "granary" => FRESH_FOOD_STORAGE_GRANARY_FACTOR,
            "smokehouse" => FRESH_FOOD_STORAGE_SMOKEHOUSE_FACTOR,
            "monastery" => FRESH_FOOD_STORAGE_MONASTERY_FACTOR,
            "marketplace" => FRESH_FOOD_STORAGE_MARKETPLACE_FACTOR,
            "trading_post" => FRESH_FOOD_STORAGE_MARKETPLACE_FACTOR,
            _ => FRESH_FOOD_STORAGE_DEFAULT_BUILDING_FACTOR,
        };
        let preserved_storage_factor = match building.kind.as_str() {
            "granary" => PRESERVED_FOOD_STORAGE_GRANARY_FACTOR,
            "smokehouse" => PRESERVED_FOOD_STORAGE_SMOKEHOUSE_FACTOR,
            "monastery" => PRESERVED_FOOD_STORAGE_MONASTERY_FACTOR,
            "marketplace" => PRESERVED_FOOD_STORAGE_MARKETPLACE_FACTOR,
            "trading_post" => PRESERVED_FOOD_STORAGE_MARKETPLACE_FACTOR,
            _ => PRESERVED_FOOD_STORAGE_DEFAULT_BUILDING_FACTOR,
        };
        for commodity in FRESH_FOOD_COMMODITIES {
            let spoiled = building_commodity_stock(&building, commodity)
                * fresh_rate
                * fresh_storage_factor
                * TICK_DT;
            withdraw_building_commodity(&mut building, commodity, spoiled);
        }
        for commodity in PRESERVED_FOOD_COMMODITIES {
            let spoiled = building_commodity_stock(&building, commodity)
                * preserved_rate
                * preserved_storage_factor
                * TICK_DT;
            withdraw_building_commodity(&mut building, commodity, spoiled);
        }
        ctx.db.building().id().update(building);
    }

    // A loaded handcart is a physical store, not a pause button for decay.
    // Exposed loads spoil slightly faster than goods under an ordinary roof,
    // so compact routes and passable seasonal roads retain more of each batch.
    for trip in ctx
        .db
        .delivery_trip()
        .iter()
        .filter(|trip| {
            CommodityKind::from_u8(trip.cargo_kind)
                .is_some_and(|kind| kind.is_fresh_food() || kind.is_preserved_food())
                && trip.amount > 1e-9
        })
        .collect::<Vec<DeliveryTrip>>()
    {
        let (rate, storage_factor) = if CommodityKind::from_u8(trip.cargo_kind)
            .is_some_and(CommodityKind::is_preserved_food)
        {
            (preserved_rate, PRESERVED_FOOD_STORAGE_CART_FACTOR)
        } else {
            (fresh_rate, FRESH_FOOD_STORAGE_CART_FACTOR)
        };
        let spoiled = trip.amount * rate * storage_factor * TICK_DT;
        ctx.db.delivery_trip().id().update(DeliveryTrip {
            amount: (trip.amount - spoiled).max(0.0),
            ..trip
        });
    }

    for mut resources in ctx
        .db
        .player_resources()
        .iter()
        .collect::<Vec<PlayerResources>>()
    {
        macro_rules! spoil_fresh {
            ($field:ident) => {
                resources.$field = (resources.$field
                    - resources.$field * fresh_rate * FRESH_FOOD_STORAGE_TREASURY_FACTOR * TICK_DT)
                    .max(0.0);
            };
        }
        macro_rules! spoil_preserved {
            ($field:ident) => {
                resources.$field = (resources.$field
                    - resources.$field
                        * preserved_rate
                        * PRESERVED_FOOD_STORAGE_TREASURY_FACTOR
                        * TICK_DT)
                    .max(0.0);
            };
        }
        spoil_fresh!(food);
        spoil_fresh!(bread);
        spoil_fresh!(meat);
        spoil_fresh!(fish);
        spoil_fresh!(berries);
        spoil_fresh!(mushrooms);
        spoil_fresh!(milk);
        spoil_fresh!(apples);
        spoil_fresh!(cherries);
        spoil_fresh!(vegetables);
        spoil_fresh!(eggs);
        spoil_fresh!(grapes);
        spoil_fresh!(porridge);
        spoil_preserved!(preserved_food);
        spoil_preserved!(cured_meat);
        spoil_preserved!(smoked_fish);
        spoil_preserved!(cheese);
        ctx.db.player_resources().owner().update(resources);
    }
}
