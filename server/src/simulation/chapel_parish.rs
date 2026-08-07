use spacetimedb::ReducerContext;

use crate::balance_generated::all_market_food_commodities;
use crate::balance_generated::{
    CHAPEL_CHARITY_GOLD_PER_DAY, CHAPEL_CHARITY_MIN_COFFER_GOLD,
    CHAPEL_POOR_RELIEF_GOLD_PER_DISPATCH, CHAPEL_PRIEST_SALARY_GOLD_PER_DAY,
    CHAPEL_UNSTAFFED_UPKEEP_FRACTION, CHAPEL_UPKEEP_GOLD_PER_DAY, HOUSEHOLD_MAX_WEALTH, TICK_DT,
    TIMBER_DELIVERY_SPEED_MPS, TIMBER_DELIVERY_UNLOAD_SEC,
};
use crate::chapel_parish_policy::{
    chapel_alms_dispatch_amount, chapel_alms_dispatch_interval_seconds,
    chapel_daily_gold_per_work_tick, chapel_poor_relief_due,
};
use crate::db::*;
use crate::economy::{
    best_affordable_food_commodity, ensure_market_state, market_food_commodity_kind,
    order_food_commodity, scaled_gold_cost, MarketGoldPayer,
};
use crate::economy::{chapel_coffer_gold, credit_residence_wealth, withdraw_coffer_in_place};
use crate::economy::{record_parish_ledger, ParishLedgerKind};
use crate::residence_service_policy::service_shortage_warns;
use crate::simulation::delivery_cargo::residence_commodity_delivery_room;
use crate::simulation::delivery_trips::try_start_residence_wealth_trip;
use crate::simulation::game_calendar::GameClock;
use crate::simulation::labor_schedule::is_parish_economy_paused;
use crate::simulation::marketplace_caravan::MarketCaravanDispatch;
use crate::simulation::residence_needs::{load_needs, need_stock, ResidenceNeedKind};
use crate::simulation::road_logistics::claim_residences_by_nearest_supplier;
use crate::simulation::tick_context::SimTickContext;
use crate::tables::{Building, Residence};

pub fn chapel_priest_salary_per_tick(assigned_labor: u32) -> f64 {
    if assigned_labor == 0 {
        return 0.0;
    }
    chapel_daily_gold_per_work_tick(CHAPEL_PRIEST_SALARY_GOLD_PER_DAY * assigned_labor as f64)
}

pub fn chapel_upkeep_per_tick(assigned_labor: u32) -> f64 {
    let daily = if assigned_labor > 0 {
        CHAPEL_UPKEEP_GOLD_PER_DAY
    } else {
        CHAPEL_UPKEEP_GOLD_PER_DAY * CHAPEL_UNSTAFFED_UPKEEP_FRACTION
    };
    chapel_daily_gold_per_work_tick(daily)
}

pub fn chapel_charity_per_tick() -> f64 {
    chapel_daily_gold_per_work_tick(CHAPEL_CHARITY_GOLD_PER_DAY)
}

pub fn step_chapel_parish(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    sim_tick: u64,
    clock: &GameClock,
    chapels: &[Building],
    residences: &[Residence],
) {
    let economy_active = !is_parish_economy_paused(clock);
    if !economy_active {
        return;
    }

    let mut parish_residences: std::collections::HashMap<u64, Vec<&Residence>> =
        std::collections::HashMap::new();
    if economy_active {
        for residence in residences {
            if let Some(chapel_id) = tick.chapel_for_residence(ctx, residence.owner, residence.id) {
                parish_residences
                    .entry(chapel_id)
                    .or_default()
                    .push(residence);
            }
        }
    }

    let mut ordered_chapels: Vec<&Building> = chapels.iter().collect();
    ordered_chapels.sort_by_key(|chapel| chapel.id);
    for chapel in ordered_chapels {
        let claimed = parish_residences
            .get(&chapel.id)
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        step_one_chapel_parish(ctx, tick, sim_tick, clock, chapel, claimed, economy_active);
    }
}

fn step_one_chapel_parish(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    sim_tick: u64,
    clock: &GameClock,
    chapel: &Building,
    residences: &[&Residence],
    economy_active: bool,
) {
    if chapel.kind != "chapel" {
        return;
    }

    let Some(mut chapel_row) = ctx.db.building().id().find(&chapel.id) else {
        return;
    };

    let owner = chapel_row.owner;
    let assigned_labor = chapel_row.assigned_labor;
    let physical_economy = ctx
        .db
        .player_resources()
        .owner()
        .find(&owner)
        .is_some_and(|resources| resources.physical_founding_site_enabled);

    if economy_active {
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

        if physical_economy && assigned_labor > 0 {
            chapel_row.action_cooldown = (chapel_row.action_cooldown - TICK_DT).max(0.0);
        }
        let coffer_balance = chapel_coffer_gold(&chapel_row);
        if assigned_labor > 0 && coffer_balance >= CHAPEL_CHARITY_MIN_COFFER_GOLD {
            if physical_economy {
                if chapel_row.action_cooldown <= 1e-9 {
                    let alms_dispatched = try_chapel_alms_delivery(
                        ctx,
                        tick,
                        clock,
                        &mut chapel_row,
                        residences,
                        chapel_alms_dispatch_amount(),
                    );
                    if alms_dispatched > 1e-9 {
                        chapel_row.action_cooldown = chapel_alms_dispatch_interval_seconds();
                    }
                }
            } else {
                let alms_distributed = distribute_wealth_charity(
                    ctx,
                    &chapel_row,
                    residences,
                    chapel_charity_per_tick(),
                );
                if alms_distributed > 1e-9 {
                    let alms_paid = withdraw_coffer_in_place(&mut chapel_row, alms_distributed);
                    record_parish_ledger(ctx, owner, ParishLedgerKind::Charity, alms_paid);
                }
            }

            if chapel_poor_relief_due(sim_tick)
                && chapel_coffer_gold(&chapel_row) >= CHAPEL_CHARITY_MIN_COFFER_GOLD
            {
                let relief_budget =
                    chapel_coffer_gold(&chapel_row).min(CHAPEL_POOR_RELIEF_GOLD_PER_DISPATCH);
                let relief_spent = try_chapel_poor_relief(
                    ctx,
                    tick,
                    clock,
                    &chapel_row,
                    residences,
                    relief_budget,
                );
                if relief_spent > 1e-9 {
                    let relief_paid = withdraw_coffer_in_place(&mut chapel_row, relief_spent);
                    record_parish_ledger(ctx, owner, ParishLedgerKind::Charity, relief_paid);
                }
            }
        }
    }

    ctx.db.building().id().update(chapel_row);
}

fn try_chapel_alms_delivery(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    chapel: &mut Building,
    residences: &[&Residence],
    amount: f64,
) -> f64 {
    if amount <= 1e-9 {
        return 0.0;
    }
    let mut poorest: Option<&Residence> = None;
    for residence in residences.iter().copied() {
        if residence.population == 0
            || residence.owner != chapel.owner
            || residence.household_wealth >= HOUSEHOLD_MAX_WEALTH - 1e-9
            || tick.residence_disabled_by_fire(ctx, residence.id)
        {
            continue;
        }
        poorest = match poorest {
            None => Some(residence),
            Some(current)
                if residence.household_wealth + 1e-9 < current.household_wealth
                    || ((residence.household_wealth - current.household_wealth).abs() <= 1e-9
                        && residence.id < current.id) =>
            {
                Some(residence)
            }
            other => other,
        };
    }
    let Some(target) = poorest else {
        return 0.0;
    };
    let Some(network) = tick.road_network(chapel.owner) else {
        return 0.0;
    };
    try_start_residence_wealth_trip(
        ctx,
        tick,
        clock,
        &network,
        chapel,
        target,
        TIMBER_DELIVERY_SPEED_MPS,
        TIMBER_DELIVERY_UNLOAD_SEC,
        amount,
    )
}

fn try_chapel_poor_relief(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    chapel: &Building,
    residences: &[&Residence],
    budget: f64,
) -> f64 {
    let marketplaces: Vec<Building> = ctx
        .db
        .building()
        .iter()
        .filter(|building| {
            building.kind == "trading_post"
                && building.construction_complete
                && building.assigned_labor > 0
                && building.owner == chapel.owner
                && !tick.building_disabled_by_fire(ctx, building.id)
        })
        .collect();

    if marketplaces.is_empty() {
        return 0.0;
    }

    ensure_market_state(ctx, chapel.owner);
    let Some(market) = ctx.db.market_state().owner().find(&chapel.owner) else {
        return 0.0;
    };

    let Some(commodity) = best_affordable_food_commodity(
        all_market_food_commodities(),
        budget,
        market.food_price_mult,
    ) else {
        return 0.0;
    };

    let parish_residences: Vec<Residence> = residences
        .iter()
        .copied()
        .filter(|residence| {
            if residence.population == 0 || residence.owner != chapel.owner {
                return false;
            }
            load_needs(ctx, residence.id)
                .iter()
                .find(|need| need.kind == ResidenceNeedKind::Food)
                .is_some_and(|need| service_shortage_warns(need.deficit_ticks))
        })
        .cloned()
        .collect();
    if parish_residences.is_empty() {
        return 0.0;
    }

    let Some(network) = tick.road_network(chapel.owner) else {
        return 0.0;
    };
    let market_refs: Vec<&Building> = marketplaces.iter().collect();
    let market_claims = claim_residences_by_nearest_supplier(
        network,
        &market_refs,
        &parish_residences,
        |_, _, _| true,
    );

    let mut target: Option<&Residence> = None;
    let mut lowest_food = f64::INFINITY;
    let Ok(physical_commodity) = market_food_commodity_kind(commodity) else {
        return 0.0;
    };
    for residence in &parish_residences {
        if !market_claims.contains_key(&residence.id) {
            continue;
        }
        let food_stock = need_stock(&load_needs(ctx, residence.id), ResidenceNeedKind::Food);
        if residence_commodity_delivery_room(residence, physical_commodity) + 1e-6
            < commodity.food_amount
        {
            continue;
        }
        if food_stock + 1e-6 < lowest_food
            || ((food_stock - lowest_food).abs() <= 1e-6
                && target.is_none_or(|current| residence.id < current.id))
        {
            lowest_food = food_stock;
            target = Some(residence);
        }
    }

    let Some(residence) = target else {
        return 0.0;
    };
    let Some(marketplace_id) = market_claims.get(&residence.id).copied() else {
        return 0.0;
    };
    let Some(marketplace) = marketplaces
        .iter()
        .find(|marketplace| marketplace.id == marketplace_id)
    else {
        return 0.0;
    };

    let gold_cost = scaled_gold_cost(commodity.base_gold_cost, market.food_price_mult);
    let dispatch = MarketCaravanDispatch {
        include_abandoned: false,
        priority_residence_id: Some(residence.id),
        exact_load_amount: Some(commodity.food_amount),
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
    ) == Ok(true)
    {
        gold_cost
    } else {
        0.0
    }
}

fn distribute_wealth_charity(
    ctx: &ReducerContext,
    chapel: &Building,
    residences: &[&Residence],
    amount: f64,
) -> f64 {
    let mut poorest: Option<&Residence> = None;
    for residence in residences.iter().copied() {
        if residence.population == 0 || residence.owner != chapel.owner {
            continue;
        }

        poorest = match poorest {
            None => Some(residence),
            Some(current)
                if residence.household_wealth + 1e-9 < current.household_wealth
                    || ((residence.household_wealth - current.household_wealth).abs() <= 1e-9
                        && residence.id < current.id) =>
            {
                Some(residence)
            }
            other => other,
        };
    }

    let Some(target) = poorest else {
        return 0.0;
    };

    credit_residence_wealth(ctx, target.id, amount)
}

#[cfg(test)]
mod tests {
    use super::{chapel_charity_per_tick, chapel_priest_salary_per_tick, chapel_upkeep_per_tick};
    use crate::balance_generated::{
        CHAPEL_CHARITY_GOLD_PER_DAY, CHAPEL_PRIEST_SALARY_GOLD_PER_DAY,
        CHAPEL_UNSTAFFED_UPKEEP_FRACTION, CHAPEL_UPKEEP_GOLD_PER_DAY,
    };
    use crate::chapel_parish_policy::chapel_daily_gold_per_work_tick;

    #[test]
    fn priest_salary_per_tick_matches_balance() {
        let expected = chapel_daily_gold_per_work_tick(CHAPEL_PRIEST_SALARY_GOLD_PER_DAY);
        assert!((chapel_priest_salary_per_tick(1) - expected).abs() < 1e-9);
        assert_eq!(chapel_priest_salary_per_tick(0), 0.0);
    }

    #[test]
    fn upkeep_per_tick_matches_balance() {
        let staffed = chapel_daily_gold_per_work_tick(CHAPEL_UPKEEP_GOLD_PER_DAY);
        let idle = chapel_daily_gold_per_work_tick(
            CHAPEL_UPKEEP_GOLD_PER_DAY * CHAPEL_UNSTAFFED_UPKEEP_FRACTION,
        );
        assert!((chapel_upkeep_per_tick(1) - staffed).abs() < 1e-9);
        assert!((chapel_upkeep_per_tick(0) - idle).abs() < 1e-9);
    }

    #[test]
    fn charity_per_tick_matches_balance() {
        let expected = chapel_daily_gold_per_work_tick(CHAPEL_CHARITY_GOLD_PER_DAY);
        assert!((chapel_charity_per_tick() - expected).abs() < 1e-9);
    }
}
