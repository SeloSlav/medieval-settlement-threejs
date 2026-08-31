use spacetimedb::{reducer, ReducerContext};

use crate::balance_generated::{
    KENNEL_DOG_MAX_PER_HUNTERS_HALL, KENNEL_DOG_PURCHASE_GOLD, KENNEL_DOG_SLOTS,
};
use crate::db::*;
use crate::economy::spend_treasury_gold;
use crate::simulation::building_fire_state;
use crate::tables::CombatAgent;

pub const GUARD_DOG_FACTION: u8 = 12;

#[reducer]
pub fn purchase_kennel_dog(ctx: &ReducerContext, kennel_id: u64) -> Result<(), String> {
    let owner = ctx.sender();
    let kennel = ctx
        .db
        .building()
        .id()
        .find(&kennel_id)
        .ok_or_else(|| "Kennel not found.".to_string())?;
    if kennel.owner != owner || kennel.kind != "kennel" {
        return Err("You do not own this kennel.".to_string());
    }
    if !kennel.construction_complete {
        return Err("Finish this kennel before purchasing dogs.".to_string());
    }
    if building_fire_state(ctx, kennel_id).is_some() {
        return Err("Repair this fire-damaged kennel before purchasing dogs.".to_string());
    }
    if kennel.assigned_labor == 0 {
        return Err("Assign at least one kennel keeper before purchasing dogs.".to_string());
    }

    let dogs = ctx
        .db
        .combat_agent()
        .owner()
        .filter(&owner)
        .filter(|agent| {
            agent.faction == GUARD_DOG_FACTION && agent.source_building_id == kennel_id
        })
        .collect::<Vec<_>>();
    if dogs.len() >= usize::from(KENNEL_DOG_SLOTS) {
        return Err(format!(
            "This kennel already supports its maximum of {KENNEL_DOG_SLOTS} guard dogs."
        ));
    }
    let slot = (0..KENNEL_DOG_SLOTS)
        .find(|slot| !dogs.iter().any(|dog| dog.source_slot == u32::from(*slot)))
        .ok_or_else(|| "This kennel has no open dog bay.".to_string())?;

    spend_treasury_gold(ctx, owner, KENNEL_DOG_PURCHASE_GOLD)?;
    let local_x = [-2.55, -0.85, 0.85, 2.55][usize::from(slot)];
    ctx.db.combat_agent().insert(CombatAgent {
        id: 0,
        owner,
        raid_id: 0,
        faction: GUARD_DOG_FACTION,
        source_building_id: kennel_id,
        source_slot: u32::from(slot),
        assigned_building_id: 0,
        target_kind: 0,
        target_id: kennel_id,
        x: kennel.x + local_x,
        z: kennel.z + 1.1,
        velocity_x: 0.0,
        velocity_z: 0.0,
        home_x: kennel.x,
        home_z: kennel.z,
        health: 80.0,
        max_health: 80.0,
        readiness: 1.0,
        state: 4,
        attack_cooldown: 0.0,
        loot_progress: 0.0,
        loot_fraction: 0.0,
        carried_loot_json: String::new(),
        state_changed_tick: 0,
        route_progress: 0.0,
        raid_anchor_building_id: 0,
    });
    Ok(())
}

/// Sets the number of living guard dogs posted to one Hunter's Hall. Dogs are
/// selected deterministically from the owner's free patrol pool; postings at
/// other camps are never stolen.
#[reducer]
pub fn set_building_dogs(
    ctx: &ReducerContext,
    building_id: u64,
    assigned_dogs: u32,
) -> Result<(), String> {
    let owner = ctx.sender();
    let building = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Hunter's Hall not found.".to_string())?;
    if building.owner != owner || building.kind != "hunters_hall" {
        return Err("Only an owned Hunter's Hall can receive hunting dogs.".to_string());
    }
    if !building.construction_complete {
        return Err("Finish this Hunter's Hall before posting dogs here.".to_string());
    }
    if building_fire_state(ctx, building_id).is_some() {
        return Err("Repair this fire-damaged Hunter's Hall before posting dogs here.".to_string());
    }
    if assigned_dogs > KENNEL_DOG_MAX_PER_HUNTERS_HALL {
        return Err(format!(
            "This Hunter's Hall supports at most {KENNEL_DOG_MAX_PER_HUNTERS_HALL} hunting dogs."
        ));
    }

    let mut current = ctx
        .db
        .combat_agent()
        .owner()
        .filter(&owner)
        .filter(|agent| {
            agent.faction == GUARD_DOG_FACTION
                && agent.assigned_building_id == building_id
                && agent.source_building_id > 0
                && agent.health > 0.0
        })
        .collect::<Vec<_>>();
    current.sort_by_key(|dog| (dog.source_building_id, dog.source_slot, dog.id));

    if assigned_dogs < current.len() as u32 {
        for mut dog in current.into_iter().skip(assigned_dogs as usize) {
            dog.assigned_building_id = 0;
            dog.target_kind = 0;
            dog.target_id = dog.source_building_id;
            ctx.db.combat_agent().id().update(dog);
        }
        return Ok(());
    }

    let needed = assigned_dogs.saturating_sub(current.len() as u32) as usize;
    if needed == 0 {
        return Ok(());
    }
    let mut available = ctx
        .db
        .combat_agent()
        .owner()
        .filter(&owner)
        .filter(|agent| {
            agent.faction == GUARD_DOG_FACTION
                && agent.assigned_building_id == 0
                && agent.source_building_id > 0
                && agent.health > 0.0
        })
        .collect::<Vec<_>>();
    available.sort_by_key(|dog| (dog.source_building_id, dog.source_slot, dog.id));
    if available.len() < needed {
        return Err(format!(
            "Only {} free guard dogs are available; {needed} are needed for this posting.",
            available.len()
        ));
    }
    for mut dog in available.into_iter().take(needed) {
        dog.assigned_building_id = building_id;
        dog.target_kind = 0;
        dog.target_id = building_id;
        ctx.db.combat_agent().id().update(dog);
    }
    Ok(())
}
