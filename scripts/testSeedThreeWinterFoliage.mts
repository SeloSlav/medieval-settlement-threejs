import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import {
  forestCardMaterial,
  setForestCardDormancy,
  setForestCardSeason,
} from '../vendor/seedthree/src/core/branch-cards.js';
import {
  autumnFoliageColorForPreset,
  GORSKI_KOTAR_PRESETS,
  gorskiKotarSpeciesIsDeciduous,
  seedThreePresetIsDeciduous,
} from '../src/vegetation/seedthree/gorskiKotarSpecies.ts';
import { deciduousFoliageForClock } from '../src/world/deciduousFoliagePolicy.ts';

const deciduous = GORSKI_KOTAR_PRESETS.filter(seedThreePresetIsDeciduous);
assert.deepEqual(
  deciduous,
  ['americanBeech', 'whiteOak', 'redMaple', 'sweetgum'],
  'only broadleaf forest presets should enter winter dormancy',
);
assert.equal(seedThreePresetIsDeciduous('douglasFir'), false, 'fir must remain evergreen');
assert.equal(seedThreePresetIsDeciduous('loblolly'), false, 'spruce proxy must remain evergreen');
assert.equal(seedThreePresetIsDeciduous('pine'), false, 'pine must remain evergreen');
assert.equal(gorskiKotarSpeciesIsDeciduous('larch'), true, 'European larch must change and shed');
assert.equal(gorskiKotarSpeciesIsDeciduous('silverFir'), false, 'silver fir sharing the proxy must stay evergreen');
assert.equal(gorskiKotarSpeciesIsDeciduous('norwaySpruce'), false, 'spruce must stay evergreen');
assert.deepEqual(autumnFoliageColorForPreset('redMaple'), [0.95, 0.18, 0.04]);

const uniform = { value: 0 };
const material = { userData: { forestSeasonalDormancy: uniform } };
assert.equal(setForestCardDormancy(material, 1), true);
assert.equal(uniform.value, 1);
assert.equal(setForestCardDormancy(material, 2), false, 'clamped unchanged values should not rewrite');
assert.equal(setForestCardDormancy(material, -1), true);
assert.equal(uniform.value, 0);
assert.equal(setForestCardDormancy({ userData: {} }, 1), false, 'evergreen cards should ignore dormancy');

const seasonalUniforms = {
  springFlush: { value: 0 },
  autumnColor: { value: 0 },
  dormancy: { value: 0 },
};
const seasonalMaterialStub = {
  userData: {
    forestSeasonalSpringFlush: seasonalUniforms.springFlush,
    forestSeasonalAutumnColor: seasonalUniforms.autumnColor,
    forestSeasonalDormancy: seasonalUniforms.dormancy,
  },
};
assert.equal(setForestCardSeason(seasonalMaterialStub, {
  springFlush: 0.6,
  autumnColor: 0.8,
  dormancy: 0.2,
}), true);
assert.deepEqual(
  {
    springFlush: seasonalUniforms.springFlush.value,
    autumnColor: seasonalUniforms.autumnColor.value,
    dormancy: seasonalUniforms.dormancy.value,
  },
  { springFlush: 0.6, autumnColor: 0.8, dormancy: 0.2 },
);
assert.equal(setForestCardSeason(seasonalMaterialStub, {
  springFlush: 0.6,
  autumnColor: 0.8,
  dormancy: 0.2,
}), false, 'unchanged seasonal foliage values must not rewrite uniforms');

function foliageClock(month: number, monthDay: number) {
  return { month, monthDay, hour: 12, preciseHour: 12 } as any;
}

const openingMarchFoliage = deciduousFoliageForClock(foliageClock(3, 1));
assert.ok(openingMarchFoliage.springFlush > 0.8);
assert.ok(openingMarchFoliage.dormancy < 0.2);
const lateMarchFoliage = deciduousFoliageForClock(foliageClock(3, 8));
assert.ok(lateMarchFoliage.springFlush > 0.95);
assert.ok(lateMarchFoliage.dormancy < 0.05);
const aprilMaturation = deciduousFoliageForClock(foliageClock(4, 6));
assert.ok(aprilMaturation.springFlush > 0.4 && aprilMaturation.springFlush < 0.6);
assert.equal(aprilMaturation.dormancy, 0);
assert.deepEqual(
  deciduousFoliageForClock(foliageClock(7, 6)),
  { springFlush: 0, autumnColor: 0, dormancy: 0 },
);
const octoberColor = deciduousFoliageForClock(foliageClock(10, 6));
assert.ok(octoberColor.autumnColor > 0.6 && octoberColor.autumnColor < 0.8);
const novemberDrop = deciduousFoliageForClock(foliageClock(11, 6));
assert.equal(novemberDrop.autumnColor, 1);
assert.ok(novemberDrop.dormancy > 0.4 && novemberDrop.dormancy < 0.7);
assert.equal(deciduousFoliageForClock(foliageClock(12, 1)).dormancy, 1);

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
  autumnColor: [0.95, 0.18, 0.04],
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
const compactionSource = readFileSync(
  join(root, 'src/vegetation/seedthree/seedThreeForestCompaction.ts'),
  'utf8',
);
const forestPropsSource = readFileSync(join(root, 'src/props/ForestProps.ts'), 'utf8');
const forestManagerSource = readFileSync(join(root, 'src/props/ForestManager.ts'), 'utf8');
const sceneSource = readFileSync(join(root, 'src/scene/SceneManager.ts'), 'utf8');

assert.match(
  forkSource,
  /greenDominance[\s\S]*transmissionLeafMask[\s\S]*greenLeafMask\.max\(transmissionLeafMask\)[\s\S]*opacityNode = texel\.a\.mul\(seasonalRetain\)/,
  'the fork must use green and leaf-transmission masks so every deciduous bake drops leaves while retaining twigs',
);
assert.match(
  builderSource,
  /seasonalDeciduous: gorskiKotarSpeciesIsDeciduous\(placement\.species\)/,
  'each gameplay tree must carry its own deciduous classification',
);
assert.match(
  builderSource,
  /const seasonalDeciduous = slots\.some\(\(slot\) => slot\.seasonalDeciduous\)/,
  'mixed larch and fir proxy buckets must enable the seasonal shader when needed',
);
assert.match(
  compactionSource,
  /DECIDUOUS_TREE_ORIGIN_Y_OFFSET = 2048[\s\S]*treeOrigin\.setXYZ\([\s\S]*slot\.seasonalDeciduous[\s\S]*DECIDUOUS_TREE_ORIGIN_Y_OFFSET/,
  'tree compaction must pack deciduous identity into the existing origin buffer',
);
assert.doesNotMatch(
  builderSource,
  /setAttribute\('aDeciduous'/,
  'seasonal foliage must not exceed the portable eight-vertex-buffer limit',
);
assert.match(
  forkSource,
  /deciduousInstance = step\(float\(1024\), packedTreeOrigin\.y\)[\s\S]*packedTreeOrigin\.y\.sub\(deciduousInstance\.mul\(SEASONAL_TREE_ORIGIN_Y_OFFSET\)\)/,
  'the foliage shader must decode the packed flag while restoring the true tree origin',
);
assert.match(
  sceneSource,
  /setDeciduousFoliage\(environment\.deciduousFoliage\)/,
  'the authoritative calendar presentation must drive foliage color and retention',
);
assert.match(
  sceneSource,
  /this\.forestManager = await createForestProps[\s\S]*?if \(this\.environment\)[\s\S]*?this\.forestManager\.setDeciduousFoliage\(this\.environment\.deciduousFoliage\)/,
  'a deferred forest must inherit an environment that arrived before vegetation creation',
);
assert.match(
  forkSource,
  /cacheKey = `\$\{opts\.seasonalDeciduous \? 'seasonal' : 'standard'\}:\$\{tintKey\}:\$\{autumnKey\}:\$\{opts\.toneVariation \?\? 0\}`[\s\S]*?variants\.get\(cacheKey\)/,
  'the Seloslav fork must isolate seasonal and standard material cache variants',
);
assert.match(
  forkSource,
  /springLeaf[\s\S]*autumnPalette[\s\S]*surfaceColor = mix\([\s\S]*springFlush[\s\S]*surfaceColor = mix\(surfaceColor, autumnLeaf, leafMask\.mul\(autumnColor\)\)/,
  'deciduous leaf pixels must receive gradual spring and species-specific autumn color',
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
assert.doesNotMatch(
  builderSource,
  /forest\.ecology|createForestEdgeEcology|createForestCanopyCompanions|successionSet/,
  'the live forest must not add generated shrub lobes or trunkless companion crowns around SeedThree trees',
);
assert.match(
  forestPropsSource,
  /legacy procedural trees are intentionally not used[\s\S]*?const treeInstances = createStubForestInstances\(allTreePlacements\)/,
  'non-WebGPU backends must not substitute the legacy low-poly forest',
);
assert.doesNotMatch(
  forestManagerSource,
  /TreeSaplings|saplingMesh|createTreeSaplingMesh|updateTreeSaplingInstance/,
  'tree growth phases must not render the removed cone-sapling proxy',
);
assert.match(
  forkSource,
  /sin\(treeOrigin\.x[\s\S]*treeOrigin\.z[\s\S]*mat\.colorNode = surfaceColor\.mul\(tint\)\.mul\(occl\)\.mul\(variation\)/,
  'overview tone variation must reuse tree origin without another instance attribute',
);
assert.doesNotMatch(
  forkSource.slice(forkSource.indexOf('export function setForestCardSeason')),
  /new (Mesh|InstancedMesh|BufferGeometry)/,
  'season changes must not allocate geometry or add draws',
);

console.log('test:seedthree-winter-foliage passed');
