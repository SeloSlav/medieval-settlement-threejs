//! Physical recovery of goods left where a structure was dismantled.

use std::collections::HashMap;

use spacetimedb::ReducerContext;

use crate::balance_generated::{
    STOREHOUSE_HAUL_PER_WORKER, TIMBER_DELIVERY_SPEED_MPS, TIMBER_DELIVERY_UNLOAD_SEC,
};
use crate::building_defs::building_def;
use crate::construction_priority::CONSTRUCTION_PRIORITY_NORMAL;
use crate::db::*;
use crate::economy::{building_commodity_room, building_commodity_stock, CommodityKind};
use crate::placement_validation::{building_overlaps_open_water, building_overlaps_road_surface};
use crate::reducers::buildings::next_available_building_id;
use crate::roads::load_owner_road_network;
use crate::simulation::delivery_trips::{
    available_free_haulers, building_has_active_trip, building_has_inbound_supply_trip,
    try_start_building_supply_trip,
};
use crate::simulation::{labor_and_logistics_paused, GameClock, SimTickContext};
use crate::tables::{Building, PlayerResources, WorldConfig};

const EPSILON: f64 = 1e-6;
const RECOVERY_ORDER: [CommodityKind; 27] = [
    CommodityKind::Gold,
    CommodityKind::Remedies,
    CommodityKind::Food,
    CommodityKind::Grain,
    CommodityKind::Barley,
    CommodityKind::Malt,
    CommodityKind::Flour,
    CommodityKind::PreservedFood,
    CommodityKind::Ale,
    CommodityKind::Honey,
    CommodityKind::Wine,
    CommodityKind::Cloth,
    CommodityKind::Flax,
    CommodityKind::Iron,
    CommodityKind::Salt,
    CommodityKind::Pottery,
    CommodityKind::RoofTiles,
    CommodityKind::Charcoal,
    CommodityKind::Clay,
    CommodityKind::Manure,
    CommodityKind::Wool,
    CommodityKind::Ironwork,
    CommodityKind::Polearms,
    CommodityKind::Firewood,
    CommodityKind::Stone,
    CommodityKind::Timber,
    CommodityKind::Water,
];

#[derive(Clone, Copy, Debug, Default)]
pub struct ReclamationStock {
    pub timber: f64,
    pub firewood: f64,
    pub stone: f64,
    pub water: f64,
    pub food: f64,
    pub grain: f64,
    pub flour: f64,
    pub ale: f64,
    pub preserved_food: f64,
    pub honey: f64,
    pub wine: f64,
    pub ironwork: f64,
    pub polearms: f64,
    pub wool: f64,
    pub cloth: f64,
    pub gold: f64,
    pub barley: f64,
    pub malt: f64,
    pub flax: f64,
    pub iron: f64,
    pub clay: f64,
    pub salt: f64,
    pub charcoal: f64,
    pub pottery: f64,
    pub manure: f64,
    pub remedies: f64,
    pub roof_tiles: f64,
}

impl ReclamationStock {
    pub fn from_commodity(commodity: CommodityKind, amount: f64) -> Self {
        let amount = amount.max(0.0);
        match commodity {
            CommodityKind::Timber => Self {
                timber: amount,
                ..Self::default()
            },
            CommodityKind::Firewood => Self {
                firewood: amount,
                ..Self::default()
            },
            CommodityKind::Stone => Self {
                stone: amount,
                ..Self::default()
            },
            CommodityKind::Water => Self {
                water: amount,
                ..Self::default()
            },
            CommodityKind::Food => Self {
                food: amount,
                ..Self::default()
            },
            CommodityKind::Grain => Self {
                grain: amount,
                ..Self::default()
            },
            CommodityKind::Flour => Self {
                flour: amount,
                ..Self::default()
            },
            CommodityKind::Ale => Self {
                ale: amount,
                ..Self::default()
            },
            CommodityKind::PreservedFood => Self {
                preserved_food: amount,
                ..Self::default()
            },
            CommodityKind::Honey => Self {
                honey: amount,
                ..Self::default()
            },
            CommodityKind::Wine => Self {
                wine: amount,
                ..Self::default()
            },
            CommodityKind::Ironwork => Self {
                ironwork: amount,
                ..Self::default()
            },
            CommodityKind::Polearms => Self {
                polearms: amount,
                ..Self::default()
            },
            CommodityKind::Wool => Self {
                wool: amount,
                ..Self::default()
            },
            CommodityKind::Cloth => Self {
                cloth: amount,
                ..Self::default()
            },
            CommodityKind::Gold => Self {
                gold: amount,
                ..Self::default()
            },
            CommodityKind::Barley => Self {
                barley: amount,
                ..Self::default()
            },
            CommodityKind::Malt => Self {
                malt: amount,
                ..Self::default()
            },
            CommodityKind::Flax => Self {
                flax: amount,
                ..Self::default()
            },
            CommodityKind::Iron => Self {
                iron: amount,
                ..Self::default()
            },
            CommodityKind::Clay => Self {
                clay: amount,
                ..Self::default()
            },
            CommodityKind::Salt => Self {
                salt: amount,
                ..Self::default()
            },
            CommodityKind::Charcoal => Self {
                charcoal: amount,
                ..Self::default()
            },
            CommodityKind::Pottery => Self {
                pottery: amount,
                ..Self::default()
            },
            CommodityKind::Manure => Self {
                manure: amount,
                ..Self::default()
            },
            CommodityKind::Remedies => Self {
                remedies: amount,
                ..Self::default()
            },
            CommodityKind::RoofTiles => Self {
                roof_tiles: amount,
                ..Self::default()
            },
        }
    }

    pub fn is_empty(self) -> bool {
        RECOVERY_ORDER
            .into_iter()
            .all(|commodity| self.amount(commodity) <= EPSILON)
    }

    fn from_resource_ledger(resources: &PlayerResources) -> Self {
        Self {
            timber: resources.timber.max(0.0),
            firewood: resources.firewood.max(0.0),
            stone: resources.stone.max(0.0),
            water: resources.water.max(0.0),
            food: resources.food.max(0.0),
            grain: resources.grain.max(0.0),
            flour: resources.flour.max(0.0),
            ale: resources.ale.max(0.0),
            preserved_food: resources.preserved_food.max(0.0),
            honey: resources.honey.max(0.0),
            wine: resources.wine.max(0.0),
            ironwork: resources.ironwork.max(0.0),
            polearms: resources.polearms.max(0.0),
            wool: resources.wool.max(0.0),
            cloth: resources.cloth.max(0.0),
            gold: resources.gold.max(0.0),
            barley: resources.barley.max(0.0),
            malt: resources.malt.max(0.0),
            flax: resources.flax.max(0.0),
            iron: resources.iron.max(0.0),
            clay: resources.clay.max(0.0),
            salt: resources.salt.max(0.0),
            charcoal: resources.charcoal.max(0.0),
            pottery: resources.pottery.max(0.0),
            manure: 0.0,
            remedies: 0.0,
            roof_tiles: resources.roof_tiles.max(0.0),
        }
    }

    fn amount(self, commodity: CommodityKind) -> f64 {
        match commodity {
            CommodityKind::Timber => self.timber,
            CommodityKind::Firewood => self.firewood,
            CommodityKind::Stone => self.stone,
            CommodityKind::Water => self.water,
            CommodityKind::Food => self.food,
            CommodityKind::Grain => self.grain,
            CommodityKind::Flour => self.flour,
            CommodityKind::Ale => self.ale,
            CommodityKind::PreservedFood => self.preserved_food,
            CommodityKind::Honey => self.honey,
            CommodityKind::Wine => self.wine,
            CommodityKind::Ironwork => self.ironwork,
            CommodityKind::Polearms => self.polearms,
            CommodityKind::Wool => self.wool,
            CommodityKind::Cloth => self.cloth,
            CommodityKind::Gold => self.gold,
            CommodityKind::Barley => self.barley,
            CommodityKind::Malt => self.malt,
            CommodityKind::Flax => self.flax,
            CommodityKind::Iron => self.iron,
            CommodityKind::Clay => self.clay,
            CommodityKind::Salt => self.salt,
            CommodityKind::Charcoal => self.charcoal,
            CommodityKind::Pottery => self.pottery,
            CommodityKind::Manure => self.manure,
            CommodityKind::Remedies => self.remedies,
            CommodityKind::RoofTiles => self.roof_tiles,
        }
    }

    fn add_to_building(self, building: &mut Building) {
        building.timber += self.timber;
        building.firewood += self.firewood;
        building.stone += self.stone;
        building.water += self.water;
        building.food += self.food;
        building.grain += self.grain;
        building.flour += self.flour;
        building.ale += self.ale;
        building.preserved_food += self.preserved_food;
        building.honey += self.honey;
        building.wine += self.wine;
        building.ironwork += self.ironwork;
        building.polearms += self.polearms;
        building.wool += self.wool;
        building.cloth += self.cloth;
        building.gold += self.gold;
        building.barley += self.barley;
        building.malt += self.malt;
        building.flax += self.flax;
        building.iron += self.iron;
        building.clay += self.clay;
        building.salt += self.salt;
        building.charcoal += self.charcoal;
        building.pottery += self.pottery;
        building.manure += self.manure;
        building.remedies += self.remedies;
        building.roof_tiles += self.roof_tiles;
    }
}

fn clear_resource_ledger(resources: &mut PlayerResources) {
    resources.timber = 0.0;
    resources.firewood = 0.0;
    resources.stone = 0.0;
    resources.water = 0.0;
    resources.food = 0.0;
    resources.grain = 0.0;
    resources.flour = 0.0;
    resources.ale = 0.0;
    resources.preserved_food = 0.0;
    resources.honey = 0.0;
    resources.wine = 0.0;
    resources.ironwork = 0.0;
    resources.polearms = 0.0;
    resources.wool = 0.0;
    resources.cloth = 0.0;
    resources.gold = 0.0;
    resources.barley = 0.0;
    resources.malt = 0.0;
    resources.flax = 0.0;
    resources.iron = 0.0;
    resources.clay = 0.0;
    resources.salt = 0.0;
    resources.charcoal = 0.0;
    resources.pottery = 0.0;
    resources.roof_tiles = 0.0;
}

fn recovery_pile_position_beside_building(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    anchor: &Building,
) -> (f64, f64) {
    const DIRECTIONS: [(f64, f64); 8] = [
        (1.0, 0.0),
        (-1.0, 0.0),
        (0.0, 1.0),
        (0.0, -1.0),
        (0.707_106_781_18, 0.707_106_781_18),
        (-0.707_106_781_18, 0.707_106_781_18),
        (0.707_106_781_18, -0.707_106_781_18),
        (-0.707_106_781_18, -0.707_106_781_18),
    ];
    let anchor_radius = building_def(&anchor.kind)
        .map(|def| def.pick_radius)
        .unwrap_or(1.5);
    let pile_radius = building_def("salvage_pile")
        .map(|def| def.pick_radius)
        .unwrap_or(1.0);
    let offset = anchor_radius + pile_radius + 0.75;
    let network = load_owner_road_network(ctx, owner);
    let other_buildings = ctx
        .db
        .building()
        .owner()
        .filter(&owner)
        .filter(|building| building.id != anchor.id)
        .collect::<Vec<_>>();
    let mut best = None;

    for (index, (dx, dz)) in DIRECTIONS.into_iter().enumerate() {
        let x = anchor.x + dx * offset;
        let z = anchor.z + dz * offset;
        let overlaps_building = other_buildings.iter().any(|building| {
            let other_radius = building_def(&building.kind)
                .map(|def| def.pick_radius)
                .unwrap_or(1.0);
            (building.x - x).powi(2) + (building.z - z).powi(2)
                < (pile_radius + other_radius + 0.25).powi(2)
        });
        let blocked = overlaps_building
            || building_overlaps_open_water("salvage_pile", x, z)
            || network
                .as_ref()
                .is_some_and(|roads| building_overlaps_road_surface(roads, "salvage_pile", x, z));
        let road_distance = network
            .as_ref()
            .map(|roads| roads.nearest_distance(x, z))
            .unwrap_or(0.0);
        let score = (u8::from(blocked), road_distance, index);
        if best
            .as_ref()
            .is_none_or(|(best_score, _): &((u8, f64, usize), (f64, f64))| {
                score.0 < best_score.0
                    || (score.0 == best_score.0
                        && (score.1 < best_score.1
                            || (score.1 == best_score.1 && score.2 < best_score.2)))
            })
        {
            best = Some((score, (x, z)));
        }
    }

    best.map(|(_, position)| position)
        .unwrap_or((anchor.x + offset, anchor.z))
}

/// Material recovered in the physical world must remain where it was left
/// rather than appearing in a remote depot. The temporary Building row reuses
/// the existing cart, marker, inspector, save, and collision paths. A legacy
/// settlement keeps its abstract refund path only until bootstrap migration.
pub fn insert_reclamation_pile(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    x: f64,
    z: f64,
    stock: ReclamationStock,
) -> Result<bool, String> {
    let physical_reclamation = ctx
        .db
        .player_resources()
        .owner()
        .find(&owner)
        .is_some_and(|resources| resources.physical_founding_site_enabled);
    if !physical_reclamation {
        return Ok(false);
    }
    if stock.is_empty() {
        return Ok(true);
    }

    let salvage_def = building_def("salvage_pile")
        .ok_or_else(|| "Reclamation pile balance is missing.".to_string())?;
    let config = ctx
        .db
        .world_config()
        .id()
        .find(&0)
        .ok_or_else(|| "World not initialized.".to_string())?;
    let building_id = next_available_building_id(ctx, config.next_building_id)?;
    ctx.db.building().insert(Building {
        id: building_id,
        owner,
        kind: "salvage_pile".into(),
        x,
        z,
        work_radius: salvage_def.work_radius,
        action_cooldown: 0.0,
        timber: stock.timber.max(0.0),
        firewood: stock.firewood.max(0.0),
        stone: stock.stone.max(0.0),
        water: stock.water.max(0.0),
        food: stock.food.max(0.0),
        grain: stock.grain.max(0.0),
        flour: stock.flour.max(0.0),
        ale: stock.ale.max(0.0),
        preserved_food: stock.preserved_food.max(0.0),
        honey: stock.honey.max(0.0),
        wine: stock.wine.max(0.0),
        ironwork: stock.ironwork.max(0.0),
        polearms: stock.polearms.max(0.0),
        water_capacity: 0.0,
        assigned_labor: 0,
        storehouse_accepts_timber: true,
        storehouse_accepts_stone: true,
        storehouse_accepts_firewood: true,
        storehouse_accepts_iron: true,
        storehouse_accepts_clay: true,
        storehouse_accepts_salt: true,
        gold: stock.gold.max(0.0),
        construction_complete: true,
        construction_progress: 1.0,
        construction_required_timber: 0.0,
        construction_required_stone: 0.0,
        construction_required_ironwork: 0.0,
        construction_delivered_timber: 0.0,
        construction_delivered_stone: 0.0,
        construction_delivered_ironwork: 0.0,
        construction_reserved_timber: 0.0,
        construction_reserved_stone: 0.0,
        construction_reserved_ironwork: 0.0,
        construction_treasury_timber: 0.0,
        construction_treasury_stone: 0.0,
        construction_treasury_ironwork: 0.0,
        granary_accepts_fresh_food: true,
        granary_households_first: false,
        construction_priority: CONSTRUCTION_PRIORITY_NORMAL,
        woodcutter_timber_reserve: 0.0,
        granary_grain_reserve: 0.0,
        harvest_reserve_percent: 0,
        wool: stock.wool.max(0.0),
        cloth: stock.cloth.max(0.0),
        carpenter_polearm_reserve: 0,
        guardhouse_pay_priority: 0,
        marketplace_ironwork_target: 0,
        marketplace_specialty_export_policy: 0,
        granary_fresh_food_target_percent:
            crate::granary_policy::GRANARY_FRESH_FOOD_TARGET_DEFAULT_PERCENT,
        storehouse_timber_target_percent:
            crate::storehouse_policy::STOREHOUSE_STOCK_TARGET_DEFAULT_PERCENT,
        storehouse_stone_target_percent:
            crate::storehouse_policy::STOREHOUSE_STOCK_TARGET_DEFAULT_PERCENT,
        storehouse_firewood_target_percent:
            crate::storehouse_policy::STOREHOUSE_STOCK_TARGET_DEFAULT_PERCENT,
        storehouse_iron_target_percent:
            crate::storehouse_policy::STOREHOUSE_STOCK_TARGET_DEFAULT_PERCENT,
        storehouse_clay_target_percent:
            crate::storehouse_policy::STOREHOUSE_STOCK_TARGET_DEFAULT_PERCENT,
        storehouse_salt_target_percent:
            crate::storehouse_policy::STOREHOUSE_STOCK_TARGET_DEFAULT_PERCENT,
        processor_output_target_percent:
            crate::processor_output_policy::PROCESSOR_OUTPUT_TARGET_DEFAULT_PERCENT,
        guardhouse_food_reserve: 0,
        marketplace_seed_grain_target: 0,
        founding_shelter_active: false,
        marketplace_pending_trade_code: 0,
        marketplace_gold_reserve_target:
            crate::marketplace_procurement_policy::MARKETPLACE_GOLD_RESERVE_DEFAULT,
        chapel_monastery_tithe_due: 0.0,
        civic_receipts_gold: 0.0,
        barley: stock.barley.max(0.0),
        malt: stock.malt.max(0.0),
        flax: stock.flax.max(0.0),
        guardhouse_muster_watchtower_id: 0,
        weaver_input_policy: 0,
        iron: stock.iron.max(0.0),
        clay: stock.clay.max(0.0),
        salt: stock.salt.max(0.0),
        charcoal: stock.charcoal.max(0.0),
        pottery: stock.pottery.max(0.0),
        roof_tiles: stock.roof_tiles.max(0.0),
        manure: stock.manure.max(0.0),
        remedies: stock.remedies.max(0.0),
        marketplace_iron_target: 0,
        marketplace_salt_target: 0,
        pottery_dispatch_policy: 0,
        potter_firing_policy: 0,
        carpenter_cart_service_target_trips: 0,
    });
    ctx.db.world_config().id().update(WorldConfig {
        next_building_id: building_id
            .checked_add(1)
            .ok_or_else(|| "No building IDs remain available.".to_string())?,
        ..config
    });
    Ok(true)
}

/// Keep returned overflow beside its source. A nearby pile is reused so a
/// repeatedly full storehouse cannot create unbounded marker and row churn.
pub fn recover_stock_beside_building(
    ctx: &ReducerContext,
    anchor: &Building,
    stock: ReclamationStock,
) -> Result<bool, String> {
    let (x, z) = recovery_pile_position_beside_building(ctx, anchor.owner, anchor);
    recover_stock_at(ctx, anchor.owner, x, z, stock)
}

/// Leave stranded cart cargo at its authoritative position. Nearby recovered
/// stock is coalesced to keep the physical ledger readable and inexpensive.
pub fn recover_stock_at(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    x: f64,
    z: f64,
    stock: ReclamationStock,
) -> Result<bool, String> {
    let physical_reclamation = ctx
        .db
        .player_resources()
        .owner()
        .find(&owner)
        .is_some_and(|resources| resources.physical_founding_site_enabled);
    if !physical_reclamation {
        return Ok(false);
    }
    if stock.is_empty() {
        return Ok(true);
    }

    const LOCAL_PILE_REUSE_DISTANCE: f64 = 4.5;
    if let Some(mut pile) = ctx
        .db
        .building()
        .owner()
        .filter(&owner)
        .filter(|building| {
            building.kind == "salvage_pile"
                && (building.x - x).powi(2) + (building.z - z).powi(2)
                    <= LOCAL_PILE_REUSE_DISTANCE.powi(2)
        })
        .min_by(|a, b| {
            let a_distance = (a.x - x).powi(2) + (a.z - z).powi(2);
            let b_distance = (b.x - x).powi(2) + (b.z - z).powi(2);
            a_distance
                .total_cmp(&b_distance)
                .then_with(|| a.id.cmp(&b.id))
        })
    {
        stock.add_to_building(&mut pile);
        ctx.db.building().id().update(pile);
        return Ok(true);
    }

    insert_reclamation_pile(ctx, owner, x, z, stock)
}

/// Physical-world saves may still receive a legacy ledger balance from an old
/// schema, an interrupted delivery return, or a sandbox grant. Convert that
/// balance into a visible recovery pile before any planner can spend it.
///
/// Existing piles are reused to avoid marker churn. Otherwise the pile appears
/// beside the active civic treasury seat (Town Hall when complete, otherwise
/// the founders' camp), with a completed building or residence as a migration
/// fallback.
pub fn materialize_physical_resource_ledger(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
) -> Result<bool, String> {
    materialize_physical_resource_ledger_at(ctx, owner, None)
}

/// Variant used by the founding bootstrap when a legacy save contains only
/// zoning rows and therefore has no completed structure to anchor its migrated
/// stock. The deterministic founding-site coordinate keeps those goods on-map
/// without inventing a second founder population or a free permanent store.
pub fn materialize_physical_resource_ledger_at(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    fallback_position: Option<(f64, f64)>,
) -> Result<bool, String> {
    let Some(mut resources) = ctx.db.player_resources().owner().find(&owner) else {
        return Ok(false);
    };
    if !resources.physical_founding_site_enabled {
        return Ok(false);
    }

    let stock = ReclamationStock::from_resource_ledger(&resources);
    if stock.is_empty() {
        return Ok(true);
    }

    if let Some(mut pile) = ctx
        .db
        .building()
        .owner()
        .filter(&owner)
        .filter(|building| building.kind == "salvage_pile")
        .min_by_key(|building| building.id)
    {
        stock.add_to_building(&mut pile);
        ctx.db.building().id().update(pile);
        materialize_physical_construction_reservations(ctx, owner);
        clear_resource_ledger(&mut resources);
        ctx.db.player_resources().owner().update(resources);
        return Ok(true);
    }

    let building_anchor = crate::economy::physical_treasury_seat(ctx, owner).or_else(|| {
        ctx.db
            .building()
            .owner()
            .filter(&owner)
            .filter(|building| building.construction_complete)
            .min_by_key(|building| building.id)
            .or_else(|| {
                ctx.db
                    .building()
                    .owner()
                    .filter(&owner)
                    .min_by_key(|building| building.id)
            })
    });
    let position = if let Some(anchor) = building_anchor {
        recovery_pile_position_beside_building(ctx, owner, &anchor)
    } else if let Some(residence) = ctx
        .db
        .residence()
        .owner()
        .filter(&owner)
        .min_by_key(|residence| residence.id)
    {
        (residence.x + 3.25, residence.z)
    } else if let Some(position) = fallback_position {
        position
    } else {
        return Ok(false);
    };

    if !insert_reclamation_pile(ctx, owner, position.0, position.1, stock)? {
        return Ok(false);
    }
    materialize_physical_construction_reservations(ctx, owner);
    clear_resource_ledger(&mut resources);
    ctx.db.player_resources().owner().update(resources);
    Ok(true)
}

/// Legacy worksites reserve some of their materials directly against the
/// compatibility row. Once that row becomes a visible pile, preserve the
/// overall reservation but make its entire balance eligible for physical cart
/// dispatch. Otherwise the old share would be neither haulable nor spendable,
/// while another project could incorrectly reserve the same pile stock.
pub fn materialize_physical_construction_reservations(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
) {
    if !ctx
        .db
        .player_resources()
        .owner()
        .find(&owner)
        .is_some_and(|resources| resources.physical_founding_site_enabled)
    {
        return;
    }
    let sites = ctx
        .db
        .building()
        .owner()
        .filter(&owner)
        .filter(|building| {
            !building.construction_complete
                && (building.construction_treasury_timber > EPSILON
                    || building.construction_treasury_stone > EPSILON
                    || building.construction_treasury_ironwork > EPSILON)
        })
        .collect::<Vec<_>>();
    for mut site in sites {
        site.construction_treasury_timber = 0.0;
        site.construction_treasury_stone = 0.0;
        site.construction_treasury_ironwork = 0.0;
        ctx.db.building().id().update(site);
    }
}

/// The player table is tiny, while a full building scan is only needed for an
/// owner who actually has a stray positive balance.
pub fn materialize_all_physical_resource_ledgers(ctx: &ReducerContext) {
    let owners = ctx
        .db
        .player_resources()
        .iter()
        .filter(|resources| {
            resources.physical_founding_site_enabled
                && !ReclamationStock::from_resource_ledger(resources).is_empty()
        })
        .map(|resources| resources.owner)
        .collect::<Vec<_>>();
    for owner in owners {
        if let Err(error) = materialize_physical_resource_ledger(ctx, owner) {
            log::warn!("Could not materialize physical resource ledger: {error}");
        }
    }
}

/// One free hauler at each reachable pile moves one cartload per economy step.
/// Construction has already had first claim on reclaimed timber and stone, so
/// permanent stores clear only what an active worksite did not reserve.
pub fn step_reclamation_piles(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    pile_ids: Vec<u64>,
) {
    let mut free_haulers_by_owner = HashMap::new();
    let mut destination_ids_by_owner = HashMap::new();
    for pile_id in pile_ids {
        let Some(mut pile) = ctx.db.building().id().find(&pile_id) else {
            continue;
        };
        if pile.kind != "salvage_pile" {
            continue;
        }
        if building_has_active_trip(ctx, pile.id) || building_has_inbound_supply_trip(ctx, pile.id)
        {
            continue;
        }
        if !has_portable_stock(&pile) {
            ctx.db.building().id().delete(pile.id);
            continue;
        }
        let free_haulers = *free_haulers_by_owner
            .entry(pile.owner)
            .or_insert_with(|| available_free_haulers(ctx, pile.owner));
        if free_haulers == 0 || labor_and_logistics_paused(ctx, tick, pile.owner, clock) {
            continue;
        }
        let Some(network) = tick.road_network(pile.owner) else {
            continue;
        };
        let destination_ids = destination_ids_by_owner
            .entry(pile.owner)
            .or_insert_with(|| tick.owner_building_ids(ctx, pile.owner));

        for commodity in RECOVERY_ORDER {
            let stock = building_commodity_stock(&pile, commodity);
            if stock <= EPSILON {
                continue;
            }
            let target = destination_ids
                .iter()
                .filter_map(|target_id| ctx.db.building().id().find(target_id))
                .filter_map(|target| {
                    if target.id == pile.id
                        || target.kind == "salvage_pile"
                        || !target.construction_complete
                        || tick.building_disabled_by_fire(ctx, target.id)
                        || building_has_inbound_supply_trip(ctx, target.id)
                        || building_commodity_room(&target, commodity) <= EPSILON
                    {
                        return None;
                    }
                    let priority = reclamation_destination_priority(commodity, &target.kind)?;
                    let distance =
                        network.road_path_distance(pile.x, pile.z, target.x, target.z)?;
                    (distance > EPSILON).then_some((target, priority, distance))
                })
                .min_by(|a, b| {
                    a.1.cmp(&b.1)
                        .then_with(|| a.2.total_cmp(&b.2))
                        .then_with(|| a.0.id.cmp(&b.0.id))
                })
                .map(|candidate| candidate.0);
            let Some(target) = target else {
                continue;
            };

            if try_start_building_supply_trip(
                ctx,
                tick,
                clock,
                network,
                &mut pile,
                &target,
                1,
                commodity,
                TIMBER_DELIVERY_SPEED_MPS,
                TIMBER_DELIVERY_UNLOAD_SEC,
                STOREHOUSE_HAUL_PER_WORKER,
                stock,
            ) {
                ctx.db.building().id().update(pile);
                if let Some(remaining) = free_haulers_by_owner.get_mut(&target.owner) {
                    *remaining = remaining.saturating_sub(1);
                }
                break;
            }
        }
    }
}

pub(crate) fn reclamation_destination_priority(commodity: CommodityKind, kind: &str) -> Option<u8> {
    match commodity {
        CommodityKind::Gold => match kind {
            "town_hall" => Some(0),
            "founders_camp" => Some(1),
            _ => None,
        },
        CommodityKind::Timber | CommodityKind::Stone => match kind {
            "village_storehouse" => Some(0),
            "founders_camp" => Some(1),
            "marketplace" => Some(2),
            _ => Some(3),
        },
        CommodityKind::Firewood => match kind {
            "village_storehouse" => Some(0),
            "founders_camp" => Some(1),
            "marketplace" | "woodcutters_lodge" => Some(2),
            _ => Some(3),
        },
        CommodityKind::Food
        | CommodityKind::Grain
        | CommodityKind::Barley
        | CommodityKind::Flour
        | CommodityKind::PreservedFood => match kind {
            "granary" => Some(0),
            "brewery" if commodity == CommodityKind::Barley => Some(0),
            "marketplace" => Some(1),
            "founders_camp" => Some(2),
            _ => Some(3),
        },
        CommodityKind::Malt => match kind {
            "brewery" => Some(0),
            "founders_camp" => Some(1),
            _ => Some(2),
        },
        CommodityKind::Ale | CommodityKind::Honey | CommodityKind::Wine => match kind {
            "marketplace" => Some(0),
            "monastery" => Some(1),
            "founders_camp" => Some(2),
            _ => Some(3),
        },
        CommodityKind::Ironwork => match kind {
            "carpenter" => Some(0),
            "marketplace" => Some(1),
            "founders_camp" => Some(2),
            _ => Some(3),
        },
        CommodityKind::Polearms => match kind {
            "guardhouse" => Some(0),
            "carpenter" => Some(1),
            "founders_camp" => Some(2),
            _ => Some(3),
        },
        CommodityKind::Wool => match kind {
            "weaver" => Some(0),
            "pastoral_farmstead" => Some(1),
            "founders_camp" => Some(2),
            _ => Some(3),
        },
        CommodityKind::Flax => match kind {
            "weaver" => Some(0),
            "threshing_barn" => Some(1),
            "founders_camp" => Some(2),
            _ => Some(3),
        },
        CommodityKind::Cloth => match kind {
            "marketplace" => Some(0),
            "weaver" => Some(1),
            "founders_camp" => Some(2),
            _ => Some(3),
        },
        CommodityKind::Iron => match kind {
            "smithy" => Some(0),
            "marketplace" => Some(1),
            "founders_camp" => Some(2),
            _ => Some(3),
        },
        CommodityKind::Clay => match kind {
            "potter_kiln" => Some(0),
            "clay_pit" => Some(1),
            "founders_camp" => Some(2),
            _ => Some(3),
        },
        CommodityKind::Salt => match kind {
            "smokehouse" => Some(0),
            "marketplace" => Some(1),
            "founders_camp" => Some(2),
            _ => Some(3),
        },
        CommodityKind::Charcoal => match kind {
            "smithy" => Some(0),
            "charcoal_burner" => Some(1),
            "founders_camp" => Some(2),
            _ => Some(3),
        },
        CommodityKind::Pottery => match kind {
            "smokehouse" => Some(0),
            "marketplace" => Some(1),
            "potter_kiln" => Some(2),
            "founders_camp" => Some(3),
            _ => Some(4),
        },
        CommodityKind::Manure => match kind {
            "threshing_barn" => Some(0),
            _ => None,
        },
        CommodityKind::Remedies => match kind {
            "foragers_shed" => Some(0),
            _ => None,
        },
        CommodityKind::RoofTiles => match kind {
            "potter_kiln" => Some(0),
            "founders_camp" => Some(1),
            _ => None,
        },
        CommodityKind::Water => match kind {
            "well" => Some(0),
            "founders_camp" => Some(1),
            _ => Some(2),
        },
    }
}

fn has_portable_stock(building: &Building) -> bool {
    RECOVERY_ORDER
        .into_iter()
        .any(|commodity| building_commodity_stock(building, commodity) > EPSILON)
}

#[cfg(test)]
mod tests {
    use super::ReclamationStock;

    #[test]
    fn empty_reclamation_stock_ignores_numeric_dust() {
        assert!(ReclamationStock::default().is_empty());
        assert!(ReclamationStock {
            timber: 1e-8,
            stone: 0.0,
            ..ReclamationStock::default()
        }
        .is_empty());
        assert!(!ReclamationStock {
            timber: 0.0,
            stone: 1.0,
            ..ReclamationStock::default()
        }
        .is_empty());
        assert!(!ReclamationStock {
            gold: 1.0,
            ..ReclamationStock::default()
        }
        .is_empty());
    }
}
