pub const MONASTERY_ESTATE_HALF_WIDTH: f64 = 34.0;
pub const MONASTERY_ESTATE_REAR_DEPTH: f64 = 45.5;
pub const MONASTERY_ESTATE_FRONT_DEPTH: f64 = 7.5;
pub const MONASTERY_ESTATE_WIDTH: f64 = MONASTERY_ESTATE_HALF_WIDTH * 2.0;
pub const MONASTERY_ESTATE_DEPTH: f64 = MONASTERY_ESTATE_REAR_DEPTH + MONASTERY_ESTATE_FRONT_DEPTH;
pub const MONASTERY_ESTATE_MAP_INSET: f64 = 8.0;
pub const MONASTERY_ESTATE_EDGE_BAND: f64 = 60.0;
pub const MONASTERY_ESTATE_GOLD_RESERVE: f64 = 6.0;
pub const MONASTERY_ESTATE_EXPORT_LOT: f64 = 6.0;
pub const MONASTERY_INFIRMARY_FOOD_PER_BED_DAY: f64 = 0.6;

const INVESTMENT_COSTS: [f64; 3] = [18.0, 42.0, 78.0];
const YIELD_MULTIPLIERS: [f64; 4] = [1.0, 1.25, 1.55, 1.9];
const INFIRMARY_BEDS: [u32; 4] = [4, 6, 8, 10];
const INFIRMARY_RECOVERY_MULTIPLIERS: [f64; 4] = [1.25, 1.35, 1.45, 1.55];
const INFIRMARY_MORTALITY_MULTIPLIERS: [f64; 4] = [0.8, 0.7, 0.6, 0.5];

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EstatePoint {
    pub x: f64,
    pub z: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MonasteryEstateYields {
    pub apples: f64,
    pub vegetables: f64,
    pub eggs: f64,
    pub milk: f64,
    pub meat: f64,
    pub honey: f64,
    pub ale: f64,
    pub cheese: f64,
}

fn world_point(x: f64, z: f64, yaw: f64, local_x: f64, local_z: f64) -> EstatePoint {
    let cos = yaw.cos();
    let sin = yaw.sin();
    EstatePoint {
        x: x + local_x * cos + local_z * sin,
        z: z - local_x * sin + local_z * cos,
    }
}

pub fn monastery_estate_corners(x: f64, z: f64, yaw: f64) -> [EstatePoint; 4] {
    [
        world_point(
            x,
            z,
            yaw,
            -MONASTERY_ESTATE_HALF_WIDTH,
            -MONASTERY_ESTATE_REAR_DEPTH,
        ),
        world_point(
            x,
            z,
            yaw,
            MONASTERY_ESTATE_HALF_WIDTH,
            -MONASTERY_ESTATE_REAR_DEPTH,
        ),
        world_point(
            x,
            z,
            yaw,
            MONASTERY_ESTATE_HALF_WIDTH,
            MONASTERY_ESTATE_FRONT_DEPTH,
        ),
        world_point(
            x,
            z,
            yaw,
            -MONASTERY_ESTATE_HALF_WIDTH,
            MONASTERY_ESTATE_FRONT_DEPTH,
        ),
    ]
}

pub fn playable_half_for_monastery_map_size(map_size: u8) -> f64 {
    match map_size {
        0 => 408.5,
        2 => 817.0 * std::f64::consts::SQRT_2,
        _ => 817.0,
    }
}

pub fn monastery_estate_fits_map(x: f64, z: f64, yaw: f64, playable_half: f64) -> bool {
    let limit = playable_half - MONASTERY_ESTATE_MAP_INSET;
    monastery_estate_corners(x, z, yaw)
        .iter()
        .all(|corner| corner.x.abs() <= limit && corner.z.abs() <= limit)
}

pub fn monastery_estate_is_near_map_edge(x: f64, z: f64, yaw: f64, playable_half: f64) -> bool {
    let corners = monastery_estate_corners(x, z, yaw);
    let min_x = corners
        .iter()
        .map(|point| point.x)
        .fold(f64::INFINITY, f64::min);
    let max_x = corners
        .iter()
        .map(|point| point.x)
        .fold(f64::NEG_INFINITY, f64::max);
    let min_z = corners
        .iter()
        .map(|point| point.z)
        .fold(f64::INFINITY, f64::min);
    let max_z = corners
        .iter()
        .map(|point| point.z)
        .fold(f64::NEG_INFINITY, f64::max);
    let nearest_gap = (min_x + playable_half)
        .min(playable_half - max_x)
        .min(min_z + playable_half)
        .min(playable_half - max_z);
    nearest_gap <= MONASTERY_ESTATE_EDGE_BAND
}

pub fn normalize_monastery_estate_level(level: u8) -> u8 {
    level.min(3)
}

pub fn monastery_estate_next_investment_cost(level: u8) -> Option<f64> {
    INVESTMENT_COSTS
        .get(normalize_monastery_estate_level(level) as usize)
        .copied()
}

pub fn monastery_estate_yield_multiplier(level: u8) -> f64 {
    YIELD_MULTIPLIERS[normalize_monastery_estate_level(level) as usize]
}

pub fn monastery_infirmary_beds(level: u8) -> u32 {
    INFIRMARY_BEDS[normalize_monastery_estate_level(level) as usize]
}

pub fn monastery_infirmary_recovery_multiplier(level: u8) -> f64 {
    INFIRMARY_RECOVERY_MULTIPLIERS[normalize_monastery_estate_level(level) as usize]
}

pub fn monastery_infirmary_mortality_multiplier(level: u8) -> f64 {
    INFIRMARY_MORTALITY_MULTIPLIERS[normalize_monastery_estate_level(level) as usize]
}

pub fn monastery_estate_yields(level: u8) -> MonasteryEstateYields {
    let multiplier = monastery_estate_yield_multiplier(level);
    MonasteryEstateYields {
        apples: 0.75 * multiplier,
        vegetables: 0.5 * multiplier,
        eggs: 0.42 * multiplier,
        milk: 0.45 * multiplier,
        meat: 0.16 * multiplier,
        honey: 0.22 * multiplier,
        ale: 0.32 * multiplier,
        cheese: if level >= 1 { 0.18 * multiplier } else { 0.0 },
    }
}

pub fn monastery_estate_can_reinvest(level: u8, private_gold: f64) -> bool {
    monastery_estate_next_investment_cost(level)
        .is_some_and(|cost| private_gold + 1e-9 >= cost + MONASTERY_ESTATE_GOLD_RESERVE)
}

pub fn monastery_estate_exportable(stock: f64, protected_floor: f64) -> f64 {
    (stock - protected_floor)
        .max(0.0)
        .min(MONASTERY_ESTATE_EXPORT_LOT)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn estate_is_large_asymmetric_and_road_fronted() {
        let corners = monastery_estate_corners(0.0, 0.0, 0.0);
        assert_eq!(MONASTERY_ESTATE_WIDTH, 68.0);
        assert_eq!(MONASTERY_ESTATE_DEPTH, 53.0);
        assert_eq!(corners[0], EstatePoint { x: -34.0, z: -45.5 });
        assert_eq!(corners[2], EstatePoint { x: 34.0, z: 7.5 });
    }

    #[test]
    fn whole_parcel_must_fit_and_reach_the_edge_band() {
        let half = playable_half_for_monastery_map_size(0);
        assert!(monastery_estate_fits_map(0.0, 350.0, 0.0, half));
        assert!(monastery_estate_is_near_map_edge(0.0, 350.0, 0.0, half));
        assert!(!monastery_estate_is_near_map_edge(0.0, 0.0, 0.0, half));
        assert!(!monastery_estate_fits_map(0.0, 405.0, 0.0, half));
    }

    #[test]
    fn reinvestment_preserves_working_gold_and_raises_yield() {
        assert!(!monastery_estate_can_reinvest(0, 23.9));
        assert!(monastery_estate_can_reinvest(0, 24.0));
        assert!(monastery_estate_yields(3).apples > monastery_estate_yields(0).apples);
        assert_eq!(monastery_estate_next_investment_cost(3), None);
    }

    #[test]
    fn export_lots_protect_internal_reserves() {
        assert_eq!(monastery_estate_exportable(17.0, 18.0), 0.0);
        assert_eq!(monastery_estate_exportable(21.5, 18.0), 3.5);
        assert_eq!(monastery_estate_exportable(30.0, 18.0), 6.0);
    }

    #[test]
    fn infirmary_is_finite_and_improves_with_the_estate() {
        assert_eq!(monastery_infirmary_beds(0), 4);
        assert_eq!(monastery_infirmary_beds(3), 10);
        assert!(
            monastery_infirmary_recovery_multiplier(3) > monastery_infirmary_recovery_multiplier(0)
        );
        assert!(
            monastery_infirmary_mortality_multiplier(3)
                < monastery_infirmary_mortality_multiplier(0)
        );
    }
}
