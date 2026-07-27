use spacetimedb::ReducerContext;
use std::collections::{HashMap, HashSet};

use crate::backyard_garden_policy::backyard_garden_seasonal_multiplier;
use crate::balance_generated::{backyard_garden_def, BackyardGardenKind, TICK_DT};
use crate::db::*;
use crate::economy::{
    credit_residence_wealth, credit_treasury_gold, garden_market_activity,
    player_economic_activity_tax_rate, taxed_economic_activity,
    town_hall_tax_collection_multiplier,
};
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
    // Backyard trade needs only road connectivity, not a shortest route. Cache
    // each owner's complete set of market-bearing components once so the
    // garden pass scales with gardens + markets instead of gardens x markets.
    let mut marketplace_components_by_owner: HashMap<spacetimedb::Identity, HashSet<u32>> =
        HashMap::new();
    for marketplace in ctx
        .db
        .building()
        .iter()
        .filter(|building| building.kind == "marketplace" && building.construction_complete)
    {
        let Some(network) = tick.road_network(marketplace.owner) else {
            continue;
        };
        marketplace_components_by_owner
            .entry(marketplace.owner)
            .or_default()
            .extend(network.road_components_at(marketplace.x, marketplace.z));
    }

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
        if residence.abandoned || residence.population == 0 {
            continue;
        }
        let has_market_access = tick
            .road_network(garden.owner)
            .zip(marketplace_components_by_owner.get(&garden.owner))
            .is_some_and(|(network, market_components)| {
                network.has_any_road_component_at(residence.x, residence.z, market_components)
            });
        step_one_garden(
            ctx,
            kind,
            &residence,
            garden.owner,
            has_market_access,
            clock,
            environment,
        );
    }
}

fn step_one_garden(
    ctx: &ReducerContext,
    kind: BackyardGardenKind,
    residence: &Residence,
    owner: spacetimedb::Identity,
    has_market_access: bool,
    clock: &GameClock,
    environment: EnvironmentState,
) {
    let def = backyard_garden_def(kind);
    let population = residence.population as f64;
    let seasonal_multiplier = backyard_garden_seasonal_multiplier(kind, clock.month, environment);
    if seasonal_multiplier <= 1e-9 {
        return;
    }

    if def.food_per_person_per_sec > 1e-9 {
        let total_food = def.food_per_person_per_sec * population * seasonal_multiplier * TICK_DT;
        let self_food = total_food * def.food_self_share.clamp(0.0, 1.0);
        if self_food > 1e-9 {
            deposit_self_food(ctx, residence.id, self_food);
        }
    }

    if !has_market_access {
        return;
    }

    let economic_activity = garden_market_activity(def, population, TICK_DT) * seasonal_multiplier;
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
    for garden in ctx
        .db
        .backyard_garden()
        .residence_id()
        .filter(&residence_id)
    {
        ctx.db.backyard_garden().id().delete(garden.id);
    }
}
