use spacetimedb::ReducerContext;

use crate::balance_generated::{
    CIVILIAN_TOOL_IRONWORK_PER_CYCLE, CLAY_PIT_CLAY_PER_CYCLE, MINE_IRON_PER_CYCLE,
    MINE_SALT_PER_CYCLE, STONE_PER_HARVEST,
};
use crate::building_defs::building_def;
use crate::civilian_tool_policy::{civilian_tool_throughput_multiplier, civilian_tools_maintained};
use crate::constants::TICK_DT;
use crate::db::*;
use crate::economy::{
    building_commodity_cap, building_commodity_stock, deposit_building_commodity,
    withdraw_building_commodity, CommodityKind,
};
use crate::processor_output_policy::processor_output_headroom;
use crate::simulation::delivery_trips::onsite_building_labor;
use crate::simulation::game_calendar::GameClock;
use crate::simulation::SimTickContext;
use crate::simulation::{commute_adjusted_labor, labor_and_logistics_paused};
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

/// The legacy `stone_quarry` identifier now represents the shared Mining Pit.
/// It works the nearest finite surface reserve of stone, iron, salt, or clay
/// inside its radius. Richness never makes surface material infinite.
pub fn step_stone_quarry(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    building: Building,
) {
    if labor_and_logistics_paused(ctx, tick, building.owner, clock) {
        return;
    }

    let Some(def) = building_def(&building.kind) else {
        return;
    };
    let onsite_labor = onsite_building_labor(ctx, &building);
    let productive_labor = commute_adjusted_labor(ctx, tick, &building, onsite_labor);
    if productive_labor <= 1e-9 {
        return;
    }

    let tools_maintained = civilian_tools_maintained(building.ironwork);
    let throughput_multiplier = civilian_tool_throughput_multiplier(building.ironwork);
    let cooldown = (building.action_cooldown - TICK_DT * throughput_multiplier).max(0.0);
    if cooldown > 0.0 {
        ctx.db.building().id().update(Building {
            action_cooldown: cooldown,
            ..building
        });
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
    let base_batch = extraction_batch(commodity);
    let output_headroom = processor_output_headroom(
        building_commodity_stock(&building, commodity),
        building_commodity_cap(&building.kind, commodity),
        building.processor_output_target_percent,
    );
    let extracted = base_batch.min(deposit.remaining()).min(output_headroom);
    if extracted <= 1e-6 {
        ctx.db.building().id().update(Building {
            action_cooldown: labor_interval,
            ..building
        });
        return;
    }

    match deposit {
        SurfaceDeposit::Geological(deposit, _) => {
            ctx.db.quarry().quarry_id().update(Quarry {
                remaining: (deposit.remaining - extracted).max(0.0),
                ..deposit
            });
        }
        SurfaceDeposit::Clay(deposit) => {
            ctx.db.foraging_node().node_id().update(ForagingNode {
                remaining: (deposit.remaining - extracted).max(0.0),
                ..deposit
            });
        }
    }

    let mut updated = building;
    deposit_building_commodity(&mut updated, commodity, extracted);
    if tools_maintained {
        withdraw_building_commodity(
            &mut updated,
            CommodityKind::Ironwork,
            CIVILIAN_TOOL_IRONWORK_PER_CYCLE * extracted / base_batch,
        );
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
        let Some(commodity) = quarry_commodity(&deposit.quarry_id) else {
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
        if deposit.node_kind != "clay"
            || !deposit.node_id.starts_with("clay-")
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

fn quarry_commodity(quarry_id: &str) -> Option<CommodityKind> {
    if quarry_id.starts_with("deposit-iron-") {
        Some(CommodityKind::Iron)
    } else if quarry_id.starts_with("deposit-salt-") {
        Some(CommodityKind::Salt)
    } else if quarry_id.starts_with("quarry-") {
        Some(CommodityKind::Stone)
    } else {
        None
    }
}

fn extraction_batch(commodity: CommodityKind) -> f64 {
    match commodity {
        CommodityKind::Iron => MINE_IRON_PER_CYCLE,
        CommodityKind::Salt => MINE_SALT_PER_CYCLE,
        CommodityKind::Clay => CLAY_PIT_CLAY_PER_CYCLE,
        _ => STONE_PER_HARVEST,
    }
}
