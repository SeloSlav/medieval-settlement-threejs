use std::collections::HashMap;

use spacetimedb::{Identity, ReducerContext};

use crate::balance_generated::HERB_TREATMENT_PER_SICK_DAY;
use crate::monastery_estate_policy::{monastery_infirmary_beds, normalize_monastery_estate_level};
use crate::simulation::tick_context::SimTickContext;
use crate::tables::{Building, Residence};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MonasteryInfirmaryCare {
    pub monastery_id: u64,
    pub estate_level: u8,
    pub beds: u32,
}

pub fn is_chapel_staffed(chapel: &Building) -> bool {
    chapel.kind == "chapel" && chapel.construction_complete && chapel.assigned_labor > 0
}

pub fn find_serving_chapel<'a>(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    owner: Identity,
    residence: &Residence,
    chapels: &'a [Building],
) -> Option<&'a Building> {
    let chapel_id = tick.chapel_for_residence(ctx, owner, residence.id)?;
    chapels
        .iter()
        .find(|chapel| chapel.id == chapel_id && chapel.owner == owner && is_chapel_staffed(chapel))
}

pub fn residence_chapel_tier(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    owner: Identity,
    residence: &Residence,
    chapels: &[Building],
) -> u8 {
    find_serving_chapel(ctx, tick, owner, residence, chapels)
        .map_or(0, |chapel| chapel.chapel_tier.max(1))
}

pub fn monastery_linked_to_chapel(
    tick: &SimTickContext,
    monastery: &Building,
    chapels: &[Building],
) -> bool {
    chapels.iter().any(|chapel| {
        chapel.owner == monastery.owner
            && is_chapel_staffed(chapel)
            && tick.road_connected(
                monastery.owner,
                monastery.x,
                monastery.z,
                chapel.x,
                chapel.z,
            )
    })
}

pub fn find_linked_monastery_in_coverage<'a>(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    owner: Identity,
    residence: &Residence,
    monasteries: &'a [Building],
) -> Option<&'a Building> {
    let monastery_id = tick.monastery_for_residence(ctx, owner, residence.id)?;
    monasteries.iter().find(|monastery| {
        monastery.id == monastery_id
            && monastery.owner == owner
            && monastery.kind == "monastery"
            && monastery.construction_complete
    })
}

pub fn residence_has_monastery_coverage(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    owner: Identity,
    residence: &Residence,
    monasteries: &[Building],
) -> bool {
    find_linked_monastery_in_coverage(ctx, tick, owner, residence, monasteries).is_some()
}

/// Allocate finite infirmary beds once per simulation step. Homes with the
/// shortest remedy runway are admitted first, followed by the larger and
/// longer-running sick cohorts. Partial admission remains useful because the
/// health step scales nursing by the share of sick residents who have beds.
pub fn monastery_infirmary_assignments(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    residences: &[Residence],
    monasteries: &[Building],
) -> HashMap<u64, MonasteryInfirmaryCare> {
    let mut candidates_by_monastery: HashMap<u64, Vec<&Residence>> = HashMap::new();
    for residence in residences
        .iter()
        .filter(|residence| residence.population > 0 && residence.sick_population > 0)
    {
        let Some(monastery) =
            find_linked_monastery_in_coverage(ctx, tick, residence.owner, residence, monasteries)
        else {
            continue;
        };
        candidates_by_monastery
            .entry(monastery.id)
            .or_default()
            .push(residence);
    }

    let mut assignments = HashMap::new();
    for monastery in monasteries {
        let Some(mut candidates) = candidates_by_monastery.remove(&monastery.id) else {
            continue;
        };
        candidates.sort_by(|left, right| {
            let remedy_runway = |residence: &Residence| {
                residence.remedy_stock.max(0.0)
                    / (residence.sick_population as f64 * HERB_TREATMENT_PER_SICK_DAY).max(1e-9)
            };
            remedy_runway(left)
                .total_cmp(&remedy_runway(right))
                .then_with(|| right.sick_population.cmp(&left.sick_population))
                .then_with(|| right.illness_ticks.cmp(&left.illness_ticks))
                .then_with(|| left.id.cmp(&right.id))
        });

        let estate_level = normalize_monastery_estate_level(monastery.chapel_tier);
        let mut beds_remaining = monastery_infirmary_beds(estate_level);
        for residence in candidates {
            if beds_remaining == 0 {
                break;
            }
            let beds = residence.sick_population.min(beds_remaining);
            beds_remaining -= beds;
            assignments.insert(
                residence.id,
                MonasteryInfirmaryCare {
                    monastery_id: monastery.id,
                    estate_level,
                    beds,
                },
            );
        }
    }
    assignments
}
