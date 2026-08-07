//! Road-preferred local delivery distance and supplier claims.

use crate::balance_generated::{
    HERB_REMEDY_CAPACITY, HERB_TREATMENT_PER_SICK_DAY, OFFROAD_DELIVERY_SPEED_MULTIPLIER,
    REMEDY_DELIVERY_TARGET_DAYS,
};
use crate::constants::RESIDENCE_WATER_PER_PERSON_PER_SEC;
use crate::roads::{RoadNetwork, RoadPathRoute};
use crate::simulation::lodge_logistics::residence_firewood_runway_seconds as residence_runway_seconds;
use crate::supply_policy::{
    compare_supply_route_candidates, is_well_supplier_operational, select_need_delivery_candidate,
    NeedDeliveryCandidate,
};
use crate::tables::{Building, Residence};
use crate::well_policy::position_within_well_service_radius;

#[derive(Debug, Clone)]
pub struct LocalDeliveryRoute {
    pub route: RoadPathRoute,
    pub speed_multiplier: f64,
}

fn direct_distance(ax: f64, az: f64, bx: f64, bz: f64) -> Option<f64> {
    let distance = ((bx - ax).powi(2) + (bz - az).powi(2)).sqrt();
    distance.is_finite().then_some(distance)
}

fn effective_delivery_distance(
    road_distance: Option<f64>,
    direct_distance: Option<f64>,
) -> Option<f64> {
    road_distance
        .filter(|distance| distance.is_finite())
        .or_else(|| {
            direct_distance.map(|distance| distance / OFFROAD_DELIVERY_SPEED_MULTIPLIER.max(1e-6))
        })
}

/// Time-weighted local logistics distance. A connected road route wins when
/// available; otherwise a carrier may cross open ground at the off-road speed.
/// Callers can continue comparing one number while roads retain their value.
pub fn local_delivery_distance(
    network: &RoadNetwork,
    ax: f64,
    az: f64,
    bx: f64,
    bz: f64,
) -> Option<f64> {
    effective_delivery_distance(
        network.road_path_distance(ax, az, bx, bz),
        direct_distance(ax, az, bx, bz),
    )
}

pub fn local_delivery_distances_from(
    network: &RoadNetwork,
    ax: f64,
    az: f64,
    targets: &[(f64, f64)],
) -> Vec<Option<f64>> {
    network
        .road_path_distances_from(ax, az, targets)
        .into_iter()
        .zip(targets)
        .map(|(road_distance, (bx, bz))| {
            effective_delivery_distance(road_distance, direct_distance(ax, az, *bx, *bz))
        })
        .collect()
}

/// Builds the authoritative path and movement penalty for a local trip.
pub fn local_delivery_route(
    network: &RoadNetwork,
    ax: f64,
    az: f64,
    bx: f64,
    bz: f64,
) -> Option<LocalDeliveryRoute> {
    if let Some(route) = network
        .road_path_route(ax, az, bx, bz)
        .filter(|route| route.distance.is_finite() && route.distance > 1e-6)
    {
        return Some(LocalDeliveryRoute {
            route,
            speed_multiplier: 1.0,
        });
    }
    let distance = direct_distance(ax, az, bx, bz).filter(|distance| *distance > 1e-6)?;
    Some(LocalDeliveryRoute {
        route: RoadPathRoute {
            distance,
            polyline: vec![[ax, az], [bx, bz]],
        },
        speed_multiplier: OFFROAD_DELIVERY_SPEED_MULTIPLIER,
    })
}

/// Find the single household that should receive the next cart.
///
/// Stock and route distance are evaluated once per eligible home. A named market
/// or parish order is destination-strict; routine deliveries use lowest
/// stock-per-resident runway, shortest route, and stable id.
pub fn select_residence_for_need_delivery(
    network: &RoadNetwork,
    supplier: &Building,
    mut residences: Vec<Residence>,
    explicit_priority_residence_id: Option<u64>,
    max_distance: Option<f64>,
    stock_for: impl Fn(&Residence) -> f64,
    needs_delivery: impl Fn(&Residence, f64) -> bool,
) -> Option<Residence> {
    let eligible: Vec<(usize, f64)> = residences
        .iter()
        .enumerate()
        .filter_map(|(index, residence)| {
            if explicit_priority_residence_id.is_some_and(|priority_id| residence.id != priority_id)
            {
                return None;
            }
            let stock = stock_for(residence);
            if !needs_delivery(residence, stock) {
                return None;
            }
            Some((index, stock))
        })
        .collect();
    let target_positions: Vec<(f64, f64)> = eligible
        .iter()
        .map(|(index, _)| {
            let residence = &residences[*index];
            (residence.x, residence.z)
        })
        .collect();
    let route_distances =
        local_delivery_distances_from(network, supplier.x, supplier.z, &target_positions);

    let selected =
        select_need_delivery_candidate(eligible.into_iter().zip(route_distances).filter_map(
            |((index, stock), distance)| {
                let residence = &residences[index];
                let distance = distance?;
                if !distance.is_finite() || max_distance.is_some_and(|limit| distance > limit) {
                    return None;
                }
                Some(NeedDeliveryCandidate {
                    index,
                    residence_id: residence.id,
                    abandoned: residence.abandoned,
                    population: residence.population,
                    stock,
                    distance,
                    explicit_priority: explicit_priority_residence_id == Some(residence.id),
                })
            },
        ))?;
    Some(residences.swap_remove(selected.index))
}

/// Choose the least-covered sick household with one batched road-graph solve.
/// Larger sick cohorts win runway ties, then shorter routes and stable ids.
pub fn select_residence_for_remedy_delivery(
    network: &RoadNetwork,
    supplier: &Building,
    mut residences: Vec<Residence>,
    has_inbound_remedies: impl Fn(u64) -> bool,
) -> Option<Residence> {
    let eligible = residences
        .iter()
        .enumerate()
        .filter_map(|(index, residence)| {
            if residence.abandoned
                || residence.population == 0
                || residence.sick_population == 0
                || has_inbound_remedies(residence.id)
            {
                return None;
            }
            let daily_demand = residence.sick_population as f64 * HERB_TREATMENT_PER_SICK_DAY;
            let target = (daily_demand * REMEDY_DELIVERY_TARGET_DAYS).min(HERB_REMEDY_CAPACITY);
            if residence.remedy_stock + 1e-6 >= target {
                return None;
            }
            let runway_days = residence.remedy_stock.max(0.0) / daily_demand.max(1e-9);
            Some((index, runway_days))
        })
        .collect::<Vec<_>>();
    let target_positions = eligible
        .iter()
        .map(|(index, _)| {
            let residence = &residences[*index];
            (residence.x, residence.z)
        })
        .collect::<Vec<_>>();
    let route_distances =
        local_delivery_distances_from(network, supplier.x, supplier.z, &target_positions);

    let selected_index = eligible
        .into_iter()
        .zip(route_distances)
        .filter_map(|((index, runway_days), distance)| {
            let distance = distance.filter(|distance| distance.is_finite())?;
            let residence = &residences[index];
            Some((
                index,
                runway_days,
                std::cmp::Reverse(residence.sick_population),
                distance,
                residence.id,
            ))
        })
        .min_by(|left, right| {
            left.1
                .total_cmp(&right.1)
                .then_with(|| left.2.cmp(&right.2))
                .then_with(|| left.3.total_cmp(&right.3))
                .then_with(|| left.4.cmp(&right.4))
        })
        .map(|candidate| candidate.0)?;
    Some(residences.swap_remove(selected_index))
}

/// Assign every residence to its nearest eligible supplier using one graph
/// solve per supplier. Route length and stable building id preserve the same
/// deterministic territory boundary as pairwise pathfinding.
pub fn claim_residences_by_nearest_supplier(
    network: &RoadNetwork,
    suppliers: &[&Building],
    residences: &[Residence],
    candidate_allowed: impl Fn(&Building, &Residence, f64) -> bool,
) -> std::collections::HashMap<u64, u64> {
    let target_positions: Vec<(f64, f64)> = residences
        .iter()
        .map(|residence| (residence.x, residence.z))
        .collect();
    let mut best_by_residence: std::collections::HashMap<u64, (u64, f64)> =
        std::collections::HashMap::new();

    for supplier in suppliers {
        let distances =
            local_delivery_distances_from(network, supplier.x, supplier.z, &target_positions);
        for (residence, distance) in residences.iter().zip(distances) {
            let Some(distance) = distance.filter(|distance| distance.is_finite()) else {
                continue;
            };
            if !candidate_allowed(supplier, residence, distance) {
                continue;
            }
            let replace = best_by_residence.get(&residence.id).is_none_or(
                |(current_id, current_distance)| {
                    compare_supply_route_candidates(
                        distance,
                        supplier.id,
                        *current_distance,
                        *current_id,
                    )
                    .is_lt()
                },
            );
            if replace {
                best_by_residence.insert(residence.id, (supplier.id, distance));
            }
        }
    }

    best_by_residence
        .into_iter()
        .map(|(residence_id, (supplier_id, _))| (residence_id, supplier_id))
        .collect()
}

/// Each residence is claimed by the nearest completed well within its service extent.
pub fn claim_residences_for_wells(
    network: &RoadNetwork,
    wells: &[Building],
    residences: &[Residence],
) -> std::collections::HashMap<u64, u64> {
    let operational: Vec<&Building> = wells
        .iter()
        .filter(|well| {
            is_well_supplier_operational(
                &well.kind,
                well.construction_complete,
                well.assigned_labor,
            )
        })
        .collect();
    claim_residences_by_nearest_supplier(network, &operational, residences, |well, residence, _| {
        network.road_connected(well.x, well.z, residence.x, residence.z)
            && position_within_well_service_radius(
                well.x,
                well.z,
                well.work_radius,
                residence.x,
                residence.z,
            )
    })
}

pub fn residence_water_runway_seconds(residence: &Residence, water_stock: f64) -> f64 {
    residence_runway_seconds(
        residence.abandoned,
        residence.population,
        water_stock,
        RESIDENCE_WATER_PER_PERSON_PER_SEC,
    )
}

pub fn residence_food_runway_seconds(residence: &Residence, food_stock: f64) -> f64 {
    if residence.abandoned || residence.population == 0 {
        return f64::INFINITY;
    }
    let daily_use = crate::economy::household_food_per_day(residence.population);
    if daily_use <= 1e-9 {
        f64::INFINITY
    } else {
        food_stock.max(0.0) / daily_use * crate::balance_generated::CALENDAR_SECONDS_PER_DAY
    }
}
