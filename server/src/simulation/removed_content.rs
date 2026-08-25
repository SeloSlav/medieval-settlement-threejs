//! One-way save migrations for content removed from the live ruleset.

use std::collections::HashSet;

use spacetimedb::ReducerContext;

use crate::db::*;
use crate::economy::reconcile_building_labor;
use crate::simulation::delivery_trips::drain_trips_for_building;
use crate::simulation::ReclamationStock;

/// Removed structures become ordinary reclamation piles in place. Stored
/// goods and cart cargo survive, completed structures yield their established
/// material salvage, and assigned workers return to the free pool. This also
/// clears legacy overnight camps from existing saves now that labor is
/// continuous and commute distance has no production effect.
pub fn retire_removed_buildings(ctx: &ReducerContext) {
    let mut retired = Vec::new();
    let mut stale_compatibility_rows = Vec::new();
    for building in ctx.db.building().iter() {
        if matches!(building.kind.as_str(), "ferry_landing" | "remote_work_camp") {
            retired.push(building.id);
        } else if building.remote_work_camp_enabled
            || building.linked_worksite_id != 0
            || !building.commute_efficiency.is_finite()
            || (building.commute_efficiency - 1.0).abs() > 1e-9
        {
            stale_compatibility_rows.push(building.id);
        }
    }
    let mut owners = HashSet::new();
    for building_id in retired {
        let Some(mut building) = ctx.db.building().id().find(&building_id) else {
            continue;
        };
        owners.insert(building.owner);
        let cargo = drain_trips_for_building(ctx, building.id);
        let complete = building.construction_complete;
        let recovered_cargo = ReclamationStock::from_delivery_cargo(&cargo);
        let completed_salvage = match building.kind.as_str() {
            "remote_work_camp" => (14.0, 3.0, 0.0),
            _ => (23.0, 9.0, 1.0),
        };
        let recovered_structure = ReclamationStock {
            timber: if complete {
                completed_salvage.0
            } else {
                building.construction_delivered_timber
            },
            stone: if complete {
                completed_salvage.1
            } else {
                building.construction_delivered_stone
            },
            ironwork: if complete {
                completed_salvage.2
            } else {
                building.construction_delivered_ironwork
            },
            roof_tiles: if complete {
                0.0
            } else {
                building.construction_delivered_roof_tiles
            },
            ..ReclamationStock::default()
        };
        let recovered = ReclamationStock::from_building(&building)
            .merged(recovered_cargo)
            .merged(recovered_structure);

        building.kind = "salvage_pile".to_string();
        building.work_radius = 0.0;
        building.assigned_labor = 0;
        building.action_cooldown = 0.0;
        recovered.replace_building_inventory(&mut building);
        building.construction_complete = true;
        building.construction_progress = 1.0;
        building.construction_required_timber = 0.0;
        building.construction_required_stone = 0.0;
        building.construction_required_ironwork = 0.0;
        building.construction_required_roof_tiles = 0.0;
        building.construction_delivered_timber = 0.0;
        building.construction_delivered_stone = 0.0;
        building.construction_delivered_ironwork = 0.0;
        building.construction_delivered_roof_tiles = 0.0;
        building.construction_reserved_timber = 0.0;
        building.construction_reserved_stone = 0.0;
        building.construction_reserved_ironwork = 0.0;
        building.construction_reserved_roof_tiles = 0.0;
        building.construction_treasury_timber = 0.0;
        building.construction_treasury_stone = 0.0;
        building.construction_treasury_ironwork = 0.0;
        building.construction_treasury_roof_tiles = 0.0;
        building.civic_receipts_gold = 0.0;
        building.private_export_proceeds_gold = 0.0;
        building.remote_work_camp_enabled = false;
        building.linked_worksite_id = 0;
        building.commute_efficiency = 1.0;
        ctx.db.building().id().update(building);
    }

    // Earlier implementations also cached camp and commute state on parent
    // worksites. Normalize every surviving row so no stale save value can
    // affect diagnostics or a compatibility client after camps are retired.
    for building_id in stale_compatibility_rows {
        let Some(mut building) = ctx.db.building().id().find(&building_id) else {
            continue;
        };
        building.remote_work_camp_enabled = false;
        building.linked_worksite_id = 0;
        building.commute_efficiency = 1.0;
        ctx.db.building().id().update(building);
    }
    for owner in owners {
        reconcile_building_labor(ctx, owner);
    }
}
