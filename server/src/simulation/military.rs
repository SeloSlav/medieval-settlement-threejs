use std::cell::RefCell;

use spacetimedb::{Identity, ReducerContext};

use crate::db::*;
use crate::economy::spend_treasury_gold;
use crate::military_policy::{
    company_wages_enabled, local_company_requires_provisions, matchup_damage_multiplier,
    member_combat_profile, military_battle_end_ticks, military_day_ticks,
    military_level_for_experience, military_stats, normalize_military_demands,
    shield_wall_damage_multiplier, veteran_damage_multiplier, veteran_damage_taken_multiplier,
    veteran_health_multiplier, MilitaryKind, MERCENARY_IDLE_DEPARTURE_DAYS,
    MERCENARY_MAX_CONTRACT_DAYS, MILITARY_BATTLE_SURVIVAL_XP, MILITARY_ENEMY_COMPANY_XP,
};
use crate::raid_agent_policy::playable_half_for_map_size;
use crate::security_policy::RaidPortableStores;
use crate::tables::{
    mercenary_contract, CombatAgent, Corpse, MercenaryContract, MilitaryCompany, MilitaryMember,
};

use super::bandits::destroy_camp;
use super::military_steering::{
    melee_engagement_goal, ranged_firing_line_goal, CombatSteeringGrid, SteeringBody,
    SteeringBounds,
};
use super::raid_agents::{down_external_raider, reclamation_from_raid_stores};
use super::reclamation::recover_stock_at;

const RAIDER: u8 = 1;
const BANDIT: u8 = 2;
const FOX: u8 = 13;
const WOLF: u8 = 14;
const FIRST_PLAYER_MILITARY: u8 = 3;
const LAST_PLAYER_MILITARY: u8 = 10;
const ADVANCING: u8 = 0;
const FIGHTING: u8 = 1;
const LOOTING: u8 = 2;
const RETREATING: u8 = 3;
const RETURNING: u8 = 4;
const DOWNED: u8 = 5;
const MUSTERING: u8 = 8;
const HOLDING: u8 = 9;
const ARRIVAL_DISTANCE: f64 = 2.3;
const DOWNED_LINGER_SECONDS: f64 = 7.0;

thread_local! {
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
}

impl MilitaryScratch {
    fn ranged_frame(&self, company_id: u64) -> Option<RangedCompanyFrame> {
        self.ranged_frames
            .binary_search_by_key(&company_id, |frame| frame.company_id)
            .ok()
            .map(|index| self.ranged_frames[index])
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
}

fn build_ranged_company_frame(
    ctx: &ReducerContext,
    steering: &CombatSteeringGrid,
    company_id: u64,
    members: &[MilitaryMember],
) -> Option<RangedCompanyFrame> {
    let company = ctx.db.military_company().id().find(&company_id)?;
    let kind = MilitaryKind::from_id(company.kind)?;
    if !matches!(kind, MilitaryKind::Bowmen | MilitaryKind::Crossbows) {
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

pub fn step_military_world(ctx: &ReducerContext, sim_tick: u64, elapsed_seconds: f64) {
    if !elapsed_seconds.is_finite() || elapsed_seconds <= 0.0 {
        return;
    }
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
            rebuild_steering_grid(ctx, &mut steering, None, &[], elapsed_seconds);
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
                    match member.phase {
                        0 => step_mustering_member(
                            ctx,
                            agent,
                            member,
                            company,
                            sim_tick,
                            elapsed_seconds,
                        ),
                        2 | 3 => {
                            step_returning_member(ctx, agent, member, company, elapsed_seconds)
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
                            )
                        }
                    }
                }

                // Goals and state decisions are now final, but the grid is rebuilt
                // from the shared pre-heartbeat snapshot. The final write replaces
                // every provisional faction displacement with one synchronous
                // integration, preventing two fast bodies from swapping sides
                // before predictive avoidance sees them.
                rebuild_steering_grid(
                    ctx,
                    &mut steering,
                    Some(&frame),
                    &scratch.ranged_frames,
                    elapsed_seconds,
                );
                apply_global_combat_steering(ctx, &mut steering, &frame, elapsed_seconds);
            });
        });
        frame.captured = false;
    });
    refresh_company_summaries(ctx, sim_tick, elapsed_seconds, military_demands);
}

fn step_mustering_member(
    ctx: &ReducerContext,
    mut agent: CombatAgent,
    mut member: MilitaryMember,
    company: MilitaryCompany,
    tick: u64,
    dt: f64,
) {
    let Some(source) = ctx.db.building().id().find(&company.source_building_id) else {
        begin_forced_return(ctx, &mut agent, &mut member);
        return;
    };
    walk(&mut agent, source.x, source.z, 2.25, dt);
    agent.state = MUSTERING;
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
) {
    agent.engagement_target_id = 0;
    if member.phase == 2 {
        if MilitaryKind::from_id(company.kind) == Some(MilitaryKind::MercenarySpears) {
            let exit_x = member.original_home_x;
            let exit_z = member.original_home_z;
            walk(&mut agent, exit_x, exit_z, 2.35, dt);
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
            walk(&mut agent, source.x, source.z, 2.2, dt);
            agent.state = RETURNING;
            if distance(agent.x, agent.z, source.x, source.z) > ARRIVAL_DISTANCE {
                ctx.db.combat_agent().id().update(agent);
                return;
            }
            recover_member_kit_at(ctx, &mut agent, source.x, source.z);
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

    let (home_id, home_x, home_z) = resolve_return_home(ctx, &mut member, &agent);
    if home_id == 0 {
        // A homeless veteran joins the unhoused population abstraction at the
        // Town Hall rather than remaining an immortal military reservation.
        finish_member_return(ctx, &agent, &company);
        return;
    }
    walk(&mut agent, home_x, home_z, 2.15, dt);
    agent.home_x = home_x;
    agent.home_z = home_z;
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
    debug_assert!((FIRST_PLAYER_MILITARY..=LAST_PLAYER_MILITARY).contains(&agent.faction));
    let stats = military_stats(kind);
    agent.attack_cooldown = (agent.attack_cooldown - dt).max(0.0);

    if company.morale < 0.16 || agent.health / agent.max_health.max(1.0) < 0.18 {
        agent.engagement_target_id = 0;
        ctx.db.militia_order().combat_agent_id().delete(agent.id);
        if let Some(source) = ctx.db.building().id().find(&company.source_building_id) {
            walk(&mut agent, source.x, source.z, stats.speed * 1.1, dt);
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
        if remaining > ARRIVAL_DISTANCE {
            let profile = member_combat_profile(kind, member_seed(&member));
            let run_scale = if remaining > 14.0 && company.fatigue < 0.82 {
                1.45
            } else {
                1.0
            };
            walk_flocked(
                steering,
                &mut agent,
                order.destination_x,
                order.destination_z,
                stats.speed * profile.speed_scale * run_scale,
                dt,
            );
            agent.route_progress = remaining;
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

    // Each soldier chooses a nearby opponent with a saturation penalty. This
    // spreads contact across the enemy line while flock steering keeps the
    // unselectable individuals attached to their atomic company.
    if let Some(mut enemy) =
        retained_or_nearest_enemy(ctx, steering, &agent, stats.acquisition_range)
    {
        let range = distance(agent.x, agent.z, enemy.x, enemy.z);
        agent.target_kind = 7;
        agent.target_id = enemy.id;
        agent.engagement_target_id = enemy.id;
        let ranged_kind = matches!(kind, MilitaryKind::Crossbows | MilitaryKind::Bowmen);
        let can_shoot = ranged_kind && member.ammunition > 0;
        let strike_range = if can_shoot { stats.strike_range } else { 2.15 };
        let minimum_ranged_spacing = match kind {
            MilitaryKind::Bowmen => 8.0,
            MilitaryKind::Crossbows => 7.25,
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
            walk_away(&mut agent, threat_x, threat_z, stats.speed * 0.78, dt);
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
            let rank = agent.source_slot as usize;
            let movement_goal = if can_shoot {
                let frame = ranged_frame.unwrap_or(RangedCompanyFrame {
                    company_id: company.id,
                    source_x: agent.x,
                    source_z: agent.z,
                    target_x: enemy.x,
                    target_z: enemy.z,
                });
                ranged_firing_line_goal(
                    rank,
                    company.living_members.max(1) as usize,
                    frame.source_x,
                    frame.source_z,
                    frame.target_x,
                    frame.target_z,
                    stats.strike_range,
                )
            } else {
                melee_engagement_goal(company.id, enemy.id, rank, enemy.x, enemy.z, strike_range)
            };
            walk_flocked(
                steering,
                &mut agent,
                movement_goal.0,
                movement_goal.1,
                stats.speed * run_scale,
                dt,
            );
            agent.route_progress = range;
            agent.state = ADVANCING;
        } else {
            let charged_into_contact = !can_shoot && agent.route_progress > 10.0;
            agent.route_progress = 0.0;
            agent.state = FIGHTING;
            agent.velocity_x = 0.0;
            agent.velocity_z = 0.0;
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
                    MilitaryKind::Crossbows | MilitaryKind::Bowmen => 4.0,
                    _ => stats.damage,
                };
                let raw_damage = (if ranged_kind && !can_shoot {
                    exhausted_ranged_damage
                } else {
                    stats.damage
                }) * profile.damage_scale
                    * veteran_damage_multiplier(company.level)
                    * readiness.max(0.35)
                    * if charged_into_contact {
                        1.0 + profile.charge
                    } else {
                        1.0
                    };
                let damage =
                    damage_against_hostile(kind, profile.armor_penetration, &enemy, raw_damage);
                enemy.health = (enemy.health - damage).max(0.0);
                agent.attack_cooldown = stats.attack_seconds;
                if can_shoot {
                    member.ammunition = member.ammunition.saturating_sub(1);
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
            } else if range <= 2.75 && enemy.attack_cooldown <= 0.0 {
                let hostile_damage = match enemy.faction {
                    FOX => 5.0,
                    WOLF => 11.0,
                    BANDIT => 10.0,
                    _ => 15.0 + enemy.readiness * 4.0,
                };
                let profile = member_combat_profile(kind, member_seed(&member));
                let hostile = hostile_profile(&enemy);
                let armor_after_penetration = (profile.armor - hostile.penetration).max(0.0);
                let armor_multiplier = 1.0 / (1.0 + armor_after_penetration * 0.055);
                let shield_multiplier = (1.0 - profile.shield * 0.022).clamp(0.64, 1.0);
                let brace_multiplier = if company.formation
                    == crate::military_policy::MILITARY_FORMATION_SHIELD_WALL
                    && enemy.state == ADVANCING
                {
                    (1.0 - profile.bracing * 0.34).clamp(0.62, 1.0)
                } else {
                    1.0
                };
                let mitigation = stats.damage_taken_multiplier
                    * veteran_damage_taken_multiplier(company.level)
                    * shield_wall_damage_multiplier(kind, company.formation)
                    * (1.08 - company.cohesion.clamp(0.0, 1.0) * 0.18)
                    * armor_multiplier
                    * shield_multiplier
                    * brace_multiplier;
                agent.health = (agent.health - hostile_damage * mitigation).max(0.0);
                enemy.attack_cooldown = if enemy.faction == BANDIT { 1.2 } else { 1.0 };
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
            walk_flocked(
                steering,
                &mut agent,
                target.0,
                target.1,
                stats.speed * profile.speed_scale * run_scale,
                dt,
            );
            agent.route_progress = remaining;
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
        let requires_provisions = local_company_requires_provisions(kind, military_demands);
        if requires_provisions {
            company.provision_days = (company.provision_days - elapsed_days as f64).max(0.0);
        }
        if company_wages_enabled(kind, military_demands) {
            let daily_wage = match kind {
                MilitaryKind::Spearmen => company.living_members.div_ceil(4),
                MilitaryKind::MenAtArms | MilitaryKind::Crossbows => {
                    company.living_members.div_ceil(2)
                }
                MilitaryKind::MercenarySpears => company.living_members,
                MilitaryKind::Footmen | MilitaryKind::Polearms | MilitaryKind::Bowmen => {
                    company.living_members.div_ceil(2)
                }
                MilitaryKind::Militia => 0,
            };
            let wages = daily_wage.saturating_mul(elapsed_days.min(u32::MAX as u64) as u32);
            let paid = spend_treasury_gold(ctx, company.owner, wages as f64).is_ok();
            if !paid && kind == MilitaryKind::MercenarySpears {
                begin_mercenary_departure(ctx, company.id);
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

fn step_mercenary_contracts(ctx: &ReducerContext, tick: u64) {
    let day_ticks = military_day_ticks();
    let idle_limit = day_ticks.saturating_mul(MERCENARY_IDLE_DEPARTURE_DAYS);
    let max_contract = day_ticks.saturating_mul(MERCENARY_MAX_CONTRACT_DAYS);

    // Existing saves may contain hired companies created before lifecycle rows
    // existed. Give them a fresh full contract instead of dismissing them on
    // the migration tick.
    for company in ctx
        .db
        .military_company()
        .iter()
        .filter(|company| company.kind == MilitaryKind::MercenarySpears as u8 && company.state < 2)
        .collect::<Vec<_>>()
    {
        if ctx
            .db
            .mercenary_contract()
            .company_id()
            .find(&company.id)
            .is_none()
        {
            ctx.db.mercenary_contract().insert(MercenaryContract {
                company_id: company.id,
                owner: company.owner,
                contract_end_tick: tick.saturating_add(max_contract),
                last_engagement_tick: tick,
            });
        }
    }

    for mut contract in ctx.db.mercenary_contract().iter().collect::<Vec<_>>() {
        let Some(company) = ctx
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
            .filter_map(|member| ctx.db.combat_agent().id().find(&member.combat_agent_id))
            .any(|agent| {
                agent.state == FIGHTING
                    || agent.target_kind == 7
                    || ctx
                        .db
                        .militia_order()
                        .combat_agent_id()
                        .find(&agent.id)
                        .is_some_and(|order| order.target_camp_id > 0)
            });
        if engaged {
            contract.last_engagement_tick = tick;
            ctx.db.mercenary_contract().company_id().update(contract);
            continue;
        }
        let idle_too_long = tick.saturating_sub(contract.last_engagement_tick) >= idle_limit;
        if idle_too_long || tick >= contract.contract_end_tick {
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
        for member in &members {
            let Some(agent) = ctx.db.combat_agent().id().find(&member.combat_agent_id) else {
                continue;
            };
            if agent.state == DOWNED {
                continue;
            }
            living += 1;
            health += agent.health / agent.max_health.max(1.0);
            if matches!(agent.state, ADVANCING | RETREATING | RETURNING | MUSTERING) {
                moving += 1;
            }
            if agent.state == FIGHTING {
                fighting += 1;
            }
        }
        company.living_members = living;
        if company.state < 2 && living > 0 {
            let exertion = (moving as f64 * 0.35 + fighting as f64) / living as f64;
            if exertion > 0.01 {
                company.fatigue = (company.fatigue + dt * 0.0035 * exertion).min(1.0);
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
}

fn hostile_profile(enemy: &CombatAgent) -> HostileProfile {
    if enemy.faction == FOX || enemy.faction == WOLF {
        return HostileProfile {
            armor: 0.0,
            shield: 0.0,
            penetration: if enemy.faction == WOLF { 2.0 } else { 0.0 },
            role: 0,
        };
    }
    if enemy.faction == BANDIT {
        return HostileProfile {
            armor: 1.5,
            shield: 0.0,
            penetration: 1.0,
            role: 0,
        };
    }
    // Ottoman parties are mixed atomic ranks. Source slot deterministically
    // supplies light infantry, spears, armored infantry, and missile troops.
    match enemy.source_slot % 4 {
        1 => HostileProfile {
            armor: 7.0,
            shield: 7.0,
            penetration: 3.0,
            role: 1,
        },
        2 => HostileProfile {
            armor: 12.0,
            shield: 4.0,
            penetration: 7.0,
            role: 2,
        },
        3 => HostileProfile {
            armor: 4.0,
            shield: 0.0,
            penetration: 8.0,
            role: 3,
        },
        _ => HostileProfile {
            armor: 6.0,
            shield: 3.0,
            penetration: 4.0,
            role: 0,
        },
    }
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
        _ => MilitaryKind::Footmen,
    };
    let counter = matchup_damage_multiplier(kind, defender_kind);
    raw_damage * armor_multiplier * shield_multiplier * counter
}

fn member_seed(member: &MilitaryMember) -> u64 {
    member.company_id.rotate_left(31) ^ member.residence_id ^ member.resident_slot as u64
}

fn rebuild_steering_grid(
    ctx: &ReducerContext,
    steering: &mut CombatSteeringGrid,
    motion_frame: Option<&CombatMotionFrame>,
    ranged_frames: &[RangedCompanyFrame],
    elapsed_seconds: f64,
) {
    steering.begin();
    for agent in ctx.db.combat_agent().iter() {
        if agent.state == DOWNED || agent.health <= 0.0 {
            continue;
        }
        let (group_kind, group_id) = ctx
            .db
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
            );
        let (mut goal_x, mut goal_z, mut speed) =
            canonical_steering_goal(ctx, &agent, motion_frame, ranged_frames);
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
            }
            (
                snapshot.x,
                snapshot.z,
                snapshot.velocity_x,
                snapshot.velocity_z,
            )
        } else if motion_frame.is_some() {
            // A combatant spawned after capture is still a physical obstacle,
            // but waits for the next heartbeat before taking its first step.
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
            target_id: agent.target_id,
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
            RAIDER => 2.65,
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
                        let rank = agent.source_slot as usize;
                        let goal = if matches!(kind, MilitaryKind::Bowmen | MilitaryKind::Crossbows)
                            && member.ammunition > 0
                        {
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
                                rank,
                                company.living_members.max(1) as usize,
                                line_source_x,
                                line_source_z,
                                line_target_x,
                                line_target_z,
                                stats.strike_range,
                            )
                        } else {
                            melee_engagement_goal(
                                company.id,
                                target.id,
                                rank,
                                target_x,
                                target_z,
                                stats.strike_range,
                            )
                        };
                        return (goal.0, goal.1, speed);
                    }
                }
            }
            let goal = if agent.faction == RAIDER && agent.source_slot % 4 == 3 {
                ranged_firing_line_goal(
                    agent.source_slot as usize,
                    8,
                    source_x,
                    source_z,
                    target_x,
                    target_z,
                    12.0,
                )
            } else {
                melee_engagement_goal(
                    agent.raid_id.max(agent.source_building_id),
                    target.id,
                    agent.source_slot as usize,
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
        if motion_frame.get(agent.id).is_none() {
            continue;
        }
        let snapshot = motion_frame
            .get(agent.id)
            .expect("captured combatant checked above");
        let provisional_x = agent.x;
        let provisional_z = agent.z;
        let provisional_route_progress = agent.route_progress;
        agent.x = source.x;
        agent.z = source.z;
        agent.velocity_x = source.velocity_x;
        agent.velocity_z = source.velocity_z;
        if agent.faction <= RAIDER {
            let intended_x = provisional_x - snapshot.x;
            let intended_z = provisional_z - snapshot.z;
            let intended_length_sq = intended_x * intended_x + intended_z * intended_z;
            if intended_length_sq > 1e-12 {
                let final_x = source.x - snapshot.x;
                let final_z = source.z - snapshot.z;
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
) {
    // This provisional walk records the faction reducer's authored direction
    // and distance. The final global pass derives intent from its displacement,
    // rewinds to the shared snapshot, and replaces it with one steered solve.
    walk(agent, goal_x, goal_z, speed, dt);
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
    agent.health = 0.0;
    agent.state = DOWNED;
    agent.engagement_target_id = 0;
    agent.attack_cooldown = DOWNED_LINGER_SECONDS;
    agent.state_changed_tick = tick;
    ctx.db.militia_order().combat_agent_id().delete(agent.id);
    recover_member_kit_at(ctx, agent, agent.x, agent.z);
    if member.residence_id > 0 {
        let mut residence_id = member.residence_id;
        let home = ctx
            .db
            .residence()
            .id()
            .find(&member.residence_id)
            .or_else(|| {
                ctx.db
                    .residence()
                    .owner()
                    .filter(&agent.owner)
                    .filter(|residence| residence.population > 0)
                    .min_by(|left, right| {
                        distance(agent.x, agent.z, left.x, left.z)
                            .total_cmp(&distance(agent.x, agent.z, right.x, right.z))
                    })
            });
        if let Some(mut home) = home {
            residence_id = home.id;
            home.population = home.population.saturating_sub(1);
            home.sick_population = home.sick_population.min(home.population);
            home.deaths_total = home.deaths_total.saturating_add(1);
            ctx.db.residence().id().update(home);
        }
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
        latest.morale = (latest.morale - 0.11).max(0.04);
        latest.cohesion = (latest.cohesion - 0.07).max(0.08);
        ctx.db.military_company().id().update(latest);
    }
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
    member.person_identity = format!("{}:person:{}", member.residence_id, member.resident_slot);
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

fn recover_member_kit(ctx: &ReducerContext, agent: &CombatAgent) {
    recover_member_kit_at(ctx, &mut agent.clone(), agent.x, agent.z);
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

fn walk(agent: &mut CombatAgent, x: f64, z: f64, speed: f64, dt: f64) {
    let dx = x - agent.x;
    let dz = z - agent.z;
    let distance = dx.hypot(dz);
    if distance <= 1e-6 {
        agent.velocity_x = 0.0;
        agent.velocity_z = 0.0;
        return;
    }
    let step = (speed.max(0.0) * dt).min(distance);
    let move_x = dx / distance * step;
    let move_z = dz / distance * step;
    agent.x += move_x;
    agent.z += move_z;
    agent.velocity_x = move_x / dt.max(1e-9);
    agent.velocity_z = move_z / dt.max(1e-9);
}

fn walk_away(agent: &mut CombatAgent, x: f64, z: f64, speed: f64, dt: f64) {
    let dx = agent.x - x;
    let dz = agent.z - z;
    let length = dx.hypot(dz).max(1e-6);
    let move_x = dx / length * speed * dt;
    let move_z = dz / length * speed * dt;
    agent.x += move_x;
    agent.z += move_z;
    agent.velocity_x = move_x / dt.max(1e-9);
    agent.velocity_z = move_z / dt.max(1e-9);
}

fn distance(ax: f64, az: f64, bx: f64, bz: f64) -> f64 {
    (ax - bx).hypot(az - bz)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn player_faction_band_is_disjoint_from_hostiles() {
        assert!(FIRST_PLAYER_MILITARY > BANDIT);
        assert!(LAST_PLAYER_MILITARY >= FIRST_PLAYER_MILITARY);
    }
}
