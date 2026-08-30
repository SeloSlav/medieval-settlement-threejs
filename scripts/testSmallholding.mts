import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { computeBackyardGardenTickEffects } from '../src/economy/backyardGardenTick.ts';
import {
  smallholdingBackyardProductivityMultiplier,
  smallholdingDedicatedResidents,
} from '../src/economy/smallholding.ts';
import { evaluateResidenceUpgrade } from '../src/economy/residenceUpgrade.ts';
import { SMALLHOLDING_BACKYARD_PRODUCTIVITY_MULTIPLIER } from '../src/generated/gameBalance.ts';

const normalHousehold = {
  population: 4,
  sickPopulation: 1,
  smallholding: false,
};
const dedicatedHousehold = {
  ...normalHousehold,
  smallholding: true,
};

assert.equal(SMALLHOLDING_BACKYARD_PRODUCTIVITY_MULTIPLIER, 2);
assert.equal(smallholdingDedicatedResidents(normalHousehold), 0);
assert.equal(smallholdingDedicatedResidents(dedicatedHousehold), 3);
assert.equal(smallholdingBackyardProductivityMultiplier(normalHousehold), 1);
assert.equal(smallholdingBackyardProductivityMultiplier(dedicatedHousehold), 2);

const normalChickenOutput = computeBackyardGardenTickEffects(
  'chicken_pen',
  4,
  false,
  86_400,
  1,
  0,
  1,
  0,
  1,
);
const smallholdingChickenOutput = computeBackyardGardenTickEffects(
  'chicken_pen',
  4,
  false,
  86_400,
  1,
  0,
  1,
  0,
  SMALLHOLDING_BACKYARD_PRODUCTIVITY_MULTIPLIER,
);
assert.ok(normalChickenOutput.selfFood > 0);
assert.ok(
  Math.abs(smallholdingChickenOutput.selfFood - normalChickenOutput.selfFood * 2) < 1e-9,
  'Smallholding productivity must double primary backyard output',
);

assert.equal(
  evaluateResidenceUpgrade(
    { smallholding: true } as Parameters<typeof evaluateResidenceUpgrade>[0],
    {} as Parameters<typeof evaluateResidenceUpgrade>[1],
    {} as Parameters<typeof evaluateResidenceUpgrade>[2],
  ),
  null,
  'Smallholdings must never expose a tier-upgrade plan',
);

const source = (path: string): string => readFileSync(path, 'utf8');
const schema = source('server/src/tables.rs');
const residenceReducers = source('server/src/reducers/residences.rs');
const population = source('server/src/economy/population.rs');
const backyardSimulation = source('server/src/simulation/backyard_garden.rs');
const residenceInspector = source('src/resources/inspector/residenceRenderer.ts');
const villagerRenderer = source('src/settlement/VillagerRenderer.ts');
const generatedResidence = source('src/generated/residence_table.ts');
const generatedReducers = source('src/generated/index.ts');

assert.match(schema, /pub smallholding: bool/);
assert.match(residenceReducers, /pub fn convert_residence_to_smallholding/);
assert.match(residenceReducers, /if residence\.smallholding[\s\S]*permanently locked at tier 1/);
assert.match(residenceReducers, /residence\.tier != 1/);
assert.match(residenceReducers, /reconcile_building_labor\(ctx, owner\)/);
assert.match(population, /smallholding_assignable_population\(/);
assert.match(backyardSimulation, /smallholding_backyard_productivity_multiplier\(residence\.smallholding\)/);
assert.match(backyardSimulation, /def\.yield_efficiency \* productivity_multiplier/);
assert.match(backyardSimulation, /def\.hide_per_person_per_secondary_harvest[\s\S]*productivity_multiplier/);
assert.match(residenceInspector, /title:[\s\S]*'Smallholding'/);
assert.match(residenceInspector, /data-action="convert-residence-to-smallholding"/);
assert.match(residenceInspector, /unavailable to workplaces, hauling, and construction/);
assert.match(villagerRenderer, /Smallholder · Dedicated backyard artisan/);
assert.match(generatedResidence, /smallholding/);
assert.match(generatedReducers, /convert_residence_to_smallholding_reducer/);
assert.equal(existsSync('src/generated/convert_residence_to_smallholding_reducer.ts'), true);
assert.equal(existsSync('public/assets/ui/icons/upgrades/smallholding.png'), true);

console.log('smallholding policy tests passed');
