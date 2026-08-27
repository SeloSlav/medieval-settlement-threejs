//! One-time normalization for saves created before resources became indivisible.
//!
//! Resource columns remain `f64` for additive schema compatibility. This pass
//! floors legacy stock to whole, non-negative units while deliberately leaving
//! rates, progress, health, terrain, prices, and probabilities untouched.

use std::collections::HashMap;

use spacetimedb::ReducerContext;

use crate::burgage::{compute_burgage_layout, residence_depth_cost_units, Point2, ZoneCorners};
use crate::db::*;
use crate::delivery_trip_policy::DeliveryTripPhase;
use crate::economy::{residence_zone_cost_for_units, CommodityKind};
use crate::residence_upgrade_policy::allocate_whole_residence_project_costs;
use crate::resource_units::{whole_signed_units, whole_units};
use crate::security_policy::RaidPortableStores;
use crate::tables::{Residence, ResourceUnitMigration};

const RESOURCE_UNIT_MIGRATION_ID: u8 = 0;
const RESOURCE_UNIT_MIGRATION_VERSION: u8 = 4;
const DELIVERY_DESTINATION_RESIDENCE: u8 = 0;

macro_rules! normalize_fields {
    ($row:ident, $($field:ident),+ $(,)?) => {
        $(
            $row.$field = whole_units($row.$field);
        )+
    };
}

/// Generic vegetable stock was retired once cabbage, carrots, and beetroot
/// became the only live croft outputs. Preserve every whole unit from old
/// saves while distributing it across the three canonical commodities.
fn split_legacy_vegetables(total: f64) -> (f64, f64, f64) {
    let total = whole_units(total);
    let base = (total / 3.0).floor();
    let remainder = (total - base * 3.0) as u8;
    (
        base + if remainder >= 1 { 1.0 } else { 0.0 },
        base + if remainder >= 2 { 1.0 } else { 0.0 },
        base,
    )
}

fn retire_legacy_vegetable_stock(
    vegetables: &mut f64,
    cabbage: &mut f64,
    carrots: &mut f64,
    beetroot: &mut f64,
) {
    let (legacy_cabbage, legacy_carrots, legacy_beetroot) = split_legacy_vegetables(*vegetables);
    *vegetables = 0.0;
    *cabbage = whole_units(*cabbage + legacy_cabbage);
    *carrots = whole_units(*carrots + legacy_carrots);
    *beetroot = whole_units(*beetroot + legacy_beetroot);
}

fn incoming_cottage_material(
    ctx: &ReducerContext,
    residence_id: u64,
    commodity: CommodityKind,
) -> f64 {
    whole_units(
        ctx.db
            .delivery_trip()
            .residence_id()
            .filter(&residence_id)
            .filter(|trip| {
                trip.destination_kind == DELIVERY_DESTINATION_RESIDENCE
                    && DeliveryTripPhase::from_u8(trip.phase) != Some(DeliveryTripPhase::Inbound)
                    && trip.cargo_kind == commodity.as_u8()
            })
            .map(|trip| whole_units(trip.amount))
            .sum(),
    )
}

fn reconcile_fractional_cottage_projects(ctx: &ReducerContext) {
    let mut residences_by_zone: HashMap<u64, Vec<Residence>> = HashMap::new();
    for residence in ctx
        .db
        .residence()
        .iter()
        .filter(|residence| residence.tier == 0 && residence.upgrade_target_tier == 1)
    {
        residences_by_zone
            .entry(residence.zone_id)
            .or_default()
            .push(residence);
    }

    for (zone_id, residences) in residences_by_zone {
        let Some(zone) = ctx.db.burgage_zone().id().find(&zone_id) else {
            continue;
        };
        let corners = ZoneCorners {
            a: Point2 {
                x: zone.corner_ax,
                z: zone.corner_az,
            },
            b: Point2 {
                x: zone.corner_bx,
                z: zone.corner_bz,
            },
            c: Point2 {
                x: zone.corner_cx,
                z: zone.corner_cz,
            },
            d: Point2 {
                x: zone.corner_dx,
                z: zone.corner_dz,
            },
        };
        let Some(layout) = compute_burgage_layout(&corners, zone.frontage_edge, zone.plot_count)
        else {
            continue;
        };
        let cost_weights = layout
            .residences
            .iter()
            .map(|placement| residence_depth_cost_units(placement.backyard_depth))
            .collect::<Vec<_>>();
        let total_cost = residence_zone_cost_for_units(cost_weights.iter().sum());
        let timber_lots = allocate_whole_residence_project_costs(total_cost.timber, &cost_weights);
        let stone_lots = allocate_whole_residence_project_costs(total_cost.stone, &cost_weights);

        for mut residence in residences {
            let Some(parcel_index) = layout
                .residences
                .iter()
                .position(|placement| placement.parcel_index == residence.parcel_index)
            else {
                continue;
            };
            let incoming_timber =
                incoming_cottage_material(ctx, residence.id, CommodityKind::Timber);
            let incoming_stone = incoming_cottage_material(ctx, residence.id, CommodityKind::Stone);
            let committed_timber =
                whole_units(residence.upgrade_delivered_timber) + incoming_timber;
            let committed_stone = whole_units(residence.upgrade_delivered_stone) + incoming_stone;
            let required_timber = timber_lots[parcel_index].max(committed_timber);
            let required_stone = stone_lots[parcel_index].max(committed_stone);

            residence.upgrade_required_timber = required_timber;
            residence.upgrade_required_stone = required_stone;
            residence.upgrade_reserved_timber = (required_timber - committed_timber).max(0.0);
            residence.upgrade_reserved_stone = (required_stone - committed_stone).max(0.0);
            ctx.db.residence().id().update(residence);
        }
    }
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

    // Version 2 made inventory whole but cottages placed afterward could still
    // split one zone cost into fractional per-parcel reservations. Rebuild the
    // authoritative lots from saved plot geometry before the generic whole-unit
    // pass so every existing 97%-stalled frame can receive its final cartload.
    reconcile_fractional_cottage_projects(ctx);

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
            yarn,
            linen,
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
            wax,
            candles,
            pelts,
        );
        retire_legacy_vegetable_stock(
            &mut row.vegetables,
            &mut row.cabbage,
            &mut row.carrots,
            &mut row.beetroot,
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
            yarn,
            linen,
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
            animal_feed,
            wax,
            candles,
            pelts,
        );
        retire_legacy_vegetable_stock(
            &mut row.vegetables,
            &mut row.cabbage,
            &mut row.carrots,
            &mut row.beetroot,
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
        retire_legacy_vegetable_stock(
            &mut row.vegetables,
            &mut row.cabbage,
            &mut row.carrots,
            &mut row.beetroot,
        );
        ctx.db.residence().id().update(row);
    }

    for mut row in ctx.db.residence_need().iter() {
        row.stock = whole_units(row.stock);
        ctx.db.residence_need().id().update(row);
    }
    for mut row in ctx.db.delivery_trip().iter() {
        row.amount = whole_units(row.amount);
        if row.cargo_kind == CommodityKind::Vegetables.as_u8() {
            row.cargo_kind = match row.id % 3 {
                0 => CommodityKind::Cabbage,
                1 => CommodityKind::Carrots,
                _ => CommodityKind::Beetroot,
            }
            .as_u8();
        }
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
    for mut row in ctx.db.pasture_herd().iter() {
        normalize_fields!(
            row,
            last_food_output,
            last_preserved_output,
            last_wool_gold,
            hay_stock,
            last_hay_output,
            last_wool_output,
        );
        ctx.db.pasture_herd().pasture_id().update(row);
    }
    for mut row in ctx.db.backyard_garden().iter() {
        row.hide_stock = whole_units(row.hide_stock);
        row.wax_stock = whole_units(row.wax_stock);
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
    for mut row in ctx.db.combat_agent().iter() {
        if row.carried_loot_json.is_empty() {
            continue;
        }
        let Ok(mut stores) = serde_json::from_str::<RaidPortableStores>(&row.carried_loot_json)
        else {
            continue;
        };
        retire_legacy_vegetable_stock(
            &mut stores.vegetables,
            &mut stores.cabbage,
            &mut stores.carrots,
            &mut stores.beetroot,
        );
        let Ok(normalized_json) = serde_json::to_string(&stores.normalized_whole()) else {
            continue;
        };
        if normalized_json != row.carried_loot_json {
            row.carried_loot_json = normalized_json;
            ctx.db.combat_agent().id().update(row);
        }
    }
    for mut row in ctx.db.trading_post_trade_rule().iter() {
        normalize_fields!(row, target_surplus, last_trade_amount);
        row.last_trade_gold = whole_signed_units(row.last_trade_gold);
        if row.commodity_kind == CommodityKind::Vegetables.as_u8() {
            row.mode = 0;
            row.target_surplus = 0.0;
        }
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
