import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import {
  FOREST_CANOPY_FIELD_PARAMETERS,
  ForestCanopyOcclusionMap,
} from '../src/terrain/ForestCanopyOcclusion.ts';
import {
  createTerrainConformingIvyGeometry,
  FOREST_FLOOR_IVY_GROUND_CLEARANCE,
  FOREST_FLOOR_IVY_TRIANGLES_PER_PATCH,
  FOREST_FLOOR_IVY_UV_BOUNDS,
  FOREST_FLOOR_IVY_VERTICES_PER_PATCH,
  type ForestFloorIvyPlacement,
} from '../src/props/ForestFloorIvy.ts';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const ivySource = readFileSync(`${projectRoot}src/props/ForestFloorIvy.ts`, 'utf8');
const managerSource = readFileSync(`${projectRoot}src/props/ForestManager.ts`, 'utf8');
const terrainSource = readFileSync(`${projectRoot}src/terrain/TerrainGrassMaterial.ts`, 'utf8');
const fieldSource = readFileSync(`${projectRoot}src/props/forestField.ts`, 'utf8');
const grassSource = readFileSync(`${projectRoot}src/grass/grassLodMath.ts`, 'utf8');
const visualHooksSource = readFileSync(
  `${projectRoot}src/e2e/visualPerformanceHooks.ts`,
  'utf8',
);
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
const coveredField = map.sampleFieldWorld(0, 0);
const covered = coveredField.shade;
assert.ok(coveredField.coverage > 0.5, 'overlapping crowns should retain inspectable raw coverage');
assert.ok(covered > 0.9, 'overlapping live crowns should form a closed forest-interior shade body');
const terrainCoverage = terrainGeometry.getAttribute(
  'forestCanopyOcclusion',
) as THREE.BufferAttribute;
assert.equal(terrainCoverage.itemSize, 4, 'the complete field must occupy one RGBA vertex slot');
assert.equal(terrainCoverage.normalized, true, 'packed bytes must arrive in the shader as normalized fields');
const terrainCenterIndex = Array.from({ length: terrainCoverage.count }, (_, index) => index)
  .find((index) => {
    const position = terrainGeometry.getAttribute('position') as THREE.BufferAttribute;
    return Math.abs(position.getX(index)) < 1e-6 && Math.abs(position.getZ(index)) < 1e-6;
  });
assert.notEqual(terrainCenterIndex, undefined);
assert.ok(Math.abs(terrainCoverage.getW(terrainCenterIndex!) - covered) <= 1 / 255);

map.setTreeActive(0, false);
const oneTreeRemoved = map.sampleFieldWorld(0, 0);
assert.ok(
  oneTreeRemoved.coverage < coveredField.coverage,
  'felling one tree should remove its owned optical depth',
);
assert.ok(
  oneTreeRemoved.interior > 0.9 && oneTreeRemoved.shade > 0.9,
  'neighbouring crowns should keep a narrow felled-tree gap inside the continuous forest shadow body',
);
map.setTreeActive(1, false);
map.setTreeActive(2, false);
assert.equal(
  map.sampleFieldWorld(0, 0).shade,
  0,
  'clearing every contributing tree should clear the synthetic canopy shade',
);
assert.equal(terrainCoverage.getW(terrainCenterIndex!), 0);
map.setTreeActive(0, true);
map.setTreeActive(1, true);
map.setTreeActive(2, true);
assert.equal(
  map.sampleFieldWorld(0, 0).shade,
  covered,
  'restoring tree ownership should reproduce the original shade deterministically',
);
assert.ok(Math.abs(terrainCoverage.getW(terrainCenterIndex!) - covered) <= 1 / 255);

const secondMap = new ForestCanopyOcclusionMap(64, 128);
secondMap.rebuild(sources);
for (const [x, z] of [[0, 0], [-3, 2], [5, -4], [15, 15]] as const) {
  assert.deepEqual(
    secondMap.sampleFieldWorld(x, z),
    map.sampleFieldWorld(x, z),
    `fixed canopy inputs should reproduce the field at ${x},${z}`,
  );
}

const closureMap = new ForestCanopyOcclusionMap(64, 128);
closureMap.rebuild([
  { x: -5, z: 0, canopyRadius: 1.8 },
  { x: 5, z: 0, canopyRadius: 1.8 },
]);
const closedGap = closureMap.sampleFieldWorld(0, 0);
assert.equal(closedGap.coverage, 0, 'the contract gap should remain outside literal crown coverage');
assert.ok(
  closedGap.interior > 0.75 && closedGap.shade > 0.75,
  'a narrow space between neighbouring crowns should be filled by forest-scale closure',
);

const denseMap = new ForestCanopyOcclusionMap(64, 128);
const denseSources: Array<{ x: number; z: number; canopyRadius: number }> = [];
for (let z = -24; z <= 24; z += 8) {
  for (let x = -24; x <= 24; x += 8) {
    denseSources.push({ x, z, canopyRadius: 3 });
  }
}
denseMap.rebuild(denseSources);
let interiorSamples = 0;
let openingSamples = 0;
let maximumSunAccess = 0;
for (let z = -20; z <= 20; z += 0.5) {
  for (let x = -20; x <= 20; x += 0.5) {
    const field = denseMap.sampleFieldWorld(x, z);
    if (field.interior <= 0.8) continue;
    interiorSamples += 1;
    if (field.sunAccess > 0.08) openingSamples += 1;
    maximumSunAccess = Math.max(maximumSunAccess, field.sunAccess);
  }
}
const openingRatio = openingSamples / interiorSamples;
assert.ok(
  openingRatio > 0.04 && openingRatio < 0.14,
  `dense forest should retain sparse, not ubiquitous, light wells (observed ${openingRatio.toFixed(3)})`,
);
assert.ok(maximumSunAccess > 0.6, 'at least one coherent opening should admit legible direct sun');
assert.equal(FOREST_CANOPY_FIELD_PARAMETERS.closure.radiusMeters, 5.5);

const debugUniform = { value: -1 };
map.attachDebugUniform(debugUniform);
map.setDebugMode('coverage');
assert.equal(debugUniform.value, 1);
map.setDebugMode('interior');
assert.equal(debugUniform.value, 2);
map.setDebugMode('sun-access');
assert.equal(debugUniform.value, 3);
map.setDebugMode('mottle');
assert.equal(debugUniform.value, 3);
map.setDebugMode('final');
assert.equal(debugUniform.value, 0);

const ivyPlacement: ForestFloorIvyPlacement = {
  x: 3.2,
  z: -1.7,
  sourceTreeIndex: 0,
  scale: 1,
  yaw: 0.37,
  radiusX: 2.7,
  radiusZ: 1.55,
  reliefHeight: 0.19,
  reliefPhase: 1.3,
};
const slopedTerrain = {
  getHeightAt(x: number, z: number): number {
    return x * 0.23 - z * 0.11 + Math.sin(x * 0.4) * 0.025;
  },
};
const compiledIvy = createTerrainConformingIvyGeometry(
  [ivyPlacement],
  slopedTerrain,
  1,
  0x13579bdf,
);
const ivyPosition = compiledIvy.geometry.getAttribute('position') as THREE.BufferAttribute;
const ivyNormal = compiledIvy.geometry.getAttribute('normal') as THREE.BufferAttribute;
const ivyUv = compiledIvy.geometry.getAttribute('uv') as THREE.BufferAttribute;
assert.equal(ivyPosition.count, FOREST_FLOOR_IVY_VERTICES_PER_PATCH);
assert.equal(
  compiledIvy.geometry.index!.count / 3,
  FOREST_FLOOR_IVY_TRIANGLES_PER_PATCH,
);
assert.deepEqual(
  compiledIvy.placementVertexRangesByTree,
  [[{ start: 0, count: FOREST_FLOOR_IVY_VERTICES_PER_PATCH }]],
);
let minimumClearance = Number.POSITIVE_INFINITY;
let maximumClearance = Number.NEGATIVE_INFINITY;
let minimumNormalY = 1;
let maximumNormalY = -1;
for (let index = 0; index < ivyPosition.count; index++) {
  const x = ivyPosition.getX(index);
  const z = ivyPosition.getZ(index);
  const clearance = ivyPosition.getY(index) - slopedTerrain.getHeightAt(x, z);
  minimumClearance = Math.min(minimumClearance, clearance);
  maximumClearance = Math.max(maximumClearance, clearance);
  minimumNormalY = Math.min(minimumNormalY, ivyNormal.getY(index));
  maximumNormalY = Math.max(maximumNormalY, ivyNormal.getY(index));
}
assert.ok(
  Math.abs(minimumClearance - FOREST_FLOOR_IVY_GROUND_CLEARANCE) < 1e-6,
  'the alpha perimeter should touch the terrain within the depth-safe clearance',
);
assert.ok(
  maximumClearance > 0.1 && maximumClearance < 0.23,
  'the patch should carry shallow physical leaf relief without becoming a shrub',
);
assert.ok(
  maximumNormalY - minimumNormalY > 0.015,
  'computed normals should prove that the carrier is curved rather than a flat card',
);
assert.ok(minimumNormalY > 0.75, 'the drape should remain a ground-facing surface');
assert.ok(Math.abs(ivyUv.getX(0) - FOREST_FLOOR_IVY_UV_BOUNDS.minU) < 1e-6);
assert.ok(Math.abs(ivyUv.getY(0) - FOREST_FLOOR_IVY_UV_BOUNDS.minV) < 1e-6);
assert.ok(
  Math.abs(
    ivyUv.getX(ivyUv.count - 1) - FOREST_FLOOR_IVY_UV_BOUNDS.maxU,
  ) < 1e-6,
);
assert.ok(
  Math.abs(
    ivyUv.getY(ivyUv.count - 1) - FOREST_FLOOR_IVY_UV_BOUNDS.maxV,
  ) < 1e-6,
);
const repeatedIvy = createTerrainConformingIvyGeometry(
  [ivyPlacement],
  slopedTerrain,
  1,
  0x13579bdf,
);
assert.deepEqual(
  Array.from(repeatedIvy.originalPositions),
  Array.from(compiledIvy.originalPositions),
  'fixed seed, placement, and terrain should reproduce the exact drape',
);

assert.match(
  ivySource,
  /loadSeedThreeGroundCoverTextures[\s\S]*?createTerrainConformingIvyGeometry[\s\S]*?createSeedThreeGroundCoverMaterial/,
  'ivy must retain Seloslav SeedThree texture and material ownership around its terrain compiler',
);
assert.doesNotMatch(
  ivySource,
  /createSeedThreeCardClumpGeometry|new THREE\.InstancedMesh|tiltMin:/,
  'the rejected flat-card and crossed-card carrier must not return',
);
assert.match(ivySource, /terrain\.getHeightAt\(worldX, worldZ\)/);
assert.match(ivySource, /sourceTreeIndex:[\s\S]*?placementVertexRangesByTree/);
assert.match(ivySource, /new THREE\.Mesh\(compiled\.geometry, material\)/);
assert.match(ivySource, /normalNode = normalView/);
assert.match(ivySource, /positionLocal as SeedThreeGroundCoverPositionNode/);
assert.match(ivySource, /FOREST_FLOOR_IVY_HIDDEN_Y[\s\S]*?position\.addUpdateRange/);
assert.match(
  ivySource,
  /FOREST_FLOOR_IVY_GROUND_CLEARANCE = 0\.014[\s\S]*?FOREST_FLOOR_IVY_RELIEF_MIN = 0\.12[\s\S]*?FOREST_FLOOR_IVY_RELIEF_MAX = 0\.22/,
  'ivy should declare a measurable ground-contact and shallow-relief contract',
);
assert.match(
  managerSource,
  /setTreeForestFloorActive\(treeIndex, false\)[\s\S]*?setTreeForestFloorActive\(treeIndex, true\)/,
  'tree hide/show paths should own both their ivy and floor shade',
);
assert.match(
  managerSource,
  /this\.canopyOcclusion\?\.setTreeActive\(treeIndex, active, true\);[\s\S]*?this\.forestFloorIvy\?\.setTreeActive\(treeIndex, active\);/,
);
assert.match(managerSource, /this\.canopyOcclusion\?\.commit\(\);/);
assert.match(managerSource, /this\.forestFloorIvy\?\.commit\(\);/);
assert.match(
  terrainSource,
  /canopyCoverage[\s\S]*?canopyInterior[\s\S]*?canopySunAccess[\s\S]*?canopyOpeningNearWeight[\s\S]*?canopyGroundShade[\s\S]*?canopyAoFactor/,
  'terrain should combine crown coverage, closed interior, scale-filtered sun access, color shade, and ambient occlusion',
);
assert.match(
  terrainSource,
  /attribute\('forestCanopyOcclusion', 'vec4'\)/,
  'the packed canopy field should consume one terrain attribute without another sampled texture',
);
assert.doesNotMatch(terrainSource, /texture\(canopyOcclusion\.texture/);
assert.match(
  terrainSource,
  /coverageDebugColor[\s\S]*?interiorDebugColor[\s\S]*?sunAccessDebugColor/,
);
assert.match(
  visualHooksSource,
  /setForestFloorDebugMode\(mode: ForestCanopyOcclusionDebugMode\)[\s\S]*?manager\.forestManager\?\.setForestFloorDebugMode\?\.\(mode\)/,
  'visual profiling must expose controlling canopy fields through the real manager path',
);
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
closureMap.dispose();
denseMap.dispose();
terrainGeometry.dispose();
compiledIvy.geometry.dispose();
repeatedIvy.geometry.dispose();
console.log(
  `Forest-floor coverage contract tests passed (center shade ${covered.toFixed(3)}, sun openings ${(openingRatio * 100).toFixed(1)}%).`,
);
