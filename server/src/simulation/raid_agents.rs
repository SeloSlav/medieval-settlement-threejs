use std::collections::{HashMap, HashSet};

use spacetimedb::{Identity, ReducerContext};

use crate::balance_generated::{building_def, CALENDAR_SECONDS_PER_DAY, TICK_DT};
use crate::db::*;
use crate::raid_agent_policy::{
    combat_state_blocks_guard_slot, distance_squared, formation_spawn, guard_attack_interval,
    guard_breaks_route_for, guard_damage, guard_recovery_ticks, holding_assault_position,
    move_along_route, move_toward, nearest_emergency_guard_target, per_raider_loot_fraction,
    raid_contact_duration, raid_contact_range, raid_entry_point, raid_party_size,
    raider_attack_interval, raider_damage, refuge_assault_position, route_shortcut_is_worthwhile,
    select_guard_muster_slots, EmergencyGuardTarget, COMBAT_FACTION_GUARD, COMBAT_FACTION_RAIDER,
    COMBAT_ROAD_SPEED_MULTIPLIER, COMBAT_STATE_ADVANCING,
    COMBAT_STATE_DOWNED, COMBAT_STATE_FIGHTING, COMBAT_STATE_LOOTING, COMBAT_STATE_RECOVERING,
    COMBAT_STATE_RETREATING, COMBAT_STATE_RETURNING, COMBAT_STATE_WOUNDED_RETURNING,
    COMBAT_TARGET_BUILDING, COMBAT_TARGET_DELIVERY_TRIP, COMBAT_TARGET_RESIDENCE,
    COMBAT_TARGET_TREASURY_BUILDING, COMBAT_TARGET_TREASURY_RESIDENCE, DOWNED_LINGER_SECONDS,
    DEFAULT_BUILDING_ASSAULT_OUTER_RADIUS_METERS, GUARD_SPEED_MPS, MELEE_RANGE_METERS,
    RAIDER_ENGAGE_RANGE_METERS, RAIDER_OFFROAD_ROUTE_MULTIPLIER, RAIDER_SPEED_MPS,
    RESIDENCE_ASSAULT_OUTER_RADIUS_METERS, WOUNDED_GUARD_SPEED_MPS,
};
use crate::roads::{RoadNetwork, RoadPathRoute};
use crate::security_policy::{
    guardhouse_muster_efficiency, raid_arson_occurs, scheduled_raid_ticks,
    select_guardhouse_muster_watch, RaidPortableStores, WatchArea,
};
use crate::tables::{
    settlement_security, ActiveRaid, Building, CombatAgent, GuardMusterRoute, RaidIncursionRoute,
};

use super::delivery_trips::{deserialize_route_polyline, serialize_route_polyline};
use super::fires::{ignite_raid_target, FIRE_TARGET_BUILDING, FIRE_TARGET_RESIDENCE};
use super::reclamation::ReclamationStock;
use super::recover_stock_at;
use super::settlement_security::{plunder_raid_target_at_contact, ContactRaidPlunder};

const EPSILON: f64 = 1e-9;
const ARRIVAL_RANGE_METERS: f64 = 2.4;

struct CachedCombatPath {
    path_distance: f64,
    polyline: Vec<[f64; 2]>,
}

type GuardMusterPaths = HashMap<u64, CachedCombatPath>;
type RaiderIncursionPaths = HashMap<u64, CachedCombatPath>;

#[derive(Clone, Copy, Debug)]
pub struct LiveRaidTarget {
    pub kind: u8,
    pub id: u64,
    pub raid_anchor_building_id: u64,
    pub x: f64,
    pub z: f64,
    pub loot_fraction: f64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct LiveRaidStart {
    pub raiders: u32,
    pub guards: u32,
}

pub fn start_live_raid(
    ctx: &ReducerContext,
    owner: Identity,
    raid_id: u64,
    enemy_pressure: u8,
    world_seed: u64,
    playable_half: f64,
    targets: &[LiveRaidTarget],
    buildings: &[Building],
    towers: &[WatchArea],
    road_network: Option<&RoadNetwork>,
    fire_disabled_buildings: &HashSet<u64>,
) -> Option<LiveRaidStart> {
    if targets.is_empty() || ctx.db.active_raid().owner().find(&owner).is_some() {
        return None;
    }

    // An interrupted legacy deployment must not leave an invisible company
    // consuming a guardhouse roster when the next authoritative raid starts.
    // Persistent wounded guards are deliberately retained: their exact roster
    // slots remain unavailable until those same agents recuperate.
    for stale in ctx
        .db
        .combat_agent()
        .owner()
        .filter(&owner)
        .collect::<Vec<_>>()
    {
        if stale.faction == COMBAT_FACTION_GUARD && combat_state_blocks_guard_slot(stale.state) {
            continue;
        }
        ctx.db.combat_agent().id().delete(stale.id);
    }
    clear_guard_muster_routes(ctx, owner);
    clear_raider_incursion_routes(ctx, owner);

    let raider_count = raid_party_size(enemy_pressure);
    let primary = targets[0];
    let (entry_x, entry_z) = raid_entry_point(
        world_seed ^ raid_id ^ primary.id,
        primary.x,
        primary.z,
        playable_half,
    );
    let mut assigned_by_target = vec![0_u32; targets.len()];
    for index in 0..raider_count {
        assigned_by_target[index as usize % targets.len()] += 1;
    }
    let incursion_routes = targets
        .iter()
        .map(|target| {
            let (target_x, target_z) = if target.raid_anchor_building_id > 0 {
                refuge_assault_position(target.x, target.z, entry_x, entry_z)
            } else {
                raid_target_assault_position(
                    ctx,
                    owner,
                    target.kind,
                    target.id,
                    entry_x,
                    entry_z,
                )
                .unwrap_or((target.x, target.z))
            };
            build_incursion_route(road_network, entry_x, entry_z, target_x, target_z)
        })
        .collect::<Vec<_>>();

    ctx.db.active_raid().insert(ActiveRaid {
        owner,
        raid_id,
        started_tick: raid_id,
        enemy_pressure,
        initial_raiders: raider_count,
        initial_guards: 0,
        goods_lost: 0.0,
        wealth_lost: 0.0,
        arson_started: false,
    });

    for index in 0..raider_count {
        let target_index = index as usize % targets.len();
        let target = targets[target_index];
        let (x, z) = formation_spawn(entry_x, entry_z, primary.x, primary.z, index);
        let inserted = ctx.db.combat_agent().insert(CombatAgent {
            id: 0,
            owner,
            raid_id,
            faction: COMBAT_FACTION_RAIDER,
            source_building_id: 0,
            source_slot: index,
            target_kind: target.kind,
            target_id: target.id,
            x,
            z,
            home_x: x,
            home_z: z,
            health: 80.0 + enemy_pressure.min(100) as f64 * 0.2,
            max_health: 80.0 + enemy_pressure.min(100) as f64 * 0.2,
            readiness: enemy_pressure.min(100) as f64 / 100.0,
            state: COMBAT_STATE_ADVANCING,
            attack_cooldown: index as f64 * 0.08,
            loot_progress: 0.0,
            loot_fraction: per_raider_loot_fraction(
                target.loot_fraction,
                assigned_by_target[target_index],
            ),
            carried_loot_json: String::new(),
            raid_anchor_building_id: target.raid_anchor_building_id,
            route_progress: 0.0,
            state_changed_tick: raid_id,
        });
        let route = route_from_formation(x, z, &incursion_routes[target_index]);
        ctx.db.raid_incursion_route().insert(RaidIncursionRoute {
            combat_agent_id: inserted.id,
            owner,
            raid_id,
            path_distance: route.distance,
            route_polyline_json: serialize_route_polyline(&route.polyline),
        });
    }

    let guard_count = spawn_responding_guards(
        ctx,
        owner,
        raid_id,
        targets,
        buildings,
        towers,
        road_network,
        fire_disabled_buildings,
    );
    if let Some(mut active) = ctx.db.active_raid().owner().find(&owner) {
        active.initial_guards = guard_count;
        ctx.db.active_raid().owner().update(active);
    }
    Some(LiveRaidStart {
        raiders: raider_count,
        guards: guard_count,
    })
}

fn build_incursion_route(
    network: Option<&RoadNetwork>,
    entry_x: f64,
    entry_z: f64,
    target_x: f64,
    target_z: f64,
) -> RoadPathRoute {
    network
        .and_then(|network| {
            network.road_path_route_from_external_access(
                entry_x,
                entry_z,
                target_x,
                target_z,
                RAIDER_OFFROAD_ROUTE_MULTIPLIER,
            )
        })
        .unwrap_or_else(|| {
            let polyline = vec![[entry_x, entry_z], [target_x, target_z]];
            RoadPathRoute {
                distance: RoadNetwork::polyline_length_xz(&polyline),
                polyline,
            }
        })
}

fn route_from_formation(x: f64, z: f64, base: &RoadPathRoute) -> RoadPathRoute {
    let mut polyline = Vec::with_capacity(base.polyline.len() + 1);
    polyline.push([x, z]);
    for point in &base.polyline {
        if polyline.last().is_some_and(|previous| {
            (previous[0] - point[0]).abs() <= 1e-6 && (previous[1] - point[1]).abs() <= 1e-6
        }) {
            continue;
        }
        polyline.push(*point);
    }
    RoadPathRoute {
        distance: RoadNetwork::polyline_length_xz(&polyline),
        polyline,
    }
}

fn spawn_responding_guards(
    ctx: &ReducerContext,
    owner: Identity,
    raid_id: u64,
    targets: &[LiveRaidTarget],
    buildings: &[Building],
    towers: &[WatchArea],
    road_network: Option<&RoadNetwork>,
    fire_disabled_buildings: &HashSet<u64>,
) -> u32 {
    let watch_positions = towers
        .iter()
        .map(|tower| (tower.x, tower.z))
        .collect::<Vec<_>>();
    let watchtower_ids = towers
        .iter()
        .map(|tower| tower.source_id)
        .collect::<Vec<_>>();
    let emergency_targets = targets
        .iter()
        .map(|target| EmergencyGuardTarget {
            kind: target.kind,
            id: target.id,
            x: target.x,
            z: target.z,
        })
        .collect::<Vec<_>>();
    let unavailable_slots = unavailable_guard_slots(ctx, owner);
    let issued_polearms = issued_guard_polearms_by_building(ctx, owner);
    let mut total = 0_u32;

    for guardhouse in buildings.iter().filter(|building| {
        building.owner == owner
            && building.construction_complete
            && building.kind == "guardhouse"
            && !fire_disabled_buildings.contains(&building.id)
    }) {
        let onsite_polearms = (guardhouse.polearms
            - issued_polearms.get(&guardhouse.id).copied().unwrap_or(0.0))
            .max(0.0);
        let unavailable_here = unavailable_slots
            .iter()
            .filter_map(|(building_id, slot)| {
                (*building_id == guardhouse.id).then_some(*slot)
            })
            .collect::<Vec<_>>();
        let muster_slots = select_guard_muster_slots(
            guardhouse.assigned_labor,
            onsite_polearms,
            &unavailable_here,
        );
        if muster_slots.is_empty() || guardhouse.action_cooldown <= 0.05 {
            continue;
        }

        // A staffed watch and usable road give early warning and a cached
        // deployment route. They are an advantage, not permission for armed
        // villagers to defend themselves: an unlinked company still forms at
        // its guardhouse and immediately heads cross-country for the nearest
        // attacked holding once a live incursion begins.
        let linked_deployment = road_network.and_then(|network| {
            let distances =
                network.road_path_distances_from(guardhouse.x, guardhouse.z, &watch_positions);
            let (watch_index, muster_distance) = select_guardhouse_muster_watch(
                guardhouse.guardhouse_muster_watchtower_id,
                &watchtower_ids,
                &distances,
            )?;
            let tower = towers[watch_index];
            let target = targets
                .iter()
                .filter(|target| {
                    distance_squared(target.x, target.z, tower.x, tower.z)
                        <= tower.radius * tower.radius
                })
                .min_by(|left, right| {
                    distance_squared(left.x, left.z, tower.x, tower.z)
                        .total_cmp(&distance_squared(right.x, right.z, tower.x, tower.z))
                        .then_with(|| left.kind.cmp(&right.kind))
                        .then_with(|| left.id.cmp(&right.id))
                })
                .copied()?;
            let route = network.road_path_route(guardhouse.x, guardhouse.z, tower.x, tower.z)?;
            Some((target, muster_distance, route))
        });
        let (target, muster_distance, muster_route) =
            if let Some((target, distance, route)) = linked_deployment {
                (target, Some(distance), Some(route))
            } else {
                let Some(target_index) =
                    nearest_emergency_guard_target(guardhouse.x, guardhouse.z, &emergency_targets)
                else {
                    continue;
                };
                (targets[target_index], None, None)
            };
        let muster_readiness = guardhouse_muster_efficiency(muster_distance, 1.0);
        let readiness =
            (guardhouse.action_cooldown * (0.72 + muster_readiness * 0.28)).clamp(0.05, 1.0);
        if let Some(muster_route) = muster_route {
            ctx.db.guard_muster_route().insert(GuardMusterRoute {
                source_building_id: guardhouse.id,
                owner,
                raid_id,
                path_distance: muster_route.distance,
                route_polyline_json: serialize_route_polyline(&muster_route.polyline),
            });
        }
        for slot in muster_slots {
            let (x, z) = formation_spawn(guardhouse.x, guardhouse.z, target.x, target.z, slot);
            let max_health = 70.0 + readiness * 30.0;
            ctx.db.combat_agent().insert(CombatAgent {
                id: 0,
                owner,
                raid_id,
                faction: COMBAT_FACTION_GUARD,
                source_building_id: guardhouse.id,
                source_slot: slot,
                target_kind: target.kind,
                target_id: target.id,
                x,
                z,
                home_x: guardhouse.x,
                home_z: guardhouse.z,
                health: max_health,
                max_health,
                readiness,
                state: COMBAT_STATE_ADVANCING,
                attack_cooldown: slot as f64 * 0.06,
                loot_progress: 0.0,
                loot_fraction: 0.0,
                carried_loot_json: serde_json::to_string(&RaidPortableStores {
                    polearms: 1.0,
                    ..RaidPortableStores::default()
                })
                .unwrap_or_default(),
                raid_anchor_building_id: 0,
                route_progress: 0.0,
                state_changed_tick: raid_id,
            });
            total += 1;
        }
    }
    total
}

pub fn step_live_raids(
    ctx: &ReducerContext,
    sim_tick: u64,
    world_seed: u64,
    conflict_enabled: bool,
    elapsed_seconds: f64,
) {
    if !conflict_enabled {
        clear_all_live_raids(ctx);
        return;
    }
    if !elapsed_seconds.is_finite() || elapsed_seconds <= 0.0 {
        return;
    }

    let active_raids = ctx.db.active_raid().iter().collect::<Vec<ActiveRaid>>();
    let active_keys = active_raids
        .iter()
        .map(|raid| (raid.owner, raid.raid_id))
        .collect::<HashSet<_>>();
    for raid in active_raids {
        step_one_live_raid(
            ctx,
            raid,
            sim_tick,
            world_seed,
            elapsed_seconds,
        );
    }

    // Downed agents linger briefly for readable aftermath, after their raid
    // summary has finalized. No live hostile can survive without an ActiveRaid.
    for agent in ctx.db.combat_agent().iter().collect::<Vec<CombatAgent>>() {
        if active_keys.contains(&(agent.owner, agent.raid_id)) {
            continue;
        }
        let agent_id = agent.id;
        if agent.faction == COMBAT_FACTION_GUARD {
            if step_recovering_guard(ctx, agent, sim_tick, elapsed_seconds) {
                continue;
            }
        } else if agent.state == COMBAT_STATE_DOWNED {
            let mut lingering = agent;
            lingering.attack_cooldown =
                (lingering.attack_cooldown - elapsed_seconds).max(0.0);
            if lingering.attack_cooldown > EPSILON {
                ctx.db.combat_agent().id().update(lingering);
                continue;
            }
        }
        ctx.db.combat_agent().id().delete(agent_id);
    }
}

fn clear_all_live_raids(ctx: &ReducerContext) {
    for agent in ctx.db.combat_agent().iter().collect::<Vec<CombatAgent>>() {
        ctx.db.combat_agent().id().delete(agent.id);
    }
    for route in ctx
        .db
        .guard_muster_route()
        .iter()
        .collect::<Vec<GuardMusterRoute>>()
    {
        ctx.db
            .guard_muster_route()
            .source_building_id()
            .delete(route.source_building_id);
    }
    for route in ctx
        .db
        .raid_incursion_route()
        .iter()
        .collect::<Vec<RaidIncursionRoute>>()
    {
        ctx.db
            .raid_incursion_route()
            .combat_agent_id()
            .delete(route.combat_agent_id);
    }
    for raid in ctx.db.active_raid().iter().collect::<Vec<ActiveRaid>>() {
        ctx.db.active_raid().owner().delete(&raid.owner);
    }
}

fn load_guard_muster_paths(
    ctx: &ReducerContext,
    owner: Identity,
    raid_id: u64,
) -> GuardMusterPaths {
    ctx.db
        .guard_muster_route()
        .owner()
        .filter(&owner)
        .filter(|route| route.raid_id == raid_id && route.path_distance > EPSILON)
        .filter_map(|route| {
            deserialize_route_polyline(&route.route_polyline_json)
                .filter(|polyline| polyline.len() >= 2)
                .map(|polyline| {
                    (
                        route.source_building_id,
                        CachedCombatPath {
                            path_distance: route.path_distance,
                            polyline,
                        },
                    )
                })
        })
        .collect()
}

fn clear_guard_muster_routes(ctx: &ReducerContext, owner: Identity) {
    for route in ctx
        .db
        .guard_muster_route()
        .owner()
        .filter(&owner)
        .collect::<Vec<_>>()
    {
        ctx.db
            .guard_muster_route()
            .source_building_id()
            .delete(route.source_building_id);
    }
}

fn load_raider_incursion_paths(
    ctx: &ReducerContext,
    owner: Identity,
    raid_id: u64,
) -> RaiderIncursionPaths {
    ctx.db
        .raid_incursion_route()
        .owner()
        .filter(&owner)
        .filter(|route| route.raid_id == raid_id && route.path_distance > EPSILON)
        .filter_map(|route| {
            deserialize_route_polyline(&route.route_polyline_json)
                .filter(|polyline| polyline.len() >= 2)
                .map(|polyline| {
                    (
                        route.combat_agent_id,
                        CachedCombatPath {
                            path_distance: route.path_distance,
                            polyline,
                        },
                    )
                })
        })
        .collect()
}

fn clear_raider_incursion_routes(ctx: &ReducerContext, owner: Identity) {
    for route in ctx
        .db
        .raid_incursion_route()
        .owner()
        .filter(&owner)
        .collect::<Vec<_>>()
    {
        ctx.db
            .raid_incursion_route()
            .combat_agent_id()
            .delete(route.combat_agent_id);
    }
}

fn step_one_live_raid(
    ctx: &ReducerContext,
    active: ActiveRaid,
    sim_tick: u64,
    world_seed: u64,
    elapsed_seconds: f64,
) {
    let mut agents = ctx
        .db
        .combat_agent()
        .owner()
        .filter(&active.owner)
        .filter(|agent| agent.raid_id == active.raid_id)
        .map(|agent| (agent.id, agent))
        .collect::<HashMap<_, _>>();
    let guard_routes = load_guard_muster_paths(ctx, active.owner, active.raid_id);
    let raider_routes = load_raider_incursion_paths(ctx, active.owner, active.raid_id);
    let living_raiders = agents
        .values()
        .filter(|agent| {
            agent.faction == COMBAT_FACTION_RAIDER
                && agent.state != COMBAT_STATE_DOWNED
                && agent.health > EPSILON
        })
        .count();

    if living_raiders == 0 {
        return_guards_and_finalize(
            ctx,
            active,
            agents,
            &guard_routes,
            sim_tick,
            world_seed,
            elapsed_seconds,
        );
        return;
    }

    let snapshots = agents.values().cloned().collect::<Vec<_>>();
    let mut damage_by_agent = HashMap::<u64, f64>::new();
    let mut delete_ids = HashSet::<u64>::new();

    for agent in agents.values_mut() {
        if agent.state == COMBAT_STATE_DOWNED || agent.health <= EPSILON {
            agent.attack_cooldown = (agent.attack_cooldown - elapsed_seconds).max(0.0);
            if agent.faction == COMBAT_FACTION_RAIDER && agent.attack_cooldown <= EPSILON {
                delete_ids.insert(agent.id);
            }
            continue;
        }
        agent.attack_cooldown = (agent.attack_cooldown - elapsed_seconds).max(0.0);
        if agent.faction == COMBAT_FACTION_RAIDER {
            step_raider(
                ctx,
                &active,
                agent,
                &snapshots,
                raider_routes.get(&agent.id),
                &mut damage_by_agent,
                &mut delete_ids,
                sim_tick,
                elapsed_seconds,
            );
        } else {
            step_guard(
                agent,
                &snapshots,
                guard_routes.get(&agent.source_building_id),
                &mut damage_by_agent,
                sim_tick,
                elapsed_seconds,
            );
        }
    }

    for (target_id, damage) in damage_by_agent {
        let Some(target) = agents.get_mut(&target_id) else {
            continue;
        };
        if target.state == COMBAT_STATE_DOWNED {
            continue;
        }
        target.health = (target.health - damage.max(0.0)).max(0.0);
        if target.health <= EPSILON {
            down_agent(ctx, target, &active, sim_tick);
        }
    }

    for (id, agent) in agents {
        if delete_ids.contains(&id) {
            ctx.db.combat_agent().id().delete(id);
        } else {
            ctx.db.combat_agent().id().update(agent);
        }
    }
}

fn step_raider(
    ctx: &ReducerContext,
    active: &ActiveRaid,
    agent: &mut CombatAgent,
    snapshots: &[CombatAgent],
    incursion_route: Option<&CachedCombatPath>,
    damage_by_agent: &mut HashMap<u64, f64>,
    delete_ids: &mut HashSet<u64>,
    sim_tick: u64,
    elapsed_seconds: f64,
) {
    if agent.state == COMBAT_STATE_RETREATING {
        if distance_squared(agent.x, agent.z, agent.home_x, agent.home_z)
            <= ARRIVAL_RANGE_METERS * ARRIVAL_RANGE_METERS
        {
            delete_ids.insert(agent.id);
            return;
        }
        if let Some(route) = incursion_route {
            let direct_home_distance =
                distance_squared(agent.x, agent.z, agent.home_x, agent.home_z).sqrt();
            let remaining_route_distance = agent.route_progress.clamp(0.0, route.path_distance);
            if !route_shortcut_is_worthwhile(
                direct_home_distance,
                remaining_route_distance,
                RAIDER_OFFROAD_ROUTE_MULTIPLIER,
            ) && agent.route_progress > EPSILON
            {
                let route_move = move_along_route(
                    agent.x,
                    agent.z,
                    agent.route_progress,
                    route.path_distance,
                    &route.polyline,
                    RAIDER_SPEED_MPS * COMBAT_ROAD_SPEED_MULTIPLIER * elapsed_seconds,
                    false,
                );
                agent.x = route_move.x;
                agent.z = route_move.z;
                agent.route_progress = route_move.progress;
                // Spend at most this heartbeat's movement budget. If the edge
                // lies beyond the cached road endpoint, cross-country escape
                // begins on the next replicated update.
                return;
            }
        }
        (agent.x, agent.z) = move_toward(
            agent.x,
            agent.z,
            agent.home_x,
            agent.home_z,
            RAIDER_SPEED_MPS * elapsed_seconds,
        );
        return;
    }

    if let Some(defender) = nearest_enemy_within(
        agent,
        snapshots,
        COMBAT_FACTION_GUARD,
        RAIDER_ENGAGE_RANGE_METERS,
        false,
    ) {
        agent.loot_progress = 0.0;
        engage_agent(
            agent,
            defender,
            RAIDER_SPEED_MPS,
            raider_damage(active.enemy_pressure),
            raider_attack_interval(active.enemy_pressure),
            damage_by_agent,
            sim_tick,
            elapsed_seconds,
        );
        return;
    }

    let Some((target_x, target_z, active_raid_anchor_id)) = raid_agent_target_position(ctx, agent)
    else {
        agent.state = COMBAT_STATE_RETREATING;
        agent.state_changed_tick = sim_tick;
        return;
    };
    let contact_distance = distance_squared(agent.x, agent.z, target_x, target_z);
    let contact_range = raid_contact_range(active_raid_anchor_id, agent.target_kind);
    if contact_distance > contact_range * contact_range {
        agent.state = COMBAT_STATE_ADVANCING;
        agent.loot_progress = 0.0;
        if let Some(route) = incursion_route {
            let direct_target_distance = contact_distance.sqrt();
            let remaining_route_distance = (route.path_distance - agent.route_progress).max(0.0);
            if route_shortcut_is_worthwhile(
                direct_target_distance,
                remaining_route_distance,
                RAIDER_OFFROAD_ROUTE_MULTIPLIER,
            ) {
                // Mark the outbound route complete. If the target moved away
                // from its cached endpoint, retreat can still rejoin that
                // endpoint or take another worthwhile cross-country shortcut.
                agent.route_progress = route.path_distance;
            } else if agent.route_progress + EPSILON < route.path_distance {
                let route_move = move_along_route(
                    agent.x,
                    agent.z,
                    agent.route_progress,
                    route.path_distance,
                    &route.polyline,
                    RAIDER_SPEED_MPS * COMBAT_ROAD_SPEED_MULTIPLIER * elapsed_seconds,
                    true,
                );
                agent.x = route_move.x;
                agent.z = route_move.z;
                agent.route_progress = route_move.progress;
                // Do not spend the same heartbeat's movement budget twice
                // when the road endpoint is reached partway through it.
                return;
            }
        }
        (agent.x, agent.z) = move_toward(
            agent.x,
            agent.z,
            target_x,
            target_z,
            RAIDER_SPEED_MPS * elapsed_seconds,
        );
        return;
    }

    agent.state = COMBAT_STATE_LOOTING;
    agent.loot_progress += elapsed_seconds;
    if agent.loot_progress + EPSILON < raid_contact_duration(active_raid_anchor_id) {
        return;
    }
    let plunder = plunder_raid_target_at_contact(
        ctx,
        agent.owner,
        agent.target_kind,
        agent.target_id,
        agent.loot_fraction,
    );
    record_contact_plunder(ctx, active, agent, plunder, sim_tick);
    agent.state = COMBAT_STATE_RETREATING;
    agent.state_changed_tick = sim_tick;
    agent.loot_progress = 0.0;
}

fn step_guard(
    agent: &mut CombatAgent,
    snapshots: &[CombatAgent],
    muster_route: Option<&CachedCombatPath>,
    damage_by_agent: &mut HashMap<u64, f64>,
    sim_tick: u64,
    elapsed_seconds: f64,
) {
    let emergency_enemy = snapshots
        .iter()
        .filter(|candidate| {
            candidate.faction == COMBAT_FACTION_RAIDER
                && candidate.state != COMBAT_STATE_DOWNED
                && candidate.health > EPSILON
                && guard_breaks_route_for(
                    agent.x,
                    agent.z,
                    candidate.x,
                    candidate.z,
                    candidate.target_kind == agent.target_kind
                        && candidate.target_id == agent.target_id,
                    candidate.state,
                )
        })
        .min_by(|left, right| {
            distance_squared(agent.x, agent.z, left.x, left.z)
                .total_cmp(&distance_squared(agent.x, agent.z, right.x, right.z))
                .then_with(|| left.id.cmp(&right.id))
        });
    if let Some(enemy) = emergency_enemy {
        engage_agent(
            agent,
            enemy,
            GUARD_SPEED_MPS,
            guard_damage(agent.readiness),
            guard_attack_interval(agent.readiness),
            damage_by_agent,
            sim_tick,
            elapsed_seconds,
        );
        return;
    }

    if let Some(route) = muster_route {
        if agent.route_progress + EPSILON < route.path_distance {
            let route_move = move_along_route(
                agent.x,
                agent.z,
                agent.route_progress,
                route.path_distance,
                &route.polyline,
                GUARD_SPEED_MPS * COMBAT_ROAD_SPEED_MULTIPLIER * elapsed_seconds,
                true,
            );
            agent.x = route_move.x;
            agent.z = route_move.z;
            agent.route_progress = route_move.progress;
            agent.state = COMBAT_STATE_ADVANCING;
            // Contact pursuit begins next heartbeat if this step reaches the
            // post, preserving one speed budget per replicated update.
            return;
        }
    }

    let enemy = nearest_enemy_within(agent, snapshots, COMBAT_FACTION_RAIDER, f64::INFINITY, true)
        .or_else(|| {
            nearest_enemy_within(
                agent,
                snapshots,
                COMBAT_FACTION_RAIDER,
                f64::INFINITY,
                false,
            )
        });
    let Some(enemy) = enemy else {
        return;
    };
    engage_agent(
        agent,
        enemy,
        GUARD_SPEED_MPS,
        guard_damage(agent.readiness),
        guard_attack_interval(agent.readiness),
        damage_by_agent,
        sim_tick,
        elapsed_seconds,
    );
}

fn nearest_enemy_within<'a>(
    agent: &CombatAgent,
    snapshots: &'a [CombatAgent],
    faction: u8,
    max_distance: f64,
    require_same_target: bool,
) -> Option<&'a CombatAgent> {
    let max_distance_sq = max_distance * max_distance;
    snapshots
        .iter()
        .filter(|candidate| {
            candidate.faction == faction
                && candidate.state != COMBAT_STATE_DOWNED
                && candidate.health > EPSILON
                && (!require_same_target
                    || (candidate.target_kind == agent.target_kind
                        && candidate.target_id == agent.target_id))
        })
        .filter_map(|candidate| {
            let distance = distance_squared(agent.x, agent.z, candidate.x, candidate.z);
            (distance <= max_distance_sq).then_some((candidate, distance))
        })
        .min_by(|(left, left_distance), (right, right_distance)| {
            left_distance
                .total_cmp(right_distance)
                .then_with(|| left.id.cmp(&right.id))
        })
        .map(|(candidate, _)| candidate)
}

fn engage_agent(
    agent: &mut CombatAgent,
    enemy: &CombatAgent,
    speed: f64,
    damage: f64,
    attack_interval: f64,
    damage_by_agent: &mut HashMap<u64, f64>,
    sim_tick: u64,
    elapsed_seconds: f64,
) {
    let distance = distance_squared(agent.x, agent.z, enemy.x, enemy.z);
    if distance <= MELEE_RANGE_METERS * MELEE_RANGE_METERS {
        if agent.state != COMBAT_STATE_FIGHTING {
            agent.state_changed_tick = sim_tick;
        }
        agent.state = COMBAT_STATE_FIGHTING;
        if agent.attack_cooldown <= EPSILON {
            *damage_by_agent.entry(enemy.id).or_insert(0.0) += damage;
            agent.attack_cooldown = attack_interval;
        }
        return;
    }
    agent.state = COMBAT_STATE_ADVANCING;
    (agent.x, agent.z) = move_toward(
        agent.x,
        agent.z,
        enemy.x,
        enemy.z,
        speed * elapsed_seconds,
    );
}

fn record_contact_plunder(
    ctx: &ReducerContext,
    active: &ActiveRaid,
    agent: &mut CombatAgent,
    plunder: ContactRaidPlunder,
    sim_tick: u64,
) {
    if plunder.goods_lost > EPSILON || plunder.wealth_lost > EPSILON {
        agent.carried_loot_json = serde_json::to_string(&plunder.carried).unwrap_or_default();
    }
    let Some(mut latest) = ctx.db.active_raid().owner().find(&active.owner) else {
        return;
    };
    latest.goods_lost += plunder.goods_lost;
    latest.wealth_lost += plunder.wealth_lost;

    if !latest.arson_started
        && (plunder.goods_lost + plunder.wealth_lost) > EPSILON
        && raid_arson_occurs(
            latest.enemy_pressure,
            0.0,
            latest.raid_id ^ agent.id ^ agent.target_id,
        )
    {
        let fire_target = if agent.raid_anchor_building_id > 0 {
            ctx.db
                .building()
                .id()
                .find(&agent.raid_anchor_building_id)
                .filter(|building| {
                    building.owner == agent.owner && building.kind == "palisaded_refuge"
                })
                .map(|building| (FIRE_TARGET_BUILDING, building.id))
        } else {
            match agent.target_kind {
                COMBAT_TARGET_BUILDING | COMBAT_TARGET_TREASURY_BUILDING => {
                    Some((FIRE_TARGET_BUILDING, agent.target_id))
                }
                COMBAT_TARGET_RESIDENCE | COMBAT_TARGET_TREASURY_RESIDENCE => {
                    Some((FIRE_TARGET_RESIDENCE, agent.target_id))
                }
                COMBAT_TARGET_DELIVERY_TRIP => None,
                _ => None,
            }
        };
        latest.arson_started = fire_target.is_some_and(|(kind, target_id)| {
            ignite_raid_target(ctx, agent.owner, kind, target_id, sim_tick)
        });
    }
    ctx.db.active_raid().owner().update(latest);
}

fn raid_agent_target_position(
    ctx: &ReducerContext,
    agent: &CombatAgent,
) -> Option<(f64, f64, u64)> {
    if agent.raid_anchor_building_id > 0 {
        if let Some(anchor) = ctx
            .db
            .building()
            .id()
            .find(&agent.raid_anchor_building_id)
            .filter(|building| {
                building.owner == agent.owner
                    && building.construction_complete
                    && building.kind == "palisaded_refuge"
            })
        {
            let (assault_x, assault_z) =
                refuge_assault_position(anchor.x, anchor.z, agent.home_x, agent.home_z);
            return Some((assault_x, assault_z, anchor.id));
        }
    }
    raid_target_assault_position(
        ctx,
        agent.owner,
        agent.target_kind,
        agent.target_id,
        agent.home_x,
        agent.home_z,
    )
    .map(|(x, z)| (x, z, 0))
}

fn raid_target_assault_position(
    ctx: &ReducerContext,
    owner: Identity,
    target_kind: u8,
    target_id: u64,
    approach_x: f64,
    approach_z: f64,
) -> Option<(f64, f64)> {
    match target_kind {
        COMBAT_TARGET_BUILDING | COMBAT_TARGET_TREASURY_BUILDING => {
            let building = ctx
                .db
                .building()
                .id()
                .find(&target_id)
                .filter(|building| building.owner == owner)?;
            let outer_radius = building_def(&building.kind)
                .map(|definition| definition.pick_radius)
                .unwrap_or(DEFAULT_BUILDING_ASSAULT_OUTER_RADIUS_METERS);
            Some(holding_assault_position(
                building.x,
                building.z,
                approach_x,
                approach_z,
                outer_radius,
            ))
        }
        COMBAT_TARGET_RESIDENCE | COMBAT_TARGET_TREASURY_RESIDENCE => {
            let residence = ctx
                .db
                .residence()
                .id()
                .find(&target_id)
                .filter(|residence| residence.owner == owner)?;
            Some(holding_assault_position(
                residence.x,
                residence.z,
                approach_x,
                approach_z,
                RESIDENCE_ASSAULT_OUTER_RADIUS_METERS,
            ))
        }
        COMBAT_TARGET_DELIVERY_TRIP => ctx
            .db
            .delivery_trip()
            .id()
            .find(&target_id)
            .filter(|trip| trip.owner == owner)
            .map(|trip| (trip.x, trip.z)),
        _ => None,
    }
}

fn down_agent(ctx: &ReducerContext, agent: &mut CombatAgent, active: &ActiveRaid, sim_tick: u64) {
    agent.health = 0.0;
    agent.state = COMBAT_STATE_DOWNED;
    agent.state_changed_tick = sim_tick;
    agent.attack_cooldown = DOWNED_LINGER_SECONDS;
    agent.loot_progress = 0.0;
    if agent.faction != COMBAT_FACTION_RAIDER || agent.carried_loot_json.is_empty() {
        return;
    }
    let Ok(carried) = serde_json::from_str::<RaidPortableStores>(&agent.carried_loot_json) else {
        return;
    };
    let recovered = recover_stock_at(
        ctx,
        agent.owner,
        agent.x,
        agent.z,
        reclamation_from_raid_stores(carried),
    )
    .unwrap_or(false);
    if !recovered {
        return;
    }
    agent.carried_loot_json.clear();
    if let Some(mut latest) = ctx.db.active_raid().owner().find(&active.owner) {
        latest.goods_lost = (latest.goods_lost - carried.goods_amount()).max(0.0);
        latest.wealth_lost = (latest.wealth_lost - carried.gold.max(0.0)).max(0.0);
        ctx.db.active_raid().owner().update(latest);
    }
}

fn return_guards_and_finalize(
    ctx: &ReducerContext,
    active: ActiveRaid,
    mut agents: HashMap<u64, CombatAgent>,
    guard_routes: &GuardMusterPaths,
    sim_tick: u64,
    world_seed: u64,
    elapsed_seconds: f64,
) {
    let mut guards_still_returning = 0_u32;
    for agent in agents.values_mut() {
        if agent.faction != COMBAT_FACTION_GUARD {
            if agent.state == COMBAT_STATE_DOWNED {
                agent.attack_cooldown =
                    (agent.attack_cooldown - elapsed_seconds).max(0.0);
                if agent.attack_cooldown > EPSILON {
                    ctx.db.combat_agent().id().update(agent.clone());
                    continue;
                }
            }
            if agent.state != COMBAT_STATE_DOWNED || agent.attack_cooldown <= EPSILON {
                ctx.db.combat_agent().id().delete(agent.id);
            }
            continue;
        }

        if agent.state == COMBAT_STATE_DOWNED || agent.health <= EPSILON {
            agent.attack_cooldown = (agent.attack_cooldown - elapsed_seconds).max(0.0);
            if agent.attack_cooldown > EPSILON {
                guards_still_returning += 1;
                ctx.db.combat_agent().id().update(agent.clone());
                continue;
            }
            agent.state = COMBAT_STATE_WOUNDED_RETURNING;
            agent.state_changed_tick = sim_tick;
            agent.health = 1.0;
        }

        if agent.state == COMBAT_STATE_WOUNDED_RETURNING {
            guards_still_returning += 1;
            if distance_squared(agent.x, agent.z, agent.home_x, agent.home_z)
                <= ARRIVAL_RANGE_METERS * ARRIVAL_RANGE_METERS
            {
                agent.x = agent.home_x;
                agent.z = agent.home_z;
                agent.state = COMBAT_STATE_RECOVERING;
                agent.state_changed_tick = sim_tick;
                // The wounded villager remains unavailable, but their weapon
                // is physically back on the guardhouse rack for the company.
                agent.carried_loot_json.clear();
            } else {
                move_guard_home(
                    agent,
                    guard_routes.get(&agent.source_building_id),
                    WOUNDED_GUARD_SPEED_MPS,
                    elapsed_seconds,
                );
            }
            ctx.db.combat_agent().id().update(agent.clone());
            continue;
        }

        if agent.state == COMBAT_STATE_RECOVERING {
            continue;
        }

        if distance_squared(agent.x, agent.z, agent.home_x, agent.home_z)
            <= ARRIVAL_RANGE_METERS * ARRIVAL_RANGE_METERS
        {
            ctx.db.combat_agent().id().delete(agent.id);
            continue;
        }
        guards_still_returning += 1;
        agent.state = COMBAT_STATE_RETURNING;
        move_guard_home(
            agent,
            guard_routes.get(&agent.source_building_id),
            GUARD_SPEED_MPS,
            elapsed_seconds,
        );
        ctx.db.combat_agent().id().update(agent.clone());
    }
    if guards_still_returning > 0 {
        return;
    }

    let Some(mut security) = ctx.db.settlement_security().owner().find(&active.owner) else {
        clear_guard_muster_routes(ctx, active.owner);
        clear_raider_incursion_routes(ctx, active.owner);
        ctx.db.active_raid().owner().delete(&active.owner);
        return;
    };
    let latest = ctx
        .db
        .active_raid()
        .owner()
        .find(&active.owner)
        .unwrap_or(active);
    security.last_raid_tick = sim_tick;
    security.last_goods_lost = latest.goods_lost;
    security.last_wealth_lost = latest.wealth_lost;
    security.last_outcome = if latest.arson_started {
        3
    } else if latest.goods_lost + latest.wealth_lost > EPSILON {
        2
    } else {
        1
    };
    let ticks_per_day = (CALENDAR_SECONDS_PER_DAY / TICK_DT).round() as u64;
    security.next_raid_tick = sim_tick.saturating_add(scheduled_raid_ticks(
        latest.enemy_pressure,
        ticks_per_day,
        world_seed ^ sim_tick ^ latest.raid_id,
        false,
    ));
    security.threat = 0.0;
    ctx.db.settlement_security().owner().update(security);
    clear_guard_muster_routes(ctx, latest.owner);
    clear_raider_incursion_routes(ctx, latest.owner);
    ctx.db.active_raid().owner().delete(&latest.owner);
}

fn move_guard_home(
    agent: &mut CombatAgent,
    muster_route: Option<&CachedCombatPath>,
    speed_mps: f64,
    elapsed_seconds: f64,
) {
    if let Some(route) = muster_route {
        let route_move = move_along_route(
            agent.x,
            agent.z,
            agent.route_progress,
            route.path_distance,
            &route.polyline,
            speed_mps * COMBAT_ROAD_SPEED_MULTIPLIER * elapsed_seconds,
            false,
        );
        agent.x = route_move.x;
        agent.z = route_move.z;
        agent.route_progress = route_move.progress;
        return;
    }
    (agent.x, agent.z) = move_toward(
        agent.x,
        agent.z,
        agent.home_x,
        agent.home_z,
        speed_mps * elapsed_seconds,
    );
}

fn step_recovering_guard(
    ctx: &ReducerContext,
    mut agent: CombatAgent,
    sim_tick: u64,
    elapsed_seconds: f64,
) -> bool {
    if agent.state == COMBAT_STATE_DOWNED {
        agent.attack_cooldown = (agent.attack_cooldown - elapsed_seconds).max(0.0);
        if agent.attack_cooldown > EPSILON {
            ctx.db.combat_agent().id().update(agent);
            return true;
        }
        agent.state = COMBAT_STATE_WOUNDED_RETURNING;
        agent.state_changed_tick = sim_tick;
        agent.health = 1.0;
    }
    if agent.state == COMBAT_STATE_WOUNDED_RETURNING {
        if distance_squared(agent.x, agent.z, agent.home_x, agent.home_z)
            <= ARRIVAL_RANGE_METERS * ARRIVAL_RANGE_METERS
        {
            agent.x = agent.home_x;
            agent.z = agent.home_z;
            agent.state = COMBAT_STATE_RECOVERING;
            agent.state_changed_tick = sim_tick;
            // This reconnect/interrupted-raid path obeys the same physical
            // equipment invariant as normal raid finalization: a wounded
            // carrier returns the issued weapon to the rack only at home.
            agent.carried_loot_json.clear();
        } else {
            (agent.x, agent.z) = move_toward(
                agent.x,
                agent.z,
                agent.home_x,
                agent.home_z,
                WOUNDED_GUARD_SPEED_MPS * elapsed_seconds,
            );
        }
        ctx.db.combat_agent().id().update(agent);
        return true;
    }
    if agent.state != COMBAT_STATE_RECOVERING {
        return false;
    }
    let ticks_per_day = (CALENDAR_SECONDS_PER_DAY / TICK_DT).round() as u64;
    if sim_tick.saturating_sub(agent.state_changed_tick)
        >= guard_recovery_ticks(agent.readiness, ticks_per_day)
    {
        return false;
    }
    true
}

pub(super) fn unavailable_guard_slots(
    ctx: &ReducerContext,
    owner: Identity,
) -> HashSet<(u64, u32)> {
    ctx.db
        .combat_agent()
        .owner()
        .filter(&owner)
        .filter(|agent| {
            agent.faction == COMBAT_FACTION_GUARD
                && combat_state_blocks_guard_slot(agent.state)
                && agent.source_building_id > 0
        })
        .map(|agent| (agent.source_building_id, agent.source_slot))
        .collect()
}

pub(super) fn issued_guard_polearms_by_building(
    ctx: &ReducerContext,
    owner: Identity,
) -> HashMap<u64, f64> {
    let mut issued = HashMap::new();
    for agent in ctx
        .db
        .combat_agent()
        .owner()
        .filter(&owner)
        .filter(|agent| {
            agent.faction == COMBAT_FACTION_GUARD
                && agent.source_building_id > 0
                && !agent.carried_loot_json.is_empty()
        })
    {
        let Ok(stores) = serde_json::from_str::<RaidPortableStores>(&agent.carried_loot_json)
        else {
            continue;
        };
        if stores.polearms.is_finite() && stores.polearms > 0.0 {
            *issued.entry(agent.source_building_id).or_insert(0.0) += stores.polearms;
        }
    }
    issued
}

fn reclamation_from_raid_stores(stores: RaidPortableStores) -> ReclamationStock {
    ReclamationStock {
        timber: stores.timber,
        firewood: stores.firewood,
        food: stores.food,
        grain: stores.grain,
        flour: stores.flour,
        ale: stores.ale,
        preserved_food: stores.preserved_food,
        honey: stores.honey,
        wine: stores.wine,
        ironwork: stores.ironwork,
        polearms: stores.polearms,
        wool: stores.wool,
        cloth: stores.cloth,
        gold: stores.gold,
        barley: stores.barley,
        malt: stores.malt,
        flax: stores.flax,
        ..ReclamationStock::default()
    }
}
