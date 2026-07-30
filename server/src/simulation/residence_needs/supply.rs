use spacetimedb::ReducerContext;

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
            ResidenceNeedKind::Water => 1,
            ResidenceNeedKind::Food => 2,
            ResidenceNeedKind::PreservedFood => 3,
            ResidenceNeedKind::Ale => 4,
            ResidenceNeedKind::Cloth => 5,
            ResidenceNeedKind::Pottery => 6,
        }
    }
}

pub fn build_supply_context(
    tick: &SimTickContext,
    ctx: &ReducerContext,
    residence: &Residence,
) -> ResidenceNeedSupplyContext {
    let has_firewood_route = tick
        .firewood_supplier_for(ctx, residence.owner, residence.id)
        .is_some();
    let has_water_route = tick
        .well_supplier_for(ctx, residence.owner, residence.id)
        .is_some();
    let has_food_route = tick
        .food_supplier_for(ctx, residence.owner, residence.id)
        .is_some();
    let has_preserved_food_route = tick
        .specialty_supplier_for(
            ctx,
            residence.owner,
            residence.id,
            ResidenceNeedKind::PreservedFood,
        )
        .is_some();
    let has_ale_route = tick
        .specialty_supplier_for(ctx, residence.owner, residence.id, ResidenceNeedKind::Ale)
        .is_some();
    let has_cloth_route = tick
        .specialty_supplier_for(ctx, residence.owner, residence.id, ResidenceNeedKind::Cloth)
        .is_some();
    let has_pottery_route = tick
        .specialty_supplier_for(
            ctx,
            residence.owner,
            residence.id,
            ResidenceNeedKind::Pottery,
        )
        .is_some();

    let mut routes = [false; ResidenceNeedKind::ALL.len()];
    routes[ResidenceNeedSupplyContext::index_for(ResidenceNeedKind::Firewood)] = has_firewood_route;
    routes[ResidenceNeedSupplyContext::index_for(ResidenceNeedKind::Water)] = has_water_route;
    routes[ResidenceNeedSupplyContext::index_for(ResidenceNeedKind::Food)] = has_food_route;
    routes[ResidenceNeedSupplyContext::index_for(ResidenceNeedKind::PreservedFood)] =
        has_preserved_food_route;
    routes[ResidenceNeedSupplyContext::index_for(ResidenceNeedKind::Ale)] = has_ale_route;
    routes[ResidenceNeedSupplyContext::index_for(ResidenceNeedKind::Cloth)] = has_cloth_route;
    routes[ResidenceNeedSupplyContext::index_for(ResidenceNeedKind::Pottery)] = has_pottery_route;
    ResidenceNeedSupplyContext { routes }
}
