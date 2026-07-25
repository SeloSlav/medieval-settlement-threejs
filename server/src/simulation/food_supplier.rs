use spacetimedb::ReducerContext;

use crate::building_defs::building_def;
use crate::constants::{
    BERRIES_PER_HARVEST, FISH_PER_HARVEST, FOOD_DELIVERY_SPEED_MPS, FOOD_DELIVERY_UNLOAD_SEC,
    FOOD_PER_DELIVERY, GAME_ANIMALS_PER_HARVEST, GAME_PER_HARVEST, MUSHROOMS_PER_HARVEST,
    RICH_FISH_YIELD_MULTIPLIER, TICK_DT,
};
use crate::db::*;
use crate::economy::{building_food_storage_cap, deposit_building_food};
use crate::foraging_policy::harvest_available;
use crate::simulation::delivery_cargo::{
    any_target_needs_delivery, collect_claimed_delivery_targets,
};
use crate::simulation::delivery_supplier::{
    delivery_work_ready, dispatch_delivery_if_ready, should_alternate_single_worker,
    DeliveryDispatchConfig,
};
use crate::simulation::game_calendar::GameClock;
use crate::simulation::labor_and_logistics_paused;
use crate::simulation::lodge_logistics::lodge_labor_split;
use crate::simulation::residence_needs::{load_needs, need_stock, ResidenceNeedKind};
use crate::simulation::road_logistics::{
    claim_residences_for_food_suppliers, owner_food_suppliers, sort_residences_for_food_delivery,
};
use crate::simulation::spatial::find_nearest_foraging_node;
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
    );
}

pub fn step_fishing_camp(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    building: Building,
) {
    step_food_supplier(ctx, tick, clock, building, &["fish"], FISH_PER_HARVEST, 1.0);
}

fn step_food_supplier(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    building: Building,
    node_kinds: &[&str],
    resource_units_per_harvest: f64,
    food_per_resource_unit: f64,
) {
    if labor_and_logistics_paused(ctx, building.owner, clock) {
        return;
    }

    let Some(def) = building_def(&building.kind) else {
        return;
    };
    let network = tick.road_network(building.owner);

    let mut supplier = building;
    supplier.action_cooldown = (supplier.action_cooldown - TICK_DT).max(0.0);

    let split = lodge_labor_split(supplier.assigned_labor);
    let single_worker = supplier.assigned_labor == 1;
    let harvest_ready = split.processing > 0 && supplier.action_cooldown <= 0.0;
    let delivery_ready = network.is_some()
        && delivery_work_ready(split.delivering, supplier.food > 0.0, supplier.id, ctx);

    let delivery_targets = if delivery_ready {
        collect_delivery_targets(
            ctx,
            network.expect("delivery readiness requires a road network"),
            &supplier,
        )
    } else {
        Vec::new()
    };
    let has_target = any_target_needs_delivery(ctx, &delivery_targets, ResidenceNeedKind::Food);

    let (do_deliver, do_harvest) =
        should_alternate_single_worker(single_worker, harvest_ready, delivery_ready, has_target);

    if do_harvest {
        supplier = harvest_from_node(
            ctx,
            supplier,
            node_kinds,
            resource_units_per_harvest,
            food_per_resource_unit,
            split.processing,
            clock.month,
        );
        supplier.action_cooldown = def.action_interval;
    }
    if do_deliver {
        if let Some(network) = network {
            dispatch_delivery_if_ready(
                ctx,
                clock,
                network,
                &mut supplier,
                split.delivering,
                &delivery_targets,
                DeliveryDispatchConfig {
                    need_kind: ResidenceNeedKind::Food,
                    speed_mps: FOOD_DELIVERY_SPEED_MPS,
                    unload_seconds: FOOD_DELIVERY_UNLOAD_SEC,
                    per_delivery: FOOD_PER_DELIVERY,
                },
            );
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
) -> Building {
    if workers == 0 {
        return building;
    }

    let food_cap = building_food_storage_cap(&building.kind);
    if building.food >= food_cap - 1e-6 {
        return building;
    }

    let Some(node) = find_nearest_harvestable_node(ctx, &building, node_kinds, month) else {
        return building;
    };

    let labor = workers as f64;
    let richness_multiplier = if node.node_kind == "fish" && node.max_yield >= 200.0 {
        RICH_FISH_YIELD_MULTIPLIER
    } else {
        1.0
    };
    let requested = resource_units_per_harvest * richness_multiplier * labor;
    let food_room = (food_cap - building.food).max(0.0);
    let max_resource_for_room = food_room / food_per_resource_unit.max(1e-9);
    let extracted = requested.min(node.remaining).min(max_resource_for_room);
    if extracted <= 0.0 {
        return building;
    }

    ctx.db.foraging_node().node_id().update(ForagingNode {
        remaining: (node.remaining - extracted).max(0.0),
        respawn_cooldown: 0.0,
        ..node
    });

    let produced_food = extracted * food_per_resource_unit;
    let (deposited, updated_building) = deposit_building_food(&building, food_cap, produced_food);
    if deposited <= 0.0 {
        return building;
    }
    updated_building
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
        let Some(node) = find_nearest_foraging_node(
            ctx,
            building.x,
            building.z,
            building.work_radius,
            node_kind,
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

fn collect_delivery_targets(
    ctx: &ReducerContext,
    network: &crate::roads::RoadNetwork,
    supplier: &Building,
) -> Vec<Residence> {
    let suppliers = owner_food_suppliers(ctx, supplier.owner);
    let residences: Vec<Residence> = ctx.db.residence().owner().filter(&supplier.owner).collect();
    let claims = claim_residences_for_food_suppliers(network, &suppliers, &residences);

    collect_claimed_delivery_targets(residences, &claims, supplier.id, |targets| {
        sort_residences_for_food_delivery(network, supplier, targets, |residence| {
            need_stock(&load_needs(ctx, residence.id), ResidenceNeedKind::Food)
        });
    })
}
