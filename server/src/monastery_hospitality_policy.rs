use crate::balance_generated::{
    MONASTERY_FEAST_ALE, MONASTERY_FEAST_FOOD, MONASTERY_FEAST_HONEY,
    MONASTERY_HOSPITALITY_BONUS_GOLD_PER_DAY, MONASTERY_HOSPITALITY_HONEY_PER_DAY,
    MONASTERY_HOSPITALITY_WINE_PER_DAY, MONASTERY_PILGRIMAGE_GOLD_PER_DAY,
};

/// Five established observances on their familiar dates inside the fixed
/// 30-day calendar: Epiphany, Saints Peter and Paul, the Assumption, the
/// Exaltation of the Holy Cross, and Christmas.
pub const MONASTERY_FEAST_DATES: [(u32, u32); 5] = [(1, 6), (6, 29), (8, 15), (9, 14), (12, 25)];

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MonasteryHospitalityUse {
    pub honey_due: f64,
    pub drink_due: f64,
    pub honey_used: f64,
    pub ale_used: f64,
    pub cider_used: f64,
    pub wine_used: f64,
    pub supply_ratio: f64,
    pub prestige_multiplier: f64,
    pub common_table_multiplier: f64,
    pub mixed_cellar: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MonasteryFeastBatch {
    pub ready: bool,
    pub missing_food: f64,
    pub missing_honey: f64,
    pub missing_drink: f64,
    pub ale_used: f64,
    pub cider_used: f64,
    pub wine_used: f64,
    pub common_table_multiplier: f64,
    pub prestige_multiplier: f64,
    pub mixed_cellar: bool,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct DrinkDraw {
    ale: f64,
    cider: f64,
    wine: f64,
    total: f64,
    common_table_multiplier: f64,
    prestige_multiplier: f64,
    mixed_cellar: bool,
}

fn draw_estate_drink(ale: f64, cider: f64, wine: f64, amount: f64) -> DrinkDraw {
    let stocks = [ale.max(0.0), cider.max(0.0), wine.max(0.0)];
    let total_stock: f64 = stocks.iter().sum();
    let total = amount.max(0.0).min(total_stock);
    if total <= 1e-9 || total_stock <= 1e-9 {
        return DrinkDraw::default();
    }
    let used = stocks.map(|stock| total * stock / total_stock);
    let distinct = used.iter().filter(|value| **value > 1e-6).count();
    let mixed_cellar = distinct >= 2;
    let ale_share = used[0] / total;
    let wine_share = used[2] / total;
    DrinkDraw {
        ale: used[0],
        cider: used[1],
        wine: used[2],
        total,
        common_table_multiplier: 1.0 + 0.25 * ale_share,
        prestige_multiplier: 1.0 + 0.25 * wine_share + if mixed_cellar { 0.10 } else { 0.0 },
        mixed_cellar,
    }
}

pub fn is_monastery_feast_day(month: u32, month_day: u32) -> bool {
    MONASTERY_FEAST_DATES.contains(&(month, month_day))
}

/// Feast stores are an atomic batch. A short pantry keeps every ingredient in
/// place for later use instead of silently consuming a partial observance.
pub fn monastery_feast_batch(
    food_available: f64,
    ale_available: f64,
    cider_available: f64,
    honey_available: f64,
    wine_available: f64,
) -> MonasteryFeastBatch {
    let missing_food = (MONASTERY_FEAST_FOOD - food_available.max(0.0)).max(0.0);
    let missing_honey = (MONASTERY_FEAST_HONEY - honey_available.max(0.0)).max(0.0);
    let drink = draw_estate_drink(
        ale_available,
        cider_available,
        wine_available,
        MONASTERY_FEAST_ALE,
    );
    let missing_drink = (MONASTERY_FEAST_ALE - drink.total).max(0.0);
    MonasteryFeastBatch {
        ready: missing_food <= 1e-9 && missing_honey <= 1e-9 && missing_drink <= 1e-9,
        missing_food,
        missing_honey,
        missing_drink,
        ale_used: drink.ale,
        cider_used: drink.cider,
        wine_used: drink.wine,
        common_table_multiplier: drink.common_table_multiplier,
        prestige_multiplier: drink.prestige_multiplier,
        mixed_cellar: drink.mixed_cellar,
    }
}

/// A configured feast batch is a hard pantry floor. Ordinary hospitality and
/// household charity may use only stock above it; disabling the policy releases
/// the whole store back into the settlement economy.
pub fn monastery_feast_surplus(stock: f64, reserve: f64, enabled: bool) -> f64 {
    let stock = stock.max(0.0);
    if enabled {
        (stock - reserve.max(0.0)).max(0.0)
    } else {
        stock
    }
}

pub fn monastery_hospitality_use(
    honey_available: f64,
    ale_available: f64,
    cider_available: f64,
    wine_available: f64,
    service_funding: f64,
    elapsed_seconds: f64,
    seconds_per_day: f64,
    enabled: bool,
) -> MonasteryHospitalityUse {
    if !enabled {
        return MonasteryHospitalityUse {
            honey_due: 0.0,
            drink_due: 0.0,
            honey_used: 0.0,
            ale_used: 0.0,
            cider_used: 0.0,
            wine_used: 0.0,
            supply_ratio: 0.0,
            prestige_multiplier: 1.0,
            common_table_multiplier: 1.0,
            mixed_cellar: false,
        };
    }
    let day_fraction = elapsed_seconds.max(0.0) / seconds_per_day.max(1e-9);
    let funded_fraction = service_funding.clamp(0.0, 1.0);
    let honey_due = MONASTERY_HOSPITALITY_HONEY_PER_DAY * day_fraction;
    let drink_due = MONASTERY_HOSPITALITY_WINE_PER_DAY * day_fraction;
    let honey_used = monastery_feast_surplus(honey_available, MONASTERY_FEAST_HONEY, enabled)
        .min(honey_due * funded_fraction);
    let drink_surplus = monastery_feast_surplus(
        ale_available.max(0.0) + cider_available.max(0.0) + wine_available.max(0.0),
        MONASTERY_FEAST_ALE,
        enabled,
    );
    let drink = draw_estate_drink(
        ale_available,
        cider_available,
        wine_available,
        (drink_due * funded_fraction).min(drink_surplus),
    );
    let honey_ratio = if honey_due > 1e-9 {
        honey_used / honey_due
    } else {
        1.0
    };
    let drink_ratio = if drink_due > 1e-9 {
        drink.total / drink_due
    } else {
        1.0
    };
    MonasteryHospitalityUse {
        honey_due,
        drink_due,
        honey_used,
        ale_used: drink.ale,
        cider_used: drink.cider,
        wine_used: drink.wine,
        supply_ratio: ((honey_ratio + drink_ratio) * 0.5).clamp(0.0, 1.0),
        prestige_multiplier: drink.prestige_multiplier,
        common_table_multiplier: drink.common_table_multiplier,
        mixed_cellar: drink.mixed_cellar,
    }
}

pub fn monastery_pilgrimage_gold(
    hospitality_enabled: bool,
    hospitality_supply_ratio: f64,
    prestige_multiplier: f64,
    guesthouse_multiplier: f64,
    elapsed_seconds: f64,
    seconds_per_day: f64,
) -> f64 {
    let day_fraction = elapsed_seconds.max(0.0) / seconds_per_day.max(1e-9);
    let hospitality_bonus = if hospitality_enabled {
        MONASTERY_HOSPITALITY_BONUS_GOLD_PER_DAY * hospitality_supply_ratio.clamp(0.0, 1.0)
    } else {
        0.0
    };
    (MONASTERY_PILGRIMAGE_GOLD_PER_DAY + hospitality_bonus * prestige_multiplier.max(1.0))
        * guesthouse_multiplier.max(1.0)
        * day_fraction
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_five_feasts_are_reachable_in_the_fixed_calendar() {
        assert_eq!(MONASTERY_FEAST_DATES.len(), 5);
        for (month, month_day) in MONASTERY_FEAST_DATES {
            assert!((1..=12).contains(&month));
            assert!((1..=crate::balance_generated::CALENDAR_DAYS_PER_MONTH).contains(&month_day));
            assert!(is_monastery_feast_day(month, month_day));
        }
        assert!(!is_monastery_feast_day(6, 28));
        assert!(!is_monastery_feast_day(12, 24));
    }

    #[test]
    fn feast_batch_is_atomic_and_names_every_shortfall() {
        let ready = monastery_feast_batch(
            MONASTERY_FEAST_FOOD,
            0.0,
            MONASTERY_FEAST_ALE,
            MONASTERY_FEAST_HONEY,
            0.0,
        );
        assert!(ready.ready);
        assert_eq!(ready.missing_food, 0.0);
        assert_eq!(ready.cider_used, MONASTERY_FEAST_ALE);

        let short = monastery_feast_batch(17.0, 8.0, 0.0, 1.5, 0.0);
        assert!(!short.ready);
        assert_eq!(short.missing_food, 1.0);
        assert_eq!(short.missing_drink, 2.0);
        assert_eq!(short.missing_honey, 2.5);
    }

    #[test]
    fn mixed_cellar_is_valid_and_has_a_small_prestige_bonus() {
        let mixed =
            monastery_feast_batch(MONASTERY_FEAST_FOOD, 5.0, 5.0, MONASTERY_FEAST_HONEY, 0.0);
        assert!(mixed.ready);
        assert!(mixed.mixed_cellar);
        assert!((mixed.prestige_multiplier - 1.10).abs() < 1e-9);
        assert!((mixed.common_table_multiplier - 1.125).abs() < 1e-9);
    }

    #[test]
    fn feast_floor_protects_one_batch_and_disabling_releases_it() {
        assert_eq!(
            monastery_feast_surplus(MONASTERY_FEAST_ALE, MONASTERY_FEAST_ALE, true),
            0.0
        );
        assert_eq!(
            monastery_feast_surplus(MONASTERY_FEAST_ALE + 2.5, MONASTERY_FEAST_ALE, true),
            2.5
        );
        assert_eq!(
            monastery_feast_surplus(MONASTERY_FEAST_ALE, MONASTERY_FEAST_ALE, false),
            MONASTERY_FEAST_ALE
        );
    }

    #[test]
    fn daily_hospitality_never_spends_the_feast_batch() {
        let protected = monastery_hospitality_use(
            MONASTERY_FEAST_HONEY,
            MONASTERY_FEAST_ALE,
            0.0,
            0.0,
            1.0,
            60.0,
            60.0,
            true,
        );
        assert_eq!(protected.honey_used, 0.0);
        assert_eq!(protected.wine_used, 0.0);
        assert_eq!(protected.supply_ratio, 0.0);
    }

    #[test]
    fn full_hospitality_preserves_the_previous_pilgrimage_income() {
        let use_plan = monastery_hospitality_use(10.0, 20.0, 0.0, 0.0, 1.0, 60.0, 60.0, true);
        assert!((use_plan.honey_used - 0.8).abs() < 1e-9);
        assert!((use_plan.ale_used - 0.5).abs() < 1e-9);
        assert!((use_plan.supply_ratio - 1.0).abs() < 1e-9);
        assert!((use_plan.common_table_multiplier - 1.25).abs() < 1e-9);
        assert!(
            (monastery_pilgrimage_gold(
                true,
                use_plan.supply_ratio,
                use_plan.prestige_multiplier,
                1.0,
                60.0,
                60.0,
            ) - 3.5)
                .abs()
                < 1e-9
        );
    }

    #[test]
    fn wine_improves_pilgrimage_prestige() {
        let use_plan = monastery_hospitality_use(10.0, 0.0, 0.0, 20.0, 1.0, 60.0, 60.0, true);
        assert!((use_plan.prestige_multiplier - 1.25).abs() < 1e-9);
        assert!(
            (monastery_pilgrimage_gold(
                true,
                use_plan.supply_ratio,
                use_plan.prestige_multiplier,
                1.0,
                60.0,
                60.0,
            ) - 3.875)
                .abs()
                < 1e-9
        );
    }

    #[test]
    fn either_missing_good_removes_half_the_hospitality_bonus() {
        let honey_only = monastery_hospitality_use(10.0, 0.0, 0.0, 0.0, 1.0, 60.0, 60.0, true);
        assert!((honey_only.supply_ratio - 0.5).abs() < 1e-9);
        assert!(
            (monastery_pilgrimage_gold(
                true,
                honey_only.supply_ratio,
                honey_only.prestige_multiplier,
                1.0,
                60.0,
                60.0,
            ) - 2.75)
                .abs()
                < 1e-9
        );
    }

    #[test]
    fn underfunding_contracts_daily_hospitality_without_fake_penalties() {
        let half_funded = monastery_hospitality_use(10.0, 20.0, 0.0, 0.0, 0.5, 60.0, 60.0, true);
        assert!((half_funded.honey_used - 0.4).abs() < 1e-9);
        assert!((half_funded.ale_used - 0.25).abs() < 1e-9);
        assert!((half_funded.supply_ratio - 0.5).abs() < 1e-9);
    }

    #[test]
    fn disabling_hospitality_preserves_goods_and_base_income() {
        let disabled = monastery_hospitality_use(10.0, 10.0, 10.0, 10.0, 1.0, 60.0, 60.0, false);
        assert_eq!(disabled.honey_used, 0.0);
        assert_eq!(disabled.wine_used, 0.0);
        assert_eq!(
            monastery_pilgrimage_gold(false, 1.0, 1.0, 1.0, 60.0, 60.0),
            2.0
        );
    }
}
