import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BACKYARD_GARDEN_DEFINITIONS,
  type BackyardGardenKind,
} from '../src/generated/gameBalance.ts';
import {
  BACKYARD_GARDEN_PICKER_KINDS,
  VEGETABLE_GARDEN_SPECIALIZATION_KINDS,
  isVegetableGardenSpecialization,
} from '../src/residences/backyardGarden.ts';
import {
  backyardGardenMarketChannel,
  backyardGardenPhenology,
  backyardGardenSeasonalMultiplier,
} from '../src/economy/backyardGardenTick.ts';
import {
  createBackyardGardenMesh,
  disposeBackyardGardenMesh,
} from '../src/residences/backyardGardenMesh.ts';

const vegetableKinds = [
  'cabbage_garden',
  'carrot_garden',
  'beetroot_garden',
] as const satisfies readonly BackyardGardenKind[];

assert.deepEqual(VEGETABLE_GARDEN_SPECIALIZATION_KINDS, vegetableKinds);
assert.equal(BACKYARD_GARDEN_DEFINITIONS.vegetable_garden.foodPerPersonPerSec, 0);
assert.equal(BACKYARD_GARDEN_DEFINITIONS.vegetable_garden.goldCost, 2);
assert.equal(backyardGardenMarketChannel('vegetable_garden'), null);
assert.equal(backyardGardenPhenology('vegetable_garden', 7).harvestable, false);
for (const kind of vegetableKinds) {
  assert.equal(isVegetableGardenSpecialization(kind), true);
  assert.equal(BACKYARD_GARDEN_DEFINITIONS[kind].specializationOf, 'vegetable_garden');
  assert.equal(BACKYARD_GARDEN_DEFINITIONS[kind].hiddenFromPicker, true);
  assert.equal(BACKYARD_GARDEN_PICKER_KINDS.includes(kind), false);
  assert.ok(BACKYARD_GARDEN_DEFINITIONS[kind].firstHarvestDays > 0);
  assert.ok(BACKYARD_GARDEN_DEFINITIONS[kind].harvestStartMonth > 0);
  assert.ok(BACKYARD_GARDEN_DEFINITIONS[kind].yieldEfficiency > 0);
  assert.equal(backyardGardenMarketChannel(kind), 'food');
}

assert.deepEqual(
  vegetableKinds.map((kind) => {
    const def = BACKYARD_GARDEN_DEFINITIONS[kind];
    return {
      kind,
      seedGold: def.goldCost - BACKYARD_GARDEN_DEFINITIONS.vegetable_garden.goldCost,
      maturity: def.firstHarvestDays,
      window: [def.harvestStartMonth, def.harvestEndMonth],
      rate: def.foodPerPersonPerSec,
      efficiency: def.yieldEfficiency,
    };
  }),
  [
    { kind: 'cabbage_garden', seedGold: 3, maturity: 105, window: [7, 11], rate: 0.0038, efficiency: 1.15 },
    { kind: 'carrot_garden', seedGold: 2, maturity: 75, window: [6, 11], rate: 0.0029, efficiency: 0.98 },
    { kind: 'beetroot_garden', seedGold: 1, maturity: 60, window: [5, 10], rate: 0.00235, efficiency: 0.9 },
  ],
);

const annualized = Object.fromEntries(vegetableKinds.map((kind) => {
  const def = BACKYARD_GARDEN_DEFINITIONS[kind];
  const months = def.harvestEndMonth - def.harvestStartMonth + 1;
  return [kind, def.foodPerPersonPerSec * def.yieldEfficiency * months];
})) as Record<(typeof vegetableKinds)[number], number>;
assert.ok(annualized.cabbage_garden > annualized.carrot_garden);
assert.ok(annualized.carrot_garden > annualized.beetroot_garden);

for (const kind of vegetableKinds) {
  const def = BACKYARD_GARDEN_DEFINITIONS[kind];
  const establishing = backyardGardenPhenology(kind, def.harvestStartMonth, 1);
  assert.equal(establishing.harvestable, false);
  assert.equal(establishing.baseMultiplier, 0);
  const harvest = backyardGardenPhenology(kind, def.harvestStartMonth, 0);
  assert.equal(harvest.harvestable, true);
  assert.equal(harvest.baseMultiplier, def.yieldEfficiency);
  assert.equal(
    backyardGardenSeasonalMultiplier(
      kind,
      def.harvestStartMonth,
      { season: def.harvestStartMonth <= 5 ? 'spring' : def.harvestStartMonth <= 8 ? 'summer' : 'autumn', weather: 'fair' },
    ),
    def.yieldEfficiency,
  );
}
assert.ok(Math.abs(backyardGardenSeasonalMultiplier(
  'cabbage_garden',
  7,
  { season: 'summer', weather: 'drought' },
) - 0.6325) < 1e-9);

const shell = createBackyardGardenMesh('vegetable_garden', { width: 6.2, depth: 5.4, seed: 4271 });
const shellCrops = new Set<string>();
shell.traverse((object) => {
  if (object.userData.backyardCropKind) shellCrops.add(object.userData.backyardCropKind as string);
});
assert.deepEqual([...shellCrops], []);
disposeBackyardGardenMesh(shell);

for (const [kind, expectedCrop, rowPrefix] of [
  ['cabbage_garden', 'cabbage', 'CabbageRows:'],
  ['carrot_garden', 'carrot', 'CarrotRows:'],
  ['beetroot_garden', 'beetroot', 'BeetrootRows:'],
] as const) {
  const garden = createBackyardGardenMesh(kind, { width: 6.2, depth: 5.4, seed: 4271 });
  const crops = new Set<string>();
  let rowCount = 0;
  let exposedBeetRoots = 0;
  garden.traverse((object) => {
    if (object.userData.backyardCropKind) crops.add(object.userData.backyardCropKind as string);
    if (object.name.startsWith(rowPrefix)) rowCount += 1;
    if (object.name === 'Visible beetroot shoulder') exposedBeetRoots += 1;
  });
  assert.deepEqual([...crops], [expectedCrop]);
  assert.equal(rowCount, 3, `${kind} should plant all three beds with one crop`);
  assert.equal(exposedBeetRoots, 0, `${kind} should never render an above-ground beetroot bulb`);
  disposeBackyardGardenMesh(garden);
}

const reducerSource = readFileSync('server/src/reducers/backyards.rs', 'utf8');
const simulationSource = readFileSync('server/src/simulation/backyard_garden.rs', 'utf8');
const policySource = readFileSync('server/src/backyard_garden_policy.rs', 'utf8');
const inspectorSource = readFileSync('src/resources/inspector/backyardRenderer.ts', 'utf8');
const actionSource = readFileSync('src/data/spacetimeReducers.ts', 'utf8');
const meshSource = readFileSync('src/residences/backyardGardenMesh.ts', 'utf8');

assert.match(reducerSource, /pub fn specialize_vegetable_garden/);
assert.match(reducerSource, /candidate\.specialization_of == Some\("vegetable_garden"\)/);
assert.match(reducerSource, /garden\.first_harvest_day = total_days\.saturating_add\(def\.first_harvest_days\)/);
assert.match(reducerSource, /let seed_gold = \(def\.cost_gold - shell\.cost_gold\)\.max\(0\.0\)/);
assert.match(simulationSource, /CabbageGarden => Some\(CommodityKind::Cabbage\)/);
assert.match(simulationSource, /CarrotGarden => Some\(CommodityKind::Carrots\)/);
assert.match(simulationSource, /BeetrootGarden => Some\(CommodityKind::Beetroot\)/);
assert.doesNotMatch(simulationSource, /CabbageGarden[\s\S]{0,120}CommodityKind::Vegetables/);
assert.match(policySource, /CabbageGarden \| CarrotGarden \| BeetrootGarden/);
assert.match(inspectorSource, /renderVegetableGardenSpecializationPicker/);
assert.match(inspectorSource, /data-inspector-action="specialize-vegetable-garden"/);
assert.match(actionSource, /specialize_vegetable_garden/);
assert.match(meshSource, /addVegetableGarden\(group, width, depth, seed, 'cabbage'\)/);
assert.match(meshSource, /addVegetableGarden\(group, width, depth, seed, 'carrot'\)/);
assert.match(meshSource, /addVegetableGarden\(group, width, depth, seed, 'beetroot'\)/);

console.log('Vegetable Garden shell, seed choice, crop lifecycle, economy, and homogeneous visual contracts passed.');
