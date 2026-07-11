use spacetimedb::ReducerContext;

use crate::building_defs::building_def;
use crate::constants::{
    FIREWOOD_DELIVERY_SPEED_MPS, FIREWOOD_DELIVERY_UNLOAD_SEC, LODGE_FIREWOOD_PER_CYCLE,
    LODGE_FIREWOOD_PER_DELIVERY, LODGE_TIMBER_PER_CYCLE, TICK_DT,
};
use crate::db::*;
use crate::economy::{building_storage_caps, deposit_building, withdraw_building};
use crate::simulation::delivery_cargo::{any_target_needs_delivery, collect_claimed_delivery_targets};
use crate::simulation::delivery_supplier::{
    delivery_work_ready, dispatch_delivery_if_ready, should_alternate_single_worker,
    DeliveryDispatchConfig,
};
use crate::simulation::residence_needs::{
    load_needs, need_stock, ResidenceNeedKind,
};
use crate::simulation::road_logistics::{
    claim_residences_for_lodges, lodge_labor_split, owner_lodges, sort_mills_by_road_path,
    sort_residences_for_delivery,
};
use crate::simulation::tick_context::SimTickContext;
use crate::tables::{Building, Residence};

pub fn step_woodcutters_lodge(ctx: &ReducerContext, tick: &SimTickContext, building: Building) {
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
    lodge.action_cooldown = (lodge.action_cooldown - TICK_DT).max(0.0);

    let split = lodge_labor_split(lodge.assigned_labor);
    let single_worker = lodge.assigned_labor == 1;
    let process_ready = split.processing > 0 && lodge.action_cooldown <= 0.0;
    let delivery_ready =
        delivery_work_ready(split.delivering, lodge.firewood > 0.0, lodge.id, ctx);

    let delivery_targets = if delivery_ready {
        collect_delivery_targets(ctx, network, &lodge)
    } else {
        Vec::new()
    };
    let has_target = any_target_needs_delivery(ctx, &delivery_targets, ResidenceNeedKind::Firewood);

    let (do_deliver, do_process) = should_alternate_single_worker(
        single_worker,
        process_ready,
        delivery_ready,
        has_target,
    );

    if do_process {
        lodge = process_timber_to_firewood(ctx, tick, network, lodge, split.processing);
        lodge.action_cooldown = def.action_interval;
    }
    if do_deliver {
        dispatch_delivery_if_ready(
            ctx,
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
    network: &crate::roads::RoadNetwork,
    lodge: &Building,
) -> Vec<Residence> {
    let lodges = owner_lodges(ctx, lodge.owner);
    let residences: Vec<Residence> = ctx
        .db
        .residence()
        .owner()
        .filter(&lodge.owner)
        .collect();
    let claims = claim_residences_for_lodges(network, &lodges, &residences);

    collect_claimed_delivery_targets(residences, &claims, lodge.id, |targets| {
        sort_residences_for_delivery(network, lodge, targets, |residence| {
            need_stock(
                &load_needs(ctx, residence.id),
                ResidenceNeedKind::Firewood,
            )
        });
    })
}

fn process_timber_to_firewood(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    network: &crate::roads::RoadNetwork,
    lodge: Building,
    processing_workers: u32,
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

    let lodge = ensure_lodge_timber(ctx, tick, network, lodge, timber_needed);
    if lodge.timber + 1e-6 < timber_needed {
        return lodge;
    }

    let (_, _, _, lodge_after_withdraw) = withdraw_building(&lodge, timber_needed, 0.0, 0.0);
    let (_, firewood_added, _, processed) =
        deposit_building(&lodge_after_withdraw, caps, 0.0, firewood_output, 0.0);
    if firewood_added <= 0.0 {
        return lodge;
    }
    processed
}

fn ensure_lodge_timber(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    network: &crate::roads::RoadNetwork,
    mut lodge: Building,
    needed: f64,
) -> Building {
    if lodge.timber + 1e-6 >= needed {
        return lodge;
    }

    let caps = building_storage_caps(&lodge.kind);
    let mut remaining = needed - lodge.timber;
    let mut mills: Vec<Building> = ctx
        .db
        .building()
        .owner()
        .filter(&lodge.owner)
        .filter(|row| {
            row.kind == "lumber_mill"
                && row.timber > 0.0
                && tick.road_connected(lodge.owner, row.x, row.z, lodge.x, lodge.z)
        })
        .collect();
    sort_mills_by_road_path(network, &lodge, &mut mills);

    for mill in mills {
        if remaining <= 1e-6 {
            break;
        }
        let lodge_room = (caps.timber - lodge.timber).max(0.0);
        if lodge_room <= 1e-6 {
            break;
        }
        let request = remaining.min(lodge_room).min(mill.timber);
        let (withdrawn, _, _, reduced_mill) = withdraw_building(&mill, request, 0.0, 0.0);
        if withdrawn <= 0.0 {
            continue;
        }
        ctx.db.building().id().update(reduced_mill);
        let (_, _, _, updated_lodge) = deposit_building(&lodge, caps, withdrawn, 0.0, 0.0);
        lodge = updated_lodge;
        remaining = needed - lodge.timber;
    }

    lodge
}
