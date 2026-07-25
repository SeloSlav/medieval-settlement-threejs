use std::cmp::Ordering;

pub const ALE_SUPPLIER_KINDS: &[&str] = &["brewery", "monastery"];
pub const PRESERVED_FOOD_SUPPLIER_KINDS: &[&str] = &["smokehouse", "pastoral_farmstead"];

/// Prefer the shortest authoritative road route. Building id is the stable
/// tie-breaker so equal-length layouts behave identically after a reload.
pub fn compare_supply_route_candidates(
    a_distance: f64,
    a_building_id: u64,
    b_distance: f64,
    b_building_id: u64,
) -> Ordering {
    a_distance
        .total_cmp(&b_distance)
        .then_with(|| a_building_id.cmp(&b_building_id))
}

/// Lower stock per resident means less remaining runway for any one need kind.
/// Route distance and residence id make equally urgent choices efficient and
/// deterministic without letting small households jump ahead of large ones.
pub fn compare_need_delivery_candidates(
    a_stock: f64,
    a_population: u32,
    a_distance: f64,
    a_residence_id: u64,
    b_stock: f64,
    b_population: u32,
    b_distance: f64,
    b_residence_id: u64,
) -> Ordering {
    let stock_per_resident = |stock: f64, population: u32| {
        if population == 0 {
            f64::INFINITY
        } else {
            stock.max(0.0) / population as f64
        }
    };
    stock_per_resident(a_stock, a_population)
        .total_cmp(&stock_per_resident(b_stock, b_population))
        .then_with(|| a_distance.total_cmp(&b_distance))
        .then_with(|| a_residence_id.cmp(&b_residence_id))
}

#[cfg(test)]
mod tests {
    use super::{
        compare_need_delivery_candidates, compare_supply_route_candidates, ALE_SUPPLIER_KINDS,
        PRESERVED_FOOD_SUPPLIER_KINDS,
    };
    use std::cmp::Ordering;

    #[test]
    fn shorter_road_routes_are_preferred_over_older_buildings() {
        assert_eq!(
            compare_supply_route_candidates(24.0, 90, 85.0, 1),
            Ordering::Less
        );
    }

    #[test]
    fn building_id_breaks_equal_route_ties_deterministically() {
        assert_eq!(
            compare_supply_route_candidates(42.0, 3, 42.0, 7),
            Ordering::Less
        );
        assert_eq!(
            compare_supply_route_candidates(42.0, 7, 42.0, 3),
            Ordering::Greater
        );
    }

    #[test]
    fn delivery_priority_uses_runway_instead_of_raw_stock() {
        assert_eq!(
            compare_need_delivery_candidates(6.0, 6, 80.0, 9, 4.0, 2, 10.0, 1),
            Ordering::Less,
            "six units feed six people for less time than four units feed two"
        );
    }

    #[test]
    fn delivery_priority_uses_route_then_id_for_equal_runway() {
        assert_eq!(
            compare_need_delivery_candidates(4.0, 4, 20.0, 9, 2.0, 2, 50.0, 1),
            Ordering::Less
        );
        assert_eq!(
            compare_need_delivery_candidates(4.0, 4, 20.0, 3, 2.0, 2, 20.0, 7),
            Ordering::Less
        );
    }

    #[test]
    fn specialty_supplier_roles_match_actual_producers() {
        assert_eq!(ALE_SUPPLIER_KINDS, &["brewery", "monastery"]);
        assert_eq!(
            PRESERVED_FOOD_SUPPLIER_KINDS,
            &["smokehouse", "pastoral_farmstead"]
        );
        assert!(!PRESERVED_FOOD_SUPPLIER_KINDS.contains(&"granary"));
    }
}
