use std::collections::{HashMap, HashSet};

use spacetimedb::ReducerContext;

use crate::apiary_policy::{
    apiary_forage_score, apiary_honey_reserve, apiary_production_multiplier,
    next_apiary_colony_health, pollination_contribution, pollination_multiplier,
};
use crate::balance_generated::{
    BackyardGardenKind, FarmCropProduce, APIARY_HONEY_PER_CYCLE, APIARY_WINTER_HONEY_REQUIRED,
    BACKYARD_APIARY_POLLINATION_CONTRIBUTION, BACKYARD_APIARY_POLLINATION_RADIUS,
    BAKERY_FIREWOOD_PER_CYCLE, BAKERY_FLOUR_PER_CYCLE, BAKERY_MASLIN_BREAD_PER_CYCLE,
    BAKERY_OAT_BREAD_PER_CYCLE, BAKERY_RYE_BREAD_PER_CYCLE, BAKERY_WATER_PER_CYCLE,
    BREWERY_ALE_PER_CYCLE, BREWERY_BARLEY_PER_MALT_CYCLE, BREWERY_BREWING_FIREWOOD_PER_CYCLE,
    BREWERY_BREWING_WATER_PER_CYCLE, BREWERY_MALTING_FIREWOOD_PER_CYCLE,
    BREWERY_MALTING_WATER_PER_CYCLE, BREWERY_MALT_PER_ALE_CYCLE, BREWERY_MALT_PER_CYCLE,
    CALENDAR_SECONDS_PER_DAY, CHARCOAL_BURNER_CHARCOAL_PER_CYCLE,
    CHARCOAL_BURNER_FIREWOOD_PER_CYCLE, CHARCOAL_HOUSEHOLD_FUEL_VALUE,
    CIVILIAN_TOOL_IRONWORK_PER_CYCLE, CLAY_PIT_CLAY_PER_CYCLE, FARM_GROWTH_SECONDS,
    FARM_WORK_METERS_PER_WORKER_PER_SEC, GRAIN_TRANSFER_PER_TRIP, MINE_IRON_PER_CYCLE,
    MINE_SALT_PER_CYCLE, MINE_TIMBER_SUPPORT_PER_CYCLE, MONASTERY_FEAST_ALE, MONASTERY_FEAST_FOOD,
    MONASTERY_FEAST_HONEY, MONASTERY_FEAST_WINE, MONASTERY_FOOD_PER_CYCLE,
    MONASTERY_OAT_GRAIN_PER_CYCLE, MONASTERY_PILGRIMAGE_GOLD_PER_DAY,
    MONASTERY_UNLINKED_PRODUCTIVITY, POTTER_CLAY_PER_CYCLE, POTTER_FIREWOOD_PER_CYCLE,
    POTTER_POTTERY_PER_CYCLE, POTTER_ROOF_TILES_PER_CYCLE, POTTER_WATER_PER_CYCLE,
    RICH_MINE_THROUGHPUT_MULTIPLIER, SMITHY_CHARCOAL_PER_CYCLE, SMITHY_IRONWORK_PER_CYCLE,
    SMITHY_IRON_PER_CYCLE, SMITHY_WATER_PER_CYCLE, SMOKEHOUSE_FIREWOOD_PER_CYCLE,
    SMOKEHOUSE_FOOD_PER_CYCLE, SMOKEHOUSE_POTTERY_PER_CYCLE, SMOKEHOUSE_PRESERVED_FOOD_PER_CYCLE,
    SMOKEHOUSE_SALT_PER_CYCLE, TEXTILE_TRANSFER_PER_TRIP, THRESHING_GRAIN_PER_CYCLE,
    THRESHING_SHEAVES_PER_CYCLE, TICK_DT, TIMBER_DELIVERY_SPEED_MPS, TIMBER_DELIVERY_UNLOAD_SEC,
    VINEYARD_FERMENTATION_SECONDS, VINEYARD_GRAPES_PER_FERMENTATION_BATCH,
    VINEYARD_GRAPES_PER_HARVEST_CYCLE, VINEYARD_WINE_PER_FERMENTATION_BATCH,
    WATERMILL_GRAIN_PER_CYCLE, WATERMILL_MASLIN_FLOUR_PER_CYCLE, WATERMILL_OAT_FLOUR_PER_CYCLE,
    WATERMILL_RYE_FLOUR_PER_CYCLE, WEAVER_CLOTH_PER_CYCLE, WEAVER_FLAX_PER_CYCLE,
    WEAVER_FLAX_WATER_PER_CYCLE, WEAVER_WOOL_PER_CYCLE,
};
use crate::building_defs::building_def;
use crate::burgage::{Point2, ZoneCorners};
use crate::civilian_tool_policy::{
    civilian_tool_runway_cycles, civilian_tool_throughput_multiplier, civilian_tools_maintained,
    farm_tool_ironwork_for_work, farm_tool_throughput_multiplier, farm_tools_maintained,
    is_civilian_tool_site,
};
use crate::construction_priority::CONSTRUCTION_PRIORITY_NORMAL;
use crate::db::*;
use crate::economy::{
    available_unreserved_building_ironwork, building_commodity_cap, building_commodity_room,
    building_commodity_stock, building_edible_food_stock, building_fresh_food_stock,
    building_preservable_food_stock, credit_local_civic_receipts,
    credit_settlement_household_income, deposit_building_commodity,
    first_building_edible_commodity, flour_bulk_stock, restore_treasury_gold,
    spend_treasury_gold, treasury_gold, withdraw_building_commodity,
    withdraw_building_edible_food, CommodityKind, FRESH_FOOD_COMMODITIES,
};
use crate::farm_work_policy::{field_task_rank, threshing_preempts_fields};
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
    armed_guards, carpenter_polearm_shortfall, guard_upkeep, guardhouse_food_runway_days,
    guardhouse_food_target, guardhouse_polearm_coverage, guardhouse_polearm_target,
    next_guard_readiness, select_guardhouse_armament_candidate, select_guardhouse_food_candidate,
    CARPENTER_IRONWORK_PER_POLEARM, CARPENTER_TIMBER_PER_POLEARM,
    GUARDHOUSE_CRITICAL_FOOD_RUNWAY_DAYS,
};
use crate::fuel_reserve_policy::{
    combined_fuel_equivalent, marketplace_fuel_reserve_target, smithy_charcoal_refill_target,
};
use crate::granary_policy::granary_fresh_food_target;
use crate::hydrology::{clay_bank_yield_multiplier_with_richness, sample_world_hydrology_score};
use crate::livestock_policy::{
    farmhouse_cheese_salt_staging_cycles, normalize_milk_use_policy, MILK_USE_FRESH,
};
use crate::marketplace_procurement_policy::{
    normalize_marketplace_iron_target, normalize_marketplace_salt_target,
};
use crate::monastery_hospitality_policy::{
    is_monastery_feast_day, monastery_feast_batch, monastery_feast_refill_shortfall,
    monastery_hospitality_use, monastery_pilgrimage_gold,
};
use crate::potter_firing_policy::potter_fires_roof_tiles;
use crate::pottery_dispatch_policy::pottery_households_first;
use crate::processor_output_policy::{
    processor_input_staging_cycles, processor_output_headroom, processor_output_kind,
    ProcessorOutputKind,
};
use crate::season_policy::{EnvironmentState, WeatherKind};
use crate::simulation::delivery_trips::{
    building_has_active_trip, building_has_inbound_commodity_trip,
    building_has_inbound_supply_trip, onsite_building_labor, try_start_building_supply_trip,
};
use crate::simulation::game_calendar::GameClock;
use crate::simulation::labor_and_logistics_paused;
use crate::simulation::landmark_access::monastery_linked_to_chapel;
use crate::simulation::residence_needs::{apply_need_consumed_at_source, ResidenceNeedKind};
use crate::simulation::road_logistics::local_delivery_distance;
use crate::simulation::tick_context::SimTickContext;
use crate::simulation::trading_post_exports_commodity;
use crate::simulation::{try_dispatch_guardhouse_payroll, try_dispatch_local_civic_receipts};
use crate::specialty_trade_policy::{
    apiary_is_active, producer_output_batch_fits, vineyard_is_harvesting,
};
use crate::storehouse_policy::storehouse_stock_target;
use crate::supply_policy::{
    carpenter_cart_service_ironwork_target, carpenter_cart_service_timber_target,
    compare_institutional_food_dispatch_candidates, compare_processor_input_dispatch_candidates,
    directly_dispatched_processor_input_per_cycle as processor_input_per_cycle_for_dispatch,
    grain_input_runway_cycles, grain_input_target, granary_dispatch_order,
    institutional_food_surplus, local_material_dispatch_target, processor_input_dispatch_duty,
    processor_input_dispatch_duty_for_target, processor_input_runway_cycles,
    processor_input_target, rich_mine_support_target, rich_mine_supports_ready,
    select_grain_dispatch_candidate, select_processor_input_dispatch_candidate,
    select_seed_grain_delivery_candidate, select_supply_route_candidate, GranaryDispatchDuty,
    InstitutionalFoodDispatchDuty, ProcessorInputDispatchDuty, GRAIN_CRITICAL_RUNWAY_CYCLES,
    GRAIN_PROCESSOR_KINDS, INDUSTRIAL_FIREWOOD_TARGET_KINDS, INSTITUTIONAL_FOOD_SOURCE_KINDS,
    LOCAL_MATERIAL_SOURCE_KINDS, MARKETPLACE_MATERIAL_TARGET_KINDS,
};
use crate::tables::{farm_field, Building, FarmField, ForagingNode, Quarry, Residence};
use crate::vineyard::{fermentable_grapes, vineyard_grape_reserve};
use crate::weaver_input_policy::{weaver_fibre_delivery_preference_rank, weaver_uses_flax};

struct RoutedBuilding {
    building: Building,
    distance: f64,
}

struct RoutedMonasteryReserveTarget {
    building: Building,
    distance: f64,
    shortfall: f64,
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

struct RoutedGuardFoodTarget {
    building: Building,
    distance: f64,
    runway_days: f64,
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
/// Building update order therefore cannot let an older granary, smokehouse, or
/// guardhouse seize a cart before a more urgent destination is considered.
pub fn step_institutional_food_dispatch(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    sources: Vec<Building>,
) {
    let conflict_enabled = frontier_economy_enabled(ctx);
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
        for target_id in
            tick.building_ids_for_kinds(ctx, source.owner, &["guardhouse", "smokehouse", "granary"])
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
                if building_commodity_stock(&source, commodity) <= 1e-6
                    || building_commodity_room(&target, commodity) <= 1e-6
                {
                    continue;
                }
                let Some((duty, priority, runway, _)) =
                    institutional_food_target_plan(&target, commodity, conflict_enabled)
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
            institutional_food_target_plan(&target, candidate.commodity, conflict_enabled)
        else {
            continue;
        };
        let transferable = institutional_source_food_surplus(
            ctx,
            tick,
            &source,
            building_edible_food_stock(&source),
        )
        .min(building_commodity_stock(&source, candidate.commodity));
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
    conflict_enabled: bool,
) -> Option<(InstitutionalFoodDispatchDuty, u8, f64, f64)> {
    if !target.construction_complete || target.assigned_labor == 0 {
        return None;
    }
    match target.kind.as_str() {
        "guardhouse" if conflict_enabled => {
            let desired_stock = guardhouse_food_target(
                target.assigned_labor,
                target.polearms,
                target.guardhouse_food_reserve,
            );
            let stock = building_edible_food_stock(target);
            if desired_stock <= 1e-6 || stock + 1e-6 >= desired_stock {
                return None;
            }
            let runway = guardhouse_food_runway_days(target.assigned_labor, target.polearms, stock);
            let duty = if runway + 1e-9 < GUARDHOUSE_CRITICAL_FOOD_RUNWAY_DAYS {
                InstitutionalFoodDispatchDuty::CriticalGuard
            } else {
                InstitutionalFoodDispatchDuty::GuardReserve
            };
            Some((
                duty,
                target.guardhouse_pay_priority.saturating_add(1),
                runway,
                desired_stock,
            ))
        }
        "smokehouse" if commodity.preservation_output().is_some() => {
            let per_cycle = SMOKEHOUSE_FOOD_PER_CYCLE;
            let desired_stock =
                processor_input_target(per_cycle, target.processor_output_target_percent);
            let stock = building_preservable_food_stock(target);
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
        "granary" if target.granary_accepts_fresh_food => {
            let desired_stock = granary_fresh_food_target(
                building_commodity_cap(&target.kind, CommodityKind::Food),
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
            &["weaver", "granary"],
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

/// Granaries and staffed Trading Posts each launch at most one seed cart per
/// simulation step. Source-side selection removes farm-row iteration bias:
/// lowest claim coverage wins, then the shortest authoritative road route and
/// stable holding id. The existing inbound-trip gate prevents overlapping
/// sources from double-serving the same farmstead in one step.
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
            matches!(source.kind.as_str(), "granary" | "trading_post")
                && source.construction_complete
                && (source.rye_grain > 1e-6
                    || source.oat_grain > 1e-6
                    || source.maslin_grain > 1e-6
                    || source.barley > 1e-6
                    || source.flax > 1e-6)
                && (source.kind != "trading_post" || source.assigned_labor > 0)
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
        withdraw_building_commodity(
            &mut mill,
            CommodityKind::Ironwork,
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
        withdraw_building_commodity(
            &mut mill,
            CommodityKind::Ironwork,
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
            CommodityKind::OatGrain,
            CommodityKind::OatFlour,
            WATERMILL_OAT_FLOUR_PER_CYCLE,
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
            CommodityKind::OatFlour,
            CommodityKind::OatBread,
            BAKERY_OAT_BREAD_PER_CYCLE,
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
    let mut flours = [
        CommodityKind::RyeFlour,
        CommodityKind::OatFlour,
        CommodityKind::MaslinFlour,
    ];
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
            || (source.kind == "village_storehouse" && !source.storehouse_accepts_firewood)
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
        const DISPATCHABLE_INPUTS: [CommodityKind; 26] = [
            CommodityKind::RyeGrain,
            CommodityKind::OatGrain,
            CommodityKind::MaslinGrain,
            CommodityKind::RyeFlour,
            CommodityKind::OatFlour,
            CommodityKind::MaslinFlour,
            CommodityKind::Barley,
            CommodityKind::Malt,
            CommodityKind::Food,
            CommodityKind::Meat,
            CommodityKind::Fish,
            CommodityKind::Milk,
            CommodityKind::Wool,
            CommodityKind::Flax,
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
        ];
        candidates.extend(
            tick.building_ids_for_kinds(ctx, marketplace.owner, MARKETPLACE_MATERIAL_TARGET_KINDS)
                .into_iter()
                .filter_map(|target_id| ctx.db.building().id().find(&target_id))
                .filter_map(|building| {
                    if !building.construction_complete
                        || (building.assigned_labor == 0 && building.kind != "monastery")
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
            0,
            a.runway_cycles,
            a.distance,
            a.building.id,
            b.duty,
            CONSTRUCTION_PRIORITY_NORMAL,
            0,
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
            || (target.assigned_labor == 0 && target.kind != "monastery")
            || tick.building_disabled_by_fire(ctx, marketplace.id)
            || tick.building_disabled_by_fire(ctx, target.id)
            || labor_and_logistics_paused(ctx, tick, marketplace.owner, clock)
            || building_has_active_trip(ctx, marketplace.id)
            || building_has_inbound_supply_trip(ctx, target.id)
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
        CommodityKind::Food | CommodityKind::Meat | CommodityKind::Fish | CommodityKind::Milk => 0,
        CommodityKind::RyeGrain
        | CommodityKind::OatGrain
        | CommodityKind::MaslinGrain
        | CommodityKind::RyeFlour
        | CommodityKind::OatFlour
        | CommodityKind::MaslinFlour
        | CommodityKind::Barley
        | CommodityKind::Malt
        | CommodityKind::Grapes => 1,
        CommodityKind::Firewood | CommodityKind::Water => 2,
        CommodityKind::Iron | CommodityKind::Salt | CommodityKind::Charcoal => 3,
        CommodityKind::Wool | CommodityKind::Flax => 4,
        CommodityKind::Clay | CommodityKind::Pottery => 5,
        CommodityKind::Manure | CommodityKind::Polearms => 6,
        CommodityKind::Wine => 7,
        CommodityKind::Ironwork => 8,
        _ => 9,
    }
}

fn marketplace_material_target(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    target: &Building,
    commodity: CommodityKind,
) -> Option<(f64, f64)> {
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
    if target.kind == "guardhouse" && commodity == CommodityKind::Polearms {
        let desired = guardhouse_polearm_target(target.assigned_labor)
            .min(building_commodity_cap(&target.kind, commodity));
        return (desired > 1e-6).then_some((1.0, desired));
    }
    if target.kind == "monastery" && commodity == CommodityKind::Wine {
        let desired =
            (MONASTERY_FEAST_WINE * 5.0).min(building_commodity_cap(&target.kind, commodity));
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
    let mut deferred_pottery_local = Vec::new();
    let mut deferred_pottery_exports = Vec::new();
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
                if source.kind != "potter_kiln" {
                    candidates.push(candidate);
                    continue;
                }
                if candidate.building.kind == "trading_post" {
                    deferred_pottery_exports.push(candidate);
                    continue;
                }
                let market_wares_first = pottery_households_first(source.pottery_dispatch_policy);
                let is_primary_local_duty = (market_wares_first
                    && candidate.building.kind == "village_storehouse")
                    || (!market_wares_first && candidate.building.kind == "smokehouse");
                if is_primary_local_duty {
                    candidates.push(candidate);
                } else {
                    deferred_pottery_local.push(candidate);
                }
            }
        }
    }

    sort_local_material_candidates(&mut candidates);
    sort_local_material_candidates(&mut deferred_pottery_local);
    sort_local_material_candidates(&mut deferred_pottery_exports);

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

    // A kiln's second local duty runs only if its preferred destination had no
    // work. Storehouse keepers collect market wares; free haulers serve the
    // smokehouse buffer. Production workers remain at the kiln in both cases.
    dispatch_local_material_candidates(
        ctx,
        tick,
        clock,
        deferred_pottery_local,
        &mut used_sources,
        &mut used_targets,
    );

    // Only kilns still idle after both local duties may stage export stock.
    dispatch_local_material_candidates(
        ctx,
        tick,
        clock,
        deferred_pottery_exports,
        &mut used_sources,
        &mut used_targets,
    );
}

fn sort_local_material_candidates(candidates: &mut [LocalMaterialDispatchCandidate]) {
    candidates.sort_by(|a, b| {
        compare_processor_input_dispatch_candidates(
            a.duty,
            CONSTRUCTION_PRIORITY_NORMAL,
            0,
            a.runway_cycles,
            a.distance,
            a.building.id,
            b.duty,
            CONSTRUCTION_PRIORITY_NORMAL,
            0,
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
            || !processor_accepts_input(&target, commodity)
            || !extraction_accepts_maintenance_input(ctx, &target, commodity)
        {
            continue;
        }
        let desired_stock =
            if target.kind == "village_storehouse" && commodity == CommodityKind::Charcoal {
                if target.assigned_labor == 0
                    || !target.storehouse_accepts_charcoal
                    || combined_fuel_equivalent(target.firewood, target.charcoal) > 1e-6
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
    CommodityKind::Iron,
    CommodityKind::Salt,
    CommodityKind::Clay,
    CommodityKind::Charcoal,
    CommodityKind::Ironwork,
    CommodityKind::Pottery,
];

fn local_material_target_kinds(
    source: &Building,
    commodity: CommodityKind,
) -> Option<&'static [&'static str]> {
    match (source.kind.as_str(), commodity) {
        ("stone_quarry" | "large_quarry", CommodityKind::Iron) => {
            Some(&["smithy", "trading_post"])
        }
        ("stone_quarry" | "large_quarry", CommodityKind::Salt) => {
            Some(&["smokehouse", "pastoral_farmstead", "trading_post"])
        }
        ("stone_quarry" | "large_quarry", CommodityKind::Clay) => Some(&["potter_kiln"]),
        ("mine", CommodityKind::Iron) => Some(&["smithy", "trading_post"]),
        ("mine", CommodityKind::Salt) => {
            Some(&["smokehouse", "pastoral_farmstead", "trading_post"])
        }
        ("clay_pit", CommodityKind::Clay) => Some(&["potter_kiln"]),
        ("charcoal_burner", CommodityKind::Charcoal) => Some(&["smithy", "village_storehouse"]),
        ("smithy", CommodityKind::Ironwork) => Some(&[
            "lumber_mill",
            "woodcutters_lodge",
            "stone_quarry",
            "large_quarry",
            "mine",
            "clay_pit",
            "threshing_barn",
            "watermill",
            "windmill",
            "carpenter",
        ]),
        ("potter_kiln", CommodityKind::Pottery) => {
            Some(&["smokehouse", "village_storehouse", "trading_post"])
        }
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
            "clay_pit",
            "threshing_barn",
            "watermill",
            "windmill",
            "carpenter",
        ]),
        ("trading_post", CommodityKind::Pottery) => Some(&["smokehouse", "village_storehouse"]),
        ("village_storehouse", CommodityKind::Iron) if source.storehouse_accepts_iron => {
            Some(&["smithy", "trading_post"])
        }
        ("village_storehouse", CommodityKind::Clay) if source.storehouse_accepts_clay => {
            Some(&["potter_kiln"])
        }
        ("village_storehouse", CommodityKind::Salt) if source.storehouse_accepts_salt => {
            Some(&["smokehouse", "pastoral_farmstead", "trading_post"])
        }
        // Existing depot charcoal always remains dispatchable even when new
        // charcoal intake is disabled, so changing policy cannot strand stock.
        ("village_storehouse", CommodityKind::Charcoal) => Some(&["smithy"]),
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
        CommodityKind::Iron => "iron",
        CommodityKind::Salt => "salt",
        CommodityKind::Clay => "clay",
        CommodityKind::Charcoal => "charcoal",
        CommodityKind::Ironwork => "ironwork",
        CommodityKind::Pottery => "pottery",
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
    let mut covered_population = HashMap::<u64, u32>::new();
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
            let population = covered_population.entry(market_id).or_default();
            *population = population.saturating_add(residence.population);
        }
    }
    covered_population
        .into_iter()
        .filter_map(|(market_id, population)| {
            let market = ctx.db.building().id().find(&market_id)?;
            if building_has_inbound_commodity_trip(ctx, market.id, CommodityKind::Firewood)
                || building_has_inbound_commodity_trip(ctx, market.id, CommodityKind::Charcoal)
            {
                return None;
            }
            let target = marketplace_fuel_reserve_target(
                population,
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
        || !storehouse.storehouse_accepts_charcoal
        || combined_fuel_equivalent(storehouse.firewood, storehouse.charcoal) > 1e-6
    {
        return None;
    }
    let network = tick.road_network(storehouse.owner)?;
    // One stable empty transit depot claims a road branch at a time. Multiple
    // kilns therefore cannot each reserve the same uncovered market shortfall.
    let designated_transit_depot = tick
        .building_ids_for_kinds(ctx, storehouse.owner, &["village_storehouse"])
        .into_iter()
        .filter_map(|id| ctx.db.building().id().find(&id))
        .filter(|depot| {
            depot.construction_complete
                && depot.assigned_labor > 0
                && depot.storehouse_accepts_charcoal
                && !tick.building_disabled_by_fire(ctx, depot.id)
                && combined_fuel_equivalent(depot.firewood, depot.charcoal) <= 1e-6
                && local_delivery_distance(
                    network,
                    storehouse.x,
                    storehouse.z,
                    depot.x,
                    depot.z,
                )
                .is_some()
        })
        .map(|depot| depot.id)
        .min()?;
    if designated_transit_depot != storehouse.id {
        return None;
    }
    let linked_shortfall = market_shortfalls
        .iter()
        .filter_map(|(market_id, shortfall)| {
            let market = ctx.db.building().id().find(market_id)?;
            if market.owner != storehouse.owner {
                return None;
            }
            local_delivery_distance(network, storehouse.x, storehouse.z, market.x, market.z)
                .map(|_| *shortfall)
        })
        .sum::<f64>();
    let staged_elsewhere = tick
        .building_ids_for_kinds(ctx, storehouse.owner, &["village_storehouse"])
        .into_iter()
        .filter_map(|id| ctx.db.building().id().find(&id))
        .filter(|depot| {
            depot.id != storehouse.id
                && depot.construction_complete
                && depot.assigned_labor > 0
                && !tick.building_disabled_by_fire(ctx, depot.id)
                && local_delivery_distance(network, storehouse.x, storehouse.z, depot.x, depot.z)
                    .is_some()
        })
        .map(|depot| combined_fuel_equivalent(depot.firewood, depot.charcoal))
        .sum::<f64>();
    let unstaged_shortfall = (linked_shortfall - staged_elsewhere).max(0.0);
    let desired = (unstaged_shortfall / CHARCOAL_HOUSEHOLD_FUEL_VALUE.max(1e-9)).min(
        storehouse_stock_target(
            building_commodity_cap(&storehouse.kind, CommodityKind::Charcoal),
            storehouse.storehouse_charcoal_target_percent,
        ),
    );
    (desired > 1e-6).then_some((ProcessorInputDispatchDuty::WorkshopOverflow, desired, 0.0))
}

pub fn step_mine(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    building: Building,
) {
    let Some(deposit) = mineral_deposit_beneath(ctx, building.x, building.z) else {
        return;
    };
    if !deposit.is_rich && deposit.remaining <= 1e-6 {
        return;
    }
    let (commodity, base_batch) = if deposit.quarry_id.starts_with("deposit-iron-") {
        (CommodityKind::Iron, MINE_IRON_PER_CYCLE)
    } else {
        (CommodityKind::Salt, MINE_SALT_PER_CYCLE)
    };
    let batch = if deposit.is_rich {
        base_batch
    } else {
        base_batch.min(deposit.remaining)
    };
    let output_headroom = processor_output_headroom(
        building_commodity_stock(&building, commodity),
        building_commodity_cap(&building.kind, commodity),
        building.processor_output_target_percent,
    );
    if deposit.is_rich && output_headroom > 1e-6 {
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
    if deposit.is_rich && !rich_mine_supports_ready(building.timber) {
        ctx.db.building().id().update(building);
        return;
    }
    let tools_maintained = civilian_tools_maintained(building.ironwork);
    let tool_throughput = civilian_tool_throughput_multiplier(building.ironwork);
    let before = building_commodity_stock(&building, commodity);
    let geology_throughput = if deposit.is_rich {
        RICH_MINE_THROUGHPUT_MULTIPLIER
    } else {
        1.0
    };
    let mut mine = step_simple_producer_at_rate(
        ctx,
        tick,
        clock,
        building,
        &[(commodity, batch)],
        geology_throughput * tool_throughput,
    );
    let produced = (building_commodity_stock(&mine, commodity) - before).max(0.0);
    if produced > 1e-6 && !deposit.is_rich {
        ctx.db.quarry().quarry_id().update(Quarry {
            remaining: (deposit.remaining - produced).max(0.0),
            ..deposit
        });
    }
    if produced > 1e-6 && deposit.is_rich {
        withdraw_building_commodity(
            &mut mine,
            CommodityKind::Timber,
            MINE_TIMBER_SUPPORT_PER_CYCLE * produced / base_batch,
        );
    }
    if tools_maintained && produced > 1e-6 {
        withdraw_building_commodity(
            &mut mine,
            CommodityKind::Ironwork,
            CIVILIAN_TOOL_IRONWORK_PER_CYCLE * produced / base_batch,
        );
    }
    ctx.db.building().id().update(mine);
}

fn mineral_deposit_beneath(ctx: &ReducerContext, x: f64, z: f64) -> Option<Quarry> {
    const CENTER_TOLERANCE: f64 = 2.5;
    let tolerance_sq = CENTER_TOLERANCE * CENTER_TOLERANCE;
    ctx.db.quarry().iter().find(|deposit| {
        (deposit.quarry_id.starts_with("deposit-iron-")
            || deposit.quarry_id.starts_with("deposit-salt-"))
            && (deposit.x - x) * (deposit.x - x) + (deposit.z - z) * (deposit.z - z) <= tolerance_sq
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
    let guard_food_dispatch = next_granary_guard_food_dispatch(ctx, tick, clock, &granary);
    let grain_is_critical = grain_dispatch
        .as_ref()
        .is_some_and(|dispatch| dispatch.runway_cycles < GRAIN_CRITICAL_RUNWAY_CYCLES);
    let guard_food_preempts_grain = guard_food_dispatch.as_ref().is_some_and(|guard| {
        !grain_is_critical
            || grain_dispatch.as_ref().is_some_and(|grain| {
                let guard_urgency =
                    guard.runway_days / GUARDHOUSE_CRITICAL_FOOD_RUNWAY_DAYS.max(1e-9);
                let grain_urgency = grain.runway_cycles / GRAIN_CRITICAL_RUNWAY_CYCLES.max(1e-9);
                guard_urgency < grain_urgency - 1e-9
                    || ((guard_urgency - grain_urgency).abs() <= 1e-9
                        && guard.building.id < grain.building.id)
            })
    });
    if guard_food_preempts_grain {
        if let Some(dispatch) = guard_food_dispatch.as_ref() {
            dispatch_granary_guard_food(ctx, tick, clock, &mut granary, dispatch);
        }
    } else if grain_is_critical {
        if let Some(dispatch) = grain_dispatch.as_ref() {
            dispatch_granary_grain(ctx, tick, clock, &mut granary, dispatch);
        }
    }
    // Once urgent milling grain and military provisions are covered, granary
    // keepers replenish the workshops that consume centralized farm goods.
    for flour in [
        CommodityKind::RyeFlour,
        CommodityKind::OatFlour,
        CommodityKind::MaslinFlour,
    ] {
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
        &["weaver"],
    );
    for duty in granary_dispatch_order(granary.granary_households_first) {
        match duty {
            GranaryDispatchDuty::Households => {
                for commodity in [
                    CommodityKind::Meat,
                    CommodityKind::Fish,
                    CommodityKind::Milk,
                    CommodityKind::Mushrooms,
                    CommodityKind::Berries,
                    CommodityKind::Grapes,
                    CommodityKind::Cherries,
                    CommodityKind::Apples,
                    CommodityKind::Vegetables,
                    CommodityKind::Eggs,
                    CommodityKind::Porridge,
                    CommodityKind::RyeBread,
                    CommodityKind::OatBread,
                    CommodityKind::MaslinBread,
                    CommodityKind::Food,
                    CommodityKind::Cheese,
                    CommodityKind::SmokedFish,
                    CommodityKind::CuredMeat,
                    CommodityKind::PreservedFood,
                    CommodityKind::Honey,
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
                    &["marketplace"],
                );
            }
            GranaryDispatchDuty::Preservation => {
                for commodity in [
                    CommodityKind::Meat,
                    CommodityKind::Fish,
                    CommodityKind::Milk,
                    CommodityKind::Food,
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
) -> f64 {
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
        Some(
            expected_grain_yield(
                field.area,
                field.crop,
                field.moisture,
                field.fertility,
                field.average_slope_degrees,
                shape,
                field_center.x,
                field_center.z,
            ) * field.harvest_yield_multiplier.clamp(0.0, 1.0),
        )
    } else {
        None
    };
    let harvest_commodity = match crop_produce(field.crop) {
        FarmCropProduce::Grain => crop_sheaf_commodity(field.crop),
        FarmCropProduce::Barley => Some(CommodityKind::BarleySheaves),
        FarmCropProduce::Fibre => Some(CommodityKind::Flax),
        FarmCropProduce::None => None,
    };
    let mut spent = available_work.min(remaining);
    if let (Some(expected), Some(commodity)) = (expected_harvest, harvest_commodity) {
        if expected > 1e-9 {
            let storage_limited_work =
                required * building_commodity_room(resource_farmstead, commodity) / expected;
            spent = spent.min(storage_limited_work);
        }
    }
    let seed_required = if field.stage == STAGE_SOWING {
        seed_grain_required(field.area, field.crop)
    } else {
        0.0
    };
    let seed_commodity = crop_seed_commodity(field.crop);
    if seed_required > 1e-9 {
        let seed_limited_work = required
            * building_commodity_stock(resource_farmstead, seed_commodity).max(0.0)
            / seed_required;
        spent = spent.min(seed_limited_work);
    }
    if spent <= 1e-9 {
        return 0.0;
    }

    let previous_progress = field.stage_progress;
    field.stage_progress = (field.stage_progress + spent / required).min(1.0);
    if field.stage == STAGE_PLOUGHING {
        let manure_needed =
            field_manure_required(field.area) * (field.stage_progress - previous_progress);
        let manure_spread =
            withdraw_building_commodity(resource_farmstead, CommodityKind::Manure, manure_needed);
        field.manure_applied += manure_spread;
    }
    if seed_required > 1e-9 {
        let seed_used = seed_required * (field.stage_progress - previous_progress).clamp(0.0, 1.0);
        withdraw_building_commodity(resource_farmstead, seed_commodity, seed_used);
    }
    if let (Some(expected), Some(commodity)) = (expected_harvest, harvest_commodity) {
        let harvested = expected * (field.stage_progress - previous_progress).max(0.0);
        let deposited = deposit_building_commodity(resource_farmstead, commodity, harvested);
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
                finish_field_cycle(field, expected_harvest.unwrap_or_default());
            }
            _ => {}
        }
    }
    spent
}

fn field_work_is_ready(field: &FarmField, resource_farmstead: &Building) -> bool {
    match field.stage {
        STAGE_SOWING => {
            building_commodity_stock(resource_farmstead, crop_seed_commodity(field.crop)) > 1e-6
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
    work_allowed: bool,
    onsite_labor: u32,
    mut fields: Vec<FarmField>,
) -> FarmsteadWorkResult {
    // Rain and drought persistently change soil moisture, which later affects yield.
    for field in &mut fields {
        let moisture_change_per_day = match environment.weather {
            WeatherKind::Rain => 0.012,
            WeatherKind::Drought => -0.035,
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
    let mut work_budget = if work_allowed && threshing_labor == 0 {
        onsite_labor as f64 * FARM_WORK_METERS_PER_WORKER_PER_SEC * TICK_DT * farm_tool_throughput
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
        let spent = if field.farmstead_id == worker_farmstead_id {
            apply_farm_field_work(
                field,
                farmstead,
                farmstead.x,
                farmstead.z,
                plough_multiplier,
                work_budget,
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
                work_budget,
            );
            if spent > 1e-9 {
                ctx.db.building().id().update(resource_farmstead);
            }
            spent
        };
        if spent <= 1e-9 {
            continue;
        }
        work_budget -= spent;
        if farm_tools_ready {
            withdraw_building_commodity(
                farmstead,
                CommodityKind::Ironwork,
                farm_tool_ironwork_for_work(spent),
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

fn finish_field_cycle(field: &mut FarmField, harvested: f64) {
    let manure_bonus = settle_field_manure_bonus(field);
    field.last_yield = harvested;
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
    let ale_headroom = processor_output_headroom(
        brewery.ale,
        building_commodity_cap(&brewery.kind, CommodityKind::Ale),
        brewery.processor_output_target_percent,
    );
    if ale_headroom > 1e-6 {
        let malt_working_target = (BREWERY_MALT_PER_ALE_CYCLE * input_staging_cycles)
            .min(building_commodity_cap(&brewery.kind, CommodityKind::Malt));
        let should_malt = brewery.barley > 1e-6 && brewery.malt + 1e-6 < malt_working_target;
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
    dispatch_monastery_feast_ale(ctx, tick, clock, &mut brewery);
    dispatch_to_building(
        ctx,
        tick,
        clock,
        &mut brewery,
        CommodityKind::Ale,
        &["granary"],
    );
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

pub fn step_weaver(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    building: Building,
) {
    let inputs = if weaver_uses_flax(
        building.weaver_input_policy,
        building.wool,
        building.flax,
        building.water,
        WEAVER_WOOL_PER_CYCLE,
        WEAVER_FLAX_PER_CYCLE,
        WEAVER_FLAX_WATER_PER_CYCLE,
    ) {
        [
            (CommodityKind::Flax, WEAVER_FLAX_PER_CYCLE),
            (CommodityKind::Water, WEAVER_FLAX_WATER_PER_CYCLE),
        ]
    } else {
        [
            (CommodityKind::Wool, WEAVER_WOOL_PER_CYCLE),
            (CommodityKind::Water, 0.0),
        ]
    };
    let mut weaver = step_processor(
        ctx,
        tick,
        clock,
        building,
        &inputs,
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

pub fn step_smokehouse(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    building: Building,
) {
    let mut smokehouse = building;
    let selected_input = [
        CommodityKind::Meat,
        CommodityKind::Fish,
        CommodityKind::Milk,
        CommodityKind::Food,
    ]
    .into_iter()
    .find(|commodity| {
        building_commodity_stock(&smokehouse, *commodity) + 1e-6 >= SMOKEHOUSE_FOOD_PER_CYCLE
    });
    if let Some(input) = selected_input {
        let output = input
            .preservation_output()
            .expect("smokehouse input must retain a preservation identity");
        smokehouse = step_processor(
            ctx,
            tick,
            clock,
            smokehouse,
            &[
                (input, SMOKEHOUSE_FOOD_PER_CYCLE),
                (CommodityKind::Firewood, SMOKEHOUSE_FIREWOOD_PER_CYCLE),
                (CommodityKind::Salt, SMOKEHOUSE_SALT_PER_CYCLE),
                (CommodityKind::Pottery, SMOKEHOUSE_POTTERY_PER_CYCLE),
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
        CommodityKind::PreservedFood,
    ] {
        dispatch_to_building_where(
            ctx,
            tick,
            clock,
            &mut smokehouse,
            commodity,
            &["granary"],
            |target| target.granary_accepts_fresh_food,
        );
    }
    ctx.db.building().id().update(smokehouse);
}

pub fn step_clay_pit(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    environment: EnvironmentState,
    world_seed: u64,
    world_hydrology: u8,
    resource_abundance: u8,
    building: Building,
) {
    let Some(mut deposit) = clay_deposit_beneath(ctx, building.x, building.z) else {
        return;
    };
    let is_rich = deposit.node_id.starts_with("clay-rich-");
    if !is_rich && deposit.remaining <= 1e-6 {
        return;
    }
    let tools_maintained = civilian_tools_maintained(building.ironwork);
    let throughput_multiplier = civilian_tool_throughput_multiplier(building.ironwork)
        * environment.clay_pit_throughput_multiplier()
        * clay_bank_yield_multiplier_at_deposit(
            building.x,
            building.z,
            world_seed,
            world_hydrology,
            resource_abundance,
            &deposit,
        );
    let clay_before = building.clay;
    let clay_batch = if is_rich {
        CLAY_PIT_CLAY_PER_CYCLE
    } else {
        CLAY_PIT_CLAY_PER_CYCLE.min(deposit.remaining.max(0.0))
    };
    let mut clay_pit = step_simple_producer_at_rate(
        ctx,
        tick,
        clock,
        building,
        &[(CommodityKind::Clay, clay_batch)],
        throughput_multiplier,
    );
    let clay_produced = (clay_pit.clay - clay_before).max(0.0);
    if !is_rich && clay_produced > 1e-6 {
        deposit.remaining = (deposit.remaining - clay_produced).max(0.0);
        ctx.db.foraging_node().node_id().update(deposit);
    }
    if tools_maintained && clay_produced > 1e-6 {
        withdraw_building_commodity(
            &mut clay_pit,
            CommodityKind::Ironwork,
            CIVILIAN_TOOL_IRONWORK_PER_CYCLE * clay_produced / CLAY_PIT_CLAY_PER_CYCLE,
        );
    }
    ctx.db.building().id().update(clay_pit);
}

fn clay_deposit_beneath(ctx: &ReducerContext, x: f64, z: f64) -> Option<ForagingNode> {
    const CENTER_TOLERANCE: f64 = 2.5;
    let tolerance_sq = CENTER_TOLERANCE * CENTER_TOLERANCE;
    ctx.db.foraging_node().iter().find(|deposit| {
        deposit.node_kind == "clay"
            && deposit.node_id.starts_with("clay-")
            && (deposit.x - x) * (deposit.x - x) + (deposit.z - z) * (deposit.z - z) <= tolerance_sq
    })
}

fn clay_bank_yield_multiplier_at_deposit(
    x: f64,
    z: f64,
    world_seed: u64,
    world_hydrology: u8,
    resource_abundance: u8,
    deposit: &ForagingNode,
) -> f64 {
    let richness = if deposit.node_id.starts_with("clay-rich-") {
        1.0
    } else {
        0.0
    };
    clay_bank_yield_multiplier_with_richness(
        sample_world_hydrology_score(x, z, world_seed, world_hydrology),
        resource_abundance,
        richness,
    )
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
    let forage_score = apiary_landscape_forage_score(ctx, &building);
    building.apiary_forage_score = forage_score;
    building.apiary_colony_health = building.apiary_colony_health.clamp(0.35, 1.10);

    if clock.month == 12 && building.apiary_last_winter_year != clock.year {
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
    let mut apiary = if apiary_is_active(clock.month as u8) {
        step_simple_producer_at_rate(
            ctx,
            tick,
            clock,
            building,
            &[(CommodityKind::Honey, APIARY_HONEY_PER_CYCLE)],
            production_rate,
        )
    } else {
        building
    };
    let reserve = apiary_honey_reserve(apiary.apiary_harvest_policy);
    let transferable = (apiary.honey - reserve).max(0.0);
    dispatch_monastery_hospitality_limited(
        ctx,
        tick,
        clock,
        &mut apiary,
        CommodityKind::Honey,
        transferable,
    );
    let transferable = (apiary.honey - reserve).max(0.0);
    dispatch_to_building_where_limited(
        ctx,
        tick,
        clock,
        &mut apiary,
        CommodityKind::Honey,
        &["marketplace"],
        transferable,
        |_| true,
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

pub fn step_vineyard(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    building: Building,
) {
    let production_multiplier = ctx
        .db
        .vineyard_parcel()
        .building_id()
        .find(&building.id)
        .map(|parcel| {
            crate::vineyard::production_multiplier(
                parcel.area,
                parcel.site_suitability,
                parcel.shape_efficiency,
            )
        })
        // Legacy point-placed vineyards keep their original save-compatible output.
        .unwrap_or(1.0)
        * nearby_apiary_pollination_multiplier(ctx, tick, building.owner, building.x, building.z);
    let mut vineyard = if vineyard_is_harvesting(clock.month as u8) {
        step_simple_producer_at_rate(
            ctx,
            tick,
            clock,
            building,
            &[(CommodityKind::Grapes, VINEYARD_GRAPES_PER_HARVEST_CYCLE)],
            production_multiplier,
        )
    } else {
        building
    };
    advance_vineyard_fermentation(ctx, tick, clock, &mut vineyard);
    dispatch_monastery_hospitality(ctx, tick, clock, &mut vineyard, CommodityKind::Wine);
    dispatch_to_building(
        ctx,
        tick,
        clock,
        &mut vineyard,
        CommodityKind::Wine,
        &["trading_post"],
    );
    ctx.db.building().id().update(vineyard);
}

fn advance_vineyard_fermentation(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    vineyard: &mut Building,
) {
    let onsite_labor = onsite_building_labor(ctx, vineyard);
    if onsite_labor == 0 || labor_and_logistics_paused(ctx, tick, vineyard.owner, clock) {
        return;
    }

    if vineyard.vineyard_fermenting_grapes <= 1e-9 {
        let available = fermentable_grapes(vineyard.grapes, vineyard.vineyard_production_policy);
        if available + 1e-6 < VINEYARD_GRAPES_PER_FERMENTATION_BATCH
            || building_commodity_room(vineyard, CommodityKind::Wine) + 1e-6
                < VINEYARD_WINE_PER_FERMENTATION_BATCH
        {
            vineyard.vineyard_fermentation_progress = 0.0;
            return;
        }
        let staged = withdraw_building_commodity(
            vineyard,
            CommodityKind::Grapes,
            VINEYARD_GRAPES_PER_FERMENTATION_BATCH,
        );
        if staged + 1e-6 < VINEYARD_GRAPES_PER_FERMENTATION_BATCH {
            deposit_building_commodity(vineyard, CommodityKind::Grapes, staged);
            return;
        }
        vineyard.vineyard_fermenting_grapes = staged;
        vineyard.vineyard_fermentation_progress = 0.0;
    }

    vineyard.vineyard_fermentation_progress += TICK_DT * onsite_labor as f64;
    if vineyard.vineyard_fermentation_progress + 1e-6 < VINEYARD_FERMENTATION_SECONDS
        || building_commodity_room(vineyard, CommodityKind::Wine) + 1e-6
            < VINEYARD_WINE_PER_FERMENTATION_BATCH
    {
        return;
    }

    deposit_building_commodity(
        vineyard,
        CommodityKind::Wine,
        VINEYARD_WINE_PER_FERMENTATION_BATCH,
    );
    vineyard.vineyard_fermenting_grapes = 0.0;
    vineyard.vineyard_fermentation_progress = 0.0;
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
            ctx.db
                .building()
                .id()
                .find(&parcel.building_id)
                .filter(|vineyard| {
                    (vineyard.x - apiary.x).powi(2) + (vineyard.z - apiary.z).powi(2) <= radius_sq
                })
                .map(|_| parcel.area.max(0.0))
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
    pollination_multiplier(full_apiary_contribution + backyard_contribution)
}

pub fn step_monastery(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    building: Building,
) {
    let linked = monastery_has_parish_link(ctx, tick, &building);
    let productivity = if linked {
        1.0
    } else {
        MONASTERY_UNLINKED_PRODUCTIVITY
    };
    let mut monastery = step_autonomous_processor(
        ctx,
        tick,
        clock,
        building,
        &[(
            CommodityKind::OatGrain,
            MONASTERY_OAT_GRAIN_PER_CYCLE * productivity,
        )],
        &[(
            CommodityKind::Porridge,
            MONASTERY_FOOD_PER_CYCLE * productivity,
        )],
    );

    let hospitality_enabled = tick.monastery_hospitality_enabled(ctx, monastery.owner);
    let mut receipt_daily_income = MONASTERY_PILGRIMAGE_GOLD_PER_DAY;
    if linked && owner_has_connected_marketplace(ctx, tick, &monastery) {
        // Honey abstracts both table use and beeswax for worship; wine supports
        // liturgy and guests. Both remain physical stores with an export value.
        let hospitality = monastery_hospitality_use(
            monastery.honey,
            monastery.wine,
            TICK_DT,
            CALENDAR_SECONDS_PER_DAY,
            hospitality_enabled,
        );
        withdraw_building_commodity(&mut monastery, CommodityKind::Honey, hospitality.honey_used);
        withdraw_building_commodity(&mut monastery, CommodityKind::Wine, hospitality.wine_used);
        receipt_daily_income = monastery_pilgrimage_gold(
            hospitality_enabled,
            hospitality.supply_ratio,
            CALENDAR_SECONDS_PER_DAY,
            CALENDAR_SECONDS_PER_DAY,
        );
        let gold = receipt_daily_income * TICK_DT / CALENDAR_SECONDS_PER_DAY;
        let credited = credit_local_civic_receipts(ctx, &mut monastery, gold);
        if let Some(mut treasury) = ctx.db.player_resources().owner().find(&monastery.owner) {
            treasury.monastery_pilgrimage_gold_total += credited;
            ctx.db.player_resources().owner().update(treasury);
        }
    }
    if linked {
        // Scheduled communal hospitality claims its complete pantry batch
        // before ordinary household carts. This makes feast preparation a
        // predictable reserve decision instead of a race with the noon route.
        run_monastery_feast(ctx, tick, clock, &mut monastery);
        dispatch_to_building(
            ctx,
            tick,
            clock,
            &mut monastery,
            CommodityKind::Ale,
            &["granary"],
        );
    }
    try_dispatch_local_civic_receipts(ctx, tick, clock, &mut monastery, receipt_daily_income);
    ctx.db.building().id().update(monastery);
}

fn frontier_economy_enabled(ctx: &ReducerContext) -> bool {
    ctx.db
        .world_config()
        .id()
        .find(&0)
        .is_some_and(|config| config.conflict_enabled)
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

    if !frontier_economy_enabled(ctx) {
        building.action_cooldown = (building.action_cooldown - TICK_DT).max(0.0);
        ctx.db.building().id().update(building);
        return;
    }

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
    dispatch_polearms_to_guardhouse(ctx, tick, clock, &mut building);
    ctx.db.building().id().update(building);
}

pub fn step_guardhouse(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    mut building: Building,
) {
    if !frontier_economy_enabled(ctx) {
        building.action_cooldown = 0.0;
        ctx.db.building().id().update(building);
        return;
    }

    let armed_guards = armed_guards(building.assigned_labor, building.polearms);
    if armed_guards <= 1e-6 {
        building.action_cooldown = next_guard_readiness(
            building.action_cooldown,
            0.0,
            TICK_DT,
            CALENDAR_SECONDS_PER_DAY,
        );
        ctx.db.building().id().update(building);
        return;
    }

    let physical_payroll = ctx
        .db
        .player_resources()
        .owner()
        .find(&building.owner)
        .is_some_and(|resources| resources.physical_founding_site_enabled);
    if physical_payroll {
        try_dispatch_guardhouse_payroll(ctx, tick, clock, &building, armed_guards);
    }
    let available_gold = if physical_payroll {
        building.gold
    } else {
        treasury_gold(ctx, building.owner)
    };
    let upkeep = guard_upkeep(
        armed_guards,
        building_edible_food_stock(&building),
        available_gold,
        TICK_DT,
        CALENDAR_SECONDS_PER_DAY,
    );
    withdraw_building_edible_food(&mut building, upkeep.food_due * upkeep.supply_ratio);
    let wage_paid = upkeep.wage_due * upkeep.supply_ratio;
    if physical_payroll {
        let withdrawn = withdraw_building_commodity(&mut building, CommodityKind::Gold, wage_paid);
        let credited = credit_settlement_household_income(ctx, building.owner, withdrawn);
        // A fully capped household sector cannot absorb more private coin;
        // keep the remainder in the company chest rather than deleting it.
        deposit_building_commodity(
            &mut building,
            CommodityKind::Gold,
            (withdrawn - credited).max(0.0),
        );
    } else {
        if spend_treasury_gold(ctx, building.owner, wage_paid).is_ok() {
            let credited = credit_settlement_household_income(ctx, building.owner, wage_paid);
            if credited + 1e-9 < wage_paid {
                restore_treasury_gold(ctx, building.owner, wage_paid - credited);
            }
        }
    }
    building.action_cooldown = next_guard_readiness(
        building.action_cooldown,
        upkeep.supply_ratio,
        TICK_DT,
        CALENDAR_SECONDS_PER_DAY,
    );
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
    let uses_extraction_target = !outputs.is_empty()
        && outputs
            .iter()
            .all(|(kind, _)| production_output_target_applies(&building.kind, *kind));
    let output_ready = if uses_extraction_target {
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
    if uses_extraction_target {
        let target_percent = building.processor_output_target_percent;
        process_batch(&mut building, &[], outputs, 1.0, Some(target_percent));
    } else {
        for (kind, amount) in outputs {
            deposit_building_commodity(&mut building, *kind, *amount);
        }
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
        crate::simulation::commute_adjusted_labor(ctx, tick, &building, assigned_labor);
    if productive_labor <= 1e-9 {
        return building;
    }
    building.action_cooldown = (building.action_cooldown - TICK_DT).max(0.0);
    if building.action_cooldown > 1e-6 {
        return building;
    }
    let output_target_percent = building.processor_output_target_percent;
    process_batch(
        &mut building,
        inputs,
        outputs,
        1.0,
        Some(output_target_percent),
    );
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
    process_batch(
        &mut building,
        inputs,
        outputs,
        1.0,
        Some(output_target_percent),
    );
    reset_cycle(&mut building, labor);
    building
}

fn step_autonomous_processor(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    mut building: Building,
    inputs: &[(CommodityKind, f64)],
    outputs: &[(CommodityKind, f64)],
) -> Building {
    if cycle_labor_if_ready(ctx, tick, clock, &mut building, true).is_none() {
        return building;
    }
    process_batch(&mut building, inputs, outputs, 1.0, None);
    reset_cycle(&mut building, 1.0);
    building
}

fn process_batch(
    building: &mut Building,
    inputs: &[(CommodityKind, f64)],
    outputs: &[(CommodityKind, f64)],
    labor: f64,
    output_target_percent: Option<u8>,
) {
    let mut scale = labor;
    for (kind, amount) in inputs {
        if *amount > 1e-6 {
            scale = scale.min(building_commodity_stock(building, *kind) / amount);
        }
    }
    for (kind, amount) in outputs {
        if *amount > 1e-6 {
            let room = if output_target_percent.is_some()
                && production_output_target_applies(&building.kind, *kind)
            {
                processor_output_headroom(
                    if building.kind == "smokehouse" && kind.is_preserved_food() {
                        crate::economy::building_preserved_food_stock(building)
                    } else {
                        building_commodity_stock(building, *kind)
                    },
                    building_commodity_cap(&building.kind, *kind),
                    output_target_percent.unwrap_or(100),
                )
            } else {
                building_commodity_room(building, *kind)
            };
            scale = scale.min(room / amount);
        }
    }
    if scale <= 1e-6 {
        return;
    }
    for (kind, amount) in inputs {
        withdraw_building_commodity(building, *kind, amount * scale);
    }
    for (kind, amount) in outputs {
        deposit_building_commodity(building, *kind, amount * scale);
    }
}

fn processor_output_commodity(kind: &str) -> Option<CommodityKind> {
    if kind == "bakery" {
        return Some(CommodityKind::RyeBread);
    }
    match processor_output_kind(kind)? {
        ProcessorOutputKind::Flour => Some(CommodityKind::RyeFlour),
        ProcessorOutputKind::Food => Some(CommodityKind::Food),
        ProcessorOutputKind::Ale => Some(CommodityKind::Ale),
        ProcessorOutputKind::PreservedFood => Some(CommodityKind::PreservedFood),
        ProcessorOutputKind::Cloth => Some(CommodityKind::Cloth),
        ProcessorOutputKind::Charcoal => Some(CommodityKind::Charcoal),
        ProcessorOutputKind::Ironwork => Some(CommodityKind::Ironwork),
        ProcessorOutputKind::Pottery => Some(CommodityKind::Pottery),
    }
}

fn production_output_target_applies(kind: &str, commodity: CommodityKind) -> bool {
    processor_output_commodity(kind) == Some(commodity)
        || (kind == "smokehouse" && commodity.is_preserved_food())
        || matches!(
            (kind, commodity),
            ("stone_quarry", CommodityKind::Stone)
                | ("stone_quarry", CommodityKind::Iron)
                | ("stone_quarry", CommodityKind::Salt)
                | ("stone_quarry", CommodityKind::Clay)
                | ("large_quarry", CommodityKind::Stone)
                | ("large_quarry", CommodityKind::Iron)
                | ("large_quarry", CommodityKind::Salt)
                | ("large_quarry", CommodityKind::Clay)
                | ("clay_pit", CommodityKind::Clay)
                | ("mine", CommodityKind::Iron)
                | ("mine", CommodityKind::Salt)
                | ("potter_kiln", CommodityKind::RoofTiles)
        )
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
        let commodity = if deposit.quarry_id.starts_with("deposit-iron-") {
            CommodityKind::Iron
        } else if deposit.quarry_id.starts_with("deposit-salt-") {
            CommodityKind::Salt
        } else if deposit.quarry_id.starts_with("quarry-") {
            CommodityKind::Stone
        } else {
            continue;
        };
        let distance_sq = (deposit.x - x).powi(2) + (deposit.z - z).powi(2);
        if distance_sq <= radius_sq && distance_sq < nearest_distance_sq {
            nearest = Some(commodity);
            nearest_distance_sq = distance_sq;
        }
    }
    for deposit in ctx.db.foraging_node().iter() {
        if deposit.node_kind != "clay"
            || !deposit.node_id.starts_with("clay-")
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

fn rich_extraction_commodity_beneath(
    ctx: &ReducerContext,
    x: f64,
    z: f64,
) -> Option<CommodityKind> {
    const CENTER_TOLERANCE_SQ: f64 = 2.5 * 2.5;
    for deposit in ctx.db.quarry().iter() {
        if !deposit.is_rich
            || (deposit.x - x).powi(2) + (deposit.z - z).powi(2) > CENTER_TOLERANCE_SQ
        {
            continue;
        }
        if deposit.quarry_id.starts_with("deposit-iron-") {
            return Some(CommodityKind::Iron);
        }
        if deposit.quarry_id.starts_with("deposit-salt-") {
            return Some(CommodityKind::Salt);
        }
        if deposit.quarry_id.starts_with("quarry-") {
            return Some(CommodityKind::Stone);
        }
    }
    ctx.db.foraging_node().iter().find_map(|deposit| {
        (deposit.node_kind == "clay"
            && deposit.node_id.starts_with("clay-rich-")
            && (deposit.x - x).powi(2) + (deposit.z - z).powi(2) <= CENTER_TOLERANCE_SQ)
            .then_some(CommodityKind::Clay)
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
        "large_quarry" => rich_extraction_commodity_beneath(ctx, building.x, building.z),
        "clay_pit" => Some(CommodityKind::Clay),
        "mine" => mineral_deposit_beneath(ctx, building.x, building.z).and_then(|deposit| {
            if deposit.quarry_id.starts_with("deposit-iron-") {
                Some(CommodityKind::Iron)
            } else if deposit.quarry_id.starts_with("deposit-salt-") {
                Some(CommodityKind::Salt)
            } else {
                None
            }
        }),
        _ => return true,
    };
    output.is_some()
}

fn processor_uses_input(kind: &str, commodity: CommodityKind) -> bool {
    match kind {
        "watermill" | "windmill" => matches!(
            commodity,
            CommodityKind::RyeGrain | CommodityKind::OatGrain | CommodityKind::MaslinGrain
        ),
        "bakery" => matches!(
            commodity,
            CommodityKind::RyeFlour
                | CommodityKind::OatFlour
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
        ),
        "vineyard" => commodity == CommodityKind::Grapes,
        "smokehouse" => {
            matches!(
                commodity,
                CommodityKind::Food
                    | CommodityKind::Meat
                    | CommodityKind::Fish
                    | CommodityKind::Milk
                    | CommodityKind::Firewood
                    | CommodityKind::Salt
                    | CommodityKind::Pottery
            )
        }
        "weaver" => matches!(
            commodity,
            CommodityKind::Wool | CommodityKind::Flax | CommodityKind::Water
        ),
        "charcoal_burner" => commodity == CommodityKind::Firewood,
        "smithy" => matches!(
            commodity,
            CommodityKind::Iron | CommodityKind::Charcoal | CommodityKind::Water
        ),
        "potter_kiln" => matches!(
            commodity,
            CommodityKind::Clay | CommodityKind::Firewood | CommodityKind::Water
        ),
        _ => false,
    }
}

pub(crate) fn processor_accepts_input(building: &Building, commodity: CommodityKind) -> bool {
    if building.kind == "granary" && (commodity.is_fresh_food() || commodity.is_preserved_food()) {
        return building.granary_accepts_fresh_food;
    }
    if building.kind == "pastoral_farmstead" && commodity == CommodityKind::Salt {
        return normalize_milk_use_policy(building.processor_output_target_percent)
            != MILK_USE_FRESH
            && building_commodity_room(building, CommodityKind::Cheese) > 1e-6;
    }
    if building.kind == "smokehouse" && processor_uses_input(&building.kind, commodity) {
        return processor_output_headroom(
            crate::economy::building_preserved_food_stock(building),
            building_commodity_cap(&building.kind, CommodityKind::PreservedFood),
            building.processor_output_target_percent,
        ) > 1e-6;
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

fn commodity_transfer_per_trip(commodity: CommodityKind) -> f64 {
    match commodity {
        CommodityKind::Wool | CommodityKind::Flax | CommodityKind::Cloth => {
            TEXTILE_TRANSFER_PER_TRIP
        }
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
            crate::simulation::commute_adjusted_labor(ctx, tick, building, onsite_labor);
        if productive_labor <= 1e-9 {
            return None;
        }
        productive_labor
    };
    building.action_cooldown =
        (building.action_cooldown - TICK_DT * throughput_multiplier.max(0.0)).max(0.0);
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
            &["watermill", "windmill", "monastery", "granary"]
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
                    || (target.kind != "monastery" && target.assigned_labor == 0)
                    || !processor_accepts_input(&target, commodity)
                    || building_has_inbound_supply_trip(ctx, target.id)
                    || granary_typed_grain_surplus(source, commodity) <= 1e-6
                {
                    return None;
                }
                let productivity = if target.kind == "monastery"
                    && !monastery_has_parish_link(ctx, tick, &target)
                {
                    MONASTERY_UNLINKED_PRODUCTIVITY
                } else {
                    1.0
                };
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
        GRAIN_TRANSFER_PER_TRIP,
        needed,
    )
}

/// Central military provisions leave from the granary so target-side pulls
/// cannot bypass its household/preservation policy. Only an armed company
/// below the emergency runway is eligible; lowest runway, route, then stable
/// id determines which guardhouse receives the next cart.
fn next_granary_guard_food_dispatch(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    source: &Building,
) -> Option<RoutedGuardFoodTarget> {
    if !frontier_economy_enabled(ctx)
        || source.kind != "granary"
        || source.assigned_labor <= 1
        || labor_and_logistics_paused(ctx, tick, source.owner, clock)
        || building_has_active_trip(ctx, source.id)
    {
        return None;
    }
    let transferable =
        institutional_source_food_surplus(ctx, tick, source, building_edible_food_stock(source));
    if transferable <= 1e-6 {
        return None;
    }
    let network = tick.road_network(source.owner)?;
    select_guardhouse_food_candidate(
        tick.building_ids_for_kinds(ctx, source.owner, &["guardhouse"])
            .into_iter()
            .filter_map(|target_id| ctx.db.building().id().find(&target_id))
            .filter_map(|target| {
                if target.id == source.id
                    || target.kind != "guardhouse"
                    || !target.construction_complete
                    || tick.building_disabled_by_fire(ctx, target.id)
                    || target.assigned_labor == 0
                    || building_has_inbound_supply_trip(ctx, target.id)
                {
                    return None;
                }
                let desired_stock = guardhouse_food_target(
                    target.assigned_labor,
                    target.polearms,
                    target.guardhouse_food_reserve,
                );
                let target_food = building_edible_food_stock(&target);
                if desired_stock <= 1e-6 || target_food + 1e-6 >= desired_stock {
                    return None;
                }
                let runway_days = guardhouse_food_runway_days(
                    target.assigned_labor,
                    target.polearms,
                    target_food,
                );
                if runway_days + 1e-9 >= GUARDHOUSE_CRITICAL_FOOD_RUNWAY_DAYS {
                    return None;
                }
                local_delivery_distance(network, source.x, source.z, target.x, target.z).map(
                    |distance| RoutedGuardFoodTarget {
                        building: target,
                        distance,
                        runway_days,
                        desired_stock,
                    },
                )
            }),
        |candidate| candidate.runway_days,
        |candidate| candidate.distance,
        |candidate| candidate.building.id,
    )
}

fn dispatch_granary_guard_food(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    source: &mut Building,
    dispatch: &RoutedGuardFoodTarget,
) -> bool {
    let Some(network) = tick.road_network(source.owner) else {
        return false;
    };
    let transferable =
        institutional_source_food_surplus(ctx, tick, source, building_edible_food_stock(source));
    let Some(commodity) = first_building_edible_commodity(source) else {
        return false;
    };
    let needed = (dispatch.desired_stock - building_edible_food_stock(&dispatch.building))
        .max(0.0)
        .min(transferable)
        .min(building_commodity_stock(source, commodity))
        .min(building_commodity_room(&dispatch.building, commodity));
    try_start_building_supply_trip(
        ctx,
        tick,
        clock,
        network,
        source,
        &dispatch.building,
        1,
        commodity,
        TIMBER_DELIVERY_SPEED_MPS,
        TIMBER_DELIVERY_UNLOAD_SEC,
        GRAIN_TRANSFER_PER_TRIP,
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

fn dispatch_polearms_to_guardhouse(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    source: &mut Building,
) {
    if labor_and_logistics_paused(ctx, tick, source.owner, clock)
        || building_has_active_trip(ctx, source.id)
        || source.polearms <= 1e-6
    {
        return;
    }
    let Some(network) = tick.road_network(source.owner) else {
        return;
    };
    let Some((routed_target, desired_stock)) = select_guardhouse_armament_candidate(
        tick.building_ids_for_kinds(ctx, source.owner, &["guardhouse"])
            .into_iter()
            .filter_map(|target_id| ctx.db.building().id().find(&target_id))
            .filter_map(|target| {
                if target.id == source.id
                    || target.kind != "guardhouse"
                    || !target.construction_complete
                    || tick.building_disabled_by_fire(ctx, target.id)
                    || building_has_inbound_supply_trip(ctx, target.id)
                {
                    return None;
                }
                let desired_stock = guardhouse_polearm_target(target.assigned_labor).min(
                    building_commodity_cap(&target.kind, CommodityKind::Polearms),
                );
                if desired_stock <= 1e-6 || target.polearms + 1e-6 >= desired_stock {
                    return None;
                }
                local_delivery_distance(network, source.x, source.z, target.x, target.z).map(
                    |distance| {
                        (
                            RoutedBuilding {
                                building: target,
                                distance,
                            },
                            desired_stock,
                        )
                    },
                )
            }),
        |candidate| candidate.0.building.guardhouse_pay_priority,
        |candidate| {
            guardhouse_polearm_coverage(
                candidate.0.building.assigned_labor,
                candidate.0.building.polearms,
            )
        },
        |candidate| candidate.0.distance,
        |candidate| candidate.0.building.id,
    ) else {
        return;
    };
    let target = &routed_target.building;
    let needed = (desired_stock - target.polearms)
        .max(0.0)
        .min(source.polearms);
    try_start_building_supply_trip(
        ctx,
        tick,
        clock,
        network,
        source,
        target,
        1,
        CommodityKind::Polearms,
        TIMBER_DELIVERY_SPEED_MPS,
        TIMBER_DELIVERY_UNLOAD_SEC,
        commodity_transfer_per_trip(CommodityKind::Polearms),
        needed,
    );
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
    let transferable = if commodity == CommodityKind::Food {
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
                    || !processor_accepts_input(&target, commodity)
                    || building_commodity_room(&target, commodity) <= 1e-6
                    || building_has_inbound_supply_trip(ctx, target.id)
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
                let input_preference_rank = if target.kind == "weaver" {
                    match commodity {
                        CommodityKind::Wool => {
                            weaver_fibre_delivery_preference_rank(target.weaver_input_policy, false)
                        }
                        CommodityKind::Flax => {
                            weaver_fibre_delivery_preference_rank(target.weaver_input_policy, true)
                        }
                        _ => 0,
                    }
                } else {
                    0
                };
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
    let needed = (routed_target.desired_stock - building_commodity_stock(target, commodity))
        .max(0.0)
        .min(transferable);
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
        if farmhouse_cheese_salt_staging_cycles(building.processor_output_target_percent) > 0.0 {
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
        per_cycle.max(0.0)
            * farmhouse_cheese_salt_staging_cycles(building.processor_output_target_percent)
    } else {
        processor_input_target(per_cycle, building.processor_output_target_percent)
    }
}

fn directly_dispatched_commodity_name(commodity: CommodityKind) -> Option<&'static str> {
    match commodity {
        CommodityKind::RyeGrain => Some("ryeGrain"),
        CommodityKind::OatGrain => Some("oatGrain"),
        CommodityKind::MaslinGrain => Some("maslinGrain"),
        CommodityKind::Barley => Some("barley"),
        CommodityKind::Malt => Some("malt"),
        CommodityKind::RyeFlour => Some("ryeFlour"),
        CommodityKind::OatFlour => Some("oatFlour"),
        CommodityKind::MaslinFlour => Some("maslinFlour"),
        CommodityKind::Food => Some("food"),
        CommodityKind::Meat => Some("meat"),
        CommodityKind::Fish => Some("fish"),
        CommodityKind::Milk => Some("milk"),
        CommodityKind::Wool => Some("wool"),
        CommodityKind::Flax => Some("flax"),
        CommodityKind::Ironwork => Some("ironwork"),
        CommodityKind::Clay => Some("clay"),
        CommodityKind::Charcoal => Some("charcoal"),
        CommodityKind::Pottery => Some("pottery"),
        CommodityKind::Firewood => Some("firewood"),
        CommodityKind::Water => Some("water"),
        CommodityKind::Iron => Some("iron"),
        CommodityKind::Salt => Some("salt"),
        CommodityKind::Grapes => Some("grapes"),
        _ => None,
    }
}

fn dispatch_monastery_hospitality(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    source: &mut Building,
    commodity: CommodityKind,
) {
    if !tick.monastery_hospitality_enabled(ctx, source.owner) {
        return;
    }
    dispatch_to_building_where(
        ctx,
        tick,
        clock,
        source,
        commodity,
        &["monastery"],
        |target| monastery_has_parish_link(ctx, tick, target),
    );
}

fn dispatch_monastery_hospitality_limited(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    source: &mut Building,
    commodity: CommodityKind,
    transferable_limit: f64,
) {
    if !tick.monastery_hospitality_enabled(ctx, source.owner) {
        return;
    }
    dispatch_to_building_where_limited(
        ctx,
        tick,
        clock,
        source,
        commodity,
        &["monastery"],
        transferable_limit,
        |target| monastery_has_parish_link(ctx, tick, target),
    );
}

fn dispatch_monastery_feast_ale(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    source: &mut Building,
) {
    let reserve_enabled = tick.monastery_hospitality_enabled(ctx, source.owner);
    if !reserve_enabled
        || labor_and_logistics_paused(ctx, tick, source.owner, clock)
        || building_has_active_trip(ctx, source.id)
        || source.ale <= 1e-6
    {
        return;
    }
    let Some(network) = tick.road_network(source.owner) else {
        return;
    };
    let Some(target) = select_supply_route_candidate(
        tick.building_ids_for_kinds(ctx, source.owner, &["monastery"])
            .into_iter()
            .filter_map(|target_id| ctx.db.building().id().find(&target_id))
            .filter_map(|building| {
                if building.id == source.id
                    || !building.construction_complete
                    || tick.building_disabled_by_fire(ctx, building.id)
                    || !monastery_has_parish_link(ctx, tick, &building)
                    || !processor_accepts_input(&building, CommodityKind::Ale)
                    || building_has_inbound_supply_trip(ctx, building.id)
                {
                    return None;
                }
                let shortfall = monastery_feast_refill_shortfall(
                    building.ale,
                    0.0,
                    MONASTERY_FEAST_ALE,
                    reserve_enabled,
                )
                .min(building_commodity_room(&building, CommodityKind::Ale));
                if shortfall <= 1e-6 {
                    return None;
                }
                local_delivery_distance(network, source.x, source.z, building.x, building.z)
                    .filter(|distance| distance.is_finite())
                    .map(|distance| RoutedMonasteryReserveTarget {
                        building,
                        distance,
                        shortfall,
                    })
            }),
        |candidate| candidate.distance,
        |candidate| candidate.building.id,
    ) else {
        return;
    };
    let needed = target.shortfall.min(source.ale);
    try_start_building_supply_trip(
        ctx,
        tick,
        clock,
        network,
        source,
        &target.building,
        1,
        CommodityKind::Ale,
        TIMBER_DELIVERY_SPEED_MPS,
        TIMBER_DELIVERY_UNLOAD_SEC,
        commodity_transfer_per_trip(CommodityKind::Ale),
        needed,
    );
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
    stock
}

fn institutional_source_food_surplus(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    source: &Building,
    stock: f64,
) -> f64 {
    let claimed_households = tick.food_claim_count_for_supplier(ctx, source.owner, source.id);
    let generic_surplus = institutional_food_surplus(
        stock,
        claimed_households,
        building_commodity_cap(&source.kind, CommodityKind::Food),
    );
    let policy_surplus = match source.kind.as_str() {
        "apiary" => (source.honey - apiary_honey_reserve(source.apiary_harvest_policy)).max(0.0),
        "vineyard" => {
            (source.grapes - vineyard_grape_reserve(source.vineyard_production_policy)).max(0.0)
        }
        _ => generic_surplus,
    };
    generic_surplus.min(policy_surplus)
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
        || target.assigned_labor == 0
        || labor_and_logistics_paused(ctx, tick, target.owner, clock)
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

fn run_monastery_feast(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    monastery: &mut Building,
) {
    let first_tick_of_minute = clock.sim_tick % (60.0 / TICK_DT).round() as u64 == 0;
    let enabled = tick.monastery_hospitality_enabled(ctx, monastery.owner);
    if !enabled
        || tick.owner_has_active_raider_threat(ctx, monastery.owner)
        || !is_monastery_feast_day(clock.month, clock.month_day)
        || clock.hour != 12
        || clock.minute != 0
        || !first_tick_of_minute
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
        monastery.ale,
        monastery.honey,
        monastery.wine,
    );
    if !batch.ready {
        return;
    }

    // The complete batch remains at this physical venue until noon, when the
    // covered parish gathers here to consume it. Household pantry stock must
    // not increase: this is a communal meal, not an invisible delivery.
    withdraw_building_edible_food(monastery, MONASTERY_FEAST_FOOD);
    withdraw_building_commodity(monastery, CommodityKind::Ale, MONASTERY_FEAST_ALE);
    withdraw_building_commodity(monastery, CommodityKind::Honey, MONASTERY_FEAST_HONEY);
    withdraw_building_commodity(monastery, CommodityKind::Wine, MONASTERY_FEAST_WINE);
    for home in &residences {
        apply_need_consumed_at_source(ctx, home.id, ResidenceNeedKind::Food);
        if home.tier >= 3 {
            apply_need_consumed_at_source(ctx, home.id, ResidenceNeedKind::Ale);
        }
    }
    if let Some(mut resources) = ctx.db.player_resources().owner().find(&monastery.owner) {
        resources.monastery_food_charity_total += MONASTERY_FEAST_FOOD;
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
