import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import {
  BASELINE_CAMERA_DISTANCE,
  CLOSE_GROUND_FADE_START_ZOOM_PERCENT,
  CLOSE_GROUND_FULL_ZOOM_PERCENT,
  dirtZoomGate,
  grassBladeLodOpacity,
  grassBladeRevealOpacity,
  GRASS_BLADE_LOD_VISIBILITY_THRESHOLD,
  isGrassBladeZoomActive,
  isReedLodVisible,
  REED_LOD_OPACITY_POWER,
  REED_LOD_VISIBILITY_THRESHOLD,
  reedLodOpacity,
  resolveReedLod,
} from '../src/grass/grassLodMath.ts';
import {
  disposeSharedRiverWaterMaterial,
  getSharedRiverWaterMaterial,
  normalizeRiverWaterNightAmount,
  RIVER_BANK_BED_REVEAL,
  RIVER_DEEP_BACKDROP_STABILITY,
  RIVER_FLOW_HIGHLIGHT_STRENGTH,
  RIVER_FLOW_ROUGHNESS_FLOOR,
  RIVER_OPTICAL_SHORE_EXPONENT,
  RIVER_SKY_RETURN_STRENGTH,
  RIVER_VISUAL_SHORE_EXPONENT,
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
  WATER_ALPHA_FEATHER_IN,
  WATER_FOAM_REACH,
} from '../src/rivers/riverWaterShoreMaps.ts';
import {
  computeShoreStoneMoss,
  computeShoreStoneTint,
  computeShoreStoneVisualScale,
  computeShoreStoneVisualVariation,
} from '../src/rivers/riverShoreStoneAppearance.ts';

assert.equal(REED_LOD_OPACITY_POWER, 2);
assert.ok(
  REED_LOD_VISIBILITY_THRESHOLD >= 0.7,
  'alpha-tested reed cards must stay hidden through the overview-scale aliasing band',
);
assert.equal(reedLodOpacity(-1), 0);
assert.equal(reedLodOpacity(0), 0);
assert.equal(reedLodOpacity(0.5), 0.25);
assert.equal(reedLodOpacity(1), 1);
assert.equal(reedLodOpacity(2), 1);
assert.equal(
  resolveReedLod(999, true),
  1,
  'first-person reeds must retain full close-detail LOD',
);
assert.equal(isReedLodVisible(REED_LOD_VISIBILITY_THRESHOLD - 0.001), false);
assert.equal(isReedLodVisible(REED_LOD_VISIBILITY_THRESHOLD), true);
const overviewReedLod = resolveReedLod(42, false);
assert.ok(
  reedLodOpacity(overviewReedLod) < overviewReedLod,
  'partial orbit LOD must fade more aggressively than the old linear card opacity',
);
assert.equal(
  isReedLodVisible(overviewReedLod),
  false,
  'review-scale orbit reeds must not collapse into detached alpha-tested dots',
);
assert.equal(grassBladeLodOpacity(-1), 0);
assert.equal(grassBladeLodOpacity(GRASS_BLADE_LOD_VISIBILITY_THRESHOLD), 0);
assert.equal(grassBladeLodOpacity(1), 1);
assert.equal(grassBladeLodOpacity(2), 1);
assert.equal(
  GRASS_BLADE_LOD_VISIBILITY_THRESHOLD,
  0,
  'SeedThree blades must begin in the same LOD band as the brown soil',
);
const overviewGrassLod = grassBladeRevealOpacity(42);
assert.ok(
  grassBladeLodOpacity(overviewGrassLod) < overviewGrassLod,
  'early grass clumps must remain subtler than the continuous terrain dirt blend',
);
assert.equal(
  isGrassBladeZoomActive(42),
  true,
  'normal close-orbit grass must be visible while the brown dirt is blending',
);
assert.equal(
  CLOSE_GROUND_FADE_START_ZOOM_PERCENT,
  100,
  'the reference orbit must begin the gradual authored dirt handoff',
);
assert.equal(
  dirtZoomGate(BASELINE_CAMERA_DISTANCE),
  0,
  '100% strategic overview must remain meadow-led at the start of the transition',
);
assert.equal(
  isGrassBladeZoomActive(BASELINE_CAMERA_DISTANCE),
  false,
  'SeedThree blades must remain off before the shared close-ground transition begins',
);
const refreshedCloseGroundLod = dirtZoomGate(BASELINE_CAMERA_DISTANCE / 1.25);
assert.ok(
  refreshedCloseGroundLod > 0.2 && refreshedCloseGroundLod < 0.35,
  'the normal refreshed close view must already reveal dirt without completing the handoff',
);
assert.equal(
  isGrassBladeZoomActive(BASELINE_CAMERA_DISTANCE / 1.25),
  true,
  'SeedThree blades must accompany dirt in the normal refreshed close view',
);
const earlyCloseGroundLod = dirtZoomGate(BASELINE_CAMERA_DISTANCE / 1.5);
assert.ok(
  earlyCloseGroundLod > 0.45 && earlyCloseGroundLod < 0.6,
  '150% orbit view must remain a balanced soil-and-grass transition',
);
assert.equal(
  isGrassBladeZoomActive(BASELINE_CAMERA_DISTANCE / 1.5),
  true,
  'SeedThree blades must begin alongside the first visible brown soil',
);
assert.equal(
  grassBladeRevealOpacity(BASELINE_CAMERA_DISTANCE / 2.1),
  dirtZoomGate(BASELINE_CAMERA_DISTANCE / 2.1),
  'SeedThree blades and brown soil must use the same zoom transition',
);
const normalCloseGroundLod = dirtZoomGate(BASELINE_CAMERA_DISTANCE / 2.1);
assert.ok(
  normalCloseGroundLod > 0.8 && normalCloseGroundLod < 0.88,
  '210% orbit view must clearly show dirt while still retaining a gradual handoff',
);
assert.equal(
  dirtZoomGate(BASELINE_CAMERA_DISTANCE / (CLOSE_GROUND_FULL_ZOOM_PERCENT / 100)),
  1,
  'closest orbit view must fully reveal authored dirt beneath SeedThree blades',
);

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
assert.equal(computeWaterFoamBase(WATER_FOAM_REACH), 0);
assert.equal(computeWaterFoamBase(1.65), 0);
assert.equal(computeWaterFoamBase(2.5), 0);
assert.ok(WATER_ALPHA_FEATHER_IN <= 0.5);
assert.ok(computeWaterFeatherAlpha(-0.6) < computeWaterFeatherAlpha(0.2));
assert.ok(computeWaterFeatherAlpha(0.2) < computeWaterFeatherAlpha(0.96));

const stoneVisualA = computeShoreStoneVisualScale(12, -8);
const stoneVisualB = computeShoreStoneVisualScale(25, 17);
assert.ok(stoneVisualA >= 0.58 && stoneVisualA <= 1.2);
assert.ok(stoneVisualB >= 0.58 && stoneVisualB <= 1.2);
assert.notEqual(stoneVisualA, stoneVisualB);
const stoneTint = computeShoreStoneTint(12, -8);
assert.ok(stoneTint >= 0.5 && stoneTint <= 0.88);
const stoneMoss = computeShoreStoneMoss(12, -8);
assert.ok(stoneMoss >= 0 && stoneMoss <= 1);
const stoneVariation = computeShoreStoneVisualVariation(12, -8);
assert.ok(stoneVariation.aspect >= 0.64 && stoneVariation.aspect <= 1.5);
assert.ok(stoneVariation.height >= 0.72 && stoneVariation.height <= 1.22);
assert.ok(stoneVariation.yaw >= 0 && stoneVariation.yaw <= Math.PI * 2);
assert.ok(Math.abs(stoneVariation.offsetX) <= 0.45);
assert.ok(Math.abs(stoneVariation.offsetZ) <= 0.45);
assert.ok(stoneVariation.sink >= 0.06 && stoneVariation.sink <= 0.26);

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
assert.equal(material.transmission, 0.88);
assert.equal(material.thickness, 0.65);
assert.equal(material.attenuationDistance, RIVER_WATER_ATTENUATION_DISTANCE);
assert.equal(material.attenuationDistance, 2.6);
assert.equal(
  RIVER_DEEP_BACKDROP_STABILITY,
  1,
  'deep water must fully suppress false screen-space terrain and tree-shadow bands',
);
assert.ok(
  RIVER_VISUAL_SHORE_EXPONENT >= 3.5,
  'visual shore depth must settle quickly enough to avoid distance-field pool lobes',
);
assert.ok(
  RIVER_OPTICAL_SHORE_EXPONENT >= 1.8 && RIVER_OPTICAL_SHORE_EXPONENT <= 2.2,
  'optical depth must reveal the near-bank bed without restoring broad distance lobes',
);
assert.ok(
  RIVER_BANK_BED_REVEAL >= 0.65 && RIVER_BANK_BED_REVEAL <= 0.75,
  'bank bed reveal must remain visible without replacing the channel body',
);
assert.ok(
  RIVER_FLOW_ROUGHNESS_FLOOR >= 0.31,
  'flow roughness must not turn directional crests into black winter pools',
);
assert.ok(
  RIVER_FLOW_HIGHLIGHT_STRENGTH >= 0.15
    && RIVER_FLOW_HIGHLIGHT_STRENGTH <= 0.2,
  'broken micro-flow must remain visible without becoming broad winter halos',
);
assert.ok(
  RIVER_SKY_RETURN_STRENGTH >= 0.14 && RIVER_SKY_RETURN_STRENGTH <= 0.2,
  'angle-dependent sky return must remain legible but restrained',
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

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const waterMaterialSource = readFileSync(
  `${projectRoot}src/rivers/RiverWaterMaterial.ts`,
  'utf8',
);
const reedSource = readFileSync(
  `${projectRoot}src/rivers/RiverReeds.ts`,
  'utf8',
);
const shoreStoneSource = readFileSync(
  `${projectRoot}src/rivers/RiverShoreStones.ts`,
  'utf8',
);
assert.match(
  reedSource,
  /reedLodOpacity\(reedLod\)\s*\*\s*REED_PEAK_OPACITY/,
  'runtime reeds must use the anti-aliasing opacity curve',
);
assert.match(
  reedSource,
  /isReedLodVisible\(reedLod\)/,
  'runtime reeds must use the minimum readable-card reveal threshold',
);
assert.equal(
  (reedSource.match(/new THREE\.InstancedMesh/g) ?? []).length,
  1,
  'reed LOD must retain the existing single instanced draw',
);
assert.doesNotMatch(
  shoreStoneSource,
  /buildRiverShoreCrossingGaps|isInRiverShoreCrossingGap|rng\(\) > chance/,
  'river-bank stones must not contain pre-cut or stochastic empty stretches',
);
assert.match(
  shoreStoneSource,
  /placementIndex\.hasPointWithin\(x, z, 0\.72 \+ scale \* 0\.38\)/,
  'river-bank stones must retain dense non-overlapping continuous placement',
);
assert.match(waterMaterialSource, /vec3\(0\.02,\s*0\.043,\s*0\.055\)/);
assert.match(
  waterMaterialSource,
  /mix\(float\(0\.62\)[\s\S]*?depthFactor/,
);
assert.equal(
  (waterMaterialSource.match(/\btexture\(/g) ?? []).length,
  1,
  'night water-edge lift must not add texture samples',
);

disposeSharedRiverWaterMaterial();
shoreTexture.dispose();

console.log(
  'River water material tests passed: bounded continuous normals and '
    + 'transparent physical-water depth/refraction remain active.',
);
