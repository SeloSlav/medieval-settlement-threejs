use spacetimedb::ReducerContext;

use crate::balance_generated::{
    backyard_garden_def, BackyardGardenKind, HOUSEHOLD_INITIAL_WEALTH_PER_SETTLER,
};
use crate::db::*;
use crate::residence_settlement_policy::{
    residence_settlement_bill_buffer_min, settlement_buffers_ready, ResidenceSettlementVitalNeed,
};
use crate::simulation::chapel_community::effective_settle_ticks;
use crate::simulation::residence_needs::{state::NeedState, ResidenceNeedKind};
use crate::tables::Residence;

pub fn step_residence_settlement(
    ctx: &ReducerContext,
    residence: Residence,
    has_chapel_access: bool,
    has_monastery_coverage: bool,
    sabbath_observance: bool,
    needs: &[NeedState],
) {
    if residence.tier == 0 || residence.population_capacity == 0 {
        return;
    }
    if residence.population >= residence.population_capacity {
        return;
    }
    if residence.settlement_id != 0
        && ctx
            .db
            .settlement()
            .id()
            .find(&residence.settlement_id)
            .is_some_and(|settlement| !settlement.active)
    {
        // A planned expansion may lay out cottages in advance, but migrants do
        // not pre-empt those beds before its founding expedition arrives.
        return;
    }

    let buffers = needs.iter().filter_map(|need| {
        let kind = match need.kind {
            ResidenceNeedKind::Food => ResidenceSettlementVitalNeed::Food,
            ResidenceNeedKind::Firewood => ResidenceSettlementVitalNeed::Firewood,
            ResidenceNeedKind::Water => ResidenceSettlementVitalNeed::Water,
            _ => return None,
        };
        Some((
            need.stock,
            residence_settlement_bill_buffer_min(
                kind,
                residence.tier,
                has_chapel_access,
                has_monastery_coverage,
            ),
        ))
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

    // A matching local founding cohort is always rehoused before this vacancy
    // attracts an external migrant. Cohorts from other settlements are never
    // consulted, even if their camp is geographically closer.
    let _rehoused_founder = crate::settlements::take_unhoused_founder(ctx, residence.settlement_id);
    ctx.db.residence().id().update(Residence {
        population: residence.population.saturating_add(1),
        household_wealth: residence.household_wealth.max(0.0)
            + HOUSEHOLD_INITIAL_WEALTH_PER_SETTLER,
        settlement_ticks: 0,
        vacancy_ticks: 0,
        condition: 0,
        ..residence
    });
}
