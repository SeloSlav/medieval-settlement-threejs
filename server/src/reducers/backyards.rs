use spacetimedb::{reducer, ReducerContext, Table};

use crate::balance_generated::{backyard_garden_def_by_slug, BackyardGardenKind};
use crate::db::*;
use crate::economy::{
    backyard_garden_cost, backyard_garden_salvage_refund, credit_treasury_stone,
    credit_treasury_timber, spend_aggregate_stone, spend_aggregate_timber, total_stone,
    total_timber,
};
use crate::lifecycle::ensure_player_resources;
use crate::tables::BackyardGarden;

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
    credit_treasury_timber(ctx, owner, refund.timber);
    credit_treasury_stone(ctx, owner, refund.stone);

    ctx.db.backyard_garden().id().delete(garden.id);
    Ok(())
}
