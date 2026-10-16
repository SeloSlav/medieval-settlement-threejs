import * as THREE from 'three';
import { StorageInstancedBufferAttribute } from 'three/webgpu';
import { inheritExactInstancePrototype } from './ExactInstancePrototype.ts';
import { InstanceAttributeGather } from './InstanceAttributeGather.ts';
import type { SupportedRenderer } from './RendererBackend.ts';

type AttributePair = { source: THREE.InstancedBufferAttribute; output: THREE.InstancedBufferAttribute; version: number };

/** Keep canonical instance identities; submit an exact, compact visible prefix. */
export class InstanceDrawCompaction {
  readonly draw: THREE.InstancedMesh;
  private readonly source: THREE.InstancedMesh;
  private readonly pairs: AttributePair[];
  private readonly bounds: Float64Array;
  private readonly groupSize: number;
  private readonly groupBounds: Float64Array;
  private readonly groupLiveCounts: Uint32Array;
  private readonly frustum = new THREE.Frustum();
  private readonly projection = new THREE.Matrix4();
  private readonly matrix = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere();
  private readonly previousProjection = new THREE.Matrix4();
  private copyRanges: number[] = [];
  private previousRanges: number[] = [];
  private readonly layers: number;
  private readonly padding: number | (() => number);
  private readonly skipCollapsed: boolean;
  private readonly groupVisible?: (group: number) => boolean;
  private readonly selectionVersion?: () => number;
  private readonly gather?: InstanceAttributeGather;
  private boundedCount = 0;
  private previousSelectionVersion = -1;
  private matrixVersion = -1;
  private selectedCount = -1;
  private previousCount = -1;
  private previousPadding = NaN;
  private previousCoordinateSystem = -1;
  private previousReversedDepth = false;
  private previousCamera: THREE.Camera | null | undefined;
  private disposed = false;

  constructor(source: THREE.InstancedMesh, padding: number | (() => number), options: { skipCollapsed?: boolean; instanceGroupSize?: number; groupVisible?: (group: number) => boolean; selectionVersion?: () => number; renderer?: SupportedRenderer } = {}) {
    const materials = Array.isArray(source.material) ? source.material : [source.material];
    if (source.geometry.getIndirect() || materials.some(material => material.transparent)) throw new Error('Instance compaction requires opaque materials');
    const attributes = Object.entries(source.geometry.attributes);
    if (attributes.some(([, a]) => (a as THREE.InstancedBufferAttribute).isInstancedBufferAttribute && ((a as THREE.InstancedBufferAttribute).meshPerAttribute !== 1 || a.count < source.instanceMatrix.count))) throw new Error('Instance compaction requires complete per-instance attributes');
    this.source = source; this.padding = padding; this.layers = source.layers.mask;
    this.skipCollapsed = options.skipCollapsed === true;
    this.groupVisible = options.groupVisible; this.selectionVersion = options.selectionVersion;
    const gpuRenderer = InstanceAttributeGather.supports(source, options.renderer) ? options.renderer : undefined;
    const geometry = new THREE.BufferGeometry();
    inheritExactInstancePrototype(geometry, source.geometry);
    geometry.name = source.geometry.name;
    geometry.userData = { ...source.geometry.userData, instanceCompactionDraw: true };
    if (source.geometry.index) geometry.setIndex(source.geometry.index);
    for (const group of source.geometry.groups) geometry.addGroup(group.start, group.count, group.materialIndex);
    geometry.setDrawRange(source.geometry.drawRange.start, source.geometry.drawRange.count);
    this.pairs = [];
    for (const [name, raw] of attributes) {
      const attribute = raw as THREE.InstancedBufferAttribute;
      if (!attribute.isInstancedBufferAttribute) { geometry.setAttribute(name, raw); continue; }
      if (gpuRenderer) continue;
      const output = attribute.clone() as THREE.InstancedBufferAttribute; output.setUsage(THREE.StaticDrawUsage);
      geometry.setAttribute(name, output); this.pairs.push({ source: attribute, output, version: -1 });
    }
    this.draw = new THREE.InstancedMesh(geometry, source.material, source.instanceMatrix.count);
    // Never submit the constructor's identity matrices before the first commit.
    this.draw.count = 0;
    this.draw.name = `${source.name} visible instances`;
    this.draw.layers.mask = this.layers; this.draw.castShadow = source.castShadow; this.draw.receiveShadow = source.receiveShadow;
    this.draw.renderOrder = source.renderOrder; this.draw.frustumCulled = false;
    this.draw.customDepthMaterial = source.customDepthMaterial; this.draw.customDistanceMaterial = source.customDistanceMaterial;
    this.draw.userData = { ...source.userData, instanceCompactionDraw: true };
    // Storage attributes are uploaded directly before drawing. They avoid the
    // deferred internal interleaved-copy version and do not reupload a whole
    // forest allocation every frame when the selected prefix is unchanged.
    if (gpuRenderer) this.gather = new InstanceAttributeGather(source, this.draw, gpuRenderer);
    else {
      this.draw.instanceMatrix = new StorageInstancedBufferAttribute(source.instanceMatrix.count, 16);
      this.draw.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      if (source.instanceColor) {
        // WGSL vec3 storage has a vec4 stride. Allocate that stride explicitly so
        // Three never replaces/pads the backing array after our first upload.
        const output = new StorageInstancedBufferAttribute(source.instanceColor.count, 4);
        output.setUsage(THREE.StaticDrawUsage); this.draw.instanceColor = output;
        this.pairs.push({ source: source.instanceColor, output, version: -1 });
      }
      this.pairs.unshift({ source: source.instanceMatrix, output: this.draw.instanceMatrix, version: -1 });
    }
    this.bounds = new Float64Array(source.instanceMatrix.count * 4);
    this.groupSize = Math.max(1, Math.floor(options.instanceGroupSize ?? 1));
    this.groupBounds = new Float64Array(this.groupSize > 1 ? Math.ceil(source.instanceMatrix.count / this.groupSize) * 4 : 0);
    this.groupLiveCounts = new Uint32Array(this.groupBounds.length / 4);
    source.geometry.computeBoundingSphere();
    source.layers.mask = 0; source.userData.instanceCompactionSource = true;
    source.add(this.draw);
  }

  get submittedInstances(): number { return Math.max(0, this.selectedCount); }

  syncRenderState(): void {
    this.draw.castShadow = this.source.castShadow;
    this.draw.receiveShadow = this.source.receiveShadow;
    this.draw.renderOrder = this.source.renderOrder;
    this.draw.material = this.source.material;
  }

  /**
   * Commit before renderer.render(), not from a draw callback. WebGPU may have
   * already uploaded instance attributes or built shadow render objects there.
   * Pass null for an independently selected shadow-caster set: color and shadow
   * passes must not repack the same GPU buffer for different cameras.
   */
  prepare(camera: THREE.Camera | null): void {
    const source = this.source;
    let changed = this.gather?.updateInputs() ?? false;
    for (const pair of this.pairs) {
      if (pair.version !== pair.source.version) { pair.version = pair.source.version; changed = true; }
    }
    if (source.instanceMatrix.version !== this.matrixVersion || source.count > this.boundedCount) {
      // A skipped version can contain a sparse edit whose upload range has
      // already been consumed. Rebuild the bounds rather than retaining it.
      const matrixChanged = source.instanceMatrix.version !== this.matrixVersion;
      const ranges = source.instanceMatrix.version === this.matrixVersion + 1
        && this.matrixVersion >= 0 ? source.instanceMatrix.updateRanges : [];
      this.matrixVersion = source.instanceMatrix.version;
      for (let i = 0; i < source.count; i++) {
        if (i < this.boundedCount && (!matrixChanged || (ranges.length && !ranges.some(range => range.start < (i + 1) * 16 && range.start + range.count > i * 16)))) continue;
        source.getMatrixAt(i, this.matrix); this.sphere.copy(source.geometry.boundingSphere!).applyMatrix4(this.matrix);
        const p = this.sphere.center, offset = i * 4;
        this.bounds[offset] = p.x; this.bounds[offset + 1] = p.y; this.bounds[offset + 2] = p.z; this.bounds[offset + 3] = this.sphere.radius;
      }
      if (this.groupSize > 1) {
        // Forest cards are contiguous per tree. Reject a whole crown, or accept
        // an entirely visible crown, before inspecting cards on its boundary.
        for (let start = 0, group = 0; start < source.count; start += this.groupSize, group++) {
          let minX = Infinity, minY = Infinity, minZ = Infinity;
          let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity, live = 0;
          for (let i = start; i < Math.min(start + this.groupSize, source.count); i++) {
            const at = i * 4, r = this.bounds[at + 3]!;
            if (this.skipCollapsed && r === 0) continue;
            live++;
            minX = Math.min(minX, this.bounds[at]! - r); maxX = Math.max(maxX, this.bounds[at]! + r);
            minY = Math.min(minY, this.bounds[at + 1]! - r); maxY = Math.max(maxY, this.bounds[at + 1]! + r);
            minZ = Math.min(minZ, this.bounds[at + 2]! - r); maxZ = Math.max(maxZ, this.bounds[at + 2]! + r);
          }
          const at = group * 4;
          this.groupLiveCounts[group] = live;
          this.groupBounds[at] = live ? (minX + maxX) / 2 : 0;
          this.groupBounds[at + 1] = live ? (minY + maxY) / 2 : 0;
          this.groupBounds[at + 2] = live ? (minZ + maxZ) / 2 : 0;
          this.groupBounds[at + 3] = live ? Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2 : 0;
        }
      }
      this.boundedCount = source.count;
    }
    if (camera) {
      camera.updateWorldMatrix(true, false);
      source.updateWorldMatrix(true, false);
      this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(source.matrixWorld);
    }
    const padding = typeof this.padding === 'function' ? this.padding() : this.padding;
    const selectionVersion = this.selectionVersion?.() ?? 0;
    if (!changed && this.previousCount === source.count && this.previousPadding === padding
      && this.previousSelectionVersion === selectionVersion
      && this.previousCamera === camera
      && (!camera || (this.previousCoordinateSystem === camera.coordinateSystem
        && this.previousReversedDepth === camera.reversedDepth
        && this.previousProjection.equals(this.projection)))) {
      // Covered startup prewarm may temporarily override a draw's count.
      this.draw.count = Math.max(0, this.selectedCount);
      return;
    }
    this.previousCamera = camera;
    this.previousSelectionVersion = selectionVersion;
    this.previousProjection.copy(this.projection); this.previousCount = source.count; this.previousPadding = padding;
    if (camera) {
      this.previousCoordinateSystem = camera.coordinateSystem; this.previousReversedDepth = camera.reversedDepth;
      this.frustum.setFromProjectionMatrix(this.projection, camera.coordinateSystem, camera.reversedDepth);
    }
    let count = 0;
    const planes = camera ? this.frustum.planes : [];
    [this.copyRanges, this.previousRanges] = [this.previousRanges, this.copyRanges];
    this.copyRanges.length = 0;
    const append = (start: number, length: number): void => {
      const previous = this.copyRanges.length - 3;
      if (previous >= 0 && this.copyRanges[previous]! + this.copyRanges[previous + 2]! === start) this.copyRanges[previous + 2]! += length;
      else this.copyRanges.push(start, count, length);
      count += length;
    };
    for (let start = 0; start < source.count; start += this.groupSize) {
      if (this.groupVisible && !this.groupVisible(start / this.groupSize)) continue;
      const end = Math.min(start + this.groupSize, source.count);
      if (this.groupSize > 1) {
        const group = start / this.groupSize, at = group * 4;
        if (!this.groupLiveCounts[group]) continue;
        let outside = false, inside = true;
        for (const plane of planes) {
          const normal = plane.normal;
          const distance = normal.x * this.groupBounds[at]! + normal.y * this.groupBounds[at + 1]!
            + normal.z * this.groupBounds[at + 2]! + plane.constant;
          const radius = this.groupBounds[at + 3]! + padding;
          if (distance < -radius) { outside = true; break; }
          if (distance < radius) inside = false;
        }
        if (outside) continue;
        const allocated = Math.min(this.groupSize, source.instanceMatrix.count - start);
        if (inside && this.groupLiveCounts[group] === allocated) { append(start, end - start); continue; }
      }
      for (let i = start; i < end; i++) {
        const at = i * 4, x = this.bounds[at]!, y = this.bounds[at + 1]!, z = this.bounds[at + 2]!, radius = this.bounds[at + 3]! + padding;
        // Explicit owner opt-in: harvested/cleared forest slots collapse every
        // source vertex and its wind vector, producing no rasterized triangles.
        if (this.skipCollapsed && this.bounds[at + 3] === 0) continue;
        let visible = true;
        for (const plane of planes) {
          const normal = plane.normal;
          if (normal.x * x + normal.y * y + normal.z * z + plane.constant < -radius) { visible = false; break; }
        }
        if (!visible) continue;
        append(i, 1);
      }
    }
    const selectionChanged = this.copyRanges.length !== this.previousRanges.length
      || this.copyRanges.some((value, i) => value !== this.previousRanges[i]);
    const countChanged = this.selectedCount !== count;
    changed ||= selectionChanged || countChanged;
    this.selectedCount = count;
    source.userData.compactedInstanceCount = count;
    this.draw.count = count;
    if (!changed) return;
    if (this.gather) {
      this.gather.gather(count, this.copyRanges, selectionChanged || countChanged);
      return;
    }
    for (const pair of this.pairs) {
      const size = pair.source.itemSize, stride = pair.output.itemSize, input = pair.source.array, output = pair.output.array;
      for (let i = 0; i < this.copyRanges.length; i += 3) {
        const start = this.copyRanges[i]! * size;
        const length = this.copyRanges[i + 2]!;
        if (size === stride) output.set(input.subarray(start, start + length * size), this.copyRanges[i + 1]! * stride);
        else for (let row = 0; row < length; row++) {
          output.set(input.subarray(start + row * size, start + (row + 1) * size), (this.copyRanges[i + 1]! + row) * stride);
        }
      }
      pair.output.clearUpdateRanges();
      pair.output.addUpdateRange(0, count * stride);
      pair.output.needsUpdate = true;
    }
  }

  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    this.gather?.dispose(this.source);
    this.draw.removeFromParent(); this.draw.dispose(); this.draw.geometry.dispose();
    this.source.layers.mask = this.layers;
    delete this.source.userData.instanceCompactionSource; delete this.source.userData.compactedInstanceCount;
  }
}
