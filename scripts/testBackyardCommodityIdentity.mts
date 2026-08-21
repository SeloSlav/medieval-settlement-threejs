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

assert.equal(NAMED_FOOD_LABELS.aroniaJam, 'Aronia jam');
assert.equal(NAMED_FOOD_LABELS.rosehipJam, 'Rosehip jam');
assert.notEqual(STORAGE_COMMODITY_CODES.aroniaJam, STORAGE_COMMODITY_CODES.rosehipJam);
assert.notEqual(STORAGE_COMMODITY_CODES.cider, STORAGE_COMMODITY_CODES.pearCider);
assert.equal(breweryPolicyOutput(BREWERY_RECIPE_CIDER), 'cider');
assert.equal(breweryPolicyOutput(BREWERY_RECIPE_PEAR_CIDER), 'pearCider');

const backyardSimulation = readFileSync('server/src/simulation/backyard_garden.rs', 'utf8');
for (const mapping of [
  /PearOrchard => Some\(CommodityKind::Pears\)/,
  /AroniaOrchard => Some\(CommodityKind::Aronia\)/,
  /RosehipOrchard => Some\(CommodityKind::Rosehips\)/,
  /CabbageGarden => Some\(CommodityKind::Cabbage\)/,
  /CarrotGarden => Some\(CommodityKind::Carrots\)/,
  /BeetrootGarden => Some\(CommodityKind::Beetroot\)/,
  /AroniaOrchard => Some\(CommodityKind::AroniaJam\)/,
  /RosehipOrchard => Some\(CommodityKind::RosehipJam\)/,
]) {
  assert.match(backyardSimulation, mapping);
}

const needSimulation = readFileSync('server/src/simulation/residence_needs/mod.rs', 'utf8');
assert.match(needSimulation, /residence\.tier >= 4[\s\S]*RESIDENCE_LUXURY_JAM_PER_PERSON_PER_SEC/);
assert.match(needSimulation, /residence\.aronia_jam[\s\S]*residence\.rosehip_jam/);
assert.match(needSimulation, /allocation\.remaining_stock[\s\S]*aronia_used[\s\S]*rosehip_jam/);

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
