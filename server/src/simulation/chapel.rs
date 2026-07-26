use std::collections::HashMap;

use spacetimedb::ReducerContext;

use crate::db::*;
use crate::economy::{credit_treasury_gold, debit_residence_wealth, deposit_chapel_coffer};
use crate::simulation::chapel_community::{chapel_attendance_chance, chapel_tithe_gold_per_tick};
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

        let Some(chapel) = find_serving_chapel(tick, residence.owner, &residence, chapels) else {
            continue;
        };

        let sabbath_observance =
            crate::simulation::labor_schedule::owner_sabbath_observance_enabled(
                ctx,
                tick,
                residence.owner,
            );
        let has_monastery_coverage = residence_has_monastery_coverage(
            tick,
            residence.owner,
            &residence,
            monasteries,
            chapels,
        );
        let attendance_chance = chapel_attendance_chance(
            chapel.assigned_labor,
            sabbath_observance,
            has_monastery_coverage,
        );
        if !roll_chapel_attendance(residence.id, sim_tick, attendance_chance) {
            continue;
        }

        let tithe_due = chapel_tithe_gold_per_tick(residence.population);
        let paid = debit_residence_wealth(ctx, &residence, tithe_due);
        if paid <= 1e-9 {
            continue;
        }

        let monastery_share =
            transfer_monastery_tithe(ctx, chapel, monastery_tithe_routes.get(&chapel.id), paid);
        let parish_share = (paid - monastery_share).max(0.0);
        let deposited = deposit_chapel_coffer(ctx, chapel.id, parish_share);
        let overflow = parish_share - deposited;
        if overflow > 1e-9 {
            credit_treasury_gold(ctx, residence.owner, overflow);
        }
    }
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
            let monastery_id = if share <= 1e-9 {
                None
            } else {
                monasteries
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
                    .min()
            };
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

fn transfer_monastery_tithe(
    ctx: &ReducerContext,
    chapel: &Building,
    route: Option<&MonasteryTitheRoute>,
    paid: f64,
) -> f64 {
    let Some(route) = route else {
        return 0.0;
    };
    if route.share <= 1e-9 {
        return 0.0;
    }
    let Some(monastery_id) = route.monastery_id else {
        return 0.0;
    };
    let Some(mut monastery) = ctx.db.building().id().find(&monastery_id) else {
        return 0.0;
    };
    let transferred = paid * route.share;
    monastery.gold += transferred;
    ctx.db.building().id().update(monastery);
    if let Some(mut resources) = ctx.db.player_resources().owner().find(&chapel.owner) {
        resources.monastery_tithe_paid_total += transferred;
        ctx.db.player_resources().owner().update(resources);
    }
    transferred
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
