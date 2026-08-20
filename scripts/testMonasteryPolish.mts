import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  MONASTERY_CHARITY_FOOD_PER_DELIVERY,
  MONASTERY_COVERAGE_RADIUS,
} from '../src/generated/gameBalance.ts';
import { validateBuildingPlacement } from '../src/buildings/BuildingPlacementValidation.ts';
import { createBuildingMesh } from '../src/buildings/BuildingMeshes.ts';
import { buildingMarkerSignatures } from '../src/buildings/buildingMarkerSignature.ts';
import {
  MONASTERY_ALE_VISUAL_SEGMENTS,
  MONASTERY_FOOD_VISUAL_SEGMENTS,
  MONASTERY_HONEY_VISUAL_SEGMENTS,
  MONASTERY_WINE_VISUAL_SEGMENTS,
  monasteryStockpileVisualSignature,
  syncMonasteryStockpileVisuals,
} from '../src/buildings/monasteryStockpileVisuals.ts';
import {
  claimResidenceCommunityLandmarks,
  findLinkedMonasteryInCoverage,
  isResidenceInMonasteryCoverage,
  monasteryLinkedToChapel,
} from '../src/logistics/landmarkAccess.ts';
import { RoadNetwork } from '../src/roads/RoadNetwork.ts';
import { clampMonasteryTitheShare } from '../src/economy/monasteryPolicy.ts';
import { createDefaultNeeds } from '../src/residences/residenceNeedState.ts';
import type { BuildingState, ResidenceState } from '../src/resources/types.ts';

function residence(overrides: Partial<ResidenceState> = {}): ResidenceState {
  return {
    id: 'res-1',
    zoneId: 'zone-1',
    parcelIndex: 0,
    x: 10,
    z: 10,
    yaw: 0,
    population: 3,
    populationCapacity: 3,
    settlementTicks: 0,
    needs: createDefaultNeeds(),
    abandoned: false,
    householdWealth: 0,
    tier: 1,
    ...overrides,
  };
}

function building(overrides: Partial<BuildingState>): BuildingState {
  return {
    id: 'building-1',
    kind: 'monastery',
    x: 20,
    z: 10,
    workRadius: MONASTERY_COVERAGE_RADIUS,
    actionCooldown: 0,
    timber: 0,
    firewood: 0,
    stone: 0,
    water: 0,
    food: 0,
    gold: 0,
    waterCapacity: 0,
    assignedLabor: 0,
    ...overrides,
  };
}

const staffedChapel = building({ id: 'chapel-1', kind: 'chapel', x: 10, z: 20, assignedLabor: 1 });
const monastery = building({ id: 'monastery-1', kind: 'monastery', x: 40, z: 10 });
const home = residence();

const connectedProbe = (ax: number, az: number, bx: number, bz: number): number | null => {
  if (ax === home.x && az === home.z && bx === staffedChapel.x && bz === staffedChapel.z) return 12;
  if (ax === home.x && az === home.z && bx === monastery.x && bz === monastery.z) return 24;
  if (ax === monastery.x && az === monastery.z && bx === staffedChapel.x && bz === staffedChapel.z) return 18;
  return null;
};

assert.equal(monasteryLinkedToChapel(monastery, [staffedChapel], connectedProbe), true);
assert.equal(
  findLinkedMonasteryInCoverage(home, [monastery], [staffedChapel], connectedProbe)?.id,
  monastery.id,
);
assert.equal(
  isResidenceInMonasteryCoverage(home, [monastery], [staffedChapel], connectedProbe),
  true,
);

const farProbe = () => 900;
assert.equal(
  isResidenceInMonasteryCoverage(home, [monastery], [staffedChapel], farProbe),
  false,
);

const parishRoads = new RoadNetwork();
parishRoads.addRoadPath([
  new THREE.Vector3(-20, 0, 0),
  new THREE.Vector3(260, 0, 0),
]);
parishRoads.addRoadPath([
  new THREE.Vector3(-20, 0, 80),
  new THREE.Vector3(260, 0, 80),
]);
const parishHome = residence({ id: 'parish-home', x: 20, z: 0 });
const remoteHome = residence({ id: 'remote-home', x: 20, z: 80 });
const parishChapel = building({
  id: 'parish-chapel',
  kind: 'chapel',
  x: 0,
  z: 0,
  assignedLabor: 1,
});
const olderFarMonastery = building({
  id: '001-older-far-monastery',
  kind: 'monastery',
  x: 220,
  z: 0,
});
const newerNearMonastery = building({
  id: '999-newer-near-monastery',
  kind: 'monastery',
  x: 60,
  z: 0,
});
const disconnectedMonastery = building({
  id: '000-disconnected-monastery',
  kind: 'monastery',
  x: 60,
  z: 80,
});
const communityClaims = claimResidenceCommunityLandmarks(
  parishRoads,
  [parishHome, remoteHome],
  [parishChapel],
  [
    olderFarMonastery,
    newerNearMonastery,
    disconnectedMonastery,
  ],
);
assert.equal(
  communityClaims.chapels.get(parishHome.id)?.supplierId,
  parishChapel.id,
);
assert.equal(
  communityClaims.monasteries.get(parishHome.id)?.supplierId,
  newerNearMonastery.id,
  'overlapping monastery territories must assign a home to the nearest road-linked house, not the oldest row',
);
assert.equal(
  findLinkedMonasteryInCoverage(
    parishHome,
    [olderFarMonastery, newerNearMonastery],
    [parishChapel],
    (ax, az, bx, bz) =>
      parishRoads.getPathfinder().roadPathDistance(ax, az, bx, bz),
  )?.id,
  newerNearMonastery.id,
  'single-household inspection must show the same nearest monastery as the bulk territory',
);
assert.equal(
  communityClaims.monasteries.get(remoteHome.id)?.supplierId,
  newerNearMonastery.id,
  'a remote household may walk overland to its parish, while the monastery itself remains chapel-linked',
);

assert.equal(clampMonasteryTitheShare(0.95), 0.8);
assert.equal(clampMonasteryTitheShare(-0.1), 0);
assert.equal(MONASTERY_CHARITY_FOOD_PER_DELIVERY, 4);

const flatResult = validateBuildingPlacement('monastery', 0, 0, {
  buildings: [staffedChapel],
  residences: Array.from({ length: 4 }, (_, index) => residence({ id: `flat-res-${index}` })),
  burgageZones: [],
  quarries: [],
  foragingNodes: [],
  stockpile: { timber: 999, stone: 999 },
  isWaterAt: () => false,
  getNaturalHeightAt: () => 0,
  mapBounds: { minX: -817, maxX: 817, minZ: -817, maxZ: 817 },
});
assert.equal(flatResult.ok, false);
if (!flatResult.ok) {
  assert.equal(flatResult.reason, 'requires_map_edge');
}

const hillsideHeight = (x: number, z: number) => x * 0.4 + z * 0.25;
const staffedChapelBuilding = building({ id: 'chapel-1', kind: 'chapel', x: 50, z: 50, assignedLabor: 1 });
const populatedResidences = Array.from({ length: 4 }, (_, index) =>
  residence({ id: `res-${index}`, population: 3 }),
);
const hillsideResult = validateBuildingPlacement('monastery', 0, 710, {
  buildings: [staffedChapelBuilding],
  residences: populatedResidences,
  burgageZones: [],
  quarries: [],
  foragingNodes: [],
  stockpile: { timber: 999, stone: 999 },
  isWaterAt: () => false,
  getNaturalHeightAt: () => 0,
  mapBounds: { minX: -817, maxX: 817, minZ: -817, maxZ: 817 },
});
assert.equal(hillsideResult.ok, true, JSON.stringify(hillsideResult));

const noChapelResult = validateBuildingPlacement('monastery', 0, 710, {
  buildings: [],
  residences: populatedResidences,
  burgageZones: [],
  quarries: [],
  foragingNodes: [],
  stockpile: { timber: 999, stone: 999 },
  isWaterAt: () => false,
  getNaturalHeightAt: hillsideHeight,
  mapBounds: { minX: -817, maxX: 817, minZ: -817, maxZ: 817 },
});
assert.equal(noChapelResult.ok, false);
if (!noChapelResult.ok) {
  assert.equal(noChapelResult.reason, 'requires_staffed_chapel');
}

const smallParishResult = validateBuildingPlacement('monastery', 0, 710, {
  buildings: [staffedChapelBuilding],
  residences: [residence({ population: 8 })],
  burgageZones: [],
  quarries: [],
  foragingNodes: [],
  stockpile: { timber: 999, stone: 999 },
  isWaterAt: () => false,
  getNaturalHeightAt: hillsideHeight,
  mapBounds: { minX: -817, maxX: 817, minZ: -817, maxZ: 817 },
});
assert.equal(smallParishResult.ok, false);
if (!smallParishResult.ok) {
  assert.equal(smallParishResult.reason, 'requires_parish_population');
}

const monasteryMarker = createBuildingMesh('monastery');
for (const estatePart of [
  'Monastery estate main gate',
  'Monastery precinct rear wall',
  'Monastery east gatehouse',
  'Monastery southeast round tower',
  'Monastery protected cattle pasture',
  'Monastery reserved dairy upgrade plot',
  'Monastery reserved apple press upgrade plot',
  'Monastery enclosed cloister court',
  'Monastery ale brewhouse and cellar yard',
  'Monastery apple orchard',
  'Monastery bee garden',
  'Monastery chicken yard',
  'Monastery dairy cow',
  'Monastery pig',
  'Monastery infirmary wing',
]) {
  assert.ok(monasteryMarker.getObjectByName(estatePart), `${estatePart} must exist on the estate`);
}
const pantryGroups = [
  ['MonasteryFoodStockpile', 'MonasteryFoodSegment', MONASTERY_FOOD_VISUAL_SEGMENTS],
  ['MonasteryAleStockpile', 'MonasteryAleSegment', MONASTERY_ALE_VISUAL_SEGMENTS],
  ['MonasteryHoneyStockpile', 'MonasteryHoneySegment', MONASTERY_HONEY_VISUAL_SEGMENTS],
  ['MonasteryWineStockpile', 'MonasteryWineSegment', MONASTERY_WINE_VISUAL_SEGMENTS],
] as const;
for (const [containerName, segmentName, expectedSegments] of pantryGroups) {
  const container = monasteryMarker.getObjectByName(containerName);
  assert.ok(container instanceof THREE.Group, `${containerName} must exist on the monastery mesh`);
  assert.equal(
    container.children.filter((child) => child.name === segmentName).length,
    expectedSegments,
  );
  assert.equal(container.visible, false, `${containerName} must begin empty`);
}

const stockedMonastery = building({
  id: 'stocked-monastery',
  constructionComplete: true,
  food: 61,
  ale: 41,
  honey: 81,
  wine: 41,
});
syncMonasteryStockpileVisuals(monasteryMarker, stockedMonastery);
for (const [containerName, segmentName, expectedVisible] of [
  ['MonasteryFoodStockpile', 'MonasteryFoodSegment', 2],
  ['MonasteryAleStockpile', 'MonasteryAleSegment', 2],
  ['MonasteryHoneyStockpile', 'MonasteryHoneySegment', 2],
  ['MonasteryWineStockpile', 'MonasteryWineSegment', 2],
] as const) {
  const container = monasteryMarker.getObjectByName(containerName) as THREE.Group;
  assert.equal(container.visible, true);
  assert.equal(
    container.children.filter((child) => child.name === segmentName && child.visible).length,
    expectedVisible,
  );
}

const emptyMonastery = building({
  id: stockedMonastery.id,
  constructionComplete: true,
});
syncMonasteryStockpileVisuals(monasteryMarker, emptyMonastery);
for (const [containerName, segmentName] of pantryGroups) {
  const container = monasteryMarker.getObjectByName(containerName) as THREE.Group;
  assert.equal(container.visible, false);
  assert.equal(
    container.children.filter((child) => child.name === segmentName && child.visible).length,
    0,
  );
}

const emptyMap = new Map([[emptyMonastery.id, emptyMonastery]]);
const stockedMap = new Map([[stockedMonastery.id, stockedMonastery]]);
const emptySignatures = buildingMarkerSignatures(emptyMap);
const stockedSignatures = buildingMarkerSignatures(stockedMap);
assert.notEqual(emptySignatures.visual, stockedSignatures.visual);
assert.equal(
  emptySignatures.collider,
  stockedSignatures.collider,
  'pantry bands must never rebuild first-person colliders',
);
assert.match(monasteryStockpileVisualSignature(stockedMonastery), /:monastery-pantry:2:2:2:2$/);

const performanceStarted = performance.now();
let visualChecksum = 0;
for (let index = 0; index < 100_000; index += 1) {
  visualChecksum += monasteryStockpileVisualSignature(building({
    constructionComplete: true,
    food: index % 320,
    ale: index % 160,
    honey: index % 160,
    wine: index % 120,
  })).length;
}
const performanceElapsed = performance.now() - performanceStarted;
assert.ok(visualChecksum > 0);
assert.ok(
  performanceElapsed < 250,
  `100k monastery pantry signatures regressed (${performanceElapsed.toFixed(1)} ms)`,
);

const largeParishRoads = new RoadNetwork();
for (let x = 0; x < 2_000; x += 100) {
  largeParishRoads.addRoadPath([
    new THREE.Vector3(x, 0, 0),
    new THREE.Vector3(x + 100, 0, 0),
  ]);
}
const largeParishHomes = Array.from({ length: 1_000 }, (_, index) =>
  residence({
    id: `large-parish-home-${index}`,
    x: 2 + (index % 990) * 2,
    z: 0,
  }),
);
const largeParishChapels = Array.from({ length: 10 }, (_, index) =>
  building({
    id: `large-parish-chapel-${index}`,
    kind: 'chapel',
    x: 50 + index * 200,
    z: 0,
    assignedLabor: 1,
  }),
);
const largeParishMonasteries = Array.from({ length: 40 }, (_, index) =>
  building({
    id: `large-parish-monastery-${index}`,
    kind: 'monastery',
    x: 25 + index * 48,
    z: 0,
  }),
);
const territoryStarted = performance.now();
const largeCommunityClaims = claimResidenceCommunityLandmarks(
  largeParishRoads,
  largeParishHomes,
  largeParishChapels,
  largeParishMonasteries,
);
const territoryElapsed = performance.now() - territoryStarted;
assert.equal(largeCommunityClaims.chapels.size, largeParishHomes.length);
assert.equal(largeCommunityClaims.monasteries.size, largeParishHomes.length);
assert.ok(
  territoryElapsed < 1_000,
  `1,000-home/40-monastery territory planning regressed (${territoryElapsed.toFixed(1)} ms)`,
);

console.log(
  `monastery polish tests passed (${performanceElapsed.toFixed(1)} ms for 100k pantry signatures; ${territoryElapsed.toFixed(1)} ms for 1,000-home/40-monastery territories)`,
);
