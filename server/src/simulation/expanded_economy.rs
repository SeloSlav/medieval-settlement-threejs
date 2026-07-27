use spacetimedb::ReducerContext;

use crate::balance_generated::{
    APIARY_FOOD_PER_CYCLE, APIARY_HONEY_PER_CYCLE, BREWERY_ALE_PER_CYCLE, BREWERY_GRAIN_PER_CYCLE,
    BREWERY_WATER_PER_CYCLE, CALENDAR_SECONDS_PER_DAY, FARM_GROWTH_SECONDS,
    FARM_WORK_METERS_PER_WORKER_PER_SEC, FERRY_GOLD_PER_DAY, FOOD_DELIVERY_SPEED_MPS,
    FOOD_DELIVERY_UNLOAD_SEC, GRAIN_TRANSFER_PER_TRIP, GRANARY_FIREWOOD_PER_CYCLE,
    GRANARY_FLOUR_PER_CYCLE, GRANARY_FOOD_PER_CYCLE, GRANARY_WATER_PER_CYCLE,
    MONASTERY_CHARITY_FOOD_PER_DELIVERY, MONASTERY_COVERAGE_RADIUS, MONASTERY_FEAST_HONEY,
    MONASTERY_FEAST_WINE, MONASTERY_FOOD_PER_CYCLE, MONASTERY_GRAIN_PER_CYCLE,
    MONASTERY_UNLINKED_PRODUCTIVITY, SMOKEHOUSE_FIREWOOD_PER_CYCLE, SMOKEHOUSE_FOOD_PER_CYCLE,
    SMOKEHOUSE_PRESERVED_FOOD_PER_CYCLE, TEXTILE_TRANSFER_PER_TRIP, TICK_DT,
    TIMBER_DELIVERY_SPEED_MPS, TIMBER_DELIVERY_UNLOAD_SEC, VINEYARD_FOOD_PER_CYCLE,
    VINEYARD_WINE_PER_CYCLE, WATERMILL_FLOUR_PER_CYCLE, WATERMILL_GRAIN_PER_CYCLE,
    WEAVER_CLOTH_PER_CYCLE, WEAVER_WOOL_PER_CYCLE,
};
use crate::building_defs::building_def;
use crate::burgage::{Point2, ZoneCorners};
use crate::db::*;
use crate::economy::{
    building_commodity_cap, building_commodity_room, building_commodity_stock,
    credit_treasury_gold, deposit_building_commodity, spend_treasury_gold, treasury_gold,
    withdraw_building_commodity, CommodityKind,
};
use crate::farming::{
    crop_growth_allowed, expected_grain_yield, farmstead_exportable_grain, fertility_after_harvest,
    field_seed_grain_remaining, field_work_allowed, seed_grain_required, shape_efficiency,
    sowing_window_missed, work_required, CROP_FALLOW, STAGE_GROWING, STAGE_HARVESTING,
    STAGE_PLOUGHING, STAGE_SOWING,
};
use crate::frontier_economy_policy::{
    armed_guards, carpenter_polearm_shortfall, guard_upkeep, guardhouse_food_runway_days,
    guardhouse_food_target, guardhouse_polearm_coverage, guardhouse_polearm_target,
    next_guard_readiness, select_guardhouse_armament_candidate, select_guardhouse_food_candidate,
    CARPENTER_IRONWORK_PER_POLEARM, CARPENTER_TIMBER_PER_POLEARM,
    GUARDHOUSE_CRITICAL_FOOD_RUNWAY_DAYS,
};
use crate::granary_policy::{granary_exportable_grain, granary_fresh_food_target};
use crate::monastery_hospitality_policy::{monastery_hospitality_use, monastery_pilgrimage_gold};
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
    apply_need_delivery, load_needs, need_stock, ResidenceNeedKind,
};
use crate::simulation::road_logistics::select_residence_for_need_delivery;
use crate::simulation::tick_context::SimTickContext;
use crate::specialty_trade_policy::{apiary_is_active, vineyard_is_harvesting};
use crate::supply_policy::{
    grain_dispatch_duty, grain_input_runway_cycles, grain_input_target, granary_dispatch_order,
    institutional_food_surplus, processor_input_dispatch_duty, processor_input_runway_cycles,
    processor_input_target, select_grain_dispatch_candidate,
    select_processor_input_dispatch_candidate, select_seed_grain_delivery_candidate,
    select_supply_route_candidate, GrainDispatchDuty, GranaryDispatchDuty,
    ProcessorInputDispatchDuty, GRAIN_CRITICAL_RUNWAY_CYCLES, GRAIN_DISPATCH_TARGET_KINDS,
    GRAIN_PROCESSOR_KINDS,
};
use crate::tables::{farm_field, Building, FarmField, Residence};

struct RoutedBuilding {
    building: Building,
    distance: f64,
}

struct RoutedProcessorInputTarget {
    building: Building,
    distance: f64,
    duty: ProcessorInputDispatchDuty,
    runway_cycles: f64,
    desired_stock: f64,
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
    let seed_reserve = step_farmstead_fields(
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
    if !labor_and_logistics_paused(ctx, tick, building.owner, clock) && building.assigned_labor > 0
    {
        dispatch_farmstead_grain(ctx, tick, clock, &mut building, seed_reserve);
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
                && source.grain > 1e-6
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
    if source.grain <= 1e-6
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
                    || building_has_inbound_commodity_trip(ctx, target.id, CommodityKind::Grain)
                    || building_commodity_room(&target, CommodityKind::Grain) <= 1e-6
                {
                    return None;
                }
                let required = tick.farmstead_seed_reserve_for(ctx, target.owner, target.id);
                if target.grain + 1e-6 >= required {
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
        |candidate| candidate.building.grain,
        |candidate| candidate.required,
        |candidate| candidate.distance,
        |candidate| candidate.building.id,
    ) else {
        return false;
    };
    let request = (target.required - target.building.grain)
        .max(0.0)
        .min(source.grain.max(0.0));
    try_start_building_supply_trip(
        ctx,
        tick,
        clock,
        network,
        source,
        &target.building,
        1,
        CommodityKind::Grain,
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
    building: Building,
) {
    let mut mill = building;
    mill = step_processor(
        ctx,
        tick,
        clock,
        mill,
        &[(CommodityKind::Grain, WATERMILL_GRAIN_PER_CYCLE)],
        &[(CommodityKind::Flour, WATERMILL_FLOUR_PER_CYCLE)],
    );
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

pub fn step_granary(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    building: Building,
) {
    let mut granary = building;
    let input_staging_cycles =
        processor_input_staging_cycles(granary.processor_output_target_percent);
    request_connected_commodity(
        ctx,
        tick,
        clock,
        &granary,
        CommodityKind::Firewood,
        &["woodcutters_lodge", "village_storehouse"],
        GRANARY_FIREWOOD_PER_CYCLE * input_staging_cycles,
    );
    // Once its bakery inputs are covered, the granary also centralizes fresh
    // food. Routine household suppliers retain a territory-sized delivery
    // buffer before any institutional collection cart may load.
    if granary.granary_accepts_fresh_food {
        let food_buffer = granary_fresh_food_target(
            building_commodity_cap(&granary.kind, CommodityKind::Food),
            granary.granary_fresh_food_target_percent,
        );
        request_connected_food_surplus(
            ctx,
            tick,
            clock,
            &granary,
            &["hunters_hall", "foragers_shed", "fishing_camp", "swineherd"],
            food_buffer,
        );
    }
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
    for duty in granary_dispatch_order(granary.granary_households_first) {
        match duty {
            GranaryDispatchDuty::Households => {
                dispatch_need(ctx, tick, clock, &mut granary, ResidenceNeedKind::Food, 4.0);
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
) -> f64 {
    let cattle_support: std::collections::HashMap<u64, (f64, f64)> = fields
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
            } else {
                fail_field_cycle(field);
            }
        } else if clock.month == 10 && field.stage == STAGE_HARVESTING {
            let manure_bonus = cattle_support
                .get(&field.id)
                .map(|(_, bonus)| *bonus)
                .unwrap_or(0.0);
            finish_field_cycle_with_manure(field, field.current_yield, manure_bonus);
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

    let mut work_budget = if work_allowed {
        onsite_labor as f64 * FARM_WORK_METERS_PER_WORKER_PER_SEC * TICK_DT
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
        let (plough_multiplier, manure_bonus) =
            cattle_support.get(&field.id).copied().unwrap_or((1.0, 0.0));
        let required = (work_required(field.stage, field.area, shape)
            * if field.stage == STAGE_PLOUGHING {
                plough_multiplier
            } else {
                1.0
            })
        .max(1e-6);
        let remaining = required * (1.0_f64 - field.stage_progress).max(0.0_f64);
        let expected_harvest = if field.stage == STAGE_HARVESTING {
            Some(expected_grain_yield(
                field.area,
                field.crop,
                field.moisture,
                field.fertility,
                field.average_slope_degrees,
                shape,
            ))
        } else {
            None
        };
        let mut spent = work_budget.min(remaining);
        if let Some(expected) = expected_harvest {
            if expected > 1e-9 {
                let storage_limited_work =
                    required * building_commodity_room(farmstead, CommodityKind::Grain) / expected;
                spent = spent.min(storage_limited_work);
            }
        }
        let seed_required = if field.stage == STAGE_SOWING {
            seed_grain_required(field.area, field.crop)
        } else {
            0.0
        };
        if seed_required > 1e-9 {
            let seed_limited_work = required * farmstead.grain.max(0.0) / seed_required;
            spent = spent.min(seed_limited_work);
        }
        if spent <= 1e-9 {
            continue;
        }
        let previous_progress = field.stage_progress;
        field.stage_progress = (field.stage_progress + spent / required).min(1.0);
        work_budget -= spent;
        if seed_required > 1e-9 {
            let seed_used =
                seed_required * (field.stage_progress - previous_progress).clamp(0.0, 1.0);
            withdraw_building_commodity(farmstead, CommodityKind::Grain, seed_used);
        }
        if let Some(expected) = expected_harvest {
            let harvested = expected * (field.stage_progress - previous_progress).max(0.0);
            let deposited = deposit_building_commodity(farmstead, CommodityKind::Grain, harvested);
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
                finish_field_cycle_with_manure(
                    field,
                    expected_harvest.unwrap_or_default(),
                    manure_bonus,
                );
            }
            _ => {}
        }
    }

    let seed_reserve = farmstead_seed_grain_remaining(&fields);
    for field in fields {
        ctx.db.farm_field().id().update(field);
    }
    seed_reserve
}

fn farmstead_seed_grain_remaining(fields: &[FarmField]) -> f64 {
    fields
        .iter()
        .map(|field| {
            field_seed_grain_remaining(
                field.area,
                field.crop,
                field.next_crop,
                field.stage,
                field.stage_progress,
                field.priority,
            )
        })
        .sum()
}

fn finish_field_cycle(field: &mut FarmField, harvested: f64) {
    finish_field_cycle_with_manure(field, harvested, 0.0);
}

fn finish_field_cycle_with_manure(field: &mut FarmField, harvested: f64, manure_bonus: f64) {
    field.last_yield = harvested;
    field.current_yield = 0.0;
    field.harvest_count = field.harvest_count.saturating_add(1);
    field.fertility =
        (fertility_after_harvest(field.crop, field.fertility) + manure_bonus).clamp(0.0, 1.0);
    field.crop = field.next_crop;
    field.stage = STAGE_PLOUGHING;
    field.stage_progress = 0.0;
}

fn fail_field_cycle(field: &mut FarmField) {
    field.last_yield = 0.0;
    field.current_yield = 0.0;
    field.crop = field.next_crop;
    field.stage = STAGE_PLOUGHING;
    field.stage_progress = 0.0;
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
    brewery = step_processor(
        ctx,
        tick,
        clock,
        brewery,
        &[
            (CommodityKind::Grain, BREWERY_GRAIN_PER_CYCLE),
            (CommodityKind::Water, BREWERY_WATER_PER_CYCLE),
        ],
        &[(CommodityKind::Ale, BREWERY_ALE_PER_CYCLE)],
    );
    dispatch_to_building(
        ctx,
        tick,
        clock,
        &mut brewery,
        CommodityKind::Ale,
        &["monastery"],
    );
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
    let mut weaver = step_processor(
        ctx,
        tick,
        clock,
        building,
        &[(CommodityKind::Wool, WEAVER_WOOL_PER_CYCLE)],
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
    let input_staging_cycles =
        processor_input_staging_cycles(smokehouse.processor_output_target_percent);
    request_connected_food_surplus(
        ctx,
        tick,
        clock,
        &smokehouse,
        &["hunters_hall", "foragers_shed", "fishing_camp", "swineherd"],
        SMOKEHOUSE_FOOD_PER_CYCLE * input_staging_cycles,
    );
    request_connected_commodity(
        ctx,
        tick,
        clock,
        &smokehouse,
        CommodityKind::Firewood,
        &["woodcutters_lodge", "village_storehouse"],
        SMOKEHOUSE_FIREWOOD_PER_CYCLE * input_staging_cycles,
    );
    smokehouse = step_processor(
        ctx,
        tick,
        clock,
        smokehouse,
        &[
            (CommodityKind::Food, SMOKEHOUSE_FOOD_PER_CYCLE),
            (CommodityKind::Firewood, SMOKEHOUSE_FIREWOOD_PER_CYCLE),
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
    ctx.db.building().id().update(smokehouse);
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
        let gold = monastery_pilgrimage_gold(
            hospitality_enabled,
            hospitality.supply_ratio,
            TICK_DT,
            CALENDAR_SECONDS_PER_DAY,
        );
        credit_treasury_gold(ctx, monastery.owner, gold);
        if let Some(mut treasury) = ctx.db.player_resources().owner().find(&monastery.owner) {
            treasury.monastery_pilgrimage_gold_total += gold;
            ctx.db.player_resources().owner().update(treasury);
        }
    }
    if linked {
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
    run_monastery_feast(ctx, tick, clock, &mut monastery);
    ctx.db.building().id().update(monastery);
}

pub fn step_ferry_landing(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    building: Building,
) {
    if !labor_and_logistics_paused(ctx, tick, building.owner, clock)
        && building.assigned_labor > 0
        && owner_has_connected_marketplace(ctx, tick, &building)
    {
        let gold = FERRY_GOLD_PER_DAY * building.assigned_labor as f64 * TICK_DT
            / CALENDAR_SECONDS_PER_DAY;
        credit_treasury_gold(ctx, building.owner, gold);
    }
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

    let food_buffer = guardhouse_food_target(
        building.assigned_labor,
        building.polearms,
        building.guardhouse_food_reserve,
    );
    if food_buffer > 1e-6 {
        request_connected_food_surplus(
            ctx,
            tick,
            clock,
            &building,
            &[
                "hunters_hall",
                "foragers_shed",
                "fishing_camp",
                "pastoral_farmstead",
                "swineherd",
            ],
            food_buffer,
        );
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

    let available_gold = treasury_gold(ctx, building.owner);
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
    let _ = spend_treasury_gold(ctx, building.owner, upkeep.wage_due * upkeep.supply_ratio);
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
    mut building: Building,
    outputs: &[(CommodityKind, f64)],
) -> Building {
    let Some(labor) = cycle_labor_if_ready(ctx, tick, clock, &mut building, false) else {
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
    mut building: Building,
    inputs: &[(CommodityKind, f64)],
    outputs: &[(CommodityKind, f64)],
) -> Building {
    let Some(labor) = cycle_labor_if_ready(ctx, tick, clock, &mut building, false) else {
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
    }
}

fn processor_uses_input(kind: &str, commodity: CommodityKind) -> bool {
    match kind {
        "watermill" => commodity == CommodityKind::Grain,
        "granary" => matches!(
            commodity,
            CommodityKind::Flour | CommodityKind::Water | CommodityKind::Firewood
        ),
        "brewery" => matches!(commodity, CommodityKind::Grain | CommodityKind::Water),
        "smokehouse" => {
            matches!(commodity, CommodityKind::Food | CommodityKind::Firewood)
        }
        "weaver" => commodity == CommodityKind::Wool,
        _ => false,
    }
}

pub(crate) fn processor_accepts_input(building: &Building, commodity: CommodityKind) -> bool {
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
        CommodityKind::Wool | CommodityKind::Cloth => TEXTILE_TRANSFER_PER_TRIP,
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
    if labor_and_logistics_paused(ctx, tick, building.owner, clock) {
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
    building.action_cooldown = (building.action_cooldown - TICK_DT).max(0.0);
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
    };
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
                network
                    .road_path_distance(source.x, source.z, target.x, target.z)
                    .map(|distance| RoutedProcessorInputTarget {
                        building: target,
                        distance,
                        duty,
                        runway_cycles: processor_input_runway_cycles(stock, per_cycle),
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
    match (target_kind, commodity) {
        ("granary", CommodityKind::Flour) => GRANARY_FLOUR_PER_CYCLE,
        ("smokehouse", CommodityKind::Food) => SMOKEHOUSE_FOOD_PER_CYCLE,
        ("weaver", CommodityKind::Wool) => WEAVER_WOOL_PER_CYCLE,
        _ => 0.0,
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

fn dispatch_monastery_covered_need(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    supplier: &mut Building,
    need_kind: ResidenceNeedKind,
    per_delivery: f64,
) {
    if building_has_active_trip(ctx, supplier.id)
        || building_commodity_stock(supplier, need_to_commodity(need_kind)) <= 1e-6
    {
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
        per_delivery,
    );
}

pub(crate) fn dispatch_need(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    supplier: &mut Building,
    need_kind: ResidenceNeedKind,
    per_delivery: f64,
) {
    if supplier.assigned_labor == 0
        || labor_and_logistics_paused(ctx, tick, supplier.owner, clock)
        || building_has_active_trip(ctx, supplier.id)
        || building_commodity_stock(supplier, need_to_commodity(need_kind)) <= 1e-6
    {
        return;
    }
    let Some(network) = tick.road_network(supplier.owner) else {
        return;
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
    );
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
                | ResidenceNeedKind::Cloth => {
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
        |stock| has_delivery_stock_room(need_kind, stock),
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

fn request_connected_food_surplus(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    target: &Building,
    source_kinds: &[&str],
    desired: f64,
) {
    request_connected_commodity_with_source_availability(
        ctx,
        tick,
        clock,
        target,
        CommodityKind::Food,
        source_kinds,
        desired,
        |source, stock| institutional_source_food_surplus(ctx, tick, source, stock),
    );
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
    let feast_day = matches!(
        (clock.month, clock.month_day),
        (1, 6) | (6, 29) | (8, 15) | (9, 14) | (12, 25)
    );
    let enabled = tick.monastery_hospitality_enabled(ctx, monastery.owner);
    if !enabled || !feast_day || clock.hour != 12 || clock.minute != 0 || !first_tick_of_minute {
        return;
    }
    let Some(network) = tick.road_network(monastery.owner) else {
        return;
    };
    let available_food = withdraw_building_commodity(monastery, CommodityKind::Food, 18.0);
    let available_ale = withdraw_building_commodity(monastery, CommodityKind::Ale, 10.0);
    if available_food <= 1e-6 && available_ale <= 1e-6 {
        return;
    }
    withdraw_building_commodity(monastery, CommodityKind::Honey, MONASTERY_FEAST_HONEY);
    withdraw_building_commodity(monastery, CommodityKind::Wine, MONASTERY_FEAST_WINE);
    let residences: Vec<Residence> = ctx
        .db
        .residence()
        .owner()
        .filter(&monastery.owner)
        .filter(|home| {
            !home.abandoned
                && network
                    .road_path_distance(monastery.x, monastery.z, home.x, home.z)
                    .is_some()
        })
        .collect();
    let count = residences.len().max(1) as f64;
    for home in &residences {
        apply_need_delivery(
            ctx,
            home.id,
            ResidenceNeedKind::Food,
            available_food / count,
        );
        if home.tier >= 3 {
            apply_need_delivery(ctx, home.id, ResidenceNeedKind::Ale, available_ale / count);
        }
    }
    if let Some(mut resources) = ctx.db.player_resources().owner().find(&monastery.owner) {
        resources.monastery_food_charity_total += available_food;
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
        .filter(|building| building.kind == "chapel" && building.construction_complete)
        .collect();
    monastery_linked_to_chapel(tick, monastery, &chapels)
}
