import * as THREE from 'three';
import { resizeBatchedMeshInstances } from '../scene/resizeBatchedMesh.ts';
import { SpatialMergedGeometry, extractBatchedGeometry, type StaticGeometryPart } from '../scene/SpatialMergedGeometry.ts';
import { BuildingSpatialShadowBatches } from './BuildingSpatialShadowBatches.ts';
import { BuildingStockInstances } from './BuildingStockInstances.ts';
import { StaticRenderBundle } from '../scene/StaticRenderBundle.ts';

const COLLAPSED_INSTANCE_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);

type SharedPackedGeometry = {
  geometryId: number | null;
  references: number;
  instanced: InstancedGeometryRecord | null;
  readonly entries: Set<BuildingBatchEntry>;
};

type InstancedGeometryRecord = {
  mesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material>;
  capacity: number;
  readonly entries: BuildingBatchEntry[];
};

type BuildingBatchEntry = {
  readonly record: BuildingBatchRecord;
  instanceId: number;
  readonly shared: SharedPackedGeometry;
};

type BuildingBatchState = {
  readonly entries: BuildingBatchEntry[];
  readonly matrix: THREE.Matrix4;
  readonly collisionProxy: THREE.Mesh | null;
  visible: boolean;
};

type BuildingBatchRecord = {
  readonly key: string;
  readonly mesh: THREE.BatchedMesh;
  readonly indexed: boolean;
  vertexCapacity: number;
  indexCapacity: number;
  activeInstances: number;
  readonly geometriesByFingerprint: Map<string, SharedPackedGeometry[]>;
};

export type BuildingStaticBatchStats = {
  /** Scene objects submitted after traversal/state sorting. */
  readonly renderObjects: number;
  /** Worst-case visible WebGPU draw/drawIndexed commands. */
  readonly nativeDrawCommands: number;
  readonly instances: number;
  readonly instancedDraws: number;
  readonly uniqueGeometries: number;
  readonly geometryBytes: number;
};

/**
 * Packs immutable completed-building structure across marker boundaries. Each
 * batch is restricted to one exact material/render-state/attribute bucket,
 * while every building keeps an independent transform and visibility instance.
 * Dynamic authored children never leave their marker.
 */
export class BuildingStaticBatches {
  readonly group = new StaticRenderBundle();

  private readonly batches = new Map<string, BuildingBatchRecord[]>();
  private readonly buildingStates = new Map<string, BuildingBatchState>();
  private readonly collisionProxyGeometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly collisionProxyMaterial = new THREE.MeshBasicMaterial();
  private dirtyCapacity = false;
  private dirtyInstanceBounds = false;
  private dirtyDraws = false;
  private readonly mergedDraws: SpatialMergedGeometry | null;
  private readonly spatialShadows: BuildingSpatialShadowBatches | null;
  private readonly stockInstances: BuildingStockInstances | null;

  private readonly sourceGroupName: string;
  private readonly collisionProxyFlag: string;

  constructor(parent: THREE.Group, options: { sourceGroupName?: string; collisionProxyFlag?: string; mergeDraws?: boolean } = {}) {
    this.sourceGroupName = options.sourceGroupName ?? 'Completed building static batches';
    this.collisionProxyFlag = options.collisionProxyFlag ?? 'buildingStaticCollisionProxy';
    this.group.name = 'Cross-building static batches';
    this.group.userData.crossBuildingStaticBatches = true;
    parent.add(this.group);
    this.mergedDraws = options.mergeDraws ? new SpatialMergedGeometry(this.group) : null;
    this.spatialShadows = options.mergeDraws ? new BuildingSpatialShadowBatches(this.group) : null;
    this.stockInstances = options.mergeDraws ? new BuildingStockInstances(this.group) : null;
    this.collisionProxyGeometry.name = 'Shared building collision proxy geometry';
    this.collisionProxyMaterial.name = 'Invisible building collision proxy material';
    this.collisionProxyMaterial.visible = false;
  }

  registerBuilding(buildingId: string, marker: THREE.Group): void {
    this.removeBuilding(buildingId);
    this.spatialShadows?.register(buildingId, marker);
    this.stockInstances?.register(buildingId, marker);
    const localBatchGroup = marker.getObjectByName(this.sourceGroupName);
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
    if (collisionProxy) collisionProxy.userData[this.collisionProxyFlag] = true;
    marker.updateMatrix();
    const entries: BuildingBatchEntry[] = [];
    for (const source of sourceMeshes) {
      const allocation = this.getOrCreateGeometry(source);
      let instanceId: number;
      if (allocation.shared.instanced) {
        instanceId = this.addInstancedEntry(
          allocation.shared.instanced,
          marker.matrix,
          marker.visible,
        );
      } else {
        const geometryId = allocation.shared.geometryId;
        if (geometryId === null) {
          throw new Error('Packed building geometry lost both render allocations.');
        }
        this.ensureInstanceCapacity(allocation.record);
        instanceId = allocation.record.mesh.addInstance(geometryId);
        allocation.record.mesh.setMatrixAt(instanceId, marker.matrix);
        allocation.record.mesh.setVisibleAt(instanceId, marker.visible);
        allocation.record.activeInstances += 1;
      }
      allocation.shared.references += 1;
      const entry = {
        record: allocation.record,
        instanceId,
        shared: allocation.shared,
      };
      allocation.shared.entries.add(entry);
      if (allocation.shared.instanced) {
        allocation.shared.instanced.entries.push(entry);
      }
      entries.push(entry);
      source.removeFromParent();
      if (!allocation.adoptedSourceGeometry) source.geometry.dispose();
    }
    localBatchGroup.removeFromParent();
    this.buildingStates.set(buildingId, {
      entries,
      matrix: marker.matrix.clone(),
      collisionProxy,
      visible: marker.visible,
    });
    this.dirtyCapacity = true;
    this.dirtyDraws = true;
  }

  updateBuilding(
    buildingId: string,
    marker: THREE.Group,
    visible: boolean,
  ): void {
    this.spatialShadows?.setVisible(buildingId, visible);
    const state = this.buildingStates.get(buildingId);
    if (!state) return;
    marker.updateMatrix();
    const matrixChanged = !state.matrix.equals(marker.matrix);
    const visibilityChanged = state.visible !== visible;
    if (!matrixChanged && !visibilityChanged) return;
    this.dirtyDraws = true;
    const dirtyInstanced = new Set<InstancedGeometryRecord>();
    for (const entry of state.entries) {
      const instanced = entry.shared.instanced;
      if (instanced) {
        if ((matrixChanged && visible) || visibilityChanged) {
          instanced.mesh.setMatrixAt(
            entry.instanceId,
            visible ? marker.matrix : COLLAPSED_INSTANCE_MATRIX,
          );
          dirtyInstanced.add(instanced);
        }
      } else {
        if (matrixChanged) entry.record.mesh.setMatrixAt(entry.instanceId, marker.matrix);
        if (visibilityChanged) entry.record.mesh.setVisibleAt(entry.instanceId, visible);
      }
    }
    for (const instanced of dirtyInstanced) instanced.mesh.instanceMatrix.needsUpdate = true;
    if (dirtyInstanced.size > 0) this.dirtyInstanceBounds = true;
    if (matrixChanged) state.matrix.copy(marker.matrix);
    state.visible = visible;
  }

  setBuildingVisible(buildingId: string, visible: boolean): void {
    this.spatialShadows?.setVisible(buildingId, visible);
    const state = this.buildingStates.get(buildingId);
    if (!state || state.visible === visible) return;
    this.dirtyDraws = true;
    const dirtyInstanced = new Set<InstancedGeometryRecord>();
    for (const entry of state.entries) {
      const instanced = entry.shared.instanced;
      if (instanced) {
        instanced.mesh.setMatrixAt(
          entry.instanceId,
          visible ? state.matrix : COLLAPSED_INSTANCE_MATRIX,
        );
        dirtyInstanced.add(instanced);
      } else {
        entry.record.mesh.setVisibleAt(entry.instanceId, visible);
      }
    }
    for (const instanced of dirtyInstanced) instanced.mesh.instanceMatrix.needsUpdate = true;
    if (dirtyInstanced.size > 0) this.dirtyInstanceBounds = true;
    state.visible = visible;
  }

  removeBuilding(buildingId: string): void {
    this.stockInstances?.remove(buildingId);
    this.spatialShadows?.remove(buildingId);
    const state = this.buildingStates.get(buildingId);
    if (!state) return;
    this.buildingStates.delete(buildingId);
    this.dirtyDraws = true;
    state.collisionProxy?.removeFromParent();
    const touchedRecords = new Set<BuildingBatchRecord>();
    for (const entry of state.entries) {
      const { record, shared } = entry;
      touchedRecords.add(record);
      shared.entries.delete(entry);
      if (shared.instanced) {
        this.removeInstancedEntry(shared.instanced, entry);
      } else {
        record.mesh.deleteInstance(entry.instanceId);
        record.activeInstances -= 1;
      }
      shared.references -= 1;
      if (shared.references === 0) {
        if (shared.instanced) {
          shared.instanced.mesh.removeFromParent();
          shared.instanced.mesh.dispose();
          shared.instanced.mesh.geometry.dispose();
          shared.instanced = null;
        } else if (shared.geometryId !== null) {
          record.mesh.deleteGeometry(shared.geometryId);
        }
        removeSharedGeometry(record, shared);
      }
    }
    for (const record of touchedRecords) this.cleanupRecord(record);
    this.dirtyCapacity = true;
  }

  finalizeGeometryBuffers(): void {
    this.stockInstances?.flush();
    this.spatialShadows?.flush();
    if (!this.dirtyCapacity && !this.dirtyInstanceBounds && !this.dirtyDraws) return;
    const compactGeometry = this.dirtyCapacity;
    this.dirtyCapacity = false;
    for (const record of this.records()) {
      if (record.activeInstances === 0) {
        record.mesh.removeFromParent();
      } else if (compactGeometry) {
        if (record.mesh.parent !== this.group) this.group.add(record.mesh);
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
    if (this.dirtyInstanceBounds) {
      this.dirtyInstanceBounds = false;
      for (const instanced of this.instancedRecords()) {
        instanced.mesh.computeBoundingBox();
        instanced.mesh.computeBoundingSphere();
      }
    }
    if (this.dirtyDraws && this.mergedDraws) this.rebuildMergedDraws();
    this.dirtyDraws = false;
  }

  private rebuildMergedDraws(): void {
    const parts: StaticGeometryPart[] = [];
    const geometries = new Map<SharedPackedGeometry, THREE.BufferGeometry>();
    for (const state of this.buildingStates.values()) {
      if (!state.visible) continue;
      for (const entry of state.entries) {
        if (entry.shared.instanced || entry.shared.geometryId === null) continue;
        let geometry = geometries.get(entry.shared);
        if (!geometry) {
          geometry = extractBatchedGeometry(entry.record.mesh, entry.shared.geometryId);
          geometries.set(entry.shared, geometry);
        }
        parts.push({ source: entry.record.mesh, geometry, matrix: state.matrix });
      }
    }
    this.mergedDraws!.rebuild(parts);
    for (const geometry of geometries.values()) geometry.dispose();
    for (const record of this.records()) record.mesh.visible = false;
  }

  getStats(): BuildingStaticBatchStats {
    let renderObjects = 0;
    let nativeDrawCommands = 0;
    let instances = 0;
    let instancedDraws = 0;
    let uniqueGeometries = 0;
    let geometryBytes = 0;
    for (const record of this.records()) {
      if (record.activeInstances > 0) {
        renderObjects += this.mergedDraws ? 0 : 1;
        nativeDrawCommands += this.mergedDraws ? 0 : record.activeInstances;
        instances += record.activeInstances;
        geometryBytes += bufferGeometryBytes(record.mesh.geometry);
      }
      for (const geometries of record.geometriesByFingerprint.values()) {
        uniqueGeometries += geometries.length;
        for (const shared of geometries) {
          const instanced = shared.instanced;
          if (!instanced) continue;
          renderObjects += 1;
          nativeDrawCommands += 1;
          instancedDraws += 1;
          instances += instanced.entries.length;
          geometryBytes += bufferGeometryBytes(instanced.mesh.geometry);
        }
      }
    }
    if (this.mergedDraws) {
      renderObjects += this.mergedDraws.group.children.length;
      nativeDrawCommands += this.mergedDraws.group.children.length;
      for (const mesh of this.mergedDraws.group.children) geometryBytes += bufferGeometryBytes((mesh as THREE.Mesh).geometry);
    }
    return {
      renderObjects,
      nativeDrawCommands,
      instances,
      instancedDraws,
      uniqueGeometries,
      geometryBytes,
    };
  }

  dispose(): void {
    this.stockInstances?.dispose();
    this.spatialShadows?.dispose();
    this.mergedDraws?.dispose();
    for (const state of this.buildingStates.values()) {
      state.collisionProxy?.removeFromParent();
    }
    for (const record of this.records()) {
      record.mesh.dispose();
      for (const geometries of record.geometriesByFingerprint.values()) {
        for (const shared of geometries) {
          shared.instanced?.mesh.dispose();
          shared.instanced?.mesh.geometry.dispose();
        }
      }
    }
    this.batches.clear();
    this.buildingStates.clear();
    this.collisionProxyGeometry.dispose();
    this.collisionProxyMaterial.dispose();
    this.group.removeFromParent();
  }

  private getOrCreateGeometry(
    source: THREE.Mesh<THREE.BufferGeometry, THREE.Material>,
  ): {
    record: BuildingBatchRecord;
    shared: SharedPackedGeometry;
    adoptedSourceGeometry: boolean;
  } {
    const key = buildingBatchKey(source);
    const fingerprint = geometryFingerprint(source.geometry);
    const records = this.batches.get(key) ?? [];
    for (const record of records) {
      for (const shared of record.geometriesByFingerprint.get(fingerprint) ?? []) {
        const equal = shared.instanced
          ? geometryEqualsGeometry(source.geometry, shared.instanced.mesh.geometry)
          : shared.geometryId !== null
            && geometryEqualsPacked(source.geometry, record.mesh, shared.geometryId);
        if (!equal) continue;
        if (!shared.instanced) {
          this.promoteSharedGeometry(record, shared, source.geometry);
          return { record, shared, adoptedSourceGeometry: true };
        }
        return { record, shared, adoptedSourceGeometry: false };
      }
    }

    const position = source.geometry.getAttribute('position');
    const indexed = source.geometry.index !== null;
    let record: BuildingBatchRecord | undefined;
    for (let index = records.length - 1; index >= 0; index -= 1) {
      const candidate = records[index]!;
      const usedVertices = candidate.vertexCapacity
        - candidate.mesh.unusedVertexCount;
      if (!indexed || usedVertices + position.count <= 65_535) {
        record = candidate;
        break;
      }
    }
    if (!record) {
      record = this.createBatchRecord(source, key);
      records.push(record);
      this.batches.set(key, records);
    }
    if (record.mesh.parent !== this.group) this.group.add(record.mesh);
    this.ensureGeometryCapacity(record, source.geometry);
    const geometryId = record.mesh.addGeometry(source.geometry);
    const shared: SharedPackedGeometry = {
      geometryId,
      references: 0,
      instanced: null,
      entries: new Set(),
    };
    const geometries = record.geometriesByFingerprint.get(fingerprint) ?? [];
    geometries.push(shared);
    record.geometriesByFingerprint.set(fingerprint, geometries);
    return { record, shared, adoptedSourceGeometry: false };
  }

  private createBatchRecord(
    source: THREE.Mesh<THREE.BufferGeometry, THREE.Material>,
    key: string,
  ): BuildingBatchRecord {
    const position = source.geometry.getAttribute('position');
    const indexed = source.geometry.index !== null;
    const vertexCapacity = position.count;
    const indexCapacity = source.geometry.index?.count ?? 0;
    const mesh = new THREE.BatchedMesh(
      8,
      vertexCapacity,
      indexed ? indexCapacity : undefined,
      source.material,
    );
    mesh.name = `Cross-building static batch ${this.batchCount() + 1}`;
    mesh.castShadow = source.castShadow;
    mesh.receiveShadow = source.receiveShadow;
    mesh.renderOrder = source.renderOrder;
    mesh.frustumCulled = false;
    mesh.perObjectFrustumCulled = source.frustumCulled;
    mesh.layers.mask = source.layers.mask;
    mesh.customDepthMaterial = source.customDepthMaterial;
    mesh.customDistanceMaterial = source.customDistanceMaterial;
    mesh.userData.crossBuildingStaticBatch = true;
    this.group.add(mesh);
    return {
      key,
      mesh,
      indexed,
      vertexCapacity,
      indexCapacity,
      activeInstances: 0,
      geometriesByFingerprint: new Map(),
    };
  }

  private ensureGeometryCapacity(
    record: BuildingBatchRecord,
    geometry: THREE.BufferGeometry,
  ): void {
    const requiredVertices = geometry.getAttribute('position').count;
    const requiredIndices = geometry.index?.count ?? 0;
    let vertexCapacity = record.vertexCapacity;
    let indexCapacity = record.indexCapacity;
    if (record.mesh.unusedVertexCount < requiredVertices) {
      vertexCapacity = Math.min(
        record.indexed ? 65_535 : Number.MAX_SAFE_INTEGER,
        Math.max(
          record.vertexCapacity + requiredVertices,
          Math.ceil(record.vertexCapacity * 1.5),
        ),
      );
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
  }

  private ensureInstanceCapacity(record: BuildingBatchRecord): void {
    if (record.activeInstances < record.mesh.maxInstanceCount) return;
    resizeBatchedMeshInstances(record.mesh, Math.max(
      record.activeInstances + 1,
      record.mesh.maxInstanceCount * 2,
    ));
  }

  private promoteSharedGeometry(
    record: BuildingBatchRecord,
    shared: SharedPackedGeometry,
    geometry: THREE.BufferGeometry,
  ): void {
    const geometryId = shared.geometryId;
    if (geometryId === null || shared.instanced) return;
    const entries = [...shared.entries];
    const instanced: InstancedGeometryRecord = {
      mesh: createInstancedBatchMesh(record.mesh, geometry, Math.max(8, entries.length + 1)),
      capacity: Math.max(8, entries.length + 1),
      entries: [],
    };
    const matrix = new THREE.Matrix4();
    for (const entry of entries) {
      record.mesh.getMatrixAt(entry.instanceId, matrix);
      const visible = record.mesh.getVisibleAt(entry.instanceId);
      record.mesh.deleteInstance(entry.instanceId);
      record.activeInstances -= 1;
      const instanceId = instanced.entries.length;
      instanced.mesh.setMatrixAt(
        instanceId,
        visible ? matrix : COLLAPSED_INSTANCE_MATRIX,
      );
      entry.instanceId = instanceId;
      instanced.entries.push(entry);
    }
    instanced.mesh.count = entries.length;
    instanced.mesh.instanceMatrix.needsUpdate = true;
    record.mesh.deleteGeometry(geometryId);
    shared.geometryId = null;
    shared.instanced = instanced;
    this.group.add(instanced.mesh);
    if (record.activeInstances === 0) record.mesh.removeFromParent();
    this.dirtyCapacity = true;
    this.dirtyInstanceBounds = true;
  }

  private addInstancedEntry(
    instanced: InstancedGeometryRecord,
    matrix: THREE.Matrix4,
    visible: boolean,
  ): number {
    this.ensureInstancedCapacity(instanced);
    const instanceId = instanced.entries.length;
    instanced.mesh.setMatrixAt(
      instanceId,
      visible ? matrix : COLLAPSED_INSTANCE_MATRIX,
    );
    instanced.mesh.count = instanceId + 1;
    instanced.mesh.instanceMatrix.needsUpdate = true;
    this.dirtyInstanceBounds = true;
    return instanceId;
  }

  private ensureInstancedCapacity(instanced: InstancedGeometryRecord): void {
    if (instanced.entries.length < instanced.capacity) return;
    const capacity = instanced.capacity * 2;
    const replacement = createInstancedBatchMesh(
      instanced.mesh,
      instanced.mesh.geometry,
      capacity,
    );
    const matrix = new THREE.Matrix4();
    for (let index = 0; index < instanced.entries.length; index += 1) {
      instanced.mesh.getMatrixAt(index, matrix);
      replacement.setMatrixAt(index, matrix);
    }
    replacement.count = instanced.entries.length;
    replacement.instanceMatrix.needsUpdate = true;
    instanced.mesh.removeFromParent();
    instanced.mesh.dispose();
    instanced.mesh = replacement;
    instanced.capacity = capacity;
    this.group.add(replacement);
  }

  private removeInstancedEntry(
    instanced: InstancedGeometryRecord,
    entry: BuildingBatchEntry,
  ): void {
    const index = entry.instanceId;
    const lastIndex = instanced.entries.length - 1;
    if (index < 0 || index > lastIndex) return;
    if (index !== lastIndex) {
      const matrix = new THREE.Matrix4();
      instanced.mesh.getMatrixAt(lastIndex, matrix);
      instanced.mesh.setMatrixAt(index, matrix);
      const moved = instanced.entries[lastIndex]!;
      instanced.entries[index] = moved;
      moved.instanceId = index;
      instanced.mesh.instanceMatrix.needsUpdate = true;
    }
    instanced.entries.pop();
    instanced.mesh.count = lastIndex;
    this.dirtyInstanceBounds = true;
  }

  private cleanupRecord(record: BuildingBatchRecord): void {
    if (record.activeInstances > 0) return;
    record.mesh.removeFromParent();
    let retainedSharedGeometry = false;
    for (const geometries of record.geometriesByFingerprint.values()) {
      if (geometries.length > 0) {
        retainedSharedGeometry = true;
        break;
      }
    }
    if (retainedSharedGeometry) return;
    record.mesh.dispose();
    const records = this.batches.get(record.key);
    if (!records) return;
    const index = records.indexOf(record);
    if (index >= 0) records.splice(index, 1);
    if (records.length === 0) this.batches.delete(record.key);
  }

  private *records(): Generator<BuildingBatchRecord> {
    for (const records of this.batches.values()) yield* records;
  }

  private *instancedRecords(): Generator<InstancedGeometryRecord> {
    for (const record of this.records()) {
      for (const geometries of record.geometriesByFingerprint.values()) {
        for (const shared of geometries) {
          if (shared.instanced) yield shared.instanced;
        }
      }
    }
  }

  private batchCount(): number {
    let count = 0;
    for (const records of this.batches.values()) count += records.length;
    return count;
  }
}

function buildingBatchKey(
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>,
): string {
  return [
    mesh.material.uuid,
    mesh.castShadow ? 1 : 0,
    mesh.receiveShadow ? 1 : 0,
    mesh.renderOrder,
    mesh.frustumCulled ? 1 : 0,
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
        (attribute as THREE.BufferAttribute).gpuType,
      ].join(':'))
      .join(','),
  ].join('|');
}

export function geometryFingerprint(geometry: THREE.BufferGeometry): string {
  let hash = 0x811c9dc5;
  let bytes = 0;
  const include = (array: ArrayLike<number> & ArrayBufferView): void => {
    const view = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    bytes += view.byteLength;
    const wordCount = Math.floor(view.byteLength / 4);
    if (wordCount > 0 && view.byteOffset % 4 === 0) {
      const words = new Uint32Array(view.buffer, view.byteOffset, wordCount);
      for (let index = 0; index < words.length; index += 1) {
        hash ^= words[index]!;
        hash = Math.imul(hash, 0x01000193);
      }
    } else if (wordCount > 0) {
      const words = new DataView(view.buffer, view.byteOffset, wordCount * 4);
      for (let index = 0; index < wordCount; index += 1) {
        hash ^= words.getUint32(index * 4, true);
        hash = Math.imul(hash, 0x01000193);
      }
    }
    for (let index = wordCount * 4; index < view.length; index += 1) {
      hash ^= view[index]!;
      hash = Math.imul(hash, 0x01000193);
    }
  };
  if (geometry.index) include(geometry.index.array);
  for (const [, attribute] of Object.entries(geometry.attributes).sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    include(attribute.array);
  }
  return `${bytes}:${(hash >>> 0).toString(16)}`;
}

function geometryEqualsPacked(
  source: THREE.BufferGeometry,
  packedMesh: THREE.BatchedMesh,
  geometryId: number,
): boolean {
  const range = packedMesh.getGeometryRangeAt(geometryId);
  if (!range) return false;
  const sourcePosition = source.getAttribute('position');
  if (range.vertexCount !== sourcePosition.count) return false;
  const packed = packedMesh.geometry;
  for (const [name, sourceAttribute] of Object.entries(source.attributes)) {
    const packedAttribute = packed.getAttribute(name);
    if (!packedAttribute) return false;
    const itemOffset = range.vertexStart * sourceAttribute.itemSize;
    const itemCount = range.vertexCount * sourceAttribute.itemSize;
    if (!arrayRangeEquals(
      sourceAttribute.array,
      packedAttribute.array,
      itemOffset,
      itemCount,
    )) return false;
  }
  const sourceIndex = source.index;
  const packedIndex = packed.index;
  if (!sourceIndex || !packedIndex) return sourceIndex === packedIndex;
  if (range.indexCount !== sourceIndex.count) return false;
  for (let index = 0; index < range.indexCount; index += 1) {
    if (
      Number(packedIndex.array[range.indexStart + index]) - range.vertexStart
      !== Number(sourceIndex.array[index])
    ) return false;
  }
  return true;
}

export function geometryEqualsGeometry(
  left: THREE.BufferGeometry,
  right: THREE.BufferGeometry,
): boolean {
  const leftNames = Object.keys(left.attributes).sort();
  const rightNames = Object.keys(right.attributes).sort();
  if (leftNames.length !== rightNames.length) return false;
  for (let index = 0; index < leftNames.length; index += 1) {
    const name = leftNames[index]!;
    if (name !== rightNames[index]) return false;
    const leftAttribute = left.getAttribute(name);
    const rightAttribute = right.getAttribute(name);
    if (
      !rightAttribute
      || leftAttribute.itemSize !== rightAttribute.itemSize
      || leftAttribute.normalized !== rightAttribute.normalized
      || leftAttribute.array.constructor !== rightAttribute.array.constructor
      || !arrayRangeEquals(leftAttribute.array, rightAttribute.array, 0, leftAttribute.array.length)
    ) return false;
  }
  const leftIndex = left.index;
  const rightIndex = right.index;
  if (!leftIndex || !rightIndex) return leftIndex === rightIndex;
  return leftIndex.array.constructor === rightIndex.array.constructor
    && arrayRangeEquals(leftIndex.array, rightIndex.array, 0, leftIndex.array.length);
}

function arrayRangeEquals(
  source: ArrayLike<number>,
  packed: ArrayLike<number>,
  packedOffset: number,
  count: number,
): boolean {
  if (source.length !== count) return false;
  for (let index = 0; index < count; index += 1) {
    if (source[index] !== packed[packedOffset + index]) return false;
  }
  return true;
}

function removeSharedGeometry(
  record: BuildingBatchRecord,
  shared: SharedPackedGeometry,
): void {
  for (const [fingerprint, geometries] of record.geometriesByFingerprint) {
    const index = geometries.indexOf(shared);
    if (index < 0) continue;
    geometries.splice(index, 1);
    if (geometries.length === 0) {
      record.geometriesByFingerprint.delete(fingerprint);
    }
    return;
  }
}

function createInstancedBatchMesh(
  source: THREE.Mesh<THREE.BufferGeometry, THREE.Material>,
  geometry: THREE.BufferGeometry,
  capacity: number,
): THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material> {
  const mesh = new THREE.InstancedMesh(geometry, source.material, capacity);
  mesh.name = 'Cross-building identical-geometry instances';
  mesh.count = 0;
  mesh.castShadow = source.castShadow;
  mesh.receiveShadow = source.receiveShadow;
  mesh.renderOrder = source.renderOrder;
  mesh.frustumCulled = source instanceof THREE.BatchedMesh
    ? source.perObjectFrustumCulled
    : source.frustumCulled;
  mesh.layers.mask = source.layers.mask;
  mesh.customDepthMaterial = source.customDepthMaterial;
  mesh.customDistanceMaterial = source.customDistanceMaterial;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.userData.crossBuildingIdenticalGeometryInstances = true;
  return mesh;
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
  proxy.name = 'Building collision geometry proxy';
  proxy.position.copy(center);
  proxy.scale.copy(size);
  proxy.castShadow = false;
  proxy.receiveShadow = false;
  proxy.userData.buildingStaticCollisionProxy = true;
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
