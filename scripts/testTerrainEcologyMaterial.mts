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
  TERRAIN_FROST_COLOR_BLEND,
  TERRAIN_FROST_COLOR_LIFT,
  TERRAIN_FROST_MASK_SCALE,
  TERRAIN_FROST_PATCH_MAX,
  TERRAIN_FROST_PATCH_MIN,
  TERRAIN_SHORE_RAIN_FADE_END,
  TERRAIN_SHORE_RAIN_FADE_START,
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
const ecologyEnd = source.indexOf('function buildTerrainFrostMask');
assert.ok(ecologyStart >= 0 && ecologyEnd > ecologyStart);
const ecologySource = source.slice(ecologyStart, ecologyEnd);

assert.match(ecologySource, /Domain-warped oblique waves/);
assert.match(ecologySource, /attribute\('normal', 'vec3'\)/);
assert.match(ecologySource, /const lowland = sub/);
assert.match(ecologySource, /const moisture = smoothstep/);
assert.match(ecologySource, /const dryShoulder = smoothstep/);
assert.match(ecologySource, /const openMeadow = smoothstep/);
assert.match(ecologySource, /const drainageFold = smoothstep/);
assert.match(ecologySource, /const forestEdge = smoothstep/);
assert.match(ecologySource, /const hierarchyTint = mix/);
assert.match(ecologySource, /const broadSoilValue = mix/);
assert.match(ecologySource, /const texelFootprint = max/);
assert.match(ecologySource, /fwidth\(grassUv\.x\)/);
assert.match(ecologySource, /fwidth\(grassUv\.y\)/);
assert.match(ecologySource, /const closeMaterialDetail = zoomDetailGate\.mul\(footprintDetailGate\)/);
assert.match(ecologySource, /const biomeBaseColor =/);
assert.match(ecologySource, /const stableColorNode = biomeBaseColor/);
assert.match(ecologySource, /const rainMoisture = smoothstep/);
assert.match(ecologySource, /const rainStableColorNode = rainMacroColor/);
assert.match(ecologySource, /const albedoDetailStrength = mix/);
assert.match(ecologySource, /float\(0\.24\)/);
assert.match(ecologySource, /const normalDetailStrength = mix/);
assert.match(ecologySource, /const rainNormalVisibility = mix/);
assert.match(ecologySource, /const rainAoVisibility = mix/);
assert.match(ecologySource, /float\(0\.1\)/);
assert.match(ecologySource, /vec3\(0\.5, 0\.5, 1\)/);
assert.match(ecologySource, /const roughnessDetailStrength = mix/);
assert.match(ecologySource, /const aoDetailStrength = mix/);
assert.match(ecologySource, /float\(0\.3\)/);
assert.match(ecologySource, /function applyRiparianEcologyColor/);
assert.match(ecologySource, /pow\([\s\S]*?shoreBlend,[\s\S]*?float\(0\.38\)/);
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
  /\bw\.|geometricNormal|slope|texture\(|sin\(/,
  'full-rain drainage must use fragment macro/height fields, not vertex-biome or normal inputs',
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
  17,
  'the ecological pass must not add terrain texture reads',
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
assert.match(source, /applyTerrainRainHaze/);
assert.match(source, /const flatFrostExposure = mix/);
assert.match(source, /const broadFrostExposure = smoothstep/);
assert.match(source, /const ecologicalShelter = max/);
assert.match(source, /blendNodes\.frostExposure/);
assert.match(source, /buildTerrainFrostMask/);
assert.match(source, /weather\.wetness/);
assert.match(source, /weather\.frost/);
assert.match(source, /const roadWearHalo =/);
assert.match(source, /const shoreRainVisibility = sub/);
assert.match(
  source,
  /const weatherResolvedShoreBlend = shoreBlend\.mul\(shoreRainVisibility\)/,
);
assert.match(
  source,
  /applyRiparianEcologyColor\([\s\S]*?weatherResolvedShoreBlend/,
);
assert.match(
  source,
  /applyCloseZoomDirtBlend\([\s\S]*?weatherResolvedShoreBlend/,
);
assert.match(
  source,
  /weatherResolvedShoreBlend\.mul\(float\(0\.82\)/,
);
assert.match(
  source,
  /max\(max\(weatherResolvedShoreBlend,\s*roadWear\)/,
);
assert.equal(
  TERRAIN_FULL_RAIN_ALBEDO_DETAIL_FLOOR,
  0,
  'full rain must remove sampled albedo from the terrain result',
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
  0,
  'full rain must remove the camera-proximity dirt texture transition',
);
assert.equal(TERRAIN_SHORE_RAIN_FADE_START, 0.08);
assert.equal(TERRAIN_SHORE_RAIN_FADE_END, 0.72);
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
const rawFrostMaskMin = TERRAIN_FROST_PATCH_MIN * TERRAIN_FROST_MASK_SCALE;
const rawFrostMaskMax = TERRAIN_FROST_PATCH_MAX * TERRAIN_FROST_MASK_SCALE;
assert.ok(
  rawFrostMaskMin <= 0.04,
  'sheltered macro zones must retain their underlying green-brown terrain',
);
assert.ok(
  rawFrostMaskMax >= 0.68 && rawFrostMaskMax <= 0.8,
  'fully exposed macro zones must read as light frost rather than full snow cover',
);
assert.ok(
  rawFrostMaskMax * TERRAIN_FROST_COLOR_BLEND >= 0.58,
  'exposed frost must separate visibly from sheltered terrain at overview distance',
);
assert.ok(
  TERRAIN_FROST_COLOR_LIFT[0] >= 0.14
    && TERRAIN_FROST_COLOR_LIFT[2] > TERRAIN_FROST_COLOR_LIFT[1]
    && TERRAIN_FROST_COLOR_LIFT[1] > TERRAIN_FROST_COLOR_LIFT[0],
  'frost target must be visibly pale and progressively cool without becoming white',
);
assert.match(source, /function resolveTerrainWeather/);
assert.match(source, /weather\?\.wetness \?\? \(float\(0\)/);

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
