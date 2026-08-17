import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import {
  createTerrainGrassMaterial,
  createTerrainGrassMaterialWithRiverShore,
  TERRAIN_FULL_RAIN_ALBEDO_DETAIL_FLOOR,
  TERRAIN_FULL_RAIN_AO_DETAIL_FLOOR,
  TERRAIN_FULL_RAIN_DIRT_DETAIL_FLOOR,
  TERRAIN_FULL_RAIN_NORMAL_DETAIL_FLOOR,
  TERRAIN_FULL_RAIN_ROUGHNESS_DETAIL_FLOOR,
  TERRAIN_ROAD_WEAR_BLEND_FLOOR,
  TERRAIN_SHORE_BLEND_FLOOR,
  TERRAIN_SHORE_RAIN_FADE_END,
  TERRAIN_SHORE_RAIN_FADE_START,
  TERRAIN_SNOW_MAX_COVERAGE,
  TERRAIN_SNOW_REVEAL_RANGE,
  TERRAIN_SNOW_REVEAL_WIDTH,
  TERRAIN_SNOW_TEXTURE_WEIGHT,
  mirroredTerrainAtlasCoordinate,
  stableTerrainBlendWeight,
  terrainShoreRainVisibility,
} from '../src/terrain/TerrainGrassMaterial.ts';
import { createRoadWeatherUniforms } from '../src/roads/RoadSurfaceMaterial.ts';
import type {
  TerrainBlendTextureSet,
  TextureSet,
} from '../src/roads/RoadTextureLoader.ts';
import {
  createTerrainGeometry,
  FOREST_FLOOR_BLEND_END,
  FOREST_FLOOR_BLEND_START,
  forestFloorBlendAtDensity,
  type TerrainGeometryData,
} from '../src/terrain/terrainGeometryData.ts';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const source = readFileSync(
  `${projectRoot}src/terrain/TerrainGrassMaterial.ts`,
  'utf8',
);
const textureLoaderSource = readFileSync(
  `${projectRoot}src/roads/RoadTextureLoader.ts`,
  'utf8',
);
const terrainGeometrySource = readFileSync(
  `${projectRoot}src/terrain/terrainGeometryData.ts`,
  'utf8',
);

const ecologyStart = source.indexOf('function buildGrassBlendNodes');
const ecologyEnd = source.indexOf('function buildTerrainSnowNodes');
assert.ok(ecologyStart >= 0 && ecologyEnd > ecologyStart);
const ecologySource = source.slice(ecologyStart, ecologyEnd);

assert.match(ecologySource, /Low-frequency samples of the authored grass maps/);
assert.match(ecologySource, /const meadowPatchUv =/);
assert.match(ecologySource, /const densePatchUv =/);
assert.match(ecologySource, /const dryPatchUv =/);
assert.match(ecologySource, /const meadowPatch = smoothstep/);
assert.match(ecologySource, /const densePatch = smoothstep/);
assert.match(ecologySource, /const dryPatch = smoothstep/);
assert.equal(
  (ecologySource.match(/\.level\(float\(2\)/g) ?? []).length,
  3,
  'all strategic coverage samples must use a coarse mip instead of individual grass clumps',
);
assert.doesNotMatch(
  ecologySource,
  /macroWarp|world\.x[\s\S]*?sin\(/,
  'overview coverage must not regress to map-spanning directional waves',
);
assert.match(ecologySource, /attribute\('normal', 'vec3'\)/);
assert.match(ecologySource, /const lowland = sub/);
assert.match(ecologySource, /const moisture = smoothstep/);
assert.match(ecologySource, /const drainageFold = smoothstep/);
assert.match(ecologySource, /const forestEdge = smoothstep/);
assert.match(ecologySource, /const texelFootprint = max/);
assert.match(ecologySource, /fwidth\(grassUv\.x\)/);
assert.match(ecologySource, /fwidth\(grassUv\.y\)/);
assert.match(ecologySource, /const closeMaterialDetail = zoomDetailGate\.mul\(footprintDetailGate\)/);
assert.match(ecologySource, /const denseUv = vec2/);
assert.match(ecologySource, /const dryUv = vec2/);
assert.match(ecologySource, /packedDrySnowUv\(dryUv, false\)/);
assert.match(ecologySource, /const lightOverlap = smoothstep/);
assert.match(ecologySource, /const darkOverlap = smoothstep/);
assert.match(ecologySource, /const dryOverlap = smoothstep/);
assert.match(ecologySource, /const overviewLightWeight =/);
assert.match(ecologySource, /const overviewDarkWeight =/);
assert.match(ecologySource, /const overviewDryWeight =/);
assert.match(ecologySource, /const meadowGrain = smoothstep/);
assert.match(ecologySource, /const denseGrain = smoothstep/);
assert.match(ecologySource, /const dryGrain = smoothstep/);
assert.match(ecologySource, /const overviewTexturedColor = mix/);
assert.match(ecologySource, /float\(0\.88\)/);
assert.match(ecologySource, /const grassStableColorNode = mix/);
assert.match(
  ecologySource,
  /overviewLightColor = vec3\(0\.12, 0\.24, 0\.045\)[\s\S]*?overviewDarkColor = vec3\(0\.022, 0\.052, 0\.01\)[\s\S]*?overviewDryColor = vec3\(0\.2, 0\.225, 0\.065\)/,
  'strategic terrain families should favor meadow green over the former yellow cast',
);
assert.match(ecologySource, /const stableColorNode = mix\([\s\S]*?forestStableColorNode[\s\S]*?forestBlend/);
assert.match(ecologySource, /const colorNode = mix\([\s\S]*?forestColorNode[\s\S]*?forestBlend/);
assert.doesNotMatch(
  ecologySource,
  /const (?:macroTint|ecologyTint|forestTint|drainageTint|hierarchyTint|broadSoilValue) =/,
  'fair-weather terrain must preserve the authored grass-to-dirt blend instead of applying a green ecology wash',
);
assert.match(ecologySource, /const rainMoisture = smoothstep/);
assert.match(ecologySource, /const grassRainStableColorNode = rainMacroColor/);
assert.match(
  ecologySource,
  /const rainStableColorNode = mix\([\s\S]*?forestRainStableColorNode[\s\S]*?forestBlend/,
);
assert.match(
  ecologySource,
  /const grassColorNode = mix\(\s*overviewTexturedColor,\s*blendedColor,\s*closeMaterialDetail/,
);
assert.match(ecologySource, /attribute\('forestBlend', 'float'\)/);
assert.match(ecologySource, /packedForestLitterUv\(forestUv\)/);
assert.match(ecologySource, /packedForestLitterGradient\(forestUv\.dFdx\(\)\)/);
assert.match(ecologySource, /packedForestLitterGradient\(forestUv\.dFdy\(\)\)/);
assert.match(
  ecologySource,
  /const forestGrain = smoothstep\([\s\S]*?float\(0\.008\)[\s\S]*?float\(0\.12\)[\s\S]*?forestLuminance/,
  'leaf-litter contrast must be resolved over the authored albedo luminance range',
);
assert.match(
  ecologySource,
  /const forestDetailColorNode = forestColor\.rgb;/,
  'close leaf litter must preserve the authored albedo without a second dark tint',
);
assert.match(
  ecologySource,
  /const forestDetailStableColorNode = mix\([\s\S]*?vec3\(0\.024, 0\.015, 0\.01\)[\s\S]*?vec3\(0\.16, 0\.095, 0\.055\)/,
  'the stable leaf-litter remap must retain the source texture mean luminance',
);
assert.match(
  ecologySource,
  /const forestOverviewColorNode = mix\([\s\S]*?vec3\(0\.032, 0\.02, 0\.012\)[\s\S]*?vec3\(0\.092, 0\.055, 0\.03\)/,
  'strategic forest-floor colors must remain readable before scene lighting',
);
assert.match(
  ecologySource,
  /const forestOverviewTexturedColorNode = mix\([\s\S]*?forestOverviewColorNode[\s\S]*?forestDetailStableColorNode[\s\S]*?float\(0\.72\)/,
  'the authored leaf-litter grain must remain visible at strategic zoom',
);
assert.match(ecologySource, /const forestColorNode = mix\([\s\S]*?forestOverviewTexturedColorNode[\s\S]*?forestDetailColorNode[\s\S]*?closeMaterialDetail/);
assert.match(ecologySource, /const forestStableColorNode = mix\([\s\S]*?forestOverviewTexturedColorNode[\s\S]*?forestDetailStableColorNode[\s\S]*?closeMaterialDetail/);
assert.match(ecologySource, /const forestBumpNode = bumpMap/);
assert.match(ecologySource, /const forestNormalNode = normalize\([\s\S]*?forestBumpNode[\s\S]*?closeMaterialDetail\.mul\(rainNormalVisibility\)/);
assert.match(ecologySource, /const forestRoughnessNode = mix/);
assert.match(
  ecologySource,
  /const forestDetailAoNode = mix\([\s\S]*?float\(0\.9\)[\s\S]*?float\(0\.99\)[\s\S]*?forestGrain/,
  'close leaf litter must retain soft AO rather than being darkened twice',
);
assert.match(
  ecologySource,
  /const forestAoNode = mix\([\s\S]*?float\(0\.95\)[\s\S]*?forestDetailAoNode/,
  'strategic forest-floor AO must preserve ambient readability',
);
assert.match(ecologySource, /vec3\(0\.12, 0\.24, 0\.045\)/);
assert.match(ecologySource, /vec3\(0\.022, 0\.052, 0\.01\)/);
assert.match(ecologySource, /vec3\(0\.2, 0\.225, 0\.065\)/);
assert.match(ecologySource, /const normalDetailStrength = mix/);
assert.match(ecologySource, /const rainNormalVisibility = mix/);
assert.match(source, /const weatherResolvedRoadWear = roadWear\.mul\(shoreRainVisibility\)/);
assert.match(ecologySource, /const rainAoVisibility = mix/);
assert.match(ecologySource, /float\(0\.1\)/);
assert.match(ecologySource, /vec3\(0\.5, 0\.5, 1\)/);
assert.match(ecologySource, /const roughnessDetailStrength = mix/);
assert.match(ecologySource, /const aoDetailStrength = mix/);
assert.match(ecologySource, /float\(0\.3\)/);
assert.match(ecologySource, /function applyRiparianEcologyColor/);
assert.match(
  ecologySource,
  /const riparianReach = shoreBlend\.mul\(float\(0\.34\)/,
);
assert.doesNotMatch(
  ecologySource,
  /pow\([\s\S]*?shoreBlend,[\s\S]*?float\(0\.[0-9]+\)/,
  'riparian color must not amplify near-zero shore coverage into a dark contour',
);
assert.doesNotMatch(
  ecologySource,
  /\bfract\b|\bfloor\b|\bmod\b/,
  'the ecological pass must not regress to visibly tiled hash/checker cells',
);
const rainMoistureStart = ecologySource.indexOf('const rainMoisture = smoothstep');
const rainMoistureEnd = ecologySource.indexOf('const moisture = smoothstep');
assert.ok(rainMoistureStart >= 0 && rainMoistureEnd > rainMoistureStart);
const rainMoistureSource = ecologySource.slice(rainMoistureStart, rainMoistureEnd);
assert.doesNotMatch(
  rainMoistureSource,
  /\bw\.|lowland|world\.y|geometricNormal|slope|texture\(|sin\(/,
  'full-rain drainage must use fragment macro fields, not vertex-biome, height, or normal inputs',
);
assert.match(
  rainMoistureSource,
  /macroA[\s\S]*?float\(0\.36\)[\s\S]*?macroB[\s\S]*?float\(0\.64\)/,
  'full-rain drainage must retain a normalized blend of the existing fragment macro fields',
);
const rainColorStart = ecologySource.indexOf('const rainMacro =');
const rainColorEnd = ecologySource.indexOf('const stableColorNode =');
assert.ok(rainColorStart >= 0 && rainColorEnd > rainColorStart);
const rainColorSource = ecologySource.slice(rainColorStart, rainColorEnd);
assert.doesNotMatch(
  rainColorSource,
  /\bw\.|geometricNormal|slope|texture\(|sin\(/,
  'full-rain color must reuse fragment macro fields without vertex-biome derivatives or new samples',
);
assert.equal(
  (source.match(/\btexture\(/g) ?? []).length,
  27,
  'layered close soil, packed snow/leaf atlas and reused albedo coverage samples must retain a bounded texture budget',
);
assert.match(source, /function mirroredTerrainAtlasUv/);
assert.match(source, /const tileUv = mirroredTerrainAtlasUv\(grassUv\)/);
assert.match(source, /const tileUv = mirroredTerrainAtlasUv\(forestUv\)/);
assert.doesNotMatch(
  source,
  /const tileUv = fract\(/,
  'packed terrain atlas tiles must not jump directly between unmatched image edges',
);
assert.deepEqual(
  [-1, -0.5, 0, 0.5, 1, 1.5, 2].map(mirroredTerrainAtlasCoordinate),
  [1, 0.5, 0, 0.5, 1, 0.5, 0],
  'packed terrain atlas coordinates must alternate direction across each tile',
);
for (let boundary = -4; boundary <= 4; boundary += 1) {
  const epsilon = 1e-7;
  assert.ok(
    Math.abs(
      mirroredTerrainAtlasCoordinate(boundary - epsilon)
      - mirroredTerrainAtlasCoordinate(boundary + epsilon),
    ) < epsilon * 3,
    `packed terrain atlas sampling must remain continuous across UV boundary ${boundary}`,
  );
}
assert.equal(
  (source.match(/\bsin\(/g) ?? []).length,
  0,
  'terrain ecology must avoid directional trigonometric bands',
);
assert.equal(
  (source.match(/new MeshStandardNodeMaterial\(\)/g) ?? []).length,
  2,
  'the ecological hierarchy must remain within the existing terrain draws',
);
assert.match(source, /applyTerrainWetColor/);
assert.match(
  source,
  /const weatherStableColor = mix\(\s*stableColor,\s*rainStableColor,\s*weather\.wetness/,
);
assert.match(
  source,
  /const weatherMoisture = mix\(\s*moisture,\s*rainMoisture,\s*weather\.wetness/,
);
assert.match(source, /buildTerrainWetMask\(weatherMoisture,\s*weather\)/);
assert.match(source, /const rainDirtVisibility = mix/);
assert.match(source, /function buildLayeredDirtGroundNodes/);
assert.match(source, /const broadUv = grassUv\.mul\(float\(1\.72\)/);
assert.match(source, /const detailUv = grassUv\.mul\(float\(6\.4\)/);
assert.match(source, /const pebbleUv = grassUv\.mul\(float\(3\.35\)/);
assert.match(source, /const bumpHeight = broadHeight/);
assert.match(source, /bumpMap\(\s*bumpHeight/);
assert.match(source, /const greyBrownSoil = mix/);
assert.match(source, /float\(0\.72\)/);
assert.match(source, /vec3\(1\.244, 1\.121, 1\.041\)/);
assert.match(
  source,
  /const dirtSurfaceAmount = dirtAmount/,
  'brown soil must retain the full gradual close-ground zoom handoff',
);
assert.match(
  source,
  /const baseColorNode = mix\(\s*grassOrDirtColorNode,\s*blendNodes\.forestColorNode,\s*forestSurfaceBlend/,
  'forest litter must override both overview grass and close dirt after their zoom handoff',
);
assert.match(
  source,
  /const forestSurfaceBlend = blendNodes\.forestBlend\.mul\([\s\S]*?wornMask/,
  'forest litter must retain a smooth edge while yielding to roads, banks, and quarry pads',
);
assert.match(
  source,
  /const rainStableGrassOrDirtColorNode = applyCloseZoomDirtBlend\([\s\S]*?dirtSurface\.colorNode[\s\S]*?dirtSurfaceAmount[\s\S]*?const rainStableBaseColorNode = mix/,
  'rain must retain the authored layered dirt albedo instead of resolving to green meadow',
);
assert.match(source, /dirtSurface\.normalNode/);
assert.match(source, /dirtSurface\.roughnessNode/);
assert.match(source, /dirtSurface\.aoNode/);
assert.doesNotMatch(
  source,
  /texture\(roadTextures\.(?:normal|ao|height)/,
  'layered soil must reuse existing bindings instead of exceeding portable WebGPU texture limits',
);
assert.match(source, /applyTerrainRainHaze/);
assert.match(source, /const flatFrostExposure = mix/);
assert.match(source, /const broadFrostExposure = smoothstep/);
assert.match(source, /const ecologicalShelter = max/);
assert.match(source, /blendNodes\.frostExposure/);
assert.match(source, /buildTerrainSnowNodes/);
assert.match(source, /weather\.wetness/);
assert.match(source, /weather\.frost/);
assert.doesNotMatch(
  source,
  /const roadWearHalo =/,
  'road wear must not restore a sublinear near-zero halo around the road mesh',
);
assert.match(
  source,
  /const shoreBlend = smoothstep\([\s\S]*?TERRAIN_SHORE_BLEND_FLOOR/,
);
assert.match(
  source,
  /const roadWear = smoothstep\([\s\S]*?TERRAIN_ROAD_WEAR_BLEND_FLOOR/,
);
assert.match(source, /const shoreRainVisibility = sub/);
assert.match(
  source,
  /const weatherResolvedShoreBlend = shoreBlend\.mul\(shoreRainVisibility\)/,
);
assert.match(
  source,
  /const terrainColorShoreBlend = float\(0\)/,
  'the exposed terrain must leave river color blending to the feathered bank mesh',
);
assert.match(
  source,
  /const terrainColorRoadWear = float\(0\)/,
  'the exposed terrain must leave road color blending to the feathered shoulder mesh',
);
assert.match(
  source,
  /buildCloseZoomDirtAmount\([\s\S]*?weatherResolvedShoreBlend/,
);
assert.match(
  source,
  /const snowExposure = \(sub\([\s\S]*?shoreBlend\.mul\(float\(0\.82\)/,
);
assert.match(
  source,
  /const wornMask = max\(max\(shoreBlend, roadWear\) as TslNode, quarryPad\)/,
);
assert.equal(
  TERRAIN_FULL_RAIN_ALBEDO_DETAIL_FLOOR,
  1,
  'full rain must preserve the authored grass albedo textures',
);
assert.ok(
  TERRAIN_FULL_RAIN_NORMAL_DETAIL_FLOOR <= 0.05,
  'full-rain normal detail must remain below the visible perspective-boundary floor',
);
assert.ok(
  TERRAIN_FULL_RAIN_AO_DETAIL_FLOOR <= 0.05,
  'full-rain AO detail must remain below the visible perspective-boundary floor',
);
assert.ok(
  TERRAIN_FULL_RAIN_ROUGHNESS_DETAIL_FLOOR <= 0.1,
  'full-rain roughness variation must remain restrained',
);
assert.equal(
  TERRAIN_FULL_RAIN_DIRT_DETAIL_FLOOR,
  1,
  'full rain must preserve the camera-proximity dirt texture transition',
);
assert.equal(TERRAIN_SHORE_RAIN_FADE_START, 0.08);
assert.equal(TERRAIN_SHORE_RAIN_FADE_END, 0.72);
assert.equal(
  stableTerrainBlendWeight(TERRAIN_SHORE_BLEND_FLOOR * 0.5, TERRAIN_SHORE_BLEND_FLOOR),
  0,
  'sub-floor river interpolation residue must resolve to exact zero',
);
assert.equal(
  stableTerrainBlendWeight(TERRAIN_ROAD_WEAR_BLEND_FLOOR, TERRAIN_ROAD_WEAR_BLEND_FLOOR),
  0,
  'the road-wear floor must resolve to exact zero',
);
assert.equal(
  stableTerrainBlendWeight(1, TERRAIN_SHORE_BLEND_FLOOR),
  1,
  'the stable river mask must retain full authored coverage',
);
assert.ok(
  stableTerrainBlendWeight(0.1, TERRAIN_SHORE_BLEND_FLOOR) < 0.02,
  'low river coverage must stay visually negligible instead of being power-amplified',
);
assert.ok(
  stableTerrainBlendWeight(0.1, TERRAIN_ROAD_WEAR_BLEND_FLOOR) < 0.02,
  'low road coverage must stay visually negligible instead of becoming a dark halo',
);
assert.equal(
  terrainShoreRainVisibility(0),
  1,
  'dry terrain must preserve the authored shore ecology exactly',
);
assert.equal(
  terrainShoreRainVisibility(TERRAIN_SHORE_RAIN_FADE_START),
  1,
  'the shore mask must remain unchanged through the start of the rain fade',
);
assert.ok(
  Math.abs(
    terrainShoreRainVisibility(
      (TERRAIN_SHORE_RAIN_FADE_START + TERRAIN_SHORE_RAIN_FADE_END) * 0.5,
    ) - 0.5,
  ) < 1e-12,
  'the shared shore mask must fade smoothly rather than pop',
);
assert.equal(
  terrainShoreRainVisibility(TERRAIN_SHORE_RAIN_FADE_END),
  0,
  'sustained rain must remove the broad vertex shore field from terrain shading',
);
assert.equal(
  terrainShoreRainVisibility(1),
  0,
  'full rain must not leave a dotted shore-field contribution',
);
for (const wetness of [0, 0.25, 0.5, 0.75, 1]) {
  const sampledAlbedoContribution = 1 - wetness;
  const vertexStableContribution = wetness * (1 - wetness);
  const fragmentStableContribution = wetness * wetness;
  assert.ok(
    Math.abs(
      sampledAlbedoContribution
      + vertexStableContribution
      + fragmentStableContribution
      - 1
    ) < 1e-12,
    `rain ecology contributions must remain energy-normalized at wetness ${wetness}`,
  );
  if (wetness === 0) {
    assert.deepEqual(
      [sampledAlbedoContribution, vertexStableContribution, fragmentStableContribution],
      [1, 0, 0],
      'dry terrain must remain entirely on the existing sampled color path',
    );
  }
  if (wetness === 1) {
    assert.deepEqual(
      [sampledAlbedoContribution, vertexStableContribution, fragmentStableContribution],
      [0, 0, 1],
      'full rain must eliminate vertex-biome color influence',
    );
  }
}
assert.ok(
  TERRAIN_SNOW_REVEAL_RANGE >= 1,
  'winter progression must sweep the reveal threshold across the full macro field',
);
assert.ok(
  TERRAIN_SNOW_REVEAL_WIDTH >= 0.15 && TERRAIN_SNOW_REVEAL_WIDTH <= 0.3,
  'settled snow boundaries must stay soft without becoming a uniform cross-fade',
);
assert.ok(
  TERRAIN_SNOW_TEXTURE_WEIGHT >= 0.4 && TERRAIN_SNOW_TEXTURE_WEIGHT <= 0.7,
  'authored snow relief and macro patches must both remain visible',
);
assert.ok(
  TERRAIN_SNOW_MAX_COVERAGE >= 0.9 && TERRAIN_SNOW_MAX_COVERAGE < 1,
  'exposed winter ground should become snow-covered while retaining slight terrain variation',
);
assert.match(source, /packedDrySnowUv\(grassUv, true\)/);
assert.match(textureLoaderSource, /snow_leaf_albedo_atlas\.png/);
assert.match(source, /const revealStart = sub/);
assert.match(source, /\.mul\(exposure\)/);
assert.match(source, /function resolveTerrainWeather/);
assert.match(source, /if \(weather\?\.wetness && weather\?\.frost\) return weather/);

assert.equal(forestFloorBlendAtDensity(FOREST_FLOOR_BLEND_START - 0.01), 0);
assert.equal(forestFloorBlendAtDensity(FOREST_FLOOR_BLEND_START), 0);
assert.equal(forestFloorBlendAtDensity(FOREST_FLOOR_BLEND_END), 1);
assert.equal(forestFloorBlendAtDensity(FOREST_FLOOR_BLEND_END + 0.01), 1);
assert.equal(
  forestFloorBlendAtDensity(1, true),
  0,
  'forest litter must never be painted onto rendered river water',
);
assert.match(
  terrainGeometrySource,
  /forestFloorBlendAtDensity\([\s\S]*?riverField\?\.isRenderedWetAt\(x, z\)/,
  'terrain generation must feed the rendered-water mask into the forest-floor blend',
);
assert.ok(
  Math.abs(
    forestFloorBlendAtDensity(
      (FOREST_FLOOR_BLEND_START + FOREST_FLOOR_BLEND_END) * 0.5,
    ) - 0.5,
  ) < 1e-12,
  'the contiguous-forest boundary must crossfade smoothly at its midpoint',
);

const terrainGeometryData: TerrainGeometryData = {
  resolution: 2,
  positions: new Float32Array([
    -1, 0, -1,
    1, 0, -1,
    -1, 0, 1,
    1, 0, 1,
  ]),
  normals: new Float32Array([
    0, 1, 0,
    0, 1, 0,
    0, 1, 0,
    0, 1, 0,
  ]),
  uvs: new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
  colors: new Float32Array([
    1, 0, 0,
    0, 1, 0,
    0, 0, 1,
    1 / 3, 1 / 3, 1 / 3,
  ]),
  forestBlends: new Float32Array([0.1, 0.2, 0.3, 0.4]),
  shoreBlends: new Float32Array([0.5, 0.6, 0.7, 0.8]),
  quarryPadBlends: new Float32Array([0.9, 0.8, 0.7, 0.6]),
  indices: new Uint32Array([0, 2, 1, 1, 2, 3]),
  boundingSphere: { center: [0, 0, 0], radius: Math.SQRT2 },
};
const terrainGeometry = createTerrainGeometry(terrainGeometryData);
const forestBlendAttribute = terrainGeometry.getAttribute('forestBlend') as THREE.InterleavedBufferAttribute;
const shoreBlendAttribute = terrainGeometry.getAttribute('shoreBlend') as THREE.InterleavedBufferAttribute;
const quarryPadAttribute = terrainGeometry.getAttribute('quarryPadBlend') as THREE.InterleavedBufferAttribute;
assert.ok(forestBlendAttribute.isInterleavedBufferAttribute);
assert.equal(forestBlendAttribute.data, shoreBlendAttribute.data);
assert.equal(forestBlendAttribute.data, quarryPadAttribute.data);
assert.equal(forestBlendAttribute.getX(2), terrainGeometryData.forestBlends[2]);
assert.equal(shoreBlendAttribute.getX(2), terrainGeometryData.shoreBlends[2]);
assert.equal(quarryPadAttribute.getX(2), terrainGeometryData.quarryPadBlends[2]);
const terrainVertexBuffers = new Set(
  Object.values(terrainGeometry.attributes).map((attribute) => (
    (attribute as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute
      ? (attribute as THREE.InterleavedBufferAttribute).data
      : attribute
  )),
);
assert.ok(
  terrainVertexBuffers.size <= 8,
  `terrain geometry must fit WebGPU's portable eight vertex-buffer slots; got ${terrainVertexBuffers.size}`,
);
terrainGeometry.dispose();

function textureSet(): TextureSet {
  return {
    albedo: new THREE.Texture(),
    normal: new THREE.Texture(),
    roughness: new THREE.Texture(),
    ao: new THREE.Texture(),
    height: new THREE.Texture(),
  };
}

const grassTextures: TerrainBlendTextureSet = {
  meadow: textureSet(),
  dense: textureSet(),
  dry: textureSet(),
};
const roadTextures = textureSet();
const weather = createRoadWeatherUniforms();

const constructorCases = [
  {
    label: 'plain terrain with live weather uniforms',
    create: () => createTerrainGrassMaterial(grassTextures, weather),
  },
  {
    label: 'river-shore terrain with live weather uniforms',
    create: () => createTerrainGrassMaterialWithRiverShore(
      grassTextures,
      roadTextures,
      weather,
    ),
  },
  {
    label: 'plain terrain dry fallback',
    create: () => createTerrainGrassMaterial(grassTextures),
  },
  {
    label: 'river-shore terrain dry fallback',
    create: () => createTerrainGrassMaterialWithRiverShore(
      grassTextures,
      roadTextures,
    ),
  },
] as const;

for (const constructorCase of constructorCases) {
  let material: ReturnType<typeof createTerrainGrassMaterial> | undefined;
  assert.doesNotThrow(() => {
    material = constructorCase.create();
  }, constructorCase.label);
  assert.ok(material?.colorNode, `${constructorCase.label} must construct its color graph`);
  assert.ok(material?.roughnessNode, `${constructorCase.label} must construct its roughness graph`);
  material?.dispose();
}

console.log('Terrain ecological material contract tests passed.');
