//! Deterministic household slots shared by road-linked wells and Taverns.
use std::collections::HashMap;

#[derive(Clone, Copy, Debug)]
pub struct ServiceRouteCandidate {
    pub supplier_id: u64,
    pub residence_id: u64,
    pub distance: f64,
}

/// Shorter routes take slots first; full suppliers spill to the next available
/// road-linked supplier. Stable ids resolve equal routes independently of row order.
pub fn claim_service_routes(
    candidates: impl IntoIterator<Item = ServiceRouteCandidate>,
    household_capacity: usize,
) -> HashMap<u64, u64> {
    let mut candidates: Vec<_> = candidates
        .into_iter()
        .filter(|candidate| candidate.distance.is_finite() && candidate.distance >= 0.0)
        .collect();
    candidates.sort_by(|a, b| {
        a.distance
            .total_cmp(&b.distance)
            .then_with(|| a.supplier_id.cmp(&b.supplier_id))
            .then_with(|| a.residence_id.cmp(&b.residence_id))
    });
    let mut claims = HashMap::new();
    let mut counts = HashMap::new();
    for candidate in candidates {
        let count = counts.entry(candidate.supplier_id).or_insert(0);
        if claims.contains_key(&candidate.residence_id) || *count >= household_capacity {
            continue;
        }
        claims.insert(candidate.residence_id, candidate.supplier_id);
        *count += 1;
    }
    claims
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn full_suppliers_spill_to_the_next_route_and_never_exceed_fifty_homes() {
        let candidates: Vec<_> = (0..105)
            .flat_map(|residence_id| {
                [
                    ServiceRouteCandidate {
                        supplier_id: 1,
                        residence_id,
                        distance: residence_id as f64 + 1.0,
                    },
                    ServiceRouteCandidate {
                        supplier_id: 2,
                        residence_id,
                        distance: residence_id as f64 + 200.0,
                    },
                ]
            })
            .collect();
        let claims = claim_service_routes(candidates.iter().copied(), 50);
        assert_eq!(claims.len(), 100);
        assert_eq!(claims.values().filter(|&&id| id == 1).count(), 50);
        assert_eq!(claims.values().filter(|&&id| id == 2).count(), 50);
        assert_eq!(claims.get(&49), Some(&1));
        assert_eq!(claims.get(&50), Some(&2));
        assert_eq!(claims.get(&100), None);
        assert_eq!(
            claims,
            claim_service_routes(candidates.into_iter().rev(), 50)
        );
    }

    #[test]
    fn equal_routes_use_supplier_then_household_id_and_reject_invalid_routes() {
        let candidates = [
            ServiceRouteCandidate {
                supplier_id: 10,
                residence_id: 10,
                distance: 1.0,
            },
            ServiceRouteCandidate {
                supplier_id: 2,
                residence_id: 10,
                distance: 1.0,
            },
            ServiceRouteCandidate {
                supplier_id: 2,
                residence_id: 2,
                distance: 1.0,
            },
            ServiceRouteCandidate {
                supplier_id: 1,
                residence_id: 1,
                distance: f64::INFINITY,
            },
        ];
        let claims = claim_service_routes(candidates, 1);
        assert_eq!(claims, HashMap::from([(2, 2), (10, 10)]));
        assert!(claim_service_routes(candidates, 0).is_empty());
    }
}
