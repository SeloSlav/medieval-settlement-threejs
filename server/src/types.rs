#[derive(spacetimedb::SpacetimeType, Clone, Debug)]
pub struct QuarryBootstrap {
    pub quarry_id: String,
    pub x: f64,
    pub z: f64,
    pub max_yield: f64,
}

#[derive(spacetimedb::SpacetimeType, Clone, Debug)]
pub struct ForagingBootstrap {
    pub node_id: String,
    pub node_kind: String,
    pub x: f64,
    pub z: f64,
    pub max_yield: f64,
    pub anchor_x: f64,
    pub anchor_z: f64,
}

#[derive(spacetimedb::SpacetimeType, Clone, Debug)]
pub struct TreeBootstrap {
    pub tree_id: String,
    pub layout_index: u32,
    pub wood_yield: f64,
    pub x: f64,
    pub z: f64,
}
