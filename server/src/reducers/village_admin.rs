use spacetimedb::{reducer, ReducerContext};

use crate::db::*;
use crate::economy::clamp_chapel_coffer_reserve_gold;
use crate::lifecycle::ensure_player_resources;

#[reducer]
pub fn set_economic_activity_tax_rate(ctx: &ReducerContext, tax_rate: f64) -> Result<(), String> {
    let owner = ctx.sender();
    ensure_player_resources(ctx, owner);

    let clamped = crate::economy::clamp_economic_activity_tax_rate(tax_rate);
    let Some(mut resources) = ctx.db.player_resources().owner().find(&owner) else {
        return Err("Player resources not found.".to_string());
    };

    if (resources.economic_activity_tax_rate - clamped).abs() < 1e-9 {
        return Ok(());
    }

    resources.economic_activity_tax_rate = clamped;
    ctx.db.player_resources().owner().update(resources);
    Ok(())
}

#[reducer]
pub fn set_chapel_parish_policy(
    ctx: &ReducerContext,
    auto_sweep_enabled: bool,
    coffer_reserve_gold: f64,
) -> Result<(), String> {
    let owner = ctx.sender();
    ensure_player_resources(ctx, owner);

    let reserve = clamp_chapel_coffer_reserve_gold(coffer_reserve_gold);
    let Some(mut resources) = ctx.db.player_resources().owner().find(&owner) else {
        return Err("Player resources not found.".to_string());
    };

    resources.chapel_auto_sweep_enabled = auto_sweep_enabled;
    resources.chapel_coffer_reserve_gold = reserve;
    ctx.db.player_resources().owner().update(resources);
    Ok(())
}
