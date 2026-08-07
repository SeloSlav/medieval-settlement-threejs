use std::cmp::Ordering;

use spacetimedb::{Identity, ReducerContext};

use crate::balance_generated::{CALENDAR_SECONDS_PER_DAY, TICK_DT};
use crate::db::*;
use crate::economy::{
    debit_residence_wealth, withdraw_building_commodity, withdraw_residence_fresh_food,
    withdraw_residence_preserved_food, CommodityKind,
};
use crate::frontier_economy_policy::armed_guards;
use crate::night_policy::{
    curfew_security_multiplier, gathering_share, lighting_firewood_per_household,
    lighting_security_multiplier, night_work_allowed, watch_policy_multiplier, work_fatigue_target,
};
use crate::simulation::game_calendar::GameClock;
use crate::simulation::residence_needs::state::{
    load_needs, migrate_and_sync_food_inventory, need_stock, persist_needs,
};
use crate::simulation::residence_needs::ResidenceNeedKind;
use crate::tables::{Building, Residence};

const EVENING_MEAL_PER_PERSON: f64 = 0.08;
const RESTED_SETTLEMENT_PROGRESS: u32 = 2;

pub fn step_night_cycle(
    ctx: &ReducerContext,
    previous_clock: &GameClock,
    clock: &GameClock,
    world_seed: u64,
) {
    if previous_clock.is_work_hours || !clock.is_work_hours || clock.hour != 6 {
        return;
    }

    let owners: Vec<Identity> = ctx
        .db
        .player_resources()
        .iter()
        .map(|row| row.owner)
        .collect();
    for owner in owners {
        complete_night_for_owner(ctx, owner, clock.total_days, clock.sim_tick, world_seed);
    }
}

fn complete_night_for_owner(
    ctx: &ReducerContext,
    owner: Identity,
    report_day: u64,
    sim_tick: u64,
    world_seed: u64,
) {
    let Some(mut resources) = ctx.db.player_resources().owner().find(&owner) else {
        return;
    };
    if resources.last_night_report_day == report_day {
        return;
    }

    let mut residences: Vec<Residence> = ctx
        .db
        .residence()
        .owner()
        .filter(&owner)
        .filter(|residence| !residence.abandoned && residence.tier > 0 && residence.population > 0)
        .collect();
    residences.sort_by_key(|residence| residence.id);
    let household_count = residences.len() as u32;
    let population = residences
        .iter()
        .map(|residence| residence.population)
        .sum::<u32>();
    let active_raid = ctx.db.active_raid().owner().find(&owner).is_some();
    let night_ticks = (CALENDAR_SECONDS_PER_DAY * (10.0 / 24.0) / TICK_DT).round() as u64;
    let recent_fire_cutoff = sim_tick.saturating_sub(night_ticks);
    let recent_fires = ctx
        .db
        .fire_incident()
        .owner()
        .filter(&owner)
        .filter(|fire| fire.started_tick >= recent_fire_cutoff)
        .count() as u32;

    let buildings: Vec<Building> = ctx
        .db
        .building()
        .owner()
        .filter(&owner)
        .filter(|building| building.construction_complete)
        .collect();
    let night_workers = buildings
        .iter()
        .filter(|building| night_work_allowed(resources.night_work_policy, &building.kind))
        .map(|building| building.assigned_labor)
        .sum::<u32>();
    let tired_household_slots = match resources.night_work_policy {
        crate::night_policy::NIGHT_WORK_STAFFED => night_workers.div_ceil(2),
        crate::night_policy::NIGHT_WORK_CONTINUOUS => night_workers.div_ceil(5),
        _ => 0,
    }
    .min(household_count);
    let cohesion_progress_bonus =
        (resources.night_community_cohesion.clamp(0.0, 1.0) * 2.0).round() as u32;

    let mut well_rested = 0u32;
    let mut cold_households = 0u32;
    for (household_index, residence) in residences.iter().enumerate() {
        let mut current = residence.clone();
        let mut needs = load_needs(ctx, residence.id);
        migrate_and_sync_food_inventory(&mut current, &mut needs);
        let warm = residence.tier < 1
            || (need_stock(&needs, ResidenceNeedKind::Firewood) > 1e-6
                && needs
                    .iter()
                    .find(|need| need.kind == ResidenceNeedKind::Firewood)
                    .map(|need| need.deficit_ticks == 0)
                    .unwrap_or(false));
        if !warm {
            cold_households += 1;
        }

        let meal_due = EVENING_MEAL_PER_PERSON * residence.population as f64;
        let fresh_used = withdraw_residence_fresh_food(&mut current, meal_due);
        let preserved_used = if fresh_used + 1e-6 < meal_due && residence.tier >= 3 {
            withdraw_residence_preserved_food(&mut current, meal_due - fresh_used)
        } else {
            0.0
        };
        let fed = fresh_used + preserved_used + 1e-6 >= meal_due;
        migrate_and_sync_food_inventory(&mut current, &mut needs);
        persist_needs(ctx, residence.id, &needs);

        let worked_night_shift = household_index < tired_household_slots as usize;
        if fed && warm && !active_raid && !worked_night_shift {
            well_rested += 1;
            if residence.population < residence.population_capacity {
                current.settlement_ticks = current
                    .settlement_ticks
                    .saturating_add(RESTED_SETTLEMENT_PROGRESS + cohesion_progress_bonus);
            }
        }
        ctx.db.residence().id().update(current);
    }

    let social_households = ((household_count as f64
        * gathering_share(
            resources.night_gathering_policy,
            resources.night_curfew_policy,
        ))
    .round() as u32)
        .min(household_count);

    let watch_staff = buildings
        .iter()
        .filter(|building| building.kind == "watchtower")
        .map(|building| building.assigned_labor as f64)
        .sum::<f64>();
    let guards = buildings
        .iter()
        .filter(|building| building.kind == "guardhouse")
        .map(|building| armed_guards(building.assigned_labor, building.polearms))
        .sum::<f64>();
    let watch_strength =
        (watch_staff * 1.5 + guards) * watch_policy_multiplier(resources.night_watch_policy);

    let requested_light_fuel =
        household_count as f64 * lighting_firewood_per_household(resources.night_lighting_policy);
    let lighting_fuel_used = withdraw_owner_building_firewood(ctx, owner, requested_light_fuel);
    let lighting_shortfall = (requested_light_fuel - lighting_fuel_used).max(0.0);
    let lighting_supply_ratio = if requested_light_fuel <= 1e-9 {
        1.0
    } else {
        lighting_fuel_used / requested_light_fuel
    };

    let effective_security = (1.0 + watch_strength * 0.18)
        * lighting_security_multiplier(resources.night_lighting_policy)
        * (0.65 + lighting_supply_ratio * 0.35)
        * curfew_security_multiplier(resources.night_curfew_policy);
    let theft_chance = (0.055 / effective_security.max(0.25)).clamp(0.005, 0.16);
    let theft_roll = deterministic_unit(world_seed, report_day, &owner, 0x5448_4546_54);
    let theft_gold = if household_count > 0 && theft_roll < theft_chance && !active_raid {
        steal_from_richest_household(ctx, &residences)
    } else {
        0.0
    };
    let wildlife_sightings =
        (deterministic_unit(world_seed, report_day, &owner, 0x5749_4c44) < 0.1) as u32;
    let incidents = recent_fires + u32::from(theft_gold > 1e-9);

    let social_ratio = social_households as f64 / household_count.max(1) as f64;
    let safety_ratio = (effective_security / 2.5).clamp(0.0, 1.0);
    let cohesion_target = (0.35 + social_ratio * 0.45 + safety_ratio * 0.2
        - if incidents > 0 { 0.12 } else { 0.0 })
    .clamp(0.0, 1.0);
    let fatigue_target =
        work_fatigue_target(resources.night_work_policy, night_workers, population);

    resources.last_night_report_day = report_day;
    resources.last_night_households = household_count;
    resources.last_night_well_rested_households = well_rested;
    resources.last_night_cold_households = cold_households;
    resources.last_night_social_households = social_households;
    resources.last_night_workers = night_workers;
    resources.last_night_watch_strength = watch_strength;
    resources.last_night_incidents = incidents;
    resources.last_night_theft_gold = theft_gold;
    resources.last_night_wildlife_sightings = wildlife_sightings;
    resources.last_night_lighting_fuel_used = lighting_fuel_used;
    resources.last_night_lighting_fuel_shortfall = lighting_shortfall;
    resources.night_community_cohesion =
        (resources.night_community_cohesion * 0.75 + cohesion_target * 0.25).clamp(0.0, 1.0);
    resources.night_labor_fatigue =
        (resources.night_labor_fatigue * 0.65 + fatigue_target * 0.35).clamp(0.0, 1.0);
    ctx.db.player_resources().owner().update(resources);
}

fn withdraw_owner_building_firewood(ctx: &ReducerContext, owner: Identity, amount: f64) -> f64 {
    let mut candidates: Vec<Building> = ctx
        .db
        .building()
        .owner()
        .filter(&owner)
        .filter(|building| building.construction_complete && building.firewood > 1e-9)
        .collect();
    candidates.sort_by_key(|building| {
        let priority = match building.kind.as_str() {
            "village_storehouse" => 0,
            "woodcutters_lodge" => 1,
            "founders_camp" => 2,
            _ => 3,
        };
        (priority, building.id)
    });

    let mut remaining = amount.max(0.0);
    let mut withdrawn = 0.0;
    for mut building in candidates {
        if remaining <= 1e-9 {
            break;
        }
        let taken = withdraw_building_commodity(&mut building, CommodityKind::Firewood, remaining);
        if taken > 1e-9 {
            ctx.db.building().id().update(building);
            remaining -= taken;
            withdrawn += taken;
        }
    }
    withdrawn
}

fn steal_from_richest_household(ctx: &ReducerContext, residences: &[Residence]) -> f64 {
    let Some(victim) = residences
        .iter()
        .max_by(|a, b| {
            a.household_wealth
                .partial_cmp(&b.household_wealth)
                .unwrap_or(Ordering::Equal)
                .then_with(|| b.id.cmp(&a.id))
        })
        .filter(|residence| residence.household_wealth > 1e-9)
    else {
        return 0.0;
    };
    debit_residence_wealth(ctx, victim, victim.household_wealth.min(1.5))
}

fn deterministic_unit(seed: u64, day: u64, owner: &Identity, salt: u64) -> f64 {
    let mut hash = seed ^ day.wrapping_mul(0x9E37_79B9_7F4A_7C15) ^ salt;
    for byte in format!("{owner:?}").bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x100_0000_01B3);
    }
    hash ^= hash >> 30;
    hash = hash.wrapping_mul(0xBF58_476D_1CE4_E5B9);
    hash ^= hash >> 27;
    hash = hash.wrapping_mul(0x94D0_49BB_1331_11EB);
    hash ^= hash >> 31;
    hash as f64 / u64::MAX as f64
}

#[cfg(test)]
mod tests {
    use super::deterministic_unit;

    #[test]
    fn deterministic_roll_stays_in_unit_interval() {
        let owner = spacetimedb::Identity::ZERO;
        let a = deterministic_unit(12, 4, &owner, 9);
        let b = deterministic_unit(12, 4, &owner, 9);
        assert_eq!(a, b);
        assert!((0.0..=1.0).contains(&a));
    }
}
