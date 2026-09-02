use std::collections::{BTreeSet, HashSet};

use spacetimedb::{reducer, Identity, ReducerContext};

use crate::db::*;
use crate::economy::{
    available_building_labor, building_commodity_stock, spend_treasury_gold, total_ironwork,
    total_timber, treasury_gold, withdraw_building_commodity, CommodityKind,
};
use crate::military_policy::{
    formation_offset, formation_offset_for_kind, local_company_requires_provisions,
    member_combat_profile, military_day_ticks, military_formation_available,
    military_resupply_cost, military_stance_available, military_stats,
    normalize_military_demands, rotate_formation_offset, MilitaryCost, MilitaryKind,
    MERCENARY_MAX_CONTRACT_DAYS, MILITARY_FORMATION_BRACE, MILITARY_FORMATION_COLUMN,
    MILITARY_FORMATION_LINE, MILITARY_FORMATION_LOOSE, MILITARY_FORMATION_SHIELD_WALL,
    MILITARY_FORMATION_WEDGE, MILITARY_PROVISION_ISSUE_DAYS,
};
use crate::raid_agent_policy::playable_half_for_map_size;
use crate::roads::load_owner_road_network;
use crate::security_policy::RaidPortableStores;
use crate::simulation::building_fire_state;
use crate::simulation::serialize_route_polyline;
use crate::simulation::road_logistics::local_delivery_distance;
use crate::smallholding_policy::smallholding_assignable_population;
use crate::tables::{
    cavalry_horse, mercenary_contract, CavalryHorse, CombatAgent, MercenaryContract,
    MilitaryCompany, MilitaryMember, MilitiaOrder,
};

const MILITARY_HOLDING: u8 = 9;
const MILITARY_MUSTERING: u8 = 8;
const MAX_PLAYER_FORCE_ORDER: usize = 256;
const MAX_PLAYER_COMPANY_ORDER: usize = 12;

#[derive(Clone, Copy)]
struct ResidentRecruit {
    residence_id: u64,
    resident_slot: u32,
    x: f64,
    z: f64,
}

/// Emergency call-up. Each selected man walks from his household to the Town
/// Hall, receives one stored polearm there, and only then becomes controllable.
#[reducer]
pub fn raise_militia(
    ctx: &ReducerContext,
    town_hall_id: u64,
    requested: u32,
) -> Result<(), String> {
    let owner = ctx.sender();
    let hall = require_recruitment_building(ctx, owner, town_hall_id, "town_hall")?;
    let size = requested.clamp(1, 12);
    recruit_resident_company(ctx, owner, &hall, MilitaryKind::Militia, size, true)
}

/// Recruits a permanent resident-backed company at a completed guardhouse.
#[reducer]
pub fn recruit_military_company(
    ctx: &ReducerContext,
    guardhouse_id: u64,
    kind: u8,
) -> Result<(), String> {
    let owner = ctx.sender();
    let Some(kind) = MilitaryKind::from_id(kind) else {
        return Err("Unknown military company type.".into());
    };
    if !kind.requires_guardhouse() || !kind.requires_resident_men() {
        return Err("This company is not recruited from a guardhouse.".into());
    }
    let guardhouse = require_recruitment_building(ctx, owner, guardhouse_id, "guardhouse")?;
    recruit_resident_company(ctx, owner, &guardhouse, kind, kind.company_size(), false)
}

/// Recruits a six-rider resident company from a completed Cavalry Yard. One
/// real, unassigned horse in a connected Pastoral Farmstead pasture is paired
/// transactionally with each man before both travel to the yard to muster.
#[reducer]
pub fn recruit_cavalry_company(
    ctx: &ReducerContext,
    cavalry_yard_id: u64,
    kind: u8,
) -> Result<(), String> {
    let owner = ctx.sender();
    let Some(kind) = MilitaryKind::from_id(kind) else {
        return Err("Unknown military company type.".into());
    };
    if !kind.requires_cavalry_yard() || !kind.requires_resident_men() {
        return Err("This company is not recruited from a Cavalry Yard.".into());
    }
    let yard = require_recruitment_building(ctx, owner, cavalry_yard_id, "cavalry_yard")?;
    if yard.assigned_labor == 0 {
        return Err("Assign at least one groom before forming mounted troops.".into());
    }
    recruit_resident_company(ctx, owner, &yard, kind, kind.company_size(), false)
}

/// Hired spear companies are the sole non-resident force. They enter at the
/// safest map edge, away from both the town footprint and active bandit camps.
#[reducer]
pub fn hire_mercenary_company(ctx: &ReducerContext, town_hall_id: u64) -> Result<(), String> {
    let owner = ctx.sender();
    let hall = require_recruitment_building(ctx, owner, town_hall_id, "town_hall")?;
    let kind = MilitaryKind::MercenarySpears;
    let size = kind.company_size();
    let cost = MilitaryCost::for_company(kind, size);
    require_cost(ctx, owner, cost)?;
    spend_cost(ctx, owner, cost)?;
    let tick = sim_tick(ctx);
    let stats = military_stats(kind);
    let (entry_x, entry_z) = mercenary_entry_point(ctx, owner, &hall, tick);
    let company = ctx.db.military_company().insert(MilitaryCompany {
        id: 0,
        owner,
        kind: kind as u8,
        source_building_id: hall.id,
        state: 1,
        departure_requested: false,
        formation: MILITARY_FORMATION_LINE,
        formation_columns: 0,
        running: false,
        fire_at_will: false,
        stance: 0,
        facing_x: 0.0,
        facing_z: 1.0,
        target_size: size,
        living_members: size,
        morale: stats.starting_morale,
        cohesion: stats.starting_cohesion,
        fatigue: 0.0,
        provision_days: 0.0,
        horse_oats: 0.0,
        horse_water: 0.0,
        ammunition: 0,
        ammunition_capacity: 0,
        formed_tick: tick,
        last_upkeep_tick: tick,
        experience: 0,
        level: 1,
        battle_started_tick: 0,
        last_combat_tick: 0,
    });
    ctx.db.mercenary_contract().insert(MercenaryContract {
        company_id: company.id,
        owner,
        contract_end_tick: tick
            .saturating_add(military_day_ticks().saturating_mul(MERCENARY_MAX_CONTRACT_DAYS)),
        last_engagement_tick: tick,
    });
    for slot in 0..size {
        let (ox, oz) = formation_offset(MILITARY_FORMATION_LINE, slot, size);
        let kit = mercenary_kit();
        let profile = member_combat_profile(kind, company.id.rotate_left(31) ^ slot as u64);
        let agent = ctx.db.combat_agent().insert(CombatAgent {
            id: 0,
            owner,
            raid_id: company.id,
            faction: kind.faction(),
            source_building_id: hall.id,
            source_slot: slot,
            resident_slot: 0,
            assigned_building_id: 0,
            target_kind: 6,
            target_id: 0,
            engagement_target_id: 0,
            x: entry_x + ox,
            z: entry_z + oz,
            velocity_x: 0.0,
            velocity_z: 0.0,
            home_x: entry_x,
            home_z: entry_z,
            health: profile.max_health,
            max_health: profile.max_health,
            readiness: stats.starting_morale,
            state: MILITARY_HOLDING,
            attack_cooldown: 0.0,
            loot_progress: 0.0,
            loot_fraction: 0.0,
            carried_loot_json: serde_json::to_string(&kit).unwrap_or_default(),
            state_changed_tick: tick,
            route_progress: 0.0,
            raid_anchor_building_id: 0,
        });
        ctx.db.military_member().insert(MilitaryMember {
            combat_agent_id: agent.id,
            owner,
            company_id: company.id,
            residence_id: 0,
            resident_slot: slot,
            person_identity: format!("mercenary:{}:{slot}", company.id),
            optional_armor: 0,
            phase: 1,
            ammunition: 0,
            ammunition_capacity: 0,
            original_home_x: entry_x,
            original_home_z: entry_z,
        });
    }
    Ok(())
}

/// Creates a fully fielded, cost-free company at an exact debug-menu map
/// position. Debug companies deliberately use non-resident members so a
/// playtest does not rewrite household population or labor assignments.
pub fn deploy_debug_military_company(
    ctx: &ReducerContext,
    owner: Identity,
    kind_id: u8,
    x: f64,
    z: f64,
) -> Result<u64, String> {
    let kind = MilitaryKind::from_id(kind_id)
        .ok_or_else(|| "Unknown military company type.".to_string())?;
    let size = kind.company_size();
    let tick = sim_tick(ctx);
    let stats = military_stats(kind);
    let formation = if kind.is_ranged() {
        MILITARY_FORMATION_LOOSE
    } else {
        MILITARY_FORMATION_LINE
    };
    let source_building_id = ctx
        .db
        .building()
        .owner()
        .filter(&owner)
        .filter(|building| {
            building.construction_complete
                && (!kind.is_mounted() || building.kind == "cavalry_yard")
        })
        .min_by(|left, right| {
            point_distance(left.x, left.z, x, z)
                .total_cmp(&point_distance(right.x, right.z, x, z))
                .then_with(|| left.id.cmp(&right.id))
        })
        .map_or(0, |building| building.id);
    let ammunition_capacity = stats.ammunition_per_member.saturating_mul(size);
    let company = ctx.db.military_company().insert(MilitaryCompany {
        id: 0,
        owner,
        kind: kind as u8,
        source_building_id,
        state: 1,
        departure_requested: false,
        formation,
        formation_columns: 0,
        running: false,
        fire_at_will: false,
        stance: 0,
        facing_x: 0.0,
        facing_z: 1.0,
        target_size: size,
        living_members: size,
        morale: stats.starting_morale,
        cohesion: stats.starting_cohesion,
        fatigue: 0.0,
        provision_days: 30.0,
        horse_oats: 0.0,
        horse_water: 0.0,
        ammunition: ammunition_capacity,
        ammunition_capacity,
        formed_tick: tick,
        last_upkeep_tick: tick,
        experience: 0,
        level: 1,
        battle_started_tick: 0,
        last_combat_tick: 0,
    });
    if kind == MilitaryKind::MercenarySpears {
        ctx.db.mercenary_contract().insert(MercenaryContract {
            company_id: company.id,
            owner,
            contract_end_tick: tick
                .saturating_add(military_day_ticks().saturating_mul(MERCENARY_MAX_CONTRACT_DAYS)),
            last_engagement_tick: tick,
        });
    }
    for slot in 0..size {
        let (ox, oz) = formation_offset_for_kind(kind, formation, slot, size);
        let profile = member_combat_profile(kind, company.id.rotate_left(31) ^ slot as u64);
        let agent = ctx.db.combat_agent().insert(CombatAgent {
            id: 0,
            owner,
            raid_id: company.id,
            faction: kind.faction(),
            source_building_id,
            source_slot: slot,
            resident_slot: 0,
            assigned_building_id: 0,
            target_kind: 6,
            target_id: 0,
            engagement_target_id: 0,
            x: x + ox,
            z: z + oz,
            velocity_x: 0.0,
            velocity_z: 0.0,
            home_x: x,
            home_z: z,
            health: profile.max_health,
            max_health: profile.max_health,
            readiness: stats.starting_morale,
            state: MILITARY_HOLDING,
            attack_cooldown: 0.0,
            loot_progress: 0.0,
            loot_fraction: 0.0,
            carried_loot_json: serde_json::to_string(&RaidPortableStores::default())
                .unwrap_or_default(),
            state_changed_tick: tick,
            route_progress: 0.0,
            raid_anchor_building_id: 0,
        });
        ctx.db.military_member().insert(MilitaryMember {
            combat_agent_id: agent.id,
            owner,
            company_id: company.id,
            residence_id: 0,
            resident_slot: slot,
            person_identity: format!("debug-company:{}:{slot}", company.id),
            optional_armor: 0,
            phase: 1,
            ammunition: stats.ammunition_per_member,
            ammunition_capacity: stats.ammunition_per_member,
            original_home_x: x,
            original_home_z: z,
        });
        if kind.is_mounted() {
            ctx.db.cavalry_horse().insert(CavalryHorse {
                id: 0,
                owner,
                pasture_id: 0,
                slot: slot as u8,
                at_pasture: false,
                assigned_company_id: company.id,
                assigned_combat_agent_id: agent.id,
            });
        }
    }
    Ok(company.id)
}

#[reducer]
pub fn set_military_formation(
    ctx: &ReducerContext,
    company_id: u64,
    formation: u8,
) -> Result<(), String> {
    if !matches!(
        formation,
        MILITARY_FORMATION_LINE
            | MILITARY_FORMATION_COLUMN
            | MILITARY_FORMATION_SHIELD_WALL
            | MILITARY_FORMATION_LOOSE
            | MILITARY_FORMATION_BRACE
            | MILITARY_FORMATION_WEDGE
    ) {
        return Err("Unknown military formation.".into());
    }
    let owner = ctx.sender();
    let mut company = owned_company(ctx, owner, company_id)?;
    if company.state >= 2 {
        return Err("A disbanding company cannot change formation.".into());
    }
    let kind = MilitaryKind::from_id(company.kind).ok_or("Unknown military company type.")?;
    if !military_formation_available(kind, formation) {
        return Err("This formation is not available to this company type.".into());
    }
    company.formation = formation;
    company.formation_columns = 0;
    ctx.db.military_company().id().update(company.clone());
    reform_company_at_current_position(ctx, &company);
    Ok(())
}

#[reducer]
pub fn set_military_stance(
    ctx: &ReducerContext,
    company_id: u64,
    stance: u8,
) -> Result<(), String> {
    let owner = ctx.sender();
    let mut company = owned_company(ctx, owner, company_id)?;
    if company.state >= 2 {
        return Err("A disbanding company cannot change stance.".into());
    }
    let kind = MilitaryKind::from_id(company.kind).ok_or("Unknown military company type.")?;
    if !military_stance_available(kind, stance) {
        return Err("This stance is not available to this company type.".into());
    }
    if company.morale < crate::military_policy::stance_morale_required(stance) {
        return Err("This company is too shaken to adopt that stance.".into());
    }
    company.stance = stance;
    ctx.db.military_company().id().update(company);
    Ok(())
}

#[reducer]
pub fn set_military_tactics(ctx: &ReducerContext, company_id: u64, running: bool, fire_at_will: bool) -> Result<(), String> {
    let mut company = owned_company(ctx, ctx.sender(), company_id)?;
    if company.state >= 2 { return Err("This company is leaving service.".into()); }
    let kind = MilitaryKind::from_id(company.kind).ok_or("Unknown military company type.")?;
    if fire_at_will && !kind.is_ranged() { return Err("Only missile companies can change their firing policy.".into()); }
    if running && company.fatigue >= 0.95 { return Err("This company must rest before running.".into()); }
    company.running = running;
    company.fire_at_will = fire_at_will;
    ctx.db.military_company().id().update(company);
    Ok(())
}

#[reducer]
pub fn deploy_military_formation(ctx: &ReducerContext, agent_ids: Vec<u64>, destination_x: f64, destination_z: f64, facing_x: f64, facing_z: f64, frontage: f64) -> Result<(), String> {
    if !frontage.is_finite() || !(0.5..=200.0).contains(&frontage)
        || !facing_x.is_finite() || !facing_z.is_finite() || !facing_x.hypot(facing_z).is_finite() || facing_x.hypot(facing_z) < 0.001 {
        return Err("Invalid formation frontage or facing.".into());
    }
    command_companies(ctx, agent_ids, destination_x, destination_z, 0, 0, Some((facing_x, facing_z, frontage)))
}

/// Shared RTS company-order endpoint. Agent ids are only selection witnesses: naming
/// any active member expands the order to his entire company, because a company
/// is the smallest player-controllable military unit.
#[reducer]
pub fn command_militia(
    ctx: &ReducerContext,
    agent_ids: Vec<u64>,
    destination_x: f64,
    destination_z: f64,
    target_camp_id: u64,
    target_agent_id: u64,
) -> Result<(), String> {
    command_companies(ctx, agent_ids, destination_x, destination_z, target_camp_id, target_agent_id, None)
}

fn command_companies(ctx: &ReducerContext, agent_ids: Vec<u64>, destination_x: f64, destination_z: f64, target_camp_id: u64, target_agent_id: u64, deployment: Option<(f64, f64, f64)>) -> Result<(), String> {
    if !destination_x.is_finite() || !destination_z.is_finite() {
        return Err("Military destination must be finite.".into());
    }
    let owner = ctx.sender();
    if target_camp_id != 0 && target_agent_id != 0 {
        return Err("A military order can target either a camp or a hostile company, not both.".into());
    }
    let target = if target_camp_id == 0 {
        None
    } else {
        Some(ctx.db
            .bandit_camp()
            .id()
            .find(&target_camp_id)
            .filter(|camp| camp.owner == owner && camp.active)
            .ok_or("The selected bandit camp is no longer available.")?)
    };
    let target_agent = if target_agent_id == 0 {
        None
    } else {
        Some(
            ctx.db
                .combat_agent()
                .id()
                .find(&target_agent_id)
                .filter(|agent| {
                    agent.owner == owner
                        && matches!(agent.faction, 1 | 2 | 13 | 14)
                        && agent.state != 5
                        && agent.health > 0.0
                })
                .ok_or("The selected hostile is no longer available.")?,
        )
    };
    let mut company_ids = BTreeSet::new();
    for id in agent_ids.into_iter().take(MAX_PLAYER_FORCE_ORDER) {
        let Some(agent) = ctx.db.combat_agent().id().find(&id) else {
            continue;
        };
        let Some(member) = ctx.db.military_member().combat_agent_id().find(&id) else {
            continue;
        };
        if agent.owner == owner && member.owner == owner && agent.state != 5 && member.phase == 1 {
            company_ids.insert(member.company_id);
            if company_ids.len() >= MAX_PLAYER_COMPANY_ORDER {
                break;
            }
        }
    }
    let road_network = load_owner_road_network(ctx, owner);
    let navigation = crate::simulation::build_owner_combat_navigation(ctx, owner, road_network.as_ref());
    let company_count = company_ids.len() as u32;
    let company_spacing = if let Some((_, _, frontage)) = deployment {
        frontage / company_count.max(1) as f64 + 2.5
    } else {
        company_ids.iter().filter_map(|id| ctx.db.military_company().id().find(id))
            .filter_map(|company| {
                let kind = MilitaryKind::from_id(company.kind)?;
                let count = company.living_members.max(1);
                let mut bounds = (0.0_f64, 0.0_f64);
                for slot in 0..count {
                    let offset = crate::military_policy::deployed_formation_offset(kind, company.formation, company.formation_columns, slot, count);
                    bounds.0 = bounds.0.min(offset.0);
                    bounds.1 = bounds.1.max(offset.0);
                }
                Some(bounds.1 - bounds.0 + 2.5)
            }).fold(5.0_f64, f64::max)
    };
    let mut orders_issued = 0_u32;
    for (company_index, company_id) in company_ids.into_iter().enumerate() {
        let Some(mut company) = ctx
            .db
            .military_company()
            .id()
            .find(&company_id)
            .filter(|row| row.owner == owner && row.state == 1)
        else {
            continue;
        };
        let mut company_members = ctx
            .db
            .military_member()
            .company_id()
            .filter(&company_id)
            .filter_map(|member| {
                if member.owner != owner || member.phase != 1 {
                    return None;
                }
                let agent = ctx.db.combat_agent().id().find(&member.combat_agent_id)?;
                (agent.owner == owner && agent.state != 5).then_some((agent, member))
            })
            .collect::<Vec<_>>();
        company_members.sort_by_key(|(agent, _)| agent.source_slot);
        let member_count = company_members.len() as u32;
        let (current_x, current_z) = company_center(&company_members);
        let order_center_x = target_agent.as_ref().map_or_else(
            || target.as_ref().map_or(destination_x, |camp| camp.x),
            |enemy| enemy.x,
        );
        let order_center_z = target_agent.as_ref().map_or_else(
            || target.as_ref().map_or(destination_z, |camp| camp.z),
            |enemy| enemy.z,
        );
        let direction_x = order_center_x - current_x;
        let direction_z = order_center_z - current_z;
        let direction_length = direction_x.hypot(direction_z);
        if let Some((fx, fz, frontage)) = deployment {
            let kind = MilitaryKind::from_id(company.kind).ok_or("Unknown military company type.")?;
            let spacing = match company.formation {
                MILITARY_FORMATION_LOOSE => 2.8,
                MILITARY_FORMATION_SHIELD_WALL => 1.05,
                MILITARY_FORMATION_BRACE => 1.25,
                _ => 1.55,
            } * if kind.is_mounted() { 1.55 } else { 1.0 };
            company.facing_x = fx / fx.hypot(fz);
            company.facing_z = fz / fx.hypot(fz);
            // Dragging authors a rectangular line; wedge remains a dedicated preset.
            if company.formation == MILITARY_FORMATION_WEDGE || company.formation == MILITARY_FORMATION_COLUMN {
                company.formation = MILITARY_FORMATION_LINE;
            }
            company.formation_columns = ((frontage / company_count.max(1) as f64 / spacing).floor() as u32 + 1).clamp(1, member_count.max(1));
            ctx.db.military_company().id().update(company.clone());
        } else if direction_length > 1e-6 {
            company.facing_x = direction_x / direction_length;
            company.facing_z = direction_z / direction_length;
            ctx.db.military_company().id().update(company.clone());
        }
        let company_lateral =
            (company_index as f64 - company_count.saturating_sub(1) as f64 * 0.5) * company_spacing;
        let (company_offset_x, company_offset_z) = rotate_formation_offset(
            company_lateral,
            0.0,
            company.facing_x,
            company.facing_z,
        );
        for (member_index, (mut agent, _member)) in company_members.into_iter().enumerate() {
            let Some(company_kind) = MilitaryKind::from_id(company.kind) else {
                continue;
            };
            let (member_x, member_z) = crate::military_policy::deployed_formation_offset(
                company_kind,
                company.formation,
                company.formation_columns,
                member_index as u32,
                member_count,
            );
            let (member_x, member_z) = rotate_formation_offset(
                member_x,
                member_z,
                company.facing_x,
                company.facing_z,
            );
            let (center_x, center_z, camp_id, hostile_id, order_kind) = if let Some(enemy) = &target_agent {
                (enemy.x, enemy.z, 0, enemy.id, 2)
            } else if let Some(camp) = &target {
                (camp.x, camp.z, camp.id, 0, 1)
            } else {
                (destination_x, destination_z, 0, 0, 0)
            };
            let (x, z) = navigation.outside((
                center_x + company_offset_x + member_x,
                center_z + company_offset_z + member_z,
            ));
            let route = (hostile_id == 0)
                .then(|| {
                    road_network
                        .as_ref()
                        .and_then(|network| network.road_path_route(agent.x, agent.z, x, z))
                })
                .flatten();
            let (path_distance, route_polyline_json) = route.map_or_else(
                || (0.0, String::new()),
                |route| {
                    (
                        route.distance,
                        serialize_route_polyline(&route.polyline),
                    )
                },
            );
            agent.target_kind = match order_kind {
                1 => 5,
                2 => 7,
                _ => 6,
            };
            agent.target_id = if hostile_id > 0 { hostile_id } else { camp_id };
            agent.engagement_target_id = hostile_id;
            agent.state = 0;
            orders_issued += 1;
            ctx.db.combat_agent().id().update(agent.clone());
            let order = MilitiaOrder {
                combat_agent_id: agent.id,
                owner,
                kind: order_kind,
                destination_x: x,
                destination_z: z,
                target_camp_id: camp_id,
                target_agent_id: hostile_id,
                path_distance,
                route_polyline_json,
            };
            if ctx
                .db
                .militia_order()
                .combat_agent_id()
                .find(&agent.id)
                .is_some()
            {
                ctx.db.militia_order().combat_agent_id().update(order);
            } else {
                ctx.db.militia_order().insert(order);
            }
        }
    }
    if orders_issued == 0 { return Err("No selected company can receive orders.".into()); }
    Ok(())
}

#[reducer]
pub fn disband_military_company(ctx: &ReducerContext, company_id: u64) -> Result<(), String> {
    let owner = ctx.sender();
    let company = owned_company(ctx, owner, company_id)?;
    if MilitaryKind::from_id(company.kind) == Some(MilitaryKind::MercenarySpears) {
        let tick = sim_tick(ctx);
        let mut pending_company = company.clone();
        pending_company.departure_requested = true;
        ctx.db.military_company().id().update(pending_company);
        let requested = MercenaryContract {
            company_id,
            owner,
            contract_end_tick: tick,
            last_engagement_tick: ctx
                .db
                .mercenary_contract()
                .company_id()
                .find(&company_id)
                .map_or(tick, |contract| contract.last_engagement_tick),
        };
        if ctx
            .db
            .mercenary_contract()
            .company_id()
            .find(&company_id)
            .is_some()
        {
            ctx.db
                .mercenary_contract()
                .company_id()
                .update(requested);
        } else {
            ctx.db.mercenary_contract().insert(requested);
        }
        return Ok(());
    }
    begin_disband(ctx, owner, company_id)
}

/// Re-signs a mercenary company while its surviving members are still inside
/// the playable region. The two-day retainer makes a last-minute reversal a
/// meaningful choice without charging the full initial recruitment fee again.
#[reducer]
pub fn renew_mercenary_contract(ctx: &ReducerContext, company_id: u64) -> Result<(), String> {
    let owner = ctx.sender();
    let mut company = owned_company(ctx, owner, company_id)?;
    if MilitaryKind::from_id(company.kind) != Some(MilitaryKind::MercenarySpears) {
        return Err("Only a mercenary contract can be renewed.".into());
    }
    if company.state != 2 && !company.departure_requested {
        return Err("This mercenary company is not currently leaving the region.".into());
    }
    let mut survivors = ctx
        .db
        .military_member()
        .company_id()
        .filter(&company.id)
        .filter_map(|member| {
            let agent = ctx.db.combat_agent().id().find(&member.combat_agent_id)?;
            (agent.state != 5).then_some((member, agent))
        })
        .collect::<Vec<_>>();
    if survivors.is_empty() {
        return Err("The mercenary company has already left the region.".into());
    }
    let retainer = (survivors.len() as u32).saturating_mul(2);
    spend_treasury_gold(ctx, owner, retainer as f64)?;
    let tick = sim_tick(ctx);
    company.state = 1;
    company.departure_requested = false;
    company.living_members = survivors.len() as u32;
    company.last_upkeep_tick = tick;
    company.morale = company.morale.max(0.58);
    company.cohesion = company.cohesion.max(0.52);
    ctx.db.military_company().id().update(company.clone());
    for (mut member, mut agent) in survivors.drain(..) {
        ctx.db.militia_order().combat_agent_id().delete(agent.id);
        member.phase = 1;
        ctx.db.military_member().combat_agent_id().update(member);
        agent.state = MILITARY_HOLDING;
        agent.target_kind = 6;
        agent.target_id = 0;
        agent.state_changed_tick = tick;
        agent.route_progress = 0.0;
        ctx.db.combat_agent().id().update(agent);
    }
    let renewed = MercenaryContract {
        company_id: company.id,
        owner,
        contract_end_tick: tick
            .saturating_add(military_day_ticks().saturating_mul(MERCENARY_MAX_CONTRACT_DAYS)),
        last_engagement_tick: tick,
    };
    if ctx
        .db
        .mercenary_contract()
        .company_id()
        .find(&company.id)
        .is_some()
    {
        ctx.db.mercenary_contract().company_id().update(renewed);
    } else {
        ctx.db.mercenary_contract().insert(renewed);
    }
    Ok(())
}

/// Legacy convenience action: dismiss every militia company, while leaving
/// paid professional companies under their own roster controls.
#[reducer]
pub fn disband_militia(ctx: &ReducerContext) -> Result<(), String> {
    let owner = ctx.sender();
    let ids = ctx
        .db
        .military_company()
        .owner()
        .filter(&owner)
        .filter(|company| company.kind == MilitaryKind::Militia as u8 && company.state < 2)
        .map(|company| company.id)
        .collect::<Vec<_>>();
    for id in ids {
        begin_disband(ctx, owner, id)?;
    }
    Ok(())
}

/// Restores a surviving permanent company to its established size. Recruits
/// remain unavailable for orders until replacement equipment physically
/// reaches the original mustering building.
#[reducer]
pub fn reinforce_military_company(ctx: &ReducerContext, company_id: u64) -> Result<(), String> {
    let owner = ctx.sender();
    let company = owned_company(ctx, owner, company_id)?;
    if company.state != 1 {
        return Err("Only an active company can receive reinforcements.".into());
    }
    let kind = MilitaryKind::from_id(company.kind).ok_or("Unknown company type.")?;
    if matches!(kind, MilitaryKind::Militia | MilitaryKind::MercenarySpears) {
        return Err("This company type cannot recruit permanent replacements.".into());
    }
    let source_kind = if kind.requires_cavalry_yard() {
        "cavalry_yard"
    } else if kind.requires_guardhouse() {
        "guardhouse"
    } else {
        return Err("This company has no permanent recruitment building.".into());
    };
    let source = require_recruitment_building(
        ctx,
        owner,
        company.source_building_id,
        source_kind,
    )?;
    if kind.is_mounted() && source.assigned_labor == 0 {
        return Err("Assign at least one groom before reinforcing mounted troops.".into());
    }
    let living = ctx
        .db
        .military_member()
        .company_id()
        .filter(&company.id)
        .filter(|member| {
            ctx.db
                .combat_agent()
                .id()
                .find(&member.combat_agent_id)
                .is_some_and(|agent| agent.state != 5 && agent.health > 0.0)
        })
        .count() as u32;
    let missing = company.target_size.saturating_sub(living);
    if missing == 0 {
        return Err("This company is already at full strength.".into());
    }
    let recruits = select_available_men(ctx, owner, source.settlement_id, missing);
    if recruits.len() < missing as usize {
        return Err(format!(
            "Only {} unassigned adult men are available; {} replacements are required.",
            recruits.len(),
            missing
        ));
    }
    let mut mounts = if kind.is_mounted() {
        let available = available_pasture_horses_for_yard(ctx, owner, &source);
        if available.len() < missing as usize {
            return Err(format!(
                "Only {} unassigned horses are physically ready; {} replacements are required.",
                available.len(),
                missing
            ));
        }
        available
    } else {
        Vec::new()
    };
    let demands = military_demands(ctx);
    let cost = MilitaryCost::for_company_with_demands(kind, missing, demands);
    require_cost(ctx, owner, cost)?;
    spend_non_equipment_cost(ctx, owner, cost)?;
    let tick = sim_tick(ctx);
    let stats = military_stats(kind);
    let first_formation_slot = ctx
        .db
        .military_member()
        .company_id()
        .filter(&company.id)
        .filter_map(|member| {
            ctx.db
                .combat_agent()
                .id()
                .find(&member.combat_agent_id)
                .map(|agent| agent.source_slot)
        })
        .max()
        .map_or(0, |slot| slot.saturating_add(1));
    for (index, recruit) in recruits.into_iter().take(missing as usize).enumerate() {
        let formation_slot = first_formation_slot.saturating_add(index as u32);
        let profile = member_combat_profile(
            kind,
            company.id.rotate_left(31) ^ recruit.residence_id ^ recruit.resident_slot as u64,
        );
        let agent = ctx.db.combat_agent().insert(CombatAgent {
            id: 0,
            owner,
            raid_id: company.id,
            faction: kind.faction(),
            source_building_id: source.id,
            source_slot: formation_slot,
            resident_slot: recruit.resident_slot,
            assigned_building_id: 0,
            target_kind: 0,
            target_id: source.id,
            engagement_target_id: 0,
            x: recruit.x,
            z: recruit.z,
            velocity_x: 0.0,
            velocity_z: 0.0,
            home_x: recruit.x,
            home_z: recruit.z,
            health: profile.max_health,
            max_health: profile.max_health,
            readiness: company.morale,
            state: MILITARY_MUSTERING,
            attack_cooldown: 0.0,
            loot_progress: 0.0,
            loot_fraction: 0.0,
            carried_loot_json: serde_json::to_string(&RaidPortableStores::default())
                .unwrap_or_default(),
            state_changed_tick: tick,
            route_progress: 0.0,
            raid_anchor_building_id: recruit.residence_id,
        });
        ctx.db.military_member().insert(MilitaryMember {
            combat_agent_id: agent.id,
            owner,
            company_id: company.id,
            residence_id: recruit.residence_id,
            resident_slot: recruit.resident_slot,
            person_identity: format!(
                "residence-{}:person:{}",
                recruit.residence_id, recruit.resident_slot
            ),
            optional_armor: 0,
            phase: 0,
            ammunition: 0,
            ammunition_capacity: stats.ammunition_per_member,
            original_home_x: recruit.x,
            original_home_z: recruit.z,
        });
        if let Some(mount) = mounts.get_mut(index) {
            mount.assigned_company_id = company.id;
            mount.assigned_combat_agent_id = agent.id;
            ctx.db.cavalry_horse().id().update(mount.clone());
        }
    }
    Ok(())
}

/// Issues the configured field ration package and restores ranged ammunition.
#[reducer]
pub fn resupply_military_company(ctx: &ReducerContext, company_id: u64) -> Result<(), String> {
    let owner = ctx.sender();
    let mut company = owned_company(ctx, owner, company_id)?;
    if company.state >= 2 || company.living_members == 0 {
        return Err("This company cannot be resupplied.".into());
    }
    let kind = MilitaryKind::from_id(company.kind).ok_or("Unknown company type.")?;
    if matches!(kind, MilitaryKind::Militia | MilitaryKind::MercenarySpears) {
        return Err("This company does not draw local field provisions.".into());
    }
    let mut living_members = ctx
        .db
        .military_member()
        .company_id()
        .filter(&company.id)
        .filter_map(|member| {
            if member.phase != 1 {
                return None;
            }
            let agent = ctx.db.combat_agent().id().find(&member.combat_agent_id)?;
            (agent.state != 5 && agent.health > 0.0).then_some((member, agent))
        })
        .collect::<Vec<_>>();
    company.living_members = living_members.len() as u32;
    company.ammunition = living_members
        .iter()
        .map(|(member, _)| member.ammunition)
        .sum();
    company.ammunition_capacity = living_members
        .iter()
        .map(|(member, _)| member.ammunition_capacity)
        .sum();
    let demands = military_demands(ctx);
    let requires_provisions = local_company_requires_provisions(kind, demands);
    let missing_ammunition = company
        .ammunition_capacity
        .saturating_sub(company.ammunition);
    let ammunition_bundles = if kind.is_ranged() {
        missing_ammunition.div_ceil(military_stats(kind).ammunition_per_member.max(1))
    } else {
        0
    };
    if !requires_provisions && ammunition_bundles == 0 {
        return Err("This world does not require field provisions for this company.".into());
    }
    let mut cost = military_resupply_cost(company.living_members, demands);
    cost.ammunition = ammunition_bundles;
    require_cost(ctx, owner, cost)?;
    spend_cost(ctx, owner, cost)?;
    if requires_provisions {
        company.provision_days = MILITARY_PROVISION_ISSUE_DAYS;
    }
    company.ammunition = company.ammunition_capacity;
    ctx.db.military_company().id().update(company.clone());
    if kind.is_ranged() {
        for (mut member, mut agent) in living_members.drain(..) {
            member.ammunition = member.ammunition_capacity;
            if let Ok(mut stores) = serde_json::from_str::<RaidPortableStores>(&agent.carried_loot_json) {
                stores.ammunition = if member.ammunition_capacity > 0 { 1.0 } else { 0.0 };
                agent.carried_loot_json = serde_json::to_string(&stores).unwrap_or_default();
                ctx.db.combat_agent().id().update(agent);
            }
            ctx.db.military_member().combat_agent_id().update(member);
        }
    }
    Ok(())
}

fn recruit_resident_company(
    ctx: &ReducerContext,
    owner: Identity,
    source: &crate::tables::Building,
    kind: MilitaryKind,
    size: u32,
    _walk_to_muster: bool,
) -> Result<(), String> {
    let mut mounts = if kind.is_mounted() {
        let available = available_pasture_horses_for_yard(ctx, owner, source);
        if available.len() < size as usize {
            return Err(format!(
                "Only {} unassigned horses are physically ready in connected horse pastures; {} are required.",
                available.len(),
                size
            ));
        }
        available
    } else {
        Vec::new()
    };
    let target_size = size;
    let mut recruits = select_available_men(ctx, owner, source.settlement_id, size);
    let size = if kind == MilitaryKind::Militia {
        crate::military_policy::militia_muster_size(size, recruits.len() as u32, aggregate_commodity_stock(ctx, owner, CommodityKind::Polearms).floor() as u32)
    } else { size };
    if size == 0 { return Err("No available men with polearms can answer the muster.".into()); }
    recruits.truncate(size as usize);
    if recruits.len() < size as usize {
        return Err(format!(
            "Only {} unassigned adult men are available; {} are required.",
            recruits.len(),
            size
        ));
    }
    let demands = military_demands(ctx);
    let cost = MilitaryCost::for_company_with_demands(kind, size, demands);
    require_cost(ctx, owner, cost)?;
    spend_non_equipment_cost(ctx, owner, cost)?;
    let tick = sim_tick(ctx);
    let stats = military_stats(kind);
    let ammunition_capacity = stats.ammunition_per_member.saturating_mul(size);
    let company = ctx.db.military_company().insert(MilitaryCompany {
        id: 0,
        owner,
        kind: kind as u8,
        source_building_id: source.id,
        state: 0,
        departure_requested: false,
        formation: if kind.is_ranged() {
            MILITARY_FORMATION_LOOSE
        } else {
            MILITARY_FORMATION_LINE
        },
        formation_columns: 0,
        running: false,
        fire_at_will: false,
        stance: 0,
        facing_x: 0.0,
        facing_z: 1.0,
        target_size,
        living_members: size,
        morale: stats.starting_morale,
        cohesion: stats.starting_cohesion,
        fatigue: 0.0,
        provision_days: if local_company_requires_provisions(kind, demands) {
            MILITARY_PROVISION_ISSUE_DAYS
        } else {
            0.0
        },
        horse_oats: 0.0,
        horse_water: 0.0,
        ammunition: 0,
        ammunition_capacity,
        formed_tick: tick,
        last_upkeep_tick: tick,
        experience: 0,
        level: 1,
        battle_started_tick: 0,
        last_combat_tick: 0,
    });
    let mut padded_available = aggregate_commodity_stock(ctx, owner, CommodityKind::PaddedArmor).floor() as u32;
    let mut mail_available = aggregate_commodity_stock(ctx, owner, CommodityKind::MailArmor).floor() as u32;
    for (slot, recruit) in recruits.into_iter().take(size as usize).enumerate() {
        let slot = slot as u32;
        let phase = 0;
        let (x, z) = (recruit.x, recruit.z);
        let kit = RaidPortableStores::default();
        let profile = member_combat_profile(
            kind,
            company.id.rotate_left(31) ^ recruit.residence_id ^ recruit.resident_slot as u64,
        );
        let agent = ctx.db.combat_agent().insert(CombatAgent {
            id: 0,
            owner,
            raid_id: company.id,
            faction: kind.faction(),
            source_building_id: source.id,
            // Combat formation rank is company-local and must be unique.
            // Household identity remains on MilitaryMember.resident_slot.
            source_slot: slot,
            resident_slot: recruit.resident_slot,
            assigned_building_id: 0,
            target_kind: 0,
            target_id: source.id,
            engagement_target_id: 0,
            x,
            z,
            velocity_x: 0.0,
            velocity_z: 0.0,
            home_x: recruit.x,
            home_z: recruit.z,
            health: profile.max_health,
            max_health: profile.max_health,
            readiness: stats.starting_morale,
            state: MILITARY_MUSTERING,
            attack_cooldown: 0.0,
            loot_progress: 0.0,
            loot_fraction: 0.0,
            carried_loot_json: serde_json::to_string(&kit).unwrap_or_default(),
            state_changed_tick: tick,
            route_progress: 0.0,
            // Friendly military rows use this otherwise raid-only column to
            // expose household identity without widening CombatAgent.
            raid_anchor_building_id: recruit.residence_id,
        });
        ctx.db.military_member().insert(MilitaryMember {
            combat_agent_id: agent.id,
            owner,
            company_id: company.id,
            residence_id: recruit.residence_id,
            resident_slot: recruit.resident_slot,
            person_identity: format!(
                "residence-{}:person:{}",
                recruit.residence_id, recruit.resident_slot
            ),
            optional_armor: if kind == MilitaryKind::Militia {
                let tier = ctx.db.residence().id().find(&recruit.residence_id).map_or(1, |r| r.tier);
                let armor = crate::military_policy::optional_militia_armor(tier, padded_available, mail_available);
                if armor == 2 { mail_available -= 1; }
                if armor == 1 { padded_available -= 1; }
                armor
            } else { 0 },
            phase,
            ammunition: 0,
            ammunition_capacity: stats.ammunition_per_member,
            original_home_x: recruit.x,
            original_home_z: recruit.z,
        });
        if let Some(mount) = mounts.get_mut(slot as usize) {
            mount.assigned_company_id = company.id;
            mount.assigned_combat_agent_id = agent.id;
            ctx.db.cavalry_horse().id().update(mount.clone());
        }
    }
    Ok(())
}

fn available_pasture_horses_for_yard(
    ctx: &ReducerContext,
    owner: Identity,
    yard: &crate::tables::Building,
) -> Vec<CavalryHorse> {
    let network = load_owner_road_network(ctx, owner);
    let mut available = ctx
        .db
        .cavalry_horse()
        .owner()
        .filter(&owner)
        .filter(|horse| {
            horse.pasture_id > 0
                && horse.at_pasture
                && horse.assigned_company_id == 0
                && horse.assigned_combat_agent_id == 0
        })
        .filter_map(|horse| {
            let pasture = ctx.db.pasture().id().find(&horse.pasture_id)?;
            let herd = ctx.db.pasture_herd().pasture_id().find(&pasture.id)?;
            if herd.species != crate::reducers::livestock::SPECIES_HORSE {
                return None;
            }
            let farmstead = ctx.db.building().id().find(&pasture.farmstead_id)?;
            if farmstead.owner != owner
                || farmstead.kind != "pastoral_farmstead"
                || !farmstead.construction_complete
                || building_fire_state(ctx, farmstead.id).is_some()
            {
                return None;
            }
            let distance = network.as_ref().and_then(|network| {
                local_delivery_distance(network, farmstead.x, farmstead.z, yard.x, yard.z)
            })?;
            Some((
                horse,
                farmstead.settlement_id != yard.settlement_id,
                distance,
                pasture.id,
            ))
        })
        .collect::<Vec<_>>();
    available.sort_by(|left, right| {
        left.1
            .cmp(&right.1)
            .then_with(|| left.2.total_cmp(&right.2))
            .then_with(|| left.3.cmp(&right.3))
            .then_with(|| left.0.slot.cmp(&right.0.slot))
            .then_with(|| left.0.id.cmp(&right.0.id))
    });
    available.into_iter().map(|entry| entry.0).collect()
}

fn begin_disband(
    ctx: &ReducerContext,
    owner: Identity,
    company_id: u64,
) -> Result<(), String> {
    let mut company = owned_company(ctx, owner, company_id)?;
    if company.state >= 2 {
        return Ok(());
    }
    let kind = MilitaryKind::from_id(company.kind).ok_or("Unknown company type.")?;
    if kind.is_mounted() {
        for horse in ctx
            .db
            .cavalry_horse()
            .assigned_company_id()
            .filter(&company.id)
        {
            if horse.pasture_id == 0 {
                continue;
            }
            let valid_home = ctx
                .db
                .pasture_herd()
                .pasture_id()
                .find(&horse.pasture_id)
                .is_some_and(|herd| {
                    herd.owner == owner
                        && herd.species == crate::reducers::livestock::SPECIES_HORSE
                });
            if !valid_home {
                return Err(
                    "A surviving mount has no valid horse pasture to return to.".to_string(),
                );
            }
        }
    }
    company.state = 2;
    ctx.db.military_company().id().update(company.clone());
    for mut member in ctx
        .db
        .military_member()
        .company_id()
        .filter(&company.id)
        .collect::<Vec<_>>()
    {
        let Some(mut agent) = ctx.db.combat_agent().id().find(&member.combat_agent_id) else {
            continue;
        };
        if agent.state == 5 {
            continue;
        }
        ctx.db.militia_order().combat_agent_id().delete(agent.id);
        member.phase = 2;
        ctx.db.military_member().combat_agent_id().update(member);
        agent.state = 4;
        agent.target_kind = 0;
        agent.target_id = company.source_building_id;
        ctx.db.combat_agent().id().update(agent);
    }
    Ok(())
}

fn require_recruitment_building(
    ctx: &ReducerContext,
    owner: Identity,
    id: u64,
    expected_kind: &str,
) -> Result<crate::tables::Building, String> {
    let building = ctx
        .db
        .building()
        .id()
        .find(&id)
        .ok_or_else(|| "Recruitment building not found.".to_string())?;
    if building.owner != owner || building.kind != expected_kind || !building.construction_complete
    {
        return Err(format!(
            "A completed {} is required.",
            expected_kind.replace('_', " ")
        ));
    }
    if building_fire_state(ctx, building.id).is_some() {
        return Err(format!(
            "The {} cannot recruit during a fire outage.",
            expected_kind.replace('_', " ")
        ));
    }
    Ok(building)
}

fn owned_company(
    ctx: &ReducerContext,
    owner: Identity,
    company_id: u64,
) -> Result<MilitaryCompany, String> {
    ctx.db
        .military_company()
        .id()
        .find(&company_id)
        .filter(|company| company.owner == owner)
        .ok_or_else(|| "Military company not found.".to_string())
}

fn select_available_men(
    ctx: &ReducerContext,
    owner: Identity,
    settlement_id: u64,
    requested: u32,
) -> Vec<ResidentRecruit> {
    let labor_limit = available_building_labor(ctx, owner).min(requested) as usize;
    if labor_limit == 0 {
        return Vec::new();
    }
    let reserved = ctx
        .db
        .military_member()
        .owner()
        .filter(&owner)
        .filter(|member| member.residence_id > 0)
        .map(|member| (member.residence_id, member.resident_slot))
        .collect::<HashSet<_>>();
    let mut residences = ctx
        .db
        .residence()
        .owner()
        .filter(&owner)
        .filter(|residence| {
            !residence.abandoned
                && !residence.smallholding
                && (settlement_id == 0 || residence.settlement_id == settlement_id)
                && smallholding_assignable_population(
                    residence.population,
                    residence.sick_population,
                    residence.smallholding,
                ) > 0
        })
        .collect::<Vec<_>>();
    residences.sort_by_key(|residence| residence.id);
    let mut available = Vec::new();
    // Ordinary worker allocation claims low household indices first. Starting
    // at the highest healthy slot therefore selects idle residents normally.
    for residence in residences {
        let healthy = residence
            .population
            .saturating_sub(residence.sick_population.min(residence.population));
        for slot in (0..healthy).rev() {
            if reserved.contains(&(residence.id, slot))
                || !resident_slot_is_male(residence.id, slot)
            {
                continue;
            }
            available.push(ResidentRecruit {
                residence_id: residence.id,
                resident_slot: slot,
                x: residence.x,
                z: residence.z,
            });
            if available.len() >= labor_limit {
                return available;
            }
        }
    }
    available
}

/// Mirrors `pickVillagerAppearanceSeed` + `pickVillagerModelVariant` exactly.
fn resident_slot_is_male(residence_id: u64, slot: u32) -> bool {
    // Client identity is `${residenceClientId}:person:${slot}` and
    // pickVillagerAppearanceSeed adds `villager:` plus the trailing slot arg.
    let identity = format!("villager:residence-{residence_id}:person:{slot}:0");
    let mut hash = 2_166_136_261_u32;
    for byte in identity.bytes() {
        hash ^= byte as u32;
        hash = hash.wrapping_mul(16_777_619);
    }
    let mut value = hash ^ 0x9e37_79b9;
    value = value.wrapping_add(0x6d2b_79f5);
    let mut t = value;
    t = (t ^ (t >> 15)).wrapping_mul(t | 1);
    t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
    let sample = t ^ (t >> 14);
    sample < 0x8000_0000
}

fn require_cost(ctx: &ReducerContext, owner: Identity, cost: MilitaryCost) -> Result<(), String> {
    for (kind, amount, label) in commodity_costs(cost) {
        if amount == 0 {
            continue;
        }
        let available = aggregate_commodity_stock(ctx, owner, kind);
        if available + 1e-6 < amount as f64 {
            return Err(format!(
                "Not enough {label} (need {} more).",
                (amount as f64 - available).ceil() as u32
            ));
        }
    }
    if treasury_gold(ctx, owner) + 1e-6 < cost.gold as f64 {
        return Err(format!(
            "Not enough civic treasury gold (need {} more).",
            (cost.gold as f64 - treasury_gold(ctx, owner)).ceil() as u32
        ));
    }
    Ok(())
}

fn spend_cost(ctx: &ReducerContext, owner: Identity, cost: MilitaryCost) -> Result<(), String> {
    for (kind, amount, _) in commodity_costs(cost) {
        if amount == 0 {
            continue;
        }
        spend_commodity(ctx, owner, kind, amount as f64)?;
    }
    spend_treasury_gold(ctx, owner, cost.gold as f64)
}

/// Recruitment consumes rations and civic coin immediately, but complete
/// weapons and armor stay where they are until ordinary carts deliver them to
/// the mustering building. The equipping simulation consumes those kits only
/// after every required item is physically onsite.
fn spend_non_equipment_cost(
    ctx: &ReducerContext,
    owner: Identity,
    cost: MilitaryCost,
) -> Result<(), String> {
    spend_commodity(ctx, owner, CommodityKind::Ale, cost.ale as f64)?;
    spend_commodity(
        ctx,
        owner,
        CommodityKind::PreservedFood,
        cost.preserved_food as f64,
    )?;
    spend_treasury_gold(ctx, owner, cost.gold as f64)
}

fn commodity_costs(cost: MilitaryCost) -> [(CommodityKind, u32, &'static str); 10] {
    [
        (CommodityKind::Polearms, cost.polearms, "polearms"),
        (CommodityKind::Sidearms, cost.sidearms, "sidearms"),
        (CommodityKind::Shields, cost.shields, "shields"),
        (CommodityKind::Bows, cost.bows, "bows"),
        (CommodityKind::Crossbows, cost.crossbows, "crossbows"),
        (
            CommodityKind::PaddedArmor,
            cost.padded_armor,
            "padded armor",
        ),
        (CommodityKind::MailArmor, cost.mail_armor, "mail armor"),
        (CommodityKind::Ammunition, cost.ammunition, "ammunition"),
        (CommodityKind::Ale, cost.ale, "ale"),
        (
            CommodityKind::PreservedFood,
            cost.preserved_food,
            "preserved food",
        ),
    ]
}

fn aggregate_commodity_stock(ctx: &ReducerContext, owner: Identity, kind: CommodityKind) -> f64 {
    if kind == CommodityKind::Timber {
        return total_timber(ctx, owner);
    }
    if kind == CommodityKind::Ironwork {
        return total_ironwork(ctx, owner);
    }
    let physical: f64 = ctx
        .db
        .building()
        .owner()
        .filter(&owner)
        .filter(|building| building.construction_complete)
        .map(|building| building_commodity_stock(&building, kind))
        .sum();
    let available = physical
        + ctx
            .db
            .player_resources()
            .owner()
            .find(&owner)
            .map_or(0.0, |resources| treasury_commodity(&resources, kind));
    (available - pending_equipment_reserved(ctx, owner, kind)).max(0.0)
}

fn pending_equipment_reserved(ctx: &ReducerContext, owner: Identity, kind: CommodityKind) -> f64 {
    ctx.db
        .military_company()
        .owner()
        .filter(&owner)
        .filter(|company| company.state < 2)
        .filter_map(|company| {
            let military_kind = MilitaryKind::from_id(company.kind)?;
            let pending = ctx
                .db
                .military_member()
                .company_id()
                .filter(&company.id)
                .filter(|member| member.phase == 0)
                .count()
                .min(u32::MAX as usize) as u32;
            if pending == 0 {
                return None;
            }
            let cost = MilitaryCost::for_company(military_kind, pending);
            let optional = ctx.db.military_member().company_id().filter(&company.id)
                .filter(|m| m.phase == 0 && match kind {
                    CommodityKind::PaddedArmor => m.optional_armor == 1,
                    CommodityKind::MailArmor => m.optional_armor == 2,
                    _ => false,
                }).count() as f64;
            let amount = match kind {
                CommodityKind::Polearms => cost.polearms,
                CommodityKind::Sidearms => cost.sidearms,
                CommodityKind::Shields => cost.shields,
                CommodityKind::Bows => cost.bows,
                CommodityKind::Crossbows => cost.crossbows,
                CommodityKind::PaddedArmor => cost.padded_armor,
                CommodityKind::MailArmor => cost.mail_armor,
                CommodityKind::Ammunition => cost.ammunition,
                _ => 0,
            };
            Some(amount as f64 + optional)
        })
        .sum()
}

fn spend_commodity(
    ctx: &ReducerContext,
    owner: Identity,
    kind: CommodityKind,
    amount: f64,
) -> Result<(), String> {
    let mut remaining = amount.floor().max(0.0);
    let mut buildings = ctx
        .db
        .building()
        .owner()
        .filter(&owner)
        .filter(|building| building.construction_complete)
        .collect::<Vec<_>>();
    buildings.sort_by_key(|building| match building.kind.as_str() {
        "guardhouse" | "cavalry_yard" => 0,
        "village_storehouse" | "granary" => 1,
        _ => 2,
    });
    for mut building in buildings {
        if remaining <= 1e-6 {
            break;
        }
        let withdrew = withdraw_building_commodity(&mut building, kind, remaining);
        if withdrew > 0.0 {
            remaining -= withdrew;
            ctx.db.building().id().update(building);
        }
    }
    if remaining > 1e-6 {
        let Some(mut resources) = ctx.db.player_resources().owner().find(&owner) else {
            return Err("Military stock changed before it could be issued.".into());
        };
        let withdrew = withdraw_treasury_commodity(&mut resources, kind, remaining);
        remaining -= withdrew;
        ctx.db.player_resources().owner().update(resources);
    }
    if remaining <= 1e-6 {
        Ok(())
    } else {
        Err("Military stock changed before it could be issued.".into())
    }
}

fn treasury_commodity(resources: &crate::tables::PlayerResources, kind: CommodityKind) -> f64 {
    match kind {
        CommodityKind::Polearms => resources.polearms,
        CommodityKind::Sidearms => resources.sidearms,
        CommodityKind::Shields => resources.shields,
        CommodityKind::Bows => resources.bows,
        CommodityKind::Crossbows => resources.crossbows,
        CommodityKind::PaddedArmor => resources.padded_armor,
        CommodityKind::MailArmor => resources.mail_armor,
        CommodityKind::Ammunition => resources.ammunition,
        CommodityKind::Ale => resources.ale,
        CommodityKind::PreservedFood => resources.preserved_food,
        _ => 0.0,
    }
}

fn withdraw_treasury_commodity(
    resources: &mut crate::tables::PlayerResources,
    kind: CommodityKind,
    amount: f64,
) -> f64 {
    let stock = treasury_commodity(resources, kind).floor().max(0.0);
    let withdrew = stock.min(amount.floor().max(0.0));
    match kind {
        CommodityKind::Polearms => resources.polearms -= withdrew,
        CommodityKind::Sidearms => resources.sidearms -= withdrew,
        CommodityKind::Shields => resources.shields -= withdrew,
        CommodityKind::Bows => resources.bows -= withdrew,
        CommodityKind::Crossbows => resources.crossbows -= withdrew,
        CommodityKind::PaddedArmor => resources.padded_armor -= withdrew,
        CommodityKind::MailArmor => resources.mail_armor -= withdrew,
        CommodityKind::Ammunition => resources.ammunition -= withdrew,
        CommodityKind::Ale => resources.ale -= withdrew,
        CommodityKind::PreservedFood => resources.preserved_food -= withdrew,
        _ => return 0.0,
    }
    withdrew
}

fn mercenary_entry_point(
    ctx: &ReducerContext,
    owner: Identity,
    hall: &crate::tables::Building,
    entropy: u64,
) -> (f64, f64) {
    let playable_half = ctx
        .db
        .world_config()
        .id()
        .find(&0)
        .map_or(540.0, |row| playable_half_for_map_size(row.map_size));
    let limit = (playable_half - 10.0).max(40.0);
    let along = [-0.68, 0.0, 0.68];
    let mut candidates = Vec::with_capacity(12);
    for fraction in along {
        let offset = limit * fraction;
        candidates.extend_from_slice(&[
            (offset, -limit),
            (limit, offset),
            (offset, limit),
            (-limit, offset),
        ]);
    }
    let buildings = ctx
        .db
        .building()
        .owner()
        .filter(&owner)
        .filter(|building| building.construction_complete)
        .collect::<Vec<_>>();
    let camps = ctx
        .db
        .bandit_camp()
        .owner()
        .filter(&owner)
        .filter(|camp| camp.active)
        .collect::<Vec<_>>();
    candidates
        .into_iter()
        .enumerate()
        .max_by(|(left_index, left), (right_index, right)| {
            let score = |candidate: &(f64, f64)| {
                let town_clearance = buildings
                    .iter()
                    .map(|building| {
                        point_distance(candidate.0, candidate.1, building.x, building.z)
                    })
                    .fold(
                        point_distance(candidate.0, candidate.1, hall.x, hall.z),
                        f64::min,
                    );
                let camp_clearance = camps
                    .iter()
                    .map(|camp| point_distance(candidate.0, candidate.1, camp.x, camp.z))
                    .fold(playable_half * 2.0, f64::min);
                town_clearance.min(camp_clearance)
            };
            score(left).total_cmp(&score(right)).then_with(|| {
                ((*left_index as u64) ^ entropy).cmp(&((*right_index as u64) ^ entropy))
            })
        })
        .map(|(_, point)| point)
        .unwrap_or((0.0, -limit))
}

fn point_distance(ax: f64, az: f64, bx: f64, bz: f64) -> f64 {
    (ax - bx).hypot(az - bz)
}

fn company_center(members: &[(CombatAgent, MilitaryMember)]) -> (f64, f64) {
    if members.is_empty() {
        return (0.0, 0.0);
    }
    let (x, z) = members.iter().fold((0.0, 0.0), |(x, z), (agent, _)| {
        (x + agent.x, z + agent.z)
    });
    (x / members.len() as f64, z / members.len() as f64)
}

fn reform_company_at_current_position(ctx: &ReducerContext, company: &MilitaryCompany) {
    let Some(kind) = MilitaryKind::from_id(company.kind) else {
        return;
    };
    let mut members = ctx
        .db
        .military_member()
        .company_id()
        .filter(&company.id)
        .filter_map(|member| {
            if member.phase != 1 {
                return None;
            }
            let agent = ctx.db.combat_agent().id().find(&member.combat_agent_id)?;
            (agent.state != 5 && agent.health > 0.0).then_some((agent, member))
        })
        .collect::<Vec<_>>();
    members.sort_by_key(|(agent, _)| agent.source_slot);
    let center = company_center(&members);
    let navigation = crate::simulation::build_owner_combat_navigation(ctx, company.owner, None);
    let count = members.len() as u32;
    for (index, (mut agent, _)) in members.into_iter().enumerate() {
        let local = crate::military_policy::deployed_formation_offset(kind, company.formation, company.formation_columns, index as u32, count);
        let offset = rotate_formation_offset(
            local.0,
            local.1,
            company.facing_x,
            company.facing_z,
        );
        let destination = navigation.outside((center.0 + offset.0, center.1 + offset.1));
        let order = MilitiaOrder {
            combat_agent_id: agent.id,
            owner: company.owner,
            kind: 0,
            destination_x: destination.0,
            destination_z: destination.1,
            target_camp_id: 0,
            target_agent_id: 0,
            path_distance: 0.0,
            route_polyline_json: String::new(),
        };
        if ctx
            .db
            .militia_order()
            .combat_agent_id()
            .find(&agent.id)
            .is_some()
        {
            ctx.db.militia_order().combat_agent_id().update(order);
        } else {
            ctx.db.militia_order().insert(order);
        }
        agent.engagement_target_id = 0;
        agent.target_kind = 6;
        agent.target_id = 0;
        agent.state = 0;
        ctx.db.combat_agent().id().update(agent);
    }
}

fn mercenary_kit() -> RaidPortableStores {
    RaidPortableStores {
        polearms: 1.0,
        shields: 1.0,
        padded_armor: 1.0,
        ..RaidPortableStores::default()
    }
}

fn sim_tick(ctx: &ReducerContext) -> u64 {
    ctx.db
        .world_config()
        .id()
        .find(&0)
        .map_or(0, |row| row.sim_tick)
}

fn military_demands(ctx: &ReducerContext) -> u8 {
    ctx.db
        .world_config()
        .id()
        .find(&0)
        .map_or(1, |row| normalize_military_demands(row.military_demands))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn household_variant_contract_always_returns_a_stable_gender() {
        let first = (0..32)
            .map(|slot| resident_slot_is_male(17, slot))
            .collect::<Vec<_>>();
        let second = (0..32)
            .map(|slot| resident_slot_is_male(17, slot))
            .collect::<Vec<_>>();
        assert_eq!(first, second);
        assert!(first.iter().any(|male| *male));
        assert!(first.iter().any(|male| !*male));
    }
}
