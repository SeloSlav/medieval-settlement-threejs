use std::cmp::Ordering;

use spacetimedb::{Identity, ReducerContext};

use crate::balance_generated::{CALENDAR_SECONDS_PER_DAY, TICK_DT};
use crate::db::*;
use crate::economy::debit_residence_wealth;
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
use crate::tables::{Building, Residence, Settlement};

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

    let settlements: Vec<Settlement> = ctx
        .db
        .settlement()
        .iter()
        .filter(|settlement| settlement.active)
        .collect();
    for settlement in settlements {
        complete_night_for_settlement(
            ctx,
            settlement,
            clock.total_days,
            clock.sim_tick,
            world_seed,
        );
    }
}

fn complete_night_for_settlement(
    ctx: &ReducerContext,
    mut settlement: Settlement,
    report_day: u64,
    sim_tick: u64,
    world_seed: u64,
) {
    let owner = settlement.owner;
    if settlement.last_night_report_day == report_day {
        return;
    }

    let mut residences: Vec<Residence> = ctx
        .db
        .residence()
        .owner()
        .filter(&owner)
        .filter(|residence| {
            residence.settlement_id == settlement.id
                && !residence.abandoned
                && residence.tier > 0
                && residence.population > 0
        })
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
        .filter(|building| {
            building.settlement_id == settlement.id && building.construction_complete
        })
        .collect();
    let night_workers = buildings
        .iter()
        .filter(|building| night_work_allowed(settlement.night_work_policy, &building.kind))
        .map(|building| building.assigned_labor)
        .sum::<u32>();
    let tired_household_slots = match settlement.night_work_policy {
        crate::night_policy::NIGHT_WORK_STAFFED => night_workers.div_ceil(2),
        crate::night_policy::NIGHT_WORK_CONTINUOUS => night_workers.div_ceil(5),
        _ => 0,
    }
    .min(household_count);
    let cohesion_progress_bonus =
        (settlement.night_community_cohesion.clamp(0.0, 1.0) * 2.0).round() as u32;

    let mut well_rested = 0u32;
    let mut cold_households = 0u32;
    for (household_index, residence) in residences.iter().enumerate() {
        let mut current = residence.clone();
        let mut needs = load_needs(ctx, residence.id);
        migrate_and_sync_food_inventory(ctx, &mut current, &mut needs);
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

        // The monthly tier slots are the single authoritative household food
        // charge. Night reports observe that result instead of silently
        // burning a second, per-person meal from the same pantry.
        let fed = needs
            .iter()
            .find(|need| need.kind == ResidenceNeedKind::Food)
            .is_some_and(|need| need.deficit_ticks == 0);
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
            settlement.night_gathering_policy,
            settlement.night_curfew_policy,
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
        (watch_staff * 1.5 + guards) * watch_policy_multiplier(settlement.night_watch_policy);

    // Lighting fuel is included in the household's one monthly firewood unit.
    // Keep the legacy report fields at zero instead of charging an additional
    // nightly fractional resource stream.
    let _bundled_lighting_share =
        lighting_firewood_per_household(settlement.night_lighting_policy);
    let lighting_fuel_used = 0.0;
    let lighting_shortfall = 0.0;
    let lighting_supply_ratio = 1.0;

    let effective_security = (1.0 + watch_strength * 0.18)
        * lighting_security_multiplier(settlement.night_lighting_policy)
        * (0.65 + lighting_supply_ratio * 0.35)
        * curfew_security_multiplier(settlement.night_curfew_policy);
    let theft_chance = (0.055 / effective_security.max(0.25)).clamp(0.005, 0.16);
    let theft_roll = deterministic_unit(
        world_seed,
        report_day,
        &owner,
        0x5448_4546_54 ^ settlement.id,
    );
    let theft_gold = if household_count > 0 && theft_roll < theft_chance && !active_raid {
        steal_from_richest_household(ctx, &residences)
    } else {
        0.0
    };
    let wildlife_sightings =
        (deterministic_unit(
            world_seed,
            report_day,
            &owner,
            0x5749_4c44 ^ settlement.id,
        ) < 0.1) as u32;
    let incidents = recent_fires + u32::from(theft_gold > 1e-9);

    let social_ratio = social_households as f64 / household_count.max(1) as f64;
    let safety_ratio = (effective_security / 2.5).clamp(0.0, 1.0);
    let cohesion_target = (0.35 + social_ratio * 0.45 + safety_ratio * 0.2
        - if incidents > 0 { 0.12 } else { 0.0 })
    .clamp(0.0, 1.0);
    let fatigue_target =
        work_fatigue_target(settlement.night_work_policy, night_workers, population);

    settlement.last_night_report_day = report_day;
    settlement.last_night_households = household_count;
    settlement.last_night_well_rested_households = well_rested;
    settlement.last_night_cold_households = cold_households;
    settlement.last_night_social_households = social_households;
    settlement.last_night_workers = night_workers;
    settlement.last_night_watch_strength = watch_strength;
    settlement.last_night_incidents = incidents;
    settlement.last_night_theft_gold = theft_gold;
    settlement.last_night_wildlife_sightings = wildlife_sightings;
    settlement.last_night_lighting_fuel_used = lighting_fuel_used;
    settlement.last_night_lighting_fuel_shortfall = lighting_shortfall;
    settlement.night_community_cohesion =
        (settlement.night_community_cohesion * 0.75 + cohesion_target * 0.25).clamp(0.0, 1.0);
    settlement.night_labor_fatigue =
        (settlement.night_labor_fatigue * 0.65 + fatigue_target * 0.35).clamp(0.0, 1.0);
    ctx.db.settlement().id().update(settlement);
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
    debit_residence_wealth(ctx, victim, victim.household_wealth.min(2.0))
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
