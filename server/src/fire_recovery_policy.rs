use crate::balance_generated::{
    FIRE_DAMAGE_REPAIR_COST_MULTIPLIER, FIRE_DESTROYED_REBUILD_COST_FRACTION,
    FIRE_MINIMUM_REPAIR_COST_FRACTION,
};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FireRecoveryCost {
    pub timber: f64,
    pub stone: f64,
    pub ironwork: f64,
    pub fraction: f64,
}

pub fn fire_recovery_fraction(damage: f64, destroyed: bool) -> f64 {
    if destroyed {
        FIRE_DESTROYED_REBUILD_COST_FRACTION
    } else {
        (damage.clamp(0.0, 1.0) * FIRE_DAMAGE_REPAIR_COST_MULTIPLIER)
            .max(FIRE_MINIMUM_REPAIR_COST_FRACTION)
            .min(FIRE_DESTROYED_REBUILD_COST_FRACTION)
    }
}

pub fn fire_recovery_cost(
    base_timber: f64,
    base_stone: f64,
    base_ironwork: f64,
    damage: f64,
    destroyed: bool,
    timber_cost_multiplier: f64,
) -> FireRecoveryCost {
    let fraction = fire_recovery_fraction(damage, destroyed);
    FireRecoveryCost {
        timber: round_to_tenth(base_timber * fraction * timber_cost_multiplier.max(0.0)),
        stone: round_to_tenth(base_stone * fraction),
        ironwork: round_to_tenth(base_ironwork * fraction),
        fraction,
    }
}

fn round_to_tenth(value: f64) -> f64 {
    (value.max(0.0) * 10.0).round() / 10.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn light_damage_has_a_small_but_real_repair_cost() {
        let cost = fire_recovery_cost(40.0, 20.0, 4.0, 0.05, false, 1.0);
        assert_eq!(cost.fraction, FIRE_MINIMUM_REPAIR_COST_FRACTION);
        assert_eq!(cost.timber, 4.0);
        assert_eq!(cost.stone, 2.0);
        assert_eq!(cost.ironwork, 0.4);
    }

    #[test]
    fn damage_scales_until_the_rebuild_cap() {
        let moderate = fire_recovery_fraction(0.5, false);
        let severe = fire_recovery_fraction(0.9, false);
        assert!(moderate > FIRE_MINIMUM_REPAIR_COST_FRACTION);
        assert!(severe > moderate);
        assert!(severe < FIRE_DESTROYED_REBUILD_COST_FRACTION);
    }

    #[test]
    fn a_ruin_reuses_foundations_instead_of_charging_full_price() {
        let cost = fire_recovery_cost(50.0, 30.0, 6.0, 1.0, true, 1.0);
        assert_eq!(cost.fraction, FIRE_DESTROYED_REBUILD_COST_FRACTION);
        assert_eq!(cost.timber, 35.0);
        assert_eq!(cost.stone, 21.0);
        assert_eq!(cost.ironwork, 4.2);
    }

    #[test]
    fn carpenter_support_reduces_only_reconstruction_timber() {
        let ordinary = fire_recovery_cost(50.0, 30.0, 6.0, 1.0, true, 1.0);
        let supported = fire_recovery_cost(50.0, 30.0, 6.0, 1.0, true, 0.9);
        assert!(supported.timber < ordinary.timber);
        assert_eq!(supported.stone, ordinary.stone);
        assert_eq!(supported.ironwork, ordinary.ironwork);
    }
}
