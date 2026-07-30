use spacetimedb::{reducer, ReducerContext, Table};

use crate::balance_generated::{backyard_garden_def_by_slug, BackyardGardenKind};
use crate::burgage::{backyard_center, measure_zone_depth, Point2, ZoneCorners};
use crate::construction_priority::CONSTRUCTION_PRIORITY_NORMAL;
use crate::db::*;
use crate::economy::{
    backyard_garden_cost, backyard_garden_salvage_refund, credit_treasury_stone,
    credit_treasury_timber, reconcile_building_labor, spend_aggregate_stone,
    spend_aggregate_timber, total_stone, total_timber, CommodityKind,
};
use crate::lifecycle::ensure_player_resources;
use crate::reducers::residences::ensure_upgrade_source_route;
use crate::residence_upgrade_policy::residence_project_active;
use crate::roads::load_owner_road_network;
use crate::simulation::{
    cancel_trips_for_residence, clear_residence_project, insert_reclamation_pile, ReclamationStock,
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

    if residence.abandoned {
        return Err("Cannot plant a backyard garden at an abandoned residence.".to_string());
    }
    if residence.tier == 0 {
        return Err("Finish the cottage before improving its backyard.".to_string());
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

    let cost = backyard_garden_cost(def.kind);

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

        residence.backyard_project_kind = def.kind as u8;
        residence.upgrade_progress = 0.0;
        residence.upgrade_required_timber = cost.timber;
        residence.upgrade_required_stone = cost.stone;
        residence.upgrade_required_gold = 0.0;
        residence.upgrade_delivered_timber = 0.0;
        residence.upgrade_delivered_stone = 0.0;
        residence.upgrade_delivered_gold = 0.0;
        residence.upgrade_reserved_timber = cost.timber;
        residence.upgrade_reserved_stone = cost.stone;
        residence.upgrade_reserved_gold = 0.0;
        residence.upgrade_assigned_labor = 0;
        residence.upgrade_priority = CONSTRUCTION_PRIORITY_NORMAL;
        ctx.db.residence().id().update(residence);
        return Ok(());
    }

    spend_aggregate_timber(ctx, owner, cost.timber)?;
    spend_aggregate_stone(ctx, owner, cost.stone)?;

    ctx.db.backyard_garden().insert(BackyardGarden {
        id: 0,
        residence_id,
        owner,
        kind: def.kind as u8,
    });

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
