import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import {
  forestCardMaterial,
  setForestCardDormancy,
} from '../vendor/seedthree/src/core/branch-cards.js';
import {
  GORSKI_KOTAR_PRESETS,
  seedThreePresetIsDeciduous,
} from '../src/vegetation/seedthree/gorskiKotarSpecies.ts';

const deciduous = GORSKI_KOTAR_PRESETS.filter(seedThreePresetIsDeciduous);
assert.deepEqual(
  deciduous,
  ['americanBeech', 'whiteOak', 'redMaple', 'sweetgum'],
  'only broadleaf forest presets should enter winter dormancy',
);
assert.equal(seedThreePresetIsDeciduous('douglasFir'), false, 'fir must remain evergreen');
assert.equal(seedThreePresetIsDeciduous('loblolly'), false, 'spruce proxy must remain evergreen');
assert.equal(seedThreePresetIsDeciduous('pine'), false, 'pine must remain evergreen');

const uniform = { value: 0 };
const material = { userData: { forestSeasonalDormancy: uniform } };
assert.equal(setForestCardDormancy(material, 1), true);
assert.equal(uniform.value, 1);
assert.equal(setForestCardDormancy(material, 2), false, 'clamped unchanged values should not rewrite');
assert.equal(setForestCardDormancy(material, -1), true);
assert.equal(uniform.value, 0);
assert.equal(setForestCardDormancy({ userData: {} }, 1), false, 'evergreen cards should ignore dormancy');

const sourceTexture = new THREE.DataTexture(
  new Uint8Array([32, 180, 48, 255]),
  1,
  1,
  THREE.RGBAFormat,
  THREE.UnsignedByteType,
);
sourceTexture.needsUpdate = true;
const sourceMaterial = new THREE.MeshStandardMaterial({ map: sourceTexture, alphaTest: 0.35 });
const standardForestMaterial = forestCardMaterial(sourceMaterial);
const seasonalForestMaterial = forestCardMaterial(sourceMaterial, {
  seasonalDeciduous: true,
  canopyTint: [0.75, 0.84, 0.68],
  toneVariation: 0.08,
});
assert.notEqual(
  standardForestMaterial,
  seasonalForestMaterial,
  'seasonal and standard forest twins must not alias when they share a source card material',
);
assert.equal(setForestCardDormancy(standardForestMaterial, 1), false);
assert.equal(setForestCardDormancy(seasonalForestMaterial, 1), true);
standardForestMaterial.dispose();
seasonalForestMaterial.dispose();
sourceMaterial.dispose();
sourceTexture.dispose();

const root = process.cwd();
const forkSource = readFileSync(
  join(root, 'vendor/seedthree/src/core/branch-cards.js'),
  'utf8',
);
const builderSource = readFileSync(
  join(root, 'src/vegetation/seedthree/seedThreeForestBuilder.ts'),
  'utf8',
);
const sceneSource = readFileSync(join(root, 'src/scene/SceneManager.ts'), 'utf8');

assert.match(
  forkSource,
  /greenDominance[\s\S]*transmissionLeafMask[\s\S]*greenLeafMask\.max\(transmissionLeafMask\)[\s\S]*opacityNode = texel\.a\.mul\(seasonalRetain\)/,
  'the fork must use green and leaf-transmission masks so every deciduous bake drops leaves while retaining twigs',
);
assert.match(
  builderSource,
  /seasonalDeciduous: seedThreePresetIsDeciduous\(presetKey\)/,
  'forest buckets must opt only deciduous presets into the fork hook',
);
assert.match(
  sceneSource,
  /setDeciduousDormancy\(environment\.season === 'winter' \? 1 : 0\)/,
  'the authoritative presentation season must drive dormancy',
);
assert.match(
  sceneSource,
  /this\.forestManager = await createForestProps[\s\S]*?this\.forestManager\.setDeciduousDormancy\(this\.environment\?\.season === 'winter' \? 1 : 0\)/,
  'a deferred forest must inherit an environment that arrived before vegetation creation',
);
assert.match(
  forkSource,
  /cacheKey = `\$\{opts\.seasonalDeciduous \? 'seasonal' : 'standard'\}:\$\{tintKey\}:\$\{opts\.toneVariation \?\? 0\}`[\s\S]*?variants\.get\(cacheKey\)/,
  'the Seloslav fork must isolate seasonal and standard material cache variants',
);
assert.match(
  builderSource,
  /findLodLevel\(prototype, 'LOD3'\)[\s\S]*?\?\? findLodLevel\(prototype, 'LOD4'\)/,
  'overview forests must prefer the branch-bearing authored LOD3 rung over flat LOD4 limbs',
);
assert.match(
  builderSource,
  /douglasFir: \{ tint: \[0\.44, 0\.59, 0\.49\][\s\S]*loblolly: \{ tint: \[0\.4, 0\.55, 0\.44\][\s\S]*pine: \{ tint: \[0\.47, 0\.61, 0\.45\]/,
  'overview conifers must retain species-specific dark evergreen tones',
);
assert.match(
  builderSource,
  /forest\.ecology\.setDeciduousDormancy\(next\)/,
  'the authoritative winter update must include deciduous forest-edge understory',
);
assert.match(
  forkSource,
  /sin\(treeOrigin\.x[\s\S]*treeOrigin\.z[\s\S]*mat\.colorNode = surfaceColor\.mul\(tint\)\.mul\(occl\)\.mul\(variation\)/,
  'overview tone variation must reuse tree origin without another instance attribute',
);
assert.doesNotMatch(
  forkSource.slice(forkSource.indexOf('export function setForestCardDormancy')),
  /new (Mesh|InstancedMesh|BufferGeometry)/,
  'season changes must not allocate geometry or add draws',
);

console.log('test:seedthree-winter-foliage passed');
