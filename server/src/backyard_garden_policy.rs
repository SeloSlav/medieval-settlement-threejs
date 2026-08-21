use crate::balance_generated::{
    backyard_garden_def, BackyardGardenKind, BACKYARD_FOOD_RESERVE_TIER1_DAYS, BACKYARD_FOOD_RESERVE_TIER2_DAYS,
    BACKYARD_FOOD_RESERVE_TIER3_DAYS, RESIDENCE_FOOD_CAPACITY, RESIDENCE_PRESERVED_FOOD_CAPACITY,
};
use crate::food_demand_policy::household_food_per_day;
use crate::season_policy::{EnvironmentState, Season, WeatherKind};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BackyardGoatProduct {
    Milk,
    Meat,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct BackyardFoodAllocation {
    pub self_food: f64,
    pub market_food: f64,
}

pub fn backyard_food_reserve_days(tier: u8) -> f64 {
    match tier {
        0 | 1 => BACKYARD_FOOD_RESERVE_TIER1_DAYS,
        2 => BACKYARD_FOOD_RESERVE_TIER2_DAYS,
        _ => BACKYARD_FOOD_RESERVE_TIER3_DAYS,
    }
    .max(0.0)
}

pub fn backyard_food_reserve_target(tier: u8, population: u32) -> f64 {
    let daily_food = household_food_per_day(population);
    (daily_food * backyard_food_reserve_days(tier))
        .min(RESIDENCE_FOOD_CAPACITY + RESIDENCE_PRESERVED_FOOD_CAPACITY)
}

pub fn allocate_backyard_food(
    total_food: f64,
    has_market_access: bool,
    tier: u8,
    population: u32,
    current_food_stock: f64,
) -> BackyardFoodAllocation {
    let total = if total_food.is_finite() {
        total_food.max(0.0)
    } else {
        0.0
    };
    if !has_market_access {
        return BackyardFoodAllocation {
            self_food: total,
            market_food: 0.0,
        };
    }
    let current = if current_food_stock.is_finite() {
        current_food_stock.max(0.0)
    } else {
        0.0
    };
    let reserve_gap = (backyard_food_reserve_target(tier, population) - current).max(0.0);
    let self_food = total.min(reserve_gap);
    BackyardFoodAllocation {
        self_food,
        market_food: (total - self_food).max(0.0),
    }
}

pub fn backyard_goat_product(total_days: u64, residence_id: u64) -> BackyardGoatProduct {
    if (total_days + residence_id) % 2 == 0 {
        BackyardGoatProduct::Milk
    } else {
        BackyardGoatProduct::Meat
    }
}

/// Calendar- and weather-bound output shared by household food and market
/// activity. Mixed vegetables and herbs use staggered April-November harvests,
/// orchard species use authored harvest windows and efficiencies, while
/// drought cuts exposed plants. Mirrors `src/economy/backyardGardenTick.ts`.
pub fn backyard_garden_seasonal_multiplier(
    kind: BackyardGardenKind,
    month: u32,
    environment: EnvironmentState,
) -> f64 {
    use BackyardGardenKind::*;
    let base = match kind {
        AppleOrchard | CherryOrchard | PearOrchard | AroniaOrchard | RosehipOrchard => {
            let def = backyard_garden_def(kind);
            if month >= def.harvest_start_month && month <= def.harvest_end_month {
                let window = (def.harvest_end_month - def.harvest_start_month + 1).max(1) as f64;
                12.0 / window * def.yield_efficiency
            } else {
                0.0
            }
        }
        Orchard => 0.0,
        VegetableGarden => match month {
            4 | 5 => 0.7,
            6..=8 => 1.0,
            9 | 10 => 0.55,
            11 => 0.25,
            _ => 0.0,
        },
        HerbGarden => match month {
            4 | 5 => 0.75,
            6..=8 => 1.0,
            9 | 10 => 0.55,
            11 => 0.2,
            _ => 0.0,
        },
        FlowerGarden => match environment.season {
            Season::Spring => 1.4,
            Season::Summer => 1.0,
            Season::Autumn => 0.35,
            Season::Winter => 0.0,
        },
        HenYard | GoatPen => {
            if environment.season == Season::Winter {
                0.75
            } else {
                1.0
            }
        }
        BackyardApiary => match environment.season {
            Season::Spring => 0.8,
            Season::Summer => 1.0,
            Season::Autumn => 0.4,
            Season::Winter => 0.0,
        },
    };
    if environment.weather != WeatherKind::Drought {
        return base;
    }
    let drought_multiplier = match kind {
        HenYard | GoatPen => 1.0,
        AppleOrchard | CherryOrchard | PearOrchard => 0.9,
        AroniaOrchard => 0.75,
        RosehipOrchard => 0.85,
        Orchard => 0.0,
        _ => 0.55,
    };
    base * drought_multiplier
}

#[cfg(test)]
mod tests {
    use super::*;

    fn environment(season: Season, weather: WeatherKind) -> EnvironmentState {
        EnvironmentState { season, weather }
    }

    #[test]
    fn orchard_species_keep_distinct_harvest_windows_and_efficiencies() {
        let autumn = environment(Season::Autumn, WeatherKind::Fair);
        assert_eq!(
            backyard_garden_seasonal_multiplier(BackyardGardenKind::AppleOrchard, 8, autumn,),
            0.0,
        );
        assert_eq!(
            backyard_garden_seasonal_multiplier(BackyardGardenKind::AppleOrchard, 9, autumn,),
            12.0,
        );
        assert_eq!(
            backyard_garden_seasonal_multiplier(BackyardGardenKind::AppleOrchard, 10, autumn,),
            0.0,
        );
        let summer = environment(Season::Summer, WeatherKind::Fair);
        assert!((
            backyard_garden_seasonal_multiplier(BackyardGardenKind::CherryOrchard, 6, summer)
                - 11.04
        ).abs() < 1e-9);
        assert!((
            backyard_garden_seasonal_multiplier(BackyardGardenKind::PearOrchard, 10, autumn)
                - 6.48
        ).abs() < 1e-9);
        assert!((
            backyard_garden_seasonal_multiplier(BackyardGardenKind::AroniaOrchard, 8, summer)
                - 5.4
        ).abs() < 1e-9);
        assert!((
            backyard_garden_seasonal_multiplier(BackyardGardenKind::RosehipOrchard, 11, autumn)
                - 4.92
        ).abs() < 1e-9);
        assert_eq!(
            backyard_garden_seasonal_multiplier(BackyardGardenKind::Orchard, 9, autumn),
            0.0,
        );
    }

    #[test]
    fn mixed_beds_separate_spring_growth_from_staggered_harvests() {
        assert_eq!(
            backyard_garden_seasonal_multiplier(
                BackyardGardenKind::VegetableGarden,
                3,
                environment(Season::Spring, WeatherKind::Fair),
            ),
            0.0,
        );
        assert_eq!(
            backyard_garden_seasonal_multiplier(
                BackyardGardenKind::VegetableGarden,
                4,
                environment(Season::Spring, WeatherKind::Fair),
            ),
            0.7,
        );
        assert_eq!(
            backyard_garden_seasonal_multiplier(
                BackyardGardenKind::HerbGarden,
                10,
                environment(Season::Autumn, WeatherKind::Fair),
            ),
            0.55,
        );
        assert_eq!(
            backyard_garden_seasonal_multiplier(
                BackyardGardenKind::HerbGarden,
                11,
                environment(Season::Autumn, WeatherKind::Fair),
            ),
            0.2,
        );
        assert_eq!(
            backyard_garden_seasonal_multiplier(
                BackyardGardenKind::FlowerGarden,
                1,
                environment(Season::Winter, WeatherKind::Frost),
            ),
            0.0,
        );
    }

    #[test]
    fn drought_spares_orchards_and_hens_but_cuts_exposed_plants() {
        let drought = environment(Season::Summer, WeatherKind::Drought);
        assert_eq!(
            backyard_garden_seasonal_multiplier(BackyardGardenKind::VegetableGarden, 7, drought,),
            0.55,
        );
        assert_eq!(
            backyard_garden_seasonal_multiplier(BackyardGardenKind::HenYard, 7, drought,),
            1.0,
        );
        assert_eq!(
            backyard_garden_seasonal_multiplier(BackyardGardenKind::AppleOrchard, 9, drought,),
            10.8,
        );
    }

    #[test]
    fn hens_trade_lower_output_for_year_round_resilience() {
        assert_eq!(
            backyard_garden_seasonal_multiplier(
                BackyardGardenKind::HenYard,
                1,
                environment(Season::Winter, WeatherKind::Frost),
            ),
            0.75,
        );
        assert_eq!(
            backyard_garden_seasonal_multiplier(
                BackyardGardenKind::HenYard,
                5,
                environment(Season::Spring, WeatherKind::Rain),
            ),
            1.0,
        );
    }

    #[test]
    fn goat_pens_alternate_products_by_household_and_day() {
        assert_eq!(backyard_goat_product(10, 4), BackyardGoatProduct::Milk);
        assert_eq!(backyard_goat_product(11, 4), BackyardGoatProduct::Meat);
        assert_eq!(backyard_goat_product(10, 5), BackyardGoatProduct::Meat);
    }

    #[test]
    fn household_reserves_scale_by_tier_and_storage() {
        assert!((backyard_food_reserve_target(1, 3) - 3.0).abs() < 1e-9);
        assert!((backyard_food_reserve_target(2, 6) - 10.0).abs() < 1e-9);
        assert!((backyard_food_reserve_target(3, 10) - 70.0 / 3.0).abs() < 1e-9);
    }

    #[test]
    fn backyard_food_fills_the_household_reserve_before_sale() {
        let empty = allocate_backyard_food(2.0, true, 1, 3, 0.0);
        assert_eq!(
            empty,
            BackyardFoodAllocation {
                self_food: 2.0,
                market_food: 0.0
            }
        );

        let partial = allocate_backyard_food(2.0, true, 1, 3, 1.5);
        assert!((partial.self_food - 1.5).abs() < 1e-9);
        assert!((partial.market_food - 0.5).abs() < 1e-9);

        let stocked = allocate_backyard_food(2.0, true, 1, 3, 12.0);
        assert_eq!(
            stocked,
            BackyardFoodAllocation {
                self_food: 0.0,
                market_food: 2.0
            }
        );

        let unlinked = allocate_backyard_food(2.0, false, 3, 10, 60.0);
        assert_eq!(
            unlinked,
            BackyardFoodAllocation {
                self_food: 2.0,
                market_food: 0.0
            }
        );
    }
}
