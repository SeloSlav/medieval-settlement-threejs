use spacetimedb::ReducerContext;

use crate::balance_generated::{
    FRESH_FOOD_STORAGE_DEFAULT_BUILDING_FACTOR, FRESH_FOOD_STORAGE_GRANARY_FACTOR,
    FRESH_FOOD_STORAGE_MARKETPLACE_FACTOR, FRESH_FOOD_STORAGE_MONASTERY_FACTOR,
    FRESH_FOOD_STORAGE_SMOKEHOUSE_FACTOR, FRESH_FOOD_STORAGE_TREASURY_FACTOR, TICK_DT,
};
use crate::db::*;
use crate::season_policy::EnvironmentState;
use crate::tables::{Building, PlayerResources};

/// Fresh food decays everywhere it can be held. Preserved food, grain, flour,
/// honey, wine, and ale are deliberately excluded.
pub fn step_fresh_food_spoilage(ctx: &ReducerContext, environment: EnvironmentState) {
    let rate = environment.fresh_food_spoilage_fraction_per_second();
    if rate <= 0.0 {
        return;
    }

    for building in ctx.db.building().iter().collect::<Vec<Building>>() {
        if building.food <= 1e-9 {
            continue;
        }
        let storage_factor = match building.kind.as_str() {
            "granary" => FRESH_FOOD_STORAGE_GRANARY_FACTOR,
            "smokehouse" => FRESH_FOOD_STORAGE_SMOKEHOUSE_FACTOR,
            "monastery" => FRESH_FOOD_STORAGE_MONASTERY_FACTOR,
            "marketplace" => FRESH_FOOD_STORAGE_MARKETPLACE_FACTOR,
            _ => FRESH_FOOD_STORAGE_DEFAULT_BUILDING_FACTOR,
        };
        let spoiled = building.food * rate * storage_factor * TICK_DT;
        ctx.db.building().id().update(Building {
            food: (building.food - spoiled).max(0.0),
            ..building
        });
    }

    for resources in ctx
        .db
        .player_resources()
        .iter()
        .collect::<Vec<PlayerResources>>()
    {
        if resources.food <= 1e-9 {
            continue;
        }
        let spoiled = resources.food * rate * FRESH_FOOD_STORAGE_TREASURY_FACTOR * TICK_DT;
        ctx.db.player_resources().owner().update(PlayerResources {
            food: (resources.food - spoiled).max(0.0),
            ..resources
        });
    }
}
