use spacetimedb::ReducerContext;

use crate::balance_generated::{
    CIVILIAN_TOOL_IRONWORK_PER_CYCLE, MINE_IRON_PER_CYCLE, MINING_CAMP_CLAY_PER_CYCLE,
    MINE_SALT_PER_CYCLE, STONE_PER_HARVEST,
};
use crate::building_defs::building_def;
use crate::civilian_tool_policy::{civilian_tool_throughput_multiplier, civilian_tools_maintained};
use crate::constants::TICK_DT;
use crate::db::*;
use crate::economy::{building_commodity_room, deposit_building_commodity, CommodityKind};
use crate::extraction_policy::{mining_camp_clay_commodity, mining_camp_geological_commodity};
use crate::production_maintenance::charge_completed_production_maintenance;
use crate::simulation::delivery_trips::onsite_building_labor;
use crate::simulation::game_calendar::GameClock;
use crate::simulation::SimTickContext;
use crate::simulation::{labor_and_logistics_paused, ox_amplified_production_labor};
use crate::season_policy::EnvironmentState;
use crate::tables::{Building, ForagingNode, Quarry};

enum SurfaceDeposit {
    Geological(Quarry, CommodityKind),
    Clay(ForagingNode),
}

impl SurfaceDeposit {
    fn commodity(&self) -> CommodityKind {
        match self {
            Self::Geological(_, commodity) => *commodity,
            Self::Clay(_) => CommodityKind::Clay,
        }
    }

    fn remaining(&self) -> f64 {
        match self {
            Self::Geological(deposit, _) => deposit.remaining,
            Self::Clay(deposit) => deposit.remaining,
        }
    }
}

/// The Mining Camp works the nearest finite surface reserve of stone, iron, salt, or clay
/// inside its radius. A rich marker still has a depleting surface layer; its
/// non-depleting deep source remains exclusive to a Quarry or Mineworks.
pub fn step_stone_quarry(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    environment: EnvironmentState,
    building: Building,
) {
    if labor_and_logistics_paused(ctx, tick, building.owner, clock) {
        return;
    }

    let Some(def) = building_def(&building.kind) else {
        return;
    };
    let onsite_labor = onsite_building_labor(ctx, &building);
    let productive_labor = ox_amplified_production_labor(ctx, tick, &building, onsite_labor);
    if productive_labor <= 1e-9 {
        return;
    }

    let labor_interval = def.action_interval / productive_labor;
    let Some(deposit) = nearest_surface_deposit(ctx, building.x, building.z, def.work_radius)
    else {
        ctx.db.building().id().update(Building {
            action_cooldown: labor_interval,
            ..building
        });
        return;
    };
    let commodity = deposit.commodity();
    let tools_maintained = civilian_tools_maintained(building.ironwork);
    let selected_rate = crate::production_rate_policy::production_rate_multiplier(
        building.production_rate_percent,
    );
    if selected_rate <= 1e-9 {
        return;
    }
    let surface_weather_multiplier = if commodity == CommodityKind::Clay {
        environment.surface_clay_throughput_multiplier()
    } else {
        1.0
    };
    let throughput_multiplier = civilian_tool_throughput_multiplier(building.ironwork)
        * selected_rate
        * surface_weather_multiplier;
    let cooldown = (building.action_cooldown - TICK_DT * throughput_multiplier).max(0.0);
    if cooldown > 0.0 {
        ctx.db.building().id().update(Building {
            action_cooldown: cooldown,
            ..building
        });
        return;
    }

    let base_batch = extraction_batch(commodity);
    let output_headroom = building_commodity_room(&building, commodity);
    let batch = crate::resource_units::whole_cost(base_batch);
    let available = crate::resource_units::whole_units(deposit.remaining());
    let room = crate::resource_units::whole_units(output_headroom);
    if batch < 1.0 || available + 1e-6 < batch || room + 1e-6 < batch {
        ctx.db.building().id().update(building);
        return;
    }

    let mut updated = building;
    if deposit_building_commodity(&mut updated, commodity, batch) != batch {
        return;
    }
    if tools_maintained {
        charge_completed_production_maintenance(
            &mut updated,
            CIVILIAN_TOOL_IRONWORK_PER_CYCLE,
        );
    }
    match deposit {
        SurfaceDeposit::Geological(deposit, _) => {
            ctx.db.quarry().quarry_id().update(Quarry {
                remaining: crate::resource_units::whole_units(deposit.remaining) - batch,
                ..deposit
            });
        }
        SurfaceDeposit::Clay(deposit) => {
            ctx.db.foraging_node().node_id().update(ForagingNode {
                remaining: crate::resource_units::whole_units(deposit.remaining) - batch,
                ..deposit
            });
        }
    }
    updated.action_cooldown = labor_interval;
    ctx.db.building().id().update(updated);
}

fn nearest_surface_deposit(
    ctx: &ReducerContext,
    x: f64,
    z: f64,
    radius: f64,
) -> Option<SurfaceDeposit> {
    let radius_sq = radius.max(0.0).powi(2);
    let mut nearest: Option<SurfaceDeposit> = None;
    let mut nearest_distance_sq = f64::INFINITY;

    for deposit in ctx.db.quarry().iter() {
        if deposit.remaining <= 1e-6 {
            continue;
        }
        let Some(commodity) = mining_camp_geological_commodity(&deposit.quarry_id, deposit.is_rich)
        else {
            continue;
        };
        let distance_sq = (deposit.x - x).powi(2) + (deposit.z - z).powi(2);
        if distance_sq > radius_sq || distance_sq >= nearest_distance_sq {
            continue;
        }
        nearest_distance_sq = distance_sq;
        nearest = Some(SurfaceDeposit::Geological(deposit, commodity));
    }

    for deposit in ctx.db.foraging_node().iter() {
        if mining_camp_clay_commodity(&deposit.node_kind, &deposit.node_id).is_none()
            || deposit.remaining <= 1e-6
        {
            continue;
        }
        let distance_sq = (deposit.x - x).powi(2) + (deposit.z - z).powi(2);
        if distance_sq > radius_sq || distance_sq >= nearest_distance_sq {
            continue;
        }
        nearest_distance_sq = distance_sq;
        nearest = Some(SurfaceDeposit::Clay(deposit));
    }

    nearest
}

fn extraction_batch(commodity: CommodityKind) -> f64 {
    match commodity {
        CommodityKind::Iron => MINE_IRON_PER_CYCLE,
        CommodityKind::Salt => MINE_SALT_PER_CYCLE,
        CommodityKind::Clay => MINING_CAMP_CLAY_PER_CYCLE,
        _ => STONE_PER_HARVEST,
    }
}
