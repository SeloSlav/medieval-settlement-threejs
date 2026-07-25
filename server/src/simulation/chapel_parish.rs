use spacetimedb::ReducerContext;

use crate::balance_generated::all_market_food_commodities;
use crate::balance_generated::{
    CALENDAR_SECONDS_PER_DAY, CHAPEL_AUTO_SWEEP_FRACTION, CHAPEL_AUTO_SWEEP_INTERVAL_TICKS,
    CHAPEL_CHARITY_GOLD_PER_DAY, CHAPEL_CHARITY_MIN_COFFER_GOLD, CHAPEL_CHARITY_RELIEF_FRACTION,
    CHAPEL_CHARITY_WEALTH_FRACTION, CHAPEL_PRIEST_SALARY_GOLD_PER_DAY,
    CHAPEL_UNSTAFFED_UPKEEP_FRACTION, CHAPEL_UPKEEP_GOLD_PER_DAY, TICK_DT,
};
use crate::db::*;
use crate::economy::{
    best_affordable_food_commodity, ensure_market_state, nearest_marketplace_for_residence,
    order_food_commodity, scaled_gold_cost, MarketGoldPayer,
};
use crate::economy::{
    chapel_coffer_gold, credit_residence_wealth, credit_treasury_gold, deposit_coffer_in_place,
    withdraw_coffer_in_place,
};
use crate::economy::{record_parish_ledger, ParishLedgerKind};
use crate::simulation::game_calendar::GameClock;
use crate::simulation::labor_schedule::is_parish_economy_paused;
use crate::simulation::landmark_access::residence_has_marketplace_access;
use crate::simulation::marketplace_caravan::MarketCaravanDispatch;
use crate::simulation::residence_needs::{load_needs, need_stock, ResidenceNeedKind};
use crate::simulation::tick_context::SimTickContext;
use crate::tables::{Building, Residence};

pub fn chapel_gold_per_tick(daily_rate: f64) -> f64 {
    daily_rate * TICK_DT / CALENDAR_SECONDS_PER_DAY
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
    clock: &GameClock,
    chapels: &[Building],
    residences: &[Residence],
) {
    if is_parish_economy_paused(clock) {
        return;
    }

    for chapel in chapels {
        step_one_chapel_parish(ctx, tick, sim_tick, clock, chapel, residences);
    }
}

fn step_one_chapel_parish(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    sim_tick: u64,
    clock: &GameClock,
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
    let assigned_labor = chapel_row.assigned_labor;

    if assigned_labor > 0 {
        let salary_paid = withdraw_coffer_in_place(
            &mut chapel_row,
            chapel_priest_salary_per_tick(assigned_labor),
        );
        record_parish_ledger(ctx, owner, ParishLedgerKind::Salary, salary_paid);
    }

    let upkeep_paid =
        withdraw_coffer_in_place(&mut chapel_row, chapel_upkeep_per_tick(assigned_labor));
    record_parish_ledger(ctx, owner, ParishLedgerKind::Upkeep, upkeep_paid);

    let coffer_balance = chapel_coffer_gold(&chapel_row);
    if assigned_labor > 0 && coffer_balance >= CHAPEL_CHARITY_MIN_COFFER_GOLD {
        let charity_paid = withdraw_coffer_in_place(&mut chapel_row, chapel_charity_per_tick());
        if charity_paid > 1e-9 {
            distribute_chapel_charity(ctx, tick, clock, &mut chapel_row, residences, charity_paid);
            record_parish_ledger(ctx, owner, ParishLedgerKind::Charity, charity_paid);
        }
    }

    if sim_tick % CHAPEL_AUTO_SWEEP_INTERVAL_TICKS == 0 {
        if let Some(resources) = ctx.db.player_resources().owner().find(&owner) {
            if resources.chapel_auto_sweep_enabled {
                let reserve = resources.chapel_coffer_reserve_gold;
                let excess = chapel_coffer_gold(&chapel_row) - reserve;
                if excess > 1e-9 {
                    let swept = withdraw_coffer_in_place(
                        &mut chapel_row,
                        excess * CHAPEL_AUTO_SWEEP_FRACTION,
                    );
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
    clock: &GameClock,
    chapel: &mut Building,
    residences: &[Residence],
    amount: f64,
) {
    let relief_amount = amount * CHAPEL_CHARITY_RELIEF_FRACTION;
    let wealth_amount = amount * CHAPEL_CHARITY_WEALTH_FRACTION;

    let relief_spent = if relief_amount > 1e-9 {
        try_chapel_poor_relief(ctx, tick, clock, chapel, residences, relief_amount)
    } else {
        0.0
    };

    let wealth_distributed = if wealth_amount > 1e-9 {
        distribute_wealth_charity(ctx, tick, chapel, residences, wealth_amount)
    } else {
        0.0
    };

    let refund = (relief_amount - relief_spent) + (wealth_amount - wealth_distributed);
    if refund > 1e-9 {
        deposit_coffer_in_place(chapel, refund);
    }
}

fn try_chapel_poor_relief(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    chapel: &Building,
    residences: &[Residence],
    budget: f64,
) -> f64 {
    let marketplaces: Vec<Building> = ctx
        .db
        .building()
        .iter()
        .filter(|building| {
            building.kind == "marketplace"
                && building.construction_complete
                && building.owner == chapel.owner
        })
        .collect();

    if marketplaces.is_empty() {
        return 0.0;
    }

    ensure_market_state(ctx, chapel.owner);
    let Some(market) = ctx.db.market_state().owner().find(&chapel.owner) else {
        return 0.0;
    };

    let mut target: Option<&Residence> = None;
    let mut lowest_food = f64::INFINITY;

    for residence in residences {
        if !residence.abandoned || residence.owner != chapel.owner {
            continue;
        }
        if !tick.road_connected(chapel.owner, residence.x, residence.z, chapel.x, chapel.z) {
            continue;
        }
        if !residence_has_marketplace_access(tick, chapel.owner, residence, &marketplaces) {
            continue;
        }
        let food_stock = need_stock(&load_needs(ctx, residence.id), ResidenceNeedKind::Food);
        if food_stock + 1e-6 < lowest_food {
            lowest_food = food_stock;
            target = Some(residence);
        }
    }

    let Some(residence) = target else {
        return 0.0;
    };

    let Some(marketplace) =
        nearest_marketplace_for_residence(tick, chapel.owner, residence, &marketplaces)
    else {
        return 0.0;
    };

    let Some(commodity) = best_affordable_food_commodity(
        all_market_food_commodities(),
        budget,
        market.food_price_mult,
    ) else {
        return 0.0;
    };

    let gold_cost = scaled_gold_cost(commodity.base_gold_cost, market.food_price_mult);
    let dispatch = MarketCaravanDispatch {
        include_abandoned: true,
        priority_residence_id: Some(residence.id),
    };

    if order_food_commodity(
        ctx,
        tick,
        clock,
        marketplace.id,
        chapel.owner,
        commodity,
        gold_cost,
        MarketGoldPayer::Relief,
        Some(residence),
        dispatch,
    )
    .is_ok()
    {
        gold_cost
    } else {
        0.0
    }
}

fn distribute_wealth_charity(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    chapel: &Building,
    residences: &[Residence],
    amount: f64,
) -> f64 {
    let mut poorest: Option<&Residence> = None;
    for residence in residences {
        if residence.abandoned || residence.population == 0 || residence.owner != chapel.owner {
            continue;
        }
        if !tick.road_connected(chapel.owner, residence.x, residence.z, chapel.x, chapel.z) {
            continue;
        }

        poorest = match poorest {
            None => Some(residence),
            Some(current) if residence.household_wealth < current.household_wealth => {
                Some(residence)
            }
            other => other,
        };
    }

    let Some(target) = poorest else {
        return 0.0;
    };

    credit_residence_wealth(ctx, target.id, amount);
    amount
}

#[cfg(test)]
mod tests {
    use super::{
        chapel_charity_per_tick, chapel_gold_per_tick, chapel_priest_salary_per_tick,
        chapel_upkeep_per_tick,
    };
    use crate::balance_generated::{
        CHAPEL_CHARITY_GOLD_PER_DAY, CHAPEL_PRIEST_SALARY_GOLD_PER_DAY,
        CHAPEL_UNSTAFFED_UPKEEP_FRACTION, CHAPEL_UPKEEP_GOLD_PER_DAY, TICK_DT,
    };

    #[test]
    fn priest_salary_per_tick_matches_balance() {
        let expected = CHAPEL_PRIEST_SALARY_GOLD_PER_DAY * TICK_DT / CALENDAR_SECONDS_PER_DAY;
        assert!((chapel_priest_salary_per_tick(1) - expected).abs() < 1e-9);
        assert_eq!(chapel_priest_salary_per_tick(0), 0.0);
    }

    #[test]
    fn upkeep_per_tick_matches_balance() {
        let staffed = chapel_gold_per_tick(CHAPEL_UPKEEP_GOLD_PER_DAY);
        let idle =
            chapel_gold_per_tick(CHAPEL_UPKEEP_GOLD_PER_DAY * CHAPEL_UNSTAFFED_UPKEEP_FRACTION);
        assert!((chapel_upkeep_per_tick(1) - staffed).abs() < 1e-9);
        assert!((chapel_upkeep_per_tick(0) - idle).abs() < 1e-9);
    }

    #[test]
    fn charity_per_tick_matches_balance() {
        let expected = CHAPEL_CHARITY_GOLD_PER_DAY * TICK_DT / CALENDAR_SECONDS_PER_DAY;
        assert!((chapel_charity_per_tick() - expected).abs() < 1e-9);
    }
}
