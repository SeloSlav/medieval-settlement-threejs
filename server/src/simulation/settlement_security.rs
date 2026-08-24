use std::collections::{HashMap, HashSet};

use spacetimedb::{Identity, ReducerContext};

use crate::balance_generated::{CALENDAR_SECONDS_PER_DAY, TICK_DT};
use crate::db::*;
use crate::economy::CommodityKind;
use crate::raid_agent_policy::{
    playable_half_for_map_size, raid_approach_from_entry, raid_entry_point,
    raid_entry_point_for_approach, raid_party_size, select_guard_muster_slots,
    COMBAT_FACTION_GUARD, COMBAT_STATE_HOLDING, COMBAT_TARGET_BUILDING, RAID_APPROACH_UNKNOWN,
};
use crate::resource_units::whole_units;
use crate::roads::{load_owner_road_network, RoadNetwork};
use crate::season_policy::EnvironmentState;
use crate::security_policy::{
    assign_refuge_households, guardhouse_muster_efficiency, is_raid_season,
    raid_contact_loss_fraction, raid_district_forecast, raid_holding_vulnerability,
    raid_immune_building_kind, raid_target_can_shelter, raid_target_count, raid_warning_detection,
    raidable_treasury_timber, scheduled_raid_ticks, select_guardhouse_muster_watch,
    select_raid_targets, threat_progress, tower_effective_radius, RaidPortableStores,
    RaidTargetCandidate, RaidTargetDefenseCandidate, RaidTargetKind, RefugeHouseholdCandidate,
    WatchArea, WatchCoverageIndex, MIN_FRONTIER_POPULATION, SECURITY_UPDATE_INTERVAL_TICKS,
};
use crate::tables::{
    settlement_security, Building, DeliveryTrip, PlayerResources, Residence, SettlementSecurity,
};

use super::fires::FIRE_TARGET_BUILDING;
use super::raid_agents::{
    ensure_warned_guard_muster, issued_guard_polearms_by_building, unavailable_guard_slots,
};
use super::{start_live_raid, LiveRaidTarget};

struct SettlementExposure {
    protected_value: f64,
    total_value: f64,
    raid_targets: Vec<RaidTargetDefenseCandidate>,
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
        raid_approach: RAID_APPROACH_UNKNOWN,
        raid_approach_offset: 0.0,
        warning_started_tick: 0,
        warning_source_tower_id: 0,
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
    map_size: u8,
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
            map_size,
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
    map_size: u8,
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
        clear_pending_raid_warning(&mut state);
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
    let delivery_trips = ctx
        .db
        .delivery_trip()
        .owner()
        .filter(&owner)
        .filter(|trip| trip.amount > 1e-9)
        .collect::<Vec<DeliveryTrip>>();
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
    let mut towers = staffed_watch_coverage(&buildings, &fire_disabled_buildings);
    let scheduled_raid_is_at_night = state.next_raid_tick > 0
        && !crate::simulation::game_clock(state.next_raid_tick).is_work_hours;
    if scheduled_raid_is_at_night {
        let night_watch_policy = ctx
            .db
            .player_resources()
            .owner()
            .find(&owner)
            .map(|resources| resources.night_watch_policy)
            .unwrap_or(crate::night_policy::WATCH_STANDARD);
        if night_watch_policy == crate::night_policy::WATCH_STAND_DOWN {
            towers.clear();
        } else {
            let radius_multiplier =
                crate::night_policy::warning_policy_multiplier(night_watch_policy);
            for tower in &mut towers {
                tower.radius *= radius_multiplier;
            }
        }
    }
    let watch_index = WatchCoverageIndex::new(&towers);
    let refuges = active_palisaded_refuge_coverage(&buildings, &fire_disabled_buildings);
    let refuge_index = WatchCoverageIndex::new(&refuges);
    let refuge_assignments =
        settlement_refuge_assignments(&residences, &watch_index, &refuge_index);
    let road_network = load_owner_road_network(ctx, owner);
    let unavailable_guard_slots = unavailable_guard_slots(ctx, owner);
    let issued_guard_polearms = issued_guard_polearms_by_building(ctx, owner);
    let staffed_watch_ids = towers
        .iter()
        .map(|tower| tower.source_id)
        .collect::<HashSet<_>>();
    let deployed_guard_readiness_by_watch = ctx
        .db
        .combat_agent()
        .owner()
        .filter(&owner)
        .filter(|agent| {
            agent.faction == COMBAT_FACTION_GUARD
                && agent.state == COMBAT_STATE_HOLDING
                && agent.target_kind == COMBAT_TARGET_BUILDING
                && staffed_watch_ids.contains(&agent.target_id)
        })
        .fold(HashMap::<u64, f64>::new(), |mut readiness, agent| {
            *readiness.entry(agent.target_id).or_insert(0.0) += agent.readiness.clamp(0.0, 1.0);
            readiness
        });
    let (district_ready_guards, assigned_guards, readiness_by_watch) = settlement_guard_districts(
        &buildings,
        &towers,
        road_network.as_ref(),
        environment.road_speed_multiplier(),
        &fire_disabled_buildings,
        &unavailable_guard_slots,
        &issued_guard_polearms,
        &deployed_guard_readiness_by_watch,
    );
    let exposure = settlement_exposure(
        &buildings,
        &residences,
        &delivery_trips,
        treasury_stores,
        &watch_index,
        &refuge_assignments,
        &readiness_by_watch,
        &issued_guard_polearms,
    );
    let coverage = if exposure.total_value > 1e-9 {
        (exposure.protected_value / exposure.total_value).clamp(0.0, 1.0)
    } else {
        0.0
    };

    state.coverage = coverage;
    state.protected_value = exposure.protected_value;
    state.total_value = exposure.total_value;
    state.staffed_watchtowers = towers.len() as u32;
    state.defense_readiness = if assigned_guards > 0.0 {
        (district_ready_guards / assigned_guards).clamp(0.0, 1.0)
    } else {
        0.0
    };
    state.ready_guards = district_ready_guards;
    state.guards_required = 0.0;
    state.targets_at_risk = 0;
    state.estimated_loss_fraction = 0.0;

    if population < MIN_FRONTIER_POPULATION {
        state.threat = 0.0;
        state.next_raid_tick = 0;
        clear_pending_raid_warning(&mut state);
        ctx.db.settlement_security().owner().update(state);
        return;
    }

    let raid_targets = exposure.raid_targets;
    let district_forecast = raid_district_forecast(enemy_pressure, &raid_targets);
    let forecast = district_forecast.forecast;
    state.ready_guards = district_forecast.frontline_ready_guards;
    state.guards_required = forecast.guards_required;
    state.targets_at_risk = forecast.target_count as u32;
    state.estimated_loss_fraction = forecast.loss_fraction;

    if ctx.db.active_raid().owner().find(&owner).is_some() {
        state.threat = 1.0;
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
        clear_pending_raid_warning(&mut state);
    }

    let playable_half = playable_half_for_map_size(map_size);
    if state.raid_approach == RAID_APPROACH_UNKNOWN {
        let planned_primary = select_raid_targets(
            &raid_targets
                .iter()
                .map(|candidate| candidate.target)
                .collect::<Vec<_>>(),
            1,
        )
        .into_iter()
        .next();
        if let Some(primary) = planned_primary {
            if let Some((target_x, target_z)) =
                raid_target_position(ctx, primary.kind.as_u8(), primary.id)
            {
                let (entry_x, entry_z) = raid_entry_point(
                    world_seed ^ state.next_raid_tick ^ primary.id,
                    target_x,
                    target_z,
                    playable_half,
                );
                (state.raid_approach, state.raid_approach_offset) =
                    raid_approach_from_entry(entry_x, entry_z);
            }
        }
    }

    if state.warning_started_tick == 0 {
        if let Some((entry_x, entry_z)) = raid_entry_point_for_approach(
            state.raid_approach,
            state.raid_approach_offset,
            playable_half,
        ) {
            if let Some(detection) = raid_warning_detection(
                state.next_raid_tick,
                ticks_per_day,
                raid_party_size(enemy_pressure),
                state.raid_approach,
                entry_x,
                entry_z,
                playable_half,
                world_seed ^ state.next_raid_tick,
                &towers,
            ) {
                if sim_tick >= detection.observation_tick {
                    state.warning_started_tick = sim_tick.max(1);
                    state.warning_source_tower_id = detection.tower_id;
                }
            }
        }
    }

    if state.warning_started_tick > 0 {
        ensure_warned_guard_muster(
            ctx,
            owner,
            state.next_raid_tick,
            sim_tick,
            &buildings,
            &towers,
            road_network.as_ref(),
            &fire_disabled_buildings,
        );
    }

    if sim_tick >= state.next_raid_tick && is_raid_season(month) {
        let selected = select_raid_targets(
            &raid_targets
                .iter()
                .map(|candidate| candidate.target)
                .collect::<Vec<_>>(),
            raid_target_count(enemy_pressure),
        );
        let live_targets = selected
            .into_iter()
            .filter_map(|target| {
                let anchored_refuge = (target.kind == RaidTargetKind::Residence)
                    .then(|| refuge_assignments.get(&target.id).copied())
                    .flatten()
                    .and_then(|refuge_id| {
                        buildings
                            .iter()
                            .find(|building| building.id == refuge_id)
                            .map(|building| (building.id, building.x, building.z))
                    });
                let (raid_anchor_building_id, x, z) =
                    if let Some((refuge_id, refuge_x, refuge_z)) = anchored_refuge {
                        (refuge_id, refuge_x, refuge_z)
                    } else {
                        let (target_x, target_z) =
                            raid_target_position(ctx, target.kind.as_u8(), target.id)?;
                        (0, target_x, target_z)
                    };
                Some(LiveRaidTarget {
                    kind: target.kind.as_u8(),
                    id: target.id,
                    raid_anchor_building_id,
                    x,
                    z,
                    // Warning and guards shape where and whether contact
                    // occurs. Once raiders complete contact, only the live
                    // surviving agents determine how much of this budget is
                    // carried out.
                    loot_fraction: raid_contact_loss_fraction(enemy_pressure),
                })
            })
            .collect::<Vec<_>>();
        if start_live_raid(
            ctx,
            owner,
            sim_tick,
            Some(state.next_raid_tick).filter(|_| state.warning_started_tick > 0),
            enemy_pressure,
            world_seed,
            playable_half,
            raid_entry_point_for_approach(
                state.raid_approach,
                state.raid_approach_offset,
                playable_half,
            ),
            &live_targets,
            &buildings,
            &towers,
            road_network.as_ref(),
            &fire_disabled_buildings,
        )
        .is_some()
        {
            state.threat = 1.0;
            ctx.db.settlement_security().owner().update(state);
            return;
        }

        // With no stocked physical target there is no agent to dispatch and,
        // consequently, no loss. Advance the campaign clock without inventing
        // an off-map encounter.
        state.last_raid_tick = sim_tick;
        state.last_goods_lost = 0.0;
        state.last_wealth_lost = 0.0;
        state.last_outcome = 1;
        state.next_raid_tick = sim_tick.saturating_add(scheduled_raid_ticks(
            enemy_pressure,
            ticks_per_day,
            world_seed ^ sim_tick ^ towers.len() as u64,
            false,
        ));
        clear_pending_raid_warning(&mut state);
    }

    state.threat = threat_progress(state.last_raid_tick, state.next_raid_tick, sim_tick);
    ctx.db.settlement_security().owner().update(state);
}

fn clear_pending_raid_warning(state: &mut SettlementSecurity) {
    state.raid_approach = RAID_APPROACH_UNKNOWN;
    state.raid_approach_offset = 0.0;
    state.warning_started_tick = 0;
    state.warning_source_tower_id = 0;
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
                source_id: tower.id,
                x: tower.x,
                z: tower.z,
                radius,
            })
        })
        .collect()
}

fn active_palisaded_refuge_coverage(
    buildings: &[Building],
    fire_disabled_buildings: &HashSet<u64>,
) -> Vec<WatchArea> {
    buildings
        .iter()
        .filter(|building| {
            building.construction_complete
                && building.kind == "palisaded_refuge"
                && building.work_radius > 0.0
                && !fire_disabled_buildings.contains(&building.id)
        })
        .map(|refuge| WatchArea {
            source_id: refuge.id,
            x: refuge.x,
            z: refuge.z,
            radius: refuge.work_radius,
        })
        .collect()
}

fn settlement_refuge_assignments(
    residences: &[Residence],
    watch_index: &WatchCoverageIndex,
    refuge_index: &WatchCoverageIndex,
) -> HashMap<u64, u64> {
    let mut candidates = Vec::new();
    for residence in residences.iter().filter(|residence| {
        !residence.abandoned
            && residence.population > 0
            && watch_index.contains(residence.x, residence.z)
    }) {
        for refuge in refuge_index.covering_areas(residence.x, residence.z) {
            let dx = residence.x - refuge.x;
            let dz = residence.z - refuge.z;
            candidates.push(RefugeHouseholdCandidate {
                residence_id: residence.id,
                refuge_id: refuge.source_id,
                residents: residence.population,
                distance_squared: dx * dx + dz * dz,
            });
        }
    }
    assign_refuge_households(candidates)
}

fn settlement_exposure(
    buildings: &[Building],
    residences: &[Residence],
    delivery_trips: &[DeliveryTrip],
    treasury_stores: RaidPortableStores,
    watch_index: &WatchCoverageIndex,
    refuge_assignments: &HashMap<u64, u64>,
    readiness_by_watch: &HashMap<u64, f64>,
    issued_guard_polearms: &HashMap<u64, f64>,
) -> SettlementExposure {
    let mut protected_value = 0.0;
    let mut total_value = 0.0;
    let refuge_positions = buildings
        .iter()
        .filter(|building| building.kind == "palisaded_refuge")
        .map(|building| (building.id, (building.x, building.z)))
        .collect::<HashMap<_, _>>();
    let raid_immune_building_ids = buildings
        .iter()
        .filter(|building| raid_immune_building_kind(&building.kind))
        .map(|building| building.id)
        .collect::<HashSet<_>>();
    let mut raid_targets =
        Vec::with_capacity(buildings.len() + residences.len() + delivery_trips.len() + 1);
    for building in buildings.iter().filter(|building| {
        building.kind != "watchtower" && !raid_immune_building_kind(&building.kind)
    }) {
        let portable_value = building_portable_value(
            building,
            issued_guard_polearms
                .get(&building.id)
                .copied()
                .unwrap_or(0.0),
        );
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
            raid_targets.push(RaidTargetDefenseCandidate {
                target: RaidTargetCandidate {
                    kind: RaidTargetKind::Building,
                    id: building.id,
                    protected,
                    sheltered: raid_target_can_shelter(RaidTargetKind::Building, protected, false),
                    value: portable_value,
                },
                local_ready_guards: watch_index.defended_readiness(
                    building.x,
                    building.z,
                    readiness_by_watch,
                ),
            });
        }
    }
    for residence in residences {
        let vulnerable_value = residence.population as f64 + residence.household_wealth / 20.0;
        let refuge_position = refuge_assignments
            .get(&residence.id)
            .and_then(|refuge_id| refuge_positions.get(refuge_id))
            .copied();
        let (raid_x, raid_z) = refuge_position.unwrap_or((residence.x, residence.z));
        let protected = watch_index.contains(raid_x, raid_z);
        let sheltered = refuge_position.is_some();
        total_value += vulnerable_value;
        if protected {
            protected_value += vulnerable_value;
        }
        if residence.household_wealth > 1e-9 {
            raid_targets.push(RaidTargetDefenseCandidate {
                target: RaidTargetCandidate {
                    kind: RaidTargetKind::Residence,
                    id: residence.id,
                    protected,
                    sheltered,
                    value: residence.household_wealth,
                },
                local_ready_guards: watch_index.defended_readiness(
                    raid_x,
                    raid_z,
                    readiness_by_watch,
                ),
            });
        }
    }
    // Once stock leaves a holding it remains physically exposed on the road.
    // Moving cargo therefore cannot be used as a raid-proof inventory slot,
    // while staffed watches still protect compact logistics corridors.
    for trip in delivery_trips {
        if raid_immune_building_ids.contains(&trip.building_id) {
            continue;
        }
        let portable_value = delivery_trip_portable_stores(trip).raid_value();
        if portable_value <= 1e-9 {
            continue;
        }
        let vulnerable_value = raid_holding_vulnerability(false, portable_value);
        let protected = watch_index.contains(trip.x, trip.z);
        total_value += vulnerable_value;
        if protected {
            protected_value += vulnerable_value;
        }
        raid_targets.push(RaidTargetDefenseCandidate {
            target: RaidTargetCandidate {
                kind: RaidTargetKind::DeliveryTrip,
                id: trip.id,
                protected,
                sheltered: raid_target_can_shelter(RaidTargetKind::DeliveryTrip, protected, false),
                value: portable_value,
            },
            local_ready_guards: watch_index.defended_readiness(trip.x, trip.z, readiness_by_watch),
        });
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
            raid_targets.push(RaidTargetDefenseCandidate {
                target: RaidTargetCandidate {
                    kind,
                    id,
                    protected,
                    sheltered: raid_target_can_shelter(kind, protected, false),
                    value: treasury_value,
                },
                local_ready_guards: watch_index.defended_readiness(x, z, readiness_by_watch),
            });
        }
    }
    SettlementExposure {
        protected_value,
        total_value,
        raid_targets,
    }
}

fn building_portable_value(building: &Building, issued_polearms: f64) -> f64 {
    if raid_immune_building_kind(&building.kind) {
        return 0.0;
    }
    building_portable_stores_at_site(building, issued_polearms).raid_value()
}

pub(super) fn building_portable_stores(building: &Building) -> RaidPortableStores {
    if raid_immune_building_kind(&building.kind) {
        return RaidPortableStores::default();
    }
    RaidPortableStores {
        timber: building.timber,
        firewood: building.firewood,
        food: building.food,
        rye_sheaves: building.rye_sheaves,
        oat_sheaves: building.oat_sheaves,
        barley_sheaves: building.barley_sheaves,
        maslin_sheaves: building.maslin_sheaves,
        rye_grain: building.rye_grain,
        oat_grain: building.oat_grain,
        maslin_grain: building.maslin_grain,
        rye_flour: building.rye_flour,
        maslin_flour: building.maslin_flour,
        rye_bread: building.rye_bread,
        maslin_bread: building.maslin_bread,
        ale: building.ale,
        cider: building.cider,
        pear_cider: building.pear_cider,
        mead: building.mead,
        preserved_food: building.preserved_food,
        honey: building.honey,
        wine: building.wine,
        wool: building.wool,
        cloth: building.cloth,
        hides: building.hides,
        leather: building.leather,
        shoes: building.shoes,
        ironwork: building.ironwork,
        polearms: building.polearms,
        gold: building.gold,
        barley: building.barley,
        malt: building.malt,
        flax: building.flax,
        iron: building.iron,
        clay: building.clay,
        salt: building.salt,
        charcoal: building.charcoal,
        pottery: building.pottery,
        roof_tiles: building.roof_tiles,
        remedies: building.remedies,
        meat: building.meat,
        fish: building.fish,
        berries: building.berries,
        mushrooms: building.mushrooms,
        milk: building.milk,
        apples: building.apples,
        cherries: building.cherries,
        vegetables: building.vegetables,
        eggs: building.eggs,
        grapes: building.grapes,
        cured_meat: building.cured_meat,
        smoked_fish: building.smoked_fish,
        cheese: building.cheese,
        pears: building.pears,
        aronia: building.aronia,
        rosehips: building.rosehips,
        cabbage: building.cabbage,
        carrots: building.carrots,
        beetroot: building.beetroot,
        aronia_jam: building.aronia_jam,
        rosehip_jam: building.rosehip_jam,
    }
    .normalized_whole()
}

pub(super) fn building_portable_stores_at_site(
    building: &Building,
    issued_polearms: f64,
) -> RaidPortableStores {
    let mut stores = building_portable_stores(building);
    let issued = if issued_polearms.is_finite() {
        whole_units(issued_polearms).min(whole_units(stores.polearms))
    } else {
        0.0
    };
    stores.polearms = (stores.polearms - issued).max(0.0);
    stores.normalized_whole()
}

#[derive(Clone, Copy, Debug, Default)]
pub(super) struct ContactRaidPlunder {
    pub carried: RaidPortableStores,
    pub goods_lost: f64,
    pub wealth_lost: f64,
}

/// Removes stock only after a replicated raider has reached this exact holding
/// and completed its local looting timer. The returned commodity bundle stays
/// on that agent until it escapes or drops a recoverable pile when downed.
pub(super) fn plunder_raid_target_at_contact(
    ctx: &ReducerContext,
    owner: Identity,
    target_kind: u8,
    target_id: u64,
    loss_fraction: f64,
) -> ContactRaidPlunder {
    let Some(kind) = RaidTargetKind::from_u8(target_kind) else {
        return ContactRaidPlunder::default();
    };
    match kind {
        RaidTargetKind::Building => {
            let Some(mut building) = ctx.db.building().id().find(&target_id) else {
                return ContactRaidPlunder::default();
            };
            if building.owner != owner || raid_immune_building_kind(&building.kind) {
                return ContactRaidPlunder::default();
            }
            let issued = issued_guard_polearms_by_building(ctx, owner)
                .get(&building.id)
                .copied()
                .unwrap_or(0.0)
                .min(whole_units(building.polearms));
            let before = building_portable_stores_at_site(&building, issued);
            let plunder = before.plunder(loss_fraction);
            let mut company_remaining = plunder.remaining;
            company_remaining.polearms += issued;
            retain_unplundered_stores(&mut building, company_remaining);
            ctx.db.building().id().update(building);
            ContactRaidPlunder {
                carried: before.removed_between(plunder.remaining),
                goods_lost: plunder.goods_lost,
                wealth_lost: plunder.wealth_lost,
            }
        }
        RaidTargetKind::Residence => {
            let Some(residence) = ctx.db.residence().id().find(&target_id) else {
                return ContactRaidPlunder::default();
            };
            if residence.owner != owner {
                return ContactRaidPlunder::default();
            }
            let fraction = if loss_fraction.is_finite() {
                loss_fraction.clamp(0.0, 1.0)
            } else {
                0.0
            };
            let wealth = whole_units(residence.household_wealth);
            let lost = whole_units(wealth * fraction).min(wealth);
            if lost <= 1e-9 {
                return ContactRaidPlunder::default();
            }
            ctx.db.residence().id().update(Residence {
                household_wealth: wealth - lost,
                ..residence
            });
            ContactRaidPlunder {
                carried: RaidPortableStores {
                    gold: lost,
                    ..RaidPortableStores::default()
                },
                goods_lost: 0.0,
                wealth_lost: lost,
            }
        }
        RaidTargetKind::DeliveryTrip => {
            let Some(mut trip) = ctx.db.delivery_trip().id().find(&target_id) else {
                return ContactRaidPlunder::default();
            };
            if trip.owner != owner {
                return ContactRaidPlunder::default();
            }
            if ctx
                .db
                .building()
                .id()
                .find(&trip.building_id)
                .is_some_and(|building| raid_immune_building_kind(&building.kind))
            {
                return ContactRaidPlunder::default();
            }
            let before = delivery_trip_portable_stores(&trip);
            let plunder = before.plunder(loss_fraction);
            trip.amount = delivery_trip_remaining_amount(trip.cargo_kind, plunder.remaining);
            ctx.db.delivery_trip().id().update(trip);
            ContactRaidPlunder {
                carried: before.removed_between(plunder.remaining),
                goods_lost: plunder.goods_lost,
                wealth_lost: plunder.wealth_lost,
            }
        }
        RaidTargetKind::TreasuryAtBuilding | RaidTargetKind::TreasuryAtResidence => {
            let valid_anchor = match kind {
                RaidTargetKind::TreasuryAtBuilding => ctx
                    .db
                    .building()
                    .id()
                    .find(&target_id)
                    .is_some_and(|building| {
                        building.owner == owner && !raid_immune_building_kind(&building.kind)
                    }),
                RaidTargetKind::TreasuryAtResidence => ctx
                    .db
                    .residence()
                    .id()
                    .find(&target_id)
                    .is_some_and(|residence| residence.owner == owner),
                _ => false,
            };
            if !valid_anchor {
                return ContactRaidPlunder::default();
            }
            let Some(mut treasury) = ctx.db.player_resources().owner().find(&owner) else {
                return ContactRaidPlunder::default();
            };
            let buildings = ctx.db.building().owner().filter(&owner).collect::<Vec<_>>();
            let before = treasury_portable_stores(&treasury, &buildings);
            let plunder = before.plunder(loss_fraction);
            retain_unplundered_treasury_stores(&mut treasury, before, plunder.remaining);
            ctx.db.player_resources().owner().update(treasury);
            ContactRaidPlunder {
                carried: before.removed_between(plunder.remaining),
                goods_lost: plunder.goods_lost,
                wealth_lost: plunder.wealth_lost,
            }
        }
    }
}

pub(super) fn raid_target_position(
    ctx: &ReducerContext,
    target_kind: u8,
    target_id: u64,
) -> Option<(f64, f64)> {
    match RaidTargetKind::from_u8(target_kind)? {
        RaidTargetKind::Building | RaidTargetKind::TreasuryAtBuilding => ctx
            .db
            .building()
            .id()
            .find(&target_id)
            .map(|building| (building.x, building.z)),
        RaidTargetKind::Residence | RaidTargetKind::TreasuryAtResidence => ctx
            .db
            .residence()
            .id()
            .find(&target_id)
            .map(|residence| (residence.x, residence.z)),
        RaidTargetKind::DeliveryTrip => ctx
            .db
            .delivery_trip()
            .id()
            .find(&target_id)
            .map(|trip| (trip.x, trip.z)),
    }
}

pub(super) fn delivery_trip_portable_stores(trip: &DeliveryTrip) -> RaidPortableStores {
    let amount = whole_units(trip.amount);
    let mut stores = RaidPortableStores::default();
    match CommodityKind::from_u8(trip.cargo_kind) {
        Some(CommodityKind::Timber) => stores.timber = amount,
        Some(CommodityKind::Firewood) => stores.firewood = amount,
        Some(CommodityKind::Food) => stores.food = amount,
        Some(CommodityKind::RyeBread) => stores.rye_bread = amount,
        Some(CommodityKind::MaslinBread) => stores.maslin_bread = amount,
        Some(CommodityKind::Meat) => stores.meat = amount,
        Some(CommodityKind::Fish) => stores.fish = amount,
        Some(CommodityKind::Berries) => stores.berries = amount,
        Some(CommodityKind::Mushrooms) => stores.mushrooms = amount,
        Some(CommodityKind::Milk) => stores.milk = amount,
        Some(CommodityKind::Apples) => stores.apples = amount,
        Some(CommodityKind::Cherries) => stores.cherries = amount,
        Some(CommodityKind::Vegetables) => stores.vegetables = amount,
        Some(CommodityKind::Eggs) => stores.eggs = amount,
        Some(CommodityKind::Grapes) => stores.grapes = amount,
        Some(CommodityKind::RyeSheaves) => stores.rye_sheaves = amount,
        Some(CommodityKind::OatSheaves) => stores.oat_sheaves = amount,
        Some(CommodityKind::BarleySheaves) => stores.barley_sheaves = amount,
        Some(CommodityKind::MaslinSheaves) => stores.maslin_sheaves = amount,
        Some(CommodityKind::RyeGrain) => stores.rye_grain = amount,
        Some(CommodityKind::OatGrain) => stores.oat_grain = amount,
        Some(CommodityKind::MaslinGrain) => stores.maslin_grain = amount,
        Some(CommodityKind::RyeFlour) => stores.rye_flour = amount,
        Some(CommodityKind::MaslinFlour) => stores.maslin_flour = amount,
        Some(CommodityKind::Ale) => stores.ale = amount,
        Some(CommodityKind::Cider) => stores.cider = amount,
        Some(CommodityKind::PearCider) => stores.pear_cider = amount,
        Some(CommodityKind::Mead) => stores.mead = amount,
        Some(CommodityKind::PreservedFood) => stores.preserved_food = amount,
        Some(CommodityKind::CuredMeat) => stores.cured_meat = amount,
        Some(CommodityKind::SmokedFish) => stores.smoked_fish = amount,
        Some(CommodityKind::Cheese) => stores.cheese = amount,
        Some(CommodityKind::Pears) => stores.pears = amount,
        Some(CommodityKind::Aronia) => stores.aronia = amount,
        Some(CommodityKind::Rosehips) => stores.rosehips = amount,
        Some(CommodityKind::Cabbage) => stores.cabbage = amount,
        Some(CommodityKind::Carrots) => stores.carrots = amount,
        Some(CommodityKind::Beetroot) => stores.beetroot = amount,
        Some(CommodityKind::AroniaJam) => stores.aronia_jam = amount,
        Some(CommodityKind::RosehipJam) => stores.rosehip_jam = amount,
        Some(CommodityKind::Honey) => stores.honey = amount,
        Some(CommodityKind::Wine) => stores.wine = amount,
        Some(CommodityKind::Wool) => stores.wool = amount,
        Some(CommodityKind::Cloth) => stores.cloth = amount,
        Some(CommodityKind::Hides) => stores.hides = amount,
        Some(CommodityKind::Leather) => stores.leather = amount,
        Some(CommodityKind::Shoes) => stores.shoes = amount,
        Some(CommodityKind::Ironwork) => stores.ironwork = amount,
        Some(CommodityKind::Polearms) => stores.polearms = amount,
        Some(CommodityKind::Gold) => stores.gold = amount,
        Some(CommodityKind::Barley) => stores.barley = amount,
        Some(CommodityKind::Malt) => stores.malt = amount,
        Some(CommodityKind::Flax) => stores.flax = amount,
        Some(CommodityKind::Iron) => stores.iron = amount,
        Some(CommodityKind::Clay) => stores.clay = amount,
        Some(CommodityKind::Salt) => stores.salt = amount,
        Some(CommodityKind::Charcoal) => stores.charcoal = amount,
        Some(CommodityKind::Pottery) => stores.pottery = amount,
        Some(CommodityKind::RoofTiles) => stores.roof_tiles = amount,
        Some(CommodityKind::Remedies) => stores.remedies = amount,
        // Raiders do not select bulk stone or water as plunder even when a
        // settlement cart happens to be carrying it.
        Some(CommodityKind::Stone | CommodityKind::Water | CommodityKind::Manure) | None => {}
    }
    stores.normalized_whole()
}

fn delivery_trip_remaining_amount(cargo_kind: u8, stores: RaidPortableStores) -> f64 {
    match CommodityKind::from_u8(cargo_kind) {
        Some(CommodityKind::Timber) => stores.timber,
        Some(CommodityKind::Firewood) => stores.firewood,
        Some(CommodityKind::Food) => stores.food,
        Some(CommodityKind::RyeBread) => stores.rye_bread,
        Some(CommodityKind::MaslinBread) => stores.maslin_bread,
        Some(CommodityKind::Meat) => stores.meat,
        Some(CommodityKind::Fish) => stores.fish,
        Some(CommodityKind::Berries) => stores.berries,
        Some(CommodityKind::Mushrooms) => stores.mushrooms,
        Some(CommodityKind::Milk) => stores.milk,
        Some(CommodityKind::Apples) => stores.apples,
        Some(CommodityKind::Cherries) => stores.cherries,
        Some(CommodityKind::Vegetables) => stores.vegetables,
        Some(CommodityKind::Eggs) => stores.eggs,
        Some(CommodityKind::Grapes) => stores.grapes,
        Some(CommodityKind::RyeSheaves) => stores.rye_sheaves,
        Some(CommodityKind::OatSheaves) => stores.oat_sheaves,
        Some(CommodityKind::BarleySheaves) => stores.barley_sheaves,
        Some(CommodityKind::MaslinSheaves) => stores.maslin_sheaves,
        Some(CommodityKind::RyeGrain) => stores.rye_grain,
        Some(CommodityKind::OatGrain) => stores.oat_grain,
        Some(CommodityKind::MaslinGrain) => stores.maslin_grain,
        Some(CommodityKind::RyeFlour) => stores.rye_flour,
        Some(CommodityKind::MaslinFlour) => stores.maslin_flour,
        Some(CommodityKind::Ale) => stores.ale,
        Some(CommodityKind::Cider) => stores.cider,
        Some(CommodityKind::PearCider) => stores.pear_cider,
        Some(CommodityKind::Mead) => stores.mead,
        Some(CommodityKind::PreservedFood) => stores.preserved_food,
        Some(CommodityKind::CuredMeat) => stores.cured_meat,
        Some(CommodityKind::SmokedFish) => stores.smoked_fish,
        Some(CommodityKind::Cheese) => stores.cheese,
        Some(CommodityKind::Pears) => stores.pears,
        Some(CommodityKind::Aronia) => stores.aronia,
        Some(CommodityKind::Rosehips) => stores.rosehips,
        Some(CommodityKind::Cabbage) => stores.cabbage,
        Some(CommodityKind::Carrots) => stores.carrots,
        Some(CommodityKind::Beetroot) => stores.beetroot,
        Some(CommodityKind::AroniaJam) => stores.aronia_jam,
        Some(CommodityKind::RosehipJam) => stores.rosehip_jam,
        Some(CommodityKind::Honey) => stores.honey,
        Some(CommodityKind::Wine) => stores.wine,
        Some(CommodityKind::Wool) => stores.wool,
        Some(CommodityKind::Cloth) => stores.cloth,
        Some(CommodityKind::Hides) => stores.hides,
        Some(CommodityKind::Leather) => stores.leather,
        Some(CommodityKind::Shoes) => stores.shoes,
        Some(CommodityKind::Ironwork) => stores.ironwork,
        Some(CommodityKind::Polearms) => stores.polearms,
        Some(CommodityKind::Gold) => stores.gold,
        Some(CommodityKind::Barley) => stores.barley,
        Some(CommodityKind::Malt) => stores.malt,
        Some(CommodityKind::Flax) => stores.flax,
        Some(CommodityKind::Iron) => stores.iron,
        Some(CommodityKind::Clay) => stores.clay,
        Some(CommodityKind::Salt) => stores.salt,
        Some(CommodityKind::Charcoal) => stores.charcoal,
        Some(CommodityKind::Pottery) => stores.pottery,
        Some(CommodityKind::RoofTiles) => stores.roof_tiles,
        Some(CommodityKind::Remedies) => stores.remedies,
        Some(CommodityKind::Stone | CommodityKind::Water | CommodityKind::Manure) | None => 0.0,
    }
}

fn treasury_portable_stores(
    treasury: &PlayerResources,
    buildings: &[Building],
) -> RaidPortableStores {
    // A physical settlement's compatibility row has no position and may only
    // exist briefly until the materializer creates a visible salvage pile.
    // That pile is already evaluated as a Building target, so treating this
    // row as a treasury would duplicate both value and plunder.
    if treasury.physical_founding_site_enabled {
        return RaidPortableStores::default();
    }
    let reserved_timber = buildings
        .iter()
        .map(|building| building.construction_treasury_timber.max(0.0))
        .sum::<f64>();
    RaidPortableStores {
        timber: raidable_treasury_timber(treasury.timber, reserved_timber),
        firewood: treasury.firewood,
        food: treasury.food,
        rye_sheaves: treasury.rye_sheaves,
        oat_sheaves: treasury.oat_sheaves,
        barley_sheaves: treasury.barley_sheaves,
        maslin_sheaves: treasury.maslin_sheaves,
        rye_grain: treasury.rye_grain,
        oat_grain: treasury.oat_grain,
        maslin_grain: treasury.maslin_grain,
        rye_flour: treasury.rye_flour,
        maslin_flour: treasury.maslin_flour,
        rye_bread: treasury.rye_bread,
        maslin_bread: treasury.maslin_bread,
        ale: treasury.ale,
        cider: treasury.cider,
        pear_cider: treasury.pear_cider,
        mead: treasury.mead,
        preserved_food: treasury.preserved_food,
        honey: treasury.honey,
        wine: treasury.wine,
        wool: treasury.wool,
        cloth: treasury.cloth,
        hides: treasury.hides,
        leather: treasury.leather,
        shoes: treasury.shoes,
        ironwork: treasury.ironwork,
        polearms: treasury.polearms,
        gold: treasury.gold,
        barley: treasury.barley,
        malt: treasury.malt,
        flax: treasury.flax,
        iron: treasury.iron,
        clay: treasury.clay,
        salt: treasury.salt,
        charcoal: treasury.charcoal,
        pottery: treasury.pottery,
        roof_tiles: treasury.roof_tiles,
        remedies: 0.0,
        meat: treasury.meat,
        fish: treasury.fish,
        berries: treasury.berries,
        mushrooms: treasury.mushrooms,
        milk: treasury.milk,
        apples: treasury.apples,
        cherries: treasury.cherries,
        vegetables: treasury.vegetables,
        eggs: treasury.eggs,
        grapes: treasury.grapes,
        cured_meat: treasury.cured_meat,
        smoked_fish: treasury.smoked_fish,
        cheese: treasury.cheese,
        pears: treasury.pears,
        aronia: treasury.aronia,
        rosehips: treasury.rosehips,
        cabbage: treasury.cabbage,
        carrots: treasury.carrots,
        beetroot: treasury.beetroot,
        aronia_jam: treasury.aronia_jam,
        rosehip_jam: treasury.rosehip_jam,
    }
    .normalized_whole()
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
                && building.kind != "palisaded_refuge"
                && !raid_immune_building_kind(&building.kind)
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
        .filter(|building| {
            building.kind != "watchtower"
                && building.kind != "guardhouse"
                && building.kind != "palisaded_refuge"
                && !raid_immune_building_kind(&building.kind)
        })
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
    let stores = stores.normalized_whole();
    building.timber = stores.timber;
    building.firewood = stores.firewood;
    building.food = stores.food;
    building.rye_sheaves = stores.rye_sheaves;
    building.oat_sheaves = stores.oat_sheaves;
    building.barley_sheaves = stores.barley_sheaves;
    building.maslin_sheaves = stores.maslin_sheaves;
    building.rye_grain = stores.rye_grain;
    building.oat_grain = stores.oat_grain;
    building.maslin_grain = stores.maslin_grain;
    building.rye_flour = stores.rye_flour;
    building.maslin_flour = stores.maslin_flour;
    building.rye_bread = stores.rye_bread;
    building.maslin_bread = stores.maslin_bread;
    building.ale = stores.ale;
    building.cider = stores.cider;
    building.pear_cider = stores.pear_cider;
    building.mead = stores.mead;
    building.preserved_food = stores.preserved_food;
    building.honey = stores.honey;
    building.wine = stores.wine;
    building.wool = stores.wool;
    building.cloth = stores.cloth;
    building.hides = stores.hides;
    building.leather = stores.leather;
    building.shoes = stores.shoes;
    building.ironwork = stores.ironwork;
    building.polearms = stores.polearms;
    building.gold = stores.gold;
    building.barley = stores.barley;
    building.malt = stores.malt;
    building.flax = stores.flax;
    building.iron = stores.iron;
    building.clay = stores.clay;
    building.salt = stores.salt;
    building.charcoal = stores.charcoal;
    building.pottery = stores.pottery;
    building.roof_tiles = stores.roof_tiles;
    building.remedies = stores.remedies;
    building.meat = stores.meat;
    building.fish = stores.fish;
    building.berries = stores.berries;
    building.mushrooms = stores.mushrooms;
    building.milk = stores.milk;
    building.apples = stores.apples;
    building.cherries = stores.cherries;
    building.vegetables = stores.vegetables;
    building.eggs = stores.eggs;
    building.grapes = stores.grapes;
    building.cured_meat = stores.cured_meat;
    building.smoked_fish = stores.smoked_fish;
    building.cheese = stores.cheese;
    building.pears = stores.pears;
    building.aronia = stores.aronia;
    building.rosehips = stores.rosehips;
    building.cabbage = stores.cabbage;
    building.carrots = stores.carrots;
    building.beetroot = stores.beetroot;
    building.aronia_jam = stores.aronia_jam;
    building.rosehip_jam = stores.rosehip_jam;
    building.civic_receipts_gold = whole_units(building.civic_receipts_gold).min(building.gold);
    building.private_export_proceeds_gold = whole_units(building.private_export_proceeds_gold)
        .min((building.gold - building.civic_receipts_gold).max(0.0));
}

fn retain_unplundered_treasury_stores(
    treasury: &mut PlayerResources,
    before: RaidPortableStores,
    remaining: RaidPortableStores,
) {
    macro_rules! subtract_loss {
        ($field:ident) => {{
            let lost = portable_store_loss(before.$field, remaining.$field);
            treasury.$field = (whole_units(treasury.$field) - lost).max(0.0);
        }};
    }

    subtract_loss!(timber);
    subtract_loss!(firewood);
    subtract_loss!(food);
    subtract_loss!(rye_sheaves);
    subtract_loss!(oat_sheaves);
    subtract_loss!(barley_sheaves);
    subtract_loss!(maslin_sheaves);
    subtract_loss!(rye_grain);
    subtract_loss!(oat_grain);
    subtract_loss!(maslin_grain);
    subtract_loss!(rye_flour);
    subtract_loss!(maslin_flour);
    subtract_loss!(rye_bread);
    subtract_loss!(maslin_bread);
    subtract_loss!(ale);
    subtract_loss!(cider);
    subtract_loss!(pear_cider);
    subtract_loss!(mead);
    subtract_loss!(preserved_food);
    subtract_loss!(honey);
    subtract_loss!(wine);
    subtract_loss!(wool);
    subtract_loss!(cloth);
    subtract_loss!(hides);
    subtract_loss!(leather);
    subtract_loss!(shoes);
    subtract_loss!(ironwork);
    subtract_loss!(polearms);
    subtract_loss!(gold);
    subtract_loss!(barley);
    subtract_loss!(malt);
    subtract_loss!(flax);
    subtract_loss!(iron);
    subtract_loss!(clay);
    subtract_loss!(salt);
    subtract_loss!(charcoal);
    subtract_loss!(pottery);
    subtract_loss!(roof_tiles);
    subtract_loss!(meat);
    subtract_loss!(fish);
    subtract_loss!(berries);
    subtract_loss!(mushrooms);
    subtract_loss!(milk);
    subtract_loss!(apples);
    subtract_loss!(cherries);
    subtract_loss!(vegetables);
    subtract_loss!(eggs);
    subtract_loss!(grapes);
    subtract_loss!(cured_meat);
    subtract_loss!(smoked_fish);
    subtract_loss!(cheese);
    subtract_loss!(pears);
    subtract_loss!(aronia);
    subtract_loss!(rosehips);
    subtract_loss!(cabbage);
    subtract_loss!(carrots);
    subtract_loss!(beetroot);
    subtract_loss!(aronia_jam);
    subtract_loss!(rosehip_jam);
}

fn portable_store_loss(before: f64, remaining: f64) -> f64 {
    (whole_units(before) - whole_units(remaining)).max(0.0)
}

fn settlement_guard_districts(
    buildings: &[Building],
    towers: &[WatchArea],
    road_network: Option<&RoadNetwork>,
    road_speed_multiplier: f64,
    fire_disabled_buildings: &HashSet<u64>,
    unavailable_guard_slots: &HashSet<(u64, u32)>,
    issued_guard_polearms: &HashMap<u64, f64>,
    deployed_guard_readiness_by_watch: &HashMap<u64, f64>,
) -> (f64, f64, HashMap<u64, f64>) {
    let watch_positions = towers
        .iter()
        .map(|tower| (tower.x, tower.z))
        .collect::<Vec<_>>();
    let watchtower_ids = towers
        .iter()
        .map(|tower| tower.source_id)
        .collect::<Vec<_>>();
    let mut total_ready = deployed_guard_readiness_by_watch.values().sum::<f64>();
    let mut assigned = 0.0;
    let mut readiness_by_watch = deployed_guard_readiness_by_watch.clone();

    for guardhouse in buildings.iter().filter(|building| {
        building.construction_complete
            && building.kind == "guardhouse"
            && !fire_disabled_buildings.contains(&building.id)
    }) {
        assigned += guardhouse.assigned_labor as f64;
        let onsite_polearms = (guardhouse.polearms
            - issued_guard_polearms
                .get(&guardhouse.id)
                .copied()
                .unwrap_or(0.0))
        .max(0.0);
        let unavailable_here = unavailable_guard_slots
            .iter()
            .filter_map(|(building_id, slot)| (*building_id == guardhouse.id).then_some(*slot))
            .collect::<Vec<_>>();
        let armed_here = select_guard_muster_slots(
            guardhouse.assigned_labor,
            onsite_polearms,
            &unavailable_here,
        )
        .len() as f64;
        if armed_here <= 1e-9 {
            continue;
        }
        let Some(network) = road_network else {
            continue;
        };
        let distances =
            network.road_path_distances_from(guardhouse.x, guardhouse.z, &watch_positions);
        let Some((watch_index, muster_distance)) = select_guardhouse_muster_watch(
            guardhouse.guardhouse_muster_watchtower_id,
            &watchtower_ids,
            &distances,
        ) else {
            continue;
        };
        let tower = &towers[watch_index];
        let muster_efficiency =
            guardhouse_muster_efficiency(Some(muster_distance), road_speed_multiplier);
        let effective = armed_here * guardhouse.action_cooldown.clamp(0.0, 1.0) * muster_efficiency;
        total_ready += effective;
        *readiness_by_watch.entry(tower.source_id).or_insert(0.0) += effective;
    }

    (total_ready, assigned, readiness_by_watch)
}
