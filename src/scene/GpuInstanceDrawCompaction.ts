import * as THREE from 'three';
import { StorageInstancedBufferAttribute } from 'three/webgpu';
import * as WebGPU from 'three/webgpu';

type IndirectAttributeType = THREE.BufferAttribute & { isStorageBufferAttribute: true; isIndirectStorageBufferAttribute: true };
const IndirectAttribute = (WebGPU as unknown as { IndirectStorageBufferAttribute: new (array: Uint32Array, itemSize: number) => IndirectAttributeType }).IndirectStorageBufferAttribute;

type NativeRenderer = {
  backend: { device: GPUDevice; get(attribute: THREE.BufferAttribute): { buffer: GPUBuffer } };
  _attributes: { update(attribute: THREE.BufferAttribute, type: number): void; delete(attribute: THREE.BufferAttribute): void };
  info: { update(object: THREE.Object3D, vertices: number, instances: number): void };
};
type Input = { attribute: THREE.InstancedBufferAttribute; offset: number; version: number };
type Runtime = { source: GPUBuffer; selection: GPUBuffer; uniforms: GPUBuffer[]; bindings: GPUBindGroup[]; revision: number };
const pipelines = new WeakMap<GPUDevice, GPUComputePipeline>();
const measuredRenderers = new WeakSet<NativeRenderer>();
const COPY_SHADER = `
@group(0) @binding(0) var<storage, read> source: array<u32>;
@group(0) @binding(1) var<storage, read> selected: array<u32>;
@group(0) @binding(2) var<storage, read_write> output: array<u32>;
@group(0) @binding(3) var<uniform> parameters: vec4<u32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= parameters.z) { return; }
  let row = id.x / parameters.x;
  let component = id.x % parameters.x;
  output[id.x] = source[parameters.y + selected[row] * parameters.x + component];
}`;

/**
 * Cull complete instances without changing their canonical CPU arrays or adding
 * render objects. GPU copies preserve every selected attribute bit for bit.
 * Intended for immutable geometry with versioned, fixed-capacity instance data.
 * Install before first rendering. Dispose together with the owning mesh after
 * removing it from the scene. Color and shadow passes need separate meshes.
 */
export class GpuInstanceDrawCompaction {
  private readonly mesh: THREE.InstancedMesh;
  private readonly originalMatrix: THREE.InstancedBufferAttribute;
  private readonly beforeRender: THREE.Object3D['onBeforeRender'];
  private readonly inputs: Input[];
  private readonly indirect: IndirectAttributeType;
  private readonly selected: Uint32Array<ArrayBuffer>;
  private readonly bounds: Float64Array;
  private readonly projection = new THREE.Matrix4();
  private readonly frustum = new THREE.Frustum();
  private readonly matrix = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere();
  private readonly runtimes = new Map<NativeRenderer, Runtime>();
  private readonly motionPadding: number | (() => number);
  private readonly sourceBytes: number;
  private matrixVersion = -1;
  private selectedCount = -1;
  private revision = 0;
  private disposed = false;

  constructor(mesh: THREE.InstancedMesh, motionPadding: number | (() => number)) {
    if (mesh.geometry.getIndirect() || Array.isArray(mesh.material) || mesh.material.transparent) {
      throw new Error('GPU draw compaction requires one opaque draw');
    }
    const attributes = Object.values(mesh.geometry.attributes).filter(a => (a as THREE.InstancedBufferAttribute).isInstancedBufferAttribute) as THREE.InstancedBufferAttribute[];
    if (attributes.some(a => a.meshPerAttribute !== 1 || !(a.array instanceof Float32Array) || a.count < mesh.instanceMatrix.count)) {
      throw new Error('GPU draw compaction requires float32 per-instance attributes');
    }
    this.mesh = mesh; this.motionPadding = motionPadding;
    this.originalMatrix = mesh.instanceMatrix;
    mesh.instanceMatrix = new StorageInstancedBufferAttribute(mesh.instanceMatrix.array as Float32Array, 16);
    let offset = 0;
    this.inputs = [mesh.instanceMatrix, ...attributes].map(attribute => {
      attribute.setUsage(THREE.StaticDrawUsage);
      const input = { attribute, offset, version: -1 }; offset += attribute.array.length;
      return input;
    });
    this.sourceBytes = offset * 4;
    this.selected = new Uint32Array(mesh.instanceMatrix.count);
    this.bounds = new Float64Array(mesh.instanceMatrix.count * 4);
    const drawWords = mesh.geometry.index ? 5 : 4;
    this.indirect = new IndirectAttribute(new Uint32Array(drawWords), drawWords);
    mesh.geometry.setIndirect(this.indirect);
    mesh.geometry.computeBoundingSphere();
    this.beforeRender = mesh.onBeforeRender;
    mesh.onBeforeRender = (renderer, scene, camera, geometry, material, group) => {
      this.beforeRender.call(mesh, renderer, scene, camera, geometry, material, group);
      this.prepare(renderer as unknown as NativeRenderer, camera);
    };
    mesh.material.needsUpdate = true;
  }

  get submittedInstances(): number { return Math.max(0, this.selectedCount); }

  private prepare(renderer: NativeRenderer, camera: THREE.Camera): void {
    const { GPUBufferUsage } = globalThis as unknown as { GPUBufferUsage: { STORAGE: number; COPY_DST: number; UNIFORM: number } };
    const mesh = this.mesh;
    let changed = false;
    for (const input of this.inputs) {
      if (input.version !== input.attribute.version) { changed = true; input.version = input.attribute.version; }
    }
    if (this.matrixVersion !== mesh.instanceMatrix.version) {
      this.matrixVersion = mesh.instanceMatrix.version;
      const base = mesh.geometry.boundingSphere!;
      for (let i = 0; i < mesh.instanceMatrix.count; i++) {
        mesh.getMatrixAt(i, this.matrix);
        this.sphere.copy(base).applyMatrix4(this.matrix);
        const offset = i * 4, center = this.sphere.center;
        this.bounds[offset] = center.x; this.bounds[offset + 1] = center.y; this.bounds[offset + 2] = center.z;
        this.bounds[offset + 3] = this.sphere.radius;
      }
    }
    this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(mesh.matrixWorld);
    this.frustum.setFromProjectionMatrix(this.projection, camera.coordinateSystem, camera.reversedDepth);
    const padding = typeof this.motionPadding === 'function' ? this.motionPadding() : this.motionPadding;
    let count = 0;
    for (let i = 0; i < mesh.count; i++) {
      const offset = i * 4, x = this.bounds[offset]!, y = this.bounds[offset + 1]!, z = this.bounds[offset + 2]!, radius = this.bounds[offset + 3]! + padding;
      let visible = true;
      for (const plane of this.frustum.planes) {
        const n = plane.normal;
        if (n.x * x + n.y * y + n.z * z + plane.constant < -radius) { visible = false; break; }
      }
      if (!visible) continue;
      if (this.selected[count] !== i) { this.selected[count] = i; changed = true; }
      count++;
    }
    if (count !== this.selectedCount) { this.selectedCount = count; changed = true; }
    mesh.userData.gpuCompactedInstanceCount = count;
    if (changed) this.revision++;
    const device = renderer.backend.device;
    let runtime = this.runtimes.get(renderer);
    if (!runtime) {
      if (!measuredRenderers.has(renderer)) {
        const update = renderer.info.update;
        renderer.info.update = function(object, vertices, instances) {
          update.call(this, object, vertices, object.userData.gpuCompactedInstanceCount ?? instances);
        };
        measuredRenderers.add(renderer);
      }
      let pipeline = pipelines.get(device);
      if (!pipeline) {
        pipeline = device.createComputePipeline({ label: 'Exact instance selection copy', layout: 'auto', compute: { module: device.createShaderModule({ code: COPY_SHADER }), entryPoint: 'main' } });
        pipelines.set(device, pipeline);
      }
      runtime = {
        source: device.createBuffer({ size: Math.max(4, this.sourceBytes), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
        selection: device.createBuffer({ size: Math.max(4, this.selected.byteLength), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
        uniforms: [], bindings: [], revision: -1,
      };
      for (const input of this.inputs) {
        renderer._attributes.update(input.attribute, 3);
        const uniform = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        runtime.uniforms.push(uniform);
        runtime.bindings.push(device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [runtime.source, runtime.selection, renderer.backend.get(input.attribute).buffer, uniform].map((buffer, binding) => ({ binding, resource: { buffer } })) }));
      }
      this.runtimes.set(renderer, runtime);
    }
    if (runtime.revision === this.revision) return;
    runtime.revision = this.revision;
    // CPU arrays remain the canonical full population. Refresh the input copy
    // on edits; no camera pass can replace or permute those authored identities.
    for (const input of this.inputs) {
      renderer._attributes.update(input.attribute, 3);
      const data = input.attribute.array;
      device.queue.writeBuffer(runtime.source, input.offset * 4, data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
    }
    device.queue.writeBuffer(runtime.selection, 0, this.selected.buffer, 0, count * 4);
    const indexed = !!mesh.geometry.index;
    const total = mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count;
    const start = mesh.geometry.drawRange.start;
    const draw = [Math.max(0, Math.min(total - start, mesh.geometry.drawRange.count)), count, start, 0];
    if (indexed) draw.push(0);
    this.indirect.array.set(draw);
    this.indirect.needsUpdate = true;
    renderer._attributes.update(this.indirect, 4);
    if (count === 0) return;
    const encoder = device.createCommandEncoder({ label: 'Exact visible instances' });
    const pass = encoder.beginComputePass(); pass.setPipeline(pipelines.get(device)!);
    this.inputs.forEach((input, i) => {
      const words = count * input.attribute.itemSize;
      device.queue.writeBuffer(runtime!.uniforms[i]!, 0, new Uint32Array([input.attribute.itemSize, input.offset, words, 0]));
      pass.setBindGroup(0, runtime!.bindings[i]!); pass.dispatchWorkgroups(Math.ceil(words / 64));
    });
    pass.end(); device.queue.submit([encoder.finish()]);
  }

  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    for (const [renderer, runtime] of this.runtimes) {
      runtime.source.destroy(); runtime.selection.destroy(); runtime.uniforms.forEach(buffer => buffer.destroy());
      renderer._attributes.delete(this.indirect);
      for (const input of this.inputs) renderer._attributes.delete(input.attribute);
    }
    this.runtimes.clear();
    this.mesh.geometry.setIndirect(null as never);
    this.mesh.instanceMatrix = this.originalMatrix; this.originalMatrix.needsUpdate = true;
    for (const input of this.inputs) input.attribute.needsUpdate = true;
    this.mesh.onBeforeRender = this.beforeRender;
    delete this.mesh.userData.gpuCompactedInstanceCount;
    const material = this.mesh.material as THREE.Material; material.needsUpdate = true;
  }
}
