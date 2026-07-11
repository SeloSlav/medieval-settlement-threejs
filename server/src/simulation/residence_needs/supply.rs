use spacetimedb::ReducerContext;

use crate::simulation::road_logistics::{claim_residences_for_food_suppliers, owner_food_suppliers};
use crate::simulation::residence_needs::kinds::ResidenceNeedKind;
use crate::simulation::tick_context::SimTickContext;
use crate::simulation::well::residence_has_well_supply;
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
            ResidenceNeedKind::Water => 1,
            ResidenceNeedKind::Food => 2,
        }
    }
}

pub fn build_supply_context(
    tick: &SimTickContext,
    ctx: &ReducerContext,
    residence: &Residence,
) -> ResidenceNeedSupplyContext {
    let has_firewood_route = tick.road_network(residence.owner).is_some_and(|network| {
        let lodges = crate::simulation::road_logistics::owner_lodges(ctx, residence.owner);
        let claims = crate::simulation::road_logistics::claim_residences_for_lodges(
            network,
            &lodges,
            std::slice::from_ref(residence),
        );
        claims.contains_key(&residence.id)
    });
    let has_water_route = residence_has_well_supply(tick, ctx, residence.owner, residence);
    let has_food_route = tick.road_network(residence.owner).is_some_and(|network| {
        let suppliers = owner_food_suppliers(ctx, residence.owner);
        let claims = claim_residences_for_food_suppliers(network, &suppliers, std::slice::from_ref(residence));
        claims.contains_key(&residence.id)
    });

    let mut routes = [false; ResidenceNeedKind::ALL.len()];
    routes[ResidenceNeedSupplyContext::index_for(ResidenceNeedKind::Firewood)] =
        has_firewood_route;
    routes[ResidenceNeedSupplyContext::index_for(ResidenceNeedKind::Water)] = has_water_route;
    routes[ResidenceNeedSupplyContext::index_for(ResidenceNeedKind::Food)] = has_food_route;
    ResidenceNeedSupplyContext { routes }
}
