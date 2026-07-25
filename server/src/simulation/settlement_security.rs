use spacetimedb::{Identity, ReducerContext};

use crate::balance_generated::{CALENDAR_SECONDS_PER_DAY, TICK_DT};
use crate::db::*;
use crate::security_policy::{
    is_raid_season, raid_loss_fraction, scheduled_raid_ticks, threat_progress,
    tower_effective_radius, MIN_FRONTIER_POPULATION, SECURITY_UPDATE_INTERVAL_TICKS,
};
use crate::tables::{settlement_security, Building, Residence, SettlementSecurity};

#[derive(Clone, Copy)]
struct WatchCoverage {
    x: f64,
    z: f64,
    radius: f64,
}

pub fn ensure_settlement_security(ctx: &ReducerContext, owner: Identity) {
    if ctx.db.settlement_security().owner().find(&owner).is_some() {
        return;
    }
    ctx.db.settlement_security().insert(SettlementSecurity {
        owner,
        threat: 0.0,
        coverage: 0.0,
        protected_value: 0.0,
        total_value: 0.0,
        staffed_watchtowers: 0,
        next_raid_tick: 0,
        last_raid_tick: 0,
        last_outcome: 0,
        last_goods_lost: 0.0,
        last_wealth_lost: 0.0,
    });
}

pub fn step_settlement_security(
    ctx: &ReducerContext,
    sim_tick: u64,
    month: u32,
    world_seed: u64,
    conflict_enabled: bool,
    enemy_pressure: u8,
) {
    if sim_tick % SECURITY_UPDATE_INTERVAL_TICKS != 0 {
        return;
    }

    let owners = ctx
        .db
        .player_resources()
        .iter()
        .map(|resources| resources.owner)
        .collect::<Vec<_>>();

    for owner in owners {
        ensure_settlement_security(ctx, owner);
        step_owner_security(
            ctx,
            owner,
            sim_tick,
            month,
            world_seed,
            conflict_enabled,
            enemy_pressure,
        );
    }
}

fn step_owner_security(
    ctx: &ReducerContext,
    owner: Identity,
    sim_tick: u64,
    month: u32,
    world_seed: u64,
    conflict_enabled: bool,
    enemy_pressure: u8,
) {
    let Some(mut state) = ctx.db.settlement_security().owner().find(&owner) else {
        return;
    };
    if !conflict_enabled || enemy_pressure == 0 {
        state.threat = 0.0;
        state.coverage = 0.0;
        state.protected_value = 0.0;
        state.total_value = 0.0;
        state.staffed_watchtowers = 0;
        state.next_raid_tick = 0;
        state.last_raid_tick = 0;
        state.last_outcome = 0;
        state.last_goods_lost = 0.0;
        state.last_wealth_lost = 0.0;
        ctx.db.settlement_security().owner().update(state);
        return;
    }

    let buildings = ctx
        .db
        .building()
        .owner()
        .filter(&owner)
        .filter(|building| building.construction_complete)
        .collect::<Vec<Building>>();
    let residences = ctx
        .db
        .residence()
        .owner()
        .filter(&owner)
        .filter(|residence| !residence.abandoned && residence.population > 0)
        .collect::<Vec<Residence>>();
    let population = residences
        .iter()
        .map(|residence| residence.population)
        .sum::<u32>();
    let towers = staffed_watch_coverage(&buildings);
    let (protected_value, total_value) = settlement_coverage(&buildings, &residences, &towers);
    let coverage = if total_value > 1e-9 {
        (protected_value / total_value).clamp(0.0, 1.0)
    } else {
        0.0
    };

    state.coverage = coverage;
    state.protected_value = protected_value;
    state.total_value = total_value;
    state.staffed_watchtowers = towers.len() as u32;

    if population < MIN_FRONTIER_POPULATION {
        state.threat = 0.0;
        state.next_raid_tick = 0;
        ctx.db.settlement_security().owner().update(state);
        return;
    }

    let ticks_per_day = (CALENDAR_SECONDS_PER_DAY / TICK_DT).round() as u64;
    if state.next_raid_tick == 0 {
        state.last_raid_tick = sim_tick;
        state.next_raid_tick = sim_tick.saturating_add(scheduled_raid_ticks(
            enemy_pressure,
            ticks_per_day,
            world_seed ^ sim_tick ^ population as u64,
            true,
        ));
    }

    if sim_tick >= state.next_raid_tick && is_raid_season(month) {
        let (goods_lost, wealth_lost) =
            resolve_raid(ctx, &buildings, &residences, &towers, enemy_pressure, coverage);
        state.last_raid_tick = sim_tick;
        state.last_goods_lost = goods_lost;
        state.last_wealth_lost = wealth_lost;
        state.last_outcome = if goods_lost + wealth_lost <= 0.1 { 1 } else { 2 };
        state.next_raid_tick = sim_tick.saturating_add(scheduled_raid_ticks(
            enemy_pressure,
            ticks_per_day,
            world_seed ^ sim_tick ^ towers.len() as u64,
            false,
        ));
    }

    state.threat = threat_progress(state.last_raid_tick, state.next_raid_tick, sim_tick);
    ctx.db.settlement_security().owner().update(state);
}

fn staffed_watch_coverage(buildings: &[Building]) -> Vec<WatchCoverage> {
    buildings
        .iter()
        .filter(|building| building.kind == "watchtower" && building.assigned_labor > 0)
        .filter_map(|tower| {
            let radius = tower_effective_radius(tower.work_radius, tower.assigned_labor);
            (radius > 0.0).then_some(WatchCoverage {
                x: tower.x,
                z: tower.z,
                radius,
            })
        })
        .collect()
}

fn settlement_coverage(
    buildings: &[Building],
    residences: &[Residence],
    towers: &[WatchCoverage],
) -> (f64, f64) {
    let mut protected_value = 0.0;
    let mut total_value = 0.0;
    for building in buildings
        .iter()
        .filter(|building| building.kind != "watchtower")
    {
        let value = building_vulnerable_value(building);
        total_value += value;
        if position_is_watched(building.x, building.z, towers) {
            protected_value += value;
        }
    }
    for residence in residences {
        let value = residence.population as f64 + residence.household_wealth / 20.0;
        total_value += value;
        if position_is_watched(residence.x, residence.z, towers) {
            protected_value += value;
        }
    }
    (protected_value, total_value)
}

fn building_vulnerable_value(building: &Building) -> f64 {
    1.0 + (building.timber
        + building.firewood
        + building.food
        + building.grain
        + building.flour
        + building.ale
        + building.preserved_food
        + building.honey
        + building.wine
        + building.gold)
        / 30.0
}

fn position_is_watched(x: f64, z: f64, towers: &[WatchCoverage]) -> bool {
    towers.iter().any(|tower| {
        let dx = x - tower.x;
        let dz = z - tower.z;
        dx * dx + dz * dz <= tower.radius * tower.radius
    })
}

fn resolve_raid(
    ctx: &ReducerContext,
    buildings: &[Building],
    residences: &[Residence],
    towers: &[WatchCoverage],
    enemy_pressure: u8,
    coverage: f64,
) -> (f64, f64) {
    let loss_fraction = raid_loss_fraction(enemy_pressure, coverage);
    let mut goods_lost = 0.0;
    let mut wealth_lost = 0.0;

    for building in buildings {
        if building.kind == "watchtower" || position_is_watched(building.x, building.z, towers) {
            continue;
        }
        let mut updated = building.clone();
        macro_rules! plunder {
            ($field:ident) => {{
                let lost = updated.$field * loss_fraction;
                updated.$field = (updated.$field - lost).max(0.0);
                goods_lost += lost;
            }};
        }
        plunder!(timber);
        plunder!(firewood);
        plunder!(food);
        plunder!(grain);
        plunder!(flour);
        plunder!(ale);
        plunder!(preserved_food);
        plunder!(honey);
        plunder!(wine);
        let lost_gold = updated.gold * loss_fraction;
        updated.gold = (updated.gold - lost_gold).max(0.0);
        wealth_lost += lost_gold;
        ctx.db.building().id().update(updated);
    }

    for residence in residences {
        if position_is_watched(residence.x, residence.z, towers) {
            continue;
        }
        let lost = residence.household_wealth * loss_fraction;
        if lost <= 1e-9 {
            continue;
        }
        wealth_lost += lost;
        ctx.db.residence().id().update(Residence {
            household_wealth: (residence.household_wealth - lost).max(0.0),
            ..residence.clone()
        });
    }

    (goods_lost, wealth_lost)
}
