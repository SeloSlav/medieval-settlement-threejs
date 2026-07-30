//! Building costs, salvage, storage, population, and aggregate spending.

mod aggregate_spend;
mod chapel_coffer;
mod civic_receipts;
mod commodities;
mod garden_market_activity;
mod household_wealth;
mod marketplace_orders;
mod marketplace_trade;
mod marketplace_trade_policy;
mod parish_accounting;
mod population;
mod population_policy;
mod regional_market;
mod regional_market_policy;
mod storage;
mod village_economy;

pub use commodities::{
    building_commodity_cap, building_commodity_room, building_commodity_stock,
    credit_treasury_commodity, deposit_building_commodity, withdraw_building_commodity,
    CommodityKind,
};
pub(crate) use marketplace_trade_policy::adriatic_trade_entry_point;

pub use aggregate_spend::{spend_aggregate_stone, spend_aggregate_timber};
pub use chapel_coffer::{
    chapel_coffer_gold, chapel_monastery_tithe_due, chapel_tithe_payment_room,
    collect_chapel_coffer, deposit_chapel_tithe, withdraw_coffer_in_place,
};
pub use civic_receipts::{
    credit_local_civic_receipts, local_civic_receipts, mark_local_civic_receipts_dispatched,
    restore_local_civic_receipts,
};
pub use garden_market_activity::garden_market_activity;
pub use household_wealth::{credit_residence_wealth, debit_residence_wealth};
pub use marketplace_orders::{
    best_affordable_food_commodity, best_affordable_water_commodity, order_food_commodity,
    order_water_commodity, MarketGoldPayer,
};
pub use marketplace_trade::execute_marketplace_trade;
pub(crate) use marketplace_trade::{
    credit_marketplace_receipt_gold, pending_marketplace_trade_commodity,
    settle_regional_market_export, try_advance_pending_marketplace_trade,
    try_execute_standing_marketplace_import,
};
pub(crate) use marketplace_trade_policy::{
    marketplace_proceeds_cart_load, regional_export_cart_load,
};
pub use parish_accounting::{
    clamp_chapel_coffer_reserve_gold, record_parish_ledger, ParishLedgerKind,
};
pub use population::{
    assign_building_labor, available_building_labor, guardhouse_roster_count,
    guardhouse_roster_floors, initial_construction_labor, reconcile_building_labor,
    residence_population_for_parcel,
};
pub(crate) use regional_market::record_specialty_market_export;
pub use regional_market::{ensure_market_state, scaled_gold_cost, step_regional_markets};
pub(crate) use storage::{
    available_unreserved_building_ironwork, available_unreserved_building_timber,
};
pub(crate) use storage::physical_treasury_seat;
pub use storage::{
    building_food_storage_cap, building_storage_caps, building_water_storage_cap,
    construction_treasury_reservation, construction_treasury_reservation_excluding_building,
    credit_treasury_firewood, credit_treasury_food, credit_treasury_gold, credit_treasury_stone,
    credit_treasury_timber, credit_treasury_water, deposit_building, deposit_building_food,
    deposit_building_water, residence_firewood_capacity, residence_food_capacity,
    residence_water_capacity, spend_treasury_gold, total_ironwork, total_stone, total_timber,
    treasury_gold, withdraw_building, withdraw_building_food, withdraw_building_water,
};
pub use village_economy::{
    clamp_economic_activity_tax_rate, player_economic_activity_tax_rate, taxed_economic_activity,
    town_hall_tax_collection_multiplier,
};

pub use crate::balance_generated::{
    RESIDENCE_STONE_COST, RESIDENCE_TIMBER_COST, STARTING_GOLD, STARTING_STONE, STARTING_TIMBER,
    IRONWORK_SALVAGE_FRACTION, STONE_SALVAGE_FRACTION, TIMBER_SALVAGE_FRACTION,
};

pub struct ResourceAmount {
    pub timber: f64,
    pub stone: f64,
    pub ironwork: f64,
}

pub fn building_cost(kind: &str) -> Result<ResourceAmount, String> {
    let def = crate::building_defs::building_def_or_err(kind)?;
    Ok(ResourceAmount {
        timber: def.cost_timber,
        stone: def.cost_stone,
        ironwork: def.cost_ironwork,
    })
}

pub fn building_salvage_refund(kind: &str) -> Result<ResourceAmount, String> {
    let cost = building_cost(kind)?;
    Ok(ResourceAmount {
        timber: (cost.timber * TIMBER_SALVAGE_FRACTION).round(),
        stone: (cost.stone * STONE_SALVAGE_FRACTION).round(),
        ironwork: (cost.ironwork * IRONWORK_SALVAGE_FRACTION).round(),
    })
}

pub fn backyard_garden_cost(kind: crate::balance_generated::BackyardGardenKind) -> ResourceAmount {
    let def = crate::balance_generated::backyard_garden_def(kind);
    ResourceAmount {
        timber: def.cost_timber,
        stone: def.cost_stone,
        ironwork: 0.0,
    }
}

pub fn backyard_garden_salvage_refund(
    kind: crate::balance_generated::BackyardGardenKind,
) -> ResourceAmount {
    let cost = backyard_garden_cost(kind);
    ResourceAmount {
        timber: (cost.timber * TIMBER_SALVAGE_FRACTION).round(),
        stone: (cost.stone * STONE_SALVAGE_FRACTION).round(),
        ironwork: 0.0,
    }
}

pub fn residence_zone_cost(residence_count: u32) -> ResourceAmount {
    ResourceAmount {
        timber: RESIDENCE_TIMBER_COST * residence_count as f64,
        stone: RESIDENCE_STONE_COST * residence_count as f64,
        ironwork: 0.0,
    }
}
