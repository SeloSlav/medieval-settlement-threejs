use spacetimedb::ReducerContext;

use crate::db::*;

#[derive(Clone, Copy)]
pub enum ParishLedgerKind {
    Salary,
    Upkeep,
    Charity,
}

pub fn record_parish_ledger(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    kind: ParishLedgerKind,
    amount: f64,
) {
    if amount <= 1e-9 {
        return;
    }

    let Some(mut resources) = ctx.db.player_resources().owner().find(&owner) else {
        return;
    };

    match kind {
        ParishLedgerKind::Salary => resources.parish_salary_paid_total += amount,
        ParishLedgerKind::Upkeep => resources.parish_upkeep_paid_total += amount,
        ParishLedgerKind::Charity => resources.parish_charity_paid_total += amount,
    }

    ctx.db.player_resources().owner().update(resources);
}

pub fn clamp_chapel_coffer_reserve_gold(value: f64) -> f64 {
    use crate::balance_generated::{CHAPEL_COFFER_RESERVE_MAX, CHAPEL_COFFER_RESERVE_MIN};
    value.clamp(CHAPEL_COFFER_RESERVE_MIN, CHAPEL_COFFER_RESERVE_MAX)
}
