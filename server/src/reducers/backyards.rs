use spacetimedb::{reducer, ReducerContext, Table};

use crate::balance_generated::{backyard_garden_def_by_slug, BackyardGardenKind};
use crate::burgage::{
    backyard_center, measure_zone_depth, min_backyard_extension_depth, residence_backyard_depth,
    Point2, ZoneCorners,
};
use crate::construction_priority::CONSTRUCTION_PRIORITY_NORMAL;
use crate::db::*;
use crate::economy::{
    available_building_labor, backyard_garden_cost, backyard_garden_salvage_refund,
    credit_settlement_household_income, credit_treasury_stone, credit_treasury_timber,
    reconcile_building_labor, spend_aggregate_stone, spend_aggregate_timber, spend_treasury_gold,
    total_stone, total_timber, treasury_gold, CommodityKind,
};
use crate::lifecycle::ensure_player_resources;
use crate::reducers::residences::ensure_upgrade_source_route;
use crate::residence_upgrade_policy::{
    residence_project_active, residence_upgrade_household_contribution,
};
use crate::roads::load_owner_road_network;
use crate::simulation::{
    cancel_trips_for_residence, clear_residence_project, game_clock, insert_reclamation_pile,
    ReclamationStock,
};
use crate::tables::{BackyardGarden, Residence};

#[reducer]
pub fn place_backyard_garden(
    ctx: &ReducerContext,
    residence_id: u64,
    kind: String,
) -> Result<(), String> {
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

    if residence.tier == 0 {
        return Err("Finish the cottage before improving its backyard.".to_string());
    }
    let zone = ctx
        .db
        .burgage_zone()
        .id()
        .find(&residence.zone_id)
        .ok_or_else(|| "Residence plot not found.".to_string())?;
    let corners = ZoneCorners {
        a: Point2 {
            x: zone.corner_ax,
            z: zone.corner_az,
        },
        b: Point2 {
            x: zone.corner_bx,
            z: zone.corner_bz,
        },
        c: Point2 {
            x: zone.corner_cx,
            z: zone.corner_cz,
        },
        d: Point2 {
            x: zone.corner_dx,
            z: zone.corner_dz,
        },
    };
    let backyard_depth = residence_backyard_depth(
        &corners,
        zone.frontage_edge,
        zone.plot_count,
        residence.parcel_index,
    )
    .unwrap_or(0.0);
    if backyard_depth + 1e-6 < min_backyard_extension_depth() {
        return Err("This plot is not deep enough for a backyard attachment.".to_string());
    }

    if ctx
        .db
        .backyard_garden()
        .residence_id()
        .filter(&residence_id)
        .next()
        .is_some()
    {
        return Err("This backyard already has a garden.".to_string());
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
    let (backyard_x, backyard_z) = backyard_reclamation_position(ctx, &residence);
    if ctx.db.building().owner().filter(&owner).any(|building| {
        building.kind == "salvage_pile"
            && (building.x - backyard_x).powi(2) + (building.z - backyard_z).powi(2) <= 9.0
    }) {
        return Err(
            "Clear the reclaimed materials from this backyard before rebuilding.".to_string(),
        );
    }

    let def = backyard_garden_def_by_slug(kind.trim())
        .ok_or_else(|| format!("Unknown backyard garden kind: {kind}"))?;
    if def.specialization_of.is_some() {
        return Err(
            "Construct the matching backyard shell first, then choose its specialization after the worksite is complete."
                .to_string(),
        );
    }

    let cost = backyard_garden_cost(def.kind);
    let gold_cost = def.cost_gold;

    if total_timber(ctx, owner) + 1e-6 < cost.timber {
        return Err("Not enough timber for this garden.".to_string());
    }
    if total_stone(ctx, owner) + 1e-6 < cost.stone {
        return Err("Not enough stone for this garden.".to_string());
    }

    let physical_economy = ctx
        .db
        .player_resources()
        .owner()
        .find(&owner)
        .is_some_and(|resources| resources.physical_founding_site_enabled);
    let household_contribution = if physical_economy {
        residence_upgrade_household_contribution(residence.household_wealth, gold_cost)
    } else {
        0.0
    };
    let civic_gold_due = (gold_cost - household_contribution).max(0.0);
    if treasury_gold(ctx, owner) + 1e-6 < civic_gold_due {
        return Err(format!(
            "Needs {} more treasury gold.",
            (civic_gold_due - treasury_gold(ctx, owner)).ceil() as i64,
        ));
    }
    if physical_economy {
        let network = load_owner_road_network(ctx, owner)
            .ok_or_else(|| "Backyard works require a road-linked material source.".to_string())?;
        ensure_upgrade_source_route(
            ctx,
            &network,
            &residence,
            CommodityKind::Timber,
            cost.timber,
        )?;
        ensure_upgrade_source_route(ctx, &network, &residence, CommodityKind::Stone, cost.stone)?;
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
        residence.backyard_project_kind = def.kind as u8;
        residence.upgrade_progress = 0.0;
        residence.upgrade_required_timber = cost.timber;
        residence.upgrade_required_stone = cost.stone;
        residence.upgrade_required_gold = gold_cost;
        residence.upgrade_delivered_timber = 0.0;
        residence.upgrade_delivered_stone = 0.0;
        residence.upgrade_delivered_gold = household_contribution;
        residence.upgrade_reserved_timber = cost.timber;
        residence.upgrade_reserved_stone = cost.stone;
        residence.upgrade_reserved_gold = civic_gold_due;
        residence.upgrade_assigned_labor = available_building_labor(ctx, owner).min(1);
        residence.upgrade_priority = CONSTRUCTION_PRIORITY_NORMAL;
        ctx.db.residence().id().update(residence);
        return Ok(());
    }

    spend_aggregate_timber(ctx, owner, cost.timber)?;
    spend_aggregate_stone(ctx, owner, cost.stone)?;
    spend_treasury_gold(ctx, owner, civic_gold_due)?;
    credit_settlement_household_income(ctx, owner, gold_cost);

    ctx.db.backyard_garden().insert(BackyardGarden {
        id: 0,
        residence_id,
        owner,
        kind: def.kind as u8,
        first_harvest_day: 0,
        last_primary_production_day: 0,
        last_secondary_production_day: 0,
        hide_stock: 0.0,
        flower_luxury_upgraded: false,
    });

    Ok(())
}

#[reducer]
pub fn specialize_orchard(
    ctx: &ReducerContext,
    residence_id: u64,
    kind: String,
) -> Result<(), String> {
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
    let mut garden = ctx
        .db
        .backyard_garden()
        .residence_id()
        .filter(&residence_id)
        .next()
        .ok_or_else(|| "Construct an orchard before choosing what to plant.".to_string())?;
    if garden.owner != owner
        || BackyardGardenKind::from_id(garden.kind) != Some(BackyardGardenKind::Orchard)
    {
        return Err("Only a completed, unplanted orchard can be specialized.".to_string());
    }
    let def = backyard_garden_def_by_slug(kind.trim())
        .filter(|candidate| candidate.specialization_of == Some("orchard"))
        .ok_or_else(|| "That is not an orchard planting option.".to_string())?;
    let orchard = crate::balance_generated::backyard_garden_def(BackyardGardenKind::Orchard);
    let planting_gold = (def.cost_gold - orchard.cost_gold).max(0.0);
    let household_contribution =
        residence_upgrade_household_contribution(residence.household_wealth, planting_gold);
    let civic_gold_due = (planting_gold - household_contribution).max(0.0);
    if treasury_gold(ctx, owner) + 1e-6 < civic_gold_due {
        return Err(format!(
            "Needs {} more treasury gold for saplings and planting stock.",
            (civic_gold_due - treasury_gold(ctx, owner)).ceil() as i64,
        ));
    }
    residence.household_wealth = (residence.household_wealth - household_contribution).max(0.0);
    spend_treasury_gold(ctx, owner, civic_gold_due)?;
    credit_settlement_household_income(ctx, owner, planting_gold);

    let total_days = ctx
        .db
        .world_config()
        .id()
        .find(&0)
        .map(|config| game_clock(config.sim_tick).total_days)
        .unwrap_or(0);
    garden.kind = def.kind as u8;
    garden.first_harvest_day = total_days.saturating_add(def.first_harvest_days);
    garden.last_primary_production_day = total_days;
    garden.last_secondary_production_day = total_days;
    garden.hide_stock = 0.0;
    garden.flower_luxury_upgraded = false;
    ctx.db.backyard_garden().id().update(garden);
    ctx.db.residence().id().update(residence);
    Ok(())
}

#[reducer]
pub fn specialize_vegetable_garden(
    ctx: &ReducerContext,
    residence_id: u64,
    kind: String,
) -> Result<(), String> {
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
    let mut garden = ctx
        .db
        .backyard_garden()
        .residence_id()
        .filter(&residence_id)
        .next()
        .ok_or_else(|| "Construct a vegetable garden before purchasing seed.".to_string())?;
    if garden.owner != owner
        || BackyardGardenKind::from_id(garden.kind) != Some(BackyardGardenKind::VegetableGarden)
    {
        return Err("Only a completed, unplanted vegetable garden can be sown.".to_string());
    }
    let def = backyard_garden_def_by_slug(kind.trim())
        .filter(|candidate| candidate.specialization_of == Some("vegetable_garden"))
        .ok_or_else(|| "That seed cannot be planted in this vegetable garden.".to_string())?;
    let shell =
        crate::balance_generated::backyard_garden_def(BackyardGardenKind::VegetableGarden);
    let seed_gold = (def.cost_gold - shell.cost_gold).max(0.0);
    let household_contribution =
        residence_upgrade_household_contribution(residence.household_wealth, seed_gold);
    let civic_gold_due = (seed_gold - household_contribution).max(0.0);
    if treasury_gold(ctx, owner) + 1e-6 < civic_gold_due {
        return Err(format!(
            "Needs {} more treasury gold for seed and planting stock.",
            (civic_gold_due - treasury_gold(ctx, owner)).ceil() as i64,
        ));
    }
    residence.household_wealth = (residence.household_wealth - household_contribution).max(0.0);
    spend_treasury_gold(ctx, owner, civic_gold_due)?;
    credit_settlement_household_income(ctx, owner, seed_gold);

    let total_days = ctx
        .db
        .world_config()
        .id()
        .find(&0)
        .map(|config| game_clock(config.sim_tick).total_days)
        .unwrap_or(0);
    garden.kind = def.kind as u8;
    garden.first_harvest_day = total_days.saturating_add(def.first_harvest_days);
    garden.last_primary_production_day = total_days;
    garden.last_secondary_production_day = total_days;
    garden.hide_stock = 0.0;
    garden.flower_luxury_upgraded = false;
    ctx.db.backyard_garden().id().update(garden);
    ctx.db.residence().id().update(residence);
    Ok(())
}

#[reducer]
pub fn specialize_animal_pen(
    ctx: &ReducerContext,
    residence_id: u64,
    kind: String,
) -> Result<(), String> {
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
    let mut garden = ctx
        .db
        .backyard_garden()
        .residence_id()
        .filter(&residence_id)
        .next()
        .ok_or_else(|| "Construct an animal pen before choosing livestock.".to_string())?;
    if garden.owner != owner
        || BackyardGardenKind::from_id(garden.kind) != Some(BackyardGardenKind::AnimalPen)
    {
        return Err("Only a completed, unstocked animal pen can house livestock.".to_string());
    }
    let def = backyard_garden_def_by_slug(kind.trim())
        .filter(|candidate| candidate.specialization_of == Some("animal_pen"))
        .ok_or_else(|| "That livestock cannot be housed in this pen.".to_string())?;
    let shell =
        crate::balance_generated::backyard_garden_def(BackyardGardenKind::AnimalPen);
    let stocking_gold = (def.cost_gold - shell.cost_gold).max(0.0);
    let household_contribution =
        residence_upgrade_household_contribution(residence.household_wealth, stocking_gold);
    let civic_gold_due = (stocking_gold - household_contribution).max(0.0);
    if treasury_gold(ctx, owner) + 1e-6 < civic_gold_due {
        return Err(format!(
            "Needs {} more treasury gold for breeding stock and husbandry equipment.",
            (civic_gold_due - treasury_gold(ctx, owner)).ceil() as i64,
        ));
    }
    residence.household_wealth = (residence.household_wealth - household_contribution).max(0.0);
    spend_treasury_gold(ctx, owner, civic_gold_due)?;
    credit_settlement_household_income(ctx, owner, stocking_gold);

    let total_days = ctx
        .db
        .world_config()
        .id()
        .find(&0)
        .map(|config| game_clock(config.sim_tick).total_days)
        .unwrap_or(0);
    garden.kind = def.kind as u8;
    garden.first_harvest_day = total_days.saturating_add(def.first_harvest_days);
    garden.last_primary_production_day = total_days;
    garden.last_secondary_production_day = total_days;
    garden.hide_stock = 0.0;
    garden.flower_luxury_upgraded = false;
    ctx.db.backyard_garden().id().update(garden);
    ctx.db.residence().id().update(residence);
    Ok(())
}

#[reducer]
pub fn upgrade_flower_garden_luxury(ctx: &ReducerContext, residence_id: u64) -> Result<(), String> {
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
        return Err(
            "Only a tier-3 or tier-4 household can cultivate luxury cut flowers.".to_string(),
        );
    }
    let mut garden = ctx
        .db
        .backyard_garden()
        .residence_id()
        .filter(&residence_id)
        .next()
        .ok_or_else(|| "This backyard has no flower garden.".to_string())?;
    if BackyardGardenKind::from_id(garden.kind) != Some(BackyardGardenKind::FlowerGarden) {
        return Err("This backyard is not a flower garden.".to_string());
    }
    if garden.flower_luxury_upgraded {
        return Err("This flower garden already supplies luxury bouquets.".to_string());
    }
    let cost = crate::balance_generated::backyard_garden_def(BackyardGardenKind::FlowerGarden)
        .luxury_upgrade_gold_cost;
    let household_contribution =
        residence_upgrade_household_contribution(residence.household_wealth, cost);
    let civic_gold_due = (cost - household_contribution).max(0.0);
    if treasury_gold(ctx, owner) + 1e-6 < civic_gold_due {
        return Err(format!(
            "Needs {} more treasury gold for luxury bulbs and cutting tools.",
            (civic_gold_due - treasury_gold(ctx, owner)).ceil() as i64,
        ));
    }
    residence.household_wealth = (residence.household_wealth - household_contribution).max(0.0);
    spend_treasury_gold(ctx, owner, civic_gold_due)?;
    credit_settlement_household_income(ctx, owner, cost);
    garden.flower_luxury_upgraded = true;
    ctx.db.backyard_garden().id().update(garden);
    ctx.db.residence().id().update(residence);
    Ok(())
}

#[reducer]
pub fn demolish_backyard_garden(ctx: &ReducerContext, residence_id: u64) -> Result<(), String> {
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

    if residence.backyard_project_kind != 0 {
        credit_settlement_household_income(ctx, owner, residence.upgrade_delivered_gold.max(0.0));
        let refund = ReclamationStock {
            timber: (residence.upgrade_delivered_timber
                * crate::balance_generated::TIMBER_SALVAGE_FRACTION)
                .round(),
            stone: (residence.upgrade_delivered_stone
                * crate::balance_generated::STONE_SALVAGE_FRACTION)
                .round(),
            ..ReclamationStock::default()
        };
        let (x, z) = backyard_reclamation_position(ctx, &residence);
        if !insert_reclamation_pile(ctx, owner, x, z, refund)? {
            credit_treasury_timber(ctx, owner, refund.timber);
            credit_treasury_stone(ctx, owner, refund.stone);
        }
        cancel_trips_for_residence(ctx, residence.id);
        clear_residence_project(&mut residence);
        ctx.db.residence().id().update(residence);
        reconcile_building_labor(ctx, owner);
        return Ok(());
    }

    let garden = ctx
        .db
        .backyard_garden()
        .residence_id()
        .filter(&residence_id)
        .next()
        .ok_or_else(|| "This backyard has no garden.".to_string())?;

    let Some(kind) = BackyardGardenKind::from_id(garden.kind) else {
        ctx.db.backyard_garden().id().delete(garden.id);
        return Ok(());
    };

    let refund = backyard_garden_salvage_refund(kind);
    let (x, z) = backyard_reclamation_position(ctx, &residence);
    if !insert_reclamation_pile(
        ctx,
        owner,
        x,
        z,
        ReclamationStock {
            timber: refund.timber,
            stone: refund.stone,
            ..ReclamationStock::default()
        },
    )? {
        credit_treasury_timber(ctx, owner, refund.timber);
        credit_treasury_stone(ctx, owner, refund.stone);
    }

    ctx.db.backyard_garden().id().delete(garden.id);
    Ok(())
}

fn backyard_reclamation_position(ctx: &ReducerContext, residence: &Residence) -> (f64, f64) {
    let Some(zone) = ctx.db.burgage_zone().id().find(&residence.zone_id) else {
        return (residence.x, residence.z);
    };
    let corners = ZoneCorners {
        a: Point2 {
            x: zone.corner_ax,
            z: zone.corner_az,
        },
        b: Point2 {
            x: zone.corner_bx,
            z: zone.corner_bz,
        },
        c: Point2 {
            x: zone.corner_cx,
            z: zone.corner_cz,
        },
        d: Point2 {
            x: zone.corner_dx,
            z: zone.corner_dz,
        },
    };
    let point = backyard_center(
        residence.x,
        residence.z,
        residence.yaw,
        measure_zone_depth(&corners, zone.frontage_edge),
    );
    (point.x, point.z)
}
