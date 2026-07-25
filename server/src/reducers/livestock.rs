use spacetimedb::{reducer, ReducerContext};

use crate::balance_generated::{
    CATTLE_MAX_SLOPE_DEGREES, CATTLE_STARTER_HERD, LIVESTOCK_MIN_PASTURE_AREA,
    LIVESTOCK_MIN_PASTURE_EDGE, SHEEP_MAX_SLOPE_DEGREES, SHEEP_STARTER_HERD,
};
use crate::burgage::{convex_zones_overlap, zone_overlaps_footprint, Point2};
use crate::db::*;
use crate::farming::{
    centroid, corners_from_values, edge_lengths, is_valid_rectangle, polygon_area,
};
use crate::hydrology::sample_hydrology_score;
use crate::placement_validation::{building_pick_radius, is_on_quarry_pit, is_open_water};
use crate::tables::{farm_field, livestock_herd, pasture, LivestockHerd, Pasture};

pub const SPECIES_CATTLE: u8 = 0;
pub const SPECIES_SHEEP: u8 = 1;
pub const SPECIES_SWINE: u8 = 2;

#[reducer]
#[allow(clippy::too_many_arguments)]
pub fn place_pasture(
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
    average_slope_degrees: f64,
) -> Result<(), String> {
    let owner = ctx.sender();
    let farmstead = ctx
        .db
        .building()
        .id()
        .find(&farmstead_id)
        .ok_or_else(|| "Livestock building not found.".to_string())?;
    if farmstead.owner != owner
        || !matches!(farmstead.kind.as_str(), "pastoral_farmstead" | "swineherd")
    {
        return Err("Pastures must belong to one of your livestock buildings.".to_string());
    }
    let herd = ctx
        .db
        .livestock_herd()
        .building_id()
        .find(&farmstead_id)
        .ok_or_else(|| "This livestock building has no herd state.".to_string())?;

    let corners = corners_from_values([
        corner_ax, corner_az, corner_bx, corner_bz, corner_cx, corner_cz, corner_dx, corner_dz,
    ]);
    if !is_valid_rectangle(&corners) {
        return Err("Pasture corners must form a valid rectangle.".to_string());
    }
    let area = polygon_area(&corners);
    if area < LIVESTOCK_MIN_PASTURE_AREA - 1e-6 {
        return Err(format!(
            "Pasture is too small; draw at least {} m².",
            LIVESTOCK_MIN_PASTURE_AREA.round()
        ));
    }
    if edge_lengths(&corners)
        .iter()
        .any(|length| *length < LIVESTOCK_MIN_PASTURE_EDGE)
    {
        return Err(format!(
            "Every pasture edge must be at least {} m.",
            LIVESTOCK_MIN_PASTURE_EDGE.round()
        ));
    }

    let slope = average_slope_degrees.clamp(0.0, 90.0);
    let max_slope = match herd.species {
        SPECIES_CATTLE => CATTLE_MAX_SLOPE_DEGREES,
        SPECIES_SHEEP | SPECIES_SWINE => SHEEP_MAX_SLOPE_DEGREES,
        _ => return Err("Unknown herd species.".to_string()),
    };
    if slope > max_slope {
        return Err(if herd.species == SPECIES_CATTLE {
            "This ground is too steep for cattle pasture.".to_string()
        } else {
            "This ground is too steep for grazing.".to_string()
        });
    }

    let center = centroid(&corners);
    if [corners.a, corners.b, corners.c, corners.d]
        .iter()
        .any(|point| {
            ((point.x - farmstead.x).powi(2) + (point.z - farmstead.z).powi(2)).sqrt()
                > farmstead.work_radius
        })
    {
        return Err("The entire pasture must lie inside the building's working range.".to_string());
    }

    let polygon = [corners.a, corners.b, corners.c, corners.d];
    for point in polygon.iter().chain(std::iter::once(&center)) {
        if is_open_water(point.x, point.z) {
            return Err("Pastures cannot cover open water.".to_string());
        }
        if is_on_quarry_pit(ctx, point.x, point.z) {
            return Err("Pastures cannot cover a quarry pit.".to_string());
        }
    }
    for building in ctx.db.building().iter() {
        let Some(radius) = building_pick_radius(&building.kind) else {
            continue;
        };
        if zone_overlaps_footprint(&polygon, building.x, building.z, radius) {
            return Err("Pasture overlaps a building.".to_string());
        }
    }
    for zone in ctx.db.burgage_zone().iter() {
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
            return Err("Pasture overlaps a residence plot.".to_string());
        }
    }
    for field in ctx.db.farm_field().iter() {
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
            return Err("Pasture overlaps cultivated farmland.".to_string());
        }
    }
    for pasture in ctx.db.pasture().iter() {
        let existing = [
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
        ];
        if convex_zones_overlap(&polygon, &existing) {
            return Err("Pasture overlaps an existing grazing parcel.".to_string());
        }
    }

    ctx.db.pasture().insert(Pasture {
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
        moisture: sample_hydrology_score(center.x, center.z).clamp(0.0, 1.0),
    });
    Ok(())
}

#[reducer]
pub fn set_livestock_species(
    ctx: &ReducerContext,
    building_id: u64,
    species: u8,
) -> Result<(), String> {
    if !matches!(species, SPECIES_CATTLE | SPECIES_SHEEP) {
        return Err("Pastoral farmsteads can specialize in cattle or sheep.".to_string());
    }
    let building = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Pastoral farmstead not found.".to_string())?;
    if building.owner != ctx.sender() || building.kind != "pastoral_farmstead" {
        return Err("You do not own this pastoral farmstead.".to_string());
    }
    let mut herd = ctx
        .db
        .livestock_herd()
        .building_id()
        .find(&building_id)
        .ok_or_else(|| "Herd state not found.".to_string())?;
    if herd.species == species {
        return Ok(());
    }
    herd.species = species;
    herd.head_count = if species == SPECIES_CATTLE {
        CATTLE_STARTER_HERD
    } else {
        SHEEP_STARTER_HERD
    };
    herd.health = 0.75;
    herd.breeding_progress = 0.0;
    herd.pasture_capacity = 0.0;
    herd.supplied_capacity = 0.0;
    herd.last_food_output = 0.0;
    herd.last_preserved_output = 0.0;
    herd.last_wool_gold = 0.0;
    ctx.db.livestock_herd().building_id().update(herd);
    Ok(())
}

#[reducer]
pub fn demolish_pasture(ctx: &ReducerContext, pasture_id: u64) -> Result<(), String> {
    let pasture = ctx
        .db
        .pasture()
        .id()
        .find(&pasture_id)
        .ok_or_else(|| "Pasture not found.".to_string())?;
    if pasture.owner != ctx.sender() {
        return Err("You do not own this pasture.".to_string());
    }
    ctx.db.pasture().id().delete(pasture_id);
    Ok(())
}

pub fn starter_herd(building_id: u64, owner: spacetimedb::Identity, species: u8) -> LivestockHerd {
    LivestockHerd {
        building_id,
        owner,
        species,
        head_count: match species {
            SPECIES_CATTLE => CATTLE_STARTER_HERD,
            SPECIES_SHEEP => SHEEP_STARTER_HERD,
            _ => crate::balance_generated::SWINE_STARTER_HERD,
        },
        health: 0.82,
        breeding_progress: 0.0,
        pasture_capacity: 0.0,
        supplied_capacity: 0.0,
        last_food_output: 0.0,
        last_preserved_output: 0.0,
        last_wool_gold: 0.0,
    }
}
