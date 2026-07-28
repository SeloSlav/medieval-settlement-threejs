use spacetimedb::Identity;

#[spacetimedb::table(accessor = sim_pacing_state)]
pub struct SimPacingState {
    #[primary_key]
    pub id: u8,
    /// Fixed-point remainder used to pace the leisurely baseline without changing sim_tick meaning.
    pub step_credit: u16,
}

#[spacetimedb::table(accessor = world_config, public)]
pub struct WorldConfig {
    #[primary_key]
    pub id: u8,
    pub seed: u64,
    pub next_building_id: u64,
    pub sim_tick: u64,
    /// Authoritative whole-simulation multiplier: 0 (paused), 1, 5, 20, or 120.
    #[default(1)]
    pub game_speed: u8,
    /// 0 = small, 1 = medium, 2 = large
    #[default(1)]
    pub map_size: u8,
    #[default(50)]
    pub topography: u8,
    #[default(50)]
    pub hydrology: u8,
    #[default(50)]
    pub forest_density: u8,
    /// Enables historically grounded frontier pressure and raid events.
    #[default(false)]
    pub conflict_enabled: bool,
    /// Configurable hostile pressure from 0 (disabled) to 100 (severe).
    #[default(0)]
    pub enemy_pressure: u8,
    /// False until a client publishes generation settings via configure_world.
    #[default(false)]
    pub configured: bool,
}

#[spacetimedb::table(accessor = player_resources, public)]
pub struct PlayerResources {
    #[primary_key]
    pub owner: Identity,
    /// Treasury timber — included in aggregate totals with building storage.
    pub timber: f64,
    pub stone: f64,
    /// Treasury firewood (usually zero; residences and lodges hold stock).
    pub firewood: f64,
    pub water: f64,
    /// Treasury gold from taxed village economic activity.
    #[default(0.0)]
    pub gold: f64,
    /// Treasury food from demolished suppliers and undeposited delivery overflow.
    #[default(0.0)]
    pub food: f64,
    #[default(0.0)]
    pub grain: f64,
    #[default(0.0)]
    pub flour: f64,
    #[default(0.0)]
    pub ale: f64,
    #[default(0.0)]
    pub preserved_food: f64,
    #[default(0.0)]
    pub honey: f64,
    #[default(0.0)]
    pub wine: f64,
    /// Treasury polearms recovered from demolition or interrupted deliveries.
    #[default(0.0)]
    pub polearms: f64,
    /// Mayor tax rate on village economic activity (0–1 fraction).
    #[default(0.18)]
    pub economic_activity_tax_rate: f64,
    /// Sweep coffer surplus above reserve into treasury on interval.
    #[default(false)]
    pub chapel_auto_sweep_enabled: bool,
    /// Gold kept in coffer for parish operations before auto-sweep.
    #[default(80.0)]
    pub chapel_coffer_reserve_gold: f64,
    /// When true and a staffed chapel exists, villagers rest on Sundays.
    #[default(false)]
    pub sabbath_observance_enabled: bool,
    /// Fraction of parish tithe income transferred to a linked Pauline monastery.
    #[default(0.3)]
    pub monastery_tithe_share: f64,
    /// When true, linked monasteries provision daily hospitality and five annual feast days.
    #[default(true)]
    pub monastery_feasts_enabled: bool,
    /// Lifetime gold manually collected from chapel coffers.
    #[default(0.0)]
    pub parish_manual_collect_total: f64,
    /// Lifetime gold auto-swept from chapel coffers to treasury.
    #[default(0.0)]
    pub parish_auto_sweep_total: f64,
    /// Lifetime priest salary paid from chapel coffers.
    #[default(0.0)]
    pub parish_salary_paid_total: f64,
    /// Lifetime chapel upkeep paid from chapel coffers.
    #[default(0.0)]
    pub parish_upkeep_paid_total: f64,
    /// Lifetime poor-relief charity paid from chapel coffers.
    #[default(0.0)]
    pub parish_charity_paid_total: f64,
    #[default(0.0)]
    pub monastery_tithe_paid_total: f64,
    #[default(0.0)]
    pub monastery_pilgrimage_gold_total: f64,
    #[default(0.0)]
    pub monastery_food_charity_total: f64,
    /// Imported wrought-iron heads and fittings awaiting local hafting.
    ///
    /// Appended for additive save compatibility; resource grouping is handled
    /// by the client projection rather than physical table-column order.
    #[default(0.0)]
    pub ironwork: f64,
    /// Raw fleece recovered from demolished stores or interrupted deliveries.
    #[default(0.0)]
    pub wool: f64,
    /// Finished woven cloth recovered from demolished stores or interrupted deliveries.
    #[default(0.0)]
    pub cloth: f64,
    /// When enabled, a staffed Town Hall reviews seasonal crews once per
    /// calendar day: dormant labor is released before active sites claim free
    /// workers by their existing staffing priorities. Appended for additive
    /// save compatibility; existing settlements remain manual.
    #[default(false)]
    pub seasonal_labor_steward_enabled: bool,
    /// When enabled, a staffed Town Hall reviews builders once per calendar
    /// day: blocked crews without an approaching cart are released, then
    /// immediately productive sites claim labor by construction priority.
    /// Appended for additive save compatibility; existing settlements remain
    /// manual.
    #[default(false)]
    pub construction_labor_steward_enabled: bool,
    /// When enabled, a staffed Town Hall reviews target-governed workshops
    /// and source-bound production once per calendar day: stalled surplus
    /// crews are released before supplied, below-target sites claim free
    /// workers by staffing priority. Appended for additive save compatibility;
    /// existing settlements remain manual.
    #[default(false)]
    pub production_labor_steward_enabled: bool,
    /// Minimum free villagers that automatic seasonal, production, and
    /// construction call-ups leave available for explicit orders. Safe recalls
    /// may restore this pool but productive crews are never dismissed merely
    /// to reach the floor. Appended for additive save compatibility.
    #[default(0)]
    pub labor_steward_reserve: u32,
    /// New settlements opt into physical founding stores and count the first
    /// housed residents as rehoused founders rather than extra immigrants.
    /// Developed legacy saves enable physical storage during bootstrap while
    /// retaining their population contract in the adjacent compatibility flag.
    #[default(false)]
    pub physical_founding_site_enabled: bool,
    /// Existing saves historically counted the five initial villagers in
    /// addition to every housed resident. Keep that population contract while
    /// allowing their resource ledger to migrate into physical map stores.
    /// Fresh founding camps disable the bonus because their founders move into
    /// the first completed homes instead of arriving as extra immigrants.
    #[default(true)]
    pub legacy_unhoused_population_bonus_enabled: bool,
    /// Threshed spring barley retained separately from bread grain so it can
    /// seed barley fields or enter the physical malting chain.
    #[default(0.0)]
    pub barley: f64,
    /// Germinated and kiln-dried barley recovered from legacy or demolished
    /// stores. New production normally remains at the brewhouse.
    #[default(0.0)]
    pub malt: f64,
    /// Pulled flax stems and dressed plant fibre recovered from legacy or
    /// demolished stores. New harvests remain physically distinct from fleece.
    #[default(0.0)]
    pub flax: f64,
}

#[spacetimedb::table(accessor = quarry, public)]
pub struct Quarry {
    #[primary_key]
    pub quarry_id: String,
    pub x: f64,
    pub z: f64,
    pub max_yield: f64,
    pub remaining: f64,
    #[default(false)]
    pub is_rich: bool,
}

#[spacetimedb::table(accessor = foraging_node, public)]
pub struct ForagingNode {
    #[primary_key]
    pub node_id: String,
    pub node_kind: String,
    pub x: f64,
    pub z: f64,
    pub max_yield: f64,
    pub remaining: f64,
    pub respawn_cooldown: f64,
    pub anchor_x: f64,
    pub anchor_z: f64,
}

#[spacetimedb::table(accessor = tree_entity, public)]
pub struct TreeEntity {
    #[primary_key]
    pub tree_id: String,
    pub layout_index: u32,
    pub phase: String,
    pub growth_progress: f64,
    pub wood_yield: f64,
    pub x: f64,
    pub z: f64,
}

#[spacetimedb::table(accessor = building, public, index(accessor = owner, btree(columns = [owner])))]
#[derive(Clone)]
pub struct Building {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub owner: Identity,
    pub kind: String,
    pub x: f64,
    pub z: f64,
    pub work_radius: f64,
    pub action_cooldown: f64,
    pub timber: f64,
    pub firewood: f64,
    pub stone: f64,
    pub water: f64,
    pub food: f64,
    #[default(0.0)]
    pub grain: f64,
    #[default(0.0)]
    pub flour: f64,
    #[default(0.0)]
    pub ale: f64,
    #[default(0.0)]
    pub preserved_food: f64,
    #[default(0.0)]
    pub honey: f64,
    #[default(0.0)]
    pub wine: f64,
    /// Carpenter-made spears and other long hafted weapons.
    #[default(0.0)]
    pub polearms: f64,
    pub water_capacity: f64,
    pub assigned_labor: u32,
    /// Village storehouse intake filters; ignored by other building kinds.
    #[default(true)]
    pub storehouse_accepts_timber: bool,
    #[default(true)]
    pub storehouse_accepts_stone: bool,
    #[default(true)]
    pub storehouse_accepts_firewood: bool,
    /// Physical coin held by civic, religious, trade, ferry, and guard buildings.
    #[default(0.0)]
    pub gold: f64,
    /// False while this row is a construction site rather than an operating building.
    #[default(true)]
    pub construction_complete: bool,
    /// Normalized builder work completed (0-1), capped by materials delivered.
    #[default(1.0)]
    pub construction_progress: f64,
    #[default(0.0)]
    pub construction_required_timber: f64,
    #[default(0.0)]
    pub construction_required_stone: f64,
    #[default(0.0)]
    pub construction_delivered_timber: f64,
    #[default(0.0)]
    pub construction_delivered_stone: f64,
    /// Reserved stock that still needs to be loaded or transferred to this site.
    #[default(0.0)]
    pub construction_reserved_timber: f64,
    #[default(0.0)]
    pub construction_reserved_stone: f64,
    /// Reserved portions backed by the legacy pre-founding-site ledger.
    #[default(0.0)]
    pub construction_treasury_timber: f64,
    #[default(0.0)]
    pub construction_treasury_stone: f64,
    /// Granary intake policy; ignored by other building kinds. Keeping this
    /// enabled trades an extra road haul for substantially slower fresh-food
    /// spoilage in centralized storage.
    #[default(true)]
    pub granary_accepts_fresh_food: bool,
    /// Imported wrought-iron heads and fittings awaiting local hafting.
    ///
    /// Appended for additive save compatibility.
    #[default(0.0)]
    pub ironwork: f64,
    /// Granary distribution policy. Appended for additive save compatibility.
    /// False preserves the legacy behavior: central surplus goes to smokehouses
    /// before household carts.
    #[default(false)]
    pub granary_households_first: bool,
    /// Work priority: construction uses 0 = held, 1 = low, 2 = normal,
    /// 3 = urgent. Completed buildings use 1 = low, 2 = normal, 3 = high
    /// when retaining staff after population loss. Routed processor inputs
    /// also use this tier when scarce carts choose a working buffer.
    /// The additive legacy default remains normal; an explicitly prioritized
    /// site retains that intent.
    #[default(2u8)]
    pub construction_priority: u8,
    /// Settlement-wide unreserved building timber this lodge must leave intact
    /// when converting timber into firewood. Ignored by other building kinds.
    /// Zero preserves legacy lodge behavior for existing saves.
    #[default(0.0)]
    pub woodcutter_timber_reserve: f64,
    /// Strategic grain floor protected from routine processors and foreign
    /// sales. Farmstead seed replenishment may draw through this floor.
    /// Appended for additive save compatibility; zero preserves legacy behavior.
    #[default(0.0)]
    pub granary_grain_reserve: f64,
    /// Share of a game habitat or fish shoal's carrying capacity protected from
    /// this building's harvest. Ignored by other building kinds. Appended for
    /// additive save compatibility; zero preserves legacy behavior.
    #[default(0u8)]
    pub harvest_reserve_percent: u8,
    /// Raw fleece awaiting local weaving. Appended for additive save compatibility.
    #[default(0.0)]
    pub wool: f64,
    /// Finished woven cloth awaiting sale. Appended for additive save compatibility.
    #[default(0.0)]
    pub cloth: f64,
    /// Finished polearms retained at a carpenter after current company deliveries.
    ///
    /// Existing saves keep the former full-workshop behavior; newly placed
    /// carpenters start with a smaller one-company reserve.
    #[default(24u8)]
    pub carpenter_polearm_reserve: u8,
    /// Order in which this company claims scarce weapons, routine supplies,
    /// and treasury wages. Existing saves remain at normal priority; ignored
    /// by other building kinds.
    #[default(1u8)]
    pub guardhouse_pay_priority: u8,
    /// Desired ironwork held at this marketplace in whole six-unit import lots.
    /// Existing saves default to manual-only procurement; ignored elsewhere.
    #[default(0u8)]
    pub marketplace_ironwork_target: u8,
    /// 0 = sell specialty goods at any rate, 1 = hold below fair value,
    /// 2 = hold for favorable regional demand. Appended for save compatibility.
    #[default(0u8)]
    pub marketplace_specialty_export_policy: u8,
    /// Fresh-food capacity target used by institutional collection carts.
    /// The legacy hard-coded behavior filled granaries to 75%.
    #[default(75u8)]
    pub granary_fresh_food_target_percent: u8,
    /// Per-material village-storehouse collection ceilings. Construction and
    /// household fuel may still draw below these levels. Appended fields retain
    /// the former fill-to-capacity behavior for existing saves.
    #[default(100u8)]
    pub storehouse_timber_target_percent: u8,
    #[default(100u8)]
    pub storehouse_stone_target_percent: u8,
    #[default(100u8)]
    pub storehouse_firewood_target_percent: u8,
    /// Finished-goods ceiling for staffed conversion workshops. Inputs stop
    /// arriving while output is at this level, but outgoing demand may draw it
    /// down and restart production. Appended for additive save compatibility.
    #[default(100u8)]
    pub processor_output_target_percent: u8,
    /// Fresh-food units reserved per armed guard. Appended so existing saves
    /// retain the former six-unit company standard without reordering fields;
    /// ignored by other building kinds.
    #[default(6u8)]
    pub guardhouse_food_reserve: u8,
    /// Desired seed grain held at this marketplace in whole twenty-four-unit
    /// import lots. Appended for additive save compatibility; existing saves
    /// remain manual-only, and farmsteads must still collect the grain by road.
    #[default(0u8)]
    pub marketplace_seed_grain_target: u8,
    /// Only meaningful for the automatically created founders' camp. Its
    /// shelters remain visible while any of the original settlers are unhoused;
    /// the stockyard can persist after the tents are struck.
    #[default(false)]
    pub founding_shelter_active: bool,
    /// Stable compact code for one cart-staged manual export or barter order
    /// awaiting physical stock. The offer itself remains balance-defined, and
    /// progress is derived from marketplace stock and delivery trips.
    /// Appended for additive save compatibility; existing saves have no order.
    #[default(0u8)]
    pub marketplace_pending_trade_code: u8,
    /// Gold physically held at a chapel but pledged to a road-linked monastery.
    /// This subset of `gold` is unavailable for parish expenses until a free
    /// hauler carries it away. Appended for additive save compatibility;
    /// existing coffers begin with no outstanding monastic obligation.
    #[default(0.0)]
    pub chapel_monastery_tithe_due: f64,
    /// Physical source-held fares and visitor gifts pledged to the civic
    /// treasury. This subset of `gold` is unspendable until a handcart reaches
    /// the Town Hall or founding lockbox. Monastery tithe money remains outside
    /// this subset. Appended for additive save compatibility.
    #[default(0.0)]
    pub civic_receipts_gold: f64,
    /// Working coin kept physically at a marketplace for imports. Only gold
    /// above this target is swept back to the civic treasury. Appended with
    /// the former one-lot purchasing capacity as the save-compatible default.
    #[default(32u8)]
    pub marketplace_gold_reserve_target: u8,
    /// Threshed brewing barley. Appended so existing saves retain zero stock
    /// until a barley field is harvested or seed is imported.
    #[default(0.0)]
    pub barley: f64,
    /// Germinated and kiln-dried barley awaiting the copper. Kept physically
    /// at the brewhouse and appended for additive save compatibility.
    #[default(0.0)]
    pub malt: f64,
    /// Pulled flax awaiting water-assisted retting, breaking, spinning, and
    /// weaving at the workshop yard. Appended for additive save compatibility.
    #[default(0.0)]
    pub flax: f64,
    /// Explicit watch post this guard company must answer. Zero keeps the
    /// save-compatible nearest-staffed-watch behavior; ignored by other kinds.
    /// The order remains through temporary staffing or fire outages so a
    /// disrupted frontier plan cannot silently reassign itself.
    #[default(0u64)]
    pub guardhouse_muster_watchtower_id: u64,
}

/// A player-drawn arable parcel worked by a nearby farmstead (`threshing_barn`).
/// Corners are stored clockwise and describe an oriented rectangle authored by the field tool.
#[spacetimedb::table(
    accessor = farm_field,
    public,
    index(accessor = owner, btree(columns = [owner])),
    index(accessor = farmstead_id, btree(columns = [farmstead_id]))
)]
#[derive(Clone)]
pub struct FarmField {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub owner: Identity,
    pub farmstead_id: u64,
    pub corner_ax: f64,
    pub corner_az: f64,
    pub corner_bx: f64,
    pub corner_bz: f64,
    pub corner_cx: f64,
    pub corner_cz: f64,
    pub corner_dx: f64,
    pub corner_dz: f64,
    /// Square meters measured from the authoritative polygon.
    pub area: f64,
    /// Average terrain slope supplied by the deterministic client terrain sampler.
    pub average_slope_degrees: f64,
    /// Groundwater/valley moisture sampled authoritatively from the shared hydrology grid.
    pub moisture: f64,
    /// Persistent soil fertility, depleted by cereals and restored by fallow.
    pub fertility: f64,
    /// 0 = rye, 1 = oats, 2 = fallow.
    pub crop: u8,
    /// Crop scheduled for the next cycle; may be changed while the current crop grows.
    #[default(0u8)]
    pub next_crop: u8,
    /// 0 = ploughing, 1 = sowing, 2 = growing, 3 = harvesting.
    pub stage: u8,
    /// Normalized progress through the current stage.
    pub stage_progress: f64,
    /// 0-3; higher values are worked first by the farmstead.
    #[default(1)]
    pub priority: u8,
    /// Finished harvest cycles, useful for UI and deterministic tests.
    #[default(0u32)]
    pub harvest_count: u32,
    /// Grain from the latest completed harvest.
    #[default(0.0)]
    pub last_yield: f64,
    /// Grain already brought in during the current September harvest.
    ///
    /// Kept separately from `last_yield` so an in-progress or storage-blocked
    /// harvest survives restarts and can be closed accurately at the deadline.
    #[default(0.0)]
    pub current_yield: f64,
    /// Yield fraction locked when harvest begins. Normal September harvests use 1.0;
    /// an August early cut stores its reduced ripeness here so saves and reconnects
    /// cannot restore the sacrificed crop.
    #[default(1.0)]
    pub harvest_yield_multiplier: f64,
    /// Third crop in an optional cyclic plan. A valid crop rotates current,
    /// next, and following slots after every cycle; 255 preserves the legacy
    /// behavior where `next_crop` repeats indefinitely.
    #[default(255u8)]
    pub following_crop: u8,
}

/// A player-drawn grazing parcel tied to a pastoral farmstead or woodland swineherd.
/// Unlike arable fields, pannage pastures retain mature trees so mast capacity changes
/// naturally when the surrounding woodland is felled or regrows.
#[spacetimedb::table(
    accessor = pasture,
    public,
    index(accessor = owner, btree(columns = [owner])),
    index(accessor = farmstead_id, btree(columns = [farmstead_id]))
)]
#[derive(Clone)]
pub struct Pasture {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub owner: Identity,
    pub farmstead_id: u64,
    pub corner_ax: f64,
    pub corner_az: f64,
    pub corner_bx: f64,
    pub corner_bz: f64,
    pub corner_cx: f64,
    pub corner_cz: f64,
    pub corner_dx: f64,
    pub corner_dz: f64,
    pub area: f64,
    pub average_slope_degrees: f64,
    pub moisture: f64,
}

/// Authoritative herd state. Species: 0 cattle, 1 sheep, 2 swine.
#[spacetimedb::table(
    accessor = livestock_herd,
    public,
    index(accessor = owner, btree(columns = [owner]))
)]
#[derive(Clone)]
pub struct LivestockHerd {
    #[primary_key]
    pub building_id: u64,
    pub owner: Identity,
    pub species: u8,
    pub head_count: u32,
    pub health: f64,
    pub breeding_progress: f64,
    /// Supported heads after terrain and woodland-mast modifiers.
    pub pasture_capacity: f64,
    /// Supported heads after any grain supplement consumed this cycle.
    pub supplied_capacity: f64,
    pub last_food_output: f64,
    pub last_preserved_output: f64,
    pub last_wool_gold: f64,
    /// Desired herd kept through winter. The shared migration default is valid
    /// for every species; newly created herds use their species-specific value.
    #[default(7u32)]
    pub breeding_reserve: u32,
    /// Animals culled during the most recent livestock work cycle.
    #[default(0u32)]
    pub last_culled: u32,
    /// Dried grass stored locally in the holding's loft and hayrack.
    #[default(0.0)]
    pub hay_stock: f64,
    /// Hay cut during the most recent livestock work cycle.
    #[default(0.0)]
    pub last_hay_output: f64,
    /// Share of summer pasture withheld from grazing and cut for winter hay.
    #[default(0u8)]
    pub haymaking_percent: u8,
    /// Wool stored during the most recent annual shearing.
    #[default(0.0)]
    pub last_wool_output: f64,
    /// Calendar year of the last completed shearing; zero means never shorn.
    #[default(0u32)]
    pub last_shearing_year: u32,
}

#[spacetimedb::table(accessor = road_network_state, public)]
pub struct RoadNetworkState {
    #[primary_key]
    pub owner: Identity,
    pub snapshot_json: String,
}

#[spacetimedb::table(accessor = burgage_zone, public, index(accessor = owner, btree(columns = [owner])))]
pub struct BurgageZone {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub owner: Identity,
    pub corner_ax: f64,
    pub corner_az: f64,
    pub corner_bx: f64,
    pub corner_bz: f64,
    pub corner_cx: f64,
    pub corner_cz: f64,
    pub corner_dx: f64,
    pub corner_dz: f64,
    pub frontage_edge: u8,
    pub plot_count: u32,
}

#[spacetimedb::table(accessor = residence, public, index(accessor = zone_id, btree(columns = [zone_id])), index(accessor = owner, btree(columns = [owner])))]
#[derive(Clone)]
pub struct Residence {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub zone_id: u64,
    pub owner: Identity,
    pub parcel_index: u32,
    pub x: f64,
    pub z: f64,
    pub yaw: f64,
    pub population: u32,
    pub population_capacity: u32,
    /// 0 = physical cottage worksite, 1 = cottage, 2 = house,
    /// 3 = prosperous house. Existing saves only contain tiers 1-3.
    #[default(1)]
    pub tier: u8,
    pub settlement_ticks: u32,
    pub abandoned: bool,
    /// Gold saved by the household from marketplace garden sales (capped).
    #[default(0.0)]
    pub household_wealth: f64,
    /// Last sim tick this household auto-ordered provender from the marketplace.
    #[default(0u64)]
    pub last_household_market_tick: u64,
    /// Zero when idle; otherwise the tier being built through physical,
    /// cart-supplied cottage construction or household improvement works.
    #[default(0u8)]
    pub upgrade_target_tier: u8,
    #[default(0.0)]
    pub upgrade_progress: f64,
    #[default(0.0)]
    pub upgrade_required_timber: f64,
    #[default(0.0)]
    pub upgrade_required_stone: f64,
    #[default(0.0)]
    pub upgrade_required_gold: f64,
    #[default(0.0)]
    pub upgrade_delivered_timber: f64,
    #[default(0.0)]
    pub upgrade_delivered_stone: f64,
    #[default(0.0)]
    pub upgrade_delivered_gold: f64,
    /// Unloaded stock still earmarked at physical sources. Reservations fall
    /// as carts load, so cargo cannot be spent twice while traveling.
    #[default(0.0)]
    pub upgrade_reserved_timber: f64,
    #[default(0.0)]
    pub upgrade_reserved_stone: f64,
    #[default(0.0)]
    pub upgrade_reserved_gold: f64,
    /// One visible builder at most; zero leaves the project queued without
    /// consuming the settlement labor pool.
    #[default(0u32)]
    pub upgrade_assigned_labor: u32,
    /// Shares the existing hold/low/normal/urgent construction vocabulary.
    #[default(2u8)]
    pub upgrade_priority: u8,
    /// Zero when no backyard improvement is being built; otherwise the stable
    /// `BackyardGardenKind` id. Physical-economy saves reuse the household
    /// worksite fields above so materials remain at stores until carted here.
    /// Appended for additive save compatibility; existing gardens stay complete.
    #[default(0u8)]
    pub backyard_project_kind: u8,
    /// True while a fire-disabled homestead is being physically repaired or
    /// reconstructed. The existing household worksite fields carry its
    /// materials, builder, priority, and progress so recovery competes in the
    /// same settlement queue. Appended for additive save compatibility.
    #[default(false)]
    pub fire_repair_active: bool,
}

#[spacetimedb::table(
    accessor = backyard_garden,
    public,
    index(accessor = residence_id, btree(columns = [residence_id])),
    index(accessor = owner, btree(columns = [owner]))
)]
pub struct BackyardGarden {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub residence_id: u64,
    pub owner: Identity,
    /// Matches `BackyardGardenKind` in balance_generated.
    pub kind: u8,
}

/// Simulated regional market prices and neighbor trade conditions for a player.
#[spacetimedb::table(accessor = market_state, public)]
pub struct MarketState {
    #[primary_key]
    pub owner: Identity,
    /// Buy/sell price multipliers per tradable resource (1.0 = base balance price).
    #[default(1.0)]
    pub timber_price_mult: f64,
    #[default(1.0)]
    pub stone_price_mult: f64,
    #[default(1.0)]
    pub firewood_price_mult: f64,
    #[default(1.0)]
    pub food_price_mult: f64,
    /// Simulated neighboring-region supply/demand indices (0–1).
    #[default(0.5)]
    pub regional_timber_supply: f64,
    #[default(0.5)]
    pub regional_stone_supply: f64,
    #[default(0.5)]
    pub regional_firewood_demand: f64,
    #[default(0.5)]
    pub regional_food_demand: f64,
    #[default(0.5)]
    pub regional_food_supply: f64,
    #[default(0u64)]
    pub last_price_tick: u64,
    /// Flavor bulletin for the marketplace UI.
    pub bulletin: String,
    /// Shared regional rate for physically hauled ale, honey, wine, and cloth.
    /// Appended fields retain neutral defaults for existing market rows.
    #[default(1.0)]
    pub specialty_price_mult: f64,
    #[default(0.5)]
    pub regional_specialty_demand: f64,
}

/// Per-settlement frontier pressure. Peaceful worlds keep this row at zero.
#[spacetimedb::table(accessor = settlement_security, public)]
pub struct SettlementSecurity {
    #[primary_key]
    pub owner: Identity,
    /// Normalized progress toward the next hostile incursion.
    #[default(0.0)]
    pub threat: f64,
    /// Weighted share of settlement homes and stores inside staffed watch coverage.
    #[default(0.0)]
    pub coverage: f64,
    #[default(0.0)]
    pub protected_value: f64,
    #[default(0.0)]
    pub total_value: f64,
    #[default(0u32)]
    pub staffed_watchtowers: u32,
    /// Armed, provisioned and paid guards available at this security update.
    #[default(0.0)]
    pub ready_guards: f64,
    /// Normalized settlement-wide guard readiness.
    #[default(0.0)]
    pub defense_readiness: f64,
    #[default(0u64)]
    pub next_raid_tick: u64,
    #[default(0u64)]
    pub last_raid_tick: u64,
    /// 0 = none, 1 = warning/averted, 2 = stores plundered, 3 = plunder and arson.
    #[default(0u8)]
    pub last_outcome: u8,
    #[default(0.0)]
    pub last_goods_lost: f64,
    #[default(0.0)]
    pub last_wealth_lost: f64,
    /// Ready guards needed to fully repel the currently projected raid at present watch coverage.
    #[default(0.0)]
    pub guards_required: f64,
    /// Combined stores and households likely to be struck if the projected raid arrived now.
    #[default(0u32)]
    pub targets_at_risk: u32,
    /// Fraction of portable stock likely to be lost at each selected holding.
    #[default(0.0)]
    pub estimated_loss_fraction: f64,
}

/// Active road delivery agent — position and phase are authoritative; cargo unloads on arrival.
#[spacetimedb::table(
    accessor = delivery_trip,
    public,
    index(accessor = building_id, btree(columns = [building_id])),
    index(accessor = residence_id, btree(columns = [residence_id])),
    index(accessor = target_building_id, btree(columns = [target_building_id])),
    index(accessor = owner, btree(columns = [owner]))
)]
pub struct DeliveryTrip {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub owner: Identity,
    pub building_id: u64,
    pub residence_id: u64,
    /// 0 = residence supply, 1 = building supply, 2 = emergency fire response,
    /// 3 = parish alms delivered into household wealth.
    pub destination_kind: u8,
    /// Lodge or other building receiving a supply haul when `destination_kind == 1`.
    pub target_building_id: u64,
    /// 0 = firewood, 1 = water, 2 = food, 3 = timber, 4+ = expanded commodities.
    pub cargo_kind: u8,
    /// Cargo still on the cart (decreases when unloaded at residence).
    pub amount: f64,
    /// 0 = outbound, 1 = unloading, 2 = inbound
    pub phase: u8,
    pub x: f64,
    pub z: f64,
    /// Meters traveled along the current leg (outbound or inbound).
    pub progress: f64,
    pub speed_mps: f64,
    pub unload_seconds: f64,
    pub unload_remaining: f64,
    pub delivery_workers: u32,
    /// Total road-graph travel distance for the outbound leg (cached at trip start).
    pub path_distance: f64,
    /// Combined road-condition pace and carpenter bonus captured when the trip starts.
    pub travel_speed_multiplier: f64,
    /// JSON array of `[x, z]` polyline samples for authoritative movement.
    pub route_polyline_json: String,
    /// Cart workers committed outside the origin building's current labor roster.
    /// This includes free crews borrowed at departure and staffed haulers whose
    /// building assignment was reduced while they were already on the road.
    #[default(0)]
    pub free_hauler_workers: u32,
}

/// A server-authoritative structural fire. Resolved fires linger briefly so the
/// client can render steam; destroyed structures retain a ruin incident until demolition.
#[spacetimedb::table(
    accessor = fire_incident,
    public,
    index(accessor = owner, btree(columns = [owner])),
    index(accessor = target_id, btree(columns = [target_id]))
)]
#[derive(Clone)]
pub struct FireIncident {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub owner: Identity,
    /// 0 = workplace/building, 1 = residence.
    pub target_kind: u8,
    pub target_id: u64,
    pub x: f64,
    pub z: f64,
    /// 0 = lightning, 1 = hearth/workshop accident, 2 = spread, 3 = hostile raid.
    pub ignition_source: u8,
    /// 0 = burning, 1 = extinguished, 2 = destroyed.
    pub state: u8,
    pub intensity: f64,
    pub damage: f64,
    pub water_delivered: f64,
    pub required_water: f64,
    /// Probability used for the most recent bucket attempt.
    pub extinguish_chance: f64,
    pub started_tick: u64,
    pub last_water_tick: u64,
    pub resolved_tick: u64,
    /// Well currently dispatching a responder, or zero while unclaimed.
    pub response_well_id: u64,
}

#[spacetimedb::table(
    accessor = residence_need,
    public,
    index(accessor = residence_id, btree(columns = [residence_id]))
)]
pub struct ResidenceNeed {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub residence_id: u64,
    pub need_kind: u8,
    pub stock: f64,
    pub deficit_ticks: u32,
}
