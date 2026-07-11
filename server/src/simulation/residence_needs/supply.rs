use spacetimedb::ReducerContext;

use crate::simulation::road_logistics::{claim_residences_for_lodges, owner_lodges};
use crate::simulation::residence_needs::kinds::ResidenceNeedKind;
use crate::simulation::tick_context::SimTickContext;
use crate::tables::Residence;

pub struct ResidenceNeedSupplyContext {
    routes: [bool; ResidenceNeedKind::ALL.len()],
}

impl ResidenceNeedSupplyContext {
    pub fn has_route(&self, kind: ResidenceNeedKind) -> bool {
        self.routes[Self::index_for(kind)]
    }

    fn index_for(kind: ResidenceNeedKind) -> usize {
        match kind {
            ResidenceNeedKind::Firewood => 0,
        }
    }
}

pub fn build_supply_context(
    tick: &SimTickContext,
    ctx: &ReducerContext,
    residence: &Residence,
) -> ResidenceNeedSupplyContext {
    let has_firewood_route = tick.road_network(residence.owner).is_some_and(|network| {
        let lodges = owner_lodges(ctx, residence.owner);
        let claims = claim_residences_for_lodges(network, &lodges, std::slice::from_ref(residence));
        claims.contains_key(&residence.id)
    });

    let mut routes = [false; ResidenceNeedKind::ALL.len()];
    routes[ResidenceNeedSupplyContext::index_for(ResidenceNeedKind::Firewood)] =
        has_firewood_route;
    ResidenceNeedSupplyContext { routes }
}
