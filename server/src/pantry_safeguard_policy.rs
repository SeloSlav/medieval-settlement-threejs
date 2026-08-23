//! Settlement-wide Town Hall rules for routine market issues and automatic
//! critical pantry safeguards.

pub const PANTRY_DAILY_ISSUE_ONLY: u8 = 0;
pub const PANTRY_ONE_DAY_SAFEGUARD: u8 = 1;
pub const PANTRY_TWO_DAY_SAFEGUARD: u8 = 2;
pub const PANTRY_SAFEGUARD_DEFAULT: u8 = PANTRY_ONE_DAY_SAFEGUARD;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EmergencyPantryRule {
    pub trigger_days: f64,
    pub target_days: f64,
}

pub fn valid_pantry_safeguard_policy(policy: u8) -> bool {
    policy <= PANTRY_TWO_DAY_SAFEGUARD
}

pub fn normalize_pantry_safeguard_policy(policy: u8) -> u8 {
    if valid_pantry_safeguard_policy(policy) {
        policy
    } else {
        PANTRY_SAFEGUARD_DEFAULT
    }
}

/// Daily market issues remain universal. This optional deeper buffer uses only
/// provisions already staged at a covered market; it never creates a purchase,
/// player prompt, or household delivery order.
pub fn emergency_pantry_rule(policy: u8) -> Option<EmergencyPantryRule> {
    match normalize_pantry_safeguard_policy(policy) {
        PANTRY_DAILY_ISSUE_ONLY => None,
        PANTRY_TWO_DAY_SAFEGUARD => Some(EmergencyPantryRule {
            trigger_days: 2.0,
            target_days: 3.0,
        }),
        _ => Some(EmergencyPantryRule {
            trigger_days: 1.0,
            target_days: 2.0,
        }),
    }
}

/// Return the number of household-days a daily market issue should target.
/// Noncritical needs always receive the ordinary one-day issue; pantry policy
/// can deepen only critical food and heat buffers that are below its trigger.
pub fn daily_market_issue_target_days(
    critical_need: bool,
    stock: f64,
    daily_lot: f64,
    pantry_policy: u8,
) -> f64 {
    if !critical_need {
        return 1.0;
    }
    let Some(rule) = emergency_pantry_rule(pantry_policy) else {
        return 1.0;
    };
    if stock + 1e-9 < daily_lot * rule.trigger_days {
        rule.target_days
    } else {
        1.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safeguard_levels_are_bounded_and_monotonic() {
        assert_eq!(emergency_pantry_rule(PANTRY_DAILY_ISSUE_ONLY), None);
        assert_eq!(
            emergency_pantry_rule(PANTRY_ONE_DAY_SAFEGUARD),
            Some(EmergencyPantryRule {
                trigger_days: 1.0,
                target_days: 2.0,
            })
        );
        assert_eq!(
            emergency_pantry_rule(PANTRY_TWO_DAY_SAFEGUARD),
            Some(EmergencyPantryRule {
                trigger_days: 2.0,
                target_days: 3.0,
            })
        );
        assert_eq!(
            normalize_pantry_safeguard_policy(u8::MAX),
            PANTRY_SAFEGUARD_DEFAULT
        );
    }

    #[test]
    fn daily_issue_targets_follow_each_pantry_policy_threshold() {
        assert_eq!(
            daily_market_issue_target_days(true, 0.0, 1.0, PANTRY_DAILY_ISSUE_ONLY),
            1.0,
        );
        assert_eq!(
            daily_market_issue_target_days(true, 0.5, 1.0, PANTRY_ONE_DAY_SAFEGUARD),
            2.0,
        );
        assert_eq!(
            daily_market_issue_target_days(true, 1.0, 1.0, PANTRY_ONE_DAY_SAFEGUARD),
            1.0,
        );
        assert_eq!(
            daily_market_issue_target_days(true, 1.5, 1.0, PANTRY_TWO_DAY_SAFEGUARD),
            3.0,
        );
        assert_eq!(
            daily_market_issue_target_days(true, 2.0, 1.0, PANTRY_TWO_DAY_SAFEGUARD),
            1.0,
        );
    }

    #[test]
    fn noncritical_daily_issues_ignore_deeper_pantry_buffers() {
        assert_eq!(
            daily_market_issue_target_days(false, 0.0, 1.0, PANTRY_TWO_DAY_SAFEGUARD),
            1.0,
        );
    }
}
