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
  FOREST_FLOOR_IVY_ANIMATED_LEAVES_PER_PATCH,
  FOREST_FLOOR_IVY_ANIMATION_MAX_TIP_DISPLACEMENT,
  FOREST_FLOOR_IVY_CANOPY_HEIGHT_MAX,
  FOREST_FLOOR_IVY_GROUND_CLEARANCE,
  FOREST_FLOOR_IVY_LEAF_VERTICES,
  FOREST_FLOOR_IVY_LAYER_COUNT,
  FOREST_FLOOR_IVY_LAYER_SPECS,
  FOREST_FLOOR_IVY_SHEET_VERTICES_PER_PATCH,
  FOREST_FLOOR_IVY_TRIANGLES_PER_PATCH,
  FOREST_FLOOR_IVY_UV_BOUNDS,
  FOREST_FLOOR_IVY_VERTICES_PER_PATCH,
  type ForestFloorIvyPlacement,
} from '../src/props/ForestFloorIvy.ts';

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
  uploadedComponents < (productionPosition.count * 4) / 20,
  `the local canopy upload must remain bounded (uploaded ${uploadedComponents} of ${productionPosition.count * 4} components)`,
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
const ivyLayer = compiledIvy.geometry.getAttribute('ivyLayer') as THREE.BufferAttribute;
const ivyTint = compiledIvy.geometry.getAttribute('aTint') as THREE.BufferAttribute;
const ivyRootPhase = compiledIvy.geometry.getAttribute(
  'aIvyRootPhase',
) as THREE.BufferAttribute;
const ivyHinge = compiledIvy.geometry.getAttribute('aIvyHinge') as THREE.BufferAttribute;
assert.equal(ivyPosition.count, FOREST_FLOOR_IVY_VERTICES_PER_PATCH);
assert.equal(
  compiledIvy.geometry.index!.count / 3,
  FOREST_FLOOR_IVY_TRIANGLES_PER_PATCH,
);
assert.equal(compiledIvy.layerVertexRanges.length, FOREST_FLOOR_IVY_LAYER_COUNT);
assert.deepEqual(
  compiledIvy.placementVertexRangesByTree,
  [[{ start: 0, count: FOREST_FLOOR_IVY_VERTICES_PER_PATCH }]],
);
const expectedLayerKinds = FOREST_FLOOR_IVY_LAYER_SPECS.map((layer) => layer.kind);
assert.deepEqual(
  compiledIvy.layerVertexRanges.map((range) => range.kind),
  expectedLayerKinds,
);
let expectedLayerStart = 0;
for (const [layerIndex, range] of compiledIvy.layerVertexRanges.entries()) {
  const spec = FOREST_FLOOR_IVY_LAYER_SPECS[layerIndex]!;
  assert.equal(range.start, expectedLayerStart);
  assert.equal(range.count, (spec.segmentsX + 1) * (spec.segmentsZ + 1));
  assert.equal(range.layerIndex, layerIndex);
  assert.equal(range.placementIndex, 0);
  for (let index = range.start; index < range.start + range.count; index++) {
    assert.equal(ivyLayer.getX(index), layerIndex);
  }
  expectedLayerStart += range.count;
}
assert.equal(expectedLayerStart, FOREST_FLOOR_IVY_SHEET_VERTICES_PER_PATCH);
assert.equal(
  compiledIvy.animatedLeafVertexRanges.length,
  FOREST_FLOOR_IVY_ANIMATED_LEAVES_PER_PATCH,
);
for (const [leafIndex, range] of compiledIvy.animatedLeafVertexRanges.entries()) {
  assert.equal(
    range.start,
    FOREST_FLOOR_IVY_SHEET_VERTICES_PER_PATCH
      + leafIndex * FOREST_FLOOR_IVY_LEAF_VERTICES,
  );
  assert.equal(range.count, FOREST_FLOOR_IVY_LEAF_VERTICES);
  assert.equal(range.leafIndex, leafIndex);
  assert.equal(range.placementIndex, 0);
  assert.equal(range.rootVertex, range.start);
  assert.ok(range.tipVertex >= range.start && range.tipVertex < range.start + range.count);
}

const ivyIndices = compiledIvy.geometry.index!.array;
for (let index = 0; index < ivyIndices.length; index += 3) {
  const aLayer = ivyLayer.getX(ivyIndices[index]!);
  assert.equal(ivyLayer.getX(ivyIndices[index + 1]!), aLayer);
  assert.equal(ivyLayer.getX(ivyIndices[index + 2]!), aLayer);
}

for (let index = 0; index < FOREST_FLOOR_IVY_SHEET_VERTICES_PER_PATCH; index++) {
  assert.equal(ivyHinge.getW(index), 0, 'broad carrier sheets must remain terrain-welded');
  assert.equal(ivyRootPhase.getX(index), 0);
  assert.equal(ivyRootPhase.getY(index), 0);
  assert.equal(ivyRootPhase.getZ(index), 0);
  assert.equal(ivyRootPhase.getW(index), 0);
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
for (const range of compiledIvy.animatedLeafVertexRanges) {
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
    Math.min(...leafNormalYs) > 0.08,
    `leaf ${range.leafIndex} must keep its authored face normals above the litter (observed ${Math.min(...leafNormalYs).toFixed(3)})`,
  );
  assert.ok(Math.abs(axis.length() - 1) < 1e-6, 'every leaf needs a unit hinge axis');
  assert.ok(hingeAmplitude > 0, 'every explicit leaf needs non-zero flexibility');
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
  assert.ok(
    Math.abs(ivyAngleAt(root, phase, hingeAmplitude, 5, 0, 4)) === 0,
    'zero SeedThree wind strength must reproduce the authored rest pose',
  );
  assert.ok(
    maximumMotion <= FOREST_FLOOR_IVY_ANIMATION_MAX_TIP_DISPLACEMENT + 1e-6,
    `leaf ${range.leafIndex} exceeded the sheltered groundcover motion cap`,
  );
  if (maximumMotion > 0.001) movingLeafCount += 1;
  motionSignatures.add(signature.join(','));
}
assert.equal(
  movingLeafCount,
  FOREST_FLOOR_IVY_ANIMATED_LEAVES_PER_PATCH,
  'every explicit leaf should visibly respond over a complete gust sample',
);
assert.ok(
  leafPhases.size >= FOREST_FLOOR_IVY_ANIMATED_LEAVES_PER_PATCH * 0.9,
  'individual leaves need deterministic non-lockstep phases',
);
assert.ok(
  motionSignatures.size >= FOREST_FLOOR_IVY_ANIMATED_LEAVES_PER_PATCH * 0.75,
  'individual leaves must not animate as one rocking card',
);

const clearanceByLayer = compiledIvy.layerVertexRanges.map(() => [] as number[]);
const normalYByLayer = compiledIvy.layerVertexRanges.map(() => [] as number[]);
const tintBrightnessByLayer = compiledIvy.layerVertexRanges.map(() => [] as number[]);
for (const [layerIndex, range] of compiledIvy.layerVertexRanges.entries()) {
  for (let index = range.start; index < range.start + range.count; index++) {
    const x = ivyPosition.getX(index);
    const z = ivyPosition.getZ(index);
    clearanceByLayer[layerIndex]!.push(
      ivyPosition.getY(index) - slopedTerrain.getHeightAt(x, z),
    );
    normalYByLayer[layerIndex]!.push(ivyNormal.getY(index));
    tintBrightnessByLayer[layerIndex]!.push(
      (ivyTint.getX(index) + ivyTint.getY(index) + ivyTint.getZ(index)) / 3,
    );
  }
}
const minimumClearance = Math.min(...clearanceByLayer.flat());
const maximumClearance = Math.max(...clearanceByLayer.flat());
const layerPeaks = clearanceByLayer.map((values) => Math.max(...values));
const layerTintMeans = tintBrightnessByLayer.map(
  (values) => values.reduce((sum, value) => sum + value, 0) / values.length,
);
const tierPeaks = [0, 0, 0, 0];
const tierTintTotals = [0, 0, 0, 0];
const tierTintCounts = [0, 0, 0, 0];
for (const [layerIndex, spec] of FOREST_FLOOR_IVY_LAYER_SPECS.entries()) {
  tierPeaks[spec.tier] = Math.max(tierPeaks[spec.tier]!, layerPeaks[layerIndex]!);
  tierTintTotals[spec.tier] += layerTintMeans[layerIndex]!;
  tierTintCounts[spec.tier] += 1;
}
const tierTintMeans = tierTintTotals.map(
  (total, tier) => total / tierTintCounts[tier]!,
);
assert.ok(
  Math.abs(minimumClearance - FOREST_FLOOR_IVY_GROUND_CLEARANCE) < 1e-6,
  'the ground stratum should retain exact litter contact',
);
assert.ok(
  maximumClearance > 0.22
    && maximumClearance <= FOREST_FLOOR_IVY_GROUND_CLEARANCE
      + FOREST_FLOOR_IVY_CANOPY_HEIGHT_MAX + 1e-6,
  'the crown should create real layered depth while remaining bounded groundcover',
);
assert.ok(
  FOREST_FLOOR_IVY_LAYER_COUNT > tierPeaks.length,
  'paired botanical lobes should create more disconnected sheets than height tiers',
);
for (let tier = 1; tier < tierPeaks.length; tier++) {
  assert.ok(
    tierPeaks[tier]! > tierPeaks[tier - 1]! + 0.025,
    `tier ${tier} should establish a distinct height band`,
  );
  assert.ok(
    tierTintMeans[tier]! > tierTintMeans[tier - 1]!,
    `tier ${tier} should be brighter than its supporting foliage`,
  );
}
assert.ok(
  Math.min(...normalYByLayer[0]!) > 0.75,
  'only the grounded apron must remain consistently ground-facing',
);
const raisedNormals = normalYByLayer.slice(1).flat();
assert.ok(
  raisedNormals.filter((normalY) => normalY < Math.cos(THREE.MathUtils.degToRad(20))).length
    / raisedNormals.length > 0.05,
  'raised shelves should contain visibly canted macro normals rather than parallel sheets',
);
assert.ok(Math.abs(ivyUv.getX(0) - FOREST_FLOOR_IVY_UV_BOUNDS.minU) < 1e-6);
assert.ok(Math.abs(ivyUv.getY(0) - FOREST_FLOOR_IVY_UV_BOUNDS.minV) < 1e-6);
assert.ok(
  Math.min(...Array.from({ length: ivyUv.count }, (_, index) => ivyUv.getX(index)))
    < FOREST_FLOOR_IVY_UV_BOUNDS.minU,
  'raised shelves should include a transparent UV guard around the alpha silhouette',
);
assert.ok(
  Math.max(...Array.from({ length: ivyUv.count }, (_, index) => ivyUv.getX(index)))
    > FOREST_FLOOR_IVY_UV_BOUNDS.maxU,
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
  'fixed seed, placement, and terrain should reproduce every shelf exactly',
);
assert.deepEqual(
  Array.from(repeatedIvy.geometry.index!.array),
  Array.from(compiledIvy.geometry.index!.array),
  'fixed inputs should reproduce layered topology exactly',
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

assert.match(ivySource, /loadSeedThreeGroundCoverTextures/);
assert.match(ivySource, /createTerrainConformingIvyGeometry/);
assert.match(
  ivySource,
  /createSeedThreeGroundCoverMaterial/,
  'ivy must retain Seloslav SeedThree material ownership around its terrain compiler',
);
assert.doesNotMatch(
  ivySource,
  /createSeedThreeCardClumpGeometry|new THREE\.InstancedMesh|tiltMin:/,
  'the rejected flat-card and crossed-card carrier must not return',
);
assert.match(ivySource, /terrain\.getHeightAt\(worldX, worldZ\)/);
assert.match(ivySource, /sourceTreeIndex:[\s\S]*?placementVertexRangesByTree/);
assert.match(ivySource, /new THREE\.Mesh\(compiled\.geometry, material\)/);
assert.match(ivySource, /createIvyLeafHingeWindNodes/);
assert.match(ivySource, /hingeWind\.normalNode/);
assert.match(ivySource, /applyIvyLeafHingeWebGLWind\(material\)/);
assert.match(ivySource, /geometry\.setAttribute\('aIvyRootPhase'/);
assert.match(ivySource, /geometry\.setAttribute\('aIvyHinge'/);
assert.match(ivySource, /appendAnimatedIvyLeaves/);
assert.match(ivyWindSource, /worldAnimationTime[\s\S]*?windSpeed[\s\S]*?windStrength/);
assert.match(ivyWindSource, /rotateAroundAxis[\s\S]*?rootPhase[\s\S]*?hinge/);
assert.match(ivyWindSource, /transformNormalToView\(rotatedNormal\)/);
assert.match(ivyWindSource, /IVY_HINGE_ACTIVE_Y_THRESHOLD[\s\S]*?step/);
assert.match(ivyWindSource, /uIvyTime[\s\S]*?uIvyWindSpeed[\s\S]*?uIvyWindStrength/);
assert.doesNotMatch(
  ivyWindSource,
  /createIvyLeafHingeWindNodes[\s\S]*?tsl\.uv\(\)\.y/,
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
  /FOREST_FLOOR_IVY_LAYER_SPECS[\s\S]*?kind: 'ground'[\s\S]*?kind: 'lower'[\s\S]*?kind: 'upper'[\s\S]*?kind: 'crown'/,
  'ivy should declare semantic ground, lower, upper, and crown strata',
);
assert.match(ivySource, /ivyStackHeightAtWorld[\s\S]*?overhangScale[\s\S]*?supportGap/);
assert.match(ivySource, /geometry\.setAttribute\('ivyLayer'/);
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
