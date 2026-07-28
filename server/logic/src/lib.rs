//! Pure server logic compiled for native `cargo test`.
//! The WASM module crate (`medieval-road-system-server`) cannot link host tests directly.

#[path = "../../src/balance_generated.rs"]
pub mod balance_generated;

#[path = "../../src/backyard_garden_policy.rs"]
pub mod backyard_garden_policy;

#[path = "../../src/chapel_parish_policy.rs"]
pub mod chapel_parish_policy;

#[path = "../../src/civic_receipts_policy.rs"]
pub mod civic_receipts_policy;

#[path = "../../src/constants.rs"]
pub mod constants;

#[path = "../../src/roads/network.rs"]
pub mod road_network;

pub mod roads {
    pub use crate::road_network::{RoadNetwork, RoadPathRoute};
}

#[path = "../../src/hydrology_grid_generated.rs"]
pub mod hydrology_grid_generated;

#[path = "../../src/economy/marketplace_trade_policy.rs"]
pub mod marketplace_trade_policy;

#[path = "../../src/economy/regional_market_policy.rs"]
pub mod regional_market_policy;

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

#[path = "../../src/labor_steward_policy.rs"]
pub mod labor_steward_policy;
#[path = "../../src/season_policy.rs"]
pub mod season_policy;
#[path = "../../src/seasonal_labor_policy.rs"]
pub mod seasonal_labor_policy;
#[path = "../../src/security_policy.rs"]
pub mod security_policy;

#[path = "../../src/raid_agent_policy.rs"]
pub mod raid_agent_policy;

#[path = "../../src/specialty_trade_policy.rs"]
pub mod specialty_trade_policy;

#[path = "../../src/storehouse_policy.rs"]
pub mod storehouse_policy;

#[path = "../../src/processor_output_policy.rs"]
pub mod processor_output_policy;

#[path = "../../src/processor_labor_policy.rs"]
pub mod processor_labor_policy;

#[path = "../../src/quarry_balance.rs"]
pub mod quarry_balance;

#[path = "../../src/foraging_policy.rs"]
pub mod foraging_policy;
#[path = "../../src/harvest_reserve_policy.rs"]
pub mod harvest_reserve_policy;

#[path = "../../src/frontier_economy_policy.rs"]
pub mod frontier_economy_policy;

#[path = "../../src/granary_policy.rs"]
pub mod granary_policy;

#[path = "../../src/burgage.rs"]
pub mod burgage;

#[path = "../../src/farming.rs"]
pub mod farming;

#[path = "../../src/livestock_policy.rs"]
pub mod livestock_policy;

#[path = "../../src/monastery_hospitality_policy.rs"]
pub mod monastery_hospitality_policy;

#[path = "../../src/residence_settlement_policy.rs"]
pub mod residence_settlement_policy;

#[path = "../../src/residence_upgrade_policy.rs"]
pub mod residence_upgrade_policy;

#[path = "../../src/marketplace_procurement_policy.rs"]
pub mod marketplace_procurement_policy;

#[path = "../../src/fire_policy.rs"]
pub mod fire_policy;

#[path = "../../src/fire_recovery_policy.rs"]
pub mod fire_recovery_policy;

#[path = "../../src/construction_priority.rs"]
pub mod construction_priority;

#[path = "../../src/well_policy.rs"]
pub mod well_policy;

#[path = "../../src/woodcutter_policy.rs"]
pub mod woodcutter_policy;

#[path = "../../src/year_round_labor_policy.rs"]
pub mod year_round_labor_policy;

#[path = "../../src/worksite_stall_policy.rs"]
pub mod worksite_stall_policy;

#[path = "../../src/supply_policy.rs"]
pub mod supply_policy;
