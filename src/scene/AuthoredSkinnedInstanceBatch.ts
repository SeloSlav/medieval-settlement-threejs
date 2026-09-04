import * as THREE from 'three';
import {
  MeshPhysicalNodeMaterial,
  MeshStandardNodeMaterial,
  StorageBufferAttribute,
  StorageInstancedBufferAttribute,
} from 'three/webgpu';
import * as TSL from 'three/tsl';

const MATRIX_COMPONENTS = 16;
const COLOR_COMPONENTS = 3;
const MATRIX_EPSILON = 1e-5;
const PBR_TEXTURE_KEYS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'emissiveMap',
  'aoMap',
  'alphaMap',
  'lightMap',
  'bumpMap',
  'clearcoatMap',
  'clearcoatNormalMap',
  'clearcoatRoughnessMap',
  'transmissionMap',
  'thicknessMap',
  'sheenColorMap',
  'sheenRoughnessMap',
  'iridescenceMap',
  'iridescenceThicknessMap',
  'specularColorMap',
  'specularIntensityMap',
  'anisotropyMap',
] as const;

type SkinNode = {
  readonly x: SkinNode;
  readonly y: SkinNode;
  readonly z: SkinNode;
  readonly w: SkinNode;
  readonly xyz: SkinNode;
  add(value: number | SkinNode): SkinNode;
  assign(value: SkinNode): SkinNode;
  element(index: SkinNode): SkinNode;
  mul(value: number | SkinNode): SkinNode;
  normalize(): SkinNode;
  toReadOnly(): SkinNode;
};

type SkinTslApi = {
  Fn(callback: () => void, layout?: string): () => SkinNode;
  attribute(name: string, type: string): SkinNode;
  instanceIndex: SkinNode;
  instancedMesh(object: THREE.InstancedMesh): SkinNode;
  materialColor: SkinNode;
  normalLocal: SkinNode;
  positionGeometry: SkinNode;
  positionLocal: SkinNode;
  storage(attribute: THREE.BufferAttribute, type: string, count: number): SkinNode;
  tangentLocal: SkinNode;
  uint(value: number | SkinNode): SkinNode;
  uniform(value: unknown, type?: string): SkinNode;
  vec4(...values: Array<number | SkinNode>): SkinNode;
};

const skinTsl = TSL as unknown as SkinTslApi;
const {
  Fn,
  attribute,
  instanceIndex,
  instancedMesh,
  materialColor,
  normalLocal,
  positionGeometry,
  positionLocal,
  storage,
  tangentLocal,
  uint,
  uniform,
  vec4,
} = skinTsl;

type NodeStandardMaterial = MeshStandardNodeMaterial & THREE.MeshStandardMaterial;
type NodePhysicalMaterial = MeshPhysicalNodeMaterial & THREE.MeshPhysicalMaterial;
type AuthoredNodeMaterial = NodeStandardMaterial | NodePhysicalMaterial;

type PaletteSkinningBuilder = {
  geometry: THREE.BufferGeometry;
  object: THREE.InstancedMesh;
};

type PaletteSkinningMaterial = AuthoredNodeMaterial & {
  setupPosition(builder: PaletteSkinningBuilder): SkinNode;
};

export type AuthoredSkinnedInstanceBatchOptions = {
  /** Parent that owns the submitted instanced layers. */
  parent: THREE.Object3D;
  /** Loaded GLB root. Geometry, texture, UV, skin weights and material inputs are retained. */
  sourceRoot: THREE.Object3D;
  /** Initial allocation. Call reserve() outside a battle to grow without a render-time hitch. */
  capacity?: number;
  name?: string;
  castShadow?: boolean;
  receiveShadow?: boolean;
};

export type AuthoredSkinnedInstanceBatchDiagnostic = {
  capacity: number;
  count: number;
  boneCount: number;
  sourceLayerCount: number;
  sourceMaterialCount: number;
  drawCalls: number;
  sourceVerticesPerInstance: number;
  sourceTrianglesPerInstance: number;
  submittedVertices: number;
  submittedTriangles: number;
  posePaletteBytes: number;
  transformBytes: number;
  colorBytes: number;
  lastPoseUploadBytes: number;
  resizeCount: number;
  sourceGeometryIdentityPreserved: boolean;
  sourceTextureIdentityPreserved: boolean;
  sourcePbrMapIdentityPreserved: boolean;
  sourceAlphaStatePreserved: boolean;
  sourceSideStatePreserved: boolean;
  sourceVertexColorStatePreserved: boolean;
  sourceTransformLayoutValidated: boolean;
  sourceBoneLayoutValidated: boolean;
  sourceMeshLocalMatrices: readonly (readonly number[])[];
  sourceMeshRootRelativeMatrices: readonly (readonly number[])[];
};

export type AuthoredSkinnedMaterialSlot = {
  index: number;
  layerIndex: number;
  materialIndex: number;
  name: string;
};

type SourceLayer = {
  name: string;
  path: readonly number[];
  geometry: THREE.BufferGeometry;
  materials: readonly THREE.Material[];
  bindMatrix: THREE.Matrix4;
  bindMatrixInverse: THREE.Matrix4;
  localMatrix: THREE.Matrix4;
  rootRelativeMatrix: THREE.Matrix4;
  drawCalls: number;
  vertices: number;
  triangles: number;
};

type SubmittedLayer = {
  mesh: THREE.InstancedMesh;
  materials: AuthoredNodeMaterial[];
  source: SourceLayer;
};

type PosedCloneBinding = {
  /** The one skeleton palette shared by every authored source layer. */
  paletteSkeleton: THREE.Skeleton;
  /** Mesh space that owns the instanced body transform for this clone. */
  paletteMesh: THREE.SkinnedMesh;
};

/**
 * Native-WebGPU exact-asset crowd batch.
 *
 * The source GLB vertex buffers are submitted directly as InstancedMesh layers.
 * A storage-buffer palette contains one complete authored skeleton per instance;
 * the vertex shader selects `instanceIndex * boneCount + skinIndex`. This avoids
 * duplicate geometry, per-agent draw calls, and any proxy/LOD representation.
 *
 * Animation evaluation is intentionally outside this renderer. Callers may feed
 * exact AnimationMixer skeleton matrices, a sampled authored-clip cache, or a
 * future GPU pose evaluator through setPoseAt() without changing visual geometry.
 */
export class AuthoredSkinnedInstanceBatch {
  readonly group = new THREE.Group();

  private readonly sourceLayers: SourceLayer[];
  private readonly sourceSkeleton: THREE.Skeleton;
  private readonly sourceBoneNames: readonly string[];
  private readonly sourceBoneInverses: readonly THREE.Matrix4[];
  private readonly materialSlotList: AuthoredSkinnedMaterialSlot[];
  private readonly options: AuthoredSkinnedInstanceBatchOptions;
  private readonly inverseBatchWorld = new THREE.Matrix4();
  private readonly posedRootInverse = new THREE.Matrix4();
  private readonly posedRootRelative = new THREE.Matrix4();
  private readonly posedMeshWorld = new THREE.Matrix4();
  private readonly posedMeshWorldInverse = new THREE.Matrix4();
  private readonly instanceMatrixScratch = new THREE.Matrix4();
  private readonly boneOffsetScratch = new THREE.Matrix4();
  private readonly batchWorldSnapshot = new THREE.Matrix4();
  private readonly validatedSkeletons = new WeakSet<THREE.Skeleton>();
  private readonly posedCloneBindings = new WeakMap<THREE.Object3D, PosedCloneBinding>();
  private submittedLayers: SubmittedLayer[] = [];
  private posePalette!: StorageBufferAttribute;
  private instanceMatrices!: StorageInstancedBufferAttribute;
  private instanceColors!: StorageInstancedBufferAttribute;
  private capacityValue = 0;
  private countValue = 0;
  private resizeCount = 0;
  private poseDirtyStart = Number.POSITIVE_INFINITY;
  private poseDirtyEnd = 0;
  private matrixDirtyStart = Number.POSITIVE_INFINITY;
  private matrixDirtyEnd = 0;
  private colorDirtyStart = Number.POSITIVE_INFINITY;
  private colorDirtyEnd = 0;
  private lastPoseUploadBytes = 0;
  private batchTransformPrepared = false;
  private batchWorldSnapshotValid = false;
  private disposed = false;

  constructor(options: AuthoredSkinnedInstanceBatchOptions) {
    this.options = options;
    const source = inspectAuthoredSkinnedSource(options.sourceRoot);
    this.sourceSkeleton = source.skeleton;
    this.sourceLayers = source.layers;
    this.sourceBoneNames = source.boneNames;
    this.sourceBoneInverses = source.boneInverses;
    this.materialSlotList = createMaterialSlotList(source.layers);
    this.group.name = options.name ?? `${options.sourceRoot.name || 'Authored rig'} instances`;
    options.parent.add(this.group);
    this.rebuild(Math.max(1, Math.ceil(options.capacity ?? 256)));
  }

  get capacity(): number {
    return this.capacityValue;
  }

  get count(): number {
    return this.countValue;
  }

  get boneCount(): number {
    return this.sourceSkeleton.bones.length;
  }

  materialSlots(): readonly AuthoredSkinnedMaterialSlot[] {
    return this.materialSlotList;
  }

  boneNames(): readonly string[] {
    return this.sourceBoneNames;
  }

  /**
   * Grows storage while retaining transforms, colors and poses. Reserving is a
   * deliberate synchronization point because node materials capture the storage
   * palette; call it during loading or company formation, not every frame.
   */
  reserve(minimumCapacity: number): void {
    this.assertAlive();
    const required = Math.max(1, Math.ceil(minimumCapacity));
    if (required <= this.capacityValue) return;
    let capacity = this.capacityValue;
    while (capacity < required) capacity = Math.ceil(capacity * 1.5);
    this.rebuild(capacity);
    this.resizeCount += 1;
  }

  setCount(count: number): void {
    this.assertAlive();
    if (!Number.isInteger(count) || count < 0) {
      throw new RangeError(`Authored instance count must be a non-negative integer; got ${count}`);
    }
    if (count > this.capacityValue) this.reserve(count);
    this.countValue = count;
    for (const layer of this.submittedLayers) layer.mesh.count = count;
  }

  setMatrixAt(slot: number, matrix: THREE.Matrix4): void {
    this.assertSlot(slot);
    matrix.toArray(this.instanceMatrices.array, slot * MATRIX_COMPONENTS);
    this.matrixDirtyStart = Math.min(this.matrixDirtyStart, slot * MATRIX_COMPONENTS);
    this.matrixDirtyEnd = Math.max(this.matrixDirtyEnd, (slot + 1) * MATRIX_COMPONENTS);
  }

  setColorAt(slot: number, color: THREE.ColorRepresentation): void {
    this.assertSlot(slot);
    const resolved = new THREE.Color(color);
    const firstOffset = slot * this.materialSlotList.length * COLOR_COMPONENTS;
    for (let materialSlot = 0; materialSlot < this.materialSlotList.length; materialSlot++) {
      writeColor(
        this.instanceColors.array,
        firstOffset + materialSlot * COLOR_COMPONENTS,
        resolved,
      );
    }
    this.colorDirtyStart = Math.min(this.colorDirtyStart, firstOffset);
    this.colorDirtyEnd = Math.max(
      this.colorDirtyEnd,
      firstOffset + this.materialSlotList.length * COLOR_COMPONENTS,
    );
  }

  /** Applies resolvePartColor-style variation to one authored material only. */
  setMaterialColorAt(
    slot: number,
    materialSlot: number,
    color: THREE.ColorRepresentation,
  ): void {
    this.assertSlot(slot);
    if (
      !Number.isInteger(materialSlot)
      || materialSlot < 0
      || materialSlot >= this.materialSlotList.length
    ) {
      throw new RangeError(
        `Authored material slot ${materialSlot} is outside ${this.materialSlotList.length} source materials`,
      );
    }
    const offset = (
      slot * this.materialSlotList.length + materialSlot
    ) * COLOR_COMPONENTS;
    writeColor(this.instanceColors.array, offset, new THREE.Color(color));
    this.colorDirtyStart = Math.min(this.colorDirtyStart, offset);
    this.colorDirtyEnd = Math.max(this.colorDirtyEnd, offset + COLOR_COMPONENTS);
  }

  /**
   * Copies final mesh-local bone matrices from Skeleton.update() without
   * allocating. The matching instance transform must be the posed
   * SkinnedMesh.matrixWorld expressed relative to this batch group.
   * Prefer setFromCloneAt(), which validates and publishes both together.
   */
  setPoseAt(slot: number, boneMatrices: ArrayLike<number>): void {
    this.assertSlot(slot);
    const poseComponents = this.boneCount * MATRIX_COMPONENTS;
    if (boneMatrices.length !== poseComponents) {
      throw new RangeError(
        `Authored pose requires ${poseComponents} matrix components for ${this.boneCount} bones; `
          + `got ${boneMatrices.length}`,
      );
    }
    const offset = slot * poseComponents;
    this.posePalette.array.set(boneMatrices, offset);
    this.poseDirtyStart = Math.min(this.poseDirtyStart, offset);
    this.poseDirtyEnd = Math.max(this.poseDirtyEnd, offset + poseComponents);
  }

  /**
   * Exact caller recipe for a SkeletonUtils clone of sourceRoot:
   *
   * 1. caller applies actor translation/yaw/scale to posedRoot;
   * 2. caller evaluates its authored AnimationMixer;
   * 3. this method validates source hierarchy + bind layout;
   * 4. palette receives meshWorld^-1 * boneWorld * inverseBind, matching
   *    AttachedBindMode without applying the actor transform twice;
   * 5. instance matrix receives inverse(batch.group.matrixWorld) multiplied by
   *    posed SkinnedMesh.matrixWorld, retaining internal -90°/scale-100 parents.
   */
  setFromCloneAt(slot: number, posedRoot: THREE.Object3D): void {
    this.assertSlot(slot);
    this.prepareBatchTransform();

    let binding = this.posedCloneBindings.get(posedRoot);
    if (!binding) {
      // Clone topology, non-bone source transforms, bind inverses and bone order
      // are immutable for the lifetime of a pooled authored visual. Pay their
      // hierarchy walk and exact validation once, then retain direct references.
      posedRoot.updateWorldMatrix(true, true);
      binding = this.bindPosedClone(posedRoot);
      this.posedCloneBindings.set(posedRoot, binding);
    } else {
      // AnimationMixer and combat poses can affect bones as well as mounted
      // descendants. Keep Three's authoritative hierarchy propagation; the
      // cached binding removes only immutable validation/traversal work.
      posedRoot.updateWorldMatrix(true, true);
    }

    this.posedMeshWorld.copy(binding.paletteMesh.matrixWorld);
    this.posedMeshWorldInverse.copy(this.posedMeshWorld).invert();
    this.instanceMatrixScratch.multiplyMatrices(
      this.inverseBatchWorld,
      this.posedMeshWorld,
    );
    this.writeCloneMatrices(
      slot,
      this.instanceMatrixScratch,
      binding.paletteSkeleton,
      this.posedMeshWorldInverse,
    );
  }

  /**
   * Resolves and validates an immutable clone hierarchy without publishing an
   * instance. Pooling a rig alone is not sufficient: the first visible frame
   * would otherwise still pay the complete bone/topology binding walk.
   */
  prepareCloneBinding(posedRoot: THREE.Object3D): void {
    this.assertAlive();
    if (this.posedCloneBindings.has(posedRoot)) return;
    posedRoot.updateWorldMatrix(true, true);
    this.posedCloneBindings.set(posedRoot, this.bindPosedClone(posedRoot));
  }

  validateSkeleton(skeleton: THREE.Skeleton, label = 'posed skeleton'): void {
    if (this.validatedSkeletons.has(skeleton)) return;
    validateSkeletonLayout(
      skeleton,
      this.sourceBoneNames,
      this.sourceBoneInverses,
      label,
    );
    this.validatedSkeletons.add(skeleton);
  }

  /** Publishes only the contiguous ranges changed since the previous commit. */
  commit(): void {
    this.assertAlive();
    this.lastPoseUploadBytes = publishDirtyRange(
      this.posePalette,
      this.poseDirtyStart,
      this.poseDirtyEnd,
    );
    publishDirtyRange(this.instanceMatrices, this.matrixDirtyStart, this.matrixDirtyEnd);
    publishDirtyRange(this.instanceColors, this.colorDirtyStart, this.colorDirtyEnd);
    this.poseDirtyStart = Number.POSITIVE_INFINITY;
    this.poseDirtyEnd = 0;
    this.matrixDirtyStart = Number.POSITIVE_INFINITY;
    this.matrixDirtyEnd = 0;
    this.colorDirtyStart = Number.POSITIVE_INFINITY;
    this.colorDirtyEnd = 0;
    // The parent may move between authored-crowd syncs. A batch transform is
    // therefore prepared once per commit interval, never once per actor.
    this.batchTransformPrepared = false;
  }

  diagnostics(): AuthoredSkinnedInstanceBatchDiagnostic {
    const sourceMaterialCount = this.sourceLayers.reduce(
      (sum, layer) => sum + layer.materials.length,
      0,
    );
    const drawCalls = this.sourceLayers.reduce((sum, layer) => sum + layer.drawCalls, 0);
    const sourceVerticesPerInstance = this.sourceLayers.reduce(
      (sum, layer) => sum + layer.vertices,
      0,
    );
    const sourceTrianglesPerInstance = this.sourceLayers.reduce(
      (sum, layer) => sum + layer.triangles,
      0,
    );
    const sourcePbrMapIdentityPreserved = this.submittedLayers.every((layer) =>
      layer.materials.every((material, index) => pbrMapIdentitiesMatch(
        material,
        layer.source.materials[index] as THREE.MeshStandardMaterial,
      )),
    );
    return {
      capacity: this.capacityValue,
      count: this.countValue,
      boneCount: this.boneCount,
      sourceLayerCount: this.sourceLayers.length,
      sourceMaterialCount,
      drawCalls,
      sourceVerticesPerInstance,
      sourceTrianglesPerInstance,
      submittedVertices: sourceVerticesPerInstance * this.countValue,
      submittedTriangles: sourceTrianglesPerInstance * this.countValue,
      posePaletteBytes: this.posePalette.array.byteLength,
      transformBytes: this.instanceMatrices.array.byteLength,
      colorBytes: this.instanceColors.array.byteLength,
      lastPoseUploadBytes: this.lastPoseUploadBytes,
      resizeCount: this.resizeCount,
      sourceGeometryIdentityPreserved: this.submittedLayers.every(
        (layer) => layer.mesh.geometry === layer.source.geometry,
      ),
      sourceTextureIdentityPreserved: sourcePbrMapIdentityPreserved,
      sourcePbrMapIdentityPreserved,
      sourceAlphaStatePreserved: this.submittedLayers.every((layer) =>
        layer.materials.every((material, index) => alphaStatesMatch(
          material,
          layer.source.materials[index] as THREE.MeshStandardMaterial,
        )),
      ),
      sourceSideStatePreserved: this.submittedLayers.every((layer) =>
        layer.materials.every((material, index) => sideStatesMatch(
          material,
          layer.source.materials[index] as THREE.MeshStandardMaterial,
        )),
      ),
      sourceVertexColorStatePreserved: this.submittedLayers.every((layer) =>
        layer.mesh.geometry.getAttribute('color') === layer.source.geometry.getAttribute('color')
        && layer.materials.every((material, index) =>
          material.vertexColors
            === (layer.source.materials[index] as THREE.MeshStandardMaterial).vertexColors,
        ),
      ),
      sourceTransformLayoutValidated: sourceLayerTransformsMatch(this.sourceLayers),
      sourceBoneLayoutValidated: true,
      sourceMeshLocalMatrices: this.sourceLayers.map((layer) => layer.localMatrix.toArray()),
      sourceMeshRootRelativeMatrices: this.sourceLayers.map(
        (layer) => layer.rootRelativeMatrix.toArray(),
      ),
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disposeSubmittedLayers();
    this.posePalette = null as unknown as StorageBufferAttribute;
    this.instanceMatrices = null as unknown as StorageInstancedBufferAttribute;
    this.instanceColors = null as unknown as StorageInstancedBufferAttribute;
    this.group.removeFromParent();
  }

  private rebuild(capacity: number): void {
    const previousPose = this.posePalette?.array;
    const previousMatrices = this.instanceMatrices?.array;
    const previousColors = this.instanceColors?.array;
    this.disposeSubmittedLayers();

    this.capacityValue = capacity;
    this.posePalette = new StorageBufferAttribute(
      capacity * this.boneCount,
      MATRIX_COMPONENTS,
    );
    this.posePalette.setUsage(THREE.DynamicDrawUsage);
    this.instanceMatrices = new StorageInstancedBufferAttribute(capacity, MATRIX_COMPONENTS);
    this.instanceMatrices.setUsage(THREE.DynamicDrawUsage);
    this.instanceColors = new StorageInstancedBufferAttribute(
      capacity * this.materialSlotList.length,
      COLOR_COMPONENTS,
    );
    this.instanceColors.setUsage(THREE.DynamicDrawUsage);

    fillIdentityMatrices(this.instanceMatrices.array);
    fillWhiteColors(this.instanceColors.array);
    if (previousPose) this.posePalette.array.set(previousPose.subarray(0, this.posePalette.array.length));
    if (previousMatrices) {
      this.instanceMatrices.array.set(previousMatrices.subarray(0, this.instanceMatrices.array.length));
    }
    if (previousColors) {
      this.instanceColors.array.set(previousColors.subarray(0, this.instanceColors.array.length));
    }

    let materialSlot = 0;
    this.submittedLayers = this.sourceLayers.map((source, layerIndex) => {
      const materials = source.materials.map((sourceMaterial) => {
        const material = createPaletteMaterial(
          sourceMaterial,
          this.posePalette,
          this.instanceColors,
          materialSlot,
          this.materialSlotList.length,
          this.boneCount,
          source.bindMatrix,
          source.geometry.hasAttribute('tangent'),
        );
        materialSlot += 1;
        return material;
      });
      const material: AuthoredNodeMaterial | AuthoredNodeMaterial[] = materials.length === 1
        ? materials[0]!
        : materials;
      const mesh = new THREE.InstancedMesh(source.geometry, material, capacity);
      mesh.name = `${this.group.name}: authored layer ${layerIndex + 1}`;
      mesh.instanceMatrix = this.instanceMatrices;
      mesh.count = Math.min(this.countValue, capacity);
      mesh.castShadow = this.options.castShadow ?? false;
      mesh.receiveShadow = this.options.receiveShadow ?? false;
      // The source bounds describe one actor, not the complete dynamic batch.
      // Higher-level crowd visibility already performs the useful world cull.
      mesh.frustumCulled = false;
      mesh.userData.authoredSkinnedInstances = true;
      mesh.userData.sourceGeometryUuid = source.geometry.uuid;
      this.group.add(mesh);
      return { mesh, materials, source };
    });

    this.poseDirtyStart = 0;
    this.poseDirtyEnd = this.posePalette.array.length;
    this.matrixDirtyStart = 0;
    this.matrixDirtyEnd = this.instanceMatrices.array.length;
    this.colorDirtyStart = 0;
    this.colorDirtyEnd = this.instanceColors.array.length;
    this.commit();
  }

  private disposeSubmittedLayers(): void {
    for (const layer of this.submittedLayers) {
      layer.mesh.removeFromParent();
      for (const material of layer.materials) material.dispose();
      // Source geometry and textures are borrowed, never disposed here.
    }
    this.submittedLayers = [];
  }

  private prepareBatchTransform(): void {
    if (this.batchTransformPrepared) return;
    this.group.updateWorldMatrix(true, false);
    if (
      !this.batchWorldSnapshotValid
      || !this.batchWorldSnapshot.equals(this.group.matrixWorld)
    ) {
      this.batchWorldSnapshot.copy(this.group.matrixWorld);
      this.inverseBatchWorld.copy(this.group.matrixWorld).invert();
      this.batchWorldSnapshotValid = true;
    }
    this.batchTransformPrepared = true;
  }

  private bindPosedClone(posedRoot: THREE.Object3D): PosedCloneBinding {
    this.posedRootInverse.copy(posedRoot.matrixWorld).invert();
    let paletteSkeleton: THREE.Skeleton | null = null;
    let paletteMesh: THREE.SkinnedMesh | null = null;
    for (const sourceLayer of this.sourceLayers) {
      const posedObject = objectAtPath(posedRoot, sourceLayer.path);
      const posedMesh = posedObject as THREE.SkinnedMesh | null;
      if (!posedMesh?.isSkinnedMesh) {
        throw new Error(
          `Posed authored clone is missing SkinnedMesh ${sourceLayer.name} at `
            + `child path ${sourceLayer.path.join('/') || '<root>'}`,
        );
      }
      if (!matrixApproximatelyEquals(posedMesh.matrix, sourceLayer.localMatrix)) {
        throw new Error(
          `${sourceLayer.name} local transform differs from its authored GLB source`,
        );
      }
      this.posedRootRelative
        .multiplyMatrices(this.posedRootInverse, posedMesh.matrixWorld);
      if (!matrixApproximatelyEquals(
        this.posedRootRelative,
        sourceLayer.rootRelativeMatrix,
      )) {
        throw new Error(
          `${sourceLayer.name} root-relative transform differs from its authored GLB source`,
        );
      }
      this.validateSkeleton(posedMesh.skeleton, sourceLayer.name);
      paletteSkeleton ??= posedMesh.skeleton;
      paletteMesh ??= posedMesh;
    }
    if (!paletteSkeleton || !paletteMesh) {
      throw new Error('Posed authored clone contains no validated skinned layer');
    }
    return {
      paletteSkeleton,
      paletteMesh,
    };
  }

  private writeCloneMatrices(
    slot: number,
    instanceMatrix: THREE.Matrix4,
    skeleton: THREE.Skeleton,
    meshWorldInverse: THREE.Matrix4,
  ): void {
    // setFromCloneAt already validated the slot and skeleton layout. Writing
    // both contiguous buffers here avoids two more public-boundary checks and
    // the intermediate Skeleton.boneMatrices copy per actor without changing
    // a single uploaded component.
    const matrixOffset = slot * MATRIX_COMPONENTS;
    instanceMatrix.toArray(this.instanceMatrices.array, matrixOffset);
    this.matrixDirtyStart = Math.min(this.matrixDirtyStart, matrixOffset);
    this.matrixDirtyEnd = Math.max(this.matrixDirtyEnd, matrixOffset + MATRIX_COMPONENTS);

    const poseComponents = this.boneCount * MATRIX_COMPONENTS;
    const poseOffset = slot * poseComponents;
    const bones = skeleton.bones;
    const boneInverses = skeleton.boneInverses;
    for (let boneIndex = 0; boneIndex < bones.length; boneIndex++) {
      // Three's AttachedBindMode refreshes bindMatrixInverse from the posed
      // mesh world matrix. The batch's InstancedMesh already applies that
      // world matrix, so upload the same bone offset in mesh-local space.
      // Uploading raw Skeleton.boneMatrices here applies translation/yaw a
      // second time and makes bodies run away from their bone-mounted gear.
      this.boneOffsetScratch
        .multiplyMatrices(meshWorldInverse, bones[boneIndex]!.matrixWorld)
        .multiply(boneInverses[boneIndex]!);
      this.boneOffsetScratch.toArray(
        this.posePalette.array,
        poseOffset + boneIndex * MATRIX_COMPONENTS,
      );
    }
    this.poseDirtyStart = Math.min(this.poseDirtyStart, poseOffset);
    this.poseDirtyEnd = Math.max(this.poseDirtyEnd, poseOffset + poseComponents);
  }

  private assertSlot(slot: number): void {
    this.assertAlive();
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.capacityValue) {
      throw new RangeError(
        `Authored instance slot ${slot} is outside capacity ${this.capacityValue}`,
      );
    }
  }

  private assertAlive(): void {
    if (this.disposed) throw new Error('Authored skinned instance batch is disposed');
  }
}

function inspectAuthoredSkinnedSource(sourceRoot: THREE.Object3D): {
  skeleton: THREE.Skeleton;
  layers: SourceLayer[];
  boneNames: readonly string[];
  boneInverses: readonly THREE.Matrix4[];
} {
  sourceRoot.updateMatrixWorld(true);
  const sourceMeshes: THREE.SkinnedMesh[] = [];
  sourceRoot.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh) sourceMeshes.push(mesh);
  });
  const sourceSkeleton = sourceMeshes[0]?.skeleton;
  if (!sourceSkeleton) throw new Error('Authored instance source contains no SkinnedMesh');
  if (sourceSkeleton.bones.length === 0) {
    throw new Error('Authored instance source skeleton contains no bones');
  }
  const boneNames = sourceSkeleton.bones.map((bone) => bone.name);
  const boneInverses = sourceSkeleton.boneInverses.map((matrix) => matrix.clone());
  validateSkeletonLayout(sourceSkeleton, boneNames, boneInverses, 'source skeleton');
  const inverseSourceRoot = sourceRoot.matrixWorld.clone().invert();

  const layers = sourceMeshes.map((mesh): SourceLayer => {
    validateSourceGeometry(mesh.geometry, mesh.name || 'unnamed skinned mesh');
    if (mesh.bindMode !== THREE.AttachedBindMode) {
      throw new Error(
        `${mesh.name || 'SkinnedMesh'} uses ${mesh.bindMode}; exact batching currently `
          + 'requires Three AttachedBindMode so body and bone-mounted equipment share one space.',
      );
    }
    validateSkeletonLayout(
      mesh.skeleton,
      boneNames,
      boneInverses,
      mesh.name || 'source SkinnedMesh',
    );
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) validateSourceMaterial(material, mesh.name);
    const vertices = mesh.geometry.getAttribute('position').count;
    const submittedIndexCount = mesh.geometry.index?.count ?? vertices;
    return {
      name: mesh.name || 'SkinnedMesh',
      path: objectPath(sourceRoot, mesh),
      geometry: mesh.geometry,
      materials,
      bindMatrix: mesh.bindMatrix.clone(),
      bindMatrixInverse: mesh.bindMatrixInverse.clone(),
      localMatrix: mesh.matrix.clone(),
      rootRelativeMatrix: inverseSourceRoot.clone().multiply(mesh.matrixWorld),
      drawCalls: materials.length === 1
        ? 1
        : Math.max(1, mesh.geometry.groups.length),
      vertices,
      triangles: Math.floor(submittedIndexCount / 3),
    };
  });
  if (!sourceLayerTransformsMatch(layers)) {
    throw new Error(
      'Authored source SkinnedMesh layers use different root-relative transforms. '
        + 'One shared exact instance transform cannot represent this source.',
    );
  }
  return { skeleton: sourceSkeleton, layers, boneNames, boneInverses };
}

function validateSourceGeometry(geometry: THREE.BufferGeometry, label: string): void {
  for (const attribute of ['position', 'normal', 'skinIndex', 'skinWeight']) {
    if (!geometry.hasAttribute(attribute)) {
      throw new Error(`${label} is missing required authored ${attribute} data`);
    }
  }
  if (geometry.morphAttributes.position?.length) {
    throw new Error(
      `${label} uses morph targets. GPU palette skinning refuses to discard them; `
        + 'add morph-storage evaluation before batching this source.',
    );
  }
}

function validateSourceMaterial(material: THREE.Material, meshName: string): void {
  if (!(material instanceof THREE.MeshStandardMaterial)) {
    throw new Error(
      `${meshName || 'SkinnedMesh'} material ${material.name || material.type} `
        + 'must use authored MeshStandardMaterial or MeshPhysicalMaterial',
    );
  }
  if (material.displacementMap) {
    throw new Error(
      `${meshName || 'SkinnedMesh'} material ${material.name || material.type} uses displacement. `
        + 'The exact instanced skinning path refuses to omit authored displacement.',
    );
  }
}

function createPaletteMaterial(
  source: THREE.Material,
  posePalette: StorageBufferAttribute,
  instanceColors: StorageInstancedBufferAttribute,
  materialSlot: number,
  materialSlotCount: number,
  boneCount: number,
  bindMatrix: THREE.Matrix4,
  hasTangent: boolean,
): AuthoredNodeMaterial {
  const sourceStandard = source as THREE.MeshStandardMaterial;
  const material = source instanceof THREE.MeshPhysicalMaterial
    ? new MeshPhysicalNodeMaterial() as NodePhysicalMaterial
    : new MeshStandardNodeMaterial() as NodeStandardMaterial;
  material.copy(sourceStandard);
  material.name = `${source.name || source.type}: exact GPU-instanced skinning`;

  const applyPaletteSkinning = createPaletteSkinningNode(
    posePalette,
    boneCount,
    bindMatrix,
    hasTangent,
  );
  // Tripo's current production villagers use one baked albedo material with a
  // generated name. Their texture already owns skin, hair and clothing color;
  // multiplying it by a storage tint is both unnecessary and, on affected
  // WebGPU adapters, can read as zero during the first dynamic-buffer frames.
  // Only legacy semantic material slots opt into the per-instance palette.
  // Feed the complete stock authored PBR color node explicitly. Leaving a
  // converted NodeMaterial input null is adapter/compiler dependent during a
  // cold storage-buffer compile: affected frames can submit the body to the
  // shadow pass while omitting it from the color pass entirely.
  if (authoredMaterialUsesInstanceTint(source.name)) {
    const colorPalette = storage(
      instanceColors,
      'vec3',
      instanceColors.count,
    ).toReadOnly();
    const colorIndex = instanceIndex.mul(uint(materialSlotCount)).add(uint(materialSlot));
    material.colorNode = materialColor.mul(
      vec4(colorPalette.element(colorIndex), 1),
    ) as never;
  } else {
    material.colorNode = materialColor as never;
  }
  restoreAuthoredRenderState(material, sourceStandard);
  const paletteMaterial = material as PaletteSkinningMaterial;
  paletteMaterial.setupPosition = (builder): SkinNode => {
    applyPaletteSkinning();
    instancedMesh(builder.object);
    return positionLocal;
  };
  return material;
}

function authoredMaterialUsesInstanceTint(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized.includes('skin')
    || normalized.includes('hair')
    || normalized.includes('dress')
    || normalized.includes('shirt')
    || normalized.includes('pants')
    || normalized.includes('socks')
    || normalized.includes('shoes')
    || normalized.includes('eyes');
}

function createPaletteSkinningNode(
  posePalette: StorageBufferAttribute,
  boneCount: number,
  bindMatrix: THREE.Matrix4,
  hasTangent: boolean,
): () => SkinNode {
  const matrices = storage(
    posePalette,
    'mat4',
    posePalette.count,
  ).toReadOnly();
  const bind = uniform(bindMatrix, 'mat4');

  return Fn(() => {
    const skinIndex = attribute('skinIndex', 'uvec4');
    const skinWeight = attribute('skinWeight', 'vec4');
    const base = instanceIndex.mul(uint(boneCount));
    const boneX = matrices.element(base.add(skinIndex.x));
    const boneY = matrices.element(base.add(skinIndex.y));
    const boneZ = matrices.element(base.add(skinIndex.z));
    const boneW = matrices.element(base.add(skinIndex.w));
    const skinMatrix = boneX.mul(skinWeight.x)
      .add(boneY.mul(skinWeight.y))
      .add(boneZ.mul(skinWeight.z))
      .add(boneW.mul(skinWeight.w));

    const skinVertex = bind.mul(vec4(positionGeometry, 1));
    positionLocal.assign(skinMatrix.mul(skinVertex).xyz);

    const skinDirectionMatrix = skinMatrix.mul(bind);
    normalLocal.assign(
      skinDirectionMatrix.mul(vec4(normalLocal, 0)).xyz.normalize(),
    );
    if (hasTangent) {
      tangentLocal.assign(
        skinDirectionMatrix.mul(vec4(tangentLocal, 0)).xyz.normalize(),
      );
    }
  }, 'void');
}

function publishDirtyRange(
  attribute: THREE.BufferAttribute,
  start: number,
  end: number,
): number {
  attribute.clearUpdateRanges();
  if (!Number.isFinite(start) || end <= start) return 0;
  attribute.addUpdateRange(start, end - start);
  attribute.needsUpdate = true;
  return (end - start) * attribute.array.BYTES_PER_ELEMENT;
}

function fillIdentityMatrices(array: ArrayLike<number> & { [index: number]: number }): void {
  for (let offset = 0; offset < array.length; offset += MATRIX_COMPONENTS) {
    array[offset] = 1;
    array[offset + 5] = 1;
    array[offset + 10] = 1;
    array[offset + 15] = 1;
  }
}

function fillWhiteColors(array: ArrayLike<number> & { [index: number]: number }): void {
  for (let index = 0; index < array.length; index++) array[index] = 1;
}

function writeColor(
  array: ArrayLike<number> & { [index: number]: number },
  offset: number,
  color: THREE.Color,
): void {
  array[offset] = color.r;
  array[offset + 1] = color.g;
  array[offset + 2] = color.b;
}

function createMaterialSlotList(
  layers: readonly SourceLayer[],
): AuthoredSkinnedMaterialSlot[] {
  const slots: AuthoredSkinnedMaterialSlot[] = [];
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
    const layer = layers[layerIndex]!;
    for (let materialIndex = 0; materialIndex < layer.materials.length; materialIndex++) {
      const material = layer.materials[materialIndex]!;
      slots.push({
        index: slots.length,
        layerIndex,
        materialIndex,
        name: material.name || material.type,
      });
    }
  }
  return slots;
}

function restoreAuthoredRenderState(
  target: THREE.MeshStandardMaterial,
  source: THREE.MeshStandardMaterial,
): void {
  // Importing the TSL method-chaining bundle currently causes Three r185's
  // cross-class NodeMaterial.copy() to miss alphaTest. Copy the complete
  // alpha/face/vertex-color contract explicitly so future Three changes cannot
  // silently flatten foliage, hair cards, fur edges or double-sided cloth.
  target.alphaTest = source.alphaTest;
  target.alphaHash = source.alphaHash;
  target.alphaToCoverage = source.alphaToCoverage;
  target.transparent = source.transparent;
  target.opacity = source.opacity;
  target.premultipliedAlpha = source.premultipliedAlpha;
  target.depthTest = source.depthTest;
  target.depthWrite = source.depthWrite;
  target.blending = source.blending;
  target.blendSrc = source.blendSrc;
  target.blendDst = source.blendDst;
  target.blendEquation = source.blendEquation;
  target.side = source.side;
  target.shadowSide = source.shadowSide;
  target.vertexColors = source.vertexColors;
}

function pbrMapIdentitiesMatch(
  target: THREE.MeshStandardMaterial,
  source: THREE.MeshStandardMaterial,
): boolean {
  const targetRecord = target as unknown as Record<string, unknown>;
  const sourceRecord = source as unknown as Record<string, unknown>;
  return PBR_TEXTURE_KEYS.every((key) => targetRecord[key] === sourceRecord[key]);
}

function alphaStatesMatch(
  target: THREE.MeshStandardMaterial,
  source: THREE.MeshStandardMaterial,
): boolean {
  return target.alphaTest === source.alphaTest
    && target.alphaHash === source.alphaHash
    && target.alphaToCoverage === source.alphaToCoverage
    && target.transparent === source.transparent
    && target.opacity === source.opacity
    && target.premultipliedAlpha === source.premultipliedAlpha
    && target.depthTest === source.depthTest
    && target.depthWrite === source.depthWrite
    && target.blending === source.blending
    && target.blendSrc === source.blendSrc
    && target.blendDst === source.blendDst
    && target.blendEquation === source.blendEquation;
}

function sideStatesMatch(
  target: THREE.MeshStandardMaterial,
  source: THREE.MeshStandardMaterial,
): boolean {
  return target.side === source.side && target.shadowSide === source.shadowSide;
}

function validateSkeletonLayout(
  skeleton: THREE.Skeleton,
  expectedNames: readonly string[],
  expectedInverses: readonly THREE.Matrix4[],
  label: string,
): void {
  if (skeleton.bones.length !== expectedNames.length) {
    throw new Error(
      `${label} has ${skeleton.bones.length} bones; expected ${expectedNames.length}`,
    );
  }
  if (skeleton.boneInverses.length !== expectedInverses.length) {
    throw new Error(
      `${label} has ${skeleton.boneInverses.length} inverse binds; `
        + `expected ${expectedInverses.length}`,
    );
  }
  for (let index = 0; index < expectedNames.length; index++) {
    const actualName = skeleton.bones[index]!.name;
    if (actualName !== expectedNames[index]) {
      throw new Error(
        `${label} bone ${index} is ${actualName || '<unnamed>'}; `
          + `expected ${expectedNames[index] || '<unnamed>'}`,
      );
    }
    if (!matrixApproximatelyEquals(
      skeleton.boneInverses[index]!,
      expectedInverses[index]!,
    )) {
      throw new Error(`${label} inverse bind ${index} differs from the authored source`);
    }
  }
}

function sourceLayerTransformsMatch(layers: readonly SourceLayer[]): boolean {
  const reference = layers[0]?.rootRelativeMatrix;
  return Boolean(reference) && layers.every(
    (layer) => matrixApproximatelyEquals(layer.rootRelativeMatrix, reference!),
  );
}

function matrixApproximatelyEquals(
  left: THREE.Matrix4,
  right: THREE.Matrix4,
  epsilon = MATRIX_EPSILON,
): boolean {
  for (let index = 0; index < MATRIX_COMPONENTS; index++) {
    if (Math.abs(left.elements[index]! - right.elements[index]!) > epsilon) return false;
  }
  return true;
}

function objectPath(root: THREE.Object3D, object: THREE.Object3D): number[] {
  const path: number[] = [];
  let current: THREE.Object3D | null = object;
  while (current && current !== root) {
    const parent: THREE.Object3D | null = current.parent;
    if (!parent) throw new Error(`${object.name || object.type} is outside the authored source root`);
    const childIndex = parent.children.indexOf(current);
    if (childIndex < 0) throw new Error(`${object.name || object.type} has an invalid parent link`);
    path.push(childIndex);
    current = parent;
  }
  if (current !== root) throw new Error(`${object.name || object.type} is outside the authored source root`);
  path.reverse();
  return path;
}

function objectAtPath(
  root: THREE.Object3D,
  path: readonly number[],
): THREE.Object3D | null {
  let object: THREE.Object3D | undefined = root;
  for (const childIndex of path) {
    object = object.children[childIndex];
    if (!object) return null;
  }
  return object;
}
