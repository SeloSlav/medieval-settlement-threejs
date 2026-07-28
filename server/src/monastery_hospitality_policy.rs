use crate::balance_generated::{
    MONASTERY_FEAST_ALE, MONASTERY_FEAST_FOOD, MONASTERY_FEAST_HONEY, MONASTERY_FEAST_WINE,
    MONASTERY_HOSPITALITY_BONUS_GOLD_PER_DAY,
    MONASTERY_HOSPITALITY_HONEY_PER_DAY, MONASTERY_HOSPITALITY_WINE_PER_DAY,
    MONASTERY_PILGRIMAGE_GOLD_PER_DAY,
};

/// The game compresses each month to ten days. These dates preserve the
/// approximate place of five established observances inside that calendar:
/// Epiphany, Saints Peter and Paul, the Assumption, the Exaltation of the Holy
/// Cross, and Christmas.
pub const MONASTERY_FEAST_DATES: [(u32, u32); 5] =
    [(1, 2), (6, 10), (8, 5), (9, 5), (12, 9)];

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MonasteryHospitalityUse {
    pub honey_due: f64,
    pub wine_due: f64,
    pub honey_used: f64,
    pub wine_used: f64,
    pub supply_ratio: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MonasteryFeastBatch {
    pub ready: bool,
    pub missing_food: f64,
    pub missing_ale: f64,
    pub missing_honey: f64,
    pub missing_wine: f64,
}

pub fn is_monastery_feast_day(month: u32, month_day: u32) -> bool {
    MONASTERY_FEAST_DATES.contains(&(month, month_day))
}

/// Feast stores are an atomic batch. A short pantry keeps every ingredient in
/// place for later use instead of silently consuming a partial observance.
pub fn monastery_feast_batch(
    food_available: f64,
    ale_available: f64,
    honey_available: f64,
    wine_available: f64,
) -> MonasteryFeastBatch {
    let missing_food = (MONASTERY_FEAST_FOOD - food_available.max(0.0)).max(0.0);
    let missing_ale = (MONASTERY_FEAST_ALE - ale_available.max(0.0)).max(0.0);
    let missing_honey = (MONASTERY_FEAST_HONEY - honey_available.max(0.0)).max(0.0);
    let missing_wine = (MONASTERY_FEAST_WINE - wine_available.max(0.0)).max(0.0);
    MonasteryFeastBatch {
        ready: missing_food <= 1e-9
            && missing_ale <= 1e-9
            && missing_honey <= 1e-9
            && missing_wine <= 1e-9,
        missing_food,
        missing_ale,
        missing_honey,
        missing_wine,
    }
}

pub fn monastery_hospitality_use(
    honey_available: f64,
    wine_available: f64,
    elapsed_seconds: f64,
    seconds_per_day: f64,
    enabled: bool,
) -> MonasteryHospitalityUse {
    if !enabled {
        return MonasteryHospitalityUse {
            honey_due: 0.0,
            wine_due: 0.0,
            honey_used: 0.0,
            wine_used: 0.0,
            supply_ratio: 0.0,
        };
    }
    let day_fraction = elapsed_seconds.max(0.0) / seconds_per_day.max(1e-9);
    let honey_due = MONASTERY_HOSPITALITY_HONEY_PER_DAY * day_fraction;
    let wine_due = MONASTERY_HOSPITALITY_WINE_PER_DAY * day_fraction;
    let honey_used = honey_available.max(0.0).min(honey_due);
    let wine_used = wine_available.max(0.0).min(wine_due);
    let honey_ratio = if honey_due > 1e-9 {
        honey_used / honey_due
    } else {
        1.0
    };
    let wine_ratio = if wine_due > 1e-9 {
        wine_used / wine_due
    } else {
        1.0
    };
    MonasteryHospitalityUse {
        honey_due,
        wine_due,
        honey_used,
        wine_used,
        supply_ratio: ((honey_ratio + wine_ratio) * 0.5).clamp(0.0, 1.0),
    }
}

pub fn monastery_pilgrimage_gold(
    hospitality_enabled: bool,
    hospitality_supply_ratio: f64,
    elapsed_seconds: f64,
    seconds_per_day: f64,
) -> f64 {
    let day_fraction = elapsed_seconds.max(0.0) / seconds_per_day.max(1e-9);
    let hospitality_bonus = if hospitality_enabled {
        MONASTERY_HOSPITALITY_BONUS_GOLD_PER_DAY * hospitality_supply_ratio.clamp(0.0, 1.0)
    } else {
        0.0
    };
    (MONASTERY_PILGRIMAGE_GOLD_PER_DAY + hospitality_bonus) * day_fraction
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_five_feasts_are_reachable_in_the_compressed_calendar() {
        assert_eq!(MONASTERY_FEAST_DATES.len(), 5);
        for (month, month_day) in MONASTERY_FEAST_DATES {
            assert!((1..=12).contains(&month));
            assert!(
                (1..=crate::balance_generated::CALENDAR_DAYS_PER_MONTH).contains(&month_day)
            );
            assert!(is_monastery_feast_day(month, month_day));
        }
        assert!(!is_monastery_feast_day(6, 29));
        assert!(!is_monastery_feast_day(12, 25));
    }

    #[test]
    fn feast_batch_is_atomic_and_names_every_shortfall() {
        let ready = monastery_feast_batch(
            MONASTERY_FEAST_FOOD,
            MONASTERY_FEAST_ALE,
            MONASTERY_FEAST_HONEY,
            MONASTERY_FEAST_WINE,
        );
        assert!(ready.ready);
        assert_eq!(ready.missing_food, 0.0);

        let short = monastery_feast_batch(17.0, 8.0, 1.5, 0.0);
        assert!(!short.ready);
        assert_eq!(short.missing_food, 1.0);
        assert_eq!(short.missing_ale, 2.0);
        assert_eq!(short.missing_honey, 2.5);
        assert_eq!(short.missing_wine, 3.0);
    }

    #[test]
    fn full_hospitality_preserves_the_previous_pilgrimage_income() {
        let use_plan = monastery_hospitality_use(10.0, 10.0, 60.0, 60.0, true);
        assert!((use_plan.honey_used - 0.8).abs() < 1e-9);
        assert!((use_plan.wine_used - 0.5).abs() < 1e-9);
        assert!((use_plan.supply_ratio - 1.0).abs() < 1e-9);
        assert!(
            (monastery_pilgrimage_gold(true, use_plan.supply_ratio, 60.0, 60.0) - 3.5).abs() < 1e-9
        );
    }

    #[test]
    fn either_missing_good_removes_half_the_hospitality_bonus() {
        let honey_only = monastery_hospitality_use(10.0, 0.0, 60.0, 60.0, true);
        assert!((honey_only.supply_ratio - 0.5).abs() < 1e-9);
        assert!(
            (monastery_pilgrimage_gold(true, honey_only.supply_ratio, 60.0, 60.0) - 2.75).abs()
                < 1e-9
        );
    }

    #[test]
    fn disabling_hospitality_preserves_goods_and_base_income() {
        let disabled = monastery_hospitality_use(10.0, 10.0, 60.0, 60.0, false);
        assert_eq!(disabled.honey_used, 0.0);
        assert_eq!(disabled.wine_used, 0.0);
        assert_eq!(monastery_pilgrimage_gold(false, 1.0, 60.0, 60.0), 2.0);
    }
}
