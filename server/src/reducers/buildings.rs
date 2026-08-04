use spacetimedb::{reducer, ReducerContext, Table};

use crate::balance_generated::{
    CARPENTER_TIMBER_COST_MULTIPLIER, CONSTRUCTION_MAX_BUILDERS, TOWN_HALL_POPULATION_REQUIRED,
};
use crate::building_defs::{building_def, building_def_or_err};
use crate::burgage::{zone_overlaps_footprint, Point2};
use crate::chapel_upgrade_policy::{chapel_upgrade_cost, normalize_chapel_tier};
use crate::construction_priority::{
    construction_labor_ready, construction_labor_rotation,
    construction_labor_rotation_with_reserve, is_valid_construction_priority,
    ConstructionLaborRotation, ConstructionLaborSite, CONSTRUCTION_PRIORITY_HOLD,
    CONSTRUCTION_PRIORITY_NORMAL,
};
use crate::db::*;
use crate::economy::{
    assign_building_labor as set_building_labor, available_building_labor, building_commodity_cap,
    building_commodity_stock, building_cost, building_salvage_refund, chapel_coffer_gold,
    collect_chapel_coffer as sweep_chapel_coffer, construction_treasury_reservation,
    credit_treasury_commodity, credit_treasury_firewood, credit_treasury_food,
    credit_treasury_gold, credit_treasury_stone, credit_treasury_timber, credit_treasury_water,
    guardhouse_roster_count, guardhouse_roster_floors, initial_construction_labor,
    record_parish_ledger, spend_aggregate_ironwork, spend_aggregate_roof_tiles,
    spend_aggregate_stone, spend_aggregate_timber, total_ironwork, total_roof_tiles, total_stone,
    total_timber, CommodityKind, ParishLedgerKind,
};
use crate::foraging_policy::harvest_available;
use crate::frontier_economy_policy::{
    is_valid_carpenter_polearm_reserve, is_valid_guardhouse_food_reserve,
    is_valid_guardhouse_pay_priority, CARPENTER_POLEARM_RESERVE_DEFAULT,
    GUARDHOUSE_FOOD_RESERVE_STANDARD, GUARDHOUSE_PAY_PRIORITY_NORMAL,
};
use crate::granary_policy::{
    is_valid_granary_fresh_food_target_percent, normalize_granary_grain_reserve,
    GRANARY_FRESH_FOOD_TARGET_DEFAULT_PERCENT,
};
use crate::harvest_reserve_policy::{harvestable_wild_stock, normalize_harvest_reserve_percent};
use crate::hydrology::{sample_hydrology_score, well_capacity_from_hydrology};
use crate::labor_steward_policy::steward_deployable_labor;
use crate::lifecycle::ensure_player_resources;
use crate::marketplace_procurement_policy::{
    is_valid_marketplace_gold_reserve_target, is_valid_marketplace_iron_target,
    is_valid_marketplace_ironwork_target, is_valid_marketplace_salt_target,
    is_valid_marketplace_seed_grain_target, MARKETPLACE_GOLD_RESERVE_DEFAULT,
};
use crate::placement_validation::{
    building_overlaps_open_water, building_overlaps_residence_zone, building_overlaps_road_surface,
    building_site_contains_point, is_near_open_water, is_on_resource_deposit, is_open_water,
};
use crate::potter_firing_policy::{is_valid_potter_firing_policy, potter_fires_roof_tiles};
use crate::pottery_dispatch_policy::is_valid_pottery_dispatch_policy;
use crate::processor_labor_policy::{
    processor_callup_targets, production_steward_callup_allowed, ProcessorCallupCandidate,
};
use crate::processor_output_policy::{
    is_processor_output_target_kind, is_production_output_target_kind,
    is_valid_processor_output_target_percent, processor_input_kinds, processor_output_headroom,
    processor_output_kind, ProcessorInputKind, ProcessorOutputKind,
    PROCESSOR_OUTPUT_TARGET_DEFAULT_PERCENT,
};
use crate::roads::load_owner_road_network;
use crate::simulation::{
    building_fire_state, building_has_active_trip, building_has_inbound_commodity_trip,
    building_has_inbound_supply_trip, call_up_active_seasonal_labor_for_owner,
    cancel_inbound_construction_trips_for_site, clear_fire_for_target, drain_trips_for_building,
    game_clock, local_delivery_distance, owner_has_staffed_town_hall,
    preserve_in_transit_cart_labor, recall_idle_seasonal_labor_for_owner,
    staffed_cart_workers_by_building, try_start_chapel_treasury_trip, SimTickContext,
    FIRE_TARGET_BUILDING,
};
use crate::specialty_trade_policy::is_valid_specialty_export_policy;
use crate::storehouse_policy::{
    is_valid_storehouse_stock_target_percent, STOREHOUSE_STOCK_TARGET_DEFAULT_PERCENT,
};
use crate::supply_policy::{
    is_valid_carpenter_cart_service_target, large_quarry_supports_ready, rich_mine_supports_ready,
    CARPENTER_CART_SERVICE_TARGET_DEFAULT,
};
use crate::tables::graveyard;
use crate::tables::{
    farm_field, livestock_herd, pasture, Building, ForagingNode, Quarry, WorldConfig,
};
use crate::weaver_input_policy::is_valid_weaver_input_policy;
use crate::woodcutter_policy::normalize_woodcutter_timber_reserve;
use crate::worksite_stall_policy::{
    is_production_labor_kind, stalled_labor_target, SpatialBuckets, RICH_DEPOSIT_CENTER_TOLERANCE,
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
) -> bool {
    let Some(candidate) = building_def(kind) else {
        return false;
    };
    let min_separation = candidate.pick_radius * 1.85;

    for building in ctx.db.building().owner().filter(&owner) {
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

fn building_overlaps_farm_field(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    kind: &str,
    x: f64,
    z: f64,
) -> bool {
    let Some(def) = building_def(kind) else {
        return false;
    };
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
        zone_overlaps_footprint(&polygon, x, z, def.pick_radius)
    })
}

fn building_overlaps_pasture(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    kind: &str,
    x: f64,
    z: f64,
) -> bool {
    let Some(def) = building_def(kind) else {
        return false;
    };
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

fn has_rich_quarry_at_center(ctx: &ReducerContext, x: f64, z: f64) -> bool {
    const CENTER_TOLERANCE: f64 = 2.5;
    let tolerance_sq = CENTER_TOLERANCE * CENTER_TOLERANCE;
    ctx.db.quarry().iter().any(|quarry| {
        quarry.quarry_id.starts_with("quarry-")
            && quarry.is_rich
            && (quarry.x - x) * (quarry.x - x) + (quarry.z - z) * (quarry.z - z) <= tolerance_sq
    })
}

fn has_mineral_deposit_at_center(ctx: &ReducerContext, x: f64, z: f64) -> bool {
    const CENTER_TOLERANCE: f64 = 2.5;
    let tolerance_sq = CENTER_TOLERANCE * CENTER_TOLERANCE;
    ctx.db.quarry().iter().any(|deposit| {
        (deposit.quarry_id.starts_with("deposit-iron-")
            || deposit.quarry_id.starts_with("deposit-salt-"))
            && (deposit.is_rich || deposit.remaining > 0.0)
            && (deposit.x - x) * (deposit.x - x) + (deposit.z - z) * (deposit.z - z) <= tolerance_sq
    })
}

fn has_clay_deposit_at_center(ctx: &ReducerContext, x: f64, z: f64) -> bool {
    let tolerance_sq = RICH_DEPOSIT_CENTER_TOLERANCE * RICH_DEPOSIT_CENTER_TOLERANCE;
    ctx.db.foraging_node().iter().any(|deposit| {
        deposit.node_kind == "clay"
            && deposit.node_id.starts_with("clay-")
            && (deposit.node_id.starts_with("clay-rich-") || deposit.remaining > 0.0)
            && (deposit.x - x) * (deposit.x - x) + (deposit.z - z) * (deposit.z - z) <= tolerance_sq
    })
}

fn is_clay_deposit_at_center(ctx: &ReducerContext, x: f64, z: f64) -> bool {
    let tolerance_sq = RICH_DEPOSIT_CENTER_TOLERANCE * RICH_DEPOSIT_CENTER_TOLERANCE;
    ctx.db.foraging_node().iter().any(|deposit| {
        deposit.node_kind == "clay"
            && deposit.node_id.starts_with("clay-")
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

const REMOTE_WORK_CAMP_MAX_DISTANCE: f64 = 34.0;

fn supports_buildable_remote_work_camp(kind: &str) -> bool {
    matches!(
        kind,
        "lumber_mill" | "stone_quarry" | "large_quarry" | "mine" | "clay_pit" | "charcoal_burner"
    )
}

#[reducer]
pub fn place_building(ctx: &ReducerContext, kind: String, x: f64, z: f64) -> Result<(), String> {
    if kind == "remote_work_camp" {
        return Err("Plan an overnight camp from its rural worksite card.".to_string());
    }
    place_building_internal(ctx, kind, x, z, 0)
}

#[reducer]
pub fn place_remote_work_camp(
    ctx: &ReducerContext,
    worksite_id: u64,
    x: f64,
    z: f64,
) -> Result<(), String> {
    let owner = ctx.sender();
    let worksite = ctx
        .db
        .building()
        .id()
        .find(&worksite_id)
        .ok_or_else(|| "Rural worksite not found.".to_string())?;
    if worksite.owner != owner
        || !worksite.construction_complete
        || !supports_buildable_remote_work_camp(&worksite.kind)
    {
        return Err(
            "This completed worksite cannot support a separate overnight camp.".to_string(),
        );
    }
    if ctx.db.building().owner().filter(&owner).any(|building| {
        building.kind == "remote_work_camp" && building.linked_worksite_id == worksite_id
    }) {
        return Err(
            "This worksite already has an overnight camp or camp construction site.".to_string(),
        );
    }
    if (x - worksite.x).hypot(z - worksite.z) > REMOTE_WORK_CAMP_MAX_DISTANCE {
        return Err(format!(
            "Place the overnight camp within {} metres of its worksite.",
            REMOTE_WORK_CAMP_MAX_DISTANCE as u32
        ));
    }
    place_building_internal(ctx, "remote_work_camp".to_string(), x, z, worksite_id)
}

fn place_building_internal(
    ctx: &ReducerContext,
    kind: String,
    x: f64,
    z: f64,
    linked_worksite_id: u64,
) -> Result<(), String> {
    let def = building_def_or_err(&kind)?;
    let owner = ctx.sender();
    ensure_player_resources(ctx, owner);

    if kind == "salvage_pile" {
        return Err("This temporary site is created automatically by the settlement.".into());
    }
    if kind != "founders_camp"
        && !ctx
            .db
            .player_resources()
            .owner()
            .find(&owner)
            .is_some_and(|resources| resources.physical_founding_site_enabled)
    {
        return Err("Place the founders' camp before building the settlement.".into());
    }

    let on_mineral_deposit = kind == "mine" && has_mineral_deposit_at_center(ctx, x, z);
    let on_generated_clay_bank = kind == "clay_pit" && is_clay_deposit_at_center(ctx, x, z);
    let on_usable_clay_bank = kind == "clay_pit" && has_clay_deposit_at_center(ctx, x, z);

    if kind != "large_quarry"
        && !on_mineral_deposit
        && !on_generated_clay_bank
        && is_on_resource_deposit(ctx, x, z)
    {
        return Err("Cannot build over a physical resource deposit.".to_string());
    }

    // A fresh world has no roads, zones, fields, pastures, or other buildings
    // for the founding camp to overlap. Its active, seed-aware rendered water
    // mask and terrain shape have already been validated by the placement
    // client. The static server hydrology grid is a groundwater proxy for
    // wells and crops, not the active river layout, so consulting it here can
    // reject visibly dry ground from another world seed. Route the one-time
    // camp directly after the only server-side spatial conflict that can exist
    // in a fresh world: a generated physical resource deposit.
    if kind == "founders_camp" {
        return crate::reducers::bootstrap::place_founding_camp(ctx, x, z);
    }

    // Generated mineral landmarks are authoritative terrain anchors. Do not let
    // the coarse static hydrology grid reject a visually dry clay site in
    // worlds whose river seed differs from the embedded default grid.
    if kind != "large_quarry"
        && !on_mineral_deposit
        && !on_generated_clay_bank
        && is_open_water(x, z)
    {
        return Err(if kind == "well" {
            "Cannot build a well on open water.".to_string()
        } else {
            "Cannot build on water.".to_string()
        });
    }
    if kind == "fishing_camp" && building_overlaps_open_water(&kind, x, z) {
        return Err("The entire fishing camp must stand on dry land.".to_string());
    }

    if def.requires_water_shore && !on_generated_clay_bank && !is_near_open_water(x, z, 24.0) {
        return Err("This building must be placed on a river or lake shore.".to_string());
    }

    // Parsing and indexing the serialized road graph is one of the more expensive
    // placement checks. Reuse one snapshot for overlap, landmark, and carpenter checks.
    let road_network = load_owner_road_network(ctx, owner);

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

    if kind == "large_quarry" && !has_rich_quarry_at_center(ctx, x, z) {
        return Err(
            "Large Quarries must be placed directly over a rich stone deposit.".to_string(),
        );
    }

    if kind == "mine" && !on_mineral_deposit {
        return Err(
            "Mineral mines must be placed directly over an iron or salt deposit.".to_string(),
        );
    }

    if kind == "clay_pit" && !on_usable_clay_bank {
        return Err(
            "Clay Pits need a generated bank with ordinary clay remaining or a rich deep source."
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
        return Err("No berries or mushrooms within work range.".to_string());
    }

    if def.requires_fish && !has_foraging_in_radius(ctx, x, z, def.work_radius, "fish", false) {
        return Err("No fish shoal within work range.".to_string());
    }

    if is_too_close_to_buildings(ctx, owner, &kind, x, z) {
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
    let (treasury_timber, treasury_stone, treasury_ironwork) =
        construction_treasury_reservation(ctx, owner, timber_cost, cost.stone, cost.ironwork);
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
    let guardhouse_pay_priority = if kind == "guardhouse" {
        GUARDHOUSE_PAY_PRIORITY_NORMAL
    } else {
        0
    };
    let guardhouse_food_reserve = if kind == "guardhouse" {
        GUARDHOUSE_FOOD_RESERVE_STANDARD
    } else {
        0
    };
    let chapel_tier = if kind == "chapel" { 1 } else { 0 };
    ctx.db.building().insert(Building {
        id: building_id,
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
        storehouse_accepts_timber: true,
        storehouse_accepts_stone: true,
        storehouse_accepts_firewood: true,
        storehouse_accepts_iron: true,
        storehouse_accepts_clay: true,
        storehouse_accepts_salt: true,
        granary_accepts_fresh_food: true,
        granary_households_first: false,
        granary_grain_reserve: 0.0,
        harvest_reserve_percent: 0,
        wool: 0.0,
        cloth: 0.0,
        construction_priority: CONSTRUCTION_PRIORITY_NORMAL,
        woodcutter_timber_reserve: 0.0,
        carpenter_polearm_reserve,
        guardhouse_pay_priority,
        guardhouse_food_reserve,
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
        processor_output_target_percent: PROCESSOR_OUTPUT_TARGET_DEFAULT_PERCENT,
        gold: 0.0,
        founding_shelter_active: false,
        chapel_monastery_tithe_due: 0.0,
        civic_receipts_gold: 0.0,
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
        linked_worksite_id,
        commute_efficiency: 1.0,
        chapel_tier,
        bread: 0.0,
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
        porridge: 0.0,
        cured_meat: 0.0,
        smoked_fish: 0.0,
        cheese: 0.0,
    });

    ctx.db.world_config().id().update(WorldConfig {
        next_building_id: building_id + 1,
        ..config
    });

    Ok(())
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

/// Releases builders from supply-blocked sites that have no approaching cart,
/// then deploys free crews to sites where material or founders' reserves make
/// immediate progress possible. Existing productive and inbound-waiting crews
/// are never displaced.
#[reducer]
pub fn rotate_construction_labor(ctx: &ReducerContext) -> Result<(), String> {
    let owner = ctx.sender();
    if !owner_has_staffed_town_hall(ctx, owner) {
        return Err("A staffed Town Hall is required to rotate construction crews.".to_string());
    }
    rotate_construction_labor_for_owner(ctx, owner);
    Ok(())
}

/// Shared authoritative implementation used by both the explicit Town Hall
/// order and the optional daily steward. The queue policy remains pure; this
/// adapter supplies live material and inbound-cart state, then applies only the
/// returned target rows.
pub(crate) fn rotate_construction_labor_for_owner(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
) -> ConstructionLaborRotation {
    rotate_construction_labor_for_owner_with_reserve(ctx, owner, 0)
}

pub(crate) fn rotate_construction_labor_for_owner_with_reserve(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    labor_reserve: u32,
) -> ConstructionLaborRotation {
    let available_labor = available_building_labor(ctx, owner);
    let sites = ctx
        .db
        .building()
        .owner()
        .filter(&owner)
        .filter(|building| !building.construction_complete)
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
        if building.owner != owner || building.construction_complete {
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
pub fn recall_idle_seasonal_labor(ctx: &ReducerContext) -> Result<(), String> {
    let owner = ctx.sender();
    if !owner_has_staffed_town_hall(ctx, owner) {
        return Err("A staffed Town Hall is required to recall seasonal crews.".to_string());
    }

    let sim_tick = ctx
        .db
        .world_config()
        .id()
        .find(&0)
        .map(|config| config.sim_tick)
        .unwrap_or(0);
    let month = game_clock(sim_tick).month;
    recall_idle_seasonal_labor_for_owner(ctx, owner, month);
    Ok(())
}

/// Calls free settlement labor into currently active seasonal work. Higher
/// staffing priorities fill first; equal-priority sites receive one worker per
/// pass so scarce labor is shared across the active harvest window.
#[reducer]
pub fn call_up_active_seasonal_labor(ctx: &ReducerContext) -> Result<(), String> {
    let owner = ctx.sender();
    if !owner_has_staffed_town_hall(ctx, owner) {
        return Err("A staffed Town Hall is required to call up seasonal crews.".to_string());
    }
    let sim_tick = ctx
        .db
        .world_config()
        .id()
        .find(&0)
        .map(|config| config.sim_tick)
        .unwrap_or(0);
    let month = game_clock(sim_tick).month;
    call_up_active_seasonal_labor_for_owner(ctx, owner, month);
    Ok(())
}

fn processor_output_commodity(kind: &str) -> Option<CommodityKind> {
    if kind == "bakery" {
        return Some(CommodityKind::Bread);
    }
    match processor_output_kind(kind)? {
        ProcessorOutputKind::Flour => Some(CommodityKind::Flour),
        ProcessorOutputKind::Food => Some(CommodityKind::Food),
        ProcessorOutputKind::Ale => Some(CommodityKind::Ale),
        ProcessorOutputKind::PreservedFood => Some(CommodityKind::PreservedFood),
        ProcessorOutputKind::Cloth => Some(CommodityKind::Cloth),
        ProcessorOutputKind::Charcoal => Some(CommodityKind::Charcoal),
        ProcessorOutputKind::Ironwork => Some(CommodityKind::Ironwork),
        ProcessorOutputKind::Pottery => Some(CommodityKind::Pottery),
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
        ProcessorInputKind::Grain => CommodityKind::Grain,
        ProcessorInputKind::Flour => CommodityKind::Flour,
        ProcessorInputKind::Water => CommodityKind::Water,
        ProcessorInputKind::Firewood => CommodityKind::Firewood,
        ProcessorInputKind::Barley => CommodityKind::Barley,
        ProcessorInputKind::Food => CommodityKind::Food,
        ProcessorInputKind::Salt => CommodityKind::Salt,
        ProcessorInputKind::Pottery => CommodityKind::Pottery,
        ProcessorInputKind::Wool => CommodityKind::Wool,
        ProcessorInputKind::Flax => CommodityKind::Flax,
        ProcessorInputKind::Iron => CommodityKind::Iron,
        ProcessorInputKind::Charcoal => CommodityKind::Charcoal,
        ProcessorInputKind::Clay => CommodityKind::Clay,
    }
}

fn processor_stall_and_recovery(ctx: &ReducerContext, building: &Building) -> (bool, bool) {
    if processor_output_room(building).is_some_and(|headroom| headroom <= 1e-6) {
        return (true, false);
    }

    if building.kind == "weaver" {
        let has_wool = building.wool > 1e-6;
        let has_flax = building.flax > 1e-6;
        let has_water = building.water > 1e-6;
        if has_wool || (has_flax && has_water) {
            return (false, false);
        }
        let wool_en_route =
            building_has_inbound_commodity_trip(ctx, building.id, CommodityKind::Wool);
        let flax_available =
            has_flax || building_has_inbound_commodity_trip(ctx, building.id, CommodityKind::Flax);
        let water_available = has_water
            || building_has_inbound_commodity_trip(ctx, building.id, CommodityKind::Water);
        return (true, wool_en_route || (flax_available && water_available));
    }

    let missing_inputs: Vec<CommodityKind> = processor_input_kinds(&building.kind)
        .iter()
        .copied()
        .map(processor_input_commodity)
        .filter(|commodity| {
            let stock_missing = if building.kind == "smokehouse"
                && *commodity == CommodityKind::Food
            {
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
    let every_missing_input_en_route = missing_inputs
        .iter()
        .all(|commodity| {
            if building.kind == "smokehouse" && *commodity == CommodityKind::Food {
                [
                    CommodityKind::Food,
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

fn stone_source_usable(building: &Building, buckets: &SpatialBuckets<Quarry>) -> bool {
    buckets
        .source_state_within_radius(
            building.x,
            building.z,
            building.work_radius,
            |quarry| quarry.quarry_id.starts_with("quarry-"),
            |quarry| quarry.remaining > 1e-6,
        )
        .usable
}

fn rich_stone_source_usable(building: &Building, buckets: &SpatialBuckets<Quarry>) -> bool {
    buckets
        .source_state_within_radius(
            building.x,
            building.z,
            RICH_DEPOSIT_CENTER_TOLERANCE,
            |quarry| quarry.quarry_id.starts_with("quarry-") && quarry.is_rich,
            |_| true,
        )
        .usable
}

fn mineral_source(
    building: &Building,
    buckets: &SpatialBuckets<Quarry>,
) -> Option<(CommodityKind, bool, bool)> {
    for (prefix, commodity) in [
        ("deposit-iron-", CommodityKind::Iron),
        ("deposit-salt-", CommodityKind::Salt),
    ] {
        let rich_source = buckets.source_state_within_radius(
            building.x,
            building.z,
            RICH_DEPOSIT_CENTER_TOLERANCE,
            |deposit| deposit.quarry_id.starts_with(prefix) && deposit.is_rich,
            |_| true,
        );
        if rich_source.relevant {
            return Some((commodity, true, true));
        }
        let ordinary_source = buckets.source_state_within_radius(
            building.x,
            building.z,
            RICH_DEPOSIT_CENTER_TOLERANCE,
            |deposit| deposit.quarry_id.starts_with(prefix) && !deposit.is_rich,
            |deposit| deposit.remaining > 1e-6,
        );
        if ordinary_source.relevant {
            return Some((commodity, ordinary_source.usable, false));
        }
    }
    None
}

fn clay_source_usable(building: &Building, buckets: &SpatialBuckets<ForagingNode>) -> bool {
    buckets
        .source_state_within_radius(
            building.x,
            building.z,
            RICH_DEPOSIT_CENTER_TOLERANCE,
            |deposit| deposit.node_kind == "clay" && deposit.node_id.starts_with("clay-"),
            |deposit| deposit.node_id.starts_with("clay-rich-") || deposit.remaining > 0.0,
        )
        .usable
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
        "clay_pit" => {
            !extraction_output_blocked(building, CommodityKind::Clay)
                && clay_source_usable(building, foraging_buckets)
        }
        "mine" => {
            mineral_source(building, quarry_buckets).is_some_and(|(commodity, usable, is_rich)| {
                usable
                    && !extraction_output_blocked(building, commodity)
                    && (!is_rich || rich_mine_supports_ready(building.timber))
            })
        }
        "stone_quarry" => {
            !extraction_output_blocked(building, CommodityKind::Stone)
                && stone_source_usable(building, quarry_buckets)
        }
        "large_quarry" => {
            !extraction_output_blocked(building, CommodityKind::Stone)
                && rich_stone_source_usable(building, quarry_buckets)
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
pub fn recall_target_idle_processor_labor_for_owner(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
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
        .filter(|building| building.construction_complete && building.assigned_labor > 0)
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
                    processor_output_commodity(kind)
                        .is_some_and(|commodity| building_commodity_stock(&building, commodity) > 1e-6)
                };
                (
                    stalled,
                    supply_en_route,
                    has_output_stock || has_active_trip,
                )
            }
            "clay_pit" => (
                extraction_output_blocked(&building, CommodityKind::Clay)
                    || !clay_source_usable(&building, &foraging_buckets),
                false,
                building.clay > 1e-6 || has_active_trip,
            ),
            "mine" => {
                let source = mineral_source(&building, &quarry_buckets);
                let (stalled, supply_en_route) =
                    source.map_or((true, false), |(commodity, usable, is_rich)| {
                        let output_blocked = extraction_output_blocked(&building, commodity);
                        let support_missing = is_rich && !rich_mine_supports_ready(building.timber);
                        (
                            !usable || output_blocked || support_missing,
                            usable
                                && !output_blocked
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
                    building.iron > 1e-6 || building.salt > 1e-6 || has_active_trip,
                )
            }
            "stone_quarry" => (
                extraction_output_blocked(&building, CommodityKind::Stone)
                    || !stone_source_usable(&building, &quarry_buckets),
                false,
                has_active_trip,
            ),
            "large_quarry" => {
                let source_usable = rich_stone_source_usable(&building, &quarry_buckets);
                let output_blocked = extraction_output_blocked(&building, CommodityKind::Stone);
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
                    has_active_trip,
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
                    )
                        || !wild_stock_source_usable(&building, node_kind, &foraging_buckets),
                    false,
                    crate::economy::building_edible_food_stock(&building) > 1e-6
                        || has_active_trip,
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
pub fn recall_target_idle_processor_labor(ctx: &ReducerContext) -> Result<(), String> {
    let owner = ctx.sender();
    if !owner_has_staffed_town_hall(ctx, owner) {
        return Err(
            "A staffed Town Hall is required to recall stalled production crews.".to_string(),
        );
    }
    recall_target_idle_processor_labor_for_owner(ctx, owner);
    Ok(())
}

/// Deploys available settlement labor to capacity-open processors and
/// source-ready mines, quarries, clay pits, or hunting halls. Staffing priority
/// tiers fill from high to low, with round-robin sharing inside each tier. The
/// legacy reducer name is retained for generated-binding compatibility.
fn call_up_target_ready_processor_labor_for_owner_with_policy(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    require_operational_inputs: bool,
    labor_reserve: u32,
) -> u32 {
    let available_labor =
        steward_deployable_labor(available_building_labor(ctx, owner), labor_reserve);
    if available_labor == 0 {
        return 0;
    }
    let (quarry_buckets, foraging_buckets) = worksite_source_buckets(ctx);
    let mut candidates = Vec::new();
    for building in ctx.db.building().owner().filter(&owner).filter(|building| {
        building.construction_complete && building_fire_state(ctx, building.id).is_none()
    }) {
        let Some(def) = building_def(&building.kind) else {
            continue;
        };
        if building.assigned_labor >= def.max_labor {
            continue;
        }
        if !is_production_labor_kind(&building.kind)
            || !production_site_ready(&building, &quarry_buckets, &foraging_buckets)
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
            priority: building.construction_priority,
            assigned_labor: building.assigned_labor,
            max_labor: def.max_labor,
        });
    }

    let mut called_up = 0_u32;
    for (building_id, target_labor) in processor_callup_targets(&candidates, available_labor) {
        let Some(mut building) = ctx.db.building().id().find(&building_id) else {
            continue;
        };
        if building.owner != owner || target_labor <= building.assigned_labor {
            continue;
        }
        called_up = called_up.saturating_add(target_labor - building.assigned_labor);
        building.assigned_labor = target_labor;
        ctx.db.building().id().update(building);
    }

    called_up
}

/// The explicit Town Hall order may pre-staff an input-empty workshop so the
/// player can prepare a chain before its first cart arrives.
pub fn call_up_target_ready_processor_labor_for_owner(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
) -> u32 {
    call_up_target_ready_processor_labor_for_owner_with_policy(ctx, owner, false, 0)
}

/// Daily automation is deliberately stricter: it never recalls an input-starved
/// crew and immediately hires it back. Capacity-open workshops must have their
/// current inputs or matching inbound carts before they claim free labor.
pub fn call_up_operational_production_labor_for_owner(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    labor_reserve: u32,
) -> u32 {
    call_up_target_ready_processor_labor_for_owner_with_policy(ctx, owner, true, labor_reserve)
}

#[reducer]
pub fn call_up_target_ready_processor_labor(ctx: &ReducerContext) -> Result<(), String> {
    let owner = ctx.sender();
    if !owner_has_staffed_town_hall(ctx, owner) {
        return Err("A staffed Town Hall is required to deploy production crews.".to_string());
    }
    call_up_target_ready_processor_labor_for_owner(ctx, owner);
    Ok(())
}

/// Balances ordinary completed year-round workplaces. Free labor fills first;
/// higher-priority vacancies may then draw only the minimum necessary workers
/// from strictly lower tiers. Specialized crews and Town Hall clerks are never
/// displaced by this order.
#[reducer]
pub fn call_up_year_round_labor(ctx: &ReducerContext) -> Result<(), String> {
    let owner = ctx.sender();
    if !owner_has_staffed_town_hall(ctx, owner) {
        return Err("A staffed Town Hall is required to balance year-round crews.".to_string());
    }

    let mut available_labor = available_building_labor(ctx, owner);
    let mut sites = Vec::new();
    let mut fire_disabled_sites = Vec::new();
    let cart_floors = staffed_cart_workers_by_building(ctx, owner);
    let roster_floors = guardhouse_roster_floors(ctx, owner);
    for building in ctx
        .db
        .building()
        .owner()
        .filter(&owner)
        .filter(|building| building.construction_complete)
    {
        let Some(def) = building_def(&building.kind) else {
            continue;
        };
        if !def.accepts_labor || !is_year_round_labor_kind(&building.kind) {
            continue;
        }
        if building_fire_state(ctx, building.id).is_some() {
            if building.assigned_labor > 0 {
                let cart_floor = cart_floors
                    .get(&building.id)
                    .copied()
                    .unwrap_or(0)
                    .max(roster_floors.get(&building.id).copied().unwrap_or(0));
                available_labor = available_labor
                    .saturating_add(building.assigned_labor.saturating_sub(cart_floor));
                fire_disabled_sites.push(building.id);
            }
            continue;
        }
        sites.push(YearRoundLaborSite {
            building_id: building.id,
            priority: building.construction_priority,
            assigned_labor: building.assigned_labor,
            minimum_labor: cart_floors
                .get(&building.id)
                .copied()
                .unwrap_or(0)
                .max(roster_floors.get(&building.id).copied().unwrap_or(0)),
            max_labor: def.max_labor,
        });
    }

    let rotation = year_round_labor_rotation(&sites, available_labor);
    for building_id in fire_disabled_sites {
        let Some(mut building) = ctx.db.building().id().find(&building_id) else {
            continue;
        };
        if building.owner != owner || building.assigned_labor == 0 {
            continue;
        }
        let roster_floor = roster_floors.get(&building.id).copied().unwrap_or(0);
        preserve_in_transit_cart_labor(ctx, building.id, roster_floor);
        building.assigned_labor = roster_floor;
        ctx.db.building().id().update(building);
    }
    for (building_id, target_labor) in rotation.targets {
        let Some(mut building) = ctx.db.building().id().find(&building_id) else {
            continue;
        };
        if building.owner != owner || target_labor == building.assigned_labor {
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
        return Err("Work priority must be hold, low, normal, or high/urgent.".to_string());
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
        if priority == CONSTRUCTION_PRIORITY_HOLD {
            return Err(
                "Operating-building staffing priority must be low, normal, or high.".to_string(),
            );
        }
        if !building_def(&building.kind).is_some_and(|def| def.accepts_labor)
            && building.kind != "monastery"
        {
            return Err("This building does not use labor or rationed grain.".to_string());
        }
        building.construction_priority = priority;
        ctx.db.building().id().update(building);
        return Ok(());
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
    building.storehouse_accepts_iron = accepts_iron;
    building.storehouse_accepts_clay = accepts_clay;
    building.storehouse_accepts_salt = accepts_salt;
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
        "iron" => building.storehouse_iron_target_percent = target_percent,
        "clay" => building.storehouse_clay_target_percent = target_percent,
        "salt" => building.storehouse_salt_target_percent = target_percent,
        _ => return Err(
            "Storehouse stock target applies only to timber, stone, firewood, iron, clay, or salt."
                .to_string(),
        ),
    }
    ctx.db.building().id().update(building);
    Ok(())
}

#[reducer]
pub fn set_processor_output_target(
    ctx: &ReducerContext,
    building_id: u64,
    target_percent: u8,
) -> Result<(), String> {
    if !is_valid_processor_output_target_percent(target_percent) {
        return Err("Production stock target must be 25%, 50%, 75%, or 100%.".to_string());
    }
    let owner = ctx.sender();
    let mut building = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Production site not found.".to_string())?;
    if building.owner != owner
        || !building.construction_complete
        || !is_production_output_target_kind(&building.kind)
    {
        return Err("You do not own this completed production site.".to_string());
    }
    building.processor_output_target_percent = target_percent;
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
        return Err("Weaver input policy must be Auto, Wool first, or Flax first.".to_string());
    }
    let owner = ctx.sender();
    let mut building = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Weaver workshop not found.".to_string())?;
    if building.owner != owner || building.kind != "weaver" || !building.construction_complete {
        return Err("You do not own this completed weaver workshop.".to_string());
    }
    building.weaver_input_policy = input_policy;
    ctx.db.building().id().update(building);
    Ok(())
}

#[reducer]
pub fn set_pottery_dispatch_policy(
    ctx: &ReducerContext,
    building_id: u64,
    dispatch_policy: u8,
) -> Result<(), String> {
    if !is_valid_pottery_dispatch_policy(dispatch_policy) {
        return Err(
            "Pottery dispatch policy must be Market wares first or Preservation first."
                .to_string(),
        );
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
    building.pottery_dispatch_policy = dispatch_policy;
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
pub fn set_guardhouse_pay_priority(
    ctx: &ReducerContext,
    building_id: u64,
    pay_priority: u8,
) -> Result<(), String> {
    if !is_valid_guardhouse_pay_priority(pay_priority) {
        return Err("Guardhouse company priority must be low, normal, or high.".to_string());
    }
    let owner = ctx.sender();
    let mut building = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Guardhouse not found.".to_string())?;
    if building.owner != owner || building.kind != "guardhouse" || !building.construction_complete {
        return Err("You do not own this completed guardhouse.".to_string());
    }
    building.guardhouse_pay_priority = pay_priority;
    ctx.db.building().id().update(building);
    Ok(())
}

#[reducer]
pub fn set_guardhouse_food_reserve(
    ctx: &ReducerContext,
    building_id: u64,
    reserve_per_guard: u8,
) -> Result<(), String> {
    if !is_valid_guardhouse_food_reserve(reserve_per_guard) {
        return Err("Guardhouse ration reserve must be 3, 6, or 12 food per guard.".to_string());
    }
    let owner = ctx.sender();
    let mut building = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Guardhouse not found.".to_string())?;
    if building.owner != owner || building.kind != "guardhouse" || !building.construction_complete {
        return Err("You do not own this completed guardhouse.".to_string());
    }
    building.guardhouse_food_reserve = reserve_per_guard;
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
    if building.owner != owner || building.kind != "marketplace" || !building.construction_complete
    {
        return Err("You do not own this completed marketplace.".to_string());
    }
    building.marketplace_specialty_export_policy = export_policy;
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
        .ok_or_else(|| "Hunter's hall or fishing camp not found.".to_string())?;
    if building.owner != owner
        || !matches!(building.kind.as_str(), "hunters_hall" | "fishing_camp")
        || !building.construction_complete
    {
        return Err("You do not own this completed hunter's hall or fishing camp.".to_string());
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
    if building_fire_state(ctx, building_id).is_some() {
        return Err(
            "Repair the fire-damaged chapel before collecting its sealed coffer.".to_string(),
        );
    }
    let physical = ctx
        .db
        .player_resources()
        .owner()
        .find(&owner)
        .is_some_and(|resources| resources.physical_founding_site_enabled);
    if !physical {
        return sweep_chapel_coffer(ctx, owner, building_id).map(|_| ());
    }

    let mut chapel = chapel;
    let tick = SimTickContext::new(ctx);
    let clock = game_clock(
        ctx.db
            .world_config()
            .id()
            .find(&0)
            .map(|config| config.sim_tick)
            .unwrap_or(0),
    );
    let requested = chapel_coffer_gold(&chapel);
    let loaded = try_start_chapel_treasury_trip(ctx, &tick, &clock, &mut chapel, requested)?;
    if loaded > 1e-9 {
        ctx.db.building().id().update(chapel);
        record_parish_ledger(ctx, owner, ParishLedgerKind::ManualCollect, loaded);
    }
    Ok(())
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
    if building.kind == "founders_camp" {
        return Err(
            "The founders' camp clears itself after its people are housed and its stores are moved."
                .to_string(),
        );
    }
    if building.kind == "salvage_pile" {
        return Err(
            "A reclamation pile clears itself after its goods are physically recovered."
                .to_string(),
        );
    }
    if building.kind != "remote_work_camp"
        && ctx.db.building().owner().filter(&owner).any(|candidate| {
            candidate.kind == "remote_work_camp" && candidate.linked_worksite_id == building_id
        })
    {
        return Err("Demolish this worksite's overnight camp first.".to_string());
    }
    if building.kind == "guardhouse" {
        let committed = guardhouse_roster_count(ctx, owner, building.id);
        if committed > 0 {
            return Err(format!(
                "This company still has {} guard{} deployed, returning, or recovering; wait until every guard has returned and recovered before demolition.",
                committed,
                if committed == 1 { "" } else { "s" },
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

    let fire_damaged = building_fire_state(ctx, building_id).is_some();
    clear_fire_for_target(ctx, FIRE_TARGET_BUILDING, building_id);

    let refund = if fire_damaged {
        crate::economy::ResourceAmount {
            timber: 0.0,
            stone: 0.0,
            ironwork: 0.0,
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
            ironwork: (building.construction_delivered_ironwork
                * crate::balance_generated::IRONWORK_SALVAGE_FRACTION)
                .round(),
        }
    };
    let recoverable = if fire_damaged { 0.0 } else { 1.0 };

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

    let physical_reclamation = ctx
        .db
        .player_resources()
        .owner()
        .find(&owner)
        .is_some_and(|resources| resources.physical_founding_site_enabled);
    if physical_reclamation {
        let salvage_def = building_def("salvage_pile")
            .ok_or_else(|| "Reclamation pile balance is missing.".to_string())?;
        ctx.db.building().id().update(Building {
            kind: "salvage_pile".into(),
            work_radius: salvage_def.work_radius,
            action_cooldown: 0.0,
            timber: refund.timber + building.timber * recoverable,
            firewood: building.firewood * recoverable,
            stone: refund.stone + building.stone * recoverable,
            water: building.water * recoverable,
            food: building.food * recoverable,
            grain: building.grain * recoverable,
            flour: building.flour * recoverable,
            ale: building.ale * recoverable,
            preserved_food: building.preserved_food * recoverable,
            honey: building.honey * recoverable,
            wine: building.wine * recoverable,
            ironwork: refund.ironwork + building.ironwork * recoverable,
            polearms: building.polearms * recoverable,
            wool: building.wool * recoverable,
            cloth: building.cloth * recoverable,
            barley: building.barley * recoverable,
            malt: building.malt * recoverable,
            flax: building.flax * recoverable,
            bread: building.bread * recoverable,
            meat: building.meat * recoverable,
            fish: building.fish * recoverable,
            berries: building.berries * recoverable,
            mushrooms: building.mushrooms * recoverable,
            milk: building.milk * recoverable,
            apples: building.apples * recoverable,
            cherries: building.cherries * recoverable,
            vegetables: building.vegetables * recoverable,
            eggs: building.eggs * recoverable,
            grapes: building.grapes * recoverable,
            porridge: building.porridge * recoverable,
            cured_meat: building.cured_meat * recoverable,
            smoked_fish: building.smoked_fish * recoverable,
            cheese: building.cheese * recoverable,
            gold: building.gold * recoverable,
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
            construction_priority: CONSTRUCTION_PRIORITY_NORMAL,
            founding_shelter_active: false,
            marketplace_pending_trade_code: 0,
            marketplace_gold_reserve_target: MARKETPLACE_GOLD_RESERVE_DEFAULT,
            chapel_monastery_tithe_due: 0.0,
            civic_receipts_gold: 0.0,
            remote_work_camp_enabled: false,
            linked_worksite_id: 0,
            ..building
        });
        return Ok(());
    }

    // Legacy saves retain their abstract refunds. Remove the source before
    // crediting recovered cargo so it cannot receive its own refund.
    let trip_cargo = drain_trips_for_building(ctx, building_id);
    ctx.db.building().id().delete(building_id);

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
    credit_treasury_gold(ctx, owner, building.gold * recoverable);
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
        CommodityKind::Ironwork,
        refund.ironwork + (building.ironwork + trip_cargo.ironwork) * recoverable,
    );
    credit_treasury_commodity(
        ctx,
        owner,
        CommodityKind::Polearms,
        (building.polearms + trip_cargo.polearms) * recoverable,
    );
    credit_treasury_commodity(
        ctx,
        owner,
        CommodityKind::Wool,
        (building.wool + trip_cargo.wool) * recoverable,
    );
    credit_treasury_commodity(
        ctx,
        owner,
        CommodityKind::Cloth,
        (building.cloth + trip_cargo.cloth) * recoverable,
    );
    credit_treasury_commodity(
        ctx,
        owner,
        CommodityKind::Barley,
        (building.barley + trip_cargo.barley) * recoverable,
    );
    credit_treasury_commodity(
        ctx,
        owner,
        CommodityKind::Malt,
        (building.malt + trip_cargo.malt) * recoverable,
    );
    credit_treasury_commodity(
        ctx,
        owner,
        CommodityKind::Flax,
        (building.flax + trip_cargo.flax) * recoverable,
    );
    for (commodity, amount) in [
        (CommodityKind::Bread, building.bread + trip_cargo.bread),
        (CommodityKind::Meat, building.meat + trip_cargo.meat),
        (CommodityKind::Fish, building.fish + trip_cargo.fish),
        (CommodityKind::Berries, building.berries + trip_cargo.berries),
        (CommodityKind::Mushrooms, building.mushrooms + trip_cargo.mushrooms),
        (CommodityKind::Milk, building.milk + trip_cargo.milk),
        (CommodityKind::Apples, building.apples + trip_cargo.apples),
        (CommodityKind::Cherries, building.cherries + trip_cargo.cherries),
        (CommodityKind::Vegetables, building.vegetables + trip_cargo.vegetables),
        (CommodityKind::Eggs, building.eggs + trip_cargo.eggs),
        (CommodityKind::Grapes, building.grapes + trip_cargo.grapes),
        (CommodityKind::Porridge, building.porridge + trip_cargo.porridge),
        (CommodityKind::CuredMeat, building.cured_meat + trip_cargo.cured_meat),
        (CommodityKind::SmokedFish, building.smoked_fish + trip_cargo.smoked_fish),
        (CommodityKind::Cheese, building.cheese + trip_cargo.cheese),
    ] {
        credit_treasury_commodity(ctx, owner, commodity, amount * recoverable);
    }

    Ok(())
}
