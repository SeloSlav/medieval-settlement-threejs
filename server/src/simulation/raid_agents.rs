use std::cell::RefCell;
use std::collections::{HashMap, HashSet};

use spacetimedb::{Identity, ReducerContext};

use crate::balance_generated::{building_def, CALENDAR_SECONDS_PER_DAY, TICK_DT};
use crate::db::*;
use crate::military_policy::is_player_military_faction;
use crate::raid_agent_policy::{
    combat_state_blocks_guard_slot, combatant_morale_strength, distance_squared, formation_spawn,
    guard_attack_interval, guard_breaks_route_for, guard_damage, guard_recovery_ticks,
    holding_assault_position, move_along_route, move_toward, ottoman_raider_damage_multiplier,
    ottoman_raider_health_multiplier, ottoman_raider_is_ranged, ottoman_raider_speed,
    per_raider_loot_fraction, raid_contact_duration, raid_contact_range, raid_entry_point,
    raid_party_size, raider_attack_interval, raider_company_should_rout, raider_damage,
    refuge_assault_position, route_shortcut_is_worthwhile,
    route_shortcut_via_endpoint_is_worthwhile, RouteMove, COMBAT_CROSS_COUNTRY_ROUTE_MULTIPLIER,
    COMBAT_FACTION_GUARD, COMBAT_FACTION_RAIDER, COMBAT_ROAD_SPEED_MULTIPLIER,
    COMBAT_STATE_ADVANCING, COMBAT_STATE_DOWNED, COMBAT_STATE_FIGHTING, COMBAT_STATE_HOLDING,
    COMBAT_STATE_LOOTING, COMBAT_STATE_MUSTERING, COMBAT_STATE_RECOVERING, COMBAT_STATE_RETREATING,
    COMBAT_STATE_RETURNING, COMBAT_STATE_WOUNDED_RETURNING, COMBAT_TARGET_BUILDING,
    COMBAT_TARGET_DELIVERY_TRIP, COMBAT_TARGET_RESIDENCE, COMBAT_TARGET_TREASURY_BUILDING,
    COMBAT_TARGET_TREASURY_RESIDENCE, COMBAT_WADING_SPEED_MULTIPLIER,
    DEFAULT_BUILDING_ASSAULT_OUTER_RADIUS_METERS, DOWNED_LINGER_SECONDS, GUARD_SPEED_MPS,
    MELEE_RANGE_METERS, RAIDER_ENGAGE_RANGE_METERS, RESIDENCE_ASSAULT_OUTER_RADIUS_METERS,
    WOUNDED_GUARD_SPEED_MPS,
};
use crate::resource_units::whole_units;
use crate::roads::{RoadNetwork, RoadPathRoute};
use crate::security_policy::{raid_arson_occurs, scheduled_raid_ticks, RaidPortableStores};
use crate::tables::{
    settlement_security, ActiveRaid, CombatAgent, Corpse, GuardMusterRoute, RaidIncursionRoute,
};

use super::delivery_trips::{deserialize_route_polyline, serialize_route_polyline};
use super::fires::{ignite_raid_target, FIRE_TARGET_BUILDING, FIRE_TARGET_RESIDENCE};
#[cfg(test)]
use super::military_steering::ranged_firing_line_goal;
use super::military_steering::{
    melee_engagement_goal, next_dense_engagement_rank, raider_ranged_firing_line_goal,
    CombatSteeringGrid, EngagementRankKey, SteeringBody,
};
use super::reclamation::ReclamationStock;
use super::recover_stock_at;
use super::settlement_security::{plunder_raid_target_at_contact, ContactRaidPlunder};
use super::SharedRoadNetworks;

const EPSILON: f64 = 1e-9;
const ARRIVAL_RANGE_METERS: f64 = 2.4;
const GUARD_TARGET_ACQUISITION_METERS: f64 = 128.0;

thread_local! {
    static RAID_TARGET_GRID: RefCell<CombatSteeringGrid> =
        RefCell::new(CombatSteeringGrid::default());
    static RAID_RANGED_FRAMES: RefCell<Vec<RaiderRangedFrame>> =
        RefCell::new(Vec::new());
    static RAID_ENGAGEMENT_SCRATCH: RefCell<RaidEngagementScratch> =
        RefCell::new(RaidEngagementScratch::default());
}

#[derive(Default)]
struct RaidEngagementScratch {
    stable_order: Vec<usize>,
    rank_counts: HashMap<EngagementRankKey, usize>,
}

struct CachedCombatPath {
    path_distance: f64,
    polyline: Vec<[f64; 2]>,
}

type GuardMusterPaths = HashMap<u64, CachedCombatPath>;
type RaiderIncursionPaths = HashMap<u64, CachedCombatPath>;

/// One missile-line reference shared by every ranged rank in an Ottoman
/// warband. Individual soldiers may damage different nearby opponents, but
/// their movement is authored against this common centroid and enemy anchor
/// so a spread enemy front cannot twist the company into unrelated lines.
#[derive(Clone, Copy, Debug)]
pub(crate) struct RaiderRangedFrame {
    pub owner: Identity,
    pub raid_id: u64,
    pub source_x: f64,
    pub source_z: f64,
    pub target_x: f64,
    pub target_z: f64,
    pub member_count: usize,
}

impl RaiderRangedFrame {
    pub(crate) fn matches(self, agent: &CombatAgent) -> bool {
        self.owner == agent.owner && self.raid_id == agent.raid_id
    }

    pub(crate) fn goal(self, source_slot: u32, strike_range: f64) -> (f64, f64) {
        raider_ranged_firing_line_goal(
            source_slot,
            self.member_count.max(1),
            self.source_x,
            self.source_z,
            self.target_x,
            self.target_z,
            strike_range,
        )
    }
}

/// Reuses caller-owned storage and performs only one bounded group scan per
/// raid, rather than rebuilding a target frame for every ranged soldier.
pub(crate) fn collect_raider_ranged_frames(
    agents: &[CombatAgent],
    frames: &mut Vec<RaiderRangedFrame>,
) {
    frames.clear();
    for agent in agents.iter().filter(|agent| {
        agent.faction == COMBAT_FACTION_RAIDER
            && ottoman_raider_is_ranged(agent.source_slot)
            && agent.state != COMBAT_STATE_DOWNED
            && agent.health > EPSILON
    }) {
        if let Some(frame) = frames
            .iter_mut()
            .find(|frame| frame.owner == agent.owner && frame.raid_id == agent.raid_id)
        {
            frame.source_x += agent.x;
            frame.source_z += agent.z;
            frame.member_count += 1;
        } else {
            frames.push(RaiderRangedFrame {
                owner: agent.owner,
                raid_id: agent.raid_id,
                source_x: agent.x,
                source_z: agent.z,
                target_x: agent.x,
                target_z: agent.z,
                member_count: 1,
            });
        }
    }

    for frame in frames {
        frame.source_x /= frame.member_count as f64;
        frame.source_z /= frame.member_count as f64;

        // The lowest stable ranged rank owns target retention for the shared
        // line. If that target disappeared, choose the closest live defender to
        // the company centroid with an id tie-break, once for the whole raid.
        let retained_target_id = agents
            .iter()
            .filter(|agent| {
                frame.matches(agent)
                    && agent.faction == COMBAT_FACTION_RAIDER
                    && ottoman_raider_is_ranged(agent.source_slot)
                    && agent.state != COMBAT_STATE_DOWNED
                    && agent.health > EPSILON
            })
            .min_by_key(|agent| agent.id)
            .map_or(0, |agent| agent.engagement_target_id);
        let retained = (retained_target_id != 0)
            .then(|| {
                agents.iter().find(|candidate| {
                    candidate.id == retained_target_id
                        && candidate.owner == frame.owner
                        && (candidate.faction == COMBAT_FACTION_GUARD
                            || is_player_military_faction(candidate.faction))
                        && candidate.state != COMBAT_STATE_DOWNED
                        && candidate.health > EPSILON
                })
            })
            .flatten();
        let target = retained.or_else(|| {
            agents
                .iter()
                .filter(|candidate| {
                    candidate.owner == frame.owner
                        && ((candidate.raid_id == frame.raid_id
                            && candidate.faction == COMBAT_FACTION_GUARD)
                            || is_player_military_faction(candidate.faction))
                        && candidate.state != COMBAT_STATE_DOWNED
                        && candidate.health > EPSILON
                })
                .min_by(|left, right| {
                    distance_squared(frame.source_x, frame.source_z, left.x, left.z)
                        .total_cmp(&distance_squared(
                            frame.source_x,
                            frame.source_z,
                            right.x,
                            right.z,
                        ))
                        .then_with(|| left.id.cmp(&right.id))
                })
        });
        if let Some(target) = target {
            frame.target_x = target.x;
            frame.target_z = target.z;
        }
    }
}

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
    warned_raid_id: Option<u64>,
    enemy_pressure: u8,
    world_seed: u64,
    playable_half: f64,
    planned_entry: Option<(f64, f64)>,
    targets: &[LiveRaidTarget],
    road_network: Option<&RoadNetwork>,
) -> Option<LiveRaidStart> {
    if targets.is_empty() || ctx.db.active_raid().owner().find(&owner).is_some() {
        return None;
    }

    // Preserve the guards who physically answered this warning. Every other
    // fit legacy deployment is cleared so it cannot invisibly consume a roster
    // slot when the authoritative raid begins. Wounded guards retain their
    // exact slots until those same agents recuperate.
    let mut warned_guards = Vec::new();
    for stale in ctx
        .db
        .combat_agent()
        .owner()
        .filter(&owner)
        .collect::<Vec<_>>()
    {
        // Persistent bandits and recruited military companies are not legacy
        // raid-company rows and must survive the start of an Ottoman raid.
        if stale.faction >= 2 {
            continue;
        }
        if stale.faction == COMBAT_FACTION_GUARD && combat_state_blocks_guard_slot(stale.state) {
            continue;
        }
        if stale.faction == COMBAT_FACTION_GUARD
            && warned_raid_id == Some(stale.raid_id)
            && matches!(stale.state, COMBAT_STATE_MUSTERING | COMBAT_STATE_HOLDING)
        {
            warned_guards.push(stale);
            continue;
        }
        ctx.db.combat_agent().id().delete(stale.id);
    }
    let warned_sources = warned_guards
        .iter()
        .map(|guard| guard.source_building_id)
        .collect::<HashSet<_>>();
    for mut route in ctx
        .db
        .guard_muster_route()
        .owner()
        .filter(&owner)
        .collect::<Vec<_>>()
    {
        if warned_sources.contains(&route.source_building_id)
            && warned_raid_id == Some(route.raid_id)
        {
            route.raid_id = raid_id;
            ctx.db
                .guard_muster_route()
                .source_building_id()
                .update(route);
        } else {
            ctx.db
                .guard_muster_route()
                .source_building_id()
                .delete(route.source_building_id);
        }
    }
    clear_raider_incursion_routes(ctx, owner);

    let raider_count = raid_party_size(enemy_pressure);
    let primary = targets[0];
    let (entry_x, entry_z) = planned_entry
        .filter(|(x, z)| x.is_finite() && z.is_finite())
        .unwrap_or_else(|| {
            raid_entry_point(
                world_seed ^ raid_id ^ primary.id,
                primary.x,
                primary.z,
                playable_half,
            )
        });
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
                raid_target_assault_position(ctx, owner, target.kind, target.id, entry_x, entry_z)
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
        raiders_downed: 0,
        rout_started: false,
    });

    for index in 0..raider_count {
        let target_index = index as usize % targets.len();
        let target = targets[target_index];
        let (x, z) = formation_spawn(entry_x, entry_z, primary.x, primary.z, index);
        let raider_health =
            (80.0 + enemy_pressure.min(100) as f64 * 0.2) * ottoman_raider_health_multiplier(index);
        let inserted = ctx.db.combat_agent().insert(CombatAgent {
            id: 0,
            owner,
            raid_id,
            faction: COMBAT_FACTION_RAIDER,
            source_building_id: 0,
            source_slot: index,
            resident_slot: 0,
            assigned_building_id: 0,
            target_kind: target.kind,
            target_id: target.id,
            engagement_target_id: 0,
            x,
            z,
            velocity_x: 0.0,
            velocity_z: 0.0,
            home_x: x,
            home_z: z,
            health: raider_health,
            max_health: raider_health,
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

    let mut guard_count = 0_u32;
    for mut guard in warned_guards {
        let Some(target) = targets.iter().min_by(|left, right| {
            distance_squared(guard.x, guard.z, left.x, left.z)
                .total_cmp(&distance_squared(guard.x, guard.z, right.x, right.z))
                .then_with(|| left.kind.cmp(&right.kind))
                .then_with(|| left.id.cmp(&right.id))
        }) else {
            continue;
        };
        guard.raid_id = raid_id;
        guard.target_kind = target.kind;
        guard.target_id = target.id;
        guard.raid_anchor_building_id = target.raid_anchor_building_id;
        guard.state = COMBAT_STATE_ADVANCING;
        guard.state_changed_tick = raid_id;
        ctx.db.combat_agent().id().update(guard);
        guard_count += 1;
    }

    // Legacy guardhouse labor no longer materializes a second hidden army.
    // The initial defender report counts actual recruited companies instead.
    guard_count += ctx
        .db
        .military_member()
        .owner()
        .filter(&owner)
        .filter(|member| member.phase == 1)
        .filter(|member| {
            ctx.db
                .combat_agent()
                .id()
                .find(&member.combat_agent_id)
                .is_some_and(|agent| agent.state != COMBAT_STATE_DOWNED)
        })
        .count() as u32;
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
                COMBAT_CROSS_COUNTRY_ROUTE_MULTIPLIER,
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

pub fn step_live_raids(
    ctx: &ReducerContext,
    sim_tick: u64,
    world_seed: u64,
    conflict_enabled: bool,
    elapsed_seconds: f64,
    road_networks: Option<&SharedRoadNetworks>,
) {
    // Intentionally independent of GameClock and the civilian labor schedule.
    // Once materialized, a conflict advances through dusk, night, dawn, and
    // Sabbath until attackers are down or have physically escaped and the
    // responding guards have returned.
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
    let active_owners = active_keys
        .iter()
        .map(|(owner, _)| *owner)
        .collect::<HashSet<_>>();
    for raid in active_raids {
        let road_network = road_networks.and_then(|networks| networks.get(&raid.owner));
        step_one_live_raid(
            ctx,
            raid,
            sim_tick,
            world_seed,
            elapsed_seconds,
            road_network,
        );
    }

    let warned_keys = ctx
        .db
        .settlement_security()
        .iter()
        .filter(|security| {
            security.warning_started_tick > 0
                && security.next_raid_tick > 0
                && !active_owners.contains(&security.owner)
        })
        .map(|security| (security.owner, security.next_raid_tick))
        .collect::<HashSet<_>>();
    for (owner, raid_id) in &warned_keys {
        let road_network = road_networks.and_then(|networks| networks.get(owner));
        step_warned_guard_muster(
            ctx,
            *owner,
            *raid_id,
            sim_tick,
            elapsed_seconds,
            road_network,
        );
    }

    // Downed agents linger briefly for readable aftermath, after their raid
    // summary has finalized. Warned guards remain authoritative before contact;
    // a cancelled warning sends those same people and weapons physically home.
    for agent in ctx.db.combat_agent().iter().collect::<Vec<CombatAgent>>() {
        // Bandits and player militia are persistent world actors owned by the
        // independent bandit simulation, not orphaned raid-company rows.
        if agent.faction >= 2 {
            continue;
        }
        if active_keys.contains(&(agent.owner, agent.raid_id)) {
            continue;
        }
        if warned_keys.contains(&(agent.owner, agent.raid_id))
            && matches!(agent.state, COMBAT_STATE_MUSTERING | COMBAT_STATE_HOLDING)
        {
            continue;
        }
        let agent_id = agent.id;
        if agent.faction == COMBAT_FACTION_GUARD {
            let road_network = road_networks.and_then(|networks| networks.get(&agent.owner));
            let muster_route = load_one_guard_muster_path(
                ctx,
                agent.owner,
                agent.raid_id,
                agent.source_building_id,
            );
            if step_recovering_guard(
                ctx,
                agent,
                muster_route.as_ref(),
                sim_tick,
                elapsed_seconds,
                road_network,
            ) {
                continue;
            }
        } else if agent.state == COMBAT_STATE_DOWNED {
            let mut lingering = agent;
            lingering.attack_cooldown = (lingering.attack_cooldown - elapsed_seconds).max(0.0);
            if lingering.attack_cooldown > EPSILON {
                ctx.db.combat_agent().id().update(lingering);
                continue;
            }
        }
        ctx.db.combat_agent().id().delete(agent_id);
    }
    let used_guard_routes = ctx
        .db
        .combat_agent()
        .iter()
        .filter(|agent| agent.faction == COMBAT_FACTION_GUARD && agent.source_building_id > 0)
        .map(|agent| (agent.owner, agent.raid_id, agent.source_building_id))
        .collect::<HashSet<_>>();
    for route in ctx
        .db
        .guard_muster_route()
        .iter()
        .collect::<Vec<GuardMusterRoute>>()
    {
        if !used_guard_routes.contains(&(route.owner, route.raid_id, route.source_building_id)) {
            ctx.db
                .guard_muster_route()
                .source_building_id()
                .delete(route.source_building_id);
        }
    }
}

fn step_warned_guard_muster(
    ctx: &ReducerContext,
    owner: Identity,
    raid_id: u64,
    sim_tick: u64,
    elapsed_seconds: f64,
    road_network: Option<&RoadNetwork>,
) {
    let routes = load_guard_muster_paths(ctx, owner, raid_id);
    for mut guard in ctx
        .db
        .combat_agent()
        .owner()
        .filter(&owner)
        .filter(|agent| {
            agent.raid_id == raid_id
                && agent.faction == COMBAT_FACTION_GUARD
                && matches!(agent.state, COMBAT_STATE_MUSTERING | COMBAT_STATE_HOLDING)
        })
        .collect::<Vec<_>>()
    {
        if guard.state == COMBAT_STATE_HOLDING {
            if guard.velocity_x != 0.0 || guard.velocity_z != 0.0 {
                guard.velocity_x = 0.0;
                guard.velocity_z = 0.0;
                ctx.db.combat_agent().id().update(guard);
            }
            continue;
        }
        let Some(route) = routes.get(&guard.source_building_id) else {
            guard.state = COMBAT_STATE_RETURNING;
            guard.engagement_target_id = 0;
            guard.state_changed_tick = sim_tick;
            guard.velocity_x = 0.0;
            guard.velocity_z = 0.0;
            ctx.db.combat_agent().id().update(guard);
            continue;
        };
        let previous_x = guard.x;
        let previous_z = guard.z;
        let route_move = move_along_combat_route(
            guard.x,
            guard.z,
            guard.route_progress,
            route.path_distance,
            &route.polyline,
            GUARD_SPEED_MPS,
            elapsed_seconds,
            true,
            road_network,
        );
        guard.x = route_move.x;
        guard.z = route_move.z;
        guard.route_progress = route_move.progress;
        guard.velocity_x = (guard.x - previous_x) / elapsed_seconds.max(1e-9);
        guard.velocity_z = (guard.z - previous_z) / elapsed_seconds.max(1e-9);
        if guard.route_progress + EPSILON >= route.path_distance {
            guard.state = COMBAT_STATE_HOLDING;
            guard.state_changed_tick = sim_tick;
            guard.velocity_x = 0.0;
            guard.velocity_z = 0.0;
        }
        ctx.db.combat_agent().id().update(guard);
    }
}

fn clear_all_live_raids(ctx: &ReducerContext) {
    for agent in ctx.db.combat_agent().iter().collect::<Vec<CombatAgent>>() {
        if agent.faction < 2 {
            ctx.db.combat_agent().id().delete(agent.id);
        }
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

fn load_one_guard_muster_path(
    ctx: &ReducerContext,
    owner: Identity,
    raid_id: u64,
    source_building_id: u64,
) -> Option<CachedCombatPath> {
    let route = ctx
        .db
        .guard_muster_route()
        .source_building_id()
        .find(source_building_id)?;
    if route.owner != owner || route.raid_id != raid_id || route.path_distance <= EPSILON {
        return None;
    }
    deserialize_route_polyline(&route.route_polyline_json)
        .filter(|polyline| polyline.len() >= 2)
        .map(|polyline| CachedCombatPath {
            path_distance: route.path_distance,
            polyline,
        })
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
    road_network: Option<&RoadNetwork>,
) {
    let active_player_agent_ids = ctx
        .db
        .military_member()
        .owner()
        .filter(&active.owner)
        .filter(|member| member.phase == 1)
        .filter(|member| {
            ctx.db
                .military_company()
                .id()
                .find(&member.company_id)
                .is_some_and(|company| company.state == 1)
        })
        .map(|member| member.combat_agent_id)
        .collect::<HashSet<_>>();
    let mut agents = ctx
        .db
        .combat_agent()
        .owner()
        .filter(&active.owner)
        .filter(|agent| {
            (agent.raid_id == active.raid_id
                && matches!(agent.faction, COMBAT_FACTION_GUARD | COMBAT_FACTION_RAIDER))
                || (is_player_military_faction(agent.faction)
                    && active_player_agent_ids.contains(&agent.id))
        })
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
            road_network,
        );
        return;
    }

    // Living includes advancing, fighting, looting, and retreating raiders.
    // A calendar boundary can never finalize or despawn an active warband.

    let mut snapshots = agents.values().cloned().collect::<Vec<_>>();
    snapshots.sort_unstable_by_key(|agent| agent.id);
    let mut damage_by_agent = HashMap::<u64, f64>::new();
    let mut delete_ids = HashSet::<u64>::new();

    RAID_TARGET_GRID.with(|grid_cell| {
        RAID_RANGED_FRAMES.with(|frame_cell| {
            RAID_ENGAGEMENT_SCRATCH.with(|engagement_cell| {
                let mut target_grid = grid_cell.borrow_mut();
                let mut ranged_frames = frame_cell.borrow_mut();
                let mut engagement = engagement_cell.borrow_mut();
                rebuild_raid_target_grid(&snapshots, active.raid_id, &mut target_grid);
                collect_raider_ranged_frames(&snapshots, &mut ranged_frames);
                let ranged_frame = ranged_frames
                    .iter()
                    .copied()
                    .find(|frame| frame.owner == active.owner && frame.raid_id == active.raid_id);
                engagement.rank_counts.clear();
                engagement.stable_order.clear();
                engagement.stable_order.extend(0..snapshots.len());
                engagement
                    .stable_order
                    .sort_unstable_by(|left_index, right_index| {
                        let left = &snapshots[*left_index];
                        let right = &snapshots[*right_index];
                        left.source_slot
                            .cmp(&right.source_slot)
                            .then_with(|| left.id.cmp(&right.id))
                    });
                let RaidEngagementScratch {
                    stable_order,
                    rank_counts,
                } = &mut *engagement;
                for snapshot_index in stable_order.iter().copied() {
                    let snapshot_id = snapshots[snapshot_index].id;
                    let Some(agent) = agents.get_mut(&snapshot_id) else {
                        continue;
                    };
                    // Company behavior and movement remain owned by the global
                    // military heartbeat. Their raid snapshots are present so
                    // Ottoman ranks can acquire and damage them authoritatively.
                    if is_player_military_faction(agent.faction) {
                        continue;
                    }
                    if agent.state == COMBAT_STATE_DOWNED || agent.health <= EPSILON {
                        agent.attack_cooldown = (agent.attack_cooldown - elapsed_seconds).max(0.0);
                        agent.engagement_target_id = 0;
                        if agent.faction == COMBAT_FACTION_RAIDER
                            && agent.attack_cooldown <= EPSILON
                        {
                            delete_ids.insert(agent.id);
                        }
                        continue;
                    }
                    agent.attack_cooldown = (agent.attack_cooldown - elapsed_seconds).max(0.0);
                    let previous_x = agent.x;
                    let previous_z = agent.z;
                    if agent.faction == COMBAT_FACTION_RAIDER {
                        step_raider(
                            ctx,
                            &active,
                            agent,
                            &snapshots,
                            &target_grid,
                            ranged_frame,
                            rank_counts,
                            raider_routes.get(&agent.id),
                            &mut damage_by_agent,
                            &mut delete_ids,
                            sim_tick,
                            elapsed_seconds,
                            road_network,
                        );
                    } else {
                        step_guard(
                            ctx,
                            agent,
                            &snapshots,
                            &target_grid,
                            rank_counts,
                            guard_routes.get(&agent.source_building_id),
                            &mut damage_by_agent,
                            sim_tick,
                            elapsed_seconds,
                            road_network,
                        );
                    }
                    agent.velocity_x = (agent.x - previous_x) / elapsed_seconds.max(1e-9);
                    agent.velocity_z = (agent.z - previous_z) / elapsed_seconds.max(1e-9);
                }
            });
        });
    });

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

    begin_raider_rout_if_broken(ctx, &active, &mut agents, sim_tick);

    for (id, agent) in agents {
        if delete_ids.contains(&id) {
            ctx.db.combat_agent().id().delete(id);
        } else {
            ctx.db.combat_agent().id().update(agent);
        }
    }
}

fn begin_raider_rout_if_broken(
    ctx: &ReducerContext,
    active: &ActiveRaid,
    agents: &mut HashMap<u64, CombatAgent>,
    sim_tick: u64,
) {
    let Some(mut latest) = ctx.db.active_raid().owner().find(&active.owner) else {
        return;
    };
    if latest.rout_started || latest.raiders_downed == 0 {
        return;
    }

    let committed_raider_strength = agents
        .values()
        .filter(|agent| {
            agent.faction == COMBAT_FACTION_RAIDER
                && agent.state != COMBAT_STATE_DOWNED
                && agent.state != COMBAT_STATE_RETREATING
                && agent.health > EPSILON
        })
        .map(|agent| combatant_morale_strength(agent.health, agent.max_health, agent.readiness))
        .sum::<f64>();
    let legacy_guard_strength = agents
        .values()
        .filter(|agent| {
            agent.faction == COMBAT_FACTION_GUARD
                && matches!(agent.state, COMBAT_STATE_ADVANCING | COMBAT_STATE_FIGHTING)
                && agent.health > EPSILON
        })
        .map(|agent| combatant_morale_strength(agent.health, agent.max_health, agent.readiness))
        .sum::<f64>();
    let raider_positions = agents
        .values()
        .filter(|agent| {
            agent.faction == COMBAT_FACTION_RAIDER
                && agent.state != COMBAT_STATE_DOWNED
                && agent.health > EPSILON
        })
        .map(|agent| (agent.x, agent.z))
        .collect::<Vec<_>>();
    let company_guard_strength = agents
        .values()
        .filter(|agent| {
            is_player_military_faction(agent.faction)
                && agent.state != COMBAT_STATE_DOWNED
                && agent.health > EPSILON
                && raider_positions
                    .iter()
                    .any(|(x, z)| distance_squared(agent.x, agent.z, *x, *z) <= 28.0 * 28.0)
        })
        .map(|agent| combatant_morale_strength(agent.health, agent.max_health, agent.readiness))
        .sum::<f64>();
    let field_guard_strength = legacy_guard_strength + company_guard_strength;

    if !raider_company_should_rout(
        latest.initial_raiders,
        latest.raiders_downed,
        committed_raider_strength,
        field_guard_strength,
    ) {
        return;
    }

    latest.rout_started = true;
    ctx.db.active_raid().owner().update(latest);
    for agent in agents.values_mut() {
        if agent.faction != COMBAT_FACTION_RAIDER
            || agent.state == COMBAT_STATE_DOWNED
            || agent.state == COMBAT_STATE_RETREATING
            || agent.health <= EPSILON
        {
            continue;
        }
        agent.state = COMBAT_STATE_RETREATING;
        agent.engagement_target_id = 0;
        agent.state_changed_tick = sim_tick;
        agent.loot_progress = 0.0;
    }
}

fn rebuild_raid_target_grid(
    snapshots: &[CombatAgent],
    raid_id: u64,
    grid: &mut CombatSteeringGrid,
) {
    grid.begin();
    for agent in snapshots {
        if agent.state == COMBAT_STATE_DOWNED || agent.health <= EPSILON {
            continue;
        }
        grid.push(SteeringBody {
            id: agent.id,
            owner_group: raid_id.max(1),
            group_kind: agent.faction,
            group_id: raid_id,
            faction: agent.faction,
            target_id: agent.target_id,
            x: agent.x,
            z: agent.z,
            goal_x: agent.x,
            goal_z: agent.z,
            speed: 0.0,
            velocity_x: agent.velocity_x,
            velocity_z: agent.velocity_z,
        });
    }
    grid.finish();
}

fn step_raider(
    ctx: &ReducerContext,
    active: &ActiveRaid,
    agent: &mut CombatAgent,
    snapshots: &[CombatAgent],
    target_grid: &CombatSteeringGrid,
    ranged_frame: Option<RaiderRangedFrame>,
    engagement_rank_counts: &mut HashMap<EngagementRankKey, usize>,
    incursion_route: Option<&CachedCombatPath>,
    damage_by_agent: &mut HashMap<u64, f64>,
    delete_ids: &mut HashSet<u64>,
    sim_tick: u64,
    elapsed_seconds: f64,
    road_network: Option<&RoadNetwork>,
) {
    let raider_speed = ottoman_raider_speed(agent.source_slot);
    if agent.state == COMBAT_STATE_RETREATING {
        agent.engagement_target_id = 0;
        if distance_squared(agent.x, agent.z, agent.home_x, agent.home_z)
            <= ARRIVAL_RANGE_METERS * ARRIVAL_RANGE_METERS
        {
            delete_ids.insert(agent.id);
            return;
        }
        if let Some(route) = incursion_route {
            let direct_home_distance =
                combat_route_effort(road_network, agent.x, agent.z, agent.home_x, agent.home_z);
            let remaining_route_distance = agent.route_progress.clamp(0.0, route.path_distance);
            if !route_shortcut_is_worthwhile(
                direct_home_distance,
                remaining_route_distance,
                COMBAT_CROSS_COUNTRY_ROUTE_MULTIPLIER,
            ) && agent.route_progress > EPSILON
            {
                let route_move = move_along_combat_route(
                    agent.x,
                    agent.z,
                    agent.route_progress,
                    route.path_distance,
                    &route.polyline,
                    raider_speed,
                    elapsed_seconds,
                    false,
                    road_network,
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
        (agent.x, agent.z) = move_combatant_toward(
            agent.x,
            agent.z,
            agent.home_x,
            agent.home_z,
            raider_speed,
            elapsed_seconds,
            road_network,
        );
        return;
    }

    if let Some(defender) = retained_or_nearest_enemy(
        agent,
        snapshots,
        target_grid,
        RAIDER_ENGAGE_RANGE_METERS,
        |candidate| {
            candidate.faction == COMBAT_FACTION_GUARD
                || is_player_military_faction(candidate.faction)
        },
    ) {
        agent.loot_progress = 0.0;
        engage_agent(
            ctx,
            agent,
            defender,
            ranged_frame,
            engagement_rank_counts,
            raider_speed,
            raider_damage(active.enemy_pressure)
                * ottoman_raider_damage_multiplier(agent.source_slot),
            raider_attack_interval(active.enemy_pressure),
            damage_by_agent,
            sim_tick,
            elapsed_seconds,
            road_network,
        );
        return;
    }

    let Some((target_x, target_z, active_raid_anchor_id)) = raid_agent_target_position(ctx, agent)
    else {
        agent.state = COMBAT_STATE_RETREATING;
        agent.engagement_target_id = 0;
        agent.state_changed_tick = sim_tick;
        return;
    };
    let contact_distance = distance_squared(agent.x, agent.z, target_x, target_z);
    let contact_range = raid_contact_range(active_raid_anchor_id, agent.target_kind);
    if contact_distance > contact_range * contact_range {
        agent.state = COMBAT_STATE_ADVANCING;
        agent.loot_progress = 0.0;
        if let Some(route) = incursion_route {
            let direct_target_distance =
                combat_route_effort(road_network, agent.x, agent.z, target_x, target_z);
            let remaining_route_distance = (route.path_distance - agent.route_progress).max(0.0);
            if route_shortcut_is_worthwhile(
                direct_target_distance,
                remaining_route_distance,
                COMBAT_CROSS_COUNTRY_ROUTE_MULTIPLIER,
            ) {
                // Mark the outbound route complete. If the target moved away
                // from its cached endpoint, retreat can still rejoin that
                // endpoint or take another worthwhile cross-country shortcut.
                agent.route_progress = route.path_distance;
            } else if agent.route_progress + EPSILON < route.path_distance {
                let route_move = move_along_combat_route(
                    agent.x,
                    agent.z,
                    agent.route_progress,
                    route.path_distance,
                    &route.polyline,
                    raider_speed,
                    elapsed_seconds,
                    true,
                    road_network,
                );
                agent.x = route_move.x;
                agent.z = route_move.z;
                agent.route_progress = route_move.progress;
                // Do not spend the same heartbeat's movement budget twice
                // when the road endpoint is reached partway through it.
                return;
            }
        }
        (agent.x, agent.z) = move_combatant_toward(
            agent.x,
            agent.z,
            target_x,
            target_z,
            raider_speed,
            elapsed_seconds,
            road_network,
        );
        return;
    }

    if agent.loot_progress <= EPSILON {
        try_record_contact_civilian_casualty(ctx, agent, sim_tick);
    }
    agent.state = COMBAT_STATE_LOOTING;
    agent.engagement_target_id = 0;
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
    agent.engagement_target_id = 0;
    agent.state_changed_tick = sim_tick;
    agent.loot_progress = 0.0;
}

/// A civilian casualty is possible only when a physical raider has reached an
/// unsheltered occupied home. It is never resolved from regional pressure or
/// at a remote stockpile, and creates the same recoverable body as mortality.
fn try_record_contact_civilian_casualty(
    ctx: &ReducerContext,
    agent: &mut CombatAgent,
    sim_tick: u64,
) {
    if agent.target_kind != COMBAT_TARGET_RESIDENCE || agent.raid_anchor_building_id != 0 {
        return;
    }
    let roll = (agent.raid_id ^ agent.id.rotate_left(17) ^ agent.target_id.rotate_left(31)) % 100;
    if roll >= 42 {
        return;
    }
    let Some(mut home) = ctx.db.residence().id().find(&agent.target_id) else {
        return;
    };
    if home.owner != agent.owner || home.population == 0 {
        return;
    }
    home.population = home.population.saturating_sub(1);
    home.sick_population = home.sick_population.min(home.population);
    home.deaths_total = home.deaths_total.saturating_add(1);
    ctx.db.residence().id().update(home.clone());
    ctx.db.corpse().insert(Corpse {
        id: 0,
        owner: agent.owner,
        residence_id: home.id,
        cause: 3,
        state: 0,
        x: agent.x,
        z: agent.z,
        created_tick: sim_tick,
        chapel_id: 0,
        graveyard_id: 0,
        progress: 0.0,
        speed_mps: 0.0,
        path_distance: 0.0,
        route_polyline_json: String::new(),
        cart_x: agent.x,
        cart_z: agent.z,
    });
    // A non-zero sentinel prevents a fight interruption at this same doorway
    // from recording a second victim before the local looting timer completes.
    agent.loot_progress = 0.001;
}

fn step_guard(
    ctx: &ReducerContext,
    agent: &mut CombatAgent,
    snapshots: &[CombatAgent],
    target_grid: &CombatSteeringGrid,
    engagement_rank_counts: &mut HashMap<EngagementRankKey, usize>,
    muster_route: Option<&CachedCombatPath>,
    damage_by_agent: &mut HashMap<u64, f64>,
    sim_tick: u64,
    elapsed_seconds: f64,
    road_network: Option<&RoadNetwork>,
) {
    let (guard_x, guard_z, guard_target_kind, guard_target_id) =
        (agent.x, agent.z, agent.target_kind, agent.target_id);
    let emergency_enemy = retained_or_nearest_enemy(
        agent,
        snapshots,
        target_grid,
        GUARD_TARGET_ACQUISITION_METERS,
        |candidate| {
            candidate.faction == COMBAT_FACTION_RAIDER
                && guard_breaks_route_for(
                    guard_x,
                    guard_z,
                    candidate.x,
                    candidate.z,
                    candidate.target_kind == guard_target_kind
                        && candidate.target_id == guard_target_id,
                    candidate.state,
                )
        },
    );
    if let Some(enemy) = emergency_enemy {
        engage_agent(
            ctx,
            agent,
            enemy,
            None,
            engagement_rank_counts,
            GUARD_SPEED_MPS,
            guard_damage(agent.readiness),
            guard_attack_interval(agent.readiness),
            damage_by_agent,
            sim_tick,
            elapsed_seconds,
            road_network,
        );
        return;
    }

    if let Some(route) = muster_route {
        if agent.route_progress + EPSILON < route.path_distance {
            // The watch route is a fast deployment preference, not a rail.
            // Once the live raiders are visible, compare the actual journey:
            // direct cross-country pursuit versus finishing the road and then
            // crossing from its endpoint to the moving threat. Prefer a raider
            // assigned to this attacked holding, then reinforce elsewhere.
            let (target_kind, target_id) = (agent.target_kind, agent.target_id);
            let route_enemy = retained_or_nearest_enemy(
                agent,
                snapshots,
                target_grid,
                GUARD_TARGET_ACQUISITION_METERS,
                |candidate| {
                    candidate.faction == COMBAT_FACTION_RAIDER
                        && candidate.target_kind == target_kind
                        && candidate.target_id == target_id
                },
            )
            .or_else(|| {
                retained_or_nearest_enemy(
                    agent,
                    snapshots,
                    target_grid,
                    GUARD_TARGET_ACQUISITION_METERS,
                    |candidate| candidate.faction == COMBAT_FACTION_RAIDER,
                )
            });
            if let Some(enemy) = route_enemy {
                let endpoint = route.polyline[route.polyline.len() - 1];
                let direct_distance =
                    combat_route_effort(road_network, agent.x, agent.z, enemy.x, enemy.z);
                let remaining_route_distance =
                    (route.path_distance - agent.route_progress).max(0.0);
                let endpoint_to_enemy_distance =
                    combat_route_effort(road_network, endpoint[0], endpoint[1], enemy.x, enemy.z);
                if route_shortcut_via_endpoint_is_worthwhile(
                    direct_distance,
                    remaining_route_distance,
                    endpoint_to_enemy_distance,
                    COMBAT_CROSS_COUNTRY_ROUTE_MULTIPLIER,
                ) {
                    engage_agent(
                        ctx,
                        agent,
                        enemy,
                        None,
                        engagement_rank_counts,
                        GUARD_SPEED_MPS,
                        guard_damage(agent.readiness),
                        guard_attack_interval(agent.readiness),
                        damage_by_agent,
                        sim_tick,
                        elapsed_seconds,
                        road_network,
                    );
                    return;
                }
            }
            let route_move = move_along_combat_route(
                agent.x,
                agent.z,
                agent.route_progress,
                route.path_distance,
                &route.polyline,
                GUARD_SPEED_MPS,
                elapsed_seconds,
                true,
                road_network,
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

    let (target_kind, target_id) = (agent.target_kind, agent.target_id);
    let enemy = retained_or_nearest_enemy(
        agent,
        snapshots,
        target_grid,
        GUARD_TARGET_ACQUISITION_METERS,
        |candidate| {
            candidate.faction == COMBAT_FACTION_RAIDER
                && candidate.target_kind == target_kind
                && candidate.target_id == target_id
        },
    )
    .or_else(|| {
        retained_or_nearest_enemy(
            agent,
            snapshots,
            target_grid,
            GUARD_TARGET_ACQUISITION_METERS,
            |candidate| candidate.faction == COMBAT_FACTION_RAIDER,
        )
    });
    let Some(enemy) = enemy else {
        return;
    };
    engage_agent(
        ctx,
        agent,
        enemy,
        None,
        engagement_rank_counts,
        GUARD_SPEED_MPS,
        guard_damage(agent.readiness),
        guard_attack_interval(agent.readiness),
        damage_by_agent,
        sim_tick,
        elapsed_seconds,
        road_network,
    );
}

fn combat_route_effort(
    road_network: Option<&RoadNetwork>,
    ax: f64,
    az: f64,
    bx: f64,
    bz: f64,
) -> f64 {
    road_network
        .map(|network| {
            network.combat_cross_country_effort(
                ax,
                az,
                bx,
                bz,
                COMBAT_WADING_SPEED_MULTIPLIER,
                COMBAT_ROAD_SPEED_MULTIPLIER,
            )
        })
        .unwrap_or_else(|| distance_squared(ax, az, bx, bz).sqrt())
}

fn move_combatant_toward(
    x: f64,
    z: f64,
    target_x: f64,
    target_z: f64,
    speed_mps: f64,
    elapsed_seconds: f64,
    road_network: Option<&RoadNetwork>,
) -> (f64, f64) {
    let base_distance = speed_mps.max(0.0) * elapsed_seconds.max(0.0);
    let candidate = move_toward(
        x,
        z,
        target_x,
        target_z,
        base_distance * COMBAT_ROAD_SPEED_MULTIPLIER,
    );
    let surface_multiplier = road_network
        .map(|network| {
            network.combat_segment_speed_multiplier(
                x,
                z,
                candidate.0,
                candidate.1,
                COMBAT_WADING_SPEED_MULTIPLIER,
                COMBAT_ROAD_SPEED_MULTIPLIER,
            )
        })
        .unwrap_or(1.0);
    move_toward(x, z, target_x, target_z, base_distance * surface_multiplier)
}

pub(super) fn move_along_combat_route(
    x: f64,
    z: f64,
    progress: f64,
    path_distance: f64,
    polyline: &[[f64; 2]],
    speed_mps: f64,
    elapsed_seconds: f64,
    outbound: bool,
    road_network: Option<&RoadNetwork>,
) -> RouteMove {
    let base_distance = speed_mps.max(0.0) * elapsed_seconds.max(0.0);
    let candidate = move_along_route(
        x,
        z,
        progress,
        path_distance,
        polyline,
        base_distance * COMBAT_ROAD_SPEED_MULTIPLIER,
        outbound,
    );
    let surface_multiplier = road_network
        .map(|network| {
            network.combat_segment_speed_multiplier(
                x,
                z,
                candidate.x,
                candidate.z,
                COMBAT_WADING_SPEED_MULTIPLIER,
                COMBAT_ROAD_SPEED_MULTIPLIER,
            )
        })
        .unwrap_or(COMBAT_ROAD_SPEED_MULTIPLIER);
    move_along_route(
        x,
        z,
        progress,
        path_distance,
        polyline,
        base_distance * surface_multiplier,
        outbound,
    )
}

fn retained_or_nearest_enemy<'a>(
    agent: &mut CombatAgent,
    snapshots: &'a [CombatAgent],
    target_grid: &CombatSteeringGrid,
    max_distance: f64,
    mut matches: impl FnMut(&CombatAgent) -> bool,
) -> Option<&'a CombatAgent> {
    let retention_distance_sq = (max_distance * 1.35).powi(2);
    if agent.engagement_target_id != 0 {
        if let Some(candidate) =
            snapshot_by_id(snapshots, agent.engagement_target_id).filter(|candidate| {
                candidate.state != COMBAT_STATE_DOWNED
                    && candidate.health > EPSILON
                    && distance_squared(agent.x, agent.z, candidate.x, candidate.z)
                        <= retention_distance_sq
                    && matches(candidate)
            })
        {
            return Some(candidate);
        }
        agent.engagement_target_id = 0;
    }
    let target_id =
        target_grid.nearest_matching_id(agent.id, max_distance, |candidate_id, _, _| {
            snapshot_by_id(snapshots, candidate_id).is_some_and(|candidate| matches(candidate))
        })?;
    agent.engagement_target_id = target_id;
    snapshot_by_id(snapshots, target_id)
}

fn snapshot_by_id(snapshots: &[CombatAgent], id: u64) -> Option<&CombatAgent> {
    snapshots
        .binary_search_by_key(&id, |snapshot| snapshot.id)
        .ok()
        .map(|index| &snapshots[index])
}

fn raid_engagement_rank_key(agent: &CombatAgent, target_id: u64) -> EngagementRankKey {
    EngagementRankKey {
        // This scratch map is cleared for each one-owner active raid. Keeping
        // raid_id here still makes the key self-contained and deterministic.
        owner_group: agent.raid_id,
        group_kind: if agent.faction == COMBAT_FACTION_RAIDER {
            2
        } else {
            4
        },
        group_id: if agent.faction == COMBAT_FACTION_RAIDER {
            agent.raid_id
        } else {
            agent.source_building_id
        },
        target_id,
    }
}

fn engage_agent(
    ctx: &ReducerContext,
    agent: &mut CombatAgent,
    enemy: &CombatAgent,
    ranged_frame: Option<RaiderRangedFrame>,
    engagement_rank_counts: &mut HashMap<EngagementRankKey, usize>,
    speed: f64,
    damage: f64,
    attack_interval: f64,
    damage_by_agent: &mut HashMap<u64, f64>,
    sim_tick: u64,
    elapsed_seconds: f64,
    road_network: Option<&RoadNetwork>,
) {
    agent.engagement_target_id = enemy.id;
    let distance = distance_squared(agent.x, agent.z, enemy.x, enemy.z);
    let ranged_raider =
        agent.faction == COMBAT_FACTION_RAIDER && ottoman_raider_is_ranged(agent.source_slot);
    let melee_rank = (!ranged_raider).then(|| {
        next_dense_engagement_rank(
            engagement_rank_counts,
            raid_engagement_rank_key(agent, enemy.id),
        )
    });
    let strike_range = if ranged_raider {
        12.0
    } else {
        MELEE_RANGE_METERS
    };
    if distance <= strike_range * strike_range {
        let attacker_was_charging = agent.state == COMBAT_STATE_ADVANCING
            && agent.velocity_x.hypot(agent.velocity_z) >= 1.0;
        let resolved_damage = if agent.attack_cooldown > EPSILON { 0.0 } else if is_player_military_faction(enemy.faction) {
            let reflected = super::military::external_charge_reflection(ctx, enemy, agent, damage, attacker_was_charging);
            *damage_by_agent.entry(agent.id).or_insert(0.0) += reflected;
            super::military::mitigate_external_player_damage(
                ctx,
                enemy,
                agent,
                damage,
                attacker_was_charging,
            )
        } else {
            damage
        };
        if agent.state != COMBAT_STATE_FIGHTING {
            agent.state_changed_tick = sim_tick;
        }
        agent.state = COMBAT_STATE_FIGHTING;
        if agent.attack_cooldown <= EPSILON {
            *damage_by_agent.entry(enemy.id).or_insert(0.0) += resolved_damage;
            agent.attack_cooldown = attack_interval;
        }
        return;
    }
    agent.state = COMBAT_STATE_ADVANCING;
    let goal = if ranged_raider {
        ranged_frame
            .filter(|frame| frame.matches(agent))
            .map_or_else(
                || {
                    raider_ranged_firing_line_goal(
                        agent.source_slot,
                        1,
                        agent.x,
                        agent.z,
                        enemy.x,
                        enemy.z,
                        strike_range,
                    )
                },
                |frame| frame.goal(agent.source_slot, strike_range),
            )
    } else {
        melee_engagement_goal(
            agent.raid_id.max(agent.source_building_id),
            enemy.id,
            melee_rank.expect("non-ranged combatant has a dense engagement rank"),
            enemy.x,
            enemy.z,
            strike_range,
        )
    };
    (agent.x, agent.z) = move_combatant_toward(
        agent.x,
        agent.z,
        goal.0,
        goal.1,
        speed,
        elapsed_seconds,
        road_network,
    );
}

fn record_contact_plunder(
    ctx: &ReducerContext,
    active: &ActiveRaid,
    agent: &mut CombatAgent,
    plunder: ContactRaidPlunder,
    sim_tick: u64,
) {
    let carried = plunder.carried.normalized_whole();
    let goods_lost = whole_units(plunder.goods_lost);
    let wealth_lost = whole_units(plunder.wealth_lost);
    if goods_lost > EPSILON || wealth_lost > EPSILON {
        agent.carried_loot_json = serde_json::to_string(&carried).unwrap_or_default();
    }
    let Some(mut latest) = ctx.db.active_raid().owner().find(&active.owner) else {
        return;
    };
    latest.goods_lost = whole_units(latest.goods_lost) + goods_lost;
    latest.wealth_lost = whole_units(latest.wealth_lost) + wealth_lost;

    if !latest.arson_started
        && (goods_lost + wealth_lost) > EPSILON
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
    if is_player_military_faction(agent.faction) {
        super::military::down_external_player_member(ctx, agent, sim_tick);
        return;
    }
    agent.health = 0.0;
    agent.state = COMBAT_STATE_DOWNED;
    agent.engagement_target_id = 0;
    agent.state_changed_tick = sim_tick;
    agent.attack_cooldown = DOWNED_LINGER_SECONDS;
    agent.loot_progress = 0.0;
    if agent.faction != COMBAT_FACTION_RAIDER {
        return;
    }

    let Some(mut latest) = ctx.db.active_raid().owner().find(&active.owner) else {
        return;
    };
    latest.raiders_downed = latest.raiders_downed.saturating_add(1);

    if let Ok(carried) = serde_json::from_str::<RaidPortableStores>(&agent.carried_loot_json) {
        let carried = carried.normalized_whole();
        let recovered = recover_stock_at(
            ctx,
            agent.owner,
            agent.x,
            agent.z,
            reclamation_from_raid_stores(carried),
        )
        .unwrap_or(false);
        if recovered {
            agent.carried_loot_json.clear();
            latest.goods_lost = (whole_units(latest.goods_lost) - carried.goods_amount()).max(0.0);
            latest.wealth_lost =
                (whole_units(latest.wealth_lost) - whole_units(carried.gold)).max(0.0);
        }
    }
    ctx.db.active_raid().owner().update(latest);
}

/// Applies the canonical Ottoman casualty bookkeeping when a persistent player
/// company, rather than a legacy raid guard, lands the finishing blow.
pub(super) fn down_external_raider(ctx: &ReducerContext, agent: &mut CombatAgent, sim_tick: u64) {
    let Some(active) = ctx
        .db
        .active_raid()
        .owner()
        .find(&agent.owner)
        .filter(|raid| raid.raid_id == agent.raid_id)
    else {
        agent.health = 0.0;
        agent.state = COMBAT_STATE_DOWNED;
        agent.engagement_target_id = 0;
        agent.state_changed_tick = sim_tick;
        agent.attack_cooldown = DOWNED_LINGER_SECONDS;
        return;
    };
    down_agent(ctx, agent, &active, sim_tick);
}

fn return_guards_and_finalize(
    ctx: &ReducerContext,
    active: ActiveRaid,
    mut agents: HashMap<u64, CombatAgent>,
    guard_routes: &GuardMusterPaths,
    sim_tick: u64,
    world_seed: u64,
    elapsed_seconds: f64,
    road_network: Option<&RoadNetwork>,
) {
    let mut guards_still_returning = 0_u32;
    for agent in agents.values_mut() {
        if is_player_military_faction(agent.faction) {
            continue;
        }
        if agent.faction != COMBAT_FACTION_GUARD {
            if agent.state == COMBAT_STATE_DOWNED {
                agent.attack_cooldown = (agent.attack_cooldown - elapsed_seconds).max(0.0);
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
                    road_network,
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
        agent.engagement_target_id = 0;
        move_guard_home(
            agent,
            guard_routes.get(&agent.source_building_id),
            GUARD_SPEED_MPS,
            elapsed_seconds,
            road_network,
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
    security.last_goods_lost = whole_units(latest.goods_lost);
    security.last_wealth_lost = whole_units(latest.wealth_lost);
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
    security.raid_approach = 0;
    security.raid_approach_offset = 0.0;
    security.warning_started_tick = 0;
    security.warning_source_tower_id = 0;
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
    road_network: Option<&RoadNetwork>,
) {
    let previous_x = agent.x;
    let previous_z = agent.z;
    if let Some(route) = muster_route {
        let direct_home_effort =
            combat_route_effort(road_network, agent.x, agent.z, agent.home_x, agent.home_z);
        let remaining_route_distance = agent.route_progress.clamp(0.0, route.path_distance);
        if agent.route_progress > EPSILON
            && !route_shortcut_is_worthwhile(
                direct_home_effort,
                remaining_route_distance,
                COMBAT_CROSS_COUNTRY_ROUTE_MULTIPLIER,
            )
        {
            let route_move = move_along_combat_route(
                agent.x,
                agent.z,
                agent.route_progress,
                route.path_distance,
                &route.polyline,
                speed_mps,
                elapsed_seconds,
                false,
                road_network,
            );
            agent.x = route_move.x;
            agent.z = route_move.z;
            agent.route_progress = route_move.progress;
            agent.velocity_x = (agent.x - previous_x) / elapsed_seconds.max(1e-9);
            agent.velocity_z = (agent.z - previous_z) / elapsed_seconds.max(1e-9);
            return;
        }
    }
    (agent.x, agent.z) = move_combatant_toward(
        agent.x,
        agent.z,
        agent.home_x,
        agent.home_z,
        speed_mps,
        elapsed_seconds,
        road_network,
    );
    agent.velocity_x = (agent.x - previous_x) / elapsed_seconds.max(1e-9);
    agent.velocity_z = (agent.z - previous_z) / elapsed_seconds.max(1e-9);
}

fn step_recovering_guard(
    ctx: &ReducerContext,
    mut agent: CombatAgent,
    muster_route: Option<&CachedCombatPath>,
    sim_tick: u64,
    elapsed_seconds: f64,
    road_network: Option<&RoadNetwork>,
) -> bool {
    if matches!(agent.state, COMBAT_STATE_MUSTERING | COMBAT_STATE_HOLDING) {
        agent.state = COMBAT_STATE_RETURNING;
        agent.engagement_target_id = 0;
        agent.state_changed_tick = sim_tick;
    }
    if agent.state == COMBAT_STATE_RETURNING {
        if distance_squared(agent.x, agent.z, agent.home_x, agent.home_z)
            <= ARRIVAL_RANGE_METERS * ARRIVAL_RANGE_METERS
        {
            return false;
        }
        move_guard_home(
            &mut agent,
            muster_route,
            GUARD_SPEED_MPS,
            elapsed_seconds,
            road_network,
        );
        ctx.db.combat_agent().id().update(agent);
        return true;
    }
    if agent.state == COMBAT_STATE_DOWNED {
        agent.velocity_x = 0.0;
        agent.velocity_z = 0.0;
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
            agent.velocity_x = 0.0;
            agent.velocity_z = 0.0;
            // This reconnect/interrupted-raid path obeys the same physical
            // equipment invariant as normal raid finalization: a wounded
            // carrier returns the issued weapon to the rack only at home.
            agent.carried_loot_json.clear();
        } else {
            (agent.x, agent.z) = move_combatant_toward(
                agent.x,
                agent.z,
                agent.home_x,
                agent.home_z,
                WOUNDED_GUARD_SPEED_MPS,
                elapsed_seconds,
                road_network,
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
    if agent.velocity_x != 0.0 || agent.velocity_z != 0.0 {
        agent.velocity_x = 0.0;
        agent.velocity_z = 0.0;
        ctx.db.combat_agent().id().update(agent);
    }
    true
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
        let polearms = stores.normalized_whole().polearms;
        if polearms > 0.0 {
            *issued.entry(agent.source_building_id).or_insert(0.0) += polearms;
        }
    }
    issued
}

pub(super) fn reclamation_from_raid_stores(stores: RaidPortableStores) -> ReclamationStock {
    let stores = stores.normalized_whole();
    ReclamationStock {
        timber: stores.timber,
        firewood: stores.firewood,
        rye_sheaves: stores.rye_sheaves,
        oat_sheaves: stores.oat_sheaves,
        barley_sheaves: stores.barley_sheaves,
        maslin_sheaves: stores.maslin_sheaves,
        rye_grain: stores.rye_grain,
        oat_grain: stores.oat_grain,
        animal_feed: stores.animal_feed,
        maslin_grain: stores.maslin_grain,
        rye_flour: stores.rye_flour,
        maslin_flour: stores.maslin_flour,
        rye_bread: stores.rye_bread,
        maslin_bread: stores.maslin_bread,
        ale: stores.ale,
        cider: stores.cider,
        pear_cider: stores.pear_cider,
        mead: stores.mead,
        honey: stores.honey,
        wax: stores.wax,
        candles: stores.candles,
        wine: stores.wine,
        ironwork: stores.ironwork,
        polearms: stores.polearms,
        sidearms: stores.sidearms,
        shields: stores.shields,
        bows: stores.bows,
        crossbows: stores.crossbows,
        padded_armor: stores.padded_armor,
        mail_armor: stores.mail_armor,
        ammunition: stores.ammunition,
        wool: stores.wool,
        cloth: stores.cloth,
        pelts: stores.pelts,
        yarn: stores.yarn,
        linen: stores.linen,
        hides: stores.hides,
        leather: stores.leather,
        shoes: stores.shoes,
        gold: stores.gold,
        barley: stores.barley,
        malt: stores.malt,
        flax: stores.flax,
        iron: stores.iron,
        clay: stores.clay,
        salt: stores.salt,
        charcoal: stores.charcoal,
        pottery: stores.pottery,
        roof_tiles: stores.roof_tiles,
        remedies: stores.remedies,
        meat: stores.meat,
        fish: stores.fish,
        berries: stores.berries,
        mushrooms: stores.mushrooms,
        milk: stores.milk,
        apples: stores.apples,
        cherries: stores.cherries,
        eggs: stores.eggs,
        grapes: stores.grapes,
        cured_meat: stores.cured_meat,
        smoked_fish: stores.smoked_fish,
        cheese: stores.cheese,
        pears: stores.pears,
        aronia: stores.aronia,
        rosehips: stores.rosehips,
        cabbage: stores.cabbage,
        carrots: stores.carrots,
        beetroot: stores.beetroot,
        aronia_jam: stores.aronia_jam,
        rosehip_jam: stores.rosehip_jam,
        ..ReclamationStock::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spread_guard_targets_do_not_twist_shared_raider_missile_line() {
        let frame = RaiderRangedFrame {
            owner: Identity::ZERO,
            raid_id: 71,
            source_x: 0.0,
            source_z: 0.0,
            target_x: 24.0,
            target_z: 0.0,
            member_count: 4,
        };
        let first = frame.goal(3, 12.0);
        let second = frame.goal(7, 12.0);
        assert!((first.0 - second.0).abs() <= 1e-12);
        assert!((first.1 - second.1).abs() > 1.4);

        // These are the soldiers' deliberately spread damage targets.
        // Per-target construction rotates their x coordinates; the shared
        // raid frame above keeps a single company heading instead.
        let independently_twisted_a = ranged_firing_line_goal(0, 4, 0.0, 0.0, 18.0, -8.0, 12.0);
        let independently_twisted_b = ranged_firing_line_goal(1, 4, 0.0, 0.0, 22.0, 9.0, 12.0);
        assert!((independently_twisted_a.0 - independently_twisted_b.0).abs() > 0.25);
    }
}
