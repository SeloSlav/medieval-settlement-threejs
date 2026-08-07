use crate::balance_generated::CALENDAR_DAYS_PER_MONTH;

pub const HISTORICAL_HOLIDAY_BASE_YEAR: u32 = 1550;
pub const HISTORICAL_HOLIDAY_CYCLE_YEARS: u32 = 10;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HolidayCelebrationKind {
    Solemn,
    Procession,
    Bonfire,
    Fair,
    Household,
    Carnival,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct HolidayObservance {
    pub id: &'static str,
    pub label: &'static str,
    pub period_label: &'static str,
    pub kind: HolidayCelebrationKind,
    pub period_day: u8,
    pub period_length: u8,
    pub historical_year: u32,
}

#[derive(Clone, Copy)]
struct HolidayDefinition {
    id: &'static str,
    label: &'static str,
    period_label: &'static str,
    kind: HolidayCelebrationKind,
    period_day: u8,
    period_length: u8,
}

pub fn historical_holiday_year(game_year: u32) -> u32 {
    HISTORICAL_HOLIDAY_BASE_YEAR + game_year.saturating_sub(1) % HISTORICAL_HOLIDAY_CYCLE_YEARS
}

pub fn holiday_for_date(month: u32, month_day: u32, game_year: u32) -> Option<HolidayObservance> {
    let historical_year = historical_holiday_year(game_year);
    let day_of_year = rational_day_of_year(month, month_day);
    let easter_day = julian_easter_rational_day_of_year(historical_year);
    let relative_day = day_of_year as i32 - easter_day as i32;
    movable_holiday(relative_day)
        .or_else(|| fixed_holiday(month, month_day))
        .map(|definition| HolidayObservance {
            id: definition.id,
            label: definition.label,
            period_label: definition.period_label,
            kind: definition.kind,
            period_day: definition.period_day,
            period_length: definition.period_length,
            historical_year,
        })
}

pub fn julian_easter_date(year: u32) -> (u32, u32) {
    let a = year % 4;
    let b = year % 7;
    let c = year % 19;
    let d = (19 * c + 15) % 30;
    let e = (2 * a + 4 * b + 34 - d) % 7;
    let value = d + e + 114;
    (value / 31, value % 31 + 1)
}

fn julian_easter_rational_day_of_year(year: u32) -> u32 {
    let (month, day) = julian_easter_date(year);
    rational_day_of_year(month, day.min(CALENDAR_DAYS_PER_MONTH))
}

fn rational_day_of_year(month: u32, day: u32) -> u32 {
    month.saturating_sub(1) * CALENDAR_DAYS_PER_MONTH + day.saturating_sub(1)
}

fn holiday(
    id: &'static str,
    label: &'static str,
    period_label: &'static str,
    kind: HolidayCelebrationKind,
    period_day: u8,
    period_length: u8,
) -> HolidayDefinition {
    HolidayDefinition {
        id,
        label,
        period_label,
        kind,
        period_day,
        period_length,
    }
}

fn fixed_holiday(month: u32, day: u32) -> Option<HolidayDefinition> {
    use HolidayCelebrationKind::*;
    Some(match (month, day) {
        (1, 1) => holiday(
            "circumcision",
            "Circumcision of the Lord",
            "New Year holy day",
            Solemn,
            1,
            1,
        ),
        (1, 6) => holiday(
            "epiphany",
            "Epiphany",
            "Christmas holy days",
            Procession,
            1,
            1,
        ),
        (2, 2) => holiday("candlemas", "Candlemas", "Candlemas", Procession, 1, 1),
        (3, 25) => holiday("annunciation", "Annunciation", "Annunciation", Solemn, 1, 1),
        (4, 23) => holiday("jurjevo", "Jurjevo · St George", "Jurjevo", Bonfire, 1, 1),
        (6, 24) => holiday("ivanje", "Ivanje · St John", "Ivanje", Bonfire, 1, 1),
        (6, 29) => holiday(
            "peter-and-paul",
            "Sts Peter and Paul",
            "Sts Peter and Paul",
            Solemn,
            1,
            1,
        ),
        (8, 15) => holiday(
            "assumption",
            "Assumption of Mary",
            "Assumption",
            Procession,
            1,
            1,
        ),
        (9, 8) => holiday(
            "nativity-of-mary",
            "Nativity of Mary",
            "Nativity of Mary",
            Solemn,
            1,
            1,
        ),
        (9, 29) => holiday("michaelmas", "Michaelmas", "Michaelmas", Solemn, 1, 1),
        (11, 1) => holiday("all-saints", "All Saints", "All Saints", Solemn, 1, 1),
        (11, 11) => holiday("martinje", "Martinje · St Martin", "Martinje", Fair, 1, 1),
        (12, 6) => holiday("st-nicholas", "St Nicholas", "St Nicholas", Solemn, 1, 1),
        (12, 24) => holiday(
            "christmas-eve",
            "Christmas Eve",
            "Christmas holy days",
            Household,
            1,
            3,
        ),
        (12, 25) => holiday(
            "christmas",
            "Christmas Day",
            "Christmas holy days",
            Household,
            2,
            3,
        ),
        (12, 26) => holiday(
            "st-stephen",
            "St Stephen",
            "Christmas holy days",
            Household,
            3,
            3,
        ),
        _ => return None,
    })
}

fn movable_holiday(relative_day: i32) -> Option<HolidayDefinition> {
    use HolidayCelebrationKind::*;
    Some(match relative_day {
        -48 => holiday(
            "shrove-monday",
            "Shrove Monday",
            "Shrovetide",
            Carnival,
            1,
            2,
        ),
        -47 => holiday(
            "shrove-tuesday",
            "Shrove Tuesday",
            "Shrovetide",
            Carnival,
            2,
            2,
        ),
        -2 => holiday(
            "good-friday",
            "Good Friday",
            "Paschal holy days",
            Solemn,
            1,
            4,
        ),
        -1 => holiday(
            "holy-saturday",
            "Holy Saturday",
            "Paschal holy days",
            Solemn,
            2,
            4,
        ),
        0 => holiday(
            "easter",
            "Easter Sunday",
            "Paschal holy days",
            Procession,
            3,
            4,
        ),
        1 => holiday(
            "easter-monday",
            "Easter Monday",
            "Paschal holy days",
            Household,
            4,
            4,
        ),
        39 => holiday("ascension", "Ascension", "Ascension", Procession, 1, 1),
        49 => holiday(
            "pentecost",
            "Pentecost",
            "Whitsun holy days",
            Procession,
            1,
            2,
        ),
        50 => holiday(
            "whit-monday",
            "Whit Monday",
            "Whitsun holy days",
            Household,
            2,
            2,
        ),
        60 => holiday(
            "corpus-christi",
            "Corpus Christi",
            "Corpus Christi",
            Procession,
            1,
            1,
        ),
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn julian_computus_recreates_the_1550s_easter_cycle() {
        let expected = [
            (1550, (4, 6)),
            (1551, (3, 29)),
            (1552, (4, 17)),
            (1553, (4, 2)),
            (1554, (3, 25)),
            (1555, (4, 14)),
            (1556, (4, 5)),
            (1557, (4, 18)),
            (1558, (4, 10)),
            (1559, (3, 26)),
        ];
        for (year, date) in expected {
            assert_eq!(julian_easter_date(year), date);
        }
    }

    #[test]
    fn fixed_and_multi_day_observances_are_named() {
        let jurjevo = holiday_for_date(4, 23, 1).expect("Jurjevo");
        assert_eq!(jurjevo.kind, HolidayCelebrationKind::Bonfire);
        assert_eq!(jurjevo.historical_year, 1550);

        let christmas = holiday_for_date(12, 25, 1).expect("Christmas");
        assert_eq!((christmas.period_day, christmas.period_length), (2, 3));
    }

    #[test]
    fn movable_feasts_follow_each_historical_year() {
        let easter_1550 = holiday_for_date(4, 6, 1).expect("1550 Easter");
        assert_eq!(easter_1550.id, "easter");
        let easter_1551 = holiday_for_date(3, 29, 2).expect("1551 Easter");
        assert_eq!(easter_1551.id, "easter");
        assert_eq!(historical_holiday_year(11), 1550);
    }
}
