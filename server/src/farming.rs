use crate::balance_generated::{
    FARM_BASE_GRAIN_PER_SQUARE_METER, FARM_FALLOW_FERTILITY_RESTORE,
    FARM_HARVEST_WORK_PER_SQUARE_METER, FARM_LARGE_FIELD_EFFICIENCY_EXPONENT,
    FARM_LARGE_FIELD_EFFICIENCY_FLOOR, FARM_OATS_FERTILITY_DRAIN, FARM_OATS_MOISTURE_IDEAL,
    FARM_OATS_MOISTURE_TOLERANCE, FARM_OPTIMAL_FIELD_AREA, FARM_PLOUGH_WORK_PER_SQUARE_METER,
    FARM_RYE_FERTILITY_DRAIN, FARM_RYE_MOISTURE_IDEAL, FARM_RYE_MOISTURE_TOLERANCE,
    FARM_SLOPE_PENALTY_PER_DEGREE, FARM_SOW_WORK_PER_SQUARE_METER,
};
use crate::burgage::{Point2, ZoneCorners};

pub const CROP_RYE: u8 = 0;
pub const CROP_OATS: u8 = 1;
pub const CROP_FALLOW: u8 = 2;

pub const STAGE_PLOUGHING: u8 = 0;
pub const STAGE_SOWING: u8 = 1;
pub const STAGE_GROWING: u8 = 2;
pub const STAGE_HARVESTING: u8 = 3;

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
    Point2 {
        x: (corners.a.x + corners.b.x + corners.c.x + corners.d.x) * 0.25,
        z: (corners.a.z + corners.b.z + corners.c.z + corners.d.z) * 0.25,
    }
}

pub fn edge_lengths(corners: &ZoneCorners) -> [f64; 4] {
    let points = corners_array(corners);
    std::array::from_fn(|index| distance(points[index], points[(index + 1) % 4]))
}

pub fn is_valid_rectangle(corners: &ZoneCorners) -> bool {
    let points = corners_array(corners);
    let edges = [
        subtract(points[1], points[0]),
        subtract(points[2], points[1]),
        subtract(points[3], points[2]),
        subtract(points[0], points[3]),
    ];
    let lengths = edges.map(|edge| (edge.x * edge.x + edge.z * edge.z).sqrt());
    if lengths.iter().any(|length| *length <= 1e-6) {
        return false;
    }
    let perpendicular = dot(edges[0], edges[1]).abs() <= lengths[0] * lengths[1] * 0.035;
    let opposite_a = cross(edges[0], edges[2]).abs() <= lengths[0] * lengths[2] * 0.035;
    let opposite_b = cross(edges[1], edges[3]).abs() <= lengths[1] * lengths[3] * 0.035;
    perpendicular && opposite_a && opposite_b && polygon_area(corners) > 1e-6
}

pub fn shape_efficiency(corners: &ZoneCorners) -> f64 {
    let lengths = edge_lengths(corners);
    let short = lengths[0].min(lengths[1]).max(1e-6);
    let long = lengths[0].max(lengths[1]);
    let aspect = long / short;
    (1.0 - (aspect - 1.0).max(0.0) * 0.035).clamp(0.72, 1.0)
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
    if crop == CROP_FALLOW {
        return 1.0;
    }
    let (ideal, tolerance) = if crop == CROP_OATS {
        (FARM_OATS_MOISTURE_IDEAL, FARM_OATS_MOISTURE_TOLERANCE)
    } else {
        (FARM_RYE_MOISTURE_IDEAL, FARM_RYE_MOISTURE_TOLERANCE)
    };
    let base = 1.0 - (moisture.clamp(0.0, 1.0) - ideal).abs() / tolerance.max(1e-6);
    (0.25 + base.clamp(0.0, 1.0) * 0.75).clamp(0.25, 1.0)
}

pub fn slope_suitability(average_slope_degrees: f64) -> f64 {
    (1.0 - average_slope_degrees.max(0.0) * FARM_SLOPE_PENALTY_PER_DEGREE).clamp(0.35, 1.0)
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
    if crop == CROP_FALLOW {
        return 0.0;
    }
    area.max(0.0)
        * FARM_BASE_GRAIN_PER_SQUARE_METER
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

pub fn fertility_after_harvest(crop: u8, fertility: f64) -> f64 {
    match crop {
        CROP_FALLOW => (fertility + FARM_FALLOW_FERTILITY_RESTORE).min(1.0),
        CROP_OATS => (fertility - FARM_OATS_FERTILITY_DRAIN).max(0.2),
        _ => (fertility - FARM_RYE_FERTILITY_DRAIN).max(0.2),
    }
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

fn dot(a: Point2, b: Point2) -> f64 {
    a.x * b.x + a.z * b.z
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
            FARM_RYE_MOISTURE_IDEAL,
            1.0,
            0.0,
            1.0,
        );
        let large_yield = expected_grain_yield(
            FARM_OPTIMAL_FIELD_AREA * 2.0,
            CROP_RYE,
            FARM_RYE_MOISTURE_IDEAL,
            1.0,
            0.0,
            1.0,
        );
        assert!(large_yield > optimal_yield);
        assert!(large_yield / 2.0 < optimal_yield);
    }
}
