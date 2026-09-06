use crate::balance_generated::{
    CALENDAR_DAYS_PER_MONTH, CHAPEL_BASE_ATTENDANCE_CHANCE, CHAPEL_COMMUNITY_ATTENDANCE_BONUS,
    CHAPEL_PRIEST_ATTENDANCE_BONUS, CHAPEL_RECOVERY_STOCK_MULTIPLIER,
    CHAPEL_SABBATH_OBSERVANCE_ATTENDANCE_BONUS, CHAPEL_SABBATH_OBSERVANCE_SETTLEMENT_BONUS,
    CHAPEL_SETTLEMENT_TICKS_MULTIPLIER, CHAPEL_TITHE_GOLD_PER_PERSON_PER_DAY,
    MONASTERY_ATTENDANCE_BONUS, MONASTERY_RECOVERY_STOCK_MULTIPLIER,
    MONASTERY_SETTLEMENT_TICKS_MULTIPLIER, RESIDENCE_RECOVERY_FIREWOOD_MIN,
    RESIDENCE_RECOVERY_FOOD_MIN, RESIDENCE_RECOVERY_WATER_MIN, RESIDENCE_SETTLE_TICKS,
};
use crate::chapel_upgrade_policy::chapel_tithe_multiplier;
use crate::devotional_candle_policy::CHAPEL_LITURGY_ATTENDANCE_BONUS;
use crate::resource_units::whole_units;
use crate::simulation::residence_needs::ResidenceNeedKind;

pub fn effective_settle_ticks(
    chapel_tier: u8,
    sabbath_observance: bool,
    has_monastery_coverage: bool,
) -> u32 {
    let has_chapel_access = chapel_tier > 0;
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

    crate::chapel_upgrade_policy::bishop_settlement_ticks(ticks, chapel_tier).max(1)
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
        ResidenceNeedKind::SavoryPreserves => 4.0,
        ResidenceNeedKind::Ale => 3.0,
        ResidenceNeedKind::Cloth => 2.0,
        ResidenceNeedKind::Shoes => 2.0,
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
    devotional_candles_supplied: bool,
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

    if devotional_candles_supplied {
        chance += CHAPEL_LITURGY_ATTENDANCE_BONUS;
    }

    chance.clamp(0.0, 1.0)
}

#[cfg(test)]
pub fn chapel_monthly_tithe_gold(population: u32, attendance_share: f64) -> f64 {
    chapel_monthly_tithe_gold_for_tier(population, 1, attendance_share)
}

/// One household posts one whole tithe purse on its monthly parish day. The
/// attendance chance becomes the expected participating share of the monthly
/// assessment, avoiding an all-or-nothing month while retaining the former
/// long-run revenue rate.
pub fn chapel_monthly_tithe_gold_for_tier(
    population: u32,
    chapel_tier: u8,
    attendance_share: f64,
) -> f64 {
    if population == 0 || attendance_share <= 0.0 {
        return 0.0;
    }

    let monthly_assessment = population as f64
        * CHAPEL_TITHE_GOLD_PER_PERSON_PER_DAY
        * CALENDAR_DAYS_PER_MONTH as f64
        * chapel_tithe_multiplier(chapel_tier)
        * attendance_share.clamp(0.0, 1.0);
    whole_units(monthly_assessment + 0.5)
}

#[cfg(test)]
mod tests {
    use super::{
        chapel_attendance_chance, chapel_monthly_tithe_gold, chapel_monthly_tithe_gold_for_tier,
        effective_settle_ticks,
    };
    use crate::balance_generated::{
        CALENDAR_DAYS_PER_MONTH, CHAPEL_BASE_ATTENDANCE_CHANCE, CHAPEL_COMMUNITY_ATTENDANCE_BONUS,
        CHAPEL_PRIEST_ATTENDANCE_BONUS, CHAPEL_SETTLEMENT_TICKS_MULTIPLIER,
        CHAPEL_TITHE_GOLD_PER_PERSON_PER_DAY, MONASTERY_SETTLEMENT_TICKS_MULTIPLIER,
        RESIDENCE_SETTLE_TICKS,
    };
    use crate::devotional_candle_policy::CHAPEL_LITURGY_ATTENDANCE_BONUS;

    #[test]
    fn effective_settle_ticks_matches_balance() {
        assert_eq!(
            effective_settle_ticks(0, false, false),
            RESIDENCE_SETTLE_TICKS
        );
        assert_eq!(
            effective_settle_ticks(1, false, false),
            (RESIDENCE_SETTLE_TICKS as f64 * CHAPEL_SETTLEMENT_TICKS_MULTIPLIER).ceil() as u32,
        );
        assert_eq!(
            effective_settle_ticks(1, false, true),
            ((RESIDENCE_SETTLE_TICKS as f64
                * CHAPEL_SETTLEMENT_TICKS_MULTIPLIER
                * MONASTERY_SETTLEMENT_TICKS_MULTIPLIER)
                .ceil()) as u32,
        );
    }

    #[test]
    fn chapel_attendance_chance_matches_balance() {
        assert_eq!(chapel_attendance_chance(0, false, false, false), 0.0);
        assert_eq!(
            chapel_attendance_chance(1, false, false, false),
            CHAPEL_BASE_ATTENDANCE_CHANCE
                + CHAPEL_PRIEST_ATTENDANCE_BONUS
                + CHAPEL_COMMUNITY_ATTENDANCE_BONUS,
        );
        assert_eq!(chapel_attendance_chance(2, false, false, false), 1.0);
        assert_eq!(
            chapel_attendance_chance(1, false, false, true),
            (CHAPEL_BASE_ATTENDANCE_CHANCE
                + CHAPEL_PRIEST_ATTENDANCE_BONUS
                + CHAPEL_COMMUNITY_ATTENDANCE_BONUS
                + CHAPEL_LITURGY_ATTENDANCE_BONUS)
                .min(1.0),
        );
    }

    #[test]
    fn chapel_monthly_tithe_is_a_whole_coin_assessment() {
        let expected =
            (3.0 * CHAPEL_TITHE_GOLD_PER_PERSON_PER_DAY * CALENDAR_DAYS_PER_MONTH as f64).round();
        assert_eq!(chapel_monthly_tithe_gold(3, 1.0), expected);
        assert_eq!(chapel_monthly_tithe_gold(3, 1.0).fract(), 0.0);
    }

    #[test]
    fn upgraded_churches_collect_larger_tithes() {
        assert!(
            chapel_monthly_tithe_gold_for_tier(10, 3, 1.0)
                > chapel_monthly_tithe_gold_for_tier(10, 2, 1.0)
        );
        assert!(
            chapel_monthly_tithe_gold_for_tier(10, 2, 1.0)
                > chapel_monthly_tithe_gold_for_tier(10, 1, 1.0)
        );
    }
}
