use spacetimedb::ReducerContext;

use crate::balance_generated::{
    CIVILIAN_TOOL_IRONWORK_PER_CYCLE, LARGE_QUARRY_TIMBER_SUPPORT_PER_CYCLE, STONE_PER_HARVEST,
};
use crate::building_defs::building_def;
use crate::civilian_tool_policy::{civilian_tool_throughput_multiplier, civilian_tools_maintained};
use crate::constants::TICK_DT;
use crate::db::*;
use crate::economy::{
    building_commodity_room, deposit_building_commodity, withdraw_building_commodity, CommodityKind,
};
use crate::extraction_policy::quarry_geological_commodity;
use crate::simulation::delivery_trips::onsite_building_labor;
use crate::simulation::expanded_economy::request_connected_commodity;
use crate::simulation::game_calendar::GameClock;
use crate::simulation::SimTickContext;
use crate::simulation::{labor_and_logistics_paused, ox_amplified_production_labor};
use crate::supply_policy::{large_quarry_support_target, large_quarry_supports_ready};
use crate::tables::Building;

const RICH_DEPOSIT_CENTER_TOLERANCE: f64 = 2.5;

/// The legacy `large_quarry` identifier now represents the shared Quarry.
/// It works only a rich stone node beneath the building and produces from its
/// underground source without changing the finite surface reserve.
pub fn step_large_quarry(
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
    let productive_labor = ox_amplified_production_labor(ctx, tick, &building, onsite_labor);
    if productive_labor <= 1e-9 {
        return;
    }

    let source_ready = rich_stone_beneath(ctx, building.x, building.z);
    let commodity = CommodityKind::Stone;
    let base_batch = STONE_PER_HARVEST;
    let output_headroom = building_commodity_room(&building, commodity);
    if source_ready && output_headroom > 1e-6 {
        request_connected_commodity(
            ctx,
            tick,
            clock,
            &building,
            CommodityKind::Timber,
            &["lumber_mill", "village_storehouse"],
            large_quarry_support_target(),
        );
        if !large_quarry_supports_ready(building.timber) {
            ctx.db.building().id().update(building);
            return;
        }
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
    let batch = crate::resource_units::whole_cost(base_batch);
    if !source_ready
        || crate::resource_units::whole_units(output_headroom) + 1e-6 < batch
        || building.timber + 1e-6
            < crate::resource_units::whole_cost(LARGE_QUARRY_TIMBER_SUPPORT_PER_CYCLE)
        || (tools_maintained
            && building.ironwork + 1e-6
                < crate::resource_units::whole_cost(CIVILIAN_TOOL_IRONWORK_PER_CYCLE))
    {
        ctx.db.building().id().update(building);
        return;
    }

    let mut updated = building;
    if deposit_building_commodity(&mut updated, commodity, batch) != batch {
        return;
    }
    withdraw_building_commodity(
        &mut updated,
        CommodityKind::Timber,
        LARGE_QUARRY_TIMBER_SUPPORT_PER_CYCLE,
    );
    if tools_maintained {
        withdraw_building_commodity(
            &mut updated,
            CommodityKind::Ironwork,
            CIVILIAN_TOOL_IRONWORK_PER_CYCLE,
        );
    }
    updated.action_cooldown = labor_interval;
    ctx.db.building().id().update(updated);
}

fn rich_stone_beneath(ctx: &ReducerContext, x: f64, z: f64) -> bool {
    let tolerance_sq = RICH_DEPOSIT_CENTER_TOLERANCE.powi(2);
    ctx.db.quarry().iter().any(|deposit| {
        quarry_geological_commodity(&deposit.quarry_id, deposit.is_rich).is_some()
            && (deposit.x - x).powi(2) + (deposit.z - z).powi(2) <= tolerance_sq
    })
}
