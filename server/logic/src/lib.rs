//! Pure server logic compiled for native `cargo test`.
//! The WASM module crate (`medieval-road-system-server`) cannot link host tests directly.

#[path = "../../src/balance_generated.rs"]
pub mod balance_generated;

#[path = "../../src/hydrology_grid_generated.rs"]
pub mod hydrology_grid_generated;

#[path = "../../src/economy/marketplace_trade_policy.rs"]
pub mod marketplace_trade_policy;

#[path = "../../src/hydrology/mod.rs"]
pub mod hydrology;

#[path = "../../src/simulation/game_calendar.rs"]
pub mod game_calendar;
