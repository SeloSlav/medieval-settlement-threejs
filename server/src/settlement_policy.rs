//! Read-only resolution of local civic policy.
//!
//! Settlement membership selects jurisdiction, never ownership of goods or
//! labor. Legacy rows with `settlement_id == 0` deliberately fall back to the
//! realm defaults retained on `PlayerResources`.

use spacetimedb::{Identity, ReducerContext};

use crate::balance_generated::{
    ECONOMIC_ACTIVITY_TAX_RATE, TOWN_HALL_UNSTAFFED_TAX_COLLECTION_MULTIPLIER,
};
use crate::db::*;
use crate::night_policy::WATCH_STANDARD;
use crate::pantry_safeguard_policy::PANTRY_SAFEGUARD_DEFAULT;
use crate::tables::Settlement;

pub fn row(
    ctx: &ReducerContext,
    owner: Identity,
    settlement_id: u64,
) -> Option<Settlement> {
    if settlement_id == 0 {
        return None;
    }
    ctx.db
        .settlement()
        .id()
        .find(&settlement_id)
        .filter(|settlement| settlement.owner == owner && settlement.active)
}

pub fn economic_activity_tax_rate(
    ctx: &ReducerContext,
    owner: Identity,
    settlement_id: u64,
) -> f64 {
    row(ctx, owner, settlement_id)
        .map(|settlement| settlement.economic_activity_tax_rate)
        .or_else(|| {
            ctx.db
                .player_resources()
                .owner()
                .find(&owner)
                .map(|resources| resources.economic_activity_tax_rate)
        })
        .unwrap_or(ECONOMIC_ACTIVITY_TAX_RATE)
}

pub fn pantry_safeguard(ctx: &ReducerContext, owner: Identity, settlement_id: u64) -> u8 {
    row(ctx, owner, settlement_id)
        .map(|settlement| settlement.pantry_safeguard_policy)
        .or_else(|| {
            ctx.db
                .player_resources()
                .owner()
                .find(&owner)
                .map(|resources| resources.pantry_safeguard_policy)
        })
        .unwrap_or(PANTRY_SAFEGUARD_DEFAULT)
}

pub fn land_levy_rate(ctx: &ReducerContext, owner: Identity, settlement_id: u64) -> f64 {
    row(ctx, owner, settlement_id)
        .map(|settlement| settlement.land_levy_rate)
        .or_else(|| {
            ctx.db
                .player_resources()
                .owner()
                .find(&owner)
                .map(|resources| resources.land_levy_rate)
        })
        .unwrap_or(0.0)
}

pub fn import_duty_rate(ctx: &ReducerContext, owner: Identity, settlement_id: u64) -> f64 {
    row(ctx, owner, settlement_id)
        .map(|settlement| settlement.import_duty_rate)
        .or_else(|| {
            ctx.db
                .player_resources()
                .owner()
                .find(&owner)
                .map(|resources| resources.import_duty_rate)
        })
        .unwrap_or(0.0)
}

pub fn export_duty_rate(ctx: &ReducerContext, owner: Identity, settlement_id: u64) -> f64 {
    row(ctx, owner, settlement_id)
        .map(|settlement| settlement.export_duty_rate)
        .or_else(|| {
            ctx.db
                .player_resources()
                .owner()
                .find(&owner)
                .map(|resources| resources.export_duty_rate)
        })
        .unwrap_or(0.0)
}

#[derive(Clone, Copy, Debug)]
pub struct NightPolicies {
    pub watch: u8,
    pub work: u8,
    pub lighting: u8,
}

pub fn night(ctx: &ReducerContext, owner: Identity, settlement_id: u64) -> NightPolicies {
    if let Some(settlement) = row(ctx, owner, settlement_id) {
        return NightPolicies {
            watch: settlement.night_watch_policy,
            work: settlement.night_work_policy,
            lighting: settlement.night_lighting_policy,
        };
    }
    ctx.db
        .player_resources()
        .owner()
        .find(&owner)
        .map(|resources| NightPolicies {
            watch: resources.night_watch_policy,
            work: resources.night_work_policy,
            lighting: resources.night_lighting_policy,
        })
        .unwrap_or(NightPolicies {
            watch: WATCH_STANDARD,
            work: 1,
            lighting: 1,
        })
}

pub fn town_hall_tax_collection_multiplier(
    ctx: &ReducerContext,
    owner: Identity,
    settlement_id: u64,
) -> f64 {
    let Some(settlement) = row(ctx, owner, settlement_id) else {
        return if ctx.db.building().owner().filter(&owner).any(|building| {
            building.kind == "town_hall"
                && building.construction_complete
                && building.assigned_labor > 0
        }) {
            1.0
        } else {
            TOWN_HALL_UNSTAFFED_TAX_COLLECTION_MULTIPLIER
        };
    };
    if settlement.town_hall_id != 0
        && ctx
            .db
            .building()
            .id()
            .find(&settlement.town_hall_id)
            .is_some_and(|hall| {
                hall.owner == owner
                    && hall.settlement_id == settlement.id
                    && hall.kind == "town_hall"
                    && hall.construction_complete
                    && hall.assigned_labor > 0
            })
    {
        1.0
    } else {
        TOWN_HALL_UNSTAFFED_TAX_COLLECTION_MULTIPLIER
    }
}
