//! One-way save migrations for content removed from the live ruleset.

use std::collections::HashSet;

use spacetimedb::ReducerContext;

use crate::db::*;
use crate::economy::reconcile_building_labor;
use crate::simulation::delivery_trips::drain_trips_for_building;

/// Ferry crossings were removed because rivers are intentionally trivial in
/// this map scale. Existing rows become ordinary reclamation piles in place;
/// stored coin and cart cargo survive, completed structures yield a modest
/// material salvage, and assigned workers return to the free pool.
pub fn retire_removed_buildings(ctx: &ReducerContext) {
    let retired: Vec<u64> = ctx
        .db
        .building()
        .iter()
        .filter(|building| building.kind == "ferry_landing")
        .map(|building| building.id)
        .collect();
    if retired.is_empty() {
        return;
    }

    let mut owners = HashSet::new();
    for building_id in retired {
        let Some(mut building) = ctx.db.building().id().find(&building_id) else {
            continue;
        };
        owners.insert(building.owner);
        let cargo = drain_trips_for_building(ctx, building.id);
        let complete = building.construction_complete;

        building.kind = "salvage_pile".to_string();
        building.work_radius = 0.0;
        building.assigned_labor = 0;
        building.action_cooldown = 0.0;
        building.timber += cargo.timber
            + if complete {
                23.0
            } else {
                building.construction_delivered_timber
            };
        building.stone += cargo.stone
            + if complete {
                9.0
            } else {
                building.construction_delivered_stone
            };
        building.ironwork += cargo.ironwork
            + if complete {
                1.0
            } else {
                building.construction_delivered_ironwork
            };
        building.gold += cargo.gold;
        building.construction_complete = true;
        building.construction_progress = 1.0;
        building.construction_required_timber = 0.0;
        building.construction_required_stone = 0.0;
        building.construction_required_ironwork = 0.0;
        building.construction_delivered_timber = 0.0;
        building.construction_delivered_stone = 0.0;
        building.construction_delivered_ironwork = 0.0;
        building.construction_reserved_timber = 0.0;
        building.construction_reserved_stone = 0.0;
        building.construction_reserved_ironwork = 0.0;
        building.construction_treasury_timber = 0.0;
        building.construction_treasury_stone = 0.0;
        building.construction_treasury_ironwork = 0.0;
        building.civic_receipts_gold = 0.0;
        building.private_export_proceeds_gold = 0.0;
        ctx.db.building().id().update(building);
    }
    for owner in owners {
        reconcile_building_labor(ctx, owner);
    }
}
