use spacetimedb::ReducerContext;

use crate::balance_generated::{
    STOREHOUSE_HAUL_PER_WORKER, TIMBER_DELIVERY_SPEED_MPS, TIMBER_DELIVERY_UNLOAD_SEC,
};
use crate::civic_receipts_policy::civic_receipt_cart_load;
use crate::economy::{
    local_civic_receipts, mark_local_civic_receipts_dispatched, physical_treasury_seat,
    CommodityKind,
};
use crate::simulation::delivery_trips::{
    available_free_haulers, building_has_active_trip, try_start_building_supply_trip,
};
use crate::simulation::game_calendar::GameClock;
use crate::simulation::tick_context::SimTickContext;
use crate::tables::Building;

/// Dispatches one physical handcart of locally collected civic income.
///
/// Staffed sources use one of their own workers. Autonomous sources such as
/// monasteries require a free settlement hauler, preserving the labor cost of
/// converting locally held coin into spendable civic money.
pub fn try_dispatch_local_civic_receipts(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    source: &mut Building,
    daily_income: f64,
) -> bool {
    if building_has_active_trip(ctx, source.id) {
        return false;
    }
    let load = civic_receipt_cart_load(local_civic_receipts(source), daily_income);
    if load <= 1e-9 {
        return false;
    }
    if source.assigned_labor == 0 && available_free_haulers(ctx, source.owner) == 0 {
        return false;
    }
    let Some(target) = physical_treasury_seat(ctx, source.owner) else {
        return false;
    };
    if target.id == source.id {
        return false;
    }
    let Some(network) = tick.road_network(source.owner) else {
        return false;
    };
    let before = source.gold;
    if !try_start_building_supply_trip(
        ctx,
        tick,
        clock,
        network,
        source,
        &target,
        1,
        CommodityKind::Gold,
        TIMBER_DELIVERY_SPEED_MPS,
        TIMBER_DELIVERY_UNLOAD_SEC,
        STOREHOUSE_HAUL_PER_WORKER,
        load,
    ) {
        return false;
    }
    let loaded = (before - source.gold).max(0.0);
    mark_local_civic_receipts_dispatched(source, loaded);
    loaded > 1e-9
}
