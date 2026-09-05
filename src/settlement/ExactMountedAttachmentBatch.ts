import * as THREE from 'three';
import { authoredGpuObservedMounts } from '../scene/AuthoredGpuAnimation.ts';

export const EXACT_MOUNTED_ATTACHMENT_INITIAL_CAPACITY = 8;

export type ExactMountedAttachmentBatchOptions = {
  initialCapacity?: number;
  name?: string;
};

export type ExactMountedAttachmentBatchDiagnostic = {
  registeredTools: number;
  registeredMounts: number;
  sourceMeshCount: number;
  sourceLineCount: number;
  sourceRenderableCount: number;
  hiddenSourceRenderableCount: number;
  visibleMeshInstances: number;
  visibleLineInstances: number;
  visibleLineSegments: number;
  submittedMeshVertices: number;
  submittedMeshTriangles: number;
  meshBatches: number;
  lineBatches: number;
  activeDrawCalls: number;
  meshInstanceCapacity: number;
  lineSegmentCapacity: number;
  resizeCount: number;
  overflowCount: number;
  omittedRenderableCount: number;
  sourceGeometryIdentityPreserved: boolean;
  sourceMaterialIdentityPreserved: boolean;
  sourceLineTopologyPreserved: boolean;
};

export type ExactMountedAttachmentRegistration = {
  readonly toolRoot: THREE.Object3D;
  readonly mounts: readonly THREE.Object3D[];
  unregister(): void;
};

type RegistrationState = {
  publicHandle: ExactMountedAttachmentRegistration;
  toolRoot: THREE.Object3D;
  mounts: THREE.Object3D[];
  meshParts: MeshPart[];
  lineParts: LinePart[];
  active: boolean;
};

type MeshPart = {
  registration: RegistrationState;
  mount: THREE.Object3D;
  source: THREE.Mesh;
  sourceVisible: boolean;
  batch: MeshBatch;
};

type MeshBatch = {
  key: string;
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  mesh: THREE.InstancedMesh;
  parts: MeshPart[];
  capacity: number;
};

type LinePart = {
  registration: RegistrationState;
  mount: THREE.Object3D;
  source: THREE.Line;
  sourceVisible: boolean;
  pairs: readonly (readonly [number, number])[];
  batch: LineBatch;
};

type LineBatch = {
  key: string;
  material: THREE.Material;
  line: THREE.LineSegments;
  geometry: THREE.BufferGeometry;
  position: THREE.BufferAttribute;
  parts: LinePart[];
  segmentCapacity: number;
};

/**
 * Batches the exact rigid equipment already mounted to animated rig bones.
 *
 * The source rig may itself be hidden: only visibility from the mount root
 * downward participates in submission. This lets an exact CPU pose rig drive
 * a separately batched authored body and its equipment without making the
 * source rig visible. Combat stance and dropped-weapon state remain owned by
 * the existing mount Groups and are sampled every frame.
 *
 * No source geometry, material, texture, scale, or bone transform is replaced.
 * Meshes become InstancedMesh submissions keyed by their borrowed source
 * geometry/material identity. Bow and crossbow Line paths are copied exactly
 * into one dynamic LineSegments stream per borrowed line material.
 */
export class ExactMountedAttachmentBatch {
  readonly group = new THREE.Group();

  private readonly initialCapacity: number;
  private readonly registrations = new Set<RegistrationState>();
  private readonly registrationByTool = new WeakMap<THREE.Object3D, RegistrationState>();
  private readonly renderableOwner = new WeakMap<THREE.Object3D, RegistrationState>();
  private readonly meshBatches = new Map<string, MeshBatch>();
  private readonly lineBatches = new Map<string, LineBatch>();
  private readonly worldToBatch = new THREE.Matrix4();
  private readonly localMatrix = new THREE.Matrix4();
  private readonly point = new THREE.Vector3();
  private resizeCount = 0;

  constructor(
    parent: THREE.Object3D,
    options: ExactMountedAttachmentBatchOptions = {},
  ) {
    this.initialCapacity = Math.max(
      1,
      Math.floor(options.initialCapacity ?? EXACT_MOUNTED_ATTACHMENT_INITIAL_CAPACITY),
    );
    this.group.name = options.name ?? 'Exact mounted attachment batches';
    this.group.matrixAutoUpdate = true;
    this.group.userData.exactMountedAttachmentBatch = true;
    parent.add(this.group);
  }

  /**
   * Idempotently registers one pooled tool root. Military roots expose all
   * independently bone-mounted Groups through `workerToolMounts`; ordinary
   * worker tools simply use their root. Reassigning the owning rig or moving
   * it between bones needs no re-registration.
   */
  registerTool(toolRoot: THREE.Object3D): ExactMountedAttachmentRegistration {
    const existing = this.registrationByTool.get(toolRoot);
    if (existing?.active) return existing.publicHandle;

    const mounts = resolveMounts(toolRoot);
    let state!: RegistrationState;
    const handle: ExactMountedAttachmentRegistration = {
      toolRoot,
      mounts,
      unregister: () => this.unregisterTool(toolRoot),
    };
    state = {
      publicHandle: handle,
      toolRoot,
      mounts: [...mounts],
      meshParts: [],
      lineParts: [],
      active: true,
    };

    const staged: Array<{ object: THREE.Object3D; visible: boolean }> = [];
    const visited = new Set<THREE.Object3D>();
    try {
      for (const mount of mounts) {
        mount.traverse((object) => {
          if (visited.has(object)) return;
          const line = object as THREE.Line;
          const mesh = object as THREE.Mesh;
          if (!line.isLine && !mesh.isMesh) return;
          visited.add(object);
          const owner = this.renderableOwner.get(object);
          if (owner?.active) {
            throw new Error(
              `Mounted attachment renderable ${object.name || object.uuid} is already registered.`,
            );
          }
          this.assertRigidRenderable(object);
          staged.push({ object, visible: object.visible });
          if (line.isLine) this.registerLine(state, mount, line, object.visible);
          else this.registerMesh(state, mount, mesh, object.visible);
          this.renderableOwner.set(object, state);
          object.visible = false;
        });
      }
    } catch (error) {
      this.removeStateParts(state);
      for (const entry of staged) {
        entry.object.visible = entry.visible;
        this.renderableOwner.delete(entry.object);
      }
      throw error;
    }

    this.registrations.add(state);
    this.registrationByTool.set(toolRoot, state);
    return handle;
  }

  unregisterTool(toolRoot: THREE.Object3D): boolean {
    const state = this.registrationByTool.get(toolRoot);
    if (!state?.active) return false;
    state.active = false;
    for (const part of state.meshParts) {
      part.source.visible = part.sourceVisible;
      this.renderableOwner.delete(part.source);
    }
    for (const part of state.lineParts) {
      part.source.visible = part.sourceVisible;
      this.renderableOwner.delete(part.source);
    }
    this.removeStateParts(state);
    this.registrations.delete(state);
    this.registrationByTool.delete(toolRoot);
    return true;
  }

  hasTool(toolRoot: THREE.Object3D): boolean {
    return this.registrationByTool.get(toolRoot)?.active === true;
  }

  /**
   * Updates every visible prefix. Passing the crowd-parent world inverse saves
   * a redundant inversion when several crowd batches share that parent. When
   * omitted, the inverse of this batch Group is derived directly.
   */
  update(batchParentWorldInverse?: THREE.Matrix4): void {
    if (batchParentWorldInverse) {
      this.group.updateMatrix();
      // groupWorld = parentWorld * groupLocal, therefore
      // groupWorld^-1 = groupLocal^-1 * parentWorld^-1.
      this.worldToBatch.copy(this.group.matrix).invert().multiply(batchParentWorldInverse);
    } else {
      this.group.updateWorldMatrix(true, false);
      this.worldToBatch.copy(this.group.matrixWorld).invert();
    }

    // Updating mount roots with parents=true keeps pooled/reparented rigs safe,
    // even when their visual root is deliberately hidden.
    for (const registration of this.registrations) {
      for (const mount of registration.mounts) {
        if (!authoredGpuObservedMounts.has(mount)) mount.updateWorldMatrix(true, true);
      }
    }

    for (const batch of this.meshBatches.values()) this.updateMeshBatch(batch);
    for (const batch of this.lineBatches.values()) this.updateLineBatch(batch);
  }

  clear(): void {
    for (const state of [...this.registrations]) this.unregisterTool(state.toolRoot);
    this.commitEmptyPrefixes();
  }

  diagnostics(): ExactMountedAttachmentBatchDiagnostic {
    let registeredMounts = 0;
    let sourceMeshCount = 0;
    let sourceLineCount = 0;
    let hiddenSourceRenderableCount = 0;
    let visibleMeshInstances = 0;
    let visibleLineInstances = 0;
    let visibleLineSegments = 0;
    let submittedMeshVertices = 0;
    let submittedMeshTriangles = 0;
    let activeDrawCalls = 0;
    let meshInstanceCapacity = 0;
    let lineSegmentCapacity = 0;
    let sourceGeometryIdentityPreserved = true;
    let sourceMaterialIdentityPreserved = true;
    let sourceLineTopologyPreserved = true;

    for (const state of this.registrations) {
      registeredMounts += state.mounts.length;
      sourceMeshCount += state.meshParts.length;
      sourceLineCount += state.lineParts.length;
      for (const part of state.meshParts) if (!part.source.visible) hiddenSourceRenderableCount += 1;
      for (const part of state.lineParts) if (!part.source.visible) hiddenSourceRenderableCount += 1;
    }
    for (const batch of this.meshBatches.values()) {
      meshInstanceCapacity += batch.capacity;
      visibleMeshInstances += batch.mesh.count;
      const sourceVertexCount = batch.geometry.getAttribute('position').count;
      const sourceTriangleCount = Math.floor((
        batch.geometry.index?.count ?? sourceVertexCount
      ) / 3);
      submittedMeshVertices += sourceVertexCount * batch.mesh.count;
      submittedMeshTriangles += sourceTriangleCount * batch.mesh.count;
      if (batch.mesh.count > 0) activeDrawCalls += 1;
      sourceGeometryIdentityPreserved &&= batch.mesh.geometry === batch.geometry;
      sourceMaterialIdentityPreserved &&= sameMaterialIdentity(batch.mesh.material, batch.material);
      for (const part of batch.parts) {
        sourceGeometryIdentityPreserved &&= part.source.geometry === batch.geometry;
        sourceMaterialIdentityPreserved &&= sameMaterialIdentity(part.source.material, batch.material);
      }
    }
    for (const batch of this.lineBatches.values()) {
      lineSegmentCapacity += batch.segmentCapacity;
      const submittedSegments = Math.floor(batch.geometry.drawRange.count / 2);
      visibleLineSegments += submittedSegments;
      if (submittedSegments > 0) activeDrawCalls += 1;
      sourceMaterialIdentityPreserved &&= batch.line.material === batch.material;
      for (const part of batch.parts) {
        if (isPartVisible(part)) visibleLineInstances += 1;
        sourceLineTopologyPreserved &&= part.pairs.every(([left, right]) => (
          left >= 0
          && right >= 0
          && left < (part.source.geometry.getAttribute('position')?.count ?? 0)
          && right < (part.source.geometry.getAttribute('position')?.count ?? 0)
        ));
        sourceMaterialIdentityPreserved &&= part.source.material === batch.material;
      }
    }

    return {
      registeredTools: this.registrations.size,
      registeredMounts,
      sourceMeshCount,
      sourceLineCount,
      sourceRenderableCount: sourceMeshCount + sourceLineCount,
      hiddenSourceRenderableCount,
      visibleMeshInstances,
      visibleLineInstances,
      visibleLineSegments,
      submittedMeshVertices,
      submittedMeshTriangles,
      meshBatches: this.meshBatches.size,
      lineBatches: this.lineBatches.size,
      activeDrawCalls,
      meshInstanceCapacity,
      lineSegmentCapacity,
      resizeCount: this.resizeCount,
      overflowCount: 0,
      omittedRenderableCount: 0,
      sourceGeometryIdentityPreserved,
      sourceMaterialIdentityPreserved,
      sourceLineTopologyPreserved,
    };
  }

  dispose(): void {
    this.clear();
    for (const batch of this.meshBatches.values()) {
      batch.mesh.removeFromParent();
      batch.mesh.dispose();
    }
    for (const batch of this.lineBatches.values()) {
      batch.line.removeFromParent();
      batch.geometry.dispose();
    }
    this.meshBatches.clear();
    this.lineBatches.clear();
    this.group.removeFromParent();
  }

  private registerMesh(
    registration: RegistrationState,
    mount: THREE.Object3D,
    source: THREE.Mesh,
    sourceVisible: boolean,
  ): void {
    const key = meshBatchKey(source);
    let batch = this.meshBatches.get(key);
    if (!batch) {
      batch = this.createMeshBatch(key, source, this.initialCapacity);
      this.meshBatches.set(key, batch);
    }
    const part: MeshPart = { registration, mount, source, sourceVisible, batch };
    batch.parts.push(part);
    registration.meshParts.push(part);
    if (batch.parts.length > batch.capacity) this.resizeMeshBatch(batch, batch.parts.length);
  }

  private registerLine(
    registration: RegistrationState,
    mount: THREE.Object3D,
    source: THREE.Line,
    sourceVisible: boolean,
  ): void {
    if (Array.isArray(source.material)) {
      throw new Error('Exact mounted line batching refuses multi-material lines.');
    }
    const pairs = lineSegmentPairs(source);
    const key = lineBatchKey(source);
    let batch = this.lineBatches.get(key);
    if (!batch) {
      batch = this.createLineBatch(key, source.material, this.initialCapacity * 2, source);
      this.lineBatches.set(key, batch);
    }
    const part: LinePart = { registration, mount, source, sourceVisible, pairs, batch };
    batch.parts.push(part);
    registration.lineParts.push(part);
  }

  private assertRigidRenderable(object: THREE.Object3D): void {
    const mesh = object as THREE.Mesh;
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
      throw new Error('Exact mounted attachment batching only accepts rigid bone-mounted meshes.');
    }
    if ((mesh as THREE.InstancedMesh).isInstancedMesh) {
      throw new Error('Nested InstancedMesh attachments require an exact flattening path.');
    }
    if (mesh.isMesh && Object.keys(mesh.geometry.morphAttributes).length > 0) {
      throw new Error('Exact mounted attachment batching refuses to discard authored morph targets.');
    }
    const geometry = (object as THREE.Line | THREE.Mesh).geometry;
    if (!geometry?.getAttribute('position')) {
      throw new Error(`Mounted attachment ${object.name || object.uuid} has no position attribute.`);
    }
  }

  private createMeshBatch(key: string, source: THREE.Mesh, capacity: number): MeshBatch {
    const mesh = new THREE.InstancedMesh(source.geometry, source.material, capacity);
    configureMeshBatchObject(mesh, source, this.group.name);
    this.group.add(mesh);
    return {
      key,
      geometry: source.geometry,
      material: source.material,
      mesh,
      parts: [],
      capacity,
    };
  }

  private resizeMeshBatch(batch: MeshBatch, required: number): void {
    const capacity = grownCapacity(batch.capacity, required);
    const replacement = new THREE.InstancedMesh(batch.geometry, batch.material, capacity);
    configureMeshBatchObject(replacement, batch.mesh, this.group.name);
    replacement.count = batch.mesh.count;
    const previous = batch.mesh.instanceMatrix.array as Float32Array;
    const next = replacement.instanceMatrix.array as Float32Array;
    next.set(previous.subarray(0, Math.min(previous.length, next.length)));
    replacement.instanceMatrix.needsUpdate = batch.mesh.count > 0;
    this.group.add(replacement);
    batch.mesh.removeFromParent();
    batch.mesh.dispose();
    batch.mesh = replacement;
    batch.capacity = capacity;
    this.resizeCount += 1;
  }

  private createLineBatch(
    key: string,
    material: THREE.Material,
    segmentCapacity: number,
    source: THREE.Line,
  ): LineBatch {
    const geometry = new THREE.BufferGeometry();
    const position = new THREE.BufferAttribute(new Float32Array(segmentCapacity * 6), 3);
    position.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', position);
    geometry.setDrawRange(0, 0);
    const line = new THREE.LineSegments(geometry, material);
    line.name = `${this.group.name} · exact line paths · ${material.name || material.uuid}`;
    line.castShadow = source.castShadow;
    line.receiveShadow = source.receiveShadow;
    line.renderOrder = source.renderOrder;
    line.frustumCulled = false;
    line.visible = false;
    line.layers.mask = source.layers.mask;
    line.userData.exactMountedAttachmentBatch = true;
    line.userData.sourceMaterialUuid = material.uuid;
    this.group.add(line);
    return { key, material, line, geometry, position, parts: [], segmentCapacity };
  }

  private resizeLineBatch(batch: LineBatch, requiredSegments: number): void {
    const segmentCapacity = grownCapacity(batch.segmentCapacity, requiredSegments);
    const position = new THREE.BufferAttribute(new Float32Array(segmentCapacity * 6), 3);
    position.setUsage(THREE.DynamicDrawUsage);
    batch.geometry.setAttribute('position', position);
    batch.position = position;
    batch.segmentCapacity = segmentCapacity;
    this.resizeCount += 1;
  }

  private updateMeshBatch(batch: MeshBatch): void {
    let count = 0;
    for (const part of batch.parts) if (isPartVisible(part)) count += 1;
    if (count > batch.capacity) this.resizeMeshBatch(batch, count);
    let cursor = 0;
    for (const part of batch.parts) {
      if (!isPartVisible(part)) continue;
      this.localMatrix.multiplyMatrices(this.worldToBatch, part.source.matrixWorld);
      batch.mesh.setMatrixAt(cursor, this.localMatrix);
      cursor += 1;
    }
    batch.mesh.count = cursor;
    batch.mesh.visible = cursor > 0;
    if (cursor > 0) {
      batch.mesh.instanceMatrix.clearUpdateRanges();
      batch.mesh.instanceMatrix.addUpdateRange(0, cursor * 16);
      batch.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  private updateLineBatch(batch: LineBatch): void {
    let requiredSegments = 0;
    for (const part of batch.parts) {
      if (isPartVisible(part)) requiredSegments += part.pairs.length;
    }
    if (requiredSegments > batch.segmentCapacity) this.resizeLineBatch(batch, requiredSegments);
    const output = batch.position.array as Float32Array;
    let component = 0;
    let visibleLines = 0;
    for (const part of batch.parts) {
      if (!isPartVisible(part)) continue;
      visibleLines += 1;
      this.localMatrix.multiplyMatrices(this.worldToBatch, part.source.matrixWorld);
      const position = part.source.geometry.getAttribute('position');
      for (const [left, right] of part.pairs) {
        this.point.set(position.getX(left), position.getY(left), position.getZ(left));
        this.point.applyMatrix4(this.localMatrix);
        output[component++] = this.point.x;
        output[component++] = this.point.y;
        output[component++] = this.point.z;
        this.point.set(position.getX(right), position.getY(right), position.getZ(right));
        this.point.applyMatrix4(this.localMatrix);
        output[component++] = this.point.x;
        output[component++] = this.point.y;
        output[component++] = this.point.z;
      }
    }
    const vertexCount = component / 3;
    batch.geometry.setDrawRange(0, vertexCount);
    batch.line.visible = visibleLines > 0;
    if (vertexCount > 0) {
      batch.position.clearUpdateRanges();
      batch.position.addUpdateRange(0, component);
      batch.position.needsUpdate = true;
    }
  }

  private removeStateParts(state: RegistrationState): void {
    for (const part of state.meshParts) removeIdentity(part.batch.parts, part);
    for (const part of state.lineParts) removeIdentity(part.batch.parts, part);
    state.meshParts.length = 0;
    state.lineParts.length = 0;
  }

  private commitEmptyPrefixes(): void {
    for (const batch of this.meshBatches.values()) {
      batch.mesh.count = 0;
      batch.mesh.visible = false;
    }
    for (const batch of this.lineBatches.values()) {
      batch.geometry.setDrawRange(0, 0);
      batch.line.visible = false;
    }
  }
}

function resolveMounts(toolRoot: THREE.Object3D): THREE.Object3D[] {
  const configured = toolRoot.userData.workerToolMounts as unknown;
  const candidates = Array.isArray(configured) ? configured : [toolRoot];
  const mounts: THREE.Object3D[] = [];
  const seen = new Set<THREE.Object3D>();
  for (const candidate of candidates) {
    if (!(candidate instanceof THREE.Object3D) || seen.has(candidate)) continue;
    seen.add(candidate);
    mounts.push(candidate);
  }
  if (mounts.length === 0) mounts.push(toolRoot);
  return mounts;
}

function meshBatchKey(source: THREE.Mesh): string {
  return [
    source.geometry.uuid,
    materialIdentityKey(source.material),
    source.castShadow ? 1 : 0,
    source.receiveShadow ? 1 : 0,
    source.renderOrder,
    source.layers.mask,
  ].join('|');
}

function lineBatchKey(source: THREE.Line): string {
  const material = Array.isArray(source.material)
    ? source.material.map((entry) => entry.uuid).join(',')
    : source.material.uuid;
  return [material, source.castShadow ? 1 : 0, source.receiveShadow ? 1 : 0, source.renderOrder, source.layers.mask].join('|');
}

function materialIdentityKey(material: THREE.Material | THREE.Material[]): string {
  return Array.isArray(material)
    ? material.map((entry) => entry.uuid).join(',')
    : material.uuid;
}

function sameMaterialIdentity(
  left: THREE.Material | THREE.Material[],
  right: THREE.Material | THREE.Material[],
): boolean {
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (!Array.isArray(left) || !Array.isArray(right)) return left === right;
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function configureMeshBatchObject(
  target: THREE.InstancedMesh,
  source: THREE.Mesh | THREE.InstancedMesh,
  name: string,
): void {
  target.name = `${name} · ${source.name || source.geometry.uuid}`;
  target.castShadow = source.castShadow;
  target.receiveShadow = source.receiveShadow;
  target.renderOrder = source.renderOrder;
  target.frustumCulled = false;
  target.layers.mask = source.layers.mask;
  target.count = 0;
  target.visible = false;
  target.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  target.userData.exactMountedAttachmentBatch = true;
  target.userData.sourceGeometryUuid = source.geometry.uuid;
  target.userData.sourceMaterialUuids = Array.isArray(source.material)
    ? source.material.map((entry) => entry.uuid)
    : [source.material.uuid];
  target.raycast = () => {};
}

function lineSegmentPairs(source: THREE.Line): readonly (readonly [number, number])[] {
  const position = source.geometry.getAttribute('position');
  const index = source.geometry.index;
  const sequence = index
    ? Array.from({ length: index.count }, (_, offset) => index.getX(offset))
    : Array.from({ length: position.count }, (_, offset) => offset);
  const start = Math.max(0, Math.floor(source.geometry.drawRange.start));
  const available = Math.max(0, sequence.length - start);
  const requested = Number.isFinite(source.geometry.drawRange.count)
    ? Math.max(0, Math.floor(source.geometry.drawRange.count))
    : available;
  const values = sequence.slice(start, start + Math.min(available, requested));
  const pairs: Array<readonly [number, number]> = [];
  if ((source as THREE.LineSegments).isLineSegments) {
    for (let offset = 0; offset + 1 < values.length; offset += 2) {
      pairs.push([values[offset]!, values[offset + 1]!]);
    }
  } else {
    for (let offset = 0; offset + 1 < values.length; offset += 1) {
      pairs.push([values[offset]!, values[offset + 1]!]);
    }
    if ((source as THREE.LineLoop).isLineLoop && values.length > 2) {
      pairs.push([values.at(-1)!, values[0]!]);
    }
  }
  return pairs;
}

function isPartVisible(part: MeshPart | LinePart): boolean {
  if (!part.registration.active || !part.sourceVisible) return false;
  if (part.source === part.mount) return true;
  let cursor = part.source.parent;
  while (cursor) {
    // This boundary hides the duplicate CPU rig from render traversal. It does
    // not hide its exact batched attachments; actor/tool visibility still does.
    if (!cursor.visible && cursor.userData.authoredRigEvaluatorGroup !== true) return false;
    if (cursor === part.mount) return true;
    cursor = cursor.parent;
  }
  return false;
}

function removeIdentity<T>(entries: T[], target: T): void {
  const index = entries.indexOf(target);
  if (index >= 0) entries.splice(index, 1);
}

function grownCapacity(current: number, required: number): number {
  let next = Math.max(1, current);
  while (next < required) next *= 2;
  return next;
}
