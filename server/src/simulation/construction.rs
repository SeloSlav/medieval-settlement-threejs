//! Material reservations, construction hauling, and builder progress.

use spacetimedb::ReducerContext;

use crate::balance_generated::{
    CONSTRUCTION_DELIVERY_UNLOAD_SEC, CONSTRUCTION_TREASURY_TRANSFER_PER_SEC,
    CONSTRUCTION_WORK_PER_WORKER_PER_SEC, FARMSTEAD_STARTER_SEED_GRAIN, TICK_DT,
};
use crate::building_defs::building_def;
use crate::construction_priority::{
    construction_priority_bucket, CONSTRUCTION_PRIORITY_HOLD, CONSTRUCTION_PRIORITY_LEVELS,
    CONSTRUCTION_PRIORITY_NORMAL,
};
use crate::db::*;
use crate::economy::{available_building_labor, building_commodity_stock, CommodityKind};
use crate::reducers::livestock::{starter_herd, SPECIES_CATTLE, SPECIES_SWINE};
use crate::roads::RoadNetwork;
use crate::simulation::delivery_trips::{
    building_has_active_trip, building_has_inbound_supply_trip, try_start_construction_supply_trip,
    DELIVERY_DESTINATION_BUILDING,
};
use crate::simulation::{labor_and_logistics_paused, GameClock, SimTickContext};
use crate::supply_policy::{construction_source_priority, select_supply_route_candidate};
use crate::tables::Building;

pub fn step_construction_sites(ctx: &ReducerContext, tick: &SimTickContext, clock: &GameClock) {
    let mut site_buckets: [Vec<u64>; CONSTRUCTION_PRIORITY_LEVELS] =
        std::array::from_fn(|_| Vec::new());
    for building in ctx
        .db
        .building()
        .iter()
        .filter(|building| !building.construction_complete)
    {
        let bucket = construction_priority_bucket(building.construction_priority);
        if bucket > CONSTRUCTION_PRIORITY_HOLD as usize {
            site_buckets[bucket].push(building.id);
        }
    }

    // Four fixed buckets keep dispatch linear while urgent sites get first
    // claim on busy carts and scarce physical stores.
    for site_id in site_buckets.into_iter().rev().flatten() {
        let Some(mut site) = ctx.db.building().id().find(&site_id) else {
            continue;
        };

        transfer_treasury_reserve(ctx, tick, clock, &mut site);
        dispatch_reserved_stock(ctx, tick, clock, &mut site, CommodityKind::Stone);
        dispatch_reserved_stock(ctx, tick, clock, &mut site, CommodityKind::Timber);
        advance_builder_work(ctx, tick, clock, site);
    }
}

fn transfer_treasury_reserve(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    site: &mut Building,
) {
    if site.assigned_labor == 0 || labor_and_logistics_paused(ctx, tick, site.owner, clock) {
        return;
    }
    let Some(mut treasury) = ctx.db.player_resources().owner().find(&site.owner) else {
        return;
    };
    let mut transfer_budget =
        CONSTRUCTION_TREASURY_TRANSFER_PER_SEC * site.assigned_labor as f64 * TICK_DT;

    let stone = transfer_budget
        .min(site.construction_treasury_stone)
        .min(treasury.stone);
    if stone > 1e-6 {
        treasury.stone -= stone;
        site.construction_treasury_stone -= stone;
        site.construction_reserved_stone = (site.construction_reserved_stone - stone).max(0.0);
        site.construction_delivered_stone += stone;
        transfer_budget -= stone;
    }

    let timber = transfer_budget
        .min(site.construction_treasury_timber)
        .min(treasury.timber);
    if timber > 1e-6 {
        treasury.timber -= timber;
        site.construction_treasury_timber -= timber;
        site.construction_reserved_timber = (site.construction_reserved_timber - timber).max(0.0);
        site.construction_delivered_timber += timber;
    }

    ctx.db.player_resources().owner().update(treasury);
    ctx.db.building().id().update(site.clone());
}

fn dispatch_reserved_stock(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    site: &mut Building,
    commodity: CommodityKind,
) {
    let physical_reserved = match commodity {
        CommodityKind::Timber => {
            (site.construction_reserved_timber - site.construction_treasury_timber).max(0.0)
        }
        CommodityKind::Stone => {
            (site.construction_reserved_stone - site.construction_treasury_stone).max(0.0)
        }
        _ => 0.0,
    };
    if physical_reserved <= 1e-6 || site_has_inbound_cargo(ctx, site.id, commodity) {
        return;
    }
    if labor_and_logistics_paused(ctx, tick, site.owner, clock) {
        return;
    }
    let Some(network) = tick.road_network(site.owner) else {
        return;
    };
    let allow_offroad = building_def(&site.kind).is_some_and(|def| !def.requires_road);
    let free_haulers = available_construction_haulers(ctx, site.owner);
    let mut source_groups: [Vec<Building>; 8] = std::array::from_fn(|_| Vec::new());
    for source_id in tick.construction_source_ids(ctx, site.owner, commodity) {
        let Some(source) = ctx.db.building().id().find(&source_id) else {
            continue;
        };
        if source.id == site.id
            || !source.construction_complete
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

    // Preserve the existing storehouse/specialist preference, but compare
    // candidates inside each priority class by real road distance. Only the
    // first reachable class performs a dispatch, so no whole-set sort or route
    // polyline construction is needed for candidates that cannot win.
    for sources in source_groups {
        let selected = select_supply_route_candidate(
            sources.into_iter().filter_map(|source| {
                construction_route_distance(&network, &source, site, allow_offroad)
                    .map(|distance| (source, distance))
            }),
            |candidate| candidate.1,
            |candidate| candidate.0.id,
        );
        let Some((mut source, _distance)) = selected else {
            continue;
        };
        if try_start_construction_supply_trip(
            ctx,
            tick,
            clock,
            &network,
            &mut source,
            site,
            commodity,
            allow_offroad,
            free_haulers,
        ) {
            return;
        }
    }
}

fn construction_route_distance(
    network: &RoadNetwork,
    source: &Building,
    site: &Building,
    allow_offroad: bool,
) -> Option<f64> {
    network
        .road_path_distance(source.x, source.z, site.x, site.z)
        .or_else(|| {
            if !allow_offroad {
                return None;
            }
            let distance = ((site.x - source.x).powi(2) + (site.z - source.z).powi(2)).sqrt();
            (distance > 1e-6).then_some(distance)
        })
}

fn advance_builder_work(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    mut site: Building,
) {
    if site.assigned_labor == 0 || labor_and_logistics_paused(ctx, tick, site.owner, clock) {
        return;
    }
    let required_total = site.construction_required_timber + site.construction_required_stone;
    let delivered_total = site.construction_delivered_timber + site.construction_delivered_stone;
    let material_readiness = if required_total <= 1e-6 {
        1.0
    } else {
        (delivered_total / required_total).clamp(0.0, 1.0)
    };
    let work_step = if required_total <= 1e-6 {
        1.0
    } else {
        CONSTRUCTION_WORK_PER_WORKER_PER_SEC * site.assigned_labor as f64 * TICK_DT / required_total
    };
    site.construction_progress = (site.construction_progress + work_step).min(material_readiness);

    let timber_ready =
        site.construction_delivered_timber + 1e-6 >= site.construction_required_timber;
    let stone_ready = site.construction_delivered_stone + 1e-6 >= site.construction_required_stone;
    if timber_ready && stone_ready && site.construction_progress >= 1.0 - 1e-6 {
        complete_site(ctx, &mut site);
        if site.kind == "chapel" {
            tick.invalidate_staffed_chapel(site.owner);
        }
    }
    ctx.db.building().id().update(site);
}

fn complete_site(ctx: &ReducerContext, site: &mut Building) {
    site.construction_complete = true;
    site.construction_progress = 1.0;
    site.construction_reserved_timber = 0.0;
    site.construction_reserved_stone = 0.0;
    site.construction_treasury_timber = 0.0;
    site.construction_treasury_stone = 0.0;
    site.construction_priority = CONSTRUCTION_PRIORITY_NORMAL;
    site.assigned_labor = 0;

    if site.kind == "threshing_barn" {
        // A newly established holding arrives with enough seed for roughly one
        // efficient field. Later expansion must come from its own harvest or a
        // road-linked granary, avoiding a first-crop grain deadlock.
        site.grain += FARMSTEAD_STARTER_SEED_GRAIN;
    } else if site.kind == "pastoral_farmstead"
        && ctx
            .db
            .livestock_herd()
            .building_id()
            .find(&site.id)
            .is_none()
    {
        ctx.db
            .livestock_herd()
            .insert(starter_herd(site.id, site.owner, SPECIES_CATTLE));
    } else if site.kind == "swineherd"
        && ctx
            .db
            .livestock_herd()
            .building_id()
            .find(&site.id)
            .is_none()
    {
        ctx.db
            .livestock_herd()
            .insert(starter_herd(site.id, site.owner, SPECIES_SWINE));
    }
}

fn site_has_inbound_cargo(ctx: &ReducerContext, site_id: u64, commodity: CommodityKind) -> bool {
    ctx.db
        .delivery_trip()
        .target_building_id()
        .filter(&site_id)
        .any(|trip| {
            trip.destination_kind == DELIVERY_DESTINATION_BUILDING
                && trip.cargo_kind == commodity.as_u8()
        })
}

fn available_construction_haulers(ctx: &ReducerContext, owner: spacetimedb::Identity) -> u32 {
    let active_free_haulers: u32 = ctx
        .db
        .delivery_trip()
        .owner()
        .filter(&owner)
        .filter(|trip| {
            if trip.destination_kind != DELIVERY_DESTINATION_BUILDING {
                return false;
            }
            let is_construction_cargo =
                matches!(
                    CommodityKind::from_u8(trip.cargo_kind),
                    Some(CommodityKind::Timber | CommodityKind::Stone)
                ) && (trip.unload_seconds - CONSTRUCTION_DELIVERY_UNLOAD_SEC).abs() <= 1e-6;
            let origin_is_unstaffed = ctx
                .db
                .building()
                .id()
                .find(&trip.building_id)
                .is_some_and(|origin| origin.assigned_labor == 0);
            is_construction_cargo && origin_is_unstaffed
        })
        .map(|trip| trip.delivery_workers)
        .sum();

    available_building_labor(ctx, owner).saturating_sub(active_free_haulers)
}
