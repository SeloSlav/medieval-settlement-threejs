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
const MAX_SUPPORTED_WORLD_HALF: f64 = 672.0;

/// Samples the embedded valley and alluvial-ground proxy.
pub fn sample_hydrology_score(x: f64, z: f64) -> f64 {
    if !hydrology_grid_contains(x, z) {
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

/// Authoritative map-specific groundwater used by wells, fields, pastures, and clay.
/// Broad seeded aquifers create inland variation while the world hydrology control
/// raises or lowers the regional water table. Keep this in parity with the client
/// `applyWorldGroundwaterVariation` implementation.
pub fn sample_world_hydrology_score(x: f64, z: f64, world_seed: u64, world_hydrology: u8) -> f64 {
    if x.abs() > MAX_SUPPORTED_WORLD_HALF || z.abs() > MAX_SUPPORTED_WORLD_HALF {
        return 0.0;
    }
    let base_score = sample_hydrology_score(x, z);
    let aquifer = sample_aquifer_potential(x, z, world_seed as u32);
    let subsurface_score = 0.06 + aquifer * 0.72;
    let local_potential = (base_score.clamp(0.0, 1.0) * 0.94).max(subsurface_score);
    let wetness = f64::from(world_hydrology.min(100)) / 100.0;
    (local_potential * (0.72 + wetness * 0.56) + (wetness - 0.5) * 0.18).clamp(0.0, 1.0)
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

fn grid_at(ix: usize, iz: usize) -> f64 {
    let index = iz * HYDROLOGY_GRID_RESOLUTION + ix;
    HYDROLOGY_GRID_SCORES[index] as f64
}

fn hydrology_grid_contains(x: f64, z: f64) -> bool {
    x >= HYDROLOGY_GRID_MIN_X
        && x <= HYDROLOGY_GRID_MAX_X
        && z >= HYDROLOGY_GRID_MIN_Z
        && z <= HYDROLOGY_GRID_MAX_Z
}

fn sample_aquifer_potential(x: f64, z: f64, seed: u32) -> f64 {
    let broad = value_noise(x / 145.0 + 11.7, z / 145.0 - 8.3, seed ^ 0x68bc_21eb);
    let local = value_noise(
        (x + z * 0.28) / 58.0 - 17.1,
        (z - x * 0.19) / 58.0 + 23.4,
        seed ^ 0x02e5_be93,
    );
    let seam = 1.0
        - (value_noise(
            (x - z * 0.46) / 92.0 + 4.6,
            (z + x * 0.31) / 92.0 - 12.8,
            seed ^ 0x7f4a_7c15,
        ) * 2.0
            - 1.0)
            .abs();
    smoothstep(0.22, 0.78, broad * 0.5 + local * 0.32 + seam * 0.18)
}

fn value_noise(x: f64, z: f64, seed: u32) -> f64 {
    let x0 = x.floor() as i32;
    let z0 = z.floor() as i32;
    let tx = smooth_curve(x - f64::from(x0));
    let tz = smooth_curve(z - f64::from(z0));
    let a = aquifer_hash(x0, z0, seed);
    let b = aquifer_hash(x0.wrapping_add(1), z0, seed);
    let c = aquifer_hash(x0, z0.wrapping_add(1), seed);
    let d = aquifer_hash(x0.wrapping_add(1), z0.wrapping_add(1), seed);
    let top = a + (b - a) * tx;
    let bottom = c + (d - c) * tx;
    top + (bottom - top) * tz
}

fn aquifer_hash(x: i32, z: i32, seed: u32) -> f64 {
    let mut hash =
        seed ^ (x as u32).wrapping_mul(0x9e37_79b1) ^ (z as u32).wrapping_mul(0x85eb_ca77);
    hash = (hash ^ (hash >> 16)).wrapping_mul(0x7feb_352d);
    hash = (hash ^ (hash >> 15)).wrapping_mul(0x846c_a68b);
    f64::from(hash ^ (hash >> 16)) / f64::from(u32::MAX)
}

fn smooth_curve(value: f64) -> f64 {
    value * value * (3.0 - 2.0 * value)
}

fn smoothstep(edge0: f64, edge1: f64, value: f64) -> f64 {
    smooth_curve(((value - edge0) / (edge1 - edge0)).clamp(0.0, 1.0))
}

#[cfg(test)]
mod tests {
    use super::{
        clay_bank_regional_yield_multiplier, clay_bank_site_yield_multiplier,
        clay_bank_yield_multiplier, clay_bank_yield_multiplier_with_richness,
        sample_hydrology_score, sample_world_hydrology_score, CLAY_BANK_ORDINARY_YIELD_MAX,
        CLAY_BANK_RICH_YIELD_MIN, CLAY_BANK_SITE_YIELD_MAX, CLAY_BANK_SITE_YIELD_MIN,
    };

    #[test]
    fn hydrology_score_is_bounded() {
        let score = sample_hydrology_score(0.0, 0.0);
        assert!((0.0..=1.0).contains(&score));
    }

    #[test]
    fn inland_groundwater_varies_by_site_seed_and_world_wetness() {
        let seed = 0x071a_2e0d;
        let site_a = sample_world_hydrology_score(-360.0, 260.0, seed, 50);
        let site_b = sample_world_hydrology_score(280.0, 220.0, seed, 50);
        assert!((site_a - site_b).abs() > 0.12);

        let dry_world = sample_world_hydrology_score(280.0, 220.0, seed, 0);
        let wet_world = sample_world_hydrology_score(280.0, 220.0, seed, 100);
        assert!(dry_world < site_b && site_b < wet_world);

        let seeded_site = sample_world_hydrology_score(-200.0, -200.0, seed, 50);
        let other_seed = sample_world_hydrology_score(-200.0, -200.0, 0x6b71_2345, 50);
        assert!((other_seed - seeded_site).abs() > 0.04);

        assert!(sample_world_hydrology_score(650.0, 620.0, seed, 50) > 0.0);
        assert_eq!(sample_world_hydrology_score(700.0, 0.0, seed, 50), 0.0);
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
        let leaner = clay_bank_yield_multiplier(sample_hydrology_score(-12.7559, -140.315), 50);
        let richer = clay_bank_yield_multiplier(sample_hydrology_score(4.252, -131.811), 50);
        assert!(richer > leaner);
    }
}
