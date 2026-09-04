use spacetimedb::Identity;
use spacetimedb::ReducerContext;

use crate::building_defs::building_def;
use crate::burgage::{
    convex_zones_overlap, oriented_footprint_polygon, zone_corners_polygon,
    zone_overlaps_oriented_footprint, Point2, ZoneCorners,
};
use crate::db::*;
use crate::monastery_estate_policy::{
    monastery_estate_corners, MONASTERY_ESTATE_DEPTH, MONASTERY_ESTATE_HALF_WIDTH,
    MONASTERY_ESTATE_REAR_DEPTH, MONASTERY_ESTATE_WIDTH,
};
use crate::roads::{load_owner_road_network, RoadNetwork};
use crate::tables::Building;

const ORDINARY_STONE_DEPOSIT_PROTECTION_RADIUS: f64 = 34.0;
const RICH_STONE_DEPOSIT_PROTECTION_RADIUS: f64 = 67.0;
const ORDINARY_MINERAL_DEPOSIT_PROTECTION_RADIUS: f64 = 23.0;
const RICH_MINERAL_DEPOSIT_PROTECTION_RADIUS: f64 = 32.0;
const ORDINARY_CLAY_DEPOSIT_PROTECTION_RADIUS: f64 = 16.0;
const RICH_CLAY_DEPOSIT_PROTECTION_RADIUS: f64 = 21.0;
const ORDINARY_BERRY_PATCH_PROTECTION_RADIUS: f64 = 5.184;
const RICH_BERRY_PATCH_PROTECTION_RADIUS: f64 = 6.013_44;
const MUSHROOM_PATCH_PROTECTION_RADIUS: f64 = 7.2;
const FOOTPRINT_SAMPLE_FRACTIONS: [f64; 4] = [0.0, 0.55, 0.82, 1.0];
const BUILDING_FOOTPRINT_SCALE: f64 = 0.92;
const ROAD_FACING_SNAP_DISTANCE: f64 = 24.0;
const MAX_ROAD_FRONTAGE_DISTANCE: f64 = 16.0;
const BUILDING_SITE_CLEAR_MARGIN: f64 = 0.75;
const BUILDING_EDGE_CLEARANCE: f64 = 0.65;
const BUILDING_EDGE_CLEARANCE_EPSILON: f64 = 0.025;

struct BuildingPadParams {
    radius_x: f64,
    radius_z: f64,
    inner_fade: f64,
    outer_fade: f64,
}

pub fn building_site_contains_point_at_yaw(
    kind: &str,
    building_x: f64,
    building_z: f64,
    yaw: f64,
    point_x: f64,
    point_z: f64,
) -> bool {
    let pad = building_pad_params(kind);
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
    yaw: f64,
) -> bool {
    if building_def(kind).is_none() {
        return false;
    }

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
        if zone_overlaps_building_footprint_at_yaw(&zone_polygon, kind, x, z, yaw) {
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
    let network = load_owner_road_network(ctx, owner);
    for building in ctx.db.building().owner().filter(&owner) {
        if building_def(&building.kind).is_none() {
            continue;
        }
        if zone_overlaps_building_footprint_at_yaw(
            &candidate,
            &building.kind,
            building.x,
            building.z,
            resolved_existing_building_yaw(network.as_ref(), &building),
        ) {
            return true;
        }
    }
    false
}

pub fn zone_overlaps_building_footprint_at_yaw(
    zone: &[Point2; 4],
    kind: &str,
    x: f64,
    z: f64,
    yaw: f64,
) -> bool {
    if kind == "monastery" {
        return convex_zones_overlap(zone, &building_footprint_polygon_at_yaw(kind, x, z, yaw));
    }
    let pad = building_pad_params(kind);
    zone_overlaps_oriented_footprint(
        zone,
        x,
        z,
        pad.radius_x * pad.inner_fade * BUILDING_FOOTPRINT_SCALE,
        pad.radius_z * pad.inner_fade * BUILDING_FOOTPRINT_SCALE,
        yaw,
    )
}

pub fn building_footprints_too_close(
    candidate_kind: &str,
    candidate_x: f64,
    candidate_z: f64,
    candidate_yaw: f64,
    other_kind: &str,
    other_x: f64,
    other_z: f64,
    other_yaw: Option<f64>,
    network: Option<&RoadNetwork>,
) -> bool {
    let candidate =
        building_footprint_polygon_at_yaw(candidate_kind, candidate_x, candidate_z, candidate_yaw);
    let other = other_yaw
        .map(|yaw| building_footprint_polygon_at_yaw(other_kind, other_x, other_z, yaw))
        .unwrap_or_else(|| building_footprint_polygon(other_kind, other_x, other_z, network));
    minimum_polygon_distance(&candidate, &other)
        < BUILDING_EDGE_CLEARANCE - BUILDING_EDGE_CLEARANCE_EPSILON
}

pub fn building_footprint_polygon(
    kind: &str,
    x: f64,
    z: f64,
    network: Option<&RoadNetwork>,
) -> [Point2; 4] {
    let yaw = network
        .map(|roads| road_aware_building_placement_yaw(roads, kind, x, z))
        .unwrap_or_else(|| building_placement_yaw(x, z));
    building_footprint_polygon_at_yaw(kind, x, z, yaw)
}

pub fn building_footprint_polygon_at_yaw(kind: &str, x: f64, z: f64, yaw: f64) -> [Point2; 4] {
    if kind == "monastery" {
        return monastery_estate_corners(x, z, yaw).map(|point| Point2 {
            x: point.x,
            z: point.z,
        });
    }
    let pad = building_pad_params(kind);
    oriented_footprint_polygon(
        x,
        z,
        pad.radius_x * pad.inner_fade * BUILDING_FOOTPRINT_SCALE,
        pad.radius_z * pad.inner_fade * BUILDING_FOOTPRINT_SCALE,
        yaw,
    )
}

/// Tests the exact road-aware/yawed placement footprint against a circular
/// world-space area. Keeping this beside `building_footprint_polygon` makes
/// simulation effects use the same authored rectangle/estate as placement.
pub fn building_footprint_overlaps_circle(
    kind: &str,
    x: f64,
    z: f64,
    placement_yaw: Option<f64>,
    network: Option<&RoadNetwork>,
    center_x: f64,
    center_z: f64,
    radius: f64,
) -> bool {
    polygon_overlaps_circle(
        &placement_yaw
            .map(|yaw| building_footprint_polygon_at_yaw(kind, x, z, yaw))
            .unwrap_or_else(|| building_footprint_polygon(kind, x, z, network)),
        center_x,
        center_z,
        radius,
    )
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

pub fn building_overlaps_resource_deposit(
    ctx: &ReducerContext,
    kind: &str,
    x: f64,
    z: f64,
    yaw: f64,
) -> bool {
    if kind != "monastery" {
        return is_on_resource_deposit(ctx, x, z);
    }
    let polygon = building_footprint_polygon_at_yaw(kind, x, z, yaw);
    ctx.db.quarry().iter().any(|deposit| {
        polygon_overlaps_circle(
            &polygon,
            deposit.x,
            deposit.z,
            quarry_deposit_protection_radius(&deposit.quarry_id, deposit.is_rich),
        )
    }) || ctx.db.foraging_node().iter().any(|deposit| {
        clay_deposit_protection_radius(&deposit.node_id, &deposit.node_kind)
            .or_else(|| {
                static_foraging_resource_protection_radius(&deposit.node_kind, deposit.max_yield)
            })
            .is_some_and(|radius| polygon_overlaps_circle(&polygon, deposit.x, deposit.z, radius))
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

fn minimum_polygon_distance(a: &[Point2; 4], b: &[Point2; 4]) -> f64 {
    if convex_zones_overlap(a, b) {
        return 0.0;
    }
    let mut minimum_squared = f64::INFINITY;
    for point in a {
        for index in 0..b.len() {
            minimum_squared = minimum_squared.min(distance_to_segment_squared(
                point.x,
                point.z,
                b[index],
                b[(index + 1) % b.len()],
            ));
        }
    }
    for point in b {
        for index in 0..a.len() {
            minimum_squared = minimum_squared.min(distance_to_segment_squared(
                point.x,
                point.z,
                a[index],
                a[(index + 1) % a.len()],
            ));
        }
    }
    minimum_squared.sqrt()
}

pub fn building_overlaps_road_surface(network: &RoadNetwork, kind: &str, x: f64, z: f64) -> bool {
    building_overlaps_road_surface_at_yaw(
        network,
        kind,
        x,
        z,
        road_aware_building_placement_yaw(network, kind, x, z),
    )
}

pub fn building_overlaps_road_surface_at_yaw(
    network: &RoadNetwork,
    kind: &str,
    x: f64,
    z: f64,
    yaw: f64,
) -> bool {
    if kind == "monastery" {
        let columns = (MONASTERY_ESTATE_WIDTH / 5.5).ceil() as usize;
        let rows = (MONASTERY_ESTATE_DEPTH / 5.5).ceil() as usize;
        let cos = yaw.cos();
        let sin = yaw.sin();
        for column in 0..=columns {
            let local_x = -MONASTERY_ESTATE_HALF_WIDTH
                + MONASTERY_ESTATE_WIDTH * column as f64 / columns as f64;
            for row in 0..=rows {
                let local_z = -MONASTERY_ESTATE_REAR_DEPTH
                    + MONASTERY_ESTATE_DEPTH * row as f64 / rows as f64;
                let sample_x = x + local_x * cos + local_z * sin;
                let sample_z = z - local_x * sin + local_z * cos;
                if network.is_on_road_surface(sample_x, sample_z) {
                    return true;
                }
            }
        }
        return false;
    }
    let pad = building_pad_params(kind);
    let cos = yaw.cos();
    let sin = yaw.sin();

    for &fraction in &FOOTPRINT_SAMPLE_FRACTIONS {
        let sample_fraction = if fraction == 1.0 {
            BUILDING_FOOTPRINT_SCALE
        } else {
            fraction
        };
        for sx in [-1, 0, 1] {
            for sz in [-1, 0, 1] {
                if fraction == 0.0 && (sx != 0 || sz != 0) {
                    continue;
                }
                let local_x = sx as f64 * pad.radius_x * pad.inner_fade * sample_fraction;
                let local_z = sz as f64 * pad.radius_z * pad.inner_fade * sample_fraction;
                let sample_x = x + local_x * cos + local_z * sin;
                let sample_z = z - local_x * sin + local_z * cos;
                if network.is_on_road_surface(sample_x, sample_z) {
                    return true;
                }
            }
        }
    }

    false
}

fn road_aware_building_placement_yaw(network: &RoadNetwork, kind: &str, x: f64, z: f64) -> f64 {
    let uses_road_facing_yaw = building_def(kind).is_some_and(|def| {
        def.faces_road || (!def.requires_water_shore && !matches!(kind, "large_quarry" | "mine"))
    });
    if uses_road_facing_yaw {
        if let Some((road_x, road_z)) = network.nearest_point(x, z, ROAD_FACING_SNAP_DISTANCE) {
            let dx = road_x - x;
            let dz = road_z - z;
            if dx.hypot(dz) > 0.05 {
                return dx.atan2(dz);
            }
        }
    }
    building_placement_yaw(x, z)
}

pub fn resolved_building_placement_yaw(
    network: Option<&RoadNetwork>,
    kind: &str,
    x: f64,
    z: f64,
) -> f64 {
    network
        .map(|roads| road_aware_building_placement_yaw(roads, kind, x, z))
        .unwrap_or_else(|| building_placement_yaw(x, z))
}

/** Existing buildings use their placement-time yaw; only legacy rows fall back. */
pub fn resolved_existing_building_yaw(network: Option<&RoadNetwork>, building: &Building) -> f64 {
    if building.placement_yaw_locked && building.placement_yaw.is_finite() {
        building.placement_yaw
    } else {
        resolved_building_placement_yaw(network, &building.kind, building.x, building.z)
    }
}

/**
 * Additive save migration: preserve the orientation legacy buildings have at
 * upgrade time, then make later road edits physically incapable of turning
 * them.
 */
pub fn lock_legacy_building_placement_yaws(ctx: &ReducerContext, owner: Identity) {
    let network = load_owner_road_network(ctx, owner);
    let legacy = ctx
        .db
        .building()
        .owner()
        .filter(&owner)
        .filter(|building| !building.placement_yaw_locked)
        .collect::<Vec<_>>();
    for mut building in legacy {
        building.placement_yaw = resolved_building_placement_yaw(
            network.as_ref(),
            &building.kind,
            building.x,
            building.z,
        );
        building.placement_yaw_locked = true;
        ctx.db.building().id().update(building);
    }
}

fn building_pad_params(kind: &str) -> BuildingPadParams {
    match kind {
        "founders_camp" => BuildingPadParams {
            radius_x: 8.6,
            radius_z: 7.2,
            inner_fade: 0.88,
            outer_fade: 1.28,
        },
        "salvage_pile" => BuildingPadParams {
            radius_x: 6.0,
            radius_z: 5.2,
            inner_fade: 0.88,
            outer_fade: 1.28,
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
        "mine" => BuildingPadParams {
            radius_x: 11.0,
            radius_z: 10.0,
            inner_fade: 0.84,
            outer_fade: 1.24,
        },
        "charcoal_burner" => BuildingPadParams {
            radius_x: 4.9,
            radius_z: 4.4,
            inner_fade: 0.86,
            outer_fade: 1.28,
        },
        "smithy" => BuildingPadParams {
            radius_x: 4.6,
            radius_z: 4.1,
            inner_fade: 0.88,
            outer_fade: 1.3,
        },
        "potter_kiln" => BuildingPadParams {
            radius_x: 4.7,
            radius_z: 4.1,
            inner_fade: 0.88,
            outer_fade: 1.3,
        },
        "well" => BuildingPadParams {
            radius_x: 2.2,
            radius_z: 2.2,
            inner_fade: 0.9,
            outer_fade: 1.2,
        },
        "stable" => BuildingPadParams {
            radius_x: 6.4,
            radius_z: 4.2,
            inner_fade: 0.9,
            outer_fade: 1.3,
        },
        "kennel" => BuildingPadParams {
            radius_x: 5.1,
            radius_z: 4.5,
            inner_fade: 0.9,
            outer_fade: 1.3,
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
            // Permanent fenced churchyard, shared by every upgrade tier.
            radius_x: 8.5,
            radius_z: 11.35,
            inner_fade: 0.9,
            outer_fade: 1.22,
        },
        "wayside_shrine" => BuildingPadParams {
            radius_x: 1.65,
            radius_z: 1.5,
            inner_fade: 0.9,
            outer_fade: 1.24,
        },
        "marketplace" => BuildingPadParams {
            radius_x: 4.2,
            radius_z: 3.4,
            inner_fade: 0.9,
            outer_fade: 1.3,
        },
        "trading_post" => BuildingPadParams {
            radius_x: 6.6,
            radius_z: 5.4,
            inner_fade: 0.88,
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
        "palisaded_refuge" => BuildingPadParams {
            radius_x: 9.2,
            radius_z: 7.2,
            inner_fade: 0.88,
            outer_fade: 1.28,
        },
        "threshing_barn" => BuildingPadParams {
            radius_x: 6.5,
            radius_z: 5.0,
            inner_fade: 0.88,
            outer_fade: 1.3,
        },
        "pastoral_farmstead" => BuildingPadParams {
            radius_x: 7.2,
            radius_z: 5.4,
            inner_fade: 0.88,
            outer_fade: 1.3,
        },
        "swineherd" => BuildingPadParams {
            radius_x: 6.2,
            radius_z: 5.2,
            inner_fade: 0.88,
            outer_fade: 1.28,
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
        "tavern" => BuildingPadParams {
            radius_x: 5.4,
            radius_z: 4.6,
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
        "bakery" => BuildingPadParams {
            radius_x: 5.1,
            radius_z: 4.5,
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
        "spinning_retting_house" => BuildingPadParams {
            radius_x: 5.8,
            radius_z: 4.5,
            inner_fade: 0.88,
            outer_fade: 1.3,
        },
        "weaver" => BuildingPadParams {
            radius_x: 5.8,
            radius_z: 4.5,
            inner_fade: 0.88,
            outer_fade: 1.3,
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
        building_footprint_overlaps_circle, building_overlaps_road_surface,
        building_site_contains_point_at_yaw, clay_deposit_protection_radius,
        minimum_polygon_distance, polygon_overlaps_circle, quarry_deposit_protection_radius,
        road_aware_building_placement_yaw, static_foraging_resource_protection_radius,
        BUILDING_FOOTPRINT_SCALE,
    };
    use crate::balance_generated::GAME_HABITAT_DISRUPTION_RADIUS;
    use crate::burgage::Point2;
    use crate::roads::RoadNetwork;

    #[test]
    fn road_facing_lumber_mill_clears_a_diagonal_road() {
        let snapshot = r#"{
            "nodes": [
                {"id":"node-1","position":[-30.0,0.0,-30.0]},
                {"id":"node-2","position":[30.0,0.0,30.0]}
            ],
            "edges": [{
                "startNodeId":"node-1",
                "endNodeId":"node-2",
                "width":4.2,
                "sampledPath":[[-30.0,0.0,-30.0],[30.0,0.0,30.0]]
            }]
        }"#;
        let network = RoadNetwork::from_snapshot_json(snapshot).expect("valid diagonal road");

        // This is the client roadside snap for a lumber mill with its cursor
        // at (-2, 8): centerline projection (3, 3), northwest verge.
        let setback = 4.2 * 0.5 + 8.0 * 0.6 + 0.65;
        let normal = std::f64::consts::FRAC_1_SQRT_2;
        let x = 3.0 - setback * normal;
        let z = 3.0 + setback * normal;

        assert!(!building_overlaps_road_surface(
            &network,
            "lumber_mill",
            x,
            z
        ));
    }

    #[test]
    fn snapped_stable_clears_the_road_with_the_client_footprint() {
        let snapshot = r#"{
            "nodes": [
                {"id":"node-1","position":[-30.0,0.0,0.0]},
                {"id":"node-2","position":[30.0,0.0,0.0]}
            ],
            "edges": [{
                "startNodeId":"node-1",
                "endNodeId":"node-2",
                "width":4.2,
                "sampledPath":[[-30.0,0.0,0.0],[30.0,0.0,0.0]]
            }]
        }"#;
        let network = RoadNetwork::from_snapshot_json(snapshot).expect("valid straight road");

        // The client snaps the Stable to this setback: road half-width,
        // construction-site front depth (5.32), and roadside clearance.
        let snapped_z = 4.2 * 0.5 + 5.32 + 0.65;

        assert!(!building_overlaps_road_surface(
            &network, "stable", 0.0, snapped_z
        ));
    }

    #[test]
    fn snapped_kennel_clears_the_road_with_the_client_footprint() {
        let snapshot = r#"{
            "nodes": [
                {"id":"node-1","position":[-30.0,0.0,0.0]},
                {"id":"node-2","position":[30.0,0.0,0.0]}
            ],
            "edges": [{
                "startNodeId":"node-1",
                "endNodeId":"node-2",
                "width":4.2,
                "sampledPath":[[-30.0,0.0,0.0],[30.0,0.0,0.0]]
            }]
        }"#;
        let network = RoadNetwork::from_snapshot_json(snapshot).expect("valid straight road");

        // Match the client snap: road half-width, construction-site front
        // depth (the 3.726 m footprint plus 1.48 m), and road clearance.
        let snapped_z = 4.2 * 0.5 + (4.5 * 0.9 * BUILDING_FOOTPRINT_SCALE + 1.48) + 0.65;

        assert!(!building_overlaps_road_surface(
            &network, "kennel", 0.0, snapped_z
        ));
    }

    #[test]
    fn movable_rural_buildings_without_a_road_requirement_still_face_the_road() {
        let snapshot = r#"{
            "nodes": [
                {"id":"node-1","position":[-30.0,0.0,0.0]},
                {"id":"node-2","position":[30.0,0.0,0.0]}
            ],
            "edges": [{
                "startNodeId":"node-1",
                "endNodeId":"node-2",
                "width":4.2,
                "sampledPath":[[-30.0,0.0,0.0],[30.0,0.0,0.0]]
            }]
        }"#;
        let network = RoadNetwork::from_snapshot_json(snapshot).expect("valid straight road");

        for kind in [
            "reforester",
            "stone_quarry",
            "hunters_hall",
            "foragers_shed",
            "fishing_camp",
            "swineherd",
            "apiary",
        ] {
            let yaw = road_aware_building_placement_yaw(&network, kind, 4.0, 8.0);
            assert!(
                (yaw.abs() - std::f64::consts::PI).abs() < 1e-9,
                "{kind} should face back toward the road after roadside snapping"
            );
        }
    }

    #[test]
    fn habitat_overlap_uses_the_road_yawed_visible_footprint() {
        let snapshot = r#"{
            "nodes": [
                {"id":"node-1","position":[10.0,0.0,-30.0]},
                {"id":"node-2","position":[10.0,0.0,30.0]}
            ],
            "edges": [{
                "startNodeId":"node-1",
                "endNodeId":"node-2",
                "width":4.2,
                "sampledPath":[[10.0,0.0,-30.0],[10.0,0.0,30.0]]
            }]
        }"#;
        let network = RoadNetwork::from_snapshot_json(snapshot).expect("valid vertical road");
        let half_width = 4.6 * 0.88 * BUILDING_FOOTPRINT_SCALE;
        let half_depth = 4.1 * 0.88 * BUILDING_FOOTPRINT_SCALE;
        let yaw_sensitive_z = GAME_HABITAT_DISRUPTION_RADIUS + (half_width + half_depth) * 0.5;

        assert!(!building_footprint_overlaps_circle(
            "smithy",
            0.0,
            0.0,
            None,
            None,
            0.0,
            yaw_sensitive_z,
            GAME_HABITAT_DISRUPTION_RADIUS,
        ));
        assert!(building_footprint_overlaps_circle(
            "smithy",
            0.0,
            0.0,
            None,
            Some(&network),
            0.0,
            yaw_sensitive_z,
            GAME_HABITAT_DISRUPTION_RADIUS,
        ));
        assert!(!building_footprint_overlaps_circle(
            "smithy",
            0.0,
            0.0,
            None,
            None,
            GAME_HABITAT_DISRUPTION_RADIUS + half_width + 0.1,
            0.0,
            GAME_HABITAT_DISRUPTION_RADIUS,
        ));
    }

    #[test]
    fn building_site_clearance_uses_the_local_pad_not_the_work_radius() {
        assert!(building_site_contains_point_at_yaw(
            "watermill",
            10.0,
            -6.0,
            0.0,
            10.0,
            -6.0
        ));
        assert!(!building_site_contains_point_at_yaw(
            "watermill",
            10.0,
            -6.0,
            0.0,
            40.0,
            -6.0
        ));
    }

    #[test]
    fn dense_building_spacing_measures_the_visible_edge_gap() {
        let first = [
            Point2 { x: -4.0, z: -3.0 },
            Point2 { x: 4.0, z: -3.0 },
            Point2 { x: 4.0, z: 3.0 },
            Point2 { x: -4.0, z: 3.0 },
        ];
        let separated = [
            Point2 { x: 4.65, z: -2.0 },
            Point2 { x: 9.0, z: -2.0 },
            Point2 { x: 9.0, z: 2.0 },
            Point2 { x: 4.65, z: 2.0 },
        ];
        let overlapping = [
            Point2 { x: 3.8, z: -2.0 },
            Point2 { x: 9.0, z: -2.0 },
            Point2 { x: 9.0, z: 2.0 },
            Point2 { x: 3.8, z: 2.0 },
        ];

        assert!((minimum_polygon_distance(&first, &separated) - 0.65).abs() < 1e-9);
        assert_eq!(minimum_polygon_distance(&first, &overlapping), 0.0);
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
