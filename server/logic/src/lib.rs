//! Pure server logic compiled for native `cargo test`.
//! The WASM module crate (`medieval-road-system-server`) cannot link host tests directly.

#[path = "../../src/balance_generated.rs"]
pub mod balance_generated;

#[path = "../../src/hydrology_grid_generated.rs"]
pub mod hydrology_grid_generated;

#[path = "../../src/economy/marketplace_trade_policy.rs"]
pub mod marketplace_trade_policy;

#[path = "../../src/economy/population_policy.rs"]
pub mod population_policy;

#[path = "../../src/simulation/residence_needs/kinds.rs"]
pub mod residence_need_kinds;

#[path = "../../src/hydrology/mod.rs"]
pub mod hydrology;

#[path = "../../src/simulation/game_calendar.rs"]
pub mod game_calendar;

pub mod simulation {
    pub use crate::game_calendar::GameClock;
}

#[path = "../../src/season_policy.rs"]
pub mod season_policy;
#[path = "../../src/security_policy.rs"]
pub mod security_policy;

#[path = "../../src/quarry_balance.rs"]
pub mod quarry_balance;

#[path = "../../src/foraging_policy.rs"]
pub mod foraging_policy;

#[path = "../../src/fire_policy.rs"]
pub mod fire_policy;

#[path = "../../src/well_policy.rs"]
pub mod well_policy;

#[path = "../../src/supply_policy.rs"]
pub mod supply_policy;
