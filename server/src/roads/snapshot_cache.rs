//! Keep each owner's immutable graph and its bounded query caches across road edits.

use std::collections::HashMap;
use std::hash::Hash;
use std::sync::Arc;
use crate::roads::RoadNetwork;

struct CachedSnapshot {
    json: String,
    network: Option<Arc<RoadNetwork>>,
}

pub struct RoadSnapshotCache<K> {
    snapshots: HashMap<K, CachedSnapshot>,
    networks: Arc<HashMap<K, Arc<RoadNetwork>>>,
}

impl<K> Default for RoadSnapshotCache<K> {
    fn default() -> Self {
        Self { snapshots: HashMap::new(), networks: Arc::new(HashMap::new()) }
    }
}

impl<K: Clone + Eq + Hash> RoadSnapshotCache<K> {
    pub fn refresh(
        &mut self,
        snapshots: Vec<(K, String)>,
        mut parse: impl FnMut(&str) -> Option<RoadNetwork>,
    ) -> Arc<HashMap<K, Arc<RoadNetwork>>> {
        // Table owners are unique. Iteration order is irrelevant, so unchanged
        // snapshots need neither sorting nor a new outer allocation.
        if snapshots.len() == self.snapshots.len()
            && snapshots.iter().all(|(owner, json)| self.snapshots.get(owner).is_some_and(|old| old.json == *json)) {
            return self.networks.clone();
        }
        let mut old = std::mem::take(&mut self.snapshots);
        let mut next = HashMap::with_capacity(snapshots.len());
        let mut networks = HashMap::with_capacity(snapshots.len());
        for (owner, json) in snapshots {
            let entry = match old.remove(&owner) {
                Some(entry) if entry.json == json => entry,
                _ => CachedSnapshot { network: parse(&json).map(Arc::new), json },
            };
            if let Some(network) = &entry.network { networks.insert(owner.clone(), network.clone()); }
            next.insert(owner, entry);
        }
        // Removed/replaced graphs are released when the last reducer context
        // ends; the cache never retains retired owners.
        self.snapshots = next;
        self.networks = Arc::new(networks);
        self.networks.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot(owner: u32, length: f64) -> String {
        serde_json::json!({
            "nodes": [{"id":"a","position":[0.0,0.0,owner as f64]},
                {"id":"b","position":[length,0.0,owner as f64]}],
            "edges": [{"startNodeId":"a","endNodeId":"b",
                "sampledPath":[[0.0,0.0,owner as f64],[length,0.0,owner as f64]]}]
        }).to_string()
    }

    #[test]
    fn one_owner_edit_keeps_other_players_graphs_and_warm_routes() {
        let mut cache = RoadSnapshotCache::default();
        let mut parses = 0;
        let mut parse = |json: &str| { parses += 1; RoadNetwork::from_snapshot_json(json) };
        let snapshots: Vec<_> = (0..50).map(|owner| (owner, snapshot(owner, 100.0))).collect();
        let first = cache.refresh(snapshots.clone(), &mut parse);
        for owner in 0..50 {
            let network = &first[&owner];
            assert_eq!(network.road_path_route(0.0, owner as f64, 100.0, owner as f64).unwrap().distance, 100.0);
            network.road_path_route(0.0, owner as f64, 100.0, owner as f64);
            assert_eq!(network.route_cache_stats().hits, 1);
        }
        let mut reordered = snapshots.clone(); reordered.reverse();
        let same = cache.refresh(reordered, &mut parse);
        assert!(Arc::ptr_eq(&first, &same));
        let mut edited = snapshots;
        edited[7].1 = snapshot(7, 150.0);
        edited.retain(|(owner, _)| *owner != 49);
        edited.push((50, snapshot(50, 200.0)));
        let next = cache.refresh(edited, &mut parse);
        assert_eq!(parses, 52, "Only the edited and added graph need parsing");
        assert!(!next.contains_key(&49)); assert_eq!(cache.snapshots.len(), 50);
        for owner in 0..49 {
            if owner == 7 { continue; }
            assert!(Arc::ptr_eq(&first[&owner], &next[&owner]));
            next[&owner].road_path_route(0.0, owner as f64, 100.0, owner as f64);
            assert_eq!(next[&owner].route_cache_stats().hits, 2);
        }
        assert!(!Arc::ptr_eq(&first[&7], &next[&7]));
        assert_eq!(next[&7].route_cache_stats().entries, 0);
        assert_eq!(next[&7].road_path_route(0.0, 7.0, 150.0, 7.0).unwrap().distance, 150.0);
        assert_eq!(first[&7].road_path_route(0.0, 7.0, 100.0, 7.0).unwrap().distance, 100.0);
        let retired = Arc::downgrade(&first[&49]);
        drop(first); drop(same);
        assert!(retired.upgrade().is_none());
    }

    #[test]
    fn invalid_snapshot_removal_replacement_and_clean_world_release_old_state() {
        let mut cache = RoadSnapshotCache::default();
        let mut parses = 0;
        let mut parse = |json: &str| { parses += 1; RoadNetwork::from_snapshot_json(json) };
        let invalid = cache.refresh(vec![(1, "invalid".into())], &mut parse);
        assert!(invalid.is_empty());
        assert!(Arc::ptr_eq(&invalid, &cache.refresh(vec![(1, "invalid".into())], &mut parse)));
        let valid = cache.refresh(vec![(1, snapshot(1, 50.0))], &mut parse);
        assert_eq!(valid.len(), 1);
        let retired = Arc::downgrade(&valid[&1]); drop(valid);
        assert!(cache.refresh(Vec::new(), &mut parse).is_empty());
        assert!(retired.upgrade().is_none()); assert!(cache.snapshots.is_empty());
        let fresh = cache.refresh(vec![(1, snapshot(1, 50.0))], &mut parse);
        assert_eq!(fresh[&1].route_cache_stats().entries, 0);
        assert_eq!(parses, 3, "Invalid snapshots stay cached until replaced or removed");
    }
}
