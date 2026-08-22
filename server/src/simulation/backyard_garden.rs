use spacetimedb::ReducerContext;
use std::collections::HashMap;

use crate::backyard_garden_policy::{
    allocate_backyard_food, backyard_garden_seasonal_multiplier, backyard_interval_food_batch,
    backyard_interval_harvest_due, backyard_month_in_window,
};
use crate::balance_generated::{
    backyard_garden_def, BackyardGardenKind, CALENDAR_SECONDS_PER_DAY, FOOD_SALE_GOLD_PER_UNIT,
    HERB_REMEDIES_PER_PERSON_DAY, HERB_REMEDY_CAPACITY, HERB_REMEDY_SALE_GOLD_PER_UNIT, TICK_DT,
};
use crate::db::*;
use crate::economy::{
    credit_marketplace_receipt_gold, credit_residence_wealth, deposit_building_commodity,
    deposit_residence_commodity, player_economic_activity_tax_rate, residence_edible_food_stock,
    storage_accepts_commodity, taxed_economic_activity, town_hall_tax_collection_multiplier,
    CommodityKind,
};
use crate::season_policy::EnvironmentState;
use crate::simulation::game_calendar::GameClock;
use crate::simulation::labor_and_logistics_paused;
use crate::simulation::residence_needs::food;
use crate::simulation::residence_needs::sync_food_need_rows;
use crate::simulation::residence_needs::ResidenceNeedKind;
use crate::simulation::tick_context::SimTickContext;
use crate::tables::{BackyardGarden, Residence};

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
        // Gardens never claim their own table or worker. Resolve food and goods
        // independently because one extension can produce both: a Goat Pen's
        // milk/meat use its Granary route while its hides use its Storehouse
        // route. Either depot later carts retail stock to its own stall.
        let food_marketplace_id = backyard_has_food_output(kind)
            .then(|| {
                tick.local_marketplace_for_residence_deposit(
                    ctx,
                    garden.owner,
                    residence.id,
                    ResidenceNeedKind::Food,
                )
            })
            .flatten();
        let goods_marketplace_id = backyard_has_goods_output(kind)
            .then(|| {
                tick.local_marketplace_for_residence_deposit(
                    ctx,
                    garden.owner,
                    residence.id,
                    ResidenceNeedKind::Cloth,
                )
            })
            .flatten();
        // Every saleable extension currently earns through exactly one retail
        // channel. Goat hides are an industrial by-product, so the food sale
        // remains the receipt source while the hides follow the goods route.
        let receipt_marketplace_id = if kind == BackyardGardenKind::HerbGarden {
            goods_marketplace_id
        } else {
            food_marketplace_id
        };
        let (tax_rate, collection_multiplier) =
            *tax_policy_by_owner.entry(garden.owner).or_insert_with(|| {
                (
                    player_economic_activity_tax_rate(ctx, garden.owner),
                    town_hall_tax_collection_multiplier(ctx, garden.owner),
                )
            });
        let toll = step_one_garden(
            ctx,
            tick,
            &garden,
            kind,
            &residence,
            food_marketplace_id,
            goods_marketplace_id,
            tax_rate,
            collection_multiplier,
            clock,
            environment,
        );
        if let Some(marketplace_id) = receipt_marketplace_id {
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
    tick: &SimTickContext,
    garden: &BackyardGarden,
    kind: BackyardGardenKind,
    residence: &Residence,
    food_marketplace_id: Option<u64>,
    goods_marketplace_id: Option<u64>,
    tax_rate: f64,
    collection_multiplier: f64,
    clock: &GameClock,
    environment: EnvironmentState,
) -> f64 {
    let def = backyard_garden_def(kind);
    if garden.first_harvest_day > clock.total_days {
        return 0.0;
    }
    if matches!(
        kind,
        BackyardGardenKind::ChickenPen | BackyardGardenKind::GoatPen | BackyardGardenKind::PigPen
    ) {
        return step_livestock_pen(
            ctx,
            tick,
            garden,
            kind,
            residence,
            food_marketplace_id,
            goods_marketplace_id,
            tax_rate,
            collection_multiplier,
            clock,
            environment,
        );
    }
    let population = residence.population as f64;
    let seasonal_multiplier = backyard_garden_seasonal_multiplier(kind, clock.month, environment);
    if seasonal_multiplier <= 1e-9 {
        return 0.0;
    }

    let pollination_multiplier = match kind {
        BackyardGardenKind::AppleOrchard
        | BackyardGardenKind::CherryOrchard
        | BackyardGardenKind::PearOrchard
        | BackyardGardenKind::AroniaOrchard
        | BackyardGardenKind::RosehipOrchard => {
            crate::simulation::expanded_economy::nearby_apiary_pollination_multiplier(
                ctx,
                tick,
                residence.owner,
                residence.x,
                residence.z,
            )
        }
        _ => 1.0,
    };
    let mut market_food_sold = 0.0;
    if def.food_per_person_per_sec > 1e-9 {
        let total_food = def.food_per_person_per_sec
            * population
            * seasonal_multiplier
            * pollination_multiplier
            * TICK_DT;
        let commodity = backyard_food_commodity(kind);
        if let Some(commodity) = commodity {
            market_food_sold += distribute_backyard_food(
                ctx,
                tick,
                residence,
                food_marketplace_id,
                commodity,
                total_food,
            );
        }
    }

    let mut market_remedies_sold = 0.0;
    if kind == BackyardGardenKind::HerbGarden {
        let remedies = population * HERB_REMEDIES_PER_PERSON_DAY * seasonal_multiplier * TICK_DT
            / CALENDAR_SECONDS_PER_DAY;
        let kept_remedies = deposit_herb_remedies(ctx, residence, remedies);
        if let Some(marketplace_id) = goods_marketplace_id {
            market_remedies_sold = deposit_backyard_depot_commodity(
                ctx,
                tick,
                marketplace_id,
                ResidenceNeedKind::Cloth,
                CommodityKind::Remedies,
                (remedies - kept_remedies).max(0.0),
            );
        }
    }

    if def.jam_per_person_per_sec > 1e-9 {
        let jam = population * def.jam_per_person_per_sec * seasonal_multiplier * TICK_DT;
        if let Some(commodity) = backyard_jam_commodity(kind) {
            market_food_sold +=
                distribute_backyard_food(ctx, tick, residence, food_marketplace_id, commodity, jam);
        }
    }

    let economic_activity = market_food_sold * FOOD_SALE_GOLD_PER_UNIT
        + market_remedies_sold * HERB_REMEDY_SALE_GOLD_PER_UNIT;
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

fn backyard_has_food_output(kind: BackyardGardenKind) -> bool {
    backyard_food_commodity(kind).is_some() || backyard_jam_commodity(kind).is_some()
}

fn backyard_has_goods_output(kind: BackyardGardenKind) -> bool {
    matches!(
        kind,
        BackyardGardenKind::HerbGarden | BackyardGardenKind::GoatPen
    )
}

fn backyard_food_commodity(kind: BackyardGardenKind) -> Option<CommodityKind> {
    match kind {
        BackyardGardenKind::AppleOrchard => Some(CommodityKind::Apples),
        BackyardGardenKind::CherryOrchard => Some(CommodityKind::Cherries),
        BackyardGardenKind::PearOrchard => Some(CommodityKind::Pears),
        BackyardGardenKind::AroniaOrchard => Some(CommodityKind::Aronia),
        BackyardGardenKind::RosehipOrchard => Some(CommodityKind::Rosehips),
        BackyardGardenKind::CabbageGarden => Some(CommodityKind::Cabbage),
        BackyardGardenKind::CarrotGarden => Some(CommodityKind::Carrots),
        BackyardGardenKind::BeetrootGarden => Some(CommodityKind::Beetroot),
        BackyardGardenKind::ChickenPen => Some(CommodityKind::Eggs),
        BackyardGardenKind::GoatPen => Some(CommodityKind::Milk),
        BackyardGardenKind::PigPen => Some(CommodityKind::Meat),
        BackyardGardenKind::BackyardApiary => Some(CommodityKind::Honey),
        BackyardGardenKind::FlowerGarden
        | BackyardGardenKind::HerbGarden
        | BackyardGardenKind::Orchard
        | BackyardGardenKind::VegetableGarden
        | BackyardGardenKind::AnimalPen => None,
    }
}

fn backyard_jam_commodity(kind: BackyardGardenKind) -> Option<CommodityKind> {
    match kind {
        BackyardGardenKind::AroniaOrchard => Some(CommodityKind::AroniaJam),
        BackyardGardenKind::RosehipOrchard => Some(CommodityKind::RosehipJam),
        _ => None,
    }
}

fn step_livestock_pen(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    garden: &BackyardGarden,
    kind: BackyardGardenKind,
    residence: &Residence,
    food_marketplace_id: Option<u64>,
    goods_marketplace_id: Option<u64>,
    tax_rate: f64,
    collection_multiplier: f64,
    clock: &GameClock,
    environment: EnvironmentState,
) -> f64 {
    let def = backyard_garden_def(kind);
    let population = residence.population;
    let mut market_food_sold = 0.0;
    let mut primary_collected = false;
    let mut secondary_collected = false;
    let mut hides_collected = 0.0;

    if backyard_interval_harvest_due(
        clock.total_days,
        garden.first_harvest_day,
        garden.last_primary_production_day,
        def.production_interval_days,
        clock.month,
        def.harvest_start_month,
        def.harvest_end_month,
    ) {
        let multiplier = backyard_garden_seasonal_multiplier(kind, clock.month, environment);
        let total_food = backyard_interval_food_batch(
            def.food_per_person_per_sec,
            population,
            def.production_interval_days,
            multiplier,
        );
        if let Some(commodity) = livestock_primary_commodity(kind) {
            market_food_sold += distribute_backyard_food(
                ctx,
                tick,
                residence,
                food_marketplace_id,
                commodity,
                total_food,
            );
        }
        primary_collected = true;
    }

    if def.secondary_production_interval_days > 0
        && backyard_interval_harvest_due(
            clock.total_days,
            garden.first_harvest_day,
            garden.last_secondary_production_day,
            def.secondary_production_interval_days,
            clock.month,
            def.secondary_harvest_start_month,
            def.secondary_harvest_end_month,
        )
    {
        let seasonal_multiplier = if backyard_month_in_window(
            clock.month,
            def.secondary_harvest_start_month,
            def.secondary_harvest_end_month,
        ) {
            def.yield_efficiency
        } else {
            0.0
        };
        let total_food = backyard_interval_food_batch(
            def.secondary_food_per_person_per_sec,
            population,
            def.secondary_production_interval_days,
            seasonal_multiplier,
        );
        market_food_sold += distribute_backyard_food(
            ctx,
            tick,
            residence,
            food_marketplace_id,
            CommodityKind::Meat,
            total_food,
        );
        hides_collected = def.hide_per_person_per_secondary_harvest * population as f64;
        secondary_collected = true;
    }

    if primary_collected || secondary_collected {
        if let Some(mut current) = ctx.db.backyard_garden().id().find(&garden.id) {
            if primary_collected {
                current.last_primary_production_day = clock.total_days;
            }
            if secondary_collected {
                current.last_secondary_production_day = clock.total_days;
                if hides_collected > 1e-9 {
                    current.hide_stock = (current.hide_stock.max(0.0) + hides_collected)
                        .min(def.hide_capacity.max(0.0));
                }
            }
            ctx.db.backyard_garden().id().update(current);
        }
    }

    // Goat hides remain on the household row until the Storehouse that owns a
    // real local goods stall has room. Industry then draws from that depot;
    // Marketplace storage is never used as an upstream warehouse.
    if kind == BackyardGardenKind::GoatPen {
        if let Some(marketplace_id) = goods_marketplace_id {
            transfer_backyard_hides_to_storehouse(ctx, tick, garden.id, marketplace_id);
        }
    }

    if food_marketplace_id.is_none() || market_food_sold <= 1e-9 {
        return 0.0;
    }
    let economic_activity = market_food_sold * FOOD_SALE_GOLD_PER_UNIT;
    let (adjusted, assessed_tax) = taxed_economic_activity(economic_activity, tax_rate);
    let tax = assessed_tax * collection_multiplier;
    let net_wealth = (adjusted - tax).max(0.0);
    if net_wealth > 1e-9 {
        credit_residence_wealth(ctx, residence.id, net_wealth);
    }
    tax
}

fn transfer_backyard_hides_to_storehouse(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    garden_id: u64,
    marketplace_id: u64,
) -> f64 {
    let Some(mut garden) = ctx.db.backyard_garden().id().find(&garden_id) else {
        return 0.0;
    };
    let available = garden.hide_stock.max(0.0);
    if available <= 1e-9 {
        return 0.0;
    }
    let deposited = deposit_backyard_depot_commodity(
        ctx,
        tick,
        marketplace_id,
        ResidenceNeedKind::Cloth,
        CommodityKind::Hides,
        available,
    );
    if deposited > 1e-9 {
        garden.hide_stock = (available - deposited).max(0.0);
        ctx.db.backyard_garden().id().update(garden);
    }
    deposited
}

fn livestock_primary_commodity(kind: BackyardGardenKind) -> Option<CommodityKind> {
    match kind {
        BackyardGardenKind::ChickenPen => Some(CommodityKind::Eggs),
        BackyardGardenKind::GoatPen => Some(CommodityKind::Milk),
        BackyardGardenKind::PigPen => Some(CommodityKind::Meat),
        _ => None,
    }
}

fn distribute_backyard_food(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    residence: &Residence,
    marketplace_id: Option<u64>,
    commodity: CommodityKind,
    total_food: f64,
) -> f64 {
    if total_food <= 1e-9 {
        return 0.0;
    }
    let allocation = allocate_backyard_food(
        total_food,
        marketplace_id.is_some(),
        residence.tier,
        residence.population,
        residence_edible_food_stock(residence),
    );
    let kept = if allocation.self_food > 1e-9 {
        deposit_self_food(ctx, residence.id, commodity, allocation.self_food)
    } else {
        0.0
    };
    let Some(marketplace_id) = marketplace_id else {
        return 0.0;
    };
    let offered = (total_food - kept).max(0.0);
    let sold = deposit_backyard_depot_commodity(
        ctx,
        tick,
        marketplace_id,
        ResidenceNeedKind::Food,
        commodity,
        offered,
    );
    let rejected = (offered - sold).max(0.0);
    if rejected > 1e-9 {
        deposit_self_food(ctx, residence.id, commodity, rejected);
    }
    sold
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

fn deposit_backyard_depot_commodity(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    marketplace_id: u64,
    stall_need: ResidenceNeedKind,
    commodity: CommodityKind,
    amount: f64,
) -> f64 {
    if amount <= 1e-9 {
        return 0.0;
    }
    let Some(marketplace) = ctx.db.building().id().find(&marketplace_id) else {
        return 0.0;
    };
    let Some(depot_id) =
        tick.marketplace_stall_workplace_id_for_deposit(ctx, &marketplace, stall_need)
    else {
        return 0.0;
    };
    let Some(mut depot) = ctx.db.building().id().find(&depot_id) else {
        return 0.0;
    };
    if depot.owner != marketplace.owner
        || !depot.construction_complete
        || depot.assigned_labor == 0
        || tick.building_disabled_by_fire(ctx, depot.id)
        || !storage_accepts_commodity(&depot, commodity)
    {
        return 0.0;
    }
    let deposited = deposit_building_commodity(&mut depot, commodity, amount);
    if deposited > 1e-9 {
        ctx.db.building().id().update(depot);
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
