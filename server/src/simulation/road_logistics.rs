//! Road-graph distance and branch claims for firewood logistics.

use crate::constants::RESIDENCE_WATER_PER_PERSON_PER_SEC;
use crate::roads::RoadNetwork;
use crate::simulation::lodge_logistics::residence_firewood_runway_seconds as residence_runway_seconds;
use crate::supply_policy::{
    compare_supply_route_candidates, is_firewood_supplier_operational,
    is_well_supplier_operational, select_need_delivery_candidate, NeedDeliveryCandidate,
};
use crate::tables::{Building, Residence};
use crate::well_policy::position_within_well_service_radius;

pub use crate::simulation::lodge_logistics::lodge_labor_split;

pub fn road_path_distance(
    network: &RoadNetwork,
    ax: f64,
    az: f64,
    bx: f64,
    bz: f64,
) -> Option<f64> {
    network.road_path_distance(ax, az, bx, bz)
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
    needs_delivery: impl Fn(f64) -> bool,
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
            if !needs_delivery(stock) {
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
        network.road_path_distances_from(supplier.x, supplier.z, &target_positions);

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
        let distances = network.road_path_distances_from(supplier.x, supplier.z, &target_positions);
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

/// Each residence is claimed by its nearest operational firewood distributor.
/// A staffed village storehouse can therefore become a road-network fuel hub,
/// while unfinished or unstaffed suppliers cannot strand a branch.
pub fn claim_residences_for_firewood_suppliers(
    network: &RoadNetwork,
    suppliers: &[Building],
    residences: &[Residence],
) -> std::collections::HashMap<u64, u64> {
    let operational: Vec<&Building> = suppliers
        .iter()
        .filter(|supplier| {
            is_firewood_supplier_operational(
                &supplier.kind,
                supplier.construction_complete,
                supplier.assigned_labor,
                supplier.storehouse_accepts_firewood,
            )
        })
        .collect();
    claim_residences_by_nearest_supplier(network, &operational, residences, |_, _, _| true)
}

/// Each residence is claimed by the nearest road-connected well within its service extent.
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
        position_within_well_service_radius(
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
    residence_runway_seconds(
        residence.abandoned,
        residence.population,
        food_stock,
        crate::constants::RESIDENCE_FOOD_PER_PERSON_PER_SEC,
    )
}
