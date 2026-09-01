use spacetimedb::{reducer, ReducerContext};

use crate::balance_generated::{
    CATTLE_DEFAULT_BREEDING_RESERVE, CATTLE_MAX_HERD, CATTLE_MAX_SLOPE_DEGREES,
    CATTLE_MINIMUM_BREEDING_RESERVE, CATTLE_PURCHASE_GOLD_PER_HEAD, CATTLE_SALE_GOLD_PER_HEAD,
    LIVESTOCK_DEFAULT_HAYMAKING_PERCENT, LIVESTOCK_MAXIMUM_HAYMAKING_PERCENT,
    LIVESTOCK_MIN_PASTURE_AREA, LIVESTOCK_MIN_PASTURE_EDGE, SHEEP_DEFAULT_BREEDING_RESERVE,
    HORSE_MAX_HERD, HORSE_MAX_SLOPE_DEGREES, HORSE_PURCHASE_GOLD_PER_HEAD,
    HORSE_SALE_GOLD_PER_HEAD,
    SHEEP_MAX_HERD, SHEEP_MAX_SLOPE_DEGREES, SHEEP_MINIMUM_BREEDING_RESERVE,
    SHEEP_PURCHASE_GOLD_PER_HEAD, SHEEP_SALE_GOLD_PER_HEAD, SWINE_DEFAULT_BREEDING_RESERVE,
    SWINE_MAX_HERD, SWINE_MAX_SLOPE_DEGREES, SWINE_MINIMUM_BREEDING_RESERVE,
    SWINE_PURCHASE_GOLD_PER_HEAD, SWINE_SALE_GOLD_PER_HEAD,
};
use crate::burgage::{convex_zones_overlap, Point2};
use crate::db::*;
use crate::economy::{credit_treasury_gold, spend_treasury_gold};
use crate::farming::{
    centroid, corners_from_values, edge_lengths, is_valid_convex_quadrilateral, polygon_area,
};
use crate::hydrology::sample_world_groundwater_score;
use crate::livestock_policy::retained_livestock_breeding_progress;
use crate::placement_validation::{
    resolved_existing_building_yaw, zone_overlaps_building_footprint_at_yaw,
    zone_overlaps_resource_deposit,
};
use crate::roads::load_owner_road_network;
use crate::simulation::grazing_capacity_for_pasture;
use crate::tables::{
    cavalry_horse, farm_field, graveyard, pasture, pasture_herd, CavalryHorse, Pasture,
    PastureHerd,
};

pub const SPECIES_CATTLE: u8 = 0;
pub const SPECIES_SHEEP: u8 = 1;
pub const SPECIES_SWINE: u8 = 2;
pub const SPECIES_HORSE: u8 = 3;
pub const PASTORAL_MANAGEMENT_UNITS: u32 = 60;
pub const SWINE_MANAGEMENT_UNITS: u32 = 30;
pub const CATTLE_MANAGEMENT_UNITS_PER_HEAD: u32 = 3;
pub const SHEEP_MANAGEMENT_UNITS_PER_HEAD: u32 = 1;
pub const SWINE_MANAGEMENT_UNITS_PER_HEAD: u32 = 1;
pub const HORSE_MANAGEMENT_UNITS_PER_HEAD: u32 = 2;

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
    // An unstocked pastoral parcel may later receive either species, so its
    // placement uses sheep's broader terrain envelope. Cattle's tighter limit
    // is enforced when that specific pasture chooses cattle.
    let max_slope = match farmstead.kind.as_str() {
        "pastoral_farmstead" => SHEEP_MAX_SLOPE_DEGREES,
        "swineherd" => SWINE_MAX_SLOPE_DEGREES,
        _ => unreachable!(),
    };
    if slope > max_slope {
        return Err("This ground is too steep for grazing.".to_string());
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
        if zone_overlaps_building_footprint_at_yaw(
            &polygon,
            &building.kind,
            building.x,
            building.z,
            resolved_existing_building_yaw(road_network.as_ref(), &building),
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
    let pasture = ctx.db.pasture().insert(Pasture {
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
    // A legacy herd with no former fencing is deliberately deferred until its
    // first replacement parcel exists. Materialize it before creating any new
    // swine row so legacy stock can never be overwritten.
    crate::livestock_migration::migrate_legacy_livestock_herd_for_building(ctx, farmstead_id);
    if farmstead.kind == "swineherd"
        && ctx
            .db
            .pasture_herd()
            .pasture_id()
            .find(&pasture.id)
            .is_none()
    {
        ctx.db
            .pasture_herd()
            .insert(unstocked_pasture_herd(&pasture, SPECIES_SWINE));
    }
    Ok(())
}

#[reducer]
pub fn set_livestock_species(
    ctx: &ReducerContext,
    pasture_id: u64,
    species: u8,
) -> Result<(), String> {
    if !matches!(species, SPECIES_CATTLE | SPECIES_SHEEP | SPECIES_HORSE) {
        return Err("Pastoral pastures can hold cattle, sheep, or horses.".to_string());
    }
    let pasture = ctx
        .db
        .pasture()
        .id()
        .find(&pasture_id)
        .ok_or_else(|| "Pasture not found.".to_string())?;
    let building = ctx
        .db
        .building()
        .id()
        .find(&pasture.farmstead_id)
        .ok_or_else(|| "Pastoral farmstead not found.".to_string())?;
    if pasture.owner != ctx.sender()
        || building.owner != ctx.sender()
        || building.kind != "pastoral_farmstead"
        || !building.construction_complete
    {
        return Err(
            "You do not own this pasture and its completed pastoral farmstead.".to_string(),
        );
    }
    let max_slope = match species {
        SPECIES_CATTLE => CATTLE_MAX_SLOPE_DEGREES,
        SPECIES_HORSE => HORSE_MAX_SLOPE_DEGREES,
        _ => SHEEP_MAX_SLOPE_DEGREES,
    };
    if pasture.average_slope_degrees > max_slope + 1e-6 {
        return Err(match species {
            SPECIES_CATTLE => "This pasture is too steep for cattle; choose sheep instead.",
            SPECIES_HORSE => "This pasture is too steep for horses.",
            _ => "This pasture is too steep for sheep.",
        }
        .to_string());
    }
    crate::livestock_migration::migrate_legacy_livestock_herd_for_building(
        ctx,
        pasture.farmstead_id,
    );
    let existing_herd = ctx.db.pasture_herd().pasture_id().find(&pasture_id);
    let Some(mut herd) = existing_herd else {
        ctx.db
            .pasture_herd()
            .insert(unstocked_pasture_herd(&pasture, species));
        return Ok(());
    };
    if herd.species == species {
        return Ok(());
    }
    let attached_horses = ctx
        .db
        .cavalry_horse()
        .pasture_id()
        .filter(&pasture_id)
        .next()
        .is_some();
    if herd.head_count > 0 || attached_horses {
        return Err("Sell this pasture's current herd before changing its species.".to_string());
    }
    herd.species = species;
    herd.head_count = 0;
    herd.present_head_count = 0;
    herd.health = 0.82;
    herd.breeding_progress = 0.0;
    herd.pasture_capacity = 0.0;
    herd.supplied_capacity = 0.0;
    herd.last_food_output = 0.0;
    herd.last_preserved_output = 0.0;
    herd.last_wool_gold = 0.0;
    herd.last_wool_output = 0.0;
    herd.last_shearing_year = 0;
    herd.last_milking_period = 0;
    herd.breeding_reserve = default_breeding_reserve(species);
    herd.last_culled = 0;
    herd.last_hay_output = 0.0;
    herd.haymaking_percent = LIVESTOCK_DEFAULT_HAYMAKING_PERCENT;
    ctx.db.pasture_herd().pasture_id().update(herd);
    Ok(())
}

/// Buy or sell whole animals at one pasture. Positive deltas purchase regional
/// breeding stock with civic gold; negative deltas sell live animals back to
/// drovers. Purchases may never exceed this parcel's neutral carrying capacity,
/// its species ceiling, or the linked holding's shared management budget.
#[reducer]
pub fn trade_livestock(
    ctx: &ReducerContext,
    pasture_id: u64,
    head_delta: i32,
) -> Result<(), String> {
    if head_delta == 0 || !(-100..=100).contains(&head_delta) {
        return Err("Livestock orders must change between 1 and 100 head.".to_string());
    }
    let owner = ctx.sender();
    let pasture = ctx
        .db
        .pasture()
        .id()
        .find(&pasture_id)
        .ok_or_else(|| "Pasture not found.".to_string())?;
    let building = ctx
        .db
        .building()
        .id()
        .find(&pasture.farmstead_id)
        .ok_or_else(|| "Livestock holding not found.".to_string())?;
    if pasture.owner != owner
        || building.owner != owner
        || !matches!(building.kind.as_str(), "pastoral_farmstead" | "swineherd")
        || !building.construction_complete
    {
        return Err("You do not own this completed livestock holding.".to_string());
    }
    crate::livestock_migration::migrate_legacy_livestock_herd_for_building(
        ctx,
        pasture.farmstead_id,
    );
    let mut herd = ctx
        .db
        .pasture_herd()
        .pasture_id()
        .find(&pasture_id)
        .ok_or_else(|| "Choose this pasture's herd species before ordering animals.".to_string())?;

    if head_delta > 0 {
        let quantity = head_delta as u32;
        let land_limit = grazing_capacity_for_pasture(ctx, &pasture, &herd)
            .floor()
            .clamp(0.0, u32::MAX as f64) as u32;
        let parcel_limit = maximum_herd(herd.species).min(land_limit);
        let used_management = holding_management_units(ctx, pasture.farmstead_id);
        let management_room = management_headroom(&building.kind, used_management, herd.species);
        let available = parcel_limit
            .saturating_sub(herd.head_count)
            .min(management_room);
        if quantity > available {
            return Err(format!(
                "This pasture and its holding have room for only {available} more head ({} on this parcel by land and species capacity).",
                parcel_limit
            ));
        }
        let cost = purchase_gold_per_head(herd.species) * f64::from(quantity);
        spend_treasury_gold(ctx, owner, cost)?;
        let was_empty = herd.head_count == 0;
        if herd.species == SPECIES_HORSE {
            let existing = ctx
                .db
                .cavalry_horse()
                .pasture_id()
                .filter(&pasture_id)
                .collect::<Vec<_>>();
            let mut open_slots = (0..HORSE_MAX_HERD as u8)
                .filter(|slot| !existing.iter().any(|horse| horse.slot == *slot));
            for _ in 0..quantity {
                let slot = open_slots
                    .next()
                    .ok_or_else(|| "This horse pasture has no open roster place.".to_string())?;
                ctx.db.cavalry_horse().insert(CavalryHorse {
                    id: 0,
                    owner,
                    pasture_id,
                    slot,
                    at_pasture: true,
                    assigned_company_id: 0,
                    assigned_combat_agent_id: 0,
                });
            }
            herd.head_count += quantity;
            herd.present_head_count += quantity;
        } else {
            herd.head_count += quantity;
            herd.present_head_count = herd.head_count;
        }
        if was_empty {
            herd.health = 0.82;
            herd.breeding_progress = 0.0;
        }
    } else {
        let quantity = (-i64::from(head_delta)) as u32;
        let available_horses = (herd.species == SPECIES_HORSE).then(|| {
            let mut horses = ctx
                .db
                .cavalry_horse()
                .pasture_id()
                .filter(&pasture_id)
                .filter(|horse| {
                    horse.at_pasture
                        && horse.assigned_company_id == 0
                        && horse.assigned_combat_agent_id == 0
                })
                .collect::<Vec<_>>();
            horses.sort_by_key(|horse| (horse.slot, horse.id));
            horses
        });
        let available = available_horses
            .as_ref()
            .map_or(herd.head_count, |horses| horses.len() as u32);
        if quantity > available {
            return Err(format!(
                "Only {available} head are physically in this pasture and available to sell."
            ));
        }
        let previous_heads = herd.head_count;
        if let Some(horses) = available_horses {
            for horse in horses.into_iter().take(quantity as usize) {
                ctx.db.cavalry_horse().id().delete(horse.id);
            }
            herd.head_count = herd.head_count.saturating_sub(quantity);
            herd.present_head_count = herd.present_head_count.saturating_sub(quantity);
        } else {
            herd.head_count -= quantity;
            herd.present_head_count = herd.head_count;
        }
        herd.supplied_capacity = herd.supplied_capacity.min(f64::from(herd.head_count));
        if herd.species == SPECIES_HORSE {
            herd.breeding_progress = 0.0;
        } else {
            herd.breeding_progress = retained_livestock_breeding_progress(
                herd.breeding_progress,
                previous_heads,
                herd.head_count,
            );
        }
        credit_treasury_gold(
            ctx,
            owner,
            sale_gold_per_head(herd.species) * f64::from(quantity),
        );
    }

    ctx.db.pasture_herd().pasture_id().update(herd);
    Ok(())
}

#[reducer]
pub fn set_livestock_breeding_reserve(
    ctx: &ReducerContext,
    pasture_id: u64,
    breeding_reserve: u32,
) -> Result<(), String> {
    let pasture = ctx
        .db
        .pasture()
        .id()
        .find(&pasture_id)
        .ok_or_else(|| "Pasture not found.".to_string())?;
    let building = ctx
        .db
        .building()
        .id()
        .find(&pasture.farmstead_id)
        .ok_or_else(|| "Livestock holding not found.".to_string())?;
    if pasture.owner != ctx.sender()
        || building.owner != ctx.sender()
        || !matches!(building.kind.as_str(), "pastoral_farmstead" | "swineherd")
        || !building.construction_complete
    {
        return Err("You do not own this completed livestock holding.".to_string());
    }
    crate::livestock_migration::migrate_legacy_livestock_herd_for_building(
        ctx,
        pasture.farmstead_id,
    );
    let mut herd = ctx
        .db
        .pasture_herd()
        .pasture_id()
        .find(&pasture_id)
        .ok_or_else(|| "Herd state not found.".to_string())?;
    let minimum = minimum_breeding_reserve(herd.species);
    let maximum = maximum_herd(herd.species);
    if breeding_reserve < minimum || breeding_reserve > maximum {
        return Err(format!(
            "Breeding reserve must be between {minimum} and {maximum} head."
        ));
    }
    herd.breeding_reserve = breeding_reserve;
    ctx.db.pasture_herd().pasture_id().update(herd);
    Ok(())
}

#[reducer]
pub fn set_livestock_haymaking_percent(
    ctx: &ReducerContext,
    pasture_id: u64,
    haymaking_percent: u8,
) -> Result<(), String> {
    let pasture = ctx
        .db
        .pasture()
        .id()
        .find(&pasture_id)
        .ok_or_else(|| "Pasture not found.".to_string())?;
    let building = ctx
        .db
        .building()
        .id()
        .find(&pasture.farmstead_id)
        .ok_or_else(|| "Pastoral farmstead not found.".to_string())?;
    if pasture.owner != ctx.sender()
        || building.owner != ctx.sender()
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
    crate::livestock_migration::migrate_legacy_livestock_herd_for_building(
        ctx,
        pasture.farmstead_id,
    );
    let mut herd = ctx
        .db
        .pasture_herd()
        .pasture_id()
        .find(&pasture_id)
        .ok_or_else(|| "Herd state not found.".to_string())?;
    if herd.species == SPECIES_SWINE {
        return Err("Woodland pigs use pannage rather than hay meadows.".to_string());
    }
    herd.haymaking_percent = haymaking_percent;
    ctx.db.pasture_herd().pasture_id().update(herd);
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
    crate::livestock_migration::migrate_legacy_livestock_herd_for_building(
        ctx,
        pasture.farmstead_id,
    );
    if ctx
        .db
        .cavalry_horse()
        .pasture_id()
        .filter(&pasture_id)
        .next()
        .is_some()
    {
        return Err(
            "Sell this pasture's horses after every mounted company has returned before removing its fencing."
                .to_string(),
        );
    }
    if let Some(herd) = ctx.db.pasture_herd().pasture_id().find(&pasture_id) {
        if herd.head_count > 0 {
            return Err("Sell this pasture's animals before removing its fencing.".to_string());
        }
        ctx.db.pasture_herd().pasture_id().delete(&pasture_id);
    }
    ctx.db.pasture().id().delete(pasture_id);
    Ok(())
}

pub fn unstocked_pasture_herd(pasture: &Pasture, species: u8) -> PastureHerd {
    PastureHerd {
        pasture_id: pasture.id,
        farmstead_id: pasture.farmstead_id,
        owner: pasture.owner,
        species,
        head_count: 0,
        present_head_count: 0,
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
        last_milking_period: 0,
    }
}

pub(crate) fn management_units_per_head(species: u8) -> u32 {
    match species {
        SPECIES_CATTLE => CATTLE_MANAGEMENT_UNITS_PER_HEAD,
        SPECIES_SHEEP => SHEEP_MANAGEMENT_UNITS_PER_HEAD,
        SPECIES_HORSE => HORSE_MANAGEMENT_UNITS_PER_HEAD,
        _ => SWINE_MANAGEMENT_UNITS_PER_HEAD,
    }
}

pub(crate) fn management_capacity_units(building_kind: &str) -> u32 {
    if building_kind == "swineherd" {
        SWINE_MANAGEMENT_UNITS
    } else {
        PASTORAL_MANAGEMENT_UNITS
    }
}

pub(crate) fn management_headroom(building_kind: &str, used_units: u32, species: u8) -> u32 {
    management_capacity_units(building_kind).saturating_sub(used_units)
        / management_units_per_head(species).max(1)
}

pub(crate) fn holding_management_units(ctx: &ReducerContext, farmstead_id: u64) -> u32 {
    ctx.db
        .pasture_herd()
        .farmstead_id()
        .filter(&farmstead_id)
        .map(|herd| {
            herd.head_count
                .saturating_mul(management_units_per_head(herd.species))
        })
        .sum()
}

fn minimum_breeding_reserve(species: u8) -> u32 {
    match species {
        SPECIES_CATTLE => CATTLE_MINIMUM_BREEDING_RESERVE,
        SPECIES_SHEEP => SHEEP_MINIMUM_BREEDING_RESERVE,
        SPECIES_HORSE => 1,
        _ => SWINE_MINIMUM_BREEDING_RESERVE,
    }
}

fn default_breeding_reserve(species: u8) -> u32 {
    match species {
        SPECIES_CATTLE => CATTLE_DEFAULT_BREEDING_RESERVE,
        SPECIES_SHEEP => SHEEP_DEFAULT_BREEDING_RESERVE,
        SPECIES_HORSE => HORSE_MAX_HERD,
        _ => SWINE_DEFAULT_BREEDING_RESERVE,
    }
}

fn maximum_herd(species: u8) -> u32 {
    match species {
        SPECIES_CATTLE => CATTLE_MAX_HERD,
        SPECIES_SHEEP => SHEEP_MAX_HERD,
        SPECIES_HORSE => HORSE_MAX_HERD,
        _ => SWINE_MAX_HERD,
    }
}

fn purchase_gold_per_head(species: u8) -> f64 {
    match species {
        SPECIES_CATTLE => CATTLE_PURCHASE_GOLD_PER_HEAD,
        SPECIES_SHEEP => SHEEP_PURCHASE_GOLD_PER_HEAD,
        SPECIES_HORSE => HORSE_PURCHASE_GOLD_PER_HEAD,
        _ => SWINE_PURCHASE_GOLD_PER_HEAD,
    }
}

fn sale_gold_per_head(species: u8) -> f64 {
    match species {
        SPECIES_CATTLE => CATTLE_SALE_GOLD_PER_HEAD,
        SPECIES_SHEEP => SHEEP_SALE_GOLD_PER_HEAD,
        SPECIES_HORSE => HORSE_SALE_GOLD_PER_HEAD,
        _ => SWINE_SALE_GOLD_PER_HEAD,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        management_headroom, management_units_per_head, SPECIES_CATTLE, SPECIES_HORSE,
        SPECIES_SHEEP, SPECIES_SWINE,
    };

    #[test]
    fn shared_management_budget_preserves_species_equivalence() {
        assert_eq!(
            management_headroom("pastoral_farmstead", 0, SPECIES_CATTLE),
            20
        );
        assert_eq!(
            management_headroom("pastoral_farmstead", 0, SPECIES_SHEEP),
            60
        );
        assert_eq!(management_headroom("swineherd", 0, SPECIES_SWINE), 30);
        assert_eq!(management_headroom("pastoral_farmstead", 0, SPECIES_HORSE), 30);

        let mixed_used = 10 * management_units_per_head(SPECIES_CATTLE)
            + 15 * management_units_per_head(SPECIES_SHEEP);
        assert_eq!(
            management_headroom("pastoral_farmstead", mixed_used, SPECIES_CATTLE),
            5
        );
        assert_eq!(
            management_headroom("pastoral_farmstead", mixed_used, SPECIES_SHEEP),
            15
        );
    }
}
