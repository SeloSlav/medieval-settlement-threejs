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
  private readonly box = new THREE.Box3();
  private readonly point = new THREE.Vector3();
  private readonly previousProjection = new THREE.Matrix4();
  private readonly groupSize: number;
  private readonly sortFrontToBack: boolean;
  private readonly visibleGroups: number[] = [];
  private readonly copyRanges: number[] = [];
  private readonly viewMatrix = new THREE.Matrix4();
  private readonly layers: number;
  private readonly padding: number | (() => number);
  private matrixVersion = -1;
  private selectedCount = -1;
  private previousCount = -1;
  private previousPadding = NaN;
  private previousCoordinateSystem = -1;
  private previousReversedDepth = false;
  private disposed = false;

  constructor(source: THREE.InstancedMesh, padding: number | (() => number), groupSize = 1, sortFrontToBack = false) {
    if (!Number.isInteger(groupSize) || groupSize < 1) throw new Error('Instance group size must be a positive integer');
    if (source.geometry.getIndirect() || Array.isArray(source.material) || source.material.transparent) throw new Error('Instance compaction requires one opaque draw');
    const attributes = Object.entries(source.geometry.attributes);
    if (attributes.some(([, a]) => (a as THREE.InstancedBufferAttribute).isInstancedBufferAttribute && ((a as THREE.InstancedBufferAttribute).meshPerAttribute !== 1 || a.count < source.instanceMatrix.count))) throw new Error('Instance compaction requires complete per-instance attributes');
    this.source = source; this.padding = padding; this.layers = source.layers.mask; this.groupSize = groupSize;
    this.sortFrontToBack = sortFrontToBack;
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
    this.draw.name = `${source.name} visible instances`;
    this.draw.layers.mask = this.layers; this.draw.castShadow = source.castShadow; this.draw.receiveShadow = source.receiveShadow;
    this.draw.renderOrder = source.renderOrder; this.draw.frustumCulled = false;
    this.draw.customDepthMaterial = source.customDepthMaterial; this.draw.customDistanceMaterial = source.customDistanceMaterial;
    this.draw.userData = { ...source.userData, instanceCompactionDraw: true };
    this.draw.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    if (source.instanceColor) {
      const output = source.instanceColor.clone() as THREE.InstancedBufferAttribute;
      output.setUsage(THREE.StaticDrawUsage); this.draw.instanceColor = output;
      this.pairs.push({ source: source.instanceColor, output, version: -1 });
    }
    this.pairs.unshift({ source: source.instanceMatrix, output: this.draw.instanceMatrix, version: -1 });
    this.selected = new Uint32Array(source.instanceMatrix.count);
    this.bounds = new Float64Array(Math.ceil(source.instanceMatrix.count / groupSize) * 4);
    source.geometry.computeBoundingSphere();
    source.layers.mask = 0; source.userData.instanceCompactionSource = true;
    source.add(this.draw);
    this.draw.onBeforeRender = (_renderer, _scene, camera) => this.prepare(camera);
  }

  get submittedInstances(): number { return Math.max(0, this.selectedCount); }

  syncRenderState(): void {
    this.draw.castShadow = this.source.castShadow;
    this.draw.receiveShadow = this.source.receiveShadow;
    this.draw.renderOrder = this.source.renderOrder;
    this.draw.material = this.source.material;
  }

  private prepare(camera: THREE.Camera): void {
    const source = this.source;
    let changed = false;
    for (const pair of this.pairs) {
      if (pair.version !== pair.source.version) { pair.version = pair.source.version; changed = true; }
    }
    if (source.instanceMatrix.version !== this.matrixVersion) {
      const ranges = this.matrixVersion < 0 ? [] : source.instanceMatrix.updateRanges;
      this.matrixVersion = source.instanceMatrix.version;
      const groups = this.bounds.length / 4;
      for (let group = 0; group < groups; group++) {
        const start = group * this.groupSize, end = Math.min(start + this.groupSize, source.instanceMatrix.count);
        if (ranges.length && !ranges.some(range => range.start < end * 16 && range.start + range.count > start * 16)) continue;
        this.box.makeEmpty();
        for (let i = start; i < end; i++) {
          source.getMatrixAt(i, this.matrix); this.sphere.copy(source.geometry.boundingSphere!).applyMatrix4(this.matrix);
          if (this.groupSize === 1) break;
          this.box.expandByPoint(this.point.copy(this.sphere.center).addScalar(this.sphere.radius));
          this.box.expandByPoint(this.point.copy(this.sphere.center).addScalar(-this.sphere.radius));
        }
        if (this.groupSize !== 1) this.box.getBoundingSphere(this.sphere);
        const p = this.sphere.center, offset = group * 4;
        this.bounds[offset] = p.x; this.bounds[offset + 1] = p.y; this.bounds[offset + 2] = p.z; this.bounds[offset + 3] = this.sphere.radius;
      }
    }
    this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(source.matrixWorld);
    const padding = typeof this.padding === 'function' ? this.padding() : this.padding;
    if (!changed && this.previousCount === source.count && this.previousPadding === padding
      && this.previousCoordinateSystem === camera.coordinateSystem && this.previousReversedDepth === camera.reversedDepth
      && this.previousProjection.equals(this.projection)) return;
    this.previousProjection.copy(this.projection); this.previousCount = source.count; this.previousPadding = padding;
    this.previousCoordinateSystem = camera.coordinateSystem; this.previousReversedDepth = camera.reversedDepth;
    this.frustum.setFromProjectionMatrix(this.projection, camera.coordinateSystem, camera.reversedDepth);
    let count = 0;
    this.visibleGroups.length = 0;
    for (let group = 0; group < Math.ceil(source.count / this.groupSize); group++) {
      const at = group * 4, x = this.bounds[at]!, y = this.bounds[at + 1]!, z = this.bounds[at + 2]!, radius = this.bounds[at + 3]! + padding;
      let visible = true;
      for (const plane of this.frustum.planes) {
        const normal = plane.normal;
        if (normal.x * x + normal.y * y + normal.z * z + plane.constant < -radius) { visible = false; break; }
      }
      if (!visible) continue;
      this.visibleGroups.push(group);
    }
    if (this.sortFrontToBack) {
      const e = this.viewMatrix.multiplyMatrices(camera.matrixWorldInverse, source.matrixWorld).elements;
      const bounds = this.bounds;
      // Opaque foliage writes depth. Near trees reject covered fragments of
      // farther trees while every authored leaf remains in its original tree.
      this.visibleGroups.sort((a, b) => {
        const dz = (bounds[b * 4]! - bounds[a * 4]!) * e[2]!
          + (bounds[b * 4 + 1]! - bounds[a * 4 + 1]!) * e[6]!
          + (bounds[b * 4 + 2]! - bounds[a * 4 + 2]!) * e[10]!;
        return dz || a - b;
      });
    }
    this.copyRanges.length = 0;
    for (const group of this.visibleGroups) {
      const start = group * this.groupSize;
      const end = Math.min((group + 1) * this.groupSize, source.count);
      const previous = this.copyRanges.length - 3;
      if (previous >= 0 && this.copyRanges[previous]! + this.copyRanges[previous + 2]! === start) {
        this.copyRanges[previous + 2]! += end - start;
      } else this.copyRanges.push(start, count, end - start);
      for (let i = start; i < end; i++) {
        if (this.selected[count] !== i) { this.selected[count] = i; changed = true; }
        count++;
      }
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
      pair.output.clearUpdateRanges(); pair.output.addUpdateRange(0, count * size); pair.output.needsUpdate = true;
    }
  }

  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    this.draw.removeFromParent(); this.draw.dispose(); this.draw.geometry.dispose();
    this.source.layers.mask = this.layers;
    delete this.source.userData.instanceCompactionSource; delete this.source.userData.compactedInstanceCount;
  }
}
