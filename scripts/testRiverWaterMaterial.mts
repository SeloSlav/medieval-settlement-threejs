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
  RIVER_OPEN_WATER_HIGHLIGHT_STRENGTH,
  RIVER_OPTICAL_SHORE_EXPONENT,
  RIVER_SKY_RETURN_STRENGTH,
  RIVER_VISUAL_SHORE_EXPONENT,
  RIVER_WATER_ATTENUATION_DISTANCE,
  RIVER_WATER_SURFACE_STYLE,
  RIVER_WATER_TRANSMISSION,
  setSharedRiverWaterDebugMode,
  setSharedRiverWaterNightAmount,
} from '../src/rivers/RiverWaterMaterial.ts';
import {
  ensureCattailEmergenceHeightMeters,
  REED_MAX_WATERLINE_FRACTION,
} from '../src/rivers/RiverReedHeight.ts';
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
  buildSpectralCascadeData,
  SPECTRAL_WATER_COMPUTE_SUBMISSIONS_PER_FRAME,
  SPECTRAL_WATER_CASCADES,
  SPECTRAL_WATER_DISPATCHES_PER_FRAME,
  SPECTRAL_WATER_RESOLUTION,
  SpectralWaterSimulation,
  validateSpectralIfft,
} from '../src/rivers/SpectralWaterSimulation.ts';
import {
  LILY_SHORE_REACH_METERS,
  lilyPadShorePresence,
} from '../src/rivers/RiverLilyPads.ts';
import {
  computeShoreStoneClusterDensity,
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
  'normal close-orbit grass must be visible as brown soil begins blending',
);
assert.ok(
  dirtZoomGate(42) > 0 && dirtZoomGate(42) < 0.1,
  'brown soil must begin subtly alongside the SeedThree grass transition',
);
assert.equal(resolveReedLod(42, false), grassBladeLodOpacity(overviewGrassLod));
assert.equal(reedLodOpacity(resolveReedLod(42, false)), grassBladeLodOpacity(overviewGrassLod));
assert.equal(isReedLodVisible(resolveReedLod(42, false)), true);
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
assert.ok(
  dirtZoomGate(BASELINE_CAMERA_DISTANCE / 2.1) > 0,
  '210% orbit view must begin revealing dirt with the emerging SeedThree grass',
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
  CLOSE_GROUND_FADE_START_ZOOM_PERCENT,
  'brown soil and SeedThree grass must begin at the same zoom boundary',
);
assert.equal(
  dirtZoomGate(BASELINE_CAMERA_DISTANCE / (DIRT_FADE_START_ZOOM_PERCENT / 100)),
  0,
  'brown soil must be absent exactly at the shared transition boundary',
);
assert.ok(
  dirtZoomGate(BASELINE_CAMERA_DISTANCE / (CLOSE_GROUND_FULL_ZOOM_PERCENT / 100)) > 0,
  'brown soil must be partially visible when SeedThree grass reaches full opacity',
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
assert.equal(SPECTRAL_WATER_RESOLUTION, 128);
assert.equal(SPECTRAL_WATER_DISPATCHES_PER_FRAME, 16);
assert.equal(SPECTRAL_WATER_COMPUTE_SUBMISSIONS_PER_FRAME, 1);
for (let index = 1; index < SPECTRAL_WATER_CASCADES.length; index++) {
  assert.equal(
    SPECTRAL_WATER_CASCADES[index - 1].cutoffHigh,
    SPECTRAL_WATER_CASCADES[index].cutoffLow,
    'adjacent spectral cascades must have one exact, non-overlapping handoff',
  );
}
const spectralDataA = buildSpectralCascadeData(16, SPECTRAL_WATER_CASCADES[0]);
const spectralDataB = buildSpectralCascadeData(16, SPECTRAL_WATER_CASCADES[0]);
assert.deepEqual(
  spectralDataA.initialSpectrum,
  spectralDataB.initialSpectrum,
  'spectral Gaussian seeds must be deterministic',
);
assert.deepEqual(spectralDataA.waveData, spectralDataB.waveData);
const ifftValidation = validateSpectralIfft(8);
assert.ok(ifftValidation.dcMaxError < 1e-5, 'centered DC IFFT must resolve to a constant field');
assert.ok(
  ifftValidation.frequencyMaxError < 1e-5,
  'centered one-bin IFFT must resolve to the expected complex sinusoid',
);
assert.ok(COASTAL_WATER_PROFILE.openWaterWaveScale > INLAND_WATER_PROFILE.openWaterWaveScale);
assert.ok(COASTAL_WATER_PROFILE.attenuationDistance > RIVER_WATER_PROFILE.attenuationDistance);
assert.ok(INLAND_WATER_PROFILE.standingWaveRatio > COASTAL_WATER_PROFILE.standingWaveRatio);

const computeCalls: unknown[][] = [];
const spectralSimulation = new SpectralWaterSimulation({
  compute: (nodes: unknown[]) => computeCalls.push(nodes),
} as never, 'inland');
const foamPing = spectralSimulation.binding.foamPing as unknown as { value: number };
assert.equal(foamPing.value, 0);
spectralSimulation.update(1, 1 / 60);
assert.equal(
  computeCalls.length,
  SPECTRAL_WATER_COMPUTE_SUBMISSIONS_PER_FRAME,
  'one frame must record the exact spectral dependency chain in one compute pass',
);
assert.equal(
  computeCalls[0].length,
  SPECTRAL_WATER_DISPATCHES_PER_FRAME * spectralSimulation.binding.cascades.length,
  'batching must preserve every per-cascade evolution, IFFT, and foam dispatch',
);
assert.equal(foamPing.value, 1);
spectralSimulation.update(2, 1 / 60);
assert.equal(computeCalls.length, 2);
assert.equal(foamPing.value, 0);
const foamDispatchCount = spectralSimulation.binding.cascades.length;
const stableDispatchCount = computeCalls[0].length - foamDispatchCount;
for (let index = 0; index < stableDispatchCount; index++) {
  assert.equal(
    computeCalls[0][index],
    computeCalls[1][index],
    'evolution and Stockham dispatch identities must keep exact stage-major order',
  );
}
for (let index = stableDispatchCount; index < computeCalls[0].length; index++) {
  assert.notEqual(
    computeCalls[0][index],
    computeCalls[1][index],
    'successive frames must select the opposite prebuilt foam-history writer',
  );
}
spectralSimulation.update(3, 1 / 60);
assert.equal(computeCalls[2], computeCalls[0], 'ping/pong command arrays must be reused without allocation');
assert.equal(foamPing.value, 1);
spectralSimulation.dispose();

const stoneVisualA = computeShoreStoneVisualScale(12, -8);
const stoneVisualB = computeShoreStoneVisualScale(25, 17);
assert.ok(stoneVisualA >= 0.58 && stoneVisualA <= 1.2);
assert.ok(stoneVisualB >= 0.58 && stoneVisualB <= 1.2);
assert.notEqual(stoneVisualA, stoneVisualB);
const stoneTint = computeShoreStoneTint(12, -8);
assert.ok(stoneTint >= 0.74 && stoneTint <= 0.98);
const stoneMoss = computeShoreStoneMoss(12, -8);
assert.ok(stoneMoss >= 0 && stoneMoss <= 1);
const stoneClusterA = computeShoreStoneClusterDensity(12, -8);
const stoneClusterB = computeShoreStoneClusterDensity(125, 81);
assert.ok(stoneClusterA >= 0 && stoneClusterA <= 1);
assert.ok(stoneClusterB >= 0 && stoneClusterB <= 1);
assert.notEqual(stoneClusterA, stoneClusterB);
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
  'the water film must retain controlled physical transmission',
);
assert.equal(material.transmission, 0.74);
assert.equal(material.thickness, 0.65);
assert.equal(material.attenuationDistance, RIVER_WATER_ATTENUATION_DISTANCE);
assert.equal(material.attenuationDistance, 2.65);
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
  RIVER_FLOW_HIGHLIGHT_STRENGTH >= 0.06
    && RIVER_FLOW_HIGHLIGHT_STRENGTH <= 0.08,
  'flow facets must remain subtle enough to avoid painted surface ribbons',
);
assert.ok(
  RIVER_OPEN_WATER_HIGHLIGHT_STRENGTH < RIVER_FLOW_HIGHLIGHT_STRENGTH,
  'sheltered open water must remain calmer than a directional current',
);
assert.ok(RIVER_SKY_RETURN_STRENGTH >= 0.15 && RIVER_SKY_RETURN_STRENGTH <= 0.17);
assert.equal(material.roughness, 0.285);
assert.equal(material.specularIntensity, 0.54);
assert.ok(material.normalNode, 'analytic water bands must drive the physical surface normal');
assert.ok(material.roughnessNode, 'resolved facets must modulate reflected highlight roughness');
assert.equal(
  material.userData.waterQualityTier,
  RIVER_WATER_SURFACE_STYLE.qualityTier,
);
assert.equal(material.userData.waterSurfaceProfile, 'river');
assert.deepEqual(material.userData.waterDebugModes, [
  'final',
  'normal',
  'fresnel',
  'surface-response',
  'flow-presence',
  'foam-field',
]);
const finalWaterColorNode = material.colorNode;
setSharedRiverWaterDebugMode('normal');
assert.notEqual(material.colorNode, finalWaterColorNode);
setSharedRiverWaterDebugMode('surface-response');
assert.notEqual(material.colorNode, finalWaterColorNode);
setSharedRiverWaterDebugMode('flow-presence');
assert.notEqual(material.colorNode, finalWaterColorNode);
setSharedRiverWaterDebugMode('foam-field');
assert.notEqual(material.colorNode, finalWaterColorNode);
setSharedRiverWaterDebugMode('final');
assert.equal(material.colorNode, finalWaterColorNode);
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
  /reedLodOpacity\(reedLod\)\s*\*\s*REED_PEAK_OPACITY/,
  'cattails must use the shared ground-blade opacity handoff',
);
assert.match(
  reedSource,
  /isReedLodVisible\(reedLod\)/,
  'cattails must stop submitting outside the close-ground zoom band',
);
assert.match(
  reedSource,
  /grassEdgeFadeFromFocusDistance[\s\S]*?hiddenMatrix/,
  'visible cattails must retain the bounded grass-focus radius',
);
assert.match(
  reedSource,
  /const inward[\s\S]*?- node\.outwardX \* inward[\s\S]*?- node\.outwardZ \* inward/,
  'primary cattail stands must grow inward from the shoreline into rendered shallows',
);
assert.match(
  reedSource,
  /if \(!riverField\.isRenderedWetAt\(px, pz\)\) continue/,
  'primary cattail stands must reject dry-bank placements',
);
assert.match(
  reedSource,
  /function resolveReedBaseY[\s\S]*?terrain\.getHeightAt\(placement\.x, placement\.z\)\s*\+\s*0\.03/,
  'all cattails, including submerged specimens, must root on terrain',
);
assert.match(
  reedSource,
  /createCattailGeometry\(\{[\s\S]*?width:\s*REED_CARD_WIDTH,[\s\S]*?baseSpread:\s*REED_CARD_BASE_SPREAD/,
  'cattail cards must use the broader established-clump geometry',
);
assert.match(
  reedSource,
  /mesh\.renderOrder\s*=\s*REED_RENDER_ORDER/,
  'cattails must render before the transparent water film so submerged stems remain visibly underwater',
);
assert.match(
  reedSource,
  /material\.transparent\s*=\s*false[\s\S]*?material\.alphaHash\s*=\s*REED_USES_OPAQUE_CUTOUT_PASS[\s\S]*?material\.depthWrite\s*=\s*true/,
  'cattails must render as alpha-hashed depth-writing cutouts before the transmissive water pass',
);
assert.doesNotMatch(
  reedSource,
  /material\.transparent\s*=\s*useTransparency/,
  'cattail LOD must not move the cards back into the post-water transparent pass',
);
assert.equal(
  ensureCattailEmergenceHeightMeters(2.1, 1.05),
  2.1,
  'a mature cattail should retain its sampled physical height',
);
const raisedYoungCattail = ensureCattailEmergenceHeightMeters(0.8, 1.05);
assert.ok(
  raisedYoungCattail > 1.05,
  'a short cattail must retain an emergent crown above the waterline',
);
assert.ok(
  1.05 / raisedYoungCattail <= REED_MAX_WATERLINE_FRACTION + 1e-9,
  'the waterline must not swallow more than the authored fraction of a cattail card',
);
assert.match(
  reedSource,
  /cattailPatchPresence\(node\.x, node\.z\)[\s\S]*?REED_STAND_CHANCE_MIN[\s\S]*?REED_STAND_CHANCE_MAX/,
  'cattails must form deterministic macro patches with broad shoreline gaps',
);
assert.match(
  reedSource,
  /sampleReedClusterCount\(rng, 1, 6\)/,
  'primary cattail stands must vary from isolated clumps through small colonies',
);
assert.match(
  reedSource,
  /width \* placement\.widthScaleX \* fade[\s\S]*?width \* placement\.widthScaleZ \* fade/,
  'cattail footprints must vary independently instead of repeating one circular scale',
);
assert.match(
  reedSource,
  /resolveReedHeightMeters\(shore, rng\) \* heightScale[\s\S]*?REED_HEIGHT_MIN_METERS[\s\S]*?REED_HEIGHT_MAX_METERS/,
  'cattail height cohorts must receive bounded per-clump and per-stand variation',
);
assert.equal(
  (reedSource.match(/new THREE\.InstancedMesh/g) ?? []).length,
  1,
  'reed LOD must retain the existing single instanced draw',
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
  /riverField\.layout\.isInlandWaterAt\(x, z\)/,
  'lily pads must be restricted to ponds and lakes, never river channels or the sea',
);
assert.match(
  lilyPadSource,
  /opacity:\s*LILY_PEAK_OPACITY[\s\S]*?mesh\.visible\s*=\s*placements\.length\s*>\s*0/,
  'lily pads must render immediately at fixed opacity at every zoom level',
);
assert.doesNotMatch(
  lilyPadSource,
  /grassBladeRevealOpacity|grassBladeLodOpacity|cameraDistance|firstPersonActive/,
  'lily-pad visibility must remain independent of camera zoom and view mode',
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
  /const sceneBehind = \(viewportSharedTexture\(refractUv\)/,
  'the restored water must keep its single screen-space refraction sample',
);
assert.doesNotMatch(
  waterMaterialSource,
  /riverSkyZenith|skyReflection|reflectedSurface|nearReflection|farReflection/,
  'the translucent water path must not compile the dynamic sky or surroundings reflection shader',
);
assert.match(
  waterMaterialSource,
  /COASTAL_SHALLOW_WATER_TINT[\s\S]*?profile\.seaTintStrength/,
  'the bounded coastal profile must shift the common water family toward clear blue',
);
assert.doesNotMatch(
  waterMaterialSource,
  /buildGpuSpectralWater|SpectralWaterBinding|viewportDepthTexture|linearDepth/,
  'the restored material must not retain spectral-field or depth-absorption shader work',
);
assert.doesNotMatch(
  waterMaterialSource,
  /ribbonCarrier|ribbonCrest|flowCross\.mul\((?:1\.85|3\.45)\)/,
  'water must not restore the powered cross-flow ribbon lattice',
);
assert.match(
  waterMaterialSource,
  /const flowPresence = smoothstep\([\s\S]*?flowLenSq/,
  'quantized neutral flow must resolve to a bounded still-water mask',
);
assert.match(
  waterMaterialSource,
  /aaStart[\s\S]*?aaEnd[\s\S]*?fwidth\(phase\)/,
  'sub-pixel normal bands must fade by their screen-space footprint',
);
assert.match(
  waterMaterialSource,
  /material\.normalNode = nodes\.normalNode/,
  'physical lighting must use the same resolved analytic surface normal',
);
assert.match(
  waterMaterialSource,
  /shoreBreakScale[\s\S]*?profile\.shoreBreakStrength/,
  'shore breakup must scale the foam body rather than only raising its cap',
);
assert.doesNotMatch(
  waterMaterialSource,
  /setSharedRiverWaterReflectionState|computeRiverWaterSkyPalette/,
  'day/night updates must not maintain reflection-only uniforms',
);
assert.equal(
  (waterMaterialSource.match(/viewportSharedTexture\(/g) ?? []).length,
  1,
  'water must use one refraction tap and no reflection taps',
);
assert.equal(
  (waterMaterialSource.match(/\btexture\(/g) ?? []).length,
  1,
  'material source must retain only the shoreline map texture binding',
);
assert.match(
  waterMaterialSource,
  /material\.transmission = profile\.transmission/,
  'the controlled-transmission path must follow the selected water profile',
);
assert.match(
  waterMaterialSource,
  /const skyReturn = \(float\(0\.055\)/,
  'strategic top-down views need a nonzero surface return so water cannot read as meadow',
);
assert.match(
  waterMaterialSource,
  /mix\(float\(0\.46\)[\s\S]*?float\(0\.68\)[\s\S]*?opticalDepthFactor/,
  'the water volume must retain enough body opacity to separate it from terrain',
);
assert.match(
  waterMaterialSource,
  /const waterTint = mix\(layeredDeepTint, profileShallowTint, bankBedReveal\)/,
  'all profiles must retain the same depth transition after their restrained palette shift',
);
assert.match(
  waterMaterialSource,
  /sharedWaterProfile === profile/,
  'material caching must invalidate when a same-id profile object is retuned',
);

disposeSharedRiverWaterMaterial();
const restoredMaterial = getSharedRiverWaterMaterial(shoreMaps);
assert.equal(restoredMaterial.name, 'RiverWaterMaterial');
assert.equal(restoredMaterial.transmission, 0.74);
assert.equal(restoredMaterial.attenuationDistance, 2.65);
assert.equal(restoredMaterial.roughness, 0.285);
assert.ok(restoredMaterial.positionNode, 'the restored material must keep animated river motion');
assert.ok(restoredMaterial.normalNode, 'the restored material must keep analytic surface normals');

disposeSharedRiverWaterMaterial();
const inlandMaterial = getSharedRiverWaterMaterial(shoreMaps, INLAND_WATER_PROFILE);
assert.equal(inlandMaterial.name, 'InlandWaterMaterial');
assert.equal(inlandMaterial.transmission, INLAND_WATER_PROFILE.transmission);
assert.equal(inlandMaterial.attenuationDistance, INLAND_WATER_PROFILE.attenuationDistance);
assert.equal(inlandMaterial.userData.waterSurfaceProfile, 'inland');
assert.ok(inlandMaterial.normalNode);

disposeSharedRiverWaterMaterial();
const coastalMaterial = getSharedRiverWaterMaterial(shoreMaps, COASTAL_WATER_PROFILE);
assert.equal(coastalMaterial.name, 'CoastalWaterMaterial');
assert.equal(coastalMaterial.transmission, COASTAL_WATER_PROFILE.transmission);
assert.equal(coastalMaterial.thickness, 1.05);
assert.equal(coastalMaterial.userData.waterSurfaceProfile, 'coastal');
assert.ok(coastalMaterial.normalNode);

const retunedCoastalProfile = {
  ...COASTAL_WATER_PROFILE,
  roughness: 0.31,
} as const;
const retunedCoastalMaterial = getSharedRiverWaterMaterial(
  shoreMaps,
  retunedCoastalProfile,
);
assert.notEqual(retunedCoastalMaterial, coastalMaterial);
assert.equal(retunedCoastalMaterial.roughness, 0.31);
assert.equal(retunedCoastalMaterial.userData.waterSurfaceProfile, 'coastal');

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
    + 'the legible controlled-transmission refraction path remains active. '
    + `Hidden-reed benchmark: ${oldElapsedMs.toFixed(1)}ms/${oldHiddenUploadBytes.toLocaleString()} bytes `
    + `-> ${optimizedElapsedMs.toFixed(1)}ms/${optimizedHiddenUploadBytes.toLocaleString()} bytes.`,
);
