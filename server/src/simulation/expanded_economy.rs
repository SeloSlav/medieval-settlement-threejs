use spacetimedb::ReducerContext;

use crate::balance_generated::{
    APIARY_FOOD_PER_CYCLE, APIARY_HONEY_PER_CYCLE, BREWERY_ALE_PER_CYCLE,
    BREWERY_GRAIN_PER_CYCLE, BREWERY_WATER_PER_CYCLE, FERRY_GOLD_PER_DAY,
    FARM_GROWTH_SECONDS, FARM_WORK_METERS_PER_WORKER_PER_SEC,
    GRAIN_TRANSFER_PER_TRIP, GRANARY_FIREWOOD_PER_CYCLE,
    GRANARY_FLOUR_PER_CYCLE, GRANARY_WATER_PER_CYCLE,
    GRANARY_FOOD_PER_CYCLE, MONASTERY_CHARITY_FOOD_PER_DELIVERY, MONASTERY_COVERAGE_RADIUS,
    MONASTERY_FOOD_PER_CYCLE, MONASTERY_GRAIN_PER_CYCLE,
    MONASTERY_PILGRIMAGE_GOLD_PER_DAY, MONASTERY_UNLINKED_PRODUCTIVITY,
    SMOKEHOUSE_FIREWOOD_PER_CYCLE, SMOKEHOUSE_FOOD_PER_CYCLE, SMOKEHOUSE_PRESERVED_FOOD_PER_CYCLE,
    SPECIALTY_EXPORT_GOLD_PER_ALE, SPECIALTY_EXPORT_GOLD_PER_HONEY,
    SPECIALTY_EXPORT_GOLD_PER_WINE, TICK_DT, TIMBER_DELIVERY_SPEED_MPS,
    TIMBER_DELIVERY_UNLOAD_SEC, VINEYARD_FOOD_PER_CYCLE, VINEYARD_WINE_PER_CYCLE,
    WATERMILL_FLOUR_PER_CYCLE, WATERMILL_GRAIN_PER_CYCLE,
    CALENDAR_SECONDS_PER_DAY, FOOD_DELIVERY_SPEED_MPS, FOOD_DELIVERY_UNLOAD_SEC,
};
use crate::building_defs::building_def;
use crate::burgage::{Point2, ZoneCorners};
use crate::db::*;
use crate::economy::{
    building_commodity_cap, building_commodity_room, building_commodity_stock,
    credit_treasury_gold, deposit_building_commodity, withdraw_building_commodity,
    CommodityKind,
};
use crate::farming::{
    expected_grain_yield, fertility_after_harvest, shape_efficiency, work_required,
    CROP_FALLOW, STAGE_GROWING, STAGE_HARVESTING, STAGE_PLOUGHING, STAGE_SOWING,
};
use crate::simulation::delivery_trips::{
    building_has_active_trip, building_has_inbound_supply_trip,
    try_start_building_supply_trip, try_start_delivery_trip,
};
use crate::simulation::game_calendar::GameClock;
use crate::simulation::landmark_access::monastery_linked_to_chapel;
use crate::simulation::labor_and_logistics_paused;
use crate::simulation::residence_needs::{apply_need_delivery, load_needs, need_stock, ResidenceNeedKind};
use crate::simulation::tick_context::SimTickContext;
use crate::simulation::water_logistics::ensure_building_water;
use crate::tables::{farm_field, Building, FarmField, Residence};

pub fn step_threshing_barn(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    mut building: Building,
) {
    if !labor_and_logistics_paused(ctx, building.owner, clock) {
        step_farmstead_fields(ctx, &mut building);
    }
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
    let mut granary = ensure_water_for_process(ctx, tick, building, GRANARY_WATER_PER_CYCLE);
    request_connected_commodity(
        ctx,
        tick,
        clock,
        &granary,
        CommodityKind::Firewood,
        &["woodcutters_lodge", "village_storehouse"],
        GRANARY_FIREWOOD_PER_CYCLE * 3.0,
    );
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
    dispatch_to_building(ctx, tick, clock, &mut granary, CommodityKind::Food, &["smokehouse"]);
    dispatch_need(ctx, tick, clock, &mut granary, ResidenceNeedKind::Food, 4.0);
    ctx.db.building().id().update(granary);
}

fn step_farmstead_fields(ctx: &ReducerContext, farmstead: &mut Building) {
    let mut fields: Vec<FarmField> = ctx
        .db
        .farm_field()
        .farmstead_id()
        .filter(&farmstead.id)
        .collect();

    // Growth continues without assigned farm labor; only field work consumes the crew budget.
    for field in &mut fields {
        if field.stage != STAGE_GROWING {
            continue;
        }
        let crop_growth_multiplier = if field.crop == CROP_FALLOW { 0.72 } else { 1.0 };
        field.stage_progress = (field.stage_progress
            + TICK_DT * crop_growth_multiplier / FARM_GROWTH_SECONDS.max(1.0))
            .min(1.0);
        if field.stage_progress >= 1.0 - 1e-9 {
            if field.crop == CROP_FALLOW {
                finish_field_cycle(field, 0.0);
            } else {
                field.stage = STAGE_HARVESTING;
                field.stage_progress = 0.0;
            }
        }
    }

    let mut work_budget = farmstead.assigned_labor as f64
        * FARM_WORK_METERS_PER_WORKER_PER_SEC
        * TICK_DT;
    fields.sort_by(|a, b| {
        b.priority
            .cmp(&a.priority)
            .then_with(|| stage_urgency(b.stage).cmp(&stage_urgency(a.stage)))
            .then_with(|| a.id.cmp(&b.id))
    });

    for field in &mut fields {
        if work_budget <= 1e-9 || field.stage == STAGE_GROWING || field.priority == 0 {
            continue;
        }
        let corners = field_corners(field);
        let shape = shape_efficiency(&corners);
        let (plough_multiplier, manure_bonus) =
            super::livestock::cattle_support_for_field(ctx, field);
        let required = (work_required(field.stage, field.area, shape)
            * if field.stage == STAGE_PLOUGHING { plough_multiplier } else { 1.0 })
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
                let storage_limited_work = required
                    * building_commodity_room(farmstead, CommodityKind::Grain)
                    / expected;
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
                field.stage = if field.crop == CROP_FALLOW { STAGE_GROWING } else { STAGE_SOWING };
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
    field.fertility = (fertility_after_harvest(field.crop, field.fertility) + manure_bonus)
        .clamp(0.0, 1.0);
    field.crop = field.next_crop;
    field.stage = STAGE_PLOUGHING;
    field.stage_progress = 0.0;
}

fn field_corners(field: &FarmField) -> ZoneCorners {
    ZoneCorners {
        a: Point2 { x: field.corner_ax, z: field.corner_az },
        b: Point2 { x: field.corner_bx, z: field.corner_bz },
        c: Point2 { x: field.corner_cx, z: field.corner_cz },
        d: Point2 { x: field.corner_dx, z: field.corner_dz },
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
    let mut brewery = ensure_water_for_process(ctx, tick, building, BREWERY_WATER_PER_CYCLE);
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
    dispatch_to_building(ctx, tick, clock, &mut brewery, CommodityKind::Ale, &["monastery"]);
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
        &["hunters_hall", "foragers_shed", "granary", "swineherd"],
        SMOKEHOUSE_FOOD_PER_CYCLE * 2.0,
    );
    request_connected_commodity(ctx, tick, clock, &smokehouse, CommodityKind::Firewood, &["woodcutters_lodge", "village_storehouse"], SMOKEHOUSE_FIREWOOD_PER_CYCLE * 3.0);
    smokehouse = step_processor(
        ctx,
        clock,
        smokehouse,
        &[(CommodityKind::Food, SMOKEHOUSE_FOOD_PER_CYCLE), (CommodityKind::Firewood, SMOKEHOUSE_FIREWOOD_PER_CYCLE)],
        &[(CommodityKind::PreservedFood, SMOKEHOUSE_PRESERVED_FOOD_PER_CYCLE)],
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
    dispatch_need(ctx, tick, clock, &mut vineyard, ResidenceNeedKind::Food, 2.0);
    ctx.db.building().id().update(vineyard);
}

pub fn step_monastery(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    building: Building,
) {
    let linked = monastery_has_parish_link(ctx, tick, &building);
    let productivity = if linked { 1.0 } else { MONASTERY_UNLINKED_PRODUCTIVITY };
    let mut monastery = step_autonomous_processor(
        ctx,
        clock,
        building,
        &[(CommodityKind::Grain, MONASTERY_GRAIN_PER_CYCLE * productivity)],
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

pub fn step_carpenter(ctx: &ReducerContext, clock: &GameClock, mut building: Building) {
    if labor_and_logistics_paused(ctx, building.owner, clock) {
        return;
    }
    building.action_cooldown = (building.action_cooldown - TICK_DT).max(0.0);
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
    building: Building,
    needed: f64,
) -> Building {
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
    let mut targets: Vec<Building> = ctx
        .db
        .building()
        .owner()
        .filter(&source.owner)
        .filter(|target| {
            target.id != source.id
                && target_kinds.contains(&target.kind.as_str())
                && building_commodity_room(target, commodity) > 1e-6
                && !building_has_inbound_supply_trip(ctx, target.id)
        })
        .collect();
    targets.sort_by(|a, b| {
        let da = network
            .road_path_distance(source.x, source.z, a.x, a.z)
            .unwrap_or(f64::INFINITY);
        let db = network
            .road_path_distance(source.x, source.z, b.x, b.z)
            .unwrap_or(f64::INFINITY);
        da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
    });
    let Some(target) = targets.first() else {
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
    let mut targets: Vec<Residence> = ctx
        .db
        .residence()
        .owner()
        .filter(&supplier.owner)
        .filter(|residence| {
            if residence.abandoned || !need_kind.is_active_for_tier(residence.tier) {
                return false;
            }
            network
                .road_path_distance(supplier.x, supplier.z, residence.x, residence.z)
                .is_some_and(|distance| distance <= MONASTERY_COVERAGE_RADIUS)
        })
        .collect();
    targets.sort_by(|a, b| {
        let sa = need_stock(&load_needs(ctx, a.id), need_kind);
        let sb = need_stock(&load_needs(ctx, b.id), need_kind);
        sa.partial_cmp(&sb).unwrap_or(std::cmp::Ordering::Equal)
    });
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
    if building_has_active_trip(ctx, supplier.id)
        || building_commodity_stock(supplier, need_to_commodity(need_kind)) <= 1e-6
    {
        return;
    }
    let Some(network) = tick.road_network(supplier.owner) else {
        return;
    };
    let mut targets: Vec<Residence> = ctx
        .db
        .residence()
        .owner()
        .filter(&supplier.owner)
        .filter(|residence| {
            !residence.abandoned
                && need_kind.is_active_for_tier(residence.tier)
                && network
                    .road_path_distance(supplier.x, supplier.z, residence.x, residence.z)
                    .is_some()
        })
        .collect();
    targets.sort_by(|a, b| {
        let sa = need_stock(&load_needs(ctx, a.id), need_kind);
        let sb = need_stock(&load_needs(ctx, b.id), need_kind);
        sa.partial_cmp(&sb).unwrap_or(std::cmp::Ordering::Equal)
    });
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
    if building_commodity_stock(&target, commodity) + 1e-6 >= desired {
        return;
    }
    let Some(network) = tick.road_network(target.owner) else {
        return;
    };
    let mut sources: Vec<Building> = ctx
        .db
        .building()
        .owner()
        .filter(&target.owner)
        .filter(|source| {
            source_kinds.contains(&source.kind.as_str())
                && building_commodity_stock(source, commodity) > 1e-6
                && !building_has_active_trip(ctx, source.id)
                && network
                    .road_path_distance(source.x, source.z, target.x, target.z)
                    .is_some()
        })
        .collect();
    sources.sort_by_key(|source| source.id);
    for mut source in sources {
        let request = (desired - building_commodity_stock(target, commodity)).max(0.0);
        if try_start_building_supply_trip(ctx, clock, network, &mut source, target, 1, commodity, TIMBER_DELIVERY_SPEED_MPS, TIMBER_DELIVERY_UNLOAD_SEC, GRAIN_TRANSFER_PER_TRIP, request) {
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
    let feast_day = matches!((clock.month, clock.month_day), (1, 6) | (6, 29) | (8, 15) | (9, 14) | (12, 25));
    let enabled = ctx.db.player_resources().owner().find(&monastery.owner)
        .map(|resources| resources.monastery_feasts_enabled).unwrap_or(false);
    if !enabled || !feast_day || clock.hour != 12 || clock.minute != 0 || !first_tick_of_minute {
        return;
    }
    let Some(network) = tick.road_network(monastery.owner) else { return; };
    let available_food = withdraw_building_commodity(monastery, CommodityKind::Food, 18.0);
    let available_ale = withdraw_building_commodity(monastery, CommodityKind::Ale, 10.0);
    if available_food <= 1e-6 && available_ale <= 1e-6 { return; }
    let residences: Vec<Residence> = ctx.db.residence().owner().filter(&monastery.owner)
        .filter(|home| !home.abandoned && network.road_path_distance(monastery.x, monastery.z, home.x, home.z).is_some())
        .collect();
    let count = residences.len().max(1) as f64;
    for home in &residences {
        apply_need_delivery(ctx, home.id, ResidenceNeedKind::Food, available_food / count);
        if home.tier >= 3 { apply_need_delivery(ctx, home.id, ResidenceNeedKind::Ale, available_ale / count); }
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
    ctx.db.building().owner().filter(&building.owner).any(|market| {
        market.kind == "marketplace"
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
        .filter(|building| building.kind == "chapel")
        .collect();
    monastery_linked_to_chapel(tick, monastery, &chapels)
}
