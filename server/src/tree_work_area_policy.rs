#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TreeWorkArea {
    pub x: f64,
    pub z: f64,
    pub radius: f64,
}

pub const MIN_TREE_WORK_AREA_RADIUS: f64 = 20.0;
pub const MAX_TREE_WORK_AREA_RADIUS: f64 = 240.0;
pub const MAX_TREE_WORK_AREA_COORDINATE_ABS: f64 = 10_000.0;

pub fn supports_tree_work_area(kind: &str) -> bool {
    matches!(kind, "lumber_mill" | "woodcutters_lodge" | "reforester")
}

pub fn tree_work_area_coordinates_are_valid(x: f64, z: f64) -> bool {
    x.is_finite()
        && z.is_finite()
        && x.abs() <= MAX_TREE_WORK_AREA_COORDINATE_ABS
        && z.abs() <= MAX_TREE_WORK_AREA_COORDINATE_ABS
}

pub fn tree_work_area_radius_is_valid(radius: f64) -> bool {
    radius.is_finite() && (MIN_TREE_WORK_AREA_RADIUS..=MAX_TREE_WORK_AREA_RADIUS).contains(&radius)
}

pub fn validate_tree_work_area(x: f64, z: f64, radius: f64) -> Result<(), &'static str> {
    if !tree_work_area_coordinates_are_valid(x, z) {
        return Err("Tree work-area coordinates are invalid.");
    }
    if !tree_work_area_radius_is_valid(radius) {
        return Err("Tree work-area radius must be between 20 and 240 metres.");
    }
    Ok(())
}

/// Resolve the persistent opt-in circle against a building's legacy work area.
/// A zero custom radius is the save-compatible disabled state.
pub fn effective_tree_work_area(
    building_x: f64,
    building_z: f64,
    default_radius: f64,
    custom_x: f64,
    custom_z: f64,
    custom_radius: f64,
) -> TreeWorkArea {
    if custom_radius > 0.0
        && custom_radius.is_finite()
        && custom_x.is_finite()
        && custom_z.is_finite()
    {
        return TreeWorkArea {
            x: custom_x,
            z: custom_z,
            radius: custom_radius,
        };
    }

    TreeWorkArea {
        x: building_x,
        z: building_z,
        radius: if default_radius.is_finite() {
            default_radius.max(0.0)
        } else {
            0.0
        },
    }
}

pub fn tree_work_area_contains(area: TreeWorkArea, x: f64, z: f64) -> bool {
    if !x.is_finite()
        || !z.is_finite()
        || !area.x.is_finite()
        || !area.z.is_finite()
        || !area.radius.is_finite()
        || area.radius < 0.0
    {
        return false;
    }
    let dx = x - area.x;
    let dz = z - area.z;
    dx * dx + dz * dz <= area.radius * area.radius
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_tree_management_buildings_support_custom_areas() {
        assert!(supports_tree_work_area("lumber_mill"));
        assert!(supports_tree_work_area("reforester"));
        assert!(supports_tree_work_area("woodcutters_lodge"));
        assert!(!supports_tree_work_area("stone_quarry"));
    }

    #[test]
    fn zero_radius_preserves_the_building_centered_default() {
        assert_eq!(
            effective_tree_work_area(12.0, -7.0, 210.0, 300.0, 400.0, 0.0),
            TreeWorkArea {
                x: 12.0,
                z: -7.0,
                radius: 210.0,
            }
        );
    }

    #[test]
    fn positive_radius_uses_the_exact_custom_circle() {
        assert_eq!(
            effective_tree_work_area(12.0, -7.0, 210.0, 300.0, 400.0, 48.0),
            TreeWorkArea {
                x: 300.0,
                z: 400.0,
                radius: 48.0,
            }
        );
    }

    #[test]
    fn contains_uses_exact_point_coordinates_and_includes_the_boundary() {
        let area = TreeWorkArea {
            x: 10.0,
            z: 20.0,
            radius: 5.0,
        };
        assert!(tree_work_area_contains(area, 13.0, 24.0));
        assert!(!tree_work_area_contains(area, 13.01, 24.0));
    }

    #[test]
    fn validation_accepts_inclusive_radius_and_coordinate_bounds() {
        assert!(validate_tree_work_area(
            MAX_TREE_WORK_AREA_COORDINATE_ABS,
            -MAX_TREE_WORK_AREA_COORDINATE_ABS,
            MIN_TREE_WORK_AREA_RADIUS,
        )
        .is_ok());
        assert!(validate_tree_work_area(0.0, 0.0, MAX_TREE_WORK_AREA_RADIUS).is_ok());
    }

    #[test]
    fn validation_rejects_nonfinite_and_out_of_range_values() {
        assert!(validate_tree_work_area(f64::NAN, 0.0, 40.0).is_err());
        assert!(validate_tree_work_area(0.0, f64::INFINITY, 40.0).is_err());
        assert!(
            validate_tree_work_area(MAX_TREE_WORK_AREA_COORDINATE_ABS + 0.01, 0.0, 40.0,).is_err()
        );
        assert!(validate_tree_work_area(0.0, 0.0, 0.0).is_err());
        assert!(validate_tree_work_area(0.0, 0.0, MIN_TREE_WORK_AREA_RADIUS - 0.01).is_err());
        assert!(validate_tree_work_area(0.0, 0.0, MAX_TREE_WORK_AREA_RADIUS + 0.01).is_err());
    }
}
