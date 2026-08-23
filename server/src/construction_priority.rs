//! Construction-site queue policy shared by the server and native tests.

pub const CONSTRUCTION_PRIORITY_HOLD: u8 = 0;
pub const CONSTRUCTION_PRIORITY_LOW: u8 = 1;
pub const CONSTRUCTION_PRIORITY_NORMAL: u8 = 2;
pub const CONSTRUCTION_PRIORITY_URGENT: u8 = 3;
pub const CONSTRUCTION_PRIORITY_LEVELS: usize = 4;
const STOCK_EPSILON: f64 = 1e-6;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ConstructionLaborSite {
    pub building_id: u64,
    pub priority: u8,
    pub assigned_labor: u32,
    pub max_labor: u32,
    pub work_ready: bool,
    pub inbound_supply: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConstructionLaborRotation {
    pub targets: Vec<(u64, u32)>,
    pub recalled_workers: u32,
    pub called_workers: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ConstructionSupplyCrew {
    Storehouse(u32),
    Free,
    SiteBuilder,
}

/// Chooses the labor owner for one physical construction cart. Dedicated
/// storehouse crews and genuinely free villagers retain priority. A builder is
/// eligible only when the frame cannot advance and its site does not already
/// own a cart trip.
pub fn construction_supply_crew(
    storehouse_workers: u32,
    free_haulers: u32,
    onsite_builders: u32,
    site_work_ready: bool,
    site_builder_cart_busy: bool,
) -> Option<ConstructionSupplyCrew> {
    if storehouse_workers > 0 {
        return Some(ConstructionSupplyCrew::Storehouse(storehouse_workers));
    }
    if free_haulers > 0 {
        return Some(ConstructionSupplyCrew::Free);
    }
    if onsite_builders > 0 && !site_work_ready && !site_builder_cart_busy {
        return Some(ConstructionSupplyCrew::SiteBuilder);
    }
    None
}

pub fn construction_priority_bucket(priority: u8) -> usize {
    priority.min(CONSTRUCTION_PRIORITY_URGENT) as usize
}

pub fn is_valid_construction_priority(priority: u8) -> bool {
    matches!(
        priority,
        CONSTRUCTION_PRIORITY_HOLD
            | CONSTRUCTION_PRIORITY_LOW
            | CONSTRUCTION_PRIORITY_NORMAL
            | CONSTRUCTION_PRIORITY_URGENT
    )
}

fn nonnegative(value: f64) -> f64 {
    if value.is_finite() {
        value.max(0.0)
    } else {
        0.0
    }
}

/// Builders can make immediate progress when delivered materials are ahead of
/// the frame, or when a legacy reserve can be moved onto site.
pub fn construction_labor_ready(
    required_timber: f64,
    required_stone: f64,
    required_ironwork: f64,
    delivered_timber: f64,
    delivered_stone: f64,
    delivered_ironwork: f64,
    progress: f64,
    treasury_timber: f64,
    treasury_stone: f64,
    treasury_ironwork: f64,
    required_roof_tiles: f64,
    delivered_roof_tiles: f64,
    treasury_roof_tiles: f64,
) -> bool {
    let required_total = nonnegative(required_timber)
        + nonnegative(required_stone)
        + nonnegative(required_ironwork)
        + nonnegative(required_roof_tiles);
    let delivered_total = nonnegative(delivered_timber)
        + nonnegative(delivered_stone)
        + nonnegative(delivered_ironwork)
        + nonnegative(delivered_roof_tiles);
    let material_readiness = if required_total <= STOCK_EPSILON {
        1.0
    } else {
        (delivered_total / required_total).clamp(0.0, 1.0)
    };
    let progress = nonnegative(progress).min(1.0);
    progress + STOCK_EPSILON < material_readiness
        || nonnegative(treasury_timber)
            + nonnegative(treasury_stone)
            + nonnegative(treasury_ironwork)
            + nonnegative(treasury_roof_tiles)
            > STOCK_EPSILON
}

/// Recalls crews that cannot build and have no cart approaching, then assigns
/// all currently free labor to work-ready sites. Urgent sites fill before
/// normal and low sites; equal-priority sites receive one worker per pass.
pub fn construction_labor_rotation(
    sites: &[ConstructionLaborSite],
    available_labor: u32,
) -> ConstructionLaborRotation {
    construction_labor_rotation_with_reserve(sites, available_labor, 0)
}

pub fn construction_labor_rotation_with_reserve(
    sites: &[ConstructionLaborSite],
    available_labor: u32,
    labor_reserve: u32,
) -> ConstructionLaborRotation {
    let mut recalled_workers = 0u32;
    let mut targets = Vec::new();
    let mut buckets: [Vec<(ConstructionLaborSite, u32)>; 3] = std::array::from_fn(|_| Vec::new());

    for site in sites.iter().copied() {
        let priority = construction_priority_bucket(site.priority);
        if priority == CONSTRUCTION_PRIORITY_HOLD as usize {
            continue;
        }
        if !site.work_ready && !site.inbound_supply {
            if site.assigned_labor > 0 {
                recalled_workers = recalled_workers.saturating_add(site.assigned_labor);
                targets.push((site.building_id, 0));
            }
            continue;
        }
        if !site.work_ready || site.assigned_labor >= site.max_labor {
            continue;
        }
        let bucket = priority.saturating_sub(CONSTRUCTION_PRIORITY_LOW as usize);
        buckets[bucket].push((site, site.assigned_labor));
    }

    targets.sort_unstable_by_key(|(building_id, _)| *building_id);
    for bucket in &mut buckets {
        bucket.sort_unstable_by_key(|(site, _)| site.building_id);
    }

    let mut labor_remaining = available_labor
        .saturating_add(recalled_workers)
        .saturating_sub(labor_reserve);
    let mut called_workers = 0u32;
    for bucket in buckets.iter_mut().rev() {
        while labor_remaining > 0 {
            let mut assigned_this_pass = false;
            for (site, _) in bucket.iter_mut() {
                if labor_remaining == 0 {
                    break;
                }
                if site.assigned_labor >= site.max_labor {
                    continue;
                }
                site.assigned_labor += 1;
                called_workers += 1;
                labor_remaining -= 1;
                assigned_this_pass = true;
            }
            if !assigned_this_pass {
                break;
            }
        }
        targets.extend(
            bucket
                .iter()
                .filter(|(site, original_labor)| site.assigned_labor > *original_labor)
                .map(|(site, _)| (site.building_id, site.assigned_labor)),
        );
        if labor_remaining == 0 {
            break;
        }
    }

    ConstructionLaborRotation {
        targets,
        recalled_workers,
        called_workers,
    }
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use super::{
        construction_labor_ready, construction_labor_rotation,
        construction_labor_rotation_with_reserve, construction_priority_bucket,
        construction_supply_crew, is_valid_construction_priority, ConstructionLaborSite,
        ConstructionSupplyCrew, CONSTRUCTION_PRIORITY_HOLD, CONSTRUCTION_PRIORITY_LEVELS,
        CONSTRUCTION_PRIORITY_LOW, CONSTRUCTION_PRIORITY_NORMAL, CONSTRUCTION_PRIORITY_URGENT,
    };

    #[test]
    fn construction_supply_prefers_dedicated_and_free_crews_before_a_builder() {
        assert_eq!(
            construction_supply_crew(2, 1, 3, false, false),
            Some(ConstructionSupplyCrew::Storehouse(2))
        );
        assert_eq!(
            construction_supply_crew(0, 1, 3, false, false),
            Some(ConstructionSupplyCrew::Free)
        );
    }

    #[test]
    fn one_blocked_site_builder_can_break_a_hauler_deadlock() {
        assert_eq!(
            construction_supply_crew(0, 0, 2, false, false),
            Some(ConstructionSupplyCrew::SiteBuilder)
        );
        assert_eq!(
            construction_supply_crew(0, 0, 2, false, true),
            None,
            "an existing site-owned cart must prevent a second borrowed-builder trip"
        );
        assert_eq!(
            construction_supply_crew(0, 0, 2, true, false),
            None,
            "builders who can advance the frame must remain onsite"
        );
        assert_eq!(construction_supply_crew(0, 0, 0, false, false), None);
    }

    #[test]
    fn construction_priority_is_a_small_bounded_bucket_domain() {
        assert_eq!(CONSTRUCTION_PRIORITY_LEVELS, 4);
        assert_eq!(construction_priority_bucket(CONSTRUCTION_PRIORITY_HOLD), 0);
        assert_eq!(construction_priority_bucket(CONSTRUCTION_PRIORITY_LOW), 1);
        assert_eq!(
            construction_priority_bucket(CONSTRUCTION_PRIORITY_NORMAL),
            2
        );
        assert_eq!(
            construction_priority_bucket(CONSTRUCTION_PRIORITY_URGENT),
            3
        );
        assert_eq!(construction_priority_bucket(u8::MAX), 3);
        assert!(is_valid_construction_priority(CONSTRUCTION_PRIORITY_NORMAL));
        assert!(!is_valid_construction_priority(4));
    }

    #[test]
    fn higher_priority_buckets_are_visited_first_without_sorting_sites() {
        let sites = [(10u64, 1u8), (20, 3), (30, 0), (40, 2), (50, 3)];
        let mut buckets: [Vec<u64>; CONSTRUCTION_PRIORITY_LEVELS] =
            std::array::from_fn(|_| Vec::new());
        for (id, priority) in sites {
            buckets[construction_priority_bucket(priority)].push(id);
        }
        let ordered: Vec<u64> = buckets
            .into_iter()
            .enumerate()
            .rev()
            .filter(|(priority, _)| *priority > CONSTRUCTION_PRIORITY_HOLD as usize)
            .flat_map(|(_, ids)| ids)
            .collect();
        assert_eq!(ordered, vec![20, 50, 40, 10]);
    }

    #[test]
    fn priority_bucketing_stays_linear_at_large_settlement_scale() {
        let started = Instant::now();
        let mut buckets: [Vec<u64>; CONSTRUCTION_PRIORITY_LEVELS] =
            std::array::from_fn(|_| Vec::new());
        for id in 0..100_000u64 {
            let priority = (id % CONSTRUCTION_PRIORITY_LEVELS as u64) as u8;
            buckets[construction_priority_bucket(priority)].push(id);
        }
        assert_eq!(buckets.iter().map(Vec::len).sum::<usize>(), 100_000);
        assert_eq!(buckets[CONSTRUCTION_PRIORITY_URGENT as usize][0], 3);
        assert!(
            started.elapsed() < Duration::from_millis(100),
            "100k construction sites should bucket well below a simulation frame"
        );
    }

    #[test]
    fn material_readiness_and_founders_reserve_are_productive_work() {
        assert!(construction_labor_ready(
            20.0, 10.0, 2.0, 15.0, 0.0, 2.0, 0.25, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0
        ));
        assert!(!construction_labor_ready(
            20.0, 10.0, 2.0, 15.0, 0.0, 2.0, 0.55, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0
        ));
        assert!(construction_labor_ready(
            20.0, 10.0, 2.0, 0.0, 0.0, 0.0, 0.0, 10.0, 0.0, 0.0, 0.0, 0.0, 0.0
        ));
        assert!(construction_labor_ready(
            0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0
        ));
        assert!(!construction_labor_ready(
            f64::NAN,
            10.0,
            f64::NAN,
            f64::NAN,
            0.0,
            f64::NAN,
            f64::NAN,
            0.0,
            f64::NAN,
            0.0,
            0.0,
            0.0,
            0.0,
        ));
    }

    #[test]
    fn rotation_recalls_blocked_crews_and_round_robins_urgent_work() {
        let rotation = construction_labor_rotation(
            &[
                ConstructionLaborSite {
                    building_id: 40,
                    priority: CONSTRUCTION_PRIORITY_LOW,
                    assigned_labor: 2,
                    max_labor: 4,
                    work_ready: false,
                    inbound_supply: false,
                },
                ConstructionLaborSite {
                    building_id: 30,
                    priority: CONSTRUCTION_PRIORITY_NORMAL,
                    assigned_labor: 2,
                    max_labor: 4,
                    work_ready: false,
                    inbound_supply: true,
                },
                ConstructionLaborSite {
                    building_id: 20,
                    priority: CONSTRUCTION_PRIORITY_URGENT,
                    assigned_labor: 0,
                    max_labor: 4,
                    work_ready: true,
                    inbound_supply: false,
                },
                ConstructionLaborSite {
                    building_id: 10,
                    priority: CONSTRUCTION_PRIORITY_URGENT,
                    assigned_labor: 0,
                    max_labor: 4,
                    work_ready: true,
                    inbound_supply: false,
                },
            ],
            1,
        );

        assert_eq!(rotation.recalled_workers, 2);
        assert_eq!(rotation.called_workers, 3);
        assert_eq!(rotation.targets, vec![(40, 0), (10, 2), (20, 1)]);
    }

    #[test]
    fn hold_sites_and_inbound_crews_are_not_reassigned() {
        let rotation = construction_labor_rotation(
            &[
                ConstructionLaborSite {
                    building_id: 10,
                    priority: CONSTRUCTION_PRIORITY_HOLD,
                    assigned_labor: 3,
                    max_labor: 4,
                    work_ready: false,
                    inbound_supply: false,
                },
                ConstructionLaborSite {
                    building_id: 20,
                    priority: CONSTRUCTION_PRIORITY_NORMAL,
                    assigned_labor: 2,
                    max_labor: 4,
                    work_ready: false,
                    inbound_supply: true,
                },
            ],
            4,
        );
        assert_eq!(rotation.recalled_workers, 0);
        assert_eq!(rotation.called_workers, 0);
        assert!(rotation.targets.is_empty());
    }

    #[test]
    fn steward_reserve_survives_blocked_crew_recall() {
        let sites = [
            ConstructionLaborSite {
                building_id: 10,
                priority: CONSTRUCTION_PRIORITY_LOW,
                assigned_labor: 4,
                max_labor: 4,
                work_ready: false,
                inbound_supply: false,
            },
            ConstructionLaborSite {
                building_id: 20,
                priority: CONSTRUCTION_PRIORITY_URGENT,
                assigned_labor: 0,
                max_labor: 4,
                work_ready: true,
                inbound_supply: false,
            },
        ];
        let rotation = construction_labor_rotation_with_reserve(&sites, 0, 2);
        assert_eq!(rotation.recalled_workers, 4);
        assert_eq!(rotation.called_workers, 2);
        assert_eq!(rotation.targets, vec![(10, 0), (20, 2)]);
    }

    #[test]
    fn large_rotation_stays_interactive() {
        let sites = (0..100_000u64)
            .map(|building_id| ConstructionLaborSite {
                building_id,
                priority: (building_id % 3 + 1) as u8,
                assigned_labor: if building_id % 2 == 0 { 4 } else { 0 },
                max_labor: 4,
                work_ready: building_id % 2 == 1,
                inbound_supply: false,
            })
            .collect::<Vec<_>>();
        let started = Instant::now();
        let rotation = construction_labor_rotation(&sites, 0);
        assert_eq!(rotation.recalled_workers, 200_000);
        assert_eq!(rotation.called_workers, 200_000);
        assert_eq!(rotation.targets.len(), 100_000);
        assert!(
            started.elapsed() < Duration::from_millis(250),
            "100k construction labor sites should remain comfortably interactive"
        );
    }
}
