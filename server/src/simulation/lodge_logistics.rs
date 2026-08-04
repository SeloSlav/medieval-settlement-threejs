//! Pure lodge/firewood logistics helpers shared by simulation and tests.

pub fn residence_firewood_runway_seconds(
    abandoned: bool,
    population: u32,
    firewood_stock: f64,
    demand_per_person_per_sec: f64,
) -> f64 {
    if abandoned || population == 0 {
        return f64::INFINITY;
    }
    let demand = population as f64 * demand_per_person_per_sec;
    if demand <= 1e-9 {
        return f64::INFINITY;
    }
    firewood_stock / demand
}
