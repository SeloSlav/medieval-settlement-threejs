use spacetimedb::ReducerContext;
use std::collections::HashMap;

use crate::backyard_garden_policy::backyard_garden_seasonal_multiplier;
use crate::balance_generated::{
    backyard_garden_def, BackyardGardenKind, CALENDAR_SECONDS_PER_DAY,
    FOOD_SALE_GOLD_PER_UNIT, HERB_REMEDIES_PER_PERSON_DAY, HERB_REMEDY_CAPACITY, TICK_DT,
};
use crate::db::*;
use crate::economy::{
    credit_marketplace_receipt_gold, credit_residence_wealth, deposit_building_commodity,
    deposit_residence_commodity, player_economic_activity_tax_rate, taxed_economic_activity,
    town_hall_tax_collection_multiplier, CommodityKind,
};
use crate::residence_service_policy::service_economic_multiplier;
use crate::season_policy::EnvironmentState;
use crate::simulation::game_calendar::GameClock;
use crate::simulation::labor_and_logistics_paused;
use crate::simulation::residence_needs::food;
use crate::simulation::residence_needs::state::load_needs;
use crate::simulation::residence_needs::sync_food_need_rows;
use crate::simulation::residence_needs::ResidenceNeedKind;
use crate::simulation::tick_context::SimTickContext;
use crate::tables::Residence;

pub fn step_backyard_gardens(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    environment: EnvironmentState,
) {
    // The tick context builds one exact local-market road territory per owner.
    // Aggregate tolls so a large town updates each physical market coffer once.
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
        let stall_need = if backyard_food_commodity(kind).is_some() {
            ResidenceNeedKind::Food
        } else {
            ResidenceNeedKind::Cloth
        };
        let marketplace_id = tick.local_marketplace_for_residence(
            ctx,
            garden.owner,
            residence.id,
            stall_need,
        );
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
            marketplace_id,
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
    marketplace_id: Option<u64>,
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

    let mut market_food_sold = 0.0;
    if def.food_per_person_per_sec > 1e-9 {
        let total_food = def.food_per_person_per_sec * population * seasonal_multiplier * TICK_DT;
        let self_share = if marketplace_id.is_some() {
            def.food_self_share.clamp(0.0, 1.0)
        } else {
            1.0
        };
        let self_food = total_food * self_share;
        let commodity = backyard_food_commodity(kind);
        if self_food > 1e-9 {
            if let Some(commodity) = commodity {
                deposit_self_food(ctx, residence.id, commodity, self_food);
            }
        }
        if let (Some(marketplace_id), Some(commodity)) = (marketplace_id, commodity) {
            let market_food = (total_food - self_food).max(0.0);
            if market_food > 1e-9 {
                market_food_sold =
                    deposit_market_commodity(ctx, marketplace_id, commodity, market_food);
            }
        }
    }

    if kind == BackyardGardenKind::HerbGarden {
        let remedies =
            population * HERB_REMEDIES_PER_PERSON_DAY * seasonal_multiplier * TICK_DT
                / CALENDAR_SECONDS_PER_DAY;
        let kept_remedies = deposit_herb_remedies(
            ctx,
            residence,
            remedies,
        );
        if let Some(marketplace_id) = marketplace_id {
            deposit_market_commodity(
                ctx,
                marketplace_id,
                CommodityKind::Remedies,
                (remedies - kept_remedies).max(0.0),
            );
        }
    }

    if marketplace_id.is_none() {
        return 0.0;
    }

    let max_service_deficit = load_needs(ctx, residence.id)
        .into_iter()
        .filter(|need| need.kind.is_active_for_tier(residence.tier))
        .map(|need| need.deficit_ticks)
        .max()
        .unwrap_or(0);
    let satisfaction_multiplier = service_economic_multiplier(max_service_deficit);
    let economic_activity = (
        def.gold_per_person_per_sec * population * TICK_DT * seasonal_multiplier
            + market_food_sold * FOOD_SALE_GOLD_PER_UNIT
    ) * satisfaction_multiplier;
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

fn deposit_herb_remedies(ctx: &ReducerContext, residence: &Residence, amount: f64) -> f64 {
    if amount <= 1e-9 {
        return 0.0;
    }
    let Some(mut current) = ctx.db.residence().id().find(&residence.id) else {
        return 0.0;
    };
    let before = current.remedy_stock;
    current.remedy_stock = (before + amount).min(HERB_REMEDY_CAPACITY);
    let deposited = (current.remedy_stock - before).max(0.0);
    ctx.db.residence().id().update(current);
    deposited
}

fn backyard_food_commodity(kind: BackyardGardenKind) -> Option<CommodityKind> {
    match kind {
        BackyardGardenKind::AppleOrchard => Some(CommodityKind::Apples),
        BackyardGardenKind::CherryOrchard => Some(CommodityKind::Cherries),
        BackyardGardenKind::VegetableGarden => Some(CommodityKind::Vegetables),
        BackyardGardenKind::HenYard => Some(CommodityKind::Eggs),
        BackyardGardenKind::FlowerGarden | BackyardGardenKind::HerbGarden => None,
    }
}

fn deposit_self_food(
    ctx: &ReducerContext,
    residence_id: u64,
    commodity: CommodityKind,
    amount: f64,
) -> f64 {
    if amount <= 1e-9 {
        return 0.0;
    }
    let Some(mut residence) = ctx.db.residence().id().find(&residence_id) else {
        return 0.0;
    };
    let deposited = deposit_residence_commodity(
        &mut residence,
        commodity,
        amount,
        food::stock_capacity(),
        crate::simulation::residence_needs::provisions::stock_capacity(
            ResidenceNeedKind::PreservedFood,
        ),
    );
    if deposited <= 1e-9 {
        return 0.0;
    }
    ctx.db.residence().id().update(residence.clone());
    sync_food_need_rows(ctx, &residence);
    deposited
}

fn deposit_market_commodity(
    ctx: &ReducerContext,
    marketplace_id: u64,
    commodity: CommodityKind,
    amount: f64,
) -> f64 {
    let Some(mut marketplace) = ctx.db.building().id().find(&marketplace_id) else {
        return 0.0;
    };
    let deposited = deposit_building_commodity(&mut marketplace, commodity, amount);
    if deposited > 1e-9 {
        ctx.db.building().id().update(marketplace);
    }
    deposited
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
