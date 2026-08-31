import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  addMesh,
  sharedBuildingMaterial,
} from '../src/buildings/buildingMaterials.ts';
import type { ProceduralMaterialRole } from '../src/buildings/proceduralArchitecture/catalog.ts';
import {
  createProceduralBoxGeometry,
  createProceduralMemberGeometry,
  createProceduralPrismGeometry,
  createProceduralRoofPanelGeometry,
  createProceduralRoofTriangleGeometry,
  ProceduralGeometryWriter,
  PROCEDURAL_GEOMETRY_WRITER_VERSION,
  type CompiledProceduralMaterialSlot,
  type ProceduralGeometryWriterResult,
} from '../src/buildings/proceduralArchitecture/geometryWriter.ts';
import { PROCEDURAL_MATERIAL_ROLE_REGISTRY } from '../src/buildings/proceduralArchitecture/materialRoles.ts';

const writer = new ProceduralGeometryWriter([
  'fieldstone',
  'weathered-boards',
  'lime-plaster',
  'rough-timber',
  'split-shingles',
]);

writer.addBox({
  semanticId: 'test-foundation',
  moduleId: 'foundation-module',
  materialRole: 'fieldstone',
  structuralUse: 'foundation-and-plinth',
  center: [0, 0.6, 0],
  size: [4, 1.2, 3],
});
writer.addBox({
  semanticId: 'test-board-wall',
  moduleId: 'wall-module',
  materialRole: 'weathered-boards',
  structuralUse: 'board-cladding',
  center: [0, 2.2, -1.4],
  size: [4, 2, 0.2],
  uvOffsetMeters: [0.5, 0.25],
});
writer.addPrism({
  semanticId: 'test-gable-prism',
  moduleId: 'gable-module',
  materialRole: 'lime-plaster',
  structuralUse: 'masonry-infill',
  center: [0, 3.2, -1.4],
  profile: [[-2, 0], [2, 0], [0, 2]],
  depth: 0.18,
});
writer.addMember({
  semanticId: 'test-diagonal-member',
  moduleId: 'frame-module',
  materialRole: 'rough-timber',
  structuralUse: 'timber-frame',
  start: [-1, 0, 0],
  end: [2, 4, 0],
  width: 0.3,
  depth: 0.22,
});
writer.addRoofPanel({
  semanticId: 'test-shingle-panel',
  moduleId: 'roof-module',
  materialRole: 'split-shingles',
  structuralUse: 'roof-covering',
  eaveOrigin: [-2.2, 2.8, -1],
  eaveVector: [4.4, 0, 0],
  slopeVector: [0, 3, 2],
  thickness: 0.1,
});
writer.addRoofTriangle({
  semanticId: 'test-hipped-roof-face',
  moduleId: 'roof-module',
  materialRole: 'split-shingles',
  structuralUse: 'roof-covering',
  eaveOrigin: [-2.2, 2.8, 2],
  eaveVector: [4.4, 0, 0],
  apexOffset: [0, 2.4, -2],
  thickness: 0.1,
});

const result = writer.build();
assert.equal(result.version, PROCEDURAL_GEOMETRY_WRITER_VERSION);
assert.deepEqual(result.diagnostics, {
  primitiveCount: 6,
  triangleCount: 64,
  vertexCount: 132,
  indexCount: 192,
  materialSlotCount: 5,
  unusedMaterialRoles: [],
});

for (const slot of result.slots) {
  assertSlotTopology(slot);
  const policy = PROCEDURAL_MATERIAL_ROLE_REGISTRY[slot.materialRole].uvPolicy;
  assert.equal(slot.geometry.userData.metricUvMeters, policy.metersPerRepeat[0]);
  assert.deepEqual(
    slot.geometry.userData.proceduralPhysicalUv.metersPerRepeat,
    [...policy.metersPerRepeat],
  );
  assert.equal(
    slot.geometry.userData.proceduralGeometryWriter,
    PROCEDURAL_GEOMETRY_WRITER_VERSION,
  );
  assert.equal(slot.geometry.userData.proceduralMaterialRole, slot.materialRole);
  assert.equal(slot.geometry.userData.proceduralMaterialSlot, slot.materialIndex);
  assert.equal(slot.geometry.userData.proceduralGeometryDiagnostics.finalDimensionsBaked, true);
  assert.equal(slot.geometry.userData.proceduralGeometryDiagnostics.indexed, true);
}

const foundation = materialSlot(result, 'fieldstone');
assert.equal(foundation.diagnostics.triangleCount, 12);
assertClose(foundation.geometry.getAttribute('uv').getX(1), 4 / 2.4);
assertClose(foundation.geometry.getAttribute('uv').getY(2), 1.2 / 2.4);
assert.deepEqual(foundation.diagnostics.primitives[0]?.uvFrame, {
  projection: 'course-aligned',
  uAxis: 'surface-horizontal',
  vAxis: 'surface-vertical',
  origin: [-2, 0, -1.5],
  uDirection: [1, 0, 0],
  vDirection: [0, 1, 0],
  metersPerRepeat: [2.4, 2.4],
  offsetMeters: [0, 0],
});

const boards = materialSlot(result, 'weathered-boards');
const boardUv = boards.geometry.getAttribute('uv');
assertClose(boardUv.getX(0), 0.5 / 2);
assertClose(boardUv.getX(1), (4 + 0.5) / 2);
assertClose(boardUv.getY(2), (2 + 0.25) / 2);
assert.equal(boards.diagnostics.primitives[0]?.uvFrame.projection, 'course-aligned');
assert.equal(boards.diagnostics.primitives[0]?.uvFrame.uAxis, 'member-length');
assert.equal(boards.diagnostics.primitives[0]?.uvFrame.vAxis, 'surface-vertical');

const gable = materialSlot(result, 'lime-plaster');
assert.equal(gable.diagnostics.triangleCount, 8);
const gableUv = gable.geometry.getAttribute('uv');
assertClose(range(gableUv, 0), 4 / 2.6);
assertClose(range(gableUv, 1), 2 / 2.6);

const member = materialSlot(result, 'rough-timber');
assert.equal(member.diagnostics.triangleCount, 12);
const memberUv = member.geometry.getAttribute('uv');
assertClose(memberUv.getX(1), 5 / 2);
assertClose(memberUv.getY(2), 0.3 / 2);
assert.deepEqual(member.diagnostics.primitives[0]?.dimensions, [5, 0.3, 0.22]);
assert.equal(member.diagnostics.primitives[0]?.uvFrame.projection, 'member-aligned');
assert.equal(member.diagnostics.primitives[0]?.uvFrame.uAxis, 'member-length');
assertVectorClose(member.diagnostics.primitives[0]?.uvFrame.uDirection, [0.6, 0.8, 0]);
assert.ok(member.sharedMaterialKeys.includes('timberMid'));

const roof = materialSlot(result, 'split-shingles');
assert.equal(roof.diagnostics.triangleCount, 20);
const roofUv = roof.geometry.getAttribute('uv');
assertClose(roofUv.getX(1), 4.4 / 2.2);
assertClose(roofUv.getY(2), Math.sqrt(13) / 2.2);
assert.equal(roof.diagnostics.primitives[0]?.uvFrame.projection, 'roof-course-aligned');
assert.equal(roof.diagnostics.primitives[0]?.uvFrame.uAxis, 'roof-eave');
assert.equal(roof.diagnostics.primitives[0]?.uvFrame.vAxis, 'roof-slope');
assert.deepEqual(roof.diagnostics.primitives[0]?.uvFrame.uDirection, [1, 0, 0]);
assert.equal(roof.diagnostics.primitives[1]?.primitive, 'roof-triangle');
assert.deepEqual(roof.diagnostics.primitives[1]?.dimensions, [4.4, Math.sqrt(9.76), 0.1]);

// Existing addMesh must recognize the baked metric UV scale and leave the
// writer's member-aligned coordinates untouched.
const memberUvBefore = Array.from(memberUv.array);
const compatibilityRoot = new THREE.Group();
const compatibilityMesh = addMesh(
  compatibilityRoot,
  member.geometry,
  sharedBuildingMaterial('timberMid'),
  new THREE.Vector3(),
);
assert.strictEqual(compatibilityMesh.geometry, member.geometry);
assert.deepEqual(Array.from(compatibilityMesh.geometry.getAttribute('uv').array), memberUvBefore);
assert.deepEqual(compatibilityMesh.scale.toArray(), [1, 1, 1]);

// Convenience factories retain the same indexed, semantic, final-size contract.
for (const geometry of [
  createProceduralBoxGeometry({
    semanticId: 'factory-box', materialRole: 'fieldstone', structuralUse: 'foundation-and-plinth',
    center: [0, 0.5, 0], size: [1, 1, 1],
  }),
  createProceduralPrismGeometry({
    semanticId: 'factory-prism', materialRole: 'lime-plaster', structuralUse: 'masonry-infill',
    center: [0, 0, 0], profile: [[-1, 0], [1, 0], [0, 1]], depth: 0.2,
  }),
  createProceduralMemberGeometry({
    semanticId: 'factory-member', materialRole: 'rough-timber', structuralUse: 'timber-frame',
    start: [0, 0, 0], end: [0, 2, 0], width: 0.2, depth: 0.15,
  }),
  createProceduralRoofPanelGeometry({
    semanticId: 'factory-roof', materialRole: 'split-shingles', structuralUse: 'roof-covering',
    eaveOrigin: [0, 0, 0], eaveVector: [2, 0, 0], slopeVector: [0, 1, 1], thickness: 0.08,
  }),
  createProceduralRoofTriangleGeometry({
    semanticId: 'factory-roof-triangle', materialRole: 'split-shingles', structuralUse: 'roof-covering',
    eaveOrigin: [-1, 0, 0], eaveVector: [2, 0, 0], apexOffset: [0, 1.5, 1], thickness: 0.08,
  }),
]) {
  assert.ok(geometry.index);
  assert.equal(geometry.userData.proceduralGeometryWriter, PROCEDURAL_GEOMETRY_WRITER_VERSION);
  geometry.dispose();
}

assert.throws(
  () => new ProceduralGeometryWriter([]),
  /at least one material role/,
);
assert.throws(
  () => new ProceduralGeometryWriter(['fieldstone', 'fieldstone']),
  /repeats material role fieldstone/,
);
assert.throws(
  () => new ProceduralGeometryWriter(['unknown-role' as ProceduralMaterialRole]),
  /Unknown procedural material role/,
);
assert.throws(
  () => createProceduralBoxGeometry({
    semanticId: 'zero-box', materialRole: 'fieldstone', structuralUse: 'foundation-and-plinth',
    center: [0, 0, 0], size: [0, 1, 1],
  }),
  /width must be finite/,
);
assert.throws(
  () => createProceduralBoxGeometry({
    semanticId: 'nan-box', materialRole: 'fieldstone', structuralUse: 'foundation-and-plinth',
    center: [Number.NaN, 0, 0], size: [1, 1, 1],
  }),
  /center must be finite/,
);
assert.throws(
  () => createProceduralPrismGeometry({
    semanticId: 'concave-prism', materialRole: 'lime-plaster', structuralUse: 'masonry-infill',
    center: [0, 0, 0], profile: [[0, 0], [2, 0], [1, 0.5], [2, 2], [0, 2]], depth: 1,
  }),
  /profile must be convex/,
);
assert.throws(
  () => createProceduralMemberGeometry({
    semanticId: 'zero-member', materialRole: 'rough-timber', structuralUse: 'timber-frame',
    start: [0, 0, 0], end: [0, 0, 0], width: 0.2, depth: 0.2,
  }),
  /length must be finite/,
);
assert.throws(
  () => createProceduralMemberGeometry({
    semanticId: 'illegal-member', materialRole: 'rough-timber', structuralUse: 'roof-covering',
    start: [0, 0, 0], end: [1, 0, 0], width: 0.2, depth: 0.2,
  }),
  /rough-timber prohibits structural use roof-covering/,
);
assert.throws(
  () => createProceduralRoofPanelGeometry({
    semanticId: 'skew-roof', materialRole: 'split-shingles', structuralUse: 'roof-covering',
    eaveOrigin: [0, 0, 0], eaveVector: [2, 0, 0], slopeVector: [1, 1, 0], thickness: 0.08,
  }),
  /eave and slope vectors must be perpendicular/,
);
assert.throws(
  () => createProceduralRoofTriangleGeometry({
    semanticId: 'skew-roof-triangle', materialRole: 'split-shingles', structuralUse: 'roof-covering',
    eaveOrigin: [0, 0, 0], eaveVector: [2, 0, 0], apexOffset: [1, 1, 0], thickness: 0.08,
  }),
  /eave and apex vectors must be perpendicular/,
);
assert.throws(
  () => new ProceduralGeometryWriter(['fieldstone']).addMember({
    semanticId: 'wrong-projection', materialRole: 'fieldstone', structuralUse: 'foundation-and-plinth',
    start: [0, 0, 0], end: [1, 0, 0], width: 0.2, depth: 0.2,
  }),
  /cannot emit course-aligned UVs/,
);

compatibilityRoot.clear();
for (const slot of result.slots) slot.geometry.dispose();

console.log(
  `procedural geometry writer passed (${result.diagnostics.primitiveCount} primitives, `
    + `${result.diagnostics.materialSlotCount} slots, ${result.diagnostics.triangleCount} triangles)`,
);

function materialSlot(
  compiled: ProceduralGeometryWriterResult,
  role: ProceduralMaterialRole,
): CompiledProceduralMaterialSlot {
  const slot = compiled.slots.find((candidate) => candidate.materialRole === role);
  assert.ok(slot, `missing ${role} material slot`);
  return slot;
}

function range(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, component: 0 | 1): number {
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < attribute.count; index += 1) {
    const value = component === 0 ? attribute.getX(index) : attribute.getY(index);
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  return maximum - minimum;
}

function assertClose(actual: number, expected: number, epsilon = 1e-6): void {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

function assertVectorClose(actual: readonly number[] | undefined, expected: readonly number[]): void {
  assert.ok(actual, 'expected a diagnostic vector');
  assert.equal(actual.length, expected.length);
  for (let index = 0; index < expected.length; index += 1) {
    assertClose(actual[index]!, expected[index]!);
  }
}

function assertSlotTopology(slot: CompiledProceduralMaterialSlot): void {
  const geometry = slot.geometry;
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv');
  const index = geometry.index;
  assert.ok(index, `${slot.materialRole} must be indexed`);
  assert.equal(position.count, normal.count);
  assert.equal(position.count, uv.count);
  assert.equal(index.count % 3, 0);
  assert.deepEqual(geometry.groups, [{ start: 0, count: index.count, materialIndex: 0 }]);
  assert.ok(geometry.boundingBox);
  assert.ok(geometry.boundingSphere);

  for (let vertex = 0; vertex < position.count; vertex += 1) {
    const values = [
      position.getX(vertex), position.getY(vertex), position.getZ(vertex),
      normal.getX(vertex), normal.getY(vertex), normal.getZ(vertex),
      uv.getX(vertex), uv.getY(vertex),
    ];
    assert.ok(values.every(Number.isFinite), `${slot.materialRole} vertex ${vertex} must be finite`);
    const normalLength = Math.hypot(normal.getX(vertex), normal.getY(vertex), normal.getZ(vertex));
    assert.ok(Math.abs(normalLength - 1) <= 1e-6, `${slot.materialRole} normal ${vertex} must be unit length`);
  }

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const faceNormal = new THREE.Vector3();
  const storedNormal = new THREE.Vector3();
  for (let triangle = 0; triangle < index.count; triangle += 3) {
    const ia = index.getX(triangle);
    const ib = index.getX(triangle + 1);
    const ic = index.getX(triangle + 2);
    assert.ok(ia < position.count && ib < position.count && ic < position.count);
    a.fromBufferAttribute(position, ia);
    b.fromBufferAttribute(position, ib);
    c.fromBufferAttribute(position, ic);
    faceNormal.crossVectors(b.clone().sub(a), c.clone().sub(a));
    assert.ok(faceNormal.length() > 1e-6, `${slot.materialRole} triangle ${triangle / 3} is degenerate`);
    faceNormal.normalize();
    storedNormal.fromBufferAttribute(normal, ia).normalize();
    assert.ok(
      faceNormal.dot(storedNormal) > 0.9999,
      `${slot.materialRole} triangle ${triangle / 3} winding disagrees with its normal`,
    );
  }
}
