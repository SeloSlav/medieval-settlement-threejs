use spacetimedb::{Identity, ReducerContext};

use crate::db::*;
use crate::labor_steward_policy::seasonal_labor_steward_review_due;
use crate::reducers::buildings::{
    call_up_operational_production_labor_for_settlement,
    recall_target_idle_processor_labor_for_settlement,
};
use crate::simulation::game_calendar::GameClock;
use crate::simulation::labor_schedule::owner_observes_sabbath;
use crate::simulation::tick_context::SimTickContext;
use crate::tables::Settlement;

use super::settlement_has_staffed_town_hall;

/// A conservative two-step production rotation: surplus workers leave
/// genuinely stalled sites first, then the enlarged free pool fills supplied
/// or recovering, capacity-open sites fairly in stable worksite order. The explicit
/// player order remains free to pre-staff an empty chain.
pub fn reconcile_target_production_labor_for_settlement(
    ctx: &ReducerContext,
    owner: Identity,
    settlement_id: u64,
    labor_reserve: u32,
) -> (u32, u32) {
    let recalled = recall_target_idle_processor_labor_for_settlement(ctx, owner, settlement_id);
    let called_up = call_up_operational_production_labor_for_settlement(
        ctx,
        owner,
        settlement_id,
        labor_reserve,
    );
    (recalled, called_up)
}

/// Runs only at the authoritative calendar boundary. Disabled settlements and
/// ordinary ticks avoid every production and source scan.
pub fn step_production_labor_stewards(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    sim_tick: u64,
) {
    if !seasonal_labor_steward_review_due(sim_tick) {
        return;
    }
    let settlements: Vec<Settlement> = ctx
        .db
        .settlement()
        .iter()
        .filter(|settlement| settlement.active && settlement.production_labor_steward_enabled)
        .collect();
    for settlement in settlements {
        // Preserve the physical roster throughout an observed Sabbath. The
        // missed midnight review runs at the next ordinary day boundary.
        if settlement_has_staffed_town_hall(ctx, &settlement)
            && !owner_observes_sabbath(ctx, tick, settlement.owner, clock)
        {
            reconcile_target_production_labor_for_settlement(
                ctx,
                settlement.owner,
                settlement.id,
                settlement.labor_steward_reserve,
            );
        }
    }
}
