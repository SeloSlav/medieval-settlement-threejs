use std::collections::{BTreeSet, HashSet};

use spacetimedb::{reducer, Identity, ReducerContext};

use crate::db::*;
use crate::economy::{
    available_building_labor, building_commodity_stock, spend_treasury_gold, total_ironwork,
    total_timber, treasury_gold, withdraw_building_commodity, CommodityKind,
};
use crate::military_policy::{
    formation_offset, local_company_requires_provisions, member_combat_profile,
    military_day_ticks, military_resupply_cost, military_stats, normalize_military_demands,
    MilitaryCost, MilitaryKind, MERCENARY_MAX_CONTRACT_DAYS, MILITARY_FORMATION_COLUMN,
    MILITARY_FORMATION_LINE, MILITARY_FORMATION_LOOSE, MILITARY_FORMATION_SHIELD_WALL,
    MILITARY_PROVISION_ISSUE_DAYS,
};
use crate::raid_agent_policy::playable_half_for_map_size;
use crate::security_policy::RaidPortableStores;
use crate::smallholding_policy::smallholding_assignable_population;
use crate::tables::{
    mercenary_contract, CombatAgent, MercenaryContract, MilitaryCompany, MilitaryMember,
    MilitiaOrder,
};

const MILITARY_HOLDING: u8 = 9;
const MILITARY_MUSTERING: u8 = 8;
const MAX_PLAYER_FORCE_ORDER: usize = 96;
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
        formation: MILITARY_FORMATION_LINE,
        target_size: size,
        living_members: size,
        morale: stats.starting_morale,
        cohesion: stats.starting_cohesion,
        fatigue: 0.0,
        provision_days: 0.0,
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
            assigned_building_id: 0,
            target_kind: 6,
            target_id: 0,
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
            phase: 1,
            ammunition: 0,
            ammunition_capacity: 0,
            original_home_x: entry_x,
            original_home_z: entry_z,
        });
    }
    Ok(())
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
    ) {
        return Err("Unknown military formation.".into());
    }
    let owner = ctx.sender();
    let mut company = owned_company(ctx, owner, company_id)?;
    if company.state >= 2 {
        return Err("A disbanding company cannot change formation.".into());
    }
    if formation == MILITARY_FORMATION_SHIELD_WALL
        && matches!(
            MilitaryKind::from_id(company.kind),
            Some(
                MilitaryKind::Crossbows
                    | MilitaryKind::Bowmen
                    | MilitaryKind::Polearms
            )
        )
    {
        return Err(
            "This company has no large shields and uses line, column, or loose order.".into(),
        );
    }
    company.formation = formation;
    ctx.db.military_company().id().update(company);
    Ok(())
}

/// Shared RTS order endpoint retained under its original name for additive
/// client/save compatibility. Agent ids are only selection witnesses: naming
/// any active member expands the order to his entire company, because a company
/// is the smallest player-controllable military unit.
#[reducer]
pub fn command_militia(
    ctx: &ReducerContext,
    agent_ids: Vec<u64>,
    destination_x: f64,
    destination_z: f64,
    target_camp_id: u64,
) -> Result<(), String> {
    if !destination_x.is_finite() || !destination_z.is_finite() {
        return Err("Military destination must be finite.".into());
    }
    let owner = ctx.sender();
    let target = if target_camp_id == 0 {
        None
    } else {
        ctx.db
            .bandit_camp()
            .id()
            .find(&target_camp_id)
            .filter(|camp| camp.owner == owner && camp.active)
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
    let company_count = company_ids.len() as u32;
    for (company_index, company_id) in company_ids.into_iter().enumerate() {
        let Some(company) = ctx
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
        let company_center_x =
            (company_index as f64 - company_count.saturating_sub(1) as f64 * 0.5) * 10.0;
        for (member_index, (mut agent, _member)) in company_members.into_iter().enumerate() {
            let (member_x, member_z) =
                formation_offset(company.formation, member_index as u32, member_count);
            let (center_x, center_z, camp_id, kind) = target
                .as_ref()
                .map(|camp| (camp.x, camp.z, camp.id, 1))
                .unwrap_or((destination_x, destination_z, 0, 0));
            let x = center_x + company_center_x + member_x;
            let z = center_z + member_z;
            agent.target_kind = if kind == 1 { 5 } else { 6 };
            agent.target_id = camp_id;
            agent.state = 0;
            ctx.db.combat_agent().id().update(agent.clone());
            let order = MilitiaOrder {
                combat_agent_id: agent.id,
                owner,
                kind,
                destination_x: x,
                destination_z: z,
                target_camp_id: camp_id,
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
    Ok(())
}

#[reducer]
pub fn disband_military_company(ctx: &ReducerContext, company_id: u64) -> Result<(), String> {
    begin_disband(ctx, ctx.sender(), company_id)
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
    if company.state != 2 {
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
    let demands = military_demands(ctx);
    let requires_provisions = local_company_requires_provisions(kind, demands);
    let missing_ammunition = company
        .ammunition_capacity
        .saturating_sub(company.ammunition);
    let ammunition_bundles = if matches!(
        kind,
        MilitaryKind::Crossbows | MilitaryKind::Bowmen
    ) {
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
    if matches!(
        kind,
        MilitaryKind::Crossbows | MilitaryKind::Bowmen
    ) {
        for mut member in ctx
            .db
            .military_member()
            .company_id()
            .filter(&company.id)
            .collect::<Vec<_>>()
        {
            member.ammunition = member.ammunition_capacity;
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
    let recruits = select_available_men(ctx, owner, source.settlement_id, size);
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
        formation: if matches!(
            kind,
            MilitaryKind::Crossbows | MilitaryKind::Bowmen
        ) {
            MILITARY_FORMATION_LOOSE
        } else {
            MILITARY_FORMATION_LINE
        },
        target_size: size,
        living_members: size,
        morale: stats.starting_morale,
        cohesion: stats.starting_cohesion,
        fatigue: 0.0,
        provision_days: if local_company_requires_provisions(kind, demands) {
            MILITARY_PROVISION_ISSUE_DAYS
        } else {
            0.0
        },
        ammunition: 0,
        ammunition_capacity,
        formed_tick: tick,
        last_upkeep_tick: tick,
        experience: 0,
        level: 1,
        battle_started_tick: 0,
        last_combat_tick: 0,
    });
    for (slot, recruit) in recruits.into_iter().take(size as usize).enumerate() {
        let slot = slot as u32;
        let phase = 0;
        let (x, z) = (recruit.x, recruit.z);
        let kit = RaidPortableStores::default();
        let profile = member_combat_profile(
            kind,
            company.id.rotate_left(31) ^ recruit.residence_id ^ slot as u64,
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
            assigned_building_id: 0,
            target_kind: 0,
            target_id: source.id,
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
            person_identity: format!("residence-{}:person:{}", recruit.residence_id, recruit.resident_slot),
            phase,
            ammunition: 0,
            ammunition_capacity: stats.ammunition_per_member,
            original_home_x: recruit.x,
            original_home_z: recruit.z,
        });
    }
    Ok(())
}

fn begin_disband(ctx: &ReducerContext, owner: Identity, company_id: u64) -> Result<(), String> {
    let mut company = owned_company(ctx, owner, company_id)?;
    if company.state >= 2 {
        return Ok(());
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
            "Not enough Treasury gold (need {} more).",
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
        (CommodityKind::PaddedArmor, cost.padded_armor, "padded armor"),
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

fn pending_equipment_reserved(
    ctx: &ReducerContext,
    owner: Identity,
    kind: CommodityKind,
) -> f64 {
    ctx.db
        .military_company()
        .owner()
        .filter(&owner)
        .filter(|company| company.state == 0)
        .filter_map(|company| {
            let military_kind = MilitaryKind::from_id(company.kind)?;
            let cost = MilitaryCost::for_company(military_kind, company.target_size);
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
            Some(amount as f64)
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
        "guardhouse" => 0,
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
