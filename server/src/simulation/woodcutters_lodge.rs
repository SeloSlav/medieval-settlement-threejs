use spacetimedb::ReducerContext;

use crate::building_defs::building_def;
use crate::constants::{
    LODGE_DELIVERY_INTERVAL, LODGE_FIREWOOD_PER_CYCLE, LODGE_FIREWOOD_PER_DELIVERY,
    LODGE_TIMBER_PER_CYCLE, TICK_DT,
};
use crate::db::*;
use crate::economy::{building_storage_caps, deposit_building, withdraw_building};
use crate::simulation::road_logistics::{
    claim_residences_for_lodges, lodge_labor_split, owner_lodges, sort_mills_by_road_path,
    sort_residences_for_delivery,
};
use crate::simulation::tick_context::SimTickContext;
use crate::simulation::residence_needs::{
    apply_need_delivery, load_needs, need_stock, ResidenceNeedKind,
};
use crate::simulation::residence_needs::firewood;
use crate::tables::{Building, Residence};

pub fn step_woodcutters_lodge(ctx: &ReducerContext, tick: &SimTickContext, building: Building) {
    let Some(def) = building_def(&building.kind) else {
        return;
    };
    let Some(network) = tick.road_network(building.owner) else {
        ctx.db.building().id().update(Building {
            action_cooldown: (building.action_cooldown - TICK_DT).max(0.0),
            delivery_cooldown: (building.delivery_cooldown - TICK_DT).max(0.0),
            ..building
        });
        return;
    };

    let mut lodge = building;
    lodge.action_cooldown = (lodge.action_cooldown - TICK_DT).max(0.0);
    lodge.delivery_cooldown = (lodge.delivery_cooldown - TICK_DT).max(0.0);

    let split = lodge_labor_split(lodge.assigned_labor);
    let single_worker = lodge.assigned_labor == 1;
    let process_ready = split.processing > 0 && lodge.action_cooldown <= 0.0;
    let delivery_ready =
        split.delivering > 0 && lodge.delivery_cooldown <= 0.0 && lodge.firewood > 0.0;

    let delivery_targets = if delivery_ready {
        collect_delivery_targets(ctx, network, &lodge)
    } else {
        Vec::new()
    };
    let has_target = delivery_targets.iter().any(|residence| {
        let stock = need_stock(&load_needs(ctx, residence.id), ResidenceNeedKind::Firewood);
        firewood::has_stock_room(stock)
    });

    let do_deliver =
        delivery_ready && (!single_worker || !process_ready || has_target);
    let do_process =
        process_ready && (!single_worker || !delivery_ready || !has_target);

    if do_process {
        lodge = process_timber_to_firewood(ctx, tick, network, lodge, split.processing);
        lodge.action_cooldown = def.action_interval;
    }
    if do_deliver {
        deliver_firewood_trip(ctx, &mut lodge, split.delivering, &delivery_targets);
        lodge.delivery_cooldown = LODGE_DELIVERY_INTERVAL / split.delivering as f64;
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

    let mut targets: Vec<Residence> = residences
        .into_iter()
        .filter(|residence| claims.get(&residence.id).copied() == Some(lodge.id))
        .collect();
    sort_residences_for_delivery(network, lodge, &mut targets, |residence| {
        need_stock(
            &load_needs(ctx, residence.id),
            ResidenceNeedKind::Firewood,
        )
    });
    targets
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

fn deliver_firewood_trip(
    ctx: &ReducerContext,
    lodge: &mut Building,
    delivery_workers: u32,
    targets: &[Residence],
) {
    if lodge.firewood <= 0.0 || delivery_workers == 0 {
        return;
    }

    let batch = LODGE_FIREWOOD_PER_DELIVERY * delivery_workers as f64;
    let mut available = lodge.firewood;

    for residence in targets {
        if available <= 1e-6 {
            break;
        }
        let stock = need_stock(
            &load_needs(ctx, residence.id),
            ResidenceNeedKind::Firewood,
        );
        if !firewood::has_stock_room(stock) {
            continue;
        }
        let room = (firewood::stock_capacity() - stock).max(0.0);
        if room <= 1e-6 {
            continue;
        }
        let delivered = available.min(room).min(batch);
        if delivered <= 1e-6 {
            continue;
        }
        available -= delivered;
        apply_need_delivery(ctx, residence.id, ResidenceNeedKind::Firewood, delivered);
        break;
    }

    lodge.firewood = available;
}
