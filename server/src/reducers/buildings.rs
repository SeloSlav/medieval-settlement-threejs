use spacetimedb::{reducer, ReducerContext, Table};

use crate::db::*;
use crate::constants::REFORESTER_RADIUS;
use crate::economy::{building_cost, building_salvage_refund, credit, spend};
use crate::lifecycle::ensure_player_resources;
use crate::simulation::building_params;
use crate::tables::{Building, PlayerResources, WorldConfig};

fn is_within_existing_reforester_radius(ctx: &ReducerContext, x: f64, z: f64) -> bool {
    for building in ctx.db.building().iter() {
        if building.kind != "reforester" {
            continue;
        }
        let dx = building.x - x;
        let dz = building.z - z;
        let radius = building.work_radius.max(REFORESTER_RADIUS);
        if dx * dx + dz * dz < radius * radius {
            return true;
        }
    }
    false
}

fn player_resources_amount(resources: &PlayerResources) -> crate::economy::ResourceAmount {
    crate::economy::ResourceAmount {
        wood: resources.wood,
        stone: resources.stone,
    }
}

fn update_player_resources(ctx: &ReducerContext, owner: spacetimedb::Identity, amount: crate::economy::ResourceAmount) {
    if let Some(existing) = ctx.db.player_resources().owner().find(&owner) {
        ctx.db.player_resources().owner().update(PlayerResources {
            wood: amount.wood,
            stone: amount.stone,
            ..existing
        });
    }
}

#[reducer]
pub fn place_building(ctx: &ReducerContext, kind: String, x: f64, z: f64) -> Result<(), String> {
    let (work_radius, _) = building_params(&kind)?;
    let owner = ctx.sender();
    ensure_player_resources(ctx, owner);

    if kind == "reforester" && is_within_existing_reforester_radius(ctx, x, z) {
        return Err("Within an existing reforester hut's work area.".to_string());
    }

    let cost = building_cost(&kind)?;
    let resources = ctx
        .db
        .player_resources()
        .owner()
        .find(&owner)
        .ok_or_else(|| "Player resources not found.".to_string())?;
    let mut amount = player_resources_amount(&resources);
    spend(&mut amount, &cost)?;
    update_player_resources(ctx, owner, amount);

    let config = ctx
        .db
        .world_config()
        .id()
        .find(&0)
        .ok_or_else(|| "World not initialized.".to_string())?;

    let building_id = config.next_building_id;
    ctx.db.building().insert(Building {
        id: 0,
        owner,
        kind,
        x,
        z,
        work_radius,
        action_cooldown: 0.0,
    });

    ctx.db.world_config().id().update(WorldConfig {
        next_building_id: building_id + 1,
        ..config
    });

    Ok(())
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

    let refund = building_salvage_refund(&building.kind)?;
    let resources = ctx
        .db
        .player_resources()
        .owner()
        .find(&owner)
        .ok_or_else(|| "Player resources not found.".to_string())?;
    let mut amount = player_resources_amount(&resources);
    credit(&mut amount, &refund);
    update_player_resources(ctx, owner, amount);

    ctx.db.building().id().delete(building_id);

    Ok(())
}
