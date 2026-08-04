use crate::balance_generated::{
    CALENDAR_HOURS_PER_DAY, CALENDAR_SECONDS_PER_DAY, CALENDAR_WORK_END_HOUR,
    CALENDAR_WORK_START_HOUR, CIVILIAN_TOOL_IRONWORK_PER_CYCLE, CIVILIAN_TOOL_REORDER_CYCLES,
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

/// Tool racks use a reorder point rather than chasing every fractional wear
/// event. Once stock falls below this many cycles, one smithy cart aims for the
/// rack's physical capacity. This makes road length and reserve depth matter
/// without generating a stream of tiny top-up trips.
pub fn civilian_tool_reorder_stock(capacity: f64) -> f64 {
    (CIVILIAN_TOOL_IRONWORK_PER_CYCLE * CIVILIAN_TOOL_REORDER_CYCLES)
        .max(CIVILIAN_TOOL_IRONWORK_PER_CYCLE)
        .min(capacity.max(0.0))
}

pub fn civilian_tool_refill_due(ironwork: f64, capacity: f64) -> bool {
    capacity > 1e-6 && ironwork.max(0.0) + 1e-6 < civilian_tool_reorder_stock(capacity)
}

pub fn civilian_tool_refill_amount(ironwork: f64, capacity: f64) -> f64 {
    if civilian_tool_refill_due(ironwork, capacity) {
        (capacity.max(0.0) - ironwork.max(0.0)).max(0.0)
    } else {
        0.0
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
        assert!(
            (civilian_tool_runway_cycles(CIVILIAN_TOOL_IRONWORK_PER_CYCLE * 3.0) - 3.0).abs()
                < 1e-9
        );
    }

    #[test]
    fn racks_reorder_low_and_refill_in_one_substantial_load() {
        let capacity = 3.0;
        let reorder = civilian_tool_reorder_stock(capacity);
        assert!((reorder - 0.6).abs() < 1e-9);
        assert!(!civilian_tool_refill_due(reorder, capacity));
        assert!(civilian_tool_refill_due(reorder - 0.01, capacity));
        assert!((civilian_tool_refill_amount(reorder - 0.01, capacity) - 2.41).abs() < 1e-9);
        assert_eq!(civilian_tool_refill_amount(capacity, capacity), 0.0);
    }

    #[test]
    fn balanced_wear_keeps_a_full_rack_useful_for_thirty_cycles() {
        assert!((CIVILIAN_TOOL_IRONWORK_PER_CYCLE - 0.1).abs() < 1e-9);
        assert!((civilian_tool_runway_cycles(3.0) - 30.0).abs() < 1e-9);
    }

    #[test]
    fn multi_day_cart_cadence_recovers_racks_without_idle_wear() {
        fn simulate(distance_m: f64, cycles_per_day: u32, days: u32) -> (f64, f64, u32) {
            let mut stock = 3.0;
            let mut trip_remaining = 0.0;
            let mut maintained_cycles = 0;
            let mut completed_cycles = 0;
            let work_seconds = 70.0;
            let cycle_seconds = if cycles_per_day == 0 {
                work_seconds
            } else {
                work_seconds / cycles_per_day as f64
            };
            for _ in 0..days {
                for _ in 0..cycles_per_day {
                    if civilian_tools_maintained(stock) {
                        stock = (stock - CIVILIAN_TOOL_IRONWORK_PER_CYCLE).max(0.0);
                        maintained_cycles += 1;
                    }
                    completed_cycles += 1;
                    if trip_remaining <= 1e-9 && civilian_tool_refill_due(stock, 3.0) {
                        // Authoritative local carts travel out and back at 2 m/s
                        // and spend eight seconds unloading one full-rack order.
                        trip_remaining = distance_m + 8.0;
                    }
                    if trip_remaining > 1e-9 {
                        trip_remaining -= cycle_seconds;
                        if trip_remaining <= 1e-9 {
                            stock = 3.0;
                        }
                    }
                }
            }
            let uptime = if completed_cycles == 0 {
                1.0
            } else {
                maintained_cycles as f64 / completed_cycles as f64
            };
            (uptime, stock, completed_cycles)
        }

        let (near_uptime, _, _) = simulate(10.0, 18, 14);
        let (far_uptime, _, _) = simulate(80.0, 18, 14);
        assert!(near_uptime > 0.9, "near smithy uptime was {near_uptime}");
        assert!(far_uptime > 0.5 && far_uptime < near_uptime);

        let (_, idle_stock, idle_cycles) = simulate(80.0, 0, 14);
        assert_eq!(idle_cycles, 0);
        assert!((idle_stock - 3.0).abs() < 1e-9);
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
