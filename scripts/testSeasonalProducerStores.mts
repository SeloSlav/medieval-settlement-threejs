import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import {
  seasonalStockpileVisualSignature,
  APIARY_HONEY_VISUAL_SEGMENTS,
  THRESHING_GRAIN_VISUAL_SEGMENTS,
  THRESHING_FLAX_VISUAL_SEGMENTS,
  syncSeasonalStockpileVisuals,
} from '../src/buildings/seasonalStockpileVisuals.ts';
import { PASTORAL_SALT_VISUAL_SEGMENTS } from '../src/buildings/buildingStockpileVisuals.ts';
import { createBuildingMesh } from '../src/buildings/BuildingMeshes.ts';
import { buildingMarkerSignatures } from '../src/buildings/buildingMarkerSignature.ts';
import { seasonalProducerOutputBlocker } from '../src/economy/specialtyTrade.ts';
import {
  APIARY_HONEY_PER_CYCLE,
  BUILDING_STORAGE_CAPS,
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
    'threshing_barn',
    'ThreshingFlaxStockpile',
    'ThreshingFlaxSegment',
    THRESHING_FLAX_VISUAL_SEGMENTS,
  ],
  [
    'pastoral_farmstead',
    'PastoralSaltStockpile',
    'PastoralSaltSegment',
    PASTORAL_SALT_VISUAL_SEGMENTS,
  ],
  [
    'apiary',
    'ApiaryHoneyStockpile',
    'ApiaryHoneySegment',
    APIARY_HONEY_VISUAL_SEGMENTS,
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
  building('threshing_barn', { grain: 30, barley: 10, flax: 60 }),
);
assertVisibleSegments(
  threshingMarker,
  'ThreshingGrainStockpile',
  'ThreshingGrainSegment',
  1,
);
assertVisibleSegments(
  threshingMarker,
  'ThreshingFlaxStockpile',
  'ThreshingFlaxSegment',
  3,
);

const apiaryMarker = createBuildingMesh('apiary');
syncSeasonalStockpileVisuals(
  apiaryMarker,
  building('apiary', { honey: 30 }),
);
assertVisibleSegments(apiaryMarker, 'ApiaryHoneyStockpile', 'ApiaryHoneySegment', 2);

const pastoralMarker = createBuildingMesh('pastoral_farmstead');
syncSeasonalStockpileVisuals(
  pastoralMarker,
  building('pastoral_farmstead', { salt: 3 }),
);
assertVisibleSegments(
  pastoralMarker,
  'PastoralSaltStockpile',
  'PastoralSaltSegment',
  1,
);
assert.notEqual(
  seasonalStockpileVisualSignature(building('pastoral_farmstead', { salt: 1 })),
  seasonalStockpileVisualSignature(building('pastoral_farmstead')),
  'the first farmstead salt sack must invalidate the visual signature',
);

assert.equal(
  seasonalProducerOutputBlocker(building('apiary', {
    honey: BUILDING_STORAGE_CAPS.apiary.honey
      - APIARY_HONEY_PER_CYCLE,
  })),
  null,
  'an exact whole apiary batch must fit',
);
const honeyBlocked = seasonalProducerOutputBlocker(building('apiary', {
  honey: BUILDING_STORAGE_CAPS.apiary.honey
    - APIARY_HONEY_PER_CYCLE
    + 0.1,
}));
assert.equal(honeyBlocked?.commodity, 'honey');
assert.ok(Math.abs((honeyBlocked?.missingRoom ?? 0) - 0.1) < 1e-9);

const firstHoneyBand = building('apiary', { honey: 1 });
const sameHoneyBand = building('apiary', { honey: 15 });
const secondHoneyBand = building('apiary', { honey: 16 });
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
  /producer_output_batch_fits\(outputs\.iter\(\)\.map/,
  'seasonal harvests must retain their indivisible physical-capacity check',
);
assert.ok(
  serverSimulation.indexOf('if !output_ready')
    < serverSimulation.indexOf('let Some(labor) = cycle_labor_if_ready_at_rate'),
  'seasonal output room must be checked before consuming a completed work cycle',
);
assert.match(
  serverSimulation,
  /clock\.month == 12[\s\S]*withdraw_building_commodity\(&mut building, CommodityKind::Honey, winter_honey\)[\s\S]*next_apiary_colony_health[\s\S]*apiary_last_winter_year = clock\.year/,
  'apiaries must consume physical winter honey once per year and persist the colony-health result',
);
assert.match(
  serverSimulation,
  /apiary_honey_reserve[\s\S]*?&\["brewery"\][\s\S]*?&\["marketplace"\][\s\S]*?&\["trading_post"\]/,
  'the selected hive reserve must be protected from town processing and export dispatch',
);
assert.match(
  serverSimulation,
  /advance_monastery_vineyard_fermentation[\s\S]*fermentable_grapes[\s\S]*withdraw_building_commodity\([\s\S]*CommodityKind::Grapes[\s\S]*vineyard_fermentation_progress \+= TICK_DT \* onsite_labor as f64[\s\S]*deposit_building_commodity\([\s\S]*CommodityKind::Wine/,
  'the monastery cellar must stage real grapes, accumulate monk work, and only then deposit wine',
);

const expandedInspector = readFileSync(
  new URL('../src/resources/inspector/expandedBuildingRenderer.ts', import.meta.url),
  'utf8',
);
assert.match(expandedInspector, /data-apiary-harvest-policy=/);
assert.match(expandedInspector, /data-land-parcel="vineyard"/);
assert.doesNotMatch(expandedInspector, /data-vineyard-production-policy=/);
assert.match(expandedInspector, /Forage landscape/);
assert.match(expandedInspector, /worker-seconds remain/);

const perfBuilding = building('apiary');
const started = performance.now();
let checksum = 0;
for (let index = 0; index < 100_000; index += 1) {
  perfBuilding.grapes = index % 41;
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
    'food' | 'grain' | 'barley' | 'flax' | 'honey' | 'wine' | 'salt' | 'grapes'
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
    grapes: 0,
    firewood: 0,
    salt: 0,
    assignedLabor: 1,
    ...stocks,
  } as BuildingState;
}
