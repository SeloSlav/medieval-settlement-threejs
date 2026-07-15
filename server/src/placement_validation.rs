use spacetimedb::ReducerContext;
use spacetimedb::Identity;

use crate::burgage::{zone_corners_polygon, zone_overlaps_footprint, Point2, ZoneCorners};
use crate::building_defs::building_def;
use crate::db::*;
use crate::hydrology::sample_hydrology_score;
use crate::roads::load_owner_road_network;

const LARGE_QUARRY_PIT_RADIUS: f64 = 58.0;
const SMALL_QUARRY_PIT_RADIUS: f64 = 30.0;
const FOOTPRINT_SAMPLE_FRACTIONS: [f64; 3] = [0.0, 0.55, 0.82];
const OPEN_WATER_THRESHOLD: f64 = 0.999;
const SHORE_WATER_THRESHOLD: f64 = 0.95;
const MAX_ROAD_FRONTAGE_DISTANCE: f64 = 16.0;
const SHORE_RADIAL_SAMPLE_STEP: f64 = 2.0;
const SHORE_ARC_SAMPLE_SPACING: f64 = 4.0;
const BUILDING_SITE_CLEAR_MARGIN: f64 = 0.75;

struct BuildingPadParams {
    radius_x: f64,
    radius_z: f64,
    inner_fade: f64,
    outer_fade: f64,
}

pub fn building_pick_radius(kind: &str) -> Option<f64> {
    building_def(kind).map(|def| def.pick_radius)
}

pub fn building_site_contains_point(
    kind: &str,
    building_x: f64,
    building_z: f64,
    point_x: f64,
    point_z: f64,
) -> bool {
    let pad = building_pad_params(kind);
    let yaw = building_placement_yaw(building_x, building_z);
    let dx = point_x - building_x;
    let dz = point_z - building_z;
    let cos = yaw.cos();
    let sin = yaw.sin();
    let local_x = dx * cos + dz * sin;
    let local_z = -dx * sin + dz * cos;
    let normalized_distance = (local_x / pad.radius_x).hypot(local_z / pad.radius_z);
    let margin = BUILDING_SITE_CLEAR_MARGIN / pad.radius_x.min(pad.radius_z);
    normalized_distance <= pad.outer_fade * 1.04 + margin
}

pub fn is_open_water(x: f64, z: f64) -> bool {
    sample_hydrology_score(x, z) >= OPEN_WATER_THRESHOLD
}

pub fn is_near_open_water(x: f64, z: f64, max_distance: f64) -> bool {
    any_open_water_near(x, z, max_distance, |sample_x, sample_z| {
        sample_hydrology_score(sample_x, sample_z) >= SHORE_WATER_THRESHOLD
    })
}

fn any_open_water_near(
    x: f64,
    z: f64,
    max_distance: f64,
    mut is_water_at: impl FnMut(f64, f64) -> bool,
) -> bool {
    let ring_count = (max_distance / SHORE_RADIAL_SAMPLE_STEP).ceil() as usize;
    for ring in 1..=ring_count {
        let radius = (ring as f64 * SHORE_RADIAL_SAMPLE_STEP).min(max_distance);
        let sample_count = ((std::f64::consts::TAU * radius / SHORE_ARC_SAMPLE_SPACING).ceil()
            as usize)
            .max(12);
        for index in 0..sample_count {
            let angle = index as f64 / sample_count as f64 * std::f64::consts::TAU;
            if is_water_at(x + angle.cos() * radius, z + angle.sin() * radius) {
                return true;
            }
        }
    }
    false
}

pub fn burgage_zone_on_water(corners: &ZoneCorners) -> bool {
    for corner in zone_corners_polygon(corners) {
        if is_open_water(corner.x, corner.z) {
            return true;
        }
    }
    false
}

pub fn burgage_frontage_edge_distance(
    ctx: &ReducerContext,
    owner: Identity,
    corners: &ZoneCorners,
    frontage_edge: u8,
) -> f64 {
    let Some(network) = load_owner_road_network(ctx, owner) else {
        return f64::INFINITY;
    };
    let (start, end) = zone_edge(corners, frontage_edge);
    let samples = 10;
    let mut min_distance = f64::INFINITY;
    for i in 0..=samples {
        let t = i as f64 / samples as f64;
        let x = start.x + (end.x - start.x) * t;
        let z = start.z + (end.z - start.z) * t;
        min_distance = min_distance.min(network.nearest_distance(x, z));
    }
    min_distance
}

pub fn burgage_zone_has_road_frontage(
    ctx: &ReducerContext,
    owner: Identity,
    corners: &ZoneCorners,
    frontage_edge: u8,
) -> bool {
    burgage_frontage_edge_distance(ctx, owner, corners, frontage_edge) <= MAX_ROAD_FRONTAGE_DISTANCE
}

fn zone_edge(corners: &ZoneCorners, edge: u8) -> (Point2, Point2) {
    match edge {
        0 => (corners.a, corners.b),
        1 => (corners.b, corners.c),
        2 => (corners.c, corners.d),
        _ => (corners.d, corners.a),
    }
}

pub fn building_overlaps_residence_zone(
    ctx: &ReducerContext,
    kind: &str,
    x: f64,
    z: f64,
) -> bool {
    let Some(pick_radius) = building_pick_radius(kind) else {
        return false;
    };

    for zone in ctx.db.burgage_zone().iter() {
        let zone_polygon = [
            crate::burgage::Point2 {
                x: zone.corner_ax,
                z: zone.corner_az,
            },
            crate::burgage::Point2 {
                x: zone.corner_bx,
                z: zone.corner_bz,
            },
            crate::burgage::Point2 {
                x: zone.corner_cx,
                z: zone.corner_cz,
            },
            crate::burgage::Point2 {
                x: zone.corner_dx,
                z: zone.corner_dz,
            },
        ];
        if zone_overlaps_footprint(&zone_polygon, x, z, pick_radius) {
            return true;
        }
    }

    false
}

pub fn burgage_zone_overlaps_buildings(ctx: &ReducerContext, corners: &ZoneCorners) -> bool {
    let candidate = zone_corners_polygon(corners);
    for building in ctx.db.building().iter() {
        let Some(pick_radius) = building_pick_radius(&building.kind) else {
            continue;
        };
        if zone_overlaps_footprint(&candidate, building.x, building.z, pick_radius) {
            return true;
        }
    }
    false
}

pub fn is_on_quarry_pit(ctx: &ReducerContext, x: f64, z: f64) -> bool {
    for quarry in ctx.db.quarry().iter() {
        let radius = if quarry.quarry_id.contains("large") {
            LARGE_QUARRY_PIT_RADIUS
        } else {
            SMALL_QUARRY_PIT_RADIUS
        };
        let dx = quarry.x - x;
        let dz = quarry.z - z;
        if dx * dx + dz * dz <= radius * radius {
            return true;
        }
    }
    false
}

pub fn building_overlaps_road_surface(
    ctx: &ReducerContext,
    owner: Identity,
    kind: &str,
    x: f64,
    z: f64,
) -> bool {
    let Some(network) = load_owner_road_network(ctx, owner) else {
        return false;
    };
    let pad = building_pad_params(kind);
    let yaw = building_placement_yaw(x, z);
    let cos = yaw.cos();
    let sin = yaw.sin();

    for &fraction in &FOOTPRINT_SAMPLE_FRACTIONS {
        for sx in [-1, 0, 1] {
            for sz in [-1, 0, 1] {
                if fraction == 0.0 && (sx != 0 || sz != 0) {
                    continue;
                }
                let local_x = sx as f64 * pad.radius_x * pad.inner_fade * fraction;
                let local_z = sz as f64 * pad.radius_z * pad.inner_fade * fraction;
                let sample_x = x + local_x * cos - local_z * sin;
                let sample_z = z + local_x * sin + local_z * cos;
                if network.is_on_road_surface(sample_x, sample_z) {
                    return true;
                }
            }
        }
    }

    false
}

fn building_pad_params(kind: &str) -> BuildingPadParams {
    match kind {
        "lumber_mill" => BuildingPadParams {
            radius_x: 10.2,
            radius_z: 4.8,
            inner_fade: 0.86,
            outer_fade: 1.38,
        },
        "reforester" => BuildingPadParams {
            radius_x: 4.4,
            radius_z: 4.1,
            inner_fade: 0.88,
            outer_fade: 1.32,
        },
        "woodcutters_lodge" => BuildingPadParams {
            radius_x: 4.6,
            radius_z: 4.3,
            inner_fade: 0.88,
            outer_fade: 1.34,
        },
        "stone_quarry" => BuildingPadParams {
            radius_x: 10.5,
            radius_z: 10.5,
            inner_fade: 0.82,
            outer_fade: 1.42,
        },
        "well" => BuildingPadParams {
            radius_x: 2.2,
            radius_z: 2.2,
            inner_fade: 0.9,
            outer_fade: 1.2,
        },
        "hunters_hall" => BuildingPadParams {
            radius_x: 5.2,
            radius_z: 4.8,
            inner_fade: 0.88,
            outer_fade: 1.34,
        },
        "foragers_shed" => BuildingPadParams {
            radius_x: 4.2,
            radius_z: 3.8,
            inner_fade: 0.88,
            outer_fade: 1.3,
        },
        "chapel" => BuildingPadParams {
            radius_x: 3.4,
            radius_z: 4.2,
            inner_fade: 0.9,
            outer_fade: 1.28,
        },
        "marketplace" => BuildingPadParams {
            radius_x: 4.2,
            radius_z: 3.4,
            inner_fade: 0.9,
            outer_fade: 1.3,
        },
        "town_hall" => BuildingPadParams {
            radius_x: 7.2,
            radius_z: 5.8,
            inner_fade: 0.88,
            outer_fade: 1.32,
        },
        "village_storehouse" => BuildingPadParams {
            radius_x: 6.3,
            radius_z: 5.2,
            inner_fade: 0.88,
            outer_fade: 1.3,
        },
        "threshing_barn" => BuildingPadParams {
            radius_x: 6.5,
            radius_z: 5.0,
            inner_fade: 0.88,
            outer_fade: 1.3,
        },
        "monastery" => BuildingPadParams {
            radius_x: 9.5,
            radius_z: 6.8,
            inner_fade: 0.86,
            outer_fade: 1.35,
        },
        "brewery" => BuildingPadParams {
            radius_x: 5.6,
            radius_z: 4.7,
            inner_fade: 0.88,
            outer_fade: 1.3,
        },
        "smokehouse" => BuildingPadParams {
            radius_x: 4.4,
            radius_z: 4.0,
            inner_fade: 0.88,
            outer_fade: 1.28,
        },
        "granary" => BuildingPadParams {
            radius_x: 5.8,
            radius_z: 4.7,
            inner_fade: 0.88,
            outer_fade: 1.3,
        },
        "apiary" => BuildingPadParams {
            radius_x: 5.3,
            radius_z: 4.6,
            inner_fade: 0.88,
            outer_fade: 1.28,
        },
        "watermill" => BuildingPadParams {
            radius_x: 6.7,
            radius_z: 4.9,
            inner_fade: 0.86,
            outer_fade: 1.35,
        },
        "carpenter" => BuildingPadParams {
            radius_x: 6.4,
            radius_z: 4.8,
            inner_fade: 0.88,
            outer_fade: 1.32,
        },
        "ferry_landing" => BuildingPadParams {
            radius_x: 6.8,
            radius_z: 8.5,
            inner_fade: 0.84,
            outer_fade: 1.25,
        },
        "vineyard" => BuildingPadParams {
            radius_x: 8.0,
            radius_z: 6.8,
            inner_fade: 0.88,
            outer_fade: 1.24,
        },
        _ => BuildingPadParams {
            radius_x: 10.5,
            radius_z: 10.5,
            inner_fade: 0.82,
            outer_fade: 1.42,
        },
    }
}

fn building_placement_yaw(x: f64, z: f64) -> f64 {
    let degrees = ((x * 0.017 + z * 0.013).sin() * 6283.0).floor().abs() % 360.0;
    degrees.to_radians()
}

#[cfg(test)]
mod tests {
    use super::{any_open_water_near, building_site_contains_point};

    #[test]
    fn close_shore_water_is_not_skipped_between_sparse_rings() {
        let narrow_water_patch = |x: f64, z: f64| (x - 4.0).hypot(z) <= 0.75;
        assert!(any_open_water_near(0.0, 0.0, 24.0, narrow_water_patch));
    }

    #[test]
    fn water_beyond_the_shore_limit_is_rejected() {
        let distant_water_patch = |x: f64, z: f64| (x - 30.0).hypot(z) <= 0.75;
        assert!(!any_open_water_near(0.0, 0.0, 24.0, distant_water_patch));
    }

    #[test]
    fn building_site_clearance_uses_the_local_pad_not_the_work_radius() {
        assert!(building_site_contains_point("watermill", 10.0, -6.0, 10.0, -6.0));
        assert!(!building_site_contains_point("watermill", 10.0, -6.0, 40.0, -6.0));
    }
}
