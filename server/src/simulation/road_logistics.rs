//! Road-graph distance and branch claims for firewood logistics.

use spacetimedb::Identity;

use crate::constants::RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC;
use crate::constants::RESIDENCE_WATER_PER_PERSON_PER_SEC;
use crate::roads::RoadNetwork;
use crate::simulation::lodge_logistics::{
    residence_firewood_runway_seconds as residence_runway_seconds,
};
use crate::tables::{building, Building, Residence};

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

/// Each residence is claimed by the nearest road-connected woodcutter's lodge.
pub fn claim_residences_for_lodges(
    network: &RoadNetwork,
    lodges: &[Building],
    residences: &[Residence],
) -> std::collections::HashMap<u64, u64> {
    let mut claims = std::collections::HashMap::new();
    for residence in residences {
        let mut best_lodge: Option<&Building> = None;
        let mut best_distance = f64::INFINITY;
        for lodge in lodges {
            if lodge.kind != "woodcutters_lodge" {
                continue;
            }
            let Some(distance) =
                road_path_distance(network, lodge.x, lodge.z, residence.x, residence.z)
            else {
                continue;
            };
            if distance + 1e-6 < best_distance
                || ((distance - best_distance).abs() <= 1e-6
                    && best_lodge.map_or(true, |current| lodge.id < current.id))
            {
                best_distance = distance;
                best_lodge = Some(lodge);
            }
        }
        if let Some(lodge) = best_lodge {
            claims.insert(residence.id, lodge.id);
        }
    }
    claims
}

pub fn residence_firewood_runway_seconds(
    residence: &Residence,
    firewood_stock: f64,
) -> f64 {
    residence_runway_seconds(
        residence.abandoned,
        residence.population,
        firewood_stock,
        RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC,
    )
}

/// Lowest firewood runway first; tie-break by road-path distance, then residence id.
pub fn sort_residences_for_delivery(
    network: &RoadNetwork,
    lodge: &Building,
    residences: &mut [Residence],
    firewood_stock_for: impl Fn(&Residence) -> f64,
) {
    residences.sort_by(|a, b| {
        match (a.abandoned, b.abandoned) {
            (true, false) => std::cmp::Ordering::Greater,
            (false, true) => std::cmp::Ordering::Less,
            _ => {
                let runway_a =
                    residence_firewood_runway_seconds(a, firewood_stock_for(a));
                let runway_b =
                    residence_firewood_runway_seconds(b, firewood_stock_for(b));
                match runway_a
                    .partial_cmp(&runway_b)
                    .unwrap_or(std::cmp::Ordering::Equal)
                {
                    std::cmp::Ordering::Equal => {
                        let distance_a = road_path_distance(network, lodge.x, lodge.z, a.x, a.z)
                            .unwrap_or(f64::INFINITY);
                        let distance_b = road_path_distance(network, lodge.x, lodge.z, b.x, b.z)
                            .unwrap_or(f64::INFINITY);
                        distance_a
                            .partial_cmp(&distance_b)
                            .unwrap_or(std::cmp::Ordering::Equal)
                            .then_with(|| a.id.cmp(&b.id))
                    }
                    other => other,
                }
            }
        }
    });
}

pub fn sort_mills_by_road_path(
    network: &RoadNetwork,
    lodge: &Building,
    mills: &mut [Building],
) {
    mills.sort_by(|a, b| {
        let da = road_path_distance(network, a.x, a.z, lodge.x, lodge.z).unwrap_or(f64::INFINITY);
        let db = road_path_distance(network, b.x, b.z, lodge.x, lodge.z).unwrap_or(f64::INFINITY);
        da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
    });
}

pub fn owner_lodges(ctx: &spacetimedb::ReducerContext, owner: Identity) -> Vec<Building> {
    ctx.db
        .building()
        .owner()
        .filter(&owner)
        .filter(|row| row.kind == "woodcutters_lodge")
        .collect()
}

pub fn owner_wells(ctx: &spacetimedb::ReducerContext, owner: Identity) -> Vec<Building> {
    ctx.db
        .building()
        .owner()
        .filter(&owner)
        .filter(|row| row.kind == "well")
        .collect()
}

fn within_work_radius(well: &Building, x: f64, z: f64) -> bool {
    if well.work_radius <= 0.0 {
        return false;
    }
    let dx = well.x - x;
    let dz = well.z - z;
    let radius_sq = well.work_radius * well.work_radius;
    dx * dx + dz * dz <= radius_sq
}

/// Each residence is claimed by the nearest road-connected well within work radius.
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
            if well.kind != "well" || !within_work_radius(well, residence.x, residence.z) {
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

/// Lowest water runway first; tie-break by road-path distance, then residence id.
pub fn sort_residences_for_water_delivery(
    network: &RoadNetwork,
    well: &Building,
    residences: &mut [Residence],
    water_stock_for: impl Fn(&Residence) -> f64,
) {
    residences.sort_by(|a, b| {
        match (a.abandoned, b.abandoned) {
            (true, false) => std::cmp::Ordering::Greater,
            (false, true) => std::cmp::Ordering::Less,
            _ => {
                let runway_a = residence_water_runway_seconds(a, water_stock_for(a));
                let runway_b = residence_water_runway_seconds(b, water_stock_for(b));
                match runway_a
                    .partial_cmp(&runway_b)
                    .unwrap_or(std::cmp::Ordering::Equal)
                {
                    std::cmp::Ordering::Equal => {
                        let distance_a = road_path_distance(network, well.x, well.z, a.x, a.z)
                            .unwrap_or(f64::INFINITY);
                        let distance_b = road_path_distance(network, well.x, well.z, b.x, b.z)
                            .unwrap_or(f64::INFINITY);
                        distance_a
                            .partial_cmp(&distance_b)
                            .unwrap_or(std::cmp::Ordering::Equal)
                            .then_with(|| a.id.cmp(&b.id))
                    }
                    other => other,
                }
            }
        }
    });
}

pub fn sort_wells_by_road_path(
    network: &RoadNetwork,
    building: &Building,
    wells: &mut [Building],
) {
    wells.sort_by(|a, b| {
        let da = road_path_distance(network, a.x, a.z, building.x, building.z).unwrap_or(f64::INFINITY);
        let db = road_path_distance(network, b.x, b.z, building.x, building.z).unwrap_or(f64::INFINITY);
        da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
    });
}

pub fn owner_food_suppliers(ctx: &spacetimedb::ReducerContext, owner: Identity) -> Vec<Building> {
    ctx.db
        .building()
        .owner()
        .filter(&owner)
        .filter(|row| row.kind == "hunters_hall" || row.kind == "foragers_shed")
        .collect()
}

/// Each residence is claimed by the nearest road-connected food supplier.
pub fn claim_residences_for_food_suppliers(
    network: &RoadNetwork,
    suppliers: &[Building],
    residences: &[Residence],
) -> std::collections::HashMap<u64, u64> {
    let mut claims = std::collections::HashMap::new();
    for residence in residences {
        let mut best_supplier: Option<&Building> = None;
        let mut best_distance = f64::INFINITY;
        for supplier in suppliers {
            if supplier.kind != "hunters_hall" && supplier.kind != "foragers_shed" {
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

pub fn residence_food_runway_seconds(residence: &Residence, food_stock: f64) -> f64 {
    residence_runway_seconds(
        residence.abandoned,
        residence.population,
        food_stock,
        crate::constants::RESIDENCE_FOOD_PER_PERSON_PER_SEC,
    )
}

pub fn sort_residences_for_food_delivery(
    network: &RoadNetwork,
    supplier: &Building,
    residences: &mut [Residence],
    food_stock_for: impl Fn(&Residence) -> f64,
) {
    residences.sort_by(|a, b| {
        match (a.abandoned, b.abandoned) {
            (true, false) => std::cmp::Ordering::Greater,
            (false, true) => std::cmp::Ordering::Less,
            _ => {
                let runway_a = residence_food_runway_seconds(a, food_stock_for(a));
                let runway_b = residence_food_runway_seconds(b, food_stock_for(b));
                match runway_a
                    .partial_cmp(&runway_b)
                    .unwrap_or(std::cmp::Ordering::Equal)
                {
                    std::cmp::Ordering::Equal => {
                        let distance_a = road_path_distance(network, supplier.x, supplier.z, a.x, a.z)
                            .unwrap_or(f64::INFINITY);
                        let distance_b = road_path_distance(network, supplier.x, supplier.z, b.x, b.z)
                            .unwrap_or(f64::INFINITY);
                        distance_a
                            .partial_cmp(&distance_b)
                            .unwrap_or(std::cmp::Ordering::Equal)
                            .then_with(|| a.id.cmp(&b.id))
                    }
                    other => other,
                }
            }
        }
    });
}
