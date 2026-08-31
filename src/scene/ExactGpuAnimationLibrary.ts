import * as THREE from 'three';

const TRACK_COMPONENTS = 4;
const TRACKS_PER_BONE = 3;
const MATRIX_COMPONENTS = 16;
const POSITION_SLOT = 0;
const QUATERNION_SLOT = 1;
const SCALE_SLOT = 2;

export const EXACT_GPU_ANIMATION_NO_CLIP = 0xffff_ffff;
export const EXACT_GPU_INTERPOLATION_REST = 0;
export const EXACT_GPU_INTERPOLATION_DISCRETE = 1;
export const EXACT_GPU_INTERPOLATION_LINEAR = 2;

export type ExactGpuAnimationState = {
  primaryClip: number | string;
  primaryTime: number;
  secondaryClip?: number | string | null;
  secondaryTime?: number;
  /** Exact local-TRS crossfade weight in [0, 1]. */
  blend?: number;
};

export type ExactGpuAnimationLibraryOptions = {
  sourceRoot: THREE.Object3D;
  clips: readonly THREE.AnimationClip[];
  name?: string;
};

export type ExactGpuAnimationLibraryDiagnostic = {
  name: string;
  clipCount: number;
  boneCount: number;
  trackCount: number;
  keyCount: number;
  keyValueCount: number;
  sourceKeyBytes: number;
  gpuStaticBytes: number;
  stateBytesPerInstance: number;
  paletteBytesPerInstance: number;
  modelBoneBytesPerInstance: number;
  maximumHierarchyDepth: number;
  interpolationModes: readonly string[];
  exactSourceKeysPreserved: true;
  poseQuantization: false;
  boneReduction: false;
  animationLod: false;
};

export type ExactGpuAnimationUploadLayout = {
  /** vec4<u32>: key offset, key count, value offset, interpolation mode. */
  trackDescriptors: Uint32Array;
  keyTimes: Float32Array;
  keyValues: Float32Array;
  clipDurations: Float32Array;
  parentIndices: Int32Array;
  topologicalBoneOrder: Uint32Array;
  rootParentMatrices: Float32Array;
  inverseBindMatrices: Float32Array;
  restPositions: Float32Array;
  restQuaternions: Float32Array;
  restScales: Float32Array;
  /** Packed GPU binding 3: rest TRS, root parent and inverse bind per bone. */
  gpuSkeletonFloats: Float32Array;
  /** Packed GPU binding 4: signed parent index bits and topological order. */
  gpuSkeletonMeta: Uint32Array;
};

export type ExactGpuAnimationStaticBinding = {
  binding: 0 | 1 | 2 | 3 | 4;
  label: string;
  data: Uint32Array | Float32Array;
};

export type ExactGpuAnimationReferenceWorkspace = {
  modelBoneMatrices: THREE.Matrix4[];
  skinMatrices: THREE.Matrix4[];
  localMatrix: THREE.Matrix4;
  positionA: THREE.Vector3;
  positionB: THREE.Vector3;
  quaternionA: THREE.Quaternion;
  quaternionB: THREE.Quaternion;
  scaleA: THREE.Vector3;
  scaleB: THREE.Vector3;
};

/**
 * Minimal per-instance control stream for the GPU evaluator. The full authored
 * keys are immutable GPU storage; a frame uploads only two clip indices, two
 * exact times and one crossfade weight per visible actor.
 */
export class ExactGpuAnimationStateBuffer {
  /** 32-byte WGSL AnimationState records, exposed through matching typed views. */
  readonly storage: ArrayBuffer;
  readonly words: Uint32Array;
  readonly floats: Float32Array;
  readonly library: ExactGpuAnimationLibrary;
  readonly capacity: number;

  private countValue = 0;
  private dirtyStart = Number.POSITIVE_INFINITY;
  private dirtyEnd = 0;

  constructor(library: ExactGpuAnimationLibrary, capacity: number) {
    this.library = library;
    this.capacity = capacity;
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(`Exact GPU animation capacity must be positive; got ${capacity}`);
    }
    this.storage = new ArrayBuffer(
      capacity * ExactGpuAnimationLibrary.STATE_BYTES_PER_INSTANCE,
    );
    this.words = new Uint32Array(this.storage);
    this.floats = new Float32Array(this.storage);
    for (let index = 0; index < capacity; index++) {
      const offset = index * ExactGpuAnimationLibrary.STATE_WORDS_PER_INSTANCE;
      this.words[offset] = EXACT_GPU_ANIMATION_NO_CLIP;
      this.words[offset + 1] = EXACT_GPU_ANIMATION_NO_CLIP;
    }
  }

  get count(): number {
    return this.countValue;
  }

  setCount(count: number): void {
    if (!Number.isInteger(count) || count < 0 || count > this.capacity) {
      throw new RangeError(
        `Exact GPU animation count ${count} is outside capacity ${this.capacity}`,
      );
    }
    this.countValue = count;
  }

  setAt(index: number, state: ExactGpuAnimationState): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.capacity) {
      throw new RangeError(`Exact GPU animation instance ${index} is outside capacity`);
    }
    const primaryClip = this.library.resolveClipIndex(state.primaryClip);
    const secondaryClip = state.secondaryClip == null
      ? EXACT_GPU_ANIMATION_NO_CLIP
      : this.library.resolveClipIndex(state.secondaryClip);
    const blend = THREE.MathUtils.clamp(state.blend ?? 0, 0, 1);
    const offset = index * ExactGpuAnimationLibrary.STATE_WORDS_PER_INSTANCE;
    this.words[offset] = primaryClip;
    this.words[offset + 1] = secondaryClip;
    this.words[offset + 2] = 0;
    this.words[offset + 3] = 0;
    this.floats[offset + 4] = state.primaryTime;
    this.floats[offset + 5] = state.secondaryTime ?? 0;
    this.floats[offset + 6] = blend;
    this.floats[offset + 7] = 0;
    this.dirtyStart = Math.min(this.dirtyStart, index);
    this.dirtyEnd = Math.max(this.dirtyEnd, index + 1);
  }

  /** Returns a byte range suitable for two GPU queue.writeBuffer calls. */
  consumeDirtyRange(): { firstInstance: number; instanceCount: number; bytes: number } {
    if (!Number.isFinite(this.dirtyStart) || this.dirtyEnd <= this.dirtyStart) {
      return { firstInstance: 0, instanceCount: 0, bytes: 0 };
    }
    const firstInstance = this.dirtyStart;
    const instanceCount = this.dirtyEnd - this.dirtyStart;
    this.dirtyStart = Number.POSITIVE_INFINITY;
    this.dirtyEnd = 0;
    return {
      firstInstance,
      instanceCount,
      bytes: instanceCount * ExactGpuAnimationLibrary.STATE_BYTES_PER_INSTANCE,
    };
  }
}

/**
 * Compiles authored skeletal clips into a compact, upload-ready GPU database.
 *
 * This is deliberately not a pose/frame texture. Every source key time and
 * full-float value is preserved, and the compute contract performs the same
 * discrete lookup, vector lerp and shortest-path quaternion slerp as Three.js.
 * Unsupported deformation fails during compilation rather than silently
 * replacing, thinning or lowering the quality of the asset.
 */
export class ExactGpuAnimationLibrary {
  static readonly STATE_WORDS_PER_INSTANCE = 8;
  static readonly STATE_BYTES_PER_INSTANCE = ExactGpuAnimationLibrary.STATE_WORDS_PER_INSTANCE
    * Uint32Array.BYTES_PER_ELEMENT;

  readonly name: string;
  readonly boneNames: readonly string[];
  readonly clipNames: readonly string[];
  readonly upload: ExactGpuAnimationUploadLayout;

  private readonly skeleton: THREE.Skeleton;
  private readonly clipNameToIndex = new Map<string, number>();
  private readonly topology: readonly number[];
  private readonly rootParentMatrixObjects: readonly THREE.Matrix4[];
  private readonly inverseBindMatrixObjects: readonly THREE.Matrix4[];
  private readonly clips: readonly THREE.AnimationClip[];
  private readonly diagnostic: ExactGpuAnimationLibraryDiagnostic;

  constructor(options: ExactGpuAnimationLibraryOptions) {
    this.name = options.name ?? `${options.sourceRoot.name || 'Authored rig'} exact animations`;
    this.clips = options.clips;
    this.skeleton = findSingleAuthoredSkeleton(options.sourceRoot);
    this.boneNames = this.skeleton.bones.map((bone) => bone.name);
    assertUniqueNonemptyNames(this.boneNames, 'bone');
    this.clipNames = options.clips.map((clip) => clip.name);
    assertUniqueNonemptyNames(this.clipNames, 'animation clip');
    this.clipNames.forEach((name, index) => this.clipNameToIndex.set(name, index));

    options.sourceRoot.updateWorldMatrix(true, true);
    const hierarchy = inspectBoneHierarchy(options.sourceRoot, this.skeleton);
    this.topology = hierarchy.topology;
    this.rootParentMatrixObjects = hierarchy.rootParentMatrices;
    this.inverseBindMatrixObjects = relativeInverseBinds(
      options.sourceRoot,
      this.skeleton,
    );

    const compiled = compileTracks(this.skeleton, options.clips);
    this.upload = {
      trackDescriptors: compiled.trackDescriptors,
      keyTimes: compiled.keyTimes,
      keyValues: compiled.keyValues,
      clipDurations: new Float32Array(options.clips.map((clip) => clip.duration)),
      parentIndices: hierarchy.parentIndices,
      topologicalBoneOrder: new Uint32Array(hierarchy.topology),
      rootParentMatrices: matricesToFloat32(hierarchy.rootParentMatrices),
      inverseBindMatrices: matricesToFloat32(this.inverseBindMatrixObjects),
      restPositions: vectorsToFloat32(this.skeleton.bones.map((bone) => bone.position)),
      restQuaternions: quaternionsToFloat32(
        this.skeleton.bones.map((bone) => bone.quaternion),
      ),
      restScales: vectorsToFloat32(this.skeleton.bones.map((bone) => bone.scale)),
      gpuSkeletonFloats: packGpuSkeletonFloats(
        this.skeleton,
        hierarchy.rootParentMatrices,
        this.inverseBindMatrixObjects,
      ),
      gpuSkeletonMeta: packGpuSkeletonMeta(
        hierarchy.parentIndices,
        hierarchy.topology,
      ),
    };

    const gpuStaticBytes = compiled.trackDescriptors.byteLength
      + compiled.keyTimes.byteLength
      + compiled.keyValues.byteLength
      + this.upload.gpuSkeletonFloats.byteLength
      + this.upload.gpuSkeletonMeta.byteLength;
    const interpolationModes = new Set<string>();
    for (let offset = 3; offset < compiled.trackDescriptors.length; offset += TRACK_COMPONENTS) {
      const mode = compiled.trackDescriptors[offset];
      if (mode === EXACT_GPU_INTERPOLATION_DISCRETE) interpolationModes.add('discrete');
      if (mode === EXACT_GPU_INTERPOLATION_LINEAR) interpolationModes.add('linear');
    }
    this.diagnostic = {
      name: this.name,
      clipCount: options.clips.length,
      boneCount: this.skeleton.bones.length,
      trackCount: compiled.sourceTrackCount,
      keyCount: compiled.keyTimes.length,
      keyValueCount: compiled.keyValues.length,
      sourceKeyBytes: compiled.keyTimes.byteLength + compiled.keyValues.byteLength,
      gpuStaticBytes,
      stateBytesPerInstance: ExactGpuAnimationLibrary.STATE_BYTES_PER_INSTANCE,
      paletteBytesPerInstance: this.skeleton.bones.length * MATRIX_COMPONENTS
        * Float32Array.BYTES_PER_ELEMENT,
      modelBoneBytesPerInstance: this.skeleton.bones.length * MATRIX_COMPONENTS
        * Float32Array.BYTES_PER_ELEMENT,
      maximumHierarchyDepth: hierarchy.maximumDepth,
      interpolationModes: [...interpolationModes],
      exactSourceKeysPreserved: true,
      poseQuantization: false,
      boneReduction: false,
      animationLod: false,
    };
  }

  createStateBuffer(capacity: number): ExactGpuAnimationStateBuffer {
    return new ExactGpuAnimationStateBuffer(this, capacity);
  }

  /** Exact binding order consumed by buildComputeWgsl(). */
  gpuStaticBindings(): readonly ExactGpuAnimationStaticBinding[] {
    return [
      { binding: 0, label: 'track descriptors', data: this.upload.trackDescriptors },
      { binding: 1, label: 'key times', data: this.upload.keyTimes },
      { binding: 2, label: 'key values', data: this.upload.keyValues },
      { binding: 3, label: 'packed skeleton floats', data: this.upload.gpuSkeletonFloats },
      { binding: 4, label: 'packed skeleton metadata', data: this.upload.gpuSkeletonMeta },
    ];
  }

  createRuntimeUniforms(instanceCount: number): Uint32Array {
    if (!Number.isInteger(instanceCount) || instanceCount < 0) {
      throw new RangeError(`Exact GPU animation instance count ${instanceCount} is invalid`);
    }
    return new Uint32Array([instanceCount, 0, 0, 0]);
  }

  outputPaletteFloatCount(capacity: number): number {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(`Exact GPU animation capacity ${capacity} is invalid`);
    }
    return capacity * this.skeleton.bones.length * MATRIX_COMPONENTS;
  }

  dispatchWorkgroupCount(instanceCount: number): number {
    if (!Number.isInteger(instanceCount) || instanceCount < 0) {
      throw new RangeError(`Exact GPU animation instance count ${instanceCount} is invalid`);
    }
    return Math.ceil(instanceCount / 64);
  }

  createReferenceWorkspace(): ExactGpuAnimationReferenceWorkspace {
    return {
      modelBoneMatrices: this.skeleton.bones.map(() => new THREE.Matrix4()),
      skinMatrices: this.skeleton.bones.map(() => new THREE.Matrix4()),
      localMatrix: new THREE.Matrix4(),
      positionA: new THREE.Vector3(),
      positionB: new THREE.Vector3(),
      quaternionA: new THREE.Quaternion(),
      quaternionB: new THREE.Quaternion(),
      scaleA: new THREE.Vector3(),
      scaleB: new THREE.Vector3(),
    };
  }

  resolveClipIndex(clip: number | string): number {
    if (typeof clip === 'number') {
      if (!Number.isInteger(clip) || clip < 0 || clip >= this.clips.length) {
        throw new RangeError(`Animation clip index ${clip} is outside this library`);
      }
      return clip;
    }
    const index = this.clipNameToIndex.get(clip);
    if (index == null) throw new Error(`Animation clip ${clip} is not in ${this.name}`);
    return index;
  }

  clipDuration(clip: number | string): number {
    return this.clips[this.resolveClipIndex(clip)]!.duration;
  }

  boneIndex(name: string): number {
    const index = this.boneNames.indexOf(name);
    if (index < 0) throw new Error(`Bone ${name} is not in ${this.name}`);
    return index;
  }

  diagnostics(): ExactGpuAnimationLibraryDiagnostic {
    return this.diagnostic;
  }

  /**
   * Exact CPU oracle for tests and the small number of flag-cloth pose observers.
   * Visible bodies and rigid equipment should consume the GPU output directly.
   */
  evaluateReferenceInto(
    state: ExactGpuAnimationState,
    skinPalette: Float32Array,
    modelBones?: Float32Array,
    workspace = this.createReferenceWorkspace(),
  ): void {
    const requiredComponents = this.skeleton.bones.length * MATRIX_COMPONENTS;
    if (skinPalette.length < requiredComponents) {
      throw new RangeError(`Skin palette requires ${requiredComponents} float components`);
    }
    if (modelBones && modelBones.length < requiredComponents) {
      throw new RangeError(`Model-bone palette requires ${requiredComponents} float components`);
    }
    const primaryClip = this.resolveClipIndex(state.primaryClip);
    const secondaryClip = state.secondaryClip == null
      ? EXACT_GPU_ANIMATION_NO_CLIP
      : this.resolveClipIndex(state.secondaryClip);
    const blend = secondaryClip === EXACT_GPU_ANIMATION_NO_CLIP
      ? 0
      : THREE.MathUtils.clamp(state.blend ?? 0, 0, 1);

    for (const boneIndex of this.topology) {
      this.sampleVector(primaryClip, boneIndex, POSITION_SLOT, state.primaryTime, workspace.positionA);
      this.sampleQuaternion(
        primaryClip,
        boneIndex,
        state.primaryTime,
        workspace.quaternionA,
      );
      this.sampleVector(primaryClip, boneIndex, SCALE_SLOT, state.primaryTime, workspace.scaleA);

      if (blend > 0) {
        this.sampleVector(
          secondaryClip,
          boneIndex,
          POSITION_SLOT,
          state.secondaryTime ?? 0,
          workspace.positionB,
        );
        this.sampleQuaternion(
          secondaryClip,
          boneIndex,
          state.secondaryTime ?? 0,
          workspace.quaternionB,
        );
        this.sampleVector(
          secondaryClip,
          boneIndex,
          SCALE_SLOT,
          state.secondaryTime ?? 0,
          workspace.scaleB,
        );
        workspace.positionA.lerp(workspace.positionB, blend);
        workspace.quaternionA.slerp(workspace.quaternionB, blend);
        workspace.scaleA.lerp(workspace.scaleB, blend);
      }

      workspace.localMatrix.compose(
        workspace.positionA,
        workspace.quaternionA,
        workspace.scaleA,
      );
      const parentIndex = this.upload.parentIndices[boneIndex]!;
      const modelMatrix = workspace.modelBoneMatrices[boneIndex]!;
      if (parentIndex >= 0) {
        modelMatrix.multiplyMatrices(
          workspace.modelBoneMatrices[parentIndex]!,
          workspace.localMatrix,
        );
      } else {
        modelMatrix.multiplyMatrices(
          this.rootParentMatrixObjects[boneIndex]!,
          workspace.localMatrix,
        );
      }
      const skinMatrix = workspace.skinMatrices[boneIndex]!;
      skinMatrix.multiplyMatrices(modelMatrix, this.inverseBindMatrixObjects[boneIndex]!);
      skinMatrix.toArray(skinPalette, boneIndex * MATRIX_COMPONENTS);
      if (modelBones) modelMatrix.toArray(modelBones, boneIndex * MATRIX_COMPONENTS);
    }
  }

  /**
   * Standalone WGSL compute contract. Integration creates immutable storage
   * buffers from upload, dynamic state buffers from ExactGpuAnimationStateBuffer,
   * and two writable palettes. One invocation owns one complete actor, so parent
   * bones are deterministically available without cross-workgroup barriers.
   */
  buildComputeWgsl(bindGroup = 0): string {
    return buildExactGpuAnimationComputeWgsl({
      bindGroup,
      boneCount: this.skeleton.bones.length,
      clipCount: this.clips.length,
    });
  }

  private descriptorOffset(clip: number, bone: number, slot: number): number {
    return ((clip * this.skeleton.bones.length + bone) * TRACKS_PER_BONE + slot)
      * TRACK_COMPONENTS;
  }

  private sampleVector(
    clip: number,
    bone: number,
    slot: number,
    time: number,
    target: THREE.Vector3,
  ): void {
    const descriptorOffset = this.descriptorOffset(clip, bone, slot);
    const keyCount = this.upload.trackDescriptors[descriptorOffset + 1]!;
    if (keyCount === 0) {
      const rest = slot === POSITION_SLOT ? this.upload.restPositions : this.upload.restScales;
      const offset = bone * 3;
      target.set(rest[offset]!, rest[offset + 1]!, rest[offset + 2]!);
      return;
    }
    const keyOffset = this.upload.trackDescriptors[descriptorOffset]!;
    const valueOffset = this.upload.trackDescriptors[descriptorOffset + 2]!;
    const interpolation = this.upload.trackDescriptors[descriptorOffset + 3]!;
    const left = findLeftKey(this.upload.keyTimes, keyOffset, keyCount, time);
    const leftValue = valueOffset + left * 3;
    target.set(
      this.upload.keyValues[leftValue]!,
      this.upload.keyValues[leftValue + 1]!,
      this.upload.keyValues[leftValue + 2]!,
    );
    if (interpolation !== EXACT_GPU_INTERPOLATION_LINEAR || left + 1 >= keyCount) return;
    const alpha = keyAlpha(this.upload.keyTimes, keyOffset, left, time);
    const rightValue = leftValue + 3;
    target.x += (this.upload.keyValues[rightValue]! - target.x) * alpha;
    target.y += (this.upload.keyValues[rightValue + 1]! - target.y) * alpha;
    target.z += (this.upload.keyValues[rightValue + 2]! - target.z) * alpha;
  }

  private sampleQuaternion(
    clip: number,
    bone: number,
    time: number,
    target: THREE.Quaternion,
  ): void {
    const descriptorOffset = this.descriptorOffset(clip, bone, QUATERNION_SLOT);
    const keyCount = this.upload.trackDescriptors[descriptorOffset + 1]!;
    if (keyCount === 0) {
      const offset = bone * 4;
      target.set(
        this.upload.restQuaternions[offset]!,
        this.upload.restQuaternions[offset + 1]!,
        this.upload.restQuaternions[offset + 2]!,
        this.upload.restQuaternions[offset + 3]!,
      );
      return;
    }
    const keyOffset = this.upload.trackDescriptors[descriptorOffset]!;
    const valueOffset = this.upload.trackDescriptors[descriptorOffset + 2]!;
    const interpolation = this.upload.trackDescriptors[descriptorOffset + 3]!;
    const left = findLeftKey(this.upload.keyTimes, keyOffset, keyCount, time);
    const leftValue = valueOffset + left * 4;
    target.set(
      this.upload.keyValues[leftValue]!,
      this.upload.keyValues[leftValue + 1]!,
      this.upload.keyValues[leftValue + 2]!,
      this.upload.keyValues[leftValue + 3]!,
    );
    if (interpolation !== EXACT_GPU_INTERPOLATION_LINEAR || left + 1 >= keyCount) return;
    const alpha = keyAlpha(this.upload.keyTimes, keyOffset, left, time);
    const rightValue = leftValue + 4;
    workspaceQuaternion.set(
      this.upload.keyValues[rightValue]!,
      this.upload.keyValues[rightValue + 1]!,
      this.upload.keyValues[rightValue + 2]!,
      this.upload.keyValues[rightValue + 3]!,
    );
    target.slerp(workspaceQuaternion, alpha);
  }
}

const workspaceQuaternion = new THREE.Quaternion();

export function wrapExactAnimationTime(time: number, duration: number): number {
  if (!(duration > 0) || !Number.isFinite(duration)) return 0;
  return THREE.MathUtils.euclideanModulo(time, duration);
}

export function clampExactAnimationTime(time: number, duration: number): number {
  if (!(duration > 0) || !Number.isFinite(duration)) return 0;
  return THREE.MathUtils.clamp(time, 0, duration);
}

export function buildExactGpuAnimationComputeWgsl(options: {
  bindGroup?: number;
  boneCount: number;
  clipCount: number;
}): string {
  const bindGroup = options.bindGroup ?? 0;
  if (!Number.isInteger(bindGroup) || bindGroup < 0) throw new RangeError('Invalid bind group');
  if (!Number.isInteger(options.boneCount) || options.boneCount < 1) {
    throw new RangeError('Exact GPU animation requires at least one bone');
  }
  if (!Number.isInteger(options.clipCount) || options.clipCount < 1) {
    throw new RangeError('Exact GPU animation requires at least one clip');
  }
  return `
const BONE_COUNT: u32 = ${options.boneCount}u;
const CLIP_COUNT: u32 = ${options.clipCount}u;
const NO_CLIP: u32 = 0xffffffffu;
const TRACKS_PER_BONE: u32 = 3u;
const INTERPOLATION_DISCRETE: u32 = 1u;
const INTERPOLATION_LINEAR: u32 = 2u;

struct RuntimeUniforms {
  instanceCount: u32,
  padding0: u32,
  padding1: u32,
  padding2: u32,
};
struct AnimationState {
  clips: vec2<u32>,
  padding: vec2<u32>,
  timesAndBlend: vec4<f32>,
};
@group(${bindGroup}) @binding(0) var<storage, read> trackDescriptors: array<vec4<u32>>;
@group(${bindGroup}) @binding(1) var<storage, read> keyTimes: array<f32>;
@group(${bindGroup}) @binding(2) var<storage, read> keyValues: array<f32>;
@group(${bindGroup}) @binding(3) var<storage, read> skeletonFloats: array<f32>;
@group(${bindGroup}) @binding(4) var<storage, read> skeletonMeta: array<u32>;
@group(${bindGroup}) @binding(5) var<storage, read> animationStates: array<AnimationState>;
@group(${bindGroup}) @binding(6) var<storage, read_write> modelBones: array<mat4x4<f32>>;
@group(${bindGroup}) @binding(7) var<storage, read_write> skinPalettes: array<mat4x4<f32>>;
@group(${bindGroup}) @binding(8) var<uniform> runtime: RuntimeUniforms;

fn descriptor_index(clip: u32, bone: u32, property: u32) -> u32 {
  return (clip * BONE_COUNT + bone) * TRACKS_PER_BONE + property;
}

fn skeleton_matrix(offset: u32) -> mat4x4<f32> {
  return mat4x4<f32>(
    vec4<f32>(skeletonFloats[offset], skeletonFloats[offset + 1u], skeletonFloats[offset + 2u], skeletonFloats[offset + 3u]),
    vec4<f32>(skeletonFloats[offset + 4u], skeletonFloats[offset + 5u], skeletonFloats[offset + 6u], skeletonFloats[offset + 7u]),
    vec4<f32>(skeletonFloats[offset + 8u], skeletonFloats[offset + 9u], skeletonFloats[offset + 10u], skeletonFloats[offset + 11u]),
    vec4<f32>(skeletonFloats[offset + 12u], skeletonFloats[offset + 13u], skeletonFloats[offset + 14u], skeletonFloats[offset + 15u])
  );
}

fn left_key(descriptor: vec4<u32>, time: f32) -> u32 {
  var low = 0u;
  var high = descriptor.y;
  loop {
    if (low >= high) { break; }
    let middle = low + (high - low) / 2u;
    if (keyTimes[descriptor.x + middle] <= time) { low = middle + 1u; }
    else { high = middle; }
  }
  if (low == 0u) { return 0u; }
  return min(low - 1u, descriptor.y - 1u);
}

fn interpolation_alpha(descriptor: vec4<u32>, left: u32, time: f32) -> f32 {
  if (descriptor.w != INTERPOLATION_LINEAR || left + 1u >= descriptor.y) { return 0.0; }
  let leftTime = keyTimes[descriptor.x + left];
  let rightTime = keyTimes[descriptor.x + left + 1u];
  if (rightTime <= leftTime) { return 0.0; }
  return clamp((time - leftTime) / (rightTime - leftTime), 0.0, 1.0);
}

fn sample_vec3(clip: u32, bone: u32, property: u32, time: f32, rest: vec3<f32>) -> vec3<f32> {
  let descriptor = trackDescriptors[descriptor_index(clip, bone, property)];
  if (descriptor.y == 0u) { return rest; }
  let left = left_key(descriptor, time);
  let first = descriptor.z + left * 3u;
  let valueA = vec3<f32>(keyValues[first], keyValues[first + 1u], keyValues[first + 2u]);
  let alpha = interpolation_alpha(descriptor, left, time);
  if (alpha == 0.0) { return valueA; }
  let second = first + 3u;
  let valueB = vec3<f32>(keyValues[second], keyValues[second + 1u], keyValues[second + 2u]);
  return mix(valueA, valueB, alpha);
}

fn normalize_quaternion(value: vec4<f32>) -> vec4<f32> {
  return value * inverseSqrt(max(dot(value, value), 1e-20));
}

fn slerp_quaternion(a: vec4<f32>, bInput: vec4<f32>, alpha: f32) -> vec4<f32> {
  if (all(a == bInput)) { return a; }
  var b = bInput;
  var cosine = dot(a, b);
  if (cosine < 0.0) { b = -b; cosine = -cosine; }
  if (cosine < 0.9995) {
    let angle = acos(cosine);
    let denominator = sin(angle);
    return (sin((1.0 - alpha) * angle) / denominator) * a
      + (sin(alpha * angle) / denominator) * b;
  }
  return normalize_quaternion(mix(a, b, alpha));
}

fn sample_quaternion(clip: u32, bone: u32, time: f32, rest: vec4<f32>) -> vec4<f32> {
  let descriptor = trackDescriptors[descriptor_index(clip, bone, 1u)];
  if (descriptor.y == 0u) { return rest; }
  let left = left_key(descriptor, time);
  let first = descriptor.z + left * 4u;
  let valueA = vec4<f32>(
    keyValues[first], keyValues[first + 1u], keyValues[first + 2u], keyValues[first + 3u]
  );
  let alpha = interpolation_alpha(descriptor, left, time);
  if (alpha == 0.0) { return valueA; }
  let second = first + 4u;
  let valueB = vec4<f32>(
    keyValues[second], keyValues[second + 1u], keyValues[second + 2u], keyValues[second + 3u]
  );
  return slerp_quaternion(valueA, valueB, alpha);
}

fn compose_trs(position: vec3<f32>, quaternionInput: vec4<f32>, scale: vec3<f32>) -> mat4x4<f32> {
  let q = quaternionInput;
  let x2 = q.x + q.x; let y2 = q.y + q.y; let z2 = q.z + q.z;
  let xx = q.x * x2; let xy = q.x * y2; let xz = q.x * z2;
  let yy = q.y * y2; let yz = q.y * z2; let zz = q.z * z2;
  let wx = q.w * x2; let wy = q.w * y2; let wz = q.w * z2;
  return mat4x4<f32>(
    vec4<f32>((1.0 - (yy + zz)) * scale.x, (xy + wz) * scale.x, (xz - wy) * scale.x, 0.0),
    vec4<f32>((xy - wz) * scale.y, (1.0 - (xx + zz)) * scale.y, (yz + wx) * scale.y, 0.0),
    vec4<f32>((xz + wy) * scale.z, (yz - wx) * scale.z, (1.0 - (xx + yy)) * scale.z, 0.0),
    vec4<f32>(position, 1.0)
  );
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let instance = globalId.x;
  if (instance >= runtime.instanceCount) { return; }
  let state = animationStates[instance];
  let clips = state.clips;
  let timesAndBlend = state.timesAndBlend;
  if (clips.x >= CLIP_COUNT) { return; }
  let blend = select(clamp(timesAndBlend.z, 0.0, 1.0), 0.0, clips.y == NO_CLIP);
  let paletteBase = instance * BONE_COUNT;
  for (var topologyIndex = 0u; topologyIndex < BONE_COUNT; topologyIndex += 1u) {
    let bone = skeletonMeta[topologyIndex * 4u + 1u];
    let skeletonOffset = bone * 44u;
    let restPosition = vec3<f32>(skeletonFloats[skeletonOffset], skeletonFloats[skeletonOffset + 1u], skeletonFloats[skeletonOffset + 2u]);
    let restRotation = vec4<f32>(skeletonFloats[skeletonOffset + 4u], skeletonFloats[skeletonOffset + 5u], skeletonFloats[skeletonOffset + 6u], skeletonFloats[skeletonOffset + 7u]);
    let restScale = vec3<f32>(skeletonFloats[skeletonOffset + 8u], skeletonFloats[skeletonOffset + 9u], skeletonFloats[skeletonOffset + 10u]);
    var position = sample_vec3(clips.x, bone, 0u, timesAndBlend.x, restPosition);
    var rotation = sample_quaternion(clips.x, bone, timesAndBlend.x, restRotation);
    var scale = sample_vec3(clips.x, bone, 2u, timesAndBlend.x, restScale);
    if (blend > 0.0) {
      position = mix(position, sample_vec3(clips.y, bone, 0u, timesAndBlend.y, restPosition), blend);
      rotation = slerp_quaternion(rotation, sample_quaternion(clips.y, bone, timesAndBlend.y, restRotation), blend);
      scale = mix(scale, sample_vec3(clips.y, bone, 2u, timesAndBlend.y, restScale), blend);
    }
    let localMatrix = compose_trs(position, rotation, scale);
    let parent = bitcast<i32>(skeletonMeta[bone * 4u]);
    var modelMatrix = skeleton_matrix(skeletonOffset + 12u) * localMatrix;
    if (parent >= 0) { modelMatrix = modelBones[paletteBase + u32(parent)] * localMatrix; }
    modelBones[paletteBase + bone] = modelMatrix;
    skinPalettes[paletteBase + bone] = modelMatrix * skeleton_matrix(skeletonOffset + 28u);
  }
}
`;
}

function findSingleAuthoredSkeleton(root: THREE.Object3D): THREE.Skeleton {
  let skeleton: THREE.Skeleton | null = null;
  root.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    if (skeleton && skeleton !== mesh.skeleton) {
      const sameLayout = skeleton.bones.length === mesh.skeleton.bones.length
        && skeleton.bones.every((bone, index) => bone === mesh.skeleton.bones[index]);
      if (!sameLayout) {
        throw new Error('Exact GPU animation currently requires one authored skeleton layout');
      }
    }
    skeleton = mesh.skeleton;
  });
  if (!skeleton) throw new Error(`${root.name || root.type} contains no authored skeleton`);
  return skeleton;
}

function assertUniqueNonemptyNames(names: readonly string[], label: string): void {
  const found = new Set<string>();
  for (const name of names) {
    if (!name) throw new Error(`Exact GPU animation requires every ${label} to be named`);
    if (found.has(name)) throw new Error(`Duplicate ${label} name ${name} is ambiguous`);
    found.add(name);
  }
}

function inspectBoneHierarchy(root: THREE.Object3D, skeleton: THREE.Skeleton): {
  parentIndices: Int32Array;
  topology: number[];
  rootParentMatrices: THREE.Matrix4[];
  maximumDepth: number;
} {
  const boneIndices = new Map<THREE.Bone, number>();
  skeleton.bones.forEach((bone, index) => boneIndices.set(bone, index));
  const parentIndices = new Int32Array(skeleton.bones.length);
  const rootParentMatrices = skeleton.bones.map(() => new THREE.Matrix4());
  const rootInverse = root.matrixWorld.clone().invert();
  for (let index = 0; index < skeleton.bones.length; index++) {
    const bone = skeleton.bones[index]!;
    const parent = bone.parent instanceof THREE.Bone ? boneIndices.get(bone.parent) : undefined;
    parentIndices[index] = parent ?? -1;
    if (parent == null && bone.parent) {
      rootParentMatrices[index]!.multiplyMatrices(rootInverse, bone.parent.matrixWorld);
    }
  }

  const depths = new Int32Array(skeleton.bones.length);
  const visiting = new Uint8Array(skeleton.bones.length);
  const findDepth = (index: number): number => {
    if (depths[index]! > 0 || parentIndices[index] === -1) return depths[index]!;
    if (visiting[index]) throw new Error('Authored skeleton hierarchy contains a cycle');
    visiting[index] = 1;
    const parent = parentIndices[index]!;
    const depth = findDepth(parent) + 1;
    visiting[index] = 0;
    depths[index] = depth;
    return depth;
  };
  for (let index = 0; index < skeleton.bones.length; index++) findDepth(index);
  const topology = skeleton.bones.map((_bone, index) => index)
    .sort((left, right) => depths[left]! - depths[right]! || left - right);
  return {
    parentIndices,
    topology,
    rootParentMatrices,
    maximumDepth: Math.max(...depths),
  };
}

function relativeInverseBinds(
  root: THREE.Object3D,
  skeleton: THREE.Skeleton,
): THREE.Matrix4[] {
  if (skeleton.boneInverses.length !== skeleton.bones.length) {
    throw new Error('Authored skeleton inverse-bind count differs from its bone count');
  }
  return skeleton.boneInverses.map((inverse) => inverse.clone().multiply(root.matrixWorld));
}

function compileTracks(skeleton: THREE.Skeleton, clips: readonly THREE.AnimationClip[]): {
  trackDescriptors: Uint32Array;
  keyTimes: Float32Array;
  keyValues: Float32Array;
  sourceTrackCount: number;
} {
  if (clips.length < 1) throw new Error('Exact GPU animation library requires authored clips');
  const boneIndices = new Map<string, number>();
  skeleton.bones.forEach((bone, index) => boneIndices.set(bone.name, index));
  const descriptorCount = clips.length * skeleton.bones.length * TRACKS_PER_BONE;
  const descriptors = new Uint32Array(descriptorCount * TRACK_COMPONENTS);
  const times: number[] = [];
  const values: number[] = [];
  let sourceTrackCount = 0;

  clips.forEach((clip, clipIndex) => {
    if (!(clip.duration > 0) || !Number.isFinite(clip.duration)) {
      throw new Error(`Animation clip ${clip.name} has invalid duration ${clip.duration}`);
    }
    for (const track of clip.tracks) {
      sourceTrackCount += 1;
      const parsed = THREE.PropertyBinding.parseTrackName(track.name);
      if (parsed.objectName || parsed.objectIndex != null || parsed.propertyIndex != null) {
        throw new Error(`Animation track ${track.name} uses an unsupported indirect binding`);
      }
      const boneIndex = boneIndices.get(parsed.nodeName);
      if (boneIndex == null) {
        throw new Error(
          `Animation track ${track.name} targets a non-skeletal node; refusing to drop it`,
        );
      }
      const property = parsed.propertyName;
      const slot = property === 'position'
        ? POSITION_SLOT
        : property === 'quaternion'
          ? QUATERNION_SLOT
          : property === 'scale'
            ? SCALE_SLOT
            : -1;
      if (slot < 0) {
        throw new Error(`Animation track ${track.name} is not exact skeletal TRS`);
      }
      const expectedSize = slot === QUATERNION_SLOT ? 4 : 3;
      if (track.getValueSize() !== expectedSize) {
        throw new Error(
          `Animation track ${track.name} has value size ${track.getValueSize()}, expected ${expectedSize}`,
        );
      }
      const interpolation = track.getInterpolation() === THREE.InterpolateDiscrete
        ? EXACT_GPU_INTERPOLATION_DISCRETE
        : track.getInterpolation() === THREE.InterpolateLinear
          ? EXACT_GPU_INTERPOLATION_LINEAR
          : -1;
      if (interpolation < 0) {
        throw new Error(
          `Animation track ${track.name} uses unsupported interpolation ${track.getInterpolation()}; `
            + 'refusing to resample or quantize it',
        );
      }
      if (track.times.length < 1) throw new Error(`Animation track ${track.name} has no keys`);
      if (track.values.length !== track.times.length * expectedSize) {
        throw new Error(`Animation track ${track.name} has malformed key values`);
      }
      for (let key = 0; key < track.times.length; key++) {
        const keyTime = track.times[key]!;
        if (!Number.isFinite(keyTime)) throw new Error(`Animation track ${track.name} has NaN time`);
        if (key > 0 && keyTime < track.times[key - 1]!) {
          throw new Error(`Animation track ${track.name} key times are not ordered`);
        }
      }
      const descriptorIndex = (
        (clipIndex * skeleton.bones.length + boneIndex) * TRACKS_PER_BONE + slot
      ) * TRACK_COMPONENTS;
      if (descriptors[descriptorIndex + 1] !== 0) {
        throw new Error(`Animation clip ${clip.name} binds ${track.name} more than once`);
      }
      descriptors[descriptorIndex] = times.length;
      descriptors[descriptorIndex + 1] = track.times.length;
      descriptors[descriptorIndex + 2] = values.length;
      descriptors[descriptorIndex + 3] = interpolation;
      for (const time of track.times) times.push(time);
      for (const value of track.values) values.push(value);
    }
  });

  return {
    trackDescriptors: descriptors,
    keyTimes: new Float32Array(times),
    keyValues: new Float32Array(values),
    sourceTrackCount,
  };
}

function matricesToFloat32(matrices: readonly THREE.Matrix4[]): Float32Array {
  const result = new Float32Array(matrices.length * MATRIX_COMPONENTS);
  matrices.forEach((matrix, index) => matrix.toArray(result, index * MATRIX_COMPONENTS));
  return result;
}

function vectorsToFloat32(vectors: readonly THREE.Vector3[]): Float32Array {
  const result = new Float32Array(vectors.length * 3);
  vectors.forEach((vector, index) => vector.toArray(result, index * 3));
  return result;
}

function quaternionsToFloat32(quaternions: readonly THREE.Quaternion[]): Float32Array {
  const result = new Float32Array(quaternions.length * 4);
  quaternions.forEach((quaternion, index) => quaternion.toArray(result, index * 4));
  return result;
}

function packGpuSkeletonFloats(
  skeleton: THREE.Skeleton,
  rootParentMatrices: readonly THREE.Matrix4[],
  inverseBindMatrices: readonly THREE.Matrix4[],
): Float32Array {
  const stride = 44;
  const result = new Float32Array(skeleton.bones.length * stride);
  skeleton.bones.forEach((bone, index) => {
    const offset = index * stride;
    bone.position.toArray(result, offset);
    bone.quaternion.toArray(result, offset + 4);
    bone.scale.toArray(result, offset + 8);
    rootParentMatrices[index]!.toArray(result, offset + 12);
    inverseBindMatrices[index]!.toArray(result, offset + 28);
  });
  return result;
}

function packGpuSkeletonMeta(
  parentIndices: Int32Array,
  topology: readonly number[],
): Uint32Array {
  const result = new Uint32Array(parentIndices.length * 4);
  for (let index = 0; index < parentIndices.length; index++) {
    const offset = index * 4;
    result[offset] = parentIndices[index]! >>> 0;
    result[offset + 1] = topology[index]!;
  }
  return result;
}

function findLeftKey(
  times: Float32Array,
  offset: number,
  count: number,
  time: number,
): number {
  let low = 0;
  let high = count;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (times[offset + middle]! <= time) low = middle + 1;
    else high = middle;
  }
  return Math.max(0, Math.min(count - 1, low - 1));
}

function keyAlpha(times: Float32Array, offset: number, left: number, time: number): number {
  const leftTime = times[offset + left]!;
  const rightTime = times[offset + left + 1]!;
  if (rightTime <= leftTime) return 0;
  return THREE.MathUtils.clamp((time - leftTime) / (rightTime - leftTime), 0, 1);
}
