import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { ForestCanopyOcclusionMap } from '../src/terrain/ForestCanopyOcclusion.ts';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const ivySource = readFileSync(`${projectRoot}src/props/ForestFloorIvy.ts`, 'utf8');
const managerSource = readFileSync(`${projectRoot}src/props/ForestManager.ts`, 'utf8');
const terrainSource = readFileSync(`${projectRoot}src/terrain/TerrainGrassMaterial.ts`, 'utf8');
const fieldSource = readFileSync(`${projectRoot}src/props/forestField.ts`, 'utf8');
const grassSource = readFileSync(`${projectRoot}src/grass/grassLodMath.ts`, 'utf8');
const ivyTexturePath =
  `${projectRoot}public/assets/textures/vegetation/forest-floor-ivy-card.png`;

const sources = [
  { x: -1.2, z: 0, canopyRadius: 4.1 },
  { x: 1.2, z: 0.4, canopyRadius: 4.3 },
  { x: 0.2, z: -1.1, canopyRadius: 3.8 },
] as const;
const map = new ForestCanopyOcclusionMap(64, 128);
const terrainGeometry = new THREE.PlaneGeometry(64, 64, 16, 16);
terrainGeometry.rotateX(-Math.PI * 0.5);
map.bindTerrainGeometry(terrainGeometry);
map.rebuild(sources);
const covered = map.sampleWorld(0, 0);
assert.ok(covered > 0.5, 'overlapping live crowns should form broad forest-floor shade');
const terrainCoverage = terrainGeometry.getAttribute(
  'forestCanopyOcclusion',
) as THREE.BufferAttribute;
const terrainCenterIndex = Array.from({ length: terrainCoverage.count }, (_, index) => index)
  .find((index) => {
    const position = terrainGeometry.getAttribute('position') as THREE.BufferAttribute;
    return Math.abs(position.getX(index)) < 1e-6 && Math.abs(position.getZ(index)) < 1e-6;
  });
assert.notEqual(terrainCenterIndex, undefined);
assert.ok(Math.abs(terrainCoverage.getX(terrainCenterIndex!) - covered) < 1e-6);

map.setTreeActive(0, false);
const oneTreeRemoved = map.sampleWorld(0, 0);
assert.ok(
  oneTreeRemoved < covered && oneTreeRemoved > 0,
  'felling one tree should remove its shade while neighbouring crowns remain',
);
map.setTreeActive(1, false);
map.setTreeActive(2, false);
assert.equal(
  map.sampleWorld(0, 0),
  0,
  'clearing every contributing tree should clear the synthetic canopy shade',
);
assert.equal(terrainCoverage.getX(terrainCenterIndex!), 0);
map.setTreeActive(0, true);
map.setTreeActive(1, true);
map.setTreeActive(2, true);
assert.equal(
  map.sampleWorld(0, 0),
  covered,
  'restoring tree ownership should reproduce the original shade deterministically',
);
assert.ok(Math.abs(terrainCoverage.getX(terrainCenterIndex!) - covered) < 1e-6);

const secondMap = new ForestCanopyOcclusionMap(64, 128);
secondMap.rebuild(sources);
for (const [x, z] of [[0, 0], [-3, 2], [5, -4], [15, 15]] as const) {
  assert.equal(
    secondMap.sampleWorld(x, z),
    map.sampleWorld(x, z),
    `fixed canopy inputs should reproduce the field at ${x},${z}`,
  );
}

const debugUniform = { value: -1 };
map.attachDebugUniform(debugUniform);
map.setDebugMode('coverage');
assert.equal(debugUniform.value, 1);
map.setDebugMode('mottle');
assert.equal(debugUniform.value, 2);
map.setDebugMode('final');
assert.equal(debugUniform.value, 0);

assert.match(
  ivySource,
  /loadSeedThreeGroundCoverTextures[\s\S]*?createSeedThreeCardClumpGeometry[\s\S]*?createSeedThreeGroundCoverMaterial/,
  'ivy must use the Seloslav SeedThree ground-cover texture, geometry, and material path',
);
assert.match(ivySource, /quads: 7,[\s\S]*?width: 3\.15,[\s\S]*?tiltMin: 1\.12/);
assert.match(ivySource, /sourceTreeIndex:[\s\S]*?placementIndicesByTree/);
assert.match(ivySource, /new THREE\.InstancedMesh\([\s\S]*?drawCalls: placements\.length > 0 \? 1 : 0/);
assert.match(
  ivySource,
  /never a rounded shrub or a second grass layer[\s\S]*?scale\.set\([\s\S]*?0\.46, 0\.62/,
  'ivy should be authored as broad, ground-skimming mats',
);
assert.match(
  managerSource,
  /setTreeForestFloorActive\(treeIndex, false\)[\s\S]*?setTreeForestFloorActive\(treeIndex, true\)/,
  'tree hide/show paths should own both their ivy and floor shade',
);
assert.match(
  managerSource,
  /this\.canopyOcclusion\?\.setTreeActive\(treeIndex, active\);[\s\S]*?this\.forestFloorIvy\?\.setTreeActive\(treeIndex, active\);/,
);
assert.match(managerSource, /this\.forestFloorIvy\?\.commit\(\);/);
assert.match(
  terrainSource,
  /canopyCoverage[\s\S]*?canopyMottle[\s\S]*?canopyGroundShade[\s\S]*?canopyAoFactor/,
  'terrain should combine live tree coverage, mottling, color shade, and ambient occlusion',
);
assert.match(
  terrainSource,
  /attribute\('forestCanopyOcclusion', 'float'\)/,
  'canopy shade should consume a terrain attribute without another sampled texture',
);
assert.doesNotMatch(terrainSource, /texture\(canopyOcclusion\.texture/);
assert.match(terrainSource, /coverageDebugColor[\s\S]*?mottleDebugColor/);
assert.match(fieldSource, /BASE_UNDERGROWTH_COUNT = 1_180/);
assert.match(grassSource, /FOREST_GRASS_RENDER_DENSITY_MULTIPLIER = 0/);
assert.match(grassSource, /FOREST_GRASS_PLACEMENT_CHANCE = 0/);
assert.match(grassSource, /FOREST_WILDFLOWER_PLACEMENT_CHANCE = 0/);

const ivyTexture = readFileSync(ivyTexturePath);
assert.ok(
  statSync(ivyTexturePath).size > 200_000,
  'forest ivy should remain a full authored cutout instead of a placeholder',
);
assert.equal(ivyTexture.subarray(1, 4).toString('ascii'), 'PNG');
assert.equal(ivyTexture[25], 6, 'forest ivy should retain RGBA transparency');

map.dispose();
secondMap.dispose();
terrainGeometry.dispose();
console.log(
  `Forest-floor coverage contract tests passed (center coverage ${covered.toFixed(3)}).`,
);
