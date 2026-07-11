use spacetimedb::ReducerContext;

use crate::balance_generated::{
    CHAPEL_AUTO_SWEEP_FRACTION, CHAPEL_AUTO_SWEEP_INTERVAL_TICKS, CHAPEL_CHARITY_GOLD_PER_DAY,
    CHAPEL_CHARITY_MIN_COFFER_GOLD, CHAPEL_PRIEST_SALARY_GOLD_PER_DAY, CHAPEL_UNSTAFFED_UPKEEP_FRACTION,
    CHAPEL_UPKEEP_GOLD_PER_DAY, TICK_DT,
};
use crate::db::*;
use crate::economy::{
    chapel_coffer_gold, credit_treasury_gold, credit_residence_wealth, deposit_coffer_in_place,
    withdraw_coffer_in_place,
};
use crate::economy::{record_parish_ledger, ParishLedgerKind};
use crate::simulation::tick_context::SimTickContext;
use crate::tables::{Building, Residence};

const SECONDS_PER_DAY: f64 = 86_400.0;

pub fn chapel_gold_per_tick(daily_rate: f64) -> f64 {
    daily_rate * TICK_DT / SECONDS_PER_DAY
}

pub fn chapel_priest_salary_per_tick(assigned_labor: u32) -> f64 {
    if assigned_labor == 0 {
        return 0.0;
    }
    chapel_gold_per_tick(CHAPEL_PRIEST_SALARY_GOLD_PER_DAY * assigned_labor as f64)
}

pub fn chapel_upkeep_per_tick(assigned_labor: u32) -> f64 {
    let daily = if assigned_labor > 0 {
        CHAPEL_UPKEEP_GOLD_PER_DAY
    } else {
        CHAPEL_UPKEEP_GOLD_PER_DAY * CHAPEL_UNSTAFFED_UPKEEP_FRACTION
    };
    chapel_gold_per_tick(daily)
}

pub fn chapel_charity_per_tick() -> f64 {
    chapel_gold_per_tick(CHAPEL_CHARITY_GOLD_PER_DAY)
}

pub fn step_chapel_parish(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    sim_tick: u64,
    chapels: &[Building],
    residences: &[Residence],
) {
    for chapel in chapels {
        step_one_chapel_parish(ctx, tick, sim_tick, chapel, residences);
    }
}

fn step_one_chapel_parish(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    sim_tick: u64,
    chapel: &Building,
    residences: &[Residence],
) {
    if chapel.kind != "chapel" {
        return;
    }

    let Some(mut chapel_row) = ctx.db.building().id().find(&chapel.id) else {
        return;
    };

    let owner = chapel_row.owner;

    if chapel_row.assigned_labor > 0 {
        let salary_paid =
            withdraw_coffer_in_place(&mut chapel_row, chapel_priest_salary_per_tick(chapel_row.assigned_labor));
        record_parish_ledger(ctx, owner, ParishLedgerKind::Salary, salary_paid);
    }

    let upkeep_paid = withdraw_coffer_in_place(&mut chapel_row, chapel_upkeep_per_tick(chapel_row.assigned_labor));
    record_parish_ledger(ctx, owner, ParishLedgerKind::Upkeep, upkeep_paid);

    let coffer_balance = chapel_coffer_gold(&chapel_row);
    if chapel_row.assigned_labor > 0 && coffer_balance >= CHAPEL_CHARITY_MIN_COFFER_GOLD {
        let charity_paid = withdraw_coffer_in_place(&mut chapel_row, chapel_charity_per_tick());
        if charity_paid > 1e-9 {
            distribute_chapel_charity(ctx, tick, &mut chapel_row, residences, charity_paid);
            record_parish_ledger(ctx, owner, ParishLedgerKind::Charity, charity_paid);
        }
    }

    if sim_tick % CHAPEL_AUTO_SWEEP_INTERVAL_TICKS == 0 {
        if let Some(resources) = ctx.db.player_resources().owner().find(&owner) {
            if resources.chapel_auto_sweep_enabled {
                let reserve = resources.chapel_coffer_reserve_gold;
                let excess = chapel_coffer_gold(&chapel_row) - reserve;
                if excess > 1e-9 {
                    let swept = withdraw_coffer_in_place(&mut chapel_row, excess * CHAPEL_AUTO_SWEEP_FRACTION);
                    if swept > 1e-9 {
                        credit_treasury_gold(ctx, owner, swept);
                        record_parish_ledger(ctx, owner, ParishLedgerKind::AutoSweep, swept);
                    }
                }
            }
        }
    }

    ctx.db.building().id().update(chapel_row);
}

fn distribute_chapel_charity(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    chapel: &mut Building,
    residences: &[Residence],
    amount: f64,
) {
    let mut poorest: Option<&Residence> = None;
    for residence in residences {
        if residence.abandoned || residence.population == 0 || residence.owner != chapel.owner {
            continue;
        }
        if !tick.road_connected(
            chapel.owner,
            residence.x,
            residence.z,
            chapel.x,
            chapel.z,
        ) {
            continue;
        }

        poorest = match poorest {
            None => Some(residence),
            Some(current) if residence.household_wealth < current.household_wealth => Some(residence),
            other => other,
        };
    }

    let Some(target) = poorest else {
        deposit_coffer_in_place(chapel, amount);
        return;
    };

    credit_residence_wealth(ctx, target.id, amount);
}

#[cfg(test)]
mod tests {
    use super::{
        chapel_charity_per_tick, chapel_gold_per_tick, chapel_priest_salary_per_tick, chapel_upkeep_per_tick,
    };
    use crate::balance_generated::{
        CHAPEL_CHARITY_GOLD_PER_DAY, CHAPEL_PRIEST_SALARY_GOLD_PER_DAY, CHAPEL_UNSTAFFED_UPKEEP_FRACTION,
        CHAPEL_UPKEEP_GOLD_PER_DAY, TICK_DT,
    };

    #[test]
    fn priest_salary_per_tick_matches_balance() {
        let expected = CHAPEL_PRIEST_SALARY_GOLD_PER_DAY * TICK_DT / 86_400.0;
        assert!((chapel_priest_salary_per_tick(1) - expected).abs() < 1e-9);
        assert_eq!(chapel_priest_salary_per_tick(0), 0.0);
    }

    #[test]
    fn upkeep_per_tick_matches_balance() {
        let staffed = chapel_gold_per_tick(CHAPEL_UPKEEP_GOLD_PER_DAY);
        let idle = chapel_gold_per_tick(CHAPEL_UPKEEP_GOLD_PER_DAY * CHAPEL_UNSTAFFED_UPKEEP_FRACTION);
        assert!((chapel_upkeep_per_tick(1) - staffed).abs() < 1e-9);
        assert!((chapel_upkeep_per_tick(0) - idle).abs() < 1e-9);
    }

    #[test]
    fn charity_per_tick_matches_balance() {
        let expected = CHAPEL_CHARITY_GOLD_PER_DAY * TICK_DT / 86_400.0;
        assert!((chapel_charity_per_tick() - expected).abs() < 1e-9);
    }
}
