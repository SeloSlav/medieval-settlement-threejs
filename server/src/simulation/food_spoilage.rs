use std::collections::HashSet;

use spacetimedb::ReducerContext;

use crate::balance_generated::{
    CALENDAR_SECONDS_PER_DAY, FRESH_FOOD_STORAGE_CART_FACTOR,
    FRESH_FOOD_STORAGE_DEFAULT_BUILDING_FACTOR, FRESH_FOOD_STORAGE_GRANARY_FACTOR,
    FRESH_FOOD_STORAGE_MARKETPLACE_FACTOR, FRESH_FOOD_STORAGE_MONASTERY_FACTOR,
    FRESH_FOOD_STORAGE_SMOKEHOUSE_FACTOR, FRESH_FOOD_STORAGE_TREASURY_FACTOR,
    PRESERVED_FOOD_STORAGE_CART_FACTOR, PRESERVED_FOOD_STORAGE_DEFAULT_BUILDING_FACTOR,
    PRESERVED_FOOD_STORAGE_GRANARY_FACTOR, PRESERVED_FOOD_STORAGE_MARKETPLACE_FACTOR,
    PRESERVED_FOOD_STORAGE_MONASTERY_FACTOR, PRESERVED_FOOD_STORAGE_SMOKEHOUSE_FACTOR,
    PRESERVED_FOOD_STORAGE_TREASURY_FACTOR,
};
use crate::db::*;
use crate::economy::{
    building_commodity_stock, building_fresh_food_stock, building_preserved_food_stock,
    withdraw_building_commodity, CommodityKind, FRESH_FOOD_COMMODITIES, PRESERVED_FOOD_COMMODITIES,
};
use crate::residence_consumption_policy::daily_household_bill_due;
use crate::resident_welfare_policy::deterministic_unit;
use crate::resource_units::whole_units;
use crate::season_policy::EnvironmentState;
use crate::simulation::game_calendar::GameClock;
use crate::tables::{Building, DeliveryTrip, PlayerResources};

/// Fresh and cured food decay everywhere they can ordinarily be held. The
/// founding camp and cargo dispatched from it are a protected bootstrap
/// exception so weather cannot erase the player's starting path. Salted and
/// smoked provisions otherwise last far longer, but remain finite; cool,
/// purpose-built stores slow their quality loss. Grain, flour, honey, wine,
/// and ale are deliberately excluded.
pub fn step_fresh_food_spoilage(
    ctx: &ReducerContext,
    clock: &GameClock,
    environment: EnvironmentState,
    world_seed: u64,
    food_spoilage_rate: u8,
) {
    if food_spoilage_rate == 0 || !daily_household_bill_due(clock) {
        return;
    }

    let difficulty_multiplier = f64::from(food_spoilage_rate) / 100.0;
    let fresh_rate = environment.fresh_food_spoilage_fraction_per_second()
        * CALENDAR_SECONDS_PER_DAY
        * difficulty_multiplier;
    let preserved_rate = environment.preserved_food_spoilage_fraction_per_second()
        * CALENDAR_SECONDS_PER_DAY
        * difficulty_multiplier;

    let weather_immune_building_ids = ctx
        .db
        .building()
        .iter()
        .filter(|building| building.kind == "founders_camp")
        .map(|building| building.id)
        .collect::<HashSet<_>>();

    for mut building in ctx.db.building().iter().collect::<Vec<Building>>() {
        normalize_building_food(&mut building);
        if weather_immune_building_ids.contains(&building.id) {
            ctx.db.building().id().update(building);
            continue;
        }
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
            let spoiled = daily_spoilage_units(
                building_commodity_stock(&building, commodity),
                fresh_rate,
                fresh_storage_factor,
                commodity.spoilage_multiplier(),
                deterministic_unit(
                    world_seed,
                    clock.total_days,
                    building.id,
                    0x4255_494C_445F_4600 ^ u64::from(commodity.as_u8()),
                ),
            );
            withdraw_building_commodity(&mut building, commodity, spoiled);
        }
        for commodity in PRESERVED_FOOD_COMMODITIES {
            let spoiled = daily_spoilage_units(
                building_commodity_stock(&building, commodity),
                preserved_rate,
                preserved_storage_factor,
                commodity.spoilage_multiplier(),
                deterministic_unit(
                    world_seed,
                    clock.total_days,
                    building.id,
                    0x4255_494C_445F_5000 ^ u64::from(commodity.as_u8()),
                ),
            );
            withdraw_building_commodity(&mut building, commodity, spoiled);
        }
        ctx.db.building().id().update(building);
    }

    // A loaded handcart is a physical store, not a pause button for decay.
    // Exposed loads spoil slightly faster than goods under an ordinary roof,
    // so compact routes and passable seasonal roads retain more of each batch.
    for mut trip in ctx
        .db
        .delivery_trip()
        .iter()
        .filter(|trip| {
            CommodityKind::from_u8(trip.cargo_kind)
                .is_some_and(|kind| kind.is_fresh_food() || kind.is_preserved_food())
        })
        .collect::<Vec<DeliveryTrip>>()
    {
        trip.amount = whole_units(trip.amount);
        if weather_immune_building_ids.contains(&trip.building_id) || trip.amount <= 1e-9 {
            ctx.db.delivery_trip().id().update(trip);
            continue;
        }
        let (rate, storage_factor) = if CommodityKind::from_u8(trip.cargo_kind)
            .is_some_and(CommodityKind::is_preserved_food)
        {
            (preserved_rate, PRESERVED_FOOD_STORAGE_CART_FACTOR)
        } else {
            (fresh_rate, FRESH_FOOD_STORAGE_CART_FACTOR)
        };
        let commodity = CommodityKind::from_u8(trip.cargo_kind)
            .expect("food-spoilage trip filter guarantees a food commodity");
        let spoiled = daily_spoilage_units(
            trip.amount,
            rate,
            storage_factor,
            commodity.spoilage_multiplier(),
            deterministic_unit(
                world_seed,
                clock.total_days,
                trip.id,
                0x4341_5254_5F46_4F00 ^ u64::from(commodity.as_u8()),
            ),
        );
        ctx.db.delivery_trip().id().update(DeliveryTrip {
            amount: trip.amount - spoiled,
            ..trip
        });
    }

    for mut resources in ctx
        .db
        .player_resources()
        .iter()
        .collect::<Vec<PlayerResources>>()
    {
        let owner_hash = hash_identity(resources.owner);
        macro_rules! spoil_fresh {
            ($field:ident, $kind:expr) => {
                resources.$field = whole_units(resources.$field);
                resources.$field -= daily_spoilage_units(
                    resources.$field,
                    fresh_rate,
                    FRESH_FOOD_STORAGE_TREASURY_FACTOR,
                    $kind.spoilage_multiplier(),
                    deterministic_unit(
                        world_seed,
                        clock.total_days,
                        owner_hash,
                        0x5452_4541_535F_4600 ^ u64::from($kind.as_u8()),
                    ),
                );
            };
        }
        macro_rules! spoil_preserved {
            ($field:ident, $kind:expr) => {
                resources.$field = whole_units(resources.$field);
                resources.$field -= daily_spoilage_units(
                    resources.$field,
                    preserved_rate,
                    PRESERVED_FOOD_STORAGE_TREASURY_FACTOR,
                    $kind.spoilage_multiplier(),
                    deterministic_unit(
                        world_seed,
                        clock.total_days,
                        owner_hash,
                        0x5452_4541_535F_5000 ^ u64::from($kind.as_u8()),
                    ),
                );
            };
        }
        spoil_fresh!(oat_grain, CommodityKind::OatGrain);
        spoil_fresh!(rye_bread, CommodityKind::RyeBread);
        spoil_fresh!(maslin_bread, CommodityKind::MaslinBread);
        spoil_fresh!(meat, CommodityKind::Meat);
        spoil_fresh!(fish, CommodityKind::Fish);
        spoil_fresh!(berries, CommodityKind::Berries);
        spoil_fresh!(mushrooms, CommodityKind::Mushrooms);
        spoil_fresh!(milk, CommodityKind::Milk);
        spoil_fresh!(apples, CommodityKind::Apples);
        spoil_fresh!(cherries, CommodityKind::Cherries);
        spoil_fresh!(eggs, CommodityKind::Eggs);
        spoil_fresh!(grapes, CommodityKind::Grapes);
        spoil_fresh!(pears, CommodityKind::Pears);
        spoil_fresh!(aronia, CommodityKind::Aronia);
        spoil_fresh!(rosehips, CommodityKind::Rosehips);
        spoil_fresh!(cabbage, CommodityKind::Cabbage);
        spoil_fresh!(carrots, CommodityKind::Carrots);
        spoil_fresh!(beetroot, CommodityKind::Beetroot);
        spoil_preserved!(cured_meat, CommodityKind::CuredMeat);
        spoil_preserved!(smoked_fish, CommodityKind::SmokedFish);
        spoil_preserved!(cheese, CommodityKind::Cheese);
        spoil_preserved!(aronia_jam, CommodityKind::AroniaJam);
        spoil_preserved!(rosehip_jam, CommodityKind::RosehipJam);
        ctx.db.player_resources().owner().update(resources);
    }
}

fn daily_spoilage_units(
    stock: f64,
    daily_rate: f64,
    storage_factor: f64,
    commodity_multiplier: f64,
    roll: f64,
) -> f64 {
    let stock = whole_units(stock);
    let expected =
        stock * daily_rate.max(0.0) * storage_factor.max(0.0) * commodity_multiplier.max(0.0);
    if !expected.is_finite() || expected <= 0.0 {
        return 0.0;
    }
    let base = expected.floor();
    whole_units(base + f64::from(roll < expected - base)).min(stock)
}

fn normalize_building_food(building: &mut Building) {
    macro_rules! normalize {
        ($($field:ident),+ $(,)?) => {
            $(building.$field = whole_units(building.$field);)+
        };
    }
    normalize!(
        oat_grain,
        rye_bread,
        maslin_bread,
        meat,
        fish,
        berries,
        mushrooms,
        milk,
        apples,
        cherries,
        eggs,
        grapes,
        pears,
        aronia,
        rosehips,
        cabbage,
        carrots,
        beetroot,
        cured_meat,
        smoked_fish,
        cheese,
        aronia_jam,
        rosehip_jam,
    );
}

/// Convert the retired aggregate food column and cargo id into one concrete
/// staple. The compatibility columns remain in the replicated schema, but
/// they are emptied before any economy system can observe them as inventory.
pub fn retire_legacy_food_items(ctx: &ReducerContext) {
    for mut building in ctx
        .db
        .building()
        .iter()
        .filter(|building| building.food != 0.0 || !building.food.is_finite())
        .collect::<Vec<Building>>()
    {
        building.rye_bread = whole_units(building.rye_bread) + whole_units(building.food);
        building.food = 0.0;
        ctx.db.building().id().update(building);
    }
    for mut trip in ctx
        .db
        .delivery_trip()
        .iter()
        .filter(|trip| trip.cargo_kind == 2)
        .collect::<Vec<DeliveryTrip>>()
    {
        trip.cargo_kind = CommodityKind::RyeBread.as_u8();
        trip.amount = whole_units(trip.amount);
        ctx.db.delivery_trip().id().update(trip);
    }
    for mut resources in ctx
        .db
        .player_resources()
        .iter()
        .filter(|resources| resources.food != 0.0 || !resources.food.is_finite())
        .collect::<Vec<PlayerResources>>()
    {
        resources.rye_bread = whole_units(resources.rye_bread) + whole_units(resources.food);
        resources.food = 0.0;
        ctx.db.player_resources().owner().update(resources);
    }
}

fn hash_identity(owner: spacetimedb::Identity) -> u64 {
    let bytes = owner.to_byte_array();
    u64::from_le_bytes(bytes[0..8].try_into().unwrap_or([0; 8]))
}

#[cfg(test)]
mod tests {
    use super::daily_spoilage_units;

    #[test]
    fn spoilage_posts_only_whole_units() {
        assert_eq!(daily_spoilage_units(10.0, 0.025, 1.0, 1.0, 0.24), 1.0);
        assert_eq!(daily_spoilage_units(10.0, 0.025, 1.0, 1.0, 0.25), 0.0);
        assert_eq!(daily_spoilage_units(2.8, 2.0, 1.0, 1.0, 0.0), 2.0);
    }
}
