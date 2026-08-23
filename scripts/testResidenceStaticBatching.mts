import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  applyResidenceWindowGlow,
  createInitialResidenceConstructionMesh,
  createResidenceMesh,
} from '../src/residences/ResidenceMarkers.ts';
import {
  batchResidenceStaticMeshes,
  isDynamicResidenceBatchBoundary,
} from '../src/residences/staticResidenceBatch.ts';
import { ResidenceStaticBatches } from '../src/residences/ResidenceStaticBatches.ts';

type Snapshot = {
  draws: number;
  triangles: number;
  geometryBytes: number;
  materials: string[];
  buckets: Array<[string, number]>;
  bounds: number[];
  uvs: string[];
  normals: string[];
  tangents: string[];
};

for (let tier = 1; tier <= 4; tier += 1) {
  for (const tiledRoof of [false, true]) {
    for (const seed of [7, 113, 991]) {
      const home = createResidenceMesh(seed, tier as 1 | 2 | 3 | 4, tiledRoof);
      home.position.set(seed * 0.003, tier * 0.07, -seed * 0.002);
      home.rotation.set(0.02, seed * 0.001, -0.015);
      const windowMaterial = home.userData.windowMaterial as THREE.MeshStandardMaterial;
      assertResidenceWindowSurfaceContract(
        home,
        tier as 1 | 2 | 3 | 4,
        windowMaterial,
        label('authored window surfaces'),
      );
      const smokeAnchor = home.getObjectByName('ChimneyEmitter');
      assert.ok(smokeAnchor, label('smoke anchor exists'));
      assert.equal(
        isDynamicResidenceBatchBoundary(smokeAnchor, windowMaterial),
        true,
        label('smoke anchor remains a dynamic batching boundary'),
      );
      assert.equal(
        smokeAnchor.userData.residenceSmokeExit,
        tier === 1 ? 'through-thatch' : 'chimney',
        label('smoke anchor retains its authored exit'),
      );
      const dynamic = collectDynamic(home, windowMaterial);
      const before = snapshot(home);
      const colliderBefore = aggregateResidenceBounds(home);
      const windowDrawsBefore = visibleMeshesWithMaterial(home, windowMaterial).length;
      const stats = batchResidenceStaticMeshes(home);
      const after = snapshot(home);
      assert.equal(after.triangles, before.triangles, label('triangles'));
      assert.deepEqual(after.materials, before.materials, label('materials'));
      assert.deepEqual(after.buckets, before.buckets, label('shadow/material buckets'));
      assertBounds(after.bounds, before.bounds, label('world bounds'));
      assert.deepEqual(after.uvs, before.uvs, label('UVs'));
      assert.deepEqual(after.normals, before.normals, label('world normals'));
      assert.deepEqual(after.tangents, before.tangents, label('world tangents'));
      assert.ok(after.geometryBytes <= before.geometryBytes, label('geometry bytes'));
      for (const entry of dynamic) {
        assert.strictEqual(
          home.getObjectByProperty('uuid', entry.object.uuid),
          entry.object,
          label(`dynamic identity ${entry.object.name || entry.object.type}`),
        );
        assert.equal(entry.object.visible, entry.visible, label('dynamic visibility'));
        assert.deepEqual(entry.object.matrix.toArray(), entry.matrix, label('dynamic transform'));
      }
      const windows = visibleMeshesWithMaterial(home, windowMaterial);
      assert.ok(windows.length > 0, label('window meshes retained'));
      assert.equal(
        windows.reduce(
          (count, window) => count + Number(window.userData.sourceMeshCount ?? 1),
          0,
        ),
        windowDrawsBefore,
        label('dynamic window surfaces retained through local merging'),
      );
      assert.strictEqual(
        home.getObjectByName('ChimneyEmitter'),
        smokeAnchor,
        label('smoke anchor identity retained'),
      );
      assert.equal(
        after.draws,
        before.draws
          - stats.sourceDraws
          + stats.batchedDraws
          - windowDrawsBefore
          + windows.length,
        label('submission accounting'),
      );
      const darkEmissiveIntensity = windowMaterial.emissiveIntensity;
      applyResidenceWindowGlow(windowMaterial, 0.537, true);
      assert.ok(
        windowMaterial.emissiveIntensity > darkEmissiveIntensity,
        label('dynamic window material responds to household light'),
      );
      for (const window of windows) {
        assert.strictEqual(window.material, windowMaterial, label('window material control'));
      }
      const collisionRoot = new THREE.Group();
      collisionRoot.add(home);
      const crossBatch = new ResidenceStaticBatches(collisionRoot);
      crossBatch.registerResidence('collider-probe', home);
      assertBounds(
        aggregateResidenceBounds(home),
        colliderBefore,
        label('first-person aggregate collider'),
      );
      crossBatch.dispose();
      disposeResidence(home);

      function label(subject: string): string {
        return `tier ${tier}, tiled=${tiledRoof}, seed=${seed}: ${subject}`;
      }
    }
  }
}

const initial = createInitialResidenceConstructionMesh(31);
const initialFrame = initial.getObjectByName('InitialCottageConstructionFrame');
const initialParts = initialFrame?.children.slice() ?? [];
batchResidenceStaticMeshes(initial);
assert.strictEqual(
  initial.getObjectByName('InitialCottageConstructionFrame'),
  initialFrame,
  'initial construction frame must remain authored and name-addressable',
);
for (const part of initialParts) {
  assert.strictEqual(
    initial.getObjectByProperty('uuid', part.uuid),
    part,
    'each progress-revealed construction part must remain independent',
  );
}
disposeResidence(initial);

const dense = new THREE.Group();
const crossBatches = new ResidenceStaticBatches(dense);
let denseBeforeDraws = 0;
let denseBeforeBytes = 0;
let trackedHome: THREE.Group | null = null;
const denseHomes: THREE.Group[] = [];
for (let index = 0; index < 100; index += 1) {
  const tier = (index % 4 + 1) as 1 | 2 | 3 | 4;
  const home = createResidenceMesh(index * 97 + 13, tier, index % 2 === 0);
  home.position.set((index % 10) * 12, 0, Math.floor(index / 10) * 13);
  home.rotation.y = (index % 8) * Math.PI * 0.0625;
  dense.add(home);
  const before = snapshot(home);
  denseBeforeDraws += before.draws;
  denseBeforeBytes += before.geometryBytes;
  denseHomes.push(home);
  if (index === 0) trackedHome = home;
}
const denseRawGeometry = allGeometryStats(dense);
for (let index = 0; index < denseHomes.length; index += 1) {
  const home = denseHomes[index]!;
  batchResidenceStaticMeshes(home);
  crossBatches.registerResidence(`dense-${index}`, home);
  crossBatches.updateResidence(`dense-${index}`, home, true);
}
assert.ok(trackedHome, 'dense fixture must retain a transform probe residence');
trackedHome.position.set(14.25, -0.125, 73.5);
trackedHome.rotation.set(0.015, 1.137, -0.025);
trackedHome.scale.set(0.992, 0.947, 0.989);
crossBatches.updateResidence('dense-0', trackedHome, false);
assertResidenceBatchState(crossBatches, 'dense-0', trackedHome, false);
crossBatches.updateResidence('dense-0', trackedHome, true);
assertResidenceBatchState(crossBatches, 'dense-0', trackedHome, true);
const matrixTextureVersions = crossResidenceMatrixTextureVersions(crossBatches);
crossBatches.updateResidence('dense-0', trackedHome, true);
assert.deepEqual(
  crossResidenceMatrixTextureVersions(crossBatches),
  matrixTextureVersions,
  'an identical residence update must not dirty any batch matrix texture',
);
crossBatches.finalizeGeometryBuffers();
const denseAfter = snapshot(dense);
const denseFinalGeometry = allGeometryStats(dense);
const denseStats = crossBatches.getStats();
// Three's WebGPU backend issues one native draw for every active BatchedMesh
// multi-draw entry. Keep render-object reduction and native submissions
// separate so the contract cannot overstate the GPU win.
const denseNativeDraws = denseAfter.draws - denseStats.renderObjects
  + denseStats.nativeDraws;
assert.ok(
  denseBeforeDraws >= 7_500,
  `100-home fixture must retain the reviewed dense load (got ${denseBeforeDraws})`,
);
assert.ok(
  denseAfter.draws <= 200,
  `100 completed homes must remain at or below 200 render objects (got ${denseAfter.draws})`,
);
assert.ok(
  denseAfter.draws <= denseBeforeDraws * 0.03,
  `100-home batching must remove at least 97% of render objects (${denseBeforeDraws} -> ${denseAfter.draws})`,
);
assert.ok(
  denseNativeDraws <= 1_450,
  `100 completed homes with distinct plaster cottage envelopes must remain at or below 1,450 native WebGPU draws (got ${denseNativeDraws})`,
);
assert.ok(
  denseNativeDraws <= denseBeforeDraws * 0.2,
  `local residence merging must remove at least 80% of native draws (${denseBeforeDraws} -> ${denseNativeDraws})`,
);
assert.ok(
  denseAfter.geometryBytes <= denseBeforeBytes,
  `100-home live geometry bytes must not inflate (${denseBeforeBytes} -> ${denseAfter.geometryBytes})`,
);
assert.ok(
  denseStats.renderObjects > 0,
  'dense fixture must exercise cross-residence batches',
);
assert.ok(denseStats.instances >= 100, 'dense fixture must retain per-home batch instances');
assert.ok(
  denseRawGeometry.geometries <= 9_500,
  `100 authored homes with true cottage apertures must remain at or below 9,500 live geometries (${denseRawGeometry.geometries})`,
);
assert.ok(
  denseFinalGeometry.geometries <= 1_300,
  `100 registered homes must remain at or below 1,300 live geometries (${denseFinalGeometry.geometries})`,
);
assert.ok(
  denseFinalGeometry.bytes <= denseRawGeometry.bytes + 840,
  `registration may add only the shared 840-byte collision box (${denseRawGeometry.bytes} -> ${denseFinalGeometry.bytes})`,
);
const collisionGeometries = new Set<THREE.BufferGeometry>();
dense.traverse((object) => {
  const mesh = object as THREE.Mesh;
  if (mesh.userData.residenceStaticCollisionProxy === true) {
    collisionGeometries.add(mesh.geometry);
  }
});
assert.equal(
  collisionGeometries.size,
  1,
  'all residence collision proxies must share one unit-box geometry',
);
crossBatches.dispose();
disposeResidence(dense);

console.log(
  `residence static batching passed (${denseBeforeDraws} -> ${denseNativeDraws} native draws / `
    + `${denseAfter.draws} render objects; `
    + `${denseBeforeBytes} -> ${denseAfter.geometryBytes} rendered geometry bytes; `
    + `${denseAfter.triangles} visible triangles; ${denseStats.instances} batch instances; `
    + `${denseRawGeometry.geometries} -> ${denseFinalGeometry.geometries} live geometries `
    + `for 100 homes)`,
);

function collectDynamic(
  root: THREE.Group,
  windowMaterial: THREE.Material,
): Array<{ object: THREE.Object3D; visible: boolean; matrix: number[] }> {
  const entries: Array<{ object: THREE.Object3D; visible: boolean; matrix: number[] }> = [];
  const visit = (object: THREE.Object3D, hiddenByAncestor: boolean): void => {
    const hidden = hiddenByAncestor || !object.visible;
    const mesh = object as THREE.Mesh;
    const isWindowPane = mesh.isMesh && mesh.material === windowMaterial;
    if (hidden || (
      isDynamicResidenceBatchBoundary(object, windowMaterial)
      && !isWindowPane
    )) {
      object.updateMatrix();
      entries.push({ object, visible: object.visible, matrix: object.matrix.toArray() });
    }
    for (const child of object.children) visit(child, hidden);
  };
  for (const child of root.children) visit(child, false);
  return entries;
}

function visibleMeshesWithMaterial(
  root: THREE.Object3D,
  material: THREE.Material,
): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverseVisible((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && mesh.material === material) meshes.push(mesh);
  });
  return meshes;
}

function assertResidenceWindowSurfaceContract(
  root: THREE.Group,
  tier: 1 | 2 | 3 | 4,
  windowMaterial: THREE.Material,
  message: string,
): void {
  const openings: THREE.Object3D[] = [];
  const panes: THREE.Mesh[] = [];
  const interiors: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (object.userData.facadeOpeningKind === 'window') openings.push(object);
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (mesh.userData.facadeOpeningRole === 'window-pane') panes.push(mesh);
    if (mesh.userData.facadeOpeningRole === 'window-interior') interiors.push(mesh);
  });

  assert.ok(openings.length > 0, `${message}: residence needs authored windows`);
  for (const opening of openings) {
    assert.equal(
      opening.userData.residenceWallCutThrough,
      tier === 1,
      `${message}: only open cottage windows may claim a physical wall cut-through`,
    );
  }

  if (tier === 1) {
    assert.equal(openings.length, 3, `${message}: cottage needs one front and two side apertures`);
    assert.equal(panes.length, 0, `${message}: cottage apertures must not retain glazing`);
    assert.equal(
      interiors.length,
      openings.length,
      `${message}: every cottage aperture needs one recessed lit interior`,
    );
    for (const opening of openings) {
      assert.equal(
        opening.userData.residenceWindowGlazing,
        'open-aperture',
        `${message}: cottage opening must identify as unglazed`,
      );
    }
    for (const interior of interiors) {
      assert.strictEqual(
        interior.material,
        windowMaterial,
        `${message}: recessed interior must share the per-residence light material`,
      );
      assert.equal(
        interior.userData.residenceWindowInteriorDepthMeters,
        0.34,
        `${message}: lit interior must remain visibly recessed`,
      );
      assert.ok(
        interior.position.z < -0.3,
        `${message}: lit interior must sit behind the wall opening`,
      );
    }
    return;
  }

  assert.equal(interiors.length, 0, `${message}: higher tiers must not use open cottage interiors`);
  assert.equal(
    panes.length,
    openings.length,
    `${message}: every higher-tier opening needs one glazed pane`,
  );
  for (const opening of openings) {
    assert.equal(
      opening.userData.residenceWindowGlazing,
      'glazed-pane',
      `${message}: higher-tier opening must identify as glazed`,
    );
  }
  for (const pane of panes) {
    assert.strictEqual(
      pane.material,
      windowMaterial,
      `${message}: glazed pane must share the per-residence light material`,
    );
  }
}

function snapshot(root: THREE.Object3D): Snapshot {
  root.updateWorldMatrix(true, true);
  let draws = 0;
  let triangles = 0;
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<string>();
  const buckets = new Map<string, number>();
  const bounds = new THREE.Box3();
  const vertex = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();
  const uvs: string[] = [];
  const normals: string[] = [];
  const tangents: string[] = [];
  root.traverseVisible((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh) return;
    const geometry = mesh.geometry;
    const position = geometry.getAttribute('position');
    if (!position) return;
    const materialList = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const elementCount = geometry.index?.count ?? position.count;
    const groups = Array.isArray(mesh.material) && geometry.groups.length > 0
      ? geometry.groups
      : [{ count: elementCount, materialIndex: 0 }];
    let rendered = false;
    for (const group of groups) {
      const material = materialList[group.materialIndex ?? 0];
      if (!material?.visible || group.count <= 0) continue;
      const submittedTriangles = group.count / 3;
      const key = [
        material.uuid,
        mesh.castShadow ? 1 : 0,
        mesh.receiveShadow ? 1 : 0,
        mesh.renderOrder,
        mesh.layers.mask,
      ].join('|');
      draws += 1;
      triangles += submittedTriangles;
      materials.add(material.uuid);
      buckets.set(key, (buckets.get(key) ?? 0) + submittedTriangles);
      rendered = true;
    }
    if (!rendered) return;
    geometries.add(geometry);
    const uv = geometry.getAttribute('uv');
    if (uv) {
      for (let index = 0; index < uv.count; index += 1) {
        uvs.push(tuple(uv.getX(index), uv.getY(index)));
      }
    }
    const normal = geometry.getAttribute('normal');
    if (normal) {
      normalMatrix.getNormalMatrix(mesh.matrixWorld);
      for (let index = 0; index < normal.count; index += 1) {
        direction.fromBufferAttribute(normal, index).applyNormalMatrix(normalMatrix);
        normals.push(tuple(direction.x, direction.y, direction.z));
      }
    }
    const tangent = geometry.getAttribute('tangent');
    if (tangent) {
      for (let index = 0; index < tangent.count; index += 1) {
        direction.set(tangent.getX(index), tangent.getY(index), tangent.getZ(index));
        direction.transformDirection(mesh.matrixWorld);
        tangents.push(tuple(direction.x, direction.y, direction.z, tangent.getW(index)));
      }
    }
    for (let index = 0; index < position.count; index += 1) {
      vertex.fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld);
      bounds.expandByPoint(vertex);
    }
  });
  return {
    draws,
    triangles: Math.round(triangles),
    geometryBytes: [...geometries].reduce((sum, geometry) => {
      let bytes = geometry.index?.array.byteLength ?? 0;
      for (const attribute of Object.values(geometry.attributes)) {
        bytes += attribute.array.byteLength;
      }
      return sum + bytes;
    }, 0),
    materials: [...materials].sort(),
    buckets: [...buckets.entries()].sort(([left], [right]) => left.localeCompare(right)),
    bounds: bounds.isEmpty() ? [] : [...bounds.min.toArray(), ...bounds.max.toArray()],
    uvs: uvs.sort(),
    normals: normals.sort(),
    tangents: tangents.sort(),
  };
}

function allGeometryStats(root: THREE.Object3D): { geometries: number; bytes: number } {
  const geometries = new Set<THREE.BufferGeometry>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) geometries.add(mesh.geometry);
  });
  let bytes = 0;
  for (const geometry of geometries) {
    bytes += geometry.index?.array.byteLength ?? 0;
    for (const attribute of Object.values(geometry.attributes)) {
      bytes += attribute.array.byteLength;
    }
  }
  return { geometries: geometries.size, bytes };
}

function tuple(...values: number[]): string {
  return values.map((value) => Math.round(value * 10_000)).join(':');
}

function assertResidenceBatchState(
  manager: ResidenceStaticBatches,
  residenceId: string,
  marker: THREE.Group,
  visible: boolean,
): void {
  type TestEntry = {
    record: { mesh: THREE.BatchedMesh };
    instanceId: number;
  };
  const state = (
    manager as unknown as {
      residenceStates: Map<string, { entries: TestEntry[] }>;
    }
  ).residenceStates.get(residenceId);
  const entries = state?.entries;
  assert.ok(entries && entries.length > 0, 'residence must retain cross-batch entries');
  marker.updateMatrix();
  const actual = new THREE.Matrix4();
  for (const { record, instanceId } of entries) {
    record.mesh.getMatrixAt(instanceId, actual);
    const actualElements = actual.toArray();
    const expectedElements = marker.matrix.toArray();
    for (let index = 0; index < actualElements.length; index += 1) {
      assert.ok(
        Math.abs(actualElements[index]! - expectedElements[index]!) <= 1e-6,
        'cross-batch instance must retain the residence transform at GPU precision',
      );
    }
    assert.equal(
      record.mesh.getVisibleAt(instanceId),
      visible,
      'cross-batch instance must retain residence visibility',
    );
  }
}

function crossResidenceMatrixTextureVersions(
  manager: ResidenceStaticBatches,
): number[] {
  const versions: number[] = [];
  manager.group.traverse((object) => {
    const batched = object as THREE.BatchedMesh & {
      _matricesTexture?: THREE.DataTexture;
    };
    if (batched.isBatchedMesh) {
      versions.push(batched._matricesTexture?.version ?? -1);
    }
  });
  return versions;
}

function aggregateResidenceBounds(root: THREE.Object3D): number[] {
  root.updateWorldMatrix(true, true);
  const inverseRoot = root.matrixWorld.clone().invert();
  const aggregate = new THREE.Box3();
  const geometryBox = new THREE.Box3();
  const relative = new THREE.Matrix4();
  const instance = new THREE.Matrix4();
  const world = new THREE.Matrix4();
  root.traverse((object) => {
    if (object === root || !collisionVisible(object) || collisionSkipped(object, root)) {
      return;
    }
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
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function assertBounds(actual: number[], expected: number[], message: string): void {
  assert.equal(actual.length, expected.length, message);
  for (let index = 0; index < actual.length; index += 1) {
    assert.ok(
      Math.abs(actual[index]! - expected[index]!) <= 1e-5,
      `${message} component ${index}: ${expected[index]} !== ${actual[index]}`,
    );
  }
}

function disposeResidence(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const ownedMaterials = new Set<THREE.Material>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
  });
  const windowMaterial = root.userData.windowMaterial as THREE.Material | undefined;
  if (windowMaterial) ownedMaterials.add(windowMaterial);
  for (const geometry of geometries) geometry.dispose();
  for (const material of ownedMaterials) material.dispose();
}
