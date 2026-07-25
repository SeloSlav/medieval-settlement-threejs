use spacetimedb::ReducerContext;

use crate::balance_generated::{GAME_HABITAT_DISRUPTION_RADIUS, TICK_DT};
use crate::building_defs::building_def;
use crate::db::*;
use crate::foraging_policy::population_growth_per_second;
use crate::season_policy::EnvironmentState;
use crate::simulation::game_calendar::GameClock;
use crate::tables::{Building, ForagingNode};
use crate::world_gen;

/// Advances persistent wild-resource populations. Nodes are never deleted or
/// rerolled here: seasonal plants recover in place, fish and game reproduce
/// from survivors, and only a disturbed game habitat may migrate.
pub fn step_foraging_lifecycle(
    ctx: &ReducerContext,
    clock: &GameClock,
    environment: EnvironmentState,
) {
    let nodes: Vec<ForagingNode> = ctx.db.foraging_node().iter().collect();
    for node in nodes {
        let growth = population_growth_per_second(
            &node.node_kind,
            node.remaining,
            node.max_yield,
            clock.month,
        ) * environment.forage_regrowth_multiplier()
            * TICK_DT;
        let drought_loss = if node.node_kind == "fish" {
            node.max_yield * environment.fish_loss_per_second() * TICK_DT
        } else {
            0.0
        };
        let remaining = (node.remaining + growth - drought_loss).clamp(0.0, node.max_yield);
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

    migrate_disrupted_game_habitats(ctx, clock.sim_tick);
}

fn migrate_disrupted_game_habitats(ctx: &ReducerContext, sim_tick: u64) {
    let buildings: Vec<Building> = ctx.db.building().iter().collect();
    if buildings.is_empty() {
        return;
    }
    let resource_nodes: Vec<ForagingNode> = ctx.db.foraging_node().iter().collect();

    for node in resource_nodes
        .iter()
        .filter(|node| node.node_kind == "game" && node.remaining > 0.0)
    {
        if !habitat_is_disrupted(node.x, node.z, &buildings) {
            continue;
        }
        let Some((x, z)) = choose_migration_target(node, &resource_nodes, &buildings, sim_tick)
        else {
            continue;
        };
        let Some(current) = ctx.db.foraging_node().node_id().find(&node.node_id) else {
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
    }
}

fn habitat_is_disrupted(x: f64, z: f64, buildings: &[Building]) -> bool {
    buildings.iter().any(|building| {
        if building.kind == "hunters_hall" {
            return false;
        }
        let footprint = building_def(&building.kind)
            .map(|definition| definition.pick_radius)
            .unwrap_or(0.0);
        let radius = GAME_HABITAT_DISRUPTION_RADIUS + footprint;
        (building.x - x) * (building.x - x) + (building.z - z) * (building.z - z) <= radius * radius
    })
}

fn choose_migration_target(
    node: &ForagingNode,
    resource_nodes: &[ForagingNode],
    buildings: &[Building],
    sim_tick: u64,
) -> Option<(f64, f64)> {
    let candidates = world_gen::game_respawn_candidates();
    if candidates.is_empty() {
        return None;
    }
    let start = (sim_tick as usize + node.node_id.len()) % candidates.len();
    for offset in 0..candidates.len() {
        let point = &candidates[(start + offset) % candidates.len()];
        if habitat_is_disrupted(point.x, point.z, buildings) {
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
