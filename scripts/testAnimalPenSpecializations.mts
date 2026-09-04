import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import {
  BACKYARD_GARDEN_DEFINITIONS,
  type BackyardGardenKind,
} from '../src/generated/gameBalance.ts';
import {
  ANIMAL_PEN_SPECIALIZATION_KINDS,
  BACKYARD_GARDEN_PICKER_KINDS,
  isAnimalPenSpecialization,
} from '../src/residences/backyardGarden.ts';
import {
  createAnimalPenVisualPlan,
  createBackyardGardenMesh,
  disposeBackyardGardenMesh,
} from '../src/residences/backyardGardenMesh.ts';
import {
  backyardGardenMarketChannel,
  backyardGardenPhenology,
} from '../src/economy/backyardGardenTick.ts';

const animalKinds = [
  'chicken_pen',
  'goat_pen',
  'pig_pen',
] as const satisfies readonly BackyardGardenKind[];

assert.deepEqual(ANIMAL_PEN_SPECIALIZATION_KINDS, animalKinds);
assert.equal(BACKYARD_GARDEN_PICKER_KINDS.includes('animal_pen'), true);
assert.equal(backyardGardenMarketChannel('animal_pen'), null);
for (const kind of animalKinds) {
  assert.equal(isAnimalPenSpecialization(kind), true);
  assert.equal(BACKYARD_GARDEN_DEFINITIONS[kind].hiddenFromPicker, true);
  assert.equal(BACKYARD_GARDEN_PICKER_KINDS.includes(kind), false);
  assert.equal(BACKYARD_GARDEN_DEFINITIONS[kind].specializationOf, 'animal_pen');
}

assert.deepEqual(
  animalKinds.map((kind) => {
    const def = BACKYARD_GARDEN_DEFINITIONS[kind];
    return {
      kind,
      stockingGold: def.goldCost - BACKYARD_GARDEN_DEFINITIONS.animal_pen.goldCost,
      maturity: def.firstHarvestDays,
      gestation: def.gestationDays,
      primaryInterval: def.productionIntervalDays,
      primaryWindow: [def.harvestStartMonth, def.harvestEndMonth],
      secondaryInterval: def.secondaryProductionIntervalDays,
      secondaryWindow: [def.secondaryHarvestStartMonth, def.secondaryHarvestEndMonth],
    };
  }),
  [
    {
      kind: 'chicken_pen',
      stockingGold: 2,
      maturity: 21,
      gestation: 21,
      primaryInterval: 2,
      primaryWindow: [3, 11],
      secondaryInterval: 60,
      secondaryWindow: [9, 11],
    },
    {
      kind: 'goat_pen',
      stockingGold: 4,
      maturity: 150,
      gestation: 150,
      primaryInterval: 3,
      primaryWindow: [4, 10],
      secondaryInterval: 150,
      secondaryWindow: [10, 11],
    },
    {
      kind: 'pig_pen',
      stockingGold: 5,
      maturity: 114,
      gestation: 114,
      primaryInterval: 114,
      primaryWindow: [10, 12],
      secondaryInterval: 0,
      secondaryWindow: [0, 0],
    },
  ],
);

assert.ok(BACKYARD_GARDEN_DEFINITIONS.goat_pen.hidePerPersonPerSecondaryHarvest > 0);
assert.equal(BACKYARD_GARDEN_DEFINITIONS.chicken_pen.hidePerPersonPerSecondaryHarvest, 0);
assert.equal(BACKYARD_GARDEN_DEFINITIONS.pig_pen.hidePerPersonPerSecondaryHarvest, 0);
assert.ok(BACKYARD_GARDEN_DEFINITIONS.goat_pen.hideCapacity >= 12);

assert.equal(backyardGardenPhenology('animal_pen', 7).baseMultiplier, 0);
assert.equal(backyardGardenPhenology('chicken_pen', 7, 1).phase, 'establishing');
assert.equal(backyardGardenPhenology('chicken_pen', 7).harvestable, true);
assert.equal(backyardGardenPhenology('goat_pen', 11).harvestable, false);
assert.equal(backyardGardenPhenology('pig_pen', 11).harvestable, true);

const planKinds = ['animal_pen', ...animalKinds] as const;
for (const kind of planKinds) {
  const left = createAnimalPenVisualPlan(kind, 6.2, 5.4, 4271);
  const right = createAnimalPenVisualPlan(kind, 6.2, 5.4, 4271);
  assert.deepEqual(left, right, `${kind} visual plan must be deterministic`);
  assert.equal(left.fixtures.includes('trough'), true);
  assert.equal(left.enclosure.owner, 'residence-perimeter');

  const mesh = createBackyardGardenMesh(kind, { width: 6.2, depth: 5.4, seed: 4271 });
  const names: string[] = [];
  let triangles = 0;
  mesh.traverse((object) => {
    if (object.name) names.push(object.name);
    const candidate = object as THREE.Mesh;
    if (!candidate.isMesh) return;
    const indexCount = candidate.geometry.index?.count
      ?? candidate.geometry.getAttribute('position')?.count
      ?? 0;
    triangles += indexCount / 3;
  });
  assert.equal(names.includes('Animal pen enclosure fence'), false);
  assert.equal(names.includes('Animal pen gate'), false);
  assert.equal(names.includes('Animal pen weather shelter'), true);
  assert.ok(triangles > 50, `${kind} should compile composed shelter and husbandry fixtures`);
  disposeBackyardGardenMesh(mesh);
}

const reducerSource = readFileSync(join(process.cwd(), 'server/src/reducers/backyards.rs'), 'utf8');
const policySource = readFileSync(join(process.cwd(), 'server/src/backyard_garden_policy.rs'), 'utf8');
const simulationSource = readFileSync(join(process.cwd(), 'server/src/simulation/backyard_garden.rs'), 'utf8');
const commoditySource = readFileSync(join(process.cwd(), 'server/src/economy/commodities.rs'), 'utf8');
const tableSource = readFileSync(join(process.cwd(), 'server/src/tables.rs'), 'utf8');
const inspectorSource = readFileSync(join(process.cwd(), 'src/resources/inspector/backyardRenderer.ts'), 'utf8');
const foleySource = readFileSync(join(process.cwd(), 'src/audio/WorldFoleyAudio.ts'), 'utf8');
const foodDistributorStart = simulationSource.indexOf('fn try_distribute_backyard_food_batches(');
assert.notEqual(foodDistributorStart, -1, 'the atomic backyard-food distributor must exist');
const foodDistributorEnd = simulationSource.indexOf('\nfn ', foodDistributorStart + 1);
const foodDistributorSource = simulationSource.slice(
  foodDistributorStart,
  foodDistributorEnd === -1 ? simulationSource.length : foodDistributorEnd,
);

assert.match(reducerSource, /specialize_animal_pen[\s\S]*BackyardGardenKind::AnimalPen/);
assert.match(reducerSource, /specialization_of == Some\("animal_pen"\)/);
assert.match(reducerSource, /stocking_gold[\s\S]*breeding stock and husbandry equipment/);
assert.match(reducerSource, /last_primary_production_day = total_days/);
assert.match(reducerSource, /last_secondary_production_day = total_days/);
assert.match(policySource, /backyard_interval_harvest_due/);
assert.match(policySource, /total_days\.saturating_sub\(last_production_day\) >= interval_days/);
assert.match(simulationSource, /ChickenPen => Some\(CommodityKind::Eggs\)/);
assert.match(simulationSource, /GoatPen => Some\(CommodityKind::Milk\)/);
assert.match(simulationSource, /PigPen => Some\(CommodityKind::Meat\)/);
assert.match(simulationSource, /secondary_food_per_person_per_sec[\s\S]*CommodityKind::Meat/);
assert.match(simulationSource, /hide_per_person_per_secondary_harvest[\s\S]*hide_capacity/);
assert.match(
  foodDistributorSource,
  /backyard_depot[\s\S]*ResidenceNeedKind::Food[\s\S]*allocate_backyard_food[\s\S]*deposit_residence_commodity[\s\S]*deposit_building_commodity/,
  'animal food must reserve the household share before routing whole-unit surplus through a Food depot',
);
assert.match(
  foodDistributorSource,
  /deposit_building_commodity[\s\S]*deposit_residence_commodity[\s\S]*if remaining >= 1\.0 \{[\s\S]*return None;[\s\S]*ctx\.db\.residence\(\)\.id\(\)\.update/,
  'a rejected surplus must return to the pantry, and an unplaceable basket must abort before committing either destination',
);
assert.match(simulationSource, /transfer_backyard_hides_to_storehouse/);
assert.match(
  simulationSource,
  /let food_marketplace_id[\s\S]*let goods_marketplace_id[\s\S]*GoatPen[\s\S]*goods_marketplace_id[\s\S]*transfer_backyard_hides_to_storehouse/,
  'a Goat Pen must route food and hides independently so either compatible depot can accept its surplus',
);
assert.match(commoditySource, /tier == 3[\s\S]*land_animal_food/);
assert.match(commoditySource, /FoodCategory::AnimalProduce\.bit\(\)[\s\S]*FoodCategory::Meats\.bit\(\)/);
assert.match(commoditySource, /3 => 4,[\s\S]*_ => 5/);
for (const field of [
  'first_harvest_day',
  'last_primary_production_day',
  'last_secondary_production_day',
  'hide_stock',
]) {
  assert.match(tableSource, new RegExp(`pub ${field}:`));
}
assert.match(inspectorSource, /renderAnimalPenSpecializationPicker/);
assert.match(inspectorSource, /data-inspector-action="specialize-animal-pen"/);
assert.match(
  inspectorSource,
  /kind === 'chicken_pen' \? 'data-ui-sound="chicken_coop_select"'/,
);
assert.match(
  inspectorSource,
  /kind === 'goat_pen' \? 'data-ui-sound="goat_pen_select"'/,
);
assert.match(
  inspectorSource,
  /kind === 'pig_pen' \? 'data-ui-sound="pig_pen_select"'/,
);
assert.match(inspectorSource, /Gestation \/ maturity/);
assert.match(inspectorSource, /Untanned hides/);
assert.match(foleySource, /garden\.kind === 'chicken_pen'/);
assert.match(foleySource, /garden\.kind === 'pig_pen'/);

for (const file of ['quaternius-chicken.glb', 'quaternius-pig.glb', 'quaternius-sheep.glb']) {
  const path = join(process.cwd(), 'public/assets/models/livestock', file);
  assert.ok(existsSync(path) && statSync(path).size > 50_000, `${file} must remain a real rigged GLB`);
}

console.log('Animal Pen perimeter ownership, livestock lifecycle, supply-chain, hide, and visual contracts passed.');
