use spacetimedb::{reducer, ReducerContext, Table};

use crate::balance_generated::{
    RESIDENCE_TIER2_CAPACITY, RESIDENCE_TIER2_GOLD_COST, RESIDENCE_TIER2_STONE_COST,
    RESIDENCE_TIER2_TIMBER_COST, RESIDENCE_TIER3_CAPACITY, RESIDENCE_TIER3_GOLD_COST,
    RESIDENCE_TIER3_STONE_COST, RESIDENCE_TIER3_TIMBER_COST, RESIDENCE_TIER4_CAPACITY,
    RESIDENCE_TIER4_GOLD_COST, RESIDENCE_TIER4_STONE_COST, RESIDENCE_TIER4_TIMBER_COST,
    RESIDENCE_TILE_ROOF_SALVAGE_FRACTION, RESIDENCE_TILE_ROOF_TILE_COST,
    RESIDENCE_TILE_ROOF_TIMBER_COST,
};
use crate::burgage::{
    compute_burgage_layout, convex_zones_overlap, measure_zone_depth, min_zone_depth,
    residence_depth_cost_units, zone_corners_polygon, ZoneCorners,
};
use crate::construction_priority::{
    is_valid_construction_priority, CONSTRUCTION_PRIORITY_HOLD, CONSTRUCTION_PRIORITY_NORMAL,
};
use crate::db::*;
use crate::economy::{
    available_building_labor, building_commodity_stock, building_edible_food_stock,
    building_food_progression_met, credit_settlement_household_income, credit_treasury_commodity,
    credit_treasury_stone, credit_treasury_timber, reconcile_building_labor,
    residence_food_progression_met, residence_population_for_parcel,
    residence_savory_preserves_stock, residence_zone_cost, residence_zone_cost_for_units,
    spend_aggregate_roof_tiles, spend_aggregate_stone, spend_aggregate_timber, spend_treasury_gold,
    total_roof_tiles, total_stone, total_timber, treasury_gold, CommodityKind, ResourceAmount,
    STONE_SALVAGE_FRACTION, TIMBER_SALVAGE_FRACTION,
};
use crate::lifecycle::ensure_player_resources;
use crate::placement_validation::{
    burgage_zone_has_road_frontage, burgage_zone_overlaps_buildings, zone_overlaps_resource_deposit,
};
use crate::residence_service_policy::{required_chapel_tier, service_shortage_blocks_upgrade};
use crate::residence_upgrade_policy::{
    allocate_whole_residence_project_costs, household_stock_satisfies_promotion_need,
    residence_project_active, residence_promotion_needs, residence_upgrade_household_contribution,
};
use crate::resource_units::{whole_cost, whole_units};
use crate::roads::{load_owner_road_network, RoadNetwork};
use crate::simulation::residence_needs::{load_needs, need_stock, ResidenceNeedKind};
use crate::simulation::{
    building_fire_state, cancel_trips_for_residence, clear_backyard_garden_for_residence,
    clear_fire_for_target, clear_residence_needs, ensure_residence_needs, insert_reclamation_pile,
    local_delivery_distance, residence_fire_state, ReclamationStock, FIRE_TARGET_RESIDENCE,
};
use crate::supply_policy::is_well_supplier_operational;
use crate::tables::{farm_field, BurgageZone, Residence};
use crate::well_policy::position_within_well_service_radius;

fn whole_residence_project_contribution(household_wealth: f64, gold_cost: f64) -> f64 {
    let cost = whole_cost(gold_cost);
    whole_units(residence_upgrade_household_contribution(
        whole_units(household_wealth),
        cost,
    ))
    .min(cost)
}

#[reducer]
pub fn place_burgage_zone(
    ctx: &ReducerContext,
    corner_ax: f64,
    corner_az: f64,
    corner_bx: f64,
    corner_bz: f64,
    corner_cx: f64,
    corner_cz: f64,
    corner_dx: f64,
    corner_dz: f64,
    frontage_edge: u8,
    plot_count: u32,
) -> Result<(), String> {
    let owner = ctx.sender();
    ensure_player_resources(ctx, owner);

    let corners = ZoneCorners {
        a: crate::burgage::Point2 {
            x: corner_ax,
            z: corner_az,
        },
        b: crate::burgage::Point2 {
            x: corner_bx,
            z: corner_bz,
        },
        c: crate::burgage::Point2 {
            x: corner_cx,
            z: corner_cz,
        },
        d: crate::burgage::Point2 {
            x: corner_dx,
            z: corner_dz,
        },
    };

    let candidate_polygon = zone_corners_polygon(&corners);
    if zone_overlaps_resource_deposit(ctx, &corners) {
        return Err("Cannot place residences over a physical resource deposit.".to_string());
    }

    // Open-water overlap is validated by the placement client against the active
    // world's seed-aware rendered river mask. The server hydrology grid is a
    // groundwater/moisture proxy used for wells and crop yields; it is not the
    // active river layout and can be saturated on visibly dry land. Do not turn
    // that proxy into a second, contradictory water-placement check.

    if !burgage_zone_has_road_frontage(ctx, owner, &corners, frontage_edge) {
        return Err("Frontage must face a road.".to_string());
    }

    for existing in ctx.db.burgage_zone().owner().filter(&owner) {
        let existing_polygon = [
            crate::burgage::Point2 {
                x: existing.corner_ax,
                z: existing.corner_az,
            },
            crate::burgage::Point2 {
                x: existing.corner_bx,
                z: existing.corner_bz,
            },
            crate::burgage::Point2 {
                x: existing.corner_cx,
                z: existing.corner_cz,
            },
            crate::burgage::Point2 {
                x: existing.corner_dx,
                z: existing.corner_dz,
            },
        ];
        if convex_zones_overlap(&candidate_polygon, &existing_polygon) {
            return Err("Residence plot overlaps an existing zone.".to_string());
        }
    }

    if burgage_zone_overlaps_buildings(ctx, owner, &corners) {
        return Err("Residence plot overlaps an existing building.".to_string());
    }

    for field in ctx.db.farm_field().owner().filter(&owner) {
        let field_polygon = [
            crate::burgage::Point2 {
                x: field.corner_ax,
                z: field.corner_az,
            },
            crate::burgage::Point2 {
                x: field.corner_bx,
                z: field.corner_bz,
            },
            crate::burgage::Point2 {
                x: field.corner_cx,
                z: field.corner_cz,
            },
            crate::burgage::Point2 {
                x: field.corner_dx,
                z: field.corner_dz,
            },
        ];
        if convex_zones_overlap(&candidate_polygon, &field_polygon) {
            return Err("Residence plot overlaps cultivated farmland.".to_string());
        }
    }

    let zone_depth = measure_zone_depth(&corners, frontage_edge);
    if zone_depth + 1e-6 < min_zone_depth() {
        return Err("Plot is too shallow — pull the back edge farther from the road.".to_string());
    }

    let layout = compute_burgage_layout(&corners, frontage_edge, plot_count)
        .ok_or_else(|| "Could not fit residences in this zone.".to_string())?;
    crate::settlements::ensure_owner_settlements(ctx, owner);
    let settlement_x = (corner_ax + corner_bx + corner_cx + corner_dx) * 0.25;
    let settlement_z = (corner_az + corner_bz + corner_cz + corner_dz) * 0.25;
    let settlement_id = crate::settlements::residential_settlement_for_position(
        ctx,
        owner,
        settlement_x,
        settlement_z,
    )
    .ok_or_else(|| "Place a Founders' Camp before laying out homes here.".to_string())?;

    let residence_cost_units: Vec<f64> = layout
        .residences
        .iter()
        .map(|residence| residence_depth_cost_units(residence.backyard_depth))
        .collect();
    let total_cost_units = residence_cost_units.iter().sum::<f64>();
    let cost = residence_zone_cost_for_units(total_cost_units);
    let residence_timber_costs =
        allocate_whole_residence_project_costs(cost.timber, &residence_cost_units);
    let residence_stone_costs =
        allocate_whole_residence_project_costs(cost.stone, &residence_cost_units);
    if total_timber(ctx, owner) + 1e-6 < cost.timber {
        return Err(format!(
            "Not enough timber (need {} timber).",
            cost.timber.round() as i64
        ));
    }
    if total_stone(ctx, owner) + 1e-6 < cost.stone {
        return Err(format!(
            "Not enough stone (need {} stone).",
            cost.stone.round() as i64
        ));
    }
    let physical_economy = ctx
        .db
        .player_resources()
        .owner()
        .find(&owner)
        .is_some_and(|resources| resources.physical_founding_site_enabled);
    let physical_road_network =
        if physical_economy {
            Some(load_owner_road_network(ctx, owner).ok_or_else(|| {
                "Cottage works require a road-linked material source.".to_string()
            })?)
        } else {
            spend_aggregate_timber(ctx, owner, cost.timber)?;
            spend_aggregate_stone(ctx, owner, cost.stone)?;
            None
        };

    let inserted_zone = ctx.db.burgage_zone().insert(BurgageZone {
        id: 0,
        owner,
        corner_ax,
        corner_az,
        corner_bx,
        corner_bz,
        corner_cx,
        corner_cz,
        corner_dx,
        corner_dz,
        frontage_edge,
        plot_count: layout.plot_count,
        settlement_id,
    });
    let zone_id = inserted_zone.id;

    for (index, residence) in layout.residences.into_iter().enumerate() {
        let population_capacity = residence_population_for_parcel(residence.parcel_frontage);
        let required_timber = if physical_economy {
            residence_timber_costs[index]
        } else {
            0.0
        };
        let required_stone = if physical_economy {
            residence_stone_costs[index]
        } else {
            0.0
        };
        let inserted = ctx.db.residence().insert(Residence {
            id: 0,
            zone_id,
            owner,
            parcel_index: residence.parcel_index,
            x: residence.x,
            z: residence.z,
            yaw: residence.yaw,
            population: 0,
            population_capacity,
            // Tier zero is a physical cottage worksite, not an occupied house.
            // Existing saves never use it; their additive compatibility path
            // above still creates the former completed tier-one residence.
            tier: if physical_economy { 0 } else { 1 },
            settlement_ticks: 0,
            abandoned: false,
            household_wealth: 0.0,
            last_household_market_tick: 0,
            upgrade_target_tier: if physical_economy { 1 } else { 0 },
            upgrade_progress: 0.0,
            upgrade_required_timber: required_timber,
            upgrade_required_stone: required_stone,
            upgrade_required_gold: 0.0,
            upgrade_delivered_timber: 0.0,
            upgrade_delivered_stone: 0.0,
            upgrade_delivered_gold: 0.0,
            upgrade_reserved_timber: required_timber,
            upgrade_reserved_stone: required_stone,
            upgrade_reserved_gold: 0.0,
            upgrade_assigned_labor: 0,
            upgrade_priority: crate::construction_priority::CONSTRUCTION_PRIORITY_NORMAL,
            backyard_project_kind: 0,
            fire_repair_active: false,
            hunger_ticks: 0,
            malnutrition: 0.0,
            sick_population: 0,
            illness_ticks: 0,
            remedy_stock: 0.0,
            deaths_total: 0,
            comfort_deficit_ticks: 0,
            vacancy_ticks: 0,
            condition: 0,
            last_starvation_death_hunger_ticks: 0,
            decay_repair_active: false,
            tiled_roof: false,
            roof_tile_retrofit_active: false,
            upgrade_required_roof_tiles: 0.0,
            upgrade_delivered_roof_tiles: 0.0,
            upgrade_reserved_roof_tiles: 0.0,
            food: 0.0,
            honey: 0.0,
            meat: 0.0,
            fish: 0.0,
            berries: 0.0,
            mushrooms: 0.0,
            milk: 0.0,
            apples: 0.0,
            cherries: 0.0,
            eggs: 0.0,
            grapes: 0.0,
            cured_meat: 0.0,
            smoked_fish: 0.0,
            cheese: 0.0,
            food_inventory_migrated: true,
            last_discretionary_market_day: 0,
            rye_bread: 0.0,
            maslin_bread: 0.0,
            oat_grain: 0.0,
            pears: 0.0,
            aronia: 0.0,
            rosehips: 0.0,
            cabbage: 0.0,
            carrots: 0.0,
            beetroot: 0.0,
            aronia_jam: 0.0,
            rosehip_jam: 0.0,
            settlement_id,
            smallholding: false,
        });
        ensure_residence_needs(ctx, inserted.id);
        if let Some(network) = physical_road_network.as_ref() {
            ensure_upgrade_source_route(
                ctx,
                network,
                &inserted,
                CommodityKind::Timber,
                required_timber,
            )?;
            ensure_upgrade_source_route(
                ctx,
                network,
                &inserted,
                CommodityKind::Stone,
                required_stone,
            )?;
        }
    }

    Ok(())
}

#[reducer]
pub fn upgrade_residence(ctx: &ReducerContext, residence_id: u64) -> Result<(), String> {
    let owner = ctx.sender();
    ensure_player_resources(ctx, owner);
    let mut residence = ctx
        .db
        .residence()
        .id()
        .find(&residence_id)
        .ok_or_else(|| "Residence not found.".to_string())?;
    if residence.owner != owner {
        return Err("You do not own this residence.".to_string());
    }
    if residence.population == 0 {
        return Err("Only an occupied residence can be upgraded.".to_string());
    }
    if residence.smallholding {
        return Err(
            "A Smallholding is permanently locked at tier 1 and cannot become a town house."
                .to_string(),
        );
    }
    if residence_fire_state(ctx, residence.id).is_some() {
        return Err("Repair the fire-damaged residence before upgrading it.".to_string());
    }
    if residence_project_active(
        residence.upgrade_target_tier,
        residence.tier,
        residence.backyard_project_kind,
        residence.fire_repair_active,
        residence.decay_repair_active,
        residence.roof_tile_retrofit_active,
    ) {
        return Err("This household already has improvement works underway.".to_string());
    }
    let service_blocked = load_needs(ctx, residence.id)
        .into_iter()
        .filter(|need| need.kind.is_active_for_tier(residence.tier))
        .any(|need| service_shortage_blocks_upgrade(need.kind, need.deficit_ticks));
    if service_blocked {
        return Err(
            "Restore this household's sustained unmet needs before upgrading the residence."
                .to_string(),
        );
    }

    let next_tier = residence.tier.saturating_add(1);
    let (timber, stone, gold, roof_tiles, capacity): (f64, f64, f64, f64, u32) = match next_tier {
        2 => (
            RESIDENCE_TIER2_TIMBER_COST,
            RESIDENCE_TIER2_STONE_COST,
            RESIDENCE_TIER2_GOLD_COST,
            0.0,
            RESIDENCE_TIER2_CAPACITY,
        ),
        3 => (
            RESIDENCE_TIER3_TIMBER_COST,
            RESIDENCE_TIER3_STONE_COST,
            RESIDENCE_TIER3_GOLD_COST,
            0.0,
            RESIDENCE_TIER3_CAPACITY,
        ),
        4 => (
            RESIDENCE_TIER4_TIMBER_COST,
            RESIDENCE_TIER4_STONE_COST,
            RESIDENCE_TIER4_GOLD_COST,
            RESIDENCE_TILE_ROOF_TILE_COST,
            RESIDENCE_TIER4_CAPACITY,
        ),
        _ => return Err("This residence is already at tier 4.".to_string()),
    };
    let gold = whole_cost(gold);

    if let Some(unmet_need) = first_unmet_current_tier_promotion_need(ctx, &residence) {
        return Err(format!(
            "Current Tier {} need unmet: {}. Tier {} needs activate only after construction completes.",
            residence.tier,
            current_tier_promotion_remedy(unmet_need, residence.tier),
            next_tier,
        ));
    }
    let physical_economy = ctx
        .db
        .player_resources()
        .owner()
        .find(&owner)
        .is_some_and(|resources| resources.physical_founding_site_enabled);
    let household_contribution = if physical_economy {
        whole_residence_project_contribution(residence.household_wealth, gold)
    } else {
        0.0
    };
    let civic_gold_due = (gold - household_contribution).max(0.0);
    if total_timber(ctx, owner) + 1e-6 < timber {
        return Err(format!(
            "Needs {} more timber.",
            (timber - total_timber(ctx, owner)).ceil() as i64,
        ));
    }
    if total_stone(ctx, owner) + 1e-6 < stone {
        return Err(format!(
            "Needs {} more stone.",
            (stone - total_stone(ctx, owner)).ceil() as i64,
        ));
    }
    if treasury_gold(ctx, owner) + 1e-6 < civic_gold_due {
        return Err(format!(
            "Needs {} more treasury gold.",
            (civic_gold_due - treasury_gold(ctx, owner)).ceil() as i64,
        ));
    }
    if total_roof_tiles(ctx, owner) + 1e-6 < roof_tiles {
        return Err(format!(
            "Needs {} more fired roof tiles.",
            (roof_tiles - total_roof_tiles(ctx, owner)).ceil() as i64,
        ));
    }
    if physical_economy {
        let network = load_owner_road_network(ctx, owner).ok_or_else(|| {
            "Improvement works require a road-linked material source.".to_string()
        })?;
        ensure_upgrade_source_route(ctx, &network, &residence, CommodityKind::Timber, timber)?;
        ensure_upgrade_source_route(ctx, &network, &residence, CommodityKind::Stone, stone)?;
        ensure_upgrade_source_route(
            ctx,
            &network,
            &residence,
            CommodityKind::RoofTiles,
            roof_tiles,
        )?;
        if civic_gold_due > 1e-6 {
            ensure_upgrade_source_route(
                ctx,
                &network,
                &residence,
                CommodityKind::Gold,
                civic_gold_due,
            )?;
        }

        residence.household_wealth =
            (whole_units(residence.household_wealth) - household_contribution).max(0.0);
        residence.upgrade_target_tier = next_tier;
        residence.upgrade_progress = 0.0;
        residence.upgrade_required_timber = timber;
        residence.upgrade_required_stone = stone;
        residence.upgrade_required_gold = gold;
        residence.upgrade_required_roof_tiles = roof_tiles;
        residence.upgrade_delivered_timber = 0.0;
        residence.upgrade_delivered_stone = 0.0;
        residence.upgrade_delivered_gold = household_contribution;
        residence.upgrade_delivered_roof_tiles = 0.0;
        residence.upgrade_reserved_timber = timber;
        residence.upgrade_reserved_stone = stone;
        residence.upgrade_reserved_gold = civic_gold_due;
        residence.upgrade_reserved_roof_tiles = roof_tiles;
        residence.upgrade_assigned_labor = available_building_labor(ctx, owner).min(1);
        residence.upgrade_priority = CONSTRUCTION_PRIORITY_NORMAL;
        ctx.db.residence().id().update(residence);
        return Ok(());
    }

    spend_aggregate_timber(ctx, owner, timber)?;
    spend_aggregate_stone(ctx, owner, stone)?;
    spend_aggregate_roof_tiles(ctx, owner, roof_tiles)?;
    spend_treasury_gold(ctx, owner, civic_gold_due)?;
    credit_settlement_household_income(ctx, owner, gold);

    ctx.db.residence().id().update(Residence {
        tier: next_tier,
        population_capacity: capacity,
        settlement_ticks: 0,
        tiled_roof: next_tier >= 4,
        ..residence
    });
    ensure_residence_needs(ctx, residence_id);
    Ok(())
}

/// Permanently commits one tier-1 household to its backyard economy. This is
/// deliberately immediate: the opportunity cost is the entire family's labor,
/// not another temporary construction assignment.
#[reducer]
pub fn convert_residence_to_smallholding(
    ctx: &ReducerContext,
    residence_id: u64,
) -> Result<(), String> {
    let owner = ctx.sender();
    let mut residence = ctx
        .db
        .residence()
        .id()
        .find(&residence_id)
        .ok_or_else(|| "Residence not found.".to_string())?;
    if residence.owner != owner {
        return Err("You do not own this residence.".to_string());
    }
    if residence.smallholding {
        return Err("This residence is already a Smallholding.".to_string());
    }
    if residence.tier != 1 {
        return Err("Only a completed tier-1 residence can become a Smallholding.".to_string());
    }
    if residence.population == 0 {
        return Err("Only an occupied tier-1 residence can become a Smallholding.".to_string());
    }
    if residence_fire_state(ctx, residence.id).is_some() {
        return Err("Repair the fire-damaged residence before specializing it.".to_string());
    }
    if residence_project_active(
        residence.upgrade_target_tier,
        residence.tier,
        residence.backyard_project_kind,
        residence.fire_repair_active,
        residence.decay_repair_active,
        residence.roof_tile_retrofit_active,
    ) {
        return Err("Finish this household's active works before specializing it.".to_string());
    }

    residence.smallholding = true;
    ctx.db.residence().id().update(residence);
    reconcile_building_labor(ctx, owner);
    Ok(())
}

#[reducer]
pub fn retrofit_residence_tile_roof(ctx: &ReducerContext, residence_id: u64) -> Result<(), String> {
    let owner = ctx.sender();
    ensure_player_resources(ctx, owner);
    let mut residence = ctx
        .db
        .residence()
        .id()
        .find(&residence_id)
        .ok_or_else(|| "Residence not found.".to_string())?;
    if residence.owner != owner {
        return Err("You do not own this residence.".to_string());
    }
    if residence.tier < 4 {
        return Err("Fired-tile roofs are part of tier 4 construction.".to_string());
    }
    if residence.tiled_roof {
        return Err("This residence already has a fired-tile roof.".to_string());
    }
    if residence.population == 0 {
        return Err("Only an occupied residence can commission a roof retrofit.".to_string());
    }
    if residence_fire_state(ctx, residence.id).is_some() {
        return Err("Repair the fire-damaged residence before replacing its roof.".to_string());
    }
    if residence_project_active(
        residence.upgrade_target_tier,
        residence.tier,
        residence.backyard_project_kind,
        residence.fire_repair_active,
        residence.decay_repair_active,
        residence.roof_tile_retrofit_active,
    ) {
        return Err("This household already has improvement works underway.".to_string());
    }
    let physical_economy = ctx
        .db
        .player_resources()
        .owner()
        .find(&owner)
        .is_some_and(|resources| resources.physical_founding_site_enabled);
    if !physical_economy {
        return Err(
            "Roof tiles require the physical founding-store economy for carted delivery."
                .to_string(),
        );
    }
    let available_tiles = ctx
        .db
        .building()
        .owner()
        .filter(&owner)
        .map(|building| building.roof_tiles.max(0.0))
        .sum::<f64>();
    if total_timber(ctx, owner) + 1e-6 < RESIDENCE_TILE_ROOF_TIMBER_COST
        || available_tiles + 1e-6 < RESIDENCE_TILE_ROOF_TILE_COST
    {
        return Err(format!(
            "Roof retrofit requires {} timber battens and {} fired roof tiles in physical stores.",
            RESIDENCE_TILE_ROOF_TIMBER_COST.round() as i64,
            RESIDENCE_TILE_ROOF_TILE_COST.round() as i64,
        ));
    }
    let network = load_owner_road_network(ctx, owner)
        .ok_or_else(|| "Roof retrofit requires road-linked material sources.".to_string())?;
    ensure_upgrade_source_route(
        ctx,
        &network,
        &residence,
        CommodityKind::Timber,
        RESIDENCE_TILE_ROOF_TIMBER_COST,
    )?;
    ensure_upgrade_source_route(
        ctx,
        &network,
        &residence,
        CommodityKind::RoofTiles,
        RESIDENCE_TILE_ROOF_TILE_COST,
    )?;

    residence.roof_tile_retrofit_active = true;
    residence.upgrade_progress = 0.0;
    residence.upgrade_required_timber = RESIDENCE_TILE_ROOF_TIMBER_COST;
    residence.upgrade_required_stone = 0.0;
    residence.upgrade_required_gold = 0.0;
    residence.upgrade_required_roof_tiles = RESIDENCE_TILE_ROOF_TILE_COST;
    residence.upgrade_delivered_timber = 0.0;
    residence.upgrade_delivered_stone = 0.0;
    residence.upgrade_delivered_gold = 0.0;
    residence.upgrade_delivered_roof_tiles = 0.0;
    residence.upgrade_reserved_timber = RESIDENCE_TILE_ROOF_TIMBER_COST;
    residence.upgrade_reserved_stone = 0.0;
    residence.upgrade_reserved_gold = 0.0;
    residence.upgrade_reserved_roof_tiles = RESIDENCE_TILE_ROOF_TILE_COST;
    residence.upgrade_assigned_labor = available_building_labor(ctx, owner).min(1);
    residence.upgrade_priority = CONSTRUCTION_PRIORITY_NORMAL;
    ctx.db.residence().id().update(residence);
    Ok(())
}

#[reducer]
pub fn set_residence_upgrade_priority(
    ctx: &ReducerContext,
    residence_id: u64,
    priority: u8,
) -> Result<(), String> {
    if !is_valid_construction_priority(priority) {
        return Err("Unknown improvement priority.".to_string());
    }
    let owner = ctx.sender();
    let mut residence = ctx
        .db
        .residence()
        .id()
        .find(&residence_id)
        .ok_or_else(|| "Residence not found.".to_string())?;
    if residence.owner != owner {
        return Err("You do not own this residence.".to_string());
    }
    if !residence_project_active(
        residence.upgrade_target_tier,
        residence.tier,
        residence.backyard_project_kind,
        residence.fire_repair_active,
        residence.decay_repair_active,
        residence.roof_tile_retrofit_active,
    ) {
        return Err("This residence has no improvement works underway.".to_string());
    }
    residence.upgrade_priority = priority;
    if priority == CONSTRUCTION_PRIORITY_HOLD {
        residence.upgrade_assigned_labor = 0;
    }
    ctx.db.residence().id().update(residence);
    Ok(())
}

pub(crate) fn ensure_upgrade_source_route(
    ctx: &ReducerContext,
    network: &RoadNetwork,
    residence: &Residence,
    commodity: CommodityKind,
    needed: f64,
) -> Result<(), String> {
    if needed <= 1e-6 {
        return Ok(());
    }
    let reachable = ctx
        .db
        .building()
        .owner()
        .filter(&residence.owner)
        .any(|building| {
            if !building.construction_complete
                || building_fire_state(ctx, building.id).is_some()
                || building_commodity_stock(&building, commodity) <= 1e-6
            {
                return false;
            }
            if commodity == CommodityKind::Gold
                && !matches!(
                    building.kind.as_str(),
                    "town_hall" | "founders_camp" | "salvage_pile"
                )
            {
                return false;
            }
            local_delivery_distance(network, building.x, building.z, residence.x, residence.z)
                .is_some()
        });
    if reachable {
        Ok(())
    } else {
        Err(format!(
            "No reachable {} source can supply this household.",
            match commodity {
                CommodityKind::Timber => "timber",
                CommodityKind::Stone => "stone",
                CommodityKind::Gold => "civic treasury",
                CommodityKind::RoofTiles => "fired roof-tile",
                _ => "material",
            }
        ))
    }
}

fn first_unmet_current_tier_promotion_need(
    ctx: &ReducerContext,
    residence: &Residence,
) -> Option<ResidenceNeedKind> {
    let needs = load_needs(ctx, residence.id);
    let network = crate::roads::load_owner_road_network(ctx, residence.owner);
    let buildings: Vec<_> = ctx
        .db
        .building()
        .owner()
        .filter(&residence.owner)
        .filter(|building| building_fire_state(ctx, building.id).is_none())
        .collect();
    residence_promotion_needs(residence.tier)
        .into_iter()
        .find(|need| {
            if household_stock_satisfies_promotion_need(
                *need,
                need_stock(&needs, *need),
                residence_food_progression_met(residence, 1),
                residence_food_progression_met(residence, residence.tier),
                residence_savory_preserves_stock(residence),
                residence.aronia_jam + residence.rosehip_jam,
            ) {
                return false;
            }
            !buildings.iter().any(|building| {
                let Some(network) = network.as_ref() else {
                    return false;
                };
                let Some(_distance) = local_delivery_distance(
                    network,
                    building.x,
                    building.z,
                    residence.x,
                    residence.z,
                ) else {
                    return false;
                };
                match need {
                    ResidenceNeedKind::Firewood => {
                        building.kind == "marketplace"
                            && building.construction_complete
                            && building_commodity_stock(building, CommodityKind::Firewood)
                                + building_commodity_stock(building, CommodityKind::Charcoal)
                                > 1e-6
                    }
                    ResidenceNeedKind::Water => {
                        is_well_supplier_operational(
                            &building.kind,
                            building.construction_complete,
                            building.assigned_labor,
                        ) && position_within_well_service_radius(
                            building.x,
                            building.z,
                            building.work_radius,
                            residence.x,
                            residence.z,
                        )
                    }
                    ResidenceNeedKind::Food => {
                        building.kind == "marketplace"
                            && building.construction_complete
                            && building_edible_food_stock(building) > 1e-6
                    }
                    ResidenceNeedKind::Ale => {
                        building.kind == "tavern"
                            && building.construction_complete
                            && building.assigned_labor > 0
                            && building_commodity_stock(building, CommodityKind::Ale)
                                + building_commodity_stock(building, CommodityKind::Cider)
                                + building_commodity_stock(building, CommodityKind::PearCider)
                                + building_commodity_stock(building, CommodityKind::Mead)
                                > 1e-6
                    }
                    ResidenceNeedKind::SavoryPreserves => {
                        building.kind == "marketplace"
                            && building.construction_complete
                            && crate::economy::building_savory_preserves_stock(building) > 1e-6
                    }
                    ResidenceNeedKind::Cloth => {
                        building.kind == "marketplace"
                            && building.construction_complete
                            && building_commodity_stock(building, CommodityKind::Cloth) > 1e-6
                    }
                    ResidenceNeedKind::Shoes => {
                        building.kind == "marketplace"
                            && building.construction_complete
                            && building_commodity_stock(building, CommodityKind::Shoes) > 1e-6
                    }
                    ResidenceNeedKind::Pottery => {
                        building.kind == "marketplace"
                            && building.construction_complete
                            && building_commodity_stock(building, CommodityKind::Pottery) > 1e-6
                    }
                    ResidenceNeedKind::Church => {
                        building.kind == "chapel"
                            && building.construction_complete
                            && building.assigned_labor > 0
                            && building.chapel_tier.max(1) >= required_chapel_tier(residence.tier)
                    }
                    ResidenceNeedKind::Luxury => {
                        building.kind == "marketplace"
                            && building.construction_complete
                            && building_commodity_stock(building, CommodityKind::Wine)
                                + building_commodity_stock(building, CommodityKind::Honey)
                                + building_commodity_stock(building, CommodityKind::Candles)
                                > 1e-6
                    }
                    ResidenceNeedKind::FoodVariety => {
                        building.kind == "marketplace"
                            && building.construction_complete
                            && building_food_progression_met(
                                building,
                                residence.population,
                                residence.tier,
                            )
                    }
                }
            })
        })
}

fn current_tier_promotion_remedy(kind: ResidenceNeedKind, current_tier: u8) -> String {
    match kind {
        ResidenceNeedKind::Firewood => {
            "stock the household with firewood or charcoal, or stage it at a reachable Marketplace"
                .to_string()
        }
        ResidenceNeedKind::Water => {
            "connect the home to a completed well within its service radius".to_string()
        }
        ResidenceNeedKind::Food => {
            "stock qualifying food in the household pantry or a reachable Marketplace".to_string()
        }
        ResidenceNeedKind::Ale => {
            "stock the household with beverages, or stage ale, cider, or mead at a staffed reachable Tavern"
                .to_string()
        }
        ResidenceNeedKind::SavoryPreserves => {
            "stock the household with savory preserves, or stage them at a reachable Marketplace"
                .to_string()
        }
        ResidenceNeedKind::Cloth => {
            "stock the household with cloth, or stage it at a reachable Marketplace goods stall"
                .to_string()
        }
        ResidenceNeedKind::Shoes => {
            "stock the household with shoes, or stage them at a reachable Marketplace goods stall"
                .to_string()
        }
        ResidenceNeedKind::Pottery => {
            "stock the household with pottery, or stage it at a reachable Marketplace goods stall"
                .to_string()
        }
        ResidenceNeedKind::Church => format!(
            "staff a reachable level-{} church",
            required_chapel_tier(current_tier),
        ),
        ResidenceNeedKind::FoodVariety => {
            format!(
                "meet the Tier {current_tier} food standard in the household pantry or one reachable Marketplace"
            )
        }
        ResidenceNeedKind::Luxury => {
            "stock candles, wine, or honey at a reachable Marketplace or in the household"
                .to_string()
        }
    }
}

fn allocated_whole_salvage_share(total: f64, index: usize, recipients: usize) -> f64 {
    if recipients == 0 || index >= recipients {
        return 0.0;
    }
    let total = whole_units(total) as u64;
    let recipients = recipients as u64;
    let base = total / recipients;
    let remainder = total % recipients;
    (base + u64::from((index as u64) < remainder)) as f64
}

#[reducer]
pub fn demolish_residence(ctx: &ReducerContext, residence_id: u64) -> Result<(), String> {
    let owner = ctx.sender();
    let residence = ctx
        .db
        .residence()
        .id()
        .find(&residence_id)
        .ok_or_else(|| "Residence not found.".to_string())?;

    if residence.owner != owner {
        return Err("You do not own this residence.".to_string());
    }

    let zone_id = residence.zone_id;
    let fire_damaged = residence_fire_state(ctx, residence_id).is_some();
    let refund = residence_zone_cost(if !fire_damaged && residence.tier >= 1 {
        1
    } else {
        0
    });
    let recover_project_materials = !fire_damaged || residence.fire_repair_active;
    let salvaged_roof_tiles = whole_units(
        (if recover_project_materials && residence.tiled_roof {
            RESIDENCE_TILE_ROOF_TILE_COST
        } else {
            0.0
        } + if recover_project_materials {
            residence.upgrade_delivered_roof_tiles
        } else {
            0.0
        }) * RESIDENCE_TILE_ROOF_SALVAGE_FRACTION,
    );
    let salvage = ResourceAmount {
        timber: whole_units(
            (refund.timber
                + if recover_project_materials {
                    residence.upgrade_delivered_timber
                } else {
                    0.0
                })
                * TIMBER_SALVAGE_FRACTION,
        ),
        stone: whole_units(
            (refund.stone
                + if recover_project_materials {
                    residence.upgrade_delivered_stone
                } else {
                    0.0
                })
                * STONE_SALVAGE_FRACTION,
        ),
        ironwork: 0.0,
        roof_tiles: 0.0,
    };
    if !insert_reclamation_pile(
        ctx,
        owner,
        residence.x,
        residence.z,
        ReclamationStock {
            timber: salvage.timber,
            stone: salvage.stone,
            roof_tiles: salvaged_roof_tiles,
            ..ReclamationStock::default()
        },
    )? {
        credit_treasury_timber(ctx, owner, salvage.timber);
        credit_treasury_stone(ctx, owner, salvage.stone);
        credit_treasury_commodity(ctx, owner, CommodityKind::RoofTiles, salvaged_roof_tiles);
    }

    clear_residence_needs(ctx, residence_id);
    clear_backyard_garden_for_residence(ctx, residence_id);
    cancel_trips_for_residence(ctx, residence_id);
    clear_fire_for_target(ctx, FIRE_TARGET_RESIDENCE, residence_id);
    ctx.db.residence().id().delete(residence_id);
    reconcile_building_labor(ctx, owner);

    let remaining = ctx.db.residence().zone_id().filter(&zone_id).count();
    if remaining == 0 {
        ctx.db.burgage_zone().id().delete(zone_id);
    }

    Ok(())
}

#[reducer]
pub fn demolish_burgage_zone(ctx: &ReducerContext, zone_id: u64) -> Result<(), String> {
    let owner = ctx.sender();
    let zone = ctx
        .db
        .burgage_zone()
        .id()
        .find(&zone_id)
        .ok_or_else(|| "Residence zone not found.".to_string())?;

    if zone.owner != owner {
        return Err("You do not own this residence zone.".to_string());
    }

    let mut residences: Vec<Residence> = ctx.db.residence().zone_id().filter(&zone_id).collect();
    residences.sort_by_key(|residence| residence.id);
    let completed_intact_residence_count = residences
        .iter()
        .filter(|residence| {
            residence.tier >= 1 && residence_fire_state(ctx, residence.id).is_none()
        })
        .count() as u32;
    let refund = residence_zone_cost(completed_intact_residence_count);
    let base_timber = whole_units(refund.timber * TIMBER_SALVAGE_FRACTION);
    let base_stone = whole_units(refund.stone * STONE_SALVAGE_FRACTION);
    let completed_count = completed_intact_residence_count as usize;
    let mut completed_index = 0_usize;
    let mut salvage_by_residence = Vec::with_capacity(residences.len());
    let mut total_salvage = ReclamationStock::default();
    for residence in &residences {
        let fire_damaged = residence_fire_state(ctx, residence.id).is_some();
        let recover_project_materials = !fire_damaged || residence.fire_repair_active;
        if !recover_project_materials {
            salvage_by_residence.push((residence, ReclamationStock::default()));
            continue;
        }
        let completed_structure = !fire_damaged && residence.tier >= 1;
        let (completed_timber, completed_stone) = if completed_structure {
            let share = (
                allocated_whole_salvage_share(base_timber, completed_index, completed_count),
                allocated_whole_salvage_share(base_stone, completed_index, completed_count),
            );
            completed_index += 1;
            share
        } else {
            (0.0, 0.0)
        };
        let stock = ReclamationStock {
            timber: completed_timber
                + whole_units(residence.upgrade_delivered_timber * TIMBER_SALVAGE_FRACTION),
            stone: completed_stone
                + whole_units(residence.upgrade_delivered_stone * STONE_SALVAGE_FRACTION),
            roof_tiles: whole_units(
                (if residence.tiled_roof {
                    RESIDENCE_TILE_ROOF_TILE_COST
                } else {
                    0.0
                } + residence.upgrade_delivered_roof_tiles)
                    * RESIDENCE_TILE_ROOF_SALVAGE_FRACTION,
            ),
            ..ReclamationStock::default()
        }
        .normalized();
        total_salvage = total_salvage.merged(stock);
        salvage_by_residence.push((residence, stock));
    }
    let mut physical_reclamation = false;
    for (residence, stock) in salvage_by_residence {
        if stock.is_empty() {
            continue;
        }
        physical_reclamation |=
            insert_reclamation_pile(ctx, owner, residence.x, residence.z, stock)?;
    }
    if !physical_reclamation {
        credit_treasury_timber(ctx, owner, total_salvage.timber);
        credit_treasury_stone(ctx, owner, total_salvage.stone);
        credit_treasury_commodity(
            ctx,
            owner,
            CommodityKind::RoofTiles,
            total_salvage.roof_tiles,
        );
    }

    for residence in residences {
        clear_residence_needs(ctx, residence.id);
        clear_backyard_garden_for_residence(ctx, residence.id);
        cancel_trips_for_residence(ctx, residence.id);
        clear_fire_for_target(ctx, FIRE_TARGET_RESIDENCE, residence.id);
        ctx.db.residence().id().delete(residence.id);
    }
    ctx.db.burgage_zone().id().delete(zone_id);
    reconcile_building_labor(ctx, owner);
    Ok(())
}

#[cfg(test)]
mod demolition_tests {
    use super::{allocated_whole_salvage_share, whole_residence_project_contribution};

    #[test]
    fn residence_upgrade_contribution_uses_only_whole_coins() {
        assert_eq!(whole_residence_project_contribution(15.9, 8.4), 3.0);
        assert_eq!(whole_residence_project_contribution(50.0, 8.4), 9.0);
        assert_eq!(whole_residence_project_contribution(11.9, 8.4), 0.0);
    }

    #[test]
    fn zone_salvage_distributes_only_whole_units_without_losing_remainders() {
        let shares = (0..4)
            .map(|index| allocated_whole_salvage_share(11.9, index, 4))
            .collect::<Vec<_>>();
        assert_eq!(shares, vec![3.0, 3.0, 3.0, 2.0]);
        assert_eq!(shares.iter().sum::<f64>(), 11.0);
        assert_eq!(allocated_whole_salvage_share(11.0, 4, 4), 0.0);
        assert_eq!(allocated_whole_salvage_share(11.0, 0, 0), 0.0);
    }
}
