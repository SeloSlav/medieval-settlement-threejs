//! One-way save migrations for content removed from the live ruleset.

use std::collections::HashSet;

use spacetimedb::ReducerContext;

use crate::db::*;
use crate::economy::reconcile_building_labor;
use crate::simulation::delivery_trips::drain_trips_for_building;
use crate::simulation::ReclamationStock;

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
        let recovered_cargo = ReclamationStock {
            timber: cargo.timber,
            firewood: cargo.firewood,
            stone: cargo.stone,
            water: cargo.water,
            food: cargo.food,
            ale: cargo.ale,
            cider: cargo.cider,
            pear_cider: cargo.pear_cider,
            mead: cargo.mead,
            preserved_food: cargo.preserved_food,
            honey: cargo.honey,
            wine: cargo.wine,
            ironwork: cargo.ironwork,
            polearms: cargo.polearms,
            wool: cargo.wool,
            cloth: cargo.cloth,
            hides: cargo.hides,
            leather: cargo.leather,
            shoes: cargo.shoes,
            gold: cargo.gold,
            barley: cargo.barley,
            malt: cargo.malt,
            flax: cargo.flax,
            iron: cargo.iron,
            clay: cargo.clay,
            salt: cargo.salt,
            charcoal: cargo.charcoal,
            pottery: cargo.pottery,
            manure: cargo.manure,
            remedies: cargo.remedies,
            roof_tiles: cargo.roof_tiles,
            meat: cargo.meat,
            fish: cargo.fish,
            berries: cargo.berries,
            mushrooms: cargo.mushrooms,
            milk: cargo.milk,
            apples: cargo.apples,
            cherries: cargo.cherries,
            vegetables: cargo.vegetables,
            eggs: cargo.eggs,
            grapes: cargo.grapes,
            cured_meat: cargo.cured_meat,
            smoked_fish: cargo.smoked_fish,
            cheese: cargo.cheese,
            rye_sheaves: cargo.rye_sheaves,
            oat_sheaves: cargo.oat_sheaves,
            barley_sheaves: cargo.barley_sheaves,
            maslin_sheaves: cargo.maslin_sheaves,
            rye_grain: cargo.rye_grain,
            oat_grain: cargo.oat_grain,
            maslin_grain: cargo.maslin_grain,
            rye_flour: cargo.rye_flour,
            maslin_flour: cargo.maslin_flour,
            rye_bread: cargo.rye_bread,
            maslin_bread: cargo.maslin_bread,
            pears: cargo.pears,
            aronia: cargo.aronia,
            rosehips: cargo.rosehips,
            cabbage: cargo.cabbage,
            carrots: cargo.carrots,
            beetroot: cargo.beetroot,
            aronia_jam: cargo.aronia_jam,
            rosehip_jam: cargo.rosehip_jam,
        };
        let recovered_structure = ReclamationStock {
            timber: if complete {
                23.0
            } else {
                building.construction_delivered_timber
            },
            stone: if complete {
                9.0
            } else {
                building.construction_delivered_stone
            },
            ironwork: if complete {
                1.0
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
        ctx.db.building().id().update(building);
    }
    for owner in owners {
        reconcile_building_labor(ctx, owner);
    }
}
