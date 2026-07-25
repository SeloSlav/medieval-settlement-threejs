//! Medieval Road System — SpacetimeDB server module.
//! Single-player localhost: anonymous identity per browser token; resources/buildings/roads scoped by owner.

mod balance_generated;
mod building_defs;
mod burgage;
mod constants;
mod db;
mod economy;
mod farming;
mod fire_policy;
mod foraging_policy;
mod hydrology;
mod hydrology_grid_generated;
mod lifecycle;
mod placement_validation;
mod quarry_balance;
mod reducers;
mod roads;
mod schedule;
mod season_policy;
mod security_policy;
mod simulation;
mod supply_policy;
mod tables;
mod types;
mod well_policy;
mod world_entities;
mod world_gen;

pub use constants::DEFAULT_WORLD_SEED;
