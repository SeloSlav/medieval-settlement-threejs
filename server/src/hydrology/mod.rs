use crate::hydrology_grid_generated::{
    HYDROLOGY_GRID_MAX_X, HYDROLOGY_GRID_MAX_Z, HYDROLOGY_GRID_MIN_X, HYDROLOGY_GRID_MIN_Z,
    HYDROLOGY_GRID_RESOLUTION, HYDROLOGY_GRID_SCORES,
};

pub const CLAY_BANK_SCORE_FLOOR: f64 = 0.15;
pub const CLAY_BANK_SCORE_CEILING: f64 = 0.53;
pub const CLAY_BANK_SITE_YIELD_MIN: f64 = 0.82;
pub const CLAY_BANK_SITE_YIELD_MAX: f64 = 1.08;
pub const CLAY_BANK_REGIONAL_YIELD_MIN: f64 = 0.95;
pub const CLAY_BANK_REGIONAL_YIELD_MAX: f64 = 1.05;
pub const CLAY_BANK_TOTAL_YIELD_MIN: f64 = 0.78;
pub const CLAY_BANK_ORDINARY_YIELD_MAX: f64 = 1.14;
pub const CLAY_BANK_RICH_YIELD_MIN: f64 = 1.28;
pub const CLAY_BANK_TOTAL_YIELD_MAX: f64 = 1.42;
pub fn sample_hydrology_score(x: f64, z: f64) -> f64 {
    if x < HYDROLOGY_GRID_MIN_X
        || x > HYDROLOGY_GRID_MAX_X
        || z < HYDROLOGY_GRID_MIN_Z
        || z > HYDROLOGY_GRID_MAX_Z
    {
        return 0.0;
    }

    let span_x = HYDROLOGY_GRID_MAX_X - HYDROLOGY_GRID_MIN_X;
    let span_z = HYDROLOGY_GRID_MAX_Z - HYDROLOGY_GRID_MIN_Z;
    let gx = ((x - HYDROLOGY_GRID_MIN_X) / span_x) * (HYDROLOGY_GRID_RESOLUTION as f64 - 1.0);
    let gz = ((z - HYDROLOGY_GRID_MIN_Z) / span_z) * (HYDROLOGY_GRID_RESOLUTION as f64 - 1.0);

    let ix0 = gx
        .floor()
        .clamp(0.0, (HYDROLOGY_GRID_RESOLUTION - 2) as f64) as usize;
    let iz0 = gz
        .floor()
        .clamp(0.0, (HYDROLOGY_GRID_RESOLUTION - 2) as f64) as usize;
    let ix1 = ix0 + 1;
    let iz1 = iz0 + 1;
    let tx = gx - ix0 as f64;
    let tz = gz - iz0 as f64;

    let s00 = grid_at(ix0, iz0);
    let s10 = grid_at(ix1, iz0);
    let s01 = grid_at(ix0, iz1);
    let s11 = grid_at(ix1, iz1);

    let top = s00 * (1.0 - tx) + s10 * tx;
    let bottom = s01 * (1.0 - tx) + s11 * tx;
    (top * (1.0 - tz) + bottom * tz).clamp(0.0, 1.0)
}

pub fn well_capacity_from_hydrology(base_capacity: f64, hydrology_score: f64) -> f64 {
    base_capacity * (0.32 + 0.68 * hydrology_score.clamp(0.0, 1.0))
}

pub fn clay_bank_site_yield_multiplier(hydrology_score: f64) -> f64 {
    let score = if hydrology_score.is_finite() {
        hydrology_score
    } else {
        CLAY_BANK_SCORE_FLOOR
    };
    let normalized = ((score - CLAY_BANK_SCORE_FLOOR)
        / (CLAY_BANK_SCORE_CEILING - CLAY_BANK_SCORE_FLOOR))
        .clamp(0.0, 1.0);
    CLAY_BANK_SITE_YIELD_MIN + normalized * (CLAY_BANK_SITE_YIELD_MAX - CLAY_BANK_SITE_YIELD_MIN)
}

pub fn clay_bank_regional_yield_multiplier(resource_abundance: u8) -> f64 {
    let normalized = f64::from(resource_abundance.min(100)) / 100.0;
    CLAY_BANK_REGIONAL_YIELD_MIN
        + normalized * (CLAY_BANK_REGIONAL_YIELD_MAX - CLAY_BANK_REGIONAL_YIELD_MIN)
}

pub fn clay_bank_yield_multiplier(hydrology_score: f64, resource_abundance: u8) -> f64 {
    (clay_bank_site_yield_multiplier(hydrology_score)
        * clay_bank_regional_yield_multiplier(resource_abundance))
    .clamp(CLAY_BANK_TOTAL_YIELD_MIN, CLAY_BANK_ORDINARY_YIELD_MAX)
}

pub fn clay_bank_yield_multiplier_with_richness(
    hydrology_score: f64,
    resource_abundance: u8,
    rich_deposit_strength: f64,
) -> f64 {
    let ordinary_yield = clay_bank_yield_multiplier(hydrology_score, resource_abundance);
    let richness = if rich_deposit_strength.is_finite() {
        rich_deposit_strength.clamp(0.0, 1.0)
    } else {
        0.0
    };
    if richness <= 0.0 {
        return ordinary_yield;
    }
    let rich_yield =
        (ordinary_yield * 1.3).clamp(CLAY_BANK_RICH_YIELD_MIN, CLAY_BANK_TOTAL_YIELD_MAX);
    ordinary_yield + (rich_yield - ordinary_yield) * richness
}

pub fn clay_bank_yield_multiplier_at(x: f64, z: f64, resource_abundance: u8) -> f64 {
    clay_bank_yield_multiplier(sample_hydrology_score(x, z), resource_abundance)
}

fn grid_at(ix: usize, iz: usize) -> f64 {
    let index = iz * HYDROLOGY_GRID_RESOLUTION + ix;
    HYDROLOGY_GRID_SCORES[index] as f64
}

#[cfg(test)]
mod tests {
    use super::{
        clay_bank_regional_yield_multiplier, clay_bank_site_yield_multiplier,
        clay_bank_yield_multiplier, clay_bank_yield_multiplier_at,
        clay_bank_yield_multiplier_with_richness, sample_hydrology_score,
        CLAY_BANK_ORDINARY_YIELD_MAX, CLAY_BANK_RICH_YIELD_MIN, CLAY_BANK_SITE_YIELD_MAX,
        CLAY_BANK_SITE_YIELD_MIN,
    };

    #[test]
    fn hydrology_score_is_bounded() {
        let score = sample_hydrology_score(0.0, 0.0);
        assert!((0.0..=1.0).contains(&score));
    }

    #[test]
    fn broader_alluvial_pockets_raise_clay_yield_without_hard_stops() {
        assert_eq!(
            clay_bank_site_yield_multiplier(0.0),
            CLAY_BANK_SITE_YIELD_MIN
        );
        assert_eq!(
            clay_bank_site_yield_multiplier(1.0),
            CLAY_BANK_SITE_YIELD_MAX
        );
        assert!(clay_bank_site_yield_multiplier(0.4) > clay_bank_site_yield_multiplier(0.2));
        assert_eq!(
            clay_bank_site_yield_multiplier(f64::NAN),
            CLAY_BANK_SITE_YIELD_MIN
        );
    }

    #[test]
    fn regional_abundance_scales_the_same_local_bank_conservatively() {
        assert_eq!(clay_bank_regional_yield_multiplier(50), 1.0);
        assert_eq!(clay_bank_regional_yield_multiplier(0), 0.95);
        assert_eq!(clay_bank_regional_yield_multiplier(100), 1.05);
        assert_eq!(clay_bank_regional_yield_multiplier(255), 1.05);
        assert!(clay_bank_yield_multiplier(0.3, 100) > clay_bank_yield_multiplier(0.3, 0));
        assert!(clay_bank_yield_multiplier(1.0, 100) <= CLAY_BANK_ORDINARY_YIELD_MAX);
    }

    #[test]
    fn explicit_rich_deposit_is_distinct_from_ordinary_shoreline() {
        let ordinary = clay_bank_yield_multiplier_with_richness(0.3, 50, 0.0);
        let rich = clay_bank_yield_multiplier_with_richness(0.3, 50, 1.0);
        assert!(ordinary <= CLAY_BANK_ORDINARY_YIELD_MAX);
        assert!(rich >= CLAY_BANK_RICH_YIELD_MIN);
        assert!(rich > ordinary);
    }

    #[test]
    fn coordinate_sampler_drives_authoritative_clay_bank_quality() {
        let leaner = clay_bank_yield_multiplier_at(-12.7559, -140.315, 50);
        let richer = clay_bank_yield_multiplier_at(4.252, -131.811, 50);
        assert!(richer > leaner);
    }
}
