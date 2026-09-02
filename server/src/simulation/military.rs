use std::cell::RefCell;
use std::collections::{HashMap, HashSet};

use spacetimedb::{Identity, ReducerContext};

use crate::cavalry_policy::cavalry_daily_ration;
use crate::combat_navigation::{CombatNavigation, CombatObstacle};
use crate::db::*;
use crate::economy::spend_treasury_gold;
use crate::military_policy::{
    company_wages_enabled, local_company_requires_provisions, matchup_damage_multiplier,
    formation_charge_multiplier, formation_speed_multiplier, is_front_attack,
    member_combat_profile, military_battle_end_ticks, military_day_ticks,
    military_level_for_experience, military_stats, normalize_military_demands,
    rotate_formation_offset, stance_attack_interval_multiplier,
    stance_damage_multiplier, stance_fatigue_multiplier,
    stance_speed_multiplier, veteran_damage_multiplier,
    veteran_health_multiplier, incoming_company_damage_multiplier, recoverable_ammunition_bundles,
    CompanyDefense, IncomingMilitaryAttack, MilitaryKind, MERCENARY_IDLE_DEPARTURE_DAYS,
    MILITARY_BATTLE_SURVIVAL_XP, MILITARY_ENEMY_COMPANY_XP, MILITARY_FORMATION_BRACE,
    MILITARY_STANCE_GIVE_GROUND, MILITARY_STANCE_STAND_GROUND,
};
use crate::raid_agent_policy::{
    ottoman_raider_is_mounted, ottoman_raider_is_ranged, ottoman_raider_role,
    playable_half_for_map_size, route_progress_for_position, COMBAT_ROAD_SPEED_MULTIPLIER, COMBAT_WADING_SPEED_MULTIPLIER,
    OTTOMAN_ROLE_AKINCI, OTTOMAN_ROLE_AZAB, OTTOMAN_ROLE_JANISSARY, OTTOMAN_ROLE_SIPAHI,
};
use crate::roads::RoadNetwork;
use crate::security_policy::RaidPortableStores;
use crate::tables::{
    cavalry_horse, mercenary_contract, CombatAgent, Corpse, MercenaryContract, MilitaryCompany,
    MilitaryMember,
};

use super::bandits::destroy_camp;
use super::delivery_trips::deserialize_route_polyline;
use super::military_steering::{
    melee_engagement_goal, raider_ranged_firing_line_goal, ranged_firing_line_goal,
    rebuild_dense_engagement_ranks, CombatSteeringGrid, DenseEngagementRank, EngagementRankKey,
    EngagementRankSeed, SteeringBody, SteeringBounds,
};
use super::raid_agents::{
    collect_raider_ranged_frames, down_external_raider,
    reclamation_from_raid_stores, RaiderRangedFrame,
};
use super::reclamation::recover_stock_at;
use super::SharedRoadNetworks;

const RAIDER: u8 = 1;
const BANDIT: u8 = 2;
const FOX: u8 = 13;
const WOLF: u8 = 14;
const ADVANCING: u8 = 0;
const FIGHTING: u8 = 1;
const LOOTING: u8 = 2;
const RETREATING: u8 = 3;
const RETURNING: u8 = 4;
const DOWNED: u8 = 5;
const MUSTERING: u8 = 8;
const HOLDING: u8 = 9;
const ARRIVAL_DISTANCE: f64 = 2.3;
const FORMATION_ARRIVAL_DISTANCE: f64 = 0.18;
const DOWNED_LINGER_SECONDS: f64 = 7.0;

thread_local! {
    static COMBAT_NAVIGATION: RefCell<HashMap<Identity, CombatNavigation>> = RefCell::new(HashMap::new());
    /// Reducer-local reusable storage. Spacetime reducers are transactionally
    /// serialized, while thread-local ownership avoids a global lock and keeps
    /// the hot vectors allocated between scheduler heartbeats.
    static COMBAT_STEERING_GRID: RefCell<CombatSteeringGrid> =
        RefCell::new(CombatSteeringGrid::default());
    /// Canonical movement starts from the same pre-heartbeat state for every
    /// faction. Behavior reducers may still advance their routes and resolve
    /// combat first, but their provisional displacement is replaced by the
    /// single steering integration at the end of the heartbeat.
    static COMBAT_MOTION_FRAME: RefCell<CombatMotionFrame> =
        RefCell::new(CombatMotionFrame::default());
    static MILITARY_SCRATCH: RefCell<MilitaryScratch> =
        RefCell::new(MilitaryScratch::default());
}

#[derive(Clone, Copy, Default)]
struct RangedCompanyFrame {
    company_id: u64,
    source_x: f64,
    source_z: f64,
    target_x: f64,
    target_z: f64,
}

#[derive(Default)]
struct MilitaryScratch {
    members: Vec<MilitaryMember>,
    ranged_frames: Vec<RangedCompanyFrame>,
    combatants: Vec<CombatAgent>,
    raider_ranged_frames: Vec<RaiderRangedFrame>,
    engagement_rank_seeds: Vec<EngagementRankSeed>,
    engagement_rank_counts: HashMap<EngagementRankKey, usize>,
    engagement_ranks: Vec<DenseEngagementRank>,
}

impl MilitaryScratch {
    fn ranged_frame(&self, company_id: u64) -> Option<RangedCompanyFrame> {
        self.ranged_frames
            .binary_search_by_key(&company_id, |frame| frame.company_id)
            .ok()
            .map(|index| self.ranged_frames[index])
    }

    fn engagement_rank(&self, agent_id: u64) -> Option<DenseEngagementRank> {
        self.engagement_ranks
            .binary_search_by_key(&agent_id, |entry| entry.agent_id)
            .ok()
            .map(|index| self.engagement_ranks[index])
    }
}

#[derive(Clone, Copy, Default)]
struct CombatMotionSnapshot {
    id: u64,
    x: f64,
    z: f64,
    velocity_x: f64,
    velocity_z: f64,
    route_progress: f64,
}

#[derive(Default)]
struct CombatMotionFrame {
    snapshots: Vec<CombatMotionSnapshot>,
    captured: bool,
}

impl CombatMotionFrame {
    fn capture(&mut self, ctx: &ReducerContext) {
        self.snapshots.clear();
        self.snapshots.extend(
            ctx.db
                .combat_agent()
                .iter()
                .filter(|agent| agent.state != DOWNED && agent.health > 0.0)
                .map(|agent| CombatMotionSnapshot {
                    id: agent.id,
                    x: agent.x,
                    z: agent.z,
                    velocity_x: agent.velocity_x,
                    velocity_z: agent.velocity_z,
                    route_progress: agent.route_progress,
                }),
        );
        self.snapshots.sort_unstable_by_key(|snapshot| snapshot.id);
        self.captured = true;
    }

    fn get(&self, id: u64) -> Option<CombatMotionSnapshot> {
        self.snapshots
            .binary_search_by_key(&id, |snapshot| snapshot.id)
            .ok()
            .map(|index| self.snapshots[index])
    }
}

/// Capture every existing living combatant before any faction-specific mover
/// runs. New bodies created later in the same heartbeat remain stationary
/// until the next frame rather than receiving an accidental second step.
pub fn capture_combat_motion_frame(ctx: &ReducerContext) {
    COMBAT_MOTION_FRAME.with(|cell| cell.borrow_mut().capture(ctx));
}

fn prepare_military_scratch(
    ctx: &ReducerContext,
    steering: &CombatSteeringGrid,
    scratch: &mut MilitaryScratch,
) {
    scratch.members.clear();
    scratch.members.extend(ctx.db.military_member().iter());
    scratch.members.sort_unstable_by(|left, right| {
        left.company_id
            .cmp(&right.company_id)
            .then_with(|| left.combat_agent_id.cmp(&right.combat_agent_id))
    });
    scratch.ranged_frames.clear();
    let mut start = 0;
    while start < scratch.members.len() {
        let company_id = scratch.members[start].company_id;
        let mut end = start + 1;
        while end < scratch.members.len() && scratch.members[end].company_id == company_id {
            end += 1;
        }
        if let Some(frame) =
            build_ranged_company_frame(ctx, steering, company_id, &scratch.members[start..end])
        {
            scratch.ranged_frames.push(frame);
        }
        start = end;
    }
    refresh_combat_scratch(ctx, scratch);
}

fn refresh_combat_scratch(ctx: &ReducerContext, scratch: &mut MilitaryScratch) {
    scratch.combatants.clear();
    scratch.combatants.extend(ctx.db.combat_agent().iter());
    scratch.combatants.sort_unstable_by(|left, right| {
        left.source_slot
            .cmp(&right.source_slot)
            .then_with(|| left.id.cmp(&right.id))
    });
    collect_raider_ranged_frames(&scratch.combatants, &mut scratch.raider_ranged_frames);
    scratch.engagement_rank_seeds.clear();
    for agent in scratch
        .combatants
        .iter()
        .filter(|agent| agent.state != DOWNED && agent.health > 0.0)
    {
        let target_id = combat_engagement_target(agent);
        if target_id == 0 || !combatant_uses_melee_rank(ctx, agent) {
            continue;
        }
        let (group_kind, group_id) = combat_group_key(ctx, agent);
        scratch.engagement_rank_seeds.push(EngagementRankSeed {
            agent_id: agent.id,
            key: EngagementRankKey {
                owner_group: identity_group(agent.owner),
                group_kind,
                group_id,
                target_id,
            },
        });
    }
    rebuild_dense_engagement_ranks(
        &scratch.engagement_rank_seeds,
        &mut scratch.engagement_rank_counts,
        &mut scratch.engagement_ranks,
    );
}

fn build_ranged_company_frame(
    ctx: &ReducerContext,
    steering: &CombatSteeringGrid,
    company_id: u64,
    members: &[MilitaryMember],
) -> Option<RangedCompanyFrame> {
    let company = ctx.db.military_company().id().find(&company_id)?;
    let kind = MilitaryKind::from_id(company.kind)?;
    if !kind.is_ranged() {
        return None;
    }
    let mut source_x = 0.0;
    let mut source_z = 0.0;
    let mut living = 0_usize;
    let mut leader_id = 0_u64;
    let mut retained_target_id = 0_u64;
    for member in members {
        let Some(index) = steering.index_of(member.combat_agent_id) else {
            continue;
        };
        let body = steering.body(index);
        source_x += body.x;
        source_z += body.z;
        living += 1;
        if leader_id == 0 {
            leader_id = member.combat_agent_id;
        }
        if retained_target_id == 0 {
            retained_target_id = ctx
                .db
                .combat_agent()
                .id()
                .find(&member.combat_agent_id)
                .map_or(0, |agent| agent.engagement_target_id);
        }
    }
    if living == 0 || leader_id == 0 {
        return None;
    }
    source_x /= living as f64;
    source_z /= living as f64;
    let retained_valid = (retained_target_id != 0)
        .then(|| ctx.db.combat_agent().id().find(&retained_target_id))
        .flatten()
        .filter(|target| {
            target.owner == company.owner
                && matches!(target.faction, RAIDER | BANDIT | FOX | WOLF)
                && target.state != DOWNED
                && target.health > 0.0
                && distance(source_x, source_z, target.x, target.z)
                    <= military_stats(kind).acquisition_range * 1.35
        })
        .map(|target| target.id);
    let target_id = retained_valid.or_else(|| {
        steering.nearest_matching_id(
            leader_id,
            military_stats(kind).acquisition_range,
            |_, faction, _| matches!(faction, RAIDER | BANDIT | FOX | WOLF),
        )
    })?;
    let target = steering.body(steering.index_of(target_id)?);
    Some(RangedCompanyFrame {
        company_id,
        source_x,
        source_z,
        target_x: target.x,
        target_z: target.z,
    })
}

pub fn step_military_world(
    ctx: &ReducerContext,
    sim_tick: u64,
    elapsed_seconds: f64,
    road_networks: Option<&SharedRoadNetworks>,
) {
    if !elapsed_seconds.is_finite() || elapsed_seconds <= 0.0 {
        return;
    }
    COMBAT_NAVIGATION.with(|cell| {
        let owners = ctx.db.combat_agent().iter().map(|agent| agent.owner).collect::<HashSet<_>>();
        let mut navigation = cell.borrow_mut();
        navigation.clear();
        for owner in owners {
            navigation.insert(owner, build_owner_combat_navigation(
                ctx, owner, road_networks.and_then(|networks| networks.get(&owner)),
            ));
        }
    });
    let military_demands = ctx
        .db
        .world_config()
        .id()
        .find(&0)
        .map_or(1, |row| normalize_military_demands(row.military_demands));
    step_mercenary_contracts(ctx, sim_tick);
    step_company_upkeep(ctx, sim_tick, military_demands);
    COMBAT_MOTION_FRAME.with(|frame_cell| {
        let mut frame = frame_cell.borrow_mut();
        // Defensive fallback for direct test/debug callers. The scheduled
        // reducer always captures before hostile and animal movement.
        if !frame.captured {
            frame.capture(ctx);
        }
        COMBAT_STEERING_GRID.with(|cell| {
            let mut steering = cell.borrow_mut();
            rebuild_steering_grid(ctx, &mut steering, None, &[], &[], &[], elapsed_seconds);
            MILITARY_SCRATCH.with(|scratch_cell| {
                let mut scratch = scratch_cell.borrow_mut();
                prepare_military_scratch(ctx, &steering, &mut scratch);
                for member in scratch.members.iter().cloned() {
                    let Some(agent) = ctx.db.combat_agent().id().find(&member.combat_agent_id)
                    else {
                        ctx.db
                            .military_member()
                            .combat_agent_id()
                            .delete(member.combat_agent_id);
                        continue;
                    };
                    if agent.state == DOWNED {
                        step_downed_member(ctx, agent, member, elapsed_seconds);
                        continue;
                    }
                    let Some(company) = ctx.db.military_company().id().find(&member.company_id)
                    else {
                        recover_member_kit(ctx, &agent);
                        ctx.db.militia_order().combat_agent_id().delete(agent.id);
                        ctx.db.military_member().combat_agent_id().delete(agent.id);
                        ctx.db.combat_agent().id().delete(agent.id);
                        continue;
                    };
                    let melee_rank_hint = scratch.engagement_rank(agent.id);
                    let road_network = road_networks.and_then(|networks| networks.get(&agent.owner));
                    match member.phase {
                        0 => step_mustering_member(
                            ctx,
                            agent,
                            member,
                            company,
                            sim_tick,
                            elapsed_seconds,
                            road_network,
                        ),
                        2 | 3 | 4 => {
                            step_returning_member(
                                ctx,
                                agent,
                                member,
                                company,
                                elapsed_seconds,
                                road_network,
                            )
                        }
                        _ => {
                            let ranged_frame = scratch.ranged_frame(company.id);
                            step_active_member(
                                ctx,
                                agent,
                                member,
                                company,
                                sim_tick,
                                elapsed_seconds,
                                military_demands,
                                &steering,
                                ranged_frame,
                                melee_rank_hint,
                                road_network,
                            )
                        }
                    }
                }

                // Goals and state decisions are now final, but the grid is rebuilt
                // from the shared pre-heartbeat snapshot. The final write replaces
                // every provisional faction displacement with one synchronous
                // integration, preventing two fast bodies from swapping sides
                // before predictive avoidance sees them.
                refresh_combat_scratch(ctx, &mut scratch);
                rebuild_steering_grid(
                    ctx,
                    &mut steering,
                    Some(&frame),
                    &scratch.ranged_frames,
                    &scratch.raider_ranged_frames,
                    &scratch.engagement_ranks,
                    elapsed_seconds,
                );
                apply_global_combat_steering(ctx, &mut steering, &frame, elapsed_seconds);
            });
        });
        frame.captured = false;
    });
    refresh_company_summaries(ctx, sim_tick, elapsed_seconds, military_demands);
}

/// Equip at the source, then physically join the surviving field ranks. Only
/// newcomers receive a move; existing combat/withdrawal orders remain intact.
pub(super) fn join_mustered_members(
    ctx: &ReducerContext,
    company: &MilitaryCompany,
    joining_ids: &[u64],
) {
    let Some(kind) = MilitaryKind::from_id(company.kind) else { return; };
    let mut agents = ctx.db.military_member().company_id().filter(&company.id)
        .filter(|member| member.phase == 1)
        .filter_map(|member| ctx.db.combat_agent().id().find(&member.combat_agent_id))
        .filter(|agent| agent.state != DOWNED && agent.health > 0.0)
        .collect::<Vec<_>>();
    agents.sort_by_key(|agent| (agent.source_slot, agent.id));
    let veterans = agents.iter().filter(|agent| !joining_ids.contains(&agent.id)).collect::<Vec<_>>();
    let anchors = if veterans.is_empty() { agents.iter().collect::<Vec<_>>() } else { veterans };
    if anchors.is_empty() { return; }
    let center = anchors.iter().fold((0.0, 0.0), |sum, agent| (sum.0 + agent.x, sum.1 + agent.z));
    let center = (center.0 / anchors.len() as f64, center.1 / anchors.len() as f64);
    let navigation = build_owner_combat_navigation(ctx, company.owner, None);
    let count = agents.len() as u32;
    for (rank, mut agent) in agents.into_iter().enumerate() {
        agent.source_slot = rank as u32;
        if joining_ids.contains(&agent.id) {
            let local = crate::military_policy::formation_offset_for_kind(kind, company.formation, rank as u32, count);
            let offset = rotate_formation_offset(local.0, local.1, company.facing_x, company.facing_z);
            let goal = navigation.outside((center.0 + offset.0, center.1 + offset.1));
            ctx.db.militia_order().combat_agent_id().delete(agent.id);
            ctx.db.militia_order().insert(crate::tables::MilitiaOrder {
                combat_agent_id: agent.id, owner: company.owner, kind: 0,
                destination_x: goal.0, destination_z: goal.1,
                target_camp_id: 0, target_agent_id: 0,
                path_distance: 0.0, route_polyline_json: String::new(),
            });
            agent.state = ADVANCING;
        }
        ctx.db.combat_agent().id().update(agent);
    }
}

fn step_mustering_member(
    ctx: &ReducerContext,
    mut agent: CombatAgent,
    mut member: MilitaryMember,
    company: MilitaryCompany,
    tick: u64,
    dt: f64,
    road_network: Option<&RoadNetwork>,
) {
    let Some(source) = ctx.db.building().id().find(&company.source_building_id) else {
        begin_forced_return(ctx, &mut agent, &mut member);
        return;
    };
    let kind = MilitaryKind::from_id(company.kind);
    if kind.is_some_and(MilitaryKind::is_mounted) {
        let Some(horse) = ctx
            .db
            .cavalry_horse()
            .assigned_combat_agent_id()
            .filter(&agent.id)
            .next()
        else {
            begin_forced_return(ctx, &mut agent, &mut member);
            return;
        };
        if horse.at_pasture {
            let Some(pasture) = ctx.db.pasture().id().find(&horse.pasture_id) else {
                begin_forced_return(ctx, &mut agent, &mut member);
                return;
            };
            let (pasture_x, pasture_z) = crate::reducers::cavalry_horses::pasture_center(&pasture);
            walk(&mut agent, pasture_x, pasture_z, 2.25, dt, road_network);
            agent.state = MUSTERING;
            agent.target_kind = 10;
            agent.target_id = pasture.id;
            if distance(agent.x, agent.z, pasture_x, pasture_z) <= ARRIVAL_DISTANCE {
                crate::reducers::cavalry_horses::set_horse_at_pasture(ctx, horse, false);
                agent.velocity_x = 0.0;
                agent.velocity_z = 0.0;
            }
            ctx.db.combat_agent().id().update(agent);
            return;
        }
    }
    let muster_speed = kind.map(|kind| military_stats(kind).speed).unwrap_or(2.25);
    walk(&mut agent, source.x, source.z, muster_speed, dt, road_network);
    agent.state = MUSTERING;
    agent.target_kind = 0;
    agent.target_id = source.id;
    if distance(agent.x, agent.z, source.x, source.z) <= ARRIVAL_DISTANCE {
        agent.state = HOLDING;
        agent.velocity_x = 0.0;
        agent.velocity_z = 0.0;
        agent.target_kind = 6;
        agent.target_id = 0;
        agent.state_changed_tick = tick;
    }
    ctx.db.combat_agent().id().update(agent);
}

fn step_returning_member(
    ctx: &ReducerContext,
    mut agent: CombatAgent,
    mut member: MilitaryMember,
    company: MilitaryCompany,
    dt: f64,
    road_network: Option<&RoadNetwork>,
) {
    agent.engagement_target_id = 0;
    if member.phase == 2 {
        if MilitaryKind::from_id(company.kind) == Some(MilitaryKind::MercenarySpears) {
            let exit_x = member.original_home_x;
            let exit_z = member.original_home_z;
            walk(&mut agent, exit_x, exit_z, 2.35, dt, road_network);
            agent.home_x = exit_x;
            agent.home_z = exit_z;
            agent.target_kind = 6;
            agent.target_id = 0;
            agent.state = RETURNING;
            agent.route_progress = distance(agent.x, agent.z, exit_x, exit_z);
            if agent.route_progress > ARRIVAL_DISTANCE {
                ctx.db.combat_agent().id().update(agent);
            } else {
                // Surviving contractors take their personal kit out through
                // the edge where they originally entered. Battlefield drops
                // remain local reclamation sites.
                finish_member_return(ctx, &agent, &company);
            }
            return;
        }
        if let Some(source) = ctx.db.building().id().find(&company.source_building_id) {
            let return_speed = MilitaryKind::from_id(company.kind)
                .map(|kind| military_stats(kind).speed)
                .unwrap_or(2.2);
            walk(&mut agent, source.x, source.z, return_speed, dt, road_network);
            agent.state = RETURNING;
            if distance(agent.x, agent.z, source.x, source.z) > ARRIVAL_DISTANCE {
                ctx.db.combat_agent().id().update(agent);
                return;
            }
            recover_member_kit_at(ctx, &mut agent, source.x, source.z);
            let paired_horse = ctx
                .db
                .cavalry_horse()
                .assigned_combat_agent_id()
                .filter(&agent.id)
                .next();
            if let Some(horse) = paired_horse {
                if horse.pasture_id > 0
                    && ctx.db.pasture().id().find(&horse.pasture_id).is_some()
                {
                    member.phase = 4;
                    agent.target_kind = 10;
                    agent.target_id = horse.pasture_id;
                    agent.velocity_x = 0.0;
                    agent.velocity_z = 0.0;
                    ctx.db
                        .military_member()
                        .combat_agent_id()
                        .update(member);
                    ctx.db.combat_agent().id().update(agent);
                    return;
                }
                release_mount_for_agent(ctx, agent.id, false);
            }
        } else {
            recover_member_kit(ctx, &agent);
            agent.carried_loot_json.clear();
        }
        if member.residence_id == 0 {
            finish_member_return(ctx, &agent, &company);
            return;
        }
        member.phase = 3;
        ctx.db
            .military_member()
            .combat_agent_id()
            .update(member.clone());
    }

    if member.phase == 4 {
        let Some(mut horse) = ctx
            .db
            .cavalry_horse()
            .assigned_combat_agent_id()
            .filter(&agent.id)
            .next()
        else {
            member.phase = 3;
            ctx.db
                .military_member()
                .combat_agent_id()
                .update(member.clone());
            return;
        };
        let Some(pasture) = ctx.db.pasture().id().find(&horse.pasture_id) else {
            release_mount_for_agent(ctx, agent.id, false);
            member.phase = 3;
            ctx.db
                .military_member()
                .combat_agent_id()
                .update(member.clone());
            return;
        };
        let (pasture_x, pasture_z) = crate::reducers::cavalry_horses::pasture_center(&pasture);
        let return_speed = MilitaryKind::from_id(company.kind)
            .map(|kind| military_stats(kind).speed)
            .unwrap_or(2.2);
        walk(&mut agent, pasture_x, pasture_z, return_speed, dt, road_network);
        agent.state = RETURNING;
        agent.target_kind = 10;
        agent.target_id = pasture.id;
        if distance(agent.x, agent.z, pasture_x, pasture_z) > ARRIVAL_DISTANCE {
            ctx.db.combat_agent().id().update(agent);
            return;
        }
        horse.at_pasture = true;
        horse.assigned_company_id = 0;
        horse.assigned_combat_agent_id = 0;
        let pasture_id = horse.pasture_id;
        ctx.db.cavalry_horse().id().update(horse);
        crate::reducers::cavalry_horses::sync_horse_pasture_herd(ctx, pasture_id);
        member.phase = 3;
        agent.velocity_x = 0.0;
        agent.velocity_z = 0.0;
        ctx.db
            .military_member()
            .combat_agent_id()
            .update(member.clone());
        ctx.db.combat_agent().id().update(agent);
        return;
    }

    let (home_id, home_x, home_z) = resolve_return_home(ctx, &mut member, &agent);
    if home_id == 0 {
        // A homeless veteran joins the unhoused population abstraction at the
        // Town Hall rather than remaining an immortal military reservation.
        finish_member_return(ctx, &agent, &company);
        return;
    }
    walk(&mut agent, home_x, home_z, 2.15, dt, road_network);
    agent.home_x = home_x;
    agent.home_z = home_z;
    agent.raid_anchor_building_id = home_id;
    agent.resident_slot = member.resident_slot;
    agent.target_kind = 1;
    agent.target_id = home_id;
    agent.state = RETURNING;
    if distance(agent.x, agent.z, home_x, home_z) <= ARRIVAL_DISTANCE {
        finish_member_return(ctx, &agent, &company);
    } else {
        ctx.db.military_member().combat_agent_id().update(member);
        ctx.db.combat_agent().id().update(agent);
    }
}

fn step_active_member(
    ctx: &ReducerContext,
    mut agent: CombatAgent,
    mut member: MilitaryMember,
    company: MilitaryCompany,
    tick: u64,
    dt: f64,
    military_demands: u8,
    steering: &CombatSteeringGrid,
    ranged_frame: Option<RangedCompanyFrame>,
    melee_rank_hint: Option<DenseEngagementRank>,
    road_network: Option<&RoadNetwork>,
) {
    if company.state >= 2 {
        member.phase = 2;
        ctx.db.military_member().combat_agent_id().update(member);
        agent.state = RETURNING;
        agent.engagement_target_id = 0;
        ctx.db.combat_agent().id().update(agent);
        return;
    }
    let Some(kind) = MilitaryKind::from_id(company.kind) else {
        return;
    };
    debug_assert_eq!(agent.faction, kind.faction());
    let stats = military_stats(kind);
    agent.attack_cooldown = (agent.attack_cooldown - dt).max(0.0);

    if company.morale < 0.16 || agent.health / agent.max_health.max(1.0) < 0.18 {
        agent.engagement_target_id = 0;
        ctx.db.militia_order().combat_agent_id().delete(agent.id);
        if let Some(source) = ctx.db.building().id().find(&company.source_building_id) {
            walk(
                &mut agent,
                source.x,
                source.z,
                stats.speed * 1.1,
                dt,
                road_network,
            );
            agent.state = RETREATING;
            if distance(agent.x, agent.z, source.x, source.z) <= ARRIVAL_DISTANCE {
                agent.state = HOLDING;
                agent.velocity_x = 0.0;
                agent.velocity_z = 0.0;
            }
        }
        regenerate_out_of_combat_health(&mut agent, dt);
        ctx.db.combat_agent().id().update(agent);
        return;
    }

    // A deliberate terrain move is authoritative until this member reaches
    // its formation-relative destination. Without this early branch, nearby
    // auto-acquisition silently replaced withdrawal and reposition orders,
    // making RTS control disappear exactly when contact began. Camp attacks
    // remain interruptible so defenders can be fought on the approach.
    if let Some(order) = ctx
        .db
        .militia_order()
        .combat_agent_id()
        .find(&agent.id)
        .filter(|order| order.kind == 0)
    {
        agent.engagement_target_id = 0;
        agent.target_kind = 6;
        agent.target_id = 0;
        let remaining = distance(agent.x, agent.z, order.destination_x, order.destination_z);
        if remaining > FORMATION_ARRIVAL_DISTANCE {
            let profile = member_combat_profile(kind, member_seed(&member));
            let run_scale = if remaining > 14.0 && company.fatigue < 0.82 {
                1.45
            } else {
                1.0
            };
            walk_order_route(
                steering,
                &mut agent,
                &order,
                stats.speed
                    * profile.speed_scale
                    * run_scale
                    * formation_speed_multiplier(company.formation)
                    * stance_speed_multiplier(company.stance),
                dt,
                road_network,
            );
            agent.state = ADVANCING;
        } else {
            ctx.db.militia_order().combat_agent_id().delete(agent.id);
            agent.state = HOLDING;
            agent.velocity_x = 0.0;
            agent.velocity_z = 0.0;
            agent.route_progress = 0.0;
        }
        regenerate_out_of_combat_health(&mut agent, dt);
        ctx.db.combat_agent().id().update(agent);
        return;
    }

    let direct_order = ctx
        .db
        .militia_order()
        .combat_agent_id()
        .find(&agent.id)
        .filter(|order| order.kind == 2);
    let direct_enemy = direct_order.as_ref().and_then(|order| {
        ctx.db
            .combat_agent()
            .id()
            .find(&order.target_agent_id)
            .filter(|enemy| {
                enemy.owner == agent.owner
                    && matches!(enemy.faction, RAIDER | BANDIT | FOX | WOLF)
                    && enemy.state != DOWNED
                    && enemy.health > 0.0
            })
    });
    if direct_order.is_some() && direct_enemy.is_none() {
        ctx.db.militia_order().combat_agent_id().delete(agent.id);
        agent.engagement_target_id = 0;
    }

    // Each soldier retains a live nearby opponent, otherwise choosing the
    // nearest bounded-grid contact. Deterministic engagement rings distribute
    // the company's physical approach even when several ranks share that
    // opponent; flock steering keeps the unselectable soldiers coherent.
    if let Some(mut enemy) = direct_enemy
        .clone()
        .or_else(|| retained_or_nearest_enemy(ctx, steering, &agent, stats.acquisition_range))
    {
        let range = distance(agent.x, agent.z, enemy.x, enemy.z);
        agent.target_kind = 7;
        agent.target_id = enemy.id;
        agent.engagement_target_id = enemy.id;
        let ranged_kind = kind.is_ranged();
        let can_shoot = ranged_kind && member.ammunition > 0;
        let strike_range = if can_shoot { stats.strike_range } else { 2.15 };
        if direct_enemy.is_some() && range > stats.acquisition_range * 0.72 {
            let local = crate::military_policy::formation_offset_for_kind(
                kind,
                company.formation,
                agent.source_slot,
                company.target_size.max(company.living_members).max(1),
            );
            let offset = rotate_formation_offset(
                local.0,
                local.1,
                company.facing_x,
                company.facing_z,
            );
            walk_flocked(
                steering,
                &mut agent,
                enemy.x + offset.0,
                enemy.z + offset.1,
                stats.speed
                    * formation_speed_multiplier(company.formation)
                    * stance_speed_multiplier(company.stance),
                dt,
                road_network,
            );
            agent.route_progress = range;
            agent.state = ADVANCING;
            agent.target_kind = 7;
            agent.target_id = enemy.id;
            agent.engagement_target_id = enemy.id;
            ctx.db.combat_agent().id().update(agent);
            return;
        }
        if (company.stance == MILITARY_STANCE_STAND_GROUND
            || (company.formation == MILITARY_FORMATION_BRACE && kind.can_brace()))
            && direct_enemy.is_none()
            && range > strike_range + 0.75
        {
            agent.state = HOLDING;
            agent.velocity_x = 0.0;
            agent.velocity_z = 0.0;
            agent.engagement_target_id = 0;
            ctx.db.combat_agent().id().update(agent);
            return;
        }
        let minimum_ranged_spacing = match kind {
            MilitaryKind::Bowmen => 8.0,
            MilitaryKind::Crossbows => 7.25,
            MilitaryKind::MountedArchers => 9.5,
            _ => 0.0,
        };
        if can_shoot && range < minimum_ranged_spacing {
            // A missile line should not politely wait for swords to reach it.
            // Retire while reloading/drawing, then resume fire once it has
            // rebuilt enough spacing.  Ammunition exhaustion disables this
            // branch and lets the member commit with the fallback sidearm.
            let (threat_x, threat_z) = ranged_frame
                .map(|frame| (frame.target_x, frame.target_z))
                .unwrap_or((enemy.x, enemy.z));
            walk_away(
                &mut agent,
                threat_x,
                threat_z,
                stats.speed * 0.78 * stance_speed_multiplier(company.stance),
                dt,
                road_network,
            );
            agent.route_progress = range;
            // This is a fighting withdrawal, not a morale retreat or a new
            // charge. Keeping the combat state prevents flee animations and
            // rout/charge voice cues from firing while archers reload.
            agent.state = FIGHTING;
        } else if range > strike_range {
            let run_scale = if range > 13.0 && company.fatigue < 0.82 {
                1.28
            } else {
                1.0
            };
            let source_rank = agent.source_slot as usize;
            let movement_goal = if can_shoot {
                let frame = ranged_frame.unwrap_or(RangedCompanyFrame {
                    company_id: company.id,
                    source_x: agent.x,
                    source_z: agent.z,
                    target_x: enemy.x,
                    target_z: enemy.z,
                });
                ranged_firing_line_goal(
                    source_rank,
                    company.living_members.max(1) as usize,
                    frame.source_x,
                    frame.source_z,
                    frame.target_x,
                    frame.target_z,
                    stats.strike_range,
                )
            } else {
                let engagement_rank = melee_rank_hint
                    .filter(|hint| hint.target_id == enemy.id)
                    .map_or(source_rank, |hint| hint.rank);
                melee_engagement_goal(
                    company.id,
                    enemy.id,
                    engagement_rank,
                    enemy.x,
                    enemy.z,
                    strike_range,
                )
            };
            walk_flocked(
                steering,
                &mut agent,
                movement_goal.0,
                movement_goal.1,
                stats.speed
                    * run_scale
                    * formation_speed_multiplier(company.formation)
                    * stance_speed_multiplier(company.stance),
                dt,
                road_network,
            );
            agent.route_progress = range;
            agent.state = ADVANCING;
        } else {
            let charged_into_contact = !can_shoot
                && agent.state == ADVANCING
                && agent.velocity_x.hypot(agent.velocity_z) >= stats.speed * 0.55;
            let enemy_was_advancing = enemy.state == ADVANCING;
            let enemy_was_charging = enemy_was_advancing
                && enemy.velocity_x.hypot(enemy.velocity_z) >= 1.0;
            let defender_was_stationary = agent.state != ADVANCING
                && agent.velocity_x.hypot(agent.velocity_z) < 0.25;
            agent.route_progress = 0.0;
            agent.state = FIGHTING;
            if company.stance == MILITARY_STANCE_GIVE_GROUND && !kind.is_mounted() {
                walk_away(
                    &mut agent,
                    enemy.x,
                    enemy.z,
                    stats.speed * 0.24,
                    dt,
                    road_network,
                );
            } else {
                agent.velocity_x = 0.0;
                agent.velocity_z = 0.0;
            }
            enemy.state = FIGHTING;
            enemy.engagement_target_id = agent.id;
            if agent.attack_cooldown <= 0.0 {
                let readiness = (0.55 + company.morale * 0.25 + company.cohesion * 0.20)
                    * (1.0 - company.fatigue.clamp(0.0, 0.75) * 0.45)
                    * if company.provision_days <= 0.0
                        && local_company_requires_provisions(kind, military_demands)
                    {
                        0.76
                    } else {
                        1.0
                    };
                let profile = member_combat_profile(kind, member_seed(&member));
                let exhausted_ranged_damage = match kind {
                    MilitaryKind::Crossbows
                    | MilitaryKind::Bowmen
                    | MilitaryKind::MountedArchers => 4.0,
                    _ => stats.damage,
                };
                let raw_damage = (if ranged_kind && !can_shoot {
                    exhausted_ranged_damage
                } else {
                    stats.damage
                }) * profile.damage_scale
                    * veteran_damage_multiplier(company.level)
                    * stance_damage_multiplier(company.stance)
                    * readiness.max(0.35)
                    * if charged_into_contact {
                        (1.0 + profile.charge) * formation_charge_multiplier(company.formation)
                    } else {
                        1.0
                    };
                let damage =
                    damage_against_hostile(kind, profile.armor_penetration, &enemy, raw_damage);
                enemy.health = (enemy.health - damage).max(0.0);
                agent.attack_cooldown =
                    stats.attack_seconds * stance_attack_interval_multiplier(company.stance);
                if can_shoot {
                    member.ammunition = member.ammunition.saturating_sub(1);
                    sync_member_ammunition_kit(&mut agent, &member);
                    if let Some(mut latest) = ctx.db.military_company().id().find(&company.id) {
                        latest.ammunition = latest.ammunition.saturating_sub(1);
                        ctx.db.military_company().id().update(latest);
                    }
                    ctx.db
                        .military_member()
                        .combat_agent_id()
                        .update(member.clone());
                }
            }
            if enemy.health <= 0.0 {
                let defeated_company = hostile_company_defeated(ctx, &enemy);
                down_enemy(ctx, &mut enemy, tick);
                if defeated_company {
                    award_company_experience(ctx, company.id, MILITARY_ENEMY_COMPANY_XP);
                }
            } else {
                let hostile = hostile_profile(&enemy);
                if range > hostile.strike_range || enemy.attack_cooldown > 0.0 {
                    ctx.db.combat_agent().id().update(enemy);
                    ctx.db.combat_agent().id().update(agent);
                    return;
                }
                let hostile_damage = mitigate_player_damage(
                    kind,
                    &member,
                    &company,
                    &agent,
                    &enemy,
                    hostile.damage,
                    enemy_was_charging,
                    defender_was_stationary,
                );
                agent.health = (agent.health - hostile_damage).max(0.0);
                enemy.attack_cooldown = hostile.attack_seconds;
            }
            ctx.db.combat_agent().id().update(enemy);
            if agent.health <= 0.0 {
                down_player_member(ctx, &mut agent, &member, &company, tick);
            }
        }
    } else if let Some(order) = ctx.db.militia_order().combat_agent_id().find(&agent.id) {
        agent.engagement_target_id = 0;
        // Every member owns a formation-relative destination written by the
        // company command reducer. Preserve it even for camp attacks so the
        // formation advances as one body instead of collapsing onto one point.
        debug_assert_eq!(order.kind, 1);
        agent.target_kind = if order.kind == 1 { 5 } else { 6 };
        agent.target_id = order.target_camp_id;
        let target = (order.destination_x, order.destination_z);
        let remaining = distance(agent.x, agent.z, target.0, target.1);
        if remaining > ARRIVAL_DISTANCE {
            let profile = member_combat_profile(kind, member_seed(&member));
            let run_scale = if remaining > 14.0 && company.fatigue < 0.82 {
                1.45
            } else {
                1.0
            };
            walk_order_route(
                steering,
                &mut agent,
                &order,
                stats.speed
                    * profile.speed_scale
                    * run_scale
                    * formation_speed_multiplier(company.formation)
                    * stance_speed_multiplier(company.stance),
                dt,
                road_network,
            );
            agent.state = ADVANCING;
        } else if order.kind == 1
            && ctx
                .db
                .bandit_camp()
                .id()
                .find(&order.target_camp_id)
                .is_some_and(|camp| camp.active)
        {
            agent.state = FIGHTING;
            agent.velocity_x = 0.0;
            agent.velocity_z = 0.0;
            if strike_camp(ctx, &mut agent, &company, order.target_camp_id, tick) {
                award_company_experience(ctx, company.id, MILITARY_ENEMY_COMPANY_XP);
            }
        } else {
            agent.route_progress = 0.0;
            agent.target_kind = 6;
            agent.target_id = 0;
            agent.state = HOLDING;
            agent.velocity_x = 0.0;
            agent.velocity_z = 0.0;
        }
        if agent.state != FIGHTING {
            regenerate_out_of_combat_health(&mut agent, dt);
        }
    } else {
        agent.engagement_target_id = 0;
        agent.route_progress = 0.0;
        agent.target_kind = 6;
        agent.target_id = 0;
        agent.state = HOLDING;
        agent.velocity_x = 0.0;
        agent.velocity_z = 0.0;
        regenerate_out_of_combat_health(&mut agent, dt);
    }
    agent.readiness = (company.morale * 0.55 + company.cohesion * 0.45).clamp(0.05, 1.0);
    agent.state_changed_tick = tick;
    ctx.db.combat_agent().id().update(agent);
}

fn step_company_upkeep(ctx: &ReducerContext, tick: u64, military_demands: u8) {
    let day_ticks = military_day_ticks();
    for mut company in ctx.db.military_company().iter().collect::<Vec<_>>() {
        if company.state >= 2 || company.living_members == 0 {
            continue;
        }
        let elapsed_days = tick.saturating_sub(company.last_upkeep_tick) / day_ticks;
        if elapsed_days == 0 {
            continue;
        }
        let Some(kind) = MilitaryKind::from_id(company.kind) else {
            continue;
        };
        company.last_upkeep_tick = company
            .last_upkeep_tick
            .saturating_add(elapsed_days.saturating_mul(day_ticks));
        let (member_count, debug_member_count) = ctx
            .db
            .military_member()
            .company_id()
            .filter(&company.id)
            .fold(
                (0_u32, 0_u32),
                |(member_count, debug_member_count), member| {
                    (
                        member_count.saturating_add(1),
                        debug_member_count.saturating_add(u32::from(member.residence_id == 0)),
                    )
                },
            );
        let is_debug_company = member_count > 0 && member_count == debug_member_count;
        let requires_provisions =
            !is_debug_company && local_company_requires_provisions(kind, military_demands);
        if requires_provisions {
            company.provision_days = (company.provision_days - elapsed_days as f64).max(0.0);
        }
        if kind.is_mounted() && !is_debug_company {
            let requested_days = company.living_members as f64 * elapsed_days as f64;
            let ration = cavalry_daily_ration();
            let oats_need = requested_days * ration.oats;
            let water_need = requested_days * ration.water;
            let ratio = |stock: f64, need: f64| {
                if need <= 1e-9 {
                    1.0
                } else {
                    (stock / need).clamp(0.0, 1.0)
                }
            };
            let supply_ratio = ratio(company.horse_oats, oats_need)
                .min(ratio(company.horse_water, water_need));
            company.horse_oats = (company.horse_oats - oats_need * supply_ratio).max(0.0);
            company.horse_water = (company.horse_water - water_need * supply_ratio).max(0.0);
            if supply_ratio < 0.999 {
                let shortage = 1.0 - supply_ratio;
                company.morale = (company.morale - 0.06 * shortage * elapsed_days as f64).max(0.05);
                company.cohesion =
                    (company.cohesion - 0.04 * shortage * elapsed_days as f64).max(0.08);
            }
        }
        if !is_debug_company && company_wages_enabled(kind, military_demands) {
            let daily_wage = match kind {
                MilitaryKind::Spearmen => company.living_members.div_ceil(4),
                MilitaryKind::MenAtArms | MilitaryKind::Crossbows => {
                    company.living_members.div_ceil(2)
                }
                MilitaryKind::MercenarySpears => company.living_members,
                MilitaryKind::Footmen | MilitaryKind::Polearms | MilitaryKind::Bowmen => {
                    company.living_members.div_ceil(2)
                }
                MilitaryKind::Hussars | MilitaryKind::MountedArchers => company.living_members,
                MilitaryKind::ArmoredLancers => company.living_members.saturating_mul(2),
                MilitaryKind::Militia => 0,
            };
            let wages = daily_wage.saturating_mul(elapsed_days.min(u32::MAX as u64) as u32);
            let paid = spend_treasury_gold(ctx, company.owner, wages as f64).is_ok();
            if !paid && kind == MilitaryKind::MercenarySpears {
                request_mercenary_departure_after_engagement(ctx, &company, tick);
                continue;
            }
            if !paid {
                company.morale = (company.morale - 0.08 * elapsed_days as f64).max(0.05);
            }
        }
        if requires_provisions && company.provision_days <= 0.0 {
            company.morale = (company.morale - 0.04 * elapsed_days as f64).max(0.05);
            company.cohesion = (company.cohesion - 0.025 * elapsed_days as f64).max(0.1);
        }
        ctx.db.military_company().id().update(company);
    }
}

fn request_mercenary_departure_after_engagement(
    ctx: &ReducerContext,
    company: &MilitaryCompany,
    tick: u64,
) {
    let mut pending_company = company.clone();
    pending_company.departure_requested = true;
    ctx.db.military_company().id().update(pending_company);
    let requested = MercenaryContract {
        company_id: company.id,
        owner: company.owner,
        contract_end_tick: tick,
        last_engagement_tick: ctx
            .db
            .mercenary_contract()
            .company_id()
            .find(&company.id)
            .map_or(tick, |contract| contract.last_engagement_tick),
    };
    if ctx
        .db
        .mercenary_contract()
        .company_id()
        .find(&company.id)
        .is_some()
    {
        ctx.db
            .mercenary_contract()
            .company_id()
            .update(requested);
    } else {
        ctx.db.mercenary_contract().insert(requested);
    }
}

fn step_mercenary_contracts(ctx: &ReducerContext, tick: u64) {
    let day_ticks = military_day_ticks();
    let idle_limit = day_ticks.saturating_mul(MERCENARY_IDLE_DEPARTURE_DAYS);
    let incoming_targets = hostile_engagement_targets(ctx);
    for mut contract in ctx.db.mercenary_contract().iter().collect::<Vec<_>>() {
        let Some(mut company) = ctx
            .db
            .military_company()
            .id()
            .find(&contract.company_id)
            .filter(|company| company.kind == MilitaryKind::MercenarySpears as u8)
        else {
            ctx.db
                .mercenary_contract()
                .company_id()
                .delete(contract.company_id);
            continue;
        };
        if company.state >= 2 {
            continue;
        }
        let engaged = ctx
            .db
            .military_member()
            .company_id()
            .filter(&company.id)
            .filter(|member| member.phase == 1)
            .filter_map(|member| ctx.db.combat_agent().id().find(&member.combat_agent_id))
            .filter(|agent| agent.state != DOWNED && agent.health > 0.0)
            .any(|agent| {
                agent.state == FIGHTING
                    || agent.target_kind == 7
                    || incoming_targets.contains(&agent.id)
                    || ctx
                        .db
                        .militia_order()
                        .combat_agent_id()
                        .find(&agent.id)
                        .is_some_and(|order| order.target_camp_id > 0)
            });
        let idle_too_long = tick.saturating_sub(contract.last_engagement_tick) >= idle_limit;
        let departure_due = company.departure_requested
            || idle_too_long
            || tick >= contract.contract_end_tick;
        if engaged {
            contract.last_engagement_tick = tick;
            ctx.db.mercenary_contract().company_id().update(contract);
            if departure_due && !company.departure_requested {
                company.departure_requested = true;
                ctx.db.military_company().id().update(company);
            }
            continue;
        }
        if departure_due {
            begin_mercenary_departure(ctx, company.id);
        }
    }
}

fn begin_mercenary_departure(ctx: &ReducerContext, company_id: u64) {
    let Some(mut company) = ctx.db.military_company().id().find(&company_id) else {
        return;
    };
    if company.state >= 2 {
        return;
    }
    company.state = 2;
    company.departure_requested = false;
    ctx.db.military_company().id().update(company);
    for mut member in ctx
        .db
        .military_member()
        .company_id()
        .filter(&company_id)
        .collect::<Vec<_>>()
    {
        let Some(mut agent) = ctx.db.combat_agent().id().find(&member.combat_agent_id) else {
            continue;
        };
        if agent.state == DOWNED || agent.health <= 0.0 {
            continue;
        }
        ctx.db
            .militia_order()
            .combat_agent_id()
            .delete(member.combat_agent_id);
        member.phase = 2;
        ctx.db.military_member().combat_agent_id().update(member);
        agent.state = RETURNING;
        agent.engagement_target_id = 0;
        agent.target_kind = 6;
        agent.target_id = 0;
        agent.route_progress = distance(agent.x, agent.z, agent.home_x, agent.home_z);
        ctx.db.combat_agent().id().update(agent);
    }
}

fn refresh_company_summaries(ctx: &ReducerContext, tick: u64, dt: f64, military_demands: u8) {
    let incoming_targets = hostile_engagement_targets(ctx);
    for mut company in ctx.db.military_company().iter().collect::<Vec<_>>() {
        let members = ctx
            .db
            .military_member()
            .company_id()
            .filter(&company.id)
            .collect::<Vec<_>>();
        let mut living = 0_u32;
        let mut moving = 0_u32;
        let mut fighting = 0_u32;
        let mut health = 0.0;
        let mut ammunition = 0_u32;
        let mut ammunition_capacity = 0_u32;
        let mut facing_x = 0.0;
        let mut facing_z = 0.0;
        let mut formation_rank = 0_u32;
        for member in &members {
            let Some(mut agent) = ctx.db.combat_agent().id().find(&member.combat_agent_id) else {
                continue;
            };
            if agent.state == DOWNED {
                continue;
            }
            if member.phase == 1 {
                if agent.source_slot != formation_rank {
                    agent.source_slot = formation_rank;
                    ctx.db.combat_agent().id().update(agent.clone());
                }
                formation_rank += 1;
            }
            living += 1;
            health += agent.health / agent.max_health.max(1.0);
            ammunition = ammunition.saturating_add(member.ammunition);
            ammunition_capacity = ammunition_capacity.saturating_add(member.ammunition_capacity);
            if agent.engagement_target_id > 0 {
                if let Some(target) = ctx.db.combat_agent().id().find(&agent.engagement_target_id) {
                    let dx = target.x - agent.x;
                    let dz = target.z - agent.z;
                    let length = dx.hypot(dz);
                    if length > 1e-6 {
                        facing_x += dx / length;
                        facing_z += dz / length;
                    }
                }
            } else if ctx.db.militia_order().combat_agent_id().find(&agent.id).is_none() {
                let speed = agent.velocity_x.hypot(agent.velocity_z);
                if speed > 1e-6 {
                    facing_x += agent.velocity_x / speed;
                    facing_z += agent.velocity_z / speed;
                }
            }
            if matches!(agent.state, ADVANCING | RETREATING | RETURNING | MUSTERING) {
                moving += 1;
            }
            if agent.state == FIGHTING || incoming_targets.contains(&agent.id) {
                fighting += 1;
            }
        }
        company.living_members = living;
        company.ammunition = ammunition;
        company.ammunition_capacity = ammunition_capacity;
        let facing_length = facing_x.hypot(facing_z);
        if facing_length > 1e-6 {
            company.facing_x = facing_x / facing_length;
            company.facing_z = facing_z / facing_length;
        }
        if company.state < 2 && living > 0 {
            let exertion = (moving as f64 * 0.35 + fighting as f64) / living as f64;
            if exertion > 0.01 {
                company.fatigue = (company.fatigue
                    + dt * 0.0035 * exertion * stance_fatigue_multiplier(company.stance))
                    .min(1.0);
            } else {
                company.fatigue = (company.fatigue - dt * 0.0025).max(0.0);
                company.cohesion = (company.cohesion + dt * 0.0008).min(1.0);
                let requires_provisions = MilitaryKind::from_id(company.kind)
                    .is_some_and(|kind| local_company_requires_provisions(kind, military_demands));
                if company.provision_days > 0.0 || !requires_provisions {
                    company.morale = (company.morale + dt * 0.00045).min(1.0);
                }
            }
            let health_ratio = health / living as f64;
            company.morale = company.morale.min(0.35 + health_ratio * 0.65);

            if MilitaryKind::from_id(company.kind)
                .is_some_and(MilitaryKind::gains_veteran_experience)
            {
                if fighting > 0 {
                    if company.battle_started_tick == 0 {
                        company.battle_started_tick = tick;
                    }
                    company.last_combat_tick = tick;
                } else if company.battle_started_tick > 0
                    && tick.saturating_sub(company.last_combat_tick) >= military_battle_end_ticks()
                {
                    let previous_level = company.level.max(1);
                    company.experience = company
                        .experience
                        .saturating_add(MILITARY_BATTLE_SURVIVAL_XP);
                    company.level = military_level_for_experience(company.experience);
                    company.battle_started_tick = 0;
                    company.last_combat_tick = 0;
                    if company.level > previous_level {
                        apply_veteran_level_health(ctx, company.id, previous_level, company.level);
                    }
                }
            }
        } else if living == 0 {
            company.state = 3;
        }
        if company.state >= 2 && members.is_empty() {
            ctx.db.military_company().id().delete(company.id);
        } else {
            ctx.db.military_company().id().update(company);
        }
    }
}

fn hostile_engagement_targets(ctx: &ReducerContext) -> HashSet<u64> {
    ctx.db
        .combat_agent()
        .iter()
        .filter(|agent| {
            matches!(agent.faction, RAIDER | BANDIT | FOX | WOLF)
                && agent.state != DOWNED
                && agent.health > 0.0
                && agent.engagement_target_id > 0
        })
        .map(|agent| agent.engagement_target_id)
        .collect()
}

fn retained_or_nearest_enemy(
    ctx: &ReducerContext,
    steering: &CombatSteeringGrid,
    source: &CombatAgent,
    acquisition_range: f64,
) -> Option<CombatAgent> {
    let retention_range = acquisition_range * 1.35;
    let retained_target_id = if source.engagement_target_id != 0 {
        source.engagement_target_id
    } else if source.target_kind == 7 {
        source.target_id
    } else {
        0
    };
    if retained_target_id != 0 {
        if let Some(enemy) = ctx
            .db
            .combat_agent()
            .id()
            .find(&retained_target_id)
            .filter(|enemy| {
                enemy.owner == source.owner
                    && matches!(enemy.faction, RAIDER | BANDIT | FOX | WOLF)
                    && enemy.state != DOWNED
                    && enemy.health > 0.0
                    && distance(source.x, source.z, enemy.x, enemy.z) <= retention_range
            })
        {
            return Some(enemy);
        }
    }
    let id = steering.nearest_matching_id(source.id, acquisition_range, |_, faction, _| {
        matches!(faction, RAIDER | BANDIT | FOX | WOLF)
    })?;
    ctx.db.combat_agent().id().find(&id)
}

#[derive(Clone, Copy)]
struct HostileProfile {
    armor: f64,
    shield: f64,
    penetration: f64,
    role: u8,
    ranged: bool,
    strike_range: f64,
    damage: f64,
    attack_seconds: f64,
}

fn hostile_profile(enemy: &CombatAgent) -> HostileProfile {
    if enemy.faction == FOX || enemy.faction == WOLF {
        return HostileProfile {
            armor: 0.0,
            shield: 0.0,
            penetration: if enemy.faction == WOLF { 2.0 } else { 0.0 },
            role: 0,
            ranged: false,
            strike_range: 2.75,
            damage: if enemy.faction == WOLF { 11.0 } else { 5.0 },
            attack_seconds: 1.0,
        };
    }
    if enemy.faction == BANDIT {
        return HostileProfile {
            armor: 1.5,
            shield: 0.0,
            penetration: 1.0,
            role: 0,
            ranged: false,
            strike_range: 2.75,
            damage: 10.0,
            attack_seconds: 1.2,
        };
    }
    // Ottoman parties are mixed atomic ranks. Source slot deterministically
    // supplies light infantry, spears, armored infantry, and missile troops.
    match ottoman_raider_role(enemy.source_slot) {
        OTTOMAN_ROLE_AZAB => HostileProfile {
            armor: 3.0,
            shield: 2.0,
            penetration: 3.0,
            role: 0,
            ranged: false,
            strike_range: 2.75,
            damage: 15.0 + enemy.readiness * 4.0,
            attack_seconds: 1.9,
        },
        OTTOMAN_ROLE_JANISSARY => HostileProfile {
            armor: 9.0,
            shield: 4.0,
            penetration: 8.0,
            role: 2,
            ranged: true,
            strike_range: 12.0,
            damage: 15.0 + enemy.readiness * 4.0,
            attack_seconds: 2.0,
        },
        OTTOMAN_ROLE_AKINCI => HostileProfile {
            armor: 4.0,
            shield: 0.0,
            penetration: 5.0,
            role: 4,
            ranged: true,
            strike_range: 12.0,
            damage: 14.0 + enemy.readiness * 3.5,
            attack_seconds: 1.8,
        },
        OTTOMAN_ROLE_SIPAHI => HostileProfile {
            armor: 15.0,
            shield: 6.0,
            penetration: 9.0,
            role: 5,
            ranged: false,
            strike_range: 2.9,
            damage: 17.0 + enemy.readiness * 4.5,
            attack_seconds: 1.75,
        },
        _ => unreachable!(),
    }
}

fn mitigate_player_damage(
    kind: MilitaryKind,
    member: &MilitaryMember,
    company: &MilitaryCompany,
    defender: &CombatAgent,
    attacker: &CombatAgent,
    raw_damage: f64,
    attacker_was_charging: bool,
    defender_was_stationary: bool,
) -> f64 {
    let hostile = hostile_profile(attacker);
    let incoming_front = is_front_attack(
        company.facing_x,
        company.facing_z,
        defender.x,
        defender.z,
        attacker.x,
        attacker.z,
    );
    let mitigation = incoming_company_damage_multiplier(
        CompanyDefense {
            kind,
            member_seed: member_seed(member),
            formation: company.formation,
            stance: company.stance,
            level: company.level,
            cohesion: company.cohesion,
            stationary: defender_was_stationary,
        },
        IncomingMilitaryAttack {
            penetration: hostile.penetration,
            ranged: hostile.ranged,
            frontal: incoming_front,
            charging: attacker_was_charging,
        },
    );
    raw_damage.max(0.0) * mitigation
}

/// Resolves damage authored by another combat simulation against a recruited
/// company member through the same armor, facing, stance, and formation rules
/// as the ordinary military heartbeat.
pub(super) fn mitigate_external_player_damage(
    ctx: &ReducerContext,
    defender: &CombatAgent,
    attacker: &CombatAgent,
    raw_damage: f64,
    attacker_was_charging: bool,
) -> f64 {
    let Some(member) = ctx
        .db
        .military_member()
        .combat_agent_id()
        .find(&defender.id)
    else {
        return raw_damage.max(0.0);
    };
    let Some(company) = ctx.db.military_company().id().find(&member.company_id) else {
        return raw_damage.max(0.0);
    };
    let Some(kind) = MilitaryKind::from_id(company.kind) else {
        return raw_damage.max(0.0);
    };
    mitigate_player_damage(
        kind,
        &member,
        &company,
        defender,
        attacker,
        raw_damage,
        attacker_was_charging,
        defender.state != ADVANCING && defender.velocity_x.hypot(defender.velocity_z) < 0.25,
    )
}

fn damage_against_hostile(
    kind: MilitaryKind,
    penetration: f64,
    enemy: &CombatAgent,
    raw_damage: f64,
) -> f64 {
    let target = hostile_profile(enemy);
    let armor = (target.armor - penetration).max(0.0);
    let armor_multiplier = 1.0 / (1.0 + armor * 0.055);
    let shield_multiplier = (1.0 - target.shield * 0.018).clamp(0.70, 1.0);
    let defender_kind = match target.role {
        1 => MilitaryKind::Spearmen,
        2 => MilitaryKind::MenAtArms,
        3 => MilitaryKind::Bowmen,
        4 => MilitaryKind::MountedArchers,
        5 => MilitaryKind::ArmoredLancers,
        _ => MilitaryKind::Footmen,
    };
    let counter = matchup_damage_multiplier(kind, defender_kind);
    raw_damage * armor_multiplier * shield_multiplier * counter
}

fn member_seed(member: &MilitaryMember) -> u64 {
    member.company_id.rotate_left(31) ^ member.residence_id ^ member.resident_slot as u64
}

fn dense_engagement_rank(
    ranks: &[DenseEngagementRank],
    agent_id: u64,
    target_id: u64,
) -> Option<usize> {
    ranks
        .binary_search_by_key(&agent_id, |entry| entry.agent_id)
        .ok()
        .map(|index| ranks[index])
        .filter(|entry| entry.target_id == target_id)
        .map(|entry| entry.rank)
}

fn combat_engagement_target(agent: &CombatAgent) -> u64 {
    if agent.engagement_target_id != 0 {
        agent.engagement_target_id
    } else if agent.target_kind == 7 {
        agent.target_id
    } else {
        0
    }
}

fn combat_group_key(ctx: &ReducerContext, agent: &CombatAgent) -> (u8, u64) {
    ctx.db
        .military_member()
        .combat_agent_id()
        .find(&agent.id)
        .map_or_else(
            || match agent.faction {
                RAIDER => (2, agent.raid_id),
                BANDIT => (3, agent.raid_id),
                0 => (4, agent.source_building_id),
                FOX | WOLF => (5, agent.raid_id),
                _ => (6, agent.raid_id.max(agent.id)),
            },
            |member| (1, member.company_id),
        )
}

fn combatant_uses_melee_rank(ctx: &ReducerContext, agent: &CombatAgent) -> bool {
    if agent.faction == RAIDER && ottoman_raider_is_ranged(agent.source_slot) {
        return false;
    }
    let Some(member) = ctx.db.military_member().combat_agent_id().find(&agent.id) else {
        return true;
    };
    let Some(company) = ctx.db.military_company().id().find(&member.company_id) else {
        return true;
    };
    !matches!(
        MilitaryKind::from_id(company.kind),
        Some(MilitaryKind::Bowmen | MilitaryKind::Crossbows | MilitaryKind::MountedArchers)
    ) || member.ammunition == 0
}

fn rebuild_steering_grid(
    ctx: &ReducerContext,
    steering: &mut CombatSteeringGrid,
    motion_frame: Option<&CombatMotionFrame>,
    ranged_frames: &[RangedCompanyFrame],
    raider_ranged_frames: &[RaiderRangedFrame],
    engagement_ranks: &[DenseEngagementRank],
    elapsed_seconds: f64,
) {
    steering.begin();
    for agent in ctx.db.combat_agent().iter() {
        if agent.state == DOWNED || agent.health <= 0.0 {
            continue;
        }
        let (group_kind, group_id) = combat_group_key(ctx, &agent);
        let (mut goal_x, mut goal_z, mut speed) = canonical_steering_goal(
            ctx,
            &agent,
            motion_frame,
            ranged_frames,
            raider_ranged_frames,
            engagement_ranks,
        );
        let snapshot = motion_frame.and_then(|frame| frame.get(agent.id));
        let (x, z, velocity_x, velocity_z) = if let Some(snapshot) = snapshot {
            let intended_dx = agent.x - snapshot.x;
            let intended_dz = agent.z - snapshot.z;
            let intended_distance = intended_dx.hypot(intended_dz);
            if intended_distance > 1e-9 && elapsed_seconds > 1e-9 {
                // Preserve the exact authored path/formation/retreat choice
                // made by the faction reducer. Steering owns how that intent
                // is integrated, not which macro destination was selected.
                goal_x = agent.x;
                goal_z = agent.z;
                speed = intended_distance / elapsed_seconds;
            } else if matches!(agent.state, FIGHTING | LOOTING | HOLDING)
                && agent.engagement_target_id == 0
            {
                // Contact resolution deliberately authored no displacement.
                // In particular, a looter is already at the usable perimeter
                // of its target; steering must not reinterpret that pause as
                // a request to walk through the building to its center.
                goal_x = snapshot.x;
                goal_z = snapshot.z;
                speed = 0.0;
            }
            (
                snapshot.x,
                snapshot.z,
                snapshot.velocity_x,
                snapshot.velocity_z,
            )
        } else if motion_frame.is_some() {
            // A combatant spawned after capture is a stationary physical
            // obstacle. Hard separation may move it, and the final writer
            // persists that constrained position even without a snapshot.
            goal_x = agent.x;
            goal_z = agent.z;
            speed = 0.0;
            (agent.x, agent.z, 0.0, 0.0)
        } else if matches!(agent.state, FIGHTING | LOOTING) {
            (agent.x, agent.z, 0.0, 0.0)
        } else {
            (agent.x, agent.z, agent.velocity_x, agent.velocity_z)
        };
        steering.push(SteeringBody {
            id: agent.id,
            owner_group: identity_group(agent.owner),
            group_kind,
            group_id,
            faction: agent.faction,
            target_id: combat_engagement_target(&agent),
            x,
            z,
            goal_x,
            goal_z,
            speed,
            velocity_x,
            velocity_z,
        });
    }
    steering.finish();
}

fn canonical_steering_goal(
    ctx: &ReducerContext,
    agent: &CombatAgent,
    motion_frame: Option<&CombatMotionFrame>,
    ranged_frames: &[RangedCompanyFrame],
    raider_ranged_frames: &[RaiderRangedFrame],
    engagement_ranks: &[DenseEngagementRank],
) -> (f64, f64, f64) {
    let member = ctx.db.military_member().combat_agent_id().find(&agent.id);
    let company = member
        .as_ref()
        .and_then(|member| ctx.db.military_company().id().find(&member.company_id));
    let speed = if let Some(kind) = company
        .as_ref()
        .and_then(|company| MilitaryKind::from_id(company.kind))
    {
        military_stats(kind).speed
    } else {
        match agent.faction {
            RAIDER => {
                if ottoman_raider_is_mounted(agent.source_slot) {
                    4.85
                } else {
                    2.65
                }
            }
            BANDIT => 2.15,
            FOX => 3.35,
            WOLF => 3.0,
            _ => 2.4,
        }
    };
    if matches!(agent.state, RETREATING | RETURNING) {
        if let (Some(member), Some(company)) = (member.as_ref(), company.as_ref()) {
            if member.phase == 2 {
                if MilitaryKind::from_id(company.kind) == Some(MilitaryKind::MercenarySpears) {
                    return (member.original_home_x, member.original_home_z, speed);
                }
                if let Some(source) = ctx.db.building().id().find(&company.source_building_id) {
                    return (source.x, source.z, speed);
                }
            } else if member.phase == 4 {
                if let Some(horse) = ctx
                    .db
                    .cavalry_horse()
                    .assigned_combat_agent_id()
                    .filter(&agent.id)
                    .next()
                {
                    if let Some(pasture) = ctx.db.pasture().id().find(&horse.pasture_id) {
                        let (x, z) =
                            crate::reducers::cavalry_horses::pasture_center(&pasture);
                        return (x, z, speed);
                    }
                }
            } else if member.phase == 3 {
                if let Some(home) = ctx
                    .db
                    .residence()
                    .id()
                    .find(&member.residence_id)
                    .filter(|home| !home.abandoned)
                {
                    return (home.x, home.z, speed);
                }
            } else if agent.state == RETREATING {
                // Morale retreat keeps the member active until it reaches the
                // company's actual source building.
                if let Some(source) = ctx.db.building().id().find(&company.source_building_id) {
                    return (source.x, source.z, speed);
                }
            }
        }
        return (agent.home_x, agent.home_z, speed);
    }
    if let Some(order) = ctx.db.militia_order().combat_agent_id().find(&agent.id) {
        return (order.destination_x, order.destination_z, speed);
    }
    let engagement_target_id = if agent.engagement_target_id != 0 {
        agent.engagement_target_id
    } else if agent.target_kind == 7 {
        agent.target_id
    } else {
        0
    };
    if engagement_target_id != 0 {
        if let Some(target) = ctx.db.combat_agent().id().find(&engagement_target_id) {
            let (target_x, target_z) = motion_frame
                .and_then(|frame| frame.get(target.id))
                .map_or((target.x, target.z), |snapshot| (snapshot.x, snapshot.z));
            let (source_x, source_z) = motion_frame
                .and_then(|frame| frame.get(agent.id))
                .map_or((agent.x, agent.z), |snapshot| (snapshot.x, snapshot.z));
            if let Some(member) = member.as_ref() {
                if let Some(company) = company.as_ref() {
                    if let Some(kind) = MilitaryKind::from_id(company.kind) {
                        let stats = military_stats(kind);
                        let source_rank = agent.source_slot as usize;
                        let goal = if kind.is_ranged() && member.ammunition > 0 {
                            let shared = ranged_frames
                                .binary_search_by_key(&company.id, |frame| frame.company_id)
                                .ok()
                                .map(|index| ranged_frames[index]);
                            let (line_source_x, line_source_z, line_target_x, line_target_z) =
                                shared.map_or((source_x, source_z, target_x, target_z), |frame| {
                                    (
                                        frame.source_x,
                                        frame.source_z,
                                        frame.target_x,
                                        frame.target_z,
                                    )
                                });
                            ranged_firing_line_goal(
                                source_rank,
                                company.living_members.max(1) as usize,
                                line_source_x,
                                line_source_z,
                                line_target_x,
                                line_target_z,
                                stats.strike_range,
                            )
                        } else {
                            let engagement_rank =
                                dense_engagement_rank(engagement_ranks, agent.id, target.id)
                                    .unwrap_or(source_rank);
                            melee_engagement_goal(
                                company.id,
                                target.id,
                                engagement_rank,
                                target_x,
                                target_z,
                                stats.strike_range,
                            )
                        };
                        return (goal.0, goal.1, speed);
                    }
                }
            }
            let goal = if agent.faction == RAIDER && ottoman_raider_is_ranged(agent.source_slot) {
                raider_ranged_frames
                    .iter()
                    .copied()
                    .find(|frame| frame.matches(agent))
                    .map_or_else(
                        || {
                            raider_ranged_firing_line_goal(
                                agent.source_slot,
                                1,
                                source_x,
                                source_z,
                                target_x,
                                target_z,
                                12.0,
                            )
                        },
                        |frame| frame.goal(agent.source_slot, 12.0),
                    )
            } else {
                let engagement_rank = dense_engagement_rank(engagement_ranks, agent.id, target.id)
                    .unwrap_or(agent.source_slot as usize);
                melee_engagement_goal(
                    agent.raid_id.max(agent.source_building_id),
                    target.id,
                    engagement_rank,
                    target_x,
                    target_z,
                    2.15,
                )
            };
            return (goal.0, goal.1, speed);
        }
    }
    let target = match agent.target_kind {
        0 | 3 => ctx
            .db
            .building()
            .id()
            .find(&agent.target_id)
            .map(|target| (target.x, target.z)),
        1 | 4 => ctx
            .db
            .residence()
            .id()
            .find(&agent.target_id)
            .map(|target| (target.x, target.z)),
        2 => ctx
            .db
            .delivery_trip()
            .id()
            .find(&agent.target_id)
            .map(|target| (target.x, target.z)),
        5 => ctx
            .db
            .bandit_camp()
            .id()
            .find(&agent.target_id)
            .map(|target| (target.x, target.z)),
        10 => ctx
            .db
            .pasture()
            .id()
            .find(&agent.target_id)
            .map(|pasture| crate::reducers::cavalry_horses::pasture_center(&pasture)),
        _ => None,
    };
    if let Some((x, z)) = target {
        (x, z, speed)
    } else if agent.velocity_x.hypot(agent.velocity_z) > 1e-8 {
        let (source_x, source_z) = motion_frame
            .and_then(|frame| frame.get(agent.id))
            .map_or((agent.x, agent.z), |snapshot| (snapshot.x, snapshot.z));
        (
            source_x + agent.velocity_x,
            source_z + agent.velocity_z,
            speed,
        )
    } else {
        (agent.x, agent.z, speed)
    }
}

/// Replace every faction reducer's provisional displacement with one shared,
/// synchronous integration from the pre-heartbeat frame. Behavior/state and
/// route decisions remain authoritative, while physical coordinates advance
/// exactly once and cannot tunnel between faction-specific reducer phases.
fn apply_global_combat_steering(
    ctx: &ReducerContext,
    steering: &mut CombatSteeringGrid,
    motion_frame: &CombatMotionFrame,
    elapsed_seconds: f64,
) {
    let map_half = ctx
        .db
        .world_config()
        .id()
        .find(&0)
        .map_or(540.0, |config| playable_half_for_map_size(config.map_size));
    steering.integrate_all_bounded(
        elapsed_seconds,
        SteeringBounds {
            min_x: -map_half,
            max_x: map_half,
            min_z: -map_half,
            max_z: map_half,
        },
    );
    for index in 0..steering.len() {
        let source = steering.body(index);
        let Some(mut agent) = ctx.db.combat_agent().id().find(&source.id) else {
            continue;
        };
        if agent.state == DOWNED || agent.health <= 0.0 {
            continue;
        }
        let provisional_x = agent.x;
        let provisional_z = agent.z;
        let provisional_route_progress = agent.route_progress;
        let snapshot = motion_frame.get(agent.id);
        let final_position = COMBAT_NAVIGATION.with(|cell| {
            let navigation = cell.borrow();
            let Some(navigation) = navigation.get(&agent.owner) else { return (source.x, source.z); };
            let goal = canonical_steering_goal(ctx, &agent, None, &[], &[], &[]);
            let start = snapshot.map_or((agent.x, agent.z), |frame| (frame.x, frame.z));
            navigation.constrain_step(start, (goal.0, goal.1), (source.x, source.z))
        });
        agent.x = final_position.0;
        agent.z = final_position.1;
        if snapshot.is_some() {
            let snapshot = snapshot.expect("existing motion frame");
            agent.velocity_x = (agent.x - snapshot.x) / elapsed_seconds.max(1e-9);
            agent.velocity_z = (agent.z - snapshot.z) / elapsed_seconds.max(1e-9);
        } else {
            // Spawn-tick bodies participate in hard depenetration, but that
            // correction is not locomotion and must not seed prediction as if
            // they had intentionally moved before their first behavior tick.
            agent.velocity_x = 0.0;
            agent.velocity_z = 0.0;
        }
        if let Some(snapshot) = snapshot.filter(|_| agent.faction <= RAIDER) {
            let intended_x = provisional_x - snapshot.x;
            let intended_z = provisional_z - snapshot.z;
            let intended_length_sq = intended_x * intended_x + intended_z * intended_z;
            if intended_length_sq > 1e-12 {
                let final_x = agent.x - snapshot.x;
                let final_z = agent.z - snapshot.z;
                let progress_fraction = ((final_x * intended_x + final_z * intended_z)
                    / intended_length_sq)
                    .clamp(0.0, 1.0);
                agent.route_progress = snapshot.route_progress
                    + (provisional_route_progress - snapshot.route_progress) * progress_fraction;
            }
        }
        ctx.db.combat_agent().id().update(agent);
    }
}

fn identity_group(owner: Identity) -> u64 {
    let bytes = owner.to_u256().to_le_bytes();
    bytes
        .chunks_exact(8)
        .map(|chunk| u64::from_le_bytes(chunk.try_into().expect("identity chunk")))
        .fold(0_u64, |hash, word| hash.rotate_left(13) ^ word)
}

fn walk_flocked(
    _steering: &CombatSteeringGrid,
    agent: &mut CombatAgent,
    goal_x: f64,
    goal_z: f64,
    speed: f64,
    dt: f64,
    road_network: Option<&RoadNetwork>,
) {
    // This provisional walk records the faction reducer's authored direction
    // and distance. The final global pass derives intent from its displacement,
    // rewinds to the shared snapshot, and replaces it with one steered solve.
    walk(agent, goal_x, goal_z, speed, dt, road_network);
}

fn walk_order_route(
    steering: &CombatSteeringGrid,
    agent: &mut CombatAgent,
    order: &crate::tables::MilitiaOrder,
    speed: f64,
    dt: f64,
    road_network: Option<&RoadNetwork>,
) {
    if order.path_distance > 1e-6 {
        if let Some(polyline) = deserialize_route_polyline(&order.route_polyline_json)
            .filter(|polyline| polyline.len() >= 2)
        {
            let progress = route_progress_for_position(&polyline, agent.x, agent.z)
                .clamp(0.0, order.path_distance);
            let mut traversed = 0.0;
            let mut goal = *polyline.last().expect("nonempty route");
            for segment in polyline.windows(2) {
                traversed += distance(segment[0][0], segment[0][1], segment[1][0], segment[1][1]);
                if traversed > progress + 0.05 {
                    goal = segment[1];
                    break;
                }
            }
            walk(agent, goal[0], goal[1], speed, dt, road_network);
            agent.route_progress = progress;
            return;
        }
    }
    walk_flocked(
        steering,
        agent,
        order.destination_x,
        order.destination_z,
        speed,
        dt,
        road_network,
    );
    agent.route_progress = 0.0;
}

fn down_enemy(ctx: &ReducerContext, enemy: &mut CombatAgent, tick: u64) {
    if enemy.faction == RAIDER {
        down_external_raider(ctx, enemy, tick);
        return;
    }
    enemy.health = 0.0;
    enemy.state = DOWNED;
    enemy.engagement_target_id = 0;
    enemy.state_changed_tick = tick;
    enemy.attack_cooldown = DOWNED_LINGER_SECONDS;
    if let Ok(stores) = serde_json::from_str::<RaidPortableStores>(&enemy.carried_loot_json) {
        let stores = stores.normalized_whole();
        if stores.goods_amount() > 0.0 {
            let _ = recover_stock_at(
                ctx,
                enemy.owner,
                enemy.x,
                enemy.z,
                reclamation_from_raid_stores(stores),
            );
        }
    }
    enemy.carried_loot_json.clear();
}

fn down_player_member(
    ctx: &ReducerContext,
    agent: &mut CombatAgent,
    member: &MilitaryMember,
    company: &MilitaryCompany,
    tick: u64,
) {
    release_mount_for_agent(ctx, agent.id, true);
    sync_member_ammunition_kit(agent, member);
    agent.health = 0.0;
    agent.state = DOWNED;
    agent.engagement_target_id = 0;
    agent.attack_cooldown = DOWNED_LINGER_SECONDS;
    agent.state_changed_tick = tick;
    ctx.db.militia_order().combat_agent_id().delete(agent.id);
    recover_member_kit_at(ctx, agent, agent.x, agent.z);
    if member.residence_id > 0 {
        let home = ctx.db.residence().id().find(&member.residence_id);
        let residence_id = if let Some(mut home) = home {
            let residence_id = home.id;
            home.population = home.population.saturating_sub(1);
            home.sick_population = home.sick_population.min(home.population);
            home.deaths_total = home.deaths_total.saturating_add(1);
            ctx.db.residence().id().update(home);
            residence_id
        } else {
            // The recruit's household was destroyed while he was deployed.
            // Never charge the casualty to an unrelated nearby household.
            0
        };
        ctx.db.corpse().insert(Corpse {
            id: 0,
            owner: agent.owner,
            residence_id,
            cause: 3,
            state: 0,
            x: agent.x,
            z: agent.z,
            created_tick: tick,
            chapel_id: 0,
            graveyard_id: 0,
            progress: 0.0,
            speed_mps: 0.0,
            path_distance: 0.0,
            route_polyline_json: String::new(),
            cart_x: agent.x,
            cart_z: agent.z,
        });
    }
    if let Some(mut latest) = ctx.db.military_company().id().find(&company.id) {
        latest.living_members = latest.living_members.saturating_sub(1);
        latest.ammunition = latest.ammunition.saturating_sub(member.ammunition);
        latest.ammunition_capacity = latest
            .ammunition_capacity
            .saturating_sub(member.ammunition_capacity);
        latest.morale = (latest.morale - 0.11).max(0.04);
        latest.cohesion = (latest.cohesion - 0.07).max(0.08);
        ctx.db.military_company().id().update(latest);
    }
    let mut downed_member = member.clone();
    downed_member.ammunition = 0;
    downed_member.ammunition_capacity = 0;
    ctx.db
        .military_member()
        .combat_agent_id()
        .update(downed_member);
}

/// Applies the canonical resident, equipment, ammunition, mount, corpse, and
/// company-strength bookkeeping when another combat simulation downs a member.
pub(super) fn down_external_player_member(
    ctx: &ReducerContext,
    agent: &mut CombatAgent,
    tick: u64,
) {
    let Some(member) = ctx
        .db
        .military_member()
        .combat_agent_id()
        .find(&agent.id)
    else {
        agent.health = 0.0;
        agent.state = DOWNED;
        agent.engagement_target_id = 0;
        agent.state_changed_tick = tick;
        agent.attack_cooldown = DOWNED_LINGER_SECONDS;
        return;
    };
    let Some(company) = ctx.db.military_company().id().find(&member.company_id) else {
        agent.health = 0.0;
        agent.state = DOWNED;
        agent.engagement_target_id = 0;
        agent.state_changed_tick = tick;
        agent.attack_cooldown = DOWNED_LINGER_SECONDS;
        return;
    };
    down_player_member(ctx, agent, &member, &company, tick);
}

fn step_downed_member(
    ctx: &ReducerContext,
    mut agent: CombatAgent,
    member: MilitaryMember,
    dt: f64,
) {
    agent.attack_cooldown = (agent.attack_cooldown - dt).max(0.0);
    if agent.attack_cooldown > 0.0 {
        ctx.db.combat_agent().id().update(agent);
        return;
    }
    ctx.db.militia_order().combat_agent_id().delete(agent.id);
    ctx.db.military_member().combat_agent_id().delete(agent.id);
    ctx.db.combat_agent().id().delete(agent.id);
    if let Some(company) = ctx.db.military_company().id().find(&member.company_id) {
        if company.living_members == 0
            && ctx
                .db
                .military_member()
                .company_id()
                .filter(&company.id)
                .next()
                .is_none()
        {
            ctx.db.military_company().id().delete(company.id);
        }
    }
}

fn strike_camp(
    ctx: &ReducerContext,
    agent: &mut CombatAgent,
    company: &MilitaryCompany,
    camp_id: u64,
    tick: u64,
) -> bool {
    if agent.attack_cooldown > 0.0 {
        return false;
    }
    let Some(kind) = MilitaryKind::from_id(company.kind) else {
        return false;
    };
    let Some(mut camp) = ctx.db.bandit_camp().id().find(&camp_id) else {
        return false;
    };
    if !camp.active {
        return false;
    }
    let stats = military_stats(kind);
    camp.health =
        (camp.health - stats.damage * veteran_damage_multiplier(company.level) * 0.72).max(0.0);
    agent.attack_cooldown = stats.attack_seconds;
    let destroyed = camp.health <= 0.0;
    if destroyed {
        destroy_camp(ctx, &mut camp, tick);
    }
    ctx.db.bandit_camp().id().update(camp);
    destroyed
}

fn regenerate_out_of_combat_health(agent: &mut CombatAgent, dt: f64) {
    if agent.state == DOWNED || agent.health <= 0.0 || agent.health >= agent.max_health {
        return;
    }
    // Percentage-based healing keeps light and heavy companies on a similar
    // recovery clock while veteran maximum-health gains remain meaningful.
    agent.health = (agent.health + agent.max_health * 0.004 * dt).min(agent.max_health);
}

fn hostile_company_defeated(ctx: &ReducerContext, defeated: &CombatAgent) -> bool {
    defeated.raid_id > 0
        && !ctx
            .db
            .combat_agent()
            .raid_id()
            .filter(&defeated.raid_id)
            .any(|candidate| {
                candidate.id != defeated.id
                    && candidate.faction == defeated.faction
                    && candidate.state != DOWNED
                    && candidate.health > 0.0
            })
}

fn award_company_experience(ctx: &ReducerContext, company_id: u64, amount: u64) {
    let Some(mut company) = ctx.db.military_company().id().find(&company_id) else {
        return;
    };
    let Some(kind) = MilitaryKind::from_id(company.kind) else {
        return;
    };
    if !kind.gains_veteran_experience() || amount == 0 || company.state >= 2 {
        return;
    }
    let previous_level = company.level.max(1);
    company.experience = company.experience.saturating_add(amount);
    company.level = military_level_for_experience(company.experience);
    if company.level > previous_level {
        apply_veteran_level_health(ctx, company.id, previous_level, company.level);
    }
    ctx.db.military_company().id().update(company);
}

fn apply_veteran_level_health(
    ctx: &ReducerContext,
    company_id: u64,
    previous_level: u32,
    next_level: u32,
) {
    let previous_multiplier = veteran_health_multiplier(previous_level);
    let next_multiplier = veteran_health_multiplier(next_level);
    if next_multiplier <= previous_multiplier {
        return;
    }
    for member in ctx
        .db
        .military_member()
        .company_id()
        .filter(&company_id)
        .collect::<Vec<_>>()
    {
        let Some(mut agent) = ctx.db.combat_agent().id().find(&member.combat_agent_id) else {
            continue;
        };
        if agent.state == DOWNED || agent.health <= 0.0 {
            continue;
        }
        let previous_max = agent.max_health.max(1.0);
        let base_max = previous_max / previous_multiplier;
        agent.max_health = base_max * next_multiplier;
        agent.health = (agent.health + agent.max_health - previous_max).min(agent.max_health);
        ctx.db.combat_agent().id().update(agent);
    }
}

fn resolve_return_home(
    ctx: &ReducerContext,
    member: &mut MilitaryMember,
    agent: &CombatAgent,
) -> (u64, f64, f64) {
    if let Some(home) = ctx
        .db
        .residence()
        .id()
        .find(&member.residence_id)
        .filter(|home| !home.abandoned)
    {
        return (home.id, home.x, home.z);
    }
    let replacement = ctx
        .db
        .residence()
        .owner()
        .filter(&member.owner)
        .filter(|home| !home.abandoned && home.population < home.population_capacity)
        .min_by(|left, right| {
            distance(agent.x, agent.z, left.x, left.z)
                .total_cmp(&distance(agent.x, agent.z, right.x, right.z))
        });
    let Some(mut replacement) = replacement else {
        return (0, agent.home_x, agent.home_z);
    };
    if let Some(mut old) = ctx.db.residence().id().find(&member.residence_id) {
        if old.population > 0 {
            old.population -= 1;
            old.sick_population = old.sick_population.min(old.population);
            ctx.db.residence().id().update(old);
            replacement.population = replacement
                .population
                .saturating_add(1)
                .min(replacement.population_capacity);
            ctx.db.residence().id().update(replacement.clone());
        }
    }
    member.residence_id = replacement.id;
    member.resident_slot = replacement.population.saturating_sub(1);
    member.person_identity = format!(
        "residence-{}:person:{}",
        member.residence_id, member.resident_slot
    );
    (replacement.id, replacement.x, replacement.z)
}

fn begin_forced_return(ctx: &ReducerContext, agent: &mut CombatAgent, member: &mut MilitaryMember) {
    recover_member_kit(ctx, agent);
    agent.carried_loot_json.clear();
    agent.state = RETURNING;
    agent.engagement_target_id = 0;
    member.phase = 3;
    ctx.db
        .military_member()
        .combat_agent_id()
        .update(member.clone());
    ctx.db.combat_agent().id().update(agent.clone());
}

fn finish_member_return(ctx: &ReducerContext, agent: &CombatAgent, company: &MilitaryCompany) {
    release_mount_for_agent(ctx, agent.id, false);
    ctx.db.militia_order().combat_agent_id().delete(agent.id);
    ctx.db.military_member().combat_agent_id().delete(agent.id);
    ctx.db.combat_agent().id().delete(agent.id);
    let any_members = ctx
        .db
        .military_member()
        .company_id()
        .filter(&company.id)
        .next()
        .is_some();
    if !any_members {
        if MilitaryKind::from_id(company.kind) == Some(MilitaryKind::MercenarySpears) {
            ctx.db.mercenary_contract().company_id().delete(company.id);
        }
        ctx.db.military_company().id().delete(company.id);
    }
}

fn release_mount_for_agent(ctx: &ReducerContext, combat_agent_id: u64, lost: bool) {
    let Some(mut horse) = ctx
        .db
        .cavalry_horse()
        .assigned_combat_agent_id()
        .filter(&combat_agent_id)
        .next()
    else {
        return;
    };
    let pasture_id = horse.pasture_id;
    if lost {
        ctx.db.cavalry_horse().id().delete(horse.id);
        crate::reducers::cavalry_horses::sync_horse_pasture_herd(ctx, pasture_id);
    } else if horse.pasture_id == 0 {
        ctx.db.cavalry_horse().id().delete(horse.id);
    } else {
        horse.at_pasture = true;
        horse.assigned_company_id = 0;
        horse.assigned_combat_agent_id = 0;
        ctx.db.cavalry_horse().id().update(horse);
        crate::reducers::cavalry_horses::sync_horse_pasture_herd(ctx, pasture_id);
    }
}

fn recover_member_kit(ctx: &ReducerContext, agent: &CombatAgent) {
    recover_member_kit_at(ctx, &mut agent.clone(), agent.x, agent.z);
}

fn sync_member_ammunition_kit(agent: &mut CombatAgent, member: &MilitaryMember) {
    let Ok(mut stores) = serde_json::from_str::<RaidPortableStores>(&agent.carried_loot_json) else {
        return;
    };
    if stores.ammunition <= 0.0 && member.ammunition_capacity == 0 {
        return;
    }
    stores.ammunition = f64::from(recoverable_ammunition_bundles(
        member.ammunition,
        member.ammunition_capacity,
    ));
    agent.carried_loot_json = serde_json::to_string(&stores).unwrap_or_default();
}

fn recover_member_kit_at(ctx: &ReducerContext, agent: &mut CombatAgent, x: f64, z: f64) {
    let Ok(stores) = serde_json::from_str::<RaidPortableStores>(&agent.carried_loot_json) else {
        return;
    };
    let stores = stores.normalized_whole();
    if stores.goods_amount() <= 0.0 {
        return;
    }
    let _ = recover_stock_at(ctx, agent.owner, x, z, reclamation_from_raid_stores(stores));
    agent.carried_loot_json.clear();
}

fn walk(
    agent: &mut CombatAgent,
    x: f64,
    z: f64,
    speed: f64,
    dt: f64,
    road_network: Option<&RoadNetwork>,
) {
    let (x, z) = COMBAT_NAVIGATION.with(|cell| {
        cell.borrow().get(&agent.owner).map_or((x, z), |navigation| {
            navigation.next_waypoint((agent.x, agent.z), (x, z))
        })
    });
    let dx = x - agent.x;
    let dz = z - agent.z;
    let distance = dx.hypot(dz);
    if distance <= 1e-6 {
        agent.velocity_x = 0.0;
        agent.velocity_z = 0.0;
        return;
    }
    let base_step = speed.max(0.0) * dt;
    let fast_step = (base_step * COMBAT_ROAD_SPEED_MULTIPLIER).min(distance);
    let candidate_x = agent.x + dx / distance * fast_step;
    let candidate_z = agent.z + dz / distance * fast_step;
    let surface_multiplier = road_network
        .map(|network| {
            network.combat_segment_speed_multiplier(
                agent.x,
                agent.z,
                candidate_x,
                candidate_z,
                COMBAT_WADING_SPEED_MULTIPLIER,
                COMBAT_ROAD_SPEED_MULTIPLIER,
            )
        })
        .unwrap_or(1.0);
    let step = (base_step * surface_multiplier).min(distance);
    let move_x = dx / distance * step;
    let move_z = dz / distance * step;
    agent.x += move_x;
    agent.z += move_z;
    agent.velocity_x = move_x / dt.max(1e-9);
    agent.velocity_z = move_z / dt.max(1e-9);
}

/// Shared by movement and order creation; uses placement-time building yaw.
pub fn build_owner_combat_navigation(
    ctx: &ReducerContext,
    owner: Identity,
    roads: Option<&RoadNetwork>,
) -> CombatNavigation {
    let mut navigation = CombatNavigation::default();
    for building in ctx.db.building().owner().filter(&owner) {
        let yaw = crate::placement_validation::resolved_existing_building_yaw(roads, &building);
        let corners = crate::placement_validation::building_footprint_polygon_at_yaw(
            &building.kind, building.x, building.z, yaw,
        );
        navigation.push(CombatObstacle::from_corners(corners.map(|point| (point.x, point.z))));
    }
    for home in ctx.db.residence().owner().filter(&owner) {
        navigation.push(CombatObstacle::rectangle(home.x, home.z, 3.3, 3.7, home.yaw));
    }
    navigation
}

fn walk_away(
    agent: &mut CombatAgent,
    x: f64,
    z: f64,
    speed: f64,
    dt: f64,
    road_network: Option<&RoadNetwork>,
) {
    let dx = agent.x - x;
    let dz = agent.z - z;
    let length = dx.hypot(dz).max(1e-6);
    walk(
        agent,
        agent.x + dx / length * speed.max(0.0),
        agent.z + dz / length * speed.max(0.0),
        speed,
        dt,
        road_network,
    );
}

fn distance(ax: f64, az: f64, bx: f64, bz: f64) -> f64 {
    (ax - bx).hypot(az - bz)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn player_factions_are_disjoint_from_hostiles_and_animals() {
        for kind_id in 0..=10 {
            let faction = MilitaryKind::from_id(kind_id).unwrap().faction();
            assert!(!matches!(faction, RAIDER | BANDIT | FOX | WOLF));
        }
    }
}
