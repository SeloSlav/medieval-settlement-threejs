//! Discrete household obligations.
//!
//! A residence pays with physical whole units at calendar boundaries. Billing
//! days are spread across the month so markets do not empty in one tick, and a
//! holy day moves the obligation to the next ordinary day instead of waiving
//! it. Slow-wearing goods use multi-month cadences rather than fractional
//! per-tick deductions.

use crate::balance_generated::{
    CALENDAR_DAYS_PER_MONTH, RESIDENCE_ALE_UNITS_PER_MONTH, RESIDENCE_CLOTH_MONTHS_PER_UNIT,
    RESIDENCE_FIREWOOD_UNITS_PER_MONTH, RESIDENCE_LUXURY_UNITS_PER_MONTH,
    RESIDENCE_POTTERY_MONTHS_PER_UNIT, RESIDENCE_SHOES_MONTHS_PER_UNIT,
    RESIDENCE_WATER_UNITS_PER_DAY,
};
use crate::holiday_calendar::holiday_for_date;
use crate::resource_units::whole_units;
use crate::simulation::residence_needs::ResidenceNeedKind;
use crate::simulation::{calendar_day_started, GameClock};

fn household_service_day_started(clock: &GameClock) -> bool {
    calendar_day_started(clock)
}

fn preferred_billing_day(residence_id: u64) -> u32 {
    1 + (residence_id % u64::from(CALENDAR_DAYS_PER_MONTH.max(1))) as u32
}

fn billing_day(residence_id: u64, month: u32, year: u32) -> u32 {
    let preferred = preferred_billing_day(residence_id);
    for day in preferred..=CALENDAR_DAYS_PER_MONTH {
        if holiday_for_date(month, day, year).is_none() {
            return day;
        }
    }
    (1..preferred)
        .rev()
        .find(|day| holiday_for_date(month, *day, year).is_none())
        .unwrap_or(preferred)
}

pub fn monthly_household_bill_due(residence_id: u64, clock: &GameClock) -> bool {
    household_service_day_started(clock)
        && clock.month_day == billing_day(residence_id, clock.month, clock.year)
}

pub fn daily_household_bill_due(clock: &GameClock) -> bool {
    household_service_day_started(clock)
}

fn interval_month_due(residence_id: u64, clock: &GameClock, months: u32) -> bool {
    if months <= 1 {
        return monthly_household_bill_due(residence_id, clock);
    }
    let absolute_month = clock.year.saturating_sub(1) * 12 + clock.month.saturating_sub(1);
    monthly_household_bill_due(residence_id, clock)
        && (absolute_month + residence_id as u32 % months) % months == 0
}

pub fn need_units_due(
    residence_id: u64,
    kind: ResidenceNeedKind,
    clock: &GameClock,
) -> Option<f64> {
    let due = match kind {
        ResidenceNeedKind::Firewood => monthly_household_bill_due(residence_id, clock)
            .then_some(RESIDENCE_FIREWOOD_UNITS_PER_MONTH),
        ResidenceNeedKind::Water => {
            daily_household_bill_due(clock).then_some(RESIDENCE_WATER_UNITS_PER_DAY)
        }
        ResidenceNeedKind::Ale => {
            monthly_household_bill_due(residence_id, clock).then_some(RESIDENCE_ALE_UNITS_PER_MONTH)
        }
        ResidenceNeedKind::Cloth => {
            interval_month_due(residence_id, clock, RESIDENCE_CLOTH_MONTHS_PER_UNIT).then_some(1.0)
        }
        ResidenceNeedKind::Shoes => {
            interval_month_due(residence_id, clock, RESIDENCE_SHOES_MONTHS_PER_UNIT).then_some(1.0)
        }
        ResidenceNeedKind::Pottery => {
            interval_month_due(residence_id, clock, RESIDENCE_POTTERY_MONTHS_PER_UNIT)
                .then_some(1.0)
        }
        ResidenceNeedKind::Luxury => monthly_household_bill_due(residence_id, clock)
            .then_some(RESIDENCE_LUXURY_UNITS_PER_MONTH),
        ResidenceNeedKind::Food
        | ResidenceNeedKind::SavoryPreserves
        | ResidenceNeedKind::Church
        | ResidenceNeedKind::FoodVariety => None,
    }?;
    let due = whole_units(due);
    (due >= 1.0).then_some(due)
}

#[cfg(test)]
mod tests {
    use super::{monthly_household_bill_due, need_units_due};
    use crate::balance_generated::{CALENDAR_SECONDS_PER_DAY, TICK_DT};
    use crate::simulation::game_clock;
    use crate::simulation::residence_needs::ResidenceNeedKind;

    fn first_calendar_tick_of_total_day(day: u64) -> u64 {
        let ticks_per_day = (CALENDAR_SECONDS_PER_DAY / TICK_DT).round() as u64;
        // The game starts eight calendar hours into day zero. Date-boundary
        // billing is therefore one third of a day earlier than this simple
        // total-day marker.
        day * ticks_per_day - ticks_per_day / 3
    }

    #[test]
    fn one_firewood_unit_is_due_once_per_household_month() {
        let residence_id = 4;
        let mut charges = Vec::new();
        for day in 1..=60 {
            let clock = game_clock(first_calendar_tick_of_total_day(day));
            if monthly_household_bill_due(residence_id, &clock) {
                charges.push((clock.month, clock.month_day));
                assert_eq!(
                    need_units_due(residence_id, ResidenceNeedKind::Firewood, &clock),
                    Some(1.0)
                );
            }
        }
        assert_eq!(charges.len(), 2);
    }

    #[test]
    fn holy_day_moves_billing_without_erasing_it() {
        // Residence 5 prefers day 6, Easter in April 1550. It must be charged
        // on the first ordinary date after the observance.
        let residence_id = 5;
        let april_days = (30..60)
            .map(first_calendar_tick_of_total_day)
            .map(game_clock)
            .filter(|clock| monthly_household_bill_due(residence_id, clock))
            .collect::<Vec<_>>();
        assert_eq!(april_days.len(), 1);
        assert!(april_days[0].month_day > 6);
    }
}
