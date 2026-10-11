use spacetimedb::{reducer, ReducerContext};

use crate::db::*;
use crate::tables::RoadNetworkState;

#[reducer]
pub fn sync_road_network(ctx: &ReducerContext, snapshot_json: String) -> Result<(), String> {
    if snapshot_json.is_empty() {
        return Err("Road snapshot must not be empty.".to_string());
    }
    let snapshot_json = if crate::realm::ENABLED {
        if snapshot_json.len() > 2_000_000 { return Err("Road network exceeds the realm upload limit.".into()); }
        let mut snapshot: serde_json::Value = serde_json::from_str(&snapshot_json).map_err(|_| "Invalid road network")?;
        let nodes = snapshot.get("nodes").and_then(|n| n.as_array()).ok_or("Missing road nodes")?;
        let edges = snapshot.get("edges").and_then(|n| n.as_array()).ok_or("Missing road edges")?;
        if nodes.len() > 8192 || edges.len() > 8192 { return Err("Road network is too large.".into()); }
        validate_realm_snapshot(ctx, &snapshot, nodes, edges)?;
        // The fixed realm owns terrain. Never store, replicate or parse a
        // player-provided copy of its water/elevation grid for each road graph.
        snapshot.as_object_mut().ok_or("Invalid road network")?.remove("riverNavigation");
        serde_json::to_string(&snapshot).map_err(|_| "Cannot record road network")?
    } else { snapshot_json };
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

fn road_point(point: &serde_json::Value) -> Result<(f64, f64), String> {
    let point = point.as_array().filter(|p| p.len() == 3).ok_or("Invalid road coordinate")?;
    let values = point.iter().map(|v| v.as_f64().filter(|n| n.is_finite())).collect::<Option<Vec<_>>>()
        .ok_or("Invalid road coordinate")?;
    if values[1].abs() > 10_000.0 { return Err("Invalid road elevation".into()); }
    Ok((values[0], values[2]))
}

fn validate_realm_snapshot(ctx: &ReducerContext, snapshot: &serde_json::Value,
    nodes: &[serde_json::Value], edges: &[serde_json::Value]) -> Result<(), String> {
    use crate::realm::{realm_fog, realm_member};
    use crate::realm_policy::{fog_bit, point_segment_distance_sq, visit_road_cells, TOWN_RADIUS};
    use std::collections::BTreeMap;
    let owner = ctx.sender();
    if ctx.db.realm_member().owner().find(owner).is_none() { return Err("Join the realm first.".into()); }
    let fog: BTreeMap<_, _> = ctx.db.realm_fog().owner().filter(owner).map(|f| (f.chunk, f.explored)).collect();
    let mut claims: Vec<_> = ctx.db.realm_member().iter().filter(|m| m.owner != owner)
        .map(|m| (m.camp_x, m.camp_z, TOWN_RADIUS)).collect();
    claims.extend(ctx.db.building().iter().filter(|b| b.owner != owner).map(|b| (b.x, b.z, 48.0)));
    claims.extend(ctx.db.residence().iter().filter(|r| r.owner != owner).map(|r| (r.x, r.z, 12.0)));
    let visible = |chunk, bit| if fog.get(&chunk).is_some_and(|mask| mask & bit != 0) { Ok(()) }
        else { Err("Explore the complete road footprint before building.".to_string()) };
    let mut node_positions = BTreeMap::new();
    for node in nodes {
        let id = node.get("id").and_then(|v| v.as_str()).filter(|id| !id.is_empty()).ok_or("Invalid road node ID")?;
        let p = road_point(node.get("position").ok_or("Missing road node position")?)?;
        if node_positions.insert(id, p).is_some() { return Err("Duplicate road node ID".into()); }
        let (chunk, bit) = fog_bit(p.0, p.1).ok_or("Road node is outside the realm")?;
        visible(chunk, bit)?;
        if claims.iter().any(|&(x,z,r)| (x-p.0).hypot(z-p.1) < r) { return Err("Road node occupies another settlement's land.".into()); }
    }
    let mut tested_cells = 0usize;
    let mut validate_path = |points: &[serde_json::Value], radius: f64| -> Result<(), String> {
        if points.len() < 2 { return Err("A road or wall needs at least two points.".into()); }
        let points = points.iter().map(road_point).collect::<Result<Vec<_>, _>>()?;
        for segment in points.windows(2) {
            let (a, b) = (segment[0], segment[1]);
            if claims.iter().any(|&(x,z,r)| point_segment_distance_sq(x,z,a.0,a.1,b.0,b.1) < (r+radius).powi(2)) {
                return Err("Road footprint crosses another settlement's land.".into());
            }
            visit_road_cells(a.0,a.1,b.0,b.1,radius, |chunk, bit| {
                tested_cells += 1;
                if tested_cells > 100_000 { return Err("Road network footprint exceeds the upload work limit.".into()); }
                visible(chunk, bit)
            })?;
        }
        Ok(())
    };
    let mut ids = std::collections::BTreeSet::new();
    for edge in edges {
        let id=edge.get("id").and_then(|v|v.as_str()).filter(|id|!id.is_empty()).ok_or("Invalid road edge ID")?;
        if !ids.insert(id) { return Err("Duplicate road edge ID".into()); }
        let start=edge.get("startNodeId").and_then(|v|v.as_str()).and_then(|id|node_positions.get(id)).ok_or("Missing road start node")?;
        let end=edge.get("endNodeId").and_then(|v|v.as_str()).and_then(|id|node_positions.get(id)).ok_or("Missing road end node")?;
        let width=edge.get("width").and_then(|v|v.as_f64()).filter(|w|w.is_finite()&&*w>0.0&&*w<=16.0).ok_or("Invalid road width")?;
        let path=edge.get("sampledPath").and_then(|v|v.as_array()).ok_or("Missing sampled road path")?;
        if path.len()<2 || road_point(&path[0])? != *start || road_point(path.last().unwrap())? != *end {
            return Err("Road path must connect its declared nodes.".into());
        }
        validate_path(path,width*0.5)?;
        validate_path(edge.get("controlPoints").and_then(|v|v.as_array()).ok_or("Missing road control points")?,width*0.5)?;
    }
    if let Some(walls)=snapshot.get("dryStoneWalls") {
        let walls=walls.as_array().filter(|w|w.len()<=8192).ok_or("Invalid wall collection")?;
        for wall in walls {
            validate_path(wall.get("sampledPath").and_then(|v|v.as_array()).ok_or("Missing wall path")?,0.78)?;
            validate_path(wall.get("controlPoints").and_then(|v|v.as_array()).ok_or("Missing wall control points")?,0.78)?;
        }
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
