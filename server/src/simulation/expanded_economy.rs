use std::collections::HashSet;

use spacetimedb::ReducerContext;

use crate::balance_generated::{
    FarmCropProduce, APIARY_FOOD_PER_CYCLE, APIARY_HONEY_PER_CYCLE, BREWERY_ALE_PER_CYCLE,
    BREWERY_BARLEY_PER_MALT_CYCLE, BREWERY_BREWING_FIREWOOD_PER_CYCLE,
    BREWERY_BREWING_WATER_PER_CYCLE, BREWERY_MALTING_FIREWOOD_PER_CYCLE,
    BREWERY_MALTING_WATER_PER_CYCLE, BREWERY_MALT_PER_ALE_CYCLE, BREWERY_MALT_PER_CYCLE,
    CALENDAR_SECONDS_PER_DAY, CHARCOAL_BURNER_CHARCOAL_PER_CYCLE,
    CHARCOAL_BURNER_FIREWOOD_PER_CYCLE, CIVILIAN_TOOL_IRONWORK_PER_CYCLE, CLAY_PIT_CLAY_PER_CYCLE,
    FARM_GROWTH_SECONDS, FARM_WORK_METERS_PER_WORKER_PER_SEC, FERRY_GOLD_PER_DAY,
    FOOD_DELIVERY_SPEED_MPS, FOOD_DELIVERY_UNLOAD_SEC, GRAIN_TRANSFER_PER_TRIP,
    GRANARY_FIREWOOD_PER_CYCLE, GRANARY_FLOUR_PER_CYCLE, GRANARY_FOOD_PER_CYCLE,
    GRANARY_WATER_PER_CYCLE, MINE_IRON_PER_CYCLE, MINE_SALT_PER_CYCLE,
    MONASTERY_CHARITY_FOOD_PER_DELIVERY, MONASTERY_COVERAGE_RADIUS, MONASTERY_FEAST_ALE,
    MONASTERY_FEAST_FOOD, MONASTERY_FEAST_HONEY, MONASTERY_FEAST_WINE, MONASTERY_FOOD_PER_CYCLE,
    MONASTERY_GRAIN_PER_CYCLE, MONASTERY_PILGRIMAGE_GOLD_PER_DAY, MONASTERY_UNLINKED_PRODUCTIVITY,
    POTTER_CLAY_PER_CYCLE, POTTER_FIREWOOD_PER_CYCLE, POTTER_POTTERY_PER_CYCLE,
    POTTER_WATER_PER_CYCLE, RICH_MINE_THROUGHPUT_MULTIPLIER, SMITHY_CHARCOAL_PER_CYCLE,
    SMITHY_IRONWORK_PER_CYCLE, SMITHY_IRON_PER_CYCLE, SMITHY_WATER_PER_CYCLE,
    SMOKEHOUSE_FIREWOOD_PER_CYCLE, SMOKEHOUSE_FOOD_PER_CYCLE, SMOKEHOUSE_POTTERY_PER_CYCLE,
    SMOKEHOUSE_PRESERVED_FOOD_PER_CYCLE, SMOKEHOUSE_SALT_PER_CYCLE, TEXTILE_TRANSFER_PER_TRIP,
    TICK_DT, TIMBER_DELIVERY_SPEED_MPS, TIMBER_DELIVERY_UNLOAD_SEC, VINEYARD_FOOD_PER_CYCLE,
    VINEYARD_WINE_PER_CYCLE, WATERMILL_FLOUR_PER_CYCLE, WATERMILL_GRAIN_PER_CYCLE,
    WEAVER_CLOTH_PER_CYCLE, WEAVER_FLAX_PER_CYCLE, WEAVER_FLAX_WATER_PER_CYCLE,
    WEAVER_WOOL_PER_CYCLE,
};
use crate::building_defs::building_def;
use crate::burgage::{Point2, ZoneCorners};
use crate::civilian_tool_policy::{
    civilian_tool_runway_cycles, civilian_tool_throughput_multiplier, civilian_tools_maintained,
    farm_tool_ironwork_for_work, farm_tool_throughput_multiplier, farm_tools_maintained,
    is_civilian_tool_site,
};
use crate::db::*;
use crate::economy::{
    available_unreserved_building_ironwork, building_commodity_cap, building_commodity_room,
    building_commodity_stock, credit_local_civic_receipts, deposit_building_commodity,
    pending_marketplace_trade_commodity, spend_treasury_gold, treasury_gold,
    withdraw_building_commodity, CommodityKind,
};
use crate::farming::{
    advance_crop_rotation, crop_growth_allowed, crop_produce, expected_grain_yield,
    farmstead_exportable_grain, fertility_after_harvest, field_manure_fertility_bonus,
    field_manure_required, field_seed_crop, field_seed_grain_remaining, field_work_allowed,
    seed_grain_required, shape_efficiency, sowing_window_missed, work_required, CROP_BARLEY,
    CROP_FALLOW, STAGE_GROWING, STAGE_HARVESTING, STAGE_PLOUGHING, STAGE_SOWING,
};
use crate::frontier_economy_policy::{
    armed_guards, carpenter_polearm_shortfall, guard_upkeep, guardhouse_food_runway_days,
    guardhouse_food_target, guardhouse_polearm_coverage, guardhouse_polearm_target,
    next_guard_readiness, select_guardhouse_armament_candidate, select_guardhouse_food_candidate,
    CARPENTER_IRONWORK_PER_POLEARM, CARPENTER_TIMBER_PER_POLEARM,
    GUARDHOUSE_CRITICAL_FOOD_RUNWAY_DAYS,
};
use crate::granary_policy::{granary_exportable_grain, granary_fresh_food_target};
use crate::hydrology::{clay_bank_yield_multiplier_with_richness, sample_hydrology_score};
use crate::monastery_hospitality_policy::{
    is_monastery_feast_day, monastery_feast_batch, monastery_feast_refill_shortfall,
    monastery_feast_surplus, monastery_hospitality_use, monastery_pilgrimage_gold,
};
use crate::pottery_dispatch_policy::pottery_households_first;
use crate::processor_output_policy::{
    processor_input_staging_cycles, processor_output_headroom, processor_output_kind,
    ProcessorOutputKind,
};
use crate::season_policy::{EnvironmentState, WeatherKind};
use crate::simulation::delivery_cargo::has_delivery_stock_room;
use crate::simulation::delivery_trips::{
    building_has_active_trip, building_has_inbound_commodity_trip,
    building_has_inbound_supply_trip, onsite_building_labor, try_start_building_supply_trip,
    try_start_delivery_trip,
};
use crate::simulation::game_calendar::GameClock;
use crate::simulation::labor_and_logistics_paused;
use crate::simulation::landmark_access::monastery_linked_to_chapel;
use crate::simulation::residence_needs::{
    apply_need_consumed_at_source, load_needs, need_stock, ResidenceNeedKind,
};
use crate::simulation::road_logistics::select_residence_for_need_delivery;
use crate::simulation::tick_context::SimTickContext;
use crate::simulation::{try_dispatch_guardhouse_payroll, try_dispatch_local_civic_receipts};
use crate::specialty_trade_policy::{
    apiary_is_active, producer_output_batch_fits, vineyard_is_harvesting,
};
use crate::supply_policy::{
    compare_institutional_food_dispatch_candidates, compare_processor_input_dispatch_candidates,
    directly_dispatched_processor_input_per_cycle as processor_input_per_cycle_for_dispatch,
    grain_dispatch_duty, grain_input_runway_cycles, grain_input_target, granary_dispatch_order,
    institutional_food_surplus, processor_input_dispatch_duty, processor_input_runway_cycles,
    processor_input_target, select_grain_dispatch_candidate,
    select_processor_input_dispatch_candidate, select_seed_grain_delivery_candidate,
    select_supply_route_candidate, GrainDispatchDuty, GranaryDispatchDuty,
    InstitutionalFoodDispatchDuty, ProcessorInputDispatchDuty, GRAIN_CRITICAL_RUNWAY_CYCLES,
    GRAIN_DISPATCH_TARGET_KINDS, GRAIN_PROCESSOR_KINDS, INDUSTRIAL_FIREWOOD_TARGET_KINDS,
    INSTITUTIONAL_FOOD_SOURCE_KINDS, LOCAL_MATERIAL_SOURCE_KINDS,
    MARKETPLACE_MATERIAL_TARGET_KINDS,
};
use crate::tables::{farm_field, Building, FarmField, ForagingNode, Quarry, Residence};
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
    runway_cycles: f64,
}

struct RoutedGrainTarget {
    building: Building,
    distance: f64,
    duty: GrainDispatchDuty,
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
    target: Building,
    distance: f64,
    duty: InstitutionalFoodDispatchDuty,
    priority: u8,
    runway: f64,
}

/// Match every free fresh-food producer cart to one institutional destination
/// after the producers have attempted their household duties for this tick.
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
            || source.assigned_labor == 0
            || tick.building_disabled_by_fire(ctx, source.id)
            || labor_and_logistics_paused(ctx, tick, source.owner, clock)
            || building_has_active_trip(ctx, source.id)
            || institutional_source_food_surplus(ctx, tick, &source, source.food) <= 1e-6
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
                || building_commodity_room(&target, CommodityKind::Food) <= 1e-6
            {
                continue;
            }
            let Some((duty, priority, runway, _)) =
                institutional_food_target_plan(&target, conflict_enabled)
            else {
                continue;
            };
            let Some(distance) = network.road_path_distance(source.x, source.z, target.x, target.z)
            else {
                continue;
            };
            candidates.push(InstitutionalFoodDispatchCandidate {
                source_id: source.id,
                target,
                distance,
                duty,
                priority,
                runway,
            });
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
            institutional_food_target_plan(&target, conflict_enabled)
        else {
            continue;
        };
        let transferable = institutional_source_food_surplus(ctx, tick, &source, source.food);
        let needed = (desired_stock - target.food).max(0.0).min(transferable);
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
            CommodityKind::Food,
            TIMBER_DELIVERY_SPEED_MPS,
            TIMBER_DELIVERY_UNLOAD_SEC,
            commodity_transfer_per_trip(CommodityKind::Food),
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
            if desired_stock <= 1e-6 || target.food + 1e-6 >= desired_stock {
                return None;
            }
            let runway =
                guardhouse_food_runway_days(target.assigned_labor, target.polearms, target.food);
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
        "smokehouse" if processor_accepts_input(target, CommodityKind::Food) => {
            let per_cycle = SMOKEHOUSE_FOOD_PER_CYCLE;
            let desired_stock =
                processor_input_target(per_cycle, target.processor_output_target_percent);
            if desired_stock <= 1e-6 || target.food + 1e-6 >= desired_stock {
                return None;
            }
            Some((
                InstitutionalFoodDispatchDuty::PreservationBuffer,
                target.construction_priority,
                processor_input_runway_cycles(target.food, per_cycle),
                desired_stock,
            ))
        }
        "granary" if target.granary_accepts_fresh_food => {
            let desired_stock = granary_fresh_food_target(
                building_commodity_cap(&target.kind, CommodityKind::Food),
                target.granary_fresh_food_target_percent,
            );
            if desired_stock <= 1e-6 || target.food + 1e-6 >= desired_stock {
                return None;
            }
            Some((
                InstitutionalFoodDispatchDuty::GranaryIntake,
                target.construction_priority,
                target.food.max(0.0) / desired_stock,
                desired_stock,
            ))
        }
        _ => None,
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
    let (seed_reserve, barley_seed_reserve) = step_farmstead_fields(
        ctx,
        tick,
        &mut building,
        clock,
        environment,
        work_allowed,
        onsite_labor,
        fields,
    );
    tick.set_farmstead_seed_reserve(ctx, building.owner, building.id, seed_reserve);
    tick.set_farmstead_barley_seed_reserve(ctx, building.owner, building.id, barley_seed_reserve);
    if !labor_and_logistics_paused(ctx, tick, building.owner, clock) && building.assigned_labor > 0
    {
        dispatch_to_building(
            ctx,
            tick,
            clock,
            &mut building,
            CommodityKind::Flax,
            &["weaver"],
        );
        dispatch_farmstead_grain(ctx, tick, clock, &mut building, seed_reserve);
        dispatch_farmstead_barley(ctx, tick, clock, &mut building, barley_seed_reserve);
    }
    ctx.db.building().id().update(building);
}

/// Granaries and staffed marketplaces each launch at most one seed cart per
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
            matches!(source.kind.as_str(), "granary" | "marketplace")
                && source.construction_complete
                && (source.grain > 1e-6 || source.barley > 1e-6)
                && (source.kind != "marketplace" || source.assigned_labor > 0)
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
    dispatch_seed_commodity_from_source(ctx, tick, clock, source, CommodityKind::Grain)
        || dispatch_seed_commodity_from_source(ctx, tick, clock, source, CommodityKind::Barley)
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
        || (source.kind == "marketplace" && source.assigned_labor == 0)
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
                let required = if commodity == CommodityKind::Barley {
                    tick.farmstead_barley_seed_reserve_for(ctx, target.owner, target.id)
                } else {
                    tick.farmstead_seed_reserve_for(ctx, target.owner, target.id)
                };
                if building_commodity_stock(&target, commodity) + 1e-6 >= required {
                    return None;
                }
                network
                    .road_path_distance(source.x, source.z, target.x, target.z)
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
    let flour_before = building.flour;
    let mut mill = building;
    mill = step_processor_at_rate(
        ctx,
        tick,
        clock,
        mill,
        &[(CommodityKind::Grain, WATERMILL_GRAIN_PER_CYCLE)],
        &[(CommodityKind::Flour, WATERMILL_FLOUR_PER_CYCLE)],
        throughput_multiplier,
    );
    if tools_maintained && mill.flour > flour_before + 1e-6 {
        withdraw_building_commodity(
            &mut mill,
            CommodityKind::Ironwork,
            CIVILIAN_TOOL_IRONWORK_PER_CYCLE,
        );
    }
    dispatch_to_building(
        ctx,
        tick,
        clock,
        &mut mill,
        CommodityKind::Flour,
        &["granary"],
    );
    ctx.db.building().id().update(mill);
}

/// Firewood distributors first cover each claimed home's protected winter-night
/// stock. Each remaining staffed source then sends at most one physical surplus
/// cart to the highest-priority operating workshop with the lowest fuel runway.
///
/// Dispatching from the source side removes building-update-order bias: an
/// older kiln cannot repeatedly pull the communal cart ahead of an urgent
/// smokehouse, and a storehouse already serving a cold home is unavailable.
pub(crate) fn has_industrial_firewood_target(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    source: &Building,
) -> bool {
    if source.firewood <= 1e-6 || building_has_active_trip(ctx, source.id) {
        return false;
    }
    let Some(network) = tick.road_network(source.owner) else {
        return false;
    };
    tick.building_ids_for_kinds(ctx, source.owner, INDUSTRIAL_FIREWOOD_TARGET_KINDS)
        .into_iter()
        .filter_map(|target_id| ctx.db.building().id().find(&target_id))
        .any(|target| {
            target.id != source.id
                && target.construction_complete
                && !tick.building_disabled_by_fire(ctx, target.id)
                && target.assigned_labor > 0
                && processor_accepts_input(&target, CommodityKind::Firewood)
                && building_commodity_room(&target, CommodityKind::Firewood) > 1e-6
                && !building_has_inbound_supply_trip(ctx, target.id)
                && network
                    .road_path_distance(source.x, source.z, target.x, target.z)
                    .is_some_and(|distance| distance.is_finite())
        })
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
            || source.assigned_labor == 0
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

/// Every free market cart arbitrates scarce iron, salt, and uncommitted pottery
/// across every staffed workshop on its owner's road network. Work priority
/// and remaining cycle runway decide which workshops receive the available
/// carts, while route distance decides which market should serve an equal need.
/// Neither market construction order nor workshop update order can reserve a
/// need before the settlement-wide match is considered.
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
        if marketplace.kind != "marketplace"
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
        let pottery_reserved_for_trade =
            pending_marketplace_trade_commodity(&marketplace) == Some(CommodityKind::Pottery);
        candidates.extend(
            tick.building_ids_for_kinds(ctx, marketplace.owner, MARKETPLACE_MATERIAL_TARGET_KINDS)
                .into_iter()
                .filter_map(|target_id| ctx.db.building().id().find(&target_id))
                .filter_map(|building| {
                    let source_can_supply = match building.kind.as_str() {
                        "smithy" => marketplace.iron > 1e-6,
                        "smokehouse" => {
                            marketplace.salt > 1e-6
                                || (marketplace.pottery > 1e-6 && !pottery_reserved_for_trade)
                        }
                        "pastoral_farmstead" => marketplace.salt > 1e-6,
                        _ => false,
                    };
                    if !source_can_supply
                        || !building.construction_complete
                        || building.assigned_labor == 0
                        || tick.building_disabled_by_fire(ctx, building.id)
                        || building_has_inbound_supply_trip(ctx, building.id)
                    {
                        return None;
                    }
                    network
                        .road_path_distance(marketplace.x, marketplace.z, building.x, building.z)
                        .filter(|distance| distance.is_finite())
                        .map(|distance| (building, distance))
                })
                .flat_map(|(building, distance)| {
                    let commodities = match building.kind.as_str() {
                        "smithy" => [Some(CommodityKind::Iron), None],
                        "smokehouse" => [Some(CommodityKind::Salt), Some(CommodityKind::Pottery)],
                        "pastoral_farmstead" => [Some(CommodityKind::Salt), None],
                        _ => [None, None],
                    };
                    commodities
                        .into_iter()
                        .flatten()
                        .map(move |commodity| (building.clone(), commodity, distance))
                })
                .filter_map(|(building, commodity, distance)| {
                    if !processor_accepts_input(&building, commodity)
                        || building_commodity_stock(&marketplace, commodity) <= 1e-6
                        || (commodity == CommodityKind::Pottery && pottery_reserved_for_trade)
                    {
                        return None;
                    }
                    let stock = building_commodity_stock(&building, commodity);
                    let per_cycle =
                        directly_dispatched_processor_input_per_cycle(&building.kind, commodity);
                    let desired_stock =
                        processor_input_target(per_cycle, building.processor_output_target_percent);
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
                            building.processor_output_target_percent,
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
            a.building.construction_priority,
            0,
            a.runway_cycles,
            a.distance,
            a.building.id,
            b.duty,
            b.building.construction_priority,
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
        let pottery_reserved_for_trade =
            pending_marketplace_trade_commodity(&marketplace) == Some(CommodityKind::Pottery);
        if marketplace.kind != "marketplace"
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
            || !processor_accepts_input(&target, candidate.commodity)
            || (candidate.commodity == CommodityKind::Pottery && pottery_reserved_for_trade)
        {
            continue;
        }
        let per_cycle =
            directly_dispatched_processor_input_per_cycle(&target.kind, candidate.commodity);
        let desired_stock =
            processor_input_target(per_cycle, target.processor_output_target_percent);
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
        CommodityKind::Iron => 0,
        CommodityKind::Salt => 1,
        CommodityKind::Pottery => 2,
        _ => u8::MAX,
    }
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
    sources: Vec<Building>,
) {
    let mut candidates = Vec::new();
    let mut deferred_pottery_exports = Vec::new();

    for source in &sources {
        let Some((commodity, target_kinds)) = local_material_source_plan(source) else {
            continue;
        };
        if !LOCAL_MATERIAL_SOURCE_KINDS.contains(&source.kind.as_str())
            || !source.construction_complete
            || source.assigned_labor == 0
            || tick.building_disabled_by_fire(ctx, source.id)
            || labor_and_logistics_paused(ctx, tick, source.owner, clock)
            || building_has_active_trip(ctx, source.id)
            || building_commodity_stock(&source, commodity) <= 1e-6
        {
            continue;
        }
        let Some(network) = tick.road_network(source.owner) else {
            continue;
        };
        for target_id in tick.building_ids_for_kinds(ctx, source.owner, target_kinds) {
            let Some(target) = ctx.db.building().id().find(&target_id) else {
                continue;
            };
            if target.id == source.id
                || !target.construction_complete
                || tick.building_disabled_by_fire(ctx, target.id)
                || !processor_accepts_input(&target, commodity)
                || building_commodity_room(&target, commodity) <= 1e-6
                || building_has_inbound_supply_trip(ctx, target.id)
            {
                continue;
            }
            let stock = building_commodity_stock(&target, commodity);
            let per_cycle = directly_dispatched_processor_input_per_cycle(&target.kind, commodity);
            let duty = processor_input_dispatch_duty(
                target.assigned_labor,
                stock,
                per_cycle,
                target.processor_output_target_percent,
            );
            let desired_stock = if duty == ProcessorInputDispatchDuty::WorkingBuffer {
                processor_input_target(per_cycle, target.processor_output_target_percent)
            } else {
                building_commodity_cap(&target.kind, commodity)
            };
            if desired_stock <= 1e-6 || stock + 1e-6 >= desired_stock {
                continue;
            }
            let runway_cycles =
                if commodity == CommodityKind::Ironwork && is_civilian_tool_site(&target.kind) {
                    civilian_tool_runway_cycles(stock)
                } else {
                    processor_input_runway_cycles(stock, per_cycle)
                };
            let Some(distance) = network.road_path_distance(source.x, source.z, target.x, target.z)
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
                runway_cycles,
            };
            if source.kind == "potter_kiln"
                && !pottery_households_first(source.pottery_dispatch_policy)
                && candidate.building.kind == "marketplace"
            {
                // Preservation-first is smokehouse -> home -> export. Keep
                // market overflow out of the first material pass so a nearby
                // broker cannot consume the kiln cart before local cupboards.
                deferred_pottery_exports.push(candidate);
            } else {
                candidates.push(candidate);
            }
        }
    }

    sort_local_material_candidates(&mut candidates);
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

    // Preservation-first kilns that found no smokehouse work now try their
    // claimed homes. A cart that actually leaves is unavailable to export.
    for source in &sources {
        if source.kind != "potter_kiln"
            || pottery_households_first(source.pottery_dispatch_policy)
            || used_sources.contains(&source.id)
        {
            continue;
        }
        let Some(mut potter) = ctx.db.building().id().find(&source.id) else {
            continue;
        };
        if dispatch_need(
            ctx,
            tick,
            clock,
            &mut potter,
            ResidenceNeedKind::Pottery,
            2.0,
        ) {
            used_sources.insert(potter.id);
            ctx.db.building().id().update(potter);
        }
    }

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
            a.building.construction_priority,
            0,
            a.runway_cycles,
            a.distance,
            a.building.id,
            b.duty,
            b.building.construction_priority,
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
        let Some((commodity, target_kinds)) = local_material_source_plan(&source) else {
            continue;
        };
        if commodity != candidate.commodity
            || !source.construction_complete
            || source.assigned_labor == 0
            || !target.construction_complete
            || target.owner != source.owner
            || !target_kinds.contains(&target.kind.as_str())
            || tick.building_disabled_by_fire(ctx, source.id)
            || tick.building_disabled_by_fire(ctx, target.id)
            || labor_and_logistics_paused(ctx, tick, source.owner, clock)
            || building_has_active_trip(ctx, source.id)
            || building_has_inbound_supply_trip(ctx, target.id)
            || !processor_accepts_input(&target, commodity)
        {
            continue;
        }
        let stock = building_commodity_stock(&target, commodity);
        let per_cycle = directly_dispatched_processor_input_per_cycle(&target.kind, commodity);
        let duty = processor_input_dispatch_duty(
            target.assigned_labor,
            stock,
            per_cycle,
            target.processor_output_target_percent,
        );
        let desired_stock = if duty == ProcessorInputDispatchDuty::WorkingBuffer {
            processor_input_target(per_cycle, target.processor_output_target_percent)
        } else {
            building_commodity_cap(&target.kind, commodity)
        };
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

fn local_material_source_plan(
    source: &Building,
) -> Option<(CommodityKind, &'static [&'static str])> {
    match source.kind.as_str() {
        "mine" if source.iron > 1e-6 => Some((CommodityKind::Iron, &["smithy"])),
        "mine" if source.salt > 1e-6 => {
            Some((CommodityKind::Salt, &["smokehouse", "pastoral_farmstead"]))
        }
        "clay_pit" => Some((CommodityKind::Clay, &["potter_kiln"])),
        "charcoal_burner" => Some((CommodityKind::Charcoal, &["smithy"])),
        "smithy" => Some((
            CommodityKind::Ironwork,
            &[
                "lumber_mill",
                "woodcutters_lodge",
                "stone_quarry",
                "large_quarry",
                "mine",
                "clay_pit",
                "threshing_barn",
                "watermill",
                "carpenter",
            ],
        )),
        "potter_kiln" => Some((CommodityKind::Pottery, &["smokehouse", "marketplace"])),
        _ => None,
    }
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
    if tools_maintained && produced > 1e-6 {
        withdraw_building_commodity(
            &mut mine,
            CommodityKind::Ironwork,
            CIVILIAN_TOOL_IRONWORK_PER_CYCLE,
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
    granary = step_processor(
        ctx,
        tick,
        clock,
        granary,
        &[
            (CommodityKind::Flour, GRANARY_FLOUR_PER_CYCLE),
            (CommodityKind::Water, GRANARY_WATER_PER_CYCLE),
            (CommodityKind::Firewood, GRANARY_FIREWOOD_PER_CYCLE),
        ],
        &[(CommodityKind::Food, GRANARY_FOOD_PER_CYCLE)],
    );
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
    // Brewing barley has its own physical chain. Once urgent bread grain and
    // military provisions are covered, restore a staffed brewhouse's selected
    // malting buffer before the granary spends its one cart on routine food.
    dispatch_to_building(
        ctx,
        tick,
        clock,
        &mut granary,
        CommodityKind::Barley,
        &["brewery"],
    );
    for duty in granary_dispatch_order(granary.granary_households_first) {
        match duty {
            GranaryDispatchDuty::Households => {
                dispatch_need(ctx, tick, clock, &mut granary, ResidenceNeedKind::Food, 4.0);
                // Cured provisions share the household cart duty but never
                // preempt staple food. This makes founding and producer-hauled
                // granary stock usable without creating a second cart.
                dispatch_need(
                    ctx,
                    tick,
                    clock,
                    &mut granary,
                    ResidenceNeedKind::PreservedFood,
                    3.0,
                );
            }
            GranaryDispatchDuty::Preservation => {
                dispatch_to_building(
                    ctx,
                    tick,
                    clock,
                    &mut granary,
                    CommodityKind::Food,
                    &["smokehouse"],
                );
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

fn step_farmstead_fields(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    farmstead: &mut Building,
    clock: &GameClock,
    environment: EnvironmentState,
    work_allowed: bool,
    onsite_labor: u32,
    mut fields: Vec<FarmField>,
) -> (f64, f64) {
    let cattle_support: std::collections::HashMap<u64, f64> = fields
        .iter()
        .filter_map(|field| {
            tick.cattle_field_support_for(ctx, farmstead.owner, field.id)
                .map(|support| (field.id, support))
        })
        .collect();

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

    // Seasonal boundaries are authoritative. A partial sowing dies at winter,
    // immature crops fail in September, and uncollected harvest is lost in October.
    for field in &mut fields {
        if sowing_window_missed(field.stage, field.crop, clock.month) {
            fail_field_cycle(field);
        } else if clock.month == 9 && field.stage == STAGE_GROWING {
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
        } else if clock.month == 10 && field.stage == STAGE_HARVESTING {
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

    let farm_tools_ready = farm_tools_maintained(farmstead.ironwork);
    let farm_tool_throughput = farm_tool_throughput_multiplier(farmstead.ironwork);
    let mut work_budget = if work_allowed {
        onsite_labor as f64 * FARM_WORK_METERS_PER_WORKER_PER_SEC * TICK_DT * farm_tool_throughput
    } else {
        0.0
    };
    fields.sort_by(|a, b| {
        b.priority
            .cmp(&a.priority)
            .then_with(|| stage_urgency(b.stage).cmp(&stage_urgency(a.stage)))
            .then_with(|| a.id.cmp(&b.id))
    });

    for field in &mut fields {
        if work_budget <= 1e-9
            || field.stage == STAGE_GROWING
            || field.priority == 0
            || !field_work_allowed(field.stage, field.crop, clock.month)
        {
            continue;
        }
        let corners = field_corners(field);
        let shape = shape_efficiency(&corners);
        let plough_multiplier = cattle_support.get(&field.id).copied().unwrap_or(1.0);
        let required = (work_required(field.stage, field.area, shape)
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
                ) * field.harvest_yield_multiplier.clamp(0.0, 1.0),
            )
        } else {
            None
        };
        let harvest_commodity = match crop_produce(field.crop) {
            FarmCropProduce::Grain => Some(CommodityKind::Grain),
            FarmCropProduce::Barley => Some(CommodityKind::Barley),
            FarmCropProduce::Fibre => Some(CommodityKind::Flax),
            FarmCropProduce::None => None,
        };
        let mut spent = work_budget.min(remaining);
        if let (Some(expected), Some(commodity)) = (expected_harvest, harvest_commodity) {
            if expected > 1e-9 {
                let storage_limited_work =
                    required * building_commodity_room(farmstead, commodity) / expected;
                spent = spent.min(storage_limited_work);
            }
        }
        let seed_required = if field.stage == STAGE_SOWING {
            seed_grain_required(field.area, field.crop)
        } else {
            0.0
        };
        let seed_commodity = if field.crop == CROP_BARLEY {
            CommodityKind::Barley
        } else {
            CommodityKind::Grain
        };
        if seed_required > 1e-9 {
            let seed_limited_work = required
                * building_commodity_stock(farmstead, seed_commodity).max(0.0)
                / seed_required;
            spent = spent.min(seed_limited_work);
        }
        if spent <= 1e-9 {
            continue;
        }
        let previous_progress = field.stage_progress;
        field.stage_progress = (field.stage_progress + spent / required).min(1.0);
        work_budget -= spent;
        if farm_tools_ready {
            withdraw_building_commodity(
                farmstead,
                CommodityKind::Ironwork,
                farm_tool_ironwork_for_work(spent),
            );
        }
        if field.stage == STAGE_PLOUGHING {
            let manure_needed =
                field_manure_required(field.area) * (field.stage_progress - previous_progress);
            let manure_spread =
                withdraw_building_commodity(farmstead, CommodityKind::Manure, manure_needed);
            field.manure_applied += manure_spread;
        }
        if seed_required > 1e-9 {
            let seed_used =
                seed_required * (field.stage_progress - previous_progress).clamp(0.0, 1.0);
            withdraw_building_commodity(farmstead, seed_commodity, seed_used);
        }
        if let (Some(expected), Some(commodity)) = (expected_harvest, harvest_commodity) {
            let harvested = expected * (field.stage_progress - previous_progress).max(0.0);
            let deposited = deposit_building_commodity(farmstead, commodity, harvested);
            field.current_yield += deposited;
        }
        if field.stage_progress < 1.0 - 1e-9 {
            continue;
        }
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

    let seed_reserves = farmstead_seed_grain_remaining(&fields);
    for field in fields {
        ctx.db.farm_field().id().update(field);
    }
    seed_reserves
}

fn farmstead_seed_grain_remaining(fields: &[FarmField]) -> (f64, f64) {
    fields.iter().fold((0.0, 0.0), |(grain, barley), field| {
        let reserve = field_seed_grain_remaining(
            field.area,
            field.crop,
            field.next_crop,
            field.stage,
            field.stage_progress,
            field.priority,
        );
        if field_seed_crop(field.crop, field.next_crop, field.stage) == CROP_BARLEY {
            (grain, barley + reserve)
        } else {
            (grain + reserve, barley)
        }
    })
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
    dispatch_need(ctx, tick, clock, &mut brewery, ResidenceNeedKind::Ale, 3.0);
    dispatch_to_building(
        ctx,
        tick,
        clock,
        &mut brewery,
        CommodityKind::Ale,
        &["marketplace"],
    );
    ctx.db.building().id().update(brewery);
}

pub fn step_weaver(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    building: Building,
) {
    let starting_cloth = building.cloth;
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
    if starting_cloth <= 1e-6 && weaver.cloth > 1e-6 {
        // Specialty claims read authoritative building rows. Expose the first
        // completed batch before claims are built so it serves households
        // instead of slipping directly into an export cart.
        ctx.db.building().id().update(weaver.clone());
        tick.invalidate_specialty_claims(weaver.owner, ResidenceNeedKind::Cloth);
    }
    dispatch_need(ctx, tick, clock, &mut weaver, ResidenceNeedKind::Cloth, 2.0);
    dispatch_to_building(
        ctx,
        tick,
        clock,
        &mut weaver,
        CommodityKind::Cloth,
        &["marketplace"],
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
    smokehouse = step_processor(
        ctx,
        tick,
        clock,
        smokehouse,
        &[
            (CommodityKind::Food, SMOKEHOUSE_FOOD_PER_CYCLE),
            (CommodityKind::Firewood, SMOKEHOUSE_FIREWOOD_PER_CYCLE),
            (CommodityKind::Salt, SMOKEHOUSE_SALT_PER_CYCLE),
            (CommodityKind::Pottery, SMOKEHOUSE_POTTERY_PER_CYCLE),
        ],
        &[(
            CommodityKind::PreservedFood,
            SMOKEHOUSE_PRESERVED_FOOD_PER_CYCLE,
        )],
    );
    dispatch_need(
        ctx,
        tick,
        clock,
        &mut smokehouse,
        ResidenceNeedKind::PreservedFood,
        3.0,
    );
    // Once claimed household cupboards are covered, the smokehouse's same
    // physical cart may move surplus into a granary that has opted into
    // perishable collection. Keeping that policy disabled retains cured stock
    // in the better smokehouse loft; enabling it spends a haul and accepts
    // slightly faster aging in exchange for central redistribution.
    dispatch_to_building_where(
        ctx,
        tick,
        clock,
        &mut smokehouse,
        CommodityKind::PreservedFood,
        &["granary"],
        |target| target.granary_accepts_fresh_food,
    );
    ctx.db.building().id().update(smokehouse);
}

pub fn step_clay_pit(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    environment: EnvironmentState,
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
            CIVILIAN_TOOL_IRONWORK_PER_CYCLE,
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
    resource_abundance: u8,
    deposit: &ForagingNode,
) -> f64 {
    let richness = if deposit.node_id.starts_with("clay-rich-") {
        1.0
    } else {
        0.0
    };
    clay_bank_yield_multiplier_with_richness(
        sample_hydrology_score(x, z),
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
    let starting_pottery = building.pottery;
    let mut potter = step_processor(
        ctx,
        tick,
        clock,
        building,
        &[
            (CommodityKind::Clay, POTTER_CLAY_PER_CYCLE),
            (CommodityKind::Firewood, POTTER_FIREWOOD_PER_CYCLE),
            (CommodityKind::Water, POTTER_WATER_PER_CYCLE),
        ],
        &[(CommodityKind::Pottery, POTTER_POTTERY_PER_CYCLE)],
    );
    if starting_pottery <= 1e-6 && potter.pottery > 1e-6 {
        ctx.db.building().id().update(potter.clone());
        tick.invalidate_specialty_claims(potter.owner, ResidenceNeedKind::Pottery);
    }
    if pottery_households_first(potter.pottery_dispatch_policy) {
        // The additive default preserves established behavior. Kilns ordered
        // to prioritize preservation wait for the settlement-wide material
        // arbitration pass before trying household cupboards.
        dispatch_need(
            ctx,
            tick,
            clock,
            &mut potter,
            ResidenceNeedKind::Pottery,
            2.0,
        );
    }
    ctx.db.building().id().update(potter);
}

pub fn step_apiary(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    building: Building,
) {
    let mut apiary = if apiary_is_active(clock.month as u8) {
        step_simple_producer(
            ctx,
            tick,
            clock,
            building,
            &[
                (CommodityKind::Honey, APIARY_HONEY_PER_CYCLE),
                (CommodityKind::Food, APIARY_FOOD_PER_CYCLE),
            ],
        )
    } else {
        building
    };
    dispatch_need(ctx, tick, clock, &mut apiary, ResidenceNeedKind::Food, 2.0);
    dispatch_monastery_hospitality(ctx, tick, clock, &mut apiary, CommodityKind::Honey);
    dispatch_to_building(
        ctx,
        tick,
        clock,
        &mut apiary,
        CommodityKind::Honey,
        &["marketplace"],
    );
    ctx.db.building().id().update(apiary);
}

pub fn step_vineyard(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    building: Building,
) {
    let mut vineyard = if vineyard_is_harvesting(clock.month as u8) {
        step_simple_producer(
            ctx,
            tick,
            clock,
            building,
            &[
                (CommodityKind::Wine, VINEYARD_WINE_PER_CYCLE),
                (CommodityKind::Food, VINEYARD_FOOD_PER_CYCLE),
            ],
        )
    } else {
        building
    };
    dispatch_need(
        ctx,
        tick,
        clock,
        &mut vineyard,
        ResidenceNeedKind::Food,
        2.0,
    );
    dispatch_monastery_hospitality(ctx, tick, clock, &mut vineyard, CommodityKind::Wine);
    dispatch_to_building(
        ctx,
        tick,
        clock,
        &mut vineyard,
        CommodityKind::Wine,
        &["marketplace"],
    );
    ctx.db.building().id().update(vineyard);
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
            CommodityKind::Grain,
            MONASTERY_GRAIN_PER_CYCLE * productivity,
        )],
        &[(CommodityKind::Food, MONASTERY_FOOD_PER_CYCLE * productivity)],
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
        dispatch_monastery_covered_need(
            ctx,
            tick,
            clock,
            &mut monastery,
            ResidenceNeedKind::Food,
            MONASTERY_CHARITY_FOOD_PER_DELIVERY,
        );
        dispatch_monastery_covered_need(
            ctx,
            tick,
            clock,
            &mut monastery,
            ResidenceNeedKind::Ale,
            3.0,
        );
    }
    try_dispatch_local_civic_receipts(ctx, tick, clock, &mut monastery, receipt_daily_income);
    ctx.db.building().id().update(monastery);
}

pub fn step_ferry_landing(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    mut building: Building,
) {
    let onsite_labor = onsite_building_labor(ctx, &building);
    if !labor_and_logistics_paused(ctx, tick, building.owner, clock)
        && onsite_labor > 0
        && owner_has_connected_marketplace(ctx, tick, &building)
    {
        let gold = FERRY_GOLD_PER_DAY * onsite_labor as f64 * TICK_DT / CALENDAR_SECONDS_PER_DAY;
        credit_local_civic_receipts(ctx, &mut building, gold);
    }
    try_dispatch_local_civic_receipts(ctx, tick, clock, &mut building, FERRY_GOLD_PER_DAY);
    ctx.db.building().id().update(building);
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
            CARPENTER_TIMBER_PER_POLEARM * next_batch,
        );
        request_connected_commodity(
            ctx,
            tick,
            clock,
            &building,
            CommodityKind::Ironwork,
            &["marketplace"],
            CARPENTER_IRONWORK_PER_POLEARM * next_batch,
        );
    }

    let ready_labor = cycle_labor_if_ready(ctx, tick, clock, &mut building, false);
    if let Some(labor) = ready_labor.filter(|_| {
        polearm_shortfall > 1e-6
            && building.timber + 1e-6 >= CARPENTER_TIMBER_PER_POLEARM
            && building.ironwork + 1e-6 >= CARPENTER_IRONWORK_PER_POLEARM
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
        building.food,
        available_gold,
        TICK_DT,
        CALENDAR_SECONDS_PER_DAY,
    );
    withdraw_building_commodity(
        &mut building,
        CommodityKind::Food,
        upkeep.food_due * upkeep.supply_ratio,
    );
    if physical_payroll {
        withdraw_building_commodity(
            &mut building,
            CommodityKind::Gold,
            upkeep.wage_due * upkeep.supply_ratio,
        );
    } else {
        let _ = spend_treasury_gold(ctx, building.owner, upkeep.wage_due * upkeep.supply_ratio);
    }
    building.action_cooldown = next_guard_readiness(
        building.action_cooldown,
        upkeep.supply_ratio,
        TICK_DT,
        CALENDAR_SECONDS_PER_DAY,
    );
    ctx.db.building().id().update(building);
}

fn step_simple_producer(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    building: Building,
    outputs: &[(CommodityKind, f64)],
) -> Building {
    step_simple_producer_at_rate(ctx, tick, clock, building, outputs, 1.0)
}

fn step_simple_producer_at_rate(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    mut building: Building,
    outputs: &[(CommodityKind, f64)],
    throughput_multiplier: f64,
) -> Building {
    if !producer_output_batch_fits(outputs.iter().map(|(kind, batch)| {
        (
            building_commodity_stock(&building, *kind),
            building_commodity_cap(&building.kind, *kind),
            *batch,
        )
    })) {
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
    for (kind, amount) in outputs {
        deposit_building_commodity(&mut building, *kind, *amount);
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
                && processor_output_commodity(&building.kind) == Some(*kind)
            {
                processor_output_headroom(
                    building_commodity_stock(building, *kind),
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
    match processor_output_kind(kind)? {
        ProcessorOutputKind::Flour => Some(CommodityKind::Flour),
        ProcessorOutputKind::Food => Some(CommodityKind::Food),
        ProcessorOutputKind::Ale => Some(CommodityKind::Ale),
        ProcessorOutputKind::PreservedFood => Some(CommodityKind::PreservedFood),
        ProcessorOutputKind::Cloth => Some(CommodityKind::Cloth),
        ProcessorOutputKind::Charcoal => Some(CommodityKind::Charcoal),
        ProcessorOutputKind::Ironwork => Some(CommodityKind::Ironwork),
        ProcessorOutputKind::Pottery => Some(CommodityKind::Pottery),
    }
}

fn processor_uses_input(kind: &str, commodity: CommodityKind) -> bool {
    match kind {
        "watermill" => commodity == CommodityKind::Grain,
        "granary" => matches!(
            commodity,
            CommodityKind::Flour | CommodityKind::Water | CommodityKind::Firewood
        ),
        "brewery" => matches!(
            commodity,
            CommodityKind::Barley | CommodityKind::Water | CommodityKind::Firewood
        ),
        "smokehouse" => {
            matches!(
                commodity,
                CommodityKind::Food
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
    if building.kind == "granary" && commodity == CommodityKind::PreservedFood {
        return building.granary_accepts_fresh_food;
    }
    if building.kind == "pastoral_farmstead" && commodity == CommodityKind::Salt {
        return building_commodity_room(building, CommodityKind::PreservedFood) > 1e-6;
    }
    if !processor_uses_input(&building.kind, commodity) {
        return true;
    }
    let Some(output) = processor_output_commodity(&building.kind) else {
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
        onsite_labor as f64
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
    building.action_cooldown = interval / labor.max(1.0);
}

fn dispatch_farmstead_grain(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    source: &mut Building,
    seed_reserve: f64,
) {
    if source.assigned_labor == 0
        || labor_and_logistics_paused(ctx, tick, source.owner, clock)
        || building_has_active_trip(ctx, source.id)
        || source.grain <= 1e-6
    {
        return;
    }
    let transferable_grain = farmstead_exportable_grain(source.grain, seed_reserve);
    if transferable_grain <= 1e-6 {
        return;
    }
    let Some(network) = tick.road_network(source.owner) else {
        return;
    };
    let Some(routed_target) = select_grain_dispatch_candidate(
        tick.building_ids_for_kinds(ctx, source.owner, GRAIN_DISPATCH_TARGET_KINDS)
            .into_iter()
            .filter_map(|target_id| ctx.db.building().id().find(&target_id))
            .filter_map(|target| {
                if target.id == source.id
                    || !target.construction_complete
                    || tick.building_disabled_by_fire(ctx, target.id)
                    || !GRAIN_DISPATCH_TARGET_KINDS.contains(&target.kind.as_str())
                    || !processor_accepts_input(&target, CommodityKind::Grain)
                    || building_commodity_room(&target, CommodityKind::Grain) <= 1e-6
                    || building_has_inbound_supply_trip(ctx, target.id)
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
                let duty = grain_dispatch_duty(
                    &target.kind,
                    target.assigned_labor,
                    target.grain,
                    desired_stock,
                )?;
                network
                    .road_path_distance(source.x, source.z, target.x, target.z)
                    .map(|distance| RoutedGrainTarget {
                        runway_cycles: grain_input_runway_cycles(
                            &target.kind,
                            target.grain,
                            productivity,
                        ),
                        building: target,
                        distance,
                        duty,
                        desired_stock,
                    })
            }),
        |candidate| candidate.duty,
        |candidate| candidate.building.construction_priority,
        |candidate| candidate.runway_cycles,
        |candidate| candidate.distance,
        |candidate| candidate.building.id,
    ) else {
        return;
    };
    let target = &routed_target.building;
    let needed = match routed_target.duty {
        GrainDispatchDuty::WorkingBuffer => (routed_target.desired_stock - target.grain).max(0.0),
        GrainDispatchDuty::GranaryReserve | GrainDispatchDuty::WorkshopOverflow => {
            building_commodity_room(target, CommodityKind::Grain)
        }
    }
    .min(transferable_grain);
    try_start_building_supply_trip(
        ctx,
        tick,
        clock,
        network,
        source,
        target,
        1,
        CommodityKind::Grain,
        TIMBER_DELIVERY_SPEED_MPS,
        TIMBER_DELIVERY_UNLOAD_SEC,
        GRAIN_TRANSFER_PER_TRIP,
        needed,
    );
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

/// Central grain leaves from a staffed granary rather than being claimed by
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
    if source.kind != "granary"
        || source.assigned_labor == 0
        || labor_and_logistics_paused(ctx, tick, source.owner, clock)
        || building_has_active_trip(ctx, source.id)
        || granary_exportable_grain(source.grain, source.granary_grain_reserve) <= 1e-6
    {
        return None;
    }
    let network = tick.road_network(source.owner)?;
    select_grain_dispatch_candidate(
        tick.building_ids_for_kinds(ctx, source.owner, GRAIN_PROCESSOR_KINDS)
            .into_iter()
            .filter_map(|target_id| ctx.db.building().id().find(&target_id))
            .filter_map(|target| {
                if target.id == source.id
                    || !target.construction_complete
                    || tick.building_disabled_by_fire(ctx, target.id)
                    || !GRAIN_PROCESSOR_KINDS.contains(&target.kind.as_str())
                    || (target.kind != "monastery" && target.assigned_labor == 0)
                    || !processor_accepts_input(&target, CommodityKind::Grain)
                    || building_has_inbound_supply_trip(ctx, target.id)
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
                if desired_stock <= 1e-6 || target.grain + 1e-6 >= desired_stock {
                    return None;
                }
                network
                    .road_path_distance(source.x, source.z, target.x, target.z)
                    .map(|distance| RoutedGrainTarget {
                        runway_cycles: grain_input_runway_cycles(
                            &target.kind,
                            target.grain,
                            productivity,
                        ),
                        building: target,
                        distance,
                        duty: GrainDispatchDuty::WorkingBuffer,
                        desired_stock,
                    })
            }),
        |candidate| candidate.duty,
        |candidate| candidate.building.construction_priority,
        |candidate| candidate.runway_cycles,
        |candidate| candidate.distance,
        |candidate| candidate.building.id,
    )
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
    let transferable = granary_exportable_grain(source.grain, source.granary_grain_reserve);
    let needed = (dispatch.desired_stock - dispatch.building.grain)
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
        CommodityKind::Grain,
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
        || source.assigned_labor == 0
        || labor_and_logistics_paused(ctx, tick, source.owner, clock)
        || building_has_active_trip(ctx, source.id)
    {
        return None;
    }
    let transferable = institutional_source_food_surplus(ctx, tick, source, source.food);
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
                if desired_stock <= 1e-6 || target.food + 1e-6 >= desired_stock {
                    return None;
                }
                let runway_days = guardhouse_food_runway_days(
                    target.assigned_labor,
                    target.polearms,
                    target.food,
                );
                if runway_days + 1e-9 >= GUARDHOUSE_CRITICAL_FOOD_RUNWAY_DAYS {
                    return None;
                }
                network
                    .road_path_distance(source.x, source.z, target.x, target.z)
                    .map(|distance| RoutedGuardFoodTarget {
                        building: target,
                        distance,
                        runway_days,
                        desired_stock,
                    })
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
    let transferable = institutional_source_food_surplus(ctx, tick, source, source.food);
    let needed = (dispatch.desired_stock - dispatch.building.food)
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
        CommodityKind::Food,
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
    if source.assigned_labor == 0
        || labor_and_logistics_paused(ctx, tick, source.owner, clock)
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
                network
                    .road_path_distance(source.x, source.z, target.x, target.z)
                    .map(|distance| {
                        (
                            RoutedBuilding {
                                building: target,
                                distance,
                            },
                            desired_stock,
                        )
                    })
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
    if source.assigned_labor == 0
        || labor_and_logistics_paused(ctx, tick, source.owner, clock)
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
                    || !processor_accepts_input(&target, commodity)
                    || building_commodity_room(&target, commodity) <= 1e-6
                    || building_has_inbound_supply_trip(ctx, target.id)
                {
                    return None;
                }
                let stock = building_commodity_stock(&target, commodity);
                let per_cycle =
                    directly_dispatched_processor_input_per_cycle(&target.kind, commodity);
                let duty = processor_input_dispatch_duty(
                    target.assigned_labor,
                    stock,
                    per_cycle,
                    target.processor_output_target_percent,
                );
                let desired_stock = if duty == ProcessorInputDispatchDuty::WorkingBuffer {
                    processor_input_target(per_cycle, target.processor_output_target_percent)
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
                network
                    .road_path_distance(source.x, source.z, target.x, target.z)
                    .map(|distance| RoutedProcessorInputTarget {
                        building: target,
                        distance,
                        duty,
                        input_preference_rank,
                        runway_cycles,
                        desired_stock,
                    })
            }),
        |candidate| candidate.duty,
        |candidate| candidate.building.construction_priority,
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
    try_start_building_supply_trip(
        ctx,
        tick,
        clock,
        network,
        source,
        target,
        1,
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
    let commodity = match commodity {
        CommodityKind::Barley => "barley",
        CommodityKind::Flour => "flour",
        CommodityKind::Food => "food",
        CommodityKind::Wool => "wool",
        CommodityKind::Flax => "flax",
        CommodityKind::Ironwork => "ironwork",
        CommodityKind::Clay => "clay",
        CommodityKind::Charcoal => "charcoal",
        CommodityKind::Pottery => "pottery",
        CommodityKind::Firewood => "firewood",
        CommodityKind::Iron => "iron",
        CommodityKind::Salt => "salt",
        _ => return 0.0,
    };
    processor_input_per_cycle_for_dispatch(target_kind, commodity)
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

fn dispatch_monastery_feast_ale(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    source: &mut Building,
) {
    let reserve_enabled = tick.monastery_hospitality_enabled(ctx, source.owner);
    if !reserve_enabled
        || source.assigned_labor == 0
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
                network
                    .road_path_distance(source.x, source.z, building.x, building.z)
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

fn dispatch_monastery_covered_need(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    supplier: &mut Building,
    need_kind: ResidenceNeedKind,
    per_delivery: f64,
) {
    let commodity = need_to_commodity(need_kind);
    let reserve_enabled = tick.monastery_hospitality_enabled(ctx, supplier.owner);
    let reserve = match commodity {
        CommodityKind::Food => MONASTERY_FEAST_FOOD,
        CommodityKind::Ale => MONASTERY_FEAST_ALE,
        _ => 0.0,
    };
    let available = monastery_feast_surplus(
        building_commodity_stock(supplier, commodity),
        reserve,
        reserve_enabled,
    );
    if building_has_active_trip(ctx, supplier.id) || available <= 1e-6 {
        return;
    }
    let Some(network) = tick.road_network(supplier.owner) else {
        return;
    };
    let targets = collect_need_delivery_targets(
        ctx,
        tick,
        network,
        supplier,
        need_kind,
        Some(MONASTERY_COVERAGE_RADIUS),
    );
    try_start_delivery_trip(
        ctx,
        tick,
        clock,
        network,
        supplier,
        1,
        &targets,
        need_kind,
        FOOD_DELIVERY_SPEED_MPS,
        FOOD_DELIVERY_UNLOAD_SEC,
        per_delivery.min(available),
    );
}

pub(crate) fn dispatch_need(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    supplier: &mut Building,
    need_kind: ResidenceNeedKind,
    per_delivery: f64,
) -> bool {
    if supplier.assigned_labor == 0
        || labor_and_logistics_paused(ctx, tick, supplier.owner, clock)
        || building_has_active_trip(ctx, supplier.id)
        || building_commodity_stock(supplier, need_to_commodity(need_kind)) <= 1e-6
    {
        return false;
    }
    let Some(network) = tick.road_network(supplier.owner) else {
        return false;
    };
    let targets = collect_need_delivery_targets(ctx, tick, network, supplier, need_kind, None);
    try_start_delivery_trip(
        ctx,
        tick,
        clock,
        network,
        supplier,
        1,
        &targets,
        need_kind,
        FOOD_DELIVERY_SPEED_MPS,
        FOOD_DELIVERY_UNLOAD_SEC,
        per_delivery,
    )
}

fn collect_need_delivery_targets(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    network: &crate::roads::RoadNetwork,
    supplier: &Building,
    need_kind: ResidenceNeedKind,
    max_distance: Option<f64>,
) -> Vec<Residence> {
    let residences: Vec<Residence> = ctx
        .db
        .residence()
        .owner()
        .filter(&supplier.owner)
        .filter(|residence| {
            if residence.abandoned
                || residence.population == 0
                || !need_kind.is_active_for_tier(residence.tier)
            {
                return false;
            }
            let claimed_supplier = match need_kind {
                ResidenceNeedKind::Food => {
                    tick.food_supplier_for(ctx, supplier.owner, residence.id)
                }
                ResidenceNeedKind::Ale
                | ResidenceNeedKind::PreservedFood
                | ResidenceNeedKind::Cloth
                | ResidenceNeedKind::Pottery => {
                    tick.specialty_supplier_for(ctx, supplier.owner, residence.id, need_kind)
                }
                ResidenceNeedKind::Firewood | ResidenceNeedKind::Water => None,
            };
            if matches!(
                need_kind,
                ResidenceNeedKind::Food
                    | ResidenceNeedKind::Ale
                    | ResidenceNeedKind::PreservedFood
                    | ResidenceNeedKind::Cloth
                    | ResidenceNeedKind::Pottery
            ) && claimed_supplier != Some(supplier.id)
            {
                return false;
            }
            true
        })
        .collect();
    select_residence_for_need_delivery(
        network,
        supplier,
        residences,
        None,
        max_distance,
        |residence| need_stock(&load_needs(ctx, residence.id), need_kind),
        |_, stock| has_delivery_stock_room(need_kind, stock),
    )
    .into_iter()
    .collect()
}

fn need_to_commodity(kind: ResidenceNeedKind) -> CommodityKind {
    match kind {
        ResidenceNeedKind::Firewood => CommodityKind::Firewood,
        ResidenceNeedKind::Water => CommodityKind::Water,
        ResidenceNeedKind::Food => CommodityKind::Food,
        ResidenceNeedKind::Ale => CommodityKind::Ale,
        ResidenceNeedKind::PreservedFood => CommodityKind::PreservedFood,
        ResidenceNeedKind::Cloth => CommodityKind::Cloth,
        ResidenceNeedKind::Pottery => CommodityKind::Pottery,
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
    if commodity == CommodityKind::Grain && source.kind == "threshing_barn" {
        return farmstead_exportable_grain(
            stock,
            tick.farmstead_seed_reserve_for(ctx, source.owner, source.id),
        );
    }
    if commodity == CommodityKind::Grain && source.kind == "granary" {
        return granary_exportable_grain(stock, source.granary_grain_reserve);
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
    institutional_food_surplus(
        stock,
        claimed_households,
        building_commodity_cap(&source.kind, CommodityKind::Food),
    )
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
                    || (source.kind == "marketplace" && source.assigned_labor == 0)
                    || (source.kind == "well" && source.assigned_labor == 0)
                    || building_has_active_trip(ctx, source.id)
                {
                    return None;
                }
                let stock = building_commodity_stock(&source, commodity);
                let transferable = source_availability(&source, stock).clamp(0.0, stock.max(0.0));
                if transferable <= 1e-6 {
                    return None;
                }
                network
                    .road_path_distance(source.x, source.z, target.x, target.z)
                    .map(|distance| {
                        (
                            RoutedBuilding {
                                building: source,
                                distance,
                            },
                            transferable,
                        )
                    })
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
        monastery.food,
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
    withdraw_building_commodity(monastery, CommodityKind::Food, MONASTERY_FEAST_FOOD);
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
