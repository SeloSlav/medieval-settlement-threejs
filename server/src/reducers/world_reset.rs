use spacetimedb::{reducer, Identity, ReducerContext};

use crate::db::*;
use crate::tables::{
    active_raid, corpse, farm_field, graveyard, livestock_herd, pasture, pasture_herd,
    settlement_security, vineyard_parcel, BackyardGarden, Building, BurgageZone, CombatAgent,
    Corpse, DeliveryTrip, FarmField, FireIncident, Graveyard, LivestockHerd, Pasture, PastureHerd,
    ResidenceNeed, Settlement, StableOx, VineyardParcel, WorldConfig,
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
    for rule in ctx
        .db
        .trading_post_trade_rule()
        .owner()
        .filter(&owner)
        .collect::<Vec<_>>()
    {
        ctx.db.trading_post_trade_rule().id().delete(&rule.id);
    }
    for vineyard in ctx
        .db
        .vineyard_parcel()
        .owner()
        .filter(&owner)
        .collect::<Vec<VineyardParcel>>()
    {
        ctx.db.vineyard_parcel().id().delete(vineyard.id);
    }
    for agent in ctx
        .db
        .combat_agent()
        .owner()
        .filter(&owner)
        .collect::<Vec<CombatAgent>>()
    {
        ctx.db.combat_agent().id().delete(agent.id);
    }
    if ctx.db.active_raid().owner().find(&owner).is_some() {
        ctx.db.active_raid().owner().delete(&owner);
    }
    for corpse in ctx
        .db
        .corpse()
        .owner()
        .filter(&owner)
        .collect::<Vec<Corpse>>()
    {
        ctx.db.corpse().id().delete(corpse.id);
    }
    for graveyard in ctx
        .db
        .graveyard()
        .owner()
        .filter(&owner)
        .collect::<Vec<Graveyard>>()
    {
        ctx.db.graveyard().id().delete(graveyard.id);
    }
    for herd in ctx
        .db
        .pasture_herd()
        .owner()
        .filter(&owner)
        .collect::<Vec<PastureHerd>>()
    {
        ctx.db.pasture_herd().pasture_id().delete(&herd.pasture_id);
    }
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
        ctx.db
            .livestock_herd()
            .building_id()
            .delete(&herd.building_id);
    }
    for ox in ctx
        .db
        .stable_ox()
        .owner()
        .filter(&owner)
        .collect::<Vec<StableOx>>()
    {
        ctx.db.stable_ox().id().delete(ox.id);
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

    for settlement in ctx
        .db
        .settlement()
        .owner()
        .filter(&owner)
        .collect::<Vec<Settlement>>()
    {
        ctx.db.settlement().id().delete(settlement.id);
    }

    if ctx.db.road_network_state().owner().find(&owner).is_some() {
        ctx.db.road_network_state().owner().delete(&owner);
    }

    if ctx.db.player_resources().owner().find(&owner).is_some() {
        ctx.db.player_resources().owner().delete(&owner);
    }
    if ctx.db.settlement_security().owner().find(&owner).is_some() {
        ctx.db.settlement_security().owner().delete(&owner);
    }
}

fn reset_world_progress(ctx: &ReducerContext) {
    if let Some(pacing) = ctx.db.sim_pacing_state().id().find(&0) {
        ctx.db
            .sim_pacing_state()
            .id()
            .update(crate::tables::SimPacingState {
                step_credit: 0,
                ..pacing
            });
    }
    if let Some(config) = ctx.db.world_config().id().find(&0) {
        ctx.db.world_config().id().update(WorldConfig {
            sim_tick: 0,
            next_building_id: 1,
            game_speed: 1,
            conflict_enabled: false,
            enemy_pressure: 0,
            severe_weather_enabled: false,
            well_aquifer_networks_enabled: false,
            configured: false,
            ..config
        });
    }
}
