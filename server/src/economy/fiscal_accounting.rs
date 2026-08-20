//! Physical civic-customs and private-export accounting.

use spacetimedb::ReducerContext;

use crate::db::*;
use crate::fiscal_policy::{
    clamp_export_duty_rate, split_private_export_receipt, PrivateExportSplit,
};
use crate::tables::Building;

use super::{
    credit_residence_wealth, credit_treasury_gold, deposit_building_commodity,
    player_economic_activity_tax_rate, town_hall_tax_collection_multiplier, CommodityKind,
};

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct LocalPurchaseSplit {
    pub producer_income: f64,
    pub local_tax: f64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct MonasteryExportSplit {
    pub estate_income: f64,
    pub export_duty: f64,
}

pub fn player_export_duty_rate(ctx: &ReducerContext, owner: spacetimedb::Identity) -> f64 {
    ctx.db
        .player_resources()
        .owner()
        .find(&owner)
        .map(|resources| clamp_export_duty_rate(resources.export_duty_rate))
        .unwrap_or(0.0)
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

/// Credits aggregate private producer income to occupied households, starting
/// with the least wealthy. Workplace labor is settlement-wide rather than
/// tied to a specific residence, so this is the deterministic attribution
/// shared by local milk sales and legacy private exports.
pub fn credit_settlement_household_income(
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
        marketplace.civic_receipts_gold = (marketplace.civic_receipts_gold.max(0.0)
            + split.export_duty)
            .min(marketplace.gold.max(0.0));
        marketplace.private_export_proceeds_gold = (private_export_proceeds(marketplace)
            + split.household_income)
            .min((marketplace.gold - marketplace.civic_receipts_gold).max(0.0));
        split
    } else {
        let split = split_private_export_receipt(gross_receipt, rate);
        credit_treasury_gold(ctx, marketplace.owner, split.export_duty);
        let credited =
            credit_settlement_household_income(ctx, marketplace.owner, split.household_income);
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

/// Settle the monastery's narrow estate-export charter. Unlike producer
/// exports routed through a Trading Post, the net receipt remains in the
/// monastery purse for estate reinvestment. The player's configured export
/// duty is still collected; in physical settlements it remains protected at
/// the monastery until a civic collection cart reaches it.
pub fn credit_monastery_export_receipt(
    ctx: &ReducerContext,
    monastery: &mut Building,
    gross_receipt: f64,
) -> MonasteryExportSplit {
    if gross_receipt <= 1e-9 || monastery.kind != "monastery" {
        return MonasteryExportSplit::default();
    }
    let rate = player_export_duty_rate(ctx, monastery.owner);
    let physical = ctx
        .db
        .player_resources()
        .owner()
        .find(&monastery.owner)
        .is_some_and(|resources| resources.physical_founding_site_enabled);

    let split = if physical {
        let deposited = deposit_building_commodity(monastery, CommodityKind::Gold, gross_receipt);
        let receipt = split_private_export_receipt(deposited, rate);
        monastery.civic_receipts_gold = (monastery.civic_receipts_gold.max(0.0)
            + receipt.export_duty)
            .min(monastery.gold.max(0.0));
        MonasteryExportSplit {
            estate_income: receipt.household_income,
            export_duty: receipt.export_duty,
        }
    } else {
        let receipt = split_private_export_receipt(gross_receipt, rate);
        credit_treasury_gold(ctx, monastery.owner, receipt.export_duty);
        let estate_income =
            deposit_building_commodity(monastery, CommodityKind::Gold, receipt.household_income);
        MonasteryExportSplit {
            estate_income,
            export_duty: receipt.export_duty,
        }
    };

    if let Some(mut resources) = ctx.db.player_resources().owner().find(&monastery.owner) {
        resources.export_duty_collected_total += split.export_duty;
        resources.private_export_income_total += split.estate_income;
        ctx.db.player_resources().owner().update(resources);
    }
    split
}

/// Settle a real discretionary purchase made from Trading Post stock. The
/// household's payment is conserved: collectible local sales tax becomes a
/// protected civic receipt and the remainder becomes protected producer
/// income, later carried to the least-wealthy occupied homes.
pub fn credit_local_purchase_receipt(
    ctx: &ReducerContext,
    trading_post: &mut Building,
    gross_receipt: f64,
) -> LocalPurchaseSplit {
    if gross_receipt <= 1e-9 || trading_post.kind != "trading_post" {
        return LocalPurchaseSplit::default();
    }
    let owner = trading_post.owner;
    let rate = player_economic_activity_tax_rate(ctx, owner);
    let collection = town_hall_tax_collection_multiplier(ctx, owner).clamp(0.0, 1.0);
    let physical = ctx
        .db
        .player_resources()
        .owner()
        .find(&owner)
        .is_some_and(|resources| resources.physical_founding_site_enabled);

    let split = if physical {
        let deposited =
            deposit_building_commodity(trading_post, CommodityKind::Gold, gross_receipt);
        let local_tax = (deposited * rate * collection).clamp(0.0, deposited);
        let producer_income = (deposited - local_tax).max(0.0);
        trading_post.civic_receipts_gold =
            (trading_post.civic_receipts_gold.max(0.0) + local_tax).min(trading_post.gold.max(0.0));
        trading_post.private_export_proceeds_gold = (private_export_proceeds(trading_post)
            + producer_income)
            .min((trading_post.gold - trading_post.civic_receipts_gold).max(0.0));
        LocalPurchaseSplit {
            producer_income,
            local_tax,
        }
    } else {
        let local_tax = (gross_receipt * rate * collection).clamp(0.0, gross_receipt);
        let producer_income = (gross_receipt - local_tax).max(0.0);
        credit_treasury_gold(ctx, owner, local_tax);
        let credited = credit_settlement_household_income(ctx, owner, producer_income);
        if credited + 1e-9 < producer_income {
            credit_treasury_gold(ctx, owner, producer_income - credited);
        }
        LocalPurchaseSplit {
            producer_income,
            local_tax,
        }
    };

    if let Some(mut resources) = ctx.db.player_resources().owner().find(&owner) {
        resources.local_discretionary_spend_total += split.producer_income + split.local_tax;
        resources.local_producer_income_total += split.producer_income;
        ctx.db.player_resources().owner().update(resources);
    }
    split
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
