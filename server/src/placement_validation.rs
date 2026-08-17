use spacetimedb::Identity;
use spacetimedb::ReducerContext;

use crate::building_defs::building_def;
use crate::burgage::{zone_corners_polygon, zone_overlaps_footprint, Point2, ZoneCorners};
use crate::db::*;
use crate::hydrology::sample_hydrology_score;
use crate::roads::{load_owner_road_network, RoadNetwork};

const ORDINARY_STONE_DEPOSIT_PROTECTION_RADIUS: f64 = 34.0;
const RICH_STONE_DEPOSIT_PROTECTION_RADIUS: f64 = 67.0;
const ORDINARY_MINERAL_DEPOSIT_PROTECTION_RADIUS: f64 = 23.0;
const RICH_MINERAL_DEPOSIT_PROTECTION_RADIUS: f64 = 32.0;
const ORDINARY_CLAY_DEPOSIT_PROTECTION_RADIUS: f64 = 16.0;
const RICH_CLAY_DEPOSIT_PROTECTION_RADIUS: f64 = 21.0;
const ORDINARY_BERRY_PATCH_PROTECTION_RADIUS: f64 = 5.184;
const RICH_BERRY_PATCH_PROTECTION_RADIUS: f64 = 6.013_44;
const MUSHROOM_PATCH_PROTECTION_RADIUS: f64 = 7.2;
const FOOTPRINT_SAMPLE_FRACTIONS: [f64; 3] = [0.0, 0.55, 0.82];
const OPEN_WATER_THRESHOLD: f64 = 0.999;
const MAX_ROAD_FRONTAGE_DISTANCE: f64 = 16.0;
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
    owner: Identity,
    kind: &str,
    x: f64,
    z: f64,
) -> bool {
    let Some(pick_radius) = building_pick_radius(kind) else {
        return false;
    };

    for zone in ctx.db.burgage_zone().owner().filter(&owner) {
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

pub fn burgage_zone_overlaps_buildings(
    ctx: &ReducerContext,
    owner: Identity,
    corners: &ZoneCorners,
) -> bool {
    let candidate = zone_corners_polygon(corners);
    for building in ctx.db.building().owner().filter(&owner) {
        let Some(pick_radius) = building_pick_radius(&building.kind) else {
            continue;
        };
        if zone_overlaps_footprint(&candidate, building.x, building.z, pick_radius) {
            return true;
        }
    }
    false
}

pub fn is_on_resource_deposit(ctx: &ReducerContext, x: f64, z: f64) -> bool {
    ctx.db.quarry().iter().any(|deposit| {
        point_overlaps_circle(
            x,
            z,
            deposit.x,
            deposit.z,
            quarry_deposit_protection_radius(&deposit.quarry_id, deposit.is_rich),
        )
    }) || ctx.db.foraging_node().iter().any(|deposit| {
        clay_deposit_protection_radius(&deposit.node_id, &deposit.node_kind)
            .or_else(|| {
                static_foraging_resource_protection_radius(&deposit.node_kind, deposit.max_yield)
            })
            .is_some_and(|radius| point_overlaps_circle(x, z, deposit.x, deposit.z, radius))
    })
}

pub fn zone_overlaps_resource_deposit(ctx: &ReducerContext, corners: &ZoneCorners) -> bool {
    let polygon = zone_corners_polygon(corners);
    ctx.db.quarry().iter().any(|deposit| {
        polygon_overlaps_circle(
            &polygon,
            deposit.x,
            deposit.z,
            quarry_deposit_protection_radius(&deposit.quarry_id, deposit.is_rich),
        )
    }) || ctx.db.foraging_node().iter().any(|deposit| {
        clay_deposit_protection_radius(&deposit.node_id, &deposit.node_kind)
            .is_some_and(|radius| polygon_overlaps_circle(&polygon, deposit.x, deposit.z, radius))
    })
}

fn quarry_deposit_protection_radius(quarry_id: &str, is_rich: bool) -> f64 {
    if quarry_id.starts_with("deposit-iron-") || quarry_id.starts_with("deposit-salt-") {
        if is_rich {
            RICH_MINERAL_DEPOSIT_PROTECTION_RADIUS
        } else {
            ORDINARY_MINERAL_DEPOSIT_PROTECTION_RADIUS
        }
    } else if is_rich {
        RICH_STONE_DEPOSIT_PROTECTION_RADIUS
    } else {
        ORDINARY_STONE_DEPOSIT_PROTECTION_RADIUS
    }
}

fn clay_deposit_protection_radius(node_id: &str, node_kind: &str) -> Option<f64> {
    if node_kind != "clay" || !node_id.starts_with("clay-") {
        return None;
    }
    Some(if node_id.starts_with("clay-rich-") {
        RICH_CLAY_DEPOSIT_PROTECTION_RADIUS
    } else {
        ORDINARY_CLAY_DEPOSIT_PROTECTION_RADIUS
    })
}

fn static_foraging_resource_protection_radius(node_kind: &str, max_yield: f64) -> Option<f64> {
    match node_kind {
        "berries" if max_yield > 60.0 => Some(RICH_BERRY_PATCH_PROTECTION_RADIUS),
        "berries" => Some(ORDINARY_BERRY_PATCH_PROTECTION_RADIUS),
        "mushrooms" => Some(MUSHROOM_PATCH_PROTECTION_RADIUS),
        _ => None,
    }
}

fn point_overlaps_circle(x: f64, z: f64, center_x: f64, center_z: f64, radius: f64) -> bool {
    (x - center_x).powi(2) + (z - center_z).powi(2) <= radius * radius
}

fn polygon_overlaps_circle(
    polygon: &[Point2; 4],
    center_x: f64,
    center_z: f64,
    radius: f64,
) -> bool {
    if point_inside_convex_polygon(center_x, center_z, polygon) {
        return true;
    }
    let radius_sq = radius * radius;
    (0..polygon.len()).any(|index| {
        distance_to_segment_squared(
            center_x,
            center_z,
            polygon[index],
            polygon[(index + 1) % polygon.len()],
        ) <= radius_sq
    })
}

fn point_inside_convex_polygon(x: f64, z: f64, polygon: &[Point2; 4]) -> bool {
    let mut sign = 0_i8;
    for index in 0..polygon.len() {
        let start = polygon[index];
        let end = polygon[(index + 1) % polygon.len()];
        let cross = (end.x - start.x) * (z - start.z) - (end.z - start.z) * (x - start.x);
        if cross.abs() <= 1e-9 {
            continue;
        }
        let next_sign = if cross > 0.0 { 1 } else { -1 };
        if sign != 0 && sign != next_sign {
            return false;
        }
        sign = next_sign;
    }
    true
}

fn distance_to_segment_squared(x: f64, z: f64, start: Point2, end: Point2) -> f64 {
    let dx = end.x - start.x;
    let dz = end.z - start.z;
    let length_sq = dx * dx + dz * dz;
    if length_sq <= 1e-12 {
        return (x - start.x).powi(2) + (z - start.z).powi(2);
    }
    let t = (((x - start.x) * dx + (z - start.z) * dz) / length_sq).clamp(0.0, 1.0);
    let nearest_x = start.x + dx * t;
    let nearest_z = start.z + dz * t;
    (x - nearest_x).powi(2) + (z - nearest_z).powi(2)
}

pub fn building_overlaps_road_surface(network: &RoadNetwork, kind: &str, x: f64, z: f64) -> bool {
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

pub fn building_overlaps_open_water(kind: &str, x: f64, z: f64) -> bool {
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
                if is_open_water(sample_x, sample_z) {
                    return true;
                }
            }
        }
    }

    false
}

fn building_pad_params(kind: &str) -> BuildingPadParams {
    match kind {
        "remote_work_camp" => BuildingPadParams {
            radius_x: 4.4,
            radius_z: 4.0,
            inner_fade: 0.86,
            outer_fade: 1.24,
        },
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
        "large_quarry" => BuildingPadParams {
            radius_x: 13.0,
            radius_z: 12.0,
            inner_fade: 0.84,
            outer_fade: 1.24,
        },
        "clay_pit" => BuildingPadParams {
            radius_x: 7.0,
            radius_z: 6.0,
            inner_fade: 0.84,
            outer_fade: 1.3,
        },
        "charcoal_burner" => BuildingPadParams {
            radius_x: 5.6,
            radius_z: 5.2,
            inner_fade: 0.88,
            outer_fade: 1.32,
        },
        "smithy" | "potter_kiln" => BuildingPadParams {
            radius_x: 5.2,
            radius_z: 4.5,
            inner_fade: 0.88,
            outer_fade: 1.3,
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
        "fishing_camp" => BuildingPadParams {
            radius_x: 5.4,
            radius_z: 4.5,
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
        "watchtower" => BuildingPadParams {
            radius_x: 3.0,
            radius_z: 3.0,
            inner_fade: 0.9,
            outer_fade: 1.3,
        },
        "guardhouse" => BuildingPadParams {
            radius_x: 6.8,
            radius_z: 4.8,
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
        "windmill" => BuildingPadParams {
            radius_x: 7.2,
            radius_z: 6.0,
            inner_fade: 0.86,
            outer_fade: 1.34,
        },
        "carpenter" => BuildingPadParams {
            radius_x: 6.4,
            radius_z: 4.8,
            inner_fade: 0.88,
            outer_fade: 1.32,
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
    use super::{
        building_site_contains_point, clay_deposit_protection_radius, polygon_overlaps_circle,
        quarry_deposit_protection_radius, static_foraging_resource_protection_radius,
    };
    use crate::burgage::Point2;

    #[test]
    fn building_site_clearance_uses_the_local_pad_not_the_work_radius() {
        assert!(building_site_contains_point(
            "watermill",
            10.0,
            -6.0,
            10.0,
            -6.0
        ));
        assert!(!building_site_contains_point(
            "watermill",
            10.0,
            -6.0,
            40.0,
            -6.0
        ));
    }

    #[test]
    fn deposit_radii_follow_the_rendered_resource_family() {
        assert_eq!(
            quarry_deposit_protection_radius("quarry-large-0", true),
            67.0
        );
        assert_eq!(
            quarry_deposit_protection_radius("deposit-salt-rich-0", true),
            32.0
        );
        assert_eq!(
            quarry_deposit_protection_radius("deposit-iron-ordinary-0", false),
            23.0
        );
        assert_eq!(
            clay_deposit_protection_radius("clay-rich-0", "clay"),
            Some(21.0)
        );
        assert_eq!(
            clay_deposit_protection_radius("foraging-game-0", "game"),
            None
        );
        assert_eq!(
            static_foraging_resource_protection_radius("berries", 60.0),
            Some(5.184)
        );
        assert_eq!(
            static_foraging_resource_protection_radius("berries", 100.0),
            Some(6.013_44)
        );
        assert_eq!(
            static_foraging_resource_protection_radius("mushrooms", 42.0),
            Some(7.2)
        );
    }

    #[test]
    fn parcel_overlap_finds_a_deposit_between_all_four_corners() {
        let parcel = [
            Point2 { x: -40.0, z: -40.0 },
            Point2 { x: 40.0, z: -40.0 },
            Point2 { x: 40.0, z: 40.0 },
            Point2 { x: -40.0, z: 40.0 },
        ];
        assert!(polygon_overlaps_circle(&parcel, 0.0, 0.0, 16.0));
        assert!(!polygon_overlaps_circle(&parcel, 80.0, 0.0, 16.0));
    }
}
