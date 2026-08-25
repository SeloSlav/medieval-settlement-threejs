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
  FOREST_FLOOR_IVY_ANIMATION_MAX_TIP_DISPLACEMENT,
  FOREST_FLOOR_IVY_CANOPY_HEIGHT_MAX,
  FOREST_FLOOR_IVY_GROUND_CLEARANCE,
  FOREST_FLOOR_IVY_LEAF_BOUNDARY,
  FOREST_FLOOR_IVY_LEAF_VERTICES,
  FOREST_FLOOR_IVY_LEAVES_PER_PATCH,
  FOREST_FLOOR_IVY_LEAVES_PER_RUNNER,
  FOREST_FLOOR_IVY_RUNNER_SEGMENTS,
  FOREST_FLOOR_IVY_RUNNER_TRIANGLES,
  FOREST_FLOOR_IVY_RUNNER_VERTICES,
  FOREST_FLOOR_IVY_RUNNER_VERTICES_PER_PATCH,
  FOREST_FLOOR_IVY_RUNNERS_PER_PATCH,
  FOREST_FLOOR_IVY_TRIANGLES_PER_PATCH,
  FOREST_FLOOR_IVY_VERTICES_PER_PATCH,
  type ForestFloorIvyPlacement,
} from '../src/props/ForestFloorIvy.ts';
import {
  FOREST_FLOOR_TWIG_ALBEDO_TEXTURE_PATH,
  FOREST_FLOOR_TWIG_MAX_INSTANCES,
  FOREST_FLOOR_TWIG_MIN_SPACING,
  FOREST_FLOOR_TWIG_NORMAL_TEXTURE_PATH,
  FOREST_FLOOR_TWIG_RADIAL_SEGMENTS,
  FOREST_FLOOR_TWIG_ROUGHNESS_TEXTURE_PATH,
  FOREST_FLOOR_TWIG_SCALE_RANGE,
  FOREST_FLOOR_TWIG_TARGETS_PER_TREE,
  FOREST_FLOOR_TWIG_TEXTURE_REPEAT_METERS,
  FOREST_FLOOR_TWIG_TEXTURE_SOURCES,
  FOREST_FLOOR_TWIG_THICKNESS_RANGE,
  FOREST_FLOOR_TWIG_VARIANT_COUNT,
  FOREST_FLOOR_TWIG_VARIANTS,
  createForestFloorTwigGeometry,
} from '../src/props/ForestFloorTwigs.ts';
import { createForestFloorPlacementMask } from '../src/props/ForestFloorPlacementMask.ts';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const ivySource = readFileSync(`${projectRoot}src/props/ForestFloorIvy.ts`, 'utf8');
const ivyWindSource = readFileSync(
  `${projectRoot}src/vegetation/seedthree/seedThreeFoliageWind.ts`,
  'utf8',
);
const groundCoverSource = readFileSync(
  `${projectRoot}src/vegetation/seedthree/seedThreeGroundCover.ts`,
  'utf8',
);
const managerSource = readFileSync(`${projectRoot}src/props/ForestManager.ts`, 'utf8');
const forestPropsSource = readFileSync(`${projectRoot}src/props/ForestProps.ts`, 'utf8');
const nettleSource = readFileSync(`${projectRoot}src/props/ForestFloorNettles.ts`, 'utf8');
const twigSource = readFileSync(`${projectRoot}src/props/ForestFloorTwigs.ts`, 'utf8');
const terrainSource = readFileSync(`${projectRoot}src/terrain/TerrainGrassMaterial.ts`, 'utf8');
const fieldSource = readFileSync(`${projectRoot}src/props/forestField.ts`, 'utf8');
const grassSource = readFileSync(`${projectRoot}src/grass/grassLodMath.ts`, 'utf8');
const visualHooksSource = readFileSync(
  `${projectRoot}src/e2e/visualPerformanceHooks.ts`,
  'utf8',
);
const lineupSource = readFileSync(`${projectRoot}src/e2e/forestFloorLineup.ts`, 'utf8');
const twigTexturePaths = Object.values(FOREST_FLOOR_TWIG_TEXTURE_SOURCES).map(
  (path) => `${projectRoot}public${path}`,
);

const placementVisibilityEvents: Array<{ placementIndex: number; visible: boolean }> = [];
const placementMask = createForestFloorPlacementMask(
  [
    { sourceTreeIndex: 0, x: -1 },
    { sourceTreeIndex: 0, x: 1 },
  ],
  1,
  (placementIndex, visible) => {
    placementVisibilityEvents.push({ placementIndex, visible });
  },
);
assert.equal(placementMask.isTreeActive(0), true);
assert.equal(
  placementMask.refreshBlockedMask((placement) => placement.x > 0),
  1,
  'an offset prop inside clearance must change even while its source tree remains active',
);
assert.equal(placementMask.isTreeActive(0), true);
assert.equal(placementMask.isPlacementVisible(0), true);
assert.equal(placementMask.isPlacementActive(1), false);
assert.equal(placementMask.isPlacementVisible(1), false);
assert.deepEqual(placementVisibilityEvents, [{ placementIndex: 1, visible: false }]);
placementMask.setTreeActive(0, false);
placementMask.setTreeActive(0, true);
assert.equal(placementMask.isPlacementVisible(0), true);
assert.equal(
  placementMask.isPlacementVisible(1),
  false,
  'restoring a source tree must not resurrect a placement-blocked forest-floor prop',
);
assert.equal(placementMask.refreshBlockedMask(() => false), 1);
assert.equal(placementMask.isPlacementVisible(1), true);

const sources = [
  { x: -1.2, z: 0, canopyRadius: 4.1 },
  { x: 1.2, z: 0.4, canopyRadius: 4.3 },
  { x: 0.2, z: -1.1, canopyRadius: 3.8 },
] as const;

const isolatedMap = new ForestCanopyOcclusionMap(64, 128);
isolatedMap.rebuild([{ x: 0, z: 0, canopyRadius: 4.1 }]);
const isolatedField = isolatedMap.sampleFieldWorld(0, 0);
assert.ok(
  isolatedField.coverage > 0.25,
  'an isolated live crown should remain visible in the raw coverage diagnostic',
);
assert.equal(
  isolatedField.interior,
  0,
  'one isolated tree must not qualify as a forest interior',
);
assert.equal(
  isolatedField.shade,
  0,
  'one isolated tree must leave terrain to its real directional shadow only',
);

function countPositionReads(
  position: THREE.BufferAttribute,
  action: () => void,
): { x: number; z: number } {
  const originalGetX = position.getX.bind(position);
  const originalGetZ = position.getZ.bind(position);
  let x = 0;
  let z = 0;
  position.getX = (index: number): number => {
    x += 1;
    return originalGetX(index);
  };
  position.getZ = (index: number): number => {
    z += 1;
    return originalGetZ(index);
  };
  try {
    action();
  } finally {
    position.getX = originalGetX;
    position.getZ = originalGetZ;
  }
  return { x, z };
}

function assertTerrainCanopyAttributeMatchesField(
  canopyMap: ForestCanopyOcclusionMap,
  geometry: THREE.BufferGeometry,
): void {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const attribute = geometry.getAttribute(
    'forestCanopyOcclusion',
  ) as THREE.BufferAttribute;
  const values = attribute.array as Uint8Array;
  for (let index = 0; index < position.count; index++) {
    const expected = canopyMap.sampleFieldWorld(
      position.getX(index),
      position.getZ(index),
    );
    const offset = index * 4;
    assert.deepEqual(
      Array.from(values.subarray(offset, offset + 4)),
      [expected.coverage, expected.interior, expected.sunAccess, expected.shade]
        .map((value) => Math.round(value * 255)),
      `terrain canopy bytes must exactly match the resolved field at vertex ${index}`,
    );
  }
}

function createRowMajorTerrainGrid(
  resolution: number,
  size: number,
): THREE.BufferGeometry {
  const positions = new Float32Array(resolution * resolution * 3);
  const step = size / (resolution - 1);
  const half = size * 0.5;
  for (let row = 0; row < resolution; row++) {
    for (let column = 0; column < resolution; column++) {
      const offset = (row * resolution + column) * 3;
      positions[offset] = -half + column * step;
      positions[offset + 2] = -half + row * step;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return geometry;
}

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
  oneTreeRemoved.interior > 0.5 && oneTreeRemoved.shade > 0.5,
  'a close surviving pair should keep a softer continuous forest-interior body',
);
map.setTreeActive(1, false);
const isolatedSurvivor = map.sampleFieldWorld(0, 0);
assert.ok(
  isolatedSurvivor.coverage > 0.1,
  'the final surviving crown should retain inspectable raw coverage',
);
assert.equal(
  isolatedSurvivor.interior,
  0,
  'felling a stand down to one tree should remove its synthetic forest interior',
);
assert.equal(isolatedSurvivor.shade, 0);
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

const terrainPosition = terrainGeometry.getAttribute('position') as THREE.BufferAttribute;
const localGridReads = countPositionReads(terrainPosition, () => {
  map.setTreeActive(0, false);
});
assert.ok(
  localGridReads.x < terrainPosition.count / 2
    && localGridReads.z < terrainPosition.count / 2,
  `a local canopy edit should visit only its grid rectangle, not all ${terrainPosition.count} vertices`,
);
assertTerrainCanopyAttributeMatchesField(map, terrainGeometry);
map.setTreeActive(0, true);

const irregularGeometry = new THREE.BufferGeometry();
irregularGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
  -9, 0, -7,
  -2, 0, -7,
  6, 0, -3,
  -7, 0, 2,
  1, 0, 1,
  8, 0, 7,
]), 3));
const irregularMap = new ForestCanopyOcclusionMap(64, 128);
irregularMap.rebuild(sources);
irregularMap.bindTerrainGeometry(irregularGeometry);
const irregularPosition = irregularGeometry.getAttribute('position') as THREE.BufferAttribute;
const irregularReads = countPositionReads(irregularPosition, () => {
  irregularMap.setTreeActive(0, false);
});
assert.equal(
  irregularReads.x,
  irregularPosition.count,
  'non-grid geometry must retain the generic full-scan correctness path',
);
assert.equal(irregularReads.z, irregularPosition.count);
assertTerrainCanopyAttributeMatchesField(irregularMap, irregularGeometry);

const productionTerrainResolution = 769;
const productionTerrainGeometry = createRowMajorTerrainGrid(
  productionTerrainResolution,
  1_080,
);
const productionCanopyMap = new ForestCanopyOcclusionMap(1_080, 128);
productionCanopyMap.rebuild([
  { x: 0, z: 0, canopyRadius: 4.2 },
  { x: 8, z: 1, canopyRadius: 3.8 },
]);
productionCanopyMap.bindTerrainGeometry(productionTerrainGeometry);
const productionPosition = productionTerrainGeometry.getAttribute(
  'position',
) as THREE.BufferAttribute;
const productionAttribute = productionTerrainGeometry.getAttribute(
  'forestCanopyOcclusion',
) as THREE.BufferAttribute;
const productionGridReads = countPositionReads(productionPosition, () => {
  productionCanopyMap.setTreeActive(0, false);
});
assert.ok(
  productionGridReads.x < productionPosition.count / 100
    && productionGridReads.z < productionPosition.count / 100,
  `the 769x769 terrain update must stay local (read ${productionGridReads.x} of ${productionPosition.count} vertices)`,
);
const uploadedComponents = productionAttribute.updateRanges.reduce(
  (total, range) => total + range.count,
  0,
);
assert.ok(
  uploadedComponents < productionPosition.count * 4 * 0.06,
  `the local crown-plus-stand upload must remain below 6% (uploaded ${uploadedComponents} of ${productionPosition.count * 4} components)`,
);

productionTerrainGeometry.dispose();
irregularGeometry.dispose();

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
  closedGap.interior > 0.25 && closedGap.shade > 0.25,
  'a narrow space between a close pair should receive partial stand-gated closure',
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
assert.equal(FOREST_CANOPY_FIELD_PARAMETERS.stand.radiusMeters, 12);
assert.ok(
  FOREST_CANOPY_FIELD_PARAMETERS.stand.densityStart > 1,
  'the stand gate must remain above the maximum contribution of one isolated tree',
);

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
const ivyRunner = compiledIvy.geometry.getAttribute('ivyRunner') as THREE.BufferAttribute;
const ivyTint = compiledIvy.geometry.getAttribute('aTint') as THREE.BufferAttribute;
const ivyRootPhase = compiledIvy.geometry.getAttribute(
  'aIvyRootPhase',
) as THREE.BufferAttribute;
const ivyHinge = compiledIvy.geometry.getAttribute('aIvyHinge') as THREE.BufferAttribute;

assert.equal(FOREST_FLOOR_IVY_RUNNER_SEGMENTS, FOREST_FLOOR_IVY_LEAVES_PER_RUNNER);
assert.equal(
  FOREST_FLOOR_IVY_LEAVES_PER_PATCH,
  FOREST_FLOOR_IVY_RUNNERS_PER_PATCH * FOREST_FLOOR_IVY_LEAVES_PER_RUNNER,
);
assert.equal(ivyPosition.count, FOREST_FLOOR_IVY_VERTICES_PER_PATCH);
assert.equal(
  compiledIvy.geometry.index!.count / 3,
  FOREST_FLOOR_IVY_TRIANGLES_PER_PATCH,
);
assert.equal(compiledIvy.runnerVertexRanges.length, FOREST_FLOOR_IVY_RUNNERS_PER_PATCH);
assert.equal(compiledIvy.leafVertexRanges.length, FOREST_FLOOR_IVY_LEAVES_PER_PATCH);
assert.deepEqual(
  compiledIvy.placementVertexRangesByTree,
  [[{ start: 0, count: FOREST_FLOOR_IVY_VERTICES_PER_PATCH }]],
);
assert.equal(
  compiledIvy.geometry.userData.seedThreeGenerator,
  'terrain-following-ivy-runner-chain',
);
assert.equal(
  compiledIvy.geometry.userData.runnersPerPatch,
  FOREST_FLOOR_IVY_RUNNERS_PER_PATCH,
);

const runnerWidths: Array<{ base: number; tip: number }> = [];
for (const [runnerIndex, range] of compiledIvy.runnerVertexRanges.entries()) {
  assert.equal(range.start, runnerIndex * FOREST_FLOOR_IVY_RUNNER_VERTICES);
  assert.equal(range.count, FOREST_FLOOR_IVY_RUNNER_VERTICES);
  assert.equal(range.runnerIndex, runnerIndex);
  assert.equal(range.placementIndex, 0);
  const centers: THREE.Vector3[] = [];
  for (let nodeIndex = 0; nodeIndex <= FOREST_FLOOR_IVY_RUNNER_SEGMENTS; nodeIndex++) {
    const leftIndex = range.start + nodeIndex * 3;
    const centerIndex = leftIndex + 1;
    const rightIndex = leftIndex + 2;
    const left = new THREE.Vector3(
      ivyPosition.getX(leftIndex),
      ivyPosition.getY(leftIndex),
      ivyPosition.getZ(leftIndex),
    );
    const center = new THREE.Vector3(
      ivyPosition.getX(centerIndex),
      ivyPosition.getY(centerIndex),
      ivyPosition.getZ(centerIndex),
    );
    const right = new THREE.Vector3(
      ivyPosition.getX(rightIndex),
      ivyPosition.getY(rightIndex),
      ivyPosition.getZ(rightIndex),
    );
    centers.push(center);
    for (const vertexIndex of [leftIndex, centerIndex, rightIndex]) {
      assert.equal(ivyRunner.getX(vertexIndex), runnerIndex);
      assert.equal(ivyHinge.getW(vertexIndex), 0, 'runner ribbons must remain terrain-welded');
      assert.equal(ivyRootPhase.getX(vertexIndex), 0);
      assert.equal(ivyRootPhase.getY(vertexIndex), 0);
      assert.equal(ivyRootPhase.getZ(vertexIndex), 0);
      assert.equal(ivyRootPhase.getW(vertexIndex), 0);
      const x = ivyPosition.getX(vertexIndex);
      const z = ivyPosition.getZ(vertexIndex);
      const clearance = ivyPosition.getY(vertexIndex) - slopedTerrain.getHeightAt(x, z);
      assert.ok(
        clearance >= FOREST_FLOOR_IVY_GROUND_CLEARANCE + 0.0023
          && clearance < FOREST_FLOOR_IVY_GROUND_CLEARANCE + 0.014,
        `runner ${runnerIndex} node ${nodeIndex} must hug the sampled terrain`,
      );
    }
    assert.ok(
      Math.abs(left.clone().add(right).multiplyScalar(0.5).x - center.x) < 1e-5
        && Math.abs(left.clone().add(right).multiplyScalar(0.5).z - center.z) < 1e-5,
      'each three-wide runner ring needs an exact centerline vertex',
    );
  }
  for (let nodeIndex = 1; nodeIndex < centers.length; nodeIndex++) {
    const segmentLength = new THREE.Vector2(
      centers[nodeIndex]!.x - centers[nodeIndex - 1]!.x,
      centers[nodeIndex]!.z - centers[nodeIndex - 1]!.z,
    ).length();
    assert.ok(
      segmentLength > 0.1 && segmentLength < 0.75,
      `runner ${runnerIndex} must remain a continuous ground curve`,
    );
  }
  const baseLeft = new THREE.Vector3(
    ivyPosition.getX(range.start),
    ivyPosition.getY(range.start),
    ivyPosition.getZ(range.start),
  );
  const baseRight = new THREE.Vector3(
    ivyPosition.getX(range.start + 2),
    ivyPosition.getY(range.start + 2),
    ivyPosition.getZ(range.start + 2),
  );
  const terminalStart = range.start + FOREST_FLOOR_IVY_RUNNER_SEGMENTS * 3;
  const tipLeft = new THREE.Vector3(
    ivyPosition.getX(terminalStart),
    ivyPosition.getY(terminalStart),
    ivyPosition.getZ(terminalStart),
  );
  const tipRight = new THREE.Vector3(
    ivyPosition.getX(terminalStart + 2),
    ivyPosition.getY(terminalStart + 2),
    ivyPosition.getZ(terminalStart + 2),
  );
  runnerWidths.push({
    base: baseLeft.distanceTo(baseRight),
    tip: tipLeft.distanceTo(tipRight),
  });
}
for (const width of runnerWidths) {
  assert.ok(width.tip < width.base * 0.25, 'every runner must taper beneath its final leaf');
}

for (const [leafIndex, range] of compiledIvy.leafVertexRanges.entries()) {
  assert.equal(
    range.start,
    FOREST_FLOOR_IVY_RUNNER_VERTICES_PER_PATCH
      + leafIndex * FOREST_FLOOR_IVY_LEAF_VERTICES,
  );
  assert.equal(range.count, FOREST_FLOOR_IVY_LEAF_VERTICES);
  assert.equal(range.leafIndex, leafIndex);
  assert.equal(range.placementIndex, 0);
  assert.equal(range.runnerIndex, Math.floor(leafIndex / FOREST_FLOOR_IVY_LEAVES_PER_RUNNER));
  assert.equal(range.runnerNodeIndex, leafIndex % FOREST_FLOOR_IVY_LEAVES_PER_RUNNER + 1);
  assert.equal(range.rootVertex, range.start);
  assert.equal(range.tipVertex, range.start + 8);
  assert.ok(
    new THREE.Vector3(
      ivyPosition.getX(range.rootVertex),
      ivyPosition.getY(range.rootVertex),
      ivyPosition.getZ(range.rootVertex),
    ).distanceTo(new THREE.Vector3(
      ivyPosition.getX(range.runnerRootVertex),
      ivyPosition.getY(range.runnerRootVertex),
      ivyPosition.getZ(range.runnerRootVertex),
    )) < 1e-6,
    'every petiole must be welded to a real runner node',
  );
  for (let index = range.start; index < range.start + range.count; index++) {
    assert.equal(ivyRunner.getX(index), range.runnerIndex);
    const x = ivyPosition.getX(index);
    const z = ivyPosition.getZ(index);
    const clearance = ivyPosition.getY(index) - slopedTerrain.getHeightAt(x, z);
    assert.ok(
      clearance >= FOREST_FLOOR_IVY_GROUND_CLEARANCE - 0.001
        && clearance <= FOREST_FLOOR_IVY_GROUND_CLEARANCE
          + FOREST_FLOOR_IVY_CANOPY_HEIGHT_MAX + 1e-6,
      'the complete leaf mesh must follow the ground rather than float above a carrier',
    );
  }
}

for (let runnerIndex = 0; runnerIndex < FOREST_FLOOR_IVY_RUNNERS_PER_PATCH; runnerIndex++) {
  const runnerRange = compiledIvy.runnerVertexRanges[runnerIndex]!;
  const sideSigns: number[] = [];
  for (let nodeIndex = 1; nodeIndex < FOREST_FLOOR_IVY_LEAVES_PER_RUNNER; nodeIndex++) {
    const leaf = compiledIvy.leafVertexRanges[
      runnerIndex * FOREST_FLOOR_IVY_LEAVES_PER_RUNNER + nodeIndex - 1
    ]!;
    const previousRoot = runnerRange.start + (nodeIndex - 1) * 3 + 1;
    const nextRoot = runnerRange.start + (nodeIndex + 1) * 3 + 1;
    const tangentX = ivyPosition.getX(nextRoot) - ivyPosition.getX(previousRoot);
    const tangentZ = ivyPosition.getZ(nextRoot) - ivyPosition.getZ(previousRoot);
    const leafX = ivyPosition.getX(leaf.tipVertex) - ivyPosition.getX(leaf.rootVertex);
    const leafZ = ivyPosition.getZ(leaf.tipVertex) - ivyPosition.getZ(leaf.rootVertex);
    const cross = tangentX * leafZ - tangentZ * leafX;
    assert.ok(Math.abs(cross) > 0.01, 'non-terminal leaves must visibly branch from the runner');
    sideSigns.push(Math.sign(cross));
  }
  for (let index = 1; index < sideSigns.length; index++) {
    assert.equal(
      sideSigns[index],
      -sideSigns[index - 1]!,
      'successive ivy leaves should alternate sides like a botanical chain',
    );
  }
  const terminalLeaf = compiledIvy.leafVertexRanges[
    (runnerIndex + 1) * FOREST_FLOOR_IVY_LEAVES_PER_RUNNER - 1
  ]!;
  assert.equal(
    terminalLeaf.runnerRootVertex,
    runnerRange.start + FOREST_FLOOR_IVY_RUNNER_SEGMENTS * 3 + 1,
    'the runner must end under its final leaf instead of protruding beyond it',
  );
}

const ivyIndices = compiledIvy.geometry.index!.array;
for (let index = 0; index < ivyIndices.length; index += 3) {
  const runnerIndex = ivyRunner.getX(ivyIndices[index]!);
  assert.equal(ivyRunner.getX(ivyIndices[index + 1]!), runnerIndex);
  assert.equal(ivyRunner.getX(ivyIndices[index + 2]!), runnerIndex);
}
assert.equal(FOREST_FLOOR_IVY_LEAF_BOUNDARY.length, 16);
assert.ok(
  Math.min(...Array.from({ length: ivyUv.count }, (_, index) => ivyUv.getX(index))) >= 0,
);
assert.ok(
  Math.max(...Array.from({ length: ivyUv.count }, (_, index) => ivyUv.getX(index))) <= 1,
);
for (const range of compiledIvy.leafVertexRanges) {
  assert.ok(Math.abs(ivyUv.getX(range.rootVertex) - 0.5) < 1e-6);
  assert.ok(Math.abs(ivyUv.getY(range.rootVertex)) < 1e-6);
  assert.ok(Math.abs(ivyUv.getX(range.tipVertex) - 0.5) < 1e-6);
  assert.ok(Math.abs(ivyUv.getY(range.tipVertex) - 1) < 1e-6);
  assert.ok(
    ivyTint.getY(range.start + FOREST_FLOOR_IVY_LEAF_VERTICES - 1)
      > ivyTint.getY(range.rootVertex),
    'procedural vertex color should preserve a readable midrib-to-petiole gradient',
  );
}

function smootherstep(edge0: number, edge1: number, value: number): number {
  const t = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function ivyAngleAt(
  root: THREE.Vector3,
  phase: number,
  hingeAmplitude: number,
  seconds: number,
  strength: number,
  distanceToCamera: number,
): number {
  const time = seconds * 0.84;
  const spatialPhase = root.x * 0.35 + root.z * 0.27;
  const gust = Math.sin(time * 1.15 + spatialPhase) * 0.72
    + Math.sin(time * 2.63 + spatialPhase * 1.9) * 0.28;
  const macroFade = 1 - smootherstep(22, 44, distanceToCamera) * 0.85;
  const flutterFade = 1 - smootherstep(8, 28, distanceToCamera);
  const flutterGate = smootherstep(0.05, 0.12, hingeAmplitude);
  const flutter = Math.sin(time * 5.2 + phase)
    * 0.18 * flutterGate * flutterFade;
  return THREE.MathUtils.clamp(
    (gust * macroFade + flutter) * strength * hingeAmplitude,
    -0.12,
    0.28,
  );
}

const motionSampleTimes = [0, 1.25, 2.5, 5, 8, 12];
const leafPhases = new Set<string>();
const motionSignatures = new Set<string>();
let movingLeafCount = 0;
for (const range of compiledIvy.leafVertexRanges) {
  const root = new THREE.Vector3(
    ivyRootPhase.getX(range.rootVertex),
    ivyRootPhase.getY(range.rootVertex),
    ivyRootPhase.getZ(range.rootVertex),
  );
  const phase = ivyRootPhase.getW(range.rootVertex);
  const axis = new THREE.Vector3(
    ivyHinge.getX(range.rootVertex),
    ivyHinge.getY(range.rootVertex),
    ivyHinge.getZ(range.rootVertex),
  );
  const hingeAmplitude = ivyHinge.getW(range.rootVertex);
  const leafNormalYs = Array.from(
    { length: range.count },
    (_, index) => ivyNormal.getY(range.start + index),
  );
  assert.ok(
    Math.min(...leafNormalYs) > 0.05,
    `leaf ${range.leafIndex} must keep its authored face normals above the litter`,
  );
  assert.ok(Math.abs(axis.length() - 1) < 1e-6, 'every leaf needs a unit hinge axis');
  assert.ok(hingeAmplitude > 0, 'every visible leaf needs non-zero flexibility');
  assert.ok(
    new THREE.Vector3(
      ivyPosition.getX(range.rootVertex),
      ivyPosition.getY(range.rootVertex),
      ivyPosition.getZ(range.rootVertex),
    ).distanceTo(root) < 1e-6,
    'the petiole vertex must lie exactly on its rotation root',
  );
  for (let index = range.start; index < range.start + range.count; index++) {
    assert.equal(ivyRootPhase.getX(index), root.x);
    assert.equal(ivyRootPhase.getY(index), root.y);
    assert.equal(ivyRootPhase.getZ(index), root.z);
    assert.equal(ivyRootPhase.getW(index), phase);
    assert.equal(ivyHinge.getX(index), axis.x);
    assert.equal(ivyHinge.getY(index), axis.y);
    assert.equal(ivyHinge.getZ(index), axis.z);
    assert.equal(ivyHinge.getW(index), hingeAmplitude);
  }
  leafPhases.add(phase.toFixed(5));

  const restTip = new THREE.Vector3(
    ivyPosition.getX(range.tipVertex),
    ivyPosition.getY(range.tipVertex),
    ivyPosition.getZ(range.tipVertex),
  );
  const rootRelativeTip = restTip.clone().sub(root);
  let maximumMotion = 0;
  const signature: number[] = [];
  for (const seconds of motionSampleTimes) {
    const angle = ivyAngleAt(root, phase, hingeAmplitude, seconds, 1, 4);
    const animatedRoot = new THREE.Vector3()
      .applyAxisAngle(axis, angle)
      .add(root);
    assert.ok(
      animatedRoot.distanceTo(root) < 1e-9,
      'rigid hinge rotation must keep every petiole root invariant',
    );
    const animatedTip = rootRelativeTip.clone().applyAxisAngle(axis, angle).add(root);
    const motion = animatedTip.distanceTo(restTip);
    maximumMotion = Math.max(maximumMotion, motion);
    signature.push(Number(motion.toFixed(5)));
  }
  assert.equal(Math.abs(ivyAngleAt(root, phase, hingeAmplitude, 5, 0, 4)), 0);
  assert.ok(
    maximumMotion <= FOREST_FLOOR_IVY_ANIMATION_MAX_TIP_DISPLACEMENT + 1e-6,
    `leaf ${range.leafIndex} exceeded the sheltered groundcover motion cap`,
  );
  if (maximumMotion > 0.001) movingLeafCount += 1;
  motionSignatures.add(signature.join(','));
}
assert.equal(
  movingLeafCount,
  FOREST_FLOOR_IVY_LEAVES_PER_PATCH,
  'every visible ivy leaf should respond over a complete SeedThree gust sample',
);
assert.ok(
  leafPhases.size >= FOREST_FLOOR_IVY_LEAVES_PER_PATCH * 0.9,
  'individual leaves need deterministic non-lockstep phases',
);
assert.ok(
  motionSignatures.size >= FOREST_FLOOR_IVY_LEAVES_PER_PATCH * 0.75,
  'individual leaves must not animate as one rocking colony card',
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
  'fixed seed, placement, and terrain should reproduce every runner and leaf',
);
assert.deepEqual(
  Array.from(repeatedIvy.geometry.index!.array),
  Array.from(compiledIvy.geometry.index!.array),
  'fixed inputs should reproduce the runner-chain topology exactly',
);
assert.deepEqual(
  Array.from(repeatedIvy.geometry.getAttribute('aIvyRootPhase').array),
  Array.from(ivyRootPhase.array),
  'fixed inputs should reproduce every petiole root and leaf phase',
);
assert.deepEqual(
  Array.from(repeatedIvy.geometry.getAttribute('aIvyHinge').array),
  Array.from(ivyHinge.array),
  'fixed inputs should reproduce every leaf hinge and amplitude',
);

assert.equal(
  FOREST_FLOOR_IVY_RUNNER_TRIANGLES,
  FOREST_FLOOR_IVY_RUNNER_SEGMENTS * 4,
);

assert.equal(FOREST_FLOOR_TWIG_VARIANT_COUNT, 3);
assert.equal(FOREST_FLOOR_TWIG_RADIAL_SEGMENTS, 6);
assert.equal(FOREST_FLOOR_TWIG_TEXTURE_REPEAT_METERS, 0.19);
assert.equal(FOREST_FLOOR_TWIG_MIN_SPACING, 0.72);
assert.equal(FOREST_FLOOR_TWIG_MAX_INSTANCES, 3_600);
assert.equal(FOREST_FLOOR_TWIG_TARGETS_PER_TREE, 0.46);
assert.deepEqual(FOREST_FLOOR_TWIG_SCALE_RANGE, [0.94, 1.22]);
assert.deepEqual(FOREST_FLOOR_TWIG_THICKNESS_RANGE, [0.94, 1.18]);
assert.deepEqual(
  FOREST_FLOOR_TWIG_VARIANTS.map(({ length, baseRadius }) => [length, baseRadius]),
  [[0.9, 0.031], [1.25, 0.038], [1.65, 0.046]],
  'twig prototypes must retain legible twig-to-small-stick dimensions',
);
assert.deepEqual(FOREST_FLOOR_TWIG_TEXTURE_SOURCES, {
  albedo: FOREST_FLOOR_TWIG_ALBEDO_TEXTURE_PATH,
  normal: FOREST_FLOOR_TWIG_NORMAL_TEXTURE_PATH,
  roughness: FOREST_FLOOR_TWIG_ROUGHNESS_TEXTURE_PATH,
});
const twigGeometries = Array.from(
  { length: FOREST_FLOOR_TWIG_VARIANT_COUNT },
  (_, variantIndex) => createForestFloorTwigGeometry(variantIndex),
);
for (const [variantIndex, geometry] of twigGeometries.entries()) {
  const repeated = createForestFloorTwigGeometry(variantIndex);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  const triangles = (geometry.getIndex()?.count ?? 0) / 3;
  const authored = FOREST_FLOOR_TWIG_VARIANTS[variantIndex]!;
  const bounds = geometry.boundingBox!.getSize(new THREE.Vector3());
  assert.equal(position.count, 58, `twig variant ${variantIndex} exceeded its vertex budget`);
  assert.equal(uv.count, position.count, `twig variant ${variantIndex} must own continuous bark UVs`);
  assert.equal(triangles, 72, `twig variant ${variantIndex} exceeded its triangle budget`);
  assert.ok(
    bounds.x >= authored.length * 0.98 && bounds.x <= authored.length * 1.02,
    `twig variant ${variantIndex} must retain its authored ${authored.length.toFixed(2)} m length`,
  );
  assert.equal(geometry.userData.seedThreeGenerator, 'forest-floor-bent-tapered-tube');
  assert.equal(geometry.userData.ringCount, authored.points.length);
  assert.equal(geometry.userData.radialSegments, FOREST_FLOOR_TWIG_RADIAL_SEGMENTS);
  assert.equal(geometry.userData.textureRepeatMeters, FOREST_FLOOR_TWIG_TEXTURE_REPEAT_METERS);
  assert.deepEqual(
    Array.from(repeated.getAttribute('position').array),
    Array.from(position.array),
    `twig variant ${variantIndex} must reproduce its bent centerline exactly`,
  );
  assert.deepEqual(
    Array.from(repeated.getIndex()!.array),
    Array.from(geometry.getIndex()!.array),
    `twig variant ${variantIndex} must reproduce its capped topology exactly`,
  );
  repeated.dispose();
}

assert.doesNotMatch(
  ivySource,
  /loadSeedThreeGroundCoverTextures|forest-floor-ivy-card\.png/,
  'procedural ivy must not sample the rejected colony-card texture',
);
assert.match(ivySource, /createTerrainConformingIvyGeometry/);
assert.match(ivySource, /new THREE\.DataTexture\([\s\S]*?255, 255, 255, 255/);
assert.match(
  ivySource,
  /createSeedThreeGroundCoverMaterial/,
  'ivy must retain Seloslav SeedThree material ownership around its terrain compiler',
);
assert.doesNotMatch(
  ivySource,
  /createSeedThreeCardClumpGeometry|new THREE\.InstancedMesh|tiltMin:/,
  'the rejected flat-card and crossed-card colony must not return',
);
assert.match(ivySource, /terrain\.getHeightAt\(worldX, worldZ\)/);
assert.match(ivySource, /sourceTreeIndex:[\s\S]*?placementVertexRangesByTree/);
assert.match(ivySource, /new THREE\.Mesh\(compiled\.geometry, material\)/);
assert.match(ivySource, /createIvyLeafHingeWindNodes/);
assert.match(ivySource, /hingeWind\.normalNode/);
assert.match(ivySource, /applyIvyLeafHingeWebGLWind\(material\)/);
assert.match(ivySource, /geometry\.setAttribute\('aIvyRootPhase'/);
assert.match(ivySource, /geometry\.setAttribute\('aIvyHinge'/);
assert.match(ivySource, /createIvyRunnerPlans/);
assert.match(ivySource, /appendIvyRunners/);
assert.match(ivySource, /appendIvyRunnerLeaves/);
assert.match(ivyWindSource, /worldAnimationTime[\s\S]*?windSpeed[\s\S]*?windStrength/);
assert.match(ivyWindSource, /rotateAroundAxis[\s\S]*?rootPhase[\s\S]*?hinge/);
assert.match(ivyWindSource, /transformNormalToView\(rotatedNormal\)/);
assert.match(ivyWindSource, /IVY_HINGE_ACTIVE_Y_THRESHOLD[\s\S]*?step/);
assert.match(ivyWindSource, /uIvyTime[\s\S]*?uIvyWindSpeed[\s\S]*?uIvyWindStrength/);
assert.doesNotMatch(
  ivyWindSource,
  /createIvyLeafHingeWindNodes(?:(?!const IVY_HINGE_WEBGL_CACHE_KEY)[\s\S])*tsl\.uv\(\)\.y/,
  'ivy roots must be explicit petiole attributes rather than texture-V weighting',
);
assert.match(
  groundCoverSource,
  /supportsNodeMaterials\(rendererBackend\)/,
  'the SeedThree node path must cover native WebGPU and WebGL2 node backends',
);
assert.match(ivySource, /FOREST_FLOOR_IVY_HIDDEN_Y[\s\S]*?position\.addUpdateRange/);
assert.match(
  ivySource,
  /FOREST_FLOOR_IVY_RUNNERS_PER_PATCH = 7[\s\S]*?FOREST_FLOOR_IVY_LEAVES_PER_RUNNER = 6[\s\S]*?FOREST_FLOOR_IVY_LEAVES_PER_PATCH/,
  'ivy should declare a bounded runner graph with one explicit leaf at every link',
);
assert.match(ivySource, /tipTaper[\s\S]*?THREE\.MathUtils\.lerp\(1, 0\.18, tipTaper\)/);
assert.match(ivySource, /geometry\.setAttribute\('ivyRunner'/);
assert.doesNotMatch(
  ivySource,
  /FOREST_FLOOR_IVY_LAYER_SPECS|ivyStackHeightAtWorld|appendAnimatedIvyLeaves/,
  'the detached carrier-sheet architecture must not return',
);
assert.match(
  nettleSource,
  /createGorskiShrubPrototype\('nettle', variant\)/,
  'forest-floor nettles must instantiate the first-class SeedThree nettle prototype',
);
assert.match(
  nettleSource,
  /FOREST_FLOOR_NETTLE_MAX_INSTANCES = 192_000[\s\S]*FOREST_FLOOR_NETTLE_COLONY_CHANCE = 0\.8[\s\S]*FOREST_FLOOR_NETTLE_COLONY_MIN_STEMS = 5[\s\S]*FOREST_FLOOR_NETTLE_COLONY_MAX_STEMS = 9[\s\S]*shuffledNettleSourceTreeIndices\(trees\.length, seed\)[\s\S]*colonyRotation[\s\S]*GOLDEN_ANGLE/,
  'nettles must scale with accepted forest area and form seed-stable multi-stem colonies',
);
assert.match(
  nettleSource,
  /FOREST_FLOOR_NETTLE_MIN_HEIGHT = 0\.82[\s\S]*FOREST_FLOOR_NETTLE_MAX_HEIGHT = 1\.18[\s\S]*targetHeight: THREE\.MathUtils\.lerp\([\s\S]*prototypeHeight[\s\S]*placement\.targetHeight \/ prototypeHeight/,
  'young nettles must normalize every prototype to an authored height above the ivy canopy',
);
assert.match(
  nettleSource,
  /FOREST_FLOOR_NETTLE_STREAM_RADIUS = 104[\s\S]*rebuildResidentInstances[\s\S]*dx \* dx \+ dz \* dz > radiusSquared[\s\S]*mesh\.count = writeIndex/,
  'the larger world population must submit only camera-local resident nettles',
);
assert.match(
  nettleSource,
  /applyRootedGeometryWebGLWind\(material, 0\.07\)/,
  'classic WebGL nettles must share the rooted SeedThree wind path',
);
assert.match(
  nettleSource,
  /NETTLE_LEAF_FILES[\s\S]*stinging_nettle_single_albedo\.png[\s\S]*stinging_nettle_single_normal\.png[\s\S]*stinging_nettle_single_roughness\.png[\s\S]*stinging_nettle_single_translucency\.png/,
  'nettle leaf cards must retain their complete dedicated PBR/SSS set',
);
assert.match(
  nettleSource,
  /NETTLE_STEM_FILES[\s\S]*stinging_nettle_stem_albedo\.png[\s\S]*stinging_nettle_stem_normal\.png[\s\S]*stinging_nettle_stem_roughness\.png/,
  'nettle stems must retain their dedicated bark PBR set',
);
assert.match(
  twigSource,
  /new THREE\.MeshStandardMaterial\(\{[\s\S]*map: textures\.albedo,[\s\S]*normalMap: textures\.normal,[\s\S]*roughnessMap: textures\.roughness,[\s\S]*vertexColors: true/,
  'twigs must render their full authored PBR texture set with deterministic tint variation',
);
assert.match(
  forestPropsSource,
  /const nettlesPromise = createForestFloorNettleInstances\([\s\S]*?const twigsPromise = createForestFloorTwigInstances\(/,
  'ForestProps must schedule both new forest-floor systems before renderer-specific tree setup',
);
assert.match(
  forestPropsSource,
  /createForestFloorNettlePlacements\([\s\S]*?nettleColonyIndex[\s\S]*?FOREST_FLOOR_NETTLE_UNDERGROWTH_CLEAR_RADIUS[\s\S]*?createUndergrowthPlacements\([\s\S]*?isUndergrowthBlockedAt/,
  'nettle colony cores must reserve a small clearing from ferns and other understory bushes',
);
assert.match(
  forestPropsSource,
  /Promise\.all\(\[[\s\S]*?ivyPromise,[\s\S]*?nettlesPromise,[\s\S]*?twigsPromise,[\s\S]*?\]\)/,
  'ivy, nettles, and twigs must resolve through the same deterministic forest bootstrap',
);
assert.equal(
  forestPropsSource.match(/forest\.add\(forestFloorNettles\.group\);/g)?.length,
  2,
  'both WebGPU and fallback forest paths must attach nettles',
);
assert.equal(
  forestPropsSource.match(/forest\.add\(forestFloorTwigs\.group\);/g)?.length,
  2,
  'both WebGPU and fallback forest paths must attach twigs',
);
assert.equal(
  forestPropsSource.match(/forestFloorNettles\.dispose\(\);/g)?.length,
  2,
  'both forest disposal paths must release nettle geometry and textures',
);
assert.equal(
  forestPropsSource.match(/forestFloorTwigs\.dispose\(\);/g)?.length,
  2,
  'both forest disposal paths must release twig geometry and textures',
);
assert.match(
  lineupSource,
  /requestedSeason === 'autumn' \|\| requestedSeason === 'winter'[\s\S]*?: 'summer'/,
  'the forest-floor lineup must expose deterministic summer, autumn, and winter queries',
);
assert.match(
  lineupSource,
  /createForestFloorNettleInstances\([\s\S]*?loadForestFloorTwigTextures[\s\S]*?createForestFloorTwigGeometry/,
  'the lineup must render live nettle prototypes beside the complete twig variant set',
);
assert.match(
  lineupSource,
  /setForestCardSnowCoverage\(ivyMaterial, ivySnowCoverage\)[\s\S]*?nettles\.setDeciduousFoliage\(deciduousFoliage\)/,
  'seasonal lineup queries must apply winter snow to ivy and seasonal color to nettles',
);
assert.match(
  lineupSource,
  /dataset\.season = season[\s\S]*?dataset\.nettleInstances[\s\S]*?dataset\.twigInstances[\s\S]*?dataset\.forestFloorSignature/,
  'the lineup must publish stable forest-floor evidence for browser regression tests',
);
assert.match(
  managerSource,
  /setTreeForestFloorActive\(treeIndex, false\)[\s\S]*?setTreeForestFloorActive\(treeIndex, true\)/,
  'tree hide/show paths should own both their ivy and floor shade',
);
assert.match(
  managerSource,
  /this\.canopyOcclusion\?\.setTreeActive\(treeIndex, active, true\);[\s\S]*?this\.forestFloorIvy\?\.setTreeActive\(treeIndex, active\);[\s\S]*?this\.forestFloorTwigs\?\.setTreeActive\(treeIndex, active\);/,
  'tree ownership must still update canopy shade, ivy, and fallen twigs',
);
assert.doesNotMatch(
  managerSource.match(/private setTreeForestFloorActive[\s\S]*?\n  \}/)?.[0] ?? '',
  /forestFloorNettles\?\.setTreeActive/,
  'felling a source tree must not erase independent nettle colonies',
);
assert.match(
  ivySource,
  /createForestFloorPlacementMask\([\s\S]*?refreshBlockedMask[\s\S]*?ivyIntersectsBlocker/,
  'broad offset ivy colonies need their own footprint clearance mask',
);
assert.match(
  nettleSource,
  /createForestFloorPlacementMask\([\s\S]*?refreshBlockedMask[\s\S]*?nettleIntersectsBlocker/,
  'offset nettles need placement clearance independent of their source tree',
);
assert.match(
  twigSource,
  /createForestFloorPlacementMask\([\s\S]*?refreshBlockedMask[\s\S]*?twigIntersectsBlocker/,
  'offset twigs need placement clearance independent of their source tree',
);
assert.match(
  managerSource,
  /syncRoadClearance\(network:[\s\S]*?this\.syncForestFloorPlacementClearance\(\);/,
  'road refreshes must re-evaluate each forest-floor placement footprint',
);
assert.match(
  managerSource,
  /syncPlacementClearance\(clearance:[\s\S]*?this\.syncForestFloorPlacementClearance\(\);/,
  'building, parcel, and field refreshes must re-evaluate forest-floor placements',
);
assert.match(
  managerSource,
  /forestFloorIvy\?\.refreshBlockedMask\(isBlockedAt\)[\s\S]*?forestFloorNettles\?\.refreshBlockedMask\(isBlockedAt\)[\s\S]*?forestFloorTwigs\?\.refreshBlockedMask\(isBlockedAt\)/,
  'one combined manager blocker must refresh ivy, nettles, and twigs without changing source-tree state',
);
assert.match(
  managerSource,
  /isForestFloorPointWithinClearance[\s\S]*?isUndergrowthNearAnyEdge[\s\S]*?someBuildingNear[\s\S]*?someBurgageParcelNear[\s\S]*?someFarmFieldNear/,
  'forest-floor blockers must combine road, building, burgage, and farm footprints',
);
assert.match(managerSource, /this\.canopyOcclusion\?\.commit\(\);/);
assert.match(
  managerSource,
  /this\.forestFloorIvy\?\.commit\(\);[\s\S]*?this\.forestFloorNettles\?\.commit\(\);[\s\S]*?this\.forestFloorTwigs\?\.commit\(\);/,
  'one tree-update flush must upload every owned forest-floor system',
);
assert.match(
  managerSource,
  /this\.forestFloorNettles\?\.updateCamera\([\s\S]*?camera\.position,[\s\S]*?visible,[\s\S]*?this\.forestFloorTwigs\?\.setCloseDetailVisible\(visible\);/,
  'the close-detail visibility gate must stream nearby nettles and cover twigs with ivy',
);
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

for (const twigTexturePath of twigTexturePaths) {
  const texture = readFileSync(twigTexturePath);
  assert.ok(
    statSync(twigTexturePath).size > 200_000,
    `${twigTexturePath} should remain an authored map rather than a placeholder`,
  );
  assert.equal(texture.subarray(1, 4).toString('ascii'), 'PNG');
}

map.dispose();
isolatedMap.dispose();
secondMap.dispose();
closureMap.dispose();
denseMap.dispose();
terrainGeometry.dispose();
compiledIvy.geometry.dispose();
repeatedIvy.geometry.dispose();
for (const geometry of twigGeometries) geometry.dispose();
console.log(
  `Forest-floor coverage contract tests passed (center shade ${covered.toFixed(3)}, sun openings ${(openingRatio * 100).toFixed(1)}%).`,
);
