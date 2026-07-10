use spacetimedb::ReducerContext;

use crate::building_defs::building_def;
use crate::constants::{
    LODGE_DELIVERY_INTERVAL, LODGE_FIREWOOD_PER_CYCLE, LODGE_FIREWOOD_PER_DELIVERY,
    LODGE_TIMBER_PER_CYCLE, TICK_DT,
};
use crate::db::*;
use crate::economy::{building_storage_caps, deposit_building, withdraw_building};
use crate::simulation::road_logistics::{
    claim_residences_for_lodges, owner_lodges, sort_mills_by_road_path,
    sort_residences_for_delivery,
};
use crate::simulation::tick_context::SimTickContext;
use crate::tables::{Building, Residence};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct LodgeLaborSplit {
    processing: u32,
    delivering: u32,
}

fn lodge_labor_split(assigned: u32) -> LodgeLaborSplit {
    match assigned {
        0 => LodgeLaborSplit {
            processing: 0,
            delivering: 0,
        },
        1 => LodgeLaborSplit {
            processing: 1,
            delivering: 1,
        },
        workers => LodgeLaborSplit {
            processing: workers - 1,
            delivering: 1,
        },
    }
}

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

    if single_worker {
        if delivery_ready && process_ready {
            if lodge_has_delivery_target(ctx, network, &lodge) {
                deliver_firewood_trip(ctx, network, &mut lodge, split.delivering);
                lodge.delivery_cooldown =
                    LODGE_DELIVERY_INTERVAL / split.delivering.max(1) as f64;
            } else {
                lodge = process_timber_to_firewood(ctx, tick, network, lodge, split.processing);
                lodge.action_cooldown = def.action_interval;
            }
        } else if delivery_ready {
            deliver_firewood_trip(ctx, network, &mut lodge, split.delivering);
            lodge.delivery_cooldown = LODGE_DELIVERY_INTERVAL / split.delivering.max(1) as f64;
        } else if process_ready {
            lodge = process_timber_to_firewood(ctx, tick, network, lodge, split.processing);
            lodge.action_cooldown = def.action_interval;
        }
    } else {
        if process_ready {
            lodge = process_timber_to_firewood(ctx, tick, network, lodge, split.processing);
            lodge.action_cooldown = def.action_interval;
        }
        if delivery_ready {
            deliver_firewood_trip(ctx, network, &mut lodge, split.delivering);
            lodge.delivery_cooldown = LODGE_DELIVERY_INTERVAL / split.delivering.max(1) as f64;
        }
    }

    ctx.db.building().id().update(lodge);
}

fn lodge_has_delivery_target(
    ctx: &ReducerContext,
    network: &crate::roads::RoadNetwork,
    lodge: &Building,
) -> bool {
    let lodges = owner_lodges(ctx, lodge.owner);
    let residences: Vec<Residence> = ctx
        .db
        .residence()
        .owner()
        .filter(&lodge.owner)
        .filter(|residence| !residence.abandoned)
        .collect();
    let claims = claim_residences_for_lodges(network, &lodges, &residences);
    let capacity = crate::economy::residence_firewood_capacity();

    residences.iter().any(|residence| {
        claims.get(&residence.id).copied() == Some(lodge.id)
            && (capacity - residence.firewood_stock) > 1e-6
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

fn deliver_firewood_trip(
    ctx: &ReducerContext,
    network: &crate::roads::RoadNetwork,
    lodge: &mut Building,
    delivery_workers: u32,
) {
    if lodge.firewood <= 0.0 || delivery_workers == 0 {
        return;
    }

    let lodges = owner_lodges(ctx, lodge.owner);
    let residences: Vec<Residence> = ctx
        .db
        .residence()
        .owner()
        .filter(&lodge.owner)
        .filter(|residence| !residence.abandoned)
        .collect();
    let claims = claim_residences_for_lodges(network, &lodges, &residences);

    let mut targets: Vec<Residence> = residences
        .into_iter()
        .filter(|residence| claims.get(&residence.id).copied() == Some(lodge.id))
        .collect();
    sort_residences_for_delivery(network, lodge, &mut targets);

    let capacity = crate::economy::residence_firewood_capacity();
    let batch = LODGE_FIREWOOD_PER_DELIVERY * delivery_workers as f64;
    let mut available = lodge.firewood;

    for residence in targets {
        if available <= 1e-6 {
            break;
        }
        let room = (capacity - residence.firewood_stock).max(0.0);
        if room <= 1e-6 {
            continue;
        }
        let delivered = available.min(room).min(batch);
        if delivered <= 1e-6 {
            continue;
        }
        available -= delivered;
        ctx.db.residence().id().update(Residence {
            firewood_stock: residence.firewood_stock + delivered,
            needs_deficit_ticks: 0,
            ..residence
        });
        break;
    }

    lodge.firewood = available;
}
