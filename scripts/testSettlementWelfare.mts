import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  CALENDAR_SECONDS_PER_DAY,
  HERB_TREATMENT_PER_SICK_DAY,
  MALNUTRITION_DAYS,
  RESIDENCE_UPGRADE_SERVICE_BLOCK_DAYS,
  SIM_TICK_SECONDS,
  STARVATION_DEATH_START_DAYS,
} from '../src/generated/gameBalance.ts';
import {
  computeSettlementWelfare,
} from '../src/economy/settlementWelfare.ts';
import {
  computeSettlementProvisioning,
} from '../src/economy/settlementProvisioning.ts';
import { computeResourceTotals } from '../src/resources/resourceTotals.ts';
import {
  createEmptyStockpile,
  type BuildingState,
  type CorpseState,
  type GameState,
  type ResidenceState,
} from '../src/resources/types.ts';

const provisioningSource = readFileSync(
  new URL('../src/economy/settlementProvisioning.ts', import.meta.url),
  'utf8',
);
const appSource = readFileSync(
  new URL('../src/app/App.ts', import.meta.url),
  'utf8',
);
const hudSource = readFileSync(
  new URL('../src/ui/SettlementHud.ts', import.meta.url),
  'utf8',
);
const hudCss = readFileSync(
  new URL('../src/ui/settlementHud.css', import.meta.url),
  'utf8',
);
const polishedHudCss = readFileSync(
  new URL('../src/ui/polishedGameUi.css', import.meta.url),
  'utf8',
);
const townHallSource = readFileSync(
  new URL('../src/resources/inspector/townHallRenderer.ts', import.meta.url),
  'utf8',
);

assert.match(
  provisioningSource,
  /for \(const residence of state\.residences\.values\(\)\) \{[\s\S]*?accumulateResidenceWelfare/,
  'welfare aggregation should share the existing settlement provisioning residence scan',
);
assert.match(provisioningSource, /finalizeSettlementWelfare/);
assert.ok(
  !appSource.includes('computeSettlementWelfare'),
  'the snapshot path must not add a second app-level residence scan for welfare',
);
assert.match(hudSource, /data-welfare-alert/);
assert.match(hudSource, /Burial response blocked/);
assert.match(
  hudSource,
  /data-welfare-alert[\s\S]{0,100}data-tooltip-placement="above"/,
  'the welfare tooltip should open above its alert instead of covering the clock',
);
assert.match(hudSource, /Some homes need attention/);
assert.match(hudSource, /Inspect affected homes for unmet needs\./);
assert.doesNotMatch(hudSource, /Open the Town Hall ledger/);
assert.doesNotMatch(hudSource, /residents cannot work while ill/);
assert.doesNotMatch(hudSource, /remedies in homes/);
assert.match(hudCss, /settlement-hud__welfare-alert\[data-level='critical'\]/);
assert.match(
  polishedHudCss,
  /--settlement-vitals-width:\s*min\(240px,\s*calc\(100vw - 28px\)\)/,
);
assert.match(
  polishedHudCss,
  /\.settlement-vitals\s*\{[\s\S]*?width:\s*var\(--settlement-vitals-width\)/,
);
assert.match(
  polishedHudCss,
  /\.settlement-vitals__alerts\s*\{[\s\S]*?width:\s*var\(--settlement-vitals-width\)/,
);
for (const label of [
  'Household health',
  'Illness and remedies',
  'Mortality and burial',
  'Reusable housing',
  'Inspect highest-risk household',
]) {
  assert.ok(townHallSource.includes(label), `Town Hall welfare ledger is missing ${label}`);
}

const state = emptyGameState();
state.tick = ticksForDays(30);
const starving = residence('20', 4);
starving.hungerTicks = ticksForDays(STARVATION_DEATH_START_DAYS);
starving.deathsTotal = 2;
state.residences.set(starving.id, starving);

const malnourished = residence('3', 3);
malnourished.hungerTicks = ticksForDays(MALNUTRITION_DAYS + 1);
malnourished.malnutrition = 0.35;
malnourished.sickPopulation = 1;
malnourished.remedyStock = 0;
malnourished.needs.food.deficitTicks = ticksForDays(
  RESIDENCE_UPGRADE_SERVICE_BLOCK_DAYS,
);
malnourished.deathsTotal = 1;
state.residences.set(malnourished.id, malnourished);

const hungry = residence('1', 2);
hungry.hungerTicks = ticksForDays(3);
state.residences.set(hungry.id, hungry);

const treatedSick = residence('4', 4);
treatedSick.sickPopulation = 2;
treatedSick.remedyStock = 3;
state.residences.set(treatedSick.id, treatedSick);
state.residences.set('5', residence('5', 5));

for (const id of ['30', '31', '32', '33']) {
  const emptyHome = residence(id, 0);
  // Legacy save flags must not change the reusable-housing count.
  emptyHome.abandoned = true;
  emptyHome.condition = Number(id) - 30;
  state.residences.set(emptyHome.id, emptyHome);
}

state.buildings.set('chapel', building('chapel', 'chapel', 2));
state.graveyards = new Map([
  ['graveyard', {
    id: 'graveyard',
    chapelId: 'chapel',
    corners: [
      { x: 0, z: 0 },
      { x: 1, z: 0 },
      { x: 1, z: 1 },
      { x: 0, z: 1 },
    ],
    area: 100,
    averageSlopeDegrees: 2,
    capacity: 5,
    burials: 2,
  }],
]);
state.corpses = new Map([
  ['waiting', corpse('waiting', starving.id, 0, null, state.tick - ticksForDays(2))],
  ['outbound', corpse('outbound', hungry.id, 1, 'graveyard', state.tick - ticksForDays(0.5))],
  ['loaded', corpse('loaded', malnourished.id, 2, 'graveyard', state.tick - ticksForDays(0.25))],
]);

const welfare = computeSettlementWelfare(state);
assert.equal(welfare.level, 'critical');
assert.equal(welfare.activeHouseholds, 5);
assert.equal(welfare.activeResidents, 18);
assert.equal(welfare.stableHouseholds, 1);
assert.equal(welfare.stableResidents, 5);
assert.equal(welfare.hungryHouseholds, 1);
assert.equal(welfare.hungryResidents, 2);
assert.equal(welfare.malnourishedHouseholds, 1);
assert.equal(welfare.malnourishedResidents, 3);
assert.equal(welfare.starvingHouseholds, 1);
assert.equal(welfare.starvingResidents, 4);
assert.ok(Math.abs(welfare.longestHungerDays - STARVATION_DEATH_START_DAYS) < 1e-9);
assert.equal(welfare.sickHouseholds, 2);
assert.equal(welfare.sickResidents, 3);
assert.equal(welfare.untreatedSickHouseholds, 1);
assert.equal(welfare.remedyStock, 3);
assert.equal(welfare.remedyDemandPerDay, 3 * HERB_TREATMENT_PER_SICK_DAY);
assert.ok(Math.abs(welfare.remedyRunwayDays - 3 / (3 * HERB_TREATMENT_PER_SICK_DAY)) < 1e-9);
assert.equal(welfare.serviceWarningHouseholds, 1);
assert.equal(welfare.upgradeBlockedHouseholds, 1);
assert.ok(
  Math.abs(welfare.longestServiceDeficitDays - RESIDENCE_UPGRADE_SERVICE_BLOCK_DAYS)
    < 1e-9,
);
assert.equal(welfare.totalDeaths, 3);
assert.equal(welfare.waitingBodies, 1);
assert.equal(welfare.outboundEmptyCarts, 1);
assert.equal(welfare.loadedBurialCarts, 1);
assert.equal(welfare.uncollectedBodiesAtHomes, 2);
assert.ok(Math.abs(welfare.oldestUncollectedBodyDays - 2) < 1e-9);
assert.equal(welfare.burialGrounds, 1);
assert.equal(welfare.graveCapacity, 5);
assert.equal(welfare.occupiedGraves, 2);
assert.equal(welfare.reservedGraves, 2);
assert.equal(welfare.openGraves, 1);
assert.equal(welfare.staffedGravediggers, 2);
assert.equal(welfare.vacantHomes, 4);
assert.equal(welfare.firstAttentionResidenceId, starving.id);

const integrated = computeSettlementProvisioning({
  state,
  totals: computeResourceTotals(state),
  currentFirewoodDemandMultiplier: 1,
  freshFoodSpoilageFractionPerDay: 0,
  sabbathObserved: false,
});
assert.deepEqual(integrated.welfare, welfare);

const stableState = emptyGameState();
stableState.residences.set('stable', residence('stable', 4));
assert.equal(computeSettlementWelfare(stableState).level, 'stable');
const emptyState = emptyGameState();
assert.equal(computeSettlementWelfare(emptyState).level, 'none');

const tieState = emptyGameState();
for (const id of ['10', '2']) {
  const home = residence(id, 2);
  home.sickPopulation = 1;
  tieState.residences.set(id, home);
}
assert.equal(
  computeSettlementWelfare(tieState).firstAttentionResidenceId,
  '2',
  'equal welfare risks should use stable server-id ordering',
);

const performanceState = emptyGameState();
for (let index = 0; index < 100_000; index += 1) {
  const home = residence(String(index + 1), 4);
  if (index % 20 === 0) home.sickPopulation = 1;
  if (index % 50 === 0) home.hungerTicks = ticksForDays(3);
  performanceState.residences.set(home.id, home);
}
const started = performance.now();
const performanceWelfare = computeSettlementWelfare(performanceState);
const elapsedMs = performance.now() - started;
assert.equal(performanceWelfare.activeResidents, 400_000);
assert.ok(
  elapsedMs < 400,
  `100,000-home settlement welfare aggregation took ${elapsedMs.toFixed(1)} ms`,
);

console.log(
  `Settlement welfare feedback verified (${elapsedMs.toFixed(1)} ms for 100,000 homes).`,
);

function ticksForDays(days: number): number {
  return Math.round(days * CALENDAR_SECONDS_PER_DAY / SIM_TICK_SECONDS);
}

function residence(id: string, population: number): ResidenceState {
  return {
    id,
    zoneId: `zone-${id}`,
    parcelIndex: 0,
    x: 0,
    z: 0,
    yaw: 0,
    population,
    populationCapacity: Math.max(4, population),
    tier: 1,
    settlementTicks: 0,
    needs: {
      firewood: { stock: 0, deficitTicks: 0 },
      water: { stock: 0, deficitTicks: 0 },
      food: { stock: 0, deficitTicks: 0 },
      preservedFood: { stock: 0, deficitTicks: 0 },
      ale: { stock: 0, deficitTicks: 0 },
      cloth: { stock: 0, deficitTicks: 0 },
      pottery: { stock: 0, deficitTicks: 0 },
    },
    abandoned: false,
    householdWealth: 0,
  };
}

function building(
  id: string,
  kind: BuildingState['kind'],
  assignedLabor: number,
): BuildingState {
  return {
    id,
    kind,
    x: 0,
    z: 0,
    workRadius: 0,
    actionCooldown: 0,
    timber: 0,
    firewood: 0,
    stone: 0,
    water: 0,
    food: 0,
    grain: 0,
    flour: 0,
    ale: 0,
    preservedFood: 0,
    honey: 0,
    wine: 0,
    gold: 0,
    waterCapacity: 0,
    assignedLabor,
    constructionComplete: true,
    constructionProgress: 1,
    constructionRequiredTimber: 0,
    constructionRequiredStone: 0,
    constructionDeliveredTimber: 0,
    constructionDeliveredStone: 0,
    constructionReservedTimber: 0,
    constructionReservedStone: 0,
    constructionTreasuryTimber: 0,
    constructionTreasuryStone: 0,
    storehouseAcceptsTimber: true,
    storehouseAcceptsStone: true,
    storehouseAcceptsFirewood: true,
  };
}

function corpse(
  id: string,
  residenceId: string,
  state: CorpseState['state'],
  graveyardId: string | null,
  createdTick: number,
): CorpseState {
  return {
    id,
    residenceId,
    cause: 1,
    state,
    x: 0,
    z: 0,
    cartX: 0,
    cartZ: 0,
    createdTick,
    chapelId: state === 0 ? null : 'chapel',
    graveyardId,
  };
}

function emptyGameState(): GameState {
  return {
    seed: 1,
    tick: 0,
    stockpile: createEmptyStockpile(),
    quarries: new Map(),
    foragingNodes: new Map(),
    trees: new Map(),
    buildings: new Map(),
    farmFields: new Map(),
    pastures: new Map(),
    graveyards: new Map(),
    corpses: new Map(),
    livestockHerds: new Map(),
    burgageZones: new Map(),
    residences: new Map(),
    backyardGardens: new Map(),
    deliveryTrips: new Map(),
    fireIncidents: new Map(),
    nextBuildingId: 1,
  };
}
