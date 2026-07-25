pub mod firewood;
pub mod food;
mod kinds;
pub mod provisions;
pub mod state;
mod supply;
pub mod water;

pub use kinds::ResidenceNeedKind;
pub use state::{load_needs, need_stock};

use crate::season_policy::EnvironmentState;
use crate::simulation::game_calendar::GameClock;
use crate::simulation::labor_schedule::is_consumption_paused;
use spacetimedb::ReducerContext;

use crate::db::*;
use crate::economy::reconcile_building_labor;
use crate::simulation::chapel_community::{
    effective_abandon_after_deficit_ticks, recovery_needs_required, recovery_stock_min,
};
use crate::simulation::residence_needs::state::{
    delete_needs, find_need_mut, init_needs, persist_needs, NeedState,
};
use crate::simulation::tick_context::SimTickContext;
use crate::tables::Residence;

pub fn step_residence_needs(
    ctx: &ReducerContext,
    residence: Residence,
    has_chapel_access: bool,
    has_monastery_coverage: bool,
    clock: &GameClock,
    environment: EnvironmentState,
) {
    if residence.abandoned || residence.population == 0 {
        return;
    }

    let general_consumption_paused = is_consumption_paused(ctx, residence.owner, clock);

    let mut needs = load_needs(ctx, residence.id);
    let mut any_unmet = false;

    for kind in ResidenceNeedKind::ALL {
        // Heating is continuous. Other needs keep the existing workday cadence.
        if general_consumption_paused && kind != ResidenceNeedKind::Firewood {
            continue;
        }
        if !kind.is_active_for_tier(residence.tier) {
            if let Some(need) = find_need_mut(&mut needs, kind) {
                need.deficit_ticks = 0;
            }
            continue;
        }
        let Some(need) = find_need_mut(&mut needs, kind) else {
            continue;
        };
        match consume_need(kind, &residence, need, environment) {
            ConsumeResult::Met(updated) => {
                *need = updated;
                need.deficit_ticks = 0;
            }
            ConsumeResult::Unmet => {
                any_unmet = true;
                *need = on_unmet_need(kind, need);
                need.deficit_ticks = need.deficit_ticks.saturating_add(1);
            }
        }
    }

    if !any_unmet {
        persist_needs(ctx, residence.id, &needs);
        return;
    }

    let abandon_threshold = effective_abandon_after_deficit_ticks(
        residence.tier,
        has_chapel_access,
        has_monastery_coverage,
    );
    let active_max_deficit = needs
        .iter()
        .filter(|need| need.kind.is_active_for_tier(residence.tier))
        .map(|need| need.deficit_ticks)
        .max()
        .unwrap_or(0);
    let abandoned = active_max_deficit >= abandon_threshold;
    let owner = residence.owner;
    persist_needs(ctx, residence.id, &needs);
    ctx.db.residence().id().update(Residence {
        abandoned,
        population: if abandoned { 0 } else { residence.population },
        ..residence
    });
    if abandoned {
        reconcile_building_labor(ctx, owner);
    }
}

pub fn step_residence_recovery(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    residence: Residence,
    has_chapel_access: bool,
    has_monastery_coverage: bool,
) {
    if !residence.abandoned {
        return;
    }

    let needs = load_needs(ctx, residence.id);
    let supply = supply::build_supply_context(tick, ctx, &residence);
    if !recovery_ready(
        &needs,
        &supply,
        residence.tier,
        has_chapel_access,
        has_monastery_coverage,
    ) {
        return;
    }

    let mut recovered_needs = needs;
    for need in &mut recovered_needs {
        need.deficit_ticks = 0;
    }
    persist_needs(ctx, residence.id, &recovered_needs);
    ctx.db.residence().id().update(Residence {
        abandoned: false,
        settlement_ticks: 0,
        population: 0,
        ..residence
    });
}

pub fn apply_need_delivery(
    ctx: &ReducerContext,
    residence_id: u64,
    kind: ResidenceNeedKind,
    delivered: f64,
) {
    let mut needs = load_needs(ctx, residence_id);
    let Some(need) = find_need_mut(&mut needs, kind) else {
        return;
    };
    *need = apply_delivery_for_kind(kind, need, delivered);
    persist_needs(ctx, residence_id, &needs);
}

pub fn ensure_residence_needs(ctx: &ReducerContext, residence_id: u64) {
    init_needs(ctx, residence_id);
}

pub fn clear_residence_needs(ctx: &ReducerContext, residence_id: u64) {
    delete_needs(ctx, residence_id);
}

fn recovery_ready(
    needs: &[NeedState],
    supply: &supply::ResidenceNeedSupplyContext,
    tier: u8,
    has_chapel_access: bool,
    has_monastery_coverage: bool,
) -> bool {
    let ready_count = ResidenceNeedKind::ALL
        .into_iter()
        .filter(|kind| kind.is_active_for_tier(tier))
        .filter(|kind| {
            let Some(need) = state::find_need(needs, *kind) else {
                return false;
            };
            evaluate_recovery(
                *kind,
                need,
                supply,
                has_chapel_access,
                has_monastery_coverage,
            )
        })
        .count();

    let active_count = ResidenceNeedKind::ALL
        .into_iter()
        .filter(|kind| kind.is_active_for_tier(tier))
        .count();
    ready_count >= (recovery_needs_required(has_chapel_access) as usize).min(active_count)
}

enum ConsumeResult {
    Met(NeedState),
    Unmet,
}

fn consume_need(
    kind: ResidenceNeedKind,
    residence: &Residence,
    need: &NeedState,
    environment: EnvironmentState,
) -> ConsumeResult {
    match kind {
        ResidenceNeedKind::Firewood => {
            match firewood::consume(residence, need, environment.firewood_demand_multiplier()) {
                firewood::ConsumeOutcome::Met(updated) => ConsumeResult::Met(updated),
                firewood::ConsumeOutcome::Unmet => ConsumeResult::Unmet,
            }
        }
        ResidenceNeedKind::Water => match water::consume(residence, need) {
            water::ConsumeOutcome::Met(updated) => ConsumeResult::Met(updated),
            water::ConsumeOutcome::Unmet => ConsumeResult::Unmet,
        },
        ResidenceNeedKind::Food => match food::consume(residence, need) {
            food::ConsumeOutcome::Met(updated) => ConsumeResult::Met(updated),
            food::ConsumeOutcome::Unmet => ConsumeResult::Unmet,
        },
        ResidenceNeedKind::Ale => match provisions::consume_ale(residence, need) {
            provisions::ConsumeOutcome::Met(updated) => ConsumeResult::Met(updated),
            provisions::ConsumeOutcome::Unmet => ConsumeResult::Unmet,
        },
        ResidenceNeedKind::PreservedFood => {
            match provisions::consume_preserved_food(residence, need) {
                provisions::ConsumeOutcome::Met(updated) => ConsumeResult::Met(updated),
                provisions::ConsumeOutcome::Unmet => ConsumeResult::Unmet,
            }
        }
    }
}

fn on_unmet_need(kind: ResidenceNeedKind, need: &NeedState) -> NeedState {
    match kind {
        ResidenceNeedKind::Firewood => firewood::on_unmet(need),
        ResidenceNeedKind::Water => water::on_unmet(need),
        ResidenceNeedKind::Food => food::on_unmet(need),
        ResidenceNeedKind::Ale | ResidenceNeedKind::PreservedFood => provisions::on_unmet(need),
    }
}

fn evaluate_recovery(
    kind: ResidenceNeedKind,
    need: &NeedState,
    supply: &supply::ResidenceNeedSupplyContext,
    has_chapel_access: bool,
    has_monastery_coverage: bool,
) -> bool {
    let stock_min = recovery_stock_min(kind, has_chapel_access, has_monastery_coverage);
    match kind {
        ResidenceNeedKind::Firewood => firewood::evaluate_recovery(need, supply, stock_min),
        ResidenceNeedKind::Water => water::evaluate_recovery(need, supply, stock_min),
        ResidenceNeedKind::Food => food::evaluate_recovery(need, supply, stock_min),
        ResidenceNeedKind::Ale | ResidenceNeedKind::PreservedFood => {
            provisions::evaluate_recovery(kind, need, supply, stock_min)
        }
    }
}

fn apply_delivery_for_kind(kind: ResidenceNeedKind, need: &NeedState, delivered: f64) -> NeedState {
    match kind {
        ResidenceNeedKind::Firewood => firewood::apply_delivery(need, delivered),
        ResidenceNeedKind::Water => water::apply_delivery(need, delivered),
        ResidenceNeedKind::Food => food::apply_delivery(need, delivered),
        ResidenceNeedKind::Ale | ResidenceNeedKind::PreservedFood => {
            provisions::apply_delivery(need, delivered)
        }
    }
}
