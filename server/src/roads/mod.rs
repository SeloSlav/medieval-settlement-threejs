mod network;

use spacetimedb::{Identity, ReducerContext};

use crate::db::*;

pub use network::{RoadNetwork, RoadPathRoute};

pub fn load_owner_road_network(ctx: &ReducerContext, owner: Identity) -> Option<RoadNetwork> {
    let state = ctx.db.road_network_state().owner().find(&owner)?;
    RoadNetwork::from_snapshot_json(&state.snapshot_json)
}
