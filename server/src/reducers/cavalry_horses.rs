use spacetimedb::{reducer, ReducerContext};

use crate::balance_generated::{CAVALRY_HORSE_PURCHASE_GOLD, CAVALRY_HORSE_SLOTS};
use crate::cavalry_policy::horse_occupies_yard_place;
use crate::db::*;
use crate::economy::spend_treasury_gold;
use crate::simulation::{building_fire_state, game_clock};
use crate::tables::{cavalry_horse, CavalryHorse};

/// Imports one untrained remount into the first open Cavalry Yard slot.
#[reducer]
pub fn purchase_cavalry_horse(ctx: &ReducerContext, cavalry_yard_id: u64) -> Result<(), String> {
    let owner = ctx.sender();
    let yard = ctx
        .db
        .building()
        .id()
        .find(&cavalry_yard_id)
        .ok_or_else(|| "Cavalry Yard not found.".to_string())?;
    if yard.owner != owner || yard.kind != "cavalry_yard" {
        return Err("You do not own this Cavalry Yard.".into());
    }
    if !yard.construction_complete {
        return Err("Finish this Cavalry Yard before importing remounts.".into());
    }
    if building_fire_state(ctx, yard.id).is_some() {
        return Err("Repair this fire-damaged Cavalry Yard first.".into());
    }
    if yard.assigned_labor == 0 {
        return Err("Assign at least one groom before importing remounts.".into());
    }

    let horses = ctx
        .db
        .cavalry_horse()
        .cavalry_yard_id()
        .filter(&yard.id)
        .filter(|horse| {
            horse_occupies_yard_place(
                horse.assigned_company_id,
                (horse.assigned_company_id > 0)
                    .then(|| {
                        ctx.db
                            .military_company()
                            .id()
                            .find(&horse.assigned_company_id)
                            .map(|company| company.state)
                    })
                    .flatten(),
            )
        })
        .collect::<Vec<_>>();
    if horses.len() >= usize::from(CAVALRY_HORSE_SLOTS) {
        return Err(format!(
            "This Cavalry Yard already houses its maximum of {CAVALRY_HORSE_SLOTS} horses."
        ));
    }
    let slot = (0..CAVALRY_HORSE_SLOTS)
        .find(|slot| !horses.iter().any(|horse| horse.slot == *slot))
        .ok_or_else(|| "This Cavalry Yard has no open horse slot.".to_string())?;

    spend_treasury_gold(ctx, owner, CAVALRY_HORSE_PURCHASE_GOLD)?;
    let total_days = ctx
        .db
        .world_config()
        .id()
        .find(&0)
        .map_or(0, |world| game_clock(world.sim_tick).total_days);
    ctx.db.cavalry_horse().insert(CavalryHorse {
        id: 0,
        owner,
        cavalry_yard_id: yard.id,
        slot,
        training_days: 0,
        last_training_day: total_days,
        assigned_company_id: 0,
        assigned_combat_agent_id: 0,
    });
    Ok(())
}
