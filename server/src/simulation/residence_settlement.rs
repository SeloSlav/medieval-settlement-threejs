use spacetimedb::ReducerContext;

use crate::db::*;
use crate::simulation::chapel_community::effective_settle_ticks;
use crate::tables::Residence;

pub fn step_residence_settlement(
    ctx: &ReducerContext,
    residence: Residence,
    has_chapel_access: bool,
) {
    if residence.abandoned || residence.population_capacity == 0 {
        return;
    }
    if residence.population >= residence.population_capacity {
        return;
    }

    let required_ticks = effective_settle_ticks(has_chapel_access);

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
        ..residence
    });
}
