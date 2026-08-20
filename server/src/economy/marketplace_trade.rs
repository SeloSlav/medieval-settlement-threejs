//! Accounting for physical market receipts and live specialty-export carts.

use spacetimedb::ReducerContext;

use super::regional_market::{
    ensure_market_state, record_specialty_market_export,
    specialty_price_multiplier_for_commodity,
};
use crate::balance_generated::{
    SPECIALTY_EXPORT_GOLD_PER_ALE, SPECIALTY_EXPORT_GOLD_PER_CHEESE,
    SPECIALTY_EXPORT_GOLD_PER_CLOTH, SPECIALTY_EXPORT_GOLD_PER_HONEY,
    SPECIALTY_EXPORT_GOLD_PER_POTTERY, SPECIALTY_EXPORT_GOLD_PER_WINE,
};
use crate::db::*;
use crate::economy::{credit_treasury_gold, deposit_building_commodity, CommodityKind};
use crate::tables::Building;

fn physical_trade_staging_enabled(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
) -> bool {
    ctx.db
        .player_resources()
        .owner()
        .find(&owner)
        .is_some_and(|resources| resources.physical_founding_site_enabled)
}

/// Physical settlements hold local market receipts at the market until a
/// visible collection cart reaches a civic lockbox. Legacy settlements keep
/// the aggregate treasury path used by their existing saves.
pub(crate) fn credit_marketplace_receipt_gold(
    ctx: &ReducerContext,
    marketplace: &mut Building,
    amount: f64,
) {
    if !amount.is_finite() || amount <= 1e-6 {
        return;
    }
    if physical_trade_staging_enabled(ctx, marketplace.owner) {
        deposit_building_commodity(marketplace, CommodityKind::Gold, amount);
    } else {
        credit_treasury_gold(ctx, marketplace.owner, amount);
    }
}

/// Exchanges a surviving live specialty-export load at the regional map edge.
/// Manual Trading Post contracts were replaced by monthly ledger rules; only
/// automatic specialty carts (contract code zero) remain valid here.
pub(crate) fn settle_regional_market_export(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    marketplace_id: u64,
    contract_code: u64,
    sold_commodity: CommodityKind,
    sold_amount: f64,
) -> Result<(CommodityKind, f64), String> {
    if contract_code != 0 {
        return Err("Manual regional trade contracts have been retired.".to_string());
    }
    let export_site = ctx
        .db
        .building()
        .id()
        .find(&marketplace_id)
        .filter(|building| {
            building.owner == owner
                && matches!(building.kind.as_str(), "trading_post" | "monastery")
                && building.construction_complete
        })
        .ok_or_else(|| "The regional specialty export site no longer exists.".to_string())?;
    if !sold_amount.is_finite() || sold_amount < 0.0 {
        return Err("The regional export load is invalid.".to_string());
    }

    let gold_per_unit = match sold_commodity {
        CommodityKind::Ale => SPECIALTY_EXPORT_GOLD_PER_ALE,
        CommodityKind::Honey => SPECIALTY_EXPORT_GOLD_PER_HONEY,
        CommodityKind::Wine => SPECIALTY_EXPORT_GOLD_PER_WINE,
        CommodityKind::Cloth => SPECIALTY_EXPORT_GOLD_PER_CLOTH,
        CommodityKind::Cheese => SPECIALTY_EXPORT_GOLD_PER_CHEESE,
        CommodityKind::Pottery => SPECIALTY_EXPORT_GOLD_PER_POTTERY,
        _ => return Err("The specialty export contract does not match its cargo.".to_string()),
    };

    ensure_market_state(ctx, owner);
    let market = ctx
        .db
        .market_state()
        .owner()
        .find(&export_site.owner)
        .ok_or_else(|| "Market state unavailable.".to_string())?;
    let market_rate = specialty_price_multiplier_for_commodity(&market, sold_commodity)
        .ok_or_else(|| "The specialty cargo has no regional market family.".to_string())?;
    record_specialty_market_export(ctx, owner, sold_commodity, sold_amount);
    Ok((
        CommodityKind::Gold,
        sold_amount * gold_per_unit * market_rate.max(0.0),
    ))
}
