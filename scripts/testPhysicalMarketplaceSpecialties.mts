import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import { createBuildingMesh } from '../src/buildings/BuildingMeshes.ts';
import { buildingMarkerSignatures } from '../src/buildings/buildingMarkerSignature.ts';
import {
  MARKET_ALE_VISUAL_SEGMENTS,
  MARKET_CLOTH_VISUAL_SEGMENTS,
  MARKET_HONEY_VISUAL_SEGMENTS,
  MARKET_IRON_VISUAL_SEGMENTS,
  MARKET_POTTERY_VISUAL_SEGMENTS,
  MARKET_SALT_VISUAL_SEGMENTS,
  MARKET_WINE_VISUAL_SEGMENTS,
  marketplaceSpecialtyStockpileVisualSignature,
  syncMarketplaceSpecialtyStockpileVisuals,
} from '../src/buildings/marketplaceSpecialtyStockpileVisuals.ts';
import type { BuildingState } from '../src/resources/types.ts';

const stockGroups = [
  ['MarketAleStockpile', 'MarketAleSegment', MARKET_ALE_VISUAL_SEGMENTS],
  ['MarketHoneyStockpile', 'MarketHoneySegment', MARKET_HONEY_VISUAL_SEGMENTS],
  ['MarketWineStockpile', 'MarketWineSegment', MARKET_WINE_VISUAL_SEGMENTS],
  ['MarketClothStockpile', 'MarketClothSegment', MARKET_CLOTH_VISUAL_SEGMENTS],
  ['MarketIronStockpile', 'MarketIronSegment', MARKET_IRON_VISUAL_SEGMENTS],
  ['MarketSaltStockpile', 'MarketSaltSegment', MARKET_SALT_VISUAL_SEGMENTS],
  ['MarketPotteryStockpile', 'MarketPotterySegment', MARKET_POTTERY_VISUAL_SEGMENTS],
] as const;

const marketMarker = createBuildingMesh('marketplace');
for (const [containerName, segmentName, segmentCount] of stockGroups) {
  const stockpile = marketMarker.getObjectByName(containerName);
  assert.ok(stockpile instanceof THREE.Group, `marketplace must expose ${containerName}`);
  assert.equal(stockpile.visible, false, `${containerName} must begin empty`);
  assert.equal(
    stockpile.children.filter((child) => child.name === segmentName).length,
    segmentCount,
    `${containerName} must expose its configured visual capacity`,
  );
}

syncMarketplaceSpecialtyStockpileVisuals(
  marketMarker,
  market({ ale: 47, honey: 34, wine: 40, cloth: 80, iron: 20, salt: 30, pottery: 60 }),
);
assertVisibleSegments(marketMarker, 'MarketAleStockpile', 'MarketAleSegment', 2);
assertVisibleSegments(marketMarker, 'MarketHoneyStockpile', 'MarketHoneySegment', 2);
assertVisibleSegments(marketMarker, 'MarketWineStockpile', 'MarketWineSegment', 1);
assertVisibleSegments(marketMarker, 'MarketClothStockpile', 'MarketClothSegment', 2);
assertVisibleSegments(marketMarker, 'MarketIronStockpile', 'MarketIronSegment', 2);
assertVisibleSegments(marketMarker, 'MarketSaltStockpile', 'MarketSaltSegment', 2);
assertVisibleSegments(marketMarker, 'MarketPotteryStockpile', 'MarketPotterySegment', 2);

syncMarketplaceSpecialtyStockpileVisuals(marketMarker, market());
for (const [containerName, segmentName] of stockGroups) {
  assertVisibleSegments(marketMarker, containerName, segmentName, 0);
}

const emptyMarket = market();
const firstAleBand = market({ ale: 1 });
const sameAleBand = market({ ale: 46 });
const secondAleBand = market({ ale: 47 });
const emptySignature = buildingMarkerSignatures(
  new Map([[emptyMarket.id, emptyMarket]]),
);
const firstSignature = buildingMarkerSignatures(
  new Map([[firstAleBand.id, firstAleBand]]),
);
assert.notEqual(firstSignature.visual, emptySignature.visual);
assert.equal(firstSignature.collider, emptySignature.collider);
assert.equal(
  buildingMarkerSignatures(new Map([[sameAleBand.id, sameAleBand]])).visual,
  firstSignature.visual,
  'stock changes inside one ale band must not resync the market',
);
assert.notEqual(
  buildingMarkerSignatures(new Map([[secondAleBand.id, secondAleBand]])).visual,
  firstSignature.visual,
  'crossing an ale band must resync the market',
);

const perfMarket = market();
const started = performance.now();
let signatureLength = 0;
for (let index = 0; index < 100_000; index += 1) {
  perfMarket.ale = index % 141;
  perfMarket.honey = index % 101;
  perfMarket.wine = index % 121;
  perfMarket.cloth = index % 121;
  perfMarket.iron = index % 49;
  perfMarket.salt = index % 73;
  perfMarket.pottery = index % 97;
  signatureLength += marketplaceSpecialtyStockpileVisualSignature(perfMarket).length;
}
const elapsed = performance.now() - started;
assert.ok(signatureLength > 0);
assert.ok(
  elapsed < 250,
  `100,000 marketplace-specialty visual signatures took ${elapsed.toFixed(1)} ms`,
);

console.log(
  `Physical marketplace-specialty visual tests passed (${elapsed.toFixed(1)} ms / 100k signatures).`,
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

function market(
  stocks: Partial<Pick<
    BuildingState,
    'ale' | 'honey' | 'wine' | 'cloth' | 'iron' | 'salt' | 'pottery'
  >> = {},
): BuildingState {
  return {
    id: 'market-1',
    kind: 'marketplace',
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
    cloth: 0,
    iron: 0,
    salt: 0,
    pottery: 0,
    assignedLabor: 1,
    ...stocks,
  } as BuildingState;
}
