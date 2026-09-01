use crate::balance_generated::{
    CALENDAR_DAYS_PER_MONTH, CALENDAR_SECONDS_PER_DAY, CATTLE_MANURE_COLLECTION_AUTUMN_MULTIPLIER,
    CATTLE_MANURE_COLLECTION_SPRING_MULTIPLIER, CATTLE_MANURE_COLLECTION_SUMMER_MULTIPLIER,
    CATTLE_MANURE_COLLECTION_WINTER_MULTIPLIER, CATTLE_MANURE_PER_SUPPLIED_HEAD_PER_CYCLE,
    LIVESTOCK_ANIMAL_FEED_FODDER_VALUE, LIVESTOCK_AUTUMN_CULL_END_MONTH,
    LIVESTOCK_AUTUMN_CULL_START_MONTH, LIVESTOCK_HAYMAKING_END_MONTH,
    LIVESTOCK_HAYMAKING_START_MONTH, LIVESTOCK_MAXIMUM_HAYMAKING_PERCENT,
    LIVESTOCK_SEASONAL_CONCEPTION_MULTIPLIER, LIVESTOCK_WINTER_FODDER_RESERVE_DAYS,
    SHEEP_SHEARING_END_MONTH, SHEEP_SHEARING_START_MONTH, SHEEP_WOOL_PER_SHEARING_PER_HEAD,
};
use crate::season_policy::Season;

const STORAGE_EPSILON: f64 = 1e-6;
const SPECIES_CATTLE: u8 = 0;
const SPECIES_SHEEP: u8 = 1;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LivestockBreedingPhase {
    SpringBirths,
    Conception,
    Waiting,
}

/// Pasture animals mate in a species-authored season, then carry confirmed
/// offspring until the following spring. Woodland swine share the autumn
/// phase because their best condition coincides with the mast peak.
pub fn livestock_breeding_phase(species: u8, season: Season) -> LivestockBreedingPhase {
    if season == Season::Spring {
        return LivestockBreedingPhase::SpringBirths;
    }
    match (species, season) {
        (SPECIES_CATTLE, Season::Summer) | (SPECIES_SHEEP, Season::Autumn) => {
            LivestockBreedingPhase::Conception
        }
        // Species code 2 is swine. Unknown legacy species follow the swine
        // fallback rather than ever gaining year-round conception.
        (_, Season::Autumn) if species != SPECIES_CATTLE => LivestockBreedingPhase::Conception,
        _ => LivestockBreedingPhase::Waiting,
    }
}

/// Accumulates an expected pregnancy cohort without allowing newborns to
/// reproduce in the same year. The whole portion represents confirmed
/// offspring due next spring; the fraction is retained across years so a
/// small but healthy breeding pair can still grow over time.
pub fn livestock_conception_progress_after_cycle(
    current_progress: f64,
    productive_heads: f64,
    breeding_per_cycle: f64,
    head_count: u32,
    breeding_limit: u32,
) -> f64 {
    let current = current_progress.max(0.0);
    let open_slots = breeding_limit.saturating_sub(head_count) as f64;
    if open_slots <= 0.0 || current >= open_slots {
        return current;
    }
    (current
        + productive_heads.max(0.0)
            * breeding_per_cycle.max(0.0)
            * LIVESTOCK_SEASONAL_CONCEPTION_MULTIPLIER.max(0.0))
    .min(open_slots)
}

/// Resolves every confirmed pregnancy once spring arrives. Capacity is
/// authoritative at birth time; offspring that no longer fit the parcel or
/// shared holding are lost instead of being banked for a later year.
pub fn livestock_spring_births(
    breeding_progress: f64,
    head_count: u32,
    breeding_limit: u32,
) -> (u32, f64) {
    let progress = breeding_progress.max(0.0);
    let confirmed = progress.floor().clamp(0.0, u32::MAX as f64) as u32;
    let births = confirmed.min(breeding_limit.saturating_sub(head_count));
    (births, progress.fract())
}

/// Pregnancies belong to the animals that remain in the herd. Selling,
/// culling, or losing heads therefore reduces the cohort proportionally and
/// clears it completely when the pasture is emptied.
pub fn retained_livestock_breeding_progress(
    breeding_progress: f64,
    previous_heads: u32,
    remaining_heads: u32,
) -> f64 {
    if previous_heads == 0 || remaining_heads == 0 {
        return 0.0;
    }
    breeding_progress.max(0.0) * f64::from(remaining_heads) / f64::from(previous_heads)
}

pub const MILK_USE_FRESH: u8 = 25;
pub const MILK_USE_BALANCED: u8 = 50;
pub const MILK_USE_CHEESE_FIRST: u8 = 75;

pub fn is_valid_milk_use_policy(configured: u8) -> bool {
    matches!(
        configured,
        MILK_USE_FRESH | MILK_USE_BALANCED | MILK_USE_CHEESE_FIRST
    )
}

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

/// A zero-valued dedicated field identifies an older building row. Its former
/// workshop percentage is read once as the compatibility source so established
/// Fresh milk and Cheese first choices survive the additive schema migration.
pub fn effective_milk_use_policy(configured: u8, legacy_configured: u8) -> u8 {
    if is_valid_milk_use_policy(configured) {
        configured
    } else {
        normalize_milk_use_policy(legacy_configured)
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

/// Cattle are milked once in each non-winter calendar month. The wider
/// March-November window follows the authoritative season calendar.
pub fn is_cattle_milking_month(month: u32) -> bool {
    (3..=11).contains(&month)
}

/// Stable one-based key for a calendar month. Zero remains the additive-schema
/// default meaning that this pasture has never completed a milking round.
pub fn cattle_milking_period(year: u32, month: u32) -> u32 {
    year.saturating_sub(1)
        .saturating_mul(12)
        .saturating_add(month.clamp(1, 12))
}

/// Converts the former fixed-cycle dairy rate into one monthly lot, preserving
/// its non-winter average while making the physical harvest discrete.
pub fn cattle_monthly_dairy_cycle_multiplier(action_interval: f64) -> f64 {
    livestock_cycles_per_calendar_day(action_interval) * f64::from(CALENDAR_DAYS_PER_MONTH)
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
/// during the authoritative livestock cycle. Hides must also fit before the
/// animal is counted. Each animal is indivisible, so a partial final carcass
/// never reduces the projected winter herd.
#[allow(clippy::too_many_arguments)]
pub fn storage_secured_pending_cull_heads(
    head_count: u32,
    configured_reserve: u32,
    maximum_herd: u32,
    food_room: f64,
    preserved_food_room: f64,
    salted_output_capacity: f64,
    hides_room: f64,
    slaughter_food_per_head: f64,
    slaughter_preserved_food_per_head: f64,
    slaughter_hides_per_head: f64,
) -> u32 {
    let pending = pending_cull_heads(head_count, configured_reserve, maximum_herd);
    let mut food_room = food_room.max(0.0);
    let mut preserved_food_room = preserved_food_room.max(0.0);
    let mut salted_output_capacity = salted_output_capacity.max(0.0);
    let mut hides_room = hides_room.max(0.0);
    let slaughter_food = slaughter_food_per_head.max(0.0);
    let slaughter_preserved = slaughter_preserved_food_per_head.max(0.0);
    let slaughter_hides = slaughter_hides_per_head.max(0.0);
    let mut secured = 0;

    for _ in 0..pending {
        let saltable_slaughter = slaughter_preserved
            .min(salted_output_capacity)
            .min(preserved_food_room);
        let unsalted_slaughter = (slaughter_preserved - saltable_slaughter).max(0.0);
        let fresh_storage_needed = slaughter_food + unsalted_slaughter;

        if food_room + STORAGE_EPSILON < fresh_storage_needed
            || preserved_food_room + STORAGE_EPSILON < saltable_slaughter
            || hides_room + STORAGE_EPSILON < slaughter_hides
        {
            break;
        }

        food_room = (food_room - fresh_storage_needed).max(0.0);
        preserved_food_room = (preserved_food_room - saltable_slaughter).max(0.0);
        salted_output_capacity = (salted_output_capacity - saltable_slaughter).max(0.0);
        hides_room = (hides_room - slaughter_hides).max(0.0);
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
    hides_room: f64,
    slaughter_food_per_head: f64,
    slaughter_preserved_food_per_head: f64,
    slaughter_hides_per_head: f64,
) -> bool {
    is_autumn_cull_month(month)
        && pending_cull_heads(head_count, configured_reserve, maximum_herd) > 0
        && food_room + STORAGE_EPSILON >= slaughter_food_per_head.max(0.0)
        && preserved_food_room + STORAGE_EPSILON >= slaughter_preserved_food_per_head.max(0.0)
        && hides_room + STORAGE_EPSILON >= slaughter_hides_per_head.max(0.0)
}

#[cfg(test)]
mod tests {
    use super::{
        can_cull_one, cattle_field_support_is_active, cattle_manure_collection_multiplier,
        cattle_manure_output, cattle_milking_period, cattle_monthly_dairy_cycle_multiplier,
        effective_breeding_reserve, effective_milk_use_policy, essential_livestock_care_labor,
        farmhouse_cheese_salt_staging_cycles, haymaking_share, is_autumn_cull_month,
        is_cattle_milking_month, is_haymaking_month, is_shearing_month, livestock_breeding_phase,
        livestock_conception_progress_after_cycle, livestock_cycles_per_calendar_day,
        livestock_feed_oat_exportable_stock, livestock_holding_protects_feed_oats,
        livestock_milk_allocation, livestock_spring_births, normalize_milk_use_policy,
        pending_cull_heads, projected_winter_animal_feed, retain_priority_candidate,
        retained_livestock_breeding_progress, sheep_fleece_output,
        storage_secured_pending_cull_heads, LivestockBreedingPhase, MILK_USE_BALANCED,
        MILK_USE_CHEESE_FIRST, MILK_USE_FRESH,
    };
    use crate::balance_generated::{CALENDAR_DAYS_PER_MONTH, CALENDAR_SECONDS_PER_DAY};
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
    fn pasture_species_conceive_in_their_authored_season_and_birth_in_spring() {
        for species in 0..=2 {
            assert_eq!(
                livestock_breeding_phase(species, Season::Spring),
                LivestockBreedingPhase::SpringBirths
            );
        }
        assert_eq!(
            livestock_breeding_phase(0, Season::Summer),
            LivestockBreedingPhase::Conception
        );
        assert_eq!(
            livestock_breeding_phase(0, Season::Autumn),
            LivestockBreedingPhase::Waiting
        );
        assert_eq!(
            livestock_breeding_phase(1, Season::Autumn),
            LivestockBreedingPhase::Conception
        );
        assert_eq!(
            livestock_breeding_phase(1, Season::Summer),
            LivestockBreedingPhase::Waiting
        );
        assert_eq!(
            livestock_breeding_phase(2, Season::Autumn),
            LivestockBreedingPhase::Conception
        );
        assert_eq!(
            livestock_breeding_phase(2, Season::Winter),
            LivestockBreedingPhase::Waiting
        );
    }

    #[test]
    fn conception_is_herd_scaled_capacity_bounded_and_not_same_season_birth() {
        let progress = livestock_conception_progress_after_cycle(0.25, 5.0, 0.04, 5, 20);
        assert!((progress - 0.5).abs() < 1e-9);
        assert_eq!(
            livestock_conception_progress_after_cycle(0.75, 5.0, 0.04, 5, 5),
            0.75
        );
        assert_eq!(
            livestock_conception_progress_after_cycle(1.8, 50.0, 1.0, 18, 20),
            2.0
        );
    }

    #[test]
    fn spring_births_clear_the_confirmed_cohort_and_respect_current_capacity() {
        assert_eq!(livestock_spring_births(3.75, 5, 20), (3, 0.75));
        assert_eq!(livestock_spring_births(3.75, 19, 20), (1, 0.75));
        assert_eq!(livestock_spring_births(0.75, 5, 20), (0, 0.75));
    }

    #[test]
    fn removing_animals_removes_their_share_of_pending_offspring() {
        assert_eq!(retained_livestock_breeding_progress(4.0, 8, 6), 3.0);
        assert_eq!(retained_livestock_breeding_progress(4.0, 8, 0), 0.0);
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
    fn dedicated_milk_policy_falls_back_to_legacy_rows_only_when_unset() {
        assert_eq!(effective_milk_use_policy(0, MILK_USE_FRESH), MILK_USE_FRESH);
        assert_eq!(
            effective_milk_use_policy(MILK_USE_CHEESE_FIRST, MILK_USE_FRESH),
            MILK_USE_CHEESE_FIRST
        );
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
        assert!(can_cull_one(10, 9, 7, 14, 9.0, 1.0, 1.0, 9.0, 1.0, 1.0));
        assert!(!can_cull_one(10, 9, 7, 14, 8.99, 1.0, 1.0, 9.0, 1.0, 1.0));
        assert!(!can_cull_one(10, 9, 7, 14, 9.0, 0.99, 1.0, 9.0, 1.0, 1.0));
        assert!(!can_cull_one(10, 9, 7, 14, 9.0, 1.0, 0.99, 9.0, 1.0, 1.0));
        assert!(!can_cull_one(8, 9, 7, 14, 90.0, 90.0, 90.0, 9.0, 1.0, 1.0));
    }

    #[test]
    fn winter_projection_only_counts_whole_carcasses_that_fit() {
        assert_eq!(
            storage_secured_pending_cull_heads(10, 7, 14, 15.0, 1.5, 1.5, 3.0, 5.0, 0.5, 1.0),
            3
        );
        assert_eq!(
            storage_secured_pending_cull_heads(10, 7, 14, 14.99, 1.5, 1.5, 3.0, 5.0, 0.5, 1.0),
            2
        );
        assert_eq!(
            storage_secured_pending_cull_heads(10, 7, 14, 50.0, 50.0, 50.0, 50.0, 5.0, 0.5, 1.0),
            3
        );
        assert_eq!(
            storage_secured_pending_cull_heads(7, 7, 14, 50.0, 50.0, 50.0, 50.0, 5.0, 0.5, 1.0),
            0
        );
    }

    #[test]
    fn winter_projection_routes_unsalted_preserved_yield_to_fresh_storage() {
        // The first carcass consumes the remaining half-unit of cured room and
        // salt capacity. The second carcass therefore needs 5.5 fresh-food
        // room; the same split is used by the live culling cycle.
        assert_eq!(
            storage_secured_pending_cull_heads(9, 7, 14, 10.5, 0.5, 0.5, 2.0, 5.0, 0.5, 1.0),
            2
        );
        assert_eq!(
            storage_secured_pending_cull_heads(9, 7, 14, 10.49, 0.5, 0.5, 2.0, 5.0, 0.5, 1.0),
            1
        );
        assert_eq!(
            storage_secured_pending_cull_heads(9, 7, 14, 11.0, 0.0, 0.0, 2.0, 5.0, 0.5, 1.0),
            2
        );
        assert_eq!(
            storage_secured_pending_cull_heads(9, 7, 14, 10.0, 0.0, 0.0, 2.0, 5.0, 0.5, 1.0),
            1
        );
        assert_eq!(
            storage_secured_pending_cull_heads(9, 7, 14, 50.0, 50.0, 50.0, 1.0, 5.0, 0.5, 1.0),
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
    fn cattle_milking_is_once_per_non_winter_calendar_month() {
        assert!(!is_cattle_milking_month(2));
        assert!(is_cattle_milking_month(3));
        assert!(is_cattle_milking_month(11));
        assert!(!is_cattle_milking_month(12));
        assert_eq!(cattle_milking_period(1, 1), 1);
        assert_eq!(cattle_milking_period(2, 3), 15);
        assert!(
            (cattle_monthly_dairy_cycle_multiplier(CALENDAR_SECONDS_PER_DAY)
                - f64::from(CALENDAR_DAYS_PER_MONTH))
            .abs()
                < 1e-9
        );
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
