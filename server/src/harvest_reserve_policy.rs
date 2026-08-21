use crate::balance_generated::GAME_MIN_BREEDING_POPULATION;

pub const HARVEST_RESERVE_PERCENT_MAX: u8 = 90;
pub const HARVEST_RESERVE_DEFAULT_PERCENT: u8 = 50;
const ORDINARY_FISH_CAPACITY: f64 = 120.0;
const RICH_FISH_BREEDING_POPULATION: f64 = 2.0;

pub fn default_harvest_reserve_percent(building_kind: &str) -> u8 {
    if matches!(
        building_kind,
        "foragers_shed" | "hunters_hall" | "fishing_camp"
    ) {
        HARVEST_RESERVE_DEFAULT_PERCENT
    } else {
        0
    }
}

pub fn normalize_harvest_reserve_percent(percent: u8) -> u8 {
    percent.min(HARVEST_RESERVE_PERCENT_MAX)
}

pub fn protected_wild_stock(node_kind: &str, max_yield: f64, percent: u8) -> f64 {
    let capacity = max_yield.max(0.0);
    let policy_floor = capacity * normalize_harvest_reserve_percent(percent) as f64 / 100.0;
    let renewable_floor = match node_kind {
        // A hall may hunt aggressively, but it must never take the breeding
        // pair that makes a persistent habitat renewable.
        "game" => GAME_MIN_BREEDING_POPULATION.min(capacity),
        // The rich shoal's infinity marker denotes renewable seasonal stock.
        // Ordinary shoals retain the sharper open-harvest extinction risk.
        "fish" if capacity > ORDINARY_FISH_CAPACITY => RICH_FISH_BREEDING_POPULATION.min(capacity),
        _ => 0.0,
    };
    policy_floor.max(renewable_floor)
}

pub fn harvestable_wild_stock(node_kind: &str, remaining: f64, max_yield: f64, percent: u8) -> f64 {
    (remaining.max(0.0) - protected_wild_stock(node_kind, max_yield, percent)).max(0.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_game_harvest_still_protects_the_breeding_pair() {
        assert_eq!(protected_wild_stock("game", 12.0, 0), 2.0);
        assert_eq!(harvestable_wild_stock("game", 9.0, 12.0, 0), 7.0);
        assert_eq!(harvestable_wild_stock("game", 2.0, 12.0, 0), 0.0);
        assert_eq!(protected_wild_stock("game", 1.0, 0), 1.0);
    }

    #[test]
    fn open_fish_harvest_retains_extinction_risk() {
        assert_eq!(harvestable_wild_stock("fish", 80.0, 120.0, 0), 80.0);
    }

    #[test]
    fn rich_fish_shoals_protect_a_renewable_breeding_school() {
        assert_eq!(protected_wild_stock("fish", 240.0, 0), 2.0);
        assert_eq!(harvestable_wild_stock("fish", 12.0, 240.0, 0), 10.0);
    }

    #[test]
    fn reserve_protects_a_share_of_carrying_capacity() {
        assert_eq!(protected_wild_stock("game", 12.0, 25), 3.0);
        assert_eq!(harvestable_wild_stock("game", 9.0, 12.0, 25), 6.0);
        assert_eq!(protected_wild_stock("fish", 120.0, 50), 60.0);
        assert_eq!(harvestable_wild_stock("fish", 60.0, 120.0, 50), 0.0);
    }

    #[test]
    fn seasonal_forage_obeys_the_same_sustainable_floor() {
        assert_eq!(protected_wild_stock("berries", 60.0, 50), 30.0);
        assert_eq!(harvestable_wild_stock("mushrooms", 30.0, 42.0, 50), 9.0);
    }

    #[test]
    fn malformed_large_percentages_are_capped() {
        assert_eq!(normalize_harvest_reserve_percent(255), 90);
        assert_eq!(protected_wild_stock("fish", 100.0, 255), 90.0);
    }

    #[test]
    fn new_wild_food_camps_start_at_a_balanced_sustainable_floor() {
        assert_eq!(default_harvest_reserve_percent("foragers_shed"), 50);
        assert_eq!(default_harvest_reserve_percent("hunters_hall"), 50);
        assert_eq!(default_harvest_reserve_percent("fishing_camp"), 50);
        assert_eq!(default_harvest_reserve_percent("granary"), 0);
    }
}
