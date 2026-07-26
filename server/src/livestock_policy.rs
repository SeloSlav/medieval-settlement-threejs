use crate::balance_generated::{
    CALENDAR_HOURS_PER_DAY, CALENDAR_SECONDS_PER_DAY, CALENDAR_WORK_END_HOUR,
    CALENDAR_WORK_START_HOUR, LIVESTOCK_AUTUMN_CULL_END_MONTH, LIVESTOCK_AUTUMN_CULL_START_MONTH,
    LIVESTOCK_HAYMAKING_END_MONTH, LIVESTOCK_HAYMAKING_START_MONTH,
    LIVESTOCK_MAXIMUM_HAYMAKING_PERCENT, LIVESTOCK_WINTER_FODDER_RESERVE_DAYS,
    SHEEP_SHEARING_END_MONTH, SHEEP_SHEARING_START_MONTH, SHEEP_WOOL_PER_SHEARING_PER_HEAD,
    WINTER_PASTURE_CAPACITY_MULTIPLIER,
};

const STORAGE_EPSILON: f64 = 1e-6;
const SPECIES_CATTLE: u8 = 0;

pub fn cattle_field_support_is_active(
    species: u8,
    head_count: u32,
    health: f64,
    supplied_capacity: f64,
) -> bool {
    species == SPECIES_CATTLE && head_count >= 2 && health >= 0.65 && supplied_capacity >= 2.0
}

pub fn livestock_cycles_per_calendar_day(
    assigned_labor: u32,
    action_interval: f64,
    sabbath_observed: bool,
) -> f64 {
    if assigned_labor == 0 || action_interval <= 1e-9 {
        return 0.0;
    }
    let workday_seconds = CALENDAR_SECONDS_PER_DAY
        * (CALENDAR_WORK_END_HOUR - CALENDAR_WORK_START_HOUR) as f64
        / CALENDAR_HOURS_PER_DAY as f64;
    let working_week_share = if sabbath_observed { 6.0 / 7.0 } else { 1.0 };
    workday_seconds * working_week_share * assigned_labor as f64 / action_interval
}

pub fn projected_winter_fodder_grain(
    projected_head_count: u32,
    base_pasture_capacity: f64,
    hay_stock: f64,
    hay_per_unsupported_head: f64,
    grain_per_unsupported_head: f64,
    cycles_per_calendar_day: f64,
) -> f64 {
    let winter_capacity = base_pasture_capacity.max(0.0) * WINTER_PASTURE_CAPACITY_MULTIPLIER;
    let unsupported_heads = (projected_head_count as f64 - winter_capacity).max(0.0);
    let unsupported_head_cycles =
        unsupported_heads * cycles_per_calendar_day.max(0.0) * LIVESTOCK_WINTER_FODDER_RESERVE_DAYS;
    let hay_supported_head_cycles = if hay_per_unsupported_head > 1e-9 {
        hay_stock.max(0.0) / hay_per_unsupported_head
    } else {
        0.0
    };
    (unsupported_head_cycles - hay_supported_head_cycles).max(0.0)
        * grain_per_unsupported_head.max(0.0)
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

/// An annual clip is indivisible: if the loft cannot hold the whole fleece,
/// shearing waits so a cart can clear the store instead of silently discarding
/// the unstored remainder.
pub fn can_store_full_sheep_clip(productive_heads: f64, wool_room: f64) -> bool {
    let fleece = sheep_fleece_output(productive_heads);
    fleece > STORAGE_EPSILON && wool_room.max(0.0) + STORAGE_EPSILON >= fleece
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
        can_cull_one, can_store_full_sheep_clip, cattle_field_support_is_active,
        effective_breeding_reserve, haymaking_share, is_autumn_cull_month, is_haymaking_month,
        is_shearing_month, livestock_cycles_per_calendar_day, pending_cull_heads,
        projected_winter_fodder_grain, retain_priority_candidate, sheep_fleece_output,
    };
    use std::time::Instant;

    #[test]
    fn culling_is_limited_to_late_autumn() {
        assert!(!is_autumn_cull_month(9));
        assert!(is_autumn_cull_month(10));
        assert!(is_autumn_cull_month(11));
        assert!(!is_autumn_cull_month(12));
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
    fn winter_fodder_projection_uses_work_calendar_and_pasture_pressure() {
        let cycles = livestock_cycles_per_calendar_day(1, 10.0, false);
        assert!((cycles - 7.0).abs() < 1e-9);
        assert!((livestock_cycles_per_calendar_day(1, 10.0, true) - 6.0).abs() < 1e-9);
        let grain = projected_winter_fodder_grain(6, 10.0, 0.0, 0.34, 0.34, cycles);
        assert!((grain - 178.5).abs() < 1e-9);
        assert_eq!(
            projected_winter_fodder_grain(6, 10.0, 178.5, 0.34, 0.34, cycles),
            0.0
        );
        assert_eq!(
            projected_winter_fodder_grain(3, 10.0, 0.0, 0.34, 0.34, cycles),
            0.0
        );
        assert_eq!(livestock_cycles_per_calendar_day(0, 10.0, false), 0.0);
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
    fn annual_shearing_waits_for_room_for_the_whole_clip() {
        assert!((sheep_fleece_output(4.5) - 13.5).abs() < 1e-9);
        assert!(can_store_full_sheep_clip(4.5, 13.5));
        assert!(!can_store_full_sheep_clip(4.5, 13.49));
        assert!(!can_store_full_sheep_clip(0.0, 90.0));
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
