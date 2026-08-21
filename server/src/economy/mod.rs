//! Building costs, salvage, storage, population, and aggregate spending.

mod aggregate_spend;
mod chapel_coffer;
mod civic_receipts;
mod commodities;
mod fiscal_accounting;
mod household_wealth;
mod marketplace_trade;
mod marketplace_trade_policy;
mod parish_accounting;
mod population;
mod population_policy;
mod regional_market;
mod regional_market_policy;
mod storage;
mod trade_resources;
mod village_economy;

pub use commodities::{
    building_commodity_cap, building_commodity_room, building_commodity_stock,
    building_edible_food_stock, building_fresh_food_stock, building_preservable_food_stock,
    building_preserved_food_stock, credit_treasury_commodity, deposit_building_commodity,
    deposit_residence_commodity, first_building_edible_commodity, flour_bulk_stock, food_category,
    food_commodity_advances_residence_progression, household_food_per_day,
    residence_commodity_stock, residence_edible_food_stock, residence_food_category_mask,
    residence_food_progression_met, residence_food_progression_required_slots,
    residence_food_progression_slots, residence_fresh_food_stock, residence_preserved_food_stock,
    storage_accepts_commodity, withdraw_building_commodity, withdraw_building_edible_food,
    withdraw_residence_commodity, withdraw_residence_fresh_food, withdraw_residence_preserved_food,
    CommodityKind, FRESH_FOOD_COMMODITIES, PRESERVED_FOOD_COMMODITIES,
};
pub(crate) use marketplace_trade_policy::adriatic_trade_entry_point;

pub use aggregate_spend::{
    spend_aggregate_ironwork, spend_aggregate_roof_tiles, spend_aggregate_stone,
    spend_aggregate_timber,
};
pub use chapel_coffer::{
    chapel_coffer_gold, chapel_monastery_tithe_due, chapel_tithe_payment_room,
    deposit_chapel_tithe, withdraw_coffer_in_place,
};
pub use civic_receipts::{
    credit_local_civic_receipts, local_civic_receipts, mark_local_civic_receipts_dispatched,
    restore_local_civic_receipts,
};
pub(crate) use fiscal_accounting::credit_monastery_export_receipt;
pub use fiscal_accounting::{
    credit_local_purchase_receipt, credit_private_export_receipt,
    credit_settlement_household_income, private_export_proceeds, record_private_export_income,
    restore_private_export_proceeds, withdraw_private_export_proceeds,
};
pub use household_wealth::{credit_residence_wealth, debit_residence_wealth};
pub(crate) use marketplace_trade::{
    credit_marketplace_receipt_gold, settle_regional_market_export,
};
pub(crate) use marketplace_trade_policy::marketplace_proceeds_cart_load;
pub use parish_accounting::{
    clamp_chapel_coffer_reserve_gold, record_parish_ledger, ParishLedgerKind,
};
pub use population::{
    assign_building_labor, available_building_labor, guardhouse_roster_count,
    guardhouse_roster_floors, initial_construction_labor, reconcile_building_labor,
    residence_population_for_parcel,
};
pub use regional_market::{
    ensure_market_state, price_multiplier_for, record_market_trade, step_regional_markets,
};
pub(crate) use regional_market_policy::MarketTradeDirection;
pub(crate) use storage::physical_treasury_seat;
pub(crate) use storage::{
    available_unreserved_building_ironwork, available_unreserved_building_roof_tiles,
    available_unreserved_building_stone, available_unreserved_building_timber,
};
pub use storage::{
    building_storage_caps, building_water_storage_cap, construction_treasury_reservation,
    construction_treasury_reservation_excluding_building, credit_treasury_firewood,
    credit_treasury_food, credit_treasury_gold, credit_treasury_stone, credit_treasury_timber,
    credit_treasury_water, deposit_building, residence_firewood_capacity, residence_food_capacity,
    residence_water_capacity, restore_treasury_gold, spend_treasury_gold, total_ironwork,
    total_roof_tiles, total_stone, total_timber, treasury_gold, withdraw_building,
    withdraw_building_water,
};
pub use trade_resources::trade_resource_for_commodity;
pub use village_economy::{
    clamp_economic_activity_tax_rate, player_economic_activity_tax_rate, taxed_economic_activity,
    town_hall_tax_collection_multiplier,
};

pub use crate::balance_generated::{
    IRONWORK_SALVAGE_FRACTION, RESIDENCE_STONE_COST, RESIDENCE_TILE_ROOF_SALVAGE_FRACTION,
    RESIDENCE_TIMBER_COST, STARTING_GOLD, STARTING_STONE, STARTING_TIMBER, STONE_SALVAGE_FRACTION,
    TIMBER_SALVAGE_FRACTION,
};

pub struct ResourceAmount {
    pub timber: f64,
    pub stone: f64,
    pub ironwork: f64,
    pub roof_tiles: f64,
}

pub fn building_cost(kind: &str) -> Result<ResourceAmount, String> {
    let def = crate::building_defs::building_def_or_err(kind)?;
    Ok(ResourceAmount {
        timber: def.cost_timber,
        stone: def.cost_stone,
        ironwork: def.cost_ironwork,
        roof_tiles: def.cost_roof_tiles,
    })
}

pub fn building_salvage_refund(kind: &str) -> Result<ResourceAmount, String> {
    let cost = building_cost(kind)?;
    Ok(ResourceAmount {
        timber: (cost.timber * TIMBER_SALVAGE_FRACTION).round(),
        stone: (cost.stone * STONE_SALVAGE_FRACTION).round(),
        ironwork: (cost.ironwork * IRONWORK_SALVAGE_FRACTION).round(),
        roof_tiles: (cost.roof_tiles * RESIDENCE_TILE_ROOF_SALVAGE_FRACTION).round(),
    })
}

pub fn backyard_garden_cost(kind: crate::balance_generated::BackyardGardenKind) -> ResourceAmount {
    let def = crate::balance_generated::backyard_garden_def(kind);
    ResourceAmount {
        timber: def.cost_timber,
        stone: def.cost_stone,
        ironwork: 0.0,
        roof_tiles: 0.0,
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
        roof_tiles: 0.0,
    }
}

pub fn residence_zone_cost(residence_count: u32) -> ResourceAmount {
    residence_zone_cost_for_units(residence_count as f64)
}

pub fn residence_zone_cost_for_units(cost_units: f64) -> ResourceAmount {
    ResourceAmount {
        timber: (RESIDENCE_TIMBER_COST * cost_units.max(0.0)).ceil(),
        stone: (RESIDENCE_STONE_COST * cost_units.max(0.0)).ceil(),
        ironwork: 0.0,
        roof_tiles: 0.0,
    }
}
