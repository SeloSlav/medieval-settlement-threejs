use spacetimedb::{reducer, ReducerContext, Table};

use crate::balance_generated::{
    MONASTERY_COVERAGE_RADIUS, RESIDENCE_STONE_COST, RESIDENCE_TIER2_CAPACITY,
    RESIDENCE_TIER2_GOLD_COST, RESIDENCE_TIER2_STONE_COST, RESIDENCE_TIER2_TIMBER_COST,
    RESIDENCE_TIER3_CAPACITY, RESIDENCE_TIER3_GOLD_COST, RESIDENCE_TIER3_STONE_COST,
    RESIDENCE_TIER3_TIMBER_COST, RESIDENCE_TILE_ROOF_SALVAGE_FRACTION,
    RESIDENCE_TILE_ROOF_TILE_COST, RESIDENCE_TILE_ROOF_TIMBER_COST, RESIDENCE_TIMBER_COST,
};
use crate::burgage::{
    compute_burgage_layout, convex_zones_overlap, max_zone_depth, measure_zone_depth,
    measure_zone_side_depths, min_zone_depth, zone_corners_polygon, ZoneCorners,
};
use crate::construction_priority::{
    is_valid_construction_priority, CONSTRUCTION_PRIORITY_HOLD, CONSTRUCTION_PRIORITY_NORMAL,
};
use crate::db::*;
use crate::economy::{
    available_building_labor, building_commodity_stock, credit_treasury_commodity,
    credit_treasury_stone, credit_treasury_timber, reconcile_building_labor,
    residence_population_for_parcel, residence_zone_cost, spend_aggregate_stone,
    spend_aggregate_timber, spend_treasury_gold, total_stone, total_timber, treasury_gold,
    CommodityKind, ResourceAmount, STONE_SALVAGE_FRACTION, TIMBER_SALVAGE_FRACTION,
};
use crate::lifecycle::ensure_player_resources;
use crate::placement_validation::{
    burgage_zone_has_road_frontage, burgage_zone_overlaps_buildings, zone_overlaps_resource_deposit,
};
use crate::residence_service_policy::service_shortage_blocks_upgrade;
use crate::residence_upgrade_policy::{
    residence_project_active, residence_upgrade_household_contribution,
};
use crate::roads::{load_owner_road_network, RoadNetwork};
use crate::simulation::residence_needs::load_needs;
use crate::simulation::{
    building_fire_state, cancel_trips_for_residence, clear_backyard_garden_for_residence,
    clear_fire_for_target, clear_residence_needs, ensure_residence_needs, insert_reclamation_pile,
    local_delivery_distance, residence_fire_state, ReclamationStock, FIRE_TARGET_RESIDENCE,
};
use crate::supply_policy::{
    is_firewood_supplier_operational, is_specialty_supplier_operational,
    is_well_supplier_operational, ALE_PRODUCER_KINDS, CLOTH_PRODUCER_KINDS, POTTERY_PRODUCER_KINDS,
    PRESERVED_FOOD_PRODUCER_KINDS,
};
use crate::tables::{farm_field, BurgageZone, Residence};
use crate::well_policy::position_within_well_service_radius;

#[derive(Clone, Copy)]
enum ResidenceUpgradeService {
    Firewood,
    Water,
    PreservedFood,
    Ale,
    Cloth,
    Pottery,
    Marketplace,
    GranaryStalls,
    StorehouseStalls,
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
    let side_depths = measure_zone_side_depths(&corners, frontage_edge);
    if zone_depth + 1e-6 < min_zone_depth() {
        return Err("Plot is too shallow — pull the back edge farther from the road.".to_string());
    }
    if side_depths.0.max(side_depths.1) > max_zone_depth() + 0.05 {
        return Err("Plot is too deep — shorten the backyard behind the road.".to_string());
    }

    let layout = compute_burgage_layout(&corners, frontage_edge, plot_count)
        .ok_or_else(|| "Could not fit residences in this zone.".to_string())?;

    let cost = residence_zone_cost(layout.plot_count);
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

    ctx.db.burgage_zone().insert(BurgageZone {
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
    });

    let zone_id = ctx
        .db
        .burgage_zone()
        .iter()
        .map(|zone| zone.id)
        .max()
        .ok_or_else(|| "Failed to resolve residence zone id.".to_string())?;

    for residence in layout.residences {
        let population_capacity = residence_population_for_parcel(residence.parcel_frontage);
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
            upgrade_required_timber: if physical_economy {
                RESIDENCE_TIMBER_COST
            } else {
                0.0
            },
            upgrade_required_stone: if physical_economy {
                RESIDENCE_STONE_COST
            } else {
                0.0
            },
            upgrade_required_gold: 0.0,
            upgrade_delivered_timber: 0.0,
            upgrade_delivered_stone: 0.0,
            upgrade_delivered_gold: 0.0,
            upgrade_reserved_timber: if physical_economy {
                RESIDENCE_TIMBER_COST
            } else {
                0.0
            },
            upgrade_reserved_stone: if physical_economy {
                RESIDENCE_STONE_COST
            } else {
                0.0
            },
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
        });
        ensure_residence_needs(ctx, inserted.id);
        if let Some(network) = physical_road_network.as_ref() {
            ensure_upgrade_source_route(
                ctx,
                network,
                &inserted,
                CommodityKind::Timber,
                RESIDENCE_TIMBER_COST,
            )?;
            ensure_upgrade_source_route(
                ctx,
                network,
                &inserted,
                CommodityKind::Stone,
                RESIDENCE_STONE_COST,
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
    let max_service_deficit = load_needs(ctx, residence.id)
        .into_iter()
        .filter(|need| need.kind.is_active_for_tier(residence.tier))
        .map(|need| need.deficit_ticks)
        .max()
        .unwrap_or(0);
    if service_shortage_blocks_upgrade(max_service_deficit) {
        return Err(
            "Restore this household's sustained unmet needs before upgrading the residence."
                .to_string(),
        );
    }

    let next_tier = residence.tier.saturating_add(1);
    let (timber, stone, gold, capacity, required_services): (
        f64,
        f64,
        f64,
        u32,
        &[ResidenceUpgradeService],
    ) = match next_tier {
        2 => (
            RESIDENCE_TIER2_TIMBER_COST,
            RESIDENCE_TIER2_STONE_COST,
            RESIDENCE_TIER2_GOLD_COST,
            RESIDENCE_TIER2_CAPACITY,
            &[
                ResidenceUpgradeService::Firewood,
                ResidenceUpgradeService::Water,
                ResidenceUpgradeService::Marketplace,
                ResidenceUpgradeService::StorehouseStalls,
            ],
        ),
        3 => (
            RESIDENCE_TIER3_TIMBER_COST,
            RESIDENCE_TIER3_STONE_COST,
            RESIDENCE_TIER3_GOLD_COST,
            RESIDENCE_TIER3_CAPACITY,
            &[
                ResidenceUpgradeService::PreservedFood,
                ResidenceUpgradeService::Ale,
                ResidenceUpgradeService::Cloth,
                ResidenceUpgradeService::Pottery,
                ResidenceUpgradeService::Marketplace,
                ResidenceUpgradeService::GranaryStalls,
                ResidenceUpgradeService::StorehouseStalls,
            ],
        ),
        _ => return Err("This residence is already at tier 3.".to_string()),
    };

    if !has_connected_services(ctx, &residence, required_services) {
        return Err(if next_tier == 2 {
            "Tier 2 requires a staffed woodcutter and storehouse, a road-linked Marketplace for fuel stalls, and a completed well in service range.".to_string()
        } else {
            "Tier 3 requires a Marketplace with staffed granary and storehouse stalls plus preserved-food, ale, cloth, and pottery production.".to_string()
        });
    }
    let physical_economy = ctx
        .db
        .player_resources()
        .owner()
        .find(&owner)
        .is_some_and(|resources| resources.physical_founding_site_enabled);
    let household_contribution = if physical_economy {
        residence_upgrade_household_contribution(residence.household_wealth, gold)
    } else {
        0.0
    };
    let civic_gold_due = (gold - household_contribution).max(0.0);
    if total_timber(ctx, owner) + 1e-6 < timber
        || total_stone(ctx, owner) + 1e-6 < stone
        || treasury_gold(ctx, owner) + 1e-6 < civic_gold_due
    {
        return Err(format!(
            "Upgrade requires {} timber, {} stone, and {} gold after household savings.",
            timber.round() as i64,
            stone.round() as i64,
            civic_gold_due.round() as i64,
        ));
    }
    if physical_economy {
        let network = load_owner_road_network(ctx, owner).ok_or_else(|| {
            "Improvement works require a road-linked material source.".to_string()
        })?;
        ensure_upgrade_source_route(ctx, &network, &residence, CommodityKind::Timber, timber)?;
        ensure_upgrade_source_route(ctx, &network, &residence, CommodityKind::Stone, stone)?;
        if civic_gold_due > 1e-6 {
            ensure_upgrade_source_route(
                ctx,
                &network,
                &residence,
                CommodityKind::Gold,
                civic_gold_due,
            )?;
        }

        residence.household_wealth = (residence.household_wealth - household_contribution).max(0.0);
        residence.upgrade_target_tier = next_tier;
        residence.upgrade_progress = 0.0;
        residence.upgrade_required_timber = timber;
        residence.upgrade_required_stone = stone;
        residence.upgrade_required_gold = gold;
        residence.upgrade_delivered_timber = 0.0;
        residence.upgrade_delivered_stone = 0.0;
        residence.upgrade_delivered_gold = household_contribution;
        residence.upgrade_reserved_timber = timber;
        residence.upgrade_reserved_stone = stone;
        residence.upgrade_reserved_gold = civic_gold_due;
        residence.upgrade_assigned_labor = available_building_labor(ctx, owner).min(1);
        residence.upgrade_priority = CONSTRUCTION_PRIORITY_NORMAL;
        ctx.db.residence().id().update(residence);
        return Ok(());
    }

    spend_aggregate_timber(ctx, owner, timber)?;
    spend_aggregate_stone(ctx, owner, stone)?;
    spend_treasury_gold(ctx, owner, civic_gold_due)?;

    ctx.db.residence().id().update(Residence {
        tier: next_tier,
        population_capacity: capacity,
        settlement_ticks: 0,
        ..residence
    });
    ensure_residence_needs(ctx, residence_id);
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
    if residence.tier < 3 {
        return Err("Only a prosperous tier-3 house can support a fired-tile roof.".to_string());
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

fn has_connected_services(
    ctx: &ReducerContext,
    residence: &Residence,
    required_services: &[ResidenceUpgradeService],
) -> bool {
    let Some(network) = crate::roads::load_owner_road_network(ctx, residence.owner) else {
        return false;
    };
    let buildings: Vec<_> = ctx
        .db
        .building()
        .owner()
        .filter(&residence.owner)
        .filter(|building| building_fire_state(ctx, building.id).is_none())
        .collect();
    let staffed_chapels: Vec<_> = buildings
        .iter()
        .filter(|building| {
            building.kind == "chapel"
                && building.construction_complete
                && building.assigned_labor > 0
        })
        .collect();
    let residence_has_parish = staffed_chapels.iter().any(|chapel| {
        network
            .road_path_distance(residence.x, residence.z, chapel.x, chapel.z)
            .is_some()
    });

    required_services.iter().all(|service| {
        buildings.iter().any(|building| {
            let Some(distance) =
                local_delivery_distance(&network, building.x, building.z, residence.x, residence.z)
            else {
                return false;
            };
            match service {
                ResidenceUpgradeService::Firewood => is_firewood_supplier_operational(
                    &building.kind,
                    building.construction_complete,
                    building.assigned_labor,
                    building.storehouse_accepts_firewood,
                ),
                ResidenceUpgradeService::Water => {
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
                ResidenceUpgradeService::PreservedFood => {
                    PRESERVED_FOOD_PRODUCER_KINDS.contains(&building.kind.as_str())
                        && is_specialty_supplier_operational(
                            &building.kind,
                            building.construction_complete,
                            building.assigned_labor,
                        )
                }
                ResidenceUpgradeService::Ale => {
                    ALE_PRODUCER_KINDS.contains(&building.kind.as_str())
                        && is_specialty_supplier_operational(
                            &building.kind,
                            building.construction_complete,
                            building.assigned_labor,
                        )
                        && (building.kind != "monastery"
                            || (residence_has_parish
                                && distance <= MONASTERY_COVERAGE_RADIUS
                                && staffed_chapels.iter().any(|chapel| {
                                    network
                                        .road_path_distance(
                                            building.x, building.z, chapel.x, chapel.z,
                                        )
                                        .is_some()
                                })))
                }
                ResidenceUpgradeService::Cloth => {
                    CLOTH_PRODUCER_KINDS.contains(&building.kind.as_str())
                        && is_specialty_supplier_operational(
                            &building.kind,
                            building.construction_complete,
                            building.assigned_labor,
                        )
                }
                ResidenceUpgradeService::Pottery => {
                    POTTERY_PRODUCER_KINDS.contains(&building.kind.as_str())
                        && is_specialty_supplier_operational(
                            &building.kind,
                            building.construction_complete,
                            building.assigned_labor,
                        )
                }
                ResidenceUpgradeService::Marketplace => {
                    building.kind == "marketplace" && building.construction_complete
                }
                ResidenceUpgradeService::GranaryStalls => {
                    building.kind == "granary"
                        && building.construction_complete
                        && building.assigned_labor > 0
                }
                ResidenceUpgradeService::StorehouseStalls => {
                    building.kind == "village_storehouse"
                        && building.construction_complete
                        && building.assigned_labor > 0
                }
            }
        })
    })
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
    let salvaged_roof_tiles = ((if residence.tiled_roof {
        RESIDENCE_TILE_ROOF_TILE_COST
    } else {
        0.0
    } + if recover_project_materials {
        residence.upgrade_delivered_roof_tiles
    } else {
        0.0
    }) * RESIDENCE_TILE_ROOF_SALVAGE_FRACTION)
        .round();
    let salvage = ResourceAmount {
        timber: ((refund.timber
            + if recover_project_materials {
                residence.upgrade_delivered_timber
            } else {
                0.0
            })
            * TIMBER_SALVAGE_FRACTION)
            .round(),
        stone: ((refund.stone
            + if recover_project_materials {
                residence.upgrade_delivered_stone
            } else {
                0.0
            })
            * STONE_SALVAGE_FRACTION)
            .round(),
        ironwork: 0.0,
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

    let residences: Vec<Residence> = ctx.db.residence().zone_id().filter(&zone_id).collect();
    let completed_intact_residence_count = residences
        .iter()
        .filter(|residence| {
            residence.tier >= 1 && residence_fire_state(ctx, residence.id).is_none()
        })
        .count() as u32;
    let refund = residence_zone_cost(completed_intact_residence_count);
    let upgrade_timber = residences
        .iter()
        .filter(|residence| {
            residence_fire_state(ctx, residence.id).is_none() || residence.fire_repair_active
        })
        .map(|residence| residence.upgrade_delivered_timber)
        .sum::<f64>();
    let upgrade_stone = residences
        .iter()
        .filter(|residence| {
            residence_fire_state(ctx, residence.id).is_none() || residence.fire_repair_active
        })
        .map(|residence| residence.upgrade_delivered_stone)
        .sum::<f64>();
    let salvaged_roof_tiles = residences
        .iter()
        .map(|residence| {
            let recover_project_materials =
                residence_fire_state(ctx, residence.id).is_none() || residence.fire_repair_active;
            (if residence.tiled_roof {
                RESIDENCE_TILE_ROOF_TILE_COST
            } else {
                0.0
            } + if recover_project_materials {
                residence.upgrade_delivered_roof_tiles
            } else {
                0.0
            }) * RESIDENCE_TILE_ROOF_SALVAGE_FRACTION
        })
        .sum::<f64>()
        .round();
    let salvage = ResourceAmount {
        timber: ((refund.timber + upgrade_timber) * TIMBER_SALVAGE_FRACTION).round(),
        stone: ((refund.stone + upgrade_stone) * STONE_SALVAGE_FRACTION).round(),
        ironwork: 0.0,
    };
    let base_salvage = if completed_intact_residence_count > 0 {
        ReclamationStock {
            timber: (refund.timber * TIMBER_SALVAGE_FRACTION).round()
                / completed_intact_residence_count as f64,
            stone: (refund.stone * STONE_SALVAGE_FRACTION).round()
                / completed_intact_residence_count as f64,
            ..ReclamationStock::default()
        }
    } else {
        ReclamationStock::default()
    };
    let mut physical_reclamation = false;
    for residence in &residences {
        let fire_damaged = residence_fire_state(ctx, residence.id).is_some();
        if fire_damaged && !residence.fire_repair_active {
            continue;
        }
        let completed_structure = if !fire_damaged && residence.tier >= 1 {
            base_salvage
        } else {
            ReclamationStock::default()
        };
        physical_reclamation |= insert_reclamation_pile(
            ctx,
            owner,
            residence.x,
            residence.z,
            ReclamationStock {
                timber: completed_structure.timber
                    + (residence.upgrade_delivered_timber * TIMBER_SALVAGE_FRACTION),
                stone: completed_structure.stone
                    + (residence.upgrade_delivered_stone * STONE_SALVAGE_FRACTION),
                roof_tiles: (if residence.tiled_roof {
                    RESIDENCE_TILE_ROOF_TILE_COST
                } else {
                    0.0
                } + residence.upgrade_delivered_roof_tiles)
                    * RESIDENCE_TILE_ROOF_SALVAGE_FRACTION,
                ..ReclamationStock::default()
            },
        )?;
    }
    if !physical_reclamation {
        credit_treasury_timber(ctx, owner, salvage.timber);
        credit_treasury_stone(ctx, owner, salvage.stone);
        credit_treasury_commodity(ctx, owner, CommodityKind::RoofTiles, salvaged_roof_tiles);
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
