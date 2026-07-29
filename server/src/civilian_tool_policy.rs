use crate::balance_generated::{
    CIVILIAN_TOOL_IRONWORK_PER_CYCLE, CIVILIAN_TOOL_THROUGHPUT_MULTIPLIER,
};

pub const CIVILIAN_TOOL_SITE_KINDS: [&str; 5] = [
    "lumber_mill",
    "woodcutters_lodge",
    "stone_quarry",
    "large_quarry",
    "clay_pit",
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

pub fn civilian_tool_runway_cycles(ironwork: f64) -> f64 {
    if CIVILIAN_TOOL_IRONWORK_PER_CYCLE <= 1e-9 {
        f64::INFINITY
    } else {
        ironwork.max(0.0) / CIVILIAN_TOOL_IRONWORK_PER_CYCLE
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
        assert!(!is_civilian_tool_site("carpenter"));
        assert!(!is_civilian_tool_site("threshing_barn"));
    }
}
