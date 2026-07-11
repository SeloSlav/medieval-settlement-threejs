use spacetimedb::{reducer, ReducerContext, Table};

use crate::building_defs::{building_def, building_def_or_err};
use crate::db::*;
use crate::economy::{
    assign_building_labor as set_building_labor, building_cost, building_salvage_refund,
    chapel_coffer_gold, collect_chapel_coffer as sweep_chapel_coffer, credit_treasury_firewood,
    credit_treasury_food, credit_treasury_gold, credit_treasury_stone, credit_treasury_timber,
    credit_treasury_water, spend_aggregate_stone, spend_aggregate_timber, total_stone, total_timber,
};
use crate::lifecycle::ensure_player_resources;
use crate::hydrology::{sample_hydrology_score, well_capacity_from_hydrology};
use crate::placement_validation::{building_overlaps_residence_zone, building_overlaps_road_surface, is_on_quarry_pit};
use crate::roads::has_building_road_access;
use crate::simulation::drain_trips_for_building;
use crate::tables::{Building, WorldConfig};

fn is_within_same_kind_work_radius(ctx: &ReducerContext, kind: &str, x: f64, z: f64) -> bool {
    for building in ctx.db.building().iter() {
        if building.kind != kind || building.work_radius <= 0.0 {
            continue;
        }
        let dx = building.x - x;
        let dz = building.z - z;
        if dx * dx + dz * dz < building.work_radius * building.work_radius {
            return true;
        }
    }
    false
}

fn is_too_close_to_buildings(ctx: &ReducerContext, kind: &str, x: f64, z: f64) -> bool {
    let Some(candidate) = building_def(kind) else {
        return false;
    };
    let min_separation = candidate.pick_radius * 1.85;

    for building in ctx.db.building().iter() {
        let Some(other) = building_def(&building.kind) else {
            continue;
        };
        let required = min_separation.max((candidate.pick_radius + other.pick_radius) * 0.9);
        let dx = building.x - x;
        let dz = building.z - z;
        if dx * dx + dz * dz < required * required {
            return true;
        }
    }
    false
}

fn has_mature_tree_in_radius(ctx: &ReducerContext, x: f64, z: f64, radius: f64) -> bool {
    let radius_sq = radius * radius;
    for tree in ctx.db.tree_entity().iter() {
        if tree.phase != "mature" {
            continue;
        }
        let dx = tree.x - x;
        let dz = tree.z - z;
        if dx * dx + dz * dz <= radius_sq {
            return true;
        }
    }
    false
}

fn has_quarry_stone_in_radius(ctx: &ReducerContext, x: f64, z: f64, radius: f64) -> bool {
    let radius_sq = radius * radius;
    for quarry in ctx.db.quarry().iter() {
        if quarry.remaining <= 0.0 {
            continue;
        }
        let dx = quarry.x - x;
        let dz = quarry.z - z;
        if dx * dx + dz * dz <= radius_sq {
            return true;
        }
    }
    false
}

fn has_foraging_in_radius(
    ctx: &ReducerContext,
    x: f64,
    z: f64,
    radius: f64,
    node_kind: &str,
) -> bool {
    let radius_sq = radius * radius;
    for node in ctx.db.foraging_node().iter() {
        if node.node_kind != node_kind || node.remaining <= 0.0 {
            continue;
        }
        let dx = node.x - x;
        let dz = node.z - z;
        if dx * dx + dz * dz <= radius_sq {
            return true;
        }
    }
    false
}

#[reducer]
pub fn place_building(ctx: &ReducerContext, kind: String, x: f64, z: f64) -> Result<(), String> {
    let def = building_def_or_err(&kind)?;
    let owner = ctx.sender();
    ensure_player_resources(ctx, owner);

    if !def.requires_quarry_stone && is_on_quarry_pit(ctx, x, z) {
        return Err("Cannot build on a quarry pit.".to_string());
    }

    if building_overlaps_residence_zone(ctx, &kind, x, z) {
        return Err("Cannot build inside a residence plot.".to_string());
    }

    if building_overlaps_road_surface(ctx, owner, &kind, x, z) {
        return Err("Cannot build on a road.".to_string());
    }

    if is_within_same_kind_work_radius(ctx, &kind, x, z) {
        return Err("Another building of the same type already covers this area.".to_string());
    }

    if def.requires_mature_trees && !has_mature_tree_in_radius(ctx, x, z, def.work_radius) {
        return Err("No mature trees within work range.".to_string());
    }

    if def.requires_quarry_stone && !has_quarry_stone_in_radius(ctx, x, z, def.work_radius) {
        return Err("No quarry stone within work range.".to_string());
    }

    if def.requires_game && !has_foraging_in_radius(ctx, x, z, def.work_radius, "game") {
        return Err("No game within work range.".to_string());
    }

    if def.requires_berries && !has_foraging_in_radius(ctx, x, z, def.work_radius, "berries") {
        return Err("No berries within work range.".to_string());
    }

    if is_too_close_to_buildings(ctx, &kind, x, z) {
        return Err("Too close to another building.".to_string());
    }

    if def.requires_road && !has_building_road_access(ctx, owner, x, z) {
        return Err("Building must be placed near a road.".to_string());
    }

    if kind == "well" && sample_hydrology_score(x, z) >= 0.999 {
        return Err("Cannot build a well on open water.".to_string());
    }

    let cost = building_cost(&kind)?;
    if total_timber(ctx, owner) + 1e-6 < cost.timber {
        return Err(format!(
            "Not enough timber (need {} timber).",
            cost.timber.round() as i64
        ));
    }
    if total_stone(ctx, owner) + 1e-6 < cost.stone {
        return Err(format!(
            "Not enough stone (need {} stone).",
            cost.stone.round() as i64
        ));
    }
    spend_aggregate_timber(ctx, owner, cost.timber)?;
    spend_aggregate_stone(ctx, owner, cost.stone)?;

    let config = ctx
        .db
        .world_config()
        .id()
        .find(&0)
        .ok_or_else(|| "World not initialized.".to_string())?;

    let hydrology = if kind == "well" {
        sample_hydrology_score(x, z)
    } else {
        0.0
    };
    let water_capacity = if kind == "well" {
        well_capacity_from_hydrology(def.storage_water, hydrology)
    } else {
        0.0
    };

    let building_id = config.next_building_id;
    ctx.db.building().insert(Building {
        id: 0,
        owner,
        kind,
        x,
        z,
        work_radius: def.work_radius,
        action_cooldown: 0.0,
        timber: 0.0,
        firewood: 0.0,
        stone: 0.0,
        water: 0.0,
        food: 0.0,
        water_capacity,
        assigned_labor: 0,
        gold: 0.0,
    });

    ctx.db.world_config().id().update(WorldConfig {
        next_building_id: building_id + 1,
        ..config
    });

    Ok(())
}

#[reducer]
pub fn assign_building_labor(
    ctx: &ReducerContext,
    building_id: u64,
    labor: u32,
) -> Result<(), String> {
    let owner = ctx.sender();
    ensure_player_resources(ctx, owner);
    set_building_labor(ctx, owner, building_id, labor)
}

#[reducer]
pub fn collect_chapel_coffer(ctx: &ReducerContext, building_id: u64) -> Result<(), String> {
    let owner = ctx.sender();
    ensure_player_resources(ctx, owner);
    sweep_chapel_coffer(ctx, owner, building_id).map(|_| ())
}

#[reducer]
pub fn demolish_building(ctx: &ReducerContext, building_id: u64) -> Result<(), String> {
    let owner = ctx.sender();
    ensure_player_resources(ctx, owner);

    let building = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Building not found.".to_string())?;

    if building.owner != owner {
        return Err("You do not own this building.".to_string());
    }

    let trip_cargo = drain_trips_for_building(ctx, building_id);

    let refund = building_salvage_refund(&building.kind)?;
    credit_treasury_timber(ctx, owner, refund.timber + building.timber);
    credit_treasury_stone(ctx, owner, refund.stone + building.stone);
    credit_treasury_firewood(ctx, owner, building.firewood + trip_cargo.firewood);
    credit_treasury_water(ctx, owner, building.water + trip_cargo.water);
    credit_treasury_food(ctx, owner, building.food + trip_cargo.food);
    credit_treasury_gold(ctx, owner, chapel_coffer_gold(&building));

    ctx.db.building().id().delete(building_id);

    Ok(())
}
