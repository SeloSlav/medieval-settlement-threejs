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
    PRESERVED_FOOD_STORAGE_RESIDENCE_FACTOR, TICK_DT, UNSAFE_WATER_ILLNESS_MULTIPLIER,
};
use crate::season_policy::EnvironmentState;
use crate::simulation::game_calendar::GameClock;
use crate::simulation::labor_schedule::is_consumption_paused;
use spacetimedb::ReducerContext;

use crate::db::*;
use crate::economy::{
    reconcile_building_labor, residence_fresh_food_stock, residence_preserved_food_stock,
    withdraw_residence_commodity, CommodityKind, FRESH_FOOD_COMMODITIES,
    PRESERVED_FOOD_COMMODITIES,
};
use crate::preserved_food_policy::allocate_preserved_meal;
use crate::resident_welfare_policy::{
    deterministic_unit, next_malnutrition, next_service_deficit_ticks, starvation_death_due,
    starvation_episode_resolved, ticks_for_days,
};
use crate::simulation::residence_needs::state::{
    delete_needs, find_need_mut, init_needs, migrate_and_sync_food_inventory, persist_needs,
    NeedState,
};
use crate::simulation::tick_context::SimTickContext;
use crate::tables::{corpse, Corpse, Residence};

pub fn step_residence_needs(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    mut residence: Residence,
    mut needs: Vec<NeedState>,
    _has_chapel_access: bool,
    _has_monastery_coverage: bool,
    clock: &GameClock,
    environment: EnvironmentState,
    world_seed: u64,
    sim_tick: u64,
) {
    if residence.population == 0 {
        return;
    }

    migrate_and_sync_food_inventory(&mut residence, &mut needs);
    let general_consumption_paused = is_consumption_paused(ctx, residence.owner, clock);
    spoil_residence_food_inventory(&mut residence, environment);
    migrate_and_sync_food_inventory(&mut residence, &mut needs);

    let cold_weather = environment.firewood_demand_multiplier() > 1.0 + 1e-9;
    let mut food_unmet = false;
    let mut water_unmet = false;
    let mut cold_unmet = false;
    let mut service_unmet = false;

    if !general_consumption_paused && ResidenceNeedKind::Food.is_active_for_tier(residence.tier) {
        food_unmet = consume_food_with_preserved(&mut residence, &mut needs, environment);
        service_unmet = food_unmet;
    }

    for kind in ResidenceNeedKind::ALL {
        if kind == ResidenceNeedKind::Food {
            continue;
        }
        // Heating is continuous. Other needs keep the established daytime
        // cadence, but Sunday observance does not make provisions free.
        if general_consumption_paused && kind != ResidenceNeedKind::Firewood {
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
        let outcome = if kind == ResidenceNeedKind::PreservedFood {
            // The meal allocator already rotated the seasonal ration without
            // adding a second calorie demand. Any remainder is the household's
            // status stock and emergency fallback.
            if need.stock > 1e-9 {
                ConsumeResult::Met(*need)
            } else {
                ConsumeResult::Unmet
            }
        } else {
            consume_need(kind, &residence, need, environment)
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

    let previous_effective_workers = residence
        .population
        .saturating_sub(residence.sick_population);
    update_health(
        ctx,
        tick,
        &mut residence,
        food_unmet,
        water_unmet,
        cold_unmet,
        general_consumption_paused,
        world_seed,
        sim_tick,
    );

    // The additive save column keeps its old name for compatibility, but it
    // now tracks any continuously unmet active household service. Shortages
    // affect approval, market output, and promotion eligibility—not tenure.
    residence.comfort_deficit_ticks = next_service_deficit_ticks(
        residence.comfort_deficit_ticks,
        service_unmet,
        general_consumption_paused,
    );
    residence.abandoned = false;
    migrate_and_sync_food_inventory(&mut residence, &mut needs);
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

fn consume_food_with_preserved(
    residence: &mut Residence,
    needs: &mut [NeedState],
    environment: EnvironmentState,
) -> bool {
    let Some(food_index) = needs
        .iter()
        .position(|need| need.kind == ResidenceNeedKind::Food)
    else {
        return true;
    };
    let demand = food::demand(residence);
    let fresh_stock = residence_fresh_food_stock(residence);
    let preserved_stock = residence_preserved_food_stock(residence);
    let rotation_demand = provisions::preserved_food_demand(
        residence,
        environment.preserved_food_demand_multiplier(),
    );
    let allocation = allocate_preserved_meal(
        fresh_stock,
        preserved_stock,
        demand,
        rotation_demand,
        residence.tier >= 3,
    );
    withdraw_residence_food_group(residence, false, allocation.fresh_used);
    withdraw_residence_food_group(residence, true, allocation.preserved_used());
    migrate_and_sync_food_inventory(residence, needs);
    if allocation.unmet <= 1e-9 {
        needs[food_index].deficit_ticks = 0;
        return false;
    }
    needs[food_index].deficit_ticks = needs[food_index].deficit_ticks.saturating_add(1);
    true
}

fn spoil_residence_food_inventory(residence: &mut Residence, environment: EnvironmentState) {
    let fresh_fraction = (
        environment.fresh_food_spoilage_fraction_per_second()
            * FRESH_FOOD_STORAGE_RESIDENCE_FACTOR
            * TICK_DT
    )
        .clamp(0.0, 1.0);
    let preserved_fraction = (
        environment.preserved_food_spoilage_fraction_per_second()
            * PRESERVED_FOOD_STORAGE_RESIDENCE_FACTOR
            * TICK_DT
    )
        .clamp(0.0, 1.0);
    for commodity in FRESH_FOOD_COMMODITIES {
        let stock = crate::economy::residence_commodity_stock(residence, commodity);
        withdraw_residence_commodity(residence, commodity, stock * fresh_fraction);
    }
    for commodity in PRESERVED_FOOD_COMMODITIES {
        let stock = crate::economy::residence_commodity_stock(residence, commodity);
        withdraw_residence_commodity(residence, commodity, stock * preserved_fraction);
    }
    // Honey is already modeled as a durable specialty and does not share the
    // fresh-food spoilage pass.
}

fn withdraw_residence_food_group(
    residence: &mut Residence,
    preserved: bool,
    mut amount: f64,
) -> f64 {
    let order: &[CommodityKind] = if preserved {
        &[
            CommodityKind::Cheese,
            CommodityKind::SmokedFish,
            CommodityKind::CuredMeat,
            CommodityKind::PreservedFood,
        ]
    } else {
        &[
            CommodityKind::Meat,
            CommodityKind::Fish,
            CommodityKind::Milk,
            CommodityKind::Mushrooms,
            CommodityKind::Berries,
            CommodityKind::Grapes,
            CommodityKind::Cherries,
            CommodityKind::Apples,
            CommodityKind::Vegetables,
            CommodityKind::Eggs,
            CommodityKind::Porridge,
            CommodityKind::Bread,
            CommodityKind::Food,
            CommodityKind::Honey,
        ]
    };
    let mut withdrawn = 0.0;
    for commodity in order {
        if amount <= 1e-9 {
            break;
        }
        let used = withdraw_residence_commodity(residence, *commodity, amount);
        withdrawn += used;
        amount = (amount - used * commodity.meal_value()).max(0.0);
    }
    withdrawn
}

fn update_health(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    residence: &mut Residence,
    food_unmet: bool,
    water_unmet: bool,
    cold_unmet: bool,
    consumption_paused: bool,
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

    if starvation_episode_resolved(residence.hunger_ticks) {
        residence.last_starvation_death_hunger_ticks = 0;
    }

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

    let mut herb_treated = false;
    if residence.sick_population > 0 && residence.remedy_stock > 1e-9 {
        let remedy_demand =
            residence.sick_population as f64 * HERB_TREATMENT_PER_SICK_DAY * TICK_DT
                / CALENDAR_SECONDS_PER_DAY;
        if residence.remedy_stock + 1e-9 >= remedy_demand {
            residence.remedy_stock = (residence.remedy_stock - remedy_demand).max(0.0);
            herb_treated = true;
        }
    }
    if residence.sick_population > 0 {
        residence.illness_ticks = residence.illness_ticks.saturating_add(1);
        let recovery_ticks = ticks_for_days(ILLNESS_RECOVERY_DAYS);
        let effective_recovery_ticks = if herb_treated {
            (f64::from(recovery_ticks) / HERB_RECOVERY_MULTIPLIER.max(1.0)).round() as u32
        } else {
            recovery_ticks
        }
        .max(1);
        if residence.illness_ticks >= effective_recovery_ticks {
            residence.sick_population = residence.sick_population.saturating_sub(1);
            residence.illness_ticks = 0;
        }
    } else {
        residence.illness_ticks = 0;
    }

    let mut death_cause = None;
    if food_unmet
        && residence.population > 0
        && starvation_death_due(
            residence.hunger_ticks,
            residence.last_starvation_death_hunger_ticks,
        )
    {
        residence.last_starvation_death_hunger_ticks = residence.hunger_ticks;
        death_cause = Some(0);
    } else if residence.sick_population > 0 {
        let mortality_chance = (ILLNESS_MORTALITY_CHANCE_PER_SICK_DAY
            * residence.sick_population as f64
            * (1.0 + residence.malnutrition * 2.0)
            * if herb_treated {
                HERB_MORTALITY_MULTIPLIER
            } else {
                1.0
            }
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

fn consume_need(
    kind: ResidenceNeedKind,
    residence: &Residence,
    need: &NeedState,
    environment: EnvironmentState,
) -> ConsumeResult {
    match kind {
        ResidenceNeedKind::Firewood => {
            match firewood::consume(residence, need, environment.firewood_demand_multiplier()) {
                firewood::ConsumeOutcome::Met(updated) => ConsumeResult::Met(updated),
                firewood::ConsumeOutcome::Unmet => ConsumeResult::Unmet,
            }
        }
        ResidenceNeedKind::Water => match water::consume(residence, need) {
            water::ConsumeOutcome::Met(updated) => ConsumeResult::Met(updated),
            water::ConsumeOutcome::Unmet => ConsumeResult::Unmet,
        },
        ResidenceNeedKind::Food => match food::consume(
            residence,
            need,
            environment.fresh_food_spoilage_fraction_per_second()
                * FRESH_FOOD_STORAGE_RESIDENCE_FACTOR,
        ) {
            food::ConsumeOutcome::Met(updated) => ConsumeResult::Met(updated),
            food::ConsumeOutcome::Unmet => ConsumeResult::Unmet,
        },
        ResidenceNeedKind::Ale => match provisions::consume_ale(residence, need) {
            provisions::ConsumeOutcome::Met(updated) => ConsumeResult::Met(updated),
            provisions::ConsumeOutcome::Unmet => ConsumeResult::Unmet,
        },
        ResidenceNeedKind::PreservedFood => {
            match provisions::consume_preserved_food(residence, need) {
                provisions::ConsumeOutcome::Met(updated) => ConsumeResult::Met(updated),
                provisions::ConsumeOutcome::Unmet => ConsumeResult::Unmet,
            }
        }
        ResidenceNeedKind::Cloth => match provisions::consume_cloth(residence, need) {
            provisions::ConsumeOutcome::Met(updated) => ConsumeResult::Met(updated),
            provisions::ConsumeOutcome::Unmet => ConsumeResult::Unmet,
        },
        ResidenceNeedKind::Pottery => match provisions::consume_pottery(residence, need) {
            provisions::ConsumeOutcome::Met(updated) => ConsumeResult::Met(updated),
            provisions::ConsumeOutcome::Unmet => ConsumeResult::Unmet,
        },
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
        | ResidenceNeedKind::Pottery => provisions::on_unmet(need),
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
        | ResidenceNeedKind::Pottery => provisions::apply_delivery(need, delivered),
    }
}

#[cfg(test)]
mod tests {
    use super::{need_relief_without_delivery, NeedState, ResidenceNeedKind};

    #[test]
    fn communal_meal_clears_deficit_without_teleporting_pantry_stock() {
        let before = NeedState {
            kind: ResidenceNeedKind::Food,
            stock: 1.75,
            deficit_ticks: 42,
        };
        let after = need_relief_without_delivery(&before);
        assert_eq!(after.stock, before.stock);
        assert_eq!(after.deficit_ticks, 0);
    }
}
