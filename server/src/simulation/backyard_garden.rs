use spacetimedb::ReducerContext;

use crate::balance_generated::{
    backyard_garden_def, BackyardGardenKind, TICK_DT,
};
use crate::db::*;
use crate::economy::{credit_treasury_gold, credit_residence_wealth, garden_market_activity, player_economic_activity_tax_rate, taxed_economic_activity, town_hall_tax_collection_multiplier};
use crate::simulation::game_calendar::GameClock;
use crate::simulation::labor_and_logistics_paused;
use crate::simulation::landmark_access::residence_has_marketplace_access;
use crate::simulation::residence_needs::food;
use crate::simulation::residence_needs::state::{find_need_mut, load_needs, persist_needs};
use crate::simulation::residence_needs::ResidenceNeedKind;
use crate::simulation::tick_context::SimTickContext;
use crate::tables::{Building, Residence};

pub fn step_backyard_gardens(ctx: &ReducerContext, tick: &SimTickContext, clock: &GameClock) {
    let marketplaces: Vec<Building> = ctx
        .db
        .building()
        .iter()
        .filter(|building| building.kind == "marketplace")
        .collect();

    for garden in ctx.db.backyard_garden().iter() {
        let Some(kind) = BackyardGardenKind::from_id(garden.kind) else {
            continue;
        };
        let Some(residence) = ctx.db.residence().id().find(&garden.residence_id) else {
            continue;
        };
        if labor_and_logistics_paused(ctx, residence.owner, clock) {
            continue;
        }
        if residence.abandoned || residence.population == 0 {
            continue;
        }
        let has_market_access =
            residence_has_marketplace_access(tick, garden.owner, &residence, &marketplaces);
        step_one_garden(ctx, kind, &residence, garden.owner, has_market_access);
    }
}

fn step_one_garden(
    ctx: &ReducerContext,
    kind: BackyardGardenKind,
    residence: &Residence,
    owner: spacetimedb::Identity,
    has_market_access: bool,
) {
    let def = backyard_garden_def(kind);
    let population = residence.population as f64;

    if def.food_per_person_per_sec > 1e-9 {
        let total_food = def.food_per_person_per_sec * population * TICK_DT;
        let self_food = total_food * def.food_self_share.clamp(0.0, 1.0);
        if self_food > 1e-9 {
            deposit_self_food(ctx, residence.id, self_food);
        }
    }

    if !has_market_access {
        return;
    }

    let economic_activity = garden_market_activity(def, population, TICK_DT);
    if economic_activity <= 1e-9 {
        return;
    }

    let tax_rate = player_economic_activity_tax_rate(ctx, owner);
    let (adjusted, assessed_tax) = taxed_economic_activity(economic_activity, tax_rate);
    let tax = assessed_tax * town_hall_tax_collection_multiplier(ctx, owner);
    let net_wealth = (adjusted - tax).max(0.0);
    if net_wealth > 1e-9 {
        credit_residence_wealth(ctx, residence.id, net_wealth);
    }
    if tax > 1e-9 {
        credit_treasury_gold(ctx, owner, tax);
    }
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
    for garden in ctx.db.backyard_garden().residence_id().filter(&residence_id) {
        ctx.db.backyard_garden().id().delete(garden.id);
    }
}
