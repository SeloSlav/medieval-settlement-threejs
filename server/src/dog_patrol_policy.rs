//! Patrol intent shared by the simulation and native regression tests.

pub const WOODLAND_TREE_TARGET_TAG: u64 = 0xd06d_0000_0000_0000;
pub const ROAD_PATROL_TARGET_TAG: u64 = 0xd06e_0000_0000_0000;
const TARGET_TAG_MASK: u64 = 0xffff_0000_0000_0000;
const COORDINATE_MASK: u64 = 0x00ff_ffff;

pub fn is_woodland_tree_target(kind: u8, id: u64) -> bool {
    kind == 6 && id & TARGET_TAG_MASK == WOODLAND_TREE_TARGET_TAG
}

pub fn is_road_patrol_target(kind: u8, id: u64) -> bool {
    kind == 6 && id & TARGET_TAG_MASK == ROAD_PATROL_TARGET_TAG
}

/// A building posting or an expired enemy is never an ongoing patrol leg.
/// Recovery is the only reason to retain a kennel destination.
pub fn patrol_target_matches_duty(
    kind: u8,
    id: u64,
    assigned: bool,
    kennel_id: u64,
    recovering: bool,
    has_roads: bool,
) -> bool {
    if recovering {
        return kind == 0 && id == kennel_id;
    }
    if assigned {
        return is_woodland_tree_target(kind, id);
    }
    if has_roads {
        return is_road_patrol_target(kind, id);
    }
    matches!(kind, 0 | 1)
}

pub fn woodland_tree_target_id(x: f64, z: f64) -> u64 {
    let encode = |coordinate: f64| {
        let scaled = (coordinate * 100.0).round().clamp(-8_388_608.0, 8_388_607.0) as i64;
        scaled as u64 & COORDINATE_MASK
    };
    WOODLAND_TREE_TARGET_TAG | encode(x) | (encode(z) << 24)
}

pub fn woodland_tree_target_position(id: u64) -> (f64, f64) {
    let decode = |packed: u64| {
        let raw = (packed & COORDINATE_MASK) as i32;
        let signed = if raw & 0x0080_0000 != 0 { raw | !(COORDINATE_MASK as i32) } else { raw };
        f64::from(signed) / 100.0
    };
    (decode(id), decode(id >> 24))
}

/// Keep ranging within the work extent even after all its trees are felled.
/// The golden-angle sequence spreads dogs and successive legs around the camp.
pub fn open_ground_patrol_point(x: f64, z: f64, radius: f64, seed: u64) -> (f64, f64) {
    let angle = (seed % 4096) as f64 * 2.399_963_229_728_653;
    let range = radius.max(0.0) * (0.45 + (seed % 101) as f64 / 100.0 * 0.45);
    (x + angle.cos() * range, z + angle.sin() * range)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn duty_changes_and_expired_threats_require_a_new_patrol_leg() {
        assert!(!patrol_target_matches_duty(0, 2, true, 1, false, true));
        assert!(!patrol_target_matches_duty(7, 300, true, 1, false, true));
        assert!(!patrol_target_matches_duty(7, 300, false, 1, false, true));
        assert!(!patrol_target_matches_duty(6, WOODLAND_TREE_TARGET_TAG, false, 1, false, true));
        assert!(!patrol_target_matches_duty(6, ROAD_PATROL_TARGET_TAG, true, 1, false, true));
        assert!(patrol_target_matches_duty(6, WOODLAND_TREE_TARGET_TAG, true, 1, false, true));
        assert!(patrol_target_matches_duty(6, ROAD_PATROL_TARGET_TAG, false, 1, false, true));
    }

    #[test]
    fn wounded_dogs_return_to_their_kennel_then_resume_duty() {
        for assigned in [false, true] {
            assert!(patrol_target_matches_duty(0, 1, assigned, 1, true, true));
            assert!(!patrol_target_matches_duty(0, 1, assigned, 1, false, true));
            assert!(!patrol_target_matches_duty(0, 2, assigned, 1, true, true));
        }
    }

    #[test]
    fn woodland_points_round_trip_and_cover_the_work_extent_without_trees() {
        let mut quadrants = [false; 4];
        for seed in 0..128 {
            let (x, z) = open_ground_patrol_point(-317.24, 842.71, 68.0, seed);
            let id = woodland_tree_target_id(x, z);
            assert!(is_woodland_tree_target(6, id));
            let decoded = woodland_tree_target_position(id);
            assert!((decoded.0 - x).abs() <= 0.0051);
            assert!((decoded.1 - z).abs() <= 0.0051);
            let (dx, dz) = (x + 317.24, z - 842.71);
            assert!((30.0..=62.0).contains(&dx.hypot(dz)));
            quadrants[usize::from(dx >= 0.0) + 2 * usize::from(dz >= 0.0)] = true;
        }
        assert!(quadrants.into_iter().all(|visited| visited));
    }
}
