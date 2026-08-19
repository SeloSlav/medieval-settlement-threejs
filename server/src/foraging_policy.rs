use crate::balance_generated::{
    BERRIES_REGROW_PER_DAY, CALENDAR_SECONDS_PER_DAY, FISH_REPRODUCTION_RATE_PER_DAY,
    GAME_MIN_BREEDING_POPULATION, GAME_REPRODUCTION_RATE_PER_DAY, MUSHROOMS_REGROW_PER_DAY,
    MUSHROOM_AUTUMN_REGROWTH_MULTIPLIER, RICH_BERRY_YIELD_MULTIPLIER, RICH_FISH_YIELD_MULTIPLIER,
};

const ORDINARY_BERRY_CAPACITY: f64 = 60.0;
const ORDINARY_FISH_CAPACITY: f64 = 120.0;

pub fn is_spring(month: u32) -> bool {
    matches!(month, 3..=5)
}

pub fn is_summer(month: u32) -> bool {
    matches!(month, 6..=8)
}

pub fn is_autumn(month: u32) -> bool {
    matches!(month, 9..=11)
}

pub fn is_winter(month: u32) -> bool {
    matches!(month, 12 | 1 | 2)
}

pub fn harvest_available(node_kind: &str, month: u32) -> bool {
    match node_kind {
        "berries" | "mushrooms" | "fish" => !is_winter(month),
        _ => true,
    }
}

/// Game habitats can migrate after nearby construction disturbs them. Static
/// forage sites must instead follow the generated world layout when it changes,
/// otherwise the server validates buildings against invisible, stale patches.
pub fn preserves_runtime_location_during_bootstrap(node_kind: &str) -> bool {
    node_kind == "game"
}

pub fn harvest_yield_multiplier(node_kind: &str, max_yield: f64) -> f64 {
    match node_kind {
        "berries" if max_yield > ORDINARY_BERRY_CAPACITY => RICH_BERRY_YIELD_MULTIPLIER,
        "fish" if max_yield > ORDINARY_FISH_CAPACITY => RICH_FISH_YIELD_MULTIPLIER,
        _ => 1.0,
    }
}

pub fn population_growth_per_second(
    node_kind: &str,
    remaining: f64,
    max_yield: f64,
    month: u32,
) -> f64 {
    if max_yield <= 0.0 || remaining >= max_yield {
        return 0.0;
    }

    match node_kind {
        "berries" if is_spring(month) || is_summer(month) => {
            BERRIES_REGROW_PER_DAY / CALENDAR_SECONDS_PER_DAY
        }
        "mushrooms" if is_spring(month) || is_summer(month) => {
            MUSHROOMS_REGROW_PER_DAY / CALENDAR_SECONDS_PER_DAY
        }
        "mushrooms" if is_autumn(month) => {
            MUSHROOMS_REGROW_PER_DAY * MUSHROOM_AUTUMN_REGROWTH_MULTIPLIER
                / CALENDAR_SECONDS_PER_DAY
        }
        "fish" if is_spring(month) && remaining > 0.0 => {
            logistic_growth_per_second(remaining, max_yield, FISH_REPRODUCTION_RATE_PER_DAY)
        }
        "game" if remaining >= GAME_MIN_BREEDING_POPULATION => {
            logistic_growth_per_second(remaining, max_yield, GAME_REPRODUCTION_RATE_PER_DAY)
        }
        _ => 0.0,
    }
}

fn logistic_growth_per_second(
    remaining: f64,
    max_yield: f64,
    reproduction_rate_per_day: f64,
) -> f64 {
    let carrying_room = (1.0 - remaining / max_yield).clamp(0.0, 1.0);
    reproduction_rate_per_day * remaining * carrying_room / CALENDAR_SECONDS_PER_DAY
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seasonal_food_is_unavailable_only_in_winter() {
        assert!(!harvest_available("berries", 1));
        assert!(!harvest_available("mushrooms", 12));
        assert!(!harvest_available("fish", 2));
        assert!(harvest_available("berries", 9));
        assert!(harvest_available("game", 1));
    }

    #[test]
    fn empty_berries_and_mushrooms_return_during_the_growing_season() {
        assert!(population_growth_per_second("berries", 0.0, 60.0, 3) > 0.0);
        assert!(population_growth_per_second("mushrooms", 0.0, 42.0, 7) > 0.0);
        assert_eq!(population_growth_per_second("berries", 0.0, 60.0, 10), 0.0);
    }

    #[test]
    fn mushrooms_peak_in_autumn_then_go_dormant_in_winter() {
        let spring = population_growth_per_second("mushrooms", 0.0, 42.0, 4);
        let autumn = population_growth_per_second("mushrooms", 0.0, 42.0, 10);
        assert!((autumn / spring - MUSHROOM_AUTUMN_REGROWTH_MULTIPLIER).abs() < 1e-12);
        assert_eq!(population_growth_per_second("mushrooms", 0.0, 42.0, 1), 0.0);
    }

    #[test]
    fn only_migrating_game_habitats_keep_runtime_coordinates_during_bootstrap() {
        assert!(preserves_runtime_location_during_bootstrap("game"));
        assert!(!preserves_runtime_location_during_bootstrap("berries"));
        assert!(!preserves_runtime_location_during_bootstrap("mushrooms"));
        assert!(!preserves_runtime_location_during_bootstrap("fish"));
    }

    #[test]
    fn fish_need_survivors_and_spring_to_reproduce() {
        assert!(population_growth_per_second("fish", 10.0, 120.0, 4) > 0.0);
        assert_eq!(population_growth_per_second("fish", 10.0, 120.0, 7), 0.0);
        assert_eq!(population_growth_per_second("fish", 0.0, 120.0, 4), 0.0);
    }

    #[test]
    fn rich_food_nodes_apply_their_harvest_multiplier() {
        assert_eq!(harvest_yield_multiplier("berries", 60.0), 1.0);
        assert_eq!(harvest_yield_multiplier("berries", 100.0), 1.5);
        assert_eq!(harvest_yield_multiplier("fish", 120.0), 1.0);
        assert_eq!(harvest_yield_multiplier("fish", 240.0), 1.75);
        assert_eq!(harvest_yield_multiplier("game", 20.0), 1.0);
    }

    #[test]
    fn game_need_two_animals_to_reproduce() {
        assert!(population_growth_per_second("game", 2.0, 12.0, 1) > 0.0);
        assert_eq!(population_growth_per_second("game", 1.0, 12.0, 6), 0.0);
        assert_eq!(population_growth_per_second("game", 0.0, 12.0, 6), 0.0);
    }
}
