use crate::balance_generated::{
    CHAPEL_BASE_ATTENDANCE_CHANCE, CHAPEL_COMMUNITY_ATTENDANCE_BONUS,
    CHAPEL_PRIEST_ATTENDANCE_BONUS, CHAPEL_RECOVERY_STOCK_MULTIPLIER,
    CHAPEL_SABBATH_OBSERVANCE_ATTENDANCE_BONUS, CHAPEL_SABBATH_OBSERVANCE_SETTLEMENT_BONUS,
    CHAPEL_SETTLEMENT_TICKS_MULTIPLIER, CHAPEL_TITHE_GOLD_PER_PERSON_PER_DAY,
    MONASTERY_ATTENDANCE_BONUS, MONASTERY_RECOVERY_STOCK_MULTIPLIER,
    MONASTERY_SETTLEMENT_TICKS_MULTIPLIER, RESIDENCE_RECOVERY_FIREWOOD_MIN,
    RESIDENCE_RECOVERY_FOOD_MIN, RESIDENCE_RECOVERY_WATER_MIN, RESIDENCE_SETTLE_TICKS,
};
use crate::chapel_parish_policy::chapel_daily_gold_per_work_tick;
use crate::chapel_upgrade_policy::chapel_tithe_multiplier;
use crate::simulation::residence_needs::ResidenceNeedKind;

pub fn effective_settle_ticks(
    has_chapel_access: bool,
    sabbath_observance: bool,
    has_monastery_coverage: bool,
) -> u32 {
    let mut ticks = if !has_chapel_access {
        RESIDENCE_SETTLE_TICKS
    } else {
        ((RESIDENCE_SETTLE_TICKS as f64) * CHAPEL_SETTLEMENT_TICKS_MULTIPLIER).ceil() as u32
    };

    if has_chapel_access && has_monastery_coverage {
        ticks = ((ticks as f64) * MONASTERY_SETTLEMENT_TICKS_MULTIPLIER).ceil() as u32;
    }

    if has_chapel_access && sabbath_observance {
        ticks = ((ticks as f64) * (1.0 - CHAPEL_SABBATH_OBSERVANCE_SETTLEMENT_BONUS)).ceil() as u32;
    }

    ticks.max(1)
}

pub fn recovery_stock_min(
    kind: ResidenceNeedKind,
    has_chapel_access: bool,
    has_monastery_coverage: bool,
) -> f64 {
    let base = match kind {
        ResidenceNeedKind::Firewood => RESIDENCE_RECOVERY_FIREWOOD_MIN,
        ResidenceNeedKind::Water => RESIDENCE_RECOVERY_WATER_MIN,
        ResidenceNeedKind::Food => RESIDENCE_RECOVERY_FOOD_MIN,
        ResidenceNeedKind::PreservedFood => 4.0,
        ResidenceNeedKind::Ale => 3.0,
        ResidenceNeedKind::Cloth => 2.0,
        ResidenceNeedKind::Pottery => 2.0,
        ResidenceNeedKind::Church => 1.0,
        ResidenceNeedKind::FoodVariety => 2.0,
        ResidenceNeedKind::Luxury => 1.0,
    };

    let mut threshold = base;
    if has_chapel_access {
        threshold *= CHAPEL_RECOVERY_STOCK_MULTIPLIER;
    }
    if has_chapel_access && has_monastery_coverage {
        threshold *= MONASTERY_RECOVERY_STOCK_MULTIPLIER;
    }
    threshold
}

pub fn chapel_attendance_chance(
    assigned_labor: u32,
    sabbath_observance: bool,
    has_monastery_coverage: bool,
) -> f64 {
    if assigned_labor == 0 {
        return 0.0;
    }

    let mut chance = CHAPEL_BASE_ATTENDANCE_CHANCE
        + CHAPEL_PRIEST_ATTENDANCE_BONUS * assigned_labor as f64
        + CHAPEL_COMMUNITY_ATTENDANCE_BONUS;

    if sabbath_observance {
        chance += CHAPEL_SABBATH_OBSERVANCE_ATTENDANCE_BONUS;
    }

    if has_monastery_coverage {
        chance += MONASTERY_ATTENDANCE_BONUS;
    }

    chance.clamp(0.0, 1.0)
}

#[cfg(test)]
pub fn chapel_tithe_gold_per_tick(population: u32) -> f64 {
    chapel_tithe_gold_per_tick_for_tier(population, 1)
}

pub fn chapel_tithe_gold_per_tick_for_tier(population: u32, chapel_tier: u8) -> f64 {
    if population == 0 {
        return 0.0;
    }

    chapel_daily_gold_per_work_tick(
        population as f64
            * CHAPEL_TITHE_GOLD_PER_PERSON_PER_DAY
            * chapel_tithe_multiplier(chapel_tier),
    )
}

#[cfg(test)]
mod tests {
    use super::{
        chapel_attendance_chance, chapel_tithe_gold_per_tick, chapel_tithe_gold_per_tick_for_tier,
        effective_settle_ticks,
    };
    use crate::balance_generated::{
        CHAPEL_BASE_ATTENDANCE_CHANCE, CHAPEL_COMMUNITY_ATTENDANCE_BONUS,
        CHAPEL_PRIEST_ATTENDANCE_BONUS, CHAPEL_SETTLEMENT_TICKS_MULTIPLIER,
        CHAPEL_TITHE_GOLD_PER_PERSON_PER_DAY, MONASTERY_SETTLEMENT_TICKS_MULTIPLIER,
        RESIDENCE_SETTLE_TICKS,
    };
    use crate::chapel_parish_policy::chapel_daily_gold_per_work_tick;

    #[test]
    fn effective_settle_ticks_matches_balance() {
        assert_eq!(
            effective_settle_ticks(false, false, false),
            RESIDENCE_SETTLE_TICKS
        );
        assert_eq!(
            effective_settle_ticks(true, false, false),
            (RESIDENCE_SETTLE_TICKS as f64 * CHAPEL_SETTLEMENT_TICKS_MULTIPLIER).ceil() as u32,
        );
        assert_eq!(
            effective_settle_ticks(true, false, true),
            ((RESIDENCE_SETTLE_TICKS as f64
                * CHAPEL_SETTLEMENT_TICKS_MULTIPLIER
                * MONASTERY_SETTLEMENT_TICKS_MULTIPLIER)
                .ceil()) as u32,
        );
    }

    #[test]
    fn chapel_attendance_chance_matches_balance() {
        assert_eq!(chapel_attendance_chance(0, false, false), 0.0);
        assert_eq!(
            chapel_attendance_chance(1, false, false),
            CHAPEL_BASE_ATTENDANCE_CHANCE
                + CHAPEL_PRIEST_ATTENDANCE_BONUS
                + CHAPEL_COMMUNITY_ATTENDANCE_BONUS,
        );
        assert_eq!(chapel_attendance_chance(2, false, false), 1.0);
    }

    #[test]
    fn chapel_tithe_gold_per_tick_matches_balance() {
        let expected = chapel_daily_gold_per_work_tick(3.0 * CHAPEL_TITHE_GOLD_PER_PERSON_PER_DAY);
        assert!((chapel_tithe_gold_per_tick(3) - expected).abs() < 1e-9);
    }

    #[test]
    fn upgraded_churches_collect_larger_tithes() {
        assert!(
            chapel_tithe_gold_per_tick_for_tier(3, 3) > chapel_tithe_gold_per_tick_for_tier(3, 2)
        );
        assert!(
            chapel_tithe_gold_per_tick_for_tier(3, 2) > chapel_tithe_gold_per_tick_for_tier(3, 1)
        );
    }
}
