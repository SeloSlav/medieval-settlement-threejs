pub use crate::balance_generated::{
    CARPENTER_GOLD_PER_POLEARM, CARPENTER_TIMBER_PER_POLEARM,
    GUARDHOUSE_FOOD_PER_GUARD_PER_DAY, GUARDHOUSE_READINESS_DECAY_PER_DAY,
    GUARDHOUSE_TRAINING_PER_DAY, GUARDHOUSE_WAGE_PER_GUARD_PER_DAY,
};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GuardUpkeep {
    pub food_due: f64,
    pub wage_due: f64,
    pub supply_ratio: f64,
}

pub fn armed_guards(assigned_labor: u32, polearms: f64) -> f64 {
    (assigned_labor as f64).min(polearms.floor().max(0.0))
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

    #[test]
    fn each_guard_needs_one_polearm() {
        assert_eq!(armed_guards(6, 3.9), 3.0);
        assert_eq!(armed_guards(4, 10.0), 4.0);
        assert_eq!(armed_guards(4, -1.0), 0.0);
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
