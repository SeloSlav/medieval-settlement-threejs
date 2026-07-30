use spacetimedb::{reducer, ReducerContext};

use crate::balance_generated::{
    FARM_MAX_ACCEPTED_SLOPE_DEGREES, FARM_MIN_FIELD_AREA, FARM_MIN_FIELD_EDGE,
};
use crate::burgage::{convex_zones_overlap, zone_corners_polygon, zone_overlaps_footprint, Point2};
use crate::db::*;
use crate::farming::{
    bilinear_point, centroid, corners_from_values, early_harvest_available,
    early_harvest_yield_multiplier, edge_lengths, initial_field_fertility,
    is_valid_convex_quadrilateral, point_in_field, polygon_area, valid_crop, NO_FOLLOWING_CROP,
    STAGE_HARVESTING, STAGE_PLOUGHING,
};
use crate::hydrology::sample_hydrology_score;
use crate::placement_validation::{
    building_pick_radius, is_open_water, zone_overlaps_resource_deposit,
};
use crate::simulation::game_clock;
use crate::tables::{farm_field, FarmField};

#[reducer]
#[allow(clippy::too_many_arguments)]
pub fn place_farm_field(
    ctx: &ReducerContext,
    farmstead_id: u64,
    corner_ax: f64,
    corner_az: f64,
    corner_bx: f64,
    corner_bz: f64,
    corner_cx: f64,
    corner_cz: f64,
    corner_dx: f64,
    corner_dz: f64,
    crop: u8,
    average_slope_degrees: f64,
) -> Result<(), String> {
    let owner = ctx.sender();
    validate_crop(crop)?;
    let farmstead = ctx
        .db
        .building()
        .id()
        .find(&farmstead_id)
        .ok_or_else(|| "Farmstead not found.".to_string())?;
    if farmstead.owner != owner || farmstead.kind != "threshing_barn" {
        return Err("Fields must belong to one of your farmsteads.".to_string());
    }

    let corners = corners_from_values([
        corner_ax, corner_az, corner_bx, corner_bz, corner_cx, corner_cz, corner_dx, corner_dz,
    ]);
    if !is_valid_convex_quadrilateral(&corners) {
        return Err("Field corners must form a simple convex parcel.".to_string());
    }
    let area = polygon_area(&corners);
    if area < FARM_MIN_FIELD_AREA - 1e-6 {
        return Err(format!(
            "Field is too small; draw at least {} m².",
            FARM_MIN_FIELD_AREA.round()
        ));
    }
    if edge_lengths(&corners)
        .iter()
        .any(|length| *length < FARM_MIN_FIELD_EDGE)
    {
        return Err(format!(
            "Every field edge must be at least {} m.",
            FARM_MIN_FIELD_EDGE.round()
        ));
    }

    let slope = average_slope_degrees.clamp(0.0, 90.0);
    if slope > FARM_MAX_ACCEPTED_SLOPE_DEGREES {
        return Err("This ground is too steep to cultivate.".to_string());
    }

    let center = centroid(&corners);
    if [corners.a, corners.b, corners.c, corners.d]
        .iter()
        .any(|point| {
            ((point.x - farmstead.x).powi(2) + (point.z - farmstead.z).powi(2)).sqrt()
                > farmstead.work_radius
        })
    {
        return Err("The entire field must lie inside the farmstead's working range.".to_string());
    }

    let polygon = zone_corners_polygon(&corners);
    if zone_overlaps_resource_deposit(ctx, &corners) {
        return Err("Fields cannot cover a physical resource deposit.".to_string());
    }
    const PARCEL_SAMPLE_DIVISIONS: usize = 4;
    for v_index in 0..=PARCEL_SAMPLE_DIVISIONS {
        for u_index in 0..=PARCEL_SAMPLE_DIVISIONS {
            let point = bilinear_point(
                &corners,
                u_index as f64 / PARCEL_SAMPLE_DIVISIONS as f64,
                v_index as f64 / PARCEL_SAMPLE_DIVISIONS as f64,
            );
            if is_open_water(point.x, point.z) {
                return Err("Fields cannot cover open water.".to_string());
            }
        }
    }

    for building in ctx.db.building().owner().filter(&owner) {
        let Some(radius) = building_pick_radius(&building.kind) else {
            continue;
        };
        if zone_overlaps_footprint(&polygon, building.x, building.z, radius) {
            return Err("Field overlaps a building.".to_string());
        }
    }
    for zone in ctx.db.burgage_zone().owner().filter(&owner) {
        let existing = [
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
        ];
        if convex_zones_overlap(&polygon, &existing) {
            return Err("Field overlaps a residence plot.".to_string());
        }
    }
    for field in ctx.db.farm_field().owner().filter(&owner) {
        let existing = [
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
        ];
        if convex_zones_overlap(&polygon, &existing) {
            return Err("Field overlaps existing farmland.".to_string());
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

    let moisture = sample_hydrology_score(center.x, center.z).clamp(0.0, 1.0);
    let initial_fertility = initial_field_fertility(moisture, slope);
    ctx.db.farm_field().insert(FarmField {
        id: 0,
        owner,
        farmstead_id,
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
        fertility: initial_fertility,
        crop,
        next_crop: crop,
        stage: STAGE_PLOUGHING,
        stage_progress: 0.0,
        priority: 1,
        harvest_count: 0,
        last_yield: 0.0,
        current_yield: 0.0,
        harvest_yield_multiplier: 1.0,
        following_crop: NO_FOLLOWING_CROP,
        manure_applied: 0.0,
    });
    Ok(())
}

#[reducer]
pub fn set_farm_field_crop(ctx: &ReducerContext, field_id: u64, crop: u8) -> Result<(), String> {
    validate_crop(crop)?;
    let mut field = owned_field(ctx, field_id)?;
    field.next_crop = crop;
    ctx.db.farm_field().id().update(field);
    Ok(())
}

#[reducer]
pub fn set_farm_field_following_crop(
    ctx: &ReducerContext,
    field_id: u64,
    crop: u8,
) -> Result<(), String> {
    if crop != NO_FOLLOWING_CROP {
        validate_crop(crop)?;
    }
    let mut field = owned_field(ctx, field_id)?;
    field.following_crop = crop;
    ctx.db.farm_field().id().update(field);
    Ok(())
}

#[reducer]
pub fn set_farm_field_priority(
    ctx: &ReducerContext,
    field_id: u64,
    priority: u8,
) -> Result<(), String> {
    let mut field = owned_field(ctx, field_id)?;
    field.priority = priority.min(3);
    ctx.db.farm_field().id().update(field);
    Ok(())
}

#[reducer]
pub fn start_farm_field_early_harvest(ctx: &ReducerContext, field_id: u64) -> Result<(), String> {
    let mut field = owned_field(ctx, field_id)?;
    let farmstead = ctx
        .db
        .building()
        .id()
        .find(&field.farmstead_id)
        .ok_or_else(|| "The field's farmstead is missing.".to_string())?;
    if farmstead.owner != ctx.sender()
        || farmstead.kind != "threshing_barn"
        || !farmstead.construction_complete
    {
        return Err("A completed farmstead is required to begin harvest.".to_string());
    }
    let sim_tick = ctx
        .db
        .world_config()
        .id()
        .find(&0)
        .map(|config| config.sim_tick)
        .unwrap_or(0);
    let month = game_clock(sim_tick).month;
    if !early_harvest_available(field.stage, field.crop, month, field.stage_progress) {
        return Err(
            "Early harvest is available for ripe food or fibre crops in August after 55% growth."
                .to_string(),
        );
    }

    field.harvest_yield_multiplier = early_harvest_yield_multiplier(field.stage_progress);
    field.stage = STAGE_HARVESTING;
    field.stage_progress = 0.0;
    field.current_yield = 0.0;
    ctx.db.farm_field().id().update(field);
    Ok(())
}

#[reducer]
pub fn demolish_farm_field(ctx: &ReducerContext, field_id: u64) -> Result<(), String> {
    owned_field(ctx, field_id)?;
    ctx.db.farm_field().id().delete(field_id);
    Ok(())
}

fn owned_field(ctx: &ReducerContext, field_id: u64) -> Result<FarmField, String> {
    let field = ctx
        .db
        .farm_field()
        .id()
        .find(&field_id)
        .ok_or_else(|| "Field not found.".to_string())?;
    if field.owner != ctx.sender() {
        return Err("You do not own this field.".to_string());
    }
    Ok(field)
}

fn validate_crop(crop: u8) -> Result<(), String> {
    if valid_crop(crop) {
        Ok(())
    } else {
        Err("Unknown field crop.".to_string())
    }
}
