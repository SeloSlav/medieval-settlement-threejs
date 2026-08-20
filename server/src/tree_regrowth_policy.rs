use crate::balance_generated::{
    CALENDAR_HOURS_PER_DAY, CALENDAR_SECONDS_PER_DAY, CALENDAR_WORK_END_HOUR,
    CALENDAR_WORK_START_HOUR, NATURAL_TREE_MATURATION_DAYS, REFORESTER_REGROW_PER_SEC,
    REFORESTER_SPARSE_TREE_MATURATION_WORKDAYS, TICK_DT, TREE_REGROWTH_UPDATE_INTERVAL_SEC,
};

/// Keep a felled tree visually as a stump for the first part of succession.
pub const TREE_SAPLING_PHASE_THRESHOLD: f64 = 0.02;

pub fn tree_regrowth_step_ticks() -> u64 {
    (TREE_REGROWTH_UPDATE_INTERVAL_SEC / TICK_DT)
        .round()
        .max(1.0) as u64
}

pub fn tree_regrowth_update_due(sim_tick: u64) -> bool {
    sim_tick % tree_regrowth_step_ticks() == 0
}

pub fn tree_regrowth_step_seconds() -> f64 {
    tree_regrowth_step_ticks() as f64 * TICK_DT
}

pub fn tree_workday_seconds() -> f64 {
    CALENDAR_SECONDS_PER_DAY
        * CALENDAR_WORK_END_HOUR.saturating_sub(CALENDAR_WORK_START_HOUR) as f64
        / CALENDAR_HOURS_PER_DAY.max(1) as f64
}

pub fn natural_tree_growth_per_second() -> f64 {
    1.0 / (NATURAL_TREE_MATURATION_DAYS.max(1.0) * CALENDAR_SECONDS_PER_DAY.max(TICK_DT))
}

/// A staffed reforester owns one bounded tree-equivalent budget. The budget is
/// shared across every recovering tree in range instead of being duplicated
/// for each stump. A per-tree cap prevents one isolated tree from becoming
/// mature implausibly fast when little other planting work exists.
pub fn reforester_growth_per_tree_per_second(
    recovering_tree_count: usize,
    assigned_labor: u32,
) -> f64 {
    if recovering_tree_count == 0 || assigned_labor == 0 {
        return 0.0;
    }
    let labor = assigned_labor as f64;
    let shared_budget = REFORESTER_REGROW_PER_SEC * labor / recovering_tree_count as f64;
    let per_tree_cap = labor
        / (REFORESTER_SPARSE_TREE_MATURATION_WORKDAYS.max(1.0)
            * tree_workday_seconds().max(TICK_DT));
    shared_budget.min(per_tree_cap)
}

#[cfg(test)]
pub fn reforester_tree_equivalents_per_workday(assigned_labor: u32) -> f64 {
    REFORESTER_REGROW_PER_SEC * assigned_labor as f64 * tree_workday_seconds()
}

#[cfg(test)]
pub fn lumber_mill_trees_per_workday(
    productive_labor: f64,
    harvest_interval_seconds: f64,
    throughput_multiplier: f64,
) -> f64 {
    if productive_labor <= 0.0 || harvest_interval_seconds <= 0.0 || throughput_multiplier <= 0.0 {
        return 0.0;
    }
    tree_workday_seconds() * productive_labor * throughput_multiplier / harvest_interval_seconds
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::balance_generated::CIVILIAN_TOOL_THROUGHPUT_MULTIPLIER;

    const LUMBER_MILL_HARVEST_INTERVAL_SECONDS: f64 = 9.0;

    #[test]
    fn natural_succession_recovers_a_tree_in_six_months() {
        let progress_per_day = natural_tree_growth_per_second() * CALENDAR_SECONDS_PER_DAY;
        assert!((progress_per_day * NATURAL_TREE_MATURATION_DAYS - 1.0).abs() < 1e-9);
        assert_eq!(NATURAL_TREE_MATURATION_DAYS, 180.0);
    }

    #[test]
    fn reforester_budget_is_bounded_across_large_stump_counts() {
        let tree_count = 500;
        let total_rate = reforester_growth_per_tree_per_second(tree_count, 1) * tree_count as f64;
        assert!((total_rate - REFORESTER_REGROW_PER_SEC).abs() < 1e-9);
        assert!((reforester_tree_equivalents_per_workday(1) - 8.4).abs() < 1e-9);
    }

    #[test]
    fn sparse_managed_growth_alone_still_needs_thirty_workdays() {
        let per_tree_workday_progress =
            reforester_growth_per_tree_per_second(1, 1) * tree_workday_seconds();
        assert!(
            (per_tree_workday_progress * REFORESTER_SPARSE_TREE_MATURATION_WORKDAYS - 1.0).abs()
                < 1e-9
        );
    }

    #[test]
    fn one_forester_nearly_matches_one_feller_but_not_a_full_mill() {
        let maintained_tools = CIVILIAN_TOOL_THROUGHPUT_MULTIPLIER;
        let low_labor_demand = lumber_mill_trees_per_workday(
            1.0,
            LUMBER_MILL_HARVEST_INTERVAL_SECONDS,
            maintained_tools,
        );
        let max_labor_demand = lumber_mill_trees_per_workday(
            3.0,
            LUMBER_MILL_HARVEST_INTERVAL_SECONDS,
            maintained_tools,
        );
        let forester_capacity = reforester_tree_equivalents_per_workday(1);

        assert!((low_labor_demand - 9.333333333333334).abs() < 1e-9);
        assert!((max_labor_demand - 28.0).abs() < 1e-9);
        assert!(forester_capacity >= low_labor_demand * 0.85);
        assert!(forester_capacity < max_labor_demand * 0.35);
    }

    #[test]
    fn cadence_uses_five_second_batches_without_changing_rates() {
        assert_eq!(tree_regrowth_step_ticks(), 25);
        assert!((tree_regrowth_step_seconds() - 5.0).abs() < 1e-9);
        assert!(tree_regrowth_update_due(25));
        assert!(!tree_regrowth_update_due(24));
    }
}
