use spacetimedb::{Identity, ReducerContext};

use crate::db::*;
use crate::labor_steward_policy::seasonal_labor_steward_review_due;
use crate::reducers::buildings::rotate_construction_labor_for_owner_with_reserve;

use super::owner_has_staffed_town_hall;

/// Runs only at the authoritative calendar boundary. The daily rotation uses
/// the same queue policy and live inbound-cart checks as the explicit Town Hall
/// order; disabled settlements never enter the building scan.
pub fn step_construction_labor_stewards(ctx: &ReducerContext, sim_tick: u64) {
    if !seasonal_labor_steward_review_due(sim_tick) {
        return;
    }
    let owners: Vec<(Identity, u32)> = ctx
        .db
        .player_resources()
        .iter()
        .filter(|resources| resources.construction_labor_steward_enabled)
        .map(|resources| (resources.owner, resources.labor_steward_reserve))
        .collect();
    for (owner, labor_reserve) in owners {
        if owner_has_staffed_town_hall(ctx, owner) {
            rotate_construction_labor_for_owner_with_reserve(ctx, owner, labor_reserve);
        }
    }
}
