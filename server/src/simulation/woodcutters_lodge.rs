use spacetimedb::ReducerContext;

use crate::balance_generated::CIVILIAN_TOOL_IRONWORK_PER_CYCLE;
use crate::building_defs::building_def;
use crate::civilian_tool_policy::{civilian_tool_throughput_multiplier, civilian_tools_maintained};
use crate::constants::{
    FIREWOOD_DELIVERY_SPEED_MPS, FIREWOOD_DELIVERY_UNLOAD_SEC, LODGE_FIREWOOD_PER_CYCLE,
    LODGE_FIREWOOD_PER_DELIVERY, LODGE_TIMBER_PER_CYCLE, LODGE_TIMBER_PER_DELIVERY, TICK_DT,
    TIMBER_DELIVERY_SPEED_MPS, TIMBER_DELIVERY_UNLOAD_SEC,
};
use crate::db::*;
use crate::economy::{
    available_unreserved_building_timber, building_storage_caps, deposit_building,
    withdraw_building, withdraw_building_commodity, CommodityKind,
};
use crate::simulation::delivery_cargo::has_delivery_stock_room;
use crate::simulation::delivery_supplier::{
    delivery_work_ready, dispatch_delivery_if_ready, should_alternate_single_worker,
    DeliveryDispatchConfig,
};
use crate::simulation::delivery_trips::{
    building_has_active_trip, building_has_inbound_supply_trip, onsite_building_labor,
    try_start_timber_supply_trip,
};
use crate::simulation::game_calendar::GameClock;
use crate::simulation::has_industrial_firewood_target;
use crate::simulation::labor_and_logistics_paused;
use crate::simulation::residence_needs::{load_needs, need_stock, ResidenceNeedKind};
use crate::simulation::road_logistics::{lodge_labor_split, select_residence_for_need_delivery};
use crate::simulation::tick_context::SimTickContext;
use crate::supply_policy::{household_firewood_needs_priority, select_supply_route_candidate};
use crate::tables::{Building, Residence};
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
    let mut split = lodge_labor_split(lodge.assigned_labor);
    split.processing = split.processing.min(onsite_labor);
    let tools_maintained = civilian_tools_maintained(lodge.ironwork);
    let throughput_multiplier = civilian_tool_throughput_multiplier(lodge.ironwork);
    if split.processing > 0 {
        lodge.action_cooldown = (lodge.action_cooldown - TICK_DT * throughput_multiplier).max(0.0);
    }
    let single_worker = lodge.assigned_labor == 1;
    let process_ready = split.processing > 0 && lodge.action_cooldown <= 0.0;
    let delivery_ready = delivery_work_ready(split.delivering, lodge.firewood > 0.0, lodge.id, ctx);

    let delivery_targets = if delivery_ready {
        collect_delivery_targets(ctx, tick, network, &lodge)
    } else {
        Vec::new()
    };
    let has_target =
        !delivery_targets.is_empty() || has_industrial_firewood_target(ctx, tick, &lodge);

    let (do_deliver, do_process) =
        should_alternate_single_worker(single_worker, process_ready, delivery_ready, has_target);

    if do_process {
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
            split.processing,
            available_timber,
        );
        lodge =
            process_timber_to_firewood(lodge, split.processing, available_timber, tools_maintained);
        lodge.action_cooldown = def.action_interval;
    }
    if do_deliver {
        dispatch_delivery_if_ready(
            ctx,
            tick,
            clock,
            network,
            &mut lodge,
            split.delivering,
            &delivery_targets,
            DeliveryDispatchConfig {
                need_kind: ResidenceNeedKind::Firewood,
                speed_mps: FIREWOOD_DELIVERY_SPEED_MPS,
                unload_seconds: FIREWOOD_DELIVERY_UNLOAD_SEC,
                per_delivery: LODGE_FIREWOOD_PER_DELIVERY,
            },
        );
    }

    ctx.db.building().id().update(lodge);
}

fn collect_delivery_targets(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    network: &crate::roads::RoadNetwork,
    lodge: &Building,
) -> Vec<Residence> {
    let residences: Vec<Residence> = ctx
        .db
        .residence()
        .owner()
        .filter(&lodge.owner)
        .filter(|residence| ResidenceNeedKind::Firewood.is_active_for_tier(residence.tier))
        .filter(|residence| {
            tick.firewood_supplier_for(ctx, lodge.owner, residence.id) == Some(lodge.id)
        })
        .collect();
    select_residence_for_need_delivery(
        network,
        lodge,
        residences,
        None,
        None,
        |residence| need_stock(&load_needs(ctx, residence.id), ResidenceNeedKind::Firewood),
        |residence, stock| {
            has_delivery_stock_room(ResidenceNeedKind::Firewood, stock)
                && household_firewood_needs_priority(
                    residence.abandoned,
                    residence.population,
                    stock,
                )
        },
    )
    .into_iter()
    .collect()
}

fn dispatch_timber_supply_if_needed(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    network: &crate::roads::RoadNetwork,
    lodge: Building,
    processing_workers: u32,
    available_unreserved_timber: f64,
) -> Building {
    if processing_workers == 0 || building_has_inbound_supply_trip(ctx, lodge.id) {
        return lodge;
    }

    let labor = processing_workers as f64;
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
                network
                    .road_path_distance(row.x, row.z, lodge.x, lodge.z)
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
        processing_workers,
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
) -> Building {
    if processing_workers == 0 {
        return lodge;
    }

    let caps = building_storage_caps(&lodge.kind);
    if lodge.firewood >= caps.firewood - 1e-6 {
        return lodge;
    }

    let labor = processing_workers as f64;
    let timber_needed = LODGE_TIMBER_PER_CYCLE * labor;
    let firewood_output = LODGE_FIREWOOD_PER_CYCLE * labor;

    if lodge.timber + 1e-6 < timber_needed
        || !woodcutter_can_process(
            available_unreserved_timber,
            lodge.woodcutter_timber_reserve,
            timber_needed,
        )
    {
        return lodge;
    }

    let (_, _, _, lodge_after_withdraw) = withdraw_building(&lodge, timber_needed, 0.0, 0.0);
    let (_, firewood_added, _, mut processed) =
        deposit_building(&lodge_after_withdraw, caps, 0.0, firewood_output, 0.0);
    if firewood_added <= 0.0 {
        return lodge;
    }
    if tools_maintained {
        withdraw_building_commodity(
            &mut processed,
            CommodityKind::Ironwork,
            CIVILIAN_TOOL_IRONWORK_PER_CYCLE,
        );
    }
    processed
}
