//! Table accessor traits and `Table` methods required for `ctx.db` calls.
pub use spacetimedb::Table;

pub use crate::schedule::sim_tick_schedule;
pub use crate::tables::{
    active_game_session, active_raid, backyard_garden, building, burgage_zone, combat_agent,
    delivery_trip, fire_incident, foraging_node, guard_muster_route, livestock_herd, market_state,
    pasture, player_resources, quarry, raid_incursion_route, residence, residence_need,
    road_network_state, sim_pacing_state, trading_post_trade_rule, tree_entity, vineyard_parcel,
    world_config,
};
