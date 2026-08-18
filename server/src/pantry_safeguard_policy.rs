//! Settlement-wide Town Hall rules for routine market issues and automatic
//! critical pantry safeguards.

pub const PANTRY_MARKET_DAY_ONLY: u8 = 0;
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

/// Weekly market-day issues remain universal. This optional daily check uses
/// only provisions already staged at a covered market; it never creates a
/// purchase, player prompt, or household delivery order.
pub fn emergency_pantry_rule(policy: u8) -> Option<EmergencyPantryRule> {
    match normalize_pantry_safeguard_policy(policy) {
        PANTRY_MARKET_DAY_ONLY => None,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safeguard_levels_are_bounded_and_monotonic() {
        assert_eq!(emergency_pantry_rule(PANTRY_MARKET_DAY_ONLY), None);
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
}
