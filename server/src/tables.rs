use spacetimedb::{ConnectionId, Identity, Timestamp};

/// A transport connection only becomes a gameplay session after the client has
/// subscribed, bootstrapped the world, and hydrated its authoritative roads.
/// Probe and preloader connections never insert this private row, so they
/// cannot wake the simulation. Multiple rows intentionally support duplicate
/// tabs and future co-op clients without pausing a world that is still in use.
#[spacetimedb::table(
    accessor = active_game_session,
    index(accessor = identity, btree(columns = [identity]))
)]
pub struct ActiveGameSession {
    #[primary_key]
    pub connection_id: ConnectionId,
    pub identity: Identity,
    pub entered_at: Timestamp,
}

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
    /// Authoritative whole-simulation multiplier: 0 (paused), 1, 4, or 8.
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
    /// Controls deposit counts, rich-resource odds, clay yield, and wild-food sites.
    /// Appended so established development worlds migrate without a reset.
    #[default(50)]
    pub resource_abundance: u8,
    /// Controls whether extra deposits and wild resources specialize or diversify.
    /// Appended so established development worlds migrate without a reset.
    #[default(50)]
    pub resource_variety: u8,
    /// Enables ambient fires, lightning ignition, fire spread, and summer droughts.
    /// Appended and disabled so existing and new settlements get the safer ruleset.
    #[default(false)]
    pub severe_weather_enabled: bool,
    /// Uses a seeded underground network instead of uniform reliable well groundwater.
    /// Appended and disabled so existing and new settlements keep forgiving well placement.
    #[default(false)]
    pub well_aquifer_networks_enabled: bool,
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
    /// Deprecated compatibility field. Parish funds no longer sweep to civic accounts.
    #[default(false)]
    pub chapel_auto_sweep_enabled: bool,
    /// Deprecated compatibility field retained so existing saves migrate additively.
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
    /// Historical compatibility ledger; new civic appropriation is prohibited.
    #[default(0.0)]
    pub parish_manual_collect_total: f64,
    /// Historical compatibility ledger; no new automatic sweeps occur.
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
    /// Negotiated secular share of monastery offerings and estate exports.
    #[default(0.1)]
    pub monastery_levy_rate: f64,
    #[default(0.0)]
    pub monastery_levy_collected_total: f64,
    #[default(0u32)]
    pub monastery_feasts_held_total: u32,
    #[default(0.0)]
    pub monastery_seed_rescue_total: f64,
    #[default(0.0)]
    pub monastery_scriptorium_timber_saved_total: f64,
    #[default(0.0)]
    pub monastery_scriptorium_stone_saved_total: f64,
    #[default(0.0)]
    pub monastery_scriptorium_ironwork_saved_total: f64,
    #[default(0.0)]
    pub monastery_scriptorium_roof_tiles_saved_total: f64,
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
    /// workers fairly in stable worksite order. Appended for additive
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
    /// workers by a stable automatic order. Appended for additive save compatibility;
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
    /// Regional iron blooms and bars awaiting local smithing.
    #[default(0.0)]
    pub iron: f64,
    /// Locally dug clay awaiting firing.
    #[default(0.0)]
    pub clay: f64,
    /// Local or imported salt held for curing and trade.
    #[default(0.0)]
    pub salt: f64,
    /// Locally burned charcoal reserved for high-temperature craft.
    #[default(0.0)]
    pub charcoal: f64,
    /// Fired household and preserving vessels.
    #[default(0.0)]
    pub pottery: f64,
    /// Night watch: 0 = ordinary watch, 1 = reinforced, 2 = stand down.
    #[default(0u8)]
    pub night_watch_policy: u8,
    /// Evening life: 0 = quiet homes, 1 = courtyard visits, 2 = open late.
    #[default(1u8)]
    pub night_gathering_policy: u8,
    /// Night production: 0 = day shift, 1 = continuous processes, 2 = staffed shift.
    #[default(1u8)]
    pub night_work_policy: u8,
    /// Public lighting: 0 = conserve, 1 = main roads, 2 = fully lit.
    #[default(1u8)]
    pub night_lighting_policy: u8,
    /// Curfew: 0 = none, 1 = children indoors, 2 = general curfew.
    #[default(1u8)]
    pub night_curfew_policy: u8,
    /// Calendar day represented by the most recently completed dawn report.
    #[default(0u64)]
    pub last_night_report_day: u64,
    #[default(0u32)]
    pub last_night_households: u32,
    #[default(0u32)]
    pub last_night_well_rested_households: u32,
    #[default(0u32)]
    pub last_night_cold_households: u32,
    #[default(0u32)]
    pub last_night_social_households: u32,
    #[default(0u32)]
    pub last_night_workers: u32,
    #[default(0.0)]
    pub last_night_watch_strength: f64,
    #[default(0u32)]
    pub last_night_incidents: u32,
    #[default(0.0)]
    pub last_night_theft_gold: f64,
    #[default(0u32)]
    pub last_night_wildlife_sightings: u32,
    #[default(0.0)]
    pub last_night_lighting_fuel_used: f64,
    #[default(0.0)]
    pub last_night_lighting_fuel_shortfall: f64,
    /// Smoothed 0-1 benefit from safe, sociable evenings.
    #[default(0.5)]
    pub night_community_cohesion: f64,
    /// Smoothed 0-1 burden from staffing workshops through the night.
    #[default(0.0)]
    pub night_labor_fatigue: f64,
    /// Fired roof tiles recovered from a legacy ledger or demolished stores.
    /// Fresh production remains physically at a kiln until hauled.
    #[default(0.0)]
    pub roof_tiles: f64,
    /// Typed ready-to-eat provisions. `food` and `preserved_food` above remain
    /// legacy mixed stores so existing saves migrate additively without
    /// fabricating a composition that can no longer be recovered.
    #[default(0.0)]
    pub meat: f64,
    #[default(0.0)]
    pub fish: f64,
    #[default(0.0)]
    pub berries: f64,
    #[default(0.0)]
    pub mushrooms: f64,
    #[default(0.0)]
    pub milk: f64,
    #[default(0.0)]
    pub apples: f64,
    #[default(0.0)]
    pub cherries: f64,
    #[default(0.0)]
    pub vegetables: f64,
    #[default(0.0)]
    pub eggs: f64,
    #[default(0.0)]
    pub grapes: f64,
    #[default(0.0)]
    pub cured_meat: f64,
    #[default(0.0)]
    pub smoked_fish: f64,
    #[default(0.0)]
    pub cheese: f64,
    /// Optional annual land levy as a fraction of assessed burgage value.
    #[default(0.0)]
    pub land_levy_rate: f64,
    /// Optional customs duty on private household-funded regional imports.
    #[default(0.0)]
    pub import_duty_rate: f64,
    /// Optional customs share of automatic private specialty-export proceeds.
    #[default(0.0)]
    pub export_duty_rate: f64,
    #[default(0.0)]
    pub land_levy_assessed_total: f64,
    #[default(0.0)]
    pub land_levy_collected_total: f64,
    #[default(0.0)]
    pub import_duty_collected_total: f64,
    #[default(0.0)]
    pub export_duty_collected_total: f64,
    #[default(0.0)]
    pub private_export_income_total: f64,
    /// Household coin spent on optional market goods. This is conserved local
    /// circulation, distinct from regional exports that introduce new coin.
    #[default(0.0)]
    pub local_discretionary_spend_total: f64,
    /// Net local producer proceeds created by those optional purchases.
    #[default(0.0)]
    pub local_producer_income_total: f64,
    /// Crop-typed arable goods. Crop identity is preserved from harvest
    /// through household consumption.
    #[default(0.0)]
    pub rye_sheaves: f64,
    #[default(0.0)]
    pub oat_sheaves: f64,
    #[default(0.0)]
    pub barley_sheaves: f64,
    #[default(0.0)]
    pub maslin_sheaves: f64,
    #[default(0.0)]
    pub rye_grain: f64,
    #[default(0.0)]
    pub oat_grain: f64,
    #[default(0.0)]
    pub maslin_grain: f64,
    #[default(0.0)]
    pub rye_flour: f64,
    #[default(0.0)]
    pub maslin_flour: f64,
    #[default(0.0)]
    pub rye_bread: f64,
    #[default(0.0)]
    pub maslin_bread: f64,
    /// Town Hall market-issue doctrine: 0 = daily issue only, 1 = safeguard
    /// below one household day, 2 = safeguard below two days.
    /// Appended for additive save compatibility; established settlements keep
    /// the former automatic one-day emergency behavior.
    #[default(1u8)]
    pub pantry_safeguard_policy: u8,
    /// Fermented orchard drink recovered from demolished stores or interrupted hauling.
    #[default(0.0)]
    pub cider: f64,
    /// Honey wine recovered from demolished stores or interrupted hauling.
    #[default(0.0)]
    pub mead: f64,
    /// Untanned animal skins recovered from hunting, goat pens, demolition, or hauling.
    #[default(0.0)]
    pub hides: f64,
    /// Vegetable-tanned leather recovered from workshops or interrupted hauling.
    #[default(0.0)]
    pub leather: f64,
    /// Finished footwear recovered from cobblers or interrupted household delivery.
    #[default(0.0)]
    pub shoes: f64,
    /// Backyard crops and preserves retain their species identity through every ledger.
    #[default(0.0)]
    pub pears: f64,
    #[default(0.0)]
    pub aronia: f64,
    #[default(0.0)]
    pub rosehips: f64,
    #[default(0.0)]
    pub cabbage: f64,
    #[default(0.0)]
    pub carrots: f64,
    #[default(0.0)]
    pub beetroot: f64,
    #[default(0.0)]
    pub aronia_jam: f64,
    #[default(0.0)]
    pub rosehip_jam: f64,
    /// Pear cider is distinct from the established `cider` (apple cider) stock.
    #[default(0.0)]
    pub pear_cider: f64,
}

#[spacetimedb::table(accessor = quarry, public)]
pub struct Quarry {
    #[primary_key]
    /// `quarry-*` rows are stone; `deposit-iron-*` and `deposit-salt-*`
    /// rows are mineral seams. Prefixes preserve the additive table schema.
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
    /// Physical coin held by civic, religious, trade, and guard buildings.
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
    /// Construction queue priority: 0 = held, 1 = low, 2 = normal,
    /// 3 = urgent. Completion resets this field to normal; operating labor and
    /// logistics deliberately ignore it. The additive legacy default remains
    /// normal for save compatibility.
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
    /// Desired seed grain held at this Trading Post in whole twenty-four-unit
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
    /// progress is derived from Trading Post stock and delivery trips.
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
    /// Working coin kept physically at a Trading Post for imports. Only gold
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
    /// Fibre route preference for weavers: 0 automatically uses the deeper
    /// staged route, 1 prefers ready wool, and 2 prefers ready flax plus
    /// water. The alternate route remains a fallback so a stocked loom does
    /// not idle. Ignored by other building kinds.
    #[default(0u8)]
    pub weaver_input_policy: u8,
    /// Locally raised ore or imported regional blooms and bars.
    #[default(0.0)]
    pub iron: f64,
    /// Wet riverbank clay held at extraction and pottery yards.
    #[default(0.0)]
    pub clay: f64,
    /// Locally mined rock salt or imported Adriatic sea salt.
    #[default(0.0)]
    pub salt: f64,
    /// Firewood converted in a covered clamp for smithing fuel.
    #[default(0.0)]
    pub charcoal: f64,
    /// Fired ceramic vessels used by smokehouses and sold at market.
    #[default(0.0)]
    pub pottery: f64,
    /// Desired imported regional iron held at this marketplace in whole
    /// twelve-unit lots. Appended for additive save compatibility; zero keeps
    /// existing markets on manual procurement.
    #[default(0u8)]
    pub marketplace_iron_target: u8,
    /// Desired salt held at this marketplace in whole twelve-unit lots.
    /// Local mine carts fill the reserve first; Adriatic trade buys the
    /// remaining whole-lot shortfall. Appended for additive save
    /// compatibility; zero keeps existing markets on manual procurement.
    #[default(0u8)]
    pub marketplace_salt_target: u8,
    /// Dung and bedding collected at cattle holdings or awaiting field spreading
    /// at an arable farmstead. Kept after every older column for additive
    /// compatibility with settlements created before physical manure hauling.
    #[default(0.0)]
    pub manure: f64,
    /// Dried medicinal herbs gathered and prepared at a forager's shed.
    /// Appended for additive save compatibility.
    #[default(0.0)]
    pub remedies: f64,
    /// Iron fittings required, delivered, reserved, and backed by the legacy
    /// pre-founding-site ledger for a construction site. These fields remain
    /// after the complete pre-ironwork `Building` schema prefix so publishing
    /// upgrades an established settlement by appending columns rather than
    /// reordering its stored rows.
    #[default(0.0)]
    pub construction_required_ironwork: f64,
    #[default(0.0)]
    pub construction_delivered_ironwork: f64,
    #[default(0.0)]
    pub construction_reserved_ironwork: f64,
    #[default(0.0)]
    pub construction_treasury_ironwork: f64,
    /// Potter cart duty: 0 stocks storehouse market wares before workshop supply,
    /// 1 stages smokehouse vessels first. Either order exports only after its
    /// two local duties. Appended so established kilns retain household-first.
    #[default(0u8)]
    pub pottery_dispatch_policy: u8,
    /// Protected wheelwright repair-kit depth at a carpenter, measured in
    /// accelerated cart departures. Zero disables kit procurement and use
    /// while retaining skilled construction framing. The additive default
    /// preserves the original fifteen-departure service behavior.
    #[default(15u8)]
    pub carpenter_cart_service_target_trips: u8,
    /// Raw-material intake gates. Appended so existing storehouses can join
    /// the mineral logistics network without invalidating their rows.
    #[default(true)]
    pub storehouse_accepts_iron: bool,
    #[default(true)]
    pub storehouse_accepts_clay: bool,
    #[default(true)]
    pub storehouse_accepts_salt: bool,
    /// Per-material collection ceilings for the added mineral bays. As with
    /// the older bulk bays, these are intake targets rather than protected
    /// output floors, and the defaults preserve fill-to-capacity behavior.
    #[default(100u8)]
    pub storehouse_iron_target_percent: u8,
    #[default(100u8)]
    pub storehouse_clay_target_percent: u8,
    #[default(100u8)]
    pub storehouse_salt_target_percent: u8,
    /// Fired clay roofing pieces awaiting a specific household retrofit.
    /// Appended after the established building schema for additive migration.
    #[default(0.0)]
    pub roof_tiles: f64,
    /// Kiln firing choice: 0 household/preserving vessels, 1 roof tiles.
    #[default(0u8)]
    pub potter_firing_policy: u8,
    /// Deprecated presentation toggle retained in place for additive schema
    /// compatibility. New clients ignore it and require a linked building.
    #[default(false)]
    pub remote_work_camp_enabled: bool,
    /// Parent rural worksite for a separately placed overnight camp. Zero for
    /// every ordinary building. The linked camp retains a normal construction,
    /// fire, repair, and demolition lifecycle.
    #[default(0u64)]
    pub linked_worksite_id: u64,
    /// Fraction of an exposed rural crew's nominal shift left after its
    /// household commute. Rebuilt from current homes and roads once per day;
    /// a completed, fire-safe linked camp bypasses it at runtime. The additive
    /// default preserves existing production until the first review.
    #[default(1.0)]
    pub commute_efficiency: f64,
    /// Visual and service tier for the legacy `chapel` kind: 1 small timber,
    /// 2 small stone, 3 large stone. The legacy default preserves the former
    /// large church when an established settlement is migrated.
    #[default(3u8)]
    pub chapel_tier: u8,
    /// Typed ready-to-eat provisions. These share the building's fresh or
    /// preserved capacity according to commodity metadata; the legacy `food`
    /// columns remain readable mixed-provision stores for old saves.
    #[default(0.0)]
    pub meat: f64,
    #[default(0.0)]
    pub fish: f64,
    #[default(0.0)]
    pub berries: f64,
    #[default(0.0)]
    pub mushrooms: f64,
    #[default(0.0)]
    pub milk: f64,
    #[default(0.0)]
    pub apples: f64,
    #[default(0.0)]
    pub cherries: f64,
    #[default(0.0)]
    pub vegetables: f64,
    #[default(0.0)]
    pub eggs: f64,
    #[default(0.0)]
    pub grapes: f64,
    #[default(0.0)]
    pub cured_meat: f64,
    #[default(0.0)]
    pub smoked_fish: f64,
    #[default(0.0)]
    pub cheese: f64,
    /// Private automatic-export proceeds awaiting free-hauler distribution to
    /// settlement households. This is a protected subset of `gold`, just as
    /// `civic_receipts_gold` is the protected public subset.
    #[default(0.0)]
    pub private_export_proceeds_gold: f64,
    /// Grapes physically committed to the current sealed fermentation batch.
    #[default(0.0)]
    pub vineyard_fermenting_grapes: f64,
    /// Worked cellar seconds accumulated toward the current wine batch.
    #[default(0.0)]
    pub vineyard_fermentation_progress: f64,
    /// Apiary extraction choice: 0 conservative, 1 balanced, 2 extractive.
    #[default(1u8)]
    pub apiary_harvest_policy: u8,
    /// Persistent colony strength after overwintering, normally 0.35-1.10.
    #[default(1.0)]
    pub apiary_colony_health: f64,
    /// Last calendar year whose December winter stores were consumed.
    #[default(0u32)]
    pub apiary_last_winter_year: u32,
    /// Last authoritative bounded forage score, replicated for planning UI.
    #[default(0.75)]
    pub apiary_forage_score: f64,
    /// Family price floors. 255 migrates an established post by falling back
    /// to its former shared specialty policy until the player changes it.
    #[default(255u8)]
    pub marketplace_drink_export_policy: u8,
    #[default(255u8)]
    pub marketplace_provision_export_policy: u8,
    #[default(255u8)]
    pub marketplace_wares_export_policy: u8,
    /// Physical crop-typed arable inventory.
    #[default(0.0)]
    pub rye_sheaves: f64,
    #[default(0.0)]
    pub oat_sheaves: f64,
    #[default(0.0)]
    pub barley_sheaves: f64,
    #[default(0.0)]
    pub maslin_sheaves: f64,
    #[default(0.0)]
    pub rye_grain: f64,
    #[default(0.0)]
    pub oat_grain: f64,
    #[default(0.0)]
    pub maslin_grain: f64,
    #[default(0.0)]
    pub rye_flour: f64,
    #[default(0.0)]
    pub maslin_flour: f64,
    #[default(0.0)]
    pub rye_bread: f64,
    #[default(0.0)]
    pub maslin_bread: f64,
    /// Farmstead work focus: 1 = fields first, 2 = demand-aware automatic,
    /// 3 = threshing before every non-harvest field job.
    #[default(2u8)]
    pub threshing_priority: u8,
    /// True while a fire-damaged, non-destroyed building is being repaired
    /// through the construction labor/material pipeline. The completed mesh
    /// remains standing; destroyed structures use ordinary reconstruction
    /// visuals instead. Appended for additive save compatibility.
    #[default(false)]
    pub fire_repair_active: bool,
    /// Charcoal intake is separate from ordinary firewood because the depot
    /// may reserve processed fuel for smithies, household markets, or neither.
    #[default(true)]
    pub storehouse_accepts_charcoal: bool,
    /// Intake ceiling for stored charcoal. A quarter-capacity default creates
    /// a useful transfer cache without turning every depot into a huge fuel sink.
    #[default(25u8)]
    pub storehouse_charcoal_target_percent: u8,
    /// Fired-clay roofing required, delivered, reserved, and backed by the
    /// legacy pre-founding-site ledger for a construction site. Appended as a
    /// save-compatible group after every previously deployed Building column.
    #[default(0.0)]
    pub construction_required_roof_tiles: f64,
    #[default(0.0)]
    pub construction_delivered_roof_tiles: f64,
    #[default(0.0)]
    pub construction_reserved_roof_tiles: f64,
    #[default(0.0)]
    pub construction_treasury_roof_tiles: f64,
    /// Fermented orchard drink held by brewhouses, taverns, and haulers.
    #[default(0.0)]
    pub cider: f64,
    /// Honey wine held by brewhouses, taverns, and haulers.
    #[default(0.0)]
    pub mead: f64,
    /// Brewhouse active recipe: 0 ale, 1 apple cider, 2 mead, 3 automatic, 4 pear cider.
    #[default(0u8)]
    pub brewery_recipe_policy: u8,
    /// Monastery orchard: 0 apples, 1 grapevines.
    #[default(0u8)]
    pub monastery_orchard_planting: u8,
    /// Monastery enclosed croft: 0 kitchen vegetables, 1 brewing barley.
    #[default(0u8)]
    pub monastery_croft_planting: u8,
    /// Bitset of completed monastery extensions: infirmary, scriptorium,
    /// guesthouse, and estate workshop.
    #[default(0u8)]
    pub monastery_extensions: u8,
    /// Player-selected extension that the autonomous house will fund next.
    /// Zero means no project has been chosen.
    #[default(0u8)]
    pub monastery_next_extension: u8,
    /// First crop year of the current perennial orchard planting. Zero means
    /// the founding rows are already mature.
    #[default(0u32)]
    pub monastery_orchard_planted_year: u32,
    /// Replicated visual/production stage: 0 new, 1 young, 2 mature.
    #[default(2u8)]
    pub monastery_orchard_maturity: u8,
    /// Last year in which the enclosed annual croft choice was posted.
    #[default(0u32)]
    pub monastery_croft_choice_year: u32,
    /// Fraction of the current daily outward-service budget actually funded.
    #[default(1.0)]
    pub monastery_service_funding: f64,
    /// Rational-calendar day on which service funding was last settled.
    #[default(0u64)]
    pub monastery_last_service_day: u64,
    /// Per-commodity intake gates for Granaries and Storehouses. Commodity
    /// codes are stable bit positions; all bits default on so old saves retain
    /// their former behavior until the player changes a storage policy.
    #[default(18446744073709551615u64)]
    pub storage_acceptance_mask: u64,
    /// Physical leather-chain inventories. Appended together because the
    /// chain is introduced as one development-only schema change.
    #[default(0.0)]
    pub hides: f64,
    #[default(0.0)]
    pub leather: f64,
    #[default(0.0)]
    pub shoes: f64,
    /// Species-typed backyard harvests, preserves, and pear drink.
    #[default(0.0)]
    pub pears: f64,
    #[default(0.0)]
    pub aronia: f64,
    #[default(0.0)]
    pub rosehips: f64,
    #[default(0.0)]
    pub cabbage: f64,
    #[default(0.0)]
    pub carrots: f64,
    #[default(0.0)]
    pub beetroot: f64,
    #[default(0.0)]
    pub aronia_jam: f64,
    #[default(0.0)]
    pub rosehip_jam: f64,
    #[default(0.0)]
    pub pear_cider: f64,
}

/// One persistent import/export instruction for one Trading Post commodity.
/// The commodity code is the stable `CommodityKind` code; mode is
/// 0 = no trade, 1 = import to target, 2 = export above target.
#[spacetimedb::table(
    accessor = trading_post_trade_rule,
    public,
    index(accessor = building_id, btree(columns = [building_id])),
    index(accessor = owner, btree(columns = [owner]))
)]
#[derive(Clone)]
pub struct TradingPostTradeRule {
    #[primary_key]
    pub id: String,
    pub owner: Identity,
    pub building_id: u64,
    pub commodity_kind: u8,
    pub mode: u8,
    pub target_surplus: f64,
    /// Absolute rational-calendar month last considered by settlement.
    pub last_settled_month: u64,
    /// Positive units imported or exported in the most recent settlement.
    pub last_trade_amount: f64,
    /// Positive for export income, negative for import expense.
    pub last_trade_gold: f64,
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
    /// Physical manure already spread during this cycle's ploughing. The soil
    /// benefit is proportional to field coverage and settles at cycle end.
    #[default(0.0)]
    pub manure_applied: f64,
}

/// A player-drawn grape-growing parcel belonging to one monastery. A monastery
/// may own any number of non-overlapping parcels inside its work extent; all
/// harvest, cellar work, storage, and cart labor remain on that monastic roster.
#[spacetimedb::table(
    accessor = vineyard_parcel,
    public,
    index(accessor = owner, btree(columns = [owner])),
    index(accessor = building_id, btree(columns = [building_id]))
)]
#[derive(Clone)]
pub struct VineyardParcel {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub building_id: u64,
    pub owner: Identity,
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
    /// 0 = north-facing/shaded, 1 = strongly south-facing.
    pub south_exposure: f64,
    pub site_suitability: f64,
    pub shape_efficiency: f64,
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

/// Consecrated burial parcel inside a chapel's work extent. Capacity is derived
/// from the authored area and remains occupied permanently as burials accumulate.
#[spacetimedb::table(
    accessor = graveyard,
    public,
    index(accessor = owner, btree(columns = [owner])),
    index(accessor = chapel_id, btree(columns = [chapel_id]))
)]
#[derive(Clone)]
pub struct Graveyard {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub owner: Identity,
    pub chapel_id: u64,
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
    pub capacity: u32,
    pub burials: u32,
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
    /// Deprecated additive save field. Runtime homes normalize this to false;
    /// empty population capacity remains reusable housing.
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
    /// Consecutive shortage exposure. Food advances this every simulation
    /// step; a stocked household recovers gradually instead of snapping well.
    #[default(0u32)]
    pub hunger_ticks: u32,
    /// Persistent nutritional damage in the normalized 0-1 range.
    #[default(0.0)]
    pub malnutrition: f64,
    /// Residents temporarily unavailable for labor due to generic illness.
    #[default(0u32)]
    pub sick_population: u32,
    /// Shared household recovery progress for the current sick cohort.
    #[default(0u32)]
    pub illness_ticks: u32,
    /// Dried-herb treatments produced by an occupied herb garden.
    #[default(0.0)]
    pub remedy_stock: f64,
    #[default(0u32)]
    pub deaths_total: u32,
    /// Status shortages cause emigration on this timer; they never cause
    /// starvation or disease directly.
    #[default(0u32)]
    pub comfort_deficit_ticks: u32,
    /// Consecutive unoccupied time used by long-term building decay.
    #[default(0u32)]
    pub vacancy_ticks: u32,
    /// 0 sound, 1 neglected, 2 dilapidated, 3 ruin.
    #[default(0u8)]
    pub condition: u8,
    /// Legacy deterministic-starvation cooldown retained for additive save
    /// compatibility. Current mortality uses per-step population risk.
    #[default(0u32)]
    pub last_starvation_death_hunger_ticks: u32,
    /// Vacant-home restoration reuses the physical household project ledger
    /// while remaining distinct from fire recovery.
    #[default(false)]
    pub decay_repair_active: bool,
    /// Completed, residence-local fired-clay roof. Wooden shingles remain the
    /// historically appropriate default for every older and lower-tier home.
    #[default(false)]
    pub tiled_roof: bool,
    /// True while this prosperous household is replacing its shingle covering.
    #[default(false)]
    pub roof_tile_retrofit_active: bool,
    /// Physical fired tiles needed, delivered, and still reserved at sources.
    #[default(0.0)]
    pub upgrade_required_roof_tiles: f64,
    #[default(0.0)]
    pub upgrade_delivered_roof_tiles: f64,
    #[default(0.0)]
    pub upgrade_reserved_roof_tiles: f64,
    /// Physical pantry composition. Food-need rows retain only derived
    /// meal-equivalent availability and deficit state; these fields are the
    /// authoritative goods consumed by the household.
    #[default(0.0)]
    pub food: f64,
    #[default(0.0)]
    pub preserved_food: f64,
    #[default(0.0)]
    pub honey: f64,
    #[default(0.0)]
    pub meat: f64,
    #[default(0.0)]
    pub fish: f64,
    #[default(0.0)]
    pub berries: f64,
    #[default(0.0)]
    pub mushrooms: f64,
    #[default(0.0)]
    pub milk: f64,
    #[default(0.0)]
    pub apples: f64,
    #[default(0.0)]
    pub cherries: f64,
    #[default(0.0)]
    pub vegetables: f64,
    #[default(0.0)]
    pub eggs: f64,
    #[default(0.0)]
    pub grapes: f64,
    #[default(0.0)]
    pub cured_meat: f64,
    #[default(0.0)]
    pub smoked_fish: f64,
    #[default(0.0)]
    pub cheese: f64,
    /// False only for pre-typed-food saves whose pantry still lives solely in
    /// ResidenceNeed rows. The first need tick moves those quantities into
    /// physical mixed-provision fields exactly once.
    #[default(false)]
    pub food_inventory_migrated: bool,
    /// Last calendar day on which this household bought one optional market
    /// good. Essentials remain outside the purse economy.
    #[default(0u64)]
    pub last_discretionary_market_day: u64,
    /// Typed loaves keep their crop identity through household delivery and
    /// consumption.
    #[default(0.0)]
    pub rye_bread: f64,
    #[default(0.0)]
    pub maslin_bread: f64,
    /// Threshed oats are a ready household staple as well as livestock fodder.
    #[default(0.0)]
    pub oat_grain: f64,
    /// Backyard harvest identity survives household storage and consumption.
    #[default(0.0)]
    pub pears: f64,
    #[default(0.0)]
    pub aronia: f64,
    #[default(0.0)]
    pub rosehips: f64,
    #[default(0.0)]
    pub cabbage: f64,
    #[default(0.0)]
    pub carrots: f64,
    #[default(0.0)]
    pub beetroot: f64,
    #[default(0.0)]
    pub aronia_jam: f64,
    #[default(0.0)]
    pub rosehip_jam: f64,
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
    /// Absolute rational-calendar day on which a new orchard specialization
    /// reaches its first productive harvest. Zero is reserved for unplanted
    /// orchards and non-perennial backyard extensions.
    #[default(0u64)]
    pub first_harvest_day: u64,
    /// Last absolute rational-calendar day on which the pen's primary product
    /// (eggs, milk, or pork) was collected. Persisting this prevents an
    /// interval harvest from being repeated by every simulation tick.
    #[default(0u64)]
    pub last_primary_production_day: u64,
    /// Independent clock for lower-frequency culls (chicken/goat meat and
    /// goat hides). Plant backyards leave both production clocks at zero.
    #[default(0u64)]
    pub last_secondary_production_day: u64,
    /// Untanned goat hides retained physically at the household pen. Hides do
    /// not masquerade as wool or teleport into civic stores while the leather
    /// production chain is still absent.
    #[default(0.0)]
    pub hide_stock: f64,
    /// A tier-4 cut-flower upgrade satisfies the same luxury-comfort need as
    /// preserves while retaining the garden's pollinator/attraction effects.
    #[default(false)]
    pub flower_luxury_upgraded: bool,
}

/// A deceased resident awaiting or undergoing physical transport to a
/// consecrated graveyard. One row represents one body and one handcart load.
#[spacetimedb::table(
    accessor = corpse,
    public,
    index(accessor = owner, btree(columns = [owner])),
    index(accessor = residence_id, btree(columns = [residence_id])),
    index(accessor = chapel_id, btree(columns = [chapel_id])),
    index(accessor = graveyard_id, btree(columns = [graveyard_id]))
)]
#[derive(Clone)]
pub struct Corpse {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub owner: Identity,
    pub residence_id: u64,
    /// 0 starvation, 1 illness, 2 winter exposure.
    pub cause: u8,
    /// 0 awaiting collection, 1 empty cart outbound, 2 body inbound.
    pub state: u8,
    /// Physical body position. It remains at the home during the outbound leg
    /// and follows the handcart after collection.
    pub x: f64,
    pub z: f64,
    pub created_tick: u64,
    pub chapel_id: u64,
    pub graveyard_id: u64,
    pub progress: f64,
    pub speed_mps: f64,
    pub path_distance: f64,
    pub route_polyline_json: String,
    /// Physical gravedigger handcart position. Appended after every older
    /// column so existing corpse rows migrate additively; the body remains
    /// visible at the home until this cart actually reaches it.
    #[default(0.0)]
    pub cart_x: f64,
    #[default(0.0)]
    pub cart_z: f64,
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
    /// Legacy aggregate specialty rate retained to migrate and summarize older
    /// market rows. New trade decisions use the independent family rates below.
    #[default(1.0)]
    pub specialty_price_mult: f64,
    #[default(0.5)]
    pub regional_specialty_demand: f64,
    /// Independent specialty families. The shared fields above remain only as
    /// an additive migration/readout average for established saves.
    #[default(1.0)]
    pub drink_price_mult: f64,
    #[default(1.0)]
    pub provision_price_mult: f64,
    #[default(1.0)]
    pub wares_price_mult: f64,
    #[default(0.5)]
    pub regional_drink_demand: f64,
    #[default(0.5)]
    pub regional_provision_demand: f64,
    #[default(0.5)]
    pub regional_wares_demand: f64,
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
    /// Persisted map edge for the next incursion: 0 unknown, 1 north,
    /// 2 east, 3 south, 4 west.
    #[default(0u8)]
    pub raid_approach: u8,
    /// Along-edge coordinate paired with `raid_approach`.
    #[default(0.0)]
    pub raid_approach_offset: f64,
    /// First authoritative tick on which scouts or a staffed watchtower
    /// reported the pending approach. Zero keeps the schedule hidden.
    #[default(0u64)]
    pub warning_started_tick: u64,
    /// Reporting watchtower, or zero for an ordinary scout/traveler report.
    #[default(0u64)]
    pub warning_source_tower_id: u64,
}

/// One live hostile incursion per settlement. The row accumulates only results
/// produced by physical combat agents reaching holdings; it never resolves
/// losses on its own.
#[spacetimedb::table(accessor = active_raid, public)]
#[derive(Clone)]
pub struct ActiveRaid {
    #[primary_key]
    pub owner: Identity,
    pub raid_id: u64,
    pub started_tick: u64,
    pub enemy_pressure: u8,
    pub initial_raiders: u32,
    pub initial_guards: u32,
    pub goods_lost: f64,
    pub wealth_lost: f64,
    pub arson_started: bool,
    /// Cumulative physical raider casualties. Downed agent rows may disappear
    /// before a long fight ends, so morale cannot infer this from replication.
    #[default(0u32)]
    pub raiders_downed: u32,
    /// True once battlefield casualties break the party. Surviving attackers
    /// remain replicated and dangerous until they physically escape or fall.
    #[default(false)]
    pub rout_started: bool,
}

/// A replicated person participating in a live frontier fight.
///
/// Guards are backed by one armed guardhouse roster slot. Raiders carry their
/// own target, health, and any locally stolen goods. No holding can lose stock
/// unless one of these rows reaches it and finishes its looting action.
#[spacetimedb::table(
    accessor = combat_agent,
    public,
    index(accessor = owner, btree(columns = [owner])),
    index(accessor = raid_id, btree(columns = [raid_id]))
)]
#[derive(Clone)]
pub struct CombatAgent {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub owner: Identity,
    pub raid_id: u64,
    /// 0 = settlement guard, 1 = hostile raider.
    pub faction: u8,
    /// Guardhouse backing a guard row, or zero for a raider.
    pub source_building_id: u64,
    pub source_slot: u32,
    /// 0 = building, 1 = residence, 2 = cart, 3/4 = treasury at building/home.
    pub target_kind: u8,
    pub target_id: u64,
    pub x: f64,
    pub z: f64,
    /// Guardhouse or incursion entry point used for a physical return/escape.
    pub home_x: f64,
    pub home_z: f64,
    pub health: f64,
    pub max_health: f64,
    /// Guard provision/pay readiness captured when the company marches.
    pub readiness: f64,
    /// 0 advancing, 1 fighting, 2 looting, 3 retreating, 4 returning,
    /// 5 downed, 6 wounded return, 7 recuperating at the guardhouse.
    pub state: u8,
    /// Seconds until the next strike; while downed, seconds of readable
    /// battlefield linger remaining before removal or wounded evacuation.
    pub attack_cooldown: f64,
    pub loot_progress: f64,
    /// This agent's share of the target's contact-gated raid loss.
    pub loot_fraction: f64,
    /// JSON `RaidPortableStores` physically carried as loot or issued company
    /// equipment until escape, return, or recovery.
    pub carried_loot_json: String,
    pub state_changed_tick: u64,
    /// Distance reached along this agent's cached combat route. Fighting can
    /// interrupt it without losing the road point to rejoin or reverse toward.
    #[default(0.0)]
    pub route_progress: f64,
    /// Palisaded refuge physically holding this raider's household target.
    /// Zero means the target remains at its ordinary building, home, or cart.
    #[default(0u64)]
    pub raid_anchor_building_id: u64,
}

/// One cached road approach shared by every guard from a responding company.
///
/// This is server-only routing state. Guards prefer it while mustering and
/// returning, but leave it immediately to intercept a nearby attacker or a
/// raider already fighting at the company's assigned holding.
#[spacetimedb::table(
    accessor = guard_muster_route,
    index(accessor = owner, btree(columns = [owner]))
)]
#[derive(Clone)]
pub struct GuardMusterRoute {
    /// A settlement can have only one active raid, so the guardhouse is a
    /// stable route key and avoids duplicating the same polyline per guard.
    #[primary_key]
    pub source_building_id: u64,
    pub owner: Identity,
    pub raid_id: u64,
    pub path_distance: f64,
    pub route_polyline_json: String,
}

/// Server-only approach and escape route for one hostile combatant.
///
/// The path starts at that raider's exact map-edge formation position, joins
/// the road component serving its target, and is retained until the incursion
/// ends so stolen goods must leave along the same physical route.
#[spacetimedb::table(
    accessor = raid_incursion_route,
    index(accessor = owner, btree(columns = [owner]))
)]
#[derive(Clone)]
pub struct RaidIncursionRoute {
    #[primary_key]
    pub combat_agent_id: u64,
    pub owner: Identity,
    pub raid_id: u64,
    pub path_distance: f64,
    pub route_polyline_json: String,
}

/// Active road delivery agent — position and phase are authoritative; cargo unloads on arrival.
#[spacetimedb::table(
    accessor = delivery_trip,
    public,
    index(accessor = building_id, btree(columns = [building_id])),
    index(accessor = labor_building_id, btree(columns = [labor_building_id])),
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
    /// 3 = parish alms delivered into household wealth, 4 = household remedies,
    /// 5 = two-way regional market exchange.
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
    /// Assigned logistics workplace supplying the cart crew. Zero means the
    /// trip reserves unassigned settlement labor instead. Cargo still returns
    /// to `building_id`; labor ownership is intentionally independent.
    #[default(0u64)]
    pub labor_building_id: u64,
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
    /// Well coordinating the current response, or zero while unanswered.
    /// Several independently staffed bucket trips may share this incident.
    pub response_well_id: u64,
    /// First tick on which civilians can report and respond to the fire.
    /// Zero preserves immediate discovery for incidents from older saves.
    #[default(0u64)]
    pub discovered_tick: u64,
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
