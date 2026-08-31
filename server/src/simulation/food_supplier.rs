use spacetimedb::ReducerContext;

use crate::balance_generated::{
    FORAGER_REMEDIES_PER_HARVEST, FORAGER_REMEDY_SEASON_END_MONTH,
    FORAGER_REMEDY_SEASON_START_MONTH, GAME_PELTS_PER_ANIMAL, KENNEL_DOG_HUNTING_RATE_BONUS,
    KENNEL_DOG_MAX_PER_HUNTERS_HALL,
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
use crate::reducers::kennel_dogs::GUARD_DOG_FACTION;
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
        let wild_harvest_multiplier =
            if matches!(supplier.kind.as_str(), "hunters_hall" | "foragers_shed") {
                tick.land_use_profile(ctx)
                    .woodland_wild_harvest_multiplier()
            } else {
                1.0
            };
        let hunting_dog_multiplier = if supplier.kind == "hunters_hall" {
            let posted_dogs = ctx
                .db
                .combat_agent()
                .assigned_building_id()
                .filter(&supplier.id)
                .filter(|agent| {
                    agent.faction == GUARD_DOG_FACTION
                        && agent.source_building_id > 0
                        && agent.health > 0.0
                })
                .count()
                .min(KENNEL_DOG_MAX_PER_HUNTERS_HALL as usize);
            1.0 + posted_dogs as f64 * KENNEL_DOG_HUNTING_RATE_BONUS
        } else {
            1.0
        };
        supplier.action_cooldown = (supplier.action_cooldown
            - TICK_DT * wild_harvest_multiplier * hunting_dog_multiplier)
            .max(0.0);
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
        let (harvested, committed) = harvest_from_node(
            ctx,
            supplier,
            node_kinds,
            resource_units_per_harvest,
            food_per_resource_unit,
            onsite_labor,
            clock.month,
            gathers_remedies,
        );
        supplier = harvested;
        if committed {
            supplier.action_cooldown = def.action_interval;
        }
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
) -> (Building, bool) {
    if workers == 0 {
        return (building, false);
    }

    let Some(node) = find_nearest_harvestable_node(ctx, &building, node_kinds, month) else {
        return (building, false);
    };
    let food_commodity = match node.node_kind.as_str() {
        "game" => CommodityKind::Meat,
        "fish" => CommodityKind::Fish,
        "berries" => CommodityKind::Berries,
        "mushrooms" => CommodityKind::Mushrooms,
        _ => return (building, false),
    };
    let food_room = building_commodity_room(&building, food_commodity);
    if food_room <= 1e-6 {
        return (building, false);
    }

    let labor = f64::from(workers);
    let richness_multiplier = harvest_yield_multiplier(&node.node_kind, node.max_yield);
    let requested = crate::resource_units::whole_units(
        resource_units_per_harvest * richness_multiplier * labor,
    );
    let food_per_resource_unit = crate::resource_units::whole_cost(food_per_resource_unit);
    let max_resource_for_room = (food_room / food_per_resource_unit.max(1.0)).floor();
    let available = crate::resource_units::whole_units(harvestable_wild_stock(
        &node.node_kind,
        node.remaining,
        node.max_yield,
        building.harvest_reserve_percent,
    ));
    let mut extracted = requested.min(available).min(max_resource_for_room);
    if node.node_kind == "game" {
        let pelts_per_animal = crate::resource_units::whole_cost(GAME_PELTS_PER_ANIMAL);
        let pelt_room = building_commodity_room(&building, CommodityKind::Pelts);
        extracted = extracted.min((pelt_room / pelts_per_animal.max(1.0)).floor());
    }
    if gathers_remedies
        && (FORAGER_REMEDY_SEASON_START_MONTH as u32..=FORAGER_REMEDY_SEASON_END_MONTH as u32)
            .contains(&month)
    {
        let harvest_batch = crate::resource_units::whole_cost(resource_units_per_harvest);
        let remedy_batch = crate::resource_units::whole_cost(FORAGER_REMEDIES_PER_HARVEST);
        let remedy_room = building_commodity_room(&building, CommodityKind::Remedies);
        let complete_batches = (extracted / harvest_batch.max(1.0)).floor();
        let batches_that_fit = (remedy_room / remedy_batch.max(1.0)).floor();
        extracted = extracted.min(batches_that_fit.min(complete_batches) * harvest_batch);
    }
    if extracted < 1.0 {
        return (building, false);
    }

    let harvested_game = node.node_kind == "game";
    let produced_food = extracted * food_per_resource_unit;
    let original_building = building.clone();
    let mut updated_building = building;
    let deposited =
        deposit_building_commodity(&mut updated_building, food_commodity, produced_food);
    if deposited != produced_food {
        return (original_building, false);
    }
    if gathers_remedies
        && (FORAGER_REMEDY_SEASON_START_MONTH as u32..=FORAGER_REMEDY_SEASON_END_MONTH as u32)
            .contains(&month)
    {
        let remedy_output =
            extracted / resource_units_per_harvest.max(1e-9) * FORAGER_REMEDIES_PER_HARVEST;
        let remedy_output = crate::resource_units::whole_units(remedy_output);
        if deposit_building_commodity(
            &mut updated_building,
            CommodityKind::Remedies,
            remedy_output,
        ) != remedy_output
        {
            return (original_building, false);
        }
    }
    if harvested_game {
        let pelt_output = extracted * crate::resource_units::whole_cost(GAME_PELTS_PER_ANIMAL);
        if deposit_building_commodity(&mut updated_building, CommodityKind::Pelts, pelt_output)
            != pelt_output
        {
            return (original_building, false);
        }
    }
    ctx.db.foraging_node().node_id().update(ForagingNode {
        remaining: (crate::resource_units::whole_units(node.remaining) - extracted).max(0.0),
        respawn_cooldown: 0.0,
        ..node
    });
    (updated_building, true)
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
