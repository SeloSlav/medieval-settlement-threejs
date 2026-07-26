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
  RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC,
  RESIDENCE_FOOD_PER_PERSON_PER_SEC,
  RESIDENCE_PRESERVED_FOOD_PER_PERSON_PER_SEC,
  RESIDENCE_SETTLE_TICKS,
  RESIDENCE_WATER_PER_PERSON_PER_SEC,
  SIM_TICK_SECONDS,
  WINTER_FIREWOOD_DEMAND_MULTIPLIER,
} from '../src/generated/gameBalance.ts';
import { recoveryStockMin } from '../src/economy/chapelCommunity.ts';
import { computeSettlementGrowthPlan } from '../src/economy/settlementGrowth.ts';
import {
  createDefaultNeeds,
  DEFAULT_RESIDENCE_COMMUNITY_CONTEXT,
  type ResidenceNeedKind,
} from '../src/residences/residenceNeedState.ts';
import type { ResidenceState } from '../src/resources/types.ts';

const vacantState = stateWith(residence('vacant', 1, 0, 3, 50));
const vacantPlan = computeSettlementGrowthPlan({ state: vacantState });
assert.equal(vacantPlan.vacantSlots, 3);
assert.equal(vacantPlan.candidateHomes, 1);
assert.equal(vacantPlan.progressingHomes, 1);
assert.equal(vacantPlan.firstArrivalHomes, 1);
assert.equal(vacantPlan.pausedHomes, 0);
assert.equal(
  vacantPlan.nextArrivalSeconds,
  (RESIDENCE_SETTLE_TICKS - 50) * SIM_TICK_SECONDS,
);

const hungry = residence('hungry', 1, 1, 3);
const hungryPlan = computeSettlementGrowthPlan({ state: stateWith(hungry) });
assert.equal(hungryPlan.progressingHomes, 0);
assert.equal(hungryPlan.pausedHomes, 1);
assert.equal(hungryPlan.waitingOnHomes.food, 1);
assert.equal(hungryPlan.firstPausedResidenceId, hungry.id);
stockToThreshold(hungry, 'food');
assert.equal(
  computeSettlementGrowthPlan({ state: stateWith(hungry) }).progressingHomes,
  1,
);

const tierTwo = residence('tier-two', 2, 3, 6);
stockToThreshold(tierTwo, 'food');
stockToThreshold(tierTwo, 'firewood');
tierTwo.needs.water.stock = recoveryStockMin('water', false, false) - 0.1;
const tierTwoPlan = computeSettlementGrowthPlan({ state: stateWith(tierTwo) });
assert.equal(tierTwoPlan.pausedHomes, 1);
assert.equal(tierTwoPlan.waitingOnHomes.water, 1);
assert.equal(tierTwoPlan.waitingOnHomes.food, 0);

const tierThree = residence('tier-three', 3, 6, 10);
for (const kind of ['food', 'firewood', 'water', 'preservedFood', 'ale', 'cloth'] as const) {
  stockToThreshold(tierThree, kind);
}
const tierThreePlan = computeSettlementGrowthPlan({ state: stateWith(tierThree) });
assert.equal(tierThreePlan.progressingHomes, 1);
const workdaySeconds = CALENDAR_SECONDS_PER_DAY
  * (CALENDAR_WORK_END_HOUR - CALENDAR_WORK_START_HOUR)
  / CALENDAR_HOURS_PER_DAY;
assertNear(
  tierThreePlan.additionalFoodPerDay,
  4 * RESIDENCE_FOOD_PER_PERSON_PER_SEC * workdaySeconds,
);
assertNear(
  tierThreePlan.additionalWaterPerDay,
  4 * RESIDENCE_WATER_PER_PERSON_PER_SEC * workdaySeconds,
);
assertNear(
  tierThreePlan.additionalWinterFirewoodPerDay,
  4
    * RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC
    * CALENDAR_SECONDS_PER_DAY
    * WINTER_FIREWOOD_DEMAND_MULTIPLIER,
);
assertNear(
  tierThreePlan.additionalPreservedFoodPerDay,
  4 * RESIDENCE_PRESERVED_FOOD_PER_PERSON_PER_SEC * workdaySeconds,
);
assertNear(
  tierThreePlan.additionalAlePerDay,
  4 * RESIDENCE_ALE_PER_PERSON_PER_SEC * workdaySeconds,
);
assertNear(
  tierThreePlan.additionalClothPerDay,
  4 * RESIDENCE_CLOTH_PER_PERSON_PER_SEC * workdaySeconds,
);

const mixedState = stateWith(
  residence('full', 1, 3, 3),
  residence('abandoned', 2, 0, 6, 0, true),
  hungry,
  tierThree,
);
const mixedPlan = computeSettlementGrowthPlan({ state: mixedState });
assert.equal(mixedPlan.fullHomes, 1);
assert.equal(mixedPlan.abandonedHomes, 1);
assert.equal(mixedPlan.candidateHomes, 2);

const perfResidences = new Map<string, ResidenceState>();
for (let index = 0; index < 10_000; index += 1) {
  const home = residence(
    `perf-${index}`,
    index % 3 === 0 ? 3 : index % 3 === 1 ? 2 : 1,
    1,
    index % 3 === 0 ? 10 : index % 3 === 1 ? 6 : 3,
  );
  if (index % 2 === 0) {
    for (const kind of ['food', 'firewood', 'water', 'preservedFood', 'ale', 'cloth'] as const) {
      stockToThreshold(home, kind);
    }
  }
  perfResidences.set(home.id, home);
}
const started = performance.now();
const perfPlan = computeSettlementGrowthPlan({
  state: { residences: perfResidences },
  communityForResidence: () => DEFAULT_RESIDENCE_COMMUNITY_CONTEXT,
});
const elapsedMs = performance.now() - started;
assert.equal(perfPlan.candidateHomes, 10_000);
assert.equal(perfPlan.progressingHomes, 5_000);
assert.ok(elapsedMs < 250, `10,000-home growth forecast took ${elapsedMs.toFixed(1)} ms`);

const townHallInspector = readFileSync(
  new URL('../src/resources/inspector/townHallRenderer.ts', import.meta.url),
  'utf8',
);
const resourceInspector = readFileSync(
  new URL('../src/resources/ResourceInspector.ts', import.meta.url),
  'utf8',
);
const worldQueries = readFileSync(
  new URL('../src/resources/WorldQueries.ts', import.meta.url),
  'utf8',
);
const settlementHud = readFileSync(
  new URL('../src/ui/SettlementHud.ts', import.meta.url),
  'utf8',
);
assert.match(townHallInspector, /Housing pipeline/);
assert.match(townHallInspector, /Growth bottlenecks/);
assert.match(townHallInspector, /At full housing/);
assert.match(townHallInspector, /Prosperous-house growth/);
assert.match(townHallInspector, /data-inspect-residence/);
assert.match(townHallInspector, /const growthChapels = Array\.from/);
assert.doesNotMatch(
  townHallInspector,
  /communityForResidence:[\s\S]{0,500}getServingChapelForResidence/,
);
assert.match(resourceInspector, /closest<HTMLElement>\('\[data-inspect-residence\]'\)/);
assert.match(resourceInspector, /findResidenceTarget\(inspectResidenceId\)/);
assert.match(worldQueries, /findResidenceTarget\(residenceId: string\)/);
assert.match(settlementHud, /later arrivals require every need active at that house tier/);

console.log(`settlement growth forecast tests passed (${elapsedMs.toFixed(1)} ms for 10,000 homes)`);

function stateWith(...residences: ResidenceState[]): { residences: Map<string, ResidenceState> } {
  return { residences: new Map(residences.map((home) => [home.id, home])) };
}

function residence(
  id: string,
  tier: 1 | 2 | 3,
  population: number,
  populationCapacity: number,
  settlementTicks = 0,
  abandoned = false,
): ResidenceState {
  return {
    id,
    zoneId: `zone-${id}`,
    parcelIndex: 0,
    x: 0,
    z: 0,
    yaw: 0,
    population,
    populationCapacity,
    tier,
    settlementTicks,
    needs: createDefaultNeeds(),
    abandoned,
    householdWealth: 0,
  };
}

function stockToThreshold(target: ResidenceState, kind: ResidenceNeedKind): void {
  target.needs[kind].stock = recoveryStockMin(kind, false, false);
}

function assertNear(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
}
