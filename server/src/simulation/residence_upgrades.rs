//! Physical household improvement works: reservations, carted materials,
//! visible builders, and staged completion.

use std::collections::{HashMap, HashSet};

use spacetimedb::ReducerContext;

use crate::balance_generated::{
    CONSTRUCTION_WORK_PER_WORKER_PER_SEC, RESIDENCE_TIER2_CAPACITY, RESIDENCE_TIER3_CAPACITY,
    TICK_DT,
};
use crate::construction_priority::{
    construction_priority_bucket, CONSTRUCTION_PRIORITY_HOLD, CONSTRUCTION_PRIORITY_LEVELS,
    CONSTRUCTION_PRIORITY_NORMAL,
};
use crate::db::*;
use crate::economy::{available_building_labor, building_commodity_stock, CommodityKind};
use crate::residence_upgrade_policy::{
    advance_residence_upgrade, residence_upgrade_complete, ResidenceUpgradeWork,
};
use crate::simulation::delivery_trips::{
    available_free_haulers, building_has_active_trip, building_has_inbound_supply_trip,
    try_start_residence_upgrade_supply_trip, DeliveryTripPhase, DELIVERY_DESTINATION_RESIDENCE,
};
use crate::simulation::{
    ensure_residence_needs, labor_and_logistics_paused, GameClock, SimTickContext,
};
use crate::supply_policy::{construction_source_priority, select_supply_route_candidate};
use crate::tables::{Building, Residence};

const UPGRADE_TREASURY_KINDS: &[&str] = &["town_hall", "founders_camp", "salvage_pile"];

pub fn step_residence_upgrades(ctx: &ReducerContext, tick: &SimTickContext, clock: &GameClock) {
    let mut owner_buckets: HashMap<
        spacetimedb::Identity,
        [Vec<u64>; CONSTRUCTION_PRIORITY_LEVELS],
    > = HashMap::new();
    for mut residence in ctx
        .db
        .residence()
        .iter()
        .filter(|residence| residence.upgrade_target_tier > residence.tier)
    {
        let suspended = residence.abandoned
            || residence.population == 0
            || tick.residence_disabled_by_fire(ctx, residence.id)
            || construction_priority_bucket(residence.upgrade_priority)
                == CONSTRUCTION_PRIORITY_HOLD as usize;
        if suspended {
            if residence.upgrade_assigned_labor != 0 {
                residence.upgrade_assigned_labor = 0;
                ctx.db.residence().id().update(residence);
            }
            continue;
        }
        owner_buckets
            .entry(residence.owner)
            .or_insert_with(|| std::array::from_fn(|_| Vec::new()))
            [construction_priority_bucket(residence.upgrade_priority)]
        .push(residence.id);
    }

    for buckets in owner_buckets.into_values() {
        rebalance_upgrade_builders(ctx, &buckets);

        // Fixed priority buckets avoid sorting a large housing stock. Higher
        // priority households claim scarce source carts and builders first.
        for residence_id in buckets.into_iter().rev().flatten() {
            let Some(mut residence) = ctx.db.residence().id().find(&residence_id) else {
                continue;
            };
            dispatch_upgrade_material(ctx, tick, clock, &mut residence, CommodityKind::Gold);
            dispatch_upgrade_material(ctx, tick, clock, &mut residence, CommodityKind::Stone);
            dispatch_upgrade_material(ctx, tick, clock, &mut residence, CommodityKind::Timber);
            advance_upgrade_work(ctx, tick, clock, residence);
        }
    }
}

fn rebalance_upgrade_builders(
    ctx: &ReducerContext,
    buckets: &[Vec<u64>; CONSTRUCTION_PRIORITY_LEVELS],
) {
    let active_ids = buckets
        .iter()
        .skip(1)
        .flatten()
        .copied()
        .collect::<Vec<_>>();
    if active_ids.is_empty() {
        return;
    }
    let current_builders = active_ids
        .iter()
        .filter_map(|id| ctx.db.residence().id().find(id))
        .map(|residence| residence.upgrade_assigned_labor.min(1))
        .sum::<u32>();
    let owner = active_ids
        .first()
        .and_then(|id| ctx.db.residence().id().find(id))
        .map(|residence| residence.owner);
    let Some(owner) = owner else {
        return;
    };
    let mut remaining = current_builders.saturating_add(available_building_labor(ctx, owner));
    let mut selected = HashSet::new();

    // Keep already-present builders inside each priority tier before starting
    // another commute; priority can still preempt every lower tier.
    for ids in buckets.iter().skip(1).rev() {
        for id in ids {
            if remaining == 0 {
                break;
            }
            if ctx
                .db
                .residence()
                .id()
                .find(id)
                .is_some_and(|residence| residence.upgrade_assigned_labor > 0)
            {
                selected.insert(*id);
                remaining -= 1;
            }
        }
        for id in ids {
            if remaining == 0 {
                break;
            }
            if selected.insert(*id) {
                remaining -= 1;
            }
        }
    }

    for id in active_ids {
        let Some(mut residence) = ctx.db.residence().id().find(&id) else {
            continue;
        };
        let assigned = u32::from(selected.contains(&id));
        if residence.upgrade_assigned_labor != assigned {
            residence.upgrade_assigned_labor = assigned;
            ctx.db.residence().id().update(residence);
        }
    }
}

fn dispatch_upgrade_material(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    residence: &mut Residence,
    commodity: CommodityKind,
) {
    // A queued project does not create cart traffic until it has actually won
    // a builder from the shared labor pool. This bounds route/source work by
    // available labor and makes priority changes immediately meaningful.
    if residence.upgrade_assigned_labor == 0 {
        return;
    }
    let reserved = match commodity {
        CommodityKind::Timber => residence.upgrade_reserved_timber,
        CommodityKind::Stone => residence.upgrade_reserved_stone,
        CommodityKind::Gold => residence.upgrade_reserved_gold,
        _ => 0.0,
    };
    if reserved <= 1e-6
        || has_inbound_upgrade_material(ctx, residence.id, commodity)
        || labor_and_logistics_paused(ctx, tick, residence.owner, clock)
    {
        return;
    }
    let Some(network) = tick.road_network(residence.owner) else {
        return;
    };
    let free_haulers = available_free_haulers(ctx, residence.owner);

    if commodity == CommodityKind::Gold {
        if free_haulers == 0 {
            return;
        }
        for source_id in tick.building_ids_for_kinds(ctx, residence.owner, UPGRADE_TREASURY_KINDS) {
            let Some(mut source) = ctx.db.building().id().find(&source_id) else {
                continue;
            };
            if !source.construction_complete
                || source.gold <= 1e-6
                || tick.building_disabled_by_fire(ctx, source.id)
                || building_has_active_trip(ctx, source.id)
            {
                continue;
            }
            let allow_offroad = source.kind == "founders_camp";
            if try_start_residence_upgrade_supply_trip(
                ctx,
                tick,
                clock,
                &network,
                &mut source,
                residence,
                commodity,
                allow_offroad,
                free_haulers,
            ) {
                return;
            }
        }
        return;
    }

    let mut source_groups: [Vec<Building>; 8] = std::array::from_fn(|_| Vec::new());
    for source_id in tick.construction_source_ids(ctx, residence.owner, commodity) {
        let Some(source) = ctx.db.building().id().find(&source_id) else {
            continue;
        };
        if !source.construction_complete
            || tick.building_disabled_by_fire(ctx, source.id)
            || building_has_active_trip(ctx, source.id)
            || (source.kind == "village_storehouse"
                && building_has_inbound_supply_trip(ctx, source.id))
            || building_commodity_stock(&source, commodity) <= 1e-6
            || (source.assigned_labor == 0 && free_haulers == 0)
        {
            continue;
        }
        source_groups[construction_source_priority(&source.kind, source.assigned_labor) as usize]
            .push(source);
    }

    for sources in source_groups {
        let selected = select_supply_route_candidate(
            sources.into_iter().filter_map(|source| {
                upgrade_route_distance(&network, &source, residence)
                    .map(|distance| (source, distance))
            }),
            |candidate| candidate.1,
            |candidate| candidate.0.id,
        );
        let Some((mut source, _distance)) = selected else {
            continue;
        };
        let allow_offroad = source.kind == "founders_camp";
        if try_start_residence_upgrade_supply_trip(
            ctx,
            tick,
            clock,
            &network,
            &mut source,
            residence,
            commodity,
            allow_offroad,
            free_haulers,
        ) {
            return;
        }
    }
}

fn upgrade_route_distance(
    network: &crate::roads::RoadNetwork,
    source: &Building,
    residence: &Residence,
) -> Option<f64> {
    network
        .road_path_distance(source.x, source.z, residence.x, residence.z)
        .or_else(|| {
            if source.kind != "founders_camp" {
                return None;
            }
            let distance =
                ((residence.x - source.x).powi(2) + (residence.z - source.z).powi(2)).sqrt();
            (distance > 1e-6).then_some(distance)
        })
}

fn has_inbound_upgrade_material(
    ctx: &ReducerContext,
    residence_id: u64,
    commodity: CommodityKind,
) -> bool {
    ctx.db
        .delivery_trip()
        .residence_id()
        .filter(&residence_id)
        .any(|trip| {
            trip.destination_kind == DELIVERY_DESTINATION_RESIDENCE
                && trip.cargo_kind == commodity.as_u8()
                && DeliveryTripPhase::from_u8(trip.phase) != Some(DeliveryTripPhase::Inbound)
        })
}

fn advance_upgrade_work(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    mut residence: Residence,
) {
    if residence.upgrade_assigned_labor == 0
        || labor_and_logistics_paused(ctx, tick, residence.owner, clock)
    {
        return;
    }
    let work = ResidenceUpgradeWork {
        progress: residence.upgrade_progress,
        required_timber: residence.upgrade_required_timber,
        required_stone: residence.upgrade_required_stone,
        required_gold: residence.upgrade_required_gold,
        delivered_timber: residence.upgrade_delivered_timber,
        delivered_stone: residence.upgrade_delivered_stone,
        delivered_gold: residence.upgrade_delivered_gold,
        assigned_labor: residence.upgrade_assigned_labor,
    };
    residence.upgrade_progress =
        advance_residence_upgrade(work, TICK_DT, CONSTRUCTION_WORK_PER_WORKER_PER_SEC);
    let completed = residence_upgrade_complete(ResidenceUpgradeWork {
        progress: residence.upgrade_progress,
        ..work
    });
    if completed {
        complete_upgrade(&mut residence);
        let residence_id = residence.id;
        ctx.db.residence().id().update(residence);
        // Needs depend on the new tier, so regenerate them only after the
        // upgraded row is authoritative.
        ensure_residence_needs(ctx, residence_id);
        return;
    }
    ctx.db.residence().id().update(residence);
}

fn complete_upgrade(residence: &mut Residence) {
    residence.tier = residence.upgrade_target_tier.min(3);
    residence.population_capacity = match residence.tier {
        2 => RESIDENCE_TIER2_CAPACITY,
        3 => RESIDENCE_TIER3_CAPACITY,
        _ => residence.population_capacity,
    };
    residence.settlement_ticks = 0;
    residence.upgrade_target_tier = 0;
    residence.upgrade_progress = 0.0;
    residence.upgrade_required_timber = 0.0;
    residence.upgrade_required_stone = 0.0;
    residence.upgrade_required_gold = 0.0;
    residence.upgrade_delivered_timber = 0.0;
    residence.upgrade_delivered_stone = 0.0;
    residence.upgrade_delivered_gold = 0.0;
    residence.upgrade_reserved_timber = 0.0;
    residence.upgrade_reserved_stone = 0.0;
    residence.upgrade_reserved_gold = 0.0;
    residence.upgrade_assigned_labor = 0;
    residence.upgrade_priority = CONSTRUCTION_PRIORITY_NORMAL;
}
