//! Pure rules for the settlement's nightly routine.
//!
//! Compact numeric policy codes are persisted in `PlayerResources` so adding
//! presentation or report fields does not require a second authoritative row.

pub const WATCH_STANDARD: u8 = 0;
pub const WATCH_REINFORCED: u8 = 1;
pub const WATCH_STAND_DOWN: u8 = 2;

pub const GATHERING_QUIET: u8 = 0;
pub const GATHERING_COURTYARDS: u8 = 1;
pub const GATHERING_OPEN_LATE: u8 = 2;

pub const NIGHT_WORK_DAY_SHIFT: u8 = 0;
pub const NIGHT_WORK_CONTINUOUS: u8 = 1;
pub const NIGHT_WORK_STAFFED: u8 = 2;

pub const LIGHTING_CONSERVE: u8 = 0;
pub const LIGHTING_MAIN_ROADS: u8 = 1;
pub const LIGHTING_FULL: u8 = 2;

pub const CURFEW_NONE: u8 = 0;
pub const CURFEW_CHILDREN: u8 = 1;
pub const CURFEW_GENERAL: u8 = 2;

pub fn valid_policy_code(value: u8) -> bool {
    value <= 2
}

/// Kiln, clamp, mill, curing, and brewing work can safely continue once their
/// inputs have arrived. Ordinary nighttime policy never re-enables carts.
pub fn is_continuous_night_process(kind: &str) -> bool {
    matches!(
        kind,
        "brewery" | "charcoal_burner" | "potter_kiln" | "smokehouse" | "watermill"
    )
}

/// A fully staffed night shift additionally keeps indoor processing and craft
/// benches active. Outdoor extraction, farming, construction, and logistics
/// remain daylight work.
pub fn is_staffed_night_work(kind: &str) -> bool {
    is_continuous_night_process(kind)
        || matches!(
            kind,
            "carpenter" | "granary" | "monastery" | "smithy" | "weaver"
        )
}

pub fn night_work_allowed(policy: u8, kind: &str) -> bool {
    match policy {
        NIGHT_WORK_CONTINUOUS => is_continuous_night_process(kind),
        NIGHT_WORK_STAFFED => is_staffed_night_work(kind),
        _ => false,
    }
}

pub fn watch_policy_multiplier(policy: u8) -> f64 {
    match policy {
        WATCH_REINFORCED => 1.35,
        WATCH_STAND_DOWN => 0.2,
        _ => 1.0,
    }
}

pub fn warning_policy_multiplier(policy: u8) -> f64 {
    match policy {
        WATCH_REINFORCED => 1.2,
        WATCH_STAND_DOWN => 0.35,
        _ => 1.0,
    }
}

pub fn gathering_share(gathering: u8, curfew: u8) -> f64 {
    let base = match gathering {
        GATHERING_COURTYARDS => 0.45,
        GATHERING_OPEN_LATE => 0.72,
        _ => 0.12,
    };
    let curfew_multiplier = match curfew {
        CURFEW_GENERAL => 0.2,
        CURFEW_CHILDREN => 0.82,
        _ => 1.0,
    };
    base * curfew_multiplier
}

pub fn lighting_firewood_per_household(policy: u8) -> f64 {
    match policy {
        LIGHTING_MAIN_ROADS => 0.025,
        LIGHTING_FULL => 0.06,
        _ => 0.006,
    }
}

pub fn lighting_security_multiplier(policy: u8) -> f64 {
    match policy {
        LIGHTING_MAIN_ROADS => 1.15,
        LIGHTING_FULL => 1.35,
        _ => 0.78,
    }
}

/// Darkness delays a civilian bucket response; lamps and a reinforced watch
/// shorten the delay. Raid arson is handled as immediately visible combat.
pub fn fire_discovery_delay_seconds(watch_policy: u8, lighting_policy: u8) -> f64 {
    let unobserved_seconds = match lighting_policy {
        LIGHTING_MAIN_ROADS => 3.0,
        LIGHTING_FULL => 1.2,
        _ => 7.0,
    };
    (unobserved_seconds / watch_policy_multiplier(watch_policy).max(0.2)).clamp(0.6, 18.0)
}

pub fn curfew_security_multiplier(policy: u8) -> f64 {
    match policy {
        CURFEW_CHILDREN => 1.08,
        CURFEW_GENERAL => 1.25,
        _ => 0.92,
    }
}

pub fn work_fatigue_target(policy: u8, workers: u32, population: u32) -> f64 {
    if policy == NIGHT_WORK_DAY_SHIFT || workers == 0 {
        return 0.0;
    }
    let staffed_share = workers as f64 / population.max(1) as f64;
    let policy_load = if policy == NIGHT_WORK_STAFFED {
        1.0
    } else {
        0.45
    };
    (staffed_share * policy_load * 2.0).clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn continuous_policy_never_opens_outdoor_work_or_logistics() {
        for kind in [
            "farmstead",
            "woodcutters_lodge",
            "construction",
            "marketplace",
            "fishing_camp",
        ] {
            assert!(!night_work_allowed(NIGHT_WORK_CONTINUOUS, kind));
            assert!(!night_work_allowed(NIGHT_WORK_STAFFED, kind));
        }
        assert!(night_work_allowed(NIGHT_WORK_CONTINUOUS, "charcoal_burner"));
        assert!(!night_work_allowed(NIGHT_WORK_CONTINUOUS, "smithy"));
        assert!(night_work_allowed(NIGHT_WORK_STAFFED, "smithy"));
    }

    #[test]
    fn stricter_curfews_reduce_social_life_and_raise_security() {
        assert!(
            gathering_share(GATHERING_OPEN_LATE, CURFEW_NONE)
                > gathering_share(GATHERING_OPEN_LATE, CURFEW_GENERAL)
        );
        assert!(
            curfew_security_multiplier(CURFEW_GENERAL) > curfew_security_multiplier(CURFEW_NONE)
        );
    }

    #[test]
    fn lighting_has_a_real_fuel_and_security_tradeoff() {
        assert!(
            lighting_firewood_per_household(LIGHTING_FULL)
                > lighting_firewood_per_household(LIGHTING_CONSERVE)
        );
        assert!(
            lighting_security_multiplier(LIGHTING_FULL)
                > lighting_security_multiplier(LIGHTING_CONSERVE)
        );
        assert!(
            fire_discovery_delay_seconds(WATCH_REINFORCED, LIGHTING_FULL)
                < fire_discovery_delay_seconds(WATCH_STAND_DOWN, LIGHTING_CONSERVE)
        );
    }
}
