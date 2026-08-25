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
  RESIDENCE_PRESERVED_FOOD_PER_PERSON_PER_SEC,
  RESIDENCE_PRESERVED_FOOD_WINTER_MULTIPLIER,
  RESIDENCE_POTTERY_PER_PERSON_PER_SEC,
  RESIDENCE_SETTLE_TICKS,
  RESIDENCE_WATER_PER_PERSON_PER_SEC,
  SIM_TICK_SECONDS,
  WINTER_FIREWOOD_DEMAND_MULTIPLIER,
} from '../src/generated/gameBalance.ts';
import { computeSettlementGrowthPlan } from '../src/economy/settlementGrowth.ts';
import { householdFoodPerDay } from '../src/economy/foodInventory.ts';
import {
  residenceSettlementBufferMin,
  type ResidenceSettlementVitalNeedKind,
} from '../src/economy/residenceSettlement.ts';
import {
  createDefaultNeeds,
  DEFAULT_RESIDENCE_COMMUNITY_CONTEXT,
} from '../src/residences/residenceNeedState.ts';
import type { ResidenceState } from '../src/resources/types.ts';
import type { FireIncidentState } from '../src/fires/fireIncident.ts';

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
  computeSettlementGrowthPlan({ state: stateWith(hungry) }).waitingOnHomes.firewood,
  1,
  'a basic cottage must not grow while its hearth is empty',
);
stockToThreshold(hungry, 'firewood');
assert.equal(
  computeSettlementGrowthPlan({ state: stateWith(hungry) }).waitingOnHomes.water,
  1,
  'a basic cottage must not grow while its water buffer is empty',
);
stockToThreshold(hungry, 'water');
assert.equal(
  computeSettlementGrowthPlan({ state: stateWith(hungry) }).progressingHomes,
  1,
);

const tierTwo = residence('tier-two', 2, 3, 6);
stockToThreshold(tierTwo, 'food');
stockToThreshold(tierTwo, 'firewood');
tierTwo.needs.water.stock = residenceSettlementBufferMin(
  'water',
  tierTwo.tier,
) - 0.1;
const tierTwoPlan = computeSettlementGrowthPlan({ state: stateWith(tierTwo) });
assert.equal(tierTwoPlan.pausedHomes, 1);
assert.equal(tierTwoPlan.waitingOnHomes.water, 1);
assert.equal(tierTwoPlan.waitingOnHomes.food, 0);

const tierThree = residence('tier-four', 4, 11, 15);
for (const kind of ['food', 'firewood', 'water'] as const) {
  stockToThreshold(tierThree, kind);
}
const tierThreePlan = computeSettlementGrowthPlan({ state: stateWith(tierThree) });
assert.equal(tierThreePlan.progressingHomes, 1);
const workdaySeconds = CALENDAR_SECONDS_PER_DAY
  * (CALENDAR_WORK_END_HOUR - CALENDAR_WORK_START_HOUR)
  / CALENDAR_HOURS_PER_DAY;
assertNear(
  tierThreePlan.additionalGrossFoodPerDay,
  householdFoodPerDay(4),
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
  4
    * RESIDENCE_PRESERVED_FOOD_PER_PERSON_PER_SEC
    * workdaySeconds
    * RESIDENCE_PRESERVED_FOOD_WINTER_MULTIPLIER,
);
assertNear(
  tierThreePlan.additionalFoodPerDay,
  Math.max(
    0,
    tierThreePlan.additionalGrossFoodPerDay
      - tierThreePlan.additionalPreservedFoodPerDay,
  ),
);
assertNear(
  tierThreePlan.additionalAlePerDay,
  4 * RESIDENCE_ALE_PER_PERSON_PER_SEC * workdaySeconds,
);
assertNear(
  tierThreePlan.additionalClothPerDay,
  4 * RESIDENCE_CLOTH_PER_PERSON_PER_SEC * workdaySeconds,
);
assertNear(
  tierThreePlan.additionalPotteryPerDay,
  4 * RESIDENCE_POTTERY_PER_PERSON_PER_SEC * workdaySeconds,
);

const mixedState = stateWith(
  residence('full', 1, 3, 3),
  residence('legacy-abandoned-flag', 2, 0, 6, 0, true),
  hungry,
  tierThree,
);
const mixedPlan = computeSettlementGrowthPlan({ state: mixedState });
assert.equal(mixedPlan.fullHomes, 1);
assert.equal(mixedPlan.candidateHomes, 3);

const fireDisabledGrowthHome = residence('fire-growth-home', 4, 11, 15);
for (const kind of ['food', 'firewood', 'water'] as const) {
  stockToThreshold(fireDisabledGrowthHome, kind);
}
const fireDisabledGrowthPlan = computeSettlementGrowthPlan({
  state: {
    residences: new Map([[fireDisabledGrowthHome.id, fireDisabledGrowthHome]]),
    fireIncidents: new Map([['growth-fire', {
      id: 'growth-fire',
      targetKind: 'residence',
      targetId: fireDisabledGrowthHome.id,
    } as FireIncidentState]]),
  },
});
assert.equal(fireDisabledGrowthPlan.vacantSlots, 0);
assert.equal(fireDisabledGrowthPlan.candidateHomes, 0);
assert.equal(fireDisabledGrowthPlan.progressingHomes, 0);
assert.equal(fireDisabledGrowthPlan.nextArrivalSeconds, null);
assert.equal(fireDisabledGrowthPlan.fireDisabledHomes, 1);
assert.equal(fireDisabledGrowthPlan.fireDisabledResidents, 11);
assert.equal(fireDisabledGrowthPlan.fireDisabledHousingCapacity, 15);
assert.equal(fireDisabledGrowthPlan.fireDisabledVacantSlots, 4);
assert.equal(fireDisabledGrowthPlan.additionalGrossFoodPerDay, 0);
assert.equal(fireDisabledGrowthPlan.additionalFoodPerDay, 0);
assert.equal(fireDisabledGrowthPlan.additionalPreservedFoodPerDay, 0);

const perfResidences = new Map<string, ResidenceState>();
const perfFires = new Map<string, FireIncidentState>();
for (let index = 0; index < 100_000; index += 1) {
  const home = residence(
    `perf-${index}`,
    index % 3 === 0 ? 3 : index % 3 === 1 ? 2 : 1,
    1,
    index % 3 === 0 ? 10 : index % 3 === 1 ? 6 : 3,
  );
  if (index % 2 === 0) {
    for (const kind of ['food', 'firewood', 'water'] as const) {
      stockToThreshold(home, kind);
    }
  }
  perfResidences.set(home.id, home);
  if (index % 4 === 0) {
    perfFires.set(`perf-fire-${index}`, {
      id: `perf-fire-${index}`,
      targetKind: 'residence',
      targetId: home.id,
    } as FireIncidentState);
  }
}
const started = performance.now();
const perfPlan = computeSettlementGrowthPlan({
  state: {
    residences: perfResidences,
    fireIncidents: perfFires,
  },
  communityForResidence: () => DEFAULT_RESIDENCE_COMMUNITY_CONTEXT,
});
const elapsedMs = performance.now() - started;
assert.equal(perfPlan.candidateHomes, 75_000);
assert.equal(perfPlan.progressingHomes, 25_000);
assert.equal(perfPlan.fireDisabledHomes, 25_000);
assert.ok(elapsedMs < 350, `100,000-home fire-aware growth forecast took ${elapsedMs.toFixed(1)} ms`);

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
assert.match(townHallInspector, /Reusable housing/);
assert.match(townHallInspector, /homes never decay from vacancy/);
assert.match(townHallInspector, /fire-disabled homes/);
assert.match(townHallInspector, /Prosperous-house growth/);
assert.match(townHallInspector, /winter fresh food\/day after cured-ration displacement/);
assert.match(townHallInspector, /gross meal demand/);
assert.match(townHallInspector, /data-inspect-residence/);
assert.match(townHallInspector, /const growthChapels = Array\.from/);
assert.doesNotMatch(
  townHallInspector,
  /communityForResidence:[\s\S]{0,500}getServingChapelForResidence/,
);
assert.match(resourceInspector, /closest<HTMLElement>\('\[data-inspect-residence\]'\)/);
assert.match(resourceInspector, /findResidenceTarget\(inspectResidenceId\)/);
assert.match(worldQueries, /findResidenceTarget\(residenceId: string\)/);
assert.match(
  settlementHud,
  /Authoritative arrivals,[\s\S]*departures,[\s\S]*welfare remain household-driven/,
);

console.log(`settlement growth forecast tests passed (${elapsedMs.toFixed(1)} ms for 100,000 homes / 25,000 fire outages)`);

function stateWith(...residences: ResidenceState[]): { residences: Map<string, ResidenceState> } {
  return { residences: new Map(residences.map((home) => [home.id, home])) };
}

function residence(
  id: string,
  tier: 1 | 2 | 3 | 4,
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

function stockToThreshold(
  target: ResidenceState,
  kind: ResidenceSettlementVitalNeedKind,
): void {
  target.needs[kind].stock = residenceSettlementBufferMin(
    kind,
    target.tier,
  );
}

function assertNear(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
}
