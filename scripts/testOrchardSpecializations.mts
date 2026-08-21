import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  BACKYARD_GARDEN_DEFINITIONS,
  BACKYARD_GARDEN_KINDS,
  RESIDENCE_LUXURY_JAM_CAPACITY,
  RESIDENCE_LUXURY_JAM_PER_PERSON_PER_SEC,
  type BackyardGardenKind,
} from '../src/generated/gameBalance.ts';
import {
  BACKYARD_GARDEN_PICKER_KINDS,
  ORCHARD_SPECIALIZATION_KINDS,
  isOrchardSpecialization,
} from '../src/residences/backyardGarden.ts';
import {
  backyardGardenMarketChannel,
  backyardGardenPhenology,
  backyardGardenSeasonalMultiplier,
} from '../src/economy/backyardGardenTick.ts';
import {
  RESIDENCE_NEED_KIND_IDS,
  activeResidenceNeedKinds,
  needKindFromId,
} from '../src/residences/residenceNeedState.ts';

const canonicalKinds = [
  'orchard',
  'apple_orchard',
  'cherry_orchard',
  'pear_orchard',
  'aronia_orchard',
  'rosehip_orchard',
  'vegetable_garden',
  'cabbage_garden',
  'carrot_garden',
  'beetroot_garden',
  'flower_garden',
  'herb_garden',
  'animal_pen',
  'chicken_pen',
  'goat_pen',
  'pig_pen',
  'backyard_apiary',
] as const;
assert.deepEqual(
  BACKYARD_GARDEN_KINDS,
  canonicalKinds,
  'backyard ids should follow the development schema, with orchard and its plantings first',
);

const orchardKinds = [
  'apple_orchard',
  'cherry_orchard',
  'pear_orchard',
  'aronia_orchard',
  'rosehip_orchard',
] as const satisfies readonly BackyardGardenKind[];
assert.deepEqual(ORCHARD_SPECIALIZATION_KINDS, orchardKinds);
assert.equal(BACKYARD_GARDEN_PICKER_KINDS[0], 'orchard');
assert.equal(backyardGardenMarketChannel('orchard'), null);
for (const kind of orchardKinds) {
  assert.equal(isOrchardSpecialization(kind), true);
  assert.equal(BACKYARD_GARDEN_DEFINITIONS[kind].hiddenFromPicker, true);
  assert.equal(BACKYARD_GARDEN_PICKER_KINDS.includes(kind), false);
  assert.ok(BACKYARD_GARDEN_DEFINITIONS[kind].firstHarvestDays > 0);
  assert.ok(BACKYARD_GARDEN_DEFINITIONS[kind].harvestStartMonth > 0);
  assert.ok(BACKYARD_GARDEN_DEFINITIONS[kind].yieldEfficiency > 0);
}

assert.deepEqual(
  orchardKinds.map((kind) => ({
    kind,
    maturity: BACKYARD_GARDEN_DEFINITIONS[kind].firstHarvestDays,
    window: [
      BACKYARD_GARDEN_DEFINITIONS[kind].harvestStartMonth,
      BACKYARD_GARDEN_DEFINITIONS[kind].harvestEndMonth,
    ],
    efficiency: BACKYARD_GARDEN_DEFINITIONS[kind].yieldEfficiency,
  })),
  [
    { kind: 'apple_orchard', maturity: 90, window: [9, 9], efficiency: 1 },
    { kind: 'cherry_orchard', maturity: 120, window: [6, 6], efficiency: 0.92 },
    { kind: 'pear_orchard', maturity: 150, window: [9, 10], efficiency: 1.08 },
    { kind: 'aronia_orchard', maturity: 60, window: [8, 9], efficiency: 0.9 },
    { kind: 'rosehip_orchard', maturity: 75, window: [10, 11], efficiency: 0.82 },
  ],
);

for (const kind of orchardKinds) {
  const def = BACKYARD_GARDEN_DEFINITIONS[kind];
  const establishing = backyardGardenPhenology(kind, def.harvestStartMonth, 1);
  assert.equal(establishing.phase, 'establishing');
  assert.equal(establishing.baseMultiplier, 0);
  assert.equal(establishing.produceVisibility, 'none');
  const harvest = backyardGardenPhenology(kind, def.harvestStartMonth);
  assert.equal(harvest.phase, 'harvest');
  assert.equal(harvest.harvestable, true);
  assert.equal(harvest.produceVisibility, 'harvest');
  const expected = 12 / (def.harvestEndMonth - def.harvestStartMonth + 1)
    * def.yieldEfficiency;
  assert.ok(Math.abs(harvest.baseMultiplier - expected) < 1e-9);
}
assert.equal(backyardGardenPhenology('orchard', 9).baseMultiplier, 0);
assert.equal(backyardGardenPhenology('cherry_orchard', 9).phase, 'post_harvest');
assert.equal(backyardGardenPhenology('rosehip_orchard', 9).phase, 'ripening');
assert.ok(Math.abs(backyardGardenSeasonalMultiplier(
  'aronia_orchard',
  8,
  { season: 'summer', weather: 'drought' },
) - 4.05) < 1e-9);
assert.ok(Math.abs(backyardGardenSeasonalMultiplier(
  'rosehip_orchard',
  10,
  { season: 'autumn', weather: 'drought' },
) - 4.182) < 1e-9);

assert.ok(BACKYARD_GARDEN_DEFINITIONS.aronia_orchard.jamPerPersonPerSec > 0);
assert.ok(
  BACKYARD_GARDEN_DEFINITIONS.rosehip_orchard.jamPerPersonPerSec
    > BACKYARD_GARDEN_DEFINITIONS.aronia_orchard.jamPerPersonPerSec,
);
assert.ok(RESIDENCE_LUXURY_JAM_CAPACITY >= 12);
assert.ok(RESIDENCE_LUXURY_JAM_PER_PERSON_PER_SEC > 0);
assert.equal(BACKYARD_GARDEN_DEFINITIONS.flower_garden.luxuryUpgradeGoldCost, 8);
assert.equal(RESIDENCE_NEED_KIND_IDS.luxury, 57);
assert.equal(needKindFromId(57), 'luxury');
assert.equal(activeResidenceNeedKinds(3).includes('luxury'), false);
assert.equal(activeResidenceNeedKinds(4).includes('luxury'), true);

const reducerSource = readFileSync(join(process.cwd(), 'server/src/reducers/backyards.rs'), 'utf8');
const policySource = readFileSync(join(process.cwd(), 'server/src/backyard_garden_policy.rs'), 'utf8');
const simulationSource = readFileSync(join(process.cwd(), 'server/src/simulation/backyard_garden.rs'), 'utf8');
const needsSource = readFileSync(join(process.cwd(), 'server/src/simulation/residence_needs/mod.rs'), 'utf8');
const needStateSource = readFileSync(join(process.cwd(), 'server/src/simulation/residence_needs/state.rs'), 'utf8');
const tablesSource = readFileSync(join(process.cwd(), 'server/src/tables.rs'), 'utf8');
const clientReducerSource = readFileSync(join(process.cwd(), 'src/data/spacetimeReducers.ts'), 'utf8');
const inspectorSource = readFileSync(join(process.cwd(), 'src/resources/inspector/backyardRenderer.ts'), 'utf8');

assert.match(reducerSource, /specialize_orchard[\s\S]*Only a completed, unplanted orchard/);
assert.match(reducerSource, /def\.specialization_of\.is_some\(\)[\s\S]*matching backyard shell first/);
assert.match(reducerSource, /specialization_of == Some\("orchard"\)/);
assert.match(reducerSource, /first_harvest_day = total_days\.saturating_add\(def\.first_harvest_days\)/);
assert.match(reducerSource, /demolish_backyard_garden[\s\S]*backyard_garden\(\)\.id\(\)\.delete\(garden\.id\)/);
assert.match(reducerSource, /residence\.tier < 4[\s\S]*luxury cut flowers/);
assert.match(reducerSource, /garden\.flower_luxury_upgraded = true/);
assert.match(simulationSource, /first_harvest_day > clock\.total_days/);
assert.match(simulationSource, /jam_per_person_per_sec[\s\S]*deposit_backyard_jam/);
assert.match(needsSource, /ResidenceNeedKind::Luxury[\s\S]*consume_backyard_luxury/);
assert.match(needsSource, /garden\.flower_luxury_upgraded[\s\S]*stock: 1\.0/);
assert.match(policySource, /allocate_backyard_jam_meal[\s\S]*food_used:[\s\S]*luxury_met:/);
assert.match(needsSource, /consume_food_with_preserved[\s\S]*consume_backyard_jam_meal/);
assert.match(needsSource, /jam_meal\.luxury_met[\s\S]*remaining_stock/);
assert.match(needStateSource, /residence_edible_food_stock\(residence\)[\s\S]*backyard_jam_food_stock/);
assert.doesNotMatch(needsSource, /garden\.jam_stock - demand/);
for (const field of ['first_harvest_day', 'jam_stock', 'flower_luxury_upgraded']) {
  assert.match(tablesSource, new RegExp(`pub ${field}:`));
}
assert.match(clientReducerSource, /specializeOrchard[\s\S]*specialize_orchard/);
assert.match(clientReducerSource, /upgradeFlowerGardenLuxury[\s\S]*upgrade_flower_garden_luxury/);
assert.match(inspectorSource, /renderOrchardSpecializationPicker/);
assert.match(inspectorSource, /data-inspector-action="specialize-orchard"/);
assert.match(inspectorSource, /upgrade-flower-luxury/);

for (const file of ['pear.glb', 'aronia_cluster.glb', 'rosehip_cluster.glb']) {
  const path = join(process.cwd(), 'vendor/seedthree/assets/fruits', file);
  assert.ok(existsSync(path) && statSync(path).size > 50_000, `${file} should be a non-placeholder GLB`);
}
for (const file of ['pear_leaf_source.png', 'aronia_leaf_source.png', 'rosehip_leaf_source.png']) {
  assert.ok(existsSync(join(process.cwd(), 'art-source/seedthree/orchards', file)));
}
for (const species of ['pear', 'aronia', 'rosehip']) {
  assert.ok(existsSync(join(process.cwd(), 'vendor/seedthree/src/species', `${species}.js`)));
}

console.log('Orchard specialization, maturity, jam, and tier-4 luxury contracts passed.');
