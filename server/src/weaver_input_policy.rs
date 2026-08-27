//! Persisted player-selected route preference for the two-stage textile chain.
//! The same stable codes select wool versus flax at the spinning/retting house
//! and yarn versus linen at the Weaver.

pub const WEAVER_INPUT_POLICY_AUTO: u8 = 0;
pub const WEAVER_INPUT_POLICY_WOOL_FIRST: u8 = 1;
pub const WEAVER_INPUT_POLICY_FLAX_FIRST: u8 = 2;

pub fn is_valid_weaver_input_policy(policy: u8) -> bool {
    matches!(
        policy,
        WEAVER_INPUT_POLICY_AUTO | WEAVER_INPUT_POLICY_WOOL_FIRST | WEAVER_INPUT_POLICY_FLAX_FIRST
    )
}

pub fn normalize_weaver_input_policy(policy: u8) -> u8 {
    if is_valid_weaver_input_policy(policy) {
        policy
    } else {
        WEAVER_INPUT_POLICY_AUTO
    }
}

/// Lower ranks win when equal-priority active textile workshops compete for a
/// route-specific cart. Automatic workshops remain a neutral middle pool and
/// the opposite ingredient may still be stored for a later recipe change.
pub fn weaver_fibre_delivery_preference_rank(policy: u8, flax: bool) -> u8 {
    match normalize_weaver_input_policy(policy) {
        WEAVER_INPUT_POLICY_AUTO => 1,
        WEAVER_INPUT_POLICY_WOOL_FIRST if !flax => 0,
        WEAVER_INPUT_POLICY_FLAX_FIRST if flax => 0,
        WEAVER_INPUT_POLICY_WOOL_FIRST | WEAVER_INPUT_POLICY_FLAX_FIRST => 2,
        _ => unreachable!("weaver input policy is normalized"),
    }
}

/// Explicit buttons select one recipe. Auto alone may switch to whichever
/// complete route has the deeper working stock.
pub fn weaver_uses_flax(
    policy: u8,
    wool: f64,
    flax: f64,
    water: f64,
    wool_per_cycle: f64,
    flax_per_cycle: f64,
    water_per_cycle: f64,
) -> bool {
    let wool_cycles = wool.max(0.0) / wool_per_cycle.max(1e-6);
    let flax_cycles =
        (flax.max(0.0) / flax_per_cycle.max(1e-6)).min(water.max(0.0) / water_per_cycle.max(1e-6));
    match normalize_weaver_input_policy(policy) {
        WEAVER_INPUT_POLICY_WOOL_FIRST => false,
        WEAVER_INPUT_POLICY_FLAX_FIRST => true,
        WEAVER_INPUT_POLICY_AUTO => {
            (flax > 1e-6 && wool <= 1e-6) || flax_cycles > wool_cycles + 1e-9
        }
        _ => unreachable!("weaver input policy is normalized"),
    }
}

/// Selects the flax-family route at the Weaver, where retting has already
/// happened and the two complete alternatives are yarn and linen.
pub fn weaver_uses_linen(
    policy: u8,
    yarn: f64,
    linen: f64,
    yarn_per_cycle: f64,
    linen_per_cycle: f64,
) -> bool {
    let yarn_cycles = yarn.max(0.0) / yarn_per_cycle.max(1e-6);
    let linen_cycles = linen.max(0.0) / linen_per_cycle.max(1e-6);
    match normalize_weaver_input_policy(policy) {
        WEAVER_INPUT_POLICY_WOOL_FIRST => false,
        WEAVER_INPUT_POLICY_FLAX_FIRST => true,
        WEAVER_INPUT_POLICY_AUTO => {
            (linen > 1e-6 && yarn <= 1e-6) || linen_cycles > yarn_cycles + 1e-9
        }
        _ => unreachable!("weaver input policy is normalized"),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        is_valid_weaver_input_policy, normalize_weaver_input_policy,
        weaver_fibre_delivery_preference_rank, weaver_uses_flax, weaver_uses_linen,
        WEAVER_INPUT_POLICY_AUTO, WEAVER_INPUT_POLICY_FLAX_FIRST, WEAVER_INPUT_POLICY_WOOL_FIRST,
    };

    fn uses_flax(policy: u8, wool: f64, flax: f64, water: f64) -> bool {
        weaver_uses_flax(policy, wool, flax, water, 3.0, 3.0, 1.0)
    }

    #[test]
    fn old_and_malformed_rows_keep_automatic_selection() {
        assert_eq!(normalize_weaver_input_policy(99), WEAVER_INPUT_POLICY_AUTO);
        assert!(!uses_flax(99, 6.0, 3.0, 1.0));
        assert!(uses_flax(99, 3.0, 6.0, 2.0));
    }

    #[test]
    fn each_preference_uses_its_ready_route_first() {
        assert!(!uses_flax(WEAVER_INPUT_POLICY_WOOL_FIRST, 3.0, 6.0, 2.0));
        assert!(uses_flax(WEAVER_INPUT_POLICY_FLAX_FIRST, 6.0, 3.0, 1.0));
    }

    #[test]
    fn explicit_recipes_do_not_fall_back_to_alternate_stock() {
        assert!(!uses_flax(WEAVER_INPUT_POLICY_WOOL_FIRST, 0.0, 3.0, 1.0));
        assert!(uses_flax(WEAVER_INPUT_POLICY_FLAX_FIRST, 3.0, 3.0, 0.0));
        assert!(uses_flax(WEAVER_INPUT_POLICY_FLAX_FIRST, 0.0, 0.0, 0.0));
    }

    #[test]
    fn the_same_persisted_preference_selects_yarn_or_linen_at_the_weaver() {
        assert!(!weaver_uses_linen(
            WEAVER_INPUT_POLICY_WOOL_FIRST,
            2.0,
            4.0,
            2.0,
            2.0,
        ));
        assert!(weaver_uses_linen(
            WEAVER_INPUT_POLICY_FLAX_FIRST,
            4.0,
            2.0,
            2.0,
            2.0,
        ));
        assert!(!weaver_uses_linen(
            WEAVER_INPUT_POLICY_WOOL_FIRST,
            0.0,
            2.0,
            2.0,
            2.0,
        ));
    }

    #[test]
    fn policy_codes_are_small_and_explicit() {
        for policy in [
            WEAVER_INPUT_POLICY_AUTO,
            WEAVER_INPUT_POLICY_WOOL_FIRST,
            WEAVER_INPUT_POLICY_FLAX_FIRST,
        ] {
            assert!(is_valid_weaver_input_policy(policy));
        }
        assert!(!is_valid_weaver_input_policy(3));
    }

    #[test]
    fn fibre_delivery_ranks_match_specialized_looms_without_disabling_fallback() {
        assert_eq!(
            weaver_fibre_delivery_preference_rank(WEAVER_INPUT_POLICY_WOOL_FIRST, false),
            0
        );
        assert_eq!(
            weaver_fibre_delivery_preference_rank(WEAVER_INPUT_POLICY_FLAX_FIRST, true),
            0
        );
        assert_eq!(
            weaver_fibre_delivery_preference_rank(WEAVER_INPUT_POLICY_AUTO, false),
            1
        );
        assert_eq!(
            weaver_fibre_delivery_preference_rank(WEAVER_INPUT_POLICY_WOOL_FIRST, true),
            2
        );
        assert_eq!(weaver_fibre_delivery_preference_rank(99, true), 1);
    }
}
