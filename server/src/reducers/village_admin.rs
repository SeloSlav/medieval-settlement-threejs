use spacetimedb::{reducer, ReducerContext};

use crate::db::*;
use crate::economy::clamp_chapel_coffer_reserve_gold;
use crate::labor_steward_policy::is_valid_labor_steward_reserve;
use crate::lifecycle::ensure_player_resources;
use crate::reducers::buildings::rotate_construction_labor_for_owner_with_reserve;
use crate::simulation::{
    game_clock, reconcile_seasonal_labor_for_owner, reconcile_target_production_labor_for_owner,
};

fn require_owned_building(ctx: &ReducerContext, kind: &str, staffed: bool) -> Result<(), String> {
    let owner = ctx.sender();
    let found = ctx.db.building().owner().filter(&owner).any(|building| {
        building.kind == kind
            && building.construction_complete
            && (!staffed || building.assigned_labor > 0)
    });
    if found {
        Ok(())
    } else if staffed {
        Err(format!(
            "A staffed {} is required to change this policy.",
            kind.replace('_', " ")
        ))
    } else {
        Err(format!(
            "Build a {} before changing this policy.",
            kind.replace('_', " ")
        ))
    }
}

#[reducer]
pub fn set_economic_activity_tax_rate(ctx: &ReducerContext, tax_rate: f64) -> Result<(), String> {
    let owner = ctx.sender();
    ensure_player_resources(ctx, owner);
    require_owned_building(ctx, "town_hall", true)?;

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
    sabbath_observance_enabled: bool,
) -> Result<(), String> {
    let owner = ctx.sender();
    ensure_player_resources(ctx, owner);
    require_owned_building(ctx, "chapel", false)?;

    let reserve = clamp_chapel_coffer_reserve_gold(coffer_reserve_gold);
    let Some(mut resources) = ctx.db.player_resources().owner().find(&owner) else {
        return Err("Player resources not found.".to_string());
    };

    resources.chapel_auto_sweep_enabled = auto_sweep_enabled;
    resources.chapel_coffer_reserve_gold = reserve;
    resources.sabbath_observance_enabled = sabbath_observance_enabled;
    ctx.db.player_resources().owner().update(resources);
    Ok(())
}

#[reducer]
pub fn set_monastery_policy(
    ctx: &ReducerContext,
    tithe_share: f64,
    feasts_enabled: bool,
) -> Result<(), String> {
    let owner = ctx.sender();
    ensure_player_resources(ctx, owner);
    require_owned_building(ctx, "monastery", false)?;
    let Some(mut resources) = ctx.db.player_resources().owner().find(&owner) else {
        return Err("Player resources not found.".to_string());
    };
    resources.monastery_tithe_share = tithe_share.clamp(0.0, 0.8);
    resources.monastery_feasts_enabled = feasts_enabled;
    ctx.db.player_resources().owner().update(resources);
    Ok(())
}

#[reducer]
pub fn set_seasonal_labor_steward(ctx: &ReducerContext, enabled: bool) -> Result<(), String> {
    let owner = ctx.sender();
    ensure_player_resources(ctx, owner);
    require_owned_building(ctx, "town_hall", true)?;
    let Some(mut resources) = ctx.db.player_resources().owner().find(&owner) else {
        return Err("Player resources not found.".to_string());
    };
    if resources.seasonal_labor_steward_enabled == enabled {
        return Ok(());
    }
    resources.seasonal_labor_steward_enabled = enabled;
    let labor_reserve = resources.labor_steward_reserve;
    ctx.db.player_resources().owner().update(resources);

    // Enabling is immediately useful; later reviews occur once per calendar
    // day while a Town Hall clerk remains assigned.
    if enabled {
        let sim_tick = ctx
            .db
            .world_config()
            .id()
            .find(&0)
            .map(|config| config.sim_tick)
            .unwrap_or(0);
        reconcile_seasonal_labor_for_owner(ctx, owner, game_clock(sim_tick).month, labor_reserve);
    }
    Ok(())
}

#[reducer]
pub fn set_construction_labor_steward(ctx: &ReducerContext, enabled: bool) -> Result<(), String> {
    let owner = ctx.sender();
    ensure_player_resources(ctx, owner);
    require_owned_building(ctx, "town_hall", true)?;
    let Some(mut resources) = ctx.db.player_resources().owner().find(&owner) else {
        return Err("Player resources not found.".to_string());
    };
    if resources.construction_labor_steward_enabled == enabled {
        return Ok(());
    }
    resources.construction_labor_steward_enabled = enabled;
    let labor_reserve = resources.labor_steward_reserve;
    ctx.db.player_resources().owner().update(resources);

    // Opting in is immediately useful; later reviews occur once per calendar
    // day while a Town Hall clerk remains assigned.
    if enabled {
        rotate_construction_labor_for_owner_with_reserve(ctx, owner, labor_reserve);
    }
    Ok(())
}

#[reducer]
pub fn set_production_labor_steward(ctx: &ReducerContext, enabled: bool) -> Result<(), String> {
    let owner = ctx.sender();
    ensure_player_resources(ctx, owner);
    require_owned_building(ctx, "town_hall", true)?;
    let Some(mut resources) = ctx.db.player_resources().owner().find(&owner) else {
        return Err("Player resources not found.".to_string());
    };
    if resources.production_labor_steward_enabled == enabled {
        return Ok(());
    }
    resources.production_labor_steward_enabled = enabled;
    let labor_reserve = resources.labor_steward_reserve;
    ctx.db.player_resources().owner().update(resources);

    // Enabling immediately applies the conservative recall-then-deploy order;
    // unlike the manual call-up, automation will not pre-staff an empty chain.
    if enabled {
        reconcile_target_production_labor_for_owner(ctx, owner, labor_reserve);
    }
    Ok(())
}

#[reducer]
pub fn set_labor_steward_reserve(ctx: &ReducerContext, labor_reserve: u32) -> Result<(), String> {
    let owner = ctx.sender();
    ensure_player_resources(ctx, owner);
    require_owned_building(ctx, "town_hall", true)?;
    if !is_valid_labor_steward_reserve(labor_reserve) {
        return Err("Labor reserve must be 0, 1, 2, 4, or 6 villagers.".to_string());
    }
    let Some(mut resources) = ctx.db.player_resources().owner().find(&owner) else {
        return Err("Player resources not found.".to_string());
    };
    if resources.labor_steward_reserve == labor_reserve {
        return Ok(());
    }
    resources.labor_steward_reserve = labor_reserve;
    ctx.db.player_resources().owner().update(resources);
    Ok(())
}
