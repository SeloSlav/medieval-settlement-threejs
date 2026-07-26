use spacetimedb::{Identity, ReducerContext};

use crate::building_defs::building_def;
use crate::db::*;
use crate::economy::available_building_labor;
use crate::farming::{
    farmstead_exportable_grain, field_seed_grain_remaining, field_work_allowed, STAGE_GROWING,
};
use crate::labor_steward_policy::seasonal_labor_steward_review_due;
use crate::seasonal_labor_policy::{
    seasonal_callup_targets, seasonal_labor_target, seasonal_production_active,
    SeasonalCallupCandidate,
};
use crate::tables::{farm_field, Building};

use super::building_has_active_trip;

pub fn owner_has_staffed_town_hall(ctx: &ReducerContext, owner: Identity) -> bool {
    ctx.db.building().owner().filter(&owner).any(|building| {
        building.kind == "town_hall"
            && building.construction_complete
            && building.assigned_labor > 0
    })
}

/// Releases only labor whose seasonal work is dormant. A site retains one
/// dispatcher while exportable stock or an active cart still needs attention.
pub fn recall_idle_seasonal_labor_for_owner(
    ctx: &ReducerContext,
    owner: Identity,
    month: u32,
) -> u32 {
    let buildings: Vec<Building> = ctx
        .db
        .building()
        .owner()
        .filter(&owner)
        .filter(|building| building.construction_complete && building.assigned_labor > 0)
        .collect();
    let mut recalled = 0_u32;

    for mut building in buildings {
        let fields = if building.kind == "threshing_barn" {
            ctx.db
                .farm_field()
                .farmstead_id()
                .filter(&building.id)
                .collect::<Vec<_>>()
        } else {
            Vec::new()
        };
        let farm_field_work_active = fields.iter().any(|field| {
            field.priority > 0
                && field.stage != STAGE_GROWING
                && field.stage_progress < 1.0 - 1e-9
                && field_work_allowed(field.stage, field.crop, month)
        });
        let seed_grain_required: f64 = fields
            .iter()
            .map(|field| {
                field_seed_grain_remaining(
                    field.area,
                    field.crop,
                    field.next_crop,
                    field.stage,
                    field.stage_progress,
                    field.priority,
                )
            })
            .sum();
        let has_outbound_stock = match building.kind.as_str() {
            "foragers_shed" | "fishing_camp" => building.food > 1e-6,
            "apiary" => building.food > 1e-6 || building.honey > 1e-6,
            "vineyard" => building.food > 1e-6 || building.wine > 1e-6,
            "threshing_barn" => {
                farmstead_exportable_grain(building.grain, seed_grain_required) > 1e-6
            }
            _ => false,
        };
        let has_dispatch_duty = has_outbound_stock || building_has_active_trip(ctx, building.id);
        let Some(target) = seasonal_labor_target(
            &building.kind,
            month,
            building.assigned_labor,
            has_dispatch_duty,
            farm_field_work_active,
        ) else {
            continue;
        };
        if target >= building.assigned_labor {
            continue;
        }
        recalled = recalled.saturating_add(building.assigned_labor - target);
        building.assigned_labor = target;
        ctx.db.building().id().update(building);
    }

    recalled
}

/// Fills active seasonal sites from the free labor pool. Existing staffing
/// priorities and round-robin sharing remain authoritative.
pub fn call_up_active_seasonal_labor_for_owner(
    ctx: &ReducerContext,
    owner: Identity,
    month: u32,
) -> u32 {
    let available_labor = available_building_labor(ctx, owner);
    if available_labor == 0 {
        return 0;
    }
    let mut candidates = Vec::new();
    for building in ctx
        .db
        .building()
        .owner()
        .filter(&owner)
        .filter(|building| building.construction_complete)
    {
        let Some(def) = building_def(&building.kind) else {
            continue;
        };
        if building.assigned_labor >= def.max_labor {
            continue;
        }
        let farm_field_work_active = building.kind == "threshing_barn"
            && ctx
                .db
                .farm_field()
                .farmstead_id()
                .filter(&building.id)
                .any(|field| {
                    field.priority > 0
                        && field.stage != STAGE_GROWING
                        && field.stage_progress < 1.0 - 1e-9
                        && field_work_allowed(field.stage, field.crop, month)
                });
        if seasonal_production_active(&building.kind, month, farm_field_work_active) != Some(true) {
            continue;
        }
        candidates.push(SeasonalCallupCandidate {
            building_id: building.id,
            priority: building.construction_priority,
            assigned_labor: building.assigned_labor,
            max_labor: def.max_labor,
        });
    }

    let mut called_up = 0_u32;
    for (building_id, target_labor) in seasonal_callup_targets(&candidates, available_labor) {
        let Some(mut building) = ctx.db.building().id().find(&building_id) else {
            continue;
        };
        if building.owner != owner || target_labor <= building.assigned_labor {
            continue;
        }
        called_up = called_up.saturating_add(target_labor - building.assigned_labor);
        building.assigned_labor = target_labor;
        ctx.db.building().id().update(building);
    }
    called_up
}

/// Ordering matters: dormant crews return first, then the same day's active
/// sites compete for the enlarged free pool.
pub fn reconcile_seasonal_labor_for_owner(
    ctx: &ReducerContext,
    owner: Identity,
    month: u32,
) -> (u32, u32) {
    let recalled = recall_idle_seasonal_labor_for_owner(ctx, owner, month);
    let called_up = call_up_active_seasonal_labor_for_owner(ctx, owner, month);
    (recalled, called_up)
}

/// Runs once at the authoritative calendar boundary. Disabled policies and
/// ordinary ticks avoid all settlement scans.
pub fn step_seasonal_labor_stewards(ctx: &ReducerContext, sim_tick: u64, month: u32) {
    if !seasonal_labor_steward_review_due(sim_tick) {
        return;
    }
    let owners: Vec<Identity> = ctx
        .db
        .player_resources()
        .iter()
        .filter(|resources| resources.seasonal_labor_steward_enabled)
        .map(|resources| resources.owner)
        .collect();
    for owner in owners {
        if owner_has_staffed_town_hall(ctx, owner) {
            reconcile_seasonal_labor_for_owner(ctx, owner, month);
        }
    }
}
