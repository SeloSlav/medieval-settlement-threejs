use crate::balance_generated::{
    AUTUMN_FIREWOOD_DEMAND_MULTIPLIER, AUTUMN_PASTURE_CAPACITY_MULTIPLIER, CALENDAR_DAYS_PER_MONTH,
    CALENDAR_SECONDS_PER_DAY, DROUGHT_CROP_GROWTH_MULTIPLIER, DROUGHT_FISH_LOSS_FRACTION_PER_DAY,
    DROUGHT_FORAGE_REGROWTH_MULTIPLIER, DROUGHT_PASTURE_CAPACITY_MULTIPLIER,
    DROUGHT_WELL_REFILL_MULTIPLIER, FRESH_FOOD_SPOILAGE_AUTUMN_PER_DAY,
    FRESH_FOOD_SPOILAGE_DROUGHT_PER_DAY, FRESH_FOOD_SPOILAGE_SPRING_PER_DAY,
    FRESH_FOOD_SPOILAGE_SUMMER_PER_DAY, FRESH_FOOD_SPOILAGE_WINTER_PER_DAY,
    SPRING_BREEDING_MULTIPLIER, SPRING_FIREWOOD_DEMAND_MULTIPLIER,
    SPRING_PASTURE_CAPACITY_MULTIPLIER, SPRING_RAIN_CHANCE, SPRING_RAIN_CROP_GROWTH_MULTIPLIER,
    SPRING_RAIN_WELL_REFILL_MULTIPLIER, SUMMER_DROUGHT_CHANCE, SUMMER_DROUGHT_DURATION_DAYS,
    SUMMER_FIREWOOD_DEMAND_MULTIPLIER, SUMMER_PASTURE_CAPACITY_MULTIPLIER,
    WINTER_BREEDING_MULTIPLIER, WINTER_FIREWOOD_DEMAND_MULTIPLIER,
    WINTER_PASTURE_CAPACITY_MULTIPLIER,
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
}

pub fn season_for_month(month: u32) -> Season {
    match month {
        3..=5 => Season::Spring,
        6..=8 => Season::Summer,
        9..=11 => Season::Autumn,
        _ => Season::Winter,
    }
}

pub fn environment_for(seed: u64, hydrology: u8, clock: &GameClock) -> EnvironmentState {
    let season = season_for_month(clock.month);
    let weather = match season {
        Season::Spring if spring_rain(seed, hydrology, clock) => WeatherKind::Rain,
        Season::Summer if summer_drought(seed, hydrology, clock) => WeatherKind::Drought,
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
        assert!(drought.fish_loss_per_second() > 0.0);
    }
}
