//! Deterministic movement and combat rules for physical frontier raid agents.
//!
//! The database integration lives in `simulation::raid_agents`; keeping the
//! small hot-loop rules pure makes the contact invariant and performance easy
//! to test on the host.

pub const COMBAT_FACTION_GUARD: u8 = 0;
pub const COMBAT_FACTION_RAIDER: u8 = 1;

pub const COMBAT_STATE_ADVANCING: u8 = 0;
pub const COMBAT_STATE_FIGHTING: u8 = 1;
pub const COMBAT_STATE_LOOTING: u8 = 2;
pub const COMBAT_STATE_RETREATING: u8 = 3;
pub const COMBAT_STATE_RETURNING: u8 = 4;
pub const COMBAT_STATE_DOWNED: u8 = 5;

pub const COMBAT_TARGET_BUILDING: u8 = 0;
pub const COMBAT_TARGET_RESIDENCE: u8 = 1;
pub const COMBAT_TARGET_DELIVERY_TRIP: u8 = 2;
pub const COMBAT_TARGET_TREASURY_BUILDING: u8 = 3;
pub const COMBAT_TARGET_TREASURY_RESIDENCE: u8 = 4;

pub const GUARD_SPEED_MPS: f64 = 1.42;
pub const RAIDER_SPEED_MPS: f64 = 1.34;
pub const MELEE_RANGE_METERS: f64 = 2.15;
pub const GUARD_INTERCEPT_RANGE_METERS: f64 = 22.0;
pub const RAIDER_ENGAGE_RANGE_METERS: f64 = 14.0;
pub const HOLDING_CONTACT_RANGE_METERS: f64 = 2.8;
pub const LOOT_SECONDS: f64 = 4.0;
pub const DOWNED_LINGER_TICKS: u64 = 40;
pub const MAP_EDGE_INSET_METERS: f64 = 9.0;

pub fn raid_party_size(enemy_pressure: u8) -> u32 {
    // Mirrors the established 2.5 + pressure * 0.065 raid-strength curve,
    // while materializing whole people and retaining a strict replication cap.
    (2.5 + enemy_pressure.min(100) as f64 * 0.065)
        .ceil()
        .clamp(3.0, 12.0) as u32
}

pub fn playable_half_for_map_size(map_size: u8) -> f64 {
    match map_size {
        0 => 310.0,
        2 => 510.0,
        _ => 410.0,
    }
}

pub fn raid_entry_point(
    entropy: u64,
    target_x: f64,
    target_z: f64,
    playable_half: f64,
) -> (f64, f64) {
    let limit = (playable_half - MAP_EDGE_INSET_METERS).max(40.0);
    let target_x = finite_clamp(target_x, -limit + 1.0, limit - 1.0);
    let target_z = finite_clamp(target_z, -limit + 1.0, limit - 1.0);
    let start = (mix64(entropy) % 4) as usize;
    let candidates = [
        (target_x, -limit),
        (limit, target_z),
        (target_x, limit),
        (-limit, target_z),
    ];
    // Avoid spawning just outside a holding built close to the chosen edge.
    // Rotate deterministically until the approach has at least 90 metres.
    for offset in 0..candidates.len() {
        let candidate = candidates[(start + offset) % candidates.len()];
        if distance(candidate.0, candidate.1, target_x, target_z) >= 90.0 {
            return candidate;
        }
    }
    candidates
        .into_iter()
        .max_by(|left, right| {
            distance(left.0, left.1, target_x, target_z)
                .total_cmp(&distance(right.0, right.1, target_x, target_z))
        })
        .unwrap_or((target_x, -limit))
}

pub fn formation_spawn(
    entry_x: f64,
    entry_z: f64,
    target_x: f64,
    target_z: f64,
    index: u32,
) -> (f64, f64) {
    let (heading_x, heading_z) = normalized_direction(entry_x, entry_z, target_x, target_z);
    let across_x = -heading_z;
    let across_z = heading_x;
    let row = index / 3;
    let column = index % 3;
    let across = (column as f64 - 1.0) * 1.55;
    let behind = row as f64 * 1.55;
    (
        entry_x + across_x * across - heading_x * behind,
        entry_z + across_z * across - heading_z * behind,
    )
}

pub fn move_toward(x: f64, z: f64, target_x: f64, target_z: f64, max_distance: f64) -> (f64, f64) {
    if !max_distance.is_finite() || max_distance <= 0.0 {
        return (x, z);
    }
    let dx = target_x - x;
    let dz = target_z - z;
    let remaining = (dx * dx + dz * dz).sqrt();
    if !remaining.is_finite() || remaining <= max_distance {
        return (target_x, target_z);
    }
    let scale = max_distance / remaining;
    (x + dx * scale, z + dz * scale)
}

pub fn guard_damage(readiness: f64) -> f64 {
    20.0 + readiness.clamp(0.0, 1.0) * 8.0
}

pub fn raider_damage(enemy_pressure: u8) -> f64 {
    14.0 + enemy_pressure.min(100) as f64 * 0.055
}

pub fn guard_attack_interval(readiness: f64) -> f64 {
    1.75 - readiness.clamp(0.0, 1.0) * 0.35
}

pub fn raider_attack_interval(enemy_pressure: u8) -> f64 {
    2.05 - enemy_pressure.min(100) as f64 * 0.0035
}

pub fn per_raider_loot_fraction(total_fraction: f64, assigned_raiders: u32) -> f64 {
    if assigned_raiders == 0 || !total_fraction.is_finite() {
        return 0.0;
    }
    total_fraction.clamp(0.0, 1.0) / assigned_raiders as f64
}

pub fn distance_squared(ax: f64, az: f64, bx: f64, bz: f64) -> f64 {
    let dx = bx - ax;
    let dz = bz - az;
    dx * dx + dz * dz
}

fn distance(ax: f64, az: f64, bx: f64, bz: f64) -> f64 {
    distance_squared(ax, az, bx, bz).sqrt()
}

fn normalized_direction(from_x: f64, from_z: f64, to_x: f64, to_z: f64) -> (f64, f64) {
    let dx = to_x - from_x;
    let dz = to_z - from_z;
    let length = (dx * dx + dz * dz).sqrt();
    if !length.is_finite() || length <= 1e-9 {
        (0.0, 1.0)
    } else {
        (dx / length, dz / length)
    }
}

fn finite_clamp(value: f64, min: f64, max: f64) -> f64 {
    if value.is_finite() {
        value.clamp(min, max)
    } else {
        0.0
    }
}

fn mix64(mut value: u64) -> u64 {
    value ^= value >> 30;
    value = value.wrapping_mul(0xbf58_476d_1ce4_e5b9);
    value ^= value >> 27;
    value = value.wrapping_mul(0x94d0_49bb_1331_11eb);
    value ^ (value >> 31)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    #[test]
    fn party_size_is_pressure_scaled_and_bounded() {
        assert_eq!(raid_party_size(0), 3);
        assert_eq!(raid_party_size(50), 6);
        assert_eq!(raid_party_size(100), 9);
        assert!(raid_party_size(100) <= 12);
    }

    #[test]
    fn entry_is_deterministic_on_a_safe_playable_edge() {
        let entry = raid_entry_point(42, 250.0, 0.0, 310.0);
        assert_eq!(entry, raid_entry_point(42, 250.0, 0.0, 310.0));
        let limit = 310.0 - MAP_EDGE_INSET_METERS;
        assert!((entry.0.abs() - limit).abs() < 1e-9 || (entry.1.abs() - limit).abs() < 1e-9);
        assert!(distance(entry.0, entry.1, 250.0, 0.0) >= 90.0);
    }

    #[test]
    fn movement_never_teleports_past_contact() {
        assert_eq!(move_toward(0.0, 0.0, 10.0, 0.0, 1.5), (1.5, 0.0));
        assert_eq!(move_toward(9.5, 0.0, 10.0, 0.0, 1.5), (10.0, 0.0));
        assert_eq!(move_toward(0.0, 0.0, 10.0, 0.0, 0.0), (0.0, 0.0));
    }

    #[test]
    fn loot_is_divided_across_only_the_raiders_who_reach_the_holding() {
        assert!((per_raider_loot_fraction(0.3, 3) - 0.1).abs() < 1e-9);
        assert_eq!(per_raider_loot_fraction(0.3, 0), 0.0);
        assert_eq!(per_raider_loot_fraction(f64::NAN, 2), 0.0);
    }

    #[test]
    fn bounded_combat_math_stays_cheap() {
        let started = Instant::now();
        let mut checksum = 0.0;
        for index in 0..1_000_000_u64 {
            let (entry_x, entry_z) =
                raid_entry_point(index, 17.0, -23.0, playable_half_for_map_size(1));
            let moved = move_toward(entry_x, entry_z, 17.0, -23.0, 0.335);
            checksum += moved.0 * 1e-9 + moved.1 * 1e-9;
        }
        assert!(checksum.is_finite());
        assert!(
            started.elapsed().as_secs_f64() < 2.0,
            "one million bounded agent-policy iterations should remain comfortably sub-frame"
        );
    }
}
