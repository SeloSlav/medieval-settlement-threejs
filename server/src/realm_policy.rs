//! Pure persistent-world geometry, shared by admission, interest and visibility.
use std::collections::BTreeMap;
pub const WORLD_SIZE: f64 = 12_288.0;
pub const WORLD_SEED: u64 = 0x4747_1e50;
pub const MAX_PLAYERS: usize = 50;
pub const CLOCK_NUMERATOR: u16 = 2;
pub const CLOCK_DENOMINATOR: u16 = 5;
#[cfg(test)]
pub const RESERVED_OUTPOSTS: usize = 17;
pub const REGION_COLUMNS: u32 = 9;
#[cfg(test)]
pub const REGION_SPACING: f64 = 1_280.0;
pub const TOWN_RADIUS: f64 = 384.0;
pub const CHUNK_SIZE: f64 = 256.0;
pub const CHUNKS_PER_SIDE: u32 = 48;
pub const FOG_CELL_SIZE: f64 = 32.0;
pub const CELLS_PER_CHUNK: u32 = 8;
pub const UNIT_SIGHT: f64 = 96.0;
pub const CAMP_SIGHT: f64 = 160.0;

pub const CLOCK_STEP_MICROS: u64 = 500_000;
pub const MAX_CLOCK_CATCHUP_MICROS: i64 = 2_000_000;
#[derive(Debug)]
pub struct RealmClockStep {
    pub last_wall_micros: i64,
    pub remainder_micros: u64,
    pub elapsed_micros: i64,
    pub steps: u16,
}
/// Elapsed server time is the authority. A delayed callback retains all owed
/// work, but one reducer integrates at most four economy steps for fairness.
pub fn realm_clock_step(last_wall_micros: i64, remainder_micros: u64, now: i64) -> RealmClockStep {
    let elapsed = now.saturating_sub(last_wall_micros).clamp(0, MAX_CLOCK_CATCHUP_MICROS);
    let credit = remainder_micros + elapsed as u64;
    RealmClockStep { last_wall_micros: last_wall_micros.saturating_add(elapsed),
        remainder_micros: credit % CLOCK_STEP_MICROS, elapsed_micros: elapsed,
        steps: (credit / CLOCK_STEP_MICROS) as u16 }
}

pub fn world_chunk(x: f64, z: f64) -> Option<u32> {
    let half = WORLD_SIZE / 2.0;
    if !x.is_finite() || !z.is_finite() || x < -half || z < -half || x >= half || z >= half { return None; }
    Some(((z + half) / CHUNK_SIZE).floor() as u32 * CHUNKS_PER_SIDE + ((x + half) / CHUNK_SIZE).floor() as u32)
}
pub fn chunk_bounds(id: u32) -> (f64, f64, f64, f64) {
    let x = (id % CHUNKS_PER_SIDE) as f64 * CHUNK_SIZE - WORLD_SIZE / 2.0;
    let z = (id / CHUNKS_PER_SIDE) as f64 * CHUNK_SIZE - WORLD_SIZE / 2.0;
    (x, z, x + CHUNK_SIZE, z + CHUNK_SIZE)
}
pub fn chunks_in_radius(x: f64, z: f64, radius: f64) -> Vec<u32> {
    let half = WORLD_SIZE / 2.0;
    let coordinate = |v: f64| (((v + half) / CHUNK_SIZE).floor() as i32).clamp(0, CHUNKS_PER_SIDE as i32 - 1);
    let mut result = Vec::new();
    for cz in coordinate(z - radius)..=coordinate(z + radius) {
        for cx in coordinate(x - radius)..=coordinate(x + radius) {
            result.push(cz as u32 * CHUNKS_PER_SIDE + cx as u32);
        }
    }
    result
}
#[cfg(test)]
pub fn region_center(slot: u32) -> (f64, f64) {
    let origin = (REGION_COLUMNS - 1) as f64 / 2.0;
    (((slot % REGION_COLUMNS) as f64 - origin) * REGION_SPACING,
     ((slot / REGION_COLUMNS) as f64 - origin) * REGION_SPACING)
}
pub fn fog_bit(x: f64, z: f64) -> Option<(u32, u64)> {
    let chunk = world_chunk(x, z)?;
    let (min_x, min_z, _, _) = chunk_bounds(chunk);
    let cx = ((x - min_x) / FOG_CELL_SIZE).floor() as u32;
    let cz = ((z - min_z) / FOG_CELL_SIZE).floor() as u32;
    Some((chunk, 1u64 << (cz * CELLS_PER_CHUNK + cx)))
}

pub fn point_segment_distance_sq(px: f64, pz: f64, ax: f64, az: f64, bx: f64, bz: f64) -> f64 {
    let dx = bx - ax; let dz = bz - az;
    let length_sq = dx * dx + dz * dz;
    let t = if length_sq > 0.0 { ((px - ax) * dx + (pz - az) * dz) / length_sq } else { 0.0 }.clamp(0.0, 1.0);
    (px - ax - dx * t).powi(2) + (pz - az - dz * t).powi(2)
}

fn segment_rect_distance_sq(ax: f64, az: f64, bx: f64, bz: f64, min_x: f64, min_z: f64) -> f64 {
    let max_x = min_x + FOG_CELL_SIZE; let max_z = min_z + FOG_CELL_SIZE;
    // Slab intersection handles a segment that crosses the cell without an
    // endpoint inside it. Parallel slabs require no division.
    let mut enter: f64 = 0.0; let mut leave: f64 = 1.0;
    let mut intersects = true;
    for (a, b, min, max) in [(ax, bx, min_x, max_x), (az, bz, min_z, max_z)] {
        let delta = b - a;
        if delta == 0.0 { intersects &= a >= min && a <= max; }
        else {
            let t0 = (min - a) / delta; let t1 = (max - a) / delta;
            enter = enter.max(t0.min(t1)); leave = leave.min(t0.max(t1));
        }
    }
    if intersects && enter <= leave { return 0.0; }
    let point_rect = |x: f64, z: f64| (x - x.clamp(min_x, max_x)).powi(2) + (z - z.clamp(min_z, max_z)).powi(2);
    [(min_x, min_z), (max_x, min_z), (max_x, max_z), (min_x, max_z)].into_iter()
        .map(|(x, z)| point_segment_distance_sq(x, z, ax, az, bx, bz))
        .fold(point_rect(ax, az).min(point_rect(bx, bz)), f64::min)
}

/// Visits every fog cell touched by the segment's circular-width footprint.
/// Unlike point sampling this cannot jump across a narrow unexplored cell.
pub fn visit_road_cells(ax: f64, az: f64, bx: f64, bz: f64, radius: f64,
    mut visit: impl FnMut(u32, u64) -> Result<(), String>) -> Result<(), String> {
    if !radius.is_finite() || !(0.0..=8.0).contains(&radius) { return Err("Road width is invalid.".into()); }
    let half = WORLD_SIZE / 2.0;
    for (x, z) in [(ax, az), (bx, bz)] {
        if world_chunk(x - radius, z - radius).is_none() || world_chunk(x + radius, z + radius).is_none() {
            return Err("Road footprint is outside the realm.".into());
        }
    }
    let cell = |v: f64| ((v + half) / FOG_CELL_SIZE).floor() as u32;
    for cz in cell(az.min(bz) - radius)..=cell(az.max(bz) + radius) {
        for cx in cell(ax.min(bx) - radius)..=cell(ax.max(bx) + radius) {
            if segment_rect_distance_sq(ax, az, bx, bz, cx as f64 * FOG_CELL_SIZE - half, cz as f64 * FOG_CELL_SIZE - half) <= radius * radius {
                let chunk = (cz / CELLS_PER_CHUNK) * CHUNKS_PER_SIDE + cx / CELLS_PER_CHUNK;
                let bit = 1u64 << ((cz % CELLS_PER_CHUNK) * CELLS_PER_CHUNK + cx % CELLS_PER_CHUNK);
                visit(chunk, bit)?;
            }
        }
    }
    Ok(())
}
/// Centre-sampled circular sight. Camera movement never calls this function.
pub fn reveal_circle(masks: &mut BTreeMap<u32, u64>, x: f64, z: f64, radius: f64) {
    if world_chunk(x, z).is_none() || !radius.is_finite() || radius <= 0.0 { return; }
    let half = WORLD_SIZE / 2.0;
    let side = CHUNKS_PER_SIDE * CELLS_PER_CHUNK;
    let min_x = (((x - radius + half) / FOG_CELL_SIZE).floor() as i32).max(0);
    let max_x = (((x + radius + half) / FOG_CELL_SIZE).floor() as i32).min(side as i32 - 1);
    let min_z = (((z - radius + half) / FOG_CELL_SIZE).floor() as i32).max(0);
    let max_z = (((z + radius + half) / FOG_CELL_SIZE).floor() as i32).min(side as i32 - 1);
    for cz in min_z..=max_z {
        for cx in min_x..=max_x {
            let px = (cx as f64 + 0.5) * FOG_CELL_SIZE - half;
            let pz = (cz as f64 + 0.5) * FOG_CELL_SIZE - half;
            if (px - x).powi(2) + (pz - z).powi(2) <= radius * radius {
                let (chunk, bit) = fog_bit(px, pz).unwrap();
                *masks.entry(chunk).or_default() |= bit;
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn road_footprints_cover_interiors_width_and_diagonal_corners() {
        let cells = |a: (f64, f64), b: (f64, f64), radius: f64| {
            let mut masks = BTreeMap::new();
            visit_road_cells(a.0, a.1, b.0, b.1, radius, |chunk, bit| { *masks.entry(chunk).or_insert(0u64) |= bit; Ok(()) }).unwrap();
            masks
        };
        let has = |masks: &BTreeMap<u32, u64>, x, z| { let (c, b) = fog_bit(x, z).unwrap(); masks.get(&c).is_some_and(|m| m & b != 0) };
        let long = cells((16.0, 16.0), (528.0, 16.0), 2.0);
        assert!(has(&long, 272.0, 16.0));
        let wide = cells((4.0, 31.0), (28.0, 31.0), 2.0);
        assert!(has(&wide, 16.0, 48.0)); assert!(has(&wide, 16.0, 16.0));
        let diagonal = cells((1.0, 31.0), (31.0, 1.0), 2.0);
        assert!(!has(&diagonal, 48.0, 48.0));
        assert!(visit_road_cells(6143.0, 0.0, 6143.0, 20.0, 2.0, |_, _| Ok(())).is_err());
        assert!(visit_road_cells(0.0, 0.0, f64::NAN, 0.0, 2.0, |_, _| Ok(())).is_err());
        assert_eq!(point_segment_distance_sq(100.0, 20.0, 0.0, 0.0, 200.0, 0.0), 400.0);
    }
    #[test]
    fn irregular_callbacks_preserve_five_minute_days_without_skipping_work() {
        let mut last = 0; let mut remainder = 0; let mut steps = 0;
        let mut now = 0;
        for elapsed in [170_000, 620_000, 230_000, 780_000].into_iter().cycle().take(700) {
            now = (now + elapsed).min(300_000_000);
            let result = realm_clock_step(last, remainder, now);
            last = result.last_wall_micros; remainder = result.remainder_micros; steps += result.steps as u64;
            if now == 300_000_000 { break; }
        }
        assert_eq!(now, 300_000_000); assert_eq!(steps, 600); assert_eq!(remainder, 0);
        let late = realm_clock_step(last, remainder, now + 12_000_000);
        assert_eq!(late.steps, 4); assert_eq!(late.last_wall_micros, now + 2_000_000);
        let backwards = realm_clock_step(last, remainder, now - 1);
        assert_eq!(backwards.steps, 0); assert_eq!(backwards.last_wall_micros, last);
    }
    #[test]
    fn realm_day_is_exactly_five_real_minutes() {
        assert_eq!(120.0 / (CLOCK_NUMERATOR as f64 / CLOCK_DENOMINATOR as f64), 300.0);
    }
    #[test]
    fn fifty_towns_and_seventeen_outposts_fit_with_competition_space() {
        assert!(REGION_COLUMNS as usize * REGION_COLUMNS as usize >= MAX_PLAYERS + RESERVED_OUTPOSTS);
        for slot in 0..REGION_COLUMNS * REGION_COLUMNS {
            let (x, z) = region_center(slot);
            assert!(x.abs() + TOWN_RADIUS < WORLD_SIZE / 2.0);
            assert!(z.abs() + TOWN_RADIUS < WORLD_SIZE / 2.0);
            for other in 0..slot {
                let (ox, oz) = region_center(other);
                assert!((x - ox).hypot(z - oz) >= 2.0 * TOWN_RADIUS + 512.0);
            }
        }
    }
    #[test]
    fn negative_edges_and_invalid_positions_do_not_alias_chunks() {
        assert_eq!(world_chunk(-6144.0, -6144.0), Some(0));
        assert_eq!(world_chunk(6143.0, 6143.0), Some(2303));
        for (x, z) in [(6144.0, 0.0), (-6144.1, 0.0), (f64::NAN, 0.0), (0.0, f64::INFINITY)] { assert_eq!(world_chunk(x, z), None); }
    }
    #[test]
    fn sight_crosses_chunk_edges_without_revealing_the_world() {
        let mut masks = BTreeMap::new();
        reveal_circle(&mut masks, 0.0, 0.0, UNIT_SIGHT);
        assert_eq!(masks.len(), 4);
        let visible: u32 = masks.values().map(|m| m.count_ones()).sum();
        assert!(visible > 20 && visible < 40);
        let (chunk, bit) = fog_bit(16.0, 16.0).unwrap();
        assert_ne!(masks[&chunk] & bit, 0);
        assert!(!masks.contains_key(&world_chunk(1000.0, 1000.0).unwrap()));
    }
}
