use crate::balance_generated::{
    MONASTERY_HOSPITALITY_BONUS_GOLD_PER_DAY, MONASTERY_HOSPITALITY_HONEY_PER_DAY,
    MONASTERY_HOSPITALITY_WINE_PER_DAY, MONASTERY_PILGRIMAGE_GOLD_PER_DAY,
};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MonasteryHospitalityUse {
    pub honey_due: f64,
    pub wine_due: f64,
    pub honey_used: f64,
    pub wine_used: f64,
    pub supply_ratio: f64,
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
