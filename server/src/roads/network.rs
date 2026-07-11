//! Road network parsing and connectivity checks for building logistics.

use serde::Deserialize;
use spacetimedb::Identity;
use spacetimedb::ReducerContext;
use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap, HashSet, VecDeque};

use crate::constants::BUILDING_ROAD_ACCESS_DISTANCE;
use crate::db::*;

#[derive(Debug, Clone, Deserialize)]
struct RoadNodeRow {
    id: String,
    position: [f64; 3],
}

#[derive(Debug, Clone, Deserialize)]
struct RoadEdgeRow {
    #[serde(rename = "startNodeId")]
    start_node_id: String,
    #[serde(rename = "endNodeId")]
    end_node_id: String,
    #[serde(default = "default_road_width")]
    width: f64,
    #[serde(rename = "sampledPath", default)]
    sampled_path: Vec<[f64; 3]>,
}

fn default_road_width() -> f64 {
    4.2
}

#[derive(Debug, Deserialize)]
struct RoadSnapshot {
    nodes: Vec<RoadNodeRow>,
    edges: Vec<RoadEdgeRow>,
}

#[derive(Debug, Clone)]
pub struct RoadNetwork {
    nodes: HashMap<String, (f64, f64)>,
    adjacency: HashMap<String, Vec<String>>,
    edges: Vec<RoadEdgeRow>,
}

#[derive(Debug, Clone)]
pub struct RoadPathRoute {
    pub distance: f64,
    pub polyline: Vec<[f64; 2]>,
}

struct ShortestPathSolve {
    distance: f64,
    node_path: Vec<String>,
}

impl RoadNetwork {
    pub fn from_snapshot_json(json: &str) -> Option<Self> {
        let snapshot: RoadSnapshot = serde_json::from_str(json).ok()?;
        if snapshot.nodes.is_empty() && snapshot.edges.is_empty() {
            return None;
        }

        let mut nodes = HashMap::new();
        for node in snapshot.nodes {
            nodes.insert(node.id, (node.position[0], node.position[2]));
        }

        let mut adjacency: HashMap<String, Vec<String>> = HashMap::new();
        for edge in &snapshot.edges {
            if edge.start_node_id.is_empty() || edge.end_node_id.is_empty() {
                continue;
            }
            adjacency
                .entry(edge.start_node_id.clone())
                .or_default()
                .push(edge.end_node_id.clone());
            adjacency
                .entry(edge.end_node_id.clone())
                .or_default()
                .push(edge.start_node_id.clone());
        }

        Some(Self {
            nodes,
            adjacency,
            edges: snapshot.edges,
        })
    }

    pub fn nearest_distance(&self, x: f64, z: f64) -> f64 {
        let mut best = f64::INFINITY;
        for &(nx, nz) in self.nodes.values() {
            best = best.min(distance(x, z, nx, nz));
        }
        for edge in &self.edges {
            best = best.min(distance_to_polyline(x, z, &edge.sampled_path));
        }
        best
    }

    pub fn has_road_access(&self, x: f64, z: f64) -> bool {
        self.nearest_distance(x, z) <= BUILDING_ROAD_ACCESS_DISTANCE
    }

    pub fn is_on_road_surface(&self, x: f64, z: f64) -> bool {
        const ROAD_SURFACE_MARGIN: f64 = 0.15;

        for edge in &self.edges {
            let distance = distance_to_polyline(x, z, &edge.sampled_path);
            if distance <= edge.width * 0.5 + ROAD_SURFACE_MARGIN {
                return true;
            }
        }

        for (node_id, &(nx, nz)) in &self.nodes {
            let mut max_half_width = 0.0_f64;
            for edge in &self.edges {
                if edge.start_node_id == *node_id || edge.end_node_id == *node_id {
                    max_half_width = max_half_width.max(edge.width * 0.5);
                }
            }
            if max_half_width > 0.0 && distance(x, z, nx, nz) <= max_half_width + ROAD_SURFACE_MARGIN {
                return true;
            }
        }

        false
    }

    pub fn road_connected(&self, ax: f64, az: f64, bx: f64, bz: f64) -> bool {
        let Some(nodes_a) = self.snap_nodes(ax, az) else {
            return false;
        };
        let Some(nodes_b) = self.snap_nodes(bx, bz) else {
            return false;
        };
        self.share_component(&nodes_a, &nodes_b)
    }

    /// Shortest travel distance along the road graph, including off-road access legs.
    pub fn road_path_distance(&self, ax: f64, az: f64, bx: f64, bz: f64) -> Option<f64> {
        self.road_path_route(ax, az, bx, bz).map(|route| route.distance)
    }

    /// Full one-way polyline from origin to destination along the road graph.
    pub fn road_path_polyline(&self, ax: f64, az: f64, bx: f64, bz: f64) -> Option<Vec<[f64; 2]>> {
        self.road_path_route(ax, az, bx, bz)
            .map(|route| route.polyline)
    }

    /// Canonical shortest route — distance matches sampled polyline length for movement.
    pub fn road_path_route(&self, ax: f64, az: f64, bx: f64, bz: f64) -> Option<RoadPathRoute> {
        let solve = self.shortest_path_solve(ax, az, bx, bz)?;
        let polyline = self.materialize_polyline(ax, az, bx, bz, &solve.node_path);
        Some(RoadPathRoute {
            distance: Self::polyline_length_xz(&polyline),
            polyline,
        })
    }

    fn shortest_path_solve(
        &self,
        ax: f64,
        az: f64,
        bx: f64,
        bz: f64,
    ) -> Option<ShortestPathSolve> {
        let nodes_a = self.snap_nodes(ax, az)?;
        let nodes_b = self.snap_nodes(bx, bz)?;
        if !self.share_component(&nodes_a, &nodes_b) {
            return None;
        }

        let graph = self.build_weighted_graph();
        let mut dist: HashMap<String, f64> = HashMap::new();
        let mut prev: HashMap<String, Option<String>> = HashMap::new();
        let mut heap: BinaryHeap<Reverse<(u64, String)>> = BinaryHeap::new();

        for node_id in &nodes_a {
            let Some(&(nx, nz)) = self.nodes.get(node_id) else {
                continue;
            };
            let cost = distance(ax, az, nx, nz);
            dist.insert(node_id.clone(), cost);
            prev.insert(node_id.clone(), None);
            heap.push(Reverse((cost_to_key(cost), node_id.clone())));
        }

        while let Some(Reverse((heap_key, node_id))) = heap.pop() {
            let Some(&best) = dist.get(&node_id) else {
                continue;
            };
            if (heap_key as f64 / 1000.0) > best + 1e-6 {
                continue;
            }
            let cost = best;
            for (neighbor, weight) in graph.get(&node_id).into_iter().flatten() {
                let next = cost + weight;
                let entry = dist.entry(neighbor.clone()).or_insert(f64::INFINITY);
                if next + 1e-6 < *entry {
                    *entry = next;
                    prev.insert(neighbor.clone(), Some(node_id.clone()));
                    heap.push(Reverse((cost_to_key(next), neighbor.clone())));
                }
            }
        }

        let mut best_end: Option<String> = None;
        let mut best_total = f64::INFINITY;
        for node_id in &nodes_b {
            let Some(&road_cost) = dist.get(node_id) else {
                continue;
            };
            let Some(&(nx, nz)) = self.nodes.get(node_id) else {
                continue;
            };
            let total = road_cost + distance(bx, bz, nx, nz);
            if total + 1e-6 < best_total {
                best_total = total;
                best_end = Some(node_id.clone());
            }
        }

        let end_node = best_end?;
        let mut node_path: Vec<String> = Vec::new();
        let mut cursor = Some(end_node);
        while let Some(node_id) = cursor {
            node_path.push(node_id.clone());
            cursor = prev.get(&node_id).cloned().flatten();
        }
        node_path.reverse();

        if !best_total.is_finite() {
            return None;
        }

        Some(ShortestPathSolve {
            distance: best_total,
            node_path,
        })
    }

    fn build_weighted_graph(&self) -> HashMap<String, Vec<(String, f64)>> {
        let mut graph: HashMap<String, Vec<(String, f64)>> = HashMap::new();
        for edge in &self.edges {
            if edge.start_node_id.is_empty() || edge.end_node_id.is_empty() {
                continue;
            }
            let weight = polyline_length(&edge.sampled_path);
            graph
                .entry(edge.start_node_id.clone())
                .or_default()
                .push((edge.end_node_id.clone(), weight));
            graph
                .entry(edge.end_node_id.clone())
                .or_default()
                .push((edge.start_node_id.clone(), weight));
        }
        graph
    }

    fn materialize_polyline(
        &self,
        ax: f64,
        az: f64,
        bx: f64,
        bz: f64,
        node_path: &[String],
    ) -> Vec<[f64; 2]> {
        let mut path: Vec<[f64; 2]> = vec![[ax, az]];
        for window in node_path.windows(2) {
            if let Some(segment) = self.edge_polyline_between(&window[0], &window[1]) {
                append_polyline(&mut path, &segment);
            }
        }
        append_point(&mut path, bx, bz);
        path
    }

    fn edge_polyline_between(&self, from: &str, to: &str) -> Option<Vec<[f64; 2]>> {
        for edge in &self.edges {
            if edge.start_node_id == from && edge.end_node_id == to {
                return Some(
                    edge.sampled_path
                        .iter()
                        .map(|point| [point[0], point[2]])
                        .collect(),
                );
            }
            if edge.end_node_id == from && edge.start_node_id == to {
                return Some(
                    edge.sampled_path
                        .iter()
                        .rev()
                        .map(|point| [point[0], point[2]])
                        .collect(),
                );
            }
        }

        let (ax, az) = *self.nodes.get(from)?;
        let (bx, bz) = *self.nodes.get(to)?;
        Some(vec![[ax, az], [bx, bz]])
    }

    /// Polyline length in meters (XZ plane).
    pub fn polyline_length_xz(path: &[[f64; 2]]) -> f64 {
        if path.len() < 2 {
            return 0.0;
        }
        let mut total = 0.0;
        for window in path.windows(2) {
            total += distance(
                window[0][0],
                window[0][1],
                window[1][0],
                window[1][1],
            );
        }
        total
    }

    /// Sample a position `meters` from the start of a polyline.
    pub fn sample_polyline_xz(path: &[[f64; 2]], meters: f64) -> (f64, f64) {
        if path.is_empty() {
            return (0.0, 0.0);
        }
        if path.len() == 1 || meters <= 0.0 {
            return (path[0][0], path[0][1]);
        }

        let mut remaining = meters;
        for window in path.windows(2) {
            let seg_len = distance(
                window[0][0],
                window[0][1],
                window[1][0],
                window[1][1],
            );
            if remaining <= seg_len + 1e-9 {
                let t = if seg_len <= 1e-9 {
                    0.0
                } else {
                    remaining / seg_len
                };
                let x = window[0][0] + (window[1][0] - window[0][0]) * t;
                let z = window[0][1] + (window[1][1] - window[0][1]) * t;
                return (x, z);
            }
            remaining -= seg_len;
        }

        let last = path[path.len() - 1];
        (last[0], last[1])
    }

    /// Sample a position `meters` from the end of a polyline (inbound leg).
    pub fn sample_polyline_inbound_xz(path: &[[f64; 2]], meters: f64) -> (f64, f64) {
        let total = Self::polyline_length_xz(path);
        let clamped = meters.clamp(0.0, total);
        Self::sample_polyline_xz(path, total - clamped)
    }

    fn snap_nodes(&self, x: f64, z: f64) -> Option<Vec<String>> {
        let max_snap = BUILDING_ROAD_ACCESS_DISTANCE;
        let mut best_distance = max_snap;
        let mut best_nodes: Vec<String> = Vec::new();

        for (id, &(nx, nz)) in &self.nodes {
            let dist = distance(x, z, nx, nz);
            if dist <= best_distance + 1e-6 {
                if dist < best_distance - 1e-6 {
                    best_distance = dist;
                    best_nodes.clear();
                    best_nodes.push(id.clone());
                } else if (dist - best_distance).abs() <= 1e-6 {
                    best_nodes.push(id.clone());
                }
            }
        }

        for edge in &self.edges {
            let dist = distance_to_polyline(x, z, &edge.sampled_path);
            if dist <= best_distance + 1e-6 {
                if dist < best_distance - 1e-6 {
                    best_distance = dist;
                    best_nodes = vec![edge.start_node_id.clone(), edge.end_node_id.clone()];
                }
            }
        }

        if best_nodes.is_empty() {
            None
        } else {
            best_nodes.sort();
            best_nodes.dedup();
            Some(best_nodes)
        }
    }

    fn share_component(&self, start_nodes: &[String], target_nodes: &[String]) -> bool {
        let target_set: HashSet<&str> = target_nodes.iter().map(String::as_str).collect();
        let mut visited = HashSet::new();
        let mut queue = VecDeque::new();

        for node in start_nodes {
            queue.push_back(node.clone());
        }

        while let Some(node) = queue.pop_front() {
            if !visited.insert(node.clone()) {
                continue;
            }
            if target_set.contains(node.as_str()) {
                return true;
            }
            if let Some(neighbors) = self.adjacency.get(&node) {
                for neighbor in neighbors {
                    if !visited.contains(neighbor) {
                        queue.push_back(neighbor.clone());
                    }
                }
            }
        }

        false
    }
}

fn cost_to_key(cost: f64) -> u64 {
    if !cost.is_finite() {
        u64::MAX
    } else {
        (cost * 1000.0).round().clamp(0.0, u64::MAX as f64 - 1.0) as u64
    }
}

pub fn load_owner_road_network(ctx: &ReducerContext, owner: Identity) -> Option<RoadNetwork> {
    let state = ctx.db.road_network_state().owner().find(&owner)?;
    RoadNetwork::from_snapshot_json(&state.snapshot_json)
}

pub fn has_building_road_access(ctx: &ReducerContext, owner: Identity, x: f64, z: f64) -> bool {
    load_owner_road_network(ctx, owner)
        .map(|network| network.has_road_access(x, z))
        .unwrap_or(false)
}

fn distance(ax: f64, az: f64, bx: f64, bz: f64) -> f64 {
    ((ax - bx).powi(2) + (az - bz).powi(2)).sqrt()
}

fn distance_to_polyline(x: f64, z: f64, path: &[[f64; 3]]) -> f64 {
    if path.len() < 2 {
        return f64::INFINITY;
    }
    let mut best = f64::INFINITY;
    for window in path.windows(2) {
        best = best.min(distance_to_segment(
            x,
            z,
            window[0][0],
            window[0][2],
            window[1][0],
            window[1][2],
        ));
    }
    best
}

fn distance_to_segment(
    px: f64,
    pz: f64,
    ax: f64,
    az: f64,
    bx: f64,
    bz: f64,
) -> f64 {
    let abx = bx - ax;
    let abz = bz - az;
    let length_sq = abx * abx + abz * abz;
    let t = if length_sq <= 1e-9 {
        0.0
    } else {
        (((px - ax) * abx + (pz - az) * abz) / length_sq).clamp(0.0, 1.0)
    };
    let cx = ax + abx * t;
    let cz = az + abz * t;
    distance(px, pz, cx, cz)
}

fn polyline_length(path: &[[f64; 3]]) -> f64 {
    if path.len() < 2 {
        return 0.0;
    }
    let mut total = 0.0;
    for window in path.windows(2) {
        total += distance(
            window[0][0],
            window[0][2],
            window[1][0],
            window[1][2],
        );
    }
    total
}

fn append_point(path: &mut Vec<[f64; 2]>, x: f64, z: f64) {
    if let Some(last) = path.last() {
        if (last[0] - x).abs() <= 1e-6 && (last[1] - z).abs() <= 1e-6 {
            return;
        }
    }
    path.push([x, z]);
}

fn append_polyline(path: &mut Vec<[f64; 2]>, segment: &[[f64; 2]]) {
    for point in segment {
        append_point(path, point[0], point[1]);
    }
}
