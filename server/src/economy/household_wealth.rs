use spacetimedb::ReducerContext;

use crate::db::*;
use crate::resource_units::{whole_cost, whole_transfer, whole_units};
use crate::tables::Residence;

/// Credit private household savings. The configured "maximum" is a routing
/// target for physical income carts, not a hard cap that destroys excess coin.
pub fn credit_residence_wealth(ctx: &ReducerContext, residence_id: u64, amount: f64) -> f64 {
    let amount = whole_units(amount);
    if amount < 1.0 {
        return 0.0;
    }

    let Some(mut residence) = ctx.db.residence().id().find(&residence_id) else {
        return 0.0;
    };

    let credited = amount;
    residence.household_wealth = whole_units(residence.household_wealth) + credited;
    ctx.db.residence().id().update(residence);
    credited
}

/// Deduct up to `amount` from a residence wallet. Returns gold actually paid.
pub fn debit_residence_wealth(ctx: &ReducerContext, residence: &Residence, amount: f64) -> f64 {
    let amount = whole_cost(amount);
    if amount < 1.0 {
        return 0.0;
    }

    let Some(mut updated) = ctx.db.residence().id().find(&residence.id) else {
        return 0.0;
    };
    updated.household_wealth = whole_units(updated.household_wealth);
    let paid = whole_transfer(updated.household_wealth, amount);
    if paid < 1.0 {
        return 0.0;
    }
    updated.household_wealth -= paid;
    ctx.db.residence().id().update(updated);
    paid
}
