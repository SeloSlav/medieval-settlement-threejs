use spacetimedb::{Identity, ReducerContext};

use crate::building_defs::building_def;
use crate::construction_priority::CONSTRUCTION_PRIORITY_NORMAL;
use crate::db::*;
use crate::economy::{available_building_labor, building_edible_food_stock};
use crate::farming::{
    farmstead_exportable_grain, field_seed_crop, field_seed_grain_remaining, field_work_allowed,
    CROP_BARLEY, STAGE_GROWING,
};
use crate::labor_steward_policy::{seasonal_labor_steward_review_due, steward_deployable_labor};
use crate::seasonal_labor_policy::{
    seasonal_callup_targets, seasonal_labor_target, seasonal_production_active,
    SeasonalCallupCandidate,
};
use crate::tables::{farm_field, Building};

use super::{building_fire_state, building_has_active_trip, preserve_in_transit_cart_labor};

pub fn owner_has_staffed_town_hall(ctx: &ReducerContext, owner: Identity) -> bool {
    ctx.db.building().owner().filter(&owner).any(|building| {
        building.kind == "town_hall"
            && building.construction_complete
            && building.assigned_labor > 0
            && building_fire_state(ctx, building.id).is_none()
    })
}

/// Releases only labor whose seasonal work is dormant. Logistics labor handles
/// stored stock and active carts independently of the production roster.
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
        if building_fire_state(ctx, building.id).is_some() {
            let newly_reserved = preserve_in_transit_cart_labor(ctx, building.id, 0);
            recalled =
                recalled.saturating_add(building.assigned_labor.saturating_sub(newly_reserved));
            building.assigned_labor = 0;
            ctx.db.building().id().update(building);
            continue;
        }
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
        let farmstead_work_active = farm_field_work_active
            || building.kind == "threshing_barn"
                && building.rye_sheaves
                    + building.oat_sheaves
                    + building.barley_sheaves
                    + building.maslin_sheaves
                    > 1e-6;
        let (seed_grain_required, barley_seed_required) =
            fields.iter().fold((0.0, 0.0), |(grain, barley), field| {
                let reserve = field_seed_grain_remaining(
                    field.area,
                    field.crop,
                    field.next_crop,
                    field.stage,
                    field.stage_progress,
                    field.priority,
                );
                if field_seed_crop(field.crop, field.next_crop, field.stage) == CROP_BARLEY {
                    (grain, barley + reserve)
                } else {
                    (grain + reserve, barley)
                }
            });
        let has_outbound_stock = match building.kind.as_str() {
            "foragers_shed" => {
                building_edible_food_stock(&building) > 1e-6 || building.remedies > 1e-6
            }
            "fishing_camp" => building.fish > 1e-6,
            "apiary" => building.honey > 1e-6,
            "vineyard" => building.grapes > 1e-6 || building.wine > 1e-6,
            "threshing_barn" => {
                farmstead_exportable_grain(
                    building.rye_grain + building.oat_grain + building.maslin_grain + building.flax,
                    seed_grain_required,
                ) > 1e-6
                    || farmstead_exportable_grain(building.barley, barley_seed_required) > 1e-6
                    || building.rye_sheaves
                        + building.oat_sheaves
                        + building.barley_sheaves
                        + building.maslin_sheaves
                        > 1e-6
            }
            _ => false,
        };
        let has_dispatch_duty = has_outbound_stock || building_has_active_trip(ctx, building.id);
        let Some(target) = seasonal_labor_target(
            &building.kind,
            month,
            building.assigned_labor,
            has_dispatch_duty,
            farmstead_work_active,
        ) else {
            continue;
        };
        if target >= building.assigned_labor {
            continue;
        }
        let newly_reserved = preserve_in_transit_cart_labor(ctx, building.id, target);
        recalled = recalled.saturating_add(
            building
                .assigned_labor
                .saturating_sub(target)
                .saturating_sub(newly_reserved),
        );
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
    call_up_active_seasonal_labor_for_owner_with_reserve(ctx, owner, month, 0)
}

fn call_up_active_seasonal_labor_for_owner_with_reserve(
    ctx: &ReducerContext,
    owner: Identity,
    month: u32,
    labor_reserve: u32,
) -> u32 {
    let available_labor =
        steward_deployable_labor(available_building_labor(ctx, owner), labor_reserve);
    if available_labor == 0 {
        return 0;
    }
    let mut candidates = Vec::new();
    for building in ctx.db.building().owner().filter(&owner).filter(|building| {
        building.construction_complete && building_fire_state(ctx, building.id).is_none()
    }) {
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
        let farmstead_work_active = farm_field_work_active
            || building.kind == "threshing_barn"
                && building.rye_sheaves
                    + building.oat_sheaves
                    + building.barley_sheaves
                    + building.maslin_sheaves
                    > 1e-6;
        if seasonal_production_active(&building.kind, month, farmstead_work_active) != Some(true) {
            continue;
        }
        candidates.push(SeasonalCallupCandidate {
            building_id: building.id,
            priority: CONSTRUCTION_PRIORITY_NORMAL,
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
    labor_reserve: u32,
) -> (u32, u32) {
    let recalled = recall_idle_seasonal_labor_for_owner(ctx, owner, month);
    let called_up =
        call_up_active_seasonal_labor_for_owner_with_reserve(ctx, owner, month, labor_reserve);
    (recalled, called_up)
}

/// Runs once at the authoritative calendar boundary. Disabled policies and
/// ordinary ticks avoid all settlement scans.
pub fn step_seasonal_labor_stewards(ctx: &ReducerContext, sim_tick: u64, month: u32) {
    if !seasonal_labor_steward_review_due(sim_tick) {
        return;
    }
    let owners: Vec<(Identity, u32)> = ctx
        .db
        .player_resources()
        .iter()
        .filter(|resources| resources.seasonal_labor_steward_enabled)
        .map(|resources| (resources.owner, resources.labor_steward_reserve))
        .collect();
    for (owner, labor_reserve) in owners {
        if owner_has_staffed_town_hall(ctx, owner) {
            reconcile_seasonal_labor_for_owner(ctx, owner, month, labor_reserve);
        }
    }
}
