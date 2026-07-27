use spacetimedb::{Identity, ReducerContext};

use crate::db::*;
use crate::labor_steward_policy::seasonal_labor_steward_review_due;
use crate::reducers::buildings::{
    call_up_operational_production_labor_for_owner, recall_target_idle_processor_labor_for_owner,
};

use super::owner_has_staffed_town_hall;

/// A conservative two-step production rotation: surplus workers leave
/// genuinely stalled sites first, then the enlarged free pool fills supplied
/// or recovering, capacity-open sites by staffing priority. The explicit
/// player order remains free to pre-staff an empty chain.
pub fn reconcile_target_production_labor_for_owner(
    ctx: &ReducerContext,
    owner: Identity,
    labor_reserve: u32,
) -> (u32, u32) {
    let recalled = recall_target_idle_processor_labor_for_owner(ctx, owner);
    let called_up = call_up_operational_production_labor_for_owner(ctx, owner, labor_reserve);
    (recalled, called_up)
}

/// Runs only at the authoritative calendar boundary. Disabled settlements and
/// ordinary ticks avoid every production and source scan.
pub fn step_production_labor_stewards(ctx: &ReducerContext, sim_tick: u64) {
    if !seasonal_labor_steward_review_due(sim_tick) {
        return;
    }
    let owners: Vec<(Identity, u32)> = ctx
        .db
        .player_resources()
        .iter()
        .filter(|resources| resources.production_labor_steward_enabled)
        .map(|resources| (resources.owner, resources.labor_steward_reserve))
        .collect();
    for (owner, labor_reserve) in owners {
        if owner_has_staffed_town_hall(ctx, owner) {
            reconcile_target_production_labor_for_owner(ctx, owner, labor_reserve);
        }
    }
}
