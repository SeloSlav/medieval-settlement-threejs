//! One-time normalization for saves created before resources became indivisible.
//!
//! Resource columns remain `f64` for additive schema compatibility. This pass
//! floors legacy stock to whole, non-negative units while deliberately leaving
//! rates, progress, health, terrain, prices, and probabilities untouched.

use spacetimedb::ReducerContext;

use crate::db::*;
use crate::resource_units::{whole_signed_units, whole_units};
use crate::tables::ResourceUnitMigration;

const RESOURCE_UNIT_MIGRATION_ID: u8 = 0;
const RESOURCE_UNIT_MIGRATION_VERSION: u8 = 1;

macro_rules! normalize_fields {
    ($row:ident, $($field:ident),+ $(,)?) => {
        $(
            $row.$field = whole_units($row.$field);
        )+
    };
}

pub fn migrate_legacy_fractional_resources(ctx: &ReducerContext) {
    if ctx
        .db
        .resource_unit_migration()
        .id()
        .find(&RESOURCE_UNIT_MIGRATION_ID)
        .is_some_and(|row| row.version >= RESOURCE_UNIT_MIGRATION_VERSION)
    {
        return;
    }

    for mut row in ctx.db.player_resources().iter() {
        normalize_fields!(
            row,
            timber,
            stone,
            firewood,
            water,
            gold,
            food,
            ale,
            preserved_food,
            honey,
            wine,
            polearms,
            chapel_coffer_reserve_gold,
            parish_manual_collect_total,
            parish_auto_sweep_total,
            parish_salary_paid_total,
            parish_upkeep_paid_total,
            parish_charity_paid_total,
            monastery_tithe_paid_total,
            monastery_pilgrimage_gold_total,
            monastery_food_charity_total,
            monastery_levy_collected_total,
            monastery_seed_rescue_total,
            monastery_scriptorium_timber_saved_total,
            monastery_scriptorium_stone_saved_total,
            monastery_scriptorium_ironwork_saved_total,
            monastery_scriptorium_roof_tiles_saved_total,
            ironwork,
            wool,
            cloth,
            barley,
            malt,
            flax,
            iron,
            clay,
            salt,
            charcoal,
            pottery,
            last_night_theft_gold,
            last_night_lighting_fuel_used,
            last_night_lighting_fuel_shortfall,
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
            land_levy_assessed_total,
            land_levy_collected_total,
            import_duty_collected_total,
            export_duty_collected_total,
            private_export_income_total,
            local_discretionary_spend_total,
            local_producer_income_total,
            rye_sheaves,
            oat_sheaves,
            barley_sheaves,
            maslin_sheaves,
            rye_grain,
            oat_grain,
            maslin_grain,
            rye_flour,
            maslin_flour,
            rye_bread,
            maslin_bread,
            cider,
            mead,
            hides,
            leather,
            shoes,
            pears,
            aronia,
            rosehips,
            cabbage,
            carrots,
            beetroot,
            aronia_jam,
            rosehip_jam,
            pear_cider,
        );
        ctx.db.player_resources().owner().update(row);
    }

    for mut row in ctx.db.building().iter() {
        normalize_fields!(
            row,
            timber,
            firewood,
            stone,
            water,
            food,
            ale,
            preserved_food,
            honey,
            wine,
            polearms,
            water_capacity,
            gold,
            construction_required_timber,
            construction_required_stone,
            construction_delivered_timber,
            construction_delivered_stone,
            construction_reserved_timber,
            construction_reserved_stone,
            construction_treasury_timber,
            construction_treasury_stone,
            ironwork,
            woodcutter_timber_reserve,
            granary_grain_reserve,
            wool,
            cloth,
            chapel_monastery_tithe_due,
            civic_receipts_gold,
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
            construction_required_ironwork,
            construction_delivered_ironwork,
            construction_reserved_ironwork,
            construction_treasury_ironwork,
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
            private_export_proceeds_gold,
            vineyard_fermenting_grapes,
            rye_sheaves,
            oat_sheaves,
            barley_sheaves,
            maslin_sheaves,
            rye_grain,
            oat_grain,
            maslin_grain,
            rye_flour,
            maslin_flour,
            rye_bread,
            maslin_bread,
            construction_required_roof_tiles,
            construction_delivered_roof_tiles,
            construction_reserved_roof_tiles,
            construction_treasury_roof_tiles,
            cider,
            mead,
            hides,
            leather,
            shoes,
            pears,
            aronia,
            rosehips,
            cabbage,
            carrots,
            beetroot,
            aronia_jam,
            rosehip_jam,
            pear_cider,
        );
        ctx.db.building().id().update(row);
    }

    for mut row in ctx.db.residence().iter() {
        normalize_fields!(
            row,
            household_wealth,
            upgrade_required_timber,
            upgrade_required_stone,
            upgrade_required_gold,
            upgrade_delivered_timber,
            upgrade_delivered_stone,
            upgrade_delivered_gold,
            upgrade_reserved_timber,
            upgrade_reserved_stone,
            upgrade_reserved_gold,
            remedy_stock,
            upgrade_required_roof_tiles,
            upgrade_delivered_roof_tiles,
            upgrade_reserved_roof_tiles,
            food,
            preserved_food,
            honey,
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
            rye_bread,
            maslin_bread,
            oat_grain,
            pears,
            aronia,
            rosehips,
            cabbage,
            carrots,
            beetroot,
            aronia_jam,
            rosehip_jam,
        );
        ctx.db.residence().id().update(row);
    }

    for mut row in ctx.db.residence_need().iter() {
        row.stock = whole_units(row.stock);
        ctx.db.residence_need().id().update(row);
    }
    for mut row in ctx.db.delivery_trip().iter() {
        row.amount = whole_units(row.amount);
        ctx.db.delivery_trip().id().update(row);
    }
    for mut row in ctx.db.quarry().iter() {
        normalize_fields!(row, max_yield, remaining);
        ctx.db.quarry().quarry_id().update(row);
    }
    for mut row in ctx.db.foraging_node().iter() {
        normalize_fields!(row, max_yield, remaining);
        ctx.db.foraging_node().node_id().update(row);
    }
    for mut row in ctx.db.tree_entity().iter() {
        row.wood_yield = whole_units(row.wood_yield);
        ctx.db.tree_entity().tree_id().update(row);
    }
    for mut row in ctx.db.farm_field().iter() {
        normalize_fields!(row, last_yield, current_yield, manure_applied);
        ctx.db.farm_field().id().update(row);
    }
    for mut row in ctx.db.livestock_herd().iter() {
        normalize_fields!(
            row,
            last_food_output,
            last_preserved_output,
            last_wool_gold,
            hay_stock,
            last_hay_output,
            last_wool_output,
        );
        ctx.db.livestock_herd().building_id().update(row);
    }
    for mut row in ctx.db.backyard_garden().iter() {
        row.hide_stock = whole_units(row.hide_stock);
        ctx.db.backyard_garden().id().update(row);
    }
    for mut row in ctx.db.fire_incident().iter() {
        normalize_fields!(row, water_delivered, required_water);
        ctx.db.fire_incident().id().update(row);
    }
    for mut row in ctx.db.settlement_security().iter() {
        normalize_fields!(row, last_goods_lost, last_wealth_lost);
        ctx.db.settlement_security().owner().update(row);
    }
    for mut row in ctx.db.active_raid().iter() {
        normalize_fields!(row, goods_lost, wealth_lost);
        ctx.db.active_raid().owner().update(row);
    }
    for mut row in ctx.db.trading_post_trade_rule().iter() {
        normalize_fields!(row, target_surplus, last_trade_amount);
        row.last_trade_gold = whole_signed_units(row.last_trade_gold);
        ctx.db.trading_post_trade_rule().id().update(row);
    }

    let marker = ResourceUnitMigration {
        id: RESOURCE_UNIT_MIGRATION_ID,
        version: RESOURCE_UNIT_MIGRATION_VERSION,
    };
    if ctx
        .db
        .resource_unit_migration()
        .id()
        .find(&RESOURCE_UNIT_MIGRATION_ID)
        .is_some()
    {
        ctx.db.resource_unit_migration().id().update(marker);
    } else {
        ctx.db.resource_unit_migration().insert(marker);
    }
}
