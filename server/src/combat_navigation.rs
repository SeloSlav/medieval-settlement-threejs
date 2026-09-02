//! Local visibility navigation around physical buildings. Road routing owns
//! the long journey; this layer owns collision-free legs and moving targets.
use std::collections::{BTreeSet, HashMap};

pub type NavPoint = (f64, f64);
const CELL: f64 = 24.0;
const CLEARANCE: f64 = 0.55;
const EPS: f64 = 1e-5;

#[derive(Clone, Copy, Debug)]
pub struct CombatObstacle {
    center: NavPoint,
    axis: NavPoint,
    half: NavPoint,
}

impl CombatObstacle {
    pub fn rectangle(x: f64, z: f64, half_x: f64, half_z: f64, yaw: f64) -> Self {
        Self {
            center: (x, z), axis: (yaw.cos(), -yaw.sin()),
            half: (half_x + CLEARANCE, half_z + CLEARANCE),
        }
    }

    pub fn from_corners(corners: [NavPoint; 4]) -> Self {
        let edge = (corners[1].0 - corners[0].0, corners[1].1 - corners[0].1);
        let length = edge.0.hypot(edge.1).max(EPS);
        Self {
            center: ((corners[0].0 + corners[2].0) * 0.5, (corners[0].1 + corners[2].1) * 0.5),
            axis: (edge.0 / length, edge.1 / length),
            half: (length * 0.5 + CLEARANCE, distance(corners[1], corners[2]) * 0.5 + CLEARANCE),
        }
    }

    fn local(self, point: NavPoint) -> NavPoint {
        let delta = (point.0 - self.center.0, point.1 - self.center.1);
        (delta.0 * self.axis.0 + delta.1 * self.axis.1,
         -delta.0 * self.axis.1 + delta.1 * self.axis.0)
    }

    fn world(self, point: NavPoint) -> NavPoint {
        (self.center.0 + point.0 * self.axis.0 - point.1 * self.axis.1,
         self.center.1 + point.0 * self.axis.1 + point.1 * self.axis.0)
    }

    fn contains(self, point: NavPoint) -> bool {
        let p = self.local(point);
        p.0.abs() < self.half.0 - EPS && p.1.abs() < self.half.1 - EPS
    }

    fn corners(self) -> [NavPoint; 4] {
        let (x, z) = (self.half.0 + EPS * 4.0, self.half.1 + EPS * 4.0);
        [self.world((-x, -z)), self.world((x, -z)), self.world((x, z)), self.world((-x, z))]
    }

    /// First intersection with the open, clearance-expanded rectangle.
    fn entry(self, start: NavPoint, end: NavPoint) -> Option<f64> {
        let a = self.local(start);
        let b = self.local(end);
        let mut near: f64 = 0.0;
        let mut far: f64 = 1.0;
        for (origin, delta, half) in [(a.0, b.0 - a.0, self.half.0 - EPS), (a.1, b.1 - a.1, self.half.1 - EPS)] {
            if delta.abs() < EPS {
                if origin.abs() >= half { return None; }
            } else {
                let first = (-half - origin) / delta;
                let second = (half - origin) / delta;
                near = near.max(first.min(second));
                far = far.min(first.max(second));
                if near >= far { return None; }
            }
        }
        (far > EPS && near < 1.0 - EPS).then_some(near.max(0.0))
    }
}

#[derive(Default)]
pub struct CombatNavigation {
    obstacles: Vec<CombatObstacle>,
    cells: HashMap<(i32, i32), Vec<usize>>,
}

impl CombatNavigation {
    pub fn push(&mut self, obstacle: CombatObstacle) {
        let index = self.obstacles.len();
        let corners = obstacle.corners();
        let bounds = bounds(&corners, 0.0);
        for x in bounds.0..=bounds.2 {
            for z in bounds.1..=bounds.3 {
                self.cells.entry((x, z)).or_default().push(index);
            }
        }
        self.obstacles.push(obstacle);
    }

    fn candidates(&self, start: NavPoint, goal: NavPoint, padding: f64) -> BTreeSet<usize> {
        let bounds = bounds(&[start, goal], padding);
        let mut result = BTreeSet::new();
        for x in bounds.0..=bounds.2 {
            for z in bounds.1..=bounds.3 {
                if let Some(indices) = self.cells.get(&(x, z)) { result.extend(indices); }
            }
        }
        result
    }

    /// Ground clicks inside structures resolve to a reachable perimeter.
    pub fn outside(&self, mut point: NavPoint) -> NavPoint {
        for _ in 0..8 {
            let Some(obstacle) = self.candidates(point, point, 0.0).into_iter()
                .map(|index| self.obstacles[index]).find(|obstacle| obstacle.contains(point)) else { break; };
            let mut local = obstacle.local(point);
            if obstacle.half.0 - local.0.abs() < obstacle.half.1 - local.1.abs() {
                local.0 = (obstacle.half.0 + EPS * 4.0) * if local.0 < 0.0 { -1.0 } else { 1.0 };
            } else {
                local.1 = (obstacle.half.1 + EPS * 4.0) * if local.1 < 0.0 { -1.0 } else { 1.0 };
            }
            point = obstacle.world(local);
        }
        point
    }

    /// Entry/exit of the actual muster/home target is allowed, never unrelated
    /// structures. All visibility edges use the same fixed endpoint exemptions.
    pub fn next_waypoint(&self, start: NavPoint, goal: NavPoint) -> NavPoint {
        if self.obstacles.is_empty() { return goal; }
        let length = distance(start, goal);
        let local_goal = if length > 36.0 {
            (start.0 + (goal.0 - start.0) * 36.0 / length, start.1 + (goal.1 - start.1) * 36.0 / length)
        } else { goal };
        let candidates = self.candidates(start, local_goal, 16.0);
        let blocked = |a, b| self.candidates(a, b, 0.0).into_iter().any(|index| {
            let obstacle = self.obstacles[index];
            !obstacle.contains(start) && !obstacle.contains(goal) && obstacle.entry(a, b).is_some()
        });
        if !blocked(start, local_goal) { return local_goal; }
        // The bound prevents an adversarially dense settlement from causing
        // unbounded path work. Failure holds position, never tunnels.
        if candidates.len() > 96 { return start; }
        let mut nodes = vec![start, local_goal];
        for index in candidates {
            let obstacle = self.obstacles[index];
            if !obstacle.contains(start) && !obstacle.contains(goal) { nodes.extend(obstacle.corners()); }
        }
        let mut cost = vec![f64::INFINITY; nodes.len()];
        let mut previous = vec![usize::MAX; nodes.len()];
        let mut closed = vec![false; nodes.len()];
        cost[0] = 0.0;
        for _ in 0..nodes.len() {
            let current = (0..nodes.len()).filter(|&i| !closed[i] && cost[i].is_finite())
                .min_by(|&a, &b| (cost[a] + distance(nodes[a], local_goal))
                    .total_cmp(&(cost[b] + distance(nodes[b], local_goal))));
            let Some(current) = current else { break; };
            if current == 1 {
                let mut next = 1;
                while previous[next] != 0 { next = previous[next]; }
                return nodes[next];
            }
            closed[current] = true;
            for next in 1..nodes.len() {
                let candidate = cost[current] + distance(nodes[current], nodes[next]);
                if !closed[next] && candidate < cost[next] && !blocked(nodes[current], nodes[next]) {
                    cost[next] = candidate;
                    previous[next] = current;
                }
            }
        }
        start
    }

    /// Sweep the final crowd-adjusted step, so separation cannot push soldiers
    /// through a wall and a long heartbeat cannot jump across a structure.
    pub fn constrain_step(&self, start: NavPoint, goal: NavPoint, proposed: NavPoint) -> NavPoint {
        let mut fraction: f64 = 1.0;
        for index in self.candidates(start, proposed, 0.0) {
            let obstacle = self.obstacles[index];
            if obstacle.contains(start) || obstacle.contains(goal) { continue; }
            if let Some(entry) = obstacle.entry(start, proposed) { fraction = fraction.min((entry - EPS).max(0.0)); }
        }
        (start.0 + (proposed.0 - start.0) * fraction, start.1 + (proposed.1 - start.1) * fraction)
    }
}

fn distance(a: NavPoint, b: NavPoint) -> f64 { (a.0 - b.0).hypot(a.1 - b.1) }
fn bounds(points: &[NavPoint], padding: f64) -> (i32, i32, i32, i32) {
    let cell = |value: f64| (value / CELL).floor() as i32;
    (cell(points.iter().map(|p| p.0).fold(f64::INFINITY, f64::min) - padding),
     cell(points.iter().map(|p| p.1).fold(f64::INFINITY, f64::min) - padding),
     cell(points.iter().map(|p| p.0).fold(f64::NEG_INFINITY, f64::max) + padding),
     cell(points.iter().map(|p| p.1).fold(f64::NEG_INFINITY, f64::max) + padding))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_company_walks_around_rotated_and_adjacent_buildings() {
        let mut nav = CombatNavigation::default();
        nav.push(CombatObstacle::rectangle(0.0, 0.0, 4.0, 3.0, 0.4));
        nav.push(CombatObstacle::rectangle(9.0, 2.0, 3.0, 3.0, -0.2));
        let goal = (20.0, 0.0);
        let mut point = (-16.0, 0.0);
        let mut detoured = false;
        for _ in 0..240 {
            let next = nav.next_waypoint(point, goal);
            let length = distance(point, next);
            if length > EPS {
                let amount = 0.5_f64.min(length) / length;
                let step = (point.0 + (next.0 - point.0) * amount, point.1 + (next.1 - point.1) * amount);
                point = nav.constrain_step(point, goal, step);
            }
            assert!(nav.obstacles.iter().all(|obstacle| !obstacle.contains(point)));
            detoured |= point.1.abs() > 3.0;
            if distance(point, goal) < 0.1 { break; }
        }
        assert!(detoured);
        assert!(distance(point, goal) < 0.1, "stuck at {point:?}");
    }

    #[test]
    fn ground_targets_and_swept_motion_do_not_enter_buildings() {
        let mut nav = CombatNavigation::default();
        nav.push(CombatObstacle::rectangle(0.0, 0.0, 4.0, 3.0, 0.0));
        assert!(!nav.obstacles[0].contains(nav.outside((0.0, 0.0))));
        let clipped = nav.constrain_step((-10.0, 0.0), (20.0, 0.0), (10.0, 0.0));
        assert!(clipped.0 < -4.5);
        // Actual muster/home entry and a recruit leaving home remain possible.
        assert_eq!(nav.next_waypoint((-10.0, 0.0), (0.0, 0.0)), (0.0, 0.0));
        assert_eq!(nav.next_waypoint((0.0, 0.0), (10.0, 0.0)), (10.0, 0.0));
    }
}
