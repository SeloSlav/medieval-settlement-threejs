use std::collections::{HashMap, HashSet};

use spacetimedb::ReducerContext;

use crate::apiary_policy::{
    apiary_forage_score, apiary_honey_reserve, apiary_production_multiplier,
    next_apiary_colony_health, pollination_contribution, pollination_multiplier,
};
use crate::balance_generated::{
    BackyardGardenKind, FarmCropProduce, APIARY_HONEY_PER_CYCLE, APIARY_WAX_PER_HARVEST,
    APIARY_WAX_PER_HONEY_CYCLES, APIARY_WINTER_HONEY_REQUIRED,
    BACKYARD_APIARY_POLLINATION_CONTRIBUTION, BACKYARD_APIARY_POLLINATION_RADIUS,
    BAKERY_FIREWOOD_PER_CYCLE, BAKERY_FLOUR_PER_CYCLE, BAKERY_MASLIN_BREAD_PER_CYCLE,
    BAKERY_RYE_BREAD_PER_CYCLE, BAKERY_WATER_PER_CYCLE, BREWERY_ALE_PER_CYCLE,
    BREWERY_FRUIT_PER_CIDER_CYCLE, BREWERY_BARLEY_PER_MALT_CYCLE,
    BREWERY_BREWING_FIREWOOD_PER_CYCLE, BREWERY_BREWING_WATER_PER_CYCLE, BREWERY_CIDER_PER_CYCLE,
    BREWERY_HONEY_PER_MEAD_CYCLE, BREWERY_MALTING_FIREWOOD_PER_CYCLE,
    BREWERY_MALTING_WATER_PER_CYCLE, BREWERY_MALT_PER_ALE_CYCLE, BREWERY_MALT_PER_CYCLE,
    BREWERY_MEAD_PER_CYCLE, CALENDAR_SECONDS_PER_DAY, CANDLE_TRANSFER_PER_TRIP,
    CATTLE_GRAIN_PER_UNSUPPORTED_HEAD, CATTLE_HAY_PER_UNSUPPORTED_HEAD,
    CAVALRY_HORSE_FIELD_ISSUE_DAYS, CAVALRY_HORSE_FIELD_REORDER_DAYS,
    CAVALRY_HORSE_FIELD_TARGET_DAYS, CHANDLERY_CANDLES_PER_CYCLE, CHANDLERY_FIREWOOD_PER_CYCLE,
    CHANDLERY_WAX_PER_CYCLE, CHARCOAL_BURNER_CHARCOAL_PER_CYCLE,
    CHARCOAL_BURNER_FIREWOOD_PER_CYCLE, CIVILIAN_TOOL_IRONWORK_PER_CYCLE,
    COBBLER_LEATHER_PER_CYCLE, COBBLER_SHOES_PER_CYCLE, FARM_GROWTH_SECONDS,
    FARM_WORK_METERS_PER_WORKER_PER_SEC, GRAIN_TRANSFER_PER_TRIP, LEATHER_TRANSFER_PER_TRIP,
    MINE_CLAY_PER_CYCLE, MINE_IRON_PER_CYCLE, MINE_SALT_PER_CYCLE, MINE_TIMBER_SUPPORT_PER_CYCLE,
    HORSE_GRAIN_PER_UNSUPPORTED_HEAD, HORSE_HAY_PER_UNSUPPORTED_HEAD,
    MONASTERY_FEAST_DRINK, MONASTERY_FEAST_FOOD, MONASTERY_FEAST_HONEY,
    MONASTERY_PILGRIMAGE_GOLD_PER_DAY, MONASTERY_UNLINKED_PRODUCTIVITY,
    PANNAGE_WINTER_CAPACITY_MULTIPLIER, POTTER_CLAY_PER_CYCLE, POTTER_FIREWOOD_PER_CYCLE,
    POTTER_POTTERY_PER_CYCLE, POTTER_ROOF_TILES_PER_CYCLE, POTTER_WATER_PER_CYCLE,
    RICH_MINE_THROUGHPUT_MULTIPLIER, SHEEP_GRAIN_PER_UNSUPPORTED_HEAD,
    SHEEP_HAY_PER_UNSUPPORTED_HEAD, SMITHY_CHARCOAL_PER_CYCLE, SMITHY_IRONWORK_PER_CYCLE,
    SMITHY_IRON_PER_CYCLE, SMITHY_WATER_PER_CYCLE, SMOKEHOUSE_FIREWOOD_PER_CYCLE,
    SMOKEHOUSE_FOOD_PER_CYCLE, SMOKEHOUSE_PRESERVED_FOOD_PER_CYCLE, SMOKEHOUSE_SALT_PER_CYCLE,
    SPINNING_RETTING_FLAX_PER_CYCLE, SPINNING_RETTING_FLAX_WATER_PER_CYCLE,
    SPINNING_RETTING_LINEN_PER_CYCLE, SPINNING_RETTING_WOOL_PER_CYCLE,
    SPINNING_RETTING_YARN_PER_CYCLE, SUMMER_DROUGHT_DURATION_DAYS,
    SWINE_GRAIN_PER_UNSUPPORTED_HEAD, TANNERY_FIREWOOD_PER_CYCLE, TANNERY_HIDES_PER_CYCLE,
    TANNERY_LEATHER_PER_CYCLE, TANNERY_WATER_PER_CYCLE, TEXTILE_TRANSFER_PER_TRIP,
    THRESHING_GRAIN_PER_CYCLE, THRESHING_SHEAVES_PER_CYCLE, TICK_DT, TIMBER_DELIVERY_SPEED_MPS,
    TIMBER_DELIVERY_UNLOAD_SEC, VINEYARD_FERMENTATION_SECONDS,
    VINEYARD_GRAPES_PER_FERMENTATION_BATCH, VINEYARD_GRAPES_PER_HARVEST_CYCLE,
    VINEYARD_WINE_PER_FERMENTATION_BATCH, WATERMILL_GRAIN_PER_CYCLE,
    WATERMILL_MASLIN_FLOUR_PER_CYCLE, WATERMILL_RYE_FLOUR_PER_CYCLE, WEAVER_CLOTH_PER_CYCLE,
    WEAVER_LINEN_PER_CYCLE, WEAVER_YARN_PER_CYCLE, WINTER_PASTURE_CAPACITY_MULTIPLIER,
};
use crate::brewery_recipe_policy::{
    brewery_recipe_requests_input, normalize_brewery_recipe_policy, BREWERY_RECIPE_ALE,
    BREWERY_RECIPE_AUTO, BREWERY_RECIPE_CIDER, BREWERY_RECIPE_MEAD, BREWERY_RECIPE_PEAR_CIDER,
};
use crate::building_defs::building_def;
use crate::burgage::{Point2, ZoneCorners};
use crate::cavalry_policy::cavalry_daily_ration;
use crate::civilian_tool_policy::{
    civilian_tool_runway_cycles, civilian_tool_throughput_multiplier, civilian_tools_maintained,
    farm_tool_ironwork_per_completed_stage, farm_tool_throughput_multiplier, farm_tools_maintained,
    is_civilian_tool_site,
};
use crate::construction_priority::CONSTRUCTION_PRIORITY_NORMAL;
use crate::db::*;
use crate::devotional_candle_policy::monastery_liturgy_prestige_multiplier;
use crate::economy::{
    available_unreserved_building_ironwork, building_commodity_cap, building_commodity_room,
    building_commodity_stock, building_edible_food_stock, building_fresh_food_stock,
    building_preservable_food_stock, credit_monastery_export_receipt, deposit_building_commodity,
    flour_bulk_stock, storage_accepts_commodity, withdraw_building_commodity,
    withdraw_building_edible_food, CommodityKind, FRESH_FOOD_COMMODITIES,
};
use crate::extraction_policy::{
    mineworks_clay_commodity, mineworks_geological_commodity, mining_camp_clay_commodity,
    mining_camp_geological_commodity, quarry_geological_commodity,
};
use crate::farm_work_policy::{
    farm_field_effective_labor, field_task_rank, threshing_preempts_fields,
};
use crate::farming::{
    advance_crop_rotation, centroid, crop_growth_allowed, crop_harvest_month, crop_produce,
    expected_grain_yield, farmstead_exportable_grain, fertility_after_harvest,
    field_accepts_farmstead_labor, field_manure_fertility_bonus, field_manure_required,
    field_seed_crop, field_seed_grain_remaining, field_work_allowed, month_after,
    seed_grain_required, shape_efficiency, sowing_window_missed, work_required, CROP_BARLEY,
    CROP_FALLOW, CROP_FLAX, CROP_OATS, CROP_RYE, CROP_WHEAT, STAGE_GROWING, STAGE_HARVESTING,
    STAGE_PLOUGHING, STAGE_SOWING,
};
use crate::frontier_economy_policy::{
    carpenter_polearm_shortfall, CARPENTER_IRONWORK_PER_POLEARM, CARPENTER_TIMBER_PER_POLEARM,
};
use crate::fuel_reserve_policy::{
    combined_fuel_equivalent, marketplace_fuel_reserve_target_for_households,
    smithy_charcoal_refill_target,
};
use crate::granary_policy::granary_fresh_food_target;
use crate::hydrology::drought_groundwater_score;
use crate::livestock_policy::{
    effective_milk_use_policy, farmhouse_cheese_salt_staging_cycles,
    livestock_cycles_per_calendar_day, projected_winter_animal_feed, MILK_USE_FRESH,
};
use crate::marketplace_procurement_policy::{
    normalize_marketplace_iron_target, normalize_marketplace_salt_target,
};
use crate::military_policy::{military_stats, MilitaryCost, MilitaryKind};
use crate::monastery_estate_policy::{
    monastery_daily_service_cost, monastery_estate_can_reinvest, monastery_estate_exportable,
    monastery_estate_next_investment_cost, monastery_estate_yields, monastery_extension_count,
    monastery_guesthouse_multiplier, monastery_infirmary_beds, monastery_orchard_maturity_for_year,
    monastery_seed_archive_target_per_crop, MONASTERY_INFIRMARY_FOOD_PER_BED_DAY,
};
use crate::monastery_hospitality_policy::{
    is_monastery_feast_day, monastery_daily_hospitality_use, monastery_feast_batch,
    monastery_pilgrimage_gold,
};
use crate::potter_firing_policy::potter_fires_roof_tiles;
use crate::processor_output_policy::{
    processor_input_staging_cycles, processor_output_headroom, processor_output_kind,
    ProcessorOutputKind,
};
use crate::production_maintenance::charge_completed_production_maintenance;
use crate::residence_consumption_policy::daily_household_bill_due;
use crate::resource_units::{
    deterministic_whole_lot, periodic_whole_units, whole_cost, whole_units,
};
use crate::season_policy::{EnvironmentState, WeatherKind};
use crate::security_policy::RaidPortableStores;
use crate::simulation::delivery_trips::{
    building_has_active_trip, building_has_conflicting_inbound_supply_trip,
    building_has_inbound_commodity_trip, building_has_inbound_supply_trip,
    building_has_regional_market_trip, onsite_building_labor, regional_market_export_route,
    start_regional_market_export_trip, try_start_building_supply_trip,
    try_start_cavalry_company_supply_trip, try_start_origin_rostered_building_supply_trip,
};
use crate::simulation::game_calendar::GameClock;
use crate::simulation::labor_and_logistics_paused;
use crate::simulation::landmark_access::monastery_linked_to_chapel;
use crate::simulation::residence_needs::{apply_need_consumed_at_source, ResidenceNeedKind};
use crate::simulation::road_logistics::local_delivery_distance;
use crate::simulation::tick_context::SimTickContext;
use crate::simulation::trading_post_exports_commodity;
use crate::simulation::try_dispatch_local_civic_receipts;
use crate::smokehouse_recipe_policy::{
    normalize_smokehouse_recipe_policy, smokehouse_recipe_requests_input, SMOKEHOUSE_RECIPE_AUTO,
    SMOKEHOUSE_RECIPE_CHEESE, SMOKEHOUSE_RECIPE_CURED_MEAT, SMOKEHOUSE_RECIPE_SMOKED_FISH,
};
use crate::specialty_trade_policy::{
    apiary_is_accumulating, apiary_is_harvesting, producer_output_batch_fits,
    vineyard_is_harvesting,
};
use crate::storehouse_policy::storehouse_stock_target;
use crate::supply_policy::{
    carpenter_cart_service_ironwork_target, carpenter_cart_service_timber_target,
    compare_institutional_food_dispatch_candidates, compare_processor_input_dispatch_candidates,
    directly_dispatched_processor_input_per_cycle as processor_input_per_cycle_for_dispatch,
    grain_input_runway_cycles, grain_input_target, granary_dispatch_order,
    institutional_dispatchable_food_stock, institutional_food_surplus,
    livestock_holding_protects_feed_oats, local_material_dispatch_target,
    marketplace_refill_request, processor_input_dispatch_duty,
    processor_input_dispatch_duty_for_target, processor_input_runway_cycles,
    processor_input_target, rich_mine_support_target, rich_mine_supports_ready,
    select_grain_dispatch_candidate, select_processor_input_dispatch_candidate,
    select_seed_grain_delivery_candidate, select_supply_route_candidate, GranaryDispatchDuty,
    InstitutionalFoodDispatchDuty, ProcessorInputDispatchDuty, GRAIN_CRITICAL_RUNWAY_CYCLES,
    GRAIN_PROCESSOR_KINDS, INDUSTRIAL_FIREWOOD_TARGET_KINDS, INSTITUTIONAL_FOOD_SOURCE_KINDS,
    LOCAL_MATERIAL_SOURCE_KINDS, MARKETPLACE_MATERIAL_TARGET_KINDS,
};
use crate::tables::{farm_field, Building, FarmField, Residence};
use crate::vineyard::fermentable_grapes;
use crate::weaver_input_policy::{
    textile_recipe_requests_route, weaver_fibre_delivery_preference_rank, weaver_uses_flax,
    weaver_uses_linen,
};

struct RoutedBuilding {
    building: Building,
    distance: f64,
}

struct RoutedProcessorInputTarget {
    building: Building,
    distance: f64,
    duty: ProcessorInputDispatchDuty,
    input_preference_rank: u8,
    runway_cycles: f64,
    desired_stock: f64,
}

struct RoutedMarketplaceMaterialTarget {
    source_id: u64,
    building: Building,
    commodity: CommodityKind,
    distance: f64,
    duty: ProcessorInputDispatchDuty,
    runway_cycles: f64,
}

struct LocalMaterialDispatchCandidate {
    source_id: u64,
    building: Building,
    commodity: CommodityKind,
    distance: f64,
    duty: ProcessorInputDispatchDuty,
    desired_stock: f64,
    runway_cycles: f64,
}

struct RoutedGrainTarget {
    building: Building,
    commodity: CommodityKind,
    distance: f64,
    runway_cycles: f64,
    desired_stock: f64,
}

struct RoutedSeedTarget {
    building: Building,
    distance: f64,
    required: f64,
}

struct InstitutionalFoodDispatchCandidate {
    source_id: u64,
    commodity: CommodityKind,
    target: Building,
    distance: f64,
    duty: InstitutionalFoodDispatchDuty,
    priority: u8,
    runway: f64,
}

/// Match every fresh-food producer to one staffed storage or institutional
/// destination after production for this tick. The destination's logistics
/// worker collects the load; producers never lose production labor to hauling.
/// Granary workers later stock Marketplace food stalls and serve households.
/// Building update order therefore cannot let an older granary or smokehouse
/// seize a cart before a more urgent destination is considered.
pub fn step_institutional_food_dispatch(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    sources: Vec<Building>,
) {
    let mut candidates = Vec::new();

    for source in sources {
        if !INSTITUTIONAL_FOOD_SOURCE_KINDS.contains(&source.kind.as_str())
            || !source.construction_complete
            || tick.building_disabled_by_fire(ctx, source.id)
            || labor_and_logistics_paused(ctx, tick, source.owner, clock)
            || building_has_active_trip(ctx, source.id)
            || institutional_source_food_surplus(
                ctx,
                tick,
                &source,
                building_edible_food_stock(&source),
            ) <= 1e-6
        {
            continue;
        }
        let Some(network) = tick.road_network(source.owner) else {
            continue;
        };
        let protects_feed_oats = livestock_holding_protects_feed_oats(
            &source.kind,
            livestock_source_has_feed_commitment(ctx, &source),
        );
        for target_id in
            tick.building_ids_for_kinds(ctx, source.owner, &["smokehouse", "granary"])
        {
            let Some(target) = ctx.db.building().id().find(&target_id) else {
                continue;
            };
            if target.id == source.id
                || tick.building_disabled_by_fire(ctx, target.id)
                || building_has_inbound_supply_trip(ctx, target.id)
            {
                continue;
            }
            let Some(distance) =
                local_delivery_distance(network, source.x, source.z, target.x, target.z)
            else {
                continue;
            };
            for commodity in FRESH_FOOD_COMMODITIES {
                if commodity == CommodityKind::OatGrain && protects_feed_oats {
                    continue;
                }
                if building_commodity_stock(&source, commodity) <= 1e-6
                    || building_commodity_room(&target, commodity) <= 1e-6
                {
                    continue;
                }
                let Some((duty, priority, runway, _)) =
                    institutional_food_target_plan(&target, commodity)
                else {
                    continue;
                };
                candidates.push(InstitutionalFoodDispatchCandidate {
                    source_id: source.id,
                    commodity,
                    target: target.clone(),
                    distance,
                    duty,
                    priority,
                    runway,
                });
            }
        }
    }

    candidates.sort_by(|a, b| {
        compare_institutional_food_dispatch_candidates(
            a.duty,
            a.priority,
            a.runway,
            a.distance,
            a.target.id,
            a.source_id,
            b.duty,
            b.priority,
            b.runway,
            b.distance,
            b.target.id,
            b.source_id,
        )
    });

    let mut used_sources = HashSet::new();
    let mut used_targets = HashSet::new();
    for candidate in candidates {
        if used_sources.contains(&candidate.source_id)
            || used_targets.contains(&candidate.target.id)
        {
            continue;
        }
        let Some(mut source) = ctx.db.building().id().find(&candidate.source_id) else {
            continue;
        };
        let Some(target) = ctx.db.building().id().find(&candidate.target.id) else {
            continue;
        };
        if building_has_active_trip(ctx, source.id)
            || building_has_inbound_supply_trip(ctx, target.id)
            || tick.building_disabled_by_fire(ctx, source.id)
            || tick.building_disabled_by_fire(ctx, target.id)
        {
            continue;
        }
        let Some((_, _, _, desired_stock)) =
            institutional_food_target_plan(&target, candidate.commodity)
        else {
            continue;
        };
        let protects_feed_oats = livestock_holding_protects_feed_oats(
            &source.kind,
            livestock_source_has_feed_commitment(ctx, &source),
        );
        let transferable = institutional_source_food_surplus(
            ctx,
            tick,
            &source,
            building_edible_food_stock(&source),
        )
        .min(
            if candidate.commodity == CommodityKind::OatGrain && protects_feed_oats {
                0.0
            } else {
                building_commodity_stock(&source, candidate.commodity)
            },
        );
        let target_stock = institutional_food_target_stock(&target);
        let needed = (desired_stock - target_stock).max(0.0).min(transferable);
        if needed <= 1e-6 {
            continue;
        }
        let Some(network) = tick.road_network(source.owner) else {
            continue;
        };
        if try_start_building_supply_trip(
            ctx,
            tick,
            clock,
            network,
            &mut source,
            &target,
            1,
            candidate.commodity,
            TIMBER_DELIVERY_SPEED_MPS,
            TIMBER_DELIVERY_UNLOAD_SEC,
            commodity_transfer_per_trip(candidate.commodity),
            needed,
        ) {
            used_sources.insert(source.id);
            used_targets.insert(target.id);
            ctx.db.building().id().update(source);
        }
    }
}

fn institutional_food_target_plan(
    target: &Building,
    commodity: CommodityKind,
) -> Option<(InstitutionalFoodDispatchDuty, u8, f64, f64)> {
    if !target.construction_complete || target.assigned_labor == 0 {
        return None;
    }
    match target.kind.as_str() {
        "smokehouse" if smokehouse_requests_food_input(target, commodity) => {
            let per_cycle = SMOKEHOUSE_FOOD_PER_CYCLE;
            let desired_stock =
                processor_input_target(per_cycle, target.processor_output_target_percent);
            let stock = if normalize_smokehouse_recipe_policy(target.smokehouse_recipe_policy)
                == SMOKEHOUSE_RECIPE_AUTO
            {
                building_preservable_food_stock(target)
            } else {
                building_commodity_stock(target, commodity)
            };
            if desired_stock <= 1e-6 || stock + 1e-6 >= desired_stock {
                return None;
            }
            Some((
                InstitutionalFoodDispatchDuty::PreservationBuffer,
                CONSTRUCTION_PRIORITY_NORMAL,
                processor_input_runway_cycles(stock, per_cycle),
                desired_stock,
            ))
        }
        "granary" if storage_accepts_commodity(target, commodity) => {
            let desired_stock = granary_fresh_food_target(
                building_commodity_cap(&target.kind, commodity),
                target.granary_fresh_food_target_percent,
            );
            let stock = building_fresh_food_stock(target);
            if desired_stock <= 1e-6 || stock + 1e-6 >= desired_stock {
                return None;
            }
            Some((
                InstitutionalFoodDispatchDuty::GranaryIntake,
                CONSTRUCTION_PRIORITY_NORMAL,
                stock.max(0.0) / desired_stock,
                desired_stock,
            ))
        }
        _ => None,
    }
}

fn institutional_food_target_stock(target: &Building) -> f64 {
    match target.kind.as_str() {
        "smokehouse" => building_preservable_food_stock(target),
        "granary" => building_fresh_food_stock(target),
        _ => building_edible_food_stock(target),
    }
}

pub fn step_threshing_barn(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    environment: EnvironmentState,
    world_seed: u64,
    map_size: u8,
    mut building: Building,
) {
    let fields: Vec<FarmField> = ctx
        .db
        .farm_field()
        .farmstead_id()
        .filter(&building.id)
        .collect();
    let work_allowed = !labor_and_logistics_paused(ctx, tick, building.owner, clock);
    let onsite_labor = onsite_building_labor(ctx, &building);
    let farm_work = step_farmstead_fields(
        ctx,
        tick,
        &mut building,
        clock,
        environment,
        world_seed,
        map_size,
        work_allowed,
        onsite_labor,
        fields,
    );
    tick.set_farmstead_seed_reserves(
        ctx,
        building.owner,
        building.id,
        farm_work.seed_reserves.rye,
        farm_work.seed_reserves.oats,
        farm_work.seed_reserves.maslin,
    );
    building = step_farmstead_threshing(
        ctx,
        tick,
        clock,
        building,
        farm_work.seed_reserves,
        farm_work.threshing_labor,
    );
    if !labor_and_logistics_paused(ctx, tick, building.owner, clock) {
        dispatch_to_building(
            ctx,
            tick,
            clock,
            &mut building,
            CommodityKind::Flax,
            &["spinning_retting_house", "granary"],
        );
        dispatch_farmstead_typed_grain(ctx, tick, clock, &mut building, farm_work.seed_reserves);
        dispatch_farmstead_barley(
            ctx,
            tick,
            clock,
            &mut building,
            farm_work.seed_reserves.barley,
        );
    }
    ctx.db.building().id().update(building);
}

/// Granaries, staffed Trading Posts, and parish-linked monastery archives each
/// launch at most one seed cart per simulation step. Source-side selection
/// removes farm-row iteration bias: lowest claim coverage wins, then the
/// shortest authoritative road route and stable holding id. The existing
/// inbound-trip gate prevents overlapping sources from double-serving the same
/// farmstead in one step.
pub fn step_seed_grain_distribution(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
) {
    let mut source_ids: Vec<u64> = ctx
        .db
        .building()
        .iter()
        .filter(|source| {
            matches!(
                source.kind.as_str(),
                "granary" | "trading_post" | "monastery"
            ) && source.construction_complete
                && (source.rye_grain > 1e-6
                    || source.oat_grain > 1e-6
                    || source.maslin_grain > 1e-6
                    || source.barley > 1e-6
                    || source.flax > 1e-6)
                && (source.kind != "trading_post" || source.assigned_labor > 0)
                && (source.kind != "monastery"
                    || (source.assigned_labor > 0 && monastery_has_parish_link(ctx, tick, source)))
                && !tick.building_disabled_by_fire(ctx, source.id)
        })
        .map(|source| source.id)
        .collect();
    source_ids.sort_unstable();

    for source_id in source_ids {
        let Some(mut source) = ctx.db.building().id().find(&source_id) else {
            continue;
        };
        if dispatch_seed_grain_from_source(ctx, tick, clock, &mut source) {
            ctx.db.building().id().update(source);
        }
    }
}

fn dispatch_seed_grain_from_source(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    source: &mut Building,
) -> bool {
    dispatch_seed_commodity_from_source(ctx, tick, clock, source, CommodityKind::RyeGrain)
        || dispatch_seed_commodity_from_source(ctx, tick, clock, source, CommodityKind::OatGrain)
        || dispatch_seed_commodity_from_source(ctx, tick, clock, source, CommodityKind::MaslinGrain)
        || dispatch_seed_commodity_from_source(ctx, tick, clock, source, CommodityKind::Barley)
        || dispatch_seed_commodity_from_source(ctx, tick, clock, source, CommodityKind::Flax)
}

fn dispatch_seed_commodity_from_source(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    source: &mut Building,
    commodity: CommodityKind,
) -> bool {
    let source_stock = building_commodity_stock(source, commodity);
    if source_stock <= 1e-6
        || building_has_active_trip(ctx, source.id)
        || labor_and_logistics_paused(ctx, tick, source.owner, clock)
        || (source.kind == "trading_post" && source.assigned_labor == 0)
    {
        return false;
    }
    let Some(network) = tick.road_network(source.owner) else {
        return false;
    };
    let Some(target) = select_seed_grain_delivery_candidate(
        tick.building_ids_for_kinds(ctx, source.owner, &["threshing_barn"])
            .into_iter()
            .filter_map(|target_id| ctx.db.building().id().find(&target_id))
            .filter_map(|target| {
                if !target.construction_complete
                    || target.assigned_labor == 0
                    || tick.building_disabled_by_fire(ctx, target.id)
                    || building_has_inbound_commodity_trip(ctx, target.id, commodity)
                    || building_commodity_room(&target, commodity) <= 1e-6
                {
                    return None;
                }
                let fields: Vec<FarmField> = ctx
                    .db
                    .farm_field()
                    .farmstead_id()
                    .filter(&target.id)
                    .collect();
                let required = farmstead_seed_grain_remaining(&fields).for_commodity(commodity);
                if building_commodity_stock(&target, commodity) + 1e-6 >= required {
                    return None;
                }
                local_delivery_distance(network, source.x, source.z, target.x, target.z)
                    .filter(|distance| distance.is_finite())
                    .map(|distance| RoutedSeedTarget {
                        building: target,
                        distance,
                        required,
                    })
            }),
        |candidate| building_commodity_stock(&candidate.building, commodity),
        |candidate| candidate.required,
        |candidate| candidate.distance,
        |candidate| candidate.building.id,
    ) else {
        return false;
    };
    let request = (target.required - building_commodity_stock(&target.building, commodity))
        .max(0.0)
        .min(source_stock.max(0.0));
    try_start_building_supply_trip(
        ctx,
        tick,
        clock,
        network,
        source,
        &target.building,
        1,
        commodity,
        TIMBER_DELIVERY_SPEED_MPS,
        TIMBER_DELIVERY_UNLOAD_SEC,
        GRAIN_TRANSFER_PER_TRIP,
        request,
    )
}

fn step_farmstead_threshing(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    building: Building,
    seed_reserves: FarmSeedReserves,
    threshing_labor: u32,
) -> Building {
    if threshing_labor == 0 {
        return building;
    }
    let mut recipes = [
        (CommodityKind::RyeSheaves, CommodityKind::RyeGrain),
        (CommodityKind::OatSheaves, CommodityKind::OatGrain),
        (CommodityKind::BarleySheaves, CommodityKind::Barley),
        (CommodityKind::MaslinSheaves, CommodityKind::MaslinGrain),
    ];
    recipes.sort_by(|(left_input, _), (right_input, _)| {
        let score = |input: CommodityKind, output: CommodityKind| {
            let stock = building_commodity_stock(&building, output);
            let reserve = seed_reserves.for_commodity(output);
            (
                (stock + 1e-6 < reserve) as u8,
                (farmstead_exportable_grain(stock, reserve) + 1e-6 < GRAIN_TRANSFER_PER_TRIP) as u8,
                building_commodity_stock(&building, input),
            )
        };
        let left = score(*left_input, crop_grain_for_sheaves(*left_input));
        let right = score(*right_input, crop_grain_for_sheaves(*right_input));
        right
            .0
            .cmp(&left.0)
            .then_with(|| right.1.cmp(&left.1))
            .then_with(|| right.2.total_cmp(&left.2))
    });
    let Some((sheaves, grain)) = recipes.into_iter().find(|(input, output)| {
        building_commodity_stock(&building, *input) > 1e-6
            && building_commodity_room(&building, *output) > 1e-6
    }) else {
        return building;
    };
    step_processor_with_labor(
        ctx,
        tick,
        clock,
        building,
        &[(sheaves, THRESHING_SHEAVES_PER_CYCLE)],
        &[(grain, THRESHING_GRAIN_PER_CYCLE)],
        threshing_labor,
    )
}

fn crop_grain_for_sheaves(sheaves: CommodityKind) -> CommodityKind {
    match sheaves {
        CommodityKind::RyeSheaves => CommodityKind::RyeGrain,
        CommodityKind::OatSheaves => CommodityKind::OatGrain,
        CommodityKind::BarleySheaves => CommodityKind::Barley,
        CommodityKind::MaslinSheaves => CommodityKind::MaslinGrain,
        _ => CommodityKind::RyeGrain,
    }
}

fn threshing_work_available(building: &Building) -> bool {
    [
        CommodityKind::RyeSheaves,
        CommodityKind::OatSheaves,
        CommodityKind::BarleySheaves,
        CommodityKind::MaslinSheaves,
    ]
    .into_iter()
    .any(|sheaves| {
        building_commodity_stock(building, sheaves) > 1e-6
            && building_commodity_room(building, crop_grain_for_sheaves(sheaves)) > 1e-6
    })
}

fn threshing_work_demanded(building: &Building, seed_reserves: FarmSeedReserves) -> bool {
    [
        CommodityKind::RyeSheaves,
        CommodityKind::OatSheaves,
        CommodityKind::BarleySheaves,
        CommodityKind::MaslinSheaves,
    ]
    .into_iter()
    .any(|sheaves| {
        let grain = crop_grain_for_sheaves(sheaves);
        let stock = building_commodity_stock(building, grain);
        let reserve = seed_reserves.for_commodity(grain);
        building_commodity_stock(building, sheaves) > 1e-6
            && building_commodity_room(building, grain) > 1e-6
            && (stock + 1e-6 < reserve
                || farmstead_exportable_grain(stock, reserve) + 1e-6 < GRAIN_TRANSFER_PER_TRIP)
    })
}

pub fn step_watermill(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    environment: EnvironmentState,
    building: Building,
) {
    let tools_maintained = civilian_tools_maintained(building.ironwork);
    let throughput_multiplier = environment.watermill_throughput_multiplier()
        * civilian_tool_throughput_multiplier(building.ironwork);
    let flour_before = flour_bulk_stock(&building);
    let output_per_cycle = selected_mill_recipe(&building)
        .map(|(_, _, output)| output)
        .unwrap_or(WATERMILL_RYE_FLOUR_PER_CYCLE);
    let mut mill = building;
    if let Some((grain, flour, flour_output)) = selected_mill_recipe(&mill) {
        mill = step_processor_at_rate(
            ctx,
            tick,
            clock,
            mill,
            &[(grain, WATERMILL_GRAIN_PER_CYCLE)],
            &[(flour, flour_output)],
            throughput_multiplier,
        );
    }
    let flour_after = flour_bulk_stock(&mill);
    if tools_maintained && flour_after > flour_before + 1e-6 {
        let completed_cycle_share =
            ((flour_after - flour_before) / output_per_cycle).clamp(0.0, 1.0);
        charge_completed_production_maintenance(
            &mut mill,
            CIVILIAN_TOOL_IRONWORK_PER_CYCLE * completed_cycle_share,
        );
    }
    dispatch_typed_flour(ctx, tick, clock, &mut mill);
    ctx.db.building().id().update(mill);
}

pub fn step_windmill(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    environment: EnvironmentState,
    world_seed: u64,
    building: Building,
) {
    let tools_maintained = civilian_tools_maintained(building.ironwork);
    let wind_throughput = crate::wind_policy::windmill_throughput_multiplier(
        world_seed,
        building.x,
        building.z,
        environment.weather,
    );
    let throughput_multiplier =
        wind_throughput * civilian_tool_throughput_multiplier(building.ironwork);
    let flour_before = flour_bulk_stock(&building);
    let output_per_cycle = selected_mill_recipe(&building)
        .map(|(_, _, output)| output)
        .unwrap_or(WATERMILL_RYE_FLOUR_PER_CYCLE);
    let mut mill = building;
    if let Some((grain, flour, flour_output)) = selected_mill_recipe(&mill) {
        mill = step_processor_at_rate(
            ctx,
            tick,
            clock,
            mill,
            &[(grain, WATERMILL_GRAIN_PER_CYCLE)],
            &[(flour, flour_output)],
            throughput_multiplier,
        );
    }
    let flour_after = flour_bulk_stock(&mill);
    if tools_maintained && flour_after > flour_before + 1e-6 {
        let completed_cycle_share =
            ((flour_after - flour_before) / output_per_cycle).clamp(0.0, 1.0);
        charge_completed_production_maintenance(
            &mut mill,
            CIVILIAN_TOOL_IRONWORK_PER_CYCLE * completed_cycle_share,
        );
    }
    dispatch_typed_flour(ctx, tick, clock, &mut mill);
    ctx.db.building().id().update(mill);
}

fn selected_mill_recipe(mill: &Building) -> Option<(CommodityKind, CommodityKind, f64)> {
    let mut recipes = [
        (
            CommodityKind::RyeGrain,
            CommodityKind::RyeFlour,
            WATERMILL_RYE_FLOUR_PER_CYCLE,
        ),
        (
            CommodityKind::MaslinGrain,
            CommodityKind::MaslinFlour,
            WATERMILL_MASLIN_FLOUR_PER_CYCLE,
        ),
    ];
    recipes.sort_by(|(left, _, _), (right, _, _)| {
        building_commodity_stock(mill, *right)
            .partial_cmp(&building_commodity_stock(mill, *left))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    recipes.into_iter().find(|(grain, flour, _)| {
        building_commodity_stock(mill, *grain) > 1e-6
            && building_commodity_room(mill, *flour) > 1e-6
    })
}

fn selected_bakery_recipe(bakery: &Building) -> Option<(CommodityKind, CommodityKind, f64)> {
    let mut recipes = [
        (
            CommodityKind::RyeFlour,
            CommodityKind::RyeBread,
            BAKERY_RYE_BREAD_PER_CYCLE,
        ),
        (
            CommodityKind::MaslinFlour,
            CommodityKind::MaslinBread,
            BAKERY_MASLIN_BREAD_PER_CYCLE,
        ),
    ];
    recipes.sort_by(|(left, _, _), (right, _, _)| {
        building_commodity_stock(bakery, *right)
            .partial_cmp(&building_commodity_stock(bakery, *left))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    recipes.into_iter().find(|(flour, bread, _)| {
        building_commodity_stock(bakery, *flour) > 1e-6
            && building_commodity_room(bakery, *bread) > 1e-6
    })
}

fn dispatch_typed_flour(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    source: &mut Building,
) {
    let mut flours = [CommodityKind::RyeFlour, CommodityKind::MaslinFlour];
    flours.sort_by(|left, right| {
        building_commodity_stock(source, *right)
            .partial_cmp(&building_commodity_stock(source, *left))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    for flour in flours {
        dispatch_to_building(ctx, tick, clock, source, flour, &["bakery", "granary"]);
    }
}

pub fn step_industrial_firewood_dispatch(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    sources: Vec<Building>,
) {
    for mut source in sources {
        if !source.construction_complete
            || tick.building_disabled_by_fire(ctx, source.id)
            || source.firewood <= 1e-6
            || !matches!(
                source.kind.as_str(),
                "woodcutters_lodge" | "village_storehouse"
            )
        {
            continue;
        }
        dispatch_to_building_where(
            ctx,
            tick,
            clock,
            &mut source,
            CommodityKind::Firewood,
            INDUSTRIAL_FIREWOOD_TARGET_KINDS,
            |target| target.assigned_labor > 0,
        );
        ctx.db.building().id().update(source);
    }
}

/// Every free Trading Post cart arbitrates imported production inputs and civic
/// supplies across eligible destinations on its owner's road network. Work
/// priority and remaining cycle runway decide which destinations receive the
/// available carts, while route distance decides which post should serve an
/// equal need. Neither construction order nor update order can reserve a need
/// before the settlement-wide match is considered.
///
/// Regional trade, named household orders, and seed-grain recovery run before
/// this pass and retain first claim on the same physical broker cart.
pub fn step_marketplace_material_dispatch(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    marketplaces: Vec<Building>,
) {
    let mut candidates = Vec::new();

    for marketplace in marketplaces {
        if marketplace.kind != "trading_post"
            || !marketplace.construction_complete
            || marketplace.assigned_labor == 0
            || tick.building_disabled_by_fire(ctx, marketplace.id)
            || labor_and_logistics_paused(ctx, tick, marketplace.owner, clock)
            || building_has_active_trip(ctx, marketplace.id)
        {
            continue;
        }
        let Some(network) = tick.road_network(marketplace.owner) else {
            continue;
        };
        const DISPATCHABLE_INPUTS: [CommodityKind; 33] = [
            CommodityKind::RyeSheaves,
            CommodityKind::OatSheaves,
            CommodityKind::BarleySheaves,
            CommodityKind::MaslinSheaves,
            CommodityKind::RyeGrain,
            CommodityKind::OatGrain,
            CommodityKind::MaslinGrain,
            CommodityKind::RyeFlour,
            CommodityKind::MaslinFlour,
            CommodityKind::Barley,
            CommodityKind::Malt,
            CommodityKind::Meat,
            CommodityKind::Fish,
            CommodityKind::Milk,
            CommodityKind::Wool,
            CommodityKind::Flax,
            CommodityKind::Yarn,
            CommodityKind::Linen,
            CommodityKind::Ironwork,
            CommodityKind::Clay,
            CommodityKind::Charcoal,
            CommodityKind::Pottery,
            CommodityKind::Firewood,
            CommodityKind::Water,
            CommodityKind::Iron,
            CommodityKind::Salt,
            CommodityKind::Grapes,
            CommodityKind::Manure,
            CommodityKind::Polearms,
            CommodityKind::Wine,
            CommodityKind::Apples,
            CommodityKind::Honey,
            CommodityKind::Wax,
        ];
        candidates.extend(
            tick.building_ids_for_kinds(ctx, marketplace.owner, MARKETPLACE_MATERIAL_TARGET_KINDS)
                .into_iter()
                .filter_map(|target_id| ctx.db.building().id().find(&target_id))
                .filter_map(|building| {
                    if !building.construction_complete
                        || building.assigned_labor == 0
                        || tick.building_disabled_by_fire(ctx, building.id)
                        || building_has_inbound_supply_trip(ctx, building.id)
                    {
                        return None;
                    }
                    local_delivery_distance(
                        network,
                        marketplace.x,
                        marketplace.z,
                        building.x,
                        building.z,
                    )
                    .filter(|distance| distance.is_finite())
                    .map(|distance| (building, distance))
                })
                .flat_map(|(building, distance)| {
                    DISPATCHABLE_INPUTS
                        .into_iter()
                        .map(move |commodity| (building.clone(), commodity, distance))
                })
                .filter_map(|(building, commodity, distance)| {
                    let Some((per_cycle, desired_stock)) =
                        marketplace_material_target(ctx, tick, &building, commodity)
                    else {
                        return None;
                    };
                    if !processor_accepts_input(&building, commodity)
                        || building_commodity_stock(&marketplace, commodity) <= 1e-6
                        || trading_post_exports_commodity(ctx, marketplace.id, commodity)
                    {
                        return None;
                    }
                    let stock = building_commodity_stock(&building, commodity);
                    if desired_stock <= 1e-6
                        || stock + 1e-6 >= desired_stock
                        || building_commodity_room(&building, commodity) <= 1e-6
                    {
                        return None;
                    }
                    Some(RoutedMarketplaceMaterialTarget {
                        source_id: marketplace.id,
                        duty: processor_input_dispatch_duty(
                            building.assigned_labor,
                            stock,
                            per_cycle,
                            processor_input_target_percent_for_building(&building, commodity),
                        ),
                        runway_cycles: processor_input_runway_cycles(stock, per_cycle),
                        building,
                        commodity,
                        distance,
                    })
                }),
        );
    }

    candidates.sort_by(|a, b| {
        compare_processor_input_dispatch_candidates(
            a.duty,
            CONSTRUCTION_PRIORITY_NORMAL,
            textile_input_preference_rank(&a.building, a.commodity),
            a.runway_cycles,
            a.distance,
            a.building.id,
            b.duty,
            CONSTRUCTION_PRIORITY_NORMAL,
            textile_input_preference_rank(&b.building, b.commodity),
            b.runway_cycles,
            b.distance,
            b.building.id,
        )
        .then_with(|| {
            marketplace_material_commodity_rank(a.commodity)
                .cmp(&marketplace_material_commodity_rank(b.commodity))
        })
        .then_with(|| a.source_id.cmp(&b.source_id))
    });

    let mut used_sources = HashSet::new();
    let mut used_targets = HashSet::new();
    for candidate in candidates {
        if used_sources.contains(&candidate.source_id)
            || used_targets.contains(&candidate.building.id)
        {
            continue;
        }
        let Some(mut marketplace) = ctx.db.building().id().find(&candidate.source_id) else {
            continue;
        };
        let Some(target) = ctx.db.building().id().find(&candidate.building.id) else {
            continue;
        };
        if marketplace.kind != "trading_post"
            || !marketplace.construction_complete
            || marketplace.assigned_labor == 0
            || target.owner != marketplace.owner
            || !target.construction_complete
            || target.assigned_labor == 0
            || tick.building_disabled_by_fire(ctx, marketplace.id)
            || tick.building_disabled_by_fire(ctx, target.id)
            || labor_and_logistics_paused(ctx, tick, marketplace.owner, clock)
            || building_has_active_trip(ctx, marketplace.id)
            || building_has_inbound_supply_trip(ctx, target.id)
            || !processor_requests_input(&target, candidate.commodity)
            || !processor_accepts_input(&target, candidate.commodity)
            || trading_post_exports_commodity(ctx, marketplace.id, candidate.commodity)
        {
            continue;
        }
        let Some((_per_cycle, desired_stock)) =
            marketplace_material_target(ctx, tick, &target, candidate.commodity)
        else {
            continue;
        };
        let source_stock = building_commodity_stock(&marketplace, candidate.commodity);
        let needed = (desired_stock - building_commodity_stock(&target, candidate.commodity))
            .max(0.0)
            .min(source_stock)
            .min(building_commodity_room(&target, candidate.commodity));
        if needed <= 1e-6 {
            continue;
        }
        let Some(network) = tick.road_network(marketplace.owner) else {
            continue;
        };
        if try_start_building_supply_trip(
            ctx,
            tick,
            clock,
            network,
            &mut marketplace,
            &target,
            1,
            candidate.commodity,
            TIMBER_DELIVERY_SPEED_MPS,
            TIMBER_DELIVERY_UNLOAD_SEC,
            commodity_transfer_per_trip(candidate.commodity),
            needed,
        ) {
            used_sources.insert(marketplace.id);
            used_targets.insert(target.id);
            ctx.db.building().id().update(marketplace);
        }
    }
}

fn marketplace_material_commodity_rank(commodity: CommodityKind) -> u8 {
    match commodity {
        CommodityKind::Meat | CommodityKind::Fish | CommodityKind::Milk => 0,
        CommodityKind::RyeGrain
        | CommodityKind::OatGrain
        | CommodityKind::MaslinGrain
        | CommodityKind::RyeFlour
        | CommodityKind::MaslinFlour
        | CommodityKind::Barley
        | CommodityKind::Malt
        | CommodityKind::Grapes => 1,
        CommodityKind::Firewood | CommodityKind::Water => 2,
        CommodityKind::Iron | CommodityKind::Salt | CommodityKind::Charcoal => 3,
        CommodityKind::Wool | CommodityKind::Flax | CommodityKind::Yarn | CommodityKind::Linen => 4,
        CommodityKind::Clay | CommodityKind::Pottery => 5,
        CommodityKind::Manure | CommodityKind::Polearms => 6,
        CommodityKind::Wine => 7,
        CommodityKind::Ironwork => 8,
        _ => 9,
    }
}

fn textile_input_preference_rank(target: &Building, commodity: CommodityKind) -> u8 {
    if !matches!(target.kind.as_str(), "spinning_retting_house" | "weaver") {
        return 0;
    }
    match commodity {
        CommodityKind::Wool | CommodityKind::Yarn => {
            weaver_fibre_delivery_preference_rank(target.weaver_input_policy, false)
        }
        CommodityKind::Flax | CommodityKind::Linen => {
            weaver_fibre_delivery_preference_rank(target.weaver_input_policy, true)
        }
        _ => 0,
    }
}

fn marketplace_material_target(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    target: &Building,
    commodity: CommodityKind,
) -> Option<(f64, f64)> {
    if !processor_requests_input(target, commodity) {
        return None;
    }
    if target.kind == "smithy" && commodity == CommodityKind::Charcoal {
        if target.assigned_labor == 0 {
            return None;
        }
        let desired = smithy_charcoal_refill_target(target.charcoal)?
            .min(building_commodity_cap(&target.kind, commodity));
        return (desired > target.charcoal + 1e-6).then_some((SMITHY_CHARCOAL_PER_CYCLE, desired));
    }
    if target.kind == "threshing_barn" && commodity == CommodityKind::Manure {
        let (requirement, _) = tick.farmstead_manure_requirement_for(ctx, target.owner, target.id);
        let desired = requirement.min(building_commodity_cap(&target.kind, commodity));
        return (desired > 1e-6).then_some((1.0, desired));
    }
    let per_cycle = directly_dispatched_processor_input_per_cycle(&target.kind, commodity);
    if per_cycle <= 1e-6 {
        return None;
    }
    Some((
        per_cycle,
        processor_input_target_for_building(target, commodity, per_cycle),
    ))
}

/// Match local or imported raw iron, salt, clay, charcoal, ironwork, and pottery
/// after every producer has completed this tick's work. Active processor buffers still
/// lead by player priority and runway; among equal needs, the shortest
/// source-to-target road decides which producer cart serves the destination.
/// Each source and target receives at most one assignment per pass.
pub fn step_local_material_dispatch(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    environment: EnvironmentState,
    sources: Vec<Building>,
) {
    let mut candidates = Vec::new();
    let market_fuel_shortfalls = marketplace_fuel_shortfalls(ctx, tick, environment);

    for source in &sources {
        if !LOCAL_MATERIAL_SOURCE_KINDS.contains(&source.kind.as_str())
            || !source.construction_complete
            || tick.building_disabled_by_fire(ctx, source.id)
            || (source.kind == "village_storehouse" && source.assigned_labor == 0)
            || labor_and_logistics_paused(ctx, tick, source.owner, clock)
            || building_has_active_trip(ctx, source.id)
        {
            continue;
        }
        let Some(network) = tick.road_network(source.owner) else {
            continue;
        };
        for &commodity in LOCAL_MATERIAL_COMMODITIES {
            if source.kind == "trading_post"
                && trading_post_exports_commodity(ctx, source.id, commodity)
            {
                continue;
            }
            let Some(target_kinds) = local_material_target_kinds(source, commodity) else {
                continue;
            };
            if building_commodity_stock(source, commodity) <= 1e-6 {
                continue;
            }
            for target_id in tick.building_ids_for_kinds(ctx, source.owner, target_kinds) {
                let Some(target) = ctx.db.building().id().find(&target_id) else {
                    continue;
                };
                if target.id == source.id
                    || target.kind == "trading_post"
                    || !target.construction_complete
                    || tick.building_disabled_by_fire(ctx, target.id)
                    || !processor_requests_input(&target, commodity)
                    || !processor_accepts_input(&target, commodity)
                    || !extraction_accepts_maintenance_input(ctx, &target, commodity)
                    || building_commodity_room(&target, commodity) <= 1e-6
                    || building_has_inbound_supply_trip(ctx, target.id)
                {
                    continue;
                }
                let target_plan = if target.kind == "village_storehouse"
                    && commodity == CommodityKind::Charcoal
                {
                    storehouse_charcoal_transit_plan(ctx, tick, &target, &market_fuel_shortfalls)
                } else {
                    local_material_target_plan(&target, commodity)
                };
                let Some((duty, desired_stock, runway_cycles)) = target_plan else {
                    continue;
                };
                let Some(distance) =
                    local_delivery_distance(network, source.x, source.z, target.x, target.z)
                else {
                    continue;
                };
                if !distance.is_finite() {
                    continue;
                }
                let candidate = LocalMaterialDispatchCandidate {
                    source_id: source.id,
                    building: target,
                    commodity,
                    distance,
                    duty,
                    desired_stock,
                    runway_cycles,
                };
                candidates.push(candidate);
            }
        }
    }

    sort_local_material_candidates(&mut candidates);

    let mut used_sources = HashSet::new();
    let mut used_targets = HashSet::new();
    dispatch_local_material_candidates(
        ctx,
        tick,
        clock,
        candidates,
        &mut used_sources,
        &mut used_targets,
    );
}

fn sort_local_material_candidates(candidates: &mut [LocalMaterialDispatchCandidate]) {
    candidates.sort_by(|a, b| {
        compare_processor_input_dispatch_candidates(
            a.duty,
            CONSTRUCTION_PRIORITY_NORMAL,
            textile_input_preference_rank(&a.building, a.commodity),
            a.runway_cycles,
            a.distance,
            a.building.id,
            b.duty,
            CONSTRUCTION_PRIORITY_NORMAL,
            textile_input_preference_rank(&b.building, b.commodity),
            b.runway_cycles,
            b.distance,
            b.building.id,
        )
        .then_with(|| a.source_id.cmp(&b.source_id))
    });
}

fn dispatch_local_material_candidates(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    candidates: Vec<LocalMaterialDispatchCandidate>,
    used_sources: &mut HashSet<u64>,
    used_targets: &mut HashSet<u64>,
) {
    for candidate in candidates {
        if used_sources.contains(&candidate.source_id)
            || used_targets.contains(&candidate.building.id)
        {
            continue;
        }
        let Some(mut source) = ctx.db.building().id().find(&candidate.source_id) else {
            continue;
        };
        let Some(target) = ctx.db.building().id().find(&candidate.building.id) else {
            continue;
        };
        let commodity = candidate.commodity;
        let Some(target_kinds) = local_material_target_kinds(&source, commodity) else {
            continue;
        };
        if !source.construction_complete
            || !target.construction_complete
            || target.owner != source.owner
            || !target_kinds.contains(&target.kind.as_str())
            || tick.building_disabled_by_fire(ctx, source.id)
            || tick.building_disabled_by_fire(ctx, target.id)
            || labor_and_logistics_paused(ctx, tick, source.owner, clock)
            || building_has_active_trip(ctx, source.id)
            || building_has_inbound_supply_trip(ctx, target.id)
            || (source.kind == "trading_post"
                && trading_post_exports_commodity(ctx, source.id, commodity))
            || target.kind == "trading_post"
            || !processor_requests_input(&target, commodity)
            || !processor_accepts_input(&target, commodity)
            || !extraction_accepts_maintenance_input(ctx, &target, commodity)
        {
            continue;
        }
        let desired_stock =
            if target.kind == "village_storehouse" && commodity == CommodityKind::Charcoal {
                if target.assigned_labor == 0
                    || !storage_accepts_commodity(&target, CommodityKind::Charcoal)
                {
                    continue;
                }
                candidate.desired_stock
            } else {
                let Some((_duty, desired_stock, _runway_cycles)) =
                    local_material_target_plan(&target, commodity)
                else {
                    continue;
                };
                desired_stock
            };
        let stock = building_commodity_stock(&target, commodity);
        let unreserved_stock = if commodity == CommodityKind::Ironwork {
            available_unreserved_building_ironwork(ctx, source.owner)
        } else {
            f64::INFINITY
        };
        let needed = (desired_stock - stock)
            .max(0.0)
            .min(building_commodity_stock(&source, commodity))
            .min(building_commodity_room(&target, commodity))
            .min(unreserved_stock);
        if needed <= 1e-6 {
            continue;
        }
        let Some(network) = tick.road_network(source.owner) else {
            continue;
        };
        if try_start_building_supply_trip(
            ctx,
            tick,
            clock,
            network,
            &mut source,
            &target,
            1,
            commodity,
            TIMBER_DELIVERY_SPEED_MPS,
            TIMBER_DELIVERY_UNLOAD_SEC,
            commodity_transfer_per_trip(commodity),
            needed,
        ) {
            used_sources.insert(source.id);
            used_targets.insert(target.id);
            ctx.db.building().id().update(source);
        }
    }
}

const LOCAL_MATERIAL_COMMODITIES: &[CommodityKind] = &[
    CommodityKind::Wool,
    CommodityKind::Flax,
    CommodityKind::Yarn,
    CommodityKind::Linen,
    CommodityKind::Iron,
    CommodityKind::Salt,
    CommodityKind::Clay,
    CommodityKind::Charcoal,
    CommodityKind::Ironwork,
    CommodityKind::Pottery,
    CommodityKind::Pelts,
    CommodityKind::Hides,
    CommodityKind::Leather,
    CommodityKind::Shoes,
    CommodityKind::Wax,
];

fn local_material_target_kinds(
    source: &Building,
    commodity: CommodityKind,
) -> Option<&'static [&'static str]> {
    match (source.kind.as_str(), commodity) {
        ("stone_quarry" | "mine", CommodityKind::Iron) => Some(&["smithy", "trading_post"]),
        ("stone_quarry" | "mine", CommodityKind::Salt) => {
            Some(&["smokehouse", "pastoral_farmstead", "trading_post"])
        }
        ("stone_quarry" | "mine", CommodityKind::Clay) => Some(&["potter_kiln"]),
        ("charcoal_burner", CommodityKind::Charcoal) => Some(&["smithy", "village_storehouse"]),
        ("smithy", CommodityKind::Ironwork) => Some(&[
            "lumber_mill",
            "woodcutters_lodge",
            "stone_quarry",
            "large_quarry",
            "mine",
            "threshing_barn",
            "watermill",
            "windmill",
            "carpenter",
        ]),
        ("potter_kiln", CommodityKind::Pottery) => Some(&["village_storehouse", "trading_post"]),
        ("spinning_retting_house", CommodityKind::Yarn | CommodityKind::Linen) => {
            Some(&["weaver", "village_storehouse"])
        }
        ("hunters_hall", CommodityKind::Pelts) => Some(&["village_storehouse", "trading_post"]),
        ("pastoral_farmstead", CommodityKind::Hides) => {
            Some(&["tannery", "village_storehouse", "trading_post"])
        }
        ("marketplace", CommodityKind::Hides) => {
            Some(&["tannery", "village_storehouse", "trading_post"])
        }
        ("tannery", CommodityKind::Leather) => {
            Some(&["cobbler", "village_storehouse", "trading_post"])
        }
        ("cobbler", CommodityKind::Shoes) => Some(&["village_storehouse", "trading_post"]),
        ("trading_post", CommodityKind::Iron) => Some(&["smithy"]),
        ("trading_post", CommodityKind::Salt) => Some(&["smokehouse", "pastoral_farmstead"]),
        ("trading_post", CommodityKind::Clay) => Some(&["potter_kiln"]),
        ("trading_post", CommodityKind::Charcoal) => Some(&["smithy"]),
        ("trading_post", CommodityKind::Ironwork) => Some(&[
            "lumber_mill",
            "woodcutters_lodge",
            "stone_quarry",
            "large_quarry",
            "mine",
            "threshing_barn",
            "watermill",
            "windmill",
            "carpenter",
        ]),
        ("trading_post", CommodityKind::Pottery) => Some(&["village_storehouse"]),
        ("trading_post", CommodityKind::Wool | CommodityKind::Flax) => {
            Some(&["spinning_retting_house", "village_storehouse"])
        }
        ("trading_post", CommodityKind::Yarn | CommodityKind::Linen) => {
            Some(&["weaver", "village_storehouse"])
        }
        ("trading_post", CommodityKind::Pelts) => Some(&["village_storehouse"]),
        ("trading_post", CommodityKind::Hides) => Some(&["tannery", "village_storehouse"]),
        ("trading_post", CommodityKind::Leather) => Some(&["cobbler", "village_storehouse"]),
        ("trading_post", CommodityKind::Shoes) => Some(&["village_storehouse"]),
        ("trading_post", CommodityKind::Wax) => Some(&["chandlery", "village_storehouse"]),
        // Intake policy blocks new arrivals; it never strands material already
        // held by the depot, so every supported stored input remains dispatchable.
        ("village_storehouse", CommodityKind::Iron) => Some(&["smithy", "trading_post"]),
        ("village_storehouse", CommodityKind::Clay) => Some(&["potter_kiln"]),
        ("village_storehouse", CommodityKind::Salt) => {
            Some(&["smokehouse", "pastoral_farmstead", "trading_post"])
        }
        ("village_storehouse", CommodityKind::Charcoal) => Some(&["smithy"]),
        ("village_storehouse", CommodityKind::Wool) => Some(&["spinning_retting_house"]),
        ("village_storehouse", CommodityKind::Yarn | CommodityKind::Linen) => Some(&["weaver"]),
        ("village_storehouse", CommodityKind::Pelts) => Some(&["trading_post"]),
        ("village_storehouse", CommodityKind::Hides) => Some(&["tannery", "trading_post"]),
        ("village_storehouse", CommodityKind::Leather) => Some(&["cobbler", "trading_post"]),
        ("village_storehouse", CommodityKind::Wax) => Some(&["chandlery", "trading_post"]),
        _ => None,
    }
}

fn local_material_target_plan(
    target: &Building,
    commodity: CommodityKind,
) -> Option<(ProcessorInputDispatchDuty, f64, f64)> {
    if target.kind == "smithy" && commodity == CommodityKind::Charcoal {
        if target.assigned_labor == 0 {
            return None;
        }
        let stock = target.charcoal;
        let desired = smithy_charcoal_refill_target(stock)?
            .min(building_commodity_cap(&target.kind, commodity));
        return (desired > stock + 1e-6).then_some((
            ProcessorInputDispatchDuty::WorkingBuffer,
            desired,
            processor_input_runway_cycles(stock, SMITHY_CHARCOAL_PER_CYCLE),
        ));
    }
    let commodity_name = match commodity {
        CommodityKind::Wool => "wool",
        CommodityKind::Flax => "flax",
        CommodityKind::Yarn => "yarn",
        CommodityKind::Linen => "linen",
        CommodityKind::Iron => "iron",
        CommodityKind::Salt => "salt",
        CommodityKind::Clay => "clay",
        CommodityKind::Charcoal => "charcoal",
        CommodityKind::Ironwork => "ironwork",
        CommodityKind::Pottery => "pottery",
        CommodityKind::Pelts => "pelts",
        CommodityKind::Hides => "hides",
        CommodityKind::Leather => "leather",
        CommodityKind::Shoes => "shoes",
        CommodityKind::Wax => "wax",
        _ => return None,
    };
    let stock = building_commodity_stock(target, commodity);
    let capacity = building_commodity_cap(&target.kind, commodity);
    let marketplace_reserve_target = if target.kind == "trading_post" {
        match commodity {
            CommodityKind::Iron => {
                normalize_marketplace_iron_target(target.marketplace_iron_target) as f64
            }
            CommodityKind::Salt => {
                normalize_marketplace_salt_target(target.marketplace_salt_target) as f64
            }
            _ => 0.0,
        }
    } else {
        0.0
    };
    let (duty, desired_stock) = local_material_dispatch_target(
        &target.kind,
        commodity_name,
        target.assigned_labor,
        stock,
        capacity,
        processor_input_target_percent_for_building(target, commodity),
        marketplace_reserve_target,
    )?;
    let per_cycle = directly_dispatched_processor_input_per_cycle(&target.kind, commodity);
    let runway_cycles =
        if commodity == CommodityKind::Ironwork && is_civilian_tool_site(&target.kind) {
            civilian_tool_runway_cycles(stock)
        } else {
            processor_input_runway_cycles(stock, per_cycle)
        };
    Some((duty, desired_stock, runway_cycles))
}

fn marketplace_fuel_shortfalls(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    environment: EnvironmentState,
) -> HashMap<u64, f64> {
    let mut covered_households = HashMap::<u64, u32>::new();
    for residence in ctx.db.residence().iter().filter(|residence| {
        !residence.abandoned
            && residence.population > 0
            && !tick.residence_disabled_by_fire(ctx, residence.id)
    }) {
        if let Some(market_id) = tick.local_marketplace_for_residence_deposit(
            ctx,
            residence.owner,
            residence.id,
            ResidenceNeedKind::Firewood,
        ) {
            let household_count = covered_households.entry(market_id).or_default();
            *household_count = household_count.saturating_add(1);
        }
    }
    covered_households
        .into_iter()
        .filter_map(|(market_id, household_count)| {
            let market = ctx.db.building().id().find(&market_id)?;
            if building_has_inbound_commodity_trip(ctx, market.id, CommodityKind::Firewood)
                || building_has_inbound_commodity_trip(ctx, market.id, CommodityKind::Charcoal)
            {
                return None;
            }
            let target = marketplace_fuel_reserve_target_for_households(
                household_count,
                environment.firewood_demand_multiplier(),
                building_commodity_cap(&market.kind, CommodityKind::Firewood),
                building_commodity_cap(&market.kind, CommodityKind::Charcoal),
            );
            let shortfall =
                (target - combined_fuel_equivalent(market.firewood, market.charcoal)).max(0.0);
            (shortfall > 1e-6).then_some((market_id, shortfall))
        })
        .collect()
}

fn storehouse_charcoal_transit_plan(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    storehouse: &Building,
    market_shortfalls: &HashMap<u64, f64>,
) -> Option<(ProcessorInputDispatchDuty, f64, f64)> {
    if storehouse.assigned_labor == 0
        || !storage_accepts_commodity(storehouse, CommodityKind::Charcoal)
    {
        return None;
    }
    let network = tick.road_network(storehouse.owner)?;
    let has_linked_market_shortfall = market_shortfalls.iter().any(|(market_id, shortfall)| {
        if *shortfall <= 1e-6 {
            return false;
        }
        ctx.db
            .building()
            .id()
            .find(market_id)
            .is_some_and(|market| {
                market.owner == storehouse.owner
                    && local_delivery_distance(
                        network,
                        storehouse.x,
                        storehouse.z,
                        market.x,
                        market.z,
                    )
                    .is_some()
            })
    });
    let has_linked_export_post = tick
        .building_ids_for_kinds(ctx, storehouse.owner, &["trading_post"])
        .into_iter()
        .filter_map(|id| ctx.db.building().id().find(&id))
        .any(|post| {
            post.construction_complete
                && !tick.building_disabled_by_fire(ctx, post.id)
                && trading_post_exports_commodity(ctx, post.id, CommodityKind::Charcoal)
                && local_delivery_distance(network, storehouse.x, storehouse.z, post.x, post.z)
                    .is_some()
        });
    if !has_linked_market_shortfall && !has_linked_export_post {
        return None;
    }
    let desired = storehouse_stock_target(
        building_commodity_cap(&storehouse.kind, CommodityKind::Charcoal),
        storehouse.storehouse_charcoal_target_percent,
    );
    (storehouse.charcoal + 1e-6 < desired).then_some((
        ProcessorInputDispatchDuty::WorkshopOverflow,
        desired,
        0.0,
    ))
}

pub fn step_mine(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    building: Building,
) {
    let Some(commodity) = mineworks_commodity_beneath(ctx, building.x, building.z) else {
        return;
    };
    let base_batch = match commodity {
        CommodityKind::Iron => MINE_IRON_PER_CYCLE,
        CommodityKind::Salt => MINE_SALT_PER_CYCLE,
        CommodityKind::Clay => MINE_CLAY_PER_CYCLE,
        _ => return,
    };
    let output_headroom = building_commodity_room(&building, commodity);
    if output_headroom > 1e-6 {
        request_connected_commodity(
            ctx,
            tick,
            clock,
            &building,
            CommodityKind::Timber,
            &["lumber_mill", "village_storehouse"],
            rich_mine_support_target(),
        );
    }
    if !rich_mine_supports_ready(building.timber) {
        ctx.db.building().id().update(building);
        return;
    }
    let tools_maintained = civilian_tools_maintained(building.ironwork);
    let tool_throughput = civilian_tool_throughput_multiplier(building.ironwork);
    let before = building_commodity_stock(&building, commodity);
    let mut mine = step_simple_producer_at_rate(
        ctx,
        tick,
        clock,
        building,
        &[(commodity, base_batch)],
        RICH_MINE_THROUGHPUT_MULTIPLIER * tool_throughput,
    );
    let produced = (building_commodity_stock(&mine, commodity) - before).max(0.0);
    if produced > 1e-6 {
        withdraw_building_commodity(
            &mut mine,
            CommodityKind::Timber,
            MINE_TIMBER_SUPPORT_PER_CYCLE * produced / base_batch,
        );
    }
    if tools_maintained && produced > 1e-6 {
        charge_completed_production_maintenance(
            &mut mine,
            CIVILIAN_TOOL_IRONWORK_PER_CYCLE * produced / base_batch,
        );
    }
    ctx.db.building().id().update(mine);
}

fn mineworks_commodity_beneath(ctx: &ReducerContext, x: f64, z: f64) -> Option<CommodityKind> {
    const CENTER_TOLERANCE: f64 = 2.5;
    let tolerance_sq = CENTER_TOLERANCE * CENTER_TOLERANCE;
    ctx.db
        .quarry()
        .iter()
        .find_map(|deposit| {
            ((deposit.x - x) * (deposit.x - x) + (deposit.z - z) * (deposit.z - z) <= tolerance_sq)
                .then(|| mineworks_geological_commodity(&deposit.quarry_id, deposit.is_rich))
                .flatten()
        })
        .or_else(|| {
            ctx.db.foraging_node().iter().find_map(|deposit| {
                ((deposit.x - x) * (deposit.x - x) + (deposit.z - z) * (deposit.z - z)
                    <= tolerance_sq)
                    .then(|| mineworks_clay_commodity(&deposit.node_kind, &deposit.node_id))
                    .flatten()
            })
        })
}

pub fn step_granary(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    building: Building,
) {
    let mut granary = building;
    let grain_dispatch = next_granary_grain_dispatch(ctx, tick, clock, &granary);
    let grain_is_critical = grain_dispatch
        .as_ref()
        .is_some_and(|dispatch| dispatch.runway_cycles < GRAIN_CRITICAL_RUNWAY_CYCLES);
    if grain_is_critical {
        if let Some(dispatch) = grain_dispatch.as_ref() {
            dispatch_granary_grain(ctx, tick, clock, &mut granary, dispatch);
        }
    }
    // Once urgent milling grain is covered, granary keepers replenish the
    // workshops that consume centralized farm goods.
    for flour in [CommodityKind::RyeFlour, CommodityKind::MaslinFlour] {
        dispatch_to_building(ctx, tick, clock, &mut granary, flour, &["bakery"]);
    }
    dispatch_to_building(
        ctx,
        tick,
        clock,
        &mut granary,
        CommodityKind::Barley,
        &["brewery"],
    );
    dispatch_to_building(
        ctx,
        tick,
        clock,
        &mut granary,
        CommodityKind::Flax,
        &["spinning_retting_house"],
    );
    for duty in granary_dispatch_order(true) {
        match duty {
            GranaryDispatchDuty::Households => {
                // Oats are ready household food after threshing, but the
                // granary's protected seed floor must remain untouchable.
                let oat_surplus = granary_typed_grain_surplus(&granary, CommodityKind::OatGrain);
                dispatch_to_building_where_limited(
                    ctx,
                    tick,
                    clock,
                    &mut granary,
                    CommodityKind::OatGrain,
                    &["marketplace"],
                    oat_surplus,
                    |_| true,
                );
                for commodity in [
                    CommodityKind::Meat,
                    CommodityKind::Fish,
                    CommodityKind::Milk,
                    CommodityKind::Mushrooms,
                    CommodityKind::Berries,
                    CommodityKind::Grapes,
                    CommodityKind::Cherries,
                    CommodityKind::Apples,
                    CommodityKind::Pears,
                    CommodityKind::Aronia,
                    CommodityKind::Rosehips,
                    CommodityKind::Cabbage,
                    CommodityKind::Carrots,
                    CommodityKind::Beetroot,
                    CommodityKind::Eggs,
                    CommodityKind::RyeBread,
                    CommodityKind::MaslinBread,
                    CommodityKind::Cheese,
                    CommodityKind::SmokedFish,
                    CommodityKind::CuredMeat,
                    CommodityKind::Jam,
                    CommodityKind::Honey,
                    CommodityKind::Wine,
                ] {
                    dispatch_to_building(
                        ctx,
                        tick,
                        clock,
                        &mut granary,
                        commodity,
                        &["marketplace"],
                    );
                }
                dispatch_to_building(
                    ctx,
                    tick,
                    clock,
                    &mut granary,
                    CommodityKind::Ale,
                    &["tavern"],
                );
                for beverage in [
                    CommodityKind::Cider,
                    CommodityKind::Mead,
                ] {
                    dispatch_to_building(ctx, tick, clock, &mut granary, beverage, &["tavern"]);
                }
            }
            GranaryDispatchDuty::Preservation => {
                for commodity in [
                    CommodityKind::Meat,
                    CommodityKind::Fish,
                    CommodityKind::Milk,
                ] {
                    dispatch_to_building(
                        ctx,
                        tick,
                        clock,
                        &mut granary,
                        commodity,
                        &["smokehouse"],
                    );
                }
            }
        }
    }
    if !grain_is_critical {
        if let Some(dispatch) = grain_dispatch.as_ref() {
            dispatch_granary_grain(ctx, tick, clock, &mut granary, dispatch);
        }
    }
    ctx.db.building().id().update(granary);
}

pub fn step_bakery(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    building: Building,
) {
    let bakery = if let Some((flour, bread, bread_output)) = selected_bakery_recipe(&building) {
        step_processor(
            ctx,
            tick,
            clock,
            building,
            &[
                (flour, BAKERY_FLOUR_PER_CYCLE),
                (CommodityKind::Water, BAKERY_WATER_PER_CYCLE),
                (CommodityKind::Firewood, BAKERY_FIREWOOD_PER_CYCLE),
            ],
            &[(bread, bread_output)],
        )
    } else {
        building
    };
    ctx.db.building().id().update(bakery);
}

fn apply_farm_field_work(
    field: &mut FarmField,
    resource_farmstead: &mut Building,
    worker_x: f64,
    worker_z: f64,
    plough_multiplier: f64,
    available_work: f64,
    world_seed: u64,
    map_size: u8,
    cultivation_multiplier: f64,
) -> f64 {
    normalize_farmstead_field_inventory(resource_farmstead);
    normalize_farm_field_resource_state(field);
    let corners = field_corners(field);
    let field_center = centroid(&corners);
    let shape = shape_efficiency(&corners);
    let perimeter: f64 = crate::farming::edge_lengths(&corners).iter().sum();
    let worker_distance =
        ((field_center.x - worker_x).powi(2) + (field_center.z - worker_z).powi(2)).sqrt();
    let required = (work_required(field.stage, field.area, shape, perimeter, worker_distance)
        * if field.stage == STAGE_PLOUGHING {
            plough_multiplier
        } else {
            1.0
        })
    .max(1e-6);
    let remaining = required * (1.0_f64 - field.stage_progress).max(0.0_f64);
    let expected_harvest = if field.stage == STAGE_HARVESTING {
        Some(crate::resource_units::whole_units(
            expected_grain_yield(
                field.area,
                field.crop,
                field.moisture,
                field.fertility,
                field.average_slope_degrees,
                shape,
                field_center.x,
                field_center.z,
                world_seed,
                map_size,
            ) * field.harvest_yield_multiplier.clamp(0.0, 1.0)
                * cultivation_multiplier.clamp(1.0, 1.15),
        ))
    } else {
        None
    };
    let harvest_commodity = match crop_produce(field.crop) {
        FarmCropProduce::Grain => crop_sheaf_commodity(field.crop),
        FarmCropProduce::Barley => Some(CommodityKind::BarleySheaves),
        FarmCropProduce::Fibre => Some(CommodityKind::Flax),
        FarmCropProduce::None => None,
    };
    let maximum_spent = available_work.min(remaining);
    let seed_required = if field.stage == STAGE_SOWING {
        seed_grain_required(field.area, field.crop)
    } else {
        0.0
    };
    let seed_commodity = crop_seed_commodity(field.crop);
    let seed_due = if seed_required > 1e-9 && field.stage_progress <= 1e-9 {
        seed_required
    } else {
        0.0
    };
    if building_commodity_stock(resource_farmstead, seed_commodity) + 1e-9 < seed_due {
        return 0.0;
    }
    if maximum_spent <= 1e-9 {
        return 0.0;
    }

    let previous_progress = field.stage_progress;
    let mut next_progress = (field.stage_progress + maximum_spent / required).min(1.0);
    let mut harvest_due = 0.0;
    if let (Some(expected), Some(commodity)) = (expected_harvest, harvest_commodity) {
        let room = building_commodity_room(resource_farmstead, commodity);
        let proposed_total = crate::resource_units::whole_units(expected * next_progress);
        harvest_due = (proposed_total - field.current_yield).max(0.0);
        if harvest_due > room + 1e-9 && expected > 1e-9 {
            // Work may advance up to, but not across, the next whole-unit
            // harvest threshold that cannot fit. This keeps large fields
            // harvestable over several cart clearances without ever creating
            // a fractional sheaf, grain, or fibre unit.
            let affordable_total = field.current_yield + room;
            next_progress = next_progress.min(
                ((affordable_total + 1.0 - 2e-6) / expected)
                    .max(previous_progress)
                    .min(1.0),
            );
            let affordable_target = crate::resource_units::whole_units(expected * next_progress);
            harvest_due = (affordable_target - field.current_yield).max(0.0);
        }
    }
    let spent = required * (next_progress - previous_progress).max(0.0);
    if spent <= 1e-9 {
        return 0.0;
    }
    field.stage_progress = next_progress;
    if seed_due > 1e-9 {
        let seed_used = withdraw_building_commodity(resource_farmstead, seed_commodity, seed_due);
        debug_assert!((seed_used - seed_due).abs() <= 1e-9);
    }
    if field.stage == STAGE_PLOUGHING {
        let manure_target = crate::resource_units::whole_units(
            field_manure_required(field.area) * field.stage_progress,
        );
        let manure_needed = (manure_target - field.manure_applied).max(0.0);
        let manure_spread =
            withdraw_building_commodity(resource_farmstead, CommodityKind::Manure, manure_needed);
        field.manure_applied += manure_spread;
    }
    if let Some(commodity) = harvest_commodity {
        let deposited = deposit_building_commodity(resource_farmstead, commodity, harvest_due);
        if deposited + 1e-9 < harvest_due {
            field.stage_progress = previous_progress;
            return 0.0;
        }
        field.current_yield += deposited;
    }
    if field.stage_progress >= 1.0 - 1e-9 {
        match field.stage {
            STAGE_PLOUGHING => {
                field.stage = if field.crop == CROP_FALLOW {
                    STAGE_GROWING
                } else {
                    STAGE_SOWING
                };
                field.stage_progress = 0.0;
            }
            STAGE_SOWING => {
                field.stage = STAGE_GROWING;
                field.stage_progress = 0.0;
            }
            STAGE_HARVESTING => {
                let harvested = field.current_yield;
                finish_field_cycle(field, harvested);
            }
            _ => {}
        }
    }
    spent
}

fn field_work_is_ready(field: &FarmField, resource_farmstead: &Building) -> bool {
    match field.stage {
        STAGE_SOWING => {
            field.stage_progress > 1e-9
                || building_commodity_stock(resource_farmstead, crop_seed_commodity(field.crop))
                    + 1e-9
                    >= seed_grain_required(field.area, field.crop)
        }
        STAGE_HARVESTING => {
            crop_sheaf_commodity(field.crop).is_some_and(|commodity| {
                building_commodity_room(resource_farmstead, commodity) > 1e-6
            }) || field.crop == CROP_BARLEY
                && building_commodity_room(resource_farmstead, CommodityKind::BarleySheaves) > 1e-6
                || field.crop == CROP_FLAX
                    && building_commodity_room(resource_farmstead, CommodityKind::Flax) > 1e-6
        }
        _ => true,
    }
}

#[derive(Clone, Copy, Debug, Default)]
struct FarmsteadWorkResult {
    seed_reserves: FarmSeedReserves,
    threshing_labor: u32,
}

fn step_farmstead_fields(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    farmstead: &mut Building,
    clock: &GameClock,
    environment: EnvironmentState,
    world_seed: u64,
    map_size: u8,
    work_allowed: bool,
    onsite_labor: u32,
    mut fields: Vec<FarmField>,
) -> FarmsteadWorkResult {
    normalize_farmstead_field_inventory(farmstead);
    // Rain and drought persistently change soil moisture, which later affects yield.
    for field in &mut fields {
        normalize_farm_field_resource_state(field);
        let moisture_change_per_day = match environment.weather {
            WeatherKind::Rain => 0.012,
            WeatherKind::Drought => {
                let drought_level = drought_groundwater_score(field.moisture);
                -(field.moisture - drought_level) / f64::from(SUMMER_DROUGHT_DURATION_DAYS.max(1))
            }
            _ => 0.0,
        };
        field.moisture = (field.moisture
            + moisture_change_per_day * TICK_DT / CALENDAR_SECONDS_PER_DAY)
            .clamp(0.0, 1.0);
    }

    // Seasonal boundaries are authoritative. Each crop opens and closes its
    // own harvest window, so hardy rye and spring barley no longer create the
    // same September labor spike as oats and maslin.
    for field in &mut fields {
        let harvest_month = crop_harvest_month(field.crop);
        if sowing_window_missed(field.stage, field.crop, clock.month) {
            fail_field_cycle(field);
        } else if clock.month == harvest_month && field.stage == STAGE_GROWING {
            if field.crop == CROP_FALLOW {
                if field.stage_progress >= 0.75 {
                    finish_field_cycle(field, 0.0);
                } else {
                    fail_field_cycle(field);
                }
            } else if field.stage_progress >= 0.75 {
                field.stage = STAGE_HARVESTING;
                field.stage_progress = 0.0;
                field.current_yield = 0.0;
                field.harvest_yield_multiplier = 1.0;
            } else {
                fail_field_cycle(field);
            }
        } else if clock.month == month_after(harvest_month) && field.stage == STAGE_HARVESTING {
            finish_field_cycle(field, field.current_yield);
        }
    }

    // Winter rye wakes in March; spring oats join after their shorter sowing window.
    for field in &mut fields {
        if field.stage != STAGE_GROWING || !crop_growth_allowed(field.crop, clock.month) {
            continue;
        }
        let crop_growth_multiplier = if field.crop == CROP_FALLOW { 0.72 } else { 1.0 };
        field.stage_progress = (field.stage_progress
            + TICK_DT * crop_growth_multiplier * environment.crop_growth_multiplier()
                / FARM_GROWTH_SECONDS.max(1.0))
        .min(1.0);
    }

    // A linked holding always works its own active parcels. High and urgent
    // parcels additionally enter every nearby farmstead's queue, allowing
    // several crews to converge while seed, manure, and harvest storage remain
    // owned by the field's linked farmstead.
    let worker_farmstead_id = farmstead.id;
    let mut work_fields = fields;
    for candidate in ctx.db.farm_field().owner().filter(&farmstead.owner) {
        if candidate.farmstead_id == worker_farmstead_id {
            continue;
        }
        let center = centroid(&field_corners(&candidate));
        let distance = ((center.x - farmstead.x).powi(2) + (center.z - farmstead.z).powi(2)).sqrt();
        if !field_accepts_farmstead_labor(
            candidate.priority,
            false,
            distance,
            farmstead.work_radius,
        ) {
            continue;
        }
        let Some(resource_farmstead) = ctx.db.building().id().find(&candidate.farmstead_id) else {
            continue;
        };
        if resource_farmstead.owner != farmstead.owner
            || resource_farmstead.kind != "threshing_barn"
            || !resource_farmstead.construction_complete
            || tick.building_disabled_by_fire(ctx, resource_farmstead.id)
        {
            continue;
        }
        work_fields.push(candidate);
    }
    for field in &mut work_fields {
        normalize_farm_field_resource_state(field);
    }
    let cattle_support: std::collections::HashMap<u64, f64> = work_fields
        .iter()
        .filter_map(|field| {
            tick.cattle_field_support_for(ctx, farmstead.owner, field.id)
                .map(|support| (field.id, support))
        })
        .collect();

    let initial_linked_fields: Vec<FarmField> = work_fields
        .iter()
        .filter(|field| field.farmstead_id == worker_farmstead_id)
        .cloned()
        .collect();
    let initial_seed_reserves = farmstead_seed_grain_remaining(&initial_linked_fields);
    let mut highest_ready_field_rank = 0_u8;
    for field in &work_fields {
        if field.stage == STAGE_GROWING
            || field.priority == 0
            || !field_work_allowed(field.stage, field.crop, clock.month)
        {
            continue;
        }
        let ready = if field.farmstead_id == worker_farmstead_id {
            field_work_is_ready(field, farmstead)
        } else {
            ctx.db
                .building()
                .id()
                .find(&field.farmstead_id)
                .is_some_and(|resource_farmstead| field_work_is_ready(field, &resource_farmstead))
        };
        if ready {
            highest_ready_field_rank = highest_ready_field_rank.max(field_task_rank(
                field.priority,
                field.stage == STAGE_HARVESTING,
            ));
        }
    }
    let threshing_available = threshing_work_available(farmstead);
    let threshing_demanded = threshing_work_demanded(farmstead, initial_seed_reserves);
    let threshing_labor = if work_allowed
        && onsite_labor > 0
        && threshing_available
        && threshing_preempts_fields(
            farmstead.threshing_priority,
            threshing_demanded,
            highest_ready_field_rank,
        ) {
        onsite_labor
    } else {
        0
    };

    let farm_tools_ready = farm_tools_maintained(farmstead.ironwork);
    let farm_tool_throughput = farm_tool_throughput_multiplier(farmstead.ironwork);
    let paired_field_oxen =
        if work_allowed && threshing_labor == 0 && highest_ready_field_rank > 0 && onsite_labor > 0
        {
            crate::simulation::paired_production_ox_count(ctx, tick, farmstead, onsite_labor)
        } else {
            0
        };
    let production_rate = crate::production_rate_policy::production_rate_multiplier(
        farmstead.production_rate_percent,
    );
    let cultivation_multiplier = tick.land_use_profile(ctx).cultivation_multiplier();
    let mut work_budget = if work_allowed && threshing_labor == 0 {
        onsite_labor as f64
            * FARM_WORK_METERS_PER_WORKER_PER_SEC
            * TICK_DT
            * farm_tool_throughput
            * production_rate
    } else {
        0.0
    };
    work_fields.sort_by(|a, b| {
        field_task_rank(b.priority, b.stage == STAGE_HARVESTING)
            .cmp(&field_task_rank(a.priority, a.stage == STAGE_HARVESTING))
            .then_with(|| b.priority.cmp(&a.priority))
            .then_with(|| stage_urgency(b.stage).cmp(&stage_urgency(a.stage)))
            .then_with(|| {
                let a_is_linked = a.farmstead_id == worker_farmstead_id;
                let b_is_linked = b.farmstead_id == worker_farmstead_id;
                b_is_linked.cmp(&a_is_linked)
            })
            .then_with(|| a.id.cmp(&b.id))
    });

    for field in &mut work_fields {
        if work_budget <= 1e-9
            || field.stage == STAGE_GROWING
            || field.priority == 0
            || !field_work_allowed(field.stage, field.crop, clock.month)
        {
            continue;
        }
        let plough_multiplier = cattle_support.get(&field.id).copied().unwrap_or(1.0);
        let ox_throughput_multiplier = if onsite_labor > 0 {
            farm_field_effective_labor(field.stage, onsite_labor, paired_field_oxen)
                / f64::from(onsite_labor)
        } else {
            1.0
        };
        let stage_before = field.stage;
        let harvest_count_before = field.harvest_count;
        let spent = if field.farmstead_id == worker_farmstead_id {
            apply_farm_field_work(
                field,
                farmstead,
                farmstead.x,
                farmstead.z,
                plough_multiplier,
                work_budget * ox_throughput_multiplier,
                world_seed,
                map_size,
                cultivation_multiplier,
            )
        } else {
            let Some(mut resource_farmstead) = ctx.db.building().id().find(&field.farmstead_id)
            else {
                continue;
            };
            let spent = apply_farm_field_work(
                field,
                &mut resource_farmstead,
                farmstead.x,
                farmstead.z,
                plough_multiplier,
                work_budget * ox_throughput_multiplier,
                world_seed,
                map_size,
                cultivation_multiplier,
            );
            if spent > 1e-9 {
                ctx.db.building().id().update(resource_farmstead);
            }
            spent
        };
        if spent <= 1e-9 {
            continue;
        }
        work_budget -= spent / ox_throughput_multiplier.max(1.0);
        let completed_stage =
            field.stage != stage_before || field.harvest_count != harvest_count_before;
        if farm_tools_ready && completed_stage {
            charge_completed_production_maintenance(
                farmstead,
                farm_tool_ironwork_per_completed_stage(),
            );
        }
    }

    let linked_fields: Vec<FarmField> = work_fields
        .iter()
        .filter(|field| field.farmstead_id == worker_farmstead_id)
        .cloned()
        .collect();
    let seed_reserves = farmstead_seed_grain_remaining(&linked_fields);
    for field in work_fields {
        ctx.db.farm_field().id().update(field);
    }
    FarmsteadWorkResult {
        seed_reserves,
        threshing_labor,
    }
}

#[derive(Clone, Copy, Debug, Default)]
struct FarmSeedReserves {
    rye: f64,
    oats: f64,
    barley: f64,
    flax: f64,
    maslin: f64,
}

impl FarmSeedReserves {
    fn for_commodity(self, commodity: CommodityKind) -> f64 {
        match commodity {
            CommodityKind::RyeGrain => self.rye,
            CommodityKind::OatGrain => self.oats,
            CommodityKind::Barley => self.barley,
            CommodityKind::Flax => self.flax,
            CommodityKind::MaslinGrain => self.maslin,
            _ => 0.0,
        }
    }
}

fn farmstead_seed_grain_remaining(fields: &[FarmField]) -> FarmSeedReserves {
    fields
        .iter()
        .fold(FarmSeedReserves::default(), |mut reserves, field| {
            let reserve = field_seed_grain_remaining(
                field.area,
                field.crop,
                field.next_crop,
                field.stage,
                field.stage_progress,
                field.priority,
            );
            match field_seed_crop(field.crop, field.next_crop, field.stage) {
                CROP_RYE => reserves.rye += reserve,
                CROP_OATS => reserves.oats += reserve,
                CROP_BARLEY => reserves.barley += reserve,
                CROP_FLAX => reserves.flax += reserve,
                CROP_WHEAT => reserves.maslin += reserve,
                _ => {}
            }
            reserves
        })
}

fn crop_sheaf_commodity(crop: u8) -> Option<CommodityKind> {
    match crop {
        CROP_RYE => Some(CommodityKind::RyeSheaves),
        CROP_OATS => Some(CommodityKind::OatSheaves),
        CROP_WHEAT => Some(CommodityKind::MaslinSheaves),
        _ => None,
    }
}

fn crop_seed_commodity(crop: u8) -> CommodityKind {
    match crop {
        CROP_RYE => CommodityKind::RyeGrain,
        CROP_OATS => CommodityKind::OatGrain,
        CROP_BARLEY => CommodityKind::Barley,
        CROP_FLAX => CommodityKind::Flax,
        CROP_WHEAT => CommodityKind::MaslinGrain,
        _ => CommodityKind::RyeGrain,
    }
}

fn normalize_farmstead_field_inventory(farmstead: &mut Building) {
    let whole = crate::resource_units::whole_units;
    farmstead.manure = whole(farmstead.manure);
    farmstead.flax = whole(farmstead.flax);
    farmstead.barley = whole(farmstead.barley);
    farmstead.rye_grain = whole(farmstead.rye_grain);
    farmstead.oat_grain = whole(farmstead.oat_grain);
    farmstead.maslin_grain = whole(farmstead.maslin_grain);
    farmstead.rye_sheaves = whole(farmstead.rye_sheaves);
    farmstead.oat_sheaves = whole(farmstead.oat_sheaves);
    farmstead.barley_sheaves = whole(farmstead.barley_sheaves);
    farmstead.maslin_sheaves = whole(farmstead.maslin_sheaves);
}

fn normalize_farm_field_resource_state(field: &mut FarmField) {
    field.last_yield = crate::resource_units::whole_units(field.last_yield);
    field.current_yield = crate::resource_units::whole_units(field.current_yield);
    field.manure_applied = crate::resource_units::whole_units(field.manure_applied);
}

fn finish_field_cycle(field: &mut FarmField, harvested: f64) {
    let manure_bonus = settle_field_manure_bonus(field);
    field.last_yield = crate::resource_units::whole_units(harvested);
    field.current_yield = 0.0;
    field.harvest_yield_multiplier = 1.0;
    field.harvest_count = field.harvest_count.saturating_add(1);
    field.fertility =
        (fertility_after_harvest(field.crop, field.fertility) + manure_bonus).clamp(0.0, 1.0);
    advance_field_rotation(field);
    field.stage = STAGE_PLOUGHING;
    field.stage_progress = 0.0;
}

fn fail_field_cycle(field: &mut FarmField) {
    let manure_bonus = settle_field_manure_bonus(field);
    field.last_yield = 0.0;
    field.current_yield = 0.0;
    field.harvest_yield_multiplier = 1.0;
    field.fertility = (field.fertility + manure_bonus).clamp(0.0, 1.0);
    advance_field_rotation(field);
    field.stage = STAGE_PLOUGHING;
    field.stage_progress = 0.0;
}

fn settle_field_manure_bonus(field: &mut FarmField) -> f64 {
    let bonus = field_manure_fertility_bonus(field.area, field.manure_applied);
    field.manure_applied = 0.0;
    bonus
}

fn advance_field_rotation(field: &mut FarmField) {
    let (crop, next_crop, following_crop) =
        advance_crop_rotation(field.crop, field.next_crop, field.following_crop);
    field.crop = crop;
    field.next_crop = next_crop;
    field.following_crop = following_crop;
}

fn field_corners(field: &FarmField) -> ZoneCorners {
    ZoneCorners {
        a: Point2 {
            x: field.corner_ax,
            z: field.corner_az,
        },
        b: Point2 {
            x: field.corner_bx,
            z: field.corner_bz,
        },
        c: Point2 {
            x: field.corner_cx,
            z: field.corner_cz,
        },
        d: Point2 {
            x: field.corner_dx,
            z: field.corner_dz,
        },
    }
}

fn stage_urgency(stage: u8) -> u8 {
    match stage {
        STAGE_HARVESTING => 3,
        STAGE_SOWING => 2,
        STAGE_PLOUGHING => 1,
        _ => 0,
    }
}

pub fn step_brewery(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    building: Building,
) {
    let mut brewery = building;
    let input_staging_cycles =
        processor_input_staging_cycles(brewery.processor_output_target_percent);
    let recipe = selected_brewery_recipe(&brewery);
    match recipe {
        BREWERY_RECIPE_CIDER => {
            brewery = step_processor(
                ctx,
                tick,
                clock,
                brewery,
                &[(CommodityKind::Apples, BREWERY_FRUIT_PER_CIDER_CYCLE)],
                &[(CommodityKind::Cider, BREWERY_CIDER_PER_CYCLE)],
            );
        }
        BREWERY_RECIPE_PEAR_CIDER => {
            brewery = step_processor(
                ctx,
                tick,
                clock,
                brewery,
                &[(CommodityKind::Pears, BREWERY_FRUIT_PER_CIDER_CYCLE)],
                &[(CommodityKind::Cider, BREWERY_CIDER_PER_CYCLE)],
            );
        }
        BREWERY_RECIPE_MEAD => {
            brewery = step_processor(
                ctx,
                tick,
                clock,
                brewery,
                &[(CommodityKind::Honey, BREWERY_HONEY_PER_MEAD_CYCLE)],
                &[(CommodityKind::Mead, BREWERY_MEAD_PER_CYCLE)],
            );
        }
        _ => {
            let ale_headroom = brewery_output_headroom(&brewery, CommodityKind::Ale);
            if ale_headroom > 1e-6 {
                let malt_working_target = (BREWERY_MALT_PER_ALE_CYCLE * input_staging_cycles)
                    .min(building_commodity_cap(&brewery.kind, CommodityKind::Malt));
                let should_malt =
                    brewery.barley > 1e-6 && brewery.malt + 1e-6 < malt_working_target;
                brewery = if should_malt {
                    step_processor(
                        ctx,
                        tick,
                        clock,
                        brewery,
                        &[
                            (CommodityKind::Barley, BREWERY_BARLEY_PER_MALT_CYCLE),
                            (CommodityKind::Water, BREWERY_MALTING_WATER_PER_CYCLE),
                            (CommodityKind::Firewood, BREWERY_MALTING_FIREWOOD_PER_CYCLE),
                        ],
                        &[(CommodityKind::Malt, BREWERY_MALT_PER_CYCLE)],
                    )
                } else {
                    step_processor(
                        ctx,
                        tick,
                        clock,
                        brewery,
                        &[
                            (CommodityKind::Malt, BREWERY_MALT_PER_ALE_CYCLE),
                            (CommodityKind::Water, BREWERY_BREWING_WATER_PER_CYCLE),
                            (CommodityKind::Firewood, BREWERY_BREWING_FIREWOOD_PER_CYCLE),
                        ],
                        &[(CommodityKind::Ale, BREWERY_ALE_PER_CYCLE)],
                    )
                };
            }
        }
    }

    request_brewery_recipe_inputs(ctx, tick, clock, &brewery, recipe, input_staging_cycles);
    for beverage in [
        CommodityKind::Cider,
        CommodityKind::Ale,
        CommodityKind::Mead,
    ] {
        dispatch_to_building_where(
            ctx,
            tick,
            clock,
            &mut brewery,
            beverage,
            &["tavern"],
            |target| target.assigned_labor > 0,
        );
    }
    // A staffed Granary is the overflow cellar when no staffed Tavern can
    // take the batch. Its own logistics crew later supplies Taverns using the
    // same typed beverage, so cider and mead never collapse into generic ale.
    for beverage in [
        CommodityKind::Cider,
        CommodityKind::Ale,
        CommodityKind::Mead,
    ] {
        dispatch_to_building_where(
            ctx,
            tick,
            clock,
            &mut brewery,
            beverage,
            &["granary"],
            |target| target.assigned_labor > 0,
        );
    }
    dispatch_to_building(
        ctx,
        tick,
        clock,
        &mut brewery,
        CommodityKind::Ale,
        &["trading_post"],
    );
    ctx.db.building().id().update(brewery);
}

fn brewery_output_headroom(building: &Building, output: CommodityKind) -> f64 {
    processor_output_headroom(
        building_commodity_stock(building, output),
        building_commodity_cap(&building.kind, output),
        building.processor_output_target_percent,
    )
}

fn selected_brewery_recipe(building: &Building) -> u8 {
    let policy = normalize_brewery_recipe_policy(building.brewery_recipe_policy);
    if policy != BREWERY_RECIPE_AUTO {
        return policy;
    }
    let candidates = [
        (
            BREWERY_RECIPE_ALE,
            if brewery_output_headroom(building, CommodityKind::Ale) > 1e-6 {
                (building.malt / BREWERY_MALT_PER_ALE_CYCLE.max(1e-9))
                    .max(building.barley / BREWERY_BARLEY_PER_MALT_CYCLE.max(1e-9))
            } else {
                -1.0
            },
        ),
        (
            BREWERY_RECIPE_CIDER,
            if brewery_output_headroom(building, CommodityKind::Cider) > 1e-6 {
                building.apples / BREWERY_FRUIT_PER_CIDER_CYCLE.max(1e-9)
            } else {
                -1.0
            },
        ),
        (
            BREWERY_RECIPE_PEAR_CIDER,
            if brewery_output_headroom(building, CommodityKind::Cider) > 1e-6 {
                building.pears / BREWERY_FRUIT_PER_CIDER_CYCLE.max(1e-9)
            } else {
                -1.0
            },
        ),
        (
            BREWERY_RECIPE_MEAD,
            if brewery_output_headroom(building, CommodityKind::Mead) > 1e-6 {
                building.honey / BREWERY_HONEY_PER_MEAD_CYCLE.max(1e-9)
            } else {
                -1.0
            },
        ),
    ];
    candidates
        .into_iter()
        .max_by(|left, right| {
            left.1
                .total_cmp(&right.1)
                .then_with(|| right.0.cmp(&left.0))
        })
        .map(|candidate| candidate.0)
        .unwrap_or(BREWERY_RECIPE_ALE)
}

fn request_brewery_recipe_inputs(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    brewery: &Building,
    selected_recipe: u8,
    staging_cycles: f64,
) {
    let policy = normalize_brewery_recipe_policy(brewery.brewery_recipe_policy);
    if selected_recipe == BREWERY_RECIPE_MEAD || policy == BREWERY_RECIPE_AUTO {
        request_connected_commodity_with_source_availability(
            ctx,
            tick,
            clock,
            brewery,
            CommodityKind::Honey,
            &["apiary", "granary", "trading_post"],
            BREWERY_HONEY_PER_MEAD_CYCLE * staging_cycles,
            |source, stock| {
                if source.kind == "apiary" {
                    (stock - apiary_honey_reserve(source.apiary_harvest_policy)).max(0.0)
                } else {
                    stock
                }
            },
        );
    }
    if selected_recipe == BREWERY_RECIPE_CIDER || policy == BREWERY_RECIPE_AUTO {
        request_connected_commodity(
            ctx,
            tick,
            clock,
            brewery,
            CommodityKind::Apples,
            &["granary", "trading_post"],
            BREWERY_FRUIT_PER_CIDER_CYCLE * staging_cycles,
        );
    }
    if selected_recipe == BREWERY_RECIPE_PEAR_CIDER || policy == BREWERY_RECIPE_AUTO {
        request_connected_commodity(
            ctx,
            tick,
            clock,
            brewery,
            CommodityKind::Pears,
            &["granary", "trading_post"],
            BREWERY_FRUIT_PER_CIDER_CYCLE * staging_cycles,
        );
    }
}

pub fn step_spinning_retting_house(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    building: Building,
) {
    let uses_flax = weaver_uses_flax(
        building.weaver_input_policy,
        building.wool,
        building.flax,
        building.water,
        SPINNING_RETTING_WOOL_PER_CYCLE,
        SPINNING_RETTING_FLAX_PER_CYCLE,
        SPINNING_RETTING_FLAX_WATER_PER_CYCLE,
    );
    let (inputs, output) = if uses_flax {
        (
            [
                (CommodityKind::Flax, SPINNING_RETTING_FLAX_PER_CYCLE),
                (CommodityKind::Water, SPINNING_RETTING_FLAX_WATER_PER_CYCLE),
            ],
            (CommodityKind::Linen, SPINNING_RETTING_LINEN_PER_CYCLE),
        )
    } else {
        (
            [
                (CommodityKind::Wool, SPINNING_RETTING_WOOL_PER_CYCLE),
                (CommodityKind::Water, 0.0),
            ],
            (CommodityKind::Yarn, SPINNING_RETTING_YARN_PER_CYCLE),
        )
    };
    let mut spinner = step_processor(ctx, tick, clock, building, &inputs, &[output]);
    for commodity in [CommodityKind::Yarn, CommodityKind::Linen] {
        dispatch_to_building(ctx, tick, clock, &mut spinner, commodity, &["weaver"]);
        dispatch_to_building(
            ctx,
            tick,
            clock,
            &mut spinner,
            commodity,
            &["village_storehouse"],
        );
        dispatch_to_building(ctx, tick, clock, &mut spinner, commodity, &["trading_post"]);
    }
    ctx.db.building().id().update(spinner);
}

pub fn step_weaver(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    building: Building,
) {
    let input = if weaver_uses_linen(
        building.weaver_input_policy,
        building.yarn,
        building.linen,
        WEAVER_YARN_PER_CYCLE,
        WEAVER_LINEN_PER_CYCLE,
    ) {
        (CommodityKind::Linen, WEAVER_LINEN_PER_CYCLE)
    } else {
        (CommodityKind::Yarn, WEAVER_YARN_PER_CYCLE)
    };
    let mut weaver = step_processor(
        ctx,
        tick,
        clock,
        building,
        &[input],
        &[(CommodityKind::Cloth, WEAVER_CLOTH_PER_CYCLE)],
    );
    dispatch_to_building(
        ctx,
        tick,
        clock,
        &mut weaver,
        CommodityKind::Cloth,
        &["village_storehouse"],
    );
    dispatch_to_building(
        ctx,
        tick,
        clock,
        &mut weaver,
        CommodityKind::Cloth,
        &["trading_post"],
    );
    ctx.db.building().id().update(weaver);
}

pub fn step_tannery(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    building: Building,
) {
    let tannery = step_processor(
        ctx,
        tick,
        clock,
        building,
        &[
            (CommodityKind::Hides, TANNERY_HIDES_PER_CYCLE),
            (CommodityKind::Water, TANNERY_WATER_PER_CYCLE),
            (CommodityKind::Firewood, TANNERY_FIREWOOD_PER_CYCLE),
        ],
        &[(CommodityKind::Leather, TANNERY_LEATHER_PER_CYCLE)],
    );
    ctx.db.building().id().update(tannery);
}

pub fn step_cobbler(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    building: Building,
) {
    let cobbler = step_processor(
        ctx,
        tick,
        clock,
        building,
        &[(CommodityKind::Leather, COBBLER_LEATHER_PER_CYCLE)],
        &[(CommodityKind::Shoes, COBBLER_SHOES_PER_CYCLE)],
    );
    ctx.db.building().id().update(cobbler);
}

pub fn step_chandlery(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    building: Building,
) {
    let mut chandlery = step_processor(
        ctx,
        tick,
        clock,
        building,
        &[
            (CommodityKind::Wax, CHANDLERY_WAX_PER_CYCLE),
            (CommodityKind::Firewood, CHANDLERY_FIREWOOD_PER_CYCLE),
        ],
        &[(CommodityKind::Candles, CHANDLERY_CANDLES_PER_CYCLE)],
    );
    dispatch_to_building(
        ctx,
        tick,
        clock,
        &mut chandlery,
        CommodityKind::Candles,
        &["village_storehouse"],
    );
    dispatch_to_building(
        ctx,
        tick,
        clock,
        &mut chandlery,
        CommodityKind::Candles,
        &["trading_post"],
    );
    ctx.db.building().id().update(chandlery);
}

pub fn step_smokehouse(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    building: Building,
) {
    let mut smokehouse = building;
    if let Some((input, output)) = selected_smokehouse_recipe(&smokehouse) {
        smokehouse = step_processor(
            ctx,
            tick,
            clock,
            smokehouse,
            &[
                (input, SMOKEHOUSE_FOOD_PER_CYCLE),
                (CommodityKind::Firewood, SMOKEHOUSE_FIREWOOD_PER_CYCLE),
                (CommodityKind::Salt, SMOKEHOUSE_SALT_PER_CYCLE),
            ],
            &[(output, SMOKEHOUSE_PRESERVED_FOOD_PER_CYCLE)],
        );
    }
    // Once local reserves are covered, a granary worker may collect cured
    // surplus from a smokehouse when perishable collection is enabled. The
    // smokehouse crew stays on production; central storage accepts the extra
    // haul and slightly faster aging in exchange for household redistribution.
    for commodity in [
        CommodityKind::Cheese,
        CommodityKind::SmokedFish,
        CommodityKind::CuredMeat,
    ] {
        dispatch_to_building_where(
            ctx,
            tick,
            clock,
            &mut smokehouse,
            commodity,
            &["granary"],
            |target| storage_accepts_commodity(target, commodity),
        );
    }
    ctx.db.building().id().update(smokehouse);
}

fn selected_smokehouse_recipe(smokehouse: &Building) -> Option<(CommodityKind, CommodityKind)> {
    let policy = normalize_smokehouse_recipe_policy(smokehouse.smokehouse_recipe_policy);
    let recipe = |input: CommodityKind| {
        let output = input
            .preservation_output()
            .expect("smokehouse recipe input must retain a preservation identity");
        (input, output)
    };
    if policy != SMOKEHOUSE_RECIPE_AUTO {
        return Some(recipe(match policy {
            SMOKEHOUSE_RECIPE_SMOKED_FISH => CommodityKind::Fish,
            SMOKEHOUSE_RECIPE_CHEESE => CommodityKind::Milk,
            SMOKEHOUSE_RECIPE_CURED_MEAT => CommodityKind::Meat,
            _ => unreachable!("smokehouse recipe policy is normalized"),
        }));
    }
    [
        CommodityKind::Meat,
        CommodityKind::Fish,
        CommodityKind::Milk,
    ]
    .into_iter()
    .map(recipe)
    .find(|(input, output)| {
        building_commodity_stock(smokehouse, *input) + 1e-6 >= SMOKEHOUSE_FOOD_PER_CYCLE
            && processor_output_headroom(
                building_commodity_stock(smokehouse, *output),
                building_commodity_cap(&smokehouse.kind, *output),
                smokehouse.processor_output_target_percent,
            ) + 1e-6
                >= SMOKEHOUSE_PRESERVED_FOOD_PER_CYCLE
    })
}

pub fn step_charcoal_burner(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    environment: EnvironmentState,
    building: Building,
) {
    let burner = step_processor_at_rate(
        ctx,
        tick,
        clock,
        building,
        &[(CommodityKind::Firewood, CHARCOAL_BURNER_FIREWOOD_PER_CYCLE)],
        &[(CommodityKind::Charcoal, CHARCOAL_BURNER_CHARCOAL_PER_CYCLE)],
        environment.charcoal_burner_throughput_multiplier(),
    );
    ctx.db.building().id().update(burner);
}

pub fn step_smithy(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    building: Building,
) {
    let smithy = step_processor(
        ctx,
        tick,
        clock,
        building,
        &[
            (CommodityKind::Iron, SMITHY_IRON_PER_CYCLE),
            (CommodityKind::Charcoal, SMITHY_CHARCOAL_PER_CYCLE),
            (CommodityKind::Water, SMITHY_WATER_PER_CYCLE),
        ],
        &[(CommodityKind::Ironwork, SMITHY_IRONWORK_PER_CYCLE)],
    );
    ctx.db.building().id().update(smithy);
}

type WorkshopRecipe = (
    &'static [(CommodityKind, f64)],
    &'static [(CommodityKind, f64)],
);

const POLEARM_RECIPE_INPUTS: &[(CommodityKind, f64)] =
    &[(CommodityKind::Timber, 2.0), (CommodityKind::Ironwork, 1.0)];
const SIDEARM_RECIPE_INPUTS: &[(CommodityKind, f64)] = &[
    (CommodityKind::Ironwork, 2.0),
    (CommodityKind::Leather, 1.0),
];
const SHIELD_RECIPE_INPUTS: &[(CommodityKind, f64)] = &[
    (CommodityKind::Timber, 2.0),
    (CommodityKind::Leather, 1.0),
    (CommodityKind::Ironwork, 1.0),
];
const PADDED_ARMOR_RECIPE_INPUTS: &[(CommodityKind, f64)] =
    &[(CommodityKind::Linen, 2.0), (CommodityKind::Leather, 1.0)];
const MAIL_ARMOR_RECIPE_INPUTS: &[(CommodityKind, f64)] = &[
    (CommodityKind::Ironwork, 4.0),
    (CommodityKind::Leather, 1.0),
    (CommodityKind::Linen, 1.0),
];
const BOW_RECIPE_INPUTS: &[(CommodityKind, f64)] = &[
    (CommodityKind::Timber, 2.0),
    (CommodityKind::Linen, 1.0),
    (CommodityKind::Leather, 1.0),
];
const CROSSBOW_RECIPE_INPUTS: &[(CommodityKind, f64)] = &[
    (CommodityKind::Timber, 2.0),
    (CommodityKind::Ironwork, 2.0),
    (CommodityKind::Linen, 1.0),
    (CommodityKind::Leather, 1.0),
];
const AMMUNITION_RECIPE_INPUTS: &[(CommodityKind, f64)] =
    &[(CommodityKind::Timber, 1.0), (CommodityKind::Ironwork, 1.0)];
const ONE_POLEARM: &[(CommodityKind, f64)] = &[(CommodityKind::Polearms, 1.0)];
const ONE_SIDEARM: &[(CommodityKind, f64)] = &[(CommodityKind::Sidearms, 1.0)];
const ONE_SHIELD: &[(CommodityKind, f64)] = &[(CommodityKind::Shields, 1.0)];
const ONE_PADDED_ARMOR: &[(CommodityKind, f64)] = &[(CommodityKind::PaddedArmor, 1.0)];
const ONE_MAIL_ARMOR: &[(CommodityKind, f64)] = &[(CommodityKind::MailArmor, 1.0)];
const ONE_BOW: &[(CommodityKind, f64)] = &[(CommodityKind::Bows, 1.0)];
const ONE_CROSSBOW: &[(CommodityKind, f64)] = &[(CommodityKind::Crossbows, 1.0)];
const AMMUNITION_BATCH: &[(CommodityKind, f64)] = &[(CommodityKind::Ammunition, 4.0)];

fn least_stocked_recipe(building: &Building, recipes: &[WorkshopRecipe]) -> WorkshopRecipe {
    *recipes
        .iter()
        .min_by(|(_, left), (_, right)| {
            let ratio = |outputs: &&[(CommodityKind, f64)]| {
                let commodity = outputs[0].0;
                building_commodity_stock(building, commodity)
                    / building_commodity_cap(&building.kind, commodity).max(1.0)
            };
            ratio(left)
                .total_cmp(&ratio(right))
                .then_with(|| left[0].0.as_u8().cmp(&right[0].0.as_u8()))
        })
        .expect("military workshop must define at least one recipe")
}

fn request_military_workshop_inputs(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    building: &Building,
    inputs: &[(CommodityKind, f64)],
) {
    for (commodity, per_cycle) in inputs {
        let sources: &[&str] = match commodity {
            CommodityKind::Timber => &["lumber_mill", "village_storehouse", "trading_post"],
            CommodityKind::Ironwork => &["smithy", "village_storehouse", "trading_post"],
            CommodityKind::Leather => &["tannery", "village_storehouse", "trading_post"],
            CommodityKind::Linen => &[
                "spinning_retting_house",
                "village_storehouse",
                "trading_post",
            ],
            _ => continue,
        };
        request_connected_commodity(
            ctx,
            tick,
            clock,
            building,
            *commodity,
            sources,
            (*per_cycle * 8.0).min(building_commodity_cap(&building.kind, *commodity)),
        );
    }
}

pub fn step_weaponsmith_armorer(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    mut building: Building,
) {
    const RECIPES: &[WorkshopRecipe] = &[
        (POLEARM_RECIPE_INPUTS, ONE_POLEARM),
        (SIDEARM_RECIPE_INPUTS, ONE_SIDEARM),
        (SHIELD_RECIPE_INPUTS, ONE_SHIELD),
        (PADDED_ARMOR_RECIPE_INPUTS, ONE_PADDED_ARMOR),
        (MAIL_ARMOR_RECIPE_INPUTS, ONE_MAIL_ARMOR),
    ];
    // Clothing was formerly an input to padded armor. Evacuate any stock left
    // in an existing save to civilian storage before working the new recipe.
    dispatch_to_building(
        ctx,
        tick,
        clock,
        &mut building,
        CommodityKind::Cloth,
        &["village_storehouse"],
    );
    dispatch_to_building(
        ctx,
        tick,
        clock,
        &mut building,
        CommodityKind::Cloth,
        &["trading_post"],
    );
    let (inputs, outputs) = least_stocked_recipe(&building, RECIPES);
    request_military_workshop_inputs(ctx, tick, clock, &building, inputs);
    let workshop = step_processor(ctx, tick, clock, building, inputs, outputs);
    ctx.db.building().id().update(workshop);
}

pub fn step_bowyer_fletcher(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    building: Building,
) {
    const RECIPES: &[WorkshopRecipe] = &[
        (BOW_RECIPE_INPUTS, ONE_BOW),
        (CROSSBOW_RECIPE_INPUTS, ONE_CROSSBOW),
        (AMMUNITION_RECIPE_INPUTS, AMMUNITION_BATCH),
    ];
    let (inputs, outputs) = least_stocked_recipe(&building, RECIPES);
    request_military_workshop_inputs(ctx, tick, clock, &building, inputs);
    let workshop = step_processor(ctx, tick, clock, building, inputs, outputs);
    ctx.db.building().id().update(workshop);
}

fn military_equipment_costs(cost: MilitaryCost) -> [(CommodityKind, u32); 8] {
    [
        (CommodityKind::Polearms, cost.polearms),
        (CommodityKind::Sidearms, cost.sidearms),
        (CommodityKind::Shields, cost.shields),
        (CommodityKind::Bows, cost.bows),
        (CommodityKind::Crossbows, cost.crossbows),
        (CommodityKind::PaddedArmor, cost.padded_armor),
        (CommodityKind::MailArmor, cost.mail_armor),
        (CommodityKind::Ammunition, cost.ammunition),
    ]
}

fn equipment_source_kinds(commodity: CommodityKind) -> &'static [&'static str] {
    match commodity {
        CommodityKind::Polearms => &[
            "weaponsmith_armorer",
            "carpenter",
            "village_storehouse",
            "trading_post",
        ],
        CommodityKind::Sidearms
        | CommodityKind::Shields
        | CommodityKind::PaddedArmor
        | CommodityKind::MailArmor => {
            &["weaponsmith_armorer", "village_storehouse", "trading_post"]
        }
        CommodityKind::Bows | CommodityKind::Crossbows | CommodityKind::Ammunition => {
            &["bowyer_fletcher", "village_storehouse", "trading_post"]
        }
        _ => &[],
    }
}

fn equipped_member_kit(kind: MilitaryKind, _slot: u32) -> RaidPortableStores {
    match kind {
        MilitaryKind::Militia => RaidPortableStores {
            polearms: 1.0,
            ..RaidPortableStores::default()
        },
        MilitaryKind::Spearmen => RaidPortableStores {
            polearms: 1.0,
            shields: 1.0,
            padded_armor: 1.0,
            ..RaidPortableStores::default()
        },
        MilitaryKind::MenAtArms => RaidPortableStores {
            sidearms: 1.0,
            shields: 1.0,
            mail_armor: 1.0,
            ..RaidPortableStores::default()
        },
        MilitaryKind::Crossbows => RaidPortableStores {
            crossbows: 1.0,
            padded_armor: 1.0,
            ammunition: 1.0,
            ..RaidPortableStores::default()
        },
        MilitaryKind::Footmen => RaidPortableStores {
            sidearms: 1.0,
            shields: 1.0,
            padded_armor: 1.0,
            ..RaidPortableStores::default()
        },
        MilitaryKind::Polearms => RaidPortableStores {
            polearms: 1.0,
            padded_armor: 1.0,
            ..RaidPortableStores::default()
        },
        MilitaryKind::Bowmen => RaidPortableStores {
            bows: 1.0,
            ammunition: 1.0,
            ..RaidPortableStores::default()
        },
        MilitaryKind::Hussars => RaidPortableStores {
            polearms: 1.0,
            sidearms: 1.0,
            shields: 1.0,
            padded_armor: 1.0,
            ..RaidPortableStores::default()
        },
        MilitaryKind::ArmoredLancers => RaidPortableStores {
            polearms: 1.0,
            sidearms: 1.0,
            mail_armor: 1.0,
            ..RaidPortableStores::default()
        },
        MilitaryKind::MountedArchers => RaidPortableStores {
            sidearms: 1.0,
            bows: 1.0,
            padded_armor: 1.0,
            ammunition: 1.0,
            ..RaidPortableStores::default()
        },
        MilitaryKind::MercenarySpears => RaidPortableStores::default(),
    }
}

/// Keeps mustering ranks non-controllable until their complete finished kits
/// have reached the source building on ordinary physical carts. The same path
/// equips initial companies and later replacement ranks.
pub fn step_military_requisitions(ctx: &ReducerContext, tick: &SimTickContext, clock: &GameClock) {
    step_cavalry_yard_requisitions(ctx, tick, clock);
    let companies = ctx
        .db
        .military_company()
        .iter()
        .filter(|company| company.state < 2)
        .collect::<Vec<_>>();
    for mut company in companies {
        let Some(kind) = MilitaryKind::from_id(company.kind) else {
            continue;
        };
        if kind == MilitaryKind::MercenarySpears {
            continue;
        }
        let Some(mut source) = ctx.db.building().id().find(&company.source_building_id) else {
            continue;
        };
        if tick.building_disabled_by_fire(ctx, source.id) {
            continue;
        }
        let members = ctx
            .db
            .military_member()
            .company_id()
            .filter(&company.id)
            .filter(|member| member.phase == 0)
            .collect::<Vec<_>>();
        if members.is_empty() {
            continue;
        }
        let mustering_count = members.len().min(u32::MAX as usize) as u32;
        let mut cost = MilitaryCost::for_company(kind, mustering_count);
        cost.padded_armor += members.iter().filter(|m| m.optional_armor == 1).count() as u32;
        cost.mail_armor += members.iter().filter(|m| m.optional_armor == 2).count() as u32;
        let mut complete = true;
        for (commodity, amount) in military_equipment_costs(cost) {
            if amount == 0 {
                continue;
            }
            let desired = amount as f64;
            if building_commodity_stock(&source, commodity) + 1e-6 < desired {
                complete = false;
                request_connected_commodity(
                    ctx,
                    tick,
                    clock,
                    &source,
                    commodity,
                    equipment_source_kinds(commodity),
                    desired,
                );
            }
        }
        let cavalry_issue = kind.is_mounted().then(|| {
            let ration = cavalry_daily_ration();
            let horse_days = mustering_count as f64 * CAVALRY_HORSE_FIELD_ISSUE_DAYS;
            [
                (CommodityKind::OatGrain, ration.oats * horse_days),
                (CommodityKind::Water, ration.water * horse_days),
            ]
        });
        if let Some(issue) = cavalry_issue {
            for (commodity, amount) in issue {
                if amount <= 1e-6 {
                    continue;
                }
                if building_commodity_stock(&source, commodity) + 1e-6 < amount {
                    complete = false;
                    request_connected_commodity(
                        ctx,
                        tick,
                        clock,
                        &source,
                        commodity,
                        cavalry_supply_source_kinds(commodity),
                        amount,
                    );
                }
            }
        }
        if !complete {
            continue;
        }
        let all_at_muster = members.iter().all(|member| {
            ctx.db
                .combat_agent()
                .id()
                .find(&member.combat_agent_id)
                .is_some_and(|agent| (agent.x - source.x).hypot(agent.z - source.z) <= 2.3)
        });
        if !all_at_muster {
            continue;
        }
        for (commodity, amount) in military_equipment_costs(cost) {
            if amount > 0 {
                withdraw_building_commodity(&mut source, commodity, amount as f64);
            }
        }
        if let Some(issue) = cavalry_issue {
            for (commodity, amount) in issue {
                if amount <= 1e-6 {
                    continue;
                }
                let issued = withdraw_building_commodity(&mut source, commodity, amount);
                match commodity {
                    CommodityKind::OatGrain => company.horse_oats += issued,
                    CommodityKind::Water => company.horse_water += issued,
                    _ => {}
                }
            }
        }
        ctx.db.building().id().update(source);
        let stats = military_stats(kind);
        let joining_ids = members.iter().map(|member| member.combat_agent_id).collect::<Vec<_>>();
        for mut member in members {
            let Some(mut agent) = ctx.db.combat_agent().id().find(&member.combat_agent_id) else {
                continue;
            };
            member.phase = 1;
            member.ammunition = stats.ammunition_per_member;
            member.ammunition_capacity = stats.ammunition_per_member;
            ctx.db
                .military_member()
                .combat_agent_id()
                .update(member.clone());
            let mut kit = equipped_member_kit(kind, agent.source_slot);
            if member.optional_armor == 1 { kit.padded_armor = 1.0; }
            if member.optional_armor == 2 { kit.mail_armor = 1.0; }
            agent.carried_loot_json = serde_json::to_string(&kit).unwrap_or_default();
            agent.state = 9;
            agent.target_kind = 6;
            agent.target_id = 0;
            ctx.db.combat_agent().id().update(agent);
        }
        company.state = 1;
        let living_members = ctx
            .db
            .military_member()
            .company_id()
            .filter(&company.id)
            .filter(|member| {
                ctx.db
                    .combat_agent()
                    .id()
                    .find(&member.combat_agent_id)
                    .is_some_and(|agent| agent.state != 5 && agent.health > 0.0)
            })
            .collect::<Vec<_>>();
        company.living_members = living_members.len().min(u32::MAX as usize) as u32;
        company.ammunition_capacity = living_members
            .iter()
            .map(|member| member.ammunition_capacity)
            .sum();
        company.ammunition = living_members.iter().map(|member| member.ammunition).sum();
        super::military::join_mustered_members(ctx, &company, &joining_ids);
        ctx.db.military_company().id().update(company);
    }
    step_cavalry_company_field_resupply(ctx, tick, clock);
}

fn step_cavalry_yard_requisitions(ctx: &ReducerContext, tick: &SimTickContext, clock: &GameClock) {
    let yards = ctx
        .db
        .building()
        .iter()
        .filter(|building| {
            building.kind == "cavalry_yard"
                && building.construction_complete
                && building.assigned_labor > 0
                && !tick.building_disabled_by_fire(ctx, building.id)
        })
        .collect::<Vec<_>>();
    for yard in yards {
        // The yard owns no mounts and keeps no stable inventory. It stages
        // only field-resupply stock for mounted companies formed here.
        let deployed = ctx
            .db
            .military_company()
            .iter()
            .filter(|company| {
                company.source_building_id == yard.id
                    && company.state == 1
                    && MilitaryKind::from_id(company.kind).is_some_and(MilitaryKind::is_mounted)
            })
            .map(|company| f64::from(company.living_members))
            .sum::<f64>();
        if deployed <= 0.0 {
            continue;
        }
        let ration = cavalry_daily_ration();
        let requests = [
            (
                CommodityKind::OatGrain,
                &[
                    "threshing_barn",
                    "granary",
                    "village_storehouse",
                    "trading_post",
                    "founders_camp",
                ][..],
                ration.oats,
            ),
            (
                CommodityKind::Water,
                &[
                    "well",
                    "village_storehouse",
                    "trading_post",
                    "founders_camp",
                ][..],
                ration.water,
            ),
        ];
        for (commodity, source_kinds, daily_per_horse) in requests {
            if daily_per_horse <= 1e-6 {
                continue;
            }
            let desired = (deployed * daily_per_horse * CAVALRY_HORSE_FIELD_TARGET_DAYS)
                .min(building_commodity_cap(&yard.kind, commodity));
            request_connected_commodity(ctx, tick, clock, &yard, commodity, source_kinds, desired);
        }
    }
}

fn cavalry_supply_source_kinds(commodity: CommodityKind) -> &'static [&'static str] {
    match commodity {
        CommodityKind::OatGrain => &[
            "threshing_barn",
            "granary",
            "village_storehouse",
            "trading_post",
            "founders_camp",
        ],
        CommodityKind::Water => &[
            "well",
            "village_storehouse",
            "trading_post",
            "founders_camp",
        ],
        _ => &[],
    }
}

fn step_cavalry_company_field_resupply(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
) {
    let ration = cavalry_daily_ration();
    let companies = ctx
        .db
        .military_company()
        .iter()
        .filter(|company| {
            company.state == 1
                && company.living_members > 0
                && MilitaryKind::from_id(company.kind).is_some_and(MilitaryKind::is_mounted)
        })
        .collect::<Vec<_>>();
    for company in companies {
        let members = ctx
            .db
            .military_member()
            .company_id()
            .filter(&company.id)
            .collect::<Vec<_>>();
        if members.is_empty()
            || members.iter().all(|member| member.residence_id == 0)
            || members.iter().any(|member| {
                ctx.db
                    .combat_agent()
                    .id()
                    .find(&member.combat_agent_id)
                    .is_none_or(|agent| {
                        agent.state != 9 || agent.velocity_x.hypot(agent.velocity_z) > 0.15
                    })
            })
        {
            continue;
        }
        let positions = members
            .iter()
            .filter_map(|member| ctx.db.combat_agent().id().find(&member.combat_agent_id))
            .map(|agent| (agent.x, agent.z))
            .collect::<Vec<_>>();
        if positions.is_empty() {
            continue;
        }
        let count = positions.len() as f64;
        let (sum_x, sum_z) = positions.into_iter().fold((0.0, 0.0), |(x, z), position| {
            (x + position.0, z + position.1)
        });
        let (target_x, target_z) = (sum_x / count, sum_z / count);
        let living = company.living_members as f64;
        let mut needs = [
            (
                CommodityKind::OatGrain,
                company.horse_oats,
                ration.oats,
                company.horse_oats / (living * ration.oats).max(1e-9),
            ),
            (
                CommodityKind::Water,
                company.horse_water,
                ration.water,
                company.horse_water / (living * ration.water).max(1e-9),
            ),
        ];
        if needs
            .iter()
            .all(|(_, _, _, runway)| *runway > CAVALRY_HORSE_FIELD_REORDER_DAYS)
        {
            continue;
        }
        needs.sort_by(|left, right| left.3.total_cmp(&right.3));
        let Some(mut yard) = ctx
            .db
            .building()
            .id()
            .find(&company.source_building_id)
            .filter(|yard| {
                yard.kind == "cavalry_yard"
                    && yard.construction_complete
                    && yard.assigned_labor > 0
                    && !tick.building_disabled_by_fire(ctx, yard.id)
            })
        else {
            continue;
        };
        let Some(network) = tick.road_network(company.owner) else {
            continue;
        };
        for (commodity, stock, daily_per_horse, runway) in needs {
            if runway > CAVALRY_HORSE_FIELD_REORDER_DAYS {
                continue;
            }
            let target_stock = living * daily_per_horse * CAVALRY_HORSE_FIELD_TARGET_DAYS;
            let needed = (target_stock - stock).max(0.0);
            if try_start_cavalry_company_supply_trip(
                ctx, tick, clock, network, &mut yard, company.id, target_x, target_z, commodity,
                needed,
            ) {
                break;
            }
        }
    }
}

pub fn step_potter_kiln(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    building: Building,
) {
    let firing_roof_tiles = potter_fires_roof_tiles(building.potter_firing_policy);
    let output = if firing_roof_tiles {
        (CommodityKind::RoofTiles, POTTER_ROOF_TILES_PER_CYCLE)
    } else {
        (CommodityKind::Pottery, POTTER_POTTERY_PER_CYCLE)
    };
    let potter = step_processor(
        ctx,
        tick,
        clock,
        building,
        &[
            (CommodityKind::Clay, POTTER_CLAY_PER_CYCLE),
            (CommodityKind::Firewood, POTTER_FIREWOOD_PER_CYCLE),
            (CommodityKind::Water, POTTER_WATER_PER_CYCLE),
        ],
        &[output],
    );
    ctx.db.building().id().update(potter);
}

pub fn step_apiary(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    mut building: Building,
) {
    let forage_score = apiary_landscape_forage_score(ctx, &building)
        * tick.land_use_profile(ctx).pollination_multiplier();
    building.apiary_forage_score = forage_score;
    building.apiary_colony_health = building.apiary_colony_health.clamp(0.35, 1.10);

    if clock.month == 12 && building.apiary_last_winter_year != clock.year {
        // Honey left in the comb after the Autumn extraction window does not
        // survive as a second hidden crop for next year.
        building.apiary_accumulated_honey = 0.0;
        let winter_honey = building.honey.min(APIARY_WINTER_HONEY_REQUIRED).max(0.0);
        withdraw_building_commodity(&mut building, CommodityKind::Honey, winter_honey);
        building.apiary_colony_health =
            next_apiary_colony_health(building.apiary_colony_health, winter_honey);
        building.apiary_last_winter_year = clock.year;
    }

    let production_rate = apiary_production_multiplier(
        building.apiary_harvest_policy,
        forage_score,
        building.apiary_colony_health,
    );
    let mut apiary = if apiary_is_accumulating(clock.month as u8) {
        accumulate_apiary_yield_cycle(ctx, tick, clock, building, production_rate)
    } else if apiary_is_harvesting(clock.month as u8) {
        harvest_accumulated_apiary_yield(ctx, tick, clock, building)
    } else {
        building
    };

    // Beeswax is the scarce industrial by-product. Give an operating
    // chandlery first claim before the apiary's single cart is occupied by
    // routine honey dispatch; staffed storage and regional trade remain
    // fallbacks when no workshop currently needs the batch.
    dispatch_to_building_where(
        ctx,
        tick,
        clock,
        &mut apiary,
        CommodityKind::Wax,
        &["chandlery"],
        |target| target.assigned_labor > 0,
    );
    dispatch_to_building_where(
        ctx,
        tick,
        clock,
        &mut apiary,
        CommodityKind::Wax,
        &["village_storehouse"],
        |target| target.assigned_labor > 0 && storage_accepts_commodity(target, CommodityKind::Wax),
    );
    dispatch_to_building_where(
        ctx,
        tick,
        clock,
        &mut apiary,
        CommodityKind::Wax,
        &["trading_post"],
        |target| target.assigned_labor > 0 && storage_accepts_commodity(target, CommodityKind::Wax),
    );

    let reserve = apiary_honey_reserve(apiary.apiary_harvest_policy);
    let transferable = (apiary.honey - reserve).max(0.0);
    dispatch_to_building_where_limited(
        ctx,
        tick,
        clock,
        &mut apiary,
        CommodityKind::Honey,
        &["brewery"],
        transferable,
        |target| target.assigned_labor > 0,
    );
    let transferable = (apiary.honey - reserve).max(0.0);
    dispatch_to_building_where_limited(
        ctx,
        tick,
        clock,
        &mut apiary,
        CommodityKind::Honey,
        &["granary"],
        transferable,
        |target| storage_accepts_commodity(target, CommodityKind::Honey),
    );
    let transferable = (apiary.honey - reserve).max(0.0);
    dispatch_to_building_where_limited(
        ctx,
        tick,
        clock,
        &mut apiary,
        CommodityKind::Honey,
        &["trading_post"],
        transferable,
        |_| true,
    );
    ctx.db.building().id().update(apiary);
}

/// Spring and Summer hive work builds an internal crop rather than placing
/// harvest-ready Honey directly into the building store. The crop advances in
/// whole authored batches, so the hidden seasonal ledger cannot introduce
/// fractional physical inventory.
fn accumulate_apiary_yield_cycle(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    mut apiary: Building,
    throughput_multiplier: f64,
) -> Building {
    let Some(labor) =
        cycle_labor_if_ready_at_rate(ctx, tick, clock, &mut apiary, false, throughput_multiplier)
    else {
        return apiary;
    };
    let batch = whole_units(APIARY_HONEY_PER_CYCLE);
    if batch < 1.0 {
        return apiary;
    }
    apiary.apiary_accumulated_honey = whole_units(apiary.apiary_accumulated_honey.max(0.0)) + batch;
    reset_cycle(&mut apiary, labor);
    apiary
}

/// Autumn extraction transfers every complete accumulated batch that fits in
/// the physical store during one staffed work cycle. Storage pressure can
/// therefore spread the harvest across Autumn without leaking Honey earlier.
fn harvest_accumulated_apiary_yield(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    mut apiary: Building,
) -> Building {
    let batch = whole_units(APIARY_HONEY_PER_CYCLE);
    if batch < 1.0 {
        return apiary;
    }
    let accumulated = whole_units(apiary.apiary_accumulated_honey.max(0.0));
    let available_batches = (accumulated / batch).floor();
    let honey_room = whole_units(building_commodity_room(&apiary, CommodityKind::Honey));
    let fitting_batches = (honey_room / batch).floor();
    let harvested_batches = available_batches.min(fitting_batches);
    if harvested_batches < 1.0 {
        return apiary;
    }
    let Some(labor) = cycle_labor_if_ready_at_rate(ctx, tick, clock, &mut apiary, false, 1.0)
    else {
        return apiary;
    };
    let honey = harvested_batches * batch;
    let stored = deposit_building_commodity(&mut apiary, CommodityKind::Honey, honey);
    if stored + 1e-6 < honey {
        return apiary;
    }
    apiary.apiary_accumulated_honey = (accumulated - stored).max(0.0);
    for _ in 0..harvested_batches as u32 {
        record_apiary_honey_harvest_wax(&mut apiary);
    }
    reset_cycle(&mut apiary, labor);
    apiary
}

/// Record one successful honey extraction toward a whole wax batch. A full
/// wax shelf retains the due progress but never blocks the apiary's primary
/// honey cycle; once room exists, a later successful extraction realizes the
/// pending batch.
fn record_apiary_honey_harvest_wax(apiary: &mut Building) {
    let (progress, wax_batch) = plan_apiary_wax_harvest(
        apiary.apiary_wax_cycle_progress,
        building_commodity_room(apiary, CommodityKind::Wax),
    );
    apiary.apiary_wax_cycle_progress = progress;
    let Some(wax_batch) = wax_batch else {
        return;
    };
    if deposit_building_commodity(apiary, CommodityKind::Wax, wax_batch) + 1e-6 >= wax_batch {
        apiary.apiary_wax_cycle_progress = 0;
    }
}

fn plan_apiary_wax_harvest(current_progress: u8, wax_room: f64) -> (u8, Option<f64>) {
    let cycles_per_wax = APIARY_WAX_PER_HONEY_CYCLES.max(1);
    let progress = if current_progress < cycles_per_wax {
        current_progress.saturating_add(1)
    } else {
        current_progress
    };
    let wax_batch = whole_units(APIARY_WAX_PER_HARVEST);
    let can_fit = progress >= cycles_per_wax
        && wax_batch >= 1.0
        && wax_room.is_finite()
        && wax_room + 1e-6 >= wax_batch;
    (progress, can_fit.then_some(wax_batch))
}

#[cfg(test)]
mod apiary_wax_tests {
    use super::{plan_apiary_wax_harvest, APIARY_WAX_PER_HARVEST, APIARY_WAX_PER_HONEY_CYCLES};
    use crate::resource_units::whole_units;

    #[test]
    fn due_wax_progress_waits_for_whole_batch_room() {
        let threshold = APIARY_WAX_PER_HONEY_CYCLES.max(1);
        let wax_batch = whole_units(APIARY_WAX_PER_HARVEST);

        assert_eq!(
            plan_apiary_wax_harvest(threshold.saturating_sub(1), 0.0),
            (threshold, None)
        );
        assert_eq!(
            plan_apiary_wax_harvest(threshold, wax_batch),
            (threshold, Some(wax_batch))
        );
    }
}

fn advance_monastery_vineyard_fermentation(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    monastery: &mut Building,
) {
    if ctx
        .db
        .vineyard_parcel()
        .building_id()
        .filter(&monastery.id)
        .next()
        .is_none()
    {
        monastery.vineyard_fermenting_grapes = 0.0;
        monastery.vineyard_fermentation_progress = 0.0;
        return;
    }
    let onsite_labor = onsite_building_labor(ctx, monastery);
    if onsite_labor == 0 || labor_and_logistics_paused(ctx, tick, monastery.owner, clock) {
        return;
    }

    if monastery.vineyard_fermenting_grapes <= 1e-9 {
        let available = fermentable_grapes(monastery.grapes);
        if available + 1e-6 < VINEYARD_GRAPES_PER_FERMENTATION_BATCH
            || building_commodity_room(monastery, CommodityKind::Wine) + 1e-6
                < VINEYARD_WINE_PER_FERMENTATION_BATCH
        {
            monastery.vineyard_fermentation_progress = 0.0;
            return;
        }
        let staged = withdraw_building_commodity(
            monastery,
            CommodityKind::Grapes,
            VINEYARD_GRAPES_PER_FERMENTATION_BATCH,
        );
        if staged + 1e-6 < VINEYARD_GRAPES_PER_FERMENTATION_BATCH {
            deposit_building_commodity(monastery, CommodityKind::Grapes, staged);
            return;
        }
        monastery.vineyard_fermenting_grapes = staged;
        monastery.vineyard_fermentation_progress = 0.0;
    }

    monastery.vineyard_fermentation_progress += TICK_DT * onsite_labor as f64;
    if monastery.vineyard_fermentation_progress + 1e-6 < VINEYARD_FERMENTATION_SECONDS
        || building_commodity_room(monastery, CommodityKind::Wine) + 1e-6
            < VINEYARD_WINE_PER_FERMENTATION_BATCH
    {
        return;
    }

    deposit_building_commodity(
        monastery,
        CommodityKind::Wine,
        VINEYARD_WINE_PER_FERMENTATION_BATCH,
    );
    monastery.vineyard_fermenting_grapes = 0.0;
    monastery.vineyard_fermentation_progress = 0.0;
}

fn apiary_landscape_forage_score(ctx: &ReducerContext, apiary: &Building) -> f64 {
    let radius_sq = apiary.work_radius.max(1.0).powi(2);
    let mature_trees = ctx
        .db
        .tree_entity()
        .iter()
        .filter(|tree| {
            tree.phase == "mature"
                && (tree.x - apiary.x).powi(2) + (tree.z - apiary.z).powi(2) <= radius_sq
        })
        .count() as u32;

    let mut orchards = 0u32;
    let mut flower_gardens = 0u32;
    for garden in ctx.db.backyard_garden().owner().filter(&apiary.owner) {
        let Some(residence) = ctx.db.residence().id().find(&garden.residence_id) else {
            continue;
        };
        if (residence.x - apiary.x).powi(2) + (residence.z - apiary.z).powi(2) > radius_sq {
            continue;
        }
        match BackyardGardenKind::from_id(garden.kind) {
            Some(BackyardGardenKind::AppleOrchard | BackyardGardenKind::CherryOrchard) => {
                orchards += 1
            }
            Some(BackyardGardenKind::FlowerGarden | BackyardGardenKind::HerbGarden) => {
                flower_gardens += 1
            }
            _ => {}
        }
    }

    let vineyard_area = ctx
        .db
        .vineyard_parcel()
        .owner()
        .filter(&apiary.owner)
        .filter_map(|parcel| {
            let x =
                (parcel.corner_ax + parcel.corner_bx + parcel.corner_cx + parcel.corner_dx) * 0.25;
            let z =
                (parcel.corner_az + parcel.corner_bz + parcel.corner_cz + parcel.corner_dz) * 0.25;
            ((x - apiary.x).powi(2) + (z - apiary.z).powi(2) <= radius_sq)
                .then_some(parcel.area.max(0.0))
        })
        .sum();

    apiary_forage_score(mature_trees, orchards, flower_gardens, vineyard_area)
}

pub(crate) fn nearby_apiary_pollination_multiplier(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    owner: spacetimedb::Identity,
    x: f64,
    z: f64,
) -> f64 {
    let full_apiary_contribution: f64 = tick
        .building_ids_for_kinds(ctx, owner, &["apiary"])
        .into_iter()
        .filter_map(|building_id| ctx.db.building().id().find(&building_id))
        .filter(|apiary| {
            apiary.construction_complete && !tick.building_disabled_by_fire(ctx, apiary.id)
        })
        .map(|apiary| {
            let distance = ((apiary.x - x).powi(2) + (apiary.z - z).powi(2)).sqrt();
            pollination_contribution(distance, apiary.work_radius, apiary.apiary_colony_health)
        })
        .sum();
    let backyard_contribution: f64 = ctx
        .db
        .backyard_garden()
        .owner()
        .filter(&owner)
        .filter(|garden| garden.kind == BackyardGardenKind::BackyardApiary as u8)
        .filter_map(|garden| ctx.db.residence().id().find(&garden.residence_id))
        .filter(|residence| {
            residence.population > 0 && !tick.residence_disabled_by_fire(ctx, residence.id)
        })
        .map(|residence| {
            let distance = ((residence.x - x).powi(2) + (residence.z - z).powi(2)).sqrt();
            let reach =
                (1.0 - distance / BACKYARD_APIARY_POLLINATION_RADIUS.max(1.0)).clamp(0.0, 1.0);
            BACKYARD_APIARY_POLLINATION_CONTRIBUTION * reach
        })
        .sum();
    let landscape_multiplier = tick.land_use_profile(ctx).pollination_multiplier();
    pollination_multiplier(
        (full_apiary_contribution + backyard_contribution) * landscape_multiplier,
    )
}

pub fn step_monastery(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    building: Building,
) {
    // The estate is an inhabited religious house, not autonomous scenery.
    // With nobody on site there is no farming, hospitality, infirmary care,
    // archive work, reinvestment, or dispatch of new export carts.
    let onsite_labor = onsite_building_labor(ctx, &building);
    if onsite_labor == 0 {
        return;
    }
    let linked = monastery_has_parish_link(ctx, tick, &building);
    let productivity = if linked {
        1.0
    } else {
        MONASTERY_UNLINKED_PRODUCTIVITY
    };
    let mut monastery = building;
    let (vineyard_area, vineyard_site, vineyard_shape, vineyard_pollination) = ctx
        .db
        .vineyard_parcel()
        .building_id()
        .filter(&monastery.id)
        .fold((0.0, 0.0, 0.0, 0.0), |totals, parcel| {
            let area = parcel.area.max(0.0);
            let x =
                (parcel.corner_ax + parcel.corner_bx + parcel.corner_cx + parcel.corner_dx) * 0.25;
            let z =
                (parcel.corner_az + parcel.corner_bz + parcel.corner_cz + parcel.corner_dz) * 0.25;
            (
                totals.0 + area,
                totals.1 + parcel.site_suitability * area,
                totals.2 + parcel.shape_efficiency * area,
                totals.3
                    + nearby_apiary_pollination_multiplier(ctx, tick, monastery.owner, x, z) * area,
            )
        });
    // Aggregate before applying the diminishing area curve so splitting the
    // same acreage into many snapped parcels never creates free production.
    let vineyard_production_multiplier = if vineyard_area > 1e-9 {
        crate::vineyard::production_multiplier(
            vineyard_area,
            vineyard_site / vineyard_area,
            vineyard_shape / vineyard_area,
        ) * (vineyard_pollination / vineyard_area)
    } else {
        0.0
    };
    let orchard_maturity =
        monastery_orchard_maturity_for_year(monastery.monastery_orchard_planted_year, clock.year);
    monastery.monastery_orchard_maturity = orchard_maturity;
    if let Some(productive_labor) = cycle_labor_if_ready(ctx, tick, clock, &mut monastery, false) {
        let full_crew = building_def("monastery")
            .map(|definition| definition.max_labor.max(1) as f64)
            .unwrap_or(1.0);
        let staffing = (productive_labor / full_crew).clamp(0.0, 1.0);
        let yields = monastery_estate_yields(
            monastery.monastery_extensions,
            monastery.monastery_orchard_planting,
            monastery.monastery_croft_planting,
            orchard_maturity,
        );
        for (yield_index, (commodity, amount)) in [
            (CommodityKind::Apples, yields.apples),
            (CommodityKind::Pears, yields.pears),
            (CommodityKind::Cabbage, yields.cabbage),
            (CommodityKind::Carrots, yields.carrots),
            (CommodityKind::Beetroot, yields.beetroot),
            (CommodityKind::Eggs, yields.eggs),
            (CommodityKind::Milk, yields.milk),
            (CommodityKind::Meat, yields.meat),
            (CommodityKind::Honey, yields.honey),
            (CommodityKind::Cider, yields.cider),
            (CommodityKind::Mead, yields.mead),
            (CommodityKind::Cheese, yields.cheese),
        ]
        .into_iter()
        .enumerate()
        {
            let lot = deterministic_whole_lot(
                amount * productivity * staffing,
                monastery.id ^ ((yield_index as u64 + 1) * 0x9E37),
                clock.sim_tick,
            );
            deposit_building_commodity(&mut monastery, commodity, lot);
        }
        if vineyard_is_harvesting(clock.month as u8) {
            if vineyard_production_multiplier > 1e-9 {
                let grapes = deterministic_whole_lot(
                    VINEYARD_GRAPES_PER_HARVEST_CYCLE
                        * vineyard_production_multiplier
                        * productivity
                        * staffing,
                    monastery.id ^ 0x4752_4150_4553,
                    clock.sim_tick,
                );
                deposit_building_commodity(&mut monastery, CommodityKind::Grapes, grapes);
            }
        }
        reset_cycle(&mut monastery, 1.0);
    }
    advance_monastery_vineyard_fermentation(ctx, tick, clock, &mut monastery);

    let hospitality_enabled = tick.monastery_hospitality_enabled(ctx, monastery.owner);
    let mut receipt_daily_income = MONASTERY_PILGRIMAGE_GOLD_PER_DAY;
    // Services are paid from coin already retained at the house. Today's
    // offerings replenish that purse for future days rather than funding the
    // very hospitality that generated them.
    fund_monastery_services(&mut monastery, clock.total_days);
    if linked
        && owner_has_connected_marketplace(ctx, tick, &monastery)
        && daily_household_bill_due(clock)
    {
        // A small liturgical wine allowance belongs to ordinary overhead.
        // Public hospitality requires honey and whichever estate drink this
        // house actually makes; no planting pair is a mandatory recipe.
        let hospitality = monastery_daily_hospitality_use(
            monastery.honey,
            monastery.cider,
            monastery.mead,
            monastery.wine,
            monastery.monastery_service_funding,
            monastery.id,
            clock.total_days,
            hospitality_enabled,
        );
        withdraw_building_commodity(&mut monastery, CommodityKind::Honey, hospitality.honey_used);
        withdraw_building_commodity(&mut monastery, CommodityKind::Cider, hospitality.cider_used);
        withdraw_building_commodity(&mut monastery, CommodityKind::Mead, hospitality.mead_used);
        withdraw_building_commodity(&mut monastery, CommodityKind::Wine, hospitality.wine_used);
        receipt_daily_income = monastery_pilgrimage_gold(
            hospitality_enabled,
            hospitality.supply_ratio,
            hospitality.prestige_multiplier
                * monastery_liturgy_prestige_multiplier(monastery.candles),
            monastery_guesthouse_multiplier(
                monastery.monastery_extensions,
                monastery.monastery_service_funding,
            ),
            CALENDAR_SECONDS_PER_DAY,
            CALENDAR_SECONDS_PER_DAY,
        );
        let gold = periodic_whole_units(
            receipt_daily_income,
            monastery.id ^ 0x5049_4C47_5249_4D,
            clock.total_days,
        );
        let credited = credit_monastery_export_receipt(ctx, &mut monastery, gold);
        if let Some(mut treasury) = ctx.db.player_resources().owner().find(&monastery.owner) {
            treasury.monastery_pilgrimage_gold_total +=
                credited.estate_income + credited.export_duty;
            ctx.db.player_resources().owner().update(treasury);
        }
    }
    if linked {
        // Scheduled communal hospitality claims its complete pantry batch
        // before ordinary household carts. This makes feast preparation a
        // predictable reserve decision instead of a race with the noon route.
        run_monastery_feast(ctx, tick, clock, &mut monastery);
        request_monastery_seed_archive(ctx, tick, clock, &monastery);
    }
    dispatch_monastery_vineyard_wine(ctx, tick, clock, &mut monastery, hospitality_enabled);
    try_dispatch_local_civic_receipts(ctx, tick, clock, &mut monastery, receipt_daily_income);
    reinvest_monastery_estate(&mut monastery);
    dispatch_monastery_estate_export(ctx, tick, &mut monastery, hospitality_enabled);
    ctx.db.building().id().update(monastery);
}

/// The agricultural archive is a physical emergency reserve rather than a
/// yield modifier. It draws only exportable grain from road-linked farmsteads
/// and granaries, keeps a balanced three-crop collection, and is itself an
/// eligible seed source when a holding cannot cover its next sowing.
fn request_monastery_seed_archive(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    monastery: &Building,
) {
    let seed_target = monastery_seed_archive_target_per_crop(
        monastery.monastery_extensions,
        monastery.monastery_service_funding,
    );
    for (commodity, desired) in [
        (CommodityKind::RyeGrain, seed_target),
        (CommodityKind::OatGrain, seed_target),
        (CommodityKind::MaslinGrain, seed_target),
    ] {
        request_connected_commodity(
            ctx,
            tick,
            clock,
            monastery,
            commodity,
            &["threshing_barn", "granary"],
            desired,
        );
    }
}

fn reinvest_monastery_estate(monastery: &mut Building) {
    let private_gold = whole_units((monastery.gold - monastery.civic_receipts_gold).max(0.0));
    if !monastery_estate_can_reinvest(
        monastery.monastery_extensions,
        monastery.monastery_next_extension,
        private_gold,
    ) {
        return;
    }
    let Some(cost) = monastery_estate_next_investment_cost(
        monastery.monastery_extensions,
        monastery.monastery_next_extension,
    ) else {
        return;
    };
    let cost = whole_cost(cost);
    let spent = withdraw_building_commodity(monastery, CommodityKind::Gold, cost);
    if spent >= cost {
        monastery.monastery_extensions |= monastery.monastery_next_extension;
        monastery.monastery_next_extension = 0;
        monastery.chapel_tier = monastery_extension_count(monastery.monastery_extensions).min(3);
        monastery.private_export_proceeds_gold = monastery
            .private_export_proceeds_gold
            .min((monastery.gold - monastery.civic_receipts_gold.max(0.0)).max(0.0));
    } else {
        deposit_building_commodity(monastery, CommodityKind::Gold, spent);
    }
}

fn fund_monastery_services(monastery: &mut Building, total_days: u64) {
    if monastery.monastery_last_service_day == total_days {
        return;
    }
    monastery.monastery_last_service_day = total_days;
    let due = periodic_whole_units(
        monastery_daily_service_cost(monastery.monastery_extensions),
        monastery.id ^ 0x5345_5256_4943_45,
        total_days,
    );
    let private_gold =
        whole_units((monastery.gold - monastery.civic_receipts_gold.max(0.0)).max(0.0));
    let paid = due.min(private_gold);
    if paid > 1e-9 {
        withdraw_building_commodity(monastery, CommodityKind::Gold, paid);
    }
    monastery.private_export_proceeds_gold = monastery
        .private_export_proceeds_gold
        .min((monastery.gold - monastery.civic_receipts_gold.max(0.0)).max(0.0));
    monastery.monastery_service_funding = if due <= 1e-9 {
        1.0
    } else {
        (paid / due).clamp(0.0, 1.0)
    };
}

fn dispatch_monastery_vineyard_wine(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    monastery: &mut Building,
    hospitality_enabled: bool,
) {
    if monastery.wine <= 1e-6
        || building_has_active_trip(ctx, monastery.id)
        || onsite_building_labor(ctx, monastery) == 0
    {
        return;
    }
    let drink_floor = if hospitality_enabled {
        MONASTERY_FEAST_DRINK
    } else {
        6.0
    };
    let drink_surplus =
        (monastery.cider.max(0.0) + monastery.mead.max(0.0) + monastery.wine.max(0.0)
            - drink_floor)
            .max(0.0);
    let transferable = monastery_estate_exportable(monastery.wine, 0.0).min(drink_surplus);
    if transferable <= 1e-6 {
        return;
    }
    let Some(network) = tick.road_network(monastery.owner) else {
        return;
    };
    let Some(target) = tick
        .building_ids_for_kinds(ctx, monastery.owner, &["granary"])
        .into_iter()
        .filter_map(|id| ctx.db.building().id().find(&id))
        .filter(|granary| {
            granary.construction_complete
                && !tick.building_disabled_by_fire(ctx, granary.id)
                && storage_accepts_commodity(granary, CommodityKind::Wine)
                && building_commodity_room(granary, CommodityKind::Wine) > 1e-6
                && !building_has_inbound_commodity_trip(ctx, granary.id, CommodityKind::Wine)
        })
        .filter_map(|granary| {
            local_delivery_distance(network, monastery.x, monastery.z, granary.x, granary.z)
                .map(|distance| (distance, granary))
        })
        .min_by(|left, right| {
            left.0
                .total_cmp(&right.0)
                .then_with(|| left.1.id.cmp(&right.1.id))
        })
        .map(|(_, granary)| granary)
    else {
        return;
    };
    let needed = transferable.min(building_commodity_room(&target, CommodityKind::Wine));
    try_start_origin_rostered_building_supply_trip(
        ctx,
        tick,
        clock,
        network,
        monastery,
        &target,
        1,
        CommodityKind::Wine,
        TIMBER_DELIVERY_SPEED_MPS,
        TIMBER_DELIVERY_UNLOAD_SEC,
        commodity_transfer_per_trip(CommodityKind::Wine),
        needed,
    );
}

fn dispatch_monastery_estate_export(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    monastery: &mut Building,
    hospitality_enabled: bool,
) {
    if building_has_regional_market_trip(ctx, monastery.id) {
        return;
    }
    let Some(network) = tick.road_network(monastery.owner) else {
        return;
    };
    let honey_floor = if hospitality_enabled {
        MONASTERY_FEAST_HONEY
    } else {
        4.0
    };
    let infirmary_food_floor = monastery_infirmary_beds(
        monastery.monastery_extensions,
        monastery.monastery_service_funding,
    ) as f64
        * MONASTERY_INFIRMARY_FOOD_PER_BED_DAY;
    let feast_food_floor = if hospitality_enabled {
        MONASTERY_FEAST_FOOD
    } else {
        0.0
    };
    let non_honey_meals = (building_edible_food_stock(monastery)
        - monastery.honey.max(0.0) * CommodityKind::Honey.meal_value())
    .max(0.0);
    let food_surplus_meals = (non_honey_meals - infirmary_food_floor - feast_food_floor).max(0.0);
    let food_exportable = |commodity: CommodityKind, stock: f64| {
        let meal_value = commodity.meal_value();
        if meal_value <= 1e-9 {
            return 0.0;
        }
        monastery_estate_exportable(stock, 0.0).min(food_surplus_meals / meal_value)
    };
    let candidates = [
        (
            CommodityKind::Apples,
            food_exportable(CommodityKind::Apples, monastery.apples),
        ),
        (
            CommodityKind::Pears,
            food_exportable(CommodityKind::Pears, monastery.pears),
        ),
        (
            CommodityKind::Cabbage,
            food_exportable(CommodityKind::Cabbage, monastery.cabbage),
        ),
        (
            CommodityKind::Carrots,
            food_exportable(CommodityKind::Carrots, monastery.carrots),
        ),
        (
            CommodityKind::Beetroot,
            food_exportable(CommodityKind::Beetroot, monastery.beetroot),
        ),
        (
            CommodityKind::Eggs,
            food_exportable(CommodityKind::Eggs, monastery.eggs),
        ),
        (
            CommodityKind::Milk,
            food_exportable(CommodityKind::Milk, monastery.milk),
        ),
        (
            CommodityKind::Meat,
            food_exportable(CommodityKind::Meat, monastery.meat),
        ),
        (
            CommodityKind::Cheese,
            food_exportable(CommodityKind::Cheese, monastery.cheese),
        ),
        (
            CommodityKind::Honey,
            monastery_estate_exportable(monastery.honey, honey_floor),
        ),
    ];
    let Some((commodity, amount)) = candidates
        .into_iter()
        .filter(|(_, amount)| *amount > 1e-6)
        .max_by(|left, right| left.1.total_cmp(&right.1))
    else {
        return;
    };
    let Ok(route) = regional_market_export_route(ctx, network, monastery) else {
        return;
    };
    let withdrawn = withdraw_building_commodity(monastery, commodity, amount);
    if !start_regional_market_export_trip(
        ctx,
        tick,
        network,
        monastery,
        0,
        commodity,
        withdrawn,
        TIMBER_DELIVERY_SPEED_MPS,
        TIMBER_DELIVERY_UNLOAD_SEC,
        route,
    ) {
        deposit_building_commodity(monastery, commodity, withdrawn);
    }
}

pub fn step_carpenter(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    mut building: Building,
) {
    let cart_service_timber =
        carpenter_cart_service_timber_target(building.carpenter_cart_service_target_trips);
    let cart_service_ironwork =
        carpenter_cart_service_ironwork_target(building.carpenter_cart_service_target_trips);
    request_connected_commodity(
        ctx,
        tick,
        clock,
        &building,
        CommodityKind::Timber,
        &["lumber_mill", "village_storehouse"],
        cart_service_timber,
    );
    request_connected_commodity(
        ctx,
        tick,
        clock,
        &building,
        CommodityKind::Ironwork,
        &["smithy", "trading_post"],
        cart_service_ironwork,
    );

    let polearm_shortfall =
        carpenter_polearm_shortfall(building.polearms, building.carpenter_polearm_reserve);
    if polearm_shortfall > 1e-6 {
        let next_batch = polearm_shortfall.min(6.0);
        request_connected_commodity(
            ctx,
            tick,
            clock,
            &building,
            CommodityKind::Timber,
            &["lumber_mill", "village_storehouse"],
            cart_service_timber + CARPENTER_TIMBER_PER_POLEARM * next_batch,
        );
        request_connected_commodity(
            ctx,
            tick,
            clock,
            &building,
            CommodityKind::Ironwork,
            &["smithy", "trading_post"],
            cart_service_ironwork + CARPENTER_IRONWORK_PER_POLEARM * next_batch,
        );
    }

    let ready_labor = cycle_labor_if_ready(ctx, tick, clock, &mut building, false);
    if let Some(labor) = ready_labor.filter(|_| {
        polearm_shortfall > 1e-6
            && building.timber + 1e-6 >= cart_service_timber + CARPENTER_TIMBER_PER_POLEARM
            && building.ironwork + 1e-6 >= cart_service_ironwork + CARPENTER_IRONWORK_PER_POLEARM
            && building_commodity_room(&building, CommodityKind::Polearms) + 1e-6 >= 1.0
    }) {
        withdraw_building_commodity(
            &mut building,
            CommodityKind::Timber,
            CARPENTER_TIMBER_PER_POLEARM,
        );
        withdraw_building_commodity(
            &mut building,
            CommodityKind::Ironwork,
            CARPENTER_IRONWORK_PER_POLEARM,
        );
        deposit_building_commodity(&mut building, CommodityKind::Polearms, 1.0);
        reset_cycle(&mut building, labor);
    }
    ctx.db.building().id().update(building);
}

pub fn step_guardhouse(
    ctx: &ReducerContext,
    _tick: &SimTickContext,
    _clock: &GameClock,
    mut building: Building,
) {
    // Guardhouses now support one authoritative model: resident-backed
    // MilitaryCompany rows. Labor here represents staff and drill support;
    // food, wages, readiness, casualties, and deployment live on the company.
    building.action_cooldown = if building.assigned_labor > 0 { 1.0 } else { 0.0 };
    ctx.db.building().id().update(building);
}

fn step_simple_producer_at_rate(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    mut building: Building,
    outputs: &[(CommodityKind, f64)],
    throughput_multiplier: f64,
) -> Building {
    let uses_output_target = !outputs.is_empty()
        && outputs
            .iter()
            .all(|(kind, _)| production_output_target_applies(&building.kind, *kind));
    let output_ready = if uses_output_target {
        outputs.iter().all(|(kind, _)| {
            processor_output_headroom(
                building_commodity_stock(&building, *kind),
                building_commodity_cap(&building.kind, *kind),
                building.processor_output_target_percent,
            ) > 1e-6
        })
    } else {
        producer_output_batch_fits(outputs.iter().map(|(kind, batch)| {
            (
                building_commodity_stock(&building, *kind),
                building_commodity_cap(&building.kind, *kind),
                *batch,
            )
        }))
    };
    if !output_ready {
        return building;
    }
    let Some(labor) = cycle_labor_if_ready_at_rate(
        ctx,
        tick,
        clock,
        &mut building,
        false,
        throughput_multiplier,
    ) else {
        return building;
    };
    let target_percent = uses_output_target.then_some(building.processor_output_target_percent);
    if !process_batch(&mut building, &[], outputs, target_percent) {
        return building;
    }
    reset_cycle(&mut building, labor);
    building
}

fn step_processor(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    building: Building,
    inputs: &[(CommodityKind, f64)],
    outputs: &[(CommodityKind, f64)],
) -> Building {
    step_processor_at_rate(ctx, tick, clock, building, inputs, outputs, 1.0)
}

fn step_processor_with_labor(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    mut building: Building,
    inputs: &[(CommodityKind, f64)],
    outputs: &[(CommodityKind, f64)],
    assigned_labor: u32,
) -> Building {
    if assigned_labor == 0
        || crate::simulation::production_labor_paused(ctx, tick, &building, clock)
    {
        return building;
    }
    let productive_labor =
        crate::simulation::ox_amplified_production_labor(ctx, tick, &building, assigned_labor);
    if productive_labor <= 1e-9 {
        return building;
    }
    let selected_rate =
        crate::production_rate_policy::production_rate_multiplier(building.production_rate_percent);
    if selected_rate <= 1e-9 {
        return building;
    }
    building.action_cooldown = (building.action_cooldown - TICK_DT * selected_rate).max(0.0);
    if building.action_cooldown > 1e-6 {
        return building;
    }
    let output_target_percent = building.processor_output_target_percent;
    if !process_batch(&mut building, inputs, outputs, Some(output_target_percent)) {
        return building;
    }
    reset_cycle(&mut building, productive_labor);
    building
}

fn step_processor_at_rate(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    mut building: Building,
    inputs: &[(CommodityKind, f64)],
    outputs: &[(CommodityKind, f64)],
    throughput_multiplier: f64,
) -> Building {
    let Some(labor) = cycle_labor_if_ready_at_rate(
        ctx,
        tick,
        clock,
        &mut building,
        false,
        throughput_multiplier,
    ) else {
        return building;
    };
    let output_target_percent = building.processor_output_target_percent;
    if !process_batch(&mut building, inputs, outputs, Some(output_target_percent)) {
        return building;
    }
    reset_cycle(&mut building, labor);
    building
}

fn process_batch(
    building: &mut Building,
    inputs: &[(CommodityKind, f64)],
    outputs: &[(CommodityKind, f64)],
    output_target_percent: Option<u8>,
) -> bool {
    for (kind, amount) in inputs {
        let required = crate::resource_units::whole_cost(*amount);
        if required > 0.0 && building_commodity_stock(building, *kind) + 1e-6 < required {
            return false;
        }
    }
    // Inputs leave the same physical work yard before outputs enter it. Project
    // the whole batch on a clone so input consumption can free combined room,
    // while a failed multi-output batch cannot consume or silently lose goods.
    let mut projected = building.clone();
    for (kind, amount) in inputs {
        withdraw_building_commodity(
            &mut projected,
            *kind,
            crate::resource_units::whole_cost(*amount),
        );
    }
    for (kind, amount) in outputs {
        let produced = crate::resource_units::whole_cost(*amount);
        if produced > 0.0 {
            let physical_room = building_commodity_room(&projected, *kind);
            let room = if output_target_percent.is_some()
                && production_output_target_applies(&building.kind, *kind)
            {
                processor_output_headroom(
                    if projected.kind == "smokehouse" && kind.is_preserved_food() {
                        crate::economy::building_preserved_food_stock(&projected)
                    } else {
                        building_commodity_stock(&projected, *kind)
                    },
                    building_commodity_cap(&projected.kind, *kind),
                    output_target_percent.unwrap_or(100),
                )
                .min(physical_room)
            } else {
                physical_room
            };
            if room + 1e-6 < produced {
                return false;
            }
            let deposited = deposit_building_commodity(&mut projected, *kind, produced);
            if (deposited - produced).abs() > 1e-6 {
                return false;
            }
        }
    }
    *building = projected;
    true
}

fn processor_output_commodity(kind: &str) -> Option<CommodityKind> {
    if kind == "bakery" {
        return Some(CommodityKind::RyeBread);
    }
    match processor_output_kind(kind)? {
        ProcessorOutputKind::Flour => Some(CommodityKind::RyeFlour),
        ProcessorOutputKind::Food => Some(CommodityKind::RyeBread),
        ProcessorOutputKind::Ale => Some(CommodityKind::Ale),
        ProcessorOutputKind::SavoryPreserves => None,
        ProcessorOutputKind::TextileIntermediate => Some(CommodityKind::Yarn),
        ProcessorOutputKind::Cloth => Some(CommodityKind::Cloth),
        ProcessorOutputKind::Charcoal => Some(CommodityKind::Charcoal),
        ProcessorOutputKind::Ironwork => Some(CommodityKind::Ironwork),
        ProcessorOutputKind::Pottery => Some(CommodityKind::Pottery),
        ProcessorOutputKind::Leather => Some(CommodityKind::Leather),
        ProcessorOutputKind::Shoes => Some(CommodityKind::Shoes),
        ProcessorOutputKind::Candles => Some(CommodityKind::Candles),
    }
}

fn production_output_target_applies(kind: &str, commodity: CommodityKind) -> bool {
    processor_output_commodity(kind) == Some(commodity)
        || (kind == "spinning_retting_house"
            && matches!(commodity, CommodityKind::Yarn | CommodityKind::Linen))
        || (kind == "brewery" && commodity.is_beverage())
        || (kind == "smokehouse" && commodity.is_preserved_food())
        || (kind == "potter_kiln" && commodity == CommodityKind::RoofTiles)
        || (kind == "weaponsmith_armorer"
            && matches!(
                commodity,
                CommodityKind::Polearms
                    | CommodityKind::Sidearms
                    | CommodityKind::Shields
                    | CommodityKind::PaddedArmor
                    | CommodityKind::MailArmor
            ))
        || (kind == "bowyer_fletcher"
            && matches!(
                commodity,
                CommodityKind::Bows | CommodityKind::Crossbows | CommodityKind::Ammunition
            ))
}

fn nearest_surface_extraction_commodity(
    ctx: &ReducerContext,
    x: f64,
    z: f64,
    radius: f64,
) -> Option<CommodityKind> {
    let radius_sq = radius.max(0.0).powi(2);
    let mut nearest = None;
    let mut nearest_distance_sq = f64::INFINITY;
    for deposit in ctx.db.quarry().iter() {
        if deposit.remaining <= 1e-6 {
            continue;
        }
        let Some(commodity) = mining_camp_geological_commodity(&deposit.quarry_id, deposit.is_rich)
        else {
            continue;
        };
        let distance_sq = (deposit.x - x).powi(2) + (deposit.z - z).powi(2);
        if distance_sq <= radius_sq && distance_sq < nearest_distance_sq {
            nearest = Some(commodity);
            nearest_distance_sq = distance_sq;
        }
    }
    for deposit in ctx.db.foraging_node().iter() {
        if mining_camp_clay_commodity(&deposit.node_kind, &deposit.node_id).is_none()
            || deposit.remaining <= 1e-6
        {
            continue;
        }
        let distance_sq = (deposit.x - x).powi(2) + (deposit.z - z).powi(2);
        if distance_sq <= radius_sq && distance_sq < nearest_distance_sq {
            nearest = Some(CommodityKind::Clay);
            nearest_distance_sq = distance_sq;
        }
    }
    nearest
}

fn rich_stone_commodity_beneath(ctx: &ReducerContext, x: f64, z: f64) -> Option<CommodityKind> {
    const CENTER_TOLERANCE_SQ: f64 = 2.5 * 2.5;
    ctx.db.quarry().iter().find_map(|deposit| {
        ((deposit.x - x).powi(2) + (deposit.z - z).powi(2) <= CENTER_TOLERANCE_SQ)
            .then(|| quarry_geological_commodity(&deposit.quarry_id, deposit.is_rich))
            .flatten()
    })
}

fn extraction_accepts_maintenance_input(
    ctx: &ReducerContext,
    building: &Building,
    input: CommodityKind,
) -> bool {
    if input != CommodityKind::Ironwork {
        return true;
    }
    let output = match building.kind.as_str() {
        "stone_quarry" => nearest_surface_extraction_commodity(ctx, building.x, building.z, 80.0),
        "large_quarry" => rich_stone_commodity_beneath(ctx, building.x, building.z),
        "mine" => mineworks_commodity_beneath(ctx, building.x, building.z),
        _ => return true,
    };
    output.is_some()
}

fn processor_uses_input(kind: &str, commodity: CommodityKind) -> bool {
    match kind {
        "watermill" | "windmill" => matches!(
            commodity,
            CommodityKind::RyeGrain | CommodityKind::MaslinGrain
        ),
        "bakery" => matches!(
            commodity,
            CommodityKind::RyeFlour
                | CommodityKind::MaslinFlour
                | CommodityKind::Water
                | CommodityKind::Firewood
        ),
        "brewery" => matches!(
            commodity,
            CommodityKind::Barley
                | CommodityKind::Malt
                | CommodityKind::Water
                | CommodityKind::Firewood
                | CommodityKind::Apples
                | CommodityKind::Pears
                | CommodityKind::Honey
        ),
        "smokehouse" => {
            matches!(
                commodity,
                CommodityKind::Meat
                    | CommodityKind::Fish
                    | CommodityKind::Milk
                    | CommodityKind::Firewood
                    | CommodityKind::Salt
                    | CommodityKind::Pottery
            )
        }
        "spinning_retting_house" => matches!(
            commodity,
            CommodityKind::Wool | CommodityKind::Flax | CommodityKind::Water
        ),
        "weaver" => matches!(commodity, CommodityKind::Yarn | CommodityKind::Linen),
        "charcoal_burner" => commodity == CommodityKind::Firewood,
        "smithy" => matches!(
            commodity,
            CommodityKind::Iron | CommodityKind::Charcoal | CommodityKind::Water
        ),
        "weaponsmith_armorer" => matches!(
            commodity,
            CommodityKind::Timber
                | CommodityKind::Ironwork
                | CommodityKind::Leather
                | CommodityKind::Linen
        ),
        "bowyer_fletcher" => matches!(
            commodity,
            CommodityKind::Timber
                | CommodityKind::Ironwork
                | CommodityKind::Leather
                | CommodityKind::Linen
        ),
        "potter_kiln" => matches!(
            commodity,
            CommodityKind::Clay | CommodityKind::Firewood | CommodityKind::Water
        ),
        "tannery" => matches!(
            commodity,
            CommodityKind::Hides | CommodityKind::Water | CommodityKind::Firewood
        ),
        "cobbler" => commodity == CommodityKind::Leather,
        "chandlery" => matches!(commodity, CommodityKind::Wax | CommodityKind::Firewood),
        _ => false,
    }
}

pub(crate) fn processor_accepts_input(building: &Building, commodity: CommodityKind) -> bool {
    if !storage_accepts_commodity(building, commodity) {
        return false;
    }
    // Oats bypass flour mills: households may eat them directly, while only
    // pastoral farmsteads accept them as livestock-processing input.
    if matches!(building.kind.as_str(), "watermill" | "windmill")
        && commodity == CommodityKind::OatGrain
    {
        return false;
    }
    if building.kind == "granary" && (commodity.is_fresh_food() || commodity.is_preserved_food()) {
        return true;
    }
    if building.kind == "pastoral_farmstead" {
        if commodity == CommodityKind::Salt {
            return effective_milk_use_policy(
                building.milk_use_policy,
                building.processor_output_target_percent,
            ) != MILK_USE_FRESH
                && building_commodity_room(building, CommodityKind::Cheese) > 1e-6;
        }
        if matches!(
            commodity,
            CommodityKind::RyeGrain | CommodityKind::OatGrain | CommodityKind::MaslinGrain
        ) {
            return commodity == CommodityKind::OatGrain
                && building_commodity_room(building, CommodityKind::AnimalFeed) > 1e-6;
        }
    }
    if matches!(
        building.kind.as_str(),
        "brewery" | "smokehouse" | "spinning_retting_house" | "weaver" | "potter_kiln"
    ) && processor_uses_input(&building.kind, commodity)
    {
        // A recipe choice controls production, not intake. Alternate valid
        // ingredients may still be delivered and held for the player's next
        // selection, bounded by their ordinary physical storage capacity.
        return building_commodity_room(building, commodity) > 1e-6;
    }
    if !processor_uses_input(&building.kind, commodity) {
        return true;
    }
    let output = if building.kind == "potter_kiln"
        && potter_fires_roof_tiles(building.potter_firing_policy)
    {
        Some(CommodityKind::RoofTiles)
    } else {
        processor_output_commodity(&building.kind)
    };
    let Some(output) = output else {
        return true;
    };
    processor_output_headroom(
        building_commodity_stock(building, output),
        building_commodity_cap(&building.kind, output),
        building.processor_output_target_percent,
    ) > 1e-6
}

fn smokehouse_input_recipe(commodity: CommodityKind) -> Option<u8> {
    match commodity {
        CommodityKind::Meat => Some(SMOKEHOUSE_RECIPE_CURED_MEAT),
        CommodityKind::Fish => Some(SMOKEHOUSE_RECIPE_SMOKED_FISH),
        CommodityKind::Milk => Some(SMOKEHOUSE_RECIPE_CHEESE),
        _ => None,
    }
}

fn smokehouse_requests_food_input(building: &Building, commodity: CommodityKind) -> bool {
    let Some(input_recipe) = smokehouse_input_recipe(commodity) else {
        return false;
    };
    smokehouse_recipe_requests_input(building.smokehouse_recipe_policy, input_recipe)
}

fn brewery_input_recipe(commodity: CommodityKind) -> Option<u8> {
    match commodity {
        CommodityKind::Barley
        | CommodityKind::Malt
        | CommodityKind::Water
        | CommodityKind::Firewood => Some(BREWERY_RECIPE_ALE),
        CommodityKind::Apples => Some(BREWERY_RECIPE_CIDER),
        CommodityKind::Pears => Some(BREWERY_RECIPE_PEAR_CIDER),
        CommodityKind::Honey => Some(BREWERY_RECIPE_MEAD),
        _ => None,
    }
}

/// Demand is narrower than physical acceptance for focused recipe buildings.
/// A non-selected ingredient may remain stored or finish an already active
/// trip, but no new supply trip should be created for it.
pub(crate) fn processor_requests_input(building: &Building, commodity: CommodityKind) -> bool {
    match building.kind.as_str() {
        "brewery" => brewery_input_recipe(commodity)
            .map(|recipe| brewery_recipe_requests_input(building.brewery_recipe_policy, recipe))
            .unwrap_or(true),
        "smokehouse" => {
            smokehouse_input_recipe(commodity).is_none()
                || smokehouse_requests_food_input(building, commodity)
        }
        "spinning_retting_house" => match commodity {
            CommodityKind::Wool => {
                textile_recipe_requests_route(building.weaver_input_policy, false)
            }
            CommodityKind::Flax | CommodityKind::Water => {
                textile_recipe_requests_route(building.weaver_input_policy, true)
            }
            _ => true,
        },
        "weaver" => match commodity {
            CommodityKind::Yarn => {
                textile_recipe_requests_route(building.weaver_input_policy, false)
            }
            CommodityKind::Linen => {
                textile_recipe_requests_route(building.weaver_input_policy, true)
            }
            _ => true,
        },
        // Both kiln recipes consume the same clay, water, and firewood.
        "potter_kiln" => true,
        _ => true,
    }
}

fn commodity_transfer_per_trip(commodity: CommodityKind) -> f64 {
    match commodity {
        CommodityKind::Wool
        | CommodityKind::Flax
        | CommodityKind::Yarn
        | CommodityKind::Linen
        | CommodityKind::Cloth => TEXTILE_TRANSFER_PER_TRIP,
        CommodityKind::Pelts
        | CommodityKind::Hides
        | CommodityKind::Leather
        | CommodityKind::Shoes => LEATHER_TRANSFER_PER_TRIP,
        CommodityKind::Wax | CommodityKind::Candles => CANDLE_TRANSFER_PER_TRIP,
        _ => GRAIN_TRANSFER_PER_TRIP,
    }
}

fn cycle_labor_if_ready(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    building: &mut Building,
    autonomous: bool,
) -> Option<f64> {
    cycle_labor_if_ready_at_rate(ctx, tick, clock, building, autonomous, 1.0)
}

fn cycle_labor_if_ready_at_rate(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    building: &mut Building,
    autonomous: bool,
    throughput_multiplier: f64,
) -> Option<f64> {
    if crate::simulation::production_labor_paused(ctx, tick, building, clock) {
        return None;
    }
    let labor = if autonomous {
        1.0
    } else {
        let onsite_labor = onsite_building_labor(ctx, building);
        if onsite_labor == 0 {
            return None;
        }
        let productive_labor =
            crate::simulation::ox_amplified_production_labor(ctx, tick, building, onsite_labor);
        if productive_labor <= 1e-9 {
            return None;
        }
        productive_labor
    };
    let selected_rate =
        crate::production_rate_policy::production_rate_multiplier(building.production_rate_percent);
    if selected_rate <= 1e-9 {
        return None;
    }
    let affinity_multiplier = tick
        .land_use_profile(ctx)
        .production_throughput_multiplier(&building.kind);
    building.action_cooldown = (building.action_cooldown
        - TICK_DT * throughput_multiplier.max(0.0) * selected_rate * affinity_multiplier)
        .max(0.0);
    if building.action_cooldown > 1e-6 {
        return None;
    }
    Some(labor)
}

fn reset_cycle(building: &mut Building, labor: f64) {
    let interval = building_def(&building.kind)
        .map(|def| def.action_interval)
        .unwrap_or(1.0);
    building.action_cooldown = interval / labor.max(0.05);
}

fn dispatch_farmstead_typed_grain(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    source: &mut Building,
    reserves: FarmSeedReserves,
) {
    let mut grains = [
        CommodityKind::RyeGrain,
        CommodityKind::OatGrain,
        CommodityKind::MaslinGrain,
    ];
    grains.sort_by(|left, right| {
        farmstead_exportable_grain(
            building_commodity_stock(source, *right),
            reserves.for_commodity(*right),
        )
        .partial_cmp(&farmstead_exportable_grain(
            building_commodity_stock(source, *left),
            reserves.for_commodity(*left),
        ))
        .unwrap_or(std::cmp::Ordering::Equal)
    });
    for grain in grains {
        let transferable = farmstead_exportable_grain(
            building_commodity_stock(source, grain),
            reserves.for_commodity(grain),
        );
        if transferable <= 1e-6 {
            continue;
        }
        let targets: &[&str] = if grain == CommodityKind::OatGrain {
            &["pastoral_farmstead", "granary"]
        } else {
            &["watermill", "windmill", "granary"]
        };
        dispatch_to_building_where_limited(
            ctx,
            tick,
            clock,
            source,
            grain,
            targets,
            transferable,
            |_| true,
        );
    }
}

fn dispatch_farmstead_barley(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    source: &mut Building,
    seed_reserve: f64,
) {
    let transferable = farmstead_exportable_grain(source.barley, seed_reserve);
    dispatch_to_building_where_limited(
        ctx,
        tick,
        clock,
        source,
        CommodityKind::Barley,
        &["brewery", "granary"],
        transferable,
        |_| true,
    );
}

/// Central grain leaves with an extra granary hauler rather than being claimed by
/// whichever processor happens to run first. One pass chooses the operational
/// processor in the highest work-priority tier, then the least cycle runway,
/// shortest road route, and stable id. Existing inbound trips keep multiple
/// granaries from duplicating the same workshop load.
fn next_granary_grain_dispatch(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    source: &Building,
) -> Option<RoutedGrainTarget> {
    let grains = [
        CommodityKind::RyeGrain,
        CommodityKind::OatGrain,
        CommodityKind::MaslinGrain,
    ];
    if source.kind != "granary"
        || source.assigned_labor <= 1
        || labor_and_logistics_paused(ctx, tick, source.owner, clock)
        || building_has_active_trip(ctx, source.id)
        || grains
            .into_iter()
            .all(|grain| granary_typed_grain_surplus(source, grain) <= 1e-6)
    {
        return None;
    }
    let network = tick.road_network(source.owner)?;
    let candidates = grains.into_iter().flat_map(|commodity| {
        tick.building_ids_for_kinds(ctx, source.owner, GRAIN_PROCESSOR_KINDS)
            .into_iter()
            .filter_map(move |target_id| ctx.db.building().id().find(&target_id))
            .filter_map(move |target| {
                if target.id == source.id
                    || !target.construction_complete
                    || tick.building_disabled_by_fire(ctx, target.id)
                    || !GRAIN_PROCESSOR_KINDS.contains(&target.kind.as_str())
                    || target.assigned_labor == 0
                    || !processor_accepts_input(&target, commodity)
                    || building_has_inbound_supply_trip(ctx, target.id)
                    || granary_typed_grain_surplus(source, commodity) <= 1e-6
                {
                    return None;
                }
                let productivity = 1.0;
                let desired_stock = grain_input_target(
                    &target.kind,
                    productivity,
                    target.processor_output_target_percent,
                );
                let target_stock = building_commodity_stock(&target, commodity);
                if desired_stock <= 1e-6 || target_stock + 1e-6 >= desired_stock {
                    return None;
                }
                local_delivery_distance(network, source.x, source.z, target.x, target.z).map(
                    |distance| RoutedGrainTarget {
                        runway_cycles: grain_input_runway_cycles(
                            &target.kind,
                            target_stock,
                            productivity,
                        ),
                        building: target,
                        commodity,
                        distance,
                        desired_stock,
                    },
                )
            })
    });
    select_grain_dispatch_candidate(
        candidates,
        |_candidate| CONSTRUCTION_PRIORITY_NORMAL,
        |candidate| candidate.runway_cycles,
        |candidate| candidate.distance,
        |candidate| candidate.building.id,
    )
}

fn granary_typed_grain_surplus(source: &Building, commodity: CommodityKind) -> f64 {
    let stock = building_commodity_stock(source, commodity).max(0.0);
    let total =
        source.rye_grain.max(0.0) + source.oat_grain.max(0.0) + source.maslin_grain.max(0.0);
    let protected_from_this = (source.granary_grain_reserve.max(0.0) - (total - stock)).max(0.0);
    (stock - protected_from_this).max(0.0)
}

fn dispatch_granary_grain(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    source: &mut Building,
    dispatch: &RoutedGrainTarget,
) -> bool {
    let Some(network) = tick.road_network(source.owner) else {
        return false;
    };
    let transferable = granary_typed_grain_surplus(source, dispatch.commodity);
    let needed = (dispatch.desired_stock
        - building_commodity_stock(&dispatch.building, dispatch.commodity))
    .max(0.0)
    .min(transferable);
    try_start_building_supply_trip(
        ctx,
        tick,
        clock,
        network,
        source,
        &dispatch.building,
        1,
        dispatch.commodity,
        TIMBER_DELIVERY_SPEED_MPS,
        TIMBER_DELIVERY_UNLOAD_SEC,
        GRAIN_TRANSFER_PER_TRIP * tick.land_use_profile(ctx).cultivation_multiplier(),
        needed,
    )
}

pub(crate) fn dispatch_to_building(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    source: &mut Building,
    commodity: CommodityKind,
    target_kinds: &[&str],
) {
    dispatch_to_building_where(ctx, tick, clock, source, commodity, target_kinds, |_| true);
}

fn dispatch_to_building_where(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    source: &mut Building,
    commodity: CommodityKind,
    target_kinds: &[&str],
    target_is_eligible: impl Fn(&Building) -> bool,
) {
    dispatch_to_building_where_limited(
        ctx,
        tick,
        clock,
        source,
        commodity,
        target_kinds,
        f64::INFINITY,
        target_is_eligible,
    );
}

fn dispatch_to_building_where_limited(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    source: &mut Building,
    commodity: CommodityKind,
    target_kinds: &[&str],
    transferable_limit: f64,
    target_is_eligible: impl Fn(&Building) -> bool,
) {
    if labor_and_logistics_paused(ctx, tick, source.owner, clock)
        || building_has_active_trip(ctx, source.id)
    {
        return;
    }
    let Some(network) = tick.road_network(source.owner) else {
        return;
    };
    let source_stock = building_commodity_stock(source, commodity);
    let transferable = if commodity.is_edible() {
        institutional_source_food_surplus(ctx, tick, source, source_stock)
    } else {
        source_stock
    }
    .min(transferable_limit.max(0.0));
    if transferable <= 1e-6 {
        return;
    }
    let Some(routed_target) = select_processor_input_dispatch_candidate(
        tick.building_ids_for_kinds(ctx, source.owner, target_kinds)
            .into_iter()
            .filter_map(|target_id| ctx.db.building().id().find(&target_id))
            .filter_map(|target| {
                if target.id == source.id
                    || !target.construction_complete
                    || tick.building_disabled_by_fire(ctx, target.id)
                    || !target_kinds.contains(&target.kind.as_str())
                    || !target_is_eligible(&target)
                    || (target.kind == "granary" && target.assigned_labor == 0)
                    || (target.kind == "marketplace"
                        && !tick.marketplace_stall_accepts_commodity_from(
                            ctx, &target, source.id, commodity,
                        ))
                    || !processor_requests_input(&target, commodity)
                    || !processor_accepts_input(&target, commodity)
                    || building_commodity_room(&target, commodity) <= 1e-6
                    || building_has_conflicting_inbound_supply_trip(ctx, &target, commodity)
                {
                    return None;
                }
                let stock = building_commodity_stock(&target, commodity);
                let per_cycle =
                    directly_dispatched_processor_input_per_cycle(&target.kind, commodity);
                let duty = processor_input_dispatch_duty_for_target(
                    &target.kind,
                    directly_dispatched_commodity_name(commodity).unwrap_or(""),
                    target.assigned_labor,
                    stock,
                    per_cycle,
                    processor_input_target_percent_for_building(&target, commodity),
                );
                let desired_stock = if duty == ProcessorInputDispatchDuty::WorkingBuffer {
                    processor_input_target_for_building(&target, commodity, per_cycle)
                } else {
                    building_commodity_cap(&target.kind, commodity)
                };
                let input_preference_rank = textile_input_preference_rank(&target, commodity);
                let runway_cycles = if commodity == CommodityKind::Ironwork
                    && is_civilian_tool_site(&target.kind)
                {
                    civilian_tool_runway_cycles(stock)
                } else {
                    processor_input_runway_cycles(stock, per_cycle)
                };
                local_delivery_distance(network, source.x, source.z, target.x, target.z).map(
                    |distance| RoutedProcessorInputTarget {
                        building: target,
                        distance,
                        duty,
                        input_preference_rank,
                        runway_cycles,
                        desired_stock,
                    },
                )
            }),
        |candidate| candidate.duty,
        |_candidate| CONSTRUCTION_PRIORITY_NORMAL,
        |candidate| candidate.input_preference_rank,
        |candidate| candidate.runway_cycles,
        |candidate| candidate.distance,
        |candidate| candidate.building.id,
    ) else {
        return;
    };
    let target = &routed_target.building;
    let target_stock = building_commodity_stock(target, commodity);
    let needed = if target.kind == "marketplace" && commodity.is_edible() {
        marketplace_refill_request(
            target_stock,
            routed_target.desired_stock,
            commodity_transfer_per_trip(commodity),
            transferable,
        )
    } else {
        (routed_target.desired_stock - target_stock)
            .max(0.0)
            .min(transferable)
    };
    if needed <= 1e-6 {
        return;
    }
    let delivery_workers = if target.kind == "marketplace"
        && matches!(source.kind.as_str(), "granary" | "village_storehouse")
    {
        1
    } else if matches!(source.kind.as_str(), "granary" | "village_storehouse") {
        source.assigned_labor.max(1)
    } else {
        1
    };
    try_start_building_supply_trip(
        ctx,
        tick,
        clock,
        network,
        source,
        target,
        delivery_workers,
        commodity,
        TIMBER_DELIVERY_SPEED_MPS,
        TIMBER_DELIVERY_UNLOAD_SEC,
        commodity_transfer_per_trip(commodity),
        needed,
    );
}

fn directly_dispatched_processor_input_per_cycle(
    target_kind: &str,
    commodity: CommodityKind,
) -> f64 {
    let Some(commodity) = directly_dispatched_commodity_name(commodity) else {
        return 0.0;
    };
    processor_input_per_cycle_for_dispatch(target_kind, commodity)
}

fn processor_input_target_percent_for_building(
    building: &Building,
    commodity: CommodityKind,
) -> u8 {
    if building.kind == "pastoral_farmstead" && commodity == CommodityKind::Salt {
        let milk_use = effective_milk_use_policy(
            building.milk_use_policy,
            building.processor_output_target_percent,
        );
        if farmhouse_cheese_salt_staging_cycles(milk_use) > 0.0 {
            100
        } else {
            25
        }
    } else {
        building.processor_output_target_percent
    }
}

fn processor_input_target_for_building(
    building: &Building,
    commodity: CommodityKind,
    per_cycle: f64,
) -> f64 {
    if building.kind == "pastoral_farmstead" && commodity == CommodityKind::Salt {
        let milk_use = effective_milk_use_policy(
            building.milk_use_policy,
            building.processor_output_target_percent,
        );
        per_cycle.max(0.0) * farmhouse_cheese_salt_staging_cycles(milk_use)
    } else {
        processor_input_target(per_cycle, building.processor_output_target_percent)
    }
}

fn directly_dispatched_commodity_name(commodity: CommodityKind) -> Option<&'static str> {
    match commodity {
        CommodityKind::RyeSheaves => Some("ryeSheaves"),
        CommodityKind::OatSheaves => Some("oatSheaves"),
        CommodityKind::BarleySheaves => Some("barleySheaves"),
        CommodityKind::MaslinSheaves => Some("maslinSheaves"),
        CommodityKind::RyeGrain => Some("ryeGrain"),
        CommodityKind::OatGrain => Some("oatGrain"),
        CommodityKind::MaslinGrain => Some("maslinGrain"),
        CommodityKind::Barley => Some("barley"),
        CommodityKind::Malt => Some("malt"),
        CommodityKind::RyeFlour => Some("ryeFlour"),
        CommodityKind::MaslinFlour => Some("maslinFlour"),
        CommodityKind::Meat => Some("meat"),
        CommodityKind::Fish => Some("fish"),
        CommodityKind::Milk => Some("milk"),
        CommodityKind::Wool => Some("wool"),
        CommodityKind::Flax => Some("flax"),
        CommodityKind::Yarn => Some("yarn"),
        CommodityKind::Linen => Some("linen"),
        CommodityKind::Ironwork => Some("ironwork"),
        CommodityKind::Clay => Some("clay"),
        CommodityKind::Charcoal => Some("charcoal"),
        CommodityKind::Pottery => Some("pottery"),
        CommodityKind::Pelts => Some("pelts"),
        CommodityKind::Hides => Some("hides"),
        CommodityKind::Leather => Some("leather"),
        CommodityKind::Shoes => Some("shoes"),
        CommodityKind::Firewood => Some("firewood"),
        CommodityKind::Water => Some("water"),
        CommodityKind::Iron => Some("iron"),
        CommodityKind::Salt => Some("salt"),
        CommodityKind::Grapes => Some("grapes"),
        CommodityKind::Apples => Some("apples"),
        CommodityKind::Honey => Some("honey"),
        CommodityKind::Wax => Some("wax"),
        CommodityKind::Candles => Some("candles"),
        _ => None,
    }
}

pub(crate) fn request_connected_commodity(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    target: &Building,
    commodity: CommodityKind,
    source_kinds: &[&str],
    desired: f64,
) {
    request_connected_commodity_with_source_availability(
        ctx,
        tick,
        clock,
        target,
        commodity,
        source_kinds,
        desired,
        |source, stock| connected_source_surplus(ctx, tick, source, commodity, stock),
    );
}

fn connected_source_surplus(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    source: &Building,
    commodity: CommodityKind,
    stock: f64,
) -> f64 {
    if matches!(
        commodity,
        CommodityKind::RyeGrain | CommodityKind::OatGrain | CommodityKind::MaslinGrain
    ) && source.kind == "threshing_barn"
    {
        return farmstead_exportable_grain(
            stock,
            tick.farmstead_seed_reserve_for(ctx, source.owner, source.id, commodity),
        );
    }
    if matches!(
        commodity,
        CommodityKind::RyeGrain | CommodityKind::OatGrain | CommodityKind::MaslinGrain
    ) && source.kind == "granary"
    {
        return granary_typed_grain_surplus(source, commodity);
    }
    if commodity == CommodityKind::AnimalFeed && source.kind == "pastoral_farmstead" {
        return (stock - pastoral_winter_animal_feed_reserve(ctx, tick, source)).max(0.0);
    }
    stock
}

fn pastoral_winter_animal_feed_reserve(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    source: &Building,
) -> f64 {
    let herds = ctx
        .db
        .pasture_herd()
        .farmstead_id()
        .filter(&source.id)
        .filter(|herd| {
            if herd.species == crate::reducers::livestock::SPECIES_HORSE {
                herd.present_head_count > 0
            } else {
                herd.head_count > 0
            }
        })
        .collect::<Vec<_>>();
    if herds.is_empty() {
        return 0.0;
    };
    let cycles_per_day = building_def(&source.kind)
        .map(|def| livestock_cycles_per_calendar_day(def.action_interval))
        .unwrap_or(0.0);
    herds
        .into_iter()
        .filter_map(|herd| {
            let pasture = ctx.db.pasture().id().find(&herd.pasture_id)?;
            let (hay_per_head, feed_per_head, winter_multiplier) = match herd.species {
                crate::reducers::livestock::SPECIES_CATTLE => (
                    CATTLE_HAY_PER_UNSUPPORTED_HEAD,
                    CATTLE_GRAIN_PER_UNSUPPORTED_HEAD,
                    WINTER_PASTURE_CAPACITY_MULTIPLIER,
                ),
                crate::reducers::livestock::SPECIES_SHEEP => (
                    SHEEP_HAY_PER_UNSUPPORTED_HEAD,
                    SHEEP_GRAIN_PER_UNSUPPORTED_HEAD,
                    WINTER_PASTURE_CAPACITY_MULTIPLIER,
                ),
                crate::reducers::livestock::SPECIES_HORSE => (
                    HORSE_HAY_PER_UNSUPPORTED_HEAD,
                    HORSE_GRAIN_PER_UNSUPPORTED_HEAD,
                    WINTER_PASTURE_CAPACITY_MULTIPLIER,
                ),
                _ => (
                    0.0,
                    SWINE_GRAIN_PER_UNSUPPORTED_HEAD,
                    PANNAGE_WINTER_CAPACITY_MULTIPLIER,
                ),
            };
            Some(projected_winter_animal_feed(
                if herd.species == crate::reducers::livestock::SPECIES_HORSE {
                    herd.present_head_count
                } else {
                    herd.head_count
                },
                tick.livestock_grazing_capacity(ctx, &pasture, &herd),
                herd.hay_stock,
                hay_per_head,
                feed_per_head,
                cycles_per_day,
                winter_multiplier,
            ))
        })
        .sum::<f64>()
        .min(building_commodity_cap(
            &source.kind,
            CommodityKind::AnimalFeed,
        ))
}

fn institutional_source_food_surplus(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    source: &Building,
    stock: f64,
) -> f64 {
    let claimed_households = tick.food_claim_count_for_supplier(ctx, source.owner, source.id);
    let dispatchable_stock = institutional_dispatchable_food_stock(
        &source.kind,
        stock,
        source.oat_grain,
        livestock_source_has_feed_commitment(ctx, source),
    );
    let generic_surplus = institutional_food_surplus(
        dispatchable_stock,
        claimed_households,
        building_commodity_cap(&source.kind, CommodityKind::Meat),
    );
    let policy_surplus = match source.kind.as_str() {
        "apiary" => (source.honey - apiary_honey_reserve(source.apiary_harvest_policy)).max(0.0),
        _ => generic_surplus,
    };
    generic_surplus.min(policy_surplus)
}

fn livestock_source_has_feed_commitment(ctx: &ReducerContext, source: &Building) -> bool {
    if !matches!(source.kind.as_str(), "pastoral_farmstead" | "swineherd") {
        return false;
    }
    ctx.db
        .pasture_herd()
        .farmstead_id()
        .filter(&source.id)
        .any(|herd| {
            if herd.species == crate::reducers::livestock::SPECIES_HORSE {
                herd.present_head_count > 0
            } else {
                herd.head_count > 0
            }
        })
}

fn request_connected_commodity_with_source_availability(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    target: &Building,
    commodity: CommodityKind,
    source_kinds: &[&str],
    desired: f64,
    source_availability: impl Fn(&Building, f64) -> f64,
) {
    if !target.construction_complete
        || (target.assigned_labor == 0
            && !ctx
                .db
                .military_company()
                .iter()
                .any(|company| company.state < 2 && company.source_building_id == target.id))
        || labor_and_logistics_paused(ctx, tick, target.owner, clock)
        || !processor_requests_input(target, commodity)
        || !processor_accepts_input(target, commodity)
        || building_has_inbound_supply_trip(ctx, target.id)
        || building_commodity_stock(&target, commodity) + 1e-6 >= desired
    {
        return;
    }
    let Some(network) = tick.road_network(target.owner) else {
        return;
    };
    let Some((routed_source, transferable)) = select_supply_route_candidate(
        tick.building_ids_for_kinds(ctx, target.owner, source_kinds)
            .into_iter()
            .filter_map(|source_id| ctx.db.building().id().find(&source_id))
            .filter_map(|source| {
                if !source.construction_complete
                    || tick.building_disabled_by_fire(ctx, source.id)
                    || !source_kinds.contains(&source.kind.as_str())
                    || (source.kind == "trading_post" && source.assigned_labor == 0)
                    || building_has_active_trip(ctx, source.id)
                {
                    return None;
                }
                let stock = building_commodity_stock(&source, commodity);
                let transferable = source_availability(&source, stock).clamp(0.0, stock.max(0.0));
                if transferable <= 1e-6 {
                    return None;
                }
                local_delivery_distance(network, source.x, source.z, target.x, target.z).map(
                    |distance| {
                        (
                            RoutedBuilding {
                                building: source,
                                distance,
                            },
                            transferable,
                        )
                    },
                )
            }),
        |candidate| candidate.0.distance,
        |candidate| candidate.0.building.id,
    ) else {
        return;
    };
    let mut source = routed_source.building;
    let request = (desired - building_commodity_stock(target, commodity))
        .max(0.0)
        .min(transferable);
    if try_start_building_supply_trip(
        ctx,
        tick,
        clock,
        network,
        &mut source,
        target,
        1,
        commodity,
        TIMBER_DELIVERY_SPEED_MPS,
        TIMBER_DELIVERY_UNLOAD_SEC,
        commodity_transfer_per_trip(commodity),
        request,
    ) {
        ctx.db.building().id().update(source);
    }
}

/// Set out modest portions of the estate's own meat, cheese, and milk before
/// the general pantry completes the meal. None is a readiness gate or a player
/// recipe choice: a short animal-product course is simply replaced by whatever
/// other edible food the house has stored.
fn withdraw_monastery_feast_food(monastery: &mut Building, meal_amount: f64) -> f64 {
    let requested = meal_amount.max(0.0);
    let course_meals = requested / 6.0;
    let mut meals_withdrawn = 0.0;
    for commodity in [
        CommodityKind::Meat,
        CommodityKind::Cheese,
        CommodityKind::Milk,
    ] {
        let meal_value = commodity.meal_value().max(1e-9);
        let units = withdraw_building_commodity(monastery, commodity, course_meals / meal_value);
        meals_withdrawn += units * meal_value;
    }
    meals_withdrawn
        + withdraw_building_edible_food(monastery, (requested - meals_withdrawn).max(0.0))
}

fn run_monastery_feast(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    monastery: &mut Building,
) {
    let enabled = tick.monastery_hospitality_enabled(ctx, monastery.owner);
    if !enabled
        || tick.owner_has_active_raider_threat(ctx, monastery.owner)
        || !is_monastery_feast_day(clock.month, clock.month_day)
        || !crate::simulation::calendar_day_started(clock)
    {
        return;
    }
    let residences: Vec<Residence> = ctx
        .db
        .residence()
        .owner()
        .filter(&monastery.owner)
        .filter(|home| {
            !home.abandoned
                && home.population > 0
                && tick.monastery_for_residence(ctx, monastery.owner, home.id) == Some(monastery.id)
        })
        .collect();
    if residences.is_empty() {
        return;
    }
    let batch = monastery_feast_batch(
        (building_edible_food_stock(monastery) - monastery.honey.max(0.0)).max(0.0),
        monastery.cider,
        monastery.mead,
        monastery.honey,
        monastery.wine,
    );
    if !batch.ready {
        return;
    }

    // The complete batch remains at this physical venue until the feast date,
    // when the covered parish gathers here to consume it. Household pantry stock must
    // not increase: this is a communal meal, not an invisible delivery.
    let food_requested = MONASTERY_FEAST_FOOD / batch.common_table_multiplier.max(1.0);
    let food_used = withdraw_monastery_feast_food(monastery, food_requested);
    withdraw_building_commodity(monastery, CommodityKind::Cider, batch.cider_used);
    withdraw_building_commodity(monastery, CommodityKind::Mead, batch.mead_used);
    withdraw_building_commodity(monastery, CommodityKind::Honey, MONASTERY_FEAST_HONEY);
    withdraw_building_commodity(monastery, CommodityKind::Wine, batch.wine_used);
    for home in &residences {
        apply_need_consumed_at_source(ctx, home.id, ResidenceNeedKind::Food);
        if home.tier >= 2 {
            apply_need_consumed_at_source(ctx, home.id, ResidenceNeedKind::Ale);
        }
    }
    if let Some(mut resources) = ctx.db.player_resources().owner().find(&monastery.owner) {
        resources.monastery_food_charity_total += food_used;
        resources.monastery_feasts_held_total =
            resources.monastery_feasts_held_total.saturating_add(1);
        ctx.db.player_resources().owner().update(resources);
    }
}

fn owner_has_connected_marketplace(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    building: &Building,
) -> bool {
    let Some(network) = tick.road_network(building.owner) else {
        return false;
    };
    tick.building_ids_for_kinds(ctx, building.owner, &["marketplace"])
        .into_iter()
        .filter_map(|market_id| ctx.db.building().id().find(&market_id))
        .any(|market| {
            market.kind == "marketplace"
                && market.construction_complete
                && !tick.building_disabled_by_fire(ctx, market.id)
                && network
                    .road_path_distance(building.x, building.z, market.x, market.z)
                    .is_some()
        })
}

fn monastery_has_parish_link(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    monastery: &Building,
) -> bool {
    let chapels: Vec<Building> = tick
        .building_ids_for_kinds(ctx, monastery.owner, &["chapel"])
        .into_iter()
        .filter_map(|chapel_id| ctx.db.building().id().find(&chapel_id))
        .filter(|building| {
            building.kind == "chapel"
                && building.construction_complete
                && !tick.building_disabled_by_fire(ctx, building.id)
        })
        .collect();
    monastery_linked_to_chapel(tick, monastery, &chapels)
}
