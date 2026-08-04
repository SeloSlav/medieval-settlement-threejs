//! Pure resident-health and vacant-building rules shared by the WASM module
//! and native policy tests.

use std::collections::HashMap;

use crate::balance_generated::{
    CALENDAR_SECONDS_PER_DAY, HUNGER_WARNING_DAYS, MALNUTRITION_DAYS, MALNUTRITION_RECOVERY_DAYS, RESIDENCE_DILAPIDATED_DAYS,
    RESIDENCE_DILAPIDATED_REPAIR_STONE, RESIDENCE_DILAPIDATED_REPAIR_TIMBER,
    RESIDENCE_NEGLECTED_DAYS, RESIDENCE_NEGLECTED_REPAIR_STONE, RESIDENCE_NEGLECTED_REPAIR_TIMBER,
    RESIDENCE_RUINED_DAYS, RESIDENCE_RUINED_REPAIR_STONE, RESIDENCE_RUINED_REPAIR_TIMBER,
    STARVATION_DEATH_INTERVAL_DAYS, STARVATION_DEATH_START_DAYS, TICK_DT,
};

pub const HEALTH_STAGE_WELL: u8 = 0;
pub const HEALTH_STAGE_HUNGRY: u8 = 1;
pub const HEALTH_STAGE_MALNOURISHED: u8 = 2;
pub const HEALTH_STAGE_STARVING: u8 = 3;

pub const RESIDENCE_CONDITION_SOUND: u8 = 0;
pub const RESIDENCE_CONDITION_NEGLECTED: u8 = 1;
pub const RESIDENCE_CONDITION_DILAPIDATED: u8 = 2;
pub const RESIDENCE_CONDITION_RUIN: u8 = 3;

pub fn ticks_for_days(days: f64) -> u32 {
    ((days.max(0.0) * CALENDAR_SECONDS_PER_DAY / TICK_DT).round() as u64).min(u64::from(u32::MAX))
        as u32
}

pub fn hunger_stage(hunger_ticks: u32) -> u8 {
    if hunger_ticks >= ticks_for_days(STARVATION_DEATH_START_DAYS) {
        HEALTH_STAGE_STARVING
    } else if hunger_ticks >= ticks_for_days(MALNUTRITION_DAYS) {
        HEALTH_STAGE_MALNOURISHED
    } else if hunger_ticks >= ticks_for_days(HUNGER_WARNING_DAYS) {
        HEALTH_STAGE_HUNGRY
    } else {
        HEALTH_STAGE_WELL
    }
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

pub fn starvation_death_due(hunger_ticks: u32, last_death_hunger_ticks: u32) -> bool {
    let first = ticks_for_days(STARVATION_DEATH_START_DAYS);
    if hunger_stage(hunger_ticks) != HEALTH_STAGE_STARVING {
        return false;
    }
    let interval = ticks_for_days(STARVATION_DEATH_INTERVAL_DAYS).max(1);
    if last_death_hunger_ticks < first {
        return true;
    }
    hunger_ticks.saturating_sub(last_death_hunger_ticks) >= interval
}

pub fn starvation_episode_resolved(hunger_ticks: u32) -> bool {
    hunger_stage(hunger_ticks) != HEALTH_STAGE_STARVING
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

pub fn residence_condition(vacancy_ticks: u32) -> u8 {
    if vacancy_ticks >= ticks_for_days(RESIDENCE_RUINED_DAYS) {
        RESIDENCE_CONDITION_RUIN
    } else if vacancy_ticks >= ticks_for_days(RESIDENCE_DILAPIDATED_DAYS) {
        RESIDENCE_CONDITION_DILAPIDATED
    } else if vacancy_ticks >= ticks_for_days(RESIDENCE_NEGLECTED_DAYS) {
        RESIDENCE_CONDITION_NEGLECTED
    } else {
        RESIDENCE_CONDITION_SOUND
    }
}

pub fn condition_blocks_resettlement(condition: u8) -> bool {
    condition >= RESIDENCE_CONDITION_DILAPIDATED
}

pub fn repair_cost(condition: u8) -> (f64, f64) {
    match condition {
        RESIDENCE_CONDITION_NEGLECTED => (
            RESIDENCE_NEGLECTED_REPAIR_TIMBER,
            RESIDENCE_NEGLECTED_REPAIR_STONE,
        ),
        RESIDENCE_CONDITION_DILAPIDATED => (
            RESIDENCE_DILAPIDATED_REPAIR_TIMBER,
            RESIDENCE_DILAPIDATED_REPAIR_STONE,
        ),
        RESIDENCE_CONDITION_RUIN..=u8::MAX => (
            RESIDENCE_RUINED_REPAIR_TIMBER,
            RESIDENCE_RUINED_REPAIR_STONE,
        ),
        _ => (0.0, 0.0),
    }
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
    fn hunger_advances_through_reversible_stages_before_death() {
        assert_eq!(hunger_stage(0), HEALTH_STAGE_WELL);
        assert_eq!(
            hunger_stage(ticks_for_days(HUNGER_WARNING_DAYS)),
            HEALTH_STAGE_HUNGRY
        );
        assert_eq!(
            hunger_stage(ticks_for_days(MALNUTRITION_DAYS)),
            HEALTH_STAGE_MALNOURISHED
        );
        let fatal = ticks_for_days(STARVATION_DEATH_START_DAYS);
        assert_eq!(hunger_stage(fatal), HEALTH_STAGE_STARVING);
        assert!(starvation_death_due(fatal, 0));
        assert!(!starvation_death_due(fatal + 1, fatal));
        assert!(starvation_death_due(
            fatal + ticks_for_days(STARVATION_DEATH_INTERVAL_DAYS),
            fatal
        ));
        assert!(!starvation_episode_resolved(fatal));
        assert!(starvation_episode_resolved(fatal - 1));
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
    fn empty_homes_decay_slowly_and_each_stage_has_a_repair_cost() {
        assert_eq!(residence_condition(0), RESIDENCE_CONDITION_SOUND);
        assert_eq!(
            residence_condition(ticks_for_days(RESIDENCE_NEGLECTED_DAYS)),
            RESIDENCE_CONDITION_NEGLECTED
        );
        assert_eq!(
            residence_condition(ticks_for_days(RESIDENCE_DILAPIDATED_DAYS)),
            RESIDENCE_CONDITION_DILAPIDATED
        );
        assert_eq!(
            residence_condition(ticks_for_days(RESIDENCE_RUINED_DAYS)),
            RESIDENCE_CONDITION_RUIN
        );
        assert_eq!(repair_cost(RESIDENCE_CONDITION_SOUND), (0.0, 0.0));
        assert!(repair_cost(RESIDENCE_CONDITION_RUIN).0 > 0.0);
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
