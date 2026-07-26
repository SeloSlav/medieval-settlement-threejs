use spacetimedb::{Identity, ReducerContext};

use crate::balance_generated::{CALENDAR_SECONDS_PER_DAY, TICK_DT};
use crate::db::*;
use crate::frontier_economy_policy::armed_guards;
use crate::roads::{load_owner_road_network, RoadNetwork};
use crate::season_policy::EnvironmentState;
use crate::security_policy::{
    guardhouse_muster_efficiency, is_raid_season, raid_arson_occurs, raid_forecast,
    scheduled_raid_ticks, select_raid_targets, threat_progress, tower_effective_radius,
    RaidForecast, RaidTargetCandidate, RaidTargetKind, WatchArea, WatchCoverageIndex,
    MIN_FRONTIER_POPULATION, SECURITY_UPDATE_INTERVAL_TICKS,
};
use crate::tables::{settlement_security, Building, Residence, SettlementSecurity};

use super::fires::{ignite_raid_target, FIRE_TARGET_BUILDING, FIRE_TARGET_RESIDENCE};

struct SettlementExposure {
    protected_value: f64,
    total_value: f64,
    raid_targets: Vec<RaidTargetCandidate>,
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
        ready_guards: 0.0,
        defense_readiness: 0.0,
        next_raid_tick: 0,
        last_raid_tick: 0,
        last_outcome: 0,
        last_goods_lost: 0.0,
        last_wealth_lost: 0.0,
        guards_required: 0.0,
        targets_at_risk: 0,
        estimated_loss_fraction: 0.0,
    });
}

pub fn step_settlement_security(
    ctx: &ReducerContext,
    sim_tick: u64,
    month: u32,
    world_seed: u64,
    conflict_enabled: bool,
    enemy_pressure: u8,
    environment: EnvironmentState,
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
            environment,
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
    environment: EnvironmentState,
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
        state.ready_guards = 0.0;
        state.defense_readiness = 0.0;
        state.next_raid_tick = 0;
        state.last_raid_tick = 0;
        state.last_outcome = 0;
        state.last_goods_lost = 0.0;
        state.last_wealth_lost = 0.0;
        state.guards_required = 0.0;
        state.targets_at_risk = 0;
        state.estimated_loss_fraction = 0.0;
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
    let watch_index = WatchCoverageIndex::new(&towers);
    let exposure = settlement_exposure(&buildings, &residences, &watch_index);
    let coverage = if exposure.total_value > 1e-9 {
        (exposure.protected_value / exposure.total_value).clamp(0.0, 1.0)
    } else {
        0.0
    };

    state.coverage = coverage;
    state.protected_value = exposure.protected_value;
    state.total_value = exposure.total_value;
    state.staffed_watchtowers = towers.len() as u32;
    let road_network = load_owner_road_network(ctx, owner);
    let (ready_guards, assigned_guards) = settlement_guard_strength(
        &buildings,
        &towers,
        road_network.as_ref(),
        environment.road_speed_multiplier(),
    );
    state.ready_guards = ready_guards;
    state.defense_readiness = if assigned_guards > 0.0 {
        (ready_guards / assigned_guards).clamp(0.0, 1.0)
    } else {
        0.0
    };
    state.guards_required = 0.0;
    state.targets_at_risk = 0;
    state.estimated_loss_fraction = 0.0;

    if population < MIN_FRONTIER_POPULATION {
        state.threat = 0.0;
        state.next_raid_tick = 0;
        ctx.db.settlement_security().owner().update(state);
        return;
    }

    let raid_targets = exposure.raid_targets;
    let forecast = raid_forecast(enemy_pressure, coverage, ready_guards, raid_targets.len());
    state.guards_required = forecast.guards_required;
    state.targets_at_risk = forecast.target_count as u32;
    state.estimated_loss_fraction = forecast.loss_fraction;

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
        let (goods_lost, wealth_lost, arson_started) = resolve_raid(
            ctx,
            owner,
            &raid_targets,
            forecast,
            enemy_pressure,
            world_seed ^ sim_tick ^ population as u64,
            sim_tick,
        );
        state.last_raid_tick = sim_tick;
        state.last_goods_lost = goods_lost;
        state.last_wealth_lost = wealth_lost;
        state.last_outcome = if arson_started {
            3
        } else if goods_lost + wealth_lost <= 1e-9 {
            1
        } else {
            2
        };
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

fn staffed_watch_coverage(buildings: &[Building]) -> Vec<WatchArea> {
    buildings
        .iter()
        .filter(|building| building.kind == "watchtower" && building.assigned_labor > 0)
        .filter_map(|tower| {
            let radius = tower_effective_radius(tower.work_radius, tower.assigned_labor);
            (radius > 0.0).then_some(WatchArea {
                x: tower.x,
                z: tower.z,
                radius,
            })
        })
        .collect()
}

fn settlement_exposure(
    buildings: &[Building],
    residences: &[Residence],
    watch_index: &WatchCoverageIndex,
) -> SettlementExposure {
    let mut protected_value = 0.0;
    let mut total_value = 0.0;
    let mut raid_targets = Vec::with_capacity(buildings.len() + residences.len());
    for building in buildings
        .iter()
        .filter(|building| building.kind != "watchtower")
    {
        let portable_value = building_portable_value(building);
        let vulnerable_value = 1.0 + portable_value / 30.0;
        let protected = watch_index.contains(building.x, building.z);
        total_value += vulnerable_value;
        if protected {
            protected_value += vulnerable_value;
        }
        if portable_value > 1e-9 {
            raid_targets.push(RaidTargetCandidate {
                kind: RaidTargetKind::Building,
                id: building.id,
                protected,
                value: portable_value,
            });
        }
    }
    for residence in residences {
        let vulnerable_value = residence.population as f64 + residence.household_wealth / 20.0;
        let protected = watch_index.contains(residence.x, residence.z);
        total_value += vulnerable_value;
        if protected {
            protected_value += vulnerable_value;
        }
        if residence.household_wealth > 1e-9 {
            raid_targets.push(RaidTargetCandidate {
                kind: RaidTargetKind::Residence,
                id: residence.id,
                protected,
                value: residence.household_wealth,
            });
        }
    }
    SettlementExposure {
        protected_value,
        total_value,
        raid_targets,
    }
}

fn building_portable_value(building: &Building) -> f64 {
    building.timber
        + building.firewood
        + building.food
        + building.grain
        + building.flour
        + building.ale
        + building.preserved_food
        + building.honey
        + building.wine
        + building.wool
        + building.cloth * 1.5
        + building.ironwork * 2.0
        + building.polearms * 4.0
        + building.gold
}

fn settlement_guard_strength(
    buildings: &[Building],
    towers: &[WatchArea],
    road_network: Option<&RoadNetwork>,
    road_speed_multiplier: f64,
) -> (f64, f64) {
    let watch_positions = towers
        .iter()
        .map(|tower| (tower.x, tower.z))
        .collect::<Vec<_>>();
    buildings
        .iter()
        .filter(|building| building.kind == "guardhouse")
        .fold((0.0, 0.0), |(ready, assigned), guardhouse| {
            let assigned_here = guardhouse.assigned_labor as f64;
            let armed_here = armed_guards(guardhouse.assigned_labor, guardhouse.polearms);
            let muster_distance = road_network.and_then(|network| {
                network.nearest_road_path_distance(guardhouse.x, guardhouse.z, &watch_positions)
            });
            let muster_efficiency =
                guardhouse_muster_efficiency(muster_distance, road_speed_multiplier);
            (
                ready + armed_here * guardhouse.action_cooldown.clamp(0.0, 1.0) * muster_efficiency,
                assigned + assigned_here,
            )
        })
}

fn resolve_raid(
    ctx: &ReducerContext,
    owner: Identity,
    candidates: &[RaidTargetCandidate],
    forecast: RaidForecast,
    enemy_pressure: u8,
    entropy: u64,
    sim_tick: u64,
) -> (f64, f64, bool) {
    if forecast.target_count == 0 || forecast.loss_fraction <= 1e-9 {
        return (0.0, 0.0, false);
    }
    let mut goods_lost = 0.0;
    let mut wealth_lost = 0.0;
    let selected = select_raid_targets(candidates, forecast.target_count);

    for target in &selected {
        match target.kind {
            RaidTargetKind::Building => {
                let Some(mut updated) = ctx.db.building().id().find(&target.id) else {
                    continue;
                };
                macro_rules! plunder {
                    ($field:ident) => {{
                        let lost = updated.$field * forecast.loss_fraction;
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
                plunder!(ironwork);
                plunder!(polearms);
                let lost_gold = updated.gold * forecast.loss_fraction;
                updated.gold = (updated.gold - lost_gold).max(0.0);
                wealth_lost += lost_gold;
                ctx.db.building().id().update(updated);
            }
            RaidTargetKind::Residence => {
                let Some(residence) = ctx.db.residence().id().find(&target.id) else {
                    continue;
                };
                let lost = residence.household_wealth * forecast.loss_fraction;
                if lost <= 1e-9 {
                    continue;
                }
                wealth_lost += lost;
                ctx.db.residence().id().update(Residence {
                    household_wealth: (residence.household_wealth - lost).max(0.0),
                    ..residence
                });
            }
        }
    }

    let arson_started = raid_arson_occurs(enemy_pressure, forecast.defense_ratio, entropy)
        && selected.iter().any(|target| {
            let target_kind = match target.kind {
                RaidTargetKind::Building => FIRE_TARGET_BUILDING,
                RaidTargetKind::Residence => FIRE_TARGET_RESIDENCE,
            };
            ignite_raid_target(ctx, owner, target_kind, target.id, sim_tick)
        });

    (goods_lost, wealth_lost, arson_started)
}
