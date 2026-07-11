use serde::Deserialize;
use std::sync::OnceLock;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EmbeddedTree {
    tree_id: String,
    layout_index: u32,
    wood_yield: f64,
    x: f64,
    z: f64,
}

#[derive(Debug, Deserialize)]
struct EmbeddedTreesFile {
    trees: Vec<EmbeddedTree>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EmbeddedQuarry {
    quarry_id: String,
    x: f64,
    z: f64,
    max_yield: f64,
}

#[derive(Debug, Deserialize)]
struct EmbeddedQuarriesFile {
    quarries: Vec<EmbeddedQuarry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EmbeddedForagingNode {
    node_id: String,
    node_kind: String,
    x: f64,
    z: f64,
    max_yield: f64,
    anchor_x: f64,
    anchor_z: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EmbeddedRespawnPoint {
    x: f64,
    z: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EmbeddedForagingFile {
    foraging_nodes: Vec<EmbeddedForagingNode>,
    game_respawn_candidates: Vec<EmbeddedRespawnPoint>,
}

pub struct WorldBootstrapQuarry {
    pub quarry_id: String,
    pub x: f64,
    pub z: f64,
    pub max_yield: f64,
}

pub struct WorldBootstrapTree {
    pub tree_id: String,
    pub layout_index: u32,
    pub wood_yield: f64,
    pub x: f64,
    pub z: f64,
}

pub struct WorldBootstrapForagingNode {
    pub node_id: String,
    pub node_kind: String,
    pub x: f64,
    pub z: f64,
    pub max_yield: f64,
    pub anchor_x: f64,
    pub anchor_z: f64,
}

pub struct RespawnPoint {
    pub x: f64,
    pub z: f64,
}

fn parse_embedded_trees() -> Vec<EmbeddedTree> {
    let json = include_str!("../../generated/world_trees.json");
    let file: EmbeddedTreesFile = serde_json::from_str(json).expect("world_trees.json must be valid");
    file.trees
}

fn parse_embedded_quarries() -> Vec<EmbeddedQuarry> {
    let json = include_str!("../../generated/world_quarries.json");
    let file: EmbeddedQuarriesFile =
        serde_json::from_str(json).expect("world_quarries.json must be valid");
    file.quarries
}

fn parse_embedded_foraging() -> EmbeddedForagingFile {
    let json = include_str!("../../generated/world_foraging.json");
    serde_json::from_str(json).expect("world_foraging.json must be valid")
}

static GAME_RESPAWN_CANDIDATES: OnceLock<Vec<RespawnPoint>> = OnceLock::new();

pub fn game_respawn_candidates() -> &'static [RespawnPoint] {
    GAME_RESPAWN_CANDIDATES
        .get_or_init(|| {
            parse_embedded_foraging()
                .game_respawn_candidates
                .into_iter()
                .map(|point| RespawnPoint {
                    x: point.x,
                    z: point.z,
                })
                .collect()
        })
        .as_slice()
}

pub fn bootstrap_quarry_rows() -> Vec<WorldBootstrapQuarry> {
    parse_embedded_quarries()
        .into_iter()
        .map(|quarry| WorldBootstrapQuarry {
            quarry_id: quarry.quarry_id,
            x: quarry.x,
            z: quarry.z,
            max_yield: quarry.max_yield,
        })
        .collect()
}

pub fn bootstrap_foraging_rows() -> Vec<WorldBootstrapForagingNode> {
    parse_embedded_foraging()
        .foraging_nodes
        .into_iter()
        .map(|node| WorldBootstrapForagingNode {
            node_id: node.node_id,
            node_kind: node.node_kind,
            x: node.x,
            z: node.z,
            max_yield: node.max_yield,
            anchor_x: node.anchor_x,
            anchor_z: node.anchor_z,
        })
        .collect()
}

pub fn bootstrap_tree_rows() -> Vec<WorldBootstrapTree> {
    parse_embedded_trees()
        .into_iter()
        .map(|tree| WorldBootstrapTree {
            tree_id: tree.tree_id,
            layout_index: tree.layout_index,
            wood_yield: tree.wood_yield,
            x: tree.x,
            z: tree.z,
        })
        .collect()
}
