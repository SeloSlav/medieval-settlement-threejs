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
pub const COMBAT_STATE_WOUNDED_RETURNING: u8 = 6;
pub const COMBAT_STATE_RECOVERING: u8 = 7;

pub const COMBAT_TARGET_BUILDING: u8 = 0;
pub const COMBAT_TARGET_RESIDENCE: u8 = 1;
pub const COMBAT_TARGET_DELIVERY_TRIP: u8 = 2;
pub const COMBAT_TARGET_TREASURY_BUILDING: u8 = 3;
pub const COMBAT_TARGET_TREASURY_RESIDENCE: u8 = 4;

pub const GUARD_SPEED_MPS: f64 = 1.42;
pub const WOUNDED_GUARD_SPEED_MPS: f64 = 0.68;
pub const RAIDER_SPEED_MPS: f64 = 1.34;
pub const RAIDER_OFFROAD_ROUTE_MULTIPLIER: f64 = 1.55;
pub const MELEE_RANGE_METERS: f64 = 2.15;
pub const GUARD_INTERCEPT_RANGE_METERS: f64 = 22.0;
pub const RAIDER_ENGAGE_RANGE_METERS: f64 = 14.0;
pub const HOLDING_CONTACT_RANGE_METERS: f64 = 2.8;
pub const LOOT_SECONDS: f64 = 4.0;
pub const DOWNED_LINGER_TICKS: u64 = 40;
pub const MAP_EDGE_INSET_METERS: f64 = 9.0;
pub const MIN_GUARD_RECOVERY_DAYS: f64 = 3.0;
pub const MAX_GUARD_RECOVERY_DAYS: f64 = 5.0;
pub const ROUTE_SHORTCUT_MARGIN_METERS: f64 = 8.0;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RouteMove {
    pub x: f64,
    pub z: f64,
    pub progress: f64,
    pub reached_end: bool,
}

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

/// Advance toward one end of a cached road route without making the route a
/// rail. A guard who broke formation to fight first rejoins the last point
/// reached, then continues along the road. Movement remains capped by
/// `max_distance`, including the off-road rejoin.
pub fn move_along_route(
    x: f64,
    z: f64,
    progress: f64,
    path_distance: f64,
    polyline: &[[f64; 2]],
    max_distance: f64,
    outbound: bool,
) -> RouteMove {
    let path_distance = path_distance.max(0.0);
    let progress = progress.clamp(0.0, path_distance);
    if polyline.len() < 2
        || path_distance <= 1e-9
        || !max_distance.is_finite()
        || max_distance <= 0.0
    {
        return RouteMove {
            x,
            z,
            progress,
            reached_end: false,
        };
    }
    let (join_x, join_z) = sample_polyline(polyline, progress);
    let join_distance = distance(x, z, join_x, join_z);
    if join_distance + 1e-9 >= max_distance {
        let (next_x, next_z) = move_toward(x, z, join_x, join_z, max_distance);
        return RouteMove {
            x: next_x,
            z: next_z,
            progress,
            reached_end: false,
        };
    }
    let route_step = (max_distance - join_distance).max(0.0);
    let target_progress = if outbound {
        (progress + route_step).min(path_distance)
    } else {
        (progress - route_step).max(0.0)
    };
    let (target_x, target_z) = sample_polyline(polyline, target_progress);
    let endpoint = if outbound {
        polyline[polyline.len() - 1]
    } else {
        polyline[0]
    };
    RouteMove {
        x: target_x,
        z: target_z,
        progress: target_progress,
        reached_end: distance_squared(target_x, target_z, endpoint[0], endpoint[1]) <= 1e-6,
    }
}

pub fn guard_breaks_route_for(
    guard_x: f64,
    guard_z: f64,
    enemy_x: f64,
    enemy_z: f64,
    same_target: bool,
    enemy_state: u8,
) -> bool {
    distance_squared(guard_x, guard_z, enemy_x, enemy_z)
        <= GUARD_INTERCEPT_RANGE_METERS * GUARD_INTERCEPT_RANGE_METERS
        || (same_target && matches!(enemy_state, COMBAT_STATE_FIGHTING | COMBAT_STATE_LOOTING))
}

/// Roads are a preference, never a compulsory maze. A combatant cuts across
/// country only when the remaining road route is materially worse after the
/// configured off-road effort penalty.
pub fn route_shortcut_is_worthwhile(
    direct_distance: f64,
    remaining_route_distance: f64,
    offroad_distance_multiplier: f64,
) -> bool {
    if !direct_distance.is_finite()
        || !remaining_route_distance.is_finite()
        || direct_distance < 0.0
        || remaining_route_distance < 0.0
    {
        return false;
    }
    let multiplier = if offroad_distance_multiplier.is_finite() {
        offroad_distance_multiplier.max(1.0)
    } else {
        1.0
    };
    direct_distance * multiplier + ROUTE_SHORTCUT_MARGIN_METERS < remaining_route_distance
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

pub fn guard_recovery_ticks(readiness: f64, ticks_per_day: u64) -> u64 {
    let readiness = if readiness.is_finite() {
        readiness.clamp(0.0, 1.0)
    } else {
        0.0
    };
    let recovery_days =
        MAX_GUARD_RECOVERY_DAYS - readiness * (MAX_GUARD_RECOVERY_DAYS - MIN_GUARD_RECOVERY_DAYS);
    (recovery_days * ticks_per_day.max(1) as f64)
        .round()
        .max(1.0) as u64
}

pub fn combat_state_blocks_guard_slot(state: u8) -> bool {
    matches!(
        state,
        COMBAT_STATE_DOWNED | COMBAT_STATE_WOUNDED_RETURNING | COMBAT_STATE_RECOVERING
    )
}

pub fn distance_squared(ax: f64, az: f64, bx: f64, bz: f64) -> f64 {
    let dx = bx - ax;
    let dz = bz - az;
    dx * dx + dz * dz
}

fn sample_polyline(polyline: &[[f64; 2]], meters: f64) -> (f64, f64) {
    if polyline.is_empty() {
        return (0.0, 0.0);
    }
    if polyline.len() == 1 || meters <= 0.0 {
        return (polyline[0][0], polyline[0][1]);
    }
    let mut remaining = meters;
    for window in polyline.windows(2) {
        let segment_length = distance(window[0][0], window[0][1], window[1][0], window[1][1]);
        if remaining <= segment_length + 1e-9 {
            let t = if segment_length <= 1e-9 {
                0.0
            } else {
                remaining / segment_length
            };
            return (
                window[0][0] + (window[1][0] - window[0][0]) * t,
                window[0][1] + (window[1][1] - window[0][1]) * t,
            );
        }
        remaining -= segment_length;
    }
    let last = polyline[polyline.len() - 1];
    (last[0], last[1])
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
    fn guards_follow_bends_and_can_rejoin_without_teleporting() {
        let route = [[0.0, 0.0], [10.0, 0.0], [10.0, 10.0]];
        let first = move_along_route(0.0, 0.0, 0.0, 20.0, &route, 6.0, true);
        assert_eq!((first.x, first.z), (6.0, 0.0));
        assert_eq!(first.progress, 6.0);
        assert!(!first.reached_end);

        let bend = move_along_route(first.x, first.z, first.progress, 20.0, &route, 6.0, true);
        assert_eq!((bend.x, bend.z), (10.0, 2.0));
        assert!(distance_squared(first.x, first.z, bend.x, bend.z) <= 36.0 + 1e-9);

        let rejoin = move_along_route(3.0, 4.0, 3.0, 20.0, &route, 1.0, true);
        assert!(distance_squared(3.0, 4.0, rejoin.x, rejoin.z) <= 1.0 + 1e-9);
        assert_eq!(rejoin.progress, 3.0);
        assert!(rejoin.z < 4.0);
    }

    #[test]
    fn return_march_uses_the_same_route_in_reverse() {
        let route = [[0.0, 0.0], [10.0, 0.0], [10.0, 10.0]];
        let returning = move_along_route(10.0, 10.0, 20.0, 20.0, &route, 4.0, false);
        assert_eq!((returning.x, returning.z), (10.0, 6.0));
        assert_eq!(returning.progress, 16.0);
        assert!(!returning.reached_end);
        let home = move_along_route(2.0, 0.0, 2.0, 20.0, &route, 4.0, false);
        assert_eq!((home.x, home.z), (0.0, 0.0));
        assert_eq!(home.progress, 0.0);
        assert!(home.reached_end);
    }

    #[test]
    fn combat_routes_are_preferences_not_rails() {
        assert!(!route_shortcut_is_worthwhile(
            100.0,
            160.0,
            RAIDER_OFFROAD_ROUTE_MULTIPLIER,
        ));
        assert!(route_shortcut_is_worthwhile(
            100.0,
            180.0,
            RAIDER_OFFROAD_ROUTE_MULTIPLIER,
        ));
        assert!(!route_shortcut_is_worthwhile(
            f64::NAN,
            180.0,
            RAIDER_OFFROAD_ROUTE_MULTIPLIER,
        ));
    }

    #[test]
    fn imminent_or_active_attacks_override_route_discipline() {
        assert!(guard_breaks_route_for(
            0.0,
            0.0,
            GUARD_INTERCEPT_RANGE_METERS,
            0.0,
            false,
            COMBAT_STATE_ADVANCING,
        ));
        assert!(guard_breaks_route_for(
            0.0,
            0.0,
            200.0,
            0.0,
            true,
            COMBAT_STATE_LOOTING,
        ));
        assert!(!guard_breaks_route_for(
            0.0,
            0.0,
            200.0,
            0.0,
            true,
            COMBAT_STATE_ADVANCING,
        ));
    }

    #[test]
    fn loot_is_divided_across_only_the_raiders_who_reach_the_holding() {
        assert!((per_raider_loot_fraction(0.3, 3) - 0.1).abs() < 1e-9);
        assert_eq!(per_raider_loot_fraction(0.3, 0), 0.0);
        assert_eq!(per_raider_loot_fraction(f64::NAN, 2), 0.0);
    }

    #[test]
    fn wounded_guards_recover_faster_when_their_company_was_ready() {
        assert_eq!(guard_recovery_ticks(0.0, 240), 1_200);
        assert_eq!(guard_recovery_ticks(0.5, 240), 960);
        assert_eq!(guard_recovery_ticks(1.0, 240), 720);
        assert_eq!(guard_recovery_ticks(f64::NAN, 240), 1_200);
    }

    #[test]
    fn only_persistent_casualty_states_block_a_future_muster_slot() {
        assert!(combat_state_blocks_guard_slot(COMBAT_STATE_DOWNED));
        assert!(combat_state_blocks_guard_slot(
            COMBAT_STATE_WOUNDED_RETURNING
        ));
        assert!(combat_state_blocks_guard_slot(COMBAT_STATE_RECOVERING));
        assert!(!combat_state_blocks_guard_slot(COMBAT_STATE_RETURNING));
        assert!(!combat_state_blocks_guard_slot(COMBAT_STATE_FIGHTING));
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

    #[test]
    fn cached_company_routes_stay_cheap_for_a_large_guard_response() {
        let route = (0..=512)
            .map(|index| [index as f64, (index % 7) as f64 * 0.1])
            .collect::<Vec<_>>();
        let path_distance = polyline_length_for_test(&route);
        let started = Instant::now();
        let mut checksum = 0.0;
        for guard in 0..36 {
            let mut x = 0.0;
            let mut z = 0.0;
            let mut progress = 0.0;
            for _ in 0..1_000 {
                let moved = move_along_route(
                    x,
                    z,
                    progress,
                    path_distance,
                    &route,
                    0.284 + guard as f64 * 1e-6,
                    true,
                );
                x = moved.x;
                z = moved.z;
                progress = if moved.reached_end {
                    0.0
                } else {
                    moved.progress
                };
                checksum += x * 1e-12 + z * 1e-12;
            }
        }
        assert!(checksum.is_finite());
        assert!(
            started.elapsed().as_secs_f64() < 2.0,
            "36 guards following a 512-segment cached route for 1,000 ticks should stay bounded"
        );
    }

    fn polyline_length_for_test(polyline: &[[f64; 2]]) -> f64 {
        polyline
            .windows(2)
            .map(|window| distance(window[0][0], window[0][1], window[1][0], window[1][1]))
            .sum()
    }
}
