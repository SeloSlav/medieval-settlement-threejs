use spacetimedb::ReducerContext;

use crate::balance_generated::{
    FORAGER_REMEDIES_PER_HARVEST, FORAGER_REMEDY_SEASON_END_MONTH,
    FORAGER_REMEDY_SEASON_START_MONTH,
};
use crate::building_defs::building_def;
use crate::constants::{
    BERRIES_PER_HARVEST, FISH_PER_HARVEST, GAME_ANIMALS_PER_HARVEST, GAME_PER_HARVEST,
    MUSHROOMS_PER_HARVEST, TICK_DT,
};
use crate::db::*;
use crate::economy::{
    building_commodity_room, building_commodity_stock, deposit_building_commodity, CommodityKind,
};
use crate::foraging_policy::{harvest_available, harvest_yield_multiplier};
use crate::harvest_reserve_policy::harvestable_wild_stock;
use crate::simulation::delivery_supplier::delivery_work_ready;
use crate::simulation::delivery_trips::{
    available_free_haulers, onsite_building_labor, residence_has_inbound_remedy_trip,
    try_start_remedy_delivery_trip,
};
use crate::simulation::game_calendar::GameClock;
use crate::simulation::labor_and_logistics_paused;
use crate::simulation::road_logistics::select_residence_for_remedy_delivery;
use crate::simulation::spatial::find_nearest_harvestable_foraging_node;
use crate::simulation::tick_context::SimTickContext;
use crate::tables::{Building, ForagingNode, Residence};

pub fn step_hunters_hall(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    building: Building,
) {
    step_food_supplier(
        ctx,
        tick,
        clock,
        building,
        &["game"],
        GAME_ANIMALS_PER_HARVEST,
        GAME_PER_HARVEST,
        false,
    );
}

pub fn step_foragers_shed(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    building: Building,
) {
    // Both resources use the same three-unit basket size; the nearest
    // seasonally available patch wins.
    debug_assert!((BERRIES_PER_HARVEST - MUSHROOMS_PER_HARVEST).abs() <= f64::EPSILON);
    step_food_supplier(
        ctx,
        tick,
        clock,
        building,
        &["berries", "mushrooms"],
        BERRIES_PER_HARVEST,
        1.0,
        true,
    );
}

pub fn step_fishing_camp(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    building: Building,
) {
    step_food_supplier(
        ctx,
        tick,
        clock,
        building,
        &["fish"],
        FISH_PER_HARVEST,
        1.0,
        false,
    );
}

fn step_food_supplier(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    building: Building,
    node_kinds: &[&str],
    resource_units_per_harvest: f64,
    food_per_resource_unit: f64,
    gathers_remedies: bool,
) {
    if labor_and_logistics_paused(ctx, tick, building.owner, clock) {
        return;
    }

    let Some(def) = building_def(&building.kind) else {
        return;
    };
    let network = tick.road_network(building.owner);

    let mut supplier = building;
    let onsite_labor = onsite_building_labor(ctx, &supplier);
    if onsite_labor > 0 {
        supplier.action_cooldown = (supplier.action_cooldown - TICK_DT).max(0.0);
    }
    let harvest_ready = onsite_labor > 0 && supplier.action_cooldown <= 0.0;
    let has_delivery_stock =
        gathers_remedies && building_commodity_stock(&supplier, CommodityKind::Remedies) > 1e-6;
    let delivery_ready = network.is_some()
        && available_free_haulers(ctx, supplier.owner) > 0
        && delivery_work_ready(1, has_delivery_stock, supplier.id, ctx);

    let remedy_target = if delivery_ready
        && gathers_remedies
        && building_commodity_stock(&supplier, CommodityKind::Remedies) > 1e-6
    {
        collect_remedy_target(
            ctx,
            tick,
            network.expect("delivery readiness requires a road network"),
            &supplier,
        )
    } else {
        None
    };
    if harvest_ready {
        supplier = harvest_from_node(
            ctx,
            supplier,
            node_kinds,
            resource_units_per_harvest,
            food_per_resource_unit,
            onsite_labor,
            clock.month,
            gathers_remedies,
        );
        supplier.action_cooldown = def.action_interval;
    }
    if delivery_ready {
        if let Some(network) = network {
            if let Some(residence) = remedy_target.as_ref() {
                try_start_remedy_delivery_trip(
                    ctx,
                    tick,
                    clock,
                    network,
                    &mut supplier,
                    residence,
                    1,
                );
            }
        }
    }

    ctx.db.building().id().update(supplier);
}

fn harvest_from_node(
    ctx: &ReducerContext,
    building: Building,
    node_kinds: &[&str],
    resource_units_per_harvest: f64,
    food_per_resource_unit: f64,
    workers: u32,
    month: u32,
    gathers_remedies: bool,
) -> Building {
    if workers == 0 {
        return building;
    }

    let Some(node) = find_nearest_harvestable_node(ctx, &building, node_kinds, month) else {
        return building;
    };
    let food_commodity = match node.node_kind.as_str() {
        "game" => CommodityKind::Meat,
        "fish" => CommodityKind::Fish,
        "berries" => CommodityKind::Berries,
        "mushrooms" => CommodityKind::Mushrooms,
        _ => return building,
    };
    let food_room = building_commodity_room(&building, food_commodity);
    if food_room <= 1e-6 {
        return building;
    }

    let labor = workers as f64;
    let richness_multiplier = harvest_yield_multiplier(&node.node_kind, node.max_yield);
    let requested = resource_units_per_harvest * richness_multiplier * labor;
    let max_resource_for_room = food_room / food_per_resource_unit.max(1e-9);
    let available = harvestable_wild_stock(
        &node.node_kind,
        node.remaining,
        node.max_yield,
        building.harvest_reserve_percent,
    );
    let extracted = requested.min(available).min(max_resource_for_room);
    if extracted <= 0.0 {
        return building;
    }

    ctx.db.foraging_node().node_id().update(ForagingNode {
        remaining: (node.remaining - extracted).max(0.0),
        respawn_cooldown: 0.0,
        ..node
    });

    let produced_food = extracted * food_per_resource_unit;
    let mut updated_building = building;
    let deposited =
        deposit_building_commodity(&mut updated_building, food_commodity, produced_food);
    if deposited <= 0.0 {
        return updated_building;
    }
    if gathers_remedies
        && (FORAGER_REMEDY_SEASON_START_MONTH as u32..=FORAGER_REMEDY_SEASON_END_MONTH as u32)
            .contains(&month)
    {
        let remedy_output =
            extracted / resource_units_per_harvest.max(1e-9) * FORAGER_REMEDIES_PER_HARVEST;
        deposit_building_commodity(
            &mut updated_building,
            CommodityKind::Remedies,
            remedy_output,
        );
    }
    updated_building
}

fn collect_remedy_target(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    network: &crate::roads::RoadNetwork,
    supplier: &Building,
) -> Option<Residence> {
    let targets = ctx
        .db
        .residence()
        .owner()
        .filter(&supplier.owner)
        .filter(|residence| !tick.residence_disabled_by_fire(ctx, residence.id))
        .collect::<Vec<_>>();
    select_residence_for_remedy_delivery(network, supplier, targets, |residence_id| {
        residence_has_inbound_remedy_trip(ctx, residence_id)
    })
}

fn find_nearest_harvestable_node(
    ctx: &ReducerContext,
    building: &Building,
    node_kinds: &[&str],
    month: u32,
) -> Option<ForagingNode> {
    let mut nearest: Option<ForagingNode> = None;
    let mut nearest_distance = f64::INFINITY;
    for node_kind in node_kinds {
        if !harvest_available(node_kind, month) {
            continue;
        }
        let Some(node) = find_nearest_harvestable_foraging_node(
            ctx,
            building.x,
            building.z,
            building.work_radius,
            node_kind,
            building.harvest_reserve_percent,
        ) else {
            continue;
        };
        let distance = (node.x - building.x).hypot(node.z - building.z);
        if distance < nearest_distance {
            nearest_distance = distance;
            nearest = Some(node);
        }
    }
    nearest
}
