use std::collections::HashSet;

use spacetimedb::{Identity, ReducerContext};

use crate::balance_generated::{CALENDAR_SECONDS_PER_DAY, TICK_DT};
use crate::db::*;
use crate::economy::{
    building_edible_food_stock, residence_edible_food_stock,
    withdraw_building_edible_food, withdraw_residence_commodity, CommodityKind,
};
use crate::tables::{CombatAgent, Corpse};

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
const CONTACT_DISTANCE: f64 = 2.15;

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
) {
    if !elapsed.is_finite() || elapsed <= 0.0 {
        return;
    }
    if !enabled {
        clear_hostile_wildlife(ctx);
    } else {
        spawn_due_incursions(ctx, sim_tick, spawn_through_tick, seed, map_size);
    }
    step_guard_dogs(ctx, sim_tick, elapsed);
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
        )
            && !ctx.db.combat_agent().owner().filter(&owner).any(|agent| agent.faction == FOX)
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
        )
            && !ctx.db.combat_agent().owner().filter(&owner).any(|agent| agent.faction == WOLF)
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
    insert_animal(ctx, owner, 0x4000_0000_0000_0000 | tick, FOX, 0, target, x, z, home_x, home_z, 34.0, tick);
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
    let count = if pack_roll % 5 == 0 { 1 } else { 4 + (pack_roll % 4) as u32 };
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
        target_kind: target.kind,
        target_id: target.id,
        x,
        z,
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

fn step_guard_dogs(ctx: &ReducerContext, tick: u64, dt: f64) {
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
        let threat = nearest_hostile(ctx, &dog, 52.0);
        if let Some(enemy) = threat {
            dog.target_kind = TARGET_COMBAT_AGENT;
            dog.target_id = enemy.id;
            let range = distance(dog.x, dog.z, enemy.x, enemy.z);
            if range > CONTACT_DISTANCE {
                dog.state = ADVANCING;
                move_toward(&mut dog, enemy.x, enemy.z, 3.15, dt);
            } else {
                dog.state = FIGHTING;
                dog_attack(ctx, &mut dog, enemy, tick);
            }
        } else {
            patrol_dog(ctx, &mut dog, tick, dt);
        }
        ctx.db.combat_agent().id().update(dog);
    }
}

fn dog_attack(ctx: &ReducerContext, dog: &mut CombatAgent, mut enemy: CombatAgent, tick: u64) {
    if dog.attack_cooldown > 0.0 {
        return;
    }
    enemy.health = (enemy.health - 13.0).max(0.0);
    dog.attack_cooldown = 1.05;
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
        if enemy.attack_cooldown <= 0.0 && enemy.faction == WOLF {
            dog.health = (dog.health - 9.0).max(0.0);
            enemy.attack_cooldown = 1.15;
            if dog.health <= 0.0 {
                down_guard_dog(dog, tick);
            }
        }
    }
    ctx.db.combat_agent().id().update(enemy);
}

fn patrol_dog(ctx: &ReducerContext, dog: &mut CombatAgent, tick: u64, dt: f64) {
    let target = target_position(ctx, dog.target_kind, dog.target_id);
    if target.is_none() || target.is_some_and(|target| distance(dog.x, dog.z, target.x, target.z) < 1.3) {
        if let Some(patrol) = dog_patrol_target(ctx, dog.owner, dog.id ^ tick / 90) {
            dog.target_kind = patrol.kind;
            dog.target_id = patrol.id;
            dog.state = RETURNING;
        } else {
            dog.target_kind = TARGET_GROUND;
            dog.target_id = 0;
            dog.state = HOLDING;
        }
    }
    if let Some(target) = target_position(ctx, dog.target_kind, dog.target_id) {
        move_toward(dog, target.x, target.z, 1.65, dt);
    }
    if dog.health < dog.max_health && distance(dog.x, dog.z, dog.home_x, dog.home_z) < 8.0 {
        dog.health = (dog.health + dog.max_health * 0.01 * dt).min(dog.max_health);
    }
}

fn step_foxes(ctx: &ReducerContext, tick: u64, dt: f64) {
    let foxes = ctx.db.combat_agent().iter().filter(|agent| agent.faction == FOX).collect::<Vec<_>>();
    for mut fox in foxes {
        if fox.state == DOWNED {
            continue;
        }
        if nearest_defender(ctx, &fox, 14.0).is_some() {
            fox.state = RETREATING;
        }
        if fox.state == RETREATING || fox.state == RETURNING {
            let (home_x, home_z) = (fox.home_x, fox.home_z);
            move_toward(&mut fox, home_x, home_z, 3.35, dt);
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
    let wolves = ctx.db.combat_agent().iter().filter(|agent| agent.faction == WOLF).collect::<Vec<_>>();
    for mut wolf in wolves {
        if wolf.state == DOWNED {
            continue;
        }
        wolf.attack_cooldown = (wolf.attack_cooldown - dt).max(0.0);
        if wolf.state == RETREATING || wolf.state == RETURNING {
            let (home_x, home_z) = (wolf.home_x, wolf.home_z);
            move_toward(&mut wolf, home_x, home_z, 3.0, dt);
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
                    .filter(|herd| herd.head_count > 0)
                    .min_by_key(|herd| herd.pasture_id)
                {
                    herd.head_count = herd.head_count.saturating_sub(1);
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
    let pack = ctx.db.combat_agent().raid_id().filter(&raid_id).collect::<Vec<_>>();
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
                    .filter(|herd| herd.head_count > 0 && herd.species != 0)
                    .min_by_key(|herd| herd.pasture_id)
                {
                    herd.head_count = herd.head_count.saturating_sub(1);
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
        CommodityKind::PreservedFood,
        CommodityKind::CuredMeat,
        CommodityKind::SmokedFish,
        CommodityKind::Cheese,
        CommodityKind::OatGrain,
        CommodityKind::Vegetables,
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
    let food_target = || ctx.db
        .building()
        .owner()
        .filter(&owner)
        .filter(|building| {
            building.construction_complete
                && building.kind == "granary"
                && building_edible_food_stock(building) > 0.0
        })
        .max_by(|left, right| building_edible_food_stock(left).total_cmp(&building_edible_food_stock(right)))
        .map(target_building)
        .or_else(|| {
            ctx.db
                .residence()
                .owner()
                .filter(&owner)
                .filter(|residence| residence_edible_food_stock(residence) > 0.0)
                .max_by(|left, right| residence_edible_food_stock(left).total_cmp(&residence_edible_food_stock(right)))
                .map(target_residence)
        });
    let vulnerable_livestock = || ctx
        .db
        .building()
        .owner()
        .filter(&owner)
        .filter(|building| building.construction_complete && (building.kind == "pastoral_farmstead" || building.kind == "swineherd"))
        .find(|building| {
            ctx.db
                .pasture_herd()
                .farmstead_id()
                .filter(&building.id)
                .any(|herd| herd.head_count > 0 && herd.species != 0)
        })
        .map(target_building);
    let backyard = || ctx
        .db
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
        .map(target_residence);
    if seed % 4 == 0 {
        backyard().or_else(vulnerable_livestock).or_else(food_target)
    } else {
        food_target().or_else(backyard).or_else(vulnerable_livestock)
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
            .map(|agent| Target { kind: TARGET_COMBAT_AGENT, id: agent.id, x: agent.x, z: agent.z })
    };
    let livestock_target = || {
        ctx.db
            .building()
            .owner()
            .filter(&owner)
            .filter(|building| building.construction_complete && (building.kind == "pastoral_farmstead" || building.kind == "swineherd"))
            .find(|building| ctx.db.pasture_herd().farmstead_id().filter(&building.id).any(|herd| herd.head_count > 0))
            .map(target_building)
    };
    let residence_target = || {
        ctx.db
            .residence()
            .owner()
            .filter(&owner)
            .filter(|residence| residence.population > 0 || residence_edible_food_stock(residence) > 0.0)
            .max_by_key(|residence| {
                u64::from(ctx.db.backyard_garden().residence_id().filter(&residence.id).next().is_some()) * 10_000 + residence.id
            })
            .map(target_residence)
    };
    match seed % 4 {
        0 => ox_target().or_else(dog_target).or_else(livestock_target).or_else(residence_target),
        1 => dog_target().or_else(ox_target).or_else(residence_target).or_else(livestock_target),
        2 => livestock_target().or_else(residence_target).or_else(ox_target).or_else(dog_target),
        _ => residence_target().or_else(livestock_target).or_else(ox_target).or_else(dog_target),
    }
}

fn dog_patrol_target(ctx: &ReducerContext, owner: Identity, seed: u64) -> Option<Target> {
    let buildings = ctx
        .db
        .building()
        .owner()
        .filter(&owner)
        .filter(|building| building.construction_complete && building.kind != "salvage_pile")
        .collect::<Vec<_>>();
    let residences = ctx.db.residence().owner().filter(&owner).collect::<Vec<_>>();
    let total = buildings.len() + residences.len();
    if total == 0 {
        return None;
    }
    let index = mix(seed, 0x5041_5452_4f4c) as usize % total;
    if index < buildings.len() {
        Some(target_building(buildings[index].clone()))
    } else {
        Some(target_residence(residences[index - buildings.len()].clone()))
    }
}

fn nearest_hostile(ctx: &ReducerContext, dog: &CombatAgent, radius: f64) -> Option<CombatAgent> {
    ctx.db
        .combat_agent()
        .owner()
        .filter(&dog.owner)
        .filter(|agent| matches!(agent.faction, 1 | 2 | FOX | WOLF) && agent.state != DOWNED && agent.health > 0.0)
        .filter_map(|agent| {
            let range = distance(dog.x, dog.z, agent.x, agent.z);
            (range <= radius).then_some((range, agent))
        })
        .min_by(|left, right| left.0.total_cmp(&right.0))
        .map(|(_, agent)| agent)
}

fn nearest_defender(ctx: &ReducerContext, animal: &CombatAgent, radius: f64) -> Option<CombatAgent> {
    ctx.db
        .combat_agent()
        .owner()
        .filter(&animal.owner)
        .filter(|agent| (agent.faction == 0 || agent.faction == DOG || (3..=11).contains(&agent.faction)) && agent.state != DOWNED && agent.health > 0.0)
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
        TARGET_COMBAT_AGENT => ctx.db.combat_agent().id().find(&id).map(|agent| Target { kind, id, x: agent.x, z: agent.z }),
        TARGET_STABLE_OX => {
            let ox = ctx.db.stable_ox().id().find(&id)?;
            let building_id = if ox.assigned_building_id > 0 { ox.assigned_building_id } else { ox.stable_id };
            let building = ctx.db.building().id().find(&building_id)?;
            Some(Target { kind, id, x: building.x, z: building.z })
        }
        _ => None,
    }
}

fn target_building(building: crate::tables::Building) -> Target {
    Target { kind: TARGET_BUILDING, id: building.id, x: building.x, z: building.z }
}

fn target_residence(residence: crate::tables::Residence) -> Target {
    Target { kind: TARGET_RESIDENCE, id: residence.id, x: residence.x, z: residence.z }
}

fn woodland_entry(target: Target, seed: u64, map_size: u8, range: f64) -> (f64, f64, f64, f64) {
    let angle = (mix(seed, 0x454e5452) as f64 / u64::MAX as f64) * std::f64::consts::TAU;
    let (dx, dz) = (angle.cos(), angle.sin());
    let half = match map_size { 0 => 408.5, 2 => 1_155.412_48, _ => 817.0 } - 8.0;
    let x = (target.x + dx * range).clamp(-half, half);
    let z = (target.z + dz * range).clamp(-half, half);
    let home_x = (target.x + dx * (range + 34.0)).clamp(-half, half);
    let home_z = (target.z + dz * (range + 34.0)).clamp(-half, half);
    (x, z, home_x, home_z)
}

fn wolf_pack_offset(slot: u32) -> (f64, f64) {
    if slot == 0 { return (0.0, 0.0); }
    let row = (slot + 1) / 2;
    let side = if slot % 2 == 0 { -1.0 } else { 1.0 };
    (side * (1.15 + row as f64 * 0.48), row as f64 * 0.72)
}

fn move_toward(agent: &mut CombatAgent, goal_x: f64, goal_z: f64, speed: f64, dt: f64) {
    let dx = goal_x - agent.x;
    let dz = goal_z - agent.z;
    let range = dx.hypot(dz);
    if range <= 1e-6 { return; }
    let step = (speed * dt).min(range);
    agent.x += dx / range * step;
    agent.z += dz / range * step;
    agent.route_progress = range;
}

fn cleanup_downed_animals(ctx: &ReducerContext, dt: f64) {
    let animals = ctx.db.combat_agent().iter().filter(|agent| matches!(agent.faction, DOG | FOX | WOLF) && agent.state == DOWNED).collect::<Vec<_>>();
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
    let animals = ctx.db.combat_agent().iter().filter(|agent| matches!(agent.faction, FOX | WOLF)).collect::<Vec<_>>();
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
    identity.to_string().bytes().fold(0xcbf2_9ce4_8422_2325, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x1000_0000_01b3)
    })
}

#[cfg(test)]
mod tests {
    use super::{mix, recurring_phase_crossed, wolf_pack_offset};

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
}
