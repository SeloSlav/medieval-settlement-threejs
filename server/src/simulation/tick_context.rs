//! Per-tick caches shared across simulation steps.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use spacetimedb::{Identity, ReducerContext};

use crate::balance_generated::{
    CATTLE_PLOUGH_WORK_MULTIPLIER, MARKETPLACE_FOOD_STALL_SLOTS, MARKETPLACE_GOODS_STALL_SLOTS,
    MONASTERY_COVERAGE_RADIUS, MONASTERY_FEAST_FOOD,
};
use crate::db::*;
use crate::economy::{building_edible_food_stock, building_preserved_food_stock, CommodityKind};
use crate::farming::{
    field_manure_required, field_seed_crop, field_seed_grain_remaining, CROP_OATS, CROP_RYE,
    CROP_WHEAT,
};
use crate::monastery_hospitality_policy::monastery_feast_surplus;
use crate::raid_agent_policy::combat_agent_is_active_raider_threat;
use crate::resident_welfare_policy::CorpseSpatialIndex;
use crate::roads::RoadNetwork;
use crate::simulation::fires::{FIRE_TARGET_BUILDING, FIRE_TARGET_RESIDENCE};
use crate::simulation::residence_needs::ResidenceNeedKind;
use crate::simulation::road_logistics::claim_residences_by_nearest_supplier;
use crate::supply_policy::{is_food_supplier_operational, is_well_supplier_operational};
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

#[derive(Clone, Copy, Default)]
struct FarmsteadSeedReserves {
    rye: f64,
    oats: f64,
    maslin: f64,
}

const MARKET_STALL_GROUP_FOOD: u8 = 0;
const MARKET_STALL_GROUP_GOODS: u8 = 1;
const MARKET_FOOD_STALL_NEEDS: [ResidenceNeedKind; 3] = [
    ResidenceNeedKind::Food,
    ResidenceNeedKind::PreservedFood,
    ResidenceNeedKind::Ale,
];
const MARKET_GOODS_STALL_NEEDS: [ResidenceNeedKind; 3] = [
    ResidenceNeedKind::Firewood,
    ResidenceNeedKind::Cloth,
    ResidenceNeedKind::Pottery,
];

#[derive(Default)]
struct MarketplaceStallRoster {
    workplace_by_market_need: HashMap<(u64, ResidenceNeedKind), u64>,
    workers_by_market_group: HashMap<(u64, u8), Vec<u64>>,
}

#[derive(Clone, Copy)]
struct MarketplaceStallCandidate {
    marketplace_id: u64,
    workplace_id: u64,
    need_kind: ResidenceNeedKind,
    distance: f64,
    source_has_stock: bool,
}

impl FarmsteadSeedReserves {
    fn for_commodity(self, commodity: CommodityKind) -> f64 {
        match commodity {
            CommodityKind::RyeGrain => self.rye,
            CommodityKind::OatGrain => self.oats,
            CommodityKind::MaslinGrain => self.maslin,
            _ => 0.0,
        }
    }
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
    water_claims: RefCell<HashMap<Identity, HashMap<u64, u64>>>,
    food_claims: RefCell<HashMap<Identity, HashMap<u64, u64>>>,
    food_claim_counts: RefCell<HashMap<Identity, HashMap<u64, u32>>>,
    marketplace_claims: RefCell<HashMap<Identity, HashMap<u64, u64>>>,
    local_marketplace_claims: RefCell<HashMap<(Identity, ResidenceNeedKind), HashMap<u64, u64>>>,
    local_marketplace_deposit_claims:
        RefCell<HashMap<(Identity, ResidenceNeedKind), HashMap<u64, u64>>>,
    marketplace_stall_rosters: RefCell<HashMap<Identity, MarketplaceStallRoster>>,
    active_remote_camp_by_worksite: RefCell<HashMap<(Identity, u64), bool>>,
    waiting_corpse_index: RefCell<Option<HashMap<Identity, CorpseSpatialIndex>>>,
    farmstead_seed_reserves:
        RefCell<HashMap<Identity, HashMap<u64, FarmsteadSeedReserves>>>,
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
            water_claims: RefCell::new(HashMap::new()),
            food_claims: RefCell::new(HashMap::new()),
            food_claim_counts: RefCell::new(HashMap::new()),
            marketplace_claims: RefCell::new(HashMap::new()),
            local_marketplace_claims: RefCell::new(HashMap::new()),
            local_marketplace_deposit_claims: RefCell::new(HashMap::new()),
            marketplace_stall_rosters: RefCell::new(HashMap::new()),
            active_remote_camp_by_worksite: RefCell::new(HashMap::new()),
            waiting_corpse_index: RefCell::new(None),
            farmstead_seed_reserves: RefCell::new(HashMap::new()),
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
        commodity: CommodityKind,
    ) -> f64 {
        self.ensure_farmstead_seed_reserves(ctx, owner);
        self.farmstead_seed_reserves
            .borrow()
            .get(&owner)
            .and_then(|reserves| reserves.get(&farmstead_id))
            .copied()
            .unwrap_or_default()
            .for_commodity(commodity)
    }

    /// Keeps the cache current when this substep advances field work after a
    /// processor has already caused the owner-wide reserve map to be built.
    pub fn set_farmstead_seed_reserves(
        &self,
        ctx: &ReducerContext,
        owner: Identity,
        farmstead_id: u64,
        rye: f64,
        oats: f64,
        maslin: f64,
    ) {
        self.ensure_farmstead_seed_reserves(ctx, owner);
        self.farmstead_seed_reserves
            .borrow_mut()
            .entry(owner)
            .or_default()
            .insert(
                farmstead_id,
                FarmsteadSeedReserves {
                    rye: rye.max(0.0),
                    oats: oats.max(0.0),
                    maslin: maslin.max(0.0),
                },
            );
    }

    fn ensure_farmstead_seed_reserves(&self, ctx: &ReducerContext, owner: Identity) {
        if self.farmstead_seed_reserves.borrow().contains_key(&owner) {
            return;
        }
        let mut reserves: HashMap<u64, FarmsteadSeedReserves> = HashMap::new();
        for field in ctx.db.farm_field().owner().filter(&owner) {
            let reserve = field_seed_grain_remaining(
                field.area,
                field.crop,
                field.next_crop,
                field.stage,
                field.stage_progress,
                field.priority,
            );
            let farmstead_reserves = reserves.entry(field.farmstead_id).or_default();
            match field_seed_crop(field.crop, field.next_crop, field.stage) {
                CROP_RYE => farmstead_reserves.rye += reserve,
                CROP_OATS => farmstead_reserves.oats += reserve,
                CROP_WHEAT => farmstead_reserves.maslin += reserve,
                _ => {}
            }
        }
        self.farmstead_seed_reserves
            .borrow_mut()
            .insert(owner, reserves);
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

    /// Returns the nearest staffed Trading Post by exact road distance for
    /// emergency household imports. The save-compatible method name remains
    /// while regional trade is now physically separate from local markets.
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

    /// Returns the nearest stocked Marketplace. Workers are needed to restock
    /// ordinary stalls, but goods already at the square are issued to local
    /// households without a second last-mile labor requirement. Local
    /// household availability never comes from the regional Trading Post.
    pub fn local_marketplace_for_residence(
        &self,
        ctx: &ReducerContext,
        owner: Identity,
        residence_id: u64,
        stall_need: ResidenceNeedKind,
    ) -> Option<u64> {
        let key = (owner, stall_need);
        if !self.local_marketplace_claims.borrow().contains_key(&key) {
            let claims = self.build_local_marketplace_claims(ctx, owner, stall_need);
            self.local_marketplace_claims
                .borrow_mut()
                .insert(key, claims);
        }
        self.local_marketplace_claims
            .borrow()
            .get(&key)
            .and_then(|claims| claims.get(&residence_id))
            .copied()
    }

    /// Producer-side market claim. Unlike consumer availability, an empty
    /// staffed stall is a valid destination so the first garden can seed it.
    pub fn local_marketplace_for_residence_deposit(
        &self,
        ctx: &ReducerContext,
        owner: Identity,
        residence_id: u64,
        stall_need: ResidenceNeedKind,
    ) -> Option<u64> {
        let key = (owner, stall_need);
        if !self
            .local_marketplace_deposit_claims
            .borrow()
            .contains_key(&key)
        {
            let claims = self.build_local_marketplace_claims_for_deposit(ctx, owner, stall_need);
            self.local_marketplace_deposit_claims
                .borrow_mut()
                .insert(key, claims);
        }
        self.local_marketplace_deposit_claims
            .borrow()
            .get(&key)
            .and_then(|claims| claims.get(&residence_id))
            .copied()
    }

    /// Returns how many households depend on a routine food supplier. Granary
    /// surplus intake uses this cached inverse count to protect local market
    /// availability without rescanning all homes for every candidate source.
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

    fn build_local_marketplace_claims(
        &self,
        ctx: &ReducerContext,
        owner: Identity,
        stall_need: ResidenceNeedKind,
    ) -> HashMap<u64, u64> {
        let Some(network) = self.road_network(owner) else {
            return HashMap::new();
        };
        let marketplaces: Vec<Building> = self
            .building_ids_for_kinds(ctx, owner, &["marketplace"])
            .into_iter()
            .filter_map(|building_id| ctx.db.building().id().find(&building_id))
            .filter(|building| {
                building.construction_complete
                    && !self.building_disabled_by_fire(ctx, building.id)
                    && crate::simulation::delivery_cargo::building_delivery_stock(
                        building, stall_need,
                    ) > 1e-6
                    && self.marketplace_has_stall_workers(ctx, building, stall_need)
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
        claim_residences_by_nearest_supplier(
            network,
            &marketplace_refs,
            &residences,
            |marketplace, residence, _| {
                network.road_connected(marketplace.x, marketplace.z, residence.x, residence.z)
            },
        )
    }

    fn build_local_marketplace_claims_for_deposit(
        &self,
        ctx: &ReducerContext,
        owner: Identity,
        stall_need: ResidenceNeedKind,
    ) -> HashMap<u64, u64> {
        let Some(network) = self.road_network(owner) else {
            return HashMap::new();
        };
        let marketplaces: Vec<Building> = self
            .building_ids_for_kinds(ctx, owner, &["marketplace"])
            .into_iter()
            .filter_map(|building_id| ctx.db.building().id().find(&building_id))
            .filter(|building| {
                building.construction_complete
                    && !self.building_disabled_by_fire(ctx, building.id)
                    && self.marketplace_has_stall_workers_for_deposit(ctx, building, stall_need)
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
        claim_residences_by_nearest_supplier(
            network,
            &marketplace_refs,
            &residences,
            |marketplace, residence, _| {
                network.road_connected(marketplace.x, marketplace.z, residence.x, residence.z)
            },
        )
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
                        building,
                        ResidenceNeedKind::Food,
                    )
                    && (if building.kind == "monastery" {
                        monastery_feast_surplus(
                            (building_edible_food_stock(building) - building.honey.max(0.0))
                                .max(0.0),
                            MONASTERY_FEAST_FOOD,
                            reserve_enabled,
                        )
                    } else {
                        building_edible_food_stock(building)
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
                network.road_connected(supplier.x, supplier.z, residence.x, residence.z)
                    && (supplier.kind != "monastery"
                        || (parish_residences.contains(&residence.id)
                            && distance <= MONASTERY_COVERAGE_RADIUS))
            },
        )
    }

    pub(crate) fn marketplace_has_stall_workers(
        &self,
        ctx: &ReducerContext,
        marketplace: &Building,
        need_kind: ResidenceNeedKind,
    ) -> bool {
        self.marketplace_stall_workplace_id(ctx, marketplace, need_kind)
            .is_some()
    }

    pub(crate) fn marketplace_stall_workplace_id(
        &self,
        ctx: &ReducerContext,
        marketplace: &Building,
        need_kind: ResidenceNeedKind,
    ) -> Option<u64> {
        if marketplace.kind != "marketplace" || stall_group_for_need(need_kind).is_none() {
            return None;
        }
        self.ensure_marketplace_stall_roster(ctx, marketplace.owner);
        let rosters = self.marketplace_stall_rosters.borrow();
        let roster = rosters.get(&marketplace.owner)?;
        roster
            .workplace_by_market_need
            .get(&(marketplace.id, need_kind))
            .copied()
            .or_else(|| {
                (need_kind == ResidenceNeedKind::Food
                    && marketplace_stall_stock(marketplace, ResidenceNeedKind::Food) <= 1e-6)
                    .then(|| {
                        roster
                            .workplace_by_market_need
                            .get(&(marketplace.id, ResidenceNeedKind::PreservedFood))
                            .copied()
                    })
                    .flatten()
            })
    }

    pub(crate) fn marketplace_stall_workplace_id_for_commodity(
        &self,
        ctx: &ReducerContext,
        marketplace: &Building,
        commodity: CommodityKind,
    ) -> Option<u64> {
        let need_kind = stall_need_for_commodity(commodity)?;
        if marketplace.kind != "marketplace" {
            return None;
        }
        self.ensure_marketplace_stall_roster(ctx, marketplace.owner);
        self.marketplace_stall_rosters
            .borrow()
            .get(&marketplace.owner)?
            .workplace_by_market_need
            .get(&(marketplace.id, need_kind))
            .copied()
    }

    pub(crate) fn marketplace_any_goods_stall_workplace_id(
        &self,
        ctx: &ReducerContext,
        marketplace: &Building,
    ) -> Option<u64> {
        if marketplace.kind != "marketplace" {
            return None;
        }
        self.ensure_marketplace_stall_roster(ctx, marketplace.owner);
        let rosters = self.marketplace_stall_rosters.borrow();
        let roster = rosters.get(&marketplace.owner)?;
        MARKET_GOODS_STALL_NEEDS
            .iter()
            .find_map(|need_kind| {
                roster
                    .workplace_by_market_need
                    .get(&(marketplace.id, *need_kind))
                    .copied()
            })
            .or_else(|| {
                roster
                    .workers_by_market_group
                    .get(&(marketplace.id, MARKET_STALL_GROUP_GOODS))
                    .and_then(|workers| workers.first())
                    .copied()
            })
    }

    pub(crate) fn marketplace_stall_accepts_commodity_from(
        &self,
        ctx: &ReducerContext,
        marketplace: &Building,
        workplace_id: u64,
        commodity: CommodityKind,
    ) -> bool {
        self.marketplace_stall_workplace_id_for_commodity(ctx, marketplace, commodity)
            == Some(workplace_id)
    }

    fn marketplace_has_stall_workers_for_deposit(
        &self,
        ctx: &ReducerContext,
        marketplace: &Building,
        need_kind: ResidenceNeedKind,
    ) -> bool {
        let Some(group) = stall_group_for_need(need_kind) else {
            return false;
        };
        self.ensure_marketplace_stall_roster(ctx, marketplace.owner);
        self.marketplace_stall_rosters
            .borrow()
            .get(&marketplace.owner)
            .and_then(|roster| roster.workers_by_market_group.get(&(marketplace.id, group)))
            .is_some_and(|workers| !workers.is_empty())
    }

    fn ensure_marketplace_stall_roster(&self, ctx: &ReducerContext, owner: Identity) {
        if self.marketplace_stall_rosters.borrow().contains_key(&owner) {
            return;
        }
        let roster = self.build_marketplace_stall_roster(ctx, owner);
        self.marketplace_stall_rosters
            .borrow_mut()
            .insert(owner, roster);
    }

    fn build_marketplace_stall_roster(
        &self,
        ctx: &ReducerContext,
        owner: Identity,
    ) -> MarketplaceStallRoster {
        let Some(network) = self.road_network(owner) else {
            return MarketplaceStallRoster::default();
        };
        let mut marketplaces: Vec<Building> = self
            .building_ids_for_kinds(ctx, owner, &["marketplace"])
            .into_iter()
            .filter_map(|id| ctx.db.building().id().find(&id))
            .filter(|marketplace| {
                marketplace.construction_complete
                    && !self.building_disabled_by_fire(ctx, marketplace.id)
            })
            .collect();
        marketplaces.sort_by_key(|marketplace| marketplace.id);
        let mut roster = MarketplaceStallRoster::default();

        for group in [MARKET_STALL_GROUP_FOOD, MARKET_STALL_GROUP_GOODS] {
            let workplace_kind = if group == MARKET_STALL_GROUP_FOOD {
                "granary"
            } else {
                "village_storehouse"
            };
            let mut workplaces: Vec<Building> = self
                .building_ids_for_kinds(ctx, owner, &[workplace_kind])
                .into_iter()
                .filter_map(|id| ctx.db.building().id().find(&id))
                .filter(|workplace| {
                    workplace.construction_complete
                        && workplace.assigned_labor > 0
                        && !self.building_disabled_by_fire(ctx, workplace.id)
                })
                .collect();
            workplaces.sort_by_key(|workplace| workplace.id);
            let mut workers_remaining: HashMap<u64, u32> = workplaces
                .iter()
                .map(|workplace| (workplace.id, workplace.assigned_labor))
                .collect();
            let mut slots_remaining: HashMap<u64, u32> = marketplaces
                .iter()
                .map(|marketplace| (marketplace.id, stall_slots_for_group(group)))
                .collect();
            let mut candidates = Vec::<MarketplaceStallCandidate>::new();
            let mut workplace_market_pairs = Vec::<(f64, u64, u64)>::new();

            for workplace in &workplaces {
                for marketplace in &marketplaces {
                    let Some(distance) = network
                        .road_path_distance(workplace.x, workplace.z, marketplace.x, marketplace.z)
                        .filter(|distance| distance.is_finite())
                    else {
                        continue;
                    };
                    workplace_market_pairs.push((distance, marketplace.id, workplace.id));
                    for need_kind in stall_needs_for_group(group) {
                        let source_has_stock =
                            marketplace_stall_stock(workplace, *need_kind) > 1e-6;
                        if !source_has_stock
                            && marketplace_stall_stock(marketplace, *need_kind) <= 1e-6
                        {
                            continue;
                        }
                        candidates.push(MarketplaceStallCandidate {
                            marketplace_id: marketplace.id,
                            workplace_id: workplace.id,
                            need_kind: *need_kind,
                            distance,
                            source_has_stock,
                        });
                    }
                }
            }

            candidates.sort_by(|left, right| {
                left.distance
                    .total_cmp(&right.distance)
                    .then_with(|| right.source_has_stock.cmp(&left.source_has_stock))
                    .then_with(|| {
                        stall_need_rank(left.need_kind).cmp(&stall_need_rank(right.need_kind))
                    })
                    .then_with(|| left.marketplace_id.cmp(&right.marketplace_id))
                    .then_with(|| left.workplace_id.cmp(&right.workplace_id))
            });
            for candidate in candidates {
                let source_workers = workers_remaining
                    .get(&candidate.workplace_id)
                    .copied()
                    .unwrap_or(0);
                let market_slots = slots_remaining
                    .get(&candidate.marketplace_id)
                    .copied()
                    .unwrap_or(0);
                if source_workers == 0
                    || market_slots == 0
                    || roster
                        .workplace_by_market_need
                        .contains_key(&(candidate.marketplace_id, candidate.need_kind))
                {
                    continue;
                }
                roster.workplace_by_market_need.insert(
                    (candidate.marketplace_id, candidate.need_kind),
                    candidate.workplace_id,
                );
                roster
                    .workers_by_market_group
                    .entry((candidate.marketplace_id, group))
                    .or_default()
                    .push(candidate.workplace_id);
                workers_remaining.insert(candidate.workplace_id, source_workers - 1);
                slots_remaining.insert(candidate.marketplace_id, market_slots - 1);
            }

            workplace_market_pairs.sort_by(|left, right| {
                left.0
                    .total_cmp(&right.0)
                    .then_with(|| left.1.cmp(&right.1))
                    .then_with(|| left.2.cmp(&right.2))
            });
            for (_, marketplace_id, workplace_id) in workplace_market_pairs {
                let source_workers = workers_remaining.get(&workplace_id).copied().unwrap_or(0);
                let market_slots = slots_remaining.get(&marketplace_id).copied().unwrap_or(0);
                let standby_workers = source_workers.min(market_slots);
                if standby_workers == 0 {
                    continue;
                }
                roster
                    .workers_by_market_group
                    .entry((marketplace_id, group))
                    .or_default()
                    .extend(std::iter::repeat_n(workplace_id, standby_workers as usize));
                workers_remaining.insert(workplace_id, source_workers - standby_workers);
                slots_remaining.insert(marketplace_id, market_slots - standby_workers);
            }
        }

        roster
    }
}

fn stall_group_for_need(need_kind: ResidenceNeedKind) -> Option<u8> {
    match need_kind {
        ResidenceNeedKind::Food | ResidenceNeedKind::PreservedFood | ResidenceNeedKind::Ale => {
            Some(MARKET_STALL_GROUP_FOOD)
        }
        ResidenceNeedKind::Firewood | ResidenceNeedKind::Cloth | ResidenceNeedKind::Pottery => {
            Some(MARKET_STALL_GROUP_GOODS)
        }
        ResidenceNeedKind::Water | ResidenceNeedKind::Church | ResidenceNeedKind::FoodVariety => {
            None
        }
    }
}

fn stall_needs_for_group(group: u8) -> &'static [ResidenceNeedKind] {
    if group == MARKET_STALL_GROUP_FOOD {
        &MARKET_FOOD_STALL_NEEDS
    } else {
        &MARKET_GOODS_STALL_NEEDS
    }
}

fn stall_slots_for_group(group: u8) -> u32 {
    if group == MARKET_STALL_GROUP_FOOD {
        MARKETPLACE_FOOD_STALL_SLOTS
    } else {
        MARKETPLACE_GOODS_STALL_SLOTS
    }
}

fn stall_need_rank(need_kind: ResidenceNeedKind) -> u8 {
    match need_kind {
        ResidenceNeedKind::Food | ResidenceNeedKind::Firewood => 0,
        ResidenceNeedKind::PreservedFood | ResidenceNeedKind::Cloth => 1,
        ResidenceNeedKind::Ale | ResidenceNeedKind::Pottery => 2,
        ResidenceNeedKind::Water | ResidenceNeedKind::Church | ResidenceNeedKind::FoodVariety => 3,
    }
}

fn stall_need_for_commodity(commodity: CommodityKind) -> Option<ResidenceNeedKind> {
    if commodity.is_preserved_food() {
        Some(ResidenceNeedKind::PreservedFood)
    } else if commodity.is_fresh_food() || commodity == CommodityKind::Honey {
        Some(ResidenceNeedKind::Food)
    } else {
        match commodity {
            CommodityKind::Ale => Some(ResidenceNeedKind::Ale),
            CommodityKind::Firewood | CommodityKind::Charcoal => Some(ResidenceNeedKind::Firewood),
            CommodityKind::Cloth => Some(ResidenceNeedKind::Cloth),
            CommodityKind::Pottery => Some(ResidenceNeedKind::Pottery),
            _ => None,
        }
    }
}

fn marketplace_stall_stock(building: &Building, need_kind: ResidenceNeedKind) -> f64 {
    if need_kind == ResidenceNeedKind::Food {
        (building_edible_food_stock(building) - building_preserved_food_stock(building)).max(0.0)
    } else {
        crate::simulation::delivery_cargo::building_delivery_stock(building, need_kind)
    }
}
