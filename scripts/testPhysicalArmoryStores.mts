import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import {
  armoryStockpileVisualSignature,
  CARPENTER_IRONWORK_VISUAL_SEGMENTS,
  CARPENTER_POLEARM_VISUAL_SEGMENTS,
  CARPENTER_TIMBER_VISUAL_SEGMENTS,
  GUARDHOUSE_FOOD_VISUAL_SEGMENTS,
  GUARDHOUSE_POLEARM_VISUAL_SEGMENTS,
  syncArmoryStockpileVisuals,
} from '../src/buildings/armoryStockpileVisuals.ts';
import { createBuildingMesh } from '../src/buildings/BuildingMeshes.ts';
import { buildingMarkerSignatures } from '../src/buildings/buildingMarkerSignature.ts';
import type { BuildingKind, BuildingState } from '../src/resources/types.ts';

const stockGroups = [
  [
    'carpenter',
    'CarpenterTimberStockpile',
    'CarpenterTimberSegment',
    CARPENTER_TIMBER_VISUAL_SEGMENTS,
  ],
  [
    'carpenter',
    'CarpenterIronworkStockpile',
    'CarpenterIronworkSegment',
    CARPENTER_IRONWORK_VISUAL_SEGMENTS,
  ],
  [
    'carpenter',
    'CarpenterPolearmStockpile',
    'CarpenterPolearmSegment',
    CARPENTER_POLEARM_VISUAL_SEGMENTS,
  ],
  [
    'guardhouse',
    'GuardhouseFoodStockpile',
    'GuardhouseFoodSegment',
    GUARDHOUSE_FOOD_VISUAL_SEGMENTS,
  ],
  [
    'guardhouse',
    'GuardhousePolearmStockpile',
    'GuardhousePolearmSegment',
    GUARDHOUSE_POLEARM_VISUAL_SEGMENTS,
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

const carpenterMarker = createBuildingMesh('carpenter');
syncArmoryStockpileVisuals(
  carpenterMarker,
  building('carpenter', {
    timber: 29,
    ironwork: 13,
    polearms: 9,
  }),
);
assertVisibleSegments(
  carpenterMarker,
  'CarpenterTimberStockpile',
  'CarpenterTimberSegment',
  4,
);
assertVisibleSegments(
  carpenterMarker,
  'CarpenterIronworkStockpile',
  'CarpenterIronworkSegment',
  2,
);
assertVisibleSegments(
  carpenterMarker,
  'CarpenterPolearmStockpile',
  'CarpenterPolearmSegment',
  3,
);

const guardhouseMarker = createBuildingMesh('guardhouse');
syncArmoryStockpileVisuals(
  guardhouseMarker,
  building('guardhouse', { meat: 60, polearms: 50 }),
);
assertVisibleSegments(
  guardhouseMarker,
  'GuardhouseFoodStockpile',
  'GuardhouseFoodSegment',
  2,
);
assertVisibleSegments(
  guardhouseMarker,
  'GuardhousePolearmStockpile',
  'GuardhousePolearmSegment',
  3,
);
syncArmoryStockpileVisuals(
  guardhouseMarker,
  building('guardhouse', { meat: 60, polearms: 50 }),
  30,
);
assertVisibleSegments(
  guardhouseMarker,
  'GuardhousePolearmStockpile',
  'GuardhousePolearmSegment',
  1,
);
syncArmoryStockpileVisuals(guardhouseMarker, building('guardhouse'));
assertVisibleSegments(
  guardhouseMarker,
  'GuardhouseFoodStockpile',
  'GuardhouseFoodSegment',
  0,
);
assertVisibleSegments(
  guardhouseMarker,
  'GuardhousePolearmStockpile',
  'GuardhousePolearmSegment',
  0,
);

const emptyGuardhouse = building('guardhouse');
const firstWeaponBand = building('guardhouse', { polearms: 1 });
const sameWeaponBand = building('guardhouse', { polearms: 19.9 });
const secondWeaponBand = building('guardhouse', { polearms: 20.1 });
const emptySignatures = buildingMarkerSignatures(
  new Map([[emptyGuardhouse.id, emptyGuardhouse]]),
);
const firstSignatures = buildingMarkerSignatures(
  new Map([[firstWeaponBand.id, firstWeaponBand]]),
);
assert.notEqual(firstSignatures.visual, emptySignatures.visual);
assert.equal(firstSignatures.collider, emptySignatures.collider);
assert.equal(
  buildingMarkerSignatures(new Map([[sameWeaponBand.id, sameWeaponBand]])).visual,
  firstSignatures.visual,
  'weapon changes inside one rack band must not resync the marker',
);
assert.notEqual(
  buildingMarkerSignatures(new Map([[secondWeaponBand.id, secondWeaponBand]])).visual,
  firstSignatures.visual,
  'crossing a weapon band must resync the marker',
);
assert.equal(
  buildingMarkerSignatures(
    new Map([[firstWeaponBand.id, firstWeaponBand]]),
    undefined,
    new Map([[firstWeaponBand.id, 1]]),
  ).visual,
  emptySignatures.visual,
  'a polearm carried by a deployed guard must disappear from the physical rack',
);

const perfBuildings = Array.from({ length: 100_000 }, (_, index) => {
  const kind = index % 2 === 0 ? 'carpenter' : 'guardhouse';
  return building(kind, {
    timber: index % 141,
    food: index % 73,
    ironwork: index % 19,
    polearms: index % 25,
  });
});
const started = performance.now();
let signatureLength = 0;
for (const stockBuilding of perfBuildings) {
  signatureLength += armoryStockpileVisualSignature(stockBuilding).length;
}
const elapsed = performance.now() - started;
assert.ok(signatureLength > 0);
assert.ok(
  elapsed < 250,
  `100,000 armory-stock visual signatures took ${elapsed.toFixed(1)} ms`,
);

console.log(
  `Physical armory-store visual tests passed (${elapsed.toFixed(1)} ms / 100k signatures).`,
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
  stocks: Partial<Pick<
    BuildingState,
    'timber' | 'food' | 'meat' | 'ironwork' | 'polearms'
  >> = {},
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
    ironwork: 0,
    polearms: 0,
    ...stocks,
  } as BuildingState;
}
