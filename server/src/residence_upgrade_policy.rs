//! Pure policy for staged residence improvement works.

const EPSILON: f64 = 1e-6;

pub fn residence_project_active(
    target_tier: u8,
    current_tier: u8,
    backyard_project_kind: u8,
) -> bool {
    target_tier > current_tier || backyard_project_kind != 0
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ResidenceUpgradeWork {
    pub progress: f64,
    pub required_timber: f64,
    pub required_stone: f64,
    pub required_gold: f64,
    pub delivered_timber: f64,
    pub delivered_stone: f64,
    pub delivered_gold: f64,
    pub assigned_labor: u32,
}

fn nonnegative(value: f64) -> f64 {
    if value.is_finite() {
        value.max(0.0)
    } else {
        0.0
    }
}

pub fn residence_upgrade_household_contribution(household_wealth: f64, gold_cost: f64) -> f64 {
    nonnegative(household_wealth).min(nonnegative(gold_cost))
}

pub fn residence_upgrade_material_readiness(work: ResidenceUpgradeWork) -> f64 {
    let required = nonnegative(work.required_timber) + nonnegative(work.required_stone);
    if required <= EPSILON {
        return 1.0;
    }
    let delivered = nonnegative(work.delivered_timber) + nonnegative(work.delivered_stone);
    (delivered / required).clamp(0.0, 1.0)
}

pub fn residence_upgrade_is_paid(work: ResidenceUpgradeWork) -> bool {
    nonnegative(work.delivered_gold) + EPSILON >= nonnegative(work.required_gold)
}

pub fn advance_residence_upgrade(
    work: ResidenceUpgradeWork,
    elapsed_seconds: f64,
    work_per_worker_per_second: f64,
) -> f64 {
    let progress = nonnegative(work.progress).min(1.0);
    if work.assigned_labor == 0
        || !residence_upgrade_is_paid(work)
        || !elapsed_seconds.is_finite()
        || elapsed_seconds <= 0.0
    {
        return progress;
    }
    let structural_cost = nonnegative(work.required_timber) + nonnegative(work.required_stone);
    if structural_cost <= EPSILON {
        return 1.0;
    }
    let work_step =
        nonnegative(work_per_worker_per_second) * work.assigned_labor as f64 * elapsed_seconds
            / structural_cost;
    (progress + work_step)
        .min(residence_upgrade_material_readiness(work))
        .min(1.0)
}

pub fn residence_upgrade_complete(work: ResidenceUpgradeWork) -> bool {
    residence_upgrade_is_paid(work)
        && nonnegative(work.delivered_timber) + EPSILON >= nonnegative(work.required_timber)
        && nonnegative(work.delivered_stone) + EPSILON >= nonnegative(work.required_stone)
        && nonnegative(work.progress) >= 1.0 - EPSILON
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ready_work() -> ResidenceUpgradeWork {
        ResidenceUpgradeWork {
            progress: 0.0,
            required_timber: 18.0,
            required_stone: 14.0,
            required_gold: 8.0,
            delivered_timber: 18.0,
            delivered_stone: 14.0,
            delivered_gold: 8.0,
            assigned_labor: 1,
        }
    }

    #[test]
    fn household_coin_reduces_but_never_overpays_the_civic_grant() {
        assert_eq!(residence_upgrade_household_contribution(3.0, 8.0), 3.0);
        assert_eq!(residence_upgrade_household_contribution(20.0, 8.0), 8.0);
        assert_eq!(residence_upgrade_household_contribution(-2.0, 8.0), 0.0);
    }

    #[test]
    fn backyard_works_share_the_household_project_slot() {
        assert!(residence_project_active(2, 1, 0));
        assert!(residence_project_active(0, 1, 3));
        assert!(!residence_project_active(0, 1, 0));
    }

    #[test]
    fn unpaid_or_unstaffed_works_do_not_advance() {
        let mut work = ready_work();
        work.delivered_gold = 7.9;
        assert_eq!(advance_residence_upgrade(work, 1.0, 1.0), 0.0);
        work.delivered_gold = 8.0;
        work.assigned_labor = 0;
        assert_eq!(advance_residence_upgrade(work, 1.0, 1.0), 0.0);
    }

    #[test]
    fn work_cannot_run_ahead_of_delivered_structure() {
        let mut work = ready_work();
        work.delivered_timber = 9.0;
        work.delivered_stone = 7.0;
        assert_eq!(residence_upgrade_material_readiness(work), 0.5);
        assert_eq!(advance_residence_upgrade(work, 100.0, 1.0), 0.5);
        assert!(!residence_upgrade_complete(work));
    }

    #[test]
    fn fully_paid_supplied_work_completes_at_a_bounded_rate() {
        let work = ready_work();
        let halfway = advance_residence_upgrade(work, 16.0, 1.0);
        assert_eq!(halfway, 0.5);
        let completed = ResidenceUpgradeWork {
            progress: advance_residence_upgrade(
                ResidenceUpgradeWork {
                    progress: halfway,
                    ..work
                },
                16.0,
                1.0,
            ),
            ..work
        };
        assert!(residence_upgrade_complete(completed));
    }

    #[test]
    fn an_initial_cottage_needs_material_and_labor_but_no_coin() {
        let work = ResidenceUpgradeWork {
            progress: 0.0,
            required_timber: 8.0,
            required_stone: 12.0,
            required_gold: 0.0,
            delivered_timber: 8.0,
            delivered_stone: 12.0,
            delivered_gold: 0.0,
            assigned_labor: 1,
        };
        assert_eq!(advance_residence_upgrade(work, 10.0, 1.0), 0.5);
        assert!(!residence_upgrade_complete(work));
        assert!(residence_upgrade_complete(ResidenceUpgradeWork {
            progress: 1.0,
            ..work
        }));
    }
}
