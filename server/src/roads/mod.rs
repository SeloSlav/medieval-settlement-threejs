mod network;
mod snapshot_cache;

use spacetimedb::{Identity, ReducerContext};

use crate::db::*;

pub use network::{RoadNetwork, RoadPathRoute};
pub use snapshot_cache::RoadSnapshotCache;
#[cfg(feature = "persistent-world")]
pub use network::RiverNavigationGrid;

pub fn apply_world_navigation(network: &mut RoadNetwork) {
    #[cfg(feature = "persistent-world")]
    {
        use std::sync::{Arc, OnceLock};
        static NAVIGATION: OnceLock<Arc<RiverNavigationGrid>> = OnceLock::new();
        let navigation = NAVIGATION.get_or_init(|| {
            RiverNavigationGrid::from_json(include_str!("../../generated/realm_navigation.json"))
                .expect("Embedded realm terrain/navigation must be valid")
        });
        network.set_river_navigation(navigation.clone());
    }
    #[cfg(not(feature = "persistent-world"))]
    let _ = network;
}

pub fn load_owner_road_network(ctx: &ReducerContext, owner: Identity) -> Option<RoadNetwork> {
    let state = ctx.db.road_network_state().owner().find(&owner)?;
    let mut network = RoadNetwork::from_snapshot_json(&state.snapshot_json)?;
    apply_world_navigation(&mut network);
    Some(network)
}
