use crate::balance_generated::{
    farm_crop_def, FarmCropDef, FarmCropProduce, FARM_BASE_GRAIN_PER_SQUARE_METER,
    FARM_CROP_BARLEY_ID, FARM_CROP_FALLOW_ID, FARM_CROP_RYE, FARM_EARLY_HARVEST_MINIMUM_GROWTH,
    FARM_EARLY_HARVEST_MONTH, FARM_EARLY_HARVEST_RIPENESS_FACTOR,
    FARM_HARVEST_WORK_PER_SQUARE_METER, FARM_LARGE_FIELD_EFFICIENCY_EXPONENT,
    FARM_LARGE_FIELD_EFFICIENCY_FLOOR, FARM_MANURE_FERTILITY_BONUS, FARM_MANURE_PER_SQUARE_METER,
    FARM_OPTIMAL_FIELD_AREA, FARM_PLOUGH_WORK_PER_SQUARE_METER, FARM_SLOPE_PENALTY_PER_DEGREE,
    FARM_SOW_WORK_PER_SQUARE_METER,
};
#[cfg(test)]
use crate::balance_generated::{
    FARM_CROP_FLAX_ID, FARM_CROP_OATS_ID, FARM_CROP_RYE_ID, FARM_CROP_WHEAT_ID,
};
use crate::burgage::{Point2, ZoneCorners};

#[cfg(test)]
pub const CROP_RYE: u8 = FARM_CROP_RYE_ID;
#[cfg(test)]
pub const CROP_OATS: u8 = FARM_CROP_OATS_ID;
pub const CROP_FALLOW: u8 = FARM_CROP_FALLOW_ID;
pub const CROP_BARLEY: u8 = FARM_CROP_BARLEY_ID;
#[cfg(test)]
pub const CROP_FLAX: u8 = FARM_CROP_FLAX_ID;
#[cfg(test)]
pub const CROP_WHEAT: u8 = FARM_CROP_WHEAT_ID;

pub const STAGE_PLOUGHING: u8 = 0;
pub const STAGE_SOWING: u8 = 1;
pub const STAGE_GROWING: u8 = 2;
pub const STAGE_HARVESTING: u8 = 3;
/// Save-compatible sentinel: the field repeats `next_crop` after the current
/// cycle until the player explicitly schedules a third crop.
pub const NO_FOLLOWING_CROP: u8 = u8::MAX;

fn crop_definition(crop: u8) -> &'static FarmCropDef {
    farm_crop_def(crop).unwrap_or(&FARM_CROP_RYE)
}

pub fn valid_crop(crop: u8) -> bool {
    farm_crop_def(crop).is_some()
}

/// Advances the authoritative current/next/following crop queue.
///
/// Explicit three-year plans rotate A → B → C → A. Legacy fields have the
/// sentinel in their third slot and preserve the former behavior by repeating
/// B indefinitely after A finishes.
pub fn advance_crop_rotation(crop: u8, next_crop: u8, following_crop: u8) -> (u8, u8, u8) {
    if valid_crop(following_crop) {
        (next_crop, following_crop, crop)
    } else {
        (next_crop, next_crop, NO_FOLLOWING_CROP)
    }
}

pub fn crop_produce(crop: u8) -> FarmCropProduce {
    crop_definition(crop).produce
}

pub fn corners_from_values(values: [f64; 8]) -> ZoneCorners {
    ZoneCorners {
        a: Point2 {
            x: values[0],
            z: values[1],
        },
        b: Point2 {
            x: values[2],
            z: values[3],
        },
        c: Point2 {
            x: values[4],
            z: values[5],
        },
        d: Point2 {
            x: values[6],
            z: values[7],
        },
    }
}

pub fn corners_array(corners: &ZoneCorners) -> [Point2; 4] {
    [corners.a, corners.b, corners.c, corners.d]
}

pub fn polygon_area(corners: &ZoneCorners) -> f64 {
    let points = corners_array(corners);
    let mut twice_area = 0.0;
    for index in 0..points.len() {
        let a = points[index];
        let b = points[(index + 1) % points.len()];
        twice_area += a.x * b.z - b.x * a.z;
    }
    twice_area.abs() * 0.5
}

pub fn centroid(corners: &ZoneCorners) -> Point2 {
    let points = corners_array(corners);
    let mut twice_area = 0.0;
    let mut weighted_x = 0.0;
    let mut weighted_z = 0.0;
    for index in 0..points.len() {
        let point = points[index];
        let next = points[(index + 1) % points.len()];
        let cross = point.x * next.z - next.x * point.z;
        twice_area += cross;
        weighted_x += (point.x + next.x) * cross;
        weighted_z += (point.z + next.z) * cross;
    }
    if twice_area.abs() <= 1e-9 {
        return Point2 {
            x: points.iter().map(|point| point.x).sum::<f64>() / points.len() as f64,
            z: points.iter().map(|point| point.z).sum::<f64>() / points.len() as f64,
        };
    }
    Point2 {
        x: weighted_x / (3.0 * twice_area),
        z: weighted_z / (3.0 * twice_area),
    }
}

pub fn edge_lengths(corners: &ZoneCorners) -> [f64; 4] {
    let points = corners_array(corners);
    std::array::from_fn(|index| distance(points[index], points[(index + 1) % 4]))
}

pub fn is_valid_convex_quadrilateral(corners: &ZoneCorners) -> bool {
    let points = corners_array(corners);
    if points
        .iter()
        .any(|point| !point.x.is_finite() || !point.z.is_finite())
    {
        return false;
    }
    if edge_lengths(corners)
        .iter()
        .any(|length| !length.is_finite() || *length <= 1e-6)
    {
        return false;
    }
    let turns = std::array::from_fn::<_, 4, _>(|index| {
        let a = points[index];
        let b = points[(index + 1) % 4];
        let c = points[(index + 2) % 4];
        cross(subtract(b, a), subtract(c, b))
    });
    let convex = turns.iter().all(|turn| *turn > 1e-8) || turns.iter().all(|turn| *turn < -1e-8);
    convex && polygon_area(corners).is_finite() && polygon_area(corners) > 1e-6
}

pub fn shape_efficiency(corners: &ZoneCorners) -> f64 {
    let lengths = edge_lengths(corners);
    let width = (lengths[0] + lengths[2]) * 0.5;
    let depth = (lengths[1] + lengths[3]) * 0.5;
    let aspect = width.max(depth) / width.min(depth).max(1e-6);
    let aspect_efficiency = (1.0 - (aspect - 1.0).max(0.0) * 0.035).clamp(0.72, 1.0);
    let compactness = (polygon_area(corners) / (width * depth).max(1e-6)).clamp(0.0, 1.0);
    let skew_efficiency = 0.85 + compactness * 0.15;
    (aspect_efficiency * skew_efficiency).clamp(0.72, 1.0)
}

#[cfg(test)]
fn bilinear_point(corners: &ZoneCorners, u: f64, v: f64) -> Point2 {
    let top_x = corners.a.x + (corners.b.x - corners.a.x) * u;
    let top_z = corners.a.z + (corners.b.z - corners.a.z) * u;
    let bottom_x = corners.d.x + (corners.c.x - corners.d.x) * u;
    let bottom_z = corners.d.z + (corners.c.z - corners.d.z) * u;
    Point2 {
        x: top_x + (bottom_x - top_x) * v,
        z: top_z + (bottom_z - top_z) * v,
    }
}

pub fn field_size_efficiency(area: f64) -> f64 {
    if area <= FARM_OPTIMAL_FIELD_AREA {
        return 1.0;
    }
    (FARM_OPTIMAL_FIELD_AREA / area.max(1.0))
        .powf(FARM_LARGE_FIELD_EFFICIENCY_EXPONENT)
        .clamp(FARM_LARGE_FIELD_EFFICIENCY_FLOOR, 1.0)
}

#[derive(Clone, Copy, Debug)]
pub struct ArableLandConditions {
    /// 0 = light/gravelly soil, 1 = heavy/clay-rich soil.
    pub texture: f64,
    /// Persistent depth of workable, nutrient-holding topsoil.
    pub depth: f64,
}

/// Broad deterministic soil pockets mirrored by the client placement overlay.
pub fn arable_land_conditions(x: f64, z: f64) -> ArableLandConditions {
    let texture = (0.5
        + (x * 0.0107 + z * 0.0061 + 0.8).sin() * 0.22
        + (x * -0.0173 + z * 0.0149 - 1.7).sin() * 0.18
        + (x * 0.0049 - z * 0.0127 + 2.4).cos() * 0.10)
        .clamp(0.0, 1.0);
    let depth = (0.56
        + (x * 0.0063 - z * 0.0091 - 0.4).sin() * 0.21
        + (x * 0.0151 + z * 0.0057 + 1.1).cos() * 0.16
        + (x * 0.027 - z * 0.018).sin() * 0.08)
        .clamp(0.0, 1.0);
    ArableLandConditions { texture, depth }
}

pub fn effective_field_moisture(groundwater: f64, x: f64, z: f64) -> f64 {
    let conditions = arable_land_conditions(x, z);
    let soil_retention = 0.14 + conditions.texture * 0.16 + conditions.depth * 0.10;
    (groundwater.clamp(0.0, 1.0) * 0.68 + soil_retention).clamp(0.0, 1.0)
}

pub fn moisture_suitability(crop: u8, moisture: f64) -> f64 {
    let definition = crop_definition(crop);
    if definition.produce == FarmCropProduce::None {
        return 1.0;
    }
    let (ideal, tolerance) = (definition.moisture_ideal, definition.moisture_tolerance);
    let crop_match = 1.0 - (moisture.clamp(0.0, 1.0) - ideal).abs() / tolerance.max(1e-6);
    0.52 + crop_match.clamp(0.0, 1.0) * 0.48
}

pub fn crop_soil_suitability(crop: u8, x: f64, z: f64) -> f64 {
    let definition = crop_definition(crop);
    if definition.produce == FarmCropProduce::None {
        return 1.0;
    }
    let conditions = arable_land_conditions(x, z);
    let texture_match = 1.0
        - (conditions.texture - definition.soil_texture_ideal).abs()
            / definition.soil_texture_tolerance.max(1e-6);
    let texture_suitability = 0.45 + texture_match.clamp(0.0, 1.0) * 0.55;
    let depth_suitability = 1.0 - definition.soil_depth_demand * (1.0 - conditions.depth) * 0.42;
    (texture_suitability * depth_suitability).clamp(0.0, 1.0)
}

pub fn crop_slope_suitability(crop: u8, average_slope_degrees: f64) -> f64 {
    (1.0 - average_slope_degrees.max(0.0)
        * FARM_SLOPE_PENALTY_PER_DEGREE
        * crop_definition(crop).slope_penalty_multiplier)
        .clamp(0.35, 1.0)
}

pub fn crop_environmental_suitability(crop: u8, groundwater: f64, x: f64, z: f64) -> f64 {
    if crop_definition(crop).produce == FarmCropProduce::None {
        return 1.0;
    }
    let moisture = moisture_suitability(crop, effective_field_moisture(groundwater, x, z));
    let soil = crop_soil_suitability(crop, x, z);
    moisture * 0.42 + soil * 0.58
}

/// Predicts the soil quality of newly cleared arable land from the same
/// groundwater, soil, and slope samples used during authoritative placement.
pub fn initial_field_fertility(
    groundwater: f64,
    average_slope_degrees: f64,
    x: f64,
    z: f64,
) -> f64 {
    let conditions = arable_land_conditions(x, z);
    let loam_quality = (1.0 - (conditions.texture - 0.5).abs() * 1.6).clamp(0.0, 1.0);
    (0.50 + groundwater.clamp(0.0, 1.0) * 0.13 + conditions.depth * 0.20 + loam_quality * 0.12
        - average_slope_degrees.max(0.0) * 0.006)
        .clamp(0.35, 0.95)
}

pub fn yield_suitability(
    crop: u8,
    moisture: f64,
    fertility: f64,
    average_slope_degrees: f64,
    shape: f64,
    x: f64,
    z: f64,
) -> f64 {
    crop_environmental_suitability(crop, moisture, x, z)
        * fertility.clamp(0.2, 1.0)
        * crop_slope_suitability(crop, average_slope_degrees)
        * shape.clamp(0.72, 1.0)
}

pub fn expected_grain_yield(
    area: f64,
    crop: u8,
    moisture: f64,
    fertility: f64,
    average_slope_degrees: f64,
    shape: f64,
    x: f64,
    z: f64,
) -> f64 {
    let definition = crop_definition(crop);
    if definition.produce == FarmCropProduce::None {
        return 0.0;
    }
    area.max(0.0)
        * FARM_BASE_GRAIN_PER_SQUARE_METER
        * definition.yield_multiplier
        * yield_suitability(
            crop,
            moisture,
            fertility,
            average_slope_degrees,
            shape,
            x,
            z,
        )
        * field_size_efficiency(area)
}

pub fn work_required(stage: u8, area: f64, shape: f64) -> f64 {
    let per_square_meter = match stage {
        STAGE_PLOUGHING => FARM_PLOUGH_WORK_PER_SQUARE_METER,
        STAGE_SOWING => FARM_SOW_WORK_PER_SQUARE_METER,
        STAGE_HARVESTING => FARM_HARVEST_WORK_PER_SQUARE_METER,
        _ => 0.0,
    };
    area.max(1.0) * per_square_meter / shape.clamp(0.72, 1.0)
}

pub fn crop_seed_grain_per_square_meter(crop: u8) -> f64 {
    crop_definition(crop).seed_grain_per_square_meter
}

pub fn seed_grain_required(area: f64, crop: u8) -> f64 {
    area.max(0.0) * crop_seed_grain_per_square_meter(crop)
}

/// Crop whose seed must be protected for the field's next unfinished sowing.
pub fn field_seed_crop(crop: u8, next_crop: u8, stage: u8) -> u8 {
    if matches!(stage, STAGE_PLOUGHING | STAGE_SOWING) {
        crop
    } else {
        next_crop
    }
}

/// Grain still protected at a farmstead for this field's next sowing.
///
/// Ploughing and partially sown fields reserve the current crop. Growing and
/// harvesting fields reserve the selected next crop. Pausing a field releases
/// its seed allocation back to the settlement economy.
pub fn field_seed_grain_remaining(
    area: f64,
    crop: u8,
    next_crop: u8,
    stage: u8,
    stage_progress: f64,
    priority: u8,
) -> f64 {
    if priority == 0 {
        return 0.0;
    }
    let planned_crop = field_seed_crop(crop, next_crop, stage);
    let unseeded_fraction = if stage == STAGE_SOWING {
        1.0 - stage_progress.clamp(0.0, 1.0)
    } else {
        1.0
    };
    seed_grain_required(area, planned_crop) * unseeded_fraction
}

/// Grain a farmstead may release without consuming seed allocated to fields.
pub fn farmstead_exportable_grain(stock: f64, seed_grain_required: f64) -> f64 {
    (stock.max(0.0) - seed_grain_required.max(0.0)).max(0.0)
}

/// Each crop uses its balance-driven historical sowing and growth calendar.
pub fn field_work_allowed(stage: u8, crop: u8, month: u32) -> bool {
    let definition = crop_definition(crop);
    match stage {
        STAGE_HARVESTING => {
            month == u32::from(definition.growth_end_month)
                || month == u32::from(definition.growth_end_month % 12 + 1)
        }
        STAGE_PLOUGHING | STAGE_SOWING => {
            month >= u32::from(definition.work_start_month)
                && month <= u32::from(definition.work_end_month)
        }
        _ => false,
    }
}

pub fn early_harvest_yield_multiplier(growth_progress: f64) -> f64 {
    growth_progress.clamp(0.0, 1.0) * FARM_EARLY_HARVEST_RIPENESS_FACTOR
}

pub fn early_harvest_available(stage: u8, crop: u8, month: u32, growth_progress: f64) -> bool {
    stage == STAGE_GROWING
        && crop_produce(crop) != FarmCropProduce::None
        && month == FARM_EARLY_HARVEST_MONTH
        && growth_progress >= FARM_EARLY_HARVEST_MINIMUM_GROWTH
}

pub fn crop_growth_allowed(crop: u8, month: u32) -> bool {
    let definition = crop_definition(crop);
    month >= u32::from(definition.growth_start_month)
        && month <= u32::from(definition.growth_end_month)
}

pub fn sowing_window_missed(stage: u8, crop: u8, month: u32) -> bool {
    let definition = crop_definition(crop);
    stage == STAGE_SOWING && month == u32::from(definition.work_end_month % 12 + 1)
}

pub fn fertility_after_harvest(crop: u8, fertility: f64) -> f64 {
    (fertility + crop_definition(crop).fertility_delta).clamp(0.2, 1.0)
}

pub fn field_manure_required(area: f64) -> f64 {
    area.max(0.0) * FARM_MANURE_PER_SQUARE_METER.max(0.0)
}

pub fn field_manure_fertility_bonus(area: f64, manure_applied: f64) -> f64 {
    let required = field_manure_required(area);
    if required <= 1e-9 {
        return 0.0;
    }
    FARM_MANURE_FERTILITY_BONUS.max(0.0) * (manure_applied.max(0.0) / required).clamp(0.0, 1.0)
}

pub fn point_in_field(point: Point2, corners: &ZoneCorners) -> bool {
    let polygon = corners_array(corners);
    let mut sign = 0.0;
    for index in 0..polygon.len() {
        let value = cross(
            subtract(polygon[(index + 1) % 4], polygon[index]),
            subtract(point, polygon[index]),
        );
        if value.abs() <= 1e-8 {
            continue;
        }
        if sign == 0.0 {
            sign = value.signum();
        } else if sign != value.signum() {
            return false;
        }
    }
    true
}

fn subtract(a: Point2, b: Point2) -> Point2 {
    Point2 {
        x: a.x - b.x,
        z: a.z - b.z,
    }
}

fn cross(a: Point2, b: Point2) -> f64 {
    a.x * b.z - a.z * b.x
}

fn distance(a: Point2, b: Point2) -> f64 {
    ((a.x - b.x).powi(2) + (a.z - b.z).powi(2)).sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oversized_fields_have_soft_diminishing_returns() {
        assert_eq!(field_size_efficiency(FARM_OPTIMAL_FIELD_AREA), 1.0);
        let large_efficiency = field_size_efficiency(FARM_OPTIMAL_FIELD_AREA * 2.0);
        assert!(large_efficiency < 1.0);
        assert!(large_efficiency > FARM_LARGE_FIELD_EFFICIENCY_FLOOR);
        assert_eq!(
            field_size_efficiency(FARM_OPTIMAL_FIELD_AREA * 1e12),
            FARM_LARGE_FIELD_EFFICIENCY_FLOOR
        );

        let optimal_yield = expected_grain_yield(
            FARM_OPTIMAL_FIELD_AREA,
            CROP_RYE,
            crop_definition(CROP_RYE).moisture_ideal,
            1.0,
            0.0,
            1.0,
            0.0,
            0.0,
        );
        let large_yield = expected_grain_yield(
            FARM_OPTIMAL_FIELD_AREA * 2.0,
            CROP_RYE,
            crop_definition(CROP_RYE).moisture_ideal,
            1.0,
            0.0,
            1.0,
            0.0,
            0.0,
        );
        assert!(large_yield > optimal_yield);
        assert!(large_yield / 2.0 < optimal_yield);
    }

    #[test]
    fn crop_calendars_split_autumn_and_spring_labor() {
        assert!(field_work_allowed(STAGE_SOWING, CROP_RYE, 10));
        assert!(!field_work_allowed(STAGE_SOWING, CROP_RYE, 3));
        assert!(field_work_allowed(STAGE_SOWING, CROP_OATS, 3));
        assert!(field_work_allowed(STAGE_SOWING, CROP_BARLEY, 3));
        assert!(field_work_allowed(STAGE_SOWING, CROP_FLAX, 3));
        assert!(field_work_allowed(STAGE_SOWING, CROP_WHEAT, 10));
        assert!(!field_work_allowed(STAGE_SOWING, CROP_OATS, 10));
        assert!(sowing_window_missed(STAGE_SOWING, CROP_RYE, 12));
        assert!(sowing_window_missed(STAGE_SOWING, CROP_OATS, 5));
        assert!(crop_growth_allowed(CROP_RYE, 6));
        assert!(crop_growth_allowed(CROP_OATS, 6));
        assert_eq!(crop_produce(CROP_FLAX), FarmCropProduce::Fibre);
        assert_eq!(crop_produce(CROP_BARLEY), FarmCropProduce::Barley);
        assert!(valid_crop(CROP_WHEAT));
        assert!(!valid_crop(99));
    }

    #[test]
    fn initial_field_fertility_uses_soil_groundwater_and_slope() {
        let gentle_dry = initial_field_fertility(0.0, 2.0, 40.0, -80.0);
        let gentle_wet = initial_field_fertility(0.8, 2.0, 40.0, -80.0);
        let steep_wet = initial_field_fertility(0.8, 16.0, 40.0, -80.0);
        assert!(gentle_wet > gentle_dry);
        assert!(gentle_wet > steep_wet);
        assert_ne!(
            initial_field_fertility(0.2, 2.0, 40.0, -80.0),
            initial_field_fertility(0.2, 2.0, -240.0, 180.0),
        );
        assert_eq!(initial_field_fertility(0.0, 100.0, 0.0, 0.0), 0.35);
    }

    #[test]
    fn crop_profiles_create_distinct_non_river_land_choices() {
        let sites = [
            (-300.0, -260.0),
            (-180.0, 120.0),
            (40.0, -80.0),
            (190.0, 240.0),
            (320.0, -140.0),
        ];
        let rye_scores = sites.map(|(x, z)| crop_environmental_suitability(CROP_RYE, 0.0, x, z));
        let oats_scores = sites.map(|(x, z)| crop_environmental_suitability(CROP_OATS, 0.0, x, z));
        assert_ne!(rye_scores, oats_scores);
        assert!(
            rye_scores.iter().copied().fold(f64::MIN, f64::max)
                - rye_scores.iter().copied().fold(f64::MAX, f64::min)
                > 0.08
        );
        assert!(
            oats_scores.iter().copied().fold(f64::MIN, f64::max)
                - oats_scores.iter().copied().fold(f64::MAX, f64::min)
                > 0.08
        );
        assert!(
            crop_environmental_suitability(CROP_OATS, 0.7, 0.0, 0.0)
                > crop_environmental_suitability(CROP_OATS, 0.0, 0.0, 0.0)
        );
        assert!(
            crop_environmental_suitability(CROP_RYE, 0.0, 0.0, 0.0)
                > crop_environmental_suitability(CROP_RYE, 0.7, 0.0, 0.0)
        );
    }

    #[test]
    fn manure_benefit_is_proportional_to_physical_field_coverage() {
        let area = 1_600.0;
        let required = field_manure_required(area);
        assert!((required - 64.0).abs() < 1e-9);
        assert_eq!(field_manure_fertility_bonus(area, 0.0), 0.0);
        assert!(
            (field_manure_fertility_bonus(area, required / 2.0)
                - FARM_MANURE_FERTILITY_BONUS / 2.0)
                .abs()
                < 1e-9
        );
        assert!(
            (field_manure_fertility_bonus(area, required) - FARM_MANURE_FERTILITY_BONUS).abs()
                < 1e-9
        );
        assert_eq!(
            field_manure_fertility_bonus(area, required * 2.0),
            FARM_MANURE_FERTILITY_BONUS
        );
    }

    #[test]
    fn convex_four_corner_parcels_preserve_area_and_penalize_skew() {
        let square = corners_from_values([0.0, 0.0, 20.0, 0.0, 20.0, 20.0, 0.0, 20.0]);
        let irregular = corners_from_values([0.0, 0.0, 20.0, 0.0, 18.0, 14.0, 2.0, 12.0]);
        let concave = corners_from_values([0.0, 0.0, 20.0, 0.0, 5.0, 5.0, 0.0, 15.0]);
        let crossed = corners_from_values([0.0, 0.0, 20.0, 20.0, 0.0, 20.0, 20.0, 0.0]);
        let non_finite = corners_from_values([0.0, 0.0, f64::NAN, 0.0, 20.0, 20.0, 0.0, 20.0]);

        assert!(is_valid_convex_quadrilateral(&square));
        assert!(is_valid_convex_quadrilateral(&irregular));
        assert!(!is_valid_convex_quadrilateral(&concave));
        assert!(!is_valid_convex_quadrilateral(&crossed));
        assert!(!is_valid_convex_quadrilateral(&non_finite));
        assert!((polygon_area(&irregular) - 234.0).abs() < 1e-9);
        assert_eq!(shape_efficiency(&square), 1.0);
        assert!(shape_efficiency(&irregular) < 1.0);
        assert!(shape_efficiency(&irregular) > 0.72);

        let center = centroid(&irregular);
        assert!(point_in_field(center, &irregular));
        let sampled_center = bilinear_point(&irregular, 0.5, 0.5);
        assert!(point_in_field(sampled_center, &irregular));
    }

    #[test]
    fn three_year_rotation_cycles_while_legacy_fields_repeat_the_next_crop() {
        assert_eq!(
            advance_crop_rotation(CROP_RYE, CROP_OATS, CROP_FALLOW),
            (CROP_OATS, CROP_FALLOW, CROP_RYE)
        );
        assert_eq!(
            advance_crop_rotation(CROP_OATS, CROP_FALLOW, CROP_RYE),
            (CROP_FALLOW, CROP_RYE, CROP_OATS)
        );
        assert_eq!(
            advance_crop_rotation(CROP_RYE, CROP_OATS, NO_FOLLOWING_CROP),
            (CROP_OATS, CROP_OATS, NO_FOLLOWING_CROP)
        );
    }

    #[test]
    fn early_harvest_trades_ripeness_for_an_extra_work_month() {
        assert!(!early_harvest_available(
            STAGE_GROWING,
            CROP_RYE,
            FARM_EARLY_HARVEST_MONTH - 1,
            0.9,
        ));
        assert!(!early_harvest_available(
            STAGE_GROWING,
            CROP_RYE,
            FARM_EARLY_HARVEST_MONTH,
            FARM_EARLY_HARVEST_MINIMUM_GROWTH - 0.01,
        ));
        assert!(!early_harvest_available(
            STAGE_GROWING,
            CROP_FALLOW,
            FARM_EARLY_HARVEST_MONTH,
            1.0,
        ));
        assert!(early_harvest_available(
            STAGE_GROWING,
            CROP_RYE,
            FARM_EARLY_HARVEST_MONTH,
            FARM_EARLY_HARVEST_MINIMUM_GROWTH,
        ));
        assert!(field_work_allowed(
            STAGE_HARVESTING,
            CROP_RYE,
            FARM_EARLY_HARVEST_MONTH,
        ));
        assert!(field_work_allowed(STAGE_HARVESTING, CROP_RYE, 9));

        let minimum_yield = early_harvest_yield_multiplier(FARM_EARLY_HARVEST_MINIMUM_GROWTH);
        assert!(
            (minimum_yield
                - FARM_EARLY_HARVEST_MINIMUM_GROWTH * FARM_EARLY_HARVEST_RIPENESS_FACTOR)
                .abs()
                < 1e-9
        );
        assert!(
            (early_harvest_yield_multiplier(1.0) - FARM_EARLY_HARVEST_RIPENESS_FACTOR).abs() < 1e-9
        );
        assert!(early_harvest_yield_multiplier(1.0) < 1.0);
    }

    #[test]
    fn seed_reserve_tracks_crop_progress_and_field_priority() {
        assert!((seed_grain_required(1_600.0, CROP_RYE) - 19.2).abs() < 1e-9);
        assert!((seed_grain_required(1_600.0, CROP_OATS) - 22.4).abs() < 1e-9);
        assert_eq!(seed_grain_required(1_600.0, CROP_FALLOW), 0.0);
        assert!(
            (field_seed_grain_remaining(1_600.0, CROP_RYE, CROP_OATS, STAGE_SOWING, 0.25, 1,)
                - 14.4)
                .abs()
                < 1e-9
        );
        assert!(
            (field_seed_grain_remaining(1_600.0, CROP_RYE, CROP_OATS, STAGE_GROWING, 0.5, 1,)
                - 22.4)
                .abs()
                < 1e-9
        );
        assert_eq!(
            field_seed_grain_remaining(1_600.0, CROP_RYE, CROP_OATS, STAGE_GROWING, 0.5, 0,),
            0.0
        );
        assert!((farmstead_exportable_grain(30.0, 19.2) - 10.8).abs() < 1e-9);
        assert_eq!(farmstead_exportable_grain(10.0, 19.2), 0.0);
        assert_eq!(
            field_seed_crop(CROP_BARLEY, CROP_RYE, STAGE_SOWING),
            CROP_BARLEY
        );
        assert_eq!(
            field_seed_crop(CROP_RYE, CROP_BARLEY, STAGE_GROWING),
            CROP_BARLEY
        );
    }
}
