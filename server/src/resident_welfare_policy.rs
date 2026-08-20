//! Pure resident-health and vacant-building rules shared by the WASM module
//! and native policy tests.

use std::collections::HashMap;

use crate::balance_generated::{
    CALENDAR_SECONDS_PER_DAY, COLD_EXPOSURE_DEATH_CHANCE_PER_PERSON_DAY,
    COLD_EXPOSURE_DEATH_MAX_CHANCE_PER_PERSON_DAY, COLD_EXPOSURE_DEATH_RISK_RAMP_DAYS,
    COLD_EXPOSURE_DEATH_START_DAYS, MALNUTRITION_DAYS, MALNUTRITION_RECOVERY_DAYS,
    STARVATION_DEATH_CHANCE_PER_PERSON_DAY, STARVATION_DEATH_MAX_CHANCE_PER_PERSON_DAY,
    STARVATION_DEATH_RISK_RAMP_DAYS, STARVATION_DEATH_START_DAYS, TICK_DT,
};

pub fn ticks_for_days(days: f64) -> u32 {
    ((days.max(0.0) * CALENDAR_SECONDS_PER_DAY / TICK_DT).round() as u64).min(u64::from(u32::MAX))
        as u32
}

pub fn malnutrition_target(hunger_ticks: u32) -> f64 {
    let start = ticks_for_days(MALNUTRITION_DAYS);
    let fatal = ticks_for_days(STARVATION_DEATH_START_DAYS).max(start + 1);
    if hunger_ticks <= start {
        0.0
    } else {
        f64::from(hunger_ticks - start) / f64::from(fatal - start)
    }
    .clamp(0.0, 1.0)
}

pub fn starvation_death_chance(population: u32, hunger_ticks: u32) -> f64 {
    shortage_death_chance(
        population,
        hunger_ticks,
        STARVATION_DEATH_START_DAYS,
        STARVATION_DEATH_CHANCE_PER_PERSON_DAY,
        STARVATION_DEATH_MAX_CHANCE_PER_PERSON_DAY,
        STARVATION_DEATH_RISK_RAMP_DAYS,
    )
}

pub fn cold_exposure_death_chance(population: u32, cold_exposure_ticks: u32) -> f64 {
    shortage_death_chance(
        population,
        cold_exposure_ticks,
        COLD_EXPOSURE_DEATH_START_DAYS,
        COLD_EXPOSURE_DEATH_CHANCE_PER_PERSON_DAY,
        COLD_EXPOSURE_DEATH_MAX_CHANCE_PER_PERSON_DAY,
        COLD_EXPOSURE_DEATH_RISK_RAMP_DAYS,
    )
}

/// Converts a per-person daily hazard into a simulation-step household chance.
/// The grace period and gradual risk ramp keep short logistics failures
/// survivable while making prolonged total shortages increasingly lethal.
fn shortage_death_chance(
    population: u32,
    exposure_ticks: u32,
    start_days: f64,
    initial_chance_per_person_day: f64,
    max_chance_per_person_day: f64,
    risk_ramp_days: f64,
) -> f64 {
    if population == 0 || exposure_ticks < ticks_for_days(start_days) {
        return 0.0;
    }
    let exposure_days = f64::from(exposure_ticks) * TICK_DT / CALENDAR_SECONDS_PER_DAY;
    let severity = ((exposure_days - start_days) / risk_ramp_days.max(TICK_DT)).clamp(0.0, 1.0);
    let daily_per_person = (initial_chance_per_person_day
        + (max_chance_per_person_day - initial_chance_per_person_day) * severity)
        .clamp(0.0, 1.0);
    let person_tick_exposure = population as f64 * TICK_DT / CALENDAR_SECONDS_PER_DAY;
    (1.0 - (1.0 - daily_per_person).powf(person_tick_exposure)).clamp(0.0, 1.0)
}

pub fn next_service_deficit_ticks(
    previous_ticks: u32,
    comfort_unmet: bool,
    consumption_paused: bool,
) -> u32 {
    if consumption_paused {
        previous_ticks
    } else if comfort_unmet {
        previous_ticks.saturating_add(1)
    } else {
        previous_ticks.saturating_sub(2)
    }
}

pub fn next_malnutrition(
    current: f64,
    hunger_ticks: u32,
    food_unmet: bool,
    consumption_paused: bool,
) -> f64 {
    let current = if current.is_finite() {
        current.clamp(0.0, 1.0)
    } else {
        0.0
    };
    let target = malnutrition_target(hunger_ticks);
    if target > current {
        return target;
    }
    if food_unmet || consumption_paused {
        return current;
    }
    let recovery_per_tick =
        TICK_DT / (MALNUTRITION_RECOVERY_DAYS * CALENDAR_SECONDS_PER_DAY).max(TICK_DT);
    (current - recovery_per_tick).max(0.0)
}

/// Stable pseudo-random unit value. It does not depend on table iteration
/// order, so reconnects and replayed ticks cannot change who becomes ill.
pub fn deterministic_unit(seed: u64, tick: u64, entity_id: u64, salt: u64) -> f64 {
    let mut value = seed
        ^ tick.wrapping_mul(0x9E37_79B9_7F4A_7C15)
        ^ entity_id.wrapping_mul(0xBF58_476D_1CE4_E5B9)
        ^ salt;
    value ^= value >> 30;
    value = value.wrapping_mul(0xBF58_476D_1CE4_E5B9);
    value ^= value >> 27;
    value = value.wrapping_mul(0x94D0_49BB_1331_11EB);
    value ^= value >> 31;
    (value as f64) / (u64::MAX as f64)
}

/// Fixed-cell lookup for bodies that still remain at a residence. Disease
/// pressure queries inspect at most the neighboring cells touched by the
/// configured radius instead of rescanning every body for every home.
#[derive(Default)]
pub struct CorpseSpatialIndex {
    cell_size: f64,
    cells: HashMap<(i32, i32), Vec<(f64, f64)>>,
}

impl CorpseSpatialIndex {
    pub fn new(cell_size: f64) -> Self {
        Self {
            cell_size: finite_positive(cell_size),
            cells: HashMap::new(),
        }
    }

    pub fn insert(&mut self, x: f64, z: f64) {
        if !x.is_finite() || !z.is_finite() {
            return;
        }
        self.cells
            .entry(self.cell_for(x, z))
            .or_default()
            .push((x, z));
    }

    pub fn count_within(&self, x: f64, z: f64, radius: f64) -> usize {
        if !x.is_finite() || !z.is_finite() || !radius.is_finite() || radius < 0.0 {
            return 0;
        }
        let radius_sq = radius * radius;
        let min_x = ((x - radius) / self.cell_size).floor() as i32;
        let max_x = ((x + radius) / self.cell_size).floor() as i32;
        let min_z = ((z - radius) / self.cell_size).floor() as i32;
        let max_z = ((z + radius) / self.cell_size).floor() as i32;
        let mut count = 0;
        for cell_z in min_z..=max_z {
            for cell_x in min_x..=max_x {
                let Some(entries) = self.cells.get(&(cell_x, cell_z)) else {
                    continue;
                };
                count += entries
                    .iter()
                    .filter(|(corpse_x, corpse_z)| {
                        let dx = corpse_x - x;
                        let dz = corpse_z - z;
                        dx * dx + dz * dz <= radius_sq
                    })
                    .count();
            }
        }
        count
    }

    fn cell_for(&self, x: f64, z: f64) -> (i32, i32) {
        (
            (x / self.cell_size).floor() as i32,
            (z / self.cell_size).floor() as i32,
        )
    }
}

fn finite_positive(value: f64) -> f64 {
    if value.is_finite() && value > 1e-6 {
        value
    } else {
        1.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn starvation_mortality_starts_after_a_grace_period_and_then_ramps() {
        let fatal = ticks_for_days(STARVATION_DEATH_START_DAYS);
        assert_eq!(starvation_death_chance(3, fatal - 1), 0.0);
        assert!(starvation_death_chance(3, fatal) > 0.0);
        assert!(
            starvation_death_chance(3, fatal + ticks_for_days(STARVATION_DEATH_RISK_RAMP_DAYS))
                > starvation_death_chance(3, fatal)
        );
    }

    #[test]
    fn winter_exposure_has_a_multi_day_grace_period_and_population_scaled_risk() {
        let first_risk = ticks_for_days(COLD_EXPOSURE_DEATH_START_DAYS);
        assert_eq!(cold_exposure_death_chance(4, first_risk - 1), 0.0);
        assert!(cold_exposure_death_chance(4, first_risk) > 0.0);
        assert!(
            cold_exposure_death_chance(4, first_risk) > cold_exposure_death_chance(1, first_risk)
        );
        assert!(cold_exposure_death_chance(4, first_risk) < 1.0);
    }

    #[test]
    fn service_shortages_accumulate_and_recover_without_removing_residents() {
        assert_eq!(next_service_deficit_ticks(120, true, true), 120);
        assert_eq!(next_service_deficit_ticks(120, true, false), 121);
        assert_eq!(next_service_deficit_ticks(120, false, false), 118);
    }

    #[test]
    fn malnutrition_does_not_heal_during_a_paused_meal_window() {
        let current = 0.7;
        assert_eq!(next_malnutrition(current, 0, false, true), current);
        assert!(next_malnutrition(current, 0, false, false) < current);
    }

    #[test]
    fn deterministic_roll_is_repeatable_and_normalized() {
        let value = deterministic_unit(41, 99, 7, 3);
        assert_eq!(value, deterministic_unit(41, 99, 7, 3));
        assert!((0.0..=1.0).contains(&value));
        assert_ne!(value, deterministic_unit(41, 100, 7, 3));
    }

    #[test]
    fn corpse_spatial_index_counts_exact_neighbors_across_cell_edges() {
        let mut index = CorpseSpatialIndex::new(30.0);
        index.insert(29.0, 0.0);
        index.insert(31.0, 0.0);
        index.insert(-29.0, 0.0);
        index.insert(0.0, 31.0);
        assert_eq!(index.count_within(0.0, 0.0, 30.0), 2);
        assert_eq!(index.count_within(30.0, 0.0, 2.0), 2);
        assert_eq!(index.count_within(500.0, 500.0, 30.0), 0);
    }

    #[test]
    fn corpse_spatial_queries_stay_bounded_at_settlement_scale() {
        let mut index = CorpseSpatialIndex::new(30.0);
        for id in 0..100_000 {
            let x = (id % 1_000) as f64 * 8.0;
            let z = (id / 1_000) as f64 * 8.0;
            index.insert(x, z);
        }
        let started = std::time::Instant::now();
        let mut checksum = 0_usize;
        for id in 0..100_000 {
            checksum +=
                index.count_within((id % 1_000) as f64 * 8.0, (id / 1_000) as f64 * 8.0, 30.0);
        }
        assert!(checksum > 100_000);
        assert!(
            started.elapsed().as_millis() < 1_000,
            "100,000 indexed disease queries took {:?}",
            started.elapsed()
        );
    }
}
