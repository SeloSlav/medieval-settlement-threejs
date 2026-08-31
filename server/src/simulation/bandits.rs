use std::collections::HashSet;

use spacetimedb::{Identity, ReducerContext};

use crate::balance_generated::{CALENDAR_SECONDS_PER_DAY, TICK_DT};
use crate::db::*;
use crate::security_policy::RaidPortableStores;
use crate::tables::{BanditCamp, BanditIncident, CombatAgent};

use super::raid_agents::reclamation_from_raid_stores;
use super::reclamation::{recover_stock_at, ReclamationStock};
use super::settlement_security::{building_portable_stores, retain_unplundered_stores};

const BANDIT: u8 = 2;
const ADVANCING: u8 = 0;
const FIGHTING: u8 = 1;
const LOOTING: u8 = 2;
const RETURNING: u8 = 3;
const DOWNED: u8 = 5;
const HOLDING: u8 = 9;
const CONTACT: f64 = 2.4;
const CAMP_RESPAWN_DAYS: u64 = 8;
const CAMP_DEFENDERS: u32 = 4;
const CAMP_TOWN_CLEARANCE: f64 = 120.0;
const CAMP_RESOURCE_CLEARANCE: f64 = 55.0;
const CAMP_NEIGHBOR_CLEARANCE: f64 = 110.0;

pub fn step_bandit_world(
    ctx: &ReducerContext,
    sim_tick: u64,
    seed: u64,
    map_size: u8,
    enabled: bool,
    elapsed: f64,
) {
    if !enabled {
        clear_bandits(ctx);
        return;
    }
    ensure_camps(ctx, sim_tick, seed, map_size);
    dispatch_thefts(ctx, sim_tick);
    step_bandits(ctx, sim_tick, elapsed);
    cleanup_downed(ctx, elapsed);
}

fn clear_bandits(ctx: &ReducerContext) {
    for agent in ctx.db.combat_agent().iter().filter(|a| a.faction == BANDIT).collect::<Vec<_>>() {
        ctx.db.militia_order().combat_agent_id().delete(agent.id);
        ctx.db.combat_agent().id().delete(agent.id);
    }
    for camp in ctx.db.bandit_camp().iter().collect::<Vec<_>>() {
        ctx.db.bandit_camp().id().delete(camp.id);
    }
}

fn ensure_camps(ctx: &ReducerContext, tick: u64, seed: u64, map_size: u8) {
    let owners = ctx.db.building().iter().map(|b| b.owner).collect::<HashSet<_>>();
    let count = match map_size { 0 => 1, 2 => 3, _ => 2 };
    for owner in owners {
        let known = ctx.db.bandit_camp().owner().filter(&owner).count();
        let active = ctx.db.bandit_camp().owner().filter(&owner).filter(|camp| camp.active).count();
        if active >= count { continue; }
        let mut new_rows_available = count.saturating_sub(known);
        let mut reusable = ctx.db.bandit_camp().owner().filter(&owner)
            .filter(|camp| !camp.active && camp_respawn_ready(tick, camp.destroyed_tick))
            .collect::<Vec<_>>();
        // Pop the oldest destroyed camp first. Reusing the persistent row keeps
        // incident history stable while its new spawn position is authoritative.
        reusable.sort_by(|left, right| right.destroyed_tick.cmp(&left.destroyed_tick)
            .then_with(|| right.id.cmp(&left.id)));
        for index in active..count {
            let recycled = reusable.pop();
            if recycled.is_none() && new_rows_available == 0 { break; }
            if recycled.is_none() { new_rows_available -= 1; }
            let entropy = recycled.as_ref().map_or(tick ^ index as u64, |camp| {
                camp.id ^ camp.destroyed_tick.rotate_left(17)
            });
            let (x, z) = camp_spawn_position(ctx, owner, seed, map_size, index, entropy);
            let theft_delay_days = 2 + (index as u64 % 2);
            let camp = if let Some(mut camp) = recycled {
                camp.x = x; camp.z = z;
                camp.health = 180.0; camp.max_health = 180.0; camp.active = true;
                camp.inventory_json = "[]".into(); camp.spawned_tick = tick;
                camp.next_theft_tick = tick.saturating_add(day_ticks().saturating_mul(theft_delay_days));
                camp.last_theft_tick = 0; camp.destroyed_tick = 0;
                ctx.db.bandit_camp().id().update(camp.clone());
                camp
            } else {
                ctx.db.bandit_camp().insert(BanditCamp {
                    id: 0, owner, x, z, health: 180.0, max_health: 180.0, active: true,
                    inventory_json: "[]".into(), spawned_tick: tick,
                    next_theft_tick: tick.saturating_add(day_ticks().saturating_mul(theft_delay_days)),
                    last_theft_tick: 0, destroyed_tick: 0,
                })
            };
            spawn_camp_defenders(ctx, &camp, tick);
        }
    }
}

fn spawn_camp_defenders(ctx: &ReducerContext, camp: &BanditCamp, tick: u64) {
    for slot in 0..CAMP_DEFENDERS {
        let angle = slot as f64 / CAMP_DEFENDERS as f64 * std::f64::consts::TAU;
        ctx.db.combat_agent().insert(CombatAgent {
            id: 0, owner: camp.owner, raid_id: camp.id, faction: BANDIT,
            source_building_id: 0, source_slot: slot, target_kind: 5, target_id: camp.id,
            assigned_building_id: 0,
            x: camp.x + angle.cos() * 5.0, z: camp.z + angle.sin() * 5.0,
            velocity_x: 0.0, velocity_z: 0.0,
            home_x: camp.x, home_z: camp.z, health: 64.0, max_health: 64.0,
            readiness: 0.62, state: HOLDING, attack_cooldown: 0.0,
            loot_progress: 0.0, loot_fraction: 0.0, carried_loot_json: String::new(),
            state_changed_tick: tick, route_progress: 0.0,
            raid_anchor_building_id: camp.id,
        });
    }
}

fn camp_respawn_ready(tick: u64, destroyed_tick: u64) -> bool {
    destroyed_tick == 0
        || tick >= destroyed_tick.saturating_add(day_ticks().saturating_mul(CAMP_RESPAWN_DAYS))
}

fn camp_spawn_position(
    ctx: &ReducerContext,
    owner: Identity,
    seed: u64,
    map_size: u8,
    ordinal: usize,
    entropy: u64,
) -> (f64, f64) {
    let half = match map_size { 0 => 408.5, 2 => 1_155.412_48, _ => 817.0 };
    let buildings = ctx.db.building().owner().filter(&owner)
        .filter(|building| building.construction_complete).collect::<Vec<_>>();
    let foraging = ctx.db.foraging_node().iter().collect::<Vec<_>>();
    let quarries = ctx.db.quarry().iter().collect::<Vec<_>>();
    let active_camps = ctx.db.bandit_camp().owner().filter(&owner)
        .filter(|camp| camp.active).collect::<Vec<_>>();
    (0..32_u64)
        .map(|candidate_index| {
            let hash = mix(seed
                ^ entropy.rotate_left(11)
                ^ (ordinal as u64 + 1).wrapping_mul(0x9e37_79b9)
                ^ candidate_index.wrapping_mul(0x94d0_49bb));
            let angle = unit(hash) * std::f64::consts::TAU;
            let radius = half * (0.58 + unit(mix(hash)) * 0.28);
            let point = (angle.cos() * radius, angle.sin() * radius);
            let town_clearance = buildings.iter()
                .map(|building| dist(point.0, point.1, building.x, building.z))
                .fold(half * 2.0, f64::min);
            let forage_clearance = foraging.iter()
                .map(|node| dist(point.0, point.1, node.x, node.z))
                .fold(half * 2.0, f64::min);
            let quarry_clearance = quarries.iter()
                .map(|node| dist(point.0, point.1, node.x, node.z))
                .fold(half * 2.0, f64::min);
            let camp_clearance = active_camps.iter()
                .map(|camp| dist(point.0, point.1, camp.x, camp.z))
                .fold(half * 2.0, f64::min);
            let fully_clear = town_clearance >= CAMP_TOWN_CLEARANCE
                && forage_clearance >= CAMP_RESOURCE_CLEARANCE
                && quarry_clearance >= CAMP_RESOURCE_CLEARANCE
                && camp_clearance >= CAMP_NEIGHBOR_CLEARANCE;
            // Settlements dominate, but a camp cannot win merely by sitting on
            // a food/deposit node or immediately beside another live camp.
            let score = town_clearance
                .min(forage_clearance * 1.45)
                .min(quarry_clearance * 1.45)
                .min(camp_clearance * 1.15);
            (fully_clear, score, candidate_index, point)
        })
        .max_by(|left, right| left.0.cmp(&right.0)
            .then_with(|| left.1.total_cmp(&right.1))
            .then_with(|| left.2.cmp(&right.2)))
        .map(|(_, _, _, point)| point)
        .unwrap_or((0.0, -half * 0.72))
}

fn dispatch_thefts(ctx: &ReducerContext, tick: u64) {
    for mut camp in ctx.db.bandit_camp().iter()
        .filter(|c| c.active && tick >= c.next_theft_tick).collect::<Vec<_>>() {
        let target = ctx.db.building().owner().filter(&camp.owner)
            .filter(|b| b.construction_complete
                && matches!(b.kind.as_str(), "granary" | "village_storehouse")
                && building_portable_stores(b).goods_amount() >= 1.0)
            .max_by(|a, b| building_portable_stores(a).goods_amount()
                .total_cmp(&building_portable_stores(b).goods_amount()));
        let actor = ctx.db.combat_agent().owner().filter(&camp.owner)
            .find(|a| a.faction == BANDIT && a.raid_anchor_building_id == camp.id && a.state == HOLDING);
        if let (Some(target), Some(mut actor)) = (target, actor) {
            actor.state = ADVANCING;
            actor.target_kind = 0;
            actor.target_id = target.id;
            actor.state_changed_tick = tick;
            ctx.db.combat_agent().id().update(actor);
            camp.next_theft_tick = tick.saturating_add(day_ticks().saturating_mul(4));
        } else {
            camp.next_theft_tick = tick.saturating_add(day_ticks());
        }
        ctx.db.bandit_camp().id().update(camp);
    }
}

fn step_bandits(ctx: &ReducerContext, tick: u64, dt: f64) {
    for mut agent in ctx.db.combat_agent().iter()
        .filter(|a| a.faction == BANDIT && a.state != DOWNED).collect::<Vec<_>>() {
        if agent.state == FIGHTING {
            agent.state = if agent.carried_loot_json.is_empty() { HOLDING } else { RETURNING };
        }
        match agent.state {
            ADVANCING => {
                if let Some(target) = ctx.db.building().id().find(&agent.target_id) {
                    walk(&mut agent, target.x, target.z, 2.15, dt);
                    if dist(agent.x, agent.z, target.x, target.z) <= CONTACT + 1.5 {
                        agent.state = LOOTING;
                        agent.loot_progress = 0.0;
                    }
                } else { agent.state = RETURNING; }
            }
            LOOTING => {
                agent.loot_progress += dt;
                if agent.loot_progress >= 5.0 {
                    steal(ctx, &mut agent, tick);
                    agent.state = RETURNING;
                }
            }
            RETURNING => {
                let (hx, hz) = (agent.home_x, agent.home_z);
                walk(&mut agent, hx, hz, 2.15, dt);
                if dist(agent.x, agent.z, hx, hz) <= CONTACT {
                    deposit(ctx, &mut agent);
                    agent.state = HOLDING;
                    agent.target_kind = 5;
                    agent.target_id = agent.raid_anchor_building_id;
                }
            }
            HOLDING => {
                let phase = tick as f64 * 0.013 + agent.source_slot as f64 * 1.9;
                let (hx, hz) = (agent.home_x, agent.home_z);
                walk(&mut agent, hx + phase.cos() * 5.0, hz + phase.sin() * 5.0, 0.75, dt);
            }
            _ => {}
        }
        agent.attack_cooldown = (agent.attack_cooldown - dt).max(0.0);
        agent.state_changed_tick = tick;
        ctx.db.combat_agent().id().update(agent);
    }
}

fn steal(ctx: &ReducerContext, agent: &mut CombatAgent, tick: u64) {
    let Some(mut building) = ctx.db.building().id().find(&agent.target_id) else { return; };
    if !matches!(building.kind.as_str(), "granary" | "village_storehouse") { return; }
    let before = building_portable_stores(&building);
    let total = before.goods_amount();
    if total < 1.0 { return; }
    let plunder = before.plunder((8.0 / total).clamp(0.02, 0.18));
    let carried = before.removed_between(plunder.remaining).normalized_whole();
    retain_unplundered_stores(&mut building, plunder.remaining);
    ctx.db.building().id().update(building.clone());
    agent.carried_loot_json = serde_json::to_string(&carried).unwrap_or_default();
    if carried.goods_amount() > 0.0 {
        incident(ctx, agent.owner, agent.raid_anchor_building_id, 0, building.id,
            &agent.carried_loot_json, carried.goods_amount(), tick, building.x, building.z);
        if let Some(mut camp) = ctx.db.bandit_camp().id().find(&agent.raid_anchor_building_id) {
            camp.last_theft_tick = tick;
            ctx.db.bandit_camp().id().update(camp);
        }
    }
}

fn deposit(ctx: &ReducerContext, agent: &mut CombatAgent) {
    let Ok(bundle) = serde_json::from_str::<RaidPortableStores>(&agent.carried_loot_json) else {
        agent.carried_loot_json.clear(); return;
    };
    if let Some(mut camp) = ctx.db.bandit_camp().id().find(&agent.raid_anchor_building_id) {
        let mut bundles = serde_json::from_str::<Vec<RaidPortableStores>>(&camp.inventory_json).unwrap_or_default();
        bundles.push(bundle.normalized_whole());
        camp.inventory_json = serde_json::to_string(&bundles).unwrap_or_else(|_| "[]".into());
        ctx.db.bandit_camp().id().update(camp);
    }
    agent.carried_loot_json.clear();
}

pub(super) fn destroy_camp(ctx: &ReducerContext, camp: &mut BanditCamp, tick: u64) {
    camp.active = false; camp.destroyed_tick = tick;
    camp.next_theft_tick = tick.saturating_add(day_ticks().saturating_mul(CAMP_RESPAWN_DAYS));
    let bundles = serde_json::from_str::<Vec<RaidPortableStores>>(&camp.inventory_json).unwrap_or_default();
    let mut recovered = ReclamationStock::default();
    let mut total = 0.0;
    for bundle in bundles { total += bundle.goods_amount(); recovered = recovered.merged(reclamation_from_raid_stores(bundle)); }
    let _ = recover_stock_at(ctx, camp.owner, camp.x, camp.z, recovered);
    incident(ctx, camp.owner, camp.id, 2, 0, &camp.inventory_json, total, tick, camp.x, camp.z);
    camp.inventory_json = "[]".into();
    for agent in ctx.db.combat_agent().owner().filter(&camp.owner)
        .filter(|a| a.faction == BANDIT && a.raid_anchor_building_id == camp.id).collect::<Vec<_>>() {
        ctx.db.combat_agent().id().delete(agent.id);
    }
}

fn cleanup_downed(ctx: &ReducerContext, dt: f64) {
    for mut agent in ctx.db.combat_agent().iter()
        .filter(|a| a.faction == BANDIT && a.state == DOWNED).collect::<Vec<_>>() {
        agent.attack_cooldown = (agent.attack_cooldown - dt).max(0.0);
        if agent.attack_cooldown <= 0.0 {
            ctx.db.militia_order().combat_agent_id().delete(agent.id);
            ctx.db.combat_agent().id().delete(agent.id);
        } else { ctx.db.combat_agent().id().update(agent); }
    }
}

fn incident(ctx: &ReducerContext, owner: Identity, camp_id: u64, kind: u8, building_id: u64,
    json: &str, total: f64, tick: u64, x: f64, z: f64) {
    ctx.db.bandit_incident().insert(BanditIncident {
        id: 0, owner, camp_id, kind, building_id, goods_json: json.into(), goods_total: total,
        occurred_tick: tick, x, z,
    });
}

fn walk(agent: &mut CombatAgent, x: f64, z: f64, speed: f64, dt: f64) {
    let dx = x - agent.x; let dz = z - agent.z; let d = dx.hypot(dz);
    if d <= 1e-6 { agent.velocity_x = 0.0; agent.velocity_z = 0.0; return; }
    let step = (speed * dt).min(d);
    let move_x = dx / d * step; let move_z = dz / d * step;
    agent.x += move_x; agent.z += move_z;
    agent.velocity_x = move_x / dt.max(1e-9); agent.velocity_z = move_z / dt.max(1e-9);
}
fn dist(ax: f64, az: f64, bx: f64, bz: f64) -> f64 { (ax - bx).hypot(az - bz) }
fn day_ticks() -> u64 { (CALENDAR_SECONDS_PER_DAY / TICK_DT).round().max(1.0) as u64 }
fn mix(mut v: u64) -> u64 {
    v = v.wrapping_add(0x9e37_79b9_7f4a_7c15);
    v = (v ^ (v >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    v = (v ^ (v >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb); v ^ (v >> 31)
}
fn unit(v: u64) -> f64 { (v >> 11) as f64 / ((1_u64 << 53) as f64) }

#[cfg(test)]
mod tests {
    use super::{camp_respawn_ready, day_ticks, CAMP_RESPAWN_DAYS};

    #[test]
    fn destroyed_camps_wait_before_respawning() {
        let destroyed = 100;
        let due = destroyed + day_ticks() * CAMP_RESPAWN_DAYS;
        assert!(!camp_respawn_ready(due - 1, destroyed));
        assert!(camp_respawn_ready(due, destroyed));
    }
}
