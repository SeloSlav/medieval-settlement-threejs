use spacetimedb::ReducerContext;
use std::collections::HashMap;

use crate::backyard_garden_policy::{
    allocate_backyard_food, backyard_garden_seasonal_multiplier, backyard_interval_food_batch,
    backyard_interval_harvest_due, backyard_month_in_window, split_backyard_orchard_harvest,
};
use crate::balance_generated::{
    backyard_garden_def, BackyardGardenKind, FOOD_SALE_GOLD_PER_UNIT, HERB_REMEDIES_PER_PERSON_DAY,
    HERB_REMEDY_CAPACITY, HERB_REMEDY_SALE_GOLD_PER_UNIT,
};
use crate::db::*;
use crate::economy::{
    credit_marketplace_receipt_gold, credit_residence_wealth, deposit_building_commodity,
    deposit_residence_commodity, residence_edible_food_stock,
    settlement_economic_activity_tax_rate, settlement_town_hall_tax_collection_multiplier,
    storage_accepts_commodity, taxed_economic_activity, CommodityKind,
};
use crate::resident_welfare_policy::deterministic_unit;
use crate::resource_units::{whole_cost, whole_units};
use crate::season_policy::EnvironmentState;
use crate::simulation::game_calendar::GameClock;
use crate::simulation::labor_and_logistics_paused;
use crate::simulation::residence_needs::food;
use crate::simulation::residence_needs::sync_food_need_rows;
use crate::simulation::residence_needs::ResidenceNeedKind;
use crate::simulation::tick_context::SimTickContext;
use crate::smallholding_policy::smallholding_backyard_productivity_multiplier;
use crate::tables::{BackyardGarden, Residence};

/// Plant plots are collected as one physical monthly basket. Their authored
/// per-second yields remain tuning rates only; no sub-unit food is ever placed
/// in a pantry or depot between collections.
const BACKYARD_PLANT_PRODUCTION_INTERVAL_DAYS: u64 = 30;

#[derive(Clone, Copy, Debug, Default)]
struct BackyardFoodCommit {
    market_sold: f64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct WholeSaleReceipt {
    producer_income: f64,
    local_tax: f64,
}

/// Realize an authored sale as indivisible coins, then assign every realized
/// coin exactly once. Revenue is rounded down because a buyer cannot tender a
/// fraction of a coin; the assessed tax is a cost and therefore rounds up.
fn split_whole_sale_receipt(
    base_activity: f64,
    tax_rate: f64,
    collection_multiplier: f64,
) -> WholeSaleReceipt {
    let (adjusted, assessed_tax) = taxed_economic_activity(base_activity, tax_rate);
    let gross = whole_units(adjusted);
    if gross < 1.0 {
        return WholeSaleReceipt::default();
    }
    let local_tax = whole_cost(assessed_tax * collection_multiplier.clamp(0.0, 1.0)).min(gross);
    WholeSaleReceipt {
        producer_income: gross - local_tax,
        local_tax,
    }
}

pub fn step_backyard_gardens(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    environment: EnvironmentState,
) {
    // The tick context builds one exact local-market road territory per owner.
    // Aggregate tolls so a large town updates each physical market coffer once.
    let mut tax_policy_by_town: HashMap<(spacetimedb::Identity, u64), (f64, f64)> = HashMap::new();
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
        let (tax_rate, collection_multiplier) = *tax_policy_by_town
            .entry((garden.owner, residence.settlement_id))
            .or_insert_with(|| {
                (
                    settlement_economic_activity_tax_rate(
                        ctx,
                        garden.owner,
                        residence.settlement_id,
                    ),
                    settlement_town_hall_tax_collection_multiplier(
                        ctx,
                        garden.owner,
                        residence.settlement_id,
                    ),
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
    if kind == BackyardGardenKind::BackyardApiary {
        if let Some(marketplace_id) = goods_marketplace_id {
            transfer_backyard_wax_to_storehouse(ctx, tick, garden.id, marketplace_id);
        }
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
    if !backyard_interval_harvest_due(
        clock.total_days,
        garden.first_harvest_day,
        garden.last_primary_production_day,
        BACKYARD_PLANT_PRODUCTION_INTERVAL_DAYS,
        clock.month,
        plant_harvest_start_month(kind),
        plant_harvest_end_month(kind),
    ) {
        return 0.0;
    }

    let population = residence.population;
    let productivity_multiplier =
        smallholding_backyard_productivity_multiplier(residence.smallholding);
    let seasonal_multiplier = backyard_garden_seasonal_multiplier(kind, clock.month, environment)
        * productivity_multiplier;
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
    let gross_expected = backyard_interval_food_batch(
        def.food_per_person_per_sec,
        population,
        BACKYARD_PLANT_PRODUCTION_INTERVAL_DAYS,
        seasonal_multiplier * pollination_multiplier,
    );
    let gross_food = discrete_expected_units(
        gross_expected,
        garden.id,
        clock.total_days,
        0x4241_434b_5941_5244,
    );
    let jam_expected = backyard_interval_food_batch(
        def.jam_per_person_per_sec,
        population,
        BACKYARD_PLANT_PRODUCTION_INTERVAL_DAYS,
        seasonal_multiplier * pollination_multiplier,
    );
    let jam_share = if gross_expected > 1e-9 {
        (jam_expected / gross_expected).clamp(0.0, 1.0)
    } else {
        0.0
    };
    let jam = discrete_expected_units(
        gross_food * jam_share,
        garden.id,
        clock.total_days,
        0x4a41_4d,
    )
    .min(gross_food);
    let orchard_harvest = split_backyard_orchard_harvest(gross_food, jam);

    let mut food_batches = Vec::with_capacity(2);
    if let Some(commodity) = backyard_food_commodity(kind) {
        food_batches.push((commodity, orchard_harvest.fresh_fruit));
    }
    if let Some(commodity) = backyard_jam_commodity(kind) {
        food_batches.push((commodity, orchard_harvest.jam));
    }

    let food_commit = if food_batches.is_empty() {
        Some(BackyardFoodCommit::default())
    } else {
        try_distribute_backyard_food_batches(
            ctx,
            tick,
            residence,
            food_marketplace_id,
            &food_batches,
        )
    };

    let remedies_expected = if kind == BackyardGardenKind::HerbGarden {
        population as f64
            * HERB_REMEDIES_PER_PERSON_DAY
            * seasonal_multiplier
            * BACKYARD_PLANT_PRODUCTION_INTERVAL_DAYS as f64
    } else {
        0.0
    };
    let remedies =
        discrete_expected_units(remedies_expected, garden.id, clock.total_days, 0x4845_5242);
    let remedies_commit = if kind == BackyardGardenKind::HerbGarden {
        try_distribute_backyard_remedies(ctx, tick, residence, goods_marketplace_id, remedies)
    } else {
        Some(0.0)
    };

    let (Some(food_commit), Some(market_remedies_sold)) = (food_commit, remedies_commit) else {
        // Keep the collection clock due so the complete basket can be retried
        // after pantry/depot space becomes available. No partial lot committed.
        return 0.0;
    };
    if kind == BackyardGardenKind::BackyardApiary && gross_food >= 1.0 {
        collect_backyard_apiary_wax(ctx, garden.id, clock, productivity_multiplier);
    }
    mark_backyard_primary_production_day(ctx, garden.id, clock.total_days);
    if kind == BackyardGardenKind::BackyardApiary {
        if let Some(marketplace_id) = goods_marketplace_id {
            transfer_backyard_wax_to_storehouse(ctx, tick, garden.id, marketplace_id);
        }
    }
    let market_food_sold = food_commit.market_sold;

    let economic_activity = market_food_sold * FOOD_SALE_GOLD_PER_UNIT
        + market_remedies_sold * HERB_REMEDY_SALE_GOLD_PER_UNIT;
    if economic_activity <= 1e-9 {
        return 0.0;
    }

    let receipt = split_whole_sale_receipt(economic_activity, tax_rate, collection_multiplier);
    if receipt.producer_income >= 1.0 {
        credit_residence_wealth(ctx, residence.id, receipt.producer_income);
    }
    receipt.local_tax
}

fn backyard_has_food_output(kind: BackyardGardenKind) -> bool {
    backyard_food_commodity(kind).is_some() || backyard_jam_commodity(kind).is_some()
}

fn backyard_has_goods_output(kind: BackyardGardenKind) -> bool {
    matches!(
        kind,
        BackyardGardenKind::HerbGarden
            | BackyardGardenKind::GoatPen
            | BackyardGardenKind::BackyardApiary
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
    let productivity_multiplier =
        smallholding_backyard_productivity_multiplier(residence.smallholding);
    let mut market_food_sold = 0.0;

    // Empty the pen's existing whole-hide lot before deciding whether a new
    // cull can fit. The transfer itself remains all-or-nothing per whole unit.
    if kind == BackyardGardenKind::GoatPen {
        if let Some(marketplace_id) = goods_marketplace_id {
            transfer_backyard_hides_to_storehouse(ctx, tick, garden.id, marketplace_id);
        }
    }

    if backyard_interval_harvest_due(
        clock.total_days,
        garden.first_harvest_day,
        garden.last_primary_production_day,
        def.production_interval_days,
        clock.month,
        def.harvest_start_month,
        def.harvest_end_month,
    ) {
        let multiplier = backyard_garden_seasonal_multiplier(kind, clock.month, environment)
            * productivity_multiplier;
        let expected_food = backyard_interval_food_batch(
            def.food_per_person_per_sec,
            population,
            def.production_interval_days,
            multiplier,
        );
        let total_food = discrete_expected_units(
            expected_food,
            garden.id,
            clock.total_days,
            0x5052_494d_4152_59,
        );
        if let Some(commodity) = livestock_primary_commodity(kind) {
            if let Some(commit) = try_distribute_backyard_food_batches(
                ctx,
                tick,
                residence,
                food_marketplace_id,
                &[(commodity, total_food)],
            ) {
                market_food_sold += commit.market_sold;
                mark_backyard_primary_production_day(ctx, garden.id, clock.total_days);
            }
        }
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
            def.yield_efficiency * productivity_multiplier
        } else {
            0.0
        };
        let expected_food = backyard_interval_food_batch(
            def.secondary_food_per_person_per_sec,
            population,
            def.secondary_production_interval_days,
            seasonal_multiplier,
        );
        let total_food = discrete_expected_units(
            expected_food,
            garden.id,
            clock.total_days,
            0x5345_434f_4e44_4152,
        );
        let hides_collected = discrete_expected_units(
            def.hide_per_person_per_secondary_harvest * population as f64 * productivity_multiplier,
            garden.id,
            clock.total_days,
            0x4849_4445_53,
        );
        if let Some(mut current) = ctx.db.backyard_garden().id().find(&garden.id) {
            current.hide_stock = whole_units(current.hide_stock);
            let hide_room = (whole_units(def.hide_capacity) - current.hide_stock).max(0.0);
            if hides_collected <= hide_room + 1e-9 {
                if let Some(commit) = try_distribute_backyard_food_batches(
                    ctx,
                    tick,
                    residence,
                    food_marketplace_id,
                    &[(CommodityKind::Meat, total_food)],
                ) {
                    market_food_sold += commit.market_sold;
                    current.hide_stock += hides_collected;
                    current.last_secondary_production_day = clock.total_days;
                    ctx.db.backyard_garden().id().update(current);
                }
            }
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
    let receipt = split_whole_sale_receipt(economic_activity, tax_rate, collection_multiplier);
    if receipt.producer_income >= 1.0 {
        credit_residence_wealth(ctx, residence.id, receipt.producer_income);
    }
    receipt.local_tax
}

fn transfer_backyard_hides_to_storehouse(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    garden_id: u64,
    marketplace_id: u64,
) -> f64 {
    transfer_backyard_stored_material_to_storehouse(
        ctx,
        tick,
        garden_id,
        marketplace_id,
        CommodityKind::Hides,
    )
}

fn transfer_backyard_wax_to_storehouse(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    garden_id: u64,
    marketplace_id: u64,
) -> f64 {
    transfer_backyard_stored_material_to_storehouse(
        ctx,
        tick,
        garden_id,
        marketplace_id,
        CommodityKind::Wax,
    )
}

fn transfer_backyard_stored_material_to_storehouse(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    garden_id: u64,
    marketplace_id: u64,
    commodity: CommodityKind,
) -> f64 {
    let Some(mut garden) = ctx.db.backyard_garden().id().find(&garden_id) else {
        return 0.0;
    };
    let available = match commodity {
        CommodityKind::Hides => {
            garden.hide_stock = whole_units(garden.hide_stock);
            garden.hide_stock
        }
        CommodityKind::Wax => {
            garden.wax_stock = whole_units(garden.wax_stock);
            garden.wax_stock
        }
        _ => return 0.0,
    };
    if available <= 1e-9 {
        return 0.0;
    }
    let deposited = deposit_backyard_depot_commodity(
        ctx,
        tick,
        marketplace_id,
        ResidenceNeedKind::Cloth,
        commodity,
        available,
    );
    if deposited > 1e-9 {
        match commodity {
            CommodityKind::Hides => garden.hide_stock = (available - deposited).max(0.0),
            CommodityKind::Wax => garden.wax_stock = (available - deposited).max(0.0),
            _ => unreachable!("unsupported backyard stored material"),
        }
        ctx.db.backyard_garden().id().update(garden);
    }
    deposited
}

/// Beeswax is collected only alongside a real whole-unit honey harvest. Its
/// lower-frequency clock remains due while the household shelf is full, but a
/// blocked by-product never prevents the primary honey basket from resolving.
fn collect_backyard_apiary_wax(
    ctx: &ReducerContext,
    garden_id: u64,
    clock: &GameClock,
    productivity_multiplier: f64,
) {
    let Some(mut garden) = ctx.db.backyard_garden().id().find(&garden_id) else {
        return;
    };
    let def = backyard_garden_def(BackyardGardenKind::BackyardApiary);
    if !backyard_interval_harvest_due(
        clock.total_days,
        garden.first_harvest_day,
        garden.last_secondary_production_day,
        def.secondary_production_interval_days,
        clock.month,
        def.secondary_harvest_start_month,
        def.secondary_harvest_end_month,
    ) {
        return;
    }

    let Some(next_wax_stock) = bounded_backyard_wax_stock(
        garden.wax_stock,
        def.wax_capacity,
        def.wax_per_secondary_harvest * productivity_multiplier,
    ) else {
        return;
    };
    garden.wax_stock = next_wax_stock;
    garden.last_secondary_production_day = clock.total_days;
    ctx.db.backyard_garden().id().update(garden);
}

fn bounded_backyard_wax_stock(current_stock: f64, capacity: f64, batch: f64) -> Option<f64> {
    let current_stock = whole_units(current_stock);
    let capacity = whole_units(capacity);
    let batch = whole_units(batch);
    let room = (capacity - current_stock).max(0.0);
    (batch >= 1.0 && batch <= room + 1e-9).then_some(current_stock + batch)
}

fn livestock_primary_commodity(kind: BackyardGardenKind) -> Option<CommodityKind> {
    match kind {
        BackyardGardenKind::ChickenPen => Some(CommodityKind::Eggs),
        BackyardGardenKind::GoatPen => Some(CommodityKind::Milk),
        BackyardGardenKind::PigPen => Some(CommodityKind::Meat),
        _ => None,
    }
}

/// Preflights every output in a collection against cloned pantry/depot state,
/// then commits the complete whole-unit basket together. A full destination
/// prevents the harvest clock from advancing and cannot create partial goods.
fn try_distribute_backyard_food_batches(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    residence: &Residence,
    marketplace_id: Option<u64>,
    batches: &[(CommodityKind, f64)],
) -> Option<BackyardFoodCommit> {
    let mut pantry = ctx.db.residence().id().find(&residence.id)?;
    let mut depot = marketplace_id
        .and_then(|marketplace_id| {
            backyard_depot(ctx, tick, marketplace_id, ResidenceNeedKind::Food)
        })
        .filter(|candidate| {
            batches
                .iter()
                .all(|(commodity, _)| storage_accepts_commodity(candidate, *commodity))
        });
    let has_market = depot.is_some();
    let mut market_sold = 0.0;

    for (commodity, authored_amount) in batches {
        let amount = whole_units(*authored_amount);
        if amount < 1.0 {
            continue;
        }
        let allocation = allocate_backyard_food(
            amount,
            has_market,
            pantry.tier,
            pantry.population,
            residence_edible_food_stock(&pantry),
        );
        let requested_self = if has_market {
            whole_units(allocation.self_food).min(amount)
        } else {
            amount
        };
        let kept = deposit_residence_commodity(
            &mut pantry,
            *commodity,
            requested_self,
            food::stock_capacity(),
            crate::simulation::residence_needs::provisions::stock_capacity(
                ResidenceNeedKind::SavoryPreserves,
            ),
        );
        let mut remaining = (amount - kept).max(0.0);
        if let Some(candidate) = depot.as_mut() {
            let sold = deposit_building_commodity(candidate, *commodity, remaining);
            market_sold += sold;
            remaining = (remaining - sold).max(0.0);
        }
        if remaining >= 1.0 {
            let recovered = deposit_residence_commodity(
                &mut pantry,
                *commodity,
                remaining,
                food::stock_capacity(),
                crate::simulation::residence_needs::provisions::stock_capacity(
                    ResidenceNeedKind::SavoryPreserves,
                ),
            );
            remaining = (remaining - recovered).max(0.0);
        }
        if remaining >= 1.0 {
            return None;
        }
    }

    ctx.db.residence().id().update(pantry.clone());
    sync_food_need_rows(ctx, &pantry);
    if let Some(depot) = depot {
        ctx.db.building().id().update(depot);
    }
    Some(BackyardFoodCommit { market_sold })
}

fn try_distribute_backyard_remedies(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    residence: &Residence,
    marketplace_id: Option<u64>,
    authored_amount: f64,
) -> Option<f64> {
    let amount = whole_units(authored_amount);
    if amount < 1.0 {
        return Some(0.0);
    }
    let mut pantry = ctx.db.residence().id().find(&residence.id)?;
    pantry.remedy_stock = whole_units(pantry.remedy_stock);
    let remedy_room = (whole_units(HERB_REMEDY_CAPACITY) - pantry.remedy_stock).max(0.0);
    let kept = amount.min(remedy_room);
    pantry.remedy_stock += kept;
    let offered = (amount - kept).max(0.0);

    let mut depot = marketplace_id
        .and_then(|marketplace_id| {
            backyard_depot(ctx, tick, marketplace_id, ResidenceNeedKind::Cloth)
        })
        .filter(|candidate| storage_accepts_commodity(candidate, CommodityKind::Remedies));
    let sold = depot
        .as_mut()
        .map(|candidate| deposit_building_commodity(candidate, CommodityKind::Remedies, offered))
        .unwrap_or(0.0);
    if offered - sold >= 1.0 {
        return None;
    }

    ctx.db.residence().id().update(pantry);
    if let Some(depot) = depot {
        if sold >= 1.0 {
            ctx.db.building().id().update(depot);
        }
    }
    Some(sold)
}

fn backyard_depot(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    marketplace_id: u64,
    stall_need: ResidenceNeedKind,
) -> Option<crate::tables::Building> {
    let marketplace = ctx.db.building().id().find(&marketplace_id)?;
    let depot_id =
        tick.marketplace_stall_workplace_id_for_deposit(ctx, &marketplace, stall_need)?;
    let depot = ctx.db.building().id().find(&depot_id)?;
    (depot.owner == marketplace.owner
        && depot.construction_complete
        && depot.assigned_labor > 0
        && !tick.building_disabled_by_fire(ctx, depot.id))
    .then_some(depot)
}

fn deposit_backyard_depot_commodity(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    marketplace_id: u64,
    stall_need: ResidenceNeedKind,
    commodity: CommodityKind,
    amount: f64,
) -> f64 {
    let amount = whole_units(amount);
    if amount < 1.0 {
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

fn mark_backyard_primary_production_day(ctx: &ReducerContext, garden_id: u64, day: u64) {
    if let Some(mut garden) = ctx.db.backyard_garden().id().find(&garden_id) {
        garden.last_primary_production_day = day;
        garden.hide_stock = whole_units(garden.hide_stock);
        garden.wax_stock = whole_units(garden.wax_stock);
        ctx.db.backyard_garden().id().update(garden);
    }
}

fn plant_harvest_start_month(kind: BackyardGardenKind) -> u32 {
    let authored = backyard_garden_def(kind).harvest_start_month;
    if authored > 0 {
        authored
    } else {
        match kind {
            BackyardGardenKind::HerbGarden | BackyardGardenKind::BackyardApiary => 3,
            _ => 1,
        }
    }
}

fn plant_harvest_end_month(kind: BackyardGardenKind) -> u32 {
    let authored = backyard_garden_def(kind).harvest_end_month;
    if authored > 0 {
        authored
    } else {
        match kind {
            BackyardGardenKind::HerbGarden | BackyardGardenKind::BackyardApiary => 11,
            _ => 12,
        }
    }
}

/// Turns a fractional expected yield into a deterministic whole lot. The
/// remainder is sampled from stable garden/day identity, preserving the
/// authored long-run rate without ever persisting a fractional commodity.
fn discrete_expected_units(expected: f64, entity_id: u64, day: u64, salt: u64) -> f64 {
    if !expected.is_finite() || expected <= 0.0 {
        return 0.0;
    }
    let base = expected.floor();
    let remainder = expected - base;
    base + f64::from(
        remainder > 1e-9
            && deterministic_unit(entity_id ^ 0x9e37_79b9, day, entity_id, salt) < remainder,
    )
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

#[cfg(test)]
mod tests {
    use super::{
        bounded_backyard_wax_stock, discrete_expected_units, split_whole_sale_receipt,
        WholeSaleReceipt,
    };

    #[test]
    fn backyard_wax_batch_waits_when_household_stock_is_full() {
        assert_eq!(bounded_backyard_wax_stock(7.0, 8.0, 1.0), Some(8.0));
        assert_eq!(bounded_backyard_wax_stock(8.0, 8.0, 1.0), None);
    }

    #[test]
    fn expected_backyard_yields_are_always_whole() {
        for expected in [0.0, 0.25, 0.99, 1.01, 7.75, 24.0] {
            let output = discrete_expected_units(expected, 41, 90, 7);
            assert!(output >= 0.0);
            assert_eq!(output.fract(), 0.0);
            assert!(output == expected.floor() || output == expected.ceil());
        }
    }

    #[test]
    fn expected_backyard_yield_rounding_is_stable_for_a_collection() {
        let a = discrete_expected_units(2.4, 9, 180, 3);
        let b = discrete_expected_units(2.4, 9, 180, 3);
        assert_eq!(a, b);
    }

    #[test]
    fn backyard_sale_coin_split_is_whole_and_conserving() {
        let receipt = split_whole_sale_receipt(10.8, 0.18, 1.0);
        assert_eq!(
            receipt,
            WholeSaleReceipt {
                producer_income: 8.0,
                local_tax: 2.0,
            }
        );
        assert_eq!(receipt.producer_income + receipt.local_tax, 10.0);
        assert_eq!(receipt.producer_income.fract(), 0.0);
        assert_eq!(receipt.local_tax.fract(), 0.0);
    }

    #[test]
    fn sub_coin_backyard_sale_does_not_mint_currency() {
        assert_eq!(
            split_whole_sale_receipt(0.99, 0.18, 1.0),
            WholeSaleReceipt::default()
        );
    }
}
