use spacetimedb::{reducer, ReducerContext};

use crate::balance_generated::{
    CATTLE_DEFAULT_BREEDING_RESERVE, CATTLE_MAX_HERD, CATTLE_MAX_SLOPE_DEGREES,
    CATTLE_MINIMUM_BREEDING_RESERVE, CATTLE_PURCHASE_GOLD_PER_HEAD,
    CATTLE_SALE_GOLD_PER_HEAD, LIVESTOCK_DEFAULT_HAYMAKING_PERCENT,
    LIVESTOCK_MAXIMUM_HAYMAKING_PERCENT, LIVESTOCK_MIN_PASTURE_AREA,
    LIVESTOCK_MIN_PASTURE_EDGE, SHEEP_DEFAULT_BREEDING_RESERVE, SHEEP_MAX_HERD,
    SHEEP_MAX_SLOPE_DEGREES, SHEEP_MINIMUM_BREEDING_RESERVE,
    SHEEP_PURCHASE_GOLD_PER_HEAD, SHEEP_SALE_GOLD_PER_HEAD,
    SWINE_DEFAULT_BREEDING_RESERVE, SWINE_MAX_HERD, SWINE_MAX_SLOPE_DEGREES,
    SWINE_MINIMUM_BREEDING_RESERVE, SWINE_PURCHASE_GOLD_PER_HEAD,
    SWINE_SALE_GOLD_PER_HEAD,
};
use crate::burgage::{convex_zones_overlap, Point2};
use crate::db::*;
use crate::farming::{
    centroid, corners_from_values, edge_lengths, is_valid_convex_quadrilateral, polygon_area,
};
use crate::hydrology::sample_world_groundwater_score;
use crate::economy::{credit_treasury_gold, spend_treasury_gold};
use crate::placement_validation::{
    zone_overlaps_building_footprint, zone_overlaps_resource_deposit,
};
use crate::roads::load_owner_road_network;
use crate::simulation::grazing_capacity;
use crate::tables::{farm_field, graveyard, livestock_herd, pasture, LivestockHerd, Pasture};

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
    if !is_valid_convex_quadrilateral(&corners) {
        return Err("Pasture corners must form a simple convex parcel.".to_string());
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
        SPECIES_SHEEP => SHEEP_MAX_SLOPE_DEGREES,
        SPECIES_SWINE => SWINE_MAX_SLOPE_DEGREES,
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
    if zone_overlaps_resource_deposit(ctx, &corners) {
        return Err("Pastures cannot cover a physical resource deposit.".to_string());
    }
    // The client samples the entire parcel against the active rendered-water
    // mask. The server hydrology grid is a groundwater proxy, not this world's
    // generated surface-water layout, so it must not contradict that result.
    let road_network = load_owner_road_network(ctx, owner);
    for building in ctx.db.building().owner().filter(&owner) {
        if zone_overlaps_building_footprint(
            &polygon,
            &building.kind,
            building.x,
            building.z,
            road_network.as_ref(),
        ) {
            return Err("Pasture overlaps a building.".to_string());
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
            return Err("Pasture overlaps a residence plot.".to_string());
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
            return Err("Pasture overlaps cultivated farmland.".to_string());
        }
    }
    for pasture in ctx.db.pasture().owner().filter(&owner) {
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
    for vineyard in ctx.db.vineyard_parcel().owner().filter(&owner) {
        let existing = [
            Point2 {
                x: vineyard.corner_ax,
                z: vineyard.corner_az,
            },
            Point2 {
                x: vineyard.corner_bx,
                z: vineyard.corner_bz,
            },
            Point2 {
                x: vineyard.corner_cx,
                z: vineyard.corner_cz,
            },
            Point2 {
                x: vineyard.corner_dx,
                z: vineyard.corner_dz,
            },
        ];
        if convex_zones_overlap(&polygon, &existing) {
            return Err("Pasture overlaps an existing vineyard.".to_string());
        }
    }
    for graveyard in ctx.db.graveyard().owner().filter(&owner) {
        let existing = [
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
        ];
        if convex_zones_overlap(&polygon, &existing) {
            return Err("Pasture overlaps consecrated burial ground.".to_string());
        }
    }

    let config = ctx
        .db
        .world_config()
        .id()
        .find(&0)
        .ok_or_else(|| "World not initialized.".to_string())?;
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
        moisture: sample_world_groundwater_score(center.x, center.z, config.seed, config.hydrology),
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
    if building.owner != ctx.sender()
        || building.kind != "pastoral_farmstead"
        || !building.construction_complete
    {
        return Err("You do not own this completed pastoral farmstead.".to_string());
    }
    let existing_herd = ctx.db.livestock_herd().building_id().find(&building_id);
    let Some(mut herd) = existing_herd else {
        ctx.db
            .livestock_herd()
            .insert(unstocked_herd(building.id, building.owner, species));
        return Ok(());
    };
    if herd.species == species {
        return Ok(());
    }
    if herd.head_count > 0 {
        return Err("Sell the current herd before changing this holding's species.".to_string());
    }
    if ctx
        .db
        .pasture()
        .farmstead_id()
        .filter(&building_id)
        .next()
        .is_some()
    {
        return Err(
            "Remove this holding's linked pasture before changing species.".to_string(),
        );
    }
    herd.species = species;
    herd.head_count = 0;
    herd.health = 0.82;
    herd.breeding_progress = 0.0;
    herd.pasture_capacity = 0.0;
    herd.supplied_capacity = 0.0;
    herd.last_food_output = 0.0;
    herd.last_preserved_output = 0.0;
    herd.last_wool_gold = 0.0;
    herd.last_wool_output = 0.0;
    herd.last_shearing_year = 0;
    herd.breeding_reserve = default_breeding_reserve(species);
    herd.last_culled = 0;
    herd.last_hay_output = 0.0;
    herd.haymaking_percent = LIVESTOCK_DEFAULT_HAYMAKING_PERCENT;
    ctx.db.livestock_herd().building_id().update(herd);
    Ok(())
}

/// Buy or sell whole animals at the holding. Positive deltas purchase regional
/// breeding stock with civic gold; negative deltas sell live animals back to
/// drovers. Purchases may never exceed the land's neutral carrying capacity or
/// the holding's management ceiling.
#[reducer]
pub fn trade_livestock(
    ctx: &ReducerContext,
    building_id: u64,
    head_delta: i32,
) -> Result<(), String> {
    if head_delta == 0 || !(-100..=100).contains(&head_delta) {
        return Err("Livestock orders must change between 1 and 100 head.".to_string());
    }
    let owner = ctx.sender();
    let building = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Livestock holding not found.".to_string())?;
    if building.owner != owner
        || !matches!(building.kind.as_str(), "pastoral_farmstead" | "swineherd")
        || !building.construction_complete
    {
        return Err("You do not own this completed livestock holding.".to_string());
    }
    let mut herd = ctx
        .db
        .livestock_herd()
        .building_id()
        .find(&building_id)
        .ok_or_else(|| "Choose a herd species before ordering animals.".to_string())?;

    if head_delta > 0 {
        let quantity = head_delta as u32;
        let land_limit = grazing_capacity(ctx, &building, &herd)
            .floor()
            .clamp(0.0, u32::MAX as f64) as u32;
        let holding_limit = maximum_herd(herd.species).min(land_limit);
        if herd.head_count.saturating_add(quantity) > holding_limit {
            let available = holding_limit.saturating_sub(herd.head_count);
            return Err(format!(
                "This holding has room for only {available} more head ({} total by land and management capacity).",
                holding_limit
            ));
        }
        let cost = purchase_gold_per_head(herd.species) * f64::from(quantity);
        spend_treasury_gold(ctx, owner, cost)?;
        let was_empty = herd.head_count == 0;
        herd.head_count += quantity;
        if was_empty {
            herd.health = 0.82;
            herd.breeding_progress = 0.0;
        }
    } else {
        let quantity = (-i64::from(head_delta)) as u32;
        if quantity > herd.head_count {
            return Err(format!(
                "Only {} head are available to sell.",
                herd.head_count
            ));
        }
        herd.head_count -= quantity;
        herd.supplied_capacity = herd.supplied_capacity.min(f64::from(herd.head_count));
        herd.breeding_progress = herd.breeding_progress.min(0.999);
        credit_treasury_gold(
            ctx,
            owner,
            sale_gold_per_head(herd.species) * f64::from(quantity),
        );
    }

    ctx.db.livestock_herd().building_id().update(herd);
    Ok(())
}

#[reducer]
pub fn set_livestock_breeding_reserve(
    ctx: &ReducerContext,
    building_id: u64,
    breeding_reserve: u32,
) -> Result<(), String> {
    let building = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Livestock holding not found.".to_string())?;
    if building.owner != ctx.sender()
        || !matches!(building.kind.as_str(), "pastoral_farmstead" | "swineherd")
        || !building.construction_complete
    {
        return Err("You do not own this completed livestock holding.".to_string());
    }
    let mut herd = ctx
        .db
        .livestock_herd()
        .building_id()
        .find(&building_id)
        .ok_or_else(|| "Herd state not found.".to_string())?;
    let minimum = minimum_breeding_reserve(herd.species);
    let maximum = maximum_herd(herd.species);
    if breeding_reserve < minimum || breeding_reserve > maximum {
        return Err(format!(
            "Breeding reserve must be between {minimum} and {maximum} head."
        ));
    }
    herd.breeding_reserve = breeding_reserve;
    ctx.db.livestock_herd().building_id().update(herd);
    Ok(())
}

#[reducer]
pub fn set_livestock_haymaking_percent(
    ctx: &ReducerContext,
    building_id: u64,
    haymaking_percent: u8,
) -> Result<(), String> {
    let building = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Pastoral farmstead not found.".to_string())?;
    if building.owner != ctx.sender()
        || building.kind != "pastoral_farmstead"
        || !building.construction_complete
    {
        return Err("You do not own this completed pastoral farmstead.".to_string());
    }
    if haymaking_percent > LIVESTOCK_MAXIMUM_HAYMAKING_PERCENT {
        return Err(format!(
            "Haymaking may reserve at most {LIVESTOCK_MAXIMUM_HAYMAKING_PERCENT}% of summer pasture."
        ));
    }
    let mut herd = ctx
        .db
        .livestock_herd()
        .building_id()
        .find(&building_id)
        .ok_or_else(|| "Herd state not found.".to_string())?;
    if herd.species == SPECIES_SWINE {
        return Err("Woodland pigs use pannage rather than hay meadows.".to_string());
    }
    herd.haymaking_percent = haymaking_percent;
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

pub fn unstocked_herd(
    building_id: u64,
    owner: spacetimedb::Identity,
    species: u8,
) -> LivestockHerd {
    LivestockHerd {
        building_id,
        owner,
        species,
        head_count: 0,
        health: 0.82,
        breeding_progress: 0.0,
        pasture_capacity: 0.0,
        supplied_capacity: 0.0,
        last_food_output: 0.0,
        last_preserved_output: 0.0,
        last_wool_gold: 0.0,
        breeding_reserve: default_breeding_reserve(species),
        last_culled: 0,
        hay_stock: 0.0,
        last_hay_output: 0.0,
        haymaking_percent: if species == SPECIES_SWINE {
            0
        } else {
            LIVESTOCK_DEFAULT_HAYMAKING_PERCENT
        },
        last_wool_output: 0.0,
        last_shearing_year: 0,
    }
}

fn minimum_breeding_reserve(species: u8) -> u32 {
    match species {
        SPECIES_CATTLE => CATTLE_MINIMUM_BREEDING_RESERVE,
        SPECIES_SHEEP => SHEEP_MINIMUM_BREEDING_RESERVE,
        _ => SWINE_MINIMUM_BREEDING_RESERVE,
    }
}

fn default_breeding_reserve(species: u8) -> u32 {
    match species {
        SPECIES_CATTLE => CATTLE_DEFAULT_BREEDING_RESERVE,
        SPECIES_SHEEP => SHEEP_DEFAULT_BREEDING_RESERVE,
        _ => SWINE_DEFAULT_BREEDING_RESERVE,
    }
}

fn maximum_herd(species: u8) -> u32 {
    match species {
        SPECIES_CATTLE => CATTLE_MAX_HERD,
        SPECIES_SHEEP => SHEEP_MAX_HERD,
        _ => SWINE_MAX_HERD,
    }
}

fn purchase_gold_per_head(species: u8) -> f64 {
    match species {
        SPECIES_CATTLE => CATTLE_PURCHASE_GOLD_PER_HEAD,
        SPECIES_SHEEP => SHEEP_PURCHASE_GOLD_PER_HEAD,
        _ => SWINE_PURCHASE_GOLD_PER_HEAD,
    }
}

fn sale_gold_per_head(species: u8) -> f64 {
    match species {
        SPECIES_CATTLE => CATTLE_SALE_GOLD_PER_HEAD,
        SPECIES_SHEEP => SHEEP_SALE_GOLD_PER_HEAD,
        _ => SWINE_SALE_GOLD_PER_HEAD,
    }
}
