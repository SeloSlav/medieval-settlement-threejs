use crate::balance_generated::{
    backyard_garden_def, BackyardGardenKind, BACKYARD_FOOD_RESERVE_TIER1_DAYS,
    BACKYARD_FOOD_RESERVE_TIER2_DAYS, BACKYARD_FOOD_RESERVE_TIER3_DAYS, RESIDENCE_FOOD_CAPACITY,
    RESIDENCE_PRESERVED_FOOD_CAPACITY,
};
use crate::food_demand_policy::household_food_per_day;
use crate::season_policy::{EnvironmentState, Season, WeatherKind};

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct BackyardFoodAllocation {
    pub self_food: f64,
    pub market_food: f64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct BackyardJamMealAllocation {
    /// Physical jars opened during this household meal. A jar is withdrawn
    /// once even when it contributes to both food and tier-4 luxury comfort.
    pub consumed: f64,
    pub food_used: f64,
    pub luxury_met: bool,
    pub remaining_stock: f64,
}

/// Allocates household jam as ordinary food first. Tier-4 households may use
/// the same physical serving to meet their smaller luxury-preserves demand;
/// this is a dual benefit, not a second withdrawal.
pub fn allocate_backyard_jam_meal(
    stock: f64,
    food_demand: f64,
    luxury_demand: f64,
) -> BackyardJamMealAllocation {
    let stock = finite_nonnegative(stock);
    let food_demand = finite_nonnegative(food_demand);
    let luxury_demand = finite_nonnegative(luxury_demand);
    let consumed = stock.min(food_demand.max(luxury_demand));
    BackyardJamMealAllocation {
        consumed,
        food_used: consumed.min(food_demand),
        luxury_met: luxury_demand <= 1e-9 || consumed + 1e-9 >= luxury_demand,
        remaining_stock: (stock - consumed).max(0.0),
    }
}

fn finite_nonnegative(value: f64) -> f64 {
    if value.is_finite() {
        value.max(0.0)
    } else {
        0.0
    }
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

pub fn backyard_month_in_window(month: u32, start_month: u32, end_month: u32) -> bool {
    if !(1..=12).contains(&month) || !(1..=12).contains(&start_month) {
        return false;
    }
    if start_month <= end_month {
        month >= start_month && month <= end_month
    } else {
        month >= start_month || month <= end_month
    }
}

pub fn backyard_interval_harvest_due(
    total_days: u64,
    first_harvest_day: u64,
    last_production_day: u64,
    interval_days: u64,
    month: u32,
    start_month: u32,
    end_month: u32,
) -> bool {
    interval_days > 0
        && total_days >= first_harvest_day
        && total_days.saturating_sub(last_production_day) >= interval_days
        && backyard_month_in_window(month, start_month, end_month)
}

pub fn backyard_interval_food_batch(
    food_per_person_per_sec: f64,
    population: u32,
    interval_days: u64,
    seasonal_multiplier: f64,
) -> f64 {
    finite_nonnegative(food_per_person_per_sec)
        * population as f64
        * interval_days as f64
        * crate::balance_generated::CALENDAR_SECONDS_PER_DAY
        * crate::balance_generated::CALENDAR_WORK_END_HOUR
            .saturating_sub(crate::balance_generated::CALENDAR_WORK_START_HOUR) as f64
        / crate::balance_generated::CALENDAR_HOURS_PER_DAY.max(1) as f64
        * finite_nonnegative(seasonal_multiplier)
}

/// Calendar- and weather-bound output shared by household food and market
/// activity. Selected vegetable crops and orchard species use their authored
/// harvest windows and efficiencies, while drought cuts exposed plants.
/// Mirrors `src/economy/backyardGardenTick.ts`.
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
        CabbageGarden | CarrotGarden | BeetrootGarden => {
            let def = backyard_garden_def(kind);
            if backyard_month_in_window(month, def.harvest_start_month, def.harvest_end_month) {
                def.yield_efficiency
            } else {
                0.0
            }
        }
        Orchard | VegetableGarden | AnimalPen => 0.0,
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
        ChickenPen | GoatPen | PigPen => {
            let def = backyard_garden_def(kind);
            if !backyard_month_in_window(
                month,
                def.harvest_start_month,
                def.harvest_end_month,
            ) {
                0.0
            } else if environment.season == Season::Winter {
                0.75 * def.yield_efficiency
            } else {
                def.yield_efficiency
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
        ChickenPen | GoatPen | PigPen => 1.0,
        AppleOrchard | CherryOrchard | PearOrchard => 0.9,
        AroniaOrchard => 0.75,
        RosehipOrchard => 0.85,
        Orchard | VegetableGarden | AnimalPen => 0.0,
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
        assert!(
            (backyard_garden_seasonal_multiplier(BackyardGardenKind::CherryOrchard, 6, summer)
                - 11.04)
                .abs()
                < 1e-9
        );
        assert!(
            (backyard_garden_seasonal_multiplier(BackyardGardenKind::PearOrchard, 10, autumn)
                - 6.48)
                .abs()
                < 1e-9
        );
        assert!(
            (backyard_garden_seasonal_multiplier(BackyardGardenKind::AroniaOrchard, 8, summer)
                - 5.4)
                .abs()
                < 1e-9
        );
        assert!(
            (backyard_garden_seasonal_multiplier(BackyardGardenKind::RosehipOrchard, 11, autumn)
                - 4.92)
                .abs()
                < 1e-9
        );
        assert_eq!(
            backyard_garden_seasonal_multiplier(BackyardGardenKind::Orchard, 9, autumn),
            0.0,
        );
    }

    #[test]
    fn jam_is_food_at_every_tier_and_the_same_tier_four_serving_is_luxury() {
        let lower_tier = allocate_backyard_jam_meal(2.0, 1.0, 0.0);
        assert_eq!(lower_tier.consumed, 1.0);
        assert_eq!(lower_tier.food_used, 1.0);
        assert_eq!(lower_tier.remaining_stock, 1.0);

        let tier_four = allocate_backyard_jam_meal(2.0, 1.0, 0.25);
        assert_eq!(tier_four.consumed, 1.0);
        assert_eq!(tier_four.food_used, 1.0);
        assert!(tier_four.luxury_met);
        assert_eq!(tier_four.remaining_stock, 1.0);

        let scarce = allocate_backyard_jam_meal(0.1, 1.0, 0.25);
        assert_eq!(scarce.food_used, 0.1);
        assert!(!scarce.luxury_met);
        assert_eq!(scarce.remaining_stock, 0.0);
    }

    #[test]
    fn vegetable_species_keep_realistic_maturity_windows_and_yield_tradeoffs() {
        assert_eq!(
            backyard_garden_seasonal_multiplier(
                BackyardGardenKind::VegetableGarden,
                7,
                environment(Season::Spring, WeatherKind::Fair),
            ),
            0.0,
        );
        assert_eq!(
            backyard_garden_seasonal_multiplier(
                BackyardGardenKind::BeetrootGarden,
                5,
                environment(Season::Spring, WeatherKind::Fair),
            ),
            0.9,
        );
        assert_eq!(
            backyard_garden_seasonal_multiplier(
                BackyardGardenKind::CarrotGarden,
                6,
                environment(Season::Summer, WeatherKind::Fair),
            ),
            0.98,
        );
        assert_eq!(
            backyard_garden_seasonal_multiplier(
                BackyardGardenKind::CabbageGarden,
                7,
                environment(Season::Summer, WeatherKind::Fair),
            ),
            1.15,
        );
        assert_eq!(
            backyard_garden_seasonal_multiplier(
                BackyardGardenKind::BeetrootGarden,
                11,
                environment(Season::Autumn, WeatherKind::Fair),
            ),
            0.0,
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
    fn drought_spares_stocked_pens_but_cuts_exposed_plants() {
        let drought = environment(Season::Summer, WeatherKind::Drought);
        assert!(
            (backyard_garden_seasonal_multiplier(
                BackyardGardenKind::CabbageGarden,
                7,
                drought,
            ) - 0.6325)
                .abs()
                < 1e-9
        );
        assert_eq!(
            backyard_garden_seasonal_multiplier(BackyardGardenKind::ChickenPen, 7, drought,),
            1.0,
        );
        assert_eq!(
            backyard_garden_seasonal_multiplier(BackyardGardenKind::AppleOrchard, 9, drought,),
            10.8,
        );
    }

    #[test]
    fn chicken_output_obeys_its_authored_collection_window() {
        assert_eq!(
            backyard_garden_seasonal_multiplier(
                BackyardGardenKind::ChickenPen,
                1,
                environment(Season::Winter, WeatherKind::Frost),
            ),
            0.0,
        );
        assert_eq!(
            backyard_garden_seasonal_multiplier(
                BackyardGardenKind::ChickenPen,
                5,
                environment(Season::Spring, WeatherKind::Rain),
            ),
            1.0,
        );
    }

    #[test]
    fn interval_harvests_fire_once_and_wait_for_the_authored_window() {
        assert!(backyard_interval_harvest_due(21, 21, 0, 2, 3, 3, 11));
        assert!(!backyard_interval_harvest_due(21, 21, 21, 2, 3, 3, 11));
        assert!(!backyard_interval_harvest_due(149, 150, 0, 3, 5, 4, 10));
        assert!(!backyard_interval_harvest_due(150, 150, 0, 3, 12, 4, 10));
        assert!(backyard_interval_harvest_due(150, 150, 0, 3, 10, 4, 10));
        assert!(backyard_month_in_window(12, 10, 2));
        assert!(backyard_month_in_window(1, 10, 2));
        assert!(!backyard_month_in_window(6, 10, 2));
    }

    #[test]
    fn interval_batches_convert_authored_average_rates_into_discrete_yields() {
        let eggs = backyard_interval_food_batch(0.0017, 4, 2, 1.0);
        assert!((eggs - 0.952).abs() < 1e-9);
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
