use spacetimedb::{reducer, ReducerContext, Table};

use crate::balance_generated::{CARPENTER_TIMBER_COST_MULTIPLIER, TOWN_HALL_POPULATION_REQUIRED};
use crate::building_defs::{building_def, building_def_or_err};
use crate::burgage::{zone_overlaps_footprint, Point2};
use crate::db::*;
use crate::economy::{
    assign_building_labor as set_building_labor, available_building_labor, building_cost,
    building_salvage_refund, chapel_coffer_gold, collect_chapel_coffer as sweep_chapel_coffer,
    construction_treasury_reservation, credit_treasury_commodity, credit_treasury_firewood,
    credit_treasury_food, credit_treasury_gold, credit_treasury_stone, credit_treasury_timber,
    credit_treasury_water, initial_construction_labor, total_stone, total_timber, CommodityKind,
};
use crate::hydrology::{sample_hydrology_score, well_capacity_from_hydrology};
use crate::lifecycle::ensure_player_resources;
use crate::placement_validation::{
    building_overlaps_open_water, building_overlaps_residence_zone, building_overlaps_road_surface,
    building_site_contains_point, is_near_open_water, is_on_quarry_pit, is_open_water,
};
use crate::roads::load_owner_road_network;
use crate::simulation::{
    building_fire_state, clear_fire_for_target, drain_trips_for_building, FIRE_TARGET_BUILDING,
};
use crate::tables::{farm_field, livestock_herd, pasture, Building, WorldConfig};

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
    let Some(def) = building_def(kind) else {
        return false;
    };
    ctx.db.farm_field().iter().any(|field| {
        let polygon = [
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
        zone_overlaps_footprint(&polygon, x, z, def.pick_radius)
    })
}

fn building_overlaps_pasture(ctx: &ReducerContext, kind: &str, x: f64, z: f64) -> bool {
    let Some(def) = building_def(kind) else {
        return false;
    };
    ctx.db.pasture().iter().any(|pasture| {
        let polygon = [
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

fn has_rich_quarry_at_center(ctx: &ReducerContext, x: f64, z: f64) -> bool {
    const CENTER_TOLERANCE: f64 = 2.5;
    let tolerance_sq = CENTER_TOLERANCE * CENTER_TOLERANCE;
    ctx.db.quarry().iter().any(|quarry| {
        quarry.is_rich
            && (quarry.x - x) * (quarry.x - x) + (quarry.z - z) * (quarry.z - z) <= tolerance_sq
    })
}

fn has_foraging_in_radius(
    ctx: &ReducerContext,
    x: f64,
    z: f64,
    radius: f64,
    node_kind: &str,
    include_depleted: bool,
) -> bool {
    let radius_sq = radius * radius;
    for node in ctx.db.foraging_node().iter() {
        if node.node_kind != node_kind || (!include_depleted && node.remaining <= 0.0) {
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

    if kind != "large_quarry" && is_on_quarry_pit(ctx, x, z) {
        return Err("Cannot build on a quarry pit.".to_string());
    }

    // Quarry generation now guarantees a dry padded pit. Do not let the coarse,
    // static server hydrology grid falsely reject a visually dry stonecutter site.
    if kind != "large_quarry" && is_open_water(x, z) {
        return Err(if kind == "well" {
            "Cannot build a well on open water.".to_string()
        } else {
            "Cannot build on water.".to_string()
        });
    }
    if kind == "fishing_camp" && building_overlaps_open_water(&kind, x, z) {
        return Err("The entire fishing camp must stand on dry land.".to_string());
    }

    if def.requires_water_shore && !is_near_open_water(x, z, 24.0) {
        return Err("This building must be placed on a river or lake shore.".to_string());
    }

    // Parsing and indexing the serialized road graph is one of the more expensive
    // placement checks. Reuse one snapshot for overlap, landmark, and carpenter checks.
    let road_network = load_owner_road_network(ctx, owner);

    if matches!(kind.as_str(), "watchtower" | "guardhouse") {
        let conflict_enabled = ctx
            .db
            .world_config()
            .id()
            .find(&0)
            .is_some_and(|config| config.conflict_enabled && config.enemy_pressure > 0);
        if !conflict_enabled {
            return Err(
                "Frontier defenses are only available in contested-frontier worlds.".to_string(),
            );
        }
    }

    if kind == "guardhouse"
        && !ctx
            .db
            .building()
            .owner()
            .filter(&owner)
            .any(|building| building.kind == "watchtower" && building.construction_complete)
    {
        return Err(
            "Complete a frontier watchtower before establishing a paid guardhouse.".to_string(),
        );
    }

    if kind == "monastery" {
        let staffed_chapel = ctx.db.building().owner().filter(&owner).any(|building| {
            building.kind == "chapel"
                && building.construction_complete
                && building.assigned_labor > 0
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
            return Err(
                "The parish needs at least 12 residents before founding a monastery.".to_string(),
            );
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
            .find(|building| building.kind == "chapel" && building.construction_complete)
            .ok_or_else(|| "Build a chapel before founding the Town Hall.".to_string())?;
        let marketplace = ctx
            .db
            .building()
            .owner()
            .filter(&owner)
            .find(|building| building.kind == "marketplace" && building.construction_complete)
            .ok_or_else(|| "Build a marketplace before founding the Town Hall.".to_string())?;
        let network = road_network
            .as_ref()
            .ok_or_else(|| "The Town Hall requires a road network.".to_string())?;
        if network
            .road_path_distance(x, z, chapel.x, chapel.z)
            .is_none()
            || network
                .road_path_distance(x, z, marketplace.x, marketplace.z)
                .is_none()
        {
            return Err(
                "The Town Hall must be road-linked to both the chapel and marketplace.".to_string(),
            );
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

    if road_network
        .as_ref()
        .is_some_and(|network| building_overlaps_road_surface(network, &kind, x, z))
    {
        return Err("Cannot build on a road.".to_string());
    }

    if overlaps_same_kind_functional_extent(ctx, &kind, x, z) {
        return Err(
            "Another building of the same type already covers this functional extent.".to_string(),
        );
    }

    if def.requires_mature_trees && !has_mature_tree_in_radius(ctx, x, z, def.work_radius) {
        return Err("No mature trees within work range.".to_string());
    }

    if def.requires_quarry_stone && !has_quarry_stone_in_radius(ctx, x, z, def.work_radius) {
        return Err("No quarry stone within work range.".to_string());
    }

    if kind == "large_quarry" && !has_rich_quarry_at_center(ctx, x, z) {
        return Err(
            "Large Quarries must be placed directly over a rich stone deposit.".to_string(),
        );
    }

    if def.requires_game && !has_foraging_in_radius(ctx, x, z, def.work_radius, "game", false) {
        return Err("No game within work range.".to_string());
    }

    if def.requires_berries
        && !has_foraging_in_radius(ctx, x, z, def.work_radius, "berries", true)
        && !has_foraging_in_radius(ctx, x, z, def.work_radius, "mushrooms", true)
    {
        return Err("No berries or mushrooms within work range.".to_string());
    }

    if def.requires_fish && !has_foraging_in_radius(ctx, x, z, def.work_radius, "fish", false) {
        return Err("No fish shoal within work range.".to_string());
    }

    if is_too_close_to_buildings(ctx, &kind, x, z) {
        return Err("Too close to another building.".to_string());
    }

    let cost = building_cost(&kind)?;
    let carpenter_discount = road_network
        .as_ref()
        .map(|network| {
            ctx.db.building().owner().filter(&owner).any(|shop| {
                shop.kind == "carpenter"
                    && shop.construction_complete
                    && shop.assigned_labor > 0
                    && network.road_path_distance(x, z, shop.x, shop.z).is_some()
            })
        })
        .unwrap_or(false);
    let timber_cost = cost.timber
        * if carpenter_discount {
            CARPENTER_TIMBER_COST_MULTIPLIER
        } else {
            1.0
        };
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
    let (treasury_timber, treasury_stone) =
        construction_treasury_reservation(ctx, owner, timber_cost, cost.stone);
    let assigned_builders = initial_construction_labor(available_building_labor(ctx, owner));

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
    ctx.db.building().insert(Building {
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
        polearms: 0.0,
        water_capacity,
        assigned_labor: assigned_builders,
        construction_complete: false,
        construction_progress: 0.0,
        construction_required_timber: timber_cost,
        construction_required_stone: cost.stone,
        construction_delivered_timber: 0.0,
        construction_delivered_stone: 0.0,
        construction_reserved_timber: timber_cost,
        construction_reserved_stone: cost.stone,
        construction_treasury_timber: treasury_timber,
        construction_treasury_stone: treasury_stone,
        storehouse_accepts_timber: true,
        storehouse_accepts_stone: true,
        storehouse_accepts_firewood: true,
        granary_accepts_fresh_food: true,
        gold: 0.0,
    });

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
    if building.owner != owner
        || building.kind != "village_storehouse"
        || !building.construction_complete
    {
        return Err("You do not own this village storehouse.".to_string());
    }
    building.storehouse_accepts_timber = accepts_timber;
    building.storehouse_accepts_stone = accepts_stone;
    building.storehouse_accepts_firewood = accepts_firewood;
    ctx.db.building().id().update(building);
    Ok(())
}

#[reducer]
pub fn set_granary_policy(
    ctx: &ReducerContext,
    building_id: u64,
    accepts_fresh_food: bool,
) -> Result<(), String> {
    let owner = ctx.sender();
    let mut building = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Granary not found.".to_string())?;
    if building.owner != owner
        || building.kind != "granary"
        || !building.construction_complete
    {
        return Err("You do not own this village granary.".to_string());
    }
    building.granary_accepts_fresh_food = accepts_fresh_food;
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
        && ctx
            .db
            .farm_field()
            .farmstead_id()
            .filter(&building_id)
            .next()
            .is_some()
    {
        return Err("Remove or reassign this farmstead's fields first.".to_string());
    }
    if matches!(building.kind.as_str(), "pastoral_farmstead" | "swineherd")
        && ctx
            .db
            .pasture()
            .farmstead_id()
            .filter(&building_id)
            .next()
            .is_some()
    {
        return Err("Remove this livestock building's pastures first.".to_string());
    }

    let fire_damaged = building_fire_state(ctx, building_id).is_some();
    let trip_cargo = drain_trips_for_building(ctx, building_id);
    clear_fire_for_target(ctx, FIRE_TARGET_BUILDING, building_id);

    let refund = if fire_damaged {
        crate::economy::ResourceAmount {
            timber: 0.0,
            stone: 0.0,
        }
    } else if building.construction_complete {
        building_salvage_refund(&building.kind)?
    } else {
        crate::economy::ResourceAmount {
            timber: (building.construction_delivered_timber
                * crate::balance_generated::TIMBER_SALVAGE_FRACTION)
                .round(),
            stone: (building.construction_delivered_stone
                * crate::balance_generated::STONE_SALVAGE_FRACTION)
                .round(),
        }
    };
    let recoverable = if fire_damaged { 0.0 } else { 1.0 };
    credit_treasury_timber(
        ctx,
        owner,
        refund.timber + (building.timber + trip_cargo.timber) * recoverable,
    );
    credit_treasury_stone(
        ctx,
        owner,
        refund.stone + (building.stone + trip_cargo.stone) * recoverable,
    );
    credit_treasury_firewood(
        ctx,
        owner,
        (building.firewood + trip_cargo.firewood) * recoverable,
    );
    credit_treasury_water(
        ctx,
        owner,
        (building.water + trip_cargo.water) * recoverable,
    );
    credit_treasury_food(ctx, owner, (building.food + trip_cargo.food) * recoverable);
    credit_treasury_gold(ctx, owner, chapel_coffer_gold(&building) * recoverable);
    credit_treasury_commodity(
        ctx,
        owner,
        CommodityKind::Grain,
        (building.grain + trip_cargo.grain) * recoverable,
    );
    credit_treasury_commodity(
        ctx,
        owner,
        CommodityKind::Flour,
        (building.flour + trip_cargo.flour) * recoverable,
    );
    credit_treasury_commodity(
        ctx,
        owner,
        CommodityKind::Ale,
        (building.ale + trip_cargo.ale) * recoverable,
    );
    credit_treasury_commodity(
        ctx,
        owner,
        CommodityKind::PreservedFood,
        (building.preserved_food + trip_cargo.preserved_food) * recoverable,
    );
    credit_treasury_commodity(
        ctx,
        owner,
        CommodityKind::Honey,
        (building.honey + trip_cargo.honey) * recoverable,
    );
    credit_treasury_commodity(
        ctx,
        owner,
        CommodityKind::Wine,
        (building.wine + trip_cargo.wine) * recoverable,
    );
    credit_treasury_commodity(
        ctx,
        owner,
        CommodityKind::Polearms,
        (building.polearms + trip_cargo.polearms) * recoverable,
    );

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
