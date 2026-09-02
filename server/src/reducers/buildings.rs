use std::collections::HashMap;

use spacetimedb::{reducer, ReducerContext, Table};

use crate::apiary_policy::is_valid_apiary_harvest_policy;
use crate::balance_generated::{
    CARPENTER_TIMBER_COST_MULTIPLIER, CONSTRUCTION_MAX_BUILDERS, GOLD_SALVAGE_FRACTION,
    TOWN_HALL_POPULATION_REQUIRED,
};
use crate::brewery_recipe_policy::{
    is_valid_brewery_recipe_policy, normalize_brewery_recipe_policy, BREWERY_RECIPE_AUTO,
    BREWERY_RECIPE_CIDER, BREWERY_RECIPE_MEAD, BREWERY_RECIPE_PEAR_CIDER,
};
use crate::building_defs::{building_def, building_def_or_err};
use crate::burgage::Point2;
use crate::chapel_upgrade_policy::{chapel_upgrade_cost, normalize_chapel_tier};
use crate::construction_priority::{
    construction_labor_ready, construction_labor_rotation,
    construction_labor_rotation_with_reserve, is_valid_construction_priority,
    ConstructionLaborRotation, ConstructionLaborSite, CONSTRUCTION_PRIORITY_HOLD,
    CONSTRUCTION_PRIORITY_NORMAL,
};
use crate::db::*;
use crate::economy::{
    assign_building_labor as set_building_labor, available_building_labor,
    available_workplace_labor, building_commodity_cap, building_commodity_stock, building_cost,
    building_salvage_refund, construction_treasury_reservation, credit_treasury_commodity,
    initial_construction_labor, preempt_flexible_labor_for_workplace_callup, spend_aggregate_ironwork,
    spend_aggregate_roof_tiles, spend_aggregate_stone, spend_aggregate_timber, spend_treasury_gold,
    total_ironwork, total_roof_tiles, total_stone, total_timber, CommodityKind,
};
use crate::extraction_policy::{
    mineworks_clay_commodity, mineworks_geological_commodity, mining_camp_clay_commodity,
    mining_camp_geological_commodity, quarry_geological_commodity,
};
use crate::farm_work_policy::is_valid_threshing_priority;
use crate::foraging_policy::harvest_available;
use crate::frontier_economy_policy::{
    is_valid_carpenter_polearm_reserve, CARPENTER_POLEARM_RESERVE_DEFAULT,
};
use crate::granary_policy::{
    is_valid_granary_fresh_food_target_percent, normalize_granary_grain_reserve,
    GRANARY_FRESH_FOOD_TARGET_DEFAULT_PERCENT,
};
use crate::harvest_reserve_policy::{
    default_harvest_reserve_percent, harvestable_wild_stock, normalize_harvest_reserve_percent,
};
use crate::hydrology::{sample_world_well_groundwater_score, well_capacity_from_hydrology};
use crate::labor_steward_policy::steward_deployable_labor;
use crate::lifecycle::ensure_player_resources;
use crate::livestock_policy::is_valid_milk_use_policy;
use crate::marketplace_procurement_policy::{
    is_valid_marketplace_gold_reserve_target, is_valid_marketplace_iron_target,
    is_valid_marketplace_ironwork_target, is_valid_marketplace_salt_target,
    is_valid_marketplace_seed_grain_target, MARKETPLACE_GOLD_RESERVE_DEFAULT,
};
use crate::monastery_estate_policy::{
    monastery_estate_fits_map, monastery_estate_is_near_map_edge,
    playable_half_for_monastery_map_size,
};
use crate::placement_validation::{
    building_footprints_too_close, building_overlaps_residence_zone,
    building_overlaps_resource_deposit, building_overlaps_road_surface,
    building_site_contains_point_at_yaw, resolved_building_placement_yaw,
    resolved_existing_building_yaw, zone_overlaps_building_footprint,
};
use crate::potter_firing_policy::{is_valid_potter_firing_policy, potter_fires_roof_tiles};
use crate::processor_labor_policy::{
    processor_callup_targets, production_steward_callup_allowed, ProcessorCallupCandidate,
};
use crate::processor_output_policy::{
    is_processor_output_target_kind, processor_input_kinds, processor_output_headroom,
    processor_output_kind, ProcessorInputKind, ProcessorOutputKind,
    PROCESSOR_OUTPUT_TARGET_DEFAULT_PERCENT,
};
use crate::production_rate_policy::{
    is_production_rate_kind, is_valid_production_rate_percent, DEFAULT_PRODUCTION_RATE_PERCENT,
};
use crate::resource_units::{whole_cost, whole_units};
use crate::roads::load_owner_road_network;
use crate::seasonal_labor_policy::seasonal_production_active;
use crate::simulation::{
    building_fire_state, building_has_active_trip, building_has_inbound_commodity_trip,
    building_has_inbound_supply_trip, call_up_active_seasonal_labor_for_settlement,
    cancel_inbound_construction_trips_for_site, clear_fire_for_target, drain_trips_for_building,
    game_clock, local_delivery_distance, preserve_in_transit_cart_labor,
    recall_idle_seasonal_labor_for_settlement, staffed_cart_workers_by_building, ReclamationStock,
    FIRE_TARGET_BUILDING,
};
use crate::smokehouse_recipe_policy::is_valid_smokehouse_recipe_policy;
use crate::specialty_trade_policy::{is_valid_specialty_export_policy, SpecialtyMarketFamily};
use crate::storage_acceptance_policy::{
    set_storage_masks_all, set_storage_masks_commodity, storage_kind_supports_commodity,
};
use crate::storehouse_policy::{
    is_valid_storehouse_stock_target_percent, STOREHOUSE_STOCK_TARGET_DEFAULT_PERCENT,
};
use crate::supply_policy::{
    is_valid_carpenter_cart_service_target, large_quarry_supports_ready, rich_mine_supports_ready,
    CARPENTER_CART_SERVICE_TARGET_DEFAULT,
};
use crate::tables::graveyard;
use crate::tables::{
    cavalry_horse, farm_field, livestock_herd, military_company, pasture, pasture_herd, Building,
    ForagingNode, Quarry, WorldConfig,
};
use crate::tree_work_area_policy::{supports_tree_work_area, validate_tree_work_area};
use crate::weaver_input_policy::{
    is_valid_weaver_input_policy, normalize_weaver_input_policy, WEAVER_INPUT_POLICY_AUTO,
    WEAVER_INPUT_POLICY_FLAX_FIRST, WEAVER_INPUT_POLICY_WOOL_FIRST,
};
use crate::woodcutter_policy::normalize_woodcutter_timber_reserve;
use crate::worksite_stall_policy::{
    alternative_processor_recipe_ready, is_production_labor_kind, stalled_labor_target,
    ProcessorRecipeAvailability, SpatialBuckets, RICH_DEPOSIT_CENTER_TOLERANCE,
};
use crate::year_round_labor_policy::{
    is_year_round_labor_kind, year_round_labor_rotation, YearRoundLaborSite,
};

fn overlaps_same_kind_functional_extent(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    kind: &str,
    x: f64,
    z: f64,
) -> bool {
    let Some(def) = building_def(kind) else {
        return false;
    };
    if def.work_radius <= 0.0 {
        return false;
    }

    for building in ctx.db.building().owner().filter(&owner) {
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

fn is_too_close_to_buildings(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    kind: &str,
    x: f64,
    z: f64,
    road_network: Option<&crate::roads::RoadNetwork>,
) -> bool {
    for building in ctx.db.building().owner().filter(&owner) {
        let other_yaw = resolved_existing_building_yaw(road_network, &building);
        if building_footprints_too_close(
            kind,
            x,
            z,
            &building.kind,
            building.x,
            building.z,
            Some(other_yaw),
            road_network,
        ) {
            return true;
        }
    }
    false
}

fn building_overlaps_farm_field(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    kind: &str,
    x: f64,
    z: f64,
) -> bool {
    let network = load_owner_road_network(ctx, owner);
    ctx.db.farm_field().owner().filter(&owner).any(|field| {
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
        zone_overlaps_building_footprint(&polygon, kind, x, z, network.as_ref())
    })
}

fn building_overlaps_pasture(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    kind: &str,
    x: f64,
    z: f64,
) -> bool {
    let network = load_owner_road_network(ctx, owner);
    ctx.db.pasture().owner().filter(&owner).any(|pasture| {
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
        zone_overlaps_building_footprint(&polygon, kind, x, z, network.as_ref())
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
        if !quarry.quarry_id.starts_with("quarry-") {
            continue;
        }
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

fn has_surface_deposit_in_radius(ctx: &ReducerContext, x: f64, z: f64, radius: f64) -> bool {
    let radius_sq = radius * radius;
    ctx.db.quarry().iter().any(|deposit| {
        mining_camp_geological_commodity(&deposit.quarry_id, deposit.is_rich).is_some()
            && deposit.remaining > 0.0
            && (deposit.x - x) * (deposit.x - x) + (deposit.z - z) * (deposit.z - z) <= radius_sq
    }) || ctx.db.foraging_node().iter().any(|deposit| {
        mining_camp_clay_commodity(&deposit.node_kind, &deposit.node_id).is_some()
            && deposit.remaining > 0.0
            && (deposit.x - x) * (deposit.x - x) + (deposit.z - z) * (deposit.z - z) <= radius_sq
    })
}

fn has_rich_stone_at_center(ctx: &ReducerContext, x: f64, z: f64) -> bool {
    const CENTER_TOLERANCE: f64 = 2.5;
    let tolerance_sq = CENTER_TOLERANCE * CENTER_TOLERANCE;
    ctx.db.quarry().iter().any(|deposit| {
        quarry_geological_commodity(&deposit.quarry_id, deposit.is_rich).is_some()
            && (deposit.x - x) * (deposit.x - x) + (deposit.z - z) * (deposit.z - z) <= tolerance_sq
    })
}

fn has_mineworks_deposit_at_center(ctx: &ReducerContext, x: f64, z: f64) -> bool {
    const CENTER_TOLERANCE: f64 = 2.5;
    let tolerance_sq = CENTER_TOLERANCE * CENTER_TOLERANCE;
    ctx.db.quarry().iter().any(|deposit| {
        mineworks_geological_commodity(&deposit.quarry_id, deposit.is_rich).is_some()
            && (deposit.x - x) * (deposit.x - x) + (deposit.z - z) * (deposit.z - z) <= tolerance_sq
    }) || ctx.db.foraging_node().iter().any(|deposit| {
        mineworks_clay_commodity(&deposit.node_kind, &deposit.node_id).is_some()
            && (deposit.x - x) * (deposit.x - x) + (deposit.z - z) * (deposit.z - z) <= tolerance_sq
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

/// Building IDs are settlement-global because the public table key is global,
/// while founding bootstrap is owner-scoped. Use the world counter but also
/// skip any occupied key so migrated multi-identity worlds cannot panic when an
/// older auto-increment sequence lags behind existing rows.
pub(crate) fn next_available_building_id(
    ctx: &ReducerContext,
    preferred: u64,
) -> Result<u64, String> {
    let mut candidate = preferred.max(1);
    while ctx.db.building().id().find(&candidate).is_some() {
        candidate = candidate
            .checked_add(1)
            .ok_or_else(|| "No building IDs remain available.".to_string())?;
    }
    Ok(candidate)
}

const MAP_SIZE_SMALL: u8 = 0;
const CONSTRUCTION_REQUIREMENT_EPSILON: f64 = 1e-6;

fn has_nonzero_construction_requirements(
    timber: f64,
    stone: f64,
    ironwork: f64,
    roof_tiles: f64,
) -> bool {
    [timber, stone, ironwork, roof_tiles]
        .into_iter()
        .any(|amount| amount > CONSTRUCTION_REQUIREMENT_EPSILON)
}

/// Bootstrap camps are the only founder camps with no recorded construction
/// requirements. Expansion camps retain their paid construction requirements
/// after completion, giving their lifecycle a persistent, schema-free marker.
pub(crate) fn is_bootstrap_founders_camp(building: &Building) -> bool {
    building.kind == "founders_camp"
        && !has_nonzero_construction_requirements(
            building.construction_required_timber,
            building.construction_required_stone,
            building.construction_required_ironwork,
            building.construction_required_roof_tiles,
        )
}

fn is_expansion_founders_camp(building: &Building) -> bool {
    building.kind == "founders_camp" && !is_bootstrap_founders_camp(building)
}

fn founders_camp_gold_refund(
    cost_gold: f64,
    construction_complete: bool,
    fire_damaged: bool,
) -> f64 {
    if fire_damaged {
        return 0.0;
    }
    let paid_gold = whole_cost(cost_gold);
    if construction_complete {
        whole_units(paid_gold * GOLD_SALVAGE_FRACTION)
    } else {
        paid_gold
    }
}

#[reducer]
pub fn place_building(ctx: &ReducerContext, kind: String, x: f64, z: f64) -> Result<(), String> {
    if kind == "remote_work_camp" {
        return Err("Overnight work camps have been removed.".to_string());
    }
    place_building_internal(ctx, kind, x, z).map(|_| ())
}

fn building_overlaps_vineyard(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    kind: &str,
    x: f64,
    z: f64,
) -> bool {
    let network = load_owner_road_network(ctx, owner);
    ctx.db
        .vineyard_parcel()
        .owner()
        .filter(&owner)
        .any(|vineyard| {
            let polygon = [
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
            zone_overlaps_building_footprint(&polygon, kind, x, z, network.as_ref())
        })
}

pub(crate) fn place_building_internal(
    ctx: &ReducerContext,
    kind: String,
    x: f64,
    z: f64,
) -> Result<u64, String> {
    let def = building_def_or_err(&kind)?;
    let owner = ctx.sender();
    ensure_player_resources(ctx, owner);
    let physical_founding_site_enabled = ctx
        .db
        .player_resources()
        .owner()
        .find(&owner)
        .is_some_and(|resources| resources.physical_founding_site_enabled);
    let is_founders_camp_expansion = kind == "founders_camp" && physical_founding_site_enabled;

    if kind == "salvage_pile" {
        return Err("This temporary site is created automatically by the settlement.".into());
    }
    if kind != "founders_camp" && !physical_founding_site_enabled {
        return Err("Place the founders' camp before building the settlement.".into());
    }

    let on_rich_stone = kind == "large_quarry" && has_rich_stone_at_center(ctx, x, z);
    let on_mineworks_deposit = kind == "mine" && has_mineworks_deposit_at_center(ctx, x, z);

    if !on_rich_stone
        && !on_mineworks_deposit
        && building_overlaps_resource_deposit(ctx, owner, &kind, x, z)
    {
        return Err("Cannot build over a physical resource deposit.".to_string());
    }

    // A fresh world has no roads, zones, fields, pastures, or other buildings
    // for the founding camp to overlap. Its active, seed-aware rendered water
    // mask and terrain shape have already been validated by the placement
    // client. The static server hydrology grid is a groundwater proxy for
    // wells and crops, not the active river layout, so consulting it here can
    // reject visibly dry ground from another world seed. Route the one-time
    // bootstrap camp directly after the only server-side spatial conflict that
    // can exist in a fresh world: a generated physical resource deposit. Later
    // camps continue through the normal construction pipeline.
    if kind == "founders_camp" && !physical_founding_site_enabled {
        crate::reducers::bootstrap::place_founding_camp(ctx, x, z)?;
        return Ok(0);
    }

    if is_founders_camp_expansion {
        let config = ctx
            .db
            .world_config()
            .id()
            .find(&0)
            .ok_or_else(|| "World not initialized.".to_string())?;
        if config.map_size == MAP_SIZE_SMALL {
            return Err("Founders' Camp expansions are unavailable on small maps.".to_string());
        }
    }

    // Surface-water and shoreline placement is validated by the placement
    // client against the active world's seed-aware rendered river mask. The
    // server's authoritative groundwater network is deliberately separate from
    // that visible mask, so it must never be used as an open-water proxy here.

    // Parsing and indexing the serialized road graph is one of the more expensive
    // placement checks. Reuse one snapshot for overlap, landmark, and carpenter checks.
    let road_network = load_owner_road_network(ctx, owner);
    let placement_yaw = resolved_building_placement_yaw(road_network.as_ref(), &kind, x, z);
    crate::settlements::ensure_owner_settlements(ctx, owner);
    let planned_settlement = if is_founders_camp_expansion {
        Some(crate::settlements::create_planned_settlement(
            ctx, owner, x, z,
        )?)
    } else {
        None
    };
    let settlement_id = if let Some(settlement) = planned_settlement.as_ref() {
        settlement.id
    } else {
        crate::settlements::settlement_for_position(ctx, owner, x, z)
            .ok_or_else(|| "Place the founders' camp before building the settlement.".to_string())?
    };

    if matches!(
        kind.as_str(),
        "watchtower" | "guardhouse" | "palisaded_refuge"
    ) {
        let conflict_enabled = ctx
            .db
            .world_config()
            .id()
            .find(&0)
            .is_some_and(|config| config.conflict_enabled);
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

    if kind == "palisaded_refuge"
        && !ctx
            .db
            .building()
            .owner()
            .filter(&owner)
            .any(|building| building.kind == "guardhouse" && building.construction_complete)
    {
        return Err(
            "Complete a frontier guardhouse before enclosing a palisaded refuge.".to_string(),
        );
    }

    if kind == "monastery" {
        if ctx
            .db
            .building()
            .owner()
            .filter(&owner)
            .any(|building| building.kind == "monastery")
        {
            return Err(
                "Only one monastery may belong to a settlement; demolish the existing estate before founding another."
                    .to_string(),
            );
        }
        let config = ctx
            .db
            .world_config()
            .id()
            .find(&0)
            .ok_or_else(|| "World not initialized.".to_string())?;
        let playable_half = playable_half_for_monastery_map_size(config.map_size);
        if !monastery_estate_fits_map(x, z, placement_yaw, playable_half) {
            return Err(
                "The monastery's complete 68 x 53 metre fenced estate must fit inside the map."
                    .to_string(),
            );
        }
        if !monastery_estate_is_near_map_edge(x, z, placement_yaw, playable_half) {
            return Err(
                "The monastery's complete estate must reach the map-size-scaled frontier belt near an edge."
                    .to_string(),
            );
        }
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
        let civic_landmarks = ctx
            .db
            .building()
            .owner()
            .filter(&owner)
            .filter(|building| building.settlement_id == settlement_id)
            .filter(|building| {
                building.kind == "town_hall"
                    || (building.construction_complete
                        && matches!(building.kind.as_str(), "chapel" | "marketplace"))
            })
            .collect::<Vec<_>>();
        if civic_landmarks
            .iter()
            .any(|building| building.kind == "town_hall")
        {
            return Err("Only one Town Hall may serve this community.".to_string());
        }
        let population: u32 = ctx
            .db
            .residence()
            .owner()
            .filter(&owner)
            .filter(|residence| residence.settlement_id == settlement_id)
            .map(|residence| residence.population)
            .sum();
        if population < TOWN_HALL_POPULATION_REQUIRED {
            return Err(format!(
                "The settlement needs at least {TOWN_HALL_POPULATION_REQUIRED} residents before building a Town Hall."
            ));
        }
        if !civic_landmarks
            .iter()
            .any(|building| building.kind == "chapel")
        {
            return Err("Build a chapel before founding the Town Hall.".to_string());
        }
        if !civic_landmarks
            .iter()
            .any(|building| building.kind == "marketplace")
        {
            return Err("Build a marketplace before founding the Town Hall.".to_string());
        }
        let network = road_network
            .as_ref()
            .ok_or_else(|| "The Town Hall requires a road network.".to_string())?;
        let civic_points = civic_landmarks
            .iter()
            .map(|building| (building.x, building.z))
            .collect::<Vec<_>>();
        let civic_distances = network.road_path_distances_from(x, z, &civic_points);
        let linked_chapel = civic_landmarks
            .iter()
            .zip(&civic_distances)
            .any(|(building, distance)| building.kind == "chapel" && distance.is_some());
        let linked_marketplace = civic_landmarks
            .iter()
            .zip(&civic_distances)
            .any(|(building, distance)| building.kind == "marketplace" && distance.is_some());
        if !linked_chapel || !linked_marketplace {
            return Err(
                "The Town Hall must be road-linked to both the chapel and marketplace.".to_string(),
            );
        }
    }

    if building_overlaps_residence_zone(ctx, owner, &kind, x, z) {
        return Err("Cannot build inside a residence plot.".to_string());
    }
    if building_overlaps_farm_field(ctx, owner, &kind, x, z) {
        return Err("Cannot build inside cultivated farmland.".to_string());
    }
    if building_overlaps_pasture(ctx, owner, &kind, x, z) {
        return Err("Cannot build inside a fenced pasture.".to_string());
    }
    if building_overlaps_vineyard(ctx, owner, &kind, x, z) {
        return Err("Cannot build inside a vineyard parcel.".to_string());
    }

    if road_network
        .as_ref()
        .is_some_and(|network| building_overlaps_road_surface(network, &kind, x, z))
    {
        return Err("Cannot build on a road.".to_string());
    }

    if overlaps_same_kind_functional_extent(ctx, owner, &kind, x, z) {
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

    if kind == "stone_quarry" && !has_surface_deposit_in_radius(ctx, x, z, def.work_radius) {
        return Err(
            "Mining Camps need an unexhausted surface stone, iron, salt, or clay reserve within work range."
                .to_string(),
        );
    }

    if kind == "large_quarry" && !on_rich_stone {
        return Err("Quarries must be centered directly on a rich stone deposit.".to_string());
    }

    if kind == "mine" && !on_mineworks_deposit {
        return Err(
            "Mineworks must be centered directly on a rich iron, salt, or clay deposit."
                .to_string(),
        );
    }

    if def.requires_game && !has_foraging_in_radius(ctx, x, z, def.work_radius, "game", false) {
        return Err("No game within work range.".to_string());
    }

    if def.requires_berries
        && !has_foraging_in_radius(ctx, x, z, def.work_radius, "berries", true)
        && !has_foraging_in_radius(ctx, x, z, def.work_radius, "mushrooms", true)
    {
        return Err("No raspberries or mushrooms within work range.".to_string());
    }

    if def.requires_fish && !has_foraging_in_radius(ctx, x, z, def.work_radius, "fish", false) {
        return Err("No fish shoal within work range.".to_string());
    }

    if is_too_close_to_buildings(ctx, owner, &kind, x, z, road_network.as_ref()) {
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
                    && building_fire_state(ctx, shop.id).is_none()
                    && local_delivery_distance(network, x, z, shop.x, shop.z).is_some()
            })
        })
        .unwrap_or(false);
    let timber_cost = cost.timber
        * if carpenter_discount {
            CARPENTER_TIMBER_COST_MULTIPLIER
        } else {
            1.0
        };
    if is_founders_camp_expansion
        && !has_nonzero_construction_requirements(
            timber_cost,
            cost.stone,
            cost.ironwork,
            cost.roof_tiles,
        )
    {
        return Err(
            "Founders' Camp expansion balance must include construction materials.".to_string(),
        );
    }
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
    if total_ironwork(ctx, owner) + 1e-6 < cost.ironwork {
        return Err(format!(
            "Not enough ironwork fittings (need {} ironwork).",
            cost.ironwork.round() as i64
        ));
    }
    if total_roof_tiles(ctx, owner) + 1e-6 < cost.roof_tiles {
        return Err(format!(
            "Not enough fired roof tiles (need {} roof tiles).",
            cost.roof_tiles.round() as i64
        ));
    }
    let (treasury_timber, treasury_stone, treasury_ironwork, treasury_roof_tiles) =
        construction_treasury_reservation(
            ctx,
            owner,
            timber_cost,
            cost.stone,
            cost.ironwork,
            cost.roof_tiles,
        );
    let assigned_builders = initial_construction_labor(available_building_labor(ctx, owner));

    let config = ctx
        .db
        .world_config()
        .id()
        .find(&0)
        .ok_or_else(|| "World not initialized.".to_string())?;

    if is_founders_camp_expansion {
        spend_treasury_gold(ctx, owner, def.cost_gold)?;
    }

    let hydrology = if kind == "well" {
        sample_world_well_groundwater_score(
            x,
            z,
            config.seed,
            config.hydrology,
            config.well_aquifer_networks_enabled,
        )
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
        .filter(|tree| {
            building_site_contains_point_at_yaw(&kind, x, z, placement_yaw, tree.x, tree.z)
        })
        .map(|tree| tree.tree_id)
        .collect::<Vec<_>>();
    for tree_id in cleared_tree_ids {
        ctx.db.tree_entity().tree_id().delete(&tree_id);
    }

    let building_id = next_available_building_id(ctx, config.next_building_id)?;
    let carpenter_polearm_reserve = if kind == "carpenter" {
        CARPENTER_POLEARM_RESERVE_DEFAULT
    } else {
        0
    };
    let carpenter_cart_service_target_trips = if kind == "carpenter" {
        CARPENTER_CART_SERVICE_TARGET_DEFAULT
    } else {
        0
    };
    let chapel_tier = if kind == "chapel" { 1 } else { 0 };
    let harvest_reserve_percent = default_harvest_reserve_percent(&kind);
    ctx.db.building().insert(Building {
        id: building_id,
        owner,
        kind,
        x,
        z,
        placement_yaw,
        placement_yaw_locked: true,
        work_radius: def.work_radius,
        tree_work_area_x: 0.0,
        tree_work_area_z: 0.0,
        tree_work_area_radius: 0.0,
        action_cooldown: 0.0,
        timber: 0.0,
        firewood: 0.0,
        stone: 0.0,
        water: 0.0,
        food: 0.0,
        ale: 0.0,
        preserved_food: 0.0,
        honey: 0.0,
        wine: 0.0,
        ironwork: 0.0,
        polearms: 0.0,
        water_capacity,
        assigned_labor: assigned_builders,
        construction_complete: false,
        construction_progress: 0.0,
        construction_required_timber: timber_cost,
        construction_required_stone: cost.stone,
        construction_required_ironwork: cost.ironwork,
        construction_delivered_timber: 0.0,
        construction_delivered_stone: 0.0,
        construction_delivered_ironwork: 0.0,
        construction_reserved_timber: timber_cost,
        construction_reserved_stone: cost.stone,
        construction_reserved_ironwork: cost.ironwork,
        construction_treasury_timber: treasury_timber,
        construction_treasury_stone: treasury_stone,
        construction_treasury_ironwork: treasury_ironwork,
        construction_required_roof_tiles: cost.roof_tiles,
        construction_delivered_roof_tiles: 0.0,
        construction_reserved_roof_tiles: cost.roof_tiles,
        construction_treasury_roof_tiles: treasury_roof_tiles,
        storehouse_accepts_timber: true,
        storehouse_accepts_stone: true,
        storehouse_accepts_firewood: true,
        storehouse_accepts_iron: true,
        storehouse_accepts_clay: true,
        storehouse_accepts_salt: true,
        storehouse_accepts_charcoal: true,
        granary_accepts_fresh_food: true,
        granary_households_first: true,
        granary_grain_reserve: 0.0,
        harvest_reserve_percent,
        wool: 0.0,
        cloth: 0.0,
        construction_priority: CONSTRUCTION_PRIORITY_NORMAL,
        woodcutter_timber_reserve: 0.0,
        carpenter_polearm_reserve,
        marketplace_ironwork_target: 0,
        marketplace_seed_grain_target: 0,
        marketplace_pending_trade_code: 0,
        marketplace_gold_reserve_target: MARKETPLACE_GOLD_RESERVE_DEFAULT,
        marketplace_specialty_export_policy: 0,
        granary_fresh_food_target_percent: GRANARY_FRESH_FOOD_TARGET_DEFAULT_PERCENT,
        storehouse_timber_target_percent: STOREHOUSE_STOCK_TARGET_DEFAULT_PERCENT,
        storehouse_stone_target_percent: STOREHOUSE_STOCK_TARGET_DEFAULT_PERCENT,
        storehouse_firewood_target_percent: STOREHOUSE_STOCK_TARGET_DEFAULT_PERCENT,
        storehouse_iron_target_percent: STOREHOUSE_STOCK_TARGET_DEFAULT_PERCENT,
        storehouse_clay_target_percent: STOREHOUSE_STOCK_TARGET_DEFAULT_PERCENT,
        storehouse_salt_target_percent: STOREHOUSE_STOCK_TARGET_DEFAULT_PERCENT,
        storehouse_charcoal_target_percent: 25,
        processor_output_target_percent: PROCESSOR_OUTPUT_TARGET_DEFAULT_PERCENT,
        production_rate_percent: DEFAULT_PRODUCTION_RATE_PERCENT,
        production_maintenance_progress: 0.0,
        gold: 0.0,
        // A paid expedition's people arrive only when construction completes.
        founding_shelter_active: false,
        chapel_monastery_tithe_due: 0.0,
        civic_receipts_gold: 0.0,
        private_export_proceeds_gold: 0.0,
        vineyard_fermenting_grapes: 0.0,
        vineyard_fermentation_progress: 0.0,
        apiary_harvest_policy: 1,
        apiary_colony_health: 1.0,
        apiary_last_winter_year: 0,
        apiary_forage_score: 0.75,
        marketplace_drink_export_policy: 255,
        marketplace_provision_export_policy: 255,
        marketplace_wares_export_policy: 255,
        barley: 0.0,
        malt: 0.0,
        flax: 0.0,
        guardhouse_muster_watchtower_id: 0,
        weaver_input_policy: 0,
        iron: 0.0,
        clay: 0.0,
        salt: 0.0,
        charcoal: 0.0,
        pottery: 0.0,
        roof_tiles: 0.0,
        manure: 0.0,
        remedies: 0.0,
        marketplace_iron_target: 0,
        marketplace_salt_target: 0,
        pottery_dispatch_policy: 0,
        potter_firing_policy: 0,
        carpenter_cart_service_target_trips,
        remote_work_camp_enabled: false,
        linked_worksite_id: 0,
        commute_efficiency: 1.0,
        chapel_tier,
        meat: 0.0,
        fish: 0.0,
        berries: 0.0,
        mushrooms: 0.0,
        milk: 0.0,
        apples: 0.0,
        cherries: 0.0,
        vegetables: 0.0,
        eggs: 0.0,
        grapes: 0.0,
        cured_meat: 0.0,
        smoked_fish: 0.0,
        cheese: 0.0,
        rye_sheaves: 0.0,
        oat_sheaves: 0.0,
        barley_sheaves: 0.0,
        maslin_sheaves: 0.0,
        rye_grain: 0.0,
        oat_grain: 0.0,
        maslin_grain: 0.0,
        rye_flour: 0.0,
        maslin_flour: 0.0,
        rye_bread: 0.0,
        maslin_bread: 0.0,
        threshing_priority: crate::farm_work_policy::THRESHING_PRIORITY_DEFAULT,
        fire_repair_active: false,
        cider: 0.0,
        mead: 0.0,
        brewery_recipe_policy: crate::brewery_recipe_policy::BREWERY_RECIPE_ALE,
        monastery_orchard_planting: crate::monastery_estate_policy::MONASTERY_ORCHARD_APPLES,
        monastery_croft_planting: crate::monastery_estate_policy::MONASTERY_CROFT_VEGETABLES,
        monastery_extensions: 0,
        monastery_next_extension: 0,
        monastery_orchard_planted_year: 0,
        monastery_orchard_maturity:
            crate::monastery_estate_policy::MONASTERY_ORCHARD_MATURITY_MATURE,
        monastery_croft_choice_year: 0,
        monastery_service_funding: 1.0,
        monastery_last_service_day: 0,
        storage_acceptance_mask: u64::MAX,
        hides: 0.0,
        leather: 0.0,
        shoes: 0.0,
        pears: 0.0,
        aronia: 0.0,
        rosehips: 0.0,
        cabbage: 0.0,
        carrots: 0.0,
        beetroot: 0.0,
        aronia_jam: 0.0,
        rosehip_jam: 0.0,
        pear_cider: 0.0,
        settlement_id,
        animal_feed: 0.0,
        storage_acceptance_mask_high: u64::MAX,
        wax: 0.0,
        candles: 0.0,
        apiary_wax_cycle_progress: 0,
        pelts: 0.0,
        yarn: 0.0,
        linen: 0.0,
        sidearms: 0.0,
        shields: 0.0,
        bows: 0.0,
        crossbows: 0.0,
        padded_armor: 0.0,
        mail_armor: 0.0,
        ammunition: 0.0,
        milk_use_policy: crate::livestock_policy::MILK_USE_BALANCED,
        smokehouse_recipe_policy: crate::smokehouse_recipe_policy::SMOKEHOUSE_RECIPE_AUTO,
        apiary_accumulated_honey: 0.0,
    });

    if is_founders_camp_expansion {
        crate::settlements::attach_founding_camp(ctx, settlement_id, building_id)?;
    }

    ctx.db.world_config().id().update(WorldConfig {
        next_building_id: building_id + 1,
        ..config
    });

    Ok(building_id)
}

#[reducer]
pub fn upgrade_chapel(ctx: &ReducerContext, building_id: u64) -> Result<(), String> {
    let owner = ctx.sender();
    ensure_player_resources(ctx, owner);
    let mut chapel = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Church not found.".to_string())?;
    if chapel.owner != owner || chapel.kind != "chapel" {
        return Err("You do not own this church.".to_string());
    }
    if !chapel.construction_complete {
        return Err("Complete the church before upgrading it.".to_string());
    }
    if building_fire_state(ctx, chapel.id).is_some() {
        return Err("Repair the church before beginning an upgrade.".to_string());
    }

    chapel.chapel_tier = normalize_chapel_tier(chapel.chapel_tier);
    let cost = chapel_upgrade_cost(chapel.chapel_tier)
        .ok_or_else(|| "This church is already at the highest tier.".to_string())?;
    if total_timber(ctx, owner) + 1e-6 < cost.timber {
        return Err(format!(
            "Not enough timber for this church upgrade (need {} timber).",
            cost.timber.round() as i64
        ));
    }
    if total_stone(ctx, owner) + 1e-6 < cost.stone {
        return Err(format!(
            "Not enough stone for this church upgrade (need {} stone).",
            cost.stone.round() as i64
        ));
    }
    if total_ironwork(ctx, owner) + 1e-6 < cost.ironwork {
        return Err(format!(
            "Not enough ironwork for this church upgrade (need {} ironwork).",
            cost.ironwork.round() as i64
        ));
    }
    if total_roof_tiles(ctx, owner) + 1e-6 < cost.roof_tiles {
        return Err(format!(
            "Not enough fired roof tiles for this church upgrade (need {} roof tiles).",
            cost.roof_tiles.round() as i64
        ));
    }

    spend_aggregate_timber(ctx, owner, cost.timber)?;
    spend_aggregate_stone(ctx, owner, cost.stone)?;
    spend_aggregate_ironwork(ctx, owner, cost.ironwork)?;
    spend_aggregate_roof_tiles(ctx, owner, cost.roof_tiles)?;
    chapel.chapel_tier = cost.target_tier;
    ctx.db.building().id().update(chapel);
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

fn require_staffed_town_hall_settlement(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    town_hall_id: u64,
) -> Result<u64, String> {
    let hall = ctx
        .db
        .building()
        .id()
        .find(&town_hall_id)
        .ok_or_else(|| "Town Hall not found.".to_string())?;
    if hall.owner != owner
        || hall.kind != "town_hall"
        || !hall.construction_complete
        || hall.assigned_labor == 0
        || hall.settlement_id == 0
    {
        return Err("A staffed Town Hall is required for this local order.".to_string());
    }
    let valid_jurisdiction = ctx
        .db
        .settlement()
        .id()
        .find(&hall.settlement_id)
        .is_some_and(|settlement| settlement.owner == owner && settlement.town_hall_id == hall.id);
    if !valid_jurisdiction {
        return Err("This Town Hall has no active civic jurisdiction.".to_string());
    }
    Ok(hall.settlement_id)
}

/// Releases builders from supply-blocked sites that have no approaching cart,
/// then deploys free crews to sites where material or founders' reserves make
/// immediate progress possible. Existing productive and inbound-waiting crews
/// are never displaced.
#[reducer]
pub fn rotate_construction_labor(ctx: &ReducerContext, town_hall_id: u64) -> Result<(), String> {
    let owner = ctx.sender();
    let settlement_id = require_staffed_town_hall_settlement(ctx, owner, town_hall_id)?;
    rotate_construction_labor_for_settlement_with_reserve(ctx, owner, settlement_id, 0);
    Ok(())
}

/// Shared authoritative implementation used by both the explicit Town Hall
/// order and the optional daily steward. The queue policy remains pure; this
/// adapter supplies live material and inbound-cart state, then applies only the
/// returned target rows.
/// A Town Hall steward administers only construction sites affiliated with its
/// own community. The workers remain part of the realm-wide free labor pool,
/// so this is a jurisdiction filter rather than a movement or hiring wall.
pub(crate) fn rotate_construction_labor_for_settlement_with_reserve(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    settlement_id: u64,
    labor_reserve: u32,
) -> ConstructionLaborRotation {
    rotate_construction_labor_for_scope(ctx, owner, Some(settlement_id), labor_reserve)
}

fn rotate_construction_labor_for_scope(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    settlement_id: Option<u64>,
    labor_reserve: u32,
) -> ConstructionLaborRotation {
    let available_labor = available_building_labor(ctx, owner);
    let sites = ctx
        .db
        .building()
        .owner()
        .filter(&owner)
        .filter(|building| {
            !building.construction_complete
                && settlement_id.is_none_or(|id| building.settlement_id == id)
        })
        .map(|building| ConstructionLaborSite {
            building_id: building.id,
            priority: building.construction_priority,
            assigned_labor: building.assigned_labor,
            max_labor: CONSTRUCTION_MAX_BUILDERS,
            work_ready: construction_labor_ready(
                building.construction_required_timber,
                building.construction_required_stone,
                building.construction_required_ironwork,
                building.construction_delivered_timber,
                building.construction_delivered_stone,
                building.construction_delivered_ironwork,
                building.construction_progress,
                building.construction_treasury_timber,
                building.construction_treasury_stone,
                building.construction_treasury_ironwork,
                building.construction_required_roof_tiles,
                building.construction_delivered_roof_tiles,
                building.construction_treasury_roof_tiles,
            ),
            inbound_supply: building_has_inbound_supply_trip(ctx, building.id),
        })
        .collect::<Vec<_>>();
    let rotation = if labor_reserve == 0 {
        construction_labor_rotation(&sites, available_labor)
    } else {
        construction_labor_rotation_with_reserve(&sites, available_labor, labor_reserve)
    };

    for &(building_id, target_labor) in &rotation.targets {
        let Some(mut building) = ctx.db.building().id().find(&building_id) else {
            continue;
        };
        if building.owner != owner
            || building.construction_complete
            || settlement_id.is_some_and(|id| building.settlement_id != id)
        {
            continue;
        }
        let target_labor = target_labor.min(CONSTRUCTION_MAX_BUILDERS);
        preserve_in_transit_cart_labor(ctx, building.id, target_labor);
        building.assigned_labor = target_labor;
        ctx.db.building().id().update(building);
    }
    rotation
}

/// Recalls only production workers whose seasonal task is currently dormant.
/// Stored output remains available to logistics labor. Restaffing remains an
/// explicit player decision.
#[reducer]
pub fn recall_idle_seasonal_labor(ctx: &ReducerContext, town_hall_id: u64) -> Result<(), String> {
    let owner = ctx.sender();
    let settlement_id = require_staffed_town_hall_settlement(ctx, owner, town_hall_id)?;

    let sim_tick = ctx
        .db
        .world_config()
        .id()
        .find(&0)
        .map(|config| config.sim_tick)
        .unwrap_or(0);
    let month = game_clock(sim_tick).month;
    recall_idle_seasonal_labor_for_settlement(ctx, owner, settlement_id, month);
    Ok(())
}

/// Calls free settlement labor into currently active seasonal work. Sites
/// receive one worker per stable-order pass so scarce labor is shared across
/// the active harvest window.
#[reducer]
pub fn call_up_active_seasonal_labor(
    ctx: &ReducerContext,
    town_hall_id: u64,
) -> Result<(), String> {
    let owner = ctx.sender();
    let settlement_id = require_staffed_town_hall_settlement(ctx, owner, town_hall_id)?;
    let sim_tick = ctx
        .db
        .world_config()
        .id()
        .find(&0)
        .map(|config| config.sim_tick)
        .unwrap_or(0);
    let month = game_clock(sim_tick).month;
    call_up_active_seasonal_labor_for_settlement(ctx, owner, settlement_id, month);
    Ok(())
}

fn processor_output_commodity(kind: &str) -> Option<CommodityKind> {
    if kind == "bakery" {
        return Some(CommodityKind::RyeBread);
    }
    match processor_output_kind(kind)? {
        ProcessorOutputKind::Flour => Some(CommodityKind::RyeFlour),
        ProcessorOutputKind::Food => Some(CommodityKind::RyeBread),
        ProcessorOutputKind::Ale => Some(CommodityKind::Ale),
        ProcessorOutputKind::PreservedFood => Some(CommodityKind::PreservedFood),
        ProcessorOutputKind::TextileIntermediate => Some(CommodityKind::Yarn),
        ProcessorOutputKind::Cloth => Some(CommodityKind::Cloth),
        ProcessorOutputKind::Charcoal => Some(CommodityKind::Charcoal),
        ProcessorOutputKind::Ironwork => Some(CommodityKind::Ironwork),
        ProcessorOutputKind::Pottery => Some(CommodityKind::Pottery),
        ProcessorOutputKind::Leather => Some(CommodityKind::Leather),
        ProcessorOutputKind::Shoes => Some(CommodityKind::Shoes),
        ProcessorOutputKind::Candles => Some(CommodityKind::Candles),
    }
}

fn processor_output_room(building: &Building) -> Option<f64> {
    if building.kind == "smokehouse" {
        return Some(processor_output_headroom(
            crate::economy::building_preserved_food_stock(building),
            building_commodity_cap(&building.kind, CommodityKind::PreservedFood),
            building.processor_output_target_percent,
        ));
    }
    if building.kind == "brewery" {
        let policy = normalize_brewery_recipe_policy(building.brewery_recipe_policy);
        let headroom = |commodity| {
            processor_output_headroom(
                building_commodity_stock(building, commodity),
                building_commodity_cap(&building.kind, commodity),
                building.processor_output_target_percent,
            )
        };
        return Some(match policy {
            BREWERY_RECIPE_CIDER => headroom(CommodityKind::Cider),
            BREWERY_RECIPE_PEAR_CIDER => headroom(CommodityKind::PearCider),
            BREWERY_RECIPE_MEAD => headroom(CommodityKind::Mead),
            BREWERY_RECIPE_AUTO => headroom(CommodityKind::Ale)
                .max(headroom(CommodityKind::Cider))
                .max(headroom(CommodityKind::PearCider))
                .max(headroom(CommodityKind::Mead)),
            _ => headroom(CommodityKind::Ale),
        });
    }
    if building.kind == "spinning_retting_house" {
        let headroom = |commodity| {
            processor_output_headroom(
                building_commodity_stock(building, commodity),
                building_commodity_cap(&building.kind, commodity),
                building.processor_output_target_percent,
            )
        };
        return Some(
            match normalize_weaver_input_policy(building.weaver_input_policy) {
                WEAVER_INPUT_POLICY_WOOL_FIRST => headroom(CommodityKind::Yarn),
                WEAVER_INPUT_POLICY_FLAX_FIRST => headroom(CommodityKind::Linen),
                WEAVER_INPUT_POLICY_AUTO => {
                    headroom(CommodityKind::Yarn).max(headroom(CommodityKind::Linen))
                }
                _ => unreachable!("textile recipe policy is normalized"),
            },
        );
    }
    let commodity = if building.kind == "potter_kiln"
        && potter_fires_roof_tiles(building.potter_firing_policy)
    {
        CommodityKind::RoofTiles
    } else {
        processor_output_commodity(&building.kind)?
    };
    Some(processor_output_headroom(
        building_commodity_stock(building, commodity),
        building_commodity_cap(&building.kind, commodity),
        building.processor_output_target_percent,
    ))
}

fn processor_input_commodity(kind: ProcessorInputKind) -> CommodityKind {
    match kind {
        ProcessorInputKind::Grain => CommodityKind::RyeGrain,
        ProcessorInputKind::Flour => CommodityKind::RyeFlour,
        ProcessorInputKind::Water => CommodityKind::Water,
        ProcessorInputKind::Firewood => CommodityKind::Firewood,
        ProcessorInputKind::Barley => CommodityKind::Barley,
        // Fresh food is an input group rather than a physical commodity. Meat
        // is the sentinel used by the smokehouse-only group checks below.
        ProcessorInputKind::Food => CommodityKind::Meat,
        ProcessorInputKind::Salt => CommodityKind::Salt,
        ProcessorInputKind::Wool => CommodityKind::Wool,
        ProcessorInputKind::Flax => CommodityKind::Flax,
        ProcessorInputKind::Yarn => CommodityKind::Yarn,
        ProcessorInputKind::Linen => CommodityKind::Linen,
        ProcessorInputKind::Iron => CommodityKind::Iron,
        ProcessorInputKind::Charcoal => CommodityKind::Charcoal,
        ProcessorInputKind::Clay => CommodityKind::Clay,
        ProcessorInputKind::Apples => CommodityKind::Apples,
        ProcessorInputKind::Honey => CommodityKind::Honey,
        ProcessorInputKind::Hides => CommodityKind::Hides,
        ProcessorInputKind::Leather => CommodityKind::Leather,
        ProcessorInputKind::Wax => CommodityKind::Wax,
    }
}

fn processor_recipe_availability(
    ctx: &ReducerContext,
    building: &Building,
    include_inbound: bool,
) -> ProcessorRecipeAvailability {
    let available = |commodity| {
        building_commodity_stock(building, commodity) > 1e-6
            || (include_inbound && building_has_inbound_commodity_trip(ctx, building.id, commodity))
    };
    ProcessorRecipeAvailability {
        rye_grain: available(CommodityKind::RyeGrain),
        maslin_grain: available(CommodityKind::MaslinGrain),
        rye_flour: available(CommodityKind::RyeFlour),
        maslin_flour: available(CommodityKind::MaslinFlour),
        barley: available(CommodityKind::Barley),
        malt: available(CommodityKind::Malt),
        water: available(CommodityKind::Water),
        firewood: available(CommodityKind::Firewood),
        apples: available(CommodityKind::Apples),
        pears: available(CommodityKind::Pears),
        honey: available(CommodityKind::Honey),
        food: crate::economy::building_preservable_food_stock(building) > 1e-6,
        meat: available(CommodityKind::Meat),
        fish: available(CommodityKind::Fish),
        milk: available(CommodityKind::Milk),
        salt: available(CommodityKind::Salt),
        pottery: available(CommodityKind::Pottery),
        wool: available(CommodityKind::Wool),
        flax: available(CommodityKind::Flax),
        yarn: available(CommodityKind::Yarn),
        linen: available(CommodityKind::Linen),
    }
}

fn processor_stall_and_recovery(ctx: &ReducerContext, building: &Building) -> (bool, bool) {
    if processor_output_room(building).is_some_and(|headroom| headroom <= 1e-6) {
        return (true, false);
    }

    let recipe_policy = match building.kind.as_str() {
        "brewery" => normalize_brewery_recipe_policy(building.brewery_recipe_policy),
        "smokehouse" => building.smokehouse_recipe_policy,
        "spinning_retting_house" | "weaver" => building.weaver_input_policy,
        _ => 0,
    };
    if let Some(ready) = alternative_processor_recipe_ready(
        &building.kind,
        recipe_policy,
        processor_recipe_availability(ctx, building, false),
    ) {
        if ready {
            return (false, false);
        }
        let recovering = alternative_processor_recipe_ready(
            &building.kind,
            recipe_policy,
            processor_recipe_availability(ctx, building, true),
        )
        .unwrap_or(false);
        return (true, recovering);
    }

    let missing_inputs: Vec<CommodityKind> = processor_input_kinds(&building.kind)
        .iter()
        .copied()
        .map(processor_input_commodity)
        .filter(|commodity| {
            let stock_missing =
                if building.kind == "smokehouse" && *commodity == CommodityKind::Meat {
                    crate::economy::building_preservable_food_stock(building) <= 1e-6
                } else {
                    building_commodity_stock(building, *commodity) <= 1e-6
                };
            stock_missing
                && !(building.kind == "brewery"
                    && *commodity == CommodityKind::Barley
                    && building.malt > 1e-6)
        })
        .collect();
    if missing_inputs.is_empty() {
        return (false, false);
    }
    let every_missing_input_en_route = missing_inputs.iter().all(|commodity| {
        if building.kind == "smokehouse" && *commodity == CommodityKind::Meat {
            [
                CommodityKind::Meat,
                CommodityKind::Fish,
                CommodityKind::Milk,
            ]
            .into_iter()
            .any(|kind| building_has_inbound_commodity_trip(ctx, building.id, kind))
        } else {
            building_has_inbound_commodity_trip(ctx, building.id, *commodity)
        }
    });
    (true, every_missing_input_en_route)
}

fn worksite_source_buckets(
    ctx: &ReducerContext,
) -> (SpatialBuckets<Quarry>, SpatialBuckets<ForagingNode>) {
    let mut quarry_buckets = SpatialBuckets::<Quarry>::new();
    for quarry in ctx.db.quarry().iter() {
        quarry_buckets.insert(quarry.x, quarry.z, quarry);
    }
    let mut foraging_buckets = SpatialBuckets::<ForagingNode>::new();
    for node in ctx.db.foraging_node().iter() {
        foraging_buckets.insert(node.x, node.z, node);
    }
    (quarry_buckets, foraging_buckets)
}

fn mineworks_source_commodity(
    building: &Building,
    quarry_buckets: &SpatialBuckets<Quarry>,
    foraging_buckets: &SpatialBuckets<ForagingNode>,
) -> Option<CommodityKind> {
    for commodity in [CommodityKind::Iron, CommodityKind::Salt] {
        let source = quarry_buckets.source_state_within_radius(
            building.x,
            building.z,
            RICH_DEPOSIT_CENTER_TOLERANCE,
            |deposit| {
                mineworks_geological_commodity(&deposit.quarry_id, deposit.is_rich)
                    == Some(commodity)
            },
            |_| true,
        );
        if source.usable {
            return Some(commodity);
        }
    }
    foraging_buckets
        .source_state_within_radius(
            building.x,
            building.z,
            RICH_DEPOSIT_CENTER_TOLERANCE,
            |deposit| mineworks_clay_commodity(&deposit.node_kind, &deposit.node_id).is_some(),
            |_| true,
        )
        .usable
        .then_some(CommodityKind::Clay)
}

fn surface_source_commodity(
    building: &Building,
    quarry_buckets: &SpatialBuckets<Quarry>,
    foraging_buckets: &SpatialBuckets<ForagingNode>,
) -> Option<CommodityKind> {
    let quarry_source = quarry_buckets.nearest_usable_within_radius(
        building.x,
        building.z,
        building.work_radius,
        |deposit| mining_camp_geological_commodity(&deposit.quarry_id, deposit.is_rich).is_some(),
        |deposit| deposit.remaining > 1e-6,
    );
    let clay_source = foraging_buckets.nearest_usable_within_radius(
        building.x,
        building.z,
        building.work_radius,
        |deposit| mining_camp_clay_commodity(&deposit.node_kind, &deposit.node_id).is_some(),
        |deposit| deposit.remaining > 1e-6,
    );
    if clay_source.is_some_and(|(_, clay_distance_sq)| {
        quarry_source.is_none_or(|(_, quarry_distance_sq)| clay_distance_sq < quarry_distance_sq)
    }) {
        return Some(CommodityKind::Clay);
    }
    quarry_source.map(|(deposit, _)| {
        if deposit.quarry_id.starts_with("deposit-iron-") {
            CommodityKind::Iron
        } else if deposit.quarry_id.starts_with("deposit-salt-") {
            CommodityKind::Salt
        } else {
            CommodityKind::Stone
        }
    })
}

fn rich_stone_source_commodity(
    building: &Building,
    quarry_buckets: &SpatialBuckets<Quarry>,
) -> Option<CommodityKind> {
    quarry_buckets
        .source_state_within_radius(
            building.x,
            building.z,
            RICH_DEPOSIT_CENTER_TOLERANCE,
            |deposit| quarry_geological_commodity(&deposit.quarry_id, deposit.is_rich).is_some(),
            |_| true,
        )
        .usable
        .then_some(CommodityKind::Stone)
}

fn geological_output_stock(building: &Building) -> f64 {
    [
        CommodityKind::Stone,
        CommodityKind::Iron,
        CommodityKind::Salt,
        CommodityKind::Clay,
    ]
    .into_iter()
    .map(|commodity| building_commodity_stock(building, commodity))
    .sum()
}

fn wild_stock_source_usable(
    building: &Building,
    node_kind: &str,
    buckets: &SpatialBuckets<ForagingNode>,
) -> bool {
    buckets
        .source_state_within_radius(
            building.x,
            building.z,
            building.work_radius,
            |node| node.node_kind == node_kind,
            |node| {
                harvestable_wild_stock(
                    &node.node_kind,
                    node.remaining,
                    node.max_yield,
                    building.harvest_reserve_percent,
                ) > 1e-6
            },
        )
        .usable
}

fn commodity_output_blocked(building: &Building, commodity: CommodityKind) -> bool {
    let capacity = building_commodity_cap(&building.kind, commodity);
    capacity > 0.0 && building_commodity_stock(building, commodity) >= capacity - 1e-6
}

fn extraction_output_blocked(building: &Building, commodity: CommodityKind) -> bool {
    processor_output_headroom(
        building_commodity_stock(building, commodity),
        building_commodity_cap(&building.kind, commodity),
        building.processor_output_target_percent,
    ) <= 1e-6
}

fn production_site_ready(
    building: &Building,
    quarry_buckets: &SpatialBuckets<Quarry>,
    foraging_buckets: &SpatialBuckets<ForagingNode>,
) -> bool {
    match building.kind.as_str() {
        kind if is_processor_output_target_kind(kind) => {
            processor_output_room(building).is_some_and(|headroom| headroom > 1e-6)
        }
        "mine" => mineworks_source_commodity(building, quarry_buckets, foraging_buckets)
            .is_some_and(|commodity| {
                !extraction_output_blocked(building, commodity)
                    && rich_mine_supports_ready(building.timber)
            }),
        "stone_quarry" => surface_source_commodity(building, quarry_buckets, foraging_buckets)
            .is_some_and(|commodity| !extraction_output_blocked(building, commodity)),
        "large_quarry" => {
            rich_stone_source_commodity(building, quarry_buckets)
                .is_some_and(|commodity| !extraction_output_blocked(building, commodity))
                && large_quarry_supports_ready(building.timber)
        }
        "hunters_hall" => {
            !commodity_output_blocked(building, CommodityKind::Meat)
                && wild_stock_source_usable(building, "game", foraging_buckets)
        }
        _ => false,
    }
}

/// Returns surplus crews from authoritatively stalled processors, mines,
/// quarries, hunting halls, and seasonally active fishing camps. The legacy
/// reducer name is retained for generated-binding and save compatibility.
/// Matching inbound inputs protect recovering workshops; stored output and
/// active carts never retain production workers.
pub fn recall_target_idle_processor_labor_for_settlement(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    settlement_id: u64,
) -> u32 {
    recall_target_idle_processor_labor_for_scope(ctx, owner, Some(settlement_id))
}

fn recall_target_idle_processor_labor_for_scope(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    settlement_id: Option<u64>,
) -> u32 {
    let sim_tick = ctx
        .db
        .world_config()
        .id()
        .find(&0)
        .map(|config| config.sim_tick)
        .unwrap_or(0);
    let month = game_clock(sim_tick).month;
    let (quarry_buckets, foraging_buckets) = worksite_source_buckets(ctx);

    let buildings: Vec<Building> = ctx
        .db
        .building()
        .owner()
        .filter(&owner)
        .filter(|building| {
            building.construction_complete
                && building.assigned_labor > 0
                && settlement_id.is_none_or(|id| building.settlement_id == id)
        })
        .collect();
    let mut recalled = 0_u32;
    for mut building in buildings {
        if building_fire_state(ctx, building.id).is_some() {
            let newly_reserved = preserve_in_transit_cart_labor(ctx, building.id, 0);
            recalled =
                recalled.saturating_add(building.assigned_labor.saturating_sub(newly_reserved));
            building.assigned_labor = 0;
            ctx.db.building().id().update(building);
            continue;
        }
        let has_active_trip = building_has_active_trip(ctx, building.id);
        let (stalled, supply_en_route, has_dispatch_duty) = match building.kind.as_str() {
            kind if is_processor_output_target_kind(kind) => {
                let (stalled, supply_en_route) = processor_stall_and_recovery(ctx, &building);
                let has_output_stock = if kind == "smokehouse" {
                    crate::economy::building_preserved_food_stock(&building) > 1e-6
                } else {
                    processor_output_commodity(kind).is_some_and(|commodity| {
                        building_commodity_stock(&building, commodity) > 1e-6
                    })
                };
                (
                    stalled,
                    supply_en_route,
                    has_output_stock || has_active_trip,
                )
            }
            "mine" => {
                let source =
                    mineworks_source_commodity(&building, &quarry_buckets, &foraging_buckets);
                let (stalled, supply_en_route) = source.map_or((true, false), |commodity| {
                    let output_blocked = extraction_output_blocked(&building, commodity);
                    let support_missing = !rich_mine_supports_ready(building.timber);
                    (
                        output_blocked || support_missing,
                        !output_blocked
                            && support_missing
                            && building_has_inbound_commodity_trip(
                                ctx,
                                building.id,
                                CommodityKind::Timber,
                            ),
                    )
                });
                (
                    stalled,
                    supply_en_route,
                    building.iron > 1e-6
                        || building.salt > 1e-6
                        || building.clay > 1e-6
                        || has_active_trip,
                )
            }
            "stone_quarry" => {
                let source =
                    surface_source_commodity(&building, &quarry_buckets, &foraging_buckets);
                (
                    source.is_none_or(|commodity| extraction_output_blocked(&building, commodity)),
                    false,
                    geological_output_stock(&building) > 1e-6 || has_active_trip,
                )
            }
            "large_quarry" => {
                let source = rich_stone_source_commodity(&building, &quarry_buckets);
                let source_usable = source.is_some();
                let output_blocked =
                    source.is_none_or(|commodity| extraction_output_blocked(&building, commodity));
                let support_missing = !large_quarry_supports_ready(building.timber);
                (
                    output_blocked || !source_usable || support_missing,
                    source_usable
                        && !output_blocked
                        && support_missing
                        && building_has_inbound_commodity_trip(
                            ctx,
                            building.id,
                            CommodityKind::Timber,
                        ),
                    geological_output_stock(&building) > 1e-6 || has_active_trip,
                )
            }
            "hunters_hall" | "fishing_camp"
                if building.kind == "hunters_hall" || harvest_available("fish", month) =>
            {
                let node_kind = if building.kind == "hunters_hall" {
                    "game"
                } else {
                    "fish"
                };
                (
                    commodity_output_blocked(
                        &building,
                        if building.kind == "hunters_hall" {
                            CommodityKind::Meat
                        } else {
                            CommodityKind::Fish
                        },
                    ) || !wild_stock_source_usable(&building, node_kind, &foraging_buckets),
                    false,
                    crate::economy::building_edible_food_stock(&building) > 1e-6 || has_active_trip,
                )
            }
            _ => continue,
        };
        let Some(target_labor) = stalled_labor_target(
            building.assigned_labor,
            stalled,
            supply_en_route,
            has_dispatch_duty,
        ) else {
            continue;
        };
        if target_labor >= building.assigned_labor {
            continue;
        }
        let newly_reserved = preserve_in_transit_cart_labor(ctx, building.id, target_labor);
        recalled = recalled.saturating_add(
            building
                .assigned_labor
                .saturating_sub(target_labor)
                .saturating_sub(newly_reserved),
        );
        building.assigned_labor = target_labor;
        ctx.db.building().id().update(building);
    }

    recalled
}

#[reducer]
pub fn recall_target_idle_processor_labor(
    ctx: &ReducerContext,
    town_hall_id: u64,
) -> Result<(), String> {
    let owner = ctx.sender();
    let settlement_id = require_staffed_town_hall_settlement(ctx, owner, town_hall_id)?;
    recall_target_idle_processor_labor_for_settlement(ctx, owner, settlement_id);
    Ok(())
}

/// Deploys available settlement labor to capacity-open processors and
/// source-ready mines, quarries, clay pits, or hunting halls with round-robin
/// sharing in stable worksite order. The legacy reducer name is retained for
/// generated-binding compatibility.
fn call_up_target_ready_processor_labor_for_owner_with_policy(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    settlement_id: Option<u64>,
    require_operational_inputs: bool,
    labor_reserve: u32,
) -> u32 {
    let available_labor =
        steward_deployable_labor(available_workplace_labor(ctx, owner), labor_reserve);
    if available_labor == 0 {
        return 0;
    }
    let (quarry_buckets, foraging_buckets) = worksite_source_buckets(ctx);
    let month = if require_operational_inputs {
        let sim_tick = ctx
            .db
            .world_config()
            .id()
            .find(&0)
            .map(|config| config.sim_tick)
            .unwrap_or(0);
        Some(game_clock(sim_tick).month)
    } else {
        None
    };
    let mut candidates = Vec::new();
    for building in ctx.db.building().owner().filter(&owner).filter(|building| {
        building.construction_complete
            && settlement_id.is_none_or(|id| building.settlement_id == id)
            && building_fire_state(ctx, building.id).is_none()
    }) {
        let Some(def) = building_def(&building.kind) else {
            continue;
        };
        if building.assigned_labor >= def.max_labor {
            continue;
        }
        if !is_production_labor_kind(&building.kind)
            || !production_site_ready(&building, &quarry_buckets, &foraging_buckets)
            || month.is_some_and(|month| {
                seasonal_production_active(&building.kind, month, false) == Some(false)
            })
        {
            continue;
        }
        if require_operational_inputs && is_processor_output_target_kind(&building.kind) {
            let (stalled, supply_en_route) = processor_stall_and_recovery(ctx, &building);
            if !production_steward_callup_allowed(stalled, supply_en_route) {
                continue;
            }
        }
        candidates.push(ProcessorCallupCandidate {
            building_id: building.id,
            priority: CONSTRUCTION_PRIORITY_NORMAL,
            assigned_labor: building.assigned_labor,
            max_labor: def.max_labor,
        });
    }

    let targets = processor_callup_targets(&candidates, available_labor);
    let current_labor = candidates
        .iter()
        .map(|candidate| (candidate.building_id, candidate.assigned_labor))
        .collect::<HashMap<_, _>>();
    let called_up = targets
        .iter()
        .fold(0_u32, |total, (building_id, target_labor)| {
            let current = current_labor.get(building_id).copied().unwrap_or(0);
            total.saturating_add(target_labor.saturating_sub(current))
        });
    preempt_flexible_labor_for_workplace_callup(ctx, owner, called_up);
    for (building_id, target_labor) in targets {
        let Some(mut building) = ctx.db.building().id().find(&building_id) else {
            continue;
        };
        if building.owner != owner
            || target_labor <= building.assigned_labor
            || settlement_id.is_some_and(|id| building.settlement_id != id)
        {
            continue;
        }
        building.assigned_labor = target_labor;
        ctx.db.building().id().update(building);
    }

    called_up
}

/// The explicit Town Hall order may pre-staff an input-empty workshop so the
/// player can prepare a chain before its first cart arrives.
pub fn call_up_target_ready_processor_labor_for_settlement(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    settlement_id: u64,
) -> u32 {
    call_up_target_ready_processor_labor_for_owner_with_policy(
        ctx,
        owner,
        Some(settlement_id),
        false,
        0,
    )
}

/// Daily automation is deliberately stricter: it never recalls an input-starved
/// crew and immediately hires it back. Capacity-open workshops must have their
/// current inputs or matching inbound carts before they claim free labor.
pub fn call_up_operational_production_labor_for_settlement(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    settlement_id: u64,
    labor_reserve: u32,
) -> u32 {
    call_up_target_ready_processor_labor_for_owner_with_policy(
        ctx,
        owner,
        Some(settlement_id),
        true,
        labor_reserve,
    )
}

#[reducer]
pub fn call_up_target_ready_processor_labor(
    ctx: &ReducerContext,
    town_hall_id: u64,
) -> Result<(), String> {
    let owner = ctx.sender();
    let settlement_id = require_staffed_town_hall_settlement(ctx, owner, town_hall_id)?;
    call_up_target_ready_processor_labor_for_settlement(ctx, owner, settlement_id);
    Ok(())
}

/// Balances ordinary completed year-round workplaces. Free labor fills first;
/// higher-priority vacancies may then draw only the minimum necessary workers
/// from strictly lower tiers. Specialized crews and Town Hall clerks are never
/// displaced by this order.
#[reducer]
pub fn call_up_year_round_labor(ctx: &ReducerContext, town_hall_id: u64) -> Result<(), String> {
    let owner = ctx.sender();
    let settlement_id = require_staffed_town_hall_settlement(ctx, owner, town_hall_id)?;

    let mut available_labor = available_workplace_labor(ctx, owner);
    let mut sites = Vec::new();
    let mut fire_disabled_sites = Vec::new();
    let mut fire_recalled_labor = 0_u32;
    let cart_floors = staffed_cart_workers_by_building(ctx, owner);
    for building in ctx.db.building().owner().filter(&owner).filter(|building| {
        building.construction_complete && building.settlement_id == settlement_id
    }) {
        let Some(def) = building_def(&building.kind) else {
            continue;
        };
        if !def.accepts_labor || !is_year_round_labor_kind(&building.kind) {
            continue;
        }
        if building_fire_state(ctx, building.id).is_some() {
            if building.assigned_labor > 0 {
                let cart_floor = cart_floors.get(&building.id).copied().unwrap_or(0);
                let releasable = building.assigned_labor.saturating_sub(cart_floor);
                available_labor = available_labor.saturating_add(releasable);
                fire_recalled_labor = fire_recalled_labor.saturating_add(releasable);
                fire_disabled_sites.push(building.id);
            }
            continue;
        }
        sites.push(YearRoundLaborSite {
            building_id: building.id,
            priority: CONSTRUCTION_PRIORITY_NORMAL,
            assigned_labor: building.assigned_labor,
            minimum_labor: cart_floors.get(&building.id).copied().unwrap_or(0),
            max_labor: def.max_labor,
        });
    }

    let rotation = year_round_labor_rotation(&sites, available_labor);
    preempt_flexible_labor_for_workplace_callup(
        ctx,
        owner,
        rotation
            .called_workers
            .saturating_sub(rotation.recalled_workers)
            .saturating_sub(fire_recalled_labor),
    );
    for building_id in fire_disabled_sites {
        let Some(mut building) = ctx.db.building().id().find(&building_id) else {
            continue;
        };
        if building.owner != owner
            || building.settlement_id != settlement_id
            || building.assigned_labor == 0
        {
            continue;
        }
        let cart_floor = cart_floors.get(&building.id).copied().unwrap_or(0);
        preserve_in_transit_cart_labor(ctx, building.id, cart_floor);
        building.assigned_labor = cart_floor;
        ctx.db.building().id().update(building);
    }
    for (building_id, target_labor) in rotation.targets {
        let Some(mut building) = ctx.db.building().id().find(&building_id) else {
            continue;
        };
        if building.owner != owner
            || building.settlement_id != settlement_id
            || target_labor == building.assigned_labor
        {
            continue;
        }
        if target_labor < building.assigned_labor {
            preserve_in_transit_cart_labor(ctx, building.id, target_labor);
        }
        building.assigned_labor = target_labor;
        ctx.db.building().id().update(building);
    }

    Ok(())
}

#[reducer]
pub fn set_construction_priority(
    ctx: &ReducerContext,
    building_id: u64,
    priority: u8,
) -> Result<(), String> {
    if !is_valid_construction_priority(priority) {
        return Err("Construction priority must be hold, low, normal, or urgent.".to_string());
    }
    let owner = ctx.sender();
    let mut building = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Building not found.".to_string())?;
    if building.owner != owner {
        return Err("You do not own this building.".to_string());
    }
    if building.construction_complete {
        return Err(
            "Construction priority only applies while a building is under construction."
                .to_string(),
        );
    }

    let was_held = building.construction_priority == CONSTRUCTION_PRIORITY_HOLD;
    building.construction_priority = priority;
    if priority == CONSTRUCTION_PRIORITY_HOLD {
        preserve_in_transit_cart_labor(ctx, building.id, 0);
        building.assigned_labor = 0;
    } else if was_held && building.assigned_labor == 0 {
        building.assigned_labor = initial_construction_labor(available_building_labor(ctx, owner));
    }
    ctx.db.building().id().update(building);
    if priority == CONSTRUCTION_PRIORITY_HOLD {
        cancel_inbound_construction_trips_for_site(ctx, building_id);
    }
    Ok(())
}

#[reducer]
pub fn set_storehouse_policy(
    ctx: &ReducerContext,
    building_id: u64,
    accepts_timber: bool,
    accepts_stone: bool,
    accepts_firewood: bool,
    accepts_charcoal: bool,
    accepts_iron: bool,
    accepts_clay: bool,
    accepts_salt: bool,
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
    building.storehouse_accepts_charcoal = accepts_charcoal;
    building.storehouse_accepts_iron = accepts_iron;
    building.storehouse_accepts_clay = accepts_clay;
    building.storehouse_accepts_salt = accepts_salt;
    for (commodity, accepts) in [
        (CommodityKind::Timber, accepts_timber),
        (CommodityKind::Stone, accepts_stone),
        (CommodityKind::Firewood, accepts_firewood),
        (CommodityKind::Charcoal, accepts_charcoal),
        (CommodityKind::Iron, accepts_iron),
        (CommodityKind::Clay, accepts_clay),
        (CommodityKind::Salt, accepts_salt),
    ] {
        let (low, high) = set_storage_masks_commodity(
            building.storage_acceptance_mask,
            building.storage_acceptance_mask_high,
            commodity.as_u8(),
            accepts,
        );
        building.storage_acceptance_mask = low;
        building.storage_acceptance_mask_high = high;
    }
    ctx.db.building().id().update(building);
    Ok(())
}

#[reducer]
pub fn set_storage_commodity_acceptance(
    ctx: &ReducerContext,
    building_id: u64,
    commodity_kind: u8,
    accepts: bool,
) -> Result<(), String> {
    let owner = ctx.sender();
    let mut building = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Storage building not found.".to_string())?;
    if building.owner != owner
        || !matches!(building.kind.as_str(), "village_storehouse" | "granary")
        || !building.construction_complete
    {
        return Err("You do not own this completed storage building.".to_string());
    }
    if !storage_kind_supports_commodity(&building.kind, commodity_kind) {
        return Err("That commodity cannot be stored in this building.".to_string());
    }
    let (low, high) = set_storage_masks_commodity(
        building.storage_acceptance_mask,
        building.storage_acceptance_mask_high,
        commodity_kind,
        accepts,
    );
    building.storage_acceptance_mask = low;
    building.storage_acceptance_mask_high = high;
    if let Some(commodity) = CommodityKind::from_u8(commodity_kind) {
        match (building.kind.as_str(), commodity) {
            ("village_storehouse", CommodityKind::Timber) => {
                building.storehouse_accepts_timber = accepts
            }
            ("village_storehouse", CommodityKind::Stone) => {
                building.storehouse_accepts_stone = accepts
            }
            ("village_storehouse", CommodityKind::Firewood) => {
                building.storehouse_accepts_firewood = accepts
            }
            ("village_storehouse", CommodityKind::Charcoal) => {
                building.storehouse_accepts_charcoal = accepts
            }
            ("village_storehouse", CommodityKind::Iron) => {
                building.storehouse_accepts_iron = accepts
            }
            ("village_storehouse", CommodityKind::Clay) => {
                building.storehouse_accepts_clay = accepts
            }
            ("village_storehouse", CommodityKind::Salt) => {
                building.storehouse_accepts_salt = accepts
            }
            ("granary", commodity)
                if accepts && (commodity.is_fresh_food() || commodity.is_preserved_food()) =>
            {
                // An old save may have the former aggregate intake switch off.
                // Enabling one detailed food filter must make that choice effective.
                building.granary_accepts_fresh_food = true;
            }
            _ => {}
        }
    }
    ctx.db.building().id().update(building);
    Ok(())
}

#[reducer]
pub fn set_all_storage_acceptance(
    ctx: &ReducerContext,
    building_id: u64,
    accepts: bool,
) -> Result<(), String> {
    let owner = ctx.sender();
    let mut building = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Storage building not found.".to_string())?;
    if building.owner != owner
        || !matches!(building.kind.as_str(), "village_storehouse" | "granary")
        || !building.construction_complete
    {
        return Err("You do not own this completed storage building.".to_string());
    }
    let (low, high) = set_storage_masks_all(
        building.storage_acceptance_mask,
        building.storage_acceptance_mask_high,
        &building.kind,
        accepts,
    );
    building.storage_acceptance_mask = low;
    building.storage_acceptance_mask_high = high;
    if building.kind == "village_storehouse" {
        building.storehouse_accepts_timber = accepts;
        building.storehouse_accepts_stone = accepts;
        building.storehouse_accepts_firewood = accepts;
        building.storehouse_accepts_charcoal = accepts;
        building.storehouse_accepts_iron = accepts;
        building.storehouse_accepts_clay = accepts;
        building.storehouse_accepts_salt = accepts;
    } else {
        building.granary_accepts_fresh_food = accepts;
    }
    ctx.db.building().id().update(building);
    Ok(())
}

#[reducer]
pub fn set_storehouse_stock_target(
    ctx: &ReducerContext,
    building_id: u64,
    commodity: String,
    target_percent: u8,
) -> Result<(), String> {
    if !is_valid_storehouse_stock_target_percent(target_percent) {
        return Err("Storehouse stock target must be 25%, 50%, 75%, or 100%.".to_string());
    }
    let owner = ctx.sender();
    let mut building = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Village storehouse not found.".to_string())?;
    if building.owner != owner
        || building.kind != "village_storehouse"
        || !building.construction_complete
    {
        return Err("You do not own this completed village storehouse.".to_string());
    }
    match commodity.as_str() {
        "timber" => building.storehouse_timber_target_percent = target_percent,
        "stone" => building.storehouse_stone_target_percent = target_percent,
        "firewood" => building.storehouse_firewood_target_percent = target_percent,
        "charcoal" => building.storehouse_charcoal_target_percent = target_percent,
        "iron" => building.storehouse_iron_target_percent = target_percent,
        "clay" => building.storehouse_clay_target_percent = target_percent,
        "salt" => building.storehouse_salt_target_percent = target_percent,
        _ => return Err(
            "Storehouse stock target applies only to timber, stone, firewood, charcoal, iron, clay, or salt."
                .to_string(),
        ),
    }
    ctx.db.building().id().update(building);
    Ok(())
}

#[reducer]
pub fn set_livestock_milk_use_policy(
    ctx: &ReducerContext,
    building_id: u64,
    milk_use_policy: u8,
) -> Result<(), String> {
    if !is_valid_milk_use_policy(milk_use_policy) {
        return Err("Milk use must be Fresh milk, Balanced, or Cheese first.".to_string());
    }
    let owner = ctx.sender();
    let mut building = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Pastoral holding not found.".to_string())?;
    if building.owner != owner
        || building.kind != "pastoral_farmstead"
        || !building.construction_complete
    {
        return Err("You do not own this completed pastoral holding.".to_string());
    }
    building.milk_use_policy = milk_use_policy;
    ctx.db.building().id().update(building);
    Ok(())
}

#[reducer]
pub fn set_brewery_recipe_policy(
    ctx: &ReducerContext,
    building_id: u64,
    recipe_policy: u8,
) -> Result<(), String> {
    if !is_valid_brewery_recipe_policy(recipe_policy) {
        return Err(
            "Brewery recipe must be Ale, Apple Cider, Pear Cider, Mead, or Auto.".to_string(),
        );
    }
    let owner = ctx.sender();
    let mut building = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Brewhouse not found.".to_string())?;
    if building.owner != owner || building.kind != "brewery" || !building.construction_complete {
        return Err("You do not own this completed brewhouse.".to_string());
    }
    building.brewery_recipe_policy = recipe_policy;
    ctx.db.building().id().update(building);
    Ok(())
}

#[reducer]
pub fn set_smokehouse_recipe_policy(
    ctx: &ReducerContext,
    building_id: u64,
    recipe_policy: u8,
) -> Result<(), String> {
    if !is_valid_smokehouse_recipe_policy(recipe_policy) {
        return Err(
            "Smokehouse recipe must be Auto, Cured Meat, Smoked Fish, or Cheese.".to_string(),
        );
    }
    let owner = ctx.sender();
    let mut building = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Smokehouse not found.".to_string())?;
    if building.owner != owner || building.kind != "smokehouse" || !building.construction_complete {
        return Err("You do not own this completed smokehouse.".to_string());
    }
    building.smokehouse_recipe_policy = recipe_policy;
    ctx.db.building().id().update(building);
    Ok(())
}

#[reducer]
pub fn set_building_production_rate(
    ctx: &ReducerContext,
    building_id: u64,
    rate_percent: u8,
) -> Result<(), String> {
    if !is_valid_production_rate_percent(rate_percent) {
        return Err("Production rate must be between 0% and 100%.".to_string());
    }
    let owner = ctx.sender();
    let mut building = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Production building not found.".to_string())?;
    if building.owner != owner
        || !building.construction_complete
        || !is_production_rate_kind(&building.kind)
    {
        return Err(
            "You do not own this completed ironwork-maintained production building.".to_string(),
        );
    }
    building.production_rate_percent = rate_percent;
    ctx.db.building().id().update(building);
    Ok(())
}

#[reducer]
pub fn set_threshing_priority(
    ctx: &ReducerContext,
    building_id: u64,
    priority: u8,
) -> Result<(), String> {
    if !is_valid_threshing_priority(priority) {
        return Err("Threshing priority must be Low, Auto, or High.".to_string());
    }
    let owner = ctx.sender();
    let mut building = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Farmstead not found.".to_string())?;
    if building.owner != owner
        || building.kind != "threshing_barn"
        || !building.construction_complete
    {
        return Err("You do not own this completed farmstead.".to_string());
    }
    building.threshing_priority = priority;
    ctx.db.building().id().update(building);
    Ok(())
}

#[reducer]
pub fn set_weaver_input_policy(
    ctx: &ReducerContext,
    building_id: u64,
    input_policy: u8,
) -> Result<(), String> {
    if !is_valid_weaver_input_policy(input_policy) {
        return Err("Textile recipe must be Auto, Yarn, or Linen.".to_string());
    }
    let owner = ctx.sender();
    let mut building = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Textile workshop not found.".to_string())?;
    if building.owner != owner
        || !matches!(building.kind.as_str(), "spinning_retting_house" | "weaver")
        || !building.construction_complete
    {
        return Err("You do not own this completed textile workshop.".to_string());
    }
    building.weaver_input_policy = input_policy;
    ctx.db.building().id().update(building);
    Ok(())
}

#[reducer]
pub fn set_potter_firing_policy(
    ctx: &ReducerContext,
    building_id: u64,
    firing_policy: u8,
) -> Result<(), String> {
    if !is_valid_potter_firing_policy(firing_policy) {
        return Err("Kiln firing must produce vessels or fired roof tiles.".to_string());
    }
    let owner = ctx.sender();
    let mut building = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Potter kiln not found.".to_string())?;
    if building.owner != owner || building.kind != "potter_kiln" || !building.construction_complete
    {
        return Err("You do not own this completed potter kiln.".to_string());
    }
    building.potter_firing_policy = firing_policy;
    ctx.db.building().id().update(building);
    Ok(())
}

#[reducer]
pub fn set_granary_policy(
    ctx: &ReducerContext,
    building_id: u64,
    accepts_fresh_food: bool,
    households_first: bool,
) -> Result<(), String> {
    let owner = ctx.sender();
    let mut building = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Granary not found.".to_string())?;
    if building.owner != owner || building.kind != "granary" || !building.construction_complete {
        return Err("You do not own this village granary.".to_string());
    }
    building.granary_accepts_fresh_food = accepts_fresh_food;
    building.granary_households_first = households_first;
    for commodity in [
        CommodityKind::OatGrain,
        CommodityKind::RyeBread,
        CommodityKind::MaslinBread,
        CommodityKind::Meat,
        CommodityKind::Fish,
        CommodityKind::Berries,
        CommodityKind::Mushrooms,
        CommodityKind::Milk,
        CommodityKind::Apples,
        CommodityKind::Cherries,
        CommodityKind::Eggs,
        CommodityKind::Grapes,
        CommodityKind::PreservedFood,
        CommodityKind::CuredMeat,
        CommodityKind::SmokedFish,
        CommodityKind::Cheese,
    ] {
        let (low, high) = set_storage_masks_commodity(
            building.storage_acceptance_mask,
            building.storage_acceptance_mask_high,
            commodity.as_u8(),
            accepts_fresh_food,
        );
        building.storage_acceptance_mask = low;
        building.storage_acceptance_mask_high = high;
    }
    ctx.db.building().id().update(building);
    Ok(())
}

#[reducer]
pub fn set_granary_grain_reserve(
    ctx: &ReducerContext,
    building_id: u64,
    grain_reserve: f64,
) -> Result<(), String> {
    if !grain_reserve.is_finite() {
        return Err("Granary grain reserve must be a finite amount.".to_string());
    }
    let owner = ctx.sender();
    let mut building = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Granary not found.".to_string())?;
    if building.owner != owner || building.kind != "granary" || !building.construction_complete {
        return Err("You do not own this completed village granary.".to_string());
    }
    building.granary_grain_reserve = normalize_granary_grain_reserve(grain_reserve);
    ctx.db.building().id().update(building);
    Ok(())
}

#[reducer]
pub fn set_granary_fresh_food_target(
    ctx: &ReducerContext,
    building_id: u64,
    target_percent: u8,
) -> Result<(), String> {
    if !is_valid_granary_fresh_food_target_percent(target_percent) {
        return Err("Granary fresh-food target must be 25%, 50%, 75%, or 90%.".to_string());
    }
    let owner = ctx.sender();
    let mut building = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Granary not found.".to_string())?;
    if building.owner != owner || building.kind != "granary" || !building.construction_complete {
        return Err("You do not own this completed village granary.".to_string());
    }
    building.granary_fresh_food_target_percent = target_percent;
    ctx.db.building().id().update(building);
    Ok(())
}

#[reducer]
pub fn set_woodcutter_timber_reserve(
    ctx: &ReducerContext,
    building_id: u64,
    timber_reserve: f64,
) -> Result<(), String> {
    if !timber_reserve.is_finite() {
        return Err("Woodcutter timber reserve must be a finite amount.".to_string());
    }
    let owner = ctx.sender();
    let mut building = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Woodcutter's lodge not found.".to_string())?;
    if building.owner != owner
        || building.kind != "woodcutters_lodge"
        || !building.construction_complete
    {
        return Err("You do not own this completed woodcutter's lodge.".to_string());
    }
    building.woodcutter_timber_reserve = normalize_woodcutter_timber_reserve(timber_reserve);
    ctx.db.building().id().update(building);
    Ok(())
}

#[reducer]
pub fn set_tree_work_area(
    ctx: &ReducerContext,
    building_id: u64,
    x: f64,
    z: f64,
    radius: f64,
) -> Result<(), String> {
    validate_tree_work_area(x, z, radius).map_err(str::to_string)?;

    let owner = ctx.sender();
    let mut building = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Tree-work building not found.".to_string())?;
    if building.owner != owner
        || !building.construction_complete
        || !supports_tree_work_area(&building.kind)
    {
        return Err("You do not own this completed tree-work building.".to_string());
    }

    building.tree_work_area_x = x;
    building.tree_work_area_z = z;
    building.tree_work_area_radius = radius;
    ctx.db.building().id().update(building);
    Ok(())
}

#[reducer]
pub fn clear_tree_work_area(ctx: &ReducerContext, building_id: u64) -> Result<(), String> {
    let owner = ctx.sender();
    let mut building = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Tree-work building not found.".to_string())?;
    if building.owner != owner
        || !building.construction_complete
        || !supports_tree_work_area(&building.kind)
    {
        return Err("You do not own this completed tree-work building.".to_string());
    }

    building.tree_work_area_x = 0.0;
    building.tree_work_area_z = 0.0;
    building.tree_work_area_radius = 0.0;
    ctx.db.building().id().update(building);
    Ok(())
}

#[reducer]
pub fn set_carpenter_polearm_reserve(
    ctx: &ReducerContext,
    building_id: u64,
    polearm_reserve: u8,
) -> Result<(), String> {
    if !is_valid_carpenter_polearm_reserve(polearm_reserve) {
        return Err("Carpenter polearm reserve must be 0, 2, 6, 12, or 24.".to_string());
    }
    let owner = ctx.sender();
    let mut building = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Carpenter workshop not found.".to_string())?;
    if building.owner != owner || building.kind != "carpenter" || !building.construction_complete {
        return Err("You do not own this completed carpenter workshop.".to_string());
    }
    building.carpenter_polearm_reserve = polearm_reserve;
    ctx.db.building().id().update(building);
    Ok(())
}

#[reducer]
pub fn set_carpenter_cart_service_target(
    ctx: &ReducerContext,
    building_id: u64,
    target_trips: u8,
) -> Result<(), String> {
    if !is_valid_carpenter_cart_service_target(target_trips) {
        return Err("Carpenter cart-service target must be 0, 5, 15, or 30 trips.".to_string());
    }
    let owner = ctx.sender();
    let mut building = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Carpenter workshop not found.".to_string())?;
    if building.owner != owner || building.kind != "carpenter" || !building.construction_complete {
        return Err("You do not own this completed carpenter workshop.".to_string());
    }
    building.carpenter_cart_service_target_trips = target_trips;
    ctx.db.building().id().update(building);
    Ok(())
}

#[reducer]
pub fn set_guardhouse_muster_post(
    ctx: &ReducerContext,
    building_id: u64,
    watchtower_id: u64,
) -> Result<(), String> {
    let owner = ctx.sender();
    let mut guardhouse = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Guardhouse not found.".to_string())?;
    if guardhouse.owner != owner
        || guardhouse.kind != "guardhouse"
        || !guardhouse.construction_complete
    {
        return Err("You do not own this completed guardhouse.".to_string());
    }
    if watchtower_id != 0 {
        let watchtower = ctx
            .db
            .building()
            .id()
            .find(&watchtower_id)
            .ok_or_else(|| "Muster watchtower not found.".to_string())?;
        if watchtower.owner != owner
            || watchtower.kind != "watchtower"
            || !watchtower.construction_complete
        {
            return Err("Choose one of your completed frontier watchtowers.".to_string());
        }
    }
    guardhouse.guardhouse_muster_watchtower_id = watchtower_id;
    ctx.db.building().id().update(guardhouse);
    Ok(())
}

#[reducer]
pub fn set_marketplace_ironwork_target(
    ctx: &ReducerContext,
    building_id: u64,
    ironwork_target: u8,
) -> Result<(), String> {
    if !is_valid_marketplace_ironwork_target(ironwork_target) {
        return Err("Marketplace ironwork target must be 0, 6, 12, 24, or 48.".to_string());
    }
    let owner = ctx.sender();
    let mut building = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Marketplace not found.".to_string())?;
    if building.owner != owner || building.kind != "marketplace" || !building.construction_complete
    {
        return Err("You do not own this completed marketplace.".to_string());
    }
    building.marketplace_ironwork_target = ironwork_target;
    ctx.db.building().id().update(building);
    Ok(())
}

#[reducer]
pub fn set_marketplace_iron_target(
    ctx: &ReducerContext,
    building_id: u64,
    iron_target: u8,
) -> Result<(), String> {
    if !is_valid_marketplace_iron_target(iron_target) {
        return Err("Marketplace iron target must be 0, 12, 24, 36, or 48.".to_string());
    }
    let owner = ctx.sender();
    let mut building = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Marketplace not found.".to_string())?;
    if building.owner != owner || building.kind != "marketplace" || !building.construction_complete
    {
        return Err("You do not own this completed marketplace.".to_string());
    }
    building.marketplace_iron_target = iron_target;
    ctx.db.building().id().update(building);
    Ok(())
}

#[reducer]
pub fn set_marketplace_salt_target(
    ctx: &ReducerContext,
    building_id: u64,
    salt_target: u8,
) -> Result<(), String> {
    if !is_valid_marketplace_salt_target(salt_target) {
        return Err("Marketplace salt target must be 0, 12, 24, 48, or 72.".to_string());
    }
    let owner = ctx.sender();
    let mut building = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Marketplace not found.".to_string())?;
    if building.owner != owner || building.kind != "marketplace" || !building.construction_complete
    {
        return Err("You do not own this completed marketplace.".to_string());
    }
    building.marketplace_salt_target = salt_target;
    ctx.db.building().id().update(building);
    Ok(())
}

#[reducer]
pub fn set_marketplace_seed_grain_target(
    ctx: &ReducerContext,
    building_id: u64,
    seed_grain_target: u8,
) -> Result<(), String> {
    if !is_valid_marketplace_seed_grain_target(seed_grain_target) {
        return Err("Marketplace seed-grain target must be 0, 24, 48, 72, or 96.".to_string());
    }
    let owner = ctx.sender();
    let mut building = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Marketplace not found.".to_string())?;
    if building.owner != owner || building.kind != "marketplace" || !building.construction_complete
    {
        return Err("You do not own this completed marketplace.".to_string());
    }
    building.marketplace_seed_grain_target = seed_grain_target;
    ctx.db.building().id().update(building);
    Ok(())
}

#[reducer]
pub fn set_marketplace_gold_reserve_target(
    ctx: &ReducerContext,
    building_id: u64,
    gold_reserve_target: u8,
) -> Result<(), String> {
    if !is_valid_marketplace_gold_reserve_target(gold_reserve_target) {
        return Err("Marketplace cash reserve must be 0, 16, 32, or 64 gold.".to_string());
    }
    let owner = ctx.sender();
    let mut building = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Marketplace not found.".to_string())?;
    if building.owner != owner || building.kind != "marketplace" || !building.construction_complete
    {
        return Err("Marketplace not found.".to_string());
    }
    building.marketplace_gold_reserve_target = gold_reserve_target;
    ctx.db.building().id().update(building);
    Ok(())
}

#[reducer]
pub fn set_marketplace_specialty_export_policy(
    ctx: &ReducerContext,
    building_id: u64,
    export_policy: u8,
) -> Result<(), String> {
    if !is_valid_specialty_export_policy(export_policy) {
        return Err(
            "Marketplace specialty export policy must be any-rate, fair-rate, or favorable-rate."
                .to_string(),
        );
    }
    let owner = ctx.sender();
    let mut building = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Marketplace not found.".to_string())?;
    if building.owner != owner || building.kind != "trading_post" || !building.construction_complete
    {
        return Err("You do not own this completed Trading Post.".to_string());
    }
    building.marketplace_specialty_export_policy = export_policy;
    building.marketplace_drink_export_policy = export_policy;
    building.marketplace_provision_export_policy = export_policy;
    building.marketplace_wares_export_policy = export_policy;
    ctx.db.building().id().update(building);
    Ok(())
}

#[reducer]
pub fn set_marketplace_specialty_family_export_policy(
    ctx: &ReducerContext,
    building_id: u64,
    family: u8,
    export_policy: u8,
) -> Result<(), String> {
    if !is_valid_specialty_export_policy(export_policy) {
        return Err(
            "Specialty family policy must be any-rate, fair-rate, or favorable-rate.".to_string(),
        );
    }
    let family = SpecialtyMarketFamily::from_id(family)
        .ok_or_else(|| "Specialty family must be drinks, provisions, or wares.".to_string())?;
    let owner = ctx.sender();
    let mut building = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Trading Post not found.".to_string())?;
    if building.owner != owner || building.kind != "trading_post" || !building.construction_complete
    {
        return Err("You do not own this completed Trading Post.".to_string());
    }
    match family {
        SpecialtyMarketFamily::Drink => building.marketplace_drink_export_policy = export_policy,
        SpecialtyMarketFamily::Provision => {
            building.marketplace_provision_export_policy = export_policy
        }
        SpecialtyMarketFamily::Wares => building.marketplace_wares_export_policy = export_policy,
    }
    ctx.db.building().id().update(building);
    Ok(())
}

#[reducer]
pub fn set_apiary_harvest_policy(
    ctx: &ReducerContext,
    building_id: u64,
    harvest_policy: u8,
) -> Result<(), String> {
    if !is_valid_apiary_harvest_policy(harvest_policy) {
        return Err("Apiary policy must be Conservative, Balanced, or Extractive.".to_string());
    }
    let owner = ctx.sender();
    let mut building = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Apiary not found.".to_string())?;
    if building.owner != owner || building.kind != "apiary" || !building.construction_complete {
        return Err("You do not own this completed apiary.".to_string());
    }
    building.apiary_harvest_policy = harvest_policy;
    ctx.db.building().id().update(building);
    Ok(())
}

#[reducer]
pub fn set_harvest_reserve_percent(
    ctx: &ReducerContext,
    building_id: u64,
    reserve_percent: u8,
) -> Result<(), String> {
    let owner = ctx.sender();
    let mut building = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Wild-food camp not found.".to_string())?;
    if building.owner != owner
        || !matches!(
            building.kind.as_str(),
            "foragers_shed" | "hunters_hall" | "fishing_camp"
        )
        || !building.construction_complete
    {
        return Err("You do not own this completed wild-food camp.".to_string());
    }
    building.harvest_reserve_percent = normalize_harvest_reserve_percent(reserve_percent);
    ctx.db.building().id().update(building);
    Ok(())
}

#[reducer]
pub fn collect_chapel_coffer(ctx: &ReducerContext, building_id: u64) -> Result<(), String> {
    let owner = ctx.sender();
    ensure_player_resources(ctx, owner);
    let chapel = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Chapel not found.".to_string())?;
    if chapel.owner != owner {
        return Err("You do not own this chapel.".to_string());
    }
    if chapel.kind != "chapel" {
        return Err("Building is not a chapel.".to_string());
    }
    if !chapel.construction_complete {
        return Err("The chapel is still under construction.".to_string());
    }
    Err(
        "Parish tithes belong to the church and cannot be transferred to the civic treasury."
            .to_string(),
    )
}

#[reducer]
pub fn demolish_building(ctx: &ReducerContext, building_id: u64) -> Result<(), String> {
    let owner = ctx.sender();
    ensure_player_resources(ctx, owner);

    let mut building = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Building not found.".to_string())?;

    if building.owner != owner {
        return Err("You do not own this building.".to_string());
    }
    if building.kind == "founders_camp" && building.construction_complete {
        return Err(
            "The founders' camp clears itself after its people are housed and its stores are moved."
                .to_string(),
        );
    }
    if building.kind == "founders_camp" {
        building.settlement_id = crate::settlements::cancel_planned_settlement(
            ctx,
            owner,
            building.settlement_id,
            building.id,
            building.x,
            building.z,
        )?
        .unwrap_or(0);
    }
    if building.kind == "salvage_pile" {
        return Err(
            "A reclamation pile clears itself after its goods are physically recovered."
                .to_string(),
        );
    }
    if matches!(
        building.kind.as_str(),
        "town_hall" | "guardhouse" | "cavalry_yard"
    ) {
        let attached_companies = ctx
            .db
            .military_company()
            .iter()
            .filter(|company| company.source_building_id == building_id)
            .count();
        if attached_companies > 0 {
            return Err(format!(
                "Disband the {} attached military compan{} before demolition.",
                attached_companies,
                if attached_companies == 1 { "y" } else { "ies" },
            ));
        }
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
        && (ctx
            .db
            .pasture_herd()
            .farmstead_id()
            .filter(&building_id)
            .any(|herd| herd.head_count > 0)
            || ctx
                .db
                .livestock_herd()
                .building_id()
                .find(&building_id)
                .is_some_and(|herd| herd.head_count > 0))
    {
        return Err("Sell this livestock holding's animals before demolition.".to_string());
    }
    if building.kind == "pastoral_farmstead"
        && ctx
            .db
            .pasture()
            .farmstead_id()
            .filter(&building_id)
            .any(|pasture| {
                ctx.db
                    .cavalry_horse()
                    .pasture_id()
                    .filter(&pasture.id)
                    .next()
                    .is_some()
            })
    {
        return Err(
            "Every horse, including deployed mounts with a reserved home here, must be sold before demolition."
                .to_string(),
        );
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
    if building.kind == "chapel"
        && ctx
            .db
            .graveyard()
            .chapel_id()
            .filter(&building_id)
            .next()
            .is_some()
    {
        return Err("This chapel still has consecrated burial ground attached.".to_string());
    }

    if building.kind == "town_hall" {
        crate::settlements::unlink_town_hall(ctx, building.settlement_id, building.id);
    }
    let fire_damaged = building_fire_state(ctx, building_id).is_some();
    clear_fire_for_target(ctx, FIRE_TARGET_BUILDING, building_id);
    let gold_refund = if is_expansion_founders_camp(&building) {
        founders_camp_gold_refund(
            building_def_or_err(&building.kind)?.cost_gold,
            building.construction_complete,
            fire_damaged,
        )
    } else {
        0.0
    };

    let refund = if fire_damaged {
        crate::economy::ResourceAmount {
            timber: 0.0,
            stone: 0.0,
            ironwork: 0.0,
            roof_tiles: 0.0,
        }
    } else if building.construction_complete {
        building_salvage_refund(&building.kind)?
    } else {
        crate::economy::ResourceAmount {
            timber: whole_units(
                building.construction_delivered_timber
                    * crate::balance_generated::TIMBER_SALVAGE_FRACTION,
            ),
            stone: whole_units(
                building.construction_delivered_stone
                    * crate::balance_generated::STONE_SALVAGE_FRACTION,
            ),
            ironwork: whole_units(
                building.construction_delivered_ironwork
                    * crate::balance_generated::IRONWORK_SALVAGE_FRACTION,
            ),
            roof_tiles: whole_units(
                building.construction_delivered_roof_tiles
                    * crate::balance_generated::RESIDENCE_TILE_ROOF_SALVAGE_FRACTION,
            ),
        }
    };
    if building.kind == "trading_post" {
        for rule in ctx
            .db
            .trading_post_trade_rule()
            .building_id()
            .filter(&building_id)
            .collect::<Vec<_>>()
        {
            ctx.db.trading_post_trade_rule().id().delete(&rule.id);
        }
    }

    if building.kind == "watchtower" {
        let assigned_guardhouses = ctx
            .db
            .building()
            .owner()
            .filter(&owner)
            .filter(|candidate| {
                candidate.kind == "guardhouse"
                    && candidate.guardhouse_muster_watchtower_id == building_id
            })
            .collect::<Vec<_>>();
        for mut guardhouse in assigned_guardhouses {
            guardhouse.guardhouse_muster_watchtower_id = 0;
            ctx.db.building().id().update(guardhouse);
        }
    }

    if ctx
        .db
        .livestock_herd()
        .building_id()
        .find(&building_id)
        .is_some()
    {
        ctx.db.livestock_herd().building_id().delete(&building_id);
    }
    for herd in ctx
        .db
        .pasture_herd()
        .farmstead_id()
        .filter(&building_id)
        .collect::<Vec<_>>()
    {
        ctx.db.pasture_herd().pasture_id().delete(&herd.pasture_id);
    }
    for parcel in ctx
        .db
        .vineyard_parcel()
        .building_id()
        .filter(&building_id)
        .collect::<Vec<_>>()
    {
        ctx.db.vineyard_parcel().id().delete(parcel.id);
    }
    // A posted ox survives demolition of its workplace and returns to the
    // automatic pool. Active cart reservations remain authoritative until the
    // trip completes, so only the durable posting changes here.
    for mut ox in ctx
        .db
        .stable_ox()
        .assigned_building_id()
        .filter(&building_id)
        .collect::<Vec<_>>()
    {
        ox.assigned_building_id = 0;
        ctx.db.stable_ox().id().update(ox);
    }
    // Hunting dogs survive demolition of their assigned camp and return to
    // ordinary settlement patrol. Their kennel ownership is unchanged.
    for mut dog in ctx
        .db
        .combat_agent()
        .assigned_building_id()
        .filter(&building_id)
        .filter(|agent| agent.faction == crate::reducers::kennel_dogs::GUARD_DOG_FACTION)
        .collect::<Vec<_>>()
    {
        dog.assigned_building_id = 0;
        dog.target_kind = 0;
        dog.target_id = dog.source_building_id;
        ctx.db.combat_agent().id().update(dog);
    }

    // Physical demolition may repurpose this exact Building row into a
    // salvage pile, so remove stable-owned animals before that identity can
    // change kind and leave orphaned ox rows behind.
    for ox in ctx
        .db
        .stable_ox()
        .stable_id()
        .filter(&building_id)
        .collect::<Vec<_>>()
    {
        for mut trip in ctx
            .db
            .delivery_trip()
            .owner()
            .filter(&owner)
            .filter(|trip| trip.ox_id == ox.id)
            .collect::<Vec<_>>()
        {
            // The loaded cart remains valid, but a demolished stable cannot
            // leave a durable trip reservation pointing at a deleted animal.
            trip.ox_id = 0;
            ctx.db.delivery_trip().id().update(trip);
        }
        ctx.db.stable_ox().id().delete(ox.id);
    }

    // Kennel dogs are durable combat agents, so remove the kennel's roster
    // before this Building id can be reused by a physical salvage pile.
    // Without this cleanup, demolishing and rebuilding could bypass the
    // per-kennel capacity and leave dogs patrolling without a home kennel.
    if building.kind == "kennel" {
        for dog in ctx
            .db
            .combat_agent()
            .owner()
            .filter(&owner)
            .filter(|agent| {
                agent.faction == crate::reducers::kennel_dogs::GUARD_DOG_FACTION
                    && agent.source_building_id == building_id
            })
            .collect::<Vec<_>>()
        {
            ctx.db.combat_agent().id().delete(dog.id);
        }
    }

    let physical_reclamation = ctx
        .db
        .player_resources()
        .owner()
        .find(&owner)
        .is_some_and(|resources| resources.physical_founding_site_enabled);
    if physical_reclamation {
        let recovered_inventory = if fire_damaged {
            ReclamationStock::default()
        } else {
            ReclamationStock::from_building(&building)
        };
        let recovered_inventory = recovered_inventory.merged(ReclamationStock {
            timber: refund.timber,
            stone: refund.stone,
            ironwork: refund.ironwork,
            roof_tiles: refund.roof_tiles,
            gold: gold_refund,
            ..ReclamationStock::default()
        });
        let salvage_def = building_def("salvage_pile")
            .ok_or_else(|| "Reclamation pile balance is missing.".to_string())?;
        let mut pile = Building {
            kind: "salvage_pile".into(),
            work_radius: salvage_def.work_radius,
            action_cooldown: 0.0,
            water_capacity: 0.0,
            assigned_labor: 0,
            construction_complete: true,
            construction_progress: 1.0,
            construction_required_timber: 0.0,
            construction_required_stone: 0.0,
            construction_required_ironwork: 0.0,
            construction_delivered_timber: 0.0,
            construction_delivered_stone: 0.0,
            construction_delivered_ironwork: 0.0,
            construction_reserved_timber: 0.0,
            construction_reserved_stone: 0.0,
            construction_reserved_ironwork: 0.0,
            construction_treasury_timber: 0.0,
            construction_treasury_stone: 0.0,
            construction_treasury_ironwork: 0.0,
            construction_required_roof_tiles: 0.0,
            construction_delivered_roof_tiles: 0.0,
            construction_reserved_roof_tiles: 0.0,
            construction_treasury_roof_tiles: 0.0,
            construction_priority: CONSTRUCTION_PRIORITY_NORMAL,
            founding_shelter_active: false,
            marketplace_pending_trade_code: 0,
            marketplace_gold_reserve_target: MARKETPLACE_GOLD_RESERVE_DEFAULT,
            chapel_monastery_tithe_due: 0.0,
            civic_receipts_gold: 0.0,
            private_export_proceeds_gold: 0.0,
            remote_work_camp_enabled: false,
            linked_worksite_id: 0,
            ..building
        };
        recovered_inventory.replace_building_inventory(&mut pile);
        ctx.db.building().id().update(pile);
        return Ok(());
    }

    // Legacy saves retain their abstract refunds. Remove the source before
    // crediting recovered cargo so it cannot receive its own refund.
    let trip_cargo = drain_trips_for_building(ctx, building_id);
    let recovered_inventory = if fire_damaged {
        ReclamationStock::default()
    } else {
        ReclamationStock::from_building(&building)
            .merged(ReclamationStock::from_delivery_cargo(&trip_cargo))
    }
    .merged(ReclamationStock {
        timber: refund.timber,
        stone: refund.stone,
        ironwork: refund.ironwork,
        roof_tiles: refund.roof_tiles,
        gold: gold_refund,
        ..ReclamationStock::default()
    });
    ctx.db.building().id().delete(building_id);

    for commodity in ReclamationStock::commodities() {
        credit_treasury_commodity(ctx, owner, commodity, recovered_inventory.amount(commodity));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn founder_camp_expansion_marker_requires_a_material_cost() {
        assert!(!has_nonzero_construction_requirements(0.0, 0.0, 0.0, 0.0));
        assert!(has_nonzero_construction_requirements(1.0, 0.0, 0.0, 0.0));
        assert!(has_nonzero_construction_requirements(0.0, 1.0, 0.0, 0.0));
        assert!(has_nonzero_construction_requirements(0.0, 0.0, 1.0, 0.0));
        assert!(has_nonzero_construction_requirements(0.0, 0.0, 0.0, 1.0));
    }

    #[test]
    fn founder_camp_gold_refunds_follow_construction_and_fire_state() {
        let cost = 100.0;
        assert_eq!(founders_camp_gold_refund(cost, false, false), cost);
        assert_eq!(
            founders_camp_gold_refund(cost, true, false),
            whole_units(cost * GOLD_SALVAGE_FRACTION)
        );
        let fractional_cost = 101.2;
        assert_eq!(
            founders_camp_gold_refund(fractional_cost, false, false),
            102.0
        );
        assert_eq!(
            founders_camp_gold_refund(fractional_cost, true, false),
            whole_units(102.0 * GOLD_SALVAGE_FRACTION)
        );
        assert_eq!(founders_camp_gold_refund(cost, false, true), 0.0);
        assert_eq!(founders_camp_gold_refund(cost, true, true), 0.0);
    }
}
