import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDefaultNeeds } from '../src/residences/residenceNeedState.ts';
import type {
  BuildingState,
  GameState,
  ResidenceState,
} from '../src/resources/types.ts';
import { createEmptyStockpile } from '../src/resources/types.ts';
import type { FireIncidentState } from '../src/fires/fireIncident.ts';
import {
  CALENDAR_DAY_START_OFFSET_SECONDS,
  CALENDAR_SECONDS_PER_DAY,
  SIM_TICK_SECONDS,
} from '../src/generated/gameBalance.ts';
import {
  deriveLordReportTransitions,
  fullStorageChannels,
  LordReportCollection,
  reportableStorageOccupancyChannels,
  storageOccupancyChannels,
  type LordReport,
} from '../src/ui/lordReports.ts';

const appBootstrap = readFileSync('src/app/appBootstrap.ts', 'utf8');
const appSource = readFileSync('src/app/App.ts', 'utf8');
assert.match(
  appBootstrap,
  /setLordReportTargetHandler[\s\S]*?focusWorldPositionAtZoom\([\s\S]*?REPORT_FOCUS_ZOOM_PERCENT[\s\S]*?setSecurityAttentionHandler/,
  'lord report targets must center at the shared 50% report zoom',
);
assert.match(
  appSource,
  /notifyLordReportChanges\(\s*state,\s*previous,\s*snapshot\.parishPolicy\.sabbathObservanceEnabled,?\s*\)[\s\S]*?deriveLordReportTransitions\(state,\s*previous,\s*\{\s*sabbathObservanceEnabled,?\s*\}\)/,
  'Sabbath reports must receive the authoritative parish policy',
);

const staffedChapel = building({
  id: 'sabbath-chapel',
  kind: 'chapel',
  assignedLabor: 1,
  constructionComplete: true,
});
const initialSunday = gameState(0, { buildings: [staffedChapel] });
const initialObservedSabbath = deriveLordReportTransitions(
  initialSunday,
  null,
  {
    sabbathObservanceEnabled: true,
  },
).filter((entry) => entry.kind === 'sabbath');
assert.equal(initialObservedSabbath.length, 1);
assert.equal(initialObservedSabbath[0]?.id, 'sabbath:1:0');
assert.match(
  initialObservedSabbath[0]?.title ?? '',
  /It is Sunday — the Sabbath is observed/,
);
assert.match(
  initialObservedSabbath[0]?.detail ?? '',
  /chapel|church/i,
  'the report should ground observance in the settlement\'s actual chapel readiness',
);
assert.match(
  initialObservedSabbath[0]?.detail ?? '',
  /labor|work|deliver/i,
  'the report should explain the in-game consequence of observance',
);
assert.match(
  initialObservedSabbath[0]?.detail ?? '',
  /households keep eating and service shortage clocks continue/i,
  'the report should explain that observed Sabbath does not freeze household needs',
);

assert.deepEqual(
  deriveLordReportTransitions(
    gameState(1, { buildings: [staffedChapel] }),
    initialSunday,
    { sabbathObservanceEnabled: true },
  ).filter((entry) => entry.kind === 'sabbath'),
  [],
  'an initial Sunday report must not repeat on every same-day snapshot',
);

const sundayDaySevenTick = (
  7 * CALENDAR_SECONDS_PER_DAY - CALENDAR_DAY_START_OFFSET_SECONDS
) / SIM_TICK_SECONDS;
const sundayEntryReports = deriveLordReportTransitions(
  gameState(sundayDaySevenTick, { buildings: [staffedChapel] }),
  gameState(sundayDaySevenTick - 1, { buildings: [staffedChapel] }),
  { sabbathObservanceEnabled: true },
).filter((entry) => entry.kind === 'sabbath');
assert.equal(sundayEntryReports.length, 1);
assert.equal(sundayEntryReports[0]?.id, 'sabbath:1:7');
assert.match(sundayEntryReports[0]?.title ?? '', /Sabbath is observed/);

const mondayDayOneTick = (
  CALENDAR_SECONDS_PER_DAY - CALENDAR_DAY_START_OFFSET_SECONDS
) / SIM_TICK_SECONDS;
assert.deepEqual(
  deriveLordReportTransitions(
    gameState(mondayDayOneTick, { buildings: [staffedChapel] }),
    null,
    { sabbathObservanceEnabled: true },
  ).filter((entry) => entry.kind === 'sabbath'),
  [],
  'hydrating on any non-Sunday must not invent a Sabbath report',
);

const easterSundayTick = (
  35 * CALENDAR_SECONDS_PER_DAY - CALENDAR_DAY_START_OFFSET_SECONDS
) / SIM_TICK_SECONDS;
const easterSundayReports = deriveLordReportTransitions(
  gameState(easterSundayTick, {
    fires: [fireIncident({
      targetKind: 'residence',
      targetId: 'home-1',
      status: 'burning',
    })],
  }),
  null,
  { sabbathObservanceEnabled: false },
);
assert.equal(
  easterSundayReports.length,
  1,
  'initial hydration should still baseline entity transitions while allowing the Easter status report',
);
assert.equal(easterSundayReports[0]?.kind, 'sabbath');
assert.equal(easterSundayReports[0]?.id, 'sabbath:1:35');
assert.equal(easterSundayReports[0]?.tone, 'settled');
assert.match(easterSundayReports[0]?.title ?? '', /Sabbath.*observed/);
assert.doesNotMatch(easterSundayReports[0]?.title ?? '', /not observed/);
assert.match(
  easterSundayReports[0]?.detail ?? '',
  /Easter|holy[- ]day/i,
  'Easter Sunday should explain the settlement-wide protected holy-day observance',
);

const policyDisabledSabbath = deriveLordReportTransitions(
  initialSunday,
  null,
  { sabbathObservanceEnabled: false },
).find((entry) => entry.kind === 'sabbath');
assert.ok(policyDisabledSabbath);
assert.match(policyDisabledSabbath.title, /It is Sunday — the Sabbath is not observed/);
assert.match(
  policyDisabledSabbath.detail,
  /polic|decre|observance/i,
  'a non-observance report should distinguish disabled parish policy from missing facilities',
);

const unstaffedSabbath = deriveLordReportTransitions(
  gameState(0),
  null,
  { sabbathObservanceEnabled: true },
).find((entry) => entry.kind === 'sabbath');
assert.ok(unstaffedSabbath);
assert.match(unstaffedSabbath.title, /Sabbath is not observed/);
assert.match(
  unstaffedSabbath.detail,
  /chapel|church/i,
  'enabled observance without a staffed chapel should report the real readiness blocker',
);

const unfinishedChapelSabbath = deriveLordReportTransitions(
  gameState(0, {
    buildings: [{ ...staffedChapel, constructionComplete: false }],
  }),
  null,
  { sabbathObservanceEnabled: true },
).find((entry) => entry.kind === 'sabbath');
assert.ok(unfinishedChapelSabbath);
assert.match(unfinishedChapelSabbath.title, /Sabbath is not observed/);

const fireUnsafeChapelSabbath = deriveLordReportTransitions(
  gameState(0, {
    buildings: [staffedChapel],
    fires: [fireIncident({ targetId: staffedChapel.id, status: 'burning' })],
  }),
  null,
  { sabbathObservanceEnabled: true },
).find((entry) => entry.kind === 'sabbath');
assert.ok(fireUnsafeChapelSabbath);
assert.match(
  fireUnsafeChapelSabbath.title,
  /Sabbath is not observed/,
  'a burning chapel must not count as an operational place of observance',
);

const aggregatedGranary = building({
  id: 'granary-aggregate',
  kind: 'granary',
  food: 100,
  berries: 240,
  ryeSheaves: 120,
  ryeGrain: 80,
  oatSheaves: 60,
  oatGrain: 40,
  maslinSheaves: 30,
  maslinGrain: 30,
  barleySheaves: 100,
  barley: 140,
  ryeFlour: 100,
  maslinFlour: 160,
});
const granaryChannels = new Map(
  storageOccupancyChannels(aggregatedGranary).map((channel) => [channel.key, channel]),
);
assert.equal(
  granaryChannels.get('food')?.amount,
  380,
  'fresh-food occupancy should share one bucket across every fresh-food field',
);
assert.equal(
  granaryChannels.get('grain')?.amount,
  360,
  'the grain bay should combine rye, oat, and maslin sheaves with threshed grain',
);
assert.equal(
  granaryChannels.get('barley')?.amount,
  240,
  'the barley bay should combine sheaves and threshed barley',
);
assert.equal(
  granaryChannels.get('flour')?.amount,
  260,
  'the flour room should combine rye and maslin flour',
);
assert.deepEqual(
  fullStorageChannels(aggregatedGranary).map((channel) => channel.key),
  ['food', 'grain', 'barley', 'flour'],
  'all full aggregate buckets should be reported in stable storage-channel order',
);
assert.deepEqual(
  fullStorageChannels({
    ...aggregatedGranary,
    constructionComplete: false,
  }),
  [],
  'unfinished buildings must not produce full-storage reports',
);

const maintainedLumberMill = building({
  id: 'maintained-lumber-mill',
  kind: 'lumber_mill',
  ironwork: 3,
});
assert.equal(
  storageOccupancyChannels(maintainedLumberMill)
    .find((channel) => channel.key === 'ironwork')?.purpose,
  'maintenance-reserve',
  'a civilian-tool rack should remain visible as physical storage but be classified as maintenance stock',
);
assert.equal(
  reportableStorageOccupancyChannels(maintainedLumberMill)
    .some((channel) => channel.key === 'ironwork'),
  false,
  'maintenance ironwork must be excluded from reportable storage channels',
);
assert.deepEqual(
  fullStorageChannels(maintainedLumberMill),
  [],
  'a full lumber-mill maintenance rack must not create a full-storage report',
);

const fullSmithyOutput = building({
  id: 'full-smithy-output',
  kind: 'smithy',
  ironwork: 72,
});
const smithyIronworkChannel = fullStorageChannels(fullSmithyOutput)
  .find((channel) => channel.key === 'ironwork');
assert.equal(smithyIronworkChannel?.purpose, 'working-stock');
assert.equal(smithyIronworkChannel?.amount, 72);
assert.equal(smithyIronworkChannel?.capacity, 72);
assert.equal(
  deriveLordReportTransitions(
    gameState(91, { buildings: [fullSmithyOutput] }),
    gameState(90, {
      buildings: [{ ...fullSmithyOutput, ironwork: 71 }],
    }),
  ).filter((entry) => entry.kind === 'storage').length,
  1,
  'a genuine smithy output store should still report when ironwork reaches capacity',
);

const fullMarketplace = building({
  id: 'fully-stocked-marketplace',
  kind: 'marketplace',
  food: 96,
});
const marketplaceFoodChannel = storageOccupancyChannels(fullMarketplace)
  .find((channel) => channel.key === 'food');
assert.equal(marketplaceFoodChannel?.amount, 96);
assert.equal(marketplaceFoodChannel?.capacity, 96);
assert.deepEqual(
  fullStorageChannels(fullMarketplace),
  [],
  'a full Marketplace service bay must not be classified as blocked storage',
);
assert.deepEqual(
  deriveLordReportTransitions(
    gameState(96, { buildings: [fullMarketplace] }),
    gameState(95, {
      buildings: [{ ...fullMarketplace, food: 95 }],
    }),
  ),
  [],
  'stocking a Marketplace service bay to capacity must not warn the Lord',
);

const nearlyFullLodge = building({
  id: 'lodge-full-edge',
  kind: 'woodcutters_lodge',
  firewood: 119.99,
});
const fullLodge = building({
  ...nearlyFullLodge,
  firewood: 120,
});
const firstFullReports = deriveLordReportTransitions(
  gameState(101, { buildings: [fullLodge] }),
  gameState(100, { buildings: [nearlyFullLodge] }),
);
assert.equal(firstFullReports.length, 1);
assert.equal(firstFullReports[0]?.kind, 'storage');
assert.equal(firstFullReports[0]?.target?.kind, 'building');
assert.equal(firstFullReports[0]?.target?.id, fullLodge.id);
assert.match(firstFullReports[0]?.title ?? '', /local storage is full/);
assert.match(firstFullReports[0]?.detail ?? '', /Firewood store 120\/120/);

assert.deepEqual(
  deriveLordReportTransitions(
    gameState(102, { buildings: [{ ...fullLodge }] }),
    gameState(101, { buildings: [fullLodge] }),
  ),
  [],
  'an unchanged full bucket should not emit on every snapshot',
);
assert.deepEqual(
  deriveLordReportTransitions(
    gameState(103, { buildings: [nearlyFullLodge] }),
    gameState(102, { buildings: [fullLodge] }),
  ),
  [],
  'dropping below capacity should silently re-arm the storage transition',
);
const refilledReports = deriveLordReportTransitions(
  gameState(104, { buildings: [fullLodge] }),
  gameState(103, { buildings: [nearlyFullLodge] }),
);
assert.equal(
  refilledReports.filter((report) => report.kind === 'storage').length,
  1,
  'a bucket should report again after it drains below capacity and refills',
);

const twoChannelLodge = building({
  ...fullLodge,
  timber: 60,
});
const secondChannelReports = deriveLordReportTransitions(
  gameState(105, { buildings: [twoChannelLodge] }),
  gameState(104, { buildings: [fullLodge] }),
);
assert.equal(secondChannelReports.length, 1);
assert.match(secondChannelReports[0]?.detail ?? '', /Timber store 60\/60/);
assert.doesNotMatch(
  secondChannelReports[0]?.detail ?? '',
  /Firewood store/,
  'a later bucket crossing should not repeat a bucket that was already full',
);

const granaryBelowCapacity = building({
  id: 'granary-edge',
  kind: 'granary',
  food: 339,
});
const granaryAtCapacity = building({
  ...granaryBelowCapacity,
  food: 340,
});
const granaryFullReports = deriveLordReportTransitions(
  gameState(111, { buildings: [granaryAtCapacity] }),
  gameState(110, { buildings: [granaryBelowCapacity] }),
);
assert.equal(granaryFullReports[0]?.title, 'Granary storage is full');

const storehouseBelowCapacity = building({
  id: 'storehouse-edge',
  kind: 'village_storehouse',
  timber: 359,
});
const storehouseAtCapacity = building({
  ...storehouseBelowCapacity,
  timber: 360,
});
const storehouseFullReports = deriveLordReportTransitions(
  gameState(121, { buildings: [storehouseAtCapacity] }),
  gameState(120, { buildings: [storehouseBelowCapacity] }),
);
assert.equal(storehouseFullReports[0]?.title, 'Storehouse storage is full');

const foundingHouseholdFill = residence({ id: 'founding-home', population: 2 });
assert.deepEqual(
  deriveLordReportTransitions(
    gameState(199, {
      residences: [{ ...foundingHouseholdFill, population: 3 }],
    }),
    gameState(198, { residences: [foundingHouseholdFill] }),
  ),
  [],
  'moving the existing founding labor pool into housing should not report a new city laborer',
);

const priorHome = residence({
  id: 'home-arrival',
  tier: 4,
  population: 10,
  populationCapacity: 15,
});
const occupiedHome = residence({ ...priorHome, population: 11 });
const arrivalReports = deriveLordReportTransitions(
  gameState(201, { residences: [occupiedHome] }),
  gameState(200, { residences: [priorHome] }),
);
assert.equal(arrivalReports.length, 1);
assert.equal(arrivalReports[0]?.kind, 'labor');
assert.equal(arrivalReports[0]?.title, 'A new laborer joined the city');
assert.equal(arrivalReports[0]?.target?.kind, 'residence');
assert.equal(arrivalReports[0]?.target?.id, occupiedHome.id);
assert.equal(arrivalReports[0]?.detail, '');
assert.deepEqual(
  deriveLordReportTransitions(
    gameState(202, { residences: [{ ...occupiedHome }] }),
    gameState(201, { residences: [occupiedHome] }),
  ),
  [],
  'an unchanged household population should not repeat an arrival report',
);
assert.deepEqual(
  deriveLordReportTransitions(
    gameState(203, { residences: [priorHome] }),
    gameState(202, { residences: [occupiedHome] }),
  ),
  [],
  'population loss is not a new-laborer report',
);
const pluralArrivalReports = deriveLordReportTransitions(
  gameState(204, { residences: [{ ...priorHome, population: 12 }] }),
  gameState(203, { residences: [priorHome] }),
);
assert.equal(pluralArrivalReports[0]?.title, '2 new laborers joined the city');

assert.deepEqual(
  deriveLordReportTransitions(
    gameState(1, {
      buildings: [fullLodge],
      residences: [occupiedHome],
      fires: [fireIncident({ status: 'burning' })],
    }),
    null,
  ),
  [],
  'the first hydrated snapshot should establish a baseline without flooding the ledger',
);

const fireBuilding = building({
  id: 'burning-smithy',
  kind: 'smithy',
});
const burning = fireIncident({
  id: 'fire-smithy',
  targetId: fireBuilding.id,
  status: 'burning',
});
const fireReports = deriveLordReportTransitions(
  gameState(301, { buildings: [fireBuilding], fires: [burning] }),
  gameState(300, { buildings: [fireBuilding] }),
);
assert.equal(fireReports.length, 1);
assert.equal(fireReports[0]?.kind, 'fire');
assert.equal(fireReports[0]?.target?.id, fireBuilding.id);
assert.match(fireReports[0]?.title ?? '', /Fire reported at .*smithy/i);
assert.deepEqual(
  deriveLordReportTransitions(
    gameState(302, { buildings: [fireBuilding], fires: [{ ...burning }] }),
    gameState(301, { buildings: [fireBuilding], fires: [burning] }),
  ),
  [],
  'an unchanged burning incident should not repeat its report',
);

const collection = new LordReportCollection();
const dawn = report({ id: 'dawn:1', kind: 'dawn', title: 'First report' });
const labor = report({ id: 'labor:1', kind: 'labor', title: 'Second report' });
assert.equal(collection.add(dawn), true);
assert.equal(collection.add(dawn), false, 'adding the same report object twice should be a no-op');
assert.equal(collection.add(labor), true);
assert.deepEqual(
  collection.values().map((entry) => entry.id),
  [labor.id, dawn.id],
  'new reports should be ordered newest first',
);
assert.equal(
  collection.add({ ...dawn, detail: 'Updated copy' }),
  true,
  'an updated report with the same stable id should replace its old copy',
);
assert.equal(collection.size, 2, 'updating an existing report must not duplicate it');
assert.deepEqual(
  collection.values().map((entry) => entry.id),
  [dawn.id, labor.id],
  'an updated report should move to the newest position',
);
assert.equal(collection.values()[0]?.detail, 'Updated copy');
assert.equal(collection.dismiss(dawn.id), true);
assert.equal(collection.dismiss(dawn.id), false, 'dismissing a missing report should be a no-op');
assert.deepEqual(collection.values().map((entry) => entry.id), [labor.id]);
assert.equal(collection.clear(), true);
assert.equal(collection.clear(), false, 'clearing an empty ledger should be a no-op');

const persistentDismissal = new LordReportCollection();
for (const entry of firstFullReports) persistentDismissal.add(entry);
assert.equal(persistentDismissal.size, 1);
assert.equal(persistentDismissal.dismiss(firstFullReports[0]!.id), true);
for (const entry of deriveLordReportTransitions(
  gameState(102, { buildings: [{ ...fullLodge }] }),
  gameState(101, { buildings: [fullLodge] }),
)) persistentDismissal.add(entry);
assert.equal(
  persistentDismissal.size,
  0,
  'dismissing a report while its condition remains active must not recreate it next snapshot',
);
for (const entry of refilledReports) persistentDismissal.add(entry);
assert.equal(
  persistentDismissal.size,
  1,
  'a genuinely new below-to-full transition should create a fresh persistent report',
);

console.log('lord report ledger and transition tests passed');

function gameState(
  tick: number,
  options: {
    buildings?: BuildingState[];
    residences?: ResidenceState[];
    fires?: FireIncidentState[];
  } = {},
): GameState {
  return {
    seed: 1,
    tick,
    physicalFoundingSiteEnabled: true,
    stockpile: createEmptyStockpile(),
    quarries: new Map(),
    foragingNodes: new Map(),
    trees: new Map(),
    buildings: new Map((options.buildings ?? []).map((entry) => [entry.id, entry])),
    farmFields: new Map(),
    pastures: new Map(),
    livestockHerds: new Map(),
    burgageZones: new Map(),
    residences: new Map((options.residences ?? []).map((entry) => [entry.id, entry])),
    backyardGardens: new Map(),
    deliveryTrips: new Map(),
    fireIncidents: new Map((options.fires ?? []).map((entry) => [entry.id, entry])),
    nextBuildingId: 1,
  };
}

function building(
  partial: Partial<BuildingState> & Pick<BuildingState, 'id' | 'kind'>,
): BuildingState {
  return {
    id: partial.id,
    kind: partial.kind,
    x: 10,
    z: 20,
    workRadius: 0,
    actionCooldown: 0,
    timber: 0,
    firewood: 0,
    stone: 0,
    water: 0,
    food: 0,
    ale: 0,
    preservedFood: 0,
    honey: 0,
    wine: 0,
    gold: 0,
    waterCapacity: 0,
    assignedLabor: 0,
    constructionComplete: true,
    constructionProgress: 0,
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
    ...partial,
  };
}

function residence(partial: Partial<ResidenceState> = {}): ResidenceState {
  return {
    id: 'home-1',
    zoneId: 'zone-1',
    parcelIndex: 0,
    x: 30,
    z: 40,
    yaw: 0,
    population: 1,
    populationCapacity: 3,
    tier: 1,
    settlementTicks: 0,
    needs: createDefaultNeeds(),
    abandoned: false,
    householdWealth: 0,
    ...partial,
  };
}

function fireIncident(partial: Partial<FireIncidentState> = {}): FireIncidentState {
  return {
    id: 'fire-1',
    targetKind: 'building',
    targetId: 'lodge-full-edge',
    x: 10,
    z: 20,
    ignitionSource: 'accident',
    status: 'burning',
    intensity: 0.5,
    damage: 0.1,
    waterDelivered: 0,
    requiredWater: 10,
    extinguishChance: 0,
    startedTick: 1,
    discoveredTick: 1,
    lastWaterTick: 0,
    resolvedTick: 0,
    responseWellId: null,
    ...partial,
  };
}

function report(
  partial: Pick<LordReport, 'id' | 'kind' | 'title'> & Partial<LordReport>,
): LordReport {
  return {
    id: partial.id,
    kind: partial.kind,
    tone: 'notice',
    title: partial.title,
    detail: 'Original copy',
    timeLabel: 'Day 1',
    ...partial,
  };
}
