use spacetimedb::ReducerContext;

use crate::db::*;
use crate::labor_steward_policy::seasonal_labor_steward_review_due;
use crate::reducers::buildings::rotate_construction_labor_for_settlement_with_reserve;
use crate::simulation::game_calendar::GameClock;
use crate::simulation::labor_schedule::owner_observes_sabbath;
use crate::simulation::tick_context::SimTickContext;
use crate::tables::Settlement;

use super::settlement_has_staffed_town_hall;

/// Runs only at the authoritative calendar boundary. The daily rotation uses
/// the same queue policy and live inbound-cart checks as the explicit Town Hall
/// order; disabled settlements never enter the building scan.
pub fn step_construction_labor_stewards(
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
        .filter(|settlement| settlement.active && settlement.construction_labor_steward_enabled)
        .collect();
    for settlement in settlements {
        // Preserve the physical roster throughout an observed Sabbath. The
        // missed midnight review runs at the next ordinary day boundary.
        if settlement_has_staffed_town_hall(ctx, &settlement)
            && !owner_observes_sabbath(ctx, tick, settlement.owner, clock)
        {
            rotate_construction_labor_for_settlement_with_reserve(
                ctx,
                settlement.owner,
                settlement.id,
                settlement.labor_steward_reserve,
            );
        }
    }
}
