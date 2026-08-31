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
pub const MILITARY_DEMAND_CAMPAIGN_BURDEN: u8 = 3;
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
        | MILITARY_DEMAND_FULL_UPKEEP
        | MILITARY_DEMAND_CAMPAIGN_BURDEN => value,
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
    UskokBorderInfantry = 8,
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
            8 => Some(Self::UskokBorderInfantry),
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
            Self::UskokBorderInfantry => 11,
        }
    }

    pub fn company_size(self) -> u32 {
        match self {
            Self::Militia => 5,
            Self::Spearmen | Self::MenAtArms | Self::MercenarySpears => 8,
            Self::Crossbows => 6,
            Self::Footmen | Self::Polearms | Self::Bowmen | Self::UskokBorderInfantry => 8,
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
                | Self::UskokBorderInfantry
        )
    }

    pub fn gains_veteran_experience(self) -> bool {
        !matches!(self, Self::Militia | Self::MercenarySpears)
    }
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
    pub preserved_food: u32,
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
                preserved_food: n * 2,
                gold: n,
                ..Self::default()
            },
            // Heavy holding infantry: sidearm, shield, and mail.
            MilitaryKind::MenAtArms => Self {
                sidearms: n,
                shields: n,
                mail_armor: n,
                ale: n,
                preserved_food: n * 3,
                gold: n * 4,
                ..Self::default()
            },
            // Crossbow companies carry a complete weapon and ammunition bundle.
            MilitaryKind::Crossbows => Self {
                crossbows: n,
                padded_armor: n,
                ammunition: n,
                ale: n.div_ceil(2),
                preserved_food: n * 3,
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
                preserved_food: n * 2,
                gold: n * 2,
                ..Self::default()
            },
            MilitaryKind::Polearms => Self {
                polearms: n,
                padded_armor: n,
                ale: n.div_ceil(2),
                preserved_food: n * 3,
                gold: n * 2,
                ..Self::default()
            },
            MilitaryKind::Bowmen => Self {
                bows: n,
                ammunition: n,
                preserved_food: n * 2,
                gold: n,
                ..Self::default()
            },
            // Uskoks are locally recruited frontier professionals, not a
            // supernatural regional buff: light matchlocks, korda sidearms,
            // ammunition and high wages buy mobile skirmishing power.
            MilitaryKind::UskokBorderInfantry => Self {
                polearms: n.div_ceil(2),
                sidearms: n,
                padded_armor: n,
                ammunition: n,
                ale: n,
                preserved_food: n * 3,
                gold: n * 4,
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
                cost.preserved_food = 0;
                cost.gold = 0;
            }
            MILITARY_DEMAND_LIGHT_RATIONS => {
                cost.ale = 0;
                cost.preserved_food = n;
                cost.gold = 0;
            }
            MILITARY_DEMAND_FULL_UPKEEP => {
                cost.ale = n.div_ceil(4);
                cost.preserved_food = n * 2;
            }
            MILITARY_DEMAND_CAMPAIGN_BURDEN => {
                cost.ale = n;
                cost.preserved_food = n * 2;
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

pub fn military_resupply_cost(living_soldiers: u32, demands: u8) -> MilitaryCost {
    let n = living_soldiers;
    match normalize_military_demands(demands) {
        MILITARY_DEMAND_MUSTER_ONLY => MilitaryCost::default(),
        MILITARY_DEMAND_LIGHT_RATIONS => MilitaryCost {
            preserved_food: n,
            ..MilitaryCost::default()
        },
        MILITARY_DEMAND_FULL_UPKEEP => MilitaryCost {
            ale: n.div_ceil(4),
            preserved_food: n * 2,
            ..MilitaryCost::default()
        },
        MILITARY_DEMAND_CAMPAIGN_BURDEN => MilitaryCost {
            ale: n,
            preserved_food: n * 2,
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
        MilitaryKind::UskokBorderInfantry => MilitaryStats {
            max_health: 72.0,
            damage: 15.5,
            // The ranged cadence includes priming, presenting and recovering
            // the light matchlock. Once ammunition is exhausted, the military
            // simulation switches to a faster korda melee cadence.
            attack_seconds: 2.80,
            speed: 2.78,
            acquisition_range: 16.0,
            strike_range: 13.5,
            starting_morale: 0.80,
            starting_cohesion: 0.69,
            damage_taken_multiplier: 0.88,
            ammunition_per_member: 8,
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
        MilitaryKind::UskokBorderInfantry => (6.0, 1.0, 10.0, 0.40, 0.05),
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
        (
            MilitaryKind::Bowmen,
            MilitaryKind::Militia | MilitaryKind::Polearms | MilitaryKind::UskokBorderInfantry,
        ) => 1.18,
        (MilitaryKind::UskokBorderInfantry, MilitaryKind::Crossbows | MilitaryKind::Bowmen) => 1.32,
        (MilitaryKind::UskokBorderInfantry, MilitaryKind::Footmen) => 1.14,
        (MilitaryKind::UskokBorderInfantry, MilitaryKind::Spearmen | MilitaryKind::MenAtArms) => {
            0.76
        }
        (MilitaryKind::Spearmen | MilitaryKind::MenAtArms, MilitaryKind::UskokBorderInfantry) => {
            1.24
        }
        _ => 1.0,
    }
}

pub const MILITARY_FORMATION_LINE: u8 = 0;
pub const MILITARY_FORMATION_COLUMN: u8 = 1;
pub const MILITARY_FORMATION_SHIELD_WALL: u8 = 2;
pub const MILITARY_FORMATION_LOOSE: u8 = 3;

/// Stable local offset for company orders. Formation is gameplay-relevant:
/// shield wall is dense, loose order gives missile spacing, and column moves
/// efficiently along narrow roads.
pub fn formation_offset(formation: u8, index: u32, count: u32) -> (f64, f64) {
    let count = count.max(1);
    match formation {
        MILITARY_FORMATION_COLUMN => (0.0, index as f64 * -1.35),
        MILITARY_FORMATION_SHIELD_WALL => {
            let center = (count.saturating_sub(1) as f64) * 0.5;
            ((index as f64 - center) * 1.05, 0.0)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_recruitment_path_has_a_real_limiting_cost() {
        for id in 0..=8 {
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
                + cost.preserved_food
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
        assert_eq!((easy.preserved_food, easy.ale, easy.gold), (0, 0, 0));

        let normal = MilitaryCost::for_company_with_demands(
            MilitaryKind::Spearmen,
            8,
            MILITARY_DEMAND_LIGHT_RATIONS,
        );
        assert_eq!((normal.preserved_food, normal.ale, normal.gold), (8, 0, 0));

        let hardcore = military_resupply_cost(8, MILITARY_DEMAND_CAMPAIGN_BURDEN);
        assert_eq!((hardcore.preserved_food, hardcore.ale), (16, 8));
        assert!(!local_company_requires_provisions(
            MilitaryKind::MercenarySpears,
            MILITARY_DEMAND_CAMPAIGN_BURDEN,
        ));
        assert!(company_wages_enabled(
            MilitaryKind::MercenarySpears,
            MILITARY_DEMAND_MUSTER_ONLY,
        ));
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
            MilitaryKind::UskokBorderInfantry,
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
    fn uskoks_fire_matchlocks_then_retain_a_sidearm_fallback() {
        let stats = military_stats(MilitaryKind::UskokBorderInfantry);
        let cost = MilitaryCost::for_company(MilitaryKind::UskokBorderInfantry, 8);
        assert_eq!(stats.ammunition_per_member, 8);
        assert!(stats.strike_range > 10.0);
        assert!(stats.attack_seconds > 2.0);
        assert_eq!(cost.ammunition, 8);
        assert_eq!(cost.sidearms, 8);
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
        assert!(
            matchup_damage_multiplier(MilitaryKind::MenAtArms, MilitaryKind::UskokBorderInfantry)
                > 1.0
        );
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
}
