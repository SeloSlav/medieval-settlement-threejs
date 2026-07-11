use crate::balance_generated::{
    ABANDON_AFTER_DEFICIT_TICKS, CHAPEL_ABANDONMENT_DEFICIT_MULTIPLIER,
    CHAPEL_BASE_ATTENDANCE_CHANCE, CHAPEL_COMMUNITY_ATTENDANCE_BONUS,
    CHAPEL_PRIEST_ATTENDANCE_BONUS, CHAPEL_RECOVERY_NEEDS_REQUIRED,
    CHAPEL_RECOVERY_STOCK_MULTIPLIER, CHAPEL_SETTLEMENT_TICKS_MULTIPLIER,
    CHAPEL_TITHE_GOLD_PER_PERSON_PER_DAY, RESIDENCE_RECOVERY_FIREWOOD_MIN,
    RESIDENCE_RECOVERY_FOOD_MIN, RESIDENCE_RECOVERY_WATER_MIN, RESIDENCE_SETTLE_TICKS,
    TICK_DT,
};
use crate::simulation::residence_needs::ResidenceNeedKind;

const SECONDS_PER_DAY: f64 = 86_400.0;

pub fn effective_settle_ticks(has_chapel_access: bool) -> u32 {
    if !has_chapel_access {
        return RESIDENCE_SETTLE_TICKS;
    }

    ((RESIDENCE_SETTLE_TICKS as f64) * CHAPEL_SETTLEMENT_TICKS_MULTIPLIER).ceil() as u32
}

pub fn effective_abandon_after_deficit_ticks(has_chapel_access: bool) -> u32 {
    if !has_chapel_access {
        return ABANDON_AFTER_DEFICIT_TICKS;
    }

    (ABANDON_AFTER_DEFICIT_TICKS as f64 / CHAPEL_ABANDONMENT_DEFICIT_MULTIPLIER).ceil() as u32
}

pub fn recovery_stock_min(kind: ResidenceNeedKind, has_chapel_access: bool) -> f64 {
    let base = match kind {
        ResidenceNeedKind::Firewood => RESIDENCE_RECOVERY_FIREWOOD_MIN,
        ResidenceNeedKind::Water => RESIDENCE_RECOVERY_WATER_MIN,
        ResidenceNeedKind::Food => RESIDENCE_RECOVERY_FOOD_MIN,
    };

    if !has_chapel_access {
        return base;
    }

    base * CHAPEL_RECOVERY_STOCK_MULTIPLIER
}

pub fn recovery_needs_required(has_chapel_access: bool) -> u32 {
    if has_chapel_access {
        CHAPEL_RECOVERY_NEEDS_REQUIRED.min(ResidenceNeedKind::ALL.len() as u32)
    } else {
        ResidenceNeedKind::ALL.len() as u32
    }
}

pub fn chapel_attendance_chance(assigned_labor: u32) -> f64 {
    if assigned_labor == 0 {
        return 0.0;
    }

    (CHAPEL_BASE_ATTENDANCE_CHANCE
        + CHAPEL_PRIEST_ATTENDANCE_BONUS * assigned_labor as f64
        + CHAPEL_COMMUNITY_ATTENDANCE_BONUS)
        .clamp(0.0, 1.0)
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
        chapel_attendance_chance, chapel_tithe_gold_per_tick, effective_abandon_after_deficit_ticks,
        effective_settle_ticks, recovery_needs_required,
    };
    use crate::balance_generated::{
        ABANDON_AFTER_DEFICIT_TICKS, CHAPEL_BASE_ATTENDANCE_CHANCE,
        CHAPEL_COMMUNITY_ATTENDANCE_BONUS, CHAPEL_PRIEST_ATTENDANCE_BONUS,
        CHAPEL_RECOVERY_NEEDS_REQUIRED, CHAPEL_SETTLEMENT_TICKS_MULTIPLIER,
        CHAPEL_TITHE_GOLD_PER_PERSON_PER_DAY, RESIDENCE_SETTLE_TICKS, TICK_DT,
    };
    use crate::simulation::residence_needs::ResidenceNeedKind;

    #[test]
    fn effective_settle_ticks_matches_balance() {
        assert_eq!(effective_settle_ticks(false), RESIDENCE_SETTLE_TICKS);
        assert_eq!(
            effective_settle_ticks(true),
            (RESIDENCE_SETTLE_TICKS as f64 * CHAPEL_SETTLEMENT_TICKS_MULTIPLIER).ceil() as u32,
        );
    }

    #[test]
    fn effective_abandon_ticks_matches_balance() {
        assert_eq!(effective_abandon_after_deficit_ticks(false), ABANDON_AFTER_DEFICIT_TICKS);
        assert_eq!(effective_abandon_after_deficit_ticks(true), 5143);
    }

    #[test]
    fn recovery_needs_required_uses_all_needs_without_chapel() {
        assert_eq!(
            recovery_needs_required(false),
            ResidenceNeedKind::ALL.len() as u32,
        );
        assert_eq!(recovery_needs_required(true), CHAPEL_RECOVERY_NEEDS_REQUIRED);
    }

    #[test]
    fn chapel_attendance_chance_matches_balance() {
        assert_eq!(chapel_attendance_chance(0), 0.0);
        assert_eq!(
            chapel_attendance_chance(1),
            CHAPEL_BASE_ATTENDANCE_CHANCE
                + CHAPEL_PRIEST_ATTENDANCE_BONUS
                + CHAPEL_COMMUNITY_ATTENDANCE_BONUS,
        );
        assert_eq!(chapel_attendance_chance(2), 1.0);
    }

    #[test]
    fn chapel_tithe_gold_per_tick_matches_balance() {
        let expected = 3.0 * CHAPEL_TITHE_GOLD_PER_PERSON_PER_DAY * TICK_DT / 86_400.0;
        assert!((chapel_tithe_gold_per_tick(3) - expected).abs() < 1e-9);
    }
}
