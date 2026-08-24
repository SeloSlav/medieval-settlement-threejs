use std::cmp::Ordering;

use crate::balance_generated::{
    BAKERY_FIREWOOD_PER_CYCLE, BAKERY_FLOUR_PER_CYCLE, BAKERY_WATER_PER_CYCLE,
    BREWERY_APPLES_PER_CIDER_CYCLE, BREWERY_BARLEY_PER_MALT_CYCLE,
    BREWERY_BREWING_FIREWOOD_PER_CYCLE, BREWERY_BREWING_WATER_PER_CYCLE,
    BREWERY_HONEY_PER_MEAD_CYCLE, BREWERY_MALTING_FIREWOOD_PER_CYCLE,
    BREWERY_MALTING_WATER_PER_CYCLE, BREWERY_MALT_PER_ALE_CYCLE,
    CARPENTER_CART_SERVICE_IRONWORK_PER_TRIP, CARPENTER_CART_SERVICE_TARGET_TRIPS,
    CARPENTER_CART_SERVICE_TIMBER_PER_TRIP, CHARCOAL_BURNER_FIREWOOD_PER_CYCLE,
    CIVILIAN_TOOL_IRONWORK_PER_CYCLE, COBBLER_LEATHER_PER_CYCLE,
    HOUSEHOLD_FOOD_RESERVE_CAPACITY_FRACTION, HOUSEHOLD_FOOD_RESERVE_PER_CLAIM,
    LARGE_QUARRY_TIMBER_SUPPORT_BUFFER_CYCLES, LARGE_QUARRY_TIMBER_SUPPORT_PER_CYCLE,
    LIVESTOCK_FARMSTEAD_SALT_STAGING_PER_CYCLE, MINE_TIMBER_SUPPORT_BUFFER_CYCLES,
    MINE_TIMBER_SUPPORT_PER_CYCLE, POTTER_CLAY_PER_CYCLE, POTTER_FIREWOOD_PER_CYCLE,
    POTTER_WATER_PER_CYCLE, SMITHY_CHARCOAL_PER_CYCLE, SMITHY_IRON_PER_CYCLE,
    SMITHY_WATER_PER_CYCLE, SMOKEHOUSE_FIREWOOD_PER_CYCLE, SMOKEHOUSE_FOOD_PER_CYCLE,
    SMOKEHOUSE_POTTERY_PER_CYCLE, SMOKEHOUSE_SALT_PER_CYCLE, TANNERY_FIREWOOD_PER_CYCLE,
    TANNERY_HIDES_PER_CYCLE, TANNERY_WATER_PER_CYCLE, THRESHING_SHEAVES_PER_CYCLE,
    WATERMILL_GRAIN_PER_CYCLE, WEAVER_FLAX_PER_CYCLE, WEAVER_FLAX_WATER_PER_CYCLE,
    WEAVER_WOOL_PER_CYCLE,
};
use crate::civilian_tool_policy::{civilian_tool_refill_due, is_civilian_tool_site};
use crate::processor_output_policy::processor_input_staging_cycles;
use crate::resource_units::{whole_cost, whole_units};

/// The Marketplace is the household-facing food service point. Staffed
/// granaries own and replenish its stalls after physical stock reaches storage.
pub const FOOD_SUPPLIER_KINDS: &[&str] = &["marketplace"];
/// Fresh-food producers whose stored output may be carried as genuine household
/// surplus to a granary, smokehouse, or armed company. Monastery produce is
/// estate stock: it supports the monastery itself or leaves by regional export.
pub const INSTITUTIONAL_FOOD_SOURCE_KINDS: &[&str] = &[
    "hunters_hall",
    "foragers_shed",
    "fishing_camp",
    "bakery",
    "apiary",
    "pastoral_farmstead",
    "swineherd",
];
pub const LOCAL_MATERIAL_SOURCE_KINDS: &[&str] = &[
    "stone_quarry",
    "large_quarry",
    "mine",
    "clay_pit",
    "charcoal_burner",
    "smithy",
    "potter_kiln",
    "hunters_hall",
    "marketplace",
    "tannery",
    "cobbler",
    "village_storehouse",
    "trading_post",
];
pub const GRAIN_PROCESSOR_KINDS: &[&str] = &["watermill", "windmill"];
pub const INDUSTRIAL_FIREWOOD_TARGET_KINDS: &[&str] = &[
    "bakery",
    "brewery",
    "smokehouse",
    "charcoal_burner",
    "potter_kiln",
    "tannery",
];
pub const MARKETPLACE_MATERIAL_TARGET_KINDS: &[&str] = &[
    "watermill",
    "windmill",
    "bakery",
    "brewery",
    "smokehouse",
    "weaver",
    "charcoal_burner",
    "smithy",
    "potter_kiln",
    "tannery",
    "cobbler",
    "pastoral_farmstead",
    "threshing_barn",
    "guardhouse",
];
/// Below one complete processing cycle, grain delivery preempts the granary's
/// ordinary household or preservation cart duty.
pub const GRAIN_CRITICAL_RUNWAY_CYCLES: f64 = 1.0;

/// Marketplace food bays deliberately refill in useful cart batches. Fresh
/// food spoilage otherwise opens a tiny amount of room every tick and can trap
/// the only granary worker in an endless sequence of crumb-sized round trips.
/// An empty market may still accept whatever scarce stock is available.
pub fn marketplace_refill_request(
    current_stock: f64,
    target_stock: f64,
    cart_capacity: f64,
    available_stock: f64,
) -> f64 {
    let current = current_stock.max(0.0);
    let target = target_stock.max(0.0);
    let available = available_stock.max(0.0);
    let room = (target - current).max(0.0);
    if room <= 1e-6 || available <= 1e-6 {
        return 0.0;
    }
    let useful_batch = cart_capacity.max(0.0).min(target);
    if current > 1e-6 && useful_batch > 1e-6 && room + 1e-6 < useful_batch {
        return 0.0;
    }
    room.min(available)
}

pub const CARPENTER_CART_SERVICE_TARGET_DEFAULT: u8 = CARPENTER_CART_SERVICE_TARGET_TRIPS as u8;

pub fn is_valid_carpenter_cart_service_target(target_trips: u8) -> bool {
    matches!(target_trips, 0 | 5 | 15 | 30)
}

pub fn normalize_carpenter_cart_service_target(target_trips: u8) -> u8 {
    if is_valid_carpenter_cart_service_target(target_trips) {
        target_trips
    } else {
        CARPENTER_CART_SERVICE_TARGET_DEFAULT
    }
}

pub fn carpenter_cart_service_timber_target(target_trips: u8) -> f64 {
    whole_cost(
        CARPENTER_CART_SERVICE_TIMBER_PER_TRIP
            * normalize_carpenter_cart_service_target(target_trips) as f64,
    )
}

pub fn carpenter_cart_service_ironwork_target(target_trips: u8) -> f64 {
    whole_cost(
        CARPENTER_CART_SERVICE_IRONWORK_PER_TRIP
            * normalize_carpenter_cart_service_target(target_trips) as f64,
    )
}

pub fn carpenter_cart_service_trips_available(timber: f64, ironwork: f64) -> u32 {
    let timber_per_trip = whole_cost(CARPENTER_CART_SERVICE_TIMBER_PER_TRIP);
    let ironwork_per_trip = whole_cost(CARPENTER_CART_SERVICE_IRONWORK_PER_TRIP);
    if timber_per_trip <= 0.0 || ironwork_per_trip <= 0.0 {
        return 0;
    }
    let timber_trips = (whole_units(timber) / timber_per_trip).floor();
    let ironwork_trips = (whole_units(ironwork) / ironwork_per_trip).floor();
    timber_trips.min(ironwork_trips).clamp(0.0, u32::MAX as f64) as u32
}

pub fn carpenter_cart_service_ready(target_trips: u8, timber: f64, ironwork: f64) -> bool {
    normalize_carpenter_cart_service_target(target_trips) > 0
        && carpenter_cart_service_trips_available(timber, ironwork) > 0
}

/// A carpenter's small wheel, axle, pin, and fitting buffer is service stock,
/// not spare construction inventory. Building carts may draw only the excess.
pub fn construction_source_available_stock(
    kind: &str,
    cart_service_target_trips: u8,
    commodity: &str,
    stock: f64,
) -> f64 {
    let reserve = match (kind, commodity) {
        ("carpenter", "timber") => carpenter_cart_service_timber_target(cart_service_target_trips),
        ("carpenter", "ironwork") => {
            carpenter_cart_service_ironwork_target(cart_service_target_trips)
        }
        _ => 0.0,
    };
    (whole_units(stock) - reserve).max(0.0)
}

/// Deep stone chambers use bedrock pillars for most permanent support, but
/// still consume prepared timber columns and working cribs while a new face is
/// undercut. The larger buffer offsets the quarry's faster, six-person cycle.
pub fn large_quarry_support_target() -> f64 {
    whole_cost(LARGE_QUARRY_TIMBER_SUPPORT_PER_CYCLE * LARGE_QUARRY_TIMBER_SUPPORT_BUFFER_CYCLES)
}

pub fn large_quarry_support_runway_cycles(timber: f64) -> f64 {
    let per_cycle = whole_cost(LARGE_QUARRY_TIMBER_SUPPORT_PER_CYCLE);
    if per_cycle <= 1e-9 {
        return 0.0;
    }
    whole_units(timber) / per_cycle
}

pub fn large_quarry_supports_ready(timber: f64) -> bool {
    large_quarry_support_runway_cycles(timber) + 1e-9 >= 1.0
}

/// Rich mineral seams represent deep, non-depleting workings. They require one
/// complete timber-crib batch before labor can safely advance extraction.
/// Ordinary finite seams remain support-free surface workings.
pub fn rich_mine_support_target() -> f64 {
    whole_cost(MINE_TIMBER_SUPPORT_PER_CYCLE * MINE_TIMBER_SUPPORT_BUFFER_CYCLES)
}

pub fn rich_mine_support_runway_cycles(timber: f64) -> f64 {
    let per_cycle = whole_cost(MINE_TIMBER_SUPPORT_PER_CYCLE);
    if per_cycle <= 1e-9 {
        return 0.0;
    }
    whole_units(timber) / per_cycle
}

pub fn rich_mine_supports_ready(timber: f64) -> bool {
    rich_mine_support_runway_cycles(timber) + 1e-9 >= 1.0
}

/// Small working stock requested by grain processors.
pub fn grain_input_target(
    kind: &str,
    _productivity: f64,
    processor_output_target_percent: u8,
) -> f64 {
    let per_cycle = match kind {
        "watermill" | "windmill" => WATERMILL_GRAIN_PER_CYCLE,
        _ => 0.0,
    };
    let staging_cycles = processor_input_staging_cycles(processor_output_target_percent);
    whole_cost(per_cycle * staging_cycles)
}

pub fn grain_input_runway_cycles(kind: &str, stock: f64, _productivity: f64) -> f64 {
    let per_cycle = match kind {
        "watermill" | "windmill" => WATERMILL_GRAIN_PER_CYCLE,
        _ => 0.0,
    };
    let per_cycle = whole_cost(per_cycle);
    if per_cycle <= 1e-6 {
        f64::INFINITY
    } else {
        whole_units(stock) / per_cycle
    }
}

/// Legacy completed-building values are neutralized so construction intent
/// cannot affect operating cart routes.
pub fn grain_work_priority(_priority: u8) -> u8 {
    2
}

pub fn compare_grain_dispatch_candidates(
    a_work_priority: u8,
    a_runway_cycles: f64,
    a_distance: f64,
    a_building_id: u64,
    b_work_priority: u8,
    b_runway_cycles: f64,
    b_distance: f64,
    b_building_id: u64,
) -> Ordering {
    grain_work_priority(b_work_priority)
        .cmp(&grain_work_priority(a_work_priority))
        .then_with(|| a_runway_cycles.total_cmp(&b_runway_cycles))
        .then_with(|| a_distance.total_cmp(&b_distance))
        .then_with(|| a_building_id.cmp(&b_building_id))
}

/// One farm cart can leave per step, so keep only the best destination.
pub fn select_grain_dispatch_candidate<T>(
    candidates: impl IntoIterator<Item = T>,
    work_priority_for: impl Fn(&T) -> u8,
    runway_for: impl Fn(&T) -> f64,
    distance_for: impl Fn(&T) -> f64,
    building_id_for: impl Fn(&T) -> u64,
) -> Option<T> {
    candidates.into_iter().min_by(|a, b| {
        compare_grain_dispatch_candidates(
            work_priority_for(a),
            runway_for(a),
            distance_for(a),
            building_id_for(a),
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

pub fn is_well_supplier_operational(
    kind: &str,
    construction_complete: bool,
    _assigned_labor: u32,
) -> bool {
    kind == "well" && construction_complete
}

pub fn is_food_supplier_operational(
    kind: &str,
    construction_complete: bool,
    _assigned_labor: u32,
) -> bool {
    FOOD_SUPPLIER_KINDS.contains(&kind) && construction_complete
}

/// Food kept at a routine supplier before an institution may collect surplus.
///
/// One ordinary allocation batch is protected for each household claimed by
/// that Marketplace, but no more than half the source capacity. This lets
/// remote branches keep serving locally while granaries, smokehouses, and
/// guardhouses draw only from unclaimed or genuinely overflowing stock.
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

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum InstitutionalFoodDispatchDuty {
    CriticalGuard,
    PreservationBuffer,
    GuardReserve,
    GranaryIntake,
}

/// Compare a physical fresh-food cart's possible destinations.
///
/// A company below its three-day emergency floor is the only demand that can
/// outrank preservation. Otherwise staffed smokehouses secure their small
/// working batch before ordinary company reserves and granary centralization.
/// Player-set work/company priority leads within each non-emergency duty, then
/// the lowest stock runway, shortest road, and stable ids keep the result
/// efficient and deterministic.
pub fn compare_institutional_food_dispatch_candidates(
    a_duty: InstitutionalFoodDispatchDuty,
    a_priority: u8,
    a_runway: f64,
    a_distance: f64,
    a_target_id: u64,
    a_source_id: u64,
    b_duty: InstitutionalFoodDispatchDuty,
    b_priority: u8,
    b_runway: f64,
    b_distance: f64,
    b_target_id: u64,
    b_source_id: u64,
) -> Ordering {
    a_duty.cmp(&b_duty).then_with(|| {
        let priority_order = if a_duty == InstitutionalFoodDispatchDuty::CriticalGuard {
            Ordering::Equal
        } else {
            grain_work_priority(b_priority).cmp(&grain_work_priority(a_priority))
        };
        priority_order
            .then_with(|| a_runway.total_cmp(&b_runway))
            .then_with(|| a_distance.total_cmp(&b_distance))
            .then_with(|| a_target_id.cmp(&b_target_id))
            .then_with(|| a_source_id.cmp(&b_source_id))
    })
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
    CentralStorage,
    WorkshopOverflow,
}

/// Per-cycle demand used by carts that proactively leave a producer.
///
/// A zero result deliberately marks storage/export overflow, so pottery fills
/// staffed smokehouse vessel buffers before a nearer marketplace can claim it.
pub fn directly_dispatched_processor_input_per_cycle(target_kind: &str, commodity: &str) -> f64 {
    let authored_cost = match (target_kind, commodity) {
        (kind, "ironwork") if is_civilian_tool_site(kind) => CIVILIAN_TOOL_IRONWORK_PER_CYCLE,
        ("bakery", "firewood") => BAKERY_FIREWOOD_PER_CYCLE,
        ("bakery", "water") => BAKERY_WATER_PER_CYCLE,
        ("brewery", "firewood") => {
            BREWERY_MALTING_FIREWOOD_PER_CYCLE + BREWERY_BREWING_FIREWOOD_PER_CYCLE
        }
        ("smokehouse", "firewood") => SMOKEHOUSE_FIREWOOD_PER_CYCLE,
        ("charcoal_burner", "firewood") => CHARCOAL_BURNER_FIREWOOD_PER_CYCLE,
        ("potter_kiln", "firewood") => POTTER_FIREWOOD_PER_CYCLE,
        ("watermill" | "windmill", "ryeGrain" | "maslinGrain") => WATERMILL_GRAIN_PER_CYCLE,
        ("threshing_barn", "ryeSheaves" | "oatSheaves" | "barleySheaves" | "maslinSheaves") => {
            THRESHING_SHEAVES_PER_CYCLE
        }
        ("bakery", "ryeFlour" | "maslinFlour") => BAKERY_FLOUR_PER_CYCLE,
        ("smokehouse", "food" | "meat" | "fish" | "milk") => SMOKEHOUSE_FOOD_PER_CYCLE,
        ("smokehouse", "pottery") => SMOKEHOUSE_POTTERY_PER_CYCLE,
        ("smokehouse", "salt") => SMOKEHOUSE_SALT_PER_CYCLE,
        ("pastoral_farmstead", "salt") => LIVESTOCK_FARMSTEAD_SALT_STAGING_PER_CYCLE,
        ("weaver", "wool") => WEAVER_WOOL_PER_CYCLE,
        ("weaver", "flax") => WEAVER_FLAX_PER_CYCLE,
        ("weaver", "water") => WEAVER_FLAX_WATER_PER_CYCLE,
        ("brewery", "barley") => BREWERY_BARLEY_PER_MALT_CYCLE,
        ("brewery", "malt") => BREWERY_MALT_PER_ALE_CYCLE,
        ("brewery", "apples") => BREWERY_APPLES_PER_CIDER_CYCLE,
        ("brewery", "honey") => BREWERY_HONEY_PER_MEAD_CYCLE,
        ("brewery", "water") => BREWERY_MALTING_WATER_PER_CYCLE + BREWERY_BREWING_WATER_PER_CYCLE,
        ("potter_kiln", "clay") => POTTER_CLAY_PER_CYCLE,
        ("potter_kiln", "water") => POTTER_WATER_PER_CYCLE,
        ("tannery", "hides") => TANNERY_HIDES_PER_CYCLE,
        ("tannery", "water") => TANNERY_WATER_PER_CYCLE,
        ("tannery", "firewood") => TANNERY_FIREWOOD_PER_CYCLE,
        ("cobbler", "leather") => COBBLER_LEATHER_PER_CYCLE,
        ("smithy", "charcoal") => SMITHY_CHARCOAL_PER_CYCLE,
        ("smithy", "iron") => SMITHY_IRON_PER_CYCLE,
        ("smithy", "water") => SMITHY_WATER_PER_CYCLE,
        _ => 0.0,
    };
    whole_cost(authored_cost)
}

pub fn processor_input_target(per_cycle: f64, processor_output_target_percent: u8) -> f64 {
    whole_cost(per_cycle.max(0.0) * processor_input_staging_cycles(processor_output_target_percent))
}

pub fn processor_input_runway_cycles(stock: f64, per_cycle: f64) -> f64 {
    let per_cycle = whole_cost(per_cycle);
    if per_cycle <= 1e-6 {
        f64::INFINITY
    } else {
        whole_units(stock) / per_cycle
    }
}

pub fn processor_input_dispatch_duty(
    assigned_labor: u32,
    stock: f64,
    per_cycle: f64,
    processor_output_target_percent: u8,
) -> ProcessorInputDispatchDuty {
    if assigned_labor > 0
        && whole_units(stock) + 1e-6
            < processor_input_target(per_cycle, processor_output_target_percent)
    {
        ProcessorInputDispatchDuty::WorkingBuffer
    } else {
        ProcessorInputDispatchDuty::WorkshopOverflow
    }
}

/// Flour should take the shortest productive route first: a staffed bakery's
/// working buffer beats storage, while a staffed granary beats overfilling a
/// bakery warehouse. Bakery overflow remains a last resort when no central
/// flour store can receive the mill's surplus.
pub fn processor_input_dispatch_duty_for_target(
    target_kind: &str,
    commodity: &str,
    assigned_labor: u32,
    stock: f64,
    per_cycle: f64,
    processor_output_target_percent: u8,
) -> ProcessorInputDispatchDuty {
    if target_kind == "granary" && matches!(commodity, "ryeFlour" | "maslinFlour") {
        ProcessorInputDispatchDuty::CentralStorage
    } else {
        processor_input_dispatch_duty(
            assigned_labor,
            stock,
            per_cycle,
            processor_output_target_percent,
        )
    }
}

/// Resolve the physical destination stock target for a local material cart.
///
/// Raw iron and salt are deliberately bounded: active processors receive only
/// their selected working buffer, then a staffed Trading Post may centralize
/// the remainder up to its player-selected reserve. Civilian tool racks use
/// separate low-stock/full-refill hysteresis; other materials retain ordinary
/// workshop-overflow behavior.
pub fn local_material_dispatch_target(
    target_kind: &str,
    commodity: &str,
    assigned_labor: u32,
    stock: f64,
    capacity: f64,
    processor_output_target_percent: u8,
    marketplace_reserve_target: f64,
) -> Option<(ProcessorInputDispatchDuty, f64)> {
    let stock = whole_units(stock);
    let capacity = whole_units(capacity);
    let is_raw_market_material = matches!(commodity, "iron" | "salt");

    if commodity == "ironwork" && is_civilian_tool_site(target_kind) {
        if !civilian_tool_refill_due(stock, capacity) {
            return None;
        }
        let duty = if assigned_labor > 0 {
            ProcessorInputDispatchDuty::WorkingBuffer
        } else {
            ProcessorInputDispatchDuty::WorkshopOverflow
        };
        return Some((duty, capacity));
    }

    if is_raw_market_material && target_kind == "trading_post" {
        let desired_stock = whole_units(marketplace_reserve_target).min(capacity);
        return (assigned_labor > 0 && stock + 1e-6 < desired_stock)
            .then_some((ProcessorInputDispatchDuty::WorkshopOverflow, desired_stock));
    }

    let per_cycle = directly_dispatched_processor_input_per_cycle(target_kind, commodity);
    let duty = processor_input_dispatch_duty(
        assigned_labor,
        stock,
        per_cycle,
        processor_output_target_percent,
    );
    if is_raw_market_material && duty != ProcessorInputDispatchDuty::WorkingBuffer {
        return None;
    }
    let desired_stock = if duty == ProcessorInputDispatchDuty::WorkingBuffer {
        processor_input_target(per_cycle, processor_output_target_percent)
    } else {
        capacity
    };
    (desired_stock > 1e-6 && stock + 1e-6 < desired_stock).then_some((duty, desired_stock))
}

/// Direct producer carts first restore operating processors to a small working
/// buffer. Within that duty, input preference, cycle runway, road distance,
/// and stable building id decide.
/// Once every active buffer is covered, central flour storage wins before
/// ordinary nearest-route workshop overflow behavior resumes.
pub fn compare_processor_input_dispatch_candidates(
    a_duty: ProcessorInputDispatchDuty,
    a_work_priority: u8,
    a_input_preference_rank: u8,
    a_runway_cycles: f64,
    a_distance: f64,
    a_building_id: u64,
    b_duty: ProcessorInputDispatchDuty,
    b_work_priority: u8,
    b_input_preference_rank: u8,
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
        let input_preference_order = if a_duty == ProcessorInputDispatchDuty::WorkingBuffer {
            a_input_preference_rank.cmp(&b_input_preference_rank)
        } else {
            Ordering::Equal
        };
        let runway_order = if a_duty == ProcessorInputDispatchDuty::WorkingBuffer {
            a_runway_cycles.total_cmp(&b_runway_cycles)
        } else {
            Ordering::Equal
        };
        work_priority_order
            .then(input_preference_order)
            .then(runway_order)
            .then_with(|| a_distance.total_cmp(&b_distance))
            .then_with(|| a_building_id.cmp(&b_building_id))
    })
}

pub fn select_processor_input_dispatch_candidate<T>(
    candidates: impl IntoIterator<Item = T>,
    duty_for: impl Fn(&T) -> ProcessorInputDispatchDuty,
    work_priority_for: impl Fn(&T) -> u8,
    input_preference_for: impl Fn(&T) -> u8,
    runway_for: impl Fn(&T) -> f64,
    distance_for: impl Fn(&T) -> f64,
    building_id_for: impl Fn(&T) -> u64,
) -> Option<T> {
    candidates.into_iter().min_by(|a, b| {
        compare_processor_input_dispatch_candidates(
            duty_for(a),
            work_priority_for(a),
            input_preference_for(a),
            runway_for(a),
            distance_for(a),
            building_id_for(a),
            duty_for(b),
            work_priority_for(b),
            input_preference_for(b),
            runway_for(b),
            distance_for(b),
            building_id_for(b),
        )
    })
}

/// Construction sources retain a stable storage hierarchy before road
/// distance is considered. Staffed sources lead their class; unstaffed yards
/// remain usable through a free handcart worker after staffed options.
pub fn construction_source_priority(kind: &str, assigned_labor: u32) -> u8 {
    let kind_priority = match kind {
        "founders_camp" | "salvage_pile" | "village_storehouse" => 0,
        "carpenter" => 1,
        "lumber_mill" | "stone_quarry" | "large_quarry" => 2,
        _ => 3,
    };
    kind_priority + if assigned_labor > 0 { 0 } else { 4 }
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
        carpenter_cart_service_ironwork_target, carpenter_cart_service_ready,
        carpenter_cart_service_timber_target, carpenter_cart_service_trips_available,
        compare_grain_dispatch_candidates, compare_institutional_food_dispatch_candidates,
        compare_need_delivery_candidate_records, compare_need_delivery_candidates,
        compare_processor_input_dispatch_candidates, compare_seed_grain_delivery_candidates,
        compare_supply_route_candidates, construction_source_available_stock,
        construction_source_priority, directly_dispatched_processor_input_per_cycle,
        grain_input_runway_cycles, grain_input_target, grain_work_priority, granary_dispatch_order,
        household_food_reserve, institutional_food_surplus, is_food_supplier_operational,
        is_well_supplier_operational, large_quarry_support_runway_cycles,
        large_quarry_support_target, large_quarry_supports_ready, local_material_dispatch_target,
        marketplace_refill_request, processor_input_dispatch_duty,
        processor_input_dispatch_duty_for_target, processor_input_runway_cycles,
        processor_input_target, rich_mine_support_runway_cycles, rich_mine_support_target,
        rich_mine_supports_ready, select_grain_dispatch_candidate, select_need_delivery_candidate,
        select_processor_input_dispatch_candidate, select_seed_grain_delivery_candidate,
        select_supply_route_candidate, GranaryDispatchDuty, InstitutionalFoodDispatchDuty,
        NeedDeliveryCandidate, ProcessorInputDispatchDuty, FOOD_SUPPLIER_KINDS,
        GRAIN_CRITICAL_RUNWAY_CYCLES, GRAIN_PROCESSOR_KINDS, INDUSTRIAL_FIREWOOD_TARGET_KINDS,
        INSTITUTIONAL_FOOD_SOURCE_KINDS, LOCAL_MATERIAL_SOURCE_KINDS,
        MARKETPLACE_MATERIAL_TARGET_KINDS,
    };
    use std::cmp::Ordering;
    use std::time::{Duration, Instant};

    #[test]
    fn rich_mines_stage_three_complete_timber_support_cycles() {
        assert_eq!(rich_mine_support_target(), 3.0);
        assert_eq!(rich_mine_support_target().fract(), 0.0);
        assert_eq!(rich_mine_support_runway_cycles(0.0), 0.0);
        assert_eq!(rich_mine_support_runway_cycles(3.0), 3.0);
        assert!(!rich_mine_supports_ready(0.99));
        assert!(rich_mine_supports_ready(1.0));
    }

    #[test]
    fn marketplace_refills_wait_for_a_useful_cart_without_stranding_scarcity() {
        assert_eq!(marketplace_refill_request(95.92, 96.0, 6.0, 40.0), 0.0);
        assert!((marketplace_refill_request(90.0, 96.0, 6.0, 40.0) - 6.0).abs() < 1e-9);
        assert!((marketplace_refill_request(0.0, 96.0, 6.0, 0.2) - 0.2).abs() < 1e-9);
        assert_eq!(marketplace_refill_request(0.0, 96.0, 6.0, 0.0), 0.0);
    }

    #[test]
    fn large_quarries_stage_six_lighter_timber_support_cycles() {
        assert_eq!(large_quarry_support_target(), 6.0);
        assert_eq!(large_quarry_support_target().fract(), 0.0);
        assert_eq!(large_quarry_support_runway_cycles(6.0), 6.0);
        assert!(!large_quarry_supports_ready(0.99));
        assert!(large_quarry_supports_ready(1.0));
    }

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
    fn institutional_food_protects_emergencies_then_preservation() {
        use InstitutionalFoodDispatchDuty::{
            CriticalGuard, GranaryIntake, GuardReserve, PreservationBuffer,
        };
        assert_eq!(
            INSTITUTIONAL_FOOD_SOURCE_KINDS,
            &[
                "hunters_hall",
                "foragers_shed",
                "fishing_camp",
                "bakery",
                "apiary",
                "pastoral_farmstead",
                "swineherd",
            ]
        );
        assert_eq!(
            compare_institutional_food_dispatch_candidates(
                CriticalGuard,
                1,
                2.9,
                400.0,
                40,
                4,
                PreservationBuffer,
                3,
                0.0,
                10.0,
                10,
                1,
            ),
            Ordering::Less,
            "a critical company must beat even a high-priority nearby smokehouse"
        );
        assert_eq!(
            compare_institutional_food_dispatch_candidates(
                PreservationBuffer,
                1,
                0.0,
                400.0,
                40,
                4,
                GuardReserve,
                3,
                0.0,
                10.0,
                10,
                1,
            ),
            Ordering::Less
        );
        assert_eq!(
            compare_institutional_food_dispatch_candidates(
                GuardReserve,
                1,
                1.0,
                400.0,
                40,
                4,
                GranaryIntake,
                3,
                0.0,
                10.0,
                10,
                1,
            ),
            Ordering::Less
        );
    }

    #[test]
    fn institutional_food_ignores_legacy_priority_then_uses_runway_and_route() {
        let duty = InstitutionalFoodDispatchDuty::PreservationBuffer;
        assert_eq!(
            compare_institutional_food_dispatch_candidates(
                duty, 3, 2.0, 500.0, 9, 90, duty, 2, 0.0, 5.0, 1, 1,
            ),
            Ordering::Greater,
            "legacy completed-building priority must not override runway"
        );
        assert_eq!(
            compare_institutional_food_dispatch_candidates(
                duty, 2, 0.5, 500.0, 9, 90, duty, 2, 1.0, 5.0, 1, 1,
            ),
            Ordering::Less,
            "lowest runway must lead"
        );
        assert_eq!(
            compare_institutional_food_dispatch_candidates(
                duty, 2, 1.0, 20.0, 9, 90, duty, 2, 1.0, 50.0, 1, 1,
            ),
            Ordering::Less,
            "the shorter road must break an equal policy tie"
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
    fn carpenter_service_stock_backs_real_accelerated_departures() {
        assert_eq!(carpenter_cart_service_timber_target(15), 15.0);
        assert_eq!(carpenter_cart_service_ironwork_target(15), 15.0);
        assert_eq!(carpenter_cart_service_timber_target(0), 0.0);
        assert_eq!(carpenter_cart_service_ironwork_target(0), 0.0);
        assert_eq!(carpenter_cart_service_trips_available(15.0, 15.0), 15);
        assert_eq!(carpenter_cart_service_trips_available(15.0, 0.99), 0);
        assert!(!carpenter_cart_service_ready(15, 0.99, 4.0));
        assert!(carpenter_cart_service_ready(15, 1.0, 1.0));
        assert!(!carpenter_cart_service_ready(0, 15.0, 15.0));
    }

    #[test]
    fn construction_carts_leave_the_carpenter_service_buffer_at_the_shop() {
        assert!(
            (construction_source_available_stock("carpenter", 15, "timber", 20.0) - 5.0).abs()
                < 1e-9
        );
        assert!(
            (construction_source_available_stock("carpenter", 15, "ironwork", 18.0) - 3.0).abs()
                < 1e-9
        );
        assert_eq!(
            construction_source_available_stock("carpenter", 15, "timber", 2.0),
            0.0
        );
        assert_eq!(
            construction_source_available_stock("carpenter", 0, "timber", 2.0),
            2.0
        );
        assert_eq!(
            construction_source_available_stock("lumber_mill", 30, "timber", 2.0),
            2.0
        );
    }

    #[test]
    fn grain_processors_stage_inputs_from_their_stock_policy() {
        assert_eq!(GRAIN_PROCESSOR_KINDS, &["watermill", "windmill"]);
        assert_eq!(GRAIN_CRITICAL_RUNWAY_CYCLES, 1.0);
        assert_eq!(grain_input_target("watermill", 1.0, 25), 3.0);
        assert_eq!(grain_input_target("watermill", 1.0, 50), 6.0);
        assert_eq!(grain_input_target("watermill", 1.0, 75), 9.0);
        assert_eq!(grain_input_target("watermill", 1.0, 100), 9.0);
        assert_eq!(grain_input_target("windmill", 1.0, 100), 9.0);
        assert_eq!(grain_input_target("brewery", 1.0, 50), 0.0);
        assert_eq!(grain_input_target("granary", 1.0, 100), 0.0);
        assert_eq!(grain_input_runway_cycles("watermill", 6.0, 1.0), 2.0);
        assert_eq!(grain_work_priority(0), 2);
        assert_eq!(grain_work_priority(1), 2);
        assert_eq!(grain_work_priority(3), 2);
        assert_eq!(grain_work_priority(4), 2);
    }

    #[test]
    fn direct_processor_inputs_restore_priority_buffers_before_overflow() {
        assert_eq!(
            LOCAL_MATERIAL_SOURCE_KINDS,
            &[
                "stone_quarry",
                "large_quarry",
                "mine",
                "clay_pit",
                "charcoal_burner",
                "smithy",
                "potter_kiln",
                "hunters_hall",
                "marketplace",
                "tannery",
                "cobbler",
                "village_storehouse",
                "trading_post",
            ],
        );
        assert_eq!(
            INDUSTRIAL_FIREWOOD_TARGET_KINDS,
            &[
                "bakery",
                "brewery",
                "smokehouse",
                "charcoal_burner",
                "potter_kiln",
                "tannery",
            ]
        );
        assert_eq!(
            directly_dispatched_processor_input_per_cycle("bakery", "firewood"),
            super::BAKERY_FIREWOOD_PER_CYCLE,
        );
        assert_eq!(
            directly_dispatched_processor_input_per_cycle("brewery", "firewood"),
            super::BREWERY_MALTING_FIREWOOD_PER_CYCLE + super::BREWERY_BREWING_FIREWOOD_PER_CYCLE,
        );
        assert_eq!(
            directly_dispatched_processor_input_per_cycle("smokehouse", "firewood"),
            super::SMOKEHOUSE_FIREWOOD_PER_CYCLE,
        );
        assert_eq!(
            directly_dispatched_processor_input_per_cycle("charcoal_burner", "firewood"),
            super::CHARCOAL_BURNER_FIREWOOD_PER_CYCLE,
        );
        assert_eq!(
            directly_dispatched_processor_input_per_cycle("potter_kiln", "firewood"),
            super::POTTER_FIREWOOD_PER_CYCLE,
        );
        assert_eq!(
            directly_dispatched_processor_input_per_cycle("potter_kiln", "clay"),
            3.0,
        );
        assert_eq!(
            directly_dispatched_processor_input_per_cycle("tannery", "hides"),
            super::TANNERY_HIDES_PER_CYCLE,
        );
        assert_eq!(
            directly_dispatched_processor_input_per_cycle("tannery", "firewood"),
            super::TANNERY_FIREWOOD_PER_CYCLE,
        );
        assert_eq!(
            directly_dispatched_processor_input_per_cycle("cobbler", "leather"),
            super::COBBLER_LEATHER_PER_CYCLE,
        );
        assert_eq!(
            directly_dispatched_processor_input_per_cycle("smithy", "iron"),
            super::SMITHY_IRON_PER_CYCLE,
        );
        assert_eq!(
            directly_dispatched_processor_input_per_cycle("smokehouse", "salt"),
            super::SMOKEHOUSE_SALT_PER_CYCLE,
        );
        assert_eq!(
            directly_dispatched_processor_input_per_cycle("pastoral_farmstead", "salt"),
            1.0,
        );
        assert_eq!(
            MARKETPLACE_MATERIAL_TARGET_KINDS,
            &[
                "watermill",
                "windmill",
                "bakery",
                "brewery",
                "smokehouse",
                "weaver",
                "charcoal_burner",
                "smithy",
                "potter_kiln",
                "tannery",
                "cobbler",
                "pastoral_farmstead",
                "threshing_barn",
                "guardhouse",
            ],
        );
        assert_eq!(
            directly_dispatched_processor_input_per_cycle("watermill", "ryeGrain"),
            super::WATERMILL_GRAIN_PER_CYCLE,
        );
        for sheaves in ["ryeSheaves", "oatSheaves", "barleySheaves", "maslinSheaves"] {
            assert_eq!(
                directly_dispatched_processor_input_per_cycle("threshing_barn", sheaves),
                super::THRESHING_SHEAVES_PER_CYCLE,
            );
        }
        assert_eq!(
            directly_dispatched_processor_input_per_cycle("bakery", "water"),
            super::BAKERY_WATER_PER_CYCLE,
        );
        assert_eq!(
            directly_dispatched_processor_input_per_cycle("brewery", "malt"),
            super::BREWERY_MALT_PER_ALE_CYCLE,
        );
        assert_eq!(
            directly_dispatched_processor_input_per_cycle("smithy", "charcoal"),
            1.0,
        );
        assert_eq!(
            directly_dispatched_processor_input_per_cycle("smokehouse", "pottery"),
            0.0,
        );
        assert_eq!(
            directly_dispatched_processor_input_per_cycle("threshing_barn", "ironwork"),
            super::CIVILIAN_TOOL_IRONWORK_PER_CYCLE,
        );
        assert_eq!(
            directly_dispatched_processor_input_per_cycle("watermill", "ironwork"),
            super::CIVILIAN_TOOL_IRONWORK_PER_CYCLE,
        );
        assert_eq!(
            directly_dispatched_processor_input_per_cycle("mine", "ironwork"),
            super::CIVILIAN_TOOL_IRONWORK_PER_CYCLE,
        );
        assert_eq!(
            directly_dispatched_processor_input_per_cycle("marketplace", "pottery"),
            0.0,
            "the marketplace remains overflow after preservation buffers",
        );
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
            local_material_dispatch_target("mine", "ironwork", 4, 2.0, 3.0, 25, 0.0),
            Some((ProcessorInputDispatchDuty::WorkingBuffer, 3.0)),
            "a staffed tool rack below reorder must request one full-rack refill independent of output policy"
        );
        assert_eq!(
            local_material_dispatch_target("mine", "ironwork", 4, 3.0, 3.0, 100, 0.0),
            None,
            "a full whole-unit rack must not request redundant top-up carts"
        );
        assert_eq!(
            local_material_dispatch_target("stone_quarry", "ironwork", 0, 0.0, 3.0, 50, 0.0),
            Some((ProcessorInputDispatchDuty::WorkshopOverflow, 3.0)),
            "idle sites may be pre-stocked only after staffed working-buffer claims"
        );
        assert_eq!(
            local_material_dispatch_target("smithy", "iron", 2, 0.0, 48.0, 100, 0.0),
            Some((ProcessorInputDispatchDuty::WorkingBuffer, 6.0)),
            "local ore must first restore the staffed forge's selected working buffer"
        );
        assert_eq!(
            local_material_dispatch_target("smithy", "iron", 2, 6.0, 48.0, 100, 0.0),
            None,
            "raw ore must not fill the forge yard beyond its working buffer"
        );
        assert_eq!(
            local_material_dispatch_target("smokehouse", "salt", 0, 0.0, 72.0, 100, 0.0),
            None,
            "an unstaffed processor must not warehouse raw salt"
        );
        assert_eq!(
            local_material_dispatch_target("trading_post", "salt", 2, 12.0, 72.0, 100, 48.0),
            Some((ProcessorInputDispatchDuty::WorkshopOverflow, 48.0)),
            "a staffed Trading Post must accept local mine carts up to its selected reserve"
        );
        assert_eq!(
            local_material_dispatch_target("trading_post", "salt", 2, 48.0, 72.0, 100, 48.0),
            None,
            "the local cart must stop exactly at the selected Trading Post reserve"
        );
        assert_eq!(
            local_material_dispatch_target("trading_post", "iron", 0, 0.0, 48.0, 100, 24.0),
            None,
            "an unstaffed Trading Post cannot centralize local ore"
        );
        assert_eq!(
            local_material_dispatch_target("potter_kiln", "clay", 2, 9.0, 72.0, 100, 0.0),
            Some((ProcessorInputDispatchDuty::WorkshopOverflow, 72.0)),
            "ordinary material chains retain workshop overflow after their buffer"
        );
        assert_eq!(
            compare_processor_input_dispatch_candidates(
                ProcessorInputDispatchDuty::WorkingBuffer,
                3,
                2,
                2.5,
                100.0,
                9,
                ProcessorInputDispatchDuty::WorkingBuffer,
                1,
                0,
                0.0,
                5.0,
                1,
            ),
            Ordering::Greater,
            "input preference must outrank neutralized legacy work priority within a working buffer"
        );
        assert_eq!(
            compare_processor_input_dispatch_candidates(
                ProcessorInputDispatchDuty::WorkingBuffer,
                1,
                2,
                2.5,
                100.0,
                9,
                ProcessorInputDispatchDuty::WorkshopOverflow,
                3,
                0,
                0.0,
                5.0,
                1,
            ),
            Ordering::Less,
            "an active working buffer must beat warehouse overflow at any tier"
        );
        assert_eq!(
            compare_processor_input_dispatch_candidates(
                ProcessorInputDispatchDuty::WorkingBuffer,
                2,
                0,
                2.5,
                100.0,
                9,
                ProcessorInputDispatchDuty::WorkingBuffer,
                2,
                2,
                0.0,
                5.0,
                1,
            ),
            Ordering::Less,
            "a matching fibre preference must beat runway and route within one work tier"
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
                    (building_id % 3) as u8,
                    (building_id % 7) as f64,
                    (100_000 - building_id) as f64,
                )
            }),
            |candidate| candidate.1,
            |candidate| candidate.2,
            |candidate| candidate.3,
            |candidate| candidate.4,
            |candidate| candidate.5,
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
    fn flour_routes_to_bakery_buffers_then_granary_then_bakery_overflow() {
        let bakery_buffer = processor_input_dispatch_duty_for_target(
            "bakery",
            "flour",
            1,
            0.0,
            super::BAKERY_FLOUR_PER_CYCLE,
            100,
        );
        let granary =
            processor_input_dispatch_duty_for_target("granary", "ryeFlour", 1, 0.0, 0.0, 100);
        let bakery_overflow = processor_input_dispatch_duty_for_target(
            "bakery",
            "flour",
            1,
            9.0,
            super::BAKERY_FLOUR_PER_CYCLE,
            100,
        );

        assert_eq!(bakery_buffer, ProcessorInputDispatchDuty::WorkingBuffer);
        assert_eq!(granary, ProcessorInputDispatchDuty::CentralStorage);
        assert_eq!(
            bakery_overflow,
            ProcessorInputDispatchDuty::WorkshopOverflow
        );
        assert_eq!(
            compare_processor_input_dispatch_candidates(
                bakery_buffer,
                1,
                0,
                0.0,
                100.0,
                1,
                granary,
                3,
                0,
                f64::INFINITY,
                1.0,
                2,
            ),
            Ordering::Less,
            "a bakery working buffer must beat a nearer granary",
        );
        assert_eq!(
            compare_processor_input_dispatch_candidates(
                granary,
                1,
                0,
                f64::INFINITY,
                100.0,
                2,
                bakery_overflow,
                3,
                0,
                3.0,
                1.0,
                1,
            ),
            Ordering::Less,
            "central flour storage must beat bakery warehouse overflow",
        );
    }

    #[test]
    fn granary_grain_ignores_legacy_priority_then_uses_runway() {
        assert_eq!(
            compare_grain_dispatch_candidates(2, 2.0, 80.0, 9, 2, 2.8, 10.0, 1,),
            Ordering::Less,
            "lower processor runway outranks a shorter cart route"
        );
        assert_eq!(
            compare_grain_dispatch_candidates(3, 2.8, 80.0, 9, 1, 0.0, 10.0, 1,),
            Ordering::Greater,
            "legacy completed-building priority must not override processor runway"
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
                        3
                    } else if index % 3 == 0 {
                        2
                    } else {
                        1
                    },
                    (index % 7) as f64,
                    (100_000 - index) as f64,
                )
            }),
            |candidate| candidate.1,
            |candidate| candidate.2,
            |candidate| candidate.3,
            |candidate| candidate.0 as u64,
        )
        .expect("a large harvest network should have a destination");
        assert_eq!(selected.0, 99_995);
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
    fn household_services_follow_the_delivery_labor_contract() {
        assert!(is_well_supplier_operational("well", true, 0));
        assert!(!is_well_supplier_operational("well", false, 0));
        assert!(!is_food_supplier_operational("fishing_camp", true, 1));
        assert!(!is_food_supplier_operational("fishing_camp", true, 0));
        assert!(!is_food_supplier_operational("granary", true, 2));
        assert!(!is_food_supplier_operational("granary", true, 1));
        assert!(!is_food_supplier_operational("granary", true, 0));
        assert!(!is_food_supplier_operational("pastoral_farmstead", true, 0));
        assert!(!is_food_supplier_operational("monastery", true, 0));
        assert!(is_food_supplier_operational("marketplace", true, 0));
    }

    #[test]
    fn food_supplier_roster_matches_existing_physical_dispatchers() {
        assert_eq!(FOOD_SUPPLIER_KINDS, &["marketplace"]);
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
