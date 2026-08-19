import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  BatchedBuildingShadowProxies,
  setBuildingDetailShadowsEnabled,
} from '../src/buildings/buildingShadowProxy.ts';
import {
  BUILDING_DETAIL_CASTER_BATCH_FLAG,
  BUILDING_DETAIL_CASTER_BATCH_SOURCE_FLAG,
  getBuildingDetailCasterBatchStats,
  installBuildingDetailCasterBatches,
  refreshBuildingDetailCasterBatches,
} from '../src/buildings/buildingDetailShadowBatch.ts';
import { createFoundersCampMesh } from '../src/buildings/meshes/foundersCampMesh.ts';
import { markBuildingDetailShadowCaster } from '../src/buildings/buildingShadowProxy.ts';

const parent = new THREE.Group();
const batch = new BatchedBuildingShadowProxies(
  parent,
  'Shadow batch test',
  true,
);

for (let index = 0; index < 1_000; index += 1) {
  const marker = new THREE.Group();
  marker.position.set(index % 40 * 13, index % 5 * 0.08, Math.floor(index / 40) * 15);
  marker.rotation.y = index * 0.17;
  marker.scale.setScalar(0.94 + index % 7 * 0.01);
  assert.equal(
    batch.upsertResidence(
      `residence:${index}`,
      index % 3 === 0 ? 3 : index % 2 === 0 ? 2 : 1,
      marker,
    ),
    false,
  );
}

const townHall = new THREE.Group();
townHall.position.set(-20, 0.4, 16);
townHall.rotation.y = Math.PI * 0.25;
assert.equal(batch.upsertBuilding('building:town-hall', 'town_hall', townHall), false);

const quarry = new THREE.Group();
quarry.position.set(42, -0.6, -28);
assert.equal(batch.upsertBuilding('building:quarry', 'stone_quarry', quarry), false);

const reclamationPile = new THREE.Group();
reclamationPile.position.set(16, 0.1, 35);
assert.equal(
  batch.upsertBuilding('building:reclamation-pile', 'salvage_pile', reclamationPile),
  false,
  'reclamation props must not create a footprint-sized box shadow',
);

assert.equal(batch.flush(), false);
const stats = batch.getStats();
assert.deepEqual(stats, {
  proxies: 0,
  boxInstances: 0,
  cylinderInstances: 0,
  shadowDraws: 0,
});
assert.equal(
  batch.group.children.length,
  0,
  'retired coarse footprint shadows must submit no proxy geometry',
);

assert.equal(
  batch.upsertBuilding('building:town-hall', 'town_hall', townHall),
  false,
  'an unchanged transform must not dirty the GPU batch',
);
assert.equal(batch.flush(), false, 'an unchanged snapshot must not upload matrices again');

townHall.position.x += 3;
assert.equal(batch.upsertBuilding('building:town-hall', 'town_hall', townHall), false);
assert.equal(batch.flush(), false);
assert.deepEqual(batch.getStats(), stats);

assert.equal(batch.remove('building:quarry'), false);
assert.equal(batch.flush(), false);
assert.deepEqual(batch.getStats(), stats);

batch.dispose();
assert.equal(parent.children.length, 0);

const founders = createFoundersCampMesh();
const foundersStats = getBuildingDetailCasterBatchStats(founders);
assert.ok(foundersStats, 'founders camp must install its exact detail caster batches');
assert.equal(foundersStats.rejectedSources, 0);
assert.ok(foundersStats.sourceDraws >= 120, 'fixture must retain the dense authored camp');
assert.ok(
  foundersStats.batchDraws <= 20,
  `authored camp casters must collapse to at most 20 exact submissions (${foundersStats.batchDraws})`,
);
assert.equal(
  foundersStats.batchTriangles,
  foundersStats.sourceTriangles,
  'merged camp casters must submit every authored triangle exactly once',
);
assertVertexMoments(
  casterVertexMoments(founders, false),
  casterVertexMoments(founders, true),
  'merged camp casters must retain every authored transformed vertex',
);
assert.deepEqual(
  casterMaterialTriangles(founders, true),
  casterMaterialTriangles(founders, false),
  'merged camp casters must preserve exact material/shadow-state triangle buckets',
);

const originalBatchMeshes = detailBatchMeshes(founders);
const hiddenProbe = founders.getObjectByName('Weathered tent canvas shell');
assert.ok(hiddenProbe instanceof THREE.Mesh);
const hiddenProbeTriangles = geometryTriangles(hiddenProbe.geometry);
hiddenProbe.visible = false;
assert.equal(refreshBuildingDetailCasterBatches(founders), true);
const hiddenStats = getBuildingDetailCasterBatchStats(founders);
assert.ok(hiddenStats);
assert.equal(
  hiddenStats.sourceTriangles,
  foundersStats.sourceTriangles - hiddenProbeTriangles,
  'authored visibility must remove exactly the hidden caster triangles',
);
assert.equal(hiddenStats.batchTriangles, hiddenStats.sourceTriangles);
assert.deepEqual(detailBatchMeshes(founders), originalBatchMeshes);
hiddenProbe.visible = true;
assert.equal(refreshBuildingDetailCasterBatches(founders), true);
assert.deepEqual(getBuildingDetailCasterBatchStats(founders), foundersStats);

setBuildingDetailShadowsEnabled(founders, false);
assert.ok(detailBatchMeshes(founders).every((mesh) => mesh.castShadow === false));
assert.ok(detailBatchSources(founders).every((mesh) => mesh.castShadow === false));
setBuildingDetailShadowsEnabled(founders, true);
assert.ok(detailBatchMeshes(founders).every((mesh) => mesh.castShadow === true));
assert.ok(
  detailBatchSources(founders).every((mesh) => mesh.castShadow === false),
  'preference toggles must never re-enable duplicate authored submissions',
);

const rejectedRoot = new THREE.Group();
const grouped = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.MeshStandardMaterial(),
);
grouped.geometry.addGroup(0, grouped.geometry.index?.count ?? 6, 0);
markBuildingDetailShadowCaster(grouped);
const ranged = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.MeshStandardMaterial(),
);
ranged.geometry.setDrawRange(0, 3);
markBuildingDetailShadowCaster(ranged);
const callback = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.MeshStandardMaterial(),
);
callback.onBeforeShadow = () => {};
markBuildingDetailShadowCaster(callback);
const afterCallback = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.MeshStandardMaterial(),
);
afterCallback.onAfterShadow = () => {};
markBuildingDetailShadowCaster(afterCallback);
rejectedRoot.add(grouped, ranged, callback, afterCallback);
const rejectedStats = installBuildingDetailCasterBatches(
  rejectedRoot,
  'Rejected exact caster batch probes',
);
assert.deepEqual(rejectedStats, {
  sourceDraws: 1,
  batchDraws: 1,
  sourceTriangles: 2,
  batchTriangles: 2,
  rejectedSources: 3,
});
assert.ok(
  [ranged, callback, afterCallback].every((mesh) => mesh.castShadow),
  'partial draw ranges and custom shadow callbacks must remain unmodified casters',
);
assert.equal(grouped.castShadow, false, 'single-material grouped geometry is exactly batched');
const groupedBatch = detailBatchMeshes(rejectedRoot)[0];
assert.ok(groupedBatch);
assert.deepEqual(
  groupedBatch.geometry.groups,
  grouped.geometry.groups,
  'single-material group metadata must survive exact caster batching',
);

console.log(
  `Building shadow tests passed (${stats.proxies} coarse footprint proxies / ${stats.shadowDraws} draws; `
    + `${foundersStats.sourceDraws} founders detail draws -> ${foundersStats.batchDraws} exact draws / `
    + `${foundersStats.sourceTriangles} unchanged triangles).`,
);

function detailBatchMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && mesh.userData[BUILDING_DETAIL_CASTER_BATCH_FLAG] === true) {
      meshes.push(mesh);
    }
  });
  return meshes;
}

function detailBatchSources(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && mesh.userData[BUILDING_DETAIL_CASTER_BATCH_SOURCE_FLAG] === true) {
      meshes.push(mesh);
    }
  });
  return meshes;
}

function casterMaterialTriangles(
  root: THREE.Object3D,
  sources: boolean,
): Array<[string, number]> {
  const triangles = new Map<string, number>();
  root.traverseVisible((object) => {
    const mesh = object as THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
    const selected = sources
      ? mesh.userData[BUILDING_DETAIL_CASTER_BATCH_SOURCE_FLAG] === true
      : mesh.userData[BUILDING_DETAIL_CASTER_BATCH_FLAG] === true;
    if (!mesh.isMesh || !selected) return;
    const instances = (mesh as THREE.InstancedMesh).isInstancedMesh
      ? (mesh as THREE.InstancedMesh).count
      : 1;
    const key = [
      mesh.material.uuid,
      mesh.material.side,
      mesh.material.shadowSide ?? '',
      mesh.material.alphaTest,
      mesh.material.clippingPlanes?.length ?? 0,
      mesh.material.clipShadows ? 1 : 0,
      mesh.customDepthMaterial?.uuid ?? '',
      mesh.customDistanceMaterial?.uuid ?? '',
    ].join('|');
    triangles.set(
      key,
      (triangles.get(key) ?? 0) + geometryTriangles(mesh.geometry) * instances,
    );
  });
  return [...triangles.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function casterVertexMoments(root: THREE.Object3D, sources: boolean): number[] {
  root.updateWorldMatrix(true, true);
  const rootInverse = root.matrixWorld.clone().invert();
  const instance = new THREE.Matrix4();
  const relative = new THREE.Matrix4();
  const vertex = new THREE.Vector3();
  let count = 0;
  const sum = new THREE.Vector3();
  const sumSquares = new THREE.Vector3();
  const bounds = new THREE.Box3();
  root.traverseVisible((object) => {
    const mesh = object as THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
    const selected = sources
      ? mesh.userData[BUILDING_DETAIL_CASTER_BATCH_SOURCE_FLAG] === true
      : mesh.userData[BUILDING_DETAIL_CASTER_BATCH_FLAG] === true;
    if (!mesh.isMesh || !selected) return;
    const position = mesh.geometry.getAttribute('position');
    const instances = (mesh as THREE.InstancedMesh).isInstancedMesh
      ? (mesh as THREE.InstancedMesh).count
      : 1;
    for (let instanceIndex = 0; instanceIndex < instances; instanceIndex += 1) {
      if ((mesh as THREE.InstancedMesh).isInstancedMesh) {
        (mesh as THREE.InstancedMesh).getMatrixAt(instanceIndex, instance);
        relative
          .multiplyMatrices(mesh.matrixWorld, instance)
          .premultiply(rootInverse);
      } else {
        relative.multiplyMatrices(rootInverse, mesh.matrixWorld);
      }
      for (let index = 0; index < position.count; index += 1) {
        vertex.fromBufferAttribute(position, index).applyMatrix4(relative);
        count += 1;
        sum.add(vertex);
        sumSquares.x += vertex.x * vertex.x;
        sumSquares.y += vertex.y * vertex.y;
        sumSquares.z += vertex.z * vertex.z;
        bounds.expandByPoint(vertex);
      }
    }
  });
  return [
    count,
    ...sum.toArray(),
    ...sumSquares.toArray(),
    ...bounds.min.toArray(),
    ...bounds.max.toArray(),
  ];
}

function assertVertexMoments(
  actual: readonly number[],
  expected: readonly number[],
  message: string,
): void {
  assert.equal(actual.length, expected.length, message);
  assert.equal(actual[0], expected[0], `${message}: vertex count`);
  for (let index = 1; index < actual.length; index += 1) {
    const tolerance = Math.max(1e-4, Math.abs(expected[index]!) * 2e-7);
    assert.ok(
      Math.abs(actual[index]! - expected[index]!) <= tolerance,
      `${message}: moment ${index} differs (${actual[index]} vs ${expected[index]})`,
    );
  }
}

function geometryTriangles(geometry: THREE.BufferGeometry): number {
  return (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
}
