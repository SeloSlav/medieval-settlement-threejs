//! Physical civic-customs and private-export accounting.

use spacetimedb::ReducerContext;

use crate::db::*;
use crate::fiscal_policy::{
    clamp_export_duty_rate, normalize_monastery_levy_rate, split_private_export_receipt,
    PrivateExportSplit,
};
use crate::resource_units::{whole_cost, whole_transfer, whole_units};
use crate::tables::Building;

use super::{
    credit_residence_wealth, credit_treasury_gold, deposit_building_commodity,
    settlement_economic_activity_tax_rate, settlement_town_hall_tax_collection_multiplier,
    CommodityKind,
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

pub fn settlement_export_duty_rate(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    settlement_id: u64,
) -> f64 {
    clamp_export_duty_rate(crate::settlement_policy::export_duty_rate(
        ctx,
        owner,
        settlement_id,
    ))
}

pub fn player_monastery_levy_rate(ctx: &ReducerContext, owner: spacetimedb::Identity) -> f64 {
    ctx.db
        .player_resources()
        .owner()
        .find(&owner)
        .map(|resources| normalize_monastery_levy_rate(resources.monastery_levy_rate))
        .unwrap_or(0.10)
}

pub fn private_export_proceeds(building: &Building) -> f64 {
    whole_units(building.private_export_proceeds_gold)
        .min((whole_units(building.gold) - whole_units(building.civic_receipts_gold)).max(0.0))
}

pub fn withdraw_private_export_proceeds(building: &mut Building, amount: f64) -> f64 {
    let available = private_export_proceeds(building);
    let withdrawn = whole_transfer(available, amount);
    building.private_export_proceeds_gold = available - withdrawn;
    building.gold = whole_units(building.gold) - withdrawn;
    withdrawn
}

pub fn restore_private_export_proceeds(building: &mut Building, amount: f64) {
    let gold = whole_units(building.gold);
    let civic = whole_units(building.civic_receipts_gold).min(gold);
    let private = private_export_proceeds(building);
    let unpledged_room = (gold - civic - private).max(0.0);
    let restored = whole_transfer(unpledged_room, amount);
    building.private_export_proceeds_gold = private + restored;
}

/// Hamilton apportionment for indivisible coins. Every coin is assigned once,
/// while stable ids break equal-remainder ties deterministically for replay.
fn apportion_whole_coins(amount: f64, weighted_ids: &[(u64, u32)]) -> Vec<(u64, f64)> {
    let coins = whole_units(amount) as u64;
    let total_weight = weighted_ids
        .iter()
        .map(|(_, weight)| *weight as u128)
        .sum::<u128>();
    if coins == 0 || total_weight == 0 {
        return weighted_ids.iter().map(|(id, _)| (*id, 0.0)).collect();
    }

    let mut allocations = Vec::with_capacity(weighted_ids.len());
    let mut assigned = 0_u64;
    for (id, weight) in weighted_ids {
        let numerator = coins as u128 * *weight as u128;
        let base = (numerator / total_weight) as u64;
        let remainder = numerator % total_weight;
        assigned = assigned.saturating_add(base);
        allocations.push((*id, base, remainder));
    }

    let mut remainder_order = (0..allocations.len()).collect::<Vec<_>>();
    remainder_order.sort_by(|left, right| {
        allocations[*right]
            .2
            .cmp(&allocations[*left].2)
            .then_with(|| allocations[*left].0.cmp(&allocations[*right].0))
    });
    for index in remainder_order
        .into_iter()
        .take(coins.saturating_sub(assigned) as usize)
    {
        allocations[index].1 += 1;
    }
    allocations
        .into_iter()
        .map(|(id, share, _)| (id, share as f64))
        .collect()
}

fn split_local_purchase_receipt(gross_receipt: f64, effective_tax_rate: f64) -> LocalPurchaseSplit {
    let gross = whole_units(gross_receipt);
    let local_tax = whole_cost(gross * effective_tax_rate.clamp(0.0, 1.0)).min(gross);
    LocalPurchaseSplit {
        producer_income: gross - local_tax,
        local_tax,
    }
}

/// Credits aggregate private producer income across occupied households by
/// population. Workplace labor is settlement-wide rather than tied to a
/// person record, so population is the stable macro-level attribution key.
pub fn credit_settlement_household_income(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    amount: f64,
) -> f64 {
    credit_local_household_income(ctx, owner, 0, amount)
}

pub fn credit_local_household_income(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    settlement_id: u64,
    amount: f64,
) -> f64 {
    let mut residences = ctx
        .db
        .residence()
        .owner()
        .filter(&owner)
        .filter(|residence| {
            residence.population > 0
                && !residence.abandoned
                && (settlement_id == 0 || residence.settlement_id == settlement_id)
        })
        .collect::<Vec<_>>();
    residences.sort_by_key(|residence| residence.id);
    let amount = whole_units(amount);
    if amount < 1.0 || residences.is_empty() {
        return 0.0;
    }
    let weights = residences
        .iter()
        .map(|residence| (residence.id, residence.population))
        .collect::<Vec<_>>();
    let shares = apportion_whole_coins(amount, &weights);
    let mut credited = 0.0;
    for (residence_id, share) in shares {
        credited += credit_residence_wealth(ctx, residence_id, share);
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
    let gross_receipt = whole_units(gross_receipt);
    if gross_receipt < 1.0 || marketplace.kind != "trading_post" {
        return PrivateExportSplit::default();
    }
    let rate = settlement_export_duty_rate(ctx, marketplace.owner, marketplace.settlement_id);
    let physical = ctx
        .db
        .player_resources()
        .owner()
        .find(&marketplace.owner)
        .is_some_and(|resources| resources.physical_founding_site_enabled);

    let split = if physical {
        let deposited = deposit_building_commodity(marketplace, CommodityKind::Gold, gross_receipt);
        let split = split_private_export_receipt(deposited, rate);
        marketplace.civic_receipts_gold = (whole_units(marketplace.civic_receipts_gold)
            + split.export_duty)
            .min(whole_units(marketplace.gold));
        marketplace.private_export_proceeds_gold = (private_export_proceeds(marketplace)
            + split.household_income)
            .min((whole_units(marketplace.gold) - marketplace.civic_receipts_gold).max(0.0));
        split
    } else {
        let split = split_private_export_receipt(gross_receipt, rate);
        credit_treasury_gold(ctx, marketplace.owner, split.export_duty);
        let credited = credit_local_household_income(
            ctx,
            marketplace.owner,
            marketplace.settlement_id,
            split.household_income,
        );
        // A depopulated legacy settlement has no private wallet to receive the
        // proceeds. Keep those coins in civic custody instead of deleting them.
        credit_treasury_gold(
            ctx,
            marketplace.owner,
            (split.household_income - credited).max(0.0),
        );
        PrivateExportSplit {
            household_income: split.household_income,
            export_duty: split.export_duty,
        }
    };

    if let Some(mut resources) = ctx.db.player_resources().owner().find(&marketplace.owner) {
        resources.export_duty_collected_total =
            whole_units(resources.export_duty_collected_total) + split.export_duty;
        if !physical {
            resources.private_export_income_total =
                whole_units(resources.private_export_income_total) + split.household_income;
        }
        ctx.db.player_resources().owner().update(resources);
    }
    if let Some(mut settlement) = crate::settlement_policy::row(
        ctx,
        marketplace.owner,
        marketplace.settlement_id,
    ) {
        settlement.export_duty_collected_total =
            whole_units(settlement.export_duty_collected_total) + split.export_duty;
        ctx.db.settlement().id().update(settlement);
    }
    split
}

/// Settle the monastery's narrow estate-export charter. Unlike producer
/// exports routed through a Trading Post, the net receipt remains in the
/// monastery purse for estate reinvestment. The player's configured export
/// negotiated monastic levy is still collected; in physical settlements it remains protected at
/// the monastery until a civic collection cart reaches it.
pub fn credit_monastery_export_receipt(
    ctx: &ReducerContext,
    monastery: &mut Building,
    gross_receipt: f64,
) -> MonasteryExportSplit {
    let gross_receipt = whole_units(gross_receipt);
    if gross_receipt < 1.0 || monastery.kind != "monastery" {
        return MonasteryExportSplit::default();
    }
    let rate = player_monastery_levy_rate(ctx, monastery.owner);
    let physical = ctx
        .db
        .player_resources()
        .owner()
        .find(&monastery.owner)
        .is_some_and(|resources| resources.physical_founding_site_enabled);

    let split = if physical {
        let deposited = deposit_building_commodity(monastery, CommodityKind::Gold, gross_receipt);
        let receipt = split_private_export_receipt(deposited, rate);
        monastery.civic_receipts_gold = (whole_units(monastery.civic_receipts_gold)
            + receipt.export_duty)
            .min(whole_units(monastery.gold));
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
        resources.monastery_levy_collected_total =
            whole_units(resources.monastery_levy_collected_total) + split.export_duty;
        resources.private_export_income_total =
            whole_units(resources.private_export_income_total) + split.estate_income;
        ctx.db.player_resources().owner().update(resources);
    }
    split
}

/// Settle a real household purchase made from local service-point stock. The
/// household's payment is conserved: collectible local sales tax becomes a
/// protected civic receipt and the remainder becomes protected producer
/// income, later carried to occupied homes by population share.
pub fn credit_local_purchase_receipt(
    ctx: &ReducerContext,
    market: &mut Building,
    gross_receipt: f64,
) -> LocalPurchaseSplit {
    let gross_receipt = whole_units(gross_receipt);
    if gross_receipt < 1.0
        || !matches!(
            market.kind.as_str(),
            "marketplace" | "tavern" | "trading_post"
        )
    {
        return LocalPurchaseSplit::default();
    }
    let owner = market.owner;
    let rate = settlement_economic_activity_tax_rate(ctx, owner, market.settlement_id);
    let collection = settlement_town_hall_tax_collection_multiplier(
        ctx,
        owner,
        market.settlement_id,
    )
    .clamp(0.0, 1.0);
    let physical = ctx
        .db
        .player_resources()
        .owner()
        .find(&owner)
        .is_some_and(|resources| resources.physical_founding_site_enabled);

    let split = if physical {
        let deposited = deposit_building_commodity(market, CommodityKind::Gold, gross_receipt);
        let receipt = split_local_purchase_receipt(deposited, rate * collection);
        let local_tax = receipt.local_tax;
        let producer_income = receipt.producer_income;
        market.civic_receipts_gold =
            (whole_units(market.civic_receipts_gold) + local_tax).min(whole_units(market.gold));
        market.private_export_proceeds_gold = (private_export_proceeds(market) + producer_income)
            .min((whole_units(market.gold) - market.civic_receipts_gold).max(0.0));
        receipt
    } else {
        let receipt = split_local_purchase_receipt(gross_receipt, rate * collection);
        credit_treasury_gold(ctx, owner, receipt.local_tax);
        let credited = credit_local_household_income(
            ctx,
            owner,
            market.settlement_id,
            receipt.producer_income,
        );
        credit_treasury_gold(ctx, owner, (receipt.producer_income - credited).max(0.0));
        receipt
    };

    if let Some(mut resources) = ctx.db.player_resources().owner().find(&owner) {
        resources.local_discretionary_spend_total =
            whole_units(resources.local_discretionary_spend_total)
                + split.producer_income
                + split.local_tax;
        resources.local_producer_income_total =
            whole_units(resources.local_producer_income_total) + split.producer_income;
        ctx.db.player_resources().owner().update(resources);
    }
    split
}

pub fn record_private_export_income(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    amount: f64,
) {
    let amount = whole_units(amount);
    if amount < 1.0 {
        return;
    }
    if let Some(mut resources) = ctx.db.player_resources().owner().find(&owner) {
        resources.private_export_income_total =
            whole_units(resources.private_export_income_total) + amount;
        ctx.db.player_resources().owner().update(resources);
    }
}

#[cfg(test)]
mod tests {
    use super::{apportion_whole_coins, split_local_purchase_receipt};

    #[test]
    fn weighted_coin_apportionment_is_whole_stable_and_conserving() {
        let shares = apportion_whole_coins(11.9, &[(10, 1), (20, 2), (30, 1)]);
        assert_eq!(shares, vec![(10, 3.0), (20, 5.0), (30, 3.0)]);
        assert_eq!(shares.iter().map(|(_, share)| *share).sum::<f64>(), 11.0);
        assert!(shares.iter().all(|(_, share)| share.fract() == 0.0));
    }

    #[test]
    fn local_tax_split_charges_whole_coin_and_conserves_receipt() {
        let split = split_local_purchase_receipt(10.8, 0.01);
        assert_eq!(split.local_tax, 1.0);
        assert_eq!(split.producer_income, 9.0);
        assert_eq!(split.local_tax + split.producer_income, 10.0);
        assert_eq!(split_local_purchase_receipt(10.0, 0.0).local_tax, 0.0);
    }
}
