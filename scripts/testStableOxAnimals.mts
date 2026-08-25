import assert from 'node:assert/strict';
import type { DeliveryTripState } from '../src/logistics/deliveryTrips.ts';
import type {
  BackyardGardenState,
  BuildingKind,
  BuildingState,
  LivestockHerdState,
  PastureState,
} from '../src/resources/types.ts';
import type { StableOxLike } from '../src/settlement/stableOxen.ts';
import { buildSettlementAnimalsView } from '../src/ui/settlementAnimals.ts';

function building(
  id: string,
  kind: BuildingKind,
  x: number,
  assignedLabor = 0,
): BuildingState {
  return {
    id,
    kind,
    x,
    z: 0,
    assignedLabor,
    constructionComplete: true,
  } as BuildingState;
}

function herd(
  buildingId: string,
  species: LivestockHerdState['species'],
  headCount: number,
  pastureCapacity: number,
  suppliedCapacity: number,
): LivestockHerdState {
  return {
    buildingId,
    species,
    headCount,
    health: 1,
    breedingProgress: 0,
    pastureCapacity,
    suppliedCapacity,
    lastFoodOutput: 0,
    lastPreservedOutput: 0,
    lastWoolGold: 0,
    breedingReserve: 0,
    lastCulled: 0,
    hayStock: 0,
    lastHayOutput: 0,
    haymakingPercent: 0,
  };
}

function pasture(id: string, farmsteadId: string, area: number): PastureState {
  return {
    id,
    farmsteadId,
    corners: [
      { x: 0, z: 0 },
      { x: 1, z: 0 },
      { x: 1, z: 1 },
      { x: 0, z: 1 },
    ],
    area,
    averageSlopeDegrees: 0,
    moisture: 0.5,
  };
}

function backyard(
  id: string,
  residenceId: string,
  kind: BackyardGardenState['kind'],
): BackyardGardenState {
  return {
    id,
    residenceId,
    kind,
    firstHarvestDay: 0,
    lastPrimaryProductionDay: 0,
    lastSecondaryProductionDay: 0,
    hideStock: 0,
    flowerLuxuryUpgraded: false,
  };
}

const buildings = new Map<string, BuildingState>([
  ['stable-a', building('stable-a', 'stable', 0)],
  ['stable-b', building('stable-b', 'stable', 100)],
  ['stable-c', building('stable-c', 'stable', 200)],
  ['lumber', building('lumber', 'lumber_mill', 1, 1)],
  ['quarry', building('quarry', 'stone_quarry', 10, 1)],
  ['carpenter', building('carpenter', 'carpenter', 110, 0)],
  ['storehouse', building('storehouse', 'village_storehouse', 4, 1)],
  ['cattle-holding', building('cattle-holding', 'pastoral_farmstead', 50, 1)],
  ['sheep-holding', building('sheep-holding', 'pastoral_farmstead', 60, 1)],
  ['swine-holding', building('swine-holding', 'swineherd', 70, 1)],
]);

const oxen: StableOxLike[] = [
  {
    id: 'ox-auto-assist',
    stableId: 'stable-a',
    slot: 0,
    assignedBuildingId: null,
  },
  {
    id: 'ox-auto-haul',
    stableId: 'stable-a',
    slot: 1,
    assignedBuildingId: null,
  },
  {
    id: 'ox-posted-active',
    stableId: 'stable-b',
    slot: 0,
    assignedBuildingId: 'lumber',
  },
  {
    id: 'ox-posted-waiting',
    stableId: 'stable-b',
    slot: 1,
    assignedBuildingId: 'carpenter',
  },
  {
    id: 'ox-disabled-stable',
    stableId: 'stable-c',
    slot: 2,
    assignedBuildingId: null,
  },
];

const haulingTrip: DeliveryTripState = {
  id: 'trip-1',
  buildingId: 'storehouse',
  laborBuildingId: 'storehouse',
  residenceId: null,
  destinationKind: 'building',
  targetBuildingId: 'lumber',
  cargoKind: 'timber',
  amount: 12,
  phase: 'outbound',
  x: 5,
  z: 0,
  progress: 0.25,
  speedMps: 2,
  unloadSeconds: 1,
  unloadRemaining: 1,
  deliveryWorkers: 1,
  freeHaulerWorkers: 0,
  oxId: 'ox-auto-haul',
  pathDistance: 20,
  travelSpeedMultiplier: 1,
  routePolylineJson: '[]',
};

const livestock = {
  herds: [
    herd('cattle-holding', 'cattle', 5, 4.5, 5),
    herd('sheep-holding', 'sheep', 3, 2.5, 3),
    herd('swine-holding', 'swine', 7, 6, 6.5),
  ],
  pastures: [
    pasture('pasture-cattle-1', 'cattle-holding', 600),
    pasture('pasture-cattle-2', 'cattle-holding', 400),
    pasture('pasture-sheep', 'sheep-holding', 700),
    pasture('pannage-swine', 'swine-holding', 900),
  ],
  backyardGardens: [
    backyard('garden-chicken-a', 'residence-1', 'chicken_pen'),
    backyard('garden-chicken-b', 'residence-2', 'chicken_pen'),
    backyard('garden-goat', 'residence-3', 'goat_pen'),
    backyard('garden-pig', 'residence-4', 'pig_pen'),
    backyard('garden-unstocked', 'residence-5', 'animal_pen'),
    backyard('garden-apiary', 'residence-6', 'backyard_apiary'),
  ],
};

const view = buildSettlementAnimalsView(
  oxen,
  buildings,
  [haulingTrip],
  new Set(['stable-c']),
  livestock,
);

assert.deepEqual(
  {
    total: view.total,
    posted: view.posted,
    automatic: view.automatic,
    working: view.working,
  },
  { total: 5, posted: 2, automatic: 3, working: 3 },
  'the roster distinguishes permanent postings from the automatic pool',
);

const byId = new Map(view.entries.map((entry) => [entry.id, entry]));
const autoAssist = byId.get('ox-auto-assist');
const autoHaul = byId.get('ox-auto-haul');
const postedActive = byId.get('ox-posted-active');
const postedWaiting = byId.get('ox-posted-waiting');
const disabledStable = byId.get('ox-disabled-stable');

assert.ok(autoAssist && autoHaul && postedActive && postedWaiting && disabledStable);

assert.deepEqual(
  {
    stableLabel: autoAssist.stableLabel,
    bay: autoAssist.bay,
    mode: autoAssist.mode,
    postingLabel: autoAssist.postingLabel,
  },
  {
    stableLabel: 'Stable 1',
    bay: 1,
    mode: 'automatic',
    postingLabel: 'Best available task',
  },
  'stable numbering, one-based bay labels, and automatic-pool identity remain explicit',
);
assert.equal(autoHaul.stableLabel, 'Stable 1');
assert.equal(autoHaul.bay, 2);
assert.equal(postedActive.stableLabel, 'Stable 2');
assert.equal(postedWaiting.bay, 2);
assert.equal(disabledStable.stableLabel, 'Stable 3');
assert.equal(disabledStable.bay, 3);

assert.deepEqual(
  {
    mode: postedActive.mode,
    postingBuildingId: postedActive.postingBuildingId,
    postingLabel: postedActive.postingLabel,
    activity: postedActive.activity,
    activityBuildingId: postedActive.activityBuildingId,
    activityLabel: postedActive.activityLabel,
  },
  {
    mode: 'posted',
    postingBuildingId: 'lumber',
    postingLabel: 'Lumber mill',
    activity: 'assisting',
    activityBuildingId: 'lumber',
    activityLabel: 'Assisting Lumber mill',
  },
  'a posted ox claims its permanent workplace before an earlier automatic ox',
);
assert.deepEqual(
  {
    mode: autoAssist.mode,
    activity: autoAssist.activity,
    activityBuildingId: autoAssist.activityBuildingId,
    activityLabel: autoAssist.activityLabel,
  },
  {
    mode: 'automatic',
    activity: 'assisting',
    activityBuildingId: 'quarry',
    activityLabel: 'Assisting Mining Pit',
  },
  'the automatic ox falls back to the next open useful worker slot',
);

assert.deepEqual(
  {
    mode: autoHaul.mode,
    activity: autoHaul.activity,
    activityBuildingId: autoHaul.activityBuildingId,
    activityLabel: autoHaul.activityLabel,
  },
  {
    mode: 'automatic',
    activity: 'hauling',
    activityBuildingId: 'storehouse',
    activityLabel: 'Hauling timber from Storehouse',
  },
  'the authoritative DeliveryTrip ox reservation wins over derived production assistance',
);

assert.deepEqual(
  {
    mode: postedWaiting.mode,
    postingLabel: postedWaiting.postingLabel,
    activity: postedWaiting.activity,
    activityBuildingId: postedWaiting.activityBuildingId,
    activityLabel: postedWaiting.activityLabel,
  },
  {
    mode: 'posted',
    postingLabel: 'Carpenter and wheelwright',
    activity: 'waiting',
    activityBuildingId: 'carpenter',
    activityLabel: 'Waiting for useful work at Carpenter and wheelwright',
  },
  'a posted ox waits for its own crew instead of joining the automatic pool',
);

assert.deepEqual(
  {
    mode: disabledStable.mode,
    activity: disabledStable.activity,
    activityBuildingId: disabledStable.activityBuildingId,
    activityLabel: disabledStable.activityLabel,
  },
  {
    mode: 'automatic',
    activity: 'waiting',
    activityBuildingId: 'stable-c',
    activityLabel: 'Waiting — Stable 3 is unavailable',
  },
  'an ox housed in a fire-disabled stable is waiting, not described as idle or available',
);

const movedTripView = buildSettlementAnimalsView(
  oxen,
  buildings,
  [{ ...haulingTrip, x: 14, progress: 0.8 }],
  new Set(['stable-c']),
  livestock,
);
assert.equal(
  movedTripView.signature,
  view.signature,
  'cart movement alone does not invalidate the semantic Animals HUD roster',
);

assert.deepEqual(
  view.ledger.stable,
  {
    stableCount: 3,
    stableIds: ['stable-a', 'stable-b', 'stable-c'],
    occupied: 5,
    capacity: 9,
    openBays: 4,
    purchaseReadyOpenBays: 2,
    unavailableStableCount: 1,
  },
  'stable housing uses the authored three-bay capacity and excludes fire-disabled bays from purchases',
);
assert.deepEqual(
  {
    headCount: view.ledger.headCount,
    herdHeads: view.ledger.herds.headCount,
    holdings: view.ledger.herds.holdingCount,
    pastures: view.ledger.herds.pastureCount,
    pastureArea: view.ledger.herds.pastureArea,
    forageCapacity: view.ledger.herds.forageCapacity,
    suppliedCapacity: view.ledger.herds.suppliedCapacity,
  },
  {
    headCount: 20,
    herdHeads: 15,
    holdings: 3,
    pastures: 4,
    pastureArea: 2600,
    forageCapacity: 13,
    suppliedCapacity: 14.5,
  },
  'the ledger adds exact farm-herd heads to draft oxen and preserves authoritative capacities',
);
assert.deepEqual(
  view.ledger.herds.species.map((entry) => ({
    species: entry.species,
    heads: entry.headCount,
    holdings: entry.holdingCount,
    pastures: entry.pastureCount,
    area: entry.pastureArea,
    housing: entry.housingLabel,
  })),
  [
    { species: 'cattle', heads: 5, holdings: 1, pastures: 2, area: 1000, housing: 'Pasture' },
    { species: 'sheep', heads: 3, holdings: 1, pastures: 1, area: 700, housing: 'Pasture' },
    { species: 'swine', heads: 7, holdings: 1, pastures: 1, area: 900, housing: 'Woodland pannage' },
  ],
  'species rows keep pasture husbandry distinct from woodland pannage',
);
assert.deepEqual(
  {
    pens: view.ledger.backyard.penCount,
    specialized: view.ledger.backyard.specializedPenCount,
    unstocked: view.ledger.backyard.unstockedPenCount,
    rows: view.ledger.backyard.pens.map((entry) => [entry.kind, entry.penCount]),
  },
  {
    pens: 5,
    specialized: 4,
    unstocked: 1,
    rows: [
      ['chickens', 2],
      ['goats', 1],
      ['pigs', 1],
      ['unstocked', 1],
    ],
  },
  'backyard husbandry reports replicated pens without pretending they are animal head counts',
);

const changedHerdView = buildSettlementAnimalsView(
  oxen,
  buildings,
  [haulingTrip],
  new Set(['stable-c']),
  {
    ...livestock,
    herds: [
      herd('cattle-holding', 'cattle', 6, 4.5, 5),
      ...livestock.herds.slice(1),
    ],
  },
);
assert.notEqual(
  changedHerdView.signature,
  view.signature,
  'a herd-head change invalidates the semantic Animals HUD ledger',
);

const pausedView = buildSettlementAnimalsView(
  oxen,
  buildings,
  [haulingTrip],
  new Set(['stable-c']),
  { ...livestock, laborPauseLabel: 'Sunday rest' },
);
const pausedById = new Map(pausedView.entries.map((entry) => [entry.id, entry]));
assert.deepEqual(
  {
    tasked: pausedView.working,
    automaticProduction: pausedById.get('ox-auto-assist')?.activity,
    automaticProductionLabel: pausedById.get('ox-auto-assist')?.activityLabel,
    postedProduction: pausedById.get('ox-posted-active')?.activity,
    postedProductionLabel: pausedById.get('ox-posted-active')?.activityLabel,
    activeCart: pausedById.get('ox-auto-haul')?.activity,
  },
  {
    tasked: 1,
    automaticProduction: 'waiting',
    automaticProductionLabel: 'Resting — Sunday rest',
    postedProduction: 'waiting',
    postedProductionLabel: 'Resting — Sunday rest',
    activeCart: 'hauling',
  },
  'a named labor pause rests derived production oxen while an authoritative active cart remains tasked',
);

const numericBuildings = new Map<string, BuildingState>([
  ['building-10', building('building-10', 'stable', 10)],
  ['building-2', building('building-2', 'stable', 2)],
]);
const numericView = buildSettlementAnimalsView(
  [
    { id: 'stable-ox-10', stableId: 'building-10', slot: 0 },
    { id: 'stable-ox-2', stableId: 'building-2', slot: 0 },
  ],
  numericBuildings,
  [],
);
assert.deepEqual(
  {
    stableIds: numericView.ledger.stable.stableIds,
    roster: numericView.entries.map((entry) => [entry.id, entry.stableLabel]),
  },
  {
    stableIds: ['building-2', 'building-10'],
    roster: [
      ['stable-ox-2', 'Stable 1'],
      ['stable-ox-10', 'Stable 2'],
    ],
  },
  'the livestock ledger and roster use server-numeric order after single digits',
);

console.log('stable ox Animals view-model tests passed');
