//! Road-graph distance and branch claims for firewood logistics.

use spacetimedb::Identity;

use crate::constants::RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC;
use crate::roads::RoadNetwork;
use crate::tables::{building, Building, Residence};

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
        if residence.abandoned {
            continue;
        }
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

pub fn residence_firewood_runway_seconds(residence: &Residence) -> f64 {
    if residence.abandoned || residence.population == 0 {
        return f64::INFINITY;
    }
    let demand = residence.population as f64 * RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC;
    if demand <= 1e-9 {
        return f64::INFINITY;
    }
    residence.firewood_stock / demand
}

/// Lowest firewood runway first; tie-break by road-path distance, then residence id.
pub fn sort_residences_for_delivery(
    network: &RoadNetwork,
    lodge: &Building,
    residences: &mut [Residence],
) {
    residences.sort_by(|a, b| {
        let runway_a = residence_firewood_runway_seconds(a);
        let runway_b = residence_firewood_runway_seconds(b);
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
