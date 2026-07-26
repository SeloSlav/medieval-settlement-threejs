//! Road-graph distance and branch claims for firewood logistics.

use crate::constants::RESIDENCE_WATER_PER_PERSON_PER_SEC;
use crate::roads::RoadNetwork;
use crate::simulation::lodge_logistics::residence_firewood_runway_seconds as residence_runway_seconds;
use crate::supply_policy::{
    is_firewood_supplier_operational, is_well_supplier_operational, select_need_delivery_candidate,
    NeedDeliveryCandidate,
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
    let selected = select_need_delivery_candidate(residences.iter().enumerate().filter_map(
        |(index, residence)| {
            if explicit_priority_residence_id.is_some_and(|priority_id| residence.id != priority_id)
            {
                return None;
            }
            let stock = stock_for(residence);
            if !needs_delivery(stock) {
                return None;
            }
            let distance =
                road_path_distance(network, supplier.x, supplier.z, residence.x, residence.z)?;
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

/// Each residence is claimed by its nearest operational firewood distributor.
/// A staffed village storehouse can therefore become a road-network fuel hub,
/// while unfinished or unstaffed suppliers cannot strand a branch.
pub fn claim_residences_for_firewood_suppliers(
    network: &RoadNetwork,
    suppliers: &[Building],
    residences: &[Residence],
) -> std::collections::HashMap<u64, u64> {
    let mut claims = std::collections::HashMap::new();
    for residence in residences {
        let mut best_supplier: Option<&Building> = None;
        let mut best_distance = f64::INFINITY;
        for supplier in suppliers {
            if !is_firewood_supplier_operational(
                &supplier.kind,
                supplier.construction_complete,
                supplier.assigned_labor,
                supplier.storehouse_accepts_firewood,
            ) {
                continue;
            }
            let Some(distance) =
                road_path_distance(network, supplier.x, supplier.z, residence.x, residence.z)
            else {
                continue;
            };
            if distance + 1e-6 < best_distance
                || ((distance - best_distance).abs() <= 1e-6
                    && best_supplier.map_or(true, |current| supplier.id < current.id))
            {
                best_distance = distance;
                best_supplier = Some(supplier);
            }
        }
        if let Some(supplier) = best_supplier {
            claims.insert(residence.id, supplier.id);
        }
    }
    claims
}

/// Each residence is claimed by the nearest road-connected well within its service extent.
pub fn claim_residences_for_wells(
    network: &RoadNetwork,
    wells: &[Building],
    residences: &[Residence],
) -> std::collections::HashMap<u64, u64> {
    let mut claims = std::collections::HashMap::new();
    for residence in residences {
        let mut best_well: Option<&Building> = None;
        let mut best_distance = f64::INFINITY;
        for well in wells {
            if !is_well_supplier_operational(
                &well.kind,
                well.construction_complete,
                well.assigned_labor,
            ) || !position_within_well_service_radius(
                well.x,
                well.z,
                well.work_radius,
                residence.x,
                residence.z,
            ) {
                continue;
            }
            let Some(distance) =
                road_path_distance(network, well.x, well.z, residence.x, residence.z)
            else {
                continue;
            };
            if distance + 1e-6 < best_distance
                || ((distance - best_distance).abs() <= 1e-6
                    && best_well.map_or(true, |current| well.id < current.id))
            {
                best_distance = distance;
                best_well = Some(well);
            }
        }
        if let Some(well) = best_well {
            claims.insert(residence.id, well.id);
        }
    }
    claims
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
