use std::collections::HashMap;

use spacetimedb::ReducerContext;

use crate::balance_generated::{
    CALENDAR_SECONDS_PER_DAY, STOREHOUSE_HAUL_PER_WORKER, TICK_DT, TIMBER_DELIVERY_SPEED_MPS,
    TIMBER_DELIVERY_UNLOAD_SEC,
};
use crate::db::*;
use crate::economy::{
    chapel_monastery_tithe_due, chapel_tithe_payment_room, debit_residence_wealth,
    deposit_chapel_tithe, CommodityKind,
};
use crate::simulation::chapel_community::{chapel_attendance_chance, chapel_tithe_gold_per_tick};
use crate::simulation::delivery_trips::{
    available_free_haulers, building_has_active_trip, try_start_building_supply_trip,
};
use crate::simulation::game_calendar::GameClock;
use crate::simulation::labor_schedule::is_chapel_tithe_paused;
use crate::simulation::landmark_access::{find_serving_chapel, residence_has_monastery_coverage};
use crate::simulation::tick_context::SimTickContext;
use crate::tables::Building;

#[derive(Clone, Copy)]
struct MonasteryTitheRoute {
    monastery_id: Option<u64>,
    share: f64,
}

pub fn step_chapels(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    sim_tick: u64,
    clock: &GameClock,
    chapels: &[Building],
    monasteries: &[Building],
) {
    // Routes depend only on the current policy, road graph, and the classified
    // fire-safe building roster. Resolve them once per chapel rather than
    // scanning and sorting monastery rows for every household that pays.
    let monastery_tithe_routes = build_monastery_tithe_routes(ctx, tick, chapels, monasteries);

    for residence in ctx.db.residence().iter() {
        if residence.abandoned || residence.population == 0 {
            continue;
        }

        if is_chapel_tithe_paused(ctx, tick, residence.owner, clock) {
            continue;
        }

        let Some(chapel) = find_serving_chapel(ctx, tick, residence.owner, &residence, chapels)
        else {
            continue;
        };

        let sabbath_observance =
            crate::simulation::labor_schedule::owner_sabbath_observance_enabled(
                ctx,
                tick,
                residence.owner,
            );
        let has_monastery_coverage =
            residence_has_monastery_coverage(ctx, tick, residence.owner, &residence, monasteries);
        let attendance_chance = chapel_attendance_chance(
            chapel.assigned_labor,
            sabbath_observance,
            has_monastery_coverage,
        );
        if !roll_chapel_attendance(residence.id, sim_tick, attendance_chance) {
            continue;
        }

        let route = monastery_tithe_routes.get(&chapel.id);
        let monastery_share = route
            .filter(|route| route.monastery_id.is_some())
            .map(|route| route.share)
            .unwrap_or(0.0);
        let tithe_due = chapel_tithe_gold_per_tick(residence.population);
        let payment_room = chapel_tithe_payment_room(ctx, chapel.id, monastery_share);
        let paid = debit_residence_wealth(ctx, &residence, tithe_due.min(payment_room));
        if paid <= 1e-9 {
            continue;
        }

        deposit_chapel_tithe(ctx, chapel.id, paid, monastery_share);
    }

    // Parish and monastery coin share one physical chapel doorway. Remitting
    // the sealed purse once each morning prevents a steady trickle of tithes
    // from monopolising that doorway and starving player-ordered Town Hall
    // collections, while a missed hauler remains a real one-day delay.
    if monastery_tithe_dispatch_due(sim_tick) {
        dispatch_monastery_tithes(ctx, tick, clock, chapels, &monastery_tithe_routes);
    }
}

fn monastery_tithe_dispatch_due(sim_tick: u64) -> bool {
    let ticks_per_day = (CALENDAR_SECONDS_PER_DAY / TICK_DT).round() as u64;
    ticks_per_day > 0 && sim_tick % ticks_per_day == 0
}

fn build_monastery_tithe_routes(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    chapels: &[Building],
    monasteries: &[Building],
) -> HashMap<u64, MonasteryTitheRoute> {
    chapels
        .iter()
        .map(|chapel| {
            let share = ctx
                .db
                .player_resources()
                .owner()
                .find(&chapel.owner)
                .map(|resources| resources.monastery_tithe_share.clamp(0.0, 0.8))
                .unwrap_or(0.0);
            let monastery_id = monasteries
                .iter()
                .filter(|building| {
                    building.owner == chapel.owner
                        && building.kind == "monastery"
                        && building.construction_complete
                        && tick.road_connected(
                            chapel.owner,
                            chapel.x,
                            chapel.z,
                            building.x,
                            building.z,
                        )
                })
                .map(|building| building.id)
                .min();
            (
                chapel.id,
                MonasteryTitheRoute {
                    monastery_id,
                    share,
                },
            )
        })
        .collect()
}

fn dispatch_monastery_tithes(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    chapels: &[Building],
    routes: &HashMap<u64, MonasteryTitheRoute>,
) {
    let mut free_haulers_by_owner = HashMap::new();
    let mut ordered_chapels = chapels.iter().collect::<Vec<_>>();
    ordered_chapels.sort_by_key(|chapel| chapel.id);

    for chapel in ordered_chapels {
        let Some(route) = routes.get(&chapel.id) else {
            continue;
        };
        let Some(monastery_id) = route.monastery_id else {
            continue;
        };
        let Some(mut source) = ctx.db.building().id().find(&chapel.id) else {
            continue;
        };
        let pending = chapel_monastery_tithe_due(&source);
        let mut source_changed = (source.chapel_monastery_tithe_due - pending).abs() > 1e-9;
        source.chapel_monastery_tithe_due = pending;
        if pending <= 1e-9 || building_has_active_trip(ctx, source.id) {
            if source_changed {
                ctx.db.building().id().update(source);
            }
            continue;
        }

        let free_haulers = free_haulers_by_owner
            .entry(source.owner)
            .or_insert_with(|| available_free_haulers(ctx, source.owner));
        if *free_haulers == 0 {
            if source_changed {
                ctx.db.building().id().update(source);
            }
            continue;
        }
        let Some(target) = ctx.db.building().id().find(&monastery_id) else {
            if source_changed {
                ctx.db.building().id().update(source);
            }
            continue;
        };
        let Some(network) = tick.road_network(source.owner) else {
            if source_changed {
                ctx.db.building().id().update(source);
            }
            continue;
        };

        let before = source.gold;
        if try_start_building_supply_trip(
            ctx,
            tick,
            clock,
            network,
            &mut source,
            &target,
            1,
            CommodityKind::Gold,
            TIMBER_DELIVERY_SPEED_MPS,
            TIMBER_DELIVERY_UNLOAD_SEC,
            STOREHOUSE_HAUL_PER_WORKER,
            pending,
        ) {
            let loaded = (before - source.gold).max(0.0);
            source.chapel_monastery_tithe_due =
                (source.chapel_monastery_tithe_due - loaded).max(0.0);
            source_changed = true;
            *free_haulers -= 1;
        }
        if source_changed {
            ctx.db.building().id().update(source);
        }
    }
}

fn roll_chapel_attendance(residence_id: u64, sim_tick: u64, chance: f64) -> bool {
    if chance <= 1e-9 {
        return false;
    }
    if chance >= 1.0 - 1e-9 {
        return true;
    }

    let hash = residence_id
        .wrapping_mul(0xD6E8_FEB8_6659_FD93)
        .wrapping_add(sim_tick.wrapping_mul(0xA5C6_5F3E_2B91_C7D1));
    let roll = (hash % 10_000) as f64 / 10_000.0;
    roll < chance
}
