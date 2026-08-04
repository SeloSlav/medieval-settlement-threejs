import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import { createBuildingMesh } from '../src/buildings/BuildingMeshes.ts';
import { buildingMarkerSignatures } from '../src/buildings/buildingMarkerSignature.ts';
import {
  BREWERY_ALE_VISUAL_SEGMENTS,
  BREWERY_BARLEY_VISUAL_SEGMENTS,
  BREWERY_MALT_VISUAL_SEGMENTS,
  FISHING_FOOD_VISUAL_SEGMENTS,
  FORAGERS_FOOD_VISUAL_SEGMENTS,
  foodStockpileVisualSignature,
  GRANARY_GRAIN_VISUAL_SEGMENTS,
  GRANARY_PROVISION_VISUAL_SEGMENTS,
  HUNTERS_FOOD_VISUAL_SEGMENTS,
  SMOKEHOUSE_FIREWOOD_VISUAL_SEGMENTS,
  SMOKEHOUSE_FRESH_FOOD_VISUAL_SEGMENTS,
  SMOKEHOUSE_POTTERY_VISUAL_SEGMENTS,
  SMOKEHOUSE_PRESERVED_FOOD_VISUAL_SEGMENTS,
  SMOKEHOUSE_SALT_VISUAL_SEGMENTS,
  syncFoodStockpileVisuals,
  WATERMILL_FLOUR_VISUAL_SEGMENTS,
  WATERMILL_GRAIN_VISUAL_SEGMENTS,
} from '../src/buildings/foodStockpileVisuals.ts';
import type { BuildingKind, BuildingState } from '../src/resources/types.ts';

type StockGroupExpectation = readonly [
  kind: BuildingKind,
  containerName: string,
  segmentName: string,
  segmentCount: number,
];

const stockGroups: readonly StockGroupExpectation[] = [
  ['hunters_hall', 'HuntersFoodStockpile', 'HuntersFoodSegment', HUNTERS_FOOD_VISUAL_SEGMENTS],
  ['foragers_shed', 'ForagersFoodStockpile', 'ForagersFoodSegment', FORAGERS_FOOD_VISUAL_SEGMENTS],
  ['fishing_camp', 'FishingFoodStockpile', 'FishingFoodSegment', FISHING_FOOD_VISUAL_SEGMENTS],
  ['brewery', 'BreweryBarleyStockpile', 'BreweryBarleySegment', BREWERY_BARLEY_VISUAL_SEGMENTS],
  ['brewery', 'BreweryMaltStockpile', 'BreweryMaltSegment', BREWERY_MALT_VISUAL_SEGMENTS],
  ['brewery', 'BreweryAleStockpile', 'BreweryAleSegment', BREWERY_ALE_VISUAL_SEGMENTS],
  ['smokehouse', 'SmokehouseFirewoodStockpile', 'SmokehouseFirewoodSegment', SMOKEHOUSE_FIREWOOD_VISUAL_SEGMENTS],
  ['smokehouse', 'SmokehouseFreshFoodStockpile', 'SmokehouseFreshFoodSegment', SMOKEHOUSE_FRESH_FOOD_VISUAL_SEGMENTS],
  ['smokehouse', 'SmokehouseSaltStockpile', 'SmokehouseSaltSegment', SMOKEHOUSE_SALT_VISUAL_SEGMENTS],
  ['smokehouse', 'SmokehousePotteryStockpile', 'SmokehousePotterySegment', SMOKEHOUSE_POTTERY_VISUAL_SEGMENTS],
  ['smokehouse', 'SmokehousePreservedFoodStockpile', 'SmokehousePreservedFoodSegment', SMOKEHOUSE_PRESERVED_FOOD_VISUAL_SEGMENTS],
  ['granary', 'GranaryGrainStockpile', 'GranaryGrainSegment', GRANARY_GRAIN_VISUAL_SEGMENTS],
  ['granary', 'GranaryProvisionStockpile', 'GranaryProvisionSegment', GRANARY_PROVISION_VISUAL_SEGMENTS],
  ['watermill', 'WatermillGrainStockpile', 'WatermillGrainSegment', WATERMILL_GRAIN_VISUAL_SEGMENTS],
  ['watermill', 'WatermillFlourStockpile', 'WatermillFlourSegment', WATERMILL_FLOUR_VISUAL_SEGMENTS],
];

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

const supplierExpectations = [
  ['hunters_hall', 'HuntersFoodStockpile', 'HuntersFoodSegment', 51, 3],
  ['foragers_shed', 'ForagersFoodStockpile', 'ForagersFoodSegment', 41, 3],
  ['fishing_camp', 'FishingFoodStockpile', 'FishingFoodSegment', 81, 3],
] as const;
for (const [kind, containerName, segmentName, food, expected] of supplierExpectations) {
  const marker = createBuildingMesh(kind);
  syncFoodStockpileVisuals(marker, building(kind, { food }));
  assertVisibleSegments(marker, containerName, segmentName, expected);
  syncFoodStockpileVisuals(marker, building(kind));
  assertVisibleSegments(marker, containerName, segmentName, 0);
}

const brewery = building('brewery', { barley: 71, malt: 13, ale: 67 });
const breweryMarker = createBuildingMesh('brewery');
syncFoodStockpileVisuals(breweryMarker, brewery);
assertVisibleSegments(breweryMarker, 'BreweryBarleyStockpile', 'BreweryBarleySegment', 2);
assertVisibleSegments(breweryMarker, 'BreweryMaltStockpile', 'BreweryMaltSegment', 1);
assertVisibleSegments(breweryMarker, 'BreweryAleStockpile', 'BreweryAleSegment', 2);

const smokehouse = building('smokehouse', {
  firewood: 14,
  food: 61,
  preservedFood: 61,
  salt: 14,
  pottery: 5,
});
const smokehouseMarker = createBuildingMesh('smokehouse');
syncFoodStockpileVisuals(smokehouseMarker, smokehouse);
assertVisibleSegments(
  smokehouseMarker,
  'SmokehouseFirewoodStockpile',
  'SmokehouseFirewoodSegment',
  2,
);
assertVisibleSegments(
  smokehouseMarker,
  'SmokehouseFreshFoodStockpile',
  'SmokehouseFreshFoodSegment',
  2,
);
assertVisibleSegments(
  smokehouseMarker,
  'SmokehouseSaltStockpile',
  'SmokehouseSaltSegment',
  2,
);
assertVisibleSegments(
  smokehouseMarker,
  'SmokehousePotteryStockpile',
  'SmokehousePotterySegment',
  2,
);
assertVisibleSegments(
  smokehouseMarker,
  'SmokehousePreservedFoodStockpile',
  'SmokehousePreservedFoodSegment',
  2,
);
assert.notEqual(
  foodStockpileVisualSignature(building('smokehouse', { salt: 1 })),
  foodStockpileVisualSignature(building('smokehouse')),
  'the first salt sack must invalidate the smokehouse visual signature',
);
assert.notEqual(
  foodStockpileVisualSignature(building('smokehouse', { pottery: 1 })),
  foodStockpileVisualSignature(building('smokehouse')),
  'the first preservation vessel must invalidate the smokehouse visual signature',
);

const granary = building('granary', {
  grain: 141,
  barley: 160,
  flour: 130,
  flax: 90,
  food: 261,
  preservedFood: 50,
});
const granaryMarker = createBuildingMesh('granary');
syncFoodStockpileVisuals(granaryMarker, granary);
assertVisibleSegments(granaryMarker, 'GranaryGrainStockpile', 'GranaryGrainSegment', 2);
assertVisibleSegments(granaryMarker, 'GranaryProvisionStockpile', 'GranaryProvisionSegment', 2);

const watermill = building('watermill', { grain: 61, flour: 87 });
const watermillMarker = createBuildingMesh('watermill');
syncFoodStockpileVisuals(watermillMarker, watermill);
assertVisibleSegments(watermillMarker, 'WatermillGrainStockpile', 'WatermillGrainSegment', 2);
assertVisibleSegments(watermillMarker, 'WatermillFlourStockpile', 'WatermillFlourSegment', 2);
syncFoodStockpileVisuals(watermillMarker, building('watermill'));
assertVisibleSegments(
  watermillMarker,
  'WatermillGrainStockpile',
  'WatermillGrainSegment',
  0,
);
assertVisibleSegments(
  watermillMarker,
  'WatermillFlourStockpile',
  'WatermillFlourSegment',
  0,
);

const emptyGranary = building('granary');
const firstGrainSack = building('granary', { grain: 1 });
const sameGrainBand = building('granary', { grain: 100 });
const secondGrainBand = building('granary', { grain: 201 });
const emptySignatures = buildingMarkerSignatures(
  new Map([[emptyGranary.id, emptyGranary]]),
);
const firstSignatures = buildingMarkerSignatures(
  new Map([[firstGrainSack.id, firstGrainSack]]),
);
assert.notEqual(firstSignatures.visual, emptySignatures.visual);
assert.equal(firstSignatures.collider, emptySignatures.collider);
assert.equal(
  buildingMarkerSignatures(new Map([[sameGrainBand.id, sameGrainBand]])).visual,
  firstSignatures.visual,
  'small inventory changes inside one sack band must not resync the marker',
);
assert.notEqual(
  buildingMarkerSignatures(new Map([[secondGrainBand.id, secondGrainBand]])).visual,
  firstSignatures.visual,
  'crossing an inventory band must resync the marker',
);

const perfBuildings = Array.from({ length: 100_000 }, (_, index) => {
  const kinds = [
    'hunters_hall',
    'foragers_shed',
    'fishing_camp',
    'brewery',
    'smokehouse',
    'granary',
    'watermill',
  ] as const;
  return building(kinds[index % kinds.length], {
    grain: index % 421,
    flour: index % 261,
    food: index % 341,
    firewood: index % 61,
    ale: index % 201,
    preservedFood: index % 181,
    salt: index % 25,
    pottery: index % 13,
  });
});
const started = performance.now();
let signatureLength = 0;
for (const stockBuilding of perfBuildings) {
  signatureLength += foodStockpileVisualSignature(stockBuilding).length;
}
const elapsed = performance.now() - started;
assert.ok(signatureLength > 0);
assert.ok(
  elapsed < 250,
  `100,000 food-stock visual signatures took ${elapsed.toFixed(1)} ms`,
);

console.log(`Physical food-store visual tests passed (${elapsed.toFixed(1)} ms / 100k signatures).`);

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
    | 'grain'
    | 'flour'
    | 'flax'
    | 'food'
    | 'firewood'
    | 'ale'
    | 'preservedFood'
    | 'salt'
    | 'pottery'
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
    salt: 0,
    pottery: 0,
    ...stocks,
  } as BuildingState;
}
