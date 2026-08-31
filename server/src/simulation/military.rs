use spacetimedb::ReducerContext;

use crate::db::*;
use crate::economy::spend_treasury_gold;
use crate::military_policy::{
    company_wages_enabled, local_company_requires_provisions, matchup_damage_multiplier,
    member_combat_profile, military_battle_end_ticks, military_day_ticks,
    military_level_for_experience, military_stats, normalize_military_demands,
    shield_wall_damage_multiplier, veteran_damage_multiplier,
    veteran_damage_taken_multiplier, veteran_health_multiplier, MilitaryKind,
    MERCENARY_IDLE_DEPARTURE_DAYS, MERCENARY_MAX_CONTRACT_DAYS,
    MILITARY_BATTLE_SURVIVAL_XP, MILITARY_ENEMY_COMPANY_XP,
};
use crate::security_policy::RaidPortableStores;
use crate::tables::{
    mercenary_contract, CombatAgent, Corpse, MercenaryContract, MilitaryCompany, MilitaryMember,
};

use super::bandits::destroy_camp;
use super::raid_agents::{down_external_raider, reclamation_from_raid_stores};
use super::reclamation::recover_stock_at;

const RAIDER: u8 = 1;
const BANDIT: u8 = 2;
const FIRST_PLAYER_MILITARY: u8 = 3;
const LAST_PLAYER_MILITARY: u8 = 11;
const ADVANCING: u8 = 0;
const FIGHTING: u8 = 1;
const RETREATING: u8 = 3;
const RETURNING: u8 = 4;
const DOWNED: u8 = 5;
const MUSTERING: u8 = 8;
const HOLDING: u8 = 9;
const ARRIVAL_DISTANCE: f64 = 2.3;
const DOWNED_LINGER_SECONDS: f64 = 7.0;

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
    let members = ctx.db.military_member().iter().collect::<Vec<_>>();
    for member in members {
        let Some(agent) = ctx.db.combat_agent().id().find(&member.combat_agent_id) else {
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
        let Some(company) = ctx.db.military_company().id().find(&member.company_id) else {
            recover_member_kit(ctx, &agent);
            ctx.db.militia_order().combat_agent_id().delete(agent.id);
            ctx.db.military_member().combat_agent_id().delete(agent.id);
            ctx.db.combat_agent().id().delete(agent.id);
            continue;
        };
        match member.phase {
            0 => step_mustering_member(ctx, agent, member, company, sim_tick, elapsed_seconds),
            2 | 3 => step_returning_member(ctx, agent, member, company, elapsed_seconds),
            _ => step_active_member(
                ctx,
                agent,
                member,
                company,
                sim_tick,
                elapsed_seconds,
                military_demands,
            ),
        }
    }
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
) {
    if company.state >= 2 {
        member.phase = 2;
        ctx.db.military_member().combat_agent_id().update(member);
        agent.state = RETURNING;
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
        ctx.db.militia_order().combat_agent_id().delete(agent.id);
        if let Some(source) = ctx.db.building().id().find(&company.source_building_id) {
            walk(&mut agent, source.x, source.z, stats.speed * 1.1, dt);
            agent.state = RETREATING;
            if distance(agent.x, agent.z, source.x, source.z) <= ARRIVAL_DISTANCE {
                agent.state = HOLDING;
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
        agent.target_kind = 6;
        agent.target_id = 0;
        let remaining = distance(
            agent.x,
            agent.z,
            order.destination_x,
            order.destination_z,
        );
        if remaining > ARRIVAL_DISTANCE {
            let profile = member_combat_profile(kind, member_seed(&member));
            let run_scale = if remaining > 14.0 && company.fatigue < 0.82 {
                1.45
            } else {
                1.0
            };
            walk_flocked(
                ctx,
                &mut agent,
                company.id,
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
            agent.route_progress = 0.0;
        }
        regenerate_out_of_combat_health(&mut agent, dt);
        ctx.db.combat_agent().id().update(agent);
        return;
    }

    // Each soldier chooses a nearby opponent with a saturation penalty. This
    // spreads contact across the enemy line while flock steering keeps the
    // unselectable individuals attached to their atomic company.
    if let Some((_score, mut enemy)) = nearest_distributed_enemy(ctx, &agent, company.id)
        .filter(|(range, _)| *range <= stats.acquisition_range)
    {
        let range = distance(agent.x, agent.z, enemy.x, enemy.z);
        agent.target_kind = 7;
        agent.target_id = enemy.id;
        let ranged_kind = matches!(
            kind,
            MilitaryKind::Crossbows
                | MilitaryKind::Bowmen
                | MilitaryKind::UskokBorderInfantry
        );
        let can_shoot = ranged_kind && member.ammunition > 0;
        let strike_range = if can_shoot { stats.strike_range } else { 2.15 };
        let minimum_ranged_spacing = match kind {
            MilitaryKind::Bowmen => 8.0,
            MilitaryKind::Crossbows => 7.25,
            MilitaryKind::UskokBorderInfantry => 6.5,
            _ => 0.0,
        };
        if can_shoot && range < minimum_ranged_spacing {
            // A missile line should not politely wait for swords to reach it.
            // Retire while reloading/drawing, then resume fire once it has
            // rebuilt enough spacing.  Ammunition exhaustion disables this
            // branch and lets the member commit with the fallback sidearm.
            walk_away(&mut agent, enemy.x, enemy.z, stats.speed * 0.78, dt);
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
            walk_flocked(
                ctx,
                &mut agent,
                company.id,
                enemy.x,
                enemy.z,
                stats.speed * run_scale,
                dt,
            );
            agent.route_progress = range;
            agent.state = ADVANCING;
        } else {
            let charged_into_contact = !can_shoot && agent.route_progress > 10.0;
            agent.route_progress = 0.0;
            agent.state = FIGHTING;
            enemy.state = FIGHTING;
            enemy.target_kind = 7;
            enemy.target_id = agent.id;
            enemy.target_kind = 7;
            enemy.target_id = agent.id;
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
                    // Uskoks draw their korda instead of clubbing with an
                    // unloaded firearm, preserving their hybrid identity.
                    MilitaryKind::UskokBorderInfantry => 13.0,
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
                agent.attack_cooldown = if kind == MilitaryKind::UskokBorderInfantry
                    && !can_shoot
                {
                    0.84
                } else {
                    stats.attack_seconds
                };
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
                let hostile_damage = if enemy.faction == BANDIT {
                    10.0
                } else {
                    15.0 + enemy.readiness * 4.0
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
                ctx,
                &mut agent,
                company.id,
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
            if strike_camp(ctx, &mut agent, &company, order.target_camp_id, tick) {
                award_company_experience(ctx, company.id, MILITARY_ENEMY_COMPANY_XP);
            }
        } else {
            agent.route_progress = 0.0;
            agent.target_kind = 6;
            agent.target_id = 0;
            agent.state = HOLDING;
        }
        if agent.state != FIGHTING {
            regenerate_out_of_combat_health(&mut agent, dt);
        }
    } else {
        agent.route_progress = 0.0;
        agent.target_kind = 6;
        agent.target_id = 0;
        agent.state = HOLDING;
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
                MilitaryKind::UskokBorderInfantry => company.living_members,
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
        if agent.state == DOWNED {
            continue;
        }
        ctx.db
            .militia_order()
            .combat_agent_id()
            .delete(member.combat_agent_id);
        member.phase = 2;
        ctx.db.military_member().combat_agent_id().update(member);
        agent.state = RETURNING;
        agent.target_kind = 6;
        agent.target_id = 0;
        agent.route_progress = distance(agent.x, agent.z, agent.home_x, agent.home_z);
        ctx.db.combat_agent().id().update(agent);
    }
}

fn refresh_company_summaries(
    ctx: &ReducerContext,
    tick: u64,
    dt: f64,
    military_demands: u8,
) {
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
                    && tick.saturating_sub(company.last_combat_tick)
                        >= military_battle_end_ticks()
                {
                    let previous_level = company.level.max(1);
                    company.experience = company
                        .experience
                        .saturating_add(MILITARY_BATTLE_SURVIVAL_XP);
                    company.level = military_level_for_experience(company.experience);
                    company.battle_started_tick = 0;
                    company.last_combat_tick = 0;
                    if company.level > previous_level {
                        apply_veteran_level_health(
                            ctx,
                            company.id,
                            previous_level,
                            company.level,
                        );
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

fn nearest_distributed_enemy(
    ctx: &ReducerContext,
    source: &CombatAgent,
    company_id: u64,
) -> Option<(f64, CombatAgent)> {
    let company_agents = ctx
        .db
        .military_member()
        .company_id()
        .filter(&company_id)
        .filter_map(|member| ctx.db.combat_agent().id().find(&member.combat_agent_id))
        .filter(|agent| agent.state != DOWNED && agent.health > 0.0)
        .collect::<Vec<_>>();
    ctx.db
        .combat_agent()
        .owner()
        .filter(&source.owner)
        .filter(|enemy| {
            matches!(enemy.faction, RAIDER | BANDIT) && enemy.state != DOWNED && enemy.health > 0.0
        })
        .map(|enemy| {
            let range = distance(source.x, source.z, enemy.x, enemy.z);
            let assigned = company_agents
                .iter()
                .filter(|friend| friend.target_kind == 7 && friend.target_id == enemy.id)
                .count() as f64;
            // About two attackers per defender keeps a line engaged without
            // creating one implausible dog-pile. Distance still dominates.
            let score = range + assigned * 2.75;
            (score, range, enemy)
        })
        .min_by(|left, right| left.0.total_cmp(&right.0))
        .map(|(_, range, enemy)| (range, enemy))
}

#[derive(Clone, Copy)]
struct HostileProfile {
    armor: f64,
    shield: f64,
    penetration: f64,
    role: u8,
}

fn hostile_profile(enemy: &CombatAgent) -> HostileProfile {
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

fn walk_flocked(
    ctx: &ReducerContext,
    agent: &mut CombatAgent,
    company_id: u64,
    goal_x: f64,
    goal_z: f64,
    speed: f64,
    dt: f64,
) {
    let goal_dx = goal_x - agent.x;
    let goal_dz = goal_z - agent.z;
    let goal_distance = goal_dx.hypot(goal_dz);
    if goal_distance <= 1e-6 {
        return;
    }
    let mut separation_x = 0.0;
    let mut separation_z = 0.0;
    let mut center_x = 0.0;
    let mut center_z = 0.0;
    let mut neighbors = 0_u32;
    for member in ctx.db.military_member().company_id().filter(&company_id) {
        if member.combat_agent_id == agent.id || member.phase != 1 {
            continue;
        }
        let Some(friend) = ctx.db.combat_agent().id().find(&member.combat_agent_id) else {
            continue;
        };
        if friend.state == DOWNED || friend.health <= 0.0 {
            continue;
        }
        center_x += friend.x;
        center_z += friend.z;
        neighbors += 1;
        let dx = agent.x - friend.x;
        let dz = agent.z - friend.z;
        let range = dx.hypot(dz);
        if range > 1e-5 && range < 2.0 {
            let pressure = (2.0 - range) / 2.0;
            separation_x += dx / range * pressure;
            separation_z += dz / range * pressure;
        }
    }
    let mut steer_x = goal_dx / goal_distance;
    let mut steer_z = goal_dz / goal_distance;
    if neighbors > 0 {
        center_x /= neighbors as f64;
        center_z /= neighbors as f64;
        let cohesion_dx = center_x - agent.x;
        let cohesion_dz = center_z - agent.z;
        let cohesion_length = cohesion_dx.hypot(cohesion_dz).max(1e-6);
        steer_x += separation_x * 0.82 + cohesion_dx / cohesion_length * 0.16;
        steer_z += separation_z * 0.82 + cohesion_dz / cohesion_length * 0.16;
    }
    let length = steer_x.hypot(steer_z).max(1e-6);
    let step = (speed.max(0.0) * dt).min(goal_distance);
    agent.x += steer_x / length * step;
    agent.z += steer_z / length * step;
}

fn down_enemy(ctx: &ReducerContext, enemy: &mut CombatAgent, tick: u64) {
    if enemy.faction == RAIDER {
        down_external_raider(ctx, enemy, tick);
        return;
    }
    enemy.health = 0.0;
    enemy.state = DOWNED;
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
    camp.health = (
        camp.health - stats.damage * veteran_damage_multiplier(company.level) * 0.72
    ).max(0.0);
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
        if agent.state == DOWNED {
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
        return;
    }
    let step = (speed.max(0.0) * dt).min(distance);
    agent.x += dx / distance * step;
    agent.z += dz / distance * step;
}

fn walk_away(agent: &mut CombatAgent, x: f64, z: f64, speed: f64, dt: f64) {
    let dx = agent.x - x;
    let dz = agent.z - z;
    let length = dx.hypot(dz).max(1e-6);
    agent.x += dx / length * speed * dt;
    agent.z += dz / length * speed * dt;
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
