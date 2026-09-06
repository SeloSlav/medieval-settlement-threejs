import * as THREE from 'three';

type AttributePair = { source: THREE.InstancedBufferAttribute; output: THREE.InstancedBufferAttribute; version: number };

/** Keep canonical instance identities; submit an exact, compact visible prefix. */
export class InstanceDrawCompaction {
  readonly draw: THREE.InstancedMesh;
  private readonly source: THREE.InstancedMesh;
  private readonly pairs: AttributePair[];
  private readonly selected: Uint32Array;
  private readonly bounds: Float64Array;
  private readonly frustum = new THREE.Frustum();
  private readonly projection = new THREE.Matrix4();
  private readonly matrix = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere();
  private readonly previousProjection = new THREE.Matrix4();
  private readonly copyRanges: number[] = [];
  private readonly layers: number;
  private readonly padding: number | (() => number);
  private readonly skipCollapsed: boolean;
  private matrixVersion = -1;
  private selectedCount = -1;
  private previousCount = -1;
  private previousPadding = NaN;
  private previousCoordinateSystem = -1;
  private previousReversedDepth = false;
  private previousCamera: THREE.Camera | null | undefined;
  private disposed = false;

  constructor(source: THREE.InstancedMesh, padding: number | (() => number), options: { skipCollapsed?: boolean } = {}) {
    if (source.geometry.getIndirect() || Array.isArray(source.material) || source.material.transparent) throw new Error('Instance compaction requires one opaque draw');
    const attributes = Object.entries(source.geometry.attributes);
    if (attributes.some(([, a]) => (a as THREE.InstancedBufferAttribute).isInstancedBufferAttribute && ((a as THREE.InstancedBufferAttribute).meshPerAttribute !== 1 || a.count < source.instanceMatrix.count))) throw new Error('Instance compaction requires complete per-instance attributes');
    this.source = source; this.padding = padding; this.layers = source.layers.mask;
    this.skipCollapsed = options.skipCollapsed === true;
    const geometry = new THREE.BufferGeometry();
    geometry.name = source.geometry.name;
    geometry.userData = { ...source.geometry.userData, instanceCompactionDraw: true };
    if (source.geometry.index) geometry.setIndex(source.geometry.index);
    geometry.setDrawRange(source.geometry.drawRange.start, source.geometry.drawRange.count);
    this.pairs = [];
    for (const [name, raw] of attributes) {
      const attribute = raw as THREE.InstancedBufferAttribute;
      if (!attribute.isInstancedBufferAttribute) { geometry.setAttribute(name, raw); continue; }
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
    // Large WebGPU instance matrices use an internal interleaved buffer whose
    // version is synchronized after geometry uploads. Dynamic usage uploads the
    // current packed prefix immediately, including newly visible instances.
    this.draw.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (source.instanceColor) {
      const output = source.instanceColor.clone() as THREE.InstancedBufferAttribute;
      output.setUsage(THREE.DynamicDrawUsage); this.draw.instanceColor = output;
      this.pairs.push({ source: source.instanceColor, output, version: -1 });
    }
    this.pairs.unshift({ source: source.instanceMatrix, output: this.draw.instanceMatrix, version: -1 });
    this.selected = new Uint32Array(source.instanceMatrix.count);
    this.bounds = new Float64Array(source.instanceMatrix.count * 4);
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
    let changed = false;
    for (const pair of this.pairs) {
      if (pair.version !== pair.source.version) { pair.version = pair.source.version; changed = true; }
    }
    if (source.instanceMatrix.version !== this.matrixVersion) {
      // A skipped version can contain a sparse edit whose upload range has
      // already been consumed. Rebuild the bounds rather than retaining it.
      const ranges = source.instanceMatrix.version === this.matrixVersion + 1
        && this.matrixVersion >= 0 ? source.instanceMatrix.updateRanges : [];
      this.matrixVersion = source.instanceMatrix.version;
      for (let i = 0; i < source.instanceMatrix.count; i++) {
        if (ranges.length && !ranges.some(range => range.start < (i + 1) * 16 && range.start + range.count > i * 16)) continue;
        source.getMatrixAt(i, this.matrix); this.sphere.copy(source.geometry.boundingSphere!).applyMatrix4(this.matrix);
        const p = this.sphere.center, offset = i * 4;
        this.bounds[offset] = p.x; this.bounds[offset + 1] = p.y; this.bounds[offset + 2] = p.z; this.bounds[offset + 3] = this.sphere.radius;
      }
    }
    if (camera) {
      camera.updateWorldMatrix(true, false);
      source.updateWorldMatrix(true, false);
      this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(source.matrixWorld);
    }
    const padding = typeof this.padding === 'function' ? this.padding() : this.padding;
    if (!changed && this.previousCount === source.count && this.previousPadding === padding
      && this.previousCamera === camera
      && (!camera || (this.previousCoordinateSystem === camera.coordinateSystem
        && this.previousReversedDepth === camera.reversedDepth
        && this.previousProjection.equals(this.projection)))) return;
    this.previousCamera = camera;
    this.previousProjection.copy(this.projection); this.previousCount = source.count; this.previousPadding = padding;
    if (camera) {
      this.previousCoordinateSystem = camera.coordinateSystem; this.previousReversedDepth = camera.reversedDepth;
      this.frustum.setFromProjectionMatrix(this.projection, camera.coordinateSystem, camera.reversedDepth);
    }
    let count = 0;
    const planes = camera ? this.frustum.planes : [];
    this.copyRanges.length = 0;
    for (let i = 0; i < source.count; i++) {
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
      const previous = this.copyRanges.length - 3;
      if (previous >= 0 && this.copyRanges[previous]! + this.copyRanges[previous + 2]! === i) this.copyRanges[previous + 2]!++;
      else this.copyRanges.push(i, count, 1);
      if (this.selected[count] !== i) { this.selected[count] = i; changed = true; }
      count++;
    }
    if (this.selectedCount !== count) { this.selectedCount = count; changed = true; }
    source.userData.compactedInstanceCount = count;
    this.draw.count = count;
    if (!changed) return;
    for (const pair of this.pairs) {
      const size = pair.source.itemSize, input = pair.source.array, output = pair.output.array;
      for (let i = 0; i < this.copyRanges.length; i += 3) {
        const start = this.copyRanges[i]! * size;
        output.set(input.subarray(start, start + this.copyRanges[i + 2]! * size), this.copyRanges[i + 1]! * size);
      }
      pair.output.clearUpdateRanges();
      // The internal matrix/color buffer also copies upload ranges one frame
      // late. A full dynamic upload prevents an older, shorter range exposing
      // stale or constructor-identity transforms as the visible count grows.
      if (pair.output.usage !== THREE.DynamicDrawUsage) pair.output.addUpdateRange(0, count * size);
      pair.output.needsUpdate = true;
    }
  }

  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    this.draw.removeFromParent(); this.draw.dispose(); this.draw.geometry.dispose();
    this.source.layers.mask = this.layers;
    delete this.source.userData.instanceCompactionSource; delete this.source.userData.compactedInstanceCount;
  }
}
