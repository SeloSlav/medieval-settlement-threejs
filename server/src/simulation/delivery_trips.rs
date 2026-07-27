//! Authoritative road delivery agents — cargo unloads when the agent reaches the destination.

use spacetimedb::ReducerContext;

use crate::balance_generated::CARPENTER_DELIVERY_SPEED_MULTIPLIER;
use crate::balance_generated::{
    CONSTRUCTION_DELIVERY_SPEED_MPS, CONSTRUCTION_DELIVERY_UNLOAD_SEC,
    CONSTRUCTION_HAUL_PER_WORKER, FIRE_BUCKET_SPEED_MPS, FIRE_BUCKET_UNLOAD_SECONDS,
    STOREHOUSE_HAUL_PER_WORKER,
};
use crate::db::*;
use crate::economy::{
    available_building_labor, building_commodity_room, building_commodity_stock,
    chapel_monastery_tithe_due, credit_treasury_commodity, deposit_building_commodity,
    withdraw_building_commodity, CommodityKind,
};
use crate::fire_policy::fire_response_load;
use crate::roads::{RoadNetwork, RoadPathRoute};
use crate::season_policy::environment_for;
use crate::simulation::delivery_cargo::{
    building_delivery_stock, pick_delivery_target, residence_delivery_room,
    withdraw_delivery_cargo, DeliveryCargoTotals,
};
use crate::simulation::fires::{
    apply_fire_water, building_fire_state, release_fire_response, FIRE_TARGET_BUILDING,
    FIRE_TARGET_RESIDENCE,
};
use crate::simulation::game_calendar::{game_clock, GameClock};
use crate::simulation::labor_and_logistics_paused;
use crate::simulation::residence_needs::{apply_need_delivery, ResidenceNeedKind};
use crate::simulation::tick_context::SimTickContext;
use crate::tables::{Building, DeliveryTrip, FireIncident, Residence};

pub fn serialize_route_polyline(polyline: &[[f64; 2]]) -> String {
    serde_json::to_string(polyline).unwrap_or_default()
}

pub fn deserialize_route_polyline(json: &str) -> Option<Vec<[f64; 2]>> {
    if json.is_empty() {
        return None;
    }
    serde_json::from_str(json).ok()
}

fn cached_trip_route(
    ctx: &ReducerContext,
    network: &RoadNetwork,
    trip: &DeliveryTrip,
) -> Option<RoadPathRoute> {
    if trip.path_distance > 1e-6 {
        if let Some(polyline) = deserialize_route_polyline(&trip.route_polyline_json) {
            if polyline.len() >= 2 {
                return Some(RoadPathRoute {
                    distance: trip.path_distance,
                    polyline,
                });
            }
        }
    }
    trip_route(ctx, network, trip)
}

pub const DELIVERY_DESTINATION_RESIDENCE: u8 = 0;
pub const DELIVERY_DESTINATION_BUILDING: u8 = 1;
pub const DELIVERY_DESTINATION_FIRE: u8 = 2;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DeliveryTripPhase {
    Outbound = 0,
    Unloading = 1,
    Inbound = 2,
}

impl DeliveryTripPhase {
    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            0 => Some(Self::Outbound),
            1 => Some(Self::Unloading),
            2 => Some(Self::Inbound),
            _ => None,
        }
    }

    pub fn as_u8(self) -> u8 {
        self as u8
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TripCargoKind {
    Commodity(CommodityKind),
}

impl TripCargoKind {
    fn from_trip(trip: &DeliveryTrip) -> Option<Self> {
        CommodityKind::from_u8(trip.cargo_kind).map(Self::Commodity)
    }
}

#[derive(Clone, Copy, Debug)]
enum TripDestination {
    Residence { id: u64, x: f64, z: f64 },
    Building { id: u64, x: f64, z: f64 },
    FireBuilding { id: u64, x: f64, z: f64 },
    FireResidence { id: u64, x: f64, z: f64 },
}

impl TripDestination {
    fn to_row_fields(self) -> (u8, u64, u64) {
        match self {
            Self::Residence { id, .. } => (DELIVERY_DESTINATION_RESIDENCE, id, 0),
            Self::Building { id, .. } => (DELIVERY_DESTINATION_BUILDING, 0, id),
            Self::FireBuilding { id, .. } => (DELIVERY_DESTINATION_FIRE, 0, id),
            Self::FireResidence { id, .. } => (DELIVERY_DESTINATION_FIRE, id, 0),
        }
    }

    fn end_point(self) -> (f64, f64) {
        match self {
            Self::Residence { x, z, .. }
            | Self::Building { x, z, .. }
            | Self::FireBuilding { x, z, .. }
            | Self::FireResidence { x, z, .. } => (x, z),
        }
    }
}

struct StartTripSpec {
    origin: Building,
    destination: TripDestination,
    cargo_kind: u8,
    delivery_workers: u32,
    speed_mps: f64,
    unload_seconds: f64,
    load_amount: f64,
}

pub fn step_delivery_trips(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    elapsed_seconds: f64,
) {
    if !elapsed_seconds.is_finite() || elapsed_seconds <= 0.0 {
        return;
    }
    let trips: Vec<DeliveryTrip> = ctx.db.delivery_trip().iter().collect();
    for trip in trips {
        step_one_trip(ctx, tick, clock, trip, elapsed_seconds);
    }
}

pub fn building_has_active_trip(ctx: &ReducerContext, building_id: u64) -> bool {
    ctx.db
        .delivery_trip()
        .building_id()
        .filter(&building_id)
        .next()
        .is_some()
}

pub fn building_has_inbound_supply_trip(ctx: &ReducerContext, building_id: u64) -> bool {
    ctx.db
        .delivery_trip()
        .target_building_id()
        .filter(&building_id)
        .next()
        .is_some()
}

/// Free settlement labor still available to operate carts. Freelance crews are
/// recorded on DeliveryTrip and already deducted by the authoritative labor budget.
pub fn available_free_haulers(ctx: &ReducerContext, owner: spacetimedb::Identity) -> u32 {
    available_building_labor(ctx, owner)
}

fn free_hauler_workers_for_trip(origin: &Building, cargo_kind: u8, delivery_workers: u32) -> u32 {
    let is_chapel_gold_errand =
        origin.kind == "chapel" && cargo_kind == CommodityKind::Gold.as_u8();
    if origin.assigned_labor == 0 || is_chapel_gold_errand {
        delivery_workers
    } else {
        0
    }
}

/// Returns whether a matching commodity is still traveling to or unloading at
/// a building. Returning carts do not make a starved processor look as though
/// its supply is recovering.
pub fn building_has_inbound_commodity_trip(
    ctx: &ReducerContext,
    building_id: u64,
    commodity: CommodityKind,
) -> bool {
    ctx.db
        .delivery_trip()
        .target_building_id()
        .filter(&building_id)
        .any(|trip| {
            trip.destination_kind == DELIVERY_DESTINATION_BUILDING
                && trip.cargo_kind == commodity.as_u8()
                && DeliveryTripPhase::from_u8(trip.phase) != Some(DeliveryTripPhase::Inbound)
        })
}

/// Holding a construction site recalls any cart already bound for it. Cargo is
/// returned to its source and the site's reservation is restored atomically.
pub fn cancel_inbound_construction_trips_for_site(ctx: &ReducerContext, building_id: u64) {
    let trips: Vec<DeliveryTrip> = ctx
        .db
        .delivery_trip()
        .target_building_id()
        .filter(&building_id)
        .filter(|trip| trip.destination_kind == DELIVERY_DESTINATION_BUILDING)
        .collect();
    for trip in trips {
        return_trip_cargo_to_building(ctx, &trip);
        ctx.db.delivery_trip().id().delete(trip.id);
    }
}

/// Delete trips and return cart cargo totals without touching the building.
pub fn drain_trips_for_building(ctx: &ReducerContext, building_id: u64) -> DeliveryCargoTotals {
    let mut trips: Vec<DeliveryTrip> = ctx
        .db
        .delivery_trip()
        .building_id()
        .filter(&building_id)
        .collect();
    for trip in ctx
        .db
        .delivery_trip()
        .target_building_id()
        .filter(&building_id)
    {
        if trips.iter().all(|candidate| candidate.id != trip.id) {
            trips.push(trip);
        }
    }
    let mut totals = DeliveryCargoTotals::default();
    for trip in trips {
        release_trip_fire_claim(ctx, &trip);
        if let Some(kind) = CommodityKind::from_u8(trip.cargo_kind) {
            totals.add_commodity(kind, trip.amount);
            if trip.building_id == building_id
                && trip.destination_kind == DELIVERY_DESTINATION_BUILDING
            {
                if let Some(mut site) = ctx.db.building().id().find(&trip.target_building_id) {
                    if !site.construction_complete {
                        match kind {
                            CommodityKind::Timber => {
                                site.construction_reserved_timber += trip.amount;
                                site.construction_treasury_timber += trip.amount;
                            }
                            CommodityKind::Stone => {
                                site.construction_reserved_stone += trip.amount;
                                site.construction_treasury_stone += trip.amount;
                            }
                            _ => {}
                        }
                        ctx.db.building().id().update(site);
                    }
                }
            }
        }
        ctx.db.delivery_trip().id().delete(trip.id);
    }
    totals
}

pub fn cancel_trips_for_residence(ctx: &ReducerContext, residence_id: u64) {
    let trips: Vec<DeliveryTrip> = ctx
        .db
        .delivery_trip()
        .residence_id()
        .filter(&residence_id)
        .collect();
    for trip in trips {
        release_trip_fire_claim(ctx, &trip);
        return_trip_cargo_to_building(ctx, &trip);
        ctx.db.delivery_trip().id().delete(trip.id);
    }
}

pub fn try_start_delivery_trip(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    network: &RoadNetwork,
    building: &mut Building,
    delivery_workers: u32,
    targets: &[Residence],
    need_kind: ResidenceNeedKind,
    speed_mps: f64,
    unload_seconds: f64,
    per_delivery_amount: f64,
) -> bool {
    if delivery_workers == 0
        || tick.building_disabled_by_fire(ctx, building.id)
        || building_has_active_trip(ctx, building.id)
    {
        return false;
    }

    if labor_and_logistics_paused(ctx, tick, building.owner, clock) {
        return false;
    }

    let available = building_delivery_stock(building, need_kind);
    if available <= 1e-6 {
        return false;
    }

    let batch = per_delivery_amount * delivery_workers as f64;
    let Some((residence_id, residence_x, residence_z, load_amount)) =
        pick_delivery_target(ctx, available, batch, targets, need_kind, |residence_id| {
            !tick.residence_disabled_by_fire(ctx, residence_id)
        })
    else {
        return false;
    };

    try_start_road_trip(
        ctx,
        tick,
        clock,
        network,
        StartTripSpec {
            origin: building.clone(),
            destination: TripDestination::Residence {
                id: residence_id,
                x: residence_x,
                z: residence_z,
            },
            cargo_kind: need_kind.as_u8(),
            delivery_workers,
            speed_mps,
            unload_seconds,
            load_amount,
        },
        |origin, amount| withdraw_delivery_cargo(origin, need_kind, amount),
        |origin| *building = origin.clone(),
    )
}

pub fn try_start_timber_supply_trip(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    network: &RoadNetwork,
    mill: &mut Building,
    lodge: &Building,
    delivery_workers: u32,
    speed_mps: f64,
    unload_seconds: f64,
    per_delivery_amount: f64,
    needed: f64,
) -> bool {
    try_start_building_supply_trip(
        ctx,
        tick,
        clock,
        network,
        mill,
        lodge,
        delivery_workers,
        CommodityKind::Timber,
        speed_mps,
        unload_seconds,
        per_delivery_amount,
        needed,
    )
}

pub fn try_start_building_supply_trip(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    network: &RoadNetwork,
    origin: &mut Building,
    target: &Building,
    delivery_workers: u32,
    commodity: CommodityKind,
    speed_mps: f64,
    unload_seconds: f64,
    per_delivery_amount: f64,
    needed: f64,
) -> bool {
    if delivery_workers == 0
        || tick.building_disabled_by_fire(ctx, origin.id)
        || tick.building_disabled_by_fire(ctx, target.id)
        || building_has_active_trip(ctx, origin.id)
    {
        return false;
    }

    if labor_and_logistics_paused(ctx, tick, origin.owner, clock) {
        return false;
    }

    if building_commodity_stock(origin, commodity) <= 1e-6 {
        return false;
    }

    let target_room = building_commodity_room(target, commodity);
    if target_room <= 1e-6 {
        return false;
    }

    let batch = per_delivery_amount * delivery_workers as f64;
    let load = building_commodity_stock(origin, commodity)
        .min(target_room)
        .min(batch)
        .min(needed);
    if load <= 1e-6 {
        return false;
    }

    try_start_road_trip(
        ctx,
        tick,
        clock,
        network,
        StartTripSpec {
            origin: origin.clone(),
            destination: TripDestination::Building {
                id: target.id,
                x: target.x,
                z: target.z,
            },
            cargo_kind: commodity.as_u8(),
            delivery_workers,
            speed_mps,
            unload_seconds,
            load_amount: load,
        },
        |source, amount| withdraw_building_commodity(source, commodity, amount),
        |source| *origin = source.clone(),
    )
}

/// Dispatch one visible bucket carrier from a staffed well. Fire response may
/// leave the road for the last leg, but still uses the cached authoritative route.
pub fn try_start_fire_response_trip(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    network: &RoadNetwork,
    well: &mut Building,
    incident: &FireIncident,
) -> bool {
    if well.kind != "well"
        || well.assigned_labor == 0
        || fire_response_load(well.water) <= 0.0
        || building_has_active_trip(ctx, well.id)
    {
        return false;
    }

    let dx = well.x - incident.x;
    let dz = well.z - incident.z;
    let length = (dx * dx + dz * dz).sqrt();
    let stand_off = 4.2_f64.min(length * 0.35);
    let (target_x, target_z) = if length > 1e-6 {
        (
            incident.x + dx / length * stand_off,
            incident.z + dz / length * stand_off,
        )
    } else {
        (incident.x, incident.z)
    };
    let route = network
        .road_path_route(well.x, well.z, target_x, target_z)
        .or_else(|| {
            let distance = ((target_x - well.x).powi(2) + (target_z - well.z).powi(2)).sqrt();
            (distance > 1e-6).then_some(RoadPathRoute {
                distance,
                polyline: vec![[well.x, well.z], [target_x, target_z]],
            })
        });
    let Some(route) = route else {
        return false;
    };

    let load = fire_response_load(well.water);
    if load <= 1e-6 {
        return false;
    }
    well.water -= load;
    ctx.db.building().id().update(well.clone());
    let destination = if incident.target_kind == FIRE_TARGET_RESIDENCE {
        TripDestination::FireResidence {
            id: incident.target_id,
            x: target_x,
            z: target_z,
        }
    } else {
        TripDestination::FireBuilding {
            id: incident.target_id,
            x: target_x,
            z: target_z,
        }
    };
    insert_trip(
        ctx,
        tick,
        network,
        StartTripSpec {
            origin: well.clone(),
            destination,
            cargo_kind: CommodityKind::Water.as_u8(),
            delivery_workers: 1,
            speed_mps: FIRE_BUCKET_SPEED_MPS,
            unload_seconds: FIRE_BUCKET_UNLOAD_SECONDS,
            load_amount: load,
        },
        route,
    );
    true
}

/// Loads reserved construction stock from any completed source and sends it to
/// a construction site. Staffed sources use their crew; unstaffed sources draw
/// one worker from the owner's free-labor pool. Staffed storehouses use their
/// larger logistics-cart capacity. The reservation is reduced at loading time;
/// if the trip is cancelled, `return_trip_cargo_to_building` restores it.
pub fn try_start_construction_supply_trip(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    network: &RoadNetwork,
    origin: &mut Building,
    site: &mut Building,
    commodity: CommodityKind,
    allow_offroad: bool,
    available_free_haulers: u32,
) -> bool {
    if !origin.construction_complete
        || site.construction_complete
        || origin.owner != site.owner
        || tick.building_disabled_by_fire(ctx, origin.id)
        || building_has_active_trip(ctx, origin.id)
        || (origin.kind == "village_storehouse" && building_has_inbound_supply_trip(ctx, origin.id))
    {
        return false;
    }
    if labor_and_logistics_paused(ctx, tick, origin.owner, clock) {
        return false;
    }

    let reserved_physical = match commodity {
        CommodityKind::Timber => {
            (site.construction_reserved_timber - site.construction_treasury_timber).max(0.0)
        }
        CommodityKind::Stone => {
            (site.construction_reserved_stone - site.construction_treasury_stone).max(0.0)
        }
        _ => 0.0,
    };
    let workers = if origin.assigned_labor > 0 {
        origin.assigned_labor.min(2)
    } else {
        available_free_haulers.min(1)
    };
    if workers == 0 {
        return false;
    }
    let haul_per_worker = if origin.kind == "village_storehouse" && origin.assigned_labor > 0 {
        STOREHOUSE_HAUL_PER_WORKER
    } else {
        CONSTRUCTION_HAUL_PER_WORKER
    };
    let load = building_commodity_stock(origin, commodity)
        .min(reserved_physical)
        .min(haul_per_worker * workers as f64);
    if load <= 1e-6 {
        return false;
    }

    let route = network
        .road_path_route(origin.x, origin.z, site.x, site.z)
        .or_else(|| {
            if !allow_offroad {
                return None;
            }
            let distance = ((site.x - origin.x).powi(2) + (site.z - origin.z).powi(2)).sqrt();
            (distance > 1e-6).then_some(RoadPathRoute {
                distance,
                polyline: vec![[origin.x, origin.z], [site.x, site.z]],
            })
        });
    let Some(route) = route else {
        return false;
    };

    let mut source = origin.clone();
    let withdrawn = withdraw_building_commodity(&mut source, commodity, load);
    if withdrawn <= 1e-6 {
        return false;
    }
    match commodity {
        CommodityKind::Timber => {
            site.construction_reserved_timber =
                (site.construction_reserved_timber - withdrawn).max(0.0)
        }
        CommodityKind::Stone => {
            site.construction_reserved_stone =
                (site.construction_reserved_stone - withdrawn).max(0.0)
        }
        _ => return false,
    }
    *origin = source.clone();
    ctx.db.building().id().update(source.clone());
    ctx.db.building().id().update(site.clone());

    insert_trip(
        ctx,
        tick,
        network,
        StartTripSpec {
            origin: source,
            destination: TripDestination::Building {
                id: site.id,
                x: site.x,
                z: site.z,
            },
            cargo_kind: commodity.as_u8(),
            delivery_workers: workers,
            speed_mps: CONSTRUCTION_DELIVERY_SPEED_MPS,
            unload_seconds: CONSTRUCTION_DELIVERY_UNLOAD_SEC,
            load_amount: withdrawn,
        },
        route,
    );
    true
}

fn try_start_road_trip(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    network: &RoadNetwork,
    spec: StartTripSpec,
    withdraw: impl FnOnce(&mut Building, f64) -> f64,
    write_origin: impl FnOnce(&Building),
) -> bool {
    if labor_and_logistics_paused(ctx, tick, spec.origin.owner, clock) {
        return false;
    }

    let (dest_x, dest_z) = spec.destination.end_point();
    let Some(route) = network.road_path_route(spec.origin.x, spec.origin.z, dest_x, dest_z) else {
        return false;
    };
    if route.distance <= 1e-6 {
        return false;
    }

    let mut origin = spec.origin.clone();
    let withdrawn = withdraw(&mut origin, spec.load_amount);
    if withdrawn <= 1e-6 {
        return false;
    }
    write_origin(&origin);
    let load_amount = withdrawn;
    insert_trip(
        ctx,
        tick,
        network,
        StartTripSpec {
            origin,
            load_amount,
            ..spec
        },
        route,
    );
    true
}

fn insert_trip(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    network: &RoadNetwork,
    spec: StartTripSpec,
    route: RoadPathRoute,
) {
    let (destination_kind, residence_id, target_building_id) = spec.destination.to_row_fields();
    let (start_x, start_z) = RoadNetwork::sample_polyline_xz(&route.polyline, 0.0);
    let cartwright_multiplier = carpenter_delivery_multiplier_for_origin(
        ctx,
        tick,
        network,
        &spec.origin,
        spec.origin.owner,
    );
    let road_condition_multiplier = ctx
        .db
        .world_config()
        .id()
        .find(&0)
        .map(|config| {
            environment_for(config.seed, config.hydrology, &game_clock(config.sim_tick))
                .road_speed_multiplier()
        })
        .unwrap_or(1.0);
    let travel_speed_multiplier = cartwright_multiplier * road_condition_multiplier;
    let free_hauler_workers =
        free_hauler_workers_for_trip(&spec.origin, spec.cargo_kind, spec.delivery_workers);

    ctx.db.delivery_trip().insert(DeliveryTrip {
        id: 0,
        owner: spec.origin.owner,
        building_id: spec.origin.id,
        residence_id,
        destination_kind,
        target_building_id,
        cargo_kind: spec.cargo_kind,
        amount: spec.load_amount,
        phase: DeliveryTripPhase::Outbound.as_u8(),
        x: start_x,
        z: start_z,
        progress: 0.0,
        speed_mps: spec.speed_mps,
        unload_seconds: spec.unload_seconds,
        unload_remaining: 0.0,
        delivery_workers: spec.delivery_workers,
        path_distance: route.distance,
        travel_speed_multiplier,
        route_polyline_json: serialize_route_polyline(&route.polyline),
        free_hauler_workers,
    });
}

fn step_one_trip(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    mut trip: DeliveryTrip,
    elapsed_seconds: f64,
) {
    if trip.destination_kind != DELIVERY_DESTINATION_FIRE
        && labor_and_logistics_paused(ctx, tick, trip.owner, clock)
    {
        return;
    }

    let Some(network) = tick.road_network(trip.owner) else {
        return_trip_cargo_to_building(ctx, &trip);
        ctx.db.delivery_trip().id().delete(trip.id);
        return;
    };

    let Some(route) = cached_trip_route(ctx, &network, &trip) else {
        return_trip_cargo_to_building(ctx, &trip);
        ctx.db.delivery_trip().id().delete(trip.id);
        return;
    };

    let path_distance = route.distance;
    trip.progress = trip.progress.min(path_distance);

    let workers = trip.delivery_workers.max(1) as f64;
    let travel_speed = trip.speed_mps * workers * trip.travel_speed_multiplier.max(1e-6);

    if travel_speed <= 1e-9 {
        return;
    }

    let mut remaining_seconds = elapsed_seconds;
    while remaining_seconds > 1e-9 {
        let Some(phase) = DeliveryTripPhase::from_u8(trip.phase) else {
            return_trip_cargo_to_building(ctx, &trip);
            ctx.db.delivery_trip().id().delete(trip.id);
            return;
        };

        match phase {
            DeliveryTripPhase::Outbound => {
                let advance = advance_travel_progress(
                    &network,
                    &route.polyline,
                    trip.progress,
                    path_distance,
                    remaining_seconds,
                    travel_speed,
                    false,
                );
                trip.progress = advance.progress;
                remaining_seconds = advance.remaining_seconds;
                if advance.reached_end {
                    trip.progress = path_distance;
                    trip.phase = DeliveryTripPhase::Unloading.as_u8();
                    trip.unload_remaining = trip.unload_seconds / workers;
                }
            }
            DeliveryTripPhase::Unloading => {
                if remaining_seconds + 1e-9 < trip.unload_remaining {
                    trip.unload_remaining -= remaining_seconds;
                    remaining_seconds = 0.0;
                } else {
                    remaining_seconds = (remaining_seconds - trip.unload_remaining).max(0.0);
                    trip.unload_remaining = 0.0;
                    complete_unload(ctx, &mut trip, clock.sim_tick);
                    trip.phase = DeliveryTripPhase::Inbound.as_u8();
                    trip.progress = 0.0;
                }
            }
            DeliveryTripPhase::Inbound => {
                let advance = advance_travel_progress(
                    &network,
                    &route.polyline,
                    trip.progress,
                    path_distance,
                    remaining_seconds,
                    travel_speed,
                    true,
                );
                trip.progress = advance.progress;
                remaining_seconds = advance.remaining_seconds;
                if advance.reached_end {
                    finish_inbound_trip(ctx, trip);
                    return;
                }
            }
        }
    }

    match DeliveryTripPhase::from_u8(trip.phase) {
        Some(DeliveryTripPhase::Outbound) => {
            let (x, z) = RoadNetwork::sample_polyline_xz(&route.polyline, trip.progress);
            trip.x = x;
            trip.z = z;
        }
        Some(DeliveryTripPhase::Unloading) => {
            let (x, z) = RoadNetwork::sample_polyline_xz(&route.polyline, path_distance);
            trip.x = x;
            trip.z = z;
        }
        Some(DeliveryTripPhase::Inbound) => {
            let (x, z) = RoadNetwork::sample_polyline_inbound_xz(&route.polyline, trip.progress);
            trip.x = x;
            trip.z = z;
        }
        None => {
            return_trip_cargo_to_building(ctx, &trip);
            ctx.db.delivery_trip().id().delete(trip.id);
            return;
        }
    }
    ctx.db.delivery_trip().id().update(trip);
}

const DELIVERY_ROAD_SPEED_MULTIPLIER: f64 = 1.35;
const SURFACE_SPEED_SAMPLE_SECONDS: f64 = 0.25;

struct TravelAdvance {
    progress: f64,
    remaining_seconds: f64,
    reached_end: bool,
}

fn advance_travel_progress(
    network: &RoadNetwork,
    polyline: &[[f64; 2]],
    mut progress: f64,
    path_distance: f64,
    mut remaining_seconds: f64,
    base_speed: f64,
    inbound: bool,
) -> TravelAdvance {
    while remaining_seconds > 1e-9 && progress + 1e-9 < path_distance {
        let (x, z) = if inbound {
            RoadNetwork::sample_polyline_inbound_xz(polyline, progress)
        } else {
            RoadNetwork::sample_polyline_xz(polyline, progress)
        };
        let road_multiplier = if network.is_on_road_surface(x, z) {
            DELIVERY_ROAD_SPEED_MULTIPLIER
        } else {
            1.0
        };
        let speed = base_speed * road_multiplier;
        let distance_left = (path_distance - progress).max(0.0);
        let sample_seconds = remaining_seconds.min(SURFACE_SPEED_SAMPLE_SECONDS);
        let seconds_to_end = distance_left / speed;
        if seconds_to_end <= sample_seconds + 1e-9 {
            progress = path_distance;
            remaining_seconds = (remaining_seconds - seconds_to_end).max(0.0);
            break;
        }
        progress += speed * sample_seconds;
        remaining_seconds -= sample_seconds;
    }

    TravelAdvance {
        progress,
        remaining_seconds,
        reached_end: progress + 1e-9 >= path_distance,
    }
}

fn trip_route(
    ctx: &ReducerContext,
    network: &RoadNetwork,
    trip: &DeliveryTrip,
) -> Option<RoadPathRoute> {
    let building = ctx.db.building().id().find(&trip.building_id)?;
    match trip.destination_kind {
        DELIVERY_DESTINATION_FIRE => {
            let (target_x, target_z) = if trip.target_building_id != 0 {
                let target = ctx.db.building().id().find(&trip.target_building_id)?;
                (target.x, target.z)
            } else {
                let target = ctx.db.residence().id().find(&trip.residence_id)?;
                (target.x, target.z)
            };
            let dx = building.x - target_x;
            let dz = building.z - target_z;
            let length = (dx * dx + dz * dz).sqrt();
            let stand_off = 4.2_f64.min(length * 0.35);
            let (x, z) = if length > 1e-6 {
                (
                    target_x + dx / length * stand_off,
                    target_z + dz / length * stand_off,
                )
            } else {
                (target_x, target_z)
            };
            network
                .road_path_route(building.x, building.z, x, z)
                .or_else(|| {
                    let distance = ((x - building.x).powi(2) + (z - building.z).powi(2)).sqrt();
                    (distance > 1e-6).then_some(RoadPathRoute {
                        distance,
                        polyline: vec![[building.x, building.z], [x, z]],
                    })
                })
        }
        DELIVERY_DESTINATION_BUILDING => {
            let target = ctx.db.building().id().find(&trip.target_building_id)?;
            network.road_path_route(building.x, building.z, target.x, target.z)
        }
        _ => {
            let residence = ctx.db.residence().id().find(&trip.residence_id)?;
            network.road_path_route(building.x, building.z, residence.x, residence.z)
        }
    }
}

fn complete_unload(ctx: &ReducerContext, trip: &mut DeliveryTrip, sim_tick: u64) {
    let Some(TripCargoKind::Commodity(commodity)) = TripCargoKind::from_trip(trip) else {
        return;
    };
    if trip.destination_kind == DELIVERY_DESTINATION_FIRE {
        let (target_kind, target_id) = trip_fire_target(trip);
        if commodity == CommodityKind::Water
            && apply_fire_water(ctx, target_kind, target_id, trip.amount, sim_tick)
        {
            trip.amount = 0.0;
        } else {
            release_fire_response(ctx, target_kind, target_id, trip.building_id);
        }
    } else if trip.destination_kind == DELIVERY_DESTINATION_BUILDING {
        unload_commodity_to_building(ctx, trip, commodity);
    } else if let Some(need_kind) = ResidenceNeedKind::from_u8(trip.cargo_kind) {
        unload_need_to_residence(ctx, trip, need_kind);
    }
}

fn carpenter_delivery_multiplier_for_origin(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    network: &RoadNetwork,
    origin: &Building,
    owner: spacetimedb::Identity,
) -> f64 {
    let supported = tick
        .building_ids_for_kinds(ctx, owner, &["carpenter"])
        .into_iter()
        .filter_map(|building_id| ctx.db.building().id().find(&building_id))
        .any(|shop| {
            shop.kind == "carpenter"
                && shop.construction_complete
                && shop.assigned_labor > 0
                && building_fire_state(ctx, shop.id).is_none()
                && network
                    .road_path_distance(origin.x, origin.z, shop.x, shop.z)
                    .is_some()
        });
    if supported {
        CARPENTER_DELIVERY_SPEED_MULTIPLIER
    } else {
        1.0
    }
}

fn unload_commodity_to_building(
    ctx: &ReducerContext,
    trip: &mut DeliveryTrip,
    commodity: CommodityKind,
) {
    let Some(mut target) = ctx.db.building().id().find(&trip.target_building_id) else {
        return;
    };
    if !target.construction_complete {
        let deposited = match commodity {
            CommodityKind::Timber => {
                let room = (target.construction_required_timber
                    - target.construction_delivered_timber)
                    .max(0.0);
                let amount = trip.amount.min(room);
                target.construction_delivered_timber += amount;
                amount
            }
            CommodityKind::Stone => {
                let room = (target.construction_required_stone
                    - target.construction_delivered_stone)
                    .max(0.0);
                let amount = trip.amount.min(room);
                target.construction_delivered_stone += amount;
                amount
            }
            _ => 0.0,
        };
        if deposited > 1e-6 {
            trip.amount = (trip.amount - deposited).max(0.0);
            ctx.db.building().id().update(target);
        }
        return;
    }
    let monastery_tithe_delivery = commodity == CommodityKind::Gold
        && target.kind == "monastery"
        && ctx
            .db
            .building()
            .id()
            .find(&trip.building_id)
            .is_some_and(|origin| origin.kind == "chapel");
    let deposited = deposit_building_commodity(&mut target, commodity, trip.amount);
    if deposited > 1e-6 {
        trip.amount = (trip.amount - deposited).max(0.0);
        ctx.db.building().id().update(target);
        if monastery_tithe_delivery {
            if let Some(mut resources) = ctx.db.player_resources().owner().find(&trip.owner) {
                resources.monastery_tithe_paid_total += deposited;
                ctx.db.player_resources().owner().update(resources);
            }
        }
    }
}

fn unload_need_to_residence(
    ctx: &ReducerContext,
    trip: &mut DeliveryTrip,
    need_kind: ResidenceNeedKind,
) {
    let room = residence_delivery_room(ctx, trip.residence_id, need_kind);
    let delivered = trip.amount.min(room);
    if delivered > 1e-6 {
        apply_need_delivery(ctx, trip.residence_id, need_kind, delivered);
        trip.amount = (trip.amount - delivered).max(0.0);
        if need_kind == ResidenceNeedKind::Food {
            if let Some(origin) = ctx.db.building().id().find(&trip.building_id) {
                if origin.kind == "monastery" {
                    if let Some(mut resources) = ctx.db.player_resources().owner().find(&trip.owner)
                    {
                        resources.monastery_food_charity_total += delivered;
                        ctx.db.player_resources().owner().update(resources);
                    }
                }
            }
        }
    }
}

fn finish_inbound_trip(ctx: &ReducerContext, trip: DeliveryTrip) {
    return_trip_cargo_to_building(ctx, &trip);
    ctx.db.delivery_trip().id().delete(trip.id);
}

fn return_trip_cargo_to_building(ctx: &ReducerContext, trip: &DeliveryTrip) {
    release_trip_fire_claim(ctx, trip);
    if trip.amount <= 1e-6 {
        return;
    }
    match TripCargoKind::from_trip(trip) {
        Some(TripCargoKind::Commodity(commodity)) => {
            if trip.destination_kind == DELIVERY_DESTINATION_BUILDING {
                if let Some(mut site) = ctx.db.building().id().find(&trip.target_building_id) {
                    if !site.construction_complete {
                        match commodity {
                            CommodityKind::Timber => {
                                site.construction_reserved_timber += trip.amount
                            }
                            CommodityKind::Stone => site.construction_reserved_stone += trip.amount,
                            _ => {}
                        }
                        ctx.db.building().id().update(site);
                    }
                }
            }
            let restore_monastery_purse = commodity == CommodityKind::Gold
                && ctx
                    .db
                    .building()
                    .id()
                    .find(&trip.building_id)
                    .is_some_and(|origin| origin.kind == "chapel")
                && ctx
                    .db
                    .building()
                    .id()
                    .find(&trip.target_building_id)
                    .is_some_and(|target| target.kind == "monastery");
            return_commodity_to_building(ctx, trip.building_id, commodity, trip.amount);
            if restore_monastery_purse {
                if let Some(mut chapel) = ctx.db.building().id().find(&trip.building_id) {
                    chapel.chapel_monastery_tithe_due = (chapel_monastery_tithe_due(&chapel)
                        + trip.amount)
                        .min(chapel.gold.max(0.0));
                    ctx.db.building().id().update(chapel);
                }
            }
        }
        None => {}
    }
}

fn trip_fire_target(trip: &DeliveryTrip) -> (u8, u64) {
    if trip.target_building_id != 0 {
        (FIRE_TARGET_BUILDING, trip.target_building_id)
    } else {
        (FIRE_TARGET_RESIDENCE, trip.residence_id)
    }
}

fn release_trip_fire_claim(ctx: &ReducerContext, trip: &DeliveryTrip) {
    if trip.destination_kind != DELIVERY_DESTINATION_FIRE {
        return;
    }
    let (target_kind, target_id) = trip_fire_target(trip);
    release_fire_response(ctx, target_kind, target_id, trip.building_id);
}

fn return_commodity_to_building(
    ctx: &ReducerContext,
    building_id: u64,
    commodity: CommodityKind,
    amount: f64,
) {
    if amount <= 1e-6 {
        return;
    }
    let Some(mut building) = ctx.db.building().id().find(&building_id) else {
        return;
    };
    let deposited = deposit_building_commodity(&mut building, commodity, amount);
    let remainder = (amount - deposited).max(0.0);
    if remainder > 1e-6 {
        credit_treasury_commodity(ctx, building.owner, commodity, remainder);
    }
    ctx.db.building().id().update(building);
}
