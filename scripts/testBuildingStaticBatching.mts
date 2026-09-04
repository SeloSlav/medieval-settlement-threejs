import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BUILDING_KINDS } from '../src/generated/gameBalance.ts';
import { createBuildingMesh } from '../src/buildings/BuildingMeshes.ts';
import {
  batchCompletedBuildingStaticMeshes,
  isDynamicBuildingBatchBoundary,
} from '../src/buildings/staticBuildingBatch.ts';
import { BuildingStaticBatches } from '../src/buildings/BuildingStaticBatches.ts';
import {
  FOUNDERS_CAMP_COLOR_BATCH_SOURCE_FLAG,
  getFoundersCampColorBatchStats,
  refreshFoundersCampColorBatches,
} from '../src/buildings/foundersCampColorBatch.ts';

type RenderSnapshot = {
  readonly draws: number;
  readonly colorDraws: number;
  readonly triangles: number;
  readonly materials: readonly string[];
  readonly buckets: readonly [string, number][];
  readonly bounds: readonly number[];
  readonly geometryBytes: number;
  readonly colorGeometryBytes: number;
  readonly uvFingerprint: readonly string[];
  readonly normalFingerprint: readonly string[];
  readonly tangentFingerprint: readonly string[];
};

const foundersCampColor = testFoundersCampColorBatching();
const perKind: string[] = [];
for (const [kindIndex, kind] of BUILDING_KINDS.entries()) {
  const root = createBuildingMesh(kind);
  root.position.set(kindIndex * 0.17, kindIndex * 0.01, -kindIndex * 0.11);
  root.rotation.set(0.03, kindIndex * 0.013, -0.02);
  root.scale.set(0.97, 1.03, 1.01);
  const dynamicObjects = collectDynamicObjects(root);
  const before = renderSnapshot(root);
  const stats = batchCompletedBuildingStaticMeshes(root);
  const after = renderSnapshot(root);

  assert.equal(after.triangles, before.triangles, `${kind}: visible triangle parity`);
  assert.deepEqual(after.materials, before.materials, `${kind}: material identity parity`);
  assert.deepEqual(after.buckets, before.buckets, `${kind}: material/shadow bucket parity`);
  assertBoundsEqual(after.bounds, before.bounds, `${kind}: visible world bounds`);
  assert.deepEqual(after.uvFingerprint, before.uvFingerprint, `${kind}: UV parity`);
  assertDirectionFingerprintsEqual(
    after.normalFingerprint,
    before.normalFingerprint,
    `${kind}: world-normal parity`,
  );
  assert.deepEqual(
    after.tangentFingerprint,
    before.tangentFingerprint,
    `${kind}: world-tangent parity`,
  );
  assert.ok(
    after.geometryBytes <= before.geometryBytes,
    `${kind}: indexed batching must not inflate live geometry bytes (${before.geometryBytes} -> ${after.geometryBytes})`,
  );
  assert.equal(
    after.draws,
    before.draws - stats.sourceDraws + stats.batchedDraws,
    `${kind}: each merged source set must become exactly one submission`,
  );
  for (const dynamic of dynamicObjects) {
    assert.ok(
      root.getObjectByProperty('uuid', dynamic.object.uuid) === dynamic.object,
      `${kind}: dynamic object ${dynamic.object.name || dynamic.object.type} must stay attached`,
    );
    assert.equal(dynamic.object.visible, dynamic.visible, `${kind}: dynamic visibility parity`);
    assert.deepEqual(
      dynamic.object.matrix.toArray(),
      dynamic.localMatrix,
      `${kind}: dynamic local-transform parity`,
    );
  }
  assert.ok(after.draws <= before.draws, `${kind}: batching must never add submissions`);
  perKind.push(`${kind}:${before.draws}->${after.draws}`);
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose();
  });
}

const denseKinds = [
  'mine',
  'monastery',
  'chapel',
  'founders_camp',
  'threshing_barn',
  'marketplace',
  'large_quarry',
  'village_storehouse',
  'pastoral_farmstead',
  'lumber_mill',
  'guardhouse',
  'weaver',
  'potter_kiln',
  'carpenter',
  'apiary',
  'watermill',
  'stone_quarry',
  'smokehouse',
] as const;
// This representative fixture deliberately includes the one-per-settlement
// monastery and founders' camp, plus the animated watermill wheel; their
// seasonal/sway/visibility children must remain independently addressable.
// Exact caster batches live only on the shadow layer and remain refreshable
// runtime boundaries, so the end-to-end relative gate measures the color layer.
// A second relative gate audits eligible local-to-cross static fragmentation;
// the total ceiling still covers color plus shadow objects.
const DENSE_COLOR_RENDER_OBJECT_BUDGET = 418;
const DENSE_TOTAL_RENDER_OBJECT_BUDGET = 438;
const denseRoot = new THREE.Group();
const denseCrossBatches = new BuildingStaticBatches(denseRoot);
let denseBeforeDraws = 0;
let denseBeforeColorDraws = 0;
let denseLocalDraws = 0;
let denseLocalColorDraws = 0;
let denseLocalStaticDraws = 0;
let denseBeforeBytes = 0;
for (const [index, kind] of denseKinds.entries()) {
  const building = createBuildingMesh(kind);
  building.position.set((index % 5) * 26, 0, Math.floor(index / 5) * 26);
  building.rotation.y = (index % 4) * Math.PI * 0.125;
  denseRoot.add(building);
  const before = renderSnapshot(building);
  denseBeforeDraws += before.draws;
  denseBeforeColorDraws += before.colorDraws;
  denseBeforeBytes += before.geometryBytes;
  const localStats = batchCompletedBuildingStaticMeshes(building);
  denseLocalStaticDraws += localStats.batchedDraws;
  const local = renderSnapshot(building);
  denseLocalDraws += local.draws;
  denseLocalColorDraws += local.colorDraws;
  denseCrossBatches.registerBuilding(`dense-${index}`, building);
  denseCrossBatches.updateBuilding(`dense-${index}`, building, true);
}
denseCrossBatches.finalizeGeometryBuffers();
const denseAfter = renderSnapshot(denseRoot);
const denseStats = denseCrossBatches.getStats();
const denseNativeColorDraws = denseAfter.colorDraws
  - denseStats.renderObjects
  + denseStats.nativeDrawCommands;
assert.ok(
  denseBeforeColorDraws >= 1_200,
  `dense actual-building fixture must retain the reviewed color load (got ${denseBeforeColorDraws})`,
);
assert.ok(
  denseAfter.colorDraws <= DENSE_COLOR_RENDER_OBJECT_BUDGET,
  `${denseKinds.length} dense completed buildings must stay at or below ${DENSE_COLOR_RENDER_OBJECT_BUDGET} color submissions (got ${denseAfter.colorDraws})`,
);
assert.ok(
  denseAfter.draws <= DENSE_TOTAL_RENDER_OBJECT_BUDGET,
  `${denseKinds.length} dense completed buildings must stay at or below ${DENSE_TOTAL_RENDER_OBJECT_BUDGET} color-plus-shadow render objects (got ${denseAfter.draws})`,
);
assert.ok(
  denseAfter.colorDraws <= denseBeforeColorDraws * 0.2,
  `dense batching must remove at least 80% of color submissions (${denseBeforeColorDraws} -> ${denseAfter.colorDraws})`,
);
assert.ok(
  denseStats.renderObjects <= denseLocalStaticDraws * 0.2,
  `cross-building packing must remove at least 80% of eligible local static render objects (${denseLocalStaticDraws} -> ${denseStats.renderObjects})`,
);
assert.ok(
  denseAfter.draws - denseAfter.colorDraws
    <= denseBeforeDraws - denseBeforeColorDraws,
  'static batching must not add refreshable shadow-only render objects',
);
assert.ok(
  denseAfter.geometryBytes <= denseBeforeBytes + 840,
  `cross-building packing must not inflate live geometry bytes (${denseBeforeBytes} -> ${denseAfter.geometryBytes})`,
);
assert.ok(
  denseStats.instances > denseStats.renderObjects,
  'cross-building traversal batches must pack multiple instances',
);
assert.ok(
  denseNativeColorDraws <= denseLocalColorDraws,
  `cross-building packing must not add color WebGPU draw commands (${denseLocalColorDraws} -> ${denseNativeColorDraws})`,
);
testDetachedGeometryDisposal();
denseCrossBatches.dispose();
denseRoot.traverse((object) => {
  const mesh = object as THREE.Mesh;
  mesh.geometry?.dispose();
});

const repeated = testRepeatedBuildingCrossBatches();

console.log(
  'building static batching passed '
    + `(founders-camp color ${foundersCampColor.authoredDraws}->${foundersCampColor.batchedDraws}, `
    + `${foundersCampColor.sourceTriangles} exact triangles; `
    + `(${denseBeforeColorDraws} -> ${denseAfter.colorDraws} dense-${denseKinds.length} color render objects; `
    + `${denseBeforeDraws} -> ${denseAfter.draws} including shadow-only; `
    + `${denseLocalStaticDraws} -> ${denseStats.renderObjects} eligible local-to-cross static objects; `
    + `${denseLocalColorDraws} -> ${denseNativeColorDraws} dense-${denseKinds.length} color WebGPU draw commands `
    + `(${denseLocalDraws} local objects including shadow-only); `
    + `${denseBeforeBytes} -> ${denseAfter.geometryBytes} geometry bytes; `
    + `${denseAfter.triangles} visible triangles; `
    + `${denseStats.instances} instances / ${denseStats.renderObjects} render objects; `
    + `${repeated.drawsBefore} -> ${repeated.drawsAfter} repeated-100 color render objects, `
    + `(${repeated.totalDrawsBefore} -> ${repeated.totalDrawsAfter} including shadow-only), `
    + `${repeated.nativeDraws} WebGPU draw commands; `
    + `${repeated.bytesBefore} -> ${repeated.bytesAfter} color geometry bytes `
    + `(${repeated.totalBytesBefore} -> ${repeated.totalBytesAfter} whole-scene); `
    + `(${repeated.packedBytes} packed / ${repeated.uniqueGeometries} unique); `
    + `${repeated.registrationMs.toFixed(1)}ms registration + `
    + `${repeated.compactionMs.toFixed(1)}ms compaction; ${perKind.join(', ')})`,
);

function testFoundersCampColorBatching(): {
  authoredDraws: number;
  batchedDraws: number;
  sourceTriangles: number;
} {
  const camp = createBuildingMesh('founders_camp');
  const stats = getFoundersCampColorBatchStats(camp);
  assert.ok(stats, 'founders camp must install its color batches during generation');

  const batchGroup = camp.getObjectByName('Founders camp color batches');
  assert.ok(batchGroup instanceof THREE.Group, 'founders camp must expose its color batch group');
  const sourceMeshes: THREE.Mesh[] = [];
  camp.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.userData[FOUNDERS_CAMP_COLOR_BATCH_SOURCE_FLAG] === true) {
      assert.ok(mesh.isMesh, 'every founders-camp color source must remain a mesh');
      sourceMeshes.push(mesh);
    }
  });
  assert.ok(sourceMeshes.length >= stats.sourceDraws, 'hidden runtime sources must remain attached');

  const sourceLayerMasks = sourceMeshes.map((source) => source.layers.mask);
  for (const source of sourceMeshes) source.layers.enable(0);
  batchGroup.visible = false;
  const authored = renderSnapshot(camp);
  for (let index = 0; index < sourceMeshes.length; index += 1) {
    sourceMeshes[index]!.layers.mask = sourceLayerMasks[index]!;
  }
  batchGroup.visible = true;
  const batched = renderSnapshot(camp);

  const sparkBatch = camp.getObjectByName('Animated fire spark');
  assert.ok(
    sparkBatch instanceof THREE.InstancedMesh,
    'founders-camp sparks must share one instanced draw',
  );
  assert.equal(sparkBatch.count, 7, 'founders-camp spark population changed');
  assert.ok(
    authored.colorDraws >= 124,
    `founders-camp fixture must retain its reviewed authored load (got ${authored.colorDraws})`,
  );
  assert.equal(
    authored.colorDraws,
    stats.sourceDraws + stats.retainedDraws,
    'founders-camp source stats must account for every authored color submission',
  );
  assert.equal(
    batched.colorDraws,
    stats.batchDraws + stats.retainedDraws,
    'founders-camp batch stats must account for every submitted color object',
  );
  assert.ok(
    batched.colorDraws <= 25,
    `founders-camp first placement must stay at or below 25 color submissions (got ${batched.colorDraws})`,
  );
  assert.equal(stats.batchTriangles, stats.sourceTriangles, 'founders-camp color triangle parity');
  assert.equal(batched.triangles, authored.triangles, 'founders-camp whole-graph triangle parity');
  assert.deepEqual(batched.materials, authored.materials, 'founders-camp material identity parity');
  assert.deepEqual(batched.buckets, authored.buckets, 'founders-camp material/pipeline bucket parity');
  assertBoundsEqual(batched.bounds, authored.bounds, 'founders-camp visible world bounds');
  assert.deepEqual(batched.uvFingerprint, authored.uvFingerprint, 'founders-camp UV parity');
  assertDirectionFingerprintsEqual(
    batched.normalFingerprint,
    authored.normalFingerprint,
    'founders-camp world-normal parity',
  );
  assert.deepEqual(
    batched.tangentFingerprint,
    authored.tangentFingerprint,
    'founders-camp world-tangent parity',
  );

  const requiredRuntimeNames = [
    'FoundingShelters',
    'FoundingCampfire',
    'FoundingTimberStockpile',
    'FoundingStoneStockpile',
    'FoundingIronworkStockpile',
    'FoundingTreasuryChest',
    'Planted camp standard anchor',
    'Founders camp winter accumulation',
  ] as const;
  const runtimeObjects = requiredRuntimeNames.map((name) => {
    const object = camp.getObjectByName(name);
    assert.ok(object, `founders-camp runtime subtree must remain addressable: ${name}`);
    return object;
  });

  camp.position.set(317.25, -0.4, -184.75);
  camp.rotation.set(0.015, 1.137, -0.025);
  camp.scale.set(0.992, 0.947, 0.989);
  camp.updateMatrix();
  assert.equal(
    refreshFoundersCampColorBatches(camp),
    false,
    'adopting or moving a prewarmed founders camp must not rebuild local color geometry',
  );

  const shelters = camp.getObjectByName('FoundingShelters')!;
  shelters.visible = false;
  assert.equal(refreshFoundersCampColorBatches(camp), true, 'shelter teardown must refresh batches');
  const hiddenShelterStats = getFoundersCampColorBatchStats(camp)!;
  assert.ok(
    hiddenShelterStats.sourceTriangles < stats.sourceTriangles,
    'shelter teardown must remove its geometry from the submitted color batches',
  );
  assert.equal(
    hiddenShelterStats.batchTriangles,
    hiddenShelterStats.sourceTriangles,
    'shelter teardown must retain exact triangle parity',
  );
  shelters.visible = true;
  assert.equal(refreshFoundersCampColorBatches(camp), true, 'shelter restoration must refresh batches');
  assert.deepEqual(
    getFoundersCampColorBatchStats(camp),
    stats,
    'restoring shelters must recover the exact original submission contract',
  );

  const collisionBounds = aggregateBuildingBounds(camp);
  batchCompletedBuildingStaticMeshes(camp);
  assertBoundsEqual(
    aggregateBuildingBounds(camp),
    collisionBounds,
    'founders-camp local batching must preserve its first-person collision bounds',
  );
  for (const runtimeObject of runtimeObjects) {
    assert.equal(
      camp.getObjectByProperty('uuid', runtimeObject.uuid),
      runtimeObject,
      `founders-camp runtime subtree must survive completed batching: ${runtimeObject.name}`,
    );
  }
  for (const source of sourceMeshes) {
    assert.equal(
      camp.getObjectByProperty('uuid', source.uuid),
      source,
      `founders-camp authored collision source must survive completed batching: ${source.name}`,
    );
  }

  disposeGeometry(camp);
  return {
    authoredDraws: authored.colorDraws,
    batchedDraws: batched.colorDraws,
    sourceTriangles: stats.sourceTriangles,
  };
}

function testRepeatedBuildingCrossBatches(): {
  drawsBefore: number;
  drawsAfter: number;
  totalDrawsBefore: number;
  totalDrawsAfter: number;
  nativeDraws: number;
  bytesBefore: number;
  bytesAfter: number;
  totalBytesBefore: number;
  totalBytesAfter: number;
  packedBytes: number;
  uniqueGeometries: number;
  registrationMs: number;
  compactionMs: number;
} {
  const root = new THREE.Group();
  const batches = new BuildingStaticBatches(root);
  // The server permits only one monastery per settlement. A repeated-instance
  // stress fixture must use buildings that can actually coexist, otherwise
  // dozens of intentionally dynamic monastery herb gardens dominate the
  // result and measure an impossible world rather than cross-building reuse.
  const kinds = ['chapel', 'mine', 'threshing_barn'] as const;
  const buildings: THREE.Group[] = [];
  let drawsBefore = 0;
  let totalDrawsBefore = 0;
  let bytesBefore = 0;
  let totalBytesBefore = 0;
  let probeContract: StaticSourceContract[] | null = null;
  let probeCollider: number[] | null = null;
  let registrationMs = 0;
  for (let index = 0; index < 100; index += 1) {
    const building = createBuildingMesh(kinds[index % kinds.length]!);
    building.position.set((index % 10) * 18.5, (index % 2) * 0.03, Math.floor(index / 10) * 21);
    building.rotation.set(0, (index % 8) * Math.PI * 0.0625, 0);
    building.scale.set(1, 1, 1);
    root.add(building);
    const raw = renderSnapshot(building);
    drawsBefore += raw.colorDraws;
    totalDrawsBefore += raw.draws;
    bytesBefore += raw.colorGeometryBytes;
    totalBytesBefore += raw.geometryBytes;
    batchCompletedBuildingStaticMeshes(building);
    if (index === 0) {
      probeContract = staticSourceContracts(building);
      probeCollider = aggregateBuildingBounds(building);
    }
    const registrationStartedAt = performance.now();
    batches.registerBuilding(`repeated-${index}`, building);
    registrationMs += performance.now() - registrationStartedAt;
    batches.updateBuilding(`repeated-${index}`, building, true);
    buildings.push(building);
  }
  assert.ok(probeContract && probeCollider, 'repeated fixture must retain parity probes');
  assertPackedContract(batches, 'repeated-0', buildings[0]!, probeContract);
  assertBoundsEqual(
    aggregateBuildingBounds(buildings[0]!),
    probeCollider,
    'cross-building first-person aggregate collider',
  );

  const tracked = buildings[0]!;
  tracked.position.set(27.125, -0.25, 48.875);
  tracked.rotation.set(0.015, 1.137, -0.025);
  tracked.scale.set(0.992, 0.947, 0.989);
  batches.updateBuilding('repeated-0', tracked, false);
  assertBuildingBatchState(batches, 'repeated-0', tracked, false);
  batches.updateBuilding('repeated-0', tracked, true);
  assertBuildingBatchState(batches, 'repeated-0', tracked, true);
  const textureVersions = buildingMatrixTextureVersions(batches);
  batches.updateBuilding('repeated-0', tracked, true);
  assert.deepEqual(
    buildingMatrixTextureVersions(batches),
    textureVersions,
    'an identical building update must not dirty any batch matrix texture',
  );

  const compactionStartedAt = performance.now();
  batches.finalizeGeometryBuffers();
  const compactionMs = performance.now() - compactionStartedAt;
  const after = renderSnapshot(root);
  const stats = batches.getStats();
  const nativeDraws = after.colorDraws
    - stats.renderObjects
    + stats.nativeDrawCommands;
  assert.ok(drawsBefore >= 6_000, `repeated fixture must retain dense authored load (${drawsBefore})`);
  assert.ok(
    after.colorDraws <= 350,
    `100 repeated completed buildings must stay at or below 350 color render objects (${after.colorDraws})`,
  );
  assert.ok(
    after.colorDraws <= drawsBefore * 0.03,
    `repeated cross batching must remove at least 97% of color render objects (${drawsBefore} -> ${after.colorDraws})`,
  );
  assert.ok(
    after.draws - after.colorDraws <= totalDrawsBefore - drawsBefore,
    'repeated static batching must not add refreshable shadow-only render objects',
  );
  assert.ok(
    nativeDraws <= 100,
    `identical-geometry instancing must stay at or below 100 WebGPU draw commands (${nativeDraws})`,
  );
  assert.ok(
    nativeDraws <= drawsBefore * 0.05,
    `repeated instancing must remove at least 95% of WebGPU draw commands (${drawsBefore} -> ${nativeDraws})`,
  );
  assert.ok(
    after.colorGeometryBytes <= bytesBefore * 0.35,
    `content-verified reuse must remove at least 65% of color geometry bytes (${bytesBefore} -> ${after.colorGeometryBytes}; packed=${stats.geometryBytes}, unique=${stats.uniqueGeometries})`,
  );
  assert.ok(
    after.geometryBytes <= totalBytesBefore + 840,
    `repeated packing must not inflate whole-scene geometry bytes (${totalBytesBefore} -> ${after.geometryBytes})`,
  );
  assert.ok(
    stats.instances >= stats.uniqueGeometries * 4,
    `repeated geometries must be shared across instances (${stats.instances}/${stats.uniqueGeometries})`,
  );
  const proxyGeometries = new Set<THREE.BufferGeometry>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.userData.buildingStaticCollisionProxy === true) {
      proxyGeometries.add(mesh.geometry);
    }
  });
  assert.equal(proxyGeometries.size, 1, 'all building collision proxies must share one unit box');

  const uniqueBeforeRemoval = stats.uniqueGeometries;
  const sharedProbe = sharedGeometryProbe(batches, 'repeated-0');
  batches.removeBuilding('repeated-0');
  const afterRemoval = batches.getStats();
  assert.ok(afterRemoval.instances < stats.instances, 'removal must delete every building instance');
  assert.ok(
    afterRemoval.uniqueGeometries <= uniqueBeforeRemoval,
    'removal must never add packed geometry',
  );
  assert.equal(
    sharedProbe.shared.references,
    sharedProbe.references - 1,
    'removing one repeated building must decrement its shared geometry refcount once',
  );
  assert.ok(sharedProbe.shared.references > 0, 'shared geometry must remain while other buildings use it');
  batches.dispose();
  for (const building of buildings) disposeGeometry(building);
  return {
    drawsBefore,
    drawsAfter: after.colorDraws,
    totalDrawsBefore,
    totalDrawsAfter: after.draws,
    nativeDraws,
    bytesBefore,
    bytesAfter: after.colorGeometryBytes,
    totalBytesBefore,
    totalBytesAfter: after.geometryBytes,
    packedBytes: stats.geometryBytes,
    uniqueGeometries: stats.uniqueGeometries,
    registrationMs,
    compactionMs,
  };
}

function collectDynamicObjects(root: THREE.Object3D): Array<{
  object: THREE.Object3D;
  visible: boolean;
  localMatrix: number[];
}> {
  const dynamic: Array<{
    object: THREE.Object3D;
    visible: boolean;
    localMatrix: number[];
  }> = [];
  const visit = (object: THREE.Object3D, hiddenByAncestor: boolean): void => {
    const hidden = hiddenByAncestor || !object.visible;
    if (hidden || isDynamicBuildingBatchBoundary(object)) {
      object.updateMatrix();
      dynamic.push({
        object,
        visible: object.visible,
        localMatrix: object.matrix.toArray(),
      });
    }
    for (const child of object.children) visit(child, hidden);
  };
  for (const child of root.children) visit(child, false);
  return dynamic;
}

function renderSnapshot(root: THREE.Object3D): RenderSnapshot {
  root.updateWorldMatrix(true, true);
  let draws = 0;
  let colorDraws = 0;
  let triangles = 0;
  const materials = new Set<string>();
  const buckets = new Map<string, number>();
  const bounds = new THREE.Box3();
  const instanceMatrix = new THREE.Matrix4();
  const worldMatrix = new THREE.Matrix4();
  const vertex = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();
  const liveGeometries = new Set<THREE.BufferGeometry>();
  const colorGeometries = new Set<THREE.BufferGeometry>();
  const uvFingerprint: string[] = [];
  const normalFingerprint: string[] = [];
  const tangentFingerprint: string[] = [];
  root.traverseVisible((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (mesh.layers.mask === 0) return;
    const geometry = mesh.geometry;
    liveGeometries.add(geometry);
    if ((mesh.layers.mask & 1) !== 0) colorGeometries.add(geometry);
    const position = geometry.getAttribute('position');
    if (!position) return;
    const instanceCount = (mesh as THREE.InstancedMesh).isInstancedMesh
      ? (mesh as THREE.InstancedMesh).count
      : 1;
    if (instanceCount <= 0) return;
    const materialList = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const indexCount = geometry.index?.count ?? position.count;
    const groups = Array.isArray(mesh.material) && geometry.groups.length > 0
      ? geometry.groups
      : [{ start: 0, count: indexCount, materialIndex: 0 }];
    let meshRendered = false;
    for (const group of groups) {
      const material = materialList[group.materialIndex ?? 0];
      if (!material?.visible || group.count <= 0) continue;
      const submittedTriangles = group.count / 3 * instanceCount;
      const key = [
        material.uuid,
        mesh.castShadow ? 1 : 0,
        mesh.receiveShadow ? 1 : 0,
        mesh.renderOrder,
        mesh.layers.mask,
        mesh.customDepthMaterial?.uuid ?? '',
        mesh.customDistanceMaterial?.uuid ?? '',
      ].join('|');
      draws += 1;
      if ((mesh.layers.mask & 1) !== 0) colorDraws += 1;
      triangles += submittedTriangles;
      materials.add(material.uuid);
      buckets.set(key, (buckets.get(key) ?? 0) + submittedTriangles);
      meshRendered = true;
    }
    if (!meshRendered) return;
    const uv = geometry.getAttribute('uv');
    const normal = geometry.getAttribute('normal');
    const tangent = geometry.getAttribute('tangent');
    const instanced = (mesh as THREE.InstancedMesh).isInstancedMesh
      ? mesh as THREE.InstancedMesh
      : null;
    for (let renderIndex = 0; renderIndex < instanceCount; renderIndex += 1) {
      if (instanced) {
        instanced.getMatrixAt(renderIndex, instanceMatrix);
        worldMatrix.multiplyMatrices(mesh.matrixWorld, instanceMatrix);
      } else {
        worldMatrix.copy(mesh.matrixWorld);
      }
      if (uv) {
        for (let index = 0; index < uv.count; index += 1) {
          uvFingerprint.push(tuple(uv.getX(index), uv.getY(index)));
        }
      }
      if (normal) {
        normalMatrix.getNormalMatrix(worldMatrix);
        for (let index = 0; index < normal.count; index += 1) {
          direction.fromBufferAttribute(normal, index).applyNormalMatrix(normalMatrix);
          normalFingerprint.push(tuple(direction.x, direction.y, direction.z));
        }
      }
      if (tangent) {
        for (let index = 0; index < tangent.count; index += 1) {
          direction.set(tangent.getX(index), tangent.getY(index), tangent.getZ(index));
          direction.transformDirection(worldMatrix);
          tangentFingerprint.push(tuple(
            direction.x,
            direction.y,
            direction.z,
            tangent.getW(index),
          ));
        }
      }
      for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex += 1) {
        vertex.fromBufferAttribute(position, vertexIndex).applyMatrix4(worldMatrix);
        bounds.expandByPoint(vertex);
      }
    }
  });
  return {
    draws,
    colorDraws,
    triangles: Math.round(triangles),
    materials: [...materials].sort(),
    buckets: [...buckets.entries()].sort(([left], [right]) => left.localeCompare(right)),
    bounds: bounds.isEmpty()
      ? []
      : [...bounds.min.toArray(), ...bounds.max.toArray()],
    geometryBytes: [...liveGeometries].reduce(
      (total, geometry) => total + geometryByteLength(geometry),
      0,
    ),
    colorGeometryBytes: [...colorGeometries].reduce(
      (total, geometry) => total + geometryByteLength(geometry),
      0,
    ),
    uvFingerprint: uvFingerprint.sort(),
    normalFingerprint: normalFingerprint.sort(),
    tangentFingerprint: tangentFingerprint.sort(),
  };
}

function geometryByteLength(geometry: THREE.BufferGeometry): number {
  let bytes = geometry.index?.array.byteLength ?? 0;
  for (const attribute of Object.values(geometry.attributes)) {
    bytes += attribute.array.byteLength;
  }
  return bytes;
}

function tuple(...values: number[]): string {
  return values.map((value) => Math.round(value * 10_000)).join(':');
}

function assertDirectionFingerprintsEqual(
  actual: readonly string[],
  expected: readonly string[],
  message: string,
): void {
  assert.equal(actual.length, expected.length, message);
  for (let index = 0; index < actual.length; index += 1) {
    const actualComponents = actual[index]!.split(':').map(Number);
    const expectedComponents = expected[index]!.split(':').map(Number);
    assert.equal(actualComponents.length, expectedComponents.length, `${message} tuple ${index}`);
    for (let component = 0; component < actualComponents.length; component += 1) {
      assert.ok(
        Math.abs(actualComponents[component]! - expectedComponents[component]!) <= 1,
        `${message} tuple ${index}, component ${component}: ${expected[index]} !== ${actual[index]}`,
      );
    }
  }
}

function testDetachedGeometryDisposal(): void {
  const root = new THREE.Group();
  const disposable = new THREE.BoxGeometry(1, 1, 1);
  let disposableEvents = 0;
  disposable.addEventListener('dispose', () => { disposableEvents += 1; });
  root.add(
    new THREE.Mesh(disposable, new THREE.MeshBasicMaterial()),
    new THREE.Mesh(disposable, new THREE.MeshBasicMaterial()),
  );
  // Material identity is part of the batch key, so make both sources compatible.
  (root.children[1] as THREE.Mesh).material = (root.children[0] as THREE.Mesh).material;
  batchCompletedBuildingStaticMeshes(root);
  assert.equal(disposableEvents, 1, 'a detached unreferenced source geometry must be disposed once');

  const retainedRoot = new THREE.Group();
  const retained = new THREE.BoxGeometry(1, 1, 1);
  let retainedEvents = 0;
  retained.addEventListener('dispose', () => { retainedEvents += 1; });
  const retainedMaterial = new THREE.MeshBasicMaterial();
  retainedRoot.add(
    new THREE.Mesh(retained, retainedMaterial),
    new THREE.Mesh(retained, retainedMaterial),
  );
  const conditional = new THREE.Mesh(retained, retainedMaterial);
  conditional.visible = false;
  retainedRoot.add(conditional);
  batchCompletedBuildingStaticMeshes(retainedRoot);
  assert.equal(
    retainedEvents,
    0,
    'a detached source geometry still referenced by a retained conditional mesh must not be disposed',
  );
  retained.dispose();
  retainedMaterial.dispose();
}

function assertBoundsEqual(
  actual: readonly number[],
  expected: readonly number[],
  message: string,
): void {
  assert.equal(actual.length, expected.length, message);
  for (let index = 0; index < actual.length; index += 1) {
    assert.ok(
      Math.abs(actual[index]! - expected[index]!) <= 1e-5,
      `${message} component ${index}: ${expected[index]} !== ${actual[index]}`,
    );
  }
}

type StaticSourceContract = {
  readonly material: THREE.Material;
  readonly castShadow: boolean;
  readonly receiveShadow: boolean;
  readonly renderOrder: number;
  readonly layers: number;
  readonly customDepthMaterial: THREE.Material | undefined;
  readonly customDistanceMaterial: THREE.Material | undefined;
  readonly attributes: readonly {
    readonly name: string;
    readonly itemSize: number;
    readonly normalized: boolean;
    readonly arrayType: string;
    readonly values: readonly number[];
  }[];
  readonly index: readonly number[] | null;
};

function staticSourceContracts(marker: THREE.Group): StaticSourceContract[] {
  const group = marker.getObjectByName('Completed building static batches');
  assert.ok(group instanceof THREE.Group, 'completed building must expose local static batches');
  return group.children.map((object) => {
    const mesh = object as THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
    assert.ok(mesh.isMesh && !Array.isArray(mesh.material), 'static source must be one material');
    return {
      material: mesh.material,
      castShadow: mesh.castShadow,
      receiveShadow: mesh.receiveShadow,
      renderOrder: mesh.renderOrder,
      layers: mesh.layers.mask,
      customDepthMaterial: mesh.customDepthMaterial,
      customDistanceMaterial: mesh.customDistanceMaterial,
      attributes: Object.entries(mesh.geometry.attributes)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, attribute]) => ({
          name,
          itemSize: attribute.itemSize,
          normalized: attribute.normalized,
          arrayType: attribute.array.constructor.name,
          values: Array.from(attribute.array),
        })),
      index: mesh.geometry.index ? Array.from(mesh.geometry.index.array) : null,
    };
  });
}

function assertPackedContract(
  manager: BuildingStaticBatches,
  buildingId: string,
  marker: THREE.Group,
  expected: readonly StaticSourceContract[],
): void {
  type Entry = {
    readonly record: { readonly mesh: THREE.BatchedMesh };
    readonly instanceId: number;
    readonly shared: {
      readonly geometryId: number | null;
      readonly instanced: {
        readonly mesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material>;
      } | null;
    };
  };
  const state = (
    manager as unknown as {
      buildingStates: Map<string, { entries: Entry[] }>;
    }
  ).buildingStates.get(buildingId);
  assert.ok(state, 'building must retain cross-batch state');
  assert.equal(state.entries.length, expected.length, 'every static source needs one instance');
  marker.updateMatrix();
  const instanceMatrix = new THREE.Matrix4();
  for (let contractIndex = 0; contractIndex < expected.length; contractIndex += 1) {
    const contract = expected[contractIndex]!;
    const entry = state.entries[contractIndex]!;
    const mesh = entry.shared.instanced?.mesh ?? entry.record.mesh;
    assert.strictEqual(mesh.material, contract.material, 'material identity parity');
    assert.equal(mesh.castShadow, contract.castShadow, 'cast-shadow parity');
    assert.equal(mesh.receiveShadow, contract.receiveShadow, 'receive-shadow parity');
    assert.equal(mesh.renderOrder, contract.renderOrder, 'render-order parity');
    assert.equal(mesh.layers.mask, contract.layers, 'layer parity');
    assert.strictEqual(mesh.customDepthMaterial, contract.customDepthMaterial, 'depth material parity');
    assert.strictEqual(
      mesh.customDistanceMaterial,
      contract.customDistanceMaterial,
      'distance material parity',
    );
    mesh.getMatrixAt(entry.instanceId, instanceMatrix);
    assertMatrixEqual(instanceMatrix, marker.matrix, 'cross-building transform parity');

    const range = mesh instanceof THREE.BatchedMesh
      ? entry.shared.geometryId === null
        ? null
        : mesh.getGeometryRangeAt(entry.shared.geometryId)
      : {
          vertexStart: 0,
          indexStart: 0,
        };
    assert.ok(range, 'packed geometry range must remain active');
    for (const attributeContract of contract.attributes) {
      const attribute = mesh.geometry.getAttribute(attributeContract.name);
      assert.ok(attribute, `${attributeContract.name} must remain packed`);
      assert.equal(attribute.itemSize, attributeContract.itemSize, 'attribute item-size parity');
      assert.equal(attribute.normalized, attributeContract.normalized, 'attribute normalization parity');
      assert.equal(attribute.array.constructor.name, attributeContract.arrayType, 'attribute type parity');
      const start = range.vertexStart * attribute.itemSize;
      assert.deepEqual(
        Array.from(attribute.array.slice(start, start + attributeContract.values.length)),
        attributeContract.values,
        `${attributeContract.name} values (including UV/normal/tangent) must be exact`,
      );
    }
    const packedIndex = mesh.geometry.index;
    if (!contract.index) {
      assert.equal(packedIndex, null, 'non-indexed geometry parity');
    } else {
      assert.ok(packedIndex, 'indexed geometry must remain indexed');
      const values = Array.from(
        packedIndex.array.slice(range.indexStart, range.indexStart + contract.index.length),
        (value) => Number(value) - range.vertexStart,
      );
      assert.deepEqual(values, contract.index, 'index topology parity');
    }
  }
}

function assertBuildingBatchState(
  manager: BuildingStaticBatches,
  buildingId: string,
  marker: THREE.Group,
  visible: boolean,
): void {
  type Entry = {
    readonly record: { readonly mesh: THREE.BatchedMesh };
    readonly instanceId: number;
    readonly shared: {
      readonly instanced: {
        readonly mesh: THREE.InstancedMesh;
      } | null;
    };
  };
  const state = (
    manager as unknown as {
      buildingStates: Map<string, { entries: Entry[] }>;
    }
  ).buildingStates.get(buildingId);
  assert.ok(state && state.entries.length > 0, 'building must retain cross-batch entries');
  marker.updateMatrix();
  const actual = new THREE.Matrix4();
  for (const entry of state.entries) {
    const instanced = entry.shared.instanced;
    if (instanced) {
      instanced.mesh.getMatrixAt(entry.instanceId, actual);
      assertMatrixEqual(
        actual,
        visible ? marker.matrix : new THREE.Matrix4().makeScale(0, 0, 0),
        'updated identical-geometry instance transform/visibility',
      );
    } else {
      entry.record.mesh.getMatrixAt(entry.instanceId, actual);
      assertMatrixEqual(actual, marker.matrix, 'updated batch transform');
      assert.equal(
        entry.record.mesh.getVisibleAt(entry.instanceId),
        visible,
        'updated batch visibility',
      );
    }
  }
}

function buildingMatrixTextureVersions(manager: BuildingStaticBatches): number[] {
  const versions: number[] = [];
  manager.group.traverse((object) => {
    const batched = object as THREE.BatchedMesh & {
      _matricesTexture?: THREE.DataTexture;
    };
    if (batched.isBatchedMesh) versions.push(batched._matricesTexture?.version ?? -1);
    const instanced = object as THREE.InstancedMesh;
    if (instanced.isInstancedMesh) versions.push(instanced.instanceMatrix.version);
  });
  return versions;
}

function sharedGeometryProbe(
  manager: BuildingStaticBatches,
  buildingId: string,
): {
  shared: { references: number };
  references: number;
} {
  type Shared = { references: number };
  const state = (
    manager as unknown as {
      buildingStates: Map<string, { entries: Array<{ shared: Shared }> }>;
    }
  ).buildingStates.get(buildingId);
  const shared = state?.entries
    .map((entry) => entry.shared)
    .find((candidate) => candidate.references > 1);
  assert.ok(shared, 'repeated fixture must include shared geometry on the removal probe');
  return { shared, references: shared.references };
}

function assertMatrixEqual(
  actual: THREE.Matrix4,
  expected: THREE.Matrix4,
  message: string,
): void {
  const actualValues = actual.toArray();
  const expectedValues = expected.toArray();
  for (let index = 0; index < actualValues.length; index += 1) {
    assert.ok(
      Math.abs(actualValues[index]! - expectedValues[index]!) <= 1e-6,
      `${message} component ${index}: ${actualValues[index]} !== ${expectedValues[index]}`,
    );
  }
}

function aggregateBuildingBounds(root: THREE.Object3D): number[] {
  root.updateWorldMatrix(true, true);
  const inverseRoot = root.matrixWorld.clone().invert();
  const aggregate = new THREE.Box3();
  const geometryBox = new THREE.Box3();
  const relative = new THREE.Matrix4();
  const instance = new THREE.Matrix4();
  const world = new THREE.Matrix4();
  root.traverse((object) => {
    if (object === root || !collisionVisible(object) || collisionSkipped(object, root)) return;
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const bounds = mesh.geometry.boundingBox;
    if (!bounds) return;
    if ((mesh as THREE.InstancedMesh).isInstancedMesh) {
      const instanced = mesh as THREE.InstancedMesh;
      for (let index = 0; index < instanced.count; index += 1) {
        instanced.getMatrixAt(index, instance);
        world.multiplyMatrices(mesh.matrixWorld, instance);
        relative.multiplyMatrices(inverseRoot, world);
        aggregate.union(geometryBox.copy(bounds).applyMatrix4(relative));
      }
      return;
    }
    relative.multiplyMatrices(inverseRoot, mesh.matrixWorld);
    aggregate.union(geometryBox.copy(bounds).applyMatrix4(relative));
  });
  return aggregate.isEmpty()
    ? []
    : [...aggregate.min.toArray(), ...aggregate.max.toArray()];
}

function collisionVisible(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (!current.visible) return false;
    current = current.parent;
  }
  return true;
}

function collisionSkipped(object: THREE.Object3D, root: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current && current !== root) {
    if (current.userData.fpNoCollision === true) return true;
    const name = current.name.toLowerCase();
    if (
      name.includes('shadow')
      || name.includes('smoke')
      || name.includes('rigged roaming hen')
    ) return true;
    current = current.parent;
  }
  return false;
}

function disposeGeometry(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) geometries.add(mesh.geometry);
  });
  for (const geometry of geometries) geometry.dispose();
}
