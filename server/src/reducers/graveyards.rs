use spacetimedb::{reducer, ReducerContext};

use crate::balance_generated::{
    GRAVEYARD_ADJACENCY_DISTANCE, GRAVEYARD_MAX_DISTANCE, GRAVEYARD_MAX_SLOPE, GRAVEYARD_MIN_AREA,
    GRAVEYARD_MIN_EDGE, GRAVE_AREA_PER_BURIAL,
};
use crate::burgage::{convex_zones_overlap, zone_corners_polygon, zone_overlaps_footprint, Point2};
use crate::db::*;
use crate::farming::{
    corners_from_values, edge_lengths, is_valid_convex_quadrilateral, point_in_field, polygon_area,
};
use crate::placement_validation::{building_pick_radius, zone_overlaps_resource_deposit};
use crate::tables::{corpse, farm_field, graveyard, Graveyard, Pasture};

#[reducer]
#[allow(clippy::too_many_arguments)]
pub fn place_graveyard(
    ctx: &ReducerContext,
    chapel_id: u64,
    corner_ax: f64,
    corner_az: f64,
    corner_bx: f64,
    corner_bz: f64,
    corner_cx: f64,
    corner_cz: f64,
    corner_dx: f64,
    corner_dz: f64,
    average_slope_degrees: f64,
) -> Result<(), String> {
    let owner = ctx.sender();
    let chapel = ctx
        .db
        .building()
        .id()
        .find(&chapel_id)
        .ok_or_else(|| "Chapel not found.".to_string())?;
    if chapel.owner != owner || chapel.kind != "chapel" || !chapel.construction_complete {
        return Err("Burial grounds must adjoin one of your completed chapels.".to_string());
    }

    let corners = corners_from_values([
        corner_ax, corner_az, corner_bx, corner_bz, corner_cx, corner_cz, corner_dx, corner_dz,
    ]);
    if !is_valid_convex_quadrilateral(&corners) {
        return Err("Graveyard corners must form a simple convex parcel.".to_string());
    }
    let area = polygon_area(&corners);
    if area < GRAVEYARD_MIN_AREA - 1e-6 {
        return Err(format!(
            "Burial ground is too small; draw at least {} m².",
            GRAVEYARD_MIN_AREA.round()
        ));
    }
    if edge_lengths(&corners)
        .iter()
        .any(|length| *length < GRAVEYARD_MIN_EDGE)
    {
        return Err(format!(
            "Every burial-ground edge must be at least {} m.",
            GRAVEYARD_MIN_EDGE.round()
        ));
    }
    let slope = average_slope_degrees.clamp(0.0, 90.0);
    if slope > GRAVEYARD_MAX_SLOPE {
        return Err("This ground is too steep for safe graves.".to_string());
    }

    let corner_points = [corners.a, corners.b, corners.c, corners.d];
    let distances = corner_points
        .map(|point| ((point.x - chapel.x).powi(2) + (point.z - chapel.z).powi(2)).sqrt());
    if distances
        .iter()
        .any(|distance| *distance > GRAVEYARD_MAX_DISTANCE)
    {
        return Err("The entire burial ground must stay close to its chapel.".to_string());
    }
    if distances
        .iter()
        .all(|distance| *distance > GRAVEYARD_ADJACENCY_DISTANCE)
    {
        return Err("The burial ground must directly adjoin the chapel precinct.".to_string());
    }

    if zone_overlaps_resource_deposit(ctx, &corners) {
        return Err("Graveyards cannot cover a physical resource deposit.".to_string());
    }
    // The client samples the entire parcel against the active rendered-water
    // mask. The server hydrology grid is a groundwater proxy, not this world's
    // generated surface-water layout, so it must not contradict that result.

    let polygon = zone_corners_polygon(&corners);
    for building in ctx.db.building().owner().filter(&owner) {
        let Some(radius) = building_pick_radius(&building.kind) else {
            continue;
        };
        if zone_overlaps_footprint(&polygon, building.x, building.z, radius) {
            return Err("Burial ground overlaps a building.".to_string());
        }
    }
    for zone in ctx.db.burgage_zone().owner().filter(&owner) {
        if convex_zones_overlap(
            &polygon,
            &[
                Point2 {
                    x: zone.corner_ax,
                    z: zone.corner_az,
                },
                Point2 {
                    x: zone.corner_bx,
                    z: zone.corner_bz,
                },
                Point2 {
                    x: zone.corner_cx,
                    z: zone.corner_cz,
                },
                Point2 {
                    x: zone.corner_dx,
                    z: zone.corner_dz,
                },
            ],
        ) {
            return Err("Burial ground overlaps a residence plot.".to_string());
        }
    }
    for field in ctx.db.farm_field().owner().filter(&owner) {
        if convex_zones_overlap(
            &polygon,
            &[
                Point2 {
                    x: field.corner_ax,
                    z: field.corner_az,
                },
                Point2 {
                    x: field.corner_bx,
                    z: field.corner_bz,
                },
                Point2 {
                    x: field.corner_cx,
                    z: field.corner_cz,
                },
                Point2 {
                    x: field.corner_dx,
                    z: field.corner_dz,
                },
            ],
        ) {
            return Err("Burial ground overlaps farmland.".to_string());
        }
    }
    for pasture in ctx.db.pasture().owner().filter(&owner) {
        if overlaps_pasture(&polygon, &pasture) {
            return Err("Burial ground overlaps a pasture.".to_string());
        }
    }
    for graveyard in ctx.db.graveyard().owner().filter(&owner) {
        if convex_zones_overlap(
            &polygon,
            &[
                Point2 {
                    x: graveyard.corner_ax,
                    z: graveyard.corner_az,
                },
                Point2 {
                    x: graveyard.corner_bx,
                    z: graveyard.corner_bz,
                },
                Point2 {
                    x: graveyard.corner_cx,
                    z: graveyard.corner_cz,
                },
                Point2 {
                    x: graveyard.corner_dx,
                    z: graveyard.corner_dz,
                },
            ],
        ) {
            return Err("Burial grounds cannot overlap.".to_string());
        }
    }
    for vineyard in ctx.db.vineyard_parcel().owner().filter(&owner) {
        if convex_zones_overlap(
            &polygon,
            &[
                Point2 { x: vineyard.corner_ax, z: vineyard.corner_az },
                Point2 { x: vineyard.corner_bx, z: vineyard.corner_bz },
                Point2 { x: vineyard.corner_cx, z: vineyard.corner_cz },
                Point2 { x: vineyard.corner_dx, z: vineyard.corner_dz },
            ],
        ) {
            return Err("Burial ground overlaps an existing vineyard.".to_string());
        }
    }

    let cleared_tree_ids = ctx
        .db
        .tree_entity()
        .iter()
        .filter(|tree| {
            point_in_field(
                Point2 {
                    x: tree.x,
                    z: tree.z,
                },
                &corners,
            )
        })
        .map(|tree| tree.tree_id)
        .collect::<Vec<_>>();
    for tree_id in cleared_tree_ids {
        ctx.db.tree_entity().tree_id().delete(&tree_id);
    }

    ctx.db.graveyard().insert(Graveyard {
        id: 0,
        owner,
        chapel_id,
        corner_ax,
        corner_az,
        corner_bx,
        corner_bz,
        corner_cx,
        corner_cz,
        corner_dx,
        corner_dz,
        area,
        average_slope_degrees: slope,
        capacity: (area / GRAVE_AREA_PER_BURIAL.max(1.0)).floor().max(1.0) as u32,
        burials: 0,
    });
    Ok(())
}

#[reducer]
pub fn demolish_graveyard(ctx: &ReducerContext, graveyard_id: u64) -> Result<(), String> {
    let graveyard = ctx
        .db
        .graveyard()
        .id()
        .find(&graveyard_id)
        .ok_or_else(|| "Graveyard not found.".to_string())?;
    if graveyard.owner != ctx.sender() {
        return Err("You do not own this graveyard.".to_string());
    }
    if graveyard.burials > 0 {
        return Err(
            "A consecrated burial ground containing graves cannot be demolished.".to_string(),
        );
    }
    if ctx
        .db
        .corpse()
        .graveyard_id()
        .filter(&graveyard_id)
        .next()
        .is_some()
    {
        return Err("A gravedigger is already carrying a body here.".to_string());
    }
    ctx.db.graveyard().id().delete(graveyard_id);
    Ok(())
}

fn overlaps_pasture(polygon: &[Point2; 4], pasture: &Pasture) -> bool {
    convex_zones_overlap(
        polygon,
        &[
            Point2 {
                x: pasture.corner_ax,
                z: pasture.corner_az,
            },
            Point2 {
                x: pasture.corner_bx,
                z: pasture.corner_bz,
            },
            Point2 {
                x: pasture.corner_cx,
                z: pasture.corner_cz,
            },
            Point2 {
                x: pasture.corner_dx,
                z: pasture.corner_dz,
            },
        ],
    )
}
