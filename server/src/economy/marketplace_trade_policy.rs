use crate::balance_generated::STOREHOUSE_HAUL_PER_WORKER;
use crate::raid_agent_policy::{
    raid_entry_point_for_approach, RAID_APPROACH_SOUTH, RAID_APPROACH_WEST,
};

/// Local market proceeds leave in one bounded handcart so treasury collection
/// remains part of the settlement's physical logistics.
pub fn marketplace_proceeds_cart_load(held_gold: f64) -> f64 {
    if !held_gold.is_finite() {
        return 0.0;
    }
    held_gold.clamp(0.0, STOREHOUSE_HAUL_PER_WORKER)
}

/// Live specialty-export carts use a stable Adriatic-facing south or west map
/// edge. Monthly Trading Post rules settle abstractly and do not use this path.
pub fn adriatic_trade_entry_point(
    entropy: u64,
    market_x: f64,
    market_z: f64,
    playable_half: f64,
) -> Option<(f64, f64)> {
    if !market_x.is_finite()
        || !market_z.is_finite()
        || !playable_half.is_finite()
        || playable_half <= 0.0
    {
        return None;
    }
    let mixed =
        entropy.wrapping_mul(0x9e37_79b9_7f4a_7c15).rotate_left(23) ^ entropy.rotate_right(11);
    let approach = if mixed & 1 == 0 {
        RAID_APPROACH_WEST
    } else {
        RAID_APPROACH_SOUTH
    };
    let offset = if approach == RAID_APPROACH_WEST {
        market_z
    } else {
        market_x
    };
    raid_entry_point_for_approach(approach, offset, playable_half)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn market_proceeds_use_one_bounded_handcart() {
        assert_eq!(marketplace_proceeds_cart_load(-5.0), 0.0);
        assert_eq!(marketplace_proceeds_cart_load(f64::NAN), 0.0);
        assert_eq!(marketplace_proceeds_cart_load(8.5), 8.5);
        assert_eq!(
            marketplace_proceeds_cart_load(200.0),
            STOREHOUSE_HAUL_PER_WORKER
        );
    }

    #[test]
    fn adriatic_routes_use_a_stable_south_or_west_map_edge() {
        for map_half in [
            crate::raid_agent_policy::playable_half_for_map_size(0),
            crate::raid_agent_policy::playable_half_for_map_size(1),
            crate::raid_agent_policy::playable_half_for_map_size(2),
        ] {
            let first = adriatic_trade_entry_point(17, 42.0, -31.0, map_half).expect("trade entry");
            let repeated =
                adriatic_trade_entry_point(17, 42.0, -31.0, map_half).expect("trade entry");
            assert_eq!(first, repeated);
            let edge = map_half - crate::raid_agent_policy::MAP_EDGE_INSET_METERS;
            assert!((first.0 + edge).abs() < 1e-9 || (first.1 - edge).abs() < 1e-9);
        }
        assert!(adriatic_trade_entry_point(1, f64::NAN, 0.0, 410.0).is_none());
    }
}
