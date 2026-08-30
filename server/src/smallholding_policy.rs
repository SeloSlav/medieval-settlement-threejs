use crate::balance_generated::{
    SMALLHOLDING_BACKYARD_PRODUCTIVITY_MULTIPLIER, STARTING_POPULATION,
};

/// Smallholding residents remain ordinary population and consumers, but their
/// household is permanently committed to the backyard economy rather than the
/// settlement's assignable labor pool.
pub fn smallholding_assignable_population(
    population: u32,
    sick_population: u32,
    smallholding: bool,
) -> u32 {
    if smallholding {
        0
    } else {
        population.saturating_sub(sick_population.min(population))
    }
}

pub fn smallholding_backyard_productivity_multiplier(smallholding: bool) -> f64 {
    if smallholding {
        SMALLHOLDING_BACKYARD_PRODUCTIVITY_MULTIPLIER.max(1.0)
    } else {
        1.0
    }
}

/// Preserve only genuinely unhoused founders when the legacy settlement table
/// is absent. Healthy Smallholding residents count as housed, so they cannot
/// reappear as fallback workers after leaving the assignable household pool.
pub fn smallholding_adjusted_settlement_population(
    assignable_housed: u32,
    healthy_housed: u32,
    legacy_unhoused_population_bonus_enabled: bool,
) -> u32 {
    if legacy_unhoused_population_bonus_enabled {
        STARTING_POPULATION.saturating_add(assignable_housed)
    } else {
        assignable_housed.saturating_add(STARTING_POPULATION.saturating_sub(healthy_housed))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ordinary_households_remain_in_the_general_workforce() {
        assert_eq!(smallholding_assignable_population(3, 0, false), 3);
        assert_eq!(smallholding_assignable_population(3, 1, false), 2);
    }

    #[test]
    fn a_smallholding_household_is_fully_dedicated() {
        assert_eq!(smallholding_assignable_population(3, 0, true), 0);
        assert_eq!(smallholding_assignable_population(3, 1, true), 0);
        assert_eq!(smallholding_backyard_productivity_multiplier(true), 2.0);
        assert_eq!(smallholding_backyard_productivity_multiplier(false), 1.0);
    }

    #[test]
    fn dedicated_households_do_not_reappear_as_unhoused_founders() {
        assert_eq!(smallholding_adjusted_settlement_population(7, 10, false), 7);
        assert_eq!(smallholding_adjusted_settlement_population(2, 5, false), 7);
        assert_eq!(smallholding_adjusted_settlement_population(7, 10, true), 17);
    }
}
