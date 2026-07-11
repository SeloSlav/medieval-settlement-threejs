//! Table accessor traits and `Table` methods required for `ctx.db` calls.
pub use spacetimedb::Table;

pub use crate::schedule::sim_tick_schedule;
pub use crate::tables::{
    backyard_garden, building, burgage_zone, delivery_trip, foraging_node, player_resources, quarry,
    residence, residence_need, road_network_state, tree_entity, world_config,
};
