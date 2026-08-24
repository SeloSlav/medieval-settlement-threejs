use spacetimedb::ReducerContext;

use crate::db::*;
use crate::resource_units::{whole_transfer, whole_units};
use crate::tables::Building;

use super::{credit_treasury_gold, deposit_building_commodity, CommodityKind};

pub fn local_civic_receipts(building: &Building) -> f64 {
    whole_units(building.civic_receipts_gold).min(whole_units(building.gold))
}

/// New settlements retain fares and visitor gifts at their physical source.
/// Legacy settlements preserve the former direct treasury credit.
pub fn credit_local_civic_receipts(
    ctx: &ReducerContext,
    building: &mut Building,
    amount: f64,
) -> f64 {
    let amount = whole_units(amount);
    if amount < 1.0 {
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
        (local_civic_receipts(building) + deposited).min(whole_units(building.gold));
    deposited
}

pub fn mark_local_civic_receipts_dispatched(building: &mut Building, amount: f64) {
    let receipts = local_civic_receipts(building);
    building.civic_receipts_gold = receipts - whole_transfer(receipts, amount);
}

pub fn restore_local_civic_receipts(building: &mut Building, amount: f64) {
    let gold = whole_units(building.gold);
    let receipts = local_civic_receipts(building);
    building.civic_receipts_gold =
        receipts + whole_transfer((gold - receipts).max(0.0), amount);
}
