import * as THREE from 'three';

type ResidenceBatchEntry = {
  readonly record: ResidenceBatchRecord;
  readonly geometryId: number;
  readonly instanceId: number;
};

type ResidenceBatchState = {
  readonly entries: ResidenceBatchEntry[];
  readonly matrix: THREE.Matrix4;
  readonly collisionProxy: THREE.Mesh | null;
  visible: boolean;
};

type ResidenceBatchRecord = {
  readonly key: string;
  readonly mesh: THREE.BatchedMesh;
  indexed: boolean;
  vertexCapacity: number;
  indexCapacity: number;
  activeInstances: number;
};

/**
 * Packs immutable residence structure into one heterogeneous BatchedMesh per
 * exact material/render-state/attribute bucket. Dynamic authored children stay
 * on their residence marker; every packed geometry retains its own transform
 * and visibility instance.
 */
export class ResidenceStaticBatches {
  readonly group = new THREE.Group();

  private readonly batches = new Map<string, ResidenceBatchRecord[]>();
  private readonly residenceStates = new Map<string, ResidenceBatchState>();
  private readonly collisionProxyGeometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly collisionProxyMaterial = new THREE.MeshBasicMaterial();
  private dirtyCapacity = false;

  constructor(parent: THREE.Group) {
    this.group.name = 'Cross-residence static batches';
    this.group.userData.crossResidenceStaticBatches = true;
    parent.add(this.group);
    this.collisionProxyGeometry.name = 'Shared residence collision proxy geometry';
    this.collisionProxyMaterial.name = 'Invisible residence collision proxy material';
    this.collisionProxyMaterial.visible = false;
  }

  registerResidence(residenceId: string, marker: THREE.Group): void {
    this.removeResidence(residenceId);
    const localBatchGroup = marker.getObjectByName('Residence static batches');
    if (!(localBatchGroup instanceof THREE.Group)) return;
    const sourceMeshes = localBatchGroup.children.filter(
      (child): child is THREE.Mesh<THREE.BufferGeometry, THREE.Material> => (
        (child as THREE.Mesh).isMesh
        && !Array.isArray((child as THREE.Mesh).material)
      ),
    );
    if (sourceMeshes.length === 0) {
      localBatchGroup.removeFromParent();
      return;
    }

    const collisionProxy = addStaticCollisionProxy(
      marker,
      sourceMeshes,
      this.collisionProxyGeometry,
      this.collisionProxyMaterial,
    );
    marker.updateMatrix();
    const entries: ResidenceBatchEntry[] = [];
    for (const source of sourceMeshes) {
      const record = this.getOrCreateBatch(source);
      this.ensureCapacity(record, source.geometry);
      const geometryId = record.mesh.addGeometry(source.geometry);
      const instanceId = record.mesh.addInstance(geometryId);
      record.mesh.setMatrixAt(instanceId, marker.matrix);
      record.mesh.setVisibleAt(instanceId, marker.visible);
      record.activeInstances += 1;
      entries.push({ record, geometryId, instanceId });
      source.removeFromParent();
      source.geometry.dispose();
    }
    localBatchGroup.removeFromParent();
    this.residenceStates.set(residenceId, {
      entries,
      matrix: marker.matrix.clone(),
      collisionProxy,
      visible: marker.visible,
    });
    this.dirtyCapacity = true;
  }

  updateResidence(
    residenceId: string,
    marker: THREE.Group,
    visible: boolean,
  ): void {
    const state = this.residenceStates.get(residenceId);
    if (!state) return;
    marker.updateMatrix();
    const matrixChanged = !state.matrix.equals(marker.matrix);
    const visibilityChanged = state.visible !== visible;
    if (!matrixChanged && !visibilityChanged) return;
    for (const { record, instanceId } of state.entries) {
      if (matrixChanged) record.mesh.setMatrixAt(instanceId, marker.matrix);
      if (visibilityChanged) record.mesh.setVisibleAt(instanceId, visible);
    }
    if (matrixChanged) state.matrix.copy(marker.matrix);
    state.visible = visible;
  }

  setResidenceVisible(residenceId: string, visible: boolean): void {
    const state = this.residenceStates.get(residenceId);
    if (!state || state.visible === visible) return;
    for (const { record, instanceId } of state.entries) {
      record.mesh.setVisibleAt(instanceId, visible);
    }
    state.visible = visible;
  }

  removeResidence(residenceId: string): void {
    const state = this.residenceStates.get(residenceId);
    if (!state) return;
    this.residenceStates.delete(residenceId);
    state.collisionProxy?.removeFromParent();
    for (const { record, geometryId, instanceId } of state.entries) {
      record.mesh.deleteInstance(instanceId);
      record.mesh.deleteGeometry(geometryId);
      record.activeInstances -= 1;
      if (record.activeInstances !== 0) continue;
      record.mesh.removeFromParent();
      record.mesh.dispose();
      const records = this.batches.get(record.key);
      if (!records) continue;
      const recordIndex = records.indexOf(record);
      if (recordIndex >= 0) records.splice(recordIndex, 1);
      if (records.length === 0) this.batches.delete(record.key);
    }
    this.dirtyCapacity = true;
  }

  finalizeGeometryBuffers(): void {
    if (!this.dirtyCapacity) return;
    this.dirtyCapacity = false;
    for (const record of this.records()) {
      record.mesh.optimize();
      const usedVertices = record.vertexCapacity - record.mesh.unusedVertexCount;
      const usedIndices = record.indexed
        ? record.indexCapacity - record.mesh.unusedIndexCount
        : 0;
      if (
        usedVertices !== record.vertexCapacity
        || (record.indexed && usedIndices !== record.indexCapacity)
      ) {
        record.mesh.setGeometrySize(usedVertices, usedIndices);
        record.vertexCapacity = usedVertices;
        record.indexCapacity = usedIndices;
      }
    }
  }

  getStats(): {
    renderObjects: number;
    nativeDraws: number;
    instances: number;
    geometryBytes: number;
  } {
    let instances = 0;
    let geometryBytes = 0;
    let draws = 0;
    for (const record of this.records()) {
      draws += 1;
      instances += record.activeInstances;
      geometryBytes += bufferGeometryBytes(record.mesh.geometry);
    }
    return {
      renderObjects: draws,
      nativeDraws: instances,
      instances,
      geometryBytes,
    };
  }

  dispose(): void {
    for (const state of this.residenceStates.values()) {
      state.collisionProxy?.removeFromParent();
    }
    for (const record of this.records()) {
      record.mesh.dispose();
    }
    this.batches.clear();
    this.residenceStates.clear();
    this.collisionProxyGeometry.dispose();
    this.collisionProxyMaterial.dispose();
    this.group.removeFromParent();
  }

  private getOrCreateBatch(
    source: THREE.Mesh<THREE.BufferGeometry, THREE.Material>,
  ): ResidenceBatchRecord {
    const key = residenceBatchKey(source);
    const position = source.geometry.getAttribute('position');
    const indexed = source.geometry.index !== null;
    const records = this.batches.get(key) ?? [];
    for (let index = records.length - 1; index >= 0; index -= 1) {
      const existing = records[index]!;
      const usedVertices = existing.vertexCapacity - existing.mesh.unusedVertexCount;
      if (!indexed || usedVertices + position.count <= 65_535) return existing;
    }
    const vertexCapacity = position.count;
    const indexCapacity = source.geometry.index?.count ?? 0;
    const mesh = new THREE.BatchedMesh(
      8,
      vertexCapacity,
      indexed ? indexCapacity : undefined,
      source.material,
    );
    mesh.name = `Cross-residence static batch ${this.batchCount() + 1}`;
    mesh.castShadow = source.castShadow;
    mesh.receiveShadow = source.receiveShadow;
    mesh.renderOrder = source.renderOrder;
    mesh.frustumCulled = false;
    mesh.perObjectFrustumCulled = true;
    mesh.layers.mask = source.layers.mask;
    mesh.customDepthMaterial = source.customDepthMaterial;
    mesh.customDistanceMaterial = source.customDistanceMaterial;
    mesh.userData.crossResidenceStaticBatch = true;
    this.group.add(mesh);
    const record = {
      key,
      mesh,
      indexed,
      vertexCapacity,
      indexCapacity,
      activeInstances: 0,
    };
    records.push(record);
    this.batches.set(key, records);
    return record;
  }

  private ensureCapacity(
    record: ResidenceBatchRecord,
    geometry: THREE.BufferGeometry,
  ): void {
    const requiredVertices = geometry.getAttribute('position').count;
    const requiredIndices = geometry.index?.count ?? 0;
    let vertexCapacity = record.vertexCapacity;
    let indexCapacity = record.indexCapacity;
    if (record.mesh.unusedVertexCount < requiredVertices) {
      vertexCapacity = Math.min(record.indexed ? 65_535 : Number.MAX_SAFE_INTEGER, Math.max(
        record.vertexCapacity + requiredVertices,
        Math.ceil(record.vertexCapacity * 1.5),
      ));
    }
    if (record.indexed && record.mesh.unusedIndexCount < requiredIndices) {
      indexCapacity = Math.max(
        record.indexCapacity + requiredIndices,
        Math.ceil(record.indexCapacity * 1.5),
      );
    }
    if (
      vertexCapacity !== record.vertexCapacity
      || indexCapacity !== record.indexCapacity
    ) {
      record.mesh.optimize();
      record.mesh.setGeometrySize(vertexCapacity, indexCapacity);
      record.vertexCapacity = vertexCapacity;
      record.indexCapacity = indexCapacity;
    }
    if (record.activeInstances >= record.mesh.maxInstanceCount) {
      record.mesh.setInstanceCount(Math.max(
        record.activeInstances + 1,
        record.mesh.maxInstanceCount * 2,
      ));
    }
  }

  private *records(): Generator<ResidenceBatchRecord> {
    for (const records of this.batches.values()) {
      yield* records;
    }
  }

  private batchCount(): number {
    let count = 0;
    for (const records of this.batches.values()) count += records.length;
    return count;
  }
}

function residenceBatchKey(
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>,
): string {
  return [
    mesh.material.uuid,
    mesh.castShadow ? 1 : 0,
    mesh.receiveShadow ? 1 : 0,
    mesh.renderOrder,
    mesh.layers.mask,
    mesh.customDepthMaterial?.uuid ?? '',
    mesh.customDistanceMaterial?.uuid ?? '',
    mesh.geometry.index?.array.constructor.name ?? 'non-indexed',
    Object.entries(mesh.geometry.attributes)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, attribute]) => [
        name,
        attribute.itemSize,
        attribute.normalized ? 1 : 0,
        attribute.array.constructor.name,
      ].join(':'))
      .join(','),
  ].join('|');
}

function addStaticCollisionProxy(
  marker: THREE.Group,
  sourceMeshes: readonly THREE.Mesh[],
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
): THREE.Mesh | null {
  marker.updateWorldMatrix(true, true);
  const inverseMarker = marker.matrixWorld.clone().invert();
  const localBounds = new THREE.Box3();
  const geometryBounds = new THREE.Box3();
  const relative = new THREE.Matrix4();
  for (const source of sourceMeshes) {
    if (!source.geometry.boundingBox) source.geometry.computeBoundingBox();
    if (!source.geometry.boundingBox) continue;
    relative.multiplyMatrices(inverseMarker, source.matrixWorld);
    geometryBounds.copy(source.geometry.boundingBox).applyMatrix4(relative);
    localBounds.union(geometryBounds);
  }
  if (localBounds.isEmpty()) return null;
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  localBounds.getSize(size);
  localBounds.getCenter(center);
  const proxy = new THREE.Mesh(geometry, material);
  proxy.name = 'Residence collision geometry proxy';
  proxy.position.copy(center);
  proxy.scale.copy(size);
  proxy.castShadow = false;
  proxy.receiveShadow = false;
  proxy.userData.residenceStaticCollisionProxy = true;
  marker.add(proxy);
  return proxy;
}

function bufferGeometryBytes(geometry: THREE.BufferGeometry): number {
  let bytes = geometry.index?.array.byteLength ?? 0;
  for (const attribute of Object.values(geometry.attributes)) {
    bytes += attribute.array.byteLength;
  }
  return bytes;
}
