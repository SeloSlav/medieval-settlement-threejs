//! Deterministic authoritative crowd steering for physical combatants.
//!
//! The hot neighbor data is stored as parallel primitive vectors and indexed
//! through a uniform spatial hash. `begin`/`push`/`finish` reuse their capacity,
//! so after warm-up neither rebuilding the grid nor querying it allocates.

use crate::balance_generated::{
    COMBAT_STEERING_ALIGNMENT_WEIGHT, COMBAT_STEERING_CELL_SIZE_M, COMBAT_STEERING_COHESION_WEIGHT,
    COMBAT_STEERING_ENGAGEMENT_MIN_RADIUS_M, COMBAT_STEERING_ENGAGEMENT_RADIUS_FACTOR,
    COMBAT_STEERING_ENGAGEMENT_SLOT_COUNT, COMBAT_STEERING_EXACT_OVERLAP_EPSILON_SQ,
    COMBAT_STEERING_GOAL_WEIGHT, COMBAT_STEERING_MAX_NEIGHBORS,
    COMBAT_STEERING_MAX_TURN_RADIANS_PER_SECOND, COMBAT_STEERING_NEIGHBOR_RADIUS_M,
    COMBAT_STEERING_PREDICTION_SECONDS, COMBAT_STEERING_PREDICTIVE_WEIGHT,
    COMBAT_STEERING_RANGED_DEPTH_SPACING_M, COMBAT_STEERING_RANGED_LINE_SPACING_M,
    COMBAT_STEERING_RANGED_PREFERRED_RANGE_FACTOR, COMBAT_STEERING_SEPARATION_DISTANCE_M,
    COMBAT_STEERING_SEPARATION_WEIGHT, COMBAT_STEERING_VELOCITY_RESPONSE_PER_SECOND,
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

    /// Bounded grid acquisition used only when a combatant has no retained
    /// live target. Steady-state pursuit therefore performs no all-enemy scan.
    pub(crate) fn nearest_matching_id(
        &self,
        source_id: u64,
        max_distance: f64,
        mut matches: impl FnMut(u8) -> bool,
    ) -> Option<u64> {
        let source = self.index_of(source_id)?;
        let cell_radius = (max_distance / COMBAT_STEERING_CELL_SIZE_M).ceil() as i32;
        let max_distance_sq = max_distance * max_distance;
        let mut best: Option<(f64, u64)> = None;
        for dz in -cell_radius..=cell_radius {
            for dx in -cell_radius..=cell_radius {
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
                        || !matches(self.factions[index])
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
        let dt = dt.min(0.2);
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
        let mut accepted = 0_usize;
        let source_cell_x = cell_coordinate(source.x);
        let source_cell_z = cell_coordinate(source.z);
        let separation_sq =
            COMBAT_STEERING_SEPARATION_DISTANCE_M * COMBAT_STEERING_SEPARATION_DISTANCE_M;
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
                    let mut relevant_neighbor = false;
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
                        relevant_neighbor = true;
                    }

                    let own_persisted_speed_sq = source.velocity_x * source.velocity_x
                        + source.velocity_z * source.velocity_z;
                    let other_persisted_speed_sq = self.velocity_xs[index]
                        * self.velocity_xs[index]
                        + self.velocity_zs[index] * self.velocity_zs[index];
                    let (own_velocity_x, own_velocity_z) = if own_persisted_speed_sq > 1e-8 {
                        (source.velocity_x, source.velocity_z)
                    } else {
                        (preferred_x, preferred_z)
                    };
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
                            let predicted_sq =
                                predicted_x * predicted_x + predicted_z * predicted_z;
                            if predicted_sq < separation_sq {
                                let (avoid_x, avoid_z) = if predicted_sq <= separation_sq * 0.16 {
                                    let low = source.id.min(self.ids[index]) as u32;
                                    let high = source.id.max(self.ids[index]) as u32;
                                    let side = if mix_seed(low ^ high.wrapping_mul(0x9e37_79b1)) & 1
                                        == 0
                                    {
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
                                let urgency = (1.0
                                    - closest_time / COMBAT_STEERING_PREDICTION_SECONDS)
                                    * (1.0
                                        - predicted_sq.sqrt()
                                            / COMBAT_STEERING_SEPARATION_DISTANCE_M);
                                predictive_x += avoid_x * urgency;
                                predictive_z += avoid_z * urgency;
                                predictive_neighbors += 1;
                                relevant_neighbor = true;
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
                        relevant_neighbor = true;
                    }
                    if relevant_neighbor {
                        accepted += 1;
                    }
                    if accepted >= COMBAT_STEERING_MAX_NEIGHBORS {
                        break 'cells;
                    }
                }
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
        let max_avoidance = COMBAT_STEERING_GOAL_WEIGHT * 0.72;
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
                (speed * 0.45).min((separation_pressure + flock_pressure) * speed)
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
    let slot = (company_rank + phase) % slots;
    let angle = slot as f64 / slots as f64 * std::f64::consts::TAU;
    let radius = (strike_range * COMBAT_STEERING_ENGAGEMENT_RADIUS_FACTOR)
        .max(COMBAT_STEERING_ENGAGEMENT_MIN_RADIUS_M);
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

fn preferred_velocity(x: f64, z: f64, goal_x: f64, goal_z: f64, speed: f64, dt: f64) -> (f64, f64) {
    let dx = goal_x - x;
    let dz = goal_z - z;
    let distance_sq = dx * dx + dz * dz;
    if distance_sq <= 0.0064 || speed <= 0.0 {
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
        agents: Vec<GoldenAgent>,
        expected: Vec<GoldenExpected>,
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

    #[test]
    fn typescript_and_rust_share_golden_steering_outputs() {
        let fixture: GoldenFixture =
            serde_json::from_str(include_str!("../../../balance/combatSteeringGolden.json"))
                .expect("valid shared combat-steering fixture");
        assert!(fixture.capacity >= fixture.agents.len());
        let mut grid = CombatSteeringGrid::default();
        grid.begin();
        for agent in &fixture.agents {
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
        for expected in &fixture.expected {
            let index = grid.index_of(expected.id).expect("golden body in grid");
            let body = grid.body(index);
            let output = grid.steer(
                body,
                body.goal_x,
                body.goal_z,
                body.speed,
                fixture.dt_seconds,
            );
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
}
