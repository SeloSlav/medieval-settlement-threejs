use spacetimedb::{reducer, ReducerContext};

use crate::balance_generated::{STABLE_OX_PURCHASE_GOLD, STABLE_OX_SLOTS};
use crate::db::*;
use crate::economy::spend_treasury_gold;
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
    });
    Ok(())
}
