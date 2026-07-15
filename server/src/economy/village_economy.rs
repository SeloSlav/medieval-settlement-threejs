use spacetimedb::ReducerContext;

use crate::balance_generated::{
    ECONOMIC_ACTIVITY_TAX_RATE, ECONOMIC_ACTIVITY_TAX_RATE_MAX, ECONOMIC_ACTIVITY_TAX_RATE_MIN,
    HIGH_TAX_PRODUCTIVITY_DRAG, LOW_TAX_PRODUCTIVITY_BOOST,
    TOWN_HALL_UNSTAFFED_TAX_COLLECTION_MULTIPLIER,
};
use crate::db::*;

pub fn clamp_economic_activity_tax_rate(rate: f64) -> f64 {
    rate.clamp(ECONOMIC_ACTIVITY_TAX_RATE_MIN, ECONOMIC_ACTIVITY_TAX_RATE_MAX)
}

/// Laffer-style productivity: low taxes stimulate village trade; high taxes suppress it.
/// Calibrated so the default rate (18%) is the neutral baseline (multiplier = 1.0).
pub fn economic_activity_productivity_multiplier(tax_rate: f64) -> f64 {
    let t = clamp_economic_activity_tax_rate(tax_rate);
    let t_opt = ECONOMIC_ACTIVITY_TAX_RATE;

    if t <= t_opt + 1e-12 {
        let span = (t_opt - ECONOMIC_ACTIVITY_TAX_RATE_MIN).max(1e-9);
        let boost = LOW_TAX_PRODUCTIVITY_BOOST * (t_opt - t) / span;
        1.0 + boost
    } else {
        let span = (ECONOMIC_ACTIVITY_TAX_RATE_MAX - t_opt).max(1e-9);
        let drag = HIGH_TAX_PRODUCTIVITY_DRAG * (t - t_opt) / span;
        (1.0_f64 - drag).max(0.12_f64)
    }
}

pub fn taxed_economic_activity(base_activity: f64, tax_rate: f64) -> (f64, f64) {
    let rate = clamp_economic_activity_tax_rate(tax_rate);
    let productivity = economic_activity_productivity_multiplier(rate);
    let adjusted = base_activity * productivity;
    let tax = adjusted * rate;
    (adjusted, tax)
}

pub fn player_economic_activity_tax_rate(ctx: &ReducerContext, owner: spacetimedb::Identity) -> f64 {
    ctx.db
        .player_resources()
        .owner()
        .find(&owner)
        .map(|row| row.economic_activity_tax_rate)
        .unwrap_or(ECONOMIC_ACTIVITY_TAX_RATE)
}

pub fn town_hall_tax_collection_multiplier(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
) -> f64 {
    if ctx
        .db
        .building()
        .owner()
        .filter(&owner)
        .any(|building| building.kind == "town_hall" && building.assigned_labor > 0)
    {
        1.0
    } else {
        TOWN_HALL_UNSTAFFED_TAX_COLLECTION_MULTIPLIER
    }
}
