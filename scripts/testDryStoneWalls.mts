import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RoadNetwork } from '../src/roads/RoadNetwork.ts';
import {
  createDryStoneWallPlan,
  type DryStoneWallState,
} from '../src/decorations/DryStoneWall.ts';
import {
  alignSecondWallAnchorParallel,
  findDryStoneWallRoadSnap,
} from '../src/decorations/DryStoneWallRoadSnap.ts';
import { createChippedStoneGeometry } from '../src/decorations/DryStoneWallRenderer.ts';
import { createDryStoneWallMaterials } from '../src/decorations/DryStoneWallMaterial.ts';

const flatTerrain = {
  getHeightAt: (x: number, z: number) => Math.sin(x * 0.03) * 0.08 + Math.cos(z * 0.04) * 0.04,
};

const roadNetwork = new RoadNetwork();
const roadIds = roadNetwork.addRoadPath([
  new THREE.Vector3(-18, 0, 0),
  new THREE.Vector3(0, 0.1, 0),
  new THREE.Vector3(22, 0.2, 0),
]);
assert.equal(roadIds.length, 1, 'fixture road should be created');

const roadside = findDryStoneWallRoadSnap(
  roadNetwork,
  flatTerrain,
  new THREE.Vector3(4, 0, 3.1),
);
assert.ok(roadside, 'wall start should snap beside an existing road');
assert.ok(Math.abs(roadside.point.z - 2.18) < 0.08, 'snap should land on the visual road shoulder');
assert.ok(Math.abs(roadside.tangent.x) > 0.99, 'snap should expose the road-parallel tangent');

const parallel = alignSecondWallAnchorParallel(
  roadside.point,
  roadside.tangent,
  new THREE.Vector3(11, 0, 8),
  flatTerrain,
);
assert.ok(Math.abs(parallel.z - roadside.point.z) < 1e-6, 'free second point should lock parallel to the start road');

const wallId = roadNetwork.addDryStoneWallPath([
  roadside.point,
  parallel,
  new THREE.Vector3(17, flatTerrain.getHeightAt(17, 4.3), 4.3),
]);
assert.ok(wallId, 'valid wall path should commit instantly');
const snapshot = roadNetwork.snapshot();
assert.equal(snapshot.dryStoneWalls?.length, 1, 'wall should serialize with the road snapshot');

const restored = new RoadNetwork();
restored.restore(structuredClone(snapshot));
assert.equal(restored.dryStoneWalls.size, 1, 'wall should survive authoritative hydration');
assert.equal(restored.snapshot().dryStoneWalls?.[0]?.seed, snapshot.dryStoneWalls?.[0]?.seed, 'wall seed should remain stable');

const wall = restored.dryStoneWalls.get(wallId!) as DryStoneWallState;
const firstPlan = createDryStoneWallPlan(wall, flatTerrain, 'final');
const secondPlan = createDryStoneWallPlan(wall, flatTerrain, 'final');
assert.deepEqual(firstPlan, secondPlan, 'identical state and seed should reproduce the exact stone plan');
assert.ok(firstPlan.diagnostics.courseCounts[0] >= 7, 'lower course should contain a continuous stone walk');
assert.ok(firstPlan.diagnostics.courseCounts[1] >= 8, 'upper course should contain an independently staggered walk');
assert.ok(firstPlan.diagnostics.mossStoneCount > 0, 'final quality should include restrained upward moss');
assert.ok(firstPlan.diagnostics.minimumStoneWidth >= 0.52, 'no sliver stones should be emitted');
assert.ok(firstPlan.diagnostics.maximumStoneWidth <= 1.82, 'stone scale should remain human and reference-like');
assert.ok(new Set(firstPlan.stones.map((stone) => stone.variant)).size >= 6, 'a wall should exercise multiple chipped silhouettes');

const lowerCenters = firstPlan.stones.filter((stone) => stone.course === 0).map((stone) => stone.x);
const upperCenters = firstPlan.stones.filter((stone) => stone.course === 1).map((stone) => stone.x);
const averageNearestJointOffset = upperCenters.reduce((sum, center) => (
  sum + Math.min(...lowerCenters.map((lower) => Math.abs(lower - center)))
), 0) / Math.max(1, upperCenters.length);
assert.ok(averageNearestJointOffset > 0.12, 'independent row walks should visibly stagger vertical joints');

for (let variant = 0; variant < 12; variant += 1) {
  const geometry = createChippedStoneGeometry(variant);
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  assert.equal(positions.count / 3, 64, 'each chipped variant should preserve the authored 64-triangle budget');
  assert.ok(geometry.boundingBox && geometry.boundingSphere, 'stone geometry should publish valid bounds');
  for (let index = 0; index < positions.count; index += 1) {
    assert.ok(Number.isFinite(positions.getX(index)), 'stone geometry cannot contain NaN vertices');
    assert.ok(Number.isFinite(positions.getY(index)), 'stone geometry cannot contain NaN vertices');
    assert.ok(Number.isFinite(positions.getZ(index)), 'stone geometry cannot contain NaN vertices');
  }
  geometry.dispose();
}

const materials = createDryStoneWallMaterials();
assert.equal(materials.stone.map?.name, 'Dry-stone limestone albedo');
assert.equal(materials.stone.normalMap?.name, 'Dry-stone limestone OpenGL normal');
assert.equal(materials.stone.roughnessMap?.name, 'Dry-stone limestone roughness');
assert.notEqual(materials.stone.map, materials.moss.map, 'stone and moss must own distinct PBR texture identities');
assert.equal(materials.stone.metalness, 0, 'limestone must remain dielectric');
materials.dispose();

console.log(JSON.stringify({
  wallId,
  seed: wall.seed,
  length: Number(firstPlan.pathLength.toFixed(2)),
  courses: firstPlan.diagnostics.courseCounts,
  stones: firstPlan.stones.length,
  variantsUsed: new Set(firstPlan.stones.map((stone) => stone.variant)).size,
  mossStones: firstPlan.diagnostics.mossStoneCount,
  averageNearestJointOffset: Number(averageNearestJointOffset.toFixed(3)),
  geometryTrianglesPerStone: 64,
  materialTextureOwnership: materials.stone.userData.dryStoneWallSurface?.textureOwnership,
}, null, 2));
