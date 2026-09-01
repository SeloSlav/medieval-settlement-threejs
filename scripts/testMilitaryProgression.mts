import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import {
  militaryCompanyRequiresProvisions,
  militaryCompanyWagesEnabled,
  militaryRecruitmentCost,
  militaryResupplyCost,
} from '../src/security/militaryProgression.ts';
import {
  CAVALRY_YARD_ARCHITECTURE_PLAN,
} from '../src/buildings/meshes/cavalryYardMesh.ts';

const read = (path: string) => readFileSync(path, 'utf8');
const policy = read('src/security/militaryProgression.ts');
const serverPolicy = read('server/src/military_policy.rs');
const reducer = read('server/src/reducers/bandits.rs');
const simulation = read('server/src/simulation/military.rs');
const cavalryReducer = read('server/src/reducers/cavalry_horses.rs');
const livestockReducer = read('server/src/reducers/livestock.rs');
const livestockSimulation = read('server/src/simulation/livestock.rs');
const cavalryPolicy = read('server/src/cavalry_policy.rs');
const deliverySimulation = read('server/src/simulation/delivery_trips.rs');
const raidPolicy = read('server/src/raid_agent_policy.rs');
const economySimulation = read('server/src/simulation/expanded_economy.rs');
const tables = read('server/src/tables.rs');
const guardhouse = read('src/resources/inspector/guardhouseRenderer.ts');
const townHall = read('src/resources/inspector/townHallRenderer.ts');
const roster = read('src/resources/inspector/militaryCompanyRenderer.ts');
const villagers = read('src/settlement/VillagerRenderer.ts');
const crowdRenderer = read('src/settlement/SettlementCrowdRenderer.ts');
const horseRenderer = read('src/settlement/CavalryHorseRenderer.ts');
const cavalryInspector = read('src/resources/inspector/cavalryYardRenderer.ts');
const debugMenu = read('src/ui/DebugMenu.ts');
const debugMenuCss = read('src/ui/debugMenu.css');
const tools = read('src/settlement/workerTools.ts');
const equipment = read('src/settlement/militaryEquipment.ts');
const commands = read('src/security/MilitiaCommandController.ts');
const actionCss = read('src/ui/inspectorSupplemental.css');
const difficulty = read('src/world/worldDifficulty.ts');
const app = read('src/app/App.ts');
const bootstrap = read('src/app/appBootstrap.ts');
const inspector = read('src/resources/ResourceInspector.ts');
const selectedCompanyCard = roster.slice(
  roster.indexOf('export function renderSelectedMilitaryCompanyInspector'),
  roster.indexOf('function renderSelectedCompanyCommands'),
);

const reducerSection = (start: string, end: string): string => {
  const startIndex = reducer.indexOf(start);
  const endIndex = reducer.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `Missing reducer section: ${start}`);
  assert.notEqual(endIndex, -1, `Missing reducer section terminator: ${end}`);
  return reducer.slice(startIndex, endIndex);
};

for (const kind of ['militia', 'spearmen', 'men-at-arms', 'crossbows', 'mercenary-spears', 'footmen', 'polearms', 'bowmen', 'hussars', 'armored-lancers', 'mounted-archers']) {
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
assert.match(tables, /pub experience: u64/);
assert.match(tables, /pub level: u32/);
assert.match(tables, /pub battle_started_tick: u64/);
assert.match(tables, /pub struct MilitaryMember/);
assert.match(tables, /pub struct MercenaryContract/);
assert.match(reducer, /pub fn raise_militia/);
assert.match(reducer, /pub fn recruit_military_company/);
assert.match(reducer, /pub fn recruit_cavalry_company/);
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
assert.match(economySimulation, /fn step_cavalry_yard_requisitions/);
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
assert.match(simulation, /fn retained_or_nearest_enemy/);
assert.match(simulation, /steering\.nearest_matching_id/);
assert.match(simulation, /engagement_target_id/);
assert.match(simulation, /fn walk_flocked/);
assert.match(simulation, /melee_engagement_goal/);
assert.doesNotMatch(
  simulation,
  /fn nearest_distributed_enemy/,
  'military target acquisition must not regress to the old all-pairs saturation scan',
);
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
assert.match(simulation, /let ranged_kind = kind\.is_ranged\(\)/);
assert.match(simulation, /minimum_ranged_spacing[\s\S]*MilitaryKind::Bowmen[\s\S]*MilitaryKind::Crossbows[\s\S]*MilitaryKind::MountedArchers/);
assert.match(simulation, /walk_away\(&mut agent[\s\S]{0,160}stats\.speed \* 0\.78/);
assert.match(simulation, /fighting withdrawal[\s\S]{0,240}agent\.state = FIGHTING/);
assert.match(simulation, /let charged_into_contact = !can_shoot/);
assert.match(simulation, /deliberate terrain move is authoritative[\s\S]*filter\(\|order\| order\.kind == 0\)[\s\S]*return;/);
assert.match(simulation, /member_combat_profile/);
assert.match(simulation, /damage_against_hostile/);
assert.match(simulation, /shield_wall_damage_multiplier/);
assert.match(simulation, /recover_stock_at/);
assert.match(simulation, /MILITARY_BATTLE_SURVIVAL_XP/);
assert.match(simulation, /MILITARY_ENEMY_COMPANY_XP/);
assert.match(simulation, /fn award_company_experience/);
assert.match(simulation, /fn apply_veteran_level_health/);
assert.match(simulation, /fn regenerate_out_of_combat_health/);
assert.match(
  simulation,
  /military_member\(\)\s*\.company_id\(\)\s*\.filter\(&company_id\)/,
  'level-up health must be applied to every living member of the atomic company',
);
assert.match(
  simulation,
  /fn regenerate_out_of_combat_health[\s\S]*?if agent\.state == DOWNED \|\| agent\.health <= 0\.0/,
  'dead or zero-health members must never regenerate',
);
assert.match(
  simulation,
  /fn apply_veteran_level_health[\s\S]*?if agent\.state == DOWNED \|\| agent\.health <= 0\.0/,
  'level-up health must never revive a casualty',
);
assert.match(serverPolicy, /gains_veteran_experience[\s\S]*Self::Militia \| Self::MercenarySpears/);
assert.match(serverPolicy, /veteran_health_multiplier/);
assert.match(serverPolicy, /veteran_damage_multiplier/);
assert.match(serverPolicy, /veteran_damage_taken_multiplier/);

assert.match(guardhouse, /'spearmen', 'men-at-arms', 'footmen', 'polearms', 'bowmen', 'crossbows'/);
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
assert.match(
  commands,
  /selectablePlayerMilitaryCompanyId\(agent\)[\s\S]*grouped\.get\(companyId\)/,
  'company selection must use the canonical controllable-company resolver before grouping agents',
);
assert.match(commands, /this\.selected\.add\(nearest\.companyId\)/);
assert.match(commands, /flatMap\(\(companyId\)/);
assert.match(commands, /companySelectionFootprintRadius\(members\.length\)/);
assert.match(commands, /radius - COMPANY_SELECTION_RING_WIDTH/);
assert.doesNotMatch(commands, /ring\.scale\.setScalar\(company\.radius\)/);
assert.match(commands, /onLeavingCompanySelected/);
assert.match(commands, /onCompanySelected/);
assert.match(bootstrap, /onCompanySelected:[\s\S]*?resourceInspector\.selectMilitaryCompany\(companyId\)/);
assert.match(inspector, /selectMilitaryCompany\(companyId: string\)/);
assert.match(inspector, /focusMercenaryContract\(companyId: string\)/);
assert.match(selectedCompanyCard, /statusText: gainsExperience \? `Level \$\{company\.level\}/);
assert.match(selectedCompanyCard, /detailsHtml: ''/);
assert.doesNotMatch(selectedCompanyCard, /role="progressbar"|data-company-health|>Morale<|>Cohesion<|>Fatigue</);
assert.match(villagers, /activeMilitaryPersonIdentities\.has\(agent\.personIdentity\)/);
assert.match(villagers, /function combatToolFor/);
assert.match(villagers, /CAVALRY_SADDLE_HEIGHT[\s\S]*seatedVillagerContactHeight/);
assert.match(crowdRenderer, /agent\.mounted[\s\S]{0,100}return 'sit'/);
assert.match(horseRenderer, /class CavalryHorseRenderer/);
assert.match(horseRenderer, /animateHorse/);
assert.match(horseRenderer, /pose\.activity === 'grazing'/);
assert.match(horseRenderer, /visual\.blanket\.material = this\.blanketMaterials\[pose\.presentation\]/);
assert.match(villagers, /function cavalryHorsePasturePose/);
assert.match(villagers, /function pastureBilinearPoint/);
assert.match(villagers, /horse\.atPasture/);
assert.match(villagers, /activity = 'grazing'/);
assert.match(villagers, /smoothHorseStep/);
assert.equal(
  (villagers.match(/`horse:\$\{(?:pairedHorse|horse)\.id\}`/g) ?? []).length,
  2,
  'the same authoritative horse render id must be used in the pasture and under its rider',
);
assert.equal(CAVALRY_YARD_ARCHITECTURE_PLAN.diagnostics.equipmentIssueBayCount, 6);
assert.equal(CAVALRY_YARD_ARCHITECTURE_PLAN.diagnostics.hitchingPostCount, 3);
assert.ok(CAVALRY_YARD_ARCHITECTURE_PLAN.modules.includes('mounted-drill-ring'));
assert.ok(CAVALRY_YARD_ARCHITECTURE_PLAN.modules.includes('campaign-store'));
assert.doesNotMatch(JSON.stringify(CAVALRY_YARD_ARCHITECTURE_PLAN), /stable|permanent.*horse/i);
assert.match(tables, /pub struct CavalryHorse/);
assert.match(tables, /pub pasture_id: u64/);
assert.match(tables, /pub at_pasture: bool/);
assert.match(tables, /pub present_head_count: u32/);
assert.match(tables, /pub horse_oats: f64[\s\S]*pub horse_water: f64/);
assert.doesNotMatch(tables, /pub horse_feed: f64/);
assert.match(cavalryReducer, /pub\(crate\) fn sync_horse_pasture_herd/);
assert.match(cavalryReducer, /pub\(crate\) fn set_horse_at_pasture/);
assert.match(livestockReducer, /const SPECIES_HORSE: u8 = 3/);
assert.match(livestockReducer, /ctx\.db\.cavalry_horse\(\)\.insert/);
assert.match(livestockSimulation, /physical_pasture_heads/);
assert.match(cavalryPolicy, /pub fn cavalry_daily_ration\(\)[\s\S]*oats: CAVALRY_HORSE_DAILY_OATS[\s\S]*water: CAVALRY_HORSE_DAILY_WATER/);
assert.doesNotMatch(cavalryPolicy, /animal_feed|winter_feed|month: u32/);
assert.doesNotMatch(cavalryReducer, /pub fn purchase_cavalry_horse/);
assert.match(reducer, /mount\.assigned_company_id = company\.id/);
assert.match(reducer, /mount\.assigned_combat_agent_id = agent\.id/);
assert.match(reducer, /available_pasture_horses_for_yard/);
assert.match(
  serverPolicy,
  /Self::Hussars \| Self::ArmoredLancers \| Self::MountedArchers => 6/,
  'every cavalry company must be a six-rider atomic formation, never one mounted actor',
);
assert.match(simulation, /release_mount_for_agent\(ctx, agent\.id, true\)/);
assert.match(simulation, /release_mount_for_agent\(ctx, agent\.id, false\)/);
assert.match(simulation, /company\.horse_oats[\s\S]*company\.horse_water/);
assert.doesNotMatch(simulation, /company\.horse_feed/);
assert.match(simulation, /member\.phase == 4/);
assert.match(simulation, /horse\.at_pasture = true/);
assert.doesNotMatch(reducer, /pub fn disband_cavalry_company_sell_mounts/);
assert.match(economySimulation, /CAVALRY_HORSE_FIELD_ISSUE_DAYS/);
assert.match(economySimulation, /fn step_cavalry_company_field_resupply/);
assert.match(deliverySimulation, /pub fn try_start_cavalry_company_supply_trip/);
assert.match(deliverySimulation, /unload_commodity_to_military_company/);
assert.match(cavalryInspector, /No resident stable/);
assert.match(cavalryInspector, /Pasture-supplied muster/);
assert.match(cavalryInspector, /oats and water year-round[\s\S]*ambient campaign forage abstracted/);
assert.match(raidPolicy, /OTTOMAN_ROLE_AZAB[\s\S]*OTTOMAN_ROLE_JANISSARY[\s\S]*OTTOMAN_ROLE_AKINCI[\s\S]*OTTOMAN_ROLE_SIPAHI/);
assert.match(raidPolicy, /three Azabs, two Janissaries, two Akıncıs/);
for (const id of [8, 9, 10]) assert.match(debugMenu, new RegExp(`<option value="${id}">`));
assert.match(debugMenu, /Math\.min\(10, Math\.floor\(Number\(this\.companyKind\.value\)\)\)/);
assert.match(debugMenuCss, /\.debug-menu-backdrop\s*\{[\s\S]*?pointer-events:\s*auto/);
assert.match(villagers, /\(combat\.routeProgress \?\? 0\) > 14/);
assert.match(tools, /createMilitaryEquipmentSources/);
assert.match(equipment, /function createCrossbow/);
assert.match(equipment, /function createSword/);
assert.match(equipment, /function createShield/);
assert.match(equipment, /function createHalberd/);
assert.match(equipment, /function createBow/);
assert.match(equipment, /function createPike/);
assert.doesNotMatch(policy, /uskok|arquebus|matchlock/i);
assert.doesNotMatch(serverPolicy, /UskokBorderInfantry|arquebus|matchlock/i);
assert.doesNotMatch(simulation, /UskokBorderInfantry|arquebus|matchlock/i);
assert.doesNotMatch(equipment, /uskok|arquebus|matchlock/i);
assert.match(reducer, /fn mercenary_entry_point/);
assert.match(reducer, /playable_half_for_map_size/);

for (const icon of [
  'militia', 'spearmen', 'men-at-arms', 'crossbows', 'mercenaries',
  'footmen', 'polearms', 'bowmen',
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

for (const kind of [
  'spearmen', 'men-at-arms', 'crossbows', 'footmen', 'polearms', 'bowmen',
]) {
  const path = `public/assets/ui/company-cards/${kind}.webp`;
  assert.ok(existsSync(path), `${path} must exist`);
  assert.ok(statSync(path).size > 10_000, `${path} should contain authored card art`);
}

console.log('Military progression contract valid: eleven distinct company types including three six-rider cavalry companies, pasture-owned exact horses with physical muster and return, mounted villager poses, year-round oats-and-water field supply, four-role Ottoman raid diversity, counter roles, resident losses, formations, ammo, UI controls, and debug deployment.');
