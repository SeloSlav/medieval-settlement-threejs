//! Player-selected input preference for workshops that can weave either wool
//! or water-prepared flax.

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

/// Lower ranks win when equal-priority active looms compete for one raw-fibre
/// cart. Automatic looms remain a neutral middle pool and the opposite
/// specialization remains eligible as a fallback.
pub fn weaver_fibre_delivery_preference_rank(policy: u8, flax: bool) -> u8 {
    match normalize_weaver_input_policy(policy) {
        WEAVER_INPUT_POLICY_AUTO => 1,
        WEAVER_INPUT_POLICY_WOOL_FIRST if !flax => 0,
        WEAVER_INPUT_POLICY_FLAX_FIRST if flax => 0,
        WEAVER_INPUT_POLICY_WOOL_FIRST | WEAVER_INPUT_POLICY_FLAX_FIRST => 2,
        _ => unreachable!("weaver input policy is normalized"),
    }
}

/// A preference never stalls a stocked loom: the selected fibre is used when
/// it can complete a cycle, then the alternate route may keep the crew
/// productive. With neither route ready, the preferred route remains visible
/// as the current blocker.
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
    let wool_ready = wool_cycles + 1e-9 >= 1.0;
    let flax_ready = flax_cycles + 1e-9 >= 1.0;

    match normalize_weaver_input_policy(policy) {
        WEAVER_INPUT_POLICY_WOOL_FIRST => !wool_ready && flax_ready,
        WEAVER_INPUT_POLICY_FLAX_FIRST => flax_ready || !wool_ready,
        WEAVER_INPUT_POLICY_AUTO => {
            (flax > 1e-6 && wool <= 1e-6) || flax_cycles > wool_cycles + 1e-9
        }
        _ => unreachable!("weaver input policy is normalized"),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        is_valid_weaver_input_policy, normalize_weaver_input_policy,
        weaver_fibre_delivery_preference_rank, weaver_uses_flax, WEAVER_INPUT_POLICY_AUTO,
        WEAVER_INPUT_POLICY_FLAX_FIRST, WEAVER_INPUT_POLICY_WOOL_FIRST,
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
    fn preferences_fall_back_instead_of_idling_a_stocked_loom() {
        assert!(uses_flax(WEAVER_INPUT_POLICY_WOOL_FIRST, 0.0, 3.0, 1.0));
        assert!(!uses_flax(WEAVER_INPUT_POLICY_FLAX_FIRST, 3.0, 3.0, 0.0));
        assert!(uses_flax(WEAVER_INPUT_POLICY_FLAX_FIRST, 0.0, 0.0, 0.0));
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
