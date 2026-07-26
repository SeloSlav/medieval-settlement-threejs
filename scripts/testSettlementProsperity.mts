import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  CALENDAR_HOURS_PER_DAY,
  CALENDAR_SECONDS_PER_DAY,
  CALENDAR_WORK_END_HOUR,
  CALENDAR_WORK_START_HOUR,
  RESIDENCE_ALE_PER_PERSON_PER_SEC,
  RESIDENCE_CLOTH_PER_PERSON_PER_SEC,
  RESIDENCE_PRESERVED_FOOD_PER_PERSON_PER_SEC,
} from '../src/generated/gameBalance.ts';
import {
  computeSettlementProsperityPlan,
  projectTierThreeUpgrade,
} from '../src/economy/settlementProsperity.ts';

const workdaySeconds = CALENDAR_SECONDS_PER_DAY
  * (CALENDAR_WORK_END_HOUR - CALENDAR_WORK_START_HOUR)
  / CALENDAR_HOURS_PER_DAY;
const preservedPerResident =
  RESIDENCE_PRESERVED_FOOD_PER_PERSON_PER_SEC * workdaySeconds;
const alePerResident = RESIDENCE_ALE_PER_PERSON_PER_SEC * workdaySeconds;
const clothPerResident = RESIDENCE_CLOTH_PER_PERSON_PER_SEC * workdaySeconds;

const production = {
  tierThreeResidents: 50,
  preservedFoodOutputPerDay: preservedPerResident * 80,
  preservedFoodDemandPerDay: preservedPerResident * 50,
  aleOutputPerDay: alePerResident * 120,
  aleDemandPerDay: alePerResident * 50,
  clothOutputPerDay: clothPerResident * 200,
  clothDemandPerDay: clothPerResident * 50,
};
const growth = {
  additionalPreservedFoodPerDay: preservedPerResident * 20,
  additionalAlePerDay: alePerResident * 20,
  additionalClothPerDay: clothPerResident * 20,
};
const plan = computeSettlementProsperityPlan(production, growth);
assert.equal(plan.currentResidents, 50);
assert.equal(plan.existingTierThreeVacancies, 20);
assert.equal(plan.existingFullResidents, 70);
assert.equal(plan.installedResidentCapacity, 80);
assert.equal(plan.currentHeadroomResidents, 30);
assert.equal(plan.fullHousingHeadroomResidents, 10);
assert.equal(plan.currentSustainable, true);
assert.equal(plan.fullExistingHousingSustainable, true);
assert.equal(plan.limitingKind, 'preservedFood');
assert.equal(plan.limitingLabel, 'preserved food');
approx(
  plan.chains.find((chain) => chain.kind === 'ale')?.supportedResidents ?? -1,
  120,
);

const promotion = projectTierThreeUpgrade(
  plan,
  { population: 6, abandoned: false },
  10,
);
assert.equal(promotion.occupantsPromotedNow, 6);
assert.equal(promotion.immediateResidents, 56);
assert.equal(promotion.fullPipelineResidents, 80);
assert.equal(promotion.immediateSustainable, true);
assert.equal(promotion.fullPipelineSustainable, true);
assert.equal(promotion.immediateHeadroomResidents, 24);
approx(promotion.immediateDemand.preservedFood, preservedPerResident * 6);
approx(promotion.immediateDemand.ale, alePerResident * 6);
approx(promotion.immediateDemand.cloth, clothPerResident * 6);
approx(promotion.fullHouseDemand.preservedFood, preservedPerResident * 10);

const immediateShortfall = computeSettlementProsperityPlan({
  ...production,
  preservedFoodOutputPerDay: preservedPerResident * 55,
});
const riskyPromotion = projectTierThreeUpgrade(
  immediateShortfall,
  { population: 6, abandoned: false },
  10,
);
assert.equal(riskyPromotion.immediateSustainable, false);
assert.equal(riskyPromotion.immediateHeadroomResidents, -1);

const noIndustry = computeSettlementProsperityPlan({
  tierThreeResidents: 0,
  preservedFoodOutputPerDay: Number.NaN,
  preservedFoodDemandPerDay: 0,
  aleOutputPerDay: 0,
  aleDemandPerDay: 0,
  clothOutputPerDay: 0,
  clothDemandPerDay: 0,
});
assert.equal(noIndustry.installedResidentCapacity, 0);
assert.equal(noIndustry.currentSustainable, true);

const started = performance.now();
let capacityTotal = 0;
for (let index = 0; index < 100_000; index += 1) {
  capacityTotal += computeSettlementProsperityPlan(production, growth)
    .installedResidentCapacity;
}
const elapsedMs = performance.now() - started;
assert.equal(capacityTotal, 8_000_000);
assert.ok(
  elapsedMs < 500,
  `100,000 prosperity projections regressed (${elapsedMs.toFixed(1)} ms)`,
);

const inspector = readFileSync('src/resources/inspector/residenceRenderer.ts', 'utf8');
assert.match(inspector, /Settlement prosperity/);
assert.match(inspector, /Promotion load/);
assert.match(inspector, /Immediate daily demand/);
assert.match(inspector, /Warning: promoting the current occupants immediately exceeds/);
assert.match(
  inspector,
  /plan\.ready \? '' : 'disabled'/,
  'throughput must warn without replacing the authoritative route and resource gate',
);

const townHall = readFileSync('src/resources/inspector/townHallRenderer.ts', 'utf8');
assert.match(townHall, /Prosperity throughput/);
assert.match(townHall, /Prosperous housing pipeline/);
assert.match(townHall, /assumes staffed workshops remain fully supplied/);

const resourceInspector = readFileSync('src/resources/ResourceInspector.ts', 'utf8');
assert.match(
  resourceInspector,
  /target\.kind === 'residence' && target\.residence\.tier === 2/,
  'the heavier production scan should run only for inspectors that use it',
);
assert.match(resourceInspector, /computeSettlementProductionCapacity/);

console.log(
  `settlement prosperity tests passed (${elapsedMs.toFixed(1)} ms for 100,000 projections)`,
);

function approx(actual: number, expected: number): void {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `expected ${actual} to be approximately ${expected}`,
  );
}
