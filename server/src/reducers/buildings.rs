use spacetimedb::{reducer, ReducerContext, Table};

use crate::balance_generated::{
    CARPENTER_TIMBER_COST_MULTIPLIER, CONSTRUCTION_MAX_BUILDERS, TOWN_HALL_POPULATION_REQUIRED,
};
use crate::building_defs::{building_def, building_def_or_err};
use crate::burgage::{zone_overlaps_footprint, Point2};
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
    initial_construction_labor, total_stone, total_timber, CommodityKind,
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
    is_valid_marketplace_ironwork_target, is_valid_marketplace_seed_grain_target,
};
use crate::placement_validation::{
    building_overlaps_open_water, building_overlaps_residence_zone, building_overlaps_road_surface,
    building_site_contains_point, is_near_open_water, is_on_quarry_pit, is_open_water,
};
use crate::processor_labor_policy::{
    processor_callup_targets, production_steward_callup_allowed, ProcessorCallupCandidate,
};
use crate::processor_output_policy::{
    is_processor_output_target_kind, is_valid_processor_output_target_percent,
    processor_output_headroom, processor_output_kind, ProcessorOutputKind,
    PROCESSOR_OUTPUT_TARGET_DEFAULT_PERCENT,
};
use crate::roads::load_owner_road_network;
use crate::simulation::{
    building_fire_state, building_has_active_trip, building_has_inbound_commodity_trip,
    building_has_inbound_supply_trip, call_up_active_seasonal_labor_for_owner,
    cancel_inbound_construction_trips_for_site, clear_fire_for_target, drain_trips_for_building,
    game_clock, owner_has_staffed_town_hall, recall_idle_seasonal_labor_for_owner,
    FIRE_TARGET_BUILDING,
};
use crate::specialty_trade_policy::is_valid_specialty_export_policy;
use crate::storehouse_policy::{
    is_valid_storehouse_stock_target_percent, STOREHOUSE_STOCK_TARGET_DEFAULT_PERCENT,
};
use crate::tables::{
    farm_field, livestock_herd, pasture, Building, ForagingNode, Quarry, WorldConfig,
};
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
    let carpenter_polearm_reserve = if kind == "carpenter" {
        CARPENTER_POLEARM_RESERVE_DEFAULT
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
        ironwork: 0.0,
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
        marketplace_specialty_export_policy: 0,
        granary_fresh_food_target_percent: GRANARY_FRESH_FOOD_TARGET_DEFAULT_PERCENT,
        storehouse_timber_target_percent: STOREHOUSE_STOCK_TARGET_DEFAULT_PERCENT,
        storehouse_stone_target_percent: STOREHOUSE_STOCK_TARGET_DEFAULT_PERCENT,
        storehouse_firewood_target_percent: STOREHOUSE_STOCK_TARGET_DEFAULT_PERCENT,
        processor_output_target_percent: PROCESSOR_OUTPUT_TARGET_DEFAULT_PERCENT,
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
                building.construction_delivered_timber,
                building.construction_delivered_stone,
                building.construction_progress,
                building.construction_treasury_timber,
                building.construction_treasury_stone,
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
        building.assigned_labor = target_labor.min(CONSTRUCTION_MAX_BUILDERS);
        ctx.db.building().id().update(building);
    }
    rotation
}

/// Recalls only production workers whose seasonal task is currently dormant.
/// A site keeps one worker while stored exportable goods or an active cart
/// still need a hauler. Restaffing remains an explicit player decision.
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
    match processor_output_kind(kind)? {
        ProcessorOutputKind::Flour => Some(CommodityKind::Flour),
        ProcessorOutputKind::Food => Some(CommodityKind::Food),
        ProcessorOutputKind::Ale => Some(CommodityKind::Ale),
        ProcessorOutputKind::PreservedFood => Some(CommodityKind::PreservedFood),
        ProcessorOutputKind::Cloth => Some(CommodityKind::Cloth),
    }
}

fn processor_output_room(building: &Building) -> Option<f64> {
    let commodity = processor_output_commodity(&building.kind)?;
    Some(processor_output_headroom(
        building_commodity_stock(building, commodity),
        building_commodity_cap(&building.kind, commodity),
        building.processor_output_target_percent,
    ))
}

fn processor_input_commodities(kind: &str) -> &'static [CommodityKind] {
    const WATERMILL: [CommodityKind; 1] = [CommodityKind::Grain];
    const GRANARY: [CommodityKind; 3] = [
        CommodityKind::Flour,
        CommodityKind::Water,
        CommodityKind::Firewood,
    ];
    const BREWERY: [CommodityKind; 2] = [CommodityKind::Grain, CommodityKind::Water];
    const SMOKEHOUSE: [CommodityKind; 2] = [CommodityKind::Food, CommodityKind::Firewood];
    const WEAVER: [CommodityKind; 1] = [CommodityKind::Wool];

    match kind {
        "watermill" => &WATERMILL,
        "granary" => &GRANARY,
        "brewery" => &BREWERY,
        "smokehouse" => &SMOKEHOUSE,
        "weaver" => &WEAVER,
        _ => &[],
    }
}

fn processor_stall_and_recovery(ctx: &ReducerContext, building: &Building) -> (bool, bool) {
    if processor_output_room(building).is_some_and(|headroom| headroom <= 1e-6) {
        return (true, false);
    }

    let missing_inputs: Vec<CommodityKind> = processor_input_commodities(&building.kind)
        .iter()
        .copied()
        .filter(|commodity| building_commodity_stock(building, *commodity) <= 1e-6)
        .collect();
    if missing_inputs.is_empty() {
        return (false, false);
    }
    let every_missing_input_en_route = missing_inputs
        .iter()
        .all(|commodity| building_has_inbound_commodity_trip(ctx, building.id, *commodity));
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
            |_| true,
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
            |quarry| quarry.is_rich,
            |_| true,
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

fn production_site_ready(
    building: &Building,
    quarry_buckets: &SpatialBuckets<Quarry>,
    foraging_buckets: &SpatialBuckets<ForagingNode>,
) -> bool {
    match building.kind.as_str() {
        kind if is_processor_output_target_kind(kind) => {
            processor_output_room(building).is_some_and(|headroom| headroom > 1e-6)
        }
        "stone_quarry" => {
            !commodity_output_blocked(building, CommodityKind::Stone)
                && stone_source_usable(building, quarry_buckets)
        }
        "large_quarry" => {
            !commodity_output_blocked(building, CommodityKind::Stone)
                && rich_stone_source_usable(building, quarry_buckets)
        }
        "hunters_hall" => {
            !commodity_output_blocked(building, CommodityKind::Food)
                && wild_stock_source_usable(building, "game", foraging_buckets)
        }
        _ => false,
    }
}

/// Returns surplus crews from authoritatively stalled processors, quarries,
/// hunting halls, and seasonally active fishing camps. The legacy reducer name
/// is retained for generated-binding and save compatibility. Matching inbound
/// inputs protect recovering workshops; stored output or an active cart keeps
/// one dispatcher.
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
            recalled = recalled.saturating_add(building.assigned_labor);
            building.assigned_labor = 0;
            ctx.db.building().id().update(building);
            continue;
        }
        let has_active_trip = building_has_active_trip(ctx, building.id);
        let (stalled, supply_en_route, has_dispatch_duty) = match building.kind.as_str() {
            kind if is_processor_output_target_kind(kind) => {
                let (stalled, supply_en_route) = processor_stall_and_recovery(ctx, &building);
                let has_output_stock = processor_output_commodity(kind)
                    .is_some_and(|commodity| building_commodity_stock(&building, commodity) > 1e-6);
                (
                    stalled,
                    supply_en_route,
                    has_output_stock || has_active_trip,
                )
            }
            "stone_quarry" => (
                commodity_output_blocked(&building, CommodityKind::Stone)
                    || !stone_source_usable(&building, &quarry_buckets),
                false,
                has_active_trip,
            ),
            "large_quarry" => (
                commodity_output_blocked(&building, CommodityKind::Stone)
                    || !rich_stone_source_usable(&building, &quarry_buckets),
                false,
                has_active_trip,
            ),
            "hunters_hall" | "fishing_camp"
                if building.kind == "hunters_hall" || harvest_available("fish", month) =>
            {
                let node_kind = if building.kind == "hunters_hall" {
                    "game"
                } else {
                    "fish"
                };
                (
                    commodity_output_blocked(&building, CommodityKind::Food)
                        || !wild_stock_source_usable(&building, node_kind, &foraging_buckets),
                    false,
                    building.food > 1e-6 || has_active_trip,
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
        recalled = recalled.saturating_add(building.assigned_labor - target_labor);
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
/// source-ready quarries or hunting halls. Staffing priority tiers fill from
/// high to low, with round-robin sharing inside each tier. The legacy reducer
/// name is retained for generated-binding compatibility.
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
                available_labor = available_labor.saturating_add(building.assigned_labor);
                fire_disabled_sites.push(building.id);
            }
            continue;
        }
        sites.push(YearRoundLaborSite {
            building_id: building.id,
            priority: building.construction_priority,
            assigned_labor: building.assigned_labor,
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
        building.assigned_labor = 0;
        ctx.db.building().id().update(building);
    }
    for (building_id, target_labor) in rotation.targets {
        let Some(mut building) = ctx.db.building().id().find(&building_id) else {
            continue;
        };
        if building.owner != owner || target_labor == building.assigned_labor {
            continue;
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
        _ => {
            return Err(
                "Storehouse stock target applies only to timber, stone, or firewood.".to_string(),
            )
        }
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
        return Err("Processor output target must be 25%, 50%, 75%, or 100%.".to_string());
    }
    let owner = ctx.sender();
    let mut building = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Processing workshop not found.".to_string())?;
    if building.owner != owner
        || !building.construction_complete
        || !is_processor_output_target_kind(&building.kind)
    {
        return Err("You do not own this completed processing workshop.".to_string());
    }
    building.processor_output_target_percent = target_percent;
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
        CommodityKind::Ironwork,
        (building.ironwork + trip_cargo.ironwork) * recoverable,
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
