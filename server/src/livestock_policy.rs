use crate::balance_generated::{
    CALENDAR_SECONDS_PER_DAY, CATTLE_MANURE_COLLECTION_AUTUMN_MULTIPLIER,
    CATTLE_MANURE_COLLECTION_SPRING_MULTIPLIER, CATTLE_MANURE_COLLECTION_SUMMER_MULTIPLIER,
    CATTLE_MANURE_COLLECTION_WINTER_MULTIPLIER, CATTLE_MANURE_PER_SUPPLIED_HEAD_PER_CYCLE,
    LIVESTOCK_ANIMAL_FEED_FODDER_VALUE, LIVESTOCK_AUTUMN_CULL_END_MONTH,
    LIVESTOCK_AUTUMN_CULL_START_MONTH, LIVESTOCK_HAYMAKING_END_MONTH,
    LIVESTOCK_HAYMAKING_START_MONTH, LIVESTOCK_MAXIMUM_HAYMAKING_PERCENT,
    LIVESTOCK_WINTER_FODDER_RESERVE_DAYS, SHEEP_SHEARING_END_MONTH, SHEEP_SHEARING_START_MONTH,
    SHEEP_WOOL_PER_SHEARING_PER_HEAD,
};
use crate::season_policy::Season;

const STORAGE_EPSILON: f64 = 1e-6;
const SPECIES_CATTLE: u8 = 0;

pub const MILK_USE_FRESH: u8 = 25;
pub const MILK_USE_BALANCED: u8 = 50;
pub const MILK_USE_CHEESE_FIRST: u8 = 75;

/// Oats staged at a pastoral holding with live animals have crossed the
/// food-versus-fodder boundary and belong to its feed workshop. Once the herd
/// is empty, those physical oat units return to ordinary food and trade flows.
pub fn livestock_holding_protects_feed_oats(source_kind: &str, has_feed_commitment: bool) -> bool {
    has_feed_commitment && source_kind == "pastoral_farmstead"
}

pub fn livestock_feed_oat_exportable_stock(
    source_kind: &str,
    stock: f64,
    has_feed_commitment: bool,
) -> f64 {
    if livestock_holding_protects_feed_oats(source_kind, has_feed_commitment) {
        0.0
    } else {
        stock.max(0.0)
    }
}

/// Pastoral holdings reuse the existing percentage field as a save-compatible
/// three-way milk-use choice. Old rows used 100, so they retain the former
/// balanced split instead of silently changing their output.
pub fn normalize_milk_use_policy(configured: u8) -> u8 {
    match configured {
        MILK_USE_FRESH | MILK_USE_CHEESE_FIRST => configured,
        _ => MILK_USE_BALANCED,
    }
}

/// Splits one gross milk yield between milk and farmhouse cheese. Cheese never
/// appears in parallel with milk: every stored cheese unit consumes one unit
/// of the same gross yield, and unavailable salt or storage falls back to milk.
pub fn livestock_milk_allocation(
    configured: u8,
    base_milk: f64,
    base_cheese: f64,
    cheese_capacity: f64,
) -> (f64, f64) {
    let gross = base_milk.max(0.0) + base_cheese.max(0.0);
    let desired_cheese = match normalize_milk_use_policy(configured) {
        MILK_USE_FRESH => 0.0,
        MILK_USE_CHEESE_FIRST => gross * 0.75,
        _ => base_cheese.max(0.0),
    };
    let cheese = desired_cheese.min(gross).min(cheese_capacity.max(0.0));
    ((gross - cheese).max(0.0), cheese)
}

pub fn farmhouse_cheese_salt_staging_cycles(configured: u8) -> f64 {
    if normalize_milk_use_policy(configured) == MILK_USE_FRESH {
        0.0
    } else {
        3.0
    }
}

pub fn cattle_field_support_is_active(
    species: u8,
    head_count: u32,
    health: f64,
    supplied_capacity: f64,
) -> bool {
    species == SPECIES_CATTLE && head_count >= 2 && health >= 0.65 && supplied_capacity >= 2.0
}

pub fn cattle_manure_collection_multiplier(season: Season) -> f64 {
    match season {
        Season::Spring => CATTLE_MANURE_COLLECTION_SPRING_MULTIPLIER,
        Season::Summer => CATTLE_MANURE_COLLECTION_SUMMER_MULTIPLIER,
        Season::Autumn => CATTLE_MANURE_COLLECTION_AUTUMN_MULTIPLIER,
        Season::Winter => CATTLE_MANURE_COLLECTION_WINTER_MULTIPLIER,
    }
    .max(0.0)
}

pub fn cattle_manure_output(productive_heads: f64, season: Season) -> f64 {
    productive_heads.max(0.0)
        * CATTLE_MANURE_PER_SUPPLIED_HEAD_PER_CYCLE.max(0.0)
        * cattle_manure_collection_multiplier(season)
}

pub fn livestock_cycles_per_calendar_day(action_interval: f64) -> f64 {
    if action_interval <= 1e-9 {
        return 0.0;
    }
    CALENDAR_SECONDS_PER_DAY / action_interval
}

/// Assigned herders still perform the irreducible feeding, watering, and
/// milking round on an observed Sunday. A live raider threat is different:
/// workers have taken refuge, so even essential care is unavailable.
pub fn essential_livestock_care_labor(onsite_labor: u32, active_raider_threat: bool) -> u32 {
    if active_raider_threat {
        0
    } else {
        onsite_labor
    }
}

pub fn projected_winter_animal_feed(
    projected_head_count: u32,
    base_pasture_capacity: f64,
    hay_stock: f64,
    hay_per_unsupported_head: f64,
    grain_per_unsupported_head: f64,
    cycles_per_calendar_day: f64,
    winter_capacity_multiplier: f64,
) -> f64 {
    let winter_capacity = base_pasture_capacity.max(0.0) * winter_capacity_multiplier.max(0.0);
    let unsupported_heads = (projected_head_count as f64 - winter_capacity).max(0.0);
    let unsupported_head_cycles =
        unsupported_heads * cycles_per_calendar_day.max(0.0) * LIVESTOCK_WINTER_FODDER_RESERVE_DAYS;
    let hay_supported_head_cycles = if hay_per_unsupported_head > 1e-9 {
        hay_stock.max(0.0) / hay_per_unsupported_head
    } else {
        0.0
    };
    let feed_value = (unsupported_head_cycles - hay_supported_head_cycles).max(0.0)
        * grain_per_unsupported_head.max(0.0);
    feed_value / LIVESTOCK_ANIMAL_FEED_FODDER_VALUE.max(1e-9)
}

pub fn is_haymaking_month(month: u32) -> bool {
    (LIVESTOCK_HAYMAKING_START_MONTH..=LIVESTOCK_HAYMAKING_END_MONTH).contains(&month)
}

pub fn is_shearing_month(month: u32) -> bool {
    (SHEEP_SHEARING_START_MONTH as u32..=SHEEP_SHEARING_END_MONTH as u32).contains(&month)
}

pub fn sheep_fleece_output(productive_heads: f64) -> f64 {
    productive_heads.max(0.0) * SHEEP_WOOL_PER_SHEARING_PER_HEAD
}

pub fn haymaking_share(configured_percent: u8) -> f64 {
    configured_percent.min(LIVESTOCK_MAXIMUM_HAYMAKING_PERCENT) as f64 / 100.0
}

/// Keeps only the best `limit` fields in priority-descending, id-ascending
/// order without sorting the full settlement field set.
pub fn retain_priority_candidate(
    selected: &mut Vec<(u8, u64)>,
    priority: u8,
    field_id: u64,
    limit: usize,
) {
    if limit == 0 {
        return;
    }
    let insertion = selected
        .iter()
        .position(|(other_priority, other_id)| {
            priority > *other_priority || (priority == *other_priority && field_id < *other_id)
        })
        .unwrap_or(selected.len());
    if insertion < limit {
        selected.insert(insertion, (priority, field_id));
        selected.truncate(limit);
    } else if selected.len() < limit {
        selected.push((priority, field_id));
    }
}

pub fn is_autumn_cull_month(month: u32) -> bool {
    (LIVESTOCK_AUTUMN_CULL_START_MONTH..=LIVESTOCK_AUTUMN_CULL_END_MONTH).contains(&month)
}

/// Zero is never emitted by the policy reducer, but resolves to maximum herd
/// as a defensive fallback for malformed or very old rows.
pub fn effective_breeding_reserve(configured_reserve: u32, maximum_herd: u32) -> u32 {
    if configured_reserve == 0 {
        maximum_herd
    } else {
        configured_reserve.min(maximum_herd).max(1)
    }
}

pub fn pending_cull_heads(head_count: u32, configured_reserve: u32, maximum_herd: u32) -> u32 {
    head_count.saturating_sub(effective_breeding_reserve(configured_reserve, maximum_herd))
}

/// Counts the currently pending culls whose complete slaughter yields fit in
/// the holding's present stores. Preserved yield uses the available salt and
/// cured-food room first; any remainder becomes fresh meat, exactly as it does
/// during the authoritative livestock cycle. Each animal is indivisible, so a
/// partial final carcass never reduces the projected winter herd.
#[allow(clippy::too_many_arguments)]
pub fn storage_secured_pending_cull_heads(
    head_count: u32,
    configured_reserve: u32,
    maximum_herd: u32,
    food_room: f64,
    preserved_food_room: f64,
    salted_output_capacity: f64,
    slaughter_food_per_head: f64,
    slaughter_preserved_food_per_head: f64,
) -> u32 {
    let pending = pending_cull_heads(head_count, configured_reserve, maximum_herd);
    let mut food_room = food_room.max(0.0);
    let mut preserved_food_room = preserved_food_room.max(0.0);
    let mut salted_output_capacity = salted_output_capacity.max(0.0);
    let slaughter_food = slaughter_food_per_head.max(0.0);
    let slaughter_preserved = slaughter_preserved_food_per_head.max(0.0);
    let mut secured = 0;

    for _ in 0..pending {
        let saltable_slaughter = slaughter_preserved
            .min(salted_output_capacity)
            .min(preserved_food_room);
        let unsalted_slaughter = (slaughter_preserved - saltable_slaughter).max(0.0);
        let fresh_storage_needed = slaughter_food + unsalted_slaughter;

        if food_room + STORAGE_EPSILON < fresh_storage_needed
            || preserved_food_room + STORAGE_EPSILON < saltable_slaughter
        {
            break;
        }

        food_room = (food_room - fresh_storage_needed).max(0.0);
        preserved_food_room = (preserved_food_room - saltable_slaughter).max(0.0);
        salted_output_capacity = (salted_output_capacity - saltable_slaughter).max(0.0);
        secured += 1;
    }

    secured
}

#[allow(clippy::too_many_arguments)]
pub fn can_cull_one(
    month: u32,
    head_count: u32,
    configured_reserve: u32,
    maximum_herd: u32,
    food_room: f64,
    preserved_food_room: f64,
    slaughter_food_per_head: f64,
    slaughter_preserved_food_per_head: f64,
) -> bool {
    is_autumn_cull_month(month)
        && pending_cull_heads(head_count, configured_reserve, maximum_herd) > 0
        && food_room + STORAGE_EPSILON >= slaughter_food_per_head.max(0.0)
        && preserved_food_room + STORAGE_EPSILON >= slaughter_preserved_food_per_head.max(0.0)
}

#[cfg(test)]
mod tests {
    use super::{
        can_cull_one, cattle_field_support_is_active, cattle_manure_collection_multiplier,
        cattle_manure_output, effective_breeding_reserve, essential_livestock_care_labor,
        farmhouse_cheese_salt_staging_cycles, haymaking_share, is_autumn_cull_month,
        is_haymaking_month, is_shearing_month, livestock_cycles_per_calendar_day,
        livestock_feed_oat_exportable_stock, livestock_holding_protects_feed_oats,
        livestock_milk_allocation, normalize_milk_use_policy, pending_cull_heads,
        projected_winter_animal_feed, retain_priority_candidate, sheep_fleece_output,
        storage_secured_pending_cull_heads, MILK_USE_BALANCED, MILK_USE_CHEESE_FIRST,
        MILK_USE_FRESH,
    };
    use crate::season_policy::Season;
    use std::time::Instant;

    #[test]
    fn culling_is_limited_to_late_autumn() {
        assert!(!is_autumn_cull_month(9));
        assert!(is_autumn_cull_month(10));
        assert!(is_autumn_cull_month(11));
        assert!(!is_autumn_cull_month(12));
    }

    #[test]
    fn only_live_pastoral_holdings_protect_staged_feed_oats() {
        assert!(livestock_holding_protects_feed_oats(
            "pastoral_farmstead",
            true
        ));
        assert!(!livestock_holding_protects_feed_oats(
            "pastoral_farmstead",
            false
        ));
        assert!(!livestock_holding_protects_feed_oats("granary", true));
        assert!(!livestock_holding_protects_feed_oats("swineherd", true));
        assert_eq!(
            livestock_feed_oat_exportable_stock("pastoral_farmstead", 18.0, true),
            0.0
        );
        assert_eq!(
            livestock_feed_oat_exportable_stock("pastoral_farmstead", 18.0, false),
            18.0
        );
        assert_eq!(
            livestock_feed_oat_exportable_stock("granary", 18.0, true),
            18.0
        );
    }

    #[test]
    fn milk_policy_converts_one_shared_yield_without_minting_food() {
        assert_eq!(normalize_milk_use_policy(100), MILK_USE_BALANCED);
        assert_eq!(normalize_milk_use_policy(0), MILK_USE_BALANCED);
        assert_eq!(normalize_milk_use_policy(MILK_USE_FRESH), MILK_USE_FRESH);

        let fresh = livestock_milk_allocation(MILK_USE_FRESH, 4.2, 1.2, 20.0);
        assert!((fresh.0 - 5.4).abs() < 1e-9);
        assert_eq!(fresh.1, 0.0);

        let balanced = livestock_milk_allocation(MILK_USE_BALANCED, 4.2, 1.2, 20.0);
        assert!((balanced.0 - 4.2).abs() < 1e-9);
        assert!((balanced.1 - 1.2).abs() < 1e-9);

        let cheese_first = livestock_milk_allocation(MILK_USE_CHEESE_FIRST, 4.2, 1.2, 20.0);
        assert!((cheese_first.0 - 1.35).abs() < 1e-9);
        assert!((cheese_first.1 - 4.05).abs() < 1e-9);
        assert!((cheese_first.0 + cheese_first.1 - 5.4).abs() < 1e-9);

        let salt_limited = livestock_milk_allocation(MILK_USE_CHEESE_FIRST, 4.2, 1.2, 0.5);
        assert!((salt_limited.0 - 4.9).abs() < 1e-9);
        assert!((salt_limited.1 - 0.5).abs() < 1e-9);
    }

    #[test]
    fn sunday_keeps_essential_animal_care_but_raids_remove_it() {
        assert_eq!(essential_livestock_care_labor(3, false), 3);
        assert_eq!(essential_livestock_care_labor(3, true), 0);
    }

    #[test]
    fn fresh_milk_policy_does_not_request_cheese_salt() {
        assert_eq!(farmhouse_cheese_salt_staging_cycles(MILK_USE_FRESH), 0.0);
        assert_eq!(farmhouse_cheese_salt_staging_cycles(MILK_USE_BALANCED), 3.0);
        assert_eq!(
            farmhouse_cheese_salt_staging_cycles(MILK_USE_CHEESE_FIRST),
            3.0
        );
        assert_eq!(farmhouse_cheese_salt_staging_cycles(100), 3.0);
    }

    #[test]
    fn legacy_zero_reserve_preserves_existing_max_herd_behavior() {
        assert_eq!(effective_breeding_reserve(0, 14), 14);
        assert_eq!(pending_cull_heads(14, 0, 14), 0);
    }

    #[test]
    fn surplus_requires_room_for_the_whole_animal_yield() {
        assert!(can_cull_one(10, 9, 7, 14, 9.0, 0.0, 9.0, 0.0));
        assert!(!can_cull_one(10, 9, 7, 14, 8.99, 0.0, 9.0, 0.0));
        assert!(!can_cull_one(10, 9, 7, 14, 9.0, 0.99, 9.0, 1.0));
        assert!(!can_cull_one(8, 9, 7, 14, 90.0, 90.0, 9.0, 1.0));
    }

    #[test]
    fn winter_projection_only_counts_whole_carcasses_that_fit() {
        assert_eq!(
            storage_secured_pending_cull_heads(10, 7, 14, 15.0, 1.5, 1.5, 5.0, 0.5),
            3
        );
        assert_eq!(
            storage_secured_pending_cull_heads(10, 7, 14, 14.99, 1.5, 1.5, 5.0, 0.5),
            2
        );
        assert_eq!(
            storage_secured_pending_cull_heads(10, 7, 14, 50.0, 50.0, 50.0, 5.0, 0.5),
            3
        );
        assert_eq!(
            storage_secured_pending_cull_heads(7, 7, 14, 50.0, 50.0, 50.0, 5.0, 0.5),
            0
        );
    }

    #[test]
    fn winter_projection_routes_unsalted_preserved_yield_to_fresh_storage() {
        // The first carcass consumes the remaining half-unit of cured room and
        // salt capacity. The second carcass therefore needs 5.5 fresh-food
        // room; the same split is used by the live culling cycle.
        assert_eq!(
            storage_secured_pending_cull_heads(9, 7, 14, 10.5, 0.5, 0.5, 5.0, 0.5),
            2
        );
        assert_eq!(
            storage_secured_pending_cull_heads(9, 7, 14, 10.49, 0.5, 0.5, 5.0, 0.5),
            1
        );
        assert_eq!(
            storage_secured_pending_cull_heads(9, 7, 14, 11.0, 0.0, 0.0, 5.0, 0.5),
            2
        );
        assert_eq!(
            storage_secured_pending_cull_heads(9, 7, 14, 10.0, 0.0, 0.0, 5.0, 0.5),
            1
        );
    }

    #[test]
    fn cattle_support_keeps_only_the_highest_priority_fields() {
        let mut selected = Vec::new();
        for (priority, field_id) in [(1, 8), (3, 9), (2, 2), (3, 4), (3, 12), (0, 1)] {
            retain_priority_candidate(&mut selected, priority, field_id, 2);
        }
        assert_eq!(selected, vec![(3, 4), (3, 9)]);
    }

    #[test]
    fn cattle_field_support_rechecks_live_herd_readiness() {
        assert!(cattle_field_support_is_active(0, 2, 0.65, 2.0));
        assert!(!cattle_field_support_is_active(1, 2, 0.65, 2.0));
        assert!(!cattle_field_support_is_active(0, 1, 0.65, 2.0));
        assert!(!cattle_field_support_is_active(0, 2, 0.64, 2.0));
        assert!(!cattle_field_support_is_active(0, 2, 0.65, 1.99));
    }

    #[test]
    fn housed_cattle_yield_more_collectable_manure_than_summer_grazing() {
        assert!(
            cattle_manure_collection_multiplier(Season::Winter)
                > cattle_manure_collection_multiplier(Season::Spring)
        );
        assert!(
            cattle_manure_collection_multiplier(Season::Spring)
                > cattle_manure_collection_multiplier(Season::Summer)
        );
        assert!(
            cattle_manure_output(4.0, Season::Winter) > cattle_manure_output(4.0, Season::Summer)
        );
        assert_eq!(cattle_manure_output(0.0, Season::Winter), 0.0);
        assert_eq!(cattle_manure_output(-1.0, Season::Winter), 0.0);
    }

    #[test]
    fn winter_fodder_projection_uses_continuous_calendar_and_pasture_pressure() {
        let cycles = livestock_cycles_per_calendar_day(10.0);
        assert!((cycles - 12.0).abs() < 1e-9);
        assert!((livestock_cycles_per_calendar_day(12.0) - 10.0).abs() < 1e-9);
        let feed = projected_winter_animal_feed(6, 10.0, 0.0, 0.34, 0.34, cycles, 0.35);
        assert!((feed - 244.8).abs() < 1e-9);
        assert!(
            projected_winter_animal_feed(6, 10.0, 306.0, 0.34, 0.34, cycles, 0.35).abs() < 1e-9
        );
        assert_eq!(
            projected_winter_animal_feed(3, 10.0, 0.0, 0.34, 0.34, cycles, 0.35),
            0.0
        );
        assert_eq!(livestock_cycles_per_calendar_day(0.0), 0.0);
    }

    #[test]
    fn haymaking_is_a_bounded_summer_pasture_choice() {
        assert!(!is_haymaking_month(5));
        assert!(is_haymaking_month(6));
        assert!(is_haymaking_month(8));
        assert!(!is_haymaking_month(9));
        assert_eq!(haymaking_share(0), 0.0);
        assert!((haymaking_share(35) - 0.35).abs() < 1e-9);
        assert!((haymaking_share(100) - 0.6).abs() < 1e-9);
    }

    #[test]
    fn sheep_shearing_has_one_readable_early_summer_window() {
        assert!(!is_shearing_month(5));
        assert!(is_shearing_month(6));
        assert!(is_shearing_month(7));
        assert!(!is_shearing_month(8));
    }

    #[test]
    fn annual_shearing_output_scales_with_productive_heads() {
        assert!((sheep_fleece_output(4.5) - 4.5).abs() < 1e-9);
        assert_eq!(sheep_fleece_output(0.0), 0.0);
    }

    #[test]
    fn cattle_support_selection_stays_bounded_for_large_field_sets() {
        let started = Instant::now();
        let mut selected = Vec::new();
        for field_id in (0..100_000_u64).rev() {
            retain_priority_candidate(&mut selected, (field_id % 4) as u8, field_id, 2);
        }
        assert_eq!(selected.len(), 2);
        assert!(started.elapsed().as_millis() < 250);
    }
}
