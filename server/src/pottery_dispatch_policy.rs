pub const POTTERY_DISPATCH_HOUSEHOLDS_FIRST: u8 = 0;
pub const POTTERY_DISPATCH_PRESERVATION_FIRST: u8 = 1;

pub fn is_valid_pottery_dispatch_policy(policy: u8) -> bool {
    matches!(
        policy,
        POTTERY_DISPATCH_HOUSEHOLDS_FIRST | POTTERY_DISPATCH_PRESERVATION_FIRST
    )
}

pub fn normalize_pottery_dispatch_policy(policy: u8) -> u8 {
    if is_valid_pottery_dispatch_policy(policy) {
        policy
    } else {
        POTTERY_DISPATCH_HOUSEHOLDS_FIRST
    }
}

/// The additive zero default preserves the kiln's established behavior:
/// prosperous homes receive replacement wares before preservation workshops.
pub fn pottery_households_first(policy: u8) -> bool {
    normalize_pottery_dispatch_policy(policy) == POTTERY_DISPATCH_HOUSEHOLDS_FIRST
}

#[cfg(test)]
mod tests {
    use super::{
        is_valid_pottery_dispatch_policy, normalize_pottery_dispatch_policy,
        pottery_households_first, POTTERY_DISPATCH_HOUSEHOLDS_FIRST,
        POTTERY_DISPATCH_PRESERVATION_FIRST,
    };

    #[test]
    fn zero_preserves_household_first_dispatch() {
        assert!(pottery_households_first(POTTERY_DISPATCH_HOUSEHOLDS_FIRST));
        assert!(!pottery_households_first(
            POTTERY_DISPATCH_PRESERVATION_FIRST
        ));
    }

    #[test]
    fn malformed_policy_falls_back_without_stranding_households() {
        assert_eq!(
            normalize_pottery_dispatch_policy(99),
            POTTERY_DISPATCH_HOUSEHOLDS_FIRST
        );
        assert!(pottery_households_first(99));
    }

    #[test]
    fn only_the_two_readable_orders_are_valid() {
        assert!(is_valid_pottery_dispatch_policy(
            POTTERY_DISPATCH_HOUSEHOLDS_FIRST
        ));
        assert!(is_valid_pottery_dispatch_policy(
            POTTERY_DISPATCH_PRESERVATION_FIRST
        ));
        assert!(!is_valid_pottery_dispatch_policy(2));
    }
}
