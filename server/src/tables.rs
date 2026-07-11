use spacetimedb::Identity;

#[spacetimedb::table(accessor = world_config, public)]
pub struct WorldConfig {
    #[primary_key]
    pub id: u8,
    pub seed: u64,
    pub next_building_id: u64,
    pub sim_tick: u64,
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
}

#[spacetimedb::table(accessor = quarry, public)]
pub struct Quarry {
    #[primary_key]
    pub quarry_id: String,
    pub x: f64,
    pub z: f64,
    pub max_yield: f64,
    pub remaining: f64,
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
    pub delivery_cooldown: f64,
    pub timber: f64,
    pub firewood: f64,
    pub stone: f64,
    pub assigned_labor: u32,
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
    pub settlement_ticks: u32,
    pub abandoned: bool,
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
