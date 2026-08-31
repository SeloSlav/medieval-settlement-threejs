import assert from 'node:assert/strict';
import * as THREE from 'three';
import { shingleMaterial } from '../src/buildings/buildingMaterials.ts';
import {
  addHippedRoof,
  addLeanToRoof,
  type LeanToHighEdge,
} from '../src/buildings/meshes/buildingMeshKit.ts';

const highEdges: readonly LeanToHighEdge[] = [
  'negativeX',
  'positiveX',
  'negativeZ',
  'positiveZ',
];

for (const [index, highEdge] of highEdges.entries()) {
  const root = new THREE.Group();
  const center = new THREE.Vector3(index * 0.37 - 0.45, 2.8, index * -0.21 + 0.3);
  const roof = addLeanToRoof(root, {
    width: 4.8,
    depth: 2.6,
    thickness: 0.14,
    material: shingleMaterial(),
    position: center,
    pitch: 0.18,
    highEdge,
    name: `Lean-to regression ${highEdge}`,
  });
  const geometry = roof.geometry;
  geometry.computeBoundingBox();
  assert.equal(geometry.userData.proceduralGeometryWriter, 'semantic-physical-uv-v1');
  assert.equal(geometry.userData.proceduralMaterialRole, 'split-shingles');
  assert.equal(geometry.userData.metricUvMeters, 2.2);
  assert.equal(roof.userData.proceduralRoofAttachment, 'lean-to');
  assert.equal(roof.position.lengthSq(), 0, 'semantic roof should carry authored coordinates in its geometry');
  assert.equal((geometry.getIndex()?.count ?? 0) / 3, 12, 'lean-to should remain a closed twelve-triangle panel');

  const geometryCenter = geometry.boundingBox!.getCenter(new THREE.Vector3());
  assert.ok(geometryCenter.distanceTo(center) < 1e-5, `${highEdge} roof moved from its authored centre`);
  assertHighEdge(geometry.getAttribute('position'), highEdge);
}

const hippedRoot = new THREE.Group();
const hipped = addHippedRoof(hippedRoot, {
  width: 4.6,
  depth: 3.4,
  eaveY: 3.1,
  peakY: 5.2,
  thickness: 0.12,
  material: shingleMaterial(),
  centerX: 0.35,
  centerZ: -0.22,
  name: 'Hipped cap regression',
});
hipped.geometry.computeBoundingBox();
assert.equal(hipped.geometry.userData.proceduralGeometryWriter, 'semantic-physical-uv-v1');
assert.equal(hipped.userData.proceduralRoofAttachment, 'hipped-cap');
assert.equal(hipped.userData.proceduralPrimitiveCount, 4);
assert.equal((hipped.geometry.getIndex()?.count ?? 0) / 3, 32);
assert.ok(Math.abs(hipped.geometry.boundingBox!.max.y - 5.2) < 1e-5);
assert.ok(Math.abs(hipped.geometry.boundingBox!.min.x - (0.35 - 2.3)) < 1e-5);
assert.ok(Math.abs(hipped.geometry.boundingBox!.max.z - (-0.22 + 1.7)) < 1e-5);

console.log('procedural attached roofs passed (4 lean-to orientations + joined hipped cap)');

function assertHighEdge(
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  highEdge: LeanToHighEdge,
): void {
  const axis = highEdge.endsWith('X') ? 'x' : 'z';
  const negative = highEdge.startsWith('negative');
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < position.count; index += 1) {
    const value = axis === 'x' ? position.getX(index) : position.getZ(index);
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  const tolerance = 1e-5;
  let minimumTop = Number.NEGATIVE_INFINITY;
  let maximumTop = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < position.count; index += 1) {
    const value = axis === 'x' ? position.getX(index) : position.getZ(index);
    const y = position.getY(index);
    if (Math.abs(value - minimum) < tolerance) minimumTop = Math.max(minimumTop, y);
    if (Math.abs(value - maximum) < tolerance) maximumTop = Math.max(maximumTop, y);
  }
  const high = negative ? minimumTop : maximumTop;
  const low = negative ? maximumTop : minimumTop;
  assert.ok(high > low + 0.2, `${highEdge} roof drains toward its attachment instead of away from it`);
}
