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
    #[serde(rename = "riverNavigation", default)]
    river_navigation: Option<RiverNavigationRow>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RiverNavigationRow {
    resolution: usize,
    start_x: f64,
    start_z: f64,
    span_x: f64,
    span_z: f64,
    wet_cells_hex: String,
    #[serde(default)]
    heights: Vec<f32>,
}

#[derive(Debug, Clone)]
struct RiverNavigationGrid {
    resolution: usize,
    start_x: f64,
    start_z: f64,
    span_x: f64,
    span_z: f64,
    wet_cells: Vec<u8>,
    heights: Vec<f32>,
}

#[derive(Debug, Clone)]
pub struct RoadNetwork {
    nodes: HashMap<String, (f64, f64)>,
    edges: Vec<RoadEdgeRow>,
    /// Stable pairs of edge endpoints used by autonomous road patrols. Each
    /// edge contributes its start followed by its end, so walking consecutive
    /// stops deliberately covers the edge instead of merely visiting a random
    /// nearby building.
    patrol_stops: Vec<(f64, f64)>,
    weighted_graph: HashMap<String, Vec<(String, f64)>>,
    component_by_node: HashMap<String, u32>,
    edge_lookup: HashMap<String, HashMap<String, (usize, bool)>>,
    endpoint_half_width: HashMap<String, f64>,
    surface_edge_cells: HashMap<(i32, i32), Vec<usize>>,
    surface_node_cells: HashMap<(i32, i32), Vec<String>>,
    max_surface_half_width: f64,
    river_navigation: Option<RiverNavigationGrid>,
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

#[derive(Debug, Clone, Copy)]
struct EdgeProjection {
    point: [f64; 2],
    segment_index: usize,
    distance_from_start: f64,
    access_distance: f64,
}

impl RoadNetwork {
    /// Bilinear sampling of the same terrain grid published with river navigation.
    pub fn combat_elevation(&self, x: f64, z: f64) -> f64 {
        let Some(grid) = &self.river_navigation else { return 0.0; };
        let n = grid.resolution;
        if grid.heights.len() != n * n || !x.is_finite() || !z.is_finite() { return 0.0; }
        let gx = ((x-grid.start_x) / grid.span_x * (n-1) as f64).clamp(0.0, (n-1) as f64);
        let gz = ((z-grid.start_z) / grid.span_z * (n-1) as f64).clamp(0.0, (n-1) as f64);
        let ix = (gx.floor() as usize).min(n-2);
        let iz = (gz.floor() as usize).min(n-2);
        let (tx, tz) = (gx-ix as f64, gz-iz as f64);
        let h = |x: usize, z: usize| grid.heights[z*n+x] as f64;
        (h(ix,iz)*(1.0-tx) + h(ix+1,iz)*tx)*(1.0-tz)
            + (h(ix,iz+1)*(1.0-tx) + h(ix+1,iz+1)*tx)*tz
    }
    pub fn from_snapshot_json(json: &str) -> Option<Self> {
        let snapshot: RoadSnapshot = serde_json::from_str(json).ok()?;
        let river_navigation = snapshot
            .river_navigation
            .and_then(RiverNavigationGrid::from_row);
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

        let mut patrol_edge_indices = snapshot
            .edges
            .iter()
            .enumerate()
            .filter(|(_, edge)| {
                nodes.contains_key(&edge.start_node_id) && nodes.contains_key(&edge.end_node_id)
            })
            .map(|(index, _)| index)
            .collect::<Vec<_>>();
        patrol_edge_indices.sort_unstable_by(|left, right| {
            let left = &snapshot.edges[*left];
            let right = &snapshot.edges[*right];
            left.start_node_id
                .cmp(&right.start_node_id)
                .then_with(|| left.end_node_id.cmp(&right.end_node_id))
        });
        let mut patrol_stops = Vec::with_capacity(patrol_edge_indices.len() * 2);
        for index in patrol_edge_indices {
            let edge = &snapshot.edges[index];
            if let (Some(&start), Some(&end)) = (
                nodes.get(&edge.start_node_id),
                nodes.get(&edge.end_node_id),
            ) {
                patrol_stops.push(start);
                patrol_stops.push(end);
            }
        }

        let (surface_edge_cells, surface_node_cells, max_surface_half_width) =
            build_surface_spatial_index(&nodes, &snapshot.edges, &endpoint_half_width);

        Some(Self {
            nodes,
            edges: snapshot.edges,
            patrol_stops,
            weighted_graph,
            component_by_node,
            edge_lookup,
            endpoint_half_width,
            surface_edge_cells,
            surface_node_cells,
            max_surface_half_width,
            river_navigation,
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

    /// Nearest road centerline point within `max_distance`.
    ///
    /// Placement uses this direction to keep authoritative building footprints
    /// aligned with the same road-facing yaw shown by the client.
    pub fn nearest_point(&self, x: f64, z: f64, max_distance: f64) -> Option<(f64, f64)> {
        if !x.is_finite() || !z.is_finite() || !max_distance.is_finite() || max_distance < 0.0 {
            return None;
        }

        let mut best_distance = max_distance;
        let mut best_point = None;
        for &(node_x, node_z) in self.nodes.values() {
            let candidate_distance = distance(x, z, node_x, node_z);
            if candidate_distance <= best_distance {
                best_distance = candidate_distance;
                best_point = Some((node_x, node_z));
            }
        }

        for edge in &self.edges {
            for segment in edge.sampled_path.windows(2) {
                let (point_x, point_z) = project_point_to_segment(
                    x,
                    z,
                    segment[0][0],
                    segment[0][2],
                    segment[1][0],
                    segment[1][2],
                );
                let candidate_distance = distance(x, z, point_x, point_z);
                if candidate_distance <= best_distance
                    && (best_point.is_none() || candidate_distance < best_distance)
                {
                    best_distance = candidate_distance;
                    best_point = Some((point_x, point_z));
                }
            }
        }

        best_point
    }

    /// Number of stable edge-endpoint stops available to an autonomous road
    /// patrol. Stops are stored in start/end pairs, one pair per road edge.
    pub fn road_patrol_stop_count(&self) -> usize {
        self.patrol_stops.len()
    }

    /// Resolve a stable road-patrol ordinal to its exact centerline point.
    pub fn road_patrol_stop(&self, ordinal: u64) -> Option<(f64, f64)> {
        self.patrol_stops
            .get(usize::try_from(ordinal).ok()?)
            .copied()
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

    /// Surface speed for one authoritative combat movement step.
    ///
    /// A bridge is both rendered water and road surface, so road membership is
    /// checked before the wet mask. Any off-road wet sample makes the whole
    /// short heartbeat a wading step; otherwise a mostly road-bound step earns
    /// the road speed advantage.
    pub fn combat_segment_speed_multiplier(
        &self,
        ax: f64,
        az: f64,
        bx: f64,
        bz: f64,
        wading_multiplier: f64,
        road_multiplier: f64,
    ) -> f64 {
        let distance = distance(ax, az, bx, bz);
        if !distance.is_finite() || distance <= 1e-9 {
            return 1.0;
        }
        let sample_spacing = self
            .river_navigation
            .as_ref()
            .map(RiverNavigationGrid::cell_size)
            .unwrap_or(4.0)
            .max(0.5);
        let segments = (distance / (sample_spacing * 0.55)).ceil().clamp(1.0, 16.0) as usize;
        let mut road_samples = 0_usize;
        let mut sample_count = 0_usize;
        for index in 0..=segments {
            let t = index as f64 / segments as f64;
            let x = ax + (bx - ax) * t;
            let z = az + (bz - az) * t;
            let on_road = self.is_on_road_surface(x, z);
            if on_road {
                road_samples += 1;
            } else if self
                .river_navigation
                .as_ref()
                .is_some_and(|navigation| navigation.is_water_at(x, z))
            {
                return finite_surface_multiplier(wading_multiplier, 0.05, 1.0);
            }
            sample_count += 1;
        }
        if road_samples * 2 >= sample_count {
            finite_surface_multiplier(road_multiplier, 1.0, 3.0)
        } else {
            1.0
        }
    }

    /// Converts a direct line into base-speed travel effort for route choice.
    /// Wet cells cost `1 / wading_multiplier`; road cells cost
    /// `1 / road_multiplier`. Sampling is bounded so large-map raids do not
    /// turn river awareness into an unbounded per-agent scan.
    pub fn combat_cross_country_effort(
        &self,
        ax: f64,
        az: f64,
        bx: f64,
        bz: f64,
        wading_multiplier: f64,
        road_multiplier: f64,
    ) -> f64 {
        let direct_distance = distance(ax, az, bx, bz);
        if !direct_distance.is_finite() || direct_distance <= 1e-9 {
            return direct_distance.max(0.0);
        }
        let sample_spacing = self
            .river_navigation
            .as_ref()
            .map(RiverNavigationGrid::cell_size)
            .unwrap_or(5.0)
            .max(1.0);
        let segments = (direct_distance / sample_spacing).ceil().clamp(1.0, 256.0) as usize;
        let segment_distance = direct_distance / segments as f64;
        let wading_multiplier = finite_surface_multiplier(wading_multiplier, 0.05, 1.0);
        let road_multiplier = finite_surface_multiplier(road_multiplier, 1.0, 3.0);
        let mut effort = 0.0;
        for index in 0..segments {
            let t = (index as f64 + 0.5) / segments as f64;
            let x = ax + (bx - ax) * t;
            let z = az + (bz - az) * t;
            let multiplier = if self.is_on_road_surface(x, z) {
                road_multiplier
            } else if self
                .river_navigation
                .as_ref()
                .is_some_and(|navigation| navigation.is_water_at(x, z))
            {
                wading_multiplier
            } else {
                1.0
            };
            effort += segment_distance / multiplier;
        }
        effort
    }

    /// Civilian off-road access may cross dry land and may step onto a road
    /// deck, but it must never pass through open water beside that deck.
    /// Bridge samples are therefore classified as road before consulting the
    /// rendered wet mask shared by the client.
    pub fn segment_avoids_open_water(&self, ax: f64, az: f64, bx: f64, bz: f64) -> bool {
        let Some(navigation) = self.river_navigation.as_ref() else {
            return true;
        };
        let length = distance(ax, az, bx, bz);
        if !length.is_finite() {
            return false;
        }
        if length <= 1e-8 {
            return !self.is_open_water_at(ax, az);
        }
        let samples = (length / (navigation.cell_size() * 0.35))
            .ceil()
            .clamp(1.0, 256.0) as usize;
        for index in 0..=samples {
            let t = index as f64 / samples as f64;
            if self.is_open_water_at(ax + (bx - ax) * t, az + (bz - az) * t) {
                return false;
            }
        }
        true
    }

    fn is_open_water_at(&self, x: f64, z: f64) -> bool {
        !self.is_on_road_surface(x, z)
            && self
                .river_navigation
                .as_ref()
                .is_some_and(|navigation| navigation.is_water_at(x, z))
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
        let graph_distance = self
            .shortest_path_solve(ax, az, bx, bz)
            .map(|solve| self.route_distance(ax, az, bx, bz, &solve.node_path));
        let interior_edge_distance = self
            .same_edge_road_route(ax, az, bx, bz)
            .map(|route| route.distance);
        match (graph_distance, interior_edge_distance) {
            (Some(graph), Some(interior)) => Some(graph.min(interior)),
            (Some(graph), None) => Some(graph),
            (None, Some(interior)) => Some(interior),
            (None, None) => None,
        }
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
        let distances = self.shortest_node_distances_from(ax, az);

        targets
            .iter()
            .map(|&(tx, tz)| {
                let graph_distance = distances.as_ref().and_then(|distances| {
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
                });
                let interior_edge_distance = self
                    .same_edge_road_route(ax, az, tx, tz)
                    .map(|route| route.distance);
                match (graph_distance, interior_edge_distance) {
                    (Some(graph), Some(interior)) => Some(graph.min(interior)),
                    (Some(graph), None) => Some(graph),
                    (None, Some(interior)) => Some(interior),
                    (None, None) => None,
                }
            })
            .collect()
    }

    /// Shortest road distance from one origin to any target, with one graph
    /// traversal regardless of target count. This is suited to periodic
    /// service/muster checks where only the nearest reachable site matters.
    #[cfg(test)]
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
        let graph_route = self
            .shortest_path_solve(ax, az, bx, bz)
            .map(|solve| {
                let polyline = self.materialize_polyline(ax, az, bx, bz, &solve.node_path);
                RoadPathRoute {
                    distance: Self::polyline_length_xz(&polyline),
                    polyline,
                }
            })
            .filter(|route| self.polyline_avoids_open_water(&route.polyline));
        let interior_edge_route = self
            .same_edge_road_route(ax, az, bx, bz)
            .filter(|route| self.polyline_avoids_open_water(&route.polyline));
        match (graph_route, interior_edge_route) {
            (Some(graph), Some(interior)) if interior.distance <= graph.distance + 1e-6 => {
                Some(interior)
            }
            (Some(graph), _) => Some(graph),
            (None, Some(interior)) => Some(interior),
            (None, None) => None,
        }
    }

    /// When both endpoints front the same long road edge, enter at their
    /// nearest interior projections instead of detouring to a distant graph
    /// node. Reservations and trip movement then use the same materialized
    /// polyline and the road remains faster than the off-road fallback.
    fn same_edge_road_route(&self, ax: f64, az: f64, bx: f64, bz: f64) -> Option<RoadPathRoute> {
        if !ax.is_finite() || !az.is_finite() || !bx.is_finite() || !bz.is_finite() {
            return None;
        }
        let max_snap = BUILDING_ROAD_ACCESS_DISTANCE;
        let mut target_edges = HashSet::new();
        for key in surface_cell_keys(bx, bz, max_snap) {
            if let Some(indices) = self.surface_edge_cells.get(&key) {
                target_edges.extend(indices.iter().copied());
            }
        }

        let mut origin_edges = HashSet::new();
        for key in surface_cell_keys(ax, az, max_snap) {
            if let Some(indices) = self.surface_edge_cells.get(&key) {
                origin_edges.extend(indices.iter().copied());
            }
        }
        let mut candidates = origin_edges
            .into_iter()
            .filter(|index| target_edges.contains(index))
            .collect::<Vec<_>>();
        candidates.sort_unstable();

        let mut best: Option<RoadPathRoute> = None;
        for index in candidates {
            let Some(edge) = self.edges.get(index) else {
                continue;
            };
            let Some(origin) = project_point_to_polyline(ax, az, &edge.sampled_path) else {
                continue;
            };
            let Some(target) = project_point_to_polyline(bx, bz, &edge.sampled_path) else {
                continue;
            };
            if origin.access_distance > max_snap + 1e-6
                || target.access_distance > max_snap + 1e-6
                || !self.segment_avoids_open_water(ax, az, origin.point[0], origin.point[1])
                || !self.segment_avoids_open_water(bx, bz, target.point[0], target.point[1])
            {
                continue;
            }

            let mut polyline = Vec::with_capacity(edge.sampled_path.len() + 4);
            append_point(&mut polyline, ax, az);
            append_point(&mut polyline, origin.point[0], origin.point[1]);
            append_projected_edge_span(&mut polyline, &edge.sampled_path, origin, target);
            append_point(&mut polyline, bx, bz);
            let distance = Self::polyline_length_xz(&polyline);
            if !distance.is_finite() || distance <= 1e-6 {
                continue;
            }
            if best
                .as_ref()
                .is_none_or(|selected| distance + 1e-6 < selected.distance)
            {
                best = Some(RoadPathRoute { distance, polyline });
            }
        }
        best
    }

    /// Route an off-network approach into the road component that serves the
    /// destination, then continue on the canonical road path.
    ///
    /// Incursions begin at the map edge, beyond ordinary building snap range.
    /// A weighted access leg prefers joining the target's connected road
    /// branch early without pretending that off-road movement is impossible.
    /// Only one Dijkstra tree and one final route solve are required.
    pub fn road_path_route_from_external_access(
        &self,
        ax: f64,
        az: f64,
        bx: f64,
        bz: f64,
        offroad_distance_multiplier: f64,
    ) -> Option<RoadPathRoute> {
        let distances_to_target = self.shortest_node_distances_from(bx, bz)?;
        let offroad_multiplier = if offroad_distance_multiplier.is_finite() {
            offroad_distance_multiplier.max(1.0)
        } else {
            1.0
        };
        let gateway_id = distances_to_target
            .iter()
            .filter_map(|(node_id, road_distance)| {
                let &(nx, nz) = self.nodes.get(node_id)?;
                let access_distance = distance(ax, az, nx, nz);
                let weighted_distance = access_distance * offroad_multiplier + road_distance;
                weighted_distance.is_finite().then_some((
                    node_id,
                    weighted_distance,
                    access_distance,
                ))
            })
            .min_by(
                |(left_id, left_weighted, left_access),
                 (right_id, right_weighted, right_access)| {
                    left_weighted
                        .total_cmp(right_weighted)
                        .then_with(|| left_access.total_cmp(right_access))
                        .then_with(|| left_id.cmp(right_id))
                },
            )
            .map(|(node_id, _, _)| node_id)?;
        let &(gateway_x, gateway_z) = self.nodes.get(gateway_id)?;
        let road_route = self.road_path_route(gateway_x, gateway_z, bx, bz)?;
        let mut polyline = Vec::with_capacity(road_route.polyline.len() + 1);
        append_point(&mut polyline, ax, az);
        append_polyline(&mut polyline, &road_route.polyline);
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

    fn polyline_avoids_open_water(&self, path: &[[f64; 2]]) -> bool {
        path.windows(2).all(|segment| {
            self.segment_avoids_open_water(
                segment[0][0],
                segment[0][1],
                segment[1][0],
                segment[1][1],
            )
        })
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
                if !self.segment_avoids_open_water(x, z, nx, nz) {
                    continue;
                }
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
                let accessible_nodes = [&edge.start_node_id, &edge.end_node_id]
                    .into_iter()
                    .filter(|node_id| {
                        self.nodes
                            .get(*node_id)
                            .is_some_and(|&(nx, nz)| self.segment_avoids_open_water(x, z, nx, nz))
                    })
                    .cloned()
                    .collect::<Vec<_>>();
                if accessible_nodes.is_empty() {
                    continue;
                }
                if dist <= best_distance + 1e-6 {
                    if dist < best_distance - 1e-6 {
                        best_distance = dist;
                        best_nodes = accessible_nodes;
                    } else if (dist - best_distance).abs() <= 1e-6 {
                        best_nodes.extend(accessible_nodes);
                    }
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

impl RiverNavigationGrid {
    fn from_row(row: RiverNavigationRow) -> Option<Self> {
        if !(16..=512).contains(&row.resolution)
            || !row.start_x.is_finite()
            || !row.start_z.is_finite()
            || !row.span_x.is_finite()
            || !row.span_z.is_finite()
            || row.span_x <= 0.0
            || row.span_z <= 0.0
        {
            return None;
        }
        let byte_count = row.resolution.checked_mul(row.resolution)?.checked_add(7)? / 8;
        if row.wet_cells_hex.len() != byte_count * 2 {
            return None;
        }
        let bytes = row.wet_cells_hex.as_bytes();
        let mut wet_cells = Vec::with_capacity(byte_count);
        for index in (0..bytes.len()).step_by(2) {
            let high = hex_nibble(bytes[index])?;
            let low = hex_nibble(bytes[index + 1])?;
            wet_cells.push((high << 4) | low);
        }
        Some(Self {
            resolution: row.resolution,
            start_x: row.start_x,
            start_z: row.start_z,
            span_x: row.span_x,
            span_z: row.span_z,
            wet_cells,
            heights: if row.heights.len() == row.resolution * row.resolution
                && row.heights.iter().all(|h| h.is_finite() && h.abs() <= 10_000.0) { row.heights } else { Vec::new() },
        })
    }

    fn is_water_at(&self, x: f64, z: f64) -> bool {
        if !x.is_finite() || !z.is_finite() {
            return false;
        }
        let grid_x =
            ((x - self.start_x) / self.span_x * (self.resolution - 1) as f64).round() as isize;
        let grid_z =
            ((z - self.start_z) / self.span_z * (self.resolution - 1) as f64).round() as isize;
        if grid_x < 0
            || grid_z < 0
            || grid_x >= self.resolution as isize
            || grid_z >= self.resolution as isize
        {
            return false;
        }
        let cell_index = grid_z as usize * self.resolution + grid_x as usize;
        self.wet_cells
            .get(cell_index / 8)
            .is_some_and(|byte| byte & (1 << (cell_index & 7)) != 0)
    }

    fn cell_size(&self) -> f64 {
        let intervals = (self.resolution - 1).max(1) as f64;
        (self.span_x / intervals)
            .max(self.span_z / intervals)
            .max(0.5)
    }
}

fn hex_nibble(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn finite_surface_multiplier(value: f64, minimum: f64, maximum: f64) -> f64 {
    if value.is_finite() {
        value.clamp(minimum, maximum)
    } else {
        1.0
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
    let (cx, cz) = project_point_to_segment(px, pz, ax, az, bx, bz);
    distance(px, pz, cx, cz)
}

fn project_point_to_segment(px: f64, pz: f64, ax: f64, az: f64, bx: f64, bz: f64) -> (f64, f64) {
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
    (cx, cz)
}

fn project_point_to_polyline(x: f64, z: f64, path: &[[f64; 3]]) -> Option<EdgeProjection> {
    if path.len() < 2 {
        return None;
    }
    let mut best: Option<EdgeProjection> = None;
    let mut distance_from_start = 0.0;
    for (segment_index, segment) in path.windows(2).enumerate() {
        let ax = segment[0][0];
        let az = segment[0][2];
        let bx = segment[1][0];
        let bz = segment[1][2];
        let segment_length = distance(ax, az, bx, bz);
        let (point_x, point_z) = project_point_to_segment(x, z, ax, az, bx, bz);
        let access_distance = distance(x, z, point_x, point_z);
        let along_segment = distance(ax, az, point_x, point_z).min(segment_length);
        let candidate = EdgeProjection {
            point: [point_x, point_z],
            segment_index,
            distance_from_start: distance_from_start + along_segment,
            access_distance,
        };
        if best.as_ref().is_none_or(|selected| {
            access_distance + 1e-6 < selected.access_distance
                || ((access_distance - selected.access_distance).abs() <= 1e-6
                    && candidate.distance_from_start < selected.distance_from_start)
        }) {
            best = Some(candidate);
        }
        distance_from_start += segment_length;
    }
    best
}

fn append_projected_edge_span(
    output: &mut Vec<[f64; 2]>,
    edge_path: &[[f64; 3]],
    from: EdgeProjection,
    to: EdgeProjection,
) {
    append_point(output, from.point[0], from.point[1]);
    if from.distance_from_start <= to.distance_from_start {
        for point_index in (from.segment_index + 1)..=to.segment_index {
            let point = edge_path[point_index];
            append_point(output, point[0], point[2]);
        }
    } else {
        for point_index in ((to.segment_index + 1)..=from.segment_index).rev() {
            let point = edge_path[point_index];
            append_point(output, point[0], point[2]);
        }
    }
    append_point(output, to.point[0], to.point[1]);
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
    fn combat_elevation_interpolates_the_published_ground_not_world_axes() {
        let heights: Vec<f64> = (0..256).map(|i| (i % 16) as f64 * 2.0 + (i / 16) as f64 * 3.0).collect();
        let snapshot = serde_json::json!({ "nodes": [], "edges": [], "riverNavigation": {
            "resolution": 16, "startX": 0, "startZ": 0, "spanX": 15, "spanZ": 15,
            "wetCellsHex": "00".repeat(32), "heights": heights
        }});
        let network = RoadNetwork::from_snapshot_json(&snapshot.to_string()).unwrap();
        assert_eq!(network.combat_elevation(4.5, 7.5), 31.5);
        assert_eq!(network.combat_elevation(15.0,15.0), 75.0);
        assert_eq!(network.combat_elevation(-10.0,-10.0), 0.0);
    }

    #[test]
    fn empty_snapshot_still_supports_cross_country_logistics() {
        let network = RoadNetwork::from_snapshot_json(r#"{"nodes":[],"edges":[]}"#)
            .expect("an empty but valid owner network");
        assert!(network.road_path_distance(0.0, 0.0, 10.0, 0.0).is_none());
    }

    #[test]
    fn nearest_point_projects_roadside_buildings_onto_the_centerline() {
        let network = RoadNetwork::from_snapshot_json(
            r#"{
                "nodes": [
                    {"id":"a","position":[-30.0,0.0,-30.0]},
                    {"id":"b","position":[30.0,0.0,30.0]}
                ],
                "edges": [{
                    "startNodeId":"a",
                    "endNodeId":"b",
                    "width":4.2,
                    "sampledPath":[[-30.0,0.0,-30.0],[30.0,0.0,30.0]]
                }]
            }"#,
        )
        .expect("diagonal road network should parse");

        let (x, z) = network
            .nearest_point(-2.0, 8.0, 24.0)
            .expect("cursor should find the road centerline");
        assert!((x - 3.0).abs() < 1e-9);
        assert!((z - 3.0).abs() < 1e-9);
        assert_eq!(network.nearest_point(-2.0, 40.0, 4.0), None);
    }

    #[test]
    fn roadside_routes_enter_a_long_edge_at_interior_projections() {
        let network = RoadNetwork::from_snapshot_json(
            r#"{
                "nodes": [
                    {"id":"west","position":[8600.0,0.0,0.0]},
                    {"id":"east","position":[9000.0,0.0,0.0]}
                ],
                "edges": [{
                    "startNodeId":"west",
                    "endNodeId":"east",
                    "width":4.2,
                    "sampledPath":[[8600.0,0.0,0.0],[9000.0,0.0,0.0]]
                }]
            }"#,
        )
        .expect("long roadside edge should parse");

        let route = network
            .road_path_route(8650.0, 14.0, 8785.0, 14.0)
            .expect("both roadside buildings should connect");
        assert!((route.distance - 163.0).abs() < 1e-9);
        assert_eq!(
            route.polyline,
            vec![[8650.0, 14.0], [8650.0, 0.0], [8785.0, 0.0], [8785.0, 14.0]]
        );
        assert!(
            (network
                .road_path_distance(8650.0, 14.0, 8785.0, 14.0)
                .unwrap()
                - 163.0)
                .abs()
                < 1e-9
        );
        assert_eq!(
            network.road_path_distances_from(8650.0, 14.0, &[(8785.0, 14.0)]),
            vec![Some(163.0)]
        );
    }

    fn wet_row_hex(resolution: usize, wet_row: usize) -> String {
        let mut bytes = vec![0_u8; (resolution * resolution + 7) / 8];
        for grid_x in 0..resolution {
            let index = wet_row * resolution + grid_x;
            bytes[index / 8] |= 1 << (index & 7);
        }
        bytes
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    }

    #[test]
    fn combat_water_slows_both_sides_but_a_bridge_keeps_its_road_speed() {
        let navigation_hex = wet_row_hex(16, 8);
        let snapshot = serde_json::json!({
            "nodes": [
                {"id": "bridge-a", "position": [-2.0, 0.0, 0.0]},
                {"id": "bridge-b", "position": [2.0, 0.0, 0.0]}
            ],
            "edges": [{
                "startNodeId": "bridge-a",
                "endNodeId": "bridge-b",
                "width": 4.2,
                "sampledPath": [[-2.0, 0.0, 0.0], [2.0, 0.0, 0.0]]
            }],
            "riverNavigation": {
                "resolution": 16,
                "startX": -8.0,
                "startZ": -8.0,
                "spanX": 16.0,
                "spanZ": 16.0,
                "wetCellsHex": navigation_hex
            }
        })
        .to_string();
        let network = RoadNetwork::from_snapshot_json(&snapshot).expect("valid combat navigation");

        assert_eq!(
            network.combat_segment_speed_multiplier(4.0, 0.0, 6.0, 0.0, 0.6, 1.35),
            0.6,
            "off-road movement through rendered water must wade",
        );
        assert_eq!(
            network.combat_segment_speed_multiplier(-1.0, 0.0, 1.0, 0.0, 0.6, 1.35),
            1.35,
            "the same wet cells must not slow a unit standing on a road bridge",
        );
        assert_eq!(
            network.combat_segment_speed_multiplier(4.0, 4.0, 6.0, 4.0, 0.6, 1.35),
            1.0,
            "dry cross-country movement keeps its ordinary pace",
        );
        assert!(
            network.combat_cross_country_effort(4.0, 0.0, 6.0, 0.0, 0.6, 1.35) > 2.0,
            "route choice must account for the time spent wading",
        );
    }

    #[test]
    fn civilian_routes_cross_on_the_bridge_and_never_beside_it() {
        let navigation_hex = wet_row_hex(16, 8);
        let snapshot = serde_json::json!({
            "nodes": [
                {"id": "south", "position": [0.0, 0.0, -4.0]},
                {"id": "north", "position": [0.0, 0.0, 4.0]}
            ],
            "edges": [{
                "startNodeId": "south",
                "endNodeId": "north",
                "width": 4.2,
                "sampledPath": [[0.0, 0.0, -4.0], [0.0, 0.0, 4.0]]
            }],
            "riverNavigation": {
                "resolution": 16,
                "startX": -8.0,
                "startZ": -8.0,
                "spanX": 16.0,
                "spanZ": 16.0,
                "wetCellsHex": navigation_hex
            }
        })
        .to_string();
        let network = RoadNetwork::from_snapshot_json(&snapshot).expect("valid bridge navigation");

        assert!(
            !network.segment_avoids_open_water(5.0, -4.0, 5.0, 4.0),
            "the shorter line beside the bridge must be impassable",
        );
        assert!(network.segment_avoids_open_water(0.0, -4.0, 0.0, 4.0));
        let route = network
            .road_path_route(5.0, -4.0, 5.0, 4.0)
            .expect("the bridge should keep both banks connected");
        assert!(route.distance > 8.0);
        assert!(
            route
                .polyline
                .windows(2)
                .any(|segment| segment[0][0].abs() < 0.1
                    && segment[1][0].abs() < 0.1
                    && segment[0][1] < -1.0
                    && segment[1][1] > 1.0),
            "the authoritative cart, worker, and ox route must enter the bridge centerline",
        );
        assert!(route
            .polyline
            .windows(2)
            .all(|segment| network.segment_avoids_open_water(
                segment[0][0],
                segment[0][1],
                segment[1][0],
                segment[1][1],
            )));
    }

    #[test]
    fn equidistant_disconnected_roads_retain_both_components() {
        let network = RoadNetwork::from_snapshot_json(
            r#"{
                "nodes": [
                    {"id":"left-south","position":[-5.0,0.0,0.0]},
                    {"id":"left-north","position":[-5.0,0.0,20.0]},
                    {"id":"right-south","position":[5.0,0.0,0.0]},
                    {"id":"right-north","position":[5.0,0.0,20.0]}
                ],
                "edges": [
                    {
                        "startNodeId":"left-south",
                        "endNodeId":"left-north",
                        "width":4.0,
                        "sampledPath":[[-5.0,0.0,0.0],[-5.0,0.0,20.0]]
                    },
                    {
                        "startNodeId":"right-south",
                        "endNodeId":"right-north",
                        "width":4.0,
                        "sampledPath":[[5.0,0.0,0.0],[5.0,0.0,20.0]]
                    }
                ]
            }"#,
        )
        .expect("parallel road network should parse");

        assert!(network.road_connected(0.0, 10.0, -5.0, 0.0));
        assert!(network.road_connected(0.0, 10.0, 5.0, 0.0));
    }

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

        let incursion_route = network
            .road_path_route_from_external_access(-100.0, 5.0, 20.0, 0.0, 1.6)
            .expect("an external approach should join the target road component");
        assert_eq!(incursion_route.polyline.first(), Some(&[-100.0, 5.0]));
        assert!(
            incursion_route
                .polyline
                .iter()
                .any(|point| point[0].abs() < 1e-9 && point[1].abs() < 1e-9),
            "the weighted approach should join the connected branch at its outer gateway"
        );
        assert!(
            incursion_route.polyline.iter().all(|point| point[0] < 90.0),
            "a nearer disconnected road must never attract the incursion route"
        );
        assert!(
            (incursion_route.distance - RoadNetwork::polyline_length_xz(&incursion_route.polyline))
                .abs()
                < 1e-9
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
    fn bounded_external_incursion_routes_scale_to_long_road_branches() {
        const NODE_COUNT: usize = 1_000;
        let nodes = (0..NODE_COUNT)
            .map(|index| {
                serde_json::json!({
                    "id": format!("n{index}"),
                    "position": [index as f64 * 4.0, 0.0, 0.0],
                })
            })
            .collect::<Vec<_>>();
        let edges = (0..NODE_COUNT - 1)
            .map(|index| {
                let start = index as f64 * 4.0;
                let end = (index + 1) as f64 * 4.0;
                serde_json::json!({
                    "startNodeId": format!("n{index}"),
                    "endNodeId": format!("n{}", index + 1),
                    "width": 4.2,
                    "sampledPath": [[start, 0.0, 0.0], [end, 0.0, 0.0]],
                })
            })
            .collect::<Vec<_>>();
        let snapshot = serde_json::json!({ "nodes": nodes, "edges": edges }).to_string();
        let network = RoadNetwork::from_snapshot_json(&snapshot).expect("long road branch");
        let started = Instant::now();
        for flank in 0..4 {
            let route = network
                .road_path_route_from_external_access(
                    -500.0,
                    flank as f64 * 8.0,
                    (NODE_COUNT - 1) as f64 * 4.0,
                    0.0,
                    1.55,
                )
                .expect("each bounded raid target route should resolve");
            assert_eq!(route.polyline.first().map(|point| point[0]), Some(-500.0));
            assert!(route.distance > 4_000.0);
        }
        assert!(
            started.elapsed().as_secs_f64() < 1.0,
            "four incursion targets on a 1,000-node road branch should remain a start-of-raid cost"
        );
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
    }

    #[test]
    fn patrol_stops_pair_every_road_edge_in_stable_order() {
        let snapshot = serde_json::json!({
            "nodes": [
                { "id": "c", "position": [20.0, 0.0, 0.0] },
                { "id": "a", "position": [0.0, 0.0, 0.0] },
                { "id": "b", "position": [10.0, 0.0, 0.0] }
            ],
            "edges": [
                {
                    "startNodeId": "b",
                    "endNodeId": "c",
                    "width": 4.2,
                    "sampledPath": [[10.0, 0.0, 0.0], [20.0, 0.0, 0.0]]
                },
                {
                    "startNodeId": "a",
                    "endNodeId": "b",
                    "width": 4.2,
                    "sampledPath": [[0.0, 0.0, 0.0], [10.0, 0.0, 0.0]]
                }
            ]
        })
        .to_string();
        let network = RoadNetwork::from_snapshot_json(&snapshot).expect("patrol road network");

        assert_eq!(network.road_patrol_stop_count(), 4);
        assert_eq!(network.road_patrol_stop(0), Some((0.0, 0.0)));
        assert_eq!(network.road_patrol_stop(1), Some((10.0, 0.0)));
        assert_eq!(network.road_patrol_stop(2), Some((10.0, 0.0)));
        assert_eq!(network.road_patrol_stop(3), Some((20.0, 0.0)));
        assert_eq!(network.road_patrol_stop(4), None);
    }
}
