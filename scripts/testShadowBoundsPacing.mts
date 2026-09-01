import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import {
  computeViewShadowBounds,
  intersectTerrainBounds,
} from '../src/scene/fitDirectionalShadow.ts';
import {
  directionalShadowRefreshReasons,
  shouldRefreshDynamicAgentDirectionalShadow,
  shouldRefreshDirectionalShadowAtlas,
  shouldRefreshFirstPersonDirectionalShadow,
} from '../src/scene/directionalShadowRefreshPolicy.ts';

assert.equal(
  shouldRefreshDynamicAgentDirectionalShadow(1 / 60),
  true,
  'an advancing agent frame must refresh the directional atlas',
);
assert.equal(
  shouldRefreshDynamicAgentDirectionalShadow(0),
  false,
  'a paused world may retain the cached directional atlas',
);

assert.equal(
  shouldRefreshFirstPersonDirectionalShadow(true, true),
  true,
  'active first-person navigation must refresh animated foliage shadows',
);
assert.equal(
  shouldRefreshFirstPersonDirectionalShadow(true, false),
  false,
  'a settled first-person camera should retain the ordinary shadow cadence',
);
assert.equal(
  shouldRefreshFirstPersonDirectionalShadow(false, true),
  false,
  'overview navigation should retain the paced shadow refresh policy',
);
assert.equal(
  shouldRefreshDirectionalShadowAtlas(false, true, false, false),
  true,
  'completed forest caster uploads must invalidate the cached atlas while settled',
);
assert.equal(
  shouldRefreshDirectionalShadowAtlas(false, false, false, false),
  false,
  'a settled unchanged overview should retain the cached atlas',
);
assert.deepEqual(
  directionalShadowRefreshReasons(true, true, true, true),
  ['camera-refit', 'forest-casters', 'first-person-motion'],
  'coincident invalidations must retain exact causes while sharing one atlas upload',
);

const appSource = readFileSync('src/app/App.ts', 'utf8');
const tickSource = appSource.slice(
  appSource.indexOf('private readonly tick ='),
  appSource.indexOf('private onForestReady'),
);
assert.ok(
  tickSource.indexOf('tickSettlementWorld(') < tickSource.indexOf('this.sceneManager?.render('),
  'agent interpolation and palette uploads must complete before the color and shadow passes',
);
const sceneManagerSource = readFileSync('src/scene/SceneManager.ts', 'utf8');
assert.match(
  sceneManagerSource,
  /shouldRefreshDynamicAgentDirectionalShadow\(dt\)[\s\S]{0,160}refreshShadowMap\('dynamic-casters'\)/,
  'advancing agents must invalidate the shared directional atlas every rendered frame',
);
assert.deepEqual(
  directionalShadowRefreshReasons(false, false, false, true),
  [],
  'overview interaction alone must not churn the cached directional atlas',
);
const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 2600);
const target = new THREE.Vector3(81, 0, -37);
const terrainBounds = { minX: -600, maxX: 600, minZ: -450, maxZ: 450 };
const viewScratch = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
const clippedScratch = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };

const allocatedView = computeViewShadowBounds(camera, target, 240, 1.24);
const allocatedClipped = intersectTerrainBounds(allocatedView, terrainBounds);
assert.equal(
  computeViewShadowBounds(camera, target, 240, 1.24, viewScratch),
  viewScratch,
);
assert.deepEqual(viewScratch, allocatedView);
assert.equal(
  intersectTerrainBounds(viewScratch, terrainBounds, clippedScratch),
  clippedScratch,
);
assert.deepEqual(clippedScratch, allocatedClipped);

const iterations = 1_000_000;
let checksum = 0;
const startedAt = performance.now();
for (let index = 0; index < iterations; index++) {
  target.x = index % 401 - 200;
  const view = computeViewShadowBounds(camera, target, 80 + index % 320, 1.24, viewScratch);
  const clipped = intersectTerrainBounds(view, terrainBounds, clippedScratch);
  checksum += clipped.minX;
}
const elapsedMs = performance.now() - startedAt;
assert.ok(Number.isFinite(checksum));
assert.ok(elapsedMs < 500, `shadow bounds scratch loop took ${elapsedMs.toFixed(1)}ms`);
console.log(
  `Shadow-bounds pacing tests passed (${iterations.toLocaleString()} frames in ${elapsedMs.toFixed(1)}ms, zero result allocations).`,
);
