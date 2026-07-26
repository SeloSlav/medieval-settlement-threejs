pub use crate::balance_generated::{
    CARPENTER_IRONWORK_PER_POLEARM, CARPENTER_TIMBER_PER_POLEARM,
    GUARDHOUSE_FOOD_PER_GUARD_PER_DAY, GUARDHOUSE_READINESS_DECAY_PER_DAY,
    GUARDHOUSE_TRAINING_PER_DAY, GUARDHOUSE_WAGE_PER_GUARD_PER_DAY,
};
use std::cmp::Ordering;

pub const GUARDHOUSE_CRITICAL_FOOD_RUNWAY_DAYS: f64 = 3.0;
pub const GUARDHOUSE_FOOD_BUFFER_PER_GUARD: f64 = 6.0;
pub const GUARDHOUSE_MIN_FOOD_BUFFER: f64 = 12.0;
pub const CARPENTER_POLEARM_RESERVE_DEFAULT: u8 = 6;
pub const CARPENTER_POLEARM_RESERVE_MAX: u8 = 24;
pub const GUARDHOUSE_PAY_PRIORITY_LOW: u8 = 0;
pub const GUARDHOUSE_PAY_PRIORITY_NORMAL: u8 = 1;
pub const GUARDHOUSE_PAY_PRIORITY_HIGH: u8 = 2;
pub const GUARDHOUSE_FOOD_RESERVE_LEAN: u8 = 3;
pub const GUARDHOUSE_FOOD_RESERVE_STANDARD: u8 = GUARDHOUSE_FOOD_BUFFER_PER_GUARD as u8;
pub const GUARDHOUSE_FOOD_RESERVE_DEEP: u8 = 12;

pub fn is_valid_carpenter_polearm_reserve(reserve: u8) -> bool {
    matches!(reserve, 0 | 2 | 6 | 12 | 24)
}

pub fn normalize_carpenter_polearm_reserve(reserve: u8) -> u8 {
    reserve.min(CARPENTER_POLEARM_RESERVE_MAX)
}

pub fn carpenter_polearm_shortfall(stock: f64, reserve: u8) -> f64 {
    (normalize_carpenter_polearm_reserve(reserve) as f64 - stock.max(0.0)).max(0.0)
}

pub fn guardhouse_polearm_target(assigned_labor: u32) -> f64 {
    assigned_labor as f64
}

pub fn is_valid_guardhouse_pay_priority(priority: u8) -> bool {
    (GUARDHOUSE_PAY_PRIORITY_LOW..=GUARDHOUSE_PAY_PRIORITY_HIGH).contains(&priority)
}

pub fn normalize_guardhouse_pay_priority(priority: u8) -> u8 {
    priority.min(GUARDHOUSE_PAY_PRIORITY_HIGH)
}

pub fn is_valid_guardhouse_food_reserve(reserve_per_guard: u8) -> bool {
    matches!(
        reserve_per_guard,
        GUARDHOUSE_FOOD_RESERVE_LEAN
            | GUARDHOUSE_FOOD_RESERVE_STANDARD
            | GUARDHOUSE_FOOD_RESERVE_DEEP
    )
}

pub fn normalize_guardhouse_food_reserve(reserve_per_guard: u8) -> u8 {
    if is_valid_guardhouse_food_reserve(reserve_per_guard) {
        reserve_per_guard
    } else {
        GUARDHOUSE_FOOD_RESERVE_STANDARD
    }
}

/// Buckets guard companies in one pass so scarce payroll is deterministic and
/// does not require sorting the entire mixed building roster. Within a policy
/// tier, older building ids are paid first.
pub fn guardhouse_payroll_buckets<T: Ord>(
    guardhouses: impl IntoIterator<Item = (u8, T)>,
) -> [Vec<T>; 3] {
    let mut buckets: [Vec<T>; 3] = std::array::from_fn(|_| Vec::new());
    for (priority, guardhouse) in guardhouses {
        buckets[normalize_guardhouse_pay_priority(priority) as usize].push(guardhouse);
    }
    for bucket in &mut buckets {
        bucket.sort_unstable();
    }
    buckets
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GuardUpkeep {
    pub food_due: f64,
    pub wage_due: f64,
    pub supply_ratio: f64,
}

pub fn armed_guards(assigned_labor: u32, polearms: f64) -> f64 {
    (assigned_labor as f64).min(polearms.floor().max(0.0))
}

pub fn guardhouse_food_target(
    assigned_labor: u32,
    polearms: f64,
    reserve_per_guard: u8,
) -> f64 {
    let armed = armed_guards(assigned_labor, polearms);
    if armed <= 1e-9 {
        0.0
    } else {
        let per_guard = normalize_guardhouse_food_reserve(reserve_per_guard) as f64;
        (armed * per_guard).max(GUARDHOUSE_MIN_FOOD_BUFFER)
    }
}

pub fn guardhouse_food_runway_days(assigned_labor: u32, polearms: f64, food_stock: f64) -> f64 {
    let daily_food = armed_guards(assigned_labor, polearms) * GUARDHOUSE_FOOD_PER_GUARD_PER_DAY;
    if daily_food <= 1e-9 {
        f64::INFINITY
    } else {
        food_stock.max(0.0) / daily_food
    }
}

pub fn compare_guardhouse_food_candidates(
    a_runway_days: f64,
    a_distance: f64,
    a_building_id: u64,
    b_runway_days: f64,
    b_distance: f64,
    b_building_id: u64,
) -> Ordering {
    a_runway_days
        .total_cmp(&b_runway_days)
        .then_with(|| a_distance.total_cmp(&b_distance))
        .then_with(|| a_building_id.cmp(&b_building_id))
}

pub fn select_guardhouse_food_candidate<T>(
    candidates: impl IntoIterator<Item = T>,
    runway_for: impl Fn(&T) -> f64,
    distance_for: impl Fn(&T) -> f64,
    building_id_for: impl Fn(&T) -> u64,
) -> Option<T> {
    candidates.into_iter().min_by(|a, b| {
        compare_guardhouse_food_candidates(
            runway_for(a),
            distance_for(a),
            building_id_for(a),
            runway_for(b),
            distance_for(b),
            building_id_for(b),
        )
    })
}

pub fn guard_upkeep(
    armed: f64,
    food_available: f64,
    gold_available: f64,
    elapsed_seconds: f64,
    seconds_per_day: f64,
) -> GuardUpkeep {
    let day_fraction = elapsed_seconds.max(0.0) / seconds_per_day.max(1e-9);
    let food_due = armed.max(0.0) * GUARDHOUSE_FOOD_PER_GUARD_PER_DAY * day_fraction;
    let wage_due = armed.max(0.0) * GUARDHOUSE_WAGE_PER_GUARD_PER_DAY * day_fraction;
    let food_ratio = if food_due > 1e-9 {
        (food_available.max(0.0) / food_due).clamp(0.0, 1.0)
    } else {
        1.0
    };
    let wage_ratio = if wage_due > 1e-9 {
        (gold_available.max(0.0) / wage_due).clamp(0.0, 1.0)
    } else {
        1.0
    };
    GuardUpkeep {
        food_due,
        wage_due,
        supply_ratio: food_ratio.min(wage_ratio),
    }
}

pub fn next_guard_readiness(
    current: f64,
    supply_ratio: f64,
    elapsed_seconds: f64,
    seconds_per_day: f64,
) -> f64 {
    let supplied = supply_ratio.clamp(0.0, 1.0);
    let day_fraction = elapsed_seconds.max(0.0) / seconds_per_day.max(1e-9);
    let delta = if supplied >= 0.999 {
        GUARDHOUSE_TRAINING_PER_DAY * day_fraction
    } else {
        -GUARDHOUSE_READINESS_DECAY_PER_DAY * (1.0 - supplied) * day_fraction
    };
    (current + delta).clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    #[test]
    fn each_guard_needs_one_polearm() {
        assert_eq!(armed_guards(6, 3.9), 3.0);
        assert_eq!(armed_guards(4, 10.0), 4.0);
        assert_eq!(armed_guards(4, -1.0), 0.0);
    }

    #[test]
    fn carpenter_reserve_turns_imported_fittings_into_an_explicit_choice() {
        assert!(is_valid_carpenter_polearm_reserve(0));
        assert!(is_valid_carpenter_polearm_reserve(6));
        assert!(is_valid_carpenter_polearm_reserve(24));
        assert!(!is_valid_carpenter_polearm_reserve(5));
        assert_eq!(normalize_carpenter_polearm_reserve(200), 24);
        assert_eq!(carpenter_polearm_shortfall(1.0, 6), 5.0);
        assert_eq!(carpenter_polearm_shortfall(8.0, 6), 0.0);
    }

    #[test]
    fn guardhouses_request_only_enough_weapons_for_assigned_guards() {
        assert_eq!(guardhouse_polearm_target(0), 0.0);
        assert_eq!(guardhouse_polearm_target(6), 6.0);
    }

    #[test]
    fn guardhouse_ration_policy_preserves_the_legacy_default_and_adds_real_depth() {
        assert!(is_valid_guardhouse_food_reserve(
            GUARDHOUSE_FOOD_RESERVE_LEAN
        ));
        assert!(is_valid_guardhouse_food_reserve(
            GUARDHOUSE_FOOD_RESERVE_STANDARD
        ));
        assert!(is_valid_guardhouse_food_reserve(
            GUARDHOUSE_FOOD_RESERVE_DEEP
        ));
        assert!(!is_valid_guardhouse_food_reserve(5));
        assert_eq!(normalize_guardhouse_food_reserve(5), 6);
        assert_eq!(
            guardhouse_food_target(6, 6.0, GUARDHOUSE_FOOD_RESERVE_STANDARD),
            36.0
        );
        assert_eq!(
            guardhouse_food_target(6, 6.0, GUARDHOUSE_FOOD_RESERVE_LEAN),
            18.0
        );
        assert_eq!(
            guardhouse_food_target(6, 6.0, GUARDHOUSE_FOOD_RESERVE_DEEP),
            72.0
        );
    }

    #[test]
    fn scarce_payroll_follows_explicit_priority_then_stable_building_id() {
        let buckets = guardhouse_payroll_buckets([
            (GUARDHOUSE_PAY_PRIORITY_NORMAL, 9_u64),
            (GUARDHOUSE_PAY_PRIORITY_HIGH, 8),
            (GUARDHOUSE_PAY_PRIORITY_LOW, 2),
            (GUARDHOUSE_PAY_PRIORITY_HIGH, 3),
            (200, 1),
        ]);
        let order: Vec<u64> = buckets.into_iter().rev().flatten().collect();
        assert_eq!(order, vec![1, 3, 8, 9, 2]);
        assert!(is_valid_guardhouse_pay_priority(
            GUARDHOUSE_PAY_PRIORITY_LOW
        ));
        assert!(is_valid_guardhouse_pay_priority(
            GUARDHOUSE_PAY_PRIORITY_HIGH
        ));
        assert!(!is_valid_guardhouse_pay_priority(3));
    }

    #[test]
    fn payroll_bucketing_stays_bounded_at_large_settlement_scale() {
        let started = Instant::now();
        let buckets =
            guardhouse_payroll_buckets((0..100_000_u64).rev().map(|id| ((id % 3) as u8, id)));
        assert_eq!(buckets.iter().map(Vec::len).sum::<usize>(), 100_000);
        assert_eq!(buckets[2].first().copied(), Some(2));
        assert!(started.elapsed() < Duration::from_millis(100));
    }

    #[test]
    fn only_armed_companies_request_and_consume_food() {
        assert_eq!(
            guardhouse_food_target(6, 0.0, GUARDHOUSE_FOOD_RESERVE_STANDARD),
            0.0
        );
        assert!(guardhouse_food_runway_days(6, 0.0, 0.0).is_infinite());
        assert_eq!(
            guardhouse_food_target(6, 2.9, GUARDHOUSE_FOOD_RESERVE_STANDARD),
            12.0
        );
        assert_eq!(
            guardhouse_food_target(6, 6.0, GUARDHOUSE_FOOD_RESERVE_STANDARD),
            36.0
        );
        assert!((guardhouse_food_runway_days(6, 6.0, 8.1) - 3.0).abs() < 1e-9);
        assert_eq!(GUARDHOUSE_CRITICAL_FOOD_RUNWAY_DAYS, 3.0);
    }

    #[test]
    fn central_guard_food_prefers_runway_then_route_then_id() {
        let selected = select_guardhouse_food_candidate(
            [(9_u64, 2.5_f64, 10.0_f64), (7, 0.5, 80.0), (3, 0.5, 20.0)],
            |candidate| candidate.1,
            |candidate| candidate.2,
            |candidate| candidate.0,
        );
        assert_eq!(selected, Some((3, 0.5, 20.0)));
    }

    #[test]
    fn central_guard_food_selection_stays_linear() {
        let started = Instant::now();
        let selected = select_guardhouse_food_candidate(
            (0..100_000).map(|index| {
                (
                    index as u64,
                    if index == 99_999 { 0.1 } else { 2.0 },
                    (100_000 - index) as f64,
                )
            }),
            |candidate| candidate.1,
            |candidate| candidate.2,
            |candidate| candidate.0,
        );
        assert_eq!(selected.map(|candidate| candidate.0), Some(99_999));
        assert!(started.elapsed() < Duration::from_millis(100));
    }

    #[test]
    fn upkeep_is_proportional_and_the_scarcest_supply_wins() {
        let upkeep = guard_upkeep(4.0, 0.9, 2.0, 0.5, 1.0);
        assert!((upkeep.food_due - 0.9).abs() < 1e-9);
        assert!((upkeep.wage_due - 0.7).abs() < 1e-9);
        assert_eq!(upkeep.supply_ratio, 1.0);

        let short = guard_upkeep(4.0, 0.45, 2.0, 0.5, 1.0);
        assert!((short.supply_ratio - 0.5).abs() < 1e-9);
    }

    #[test]
    fn supplied_guards_train_while_unpaid_guards_lose_readiness() {
        assert!((next_guard_readiness(0.0, 1.0, 1.0, 1.0) - 1.0).abs() < 1e-9);
        assert!((next_guard_readiness(1.0, 0.0, 1.0, 1.0) - 0.5).abs() < 1e-9);
        assert!((next_guard_readiness(0.5, 0.5, 1.0, 1.0) - 0.25).abs() < 1e-9);
    }
}
