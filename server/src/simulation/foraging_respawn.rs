use spacetimedb::ReducerContext;

use crate::balance_generated::{GAME_HABITAT_DISRUPTION_RADIUS, TICK_DT};
use crate::building_defs::building_def;
use crate::db::*;
use crate::foraging_policy::{is_spring, population_growth_per_second};
use crate::harvest_reserve_policy::protected_wild_stock;
use crate::placement_validation::building_footprint_overlaps_circle;
use crate::season_policy::EnvironmentState;
use crate::simulation::{game_calendar::GameClock, SharedRoadNetworks};
use crate::tables::{Building, ForagingNode};
use crate::world_gen;

/// Advances persistent wild-resource populations. Nodes are never deleted or
/// rerolled here: seasonal plants recover in place, renewable populations keep
/// their breeding stock, and only a disturbed game habitat may migrate.
pub fn step_foraging_lifecycle(
    ctx: &ReducerContext,
    clock: &GameClock,
    environment: EnvironmentState,
    road_networks: &SharedRoadNetworks,
) {
    let nodes: Vec<ForagingNode> = ctx.db.foraging_node().iter().collect();
    for node in nodes {
        // Repair legacy renewable populations that open harvest could reduce
        // below their viable floor. Game recolonizes continuously; a rich
        // shoal obeys its seasonal limit and recolonizes only in spring.
        let renewable_floor = match node.node_kind.as_str() {
            "game" => protected_wild_stock("game", node.max_yield, 0),
            "fish" if is_spring(clock.month) => protected_wild_stock("fish", node.max_yield, 0),
            _ => 0.0,
        };
        let viable_remaining = node.remaining.max(renewable_floor);
        let growth = population_growth_per_second(
            &node.node_kind,
            viable_remaining,
            node.max_yield,
            clock.month,
        ) * environment.forage_regrowth_multiplier()
            * TICK_DT;
        let drought_loss = if node.node_kind == "fish" {
            node.max_yield * environment.fish_loss_per_second() * TICK_DT
        } else {
            0.0
        };
        let remaining = (viable_remaining + growth - drought_loss).clamp(0.0, node.max_yield);
        if (remaining - node.remaining).abs() <= 1e-12 && node.respawn_cooldown <= 0.0 {
            continue;
        }
        ctx.db.foraging_node().node_id().update(ForagingNode {
            remaining,
            // Kept in the schema for old databases; persistent nodes no longer
            // use cooldown-based deletion or relocation.
            respawn_cooldown: 0.0,
            ..node
        });
    }

    migrate_disrupted_game_habitats(ctx, clock.sim_tick, road_networks);
}

fn migrate_disrupted_game_habitats(
    ctx: &ReducerContext,
    sim_tick: u64,
    road_networks: &SharedRoadNetworks,
) {
    let buildings: Vec<Building> = ctx.db.building().iter().collect();
    if buildings.is_empty() {
        return;
    }
    let mut resource_nodes: Vec<ForagingNode> = ctx.db.foraging_node().iter().collect();

    for node_index in 0..resource_nodes.len() {
        if resource_nodes[node_index].node_kind != "game" {
            continue;
        }
        if !habitat_is_disrupted(
            resource_nodes[node_index].x,
            resource_nodes[node_index].z,
            &buildings,
            road_networks,
        ) {
            continue;
        }
        let Some((x, z)) = choose_migration_target(
            &resource_nodes[node_index],
            &resource_nodes,
            &buildings,
            road_networks,
            sim_tick,
        ) else {
            continue;
        };
        let node_id = resource_nodes[node_index].node_id.clone();
        let Some(current) = ctx.db.foraging_node().node_id().find(&node_id) else {
            continue;
        };
        ctx.db.foraging_node().node_id().update(ForagingNode {
            x,
            z,
            anchor_x: x,
            anchor_z: z,
            respawn_cooldown: 0.0,
            ..current
        });
        // Reserve the destination immediately so two herds disturbed in the
        // same lifecycle step cannot select the same otherwise-clear refuge.
        resource_nodes[node_index].x = x;
        resource_nodes[node_index].z = z;
        resource_nodes[node_index].anchor_x = x;
        resource_nodes[node_index].anchor_z = z;
    }
}

fn habitat_is_disrupted(
    x: f64,
    z: f64,
    buildings: &[Building],
    road_networks: &SharedRoadNetworks,
) -> bool {
    buildings.iter().any(|building| {
        building_def(&building.kind).is_some()
            && building_footprint_overlaps_circle(
                &building.kind,
                building.x,
                building.z,
                road_networks.get(&building.owner),
                x,
                z,
                GAME_HABITAT_DISRUPTION_RADIUS,
            )
    })
}

fn choose_migration_target(
    node: &ForagingNode,
    resource_nodes: &[ForagingNode],
    buildings: &[Building],
    road_networks: &SharedRoadNetworks,
    sim_tick: u64,
) -> Option<(f64, f64)> {
    let candidates = world_gen::game_respawn_candidates();
    if candidates.is_empty() {
        return None;
    }
    let start = (sim_tick as usize + node.node_id.len()) % candidates.len();
    for offset in 0..candidates.len() {
        let point = &candidates[(start + offset) % candidates.len()];
        if habitat_is_disrupted(point.x, point.z, buildings, road_networks) {
            continue;
        }
        let overlaps_other_resource = resource_nodes.iter().any(|other| {
            other.node_id != node.node_id
                && (other.x - point.x) * (other.x - point.x)
                    + (other.z - point.z) * (other.z - point.z)
                    < 90.0 * 90.0
        });
        if overlaps_other_resource {
            continue;
        }
        return Some((point.x, point.z));
    }
    None
}
