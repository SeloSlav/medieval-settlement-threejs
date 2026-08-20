use spacetimedb::ReducerContext;

use crate::balance_generated::{
    CIVILIAN_TOOL_IRONWORK_PER_CYCLE, CLAY_PIT_CLAY_PER_CYCLE,
    LARGE_QUARRY_TIMBER_SUPPORT_PER_CYCLE, MINE_IRON_PER_CYCLE, MINE_SALT_PER_CYCLE,
    STONE_PER_HARVEST,
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
use crate::simulation::expanded_economy::request_connected_commodity;
use crate::simulation::game_calendar::GameClock;
use crate::simulation::SimTickContext;
use crate::simulation::{commute_adjusted_labor, labor_and_logistics_paused};
use crate::supply_policy::{large_quarry_support_target, large_quarry_supports_ready};
use crate::tables::Building;

const RICH_DEPOSIT_CENTER_TOLERANCE: f64 = 2.5;

/// The legacy `large_quarry` identifier now represents the shared Quarry.
/// It reads the rich stone, iron, salt, or clay node beneath the building and
/// produces from its underground source without changing the surface reserve.
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
    let productive_labor = commute_adjusted_labor(ctx, tick, &building, onsite_labor);
    if productive_labor <= 1e-9 {
        return;
    }

    let source = rich_deposit_beneath(ctx, building.x, building.z);
    let commodity = source.unwrap_or(CommodityKind::Stone);
    let base_batch = extraction_batch(commodity);
    let output_headroom = processor_output_headroom(
        building_commodity_stock(&building, commodity),
        building_commodity_cap(&building.kind, commodity),
        building.processor_output_target_percent,
    );
    if source.is_some() && output_headroom > 1e-6 {
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
    if output_headroom <= 1e-6 || source.is_none() {
        ctx.db.building().id().update(Building {
            action_cooldown: labor_interval,
            ..building
        });
        return;
    }

    let produced = base_batch.min(output_headroom);
    let mut updated = building;
    deposit_building_commodity(&mut updated, commodity, produced);
    withdraw_building_commodity(
        &mut updated,
        CommodityKind::Timber,
        LARGE_QUARRY_TIMBER_SUPPORT_PER_CYCLE * produced / base_batch,
    );
    if tools_maintained {
        withdraw_building_commodity(
            &mut updated,
            CommodityKind::Ironwork,
            CIVILIAN_TOOL_IRONWORK_PER_CYCLE * produced / base_batch,
        );
    }
    updated.action_cooldown = labor_interval;
    ctx.db.building().id().update(updated);
}

fn rich_deposit_beneath(ctx: &ReducerContext, x: f64, z: f64) -> Option<CommodityKind> {
    let tolerance_sq = RICH_DEPOSIT_CENTER_TOLERANCE.powi(2);
    for deposit in ctx.db.quarry().iter() {
        if !deposit.is_rich || (deposit.x - x).powi(2) + (deposit.z - z).powi(2) > tolerance_sq {
            continue;
        }
        if deposit.quarry_id.starts_with("deposit-iron-") {
            return Some(CommodityKind::Iron);
        }
        if deposit.quarry_id.starts_with("deposit-salt-") {
            return Some(CommodityKind::Salt);
        }
        if deposit.quarry_id.starts_with("quarry-") {
            return Some(CommodityKind::Stone);
        }
    }
    ctx.db.foraging_node().iter().find_map(|deposit| {
        (deposit.node_kind == "clay"
            && deposit.node_id.starts_with("clay-rich-")
            && (deposit.x - x).powi(2) + (deposit.z - z).powi(2) <= tolerance_sq)
            .then_some(CommodityKind::Clay)
    })
}

fn extraction_batch(commodity: CommodityKind) -> f64 {
    match commodity {
        CommodityKind::Iron => MINE_IRON_PER_CYCLE,
        CommodityKind::Salt => MINE_SALT_PER_CYCLE,
        CommodityKind::Clay => CLAY_PIT_CLAY_PER_CYCLE,
        _ => STONE_PER_HARVEST,
    }
}
