import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { syncCombatAgents } from '../src/security/combatAgents.ts';
import type { CombatAgent } from '../src/generated/types.ts';
import {
  MILITARY_FORMATIONS,
  MILITARY_STANCES,
  militaryCompanyRankLabel,
  militaryFormationAvailable,
  militaryFormationDescription,
  militaryStanceAvailable,
  militaryStanceDescription,
} from '../src/security/militaryProgression.ts';

const read = (path: string): string => readFileSync(path, 'utf8');
const tables = read('server/src/tables.rs');
const reducers = read('server/src/reducers/bandits.rs');
const buildings = read('server/src/reducers/buildings.rs');
const population = read('server/src/economy/population.rs');
const military = read('server/src/simulation/military.rs');
const raids = read('server/src/simulation/raid_agents.rs');
const economy = read('server/src/simulation/expanded_economy.rs');
const simulation = read('server/src/reducers/simulation.rs');
const policy = read('server/src/military_policy.rs');
const commands = read('src/security/MilitiaCommandController.ts');
const roster = read('src/resources/inspector/militaryCompanyRenderer.ts');
const guardhouse = read('src/resources/inspector/guardhouseRenderer.ts');
const townHall = read('src/resources/inspector/townHallRenderer.ts');
const provisioning = read('src/economy/settlementProvisioning.ts');

assert.deepEqual(MILITARY_FORMATIONS, [
  'line',
  'column',
  'shield-wall',
  'loose',
  'brace',
  'wedge',
]);
assert.deepEqual(MILITARY_STANCES, [
  'balanced',
  'stand-ground',
  'push-forward',
  'give-ground',
  'missile-alert',
]);
for (const formation of MILITARY_FORMATIONS) {
  const description = militaryFormationDescription(formation);
  assert.match(description, /^[A-Z][^.]+\.$/);
  assert.equal((description.match(/\./g) ?? []).length, 1);
}
for (const stance of MILITARY_STANCES) {
  const description = militaryStanceDescription(stance);
  assert.match(description, /^[A-Z][^.]+\.$/);
  assert.equal((description.match(/\./g) ?? []).length, 1);
}
assert.equal(militaryFormationAvailable('spearmen', 'brace'), true);
assert.equal(militaryFormationAvailable('crossbows', 'brace'), false);
assert.equal(militaryFormationAvailable('armored-lancers', 'wedge'), true);
assert.equal(militaryFormationAvailable('footmen', 'wedge'), false);
assert.equal(militaryStanceAvailable('mounted-archers', 'give-ground'), false);
assert.equal(militaryStanceAvailable('bowmen', 'missile-alert'), true);
assert.equal(militaryCompanyRankLabel({ kind: 'spearmen', level: 1 }), 'Unproven');
assert.equal(militaryCompanyRankLabel({ kind: 'spearmen', level: 7 }), 'Hardened');
assert.equal(militaryCompanyRankLabel({ kind: 'militia', level: 10 }), null);

// Formation rank can change after losses; the enlisted civilian identity must not.
const residentSoldier = {
  id: 5n, owner: { toHexString: () => 'test-owner' }, raidId: 77n,
  faction: 4, state: 9, targetKind: 6, targetId: 0n,
  sourceBuildingId: 1n, sourceSlot: 11, residentSlot: 2,
  assignedBuildingId: 0n, raidAnchorBuildingId: 42n,
  x: 0, z: 0, homeX: 0, homeZ: 0, health: 80, maxHealth: 80,
  readiness: 1, attackCooldown: 0, lootProgress: 0, carriedLootJson: '{}',
  stateChangedTick: 0n, routeProgress: 0,
} as unknown as CombatAgent;
assert.equal(syncCombatAgents([residentSoldier], 'test-owner').get('5')?.personIdentity, 'residence-42:person:2');
assert.equal(syncCombatAgents([{ ...residentSoldier, sourceSlot: 0 }], 'test-owner').get('5')?.personIdentity, 'residence-42:person:2');
assert.equal(syncCombatAgents([residentSoldier], 'different-owner').size, 0);

assert.match(tables, /pub resident_slot: u32/);
assert.match(tables, /pub target_agent_id: u64/);
assert.match(tables, /pub departure_requested: bool/);
assert.match(tables, /accessor = mercenary_contract,[\s\S]{0,90}public/);
assert.match(tables, /pub path_distance: f64,[\s\S]{0,80}pub route_polyline_json: String/);
assert.match(reducers, /target_agent_id[\s\S]*selected hostile is no longer available/);
assert.match(reducers, /let mut company_ids = BTreeSet::new\(\)[\s\S]*company_ids\.insert\(member\.company_id\)/);
assert.match(military, /find\(&order\.target_agent_id\)/);
assert.match(military, /deployed_formation_offset[\s\S]*rotate_formation_offset/);
assert.match(military, /COMBAT_WADING_SPEED_MULTIPLIER[\s\S]*COMBAT_ROAD_SPEED_MULTIPLIER/);
assert.match(military, /charged_into_contact[\s\S]*formation_charge_multiplier/);
assert.match(military, /MILITARY_FORMATION_BRACE[\s\S]*is_front_attack/);
assert.match(military, /member\.ammunition = member\.ammunition\.saturating_sub\(1\)[\s\S]*sync_member_ammunition_kit/);
assert.match(military, /recoverable_ammunition_bundles\(\s*member.ammunition,\s*member.ammunition_capacity,?\s*\)/);
assert.match(military, /company\.ammunition_capacity = ammunition_capacity/);
assert.match(military, /incoming_targets.contains\(&agent.id\)/);
assert.match(military, /FORMATION_ARRIVAL_DISTANCE: f64 = 0\.18/);
assert.match(military, /agent.source_slot = formation_rank/);
assert.match(military, /build_owner_combat_navigation[\s\S]*constrain_step/);
assert.match(reducers, /network\.road_path_route\(agent.x, agent.z, x, z\)/);
assert.match(reducers, /building_fire_state\(ctx, building.id\).is_some\(\)/);
assert.match(reducers, /pub fn reinforce_military_company/);
assert.match(economy, /member.phase == 0[\s\S]*join_mustered_members/);
assert.match(raids, /active_player_agent_ids.contains\(&agent.id\)/);
assert.match(raids, /is_player_military_faction\(agent.faction\)[\s\S]{0,300}continue/);
assert.match(raids, /mitigate_external_player_damage/);
assert.match(raids, /down_external_player_member/);
assert.match(military, /pending_company\.departure_requested = true/);
assert.match(military, /let engaged =[\s\S]*mercenary_departure_decision\([\s\S]*if engaged/);
assert.match(population, /active_military_resident_count[\s\S]*available_workplace_labor[\s\S]*active_military_resident_count/);
assert.match(buildings, /military_company\(\)[\s\S]*source_building_id == building_id/);
assert.doesNotMatch(raids, /MilitiaOrder|ensure_warned_guard_muster/);
assert.doesNotMatch(simulation, /try_dispatch_guardhouse_payroll|guardhouse_payroll_buckets/);
assert.doesNotMatch(economy, /dispatch_polearms_to_guardhouse|guardhouse_polearm_target|guardhouse_pay_priority/);
assert.match(economy, /step_military_requisitions/);
assert.match(policy, /formation_offset_for_kind/);
assert.match(commands, /targetAgentId/);

assert.match(roster, /data-tooltip="\$\{militaryFormationDescription\(formation\)\}"/);
assert.match(roster, /data-tooltip="\$\{militaryStanceDescription\(stance\)\}"/);
assert.doesNotMatch(roster, /militaryExperienceProgress|\bXP\b|experience progress|contract countdown/i);
assert.doesNotMatch(guardhouse, /health|damage|morale|cohesion|fatigue|readiness|ammunition|payroll/i);
assert.doesNotMatch(townHall, /computeSettlementArmamentPlan|renderSettlementArmamentRows/);
assert.match(provisioning, /Field-company provisions and wages are explicit military transactions/);
assert.doesNotMatch(provisioning, /building\.kind !== 'guardhouse'|GUARDHOUSE_WAGE_PER_GUARD_PER_DAY/);

console.log('Military system integrity contract passed.');
