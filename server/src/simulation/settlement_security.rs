use std::collections::HashSet;

use spacetimedb::{Identity, ReducerContext};

use crate::balance_generated::{CALENDAR_SECONDS_PER_DAY, TICK_DT};
use crate::db::*;
use crate::frontier_economy_policy::armed_guards;
use crate::roads::{load_owner_road_network, RoadNetwork};
use crate::season_policy::EnvironmentState;
use crate::security_policy::{
    guardhouse_muster_efficiency, is_raid_season, raid_arson_occurs, raid_forecast,
    raid_holding_vulnerability, raidable_treasury_timber, scheduled_raid_ticks,
    select_raid_targets, threat_progress, tower_effective_radius, RaidForecast, RaidPortableStores,
    RaidTargetCandidate, RaidTargetKind, WatchArea, WatchCoverageIndex, MIN_FRONTIER_POPULATION,
    SECURITY_UPDATE_INTERVAL_TICKS,
};
use crate::tables::{
    settlement_security, Building, PlayerResources, Residence, SettlementSecurity,
};

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
    let fire_disabled_buildings = ctx
        .db
        .fire_incident()
        .owner()
        .filter(&owner)
        .filter(|incident| incident.target_kind == FIRE_TARGET_BUILDING)
        .map(|incident| incident.target_id)
        .collect::<HashSet<_>>();
    let treasury_stores = ctx
        .db
        .player_resources()
        .owner()
        .find(&owner)
        .map(|resources| treasury_portable_stores(&resources, &buildings))
        .unwrap_or_default();
    let towers = staffed_watch_coverage(&buildings, &fire_disabled_buildings);
    let watch_index = WatchCoverageIndex::new(&towers);
    let exposure = settlement_exposure(&buildings, &residences, treasury_stores, &watch_index);
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
        &fire_disabled_buildings,
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
            treasury_stores,
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

fn staffed_watch_coverage(
    buildings: &[Building],
    fire_disabled_buildings: &HashSet<u64>,
) -> Vec<WatchArea> {
    buildings
        .iter()
        .filter(|building| {
            building.construction_complete
                && building.kind == "watchtower"
                && building.assigned_labor > 0
                && !fire_disabled_buildings.contains(&building.id)
        })
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
    treasury_stores: RaidPortableStores,
    watch_index: &WatchCoverageIndex,
) -> SettlementExposure {
    let mut protected_value = 0.0;
    let mut total_value = 0.0;
    let mut raid_targets = Vec::with_capacity(buildings.len() + residences.len() + 1);
    for building in buildings
        .iter()
        .filter(|building| building.kind != "watchtower")
    {
        let portable_value = building_portable_value(building);
        let vulnerable_value =
            raid_holding_vulnerability(building.construction_complete, portable_value);
        if vulnerable_value <= 1e-9 {
            continue;
        }
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
    let treasury_value = treasury_stores.raid_value();
    if treasury_value > 1e-9 {
        if let Some((kind, id, x, z)) = treasury_anchor(buildings, residences) {
            let vulnerable_value = raid_holding_vulnerability(false, treasury_value);
            let protected = watch_index.contains(x, z);
            total_value += vulnerable_value;
            if protected {
                protected_value += vulnerable_value;
            }
            raid_targets.push(RaidTargetCandidate {
                kind,
                id,
                protected,
                value: treasury_value,
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
    building_portable_stores(building).raid_value()
}

fn building_portable_stores(building: &Building) -> RaidPortableStores {
    RaidPortableStores {
        timber: building.timber,
        firewood: building.firewood,
        food: building.food,
        grain: building.grain,
        flour: building.flour,
        ale: building.ale,
        preserved_food: building.preserved_food,
        honey: building.honey,
        wine: building.wine,
        wool: building.wool,
        cloth: building.cloth,
        ironwork: building.ironwork,
        polearms: building.polearms,
        gold: building.gold,
    }
}

fn treasury_portable_stores(
    treasury: &PlayerResources,
    buildings: &[Building],
) -> RaidPortableStores {
    let reserved_timber = buildings
        .iter()
        .map(|building| building.construction_treasury_timber.max(0.0))
        .sum::<f64>();
    RaidPortableStores {
        timber: raidable_treasury_timber(treasury.timber, reserved_timber),
        firewood: treasury.firewood,
        food: treasury.food,
        grain: treasury.grain,
        flour: treasury.flour,
        ale: treasury.ale,
        preserved_food: treasury.preserved_food,
        honey: treasury.honey,
        wine: treasury.wine,
        wool: treasury.wool,
        cloth: treasury.cloth,
        ironwork: treasury.ironwork,
        polearms: treasury.polearms,
        gold: treasury.gold,
    }
}

fn treasury_anchor(
    buildings: &[Building],
    residences: &[Residence],
) -> Option<(RaidTargetKind, u64, f64, f64)> {
    let town_hall = buildings
        .iter()
        .filter(|building| building.kind == "town_hall")
        .min_by_key(|building| building.id);
    let completed_holding = buildings
        .iter()
        .filter(|building| {
            building.construction_complete
                && building.kind != "watchtower"
                && building.kind != "guardhouse"
        })
        .min_by_key(|building| building.id);
    if let Some(building) = town_hall.or(completed_holding) {
        return Some((
            RaidTargetKind::TreasuryAtBuilding,
            building.id,
            building.x,
            building.z,
        ));
    }
    if let Some(residence) = residences.iter().min_by_key(|residence| residence.id) {
        return Some((
            RaidTargetKind::TreasuryAtResidence,
            residence.id,
            residence.x,
            residence.z,
        ));
    }
    buildings
        .iter()
        .filter(|building| building.kind != "watchtower" && building.kind != "guardhouse")
        .min_by_key(|building| building.id)
        .map(|building| {
            (
                RaidTargetKind::TreasuryAtBuilding,
                building.id,
                building.x,
                building.z,
            )
        })
}

fn retain_unplundered_stores(building: &mut Building, stores: RaidPortableStores) {
    building.timber = stores.timber;
    building.firewood = stores.firewood;
    building.food = stores.food;
    building.grain = stores.grain;
    building.flour = stores.flour;
    building.ale = stores.ale;
    building.preserved_food = stores.preserved_food;
    building.honey = stores.honey;
    building.wine = stores.wine;
    building.wool = stores.wool;
    building.cloth = stores.cloth;
    building.ironwork = stores.ironwork;
    building.polearms = stores.polearms;
    building.gold = stores.gold;
    building.civic_receipts_gold = building
        .civic_receipts_gold
        .max(0.0)
        .min(building.gold.max(0.0));
}

fn retain_unplundered_treasury_stores(
    treasury: &mut PlayerResources,
    before: RaidPortableStores,
    remaining: RaidPortableStores,
) {
    macro_rules! subtract_loss {
        ($field:ident) => {{
            let lost = portable_store_loss(before.$field, remaining.$field);
            treasury.$field = (treasury.$field - lost).max(0.0);
        }};
    }

    subtract_loss!(timber);
    subtract_loss!(firewood);
    subtract_loss!(food);
    subtract_loss!(grain);
    subtract_loss!(flour);
    subtract_loss!(ale);
    subtract_loss!(preserved_food);
    subtract_loss!(honey);
    subtract_loss!(wine);
    subtract_loss!(wool);
    subtract_loss!(cloth);
    subtract_loss!(ironwork);
    subtract_loss!(polearms);
    subtract_loss!(gold);
}

fn portable_store_loss(before: f64, remaining: f64) -> f64 {
    let stocked = if before.is_finite() {
        before.max(0.0)
    } else {
        0.0
    };
    let retained = if remaining.is_finite() {
        remaining.max(0.0)
    } else {
        0.0
    };
    (stocked - retained).max(0.0)
}

fn settlement_guard_strength(
    buildings: &[Building],
    towers: &[WatchArea],
    road_network: Option<&RoadNetwork>,
    road_speed_multiplier: f64,
    fire_disabled_buildings: &HashSet<u64>,
) -> (f64, f64) {
    let watch_positions = towers
        .iter()
        .map(|tower| (tower.x, tower.z))
        .collect::<Vec<_>>();
    buildings
        .iter()
        .filter(|building| {
            building.construction_complete
                && building.kind == "guardhouse"
                && !fire_disabled_buildings.contains(&building.id)
        })
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
    treasury_stores: RaidPortableStores,
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
                let plunder = building_portable_stores(&updated).plunder(forecast.loss_fraction);
                retain_unplundered_stores(&mut updated, plunder.remaining);
                goods_lost += plunder.goods_lost;
                wealth_lost += plunder.wealth_lost;
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
            RaidTargetKind::TreasuryAtBuilding | RaidTargetKind::TreasuryAtResidence => {
                let Some(mut treasury) = ctx.db.player_resources().owner().find(&owner) else {
                    continue;
                };
                let plunder = treasury_stores.plunder(forecast.loss_fraction);
                retain_unplundered_treasury_stores(
                    &mut treasury,
                    treasury_stores,
                    plunder.remaining,
                );
                goods_lost += plunder.goods_lost;
                wealth_lost += plunder.wealth_lost;
                ctx.db.player_resources().owner().update(treasury);
            }
        }
    }

    let arson_started = raid_arson_occurs(enemy_pressure, forecast.defense_ratio, entropy)
        && selected.iter().any(|target| {
            let target_kind = match target.kind {
                RaidTargetKind::Building | RaidTargetKind::TreasuryAtBuilding => {
                    FIRE_TARGET_BUILDING
                }
                RaidTargetKind::Residence | RaidTargetKind::TreasuryAtResidence => {
                    FIRE_TARGET_RESIDENCE
                }
            };
            ignite_raid_target(ctx, owner, target_kind, target.id, sim_tick)
        });

    (goods_lost, wealth_lost, arson_started)
}
