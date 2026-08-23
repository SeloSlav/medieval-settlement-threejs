//! Authoritative road delivery agents — cargo unloads when the agent reaches the destination.

use std::collections::HashMap;

use spacetimedb::ReducerContext;

use crate::balance_generated::{
    CARPENTER_CART_SERVICE_IRONWORK_PER_TRIP, CARPENTER_CART_SERVICE_TIMBER_PER_TRIP,
    CARPENTER_DELIVERY_SPEED_MULTIPLIER, CONSTRUCTION_DELIVERY_SPEED_MPS,
    CONSTRUCTION_DELIVERY_UNLOAD_SEC, CONSTRUCTION_HAUL_PER_WORKER, FIRE_BUCKET_SPEED_MPS,
    FIRE_BUCKET_UNLOAD_SECONDS, FOOD_SALE_GOLD_PER_UNIT, HERB_REMEDY_CAPACITY,
    HERB_TREATMENT_PER_SICK_DAY, HOUSEHOLD_MAX_WEALTH, REMEDIES_PER_DELIVERY,
    REMEDY_DELIVERY_SPEED_MPS, REMEDY_DELIVERY_TARGET_DAYS, REMEDY_DELIVERY_UNLOAD_SEC,
    STOREHOUSE_HAUL_PER_WORKER, TIMBER_DELIVERY_SPEED_MPS, TIMBER_DELIVERY_UNLOAD_SEC,
};
use crate::construction_priority::{
    construction_labor_ready, construction_supply_crew, ConstructionSupplyCrew,
};
use crate::db::*;
pub use crate::delivery_trip_policy::DeliveryTripPhase;
use crate::delivery_trip_policy::{
    delivery_cargo_is_approaching, inbound_supply_trip_conflicts, raid_cart_posture,
    RaidCartPosture,
};
use crate::economy::{
    adriatic_trade_entry_point, available_building_labor, building_commodity_room,
    building_commodity_stock, chapel_coffer_gold, chapel_monastery_tithe_due,
    credit_marketplace_receipt_gold, credit_residence_wealth, credit_settlement_household_income,
    credit_treasury_commodity, deposit_building_commodity, deposit_residence_commodity,
    player_economic_activity_tax_rate, private_export_proceeds, record_parish_ledger,
    record_private_export_income, restore_local_civic_receipts, restore_private_export_proceeds,
    settle_regional_market_export, storage_accepts_commodity, taxed_economic_activity,
    town_hall_tax_collection_multiplier, withdraw_building_commodity, withdraw_coffer_in_place,
    withdraw_private_export_proceeds, CommodityKind, ParishLedgerKind,
};
use crate::fire_policy::fire_response_load;
use crate::monastery_estate_policy::playable_half_for_monastery_map_size;
use crate::raid_agent_policy::{
    arriving_cart_store_loot_fraction, combat_agent_follows_arriving_cart,
    playable_half_for_map_size, COMBAT_FACTION_RAIDER, COMBAT_STATE_ADVANCING,
    COMBAT_STATE_LOOTING, COMBAT_TARGET_BUILDING, COMBAT_TARGET_DELIVERY_TRIP,
};
use crate::residence_upgrade_policy::residence_project_active;
use crate::roads::{RoadNetwork, RoadPathRoute};
use crate::season_policy::environment_for;
use crate::simulation::delivery_cargo::{
    building_delivery_stock, pick_delivery_target, residence_delivery_room,
    selected_food_delivery_commodity, withdraw_delivery_cargo, DeliveryCargoTotals,
};
use crate::simulation::fires::{
    apply_fire_water, building_fire_state, release_fire_response, residence_fire_state,
    FIRE_TARGET_BUILDING, FIRE_TARGET_RESIDENCE,
};
use crate::simulation::game_calendar::{game_clock, GameClock};
use crate::simulation::labor_and_logistics_paused;
use crate::simulation::raid_agents::issued_guard_polearms_by_building;
use crate::simulation::residence_needs::{
    apply_need_delivery, sync_food_need_rows, ResidenceNeedKind,
};
use crate::simulation::road_logistics::{local_delivery_distance, local_delivery_route};
use crate::simulation::settlement_security::{
    building_portable_stores_at_site, delivery_trip_portable_stores,
};
use crate::simulation::tick_context::SimTickContext;
use crate::simulation::{recover_stock_at, recover_stock_beside_building, ReclamationStock};
use crate::supply_policy::{carpenter_cart_service_ready, construction_source_available_stock};
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
pub const DELIVERY_DESTINATION_RESIDENCE_WEALTH: u8 = 3;
pub const DELIVERY_DESTINATION_RESIDENCE_REMEDY: u8 = 4;
pub const DELIVERY_DESTINATION_REGIONAL_TRADE: u8 = 5;

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
    Residence {
        id: u64,
        x: f64,
        z: f64,
    },
    ResidenceWealth {
        id: u64,
        x: f64,
        z: f64,
    },
    ResidenceRemedy {
        id: u64,
        x: f64,
        z: f64,
    },
    Building {
        id: u64,
        x: f64,
        z: f64,
    },
    RegionalTrade {
        market_id: u64,
        contract_code: u64,
        x: f64,
        z: f64,
    },
    FireBuilding {
        id: u64,
        x: f64,
        z: f64,
    },
    FireResidence {
        id: u64,
        x: f64,
        z: f64,
    },
}

impl TripDestination {
    fn to_row_fields(self) -> (u8, u64, u64) {
        match self {
            Self::Residence { id, .. } => (DELIVERY_DESTINATION_RESIDENCE, id, 0),
            Self::ResidenceWealth { id, .. } => (DELIVERY_DESTINATION_RESIDENCE_WEALTH, id, 0),
            Self::ResidenceRemedy { id, .. } => (DELIVERY_DESTINATION_RESIDENCE_REMEDY, id, 0),
            Self::Building { id, .. } => (DELIVERY_DESTINATION_BUILDING, 0, id),
            Self::RegionalTrade {
                market_id,
                contract_code,
                ..
            } => (
                DELIVERY_DESTINATION_REGIONAL_TRADE,
                contract_code,
                market_id,
            ),
            Self::FireBuilding { id, .. } => (DELIVERY_DESTINATION_FIRE, 0, id),
            Self::FireResidence { id, .. } => (DELIVERY_DESTINATION_FIRE, id, 0),
        }
    }

    fn end_point(self) -> (f64, f64) {
        match self {
            Self::Residence { x, z, .. }
            | Self::ResidenceWealth { x, z, .. }
            | Self::ResidenceRemedy { x, z, .. }
            | Self::Building { x, z, .. }
            | Self::RegionalTrade { x, z, .. }
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
    labor_source: DeliveryLaborSource,
    speed_mps: f64,
    unload_seconds: f64,
    load_amount: f64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum DeliveryLaborSource {
    /// One flexible villager reserves one handcart for the complete round trip.
    Free,
    /// A dedicated logistics workplace supplies the crew without borrowing
    /// labor from the building where cargo happens to be stored.
    Building(u64),
    /// A regional merchant exists outside the settlement population budget.
    External,
}

fn is_logistics_workplace(kind: &str) -> bool {
    matches!(kind, "village_storehouse" | "granary" | "trading_post")
}

fn ordinary_supply_labor_source(origin: &Building, target: &Building) -> DeliveryLaborSource {
    if is_logistics_workplace(&origin.kind) {
        DeliveryLaborSource::Building(origin.id)
    } else if is_logistics_workplace(&target.kind) {
        DeliveryLaborSource::Building(target.id)
    } else {
        DeliveryLaborSource::Free
    }
}

fn household_delivery_labor_source(origin: &Building) -> DeliveryLaborSource {
    if is_logistics_workplace(&origin.kind) {
        DeliveryLaborSource::Building(origin.id)
    } else {
        DeliveryLaborSource::Free
    }
}

fn delivery_labor_available(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    source: DeliveryLaborSource,
) -> u32 {
    match source {
        DeliveryLaborSource::Free => available_free_haulers(ctx, owner).min(1),
        DeliveryLaborSource::Building(building_id) => ctx
            .db
            .building()
            .id()
            .find(&building_id)
            .map(|building| onsite_building_labor(ctx, &building))
            .unwrap_or(0),
        DeliveryLaborSource::External => 1,
    }
}

fn resolve_delivery_workers(ctx: &ReducerContext, spec: &StartTripSpec) -> u32 {
    spec.delivery_workers.min(delivery_labor_available(
        ctx,
        spec.origin.owner,
        spec.labor_source,
    ))
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
        .any(|trip| !is_regional_market_trip(&trip))
}

/// The founders' camp is an open stockyard rather than a staffed cart post.
/// Each departure already reserves its own free settlement worker, so several
/// founding haulers may load there concurrently without duplicating labor.
pub fn construction_source_cart_busy(ctx: &ReducerContext, source: &Building) -> bool {
    source.kind != "founders_camp" && building_has_active_trip(ctx, source.id)
}

pub fn building_has_inbound_supply_trip(ctx: &ReducerContext, building_id: u64) -> bool {
    ctx.db
        .delivery_trip()
        .target_building_id()
        .filter(&building_id)
        .any(|trip| delivery_cargo_is_approaching(trip.phase, trip.amount))
}

/// Marketplaces may receive different table commodities at the same time, but
/// every other building keeps the single-inbound-cart rule. In both cases a
/// matching approaching load suppresses a duplicate reservation.
pub fn building_has_conflicting_inbound_supply_trip(
    ctx: &ReducerContext,
    target: &Building,
    commodity: CommodityKind,
) -> bool {
    ctx.db
        .delivery_trip()
        .target_building_id()
        .filter(&target.id)
        .any(|trip| {
            trip.destination_kind == DELIVERY_DESTINATION_BUILDING
                && inbound_supply_trip_conflicts(
                    target.kind == "marketplace",
                    commodity.as_u8(),
                    trip.cargo_kind,
                    trip.phase,
                    trip.amount,
                )
        })
}

/// Free settlement labor still available to operate carts. Freelance crews are
/// recorded on DeliveryTrip and already deducted by the authoritative labor budget.
pub fn available_free_haulers(ctx: &ReducerContext, owner: spacetimedb::Identity) -> u32 {
    available_building_labor(ctx, owner)
}

pub fn staffed_cart_workers_by_building(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
) -> HashMap<u64, u32> {
    let mut workers_by_building = HashMap::new();
    for trip in ctx.db.delivery_trip().owner().filter(&owner) {
        let staffed_workers = trip
            .delivery_workers
            .saturating_sub(trip.free_hauler_workers);
        if staffed_workers == 0 {
            continue;
        }
        let labor_building_id = trip_labor_building_id(&trip);
        if labor_building_id == 0 {
            continue;
        }
        workers_by_building
            .entry(labor_building_id)
            .and_modify(|workers: &mut u32| {
                *workers = workers.saturating_add(staffed_workers);
            })
            .or_insert(staffed_workers);
    }
    workers_by_building
}

fn trip_labor_building_id(trip: &DeliveryTrip) -> u64 {
    if trip.labor_building_id != 0 {
        trip.labor_building_id
    } else if trip.free_hauler_workers < trip.delivery_workers {
        // Compatibility for a trip created before labor ownership was split
        // from its cargo origin.
        trip.building_id
    } else {
        0
    }
}

fn rostered_cart_workers(
    assigned_labor: u32,
    delivery_workers: u32,
    free_hauler_workers: u32,
) -> u32 {
    delivery_workers
        .saturating_sub(free_hauler_workers)
        .min(assigned_labor)
}

/// Workers physically present to perform the origin building's work. The
/// building-id index makes this one bounded lookup, while subtracting only the
/// part of the cart crew still backed by this roster preserves genuinely free
/// founding, reclamation, and chapel errands.
pub fn onsite_building_labor(ctx: &ReducerContext, building: &Building) -> u32 {
    let indexed_workers = ctx
        .db
        .delivery_trip()
        .labor_building_id()
        .filter(&building.id)
        .map(|trip| {
            rostered_cart_workers(
                building.assigned_labor,
                trip.delivery_workers,
                trip.free_hauler_workers,
            )
        })
        .fold(0_u32, u32::saturating_add);
    let legacy_workers = ctx
        .db
        .delivery_trip()
        .building_id()
        .filter(&building.id)
        .filter(|trip| {
            trip.labor_building_id == 0 && trip.free_hauler_workers < trip.delivery_workers
        })
        .map(|trip| {
            rostered_cart_workers(
                building.assigned_labor,
                trip.delivery_workers,
                trip.free_hauler_workers,
            )
        })
        .fold(0_u32, u32::saturating_add);
    let workers_away = indexed_workers
        .saturating_add(legacy_workers)
        .min(building.assigned_labor);
    building.assigned_labor.saturating_sub(workers_away)
}

/// When a source roster is reduced mid-trip, the crew already on the road
/// remains committed. Move any no-longer-backed cart workers into the trip's
/// free-labor reservation instead of making them immediately assignable.
pub fn preserve_in_transit_cart_labor(
    ctx: &ReducerContext,
    building_id: u64,
    retained_building_labor: u32,
) -> u32 {
    let mut trips: Vec<DeliveryTrip> = ctx
        .db
        .delivery_trip()
        .labor_building_id()
        .filter(&building_id)
        .collect();
    trips.extend(
        ctx.db
            .delivery_trip()
            .building_id()
            .filter(&building_id)
            .filter(|trip| {
                trip.labor_building_id == 0 && trip.free_hauler_workers < trip.delivery_workers
            }),
    );
    let mut remaining_roster_backing = retained_building_labor;
    let mut newly_reserved = 0_u32;

    for mut trip in trips {
        let staffed_workers = trip
            .delivery_workers
            .saturating_sub(trip.free_hauler_workers);
        let still_backed = staffed_workers.min(remaining_roster_backing);
        remaining_roster_backing = remaining_roster_backing.saturating_sub(still_backed);
        let released_workers = staffed_workers.saturating_sub(still_backed);
        if released_workers == 0 {
            continue;
        }
        trip.free_hauler_workers = trip
            .free_hauler_workers
            .saturating_add(released_workers)
            .min(trip.delivery_workers);
        newly_reserved = newly_reserved.saturating_add(released_workers);
        ctx.db.delivery_trip().id().update(trip);
    }

    newly_reserved
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
                && delivery_cargo_is_approaching(trip.phase, trip.amount)
        })
}

/// A regional merchant uses the Trading Post as both the settlement-side
/// contract anchor and destination. Ordinary local trips never route a
/// building to itself because their zero-length route is rejected. External
/// merchants do not occupy a local settlement cart, so one
/// local delivery may run alongside one regional import.
fn is_external_market_import_trip(trip: &DeliveryTrip) -> bool {
    trip.building_id != 0
        && trip.building_id == trip.target_building_id
        && matches!(
            trip.destination_kind,
            DELIVERY_DESTINATION_BUILDING | DELIVERY_DESTINATION_RESIDENCE
        )
}

fn is_regional_market_export_trip(trip: &DeliveryTrip) -> bool {
    trip.destination_kind == DELIVERY_DESTINATION_REGIONAL_TRADE
        && trip.building_id != 0
        && trip.building_id == trip.target_building_id
}

fn is_regional_market_trip(trip: &DeliveryTrip) -> bool {
    is_external_market_import_trip(trip) || is_regional_market_export_trip(trip)
}

pub fn building_has_regional_market_trip(ctx: &ReducerContext, marketplace_id: u64) -> bool {
    let active_routes = ctx
        .db
        .delivery_trip()
        .building_id()
        .filter(&marketplace_id)
        .filter(|trip| is_regional_market_trip(trip))
        .count() as u32;
    let route_capacity = ctx
        .db
        .building()
        .id()
        .find(&marketplace_id)
        .filter(|building| building.kind == "trading_post")
        .map(|building| building.assigned_labor.min(5))
        .unwrap_or(1);
    route_capacity == 0 || active_routes >= route_capacity
}

/// Builds the physical regional leg from a stable Adriatic-facing edge to the
/// Trading Post. The off-road approach joins the same connected road component
/// used by local carts, so a remote or poorly extended trade branch carries a
/// real travel-time cost.
pub fn regional_market_import_route(
    ctx: &ReducerContext,
    network: &RoadNetwork,
    marketplace: &Building,
) -> Result<RoadPathRoute, String> {
    let config = ctx
        .db
        .world_config()
        .id()
        .find(&0)
        .ok_or_else(|| "World configuration unavailable.".to_string())?;
    let entropy = config.seed ^ marketplace.id.wrapping_mul(0x9e37_79b9);
    let playable_half = if marketplace.kind == "monastery" {
        playable_half_for_monastery_map_size(config.map_size)
    } else {
        playable_half_for_map_size(config.map_size)
    };
    let (entry_x, entry_z) =
        adriatic_trade_entry_point(entropy, marketplace.x, marketplace.z, playable_half)
            .ok_or_else(|| "The Adriatic trade approach is invalid.".to_string())?;
    network
        .road_path_route_from_external_access(entry_x, entry_z, marketplace.x, marketplace.z, 1.6)
        .filter(valid_external_route)
        .ok_or_else(|| {
            "Extend a road-connected branch toward the regional route before importing.".to_string()
        })
}

/// Reverses the same stable route used by imports. Export goods therefore
/// leave through the contracting market's real road branch, and the exchanged
/// coin or barter cargo must traverse that exact route back into storage.
pub fn regional_market_export_route(
    ctx: &ReducerContext,
    network: &RoadNetwork,
    marketplace: &Building,
) -> Result<RoadPathRoute, String> {
    let mut route = regional_market_import_route(ctx, network, marketplace)?;
    route.polyline.reverse();
    if !valid_external_route(&route) {
        return Err("The regional export route is invalid.".to_string());
    }
    Ok(route)
}

fn valid_external_route(route: &RoadPathRoute) -> bool {
    route.distance > 1e-6
        && route.distance.is_finite()
        && route.polyline.len() >= 2
        && route
            .polyline
            .iter()
            .all(|point| point[0].is_finite() && point[1].is_finite())
}

/// Starts a two-way regional exchange with goods already staged at the
/// marketplace. The merchant carries settlement cargo to the map edge, trades
/// only the quantity that survives the road, then returns with physical coin
/// or barter cargo on this same row.
#[allow(clippy::too_many_arguments)]
pub fn start_regional_market_export_trip(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    network: &RoadNetwork,
    marketplace: &Building,
    contract_code: u64,
    commodity: CommodityKind,
    amount: f64,
    speed_mps: f64,
    unload_seconds: f64,
    route: RoadPathRoute,
) -> bool {
    if !speed_mps.is_finite()
        || speed_mps <= 1e-6
        || !unload_seconds.is_finite()
        || unload_seconds < 0.0
        || !regional_market_export_ready(ctx, marketplace, contract_code, amount, &route)
    {
        return false;
    }
    let Some([edge_x, edge_z]) = route.polyline.last().copied() else {
        return false;
    };
    insert_trip(
        ctx,
        tick,
        network,
        StartTripSpec {
            origin: marketplace.clone(),
            destination: TripDestination::RegionalTrade {
                market_id: marketplace.id,
                contract_code,
                x: edge_x,
                z: edge_z,
            },
            cargo_kind: commodity.as_u8(),
            delivery_workers: 1,
            labor_source: DeliveryLaborSource::External,
            speed_mps,
            unload_seconds,
            load_amount: amount,
        },
        route,
        1.0,
    );
    true
}

fn regional_market_export_ready(
    ctx: &ReducerContext,
    marketplace: &Building,
    contract_code: u64,
    amount: f64,
    route: &RoadPathRoute,
) -> bool {
    let authorized_site = marketplace.kind == "trading_post"
        || (marketplace.kind == "monastery" && contract_code == 0);
    authorized_site
        && marketplace.construction_complete
        && amount > 1e-6
        && amount.is_finite()
        && valid_external_route(route)
        && !building_has_regional_market_trip(ctx, marketplace.id)
}

/// Holding a construction site recalls any cart already bound for it. The
/// site's reservation is restored immediately, while the loaded cart and its
/// crew remain on the map until they physically return to the source.
pub fn cancel_inbound_construction_trips_for_site(ctx: &ReducerContext, building_id: u64) {
    let trips: Vec<DeliveryTrip> = ctx
        .db
        .delivery_trip()
        .target_building_id()
        .filter(&building_id)
        .filter(|trip| trip.destination_kind == DELIVERY_DESTINATION_BUILDING)
        .collect();
    for trip in trips {
        recall_trip_to_origin(ctx, trip);
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
        if is_regional_market_trip(&trip) && trip.amount > 1e-6 {
            if let Some(kind) = CommodityKind::from_u8(trip.cargo_kind) {
                if recover_stock_at(
                    ctx,
                    trip.owner,
                    trip.x,
                    trip.z,
                    ReclamationStock::from_commodity(kind, trip.amount),
                )
                .unwrap_or(false)
                {
                    ctx.db.delivery_trip().id().delete(trip.id);
                    continue;
                }
            }
        }
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
                            CommodityKind::Ironwork => {
                                site.construction_reserved_ironwork += trip.amount;
                                site.construction_treasury_ironwork += trip.amount;
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
        .filter(|trip| trip.destination_kind != DELIVERY_DESTINATION_REGIONAL_TRADE)
        .collect();
    for trip in trips {
        if is_external_market_import_trip(&trip) {
            // The regional route begins at the map edge, not in marketplace
            // storage. Preserve paid cargo at its current physical position
            // when the named home disappears instead of returning it to a
            // fictional origin inventory.
            settle_stranded_trip(ctx, trip);
        } else {
            recall_trip_to_origin(ctx, trip);
        }
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
    let labor_source = household_delivery_labor_source(building);
    let delivery_workers =
        delivery_workers.min(delivery_labor_available(ctx, building.owner, labor_source));
    if delivery_workers == 0
        || tick.building_disabled_by_fire(ctx, building.id)
        || building_has_active_trip(ctx, building.id)
    {
        return false;
    }

    if labor_and_logistics_paused(ctx, tick, building.owner, clock) {
        return false;
    }

    let delivery_commodity = selected_food_delivery_commodity(building, need_kind);
    let available = delivery_commodity
        .map(|commodity| building_commodity_stock(building, commodity))
        .unwrap_or_else(|| building_delivery_stock(building, need_kind));
    if available <= 1e-6 {
        return false;
    }

    let batch = per_delivery_amount * delivery_workers as f64;
    let Some((residence_id, residence_x, residence_z, load_amount)) = pick_delivery_target(
        ctx,
        available,
        batch,
        targets,
        need_kind,
        delivery_commodity,
        |residence_id| !tick.residence_disabled_by_fire(ctx, residence_id),
    ) else {
        return false;
    };

    let cargo_kind = delivery_commodity
        .map(CommodityKind::as_u8)
        .unwrap_or_else(|| need_kind.as_u8());
    let load_amount = delivery_commodity
        .map(|commodity| load_amount.min(building_commodity_stock(building, commodity)))
        .unwrap_or(load_amount);
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
            cargo_kind,
            delivery_workers,
            labor_source,
            speed_mps,
            unload_seconds,
            load_amount,
        },
        |origin, amount| {
            delivery_commodity
                .map(|commodity| withdraw_building_commodity(origin, commodity, amount))
                .unwrap_or_else(|| withdraw_delivery_cargo(origin, need_kind, amount))
        },
        |origin| *building = origin.clone(),
    )
}

/// Dispatch stock already staged at a marketplace using a worker rostered at
/// the granary or storehouse that owns the stall. The marketplace itself has
/// no labor slots; the named logistics worker remains reserved for the whole
/// round trip.
pub fn try_start_market_stall_delivery_trip(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    network: &RoadNetwork,
    marketplace: &mut Building,
    stall_workplace_id: u64,
    delivery_workers: u32,
    targets: &[Residence],
    need_kind: ResidenceNeedKind,
    speed_mps: f64,
    unload_seconds: f64,
    per_delivery_amount: f64,
) -> bool {
    let labor_source = DeliveryLaborSource::Building(stall_workplace_id);
    let delivery_workers = delivery_workers.min(delivery_labor_available(
        ctx,
        marketplace.owner,
        labor_source,
    ));
    if delivery_workers == 0
        || tick.building_disabled_by_fire(ctx, marketplace.id)
        || labor_and_logistics_paused(ctx, tick, marketplace.owner, clock)
    {
        return false;
    }
    let delivery_commodity = selected_food_delivery_commodity(marketplace, need_kind);
    let available = delivery_commodity
        .map(|commodity| building_commodity_stock(marketplace, commodity))
        .unwrap_or_else(|| building_delivery_stock(marketplace, need_kind));
    let batch = per_delivery_amount * delivery_workers as f64;
    let Some((residence_id, residence_x, residence_z, load_amount)) = pick_delivery_target(
        ctx,
        available,
        batch,
        targets,
        need_kind,
        delivery_commodity,
        |residence_id| !tick.residence_disabled_by_fire(ctx, residence_id),
    ) else {
        return false;
    };
    let cargo_kind = delivery_commodity
        .map(CommodityKind::as_u8)
        .unwrap_or_else(|| need_kind.as_u8());
    let load_amount = delivery_commodity
        .map(|commodity| load_amount.min(building_commodity_stock(marketplace, commodity)))
        .unwrap_or(load_amount);
    try_start_road_trip(
        ctx,
        tick,
        clock,
        network,
        StartTripSpec {
            origin: marketplace.clone(),
            destination: TripDestination::Residence {
                id: residence_id,
                x: residence_x,
                z: residence_z,
            },
            cargo_kind,
            delivery_workers,
            labor_source,
            speed_mps,
            unload_seconds,
            load_amount,
        },
        |origin, amount| {
            delivery_commodity
                .map(|commodity| withdraw_building_commodity(origin, commodity, amount))
                .unwrap_or_else(|| withdraw_delivery_cargo(origin, need_kind, amount))
        },
        |origin| *marketplace = origin.clone(),
    )
}

pub fn residence_has_inbound_remedy_trip(ctx: &ReducerContext, residence_id: u64) -> bool {
    ctx.db
        .delivery_trip()
        .residence_id()
        .filter(&residence_id)
        .any(|trip| {
            trip.destination_kind == DELIVERY_DESTINATION_RESIDENCE_REMEDY
                && trip.cargo_kind == CommodityKind::Remedies.as_u8()
                && DeliveryTripPhase::from_u8(trip.phase) != Some(DeliveryTripPhase::Inbound)
        })
}

/// A storehouse worker operating the Marketplace's goods stall carries pooled
/// household herb surplus to the least-covered sick home. The market square
/// owns no labor slots, so the named depot worker remains reserved for the
/// complete round trip just like every other stall delivery.
pub fn try_start_market_stall_remedy_trip(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    network: &RoadNetwork,
    marketplace: &mut Building,
    stall_workplace_id: u64,
    delivery_workers: u32,
    residence: &Residence,
) -> bool {
    let labor_source = DeliveryLaborSource::Building(stall_workplace_id);
    let delivery_workers = delivery_workers.min(delivery_labor_available(
        ctx,
        marketplace.owner,
        labor_source,
    ));
    if marketplace.kind != "marketplace"
        || delivery_workers == 0
        || marketplace.owner != residence.owner
        || residence.abandoned
        || residence.population == 0
        || residence.sick_population == 0
        || tick.building_disabled_by_fire(ctx, marketplace.id)
        || tick.residence_disabled_by_fire(ctx, residence.id)
        || residence_has_inbound_remedy_trip(ctx, residence.id)
        || labor_and_logistics_paused(ctx, tick, marketplace.owner, clock)
    {
        return false;
    }

    let target_stock = (residence.sick_population as f64
        * HERB_TREATMENT_PER_SICK_DAY
        * REMEDY_DELIVERY_TARGET_DAYS)
        .min(HERB_REMEDY_CAPACITY);
    let household_room = (HERB_REMEDY_CAPACITY - residence.remedy_stock).max(0.0);
    let needed = (target_stock - residence.remedy_stock).max(0.0);
    let load = building_commodity_stock(marketplace, CommodityKind::Remedies)
        .min(household_room)
        .min(needed)
        .min(REMEDIES_PER_DELIVERY * delivery_workers as f64);
    if load <= 1e-6 {
        return false;
    }

    try_start_road_trip(
        ctx,
        tick,
        clock,
        network,
        StartTripSpec {
            origin: marketplace.clone(),
            destination: TripDestination::ResidenceRemedy {
                id: residence.id,
                x: residence.x,
                z: residence.z,
            },
            cargo_kind: CommodityKind::Remedies.as_u8(),
            delivery_workers,
            labor_source,
            speed_mps: REMEDY_DELIVERY_SPEED_MPS,
            unload_seconds: REMEDY_DELIVERY_UNLOAD_SEC,
            load_amount: load,
        },
        |origin, amount| withdraw_building_commodity(origin, CommodityKind::Remedies, amount),
        |origin| *marketplace = origin.clone(),
    )
}

/// Load dried remedies from a staffed forager shed and credit them only after
/// its handcart physically reaches the sick household.
pub fn try_start_remedy_delivery_trip(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    network: &RoadNetwork,
    forager: &mut Building,
    residence: &Residence,
    delivery_workers: u32,
) -> bool {
    let labor_source = DeliveryLaborSource::Free;
    let delivery_workers =
        delivery_workers.min(delivery_labor_available(ctx, forager.owner, labor_source));
    if forager.kind != "foragers_shed"
        || delivery_workers == 0
        || forager.owner != residence.owner
        || residence.abandoned
        || residence.population == 0
        || residence.sick_population == 0
        || tick.building_disabled_by_fire(ctx, forager.id)
        || tick.residence_disabled_by_fire(ctx, residence.id)
        || building_has_active_trip(ctx, forager.id)
        || residence_has_inbound_remedy_trip(ctx, residence.id)
        || labor_and_logistics_paused(ctx, tick, forager.owner, clock)
    {
        return false;
    }

    let target_stock = (residence.sick_population as f64
        * HERB_TREATMENT_PER_SICK_DAY
        * REMEDY_DELIVERY_TARGET_DAYS)
        .min(HERB_REMEDY_CAPACITY);
    let household_room = (HERB_REMEDY_CAPACITY - residence.remedy_stock).max(0.0);
    let needed = (target_stock - residence.remedy_stock).max(0.0);
    let load = building_commodity_stock(forager, CommodityKind::Remedies)
        .min(household_room)
        .min(needed)
        .min(REMEDIES_PER_DELIVERY * delivery_workers as f64);
    if load <= 1e-6 {
        return false;
    }

    try_start_road_trip(
        ctx,
        tick,
        clock,
        network,
        StartTripSpec {
            origin: forager.clone(),
            destination: TripDestination::ResidenceRemedy {
                id: residence.id,
                x: residence.x,
                z: residence.z,
            },
            cargo_kind: CommodityKind::Remedies.as_u8(),
            delivery_workers,
            labor_source,
            speed_mps: REMEDY_DELIVERY_SPEED_MPS,
            unload_seconds: REMEDY_DELIVERY_UNLOAD_SEC,
            load_amount: load,
        },
        |origin, amount| withdraw_building_commodity(origin, CommodityKind::Remedies, amount),
        |origin| *forager = origin.clone(),
    )
}

/// Sends one physically held parish-alms purse to an occupied household.
/// Gold remains in the chapel until a free villager can claim a live road
/// route, remains raid-vulnerable on the journey, and becomes household wealth
/// only when unloading succeeds.
pub fn try_start_residence_wealth_trip(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    network: &RoadNetwork,
    chapel: &mut Building,
    residence: &Residence,
    speed_mps: f64,
    unload_seconds: f64,
    requested: f64,
) -> f64 {
    if chapel.kind != "chapel"
        || !chapel.construction_complete
        || chapel.owner != residence.owner
        || residence.abandoned
        || residence.population == 0
        || tick.building_disabled_by_fire(ctx, chapel.id)
        || tick.residence_disabled_by_fire(ctx, residence.id)
        || building_has_active_trip(ctx, chapel.id)
        || available_free_haulers(ctx, chapel.owner) == 0
    {
        return 0.0;
    }

    let household_room = (HOUSEHOLD_MAX_WEALTH - residence.household_wealth).max(0.0);
    let load = chapel_coffer_gold(chapel)
        .min(household_room)
        .min(requested.max(0.0));
    if load <= 1e-6 {
        return 0.0;
    }

    let before = chapel.gold;
    let started = try_start_road_trip(
        ctx,
        tick,
        clock,
        network,
        StartTripSpec {
            origin: chapel.clone(),
            destination: TripDestination::ResidenceWealth {
                id: residence.id,
                x: residence.x,
                z: residence.z,
            },
            cargo_kind: CommodityKind::Gold.as_u8(),
            delivery_workers: 1,
            labor_source: DeliveryLaborSource::Free,
            speed_mps,
            unload_seconds,
            load_amount: load,
        },
        |source, amount| withdraw_coffer_in_place(source, amount),
        |source| *chapel = source.clone(),
    );
    if started {
        (before - chapel.gold).max(0.0)
    } else {
        0.0
    }
}

pub fn residence_has_inbound_wealth_trip(ctx: &ReducerContext, residence_id: u64) -> bool {
    ctx.db
        .delivery_trip()
        .residence_id()
        .filter(&residence_id)
        .any(|trip| trip.destination_kind == DELIVERY_DESTINATION_RESIDENCE_WEALTH)
}

/// Distributes private specialty-export proceeds from the Trading Post to
/// household savings. A free villager carries the purse; assigned traders
/// remain available for actual regional routes.
pub fn try_start_private_export_income_trip(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    network: &RoadNetwork,
    trading_post: &mut Building,
    residence: &Residence,
    requested: f64,
) -> f64 {
    if trading_post.kind != "trading_post"
        || !trading_post.construction_complete
        || trading_post.owner != residence.owner
        || residence.abandoned
        || residence.population == 0
        || tick.building_disabled_by_fire(ctx, trading_post.id)
        || tick.residence_disabled_by_fire(ctx, residence.id)
        || building_has_active_trip(ctx, trading_post.id)
        || residence_has_inbound_wealth_trip(ctx, residence.id)
        || available_free_haulers(ctx, trading_post.owner) == 0
    {
        return 0.0;
    }
    let household_room = (HOUSEHOLD_MAX_WEALTH - residence.household_wealth).max(0.0);
    let load = private_export_proceeds(trading_post)
        .min(household_room)
        .min(requested.max(0.0));
    if load <= 1e-6 {
        return 0.0;
    }
    let before = trading_post.gold;
    let started = try_start_road_trip(
        ctx,
        tick,
        clock,
        network,
        StartTripSpec {
            origin: trading_post.clone(),
            destination: TripDestination::ResidenceWealth {
                id: residence.id,
                x: residence.x,
                z: residence.z,
            },
            cargo_kind: CommodityKind::Gold.as_u8(),
            delivery_workers: 1,
            labor_source: DeliveryLaborSource::Free,
            speed_mps: TIMBER_DELIVERY_SPEED_MPS,
            unload_seconds: TIMBER_DELIVERY_UNLOAD_SEC,
            load_amount: load,
        },
        |source, amount| withdraw_private_export_proceeds(source, amount),
        |source| *trading_post = source.clone(),
    );
    if started {
        (before - trading_post.gold).max(0.0)
    } else {
        0.0
    }
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
    let labor_source = ordinary_supply_labor_source(origin, target);
    try_start_building_supply_trip_with_labor(
        ctx,
        tick,
        clock,
        network,
        origin,
        target,
        delivery_workers,
        commodity,
        speed_mps,
        unload_seconds,
        per_delivery_amount,
        needed,
        labor_source,
    )
}

/// Sends a producer's own rostered worker with its cargo. This is reserved for
/// institutions whose identity depends on the named worker making the trip,
/// rather than a depot worker collecting the load.
#[allow(clippy::too_many_arguments)]
pub fn try_start_origin_rostered_building_supply_trip(
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
    let origin_id = origin.id;
    try_start_building_supply_trip_with_labor(
        ctx,
        tick,
        clock,
        network,
        origin,
        target,
        delivery_workers,
        commodity,
        speed_mps,
        unload_seconds,
        per_delivery_amount,
        needed,
        DeliveryLaborSource::Building(origin_id),
    )
}

/// Ad-hoc cleanup and founding-stock work always belongs to the flexible
/// settlement pool, even when the destination is a staffed depot.
pub fn try_start_free_building_supply_trip(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    network: &RoadNetwork,
    origin: &mut Building,
    target: &Building,
    commodity: CommodityKind,
    speed_mps: f64,
    unload_seconds: f64,
    per_delivery_amount: f64,
    needed: f64,
) -> bool {
    try_start_building_supply_trip_with_labor(
        ctx,
        tick,
        clock,
        network,
        origin,
        target,
        1,
        commodity,
        speed_mps,
        unload_seconds,
        per_delivery_amount,
        needed,
        DeliveryLaborSource::Free,
    )
}

#[allow(clippy::too_many_arguments)]
fn try_start_building_supply_trip_with_labor(
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
    labor_source: DeliveryLaborSource,
) -> bool {
    let delivery_workers =
        delivery_workers.min(delivery_labor_available(ctx, origin.owner, labor_source));
    if delivery_workers == 0
        || tick.building_disabled_by_fire(ctx, origin.id)
        || tick.building_disabled_by_fire(ctx, target.id)
        || building_has_active_trip(ctx, origin.id)
        || building_has_conflicting_inbound_supply_trip(ctx, target, commodity)
    {
        return false;
    }

    if labor_and_logistics_paused(ctx, tick, origin.owner, clock) {
        return false;
    }

    if building_commodity_stock(origin, commodity) <= 1e-6 {
        return false;
    }

    if !storage_accepts_commodity(target, commodity) {
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
            labor_source,
            speed_mps,
            unload_seconds,
            load_amount: load,
        },
        |source, amount| withdraw_building_commodity(source, commodity, amount),
        |source| *origin = source.clone(),
    )
}

/// Loads one reserved residence-improvement material and sends it to the
/// occupied household over the same physical cart network as new construction.
/// Every improvement load reserves one free villager for the full round trip;
/// storage and production rosters remain at their assigned jobs.
pub fn try_start_residence_upgrade_supply_trip(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    network: &RoadNetwork,
    origin: &mut Building,
    residence: &mut Residence,
    commodity: CommodityKind,
    available_free_haulers: u32,
) -> bool {
    if !origin.construction_complete
        || !residence_project_active(
            residence.upgrade_target_tier,
            residence.tier,
            residence.backyard_project_kind,
            residence.fire_repair_active,
            residence.decay_repair_active,
            residence.roof_tile_retrofit_active,
        )
        || origin.owner != residence.owner
        || tick.building_disabled_by_fire(ctx, origin.id)
        || (tick.residence_disabled_by_fire(ctx, residence.id) && !residence.fire_repair_active)
        || construction_source_cart_busy(ctx, origin)
        || (origin.kind == "village_storehouse" && building_has_inbound_supply_trip(ctx, origin.id))
        || labor_and_logistics_paused(ctx, tick, origin.owner, clock)
    {
        return false;
    }

    let reserved = match commodity {
        CommodityKind::Timber => residence.upgrade_reserved_timber,
        CommodityKind::Stone => residence.upgrade_reserved_stone,
        CommodityKind::Gold => residence.upgrade_reserved_gold,
        CommodityKind::RoofTiles => residence.upgrade_reserved_roof_tiles,
        _ => 0.0,
    }
    .max(0.0);
    if reserved <= 1e-6 {
        return false;
    }
    let workers = available_free_haulers.min(1);
    if workers == 0 {
        return false;
    }
    let haul_per_worker = if commodity == CommodityKind::Gold {
        STOREHOUSE_HAUL_PER_WORKER
    } else {
        CONSTRUCTION_HAUL_PER_WORKER
    };
    let load = building_commodity_stock(origin, commodity)
        .min(reserved)
        .min(haul_per_worker * workers as f64);
    if load <= 1e-6 {
        return false;
    }
    let Some(local_route) =
        local_delivery_route(network, origin.x, origin.z, residence.x, residence.z)
    else {
        return false;
    };

    let mut source = origin.clone();
    let withdrawn = withdraw_building_commodity(&mut source, commodity, load);
    if withdrawn <= 1e-6 {
        return false;
    }
    match commodity {
        CommodityKind::Timber => {
            residence.upgrade_reserved_timber =
                (residence.upgrade_reserved_timber - withdrawn).max(0.0)
        }
        CommodityKind::Stone => {
            residence.upgrade_reserved_stone =
                (residence.upgrade_reserved_stone - withdrawn).max(0.0)
        }
        CommodityKind::Gold => {
            residence.upgrade_reserved_gold = (residence.upgrade_reserved_gold - withdrawn).max(0.0)
        }
        CommodityKind::RoofTiles => {
            residence.upgrade_reserved_roof_tiles =
                (residence.upgrade_reserved_roof_tiles - withdrawn).max(0.0)
        }
        _ => return false,
    }
    *origin = source.clone();
    ctx.db.building().id().update(source.clone());
    ctx.db.residence().id().update(residence.clone());
    insert_trip(
        ctx,
        tick,
        network,
        StartTripSpec {
            origin: source,
            destination: TripDestination::Residence {
                id: residence.id,
                x: residence.x,
                z: residence.z,
            },
            cargo_kind: commodity.as_u8(),
            delivery_workers: workers,
            labor_source: DeliveryLaborSource::Free,
            speed_mps: CONSTRUCTION_DELIVERY_SPEED_MPS,
            unload_seconds: CONSTRUCTION_DELIVERY_UNLOAD_SEC,
            load_amount: withdrawn,
        },
        local_route.route,
        local_route.speed_multiplier,
    );
    true
}

/// Dispatch one visible bucket carrier from an unstaffed well. Every trip
/// reserves its own free hauler, so a well may launch several simultaneous
/// responders when a fire's outstanding water demand, stored water, and the
/// settlement labor pool allow it. Fire response may leave the road for the
/// last leg, but still uses the cached authoritative route.
pub fn try_start_fire_response_trip(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    network: &RoadNetwork,
    well: &mut Building,
    incident: &FireIncident,
) -> bool {
    if well.kind != "well"
        || available_free_haulers(ctx, well.owner) == 0
        || fire_response_load(well.water) <= 0.0
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
    let Some(local_route) = local_delivery_route(network, well.x, well.z, target_x, target_z)
    else {
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
            labor_source: DeliveryLaborSource::Free,
            speed_mps: FIRE_BUCKET_SPEED_MPS,
            unload_seconds: FIRE_BUCKET_UNLOAD_SECONDS,
            load_amount: load,
        },
        local_route.route,
        local_route.speed_multiplier,
    );
    true
}

/// Loads reserved construction stock from any completed source and sends it to
/// a construction site. A staffed storehouse supplies its own crew, otherwise
/// a free villager hauls the load. If neither is available, each still-onsite
/// builder at a material-blocked site may temporarily operate a distinct cart.
/// Live onsite labor excludes builders already traveling, while the trip's
/// labor-building ownership keeps every borrowed builder reserved until return.
/// Each reservation is reduced at loading time; if a trip is recalled, it is
/// restored while the load physically returns.
pub fn try_start_construction_supply_trip(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    network: &RoadNetwork,
    origin: &mut Building,
    site: &mut Building,
    commodity: CommodityKind,
    available_free_haulers: u32,
) -> bool {
    if !origin.construction_complete
        || site.construction_complete
        || origin.owner != site.owner
        || tick.building_disabled_by_fire(ctx, origin.id)
        || construction_source_cart_busy(ctx, origin)
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
        CommodityKind::Ironwork => {
            (site.construction_reserved_ironwork - site.construction_treasury_ironwork).max(0.0)
        }
        CommodityKind::RoofTiles => {
            (site.construction_reserved_roof_tiles - site.construction_treasury_roof_tiles).max(0.0)
        }
        _ => 0.0,
    };
    let storehouse_workers = if origin.kind == "village_storehouse" {
        onsite_building_labor(ctx, origin).min(2)
    } else {
        0
    };
    let site_work_ready = construction_labor_ready(
        site.construction_required_timber,
        site.construction_required_stone,
        site.construction_required_ironwork,
        site.construction_delivered_timber,
        site.construction_delivered_stone,
        site.construction_delivered_ironwork,
        site.construction_progress,
        site.construction_treasury_timber,
        site.construction_treasury_stone,
        site.construction_treasury_ironwork,
        site.construction_required_roof_tiles,
        site.construction_delivered_roof_tiles,
        site.construction_treasury_roof_tiles,
    );
    let onsite_builders = onsite_building_labor(ctx, site);
    let crew = construction_supply_crew(
        storehouse_workers,
        available_free_haulers,
        onsite_builders,
        site.assigned_labor.saturating_sub(onsite_builders),
        site_work_ready,
    );
    let (workers, haul_per_worker, labor_source) = match crew {
        Some(ConstructionSupplyCrew::Storehouse(workers)) => (
            workers,
            STOREHOUSE_HAUL_PER_WORKER,
            DeliveryLaborSource::Building(origin.id),
        ),
        Some(ConstructionSupplyCrew::Free) => {
            (1, CONSTRUCTION_HAUL_PER_WORKER, DeliveryLaborSource::Free)
        }
        Some(ConstructionSupplyCrew::SiteBuilder) => (
            1,
            CONSTRUCTION_HAUL_PER_WORKER,
            DeliveryLaborSource::Building(site.id),
        ),
        None => return false,
    };
    let commodity_name = match commodity {
        CommodityKind::Timber => "timber",
        CommodityKind::Stone => "stone",
        CommodityKind::Ironwork => "ironwork",
        CommodityKind::RoofTiles => "roofTiles",
        _ => "",
    };
    let load = construction_source_available_stock(
        &origin.kind,
        origin.carpenter_cart_service_target_trips,
        commodity_name,
        building_commodity_stock(origin, commodity),
    )
    .min(reserved_physical)
    .min(haul_per_worker * workers as f64);
    if load <= 1e-6 {
        return false;
    }

    let Some(local_route) = local_delivery_route(network, origin.x, origin.z, site.x, site.z)
    else {
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
        CommodityKind::Ironwork => {
            site.construction_reserved_ironwork =
                (site.construction_reserved_ironwork - withdrawn).max(0.0)
        }
        CommodityKind::RoofTiles => {
            site.construction_reserved_roof_tiles =
                (site.construction_reserved_roof_tiles - withdrawn).max(0.0)
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
            labor_source,
            speed_mps: CONSTRUCTION_DELIVERY_SPEED_MPS,
            unload_seconds: CONSTRUCTION_DELIVERY_UNLOAD_SEC,
            load_amount: withdrawn,
        },
        local_route.route,
        local_route.speed_multiplier,
    );
    true
}

fn try_start_road_trip(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    network: &RoadNetwork,
    mut spec: StartTripSpec,
    withdraw: impl FnOnce(&mut Building, f64) -> f64,
    write_origin: impl FnOnce(&Building),
) -> bool {
    if labor_and_logistics_paused(ctx, tick, spec.origin.owner, clock) {
        return false;
    }
    spec.delivery_workers = resolve_delivery_workers(ctx, &spec);
    if spec.delivery_workers == 0 {
        return false;
    }

    let (dest_x, dest_z) = spec.destination.end_point();
    let Some(local_route) =
        local_delivery_route(network, spec.origin.x, spec.origin.z, dest_x, dest_z)
    else {
        return false;
    };

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
        local_route.route,
        local_route.speed_multiplier,
    );
    true
}

fn insert_trip(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    network: &RoadNetwork,
    spec: StartTripSpec,
    route: RoadPathRoute,
    route_speed_multiplier: f64,
) {
    let (destination_kind, residence_id, target_building_id) = spec.destination.to_row_fields();
    let (start_x, start_z) = RoadNetwork::sample_polyline_xz(&route.polyline, 0.0);
    let regional_market_trip = destination_kind == DELIVERY_DESTINATION_REGIONAL_TRADE;
    let cartwright_multiplier = if regional_market_trip {
        1.0
    } else {
        carpenter_delivery_multiplier_for_origin(
            ctx,
            tick,
            network,
            &spec.origin,
            spec.origin.owner,
        )
    };
    let road_condition_multiplier = ctx
        .db
        .world_config()
        .id()
        .find(&0)
        .map(|config| {
            environment_for(
                config.seed,
                config.hydrology,
                config.severe_weather_enabled,
                &game_clock(config.sim_tick),
            )
                .road_speed_multiplier()
        })
        .unwrap_or(1.0);
    let travel_speed_multiplier =
        cartwright_multiplier * road_condition_multiplier * route_speed_multiplier;
    let (labor_building_id, free_hauler_workers) = match spec.labor_source {
        DeliveryLaborSource::Free => (0, spec.delivery_workers),
        DeliveryLaborSource::Building(building_id) => (building_id, 0),
        DeliveryLaborSource::External => (0, 0),
    };

    ctx.db.delivery_trip().insert(DeliveryTrip {
        id: 0,
        owner: spec.origin.owner,
        building_id: spec.origin.id,
        labor_building_id,
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
    let Some(initial_phase) = DeliveryTripPhase::from_u8(trip.phase) else {
        settle_stranded_trip(ctx, trip);
        return;
    };
    let fire_response = trip.destination_kind == DELIVERY_DESTINATION_FIRE;
    let external_market_import = is_external_market_import_trip(&trip);
    let regional_market_trip = is_regional_market_trip(&trip);
    let raid_posture = raid_cart_posture(
        !fire_response
            && !regional_market_trip
            && tick.owner_has_active_raider_threat(ctx, trip.owner),
        fire_response,
        initial_phase,
    );
    match raid_posture {
        RaidCartPosture::Recall => {
            recall_trip_to_origin_during_raid(ctx, trip, clock.sim_tick);
            return;
        }
        RaidCartPosture::ReturnHome => {
            // The emergency alarm overrides night and sabbath rest only long
            // enough for this already-returning cart to reach its origin.
        }
        RaidCartPosture::Ordinary => {
            // Dispatch is independently gated by work hours and Sabbath at
            // every trip-start boundary. Once a crew has physically departed,
            // it completes the committed outbound leg, unload, and return
            // instead of camping on the road when the workday ends.
        }
    }

    let Some(network) = tick.road_network(trip.owner) else {
        settle_stranded_trip(ctx, trip);
        return;
    };

    let Some(route) = cached_trip_route(ctx, &network, &trip) else {
        settle_stranded_trip(ctx, trip);
        return;
    };

    let path_distance = route.distance;
    trip.progress = trip.progress.min(path_distance);

    let workers = trip.delivery_workers.max(1) as f64;
    let base_travel_speed = trip.speed_mps * workers * trip.travel_speed_multiplier.max(1e-6);

    if base_travel_speed <= 1e-9 {
        return;
    }

    let mut remaining_seconds = elapsed_seconds;
    while remaining_seconds > 1e-9 {
        let Some(phase) = DeliveryTripPhase::from_u8(trip.phase) else {
            settle_stranded_trip(ctx, trip);
            return;
        };

        match phase {
            DeliveryTripPhase::Outbound => {
                let travel_speed = base_travel_speed * cart_load_speed_multiplier(&trip);
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
                    if external_market_import && trip.amount > 1e-6 {
                        // The player has already paid for this physical load.
                        // If another delivery filled the destination while it
                        // was travelling, keep the remainder visibly waiting
                        // instead of deleting it beyond the map edge.
                        trip.unload_remaining = trip.unload_seconds / workers;
                        remaining_seconds = 0.0;
                    } else {
                        trip.phase = DeliveryTripPhase::Inbound.as_u8();
                        trip.progress = 0.0;
                    }
                }
            }
            DeliveryTripPhase::Inbound => {
                let travel_speed = base_travel_speed * cart_load_speed_multiplier(&trip);
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
                    finish_inbound_trip(ctx, trip, clock.sim_tick);
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
            settle_stranded_trip(ctx, trip);
            return;
        }
    }
    ctx.db.delivery_trip().id().update(trip);
}

const DELIVERY_ROAD_SPEED_MULTIPLIER: f64 = 1.35;
const EMPTY_CART_SPEED_MULTIPLIER: f64 = 1.3;
const VISIBLE_CART_CARGO_EPSILON: f64 = 0.05;
const SURFACE_SPEED_SAMPLE_SECONDS: f64 = 0.25;

fn cart_load_speed_multiplier(trip: &DeliveryTrip) -> f64 {
    if trip.amount > VISIBLE_CART_CARGO_EPSILON {
        1.0
    } else {
        EMPTY_CART_SPEED_MULTIPLIER
    }
}

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
            local_delivery_route(network, building.x, building.z, x, z).map(|route| route.route)
        }
        DELIVERY_DESTINATION_BUILDING => {
            let target = ctx.db.building().id().find(&trip.target_building_id)?;
            local_delivery_route(network, building.x, building.z, target.x, target.z)
                .map(|route| route.route)
        }
        DELIVERY_DESTINATION_REGIONAL_TRADE => None,
        _ => {
            let residence = ctx.db.residence().id().find(&trip.residence_id)?;
            local_delivery_route(network, building.x, building.z, residence.x, residence.z)
                .map(|route| route.route)
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
    } else if trip.destination_kind == DELIVERY_DESTINATION_REGIONAL_TRADE {
        match settle_regional_market_export(
            ctx,
            trip.owner,
            trip.target_building_id,
            trip.residence_id,
            commodity,
            trip.amount,
        ) {
            Ok((received_commodity, received_amount)) => {
                trip.cargo_kind = received_commodity.as_u8();
                trip.amount = received_amount.max(0.0);
            }
            Err(error) => {
                // A corrupt or obsolete contract returns its original load to
                // the marketplace rather than deleting physical stock.
                log::warn!("Regional export exchange failed; returning its cargo: {error}");
            }
        }
    } else if trip.destination_kind == DELIVERY_DESTINATION_BUILDING {
        unload_commodity_to_building(ctx, trip, commodity);
    } else if trip.destination_kind == DELIVERY_DESTINATION_RESIDENCE_WEALTH
        && commodity == CommodityKind::Gold
    {
        unload_wealth_to_residence(ctx, trip);
    } else if trip.destination_kind == DELIVERY_DESTINATION_RESIDENCE_REMEDY
        && commodity == CommodityKind::Remedies
    {
        unload_remedies_to_residence(ctx, trip);
    } else if commodity.is_edible() {
        unload_food_to_residence(ctx, trip, commodity);
    } else if matches!(
        commodity,
        CommodityKind::Timber
            | CommodityKind::Stone
            | CommodityKind::Gold
            | CommodityKind::RoofTiles
    ) && ctx
        .db
        .residence()
        .id()
        .find(&trip.residence_id)
        .is_some_and(|residence| {
            residence_project_active(
                residence.upgrade_target_tier,
                residence.tier,
                residence.backyard_project_kind,
                residence.fire_repair_active,
                residence.decay_repair_active,
                residence.roof_tile_retrofit_active,
            )
        })
    {
        unload_residence_upgrade_material(ctx, trip, commodity);
    } else if let Some(need_kind) = ResidenceNeedKind::from_u8(trip.cargo_kind) {
        unload_need_to_residence(ctx, trip, need_kind);
    }
}

fn unload_food_to_residence(
    ctx: &ReducerContext,
    trip: &mut DeliveryTrip,
    commodity: CommodityKind,
) {
    let Some(mut residence) = ctx.db.residence().id().find(&trip.residence_id) else {
        return;
    };
    if residence.abandoned
        || residence.population == 0
        || residence_fire_state(ctx, residence.id).is_some()
    {
        return;
    }
    let delivered = deposit_residence_commodity(
        &mut residence,
        commodity,
        trip.amount,
        crate::simulation::residence_needs::food::stock_capacity(),
        crate::simulation::residence_needs::provisions::stock_capacity(
            ResidenceNeedKind::PreservedFood,
        ),
    );
    if delivered <= 1e-6 {
        return;
    }
    trip.amount = (trip.amount - delivered).max(0.0);
    ctx.db.residence().id().update(residence.clone());
    sync_food_need_rows(ctx, &residence);
    if let Some(origin) = ctx.db.building().id().find(&trip.building_id) {
        if origin.kind == "monastery" {
            if let Some(mut resources) = ctx.db.player_resources().owner().find(&trip.owner) {
                resources.monastery_food_charity_total += delivered;
                ctx.db.player_resources().owner().update(resources);
            }
        }
    }
}

fn unload_remedies_to_residence(ctx: &ReducerContext, trip: &mut DeliveryTrip) {
    let Some(mut residence) = ctx.db.residence().id().find(&trip.residence_id) else {
        return;
    };
    if residence.abandoned
        || residence.population == 0
        || residence_fire_state(ctx, residence.id).is_some()
    {
        return;
    }
    let delivered = trip
        .amount
        .min((HERB_REMEDY_CAPACITY - residence.remedy_stock).max(0.0));
    if delivered <= 1e-6 {
        return;
    }
    residence.remedy_stock += delivered;
    trip.amount = (trip.amount - delivered).max(0.0);
    ctx.db.residence().id().update(residence);
}

fn unload_wealth_to_residence(ctx: &ReducerContext, trip: &mut DeliveryTrip) {
    let Some(residence) = ctx.db.residence().id().find(&trip.residence_id) else {
        return;
    };
    if residence.abandoned
        || residence.population == 0
        || residence_fire_state(ctx, residence.id).is_some()
    {
        return;
    }

    let delivered = credit_residence_wealth(ctx, residence.id, trip.amount);
    if delivered <= 1e-6 {
        return;
    }
    trip.amount = (trip.amount - delivered).max(0.0);
    match ctx
        .db
        .building()
        .id()
        .find(&trip.building_id)
        .map(|building| building.kind)
        .as_deref()
    {
        Some("chapel") => {
            record_parish_ledger(ctx, trip.owner, ParishLedgerKind::Charity, delivered)
        }
        Some("trading_post") => record_private_export_income(ctx, trip.owner, delivered),
        _ => {}
    }
}

fn unload_residence_upgrade_material(
    ctx: &ReducerContext,
    trip: &mut DeliveryTrip,
    commodity: CommodityKind,
) {
    let Some(mut residence) = ctx.db.residence().id().find(&trip.residence_id) else {
        return;
    };
    if !residence_project_active(
        residence.upgrade_target_tier,
        residence.tier,
        residence.backyard_project_kind,
        residence.fire_repair_active,
        residence.decay_repair_active,
        residence.roof_tile_retrofit_active,
    ) {
        return;
    }
    let room = match commodity {
        CommodityKind::Timber => {
            (residence.upgrade_required_timber - residence.upgrade_delivered_timber).max(0.0)
        }
        CommodityKind::Stone => {
            (residence.upgrade_required_stone - residence.upgrade_delivered_stone).max(0.0)
        }
        CommodityKind::Gold => {
            (residence.upgrade_required_gold - residence.upgrade_delivered_gold).max(0.0)
        }
        CommodityKind::RoofTiles => (residence.upgrade_required_roof_tiles
            - residence.upgrade_delivered_roof_tiles)
            .max(0.0),
        _ => 0.0,
    };
    let delivered = trip.amount.min(room);
    if delivered <= 1e-6 {
        return;
    }
    match commodity {
        CommodityKind::Timber => residence.upgrade_delivered_timber += delivered,
        CommodityKind::Stone => residence.upgrade_delivered_stone += delivered,
        CommodityKind::Gold => residence.upgrade_delivered_gold += delivered,
        CommodityKind::RoofTiles => residence.upgrade_delivered_roof_tiles += delivered,
        _ => {}
    }
    trip.amount = (trip.amount - delivered).max(0.0);
    ctx.db.residence().id().update(residence);
}

fn carpenter_delivery_multiplier_for_origin(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    network: &RoadNetwork,
    origin: &Building,
    owner: spacetimedb::Identity,
) -> f64 {
    let serviced = tick
        .building_ids_for_kinds(ctx, owner, &["carpenter"])
        .into_iter()
        .filter_map(|building_id| ctx.db.building().id().find(&building_id))
        .filter_map(|shop| {
            if shop.kind != "carpenter"
                || !shop.construction_complete
                || shop.assigned_labor == 0
                || building_fire_state(ctx, shop.id).is_some()
                || !carpenter_cart_service_ready(
                    shop.carpenter_cart_service_target_trips,
                    shop.timber,
                    shop.ironwork,
                )
            {
                return None;
            }
            local_delivery_distance(network, origin.x, origin.z, shop.x, shop.z)
                .map(|distance| (shop, distance))
        })
        .min_by(|(a, a_distance), (b, b_distance)| {
            a_distance
                .total_cmp(b_distance)
                .then_with(|| a.id.cmp(&b.id))
        });
    if let Some((mut shop, _distance)) = serviced {
        withdraw_building_commodity(
            &mut shop,
            CommodityKind::Timber,
            CARPENTER_CART_SERVICE_TIMBER_PER_TRIP,
        );
        withdraw_building_commodity(
            &mut shop,
            CommodityKind::Ironwork,
            CARPENTER_CART_SERVICE_IRONWORK_PER_TRIP,
        );
        ctx.db.building().id().update(shop);
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
            CommodityKind::Ironwork => {
                let room = (target.construction_required_ironwork
                    - target.construction_delivered_ironwork)
                    .max(0.0);
                let amount = trip.amount.min(room);
                target.construction_delivered_ironwork += amount;
                amount
            }
            CommodityKind::RoofTiles => {
                let room = (target.construction_required_roof_tiles
                    - target.construction_delivered_roof_tiles)
                    .max(0.0);
                let amount = trip.amount.min(room);
                target.construction_delivered_roof_tiles += amount;
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
    // A policy changed while the cart was on the road. Leave its cargo aboard;
    // the return leg restores it to the origin instead of bypassing the new
    // intake gate during unloading.
    if !storage_accepts_commodity(&target, commodity) {
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
    let monastery_seed_rescue = matches!(
        commodity,
        CommodityKind::RyeGrain | CommodityKind::OatGrain | CommodityKind::MaslinGrain
    ) && target.kind == "farmstead"
        && ctx
            .db
            .building()
            .id()
            .find(&trip.building_id)
            .is_some_and(|origin| origin.kind == "monastery");
    let local_milk_sale = commodity == CommodityKind::Milk
        && target.kind == "marketplace"
        && ctx
            .db
            .building()
            .id()
            .find(&trip.building_id)
            .is_some_and(|origin| origin.kind == "granary");
    let deposited = deposit_building_commodity(&mut target, commodity, trip.amount);
    if deposited > 1e-6 {
        trip.amount = (trip.amount - deposited).max(0.0);
        if local_milk_sale {
            let base_activity = deposited * FOOD_SALE_GOLD_PER_UNIT;
            let (adjusted, assessed_tax) = taxed_economic_activity(
                base_activity,
                player_economic_activity_tax_rate(ctx, target.owner),
            );
            let collected_tax =
                assessed_tax * town_hall_tax_collection_multiplier(ctx, target.owner);
            credit_settlement_household_income(
                ctx,
                target.owner,
                (adjusted - collected_tax).max(0.0),
            );
            credit_marketplace_receipt_gold(ctx, &mut target, collected_tax);
        }
        ctx.db.building().id().update(target);
        if monastery_tithe_delivery {
            if let Some(mut resources) = ctx.db.player_resources().owner().find(&trip.owner) {
                resources.monastery_tithe_paid_total += deposited;
                ctx.db.player_resources().owner().update(resources);
            }
        }
        if monastery_seed_rescue {
            if let Some(mut resources) = ctx.db.player_resources().owner().find(&trip.owner) {
                resources.monastery_seed_rescue_total += deposited;
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

fn finish_inbound_trip(ctx: &ReducerContext, trip: DeliveryTrip, sim_tick: u64) {
    let cart_raid_value = delivery_trip_portable_stores(&trip).raid_value();
    return_trip_cargo_to_building(ctx, &trip);
    hand_off_arriving_cart_pursuit(ctx, &trip, cart_raid_value, sim_tick);
    ctx.db.delivery_trip().id().delete(trip.id);
}

/// Cargo changes container when a handcart reaches its origin; it does not
/// disappear from a live pursuer. Move only agents still contesting this exact
/// trip onto the receiving building, and scale their loss fraction so the
/// cart's remaining value—not the whole warehouse—stays at risk.
fn hand_off_arriving_cart_pursuit(
    ctx: &ReducerContext,
    trip: &DeliveryTrip,
    cart_raid_value: f64,
    sim_tick: u64,
) {
    if cart_raid_value <= 1e-9 {
        return;
    }
    let Some(origin) = ctx
        .db
        .building()
        .id()
        .find(&trip.building_id)
        .filter(|building| building.owner == trip.owner)
    else {
        return;
    };
    let issued_polearms = issued_guard_polearms_by_building(ctx, trip.owner)
        .get(&origin.id)
        .copied()
        .unwrap_or(0.0);
    let receiving_store_raid_value =
        building_portable_stores_at_site(&origin, issued_polearms).raid_value();
    let followers = ctx
        .db
        .combat_agent()
        .owner()
        .filter(&trip.owner)
        .filter(|agent| {
            agent.target_kind == COMBAT_TARGET_DELIVERY_TRIP
                && agent.target_id == trip.id
                && combat_agent_follows_arriving_cart(agent.faction, agent.state, agent.health)
        })
        .collect::<Vec<_>>();
    for mut agent in followers {
        agent.target_kind = COMBAT_TARGET_BUILDING;
        agent.target_id = origin.id;
        agent.raid_anchor_building_id = 0;
        agent.loot_progress = 0.0;
        if agent.faction == COMBAT_FACTION_RAIDER {
            agent.loot_fraction = arriving_cart_store_loot_fraction(
                cart_raid_value,
                agent.loot_fraction,
                receiving_store_raid_value,
            );
            if agent.state == COMBAT_STATE_LOOTING {
                agent.state = COMBAT_STATE_ADVANCING;
                agent.state_changed_tick = sim_tick;
            }
        }
        ctx.db.combat_agent().id().update(agent);
    }
}

fn recalled_inbound_progress(phase: DeliveryTripPhase, path_distance: f64, progress: f64) -> f64 {
    let path_distance = path_distance.max(0.0);
    let progress = progress.clamp(0.0, path_distance);
    match phase {
        DeliveryTripPhase::Outbound => path_distance - progress,
        DeliveryTripPhase::Unloading => 0.0,
        DeliveryTripPhase::Inbound => progress,
    }
}

/// Set the existing cart row onto its physical return leg. Cached routes
/// reverse exactly; compatibility rows without one receive a straight return
/// from their current authoritative position. False means the cart is already
/// at its origin and can be settled in this transaction.
fn prepare_trip_return_leg(ctx: &ReducerContext, trip: &mut DeliveryTrip) -> bool {
    let phase = DeliveryTripPhase::from_u8(trip.phase);
    let has_stored_route = trip.path_distance > 1e-6
        && deserialize_route_polyline(&trip.route_polyline_json)
            .is_some_and(|polyline| polyline.len() >= 2);

    if let Some(phase) = phase.filter(|_| has_stored_route) {
        trip.progress = recalled_inbound_progress(phase, trip.path_distance, trip.progress);
        trip.phase = DeliveryTripPhase::Inbound.as_u8();
        return true;
    }

    // Old saves may predate cached route geometry. Rebase their return leg from
    // the authoritative cart position instead of teleporting the cargo home.
    if let Some(origin) = ctx.db.building().id().find(&trip.building_id) {
        let distance = ((trip.x - origin.x).powi(2) + (trip.z - origin.z).powi(2)).sqrt();
        if distance > 1e-6 {
            trip.path_distance = distance;
            trip.progress = 0.0;
            trip.phase = DeliveryTripPhase::Inbound.as_u8();
            trip.route_polyline_json =
                serialize_route_polyline(&[[origin.x, origin.z], [trip.x, trip.z]]);
            return true;
        }
    }
    false
}

/// Preserve the trip row, cargo, and labor commitment while a cancelled load
/// turns around. Clearing the destination identifiers records that its
/// reservation has already been restored and prevents a second restoration
/// when the cart reaches home.
fn recall_trip_to_origin(ctx: &ReducerContext, mut trip: DeliveryTrip) {
    release_trip_fire_claim(ctx, &trip);
    restore_trip_target_reservation(ctx, &trip);

    trip.residence_id = 0;
    trip.target_building_id = 0;
    trip.unload_remaining = 0.0;

    if prepare_trip_return_leg(ctx, &mut trip) {
        ctx.db.delivery_trip().id().update(trip);
        return;
    }

    return_trip_cargo_to_origin(ctx, &trip);
    ctx.db.delivery_trip().id().delete(trip.id);
}

/// A capable raider alarm recalls ordinary carters without teleporting cargo
/// or releasing their crew. Unlike a player-cancelled order, the destination
/// reservation remains bound to this physical load until it reaches home;
/// retaining the destination also preserves parish and construction metadata.
fn recall_trip_to_origin_during_raid(ctx: &ReducerContext, mut trip: DeliveryTrip, sim_tick: u64) {
    trip.unload_remaining = 0.0;
    if prepare_trip_return_leg(ctx, &mut trip) {
        ctx.db.delivery_trip().id().update(trip);
        return;
    }
    finish_inbound_trip(ctx, trip, sim_tick);
}

fn return_trip_cargo_to_building(ctx: &ReducerContext, trip: &DeliveryTrip) {
    release_trip_fire_claim(ctx, trip);
    restore_trip_target_reservation(ctx, trip);
    return_trip_cargo_to_origin(ctx, trip);
}

fn restore_trip_target_reservation(ctx: &ReducerContext, trip: &DeliveryTrip) {
    if trip.amount <= 1e-6 {
        return;
    }
    let Some(TripCargoKind::Commodity(commodity)) = TripCargoKind::from_trip(trip) else {
        return;
    };
    if trip.destination_kind == DELIVERY_DESTINATION_BUILDING {
        if let Some(mut site) = ctx.db.building().id().find(&trip.target_building_id) {
            if !site.construction_complete {
                match commodity {
                    CommodityKind::Timber => site.construction_reserved_timber += trip.amount,
                    CommodityKind::Stone => site.construction_reserved_stone += trip.amount,
                    CommodityKind::Ironwork => site.construction_reserved_ironwork += trip.amount,
                    CommodityKind::RoofTiles => {
                        site.construction_reserved_roof_tiles += trip.amount
                    }
                    _ => {}
                }
                ctx.db.building().id().update(site);
            }
        }
    }
    if trip.destination_kind == DELIVERY_DESTINATION_RESIDENCE
        && matches!(
            commodity,
            CommodityKind::Timber
                | CommodityKind::Stone
                | CommodityKind::Gold
                | CommodityKind::RoofTiles
        )
    {
        if let Some(mut residence) = ctx.db.residence().id().find(&trip.residence_id) {
            if residence_project_active(
                residence.upgrade_target_tier,
                residence.tier,
                residence.backyard_project_kind,
                residence.fire_repair_active,
                residence.decay_repair_active,
                residence.roof_tile_retrofit_active,
            ) {
                match commodity {
                    CommodityKind::Timber => residence.upgrade_reserved_timber += trip.amount,
                    CommodityKind::Stone => residence.upgrade_reserved_stone += trip.amount,
                    CommodityKind::Gold => residence.upgrade_reserved_gold += trip.amount,
                    CommodityKind::RoofTiles => {
                        residence.upgrade_reserved_roof_tiles += trip.amount
                    }
                    _ => {}
                }
                ctx.db.residence().id().update(residence);
            }
        }
    }
}

fn return_trip_cargo_to_origin(ctx: &ReducerContext, trip: &DeliveryTrip) {
    if trip.amount <= 1e-6 {
        return;
    }
    // This load came from outside the map, not from marketplace storage. If
    // the caravan turns back, the merchant retains it; never teleport it into
    // the market merely because that market is the contract anchor.
    if is_external_market_import_trip(trip) {
        return;
    }
    let Some(TripCargoKind::Commodity(commodity)) = TripCargoKind::from_trip(trip) else {
        return;
    };
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
    let returned_to_origin = return_commodity_to_building(ctx, trip, commodity, trip.amount);
    if restore_monastery_purse && returned_to_origin > 1e-6 {
        if let Some(mut chapel) = ctx.db.building().id().find(&trip.building_id) {
            chapel.chapel_monastery_tithe_due = (chapel_monastery_tithe_due(&chapel)
                + returned_to_origin)
                .min(chapel.gold.max(0.0));
            ctx.db.building().id().update(chapel);
        }
    }
}

fn settle_stranded_trip(ctx: &ReducerContext, trip: DeliveryTrip) {
    release_trip_fire_claim(ctx, &trip);
    restore_trip_target_reservation(ctx, &trip);

    let physically_recovered = if trip.amount > 1e-6 {
        TripCargoKind::from_trip(&trip).is_some_and(|cargo| match cargo {
            TripCargoKind::Commodity(commodity) => {
                match recover_stock_at(
                    ctx,
                    trip.owner,
                    trip.x,
                    trip.z,
                    ReclamationStock::from_commodity(commodity, trip.amount),
                ) {
                    Ok(recovered) => recovered,
                    Err(error) => {
                        log::warn!(
                            "Could not leave stranded delivery cargo at its cart position: {error}"
                        );
                        false
                    }
                }
            }
        })
    } else {
        true
    };
    if !physically_recovered {
        return_trip_cargo_to_origin(ctx, &trip);
    }
    ctx.db.delivery_trip().id().delete(trip.id);
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
    trip: &DeliveryTrip,
    commodity: CommodityKind,
    amount: f64,
) -> f64 {
    if amount <= 1e-6 {
        return 0.0;
    }
    let Some(mut building) = ctx.db.building().id().find(&trip.building_id) else {
        let recovered = recover_stock_at(
            ctx,
            trip.owner,
            trip.x,
            trip.z,
            ReclamationStock::from_commodity(commodity, amount),
        )
        .unwrap_or_else(|error| {
            log::warn!("Could not preserve cargo from a missing delivery source: {error}");
            false
        });
        if !recovered {
            credit_treasury_commodity(ctx, trip.owner, commodity, amount);
        }
        return 0.0;
    };
    let automatic_specialty_receipt = commodity == CommodityKind::Gold
        && is_regional_market_export_trip(trip)
        && trip.residence_id == 0;
    let deposited = if automatic_specialty_receipt && building.kind == "trading_post" {
        let split = crate::economy::credit_private_export_receipt(ctx, &mut building, amount);
        split.household_income + split.export_duty
    } else if automatic_specialty_receipt && building.kind == "monastery" {
        let split = crate::economy::credit_monastery_export_receipt(ctx, &mut building, amount);
        split.estate_income + split.export_duty
    } else {
        deposit_building_commodity(&mut building, commodity, amount)
    };
    if commodity == CommodityKind::Gold
        && building.kind == "monastery"
        && !is_regional_market_export_trip(trip)
    {
        restore_local_civic_receipts(&mut building, deposited);
    }
    if commodity == CommodityKind::Gold
        && building.kind == "trading_post"
        && trip.destination_kind == DELIVERY_DESTINATION_RESIDENCE_WEALTH
    {
        restore_private_export_proceeds(&mut building, deposited);
    }
    let remainder = (amount - deposited).max(0.0);
    ctx.db.building().id().update(building.clone());
    if remainder > 1e-6 {
        let recovered = recover_stock_beside_building(
            ctx,
            &building,
            ReclamationStock::from_commodity(commodity, remainder),
        )
        .unwrap_or_else(|error| {
            log::warn!("Could not preserve returned delivery overflow beside its source: {error}");
            false
        });
        if !recovered {
            credit_treasury_commodity(ctx, building.owner, commodity, remainder);
        }
    }
    deposited
}

#[cfg(test)]
mod tests {
    use super::{recalled_inbound_progress, rostered_cart_workers, DeliveryTripPhase};

    #[test]
    fn rostered_cart_workers_excludes_free_haulers() {
        assert_eq!(rostered_cart_workers(3, 2, 0), 2);
        assert_eq!(rostered_cart_workers(3, 2, 1), 1);
        assert_eq!(rostered_cart_workers(3, 2, 2), 0);
    }

    #[test]
    fn rostered_cart_workers_cannot_exceed_current_roster() {
        assert_eq!(rostered_cart_workers(1, 3, 0), 1);
        assert_eq!(rostered_cart_workers(0, 3, 0), 0);
        assert_eq!(rostered_cart_workers(1, 3, 2), 1);
    }

    #[test]
    fn recalled_outbound_cart_keeps_its_exact_route_position() {
        assert_eq!(
            recalled_inbound_progress(DeliveryTripPhase::Outbound, 100.0, 35.0),
            65.0
        );
        assert_eq!(
            recalled_inbound_progress(DeliveryTripPhase::Unloading, 100.0, 100.0),
            0.0
        );
        assert_eq!(
            recalled_inbound_progress(DeliveryTripPhase::Inbound, 100.0, 35.0),
            35.0
        );
    }

    #[test]
    fn recalled_route_progress_is_clamped_before_turning() {
        assert_eq!(
            recalled_inbound_progress(DeliveryTripPhase::Outbound, 100.0, 120.0),
            0.0
        );
        assert_eq!(
            recalled_inbound_progress(DeliveryTripPhase::Outbound, 100.0, -20.0),
            100.0
        );
    }
}
