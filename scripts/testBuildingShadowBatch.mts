import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  BatchedBuildingShadowProxies,
  setBuildingDetailShadowsEnabled,
} from '../src/buildings/buildingShadowProxy.ts';
import {
  BUILDING_DETAIL_CASTER_BATCH_FLAG,
  getBuildingDetailCasterBatchStats,
  installBuildingDetailCasterBatches,
  refreshBuildingDetailCasterBatches,
} from '../src/buildings/buildingDetailShadowBatch.ts';
import {
  FOUNDERS_CAMP_MAJOR_SHADOW_CASTER_FLAG,
  FOUNDERS_CAMP_SHADOW_SOURCE_FLAG,
  getFoundersCampShadowCasterStats,
} from '../src/buildings/foundersCampShadowCasters.ts';
import {
  FOUNDERS_CAMP_COLOR_BATCH_FLAG,
  FOUNDERS_CAMP_COLOR_BATCH_SOURCE_FLAG,
  getFoundersCampColorBatchStats,
  refreshFoundersCampColorBatches,
} from '../src/buildings/foundersCampColorBatch.ts';
import { createFoundersCampMesh } from '../src/buildings/meshes/foundersCampMesh.ts';
import { markBuildingDetailShadowCaster } from '../src/buildings/buildingShadowProxy.ts';
import { batchCompletedBuildingStaticMeshes } from '../src/buildings/staticBuildingBatch.ts';
import { TREE_SHADOW_CAST_LAYER } from '../src/scene/SceneLayers.ts';

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
const foundersColorStats = getFoundersCampColorBatchStats(founders);
assert.ok(foundersColorStats, 'founders camp must install its local color batches');
assert.ok(
  foundersColorStats.sourceDraws >= 120,
  'the regression fixture must retain the original dense authored camp source set',
);
assert.ok(
  foundersColorStats.batchDraws + foundersColorStats.retainedDraws <= 25,
  `founders camp must stay within 25 visible color draws (got ${foundersColorStats.batchDraws + foundersColorStats.retainedDraws})`,
);
assert.equal(
  foundersColorStats.batchTriangles,
  foundersColorStats.sourceTriangles,
  'camp color batching must preserve every transformed source triangle',
);
assert.ok(
  foundersColorSources(founders).every((mesh) => !mesh.layers.isEnabled(0)),
  'batched camp sources must not remain duplicate color submissions',
);
assert.equal(
  foundersColorBatches(founders).length,
  foundersColorStats.batchDraws,
  'every visible camp color batch must be represented in its measured budget',
);
const foundersStats = getFoundersCampShadowCasterStats(founders);
assert.ok(foundersStats, 'founders camp must install its major-form shadow caster');
assert.equal(
  getBuildingDetailCasterBatchStats(founders),
  null,
  'the founders camp must not install material-preserving exact caster buckets',
);
assert.ok(foundersStats.authoredSourceDraws >= 1, 'fixture must retain authored color geometry');
assert.ok(
  foundersStats.authoredSourceTriangles > 1_000,
  'the coarse caster must replace a substantially denser authored color model',
);
assert.equal(foundersStats.tentCount, 3);
assert.equal(foundersStats.shadowDraws, 1, 'all three dominant tents must cast in one draw');
assert.equal(foundersStats.shadowTriangles, 24, 'coarse A-frame tents need only eight triangles each');
const foundersCasters = foundersShadowCasters(founders);
assert.equal(foundersCasters.length, 1);
const foundersCaster = foundersCasters[0]!;
assert.deepEqual(
  activeShadowCasters(founders),
  [foundersCaster],
  'the completed camp graph must contain exactly one active shadow submission',
);
assert.equal(foundersCaster.castShadow, true);
assert.equal(foundersCaster.receiveShadow, false);
assert.equal(foundersCaster.layers.isEnabled(TREE_SHADOW_CAST_LAYER), true);
assert.equal((foundersCaster.material as THREE.Material).side, THREE.DoubleSide);
assert.ok(
  foundersShadowSources(founders).every((mesh) => !mesh.castShadow),
  'fine authored color meshes must not remain duplicate shadow casters',
);
foundersCaster.geometry.computeBoundingBox();
assert.ok(
  (foundersCaster.geometry.boundingBox?.min.y ?? 0) >= 0.19,
  'major-form camp shadows must begin at the tent eaves rather than form a footprint slab',
);
const foundersCasterPositions = foundersCaster.geometry.getAttribute('position');
for (let tentIndex = 0; tentIndex < foundersStats.tentCount; tentIndex += 1) {
  const tentVertexOffset = tentIndex * 24;
  const repeatedFrontLeft = [0, 3, 12, 18, 21]
    .map((offset) => tuple3(foundersCasterPositions, tentVertexOffset + offset));
  assert.ok(
    repeatedFrontLeft.every((value) => value === repeatedFrontLeft[0]),
    'each coarse-tent corner must receive its authored transform exactly once',
  );
}

founders.position.set(37.25, 4.5, -19.75);
founders.rotation.y = Math.PI * 0.37;
const originalColorBatchGeometries = foundersColorBatches(founders)
  .map((mesh) => mesh.geometry);
assert.equal(
  refreshFoundersCampColorBatches(founders),
  false,
  'moving the whole camp must not rebuild camp-local color geometry',
);
assert.deepEqual(
  foundersColorBatches(founders).map((mesh) => mesh.geometry),
  originalColorBatchGeometries,
);
assert.equal(
  refreshBuildingDetailCasterBatches(founders),
  false,
  'moving the whole camp must not invoke the retired exact caster rebuild path',
);
assert.equal(getFoundersCampShadowCasterStats(founders), foundersStats);
const shelters = founders.getObjectByName('FoundingShelters');
assert.ok(shelters instanceof THREE.Group);
shelters.visible = false;
assert.equal(refreshFoundersCampColorBatches(founders), true);
assert.ok(
  (getFoundersCampColorBatchStats(founders)?.sourceTriangles ?? Infinity)
    < foundersColorStats.sourceTriangles,
  'packing up the shelters must remove their geometry from the color batches',
);
assert.equal(visibleFoundersShadowCasters(founders).length, 0);
shelters.visible = true;
assert.equal(refreshFoundersCampColorBatches(founders), true);
assert.deepEqual(getFoundersCampColorBatchStats(founders), foundersColorStats);
assert.equal(visibleFoundersShadowCasters(founders).length, 1);

setBuildingDetailShadowsEnabled(founders, false);
assert.equal(foundersCaster.castShadow, false);
setBuildingDetailShadowsEnabled(founders, true);
assert.equal(foundersCaster.castShadow, true);
assert.ok(
  foundersShadowSources(founders).every((mesh) => mesh.castShadow === false),
  'preference toggles must never re-enable duplicate authored submissions',
);
batchCompletedBuildingStaticMeshes(founders);
assert.equal(
  foundersShadowCasters(founders).filter((mesh) => mesh.castShadow).length,
  1,
  'completed-building color batching must preserve exactly one camp shadow submission',
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
rejectedRoot.position.set(-18.5, 3.25, 41.75);
rejectedRoot.rotation.y = Math.PI * 0.43;
assert.equal(
  refreshBuildingDetailCasterBatches(rejectedRoot),
  false,
  'moving a completed building must not rebuild root-relative shadow geometry',
);
assert.equal(detailBatchMeshes(rejectedRoot)[0], groupedBatch);

console.log(
  `Building shadow tests passed (${stats.proxies} coarse footprint proxies / ${stats.shadowDraws} draws; `
    + `${foundersColorStats.sourceDraws + foundersColorStats.retainedDraws} -> `
    + `${foundersColorStats.batchDraws + foundersColorStats.retainedDraws} founders color draws; `
    + `${foundersStats.authoredSourceDraws} founders detail draws -> `
    + `${foundersStats.shadowDraws} major-form draw / ${foundersStats.shadowTriangles} triangles).`,
);

function foundersShadowCasters(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && mesh.userData[FOUNDERS_CAMP_MAJOR_SHADOW_CASTER_FLAG] === true) {
      meshes.push(mesh);
    }
  });
  return meshes;
}

function tuple3(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, index: number): string {
  return `${attribute.getX(index)}|${attribute.getY(index)}|${attribute.getZ(index)}`;
}

function foundersColorSources(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && mesh.userData[FOUNDERS_CAMP_COLOR_BATCH_SOURCE_FLAG] === true) {
      meshes.push(mesh);
    }
  });
  return meshes;
}

function foundersColorBatches(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverseVisible((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && mesh.userData[FOUNDERS_CAMP_COLOR_BATCH_FLAG] === true) {
      meshes.push(mesh);
    }
  });
  return meshes;
}

function visibleFoundersShadowCasters(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverseVisible((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && mesh.userData[FOUNDERS_CAMP_MAJOR_SHADOW_CASTER_FLAG] === true) {
      meshes.push(mesh);
    }
  });
  return meshes;
}

function foundersShadowSources(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && mesh.userData[FOUNDERS_CAMP_SHADOW_SOURCE_FLAG] === true) {
      meshes.push(mesh);
    }
  });
  return meshes;
}

function activeShadowCasters(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverseVisible((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && mesh.castShadow) meshes.push(mesh);
  });
  return meshes;
}

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
