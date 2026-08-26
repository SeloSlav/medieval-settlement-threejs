use std::cmp::Ordering;
use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::resource_units::whole_units;

use crate::balance_generated::{
    GUARDHOUSE_FULL_MUSTER_ROAD_DISTANCE, GUARDHOUSE_LONG_MUSTER_EFFICIENCY,
    GUARDHOUSE_LONG_MUSTER_ROAD_DISTANCE, GUARDHOUSE_UNLINKED_MUSTER_EFFICIENCY,
    PALISADED_REFUGE_RESIDENT_CAPACITY,
};
use crate::raid_agent_policy::{
    RAID_APPROACH_EAST, RAID_APPROACH_NORTH, RAID_APPROACH_SOUTH, RAID_APPROACH_WEST,
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
    pub source_id: u64,
    pub x: f64,
    pub z: f64,
    pub radius: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RaidWarningDetection {
    pub observation_tick: u64,
    /// Zero identifies an ordinary scout or traveler report. A non-zero value
    /// is the staffed watchtower that observed the planned approach lane.
    pub tower_id: u64,
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
        self.covering_areas(x, z).next().is_some()
    }

    /// Exact areas covering one point, drawn only from its coarse spatial cell.
    ///
    /// Refuge assignment uses the source ID and squared distance to choose one
    /// nearest enclosure without rescanning every refuge for every household.
    pub fn covering_areas(&self, x: f64, z: f64) -> impl Iterator<Item = &WatchArea> {
        let areas = if x.is_finite() && z.is_finite() {
            self.cells.get(&(watch_cell(x), watch_cell(z)))
        } else {
            None
        };
        areas.into_iter().flatten().filter(move |area| {
            let dx = x - area.x;
            let dz = z - area.z;
            dx * dx + dz * dz <= area.radius * area.radius
        })
    }

    /// Effective guards assigned to every watch district covering this point.
    ///
    /// Each company belongs to one nearest road-linked tower, so overlapping
    /// warning circles may combine distinct companies without counting any
    /// one company twice.
    pub fn defended_readiness(
        &self,
        x: f64,
        z: f64,
        readiness_by_watch: &HashMap<u64, f64>,
    ) -> f64 {
        self.covering_areas(x, z)
            .map(|area| {
                readiness_by_watch
                    .get(&area.source_id)
                    .copied()
                    .unwrap_or(0.0)
                    .max(0.0)
            })
            .sum::<f64>()
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

impl RaidTargetKind {
    pub fn as_u8(self) -> u8 {
        match self {
            Self::Building => 0,
            Self::Residence => 1,
            Self::DeliveryTrip => 2,
            Self::TreasuryAtBuilding => 3,
            Self::TreasuryAtResidence => 4,
        }
    }

    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            0 => Some(Self::Building),
            1 => Some(Self::Residence),
            2 => Some(Self::DeliveryTrip),
            3 => Some(Self::TreasuryAtBuilding),
            4 => Some(Self::TreasuryAtResidence),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RaidTargetCandidate {
    pub kind: RaidTargetKind,
    pub id: u64,
    pub protected: bool,
    pub sheltered: bool,
    pub value: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RaidForecast {
    pub guards_required: f64,
    pub defense_ratio: f64,
    pub target_count: usize,
    pub loss_fraction: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RaidTargetDefenseCandidate {
    pub target: RaidTargetCandidate,
    pub local_ready_guards: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RaidTargetOutcome {
    pub target: RaidTargetCandidate,
    pub local_ready_guards: f64,
    pub guards_required: f64,
    pub defense_ratio: f64,
    pub loss_fraction: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct RaidDistrictForecast {
    pub frontline_ready_guards: f64,
    pub forecast: RaidForecast,
    pub selected: Vec<RaidTargetOutcome>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RefugeHouseholdCandidate {
    pub residence_id: u64,
    pub refuge_id: u64,
    pub residents: u32,
    pub distance_squared: f64,
}

/// Assign whole warned households to the nearest refuge with room.
///
/// A household first tries its closest enclosure and may overflow to another
/// overlapping refuge when the nearer yard is already full. Stable IDs settle
/// exact spatial ties. Whole-household admission keeps the raid loss rule
/// legible: a family's coin is either carried inside or remains at home.
pub fn assign_refuge_households(
    mut candidates: Vec<RefugeHouseholdCandidate>,
) -> HashMap<u64, u64> {
    candidates.retain(|candidate| {
        candidate.residents > 0
            && candidate.residents <= PALISADED_REFUGE_RESIDENT_CAPACITY
            && candidate.distance_squared.is_finite()
            && candidate.distance_squared >= 0.0
    });
    candidates.sort_by(|left, right| {
        left.distance_squared
            .total_cmp(&right.distance_squared)
            .then_with(|| left.residence_id.cmp(&right.residence_id))
            .then_with(|| left.refuge_id.cmp(&right.refuge_id))
    });

    let mut assignments = HashMap::new();
    let mut residents_by_refuge: HashMap<u64, u32> = HashMap::new();
    for candidate in candidates {
        if assignments.contains_key(&candidate.residence_id) {
            continue;
        }
        let occupied = residents_by_refuge
            .get(&candidate.refuge_id)
            .copied()
            .unwrap_or(0);
        let Some(next_occupied) = occupied.checked_add(candidate.residents) else {
            continue;
        };
        if next_occupied > PALISADED_REFUGE_RESIDENT_CAPACITY {
            continue;
        }
        residents_by_refuge.insert(candidate.refuge_id, next_occupied);
        assignments.insert(candidate.residence_id, candidate.refuge_id);
    }
    assignments
}

/// Physical stock that raiders can carry away from one reached building.
///
/// Keeping valuation and removal on the same record prevents a commodity from
/// making a holding look attractive without being exposed to the resulting
/// loss. Stone and water are deliberately absent because an incursion cannot
/// practically carry them away.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct RaidPortableStores {
    pub timber: f64,
    pub firewood: f64,
    pub food: f64,
    pub rye_sheaves: f64,
    pub oat_sheaves: f64,
    pub barley_sheaves: f64,
    pub maslin_sheaves: f64,
    pub rye_grain: f64,
    pub oat_grain: f64,
    pub animal_feed: f64,
    pub maslin_grain: f64,
    pub rye_flour: f64,
    pub maslin_flour: f64,
    pub rye_bread: f64,
    pub maslin_bread: f64,
    pub ale: f64,
    pub cider: f64,
    pub pear_cider: f64,
    pub mead: f64,
    pub preserved_food: f64,
    pub honey: f64,
    pub wax: f64,
    pub candles: f64,
    pub wine: f64,
    pub wool: f64,
    pub cloth: f64,
    pub pelts: f64,
    pub yarn: f64,
    pub linen: f64,
    pub hides: f64,
    pub leather: f64,
    pub shoes: f64,
    pub ironwork: f64,
    pub polearms: f64,
    pub gold: f64,
    pub barley: f64,
    pub malt: f64,
    pub flax: f64,
    pub iron: f64,
    pub clay: f64,
    pub salt: f64,
    pub charcoal: f64,
    pub pottery: f64,
    pub roof_tiles: f64,
    pub remedies: f64,
    pub meat: f64,
    pub fish: f64,
    pub berries: f64,
    pub mushrooms: f64,
    pub milk: f64,
    pub apples: f64,
    pub cherries: f64,
    pub vegetables: f64,
    pub eggs: f64,
    pub grapes: f64,
    pub cured_meat: f64,
    pub smoked_fish: f64,
    pub cheese: f64,
    pub pears: f64,
    pub aronia: f64,
    pub rosehips: f64,
    pub cabbage: f64,
    pub carrots: f64,
    pub beetroot: f64,
    pub aronia_jam: f64,
    pub rosehip_jam: f64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct RaidPlunder {
    pub remaining: RaidPortableStores,
    pub goods_lost: f64,
    pub wealth_lost: f64,
}

impl RaidPortableStores {
    /// Canonicalize persisted or newly assembled raid cargo at the boundary.
    ///
    /// Save-compatible table columns and JSON values remain `f64`, but every
    /// physical commodity represented here is an indivisible, non-negative
    /// unit. Keeping this operation on the record itself prevents one mapping
    /// path from accidentally preserving a legacy fraction.
    pub fn normalized_whole(mut self) -> Self {
        macro_rules! normalize {
            ($($field:ident),+ $(,)?) => {
                $(self.$field = whole_units(self.$field);)+
            };
        }
        normalize!(
            timber,
            firewood,
            food,
            rye_sheaves,
            oat_sheaves,
            barley_sheaves,
            maslin_sheaves,
            rye_grain,
            oat_grain,
            animal_feed,
            maslin_grain,
            rye_flour,
            maslin_flour,
            rye_bread,
            maslin_bread,
            ale,
            cider,
            pear_cider,
            mead,
            preserved_food,
            honey,
            wax,
            candles,
            wine,
            wool,
            cloth,
            pelts,
            yarn,
            linen,
            hides,
            leather,
            shoes,
            ironwork,
            polearms,
            gold,
            barley,
            malt,
            flax,
            iron,
            clay,
            salt,
            charcoal,
            pottery,
            roof_tiles,
            remedies,
            meat,
            fish,
            berries,
            mushrooms,
            milk,
            apples,
            cherries,
            vegetables,
            eggs,
            grapes,
            cured_meat,
            smoked_fish,
            cheese,
            pears,
            aronia,
            rosehips,
            cabbage,
            carrots,
            beetroot,
            aronia_jam,
            rosehip_jam,
        );
        self
    }

    pub fn raid_value(self) -> f64 {
        positive_store(self.timber)
            + positive_store(self.firewood)
            + positive_store(self.food)
            + positive_store(self.rye_sheaves)
            + positive_store(self.oat_sheaves)
            + positive_store(self.barley_sheaves)
            + positive_store(self.maslin_sheaves)
            + positive_store(self.rye_grain)
            + positive_store(self.oat_grain)
            + positive_store(self.animal_feed)
            + positive_store(self.maslin_grain)
            + positive_store(self.rye_flour)
            + positive_store(self.maslin_flour)
            + positive_store(self.rye_bread)
            + positive_store(self.maslin_bread)
            + positive_store(self.ale)
            + positive_store(self.cider)
            + positive_store(self.pear_cider)
            + positive_store(self.mead)
            + positive_store(self.preserved_food)
            + positive_store(self.honey)
            + positive_store(self.wax) * 1.5
            + positive_store(self.candles) * 2.0
            + positive_store(self.wine)
            + positive_store(self.wool)
            + positive_store(self.cloth) * CLOTH_RAID_VALUE_MULTIPLIER
            + positive_store(self.pelts)
            + positive_store(self.yarn)
            + positive_store(self.linen) * CLOTH_RAID_VALUE_MULTIPLIER
            + positive_store(self.hides)
            + positive_store(self.leather) * CLOTH_RAID_VALUE_MULTIPLIER
            + positive_store(self.shoes) * IRONWORK_RAID_VALUE_MULTIPLIER
            + positive_store(self.ironwork) * IRONWORK_RAID_VALUE_MULTIPLIER
            + positive_store(self.polearms) * POLEARM_RAID_VALUE_MULTIPLIER
            + positive_store(self.gold)
            + positive_store(self.barley)
            + positive_store(self.malt)
            + positive_store(self.flax)
            + positive_store(self.iron) * IRONWORK_RAID_VALUE_MULTIPLIER
            + positive_store(self.clay)
            + positive_store(self.salt) * 1.5
            + positive_store(self.charcoal)
            + positive_store(self.pottery) * 1.25
            + positive_store(self.roof_tiles)
            + positive_store(self.remedies) * 1.25
            + positive_store(self.meat)
            + positive_store(self.fish)
            + positive_store(self.berries)
            + positive_store(self.mushrooms)
            + positive_store(self.milk)
            + positive_store(self.apples)
            + positive_store(self.cherries)
            + positive_store(self.vegetables)
            + positive_store(self.eggs)
            + positive_store(self.grapes)
            + positive_store(self.cured_meat)
            + positive_store(self.smoked_fish)
            + positive_store(self.cheese)
            + positive_store(self.pears)
            + positive_store(self.aronia)
            + positive_store(self.rosehips)
            + positive_store(self.cabbage)
            + positive_store(self.carrots)
            + positive_store(self.beetroot)
            + positive_store(self.aronia_jam)
            + positive_store(self.rosehip_jam)
    }

    pub fn goods_amount(self) -> f64 {
        positive_store(self.timber)
            + positive_store(self.firewood)
            + positive_store(self.food)
            + positive_store(self.rye_sheaves)
            + positive_store(self.oat_sheaves)
            + positive_store(self.barley_sheaves)
            + positive_store(self.maslin_sheaves)
            + positive_store(self.rye_grain)
            + positive_store(self.oat_grain)
            + positive_store(self.animal_feed)
            + positive_store(self.maslin_grain)
            + positive_store(self.rye_flour)
            + positive_store(self.maslin_flour)
            + positive_store(self.rye_bread)
            + positive_store(self.maslin_bread)
            + positive_store(self.ale)
            + positive_store(self.cider)
            + positive_store(self.pear_cider)
            + positive_store(self.mead)
            + positive_store(self.preserved_food)
            + positive_store(self.honey)
            + positive_store(self.wax)
            + positive_store(self.candles)
            + positive_store(self.wine)
            + positive_store(self.wool)
            + positive_store(self.cloth)
            + positive_store(self.pelts)
            + positive_store(self.yarn)
            + positive_store(self.linen)
            + positive_store(self.hides)
            + positive_store(self.leather)
            + positive_store(self.shoes)
            + positive_store(self.ironwork)
            + positive_store(self.polearms)
            + positive_store(self.barley)
            + positive_store(self.malt)
            + positive_store(self.flax)
            + positive_store(self.iron)
            + positive_store(self.clay)
            + positive_store(self.salt)
            + positive_store(self.charcoal)
            + positive_store(self.pottery)
            + positive_store(self.roof_tiles)
            + positive_store(self.remedies)
            + positive_store(self.meat)
            + positive_store(self.fish)
            + positive_store(self.berries)
            + positive_store(self.mushrooms)
            + positive_store(self.milk)
            + positive_store(self.apples)
            + positive_store(self.cherries)
            + positive_store(self.vegetables)
            + positive_store(self.eggs)
            + positive_store(self.grapes)
            + positive_store(self.cured_meat)
            + positive_store(self.smoked_fish)
            + positive_store(self.cheese)
            + positive_store(self.pears)
            + positive_store(self.aronia)
            + positive_store(self.rosehips)
            + positive_store(self.cabbage)
            + positive_store(self.carrots)
            + positive_store(self.beetroot)
            + positive_store(self.aronia_jam)
            + positive_store(self.rosehip_jam)
    }

    pub fn plunder(self, loss_fraction: f64) -> RaidPlunder {
        let fraction = if loss_fraction.is_finite() {
            loss_fraction.clamp(0.0, 1.0)
        } else {
            0.0
        };
        let source = self.normalized_whole();
        let mut remaining = source;
        let mut goods_lost = 0.0;

        macro_rules! plunder_good {
            ($field:ident) => {{
                let (stock_left, stock_lost) = plunder_store(source.$field, fraction);
                remaining.$field = stock_left;
                goods_lost += stock_lost;
            }};
        }

        plunder_good!(timber);
        plunder_good!(firewood);
        plunder_good!(food);
        plunder_good!(rye_sheaves);
        plunder_good!(oat_sheaves);
        plunder_good!(barley_sheaves);
        plunder_good!(maslin_sheaves);
        plunder_good!(rye_grain);
        plunder_good!(oat_grain);
        plunder_good!(animal_feed);
        plunder_good!(maslin_grain);
        plunder_good!(rye_flour);
        plunder_good!(maslin_flour);
        plunder_good!(rye_bread);
        plunder_good!(maslin_bread);
        plunder_good!(ale);
        plunder_good!(cider);
        plunder_good!(pear_cider);
        plunder_good!(mead);
        plunder_good!(preserved_food);
        plunder_good!(honey);
        plunder_good!(wax);
        plunder_good!(candles);
        plunder_good!(wine);
        plunder_good!(wool);
        plunder_good!(cloth);
        plunder_good!(pelts);
        plunder_good!(yarn);
        plunder_good!(linen);
        plunder_good!(hides);
        plunder_good!(leather);
        plunder_good!(shoes);
        plunder_good!(ironwork);
        plunder_good!(polearms);
        plunder_good!(barley);
        plunder_good!(malt);
        plunder_good!(flax);
        plunder_good!(iron);
        plunder_good!(clay);
        plunder_good!(salt);
        plunder_good!(charcoal);
        plunder_good!(pottery);
        plunder_good!(roof_tiles);
        plunder_good!(remedies);
        plunder_good!(meat);
        plunder_good!(fish);
        plunder_good!(berries);
        plunder_good!(mushrooms);
        plunder_good!(milk);
        plunder_good!(apples);
        plunder_good!(cherries);
        plunder_good!(vegetables);
        plunder_good!(eggs);
        plunder_good!(grapes);
        plunder_good!(cured_meat);
        plunder_good!(smoked_fish);
        plunder_good!(cheese);
        plunder_good!(pears);
        plunder_good!(aronia);
        plunder_good!(rosehips);
        plunder_good!(cabbage);
        plunder_good!(carrots);
        plunder_good!(beetroot);
        plunder_good!(aronia_jam);
        plunder_good!(rosehip_jam);
        let (gold, wealth_lost) = plunder_store(source.gold, fraction);
        remaining.gold = gold;

        RaidPlunder {
            remaining,
            goods_lost,
            wealth_lost,
        }
    }

    pub fn removed_between(self, remaining: Self) -> Self {
        macro_rules! removed {
            ($field:ident) => {
                (positive_store(self.$field) - positive_store(remaining.$field)).max(0.0)
            };
        }
        Self {
            timber: removed!(timber),
            firewood: removed!(firewood),
            food: removed!(food),
            rye_sheaves: removed!(rye_sheaves),
            oat_sheaves: removed!(oat_sheaves),
            barley_sheaves: removed!(barley_sheaves),
            maslin_sheaves: removed!(maslin_sheaves),
            rye_grain: removed!(rye_grain),
            oat_grain: removed!(oat_grain),
            animal_feed: removed!(animal_feed),
            maslin_grain: removed!(maslin_grain),
            rye_flour: removed!(rye_flour),
            maslin_flour: removed!(maslin_flour),
            rye_bread: removed!(rye_bread),
            maslin_bread: removed!(maslin_bread),
            ale: removed!(ale),
            cider: removed!(cider),
            pear_cider: removed!(pear_cider),
            mead: removed!(mead),
            preserved_food: removed!(preserved_food),
            honey: removed!(honey),
            wax: removed!(wax),
            candles: removed!(candles),
            wine: removed!(wine),
            wool: removed!(wool),
            cloth: removed!(cloth),
            pelts: removed!(pelts),
            yarn: removed!(yarn),
            linen: removed!(linen),
            hides: removed!(hides),
            leather: removed!(leather),
            shoes: removed!(shoes),
            ironwork: removed!(ironwork),
            polearms: removed!(polearms),
            gold: removed!(gold),
            barley: removed!(barley),
            malt: removed!(malt),
            flax: removed!(flax),
            iron: removed!(iron),
            clay: removed!(clay),
            salt: removed!(salt),
            charcoal: removed!(charcoal),
            pottery: removed!(pottery),
            roof_tiles: removed!(roof_tiles),
            remedies: removed!(remedies),
            meat: removed!(meat),
            fish: removed!(fish),
            berries: removed!(berries),
            mushrooms: removed!(mushrooms),
            milk: removed!(milk),
            apples: removed!(apples),
            cherries: removed!(cherries),
            vegetables: removed!(vegetables),
            eggs: removed!(eggs),
            grapes: removed!(grapes),
            cured_meat: removed!(cured_meat),
            smoked_fish: removed!(smoked_fish),
            cheese: removed!(cheese),
            pears: removed!(pears),
            aronia: removed!(aronia),
            rosehips: removed!(rosehips),
            cabbage: removed!(cabbage),
            carrots: removed!(carrots),
            beetroot: removed!(beetroot),
            aronia_jam: removed!(aronia_jam),
            rosehip_jam: removed!(rosehip_jam),
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

/// The one-time settlement bootstrap must never become an incursion target.
/// Keeping this as an explicit invariant prevents balance changes or newly
/// added portable commodities from making the founding camp raidable.
pub fn raid_immune_building_kind(kind: &str) -> bool {
    kind == "founders_camp"
}

/// Only treasury timber not already promised to active construction can be
/// carried away. Reservations remain backed so a raid cannot leave a site
/// permanently waiting for material the authoritative queue still claims.
pub fn raidable_treasury_timber(timber: f64, reserved_timber: f64) -> f64 {
    (positive_store(timber) - positive_store(reserved_timber)).max(0.0)
}

fn positive_store(amount: f64) -> f64 {
    whole_units(amount)
}

fn plunder_store(amount: f64, fraction: f64) -> (f64, f64) {
    let stocked = positive_store(amount);
    let lost = whole_units(stocked * fraction.clamp(0.0, 1.0)).min(stocked);
    (stocked - lost, lost)
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

/// Chance that ordinary patrols, hunters, or travelers notice a party before
/// it reaches the map. Bigger groups are harder to conceal. This is the
/// deliberately fallible baseline; a staffed tower whose effective sight
/// radius reaches the actual approach lane detects it reliably.
pub fn raid_scout_detection_chance(raider_count: u32) -> f64 {
    (0.055 + raider_count.min(12) as f64 * 0.049).clamp(0.0, 0.66)
}

/// Chooses the earliest successful warning source for one already-scheduled
/// approach. Towers on the wrong frontier—or too far inland for their sight
/// radius to reach the entry lane—contribute nothing. An outward tower reports
/// earlier, while two watchmen matter through their larger effective radius.
pub fn raid_warning_detection(
    next_raid_tick: u64,
    ticks_per_day: u64,
    raider_count: u32,
    approach: u8,
    entry_x: f64,
    entry_z: f64,
    playable_half: f64,
    entropy: u64,
    towers: &[WatchArea],
) -> Option<RaidWarningDetection> {
    if next_raid_tick == 0
        || ticks_per_day == 0
        || raider_count == 0
        || !entry_x.is_finite()
        || !entry_z.is_finite()
        || !playable_half.is_finite()
    {
        return None;
    }

    let party_visibility = ((raider_count.clamp(3, 12) - 3) as f64 / 9.0).clamp(0.0, 1.0);
    let mut detection = (unit_hash(entropy ^ 0x6a09_e667_f3bc_c909)
        < raid_scout_detection_chance(raider_count))
    .then(|| RaidWarningDetection {
        observation_tick: warning_tick(
            next_raid_tick,
            ticks_per_day,
            0.45 + party_visibility * 0.8,
        ),
        tower_id: 0,
    });

    let limit = (playable_half - crate::raid_agent_policy::MAP_EDGE_INSET_METERS).max(40.0);
    for tower in towers.iter().copied().filter(|tower| {
        tower.source_id > 0
            && tower.x.is_finite()
            && tower.z.is_finite()
            && tower.radius.is_finite()
            && tower.radius > 0.0
    }) {
        let outwardness = match approach {
            RAID_APPROACH_NORTH => -tower.z / limit,
            RAID_APPROACH_EAST => tower.x / limit,
            RAID_APPROACH_SOUTH => tower.z / limit,
            RAID_APPROACH_WEST => -tower.x / limit,
            _ => continue,
        }
        .clamp(0.0, 1.0);
        if outwardness <= 0.05 {
            continue;
        }
        let dx = tower.x - entry_x;
        let dz = tower.z - entry_z;
        if dx * dx + dz * dz > tower.radius * tower.radius {
            continue;
        }

        let candidate = RaidWarningDetection {
            observation_tick: warning_tick(
                next_raid_tick,
                ticks_per_day,
                0.75 + outwardness * 3.0 + party_visibility * 0.5,
            ),
            tower_id: tower.source_id,
        };
        if detection.is_none_or(|current| {
            candidate.observation_tick < current.observation_tick
                || (candidate.observation_tick == current.observation_tick && current.tower_id == 0)
        }) {
            detection = Some(candidate);
        }
    }
    detection
}

fn warning_tick(next_raid_tick: u64, ticks_per_day: u64, lead_days: f64) -> u64 {
    let lead_ticks = (lead_days.max(0.0) * ticks_per_day as f64).round().max(1.0) as u64;
    next_raid_tick.saturating_sub(lead_ticks)
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

/// Resolves a company's road-linked watch order without hiding a broken
/// explicit deployment behind automatic reassignment. Zero means nearest
/// reachable staffed watch; a non-zero post must itself be present and
/// reachable. Stable watch identity resolves equal automatic routes.
pub fn select_guardhouse_muster_watch(
    ordered_watchtower_id: u64,
    watchtower_ids: &[u64],
    road_distances: &[Option<f64>],
) -> Option<(usize, f64)> {
    if ordered_watchtower_id != 0 {
        let index = watchtower_ids
            .iter()
            .position(|watchtower_id| *watchtower_id == ordered_watchtower_id)?;
        let distance = road_distances
            .get(index)
            .copied()
            .flatten()
            .filter(|distance| distance.is_finite())?
            .max(0.0);
        return Some((index, distance));
    }

    watchtower_ids
        .iter()
        .enumerate()
        .filter_map(|(index, watchtower_id)| {
            road_distances
                .get(index)
                .copied()
                .flatten()
                .filter(|distance| distance.is_finite())
                .map(|distance| (index, *watchtower_id, distance.max(0.0)))
        })
        .min_by(|left, right| {
            left.2
                .total_cmp(&right.2)
                .then_with(|| left.1.cmp(&right.1))
        })
        .map(|(index, _, distance)| (index, distance))
}

pub fn projected_raid_loss_fraction(enemy_pressure: u8, coverage: f64) -> f64 {
    let pressure = enemy_pressure.min(100) as f64 / 100.0;
    let exposed_loss = 0.12 + pressure * 0.2;
    (exposed_loss * (1.0 - coverage.clamp(0.0, 1.0) * 0.88)).clamp(0.0, 0.4)
}

/// Maximum portable share a full hostile party can carry away after actually
/// reaching and completing contact at its target. Watches and guard forecasts
/// never reduce this value: they must stop raiders through the live simulation.
pub fn raid_contact_loss_fraction(enemy_pressure: u8) -> f64 {
    projected_raid_loss_fraction(enemy_pressure, 0.0)
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

/// Planning estimate for whether watch-linked companies can intercept before
/// contact. The live agents, rather than this ratio, resolve an actual raid.
pub fn guard_defense_ratio(enemy_pressure: u8, coverage: f64, ready_guards: f64) -> f64 {
    (ready_guards.max(0.0) / guards_required(enemy_pressure, coverage)).clamp(0.0, 1.0)
}

pub fn projected_guarded_raid_loss_fraction(
    enemy_pressure: u8,
    coverage: f64,
    ready_guards: f64,
) -> f64 {
    let defense = guard_defense_ratio(enemy_pressure, coverage, ready_guards);
    if defense >= 1.0 - 1e-9 {
        0.0
    } else {
        projected_raid_loss_fraction(enemy_pressure, coverage) * (1.0 - defense * 0.8)
    }
}

pub fn raid_target_can_shelter(
    kind: RaidTargetKind,
    watched: bool,
    within_refuge_reach: bool,
) -> bool {
    kind == RaidTargetKind::Residence && watched && within_refuge_reach
}

pub fn guarded_raid_target_count(enemy_pressure: u8, defense_ratio: f64) -> usize {
    if defense_ratio >= 1.0 - 1e-9 {
        return 0;
    }
    ((raid_target_count(enemy_pressure) as f64) * (1.0 - defense_ratio * 0.65))
        .ceil()
        .max(1.0) as usize
}

#[cfg(test)]
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
        loss_fraction: projected_guarded_raid_loss_fraction(enemy_pressure, coverage, ready_guards),
    }
}

/// Evaluate the actual watch district that can answer each physical holding.
///
/// A provisioned company is assigned to one nearest road-linked watchtower by
/// the simulation. Only that tower's warning area receives its effective
/// strength. The bounded selector then prefers the holdings with the greatest
/// remaining loss, so a fully defended central district cannot hide an
/// undefended satellite branch behind a settlement-wide guard total.
pub fn raid_district_forecast(
    enemy_pressure: u8,
    candidates: &[RaidTargetDefenseCandidate],
) -> RaidDistrictForecast {
    if candidates.is_empty() {
        return RaidDistrictForecast {
            frontline_ready_guards: 0.0,
            forecast: RaidForecast {
                guards_required: 0.0,
                defense_ratio: 0.0,
                target_count: 0,
                loss_fraction: 0.0,
            },
            selected: Vec::new(),
        };
    }

    let base_limit = raid_target_count(enemy_pressure).min(candidates.len());
    let mut highest_risk = Vec::with_capacity(base_limit);
    for candidate in candidates {
        let coverage = if candidate.target.protected { 1.0 } else { 0.0 };
        let local_ready_guards = if candidate.target.protected {
            candidate.local_ready_guards.max(0.0)
        } else {
            0.0
        };
        let required = guards_required(enemy_pressure, coverage);
        let defense_ratio = guard_defense_ratio(enemy_pressure, coverage, local_ready_guards);
        let outcome = RaidTargetOutcome {
            target: candidate.target,
            local_ready_guards,
            guards_required: required,
            defense_ratio,
            loss_fraction: projected_guarded_raid_loss_fraction(
                enemy_pressure,
                coverage,
                local_ready_guards,
            ),
        };
        let insert_at = highest_risk
            .iter()
            .position(|current| compare_raid_target_outcomes(&outcome, current).is_lt())
            .unwrap_or(highest_risk.len());
        if insert_at < base_limit {
            highest_risk.insert(insert_at, outcome);
            highest_risk.truncate(base_limit);
        } else if highest_risk.len() < base_limit {
            highest_risk.push(outcome);
        }
    }

    let Some(frontline) = highest_risk.first().copied() else {
        return RaidDistrictForecast {
            frontline_ready_guards: 0.0,
            forecast: RaidForecast {
                guards_required: 0.0,
                defense_ratio: 0.0,
                target_count: 0,
                loss_fraction: 0.0,
            },
            selected: Vec::new(),
        };
    };
    let target_limit =
        guarded_raid_target_count(enemy_pressure, frontline.defense_ratio).min(highest_risk.len());
    highest_risk.truncate(target_limit);
    highest_risk.retain(|outcome| outcome.loss_fraction > 1e-9);
    let loss_fraction = highest_risk
        .first()
        .map(|outcome| outcome.loss_fraction)
        .unwrap_or(0.0);
    let target_count = highest_risk.len();

    RaidDistrictForecast {
        frontline_ready_guards: frontline.local_ready_guards,
        forecast: RaidForecast {
            guards_required: frontline.guards_required,
            defense_ratio: frontline.defense_ratio,
            target_count,
            loss_fraction,
        },
        selected: highest_risk,
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

fn compare_raid_target_outcomes(a: &RaidTargetOutcome, b: &RaidTargetOutcome) -> Ordering {
    b.loss_fraction
        .total_cmp(&a.loss_fraction)
        .then_with(|| compare_raid_candidates(&a.target, &b.target))
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
    fn portable_drinks_leather_goods_and_tiles_are_not_hidden_from_raids() {
        let stores = RaidPortableStores {
            mead: 2.0,
            hides: 3.0,
            leather: 4.0,
            shoes: 5.0,
            roof_tiles: 6.0,
            ..RaidPortableStores::default()
        };
        assert_eq!(stores.goods_amount(), 20.0);
        assert_eq!(stores.raid_value(), 27.0);

        let plunder = stores.plunder(1.0);
        assert_eq!(plunder.remaining, RaidPortableStores::default());
        assert_eq!(plunder.goods_lost, 20.0);
    }

    #[test]
    fn portable_store_json_defaults_new_fields_and_normalizes_legacy_fractions() {
        let legacy: RaidPortableStores =
            serde_json::from_str(r#"{"ale":2.8,"hides":-1.0}"#).expect("legacy raid cargo");
        assert_eq!(legacy.mead, 0.0);
        assert_eq!(legacy.leather, 0.0);

        let normalized = legacy.normalized_whole();
        assert_eq!(normalized.ale, 2.0);
        assert_eq!(normalized.hides, 0.0);
        assert!(normalized.goods_amount().fract().abs() <= f64::EPSILON);
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
    fn founding_bootstrap_is_raid_immune() {
        assert!(raid_immune_building_kind("founders_camp"));
        assert!(!raid_immune_building_kind("village_storehouse"));
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
    fn larger_parties_are_easier_for_ordinary_scouts_to_notice() {
        assert!(raid_scout_detection_chance(3) < raid_scout_detection_chance(7));
        assert!(raid_scout_detection_chance(7) < raid_scout_detection_chance(12));
        assert!(raid_scout_detection_chance(12) < 1.0);
    }

    #[test]
    fn only_a_staffed_tower_covering_the_actual_approach_guarantees_warning() {
        let next_raid_tick = 10_000;
        let ticks_per_day = 600;
        let scout_miss_entropy = (0..10_000)
            .find(|entropy| {
                raid_warning_detection(
                    next_raid_tick,
                    ticks_per_day,
                    5,
                    RAID_APPROACH_NORTH,
                    0.0,
                    -401.0,
                    410.0,
                    *entropy,
                    &[],
                )
                .is_none()
            })
            .expect("the fallible scout model must retain missed approaches");
        let one_watchman = [WatchArea {
            source_id: 11,
            x: 0.0,
            z: -241.0,
            radius: 148.2,
        }];
        assert!(
            raid_warning_detection(
                next_raid_tick,
                ticks_per_day,
                5,
                RAID_APPROACH_NORTH,
                0.0,
                -401.0,
                410.0,
                scout_miss_entropy,
                &one_watchman,
            )
            .is_none(),
            "one watchman cannot see an approach beyond the reduced sight radius",
        );

        let two_watchmen = [WatchArea {
            radius: 190.0,
            ..one_watchman[0]
        }];
        let detected = raid_warning_detection(
            next_raid_tick,
            ticks_per_day,
            5,
            RAID_APPROACH_NORTH,
            0.0,
            -401.0,
            410.0,
            scout_miss_entropy,
            &two_watchmen,
        )
        .expect("a staffed tower covering the entry lane must report the party");
        assert_eq!(detected.tower_id, 11);
        assert!(detected.observation_tick < next_raid_tick - ticks_per_day);

        let wrong_frontier = [WatchArea {
            source_id: 12,
            x: 0.0,
            z: 241.0,
            radius: 190.0,
        }];
        assert!(
            raid_warning_detection(
                next_raid_tick,
                ticks_per_day,
                5,
                RAID_APPROACH_NORTH,
                0.0,
                -401.0,
                410.0,
                scout_miss_entropy,
                &wrong_frontier,
            )
            .is_none(),
            "coverage on another side of the map must not reveal this approach",
        );
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
                source_id: 1,
                x: -130.0,
                z: -20.0,
                radius: 148.2,
            },
            WatchArea {
                source_id: 2,
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
                source_id: index as u64,
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
    fn watch_district_readiness_uses_only_towers_covering_the_target() {
        let areas = [
            WatchArea {
                source_id: 1,
                x: 0.0,
                z: 0.0,
                radius: 100.0,
            },
            WatchArea {
                source_id: 2,
                x: 180.0,
                z: 0.0,
                radius: 100.0,
            },
        ];
        let index = WatchCoverageIndex::new(&areas);
        let readiness = HashMap::from([(1, 4.0), (2, 2.5)]);
        assert_eq!(index.defended_readiness(-50.0, 0.0, &readiness), 4.0);
        assert_eq!(index.defended_readiness(230.0, 0.0, &readiness), 2.5);
        assert_eq!(
            index.defended_readiness(90.0, 0.0, &readiness),
            6.5,
            "overlapping districts may combine distinct assigned companies"
        );
        assert_eq!(index.defended_readiness(500.0, 0.0, &readiness), 0.0);
    }

    #[test]
    fn refuge_capacity_overflows_whole_households_to_a_second_enclosure() {
        let assignments = assign_refuge_households(vec![
            RefugeHouseholdCandidate {
                residence_id: 1,
                refuge_id: 10,
                residents: 20,
                distance_squared: 1.0,
            },
            RefugeHouseholdCandidate {
                residence_id: 1,
                refuge_id: 20,
                residents: 20,
                distance_squared: 100.0,
            },
            RefugeHouseholdCandidate {
                residence_id: 2,
                refuge_id: 10,
                residents: 12,
                distance_squared: 2.0,
            },
            RefugeHouseholdCandidate {
                residence_id: 3,
                refuge_id: 10,
                residents: 20,
                distance_squared: 4.0,
            },
            RefugeHouseholdCandidate {
                residence_id: 3,
                refuge_id: 20,
                residents: 20,
                distance_squared: 9.0,
            },
            RefugeHouseholdCandidate {
                residence_id: 4,
                refuge_id: 20,
                residents: 13,
                distance_squared: 11.0,
            },
        ]);
        assert_eq!(assignments.get(&1), Some(&10));
        assert_eq!(assignments.get(&2), Some(&10));
        assert_eq!(assignments.get(&3), Some(&20));
        assert_eq!(
            assignments.get(&4),
            None,
            "a household may not be split when the remaining refuge capacity is too small"
        );
    }

    #[test]
    fn refuge_assignment_uses_stable_ids_for_exact_distance_ties() {
        let assignments = assign_refuge_households(vec![
            RefugeHouseholdCandidate {
                residence_id: 7,
                refuge_id: 200,
                residents: 4,
                distance_squared: 25.0,
            },
            RefugeHouseholdCandidate {
                residence_id: 7,
                refuge_id: 100,
                residents: 4,
                distance_squared: 25.0,
            },
        ]);
        assert_eq!(assignments.get(&7), Some(&100));
    }

    #[test]
    fn refuge_assignment_stays_bounded_at_large_settlement_scale() {
        let candidates = (0..100_000)
            .map(|index| RefugeHouseholdCandidate {
                residence_id: index,
                refuge_id: index / 8,
                residents: 4,
                distance_squared: (index % 8) as f64,
            })
            .collect::<Vec<_>>();
        let started = std::time::Instant::now();
        let assignments = assign_refuge_households(candidates);
        assert_eq!(assignments.len(), 100_000);
        assert!(
            started.elapsed() < std::time::Duration::from_millis(500),
            "100,000 household-to-refuge candidates should remain interactive"
        );
    }

    #[test]
    fn guarded_central_branch_cannot_hide_an_undefended_watch_district() {
        let rich_central = RaidTargetDefenseCandidate {
            target: RaidTargetCandidate {
                kind: RaidTargetKind::Building,
                id: 1,
                protected: true,
                sheltered: false,
                value: 100.0,
            },
            local_ready_guards: 6.0,
        };
        let lean_satellite = RaidTargetDefenseCandidate {
            target: RaidTargetCandidate {
                kind: RaidTargetKind::Building,
                id: 2,
                protected: true,
                sheltered: false,
                value: 20.0,
            },
            local_ready_guards: 0.0,
        };
        let exposed_cart = RaidTargetDefenseCandidate {
            target: RaidTargetCandidate {
                kind: RaidTargetKind::DeliveryTrip,
                id: 3,
                protected: false,
                sheltered: false,
                value: 10.0,
            },
            // Guards elsewhere never defend an unwarned road position.
            local_ready_guards: 100.0,
        };
        let forecast = raid_district_forecast(50, &[rich_central, lean_satellite, exposed_cart]);
        assert_eq!(forecast.frontline_ready_guards, 0.0);
        assert_eq!(forecast.selected[0].target.id, exposed_cart.target.id);
        assert!(forecast
            .selected
            .iter()
            .any(|outcome| outcome.target.id == lean_satellite.target.id));
        assert!(!forecast
            .selected
            .iter()
            .any(|outcome| outcome.target.id == rich_central.target.id));

        let balanced = raid_district_forecast(
            50,
            &[
                rich_central,
                RaidTargetDefenseCandidate {
                    local_ready_guards: 6.0,
                    ..lean_satellite
                },
            ],
        );
        assert!(balanced.selected.is_empty());
        assert!(balanced.frontline_ready_guards >= balanced.forecast.guards_required);
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
    fn explicit_muster_posts_do_not_silently_fall_back() {
        let watchtower_ids = [20, 10];
        let distances = [Some(90.0), Some(140.0)];
        assert_eq!(
            select_guardhouse_muster_watch(0, &watchtower_ids, &distances),
            Some((0, 90.0)),
            "automatic companies should answer the nearest staffed watch"
        );
        assert_eq!(
            select_guardhouse_muster_watch(10, &watchtower_ids, &distances),
            Some((1, 140.0)),
            "an explicit order should override the nearer post"
        );
        assert_eq!(
            select_guardhouse_muster_watch(10, &watchtower_ids, &[Some(90.0), None]),
            None,
            "a severed ordered route must not fall back to another district"
        );
        assert_eq!(
            select_guardhouse_muster_watch(99, &watchtower_ids, &distances),
            None,
            "an unavailable ordered post must leave the company unlinked"
        );
        assert_eq!(
            select_guardhouse_muster_watch(0, &[20, 10], &[Some(100.0), Some(100.0)]),
            Some((1, 100.0)),
            "automatic equal routes should use stable watch identity"
        );
    }

    #[test]
    fn coverage_materially_reduces_the_planning_forecast() {
        let exposed = projected_raid_loss_fraction(50, 0.0);
        let guarded = projected_raid_loss_fraction(50, 0.8);
        assert!(guarded < exposed * 0.4);
        assert!(projected_raid_loss_fraction(90, 0.0) > exposed);
    }

    #[test]
    fn contact_loss_is_not_reduced_by_an_abstract_watch_score() {
        assert_eq!(
            raid_contact_loss_fraction(50),
            projected_raid_loss_fraction(50, 0.0)
        );
        assert!(raid_contact_loss_fraction(50) > projected_raid_loss_fraction(50, 1.0));
        assert!(raid_contact_loss_fraction(100) > raid_contact_loss_fraction(0));
        assert!(raid_target_can_shelter(
            RaidTargetKind::Residence,
            true,
            true
        ));
        assert!(!raid_target_can_shelter(
            RaidTargetKind::Residence,
            false,
            true
        ));
        for kind in [
            RaidTargetKind::Building,
            RaidTargetKind::DeliveryTrip,
            RaidTargetKind::TreasuryAtBuilding,
            RaidTargetKind::TreasuryAtResidence,
        ] {
            assert!(
                !raid_target_can_shelter(kind, true, true),
                "only a household can carry its own wealth into the refuge"
            );
        }
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
        assert_eq!(projected_guarded_raid_loss_fraction(50, 1.0, 6.0), 0.0);
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
        let unguarded = projected_raid_loss_fraction(90, 0.25);
        let guarded = projected_guarded_raid_loss_fraction(90, 0.25, 3.0);
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
                sheltered: false,
                value: 100.0,
            },
            RaidTargetCandidate {
                kind: RaidTargetKind::Residence,
                id: 2,
                protected: true,
                sheltered: false,
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
            sheltered: false,
            value: 40.0,
        };
        let targets = [
            RaidTargetCandidate {
                kind: RaidTargetKind::Building,
                id: 1,
                protected: false,
                sheltered: false,
                value: 20.0,
            },
            exposed_home,
            RaidTargetCandidate {
                kind: RaidTargetKind::Building,
                id: 3,
                protected: true,
                sheltered: false,
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
                sheltered: id % 5 == 0,
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
