use spacetimedb::{Identity, ReducerContext};

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
