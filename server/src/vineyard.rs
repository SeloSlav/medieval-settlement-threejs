use crate::farming::{arable_land_conditions, effective_field_moisture};
use crate::balance_generated::{
    VINEYARD_BALANCED_GRAPE_RESERVE, VINEYARD_WINE_FIRST_GRAPE_RESERVE,
};

pub const VINEYARD_MIN_AREA: f64 = 220.0;
pub const VINEYARD_MAX_AREA: f64 = 1_200.0;
pub const VINEYARD_MIN_EDGE: f64 = 10.0;
pub const VINEYARD_MAX_SLOPE_DEGREES: f64 = 28.0;
pub const VINEYARD_REFERENCE_AREA: f64 = 220.0;
pub const VINEYARD_POLICY_TABLE_GRAPES: u8 = 0;
pub const VINEYARD_POLICY_BALANCED: u8 = 1;
pub const VINEYARD_POLICY_WINE_FIRST: u8 = 2;

pub fn is_valid_vineyard_policy(policy: u8) -> bool {
    matches!(
        policy,
        VINEYARD_POLICY_TABLE_GRAPES | VINEYARD_POLICY_BALANCED | VINEYARD_POLICY_WINE_FIRST
    )
}

pub fn normalize_vineyard_policy(policy: u8) -> u8 {
    if is_valid_vineyard_policy(policy) {
        policy
    } else {
        VINEYARD_POLICY_BALANCED
    }
}

pub fn vineyard_grape_reserve(policy: u8) -> f64 {
    match normalize_vineyard_policy(policy) {
        VINEYARD_POLICY_TABLE_GRAPES => f64::INFINITY,
        VINEYARD_POLICY_WINE_FIRST => VINEYARD_WINE_FIRST_GRAPE_RESERVE,
        _ => VINEYARD_BALANCED_GRAPE_RESERVE,
    }
}

pub fn fermentable_grapes(grapes: f64, policy: u8) -> f64 {
    (grapes.max(0.0) - vineyard_grape_reserve(policy)).max(0.0)
}

/// Mirrors `src/vineyards/vineyardSuitability.ts` so the map preview and
/// authoritative harvest respond to the same soil, drainage, slope, and sun.
pub fn site_suitability(
    groundwater: f64,
    average_slope_degrees: f64,
    south_exposure: f64,
    x: f64,
    z: f64,
) -> f64 {
    let conditions = arable_land_conditions(x, z);
    let moisture = effective_field_moisture(groundwater, x, z);
    let texture_match = 1.0 - (conditions.texture - 0.28).abs() / 0.62;
    let light_soil = 0.45 + texture_match.clamp(0.0, 1.0) * 0.55;
    let depth = 0.62 + conditions.depth * 0.38;
    let soil = (light_soil * depth).clamp(0.0, 1.0);

    let moisture_match = 1.0 - (moisture - 0.37).abs() / 0.46;
    let drainage = 0.38 + moisture_match.clamp(0.0, 1.0) * 0.62;
    let slope_match = 1.0 - (average_slope_degrees.max(0.0) - 8.0).abs() / 20.0;
    let slope = 0.55 + slope_match.clamp(0.0, 1.0) * 0.45;
    let sun = 0.72 + south_exposure.clamp(0.0, 1.0) * 0.28;

    let flatness = 1.0 - (average_slope_degrees.max(0.0) / 7.0).clamp(0.0, 1.0);
    let wetness = ((moisture - 0.48) / 0.38).clamp(0.0, 1.0);
    let frost = 1.0 - flatness * wetness * 0.32;
    ((soil * 0.38 + drainage * 0.30 + slope * 0.18 + sun * 0.14) * frost).clamp(0.0, 1.0)
}

pub fn area_efficiency(area: f64) -> f64 {
    (area.max(0.0) / VINEYARD_REFERENCE_AREA)
        .sqrt()
        .clamp(0.55, 2.6)
}

pub fn production_multiplier(area: f64, suitability: f64, shape_efficiency: f64) -> f64 {
    let site = 0.45 + suitability.clamp(0.0, 1.0) * 1.10;
    area_efficiency(area) * shape_efficiency.clamp(0.72, 1.0) * site
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sunny_drained_slope_beats_wet_flat_ground() {
        let sunny = site_suitability(0.24, 8.0, 1.0, 40.0, -70.0);
        let wet_flat = site_suitability(0.92, 0.0, 0.5, 40.0, -70.0);
        assert!(sunny > wet_flat);
    }

    #[test]
    fn parcel_area_changes_real_output_without_unbounded_scaling() {
        assert!(
            production_multiplier(440.0, 0.75, 0.95) > production_multiplier(110.0, 0.75, 0.95)
        );
        assert_eq!(area_efficiency(1_000_000.0), 2.6);
    }

    #[test]
    fn cellar_policy_protects_table_grapes_before_fermentation() {
        assert_eq!(fermentable_grapes(100.0, VINEYARD_POLICY_TABLE_GRAPES), 0.0);
        assert_eq!(
            fermentable_grapes(VINEYARD_BALANCED_GRAPE_RESERVE + 3.0, VINEYARD_POLICY_BALANCED),
            3.0
        );
        assert!(fermentable_grapes(20.0, VINEYARD_POLICY_WINE_FIRST)
            > fermentable_grapes(20.0, VINEYARD_POLICY_BALANCED));
    }
}
