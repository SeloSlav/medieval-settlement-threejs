use spacetimedb::ReducerContext;

use crate::db::*;
use crate::balance_generated::{backyard_garden_def, BackyardGardenKind};
use crate::residence_settlement_policy::settlement_buffers_ready;
use crate::simulation::chapel_community::{effective_settle_ticks, recovery_stock_min};
use crate::simulation::residence_needs::state::NeedState;
use crate::tables::Residence;

pub fn step_residence_settlement(
    ctx: &ReducerContext,
    residence: Residence,
    has_chapel_access: bool,
    has_monastery_coverage: bool,
    sabbath_observance: bool,
    needs: &[NeedState],
) {
    if residence.tier == 0
        || residence.population_capacity == 0
    {
        return;
    }
    if residence.population >= residence.population_capacity {
        return;
    }

    let buffers = needs
        .iter()
        .filter(|need| need.kind.is_vital_for_tier(residence.tier, true))
        .map(|need| {
            (
                need.stock,
                recovery_stock_min(need.kind, has_chapel_access, has_monastery_coverage),
            )
        });
    if !settlement_buffers_ready(residence.population, buffers) {
        return;
    }

    let base_required_ticks = effective_settle_ticks(
        has_chapel_access,
        sabbath_observance,
        has_monastery_coverage,
    );
    let attraction_multiplier = ctx
        .db
        .backyard_garden()
        .residence_id()
        .filter(&residence.id)
        .next()
        .and_then(|garden| BackyardGardenKind::from_id(garden.kind))
        .map(|kind| backyard_garden_def(kind).settlement_attraction_multiplier)
        .unwrap_or(1.0)
        .clamp(0.25, 2.0);
    let required_ticks = ((base_required_ticks as f64) * attraction_multiplier)
        .round()
        .max(1.0) as u32;

    let next_ticks = residence.settlement_ticks.saturating_add(1);
    if next_ticks < required_ticks {
        ctx.db.residence().id().update(Residence {
            settlement_ticks: next_ticks,
            ..residence
        });
        return;
    }

    ctx.db.residence().id().update(Residence {
        population: residence.population.saturating_add(1),
        settlement_ticks: 0,
        vacancy_ticks: 0,
        condition: 0,
        ..residence
    });
}
