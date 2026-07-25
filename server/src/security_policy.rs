use std::cmp::Ordering;

pub const MIN_FRONTIER_POPULATION: u32 = 8;
pub const SECURITY_UPDATE_INTERVAL_TICKS: u64 = 300;
pub const RAID_SEASON_START_MONTH: u32 = 4;
pub const RAID_SEASON_END_MONTH: u32 = 10;

pub fn is_raid_season(month: u32) -> bool {
    (RAID_SEASON_START_MONTH..=RAID_SEASON_END_MONTH).contains(&month)
}

pub fn raid_interval_days(enemy_pressure: u8) -> f64 {
    let pressure = (enemy_pressure.min(100) as f64 / 100.0).max(0.01);
    20.0 - pressure * 12.0
}

pub fn first_raid_delay_days(enemy_pressure: u8) -> f64 {
    raid_interval_days(enemy_pressure) + 3.0
}

pub fn scheduled_raid_ticks(
    enemy_pressure: u8,
    ticks_per_day: u64,
    entropy: u64,
    first_raid: bool,
) -> u64 {
    let base_days = if first_raid {
        first_raid_delay_days(enemy_pressure)
    } else {
        raid_interval_days(enemy_pressure)
    };
    let jitter = 0.86 + unit_hash(entropy) * 0.28;
    (base_days * jitter * ticks_per_day as f64).round().max(1.0) as u64
}

pub fn threat_progress(last_raid_tick: u64, next_raid_tick: u64, sim_tick: u64) -> f64 {
    if next_raid_tick == 0 || next_raid_tick <= last_raid_tick {
        return 0.0;
    }
    let interval = next_raid_tick - last_raid_tick;
    let elapsed = sim_tick.saturating_sub(last_raid_tick);
    (elapsed as f64 / interval as f64).clamp(0.0, 1.0)
}

pub fn tower_effective_radius(work_radius: f64, assigned_labor: u32) -> f64 {
    match assigned_labor {
        0 => 0.0,
        1 => work_radius * 0.78,
        _ => work_radius,
    }
}

pub fn raid_loss_fraction(enemy_pressure: u8, coverage: f64) -> f64 {
    let pressure = enemy_pressure.min(100) as f64 / 100.0;
    let exposed_loss = 0.12 + pressure * 0.2;
    (exposed_loss * (1.0 - coverage.clamp(0.0, 1.0) * 0.88)).clamp(0.0, 0.4)
}

pub fn raid_target_count(enemy_pressure: u8) -> usize {
    1 + enemy_pressure.min(100) as usize / 35
}

pub fn raid_strength(enemy_pressure: u8) -> f64 {
    2.5 + enemy_pressure.min(100) as f64 * 0.065
}

/// Guards fight most effectively when watch coverage gives them time to muster.
/// A ratio of one means the settlement can avert this incursion.
pub fn guard_defense_ratio(enemy_pressure: u8, coverage: f64, ready_guards: f64) -> f64 {
    let warning_multiplier = 0.65 + coverage.clamp(0.0, 1.0) * 0.35;
    (ready_guards.max(0.0) * warning_multiplier / raid_strength(enemy_pressure)).clamp(0.0, 1.0)
}

pub fn guarded_raid_loss_fraction(enemy_pressure: u8, coverage: f64, ready_guards: f64) -> f64 {
    let defense = guard_defense_ratio(enemy_pressure, coverage, ready_guards);
    if defense >= 1.0 - 1e-9 {
        0.0
    } else {
        raid_loss_fraction(enemy_pressure, coverage) * (1.0 - defense * 0.8)
    }
}

pub fn guarded_raid_target_count(enemy_pressure: u8, defense_ratio: f64) -> usize {
    if defense_ratio >= 1.0 - 1e-9 {
        return 0;
    }
    ((raid_target_count(enemy_pressure) as f64) * (1.0 - defense_ratio * 0.65))
        .ceil()
        .max(1.0) as usize
}

pub fn compare_raid_targets(
    a_protected: bool,
    a_value: f64,
    a_id: u64,
    b_protected: bool,
    b_value: f64,
    b_id: u64,
) -> Ordering {
    a_protected
        .cmp(&b_protected)
        .then_with(|| b_value.total_cmp(&a_value))
        .then_with(|| a_id.cmp(&b_id))
}

fn unit_hash(entropy: u64) -> f64 {
    let mut value = entropy.wrapping_add(0x9e37_79b9_7f4a_7c15);
    value = (value ^ (value >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    value = (value ^ (value >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    value ^= value >> 31;
    (value >> 11) as f64 / ((1u64 << 53) - 1) as f64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn winter_is_outside_the_raid_season() {
        assert!(!is_raid_season(1));
        assert!(is_raid_season(4));
        assert!(is_raid_season(10));
        assert!(!is_raid_season(12));
    }

    #[test]
    fn higher_pressure_shortens_the_planning_window() {
        assert!(raid_interval_days(20) > raid_interval_days(50));
        assert!(raid_interval_days(50) > raid_interval_days(90));
        assert!(first_raid_delay_days(50) > raid_interval_days(50));
    }

    #[test]
    fn staffed_towers_gain_full_radius_with_a_second_watchman() {
        assert_eq!(tower_effective_radius(190.0, 0), 0.0);
        assert!((tower_effective_radius(190.0, 1) - 148.2).abs() < 1e-9);
        assert_eq!(tower_effective_radius(190.0, 2), 190.0);
    }

    #[test]
    fn coverage_materially_reduces_plunder() {
        let exposed = raid_loss_fraction(50, 0.0);
        let guarded = raid_loss_fraction(50, 0.8);
        assert!(guarded < exposed * 0.4);
        assert!(raid_loss_fraction(90, 0.0) > exposed);
    }

    #[test]
    fn pressure_increases_the_number_of_exposed_targets() {
        assert_eq!(raid_target_count(10), 1);
        assert_eq!(raid_target_count(50), 2);
        assert_eq!(raid_target_count(90), 3);
    }

    #[test]
    fn paid_guards_and_warning_can_avert_a_mid_pressure_raid() {
        let uncovered = guard_defense_ratio(50, 0.0, 6.0);
        let warned = guard_defense_ratio(50, 1.0, 6.0);
        assert!(warned > uncovered);
        assert_eq!(warned, 1.0);
        assert_eq!(guarded_raid_loss_fraction(50, 1.0, 6.0), 0.0);
        assert_eq!(guarded_raid_target_count(50, warned), 0);
    }

    #[test]
    fn partial_guard_strength_reduces_but_does_not_erase_losses() {
        let unguarded = raid_loss_fraction(90, 0.25);
        let guarded = guarded_raid_loss_fraction(90, 0.25, 3.0);
        assert!(guarded > 0.0);
        assert!(guarded < unguarded);
    }

    #[test]
    fn exposed_high_value_targets_sort_first() {
        assert_eq!(
            compare_raid_targets(false, 10.0, 2, true, 100.0, 1),
            Ordering::Less
        );
        assert_eq!(
            compare_raid_targets(false, 10.0, 2, false, 5.0, 1),
            Ordering::Less
        );
    }
}
