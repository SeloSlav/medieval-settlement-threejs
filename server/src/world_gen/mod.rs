mod math;
mod quarry;
mod river;

use serde::Deserialize;

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

pub fn bootstrap_quarry_rows(_seed: u64) -> Vec<WorldBootstrapQuarry> {
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
