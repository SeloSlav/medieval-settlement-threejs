//! Authoritative military progression, recruitment costs, and combat balance.
//!
//! Equipment is expressed in commodities that already have physical producers
//! and stores. A crossbow is therefore a durable timber/ironwork/leather kit;
//! bolts are tracked as company ammunition and require ironwork to replenish.

use crate::balance_generated::{CALENDAR_SECONDS_PER_DAY, TICK_DT};

pub const MERCENARY_IDLE_DEPARTURE_DAYS: u64 = 7;
pub const MERCENARY_MAX_CONTRACT_DAYS: u64 = 21;
pub const MILITARY_PROVISION_ISSUE_DAYS: f64 = 3.0;
pub const MILITARY_DEMAND_MUSTER_ONLY: u8 = 0;
pub const MILITARY_DEMAND_LIGHT_RATIONS: u8 = 1;
pub const MILITARY_DEMAND_FULL_UPKEEP: u8 = 2;
pub const MILITARY_MAX_LEVEL: u32 = 10;
pub const MILITARY_BATTLE_SURVIVAL_XP: u64 = 40;
pub const MILITARY_ENEMY_COMPANY_XP: u64 = 75;
/// A company must remain out of contact for this long before its current
/// engagement counts as a survived battle. The delay prevents momentary
/// spacing changes inside one fight from farming repeated awards.
pub const MILITARY_BATTLE_END_SECONDS: f64 = 30.0;

pub fn normalize_military_demands(value: u8) -> u8 {
    match value {
        MILITARY_DEMAND_MUSTER_ONLY
        | MILITARY_DEMAND_LIGHT_RATIONS
        | MILITARY_DEMAND_FULL_UPKEEP => value,
        _ => MILITARY_DEMAND_LIGHT_RATIONS,
    }
}

pub fn military_day_ticks() -> u64 {
    (CALENDAR_SECONDS_PER_DAY / TICK_DT).round().max(1.0) as u64
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MilitaryKind {
    Militia = 0,
    Spearmen = 1,
    MenAtArms = 2,
    Crossbows = 3,
    MercenarySpears = 4,
    Footmen = 5,
    Polearms = 6,
    Bowmen = 7,
    Hussars = 8,
    ArmoredLancers = 9,
    MountedArchers = 10,
}

impl MilitaryKind {
    pub fn from_id(value: u8) -> Option<Self> {
        match value {
            0 => Some(Self::Militia),
            1 => Some(Self::Spearmen),
            2 => Some(Self::MenAtArms),
            3 => Some(Self::Crossbows),
            4 => Some(Self::MercenarySpears),
            5 => Some(Self::Footmen),
            6 => Some(Self::Polearms),
            7 => Some(Self::Bowmen),
            8 => Some(Self::Hussars),
            9 => Some(Self::ArmoredLancers),
            10 => Some(Self::MountedArchers),
            _ => None,
        }
    }

    pub fn faction(self) -> u8 {
        match self {
            Self::Militia => 3,
            Self::Spearmen => 4,
            Self::MenAtArms => 5,
            Self::Crossbows => 6,
            Self::MercenarySpears => 7,
            Self::Footmen => 8,
            Self::Polearms => 9,
            Self::Bowmen => 10,
            Self::Hussars => 11,
            Self::ArmoredLancers => 15,
            Self::MountedArchers => 16,
        }
    }

    pub fn company_size(self) -> u32 {
        match self {
            Self::Militia => 5,
            Self::Spearmen | Self::MenAtArms | Self::MercenarySpears => 8,
            Self::Crossbows => 6,
            Self::Footmen | Self::Polearms | Self::Bowmen => 8,
            Self::Hussars | Self::ArmoredLancers | Self::MountedArchers => 6,
        }
    }

    pub fn requires_resident_men(self) -> bool {
        self != Self::MercenarySpears
    }

    pub fn requires_guardhouse(self) -> bool {
        matches!(
            self,
            Self::Spearmen
                | Self::MenAtArms
                | Self::Crossbows
                | Self::Footmen
                | Self::Polearms
                | Self::Bowmen
        )
    }

    pub fn requires_cavalry_yard(self) -> bool {
        matches!(
            self,
            Self::Hussars | Self::ArmoredLancers | Self::MountedArchers
        )
    }

    pub fn is_mounted(self) -> bool {
        self.requires_cavalry_yard()
    }

    pub fn is_ranged(self) -> bool {
        matches!(self, Self::Crossbows | Self::Bowmen | Self::MountedArchers)
    }

    pub fn gains_veteran_experience(self) -> bool {
        !matches!(self, Self::Militia | Self::MercenarySpears)
    }

    pub fn has_large_shields(self) -> bool {
        matches!(
            self,
            Self::Spearmen | Self::MenAtArms | Self::MercenarySpears | Self::Footmen
        )
    }

    pub fn can_brace(self) -> bool {
        matches!(self, Self::Spearmen | Self::MercenarySpears | Self::Polearms)
    }
}

pub fn is_player_military_faction(faction: u8) -> bool {
    (0..=10).any(|kind| {
        MilitaryKind::from_id(kind).is_some_and(|military_kind| military_kind.faction() == faction)
    })
}

pub fn military_battle_end_ticks() -> u64 {
    (MILITARY_BATTLE_END_SECONDS / TICK_DT).round().max(1.0) as u64
}

/// Total experience required to begin `level`. Level one begins at zero.
pub fn military_level_start_experience(level: u32) -> u64 {
    let capped = level.clamp(1, MILITARY_MAX_LEVEL);
    (1..capped)
        .map(|completed_level| 100 + u64::from(completed_level.saturating_sub(1)) * 40)
        .sum()
}

pub fn military_level_for_experience(experience: u64) -> u32 {
    (1..=MILITARY_MAX_LEVEL)
        .rev()
        .find(|level| experience >= military_level_start_experience(*level))
        .unwrap_or(1)
}

pub fn veteran_health_multiplier(level: u32) -> f64 {
    1.0 + f64::from(level.clamp(1, MILITARY_MAX_LEVEL) - 1) * 0.04
}

pub fn veteran_damage_multiplier(level: u32) -> f64 {
    1.0 + f64::from(level.clamp(1, MILITARY_MAX_LEVEL) - 1) * 0.025
}

pub fn veteran_damage_taken_multiplier(level: u32) -> f64 {
    (1.0 - f64::from(level.clamp(1, MILITARY_MAX_LEVEL) - 1) * 0.015).max(0.84)
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct MilitaryCost {
    pub polearms: u32,
    pub sidearms: u32,
    pub shields: u32,
    pub bows: u32,
    pub crossbows: u32,
    pub padded_armor: u32,
    pub mail_armor: u32,
    pub ammunition: u32,
    pub ale: u32,
    pub savory_preserves: u32,
    pub gold: u32,
}

impl MilitaryCost {
    pub fn for_company(kind: MilitaryKind, size: u32) -> Self {
        let n = size.max(1);
        match kind {
            // Emergency levy: one locally made spear and ordinary clothing.
            MilitaryKind::Militia => Self {
                polearms: n,
                ..Self::default()
            },
            // Trained spear wall: spear, shield, and padded protection.
            MilitaryKind::Spearmen => Self {
                polearms: n,
                shields: n,
                padded_armor: n,
                ale: n.div_ceil(2),
                savory_preserves: n * 2,
                gold: n,
                ..Self::default()
            },
            // Heavy holding infantry: sidearm, shield, and mail.
            MilitaryKind::MenAtArms => Self {
                sidearms: n,
                shields: n,
                mail_armor: n,
                ale: n,
                savory_preserves: n * 3,
                gold: n * 4,
                ..Self::default()
            },
            // Crossbow companies carry a complete weapon and ammunition bundle.
            MilitaryKind::Crossbows => Self {
                crossbows: n,
                padded_armor: n,
                ammunition: n,
                ale: n.div_ceil(2),
                savory_preserves: n * 3,
                gold: n * 2,
                ..Self::default()
            },
            // Hired outsiders bring their own kit; the contract is paid wholly
            // from the public treasury. Their dropped spears become local salvage.
            MilitaryKind::MercenarySpears => Self {
                gold: n * 12,
                ..Self::default()
            },
            // Mobile shield infantry trade spear reach for sustained offense.
            MilitaryKind::Footmen => Self {
                sidearms: n,
                shields: n,
                padded_armor: n,
                ale: n.div_ceil(2),
                savory_preserves: n * 2,
                gold: n * 2,
                ..Self::default()
            },
            MilitaryKind::Polearms => Self {
                polearms: n,
                padded_armor: n,
                ale: n.div_ceil(2),
                savory_preserves: n * 3,
                gold: n * 2,
                ..Self::default()
            },
            MilitaryKind::Bowmen => Self {
                bows: n,
                ammunition: n,
                savory_preserves: n * 2,
                gold: n,
                ..Self::default()
            },
            // Croatian-Hungarian frontier hussars: light lance, sidearm,
            // small shield, and textile protection on a pasture-supplied horse.
            MilitaryKind::Hussars => Self {
                polearms: n,
                sidearms: n,
                shields: n,
                padded_armor: n,
                ale: n.div_ceil(2),
                savory_preserves: n * 3,
                gold: n * 5,
                ..Self::default()
            },
            // A smaller, costly armored lance retinue built for shock action.
            MilitaryKind::ArmoredLancers => Self {
                polearms: n,
                sidearms: n,
                mail_armor: n,
                ale: n,
                savory_preserves: n * 4,
                gold: n * 8,
                ..Self::default()
            },
            // Frontier horse archers use bows from horseback but retain a
            // sidearm and padded coat for close fighting.
            MilitaryKind::MountedArchers => Self {
                bows: n,
                sidearms: n,
                padded_armor: n,
                ammunition: n,
                ale: n.div_ceil(2),
                savory_preserves: n * 3,
                gold: n * 5,
                ..Self::default()
            },
        }
    }

    /// Applies the selected world rule to a local company's consumables and
    /// public pay. Equipment always remains a real recruitment requirement.
    /// Militia and hired outsiders keep their own independent contracts.
    pub fn for_company_with_demands(kind: MilitaryKind, size: u32, demands: u8) -> Self {
        let mut cost = Self::for_company(kind, size);
        if matches!(kind, MilitaryKind::Militia | MilitaryKind::MercenarySpears) {
            return cost;
        }
        let n = size.max(1);
        match normalize_military_demands(demands) {
            MILITARY_DEMAND_MUSTER_ONLY => {
                cost.ale = 0;
                cost.savory_preserves = 0;
                cost.gold = 0;
            }
            MILITARY_DEMAND_LIGHT_RATIONS => {
                cost.ale = 0;
                cost.savory_preserves = n;
                cost.gold = 0;
            }
            MILITARY_DEMAND_FULL_UPKEEP => {
                cost.ale = n;
                cost.savory_preserves = n;
            }
            _ => unreachable!(),
        }
        cost
    }
}

pub fn local_company_requires_provisions(kind: MilitaryKind, demands: u8) -> bool {
    !matches!(kind, MilitaryKind::Militia | MilitaryKind::MercenarySpears)
        && normalize_military_demands(demands) != MILITARY_DEMAND_MUSTER_ONLY
}

pub fn company_wages_enabled(kind: MilitaryKind, demands: u8) -> bool {
    kind == MilitaryKind::MercenarySpears
        || (!matches!(kind, MilitaryKind::Militia)
            && normalize_military_demands(demands) >= MILITARY_DEMAND_FULL_UPKEEP)
}

/// Local professional pay is due once per three field days. Mercenaries keep
/// their daily contract. Count crossed boundaries so daily upkeep and delayed
/// simulation steps neither lose a pay period nor charge it twice.
pub fn company_wage_periods_due(
    kind: MilitaryKind,
    formed_tick: u64,
    last_upkeep_tick: u64,
    tick: u64,
) -> u64 {
    if kind == MilitaryKind::MercenarySpears {
        return tick.saturating_sub(last_upkeep_tick) / military_day_ticks();
    }
    let period_ticks = military_day_ticks().saturating_mul(MILITARY_PROVISION_ISSUE_DAYS as u64);
    let previous_period = last_upkeep_tick.saturating_sub(formed_tick) / period_ticks;
    let current_period = tick.saturating_sub(formed_tick) / period_ticks;
    current_period.saturating_sub(previous_period)
}

pub fn military_resupply_cost(living_soldiers: u32, demands: u8) -> MilitaryCost {
    let n = living_soldiers;
    match normalize_military_demands(demands) {
        MILITARY_DEMAND_MUSTER_ONLY => MilitaryCost::default(),
        MILITARY_DEMAND_LIGHT_RATIONS => MilitaryCost {
            savory_preserves: n,
            ..MilitaryCost::default()
        },
        MILITARY_DEMAND_FULL_UPKEEP => MilitaryCost {
            ale: n,
            savory_preserves: n,
            ..MilitaryCost::default()
        },
        _ => unreachable!(),
    }
}

#[derive(Clone, Copy, Debug)]
pub struct MilitaryStats {
    pub max_health: f64,
    pub damage: f64,
    pub attack_seconds: f64,
    pub speed: f64,
    pub acquisition_range: f64,
    pub strike_range: f64,
    pub starting_morale: f64,
    pub starting_cohesion: f64,
    pub damage_taken_multiplier: f64,
    pub ammunition_per_member: u32,
}

pub fn military_stats(kind: MilitaryKind) -> MilitaryStats {
    match kind {
        MilitaryKind::Militia => MilitaryStats {
            max_health: 52.0,
            damage: 8.0,
            attack_seconds: 1.10,
            speed: 2.45,
            acquisition_range: 9.0,
            strike_range: 2.4,
            starting_morale: 0.48,
            starting_cohesion: 0.42,
            damage_taken_multiplier: 1.0,
            ammunition_per_member: 0,
        },
        MilitaryKind::Spearmen => MilitaryStats {
            max_health: 74.0,
            damage: 11.5,
            attack_seconds: 1.0,
            speed: 2.25,
            acquisition_range: 10.0,
            strike_range: 2.6,
            starting_morale: 0.66,
            starting_cohesion: 0.65,
            damage_taken_multiplier: 0.82,
            ammunition_per_member: 0,
        },
        MilitaryKind::MenAtArms => MilitaryStats {
            max_health: 96.0,
            damage: 15.0,
            attack_seconds: 0.92,
            speed: 2.15,
            acquisition_range: 12.0,
            strike_range: 2.05,
            starting_morale: 0.84,
            starting_cohesion: 0.88,
            damage_taken_multiplier: 0.60,
            ammunition_per_member: 0,
        },
        MilitaryKind::Crossbows => MilitaryStats {
            max_health: 58.0,
            damage: 18.0,
            attack_seconds: 2.45,
            speed: 2.25,
            acquisition_range: 19.0,
            strike_range: 17.5,
            starting_morale: 0.67,
            starting_cohesion: 0.62,
            damage_taken_multiplier: 1.08,
            ammunition_per_member: 18,
        },
        MilitaryKind::MercenarySpears => MilitaryStats {
            max_health: 80.0,
            damage: 13.0,
            attack_seconds: 0.94,
            speed: 2.35,
            acquisition_range: 12.0,
            strike_range: 2.65,
            starting_morale: 0.76,
            starting_cohesion: 0.74,
            damage_taken_multiplier: 0.76,
            ammunition_per_member: 0,
        },
        MilitaryKind::Footmen => MilitaryStats {
            max_health: 78.0,
            damage: 14.0,
            attack_seconds: 0.82,
            speed: 2.55,
            acquisition_range: 12.0,
            strike_range: 2.05,
            starting_morale: 0.72,
            starting_cohesion: 0.70,
            damage_taken_multiplier: 0.78,
            ammunition_per_member: 0,
        },
        MilitaryKind::Polearms => MilitaryStats {
            max_health: 70.0,
            damage: 17.5,
            attack_seconds: 1.08,
            speed: 2.30,
            acquisition_range: 11.0,
            strike_range: 2.85,
            starting_morale: 0.71,
            starting_cohesion: 0.74,
            damage_taken_multiplier: 0.94,
            ammunition_per_member: 0,
        },
        MilitaryKind::Bowmen => MilitaryStats {
            max_health: 55.0,
            damage: 10.5,
            attack_seconds: 1.55,
            speed: 2.50,
            acquisition_range: 22.0,
            strike_range: 20.0,
            starting_morale: 0.61,
            starting_cohesion: 0.57,
            damage_taken_multiplier: 1.12,
            ammunition_per_member: 24,
        },
        MilitaryKind::Hussars => MilitaryStats {
            max_health: 82.0,
            damage: 15.5,
            attack_seconds: 0.90,
            speed: 4.65,
            acquisition_range: 15.0,
            strike_range: 2.8,
            starting_morale: 0.76,
            starting_cohesion: 0.70,
            damage_taken_multiplier: 0.82,
            ammunition_per_member: 0,
        },
        MilitaryKind::ArmoredLancers => MilitaryStats {
            max_health: 112.0,
            damage: 20.0,
            attack_seconds: 1.04,
            speed: 4.20,
            acquisition_range: 16.0,
            strike_range: 3.0,
            starting_morale: 0.88,
            starting_cohesion: 0.84,
            damage_taken_multiplier: 0.55,
            ammunition_per_member: 0,
        },
        MilitaryKind::MountedArchers => MilitaryStats {
            max_health: 68.0,
            damage: 11.5,
            attack_seconds: 1.42,
            speed: 5.05,
            acquisition_range: 23.0,
            strike_range: 20.5,
            starting_morale: 0.70,
            starting_cohesion: 0.62,
            damage_taken_multiplier: 1.02,
            ammunition_per_member: 24,
        },
    }
}

#[derive(Clone, Copy, Debug)]
pub struct MemberCombatProfile {
    pub max_health: f64,
    pub damage_scale: f64,
    pub armor: f64,
    pub shield: f64,
    pub armor_penetration: f64,
    pub charge: f64,
    pub bracing: f64,
    pub speed_scale: f64,
}

/// Stable per-person variation gives every soldier his own health, armor and
/// striking quality without widening the hot replicated CombatAgent row.
pub fn member_combat_profile(kind: MilitaryKind, stable_seed: u64) -> MemberCombatProfile {
    let stats = military_stats(kind);
    let signed = |shift: u32| (((stable_seed.rotate_left(shift) & 255) as f64) / 255.0 - 0.5) * 2.0;
    let (armor, shield, penetration, charge, bracing) = match kind {
        MilitaryKind::Militia => (2.0, 0.0, 1.0, 0.04, 0.18),
        MilitaryKind::Spearmen => (7.0, 8.0, 2.0, 0.08, 0.66),
        MilitaryKind::MenAtArms => (15.0, 14.0, 5.0, 0.10, 0.12),
        MilitaryKind::Crossbows => (4.0, 0.0, 12.0, 0.0, 0.0),
        MilitaryKind::MercenarySpears => (9.0, 8.0, 3.0, 0.12, 0.70),
        MilitaryKind::Footmen => (10.0, 6.0, 5.0, 0.24, 0.08),
        MilitaryKind::Polearms => (7.0, 0.0, 14.0, 0.34, 0.48),
        MilitaryKind::Bowmen => (2.0, 0.0, 3.0, 0.0, 0.0),
        MilitaryKind::Hussars => (8.0, 5.0, 4.0, 0.86, 0.04),
        MilitaryKind::ArmoredLancers => (17.0, 2.0, 8.0, 1.18, 0.02),
        MilitaryKind::MountedArchers => (5.0, 0.0, 4.0, 0.18, 0.0),
    };
    MemberCombatProfile {
        max_health: stats.max_health * (1.0 + signed(3) * 0.07),
        damage_scale: 1.0 + signed(11) * 0.08,
        armor: (armor + signed(17) * 1.2).max(0.0),
        shield,
        armor_penetration: (penetration + signed(23) * 0.8).max(0.0),
        charge,
        bracing,
        speed_scale: 1.0 + signed(29) * 0.045,
    }
}

pub fn matchup_damage_multiplier(attacker: MilitaryKind, defender: MilitaryKind) -> f64 {
    match (attacker, defender) {
        (MilitaryKind::Footmen, MilitaryKind::Spearmen) => 1.22,
        (MilitaryKind::Footmen, MilitaryKind::Crossbows | MilitaryKind::Bowmen) => 1.28,
        (
            MilitaryKind::Polearms,
            MilitaryKind::Footmen | MilitaryKind::MenAtArms | MilitaryKind::MercenarySpears,
        ) => 1.25,
        (
            MilitaryKind::Crossbows,
            MilitaryKind::Spearmen
            | MilitaryKind::MenAtArms
            | MilitaryKind::Footmen
            | MilitaryKind::Polearms,
        ) => 1.20,
        (MilitaryKind::MenAtArms, MilitaryKind::Footmen | MilitaryKind::Bowmen) => 1.15,
        (MilitaryKind::Bowmen, MilitaryKind::Militia | MilitaryKind::Polearms) => 1.18,
        (MilitaryKind::Hussars, MilitaryKind::Bowmen | MilitaryKind::Crossbows) => 1.34,
        (MilitaryKind::ArmoredLancers, MilitaryKind::Footmen | MilitaryKind::Bowmen) => 1.30,
        (MilitaryKind::MountedArchers, MilitaryKind::MenAtArms | MilitaryKind::Polearms) => 0.86,
        (
            MilitaryKind::Polearms | MilitaryKind::Spearmen,
            MilitaryKind::Hussars | MilitaryKind::ArmoredLancers,
        ) => 1.32,
        _ => 1.0,
    }
}

pub const MILITARY_FORMATION_LINE: u8 = 0;
pub const MILITARY_FORMATION_COLUMN: u8 = 1;
pub const MILITARY_FORMATION_SHIELD_WALL: u8 = 2;
pub const MILITARY_FORMATION_LOOSE: u8 = 3;
pub const MILITARY_FORMATION_BRACE: u8 = 4;
pub const MILITARY_FORMATION_WEDGE: u8 = 5;

pub const MILITARY_STANCE_BALANCED: u8 = 0;
pub const MILITARY_STANCE_STAND_GROUND: u8 = 1;
pub const MILITARY_STANCE_PUSH_FORWARD: u8 = 2;
pub const MILITARY_STANCE_GIVE_GROUND: u8 = 3;
pub const MILITARY_STANCE_MISSILE_ALERT: u8 = 4;

pub fn military_formation_available(kind: MilitaryKind, formation: u8) -> bool {
    match formation {
        MILITARY_FORMATION_LINE | MILITARY_FORMATION_COLUMN | MILITARY_FORMATION_LOOSE => true,
        MILITARY_FORMATION_SHIELD_WALL => kind.has_large_shields(),
        MILITARY_FORMATION_BRACE => kind.can_brace(),
        MILITARY_FORMATION_WEDGE => kind.is_mounted(),
        _ => false,
    }
}

pub fn military_stance_available(kind: MilitaryKind, stance: u8) -> bool {
    match stance {
        MILITARY_STANCE_BALANCED | MILITARY_STANCE_STAND_GROUND => true,
        MILITARY_STANCE_PUSH_FORWARD => !kind.is_ranged() || kind.is_mounted(),
        MILITARY_STANCE_GIVE_GROUND => !kind.is_mounted(),
        MILITARY_STANCE_MISSILE_ALERT => !kind.is_mounted(),
        _ => false,
    }
}

pub fn stance_morale_required(stance: u8) -> f64 {
    match stance {
        MILITARY_STANCE_PUSH_FORWARD => 0.45,
        MILITARY_STANCE_STAND_GROUND | MILITARY_STANCE_MISSILE_ALERT => 0.30,
        _ => 0.16,
    }
}

/// Fatigue is spent stamina: its loss applies equally to attack and defense.
pub fn fatigue_effectiveness(fatigue: f64) -> f64 {
    (1.0 - fatigue.clamp(0.0, 1.0)).max(0.05)
}

pub fn militia_muster_size(requested: u32, available_men: u32, polearms: u32) -> u32 {
    requested.min(available_men).min(polearms)
}

pub fn optional_militia_armor(tier: u8, padded: u32, mail: u32) -> u8 {
    if tier >= 3 && mail > 0 { 2 } else if tier >= 2 && padded > 0 { 1 } else { 0 }
}

pub fn is_debug_military_member(person_identity: &str) -> bool {
    person_identity.starts_with("debug-company:")
}

pub fn ordered_run_multiplier(running: bool, fatigue: f64) -> f64 {
    if running && fatigue < 0.95 { 1.45 } else { 1.0 }
}

pub fn equipment_exertion_multiplier(armor: f64, shield: f64) -> f64 {
    1.0 + armor.max(0.0) * 0.035 + shield.max(0.0) * 0.04
}

pub fn slope_effectiveness(source_height: f64, target_height: f64, distance: f64) -> f64 {
    (1.0 + (source_height - target_height) / distance.max(1.0) * 0.75).clamp(0.65, 1.25)
}

pub fn is_rear_attack(fx: f64, fz: f64, dx: f64, dz: f64, ax: f64, az: f64) -> bool {
    let length = fx.hypot(fz) * (ax - dx).hypot(az - dz);
    length > 1e-9 && (fx * (ax - dx) + fz * (az - dz)) / length < -0.35
}

/// Checks a finite arrow lane, excluding the archer and the target endpoints.
pub fn shot_lane_intersection(sx: f64, sz: f64, tx: f64, tz: f64, x: f64, z: f64) -> Option<f64> {
    let dx = tx - sx;
    let dz = tz - sz;
    let length_squared = dx * dx + dz * dz;
    if length_squared < 1e-9 { return None; }
    let t = ((x - sx) * dx + (z - sz) * dz) / length_squared;
    (t > 0.025 && t < 0.985 && (x - sx - t * dx).hypot(z - sz - t * dz) < 0.65).then_some(t)
}

pub fn bracing_cancels_charge(kind: MilitaryKind, formation: u8, stationary: bool, frontal: bool) -> bool {
    kind.can_brace() && formation == MILITARY_FORMATION_BRACE && stationary && frontal
}

/// A melee impact belongs to one opponent until the first available strike.
/// Call with `melee_contact = false` when disengaging or using a missile weapon.
/// The returned target is persisted by the caller; the bonus is consumed once.
pub fn resolve_melee_charge(
    pending_target: u64,
    target: u64,
    melee_contact: bool,
    charged_into_contact: bool,
    strike_ready: bool,
) -> (u64, bool) {
    if !melee_contact || target == 0 {
        return (0, false);
    }
    let charged = charged_into_contact || pending_target == target;
    if !charged {
        (0, false)
    } else if strike_ready {
        (0, true)
    } else {
        (target, false)
    }
}

pub fn missile_evasion_chance(formation: u8, stance: u8) -> f64 {
    let base = if formation == MILITARY_FORMATION_LOOSE { 0.25 } else { 0.10 };
    base * if stance == MILITARY_STANCE_MISSILE_ALERT { 2.0 } else { 1.0 }
}

pub fn missile_is_evaded(formation: u8, stance: u8, attacker: u64, defender: u64, tick: u64) -> bool {
    let mut seed = attacker.wrapping_mul(0x9e3779b97f4a7c15) ^ defender.rotate_left(23) ^ tick.wrapping_mul(0xbf58476d1ce4e5b9);
    seed ^= seed >> 30;
    seed = seed.wrapping_mul(0xbf58476d1ce4e5b9);
    seed ^= seed >> 27;
    (seed >> 11) as f64 / ((1_u64 << 53) as f64) < missile_evasion_chance(formation, stance)
}

pub fn deployed_formation_offset(kind: MilitaryKind, formation: u8, columns: u32, index: u32, count: u32) -> (f64, f64) {
    if columns == 0 || formation == MILITARY_FORMATION_WEDGE {
        return formation_offset_for_kind(kind, formation, index, count);
    }
    let columns = columns.clamp(1, count.max(1));
    let spacing = match formation {
        MILITARY_FORMATION_LOOSE => 2.8,
        MILITARY_FORMATION_SHIELD_WALL => 1.05,
        MILITARY_FORMATION_BRACE => 1.25,
        _ => 1.55,
    } * if kind.is_mounted() { 1.55 } else { 1.0 };
    let center = (0..count.max(1)).fold((0.0, 0.0), |(x,z), i| (x + (i % columns) as f64, z + (i / columns) as f64));
    (((index % columns) as f64 - center.0 / count.max(1) as f64) * spacing,
     -((index / columns) as f64 - center.1 / count.max(1) as f64) * spacing)
}

/// Stable local offset for company orders. Formation is gameplay-relevant:
/// shield wall is dense, loose order gives missile spacing, and column moves
/// efficiently along narrow roads.
pub fn formation_offset(formation: u8, index: u32, count: u32) -> (f64, f64) {
    let count = count.max(1);
    let local = uncentered_formation_offset(formation, index, count);
    let center = (0..count).fold((0.0, 0.0), |center, slot| {
        let offset = uncentered_formation_offset(formation, slot, count);
        (center.0 + offset.0, center.1 + offset.1)
    });
    (local.0 - center.0 / count as f64, local.1 - center.1 / count as f64)
}

fn uncentered_formation_offset(formation: u8, index: u32, count: u32) -> (f64, f64) {
    let count = count.max(1);
    match formation {
        MILITARY_FORMATION_COLUMN => (0.0, index as f64 * -1.35),
        MILITARY_FORMATION_SHIELD_WALL => {
            let center = (count.saturating_sub(1) as f64) * 0.5;
            ((index as f64 - center) * 1.05, 0.0)
        }
        MILITARY_FORMATION_BRACE => {
            let columns = count.div_ceil(2).max(1);
            let row = index / columns;
            let column = index % columns;
            let center = (columns.saturating_sub(1) as f64) * 0.5;
            ((column as f64 - center) * 1.25, -(row as f64) * 1.05)
        }
        MILITARY_FORMATION_WEDGE => {
            let mut row = 0_u32;
            let mut first_in_row = 0_u32;
            while first_in_row + row + 1 <= index {
                first_in_row += row + 1;
                row += 1;
            }
            let position = index.saturating_sub(first_in_row);
            let center = row as f64 * 0.5;
            ((position as f64 - center) * 1.75, -(row as f64) * 1.55)
        }
        MILITARY_FORMATION_LOOSE => {
            let columns = 3_u32;
            let row = index / columns;
            let column = index % columns;
            ((column as f64 - 1.0) * 2.8, row as f64 * -2.8)
        }
        _ => {
            let center = (count.saturating_sub(1) as f64) * 0.5;
            ((index as f64 - center) * 1.55, 0.0)
        }
    }
}

/// Converts a company-local lateral/depth offset into world space. `facing`
/// points toward the company's front and is normalized defensively so a stale
/// or absent facing can never collapse a formation.
pub fn rotate_formation_offset(
    lateral: f64,
    depth: f64,
    facing_x: f64,
    facing_z: f64,
) -> (f64, f64) {
    let length = facing_x.hypot(facing_z);
    let (forward_x, forward_z) = if length > 1e-9 && length.is_finite() {
        (facing_x / length, facing_z / length)
    } else {
        (0.0, 1.0)
    };
    let right_x = forward_z;
    let right_z = -forward_x;
    (
        right_x * lateral + forward_x * depth,
        right_z * lateral + forward_z * depth,
    )
}

pub fn is_front_attack(
    facing_x: f64,
    facing_z: f64,
    defender_x: f64,
    defender_z: f64,
    attacker_x: f64,
    attacker_z: f64,
) -> bool {
    let facing_length = facing_x.hypot(facing_z);
    let attack_x = attacker_x - defender_x;
    let attack_z = attacker_z - defender_z;
    let attack_length = attack_x.hypot(attack_z);
    if facing_length <= 1e-9 || attack_length <= 1e-9 {
        return true;
    }
    (facing_x * attack_x + facing_z * attack_z) / (facing_length * attack_length) >= 0.35
}

pub fn formation_speed_multiplier(formation: u8) -> f64 {
    match formation {
        MILITARY_FORMATION_COLUMN => 1.10,
        MILITARY_FORMATION_SHIELD_WALL | MILITARY_FORMATION_BRACE => 0.72,
        MILITARY_FORMATION_LOOSE => 1.04,
        MILITARY_FORMATION_WEDGE => 1.08,
        _ => 1.0,
    }
}

pub fn formation_charge_multiplier(formation: u8) -> f64 {
    if formation == MILITARY_FORMATION_WEDGE {
        1.24
    } else {
        1.0
    }
}

pub fn stance_speed_multiplier(stance: u8) -> f64 {
    match stance {
        MILITARY_STANCE_STAND_GROUND => 0.72,
        MILITARY_STANCE_PUSH_FORWARD => 1.12,
        MILITARY_STANCE_GIVE_GROUND => 0.82,
        MILITARY_STANCE_MISSILE_ALERT => 0.92,
        _ => 1.0,
    }
}

pub fn stance_damage_multiplier(stance: u8) -> f64 {
    match stance {
        MILITARY_STANCE_STAND_GROUND => 1.0,
        MILITARY_STANCE_PUSH_FORWARD => 1.12,
        MILITARY_STANCE_GIVE_GROUND => 0.88,
        MILITARY_STANCE_MISSILE_ALERT => 0.90,
        _ => 1.0,
    }
}

pub fn stance_attack_interval_multiplier(stance: u8) -> f64 {
    match stance {
        MILITARY_STANCE_STAND_GROUND => 2.0,
        MILITARY_STANCE_PUSH_FORWARD => 0.84,
        MILITARY_STANCE_GIVE_GROUND => 1.12,
        MILITARY_STANCE_MISSILE_ALERT => 1.08,
        _ => 1.0,
    }
}

pub fn stance_damage_taken_multiplier(stance: u8, incoming_ranged: bool) -> f64 {
    match stance {
        MILITARY_STANCE_STAND_GROUND => 0.5,
        MILITARY_STANCE_PUSH_FORWARD => 1.08,
        MILITARY_STANCE_GIVE_GROUND => 0.92,
        MILITARY_STANCE_MISSILE_ALERT if incoming_ranged => 1.0,
        MILITARY_STANCE_MISSILE_ALERT => 2.0,
        _ => 1.0,
    }
}

pub fn stance_fatigue_multiplier(stance: u8) -> f64 {
    match stance {
        MILITARY_STANCE_STAND_GROUND => 0.78,
        MILITARY_STANCE_PUSH_FORWARD => 1.48,
        MILITARY_STANCE_GIVE_GROUND => 0.92,
        MILITARY_STANCE_MISSILE_ALERT => 1.08,
        _ => 1.0,
    }
}

pub fn formation_offset_for_kind(
    kind: MilitaryKind,
    formation: u8,
    index: u32,
    count: u32,
) -> (f64, f64) {
    let (x, z) = formation_offset(formation, index, count);
    let spacing = if kind.is_mounted() { 1.55 } else { 1.0 };
    (x * spacing, z * spacing)
}

pub fn shield_wall_damage_multiplier(kind: MilitaryKind, formation: u8) -> f64 {
    if formation != MILITARY_FORMATION_SHIELD_WALL {
        return 1.0;
    }
    match kind {
        MilitaryKind::Spearmen | MilitaryKind::MercenarySpears => 0.76,
        MilitaryKind::MenAtArms => 0.60,
        MilitaryKind::Footmen => 0.82,
        _ => 1.0,
    }
}

#[derive(Clone, Copy, Debug)]
pub struct CompanyDefense {
    pub kind: MilitaryKind,
    pub member_seed: u64,
    /// Protection issued in addition to the unit's ordinary combat profile.
    pub extra_armor: f64,
    pub formation: u8,
    pub stance: u8,
    pub level: u32,
    pub cohesion: f64,
    pub stationary: bool,
}

#[derive(Clone, Copy, Debug)]
pub struct IncomingMilitaryAttack {
    pub penetration: f64,
    pub ranged: bool,
    pub frontal: bool,
    pub charging: bool,
}

/// Shared by company combat and Ottoman-authored attacks; formation promises
/// must have the same effect regardless of which simulation owns the attacker.
pub fn incoming_company_damage_multiplier(
    defense: CompanyDefense,
    attack: IncomingMilitaryAttack,
) -> f64 {
    let profile = member_combat_profile(defense.kind, defense.member_seed);
    let armor = (profile.armor + defense.extra_armor - attack.penetration).max(0.0);
    let armor_multiplier = 1.0 / (1.0 + armor * 0.055);
    let shield_multiplier = if attack.frontal {
        (1.0 - profile.shield * 0.022).clamp(0.64, 1.0)
    } else {
        1.0
    };
    let brace_multiplier = if defense.formation == MILITARY_FORMATION_BRACE
        && defense.kind.can_brace()
        && defense.stationary
        && attack.charging
        && attack.frontal
    {
        (1.0 - profile.bracing * 0.34).clamp(0.62, 1.0)
    } else {
        1.0
    };
    let wall_multiplier = if attack.frontal {
        shield_wall_damage_multiplier(defense.kind, defense.formation)
    } else {
        1.0
    };
    let spacing_multiplier = if defense.formation == MILITARY_FORMATION_LOOSE {
        if attack.ranged { 1.0 } else { 1.12 }
    } else {
        1.0
    };
    military_stats(defense.kind).damage_taken_multiplier
        * veteran_damage_taken_multiplier(defense.level)
        * stance_damage_taken_multiplier(defense.stance, attack.ranged)
        * (1.08 - defense.cohesion.clamp(0.0, 1.0) * 0.18)
        * armor_multiplier
        * shield_multiplier
        * brace_multiplier
        * wall_multiplier
        * spacing_multiplier
}

/// Partial quivers remain usable by the soldier, but are not an intact whole
/// commodity bundle that can be recovered and issued again at full capacity.
pub fn recoverable_ammunition_bundles(rounds: u32, capacity: u32) -> u32 {
    u32::from(capacity > 0 && rounds >= capacity)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MercenaryDeparture {
    Stay,
    AfterBattle,
    Now,
}

pub fn mercenary_departure_decision(
    requested: bool,
    contract_expired: bool,
    inactivity_expired: bool,
    engaged: bool,
) -> MercenaryDeparture {
    if !requested && !contract_expired && (!inactivity_expired || engaged) {
        MercenaryDeparture::Stay
    } else if engaged {
        MercenaryDeparture::AfterBattle
    } else {
        MercenaryDeparture::Now
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_recruitment_path_has_a_real_limiting_cost() {
        for id in 0..=10 {
            let kind = MilitaryKind::from_id(id).unwrap();
            let cost = MilitaryCost::for_company(kind, kind.company_size());
            let total = cost.polearms
                + cost.sidearms
                + cost.shields
                + cost.bows
                + cost.crossbows
                + cost.padded_armor
                + cost.mail_armor
                + cost.ammunition
                + cost.ale
                + cost.savory_preserves
                + cost.gold;
            assert!(total > 0);
        }
    }

    #[test]
    fn militia_are_emergency_spears_not_free_soldiers() {
        let cost = MilitaryCost::for_company(MilitaryKind::Militia, 5);
        assert_eq!(cost.polearms, 5);
        assert_eq!(cost.gold, 0);
        assert!(
            military_stats(MilitaryKind::Militia).max_health
                < military_stats(MilitaryKind::Spearmen).max_health
        );
    }

    #[test]
    fn military_demands_scale_only_local_company_consumables_and_pay() {
        let easy = MilitaryCost::for_company_with_demands(
            MilitaryKind::Spearmen,
            8,
            MILITARY_DEMAND_MUSTER_ONLY,
        );
        assert_eq!((easy.polearms, easy.shields, easy.padded_armor), (8, 8, 8));
        assert_eq!((easy.savory_preserves, easy.ale, easy.gold), (0, 0, 0));

        let normal = MilitaryCost::for_company_with_demands(
            MilitaryKind::Spearmen,
            8,
            MILITARY_DEMAND_LIGHT_RATIONS,
        );
        assert_eq!((normal.savory_preserves, normal.ale, normal.gold), (8, 0, 0));

        let full = MilitaryCost::for_company_with_demands(
            MilitaryKind::Spearmen,
            8,
            MILITARY_DEMAND_FULL_UPKEEP,
        );
        assert_eq!((full.polearms, full.shields, full.padded_armor), (8, 8, 8));
        assert_eq!((full.savory_preserves, full.ale, full.gold), (8, 8, 8));
        let resupply = military_resupply_cost(8, MILITARY_DEMAND_FULL_UPKEEP);
        assert_eq!((resupply.savory_preserves, resupply.ale), (8, 8));
        assert!(!local_company_requires_provisions(
            MilitaryKind::MercenarySpears,
            MILITARY_DEMAND_FULL_UPKEEP,
        ));
        assert!(company_wages_enabled(
            MilitaryKind::MercenarySpears,
            MILITARY_DEMAND_MUSTER_ONLY,
        ));
    }

    #[test]
    fn local_wages_follow_three_field_day_boundaries() {
        let day = military_day_ticks();
        let formed = 137;
        let due = |previous_day: u64, current_day: u64| {
            company_wage_periods_due(
                MilitaryKind::Spearmen,
                formed,
                formed + previous_day * day,
                formed + current_day * day,
            )
        };
        assert_eq!(due(0, 1), 0);
        assert_eq!(due(1, 2), 0);
        assert_eq!(due(2, 3), 1);
        assert_eq!(due(3, 3), 0);
        assert_eq!(due(3, 4), 0);
        assert_eq!(due(5, 6), 1);
        assert_eq!(due(1, 10), 3);
        assert_eq!(company_wage_periods_due(
            MilitaryKind::Spearmen, formed, formed, formed + 3 * day - 1,
        ), 0);
    }

    #[test]
    fn mercenary_wages_keep_the_daily_contract() {
        let day = military_day_ticks();
        let formed = 137;
        assert_eq!(company_wage_periods_due(
            MilitaryKind::MercenarySpears, formed, formed, formed + day,
        ), 1);
        assert_eq!(company_wage_periods_due(
            MilitaryKind::MercenarySpears, formed, formed + day, formed + 4 * day,
        ), 3);
        // Renewing a contract restarts its daily clock between calendar days.
        let renewed = formed + day / 2;
        assert_eq!(company_wage_periods_due(
            MilitaryKind::MercenarySpears, formed, renewed, renewed + day - 1,
        ), 0);
        assert_eq!(company_wage_periods_due(
            MilitaryKind::MercenarySpears, formed, renewed, renewed + day,
        ), 1);
    }

    #[test]
    fn mercenaries_are_the_only_outsider_company() {
        for kind in [
            MilitaryKind::Militia,
            MilitaryKind::Spearmen,
            MilitaryKind::MenAtArms,
            MilitaryKind::Crossbows,
            MilitaryKind::Footmen,
            MilitaryKind::Polearms,
            MilitaryKind::Bowmen,
            MilitaryKind::Hussars,
            MilitaryKind::ArmoredLancers,
            MilitaryKind::MountedArchers,
        ] {
            assert!(kind.requires_resident_men());
        }
        assert!(!MilitaryKind::MercenarySpears.requires_resident_men());
        assert_eq!(
            MilitaryCost::for_company(MilitaryKind::MercenarySpears, 8).gold,
            96,
        );
    }

    #[test]
    fn men_at_arms_shield_wall_is_the_strongest_defense() {
        let cost = MilitaryCost::for_company(MilitaryKind::MenAtArms, 8);
        assert_eq!(cost.polearms, 0);
        assert_eq!(cost.sidearms, 8);
        assert_eq!(cost.shields, 8);
        assert_eq!(cost.mail_armor, 8);
        assert!(
            shield_wall_damage_multiplier(MilitaryKind::MenAtArms, MILITARY_FORMATION_SHIELD_WALL,)
                < shield_wall_damage_multiplier(
                    MilitaryKind::Spearmen,
                    MILITARY_FORMATION_SHIELD_WALL,
                )
        );
    }

    #[test]
    fn counter_web_has_distinct_answers() {
        assert!(matchup_damage_multiplier(MilitaryKind::Footmen, MilitaryKind::Spearmen) > 1.0);
        assert!(matchup_damage_multiplier(MilitaryKind::Polearms, MilitaryKind::MenAtArms) > 1.0);
        assert!(matchup_damage_multiplier(MilitaryKind::Crossbows, MilitaryKind::MenAtArms) > 1.0);
        assert!(
            member_combat_profile(MilitaryKind::Crossbows, 7).armor_penetration
                > member_combat_profile(MilitaryKind::Bowmen, 7).armor_penetration
        );
    }

    #[test]
    fn veteran_progression_excludes_levies_and_hired_outsiders() {
        assert!(!MilitaryKind::Militia.gains_veteran_experience());
        assert!(!MilitaryKind::MercenarySpears.gains_veteran_experience());
        assert!(MilitaryKind::Spearmen.gains_veteran_experience());
        assert_eq!(military_level_for_experience(0), 1);
        assert_eq!(military_level_for_experience(99), 1);
        assert_eq!(military_level_for_experience(100), 2);
        assert_eq!(military_level_start_experience(3), 240);
        assert!(veteran_health_multiplier(5) > veteran_health_multiplier(1));
        assert!(veteran_damage_multiplier(5) > veteran_damage_multiplier(1));
        assert!(veteran_damage_taken_multiplier(5) < veteran_damage_taken_multiplier(1));
    }

    #[test]
    fn formations_are_role_specific_and_authored_in_company_space() {
        assert!(military_formation_available(
            MilitaryKind::Spearmen,
            MILITARY_FORMATION_BRACE,
        ));
        assert!(!military_formation_available(
            MilitaryKind::Crossbows,
            MILITARY_FORMATION_BRACE,
        ));
        assert!(military_formation_available(
            MilitaryKind::Hussars,
            MILITARY_FORMATION_WEDGE,
        ));
        assert!(!military_formation_available(
            MilitaryKind::Hussars,
            MILITARY_FORMATION_SHIELD_WALL,
        ));

        let local = formation_offset(MILITARY_FORMATION_LINE, 0, 5);
        let north = rotate_formation_offset(local.0, local.1, 0.0, 1.0);
        let east = rotate_formation_offset(local.0, local.1, 1.0, 0.0);
        assert!((north.0 - local.0).abs() < 1e-9);
        assert!((north.1 - local.1).abs() < 1e-9);
        assert!((east.0 - local.1).abs() < 1e-9);
        assert!((east.1 + local.0).abs() < 1e-9);
    }

    #[test]
    fn wedge_and_brace_have_distinct_battlefield_jobs() {
        assert!(formation_charge_multiplier(MILITARY_FORMATION_WEDGE) > 1.0);
        assert!(formation_speed_multiplier(MILITARY_FORMATION_BRACE) < 1.0);
        let brace_front = formation_offset(MILITARY_FORMATION_BRACE, 0, 8);
        let brace_rear = formation_offset(MILITARY_FORMATION_BRACE, 7, 8);
        assert!(brace_front.1 > brace_rear.1);
        let wedge_tip = formation_offset(MILITARY_FORMATION_WEDGE, 0, 6);
        let wedge_rear = formation_offset(MILITARY_FORMATION_WEDGE, 5, 6);
        assert!(wedge_tip.1 > wedge_rear.1);
    }

    #[test]
    fn switching_formations_preserves_the_company_center_including_partial_ranks() {
        for formation in 0..=5 {
            for count in 1..=24 {
                let center = (0..count).fold((0.0, 0.0), |sum, rank| {
                    let offset = formation_offset(formation, rank, count);
                    (sum.0 + offset.0, sum.1 + offset.1)
                });
                assert!(center.0.abs() < 1e-8 && center.1.abs() < 1e-8);
            }
        }
    }

    #[test]
    fn directional_defense_distinguishes_front_and_rear() {
        assert!(is_front_attack(0.0, 1.0, 10.0, 10.0, 10.0, 14.0));
        assert!(!is_front_attack(0.0, 1.0, 10.0, 10.0, 10.0, 6.0));
    }

    #[test]
    fn bracing_requires_a_stationary_frontal_interception_including_polearms() {
        let defense = CompanyDefense {
            kind: MilitaryKind::Polearms,
            member_seed: 42,
            extra_armor: 0.0,
            formation: MILITARY_FORMATION_BRACE,
            stance: MILITARY_STANCE_BALANCED,
            level: 1,
            cohesion: 1.0,
            stationary: true,
        };
        let attack = IncomingMilitaryAttack {
            penetration: 3.0,
            ranged: false,
            frontal: true,
            charging: true,
        };
        let braced = incoming_company_damage_multiplier(defense, attack);
        let moving = incoming_company_damage_multiplier(
            CompanyDefense { stationary: false, ..defense }, attack,
        );
        let ordinary = incoming_company_damage_multiplier(
            defense, IncomingMilitaryAttack { charging: false, ..attack },
        );
        let rear = incoming_company_damage_multiplier(
            defense, IncomingMilitaryAttack { frontal: false, ..attack },
        );
        assert!(braced < moving);
        assert_eq!(moving, ordinary);
        assert_eq!(rear, ordinary); // Rear damage is separate from armor and bracing.
        assert!(is_rear_attack(0.0, 1.0, 0.0, 0.0, 0.0, -5.0));
        assert!(military_formation_available(MilitaryKind::Polearms, MILITARY_FORMATION_BRACE));
    }

    #[test]
    fn shield_wall_and_loose_order_have_directional_tradeoffs() {
        let defense = CompanyDefense {
            kind: MilitaryKind::Spearmen,
            member_seed: 7,
            extra_armor: 0.0,
            formation: MILITARY_FORMATION_SHIELD_WALL,
            stance: MILITARY_STANCE_BALANCED,
            level: 1,
            cohesion: 1.0,
            stationary: true,
        };
        let attack = IncomingMilitaryAttack {
            penetration: 2.0, ranged: true, frontal: true, charging: false,
        };
        let line = CompanyDefense { formation: MILITARY_FORMATION_LINE, ..defense };
        let rear = IncomingMilitaryAttack { frontal: false, ..attack };
        assert!(incoming_company_damage_multiplier(defense, attack)
            < incoming_company_damage_multiplier(line, attack));
        assert_eq!(incoming_company_damage_multiplier(defense, rear),
            incoming_company_damage_multiplier(line, rear));
        let loose = CompanyDefense { formation: MILITARY_FORMATION_LOOSE, ..defense };
        assert!(missile_evasion_chance(loose.formation, loose.stance)
            > missile_evasion_chance(line.formation, line.stance));
        let melee = IncomingMilitaryAttack { ranged: false, ..attack };
        assert!(incoming_company_damage_multiplier(loose, melee)
            > incoming_company_damage_multiplier(line, melee));
    }

    #[test]
    fn spent_or_partial_ammunition_cannot_be_recovered_as_a_fresh_bundle() {
        assert_eq!(recoverable_ammunition_bundles(24, 24), 1);
        assert_eq!(recoverable_ammunition_bundles(23, 24), 0);
        assert_eq!(recoverable_ammunition_bundles(1, 24), 0);
        assert_eq!(recoverable_ammunition_bundles(0, 24), 0);
        assert_eq!(recoverable_ammunition_bundles(0, 0), 0);
    }

    #[test]
    fn mercenary_dismissal_nonpayment_and_expiry_wait_for_combat_to_end() {
        // Both dismissal and failed wages set the authoritative request flag.
        assert_eq!(mercenary_departure_decision(true, false, false, true), MercenaryDeparture::AfterBattle);
        assert_eq!(mercenary_departure_decision(false, true, false, true), MercenaryDeparture::AfterBattle);
        assert_eq!(mercenary_departure_decision(true, true, true, false), MercenaryDeparture::Now);
        assert_eq!(mercenary_departure_decision(false, false, true, false), MercenaryDeparture::Now);
        assert_eq!(mercenary_departure_decision(false, false, true, true), MercenaryDeparture::Stay);
        assert_eq!(mercenary_departure_decision(false, false, false, false), MercenaryDeparture::Stay);
    }

    #[test]
    fn stance_tradeoffs_and_role_limits_remain_distinct() {
        assert!(military_stance_available(
            MilitaryKind::Bowmen,
            MILITARY_STANCE_MISSILE_ALERT,
        ));
        assert!(!military_stance_available(
            MilitaryKind::Hussars,
            MILITARY_STANCE_GIVE_GROUND,
        ));
        assert!(stance_damage_multiplier(MILITARY_STANCE_PUSH_FORWARD) > 1.0);
        assert!(stance_fatigue_multiplier(MILITARY_STANCE_PUSH_FORWARD) > 1.0);
        assert!(
            missile_evasion_chance(MILITARY_FORMATION_LINE, MILITARY_STANCE_MISSILE_ALERT)
                > missile_evasion_chance(MILITARY_FORMATION_LINE, MILITARY_STANCE_BALANCED)
        );
        assert!(
            stance_damage_taken_multiplier(MILITARY_STANCE_MISSILE_ALERT, false)
                > stance_damage_taken_multiplier(MILITARY_STANCE_BALANCED, false)
        );
    }

    #[test]
    fn pace_exhaustion_and_equipment_change_real_exertion() {
        assert_eq!(ordered_run_multiplier(false, 0.0), 1.0);
        assert!(ordered_run_multiplier(true, 0.2) > 1.0);
        assert_eq!(ordered_run_multiplier(true, 1.0), 1.0);
        assert_eq!(fatigue_effectiveness(0.5), 0.5);
        assert!(equipment_exertion_multiplier(15.0, 8.0) > equipment_exertion_multiplier(2.0, 0.0));
    }

    #[test]
    fn penetration_reaches_militia_issued_armor_after_exhausting_base_armor() {
        let defense = CompanyDefense {
            kind: MilitaryKind::Militia,
            member_seed: 42,
            extra_armor: 0.0,
            formation: MILITARY_FORMATION_LINE,
            stance: MILITARY_STANCE_BALANCED,
            level: 1,
            cohesion: 1.0,
            stationary: true,
        };
        let base_armor = member_combat_profile(defense.kind, defense.member_seed).armor;
        for issued_armor in [5.0, 12.0] {
            let equipped = CompanyDefense { extra_armor: issued_armor, ..defense };
            // Four penetration points remain after passing through base armor.
            let attack = IncomingMilitaryAttack {
                penetration: base_armor + 4.0,
                ranged: false,
                frontal: true,
                charging: false,
            };
            let unarmored = incoming_company_damage_multiplier(defense, attack);
            let partial = incoming_company_damage_multiplier(equipped, attack);
            let at_base = incoming_company_damage_multiplier(equipped,
                IncomingMilitaryAttack { penetration: base_armor, ..attack });
            let fully_penetrated = incoming_company_damage_multiplier(equipped,
                IncomingMilitaryAttack { penetration: base_armor + issued_armor, ..attack });
            let excess_penetration = incoming_company_damage_multiplier(equipped,
                IncomingMilitaryAttack { penetration: base_armor + issued_armor + 100.0, ..attack });
            assert!(at_base < partial && partial < fully_penetrated);
            assert!((fully_penetrated - unarmored).abs() < 1e-12);
            assert_eq!(fully_penetrated, excess_penetration);
        }
    }

    #[test]
    fn penetration_of_issued_armor_preserves_directional_shield_defense() {
        let defense = CompanyDefense {
            kind: MilitaryKind::Spearmen,
            member_seed: 7,
            extra_armor: 12.0,
            formation: MILITARY_FORMATION_LINE,
            stance: MILITARY_STANCE_BALANCED,
            level: 1,
            cohesion: 1.0,
            stationary: true,
        };
        let attack = IncomingMilitaryAttack {
            penetration: 100.0,
            ranged: false,
            frontal: true,
            charging: false,
        };
        for ranged in [false, true] {
            let front = IncomingMilitaryAttack { ranged, ..attack };
            let rear = IncomingMilitaryAttack { frontal: false, ..front };
            assert!(incoming_company_damage_multiplier(defense, front)
                < incoming_company_damage_multiplier(defense, rear));
            assert_eq!(incoming_company_damage_multiplier(defense, front),
                incoming_company_damage_multiplier(CompanyDefense { extra_armor: 0.0, ..defense }, front));
        }
    }

    #[test]
    fn charge_waits_through_cooldown_and_is_consumed_on_only_the_first_strike() {
        let (mut pending, hit) = resolve_melee_charge(0, 73, true, true, false);
        assert_eq!((pending, hit), (73, false));
        // The soldier has stopped advancing, but remains in contact while
        // cooldown runs down over several simulation heartbeats.
        for _ in 0..4 {
            let (next, hit) = resolve_melee_charge(pending, 73, true, false, false);
            assert_eq!((next, hit), (73, false));
            pending = next;
        }
        let (pending, hit) = resolve_melee_charge(pending, 73, true, false, true);
        assert_eq!((pending, hit), (0, true));
        assert_eq!(resolve_melee_charge(pending, 73, true, false, true), (0, false));
    }

    #[test]
    fn charge_can_strike_immediately_or_after_a_fresh_reengagement() {
        assert_eq!(resolve_melee_charge(0, 73, true, true, true), (0, true));
        let (pending, _) = resolve_melee_charge(0, 73, true, true, false);
        let (pending, hit) = resolve_melee_charge(pending, 73, false, false, false);
        assert_eq!((pending, hit), (0, false));
        assert_eq!(resolve_melee_charge(pending, 73, true, false, true), (0, false));
        assert_eq!(resolve_melee_charge(pending, 73, true, true, true), (0, true));
    }

    #[test]
    fn pending_charge_cannot_transfer_to_another_enemy_or_a_missile_shot() {
        assert_eq!(resolve_melee_charge(73, 74, true, false, true), (0, false));
        assert_eq!(resolve_melee_charge(73, 74, true, false, false), (0, false));
        assert_eq!(resolve_melee_charge(73, 73, false, false, true), (0, false));
        assert_eq!(resolve_melee_charge(0, 73, false, true, true), (0, false));
        assert_eq!(resolve_melee_charge(73, 0, true, false, true), (0, false));
        // A genuine new running contact may arm a different enemy.
        assert_eq!(resolve_melee_charge(73, 74, true, true, false), (74, false));
    }

    #[test]
    fn ordinary_melee_contact_does_not_award_a_charge() {
        assert_eq!(resolve_melee_charge(0, 73, true, false, false), (0, false));
        assert_eq!(resolve_melee_charge(0, 73, true, false, true), (0, false));
        assert_eq!(resolve_melee_charge(0, 0, true, true, true), (0, false));
    }

    #[test]
    fn front_flank_and_rear_are_distinct_in_every_orientation() {
        for (fx,fz) in [(0.0,1.0),(1.0,0.0),(0.0,-1.0),(-1.0,0.0)] {
            assert!(is_front_attack(fx,fz,0.0,0.0,fx*10.0,fz*10.0));
            assert!(is_rear_attack(fx,fz,0.0,0.0,-fx*10.0,-fz*10.0));
            assert!(!is_rear_attack(fx,fz,0.0,0.0,fz*10.0,-fx*10.0));
            assert!(!is_front_attack(fx,fz,0.0,0.0,fz*10.0,-fx*10.0));
        }
    }

    #[test]
    fn bracing_cancels_only_stationary_frontal_interceptions() {
        for kind in [MilitaryKind::Spearmen, MilitaryKind::Polearms, MilitaryKind::MercenarySpears] {
            assert!(bracing_cancels_charge(kind, MILITARY_FORMATION_BRACE, true, true));
            assert!(!bracing_cancels_charge(kind, MILITARY_FORMATION_BRACE, false, true));
            assert!(!bracing_cancels_charge(kind, MILITARY_FORMATION_BRACE, true, false));
            assert!(!bracing_cancels_charge(kind, MILITARY_FORMATION_LINE, true, true));
        }
    }

    #[test]
    fn arrow_lane_is_finite_and_allows_clear_shots() {
        assert_eq!(shot_lane_intersection(0.0,0.0,0.0,20.0,0.0,10.0), Some(0.5));
        for (x,z) in [(0.0,-5.0),(0.0,25.0),(2.0,10.0),(0.0,0.0)] {
            assert_eq!(shot_lane_intersection(0.0,0.0,0.0,20.0,x,z), None);
        }
    }

    #[test]
    fn missile_alert_doubles_evasion_and_stand_ground_trades_attack_speed() {
        for formation in [MILITARY_FORMATION_LINE, MILITARY_FORMATION_LOOSE] {
            assert_eq!(missile_evasion_chance(formation, MILITARY_STANCE_MISSILE_ALERT), 2.0 * missile_evasion_chance(formation, MILITARY_STANCE_BALANCED));
            let normal = (0..10000).filter(|t| missile_is_evaded(formation, 0, 17, 32, *t)).count();
            let alert = (0..10000).filter(|t| missile_is_evaded(formation, 4, 17, 32, *t)).count();
            assert!(alert > normal * 18 / 10 && alert < normal * 22 / 10);
        }
        assert_eq!(stance_damage_taken_multiplier(MILITARY_STANCE_STAND_GROUND, false), 0.5);
        assert_eq!(stance_attack_interval_multiplier(MILITARY_STANCE_STAND_GROUND), 2.0);
        assert_eq!(stance_damage_taken_multiplier(MILITARY_STANCE_MISSILE_ALERT, false), 2.0);
        assert!(stance_morale_required(MILITARY_STANCE_PUSH_FORWARD) > stance_morale_required(MILITARY_STANCE_BALANCED));
    }

    #[test]
    fn slope_favors_downhill_and_bounds_extremes() {
        assert!(slope_effectiveness(10.0,0.0,40.0) > 1.0);
        assert!(slope_effectiveness(0.0,10.0,40.0) < 1.0);
        assert_eq!(slope_effectiveness(10.0,10.0,40.0), 1.0);
        assert!(slope_effectiveness(0.0,10000.0,0.0) > 0.0);
    }

    #[test]
    fn militia_can_muster_short_without_optional_armor() {
        assert_eq!(militia_muster_size(5,3,8), 3);
        assert_eq!(militia_muster_size(5,8,2), 2);
        assert_eq!(militia_muster_size(5,8,0), 0);
        assert_eq!(optional_militia_armor(1,9,9), 0);
        assert_eq!(optional_militia_armor(2,9,9), 1);
        assert_eq!(optional_militia_armor(3,9,9), 2);
        assert_eq!(optional_militia_armor(3,1,0), 1);
        assert_eq!(optional_militia_armor(3,0,0), 0);
    }

    #[test]
    fn hired_outsiders_are_not_free_debug_troops() {
        assert!(is_debug_military_member("debug-company:7:0"));
        assert!(!is_debug_military_member("mercenary:7:0"));
        assert!(!is_debug_military_member("residence-7:person:0"));
    }
}
