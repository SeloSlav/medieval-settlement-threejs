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
  stableTerrainBlendWeight,
  terrainShoreRainVisibility,
} from '../src/terrain/TerrainGrassMaterial.ts';
import { createRoadWeatherUniforms } from '../src/roads/RoadSurfaceMaterial.ts';
import type {
  TerrainBlendTextureSet,
  TextureSet,
} from '../src/roads/RoadTextureLoader.ts';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const source = readFileSync(
  `${projectRoot}src/terrain/TerrainGrassMaterial.ts`,
  'utf8',
);

const ecologyStart = source.indexOf('function buildGrassBlendNodes');
const ecologyEnd = source.indexOf('function buildTerrainSnowNodes');
assert.ok(ecologyStart >= 0 && ecologyEnd > ecologyStart);
const ecologySource = source.slice(ecologyStart, ecologyEnd);

assert.match(ecologySource, /Domain-warped oblique waves/);
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
assert.match(ecologySource, /const biomeBaseColor =/);
assert.match(ecologySource, /const stableColorNode = biomeBaseColor/);
assert.match(ecologySource, /const colorNode = resolvedAlbedo/);
assert.doesNotMatch(
  ecologySource,
  /const (?:macroTint|ecologyTint|forestTint|drainageTint|hierarchyTint|broadSoilValue) =/,
  'fair-weather terrain must preserve the authored grass-to-dirt blend instead of applying a green ecology wash',
);
assert.match(ecologySource, /const rainMoisture = smoothstep/);
assert.match(ecologySource, /const rainStableColorNode = rainMacroColor/);
assert.match(
  ecologySource,
  /const resolvedAlbedo = mix\(\s*overviewTexturedColor,\s*blendedColor,\s*closeMaterialDetail/,
);
assert.match(ecologySource, /vec3\(0\.15, 0\.22, 0\.05\)/);
assert.match(ecologySource, /vec3\(0\.018, 0\.035, 0\.009\)/);
assert.match(ecologySource, /vec3\(0\.34, 0\.275, 0\.09\)/);
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
  23,
  'layered close soil plus the packed snow-atlas sample must retain a bounded texture budget',
);
assert.equal(
  (source.match(/\bsin\(/g) ?? []).length,
  3,
  'the ecological pass must reuse its three macro waves without new trigonometric noise',
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
assert.match(source, /vec3\(0\.64, 0\.52, 0\.39\)/);
assert.match(
  source,
  /const dirtSurfaceAmount = dirtAmount/,
  'brown soil must retain the full gradual close-ground zoom handoff',
);
assert.match(
  source,
  /const rainStableBaseColorNode = applyCloseZoomDirtBlend\([\s\S]*?dirtSurface\.colorNode[\s\S]*?dirtSurfaceAmount/,
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
assert.match(source, /const revealStart = sub/);
assert.match(source, /\.mul\(exposure\)/);
assert.match(source, /function resolveTerrainWeather/);
assert.match(source, /if \(weather\?\.wetness && weather\?\.frost\) return weather/);

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
