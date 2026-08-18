import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildingUsesCompletedMesh } from '../src/buildings/buildingVisualState.ts';
import type { BuildingState } from '../src/resources/types.ts';

const repairState = {
  kind: 'lumber_mill',
  constructionComplete: false,
  fireRepairActive: true,
  constructionProgress: 0.25,
  constructionRequiredTimber: 10,
  constructionRequiredStone: 0,
  constructionRequiredIronwork: 0,
  constructionDeliveredTimber: 4,
  constructionDeliveredStone: 0,
  constructionDeliveredIronwork: 0,
} as BuildingState;

assert.equal(buildingUsesCompletedMesh(repairState), true);

const rebuildState = {
  ...repairState,
  fireRepairActive: false,
};
assert.equal(buildingUsesCompletedMesh(rebuildState), false);

const recoveryReducer = readFileSync(
  new URL('../server/src/reducers/fire_recovery.rs', import.meta.url),
  'utf8',
);
const constructionSimulation = readFileSync(
  new URL('../server/src/simulation/construction.rs', import.meta.url),
  'utf8',
);
const buildingMarkers = readFileSync(
  new URL('../src/buildings/BuildingMarkers.ts', import.meta.url),
  'utf8',
);
const markerSignature = readFileSync(
  new URL('../src/buildings/buildingMarkerSignature.ts', import.meta.url),
  'utf8',
);

assert.match(
  recoveryReducer,
  /fire_repair_active = incident\.state != FIRE_STATE_DESTROYED/,
  'only a non-destroyed recovery should retain the completed mesh',
);
assert.match(
  constructionSimulation,
  /site\.fire_repair_active = false/,
  'finishing repair work must clear the transient visual state',
);
assert.match(buildingMarkers, /const useCompletedMesh = buildingUsesCompletedMesh\(building\)/);
assert.match(buildingMarkers, /marker = useCompletedMesh/);
assert.match(markerSignature, /if \(buildingUsesCompletedMesh\(building\)\)/);

console.log('building repair visual tests passed');
