use spacetimedb::ReducerContext;

use crate::balance_generated::CIVILIAN_TOOL_IRONWORK_PER_CYCLE;
use crate::building_defs::building_def;
use crate::civilian_tool_policy::{civilian_tool_throughput_multiplier, civilian_tools_maintained};
use crate::constants::{
    LODGE_FIREWOOD_PER_CYCLE, LODGE_TIMBER_PER_CYCLE, LODGE_TIMBER_PER_DELIVERY, TICK_DT,
    TIMBER_DELIVERY_SPEED_MPS, TIMBER_DELIVERY_UNLOAD_SEC,
};
use crate::db::*;
use crate::economy::{
    available_unreserved_building_timber, building_storage_caps, deposit_building,
    withdraw_building, withdraw_building_commodity, CommodityKind,
};
use crate::ox_policy::ox_amplified_worker_count;
use crate::simulation::delivery_trips::{
    building_has_active_trip, building_has_inbound_supply_trip, onsite_building_labor,
    try_start_timber_supply_trip,
};
use crate::simulation::game_calendar::GameClock;
use crate::simulation::labor_and_logistics_paused;
use crate::simulation::road_logistics::local_delivery_distance;
use crate::simulation::tick_context::SimTickContext;
use crate::supply_policy::select_supply_route_candidate;
use crate::tables::Building;
use crate::woodcutter_policy::woodcutter_can_process;

pub fn step_woodcutters_lodge(
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
    let Some(network) = tick.road_network(building.owner) else {
        ctx.db.building().id().update(Building {
            action_cooldown: (building.action_cooldown - TICK_DT).max(0.0),
            ..building
        });
        return;
    };

    let mut lodge = building;
    let onsite_labor = onsite_building_labor(ctx, &lodge);
    let tools_maintained = civilian_tools_maintained(lodge.ironwork);
    let throughput_multiplier = civilian_tool_throughput_multiplier(lodge.ironwork);
    if onsite_labor > 0 {
        lodge.action_cooldown = (lodge.action_cooldown - TICK_DT * throughput_multiplier).max(0.0);
    }
    let process_ready = onsite_labor > 0 && lodge.action_cooldown <= 0.0;
    if process_ready {
        let paired_oxen =
            crate::simulation::paired_production_ox_count(ctx, tick, &lodge, onsite_labor);
        let production_labor = ox_amplified_worker_count(onsite_labor, paired_oxen);
        // One authoritative stock scan serves both policy checks. Dispatching
        // cannot lead to same-tick processing because it only runs when the
        // lodge lacks the next cycle's timber.
        let available_timber = available_unreserved_building_timber(ctx, lodge.owner);
        lodge = dispatch_timber_supply_if_needed(
            ctx,
            tick,
            clock,
            network,
            lodge,
            onsite_labor,
            production_labor,
            available_timber,
        );
        let (processed, committed) =
            process_timber_to_firewood(lodge, production_labor, available_timber, tools_maintained);
        lodge = processed;
        if committed {
            lodge.action_cooldown = def.action_interval;
        }
    }
    ctx.db.building().id().update(lodge);
}

fn dispatch_timber_supply_if_needed(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    network: &crate::roads::RoadNetwork,
    lodge: Building,
    delivery_workers: u32,
    production_workers: u32,
    available_unreserved_timber: f64,
) -> Building {
    if delivery_workers == 0
        || production_workers == 0
        || building_has_inbound_supply_trip(ctx, lodge.id)
    {
        return lodge;
    }

    let labor = production_workers as f64;
    let timber_needed = LODGE_TIMBER_PER_CYCLE * labor;
    if !woodcutter_can_process(
        available_unreserved_timber,
        lodge.woodcutter_timber_reserve,
        timber_needed,
    ) {
        return lodge;
    }
    if lodge.timber + 1e-6 >= timber_needed {
        return lodge;
    }

    let remaining = timber_needed - lodge.timber;
    let Some((mut mill, _distance)) = select_supply_route_candidate(
        tick.building_ids_for_kinds(ctx, lodge.owner, &["lumber_mill"])
            .into_iter()
            .filter_map(|building_id| ctx.db.building().id().find(&building_id))
            .filter_map(|row| {
                if row.kind != "lumber_mill"
                    || !row.construction_complete
                    || tick.building_disabled_by_fire(ctx, row.id)
                    || building_has_active_trip(ctx, row.id)
                    || row.timber <= 1e-6
                {
                    return None;
                }
                local_delivery_distance(network, row.x, row.z, lodge.x, lodge.z)
                    .map(|distance| (row, distance))
            }),
        |candidate| candidate.1,
        |candidate| candidate.0.id,
    ) else {
        return lodge;
    };
    if try_start_timber_supply_trip(
        ctx,
        tick,
        clock,
        network,
        &mut mill,
        &lodge,
        delivery_workers,
        TIMBER_DELIVERY_SPEED_MPS,
        TIMBER_DELIVERY_UNLOAD_SEC,
        LODGE_TIMBER_PER_DELIVERY,
        remaining,
    ) {
        ctx.db.building().id().update(mill);
    }

    lodge
}

fn process_timber_to_firewood(
    lodge: Building,
    processing_workers: u32,
    available_unreserved_timber: f64,
    tools_maintained: bool,
) -> (Building, bool) {
    if processing_workers == 0 {
        return (lodge, false);
    }

    let caps = building_storage_caps(&lodge.kind);
    if lodge.firewood >= caps.firewood - 1e-6 {
        return (lodge, false);
    }

    let labor = processing_workers as f64;
    let full_timber_needed = LODGE_TIMBER_PER_CYCLE * labor;
    let full_firewood_output = LODGE_FIREWOOD_PER_CYCLE * labor;
    let timber_needed = crate::resource_units::whole_cost(full_timber_needed);
    let firewood_output = crate::resource_units::whole_cost(full_firewood_output);
    let output_room = crate::resource_units::whole_room(caps.firewood, lodge.firewood);

    if output_room + 1e-6 < firewood_output
        || lodge.timber + 1e-6 < timber_needed
        || !woodcutter_can_process(
            available_unreserved_timber,
            lodge.woodcutter_timber_reserve,
            timber_needed,
        )
    {
        return (lodge, false);
    }

    let (_, _, _, lodge_after_withdraw) = withdraw_building(&lodge, timber_needed, 0.0, 0.0);
    let (_, firewood_added, _, mut processed) =
        deposit_building(&lodge_after_withdraw, caps, 0.0, firewood_output, 0.0);
    if firewood_added <= 0.0 {
        return (lodge, false);
    }
    if tools_maintained {
        withdraw_building_commodity(
            &mut processed,
            CommodityKind::Ironwork,
            CIVILIAN_TOOL_IRONWORK_PER_CYCLE,
        );
    }
    (processed, true)
}
