import * as THREE from 'three';
import type { StorageBufferAttribute } from 'three/webgpu';
import { ExactGpuAnimationLibrary, EXACT_GPU_ANIMATION_NO_CLIP } from './ExactGpuAnimationLibrary.ts';

/** Mounts whose parent bone world matrix was explicitly evaluated this frame. */
export const authoredGpuObservedMounts = new WeakSet<THREE.Object3D>();
type Observers = {
  mounts: THREE.Object3D[];
  bones: Array<{ node: THREE.Object3D; index: number }>;
  indices: readonly number[];
};

type NativeRenderer = {
  backend: { isWebGPUBackend?: boolean; device: GPUDevice; get(attribute: THREE.BufferAttribute): { buffer: GPUBuffer } };
  _attributes: { update(attribute: THREE.BufferAttribute, type: number): void };
};
type Runtime = {
  device: GPUDevice;
  pipeline: GPUComputePipeline;
  staticBuffers: GPUBuffer[];
  states: GPUBuffer;
  modelBones: GPUBuffer;
  uniforms: GPUBuffer;
  countWords: Uint32Array<ArrayBuffer>;
  capacity: number;
  output: GPUBuffer | null;
  bindings: GPUBindGroup | null;
  epoch: number;
};

/** Original animation keys evaluated once per actor, shared by every render pass. */
export class AuthoredGpuAnimation {
  readonly library: ExactGpuAnimationLibrary;
  private readonly clips = new Map<THREE.AnimationClip, number>();
  private readonly shader: string;
  private states: Uint32Array<ArrayBuffer> = new Uint32Array(0);
  private times: Float32Array<ArrayBuffer> = new Float32Array(0);
  private readonly runtimes = new Map<object, Runtime>();
  private readonly observers = new WeakMap<THREE.Object3D, Observers>();
  private readonly observerWorkspace: ReturnType<ExactGpuAnimationLibrary['createReferenceWorkspace']>;

  constructor(source: THREE.Object3D, animations: readonly THREE.AnimationClip[], meshRelative: THREE.Matrix4) {
    const originals = [...new Set(animations)];
    this.library = new ExactGpuAnimationLibrary({
      sourceRoot: source,
      // Semantic aliases can name different clips identically. Retain the exact
      // source tracks and use stable indices, without changing live clip names.
      clips: originals.map((clip, i) => {
        this.clips.set(clip, i);
        return new THREE.AnimationClip(`authored-${i}`, clip.duration, clip.tracks, clip.blendMode);
      }),
    });
    const meshInverse = matrixLiteral(meshRelative.clone().invert());
    const sourceInverse = matrixLiteral(source.matrixWorld.clone().invert());
    this.shader = this.library.buildComputeWgsl().replace(
      'skinPalettes[paletteBase + bone] = modelMatrix * skeleton_matrix(skeletonOffset + 28u);',
      `skinPalettes[paletteBase + bone] = ${meshInverse} * modelMatrix * skeleton_matrix(skeletonOffset + 28u) * ${sourceInverse};`,
    );
    this.observerWorkspace = this.library.createReferenceWorkspace();
  }

  registerAttachments(model: THREE.Object3D, tool: THREE.Object3D): void {
    const mounts: THREE.Object3D[] = tool.userData.workerToolMounts ?? [tool];
    const bones: Observers['bones'] = [];
    for (const mount of mounts) {
      let bone = mount.parent;
      // Ordinary worker mounts are direct children of their authored hand bone.
      // More complicated corrected military rigs retain normal CPU evaluation.
      if (!bone || !(bone as THREE.Bone).isBone) throw new Error('GPU attachment observer requires a direct authored bone mount');
      if (!bones.some(entry => entry.node === bone)) bones.push({ node: bone, index: this.library.boneIndex(bone.name) });
    }
    this.observers.set(model, { mounts, bones, indices: this.library.observerBoneIndices(bones.map(bone => bone.node.name)) });
  }

  clearObservers(model: THREE.Object3D): void {
    const observers = this.observers.get(model);
    if (!observers) return;
    for (const mount of observers.mounts) authoredGpuObservedMounts.delete(mount);
    // A CPU pose may return to identical local TRS values after a complete
    // animation loop. Still replace the explicitly observed world matrices.
    for (const bone of observers.bones) bone.node.matrixWorldNeedsUpdate = true;
  }

  updateObservers(model: THREE.Object3D, action: THREE.AnimationAction): void {
    const observers = this.observers.get(model);
    if (!observers) return;
    this.library.evaluateObserverBones(this.clips.get(action.getClip())!, action.time, observers.indices, this.observerWorkspace);
    for (const bone of observers.bones) bone.node.matrixWorld.multiplyMatrices(model.matrixWorld, this.observerWorkspace.modelBoneMatrices[bone.index]!);
    for (const mount of observers.mounts) {
      mount.updateWorldMatrix(false, true);
      authoredGpuObservedMounts.add(mount);
    }
  }

  supportsClip = (clip: THREE.AnimationClip): boolean => this.clips.has(clip);

  reserve(capacity: number): void {
    if (this.states.length >= capacity * 8) return;
    const words = new Uint32Array(capacity * 8);
    words.set(this.states);
    for (let i = this.states.length; i < words.length; i += 8) words[i] = EXACT_GPU_ANIMATION_NO_CLIP;
    this.states = words;
    this.times = new Float32Array(words.buffer);
  }

  setAt(slot: number, action: THREE.AnimationAction): void {
    const offset = slot * 8;
    this.states[offset] = this.clips.get(action.getClip())!;
    this.states[offset + 1] = EXACT_GPU_ANIMATION_NO_CLIP;
    this.times[offset + 4] = action.time;
  }

  clearAt(slot: number): void { this.states[slot * 8] = EXACT_GPU_ANIMATION_NO_CLIP; }

  render(rendererObject: object, palette: StorageBufferAttribute, count: number, epoch: number, gpuInstances: number): void {
    const GPUBufferUsage = (globalThis as unknown as { GPUBufferUsage: { STORAGE: number; COPY_DST: number; UNIFORM: number } }).GPUBufferUsage;
    const renderer = rendererObject as NativeRenderer;
    if (!renderer.backend.isWebGPUBackend) throw new Error('Authored GPU animation requires the native WebGPU renderer');
    let runtime = this.runtimes.get(rendererObject);
    if (!runtime) {
      const device = renderer.backend.device;
      const module = device.createShaderModule({ label: 'Exact authored animation keys', code: this.shader });
      runtime = {
        device,
        pipeline: device.createComputePipeline({ label: 'Exact authored pose evaluation', layout: 'auto', compute: { module, entryPoint: 'main' } }),
        staticBuffers: this.library.gpuStaticBindings().map(binding => upload(device, binding.data, GPUBufferUsage.STORAGE, binding.label)),
        states: null!, modelBones: null!, uniforms: null!, countWords: new Uint32Array(4),
        capacity: 0, output: null, bindings: null, epoch: -1,
      };
      this.runtimes.set(rendererObject, runtime);
    }
    if (runtime.epoch === epoch || gpuInstances === 0) return;
    const { device } = runtime;
    if (runtime.capacity < this.states.length / 8) {
      runtime.states?.destroy(); runtime.modelBones?.destroy(); runtime.uniforms?.destroy();
      runtime.capacity = this.states.length / 8;
      runtime.states = device.createBuffer({ label: 'Authored clip clocks', size: this.states.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      runtime.modelBones = device.createBuffer({ label: 'Authored model-space bones', size: palette.array.byteLength, usage: GPUBufferUsage.STORAGE });
      runtime.uniforms = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      runtime.bindings = null;
    }
    // Use Three's own allocation/version owner. STORAGE is AttributeType 3 in
    // Three 0.185. StaticDrawUsage below permits versioned uploads, while avoiding
    // an unconditional CPU overwrite after this compute or in later shadows.
    renderer._attributes.update(palette, 3);
    const output = renderer.backend.get(palette).buffer;
    if (runtime.output !== output || !runtime.bindings) {
      runtime.output = output;
      const buffers = [...runtime.staticBuffers, runtime.states, runtime.modelBones, output, runtime.uniforms];
      runtime.bindings = device.createBindGroup({ layout: runtime.pipeline.getBindGroupLayout(0), entries: buffers.map((buffer, binding) => ({ binding, resource: { buffer } })) });
    }
    device.queue.writeBuffer(runtime.states, 0, this.states.buffer, 0, count * 32);
    runtime.countWords[0] = count;
    device.queue.writeBuffer(runtime.uniforms, 0, runtime.countWords);
    const encoder = device.createCommandEncoder({ label: 'Authored animation before body/shadow submission' });
    const pass = encoder.beginComputePass();
    pass.setPipeline(runtime.pipeline);
    pass.setBindGroup(0, runtime.bindings);
    pass.dispatchWorkgroups(this.library.dispatchWorkgroupCount(count));
    pass.end();
    device.queue.submit([encoder.finish()]);
    runtime.epoch = epoch;
  }

  dispose(): void {
    for (const runtime of this.runtimes.values()) {
      for (const buffer of runtime.staticBuffers) buffer.destroy();
      runtime.states?.destroy(); runtime.modelBones?.destroy(); runtime.uniforms?.destroy();
    }
    this.runtimes.clear();
  }
}

function upload(device: GPUDevice, data: Uint32Array | Float32Array, usage: number, label: string): GPUBuffer {
  const buffer = device.createBuffer({ label, size: Math.max(16, data.byteLength), usage, mappedAtCreation: true });
  new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  buffer.unmap();
  return buffer;
}

function matrixLiteral(matrix: THREE.Matrix4): string {
  return `mat4x4<f32>(${matrix.elements.map(value => Number.isInteger(value) ? `${value}.0` : String(value)).join(', ')})`;
}
