//! Deterministic authoritative crowd steering for physical combatants.
//!
//! The hot neighbor data is stored as parallel primitive vectors and indexed
//! through a uniform spatial hash. `begin`/`push`/`finish` reuse their capacity,
//! so after warm-up neither rebuilding the grid nor querying it allocates.

use crate::balance_generated::{
    COMBAT_STEERING_ALIGNMENT_WEIGHT, COMBAT_STEERING_CELL_SIZE_M,
    COMBAT_STEERING_COHESION_WEIGHT, COMBAT_STEERING_EXACT_OVERLAP_EPSILON_SQ,
    COMBAT_STEERING_GOAL_WEIGHT, COMBAT_STEERING_MAX_NEIGHBORS,
    COMBAT_STEERING_MAX_TURN_RADIANS_PER_SECOND, COMBAT_STEERING_PREDICTION_SECONDS,
    COMBAT_STEERING_NEIGHBOR_RADIUS_M, COMBAT_STEERING_PREDICTIVE_WEIGHT,
    COMBAT_STEERING_SEPARATION_DISTANCE_M,
    COMBAT_STEERING_SEPARATION_WEIGHT, COMBAT_STEERING_VELOCITY_RESPONSE_PER_SECOND,
    COMBAT_STEERING_ENGAGEMENT_MIN_RADIUS_M, COMBAT_STEERING_ENGAGEMENT_RADIUS_FACTOR,
    COMBAT_STEERING_ENGAGEMENT_SLOT_COUNT, COMBAT_STEERING_RANGED_DEPTH_SPACING_M,
    COMBAT_STEERING_RANGED_LINE_SPACING_M, COMBAT_STEERING_RANGED_PREFERRED_RANGE_FACTOR,
};

const HASH_X: u32 = 73_856_093;
const HASH_Z: u32 = 19_349_663;
const MIN_BUCKETS: usize = 8;

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

/// Reusable structure-of-arrays spatial grid. Bodies are sorted by stable id
/// before insertion and inserted in reverse, giving deterministic ascending-id
/// traversal within every bucket in both Rust and TypeScript.
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
    velocity_xs: Vec<f64>,
    velocity_zs: Vec<f64>,
    cell_xs: Vec<i32>,
    cell_zs: Vec<i32>,
    next: Vec<i32>,
    heads: Vec<i32>,
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
            self.velocity_xs.push(body.velocity_x);
            self.velocity_zs.push(body.velocity_z);
            self.cell_xs.push(cell_coordinate(body.x));
            self.cell_zs.push(cell_coordinate(body.z));
        }

        let bucket_count = (count.saturating_mul(2))
            .next_power_of_two()
            .max(MIN_BUCKETS);
        self.heads.clear();
        self.heads.resize(bucket_count, -1);
        self.bucket_mask = bucket_count - 1;
        for index in (0..count).rev() {
            let bucket = cell_hash(self.cell_xs[index], self.cell_zs[index], self.bucket_mask);
            self.next[index] = self.heads[bucket];
            self.heads[bucket] = index as i32;
        }
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
            velocity_x: self.velocity_xs[index],
            velocity_z: self.velocity_zs[index],
        }
    }

    pub(crate) fn index_of(&self, id: u64) -> Option<usize> {
        self.ids.binary_search(&id).ok()
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

        let goal_dx = goal_x - source.x;
        let goal_dz = goal_z - source.z;
        let goal_distance = goal_dx.hypot(goal_dz);
        let (goal_heading_x, goal_heading_z) = normalized_or_zero(goal_dx, goal_dz);
        let mut separation_x = 0.0;
        let mut separation_z = 0.0;
        let mut predictive_x = 0.0;
        let mut predictive_z = 0.0;
        let mut alignment_x = 0.0;
        let mut alignment_z = 0.0;
        let mut center_x = 0.0;
        let mut center_z = 0.0;
        let mut same_group_count = 0_usize;
        let mut accepted = 0_usize;
        let source_cell_x = cell_coordinate(source.x);
        let source_cell_z = cell_coordinate(source.z);
        let separation_sq = COMBAT_STEERING_SEPARATION_DISTANCE_M
            * COMBAT_STEERING_SEPARATION_DISTANCE_M;
        let neighbor_radius_sq =
            COMBAT_STEERING_NEIGHBOR_RADIUS_M * COMBAT_STEERING_NEIGHBOR_RADIUS_M;
        let cell_radius =
            (COMBAT_STEERING_NEIGHBOR_RADIUS_M / COMBAT_STEERING_CELL_SIZE_M).ceil() as i32;

        'cells: for dz in -cell_radius..=cell_radius {
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
                    accepted += 1;
                    let (away_x, away_z, distance) = if distance_sq
                        <= COMBAT_STEERING_EXACT_OVERLAP_EPSILON_SQ
                    {
                        let (x, z) = overlap_axis(source.id, self.ids[index]);
                        (x, z, 0.0)
                    } else {
                        let distance = distance_sq.sqrt();
                        (relative_x / distance, relative_z / distance, distance)
                    };
                    if distance_sq < separation_sq {
                        let pressure =
                            1.0 - distance / COMBAT_STEERING_SEPARATION_DISTANCE_M;
                        separation_x += away_x * pressure;
                        separation_z += away_z * pressure;
                    }

                    let relative_velocity_x = source.velocity_x - self.velocity_xs[index];
                    let relative_velocity_z = source.velocity_z - self.velocity_zs[index];
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
                            let predicted_sq =
                                predicted_x * predicted_x + predicted_z * predicted_z;
                            if predicted_sq < separation_sq {
                                let (predicted_away_x, predicted_away_z, predicted_distance) =
                                    if predicted_sq <= COMBAT_STEERING_EXACT_OVERLAP_EPSILON_SQ {
                                        let (x, z) = overlap_axis(source.id, self.ids[index]);
                                        (x, z, 0.0)
                                    } else {
                                        let distance = predicted_sq.sqrt();
                                        (predicted_x / distance, predicted_z / distance, distance)
                                    };
                                let pressure = 1.0
                                    - predicted_distance
                                        / COMBAT_STEERING_SEPARATION_DISTANCE_M;
                                predictive_x += predicted_away_x * pressure;
                                predictive_z += predicted_away_z * pressure;
                            }
                        }
                    }

                    if self.group_kinds[index] == source.group_kind
                        && self.group_ids[index] == source.group_id
                    {
                        center_x += self.xs[index];
                        center_z += self.zs[index];
                        let (heading_x, heading_z) = normalized_or_zero(
                            self.velocity_xs[index],
                            self.velocity_zs[index],
                        );
                        alignment_x += heading_x;
                        alignment_z += heading_z;
                        same_group_count += 1;
                    }
                    if accepted >= COMBAT_STEERING_MAX_NEIGHBORS {
                        break 'cells;
                    }
                }
            }
        }

        let mut steer_x = goal_heading_x * COMBAT_STEERING_GOAL_WEIGHT
            + separation_x * COMBAT_STEERING_SEPARATION_WEIGHT
            + predictive_x * COMBAT_STEERING_PREDICTIVE_WEIGHT;
        let mut steer_z = goal_heading_z * COMBAT_STEERING_GOAL_WEIGHT
            + separation_z * COMBAT_STEERING_SEPARATION_WEIGHT
            + predictive_z * COMBAT_STEERING_PREDICTIVE_WEIGHT;
        if same_group_count > 0 {
            let inverse_count = 1.0 / same_group_count as f64;
            let (aligned_x, aligned_z) =
                normalized_or_zero(alignment_x * inverse_count, alignment_z * inverse_count);
            let (cohesion_x, cohesion_z) = normalized_or_zero(
                center_x * inverse_count - source.x,
                center_z * inverse_count - source.z,
            );
            steer_x += aligned_x * COMBAT_STEERING_ALIGNMENT_WEIGHT
                + cohesion_x * COMBAT_STEERING_COHESION_WEIGHT;
            steer_z += aligned_z * COMBAT_STEERING_ALIGNMENT_WEIGHT
                + cohesion_z * COMBAT_STEERING_COHESION_WEIGHT;
        }

        let (mut desired_heading_x, mut desired_heading_z) = normalized_or_zero(steer_x, steer_z);
        if desired_heading_x == 0.0 && desired_heading_z == 0.0 {
            desired_heading_x = goal_heading_x;
            desired_heading_z = goal_heading_z;
        }
        let current_speed = source.velocity_x.hypot(source.velocity_z);
        if current_speed > 1e-9 && (desired_heading_x != 0.0 || desired_heading_z != 0.0) {
            let current_heading_x = source.velocity_x / current_speed;
            let current_heading_z = source.velocity_z / current_speed;
            let signed_angle = (current_heading_x * desired_heading_z
                - current_heading_z * desired_heading_x)
                .atan2(
                    current_heading_x * desired_heading_x
                        + current_heading_z * desired_heading_z,
                );
            let turn = signed_angle.clamp(
                -COMBAT_STEERING_MAX_TURN_RADIANS_PER_SECOND * dt,
                COMBAT_STEERING_MAX_TURN_RADIANS_PER_SECOND * dt,
            );
            let (sin, cos) = turn.sin_cos();
            desired_heading_x = current_heading_x * cos - current_heading_z * sin;
            desired_heading_z = current_heading_x * sin + current_heading_z * cos;
        }

        let response = 1.0 - (-COMBAT_STEERING_VELOCITY_RESPONSE_PER_SECOND * dt).exp();
        let target_velocity_x = desired_heading_x * speed;
        let target_velocity_z = desired_heading_z * speed;
        let mut velocity_x =
            source.velocity_x + (target_velocity_x - source.velocity_x) * response;
        let mut velocity_z =
            source.velocity_z + (target_velocity_z - source.velocity_z) * response;
        let velocity_length = velocity_x.hypot(velocity_z);
        if velocity_length > speed {
            velocity_x = velocity_x / velocity_length * speed;
            velocity_z = velocity_z / velocity_length * speed;
        }
        let mut x = source.x + velocity_x * dt;
        let mut z = source.z + velocity_z * dt;
        let travelled = (x - source.x).hypot(z - source.z);
        if goal_distance > 1e-9
            && travelled > goal_distance
            && goal_heading_x * (x - source.x) + goal_heading_z * (z - source.z) > 0.0
        {
            x = goal_x;
            z = goal_z;
            velocity_x = 0.0;
            velocity_z = 0.0;
        }
        SteeringOutput {
            x,
            z,
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
    company_rank: usize,
    target_x: f64,
    target_z: f64,
    strike_range: f64,
) -> (f64, f64) {
    let slots = COMBAT_STEERING_ENGAGEMENT_SLOT_COUNT.max(1);
    let phase = (company_id as usize).wrapping_mul(3) % slots;
    let slot = (company_rank + phase) % slots;
    let angle = slot as f64 / slots as f64 * std::f64::consts::TAU;
    let radius = (strike_range * COMBAT_STEERING_ENGAGEMENT_RADIUS_FACTOR)
        .max(COMBAT_STEERING_ENGAGEMENT_MIN_RADIUS_M);
    (target_x + angle.cos() * radius, target_z + angle.sin() * radius)
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
    let columns = company_size.clamp(1, 6);
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

fn clear_and_reserve<T>(values: &mut Vec<T>, count: usize) {
    values.clear();
    if values.capacity() < count {
        values.reserve(count - values.capacity());
    }
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

fn overlap_axis(source_id: u64, neighbor_id: u64) -> (f64, f64) {
    match (source_id ^ neighbor_id.rotate_left(17)) & 3 {
        0 => (1.0, 0.0),
        1 => (0.0, 1.0),
        2 => (-1.0, 0.0),
        _ => (0.0, -1.0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
            velocity_x: 1.0,
            velocity_z: 0.0,
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
        assert!(with_neighbors.z < alone.z, "same-company cohesion pulls toward +z less than all-body separation pushes away");
        assert!(with_neighbors.x < alone.x, "the other company must still repel the source");
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
        let first = melee_engagement_goal(7, 0, 10.0, 20.0, 2.4);
        let second = melee_engagement_goal(7, 1, 10.0, 20.0, 2.4);
        assert_ne!(first, second);
        let radius = (first.0 - 10.0).hypot(first.1 - 20.0);
        assert!(radius >= COMBAT_STEERING_ENGAGEMENT_MIN_RADIUS_M);
        assert!(radius < 2.4);
    }

    #[test]
    fn ranged_goal_builds_lateral_and_depth_ranks() {
        let first = ranged_firing_line_goal(0, 8, 0.0, 0.0, 20.0, 0.0, 20.0);
        let adjacent = ranged_firing_line_goal(1, 8, 0.0, 0.0, 20.0, 0.0, 20.0);
        let rear = ranged_firing_line_goal(6, 8, 0.0, 0.0, 20.0, 0.0, 20.0);
        assert!((adjacent.1 - first.1).abs() > 1.4);
        assert!(rear.0 < first.0, "second rank must remain farther from its target");
    }
}
