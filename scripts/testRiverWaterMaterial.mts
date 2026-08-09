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
} from '../src/grass/grassLodMath.ts';
import {
  computeRiverWaterSkyPalette,
  disposeSharedRiverWaterMaterial,
  getSharedRiverWaterMaterial,
  normalizeRiverWaterNightAmount,
  OPEN_WATER_SPECTRAL_BAND_COUNT,
  RIVER_BANK_BED_REVEAL,
  RIVER_CLOUD_REFLECTION_CLEAR,
  RIVER_CLOUD_REFLECTION_MAX,
  RIVER_CLOSE_REFLECTION_DISTANCE,
  RIVER_DEEP_BACKDROP_STABILITY,
  RIVER_FLOW_HIGHLIGHT_STRENGTH,
  RIVER_FLOW_ROUGHNESS_FLOOR,
  RIVER_OPTICAL_SHORE_EXPONENT,
  RIVER_PAINTERLY_REFLECTION_SAMPLES,
  RIVER_REFLECTION_FRESNEL_FLOOR,
  RIVER_SKY_RETURN_STRENGTH,
  RIVER_VISUAL_SHORE_EXPONENT,
  RIVER_WATER_ATTENUATION_DISTANCE,
  RIVER_WATER_TRANSMISSION,
  setSharedRiverWaterNightAmount,
  setSharedRiverWaterReflectionState,
} from '../src/rivers/RiverWaterMaterial.ts';
import {
  MAX_RIVER_WATER_NORMAL_SLOPE,
  RIVER_WATER_RECEIVES_SHADOWS,
  writeBoundedRiverWaterNormal,
} from '../src/rivers/RiverWaterMesh.ts';
import {
  computeWaterFeatherAlpha,
  computeWaterFoamBase,
  encodeWaterFlowDirection,
  type RiverWaterShoreMaps,
  WATER_ALPHA_FEATHER_IN,
  WATER_FOAM_REACH,
} from '../src/rivers/riverWaterShoreMaps.ts';
import {
  COASTAL_WATER_PROFILE,
  INLAND_WATER_PROFILE,
  RIVER_WATER_PROFILE,
  waterSurfaceProfileForPreset,
} from '../src/rivers/WaterSurfaceProfile.ts';
import {
  LILY_SHORE_REACH_METERS,
  lilyPadShorePresence,
} from '../src/rivers/RiverLilyPads.ts';
import {
  computeShoreStoneMoss,
  computeShoreStoneTint,
  computeShoreStoneVisualScale,
  computeShoreStoneVisualVariation,
} from '../src/rivers/riverShoreStoneAppearance.ts';

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

assert.equal(lilyPadShorePresence(0), 0);
assert.ok(lilyPadShorePresence(1.2) > 0.98);
assert.ok(lilyPadShorePresence(5.5) > lilyPadShorePresence(7.5));
assert.equal(lilyPadShorePresence(LILY_SHORE_REACH_METERS), 0);

assert.ok(computeWaterFoamBase(0.2) > computeWaterFoamBase(0.9));
assert.ok(computeWaterFoamBase(0.9) > computeWaterFoamBase(1.6));
assert.equal(computeWaterFoamBase(WATER_FOAM_REACH), 0);
assert.equal(computeWaterFoamBase(1.65), 0);
assert.equal(computeWaterFoamBase(2.5), 0);
assert.ok(WATER_ALPHA_FEATHER_IN <= 0.5);
assert.ok(computeWaterFeatherAlpha(-0.6) < computeWaterFeatherAlpha(0.2));
assert.ok(computeWaterFeatherAlpha(0.2) < computeWaterFeatherAlpha(0.96));
assert.deepEqual(
  encodeWaterFlowDirection(null),
  [128, 128],
  'still water must encode a neutral flow vector so the shader can select open-water motion',
);
assert.deepEqual(encodeWaterFlowDirection({ dx: 1, dz: 0 }), [255, 128]);
assert.equal(waterSurfaceProfileForPreset('vinodol_coast'), COASTAL_WATER_PROFILE);
assert.equal(waterSurfaceProfileForPreset('kupa_valley'), RIVER_WATER_PROFILE);
assert.equal(waterSurfaceProfileForPreset('custom'), INLAND_WATER_PROFILE);
assert.equal(OPEN_WATER_SPECTRAL_BAND_COUNT, 5);
assert.ok(COASTAL_WATER_PROFILE.openWaterWaveScale > INLAND_WATER_PROFILE.openWaterWaveScale);
assert.ok(COASTAL_WATER_PROFILE.attenuationDistance > RIVER_WATER_PROFILE.attenuationDistance);
assert.ok(INLAND_WATER_PROFILE.standingWaveRatio > COASTAL_WATER_PROFILE.standingWaveRatio);

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
assert.equal(material.transmission, 0.72);
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
  RIVER_FLOW_HIGHLIGHT_STRENGTH >= 0.07
    && RIVER_FLOW_HIGHLIGHT_STRENGTH <= 0.1,
  'broken micro-flow must remain visible without becoming bright directional ribbons',
);
assert.ok(
  RIVER_SKY_RETURN_STRENGTH >= 0.42 && RIVER_SKY_RETURN_STRENGTH <= 0.5,
  'live sky reflection must remain legible without becoming an opaque mirror',
);
assert.ok(
  RIVER_REFLECTION_FRESNEL_FLOOR >= 0.2 && RIVER_REFLECTION_FRESNEL_FLOOR <= 0.28,
  'overhead water must retain a restrained sky reflection without becoming a pale wash',
);
assert.ok(RIVER_CLOSE_REFLECTION_DISTANCE >= 100 && RIVER_CLOSE_REFLECTION_DISTANCE <= 130);
assert.ok(RIVER_CLOUD_REFLECTION_CLEAR <= 0.08);
assert.ok(RIVER_CLOUD_REFLECTION_MAX <= 0.18);
assert.equal(
  RIVER_PAINTERLY_REFLECTION_SAMPLES,
  2,
  'nearby silhouettes must use a fixed two-tap single-pass reflection budget',
);
assert.equal(material.roughness, 0.3);
assert.equal(material.specularIntensity, 0.5);
assert.ok(material.normalNode, 'close water must carry bounded analytic ripple normals');
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
const noonPalette = computeRiverWaterSkyPalette(70, 0);
const duskPalette = computeRiverWaterSkyPalette(0, 0.2);
const nightPalette = computeRiverWaterSkyPalette(-18, 1);
assert.ok(noonPalette.zenith.b > noonPalette.zenith.r * 2.5);
assert.ok(duskPalette.horizon.r > duskPalette.horizon.b * 1.7);
assert.ok(nightPalette.zenith.getHex() !== noonPalette.zenith.getHex());
const rainyNoonPalette = computeRiverWaterSkyPalette(70, 0, 0x798b91, 0.8);
assert.ok(
  rainyNoonPalette.zenith.getHex() !== noonPalette.zenith.getHex(),
  'weather must tint the reflected sky palette',
);
setSharedRiverWaterReflectionState({
  solarElevationDeg: 35,
  nightAmount: 0,
  celestialColor: 0xfff2dc,
  celestialDirection: new THREE.Vector3(0.3, 0.8, -0.5),
  celestialIntensity: 1,
  weatherTint: 0x9fbccc,
  weatherBlend: 0,
});
setSharedRiverWaterReflectionState({
  solarElevationDeg: -12,
  nightAmount: 1,
  celestialColor: 0xb4cee8,
  celestialDirection: new THREE.Vector3(-0.3, 0.8, 0.5),
  celestialIntensity: 0.18,
  weatherTint: 0x506b80,
  weatherBlend: 0.18,
});

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const waterMaterialSource = readFileSync(
  `${projectRoot}src/rivers/RiverWaterMaterial.ts`,
  'utf8',
);
const reedSource = readFileSync(
  `${projectRoot}src/rivers/RiverReeds.ts`,
  'utf8',
);
const lilyPadSource = readFileSync(
  `${projectRoot}src/rivers/RiverLilyPads.ts`,
  'utf8',
);
const shoreStoneSource = readFileSync(
  `${projectRoot}src/rivers/RiverShoreStones.ts`,
  'utf8',
);
assert.match(
  reedSource,
  /material\.opacity\s*=\s*REED_PEAK_OPACITY/,
  'cattails must retain readable opacity at every camera zoom',
);
assert.match(
  reedSource,
  /mesh\.visible\s*=\s*placements\.length\s*>\s*0/,
  'cattails must remain submitted at every camera zoom',
);
assert.doesNotMatch(
  reedSource,
  /resolveReedLod|grassEdgeFadeFromFocusDistance|hiddenMatrix/,
  'persistent cattails must not be camera-LOD or focus-radius culled',
);
assert.match(
  reedSource,
  /appendShallowReedFingers[\s\S]*?riverField\.isRenderedWetAt\(x, z\)/,
  'cattails must include irregular emergent fingers inside rendered shallows',
);
assert.match(
  reedSource,
  /getStillWaterSurfaceY\(terrain, riverField, x, z\)\s*-\s*terrain\.getHeightAt\(x, z\)/,
  'submerged cattail height must compensate for the local water depth',
);
assert.match(
  reedSource,
  /function resolveReedBaseY[\s\S]*?terrain\.getHeightAt\(placement\.x, placement\.z\)\s*\+\s*0\.03/,
  'all cattails, including submerged specimens, must root on terrain',
);
assert.equal(
  (reedSource.match(/new THREE\.InstancedMesh/g) ?? []).length,
  1,
  'persistent reeds must retain the existing single instanced draw',
);
assert.equal(
  (lilyPadSource.match(/new THREE\.InstancedMesh/g) ?? []).length,
  1,
  'all textured lily pads must stay in one instanced draw',
);
assert.match(
  lilyPadSource,
  /LILY_PAD_TEXTURE_PATH[\s\S]*?water-lily-pad\.png/,
  'lily pads must use the authored transparent leaf texture',
);
assert.match(
  lilyPadSource,
  /valueNoise2D[\s\S]*?raftPresence[\s\S]*?shorePresence/,
  'lily placement must combine broken rafts with a shore-distance fade',
);
assert.match(
  lilyPadSource,
  /opacity:\s*LILY_PEAK_OPACITY[\s\S]*?mesh\.visible\s*=\s*placements\.length\s*>\s*0/,
  'lily pads must retain their full presentation at every camera zoom',
);
assert.doesNotMatch(
  lilyPadSource,
  /LILY_CAMERA_(?:FULL|FADE)_DISTANCE|cameraDistance[\s\S]*?material\.opacity/,
  'lily pads must not use a camera-distance fade',
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
assert.match(
  waterMaterialSource,
  /const reflectionDir = normalize\([\s\S]*?rippleNormalWorld/,
  'sky lookup direction must follow the animated water normal',
);
assert.match(
  waterMaterialSource,
  /const surfaceWavePhaseA = wx[\s\S]*?const surfaceWavePhaseB = wx/,
  'broad waves must remain continuous in world space across flow-direction joins',
);
assert.doesNotMatch(
  waterMaterialSource,
  /ribbonCarrier|ribbonCrest|flowCross\.mul\((?:1\.85|3\.45)\)/,
  'water must not restore the flow-aligned ribbon lattice that turns at river corners',
);
assert.match(
  waterMaterialSource,
  /const cloudWarp[\s\S]*?const cloudPhaseC[\s\S]*?smoothstep\(/,
  'cloud return must use broad warped lobes instead of a two-sine grid',
);
assert.doesNotMatch(
  waterMaterialSource,
  /reflectionDir\.x\.mul\((?:9\.7|17\.3)\)/,
  'high-frequency periodic cloud bands must stay removed',
);
assert.match(
  waterMaterialSource,
  /const closeDetail = sub\([\s\S]*?RIVER_CLOSE_REFLECTION_DISTANCE/,
  'painterly surroundings and micro-ripples must fade outside close range',
);
assert.match(
  waterMaterialSource,
  /reflectionReach\.mul\(-1\)[\s\S]*?reflectionReach\.mul\(-1\.8\)/,
  'screen-space reflection taps must sample upward toward the visible bank',
);
assert.doesNotMatch(
  waterMaterialSource,
  /CubeCamera|Reflector|WebGLRenderTarget|RenderTarget\(/,
  'river reflection must not add a mirror camera or offscreen render pass',
);
assert.equal(
  (waterMaterialSource.match(/viewportSharedTexture\(/g) ?? []).length,
  RIVER_PAINTERLY_REFLECTION_SAMPLES + 1,
  'water must retain two painterly reflection taps plus one refraction tap',
);
assert.equal(
  (waterMaterialSource.match(/\btexture\(/g) ?? []).length,
  1,
  'night water-edge lift must not add texture samples',
);
assert.match(
  waterMaterialSource,
  /OPEN_WATER_SPECTRUM[\s\S]*?buildOpenWaterSpectrum/,
  'open bodies must retain the deterministic multi-band wave spectrum',
);
assert.match(
  waterMaterialSource,
  /shoreBreakBand[\s\S]*?shoreBreakSet[\s\S]*?openWaterFoam/,
  'coastal water must retain its depth-band shore break and crest foam',
);

disposeSharedRiverWaterMaterial();
const coastalMaterial = getSharedRiverWaterMaterial(shoreMaps, COASTAL_WATER_PROFILE);
assert.equal(coastalMaterial.name, 'CoastalWaterMaterial');
assert.equal(coastalMaterial.transmission, COASTAL_WATER_PROFILE.transmission);
assert.equal(coastalMaterial.attenuationDistance, COASTAL_WATER_PROFILE.attenuationDistance);
assert.equal(coastalMaterial.roughness, COASTAL_WATER_PROFILE.roughness);
assert.ok(coastalMaterial.positionNode, 'coastal profile must displace the water mesh');
assert.ok(coastalMaterial.normalNode, 'coastal profile must shade its spectral wave slopes');

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
