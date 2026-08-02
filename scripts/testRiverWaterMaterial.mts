import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import {
  BASELINE_CAMERA_DISTANCE,
  CLOSE_GROUND_FADE_START_ZOOM_PERCENT,
  CLOSE_GROUND_FULL_ZOOM_PERCENT,
  DIRT_FADE_START_ZOOM_PERCENT,
  DIRT_REVEAL_ZOOM_PERCENT,
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
assert.equal(
  REED_LOD_VISIBILITY_THRESHOLD,
  0,
  'cattails should begin their opacity fade immediately above the 200% boundary',
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
assert.equal(isReedLodVisible(REED_LOD_VISIBILITY_THRESHOLD), false);
assert.equal(isReedLodVisible(REED_LOD_VISIBILITY_THRESHOLD + 0.001), true);
const overviewReedLod = resolveReedLod(42, false);
assert.ok(
  reedLodOpacity(overviewReedLod) < overviewReedLod,
  'partial orbit LOD must fade more aggressively than the old linear card opacity',
);
assert.equal(
  isReedLodVisible(overviewReedLod),
  true,
  'cattails must share the vegetation fade once the orbit passes 200%',
);
assert.equal(grassBladeLodOpacity(-1), 0);
assert.equal(grassBladeLodOpacity(GRASS_BLADE_LOD_VISIBILITY_THRESHOLD), 0);
assert.equal(grassBladeLodOpacity(1), 1);
assert.equal(grassBladeLodOpacity(2), 1);
assert.equal(
  GRASS_BLADE_LOD_VISIBILITY_THRESHOLD,
  0,
  'SeedThree blades must begin at the start of their close-vegetation LOD band',
);
const overviewGrassLod = grassBladeRevealOpacity(42);
assert.ok(
  grassBladeLodOpacity(overviewGrassLod) < overviewGrassLod,
  'early grass clumps must remain subtle during their continuous opacity blend',
);
assert.equal(
  isGrassBladeZoomActive(42),
  true,
  'normal close-orbit grass must be visible before brown soil begins blending',
);
assert.equal(
  dirtZoomGate(42),
  0,
  'brown soil must remain hidden at the beginning of the SeedThree grass transition',
);
assert.equal(
  CLOSE_GROUND_FADE_START_ZOOM_PERCENT,
  200,
  'close vegetation must begin its gradual handoff at 200% zoom',
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
assert.equal(refreshedCloseGroundLod, 0);
assert.equal(
  isGrassBladeZoomActive(BASELINE_CAMERA_DISTANCE / 1.25),
  false,
  'SeedThree blades must remain hidden below the 200% transition boundary',
);
const earlyCloseGroundLod = dirtZoomGate(BASELINE_CAMERA_DISTANCE / 1.5);
assert.equal(earlyCloseGroundLod, 0);
assert.equal(
  isGrassBladeZoomActive(BASELINE_CAMERA_DISTANCE / 1.5),
  false,
  '150% orbit view must remain free of close vegetation',
);
const normalCloseGroundLod = grassBladeRevealOpacity(BASELINE_CAMERA_DISTANCE / 2.1);
assert.ok(
  normalCloseGroundLod > 0.05 && normalCloseGroundLod < 0.09,
  '210% orbit view must be at the subtle beginning of the vegetation handoff',
);
assert.equal(
  dirtZoomGate(BASELINE_CAMERA_DISTANCE / 2.1),
  0,
  '210% orbit view must retain meadow ground beneath the emerging SeedThree grass',
);
assert.equal(
  grassBladeRevealOpacity(
    BASELINE_CAMERA_DISTANCE / (CLOSE_GROUND_FULL_ZOOM_PERCENT / 100),
  ),
  1,
  'SeedThree grass must be fully revealed at 400% zoom',
);
assert.equal(
  DIRT_FADE_START_ZOOM_PERCENT,
  425,
  'brown soil may begin only after SeedThree grass reaches full opacity',
);
assert.equal(
  dirtZoomGate(BASELINE_CAMERA_DISTANCE / (DIRT_FADE_START_ZOOM_PERCENT / 100)),
  0,
  'brown soil must be absent at its delayed transition boundary',
);
assert.equal(
  dirtZoomGate(BASELINE_CAMERA_DISTANCE / (CLOSE_GROUND_FULL_ZOOM_PERCENT / 100)),
  0,
  'brown soil must remain absent when SeedThree grass first reaches full opacity',
);
assert.equal(
  DIRT_REVEAL_ZOOM_PERCENT,
  650,
  'brown soil should require a distinctly ground-level zoom to reach full strength',
);
assert.equal(
  dirtZoomGate(BASELINE_CAMERA_DISTANCE / (DIRT_REVEAL_ZOOM_PERCENT / 100)),
  1,
  'ground-level orbit must fully reveal the authored brown soil',
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
assert.match(
  reedSource,
  /let instancesHidden = false;[\s\S]*?if \(instancesHidden\) return;[\s\S]*?instancesHidden = true;/,
  'settled hidden reeds must not rewrite and republish identical matrices every frame',
);
assert.match(
  reedSource,
  /const refreshProximity[\s\S]*?instancesHidden = false;/,
  'a visible proximity refresh must re-arm the next hidden transition',
);
assert.doesNotMatch(
  shoreStoneSource,
  /buildRiverShoreCrossingGaps|isInRiverShoreCrossingGap|rng\(\) > chance/,
  'river-bank stones must not contain pre-cut or stochastic empty stretches',
);
assert.match(
  shoreStoneSource,
  /shadowMesh\.castShadow = false[\s\S]*?shadowMesh\.visible = false/,
  'sub-pixel shoreline stones must not merge into a dark dotted shadow contour',
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

const reedCount = 1_000;
const hiddenFrames = 1_200;
const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
const benchmarkGeometry = new THREE.BufferGeometry();
const benchmarkMaterial = new THREE.MeshBasicMaterial();
const oldMesh = new THREE.InstancedMesh(
  benchmarkGeometry,
  benchmarkMaterial,
  reedCount,
);
const oldStartedAt = performance.now();
for (let frame = 0; frame < hiddenFrames; frame += 1) {
  for (let index = 0; index < reedCount; index += 1) {
    oldMesh.setMatrixAt(index, hidden);
  }
  oldMesh.instanceMatrix.needsUpdate = true;
}
const oldElapsedMs = performance.now() - oldStartedAt;
const optimizedMesh = new THREE.InstancedMesh(
  benchmarkGeometry,
  benchmarkMaterial,
  reedCount,
);
let benchmarkInstancesHidden = false;
const optimizedStartedAt = performance.now();
for (let frame = 0; frame < hiddenFrames; frame += 1) {
  if (benchmarkInstancesHidden) continue;
  for (let index = 0; index < reedCount; index += 1) {
    optimizedMesh.setMatrixAt(index, hidden);
  }
  optimizedMesh.instanceMatrix.needsUpdate = true;
  benchmarkInstancesHidden = true;
}
const optimizedElapsedMs = performance.now() - optimizedStartedAt;
assert.deepEqual(
  optimizedMesh.instanceMatrix.array,
  oldMesh.instanceMatrix.array,
  'the guarded path must produce the identical hidden instance buffer',
);
assert.equal(oldMesh.instanceMatrix.version, hiddenFrames);
assert.equal(optimizedMesh.instanceMatrix.version, 1);
assert(optimizedElapsedMs < oldElapsedMs);
const oldHiddenUploadBytes = reedCount * 16 * Float32Array.BYTES_PER_ELEMENT * hiddenFrames;
const optimizedHiddenUploadBytes = reedCount * 16 * Float32Array.BYTES_PER_ELEMENT;
oldMesh.dispose();
optimizedMesh.dispose();
benchmarkGeometry.dispose();
benchmarkMaterial.dispose();

console.log(
  'River water material tests passed: bounded continuous normals and '
    + 'transparent physical-water depth/refraction remain active. '
    + `Hidden-reed benchmark: ${oldElapsedMs.toFixed(1)}ms/${oldHiddenUploadBytes.toLocaleString()} bytes `
    + `-> ${optimizedElapsedMs.toFixed(1)}ms/${optimizedHiddenUploadBytes.toLocaleString()} bytes.`,
);
