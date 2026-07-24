use spacetimedb::{reducer, Identity, ReducerContext};

use crate::db::*;
use crate::tables::{
    farm_field, livestock_herd, pasture, BackyardGarden, Building, BurgageZone, DeliveryTrip,
    FarmField, FireIncident, LivestockHerd, Pasture, ResidenceNeed, WorldConfig,
};
use crate::world_entities::clear_global_world_entities;

#[reducer]
pub fn reset_world(ctx: &ReducerContext) -> Result<(), String> {
    let owner = ctx.sender();
    clear_owner_settlement(ctx, owner);
    clear_global_world_entities(ctx);
    reset_world_progress(ctx);
    Ok(())
}

fn clear_owner_settlement(ctx: &ReducerContext, owner: Identity) {
    for pasture in ctx
        .db
        .pasture()
        .iter()
        .filter(|pasture| pasture.owner == owner)
        .collect::<Vec<Pasture>>()
    {
        ctx.db.pasture().id().delete(pasture.id);
    }
    for herd in ctx
        .db
        .livestock_herd()
        .iter()
        .filter(|herd| herd.owner == owner)
        .collect::<Vec<LivestockHerd>>()
    {
        ctx.db.livestock_herd().building_id().delete(&herd.building_id);
    }
    for field in ctx
        .db
        .farm_field()
        .iter()
        .filter(|field| field.owner == owner)
        .collect::<Vec<FarmField>>()
    {
        ctx.db.farm_field().id().delete(field.id);
    }
    for trip in ctx.db.delivery_trip().iter().collect::<Vec<DeliveryTrip>>() {
        if trip.owner != owner {
            continue;
        }
        ctx.db.delivery_trip().id().delete(trip.id);
    }
    for incident in ctx
        .db
        .fire_incident()
        .owner()
        .filter(&owner)
        .collect::<Vec<FireIncident>>()
    {
        ctx.db.fire_incident().id().delete(incident.id);
    }

    let residence_ids: Vec<u64> = ctx
        .db
        .residence()
        .iter()
        .filter(|residence| residence.owner == owner)
        .map(|residence| residence.id)
        .collect();

    for residence_id in residence_ids {
        for need in ctx
            .db
            .residence_need()
            .iter()
            .filter(|need| need.residence_id == residence_id)
            .collect::<Vec<ResidenceNeed>>()
        {
            ctx.db.residence_need().id().delete(need.id);
        }

        for garden in ctx
            .db
            .backyard_garden()
            .iter()
            .filter(|garden| garden.residence_id == residence_id)
            .collect::<Vec<BackyardGarden>>()
        {
            ctx.db.backyard_garden().id().delete(garden.id);
        }

        ctx.db.residence().id().delete(residence_id);
    }

    for zone in ctx
        .db
        .burgage_zone()
        .iter()
        .filter(|zone| zone.owner == owner)
        .collect::<Vec<BurgageZone>>()
    {
        ctx.db.burgage_zone().id().delete(zone.id);
    }

    for building in ctx
        .db
        .building()
        .iter()
        .filter(|building| building.owner == owner)
        .collect::<Vec<Building>>()
    {
        ctx.db.building().id().delete(building.id);
    }

    if ctx.db.road_network_state().owner().find(&owner).is_some() {
        ctx.db.road_network_state().owner().delete(&owner);
    }

    if ctx.db.player_resources().owner().find(&owner).is_some() {
        ctx.db.player_resources().owner().delete(&owner);
    }
}

fn reset_world_progress(ctx: &ReducerContext) {
    if let Some(pacing) = ctx.db.sim_pacing_state().id().find(&0) {
        ctx.db.sim_pacing_state().id().update(crate::tables::SimPacingState {
            step_credit: 0,
            ..pacing
        });
    }
    if let Some(config) = ctx.db.world_config().id().find(&0) {
        ctx.db.world_config().id().update(WorldConfig {
            sim_tick: 0,
            next_building_id: 1,
            game_speed: 1,
            configured: false,
            ..config
        });
    }
}
