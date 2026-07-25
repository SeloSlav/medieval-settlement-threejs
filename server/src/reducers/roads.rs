use spacetimedb::{reducer, ReducerContext};

use crate::db::*;
use crate::tables::RoadNetworkState;

#[reducer]
pub fn sync_road_network(ctx: &ReducerContext, snapshot_json: String) -> Result<(), String> {
    if snapshot_json.is_empty() {
        return Err("Road snapshot must not be empty.".to_string());
    }
    let owner = ctx.sender();
    if let Some(existing) = ctx.db.road_network_state().owner().find(&owner) {
        ctx.db
            .road_network_state()
            .owner()
            .update(RoadNetworkState {
                snapshot_json,
                ..existing
            });
    } else {
        ctx.db.road_network_state().insert(RoadNetworkState {
            owner,
            snapshot_json,
        });
    }
    Ok(())
}

#[reducer]
pub fn remove_road_edge(ctx: &ReducerContext, edge_id: String) -> Result<(), String> {
    let owner = ctx.sender();
    let state = ctx
        .db
        .road_network_state()
        .owner()
        .find(&owner)
        .ok_or_else(|| "No road network to update.".to_string())?;

    let mut snapshot: serde_json::Value = serde_json::from_str(&state.snapshot_json)
        .map_err(|_| "Stored road snapshot is invalid JSON.".to_string())?;

    if let Some(edges) = snapshot.get_mut("edges").and_then(|v| v.as_array_mut()) {
        edges.retain(|edge| edge.get("id").and_then(|id| id.as_str()) != Some(edge_id.as_str()));
    } else {
        return Err("Road snapshot missing edges array.".to_string());
    }

    let updated = serde_json::to_string(&snapshot)
        .map_err(|_| "Failed to serialize road snapshot.".to_string())?;

    ctx.db
        .road_network_state()
        .owner()
        .update(RoadNetworkState {
            snapshot_json: updated,
            ..state
        });
    Ok(())
}
