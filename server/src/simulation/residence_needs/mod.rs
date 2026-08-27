pub mod firewood;
pub mod food;
mod kinds;
pub mod provisions;
pub mod state;
pub mod water;

pub use kinds::ResidenceNeedKind;
pub use state::{load_needs, need_stock, sync_food_need_rows};

use crate::balance_generated::{
    BASE_ILLNESS_CHANCE_PER_PERSON_DAY, CALENDAR_SECONDS_PER_DAY, COLD_EXPOSURE_ILLNESS_MULTIPLIER,
    CORPSE_DISEASE_RADIUS, CORPSE_ILLNESS_MULTIPLIER, FRESH_FOOD_STORAGE_RESIDENCE_FACTOR,
    HERB_MORTALITY_MULTIPLIER, HERB_RECOVERY_MULTIPLIER, HERB_TREATMENT_PER_SICK_DAY,
    ILLNESS_MORTALITY_CHANCE_PER_SICK_DAY, ILLNESS_RECOVERY_DAYS, MALNUTRITION_ILLNESS_MULTIPLIER,
    PRESERVED_FOOD_STORAGE_RESIDENCE_FACTOR, RESIDENCE_FOOD_UNITS_PER_SLOT_PER_MONTH, TICK_DT,
    UNSAFE_WATER_ILLNESS_MULTIPLIER,
};
use crate::residence_consumption_policy::{
    daily_household_bill_due, monthly_household_bill_due, need_units_due,
};
use crate::resource_units::{whole_cost, whole_units};
use crate::season_policy::{EnvironmentState, Season};
use crate::simulation::game_calendar::GameClock;
use crate::simulation::landmark_access::MonasteryInfirmaryCare;
use spacetimedb::ReducerContext;

use crate::db::*;
use crate::economy::{
    building_edible_food_stock, food_category, reconcile_building_labor, residence_commodity_stock,
    residence_edible_food_stock, residence_food_progression_slots, withdraw_building_edible_food,
    withdraw_residence_commodity, CommodityKind, FoodCategory, EDIBLE_COMMODITIES,
    FRESH_FOOD_COMMODITIES, PRESERVED_FOOD_COMMODITIES,
};
use crate::monastery_estate_policy::{
    monastery_infirmary_mortality_multiplier, monastery_infirmary_recovery_multiplier,
    MONASTERY_INFIRMARY_FOOD_PER_BED_DAY,
};
use crate::residence_service_policy::{required_chapel_tier, service_need_clock_active};
use crate::resident_welfare_policy::{
    cold_exposure_death_chance, deterministic_unit, next_malnutrition, next_service_deficit_ticks,
    starvation_death_chance, ticks_for_days,
};
use crate::simulation::residence_needs::state::{
    delete_needs, find_need_mut, init_needs, migrate_and_sync_food_inventory, persist_needs,
    NeedState, NEED_SOURCE_FLOWER_LUXURY,
};
use crate::simulation::tick_context::SimTickContext;
use crate::tables::{corpse, Corpse, Residence};

pub fn step_residence_needs(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    mut residence: Residence,
    mut needs: Vec<NeedState>,
    chapel_tier: u8,
    infirmary_care: Option<MonasteryInfirmaryCare>,
    clock: &GameClock,
    environment: EnvironmentState,
    world_seed: u64,
    sim_tick: u64,
    food_spoilage_rate: u8,
) {
    if residence.population == 0 {
        return;
    }

    migrate_and_sync_food_inventory(ctx, &mut residence, &mut needs);
    // Sabbath prohibits labor and new logistics, not eating, heating, water
    // use, spoilage, or welfare progression. Only named holy days protect the
    // household-consumption clock.
    let general_consumption_paused =
        crate::simulation::game_calendar::household_consumption_paused(clock);
    if !general_consumption_paused && daily_household_bill_due(clock) {
        spoil_residence_food_inventory(
            &mut residence,
            environment,
            world_seed,
            sim_tick,
            food_spoilage_rate,
        );
    }
    migrate_and_sync_food_inventory(ctx, &mut residence, &mut needs);
    let monthly_bill_due = monthly_household_bill_due(residence.id, clock);

    let cold_weather = environment.season == Season::Winter;
    let mut food_unmet = false;
    let mut water_unmet = false;
    let mut cold_unmet = false;
    let mut service_unmet = false;
    if ResidenceNeedKind::Food.is_active_for_tier(residence.tier) {
        let mut monthly_food = None;
        if !general_consumption_paused && monthly_bill_due {
            let tier = residence.tier;
            monthly_food = Some(consume_monthly_food_slots(&mut residence, tier));
        }
        if let Some(need) = find_need_mut(&mut needs, ResidenceNeedKind::Food) {
            if let Some(result) = monthly_food {
                need.deficit_ticks = u32::from(!result.all_slots_met);
            } else if !general_consumption_paused && need.deficit_ticks > 0 {
                need.deficit_ticks = need.deficit_ticks.saturating_add(1);
            }
            food_unmet = need.deficit_ticks > 0;
        } else {
            food_unmet = true;
        }
        if let Some(result) = monthly_food {
            if let Some(variety) = find_need_mut(&mut needs, ResidenceNeedKind::FoodVariety) {
                variety.stock = f64::from(result.slots_consumed);
                variety.deficit_ticks = u32::from(!result.all_slots_met);
            }
            if residence.tier >= 4 {
                if let Some(preserved) = find_need_mut(&mut needs, ResidenceNeedKind::PreservedFood)
                {
                    preserved.deficit_ticks = u32::from(!result.preserved_slot_met);
                }
            }
        }
        migrate_and_sync_food_inventory(ctx, &mut residence, &mut needs);
        service_unmet = food_unmet;
    }

    let food_progression_slots = residence_food_progression_slots(&residence, residence.tier);

    for kind in ResidenceNeedKind::ALL {
        if kind == ResidenceNeedKind::Food {
            continue;
        }
        // Every service clock is continuous, including observed Sundays.
        // Named holy days alone freeze shortage clocks with consumption.
        if !service_need_clock_active(kind, general_consumption_paused) {
            continue;
        }
        if !kind.is_active_for_tier(residence.tier) {
            if let Some(need) = find_need_mut(&mut needs, kind) {
                need.deficit_ticks = 0;
            }
            continue;
        }
        let Some(need) = find_need_mut(&mut needs, kind) else {
            continue;
        };
        let outcome = if kind == ResidenceNeedKind::Church {
            let required_tier = required_chapel_tier(residence.tier);
            need.stock = f64::from(chapel_tier);
            if chapel_tier >= required_tier {
                ConsumeResult::Met(*need)
            } else {
                ConsumeResult::Unmet
            }
        } else if kind == ResidenceNeedKind::FoodVariety {
            need.stock = f64::from(food_progression_slots);
            if need.deficit_ticks == 0 {
                ConsumeResult::Met(*need)
            } else {
                ConsumeResult::Unmet
            }
        } else if kind == ResidenceNeedKind::PreservedFood {
            // Tier-four preserved food replaces one matching monthly category
            // slot; it never adds a sixth calorie charge.
            if need.deficit_ticks == 0 {
                ConsumeResult::Met(*need)
            } else {
                ConsumeResult::Unmet
            }
        } else if kind == ResidenceNeedKind::Luxury && residence_has_flower_luxury(ctx, &residence)
        {
            ConsumeResult::Met(NeedState {
                stock: 1.0,
                source_kind: NEED_SOURCE_FLOWER_LUXURY,
                ..*need
            })
        } else if let Some(units) = need_units_due(residence.id, kind, clock) {
            consume_need(kind, need, units)
        } else if need.deficit_ticks == 0 {
            ConsumeResult::Met(*need)
        } else {
            ConsumeResult::Unmet
        };
        match outcome {
            ConsumeResult::Met(updated) => {
                *need = updated;
                need.deficit_ticks = 0;
            }
            ConsumeResult::Unmet => {
                *need = on_unmet_need(kind, need);
                need.deficit_ticks = need.deficit_ticks.saturating_add(1);
                service_unmet = true;
                if kind == ResidenceNeedKind::Water {
                    water_unmet = true;
                }
                if kind == ResidenceNeedKind::Firewood && cold_weather {
                    cold_unmet = true;
                }
            }
        }
    }
    let cold_exposure_ticks = if cold_weather {
        needs
            .iter()
            .find(|need| need.kind == ResidenceNeedKind::Firewood)
            .map_or(0, |need| need.deficit_ticks)
    } else {
        0
    };

    let previous_effective_workers = residence
        .population
        .saturating_sub(residence.sick_population);
    let food_shortage_harms_health = food_shortage_harms_health(
        food_unmet,
        residence_edible_food_stock(&residence),
    );
    update_health(
        ctx,
        tick,
        &mut residence,
        food_shortage_harms_health,
        water_unmet,
        cold_unmet,
        cold_exposure_ticks,
        general_consumption_paused,
        infirmary_care,
        !general_consumption_paused && daily_household_bill_due(clock),
        world_seed,
        sim_tick,
    );

    // The additive save column keeps its old name for compatibility, but it
    // now tracks any continuously unmet active household service. Shortages
    // affect approval and promotion eligibility—not work output or tenure.
    residence.comfort_deficit_ticks = next_service_deficit_ticks(
        residence.comfort_deficit_ticks,
        service_unmet,
        general_consumption_paused,
    );
    residence.abandoned = false;
    migrate_and_sync_food_inventory(ctx, &mut residence, &mut needs);
    let owner = residence.owner;
    persist_needs(ctx, residence.id, &needs);
    let next_effective_workers = residence
        .population
        .saturating_sub(residence.sick_population);
    ctx.db.residence().id().update(residence);
    if next_effective_workers < previous_effective_workers {
        reconcile_building_labor(ctx, owner);
    }
}

fn food_shortage_harms_health(food_unmet: bool, edible_food_stock: f64) -> bool {
    food_unmet && edible_food_stock + 1e-6 < 1.0
}

fn residence_has_flower_luxury(ctx: &ReducerContext, residence: &Residence) -> bool {
    ctx.db
        .backyard_garden()
        .residence_id()
        .filter(&residence.id)
        .next()
        .is_some_and(|garden| garden.flower_luxury_upgraded)
}

#[derive(Clone, Copy)]
enum MonthlyFoodSlot {
    Any,
    Grain,
    NonGrain,
    ProduceOrForage,
    LandAnimal,
    AnimalProduce,
    Meat,
    Fish,
}

const TIER_1_FOOD_SLOTS: &[MonthlyFoodSlot] = &[MonthlyFoodSlot::Any];
const TIER_2_FOOD_SLOTS: &[MonthlyFoodSlot] = &[MonthlyFoodSlot::Grain, MonthlyFoodSlot::NonGrain];
const TIER_3_FOOD_SLOTS: &[MonthlyFoodSlot] = &[
    MonthlyFoodSlot::Grain,
    MonthlyFoodSlot::ProduceOrForage,
    MonthlyFoodSlot::LandAnimal,
    MonthlyFoodSlot::Fish,
];
const TIER_4_FOOD_SLOTS: &[MonthlyFoodSlot] = &[
    MonthlyFoodSlot::Grain,
    MonthlyFoodSlot::ProduceOrForage,
    MonthlyFoodSlot::AnimalProduce,
    MonthlyFoodSlot::Meat,
    MonthlyFoodSlot::Fish,
];

#[derive(Clone, Copy, Default)]
struct MonthlyFoodResult {
    all_slots_met: bool,
    preserved_slot_met: bool,
    slots_consumed: u8,
}

fn monthly_food_slots(tier: u8) -> &'static [MonthlyFoodSlot] {
    match tier {
        0 => &[],
        1 => TIER_1_FOOD_SLOTS,
        2 => TIER_2_FOOD_SLOTS,
        3 => TIER_3_FOOD_SLOTS,
        _ => TIER_4_FOOD_SLOTS,
    }
}

fn food_matches_slot(commodity: CommodityKind, slot: MonthlyFoodSlot) -> bool {
    let Some(category) = food_category(commodity) else {
        return false;
    };
    match slot {
        MonthlyFoodSlot::Any => true,
        MonthlyFoodSlot::Grain => matches!(
            commodity,
            CommodityKind::Food
                | CommodityKind::OatGrain
                | CommodityKind::RyeBread
                | CommodityKind::MaslinBread
                | CommodityKind::PreservedFood
        ),
        MonthlyFoodSlot::NonGrain => category != FoodCategory::Grains,
        MonthlyFoodSlot::ProduceOrForage => matches!(
            category,
            FoodCategory::Vegetables
                | FoodCategory::Fruits
                | FoodCategory::Foraged
                | FoodCategory::Honey
        ),
        MonthlyFoodSlot::LandAnimal => {
            matches!(category, FoodCategory::AnimalProduce | FoodCategory::Meats)
        }
        MonthlyFoodSlot::AnimalProduce => category == FoodCategory::AnimalProduce,
        MonthlyFoodSlot::Meat => category == FoodCategory::Meats,
        MonthlyFoodSlot::Fish => category == FoodCategory::Fishes,
    }
}

fn first_food_for_slot(
    residence: &Residence,
    slot: MonthlyFoodSlot,
    preserved_only: bool,
) -> Option<CommodityKind> {
    EDIBLE_COMMODITIES.into_iter().find(|commodity| {
        (!preserved_only || commodity.is_preserved_food())
            && food_matches_slot(*commodity, slot)
            && residence_commodity_stock(residence, *commodity) >= 1.0
    })
}

fn consume_monthly_food_slots(residence: &mut Residence, tier: u8) -> MonthlyFoodResult {
    let slots = monthly_food_slots(tier);
    let units_per_slot = whole_units(RESIDENCE_FOOD_UNITS_PER_SLOT_PER_MONTH) as u8;
    if slots.is_empty() || units_per_slot == 0 {
        return MonthlyFoodResult {
            all_slots_met: true,
            preserved_slot_met: tier < 4,
            slots_consumed: 0,
        };
    }

    let mut consumed_for_slot = vec![0_u8; slots.len()];
    let mut preserved_slot_met = tier < 4;
    if tier >= 4 {
        if let Some((slot_index, commodity)) = slots.iter().enumerate().find_map(|(index, slot)| {
            first_food_for_slot(residence, *slot, true).map(|commodity| (index, commodity))
        }) {
            if withdraw_residence_commodity(residence, commodity, 1.0) >= 1.0 {
                consumed_for_slot[slot_index] = 1;
                preserved_slot_met = true;
            }
        }
    }

    for (index, slot) in slots.iter().enumerate() {
        while consumed_for_slot[index] < units_per_slot {
            let Some(commodity) = first_food_for_slot(residence, *slot, false) else {
                break;
            };
            if withdraw_residence_commodity(residence, commodity, 1.0) < 1.0 {
                break;
            }
            consumed_for_slot[index] += 1;
        }
    }

    let slots_consumed = consumed_for_slot
        .iter()
        .filter(|consumed| **consumed >= units_per_slot)
        .count() as u8;
    MonthlyFoodResult {
        all_slots_met: slots_consumed as usize == slots.len() && preserved_slot_met,
        preserved_slot_met,
        slots_consumed,
    }
}

/// A market refill should end an old food-shortage state as soon as the
/// physical pantry can pay the household's next bill. The preview runs the
/// exact category-aware bill against a clone, so it neither consumes stock nor
/// lets a token amount of the wrong food hide a real shortage.
pub fn relieve_food_deficit_from_stocked_pantry(ctx: &ReducerContext, residence: &Residence) {
    let mut pantry_preview = residence.clone();
    if !consume_monthly_food_slots(&mut pantry_preview, residence.tier).all_slots_met {
        return;
    }

    let mut needs = load_needs(ctx, residence.id);
    let Some(food_need) = find_need_mut(&mut needs, ResidenceNeedKind::Food) else {
        return;
    };
    if food_need.deficit_ticks == 0 {
        return;
    }
    food_need.deficit_ticks = 0;
    persist_needs(ctx, residence.id, &needs);
}

fn whole_daily_spoilage_loss(
    stock: f64,
    fraction: f64,
    world_seed: u64,
    sim_tick: u64,
    residence_id: u64,
    commodity: CommodityKind,
) -> f64 {
    let stock = whole_units(stock);
    let expected = (stock * fraction.max(0.0)).min(stock);
    let guaranteed = expected.floor();
    let remainder = expected - guaranteed;
    let extra = f64::from(
        deterministic_unit(
            world_seed,
            sim_tick,
            residence_id,
            0x5A01_u64 + u64::from(commodity.as_u8()),
        ) < remainder,
    );
    (guaranteed + extra).min(stock)
}

fn spoil_residence_food_inventory(
    residence: &mut Residence,
    environment: EnvironmentState,
    world_seed: u64,
    sim_tick: u64,
    food_spoilage_rate: u8,
) {
    if food_spoilage_rate == 0 {
        return;
    }
    let difficulty_multiplier = f64::from(food_spoilage_rate) / 100.0;
    let fresh_fraction = (environment.fresh_food_spoilage_fraction_per_second()
        * CALENDAR_SECONDS_PER_DAY
        * FRESH_FOOD_STORAGE_RESIDENCE_FACTOR
        * difficulty_multiplier)
        .clamp(0.0, 1.0);
    let preserved_fraction = (environment.preserved_food_spoilage_fraction_per_second()
        * CALENDAR_SECONDS_PER_DAY
        * PRESERVED_FOOD_STORAGE_RESIDENCE_FACTOR
        * difficulty_multiplier)
        .clamp(0.0, 1.0);
    for commodity in FRESH_FOOD_COMMODITIES {
        let stock = residence_commodity_stock(residence, commodity);
        let loss = whole_daily_spoilage_loss(
            stock,
            fresh_fraction * commodity.spoilage_multiplier(),
            world_seed,
            sim_tick,
            residence.id,
            commodity,
        );
        withdraw_residence_commodity(residence, commodity, loss);
    }
    for commodity in PRESERVED_FOOD_COMMODITIES {
        let stock = residence_commodity_stock(residence, commodity);
        let loss = whole_daily_spoilage_loss(
            stock,
            preserved_fraction * commodity.spoilage_multiplier(),
            world_seed,
            sim_tick,
            residence.id,
            commodity,
        );
        withdraw_residence_commodity(residence, commodity, loss);
    }
}

fn update_health(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    residence: &mut Residence,
    food_unmet: bool,
    water_unmet: bool,
    cold_unmet: bool,
    cold_exposure_ticks: u32,
    consumption_paused: bool,
    infirmary_care: Option<MonasteryInfirmaryCare>,
    daily_care_due: bool,
    world_seed: u64,
    sim_tick: u64,
) {
    if !consumption_paused {
        residence.hunger_ticks = if food_unmet {
            residence.hunger_ticks.saturating_add(1)
        } else {
            residence.hunger_ticks.saturating_sub(2)
        };
    }
    residence.malnutrition = next_malnutrition(
        residence.malnutrition,
        residence.hunger_ticks,
        food_unmet,
        consumption_paused,
    );

    let nearby_corpses = tick.nearby_waiting_corpses(
        ctx,
        residence.owner,
        residence.x,
        residence.z,
        CORPSE_DISEASE_RADIUS,
    ) as f64;
    let illness_pressure = (1.0
        + residence.malnutrition * MALNUTRITION_ILLNESS_MULTIPLIER
        + if water_unmet {
            UNSAFE_WATER_ILLNESS_MULTIPLIER
        } else {
            0.0
        }
        + if cold_unmet {
            COLD_EXPOSURE_ILLNESS_MULTIPLIER
        } else {
            0.0
        }
        + nearby_corpses * CORPSE_ILLNESS_MULTIPLIER)
        .max(0.0);
    let infection_chance = (BASE_ILLNESS_CHANCE_PER_PERSON_DAY
        * residence
            .population
            .saturating_sub(residence.sick_population) as f64
        * illness_pressure
        * TICK_DT
        / CALENDAR_SECONDS_PER_DAY)
        .clamp(0.0, 1.0);
    if residence.sick_population < residence.population
        && deterministic_unit(world_seed, sim_tick, residence.id, 0x51C) < infection_chance
    {
        residence.sick_population = residence.sick_population.saturating_add(1);
    }

    let infirmary_care_ratio =
        fund_monastery_infirmary_care(ctx, residence, infirmary_care, daily_care_due);

    let mut herb_treated = false;
    if daily_care_due && residence.sick_population > 0 && residence.remedy_stock >= 1.0 {
        let remedy_demand =
            whole_cost(residence.sick_population as f64 * HERB_TREATMENT_PER_SICK_DAY);
        if residence.remedy_stock + 1e-9 >= remedy_demand {
            residence.remedy_stock = whole_units(residence.remedy_stock - remedy_demand);
            herb_treated = true;
        }
    }
    if residence.sick_population > 0 {
        residence.illness_ticks = residence.illness_ticks.saturating_add(1);
        let recovery_ticks = ticks_for_days(ILLNESS_RECOVERY_DAYS);
        let herb_recovery_multiplier = if herb_treated {
            HERB_RECOVERY_MULTIPLIER.max(1.0)
        } else {
            1.0
        };
        let infirmary_recovery_multiplier = infirmary_care.map_or(1.0, |care| {
            1.0 + (monastery_infirmary_recovery_multiplier(care.extensions, care.service_funding)
                - 1.0)
                * infirmary_care_ratio
        });
        // Care is purchased once in a whole daily lot. Credit the remaining
        // recovery work for that day immediately instead of withdrawing tiny
        // food/remedy fractions on every simulation tick.
        if daily_care_due {
            let daily_ticks = ticks_for_days(1.0);
            let care_multiplier =
                (herb_recovery_multiplier * infirmary_recovery_multiplier).max(1.0);
            let bonus = (f64::from(daily_ticks) * (care_multiplier - 1.0))
                .round()
                .max(0.0) as u32;
            residence.illness_ticks = residence.illness_ticks.saturating_add(bonus);
        }
        let effective_recovery_ticks = (f64::from(recovery_ticks)
            / (herb_recovery_multiplier * infirmary_recovery_multiplier).max(1.0))
        .round()
        .max(1.0) as u32;
        if residence.illness_ticks >= effective_recovery_ticks {
            residence.sick_population = residence.sick_population.saturating_sub(1);
            residence.illness_ticks = 0;
        }
    } else {
        residence.illness_ticks = 0;
    }

    let mut death_cause = None;
    let starvation_chance = if food_unmet {
        starvation_death_chance(residence.population, residence.hunger_ticks)
    } else {
        0.0
    };
    let exposure_chance = if cold_unmet {
        cold_exposure_death_chance(residence.population, cold_exposure_ticks)
    } else {
        0.0
    };
    if deterministic_unit(world_seed, sim_tick, residence.id, 0x57A2) < starvation_chance {
        death_cause = Some(0);
    } else if deterministic_unit(world_seed, sim_tick, residence.id, 0xC01D) < exposure_chance {
        death_cause = Some(2);
    } else if residence.sick_population > 0 {
        let infirmary_mortality_multiplier = infirmary_care.map_or(1.0, |care| {
            1.0 - (1.0
                - monastery_infirmary_mortality_multiplier(care.extensions, care.service_funding))
                * infirmary_care_ratio
        });
        let mortality_chance = (ILLNESS_MORTALITY_CHANCE_PER_SICK_DAY
            * residence.sick_population as f64
            * (1.0 + residence.malnutrition * 2.0)
            * if herb_treated {
                HERB_MORTALITY_MULTIPLIER
            } else {
                1.0
            }
            * infirmary_mortality_multiplier
            * TICK_DT
            / CALENDAR_SECONDS_PER_DAY)
            .clamp(0.0, 1.0);
        if deterministic_unit(world_seed, sim_tick, residence.id, 0xDEA7) < mortality_chance {
            death_cause = Some(1);
        }
    }
    if let Some(cause) = death_cause {
        residence.population = residence.population.saturating_sub(1);
        if cause == 1 {
            residence.sick_population = residence.sick_population.saturating_sub(1);
        } else {
            residence.sick_population = residence.sick_population.min(residence.population);
        }
        residence.deaths_total = residence.deaths_total.saturating_add(1);
        insert_corpse(ctx, tick, residence, cause, sim_tick);
    }
}

fn fund_monastery_infirmary_care(
    ctx: &ReducerContext,
    residence: &Residence,
    care: Option<MonasteryInfirmaryCare>,
    daily_care_due: bool,
) -> f64 {
    let Some(care) = care else {
        return 0.0;
    };
    if residence.sick_population == 0 || care.beds == 0 {
        return 0.0;
    }
    let Some(mut monastery) = ctx.db.building().id().find(&care.monastery_id) else {
        return 0.0;
    };
    if monastery.kind != "monastery"
        || !monastery.construction_complete
        || monastery.assigned_labor == 0
    {
        return 0.0;
    }

    if !daily_care_due {
        return 0.0;
    }
    let admitted = care.beds.min(residence.sick_population);
    let requested_food = whole_cost(admitted as f64 * MONASTERY_INFIRMARY_FOOD_PER_BED_DAY);
    if requested_food < 1.0 || building_edible_food_stock(&monastery) + 1e-9 < requested_food {
        return 0.0;
    }
    let withdrawn = withdraw_building_edible_food(&mut monastery, requested_food);
    if withdrawn + 1e-9 < requested_food {
        return 0.0;
    }
    ctx.db.building().id().update(monastery);
    admitted as f64 / residence.sick_population as f64
}

fn insert_corpse(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    residence: &Residence,
    cause: u8,
    sim_tick: u64,
) {
    let offset_seed = residence.deaths_total as f64;
    let x = residence.x + (offset_seed * 2.17).sin() * 1.4;
    let z = residence.z + (offset_seed * 1.73).cos() * 1.4;
    ctx.db.corpse().insert(Corpse {
        id: 0,
        owner: residence.owner,
        residence_id: residence.id,
        cause,
        state: 0,
        x,
        z,
        cart_x: x,
        cart_z: z,
        created_tick: sim_tick,
        chapel_id: 0,
        graveyard_id: 0,
        progress: 0.0,
        speed_mps: 0.0,
        path_distance: 0.0,
        route_polyline_json: String::new(),
    });
    tick.record_waiting_corpse(residence.owner, x, z, CORPSE_DISEASE_RADIUS);
}

pub fn apply_need_delivery(
    ctx: &ReducerContext,
    residence_id: u64,
    kind: ResidenceNeedKind,
    delivered: f64,
) {
    let mut needs = load_needs(ctx, residence_id);
    let Some(need) = find_need_mut(&mut needs, kind) else {
        return;
    };
    *need = apply_delivery_for_kind(kind, need, delivered);
    persist_needs(ctx, residence_id, &needs);
}

/// Adds need stock while retaining the physical commodity that fulfilled it.
/// The UI uses this provenance for substitute goods such as charcoal, cider,
/// and Tier-4 luxury wares; it never replaces the authoritative stock value.
pub fn apply_need_delivery_from_commodity(
    ctx: &ReducerContext,
    residence_id: u64,
    kind: ResidenceNeedKind,
    delivered: f64,
    commodity: CommodityKind,
) {
    let mut needs = load_needs(ctx, residence_id);
    let Some(need) = find_need_mut(&mut needs, kind) else {
        return;
    };
    *need = apply_delivery_for_kind(kind, need, delivered);
    need.source_kind = u16::from(commodity.as_u8());
    persist_needs(ctx, residence_id, &needs);
}

/// Records a need satisfied by goods consumed at a physical communal venue.
/// Unlike a delivery, this never adds stock to the household pantry.
pub fn apply_need_consumed_at_source(
    ctx: &ReducerContext,
    residence_id: u64,
    kind: ResidenceNeedKind,
) {
    let mut needs = load_needs(ctx, residence_id);
    let Some(need) = find_need_mut(&mut needs, kind) else {
        return;
    };
    *need = need_relief_without_delivery(need);
    persist_needs(ctx, residence_id, &needs);
}

fn need_relief_without_delivery(need: &NeedState) -> NeedState {
    NeedState {
        deficit_ticks: 0,
        ..*need
    }
}

pub fn ensure_residence_needs(ctx: &ReducerContext, residence_id: u64) {
    init_needs(ctx, residence_id);
}

pub fn clear_residence_needs(ctx: &ReducerContext, residence_id: u64) {
    delete_needs(ctx, residence_id);
}

enum ConsumeResult {
    Met(NeedState),
    Unmet,
}

fn consume_need(kind: ResidenceNeedKind, need: &NeedState, units: f64) -> ConsumeResult {
    match kind {
        ResidenceNeedKind::Firewood => match firewood::consume(need, units) {
            firewood::ConsumeOutcome::Met(updated) => ConsumeResult::Met(updated),
            firewood::ConsumeOutcome::Unmet => ConsumeResult::Unmet,
        },
        ResidenceNeedKind::Water => match water::consume(need, units) {
            water::ConsumeOutcome::Met(updated) => ConsumeResult::Met(updated),
            water::ConsumeOutcome::Unmet => ConsumeResult::Unmet,
        },
        ResidenceNeedKind::Ale
        | ResidenceNeedKind::Cloth
        | ResidenceNeedKind::Shoes
        | ResidenceNeedKind::Pottery
        | ResidenceNeedKind::Luxury => match provisions::consume_units(need, units) {
            provisions::ConsumeOutcome::Met(updated) => ConsumeResult::Met(updated),
            provisions::ConsumeOutcome::Unmet => ConsumeResult::Unmet,
        },
        ResidenceNeedKind::Food
        | ResidenceNeedKind::PreservedFood
        | ResidenceNeedKind::Church
        | ResidenceNeedKind::FoodVariety => ConsumeResult::Unmet,
    }
}

fn on_unmet_need(kind: ResidenceNeedKind, need: &NeedState) -> NeedState {
    match kind {
        ResidenceNeedKind::Firewood => firewood::on_unmet(need),
        ResidenceNeedKind::Water => water::on_unmet(need),
        ResidenceNeedKind::Food => food::on_unmet(need),
        ResidenceNeedKind::Ale
        | ResidenceNeedKind::PreservedFood
        | ResidenceNeedKind::Cloth
        | ResidenceNeedKind::Shoes
        | ResidenceNeedKind::Pottery
        | ResidenceNeedKind::Luxury => provisions::on_unmet(need),
        ResidenceNeedKind::Church | ResidenceNeedKind::FoodVariety => *need,
    }
}

fn apply_delivery_for_kind(kind: ResidenceNeedKind, need: &NeedState, delivered: f64) -> NeedState {
    match kind {
        ResidenceNeedKind::Firewood => firewood::apply_delivery(need, delivered),
        ResidenceNeedKind::Water => water::apply_delivery(need, delivered),
        ResidenceNeedKind::Food => food::apply_delivery(need, delivered),
        ResidenceNeedKind::Ale
        | ResidenceNeedKind::PreservedFood
        | ResidenceNeedKind::Cloth
        | ResidenceNeedKind::Shoes
        | ResidenceNeedKind::Pottery
        | ResidenceNeedKind::Luxury => provisions::apply_delivery(need, delivered),
        ResidenceNeedKind::Church | ResidenceNeedKind::FoodVariety => *need,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        food_shortage_harms_health, need_relief_without_delivery, NeedState, ResidenceNeedKind,
    };

    #[test]
    fn communal_meal_clears_deficit_without_teleporting_pantry_stock() {
        let before = NeedState {
            kind: ResidenceNeedKind::Food,
            stock: 1.75,
            deficit_ticks: 42,
            source_kind: crate::simulation::residence_needs::state::NEED_SOURCE_NONE,
        };
        let after = need_relief_without_delivery(&before);
        assert_eq!(after.stock, before.stock);
        assert_eq!(after.deficit_ticks, 0);
    }

    #[test]
    fn stocked_food_stops_an_old_deficit_harming_health() {
        assert!(food_shortage_harms_health(true, 0.0));
        assert!(!food_shortage_harms_health(true, 1.0));
        assert!(!food_shortage_harms_health(false, 0.0));
    }
}
