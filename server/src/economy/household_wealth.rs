use spacetimedb::ReducerContext;

use crate::balance_generated::HOUSEHOLD_MAX_WEALTH;
use crate::db::*;
use crate::tables::Residence;

/// Credit up to the household wealth cap. Returns gold actually received.
pub fn credit_residence_wealth(ctx: &ReducerContext, residence_id: u64, amount: f64) -> f64 {
    if amount <= 1e-9 {
        return 0.0;
    }

    let Some(mut residence) = ctx.db.residence().id().find(&residence_id) else {
        return 0.0;
    };

    let capped = (residence.household_wealth + amount).min(HOUSEHOLD_MAX_WEALTH);
    let credited = (capped - residence.household_wealth).max(0.0);
    if credited <= 1e-9 {
        return 0.0;
    }

    residence.household_wealth = capped;
    ctx.db.residence().id().update(residence);
    credited
}

/// Deduct up to `amount` from a residence wallet. Returns gold actually paid.
pub fn debit_residence_wealth(ctx: &ReducerContext, residence: &Residence, amount: f64) -> f64 {
    if amount <= 1e-9 || residence.household_wealth <= 1e-9 {
        return 0.0;
    }

    let paid = amount.min(residence.household_wealth);
    let Some(mut updated) = ctx.db.residence().id().find(&residence.id) else {
        return 0.0;
    };

    updated.household_wealth -= paid;
    ctx.db.residence().id().update(updated);
    paid
}
