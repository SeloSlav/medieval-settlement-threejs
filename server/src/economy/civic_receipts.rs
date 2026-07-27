use spacetimedb::ReducerContext;

use crate::db::*;
use crate::tables::Building;

use super::{credit_treasury_gold, deposit_building_commodity, CommodityKind};

pub fn local_civic_receipts(building: &Building) -> f64 {
    building
        .civic_receipts_gold
        .max(0.0)
        .min(building.gold.max(0.0))
}

/// New settlements retain fares and visitor gifts at their physical source.
/// Legacy settlements preserve the former direct treasury credit.
pub fn credit_local_civic_receipts(
    ctx: &ReducerContext,
    building: &mut Building,
    amount: f64,
) -> f64 {
    if !amount.is_finite() || amount <= 1e-9 {
        return 0.0;
    }
    let physical = ctx
        .db
        .player_resources()
        .owner()
        .find(&building.owner)
        .is_some_and(|resources| resources.physical_founding_site_enabled);
    if !physical {
        credit_treasury_gold(ctx, building.owner, amount);
        return amount;
    }
    let deposited = deposit_building_commodity(building, CommodityKind::Gold, amount);
    building.civic_receipts_gold =
        (local_civic_receipts(building) + deposited).min(building.gold.max(0.0));
    deposited
}

pub fn mark_local_civic_receipts_dispatched(building: &mut Building, amount: f64) {
    building.civic_receipts_gold =
        (local_civic_receipts(building) - amount.max(0.0)).max(0.0);
}

pub fn restore_local_civic_receipts(building: &mut Building, amount: f64) {
    building.civic_receipts_gold =
        (local_civic_receipts(building) + amount.max(0.0)).min(building.gold.max(0.0));
}
