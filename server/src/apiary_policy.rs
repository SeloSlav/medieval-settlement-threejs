use crate::balance_generated::{
    APIARY_BALANCED_HONEY_RESERVE, APIARY_BALANCED_YIELD_MULTIPLIER,
    APIARY_CONSERVATIVE_HONEY_RESERVE, APIARY_CONSERVATIVE_YIELD_MULTIPLIER,
    APIARY_EXTRACTIVE_HONEY_RESERVE, APIARY_EXTRACTIVE_YIELD_MULTIPLIER,
    APIARY_POLLINATION_BONUS_MAX, APIARY_WINTER_HEALTH_GAIN, APIARY_WINTER_HEALTH_LOSS,
    APIARY_WINTER_HONEY_REQUIRED,
};

pub const APIARY_HARVEST_CONSERVATIVE: u8 = 0;
pub const APIARY_HARVEST_BALANCED: u8 = 1;
pub const APIARY_HARVEST_EXTRACTIVE: u8 = 2;

pub fn is_valid_apiary_harvest_policy(policy: u8) -> bool {
    matches!(
        policy,
        APIARY_HARVEST_CONSERVATIVE | APIARY_HARVEST_BALANCED | APIARY_HARVEST_EXTRACTIVE
    )
}

pub fn normalize_apiary_harvest_policy(policy: u8) -> u8 {
    if is_valid_apiary_harvest_policy(policy) {
        policy
    } else {
        APIARY_HARVEST_BALANCED
    }
}

pub fn apiary_honey_reserve(policy: u8) -> f64 {
    match normalize_apiary_harvest_policy(policy) {
        APIARY_HARVEST_CONSERVATIVE => APIARY_CONSERVATIVE_HONEY_RESERVE,
        APIARY_HARVEST_EXTRACTIVE => APIARY_EXTRACTIVE_HONEY_RESERVE,
        _ => APIARY_BALANCED_HONEY_RESERVE,
    }
}

pub fn apiary_yield_multiplier(policy: u8) -> f64 {
    match normalize_apiary_harvest_policy(policy) {
        APIARY_HARVEST_CONSERVATIVE => APIARY_CONSERVATIVE_YIELD_MULTIPLIER,
        APIARY_HARVEST_EXTRACTIVE => APIARY_EXTRACTIVE_YIELD_MULTIPLIER,
        _ => APIARY_BALANCED_YIELD_MULTIPLIER,
    }
}

/// A bounded landscape score: forest is the dependable base while flowering
/// burgages and cultivated parcels can improve, but never multiply, one hive's
/// productive range without limit.
pub fn apiary_forage_score(
    mature_trees: u32,
    orchards: u32,
    flower_gardens: u32,
    vineyard_area: f64,
) -> f64 {
    let forest = (mature_trees as f64 / 12.0).clamp(0.0, 1.0) * 0.45;
    let orchard = (orchards as f64 * 0.08).min(0.24);
    let flowers = (flower_gardens as f64 * 0.12).min(0.36);
    let vines = (vineyard_area.max(0.0) / 1_200.0 * 0.20).min(0.20);
    (0.55 + forest + orchard + flowers + vines).clamp(0.55, 1.35)
}

pub fn next_apiary_colony_health(current: f64, winter_honey_available: f64) -> f64 {
    let supply_ratio = if APIARY_WINTER_HONEY_REQUIRED <= 1e-9 {
        1.0
    } else {
        (winter_honey_available.max(0.0) / APIARY_WINTER_HONEY_REQUIRED).clamp(0.0, 1.0)
    };
    (current.clamp(0.35, 1.10) + APIARY_WINTER_HEALTH_GAIN * supply_ratio
        - APIARY_WINTER_HEALTH_LOSS * (1.0 - supply_ratio))
        .clamp(0.35, 1.10)
}

pub fn apiary_production_multiplier(policy: u8, forage_score: f64, colony_health: f64) -> f64 {
    apiary_yield_multiplier(policy)
        * forage_score.clamp(0.55, 1.35)
        * colony_health.clamp(0.35, 1.10)
}

pub fn pollination_contribution(distance: f64, radius: f64, colony_health: f64) -> f64 {
    if !distance.is_finite() || radius <= 1e-9 || distance >= radius {
        return 0.0;
    }
    let proximity = 1.0 - distance.max(0.0) / radius;
    proximity * colony_health.clamp(0.35, 1.10) * 0.08
}

pub fn pollination_multiplier(total_contribution: f64) -> f64 {
    1.0 + total_contribution
        .max(0.0)
        .min(APIARY_POLLINATION_BONUS_MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn richer_flowering_land_improves_but_bounds_forage() {
        let forest_only = apiary_forage_score(6, 0, 0, 0.0);
        let mixed = apiary_forage_score(12, 3, 3, 800.0);
        assert!(mixed > forest_only);
        assert_eq!(apiary_forage_score(10_000, 1_000, 1_000, 1_000_000.0), 1.35);
    }

    #[test]
    fn extraction_trades_reserve_and_health_for_current_yield() {
        assert!(
            apiary_honey_reserve(APIARY_HARVEST_CONSERVATIVE)
                > apiary_honey_reserve(APIARY_HARVEST_EXTRACTIVE)
        );
        assert!(
            apiary_yield_multiplier(APIARY_HARVEST_EXTRACTIVE)
                > apiary_yield_multiplier(APIARY_HARVEST_CONSERVATIVE)
        );
        assert!(next_apiary_colony_health(1.0, 2.0) < next_apiary_colony_health(1.0, 8.0));
    }

    #[test]
    fn pollination_stacks_only_to_the_global_cap() {
        assert!(pollination_contribution(0.0, 48.0, 1.0) > 0.0);
        assert_eq!(
            pollination_multiplier(10.0),
            1.0 + APIARY_POLLINATION_BONUS_MAX
        );
    }
}
