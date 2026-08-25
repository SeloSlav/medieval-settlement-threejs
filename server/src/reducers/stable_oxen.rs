use std::collections::HashSet;

use spacetimedb::{reducer, ReducerContext};

use crate::balance_generated::{STABLE_OX_PURCHASE_GOLD, STABLE_OX_SLOTS};
use crate::db::*;
use crate::economy::spend_treasury_gold;
use crate::ox_policy::{
    is_ox_supported_workplace, ox_workplace_capacity, reconcile_ox_posting, OxPostingCandidate,
    OxPostingError,
};
use crate::simulation::building_fire_state;
use crate::tables::StableOx;

/// Purchases one trained draft ox into the first open bay of a completed,
/// fire-safe stable. Reducers are transactional, so the treasury debit and ox
/// insertion either commit together or are both rolled back.
#[reducer]
pub fn purchase_stable_ox(ctx: &ReducerContext, stable_id: u64) -> Result<(), String> {
    let owner = ctx.sender();
    let stable = ctx
        .db
        .building()
        .id()
        .find(&stable_id)
        .ok_or_else(|| "Stable not found.".to_string())?;
    if stable.owner != owner || stable.kind != "stable" {
        return Err("You do not own this stable.".to_string());
    }
    if !stable.construction_complete {
        return Err("Finish this stable before purchasing oxen.".to_string());
    }
    if building_fire_state(ctx, stable_id).is_some() {
        return Err("Repair this fire-damaged stable before purchasing oxen.".to_string());
    }

    let oxen = ctx
        .db
        .stable_ox()
        .stable_id()
        .filter(&stable_id)
        .collect::<Vec<_>>();
    if oxen.len() >= usize::from(STABLE_OX_SLOTS) {
        return Err(format!(
            "This stable already houses its maximum of {STABLE_OX_SLOTS} oxen."
        ));
    }
    let slot = (0..STABLE_OX_SLOTS)
        .find(|slot| !oxen.iter().any(|ox| ox.slot == *slot))
        .ok_or_else(|| "This stable has no open ox bay.".to_string())?;

    spend_treasury_gold(ctx, owner, STABLE_OX_PURCHASE_GOLD)?;
    ctx.db.stable_ox().insert(StableOx {
        id: 0,
        owner,
        stable_id,
        slot,
        assigned_building_id: 0,
    });
    Ok(())
}

/// Sets the desired number of oxen permanently posted to one eligible
/// workplace. Increasing draws deterministically from the unposted automatic
/// pool; oxen already posted elsewhere or traveling on carts are never stolen.
#[reducer]
pub fn set_building_oxen(
    ctx: &ReducerContext,
    building_id: u64,
    assigned_oxen: u32,
) -> Result<(), String> {
    let owner = ctx.sender();
    let building = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Building not found.".to_string())?;
    if building.owner != owner {
        return Err("You do not own this building.".to_string());
    }
    if !building.construction_complete {
        return Err("Finish this building before posting oxen here.".to_string());
    }
    if !is_ox_supported_workplace(&building.kind) {
        return Err("This building cannot use oxen.".to_string());
    }
    if building_fire_state(ctx, building.id).is_some() {
        return Err("Repair this fire-damaged building before posting oxen here.".to_string());
    }
    let maximum = ox_workplace_capacity(&building.kind);

    let active_trip_ox_ids: HashSet<u64> = ctx
        .db
        .delivery_trip()
        .owner()
        .filter(&owner)
        .filter_map(|trip| (trip.ox_id != 0).then_some(trip.ox_id))
        .collect();
    let candidates: Vec<OxPostingCandidate> = ctx
        .db
        .stable_ox()
        .owner()
        .filter(&owner)
        .map(|ox| OxPostingCandidate {
            ox_id: ox.id,
            stable_id: ox.stable_id,
            stable_slot: ox.slot,
            assigned_building_id: ox.assigned_building_id,
            active_trip: active_trip_ox_ids.contains(&ox.id),
        })
        .collect();
    let updates = reconcile_ox_posting(&candidates, building_id, assigned_oxen, maximum).map_err(
        |error| match error {
            OxPostingError::AboveCapacity { maximum } => {
                format!("This building supports at most {maximum} oxen.")
            }
            OxPostingError::NotEnoughUnposted { available, needed } => format!(
                "Only {available} unposted oxen are available; {needed} are needed for this order."
            ),
        },
    )?;

    for update in updates {
        let Some(mut ox) = ctx.db.stable_ox().id().find(&update.ox_id) else {
            continue;
        };
        if ox.owner != owner {
            continue;
        }
        ox.assigned_building_id = update.assigned_building_id;
        ctx.db.stable_ox().id().update(ox);
    }
    Ok(())
}
