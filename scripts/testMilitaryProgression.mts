import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import {
  militaryCompanyRequiresProvisions,
  militaryCompanyWagesEnabled,
  militaryRecruitmentCost,
  militaryResupplyCost,
} from '../src/security/militaryProgression.ts';

const read = (path: string) => readFileSync(path, 'utf8');
const policy = read('src/security/militaryProgression.ts');
const serverPolicy = read('server/src/military_policy.rs');
const reducer = read('server/src/reducers/bandits.rs');
const simulation = read('server/src/simulation/military.rs');
const economySimulation = read('server/src/simulation/expanded_economy.rs');
const tables = read('server/src/tables.rs');
const guardhouse = read('src/resources/inspector/guardhouseRenderer.ts');
const townHall = read('src/resources/inspector/townHallRenderer.ts');
const roster = read('src/resources/inspector/militaryCompanyRenderer.ts');
const villagers = read('src/settlement/VillagerRenderer.ts');
const tools = read('src/settlement/workerTools.ts');
const equipment = read('src/settlement/militaryEquipment.ts');
const commands = read('src/security/MilitiaCommandController.ts');
const actionCss = read('src/ui/inspectorSupplemental.css');
const difficulty = read('src/world/worldDifficulty.ts');
const app = read('src/app/App.ts');
const bootstrap = read('src/app/appBootstrap.ts');
const inspector = read('src/resources/ResourceInspector.ts');

const reducerSection = (start: string, end: string): string => {
  const startIndex = reducer.indexOf(start);
  const endIndex = reducer.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `Missing reducer section: ${start}`);
  assert.notEqual(endIndex, -1, `Missing reducer section terminator: ${end}`);
  return reducer.slice(startIndex, endIndex);
};

for (const kind of ['militia', 'spearmen', 'men-at-arms', 'crossbows', 'mercenary-spears', 'footmen', 'polearms', 'bowmen', 'uskok-border-infantry']) {
  assert.match(policy, new RegExp(`['\"]?${kind.replace('-', '\\-')}['\"]?\\s*:`));
}
assert.match(policy, /militia:[\s\S]*cost: \{ polearms: 5 \}/);
assert.match(policy, /crossbows:[\s\S]*ammunition|Crossbow company[\s\S]*eighteen bolts each/i);
assert.match(policy, /'mercenary-spears':[\s\S]*cost: \{ gold: 96 \}/);
assert.deepEqual(militaryRecruitmentCost('spearmen', 0), {
  polearms: 8, shields: 8, paddedArmor: 8, ale: 0, preservedFood: 0, gold: 0,
});
assert.deepEqual(militaryResupplyCost(8, 1), { preservedFood: 8 });
assert.deepEqual(militaryResupplyCost(8, 2), { preservedFood: 16, ale: 2 });
assert.deepEqual(militaryResupplyCost(8, 3), { preservedFood: 16, ale: 8 });
assert.deepEqual(militaryRecruitmentCost('mercenary-spears', 0), { gold: 96 });
assert.deepEqual(militaryRecruitmentCost('mercenary-spears', 3), { gold: 96 });
assert.equal(militaryCompanyRequiresProvisions('militia', 3), false);
assert.equal(militaryCompanyRequiresProvisions('mercenary-spears', 3), false);
assert.equal(militaryCompanyRequiresProvisions('spearmen', 0), false);
assert.equal(militaryCompanyRequiresProvisions('spearmen', 1), true);
assert.equal(militaryCompanyWagesEnabled('spearmen', 1), false);
assert.equal(militaryCompanyWagesEnabled('spearmen', 2), true);
assert.equal(militaryCompanyWagesEnabled('mercenary-spears', 0), true);
assert.match(
  serverPolicy,
  /MilitaryKind::Crossbows,[\s\S]*?MilitaryKind::Spearmen[\s\S]*?=> 1\.20/,
  'crossbows must explicitly counter ordinary spear formations',
);

assert.match(tables, /pub struct MilitaryCompany/);
assert.match(tables, /pub struct MilitaryMember/);
assert.match(tables, /pub struct MercenaryContract/);
assert.match(reducer, /pub fn raise_militia/);
assert.match(reducer, /pub fn recruit_military_company/);
assert.match(reducer, /pub fn hire_mercenary_company/);
assert.match(reducer, /pub fn disband_military_company/);
assert.match(reducer, /pub fn renew_mercenary_contract/);
assert.match(reducer, /survivors\.len\(\)[\s\S]*?saturating_mul\(2\)/);
assert.match(reducer, /MilitaryKind::MercenarySpears[\s\S]*?begin_disband/);
assert.match(reducer, /pub fn resupply_military_company/);
assert.match(reducer, /MilitaryCost::for_company_with_demands\(kind, size, demands\)/);
assert.match(reducer, /military_resupply_cost\(company\.living_members, demands\)/);
assert.match(reducer, /provision_days: 0\.0/);
assert.match(reducer, /pub fn set_military_formation/);
assert.match(reducer, /residence-\{\}:person:\{\}/);
assert.match(reducer, /available_building_labor\(ctx, owner\)/);
assert.match(reducer, /let \(x, z\) = \(recruit\.x, recruit\.z\)/);
assert.match(reducer, /spend_non_equipment_cost/);
assert.match(reducer, /pending_equipment_reserved/);
assert.match(economySimulation, /pub fn step_military_requisitions/);
assert.match(economySimulation, /ordinary physical carts/);
assert.match(economySimulation, /company\.state = 1/);
assert.match(reducer, /let mut company_ids = BTreeSet::new\(\)/);
assert.match(reducer, /military_member\(\)\s*\.company_id\(\)\s*\.filter\(&company_id\)/);
assert.match(reducer, /company_center_x/);

const militiaReducer = reducerSection('pub fn raise_militia', 'pub fn recruit_military_company');
const mercenaryReducer = reducerSection('pub fn hire_mercenary_company', 'pub fn set_military_formation');
for (const [label, section] of [['militia', militiaReducer], ['mercenary', mercenaryReducer]] as const) {
  assert.match(section, /require_recruitment_building\(ctx, owner, town_hall_id, "town_hall"\)/);
  assert.doesNotMatch(
    section,
    /world_config|conflict_enabled|enemy_pressure|bandit_camps_enabled|"guardhouse"/,
    `${label} recruitment must remain available from the Town Hall in peaceful, non-Ottoman worlds`,
  );
}
assert.match(
  difficulty,
  /id: 'normal'[\s\S]*?conflictMode: 'peaceful'[\s\S]*?banditCampsEnabled: true/,
  'Normal mode must prove that peaceful settlements can still contain bandits',
);

assert.match(simulation, /fn step_mustering_member/);
assert.match(simulation, /fn nearest_distributed_enemy/);
assert.match(simulation, /fn walk_flocked/);
assert.match(simulation, /assigned \* 2\.75/);
assert.match(simulation, /fn step_company_upkeep/);
assert.match(simulation, /local_company_requires_provisions\(kind, military_demands\)/);
assert.match(simulation, /company_wages_enabled\(kind, military_demands\)/);
assert.match(simulation, /fn step_mercenary_contracts/);
assert.match(simulation, /MERCENARY_IDLE_DEPARTURE_DAYS/);
assert.match(simulation, /MERCENARY_MAX_CONTRACT_DAYS/);
assert.match(simulation, /fn begin_mercenary_departure/);
assert.match(simulation, /fn step_returning_member/);
assert.match(simulation, /let exit_x = member\.original_home_x/);
assert.match(simulation, /last_engagement_tick/);
assert.match(simulation, /idle_too_long \|\| tick >= contract\.contract_end_tick/);
assert.match(simulation, /fn recover_member_kit_at/);
assert.match(simulation, /fn resolve_return_home/);
assert.match(simulation, /fn down_player_member/);
assert.match(simulation, /MilitaryKind::Crossbows \| MilitaryKind::Bowmen/);
assert.match(simulation, /member_combat_profile/);
assert.match(simulation, /damage_against_hostile/);
assert.match(simulation, /shield_wall_damage_multiplier/);
assert.match(simulation, /recover_stock_at/);

assert.match(guardhouse, /'spearmen', 'men-at-arms', 'footmen', 'polearms', 'bowmen', 'crossbows', 'uskok-border-infantry'/);
assert.match(townHall, /'militia', 'mercenary-spears'/);
assert.match(roster, /data-militia-size/);
assert.match(roster, /Array\.from\(\{ length: 12 \}/);
assert.match(roster, /1 gold\/man\/day · 7 quiet days · 21-day term/);
assert.match(roster, /data-renew-mercenary-contract/);
assert.match(roster, /marching back to its original map edge and ignores all movement and attack orders/);
assert.match(inspector, /onRenewMercenaryContract/);
assert.match(inspector, /\[data-renew-mercenary-contract\]/);
assert.match(app, /title: 'Mercenary company is leaving'/);
assert.match(app, /title: 'Mercenary company has departed'/);
for (const control of [
  'data-recruit-military-kind',
  'data-hire-mercenary-company',
  'data-disband-military-company',
  'data-resupply-military-company',
  'data-military-formation',
]) {
  assert.match(roster, new RegExp(control));
}
assert.match(commands, /grouped\.get\(agent\.companyId\)/);
assert.match(commands, /this\.selected\.add\(nearest\.companyId\)/);
assert.match(commands, /flatMap\(\(companyId\)/);
assert.match(commands, /ring\.scale\.setScalar\(company\.radius\)/);
assert.match(commands, /onLeavingCompanySelected/);
assert.match(bootstrap, /onLeavingCompanySelected:[\s\S]*?resourceInspector\.selectBuilding\(company\.sourceBuildingId\)/);
assert.match(bootstrap, /resourceInspector\.focusMercenaryContract\(company\.id\)/);
assert.match(inspector, /focusMercenaryContract\(companyId: string\)/);
assert.match(villagers, /activeMilitaryPersonIdentities\.has\(agent\.personIdentity\)/);
assert.match(villagers, /function combatToolFor/);
assert.match(villagers, /\(combat\.routeProgress \?\? 0\) > 14/);
assert.match(tools, /createMilitaryEquipmentSources/);
assert.match(equipment, /function createCrossbow/);
assert.match(equipment, /function createSword/);
assert.match(equipment, /function createShield/);
assert.match(equipment, /function createHalberd/);
assert.match(equipment, /function createBow/);
assert.match(equipment, /function createPike/);
assert.match(equipment, /function createArquebus/);
assert.match(equipment, /function createKorda/);
assert.match(reducer, /fn mercenary_entry_point/);
assert.match(reducer, /playable_half_for_map_size/);

for (const icon of [
  'militia', 'spearmen', 'men-at-arms', 'crossbows', 'mercenaries',
  'footmen', 'polearms', 'bowmen', 'uskoks',
  'disband-company', 'resupply-company', 'formation',
]) {
  const path = `public/assets/ui/icons/actions/${icon}.png`;
  assert.ok(existsSync(path), `${path} must exist`);
  assert.ok(statSync(path).size > 10_000, `${path} should contain authored raster art`);
  assert.match(
    actionCss,
    new RegExp(`data-action-icon='${icon}'[\\s\\S]{0,180}${icon}\\.png`),
    `${icon} must be mapped into the inspector icon system`,
  );
}

const militaryDemandsAtlas = 'public/assets/ui/icons/world-setup/military-demands-atlas.png';
assert.ok(existsSync(militaryDemandsAtlas));
assert.ok(statSync(militaryDemandsAtlas).size > 10_000);

console.log('Military progression contract valid: nine distinct company types including Men-at-Arms, counter roles, Uskok frontier infantry, variable militia strength, edge-arriving mercenaries with paid finite contracts, physical reversible edge departure and retainer recall, company-atomic flock orders, individual combat profiles, physical resident muster/return/salvage, formations, ammo, UI controls, and woodcut icons.');
