//! Per-tick caches shared across simulation steps.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use spacetimedb::{Identity, ReducerContext};

use crate::balance_generated::{
    CATTLE_PLOUGH_WORK_MULTIPLIER, MONASTERY_COVERAGE_RADIUS, MONASTERY_FEAST_ALE,
    MONASTERY_FEAST_FOOD,
};
use crate::db::*;
use crate::economy::CommodityKind;
use crate::farming::{
    field_manure_required, field_seed_crop, field_seed_grain_remaining, CROP_BARLEY,
};
use crate::monastery_hospitality_policy::monastery_feast_surplus;
use crate::raid_agent_policy::combat_agent_is_active_raider_threat;
use crate::resident_welfare_policy::CorpseSpatialIndex;
use crate::roads::RoadNetwork;
use crate::simulation::fires::{FIRE_TARGET_BUILDING, FIRE_TARGET_RESIDENCE};
use crate::simulation::residence_needs::ResidenceNeedKind;
use crate::simulation::road_logistics::claim_residences_by_nearest_supplier;
use crate::supply_policy::{
    is_firewood_supplier_delivery_operational, is_food_supplier_operational,
    is_specialty_supplier_delivery_operational, is_well_supplier_operational,
    ALE_SUPPLIER_KINDS, CLOTH_SUPPLIER_KINDS, POTTERY_SUPPLIER_KINDS,
    PRESERVED_FOOD_SUPPLIER_KINDS,
};
use crate::tables::{corpse, farm_field, livestock_herd, Building, Residence};

#[derive(Default)]
struct OwnerBuildingIndex {
    all: Vec<u64>,
    by_kind: HashMap<String, Vec<u64>>,
    construction_timber: Vec<u64>,
    construction_stone: Vec<u64>,
    construction_ironwork: Vec<u64>,
    construction_roof_tiles: Vec<u64>,
}

pub type SharedRoadNetworks = Arc<HashMap<Identity, RoadNetwork>>;

pub struct SimTickContext {
    road_networks: SharedRoadNetworks,
    building_index: RefCell<Option<HashMap<Identity, OwnerBuildingIndex>>>,
    active_raider_threat_by_owner: RefCell<HashMap<Identity, bool>>,
    sabbath_observance_by_owner: RefCell<HashMap<Identity, bool>>,
    monastery_hospitality_by_owner: RefCell<HashMap<Identity, bool>>,
    staffed_chapel_by_owner: RefCell<HashMap<Identity, bool>>,
    chapel_claims: RefCell<HashMap<Identity, HashMap<u64, u64>>>,
    monastery_claims: RefCell<HashMap<Identity, HashMap<u64, u64>>>,
    disabled_fire_targets: RefCell<Option<HashSet<(u8, u64)>>>,
    firewood_claims: RefCell<HashMap<Identity, HashMap<u64, u64>>>,
    water_claims: RefCell<HashMap<Identity, HashMap<u64, u64>>>,
    food_claims: RefCell<HashMap<Identity, HashMap<u64, u64>>>,
    food_claim_counts: RefCell<HashMap<Identity, HashMap<u64, u32>>>,
    marketplace_claims: RefCell<HashMap<Identity, HashMap<u64, u64>>>,
    specialty_claims: RefCell<HashMap<(Identity, ResidenceNeedKind), HashMap<u64, u64>>>,
    active_remote_camp_by_worksite: RefCell<HashMap<(Identity, u64), bool>>,
    waiting_corpse_index: RefCell<Option<HashMap<Identity, CorpseSpatialIndex>>>,
    farmstead_seed_reserves: RefCell<HashMap<Identity, HashMap<u64, f64>>>,
    farmstead_barley_seed_reserves: RefCell<HashMap<Identity, HashMap<u64, f64>>>,
    farmstead_manure_requirements: RefCell<HashMap<Identity, HashMap<u64, (f64, u8)>>>,
    cattle_field_sources_by_owner: RefCell<HashMap<Identity, HashMap<u64, Vec<u64>>>>,
}

impl SimTickContext {
    pub fn new(ctx: &ReducerContext) -> Self {
        Self::with_road_networks(Self::load_road_networks(ctx))
    }

    /// Road rows cannot change inside one simulation reducer transaction.
    /// Parsing their JSON and rebuilding graph/spatial indexes once lets the
    /// delivery heartbeat and every economy substep share immutable networks,
    /// while each context below still owns fresh mutable simulation caches.
    pub fn load_road_networks(ctx: &ReducerContext) -> SharedRoadNetworks {
        let mut road_networks = HashMap::new();
        for state in ctx.db.road_network_state().iter() {
            if let Some(network) = RoadNetwork::from_snapshot_json(&state.snapshot_json) {
                road_networks.insert(state.owner, network);
            }
        }
        Arc::new(road_networks)
    }

    pub fn with_road_networks(road_networks: SharedRoadNetworks) -> Self {
        Self {
            road_networks,
            building_index: RefCell::new(None),
            active_raider_threat_by_owner: RefCell::new(HashMap::new()),
            sabbath_observance_by_owner: RefCell::new(HashMap::new()),
            monastery_hospitality_by_owner: RefCell::new(HashMap::new()),
            staffed_chapel_by_owner: RefCell::new(HashMap::new()),
            chapel_claims: RefCell::new(HashMap::new()),
            monastery_claims: RefCell::new(HashMap::new()),
            disabled_fire_targets: RefCell::new(None),
            firewood_claims: RefCell::new(HashMap::new()),
            water_claims: RefCell::new(HashMap::new()),
            food_claims: RefCell::new(HashMap::new()),
            food_claim_counts: RefCell::new(HashMap::new()),
            marketplace_claims: RefCell::new(HashMap::new()),
            specialty_claims: RefCell::new(HashMap::new()),
            active_remote_camp_by_worksite: RefCell::new(HashMap::new()),
            waiting_corpse_index: RefCell::new(None),
            farmstead_seed_reserves: RefCell::new(HashMap::new()),
            farmstead_barley_seed_reserves: RefCell::new(HashMap::new()),
            farmstead_manure_requirements: RefCell::new(HashMap::new()),
            cattle_field_sources_by_owner: RefCell::new(HashMap::new()),
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

    /// A handful of exposed yards may replace their household commute with a
    /// separately constructed camp. Cache the owner-local lookup for the
    /// substep while reading completion and fire state from current rows.
    pub fn worksite_has_active_remote_camp(
        &self,
        ctx: &ReducerContext,
        owner: Identity,
        worksite_id: u64,
    ) -> bool {
        if let Some(active) = self
            .active_remote_camp_by_worksite
            .borrow()
            .get(&(owner, worksite_id))
            .copied()
        {
            return active;
        }
        let active = self
            .building_ids_for_kinds(ctx, owner, &["remote_work_camp"])
            .into_iter()
            .filter_map(|camp_id| ctx.db.building().id().find(&camp_id))
            .any(|camp| {
                camp.linked_worksite_id == worksite_id
                    && camp.construction_complete
                    && !self.building_disabled_by_fire(ctx, camp.id)
            });
        self.active_remote_camp_by_worksite
            .borrow_mut()
            .insert((owner, worksite_id), active);
        active
    }

    /// Combat rows cannot change during the economy phase of one simulation
    /// substep. Every producer, worksite, and cart therefore shares one
    /// owner-indexed scan while hostile agents move and fight in the earlier
    /// combat phase. Returning guards and downed raiders do not extend the
    /// civilian emergency stop.
    pub fn owner_has_active_raider_threat(&self, ctx: &ReducerContext, owner: Identity) -> bool {
        if let Some(active) = self
            .active_raider_threat_by_owner
            .borrow()
            .get(&owner)
            .copied()
        {
            return active;
        }
        let active = ctx.db.combat_agent().owner().filter(&owner).any(|agent| {
            combat_agent_is_active_raider_threat(agent.faction, agent.state, agent.health)
        });
        self.active_raider_threat_by_owner
            .borrow_mut()
            .insert(owner, active);
        active
    }

    /// Owner policy cannot change inside one simulation reducer transaction.
    /// Chapel, residence, construction, and economy steps can therefore share
    /// one indexed policy read per owner for the whole substep.
    pub fn sabbath_observance_enabled(&self, ctx: &ReducerContext, owner: Identity) -> bool {
        if let Some(enabled) = self
            .sabbath_observance_by_owner
            .borrow()
            .get(&owner)
            .copied()
        {
            return enabled;
        }
        let enabled = ctx
            .db
            .player_resources()
            .owner()
            .find(&owner)
            .map(|resources| resources.sabbath_observance_enabled)
            .unwrap_or(false);
        self.sabbath_observance_by_owner
            .borrow_mut()
            .insert(owner, enabled);
        enabled
    }

    /// The settlement-wide monastery policy cannot change inside one simulation
    /// transaction. Apiaries, vineyards, and monasteries therefore share one
    /// authoritative policy read rather than querying the player row per site.
    pub fn monastery_hospitality_enabled(&self, ctx: &ReducerContext, owner: Identity) -> bool {
        if let Some(enabled) = self
            .monastery_hospitality_by_owner
            .borrow()
            .get(&owner)
            .copied()
        {
            return enabled;
        }
        let enabled = ctx
            .db
            .player_resources()
            .owner()
            .find(&owner)
            .map(|resources| resources.monastery_feasts_enabled)
            .unwrap_or(false);
        self.monastery_hospitality_by_owner
            .borrow_mut()
            .insert(owner, enabled);
        enabled
    }

    /// Staffed-chapel state is shared by every Sunday schedule check. The
    /// owner building index narrows the authoritative row reads to chapels,
    /// avoiding a full building-table scan for every producer and cart.
    pub fn owner_has_staffed_chapel(&self, ctx: &ReducerContext, owner: Identity) -> bool {
        if let Some(staffed) = self.staffed_chapel_by_owner.borrow().get(&owner).copied() {
            return staffed;
        }
        let staffed = self
            .building_ids_for_kinds(ctx, owner, &["chapel"])
            .into_iter()
            .filter_map(|building_id| ctx.db.building().id().find(&building_id))
            .any(|building| {
                building.construction_complete
                    && building.assigned_labor > 0
                    && !self.building_disabled_by_fire(ctx, building.id)
            });
        self.staffed_chapel_by_owner
            .borrow_mut()
            .insert(owner, staffed);
        staffed
    }

    /// Construction may complete a chapel after an earlier site has already
    /// queried the Sunday schedule. Forget only that owner's derived chapel
    /// state so later phases preserve the previous fresh-read semantics.
    pub fn invalidate_staffed_chapel(&self, owner: Identity) {
        self.staffed_chapel_by_owner.borrow_mut().remove(&owner);
        self.chapel_claims.borrow_mut().remove(&owner);
        self.monastery_claims.borrow_mut().remove(&owner);
    }

    /// Return the one staffed chapel claiming this home by shortest exact road
    /// route. A stable chapel id resolves equal-distance borders, so tithes,
    /// settlement support, and parish relief all share deterministic,
    /// non-overlapping territories.
    pub fn chapel_for_residence(
        &self,
        ctx: &ReducerContext,
        owner: Identity,
        residence_id: u64,
    ) -> Option<u64> {
        if !self.chapel_claims.borrow().contains_key(&owner) {
            let claims = self.build_chapel_claims(ctx, owner);
            self.chapel_claims.borrow_mut().insert(owner, claims);
        }
        self.chapel_claims
            .borrow()
            .get(&owner)
            .and_then(|claims| claims.get(&residence_id))
            .copied()
    }

    fn build_chapel_claims(&self, ctx: &ReducerContext, owner: Identity) -> HashMap<u64, u64> {
        let Some(network) = self.road_network(owner) else {
            return HashMap::new();
        };
        let chapels: Vec<Building> = self
            .building_ids_for_kinds(ctx, owner, &["chapel"])
            .into_iter()
            .filter_map(|building_id| ctx.db.building().id().find(&building_id))
            .filter(|chapel| {
                chapel.kind == "chapel"
                    && chapel.construction_complete
                    && chapel.assigned_labor > 0
                    && !self.building_disabled_by_fire(ctx, chapel.id)
            })
            .collect();
        let residences: Vec<Residence> = ctx
            .db
            .residence()
            .owner()
            .filter(&owner)
            .filter(|residence| !self.residence_disabled_by_fire(ctx, residence.id))
            .collect();
        let chapel_refs: Vec<&Building> = chapels.iter().collect();
        claim_residences_by_nearest_supplier(network, &chapel_refs, &residences, |_, _, _| true)
    }

    /// Return the nearest eligible Pauline monastery serving this household.
    ///
    /// A home must first belong to a staffed, fire-safe road parish. Monasteries
    /// must be complete, fire-safe, linked to at least one such chapel, and
    /// within their physical road coverage. One batched road tree per
    /// monastery replaces the former pairwise searches repeated by chapel and
    /// residence steps, while exact distance and stable id prevent overlapping
    /// houses from receiving duplicate community or feast benefits.
    pub fn monastery_for_residence(
        &self,
        ctx: &ReducerContext,
        owner: Identity,
        residence_id: u64,
    ) -> Option<u64> {
        if !self.monastery_claims.borrow().contains_key(&owner) {
            let claims = self.build_monastery_claims(ctx, owner);
            self.monastery_claims.borrow_mut().insert(owner, claims);
        }
        self.monastery_claims
            .borrow()
            .get(&owner)
            .and_then(|claims| claims.get(&residence_id))
            .copied()
    }

    fn build_monastery_claims(&self, ctx: &ReducerContext, owner: Identity) -> HashMap<u64, u64> {
        let Some(network) = self.road_network(owner) else {
            return HashMap::new();
        };
        if !self.chapel_claims.borrow().contains_key(&owner) {
            let claims = self.build_chapel_claims(ctx, owner);
            self.chapel_claims.borrow_mut().insert(owner, claims);
        }
        let parish_residences = self
            .chapel_claims
            .borrow()
            .get(&owner)
            .map(|claims| claims.keys().copied().collect::<HashSet<_>>())
            .unwrap_or_default();
        if parish_residences.is_empty() {
            return HashMap::new();
        }

        let chapels: Vec<Building> = self
            .building_ids_for_kinds(ctx, owner, &["chapel"])
            .into_iter()
            .filter_map(|building_id| ctx.db.building().id().find(&building_id))
            .filter(|chapel| {
                chapel.kind == "chapel"
                    && chapel.construction_complete
                    && chapel.assigned_labor > 0
                    && !self.building_disabled_by_fire(ctx, chapel.id)
            })
            .collect();
        let monasteries: Vec<Building> = self
            .building_ids_for_kinds(ctx, owner, &["monastery"])
            .into_iter()
            .filter_map(|building_id| ctx.db.building().id().find(&building_id))
            .filter(|monastery| {
                monastery.kind == "monastery"
                    && monastery.construction_complete
                    && !self.building_disabled_by_fire(ctx, monastery.id)
                    && chapels.iter().any(|chapel| {
                        network.road_connected(monastery.x, monastery.z, chapel.x, chapel.z)
                    })
            })
            .collect();
        if monasteries.is_empty() {
            return HashMap::new();
        }
        let residences: Vec<Residence> = ctx
            .db
            .residence()
            .owner()
            .filter(&owner)
            .filter(|residence| !self.residence_disabled_by_fire(ctx, residence.id))
            .collect();
        let monastery_refs: Vec<&Building> = monasteries.iter().collect();
        claim_residences_by_nearest_supplier(
            network,
            &monastery_refs,
            &residences,
            |_, residence, distance| {
                parish_residences.contains(&residence.id) && distance <= MONASTERY_COVERAGE_RADIUS
            },
        )
    }

    /// Fire incidents are immutable after `step_fires` for the rest of an
    /// economy substep. One lazy set therefore replaces a target-index query
    /// for every production building, household, and logistics candidate.
    pub fn building_disabled_by_fire(&self, ctx: &ReducerContext, building_id: u64) -> bool {
        self.target_disabled_by_fire(ctx, FIRE_TARGET_BUILDING, building_id)
    }

    pub fn residence_disabled_by_fire(&self, ctx: &ReducerContext, residence_id: u64) -> bool {
        self.target_disabled_by_fire(ctx, FIRE_TARGET_RESIDENCE, residence_id)
    }

    fn target_disabled_by_fire(
        &self,
        ctx: &ReducerContext,
        target_kind: u8,
        target_id: u64,
    ) -> bool {
        if self.disabled_fire_targets.borrow().is_none() {
            let targets = ctx
                .db
                .fire_incident()
                .iter()
                .map(|incident| (incident.target_kind, incident.target_id))
                .collect();
            *self.disabled_fire_targets.borrow_mut() = Some(targets);
        }
        self.disabled_fire_targets
            .borrow()
            .as_ref()
            .is_some_and(|targets| targets.contains(&(target_kind, target_id)))
    }

    /// Returns candidate ids from one owner-wide building scan performed only
    /// if a simulation step needs role-based logistics. Callers still fetch
    /// every row by primary key, so stock, labor, completion, fire state, and
    /// inbound-cart changes made earlier in the substep remain authoritative.
    pub fn building_ids_for_kinds(
        &self,
        ctx: &ReducerContext,
        owner: Identity,
        kinds: &[&str],
    ) -> Vec<u64> {
        self.ensure_building_index(ctx);
        let index = self.building_index.borrow();
        let Some(owner_index) = index.as_ref().and_then(|owners| owners.get(&owner)) else {
            return Vec::new();
        };
        kinds
            .iter()
            .flat_map(|kind| {
                owner_index
                    .by_kind
                    .get(*kind)
                    .into_iter()
                    .flat_map(|ids| ids.iter().copied())
            })
            .collect()
    }

    pub fn owner_building_ids(&self, ctx: &ReducerContext, owner: Identity) -> Vec<u64> {
        self.ensure_building_index(ctx);
        self.building_index
            .borrow()
            .as_ref()
            .and_then(|owners| owners.get(&owner))
            .map(|owner_index| owner_index.all.clone())
            .unwrap_or_default()
    }

    /// Construction runs before production in each substep, so its initially
    /// stocked source roster can only shrink as carts load. Fresh row reads
    /// below still reject depleted or newly busy sources for every site.
    pub fn construction_source_ids(
        &self,
        ctx: &ReducerContext,
        owner: Identity,
        commodity: CommodityKind,
    ) -> Vec<u64> {
        self.ensure_building_index(ctx);
        self.building_index
            .borrow()
            .as_ref()
            .and_then(|owners| owners.get(&owner))
            .map(|owner_index| match commodity {
                CommodityKind::Timber => owner_index.construction_timber.clone(),
                CommodityKind::Stone => owner_index.construction_stone.clone(),
                CommodityKind::Ironwork => owner_index.construction_ironwork.clone(),
                CommodityKind::RoofTiles => owner_index.construction_roof_tiles.clone(),
                _ => Vec::new(),
            })
            .unwrap_or_default()
    }

    fn ensure_building_index(&self, ctx: &ReducerContext) {
        if self.building_index.borrow().is_some() {
            return;
        }
        let mut owners: HashMap<Identity, OwnerBuildingIndex> = HashMap::new();
        for building in ctx.db.building().iter() {
            let owner_index = owners.entry(building.owner).or_default();
            owner_index.all.push(building.id);
            if building.timber > 1e-6 {
                owner_index.construction_timber.push(building.id);
            }
            if building.stone > 1e-6 {
                owner_index.construction_stone.push(building.id);
            }
            if building.ironwork > 1e-6 {
                owner_index.construction_ironwork.push(building.id);
            }
            if building.roof_tiles > 1e-6 {
                owner_index.construction_roof_tiles.push(building.id);
            }
            owner_index
                .by_kind
                .entry(building.kind)
                .or_default()
                .push(building.id);
        }
        for owner_index in owners.values_mut() {
            owner_index.all.sort_unstable();
            owner_index.construction_timber.sort_unstable();
            owner_index.construction_stone.sort_unstable();
            owner_index.construction_ironwork.sort_unstable();
            owner_index.construction_roof_tiles.sort_unstable();
            for ids in owner_index.by_kind.values_mut() {
                ids.sort_unstable();
            }
        }
        *self.building_index.borrow_mut() = Some(owners);
    }

    /// Returns protected seed for one farmstead from an owner-wide field scan
    /// performed at most once per simulation substep. Processor input searches
    /// can inspect many candidate farms, so querying each farm's index inside
    /// the candidate loop would multiply field scans by processor count.
    pub fn farmstead_seed_reserve_for(
        &self,
        ctx: &ReducerContext,
        owner: Identity,
        farmstead_id: u64,
    ) -> f64 {
        self.ensure_farmstead_seed_reserves(ctx, owner);
        self.farmstead_seed_reserves
            .borrow()
            .get(&owner)
            .and_then(|reserves| reserves.get(&farmstead_id))
            .copied()
            .unwrap_or(0.0)
    }

    pub fn farmstead_barley_seed_reserve_for(
        &self,
        ctx: &ReducerContext,
        owner: Identity,
        farmstead_id: u64,
    ) -> f64 {
        self.ensure_farmstead_seed_reserves(ctx, owner);
        self.farmstead_barley_seed_reserves
            .borrow()
            .get(&owner)
            .and_then(|reserves| reserves.get(&farmstead_id))
            .copied()
            .unwrap_or(0.0)
    }

    /// Keeps the cache current when this substep advances field work after a
    /// processor has already caused the owner-wide reserve map to be built.
    pub fn set_farmstead_seed_reserve(
        &self,
        ctx: &ReducerContext,
        owner: Identity,
        farmstead_id: u64,
        reserve: f64,
    ) {
        self.ensure_farmstead_seed_reserves(ctx, owner);
        self.farmstead_seed_reserves
            .borrow_mut()
            .entry(owner)
            .or_default()
            .insert(farmstead_id, reserve.max(0.0));
    }

    pub fn set_farmstead_barley_seed_reserve(
        &self,
        ctx: &ReducerContext,
        owner: Identity,
        farmstead_id: u64,
        reserve: f64,
    ) {
        self.ensure_farmstead_seed_reserves(ctx, owner);
        self.farmstead_barley_seed_reserves
            .borrow_mut()
            .entry(owner)
            .or_default()
            .insert(farmstead_id, reserve.max(0.0));
    }

    fn ensure_farmstead_seed_reserves(&self, ctx: &ReducerContext, owner: Identity) {
        if self.farmstead_seed_reserves.borrow().contains_key(&owner) {
            return;
        }
        let mut reserves = HashMap::new();
        let mut barley_reserves = HashMap::new();
        for field in ctx.db.farm_field().owner().filter(&owner) {
            let reserve = field_seed_grain_remaining(
                field.area,
                field.crop,
                field.next_crop,
                field.stage,
                field.stage_progress,
                field.priority,
            );
            if field_seed_crop(field.crop, field.next_crop, field.stage) == CROP_BARLEY {
                *barley_reserves.entry(field.farmstead_id).or_insert(0.0) += reserve;
            } else {
                *reserves.entry(field.farmstead_id).or_insert(0.0) += reserve;
            }
        }
        self.farmstead_seed_reserves
            .borrow_mut()
            .insert(owner, reserves);
        self.farmstead_barley_seed_reserves
            .borrow_mut()
            .insert(owner, barley_reserves);
    }

    /// Cattle select at most a handful of priority fields from geometry and
    /// priority state that cannot change inside this simulation substep. Cache
    /// those candidate source ids once per owner, but reload every herd below:
    /// livestock care earlier in the same substep may still change whether its
    /// headcount, health, or supplied capacity qualifies for ox work.
    pub fn cattle_field_support_for(
        &self,
        ctx: &ReducerContext,
        owner: Identity,
        field_id: u64,
    ) -> Option<f64> {
        self.ensure_cattle_field_sources(ctx, owner);
        let source_ids = self
            .cattle_field_sources_by_owner
            .borrow()
            .get(&owner)
            .and_then(|sources| sources.get(&field_id))
            .cloned()
            .unwrap_or_default();
        source_ids
            .into_iter()
            .filter_map(|building_id| ctx.db.livestock_herd().building_id().find(&building_id))
            .any(|herd| {
                crate::livestock_policy::cattle_field_support_is_active(
                    herd.species,
                    herd.head_count,
                    herd.health,
                    herd.supplied_capacity,
                )
            })
            .then_some(CATTLE_PLOUGH_WORK_MULTIPLIER)
    }

    /// Active fields share one owner-wide requirement scan. Cattle holdings
    /// can then compare crop farmsteads without multiplying field scans by
    /// source count; live building stock and inbound carts are still reloaded
    /// for every dispatch decision.
    pub fn farmstead_manure_requirement_for(
        &self,
        ctx: &ReducerContext,
        owner: Identity,
        farmstead_id: u64,
    ) -> (f64, u8) {
        self.ensure_farmstead_manure_requirements(ctx, owner);
        self.farmstead_manure_requirements
            .borrow()
            .get(&owner)
            .and_then(|requirements| requirements.get(&farmstead_id))
            .copied()
            .unwrap_or((0.0, 0))
    }

    fn ensure_farmstead_manure_requirements(&self, ctx: &ReducerContext, owner: Identity) {
        if self
            .farmstead_manure_requirements
            .borrow()
            .contains_key(&owner)
        {
            return;
        }
        let mut requirements: HashMap<u64, (f64, u8)> = HashMap::new();
        for field in ctx.db.farm_field().owner().filter(&owner) {
            if field.priority == 0 {
                continue;
            }
            let remaining =
                (field_manure_required(field.area) - field.manure_applied.max(0.0)).max(0.0);
            if remaining <= 1e-6 {
                continue;
            }
            let entry = requirements.entry(field.farmstead_id).or_insert((0.0, 0));
            entry.0 += remaining;
            entry.1 = entry.1.max(field.priority);
        }
        self.farmstead_manure_requirements
            .borrow_mut()
            .insert(owner, requirements);
    }

    fn ensure_cattle_field_sources(&self, ctx: &ReducerContext, owner: Identity) {
        if self
            .cattle_field_sources_by_owner
            .borrow()
            .contains_key(&owner)
        {
            return;
        }
        let sources = crate::simulation::livestock::cattle_field_support_sources(ctx, owner);
        self.cattle_field_sources_by_owner
            .borrow_mut()
            .insert(owner, sources);
    }

    /// Returns the one routine firewood distributor assigned to this household.
    /// Building steps and abandoned-home recovery share this lazily built map,
    /// avoiding one full territory rebuild for every lodge and storehouse.
    pub fn firewood_supplier_for(
        &self,
        ctx: &ReducerContext,
        owner: Identity,
        residence_id: u64,
    ) -> Option<u64> {
        if !self.firewood_claims.borrow().contains_key(&owner) {
            let claims = self.build_firewood_claims(ctx, owner);
            self.firewood_claims.borrow_mut().insert(owner, claims);
        }
        self.firewood_claims
            .borrow()
            .get(&owner)
            .and_then(|claims| claims.get(&residence_id))
            .copied()
    }

    /// Returns the nearest completed well claimed by this household. The well's
    /// physical service extent remains part of the authoritative claim.
    pub fn well_supplier_for(
        &self,
        ctx: &ReducerContext,
        owner: Identity,
        residence_id: u64,
    ) -> Option<u64> {
        if !self.water_claims.borrow().contains_key(&owner) {
            let claims = self.build_water_claims(ctx, owner);
            self.water_claims.borrow_mut().insert(owner, claims);
        }
        self.water_claims
            .borrow()
            .get(&owner)
            .and_then(|claims| claims.get(&residence_id))
            .copied()
    }

    /// Returns the one routine food distributor assigned to this household.
    /// Paid marketplace emergency orders intentionally bypass these claims.
    pub fn food_supplier_for(
        &self,
        ctx: &ReducerContext,
        owner: Identity,
        residence_id: u64,
    ) -> Option<u64> {
        self.ensure_food_claims(ctx, owner);
        self.food_claims
            .borrow()
            .get(&owner)
            .and_then(|claims| claims.get(&residence_id))
            .copied()
    }

    /// Returns the nearest operational marketplace by exact road distance.
    /// Garden trade and emergency household orders share this once-per-owner
    /// territory map, so adding spatially useful markets matters without
    /// repeating Dijkstra searches in each economy pass.
    pub fn marketplace_for_residence(
        &self,
        ctx: &ReducerContext,
        owner: Identity,
        residence_id: u64,
    ) -> Option<u64> {
        if !self.marketplace_claims.borrow().contains_key(&owner) {
            let claims = self.build_marketplace_claims(ctx, owner);
            self.marketplace_claims.borrow_mut().insert(owner, claims);
        }
        self.marketplace_claims
            .borrow()
            .get(&owner)
            .and_then(|claims| claims.get(&residence_id))
            .copied()
    }

    /// Returns how many households depend on a routine food supplier. Granary
    /// surplus intake uses this cached inverse count to protect local cart loads
    /// without rescanning all homes for every candidate source.
    pub fn food_claim_count_for_supplier(
        &self,
        ctx: &ReducerContext,
        owner: Identity,
        supplier_id: u64,
    ) -> u32 {
        self.ensure_food_claims(ctx, owner);
        if !self.food_claim_counts.borrow().contains_key(&owner) {
            let counts = {
                let claims_by_owner = self.food_claims.borrow();
                let mut counts = HashMap::new();
                if let Some(claims) = claims_by_owner.get(&owner) {
                    for supplier_id in claims.values() {
                        let count = counts.entry(*supplier_id).or_insert(0_u32);
                        *count = count.saturating_add(1);
                    }
                }
                counts
            };
            self.food_claim_counts.borrow_mut().insert(owner, counts);
        }
        self.food_claim_counts
            .borrow()
            .get(&owner)
            .and_then(|counts| counts.get(&supplier_id))
            .copied()
            .unwrap_or(0)
    }

    fn ensure_food_claims(&self, ctx: &ReducerContext, owner: Identity) {
        if self.food_claims.borrow().contains_key(&owner) {
            return;
        }
        let claims = self.build_food_claims(ctx, owner);
        self.food_claims.borrow_mut().insert(owner, claims);
    }

    fn build_firewood_claims(&self, ctx: &ReducerContext, owner: Identity) -> HashMap<u64, u64> {
        let Some(network) = self.road_network(owner) else {
            return HashMap::new();
        };
        let suppliers: Vec<Building> = self
            .building_ids_for_kinds(ctx, owner, &["marketplace"])
            .into_iter()
            .filter_map(|building_id| ctx.db.building().id().find(&building_id))
            .filter(|building| {
                !self.building_disabled_by_fire(ctx, building.id)
                    && is_firewood_supplier_delivery_operational(
                        &building.kind,
                        building.construction_complete,
                        building.assigned_labor,
                        building.storehouse_accepts_firewood,
                    )
                    && self.marketplace_has_stall_workers(
                        ctx,
                        network,
                        building,
                        ResidenceNeedKind::Firewood,
                    )
            })
            .collect();
        let residences: Vec<Residence> = ctx
            .db
            .residence()
            .owner()
            .filter(&owner)
            .filter(|residence| !self.residence_disabled_by_fire(ctx, residence.id))
            .collect();
        crate::simulation::road_logistics::claim_residences_for_firewood_suppliers(
            network,
            &suppliers,
            &residences,
        )
    }

    fn build_water_claims(&self, ctx: &ReducerContext, owner: Identity) -> HashMap<u64, u64> {
        let Some(network) = self.road_network(owner) else {
            return HashMap::new();
        };
        let wells: Vec<Building> = self
            .building_ids_for_kinds(ctx, owner, &["well"])
            .into_iter()
            .filter_map(|building_id| ctx.db.building().id().find(&building_id))
            .filter(|building| {
                !self.building_disabled_by_fire(ctx, building.id)
                    && is_well_supplier_operational(
                        &building.kind,
                        building.construction_complete,
                        building.assigned_labor,
                    )
            })
            .collect();
        let residences: Vec<Residence> = ctx
            .db
            .residence()
            .owner()
            .filter(&owner)
            .filter(|residence| !self.residence_disabled_by_fire(ctx, residence.id))
            .collect();
        crate::simulation::road_logistics::claim_residences_for_wells(network, &wells, &residences)
    }

    fn build_marketplace_claims(&self, ctx: &ReducerContext, owner: Identity) -> HashMap<u64, u64> {
        let Some(network) = self.road_network(owner) else {
            return HashMap::new();
        };
        let marketplaces: Vec<Building> = self
            .building_ids_for_kinds(ctx, owner, &["trading_post"])
            .into_iter()
            .filter_map(|building_id| ctx.db.building().id().find(&building_id))
            .filter(|building| {
                building.construction_complete
                    && building.assigned_labor > 0
                    && !self.building_disabled_by_fire(ctx, building.id)
            })
            .collect();
        let marketplace_refs: Vec<&Building> = marketplaces.iter().collect();
        let residences: Vec<Residence> = ctx
            .db
            .residence()
            .owner()
            .filter(&owner)
            .filter(|residence| {
                !residence.abandoned
                    && residence.population > 0
                    && !self.residence_disabled_by_fire(ctx, residence.id)
            })
            .collect();
        claim_residences_by_nearest_supplier(network, &marketplace_refs, &residences, |_, _, _| {
            true
        })
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

    pub fn invalidate_specialty_claims(&self, owner: Identity, need_kind: ResidenceNeedKind) {
        self.specialty_claims
            .borrow_mut()
            .remove(&(owner, need_kind));
    }

    /// Count bodies that have not yet been collected near one home. The
    /// owner-wide fixed-cell index is built at most once per simulation
    /// substep, then updated when a death occurs later in the residence pass.
    pub fn nearby_waiting_corpses(
        &self,
        ctx: &ReducerContext,
        owner: Identity,
        x: f64,
        z: f64,
        radius: f64,
    ) -> usize {
        self.ensure_waiting_corpse_index(ctx, radius);
        self.waiting_corpse_index
            .borrow()
            .as_ref()
            .and_then(|by_owner| by_owner.get(&owner))
            .map(|index| index.count_within(x, z, radius))
            .unwrap_or(0)
    }

    /// Keep the already-materialized disease index coherent when a later
    /// household in this same substep creates a new body.
    pub fn record_waiting_corpse(&self, owner: Identity, x: f64, z: f64, radius: f64) {
        let mut cached = self.waiting_corpse_index.borrow_mut();
        let Some(by_owner) = cached.as_mut() else {
            return;
        };
        by_owner
            .entry(owner)
            .or_insert_with(|| CorpseSpatialIndex::new(radius))
            .insert(x, z);
    }

    fn ensure_waiting_corpse_index(&self, ctx: &ReducerContext, radius: f64) {
        if self.waiting_corpse_index.borrow().is_some() {
            return;
        }
        let mut by_owner = HashMap::<Identity, CorpseSpatialIndex>::new();
        for corpse in ctx.db.corpse().iter().filter(|corpse| corpse.state <= 1) {
            by_owner
                .entry(corpse.owner)
                .or_insert_with(|| CorpseSpatialIndex::new(radius))
                .insert(corpse.x, corpse.z);
        }
        *self.waiting_corpse_index.borrow_mut() = Some(by_owner);
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
            ResidenceNeedKind::Cloth => CLOTH_SUPPLIER_KINDS,
            ResidenceNeedKind::Pottery => POTTERY_SUPPLIER_KINDS,
            _ => return HashMap::new(),
        };
        let buildings: Vec<Building> = self
            .owner_building_ids(ctx, owner)
            .into_iter()
            .filter_map(|building_id| ctx.db.building().id().find(&building_id))
            .collect();
        let chapels: Vec<&Building> = buildings
            .iter()
            .filter(|building| {
                building.kind == "chapel"
                    && building.construction_complete
                    && building.assigned_labor > 0
                    && !self.building_disabled_by_fire(ctx, building.id)
            })
            .collect();
        let reserve_enabled = self.monastery_hospitality_enabled(ctx, owner);
        let suppliers: Vec<&Building> = buildings
            .iter()
            .filter(|building| {
                is_specialty_supplier_delivery_operational(
                    &building.kind,
                    building.construction_complete,
                    building.assigned_labor,
                ) && !self.building_disabled_by_fire(ctx, building.id)
                    && supplier_kinds.contains(&building.kind.as_str())
                    && self.marketplace_has_stall_workers(ctx, network, building, need_kind)
                    && match need_kind {
                        ResidenceNeedKind::Ale => {
                            let available = if building.kind == "monastery" {
                                monastery_feast_surplus(
                                    building.ale,
                                    MONASTERY_FEAST_ALE,
                                    reserve_enabled,
                                )
                            } else {
                                building.ale
                            };
                            available > 1e-6
                        }
                        ResidenceNeedKind::PreservedFood => building.preserved_food > 1e-6,
                        ResidenceNeedKind::Cloth => building.cloth > 1e-6,
                        ResidenceNeedKind::Pottery => building.pottery > 1e-6,
                        _ => false,
                    }
                    && (building.kind != "monastery"
                        || chapels.iter().any(|chapel| {
                            network.road_connected(building.x, building.z, chapel.x, chapel.z)
                        }))
            })
            .collect();
        let residences: Vec<Residence> = ctx
            .db
            .residence()
            .owner()
            .filter(&owner)
            .filter(|residence| {
                !residence.abandoned
                    && residence.population > 0
                    && need_kind.is_active_for_tier(residence.tier)
                    && !self.residence_disabled_by_fire(ctx, residence.id)
            })
            .collect();
        let parish_residences: HashSet<u64> = residences
            .iter()
            .filter(|residence| {
                chapels.iter().any(|chapel| {
                    network.road_connected(residence.x, residence.z, chapel.x, chapel.z)
                })
            })
            .map(|residence| residence.id)
            .collect();

        claim_residences_by_nearest_supplier(
            network,
            &suppliers,
            &residences,
            |supplier, residence, distance| {
                supplier.kind != "monastery"
                    || (parish_residences.contains(&residence.id)
                        && distance <= MONASTERY_COVERAGE_RADIUS)
            },
        )
    }

    fn build_food_claims(&self, ctx: &ReducerContext, owner: Identity) -> HashMap<u64, u64> {
        let Some(network) = self.road_network(owner) else {
            return HashMap::new();
        };
        let buildings: Vec<Building> = self
            .owner_building_ids(ctx, owner)
            .into_iter()
            .filter_map(|building_id| ctx.db.building().id().find(&building_id))
            .collect();
        let chapels: Vec<&Building> = buildings
            .iter()
            .filter(|building| {
                building.kind == "chapel"
                    && building.construction_complete
                    && building.assigned_labor > 0
                    && !self.building_disabled_by_fire(ctx, building.id)
            })
            .collect();
        let reserve_enabled = self.monastery_hospitality_enabled(ctx, owner);
        let suppliers: Vec<&Building> = buildings
            .iter()
            .filter(|building| {
                is_food_supplier_operational(
                    &building.kind,
                    building.construction_complete,
                    building.assigned_labor,
                ) && !self.building_disabled_by_fire(ctx, building.id)
                    && self.marketplace_has_stall_workers(
                        ctx,
                        network,
                        building,
                        ResidenceNeedKind::Food,
                    )
                    && (if building.kind == "monastery" {
                        monastery_feast_surplus(
                            building.food,
                            MONASTERY_FEAST_FOOD,
                            reserve_enabled,
                        )
                    } else {
                        building.food
                    }) > 1e-6
                    && (building.kind != "monastery"
                        || chapels.iter().any(|chapel| {
                            network.road_connected(building.x, building.z, chapel.x, chapel.z)
                        }))
            })
            .collect();
        let residences: Vec<Residence> = ctx
            .db
            .residence()
            .owner()
            .filter(&owner)
            .filter(|residence| {
                !residence.abandoned
                    && residence.population > 0
                    && !self.residence_disabled_by_fire(ctx, residence.id)
            })
            .collect();
        let parish_residences: HashSet<u64> = residences
            .iter()
            .filter(|residence| {
                chapels.iter().any(|chapel| {
                    network.road_connected(residence.x, residence.z, chapel.x, chapel.z)
                })
            })
            .map(|residence| residence.id)
            .collect();

        claim_residences_by_nearest_supplier(
            network,
            &suppliers,
            &residences,
            |supplier, residence, distance| {
                supplier.kind != "monastery"
                    || (parish_residences.contains(&residence.id)
                        && distance <= MONASTERY_COVERAGE_RADIUS)
            },
        )
    }

    fn marketplace_has_stall_workers(
        &self,
        ctx: &ReducerContext,
        network: &crate::roads::RoadNetwork,
        marketplace: &Building,
        need_kind: ResidenceNeedKind,
    ) -> bool {
        if marketplace.kind != "marketplace" {
            return false;
        }
        let workplace_kind = match need_kind {
            ResidenceNeedKind::Food
            | ResidenceNeedKind::PreservedFood
            | ResidenceNeedKind::Ale => "granary",
            ResidenceNeedKind::Firewood
            | ResidenceNeedKind::Cloth
            | ResidenceNeedKind::Pottery => "village_storehouse",
            ResidenceNeedKind::Water => return false,
        };
        self.building_ids_for_kinds(ctx, marketplace.owner, &[workplace_kind])
            .into_iter()
            .filter_map(|id| ctx.db.building().id().find(&id))
            .any(|workplace| {
                workplace.construction_complete
                    && workplace.assigned_labor > 0
                    && !self.building_disabled_by_fire(ctx, workplace.id)
                    && crate::simulation::road_logistics::local_delivery_distance(
                        network,
                        workplace.x,
                        workplace.z,
                        marketplace.x,
                        marketplace.z,
                    )
                    .is_some()
            })
    }
}
