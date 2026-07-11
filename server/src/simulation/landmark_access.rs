use spacetimedb::Identity;

use crate::simulation::tick_context::SimTickContext;
use crate::tables::{Building, Residence};

pub fn residence_has_road_landmark(
    tick: &SimTickContext,
    owner: Identity,
    residence: &Residence,
    landmarks: &[Building],
    kind: &str,
) -> bool {
    landmarks.iter().any(|landmark| {
        landmark.owner == owner
            && landmark.kind == kind
            && tick.road_connected(owner, residence.x, residence.z, landmark.x, landmark.z)
    })
}

pub fn residence_has_marketplace_access(
    tick: &SimTickContext,
    owner: Identity,
    residence: &Residence,
    landmarks: &[Building],
) -> bool {
    residence_has_road_landmark(tick, owner, residence, landmarks, "marketplace")
}

pub fn is_chapel_staffed(chapel: &Building) -> bool {
    chapel.kind == "chapel" && chapel.assigned_labor > 0
}

pub fn find_serving_chapel<'a>(
    tick: &SimTickContext,
    owner: Identity,
    residence: &Residence,
    chapels: &'a [Building],
) -> Option<&'a Building> {
    chapels.iter().find(|chapel| {
        chapel.owner == owner
            && is_chapel_staffed(chapel)
            && tick.road_connected(owner, residence.x, residence.z, chapel.x, chapel.z)
    })
}

pub fn residence_has_chapel_access(
    tick: &SimTickContext,
    owner: Identity,
    residence: &Residence,
    chapels: &[Building],
) -> bool {
    find_serving_chapel(tick, owner, residence, chapels).is_some()
}

pub fn linked_chapel_population(
    tick: &SimTickContext,
    owner: Identity,
    chapel: &Building,
    residences: &[Residence],
) -> u32 {
    if chapel.owner != owner || !is_chapel_staffed(chapel) {
        return 0;
    }

    residences
        .iter()
        .filter(|residence| {
            !residence.abandoned
                && residence.owner == owner
                && residence.population > 0
                && tick.road_connected(owner, residence.x, residence.z, chapel.x, chapel.z)
        })
        .map(|residence| residence.population)
        .sum()
}
