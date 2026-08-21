use spacetimedb::{reducer, ReducerContext};

use crate::burgage::{convex_zones_overlap, zone_corners_polygon, Point2};
use crate::db::*;
use crate::farming::{
    centroid, corners_from_values, edge_lengths, is_valid_convex_quadrilateral, point_in_field,
    polygon_area, shape_efficiency,
};
use crate::hydrology::sample_world_hydrology_score;
use crate::placement_validation::{
    zone_overlaps_building_footprint, zone_overlaps_resource_deposit,
};
use crate::roads::load_owner_road_network;
use crate::tables::{farm_field, graveyard, vineyard_parcel, VineyardParcel};
use crate::vineyard::{
    site_suitability, VINEYARD_MAX_AREA, VINEYARD_MAX_SLOPE_DEGREES, VINEYARD_MIN_AREA,
    VINEYARD_MIN_EDGE, VINEYARD_MONASTERY_ADJACENCY_DISTANCE,
    VINEYARD_MONASTERY_MAX_DISTANCE,
};

#[reducer]
#[allow(clippy::too_many_arguments)]
pub fn place_vineyard(
    ctx: &ReducerContext,
    monastery_id: u64,
    corner_ax: f64,
    corner_az: f64,
    corner_bx: f64,
    corner_bz: f64,
    corner_cx: f64,
    corner_cz: f64,
    corner_dx: f64,
    corner_dz: f64,
    average_slope_degrees: f64,
    south_exposure: f64,
) -> Result<(), String> {
    let owner = ctx.sender();
    let monastery = ctx
        .db
        .building()
        .id()
        .find(&monastery_id)
        .ok_or_else(|| "Monastery not found.".to_string())?;
    if monastery.owner != owner
        || monastery.kind != "monastery"
        || !monastery.construction_complete
    {
        return Err("Vineyards must belong to one of your completed monasteries.".to_string());
    }
    if ctx
        .db
        .vineyard_parcel()
        .building_id()
        .find(&monastery_id)
        .is_some()
    {
        return Err("This monastery already has a vineyard extension.".to_string());
    }
    let corners = corners_from_values([
        corner_ax, corner_az, corner_bx, corner_bz, corner_cx, corner_cz, corner_dx, corner_dz,
    ]);
    if !is_valid_convex_quadrilateral(&corners) {
        return Err("Vineyard corners must form a simple convex parcel.".to_string());
    }
    let area = polygon_area(&corners);
    if area < VINEYARD_MIN_AREA - 1e-6 {
        return Err(format!(
            "Vineyard is too small; draw at least {} m².",
            VINEYARD_MIN_AREA.round()
        ));
    }
    if area > VINEYARD_MAX_AREA + 1e-6 {
        return Err(format!(
            "One vineyard may cover at most {} m².",
            VINEYARD_MAX_AREA.round()
        ));
    }
    if edge_lengths(&corners)
        .iter()
        .any(|length| *length < VINEYARD_MIN_EDGE)
    {
        return Err(format!(
            "Every vineyard edge must be at least {} m.",
            VINEYARD_MIN_EDGE.round()
        ));
    }

    if !average_slope_degrees.is_finite() || !south_exposure.is_finite() {
        return Err("Vineyard terrain samples are invalid.".to_string());
    }
    let slope = average_slope_degrees.clamp(0.0, 90.0);
    if slope > VINEYARD_MAX_SLOPE_DEGREES {
        return Err("This ground is too steep to terrace safely.".to_string());
    }
    let exposure = south_exposure.clamp(0.0, 1.0);
    let polygon = zone_corners_polygon(&corners);

    let distances = [corners.a, corners.b, corners.c, corners.d]
        .map(|point| ((point.x - monastery.x).powi(2) + (point.z - monastery.z).powi(2)).sqrt());
    if distances
        .iter()
        .any(|distance| *distance > VINEYARD_MONASTERY_MAX_DISTANCE)
    {
        return Err("The entire vineyard must stay near its monastery.".to_string());
    }
    if distances
        .iter()
        .all(|distance| *distance > VINEYARD_MONASTERY_ADJACENCY_DISTANCE)
    {
        return Err("The vineyard must adjoin the monastery estate.".to_string());
    }

    if zone_overlaps_resource_deposit(ctx, &corners) {
        return Err("Vineyards cannot cover a physical resource deposit.".to_string());
    }
    // The rendered, seed-aware water mask is sampled across the parcel by the
    // client. Server hydrology is intentionally used only as groundwater.

    let road_network = load_owner_road_network(ctx, owner);
    for building in ctx.db.building().owner().filter(&owner) {
        if zone_overlaps_building_footprint(
            &polygon,
            &building.kind,
            building.x,
            building.z,
            road_network.as_ref(),
        ) {
            return Err("Vineyard overlaps a building.".to_string());
        }
    }
    for zone in ctx.db.burgage_zone().owner().filter(&owner) {
        if convex_zones_overlap(
            &polygon,
            &parcel_polygon(
                zone.corner_ax,
                zone.corner_az,
                zone.corner_bx,
                zone.corner_bz,
                zone.corner_cx,
                zone.corner_cz,
                zone.corner_dx,
                zone.corner_dz,
            ),
        ) {
            return Err("Vineyard overlaps a residence plot.".to_string());
        }
    }
    for field in ctx.db.farm_field().owner().filter(&owner) {
        if convex_zones_overlap(
            &polygon,
            &parcel_polygon(
                field.corner_ax,
                field.corner_az,
                field.corner_bx,
                field.corner_bz,
                field.corner_cx,
                field.corner_cz,
                field.corner_dx,
                field.corner_dz,
            ),
        ) {
            return Err("Vineyard overlaps cultivated farmland.".to_string());
        }
    }
    for pasture in ctx.db.pasture().owner().filter(&owner) {
        if convex_zones_overlap(
            &polygon,
            &parcel_polygon(
                pasture.corner_ax,
                pasture.corner_az,
                pasture.corner_bx,
                pasture.corner_bz,
                pasture.corner_cx,
                pasture.corner_cz,
                pasture.corner_dx,
                pasture.corner_dz,
            ),
        ) {
            return Err("Vineyard overlaps a pasture.".to_string());
        }
    }
    for graveyard in ctx.db.graveyard().owner().filter(&owner) {
        if convex_zones_overlap(
            &polygon,
            &parcel_polygon(
                graveyard.corner_ax,
                graveyard.corner_az,
                graveyard.corner_bx,
                graveyard.corner_bz,
                graveyard.corner_cx,
                graveyard.corner_cz,
                graveyard.corner_dx,
                graveyard.corner_dz,
            ),
        ) {
            return Err("Vineyard overlaps a burial ground.".to_string());
        }
    }
    for vineyard in ctx.db.vineyard_parcel().owner().filter(&owner) {
        if convex_zones_overlap(
            &polygon,
            &parcel_polygon(
                vineyard.corner_ax,
                vineyard.corner_az,
                vineyard.corner_bx,
                vineyard.corner_bz,
                vineyard.corner_cx,
                vineyard.corner_cz,
                vineyard.corner_dx,
                vineyard.corner_dz,
            ),
        ) {
            return Err("Vineyard overlaps an existing vineyard.".to_string());
        }
    }

    let center = centroid(&corners);
    let config = ctx
        .db
        .world_config()
        .id()
        .find(&0)
        .ok_or_else(|| "World not initialized.".to_string())?;
    let moisture = sample_world_hydrology_score(center.x, center.z, config.seed, config.hydrology);
    let suitability = site_suitability(moisture, slope, exposure, center.x, center.z);
    let shape = shape_efficiency(&corners);

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

    ctx.db.vineyard_parcel().insert(VineyardParcel {
        building_id: monastery_id,
        owner,
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
        moisture,
        south_exposure: exposure,
        site_suitability: suitability,
        shape_efficiency: shape,
    });
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn parcel_polygon(
    ax: f64,
    az: f64,
    bx: f64,
    bz: f64,
    cx: f64,
    cz: f64,
    dx: f64,
    dz: f64,
) -> [Point2; 4] {
    [
        Point2 { x: ax, z: az },
        Point2 { x: bx, z: bz },
        Point2 { x: cx, z: cz },
        Point2 { x: dx, z: dz },
    ]
}
