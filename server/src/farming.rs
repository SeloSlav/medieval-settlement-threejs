use crate::balance_generated::{
    farm_crop_def, FarmCropDef, FarmCropProduce, FARM_BASE_GRAIN_PER_SQUARE_METER,
    FARM_CROP_BARLEY_ID, FARM_CROP_FALLOW_ID, FARM_CROP_FLAX_ID, FARM_CROP_OATS_ID, FARM_CROP_RYE,
    FARM_CROP_RYE_ID, FARM_CROP_WHEAT_ID, FARM_EARLY_HARVEST_MINIMUM_GROWTH,
    FARM_EARLY_HARVEST_MONTH, FARM_EARLY_HARVEST_RIPENESS_FACTOR,
    FARM_HARVEST_WORK_PER_SQUARE_METER, FARM_LARGE_FIELD_EFFICIENCY_EXPONENT,
    FARM_LARGE_FIELD_EFFICIENCY_FLOOR, FARM_OPTIMAL_FIELD_AREA, FARM_PLOUGH_WORK_PER_SQUARE_METER,
    FARM_SLOPE_PENALTY_PER_DEGREE, FARM_SOW_WORK_PER_SQUARE_METER,
};
use crate::burgage::{Point2, ZoneCorners};

pub const CROP_RYE: u8 = FARM_CROP_RYE_ID;
pub const CROP_OATS: u8 = FARM_CROP_OATS_ID;
pub const CROP_FALLOW: u8 = FARM_CROP_FALLOW_ID;
pub const CROP_BARLEY: u8 = FARM_CROP_BARLEY_ID;
pub const CROP_FLAX: u8 = FARM_CROP_FLAX_ID;
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

pub fn bilinear_point(corners: &ZoneCorners, u: f64, v: f64) -> Point2 {
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

pub fn moisture_suitability(crop: u8, moisture: f64) -> f64 {
    let definition = crop_definition(crop);
    if definition.produce == FarmCropProduce::None {
        return 1.0;
    }
    let (ideal, tolerance) = (definition.moisture_ideal, definition.moisture_tolerance);
    let base = 1.0 - (moisture.clamp(0.0, 1.0) - ideal).abs() / tolerance.max(1e-6);
    (0.25 + base.clamp(0.0, 1.0) * 0.75).clamp(0.25, 1.0)
}

pub fn slope_suitability(average_slope_degrees: f64) -> f64 {
    (1.0 - average_slope_degrees.max(0.0) * FARM_SLOPE_PENALTY_PER_DEGREE).clamp(0.35, 1.0)
}

/// Predicts the soil quality of newly cleared arable land from the same
/// groundwater and slope samples used during authoritative field placement.
pub fn initial_field_fertility(moisture: f64, average_slope_degrees: f64) -> f64 {
    (0.62 + moisture.clamp(0.0, 1.0) * 0.30 - average_slope_degrees.max(0.0) * 0.006)
        .clamp(0.35, 0.95)
}

pub fn yield_suitability(
    crop: u8,
    moisture: f64,
    fertility: f64,
    average_slope_degrees: f64,
    shape: f64,
) -> f64 {
    moisture_suitability(crop, moisture)
        * fertility.clamp(0.2, 1.0)
        * slope_suitability(average_slope_degrees)
        * shape.clamp(0.72, 1.0)
}

pub fn expected_grain_yield(
    area: f64,
    crop: u8,
    moisture: f64,
    fertility: f64,
    average_slope_degrees: f64,
    shape: f64,
) -> f64 {
    let definition = crop_definition(crop);
    if definition.produce == FarmCropProduce::None {
        return 0.0;
    }
    area.max(0.0)
        * FARM_BASE_GRAIN_PER_SQUARE_METER
        * definition.yield_multiplier
        * yield_suitability(crop, moisture, fertility, average_slope_degrees, shape)
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
        );
        let large_yield = expected_grain_yield(
            FARM_OPTIMAL_FIELD_AREA * 2.0,
            CROP_RYE,
            crop_definition(CROP_RYE).moisture_ideal,
            1.0,
            0.0,
            1.0,
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
    fn initial_field_fertility_rewards_well_drained_gentle_ground() {
        assert!((initial_field_fertility(0.5, 0.0) - 0.77).abs() < 1e-9);
        assert!(initial_field_fertility(0.7, 2.0) > initial_field_fertility(0.3, 12.0));
        assert!((initial_field_fertility(10.0, 0.0) - 0.92).abs() < 1e-9);
        assert_eq!(initial_field_fertility(0.0, 100.0), 0.35);
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
        assert_eq!(field_seed_crop(CROP_BARLEY, CROP_RYE, STAGE_SOWING), CROP_BARLEY);
        assert_eq!(field_seed_crop(CROP_RYE, CROP_BARLEY, STAGE_GROWING), CROP_BARLEY);
    }
}
