//! Additive migration from the former one-herd-per-building model to one herd
//! per authored pasture. The legacy table remains in the schema so ordinary
//! publishes can upgrade existing worlds without changing a primary key.

use spacetimedb::ReducerContext;

use crate::balance_generated::{
    CATTLE_DEFAULT_BREEDING_RESERVE, SHEEP_DEFAULT_BREEDING_RESERVE, SWINE_DEFAULT_BREEDING_RESERVE,
};
use crate::db::*;
use crate::reducers::livestock::{SPECIES_CATTLE, SPECIES_SHEEP};
use crate::resource_units::whole_units;
use crate::tables::{LivestockHerd, Pasture, PastureHerd};

/// Migrates every legacy herd that has at least one linked parcel. A legacy
/// herd with no parcel is deliberately retained: `place_pasture` invokes this
/// function after inserting the first replacement parcel, so no animals or
/// policy state are discarded merely because an older world removed fencing.
pub fn migrate_legacy_livestock_herds(ctx: &ReducerContext) {
    let legacy_rows: Vec<LivestockHerd> = ctx.db.livestock_herd().iter().collect();
    for legacy in legacy_rows {
        migrate_legacy_livestock_herd(ctx, legacy);
    }
}

pub fn migrate_legacy_livestock_herd_for_building(ctx: &ReducerContext, building_id: u64) {
    if let Some(legacy) = ctx.db.livestock_herd().building_id().find(&building_id) {
        migrate_legacy_livestock_herd(ctx, legacy);
    }
}

fn migrate_legacy_livestock_herd(ctx: &ReducerContext, legacy: LivestockHerd) {
    let mut pastures: Vec<Pasture> = ctx
        .db
        .pasture()
        .farmstead_id()
        .filter(&legacy.building_id)
        .collect();
    pastures.sort_unstable_by_key(|pasture| pasture.id);
    if pastures.is_empty() {
        return;
    }

    let existing: Vec<PastureHerd> = ctx
        .db
        .pasture_herd()
        .farmstead_id()
        .filter(&legacy.building_id)
        .collect();
    // Reducers call migration before creating live pasture rows. Treat any
    // materialized state here as authoritative rather than overwriting it.
    // Ordinary transactions are atomic, so this guard is only relevant to a
    // world upgraded through an interrupted/manual development sequence.
    if existing.iter().any(pasture_herd_has_material_state) {
        return;
    }
    for row in existing {
        ctx.db.pasture_herd().pasture_id().delete(&row.pasture_id);
    }

    let weights = pastures
        .iter()
        .map(|pasture| pasture.area.max(0.0))
        .collect::<Vec<_>>();
    let heads = allocate_whole_units(legacy.head_count, &weights);
    let culled = allocate_whole_units(legacy.last_culled, &weights);
    let hay = allocate_whole_stock(legacy.hay_stock, &weights);
    let food = allocate_whole_stock(legacy.last_food_output, &weights);
    let preserved = allocate_whole_stock(legacy.last_preserved_output, &weights);
    let wool_gold = allocate_whole_stock(legacy.last_wool_gold, &weights);
    let hay_output = allocate_whole_stock(legacy.last_hay_output, &weights);
    let wool_output = allocate_whole_stock(legacy.last_wool_output, &weights);
    let breeding_progress = allocate_continuous(legacy.breeding_progress.max(0.0), &weights);
    let reserves = allocate_legacy_reserve(
        legacy.breeding_reserve,
        legacy.head_count,
        &heads,
        legacy.species,
    );

    for (index, pasture) in pastures.iter().enumerate() {
        ctx.db.pasture_herd().insert(PastureHerd {
            pasture_id: pasture.id,
            farmstead_id: pasture.farmstead_id,
            owner: pasture.owner,
            species: legacy.species,
            head_count: heads[index],
            present_head_count: heads[index],
            health: legacy.health,
            breeding_progress: breeding_progress[index],
            pasture_capacity: 0.0,
            supplied_capacity: legacy
                .supplied_capacity
                .max(0.0)
                .min(f64::from(heads[index])),
            last_food_output: food[index],
            last_preserved_output: preserved[index],
            last_wool_gold: wool_gold[index],
            breeding_reserve: reserves[index],
            last_culled: culled[index],
            hay_stock: hay[index],
            last_hay_output: hay_output[index],
            haymaking_percent: legacy.haymaking_percent,
            last_wool_output: wool_output[index],
            last_shearing_year: legacy.last_shearing_year,
            last_milking_period: 0,
        });
    }
    ctx.db
        .livestock_herd()
        .building_id()
        .delete(&legacy.building_id);
}

fn pasture_herd_has_material_state(row: &PastureHerd) -> bool {
    row.head_count > 0
        || row.hay_stock > 1e-9
        || row.breeding_progress > 1e-9
        || row.last_food_output > 1e-9
        || row.last_preserved_output > 1e-9
        || row.last_wool_output > 1e-9
        || row.last_culled > 0
}

fn default_reserve(species: u8) -> u32 {
    match species {
        SPECIES_CATTLE => CATTLE_DEFAULT_BREEDING_RESERVE,
        SPECIES_SHEEP => SHEEP_DEFAULT_BREEDING_RESERVE,
        _ => SWINE_DEFAULT_BREEDING_RESERVE,
    }
}

fn allocate_legacy_reserve(
    total_reserve: u32,
    total_heads: u32,
    heads: &[u32],
    species: u8,
) -> Vec<u32> {
    if total_heads == 0 {
        return vec![default_reserve(species); heads.len()];
    }
    heads
        .iter()
        .map(|head_count| {
            if *head_count == 0 {
                default_reserve(species)
            } else {
                ((f64::from(total_reserve) * f64::from(*head_count) / f64::from(total_heads)).ceil()
                    as u32)
                    .max(1)
            }
        })
        .collect()
}

fn normalized_weights(weights: &[f64]) -> Vec<f64> {
    let total: f64 = weights
        .iter()
        .copied()
        .filter(|value| value.is_finite())
        .sum();
    if total > 1e-9 {
        weights.iter().map(|value| value.max(0.0) / total).collect()
    } else if weights.is_empty() {
        Vec::new()
    } else {
        vec![1.0 / weights.len() as f64; weights.len()]
    }
}

fn allocate_whole_units(total: u32, weights: &[f64]) -> Vec<u32> {
    let normalized = normalized_weights(weights);
    let exact = normalized
        .iter()
        .map(|weight| f64::from(total) * *weight)
        .collect::<Vec<_>>();
    let mut allocated = exact
        .iter()
        .map(|value| value.floor() as u32)
        .collect::<Vec<_>>();
    let mut remainder = total.saturating_sub(allocated.iter().sum());
    let mut order = (0..exact.len()).collect::<Vec<_>>();
    order.sort_unstable_by(|left, right| {
        let left_fraction = exact[*left] - exact[*left].floor();
        let right_fraction = exact[*right] - exact[*right].floor();
        right_fraction
            .total_cmp(&left_fraction)
            .then_with(|| left.cmp(right))
    });
    for index in order {
        if remainder == 0 {
            break;
        }
        allocated[index] += 1;
        remainder -= 1;
    }
    allocated
}

fn allocate_continuous(total: f64, weights: &[f64]) -> Vec<f64> {
    let normalized = normalized_weights(weights);
    let mut allocated = normalized
        .iter()
        .map(|weight| total * *weight)
        .collect::<Vec<_>>();
    if !allocated.is_empty() {
        let last_index = allocated.len() - 1;
        let preceding: f64 = allocated.iter().take(last_index).sum();
        allocated[last_index] = (total - preceding).max(0.0);
    }
    allocated
}

fn allocate_whole_stock(total: f64, weights: &[f64]) -> Vec<f64> {
    allocate_whole_units(
        whole_units(total).clamp(0.0, u32::MAX as f64) as u32,
        weights,
    )
    .into_iter()
    .map(f64::from)
    .collect()
}

#[cfg(test)]
mod tests {
    use super::{allocate_continuous, allocate_whole_stock, allocate_whole_units};

    #[test]
    fn migration_allocation_preserves_indivisible_heads() {
        let allocated = allocate_whole_units(17, &[1.0, 2.0, 3.0]);
        assert_eq!(allocated.iter().sum::<u32>(), 17);
        assert_eq!(allocated, vec![3, 6, 8]);
    }

    #[test]
    fn migration_allocation_preserves_continuous_stock() {
        let allocated = allocate_continuous(11.5, &[1.0, 2.0, 3.0]);
        assert!((allocated.iter().sum::<f64>() - 11.5).abs() < 1e-9);
    }

    #[test]
    fn migration_allocation_preserves_whole_hay_stock() {
        let allocated = allocate_whole_stock(17.0, &[1.0, 2.0, 3.0]);
        assert_eq!(allocated.iter().sum::<f64>(), 17.0);
        assert!(allocated.iter().all(|value| value.fract() == 0.0));
    }
}
