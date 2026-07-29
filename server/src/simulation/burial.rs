//! Physical collection and burial of deceased residents.

use std::collections::HashMap;

use spacetimedb::ReducerContext;

use crate::balance_generated::BURIAL_CART_SPEED_MPS;
use crate::db::*;
use crate::roads::{RoadNetwork, RoadPathRoute};
use crate::simulation::delivery_trips::{deserialize_route_polyline, serialize_route_polyline};
use crate::simulation::game_calendar::GameClock;
use crate::simulation::labor_and_logistics_paused;
use crate::simulation::tick_context::SimTickContext;
use crate::tables::{corpse, graveyard, Corpse, Graveyard};

pub fn step_burials(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    elapsed_seconds: f64,
) {
    advance_corpse_carts(ctx, tick, clock, elapsed_seconds);
    dispatch_waiting_corpses(ctx, tick, clock);
}

fn advance_corpse_carts(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    elapsed_seconds: f64,
) {
    let mut corpses: Vec<Corpse> = ctx
        .db
        .corpse()
        .iter()
        .filter(|corpse| corpse.state == 1 || corpse.state == 2)
        .collect();
    corpses.sort_by_key(|corpse| corpse.id);
    for mut corpse in corpses {
        if labor_and_logistics_paused(ctx, tick, corpse.owner, clock) {
            continue;
        }
        let Some(mut graveyard) = ctx.db.graveyard().id().find(&corpse.graveyard_id) else {
            reset_waiting(ctx, corpse);
            continue;
        };
        if graveyard.owner != corpse.owner || graveyard.burials >= graveyard.capacity {
            reset_waiting(ctx, corpse);
            continue;
        }
        let Some(polyline) = deserialize_route_polyline(&corpse.route_polyline_json) else {
            reset_waiting(ctx, corpse);
            continue;
        };
        if polyline.len() < 2 || corpse.path_distance <= 1e-6 {
            reset_waiting(ctx, corpse);
            continue;
        }
        corpse.progress = (corpse.progress + corpse.speed_mps.max(0.1) * elapsed_seconds.max(0.0))
            .min(corpse.path_distance);
        let (x, z) = RoadNetwork::sample_polyline_xz(&polyline, corpse.progress);
        corpse.cart_x = x;
        corpse.cart_z = z;
        if corpse.state == 2 {
            corpse.x = x;
            corpse.z = z;
        }
        if corpse.progress + 1e-6 >= corpse.path_distance {
            if corpse.state == 1 {
                let (gx, gz) = graveyard_centroid(&graveyard);
                let Some(network) = tick.road_network(corpse.owner) else {
                    reset_waiting(ctx, corpse);
                    continue;
                };
                let Some(route) = network.road_path_route(corpse.x, corpse.z, gx, gz) else {
                    reset_waiting(ctx, corpse);
                    continue;
                };
                begin_body_inbound(ctx, corpse, route);
            } else {
                graveyard.burials = graveyard.burials.saturating_add(1).min(graveyard.capacity);
                ctx.db.graveyard().id().update(graveyard);
                ctx.db.corpse().id().delete(corpse.id);
            }
        } else {
            ctx.db.corpse().id().update(corpse);
        }
    }
}

fn begin_body_inbound(ctx: &ReducerContext, mut corpse: Corpse, route: RoadPathRoute) {
    if route.polyline.len() < 2 || route.distance <= 1e-6 {
        reset_waiting(ctx, corpse);
        return;
    }
    corpse.state = 2;
    corpse.progress = 0.0;
    corpse.path_distance = route.distance;
    corpse.route_polyline_json = serialize_route_polyline(&route.polyline);
    let (x, z) = RoadNetwork::sample_polyline_xz(&route.polyline, 0.0);
    corpse.x = x;
    corpse.z = z;
    corpse.cart_x = x;
    corpse.cart_z = z;
    ctx.db.corpse().id().update(corpse);
}

fn reset_waiting(ctx: &ReducerContext, mut corpse: Corpse) {
    corpse.state = 0;
    corpse.chapel_id = 0;
    corpse.graveyard_id = 0;
    corpse.progress = 0.0;
    corpse.speed_mps = 0.0;
    corpse.path_distance = 0.0;
    corpse.route_polyline_json.clear();
    corpse.cart_x = corpse.x;
    corpse.cart_z = corpse.z;
    ctx.db.corpse().id().update(corpse);
}

fn dispatch_waiting_corpses(ctx: &ReducerContext, tick: &SimTickContext, clock: &GameClock) {
    let mut active_by_chapel = HashMap::<u64, u32>::new();
    let mut reserved_by_graveyard = HashMap::<u64, u32>::new();
    for corpse in ctx.db.corpse().iter().filter(|corpse| corpse.state != 0) {
        *active_by_chapel.entry(corpse.chapel_id).or_default() += 1;
        *reserved_by_graveyard
            .entry(corpse.graveyard_id)
            .or_default() += 1;
    }

    let mut waiting: Vec<Corpse> = ctx
        .db
        .corpse()
        .iter()
        .filter(|corpse| corpse.state == 0)
        .collect();
    waiting.sort_by_key(|corpse| (corpse.created_tick, corpse.id));
    for mut corpse in waiting {
        if labor_and_logistics_paused(ctx, tick, corpse.owner, clock) {
            continue;
        }
        let Some(network) = tick.road_network(corpse.owner) else {
            continue;
        };
        let mut best: Option<(f64, u64, Graveyard, RoadPathRoute, RoadPathRoute)> = None;
        for chapel in ctx
            .db
            .building()
            .owner()
            .filter(&corpse.owner)
            .filter(|building| {
                building.kind == "chapel"
                    && building.construction_complete
                    && building.assigned_labor
                        > active_by_chapel.get(&building.id).copied().unwrap_or(0)
                    && !tick.building_disabled_by_fire(ctx, building.id)
            })
        {
            for graveyard in ctx.db.graveyard().chapel_id().filter(&chapel.id) {
                let inbound = reserved_by_graveyard
                    .get(&graveyard.id)
                    .copied()
                    .unwrap_or(0);
                if graveyard.burials.saturating_add(inbound) >= graveyard.capacity {
                    continue;
                }
                let (gx, gz) = graveyard_centroid(&graveyard);
                let Some(outbound) =
                    network.road_path_route(chapel.x, chapel.z, corpse.x, corpse.z)
                else {
                    continue;
                };
                let Some(inbound) = network.road_path_route(corpse.x, corpse.z, gx, gz) else {
                    continue;
                };
                if inbound.distance <= 1e-6 || inbound.polyline.len() < 2 {
                    continue;
                }
                if outbound.distance > 1e-6 && outbound.polyline.len() < 2 {
                    continue;
                }
                let total_distance = outbound.distance + inbound.distance;
                let replace = best.as_ref().is_none_or(
                    |(existing_distance, existing_chapel_id, existing_graveyard, _, _)| {
                        total_distance < *existing_distance - 1e-6
                            || ((total_distance - *existing_distance).abs() <= 1e-6
                                && (chapel.id, graveyard.id)
                                    < (*existing_chapel_id, existing_graveyard.id))
                    },
                );
                if replace {
                    best = Some((total_distance, chapel.id, graveyard, outbound, inbound));
                }
            }
        }
        let Some((_distance, chapel_id, graveyard, outbound, inbound)) = best else {
            continue;
        };
        corpse.chapel_id = chapel_id;
        corpse.graveyard_id = graveyard.id;
        corpse.progress = 0.0;
        corpse.speed_mps = BURIAL_CART_SPEED_MPS;
        if outbound.distance <= 1e-6 || outbound.polyline.len() < 2 {
            corpse.state = 2;
            corpse.path_distance = inbound.distance;
            corpse.route_polyline_json = serialize_route_polyline(&inbound.polyline);
            let (x, z) = RoadNetwork::sample_polyline_xz(&inbound.polyline, 0.0);
            corpse.x = x;
            corpse.z = z;
            corpse.cart_x = x;
            corpse.cart_z = z;
        } else {
            corpse.state = 1;
            corpse.path_distance = outbound.distance;
            corpse.route_polyline_json = serialize_route_polyline(&outbound.polyline);
            let (cart_x, cart_z) = RoadNetwork::sample_polyline_xz(&outbound.polyline, 0.0);
            corpse.cart_x = cart_x;
            corpse.cart_z = cart_z;
        }
        ctx.db.corpse().id().update(corpse);
        *active_by_chapel.entry(chapel_id).or_default() += 1;
        *reserved_by_graveyard.entry(graveyard.id).or_default() += 1;
    }
}

fn graveyard_centroid(graveyard: &Graveyard) -> (f64, f64) {
    (
        (graveyard.corner_ax + graveyard.corner_bx + graveyard.corner_cx + graveyard.corner_dx)
            * 0.25,
        (graveyard.corner_az + graveyard.corner_bz + graveyard.corner_cz + graveyard.corner_dz)
            * 0.25,
    )
}
