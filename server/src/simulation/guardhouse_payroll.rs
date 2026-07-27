use spacetimedb::ReducerContext;

use crate::balance_generated::{
    STOREHOUSE_HAUL_PER_WORKER, TIMBER_DELIVERY_SPEED_MPS, TIMBER_DELIVERY_UNLOAD_SEC,
};
use crate::db::*;
use crate::economy::{treasury_gold, CommodityKind};
use crate::frontier_economy_policy::guardhouse_payroll_cart_load;
use crate::simulation::delivery_trips::{
    available_free_haulers, building_has_active_trip, building_has_inbound_commodity_trip,
    try_start_building_supply_trip,
};
use crate::simulation::game_calendar::GameClock;
use crate::simulation::tick_context::SimTickContext;
use crate::tables::Building;

const PAYROLL_TREASURY_KINDS: &[&str] = &["town_hall", "founders_camp", "salvage_pile"];

/// Sends one physical lockbox from an available treasury store to a guardhouse.
///
/// Company steps already run in explicit pay-priority order, so the first
/// eligible company claims the one treasury cart slot. A free settlement
/// hauler is reserved for the whole round trip; Town Hall clerks do not abandon
/// administration to drive the cart.
pub fn try_dispatch_guardhouse_payroll(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    guardhouse: &Building,
    armed_guards: f64,
) -> bool {
    if armed_guards <= 1e-9
        || building_has_inbound_commodity_trip(ctx, guardhouse.id, CommodityKind::Gold)
        || available_free_haulers(ctx, guardhouse.owner) == 0
    {
        return false;
    }
    let Some(network) = tick.road_network(guardhouse.owner) else {
        return false;
    };
    let spendable_gold = treasury_gold(ctx, guardhouse.owner);
    if spendable_gold <= 1e-9 {
        return false;
    }

    // The tick-local role index prevents a guardhouse roster from triggering a
    // whole-settlement scan. Kind order is the treasury preference order; ids
    // remain stable within a tier.
    for source_id in tick.building_ids_for_kinds(ctx, guardhouse.owner, PAYROLL_TREASURY_KINDS) {
        let Some(mut source) = ctx.db.building().id().find(&source_id) else {
            continue;
        };
        if !source.construction_complete
            || source.gold <= 1e-9
            || building_has_active_trip(ctx, source.id)
        {
            continue;
        }
        let load = guardhouse_payroll_cart_load(
            armed_guards,
            guardhouse.gold,
            0.0,
            source.gold.min(spendable_gold),
            STOREHOUSE_HAUL_PER_WORKER,
        );
        if load <= 1e-9 {
            return false;
        }
        if try_start_building_supply_trip(
            ctx,
            tick,
            clock,
            network,
            &mut source,
            guardhouse,
            1,
            CommodityKind::Gold,
            TIMBER_DELIVERY_SPEED_MPS,
            TIMBER_DELIVERY_UNLOAD_SEC,
            STOREHOUSE_HAUL_PER_WORKER,
            load,
        ) {
            ctx.db.building().id().update(source);
            return true;
        }
    }
    false
}
