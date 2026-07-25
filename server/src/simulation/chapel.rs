use spacetimedb::ReducerContext;

use crate::db::*;
use crate::economy::{credit_treasury_gold, debit_residence_wealth, deposit_chapel_coffer};
use crate::simulation::chapel_community::{chapel_attendance_chance, chapel_tithe_gold_per_tick};
use crate::simulation::game_calendar::GameClock;
use crate::simulation::labor_schedule::is_chapel_tithe_paused;
use crate::simulation::landmark_access::{find_serving_chapel, residence_has_monastery_coverage};
use crate::simulation::tick_context::SimTickContext;
use crate::tables::Building;

pub fn step_chapels(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    sim_tick: u64,
    clock: &GameClock,
    chapels: &[Building],
    monasteries: &[Building],
) {
    for residence in ctx.db.residence().iter() {
        if residence.abandoned || residence.population == 0 {
            continue;
        }

        if is_chapel_tithe_paused(ctx, residence.owner, clock) {
            continue;
        }

        let Some(chapel) = find_serving_chapel(tick, residence.owner, &residence, chapels) else {
            continue;
        };

        let sabbath_observance =
            crate::simulation::labor_schedule::owner_sabbath_observance_enabled(
                ctx,
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

        let monastery_share = transfer_monastery_tithe(ctx, tick, chapel, paid);
        let parish_share = (paid - monastery_share).max(0.0);
        let deposited = deposit_chapel_coffer(ctx, chapel.id, parish_share);
        let overflow = parish_share - deposited;
        if overflow > 1e-9 {
            credit_treasury_gold(ctx, residence.owner, overflow);
        }
    }
}

fn transfer_monastery_tithe(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    chapel: &Building,
    paid: f64,
) -> f64 {
    let Some(network) = tick.road_network(chapel.owner) else {
        return 0.0;
    };
    let share = ctx
        .db
        .player_resources()
        .owner()
        .find(&chapel.owner)
        .map(|resources| resources.monastery_tithe_share.clamp(0.0, 0.8))
        .unwrap_or(0.0);
    if share <= 1e-9 {
        return 0.0;
    }
    let mut monasteries: Vec<Building> = ctx
        .db
        .building()
        .owner()
        .filter(&chapel.owner)
        .filter(|building| building.kind == "monastery" && building.construction_complete)
        .filter(|building| {
            network
                .road_path_distance(chapel.x, chapel.z, building.x, building.z)
                .is_some()
        })
        .collect();
    monasteries.sort_by_key(|building| building.id);
    let Some(mut monastery) = monasteries.into_iter().next() else {
        return 0.0;
    };
    let transferred = paid * share;
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
