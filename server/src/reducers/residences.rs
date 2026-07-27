use spacetimedb::{reducer, ReducerContext, Table};

use crate::balance_generated::{
    MONASTERY_COVERAGE_RADIUS, RESIDENCE_TIER2_CAPACITY, RESIDENCE_TIER2_GOLD_COST,
    RESIDENCE_TIER2_STONE_COST, RESIDENCE_TIER2_TIMBER_COST, RESIDENCE_TIER3_CAPACITY,
    RESIDENCE_TIER3_GOLD_COST, RESIDENCE_TIER3_STONE_COST, RESIDENCE_TIER3_TIMBER_COST,
};
use crate::burgage::{
    compute_burgage_layout, convex_zones_overlap, max_zone_depth, measure_zone_depth,
    min_zone_depth, zone_corners_polygon, ZoneCorners,
};
use crate::db::*;
use crate::economy::{
    credit_treasury_stone, credit_treasury_timber, reconcile_building_labor,
    residence_population_for_parcel, residence_zone_cost, spend_aggregate_stone,
    spend_aggregate_timber, spend_treasury_gold, total_stone, total_timber, treasury_gold,
    ResourceAmount, STONE_SALVAGE_FRACTION, TIMBER_SALVAGE_FRACTION,
};
use crate::lifecycle::ensure_player_resources;
use crate::placement_validation::{
    burgage_zone_has_road_frontage, burgage_zone_overlaps_buildings, is_on_quarry_pit,
};
use crate::simulation::{
    building_fire_state, cancel_trips_for_residence, clear_backyard_garden_for_residence,
    clear_fire_for_target, clear_residence_needs, ensure_residence_needs, residence_fire_state,
    FIRE_TARGET_RESIDENCE,
};
use crate::supply_policy::{
    is_firewood_supplier_operational, is_specialty_supplier_operational,
    is_well_supplier_operational, ALE_SUPPLIER_KINDS, CLOTH_SUPPLIER_KINDS,
    PRESERVED_FOOD_SUPPLIER_KINDS,
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
    for corner in candidate_polygon {
        if is_on_quarry_pit(ctx, corner.x, corner.z) {
            return Err("Cannot place residences on a quarry pit.".to_string());
        }
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
    if zone_depth > max_zone_depth() + 0.05 {
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
    spend_aggregate_timber(ctx, owner, cost.timber)?;
    spend_aggregate_stone(ctx, owner, cost.stone)?;

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
            tier: 1,
            settlement_ticks: 0,
            abandoned: false,
            household_wealth: 0.0,
            last_household_market_tick: 0,
        });
        ensure_residence_needs(ctx, inserted.id);
    }

    Ok(())
}

#[reducer]
pub fn upgrade_residence(ctx: &ReducerContext, residence_id: u64) -> Result<(), String> {
    let owner = ctx.sender();
    ensure_player_resources(ctx, owner);
    let residence = ctx
        .db
        .residence()
        .id()
        .find(&residence_id)
        .ok_or_else(|| "Residence not found.".to_string())?;
    if residence.owner != owner {
        return Err("You do not own this residence.".to_string());
    }
    if residence.abandoned || residence.population == 0 {
        return Err("Only an occupied residence can be upgraded.".to_string());
    }
    if residence_fire_state(ctx, residence.id).is_some() {
        return Err("Repair the fire-damaged residence before upgrading it.".to_string());
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
            ],
        ),
        _ => return Err("This residence is already at tier 3.".to_string()),
    };

    if !has_connected_services(ctx, &residence, required_services) {
        return Err(if next_tier == 2 {
            "Tier 2 requires staffed road-linked firewood distribution (a lodge or accepting storehouse) and a staffed well.".to_string()
        } else {
            "Tier 3 requires staffed road-linked preserved-food, ale, and cloth suppliers (a linked monastery can supply ale).".to_string()
        });
    }
    let available_gold = treasury_gold(ctx, owner);
    if total_timber(ctx, owner) + 1e-6 < timber
        || total_stone(ctx, owner) + 1e-6 < stone
        || available_gold + 1e-6 < gold
    {
        return Err(format!(
            "Upgrade requires {} timber, {} stone, and {} gold.",
            timber.round() as i64,
            stone.round() as i64,
            gold.round() as i64,
        ));
    }
    spend_aggregate_timber(ctx, owner, timber)?;
    spend_aggregate_stone(ctx, owner, stone)?;
    spend_treasury_gold(ctx, owner, gold)?;

    ctx.db.residence().id().update(Residence {
        tier: next_tier,
        population_capacity: capacity,
        settlement_ticks: 0,
        ..residence
    });
    ensure_residence_needs(ctx, residence_id);
    Ok(())
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
                network.road_path_distance(building.x, building.z, residence.x, residence.z)
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
                    PRESERVED_FOOD_SUPPLIER_KINDS.contains(&building.kind.as_str())
                        && is_specialty_supplier_operational(
                            &building.kind,
                            building.construction_complete,
                            building.assigned_labor,
                        )
                }
                ResidenceUpgradeService::Ale => {
                    ALE_SUPPLIER_KINDS.contains(&building.kind.as_str())
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
                    CLOTH_SUPPLIER_KINDS.contains(&building.kind.as_str())
                        && is_specialty_supplier_operational(
                            &building.kind,
                            building.construction_complete,
                            building.assigned_labor,
                        )
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
    let refund = residence_zone_cost(if residence_fire_state(ctx, residence_id).is_some() {
        0
    } else {
        1
    });
    let salvage = ResourceAmount {
        timber: (refund.timber * TIMBER_SALVAGE_FRACTION).round(),
        stone: (refund.stone * STONE_SALVAGE_FRACTION).round(),
    };
    credit_treasury_timber(ctx, owner, salvage.timber);
    credit_treasury_stone(ctx, owner, salvage.stone);

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

    let intact_residence_count = ctx
        .db
        .residence()
        .zone_id()
        .filter(&zone_id)
        .filter(|residence| residence_fire_state(ctx, residence.id).is_none())
        .count() as u32;
    let refund = residence_zone_cost(intact_residence_count);
    let salvage = ResourceAmount {
        timber: (refund.timber * TIMBER_SALVAGE_FRACTION).round(),
        stone: (refund.stone * STONE_SALVAGE_FRACTION).round(),
    };
    credit_treasury_timber(ctx, owner, salvage.timber);
    credit_treasury_stone(ctx, owner, salvage.stone);

    for residence in ctx.db.residence().zone_id().filter(&zone_id) {
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
