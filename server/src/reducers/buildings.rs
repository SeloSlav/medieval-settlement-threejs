use spacetimedb::{reducer, ReducerContext, Table};

use crate::building_defs::{building_def, building_def_or_err};
use crate::burgage::{zone_overlaps_footprint, Point2};
use crate::balance_generated::{CARPENTER_TIMBER_COST_MULTIPLIER, TOWN_HALL_POPULATION_REQUIRED};
use crate::db::*;
use crate::economy::{
    assign_building_labor as set_building_labor, building_cost, building_salvage_refund,
    chapel_coffer_gold, collect_chapel_coffer as sweep_chapel_coffer, credit_treasury_firewood,
    credit_treasury_food, credit_treasury_gold, credit_treasury_stone, credit_treasury_timber,
    credit_treasury_water, spend_aggregate_stone, spend_aggregate_timber, total_stone, total_timber,
    credit_treasury_commodity, CommodityKind,
};
use crate::lifecycle::ensure_player_resources;
use crate::hydrology::{sample_hydrology_score, well_capacity_from_hydrology};
use crate::placement_validation::{
    building_overlaps_residence_zone, building_overlaps_road_surface,
    building_site_contains_point, is_near_open_water, is_on_quarry_pit, is_open_water,
};
use crate::roads::load_owner_road_network;
use crate::simulation::drain_trips_for_building;
use crate::tables::{farm_field, livestock_herd, pasture, Building, WorldConfig};
use crate::reducers::livestock::{starter_herd, SPECIES_CATTLE, SPECIES_SWINE};

fn overlaps_same_kind_functional_extent(ctx: &ReducerContext, kind: &str, x: f64, z: f64) -> bool {
    let Some(def) = building_def(kind) else {
        return false;
    };
    if def.work_radius <= 0.0 {
        return false;
    }

    for building in ctx.db.building().iter() {
        if building.kind != kind {
            continue;
        }
        let dx = building.x - x;
        let dz = building.z - z;
        if dx * dx + dz * dz < def.work_radius * def.work_radius {
            return true;
        }
    }
    false
}

fn is_too_close_to_buildings(ctx: &ReducerContext, kind: &str, x: f64, z: f64) -> bool {
    let Some(candidate) = building_def(kind) else {
        return false;
    };
    let min_separation = candidate.pick_radius * 1.85;

    for building in ctx.db.building().iter() {
        let Some(other) = building_def(&building.kind) else {
            continue;
        };
        let required = min_separation.max((candidate.pick_radius + other.pick_radius) * 0.9);
        let dx = building.x - x;
        let dz = building.z - z;
        if dx * dx + dz * dz < required * required {
            return true;
        }
    }
    false
}

fn building_overlaps_farm_field(ctx: &ReducerContext, kind: &str, x: f64, z: f64) -> bool {
    let Some(def) = building_def(kind) else { return false; };
    ctx.db.farm_field().iter().any(|field| {
        let polygon = [
            Point2 { x: field.corner_ax, z: field.corner_az },
            Point2 { x: field.corner_bx, z: field.corner_bz },
            Point2 { x: field.corner_cx, z: field.corner_cz },
            Point2 { x: field.corner_dx, z: field.corner_dz },
        ];
        zone_overlaps_footprint(&polygon, x, z, def.pick_radius)
    })
}

fn building_overlaps_pasture(ctx: &ReducerContext, kind: &str, x: f64, z: f64) -> bool {
    let Some(def) = building_def(kind) else { return false; };
    ctx.db.pasture().iter().any(|pasture| {
        let polygon = [
            Point2 { x: pasture.corner_ax, z: pasture.corner_az },
            Point2 { x: pasture.corner_bx, z: pasture.corner_bz },
            Point2 { x: pasture.corner_cx, z: pasture.corner_cz },
            Point2 { x: pasture.corner_dx, z: pasture.corner_dz },
        ];
        zone_overlaps_footprint(&polygon, x, z, def.pick_radius)
    })
}

fn has_mature_tree_in_radius(ctx: &ReducerContext, x: f64, z: f64, radius: f64) -> bool {
    let radius_sq = radius * radius;
    for tree in ctx.db.tree_entity().iter() {
        if tree.phase != "mature" {
            continue;
        }
        let dx = tree.x - x;
        let dz = tree.z - z;
        if dx * dx + dz * dz <= radius_sq {
            return true;
        }
    }
    false
}

fn has_quarry_stone_in_radius(ctx: &ReducerContext, x: f64, z: f64, radius: f64) -> bool {
    let radius_sq = radius * radius;
    for quarry in ctx.db.quarry().iter() {
        if quarry.remaining <= 0.0 {
            continue;
        }
        let dx = quarry.x - x;
        let dz = quarry.z - z;
        if dx * dx + dz * dz <= radius_sq {
            return true;
        }
    }
    false
}

fn has_foraging_in_radius(
    ctx: &ReducerContext,
    x: f64,
    z: f64,
    radius: f64,
    node_kind: &str,
) -> bool {
    let radius_sq = radius * radius;
    for node in ctx.db.foraging_node().iter() {
        if node.node_kind != node_kind || node.remaining <= 0.0 {
            continue;
        }
        let dx = node.x - x;
        let dz = node.z - z;
        if dx * dx + dz * dz <= radius_sq {
            return true;
        }
    }
    false
}

#[reducer]
pub fn place_building(ctx: &ReducerContext, kind: String, x: f64, z: f64) -> Result<(), String> {
    let def = building_def_or_err(&kind)?;
    let owner = ctx.sender();
    ensure_player_resources(ctx, owner);

    if !def.requires_quarry_stone && is_on_quarry_pit(ctx, x, z) {
        return Err("Cannot build on a quarry pit.".to_string());
    }

    if is_open_water(x, z) {
        return Err(if kind == "well" {
            "Cannot build a well on open water.".to_string()
        } else {
            "Cannot build on water.".to_string()
        });
    }

    if def.requires_water_shore && !is_near_open_water(x, z, 24.0) {
        return Err("This building must be placed on a river or lake shore.".to_string());
    }

    if kind == "monastery" {
        let staffed_chapel = ctx.db.building().owner().filter(&owner).any(|building| {
            building.kind == "chapel" && building.assigned_labor > 0
        });
        if !staffed_chapel {
            return Err("A staffed chapel is required before founding a monastery.".to_string());
        }
        let parish_population: u32 = ctx
            .db
            .residence()
            .owner()
            .filter(&owner)
            .map(|residence| residence.population)
            .sum();
        if parish_population < 12 {
            return Err("The parish needs at least 12 residents before founding a monastery.".to_string());
        }
    }

    if kind == "town_hall" {
        if ctx
            .db
            .building()
            .owner()
            .filter(&owner)
            .any(|building| building.kind == "town_hall")
        {
            return Err("Only one Town Hall may serve a settlement.".to_string());
        }
        let population: u32 = ctx
            .db
            .residence()
            .owner()
            .filter(&owner)
            .map(|residence| residence.population)
            .sum();
        if population < TOWN_HALL_POPULATION_REQUIRED {
            return Err(format!(
                "The settlement needs at least {TOWN_HALL_POPULATION_REQUIRED} residents before building a Town Hall."
            ));
        }
        let chapel = ctx
            .db
            .building()
            .owner()
            .filter(&owner)
            .find(|building| building.kind == "chapel")
            .ok_or_else(|| "Build a chapel before founding the Town Hall.".to_string())?;
        let marketplace = ctx
            .db
            .building()
            .owner()
            .filter(&owner)
            .find(|building| building.kind == "marketplace")
            .ok_or_else(|| "Build a marketplace before founding the Town Hall.".to_string())?;
        let network = load_owner_road_network(ctx, owner)
            .ok_or_else(|| "The Town Hall requires a road network.".to_string())?;
        if network.road_path_distance(x, z, chapel.x, chapel.z).is_none()
            || network
                .road_path_distance(x, z, marketplace.x, marketplace.z)
                .is_none()
        {
            return Err("The Town Hall must be road-linked to both the chapel and marketplace.".to_string());
        }
    }

    if building_overlaps_residence_zone(ctx, &kind, x, z) {
        return Err("Cannot build inside a residence plot.".to_string());
    }
    if building_overlaps_farm_field(ctx, &kind, x, z) {
        return Err("Cannot build inside cultivated farmland.".to_string());
    }
    if building_overlaps_pasture(ctx, &kind, x, z) {
        return Err("Cannot build inside a fenced pasture.".to_string());
    }

    if building_overlaps_road_surface(ctx, owner, &kind, x, z) {
        return Err("Cannot build on a road.".to_string());
    }

    if overlaps_same_kind_functional_extent(ctx, &kind, x, z) {
        return Err("Another building of the same type already covers this functional extent.".to_string());
    }

    if def.requires_mature_trees && !has_mature_tree_in_radius(ctx, x, z, def.work_radius) {
        return Err("No mature trees within work range.".to_string());
    }

    if def.requires_quarry_stone && !has_quarry_stone_in_radius(ctx, x, z, def.work_radius) {
        return Err("No quarry stone within work range.".to_string());
    }

    if def.requires_game && !has_foraging_in_radius(ctx, x, z, def.work_radius, "game") {
        return Err("No game within work range.".to_string());
    }

    if def.requires_berries && !has_foraging_in_radius(ctx, x, z, def.work_radius, "berries") {
        return Err("No berries within work range.".to_string());
    }

    if is_too_close_to_buildings(ctx, &kind, x, z) {
        return Err("Too close to another building.".to_string());
    }

    let cost = building_cost(&kind)?;
    let carpenter_discount = load_owner_road_network(ctx, owner).map(|network| {
        ctx.db.building().owner().filter(&owner).any(|shop| shop.kind == "carpenter" && shop.assigned_labor > 0
            && network.road_path_distance(x, z, shop.x, shop.z).is_some())
    }).unwrap_or(false);
    let timber_cost = cost.timber * if carpenter_discount { CARPENTER_TIMBER_COST_MULTIPLIER } else { 1.0 };
    if total_timber(ctx, owner) + 1e-6 < timber_cost {
        return Err(format!(
            "Not enough timber (need {} timber).",
            timber_cost.round() as i64
        ));
    }
    if total_stone(ctx, owner) + 1e-6 < cost.stone {
        return Err(format!(
            "Not enough stone (need {} stone).",
            cost.stone.round() as i64
        ));
    }
    spend_aggregate_timber(ctx, owner, timber_cost)?;
    spend_aggregate_stone(ctx, owner, cost.stone)?;

    let config = ctx
        .db
        .world_config()
        .id()
        .find(&0)
        .ok_or_else(|| "World not initialized.".to_string())?;

    let hydrology = if kind == "well" {
        sample_hydrology_score(x, z)
    } else {
        0.0
    };
    let water_capacity = if kind == "well" {
        well_capacity_from_hydrology(def.storage_water, hydrology)
    } else {
        0.0
    };

    let cleared_tree_ids = ctx
        .db
        .tree_entity()
        .iter()
        .filter(|tree| building_site_contains_point(&kind, x, z, tree.x, tree.z))
        .map(|tree| tree.tree_id)
        .collect::<Vec<_>>();
    for tree_id in cleared_tree_ids {
        ctx.db.tree_entity().tree_id().delete(&tree_id);
    }

    let building_id = config.next_building_id;
    let inserted = ctx.db.building().insert(Building {
        id: 0,
        owner,
        kind,
        x,
        z,
        work_radius: def.work_radius,
        action_cooldown: 0.0,
        timber: 0.0,
        firewood: 0.0,
        stone: 0.0,
        water: 0.0,
        food: 0.0,
        grain: 0.0,
        flour: 0.0,
        ale: 0.0,
        preserved_food: 0.0,
        honey: 0.0,
        wine: 0.0,
        water_capacity,
        assigned_labor: 0,
        storehouse_accepts_timber: true,
        storehouse_accepts_stone: true,
        storehouse_accepts_firewood: true,
        gold: 0.0,
    });

    if inserted.kind == "pastoral_farmstead" {
        ctx.db
            .livestock_herd()
            .insert(starter_herd(inserted.id, owner, SPECIES_CATTLE));
    } else if inserted.kind == "swineherd" {
        ctx.db
            .livestock_herd()
            .insert(starter_herd(inserted.id, owner, SPECIES_SWINE));
    }

    ctx.db.world_config().id().update(WorldConfig {
        next_building_id: building_id + 1,
        ..config
    });

    Ok(())
}

#[reducer]
pub fn assign_building_labor(
    ctx: &ReducerContext,
    building_id: u64,
    labor: u32,
) -> Result<(), String> {
    let owner = ctx.sender();
    ensure_player_resources(ctx, owner);
    set_building_labor(ctx, owner, building_id, labor)
}

#[reducer]
pub fn set_storehouse_policy(
    ctx: &ReducerContext,
    building_id: u64,
    accepts_timber: bool,
    accepts_stone: bool,
    accepts_firewood: bool,
) -> Result<(), String> {
    let owner = ctx.sender();
    let mut building = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Storehouse not found.".to_string())?;
    if building.owner != owner || building.kind != "village_storehouse" {
        return Err("You do not own this village storehouse.".to_string());
    }
    building.storehouse_accepts_timber = accepts_timber;
    building.storehouse_accepts_stone = accepts_stone;
    building.storehouse_accepts_firewood = accepts_firewood;
    ctx.db.building().id().update(building);
    Ok(())
}

#[reducer]
pub fn collect_chapel_coffer(ctx: &ReducerContext, building_id: u64) -> Result<(), String> {
    let owner = ctx.sender();
    ensure_player_resources(ctx, owner);
    sweep_chapel_coffer(ctx, owner, building_id).map(|_| ())
}

#[reducer]
pub fn demolish_building(ctx: &ReducerContext, building_id: u64) -> Result<(), String> {
    let owner = ctx.sender();
    ensure_player_resources(ctx, owner);

    let building = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Building not found.".to_string())?;

    if building.owner != owner {
        return Err("You do not own this building.".to_string());
    }
    if building.kind == "threshing_barn"
        && ctx.db.farm_field().farmstead_id().filter(&building_id).next().is_some()
    {
        return Err("Remove or reassign this farmstead's fields first.".to_string());
    }
    if matches!(building.kind.as_str(), "pastoral_farmstead" | "swineherd")
        && ctx.db.pasture().farmstead_id().filter(&building_id).next().is_some()
    {
        return Err("Remove this livestock building's pastures first.".to_string());
    }

    let trip_cargo = drain_trips_for_building(ctx, building_id);

    let refund = building_salvage_refund(&building.kind)?;
    credit_treasury_timber(ctx, owner, refund.timber + building.timber + trip_cargo.timber);
    credit_treasury_stone(ctx, owner, refund.stone + building.stone + trip_cargo.stone);
    credit_treasury_firewood(ctx, owner, building.firewood + trip_cargo.firewood);
    credit_treasury_water(ctx, owner, building.water + trip_cargo.water);
    credit_treasury_food(ctx, owner, building.food + trip_cargo.food);
    credit_treasury_gold(ctx, owner, chapel_coffer_gold(&building));
    credit_treasury_commodity(ctx, owner, CommodityKind::Grain, building.grain + trip_cargo.grain);
    credit_treasury_commodity(ctx, owner, CommodityKind::Flour, building.flour + trip_cargo.flour);
    credit_treasury_commodity(ctx, owner, CommodityKind::Ale, building.ale + trip_cargo.ale);
    credit_treasury_commodity(
        ctx,
        owner,
        CommodityKind::PreservedFood,
        building.preserved_food + trip_cargo.preserved_food,
    );
    credit_treasury_commodity(ctx, owner, CommodityKind::Honey, building.honey + trip_cargo.honey);
    credit_treasury_commodity(ctx, owner, CommodityKind::Wine, building.wine + trip_cargo.wine);

    if ctx
        .db
        .livestock_herd()
        .building_id()
        .find(&building_id)
        .is_some()
    {
        ctx.db.livestock_herd().building_id().delete(&building_id);
    }
    ctx.db.building().id().delete(building_id);

    Ok(())
}
