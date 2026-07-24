//! Table accessor traits and `Table` methods required for `ctx.db` calls.
pub use spacetimedb::Table;

pub use crate::schedule::sim_tick_schedule;
pub use crate::tables::{
    backyard_garden, building, burgage_zone, delivery_trip, fire_incident, foraging_node,
    livestock_herd, market_state, pasture, player_resources, quarry, residence, residence_need,
    road_network_state, sim_pacing_state, tree_entity, world_config,
};
