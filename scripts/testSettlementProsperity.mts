import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  CALENDAR_SECONDS_PER_DAY,
  RESIDENCE_ALE_PER_PERSON_PER_SEC,
  RESIDENCE_CLOTH_PER_PERSON_PER_SEC,
  RESIDENCE_SHOES_PER_PERSON_PER_SEC,
  RESIDENCE_PRESERVED_FOOD_PER_PERSON_PER_SEC,
  RESIDENCE_PRESERVED_FOOD_WINTER_MULTIPLIER,
  RESIDENCE_POTTERY_PER_PERSON_PER_SEC,
} from '../src/generated/gameBalance.ts';
import {
  computeSettlementProsperityPlan,
  projectTierFourUpgrade,
} from '../src/economy/settlementProsperity.ts';

const calendarDaySeconds = CALENDAR_SECONDS_PER_DAY;
const preservedPerResident =
  RESIDENCE_PRESERVED_FOOD_PER_PERSON_PER_SEC
  * calendarDaySeconds
  * RESIDENCE_PRESERVED_FOOD_WINTER_MULTIPLIER;
const alePerResident = RESIDENCE_ALE_PER_PERSON_PER_SEC * calendarDaySeconds;
const clothPerResident = RESIDENCE_CLOTH_PER_PERSON_PER_SEC * calendarDaySeconds;
const shoesPerResident = RESIDENCE_SHOES_PER_PERSON_PER_SEC * calendarDaySeconds;
const potteryPerResident = RESIDENCE_POTTERY_PER_PERSON_PER_SEC * calendarDaySeconds;

const production = {
  tierTwoPlusResidents: 50,
  tierThreePlusResidents: 50,
  tierFourResidents: 50,
  preservedFoodOutputPerDay: preservedPerResident * 80,
  preservedFoodDemandPerDay: preservedPerResident * 50,
  aleOutputPerDay: alePerResident * 120,
  aleDemandPerDay: alePerResident * 50,
  clothOutputPerDay: clothPerResident * 200,
  clothDemandPerDay: clothPerResident * 50,
  shoesOutputPerDay: shoesPerResident * 100,
  shoesDemandPerDay: shoesPerResident * 50,
  potteryOutputPerDay: potteryPerResident * 160,
  potteryDemandPerDay: potteryPerResident * 50,
};
const growth = {
  additionalPreservedFoodPerDay: preservedPerResident * 20,
  additionalAlePerDay: alePerResident * 20,
  additionalClothPerDay: clothPerResident * 20,
  additionalShoesPerDay: shoesPerResident * 20,
  additionalPotteryPerDay: potteryPerResident * 20,
};
const plan = computeSettlementProsperityPlan(production, growth);
assert.equal(plan.roadPlan, null);
assert.equal(plan.currentResidents, 50);
assert.equal(plan.existingTierFourVacancies, 20);
assert.equal(plan.existingFullResidents, 70);
assert.equal(plan.installedResidentCapacity, 80);
assert.equal(plan.currentHeadroomResidents, 30);
assert.equal(plan.fullHousingHeadroomResidents, 10);
assert.equal(plan.currentSustainable, true);
assert.equal(plan.fullExistingHousingSustainable, true);
assert.equal(plan.limitingKind, 'savoryPreserves');
assert.equal(plan.limitingLabel, 'savory preserves');
approx(
  plan.chains.find((chain) => chain.kind === 'ale')?.supportedResidents ?? -1,
  120,
);

const promotion = projectTierFourUpgrade(
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
approx(promotion.immediateDemand.savoryPreserves, preservedPerResident * 6);
approx(promotion.immediateDemand.ale, alePerResident * 6);
approx(promotion.immediateDemand.cloth, clothPerResident * 6);
approx(promotion.immediateDemand.shoes, shoesPerResident * 6);
approx(promotion.immediateDemand.pottery, potteryPerResident * 6);
approx(promotion.fullHouseDemand.savoryPreserves, preservedPerResident * 10);

const immediateShortfall = computeSettlementProsperityPlan({
  ...production,
  preservedFoodOutputPerDay: preservedPerResident * 55,
});
const riskyPromotion = projectTierFourUpgrade(
  immediateShortfall,
  { population: 6, abandoned: false },
  10,
);
assert.equal(riskyPromotion.immediateSustainable, false);
assert.equal(riskyPromotion.immediateHeadroomResidents, -1);

const noIndustry = computeSettlementProsperityPlan({
  tierTwoPlusResidents: 0,
  tierThreePlusResidents: 0,
  tierFourResidents: 0,
  preservedFoodOutputPerDay: Number.NaN,
  preservedFoodDemandPerDay: 0,
  aleOutputPerDay: 0,
  aleDemandPerDay: 0,
  clothOutputPerDay: 0,
  clothDemandPerDay: 0,
  shoesOutputPerDay: 0,
  shoesDemandPerDay: 0,
  potteryOutputPerDay: 0,
  potteryDemandPerDay: 0,
});
assert.equal(noIndustry.installedResidentCapacity, 0);
assert.equal(noIndustry.currentSustainable, true);

const roadProduction = {
  tierTwoPlusResidents: 10,
  tierThreePlusResidents: 10,
  tierFourResidents: 10,
  preservedFoodOutputPerDay: preservedPerResident * 100,
  preservedFoodDemandPerDay: preservedPerResident * 10,
  aleOutputPerDay: alePerResident * 100,
  aleDemandPerDay: alePerResident * 10,
  clothOutputPerDay: clothPerResident * 100,
  clothDemandPerDay: clothPerResident * 10,
  shoesOutputPerDay: shoesPerResident * 100,
  shoesDemandPerDay: shoesPerResident * 10,
  potteryOutputPerDay: potteryPerResident * 100,
  potteryDemandPerDay: potteryPerResident * 10,
};
const splitSpecialties = computeSettlementProsperityPlan({
  ...roadProduction,
  prosperityRoadBranches: new Map([
    ['preserved', {
      currentResidents: 10,
      fullResidents: 20,
      preservedFoodOutputPerDay: preservedPerResident * 100,
      aleOutputPerDay: 0,
      clothOutputPerDay: 0,
      shoesOutputPerDay: 0,
      potteryOutputPerDay: 0,
      firstResidenceId: 'split-home',
    }],
    ['ale', {
      currentResidents: 0,
      fullResidents: 0,
      preservedFoodOutputPerDay: 0,
      aleOutputPerDay: alePerResident * 100,
      clothOutputPerDay: 0,
      shoesOutputPerDay: 0,
      potteryOutputPerDay: 0,
      firstResidenceId: null,
    }],
    ['cloth', {
      currentResidents: 0,
      fullResidents: 0,
      preservedFoodOutputPerDay: 0,
      aleOutputPerDay: 0,
      clothOutputPerDay: clothPerResident * 100,
      shoesOutputPerDay: 0,
      potteryOutputPerDay: 0,
      firstResidenceId: null,
    }],
    ['pottery', {
      currentResidents: 0,
      fullResidents: 0,
      preservedFoodOutputPerDay: 0,
      aleOutputPerDay: 0,
      clothOutputPerDay: 0,
      shoesOutputPerDay: 0,
      potteryOutputPerDay: potteryPerResident * 100,
      firstResidenceId: null,
    }],
    ['shoes', {
      currentResidents: 0,
      fullResidents: 0,
      preservedFoodOutputPerDay: 0,
      aleOutputPerDay: 0,
      clothOutputPerDay: 0,
      shoesOutputPerDay: shoesPerResident * 100,
      potteryOutputPerDay: 0,
      firstResidenceId: null,
    }],
  ]),
});
assert.equal(splitSpecialties.installedResidentCapacity, 100);
assert.equal(splitSpecialties.roadPlan?.activeBranches, 5);
assert.equal(splitSpecialties.roadPlan?.matchedBranches, 0);
assert.equal(splitSpecialties.roadPlan?.roadMatchedResidentCapacity, 0);
assert.equal(splitSpecialties.roadPlan?.fragmentationResidentCapacity, 100);
assert.equal(splitSpecialties.roadPlan?.currentShortBranches, 1);
assert.equal(splitSpecialties.roadPlan?.currentShortfallResidents, 10);
assert.equal(splitSpecialties.roadPlan?.fullShortfallResidents, 20);
assert.equal(splitSpecialties.roadPlan?.firstExposedResidenceId, 'split-home');
assert.equal(splitSpecialties.currentSustainable, false);
assert.equal(splitSpecialties.currentHeadroomResidents, -10);

const joinedSpecialties = computeSettlementProsperityPlan({
  ...roadProduction,
  prosperityRoadBranches: new Map([
    ['joined', {
      currentResidents: 10,
      fullResidents: 20,
      preservedFoodOutputPerDay: preservedPerResident * 100,
      aleOutputPerDay: alePerResident * 100,
      clothOutputPerDay: clothPerResident * 100,
      shoesOutputPerDay: shoesPerResident * 100,
      potteryOutputPerDay: potteryPerResident * 100,
      firstResidenceId: 'joined-home',
    }],
  ]),
});
assert.equal(joinedSpecialties.roadPlan?.activeBranches, 1);
assert.equal(joinedSpecialties.roadPlan?.matchedBranches, 1);
assert.equal(joinedSpecialties.roadPlan?.roadMatchedResidentCapacity, 100);
assert.equal(joinedSpecialties.roadPlan?.fragmentationResidentCapacity, 0);
assert.equal(joinedSpecialties.roadPlan?.currentShortfallResidents, 0);
assert.equal(joinedSpecialties.roadPlan?.fullShortfallResidents, 0);
assert.equal(joinedSpecialties.currentSustainable, true);

const balancedSatelliteProduction = {
  ...roadProduction,
  tierTwoPlusResidents: 20,
  tierThreePlusResidents: 20,
  tierFourResidents: 20,
  preservedFoodDemandPerDay: preservedPerResident * 20,
  aleDemandPerDay: alePerResident * 20,
  clothDemandPerDay: clothPerResident * 20,
  shoesDemandPerDay: shoesPerResident * 20,
  potteryDemandPerDay: potteryPerResident * 20,
  prosperityRoadBranches: new Map([
    ['west', {
      currentResidents: 10,
      fullResidents: 20,
      preservedFoodOutputPerDay: preservedPerResident * 50,
      aleOutputPerDay: alePerResident * 50,
      clothOutputPerDay: clothPerResident * 50,
      shoesOutputPerDay: shoesPerResident * 50,
      potteryOutputPerDay: potteryPerResident * 50,
      firstResidenceId: 'west-home',
    }],
    ['east', {
      currentResidents: 10,
      fullResidents: 20,
      preservedFoodOutputPerDay: preservedPerResident * 50,
      aleOutputPerDay: alePerResident * 50,
      clothOutputPerDay: clothPerResident * 50,
      shoesOutputPerDay: shoesPerResident * 50,
      potteryOutputPerDay: potteryPerResident * 50,
      firstResidenceId: 'east-home',
    }],
  ]),
};
const balancedSatellites = computeSettlementProsperityPlan(
  balancedSatelliteProduction,
);
assert.equal(balancedSatellites.roadPlan?.matchedBranches, 2);
assert.equal(balancedSatellites.roadPlan?.roadMatchedResidentCapacity, 100);
assert.equal(balancedSatellites.roadPlan?.fragmentationResidentCapacity, 0);
assert.equal(balancedSatellites.currentSustainable, true);

const localPromotionPlan = computeSettlementProsperityPlan({
  ...roadProduction,
  prosperityRoadBranches: new Map([
    ['tight', {
      currentResidents: 0,
      fullResidents: 0,
      preservedFoodOutputPerDay: preservedPerResident * 5,
      aleOutputPerDay: alePerResident * 5,
      clothOutputPerDay: clothPerResident * 5,
      shoesOutputPerDay: shoesPerResident * 5,
      potteryOutputPerDay: potteryPerResident * 5,
      firstResidenceId: null,
    }],
    ['remote', {
      currentResidents: 10,
      fullResidents: 10,
      preservedFoodOutputPerDay: preservedPerResident * 95,
      aleOutputPerDay: alePerResident * 95,
      clothOutputPerDay: clothPerResident * 95,
      shoesOutputPerDay: shoesPerResident * 95,
      potteryOutputPerDay: potteryPerResident * 95,
      firstResidenceId: 'remote-home',
    }],
  ]),
});
const localPromotion = projectTierFourUpgrade(
  localPromotionPlan,
  { population: 6, abandoned: false },
  10,
  'tight',
);
assert.equal(localPromotion.roadBranchScoped, true);
assert.equal(localPromotion.immediateResidents, 6);
assert.equal(localPromotion.immediateSustainable, false);
assert.equal(localPromotion.immediateHeadroomResidents, -1);
assert.equal(localPromotion.fullPipelineSustainable, false);
assert.equal(localPromotion.limitingLabel, 'preserved food');
assert.equal(
  projectTierFourUpgrade(
    localPromotionPlan,
    { population: 6, abandoned: false },
    10,
  ).immediateSustainable,
  true,
  'the legacy aggregate projection demonstrates the disconnected false positive',
);
const roadlessPromotion = projectTierFourUpgrade(
  localPromotionPlan,
  { population: 1, abandoned: false },
  10,
  'unroaded:residence:new-home',
);
assert.equal(roadlessPromotion.immediateHeadroomResidents, -1);
assert.equal(roadlessPromotion.immediateSustainable, false);

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

const largeRoadBranches = new Map();
for (let index = 0; index < 100_000; index += 1) {
  largeRoadBranches.set(`branch-${index}`, {
    currentResidents: 1,
    fullResidents: 1,
    preservedFoodOutputPerDay: preservedPerResident,
    aleOutputPerDay: alePerResident,
    clothOutputPerDay: clothPerResident,
    shoesOutputPerDay: shoesPerResident,
    potteryOutputPerDay: potteryPerResident,
    firstResidenceId: `home-${index}`,
  });
}
const roadStarted = performance.now();
const largeRoadPlan = computeSettlementProsperityPlan({
  tierTwoPlusResidents: 100_000,
  tierThreePlusResidents: 100_000,
  tierFourResidents: 100_000,
  preservedFoodOutputPerDay: preservedPerResident * 100_000,
  preservedFoodDemandPerDay: preservedPerResident * 100_000,
  aleOutputPerDay: alePerResident * 100_000,
  aleDemandPerDay: alePerResident * 100_000,
  clothOutputPerDay: clothPerResident * 100_000,
  clothDemandPerDay: clothPerResident * 100_000,
  shoesOutputPerDay: shoesPerResident * 100_000,
  shoesDemandPerDay: shoesPerResident * 100_000,
  potteryOutputPerDay: potteryPerResident * 100_000,
  potteryDemandPerDay: potteryPerResident * 100_000,
  prosperityRoadBranches: largeRoadBranches,
});
const roadElapsedMs = performance.now() - roadStarted;
assert.equal(largeRoadPlan.roadPlan?.activeBranches, 100_000);
assert.equal(largeRoadPlan.roadPlan?.matchedBranches, 100_000);
assert.equal(largeRoadPlan.roadPlan?.roadMatchedResidentCapacity, 100_000);
assert.equal(largeRoadPlan.roadPlan?.currentShortfallResidents, 0);
assert.ok(
  roadElapsedMs < 500,
  `100,000 prosperity road branches regressed (${roadElapsedMs.toFixed(1)} ms)`,
);

const inspector = readFileSync('src/resources/inspector/residenceRenderer.ts', 'utf8');
assert.match(inspector, /Settlement prosperity/);
assert.match(inspector, /Promotion load/);
assert.match(inspector, /Local prosperity branch/);
assert.doesNotMatch(inspector, /this road branch/);
assert.match(inspector, /Prosperity planning load/);
assert.match(inspector, /winter-peak preserved ration/);
assert.doesNotMatch(inspector, /Warning: promoting the current occupants immediately exceeds/);
assert.match(
  inspector,
  /const production = prosperity && projection[\s\S]{0,180}\$\{projection\.limitingLabel\} · \$\{projection\.immediateSustainable \? 'ready' : 'short'\}/,
  'prosperity readiness should be reduced to compact upgrade tooltip metadata',
);
assert.match(
  inspector,
  /data-tooltip-title="Tier \$\{plan\.nextTier\}" data-tooltip="\$\{detail\}" \$\{plan\.ready \? '' : 'aria-disabled="true"'\}[\s\S]{0,240}<span>Upgrade · Tier \$\{plan\.nextTier\}<\/span>/,
  'the compact Upgrade control must retain tooltip context and the authoritative route/resource gate',
);

const townHall = readFileSync('src/resources/inspector/townHallRenderer.ts', 'utf8');
assert.match(townHall, /Prosperity throughput/);
assert.match(townHall, /Prosperity roads/);
assert.match(townHall, /resident capacity stranded between specialized branches/);
assert.match(townHall, /Inspect first prosperity road-branch shortfall/);
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
  `settlement prosperity tests passed (${elapsedMs.toFixed(1)} ms for 100,000 projections; ${roadElapsedMs.toFixed(1)} ms for 100,000 road branches)`,
);

function approx(actual: number, expected: number): void {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `expected ${actual} to be approximately ${expected}`,
  );
}
