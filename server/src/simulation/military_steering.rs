//! Deterministic authoritative crowd steering for physical combatants.
//!
//! The hot neighbor data is stored as parallel primitive vectors and indexed
//! through a uniform spatial hash. `begin`/`push`/`finish` reuse their capacity,
//! so after warm-up neither rebuilding the grid nor querying it allocates.

use std::collections::HashMap;

use crate::balance_generated::{
    COMBAT_STEERING_ALIGNMENT_WEIGHT, COMBAT_STEERING_AVOIDANCE_CAP_FACTOR,
    COMBAT_STEERING_CELL_SIZE_M, COMBAT_STEERING_COHESION_WEIGHT,
    COMBAT_STEERING_ENGAGEMENT_MIN_RADIUS_M, COMBAT_STEERING_ENGAGEMENT_RADIUS_FACTOR,
    COMBAT_STEERING_ENGAGEMENT_RING_SPACING_M, COMBAT_STEERING_ENGAGEMENT_SLOT_COUNT,
    COMBAT_STEERING_EXACT_OVERLAP_EPSILON_SQ, COMBAT_STEERING_GOAL_WEIGHT,
    COMBAT_STEERING_HARD_CLEARANCE_EPSILON_M, COMBAT_STEERING_HARD_CONSTRAINT_ITERATIONS,
    COMBAT_STEERING_HARD_PACK_ANGULAR_SLOTS, COMBAT_STEERING_IDLE_PUSH_SPEED_FACTOR,
    COMBAT_STEERING_MAX_NEIGHBORS, COMBAT_STEERING_MAX_SUBSTEP_SECONDS,
    COMBAT_STEERING_MAX_TURN_RADIANS_PER_SECOND, COMBAT_STEERING_NEIGHBOR_RADIUS_M,
    COMBAT_STEERING_PREDICTION_SECONDS, COMBAT_STEERING_PREDICTIVE_INNER_THRESHOLD_SQ_FACTOR,
    COMBAT_STEERING_PREDICTIVE_WEIGHT, COMBAT_STEERING_RANGED_DEPTH_SPACING_M,
    COMBAT_STEERING_RANGED_LINE_SPACING_M, COMBAT_STEERING_RANGED_PREFERRED_RANGE_FACTOR,
    COMBAT_STEERING_SEPARATION_DISTANCE_M, COMBAT_STEERING_SEPARATION_WEIGHT,
    COMBAT_STEERING_STOP_DISTANCE_M, COMBAT_STEERING_VELOCITY_RESPONSE_PER_SECOND,
};

const HASH_X: u32 = 73_856_093;
const HASH_Z: u32 = 19_349_663;
const MIN_BUCKETS: usize = 8;
const HARD_SEPARATION_DISTANCE_M: f64 =
    COMBAT_STEERING_SEPARATION_DISTANCE_M + COMBAT_STEERING_HARD_CLEARANCE_EPSILON_M;
const HARD_SEPARATION_DISTANCE_SQ: f64 = HARD_SEPARATION_DISTANCE_M * HARD_SEPARATION_DISTANCE_M;

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct SteeringBody {
    pub id: u64,
    pub owner_group: u64,
    pub group_kind: u8,
    pub group_id: u64,
    pub faction: u8,
    pub target_id: u64,
    pub x: f64,
    pub z: f64,
    pub goal_x: f64,
    pub goal_z: f64,
    pub speed: f64,
    pub velocity_x: f64,
    pub velocity_z: f64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct SteeringOutput {
    pub x: f64,
    pub z: f64,
    pub velocity_x: f64,
    pub velocity_z: f64,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub(crate) struct EngagementRankKey {
    pub owner_group: u64,
    pub group_kind: u8,
    pub group_id: u64,
    pub target_id: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct EngagementRankSeed {
    pub agent_id: u64,
    pub key: EngagementRankKey,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct DenseEngagementRank {
    pub agent_id: u64,
    pub target_id: u64,
    pub rank: usize,
}

/// Assign stable dense ranks to the currently living attackers of each exact
/// group/target pair. Callers provide seeds in stable formation-slot order, so
/// a casualty removes one entry and promotes every later survivor. Output is
/// restored to agent-id order for binary lookup. Both buffers retain capacity
/// across heartbeats.
pub(crate) fn rebuild_dense_engagement_ranks(
    seeds: &[EngagementRankSeed],
    counters: &mut HashMap<EngagementRankKey, usize>,
    output: &mut Vec<DenseEngagementRank>,
) {
    counters.clear();
    output.clear();
    if output.capacity() < seeds.len() {
        output.reserve(seeds.len() - output.capacity());
    }
    for seed in seeds {
        let rank = counters.entry(seed.key).or_insert(0);
        output.push(DenseEngagementRank {
            agent_id: seed.agent_id,
            target_id: seed.key.target_id,
            rank: *rank,
        });
        *rank += 1;
    }
    output.sort_unstable_by_key(|entry| entry.agent_id);
}

pub(crate) fn next_dense_engagement_rank(
    counters: &mut HashMap<EngagementRankKey, usize>,
    key: EngagementRankKey,
) -> usize {
    let rank = counters.entry(key).or_insert(0);
    let assigned = *rank;
    *rank += 1;
    assigned
}

#[derive(Clone, Copy)]
struct NeighborCandidate {
    index: usize,
    /// 0 immediate overlap, 1 predicted collision, 2 flock-only.
    priority: u8,
    distance_sq: f64,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct SteeringBounds {
    pub min_x: f64,
    pub max_x: f64,
    pub min_z: f64,
    pub max_z: f64,
}

impl SteeringBounds {
    #[cfg(test)]
    const UNBOUNDED: Self = Self {
        min_x: f64::NEG_INFINITY,
        max_x: f64::INFINITY,
        min_z: f64::NEG_INFINITY,
        max_z: f64::INFINITY,
    };
}

/// Reusable structure-of-arrays spatial grid. Bodies are sorted by stable id
/// before insertion and inserted forward, giving deterministic descending-id
/// bucket traversal matching the TypeScript typed-array implementation.
#[derive(Default)]
pub(crate) struct CombatSteeringGrid {
    staging: Vec<SteeringBody>,
    ids: Vec<u64>,
    owner_groups: Vec<u64>,
    group_kinds: Vec<u8>,
    group_ids: Vec<u64>,
    factions: Vec<u8>,
    target_ids: Vec<u64>,
    xs: Vec<f64>,
    zs: Vec<f64>,
    goal_xs: Vec<f64>,
    goal_zs: Vec<f64>,
    speeds: Vec<f64>,
    velocity_xs: Vec<f64>,
    velocity_zs: Vec<f64>,
    cell_xs: Vec<i32>,
    cell_zs: Vec<i32>,
    next: Vec<i32>,
    heads: Vec<i32>,
    output_xs: Vec<f64>,
    output_zs: Vec<f64>,
    output_velocity_xs: Vec<f64>,
    output_velocity_zs: Vec<f64>,
    bucket_mask: usize,
}

impl CombatSteeringGrid {
    pub(crate) fn begin(&mut self) {
        self.staging.clear();
    }

    pub(crate) fn push(&mut self, body: SteeringBody) {
        if body.id != 0
            && body.x.is_finite()
            && body.z.is_finite()
            && body.velocity_x.is_finite()
            && body.velocity_z.is_finite()
        {
            self.staging.push(body);
        }
    }

    pub(crate) fn finish(&mut self) {
        self.staging.sort_unstable_by_key(|body| body.id);
        let count = self.staging.len();
        clear_and_reserve(&mut self.ids, count);
        clear_and_reserve(&mut self.owner_groups, count);
        clear_and_reserve(&mut self.group_kinds, count);
        clear_and_reserve(&mut self.group_ids, count);
        clear_and_reserve(&mut self.factions, count);
        clear_and_reserve(&mut self.target_ids, count);
        clear_and_reserve(&mut self.xs, count);
        clear_and_reserve(&mut self.zs, count);
        clear_and_reserve(&mut self.goal_xs, count);
        clear_and_reserve(&mut self.goal_zs, count);
        clear_and_reserve(&mut self.speeds, count);
        clear_and_reserve(&mut self.velocity_xs, count);
        clear_and_reserve(&mut self.velocity_zs, count);
        clear_and_reserve(&mut self.cell_xs, count);
        clear_and_reserve(&mut self.cell_zs, count);
        self.next.clear();
        self.next.resize(count, -1);

        for body in &self.staging {
            self.ids.push(body.id);
            self.owner_groups.push(body.owner_group);
            self.group_kinds.push(body.group_kind);
            self.group_ids.push(body.group_id);
            self.factions.push(body.faction);
            self.target_ids.push(body.target_id);
            self.xs.push(body.x);
            self.zs.push(body.z);
            self.goal_xs.push(body.goal_x);
            self.goal_zs.push(body.goal_z);
            self.speeds.push(body.speed);
            self.velocity_xs.push(body.velocity_x);
            self.velocity_zs.push(body.velocity_z);
            self.cell_xs.push(cell_coordinate(body.x));
            self.cell_zs.push(cell_coordinate(body.z));
        }

        self.rebuild_spatial_index();
    }

    pub(crate) fn len(&self) -> usize {
        self.ids.len()
    }

    pub(crate) fn body(&self, index: usize) -> SteeringBody {
        SteeringBody {
            id: self.ids[index],
            owner_group: self.owner_groups[index],
            group_kind: self.group_kinds[index],
            group_id: self.group_ids[index],
            faction: self.factions[index],
            target_id: self.target_ids[index],
            x: self.xs[index],
            z: self.zs[index],
            goal_x: self.goal_xs[index],
            goal_z: self.goal_zs[index],
            speed: self.speeds[index],
            velocity_x: self.velocity_xs[index],
            velocity_z: self.velocity_zs[index],
        }
    }

    pub(crate) fn index_of(&self, id: u64) -> Option<usize> {
        self.ids.binary_search(&id).ok()
    }

    /// Advance a complete combat frame synchronously. Scheduler speeds can
    /// produce heartbeats longer than the steering prediction horizon, so the
    /// full elapsed duration is split into <=200 ms solves. Every body reads
    /// the same substep state, then all positions/velocities are committed
    /// together before rebuilding the uniform grid for the next substep.
    #[cfg(test)]
    pub(crate) fn integrate_all(&mut self, elapsed_seconds: f64) {
        self.integrate_all_bounded(elapsed_seconds, SteeringBounds::UNBOUNDED);
    }

    pub(crate) fn integrate_all_bounded(&mut self, elapsed_seconds: f64, bounds: SteeringBounds) {
        if !elapsed_seconds.is_finite() || elapsed_seconds <= 0.0 || self.ids.is_empty() {
            return;
        }
        let count = self.ids.len();
        clear_and_reserve(&mut self.output_xs, count);
        clear_and_reserve(&mut self.output_zs, count);
        clear_and_reserve(&mut self.output_velocity_xs, count);
        clear_and_reserve(&mut self.output_velocity_zs, count);
        let mut remaining = elapsed_seconds;
        while remaining > 1e-9 {
            let dt = remaining.min(COMBAT_STEERING_MAX_SUBSTEP_SECONDS);
            self.output_xs.clear();
            self.output_zs.clear();
            self.output_velocity_xs.clear();
            self.output_velocity_zs.clear();
            for index in 0..count {
                let source = self.body(index);
                let output = self.steer(source, source.goal_x, source.goal_z, source.speed, dt);
                self.output_xs.push(output.x);
                self.output_zs.push(output.z);
                self.output_velocity_xs.push(output.velocity_x);
                self.output_velocity_zs.push(output.velocity_z);
            }
            self.apply_hard_swept_constraints(dt, bounds);
            self.xs.copy_from_slice(&self.output_xs);
            self.zs.copy_from_slice(&self.output_zs);
            self.velocity_xs.copy_from_slice(&self.output_velocity_xs);
            self.velocity_zs.copy_from_slice(&self.output_velocity_zs);
            self.rebuild_spatial_index();
            remaining -= dt;
        }
    }

    fn rebuild_spatial_index(&mut self) {
        let count = self.ids.len();
        self.cell_xs.resize(count, 0);
        self.cell_zs.resize(count, 0);
        self.next.clear();
        self.next.resize(count, -1);
        for index in 0..count {
            self.cell_xs[index] = cell_coordinate(self.xs[index]);
            self.cell_zs[index] = cell_coordinate(self.zs[index]);
        }
        let bucket_count = (count.saturating_mul(2))
            .next_power_of_two()
            .max(MIN_BUCKETS);
        self.heads.clear();
        self.heads.resize(bucket_count, -1);
        self.bucket_mask = bucket_count - 1;
        for index in 0..count {
            let bucket = cell_hash(self.cell_xs[index], self.cell_zs[index], self.bucket_mask);
            self.next[index] = self.heads[bucket];
            self.heads[bucket] = index as i32;
        }
    }

    fn rebuild_output_spatial_index(&mut self) {
        let count = self.ids.len();
        self.cell_xs.resize(count, 0);
        self.cell_zs.resize(count, 0);
        self.next.clear();
        self.next.resize(count, -1);
        for index in 0..count {
            self.cell_xs[index] = cell_coordinate(self.output_xs[index]);
            self.cell_zs[index] = cell_coordinate(self.output_zs[index]);
        }
        let bucket_count = (count.saturating_mul(2))
            .next_power_of_two()
            .max(MIN_BUCKETS);
        self.heads.clear();
        self.heads.resize(bucket_count, -1);
        self.bucket_mask = bucket_count - 1;
        for index in 0..count {
            let bucket = cell_hash(self.cell_xs[index], self.cell_zs[index], self.bucket_mask);
            self.next[index] = self.heads[bucket];
            self.heads[bucket] = index as i32;
        }
    }

    fn apply_hard_swept_constraints(&mut self, dt: f64, bounds: SteeringBounds) {
        let cell_radius =
            (COMBAT_STEERING_NEIGHBOR_RADIUS_M / COMBAT_STEERING_CELL_SIZE_M).ceil() as i32;
        for iteration in 0..COMBAT_STEERING_HARD_CONSTRAINT_ITERATIONS {
            // The first pass broad-phases swept paths from the authoritative
            // substep starts. Later Gauss-Seidel cleanup passes reindex the
            // corrected endpoints so corrections that create a new local
            // contact are never hidden by stale cells.
            if iteration > 0 {
                self.rebuild_output_spatial_index();
            }
            for left in 0..self.ids.len() {
                for cell_delta_z in -cell_radius..=cell_radius {
                    let cell_z = self.cell_zs[left] + cell_delta_z;
                    for cell_delta_x in -cell_radius..=cell_radius {
                        let cell_x = self.cell_xs[left] + cell_delta_x;
                        let bucket = cell_hash(cell_x, cell_z, self.bucket_mask);
                        let mut cursor = self.heads[bucket];
                        while cursor >= 0 {
                            let right = cursor as usize;
                            cursor = self.next[right];
                            if right <= left
                                || self.cell_xs[right] != cell_x
                                || self.cell_zs[right] != cell_z
                                || self.owner_groups[right] != self.owner_groups[left]
                            {
                                continue;
                            }
                            self.project_hard_pair(left, right, bounds);
                        }
                    }
                }
            }
        }

        self.pack_residual_hard_overlaps(bounds);

        for index in 0..self.ids.len() {
            self.output_velocity_xs[index] = (self.output_xs[index] - self.xs[index]) / dt;
            self.output_velocity_zs[index] = (self.output_zs[index] - self.zs[index]) / dt;
        }
    }

    /// The bounded Gauss-Seidel passes resolve ordinary contacts and swept
    /// crossings. Pathological imports can place dozens of bodies at exactly
    /// one coordinate, where a fixed pass count cannot converge. This final
    /// deterministic incremental pack keeps every already-clear endpoint and
    /// searches concentric local rings only for residual overlaps.
    fn pack_residual_hard_overlaps(&mut self, bounds: SteeringBounds) {
        let count = self.ids.len();
        if count <= 1 {
            return;
        }
        let bucket_count = (count.saturating_mul(2))
            .next_power_of_two()
            .max(MIN_BUCKETS);
        self.heads.clear();
        self.heads.resize(bucket_count, -1);
        self.next.clear();
        self.next.resize(count, -1);
        self.cell_xs.resize(count, 0);
        self.cell_zs.resize(count, 0);
        self.bucket_mask = bucket_count - 1;

        let maximum_probes = count
            .saturating_mul(COMBAT_STEERING_HARD_PACK_ANGULAR_SLOTS)
            .max(COMBAT_STEERING_HARD_PACK_ANGULAR_SLOTS);
        for index in 0..count {
            let base_x = self.output_xs[index];
            let base_z = self.output_zs[index];
            let phase =
                mix_seed(self.ids[index] as u32) as usize % COMBAT_STEERING_HARD_PACK_ANGULAR_SLOTS;
            let mut selected_x = base_x.clamp(bounds.min_x, bounds.max_x);
            let mut selected_z = base_z.clamp(bounds.min_z, bounds.max_z);
            let mut found = false;
            for probe in 0..=maximum_probes {
                let (candidate_x, candidate_z) = if probe == 0 {
                    (selected_x, selected_z)
                } else {
                    let offset = probe - 1;
                    let ring = offset / COMBAT_STEERING_HARD_PACK_ANGULAR_SLOTS + 1;
                    let slot = offset % COMBAT_STEERING_HARD_PACK_ANGULAR_SLOTS;
                    let angle = (slot + phase) as f64
                        / COMBAT_STEERING_HARD_PACK_ANGULAR_SLOTS as f64
                        * std::f64::consts::TAU;
                    let radius = ring as f64 * HARD_SEPARATION_DISTANCE_M;
                    (
                        (base_x + angle.cos() * radius).clamp(bounds.min_x, bounds.max_x),
                        (base_z + angle.sin() * radius).clamp(bounds.min_z, bounds.max_z),
                    )
                };
                if self.hard_endpoint_is_clear(index, candidate_x, candidate_z) {
                    selected_x = candidate_x;
                    selected_z = candidate_z;
                    found = true;
                    break;
                }
            }
            let _ = found;
            self.output_xs[index] = selected_x;
            self.output_zs[index] = selected_z;
            let cell_x = cell_coordinate(selected_x);
            let cell_z = cell_coordinate(selected_z);
            self.cell_xs[index] = cell_x;
            self.cell_zs[index] = cell_z;
            let bucket = cell_hash(cell_x, cell_z, self.bucket_mask);
            self.next[index] = self.heads[bucket];
            self.heads[bucket] = index as i32;
        }
    }

    fn hard_endpoint_is_clear(&self, index: usize, x: f64, z: f64) -> bool {
        let cell_x = cell_coordinate(x);
        let cell_z = cell_coordinate(z);
        let cell_radius =
            (COMBAT_STEERING_NEIGHBOR_RADIUS_M / COMBAT_STEERING_CELL_SIZE_M).ceil() as i32;
        for delta_z in -cell_radius..=cell_radius {
            let neighbor_cell_z = cell_z + delta_z;
            for delta_x in -cell_radius..=cell_radius {
                let neighbor_cell_x = cell_x + delta_x;
                let bucket = cell_hash(neighbor_cell_x, neighbor_cell_z, self.bucket_mask);
                let mut cursor = self.heads[bucket];
                while cursor >= 0 {
                    let other = cursor as usize;
                    cursor = self.next[other];
                    if self.cell_xs[other] != neighbor_cell_x
                        || self.cell_zs[other] != neighbor_cell_z
                        || self.owner_groups[other] != self.owner_groups[index]
                    {
                        continue;
                    }
                    let dx = x - self.output_xs[other];
                    let dz = z - self.output_zs[other];
                    if dx * dx + dz * dz < HARD_SEPARATION_DISTANCE_SQ {
                        return false;
                    }
                }
            }
        }
        true
    }

    fn project_hard_pair(&mut self, left: usize, right: usize, bounds: SteeringBounds) {
        let mut start_delta_x = self.xs[left] - self.xs[right];
        let mut start_delta_z = self.zs[left] - self.zs[right];
        let start_distance_sq = start_delta_x * start_delta_x + start_delta_z * start_delta_z;
        let mut start_distance = start_distance_sq.sqrt();
        if start_distance_sq <= COMBAT_STEERING_EXACT_OVERLAP_EPSILON_SQ {
            let angle = exact_overlap_angle(self.ids[left], self.ids[right]);
            start_delta_x = angle.cos();
            start_delta_z = angle.sin();
            start_distance = 1.0;
        }
        let normal_x = start_delta_x / start_distance;
        let normal_z = start_delta_z / start_distance;
        let end_delta_x = self.output_xs[left] - self.output_xs[right];
        let end_delta_z = self.output_zs[left] - self.output_zs[right];
        let (correction_x, correction_z) = if start_distance_sq < HARD_SEPARATION_DISTANCE_SQ {
            let projected_distance = end_delta_x * normal_x + end_delta_z * normal_z;
            let required = HARD_SEPARATION_DISTANCE_M - projected_distance;
            if required <= 0.0 {
                return;
            }
            (normal_x * required, normal_z * required)
        } else {
            let relative_step_x = end_delta_x - start_delta_x;
            let relative_step_z = end_delta_z - start_delta_z;
            let relative_step_sq =
                relative_step_x * relative_step_x + relative_step_z * relative_step_z;
            if relative_step_sq <= 1e-12 {
                return;
            }
            let closest_time = (-(start_delta_x * relative_step_x
                + start_delta_z * relative_step_z)
                / relative_step_sq)
                .clamp(0.0, 1.0);
            let closest_x = start_delta_x + relative_step_x * closest_time;
            let closest_z = start_delta_z + relative_step_z * closest_time;
            if closest_x * closest_x + closest_z * closest_z >= HARD_SEPARATION_DISTANCE_SQ {
                return;
            }
            let radius_ratio = (HARD_SEPARATION_DISTANCE_M / start_distance).clamp(0.0, 1.0);
            let inward_factor = (1.0 - radius_ratio * radius_ratio).max(0.0).sqrt();
            let side = pair_passing_side(self.ids[left], self.ids[right]);
            let perpendicular_x = -normal_z * side;
            let perpendicular_z = normal_x * side;
            let tangent_x = -normal_x * inward_factor + perpendicular_x * radius_ratio;
            let tangent_z = -normal_z * inward_factor + perpendicular_z * radius_ratio;
            let along = (relative_step_x * tangent_x + relative_step_z * tangent_z).max(0.0);
            (
                tangent_x * along - relative_step_x,
                tangent_z * along - relative_step_z,
            )
        };

        let half_x = correction_x * 0.5;
        let half_z = correction_z * 0.5;
        self.output_xs[left] = (self.output_xs[left] + half_x).clamp(bounds.min_x, bounds.max_x);
        self.output_zs[left] = (self.output_zs[left] + half_z).clamp(bounds.min_z, bounds.max_z);
        self.output_xs[right] = (self.output_xs[right] - half_x).clamp(bounds.min_x, bounds.max_x);
        self.output_zs[right] = (self.output_zs[right] - half_z).clamp(bounds.min_z, bounds.max_z);
    }

    /// Bounded grid acquisition used only when a combatant has no retained
    /// live target. Steady-state pursuit therefore performs no all-enemy scan.
    pub(crate) fn nearest_matching_id(
        &self,
        source_id: u64,
        max_distance: f64,
        mut matches: impl FnMut(u64, u8, u64) -> bool,
    ) -> Option<u64> {
        let source = self.index_of(source_id)?;
        let cell_radius = (max_distance / COMBAT_STEERING_CELL_SIZE_M).ceil() as i32;
        let max_distance_sq = max_distance * max_distance;
        let mut best: Option<(f64, u64)> = None;
        for ring in 0..=cell_radius {
            for dz in -ring..=ring {
                for dx in -ring..=ring {
                    if ring > 0 && dx.abs() != ring && dz.abs() != ring {
                        continue;
                    }
                    let cell_x = self.cell_xs[source] + dx;
                    let cell_z = self.cell_zs[source] + dz;
                    let bucket = cell_hash(cell_x, cell_z, self.bucket_mask);
                    let mut cursor = self.heads[bucket];
                    while cursor >= 0 {
                        let index = cursor as usize;
                        cursor = self.next[index];
                        if index == source
                            || self.cell_xs[index] != cell_x
                            || self.cell_zs[index] != cell_z
                            || self.owner_groups[index] != self.owner_groups[source]
                            || !matches(
                                self.ids[index],
                                self.factions[index],
                                self.target_ids[index],
                            )
                        {
                            continue;
                        }
                        let dx = self.xs[index] - self.xs[source];
                        let dz = self.zs[index] - self.zs[source];
                        let distance_sq = dx * dx + dz * dz;
                        if distance_sq > max_distance_sq {
                            continue;
                        }
                        if best.is_none_or(|(best_distance, best_id)| {
                            distance_sq < best_distance
                                || (distance_sq == best_distance && self.ids[index] < best_id)
                        }) {
                            best = Some((distance_sq, self.ids[index]));
                        }
                    }
                }
            }
            if let Some((best_distance_sq, _)) = best {
                // Any unvisited ring is separated from the source cell by at
                // least `ring * cell_size`. Once the current best lies inside
                // that bound, later sparse cells cannot improve it.
                let unvisited_minimum = ring as f64 * COMBAT_STEERING_CELL_SIZE_M;
                if best_distance_sq <= unvisited_minimum * unvisited_minimum {
                    break;
                }
            }
        }
        best.map(|(_, id)| id)
    }

    /// Low-level deterministic kernel shared conceptually with the TypeScript
    /// sandbox. Goal seeking remains dominant; every nearby body separates,
    /// while alignment/cohesion are restricted to the exact same group.
    pub(crate) fn steer(
        &self,
        source: SteeringBody,
        goal_x: f64,
        goal_z: f64,
        speed: f64,
        dt: f64,
    ) -> SteeringOutput {
        if !dt.is_finite() || dt <= 0.0 || !speed.is_finite() || speed <= 0.0 {
            return SteeringOutput {
                x: source.x,
                z: source.z,
                velocity_x: 0.0,
                velocity_z: 0.0,
            };
        }
        let dt = dt.min(COMBAT_STEERING_MAX_SUBSTEP_SECONDS);
        let (preferred_x, preferred_z) =
            preferred_velocity(source.x, source.z, goal_x, goal_z, speed, dt);
        let preferred_length = preferred_x.hypot(preferred_z);
        let (goal_heading_x, goal_heading_z) = normalized_or_zero(preferred_x, preferred_z);
        let mut separation_x = 0.0;
        let mut separation_z = 0.0;
        let mut predictive_x = 0.0;
        let mut predictive_z = 0.0;
        let mut alignment_x = 0.0;
        let mut alignment_z = 0.0;
        let mut center_x = 0.0;
        let mut center_z = 0.0;
        let mut same_group_count = 0_usize;
        let mut separation_neighbors = 0_usize;
        let mut predictive_neighbors = 0_usize;
        let source_cell_x = cell_coordinate(source.x);
        let source_cell_z = cell_coordinate(source.z);
        let separation_sq =
            COMBAT_STEERING_SEPARATION_DISTANCE_M * COMBAT_STEERING_SEPARATION_DISTANCE_M;
        let neighbor_radius_sq =
            COMBAT_STEERING_NEIGHBOR_RADIUS_M * COMBAT_STEERING_NEIGHBOR_RADIUS_M;
        let cell_radius =
            (COMBAT_STEERING_NEIGHBOR_RADIUS_M / COMBAT_STEERING_CELL_SIZE_M).ceil() as i32;

        let own_persisted_speed_sq =
            source.velocity_x * source.velocity_x + source.velocity_z * source.velocity_z;
        let (own_velocity_x, own_velocity_z) = if own_persisted_speed_sq > 1e-8 {
            (source.velocity_x, source.velocity_z)
        } else {
            (preferred_x, preferred_z)
        };
        let mut candidates = [NeighborCandidate {
            index: 0,
            priority: u8::MAX,
            distance_sq: f64::INFINITY,
        }; COMBAT_STEERING_MAX_NEIGHBORS];
        let mut candidate_count = 0_usize;

        // Scan the entire bounded query before applying the cap. Selecting a
        // deterministic urgency/nearest top-K prevents 18 harmless flock
        // neighbors encountered early in hash traversal from hiding a later
        // overlapping or imminent-collision opponent.
        for dz in -cell_radius..=cell_radius {
            for dx in -cell_radius..=cell_radius {
                let cell_x = source_cell_x + dx;
                let cell_z = source_cell_z + dz;
                let bucket = cell_hash(cell_x, cell_z, self.bucket_mask);
                let mut cursor = self.heads.get(bucket).copied().unwrap_or(-1);
                while cursor >= 0 {
                    let index = cursor as usize;
                    cursor = self.next[index];
                    if self.cell_xs[index] != cell_x
                        || self.cell_zs[index] != cell_z
                        || self.ids[index] == source.id
                        || self.owner_groups[index] != source.owner_group
                    {
                        continue;
                    }
                    let relative_x = source.x - self.xs[index];
                    let relative_z = source.z - self.zs[index];
                    let distance_sq = relative_x * relative_x + relative_z * relative_z;
                    if distance_sq > neighbor_radius_sq {
                        continue;
                    }
                    let other_persisted_speed_sq = self.velocity_xs[index]
                        * self.velocity_xs[index]
                        + self.velocity_zs[index] * self.velocity_zs[index];
                    let other_preferred = preferred_velocity(
                        self.xs[index],
                        self.zs[index],
                        self.goal_xs[index],
                        self.goal_zs[index],
                        self.speeds[index],
                        dt,
                    );
                    let (other_velocity_x, other_velocity_z) = if other_persisted_speed_sq > 1e-8 {
                        (self.velocity_xs[index], self.velocity_zs[index])
                    } else {
                        other_preferred
                    };
                    let immediate = distance_sq < separation_sq;
                    let mut predicted = false;
                    let relative_velocity_x = own_velocity_x - other_velocity_x;
                    let relative_velocity_z = own_velocity_z - other_velocity_z;
                    let relative_speed_sq = relative_velocity_x * relative_velocity_x
                        + relative_velocity_z * relative_velocity_z;
                    if !immediate && relative_speed_sq > COMBAT_STEERING_EXACT_OVERLAP_EPSILON_SQ {
                        let closest_time = (-(relative_x * relative_velocity_x
                            + relative_z * relative_velocity_z)
                            / relative_speed_sq)
                            .clamp(0.0, COMBAT_STEERING_PREDICTION_SECONDS);
                        if closest_time > 0.0 {
                            let predicted_x = relative_x + relative_velocity_x * closest_time;
                            let predicted_z = relative_z + relative_velocity_z * closest_time;
                            let predicted_sq =
                                predicted_x * predicted_x + predicted_z * predicted_z;
                            predicted = predicted_sq < separation_sq;
                        }
                    }
                    let same_group = source.group_id != 0
                        && self.group_kinds[index] == source.group_kind
                        && self.group_ids[index] == source.group_id;
                    let priority = if immediate {
                        0
                    } else if predicted {
                        1
                    } else if same_group {
                        2
                    } else {
                        continue;
                    };
                    insert_neighbor_candidate(
                        &mut candidates,
                        &mut candidate_count,
                        NeighborCandidate {
                            index,
                            priority,
                            distance_sq,
                        },
                        &self.ids,
                    );
                }
            }
        }

        for candidate in candidates.iter().take(candidate_count) {
            let index = candidate.index;
            let relative_x = source.x - self.xs[index];
            let relative_z = source.z - self.zs[index];
            let distance_sq = candidate.distance_sq;
            let (away_x, away_z, distance) =
                if distance_sq <= COMBAT_STEERING_EXACT_OVERLAP_EPSILON_SQ {
                    let angle = exact_overlap_angle(source.id, self.ids[index]);
                    (angle.cos(), angle.sin(), 0.0)
                } else {
                    let distance = distance_sq.sqrt();
                    (relative_x / distance, relative_z / distance, distance)
                };
            if distance_sq < separation_sq {
                let pressure = 1.0 - distance / COMBAT_STEERING_SEPARATION_DISTANCE_M;
                separation_x += away_x * pressure;
                separation_z += away_z * pressure;
                separation_neighbors += 1;
            }

            let other_persisted_speed_sq = self.velocity_xs[index] * self.velocity_xs[index]
                + self.velocity_zs[index] * self.velocity_zs[index];
            let other_preferred = preferred_velocity(
                self.xs[index],
                self.zs[index],
                self.goal_xs[index],
                self.goal_zs[index],
                self.speeds[index],
                dt,
            );
            let (other_velocity_x, other_velocity_z) = if other_persisted_speed_sq > 1e-8 {
                (self.velocity_xs[index], self.velocity_zs[index])
            } else {
                other_preferred
            };
            let relative_velocity_x = own_velocity_x - other_velocity_x;
            let relative_velocity_z = own_velocity_z - other_velocity_z;
            let relative_speed_sq = relative_velocity_x * relative_velocity_x
                + relative_velocity_z * relative_velocity_z;
            if relative_speed_sq > COMBAT_STEERING_EXACT_OVERLAP_EPSILON_SQ {
                let closest_time = (-(relative_x * relative_velocity_x
                    + relative_z * relative_velocity_z)
                    / relative_speed_sq)
                    .clamp(0.0, COMBAT_STEERING_PREDICTION_SECONDS);
                if closest_time > 0.0 {
                    let predicted_x = relative_x + relative_velocity_x * closest_time;
                    let predicted_z = relative_z + relative_velocity_z * closest_time;
                    let predicted_sq = predicted_x * predicted_x + predicted_z * predicted_z;
                    if predicted_sq < separation_sq {
                        let (avoid_x, avoid_z) = if predicted_sq
                            <= separation_sq * COMBAT_STEERING_PREDICTIVE_INNER_THRESHOLD_SQ_FACTOR
                        {
                            let low = source.id.min(self.ids[index]) as u32;
                            let high = source.id.max(self.ids[index]) as u32;
                            let side = if mix_seed(low ^ high.wrapping_mul(0x9e37_79b1)) & 1 == 0 {
                                -1.0
                            } else {
                                1.0
                            };
                            let relative_speed = relative_speed_sq.sqrt();
                            (
                                -relative_velocity_z / relative_speed * side,
                                relative_velocity_x / relative_speed * side,
                            )
                        } else {
                            let distance = predicted_sq.sqrt();
                            (predicted_x / distance, predicted_z / distance)
                        };
                        let urgency = (1.0 - closest_time / COMBAT_STEERING_PREDICTION_SECONDS)
                            * (1.0 - predicted_sq.sqrt() / COMBAT_STEERING_SEPARATION_DISTANCE_M);
                        predictive_x += avoid_x * urgency;
                        predictive_z += avoid_z * urgency;
                        predictive_neighbors += 1;
                    }
                }
            }

            if source.group_id != 0
                && self.group_kinds[index] == source.group_kind
                && self.group_ids[index] == source.group_id
            {
                center_x += self.xs[index];
                center_z += self.zs[index];
                let (heading_x, heading_z) =
                    normalized_or_zero(self.velocity_xs[index], self.velocity_zs[index]);
                alignment_x += heading_x;
                alignment_z += heading_z;
                same_group_count += 1;
            }
        }

        if separation_neighbors > 0 {
            separation_x /= separation_neighbors as f64;
            separation_z /= separation_neighbors as f64;
        }
        if predictive_neighbors > 0 {
            predictive_x /= predictive_neighbors as f64;
            predictive_z /= predictive_neighbors as f64;
        }
        let mut avoidance_x = separation_x * COMBAT_STEERING_SEPARATION_WEIGHT
            + predictive_x * COMBAT_STEERING_PREDICTIVE_WEIGHT;
        let mut avoidance_z = separation_z * COMBAT_STEERING_SEPARATION_WEIGHT
            + predictive_z * COMBAT_STEERING_PREDICTIVE_WEIGHT;
        let avoidance_length = avoidance_x.hypot(avoidance_z);
        let max_avoidance = COMBAT_STEERING_GOAL_WEIGHT * COMBAT_STEERING_AVOIDANCE_CAP_FACTOR;
        if avoidance_length > max_avoidance {
            avoidance_x *= max_avoidance / avoidance_length;
            avoidance_z *= max_avoidance / avoidance_length;
        }
        let mut steer_x = goal_heading_x * COMBAT_STEERING_GOAL_WEIGHT + avoidance_x;
        let mut steer_z = goal_heading_z * COMBAT_STEERING_GOAL_WEIGHT + avoidance_z;
        if same_group_count > 0 {
            let (aligned_x, aligned_z) = normalized_or_zero(alignment_x, alignment_z);
            let (cohesion_x, cohesion_z) = normalized_or_zero(
                center_x - source.x * same_group_count as f64,
                center_z - source.z * same_group_count as f64,
            );
            steer_x += aligned_x * COMBAT_STEERING_ALIGNMENT_WEIGHT
                + cohesion_x * COMBAT_STEERING_COHESION_WEIGHT;
            steer_z += aligned_z * COMBAT_STEERING_ALIGNMENT_WEIGHT
                + cohesion_z * COMBAT_STEERING_COHESION_WEIGHT;
        }

        let steer_length = steer_x.hypot(steer_z);
        let (mut desired_velocity_x, mut desired_velocity_z) = (0.0, 0.0);
        if steer_length > 1e-8 {
            let separation_pressure =
                separation_x.hypot(separation_z) + predictive_x.hypot(predictive_z);
            let flock_pressure = if same_group_count > 0 {
                COMBAT_STEERING_ALIGNMENT_WEIGHT + COMBAT_STEERING_COHESION_WEIGHT
            } else {
                0.0
            };
            let motion_speed = if preferred_length > 1e-8 {
                speed.min(preferred_length)
            } else {
                (speed * COMBAT_STEERING_IDLE_PUSH_SPEED_FACTOR)
                    .min((separation_pressure + flock_pressure) * speed)
            };
            desired_velocity_x = steer_x / steer_length * motion_speed;
            desired_velocity_z = steer_z / steer_length * motion_speed;
        }

        let response = 1.0 - (-COMBAT_STEERING_VELOCITY_RESPONSE_PER_SECOND * dt).exp();
        let mut velocity_x =
            source.velocity_x + (desired_velocity_x - source.velocity_x) * response;
        let mut velocity_z =
            source.velocity_z + (desired_velocity_z - source.velocity_z) * response;
        let old_speed = source.velocity_x.hypot(source.velocity_z);
        let new_speed = velocity_x.hypot(velocity_z);
        if old_speed > 1e-7 && new_speed > 1e-7 {
            let old_angle = source.velocity_z.atan2(source.velocity_x);
            let new_angle = velocity_z.atan2(velocity_x);
            let angle_delta = wrapped_angle(new_angle - old_angle);
            let max_turn = COMBAT_STEERING_MAX_TURN_RADIANS_PER_SECOND * dt;
            if angle_delta.abs() > max_turn {
                let limited_angle = old_angle + angle_delta.signum() * max_turn;
                velocity_x = limited_angle.cos() * new_speed;
                velocity_z = limited_angle.sin() * new_speed;
            }
        }
        SteeringOutput {
            x: source.x + velocity_x * dt,
            z: source.z + velocity_z * dt,
            velocity_x,
            velocity_z,
        }
    }
}

/// Evenly-spaced deterministic contact point around a defender. The caller's
/// rank is within its atomic company, with a company phase so converging
/// companies do not choose the same arc.
pub(crate) fn melee_engagement_goal(
    company_id: u64,
    target_id: u64,
    company_rank: usize,
    target_x: f64,
    target_z: f64,
    strike_range: f64,
) -> (f64, f64) {
    let slots = COMBAT_STEERING_ENGAGEMENT_SLOT_COUNT.max(1);
    let phase =
        mix_seed(company_id as u32 ^ (target_id as u32).wrapping_mul(0x9e37_79b1)) as usize % slots;
    let ring = company_rank / slots;
    let slot = (company_rank % slots + phase) % slots;
    let stagger = if ring % 2 == 0 { 0.0 } else { 0.5 };
    let angle = (slot as f64 + stagger) / slots as f64 * std::f64::consts::TAU;
    let radius = (strike_range * COMBAT_STEERING_ENGAGEMENT_RADIUS_FACTOR)
        .max(COMBAT_STEERING_ENGAGEMENT_MIN_RADIUS_M)
        + ring as f64 * COMBAT_STEERING_ENGAGEMENT_RING_SPACING_M;
    (
        target_x + angle.cos() * radius,
        target_z + angle.sin() * radius,
    )
}

/// Company-relative missile line behind the preferred range from a target.
/// Ranks first fill one lateral line, then add shallow rear ranks so bow and
/// crossbow companies never converge on the target's center point.
pub(crate) fn ranged_firing_line_goal(
    company_rank: usize,
    company_size: usize,
    source_x: f64,
    source_z: f64,
    target_x: f64,
    target_z: f64,
    strike_range: f64,
) -> (f64, f64) {
    let toward_x = target_x - source_x;
    let toward_z = target_z - source_z;
    let (toward_x, toward_z) = normalized_or_zero(toward_x, toward_z);
    if toward_x == 0.0 && toward_z == 0.0 {
        return (source_x, source_z);
    }
    let columns = (((company_size.max(1) * 2) as f64).sqrt().ceil() as usize).clamp(2, 8);
    let column = company_rank % columns;
    let row = company_rank / columns;
    let centered_column = column as f64 - (columns.saturating_sub(1) as f64 * 0.5);
    let preferred_range = strike_range * COMBAT_STEERING_RANGED_PREFERRED_RANGE_FACTOR;
    let away_x = -toward_x;
    let away_z = -toward_z;
    let lateral_x = -toward_z;
    let lateral_z = toward_x;
    let depth = preferred_range + row as f64 * COMBAT_STEERING_RANGED_DEPTH_SPACING_M;
    let lateral = centered_column * COMBAT_STEERING_RANGED_LINE_SPACING_M;
    (
        target_x + away_x * depth + lateral_x * lateral,
        target_z + away_z * depth + lateral_z * lateral,
    )
}

/// Ottoman warbands interleave missile soldiers every fourth source slot.
/// Compressing those stable slots is part of the authoritative line contract:
/// slots 3, 7, 11... become adjacent ranks 0, 1, 2..., all using one shared
/// company source/target frame.
pub(crate) fn raider_ranged_firing_line_goal(
    source_slot: u32,
    member_count: usize,
    source_x: f64,
    source_z: f64,
    target_x: f64,
    target_z: f64,
    strike_range: f64,
) -> (f64, f64) {
    ranged_firing_line_goal(
        (source_slot as usize) / 4,
        member_count.max(1),
        source_x,
        source_z,
        target_x,
        target_z,
        strike_range,
    )
}

fn clear_and_reserve<T>(values: &mut Vec<T>, count: usize) {
    values.clear();
    if values.capacity() < count {
        values.reserve(count - values.capacity());
    }
}

fn insert_neighbor_candidate(
    candidates: &mut [NeighborCandidate; COMBAT_STEERING_MAX_NEIGHBORS],
    count: &mut usize,
    candidate: NeighborCandidate,
    ids: &[u64],
) {
    let mut position = (*count).min(COMBAT_STEERING_MAX_NEIGHBORS);
    while position > 0 && neighbor_candidate_precedes(candidate, candidates[position - 1], ids) {
        position -= 1;
    }
    if position >= COMBAT_STEERING_MAX_NEIGHBORS {
        return;
    }
    let upper = (*count).min(COMBAT_STEERING_MAX_NEIGHBORS - 1);
    for index in (position..upper).rev() {
        candidates[index + 1] = candidates[index];
    }
    candidates[position] = candidate;
    *count = (*count + 1).min(COMBAT_STEERING_MAX_NEIGHBORS);
}

fn neighbor_candidate_precedes(
    left: NeighborCandidate,
    right: NeighborCandidate,
    ids: &[u64],
) -> bool {
    left.priority < right.priority
        || (left.priority == right.priority
            && (left.distance_sq < right.distance_sq
                || (left.distance_sq == right.distance_sq && ids[left.index] < ids[right.index])))
}

fn cell_coordinate(value: f64) -> i32 {
    (value / COMBAT_STEERING_CELL_SIZE_M).floor() as i32
}

fn cell_hash(x: i32, z: i32, mask: usize) -> usize {
    let hash = (x as u32).wrapping_mul(HASH_X) ^ (z as u32).wrapping_mul(HASH_Z);
    hash as usize & mask
}

fn normalized_or_zero(x: f64, z: f64) -> (f64, f64) {
    let length = x.hypot(z);
    if length > 1e-12 {
        (x / length, z / length)
    } else {
        (0.0, 0.0)
    }
}

fn preferred_velocity(x: f64, z: f64, goal_x: f64, goal_z: f64, speed: f64, dt: f64) -> (f64, f64) {
    let dx = goal_x - x;
    let dz = goal_z - z;
    let distance_sq = dx * dx + dz * dz;
    if distance_sq <= COMBAT_STEERING_STOP_DISTANCE_M * COMBAT_STEERING_STOP_DISTANCE_M
        || speed <= 0.0
    {
        return (0.0, 0.0);
    }
    let distance = distance_sq.sqrt();
    let limited_speed = speed.min(distance / dt);
    (dx / distance * limited_speed, dz / distance * limited_speed)
}

fn mix_seed(value: u32) -> u32 {
    let mut mixed = value;
    mixed = (mixed ^ (mixed >> 16)).wrapping_mul(0x85eb_ca6b);
    mixed = (mixed ^ (mixed >> 13)).wrapping_mul(0xc2b2_ae35);
    mixed ^ (mixed >> 16)
}

fn exact_overlap_angle(left_seed: u64, right_seed: u64) -> f64 {
    let left_first = left_seed < right_seed;
    let low = left_seed.min(right_seed) as u32;
    let high = left_seed.max(right_seed) as u32;
    let angle = mix_seed(low ^ high.wrapping_mul(0x9e37_79b1)) as f64 / 4_294_967_296.0
        * std::f64::consts::TAU;
    if left_first {
        angle
    } else {
        angle + std::f64::consts::PI
    }
}

fn pair_passing_side(left_seed: u64, right_seed: u64) -> f64 {
    let low = left_seed.min(right_seed) as u32;
    let high = left_seed.max(right_seed) as u32;
    if mix_seed(low ^ high.wrapping_mul(0x9e37_79b1)) & 1 == 0 {
        -1.0
    } else {
        1.0
    }
}

fn wrapped_angle(value: f64) -> f64 {
    value.sin().atan2(value.cos())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GoldenFixture {
        capacity: usize,
        dt_seconds: f64,
        tolerance: f64,
        bounds: GoldenBounds,
        agents: Vec<GoldenAgent>,
        expected: Vec<GoldenExpected>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GoldenBounds {
        min_x: f64,
        max_x: f64,
        min_z: f64,
        max_z: f64,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GoldenAgent {
        id: u64,
        owner_group: u64,
        group_kind: u8,
        group_id: u64,
        faction: u8,
        target_id: u64,
        enabled: bool,
        x: f64,
        z: f64,
        goal_x: f64,
        goal_z: f64,
        speed: f64,
        velocity_x: f64,
        velocity_z: f64,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GoldenExpected {
        id: u64,
        x: f64,
        z: f64,
        velocity_x: f64,
        velocity_z: f64,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ParitySuite {
        tolerance: f64,
        cases: Vec<ParityCase>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ParityCase {
        name: String,
        capacity: usize,
        dt_seconds: f64,
        steps: usize,
        bounds: GoldenBounds,
        agents: Vec<GoldenAgent>,
        expected: Vec<GoldenExpected>,
    }

    fn grid_from_golden_agents(capacity: usize, agents: &[GoldenAgent]) -> CombatSteeringGrid {
        assert!(capacity >= agents.len());
        let mut grid = CombatSteeringGrid::default();
        grid.begin();
        for agent in agents {
            if !agent.enabled {
                continue;
            }
            grid.push(SteeringBody {
                id: agent.id,
                owner_group: agent.owner_group,
                group_kind: agent.group_kind,
                group_id: agent.group_id,
                faction: agent.faction,
                target_id: agent.target_id,
                x: agent.x,
                z: agent.z,
                goal_x: agent.goal_x,
                goal_z: agent.goal_z,
                speed: agent.speed,
                velocity_x: agent.velocity_x,
                velocity_z: agent.velocity_z,
            });
        }
        grid.finish();
        grid
    }

    fn body(id: u64, group: u64, x: f64, z: f64) -> SteeringBody {
        SteeringBody {
            id,
            owner_group: 1,
            group_kind: 1,
            group_id: group,
            faction: 3,
            target_id: 0,
            x,
            z,
            goal_x: x,
            goal_z: z,
            speed: 2.0,
            velocity_x: 1.0,
            velocity_z: 0.0,
        }
    }

    fn assert_minimum_clearance(grid: &CombatSteeringGrid) {
        for left in 0..grid.len() {
            for right in (left + 1)..grid.len() {
                let left = grid.body(left);
                let right = grid.body(right);
                if left.owner_group != right.owner_group {
                    continue;
                }
                assert!(
                    (left.x - right.x).hypot(left.z - right.z)
                        >= COMBAT_STEERING_SEPARATION_DISTANCE_M - 1e-9,
                    "{} and {} violated physical clearance",
                    left.id,
                    right.id,
                );
            }
        }
    }

    #[test]
    fn typescript_and_rust_share_golden_steering_outputs() {
        let fixture: GoldenFixture =
            serde_json::from_str(include_str!("../../../balance/combatSteeringGolden.json"))
                .expect("valid shared combat-steering fixture");
        assert!(fixture.capacity >= fixture.agents.len());
        let mut grid = grid_from_golden_agents(fixture.capacity, &fixture.agents);
        grid.integrate_all_bounded(
            fixture.dt_seconds,
            SteeringBounds {
                min_x: fixture.bounds.min_x,
                max_x: fixture.bounds.max_x,
                min_z: fixture.bounds.min_z,
                max_z: fixture.bounds.max_z,
            },
        );
        for expected in &fixture.expected {
            let index = grid.index_of(expected.id).expect("golden body in grid");
            let output = grid.body(index);
            for (label, actual, expected_value) in [
                ("x", output.x, expected.x),
                ("z", output.z, expected.z),
                ("velocity_x", output.velocity_x, expected.velocity_x),
                ("velocity_z", output.velocity_z, expected.velocity_z),
            ] {
                assert!(
                    (actual - expected_value).abs() <= fixture.tolerance,
                    "agent {} {label}: Rust {actual:.15} != TypeScript {expected_value:.15}",
                    expected.id,
                );
            }
        }
        assert_minimum_clearance(&grid);
    }

    #[test]
    fn typescript_and_rust_share_adversarial_parity_cases() {
        let suite: ParitySuite = serde_json::from_str(include_str!(
            "../../../balance/combatSteeringParityCases.json"
        ))
        .expect("valid shared adversarial steering suite");
        for case in suite.cases {
            let mut grid = grid_from_golden_agents(case.capacity, &case.agents);
            let bounds = SteeringBounds {
                min_x: case.bounds.min_x,
                max_x: case.bounds.max_x,
                min_z: case.bounds.min_z,
                max_z: case.bounds.max_z,
            };
            let mut opened_passing_lane = false;
            for step in 0..case.steps {
                grid.integrate_all_bounded(case.dt_seconds, bounds);
                assert_minimum_clearance(&grid);
                if case.name == "head_on_six_server_steps" {
                    let left = grid.body(grid.index_of(11).expect("left head-on body"));
                    let right = grid.body(grid.index_of(12).expect("right head-on body"));
                    if (left.z - right.z).abs() >= COMBAT_STEERING_SEPARATION_DISTANCE_M - 1e-9 {
                        opened_passing_lane = true;
                    }
                    if !opened_passing_lane {
                        assert!(
                            left.x < right.x,
                            "{} inverted before lateral clearance at step {}",
                            case.name,
                            step + 1,
                        );
                    }
                }
            }
            if case.name == "head_on_six_server_steps" {
                assert!(opened_passing_lane);
            }
            for expected in case.expected {
                let actual = grid.body(
                    grid.index_of(expected.id)
                        .unwrap_or_else(|| panic!("{} missing {}", case.name, expected.id)),
                );
                for (label, value, target) in [
                    ("x", actual.x, expected.x),
                    ("z", actual.z, expected.z),
                    ("velocity_x", actual.velocity_x, expected.velocity_x),
                    ("velocity_z", actual.velocity_z, expected.velocity_z),
                ] {
                    assert!(
                        (value - target).abs() <= suite.tolerance,
                        "{} agent {} {label}: Rust {value:.15} != TypeScript {target:.15}",
                        case.name,
                        expected.id,
                    );
                }
            }
        }
    }

    #[test]
    fn grid_separates_every_group_but_coheres_only_company_neighbors() {
        let mut grid = CombatSteeringGrid::default();
        grid.begin();
        grid.push(body(3, 20, 0.35, 0.0));
        grid.push(body(1, 10, 0.0, 0.0));
        grid.push(body(2, 10, 0.1, 0.35));
        grid.finish();
        let source = grid.body(grid.index_of(1).unwrap());
        let with_neighbors = grid.steer(source, 6.0, 0.0, 2.0, 0.05);

        let mut isolated = CombatSteeringGrid::default();
        isolated.begin();
        isolated.push(source);
        isolated.finish();
        let alone = isolated.steer(source, 6.0, 0.0, 2.0, 0.05);
        assert!(
            with_neighbors.z < alone.z,
            "same-company cohesion pulls toward +z less than all-body separation pushes away"
        );
        assert!(
            with_neighbors.x < alone.x,
            "the other company must still repel the source"
        );
    }

    #[test]
    fn exact_overlaps_are_resolved_deterministically_without_nan() {
        let mut grid = CombatSteeringGrid::default();
        grid.begin();
        grid.push(body(1, 10, 0.0, 0.0));
        grid.push(body(2, 20, 0.0, 0.0));
        grid.finish();
        let first = grid.steer(grid.body(0), 0.0, 0.0, 1.0, 0.1);
        let repeated = grid.steer(grid.body(0), 0.0, 0.0, 1.0, 0.1);
        assert_eq!(first, repeated);
        assert!(first.x.is_finite() && first.z.is_finite());
        assert!(first.x != 0.0 || first.z != 0.0);
    }

    #[test]
    fn hard_constraint_separates_exact_overlap_canonically() {
        let mut grid = CombatSteeringGrid::default();
        grid.begin();
        let mut first = body(41, 10, 0.0, 0.0);
        first.velocity_x = 0.0;
        let mut second = body(42, 20, 0.0, 0.0);
        second.velocity_x = 0.0;
        grid.push(first);
        grid.push(second);
        grid.finish();
        grid.integrate_all(0.2);
        assert_minimum_clearance(&grid);
    }

    #[test]
    fn hard_constraint_separates_sixty_four_exact_overlaps() {
        let mut grid = CombatSteeringGrid::default();
        grid.begin();
        for id in 1..=64 {
            let mut combatant = body(id, id, 0.0, 0.0);
            combatant.velocity_x = 0.0;
            combatant.speed = 0.0;
            grid.push(combatant);
        }
        grid.finish();
        grid.integrate_all(0.2);
        assert_minimum_clearance(&grid);
    }

    #[test]
    fn hard_constraint_clears_dense_eight_by_eight_block() {
        let mut grid = CombatSteeringGrid::default();
        grid.begin();
        for row in 0..8 {
            for column in 0..8 {
                let id = (row * 8 + column + 1) as u64;
                let mut combatant = body(id, id, column as f64 * 0.46, row as f64 * 0.46);
                combatant.velocity_x = 0.0;
                combatant.speed = 0.0;
                grid.push(combatant);
            }
        }
        grid.finish();
        grid.integrate_all(0.2);
        assert_minimum_clearance(&grid);
    }

    #[test]
    fn non_default_group_kind_still_aligns_and_coheres() {
        let mut grouped = CombatSteeringGrid::default();
        grouped.begin();
        let mut source = body(51, 700, 0.0, 0.0);
        source.group_kind = 9;
        source.velocity_x = 0.0;
        let mut partner = body(52, 700, 1.6, 0.7);
        partner.group_kind = 9;
        partner.velocity_x = 0.0;
        grouped.push(source);
        grouped.push(partner);
        grouped.finish();
        let with_group = grouped.steer(source, 0.0, 0.0, 2.0, 0.05);

        let mut isolated = CombatSteeringGrid::default();
        isolated.begin();
        isolated.push(source);
        isolated.finish();
        let without_group = isolated.steer(source, 0.0, 0.0, 2.0, 0.05);
        assert!(
            with_group.x > without_group.x || with_group.z > without_group.z,
            "group_kind != 1 must still receive same-group flock terms"
        );
    }

    #[test]
    fn direct_goal_remains_dominant_under_neighbor_pressure() {
        let mut grid = CombatSteeringGrid::default();
        grid.begin();
        grid.push(body(1, 10, 0.0, 0.0));
        for id in 2..=20 {
            let angle = id as f64 * 0.41;
            grid.push(body(id, id, angle.cos() * 0.65, angle.sin() * 0.65));
        }
        grid.finish();
        let output = grid.steer(grid.body(grid.index_of(1).unwrap()), 20.0, 0.0, 2.0, 0.05);
        assert!(output.x > 0.0, "formation/path goal must beat crowd forces");
    }

    #[test]
    fn dense_flock_neighbors_cannot_hide_an_immediate_other_group_collision() {
        let mut crowded = CombatSteeringGrid::default();
        crowded.begin();
        let mut source = body(100, 10, 0.0, 0.0);
        source.goal_x = 10.0;
        crowded.push(source);
        for id in 1..=24 {
            let angle = id as f64 * 0.71;
            let radius = 1.1 + (id % 5) as f64 * 0.3;
            crowded.push(body(id, 10, angle.cos() * radius, angle.sin() * radius));
        }
        crowded.push(body(999, 99, 0.12, 0.0));
        crowded.finish();
        let with_collision = crowded.steer(
            crowded.body(crowded.index_of(100).unwrap()),
            10.0,
            0.0,
            2.0,
            0.05,
        );

        let mut flock_only = CombatSteeringGrid::default();
        flock_only.begin();
        flock_only.push(source);
        for id in 1..=24 {
            let angle = id as f64 * 0.71;
            let radius = 1.1 + (id % 5) as f64 * 0.3;
            flock_only.push(body(id, 10, angle.cos() * radius, angle.sin() * radius));
        }
        flock_only.finish();
        let without_collision = flock_only.steer(
            flock_only.body(flock_only.index_of(100).unwrap()),
            10.0,
            0.0,
            2.0,
            0.05,
        );
        assert!(
            with_collision.velocity_x < without_collision.velocity_x,
            "the immediate other-group body must survive the 18-neighbor cap"
        );
    }

    #[test]
    fn long_fast_heartbeat_substeps_predictive_crossing() {
        let mut grid = CombatSteeringGrid::default();
        grid.begin();
        let mut left = body(11, 1, -2.0, 0.0);
        left.goal_x = 4.0;
        left.speed = 2.2;
        left.velocity_x = 0.0;
        let mut right = body(12, 2, 2.0, 0.0);
        right.goal_x = -4.0;
        right.speed = 2.2;
        right.velocity_x = 0.0;
        grid.push(left);
        grid.push(right);
        grid.finish();

        let mut opened_passing_lane = false;
        for step in 0..18 {
            grid.integrate_all(0.2);
            let left = grid.body(grid.index_of(11).unwrap());
            let right = grid.body(grid.index_of(12).unwrap());
            let distance = (left.x - right.x).hypot(left.z - right.z);
            let lateral_clearance = (left.z - right.z).abs();
            assert!(
                distance >= COMBAT_STEERING_SEPARATION_DISTANCE_M - 1e-9,
                "hard separation failed on head-on tick {}",
                step + 1,
            );
            if lateral_clearance >= COMBAT_STEERING_SEPARATION_DISTANCE_M - 1e-9 {
                opened_passing_lane = true;
            }
            if !opened_passing_lane {
                assert!(
                    left.x < right.x,
                    "head-on bodies exchanged x order before lateral clearance on tick {}",
                    step + 1,
                );
            }
        }
        assert!(
            opened_passing_lane,
            "head-on prediction must open a deterministic passing side"
        );
    }

    #[test]
    fn warm_grid_rebuild_retains_all_hot_buffer_capacities() {
        let mut grid = CombatSteeringGrid::default();
        for id in 1..=512 {
            grid.push(body(id, id / 8, id as f64 * 0.2, 0.0));
        }
        grid.finish();
        let capacities = (
            grid.staging.capacity(),
            grid.ids.capacity(),
            grid.xs.capacity(),
            grid.next.capacity(),
            grid.heads.capacity(),
        );
        grid.begin();
        for id in 1..=512 {
            grid.push(body(id, id / 8, id as f64 * 0.2, 1.0));
        }
        grid.finish();
        assert_eq!(
            capacities,
            (
                grid.staging.capacity(),
                grid.ids.capacity(),
                grid.xs.capacity(),
                grid.next.capacity(),
                grid.heads.capacity(),
            )
        );
    }

    #[test]
    fn engagement_slots_do_not_collapse_onto_the_defender() {
        let first = melee_engagement_goal(7, 99, 0, 10.0, 20.0, 2.4);
        let second = melee_engagement_goal(7, 99, 1, 10.0, 20.0, 2.4);
        assert_ne!(first, second);
        let radius = (first.0 - 10.0).hypot(first.1 - 20.0);
        assert!(radius >= COMBAT_STEERING_ENGAGEMENT_MIN_RADIUS_M);
        assert!(radius < 2.4);

        let mut first_ring = (0..COMBAT_STEERING_ENGAGEMENT_SLOT_COUNT)
            .map(|rank| melee_engagement_goal(7, 99, rank, 10.0, 20.0, 2.4))
            .collect::<Vec<_>>();
        first_ring.sort_by(|left, right| {
            left.0
                .total_cmp(&right.0)
                .then_with(|| left.1.total_cmp(&right.1))
        });
        first_ring.dedup();
        assert_eq!(
            first_ring.len(),
            COMBAT_STEERING_ENGAGEMENT_SLOT_COUNT,
            "unique company source slots must fill the first engagement ring one-to-one"
        );

        let first_outer = melee_engagement_goal(
            7,
            99,
            COMBAT_STEERING_ENGAGEMENT_SLOT_COUNT,
            10.0,
            20.0,
            2.4,
        );
        let inner_radius = (first.0 - 10.0).hypot(first.1 - 20.0);
        let outer_radius = (first_outer.0 - 10.0).hypot(first_outer.1 - 20.0);
        assert!(
            (outer_radius - inner_radius - COMBAT_STEERING_ENGAGEMENT_RING_SPACING_M).abs()
                <= 1e-12
        );
        let inner_angle = (first.1 - 20.0).atan2(first.0 - 10.0);
        let outer_angle = (first_outer.1 - 20.0).atan2(first_outer.0 - 10.0);
        let half_slot_angle = std::f64::consts::PI / COMBAT_STEERING_ENGAGEMENT_SLOT_COUNT as f64;
        let stagger_delta = (outer_angle - inner_angle).rem_euclid(std::f64::consts::TAU);
        assert!((stagger_delta - half_slot_angle).abs() <= 1e-12);

        let mut first_twenty_five = (0..25)
            .map(|rank| melee_engagement_goal(7, 99, rank, 10.0, 20.0, 2.4))
            .collect::<Vec<_>>();
        first_twenty_five.sort_by(|left, right| {
            left.0
                .total_cmp(&right.0)
                .then_with(|| left.1.total_cmp(&right.1))
        });
        first_twenty_five.dedup();
        assert_eq!(first_twenty_five.len(), 25);
    }

    #[test]
    fn ranged_goal_builds_lateral_and_depth_ranks() {
        let first = ranged_firing_line_goal(0, 8, 0.0, 0.0, 20.0, 0.0, 20.0);
        let adjacent = ranged_firing_line_goal(1, 8, 0.0, 0.0, 20.0, 0.0, 20.0);
        let rear = ranged_firing_line_goal(6, 8, 0.0, 0.0, 20.0, 0.0, 20.0);
        assert!((adjacent.1 - first.1).abs() > 1.4);
        assert!(
            rear.0 < first.0,
            "second rank must remain farther from its target"
        );
    }

    #[test]
    fn spread_enemy_contacts_still_use_one_shared_ranged_line_heading() {
        // Individual Ottoman ranks may retain opponents spread across the
        // enemy front, but their per-raid frame supplies one anchor/heading.
        let company_anchor = (0.0, 0.0);
        let enemy_anchor = (20.0, 0.0);
        let goals = [3_u32, 7, 11, 15]
            .into_iter()
            .map(|source_slot| {
                raider_ranged_firing_line_goal(
                    source_slot,
                    8,
                    company_anchor.0,
                    company_anchor.1,
                    enemy_anchor.0,
                    enemy_anchor.1,
                    20.0,
                )
            })
            .collect::<Vec<_>>();
        for pair in goals.windows(2) {
            assert!((pair[0].0 - pair[1].0).abs() <= 1e-12);
            assert!(
                ((pair[1].1 - pair[0].1).abs() - COMBAT_STEERING_RANGED_LINE_SPACING_M).abs()
                    <= 1e-12
            );
        }

        let independently_twisted_a = ranged_firing_line_goal(0, 4, 0.0, 0.0, 18.0, -8.0, 12.0);
        let independently_twisted_b = ranged_firing_line_goal(1, 4, 0.0, 0.0, 22.0, 9.0, 12.0);
        assert!((independently_twisted_a.0 - independently_twisted_b.0).abs() > 0.25);
    }
}
