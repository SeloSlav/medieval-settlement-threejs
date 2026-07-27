//! Road network parsing and connectivity checks for building logistics.

use serde::Deserialize;
use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap, HashSet, VecDeque};

use crate::constants::BUILDING_ROAD_ACCESS_DISTANCE;

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
    edges: Vec<RoadEdgeRow>,
    weighted_graph: HashMap<String, Vec<(String, f64)>>,
    component_by_node: HashMap<String, u32>,
    edge_lookup: HashMap<String, HashMap<String, (usize, bool)>>,
    endpoint_half_width: HashMap<String, f64>,
    surface_edge_cells: HashMap<(i32, i32), Vec<usize>>,
    surface_node_cells: HashMap<(i32, i32), Vec<String>>,
    max_surface_half_width: f64,
}

const ROAD_SURFACE_CELL_SIZE: f64 = 24.0;
const ROAD_SURFACE_MARGIN: f64 = 0.15;

#[derive(Debug, Clone)]
pub struct RoadPathRoute {
    pub distance: f64,
    pub polyline: Vec<[f64; 2]>,
}

struct ShortestPathSolve {
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
        let mut weighted_graph: HashMap<String, Vec<(String, f64)>> = HashMap::new();
        let mut edge_lookup: HashMap<String, HashMap<String, (usize, bool)>> = HashMap::new();
        let mut endpoint_half_width: HashMap<String, f64> = HashMap::new();
        for (index, edge) in snapshot.edges.iter().enumerate() {
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
            let weight = polyline_length(&edge.sampled_path);
            weighted_graph
                .entry(edge.start_node_id.clone())
                .or_default()
                .push((edge.end_node_id.clone(), weight));
            weighted_graph
                .entry(edge.end_node_id.clone())
                .or_default()
                .push((edge.start_node_id.clone(), weight));
            edge_lookup
                .entry(edge.start_node_id.clone())
                .or_default()
                .entry(edge.end_node_id.clone())
                .or_insert((index, false));
            edge_lookup
                .entry(edge.end_node_id.clone())
                .or_default()
                .entry(edge.start_node_id.clone())
                .or_insert((index, true));
            let half_width = edge.width * 0.5;
            endpoint_half_width
                .entry(edge.start_node_id.clone())
                .and_modify(|width| *width = width.max(half_width))
                .or_insert(half_width);
            endpoint_half_width
                .entry(edge.end_node_id.clone())
                .and_modify(|width| *width = width.max(half_width))
                .or_insert(half_width);
        }
        let component_by_node = build_component_ids(&nodes, &adjacency);

        let (surface_edge_cells, surface_node_cells, max_surface_half_width) =
            build_surface_spatial_index(&nodes, &snapshot.edges, &endpoint_half_width);

        Some(Self {
            nodes,
            edges: snapshot.edges,
            weighted_graph,
            component_by_node,
            edge_lookup,
            endpoint_half_width,
            surface_edge_cells,
            surface_node_cells,
            max_surface_half_width,
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

    pub fn is_on_road_surface(&self, x: f64, z: f64) -> bool {
        let search_radius = self.max_surface_half_width + ROAD_SURFACE_MARGIN;
        let mut seen_edges = HashSet::new();
        for key in surface_cell_keys(x, z, search_radius) {
            let Some(indices) = self.surface_edge_cells.get(&key) else {
                continue;
            };
            for &index in indices {
                if !seen_edges.insert(index) {
                    continue;
                }
                let edge = &self.edges[index];
                let distance = distance_to_polyline(x, z, &edge.sampled_path);
                if distance <= edge.width * 0.5 + ROAD_SURFACE_MARGIN {
                    return true;
                }
            }
        }

        let mut seen_nodes = HashSet::new();
        for key in surface_cell_keys(x, z, search_radius) {
            let Some(node_ids) = self.surface_node_cells.get(&key) else {
                continue;
            };
            for node_id in node_ids {
                if !seen_nodes.insert(node_id) {
                    continue;
                }
                let Some(&(nx, nz)) = self.nodes.get(node_id) else {
                    continue;
                };
                let max_half_width = self
                    .endpoint_half_width
                    .get(node_id)
                    .copied()
                    .unwrap_or(0.0);
                if max_half_width > 0.0
                    && distance(x, z, nx, nz) <= max_half_width + ROAD_SURFACE_MARGIN
                {
                    return true;
                }
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
        let solve = self.shortest_path_solve(ax, az, bx, bz)?;
        Some(self.route_distance(ax, az, bx, bz, &solve.node_path))
    }

    /// Shortest travel distance from one origin to every target, including
    /// each building's off-road access legs.
    ///
    /// A household territory or next-cart decision often compares dozens of
    /// destinations from the same supplier. Solving that as one Dijkstra tree
    /// preserves the exact route metric while avoiding a full graph traversal
    /// for every candidate.
    pub fn road_path_distances_from(
        &self,
        ax: f64,
        az: f64,
        targets: &[(f64, f64)],
    ) -> Vec<Option<f64>> {
        if targets.is_empty() {
            return Vec::new();
        }
        let Some(distances) = self.shortest_node_distances_from(ax, az) else {
            return vec![None; targets.len()];
        };

        targets
            .iter()
            .map(|&(tx, tz)| {
                let target_nodes = self.snap_nodes(tx, tz)?;
                target_nodes
                    .iter()
                    .filter_map(|node_id| {
                        let road_cost = distances.get(node_id)?;
                        let &(nx, nz) = self.nodes.get(node_id)?;
                        Some(*road_cost + distance(tx, tz, nx, nz))
                    })
                    .filter(|total| total.is_finite())
                    .min_by(f64::total_cmp)
            })
            .collect()
    }

    /// Shortest road distance from one origin to any target, with one graph
    /// traversal regardless of target count. This is suited to periodic
    /// service/muster checks where only the nearest reachable site matters.
    pub fn nearest_road_path_distance(
        &self,
        ax: f64,
        az: f64,
        targets: &[(f64, f64)],
    ) -> Option<f64> {
        let start_nodes = self.snap_nodes(ax, az)?;
        if targets.is_empty() {
            return None;
        }

        let mut target_access_by_node: HashMap<String, f64> = HashMap::new();
        for &(tx, tz) in targets {
            let Some(target_nodes) = self.snap_nodes(tx, tz) else {
                continue;
            };
            for node_id in target_nodes {
                let Some(&(nx, nz)) = self.nodes.get(&node_id) else {
                    continue;
                };
                let access = distance(tx, tz, nx, nz);
                target_access_by_node
                    .entry(node_id)
                    .and_modify(|current| *current = current.min(access))
                    .or_insert(access);
            }
        }
        if target_access_by_node.is_empty() {
            return None;
        }

        let mut distances: HashMap<String, f64> = HashMap::new();
        let mut heap: BinaryHeap<Reverse<(u64, String)>> = BinaryHeap::new();
        for node_id in start_nodes {
            let Some(&(nx, nz)) = self.nodes.get(&node_id) else {
                continue;
            };
            let cost = distance(ax, az, nx, nz);
            let entry = distances.entry(node_id.clone()).or_insert(f64::INFINITY);
            if cost + 1e-6 < *entry {
                *entry = cost;
                heap.push(Reverse((cost_to_key(cost), node_id)));
            }
        }

        let mut nearest = f64::INFINITY;
        while let Some(Reverse((heap_key, node_id))) = heap.pop() {
            let Some(&best) = distances.get(&node_id) else {
                continue;
            };
            if heap_key > cost_to_key(best) {
                continue;
            }
            if best >= nearest {
                break;
            }
            if let Some(access) = target_access_by_node.get(&node_id) {
                nearest = nearest.min(best + access);
            }
            for (neighbor, weight) in self.weighted_graph.get(&node_id).into_iter().flatten() {
                let next = best + weight;
                if next >= nearest {
                    continue;
                }
                let entry = distances.entry(neighbor.clone()).or_insert(f64::INFINITY);
                if next + 1e-6 < *entry {
                    *entry = next;
                    heap.push(Reverse((cost_to_key(next), neighbor.clone())));
                }
            }
        }

        nearest.is_finite().then_some(nearest)
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

    fn shortest_node_distances_from(&self, ax: f64, az: f64) -> Option<HashMap<String, f64>> {
        let start_nodes = self.snap_nodes(ax, az)?;
        let mut distances: HashMap<String, f64> = HashMap::new();
        let mut heap: BinaryHeap<Reverse<(u64, String)>> = BinaryHeap::new();

        for node_id in start_nodes {
            let Some(&(nx, nz)) = self.nodes.get(&node_id) else {
                continue;
            };
            let cost = distance(ax, az, nx, nz);
            let entry = distances.entry(node_id.clone()).or_insert(f64::INFINITY);
            if cost + 1e-6 < *entry {
                *entry = cost;
                heap.push(Reverse((cost_to_key(cost), node_id)));
            }
        }
        if heap.is_empty() {
            return None;
        }

        while let Some(Reverse((heap_key, node_id))) = heap.pop() {
            let Some(&best) = distances.get(&node_id) else {
                continue;
            };
            if heap_key > cost_to_key(best) {
                continue;
            }
            for (neighbor, weight) in self.weighted_graph.get(&node_id).into_iter().flatten() {
                let next = best + weight;
                let entry = distances.entry(neighbor.clone()).or_insert(f64::INFINITY);
                if next + 1e-6 < *entry {
                    *entry = next;
                    heap.push(Reverse((cost_to_key(next), neighbor.clone())));
                }
            }
        }

        Some(distances)
    }

    fn shortest_path_solve(&self, ax: f64, az: f64, bx: f64, bz: f64) -> Option<ShortestPathSolve> {
        let nodes_a = self.snap_nodes(ax, az)?;
        let nodes_b = self.snap_nodes(bx, bz)?;
        if !self.share_component(&nodes_a, &nodes_b) {
            return None;
        }

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
            // Heap keys are millimetre-quantized because `f64` has no total
            // ordering. Compare in that same domain: converting the rounded
            // key back to metres can make a newly inserted entry appear stale
            // whenever its distance rounds upward.
            if heap_key > cost_to_key(best) {
                continue;
            }
            let cost = best;
            for (neighbor, weight) in self.weighted_graph.get(&node_id).into_iter().flatten() {
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

        Some(ShortestPathSolve { node_path })
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
        if let Some(first_node_id) = node_path.first() {
            if let Some(&(x, z)) = self.nodes.get(first_node_id) {
                append_point(&mut path, x, z);
            }
        }
        for window in node_path.windows(2) {
            if let Some(segment) = self.edge_polyline_between(&window[0], &window[1]) {
                append_polyline(&mut path, &segment);
            }
        }
        append_point(&mut path, bx, bz);
        path
    }

    fn edge_polyline_between(&self, from: &str, to: &str) -> Option<Vec<[f64; 2]>> {
        if let Some((edge, reverse)) = self.edge_between(from, to) {
            let points: Vec<[f64; 2]> = if reverse {
                edge.sampled_path
                    .iter()
                    .rev()
                    .map(|point| [point[0], point[2]])
                    .collect()
            } else {
                edge.sampled_path
                    .iter()
                    .map(|point| [point[0], point[2]])
                    .collect()
            };
            return Some(points);
        }

        let (ax, az) = *self.nodes.get(from)?;
        let (bx, bz) = *self.nodes.get(to)?;
        Some(vec![[ax, az], [bx, bz]])
    }

    fn route_distance(&self, ax: f64, az: f64, bx: f64, bz: f64, node_path: &[String]) -> f64 {
        let mut previous = (ax, az);
        let mut total = 0.0;
        if let Some(first_node_id) = node_path.first() {
            if let Some(&(x, z)) = self.nodes.get(first_node_id) {
                total += distance(previous.0, previous.1, x, z);
                previous = (x, z);
            }
        }
        for window in node_path.windows(2) {
            if let Some((edge, reverse)) = self.edge_between(&window[0], &window[1]) {
                if reverse {
                    for point in edge.sampled_path.iter().rev() {
                        let next = (point[0], point[2]);
                        total += distance(previous.0, previous.1, next.0, next.1);
                        previous = next;
                    }
                } else {
                    for point in &edge.sampled_path {
                        let next = (point[0], point[2]);
                        total += distance(previous.0, previous.1, next.0, next.1);
                        previous = next;
                    }
                }
            } else if let Some(&(x, z)) = self.nodes.get(&window[1]) {
                total += distance(previous.0, previous.1, x, z);
                previous = (x, z);
            }
        }
        total + distance(previous.0, previous.1, bx, bz)
    }

    fn edge_between(&self, from: &str, to: &str) -> Option<(&RoadEdgeRow, bool)> {
        let &(index, reverse) = self
            .edge_lookup
            .get(from)
            .and_then(|neighbors| neighbors.get(to))?;
        Some((self.edges.get(index)?, reverse))
    }

    /// Polyline length in meters (XZ plane).
    pub fn polyline_length_xz(path: &[[f64; 2]]) -> f64 {
        if path.len() < 2 {
            return 0.0;
        }
        let mut total = 0.0;
        for window in path.windows(2) {
            total += distance(window[0][0], window[0][1], window[1][0], window[1][1]);
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
            let seg_len = distance(window[0][0], window[0][1], window[1][0], window[1][1]);
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
        let keys = surface_cell_keys(x, z, max_snap);
        let mut seen_nodes: HashSet<String> = HashSet::new();

        for key in &keys {
            let Some(node_ids) = self.surface_node_cells.get(key) else {
                continue;
            };
            for id in node_ids {
                if !seen_nodes.insert(id.clone()) {
                    continue;
                }
                let Some(&(nx, nz)) = self.nodes.get(id) else {
                    continue;
                };
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
        }

        let mut seen_edges: HashSet<usize> = HashSet::new();
        for key in &keys {
            let Some(edge_indices) = self.surface_edge_cells.get(key) else {
                continue;
            };
            for &index in edge_indices {
                if !seen_edges.insert(index) {
                    continue;
                }
                let Some(edge) = self.edges.get(index) else {
                    continue;
                };
                let dist = distance_to_polyline(x, z, &edge.sampled_path);
                if dist <= best_distance + 1e-6 && dist < best_distance - 1e-6 {
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
        start_nodes.iter().any(|start| {
            let Some(component) = self.component_by_node.get(start) else {
                return false;
            };
            target_nodes
                .iter()
                .any(|target| self.component_by_node.get(target) == Some(component))
        })
    }
}

fn build_surface_spatial_index(
    nodes: &HashMap<String, (f64, f64)>,
    edges: &[RoadEdgeRow],
    endpoint_half_width: &HashMap<String, f64>,
) -> (
    HashMap<(i32, i32), Vec<usize>>,
    HashMap<(i32, i32), Vec<String>>,
    f64,
) {
    let mut edge_cells: HashMap<(i32, i32), Vec<usize>> = HashMap::new();
    let mut node_cells: HashMap<(i32, i32), Vec<String>> = HashMap::new();
    let mut max_half_width: f64 = 0.0;

    for (index, edge) in edges.iter().enumerate() {
        max_half_width = max_half_width.max(edge.width * 0.5);
        let Some((min_x, max_x, min_z, max_z)) = polyline_bounds(&edge.sampled_path) else {
            continue;
        };
        for key in surface_cell_keys_for_bounds(min_x, max_x, min_z, max_z) {
            edge_cells.entry(key).or_default().push(index);
        }
    }

    for (node_id, &(x, z)) in nodes {
        max_half_width =
            max_half_width.max(endpoint_half_width.get(node_id).copied().unwrap_or(0.0));
        node_cells
            .entry(surface_cell(x, z))
            .or_default()
            .push(node_id.clone());
    }

    (edge_cells, node_cells, max_half_width)
}

fn polyline_bounds(path: &[[f64; 3]]) -> Option<(f64, f64, f64, f64)> {
    let first = path.first()?;
    let mut min_x = first[0];
    let mut max_x = first[0];
    let mut min_z = first[2];
    let mut max_z = first[2];
    for point in &path[1..] {
        min_x = min_x.min(point[0]);
        max_x = max_x.max(point[0]);
        min_z = min_z.min(point[2]);
        max_z = max_z.max(point[2]);
    }
    Some((min_x, max_x, min_z, max_z))
}

fn surface_cell_keys(x: f64, z: f64, radius: f64) -> Vec<(i32, i32)> {
    surface_cell_keys_for_bounds(x - radius, x + radius, z - radius, z + radius)
}

fn surface_cell_keys_for_bounds(min_x: f64, max_x: f64, min_z: f64, max_z: f64) -> Vec<(i32, i32)> {
    let min_cell_x = (min_x / ROAD_SURFACE_CELL_SIZE).floor() as i32;
    let max_cell_x = (max_x / ROAD_SURFACE_CELL_SIZE).floor() as i32;
    let min_cell_z = (min_z / ROAD_SURFACE_CELL_SIZE).floor() as i32;
    let max_cell_z = (max_z / ROAD_SURFACE_CELL_SIZE).floor() as i32;
    let mut keys = Vec::new();
    for cell_x in min_cell_x..=max_cell_x {
        for cell_z in min_cell_z..=max_cell_z {
            keys.push((cell_x, cell_z));
        }
    }
    keys
}

fn surface_cell(x: f64, z: f64) -> (i32, i32) {
    (
        (x / ROAD_SURFACE_CELL_SIZE).floor() as i32,
        (z / ROAD_SURFACE_CELL_SIZE).floor() as i32,
    )
}

fn build_component_ids(
    nodes: &HashMap<String, (f64, f64)>,
    adjacency: &HashMap<String, Vec<String>>,
) -> HashMap<String, u32> {
    let mut component_by_node = HashMap::new();
    let mut next_component = 0_u32;
    for node in nodes.keys().chain(adjacency.keys()) {
        if component_by_node.contains_key(node) {
            continue;
        }
        let mut queue = VecDeque::from([node.clone()]);
        while let Some(current) = queue.pop_front() {
            if component_by_node
                .insert(current.clone(), next_component)
                .is_some()
            {
                continue;
            }
            if let Some(neighbors) = adjacency.get(&current) {
                for neighbor in neighbors {
                    if !component_by_node.contains_key(neighbor) {
                        queue.push_back(neighbor.clone());
                    }
                }
            }
        }
        next_component = next_component.saturating_add(1);
    }
    component_by_node
}

fn cost_to_key(cost: f64) -> u64 {
    if !cost.is_finite() {
        u64::MAX
    } else {
        (cost * 1000.0).round().clamp(0.0, u64::MAX as f64 - 1.0) as u64
    }
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

fn distance_to_segment(px: f64, pz: f64, ax: f64, az: f64, bx: f64, bz: f64) -> f64 {
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
        total += distance(window[0][0], window[0][2], window[1][0], window[1][2]);
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

#[cfg(test)]
mod tests {
    use super::RoadNetwork;
    use std::time::Instant;

    #[test]
    fn precomputed_graph_preserves_routes_and_components() {
        let network = RoadNetwork::from_snapshot_json(
            r#"{
                "nodes": [
                    {"id":"a","position":[0.0,0.0,0.0]},
                    {"id":"b","position":[10.0,0.0,0.0]},
                    {"id":"c","position":[20.0,0.0,0.0]},
                    {"id":"d","position":[100.0,0.0,0.0]},
                    {"id":"e","position":[110.0,0.0,0.0]}
                ],
                "edges": [
                    {
                        "startNodeId":"a",
                        "endNodeId":"b",
                        "width":4.0,
                        "sampledPath":[[0.0,0.0,0.0],[10.0,0.0,0.0]]
                    },
                    {
                        "startNodeId":"b",
                        "endNodeId":"c",
                        "width":4.0,
                        "sampledPath":[[10.0,0.0,0.0],[20.0,0.0,0.0]]
                    },
                    {
                        "startNodeId":"d",
                        "endNodeId":"e",
                        "width":6.0,
                        "sampledPath":[[100.0,0.0,0.0],[110.0,0.0,0.0]]
                    }
                ]
            }"#,
        )
        .expect("road network should parse");

        assert_eq!(network.weighted_graph.get("b").map(Vec::len), Some(2));
        assert_eq!(
            network.component_by_node.get("a"),
            network.component_by_node.get("c")
        );
        assert_ne!(
            network.component_by_node.get("a"),
            network.component_by_node.get("d")
        );
        assert!(network.road_connected(0.0, 0.0, 20.0, 0.0));
        assert!(!network.road_connected(0.0, 0.0, 100.0, 0.0));
        assert!((network.road_path_distance(0.0, 0.0, 20.0, 0.0).unwrap() - 20.0).abs() < 1e-9);
        let batched =
            network.road_path_distances_from(0.0, 0.0, &[(20.0, 0.0), (100.0, 0.0), (12.0, 2.0)]);
        assert_eq!(batched.len(), 3);
        assert!((batched[0].unwrap() - 20.0).abs() < 1e-9);
        assert_eq!(batched[1], None);
        assert_eq!(batched[2], network.road_path_distance(0.0, 0.0, 12.0, 2.0));
        assert!(
            (network
                .nearest_road_path_distance(0.0, 0.0, &[(100.0, 0.0), (20.0, 0.0)])
                .unwrap()
                - 20.0)
                .abs()
                < 1e-9
        );
        assert!(network.is_on_road_surface(100.0, 2.9));

        let short_route = network
            .road_path_route(1.0, 3.0, 2.0, 3.0)
            .expect("nearby endpoints should still attach to the road");
        assert!(
            short_route
                .polyline
                .iter()
                .any(|point| point[1].abs() < 1e-9),
            "a same-node route must include its road attachment instead of cutting directly"
        );
    }

    #[test]
    fn route_search_keeps_fresh_entries_whose_access_cost_rounds_up() {
        let network = RoadNetwork::from_snapshot_json(
            r#"{
                "nodes": [
                    {"id":"a","position":[0.0,0.0,0.0]},
                    {"id":"b","position":[10.0,0.0,0.0]}
                ],
                "edges": [{
                    "startNodeId":"a",
                    "endNodeId":"b",
                    "width":4.2,
                    "sampledPath":[[0.0,0.0,0.0],[10.0,0.0,0.0]]
                }]
            }"#,
        )
        .expect("valid road snapshot");

        // sqrt(2.0006^2 + 1^2) rounds upward at millimetre precision. The
        // former stale-entry check rejected this initial queue entry.
        let route = network.road_path_route(-2.0006, 1.0, 12.0, 1.0);
        assert!(route.is_some(), "connected off-road access legs must route");
    }

    #[test]
    fn batched_household_routes_match_pairwise_solves_and_avoid_repeated_dijkstra() {
        const NODE_COUNT: usize = 400;
        let nodes: Vec<_> = (0..NODE_COUNT)
            .map(|index| {
                serde_json::json!({
                    "id": format!("n{index}"),
                    "position": [index as f64 * 8.0, 0.0, 0.0],
                })
            })
            .collect();
        let edges: Vec<_> = (0..NODE_COUNT - 1)
            .map(|index| {
                let start = index as f64 * 8.0;
                let end = (index + 1) as f64 * 8.0;
                serde_json::json!({
                    "startNodeId": format!("n{index}"),
                    "endNodeId": format!("n{}", index + 1),
                    "width": 4.2,
                    "sampledPath": [[start, 0.0, 0.0], [end, 0.0, 0.0]],
                })
            })
            .collect();
        let snapshot = serde_json::json!({ "nodes": nodes, "edges": edges }).to_string();
        let network = RoadNetwork::from_snapshot_json(&snapshot).expect("generated road network");
        let targets: Vec<(f64, f64)> = (1..NODE_COUNT)
            .map(|index| (index as f64 * 8.0 + 1.0, 2.0))
            .collect();

        let pairwise_started = Instant::now();
        let pairwise: Vec<_> = targets
            .iter()
            .map(|&(x, z)| network.road_path_distance(0.0, 0.0, x, z))
            .collect();
        let pairwise_elapsed = pairwise_started.elapsed();

        let batched_started = Instant::now();
        let batched = network.road_path_distances_from(0.0, 0.0, &targets);
        let batched_elapsed = batched_started.elapsed();

        assert_eq!(batched.len(), pairwise.len());
        for (batch_distance, pair_distance) in batched.iter().zip(&pairwise) {
            let batch_distance = batch_distance.expect("every target shares the road branch");
            let pair_distance = pair_distance.expect("every target shares the road branch");
            assert!((batch_distance - pair_distance).abs() < 1e-9);
        }
        assert!(
            batched_elapsed.as_nanos().saturating_mul(8) < pairwise_elapsed.as_nanos(),
            "one-to-many routing should be materially cheaper than {} full graph solves: \
             batch {batched_elapsed:?}, pairwise {pairwise_elapsed:?}",
            targets.len()
        );
        println!(
            "{} household routes: batched {batched_elapsed:?}, pairwise {pairwise_elapsed:?}",
            targets.len()
        );
    }
}
