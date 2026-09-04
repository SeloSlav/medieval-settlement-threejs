use std::collections::HashSet;

use spacetimedb::{Identity, ReducerContext};

use crate::balance_generated::{CALENDAR_SECONDS_PER_DAY, TICK_DT};
use crate::db::*;
use crate::dog_patrol_policy::{
    is_road_patrol_target, is_woodland_tree_target, open_ground_patrol_point,
    patrol_target_matches_duty, woodland_tree_target_id, woodland_tree_target_position,
    ROAD_PATROL_TARGET_TAG,
};
use crate::economy::{
    building_edible_food_stock, residence_edible_food_stock, withdraw_building_edible_food,
    withdraw_residence_commodity, CommodityKind,
};
use crate::roads::RoadNetwork;
use crate::wildlife_combat_policy::{
    guard_dog_pursuit_step, ANIMAL_CONTACT_DISTANCE as CONTACT_DISTANCE,
    FOX_FLEE_SPEED, WOLF_FLEE_SPEED, GUARD_DOG_BITE_DAMAGE, GUARD_DOG_BITE_INTERVAL,
};
use crate::tables::{cavalry_horse, CombatAgent, Corpse};

use super::raid_agents::move_along_combat_route;
use super::SharedRoadNetworks;

const DOG: u8 = 12;
const FOX: u8 = 13;
const WOLF: u8 = 14;
const ADVANCING: u8 = 0;
const FIGHTING: u8 = 1;
const LOOTING: u8 = 2;
const RETREATING: u8 = 3;
const RETURNING: u8 = 4;
const DOWNED: u8 = 5;
const HOLDING: u8 = 9;
const TARGET_BUILDING: u8 = 0;
const TARGET_RESIDENCE: u8 = 1;
const TARGET_GROUND: u8 = 6;
const TARGET_COMBAT_AGENT: u8 = 7;
const TARGET_STABLE_OX: u8 = 8;
const HUNTING_DOG_RUN_SPEED: f64 = 2.85;
const HUNTING_DOG_MIN_WOODLAND_RANGE: f64 = 10.0;
const ROAD_PATROL_ORDINAL_MASK: u64 = 0x0000_ffff_ffff_ffff;

#[derive(Clone, Copy)]
struct Target {
    kind: u8,
    id: u64,
    x: f64,
    z: f64,
}

pub fn step_wild_animal_world(
    ctx: &ReducerContext,
    sim_tick: u64,
    spawn_through_tick: u64,
    seed: u64,
    map_size: u8,
    enabled: bool,
    elapsed: f64,
    road_networks: Option<&SharedRoadNetworks>,
) {
    if !elapsed.is_finite() || elapsed <= 0.0 {
        return;
    }
    if !enabled {
        clear_hostile_wildlife(ctx);
    } else {
        spawn_due_incursions(ctx, sim_tick, spawn_through_tick, seed, map_size);
    }
    step_guard_dogs(ctx, sim_tick, elapsed, road_networks);
    if enabled {
        step_foxes(ctx, sim_tick, elapsed);
        step_wolves(ctx, sim_tick, elapsed);
    }
    cleanup_downed_animals(ctx, elapsed);
}

fn spawn_due_incursions(
    ctx: &ReducerContext,
    tick: u64,
    spawn_through_tick: u64,
    seed: u64,
    map_size: u8,
) {
    let day_ticks = (CALENDAR_SECONDS_PER_DAY / TICK_DT).round().max(1.0) as u64;
    let grace_tick = day_ticks * 4;
    if spawn_through_tick < grace_tick {
        return;
    }
    let spawn_window_start = tick.max(grace_tick.saturating_sub(1));
    let owners = ctx
        .db
        .building()
        .iter()
        .filter(|building| building.construction_complete)
        .map(|building| building.owner)
        .collect::<HashSet<_>>();
    for owner in owners {
        let owner_seed = identity_seed(owner);
        let fox_interval = day_ticks * 9;
        if recurring_phase_crossed(
            spawn_window_start,
            spawn_through_tick,
            mix(seed ^ owner_seed, 0x464f58) % fox_interval,
            fox_interval,
        ) && !ctx
            .db
            .combat_agent()
            .owner()
            .filter(&owner)
            .any(|agent| agent.faction == FOX)
        {
            if let Some(target) = fox_target(ctx, owner, tick ^ seed ^ owner_seed) {
                spawn_fox(ctx, owner, tick, seed ^ owner_seed, map_size, target);
            }
        }
        let wolf_interval = day_ticks * 14;
        if recurring_phase_crossed(
            spawn_window_start,
            spawn_through_tick,
            mix(seed ^ owner_seed, 0x574f4c46) % wolf_interval,
            wolf_interval,
        ) && !ctx
            .db
            .combat_agent()
            .owner()
            .filter(&owner)
            .any(|agent| agent.faction == WOLF)
        {
            if let Some(target) = wolf_target(ctx, owner, tick ^ seed) {
                spawn_wolf_pack(ctx, owner, tick, seed ^ owner_seed, map_size, target);
            }
        }
    }
}

/// Detect a recurring event crossed by this heartbeat's calendar step.
/// Faster game speeds can advance several ticks at once, so exact equality
/// would silently skip most world-seeded incursions.
fn recurring_phase_crossed(start: u64, end: u64, phase: u64, interval: u64) -> bool {
    if interval == 0 || end <= start {
        return false;
    }
    let phase = phase % interval;
    let base = start - start % interval;
    let mut candidate = base.saturating_add(phase);
    if candidate <= start {
        candidate = candidate.saturating_add(interval);
    }
    candidate <= end
}

fn spawn_fox(
    ctx: &ReducerContext,
    owner: Identity,
    tick: u64,
    seed: u64,
    map_size: u8,
    target: Target,
) {
    let (x, z, home_x, home_z) = woodland_entry(target, seed, map_size, 78.0);
    insert_animal(
        ctx,
        owner,
        0x4000_0000_0000_0000 | tick,
        FOX,
        0,
        target,
        x,
        z,
        home_x,
        home_z,
        34.0,
        tick,
    );
}

fn spawn_wolf_pack(
    ctx: &ReducerContext,
    owner: Identity,
    tick: u64,
    seed: u64,
    map_size: u8,
    target: Target,
) {
    let event_id = 0x8000_0000_0000_0000 | tick;
    let pack_roll = mix(seed, tick);
    let count = if pack_roll % 5 == 0 {
        1
    } else {
        4 + (pack_roll % 4) as u32
    };
    let (x, z, home_x, home_z) = woodland_entry(target, seed ^ event_id, map_size, 92.0);
    for slot in 0..count {
        let angle = slot as f64 * 2.399_963_229_728_653;
        let radius = 0.8 + slot as f64 * 0.34;
        insert_animal(
            ctx,
            owner,
            event_id,
            WOLF,
            slot,
            target,
            x + angle.cos() * radius,
            z + angle.sin() * radius,
            home_x,
            home_z,
            68.0,
            tick,
        );
    }
}

/// Development-menu entry point. Unlike the recurring world event, the
/// requested map position is the physical incursion entry selected by the
/// player. The ordinary target selectors and animal simulation take over from
/// the next heartbeat.
pub fn spawn_debug_wild_animals(
    ctx: &ReducerContext,
    owner: Identity,
    tick: u64,
    x: f64,
    z: f64,
) -> Result<u32, String> {
    let fox_target = fox_target(ctx, owner, tick ^ x.to_bits()).ok_or_else(|| {
        "Wild animals need a stocked building, home, herd, garden, or ox to target.".to_string()
    })?;
    let wolf_target = wolf_target(ctx, owner, tick ^ z.to_bits()).unwrap_or(fox_target);
    let event_id =
        0xd000_0000_0000_0000 ^ tick.rotate_left(13) ^ x.to_bits().rotate_left(29) ^ z.to_bits();
    insert_animal(
        ctx,
        owner,
        event_id,
        FOX,
        0,
        fox_target,
        x - 1.8,
        z,
        x,
        z,
        34.0,
        tick,
    );
    let wolf_count = 5_u32;
    for slot in 0..wolf_count {
        let angle = slot as f64 * 2.399_963_229_728_653;
        let radius = 1.2 + slot as f64 * 0.38;
        insert_animal(
            ctx,
            owner,
            event_id ^ 0x574f_4c46,
            WOLF,
            slot,
            wolf_target,
            x + angle.cos() * radius,
            z + angle.sin() * radius,
            x,
            z,
            68.0,
            tick,
        );
    }
    Ok(wolf_count + 1)
}

#[allow(clippy::too_many_arguments)]
fn insert_animal(
    ctx: &ReducerContext,
    owner: Identity,
    event_id: u64,
    faction: u8,
    slot: u32,
    target: Target,
    x: f64,
    z: f64,
    home_x: f64,
    home_z: f64,
    health: f64,
    tick: u64,
) {
    ctx.db.combat_agent().insert(CombatAgent {
        id: 0,
        owner,
        raid_id: event_id,
        faction,
        source_building_id: 0,
        source_slot: slot,
        resident_slot: 0,
        assigned_building_id: 0,
        target_kind: target.kind,
        target_id: target.id,
        engagement_target_id: 0,
        x,
        z,
        velocity_x: 0.0,
        velocity_z: 0.0,
        home_x,
        home_z,
        health,
        max_health: health,
        readiness: 1.0,
        state: ADVANCING,
        attack_cooldown: 0.0,
        loot_progress: 0.0,
        loot_fraction: 0.0,
        carried_loot_json: String::new(),
        state_changed_tick: tick,
        route_progress: 0.0,
        raid_anchor_building_id: 0,
    });
}

fn step_guard_dogs(
    ctx: &ReducerContext,
    tick: u64,
    dt: f64,
    road_networks: Option<&SharedRoadNetworks>,
) {
    let dogs = ctx
        .db
        .combat_agent()
        .iter()
        .filter(|agent| agent.faction == DOG)
        .collect::<Vec<_>>();
    for mut dog in dogs {
        if dog.state == DOWNED {
            continue;
        }
        dog.attack_cooldown = (dog.attack_cooldown - dt).max(0.0);
        let road_network = road_networks.and_then(|networks| networks.get(&dog.owner));
        let threat = nearest_hostile(ctx, &dog, 52.0);
        if let Some(enemy) = threat {
            dog.target_kind = TARGET_COMBAT_AGENT;
            dog.target_id = enemy.id;
            let (x, z, contact) = guard_dog_pursuit_step(dog.x, dog.z, enemy.x, enemy.z, dt);
            dog.velocity_x = (x - dog.x) / dt.max(1e-9);
            dog.velocity_z = (z - dog.z) / dt.max(1e-9);
            dog.x = x;
            dog.z = z;
            dog.route_progress = distance(x, z, enemy.x, enemy.z);
            if contact {
                dog.state = FIGHTING;
                dog_attack(ctx, &mut dog, enemy, tick);
            } else {
                dog.state = ADVANCING;
            }
        } else {
            patrol_dog(ctx, &mut dog, tick, dt, road_network);
        }
        ctx.db.combat_agent().id().update(dog);
    }
}

fn dog_attack(ctx: &ReducerContext, dog: &mut CombatAgent, mut enemy: CombatAgent, tick: u64) {
    if dog.attack_cooldown > 0.0 {
        return;
    }
    enemy.health = (enemy.health - GUARD_DOG_BITE_DAMAGE).max(0.0);
    dog.attack_cooldown = GUARD_DOG_BITE_INTERVAL;
    if enemy.faction == FOX && enemy.health > 0.0 {
        enemy.state = RETREATING;
        enemy.target_kind = TARGET_GROUND;
        enemy.target_id = 0;
    } else if enemy.health <= 0.0 {
        enemy.state = DOWNED;
        enemy.attack_cooldown = 7.0;
        enemy.state_changed_tick = tick;
    } else {
        enemy.state = FIGHTING;
        enemy.target_kind = TARGET_COMBAT_AGENT;
        enemy.target_id = dog.id;
        // Wolves own their bite and cooldown in step_wolves. Retaliating here
        // too allowed two wolf bites in one high-speed heartbeat.
    }
    ctx.db.combat_agent().id().update(enemy);
}

fn patrol_dog(
    ctx: &ReducerContext,
    dog: &mut CombatAgent,
    tick: u64,
    dt: f64,
    road_network: Option<&RoadNetwork>,
) {
    dog.engagement_target_id = 0;
    let assigned = dog.assigned_building_id > 0;
    let recovering = dog.health + 1e-6 < dog.max_health;
    let target = dog_target_position(ctx, dog.target_kind, dog.target_id, road_network);
    if !patrol_target_matches_duty(
        dog.target_kind,
        dog.target_id,
        assigned,
        dog.source_building_id,
        recovering,
        road_network.is_some_and(|network| network.road_patrol_stop_count() > 0),
    ) || target.is_none()
        || target.is_some_and(|target| distance(dog.x, dog.z, target.x, target.z) < 1.3)
    {
        if let Some(patrol) = dog_patrol_target(ctx, dog, dog.id ^ tick / 90, road_network) {
            dog.target_kind = patrol.kind;
            dog.target_id = patrol.id;
        } else {
            dog.target_kind = TARGET_GROUND;
            dog.target_id = 0;
            dog.state = HOLDING;
        }
    }
    dog.velocity_x = 0.0;
    dog.velocity_z = 0.0;
    if let Some(target) = dog_target_position(ctx, dog.target_kind, dog.target_id, road_network) {
        // Movement state alone does not imply combat; the target owns intent.
        dog.state = if recovering { RETURNING } else { ADVANCING };
        let speed = if is_woodland_tree_target(target.kind, target.id) {
            HUNTING_DOG_RUN_SPEED
        } else {
            1.65
        };
        if is_woodland_tree_target(target.kind, target.id) {
            move_toward(dog, target.x, target.z, speed, dt);
        } else {
            move_dog_over_roads(dog, target.x, target.z, speed, dt, road_network);
        }
    }
    if dog.health < dog.max_health && distance(dog.x, dog.z, dog.home_x, dog.home_z) < 8.0 {
        dog.health = (dog.health + dog.max_health * 0.01 * dt).min(dog.max_health);
    }
}

fn step_foxes(ctx: &ReducerContext, tick: u64, dt: f64) {
    let foxes = ctx
        .db
        .combat_agent()
        .iter()
        .filter(|agent| agent.faction == FOX)
        .collect::<Vec<_>>();
    for mut fox in foxes {
        if fox.state == DOWNED {
            continue;
        }
        if nearest_defender(ctx, &fox, 14.0).is_some() {
            fox.state = RETREATING;
        }
        if fox.state == RETREATING || fox.state == RETURNING {
            let (home_x, home_z) = (fox.home_x, fox.home_z);
            move_toward(&mut fox, home_x, home_z, FOX_FLEE_SPEED, dt);
            if distance(fox.x, fox.z, fox.home_x, fox.home_z) < 2.0 {
                ctx.db.combat_agent().id().delete(fox.id);
                continue;
            }
        } else if let Some(target) = target_position(ctx, fox.target_kind, fox.target_id) {
            if distance(fox.x, fox.z, target.x, target.z) > CONTACT_DISTANCE {
                fox.state = ADVANCING;
                move_toward(&mut fox, target.x, target.z, 2.75, dt);
            } else {
                fox.state = LOOTING;
                fox.loot_progress += dt;
                if fox.loot_progress >= 9.0 {
                    let (stolen, damaged) = fox_contact_result(ctx, &fox);
                    fox.carried_loot_json = if stolen > 0.0 {
                        format!("{{\"wildFood\":{stolen:.0}}}")
                    } else if damaged {
                        "{\"wildLivestockLoss\":1}".to_string()
                    } else {
                        String::new()
                    };
                    fox.state = RETREATING;
                    fox.loot_progress = 0.0;
                    fox.state_changed_tick = tick;
                }
            }
        } else {
            fox.state = RETREATING;
        }
        ctx.db.combat_agent().id().update(fox);
    }
}

fn step_wolves(ctx: &ReducerContext, tick: u64, dt: f64) {
    let wolves = ctx
        .db
        .combat_agent()
        .iter()
        .filter(|agent| agent.faction == WOLF)
        .collect::<Vec<_>>();
    for mut wolf in wolves {
        if wolf.state == DOWNED {
            continue;
        }
        wolf.attack_cooldown = (wolf.attack_cooldown - dt).max(0.0);
        if wolf.state == RETREATING || wolf.state == RETURNING {
            let (home_x, home_z) = (wolf.home_x, wolf.home_z);
            move_toward(&mut wolf, home_x, home_z, WOLF_FLEE_SPEED, dt);
            if distance(wolf.x, wolf.z, wolf.home_x, wolf.home_z) < 2.4 {
                ctx.db.combat_agent().id().delete(wolf.id);
                continue;
            }
            ctx.db.combat_agent().id().update(wolf);
            continue;
        }
        if let Some(defender) = nearest_defender(ctx, &wolf, 5.0) {
            wolf.target_kind = TARGET_COMBAT_AGENT;
            wolf.target_id = defender.id;
        }
        let Some(target) = target_position(ctx, wolf.target_kind, wolf.target_id) else {
            if let Some(next) = wolf_target(ctx, wolf.owner, wolf.raid_id ^ tick) {
                wolf.target_kind = next.kind;
                wolf.target_id = next.id;
                wolf.loot_progress = 0.0;
            } else {
                wolf.state = RETREATING;
            }
            ctx.db.combat_agent().id().update(wolf);
            continue;
        };
        let formation = wolf_pack_offset(wolf.source_slot);
        let goal_x = target.x + formation.0;
        let goal_z = target.z + formation.1;
        if distance(wolf.x, wolf.z, target.x, target.z) > CONTACT_DISTANCE + 0.35 {
            wolf.state = ADVANCING;
            move_toward(&mut wolf, goal_x, goal_z, 2.55, dt);
        } else if wolf.target_kind == TARGET_COMBAT_AGENT {
            wolf.state = FIGHTING;
            wolf_bite_defender(ctx, &mut wolf, tick);
        } else {
            wolf.state = LOOTING;
            wolf.loot_progress += dt;
            if wolf.loot_progress >= 15.0 && damage_wolf_target(ctx, &wolf, tick) {
                retreat_pack(ctx, wolf.raid_id, tick);
            }
        }
        ctx.db.combat_agent().id().update(wolf);
    }
}

fn wolf_bite_defender(ctx: &ReducerContext, wolf: &mut CombatAgent, tick: u64) {
    let Some(mut defender) = ctx.db.combat_agent().id().find(&wolf.target_id) else {
        wolf.state = ADVANCING;
        return;
    };
    if defender.state == DOWNED || defender.health <= 0.0 {
        wolf.target_kind = TARGET_GROUND;
        wolf.target_id = 0;
        wolf.state = ADVANCING;
        return;
    }
    if wolf.attack_cooldown <= 0.0 {
        // Player-company rows stay above zero here so military.rs owns their
        // resident casualty/equipment recovery transaction. Dogs are native
        // animal rows and can be downed directly.
        let minimum = if defender.faction == DOG { 0.0 } else { 1.0 };
        defender.health = (defender.health - 9.0).max(minimum);
        wolf.attack_cooldown = 1.15;
        if defender.health <= 0.0 {
            if defender.faction == DOG {
                down_guard_dog(&mut defender, tick);
            } else {
                defender.state = DOWNED;
                defender.attack_cooldown = 7.0;
                defender.state_changed_tick = tick;
            }
        } else {
            defender.state = FIGHTING;
            defender.target_kind = TARGET_COMBAT_AGENT;
            defender.target_id = wolf.id;
        }
        ctx.db.combat_agent().id().update(defender);
    }
}

fn damage_wolf_target(ctx: &ReducerContext, wolf: &CombatAgent, tick: u64) -> bool {
    if wolf.target_kind == TARGET_STABLE_OX {
        if kill_stable_ox(ctx, wolf.target_id) {
            return true;
        }
    }
    if wolf.target_kind == TARGET_BUILDING {
        if let Some(building) = ctx.db.building().id().find(&wolf.target_id) {
            if building.kind == "pastoral_farmstead" || building.kind == "swineherd" {
                if let Some(mut herd) = ctx
                    .db
                    .pasture_herd()
                    .farmstead_id()
                    .filter(&building.id)
                    .filter(|herd| herd.present_head_count > 0)
                    .min_by_key(|herd| herd.pasture_id)
                {
                    if herd.species == crate::reducers::livestock::SPECIES_HORSE {
                        if let Some(horse) = ctx
                            .db
                            .cavalry_horse()
                            .pasture_id()
                            .filter(&herd.pasture_id)
                            .filter(|horse| horse.at_pasture)
                            .min_by_key(|horse| horse.id)
                        {
                            ctx.db.cavalry_horse().id().delete(horse.id);
                            crate::reducers::cavalry_horses::sync_horse_pasture_herd(
                                ctx,
                                herd.pasture_id,
                            );
                            return true;
                        }
                    }
                    herd.head_count = herd.head_count.saturating_sub(1);
                    herd.present_head_count = herd.present_head_count.saturating_sub(1);
                    herd.health = (herd.health - 0.12).max(0.0);
                    ctx.db.pasture_herd().pasture_id().update(herd);
                    return true;
                }
            }
            let mut building = building;
            let stolen = withdraw_building_edible_food(&mut building, 5.0);
            if stolen > 0.0 {
                ctx.db.building().id().update(building);
                return true;
            }
        }
    }
    if wolf.target_kind == TARGET_RESIDENCE {
        let Some(mut residence) = ctx.db.residence().id().find(&wolf.target_id) else {
            return false;
        };
        let garden_exists = ctx
            .db
            .backyard_garden()
            .residence_id()
            .filter(&residence.id)
            .next()
            .is_some();
        if garden_exists {
            super::clear_backyard_garden_for_residence(ctx, residence.id);
            residence.backyard_project_kind = 0;
            ctx.db.residence().id().update(residence);
            return true;
        }
        if steal_residence_food(&mut residence, 5.0) > 0.0 {
            ctx.db.residence().id().update(residence);
            return true;
        }
        if residence.population > 0 {
            residence.population = residence.population.saturating_sub(1);
            residence.sick_population = residence.sick_population.min(residence.population);
            residence.deaths_total = residence.deaths_total.saturating_add(1);
            let corpse_x = residence.x;
            let corpse_z = residence.z;
            let residence_id = residence.id;
            let owner = residence.owner;
            ctx.db.residence().id().update(residence);
            ctx.db.corpse().insert(Corpse {
                id: 0,
                owner,
                residence_id,
                cause: 3,
                state: 0,
                x: corpse_x,
                z: corpse_z,
                created_tick: tick,
                chapel_id: 0,
                graveyard_id: 0,
                progress: 0.0,
                speed_mps: 0.0,
                path_distance: 0.0,
                route_polyline_json: String::new(),
                cart_x: corpse_x,
                cart_z: corpse_z,
            });
            return true;
        }
    }
    false
}

/// A dead dog keeps its combat row briefly so the death animation remains
/// visible, but it relinquishes its kennel immediately. Purchases and the
/// inspector key occupancy by `source_building_id`, so this frees the authored
/// bay in the same transaction without spawning two live dogs in one slot.
fn down_guard_dog(dog: &mut CombatAgent, tick: u64) {
    dog.health = 0.0;
    dog.state = DOWNED;
    dog.attack_cooldown = 7.0;
    dog.state_changed_tick = tick;
    dog.source_building_id = 0;
    dog.assigned_building_id = 0;
    dog.target_kind = TARGET_GROUND;
    dog.target_id = 0;
}

/// Remove an ox and every durable hauling reservation that pointed at it.
/// Stable capacity is derived from live `stable_ox` rows, so deleting the row
/// releases its stable bay immediately and allows a replacement purchase.
fn kill_stable_ox(ctx: &ReducerContext, ox_id: u64) -> bool {
    let Some(ox) = ctx.db.stable_ox().id().find(&ox_id) else {
        return false;
    };
    for mut trip in ctx
        .db
        .delivery_trip()
        .owner()
        .filter(&ox.owner)
        .filter(|trip| trip.ox_id == ox_id)
        .collect::<Vec<_>>()
    {
        trip.ox_id = 0;
        ctx.db.delivery_trip().id().update(trip);
    }
    ctx.db.stable_ox().id().delete(ox_id);
    true
}

fn retreat_pack(ctx: &ReducerContext, raid_id: u64, tick: u64) {
    let pack = ctx
        .db
        .combat_agent()
        .raid_id()
        .filter(&raid_id)
        .collect::<Vec<_>>();
    for mut wolf in pack {
        if wolf.faction != WOLF || wolf.state == DOWNED {
            continue;
        }
        wolf.state = RETREATING;
        wolf.target_kind = TARGET_GROUND;
        wolf.target_id = 0;
        wolf.loot_progress = 0.0;
        wolf.state_changed_tick = tick;
        ctx.db.combat_agent().id().update(wolf);
    }
}

fn steal_food_at_target(ctx: &ReducerContext, animal: &CombatAgent, amount: f64) -> f64 {
    if animal.target_kind == TARGET_BUILDING {
        if let Some(mut building) = ctx.db.building().id().find(&animal.target_id) {
            let stolen = withdraw_building_edible_food(&mut building, amount);
            ctx.db.building().id().update(building);
            return stolen;
        }
    } else if animal.target_kind == TARGET_RESIDENCE {
        if let Some(mut residence) = ctx.db.residence().id().find(&animal.target_id) {
            let stolen = steal_residence_food(&mut residence, amount);
            ctx.db.residence().id().update(residence);
            return stolen;
        }
    }
    0.0
}

fn fox_contact_result(ctx: &ReducerContext, fox: &CombatAgent) -> (f64, bool) {
    if fox.target_kind == TARGET_BUILDING {
        if let Some(building) = ctx.db.building().id().find(&fox.target_id) {
            if building.kind == "pastoral_farmstead" || building.kind == "swineherd" {
                if let Some(mut herd) = ctx
                    .db
                    .pasture_herd()
                    .farmstead_id()
                    .filter(&building.id)
                    .filter(|herd| {
                        herd.present_head_count > 0
                            && herd.species != crate::reducers::livestock::SPECIES_CATTLE
                            && herd.species != crate::reducers::livestock::SPECIES_HORSE
                    })
                    .min_by_key(|herd| herd.pasture_id)
                {
                    herd.head_count = herd.head_count.saturating_sub(1);
                    herd.present_head_count = herd.present_head_count.saturating_sub(1);
                    herd.health = (herd.health - 0.06).max(0.0);
                    ctx.db.pasture_herd().pasture_id().update(herd);
                    return (0.0, true);
                }
            }
        }
    }
    if fox.target_kind == TARGET_RESIDENCE {
        let garden_exists = ctx
            .db
            .backyard_garden()
            .residence_id()
            .filter(&fox.target_id)
            .next()
            .is_some();
        if garden_exists {
            super::clear_backyard_garden_for_residence(ctx, fox.target_id);
            if let Some(mut residence) = ctx.db.residence().id().find(&fox.target_id) {
                residence.backyard_project_kind = 0;
                ctx.db.residence().id().update(residence);
            }
            return (0.0, true);
        }
    }
    (steal_food_at_target(ctx, fox, 4.0), false)
}

fn steal_residence_food(residence: &mut crate::tables::Residence, amount: f64) -> f64 {
    let order = [
        CommodityKind::Meat,
        CommodityKind::Fish,
        CommodityKind::Eggs,
        CommodityKind::Milk,
        CommodityKind::RyeBread,
        CommodityKind::MaslinBread,
        CommodityKind::CuredMeat,
        CommodityKind::SmokedFish,
        CommodityKind::Cheese,
        CommodityKind::OatGrain,
        CommodityKind::Apples,
        CommodityKind::Berries,
        CommodityKind::Mushrooms,
        CommodityKind::Honey,
    ];
    let mut remaining = amount.max(0.0);
    let mut stolen = 0.0;
    for kind in order {
        if remaining <= 1e-6 {
            break;
        }
        let units = withdraw_residence_commodity(residence, kind, remaining);
        stolen += units;
        remaining -= units;
    }
    stolen
}

fn fox_target(ctx: &ReducerContext, owner: Identity, seed: u64) -> Option<Target> {
    let food_target = || {
        ctx.db
            .building()
            .owner()
            .filter(&owner)
            .filter(|building| {
                building.construction_complete
                    && building.kind == "granary"
                    && building_edible_food_stock(building) > 0.0
            })
            .max_by(|left, right| {
                building_edible_food_stock(left).total_cmp(&building_edible_food_stock(right))
            })
            .map(target_building)
            .or_else(|| {
                ctx.db
                    .residence()
                    .owner()
                    .filter(&owner)
                    .filter(|residence| residence_edible_food_stock(residence) > 0.0)
                    .max_by(|left, right| {
                        residence_edible_food_stock(left)
                            .total_cmp(&residence_edible_food_stock(right))
                    })
                    .map(target_residence)
            })
    };
    let vulnerable_livestock = || {
        ctx.db
            .building()
            .owner()
            .filter(&owner)
            .filter(|building| {
                building.construction_complete
                    && (building.kind == "pastoral_farmstead" || building.kind == "swineherd")
            })
            .find(|building| {
                ctx.db
                    .pasture_herd()
                    .farmstead_id()
                    .filter(&building.id)
                    .any(|herd| {
                        herd.present_head_count > 0
                            && herd.species != crate::reducers::livestock::SPECIES_CATTLE
                            && herd.species != crate::reducers::livestock::SPECIES_HORSE
                    })
            })
            .map(target_building)
    };
    let backyard = || {
        ctx.db
            .residence()
            .owner()
            .filter(&owner)
            .find(|residence| {
                ctx.db
                    .backyard_garden()
                    .residence_id()
                    .filter(&residence.id)
                    .next()
                    .is_some()
            })
            .map(target_residence)
    };
    if seed % 4 == 0 {
        backyard()
            .or_else(vulnerable_livestock)
            .or_else(food_target)
    } else {
        food_target()
            .or_else(backyard)
            .or_else(vulnerable_livestock)
    }
}

fn wolf_target(ctx: &ReducerContext, owner: Identity, seed: u64) -> Option<Target> {
    let ox_target = || {
        ctx.db
            .stable_ox()
            .owner()
            .filter(&owner)
            .min_by_key(|ox| ox.id)
            .and_then(|ox| target_position(ctx, TARGET_STABLE_OX, ox.id))
    };
    let dog_target = || {
        ctx.db
            .combat_agent()
            .owner()
            .filter(&owner)
            .filter(|agent| agent.faction == DOG && agent.state != DOWNED && agent.health > 0.0)
            .min_by_key(|agent| agent.id)
            .map(|agent| Target {
                kind: TARGET_COMBAT_AGENT,
                id: agent.id,
                x: agent.x,
                z: agent.z,
            })
    };
    let livestock_target = || {
        ctx.db
            .building()
            .owner()
            .filter(&owner)
            .filter(|building| {
                building.construction_complete
                    && (building.kind == "pastoral_farmstead" || building.kind == "swineherd")
            })
            .find(|building| {
                ctx.db
                    .pasture_herd()
                    .farmstead_id()
                    .filter(&building.id)
                    .any(|herd| herd.present_head_count > 0)
            })
            .map(target_building)
    };
    let residence_target = || {
        ctx.db
            .residence()
            .owner()
            .filter(&owner)
            .filter(|residence| {
                residence.population > 0 || residence_edible_food_stock(residence) > 0.0
            })
            .max_by_key(|residence| {
                u64::from(
                    ctx.db
                        .backyard_garden()
                        .residence_id()
                        .filter(&residence.id)
                        .next()
                        .is_some(),
                ) * 10_000
                    + residence.id
            })
            .map(target_residence)
    };
    match seed % 4 {
        0 => ox_target()
            .or_else(dog_target)
            .or_else(livestock_target)
            .or_else(residence_target),
        1 => dog_target()
            .or_else(ox_target)
            .or_else(residence_target)
            .or_else(livestock_target),
        2 => livestock_target()
            .or_else(residence_target)
            .or_else(ox_target)
            .or_else(dog_target),
        _ => residence_target()
            .or_else(livestock_target)
            .or_else(ox_target)
            .or_else(dog_target),
    }
}

fn dog_patrol_target(
    ctx: &ReducerContext,
    dog: &CombatAgent,
    seed: u64,
    road_network: Option<&RoadNetwork>,
) -> Option<Target> {
    // All wounded dogs return to their kennel, regardless of posting.
    if dog.health + 1e-6 < dog.max_health {
        if let Some(kennel) = ctx.db.building().id().find(&dog.source_building_id) {
            if kennel.owner == dog.owner && kennel.construction_complete {
                return Some(target_building(kennel));
            }
        }
    }
    if dog.assigned_building_id > 0 {
        if let Some(hunters_hall) = ctx.db.building().id().find(&dog.assigned_building_id) {
            if hunters_hall.owner == dog.owner
                && hunters_hall.kind == "hunters_hall"
                && hunters_hall.construction_complete
            {
                return hunting_dog_woodland_target(ctx, dog, &hunters_hall, seed);
            }
        }
    }
    if let Some(target) = road_network.and_then(|network| next_road_patrol_target(dog, seed, network))
    {
        return Some(target);
    }
    let owner = dog.owner;
    let buildings = ctx
        .db
        .building()
        .owner()
        .filter(&owner)
        .filter(|building| building.construction_complete && building.kind != "salvage_pile")
        .collect::<Vec<_>>();
    let residences = ctx
        .db
        .residence()
        .owner()
        .filter(&owner)
        .collect::<Vec<_>>();
    let total = buildings.len() + residences.len();
    if total == 0 {
        return None;
    }
    let index = mix(seed, 0x5041_5452_4f4c) as usize % total;
    if index < buildings.len() {
        Some(target_building(buildings[index].clone()))
    } else {
        Some(target_residence(
            residences[index - buildings.len()].clone(),
        ))
    }
}

fn next_road_patrol_target(
    dog: &CombatAgent,
    seed: u64,
    network: &RoadNetwork,
) -> Option<Target> {
    let count = network.road_patrol_stop_count();
    if count == 0 {
        return None;
    }
    let (road_x, road_z) = network.nearest_point(dog.home_x, dog.home_z, f64::MAX)?;
    let start = road_patrol_target_ordinal(dog.target_kind, dog.target_id).map_or_else(
        || (mix(seed, 0x524f_4144_444f_47) as usize % (count / 2)) * 2,
        |ordinal| (ordinal as usize + 1) % count,
    );
    for offset in 0..count {
        let ordinal = (start + offset) % count;
        let Some((x, z)) = network.road_patrol_stop(ordinal as u64) else {
            continue;
        };
        // Join the roads nearest the kennel even if it is beyond the ordinary
        // building snap radius, then keep the circuit on that component.
        let reachable = network
            .road_path_route(road_x, road_z, x, z)
            .is_some();
        if reachable {
            return Some(Target {
                kind: TARGET_GROUND,
                id: road_patrol_target_id(ordinal as u64),
                x,
                z,
            });
        }
    }
    None
}

fn hunting_dog_woodland_target(
    ctx: &ReducerContext,
    dog: &CombatAgent,
    hunters_hall: &crate::tables::Building,
    seed: u64,
) -> Option<Target> {
    let maximum_range_sq = hunters_hall.work_radius.max(0.0).powi(2);
    if maximum_range_sq <= 1e-6 {
        return None;
    }

    let mut trees = ctx
        .db
        .tree_entity()
        .iter()
        .filter(|tree| tree.phase == "mature")
        .filter(|tree| {
            let range_sq = (tree.x - hunters_hall.x).powi(2) + (tree.z - hunters_hall.z).powi(2);
            range_sq <= maximum_range_sq
        })
        .collect::<Vec<_>>();
    if trees.is_empty()
        || (trees.len() == 1 && distance(dog.x, dog.z, trees[0].x, trees[0].z) < 4.0)
    {
        let (x, z) = open_ground_patrol_point(
            hunters_hall.x,
            hunters_hall.z,
            hunters_hall.work_radius,
            mix(seed, dog.target_id),
        );
        return Some(Target {
            kind: TARGET_GROUND,
            id: woodland_tree_target_id(x, z),
            x,
            z,
        });
    }

    // Prefer the actual woods beyond the camp clearing whenever they exist.
    // A close mature tree remains a useful fallback on sparse maps.
    let minimum_range_sq = HUNTING_DOG_MIN_WOODLAND_RANGE.powi(2);
    if trees.iter().any(|tree| {
        (tree.x - hunters_hall.x).powi(2) + (tree.z - hunters_hall.z).powi(2) >= minimum_range_sq
    }) {
        trees.retain(|tree| {
            (tree.x - hunters_hall.x).powi(2) + (tree.z - hunters_hall.z).powi(2)
                >= minimum_range_sq
        });
    }
    trees.sort_by(|left, right| {
        left.layout_index
            .cmp(&right.layout_index)
            .then_with(|| left.tree_id.cmp(&right.tree_id))
    });

    let index = if trees.len() == 1 {
        0
    } else if let Some(current_index) = trees
        .iter()
        .position(|tree| woodland_tree_target_id(tree.x, tree.z) == dog.target_id)
    {
        let stride = 1 + mix(seed, 0x4855_4e54_444f_47) as usize % (trees.len() - 1);
        (current_index + stride) % trees.len()
    } else {
        mix(seed, 0x574f_4f44_4c41_4e44) as usize % trees.len()
    };
    let tree = &trees[index];
    Some(Target {
        kind: TARGET_GROUND,
        id: woodland_tree_target_id(tree.x, tree.z),
        x: tree.x,
        z: tree.z,
    })
}

fn road_patrol_target_id(ordinal: u64) -> u64 {
    ROAD_PATROL_TARGET_TAG | (ordinal & ROAD_PATROL_ORDINAL_MASK)
}

fn road_patrol_target_ordinal(kind: u8, id: u64) -> Option<u64> {
    is_road_patrol_target(kind, id).then_some(id & ROAD_PATROL_ORDINAL_MASK)
}

fn nearest_hostile(ctx: &ReducerContext, dog: &CombatAgent, radius: f64) -> Option<CombatAgent> {
    ctx.db
        .combat_agent()
        .owner()
        .filter(&dog.owner)
        .filter(|agent| {
            matches!(agent.faction, 1 | 2 | FOX | WOLF)
                && agent.state != DOWNED
                && agent.health > 0.0
        })
        .filter_map(|agent| {
            let range = distance(dog.x, dog.z, agent.x, agent.z);
            (range <= radius).then_some((range, agent))
        })
        .min_by(|left, right| left.0.total_cmp(&right.0))
        .map(|(_, agent)| agent)
}

fn nearest_defender(
    ctx: &ReducerContext,
    animal: &CombatAgent,
    radius: f64,
) -> Option<CombatAgent> {
    ctx.db
        .combat_agent()
        .owner()
        .filter(&animal.owner)
        .filter(|agent| {
            (agent.faction == 0
                || agent.faction == DOG
                || (3..=11).contains(&agent.faction)
                || matches!(agent.faction, 15 | 16))
                && agent.state != DOWNED
                && agent.health > 0.0
        })
        .filter_map(|agent| {
            let range = distance(animal.x, animal.z, agent.x, agent.z);
            (range <= radius).then_some((range, agent))
        })
        .min_by(|left, right| left.0.total_cmp(&right.0))
        .map(|(_, agent)| agent)
}

fn target_position(ctx: &ReducerContext, kind: u8, id: u64) -> Option<Target> {
    match kind {
        TARGET_BUILDING => ctx.db.building().id().find(&id).map(target_building),
        TARGET_RESIDENCE => ctx.db.residence().id().find(&id).map(target_residence),
        TARGET_COMBAT_AGENT => ctx.db.combat_agent().id().find(&id).map(|agent| Target {
            kind,
            id,
            x: agent.x,
            z: agent.z,
        }),
        TARGET_STABLE_OX => {
            let ox = ctx.db.stable_ox().id().find(&id)?;
            let building_id = if ox.assigned_building_id > 0 {
                ox.assigned_building_id
            } else {
                ox.stable_id
            };
            let building = ctx.db.building().id().find(&building_id)?;
            Some(Target {
                kind,
                id,
                x: building.x,
                z: building.z,
            })
        }
        TARGET_GROUND if is_woodland_tree_target(kind, id) => {
            let (x, z) = woodland_tree_target_position(id);
            Some(Target { kind, id, x, z })
        }
        _ => None,
    }
}

fn dog_target_position(
    ctx: &ReducerContext,
    kind: u8,
    id: u64,
    road_network: Option<&RoadNetwork>,
) -> Option<Target> {
    if let Some(ordinal) = road_patrol_target_ordinal(kind, id) {
        return road_network
            .and_then(|network| network.road_patrol_stop(ordinal))
            .map(|(x, z)| Target { kind, id, x, z });
    }
    target_position(ctx, kind, id)
}

fn move_dog_over_roads(
    dog: &mut CombatAgent,
    target_x: f64,
    target_z: f64,
    speed: f64,
    dt: f64,
    road_network: Option<&RoadNetwork>,
) {
    let Some(network) = road_network else {
        move_toward(dog, target_x, target_z, speed, dt);
        return;
    };
    let route = if let Some(ordinal) = road_patrol_target_ordinal(dog.target_kind, dog.target_id) {
        network.road_patrol_route(ordinal, dog.x, dog.z)
    } else {
        network
            .road_path_route(dog.x, dog.z, target_x, target_z)
            .or_else(|| {
                network.road_path_route_from_external_access(dog.x, dog.z, target_x, target_z, 1.6)
            })
    };
    let Some(route) = route else {
        if is_road_patrol_target(dog.target_kind, dog.target_id) {
            dog.target_id = 0;
            return;
        }
        move_toward(dog, target_x, target_z, speed, dt);
        return;
    };
    let previous_x = dog.x;
    let previous_z = dog.z;
    let route_move = move_along_combat_route(
        dog.x,
        dog.z,
        0.0,
        route.distance,
        &route.polyline,
        speed,
        dt,
        true,
        Some(network),
    );
    dog.x = route_move.x;
    dog.z = route_move.z;
    dog.route_progress = route_move.progress;
    dog.velocity_x = (dog.x - previous_x) / dt.max(1e-9);
    dog.velocity_z = (dog.z - previous_z) / dt.max(1e-9);
}

fn target_building(building: crate::tables::Building) -> Target {
    Target {
        kind: TARGET_BUILDING,
        id: building.id,
        x: building.x,
        z: building.z,
    }
}

fn target_residence(residence: crate::tables::Residence) -> Target {
    Target {
        kind: TARGET_RESIDENCE,
        id: residence.id,
        x: residence.x,
        z: residence.z,
    }
}

fn woodland_entry(target: Target, seed: u64, map_size: u8, range: f64) -> (f64, f64, f64, f64) {
    let angle = (mix(seed, 0x454e5452) as f64 / u64::MAX as f64) * std::f64::consts::TAU;
    let (dx, dz) = (angle.cos(), angle.sin());
    let half = match map_size {
        0 => 408.5,
        2 => 1_155.412_48,
        _ => 817.0,
    } - 8.0;
    let x = (target.x + dx * range).clamp(-half, half);
    let z = (target.z + dz * range).clamp(-half, half);
    let home_x = (target.x + dx * (range + 34.0)).clamp(-half, half);
    let home_z = (target.z + dz * (range + 34.0)).clamp(-half, half);
    (x, z, home_x, home_z)
}

fn wolf_pack_offset(slot: u32) -> (f64, f64) {
    if slot == 0 {
        return (0.0, 0.0);
    }
    let row = (slot + 1) / 2;
    let side = if slot % 2 == 0 { -1.0 } else { 1.0 };
    (side * (1.15 + row as f64 * 0.48), row as f64 * 0.72)
}

fn move_toward(agent: &mut CombatAgent, goal_x: f64, goal_z: f64, speed: f64, dt: f64) {
    let dx = goal_x - agent.x;
    let dz = goal_z - agent.z;
    let range = dx.hypot(dz);
    if range <= 1e-6 {
        agent.velocity_x = 0.0;
        agent.velocity_z = 0.0;
        return;
    }
    let step = (speed * dt).min(range);
    let move_x = dx / range * step;
    let move_z = dz / range * step;
    agent.x += move_x;
    agent.z += move_z;
    agent.velocity_x = move_x / dt.max(1e-9);
    agent.velocity_z = move_z / dt.max(1e-9);
    agent.route_progress = range;
}

fn cleanup_downed_animals(ctx: &ReducerContext, dt: f64) {
    let animals = ctx
        .db
        .combat_agent()
        .iter()
        .filter(|agent| matches!(agent.faction, DOG | FOX | WOLF) && agent.state == DOWNED)
        .collect::<Vec<_>>();
    for mut animal in animals {
        animal.attack_cooldown = (animal.attack_cooldown - dt).max(0.0);
        if animal.attack_cooldown <= 0.0 {
            ctx.db.militia_order().combat_agent_id().delete(animal.id);
            ctx.db.combat_agent().id().delete(animal.id);
        } else {
            ctx.db.combat_agent().id().update(animal);
        }
    }
}

fn clear_hostile_wildlife(ctx: &ReducerContext) {
    let animals = ctx
        .db
        .combat_agent()
        .iter()
        .filter(|agent| matches!(agent.faction, FOX | WOLF))
        .collect::<Vec<_>>();
    for animal in animals {
        ctx.db.militia_order().combat_agent_id().delete(animal.id);
        ctx.db.combat_agent().id().delete(animal.id);
    }
}

fn distance(ax: f64, az: f64, bx: f64, bz: f64) -> f64 {
    (ax - bx).hypot(az - bz)
}

fn mix(mut value: u64, salt: u64) -> u64 {
    value ^= salt.wrapping_add(0x9e37_79b9_7f4a_7c15);
    value ^= value >> 30;
    value = value.wrapping_mul(0xbf58_476d_1ce4_e5b9);
    value ^= value >> 27;
    value = value.wrapping_mul(0x94d0_49bb_1331_11eb);
    value ^ (value >> 31)
}

fn identity_seed(identity: Identity) -> u64 {
    identity
        .to_string()
        .bytes()
        .fold(0xcbf2_9ce4_8422_2325, |hash, byte| {
            (hash ^ u64::from(byte)).wrapping_mul(0x1000_0000_01b3)
        })
}

#[cfg(test)]
mod tests {
    use super::{
        is_woodland_tree_target, mix, recurring_phase_crossed, wolf_pack_offset,
        woodland_tree_target_id, woodland_tree_target_position, TARGET_GROUND,
    };

    #[test]
    fn recurring_spawn_phase_survives_multi_tick_speed_steps() {
        assert!(recurring_phase_crossed(100, 106, 103, 900));
        assert!(recurring_phase_crossed(898, 904, 2, 900));
        assert!(!recurring_phase_crossed(100, 102, 103, 900));
        assert!(!recurring_phase_crossed(103, 103, 103, 900));
    }

    #[test]
    fn pack_offsets_are_stable_and_separated() {
        assert_eq!(wolf_pack_offset(0), (0.0, 0.0));
        assert_ne!(wolf_pack_offset(1), wolf_pack_offset(2));
        assert_eq!(mix(7, 11), mix(7, 11));
    }

    #[test]
    fn woodland_targets_round_trip_signed_world_coordinates() {
        let id = woodland_tree_target_id(-317.245, 842.716);
        assert!(is_woodland_tree_target(TARGET_GROUND, id));
        let (x, z) = woodland_tree_target_position(id);
        assert!((x + 317.25).abs() < 1e-9);
        assert!((z - 842.72).abs() < 1e-9);
    }
}
