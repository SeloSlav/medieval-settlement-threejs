use crate::balance_generated::{
    CALENDAR_HOURS_PER_DAY, CALENDAR_SECONDS_PER_DAY, CALENDAR_WORK_END_HOUR,
    CALENDAR_WORK_START_HOUR, CIVILIAN_TOOL_IRONWORK_PER_CYCLE,
    CIVILIAN_TOOL_THROUGHPUT_MULTIPLIER, FARM_TOOL_IRONWORK_PER_WORKER_DAY,
    FARM_WORK_METERS_PER_WORKER_PER_SEC,
};

pub const CIVILIAN_TOOL_SITE_KINDS: [&str; 8] = [
    "lumber_mill",
    "woodcutters_lodge",
    "stone_quarry",
    "large_quarry",
    "mine",
    "clay_pit",
    "threshing_barn",
    "watermill",
];

pub fn is_civilian_tool_site(kind: &str) -> bool {
    CIVILIAN_TOOL_SITE_KINDS.contains(&kind)
}

pub fn civilian_tools_maintained(ironwork: f64) -> bool {
    ironwork + 1e-6 >= CIVILIAN_TOOL_IRONWORK_PER_CYCLE
}

pub fn civilian_tool_throughput_multiplier(ironwork: f64) -> f64 {
    if civilian_tools_maintained(ironwork) {
        CIVILIAN_TOOL_THROUGHPUT_MULTIPLIER
    } else {
        1.0
    }
}

pub fn farm_tools_maintained(ironwork: f64) -> bool {
    ironwork > 1e-6
}

pub fn farm_tool_throughput_multiplier(ironwork: f64) -> f64 {
    if farm_tools_maintained(ironwork) {
        CIVILIAN_TOOL_THROUGHPUT_MULTIPLIER
    } else {
        1.0
    }
}

pub fn civilian_tool_runway_cycles(ironwork: f64) -> f64 {
    if CIVILIAN_TOOL_IRONWORK_PER_CYCLE <= 1e-9 {
        f64::INFINITY
    } else {
        ironwork.max(0.0) / CIVILIAN_TOOL_IRONWORK_PER_CYCLE
    }
}

pub fn farm_tool_ironwork_for_work(completed_work: f64) -> f64 {
    let workday_seconds = CALENDAR_SECONDS_PER_DAY
        * (CALENDAR_WORK_END_HOUR - CALENDAR_WORK_START_HOUR) as f64
        / CALENDAR_HOURS_PER_DAY as f64;
    let work_per_worker_day = FARM_WORK_METERS_PER_WORKER_PER_SEC * workday_seconds;
    if work_per_worker_day <= 1e-9 {
        0.0
    } else {
        completed_work.max(0.0) / work_per_worker_day * FARM_TOOL_IRONWORK_PER_WORKER_DAY
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_worksites_keep_baseline_output() {
        assert!(!civilian_tools_maintained(0.0));
        assert_eq!(civilian_tool_throughput_multiplier(0.0), 1.0);
    }

    #[test]
    fn one_wear_batch_activates_the_bonus() {
        assert!(civilian_tools_maintained(CIVILIAN_TOOL_IRONWORK_PER_CYCLE));
        assert_eq!(
            civilian_tool_throughput_multiplier(CIVILIAN_TOOL_IRONWORK_PER_CYCLE),
            CIVILIAN_TOOL_THROUGHPUT_MULTIPLIER
        );
        assert_eq!(
            civilian_tool_runway_cycles(CIVILIAN_TOOL_IRONWORK_PER_CYCLE * 3.0),
            3.0
        );
    }

    #[test]
    fn selected_heavy_tool_sites_claim_maintenance_ironwork() {
        for kind in CIVILIAN_TOOL_SITE_KINDS {
            assert!(is_civilian_tool_site(kind));
        }
        assert!(is_civilian_tool_site("woodcutters_lodge"));
        assert!(is_civilian_tool_site("mine"));
        assert!(is_civilian_tool_site("threshing_barn"));
        assert!(is_civilian_tool_site("watermill"));
        assert!(!is_civilian_tool_site("carpenter"));
        assert!(!is_civilian_tool_site("pastoral_farmstead"));
    }

    #[test]
    fn farm_tool_wear_scales_with_completed_work_not_field_count() {
        let one_worker_day = FARM_WORK_METERS_PER_WORKER_PER_SEC
            * CALENDAR_SECONDS_PER_DAY
            * (CALENDAR_WORK_END_HOUR - CALENDAR_WORK_START_HOUR) as f64
            / CALENDAR_HOURS_PER_DAY as f64;
        assert!(
            (farm_tool_ironwork_for_work(one_worker_day) - FARM_TOOL_IRONWORK_PER_WORKER_DAY).abs()
                < 1e-9
        );
        assert!(
            (farm_tool_ironwork_for_work(one_worker_day * 0.4)
                + farm_tool_ironwork_for_work(one_worker_day * 0.6)
                - FARM_TOOL_IRONWORK_PER_WORKER_DAY)
                .abs()
                < 1e-9
        );
        assert!(farm_tools_maintained(FARM_TOOL_IRONWORK_PER_WORKER_DAY));
        assert!(!farm_tools_maintained(0.0));
        assert_eq!(
            farm_tool_throughput_multiplier(FARM_TOOL_IRONWORK_PER_WORKER_DAY),
            CIVILIAN_TOOL_THROUGHPUT_MULTIPLIER
        );
    }
}
