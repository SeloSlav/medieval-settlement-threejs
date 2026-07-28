import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import {
  bulkStockpileVisualSignature,
  LARGE_QUARRY_STONE_VISUAL_SEGMENTS,
  STONE_QUARRY_STONE_VISUAL_SEGMENTS,
  syncBulkStockpileVisuals,
  WOODCUTTERS_FIREWOOD_VISUAL_SEGMENTS,
} from '../src/buildings/bulkStockpileVisuals.ts';
import { createBuildingMesh } from '../src/buildings/BuildingMeshes.ts';
import { buildingMarkerSignatures } from '../src/buildings/buildingMarkerSignature.ts';
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
    'large_quarry',
    'LargeQuarryStockpile',
    'LargeQuarryStockSegment',
    LARGE_QUARRY_STONE_VISUAL_SEGMENTS,
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
syncBulkStockpileVisuals(
  lodgeMarker,
  building('woodcutters_lodge', { firewood: 61 }),
);
assertVisibleSegments(
  lodgeMarker,
  'WoodcuttersFirewoodStockpile',
  'WoodcuttersFirewoodSegment',
  3,
);

const quarryMarker = createBuildingMesh('stone_quarry');
syncBulkStockpileVisuals(quarryMarker, building('stone_quarry', { stone: 61 }));
assertVisibleSegments(
  quarryMarker,
  'StoneQuarryStockpile',
  'StoneQuarryStockSegment',
  2,
);

const largeQuarryMarker = createBuildingMesh('large_quarry');
syncBulkStockpileVisuals(
  largeQuarryMarker,
  building('large_quarry', { stone: 181 }),
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

const emptyLodge = building('woodcutters_lodge');
const firstFirewoodBand = building('woodcutters_lodge', { firewood: 1 });
const sameFirewoodBand = building('woodcutters_lodge', { firewood: 30 });
const secondFirewoodBand = building('woodcutters_lodge', { firewood: 31 });
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
  stocks: Partial<Pick<BuildingState, 'firewood' | 'stone'>> = {},
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
