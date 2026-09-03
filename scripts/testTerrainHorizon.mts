import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  TerrainHorizon,
  TERRAIN_HORIZON_PARAMETERS,
} from '../src/terrain/TerrainHorizon.ts';

const TERRAIN_SIZE = 80;
const RESOLUTION = 9;
const FAR_DISTANCE = 600;

function testHeight(x: number, z: number): number {
  return x * 0.1 + z * 0.05 + Math.sin(x * 0.04) * 0.3;
}

function createSourceGeometry(): THREE.BufferGeometry {
  const positions = new Float32Array(RESOLUTION * RESOLUTION * 3);
  const normals = new Float32Array(RESOLUTION * RESOLUTION * 3);
  const uvs = new Float32Array(RESOLUTION * RESOLUTION * 2);
  const colors = new Float32Array(RESOLUTION * RESOLUTION * 3);
  const staticMasks = new Float32Array(RESOLUTION * RESOLUTION * 3);
  const scalar = new Float32Array(RESOLUTION * RESOLUTION);
  const canopy = new Uint8Array(RESOLUTION * RESOLUTION * 4);
  const half = TERRAIN_SIZE * 0.5;
  const step = TERRAIN_SIZE / (RESOLUTION - 1);
  for (let zIndex = 0; zIndex < RESOLUTION; zIndex++) {
    for (let xIndex = 0; xIndex < RESOLUTION; xIndex++) {
      const index = zIndex * RESOLUTION + xIndex;
      const x = -half + xIndex * step;
      const z = -half + zIndex * step;
      positions.set([x, testHeight(x, z), z], index * 3);
      normals.set([-0.1, 1, -0.05], index * 3);
      uvs.set([x / 48, z / 48], index * 2);
      colors.set([0.6, 0.25, 0.15], index * 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  const uv = new THREE.BufferAttribute(uvs, 2);
  geometry.setAttribute('uv', uv);
  geometry.setAttribute('uv2', uv);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const masks = new THREE.InterleavedBuffer(staticMasks, 3);
  geometry.setAttribute('forestBlend', new THREE.InterleavedBufferAttribute(masks, 1, 0));
  geometry.setAttribute('shoreBlend', new THREE.InterleavedBufferAttribute(masks, 1, 1));
  geometry.setAttribute('quarryPadBlend', new THREE.InterleavedBufferAttribute(masks, 1, 2));
  geometry.setAttribute('roadWearBlend', new THREE.BufferAttribute(scalar, 1));
  geometry.setAttribute('dirtZoomGate', new THREE.BufferAttribute(scalar, 1));
  geometry.setAttribute('forestCanopyOcclusion', new THREE.BufferAttribute(canopy, 4, true));
  return geometry;
}

function createHorizon(source: THREE.BufferGeometry, material: THREE.Material): TerrainHorizon {
  return new TerrainHorizon({
    sourceGeometry: source,
    material,
    terrainSize: TERRAIN_SIZE,
    sourceResolution: RESOLUTION,
    farDistance: FAR_DISTANCE,
    seed: 0x71a2e0d,
    sampleHeight: testHeight,
  });
}

const source = createSourceGeometry();
const material = new THREE.MeshStandardMaterial({ vertexColors: true });
const horizon = createHorizon(source, material);
const diagnostics = horizon.getDiagnostics();

assert.equal(diagnostics.drawCalls, 1);
assert.equal(diagnostics.castsShadows, false);
assert.equal(diagnostics.receivesShadows, false);
assert.equal(diagnostics.updatesPerFrame, false);
assert.equal(horizon.mesh.castShadow, false);
assert.equal(horizon.mesh.receiveShadow, false);
assert.equal(horizon.mesh.children.length, 0, 'the horizon must remain one draw object');
assert.ok(
  diagnostics.outerHalfExtent - diagnostics.innerHalfExtent >=
    FAR_DISTANCE * TERRAIN_HORIZON_PARAMETERS.coverage.farPlaneMultiplier,
  'the outer edge must stay beyond the camera far plane from the playable edge',
);
assert.ok(
  diagnostics.triangleCount <= TERRAIN_HORIZON_PARAMETERS.budget.maximumTriangles,
  `the static horizon exceeded its triangle budget: ${diagnostics.triangleCount}`,
);
for (let index = 1; index < diagnostics.lodRows.length; index++) {
  const previous = diagnostics.lodRows[index - 1]!;
  const current = diagnostics.lodRows[index]!;
  assert.ok(current.halfExtent > previous.halfExtent, 'LOD rows must move monotonically outward');
  assert.ok(
    current.segmentsPerSide <= previous.segmentsPerSide,
    'LOD segment density must never increase with distance',
  );
  assert.ok(current.filterRadius >= previous.filterRadius, 'filter width must grow with LOD distance');
}

const horizonPositions = horizon.mesh.geometry.getAttribute('position');
const horizonIndices = horizon.mesh.geometry.getIndex();
assert.ok(horizonIndices);
const playableHalf = TERRAIN_SIZE * 0.5;
let seamVertices = 0;
for (let index = 0; index < horizonPositions.count; index++) {
  const x = horizonPositions.getX(index);
  const y = horizonPositions.getY(index);
  const z = horizonPositions.getZ(index);
  assert.ok(
    Math.max(Math.abs(x), Math.abs(z)) >= playableHalf - 1e-6,
    'visual-only horizon geometry must not cover the playable terrain interior',
  );
  if (Math.abs(Math.max(Math.abs(x), Math.abs(z)) - playableHalf) <= 1e-6) {
    seamVertices++;
    assert.ok(Math.abs(y - testHeight(x, z)) <= 1e-5, 'the horizon seam must copy source height exactly');
  }
}
assert.equal(seamVertices, 4 * RESOLUTION, 'every source boundary vertex must be copied once per side');
for (let triangle = 0; triangle < horizonIndices.count; triangle += 3) {
  const a = horizonIndices.getX(triangle);
  const b = horizonIndices.getX(triangle + 1);
  const c = horizonIndices.getX(triangle + 2);
  const abX = horizonPositions.getX(b) - horizonPositions.getX(a);
  const abZ = horizonPositions.getZ(b) - horizonPositions.getZ(a);
  const acX = horizonPositions.getX(c) - horizonPositions.getX(a);
  const acZ = horizonPositions.getZ(c) - horizonPositions.getZ(a);
  assert.ok(
    abZ * acX - abX * acZ > 0,
    `triangle ${triangle / 3} must face upward`,
  );
}

const vertexBuffers = new Set<unknown>();
for (const attribute of Object.values(horizon.mesh.geometry.attributes)) {
  vertexBuffers.add(attribute instanceof THREE.InterleavedBufferAttribute ? attribute.data : attribute);
}
assert.ok(vertexBuffers.size <= 8, `WebGPU terrain horizon uses ${vertexBuffers.size} vertex buffers`);

const second = createHorizon(source, material);
assert.deepEqual(
  Array.from(second.mesh.geometry.getAttribute('position').array),
  Array.from(horizon.mesh.geometry.getAttribute('position').array),
  'identical seed and inputs must produce identical horizon geometry',
);

const productionColors = horizon.mesh.geometry.getAttribute('color');
horizon.setDebugMode('lod');
assert.notEqual(horizon.mesh.material, material);
assert.notEqual(horizon.mesh.geometry.getAttribute('color'), productionColors);
horizon.setDebugMode('height');
assert.notEqual(horizon.mesh.geometry.getAttribute('color'), productionColors);
horizon.setDebugMode('wireframe');
assert.equal((horizon.mesh.material as THREE.MeshBasicMaterial).wireframe, true);
horizon.setDebugMode('final');
assert.equal(horizon.mesh.material, material);
assert.equal(horizon.mesh.geometry.getAttribute('color'), productionColors);

const requiredAttributes = [
  'position',
  'normal',
  'uv',
  'uv2',
  'color',
  'forestBlend',
  'shoreBlend',
  'quarryPadBlend',
  'roadWearBlend',
  'dirtZoomGate',
  'forestCanopyOcclusion',
];
for (const attribute of requiredAttributes) {
  assert.ok(horizon.mesh.geometry.getAttribute(attribute), `missing production material attribute ${attribute}`);
}

second.dispose();
horizon.dispose();
source.dispose();
material.dispose();

console.log('Terrain horizon LOD tests passed.');
