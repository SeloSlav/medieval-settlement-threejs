import * as THREE from 'three';
import { StorageInstancedBufferAttribute } from 'three/webgpu';
import { windStrength } from '@seedthree/core/wind.js';

const CELL_SIZE = 32;
type Cell = { bounds: THREE.Box3; windPadding: number; visible: boolean };
type Batch = { mesh: THREE.InstancedMesh; cells: Uint32Array; attributes: {
  attribute: THREE.InstancedBufferAttribute; source: Float32Array;
}[] };

/** Select hedge instances without multiplying meshes, materials or draw calls. */
export class FieldPerimeterView extends THREE.Group {
  readonly isCityCameraPreparedGroup = true;
  private readonly cells: Cell[] = [];
  private readonly cellIds = new Map<string, number>();
  private readonly batches: Batch[] = [];
  private readonly cellProjection = new THREE.Matrix4();
  private readonly lastProjection = new THREE.Matrix4();
  private readonly cellFrustum = new THREE.Frustum();
  private readonly bounds = new THREE.Box3();
  private lastWind = NaN;
  private lastCoordinateSystem: number | undefined;
  private lastReversedDepth: boolean | undefined;
  private prepared = false;

  constructor() {
    super();
    // Every descendant has castShadow=false. Shadow-camera preparation must
    // not overwrite the instance selection belonging to the outer color pass.
    this.userData.cityColourOnlySubtree = true;
  }

  addBatch(mesh: THREE.InstancedMesh, useStorage: boolean): void {
    if (mesh.castShadow) throw new Error('Field perimeter view selection requires non-casting hedges');
    if (useStorage) {
      // Direct storage uploads avoid Three's deferred internal interleaved
      // version/range copy when the active prefix grows on this camera frame.
      const matrices = new StorageInstancedBufferAttribute(mesh.instanceMatrix.count, 16);
      matrices.array.set(mesh.instanceMatrix.array);
      mesh.instanceMatrix = matrices;
      if (mesh.instanceColor) {
        // WGSL vec3 storage has a vec4 stride; own that padding from creation.
        const source = mesh.instanceColor, colors = new StorageInstancedBufferAttribute(source.count, 4);
        for (let i = 0; i < source.count; i++) colors.array.set(source.array.subarray(i * 3, i * 3 + 3), i * 4);
        mesh.instanceColor = colors;
      }
    }
    const geometry = mesh.geometry;
    geometry.computeBoundingBox();
    const weight = geometry.getAttribute('aRootWeight');
    let maxWeight = 0;
    for (let i = 0; i < (weight?.count ?? 0); i++) maxWeight = Math.max(maxWeight, Math.abs(weight.getX(i)));
    const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), size = new THREE.Vector3();
    const cellIds = new Uint32Array(mesh.count);
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix);
      position.setFromMatrixPosition(matrix);
      const key = `${Math.floor(position.x / CELL_SIZE)},${Math.floor(position.z / CELL_SIZE)}`;
      let id = this.cellIds.get(key);
      if (id === undefined) {
        id = this.cells.length;
        this.cellIds.set(key, id);
        this.cells.push({ bounds: new THREE.Box3(), windPadding: 0, visible: true });
      }
      const cell = this.cells[id]!;
      cell.bounds.union(this.bounds.copy(geometry.boundingBox!).applyMatrix4(matrix));
      // Rooted hedge sway: max amplitude .1 * (1 + .12 jitter) * rootWeight.
      // The scale factor also covers the classic inverse-instance wind path.
      size.setFromMatrixScale(matrix);
      cell.windPadding = Math.max(cell.windPadding, .112 * maxWeight * Math.max(1, size.x, size.y, size.z));
      cellIds[i] = id;
    }
    const attributes = [mesh.instanceMatrix, mesh.instanceColor,
      ...['aTint', 'aAnchorPos', 'aWindVec'].map(name => geometry.getAttribute(name))]
      .filter((attribute): attribute is THREE.InstancedBufferAttribute => !!attribute)
      .map(attribute => ({ attribute, source: (attribute.array as Float32Array).slice() }));
    for (const { attribute } of attributes) attribute.setUsage(THREE.StaticDrawUsage);
    mesh.frustumCulled = false;
    this.batches.push({ mesh, cells: cellIds, attributes });
    this.add(mesh);
    this.prepared = false;
  }

  prepare(camera: THREE.Camera): void {
    this.cellProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(this.matrixWorld);
    const wind = Math.abs(windStrength.value);
    if (!this.prepared || !this.lastProjection.equals(this.cellProjection) || wind !== this.lastWind
      || camera.coordinateSystem !== this.lastCoordinateSystem || camera.reversedDepth !== this.lastReversedDepth) {
      this.cellFrustum.setFromProjectionMatrix(this.cellProjection, camera.coordinateSystem, camera.reversedDepth);
      let changed = !this.prepared;
      for (const cell of this.cells) {
        const visible = this.cellFrustum.intersectsBox(this.bounds.copy(cell.bounds).expandByScalar(cell.windPadding * wind + 1e-4));
        changed ||= cell.visible !== visible;
        cell.visible = visible;
      }
      if (changed) for (const batch of this.batches) {
        let count = 0;
        for (let slot = 0; slot < batch.cells.length; slot++) {
          if (!this.cells[batch.cells[slot]!]!.visible) continue;
          for (const { attribute, source } of batch.attributes) {
            const stride = attribute.itemSize;
            (attribute.array as Float32Array).set(source.subarray(slot * stride, (slot + 1) * stride), count * stride);
          }
          count++;
        }
        batch.mesh.count = count;
        batch.mesh.visible = count > 0;
        for (const { attribute } of batch.attributes) {
          attribute.clearUpdateRanges();
          if (count > 0) attribute.addUpdateRange(0, count * attribute.itemSize);
          attribute.needsUpdate = true;
        }
      }
      this.lastProjection.copy(this.cellProjection);
      this.lastWind = wind;
      this.lastCoordinateSystem = camera.coordinateSystem;
      this.lastReversedDepth = camera.reversedDepth;
      this.prepared = true;
    }
  }
}
