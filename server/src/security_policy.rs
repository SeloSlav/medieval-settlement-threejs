use std::cmp::Ordering;
use std::collections::HashMap;

use crate::balance_generated::{
    GUARDHOUSE_FULL_MUSTER_ROAD_DISTANCE, GUARDHOUSE_LONG_MUSTER_EFFICIENCY,
    GUARDHOUSE_LONG_MUSTER_ROAD_DISTANCE, GUARDHOUSE_UNLINKED_MUSTER_EFFICIENCY,
};

pub const MIN_FRONTIER_POPULATION: u32 = 8;
pub const SECURITY_UPDATE_INTERVAL_TICKS: u64 = 300;
pub const RAID_SEASON_START_MONTH: u32 = 4;
pub const RAID_SEASON_END_MONTH: u32 = 10;
pub const WATCH_COVERAGE_CELL_SIZE: f64 = 128.0;
pub const CLOTH_RAID_VALUE_MULTIPLIER: f64 = 1.5;
pub const IRONWORK_RAID_VALUE_MULTIPLIER: f64 = 2.0;
pub const POLEARM_RAID_VALUE_MULTIPLIER: f64 = 4.0;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WatchArea {
    pub x: f64,
    pub z: f64,
    pub radius: f64,
}

/// Exact point-in-watch queries backed by coarse cells. Each tower is inserted
/// into every cell touched by its bounding square, then the final radius check
/// preserves the prior geometry without scanning distant towers.
pub struct WatchCoverageIndex {
    cells: HashMap<(i32, i32), Vec<WatchArea>>,
}

impl WatchCoverageIndex {
    pub fn new(areas: &[WatchArea]) -> Self {
        let mut cells: HashMap<(i32, i32), Vec<WatchArea>> = HashMap::new();
        for area in areas.iter().copied().filter(|area| {
            area.x.is_finite() && area.z.is_finite() && area.radius.is_finite() && area.radius > 0.0
        }) {
            let min_x = watch_cell(area.x - area.radius);
            let max_x = watch_cell(area.x + area.radius);
            let min_z = watch_cell(area.z - area.radius);
            let max_z = watch_cell(area.z + area.radius);
            for cell_x in min_x..=max_x {
                for cell_z in min_z..=max_z {
                    cells.entry((cell_x, cell_z)).or_default().push(area);
                }
            }
        }
        Self { cells }
    }

    pub fn contains(&self, x: f64, z: f64) -> bool {
        if !x.is_finite() || !z.is_finite() {
            return false;
        }
        self.cells
            .get(&(watch_cell(x), watch_cell(z)))
            .is_some_and(|areas| {
                areas.iter().any(|area| {
                    let dx = x - area.x;
                    let dz = z - area.z;
                    dx * dx + dz * dz <= area.radius * area.radius
                })
            })
    }
}

fn watch_cell(value: f64) -> i32 {
    (value / WATCH_COVERAGE_CELL_SIZE).floor() as i32
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum RaidTargetKind {
    Building,
    Residence,
    DeliveryTrip,
    TreasuryAtBuilding,
    TreasuryAtResidence,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RaidTargetCandidate {
    pub kind: RaidTargetKind,
    pub id: u64,
    pub protected: bool,
    pub value: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RaidForecast {
    pub guards_required: f64,
    pub defense_ratio: f64,
    pub target_count: usize,
    pub loss_fraction: f64,
}

/// Physical stock that raiders can carry away from one reached building.
///
/// Keeping valuation and removal on the same record prevents a commodity from
/// making a holding look attractive without being exposed to the resulting
/// loss. Stone and water are deliberately absent because an incursion cannot
/// practically carry them away.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct RaidPortableStores {
    pub timber: f64,
    pub firewood: f64,
    pub food: f64,
    pub grain: f64,
    pub flour: f64,
    pub ale: f64,
    pub preserved_food: f64,
    pub honey: f64,
    pub wine: f64,
    pub wool: f64,
    pub cloth: f64,
    pub ironwork: f64,
    pub polearms: f64,
    pub gold: f64,
    pub barley: f64,
    pub malt: f64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct RaidPlunder {
    pub remaining: RaidPortableStores,
    pub goods_lost: f64,
    pub wealth_lost: f64,
}

impl RaidPortableStores {
    pub fn raid_value(self) -> f64 {
        positive_store(self.timber)
            + positive_store(self.firewood)
            + positive_store(self.food)
            + positive_store(self.grain)
            + positive_store(self.flour)
            + positive_store(self.ale)
            + positive_store(self.preserved_food)
            + positive_store(self.honey)
            + positive_store(self.wine)
            + positive_store(self.wool)
            + positive_store(self.cloth) * CLOTH_RAID_VALUE_MULTIPLIER
            + positive_store(self.ironwork) * IRONWORK_RAID_VALUE_MULTIPLIER
            + positive_store(self.polearms) * POLEARM_RAID_VALUE_MULTIPLIER
            + positive_store(self.gold)
            + positive_store(self.barley)
            + positive_store(self.malt)
    }

    pub fn plunder(self, loss_fraction: f64) -> RaidPlunder {
        let fraction = if loss_fraction.is_finite() {
            loss_fraction.clamp(0.0, 1.0)
        } else {
            0.0
        };
        let mut remaining = self;
        let mut goods_lost = 0.0;

        macro_rules! plunder_good {
            ($field:ident) => {{
                let (stock_left, stock_lost) = plunder_store(self.$field, fraction);
                remaining.$field = stock_left;
                goods_lost += stock_lost;
            }};
        }

        plunder_good!(timber);
        plunder_good!(firewood);
        plunder_good!(food);
        plunder_good!(grain);
        plunder_good!(flour);
        plunder_good!(ale);
        plunder_good!(preserved_food);
        plunder_good!(honey);
        plunder_good!(wine);
        plunder_good!(wool);
        plunder_good!(cloth);
        plunder_good!(ironwork);
        plunder_good!(polearms);
        plunder_good!(barley);
        plunder_good!(malt);
        let (gold, wealth_lost) = plunder_store(self.gold, fraction);
        remaining.gold = gold;

        RaidPlunder {
            remaining,
            goods_lost,
            wealth_lost,
        }
    }
}

/// Relative warning coverage demand created by one building. Completed
/// holdings retain their ordinary structural exposure, while an unfinished
/// site matters only when portable stores are still physically present there.
/// This keeps empty construction sites out of frontier reports without making
/// reconstruction a way to hide stock from an incursion.
pub fn raid_holding_vulnerability(construction_complete: bool, portable_value: f64) -> f64 {
    let stored_exposure = positive_store(portable_value) / 30.0;
    if construction_complete {
        1.0 + stored_exposure
    } else {
        stored_exposure
    }
}

/// Only treasury timber not already promised to active construction can be
/// carried away. Reservations remain backed so a raid cannot leave a site
/// permanently waiting for material the authoritative queue still claims.
pub fn raidable_treasury_timber(timber: f64, reserved_timber: f64) -> f64 {
    (positive_store(timber) - positive_store(reserved_timber)).max(0.0)
}

fn positive_store(amount: f64) -> f64 {
    if amount.is_finite() {
        amount.max(0.0)
    } else {
        0.0
    }
}

fn plunder_store(amount: f64, fraction: f64) -> (f64, f64) {
    let stocked = positive_store(amount);
    let lost = stocked * fraction;
    ((stocked - lost).max(0.0), lost)
}

pub fn is_raid_season(month: u32) -> bool {
    (RAID_SEASON_START_MONTH..=RAID_SEASON_END_MONTH).contains(&month)
}

pub fn raid_interval_days(enemy_pressure: u8) -> f64 {
    let pressure = (enemy_pressure.min(100) as f64 / 100.0).max(0.01);
    20.0 - pressure * 12.0
}

pub fn first_raid_delay_days(enemy_pressure: u8) -> f64 {
    raid_interval_days(enemy_pressure) + 3.0
}

pub fn scheduled_raid_ticks(
    enemy_pressure: u8,
    ticks_per_day: u64,
    entropy: u64,
    first_raid: bool,
) -> u64 {
    let base_days = if first_raid {
        first_raid_delay_days(enemy_pressure)
    } else {
        raid_interval_days(enemy_pressure)
    };
    let jitter = 0.86 + unit_hash(entropy) * 0.28;
    (base_days * jitter * ticks_per_day as f64).round().max(1.0) as u64
}

pub fn threat_progress(last_raid_tick: u64, next_raid_tick: u64, sim_tick: u64) -> f64 {
    if next_raid_tick == 0 || next_raid_tick <= last_raid_tick {
        return 0.0;
    }
    let interval = next_raid_tick - last_raid_tick;
    let elapsed = sim_tick.saturating_sub(last_raid_tick);
    (elapsed as f64 / interval as f64).clamp(0.0, 1.0)
}

pub fn tower_effective_radius(work_radius: f64, assigned_labor: u32) -> f64 {
    match assigned_labor {
        0 => 0.0,
        1 => work_radius * 0.78,
        _ => work_radius,
    }
}

/// Converts a physical road route into the distance-equivalent response time
/// under current ground conditions. This preserves a full response for compact
/// defensive layouts while making long, softened tracks a seasonal liability.
pub fn guardhouse_muster_response_distance(
    road_distance: Option<f64>,
    road_speed_multiplier: f64,
) -> Option<f64> {
    let distance = road_distance
        .filter(|distance| distance.is_finite())?
        .max(0.0);
    let speed = if road_speed_multiplier.is_finite() && road_speed_multiplier > 0.0 {
        road_speed_multiplier.clamp(0.05, 1.0)
    } else {
        1.0
    };
    Some(distance / speed)
}

/// How much of a provisioned guard company can answer the watch in time.
/// Nearby road links give the full muster; long links retain a useful reserve,
/// while an unlinked company can only react locally after contact.
pub fn guardhouse_muster_efficiency(road_distance: Option<f64>, road_speed_multiplier: f64) -> f64 {
    let Some(distance) = guardhouse_muster_response_distance(road_distance, road_speed_multiplier)
    else {
        return GUARDHOUSE_UNLINKED_MUSTER_EFFICIENCY.clamp(0.0, 1.0);
    };
    if distance <= GUARDHOUSE_FULL_MUSTER_ROAD_DISTANCE {
        return 1.0;
    }
    if distance >= GUARDHOUSE_LONG_MUSTER_ROAD_DISTANCE {
        return GUARDHOUSE_LONG_MUSTER_EFFICIENCY.clamp(0.0, 1.0);
    }
    let span =
        (GUARDHOUSE_LONG_MUSTER_ROAD_DISTANCE - GUARDHOUSE_FULL_MUSTER_ROAD_DISTANCE).max(1e-9);
    let progress = (distance - GUARDHOUSE_FULL_MUSTER_ROAD_DISTANCE) / span;
    (1.0 + (GUARDHOUSE_LONG_MUSTER_EFFICIENCY - 1.0) * progress).clamp(0.0, 1.0)
}

pub fn raid_loss_fraction(enemy_pressure: u8, coverage: f64) -> f64 {
    let pressure = enemy_pressure.min(100) as f64 / 100.0;
    let exposed_loss = 0.12 + pressure * 0.2;
    (exposed_loss * (1.0 - coverage.clamp(0.0, 1.0) * 0.88)).clamp(0.0, 0.4)
}

pub fn raid_target_count(enemy_pressure: u8) -> usize {
    1 + enemy_pressure.min(100) as usize / 35
}

pub fn raid_strength(enemy_pressure: u8) -> f64 {
    2.5 + enemy_pressure.min(100) as f64 * 0.065
}

pub fn guards_required(enemy_pressure: u8, coverage: f64) -> f64 {
    let warning_multiplier = 0.65 + coverage.clamp(0.0, 1.0) * 0.35;
    raid_strength(enemy_pressure) / warning_multiplier
}

/// Guards fight most effectively when watch coverage gives them time to muster.
/// A ratio of one means the settlement can avert this incursion.
pub fn guard_defense_ratio(enemy_pressure: u8, coverage: f64, ready_guards: f64) -> f64 {
    (ready_guards.max(0.0) / guards_required(enemy_pressure, coverage)).clamp(0.0, 1.0)
}

pub fn guarded_raid_loss_fraction(enemy_pressure: u8, coverage: f64, ready_guards: f64) -> f64 {
    let defense = guard_defense_ratio(enemy_pressure, coverage, ready_guards);
    if defense >= 1.0 - 1e-9 {
        0.0
    } else {
        raid_loss_fraction(enemy_pressure, coverage) * (1.0 - defense * 0.8)
    }
}

pub fn guarded_raid_target_count(enemy_pressure: u8, defense_ratio: f64) -> usize {
    if defense_ratio >= 1.0 - 1e-9 {
        return 0;
    }
    ((raid_target_count(enemy_pressure) as f64) * (1.0 - defense_ratio * 0.65))
        .ceil()
        .max(1.0) as usize
}

pub fn raid_forecast(
    enemy_pressure: u8,
    coverage: f64,
    ready_guards: f64,
    available_targets: usize,
) -> RaidForecast {
    let defense_ratio = guard_defense_ratio(enemy_pressure, coverage, ready_guards);
    RaidForecast {
        guards_required: guards_required(enemy_pressure, coverage),
        defense_ratio,
        target_count: guarded_raid_target_count(enemy_pressure, defense_ratio)
            .min(available_targets),
        loss_fraction: guarded_raid_loss_fraction(enemy_pressure, coverage, ready_guards),
    }
}

/// Raiders who break through can put one reached holding to the torch. The
/// bounded chance keeps arson consequential without turning each incursion
/// into a settlement-wide fire roll; ready guards reduce both plunder and this
/// aftermath risk.
pub fn raid_arson_chance(enemy_pressure: u8, defense_ratio: f64) -> f64 {
    if enemy_pressure == 0 || defense_ratio >= 1.0 - 1e-9 {
        return 0.0;
    }
    let pressure = enemy_pressure.min(100) as f64 / 100.0;
    let undefended_chance = 0.06 + pressure * 0.18;
    (undefended_chance * (1.0 - defense_ratio.clamp(0.0, 1.0) * 0.8)).clamp(0.0, 0.24)
}

pub fn raid_arson_occurs(enemy_pressure: u8, defense_ratio: f64, entropy: u64) -> bool {
    unit_hash(entropy) < raid_arson_chance(enemy_pressure, defense_ratio)
}

pub fn select_raid_targets(
    candidates: &[RaidTargetCandidate],
    target_count: usize,
) -> Vec<RaidTargetCandidate> {
    let limit = target_count.min(candidates.len());
    let mut selected = Vec::with_capacity(limit);
    for candidate in candidates.iter().copied() {
        let insert_at = selected
            .iter()
            .position(|current| compare_raid_candidates(&candidate, current).is_lt())
            .unwrap_or(selected.len());
        if insert_at < limit {
            selected.insert(insert_at, candidate);
            selected.truncate(limit);
        } else if selected.len() < limit {
            selected.push(candidate);
        }
    }
    selected
}

fn compare_raid_candidates(a: &RaidTargetCandidate, b: &RaidTargetCandidate) -> Ordering {
    compare_raid_targets(a.protected, a.value, a.id, b.protected, b.value, b.id)
        .then_with(|| a.kind.cmp(&b.kind))
}

pub fn compare_raid_targets(
    a_protected: bool,
    a_value: f64,
    a_id: u64,
    b_protected: bool,
    b_value: f64,
    b_id: u64,
) -> Ordering {
    a_protected
        .cmp(&b_protected)
        .then_with(|| b_value.total_cmp(&a_value))
        .then_with(|| a_id.cmp(&b_id))
}

fn unit_hash(entropy: u64) -> f64 {
    let mut value = entropy.wrapping_add(0x9e37_79b9_7f4a_7c15);
    value = (value ^ (value >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    value = (value ^ (value >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    value ^= value >> 31;
    (value >> 11) as f64 / ((1u64 << 53) - 1) as f64
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::balance_generated::SPRING_RAIN_ROAD_SPEED_MULTIPLIER;

    #[test]
    fn winter_is_outside_the_raid_season() {
        assert!(!is_raid_season(1));
        assert!(is_raid_season(4));
        assert!(is_raid_season(10));
        assert!(!is_raid_season(12));
    }

    #[test]
    fn textile_stores_are_valued_and_physically_plundered() {
        let stores = RaidPortableStores {
            wool: 20.0,
            cloth: 10.0,
            ..RaidPortableStores::default()
        };
        assert_eq!(stores.raid_value(), 35.0);

        let plunder = stores.plunder(0.4);
        assert_eq!(plunder.remaining.wool, 12.0);
        assert_eq!(plunder.remaining.cloth, 6.0);
        assert_eq!(plunder.goods_lost, 12.0);
        assert_eq!(plunder.wealth_lost, 0.0);
    }

    #[test]
    fn reconstruction_keeps_stored_goods_exposed_without_counting_empty_sites() {
        assert_eq!(raid_holding_vulnerability(true, 0.0), 1.0);
        assert_eq!(raid_holding_vulnerability(true, 30.0), 2.0);
        assert_eq!(raid_holding_vulnerability(false, 0.0), 0.0);
        assert_eq!(raid_holding_vulnerability(false, 30.0), 1.0);
        assert_eq!(raid_holding_vulnerability(false, f64::NAN), 0.0);
    }

    #[test]
    fn construction_reservations_remain_backed_when_treasury_stores_are_raided() {
        assert_eq!(raidable_treasury_timber(80.0, 30.0), 50.0);
        assert_eq!(raidable_treasury_timber(20.0, 30.0), 0.0);
        assert_eq!(raidable_treasury_timber(f64::NAN, 10.0), 0.0);
        assert_eq!(raidable_treasury_timber(20.0, f64::NAN), 20.0);
    }

    #[test]
    fn raid_plunder_separates_goods_from_gold_and_clamps_the_loss() {
        let stores = RaidPortableStores {
            food: 8.0,
            polearms: 2.0,
            gold: 5.0,
            ..RaidPortableStores::default()
        };
        assert_eq!(stores.raid_value(), 21.0);

        let plunder = stores.plunder(1.5);
        assert_eq!(plunder.remaining, RaidPortableStores::default());
        assert_eq!(plunder.goods_lost, 10.0);
        assert_eq!(plunder.wealth_lost, 5.0);
    }

    #[test]
    fn higher_pressure_shortens_the_planning_window() {
        assert!(raid_interval_days(20) > raid_interval_days(50));
        assert!(raid_interval_days(50) > raid_interval_days(90));
        assert!(first_raid_delay_days(50) > raid_interval_days(50));
    }

    #[test]
    fn staffed_towers_gain_full_radius_with_a_second_watchman() {
        assert_eq!(tower_effective_radius(190.0, 0), 0.0);
        assert!((tower_effective_radius(190.0, 1) - 148.2).abs() < 1e-9);
        assert_eq!(tower_effective_radius(190.0, 2), 190.0);
    }

    #[test]
    fn watch_index_preserves_exact_radius_checks_across_negative_cells() {
        let areas = [
            WatchArea {
                x: -130.0,
                z: -20.0,
                radius: 148.2,
            },
            WatchArea {
                x: 190.0,
                z: 190.0,
                radius: 190.0,
            },
        ];
        let index = WatchCoverageIndex::new(&areas);
        for x in (-500..=500).step_by(17) {
            for z in (-500..=500).step_by(19) {
                let expected = areas.iter().any(|area| {
                    let dx = x as f64 - area.x;
                    let dz = z as f64 - area.z;
                    dx * dx + dz * dz <= area.radius * area.radius
                });
                assert_eq!(index.contains(x as f64, z as f64), expected);
            }
        }
        assert!(!index.contains(f64::NAN, 0.0));
    }

    #[test]
    fn watch_index_stays_bounded_with_many_holdings_and_towers() {
        let areas = (0..1_000)
            .map(|index| WatchArea {
                x: (index % 40) as f64 * 320.0,
                z: (index / 40) as f64 * 320.0,
                radius: 190.0,
            })
            .collect::<Vec<_>>();
        let started = std::time::Instant::now();
        let index = WatchCoverageIndex::new(&areas);
        let watched = (0..100_000)
            .filter(|holding| {
                index.contains(
                    (holding % 1_280) as f64 * 10.0,
                    (holding / 1_280) as f64 * 10.0,
                )
            })
            .count();
        assert!(watched > 0);
        assert!(
            started.elapsed() < std::time::Duration::from_millis(250),
            "1,000 towers and 100,000 holdings should use nearby watch buckets"
        );
    }

    #[test]
    fn road_linked_guard_companies_muster_more_effectively() {
        assert_eq!(guardhouse_muster_efficiency(Some(120.0), 1.0), 1.0);
        assert_eq!(
            guardhouse_muster_efficiency(Some(GUARDHOUSE_LONG_MUSTER_ROAD_DISTANCE), 1.0),
            GUARDHOUSE_LONG_MUSTER_EFFICIENCY
        );
        assert_eq!(
            guardhouse_muster_efficiency(None, SPRING_RAIN_ROAD_SPEED_MULTIPLIER),
            GUARDHOUSE_UNLINKED_MUSTER_EFFICIENCY
        );
        let middle = guardhouse_muster_efficiency(
            Some(
                (GUARDHOUSE_FULL_MUSTER_ROAD_DISTANCE + GUARDHOUSE_LONG_MUSTER_ROAD_DISTANCE) * 0.5,
            ),
            1.0,
        );
        assert!((middle - (1.0 + GUARDHOUSE_LONG_MUSTER_EFFICIENCY) * 0.5).abs() < 1e-9);
    }

    #[test]
    fn soft_roads_reward_compact_guardhouse_routes() {
        let spring_rain_speed = SPRING_RAIN_ROAD_SPEED_MULTIPLIER;
        assert_eq!(
            guardhouse_muster_response_distance(Some(190.0), spring_rain_speed),
            Some(190.0 / spring_rain_speed)
        );
        assert_eq!(
            guardhouse_muster_efficiency(Some(190.0), spring_rain_speed),
            1.0,
            "a genuinely compact route should retain its full muster"
        );
        assert!(
            guardhouse_muster_efficiency(
                Some(GUARDHOUSE_FULL_MUSTER_ROAD_DISTANCE),
                spring_rain_speed,
            ) < 1.0,
            "a route at the dry-weather limit should become delayed in rain"
        );
        assert_eq!(
            guardhouse_muster_efficiency(None, spring_rain_speed),
            GUARDHOUSE_UNLINKED_MUSTER_EFFICIENCY,
            "ground conditions must not double-penalize an already unlinked company"
        );
    }

    #[test]
    fn coverage_materially_reduces_plunder() {
        let exposed = raid_loss_fraction(50, 0.0);
        let guarded = raid_loss_fraction(50, 0.8);
        assert!(guarded < exposed * 0.4);
        assert!(raid_loss_fraction(90, 0.0) > exposed);
    }

    #[test]
    fn pressure_increases_the_number_of_exposed_targets() {
        assert_eq!(raid_target_count(10), 1);
        assert_eq!(raid_target_count(50), 2);
        assert_eq!(raid_target_count(90), 3);
    }

    #[test]
    fn paid_guards_and_warning_can_avert_a_mid_pressure_raid() {
        let uncovered = guard_defense_ratio(50, 0.0, 6.0);
        let warned = guard_defense_ratio(50, 1.0, 6.0);
        assert!(warned > uncovered);
        assert_eq!(warned, 1.0);
        assert_eq!(guarded_raid_loss_fraction(50, 1.0, 6.0), 0.0);
        assert_eq!(guarded_raid_target_count(50, warned), 0);
    }

    #[test]
    fn tower_warning_reduces_the_guard_requirement() {
        assert!(guards_required(65, 1.0) < guards_required(65, 0.0));
    }

    #[test]
    fn full_watch_coverage_without_guards_is_not_immunity() {
        let forecast = raid_forecast(50, 1.0, 0.0, 3);
        assert!(forecast.target_count > 0);
        assert!(forecast.loss_fraction > 0.0);
    }

    #[test]
    fn forecast_clamps_targets_to_real_holdings() {
        let forecast = raid_forecast(90, 0.0, 0.0, 1);
        assert_eq!(forecast.target_count, 1);
        assert!(forecast.loss_fraction > 0.0);
    }

    #[test]
    fn partial_guard_strength_reduces_but_does_not_erase_losses() {
        let unguarded = raid_loss_fraction(90, 0.25);
        let guarded = guarded_raid_loss_fraction(90, 0.25, 3.0);
        assert!(guarded > 0.0);
        assert!(guarded < unguarded);
    }

    #[test]
    fn guards_bound_raid_arson_without_making_an_undefended_frontier_safe() {
        assert_eq!(raid_arson_chance(0, 0.0), 0.0);
        assert_eq!(raid_arson_chance(100, 1.0), 0.0);
        assert!(raid_arson_chance(80, 0.0) > raid_arson_chance(30, 0.0));
        assert!(raid_arson_chance(80, 0.5) < raid_arson_chance(80, 0.0));
        assert!(raid_arson_chance(100, 0.0) <= 0.24);
    }

    #[test]
    fn raid_arson_roll_is_deterministic_and_remains_a_minority_outcome() {
        let outcomes = (0..10_000u64)
            .filter(|entropy| raid_arson_occurs(50, 0.0, *entropy))
            .count();
        assert_eq!(
            raid_arson_occurs(50, 0.0, 42),
            raid_arson_occurs(50, 0.0, 42)
        );
        assert!(
            (1_300..=1_700).contains(&outcomes),
            "mid-pressure undefended arson should stay near its 15% policy chance"
        );
    }

    #[test]
    fn exposed_high_value_targets_sort_first() {
        assert_eq!(
            compare_raid_targets(false, 10.0, 2, true, 100.0, 1),
            Ordering::Less
        );
        assert_eq!(
            compare_raid_targets(false, 10.0, 2, false, 5.0, 1),
            Ordering::Less
        );
    }

    #[test]
    fn watched_holdings_are_deprioritized_not_immune() {
        let targets = [
            RaidTargetCandidate {
                kind: RaidTargetKind::Building,
                id: 1,
                protected: true,
                value: 100.0,
            },
            RaidTargetCandidate {
                kind: RaidTargetKind::Residence,
                id: 2,
                protected: true,
                value: 50.0,
            },
        ];
        assert_eq!(select_raid_targets(&targets, 1), vec![targets[0]]);
    }

    #[test]
    fn one_target_budget_is_shared_across_stores_and_homes() {
        let exposed_home = RaidTargetCandidate {
            kind: RaidTargetKind::Residence,
            id: 2,
            protected: false,
            value: 40.0,
        };
        let targets = [
            RaidTargetCandidate {
                kind: RaidTargetKind::Building,
                id: 1,
                protected: false,
                value: 20.0,
            },
            exposed_home,
            RaidTargetCandidate {
                kind: RaidTargetKind::Building,
                id: 3,
                protected: true,
                value: 100.0,
            },
        ];
        assert_eq!(select_raid_targets(&targets, 1), vec![exposed_home]);
    }

    #[test]
    fn raid_selection_keeps_a_small_bounded_working_set() {
        let candidates = (0..100_000)
            .map(|id| RaidTargetCandidate {
                kind: if id % 2 == 0 {
                    RaidTargetKind::Building
                } else {
                    RaidTargetKind::Residence
                },
                id,
                protected: id % 3 == 0,
                value: id as f64,
            })
            .collect::<Vec<_>>();
        let started = std::time::Instant::now();
        let selected = select_raid_targets(&candidates, 3);
        assert_eq!(selected.len(), 3);
        assert!(selected.iter().all(|target| !target.protected));
        assert!(
            started.elapsed() < std::time::Duration::from_millis(250),
            "100,000 raid candidates should not require a full sort"
        );
    }
}
