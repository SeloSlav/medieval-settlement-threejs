use std::cmp::Ordering;

use crate::balance_generated::{
    BREWERY_GRAIN_PER_CYCLE, HOUSEHOLD_FOOD_RESERVE_CAPACITY_FRACTION,
    HOUSEHOLD_FOOD_RESERVE_PER_CLAIM, MONASTERY_GRAIN_PER_CYCLE, WATERMILL_GRAIN_PER_CYCLE,
};
use crate::processor_output_policy::processor_input_staging_cycles;

pub const ALE_SUPPLIER_KINDS: &[&str] = &["brewery", "monastery"];
pub const PRESERVED_FOOD_SUPPLIER_KINDS: &[&str] = &["smokehouse", "pastoral_farmstead"];
pub const CLOTH_SUPPLIER_KINDS: &[&str] = &["weaver"];
/// Every non-market building that already dispatches food to households.
///
/// Marketplace caravans remain outside territorial claims because they are a
/// paid, household-prioritized emergency service rather than routine supply.
pub const FOOD_SUPPLIER_KINDS: &[&str] = &[
    "hunters_hall",
    "foragers_shed",
    "fishing_camp",
    "granary",
    "apiary",
    "vineyard",
    "pastoral_farmstead",
    "swineherd",
    "monastery",
];
pub const GRAIN_PROCESSOR_KINDS: &[&str] = &["watermill", "brewery", "monastery"];
pub const GRAIN_DISPATCH_TARGET_KINDS: &[&str] = &["watermill", "brewery", "granary", "monastery"];
pub const GRAIN_INPUT_BUFFER_CYCLES: f64 = 3.0;
/// Below one complete processing cycle, grain delivery preempts the granary's
/// ordinary household or preservation cart duty.
pub const GRAIN_CRITICAL_RUNWAY_CYCLES: f64 = 1.0;

/// Small working stock requested by grain processors. Watermills and breweries
/// follow their production stock policy; the autonomous monastery retains the
/// legacy three-cycle buffer.
pub fn grain_input_target(
    kind: &str,
    productivity: f64,
    processor_output_target_percent: u8,
) -> f64 {
    let per_cycle = match kind {
        "watermill" => WATERMILL_GRAIN_PER_CYCLE,
        "brewery" => BREWERY_GRAIN_PER_CYCLE,
        "monastery" => MONASTERY_GRAIN_PER_CYCLE * productivity.max(0.0),
        _ => 0.0,
    };
    let staging_cycles = if matches!(kind, "watermill" | "brewery") {
        processor_input_staging_cycles(processor_output_target_percent)
    } else {
        GRAIN_INPUT_BUFFER_CYCLES
    };
    per_cycle * staging_cycles
}

pub fn grain_input_runway_cycles(kind: &str, stock: f64, productivity: f64) -> f64 {
    let per_cycle = match kind {
        "watermill" => WATERMILL_GRAIN_PER_CYCLE,
        "brewery" => BREWERY_GRAIN_PER_CYCLE,
        "monastery" => MONASTERY_GRAIN_PER_CYCLE * productivity.max(0.0),
        _ => 0.0,
    };
    if per_cycle <= 1e-6 {
        f64::INFINITY
    } else {
        stock.max(0.0) / per_cycle
    }
}

/// Completed-building priorities share the construction column for additive
/// save compatibility. Invalid legacy values fall back to the normal tier.
pub fn grain_work_priority(priority: u8) -> u8 {
    match priority {
        1..=3 => priority,
        _ => 2,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum GrainDispatchDuty {
    WorkingBuffer,
    GranaryReserve,
    WorkshopOverflow,
}

/// Direct farm carts first restore active processors to their small working
/// buffer, then centralize the remaining harvest. Workshop warehouses are used
/// beyond that buffer only when no granary can receive the crop.
pub fn grain_dispatch_duty(
    kind: &str,
    assigned_labor: u32,
    stock: f64,
    desired_stock: f64,
) -> Option<GrainDispatchDuty> {
    if kind == "granary" {
        return Some(GrainDispatchDuty::GranaryReserve);
    }
    if !GRAIN_PROCESSOR_KINDS.contains(&kind) {
        return None;
    }
    let operational = assigned_labor > 0 || kind == "monastery";
    if operational && stock + 1e-6 < desired_stock {
        Some(GrainDispatchDuty::WorkingBuffer)
    } else {
        Some(GrainDispatchDuty::WorkshopOverflow)
    }
}

pub fn compare_grain_dispatch_candidates(
    a_duty: GrainDispatchDuty,
    a_work_priority: u8,
    a_runway_cycles: f64,
    a_distance: f64,
    a_building_id: u64,
    b_duty: GrainDispatchDuty,
    b_work_priority: u8,
    b_runway_cycles: f64,
    b_distance: f64,
    b_building_id: u64,
) -> Ordering {
    a_duty.cmp(&b_duty).then_with(|| {
        let work_priority_order = if a_duty == GrainDispatchDuty::WorkingBuffer {
            grain_work_priority(b_work_priority).cmp(&grain_work_priority(a_work_priority))
        } else {
            Ordering::Equal
        };
        let runway_order = if a_duty == GrainDispatchDuty::WorkingBuffer {
            a_runway_cycles.total_cmp(&b_runway_cycles)
        } else {
            Ordering::Equal
        };
        work_priority_order
            .then(runway_order)
            .then_with(|| a_distance.total_cmp(&b_distance))
            .then_with(|| a_building_id.cmp(&b_building_id))
    })
}

/// One farm cart can leave per step, so keep only the best destination.
pub fn select_grain_dispatch_candidate<T>(
    candidates: impl IntoIterator<Item = T>,
    duty_for: impl Fn(&T) -> GrainDispatchDuty,
    work_priority_for: impl Fn(&T) -> u8,
    runway_for: impl Fn(&T) -> f64,
    distance_for: impl Fn(&T) -> f64,
    building_id_for: impl Fn(&T) -> u64,
) -> Option<T> {
    candidates.into_iter().min_by(|a, b| {
        compare_grain_dispatch_candidates(
            duty_for(a),
            work_priority_for(a),
            runway_for(a),
            distance_for(a),
            building_id_for(a),
            duty_for(b),
            work_priority_for(b),
            runway_for(b),
            distance_for(b),
            building_id_for(b),
        )
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GranaryDispatchDuty {
    Households,
    Preservation,
}

/// A granary attempts both duties in policy order. The dispatch functions
/// already reject a second trip once the first succeeds, while a blocked first
/// choice falls through immediately instead of idling the granary.
pub fn granary_dispatch_order(households_first: bool) -> [GranaryDispatchDuty; 2] {
    if households_first {
        [
            GranaryDispatchDuty::Households,
            GranaryDispatchDuty::Preservation,
        ]
    } else {
        [
            GranaryDispatchDuty::Preservation,
            GranaryDispatchDuty::Households,
        ]
    }
}

pub fn is_staffed_operational_supplier(construction_complete: bool, assigned_labor: u32) -> bool {
    construction_complete && assigned_labor > 0
}

pub fn is_firewood_supplier_operational(
    kind: &str,
    construction_complete: bool,
    assigned_labor: u32,
    storehouse_accepts_firewood: bool,
) -> bool {
    is_staffed_operational_supplier(construction_complete, assigned_labor)
        && (kind == "woodcutters_lodge"
            || (kind == "village_storehouse" && storehouse_accepts_firewood))
}

pub fn is_well_supplier_operational(
    kind: &str,
    construction_complete: bool,
    assigned_labor: u32,
) -> bool {
    kind == "well" && is_staffed_operational_supplier(construction_complete, assigned_labor)
}

pub fn is_food_supplier_operational(
    kind: &str,
    construction_complete: bool,
    assigned_labor: u32,
) -> bool {
    FOOD_SUPPLIER_KINDS.contains(&kind)
        && is_specialty_supplier_operational(kind, construction_complete, assigned_labor)
}

pub fn is_specialty_supplier_operational(
    kind: &str,
    construction_complete: bool,
    assigned_labor: u32,
) -> bool {
    construction_complete && (kind == "monastery" || assigned_labor > 0)
}

/// Food kept at a routine supplier before an institution may collect surplus.
///
/// One ordinary cart load is protected for each household claimed by that
/// producer, but no more than half the source capacity. This lets remote
/// branches keep serving locally while granaries, smokehouses, and guardhouses
/// draw only from unclaimed or genuinely overflowing stock.
pub fn household_food_reserve(claimed_households: u32, source_capacity: f64) -> f64 {
    (claimed_households as f64 * HOUSEHOLD_FOOD_RESERVE_PER_CLAIM)
        .min(source_capacity.max(0.0) * HOUSEHOLD_FOOD_RESERVE_CAPACITY_FRACTION)
        .max(0.0)
}

pub fn institutional_food_surplus(
    source_stock: f64,
    claimed_households: u32,
    source_capacity: f64,
) -> f64 {
    (source_stock.max(0.0) - household_food_reserve(claimed_households, source_capacity)).max(0.0)
}

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

/// Select the single nearest route candidate in O(n) time. Supply dispatch can
/// create only one trip, so retaining and sorting the rest wastes comparisons.
pub fn select_supply_route_candidate<T>(
    candidates: impl IntoIterator<Item = T>,
    distance_for: impl Fn(&T) -> f64,
    building_id_for: impl Fn(&T) -> u64,
) -> Option<T> {
    candidates.into_iter().min_by(|a, b| {
        compare_supply_route_candidates(
            distance_for(a),
            building_id_for(a),
            distance_for(b),
            building_id_for(b),
        )
    })
}

/// Scarce seed goes to the holding with the lowest covered share of its active
/// field claim. Route length and stable id decide only equal-coverage cases, so
/// a small nearby shortage cannot repeatedly jump ahead of an empty holding.
pub fn compare_seed_grain_delivery_candidates(
    a_stock: f64,
    a_required: f64,
    a_distance: f64,
    a_building_id: u64,
    b_stock: f64,
    b_required: f64,
    b_distance: f64,
    b_building_id: u64,
) -> Ordering {
    let coverage = |stock: f64, required: f64| {
        if required <= 1e-9 {
            1.0
        } else {
            (stock.max(0.0) / required).clamp(0.0, 1.0)
        }
    };
    coverage(a_stock, a_required)
        .total_cmp(&coverage(b_stock, b_required))
        .then_with(|| a_distance.total_cmp(&b_distance))
        .then_with(|| a_building_id.cmp(&b_building_id))
}

/// One source can launch only one seed cart, so retain the best reachable
/// holding in a single pass instead of sorting the whole farm network.
pub fn select_seed_grain_delivery_candidate<T>(
    candidates: impl IntoIterator<Item = T>,
    stock_for: impl Fn(&T) -> f64,
    required_for: impl Fn(&T) -> f64,
    distance_for: impl Fn(&T) -> f64,
    building_id_for: impl Fn(&T) -> u64,
) -> Option<T> {
    candidates.into_iter().min_by(|a, b| {
        compare_seed_grain_delivery_candidates(
            stock_for(a),
            required_for(a),
            distance_for(a),
            building_id_for(a),
            stock_for(b),
            required_for(b),
            distance_for(b),
            building_id_for(b),
        )
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum ProcessorInputDispatchDuty {
    WorkingBuffer,
    WorkshopOverflow,
}

pub fn processor_input_target(per_cycle: f64, processor_output_target_percent: u8) -> f64 {
    per_cycle.max(0.0) * processor_input_staging_cycles(processor_output_target_percent)
}

pub fn processor_input_runway_cycles(stock: f64, per_cycle: f64) -> f64 {
    if per_cycle <= 1e-6 {
        f64::INFINITY
    } else {
        stock.max(0.0) / per_cycle
    }
}

pub fn processor_input_dispatch_duty(
    assigned_labor: u32,
    stock: f64,
    per_cycle: f64,
    processor_output_target_percent: u8,
) -> ProcessorInputDispatchDuty {
    if assigned_labor > 0
        && stock + 1e-6 < processor_input_target(per_cycle, processor_output_target_percent)
    {
        ProcessorInputDispatchDuty::WorkingBuffer
    } else {
        ProcessorInputDispatchDuty::WorkshopOverflow
    }
}

/// Direct producer carts first restore operating processors to a small working
/// buffer. Within that duty, completed-building work priority wins before
/// cycle runway, road distance, and stable building id. Once every active
/// buffer is covered, ordinary nearest-route overflow behavior resumes.
pub fn compare_processor_input_dispatch_candidates(
    a_duty: ProcessorInputDispatchDuty,
    a_work_priority: u8,
    a_runway_cycles: f64,
    a_distance: f64,
    a_building_id: u64,
    b_duty: ProcessorInputDispatchDuty,
    b_work_priority: u8,
    b_runway_cycles: f64,
    b_distance: f64,
    b_building_id: u64,
) -> Ordering {
    a_duty.cmp(&b_duty).then_with(|| {
        let work_priority_order = if a_duty == ProcessorInputDispatchDuty::WorkingBuffer {
            grain_work_priority(b_work_priority).cmp(&grain_work_priority(a_work_priority))
        } else {
            Ordering::Equal
        };
        let runway_order = if a_duty == ProcessorInputDispatchDuty::WorkingBuffer {
            a_runway_cycles.total_cmp(&b_runway_cycles)
        } else {
            Ordering::Equal
        };
        work_priority_order
            .then(runway_order)
            .then_with(|| a_distance.total_cmp(&b_distance))
            .then_with(|| a_building_id.cmp(&b_building_id))
    })
}

pub fn select_processor_input_dispatch_candidate<T>(
    candidates: impl IntoIterator<Item = T>,
    duty_for: impl Fn(&T) -> ProcessorInputDispatchDuty,
    work_priority_for: impl Fn(&T) -> u8,
    runway_for: impl Fn(&T) -> f64,
    distance_for: impl Fn(&T) -> f64,
    building_id_for: impl Fn(&T) -> u64,
) -> Option<T> {
    candidates.into_iter().min_by(|a, b| {
        compare_processor_input_dispatch_candidates(
            duty_for(a),
            work_priority_for(a),
            runway_for(a),
            distance_for(a),
            building_id_for(a),
            duty_for(b),
            work_priority_for(b),
            runway_for(b),
            distance_for(b),
            building_id_for(b),
        )
    })
}

/// Construction sources retain a stable service hierarchy before road
/// distance is considered. A staffed central store loads most efficiently,
/// followed by the relevant craft or producer; unstaffed stores need a free
/// settlement hauler and follow the staffed classes in the same order.
pub fn construction_source_priority(kind: &str, assigned_labor: u32) -> u8 {
    let kind_priority = match kind {
        "founders_camp" | "village_storehouse" => 0,
        "carpenter" => 1,
        "lumber_mill" | "stone_quarry" | "large_quarry" => 2,
        _ => 3,
    };
    if assigned_labor > 0 {
        kind_priority
    } else {
        kind_priority + 4
    }
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

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct NeedDeliveryCandidate {
    pub index: usize,
    pub residence_id: u64,
    pub abandoned: bool,
    pub population: u32,
    pub stock: f64,
    pub distance: f64,
    /// Paid household orders and parish relief must reach their intended home
    /// before routine lowest-runway dispatch is considered.
    pub explicit_priority: bool,
}

pub fn compare_need_delivery_candidate_records(
    a: &NeedDeliveryCandidate,
    b: &NeedDeliveryCandidate,
) -> Ordering {
    b.explicit_priority
        .cmp(&a.explicit_priority)
        .then_with(|| a.abandoned.cmp(&b.abandoned))
        .then_with(|| {
            compare_need_delivery_candidates(
                a.stock,
                a.population,
                a.distance,
                a.residence_id,
                b.stock,
                b.population,
                b.distance,
                b.residence_id,
            )
        })
}

/// Select one cart destination in O(n) time. Dispatch creates only one trip,
/// so sorting an entire claimed branch wastes route and stock queries.
pub fn select_need_delivery_candidate(
    candidates: impl IntoIterator<Item = NeedDeliveryCandidate>,
) -> Option<NeedDeliveryCandidate> {
    candidates
        .into_iter()
        .min_by(compare_need_delivery_candidate_records)
}

#[cfg(test)]
mod tests {
    use super::{
        compare_grain_dispatch_candidates, compare_need_delivery_candidate_records,
        compare_need_delivery_candidates, compare_processor_input_dispatch_candidates,
        compare_seed_grain_delivery_candidates, compare_supply_route_candidates,
        construction_source_priority, grain_dispatch_duty, grain_input_runway_cycles,
        grain_input_target, grain_work_priority, granary_dispatch_order, household_food_reserve,
        institutional_food_surplus, is_firewood_supplier_operational, is_food_supplier_operational,
        is_specialty_supplier_operational, is_well_supplier_operational,
        processor_input_dispatch_duty, processor_input_runway_cycles, processor_input_target,
        select_grain_dispatch_candidate, select_need_delivery_candidate,
        select_processor_input_dispatch_candidate, select_seed_grain_delivery_candidate,
        select_supply_route_candidate, GrainDispatchDuty, GranaryDispatchDuty,
        NeedDeliveryCandidate, ProcessorInputDispatchDuty, ALE_SUPPLIER_KINDS,
        CLOTH_SUPPLIER_KINDS, FOOD_SUPPLIER_KINDS, GRAIN_CRITICAL_RUNWAY_CYCLES,
        GRAIN_DISPATCH_TARGET_KINDS, GRAIN_INPUT_BUFFER_CYCLES, GRAIN_PROCESSOR_KINDS,
        PRESERVED_FOOD_SUPPLIER_KINDS,
    };
    use std::cmp::Ordering;
    use std::time::{Duration, Instant};

    #[test]
    fn shorter_road_routes_are_preferred_over_older_buildings() {
        assert_eq!(
            compare_supply_route_candidates(24.0, 90, 85.0, 1),
            Ordering::Less
        );
    }

    #[test]
    fn seed_grain_serves_lowest_coverage_before_shortest_route() {
        assert_eq!(
            compare_seed_grain_delivery_candidates(0.0, 40.0, 900.0, 20, 8.0, 40.0, 10.0, 1),
            Ordering::Less,
            "an empty holding must beat a nearby partially supplied one"
        );
        assert_eq!(
            compare_seed_grain_delivery_candidates(10.0, 40.0, 90.0, 20, 5.0, 20.0, 40.0, 1),
            Ordering::Greater,
            "equal coverage must use the shorter road"
        );
        assert_eq!(
            compare_seed_grain_delivery_candidates(10.0, 40.0, 40.0, 20, 5.0, 20.0, 40.0, 1),
            Ordering::Greater,
            "equal coverage and route must use stable building id"
        );
    }

    #[test]
    fn seed_grain_selection_is_single_pass_and_ratio_aware() {
        let candidates = [
            (1_u64, 8.0, 40.0, 10.0),
            (2_u64, 0.0, 80.0, 100.0),
            (3_u64, 0.0, 80.0, 20.0),
        ];
        let selected = select_seed_grain_delivery_candidate(
            candidates,
            |candidate| candidate.1,
            |candidate| candidate.2,
            |candidate| candidate.3,
            |candidate| candidate.0,
        );
        assert_eq!(selected.map(|candidate| candidate.0), Some(3));
    }

    #[test]
    fn seed_grain_selection_stays_linear_at_settlement_scale() {
        let started = Instant::now();
        let selected = select_seed_grain_delivery_candidate(
            (0_u64..100_000).map(|id| (id, (id % 97) as f64, 100.0, (100_000_u64 - id) as f64)),
            |candidate| candidate.1,
            |candidate| candidate.2,
            |candidate| candidate.3,
            |candidate| candidate.0,
        );
        assert_eq!(selected.map(|candidate| candidate.0), Some(99_910));
        assert!(
            started.elapsed() < Duration::from_millis(250),
            "100k seed candidates should remain interactive"
        );
    }

    #[test]
    fn granary_policy_orders_both_duties_without_disabling_fallback() {
        assert_eq!(
            granary_dispatch_order(true),
            [
                GranaryDispatchDuty::Households,
                GranaryDispatchDuty::Preservation
            ]
        );
        assert_eq!(
            granary_dispatch_order(false),
            [
                GranaryDispatchDuty::Preservation,
                GranaryDispatchDuty::Households
            ]
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
    fn one_pass_supply_selection_uses_route_then_stable_id() {
        let selected = select_supply_route_candidate(
            [(90_u64, 24.0), (7, 42.0), (3, 24.0)],
            |candidate| candidate.1,
            |candidate| candidate.0,
        );
        assert_eq!(selected, Some((3, 24.0)));
    }

    #[test]
    fn construction_sources_keep_their_loading_hierarchy() {
        assert_eq!(construction_source_priority("village_storehouse", 2), 0);
        assert_eq!(construction_source_priority("carpenter", 1), 1);
        assert_eq!(construction_source_priority("stone_quarry", 3), 2);
        assert_eq!(construction_source_priority("granary", 1), 3);
        assert_eq!(construction_source_priority("village_storehouse", 0), 4);
        assert_eq!(construction_source_priority("carpenter", 0), 5);
        assert_eq!(construction_source_priority("large_quarry", 0), 6);
        assert_eq!(construction_source_priority("granary", 0), 7);
    }

    #[test]
    fn grain_processors_stage_inputs_from_their_stock_policy() {
        assert_eq!(
            GRAIN_DISPATCH_TARGET_KINDS,
            &["watermill", "brewery", "granary", "monastery"]
        );
        assert_eq!(
            GRAIN_PROCESSOR_KINDS,
            &["watermill", "brewery", "monastery"]
        );
        assert_eq!(GRAIN_INPUT_BUFFER_CYCLES, 3.0);
        assert_eq!(GRAIN_CRITICAL_RUNWAY_CYCLES, 1.0);
        assert_eq!(grain_input_target("watermill", 1.0, 25), 3.0);
        assert_eq!(grain_input_target("watermill", 1.0, 50), 6.0);
        assert_eq!(grain_input_target("watermill", 1.0, 75), 9.0);
        assert_eq!(grain_input_target("watermill", 1.0, 100), 9.0);
        assert_eq!(grain_input_target("brewery", 1.0, 50), 6.0);
        assert_eq!(grain_input_target("monastery", 1.0, 25), 6.0);
        assert_eq!(grain_input_target("monastery", 0.45, 100), 2.7);
        assert_eq!(grain_input_target("granary", 1.0, 100), 0.0);
        assert_eq!(grain_input_runway_cycles("watermill", 6.0, 1.0), 2.0);
        assert_eq!(grain_input_runway_cycles("monastery", 1.8, 0.45), 2.0);
        assert_eq!(grain_work_priority(0), 2);
        assert_eq!(grain_work_priority(1), 1);
        assert_eq!(grain_work_priority(3), 3);
        assert_eq!(grain_work_priority(4), 2);
    }

    #[test]
    fn direct_processor_inputs_restore_priority_buffers_before_overflow() {
        assert_eq!(processor_input_target(2.0, 25), 2.0);
        assert_eq!(processor_input_target(2.0, 50), 4.0);
        assert_eq!(processor_input_target(2.0, 75), 6.0);
        assert_eq!(processor_input_target(2.0, 100), 6.0);
        assert_eq!(processor_input_runway_cycles(3.0, 2.0), 1.5);
        assert_eq!(
            processor_input_dispatch_duty(2, 3.0, 2.0, 50),
            ProcessorInputDispatchDuty::WorkingBuffer
        );
        assert_eq!(
            processor_input_dispatch_duty(2, 3.0, 2.0, 25),
            ProcessorInputDispatchDuty::WorkshopOverflow
        );
        assert_eq!(
            processor_input_dispatch_duty(0, 0.0, 2.0, 100),
            ProcessorInputDispatchDuty::WorkshopOverflow
        );
        assert_eq!(
            compare_processor_input_dispatch_candidates(
                ProcessorInputDispatchDuty::WorkingBuffer,
                3,
                2.5,
                100.0,
                9,
                ProcessorInputDispatchDuty::WorkingBuffer,
                1,
                0.0,
                5.0,
                1,
            ),
            Ordering::Less,
            "a high-priority working buffer must beat a shorter empty low-priority workshop"
        );
        assert_eq!(
            compare_processor_input_dispatch_candidates(
                ProcessorInputDispatchDuty::WorkingBuffer,
                1,
                2.5,
                100.0,
                9,
                ProcessorInputDispatchDuty::WorkshopOverflow,
                3,
                0.0,
                5.0,
                1,
            ),
            Ordering::Less,
            "an active working buffer must beat warehouse overflow at any tier"
        );
    }

    #[test]
    fn direct_processor_input_selection_stays_linear() {
        let started = Instant::now();
        let selected = select_processor_input_dispatch_candidate(
            (0..100_000_u64).map(|building_id| {
                (
                    building_id,
                    if building_id == 99_999 {
                        ProcessorInputDispatchDuty::WorkingBuffer
                    } else {
                        ProcessorInputDispatchDuty::WorkshopOverflow
                    },
                    2_u8,
                    (building_id % 7) as f64,
                    (100_000 - building_id) as f64,
                )
            }),
            |candidate| candidate.1,
            |candidate| candidate.2,
            |candidate| candidate.3,
            |candidate| candidate.4,
            |candidate| candidate.0,
        )
        .expect("a direct processor-input destination should be selected");
        assert_eq!(selected.0, 99_999);
        assert!(
            started.elapsed() < Duration::from_millis(100),
            "100k direct input candidates should remain a one-pass selection"
        );
    }

    #[test]
    fn farm_grain_restores_working_buffers_before_central_or_overflow_storage() {
        assert_eq!(
            grain_dispatch_duty("watermill", 2, 3.0, 9.0),
            Some(GrainDispatchDuty::WorkingBuffer)
        );
        assert_eq!(
            grain_dispatch_duty("monastery", 0, 0.0, 6.0),
            Some(GrainDispatchDuty::WorkingBuffer)
        );
        assert_eq!(
            grain_dispatch_duty("brewery", 0, 0.0, 9.0),
            Some(GrainDispatchDuty::WorkshopOverflow)
        );
        assert_eq!(
            grain_dispatch_duty("granary", 0, 0.0, 0.0),
            Some(GrainDispatchDuty::GranaryReserve)
        );
        assert_eq!(grain_dispatch_duty("marketplace", 3, 0.0, 0.0), None);
        assert_eq!(
            compare_grain_dispatch_candidates(
                GrainDispatchDuty::WorkingBuffer,
                2,
                2.0,
                80.0,
                9,
                GrainDispatchDuty::WorkingBuffer,
                2,
                2.8,
                10.0,
                1,
            ),
            Ordering::Less,
            "lower processor runway outranks a shorter cart route"
        );
        assert_eq!(
            compare_grain_dispatch_candidates(
                GrainDispatchDuty::WorkingBuffer,
                3,
                2.8,
                80.0,
                9,
                GrainDispatchDuty::WorkingBuffer,
                1,
                0.0,
                10.0,
                1,
            ),
            Ordering::Less,
            "work priority outranks processor runway during scarcity"
        );
        assert_eq!(
            compare_grain_dispatch_candidates(
                GrainDispatchDuty::GranaryReserve,
                1,
                f64::INFINITY,
                30.0,
                9,
                GrainDispatchDuty::WorkshopOverflow,
                3,
                4.0,
                5.0,
                1,
            ),
            Ordering::Less,
            "central storage outranks workshop overfilling"
        );
    }

    #[test]
    fn farm_grain_destination_selection_stays_linear() {
        let started = Instant::now();
        let selected = select_grain_dispatch_candidate(
            (0..100_000).map(|index| {
                (
                    index,
                    if index == 99_999 {
                        GrainDispatchDuty::WorkingBuffer
                    } else {
                        GrainDispatchDuty::GranaryReserve
                    },
                    if index % 3 == 0 { 3 } else { 1 },
                    (index % 7) as f64,
                    (100_000 - index) as f64,
                )
            }),
            |candidate| candidate.1,
            |candidate| candidate.2,
            |candidate| candidate.3,
            |candidate| candidate.4,
            |candidate| candidate.0 as u64,
        )
        .expect("a large harvest network should have a destination");
        assert_eq!(selected.0, 99_999);
        assert!(started.elapsed() < Duration::from_millis(100));
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
    fn explicit_market_order_beats_routine_runway_priority() {
        let routine = NeedDeliveryCandidate {
            index: 0,
            residence_id: 1,
            abandoned: false,
            population: 6,
            stock: 0.0,
            distance: 10.0,
            explicit_priority: false,
        };
        let paid_order = NeedDeliveryCandidate {
            index: 1,
            residence_id: 99,
            abandoned: false,
            population: 2,
            stock: 12.0,
            distance: 120.0,
            explicit_priority: true,
        };
        assert_eq!(
            compare_need_delivery_candidate_records(&paid_order, &routine),
            Ordering::Less
        );
        assert_eq!(
            select_need_delivery_candidate([routine, paid_order]),
            Some(paid_order)
        );
    }

    #[test]
    fn routine_delivery_prefers_occupied_homes_before_recovery_stock() {
        let abandoned = NeedDeliveryCandidate {
            index: 0,
            residence_id: 1,
            abandoned: true,
            population: 0,
            stock: 0.0,
            distance: 5.0,
            explicit_priority: false,
        };
        let occupied = NeedDeliveryCandidate {
            index: 1,
            residence_id: 2,
            abandoned: false,
            population: 4,
            stock: 8.0,
            distance: 80.0,
            explicit_priority: false,
        };
        assert_eq!(
            select_need_delivery_candidate([abandoned, occupied]),
            Some(occupied)
        );
    }

    #[test]
    fn one_pass_selection_stays_bounded_for_large_branches() {
        let started = Instant::now();
        let selected =
            select_need_delivery_candidate((0..100_000).map(|index| NeedDeliveryCandidate {
                index,
                residence_id: index as u64,
                abandoned: false,
                population: 4,
                stock: (index % 97) as f64,
                distance: (100_000 - index) as f64,
                explicit_priority: false,
            }))
            .expect("a large branch should have a destination");
        assert_eq!(selected.stock, 0.0);
        assert_eq!(selected.index, 99_910);
        assert_eq!(selected.distance, 90.0);
        let elapsed = started.elapsed();
        assert!(
            elapsed < Duration::from_millis(100),
            "100k one-pass household candidates should stay well below a simulation frame"
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
        assert_eq!(CLOTH_SUPPLIER_KINDS, &["weaver"]);
    }

    #[test]
    fn household_services_require_a_finished_staffed_supplier() {
        assert!(is_firewood_supplier_operational(
            "woodcutters_lodge",
            true,
            1,
            false
        ));
        assert!(!is_firewood_supplier_operational(
            "woodcutters_lodge",
            true,
            0,
            false
        ));
        assert!(is_firewood_supplier_operational(
            "village_storehouse",
            true,
            2,
            true
        ));
        assert!(!is_firewood_supplier_operational(
            "village_storehouse",
            true,
            2,
            false
        ));
        assert!(is_well_supplier_operational("well", true, 1));
        assert!(!is_well_supplier_operational("well", false, 1));
        assert!(is_food_supplier_operational("fishing_camp", true, 1));
        assert!(!is_food_supplier_operational("fishing_camp", true, 0));
        assert!(is_food_supplier_operational("granary", true, 2));
        assert!(is_food_supplier_operational("pastoral_farmstead", true, 1));
        assert!(is_food_supplier_operational("monastery", true, 0));
        assert!(!is_food_supplier_operational("marketplace", true, 3));
    }

    #[test]
    fn monastery_is_the_only_autonomous_specialty_supplier() {
        assert!(is_specialty_supplier_operational("monastery", true, 0));
        assert!(!is_specialty_supplier_operational("brewery", true, 0));
        assert!(is_specialty_supplier_operational("smokehouse", true, 1));
    }

    #[test]
    fn food_supplier_roster_matches_existing_physical_dispatchers() {
        assert_eq!(
            FOOD_SUPPLIER_KINDS,
            &[
                "hunters_hall",
                "foragers_shed",
                "fishing_camp",
                "granary",
                "apiary",
                "vineyard",
                "pastoral_farmstead",
                "swineherd",
                "monastery",
            ]
        );
    }

    #[test]
    fn institutional_surplus_preserves_one_cart_per_claimed_home() {
        assert_eq!(household_food_reserve(0, 120.0), 0.0);
        assert_eq!(household_food_reserve(2, 120.0), 12.0);
        assert_eq!(institutional_food_surplus(30.0, 2, 120.0), 18.0);
        assert_eq!(institutional_food_surplus(8.0, 2, 120.0), 0.0);
    }

    #[test]
    fn household_food_reserve_is_bounded_to_half_the_source_store() {
        assert_eq!(household_food_reserve(100, 120.0), 60.0);
        assert_eq!(institutional_food_surplus(120.0, 100, 120.0), 60.0);
    }

    #[test]
    fn one_pass_supply_selection_stays_bounded_for_large_networks() {
        let started = Instant::now();
        let selected = select_supply_route_candidate(
            (0..100_000_u64).map(|building_id| {
                let distance = if building_id == 99_999 {
                    1.0
                } else {
                    100.0 + building_id as f64
                };
                (building_id, distance)
            }),
            |candidate| candidate.1,
            |candidate| candidate.0,
        )
        .expect("a supply destination should be selected");
        assert_eq!(selected.0, 99_999);
        assert!(
            started.elapsed() < Duration::from_millis(250),
            "100k one-pass supply candidates should stay well below a simulation frame"
        );
    }
}
