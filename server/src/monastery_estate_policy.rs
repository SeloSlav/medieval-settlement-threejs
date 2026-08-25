pub const MONASTERY_ESTATE_HALF_WIDTH: f64 = 34.0;
pub const MONASTERY_ESTATE_REAR_DEPTH: f64 = 45.5;
pub const MONASTERY_ESTATE_FRONT_DEPTH: f64 = 7.5;
pub const MONASTERY_ESTATE_WIDTH: f64 = MONASTERY_ESTATE_HALF_WIDTH * 2.0;
pub const MONASTERY_ESTATE_DEPTH: f64 = MONASTERY_ESTATE_REAR_DEPTH + MONASTERY_ESTATE_FRONT_DEPTH;
pub const MONASTERY_ESTATE_MAP_INSET: f64 = 8.0;
/// Small-map floor for the frontier belt; larger maps scale the belt by radius.
pub const MONASTERY_ESTATE_EDGE_BAND: f64 = 200.0;
pub const MONASTERY_ESTATE_EDGE_BAND_RADIUS_RATIO: f64 = 0.45;
pub const MONASTERY_ESTATE_GOLD_RESERVE: f64 = 6.0;
pub const MONASTERY_ESTATE_EXPORT_LOT: f64 = 6.0;
pub const MONASTERY_INFIRMARY_FOOD_PER_BED_DAY: f64 = 0.6;
pub const MONASTERY_ORCHARD_APPLES: u8 = 0;
pub const MONASTERY_CROFT_VEGETABLES: u8 = 0;
pub const MONASTERY_EXTENSION_INFIRMARY: u8 = 1;
pub const MONASTERY_EXTENSION_SCRIPTORIUM: u8 = 2;
pub const MONASTERY_EXTENSION_GUESTHOUSE: u8 = 4;
pub const MONASTERY_EXTENSION_WORKSHOP: u8 = 8;
pub const MONASTERY_EXTENSION_ALL: u8 = MONASTERY_EXTENSION_INFIRMARY
    | MONASTERY_EXTENSION_SCRIPTORIUM
    | MONASTERY_EXTENSION_GUESTHOUSE
    | MONASTERY_EXTENSION_WORKSHOP;
pub const MONASTERY_ORCHARD_REPLANT_COST: f64 = 12.0;
pub const MONASTERY_ORCHARD_MATURITY_NEW: u8 = 0;
pub const MONASTERY_ORCHARD_MATURITY_YOUNG: u8 = 1;
pub const MONASTERY_ORCHARD_MATURITY_MATURE: u8 = 2;

const YIELD_MULTIPLIERS: [f64; 5] = [1.0, 1.15, 1.30, 1.50, 1.75];

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EstatePoint {
    pub x: f64,
    pub z: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MonasteryEstateYields {
    pub apples: f64,
    pub pears: f64,
    pub cabbage: f64,
    pub carrots: f64,
    pub beetroot: f64,
    pub eggs: f64,
    pub milk: f64,
    pub meat: f64,
    pub honey: f64,
    pub ale: f64,
    pub cider: f64,
    pub mead: f64,
    pub wine: f64,
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

pub fn monastery_estate_edge_band(playable_half: f64) -> f64 {
    MONASTERY_ESTATE_EDGE_BAND.max(playable_half.max(0.0) * MONASTERY_ESTATE_EDGE_BAND_RADIUS_RATIO)
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
    nearest_gap <= monastery_estate_edge_band(playable_half)
}

pub fn normalize_monastery_extensions(extensions: u8) -> u8 {
    extensions & MONASTERY_EXTENSION_ALL
}

pub fn monastery_has_extension(extensions: u8, extension: u8) -> bool {
    normalize_monastery_extensions(extensions) & extension != 0
}

pub fn monastery_extension_count(extensions: u8) -> u8 {
    normalize_monastery_extensions(extensions).count_ones() as u8
}

pub fn monastery_extension_cost(extension: u8) -> Option<f64> {
    match extension {
        MONASTERY_EXTENSION_INFIRMARY => Some(24.0),
        MONASTERY_EXTENSION_SCRIPTORIUM => Some(28.0),
        MONASTERY_EXTENSION_GUESTHOUSE => Some(20.0),
        MONASTERY_EXTENSION_WORKSHOP => Some(30.0),
        _ => None,
    }
}

pub fn monastery_estate_next_investment_cost(extensions: u8, next_extension: u8) -> Option<f64> {
    let extensions = normalize_monastery_extensions(extensions);
    if monastery_has_extension(extensions, next_extension) {
        return None;
    }
    monastery_extension_cost(next_extension)
}

pub fn monastery_estate_yield_multiplier(extensions: u8) -> f64 {
    YIELD_MULTIPLIERS[monastery_extension_count(extensions) as usize]
}

pub fn monastery_infirmary_beds(extensions: u8, service_funding: f64) -> u32 {
    let base = 2;
    if monastery_has_extension(extensions, MONASTERY_EXTENSION_INFIRMARY) {
        base + (8.0 * service_funding.clamp(0.0, 1.0)).round() as u32
    } else {
        base
    }
}

pub fn monastery_infirmary_recovery_multiplier(extensions: u8, service_funding: f64) -> f64 {
    let funded_extension = if monastery_has_extension(extensions, MONASTERY_EXTENSION_INFIRMARY) {
        0.40 * service_funding.clamp(0.0, 1.0)
    } else {
        0.0
    };
    1.15 + funded_extension
}

pub fn monastery_infirmary_mortality_multiplier(extensions: u8, service_funding: f64) -> f64 {
    let funded_extension = if monastery_has_extension(extensions, MONASTERY_EXTENSION_INFIRMARY) {
        0.38 * service_funding.clamp(0.0, 1.0)
    } else {
        0.0
    };
    0.88 - funded_extension
}

/// Physical rye, oat, and maslin seed held separately from ordinary food use.
/// Each crop receives this target, so a founding archive protects 24 units in
/// total and a fully developed estate protects 60. The stock remains real and
/// can be exhausted by emergency reseeding.
pub fn monastery_seed_archive_target_per_crop(extensions: u8, service_funding: f64) -> f64 {
    if monastery_has_extension(extensions, MONASTERY_EXTENSION_SCRIPTORIUM) {
        8.0 + 12.0 * service_funding.clamp(0.0, 1.0)
    } else {
        8.0
    }
}

/// Surviving plans, measurements, contracts, and craft notes reduce the
/// physical materials needed to reconstruct a fire-damaged holding. This is a
/// recovery-only effect: it never accelerates ordinary construction or output.
pub fn monastery_scriptorium_recovery_multiplier(extensions: u8, service_funding: f64) -> f64 {
    if monastery_has_extension(extensions, MONASTERY_EXTENSION_SCRIPTORIUM) {
        0.92 - 0.20 * service_funding.clamp(0.0, 1.0)
    } else {
        0.92
    }
}

pub fn monastery_guesthouse_multiplier(extensions: u8, service_funding: f64) -> f64 {
    if monastery_has_extension(extensions, MONASTERY_EXTENSION_GUESTHOUSE) {
        1.0 + 0.35 * service_funding.clamp(0.0, 1.0)
    } else {
        1.0
    }
}

pub fn monastery_daily_service_cost(extensions: u8) -> f64 {
    let extensions = normalize_monastery_extensions(extensions);
    0.5 + if monastery_has_extension(extensions, MONASTERY_EXTENSION_INFIRMARY) {
        0.7
    } else {
        0.0
    } + if monastery_has_extension(extensions, MONASTERY_EXTENSION_SCRIPTORIUM) {
        0.6
    } else {
        0.0
    } + if monastery_has_extension(extensions, MONASTERY_EXTENSION_GUESTHOUSE) {
        0.9
    } else {
        0.0
    } + if monastery_has_extension(extensions, MONASTERY_EXTENSION_WORKSHOP) {
        0.3
    } else {
        0.0
    }
}

pub fn monastery_orchard_maturity_for_year(planted_year: u32, year: u32) -> u8 {
    if planted_year == 0 {
        return MONASTERY_ORCHARD_MATURITY_MATURE;
    }
    match year.saturating_sub(planted_year) {
        0 => MONASTERY_ORCHARD_MATURITY_NEW,
        1 => MONASTERY_ORCHARD_MATURITY_YOUNG,
        _ => MONASTERY_ORCHARD_MATURITY_MATURE,
    }
}

pub fn monastery_orchard_yield_multiplier(maturity: u8) -> f64 {
    match maturity {
        MONASTERY_ORCHARD_MATURITY_NEW => 0.0,
        MONASTERY_ORCHARD_MATURITY_YOUNG => 0.55,
        _ => 1.0,
    }
}

pub fn monastery_orchard_replanting_allowed(month: u32) -> bool {
    matches!(month, 11 | 12 | 1 | 2)
}

pub fn monastery_croft_choice_allowed(month: u32) -> bool {
    let _ = month;
    false
}

pub fn normalize_monastery_orchard_planting(planting: u8) -> u8 {
    let _ = planting;
    MONASTERY_ORCHARD_APPLES
}

pub fn normalize_monastery_croft_planting(planting: u8) -> u8 {
    let _ = planting;
    MONASTERY_CROFT_VEGETABLES
}

pub fn monastery_estate_yields(
    extensions: u8,
    orchard_planting: u8,
    croft_planting: u8,
    orchard_maturity: u8,
) -> MonasteryEstateYields {
    let multiplier = monastery_estate_yield_multiplier(extensions);
    let orchard_multiplier = monastery_orchard_yield_multiplier(orchard_maturity);
    let workshop = monastery_has_extension(extensions, MONASTERY_EXTENSION_WORKSHOP);
    let _ = orchard_planting;
    let _ = croft_planting;
    MonasteryEstateYields {
        apples: 0.45 * multiplier * orchard_multiplier,
        pears: 0.30 * multiplier * orchard_multiplier,
        // The kitchen croft keeps the three canonical vegetable identities;
        // the retired aggregate `Vegetables` commodity is migration-only.
        cabbage: 0.20 * multiplier,
        carrots: 0.16 * multiplier,
        beetroot: 0.14 * multiplier,
        eggs: 0.42 * multiplier,
        milk: 0.45 * multiplier,
        meat: 0.16 * multiplier,
        honey: 0.22 * multiplier,
        ale: 0.0,
        // The fixed mixed orchard supplies a modest apple-and-pear house cider.
        // It is one canonical output, not a player-selected fruit recipe.
        cider: 0.16 * multiplier * orchard_multiplier * if workshop { 1.25 } else { 1.0 },
        mead: 0.18 * multiplier * if workshop { 1.25 } else { 1.0 },
        // Wine is produced only by the player-drawn vineyard parcels.
        wine: 0.0,
        cheese: 0.18 * multiplier,
    }
}

pub fn monastery_estate_can_reinvest(
    extensions: u8,
    next_extension: u8,
    private_gold: f64,
) -> bool {
    monastery_estate_next_investment_cost(extensions, next_extension)
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
        assert_eq!(monastery_estate_edge_band(half), 200.0);
        assert!(monastery_estate_fits_map(0.0, 350.0, 0.0, half));
        assert!(monastery_estate_is_near_map_edge(0.0, 350.0, 0.0, half));
        assert!(monastery_estate_fits_map(0.0, 220.0, 0.0, half));
        assert!(monastery_estate_is_near_map_edge(0.0, 220.0, 0.0, half));
        assert!(!monastery_estate_is_near_map_edge(0.0, 200.0, 0.0, half));
        assert!(!monastery_estate_is_near_map_edge(0.0, 0.0, 0.0, half));
        assert!(!monastery_estate_fits_map(0.0, 405.0, 0.0, half));

        let large_half = playable_half_for_monastery_map_size(2);
        assert!(monastery_estate_edge_band(large_half) > 500.0);
        assert!(monastery_estate_is_near_map_edge(
            0.0, 630.0, 0.0, large_half
        ));
        assert!(!monastery_estate_is_near_map_edge(
            0.0, 600.0, 0.0, large_half
        ));
    }

    #[test]
    fn reinvestment_preserves_working_gold_and_raises_yield() {
        assert!(!monastery_estate_can_reinvest(
            0,
            MONASTERY_EXTENSION_INFIRMARY,
            29.9
        ));
        assert!(monastery_estate_can_reinvest(
            0,
            MONASTERY_EXTENSION_INFIRMARY,
            30.0
        ));
        assert!(
            monastery_estate_yields(
                MONASTERY_EXTENSION_ALL,
                MONASTERY_ORCHARD_APPLES,
                MONASTERY_CROFT_VEGETABLES,
                MONASTERY_ORCHARD_MATURITY_MATURE,
            )
            .apples
                > monastery_estate_yields(
                    0,
                    MONASTERY_ORCHARD_APPLES,
                    MONASTERY_CROFT_VEGETABLES,
                    MONASTERY_ORCHARD_MATURITY_MATURE,
                )
                .apples
        );
        assert_eq!(
            monastery_estate_next_investment_cost(
                MONASTERY_EXTENSION_ALL,
                MONASTERY_EXTENSION_GUESTHOUSE,
            ),
            None
        );
    }

    #[test]
    fn fixed_estate_yields_mixed_fruit_house_cider_and_monastic_mead() {
        let base = monastery_estate_yields(
            MONASTERY_EXTENSION_INFIRMARY | MONASTERY_EXTENSION_SCRIPTORIUM,
            MONASTERY_ORCHARD_APPLES,
            MONASTERY_CROFT_VEGETABLES,
            MONASTERY_ORCHARD_MATURITY_MATURE,
        );
        assert!(
            base.apples > 0.0
                && base.pears > 0.0
                && base.cabbage > 0.0
                && base.carrots > 0.0
                && base.beetroot > 0.0
        );
        assert!(base.cider > 0.0);
        assert!(base.mead > 0.0);
        assert_eq!(base.ale, 0.0);
        assert_eq!(base.wine, 0.0);

        let workshop = monastery_estate_yields(
            MONASTERY_EXTENSION_WORKSHOP,
            MONASTERY_ORCHARD_APPLES,
            MONASTERY_CROFT_VEGETABLES,
            MONASTERY_ORCHARD_MATURITY_MATURE,
        );
        let workshop_without_extension = monastery_estate_yields(
            0,
            MONASTERY_ORCHARD_APPLES,
            MONASTERY_CROFT_VEGETABLES,
            MONASTERY_ORCHARD_MATURITY_MATURE,
        );
        assert!(workshop.cider > workshop_without_extension.cider);
        assert!(workshop.mead > workshop_without_extension.mead);
    }

    #[test]
    fn replanting_has_a_real_establishment_delay_and_season() {
        assert_eq!(
            monastery_orchard_maturity_for_year(3, 3),
            MONASTERY_ORCHARD_MATURITY_NEW
        );
        assert_eq!(
            monastery_orchard_maturity_for_year(3, 4),
            MONASTERY_ORCHARD_MATURITY_YOUNG
        );
        assert_eq!(
            monastery_orchard_maturity_for_year(3, 5),
            MONASTERY_ORCHARD_MATURITY_MATURE
        );
        assert_eq!(
            monastery_orchard_yield_multiplier(MONASTERY_ORCHARD_MATURITY_NEW),
            0.0
        );
        assert_eq!(
            monastery_orchard_yield_multiplier(MONASTERY_ORCHARD_MATURITY_YOUNG),
            0.55
        );
        assert!(monastery_orchard_replanting_allowed(12));
        assert!(!monastery_orchard_replanting_allowed(6));
        assert!(!monastery_croft_choice_allowed(2));
        assert!(!monastery_croft_choice_allowed(3));
    }

    #[test]
    fn export_lots_protect_internal_reserves() {
        assert_eq!(monastery_estate_exportable(17.0, 18.0), 0.0);
        assert_eq!(monastery_estate_exportable(21.5, 18.0), 3.5);
        assert_eq!(monastery_estate_exportable(30.0, 18.0), 6.0);
    }

    #[test]
    fn infirmary_is_finite_and_improves_with_the_estate() {
        assert_eq!(monastery_infirmary_beds(0, 1.0), 2);
        assert_eq!(
            monastery_infirmary_beds(MONASTERY_EXTENSION_INFIRMARY, 1.0),
            10
        );
        assert_eq!(
            monastery_infirmary_beds(MONASTERY_EXTENSION_INFIRMARY, 0.0),
            2
        );
        assert!(
            monastery_infirmary_recovery_multiplier(MONASTERY_EXTENSION_INFIRMARY, 1.0)
                > monastery_infirmary_recovery_multiplier(0, 1.0)
        );
        assert!(
            monastery_infirmary_mortality_multiplier(MONASTERY_EXTENSION_INFIRMARY, 1.0)
                < monastery_infirmary_mortality_multiplier(0, 1.0)
        );
    }

    #[test]
    fn agricultural_archive_holds_real_emergency_seed() {
        assert_eq!(monastery_seed_archive_target_per_crop(0, 1.0), 8.0);
        assert_eq!(
            monastery_seed_archive_target_per_crop(MONASTERY_EXTENSION_SCRIPTORIUM, 1.0),
            20.0
        );
        assert_eq!(
            monastery_seed_archive_target_per_crop(MONASTERY_EXTENSION_SCRIPTORIUM, 0.0),
            8.0
        );
    }

    #[test]
    fn scriptorium_reduces_only_the_recovery_quote_policy() {
        assert_eq!(monastery_scriptorium_recovery_multiplier(0, 1.0), 0.92);
        assert_eq!(
            monastery_scriptorium_recovery_multiplier(MONASTERY_EXTENSION_SCRIPTORIUM, 1.0),
            0.72
        );
        assert!(
            monastery_scriptorium_recovery_multiplier(MONASTERY_EXTENSION_SCRIPTORIUM, 1.0)
                < monastery_scriptorium_recovery_multiplier(0, 1.0)
        );
    }
}
