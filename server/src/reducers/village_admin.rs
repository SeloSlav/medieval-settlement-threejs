use spacetimedb::{reducer, ReducerContext};

use crate::db::*;
use crate::economy::clamp_chapel_coffer_reserve_gold;
use crate::labor_steward_policy::is_valid_labor_steward_reserve;
use crate::lifecycle::ensure_player_resources;
use crate::monastery_estate_policy::{
    monastery_croft_choice_allowed, monastery_extension_cost, monastery_has_extension,
    monastery_orchard_replanting_allowed, normalize_monastery_croft_planting,
    normalize_monastery_extensions, normalize_monastery_orchard_planting,
    MONASTERY_ESTATE_GOLD_RESERVE, MONASTERY_ORCHARD_MATURITY_NEW, MONASTERY_ORCHARD_REPLANT_COST,
};
use crate::night_policy::valid_policy_code;
use crate::pantry_safeguard_policy::valid_pantry_safeguard_policy;
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
pub fn set_night_policies(
    ctx: &ReducerContext,
    watch_policy: u8,
    gathering_policy: u8,
    work_policy: u8,
    lighting_policy: u8,
    curfew_policy: u8,
) -> Result<(), String> {
    let owner = ctx.sender();
    ensure_player_resources(ctx, owner);
    require_owned_building(ctx, "town_hall", true)?;

    if ![
        watch_policy,
        gathering_policy,
        work_policy,
        lighting_policy,
        curfew_policy,
    ]
    .into_iter()
    .all(valid_policy_code)
    {
        return Err("Night policy choices must be between 0 and 2.".to_string());
    }

    let Some(mut resources) = ctx.db.player_resources().owner().find(&owner) else {
        return Err("Player resources not found.".to_string());
    };
    resources.night_watch_policy = watch_policy;
    resources.night_gathering_policy = gathering_policy;
    resources.night_work_policy = work_policy;
    resources.night_lighting_policy = lighting_policy;
    resources.night_curfew_policy = curfew_policy;
    ctx.db.player_resources().owner().update(resources);
    Ok(())
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
pub fn set_pantry_safeguard_policy(ctx: &ReducerContext, policy: u8) -> Result<(), String> {
    let owner = ctx.sender();
    ensure_player_resources(ctx, owner);
    require_owned_building(ctx, "town_hall", true)?;
    if !valid_pantry_safeguard_policy(policy) {
        return Err("Pantry safeguard policy must be between 0 and 2.".to_string());
    }

    let Some(mut resources) = ctx.db.player_resources().owner().find(&owner) else {
        return Err("Player resources not found.".to_string());
    };
    resources.pantry_safeguard_policy = policy;
    ctx.db.player_resources().owner().update(resources);
    Ok(())
}

/// Sets the three optional secular revenue policies. Church tithes are
/// intentionally excluded: chapel and monastery funds remain ecclesiastical.
#[reducer]
pub fn set_fiscal_policy(
    ctx: &ReducerContext,
    land_levy_rate: f64,
    import_duty_rate: f64,
    export_duty_rate: f64,
) -> Result<(), String> {
    let owner = ctx.sender();
    ensure_player_resources(ctx, owner);
    require_owned_building(ctx, "town_hall", true)?;
    if !land_levy_rate.is_finite() || !import_duty_rate.is_finite() || !export_duty_rate.is_finite()
    {
        return Err("Fiscal rates must be finite numbers.".to_string());
    }

    let Some(mut resources) = ctx.db.player_resources().owner().find(&owner) else {
        return Err("Player resources not found.".to_string());
    };
    resources.land_levy_rate = crate::fiscal_policy::clamp_land_levy_rate(land_levy_rate);
    resources.import_duty_rate = crate::fiscal_policy::clamp_import_duty_rate(import_duty_rate);
    resources.export_duty_rate = crate::fiscal_policy::clamp_export_duty_rate(export_duty_rate);
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

    // Compatibility arguments remain in the reducer schema for existing
    // clients, but parish money is no longer transferable to the lord's
    // treasury. The coffer now exists solely for parish and monastery work.
    let _ = auto_sweep_enabled;
    resources.chapel_auto_sweep_enabled = false;
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

/// Secular claims on an autonomous religious house are negotiated separately
/// from ordinary household duties. Changing the charter requires a staffed
/// Town Hall; collection still occurs only when the monastery earns coin.
#[reducer]
pub fn set_monastery_charter(ctx: &ReducerContext, levy_rate: f64) -> Result<(), String> {
    let owner = ctx.sender();
    ensure_player_resources(ctx, owner);
    require_owned_building(ctx, "town_hall", true)?;
    require_owned_building(ctx, "monastery", false)?;
    if !levy_rate.is_finite() {
        return Err("The monastic levy must be a finite rate.".to_string());
    }
    let Some(mut resources) = ctx.db.player_resources().owner().find(&owner) else {
        return Err("Player resources not found.".to_string());
    };
    resources.monastery_levy_rate = levy_rate.clamp(0.0, 0.25);
    ctx.db.player_resources().owner().update(resources);
    Ok(())
}

#[reducer]
pub fn set_monastery_planting(
    ctx: &ReducerContext,
    building_id: u64,
    orchard_planting: u8,
    croft_planting: u8,
) -> Result<(), String> {
    let owner = ctx.sender();
    let Some(mut monastery) = ctx.db.building().id().find(&building_id) else {
        return Err("Monastery not found.".to_string());
    };
    if monastery.owner != owner || monastery.kind != "monastery" || !monastery.construction_complete
    {
        return Err("Only a completed monastery may change its planting plan.".to_string());
    }
    let orchard_planting = normalize_monastery_orchard_planting(orchard_planting);
    let croft_planting = normalize_monastery_croft_planting(croft_planting);
    let clock = game_clock(
        ctx.db
            .world_config()
            .id()
            .find(&0)
            .map_or(0, |config| config.sim_tick),
    );

    if orchard_planting != monastery.monastery_orchard_planting {
        if !monastery_orchard_replanting_allowed(clock.month) {
            return Err(
                "Perennial rows may be replanted only from November through February.".to_string(),
            );
        }
        let private_gold = (monastery.gold - monastery.civic_receipts_gold.max(0.0)).max(0.0);
        if private_gold + 1e-9 < MONASTERY_ORCHARD_REPLANT_COST + MONASTERY_ESTATE_GOLD_RESERVE {
            return Err(format!(
                "The monastery needs {:.0} private gold plus its {:.0}-gold working reserve to replant the orchard.",
                MONASTERY_ORCHARD_REPLANT_COST,
                MONASTERY_ESTATE_GOLD_RESERVE,
            ));
        }
        monastery.gold = (monastery.gold - MONASTERY_ORCHARD_REPLANT_COST).max(0.0);
        monastery.private_export_proceeds_gold = monastery
            .private_export_proceeds_gold
            .min((monastery.gold - monastery.civic_receipts_gold.max(0.0)).max(0.0));
        monastery.monastery_orchard_planting = orchard_planting;
        monastery.monastery_orchard_planted_year = if clock.month >= 11 {
            clock.year.saturating_add(1)
        } else {
            clock.year
        };
        monastery.monastery_orchard_maturity = MONASTERY_ORCHARD_MATURITY_NEW;
    }

    if croft_planting != monastery.monastery_croft_planting {
        if !monastery_croft_choice_allowed(clock.month) {
            return Err(
                "The annual croft choice may be changed only before sowing in January or February."
                    .to_string(),
            );
        }
        if monastery.monastery_croft_choice_year == clock.year {
            return Err("The monastery has already committed its enclosed croft for this agricultural year.".to_string());
        }
        monastery.monastery_croft_planting = croft_planting;
        monastery.monastery_croft_choice_year = clock.year;
    }
    ctx.db.building().id().update(monastery);
    Ok(())
}

#[reducer]
pub fn set_monastery_next_extension(
    ctx: &ReducerContext,
    building_id: u64,
    extension: u8,
) -> Result<(), String> {
    let owner = ctx.sender();
    let Some(mut monastery) = ctx.db.building().id().find(&building_id) else {
        return Err("Monastery not found.".to_string());
    };
    if monastery.owner != owner || monastery.kind != "monastery" || !monastery.construction_complete
    {
        return Err("Only a completed monastery may reserve its next extension.".to_string());
    }
    let extension = normalize_monastery_extensions(extension);
    if monastery_extension_cost(extension).is_none() {
        return Err("Choose one valid monastery extension.".to_string());
    }
    if monastery_has_extension(monastery.monastery_extensions, extension) {
        return Err("That monastery extension is already complete.".to_string());
    }
    monastery.monastery_next_extension = extension;
    ctx.db.building().id().update(monastery);
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
