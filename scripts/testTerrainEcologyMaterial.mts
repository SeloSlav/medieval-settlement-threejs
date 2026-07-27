import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import {
  createTerrainGrassMaterial,
  createTerrainGrassMaterialWithRiverShore,
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
assert.match(ecologySource, /const albedoDetailStrength = mix/);
assert.match(ecologySource, /float\(0\.24\)/);
assert.match(ecologySource, /const normalDetailStrength = mix/);
assert.match(ecologySource, /const rainNormalVisibility = mix/);
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
assert.match(source, /buildTerrainWetMask\(moisture,\s*weather\)/);
assert.match(source, /const rainDirtVisibility = mix/);
assert.match(source, /applyTerrainRainHaze/);
assert.match(source, /const frostExposure = mix/);
assert.match(source, /blendNodes\.frostExposure/);
assert.match(source, /buildTerrainFrostMask/);
assert.match(source, /weather\.wetness/);
assert.match(source, /weather\.frost/);
assert.match(source, /const roadWearHalo =/);
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
