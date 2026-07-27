use spacetimedb::{reducer, ReducerContext, Table};

use crate::balance_generated::{backyard_garden_def_by_slug, BackyardGardenKind};
use crate::burgage::{backyard_center, measure_zone_depth, Point2, ZoneCorners};
use crate::db::*;
use crate::economy::{
    backyard_garden_cost, backyard_garden_salvage_refund, credit_treasury_stone,
    credit_treasury_timber, spend_aggregate_stone, spend_aggregate_timber, total_stone,
    total_timber,
};
use crate::lifecycle::ensure_player_resources;
use crate::simulation::{insert_reclamation_pile, ReclamationStock};
use crate::tables::{BackyardGarden, Residence};

#[reducer]
pub fn place_backyard_garden(
    ctx: &ReducerContext,
    residence_id: u64,
    kind: String,
) -> Result<(), String> {
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
    let residence = ctx
        .db
        .residence()
        .id()
        .find(&residence_id)
        .ok_or_else(|| "Residence not found.".to_string())?;

    if residence.owner != owner {
        return Err("You do not own this residence.".to_string());
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
