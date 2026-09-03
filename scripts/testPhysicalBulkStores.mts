import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import {
  bulkStockpileVisualSignature,
  LARGE_QUARRY_SUPPORT_VISUAL_CAPACITY,
  LARGE_QUARRY_SUPPORT_VISUAL_SEGMENTS,
  LARGE_QUARRY_STONE_VISUAL_SEGMENTS,
  MINE_CLAY_VISUAL_SEGMENTS,
  MINE_IRON_VISUAL_SEGMENTS,
  MINE_SALT_VISUAL_SEGMENTS,
  MINING_PIT_CLAY_VISUAL_SEGMENTS,
  MINING_PIT_IRON_VISUAL_SEGMENTS,
  MINING_PIT_SALT_VISUAL_SEGMENTS,
  STONE_QUARRY_STONE_VISUAL_SEGMENTS,
  syncBulkStockpileVisuals,
  WOODCUTTERS_FIREWOOD_VISUAL_SEGMENTS,
} from '../src/buildings/bulkStockpileVisuals.ts';
import { createBuildingMesh } from '../src/buildings/BuildingMeshes.ts';
import { buildingMarkerSignatures } from '../src/buildings/buildingMarkerSignature.ts';
import { batchCompletedBuildingStaticMeshes } from '../src/buildings/staticBuildingBatch.ts';
import { BuildingStaticBatches } from '../src/buildings/BuildingStaticBatches.ts';
import type { BuildingKind, BuildingState } from '../src/resources/types.ts';

const stockGroups = [
  [
    'woodcutters_lodge',
    'WoodcuttersFirewoodStockpile',
    'WoodcuttersFirewoodSegment',
    WOODCUTTERS_FIREWOOD_VISUAL_SEGMENTS,
  ],
  [
    'stone_quarry',
    'StoneQuarryStockpile',
    'StoneQuarryStockSegment',
    STONE_QUARRY_STONE_VISUAL_SEGMENTS,
  ],
  [
    'stone_quarry',
    'MiningPitIronStockpile',
    'MiningPitIronSegment',
    MINING_PIT_IRON_VISUAL_SEGMENTS,
  ],
  [
    'stone_quarry',
    'MiningPitSaltStockpile',
    'MiningPitSaltSegment',
    MINING_PIT_SALT_VISUAL_SEGMENTS,
  ],
  [
    'stone_quarry',
    'MiningPitClayStockpile',
    'MiningPitClaySegment',
    MINING_PIT_CLAY_VISUAL_SEGMENTS,
  ],
  [
    'large_quarry',
    'LargeQuarryStockpile',
    'LargeQuarryStockSegment',
    LARGE_QUARRY_STONE_VISUAL_SEGMENTS,
  ],
  [
    'large_quarry',
    'LargeQuarrySupportStockpile',
    'LargeQuarrySupportSegment',
    LARGE_QUARRY_SUPPORT_VISUAL_SEGMENTS,
  ],
  [
    'mine',
    'IronMineStockpile',
    'IronMineOreSegment',
    MINE_IRON_VISUAL_SEGMENTS,
  ],
  [
    'mine',
    'SaltMineStockpile',
    'SaltMineSaltSegment',
    MINE_SALT_VISUAL_SEGMENTS,
  ],
  [
    'mine',
    'ClayMineStockpile',
    'ClayMineClaySegment',
    MINE_CLAY_VISUAL_SEGMENTS,
  ],
] as const;

for (const [kind, containerName, segmentName, segmentCount] of stockGroups) {
  const marker = createBuildingMesh(kind);
  const stockpile = marker.getObjectByName(containerName);
  assert.ok(stockpile instanceof THREE.Group, `${kind} must expose ${containerName}`);
  assert.equal(stockpile.visible, false, `${containerName} must begin empty`);
  assert.equal(
    stockpile.children.filter((child) => child.name === segmentName).length,
    segmentCount,
    `${containerName} must expose its configured visual capacity`,
  );
}

const lodgeMarker = createBuildingMesh('woodcutters_lodge');
const lodgeFirewood = lodgeMarker.getObjectByName('WoodcuttersFirewoodStockpile');
assert.ok(lodgeFirewood instanceof THREE.Group);
const rearBounds = new THREE.Box3().setFromObject(lodgeFirewood);
assert.ok(rearBounds.max.z < -2.95, 'firewood must sit entirely behind the lodge rear wall');
assert.ok(Math.abs(rearBounds.min.y) < 0.02, 'firewood must rest on the ground');
const lodgeLogs: THREE.Mesh[] = [];
lodgeFirewood.traverse((object) => {
  if (object instanceof THREE.Mesh) lodgeLogs.push(object);
});
assert.equal(lodgeLogs.length, 24, 'four procedural three-row piles must contain 24 logs');

// Exercise the same retained dynamic subtree used by completed in-game buildings.
batchCompletedBuildingStaticMeshes(lodgeMarker);
const lodgeScene = new THREE.Group();
lodgeScene.add(lodgeMarker);
const lodgeStaticBatches = new BuildingStaticBatches(lodgeScene);
lodgeStaticBatches.registerBuilding('woodcutters_lodge-1', lodgeMarker);
for (const [firewood, expected] of [
  [0, 0], [1, 1], [12, 1], [13, 2], [25, 2], [26, 3], [37, 3],
  [38, 4], [50, 4], [31, 3], [13, 2], [1, 1], [0, 0],
] as const) {
  syncBulkStockpileVisuals(lodgeMarker, building('woodcutters_lodge', { firewood }));
  assertVisibleSegments(
    lodgeMarker,
    'WoodcuttersFirewoodStockpile',
    'WoodcuttersFirewoodSegment',
    expected,
  );
  let visibleLogs = 0;
  lodgeFirewood.traverseVisible((object) => {
    if (object instanceof THREE.Mesh) visibleLogs += 1;
  });
  assert.equal(visibleLogs, expected * 6, `${firewood} firewood must update rendered logs after batching`);
}
lodgeStaticBatches.dispose();

const quarryMarker = createBuildingMesh('stone_quarry');
assert.equal(quarryMarker.name, 'Mining Camp');
assert.equal(
  quarryMarker.userData.semanticRole,
  'general-surface-extraction-camp',
);
assert.equal(
  quarryMarker.userData.silhouette,
  'day-work-shelter-and-sorting-yard',
);
assert.equal(quarryMarker.userData.centeredResourceRequired, false);
assert.deepEqual(
  quarryMarker.userData.extractionResources,
  ['stone', 'iron', 'salt', 'clay'],
);
assert.equal(
  quarryMarker.userData.architectureDiagnostics?.centeredExcavationCount,
  0,
  'the Mining Camp must not compile a centered pit or deep-extraction silhouette',
);
for (const moduleName of [
  'MiningCampDayShelter',
  'MiningCampSortingCanopy',
  'MiningCampSortingYard',
  'MiningCampHandcart',
  'MiningCampToolRack',
  'MiningCampSurveyStakes',
] as const) {
  assert.ok(
    quarryMarker.getObjectByName(moduleName),
    `the Mining Camp must expose its ${moduleName} visual module`,
  );
}
assert.equal(
  quarryMarker.getObjectByName('MiningPitDerrick'),
  undefined,
  'the former centered lifting-pit mechanism must not survive in the Mining Camp mesh',
);
const miningCampBounds = new THREE.Box3().setFromObject(quarryMarker);
assert.ok(
  miningCampBounds.max.y < 5.2,
  `the Mining Camp must retain a low camp silhouette, got ${miningCampBounds.max.y.toFixed(2)} m`,
);
syncBulkStockpileVisuals(quarryMarker, building('stone_quarry', { stone: 31 }));
assertVisibleSegments(
  quarryMarker,
  'StoneQuarryStockpile',
  'StoneQuarryStockSegment',
  2,
);
syncBulkStockpileVisuals(
  quarryMarker,
  building('stone_quarry', { iron: 31, salt: 1, clay: 41 }),
);
assertVisibleSegments(
  quarryMarker,
  'MiningPitIronStockpile',
  'MiningPitIronSegment',
  2,
);
assertVisibleSegments(
  quarryMarker,
  'MiningPitSaltStockpile',
  'MiningPitSaltSegment',
  1,
);
assertVisibleSegments(
  quarryMarker,
  'MiningPitClayStockpile',
  'MiningPitClaySegment',
  3,
);

const mineMarker = createBuildingMesh('mine');
syncBulkStockpileVisuals(mineMarker, building('mine', { clay: 31 }));
assertVisibleSegments(
  mineMarker,
  'ClayMineStockpile',
  'ClayMineClaySegment',
  3,
);

const emptyMiningPitSignature = bulkStockpileVisualSignature(
  building('stone_quarry'),
);
for (const stock of [{ iron: 1 }, { salt: 1 }, { clay: 1 }]) {
  assert.notEqual(
    bulkStockpileVisualSignature(building('stone_quarry', stock)),
    emptyMiningPitSignature,
    'each Mining Camp commodity must independently refresh its inventory visuals',
  );
}
assert.notEqual(
  bulkStockpileVisualSignature(building('mine', { clay: 1 })),
  bulkStockpileVisualSignature(building('mine')),
  'Mineworks clay inventory must participate in the visual signature',
);

const largeQuarryMarker = createBuildingMesh('large_quarry');
syncBulkStockpileVisuals(
  largeQuarryMarker,
  building('large_quarry', { stone: 51 }),
);
assertVisibleSegments(
  largeQuarryMarker,
  'LargeQuarryStockpile',
  'LargeQuarryStockSegment',
  3,
);
syncBulkStockpileVisuals(largeQuarryMarker, building('large_quarry'));
assertVisibleSegments(
  largeQuarryMarker,
  'LargeQuarryStockpile',
  'LargeQuarryStockSegment',
  0,
);
syncBulkStockpileVisuals(
  largeQuarryMarker,
  building('large_quarry', { timber: 0.25 }),
);
assertVisibleSegments(
  largeQuarryMarker,
  'LargeQuarrySupportStockpile',
  'LargeQuarrySupportSegment',
  1,
);
syncBulkStockpileVisuals(
  largeQuarryMarker,
  building('large_quarry', { timber: LARGE_QUARRY_SUPPORT_VISUAL_CAPACITY }),
);
assertVisibleSegments(
  largeQuarryMarker,
  'LargeQuarrySupportStockpile',
  'LargeQuarrySupportSegment',
  6,
);

const emptyLodge = building('woodcutters_lodge');
const firstFirewoodBand = building('woodcutters_lodge', { firewood: 1 });
const sameFirewoodBand = building('woodcutters_lodge', { firewood: 12 });
const secondFirewoodBand = building('woodcutters_lodge', { firewood: 13 });
const emptySignatures = buildingMarkerSignatures(new Map([[emptyLodge.id, emptyLodge]]));
const firstSignatures = buildingMarkerSignatures(
  new Map([[firstFirewoodBand.id, firstFirewoodBand]]),
);
assert.notEqual(firstSignatures.visual, emptySignatures.visual);
assert.equal(firstSignatures.collider, emptySignatures.collider);
assert.equal(
  buildingMarkerSignatures(new Map([[sameFirewoodBand.id, sameFirewoodBand]])).visual,
  firstSignatures.visual,
  'small stock changes inside one firewood band must not resync the marker',
);
assert.notEqual(
  buildingMarkerSignatures(new Map([[secondFirewoodBand.id, secondFirewoodBand]])).visual,
  firstSignatures.visual,
  'crossing a firewood band must resync the marker',
);

const perfBuildings = Array.from({ length: 100_000 }, (_, index) => {
  const kinds = ['woodcutters_lodge', 'stone_quarry', 'large_quarry'] as const;
  return building(kinds[index % kinds.length], {
    firewood: index % 121,
    stone: index % 361,
  });
});
const started = performance.now();
let signatureLength = 0;
for (const stockBuilding of perfBuildings) {
  signatureLength += bulkStockpileVisualSignature(stockBuilding).length;
}
const elapsed = performance.now() - started;
assert.ok(signatureLength > 0);
assert.ok(
  elapsed < 250,
  `100,000 bulk-stock visual signatures took ${elapsed.toFixed(1)} ms`,
);

console.log(
  `Physical bulk-store visual tests passed (${elapsed.toFixed(1)} ms / 100k signatures).`,
);

function assertVisibleSegments(
  marker: THREE.Group,
  containerName: string,
  segmentName: string,
  expected: number,
): void {
  const stockpile = marker.getObjectByName(containerName);
  assert.ok(stockpile instanceof THREE.Group);
  assert.equal(stockpile.visible, expected > 0);
  assert.equal(
    stockpile.children.filter(
      (child) => child.name === segmentName && child.visible,
    ).length,
    expected,
  );
}

function building(
  kind: BuildingKind,
  stocks: Partial<
    Pick<BuildingState, 'firewood' | 'stone' | 'timber' | 'iron' | 'salt' | 'clay'>
  > = {},
): BuildingState {
  return {
    id: `${kind}-1`,
    kind,
    x: 0,
    z: 0,
    constructionComplete: true,
    timber: 0,
    stone: 0,
    water: 0,
    food: 0,
    grain: 0,
    flour: 0,
    ale: 0,
    preservedFood: 0,
    honey: 0,
    wine: 0,
    firewood: 0,
    ...stocks,
  } as BuildingState;
}
