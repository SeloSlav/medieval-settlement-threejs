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
use crate::economy::CommodityKind;
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

    for building in ctx.db.building().iter().collect::<Vec<Building>>() {
        if building.food <= 1e-9 && building.preserved_food <= 1e-9 {
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
        let spoiled_fresh = building.food * fresh_rate * fresh_storage_factor * TICK_DT;
        let spoiled_preserved =
            building.preserved_food * preserved_rate * preserved_storage_factor * TICK_DT;
        ctx.db.building().id().update(Building {
            food: (building.food - spoiled_fresh).max(0.0),
            preserved_food: (building.preserved_food - spoiled_preserved).max(0.0),
            ..building
        });
    }

    // A loaded handcart is a physical store, not a pause button for decay.
    // Exposed loads spoil slightly faster than goods under an ordinary roof,
    // so compact routes and passable seasonal roads retain more of each batch.
    for trip in ctx
        .db
        .delivery_trip()
        .iter()
        .filter(|trip| {
            matches!(
                CommodityKind::from_u8(trip.cargo_kind),
                Some(CommodityKind::Food | CommodityKind::PreservedFood)
            ) && trip.amount > 1e-9
        })
        .collect::<Vec<DeliveryTrip>>()
    {
        let (rate, storage_factor) = if trip.cargo_kind == CommodityKind::PreservedFood.as_u8() {
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

    for resources in ctx
        .db
        .player_resources()
        .iter()
        .collect::<Vec<PlayerResources>>()
    {
        if resources.food <= 1e-9 && resources.preserved_food <= 1e-9 {
            continue;
        }
        let spoiled_fresh =
            resources.food * fresh_rate * FRESH_FOOD_STORAGE_TREASURY_FACTOR * TICK_DT;
        let spoiled_preserved = resources.preserved_food
            * preserved_rate
            * PRESERVED_FOOD_STORAGE_TREASURY_FACTOR
            * TICK_DT;
        ctx.db.player_resources().owner().update(PlayerResources {
            food: (resources.food - spoiled_fresh).max(0.0),
            preserved_food: (resources.preserved_food - spoiled_preserved).max(0.0),
            ..resources
        });
    }
}
