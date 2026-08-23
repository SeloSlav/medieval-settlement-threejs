use crate::balance_generated::{
    AUTUMN_FIREWOOD_DEMAND_MULTIPLIER, AUTUMN_PASTURE_CAPACITY_MULTIPLIER,
    AUTUMN_ROAD_SPEED_MULTIPLIER, CALENDAR_DAYS_PER_MONTH, CALENDAR_SECONDS_PER_DAY,
    DROUGHT_CHARCOAL_BURNER_THROUGHPUT_MULTIPLIER, DROUGHT_CROP_GROWTH_MULTIPLIER,
    DROUGHT_FISH_LOSS_FRACTION_PER_DAY, DROUGHT_FORAGE_REGROWTH_MULTIPLIER,
    DROUGHT_PASTURE_CAPACITY_MULTIPLIER, DROUGHT_WATERMILL_THROUGHPUT_MULTIPLIER,
    DROUGHT_WELL_REFILL_MULTIPLIER, FRESH_FOOD_SPOILAGE_AUTUMN_PER_DAY,
    FRESH_FOOD_SPOILAGE_DROUGHT_PER_DAY, FRESH_FOOD_SPOILAGE_SPRING_PER_DAY,
    FRESH_FOOD_SPOILAGE_SUMMER_PER_DAY, FRESH_FOOD_SPOILAGE_WINTER_PER_DAY,
    PRESERVED_FOOD_SPOILAGE_AUTUMN_MULTIPLIER, PRESERVED_FOOD_SPOILAGE_DROUGHT_MULTIPLIER,
    PRESERVED_FOOD_SPOILAGE_PER_DAY, PRESERVED_FOOD_SPOILAGE_SPRING_MULTIPLIER,
    PRESERVED_FOOD_SPOILAGE_SUMMER_MULTIPLIER, PRESERVED_FOOD_SPOILAGE_WINTER_MULTIPLIER,
    RESIDENCE_PRESERVED_FOOD_AUTUMN_MULTIPLIER, RESIDENCE_PRESERVED_FOOD_SPRING_MULTIPLIER,
    RESIDENCE_PRESERVED_FOOD_SUMMER_MULTIPLIER, RESIDENCE_PRESERVED_FOOD_WINTER_MULTIPLIER,
    SPRING_BREEDING_MULTIPLIER, SPRING_FIREWOOD_DEMAND_MULTIPLIER,
    SPRING_PASTURE_CAPACITY_MULTIPLIER, SPRING_RAIN_CHANCE,
    SPRING_RAIN_CHARCOAL_BURNER_THROUGHPUT_MULTIPLIER, SPRING_RAIN_CROP_GROWTH_MULTIPLIER,
    SPRING_RAIN_ROAD_SPEED_MULTIPLIER, SPRING_RAIN_WATERMILL_THROUGHPUT_MULTIPLIER,
    SPRING_RAIN_WELL_REFILL_MULTIPLIER, SUMMER_DROUGHT_CHANCE, SUMMER_DROUGHT_DURATION_DAYS,
    SUMMER_FIREWOOD_DEMAND_MULTIPLIER, SUMMER_PASTURE_CAPACITY_MULTIPLIER,
    WINTER_BREEDING_MULTIPLIER, WINTER_CHARCOAL_BURNER_THROUGHPUT_MULTIPLIER,
    WINTER_FIREWOOD_DEMAND_MULTIPLIER, WINTER_PASTURE_CAPACITY_MULTIPLIER,
    WINTER_ROAD_SPEED_MULTIPLIER, WINTER_WATERMILL_THROUGHPUT_MULTIPLIER,
};
use crate::simulation::GameClock;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Season {
    Spring,
    Summer,
    Autumn,
    Winter,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WeatherKind {
    Fair,
    Rain,
    Drought,
    Frost,
}

const CLAY_PIT_RAIN_THROUGHPUT_MULTIPLIER: f64 = 0.8;
const CLAY_PIT_DROUGHT_THROUGHPUT_MULTIPLIER: f64 = 0.7;
const CLAY_PIT_FROST_THROUGHPUT_MULTIPLIER: f64 = 0.35;

#[derive(Clone, Copy, Debug)]
pub struct EnvironmentState {
    pub season: Season,
    pub weather: WeatherKind,
}

impl EnvironmentState {
    pub fn crop_growth_multiplier(self) -> f64 {
        match self.weather {
            WeatherKind::Rain => SPRING_RAIN_CROP_GROWTH_MULTIPLIER,
            WeatherKind::Drought => DROUGHT_CROP_GROWTH_MULTIPLIER,
            _ => 1.0,
        }
    }

    pub fn forage_regrowth_multiplier(self) -> f64 {
        if self.weather == WeatherKind::Drought {
            DROUGHT_FORAGE_REGROWTH_MULTIPLIER
        } else {
            1.0
        }
    }

    pub fn well_refill_multiplier(self) -> f64 {
        match self.weather {
            WeatherKind::Rain => SPRING_RAIN_WELL_REFILL_MULTIPLIER,
            WeatherKind::Drought => DROUGHT_WELL_REFILL_MULTIPLIER,
            WeatherKind::Frost => 0.7,
            WeatherKind::Fair => 1.0,
        }
    }

    pub fn fish_loss_per_second(self) -> f64 {
        if self.weather == WeatherKind::Drought {
            DROUGHT_FISH_LOSS_FRACTION_PER_DAY / CALENDAR_SECONDS_PER_DAY
        } else {
            0.0
        }
    }

    pub fn firewood_demand_multiplier(self) -> f64 {
        match self.season {
            Season::Spring => SPRING_FIREWOOD_DEMAND_MULTIPLIER,
            Season::Summer => SUMMER_FIREWOOD_DEMAND_MULTIPLIER,
            Season::Autumn => AUTUMN_FIREWOOD_DEMAND_MULTIPLIER,
            Season::Winter => WINTER_FIREWOOD_DEMAND_MULTIPLIER,
        }
    }

    pub fn pasture_capacity_multiplier(self) -> f64 {
        if self.weather == WeatherKind::Drought {
            return DROUGHT_PASTURE_CAPACITY_MULTIPLIER;
        }
        match self.season {
            Season::Spring => SPRING_PASTURE_CAPACITY_MULTIPLIER,
            Season::Summer => SUMMER_PASTURE_CAPACITY_MULTIPLIER,
            Season::Autumn => AUTUMN_PASTURE_CAPACITY_MULTIPLIER,
            Season::Winter => WINTER_PASTURE_CAPACITY_MULTIPLIER,
        }
    }

    pub fn breeding_multiplier(self) -> f64 {
        match self.season {
            Season::Spring => SPRING_BREEDING_MULTIPLIER,
            Season::Winter => WINTER_BREEDING_MULTIPLIER,
            _ => 1.0,
        }
    }

    pub fn fresh_food_spoilage_fraction_per_second(self) -> f64 {
        let daily = if self.weather == WeatherKind::Drought {
            FRESH_FOOD_SPOILAGE_DROUGHT_PER_DAY
        } else {
            match self.season {
                Season::Spring => FRESH_FOOD_SPOILAGE_SPRING_PER_DAY,
                Season::Summer => FRESH_FOOD_SPOILAGE_SUMMER_PER_DAY,
                Season::Autumn => FRESH_FOOD_SPOILAGE_AUTUMN_PER_DAY,
                Season::Winter => FRESH_FOOD_SPOILAGE_WINTER_PER_DAY,
            }
        };
        daily / CALENDAR_SECONDS_PER_DAY
    }

    pub fn preserved_food_spoilage_fraction_per_second(self) -> f64 {
        let multiplier = if self.weather == WeatherKind::Drought {
            PRESERVED_FOOD_SPOILAGE_DROUGHT_MULTIPLIER
        } else {
            match self.season {
                Season::Spring => PRESERVED_FOOD_SPOILAGE_SPRING_MULTIPLIER,
                Season::Summer => PRESERVED_FOOD_SPOILAGE_SUMMER_MULTIPLIER,
                Season::Autumn => PRESERVED_FOOD_SPOILAGE_AUTUMN_MULTIPLIER,
                Season::Winter => PRESERVED_FOOD_SPOILAGE_WINTER_MULTIPLIER,
            }
        };
        PRESERVED_FOOD_SPOILAGE_PER_DAY * multiplier / CALENDAR_SECONDS_PER_DAY
    }

    /// Cured meat and fish remain part of the same meal, but the mountain
    /// winter shifts a larger share of household calories into stored food.
    /// The four equal-length seasons average exactly 1.0 over a full year.
    pub fn preserved_food_demand_multiplier(self) -> f64 {
        match self.season {
            Season::Spring => RESIDENCE_PRESERVED_FOOD_SPRING_MULTIPLIER,
            Season::Summer => RESIDENCE_PRESERVED_FOOD_SUMMER_MULTIPLIER,
            Season::Autumn => RESIDENCE_PRESERVED_FOOD_AUTUMN_MULTIPLIER,
            Season::Winter => RESIDENCE_PRESERVED_FOOD_WINTER_MULTIPLIER,
        }
    }

    /// Dirt tracks remain fully usable, but saturated spring ground and the
    /// region's long frost season reduce handcart pace. Autumn keeps a smaller
    /// cold-season penalty so advance stockpiling and compact road branches
    /// matter without turning weather into a hard logistics shutdown.
    pub fn road_speed_multiplier(self) -> f64 {
        match self.weather {
            WeatherKind::Rain => SPRING_RAIN_ROAD_SPEED_MULTIPLIER,
            WeatherKind::Frost => WINTER_ROAD_SPEED_MULTIPLIER,
            _ if self.season == Season::Autumn => AUTUMN_ROAD_SPEED_MULTIPLIER,
            _ => 1.0,
        }
    }

    /// Mountain streams offer strong spring power and lose head during drought.
    /// Winter frost locks the mill race completely, making flour reserves or a
    /// well-exposed windmill necessary for year-round milling.
    pub fn watermill_throughput_multiplier(self) -> f64 {
        match self.weather {
            WeatherKind::Rain => SPRING_RAIN_WATERMILL_THROUGHPUT_MULTIPLIER,
            WeatherKind::Drought => DROUGHT_WATERMILL_THROUGHPUT_MULTIPLIER,
            WeatherKind::Frost => WINTER_WATERMILL_THROUGHPUT_MULTIPLIER,
            WeatherKind::Fair => 1.0,
        }
    }

    /// Alluvial clay remains available year-round, but saturated spring banks,
    /// drought-hardened ground, and winter frost slow safe hand excavation.
    /// A non-zero winter rate keeps the system recoverable while rewarding
    /// autumn stockpiles for sheltered pottery work.
    pub fn clay_pit_throughput_multiplier(self) -> f64 {
        match self.weather {
            WeatherKind::Rain => CLAY_PIT_RAIN_THROUGHPUT_MULTIPLIER,
            WeatherKind::Drought => CLAY_PIT_DROUGHT_THROUGHPUT_MULTIPLIER,
            WeatherKind::Frost => CLAY_PIT_FROST_THROUGHPUT_MULTIPLIER,
            WeatherKind::Fair => 1.0,
        }
    }

    /// Damp billets spend more of a burn driving off water, while a dry
    /// summer charge carbonizes faster. The covered mound never hard-stops:
    /// winter and rain remain viable at lower pace, and drought speed comes
    /// with the existing severe fire-risk multiplier for charcoal yards.
    pub fn charcoal_burner_throughput_multiplier(self) -> f64 {
        match self.weather {
            WeatherKind::Rain => SPRING_RAIN_CHARCOAL_BURNER_THROUGHPUT_MULTIPLIER,
            WeatherKind::Drought => DROUGHT_CHARCOAL_BURNER_THROUGHPUT_MULTIPLIER,
            WeatherKind::Frost => WINTER_CHARCOAL_BURNER_THROUGHPUT_MULTIPLIER,
            WeatherKind::Fair => 1.0,
        }
    }
}

pub fn season_for_month(month: u32) -> Season {
    match month {
        3..=5 => Season::Spring,
        6..=8 => Season::Summer,
        9..=11 => Season::Autumn,
        _ => Season::Winter,
    }
}

pub fn environment_for(
    seed: u64,
    hydrology: u8,
    severe_weather_enabled: bool,
    clock: &GameClock,
) -> EnvironmentState {
    let season = season_for_month(clock.month);
    let weather = match season {
        Season::Spring if spring_rain(seed, hydrology, clock) => WeatherKind::Rain,
        Season::Summer if severe_weather_enabled && summer_drought(seed, hydrology, clock) => {
            WeatherKind::Drought
        }
        Season::Winter => WeatherKind::Frost,
        _ => WeatherKind::Fair,
    };
    EnvironmentState { season, weather }
}

fn spring_rain(seed: u64, hydrology: u8, clock: &GameClock) -> bool {
    let chance = (SPRING_RAIN_CHANCE + hydrology as f64 / 100.0 * 0.12).min(0.8);
    unit_roll(
        seed as u32
            ^ clock.year.wrapping_mul(0x9e37_79b9)
            ^ (clock.total_days as u32).wrapping_mul(0x85eb_ca6b),
    ) < chance
}

fn summer_drought(seed: u64, hydrology: u8, clock: &GameClock) -> bool {
    let chance =
        (SUMMER_DROUGHT_CHANCE * (1.15 - hydrology as f64 / 100.0 * 0.5)).clamp(0.12, 0.65);
    let year_key = seed as u32 ^ clock.year.wrapping_mul(0xc2b2_ae35) ^ 0x7f4a_7c15;
    if unit_roll(year_key) >= chance {
        return false;
    }

    let summer_days = CALENDAR_DAYS_PER_MONTH * 3;
    let duration = SUMMER_DROUGHT_DURATION_DAYS.min(summer_days).max(1);
    let possible_starts = summer_days.saturating_sub(duration).saturating_add(1);
    let start = mix32(year_key ^ 0x27d4_eb2d) % possible_starts.max(1);
    let summer_day =
        (clock.month.saturating_sub(6)) * CALENDAR_DAYS_PER_MONTH + clock.month_day - 1;
    summer_day >= start && summer_day < start + duration
}

fn unit_roll(value: u32) -> f64 {
    (mix32(value) % 10_000) as f64 / 10_000.0
}

fn mix32(mut value: u32) -> u32 {
    value ^= value >> 16;
    value = value.wrapping_mul(0x7feb_352d);
    value ^= value >> 15;
    value = value.wrapping_mul(0x846c_a68b);
    value ^ (value >> 16)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn month_groups_are_stable() {
        assert_eq!(season_for_month(3), Season::Spring);
        assert_eq!(season_for_month(8), Season::Summer);
        assert_eq!(season_for_month(10), Season::Autumn);
        assert_eq!(season_for_month(1), Season::Winter);
    }

    #[test]
    fn summer_drought_requires_the_opt_in_severe_weather_rule() {
        let day_ticks = (CALENDAR_SECONDS_PER_DAY / crate::balance_generated::TICK_DT) as u64;
        let mut severe_drought_found = false;
        for year in 1_u64..=20 {
            for summer_day in 0_u64..u64::from(CALENDAR_DAYS_PER_MONTH * 3) {
                let elapsed_days = (year - 1) * u64::from(CALENDAR_DAYS_PER_MONTH * 12)
                    + u64::from(CALENDAR_DAYS_PER_MONTH * 3)
                    + summer_day;
                let clock = crate::simulation::game_clock(elapsed_days * day_ticks);
                assert_ne!(
                    environment_for(12_345, 35, false, &clock).weather,
                    WeatherKind::Drought
                );
                severe_drought_found |=
                    environment_for(12_345, 35, true, &clock).weather == WeatherKind::Drought;
            }
        }
        assert!(severe_drought_found);
    }

    #[test]
    fn drought_effects_are_harsher_than_fair_summer() {
        let drought = EnvironmentState {
            season: Season::Summer,
            weather: WeatherKind::Drought,
        };
        let fair = EnvironmentState {
            season: Season::Summer,
            weather: WeatherKind::Fair,
        };
        assert!(drought.crop_growth_multiplier() < fair.crop_growth_multiplier());
        assert!(
            drought.fresh_food_spoilage_fraction_per_second()
                > fair.fresh_food_spoilage_fraction_per_second()
        );
        assert!(
            drought.preserved_food_spoilage_fraction_per_second()
                > fair.preserved_food_spoilage_fraction_per_second()
        );
        assert!(drought.fish_loss_per_second() > 0.0);
        assert_eq!(drought.road_speed_multiplier(), 1.0);
    }

    #[test]
    fn cured_food_ages_slowest_in_winter_and_keeps_annual_average() {
        let rate = |season| {
            EnvironmentState {
                season,
                weather: if season == Season::Winter {
                    WeatherKind::Frost
                } else {
                    WeatherKind::Fair
                },
            }
            .preserved_food_spoilage_fraction_per_second()
        };
        let spring = rate(Season::Spring);
        let summer = rate(Season::Summer);
        let autumn = rate(Season::Autumn);
        let winter = rate(Season::Winter);
        assert!(winter < spring);
        assert!(spring < summer);
        let annual_average = (spring + summer + autumn + winter) / 4.0;
        let configured_average = PRESERVED_FOOD_SPOILAGE_PER_DAY / CALENDAR_SECONDS_PER_DAY;
        assert!((annual_average - configured_average).abs() <= 1e-12);
    }

    #[test]
    fn wet_and_cold_tracks_slow_haulage_without_stopping_it() {
        let rain = EnvironmentState {
            season: Season::Spring,
            weather: WeatherKind::Rain,
        };
        let autumn = EnvironmentState {
            season: Season::Autumn,
            weather: WeatherKind::Fair,
        };
        let frost = EnvironmentState {
            season: Season::Winter,
            weather: WeatherKind::Frost,
        };
        assert!(rain.road_speed_multiplier() < 1.0);
        assert!(rain.road_speed_multiplier() < autumn.road_speed_multiplier());
        assert!(frost.road_speed_multiplier() < rain.road_speed_multiplier());
        assert!(frost.road_speed_multiplier() > 0.5);
    }

    #[test]
    fn river_power_rewards_spring_milling_and_winter_flour_reserves() {
        let rain = EnvironmentState {
            season: Season::Spring,
            weather: WeatherKind::Rain,
        };
        let fair = EnvironmentState {
            season: Season::Autumn,
            weather: WeatherKind::Fair,
        };
        let drought = EnvironmentState {
            season: Season::Summer,
            weather: WeatherKind::Drought,
        };
        let frost = EnvironmentState {
            season: Season::Winter,
            weather: WeatherKind::Frost,
        };
        assert!(rain.watermill_throughput_multiplier() > fair.watermill_throughput_multiplier());
        assert!(drought.watermill_throughput_multiplier() < fair.watermill_throughput_multiplier());
        assert!(
            frost.watermill_throughput_multiplier() < drought.watermill_throughput_multiplier()
        );
        assert_eq!(frost.watermill_throughput_multiplier(), 0.0);
    }

    #[test]
    fn clay_banks_reward_stockpiling_without_a_hard_winter_shutdown() {
        let rain = EnvironmentState {
            season: Season::Spring,
            weather: WeatherKind::Rain,
        };
        let fair = EnvironmentState {
            season: Season::Autumn,
            weather: WeatherKind::Fair,
        };
        let drought = EnvironmentState {
            season: Season::Summer,
            weather: WeatherKind::Drought,
        };
        let frost = EnvironmentState {
            season: Season::Winter,
            weather: WeatherKind::Frost,
        };
        assert_eq!(rain.clay_pit_throughput_multiplier(), 0.8);
        assert_eq!(drought.clay_pit_throughput_multiplier(), 0.7);
        assert_eq!(frost.clay_pit_throughput_multiplier(), 0.35);
        assert_eq!(fair.clay_pit_throughput_multiplier(), 1.0);
        assert!(frost.clay_pit_throughput_multiplier() > 0.0);
    }

    #[test]
    fn charcoal_clamps_reward_dry_burns_without_a_wet_or_winter_shutdown() {
        let rain = EnvironmentState {
            season: Season::Spring,
            weather: WeatherKind::Rain,
        };
        let fair = EnvironmentState {
            season: Season::Autumn,
            weather: WeatherKind::Fair,
        };
        let drought = EnvironmentState {
            season: Season::Summer,
            weather: WeatherKind::Drought,
        };
        let frost = EnvironmentState {
            season: Season::Winter,
            weather: WeatherKind::Frost,
        };
        assert!(
            rain.charcoal_burner_throughput_multiplier()
                < fair.charcoal_burner_throughput_multiplier()
        );
        assert!(
            frost.charcoal_burner_throughput_multiplier()
                < fair.charcoal_burner_throughput_multiplier()
        );
        assert!(
            drought.charcoal_burner_throughput_multiplier()
                > fair.charcoal_burner_throughput_multiplier()
        );
        assert!(rain.charcoal_burner_throughput_multiplier() > 0.0);
        assert!(frost.charcoal_burner_throughput_multiplier() > 0.0);
    }

    #[test]
    fn preserved_ration_rotation_peaks_in_winter_without_changing_annual_balance() {
        let multipliers = [
            EnvironmentState {
                season: Season::Spring,
                weather: WeatherKind::Fair,
            }
            .preserved_food_demand_multiplier(),
            EnvironmentState {
                season: Season::Summer,
                weather: WeatherKind::Fair,
            }
            .preserved_food_demand_multiplier(),
            EnvironmentState {
                season: Season::Autumn,
                weather: WeatherKind::Fair,
            }
            .preserved_food_demand_multiplier(),
            EnvironmentState {
                season: Season::Winter,
                weather: WeatherKind::Frost,
            }
            .preserved_food_demand_multiplier(),
        ];
        assert!(multipliers[1] < multipliers[0]);
        assert!(multipliers[0] < multipliers[2]);
        assert!(multipliers[2] < multipliers[3]);
        assert!((multipliers.into_iter().sum::<f64>() / 4.0 - 1.0).abs() < 1e-9);
    }
}
