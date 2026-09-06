use crate::balance_generated::{
    FIRE_DAMAGE_REPAIR_COST_MULTIPLIER, FIRE_DESTROYED_REBUILD_COST_FRACTION,
    FIRE_MINIMUM_REPAIR_COST_FRACTION,
};
use crate::resource_units::whole_cost;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FireRecoveryCost {
    pub timber: f64,
    pub stone: f64,
    pub ironwork: f64,
    pub roof_tiles: f64,
    pub dressed_stone: f64,
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
    base_roof_tiles: f64,
    base_dressed_stone: f64,
    damage: f64,
    destroyed: bool,
    timber_cost_multiplier: f64,
    archive_material_multiplier: f64,
) -> FireRecoveryCost {
    let fraction = fire_recovery_fraction(damage, destroyed);
    let archive = archive_material_multiplier.max(0.0);
    FireRecoveryCost {
        timber: whole_cost(base_timber * fraction * timber_cost_multiplier.max(0.0) * archive),
        stone: whole_cost(base_stone * fraction * archive),
        ironwork: whole_cost(base_ironwork * fraction * archive),
        roof_tiles: whole_cost(base_roof_tiles * fraction * archive),
        dressed_stone: whole_cost(base_dressed_stone * fraction * archive),
        fraction,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn light_damage_has_a_small_but_real_repair_cost() {
        let cost = fire_recovery_cost(40.0, 20.0, 4.0, 12.0, 0.0, 0.05, false, 1.0, 1.0);
        assert_eq!(cost.fraction, FIRE_MINIMUM_REPAIR_COST_FRACTION);
        assert_eq!(cost.timber, 4.0);
        assert_eq!(cost.stone, 2.0);
        assert_eq!(cost.ironwork, 1.0);
        assert_eq!(cost.roof_tiles, 2.0);
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
        let cost = fire_recovery_cost(50.0, 30.0, 6.0, 20.0, 0.0, 1.0, true, 1.0, 1.0);
        assert_eq!(cost.fraction, FIRE_DESTROYED_REBUILD_COST_FRACTION);
        assert_eq!(cost.timber, 35.0);
        assert_eq!(cost.stone, 21.0);
        assert_eq!(cost.ironwork, 5.0);
        assert_eq!(cost.roof_tiles, 14.0);
    }

    #[test]
    fn carpenter_support_reduces_only_reconstruction_timber() {
        let ordinary = fire_recovery_cost(50.0, 30.0, 6.0, 20.0, 0.0, 1.0, true, 1.0, 1.0);
        let supported = fire_recovery_cost(50.0, 30.0, 6.0, 20.0, 0.0, 1.0, true, 0.9, 1.0);
        assert!(supported.timber < ordinary.timber);
        assert_eq!(supported.stone, ordinary.stone);
        assert_eq!(supported.ironwork, ordinary.ironwork);
        assert_eq!(supported.roof_tiles, ordinary.roof_tiles);
    }

    #[test]
    fn scriptorium_records_reduce_every_recovery_material() {
        let ordinary = fire_recovery_cost(50.0, 30.0, 6.0, 20.0, 0.0, 1.0, true, 1.0, 1.0);
        let archived = fire_recovery_cost(50.0, 30.0, 6.0, 20.0, 0.0, 1.0, true, 1.0, 0.8);
        assert!(archived.timber < ordinary.timber);
        assert!(archived.stone < ordinary.stone);
        assert!(archived.ironwork < ordinary.ironwork);
        assert!(archived.roof_tiles < ordinary.roof_tiles);
        assert_eq!(archived.fraction, ordinary.fraction);
    }
}
