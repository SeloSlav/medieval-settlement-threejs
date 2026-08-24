use crate::balance_generated::{
    CIVILIAN_TOOL_IRONWORK_PER_CYCLE, CIVILIAN_TOOL_REORDER_CYCLES,
    CIVILIAN_TOOL_THROUGHPUT_MULTIPLIER, FARM_TOOL_IRONWORK_PER_WORKER_DAY,
};
use crate::resource_units::{whole_cost, whole_units};

pub const CIVILIAN_TOOL_SITE_KINDS: [&str; 9] = [
    "lumber_mill",
    "woodcutters_lodge",
    "stone_quarry",
    "large_quarry",
    "mine",
    "clay_pit",
    "threshing_barn",
    "watermill",
    "windmill",
];

pub fn is_civilian_tool_site(kind: &str) -> bool {
    CIVILIAN_TOOL_SITE_KINDS.contains(&kind)
}

pub fn civilian_tools_maintained(ironwork: f64) -> bool {
    whole_units(ironwork) + 1e-6 >= civilian_tool_ironwork_per_cycle()
}

/// Tool wear is posted only when a production cycle completes. Authored rates
/// are therefore converted to one indivisible replacement lot rather than
/// leaking fractional ironwork from the rack on every simulation tick.
pub fn civilian_tool_ironwork_per_cycle() -> f64 {
    whole_cost(CIVILIAN_TOOL_IRONWORK_PER_CYCLE)
}

pub fn civilian_tool_throughput_multiplier(ironwork: f64) -> f64 {
    if civilian_tools_maintained(ironwork) {
        CIVILIAN_TOOL_THROUGHPUT_MULTIPLIER
    } else {
        1.0
    }
}

pub fn farm_tools_maintained(ironwork: f64) -> bool {
    whole_units(ironwork) + 1e-6 >= farm_tool_ironwork_per_completed_stage()
}

pub fn farm_tool_throughput_multiplier(ironwork: f64) -> f64 {
    if farm_tools_maintained(ironwork) {
        CIVILIAN_TOOL_THROUGHPUT_MULTIPLIER
    } else {
        1.0
    }
}

pub fn civilian_tool_runway_cycles(ironwork: f64) -> f64 {
    let per_cycle = civilian_tool_ironwork_per_cycle();
    if per_cycle <= 1e-9 {
        f64::INFINITY
    } else {
        whole_units(ironwork) / per_cycle
    }
}

/// Tool racks use a reorder point rather than chasing every fractional wear
/// event. Once stock falls below this many cycles, one smithy cart aims for the
/// rack's physical capacity. This makes road length and reserve depth matter
/// without generating a stream of tiny top-up trips.
pub fn civilian_tool_reorder_stock(capacity: f64) -> f64 {
    let per_cycle = civilian_tool_ironwork_per_cycle();
    whole_cost(per_cycle * CIVILIAN_TOOL_REORDER_CYCLES)
        .max(per_cycle)
        .min(whole_units(capacity))
}

pub fn civilian_tool_refill_due(ironwork: f64, capacity: f64) -> bool {
    whole_units(capacity) > 0.0
        && whole_units(ironwork) + 1e-6 < civilian_tool_reorder_stock(capacity)
}

/// Field work progress is continuous, but a tool is replaced only when a
/// complete field stage is posted. The old per-worker-day rate remains the
/// balance input; rounding a positive wear lot upward prevents free partial
/// tools without draining fractions every tick.
pub fn farm_tool_ironwork_per_completed_stage() -> f64 {
    whole_cost(FARM_TOOL_IRONWORK_PER_WORKER_DAY)
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
        let wear = civilian_tool_ironwork_per_cycle();
        assert_eq!(wear.fract(), 0.0);
        assert!(civilian_tools_maintained(wear));
        assert!(!civilian_tools_maintained(wear - 0.01));
        assert_eq!(
            civilian_tool_throughput_multiplier(wear),
            CIVILIAN_TOOL_THROUGHPUT_MULTIPLIER
        );
        assert!((civilian_tool_runway_cycles(wear * 3.0) - 3.0).abs() < 1e-9);
    }

    #[test]
    fn racks_reorder_low_and_refill_in_one_substantial_load() {
        let capacity = 3.0;
        let reorder = civilian_tool_reorder_stock(capacity);
        assert_eq!(reorder, 3.0);
        assert_eq!(reorder.fract(), 0.0);
        assert!(!civilian_tool_refill_due(reorder, capacity));
        assert!(civilian_tool_refill_due(reorder - 1.0, capacity));
        assert!(civilian_tool_refill_due(2.99, capacity));
    }

    #[test]
    fn whole_wear_keeps_a_full_rack_useful_until_a_refill_arrives() {
        assert_eq!(civilian_tool_ironwork_per_cycle(), 1.0);
        assert_eq!(civilian_tool_runway_cycles(3.0), 3.0);
        assert_eq!(civilian_tool_runway_cycles(3.9), 3.0);
    }

    #[test]
    fn multi_day_cart_cadence_recovers_racks_without_idle_wear() {
        fn simulate(distance_m: f64, cycles_per_day: u32, days: u32) -> (f64, f64, u32) {
            let mut stock = 3.0;
            let mut trip_remaining = 0.0;
            let mut maintained_cycles = 0;
            let mut completed_cycles = 0;
            // The fastest heavy sites complete about two cycles per 120-second
            // game day. A three-unit rack must bridge an ordinary local cart
            // round trip at that real production cadence.
            let work_seconds = 120.0;
            let cycle_seconds = if cycles_per_day == 0 {
                work_seconds
            } else {
                work_seconds / cycles_per_day as f64
            };
            for _ in 0..days {
                for _ in 0..cycles_per_day {
                    if civilian_tools_maintained(stock) {
                        stock = (stock - civilian_tool_ironwork_per_cycle()).max(0.0);
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

        let (near_uptime, _, _) = simulate(10.0, 2, 14);
        let (far_uptime, _, _) = simulate(80.0, 2, 14);
        assert!(near_uptime > 0.99, "near smithy uptime was {near_uptime}");
        assert!(far_uptime > 0.99, "far smithy uptime was {far_uptime}");

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
        assert!(is_civilian_tool_site("windmill"));
        assert!(!is_civilian_tool_site("carpenter"));
        assert!(!is_civilian_tool_site("pastoral_farmstead"));
    }

    #[test]
    fn farm_tool_wear_posts_one_whole_unit_per_completed_stage() {
        let stage_wear = farm_tool_ironwork_per_completed_stage();
        assert_eq!(stage_wear, 1.0);
        assert!(farm_tools_maintained(stage_wear));
        assert!(!farm_tools_maintained(FARM_TOOL_IRONWORK_PER_WORKER_DAY));
        assert!(!farm_tools_maintained(0.0));
        assert_eq!(
            farm_tool_throughput_multiplier(stage_wear),
            CIVILIAN_TOOL_THROUGHPUT_MULTIPLIER
        );
    }
}
