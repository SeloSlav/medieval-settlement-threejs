//! Standing tree -> falling -> bucking -> shared finite logs -> physical haul.
use spacetimedb::ReducerContext;
use crate::db::*;
use crate::building_defs::building_def;
use crate::constants::{TICK_DT, MILL_WATER_PER_HARVEST};
use crate::civilian_tool_policy::civilian_tool_throughput_multiplier;
use crate::balance_generated::CIVILIAN_TOOL_IRONWORK_PER_CYCLE;
use crate::economy::{building_commodity_room, CommodityKind};
use crate::forestry_policy::*;
use crate::tables::{Building, TreeEntity, TimberLog};
use crate::tree_work_area_policy::{effective_tree_work_area, tree_work_area_contains};
use super::{SimTickContext, GameClock, labor_and_logistics_paused};
use super::delivery_trips::{onsite_building_labor, try_start_forestry_trip};

pub fn step_falling_trees(ctx: &ReducerContext) {
    for mut tree in ctx.db.tree_entity().iter().filter(|t| t.phase == "falling") {
        tree.harvest_progress = (tree.harvest_progress + TICK_DT / TREE_FALL_SECONDS).min(1.0);
        if tree.harvest_progress >= 1.0 {
            tree.phase = "fallen".into();
            tree.harvest_progress = 0.0;
        }
        ctx.db.tree_entity().tree_id().update(tree);
    }
}

pub fn settle_depleted_tree(tree: &mut TreeEntity) {
    if tree.phase == "logs" && tree.logs.iter().all(|log| log.health < 1e-6 && log.firewood < 1e-6) {
        tree.phase = "stump".into();
        tree.growth_progress = 0.0;
        tree.harvest_progress = 0.0;
        tree.work_building_id = 0;
        tree.logs.clear();
    }
}

pub fn step_forestry(ctx: &ReducerContext, tick: &SimTickContext, clock: &GameClock, mut building: Building) {
    if labor_and_logistics_paused(ctx, tick, building.owner, clock) { return; }
    let Some(def) = building_def(&building.kind) else { return; };
    let firewood = building.kind == "woodcutters_lodge";
    let commodity = if firewood { CommodityKind::Firewood } else { CommodityKind::Timber };
    let rate = crate::production_rate_policy::production_rate_multiplier(building.production_rate_percent);
    if rate <= 0.0 { return; }
    let area = effective_tree_work_area(building.x, building.z, def.work_radius,
        building.tree_work_area_x, building.tree_work_area_z, building.tree_work_area_radius);
    // Both camps can use a tree in an overlapping work area; realms cannot steal one another's wood.
    let mut trees: Vec<_> = ctx.db.tree_entity().iter().filter(|tree|
        tree_work_area_contains(area, tree.x, tree.z)
        && tree.harvest_owner.is_none_or(|owner| owner == building.owner)
        && matches!(tree.phase.as_str(), "mature" | "falling" | "fallen" | "logs")
    ).collect();
    trees.sort_by(|a,b| ((a.x-building.x).powi(2)+(a.z-building.z).powi(2))
        .total_cmp(&((b.x-building.x).powi(2)+(b.z-building.z).powi(2)))
        .then_with(|| a.tree_id.cmp(&b.tree_id)));

    // Reserve transport before doing more cutting. No output is credited here.
    if building_commodity_room(&building, commodity) >= 1.0 {
        'haul: for tree in &trees {
            if tree.phase != "logs" { continue; }
            for (index, log) in tree.logs.iter().enumerate() {
                if (if firewood { log.firewood } else { log.health / LOG_HEALTH_PER_TIMBER }) < 1.0 { continue; }
                if try_start_forestry_trip(ctx, tick, clock, &building, tree, index, commodity) { break 'haul; }
            }
        }
    }
    let labor = onsite_building_labor(ctx, &building);
    if labor == 0 || building_commodity_room(&building, commodity) < 1.0 { return; }
    let work = TICK_DT * f64::from(labor) * rate
        * civilian_tool_throughput_multiplier(building.ironwork)
        * tick.land_use_profile(ctx).forestry_multiplier();
    building.action_cooldown = (building.action_cooldown - work).max(0.0);

    // Finish bucking the complete fallen tree before showing usable trunk sections.
    if let Some(tree) = trees.iter().find(|t| t.phase == "fallen") {
        let mut tree = ctx.db.tree_entity().tree_id().find(&tree.tree_id).unwrap();
        tree.work_building_id = building.id;
        tree.harvest_progress = (tree.harvest_progress + work / FALLEN_TREE_WORK_SECONDS).min(1.0);
        if tree.harvest_progress >= 1.0 {
            let yaw = fall_direction(tree.layout_index);
            tree.logs = log_health_budgets(tree.wood_yield).into_iter().enumerate().map(|(i, health)| {
                let distance = 2.0 + i as f64 * 3.0;
                TimberLog { x: tree.x + yaw.sin() * distance, z: tree.z + yaw.cos() * distance,
                    health, max_health: health, firewood: 0.0 }
            }).collect();
            tree.phase = "logs".into();
            tree.harvest_progress = 0.0;
            tree.work_building_id = 0;
        }
        ctx.db.tree_entity().tree_id().update(tree);
    } else if firewood && trees.iter().any(|t| t.phase == "logs" && t.logs.iter().any(|l| l.health >= LOG_HEALTH_PER_FIREWOOD)) {
        if building.action_cooldown <= 0.0 {
            let tree = trees.iter().find(|t| t.phase == "logs" && t.logs.iter().any(|l| l.health >= LOG_HEALTH_PER_FIREWOOD)).unwrap();
            let mut tree = ctx.db.tree_entity().tree_id().find(&tree.tree_id).unwrap();
            // A promised log is left for the ox already walking to it.
            let reserved: Vec<_> = ctx.db.delivery_trip().owner().filter(&building.owner)
                .filter_map(|trip| trip.forestry_source.filter(|s| s.tree_id == tree.tree_id).map(|s| s.log_index as usize)).collect();
            if let Some((_, log)) = tree.logs.iter_mut().enumerate().find(|(i,l)| l.health >= LOG_HEALTH_PER_FIREWOOD && !reserved.contains(i)) {
                let (health, amount) = wood_from_health(log.health, 1.0, true);
                log.health = health;
                log.firewood += amount;
                tree.work_building_id = building.id;
                building.action_cooldown = FIREWOOD_SPLIT_SECONDS;
                crate::production_maintenance::charge_completed_production_maintenance(&mut building, CIVILIAN_TOOL_IRONWORK_PER_CYCLE / tree.wood_yield.max(1.0));
                ctx.db.tree_entity().tree_id().update(tree);
            }
        }
    } else {
        // Clear the existing work site before felling another tree. This also
        // keeps a camp without an ox from endlessly stripping the forest.
        let useful_logs = trees.iter().any(|t| t.phase == "logs" && t.logs.iter().any(|l|
            if firewood { l.health >= LOG_HEALTH_PER_FIREWOOD || l.firewood >= 1.0 }
            else { l.health >= LOG_HEALTH_PER_TIMBER }));
        if !useful_logs && !trees.iter().any(|t| t.phase == "falling") && building.action_cooldown <= 0.0 {
            if let Some(tree) = trees.into_iter().find(|t| t.phase == "mature") {
                if firewood || building.water >= MILL_WATER_PER_HARVEST {
                    let mut tree = tree;
                    tree.phase = "falling".into();
                    tree.harvest_progress = 0.0;
                    tree.growth_progress = 0.0;
                    tree.harvest_owner = Some(building.owner);
                    tree.work_building_id = building.id;
                    tree.logs.clear();
                    if !firewood { building.water -= MILL_WATER_PER_HARVEST; }
                    building.action_cooldown = def.action_interval;
                    crate::production_maintenance::charge_completed_production_maintenance(&mut building, CIVILIAN_TOOL_IRONWORK_PER_CYCLE);
                    ctx.db.tree_entity().tree_id().update(tree);
                }
            }
        }
    }
    ctx.db.building().id().update(building);
}
