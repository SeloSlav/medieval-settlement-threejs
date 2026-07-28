import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import {
  seasonalStockpileVisualSignature,
  APIARY_FOOD_VISUAL_SEGMENTS,
  APIARY_HONEY_VISUAL_SEGMENTS,
  THRESHING_GRAIN_VISUAL_SEGMENTS,
  VINEYARD_FOOD_VISUAL_SEGMENTS,
  VINEYARD_WINE_VISUAL_SEGMENTS,
  syncSeasonalStockpileVisuals,
} from '../src/buildings/seasonalStockpileVisuals.ts';
import { createBuildingMesh } from '../src/buildings/BuildingMeshes.ts';
import { buildingMarkerSignatures } from '../src/buildings/buildingMarkerSignature.ts';
import { seasonalProducerOutputBlocker } from '../src/economy/specialtyTrade.ts';
import {
  APIARY_FOOD_PER_CYCLE,
  APIARY_HONEY_PER_CYCLE,
  BUILDING_STORAGE_CAPS,
  VINEYARD_FOOD_PER_CYCLE,
  VINEYARD_WINE_PER_CYCLE,
} from '../src/generated/gameBalance.ts';
import type { BuildingKind, BuildingState } from '../src/resources/types.ts';

const stockGroups = [
  [
    'threshing_barn',
    'ThreshingGrainStockpile',
    'ThreshingGrainSegment',
    THRESHING_GRAIN_VISUAL_SEGMENTS,
  ],
  [
    'apiary',
    'ApiaryFoodStockpile',
    'ApiaryFoodSegment',
    APIARY_FOOD_VISUAL_SEGMENTS,
  ],
  [
    'apiary',
    'ApiaryHoneyStockpile',
    'ApiaryHoneySegment',
    APIARY_HONEY_VISUAL_SEGMENTS,
  ],
  [
    'vineyard',
    'VineyardFoodStockpile',
    'VineyardFoodSegment',
    VINEYARD_FOOD_VISUAL_SEGMENTS,
  ],
  [
    'vineyard',
    'VineyardWineStockpile',
    'VineyardWineSegment',
    VINEYARD_WINE_VISUAL_SEGMENTS,
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

const threshingMarker = createBuildingMesh('threshing_barn');
syncSeasonalStockpileVisuals(
  threshingMarker,
  building('threshing_barn', { grain: 150, barley: 100 }),
);
assertVisibleSegments(
  threshingMarker,
  'ThreshingGrainStockpile',
  'ThreshingGrainSegment',
  3,
);

const apiaryMarker = createBuildingMesh('apiary');
syncSeasonalStockpileVisuals(
  apiaryMarker,
  building('apiary', { food: 21, honey: 47 }),
);
assertVisibleSegments(apiaryMarker, 'ApiaryFoodStockpile', 'ApiaryFoodSegment', 2);
assertVisibleSegments(apiaryMarker, 'ApiaryHoneyStockpile', 'ApiaryHoneySegment', 2);

const vineyardMarker = createBuildingMesh('vineyard');
syncSeasonalStockpileVisuals(
  vineyardMarker,
  building('vineyard', { food: 1, wine: 91 }),
);
assertVisibleSegments(vineyardMarker, 'VineyardFoodStockpile', 'VineyardFoodSegment', 1);
assertVisibleSegments(vineyardMarker, 'VineyardWineStockpile', 'VineyardWineSegment', 2);
syncSeasonalStockpileVisuals(vineyardMarker, building('vineyard'));
assertVisibleSegments(vineyardMarker, 'VineyardFoodStockpile', 'VineyardFoodSegment', 0);
assertVisibleSegments(vineyardMarker, 'VineyardWineStockpile', 'VineyardWineSegment', 0);

assert.equal(
  seasonalProducerOutputBlocker(building('apiary', {
    honey: BUILDING_STORAGE_CAPS.apiary.honey - APIARY_HONEY_PER_CYCLE,
    food: BUILDING_STORAGE_CAPS.apiary.food - APIARY_FOOD_PER_CYCLE,
  })),
  null,
  'an exact whole apiary batch must fit',
);
const honeyBlocked = seasonalProducerOutputBlocker(building('apiary', {
  honey: BUILDING_STORAGE_CAPS.apiary.honey - APIARY_HONEY_PER_CYCLE + 0.1,
}));
assert.equal(honeyBlocked?.commodity, 'honey');
assert.ok(Math.abs((honeyBlocked?.missingRoom ?? 0) - 0.1) < 1e-9);

const apiaryFoodBlocked = seasonalProducerOutputBlocker(building('apiary', {
  honey: 0,
  food: BUILDING_STORAGE_CAPS.apiary.food - APIARY_FOOD_PER_CYCLE + 0.1,
}));
assert.equal(apiaryFoodBlocked?.commodity, 'food');

assert.equal(
  seasonalProducerOutputBlocker(building('vineyard', {
    wine: BUILDING_STORAGE_CAPS.vineyard.wine - VINEYARD_WINE_PER_CYCLE,
    food: BUILDING_STORAGE_CAPS.vineyard.food - VINEYARD_FOOD_PER_CYCLE,
  })),
  null,
  'an exact whole vineyard batch must fit',
);
assert.equal(
  seasonalProducerOutputBlocker(building('vineyard', {
    wine: BUILDING_STORAGE_CAPS.vineyard.wine - VINEYARD_WINE_PER_CYCLE + 0.1,
  }))?.commodity,
  'wine',
);

const firstHoneyBand = building('apiary', { honey: 1 });
const sameHoneyBand = building('apiary', { honey: 46 });
const secondHoneyBand = building('apiary', { honey: 47 });
const firstSignatures = buildingMarkerSignatures(
  new Map([[firstHoneyBand.id, firstHoneyBand]]),
);
assert.equal(
  buildingMarkerSignatures(new Map([[sameHoneyBand.id, sameHoneyBand]])).visual,
  firstSignatures.visual,
  'stock changes inside one honey band must not resync the marker',
);
const secondSignatures = buildingMarkerSignatures(
  new Map([[secondHoneyBand.id, secondHoneyBand]]),
);
assert.notEqual(secondSignatures.visual, firstSignatures.visual);
assert.equal(secondSignatures.collider, firstSignatures.collider);

const serverSimulation = readFileSync(
  new URL('../server/src/simulation/expanded_economy.rs', import.meta.url),
  'utf8',
);
assert.match(
  serverSimulation,
  /if !producer_output_batch_fits[\s\S]{0,500}return building;[\s\S]{0,200}cycle_labor_if_ready/,
  'seasonal output room must be checked before consuming a completed work cycle',
);

const perfBuilding = building('apiary');
const started = performance.now();
let checksum = 0;
for (let index = 0; index < 100_000; index += 1) {
  perfBuilding.food = index % 41;
  perfBuilding.honey = index % 141;
  checksum += seasonalStockpileVisualSignature(perfBuilding).length;
  checksum += seasonalProducerOutputBlocker(perfBuilding)?.missingRoom ?? 0;
}
const elapsed = performance.now() - started;
assert.ok(checksum > 0);
assert.ok(
  elapsed < 250,
  `100,000 seasonal storage projections took ${elapsed.toFixed(1)} ms`,
);

console.log(
  `Seasonal harvest backpressure and physical-store tests passed (${elapsed.toFixed(1)} ms / 100k projections).`,
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
    'food' | 'grain' | 'honey' | 'wine'
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
    assignedLabor: 1,
    ...stocks,
  } as BuildingState;
}
