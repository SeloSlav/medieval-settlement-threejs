//! Bounded, server-owned surveyor routes. Failed searches never permit tunneling.
use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap};
use crate::realm_policy::{world_chunk, WORLD_SIZE};

pub type Point = [f64; 2];
type Cell = (i32, i32);
const STEP: f64 = 8.0;
pub const MAX_SEARCH_NODES: usize = 32_768;
const LINE_SEGMENT: f64 = 32.0;

#[derive(Debug, PartialEq)]
pub enum RouteError { InvalidDestination, Unreachable, Budget }

pub fn clear_segment(a: Point, b: Point, clear: &impl Fn(Point, Point) -> bool) -> bool {
    let count = (distance(a, b) / LINE_SEGMENT).ceil().max(1.0) as usize;
    let mut previous = a;
    for index in 1..=count {
        let t = index as f64 / count as f64;
        let point = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        if !clear(previous, point) { return false; }
        previous = point;
    }
    true
}

pub fn plan_route(start: Point, goal: Point, clear: impl Fn(Point, Point) -> bool) -> Result<Vec<Point>, RouteError> {
    if world_chunk(start[0], start[1]).is_none() || world_chunk(goal[0], goal[1]).is_none()
        || !clear(goal, goal) { return Err(RouteError::InvalidDestination); }
    if clear_segment(start, goal, &clear) { return Ok(vec![start, goal]); }
    let cell = |point: Point| (((point[0] + WORLD_SIZE / 2.0) / STEP).round() as i32,
        ((point[1] + WORLD_SIZE / 2.0) / STEP).round() as i32);
    let point = |cell: Cell| [cell.0 as f64 * STEP - WORLD_SIZE / 2.0, cell.1 as f64 * STEP - WORLD_SIZE / 2.0];
    let valid = |cell: Cell| cell.0 >= 0 && cell.1 >= 0 && cell.0 < (WORLD_SIZE / STEP) as i32 && cell.1 < (WORLD_SIZE / STEP) as i32;
    let estimate = |cell: Cell| (distance(point(cell), goal) * 1000.0) as u64;
    let mut open = BinaryHeap::new();
    let mut states: HashMap<Cell, (u64, Option<Cell>)> = HashMap::new();
    let initial = cell(start);
    for x in -1..=1 { for z in -1..=1 {
        let next = (initial.0 + x, initial.1 + z);
        if valid(next) && clear(start, point(next)) {
            let cost = (distance(start, point(next)) * 1000.0).ceil() as u64;
            states.insert(next, (cost, None)); open.push(Reverse((cost + estimate(next), cost, next)));
        }
    } }
    let mut expanded = 0;
    while let Some(Reverse((_, cost, current))) = open.pop() {
        if states.get(&current).is_none_or(|state| state.0 != cost) { continue; }
        expanded += 1;
        if expanded > MAX_SEARCH_NODES { return Err(RouteError::Budget); }
        let from = point(current);
        if distance(from, goal) <= STEP * 2.0 && clear(from, goal) {
            let mut path = vec![goal, from];
            let mut previous = states[&current].1;
            while let Some(cell) = previous { path.push(point(cell)); previous = states[&cell].1; }
            path.push(start); path.reverse();
            return Ok(compress(path, &clear));
        }
        for (dx, dz) in [(-1,-1), (-1,0), (-1,1), (0,-1), (0,1), (1,-1), (1,0), (1,1)] {
            let next = (current.0 + dx, current.1 + dz);
            if !valid(next) { continue; }
            let next_cost = cost + if dx == 0 || dz == 0 { 8_000 } else { 11_314 };
            if states.get(&next).is_some_and(|state| state.0 <= next_cost) || !clear(from, point(next)) { continue; }
            if states.len() >= MAX_SEARCH_NODES && !states.contains_key(&next) { return Err(RouteError::Budget); }
            states.insert(next, (next_cost, Some(current)));
            open.push(Reverse((next_cost + estimate(next), next_cost, next)));
        }
    }
    Err(RouteError::Unreachable)
}

fn compress(path: Vec<Point>, clear: &impl Fn(Point, Point) -> bool) -> Vec<Point> {
    let mut result = vec![path[0]];
    let mut current = 0;
    while current + 1 < path.len() {
        let mut next = current + 1;
        while next + 1 < path.len() && distance(path[current], path[next + 1]) <= LINE_SEGMENT
            && clear(path[current], path[next + 1]) { next += 1; }
        result.push(path[next]); current = next;
    }
    result
}
fn distance(a: Point, b: Point) -> f64 { (a[0]-b[0]).hypot(a[1]-b[1]) }

#[cfg(test)]
mod tests {
    use super::*;
    use crate::combat_navigation::{CombatNavigation, CombatObstacle};
    #[test]
    fn rotated_foreign_structures_and_adjacent_homes_do_not_allow_tunneling() {
        let mut obstacles = CombatNavigation::default();
        obstacles.push(CombatObstacle::rectangle(0.0, 0.0, 7.0, 8.0, 0.35));
        obstacles.push(CombatObstacle::rectangle(9.0, 4.0, 3.3, 3.7, -0.2));
        let clear = |a: Point, b: Point| obstacles.civilian_segment_is_clear((a[0],a[1]),(b[0],b[1]));
        let path = plan_route([-40.0,0.0],[40.0,0.0], clear).unwrap();
        assert!(path.iter().any(|point| point[1].abs() > 8.0));
        assert!(path.windows(2).all(|segment| clear(segment[0],segment[1])));
    }
    #[test]
    fn river_bank_route_uses_a_bridge_and_rejects_water_clicks() {
        let clear = |a: Point,b: Point| {
            let count = distance(a,b).ceil().max(1.0) as usize;
            (0..=count).all(|i| {
                let t=i as f64/count as f64;
                let x=a[0]+(b[0]-a[0])*t; let z=a[1]+(b[1]-a[1])*t;
                x.abs()>8.0 || (z-32.0).abs()<4.1
            })
        };
        let route = plan_route([-48.0,0.0],[48.0,0.0],clear).unwrap();
        assert!(route.iter().any(|point| point[1]>27.0));
        assert!(route.windows(2).all(|segment| clear(segment[0],segment[1])));
        assert_eq!(plan_route([-48.0,0.0],[0.0,0.0],clear),Err(RouteError::InvalidDestination));
    }
    #[test]
    fn large_clear_world_has_two_waypoints_and_finite_world_bounds() {
        assert_eq!(plan_route([-6000.0,-6000.0],[6000.0,6000.0],|_,_|true).unwrap().len(),2);
        assert_eq!(plan_route([0.0,0.0],[f64::NAN,0.0],|_,_|true),Err(RouteError::InvalidDestination));
        assert_eq!(plan_route([0.0,0.0],[WORLD_SIZE,0.0],|_,_|true),Err(RouteError::InvalidDestination));
    }
    #[test]
    fn blocked_and_expensive_searches_return_errors_instead_of_unsafe_routes() {
        assert_eq!(plan_route([-40.0,0.0],[40.0,0.0],|a,b|a==b),Err(RouteError::Unreachable));
        let result=plan_route([-40.0,0.0],[40.0,0.0],|a,b|a[0]<0.0&&b[0]<0.0 || a[0]>0.0&&b[0]>0.0);
        assert_eq!(result,Err(RouteError::Budget));
    }
}
