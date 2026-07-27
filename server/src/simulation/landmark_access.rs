use spacetimedb::{Identity, ReducerContext};

use crate::balance_generated::MONASTERY_COVERAGE_RADIUS;
use crate::simulation::tick_context::SimTickContext;
use crate::tables::{Building, Residence};

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

pub fn residence_has_chapel_access(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    owner: Identity,
    residence: &Residence,
    chapels: &[Building],
) -> bool {
    find_serving_chapel(ctx, tick, owner, residence, chapels).is_some()
}

pub fn monastery_linked_to_chapel(
    tick: &SimTickContext,
    monastery: &Building,
    chapels: &[Building],
) -> bool {
    let Some(network) = tick.road_network(monastery.owner) else {
        return false;
    };
    chapels.iter().any(|chapel| {
        chapel.owner == monastery.owner
            && is_chapel_staffed(chapel)
            && network
                .road_path_distance(monastery.x, monastery.z, chapel.x, chapel.z)
                .is_some()
    })
}

pub fn find_linked_monastery_in_coverage<'a>(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    owner: Identity,
    residence: &Residence,
    monasteries: &'a [Building],
    chapels: &[Building],
) -> Option<&'a Building> {
    if !residence_has_chapel_access(ctx, tick, owner, residence, chapels) {
        return None;
    }

    let Some(network) = tick.road_network(owner) else {
        return None;
    };

    let mut candidates: Vec<&Building> = monasteries
        .iter()
        .filter(|monastery| {
            monastery.owner == owner
                && monastery.kind == "monastery"
                && monastery.construction_complete
                && monastery_linked_to_chapel(tick, monastery, chapels)
                && network
                    .road_path_distance(residence.x, residence.z, monastery.x, monastery.z)
                    .is_some_and(|distance| distance <= MONASTERY_COVERAGE_RADIUS)
        })
        .collect();
    candidates.sort_by_key(|monastery| monastery.id);
    candidates.into_iter().next()
}

pub fn residence_has_monastery_coverage(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    owner: Identity,
    residence: &Residence,
    monasteries: &[Building],
    chapels: &[Building],
) -> bool {
    find_linked_monastery_in_coverage(ctx, tick, owner, residence, monasteries, chapels).is_some()
}
