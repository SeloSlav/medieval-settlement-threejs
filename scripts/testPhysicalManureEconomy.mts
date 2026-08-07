import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import { createBuildingMesh } from '../src/buildings/BuildingMeshes.ts';
import {
  MANURE_STOCKPILE_VISUAL_SEGMENTS,
  MANURE_STOCK_SEGMENT_NAME,
} from '../src/buildings/meshes/manureStockpileMesh.ts';
import {
  seasonalStockpileVisualSignature,
  syncSeasonalStockpileVisuals,
} from '../src/buildings/seasonalStockpileVisuals.ts';
import {
  buildFarmsteadManurePlan,
  fieldManureFertilityBonus,
  fieldManureRequirement,
} from '../src/farming/manurePlanning.ts';
import {
  BUILDING_STORAGE_CAPS,
  FARM_MANURE_FERTILITY_BONUS,
} from '../src/generated/gameBalance.ts';
import { createDeliveryCartMesh } from '../src/logistics/deliveryCartMesh.ts';
import {
  cargoKindFromId,
  cargoKindLabel,
} from '../src/logistics/deliveryTrips.ts';
import type {
  BuildingKind,
  BuildingState,
  FarmFieldState,
} from '../src/resources/types.ts';

const field = farmField('field-1', 1_600, 16);
assert.equal(fieldManureRequirement(field), 64);
assert.equal(
  fieldManureFertilityBonus(field),
  FARM_MANURE_FERTILITY_BONUS / 4,
  'one-quarter physical coverage must grant one-quarter of the maximum soil benefit',
);
assert.equal(
  fieldManureFertilityBonus({ ...field, manureApplied: 640 }),
  FARM_MANURE_FERTILITY_BONUS,
  'excess manure must not exceed the bounded fertility benefit',
);

const plan = buildFarmsteadManurePlan(
  [
    field,
    { ...field, id: 'paused-field', priority: 0, manureApplied: 0 },
  ],
  24,
  24,
);
assert.deepEqual(plan, {
  activeFields: 1,
  required: 64,
  applied: 16,
  remaining: 48,
  onsite: 24,
  inbound: 24,
  covered: 64,
  shortfall: 0,
  coverageRatio: 1,
});

for (const [kind, groupName] of [
  ['pastoral_farmstead', 'PastoralManureStockpile'],
  ['threshing_barn', 'ThreshingManureStockpile'],
] as const) {
  const marker = createBuildingMesh(kind);
  const stockpile = marker.getObjectByName(groupName);
  assert.ok(stockpile instanceof THREE.Group, `${kind} needs a physical manure stockpile`);
  assert.equal(stockpile.visible, false);
  assert.equal(
    stockpile.children.filter((child) => child.name === MANURE_STOCK_SEGMENT_NAME).length,
    MANURE_STOCKPILE_VISUAL_SEGMENTS,
  );
  const capacity = BUILDING_STORAGE_CAPS[kind].manure;
  syncSeasonalStockpileVisuals(marker, building(kind, capacity / 2));
  assert.equal(stockpile.visible, true);
  assert.equal(
    stockpile.children.filter(
      (child) => child.name === MANURE_STOCK_SEGMENT_NAME && child.visible,
    ).length,
    MANURE_STOCKPILE_VISUAL_SEGMENTS / 2,
  );
}

const manureCart = createDeliveryCartMesh('manure');
assert.ok(manureCart.getObjectByName('Manure cart heap') instanceof THREE.Mesh);
assert.equal(
  manureCart.getObjectsByProperty('name', 'Manure bedding straw 1').length,
  1,
  'the cart load should read as collected dung mixed with stable bedding',
);
assert.equal(cargoKindFromId(24), 'manure');
assert.equal(cargoKindLabel('manure'), 'Field manure');

const serverTables = fs.readFileSync('server/src/tables.rs', 'utf8');
const generatedBuilding = fs.readFileSync('src/generated/building_table.ts', 'utf8');
const generatedField = fs.readFileSync('src/generated/farm_field_table.ts', 'utf8');
assert.match(serverTables, /pub manure:\s*f64/, 'authoritative buildings and fields need manure state');
assert.match(generatedBuilding, /manure:\s*__t\.f64\(\)/, 'client bindings need building manure stock');
assert.match(generatedField, /manureApplied:\s*__t\.f64\(\)/, 'client bindings need spread manure state');

const livestockInspector = fs.readFileSync(
  'src/resources/inspector/livestockBuildingRenderer.ts',
  'utf8',
);
const fieldInspector = fs.readFileSync(
  'src/resources/inspector/farmFieldRenderer.ts',
  'utf8',
);
const townHallInspector = fs.readFileSync(
  'src/resources/inspector/townHallRenderer.ts',
  'utf8',
);
assert.match(livestockInspector, /Manure output/);
assert.match(livestockInspector, /spread during ploughing and restores up to/);
assert.match(fieldInspector, /Manure spread/);
assert.match(fieldInspector, /manure stored/);
assert.match(townHallInspector, /Field manure/);

const scaleFields = Array.from(
  { length: 100_000 },
  (_, index) => farmField(`scale-field-${index}`, 400, index % 4),
);
const started = performance.now();
const scalePlan = buildFarmsteadManurePlan(scaleFields, 10_000, 2_400);
const elapsed = performance.now() - started;
assert.equal(scalePlan.activeFields, 100_000);
assert.ok(scalePlan.required > scalePlan.applied);
assert.ok(
  elapsed < 250,
  `100,000-field manure planning took ${elapsed.toFixed(1)} ms`,
);

const signatureStarted = performance.now();
let signatureLength = 0;
for (let index = 0; index < 100_000; index += 1) {
  signatureLength += seasonalStockpileVisualSignature(
    building(
      index % 2 === 0 ? 'pastoral_farmstead' : 'threshing_barn',
      index % 161,
    ),
  ).length;
}
const signatureElapsed = performance.now() - signatureStarted;
assert.ok(signatureLength > 0);
assert.ok(
  signatureElapsed < 250,
  `100,000 manure visual signatures took ${signatureElapsed.toFixed(1)} ms`,
);

console.log(
  `Physical manure economy tests passed (${elapsed.toFixed(1)} ms / 100k fields; `
    + `${signatureElapsed.toFixed(1)} ms / 100k visual signatures).`,
);

function farmField(id: string, area: number, manureApplied: number): FarmFieldState {
  return {
    id,
    farmsteadId: 'threshing_barn-1',
    corners: [
      { x: 0, z: 0 },
      { x: 40, z: 0 },
      { x: 40, z: 40 },
      { x: 0, z: 40 },
    ],
    area,
    averageSlopeDegrees: 2,
    moisture: 0.5,
    fertility: 0.7,
    crop: 'rye',
    nextCrop: 'fallow',
    followingCrop: null,
    stage: 'ploughing',
    stageProgress: 0,
    priority: 1,
    harvestCount: 0,
    lastYield: 0,
    currentYield: 0,
    manureApplied,
  };
}

function building(kind: BuildingKind, manure: number): BuildingState {
  return {
    id: `${kind}-1`,
    kind,
    x: 0,
    z: 0,
    constructionComplete: true,
    assignedLabor: 1,
    workRadius: 100,
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
    manure,
  } as BuildingState;
}
