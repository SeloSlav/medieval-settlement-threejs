use spacetimedb::{reducer, ReducerContext};

use crate::balance_generated::{
    CARPENTER_TIMBER_COST_MULTIPLIER, FIRE_RESOLVED_RETENTION_SECONDS, RESIDENCE_STONE_COST,
    RESIDENCE_TIER2_STONE_COST, RESIDENCE_TIER2_TIMBER_COST, RESIDENCE_TIER3_STONE_COST,
    RESIDENCE_TIER3_TIMBER_COST, RESIDENCE_TIMBER_COST, TICK_DT,
};
use crate::construction_priority::CONSTRUCTION_PRIORITY_URGENT;
use crate::db::*;
use crate::economy::{
    available_building_labor, building_cost, construction_treasury_reservation_excluding_building,
    guardhouse_roster_count, initial_construction_labor, reconcile_building_labor,
    spend_aggregate_stone, spend_aggregate_timber, total_stone, total_timber, CommodityKind,
};
use crate::fire_recovery_policy::{fire_recovery_cost, FireRecoveryCost};
use crate::lifecycle::ensure_player_resources;
use crate::reducers::residences::ensure_upgrade_source_route;
use crate::roads::load_owner_road_network;
use crate::simulation::{
    building_fire_state, cancel_trips_for_residence, clear_fire_for_target,
    clear_residence_project, ensure_residence_needs, FIRE_STATE_BURNING, FIRE_STATE_DESTROYED,
    FIRE_TARGET_BUILDING, FIRE_TARGET_RESIDENCE,
};
use crate::tables::{Building, FireIncident, Residence};

#[reducer]
pub fn repair_fire_damage(
    ctx: &ReducerContext,
    target_kind: u8,
    target_id: u64,
) -> Result<(), String> {
    let owner = ctx.sender();
    ensure_player_resources(ctx, owner);
    let incident = ctx
        .db
        .fire_incident()
        .target_id()
        .filter(&target_id)
        .find(|incident| incident.target_kind == target_kind)
        .ok_or_else(|| "No fire damage remains at this structure.".to_string())?;
    if incident.owner != owner {
        return Err("You do not own this fire-damaged structure.".to_string());
    }
    if incident.state == FIRE_STATE_BURNING {
        return Err("The fire must be extinguished before repairs can begin.".to_string());
    }
    ensure_cooled(ctx, &incident)?;

    match target_kind {
        FIRE_TARGET_BUILDING => repair_building(ctx, owner, incident),
        FIRE_TARGET_RESIDENCE => repair_residence(ctx, owner, incident),
        _ => Err("Unknown fire-damaged structure kind.".to_string()),
    }
}

fn ensure_cooled(ctx: &ReducerContext, incident: &FireIncident) -> Result<(), String> {
    let sim_tick = ctx
        .db
        .world_config()
        .id()
        .find(&0)
        .map_or(0, |config| config.sim_tick);
    let retention_ticks = (FIRE_RESOLVED_RETENTION_SECONDS / TICK_DT).ceil() as u64;
    let elapsed = sim_tick.saturating_sub(incident.resolved_tick);
    if elapsed >= retention_ticks {
        return Ok(());
    }
    let seconds = ((retention_ticks - elapsed) as f64 * TICK_DT).ceil() as u64;
    Err(format!(
        "The structure is still cooling; repairs can begin in about {seconds} seconds."
    ))
}

fn repair_building(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    incident: FireIncident,
) -> Result<(), String> {
    let mut building = ctx
        .db
        .building()
        .id()
        .find(&incident.target_id)
        .ok_or_else(|| "Fire-damaged building not found.".to_string())?;
    if building.owner != owner {
        return Err("You do not own this fire-damaged building.".to_string());
    }
    if !building.construction_complete {
        return Err("This building is already being reconstructed.".to_string());
    }
    if building.kind == "guardhouse" && guardhouse_roster_count(ctx, owner, building.id) > 0 {
        return Err(
            "This company still has guards deployed, returning, or recovering; begin reconstruction after every guard has returned and recovered.".to_string(),
        );
    }

    let base = building_cost(&building.kind)?;
    let timber_multiplier = if has_operational_carpenter_support(ctx, owner, &building) {
        CARPENTER_TIMBER_COST_MULTIPLIER
    } else {
        1.0
    };
    let cost = fire_recovery_cost(
        base.timber,
        base.stone,
        incident.damage,
        incident.state == FIRE_STATE_DESTROYED,
        timber_multiplier,
    );
    ensure_recovery_resources(ctx, owner, cost)?;

    let onsite_timber = building.timber.min(cost.timber);
    let onsite_stone = building.stone.min(cost.stone);
    let remaining_timber = (cost.timber - onsite_timber).max(0.0);
    let remaining_stone = (cost.stone - onsite_stone).max(0.0);
    let (treasury_timber, treasury_stone) = construction_treasury_reservation_excluding_building(
        ctx,
        owner,
        remaining_timber,
        remaining_stone,
        building.id,
    );
    let available_for_repair =
        available_building_labor(ctx, owner).saturating_add(building.assigned_labor);

    building.timber -= onsite_timber;
    building.stone -= onsite_stone;
    building.assigned_labor = initial_construction_labor(available_for_repair);
    building.action_cooldown = 0.0;
    building.construction_complete = false;
    building.construction_progress = 0.0;
    building.construction_required_timber = cost.timber;
    building.construction_required_stone = cost.stone;
    building.construction_delivered_timber = onsite_timber;
    building.construction_delivered_stone = onsite_stone;
    building.construction_reserved_timber = remaining_timber;
    building.construction_reserved_stone = remaining_stone;
    building.construction_treasury_timber = treasury_timber;
    building.construction_treasury_stone = treasury_stone;
    ctx.db.building().id().update(building);
    clear_fire_for_target(ctx, FIRE_TARGET_BUILDING, incident.target_id);
    Ok(())
}

fn repair_residence(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    incident: FireIncident,
) -> Result<(), String> {
    let mut residence = ctx
        .db
        .residence()
        .id()
        .find(&incident.target_id)
        .ok_or_else(|| "Fire-damaged residence not found.".to_string())?;
    if residence.owner != owner {
        return Err("You do not own this fire-damaged residence.".to_string());
    }
    if residence.fire_repair_active {
        return Err("Homestead recovery is already underway.".to_string());
    }

    let (base_timber, base_stone) = residence_structural_cost(&residence);
    let timber_multiplier = if has_operational_carpenter_support(ctx, owner, &residence) {
        CARPENTER_TIMBER_COST_MULTIPLIER
    } else {
        1.0
    };
    let cost = fire_recovery_cost(
        base_timber,
        base_stone,
        incident.damage,
        incident.state == FIRE_STATE_DESTROYED,
        timber_multiplier,
    );
    let physical_economy = ctx
        .db
        .player_resources()
        .owner()
        .find(&owner)
        .is_some_and(|resources| resources.physical_founding_site_enabled);
    if physical_economy {
        // Fire invalidates any unfinished household improvement. Incoming
        // carts return to their source, onsite material is part of the loss,
        // and its reservations are released before the recovery quote is
        // checked. Reducer transactions roll this preparation back on error.
        cancel_trips_for_residence(ctx, residence.id);
        clear_residence_project(&mut residence);
        ctx.db.residence().id().update(residence.clone());

        ensure_recovery_resources(ctx, owner, cost)?;
        let network = load_owner_road_network(ctx, owner).ok_or_else(|| {
            "Homestead recovery requires a road-linked material source.".to_string()
        })?;
        ensure_upgrade_source_route(
            ctx,
            &network,
            &residence,
            CommodityKind::Timber,
            cost.timber,
        )?;
        ensure_upgrade_source_route(ctx, &network, &residence, CommodityKind::Stone, cost.stone)?;

        residence.abandoned = false;
        residence.settlement_ticks = 0;
        residence.fire_repair_active = true;
        residence.upgrade_progress = 0.0;
        residence.upgrade_required_timber = cost.timber;
        residence.upgrade_required_stone = cost.stone;
        residence.upgrade_required_gold = 0.0;
        residence.upgrade_delivered_timber = 0.0;
        residence.upgrade_delivered_stone = 0.0;
        residence.upgrade_delivered_gold = 0.0;
        residence.upgrade_reserved_timber = cost.timber;
        residence.upgrade_reserved_stone = cost.stone;
        residence.upgrade_reserved_gold = 0.0;
        residence.upgrade_assigned_labor = available_building_labor(ctx, owner).min(1);
        residence.upgrade_priority = CONSTRUCTION_PRIORITY_URGENT;
        if incident.state == FIRE_STATE_DESTROYED {
            residence.population = 0;
        }
        ctx.db.residence().id().update(residence);
        if incident.state == FIRE_STATE_DESTROYED {
            reconcile_building_labor(ctx, owner);
        }
        return Ok(());
    }

    ensure_recovery_resources(ctx, owner, cost)?;
    spend_aggregate_timber(ctx, owner, cost.timber)?;
    spend_aggregate_stone(ctx, owner, cost.stone)?;

    if incident.state == FIRE_STATE_DESTROYED {
        residence.population = 0;
        residence.abandoned = false;
        residence.settlement_ticks = 0;
    }
    ctx.db.residence().id().update(residence.clone());
    ensure_residence_needs(ctx, residence.id);
    if incident.state == FIRE_STATE_DESTROYED {
        reconcile_building_labor(ctx, owner);
    }
    clear_fire_for_target(ctx, FIRE_TARGET_RESIDENCE, incident.target_id);
    Ok(())
}

fn residence_structural_cost(residence: &Residence) -> (f64, f64) {
    let mut timber = RESIDENCE_TIMBER_COST;
    let mut stone = RESIDENCE_STONE_COST;
    if residence.tier >= 2 {
        timber += RESIDENCE_TIER2_TIMBER_COST;
        stone += RESIDENCE_TIER2_STONE_COST;
    }
    if residence.tier >= 3 {
        timber += RESIDENCE_TIER3_TIMBER_COST;
        stone += RESIDENCE_TIER3_STONE_COST;
    }
    (timber, stone)
}

fn ensure_recovery_resources(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    cost: FireRecoveryCost,
) -> Result<(), String> {
    if total_timber(ctx, owner) + 1e-6 < cost.timber {
        return Err(format!(
            "Not enough timber for repairs (need {:.1}).",
            cost.timber
        ));
    }
    if total_stone(ctx, owner) + 1e-6 < cost.stone {
        return Err(format!(
            "Not enough stone for repairs (need {:.1}).",
            cost.stone
        ));
    }
    Ok(())
}

fn has_operational_carpenter_support(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    target: &impl Positioned,
) -> bool {
    let Some(network) = load_owner_road_network(ctx, owner) else {
        return false;
    };
    ctx.db.building().owner().filter(&owner).any(|shop| {
        shop.kind == "carpenter"
            && shop.construction_complete
            && shop.assigned_labor > 0
            && building_fire_state(ctx, shop.id).is_none()
            && network
                .road_path_distance(target.x(), target.z(), shop.x, shop.z)
                .is_some()
    })
}

trait Positioned {
    fn x(&self) -> f64;
    fn z(&self) -> f64;
}

impl Positioned for Building {
    fn x(&self) -> f64 {
        self.x
    }

    fn z(&self) -> f64 {
        self.z
    }
}

impl Positioned for Residence {
    fn x(&self) -> f64 {
        self.x
    }

    fn z(&self) -> f64 {
        self.z
    }
}
