//! Per-tick caches shared across simulation steps.

use std::cell::RefCell;
use std::collections::HashMap;

use spacetimedb::{Identity, ReducerContext};

use crate::balance_generated::MONASTERY_COVERAGE_RADIUS;
use crate::db::*;
use crate::roads::RoadNetwork;
use crate::simulation::residence_needs::ResidenceNeedKind;
use crate::supply_policy::{
    compare_supply_route_candidates, ALE_SUPPLIER_KINDS, PRESERVED_FOOD_SUPPLIER_KINDS,
};
use crate::tables::{Building, Residence};

pub struct SimTickContext {
    road_networks: HashMap<Identity, RoadNetwork>,
    specialty_claims: RefCell<HashMap<(Identity, ResidenceNeedKind), HashMap<u64, u64>>>,
}

impl SimTickContext {
    pub fn new(ctx: &ReducerContext) -> Self {
        let mut road_networks = HashMap::new();
        for state in ctx.db.road_network_state().iter() {
            if let Some(network) = RoadNetwork::from_snapshot_json(&state.snapshot_json) {
                road_networks.insert(state.owner, network);
            }
        }
        Self {
            road_networks,
            specialty_claims: RefCell::new(HashMap::new()),
        }
    }

    pub fn road_network(&self, owner: Identity) -> Option<&RoadNetwork> {
        self.road_networks.get(&owner)
    }

    pub fn road_connected(&self, owner: Identity, ax: f64, az: f64, bx: f64, bz: f64) -> bool {
        self.road_network(owner)
            .map(|network| network.road_connected(ax, az, bx, bz))
            .unwrap_or(false)
    }

    /// Returns the single nearest supplier assigned to this tier-3 household.
    /// Claims are built lazily once per owner and need for the simulation
    /// substep, so every brewery/smokehouse does not repeat the same Dijkstra
    /// searches while the delivery heartbeat keeps its lightweight road cache.
    pub fn specialty_supplier_for(
        &self,
        ctx: &ReducerContext,
        owner: Identity,
        residence_id: u64,
        need_kind: ResidenceNeedKind,
    ) -> Option<u64> {
        let key = (owner, need_kind);
        if !self.specialty_claims.borrow().contains_key(&key) {
            let claims = self.build_specialty_claims(ctx, owner, need_kind);
            self.specialty_claims.borrow_mut().insert(key, claims);
        }
        self.specialty_claims
            .borrow()
            .get(&key)
            .and_then(|claims| claims.get(&residence_id))
            .copied()
    }

    fn build_specialty_claims(
        &self,
        ctx: &ReducerContext,
        owner: Identity,
        need_kind: ResidenceNeedKind,
    ) -> HashMap<u64, u64> {
        let Some(network) = self.road_network(owner) else {
            return HashMap::new();
        };
        let supplier_kinds = match need_kind {
            ResidenceNeedKind::Ale => ALE_SUPPLIER_KINDS,
            ResidenceNeedKind::PreservedFood => PRESERVED_FOOD_SUPPLIER_KINDS,
            _ => return HashMap::new(),
        };
        let buildings: Vec<Building> = ctx.db.building().owner().filter(&owner).collect();
        let chapels: Vec<&Building> = buildings
            .iter()
            .filter(|building| {
                building.kind == "chapel"
                    && building.construction_complete
                    && building.assigned_labor > 0
            })
            .collect();
        let suppliers: Vec<&Building> = buildings
            .iter()
            .filter(|building| {
                building.construction_complete
                    && supplier_kinds.contains(&building.kind.as_str())
                    && (building.kind != "monastery"
                        || chapels.iter().any(|chapel| {
                            network.road_connected(building.x, building.z, chapel.x, chapel.z)
                        }))
            })
            .collect();
        let residences: Vec<Residence> = ctx.db.residence().owner().filter(&owner).collect();
        let mut claims = HashMap::new();

        for residence in residences {
            if residence.abandoned
                || residence.population == 0
                || !need_kind.is_active_for_tier(residence.tier)
            {
                continue;
            }
            let residence_has_parish = chapels
                .iter()
                .any(|chapel| network.road_connected(residence.x, residence.z, chapel.x, chapel.z));
            let mut best: Option<(&Building, f64)> = None;
            for supplier in &suppliers {
                let Some(distance) =
                    network.road_path_distance(supplier.x, supplier.z, residence.x, residence.z)
                else {
                    continue;
                };
                if supplier.kind == "monastery"
                    && (!residence_has_parish || distance > MONASTERY_COVERAGE_RADIUS)
                {
                    continue;
                }
                let replace = match best {
                    None => true,
                    Some((current, current_distance)) => compare_supply_route_candidates(
                        distance,
                        supplier.id,
                        current_distance,
                        current.id,
                    )
                    .is_lt(),
                };
                if replace {
                    best = Some((supplier, distance));
                }
            }
            if let Some((supplier, _)) = best {
                claims.insert(residence.id, supplier.id);
            }
        }

        claims
    }
}
