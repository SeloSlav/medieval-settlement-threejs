use spacetimedb::ReducerContext;

use crate::balance_generated::{
    APIARY_FOOD_PER_CYCLE, APIARY_HONEY_PER_CYCLE, BREWERY_ALE_PER_CYCLE, BREWERY_GRAIN_PER_CYCLE,
    BREWERY_WATER_PER_CYCLE, CALENDAR_SECONDS_PER_DAY, FARM_GROWTH_SECONDS,
    FARM_WORK_METERS_PER_WORKER_PER_SEC, FERRY_GOLD_PER_DAY, FOOD_DELIVERY_SPEED_MPS,
    FOOD_DELIVERY_UNLOAD_SEC, GRAIN_TRANSFER_PER_TRIP, GRANARY_FIREWOOD_PER_CYCLE,
    GRANARY_FLOUR_PER_CYCLE, GRANARY_FOOD_PER_CYCLE, GRANARY_WATER_PER_CYCLE,
    MONASTERY_CHARITY_FOOD_PER_DELIVERY, MONASTERY_COVERAGE_RADIUS, MONASTERY_FOOD_PER_CYCLE,
    MONASTERY_GRAIN_PER_CYCLE, MONASTERY_PILGRIMAGE_GOLD_PER_DAY, MONASTERY_UNLINKED_PRODUCTIVITY,
    SMOKEHOUSE_FIREWOOD_PER_CYCLE, SMOKEHOUSE_FOOD_PER_CYCLE, SMOKEHOUSE_PRESERVED_FOOD_PER_CYCLE,
    SPECIALTY_EXPORT_GOLD_PER_ALE, SPECIALTY_EXPORT_GOLD_PER_HONEY, SPECIALTY_EXPORT_GOLD_PER_WINE,
    TICK_DT, TIMBER_DELIVERY_SPEED_MPS, TIMBER_DELIVERY_UNLOAD_SEC, VINEYARD_FOOD_PER_CYCLE,
    VINEYARD_WINE_PER_CYCLE, WATERMILL_FLOUR_PER_CYCLE, WATERMILL_GRAIN_PER_CYCLE,
};
use crate::building_defs::building_def;
use crate::burgage::{Point2, ZoneCorners};
use crate::db::*;
use crate::economy::{
    building_commodity_cap, building_commodity_room, building_commodity_stock,
    credit_treasury_gold, deposit_building_commodity, spend_treasury_gold,
    withdraw_building_commodity, CommodityKind,
};
use crate::farming::{
    expected_grain_yield, fertility_after_harvest, shape_efficiency, work_required, CROP_FALLOW,
    STAGE_GROWING, STAGE_HARVESTING, STAGE_PLOUGHING, STAGE_SOWING,
};
use crate::frontier_economy_policy::{
    armed_guards, guard_upkeep, next_guard_readiness, CARPENTER_GOLD_PER_POLEARM,
    CARPENTER_TIMBER_PER_POLEARM,
};
use crate::season_policy::{EnvironmentState, WeatherKind};
use crate::simulation::delivery_trips::{
    building_has_active_trip, building_has_inbound_supply_trip, try_start_building_supply_trip,
    try_start_delivery_trip,
};
use crate::simulation::game_calendar::GameClock;
use crate::simulation::labor_and_logistics_paused;
use crate::simulation::landmark_access::monastery_linked_to_chapel;
use crate::simulation::residence_needs::{
    apply_need_delivery, load_needs, need_stock, ResidenceNeedKind,
};
use crate::simulation::tick_context::SimTickContext;
use crate::simulation::water_logistics::ensure_building_water;
use crate::supply_policy::{compare_need_delivery_candidates, compare_supply_route_candidates};
use crate::tables::{farm_field, Building, FarmField, Residence};

struct RoutedBuilding {
    building: Building,
    distance: f64,
}

struct RoutedResidence {
    residence: Residence,
    stock: f64,
    distance: f64,
}

pub fn step_threshing_barn(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    environment: EnvironmentState,
    mut building: Building,
) {
    let work_allowed = !labor_and_logistics_paused(ctx, building.owner, clock);
    step_farmstead_fields(ctx, &mut building, clock, environment, work_allowed);
    if !labor_and_logistics_paused(ctx, building.owner, clock) && building.assigned_labor > 0 {
        dispatch_to_building(
            ctx,
            tick,
            clock,
            &mut building,
            CommodityKind::Grain,
            &["watermill", "brewery", "granary", "monastery"],
        );
    }
    ctx.db.building().id().update(building);
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
    let mut granary =
        ensure_water_for_process(ctx, tick, clock, building, GRANARY_WATER_PER_CYCLE);
    request_connected_commodity(
        ctx,
        tick,
        clock,
        &granary,
        CommodityKind::Firewood,
        &["woodcutters_lodge", "village_storehouse"],
        GRANARY_FIREWOOD_PER_CYCLE * 3.0,
    );
    // Once its bakery inputs are covered, the granary also centralizes fresh
    // wild food. Producers keep enough local stock for direct household
    // deliveries; the granary requests only while below its storage buffer.
    if granary.granary_accepts_fresh_food {
        let food_buffer = building_commodity_cap(&granary.kind, CommodityKind::Food) * 0.75;
        request_connected_commodity(
            ctx,
            tick,
            clock,
            &granary,
            CommodityKind::Food,
            &["hunters_hall", "foragers_shed", "fishing_camp", "swineherd"],
            food_buffer,
        );
    }
    granary = step_processor(
        ctx,
        clock,
        granary,
        &[
            (CommodityKind::Flour, GRANARY_FLOUR_PER_CYCLE),
            (CommodityKind::Water, GRANARY_WATER_PER_CYCLE),
            (CommodityKind::Firewood, GRANARY_FIREWOOD_PER_CYCLE),
        ],
        &[(CommodityKind::Food, GRANARY_FOOD_PER_CYCLE)],
    );
    dispatch_to_building(
        ctx,
        tick,
        clock,
        &mut granary,
        CommodityKind::Food,
        &["smokehouse"],
    );
    dispatch_need(ctx, tick, clock, &mut granary, ResidenceNeedKind::Food, 4.0);
    ctx.db.building().id().update(granary);
}

fn step_farmstead_fields(
    ctx: &ReducerContext,
    farmstead: &mut Building,
    clock: &GameClock,
    environment: EnvironmentState,
    work_allowed: bool,
) {
    let mut fields: Vec<FarmField> = ctx
        .db
        .farm_field()
        .farmstead_id()
        .filter(&farmstead.id)
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
        if matches!(clock.month, 12 | 1 | 2) && field.stage == STAGE_SOWING {
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
            } else {
                fail_field_cycle(field);
            }
        } else if clock.month == 10 && field.stage == STAGE_HARVESTING {
            fail_field_cycle(field);
        }
    }

    // Fully sown grain is dormant in winter, then grows through spring and summer.
    for field in &mut fields {
        if field.stage != STAGE_GROWING || !matches!(clock.month, 3..=8) {
            continue;
        }
        let crop_growth_multiplier = if field.crop == CROP_FALLOW { 0.72 } else { 1.0 };
        field.stage_progress = (field.stage_progress
            + TICK_DT * crop_growth_multiplier * environment.crop_growth_multiplier()
                / FARM_GROWTH_SECONDS.max(1.0))
        .min(1.0);
    }

    let mut work_budget = if work_allowed {
        farmstead.assigned_labor as f64 * FARM_WORK_METERS_PER_WORKER_PER_SEC * TICK_DT
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
            || !field_work_allowed(field.stage, clock.month)
        {
            continue;
        }
        let corners = field_corners(field);
        let shape = shape_efficiency(&corners);
        let (plough_multiplier, manure_bonus) =
            super::livestock::cattle_support_for_field(ctx, field);
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
        if spent <= 1e-9 {
            continue;
        }
        let previous_progress = field.stage_progress;
        field.stage_progress = (field.stage_progress + spent / required).min(1.0);
        work_budget -= spent;
        if let Some(expected) = expected_harvest {
            let harvested = expected * (field.stage_progress - previous_progress).max(0.0);
            deposit_building_commodity(farmstead, CommodityKind::Grain, harvested);
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

    for field in fields {
        ctx.db.farm_field().id().update(field);
    }
}

fn finish_field_cycle(field: &mut FarmField, harvested: f64) {
    finish_field_cycle_with_manure(field, harvested, 0.0);
}

fn finish_field_cycle_with_manure(field: &mut FarmField, harvested: f64, manure_bonus: f64) {
    field.last_yield = harvested;
    field.harvest_count = field.harvest_count.saturating_add(1);
    field.fertility =
        (fertility_after_harvest(field.crop, field.fertility) + manure_bonus).clamp(0.0, 1.0);
    field.crop = field.next_crop;
    field.stage = STAGE_PLOUGHING;
    field.stage_progress = 0.0;
}

fn fail_field_cycle(field: &mut FarmField) {
    field.last_yield = 0.0;
    field.crop = field.next_crop;
    field.stage = STAGE_PLOUGHING;
    field.stage_progress = 0.0;
}

fn field_work_allowed(stage: u8, month: u32) -> bool {
    match stage {
        STAGE_HARVESTING => month == 9,
        STAGE_PLOUGHING | STAGE_SOWING => matches!(month, 10 | 11),
        _ => false,
    }
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
    let mut brewery =
        ensure_water_for_process(ctx, tick, clock, building, BREWERY_WATER_PER_CYCLE);
    brewery = step_processor(
        ctx,
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
    export_specialty(
        ctx,
        tick,
        &mut brewery,
        CommodityKind::Ale,
        SPECIALTY_EXPORT_GOLD_PER_ALE,
    );
    ctx.db.building().id().update(brewery);
}

pub fn step_smokehouse(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    building: Building,
) {
    let mut smokehouse = building;
    request_connected_commodity(
        ctx,
        tick,
        clock,
        &smokehouse,
        CommodityKind::Food,
        &[
            "hunters_hall",
            "foragers_shed",
            "fishing_camp",
            "granary",
            "swineherd",
        ],
        SMOKEHOUSE_FOOD_PER_CYCLE * 2.0,
    );
    request_connected_commodity(
        ctx,
        tick,
        clock,
        &smokehouse,
        CommodityKind::Firewood,
        &["woodcutters_lodge", "village_storehouse"],
        SMOKEHOUSE_FIREWOOD_PER_CYCLE * 3.0,
    );
    smokehouse = step_processor(
        ctx,
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
    let mut apiary = step_simple_producer(
        ctx,
        clock,
        building,
        &[
            (CommodityKind::Honey, APIARY_HONEY_PER_CYCLE),
            (CommodityKind::Food, APIARY_FOOD_PER_CYCLE),
        ],
    );
    export_specialty(
        ctx,
        tick,
        &mut apiary,
        CommodityKind::Honey,
        SPECIALTY_EXPORT_GOLD_PER_HONEY,
    );
    dispatch_need(ctx, tick, clock, &mut apiary, ResidenceNeedKind::Food, 2.0);
    ctx.db.building().id().update(apiary);
}

pub fn step_vineyard(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    building: Building,
) {
    let mut vineyard = step_simple_producer(
        ctx,
        clock,
        building,
        &[
            (CommodityKind::Wine, VINEYARD_WINE_PER_CYCLE),
            (CommodityKind::Food, VINEYARD_FOOD_PER_CYCLE),
        ],
    );
    export_specialty(
        ctx,
        tick,
        &mut vineyard,
        CommodityKind::Wine,
        SPECIALTY_EXPORT_GOLD_PER_WINE,
    );
    dispatch_need(
        ctx,
        tick,
        clock,
        &mut vineyard,
        ResidenceNeedKind::Food,
        2.0,
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
        clock,
        building,
        &[(
            CommodityKind::Grain,
            MONASTERY_GRAIN_PER_CYCLE * productivity,
        )],
        &[(CommodityKind::Food, MONASTERY_FOOD_PER_CYCLE * productivity)],
    );

    if linked && owner_has_connected_marketplace(ctx, tick, &monastery) {
        let gold = MONASTERY_PILGRIMAGE_GOLD_PER_DAY * TICK_DT / CALENDAR_SECONDS_PER_DAY;
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
    if !labor_and_logistics_paused(ctx, building.owner, clock)
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
        .is_some_and(|config| config.conflict_enabled && config.enemy_pressure > 0)
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

    request_connected_commodity(
        ctx,
        tick,
        clock,
        &building,
        CommodityKind::Timber,
        &["lumber_mill", "village_storehouse"],
        CARPENTER_TIMBER_PER_POLEARM * 6.0,
    );

    if cycle_ready(ctx, clock, &mut building, false)
        && building.timber + 1e-6 >= CARPENTER_TIMBER_PER_POLEARM
        && building_commodity_room(&building, CommodityKind::Polearms) + 1e-6 >= 1.0
        && spend_treasury_gold(ctx, building.owner, CARPENTER_GOLD_PER_POLEARM).is_ok()
    {
        withdraw_building_commodity(
            &mut building,
            CommodityKind::Timber,
            CARPENTER_TIMBER_PER_POLEARM,
        );
        deposit_building_commodity(&mut building, CommodityKind::Polearms, 1.0);
        let labor = building.assigned_labor as f64;
        reset_cycle(&mut building, labor);
    }
    dispatch_to_building(
        ctx,
        tick,
        clock,
        &mut building,
        CommodityKind::Polearms,
        &["guardhouse"],
    );
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

    let food_buffer = (building.assigned_labor as f64 * 6.0).max(12.0);
    request_connected_commodity(
        ctx,
        tick,
        clock,
        &building,
        CommodityKind::Food,
        &[
            "granary",
            "hunters_hall",
            "foragers_shed",
            "fishing_camp",
            "pastoral_farmstead",
            "swineherd",
        ],
        food_buffer,
    );

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

    let treasury_gold = ctx
        .db
        .player_resources()
        .owner()
        .find(&building.owner)
        .map(|resources| resources.gold)
        .unwrap_or(0.0);
    let upkeep = guard_upkeep(
        armed_guards,
        building.food,
        treasury_gold,
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
    clock: &GameClock,
    mut building: Building,
    outputs: &[(CommodityKind, f64)],
) -> Building {
    if !cycle_ready(ctx, clock, &mut building, false) {
        return building;
    }
    let labor = building.assigned_labor.max(1) as f64;
    for (kind, amount) in outputs {
        deposit_building_commodity(&mut building, *kind, *amount);
    }
    reset_cycle(&mut building, labor);
    building
}

fn step_processor(
    ctx: &ReducerContext,
    clock: &GameClock,
    mut building: Building,
    inputs: &[(CommodityKind, f64)],
    outputs: &[(CommodityKind, f64)],
) -> Building {
    if !cycle_ready(ctx, clock, &mut building, false) {
        return building;
    }
    let labor = building.assigned_labor.max(1) as f64;
    process_batch(&mut building, inputs, outputs, 1.0);
    reset_cycle(&mut building, labor);
    building
}

fn step_autonomous_processor(
    ctx: &ReducerContext,
    clock: &GameClock,
    mut building: Building,
    inputs: &[(CommodityKind, f64)],
    outputs: &[(CommodityKind, f64)],
) -> Building {
    if !cycle_ready(ctx, clock, &mut building, true) {
        return building;
    }
    process_batch(&mut building, inputs, outputs, 1.0);
    reset_cycle(&mut building, 1.0);
    building
}

fn process_batch(
    building: &mut Building,
    inputs: &[(CommodityKind, f64)],
    outputs: &[(CommodityKind, f64)],
    labor: f64,
) {
    let mut scale = labor;
    for (kind, amount) in inputs {
        if *amount > 1e-6 {
            scale = scale.min(building_commodity_stock(building, *kind) / amount);
        }
    }
    for (kind, amount) in outputs {
        if *amount > 1e-6 {
            scale = scale.min(building_commodity_room(building, *kind) / amount);
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

fn cycle_ready(
    ctx: &ReducerContext,
    clock: &GameClock,
    building: &mut Building,
    autonomous: bool,
) -> bool {
    if labor_and_logistics_paused(ctx, building.owner, clock) {
        return false;
    }
    building.action_cooldown = (building.action_cooldown - TICK_DT).max(0.0);
    building.action_cooldown <= 1e-6 && (autonomous || building.assigned_labor > 0)
}

fn reset_cycle(building: &mut Building, labor: f64) {
    let interval = building_def(&building.kind)
        .map(|def| def.action_interval)
        .unwrap_or(1.0);
    building.action_cooldown = interval / labor.max(1.0);
}

fn ensure_water_for_process(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    building: Building,
    needed: f64,
) -> Building {
    if building.assigned_labor == 0 || labor_and_logistics_paused(ctx, building.owner, clock) {
        return building;
    }
    let Some(network) = tick.road_network(building.owner) else {
        return building;
    };
    ensure_building_water(ctx, tick, network, building, needed)
}

pub(crate) fn dispatch_to_building(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    source: &mut Building,
    commodity: CommodityKind,
    target_kinds: &[&str],
) {
    if source.assigned_labor == 0 || building_has_active_trip(ctx, source.id) {
        return;
    }
    let Some(network) = tick.road_network(source.owner) else {
        return;
    };
    let mut targets: Vec<RoutedBuilding> = ctx
        .db
        .building()
        .owner()
        .filter(&source.owner)
        .filter_map(|target| {
            if target.id == source.id
                || !target.construction_complete
                || !target_kinds.contains(&target.kind.as_str())
                || building_commodity_room(&target, commodity) <= 1e-6
                || building_has_inbound_supply_trip(ctx, target.id)
            {
                return None;
            }
            network
                .road_path_distance(source.x, source.z, target.x, target.z)
                .map(|distance| RoutedBuilding {
                    building: target,
                    distance,
                })
        })
        .collect();
    targets.sort_by(|a, b| {
        compare_supply_route_candidates(a.distance, a.building.id, b.distance, b.building.id)
    });
    let Some(target) = targets.first().map(|candidate| &candidate.building) else {
        return;
    };
    let needed = building_commodity_room(target, commodity);
    try_start_building_supply_trip(
        ctx,
        clock,
        network,
        source,
        target,
        1,
        commodity,
        TIMBER_DELIVERY_SPEED_MPS,
        TIMBER_DELIVERY_UNLOAD_SEC,
        GRAIN_TRANSFER_PER_TRIP,
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
        || labor_and_logistics_paused(ctx, supplier.owner, clock)
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
    let specialty_claimed = matches!(
        need_kind,
        ResidenceNeedKind::Ale | ResidenceNeedKind::PreservedFood
    );
    let mut targets: Vec<RoutedResidence> = ctx
        .db
        .residence()
        .owner()
        .filter(&supplier.owner)
        .filter_map(|residence| {
            if residence.abandoned
                || residence.population == 0
                || !need_kind.is_active_for_tier(residence.tier)
            {
                return None;
            }
            if specialty_claimed
                && tick.specialty_supplier_for(ctx, supplier.owner, residence.id, need_kind)
                    != Some(supplier.id)
            {
                return None;
            }
            let distance =
                network.road_path_distance(supplier.x, supplier.z, residence.x, residence.z)?;
            if max_distance.is_some_and(|limit| distance > limit) {
                return None;
            }
            Some(RoutedResidence {
                stock: need_stock(&load_needs(ctx, residence.id), need_kind),
                residence,
                distance,
            })
        })
        .collect();
    targets.sort_by(|a, b| {
        compare_need_delivery_candidates(
            a.stock,
            a.residence.population,
            a.distance,
            a.residence.id,
            b.stock,
            b.residence.population,
            b.distance,
            b.residence.id,
        )
    });
    targets.into_iter().map(|target| target.residence).collect()
}

fn need_to_commodity(kind: ResidenceNeedKind) -> CommodityKind {
    match kind {
        ResidenceNeedKind::Firewood => CommodityKind::Firewood,
        ResidenceNeedKind::Water => CommodityKind::Water,
        ResidenceNeedKind::Food => CommodityKind::Food,
        ResidenceNeedKind::Ale => CommodityKind::Ale,
        ResidenceNeedKind::PreservedFood => CommodityKind::PreservedFood,
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
    if !target.construction_complete
        || target.assigned_labor == 0
        || labor_and_logistics_paused(ctx, target.owner, clock)
        || building_has_inbound_supply_trip(ctx, target.id)
        || building_commodity_stock(&target, commodity) + 1e-6 >= desired
    {
        return;
    }
    let Some(network) = tick.road_network(target.owner) else {
        return;
    };
    let mut sources: Vec<RoutedBuilding> = ctx
        .db
        .building()
        .owner()
        .filter(&target.owner)
        .filter_map(|source| {
            if !source.construction_complete
                || !source_kinds.contains(&source.kind.as_str())
                || building_commodity_stock(&source, commodity) <= 1e-6
                || building_has_active_trip(ctx, source.id)
            {
                return None;
            }
            network
                .road_path_distance(source.x, source.z, target.x, target.z)
                .map(|distance| RoutedBuilding {
                    building: source,
                    distance,
                })
        })
        .collect();
    sources.sort_by(|a, b| {
        compare_supply_route_candidates(a.distance, a.building.id, b.distance, b.building.id)
    });
    for routed_source in sources {
        let mut source = routed_source.building;
        let request = (desired - building_commodity_stock(target, commodity)).max(0.0);
        if try_start_building_supply_trip(
            ctx,
            clock,
            network,
            &mut source,
            target,
            1,
            commodity,
            TIMBER_DELIVERY_SPEED_MPS,
            TIMBER_DELIVERY_UNLOAD_SEC,
            GRAIN_TRANSFER_PER_TRIP,
            request,
        ) {
            ctx.db.building().id().update(source);
            break;
        }
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
    let enabled = ctx
        .db
        .player_resources()
        .owner()
        .find(&monastery.owner)
        .map(|resources| resources.monastery_feasts_enabled)
        .unwrap_or(false);
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

fn export_specialty(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    building: &mut Building,
    commodity: CommodityKind,
    gold_per_unit: f64,
) {
    if !owner_has_connected_marketplace(ctx, tick, building) {
        return;
    }
    let cap = building_commodity_cap(&building.kind, commodity);
    let reserve = cap * 0.25;
    let sellable = (building_commodity_stock(building, commodity) - reserve).max(0.0);
    let sold = withdraw_building_commodity(building, commodity, sellable.min(0.5));
    credit_treasury_gold(ctx, building.owner, sold * gold_per_unit);
}

fn owner_has_connected_marketplace(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    building: &Building,
) -> bool {
    let Some(network) = tick.road_network(building.owner) else {
        return false;
    };
    ctx.db
        .building()
        .owner()
        .filter(&building.owner)
        .any(|market| {
            market.kind == "marketplace"
                && market.construction_complete
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
    let chapels: Vec<Building> = ctx
        .db
        .building()
        .owner()
        .filter(&monastery.owner)
        .filter(|building| building.kind == "chapel" && building.construction_complete)
        .collect();
    monastery_linked_to_chapel(tick, monastery, &chapels)
}
