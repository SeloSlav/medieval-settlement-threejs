use crate::balance_generated::{
    ABANDON_AFTER_DEFICIT_TICKS, CALENDAR_SECONDS_PER_DAY, CHAPEL_ABANDONMENT_DEFICIT_MULTIPLIER,
    CHAPEL_BASE_ATTENDANCE_CHANCE, CHAPEL_COMMUNITY_ATTENDANCE_BONUS,
    CHAPEL_PRIEST_ATTENDANCE_BONUS, CHAPEL_RECOVERY_NEEDS_REQUIRED,
    CHAPEL_RECOVERY_STOCK_MULTIPLIER, CHAPEL_SABBATH_OBSERVANCE_ATTENDANCE_BONUS,
    CHAPEL_SABBATH_OBSERVANCE_SETTLEMENT_BONUS, CHAPEL_SETTLEMENT_TICKS_MULTIPLIER,
    CHAPEL_TITHE_GOLD_PER_PERSON_PER_DAY, MONASTERY_ABANDONMENT_DEFICIT_MULTIPLIER,
    MONASTERY_ATTENDANCE_BONUS, MONASTERY_RECOVERY_STOCK_MULTIPLIER,
    MONASTERY_SETTLEMENT_TICKS_MULTIPLIER, RESIDENCE_RECOVERY_FIREWOOD_MIN,
    RESIDENCE_RECOVERY_FOOD_MIN, RESIDENCE_RECOVERY_WATER_MIN, RESIDENCE_SETTLE_TICKS,
    RESIDENCE_TIER1_ABANDONMENT_GRACE_MULTIPLIER, RESIDENCE_TIER2_ABANDONMENT_GRACE_MULTIPLIER,
    RESIDENCE_TIER3_ABANDONMENT_GRACE_MULTIPLIER, TICK_DT,
};
use crate::simulation::residence_needs::ResidenceNeedKind;

const SECONDS_PER_DAY: f64 = CALENDAR_SECONDS_PER_DAY;

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

pub fn effective_abandon_after_deficit_ticks(
    residence_tier: u8,
    has_chapel_access: bool,
    has_monastery_coverage: bool,
) -> u32 {
    let tier_grace = match residence_tier {
        1 => RESIDENCE_TIER1_ABANDONMENT_GRACE_MULTIPLIER,
        2 => RESIDENCE_TIER2_ABANDONMENT_GRACE_MULTIPLIER,
        _ => RESIDENCE_TIER3_ABANDONMENT_GRACE_MULTIPLIER,
    };
    let base_ticks = ABANDON_AFTER_DEFICIT_TICKS as f64 * tier_grace;
    let mut ticks = if !has_chapel_access {
        base_ticks
    } else {
        base_ticks / CHAPEL_ABANDONMENT_DEFICIT_MULTIPLIER
    };

    if has_chapel_access && has_monastery_coverage {
        ticks /= MONASTERY_ABANDONMENT_DEFICIT_MULTIPLIER;
    }

    ticks.ceil() as u32
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

pub fn recovery_needs_required(has_chapel_access: bool) -> u32 {
    if has_chapel_access {
        CHAPEL_RECOVERY_NEEDS_REQUIRED.min(ResidenceNeedKind::ALL.len() as u32)
    } else {
        ResidenceNeedKind::ALL.len() as u32
    }
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

pub fn chapel_tithe_gold_per_tick(population: u32) -> f64 {
    if population == 0 {
        return 0.0;
    }

    population as f64 * CHAPEL_TITHE_GOLD_PER_PERSON_PER_DAY * TICK_DT / SECONDS_PER_DAY
}

#[cfg(test)]
mod tests {
    use super::{
        chapel_attendance_chance, chapel_tithe_gold_per_tick,
        effective_abandon_after_deficit_ticks, effective_settle_ticks, recovery_needs_required,
    };
    use crate::balance_generated::{
        ABANDON_AFTER_DEFICIT_TICKS, CHAPEL_BASE_ATTENDANCE_CHANCE,
        CHAPEL_COMMUNITY_ATTENDANCE_BONUS, CHAPEL_PRIEST_ATTENDANCE_BONUS,
        CHAPEL_RECOVERY_NEEDS_REQUIRED, CHAPEL_SETTLEMENT_TICKS_MULTIPLIER,
        CHAPEL_TITHE_GOLD_PER_PERSON_PER_DAY, MONASTERY_SETTLEMENT_TICKS_MULTIPLIER,
        RESIDENCE_SETTLE_TICKS, RESIDENCE_TIER1_ABANDONMENT_GRACE_MULTIPLIER, TICK_DT,
    };
    use crate::simulation::residence_needs::ResidenceNeedKind;

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
    fn effective_abandon_ticks_matches_balance() {
        assert_eq!(
            effective_abandon_after_deficit_ticks(1, false, false),
            (ABANDON_AFTER_DEFICIT_TICKS as f64 * RESIDENCE_TIER1_ABANDONMENT_GRACE_MULTIPLIER)
                as u32,
        );
        assert_eq!(effective_abandon_after_deficit_ticks(2, false, false), 5400);
        assert_eq!(effective_abandon_after_deficit_ticks(3, false, false), 3600);
        assert_eq!(effective_abandon_after_deficit_ticks(3, true, false), 5143);
    }

    #[test]
    fn recovery_needs_required_uses_all_needs_without_chapel() {
        assert_eq!(
            recovery_needs_required(false),
            ResidenceNeedKind::ALL.len() as u32,
        );
        assert_eq!(
            recovery_needs_required(true),
            CHAPEL_RECOVERY_NEEDS_REQUIRED
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
        let expected = 3.0 * CHAPEL_TITHE_GOLD_PER_PERSON_PER_DAY * TICK_DT
            / crate::balance_generated::CALENDAR_SECONDS_PER_DAY;
        assert!((chapel_tithe_gold_per_tick(3) - expected).abs() < 1e-9);
    }
}
