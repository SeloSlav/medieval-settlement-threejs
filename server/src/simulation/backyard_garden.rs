use spacetimedb::ReducerContext;
use std::collections::HashMap;

use crate::backyard_garden_policy::backyard_garden_seasonal_multiplier;
use crate::balance_generated::{
    backyard_garden_def, BackyardGardenKind, CALENDAR_SECONDS_PER_DAY,
    HERB_REMEDIES_PER_PERSON_DAY, HERB_REMEDY_CAPACITY, TICK_DT,
};
use crate::db::*;
use crate::economy::{
    credit_marketplace_receipt_gold, credit_residence_wealth, garden_market_activity,
    player_economic_activity_tax_rate, taxed_economic_activity,
    town_hall_tax_collection_multiplier,
};
use crate::residence_service_policy::service_economic_multiplier;
use crate::season_policy::EnvironmentState;
use crate::simulation::game_calendar::GameClock;
use crate::simulation::labor_and_logistics_paused;
use crate::simulation::residence_needs::food;
use crate::simulation::residence_needs::state::{find_need_mut, load_needs, persist_needs};
use crate::simulation::residence_needs::ResidenceNeedKind;
use crate::simulation::tick_context::SimTickContext;
use crate::tables::Residence;

pub fn step_backyard_gardens(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    environment: EnvironmentState,
) {
    // The tick context builds one exact nearest-market road territory per
    // owner and shares it with household emergency orders. Aggregate tolls so
    // a large town still updates each physical market coffer only once.
    let mut tax_policy_by_owner: HashMap<spacetimedb::Identity, (f64, f64)> = HashMap::new();
    let mut market_tolls_by_market: HashMap<u64, f64> = HashMap::new();
    for garden in ctx.db.backyard_garden().iter() {
        let Some(kind) = BackyardGardenKind::from_id(garden.kind) else {
            continue;
        };
        let Some(residence) = ctx.db.residence().id().find(&garden.residence_id) else {
            continue;
        };
        if labor_and_logistics_paused(ctx, tick, residence.owner, clock) {
            continue;
        }
        if residence.population == 0 || tick.residence_disabled_by_fire(ctx, residence.id) {
            continue;
        }
        let marketplace_id = tick.marketplace_for_residence(ctx, garden.owner, residence.id);
        let (tax_rate, collection_multiplier) =
            *tax_policy_by_owner.entry(garden.owner).or_insert_with(|| {
                (
                    player_economic_activity_tax_rate(ctx, garden.owner),
                    town_hall_tax_collection_multiplier(ctx, garden.owner),
                )
            });
        let toll = step_one_garden(
            ctx,
            kind,
            &residence,
            marketplace_id.is_some(),
            tax_rate,
            collection_multiplier,
            clock,
            environment,
        );
        if let Some(marketplace_id) = marketplace_id {
            if toll > 1e-9 {
                *market_tolls_by_market.entry(marketplace_id).or_default() += toll;
            }
        }
    }

    let mut market_tolls: Vec<(u64, f64)> = market_tolls_by_market.into_iter().collect();
    market_tolls.sort_by_key(|(marketplace_id, _)| *marketplace_id);
    for (marketplace_id, toll) in market_tolls {
        let Some(mut marketplace) = ctx.db.building().id().find(&marketplace_id) else {
            continue;
        };
        credit_marketplace_receipt_gold(ctx, &mut marketplace, toll);
        ctx.db.building().id().update(marketplace);
    }
}

fn step_one_garden(
    ctx: &ReducerContext,
    kind: BackyardGardenKind,
    residence: &Residence,
    has_market_access: bool,
    tax_rate: f64,
    collection_multiplier: f64,
    clock: &GameClock,
    environment: EnvironmentState,
) -> f64 {
    let def = backyard_garden_def(kind);
    let population = residence.population as f64;
    let seasonal_multiplier = backyard_garden_seasonal_multiplier(kind, clock.month, environment);
    if seasonal_multiplier <= 1e-9 {
        return 0.0;
    }

    if def.food_per_person_per_sec > 1e-9 {
        let total_food = def.food_per_person_per_sec * population * seasonal_multiplier * TICK_DT;
        let self_food = total_food * def.food_self_share.clamp(0.0, 1.0);
        if self_food > 1e-9 {
            deposit_self_food(ctx, residence.id, self_food);
        }
    }

    if kind == BackyardGardenKind::HerbGarden {
        deposit_herb_remedies(
            ctx,
            residence,
            population * HERB_REMEDIES_PER_PERSON_DAY * seasonal_multiplier * TICK_DT
                / CALENDAR_SECONDS_PER_DAY,
        );
    }

    if !has_market_access {
        return 0.0;
    }

    let max_service_deficit = load_needs(ctx, residence.id)
        .into_iter()
        .filter(|need| need.kind.is_active_for_tier(residence.tier))
        .map(|need| need.deficit_ticks)
        .max()
        .unwrap_or(0);
    let satisfaction_multiplier = service_economic_multiplier(max_service_deficit);
    let economic_activity = garden_market_activity(def, population, TICK_DT)
        * seasonal_multiplier
        * satisfaction_multiplier;
    if economic_activity <= 1e-9 {
        return 0.0;
    }

    let (adjusted, assessed_tax) = taxed_economic_activity(economic_activity, tax_rate);
    let tax = assessed_tax * collection_multiplier;
    let net_wealth = (adjusted - tax).max(0.0);
    if net_wealth > 1e-9 {
        credit_residence_wealth(ctx, residence.id, net_wealth);
    }
    tax
}

fn deposit_herb_remedies(ctx: &ReducerContext, residence: &Residence, amount: f64) {
    if amount <= 1e-9 {
        return;
    }
    let Some(mut current) = ctx.db.residence().id().find(&residence.id) else {
        return;
    };
    current.remedy_stock = (current.remedy_stock + amount).min(HERB_REMEDY_CAPACITY);
    ctx.db.residence().id().update(current);
}

fn deposit_self_food(ctx: &ReducerContext, residence_id: u64, amount: f64) {
    if amount <= 1e-9 {
        return;
    }

    let mut needs = load_needs(ctx, residence_id);
    let Some(need) = find_need_mut(&mut needs, ResidenceNeedKind::Food) else {
        return;
    };

    let cap = food::stock_capacity();
    let deposited = amount.min((cap - need.stock).max(0.0));
    if deposited <= 1e-9 {
        return;
    }

    *need = food::apply_delivery(need, deposited);
    persist_needs(ctx, residence_id, &needs);
}

pub fn clear_backyard_garden_for_residence(ctx: &ReducerContext, residence_id: u64) {
    for garden in ctx
        .db
        .backyard_garden()
        .residence_id()
        .filter(&residence_id)
    {
        ctx.db.backyard_garden().id().delete(garden.id);
    }
}
