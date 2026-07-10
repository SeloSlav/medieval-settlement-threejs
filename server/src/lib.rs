//! Medieval Road System — SpacetimeDB server module.
//! Single-player localhost: anonymous identity per browser token; resources/buildings/roads scoped by owner.

mod constants;
mod economy;
mod tables;
mod types;
mod world_gen;
mod schedule;
mod db;
mod lifecycle;
mod reducers;
mod simulation;

pub use constants::DEFAULT_WORLD_SEED;
