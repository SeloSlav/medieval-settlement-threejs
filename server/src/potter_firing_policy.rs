//! Stable kiln output policy shared by reducers and the production simulation.

pub const POTTER_FIRE_VESSELS: u8 = 0;
pub const POTTER_FIRE_ROOF_TILES: u8 = 1;

pub fn is_valid_potter_firing_policy(policy: u8) -> bool {
    matches!(policy, POTTER_FIRE_VESSELS | POTTER_FIRE_ROOF_TILES)
}

pub fn normalize_potter_firing_policy(policy: u8) -> u8 {
    if is_valid_potter_firing_policy(policy) {
        policy
    } else {
        POTTER_FIRE_VESSELS
    }
}

pub fn potter_fires_roof_tiles(policy: u8) -> bool {
    normalize_potter_firing_policy(policy) == POTTER_FIRE_ROOF_TILES
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_and_invalid_rows_keep_firing_vessels() {
        assert!(!potter_fires_roof_tiles(POTTER_FIRE_VESSELS));
        assert!(!potter_fires_roof_tiles(99));
        assert_eq!(normalize_potter_firing_policy(99), POTTER_FIRE_VESSELS);
    }

    #[test]
    fn roof_tile_mode_is_explicit_and_stable() {
        assert!(is_valid_potter_firing_policy(POTTER_FIRE_ROOF_TILES));
        assert!(potter_fires_roof_tiles(POTTER_FIRE_ROOF_TILES));
    }
}
