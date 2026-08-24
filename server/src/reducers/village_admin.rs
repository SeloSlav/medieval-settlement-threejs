use spacetimedb::{reducer, ReducerContext};

use crate::db::*;
use crate::economy::clamp_chapel_coffer_reserve_gold;
use crate::fiscal_policy::{is_valid_monastery_levy_rate, normalize_monastery_levy_rate};
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
use crate::reducers::buildings::rotate_construction_labor_for_settlement_with_reserve;
use crate::resource_units::{whole_cost, whole_units};
use crate::simulation::{
    game_clock, reconcile_seasonal_labor_for_settlement,
    reconcile_target_production_labor_for_settlement,
};
use crate::tables::Settlement;

#[derive(Clone, Copy, Debug, PartialEq)]
struct MonasteryPrivateGoldPayment {
    gold: f64,
    civic_receipts_gold: f64,
    private_export_proceeds_gold: f64,
}

fn plan_monastery_private_gold_payment(
    gold: f64,
    civic_receipts_gold: f64,
    private_export_proceeds_gold: f64,
    authored_cost: f64,
    authored_reserve: f64,
) -> Option<MonasteryPrivateGoldPayment> {
    let gold = whole_units(gold);
    let civic_receipts_gold = whole_units(civic_receipts_gold).min(gold);
    let private_gold = gold - civic_receipts_gold;
    let cost = whole_cost(authored_cost);
    let reserve = whole_cost(authored_reserve);
    if private_gold + 1e-9 < cost + reserve {
        return None;
    }
    let gold = gold - cost;
    let private_gold = gold - civic_receipts_gold;
    Some(MonasteryPrivateGoldPayment {
        gold,
        civic_receipts_gold,
        private_export_proceeds_gold: whole_units(private_export_proceeds_gold).min(private_gold),
    })
}

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

/// Resolves the exact civic jurisdiction being edited. A realm may contain
/// several Town Halls, so accepting any staffed Hall owned by the sender would
/// let the inspector for one town silently rewrite every town's policy.
fn require_owned_town_hall(
    ctx: &ReducerContext,
    town_hall_id: u64,
    staffed: bool,
) -> Result<Settlement, String> {
    let owner = ctx.sender();
    let hall = ctx
        .db
        .building()
        .id()
        .find(&town_hall_id)
        .ok_or_else(|| "Town Hall not found.".to_string())?;
    if hall.owner != owner || hall.kind != "town_hall" || !hall.construction_complete {
        return Err("You do not own this completed Town Hall.".to_string());
    }
    if staffed && hall.assigned_labor == 0 {
        return Err("A staffed Town Hall is required to change this policy.".to_string());
    }
    if hall.settlement_id == 0 {
        return Err("This Town Hall is not attached to a settlement.".to_string());
    }
    let settlement = ctx
        .db
        .settlement()
        .id()
        .find(&hall.settlement_id)
        .ok_or_else(|| "Town Hall settlement not found.".to_string())?;
    if settlement.owner != owner || settlement.town_hall_id != hall.id {
        return Err("This building is not the active Town Hall for its settlement.".to_string());
    }
    Ok(settlement)
}

#[reducer]
pub fn set_night_policies(
    ctx: &ReducerContext,
    town_hall_id: u64,
    watch_policy: u8,
    gathering_policy: u8,
    work_policy: u8,
    lighting_policy: u8,
    curfew_policy: u8,
) -> Result<(), String> {
    let owner = ctx.sender();
    ensure_player_resources(ctx, owner);
    let mut settlement = require_owned_town_hall(ctx, town_hall_id, true)?;

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

    settlement.night_watch_policy = watch_policy;
    settlement.night_gathering_policy = gathering_policy;
    settlement.night_work_policy = work_policy;
    settlement.night_lighting_policy = lighting_policy;
    settlement.night_curfew_policy = curfew_policy;
    ctx.db.settlement().id().update(settlement);
    Ok(())
}

#[reducer]
pub fn set_economic_activity_tax_rate(
    ctx: &ReducerContext,
    town_hall_id: u64,
    tax_rate: f64,
) -> Result<(), String> {
    let owner = ctx.sender();
    ensure_player_resources(ctx, owner);
    let mut settlement = require_owned_town_hall(ctx, town_hall_id, true)?;

    let clamped = crate::economy::clamp_economic_activity_tax_rate(tax_rate);
    if (settlement.economic_activity_tax_rate - clamped).abs() < 1e-9 {
        return Ok(());
    }
    settlement.economic_activity_tax_rate = clamped;
    ctx.db.settlement().id().update(settlement);
    Ok(())
}

#[reducer]
pub fn set_pantry_safeguard_policy(
    ctx: &ReducerContext,
    town_hall_id: u64,
    policy: u8,
) -> Result<(), String> {
    let owner = ctx.sender();
    ensure_player_resources(ctx, owner);
    let mut settlement = require_owned_town_hall(ctx, town_hall_id, true)?;
    if !valid_pantry_safeguard_policy(policy) {
        return Err("Pantry safeguard policy must be between 0 and 2.".to_string());
    }

    settlement.pantry_safeguard_policy = policy;
    ctx.db.settlement().id().update(settlement);
    Ok(())
}

/// Sets the three optional secular revenue policies. Church tithes are
/// intentionally excluded: chapel and monastery funds remain ecclesiastical.
#[reducer]
pub fn set_fiscal_policy(
    ctx: &ReducerContext,
    town_hall_id: u64,
    land_levy_rate: f64,
    import_duty_rate: f64,
    export_duty_rate: f64,
) -> Result<(), String> {
    let owner = ctx.sender();
    ensure_player_resources(ctx, owner);
    let mut settlement = require_owned_town_hall(ctx, town_hall_id, true)?;
    if !land_levy_rate.is_finite() || !import_duty_rate.is_finite() || !export_duty_rate.is_finite()
    {
        return Err("Fiscal rates must be finite numbers.".to_string());
    }

    settlement.land_levy_rate = crate::fiscal_policy::clamp_land_levy_rate(land_levy_rate);
    settlement.import_duty_rate = crate::fiscal_policy::clamp_import_duty_rate(import_duty_rate);
    settlement.export_duty_rate = crate::fiscal_policy::clamp_export_duty_rate(export_duty_rate);
    ctx.db.settlement().id().update(settlement);
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
    if !is_valid_monastery_levy_rate(levy_rate) {
        return Err(
            "Choose Chartered immunity (0%), Customary aid (10%), or Extraordinary subsidy (25%)."
                .to_string(),
        );
    }
    let Some(mut resources) = ctx.db.player_resources().owner().find(&owner) else {
        return Err("Player resources not found.".to_string());
    };
    resources.monastery_levy_rate = normalize_monastery_levy_rate(levy_rate);
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
        let Some(payment) = plan_monastery_private_gold_payment(
            monastery.gold,
            monastery.civic_receipts_gold,
            monastery.private_export_proceeds_gold,
            MONASTERY_ORCHARD_REPLANT_COST,
            MONASTERY_ESTATE_GOLD_RESERVE,
        ) else {
            return Err(format!(
                "The monastery needs {:.0} private gold plus its {:.0}-gold working reserve to replant the orchard.",
                whole_cost(MONASTERY_ORCHARD_REPLANT_COST),
                whole_cost(MONASTERY_ESTATE_GOLD_RESERVE),
            ));
        };
        monastery.gold = payment.gold;
        monastery.civic_receipts_gold = payment.civic_receipts_gold;
        monastery.private_export_proceeds_gold = payment.private_export_proceeds_gold;
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
pub fn set_seasonal_labor_steward(
    ctx: &ReducerContext,
    town_hall_id: u64,
    enabled: bool,
) -> Result<(), String> {
    let owner = ctx.sender();
    ensure_player_resources(ctx, owner);
    let mut settlement = require_owned_town_hall(ctx, town_hall_id, true)?;
    if settlement.seasonal_labor_steward_enabled == enabled {
        return Ok(());
    }
    settlement.seasonal_labor_steward_enabled = enabled;
    let settlement_id = settlement.id;
    let labor_reserve = settlement.labor_steward_reserve;
    ctx.db.settlement().id().update(settlement);

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
        reconcile_seasonal_labor_for_settlement(
            ctx,
            owner,
            settlement_id,
            game_clock(sim_tick).month,
            labor_reserve,
        );
    }
    Ok(())
}

#[reducer]
pub fn set_construction_labor_steward(
    ctx: &ReducerContext,
    town_hall_id: u64,
    enabled: bool,
) -> Result<(), String> {
    let owner = ctx.sender();
    ensure_player_resources(ctx, owner);
    let mut settlement = require_owned_town_hall(ctx, town_hall_id, true)?;
    if settlement.construction_labor_steward_enabled == enabled {
        return Ok(());
    }
    settlement.construction_labor_steward_enabled = enabled;
    let settlement_id = settlement.id;
    let labor_reserve = settlement.labor_steward_reserve;
    ctx.db.settlement().id().update(settlement);

    // Opting in is immediately useful; later reviews occur once per calendar
    // day while a Town Hall clerk remains assigned.
    if enabled {
        rotate_construction_labor_for_settlement_with_reserve(
            ctx,
            owner,
            settlement_id,
            labor_reserve,
        );
    }
    Ok(())
}

#[reducer]
pub fn set_production_labor_steward(
    ctx: &ReducerContext,
    town_hall_id: u64,
    enabled: bool,
) -> Result<(), String> {
    let owner = ctx.sender();
    ensure_player_resources(ctx, owner);
    let mut settlement = require_owned_town_hall(ctx, town_hall_id, true)?;
    if settlement.production_labor_steward_enabled == enabled {
        return Ok(());
    }
    settlement.production_labor_steward_enabled = enabled;
    let settlement_id = settlement.id;
    let labor_reserve = settlement.labor_steward_reserve;
    ctx.db.settlement().id().update(settlement);

    // Enabling immediately applies the conservative recall-then-deploy order;
    // unlike the manual call-up, automation will not pre-staff an empty chain.
    if enabled {
        reconcile_target_production_labor_for_settlement(
            ctx,
            owner,
            settlement_id,
            labor_reserve,
        );
    }
    Ok(())
}

#[reducer]
pub fn set_labor_steward_reserve(
    ctx: &ReducerContext,
    town_hall_id: u64,
    labor_reserve: u32,
) -> Result<(), String> {
    let owner = ctx.sender();
    ensure_player_resources(ctx, owner);
    let mut settlement = require_owned_town_hall(ctx, town_hall_id, true)?;
    if !is_valid_labor_steward_reserve(labor_reserve) {
        return Err("Labor reserve must be 0, 1, 2, 4, or 6 villagers.".to_string());
    }
    if settlement.labor_steward_reserve == labor_reserve {
        return Ok(());
    }
    settlement.labor_steward_reserve = labor_reserve;
    ctx.db.settlement().id().update(settlement);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{plan_monastery_private_gold_payment, MonasteryPrivateGoldPayment};

    #[test]
    fn monastery_replant_spends_only_whole_private_coins() {
        assert_eq!(
            plan_monastery_private_gold_payment(30.9, 5.8, 20.7, 12.2, 6.1),
            Some(MonasteryPrivateGoldPayment {
                gold: 17.0,
                civic_receipts_gold: 5.0,
                private_export_proceeds_gold: 12.0,
            })
        );
    }

    #[test]
    fn monastery_replant_preserves_the_whole_working_reserve() {
        assert_eq!(
            plan_monastery_private_gold_payment(22.0, 4.0, 10.0, 12.0, 7.0),
            None
        );
    }
}
