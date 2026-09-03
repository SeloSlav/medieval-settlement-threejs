import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  FRESH_FOOD_KINDS,
  NAMED_FOOD_LABELS,
  PRESERVED_FOOD_KINDS,
} from '../src/economy/foodInventory.ts';
import {
  GRANARY_STORAGE_COMMODITIES,
  STORAGE_COMMODITY_CODES,
  STOREHOUSE_STORAGE_COMMODITIES,
} from '../src/economy/storageAcceptancePolicy.ts';
import {
  BREWERY_RECIPE_CIDER,
  BREWERY_RECIPE_PEAR_CIDER,
  breweryPolicyOutput,
} from '../src/economy/breweryRecipePolicy.ts';
import { RESOURCE_KINDS } from '../src/resources/types.ts';
import { TRADE_RESOURCE_KINDS } from '../src/generated/gameBalance.ts';

const freshIdentities = [
  'pears', 'aronia', 'rosehips', 'cabbage', 'carrots', 'beetroot',
] as const;
const preservedIdentities = ['aroniaJam', 'rosehipJam'] as const;
const allIdentities = [...freshIdentities, ...preservedIdentities, 'cider', 'pearCider'] as const;
const backyardGranaryOutputs = [
  'apples', 'cherries', 'pears', 'aronia', 'rosehips', 'cabbage', 'carrots',
  'beetroot', 'eggs', 'milk', 'meat', 'honey', 'aroniaJam', 'rosehipJam',
] as const;
const backyardStorehouseOutputs = ['remedies', 'hides'] as const;

for (const commodity of freshIdentities) {
  assert.ok(FRESH_FOOD_KINDS.includes(commodity));
}
for (const commodity of preservedIdentities) {
  assert.ok(PRESERVED_FOOD_KINDS.includes(commodity));
}
for (const commodity of allIdentities) {
  assert.ok(RESOURCE_KINDS.includes(commodity));
  assert.ok(GRANARY_STORAGE_COMMODITIES.includes(commodity));
  assert.ok(TRADE_RESOURCE_KINDS.includes(commodity));
  assert.ok(Number.isInteger(STORAGE_COMMODITY_CODES[commodity]));
}
for (const commodity of backyardGranaryOutputs) {
  assert.ok(
    GRANARY_STORAGE_COMMODITIES.includes(commodity),
    `${commodity} must be accepted by Granaries as backyard surplus`,
  );
}
for (const commodity of backyardStorehouseOutputs) {
  assert.ok(
    STOREHOUSE_STORAGE_COMMODITIES.includes(commodity),
    `${commodity} must be accepted by Village Storehouses as backyard surplus`,
  );
}

const storagePolicySource = readFileSync('server/src/storage_acceptance_policy.rs', 'utf8');
const storehouseMask = storagePolicySource.match(
  /STOREHOUSE_ACCEPTANCE_MASK: u64 =([\s\S]*?)pub const GRANARY_ACCEPTANCE_MASK/,
)?.[1] ?? '';
const granaryMask = storagePolicySource.match(
  /GRANARY_ACCEPTANCE_MASK: u64 =([\s\S]*?)const fn bit/,
)?.[1] ?? '';
for (const commodity of backyardGranaryOutputs) {
  assert.match(
    granaryMask,
    new RegExp(`bit\\(${STORAGE_COMMODITY_CODES[commodity]}\\)`),
    `the authoritative Granary mask must accept backyard ${commodity}`,
  );
}
for (const commodity of backyardStorehouseOutputs) {
  assert.match(
    storehouseMask,
    new RegExp(`bit\\(${STORAGE_COMMODITY_CODES[commodity]}\\)`),
    `the authoritative Storehouse mask must accept backyard ${commodity}`,
  );
}

assert.equal(NAMED_FOOD_LABELS.aroniaJam, 'Aronia jam');
assert.equal(NAMED_FOOD_LABELS.rosehipJam, 'Rosehip jam');
assert.notEqual(STORAGE_COMMODITY_CODES.aroniaJam, STORAGE_COMMODITY_CODES.rosehipJam);
assert.notEqual(STORAGE_COMMODITY_CODES.cider, STORAGE_COMMODITY_CODES.pearCider);
assert.equal(breweryPolicyOutput(BREWERY_RECIPE_CIDER), 'cider');
assert.equal(breweryPolicyOutput(BREWERY_RECIPE_PEAR_CIDER), 'pearCider');

const backyardSimulation = readFileSync('server/src/simulation/backyard_garden.rs', 'utf8');
for (const mapping of [
  /AppleOrchard => Some\(CommodityKind::Apples\)/,
  /CherryOrchard => Some\(CommodityKind::Cherries\)/,
  /PearOrchard => Some\(CommodityKind::Pears\)/,
  /AroniaOrchard => Some\(CommodityKind::Aronia\)/,
  /RosehipOrchard => Some\(CommodityKind::Rosehips\)/,
  /CabbageGarden => Some\(CommodityKind::Cabbage\)/,
  /CarrotGarden => Some\(CommodityKind::Carrots\)/,
  /BeetrootGarden => Some\(CommodityKind::Beetroot\)/,
  /ChickenPen => Some\(CommodityKind::Eggs\)/,
  /GoatPen => Some\(CommodityKind::Milk\)/,
  /PigPen => Some\(CommodityKind::Meat\)/,
  /BackyardApiary => Some\(CommodityKind::Honey\)/,
  /AroniaOrchard => Some\(CommodityKind::AroniaJam\)/,
  /RosehipOrchard => Some\(CommodityKind::RosehipJam\)/,
]) {
  assert.match(backyardSimulation, mapping);
}
assert.match(
  backyardSimulation,
  /HerbGarden\s*\| BackyardGardenKind::GoatPen\s*\| BackyardGardenKind::BackyardApiary/,
);
assert.match(backyardSimulation, /CommodityKind::Remedies/);
assert.match(backyardSimulation, /CommodityKind::Hides/);
assert.match(
  backyardSimulation,
  /food_marketplace_id[\s\S]*ResidenceNeedKind::Food[\s\S]*goods_marketplace_id[\s\S]*ResidenceNeedKind::Cloth/,
  'mixed-output backyards must resolve Granary and Storehouse market assignments independently',
);
assert.match(
  backyardSimulation,
  /GoatPen[\s\S]*goods_marketplace_id[\s\S]*transfer_backyard_hides_to_storehouse/,
  'goat hides must not depend on the pen having a food-stall assignment',
);
assert.match(
  backyardSimulation,
  /BackyardApiary[\s\S]*goods_marketplace_id[\s\S]*transfer_backyard_wax_to_storehouse/,
  'backyard wax must use the Storehouse goods route independently of honey',
);

const expandedEconomy = readFileSync('server/src/simulation/expanded_economy.rs', 'utf8');
const granaryHouseholdDuty = expandedEconomy.match(
  /GranaryDispatchDuty::Households => \{([\s\S]*?)GranaryDispatchDuty::Preservation/,
)?.[1] ?? '';
for (const commodity of [
  'Apples', 'Cherries', 'Pears', 'Aronia', 'Rosehips', 'Cabbage', 'Carrots',
  'Beetroot', 'Eggs', 'Milk', 'Meat', 'Honey', 'AroniaJam', 'RosehipJam',
]) {
  assert.match(
    granaryHouseholdDuty,
    new RegExp(`CommodityKind::${commodity}`),
    `${commodity} must remain eligible for the Granary's physical Marketplace cart`,
  );
}

const storehouseSimulation = readFileSync('server/src/simulation/village_storehouse.rs', 'utf8');
assert.match(
  storehouseSimulation,
  /step_storehouse_market_stalls[\s\S]*CommodityKind::Remedies/,
  'backyard Remedies must remain eligible for a Storehouse goods-stall cart',
);
assert.match(
  expandedEconomy,
  /\("village_storehouse", CommodityKind::Hides\) => Some\(&\["tannery", "trading_post"\]\)/,
  'raw backyard hides must leave the Storehouse through industry or regional trade, not household retail',
);

const deliveryCargo = readFileSync('server/src/simulation/delivery_cargo.rs', 'utf8');
assert.match(
  deliveryCargo,
  /FRESH_ORDER[\s\S]*CommodityKind::AroniaJam[\s\S]*CommodityKind::RosehipJam/,
  'both backyard jams must remain distinct general-food deliveries',
);
assert.match(
  deliveryCargo,
  /ResidenceNeedKind::SavoryPreserves => &PRESERVED_ORDER/,
  'the Tier-4 savory-preserve need must use its dedicated physical-cart order',
);
assert.doesNotMatch(
  deliveryCargo.match(/const PRESERVED_ORDER:[\s\S]*?\];/)?.[0] ?? '',
  /AroniaJam|RosehipJam|Honey/,
  'sweet preserves must not satisfy the Tier-4 savory-preserve need',
);

for (const root of ['src/generated', 'server/src/generated']) {
  const backyardTable = readFileSync(`${root}/backyard_garden_table.ts`, 'utf8');
  const types = readFileSync(`${root}/types.ts`, 'utf8');
  assert.doesNotMatch(backyardTable, /jamStock|jam_stock/);
  for (const field of ['pears', 'aronia', 'rosehips', 'cabbage', 'carrots', 'beetroot', 'aroniaJam', 'rosehipJam', 'pearCider']) {
    assert.match(types, new RegExp(`\\b${field}:`));
  }
}

for (const icon of [
  'pears', 'aronia', 'rosehips', 'cabbage', 'carrots', 'beetroot',
  'aronia-jam', 'rosehip-jam',
]) {
  const path = `public/assets/ui/icons/provisions/${icon}.png`;
  assert.ok(existsSync(path), `${icon} needs its own generated raster icon`);
}
for (const icon of ['hides', 'leather', 'shoes']) {
  const path = `public/assets/ui/icons/materials/${icon}.png`;
  assert.ok(existsSync(path), `${icon} needs its own generated raster icon`);
}
for (const icon of ['orchard', 'vegetable-garden', 'animal-pen']) {
  const path = `public/assets/ui/icons/backyards/${icon}.png`;
  assert.ok(existsSync(path), `${icon} shell needs its own generated raster icon`);
}
assert.ok(existsSync('public/assets/ui/icons/resource-cider.png'));
assert.ok(existsSync('public/assets/ui/icons/resource-pear-cider.png'));

const iconography = readFileSync('src/ui/iconography.css', 'utf8');
const backyardIcons = readFileSync('src/ui/polishedGameUi.css', 'utf8');
for (const rejectedSvg of [
  'apple-cider', 'pear-cider', 'pears', 'aronia', 'rosehips', 'cabbage',
  'carrots', 'beetroot', 'aronia-jam', 'rosehip-jam', 'hides', 'leather', 'shoes',
]) {
  assert.doesNotMatch(iconography, new RegExp(`${rejectedSvg}\\.svg`));
}
for (const [kind, filename] of [
  ['orchard', 'orchard'],
  ['vegetable_garden', 'vegetable-garden'],
  ['animal_pen', 'animal-pen'],
] as const) {
  assert.match(
    backyardIcons,
    new RegExp(`data-garden-kind='${kind}'[\\s\\S]*?backyards/${filename}\\.png`),
  );
}

console.log('Distinct backyard crops, jams, ciders, storage, trade, bindings, and raster icon contracts passed.');
