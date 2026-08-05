//! Physical civic-customs and private-export accounting.

use spacetimedb::ReducerContext;

use crate::db::*;
use crate::fiscal_policy::{
    clamp_export_duty_rate, clamp_import_duty_rate, household_import_duty,
    split_private_export_receipt, PrivateExportSplit,
};
use crate::tables::Building;

use super::{
    credit_local_civic_receipts, credit_residence_wealth, credit_treasury_gold,
    deposit_building_commodity, CommodityKind,
};

pub fn player_import_duty_rate(ctx: &ReducerContext, owner: spacetimedb::Identity) -> f64 {
    ctx.db
        .player_resources()
        .owner()
        .find(&owner)
        .map(|resources| clamp_import_duty_rate(resources.import_duty_rate))
        .unwrap_or(0.0)
}

pub fn player_export_duty_rate(ctx: &ReducerContext, owner: spacetimedb::Identity) -> f64 {
    ctx.db
        .player_resources()
        .owner()
        .find(&owner)
        .map(|resources| clamp_export_duty_rate(resources.export_duty_rate))
        .unwrap_or(0.0)
}

pub fn collectible_household_import_duty(
    ctx: &ReducerContext,
    marketplace: &Building,
    base_cost: f64,
) -> f64 {
    household_import_duty(
        base_cost,
        player_import_duty_rate(ctx, marketplace.owner),
    )
}

pub fn record_import_duty(ctx: &ReducerContext, owner: spacetimedb::Identity, amount: f64) {
    if amount <= 1e-9 {
        return;
    }
    if let Some(mut resources) = ctx.db.player_resources().owner().find(&owner) {
        resources.import_duty_collected_total += amount;
        ctx.db.player_resources().owner().update(resources);
    }
}

pub fn private_export_proceeds(building: &Building) -> f64 {
    building
        .private_export_proceeds_gold
        .max(0.0)
        .min((building.gold - building.civic_receipts_gold.max(0.0)).max(0.0))
}

pub fn withdraw_private_export_proceeds(building: &mut Building, amount: f64) -> f64 {
    let withdrawn = private_export_proceeds(building).min(amount.max(0.0));
    building.private_export_proceeds_gold =
        (private_export_proceeds(building) - withdrawn).max(0.0);
    building.gold = (building.gold - withdrawn).max(0.0);
    withdrawn
}

pub fn restore_private_export_proceeds(building: &mut Building, amount: f64) {
    let restored = amount.max(0.0).min(building.gold.max(0.0));
    building.private_export_proceeds_gold =
        (private_export_proceeds(building) + restored).min(building.gold.max(0.0));
}

fn distribute_legacy_private_income(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    amount: f64,
) -> f64 {
    let mut residences = ctx
        .db
        .residence()
        .owner()
        .filter(&owner)
        .filter(|residence| residence.population > 0 && !residence.abandoned)
        .collect::<Vec<_>>();
    residences.sort_by(|a, b| {
        a.household_wealth
            .partial_cmp(&b.household_wealth)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.id.cmp(&b.id))
    });
    let mut remaining = amount.max(0.0);
    let mut credited = 0.0;
    for residence in residences {
        if remaining <= 1e-9 {
            break;
        }
        let added = credit_residence_wealth(ctx, residence.id, remaining);
        credited += added;
        remaining -= added;
    }
    credited
}

/// Receives gross proceeds from an automatic specialty export. Manual export
/// contracts are public trades and continue to use the ordinary Trading Post
/// coffer; only this private branch is split into producer income and customs.
pub fn credit_private_export_receipt(
    ctx: &ReducerContext,
    marketplace: &mut Building,
    gross_receipt: f64,
) -> PrivateExportSplit {
    if gross_receipt <= 1e-9 || marketplace.kind != "trading_post" {
        return PrivateExportSplit::default();
    }
    let rate = player_export_duty_rate(ctx, marketplace.owner);
    let physical = ctx
        .db
        .player_resources()
        .owner()
        .find(&marketplace.owner)
        .is_some_and(|resources| resources.physical_founding_site_enabled);

    let split = if physical {
        let deposited = deposit_building_commodity(marketplace, CommodityKind::Gold, gross_receipt);
        let split = split_private_export_receipt(deposited, rate);
        marketplace.civic_receipts_gold =
            (marketplace.civic_receipts_gold.max(0.0) + split.export_duty)
                .min(marketplace.gold.max(0.0));
        marketplace.private_export_proceeds_gold =
            (private_export_proceeds(marketplace) + split.household_income)
                .min((marketplace.gold - marketplace.civic_receipts_gold).max(0.0));
        split
    } else {
        let split = split_private_export_receipt(gross_receipt, rate);
        credit_treasury_gold(ctx, marketplace.owner, split.export_duty);
        let credited = distribute_legacy_private_income(ctx, marketplace.owner, split.household_income);
        if credited + 1e-9 < split.household_income {
            credit_treasury_gold(ctx, marketplace.owner, split.household_income - credited);
        }
        PrivateExportSplit {
            household_income: credited,
            export_duty: split.export_duty,
        }
    };

    if let Some(mut resources) = ctx.db.player_resources().owner().find(&marketplace.owner) {
        resources.export_duty_collected_total += split.export_duty;
        if !physical {
            resources.private_export_income_total += split.household_income;
        }
        ctx.db.player_resources().owner().update(resources);
    }
    split
}

pub fn credit_household_import_duty(
    ctx: &ReducerContext,
    marketplace: &mut Building,
    duty: f64,
) -> f64 {
    let credited = credit_local_civic_receipts(ctx, marketplace, duty);
    record_import_duty(ctx, marketplace.owner, credited);
    credited
}

pub fn record_private_export_income(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    amount: f64,
) {
    if amount <= 1e-9 {
        return;
    }
    if let Some(mut resources) = ctx.db.player_resources().owner().find(&owner) {
        resources.private_export_income_total += amount;
        ctx.db.player_resources().owner().update(resources);
    }
}
