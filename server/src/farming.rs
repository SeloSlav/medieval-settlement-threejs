use crate::balance_generated::{
    farm_crop_def, FarmCropDef, FarmCropProduce, FARM_BASE_GRAIN_PER_SQUARE_METER,
    FARM_CROP_BARLEY_ID, FARM_CROP_FALLOW_ID, FARM_CROP_FLAX_ID, FARM_CROP_OATS_ID, FARM_CROP_RYE,
    FARM_CROP_RYE_ID, FARM_CROP_WHEAT_ID, FARM_EARLY_HARVEST_MINIMUM_GROWTH,
    FARM_EARLY_HARVEST_RIPENESS_FACTOR, FARM_FIELD_BOUNDARY_WORK_PER_METER_PER_STAGE,
    FARM_FIELD_SETUP_WORK_PER_STAGE, FARM_FIELD_TRAVEL_WORK_PER_METER_PER_STAGE,
    FARM_HARVEST_WORK_PER_SQUARE_METER, FARM_MANURE_FERTILITY_BONUS, FARM_MANURE_PER_SQUARE_METER,
    FARM_PLOUGH_WORK_PER_SQUARE_METER, FARM_REGIONAL_AFFINITY_FLOOR, FARM_REGIONAL_ASPECT_RATIO,
    FARM_REGIONAL_CENTER_RADIUS_RATIO, FARM_REGIONAL_CORE_RADIUS_RATIO,
    FARM_REGIONAL_PRIME_CROPS_LARGE, FARM_REGIONAL_PRIME_CROPS_MEDIUM,
    FARM_REGIONAL_PRIME_CROPS_SMALL, FARM_REGIONAL_UNREPRESENTED_CEILING,
    FARM_REGIONAL_YIELD_FLOOR, FARM_SHARED_LABOR_MIN_PRIORITY, FARM_SLOPE_PENALTY_PER_DEGREE,
    FARM_SOW_WORK_PER_SQUARE_METER,
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

pub fn crop_harvest_month(crop: u8) -> u32 {
    u32::from(crop_definition(crop).harvest_month)
}

pub fn month_before(month: u32) -> u32 {
    if month <= 1 {
        12
    } else {
        month - 1
    }
}

pub fn month_after(month: u32) -> u32 {
    month % 12 + 1
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

#[derive(Clone, Copy, Debug)]
pub struct ArableLandConditions {
    /// 0 = light/gravelly soil, 1 = heavy/clay-rich soil.
    pub texture: f64,
    /// Persistent depth of workable, nutrient-holding topsoil.
    pub depth: f64,
}

#[derive(Clone, Copy, Debug)]
struct CropRegionalProfile {
    #[cfg(test)]
    pub rank: i32,
    #[cfg(test)]
    pub represented: bool,
    #[cfg(test)]
    pub center_x: f64,
    #[cfg(test)]
    pub center_z: f64,
    #[cfg(test)]
    pub province_strength: f64,
    #[cfg(test)]
    pub affinity: f64,
    yield_multiplier: f64,
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

/// Seeded map-scale comparative advantage layered over physical land quality.
/// Small, medium, and large maps expose 3, 4, and 5 genuinely prime crops;
/// absent specialties remain possible at inefficient subsistence output.
fn crop_regional_profile(
    crop: u8,
    x: f64,
    z: f64,
    world_seed: u64,
    map_size: u8,
) -> CropRegionalProfile {
    let crop_index = match crop {
        CROP_RYE => 0_i32,
        CROP_OATS => 1_i32,
        CROP_BARLEY => 2_i32,
        CROP_FLAX => 3_i32,
        CROP_WHEAT => 4_i32,
        _ => {
            return CropRegionalProfile {
                #[cfg(test)]
                rank: -1,
                #[cfg(test)]
                represented: true,
                #[cfg(test)]
                center_x: 0.0,
                #[cfg(test)]
                center_z: 0.0,
                #[cfg(test)]
                province_strength: 1.0,
                #[cfg(test)]
                affinity: 1.0,
                yield_multiplier: 1.0,
            }
        }
    };
    let layout_hash = regional_seed_hash(world_seed, 0xa511_e9b3);
    let rotation = (layout_hash % 5) as i32;
    let direction = if layout_hash & 0x100 == 0 {
        1_i32
    } else {
        -1_i32
    };
    let rank = (direction * (crop_index - rotation)).rem_euclid(5);
    let generation_half = generation_half_for_map_size(map_size);
    let base_angle = regional_seed_hash(world_seed, 0x63d8_35f1) as f64 / 4_294_967_296.0
        * std::f64::consts::TAU;
    let province_angle = if rank == 0 {
        base_angle
    } else {
        base_angle + (rank - 1) as f64 * std::f64::consts::FRAC_PI_2
    };
    let center_distance = if rank == 0 {
        0.0
    } else {
        generation_half * FARM_REGIONAL_CENTER_RADIUS_RATIO
    };
    let center_x = province_angle.cos() * center_distance;
    let center_z = province_angle.sin() * center_distance;
    let long_axis_angle = if rank == 0 {
        base_angle
    } else {
        province_angle + std::f64::consts::FRAC_PI_2
    };
    let dx = if x.is_finite() { x } else { 0.0 } - center_x;
    let dz = if z.is_finite() { z } else { 0.0 } - center_z;
    let along = dx * long_axis_angle.cos() + dz * long_axis_angle.sin();
    let across = -dx * long_axis_angle.sin() + dz * long_axis_angle.cos();
    let core_radius = (generation_half * FARM_REGIONAL_CORE_RADIUS_RATIO).max(1.0);
    let scaled_distance = ((along / (core_radius * FARM_REGIONAL_ASPECT_RATIO)).powi(2)
        + (across / core_radius).powi(2))
    .sqrt();
    let province_strength = 1.0 - smoothstep(0.22, 1.15, scaled_distance);
    let represented = rank < i32::from(regional_prime_crop_count(map_size));
    let affinity_ceiling = if represented {
        1.0
    } else {
        FARM_REGIONAL_UNREPRESENTED_CEILING
    };
    let affinity = FARM_REGIONAL_AFFINITY_FLOOR
        + (affinity_ceiling - FARM_REGIONAL_AFFINITY_FLOOR) * province_strength;
    let yield_multiplier = FARM_REGIONAL_YIELD_FLOOR + (1.0 - FARM_REGIONAL_YIELD_FLOOR) * affinity;
    CropRegionalProfile {
        #[cfg(test)]
        rank,
        #[cfg(test)]
        represented,
        #[cfg(test)]
        center_x,
        #[cfg(test)]
        center_z,
        #[cfg(test)]
        province_strength,
        #[cfg(test)]
        affinity,
        yield_multiplier,
    }
}

pub fn crop_slope_suitability(crop: u8, average_slope_degrees: f64) -> f64 {
    (1.0 - average_slope_degrees.max(0.0)
        * FARM_SLOPE_PENALTY_PER_DEGREE
        * crop_definition(crop).slope_penalty_multiplier)
        .clamp(0.35, 1.0)
}

pub fn crop_environmental_suitability(
    crop: u8,
    groundwater: f64,
    x: f64,
    z: f64,
    world_seed: u64,
    map_size: u8,
) -> f64 {
    if crop_definition(crop).produce == FarmCropProduce::None {
        return 1.0;
    }
    let moisture = moisture_suitability(crop, effective_field_moisture(groundwater, x, z));
    let soil = crop_soil_suitability(crop, x, z);
    let local_suitability = moisture * 0.42 + soil * 0.58;
    local_suitability * crop_regional_profile(crop, x, z, world_seed, map_size).yield_multiplier
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
    world_seed: u64,
    map_size: u8,
) -> f64 {
    crop_environmental_suitability(crop, moisture, x, z, world_seed, map_size)
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
    world_seed: u64,
    map_size: u8,
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
            world_seed,
            map_size,
        )
}

fn regional_seed_hash(seed: u64, salt: u32) -> u32 {
    let mut hash = seed as u32 ^ salt;
    hash = (hash ^ (hash >> 16)).wrapping_mul(0x7feb_352d);
    hash = (hash ^ (hash >> 15)).wrapping_mul(0x846c_a68b);
    hash ^ (hash >> 16)
}

fn generation_half_for_map_size(map_size: u8) -> f64 {
    match map_size {
        0 => 310.0,
        2 => 876.812_408_671_318_9,
        _ => 620.0,
    }
}

fn regional_prime_crop_count(map_size: u8) -> u8 {
    match map_size {
        0 => FARM_REGIONAL_PRIME_CROPS_SMALL,
        2 => FARM_REGIONAL_PRIME_CROPS_LARGE,
        _ => FARM_REGIONAL_PRIME_CROPS_MEDIUM,
    }
}

fn smoothstep(edge0: f64, edge1: f64, value: f64) -> f64 {
    let t = ((value - edge0) / (edge1 - edge0).max(1e-9)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

pub fn work_required(
    stage: u8,
    area: f64,
    shape: f64,
    perimeter: f64,
    farmstead_distance: f64,
) -> f64 {
    let per_square_meter = match stage {
        STAGE_PLOUGHING => FARM_PLOUGH_WORK_PER_SQUARE_METER,
        STAGE_SOWING => FARM_SOW_WORK_PER_SQUARE_METER,
        STAGE_HARVESTING => FARM_HARVEST_WORK_PER_SQUARE_METER,
        _ => 0.0,
    };
    if per_square_meter <= 0.0 {
        return 0.0;
    }
    area.max(1.0) * per_square_meter / shape.clamp(0.72, 1.0)
        + FARM_FIELD_SETUP_WORK_PER_STAGE
        + perimeter.max(0.0) * FARM_FIELD_BOUNDARY_WORK_PER_METER_PER_STAGE
        + farmstead_distance.max(0.0) * FARM_FIELD_TRAVEL_WORK_PER_METER_PER_STAGE
}

pub fn field_accepts_farmstead_labor(
    priority: u8,
    linked_to_farmstead: bool,
    farmstead_distance: f64,
    work_radius: f64,
) -> bool {
    priority > 0
        && (linked_to_farmstead
            || (priority >= FARM_SHARED_LABOR_MIN_PRIORITY
                && farmstead_distance <= work_radius.max(0.0)))
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
            month == month_before(u32::from(definition.harvest_month))
                || month == u32::from(definition.harvest_month)
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
        && month == month_before(crop_harvest_month(crop))
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
    fn field_size_is_an_operational_tradeoff_instead_of_a_yield_cliff() {
        let small_area = 1_600.0;
        let small_yield = expected_grain_yield(
            small_area,
            CROP_RYE,
            crop_definition(CROP_RYE).moisture_ideal,
            1.0,
            0.0,
            1.0,
            0.0,
            0.0,
            0x071a_2e0d,
            1,
        );
        let large_area = small_area * 2.0;
        let large_yield = expected_grain_yield(
            large_area,
            CROP_RYE,
            crop_definition(CROP_RYE).moisture_ideal,
            1.0,
            0.0,
            1.0,
            0.0,
            0.0,
            0x071a_2e0d,
            1,
        );
        assert!((large_yield - small_yield * 2.0).abs() < 1e-9);

        let small_perimeter = small_area.sqrt() * 4.0;
        let large_perimeter = large_area.sqrt() * 4.0;
        let small_work = work_required(STAGE_HARVESTING, small_area, 1.0, small_perimeter, 30.0);
        let large_work = work_required(STAGE_HARVESTING, large_area, 1.0, large_perimeter, 30.0);
        assert!(large_work < small_work * 2.0);
        assert!(
            work_required(STAGE_HARVESTING, small_area, 1.0, small_perimeter, 120.0) > small_work
        );
    }

    #[test]
    fn high_priority_fields_accept_nearby_farmstead_labor() {
        assert!(field_accepts_farmstead_labor(1, true, 400.0, 250.0));
        assert!(!field_accepts_farmstead_labor(0, true, 10.0, 250.0));
        assert!(!field_accepts_farmstead_labor(1, false, 10.0, 250.0));
        assert!(field_accepts_farmstead_labor(2, false, 250.0, 250.0));
        assert!(field_accepts_farmstead_labor(3, false, 100.0, 250.0));
        assert!(!field_accepts_farmstead_labor(2, false, 250.1, 250.0));
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
        let rye_scores =
            sites.map(|(x, z)| crop_environmental_suitability(CROP_RYE, 0.0, x, z, 0x071a_2e0d, 1));
        let oats_scores = sites
            .map(|(x, z)| crop_environmental_suitability(CROP_OATS, 0.0, x, z, 0x071a_2e0d, 1));
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
            crop_environmental_suitability(CROP_OATS, 0.7, 0.0, 0.0, 0x071a_2e0d, 1)
                > crop_environmental_suitability(CROP_OATS, 0.0, 0.0, 0.0, 0x071a_2e0d, 1)
        );
        assert!(
            crop_environmental_suitability(CROP_RYE, 0.0, 0.0, 0.0, 0x071a_2e0d, 1)
                > crop_environmental_suitability(CROP_RYE, 0.7, 0.0, 0.0, 0x071a_2e0d, 1)
        );
    }

    #[test]
    fn map_size_progressively_unlocks_distinct_prime_crop_provinces() {
        let crops = [CROP_RYE, CROP_OATS, CROP_BARLEY, CROP_FLAX, CROP_WHEAT];
        for (map_size, expected_prime_crops) in [(0, 3), (1, 4), (2, 5)] {
            let profiles = crops.map(|crop| {
                let placement = crop_regional_profile(crop, 0.0, 0.0, 0x071a_2e0d, map_size);
                crop_regional_profile(
                    crop,
                    placement.center_x,
                    placement.center_z,
                    0x071a_2e0d,
                    map_size,
                )
            });
            assert_eq!(
                profiles
                    .iter()
                    .filter(|profile| profile.represented)
                    .count(),
                expected_prime_crops
            );
            for profile in profiles {
                assert!(profile.province_strength > 0.999_999);
                if profile.represented {
                    assert!(profile.affinity > 0.999_999);
                    assert!(profile.yield_multiplier > 0.999_999);
                } else {
                    assert!(profile.affinity <= FARM_REGIONAL_UNREPRESENTED_CEILING + 1e-9);
                    assert!(profile.yield_multiplier < 0.71);
                }
            }
        }

        let parity_fixture = crop_regional_profile(CROP_FLAX, 123.5, -87.25, 0x071a_2e0d, 2);
        assert_eq!(parity_fixture.rank, 0);
        assert!((parity_fixture.province_strength - 0.871_211_802_324_760_8).abs() < 1e-12);
        assert!((parity_fixture.affinity - 0.884_090_622_092_284_7).abs() < 1e-12);
        assert!((parity_fixture.yield_multiplier - 0.932_772_560_813_525_1).abs() < 1e-12);
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
        let rye_early_month = month_before(crop_harvest_month(CROP_RYE));
        assert!(!early_harvest_available(
            STAGE_GROWING,
            CROP_RYE,
            month_before(rye_early_month),
            0.9,
        ));
        assert!(!early_harvest_available(
            STAGE_GROWING,
            CROP_RYE,
            rye_early_month,
            FARM_EARLY_HARVEST_MINIMUM_GROWTH - 0.01,
        ));
        assert!(!early_harvest_available(
            STAGE_GROWING,
            CROP_FALLOW,
            rye_early_month,
            1.0,
        ));
        assert!(early_harvest_available(
            STAGE_GROWING,
            CROP_RYE,
            rye_early_month,
            FARM_EARLY_HARVEST_MINIMUM_GROWTH,
        ));
        assert!(field_work_allowed(
            STAGE_HARVESTING,
            CROP_RYE,
            rye_early_month,
        ));
        assert!(field_work_allowed(
            STAGE_HARVESTING,
            CROP_RYE,
            crop_harvest_month(CROP_RYE),
        ));

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
        assert!((seed_grain_required(1_600.0, CROP_RYE) - 17.6).abs() < 1e-9);
        assert!((seed_grain_required(1_600.0, CROP_OATS) - 22.4).abs() < 1e-9);
        assert_eq!(seed_grain_required(1_600.0, CROP_FALLOW), 0.0);
        assert!(
            (field_seed_grain_remaining(1_600.0, CROP_RYE, CROP_OATS, STAGE_SOWING, 0.25, 1,)
                - 13.2)
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
        assert!((farmstead_exportable_grain(30.0, 17.6) - 12.4).abs() < 1e-9);
        assert_eq!(farmstead_exportable_grain(10.0, 17.6), 0.0);
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
