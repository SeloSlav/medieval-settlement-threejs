//! Building costs, salvage, storage, population, and aggregate spending.

mod aggregate_spend;
mod chapel_coffer;
mod marketplace_trade;
mod marketplace_trade_policy;
mod garden_market_activity;
mod household_wealth;
mod population;
mod storage;
mod parish_accounting;
mod village_economy;

pub use marketplace_trade::execute_marketplace_trade;
pub use aggregate_spend::{
    spend_aggregate_firewood, spend_aggregate_food, spend_aggregate_stone, spend_aggregate_timber,
};
pub use chapel_coffer::{
    chapel_coffer_capacity, chapel_coffer_gold, clear_coffer_in_place, collect_chapel_coffer,
    deposit_chapel_coffer, deposit_coffer_in_place, withdraw_chapel_coffer, withdraw_coffer_in_place,
};
pub use parish_accounting::{clamp_chapel_coffer_reserve_gold, record_parish_ledger, ParishLedgerKind};
pub use garden_market_activity::garden_market_activity;
pub use household_wealth::{credit_residence_wealth, debit_residence_wealth};
pub use population::{assign_building_labor, residence_population_for_parcel};
pub use storage::{
    building_food_storage_cap, building_storage_caps, building_water_storage_cap, credit_treasury_firewood,
    credit_treasury_food, credit_treasury_gold, credit_treasury_stone, credit_treasury_timber, credit_treasury_water,
    deposit_building, deposit_building_food, deposit_building_water, residence_firewood_capacity, residence_food_capacity,
    residence_water_capacity, spend_treasury_gold, total_firewood, total_food, total_stone, total_timber,
    withdraw_building, withdraw_building_food, withdraw_building_water,
};
pub use village_economy::{
    clamp_economic_activity_tax_rate, economic_activity_productivity_multiplier,
    player_economic_activity_tax_rate, taxed_economic_activity,
};

pub use crate::balance_generated::{
    RESIDENCE_STONE_COST, RESIDENCE_TIMBER_COST, STARTING_GOLD, STARTING_STONE,
    STARTING_TIMBER, STONE_SALVAGE_FRACTION, TIMBER_SALVAGE_FRACTION,
};

pub struct ResourceAmount {
    pub timber: f64,
    pub stone: f64,
}

pub fn building_cost(kind: &str) -> Result<ResourceAmount, String> {
    let def = crate::building_defs::building_def_or_err(kind)?;
    Ok(ResourceAmount {
        timber: def.cost_timber,
        stone: def.cost_stone,
    })
}

pub fn building_salvage_refund(kind: &str) -> Result<ResourceAmount, String> {
    let cost = building_cost(kind)?;
    Ok(ResourceAmount {
        timber: (cost.timber * TIMBER_SALVAGE_FRACTION).round(),
        stone: (cost.stone * STONE_SALVAGE_FRACTION).round(),
    })
}

pub fn backyard_garden_cost(kind: crate::balance_generated::BackyardGardenKind) -> ResourceAmount {
    let def = crate::balance_generated::backyard_garden_def(kind);
    ResourceAmount {
        timber: def.cost_timber,
        stone: def.cost_stone,
    }
}

pub fn backyard_garden_salvage_refund(kind: crate::balance_generated::BackyardGardenKind) -> ResourceAmount {
    let cost = backyard_garden_cost(kind);
    ResourceAmount {
        timber: (cost.timber * TIMBER_SALVAGE_FRACTION).round(),
        stone: (cost.stone * STONE_SALVAGE_FRACTION).round(),
    }
}

pub fn residence_zone_cost(residence_count: u32) -> ResourceAmount {
    ResourceAmount {
        timber: RESIDENCE_TIMBER_COST * residence_count as f64,
        stone: RESIDENCE_STONE_COST * residence_count as f64,
    }
}
