import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  disposeSharedRiverWaterMaterial,
  getSharedRiverWaterMaterial,
  normalizeRiverWaterNightAmount,
  RIVER_DEEP_BACKDROP_STABILITY,
  RIVER_WATER_ATTENUATION_DISTANCE,
  RIVER_WATER_TRANSMISSION,
  setSharedRiverWaterNightAmount,
} from '../src/rivers/RiverWaterMaterial.ts';
import {
  MAX_RIVER_WATER_NORMAL_SLOPE,
  RIVER_WATER_RECEIVES_SHADOWS,
  writeBoundedRiverWaterNormal,
} from '../src/rivers/RiverWaterMesh.ts';
import {
  computeWaterFeatherAlpha,
  computeWaterFoamBase,
  type RiverWaterShoreMaps,
} from '../src/rivers/riverWaterShoreMaps.ts';
import {
  computeShoreStoneTint,
  computeShoreStoneVisualScale,
} from '../src/rivers/riverShoreStoneAppearance.ts';

const normal = new Float32Array(3);
writeBoundedRiverWaterNormal(normal, 0, 8, -6);
assert.ok(Math.abs(Math.hypot(...normal) - 1) < 1e-6);
assert.ok(normal[1] > 0.98, 'bounded water normal should remain predominantly upward');
const reconstructedSlope = Math.hypot(normal[0], normal[2]) / normal[1];
assert.ok(
  reconstructedSlope <= MAX_RIVER_WATER_NORMAL_SLOPE + 1e-6,
  'water normal slope must remain inside the anti-glare bound',
);

const duplicateNormal = new Float32Array(3);
writeBoundedRiverWaterNormal(duplicateNormal, 0, 8, -6);
assert.deepEqual(
  duplicateNormal,
  normal,
  'duplicate clipped-edge vertices must receive identical continuous normals',
);
assert.equal(
  RIVER_WATER_RECEIVES_SHADOWS,
  false,
  'transparent water must not receive opaque tree-shadow bands',
);

assert.ok(computeWaterFoamBase(0.2) > computeWaterFoamBase(0.9));
assert.ok(computeWaterFoamBase(0.9) > computeWaterFoamBase(1.6));
assert.equal(computeWaterFoamBase(1.65), 0);
assert.equal(computeWaterFoamBase(2.5), 0);
assert.ok(computeWaterFeatherAlpha(-0.6) < computeWaterFeatherAlpha(0.2));
assert.ok(computeWaterFeatherAlpha(0.2) < computeWaterFeatherAlpha(0.96));

const stoneVisualA = computeShoreStoneVisualScale(12, -8);
const stoneVisualB = computeShoreStoneVisualScale(25, 17);
assert.ok(stoneVisualA >= 0.18 && stoneVisualA <= 1.04);
assert.ok(stoneVisualB >= 0.18 && stoneVisualB <= 1.04);
assert.notEqual(stoneVisualA, stoneVisualB);
const stoneTint = computeShoreStoneTint(12, -8);
assert.ok(stoneTint >= 0.58 && stoneTint <= 0.9);

const shoreTexture = new THREE.DataTexture(
  new Uint8Array([255, 0, 128, 0]),
  1,
  1,
  THREE.RGBAFormat,
  THREE.UnsignedByteType,
);
shoreTexture.needsUpdate = true;

const shoreMaps: RiverWaterShoreMaps = {
  shoreTexture,
  originX: -1,
  originZ: -1,
  invSpanX: 0.5,
  invSpanZ: 0.5,
};
const material = getSharedRiverWaterMaterial(shoreMaps);

assert.equal(
  material.transmission,
  RIVER_WATER_TRANSMISSION,
  'bounded normals must retain the river transmission path',
);
assert.equal(material.transmission, 0.82);
assert.equal(material.thickness, 0.65);
assert.equal(material.attenuationDistance, RIVER_WATER_ATTENUATION_DISTANCE);
assert.equal(material.attenuationDistance, 1.75);
assert.equal(
  RIVER_DEEP_BACKDROP_STABILITY,
  1,
  'deep water must fully suppress false screen-space terrain and tree-shadow bands',
);
assert.equal(material.roughness, 0.3);
assert.equal(material.specularIntensity, 0.5);
assert.ok(material.roughnessNode, 'directional flow must modulate reflected highlight roughness');
assert.ok(
  (material as typeof material & { emissiveNode?: unknown }).emissiveNode,
  'river must retain its night-only sky-return node',
);
assert.ok(material.backdropNode, 'river must retain its depth-aware backdrop refraction');
assert.ok(material.backdropAlphaNode, 'river must retain depth-aware backdrop blending');
assert.equal(material.transparent, true);
assert.equal(material.depthWrite, false);
assert.equal(material.depthTest, true);
assert.equal(normalizeRiverWaterNightAmount(-1), 0);
assert.equal(normalizeRiverWaterNightAmount(0.42), 0.42);
assert.equal(normalizeRiverWaterNightAmount(2), 1);
assert.equal(normalizeRiverWaterNightAmount(Number.NaN), 0);
setSharedRiverWaterNightAmount(1);
setSharedRiverWaterNightAmount(0);

disposeSharedRiverWaterMaterial();
shoreTexture.dispose();

console.log(
  'River water material tests passed: bounded continuous normals and '
    + 'transparent physical-water depth/refraction remain active.',
);
