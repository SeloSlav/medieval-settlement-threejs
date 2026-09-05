//! Conserved wood mass shared by construction timber and split firewood.
pub const TREE_FALL_SECONDS: f64 = 3.5;
pub const FALLEN_TREE_WORK_SECONDS: f64 = 8.0;
pub const LOG_HEALTH_PER_TIMBER: f64 = 10.0;
pub const LOG_HEALTH_PER_FIREWOOD: f64 = 5.0;
pub const FIREWOOD_SPLIT_SECONDS: f64 = 2.0;

/// Crew approach time is physical travel, so extra labor speeds the cutting
/// rather than making a distant trunk disappear before its workers arrive.
pub fn fallen_tree_work_seconds(distance: f64, work_per_second: f64) -> f64 {
    9.5 + distance.max(0.0) / 1.1 + FALLEN_TREE_WORK_SECONDS / work_per_second.max(0.01)
}

pub fn log_health_budgets(wood_yield: f64) -> Vec<f64> {
    if !wood_yield.is_finite() || wood_yield < 1.0 { return vec![]; }
    let units = wood_yield.floor() as u32;
    let count = units.min(3);
    (0..count).map(|i| f64::from(units / count + u32::from(i < units % count)) * LOG_HEALTH_PER_TIMBER).collect()
}

pub fn wood_from_health(health: f64, requested: f64, firewood: bool) -> (f64, f64) {
    if !health.is_finite() || !requested.is_finite() { return (health, 0.0); }
    let cost = if firewood { LOG_HEALTH_PER_FIREWOOD } else { LOG_HEALTH_PER_TIMBER };
    let units = (health.max(0.0) / cost).floor().min(requested.max(0.0).floor());
    ((health - units * cost).max(0.0), units)
}

pub fn fall_direction(layout_index: u32) -> f64 { f64::from(layout_index) * 2.399963229728653 }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn split_logs_conserve_every_tree_unit() {
        for units in 1..100 {
            let logs = log_health_budgets(f64::from(units));
            assert_eq!(logs.iter().sum::<f64>(), f64::from(units) * LOG_HEALTH_PER_TIMBER);
            assert!(logs.iter().all(|h| *h >= LOG_HEALTH_PER_TIMBER));
        }
    }
    #[test]
    fn overlapping_industries_cannot_double_harvest() {
        let (health, timber) = wood_from_health(60.0, 2.0, false);
        let (health, firewood) = wood_from_health(health, 3.0, true);
        let (health, last_timber) = wood_from_health(health, 100.0, false);
        let (health, last_firewood) = wood_from_health(health, 100.0, true);
        assert_eq!(timber + last_timber, 4.0);
        assert_eq!(firewood + last_firewood, 4.0);
        assert_eq!(health, 0.0);
        assert_eq!(wood_from_health(health, 100.0, false).1, 0.0);
    }
    #[test]
    fn capacity_limits_do_not_destroy_remainder() {
        assert_eq!(wood_from_health(30.0, 1.9, false), (20.0, 1.0));
        assert_eq!(wood_from_health(5.0, 20.0, false), (5.0, 0.0));
        assert_eq!(wood_from_health(5.0, 20.0, true), (0.0, 1.0));
    }
}
