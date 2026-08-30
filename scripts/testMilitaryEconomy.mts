import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';

const read = (path: string): string => readFileSync(path, 'utf8');
const balance = JSON.parse(read('balance/gameBalance.json')) as {
  buildings: Record<string, { storage?: Record<string, number> }>;
};
const commodities = read('server/src/economy/commodities.rs');
const economy = read('server/src/simulation/expanded_economy.rs');
const serverPolicy = read('server/src/military_policy.rs');
const clientPolicy = read('src/security/militaryProgression.ts');
const buildMenu = read('src/ui/buildMenuCards.ts');
const expandedBuildingInspector = read('src/resources/inspector/expandedBuildingRenderer.ts');
const cardArt = read('src/resources/buildingCardArt.ts');
const hud = read('src/ui/SettlementHud.ts');
const inspector = read('src/resources/ResourceInspector.ts');
const logistics = read('src/logistics/deliveryTrips.ts');
const tables = read('server/src/tables.rs');

const finishedGoods = [
  ['Sidearms', 69, 'sidearms'],
  ['Shields', 70, 'shields'],
  ['Bows', 71, 'bows'],
  ['Crossbows', 72, 'crossbows'],
  ['PaddedArmor', 73, 'paddedArmor'],
  ['MailArmor', 74, 'mailArmor'],
  ['Ammunition', 75, 'ammunition'],
] as const;

for (const [rustName, code, clientName] of finishedGoods) {
  assert.match(commodities, new RegExp(`Self::${rustName}\\s*=>\\s*${code}`), `${rustName} needs stable commodity code ${code}`);
  assert.match(logistics, new RegExp(`case\\s+${code}:[\\s\\S]{0,80}return '${clientName}'`), `${clientName} must travel on physical carts`);
  assert.match(hud, new RegExp(`data-stockpile="${clientName}"`), `${clientName} needs a Military stores HUD row`);
}

for (const table of ['PlayerResources', 'Building']) {
  const start = tables.indexOf(`pub struct ${table}`);
  assert.notEqual(start, -1);
  const body = tables.slice(start, tables.indexOf('\n}', start) + 2);
  for (const [, , clientName] of finishedGoods) {
    const field = clientName.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
    assert.match(body, new RegExp(`pub ${field}: f64`), `${table} must store ${field}`);
  }
}

for (const buildingKind of ['weaponsmith_armorer', 'bowyer_fletcher']) {
  assert.ok(balance.buildings[buildingKind], `${buildingKind} needs generated balance`);
  assert.match(buildMenu, new RegExp(`entry\\('${buildingKind}'\\)`));
  assert.match(cardArt, new RegExp(`${buildingKind}[\\s\\S]{0,120}build-menu/cards/`));
}
assert.match(buildMenu, /WORKSHOP_BUILD_MENU_ENTRIES[\s\S]*weaponsmith_armorer[\s\S]*bowyer_fletcher/);
assert.doesNotMatch(
  buildMenu.match(/MILITARY_BUILD_MENU_ENTRIES[\s\S]*?];/)?.[0] ?? '',
  /weaponsmith_armorer|bowyer_fletcher/,
  'craft workshops must stay available in peaceful modes under Industry',
);

for (const contract of [
  /POLEARM_RECIPE_INPUTS[\s\S]{0,180}Timber, 2\.0[\s\S]{0,100}Ironwork, 1\.0/,
  /SIDEARM_RECIPE_INPUTS[\s\S]{0,180}Ironwork, 2\.0[\s\S]{0,100}Leather, 1\.0/,
  /SHIELD_RECIPE_INPUTS[\s\S]{0,220}Timber, 2\.0[\s\S]{0,100}Leather, 1\.0[\s\S]{0,100}Ironwork, 1\.0/,
  /PADDED_ARMOR_RECIPE_INPUTS[\s\S]{0,180}Linen, 2\.0[\s\S]{0,100}Leather, 1\.0/,
  /MAIL_ARMOR_RECIPE_INPUTS[\s\S]{0,220}Ironwork, 4\.0[\s\S]{0,100}Leather, 1\.0[\s\S]{0,100}Linen, 1\.0/,
  /BOW_RECIPE_INPUTS[\s\S]{0,220}Timber, 2\.0[\s\S]{0,100}Linen, 1\.0[\s\S]{0,100}Leather, 1\.0/,
  /CROSSBOW_RECIPE_INPUTS[\s\S]{0,260}Timber, 2\.0[\s\S]{0,100}Ironwork, 2\.0[\s\S]{0,100}Linen, 1\.0[\s\S]{0,100}Leather, 1\.0/,
  /AMMUNITION_RECIPE_INPUTS[\s\S]{0,180}Timber, 1\.0[\s\S]{0,100}Ironwork, 1\.0/,
  /AMMUNITION_BATCH[^\n]*Ammunition, 4\.0/,
]) assert.match(economy, contract);

const paddedArmorRecipe = economy.slice(
  economy.indexOf('const PADDED_ARMOR_RECIPE_INPUTS'),
  economy.indexOf('const MAIL_ARMOR_RECIPE_INPUTS'),
);
assert.doesNotMatch(paddedArmorRecipe, /CommodityKind::Cloth/, 'finished civilian clothing must not be consumed by padded armor');
assert.equal(balance.buildings.weaponsmith_armorer?.storage?.cloth ?? 0, 0, 'the armorer must not request or store civilian clothing');
assert.doesNotMatch(
  buildMenu.match(/weaponsmith_armorer:[^\n]*/)?.[0] ?? '',
  /'cloth'/,
  'the armorer flow card must not advertise civilian clothing as an input',
);
assert.doesNotMatch(
  expandedBuildingInspector.match(/weaponsmith_armorer:[^\n]*/)?.[0] ?? '',
  /cloth/i,
  'the armorer inspector must not advertise civilian clothing as an input',
);

assert.match(economy, /fn least_stocked_recipe/);
assert.match(economy, /pub fn step_military_requisitions/);
assert.match(economy, /request_connected_commodity/);
assert.match(economy, /all_at_muster/);
assert.match(economy, /company\.state = 1/);
assert.match(economy, /equipped_member_kit/);

const costStruct = serverPolicy.slice(serverPolicy.indexOf('pub struct MilitaryCost'), serverPolicy.indexOf('pub struct MilitaryStats'));
for (const rawInput of ['timber', 'ironwork', 'leather', 'linen', 'cloth', 'shoes']) {
  assert.doesNotMatch(costStruct, new RegExp(`pub ${rawInput}:`), `recruitment must not consume raw ${rawInput}`);
}
for (const finished of ['polearms', 'sidearms', 'shields', 'bows', 'crossbows', 'padded_armor', 'mail_armor', 'ammunition']) {
  assert.match(costStruct, new RegExp(`pub ${finished}: u32`));
}
assert.match(clientPolicy, /militia:[\s\S]{0,180}cost: \{ polearms: 5 \}/);
assert.match(clientPolicy, /spearmen:[\s\S]{0,260}polearms: 8, shields: 8, paddedArmor: 8/);
assert.match(clientPolicy, /'men-at-arms':[\s\S]{0,260}sidearms: 8, shields: 8, mailArmor: 8/);
assert.match(clientPolicy, /crossbows:[\s\S]{0,260}crossbows: 6, paddedArmor: 6, ammunition: 6/);
assert.match(clientPolicy, /'mercenary-spears':[\s\S]{0,220}cost: \{ gold: 96 \}/);
assert.doesNotMatch(clientPolicy.match(/export type MilitaryRecruitmentCost[\s\S]*?};/)?.[0] ?? '', /timber|ironwork|leather|linen|cloth|shoes/);

assert.match(hud, /data-military-stores/);
assert.match(hud, />Arms</);
assert.match(hud, />Protection</);
assert.match(hud, />Ammunition</);
assert.match(inspector, /Spear .*foot .*ranged .*bottleneck/);

for (const asset of [
  'public/assets/ui/build-menu/cards/weaponsmith-armorer.webp',
  'public/assets/ui/build-menu/cards/bowyer-fletcher.webp',
  ...finishedGoods.map(([, , name]) => `public/assets/ui/icons/materials/${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}.png`),
]) {
  assert.ok(existsSync(asset), `${asset} must exist`);
  assert.ok(statSync(asset).size > 200, `${asset} must contain authored art`);
}

console.log('Military economy contract valid: seven finished equipment goods, two all-mode physical workshops, balanced recipes, carted muster requisitions, finished-kit-only recruitment, Military stores bottleneck HUD, trade/storage coverage, and authored card/icon art.');
