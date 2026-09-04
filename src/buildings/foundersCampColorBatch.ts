import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const FOUNDERS_CAMP_COLOR_BATCH_FLAG =
  'foundersCampColorBatch';
export const FOUNDERS_CAMP_COLOR_BATCH_SOURCE_FLAG =
  'foundersCampColorBatchSource';

export type FoundersCampColorBatchStats = {
  readonly sourceDraws: number;
  readonly batchDraws: number;
  readonly retainedDraws: number;
  readonly sourceTriangles: number;
  readonly batchTriangles: number;
};

type ColorSource = THREE.Mesh<THREE.BufferGeometry, THREE.Material>;

type ColorBatchBucket = {
  readonly sources: ColorSource[];
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  /** Reused numeric snapshot; unchanged placement refreshes allocate nothing. */
  readonly signature: number[];
  sourceDraws: number;
  sourceTriangles: number;
};

const COLOR_LAYER = 0;
const installedBatches = new WeakMap<THREE.Object3D, FoundersCampColorBatches>();

/**
 * Compiles the camp's authored color meshes into exact material-slot batches.
 *
 * Source objects stay attached, named, visible, and geometrically unchanged so
 * stockpile visibility, shelter teardown, winter cover, and first-person
 * collision keep using the authored hierarchy. Only their color-camera layer
 * is disabled. The replacement geometry is baked in camp-local space and is
 * refreshed when one of those runtime controls changes.
 */
export function installFoundersCampColorBatches(
  root: THREE.Group,
): FoundersCampColorBatchStats {
  const existing = installedBatches.get(root);
  if (existing) return existing.getStats();
  const batches = new FoundersCampColorBatches(root);
  installedBatches.set(root, batches);
  return batches.getStats();
}

/** Rebuilds only material slots whose authored visibility/count changed. */
export function refreshFoundersCampColorBatches(root: THREE.Object3D): boolean {
  return installedBatches.get(root)?.refresh() ?? false;
}

export function getFoundersCampColorBatchStats(
  root: THREE.Object3D,
): FoundersCampColorBatchStats | null {
  return installedBatches.get(root)?.getStats() ?? null;
}

class FoundersCampColorBatches {
  private readonly root: THREE.Group;
  private readonly group = new THREE.Group();
  private readonly buckets: ColorBatchBucket[] = [];
  private readonly retainedSources: ColorSource[] = [];
  private readonly instanceMatrix = new THREE.Matrix4();
  private readonly sourceRelativeMatrix = new THREE.Matrix4();
  private readonly relativeMatrix = new THREE.Matrix4();
  private readonly relativeChain: THREE.Object3D[] = [];

  constructor(root: THREE.Group) {
    this.root = root;
    this.group.name = 'Founders camp color batches';
    this.group.userData[FOUNDERS_CAMP_COLOR_BATCH_FLAG] = true;
    this.group.userData.fpNoCollision = true;

    const entries = new Map<string, ColorSource[]>();
    root.traverse((object) => {
      const source = object as ColorSource;
      if (
        !source.isMesh
        || !source.layers.isEnabled(COLOR_LAYER)
        || !hasVisibleMaterial(source)
      ) {
        return;
      }
      if (!isMergeableColorSource(source)) {
        this.retainedSources.push(source);
        return;
      }
      const key = colorBatchKey(source);
      const bucket = entries.get(key) ?? [];
      bucket.push(source);
      entries.set(key, bucket);
    });

    let batchIndex = 0;
    for (const sources of entries.values()) {
      const first = sources[0]!;
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), first.material);
      mesh.name = `Founders camp color batch ${batchIndex + 1}`;
      mesh.layers.set(COLOR_LAYER);
      mesh.castShadow = false;
      mesh.receiveShadow = first.receiveShadow;
      mesh.renderOrder = first.renderOrder;
      mesh.frustumCulled = first.frustumCulled;
      mesh.userData[FOUNDERS_CAMP_COLOR_BATCH_FLAG] = true;
      mesh.userData.fpNoCollision = true;
      this.group.add(mesh);
      this.buckets.push({
        sources,
        mesh,
        signature: [],
        sourceDraws: 0,
        sourceTriangles: 0,
      });
      for (const source of sources) {
        source.layers.disable(COLOR_LAYER);
        source.userData[FOUNDERS_CAMP_COLOR_BATCH_SOURCE_FLAG] = true;
      }
      batchIndex += 1;
    }

    if (this.buckets.length > 0) root.add(this.group);
    this.refresh();
  }

  refresh(): boolean {
    if (this.buckets.length === 0) return false;
    this.root.updateWorldMatrix(true, true);
    let changed = false;
    for (const bucket of this.buckets) {
      if (!this.updateBucketSignature(bucket)) continue;
      this.rebuildBucket(bucket);
      changed = true;
    }
    this.root.userData.foundersCampColorBatchStats = this.getStats();
    return changed;
  }

  getStats(): FoundersCampColorBatchStats {
    let sourceDraws = 0;
    let batchDraws = 0;
    let sourceTriangles = 0;
    let batchTriangles = 0;
    for (const bucket of this.buckets) {
      sourceDraws += bucket.sourceDraws;
      sourceTriangles += bucket.sourceTriangles;
      if (!bucket.mesh.visible) continue;
      batchDraws += 1;
      batchTriangles += geometryTriangles(bucket.mesh.geometry);
    }
    let retainedDraws = 0;
    for (const source of this.retainedSources) {
      if (!visibleThroughRoot(source, this.root)) continue;
      retainedDraws += colorDrawsForMesh(source);
    }
    return {
      sourceDraws,
      batchDraws,
      retainedDraws,
      sourceTriangles,
      batchTriangles,
    };
  }

  private updateBucketSignature(bucket: ColorBatchBucket): boolean {
    const values = bucket.signature;
    let cursor = 0;
    let changed = false;
    for (const source of bucket.sources) {
      const visible = visibleThroughRoot(source, this.root)
        && source.material.visible;
      const visibilityValue = visible ? 1 : 0;
      if (values[cursor] !== visibilityValue) changed = true;
      values[cursor] = visibilityValue;
      cursor += 1;
      if (!visible) continue;

      matrixRelativeToAncestor(
        source,
        this.root,
        this.relativeMatrix,
        this.relativeChain,
      );
      for (const value of this.relativeMatrix.elements) {
        if (values[cursor] !== value) changed = true;
        values[cursor] = value;
        cursor += 1;
      }
      if (!(source as THREE.InstancedMesh).isInstancedMesh) continue;
      const instanced = source as THREE.InstancedMesh;
      if (values[cursor] !== instanced.count) changed = true;
      values[cursor] = instanced.count;
      cursor += 1;
      for (let index = 0; index < instanced.count; index += 1) {
        instanced.getMatrixAt(index, this.instanceMatrix);
        for (const value of this.instanceMatrix.elements) {
          if (values[cursor] !== value) changed = true;
          values[cursor] = value;
          cursor += 1;
        }
      }
    }
    if (values.length !== cursor) changed = true;
    values.length = cursor;
    return changed;
  }

  private rebuildBucket(bucket: ColorBatchBucket): void {
    const transformed: THREE.BufferGeometry[] = [];
    let sourceDraws = 0;
    let sourceTriangles = 0;
    for (const source of bucket.sources) {
      if (!visibleThroughRoot(source, this.root) || !source.material.visible) continue;
      const triangles = geometryTriangles(source.geometry);
      matrixRelativeToAncestor(
        source,
        this.root,
        this.sourceRelativeMatrix,
        this.relativeChain,
      );
      if ((source as THREE.InstancedMesh).isInstancedMesh) {
        const instanced = source as THREE.InstancedMesh;
        if (instanced.count <= 0) continue;
        sourceDraws += 1;
        sourceTriangles += triangles * instanced.count;
        for (let index = 0; index < instanced.count; index += 1) {
          instanced.getMatrixAt(index, this.instanceMatrix);
          this.relativeMatrix.multiplyMatrices(
            this.sourceRelativeMatrix,
            this.instanceMatrix,
          );
          transformed.push(transformedGeometry(source.geometry, this.relativeMatrix));
        }
      } else {
        sourceDraws += 1;
        sourceTriangles += triangles;
        transformed.push(transformedGeometry(source.geometry, this.sourceRelativeMatrix));
      }
    }

    bucket.sourceDraws = sourceDraws;
    bucket.sourceTriangles = sourceTriangles;
    bucket.mesh.userData.sourceMeshCount = sourceDraws;
    if (transformed.length === 0) {
      bucket.mesh.visible = false;
      return;
    }

    const merged = transformed.length === 1
      ? transformed[0]!
      : mergeGeometries(transformed, false);
    if (transformed.length > 1) {
      for (const geometry of transformed) geometry.dispose();
    }
    if (!merged) {
      throw new Error('Founders camp color geometry failed to merge.');
    }
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    const previousGeometry = bucket.mesh.geometry;
    bucket.mesh.geometry = merged;
    bucket.mesh.visible = true;
    previousGeometry.dispose();
  }
}

function isMergeableColorSource(source: ColorSource): boolean {
  const geometry = source.geometry;
  const instanced = source as THREE.InstancedMesh;
  return !source.name.startsWith('Animated fire')
    && source.userData.campSmoke !== true
    && source.userData[FOUNDERS_CAMP_COLOR_BATCH_FLAG] !== true
    && !(source as THREE.SkinnedMesh).isSkinnedMesh
    && !(source as THREE.BatchedMesh).isBatchedMesh
    && !Array.isArray(source.material)
    && (!instanced.isInstancedMesh || instanced.instanceColor === null)
    && source.onBeforeRender === THREE.Object3D.prototype.onBeforeRender
    && source.onAfterRender === THREE.Object3D.prototype.onAfterRender
    && geometry.getAttribute('position') !== undefined
    && Object.keys(geometry.morphAttributes).length === 0
    && Object.values(geometry.attributes).every(
      (attribute) => !(attribute as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute,
    )
    && geometry.drawRange.start === 0
    && geometry.drawRange.count === Infinity;
}

function colorBatchKey(source: ColorSource): string {
  return [
    source.material.uuid,
    source.receiveShadow ? 1 : 0,
    source.renderOrder,
    source.frustumCulled ? 1 : 0,
    geometryIndexSignature(source.geometry),
    normalizedGeometryAttributeSignature(source.geometry),
  ].join('|');
}

function geometryIndexSignature(geometry: THREE.BufferGeometry): string {
  const index = geometry.index;
  return index
    ? `indexed:${index.array.constructor.name}:${index.normalized ? 1 : 0}`
    : 'non-indexed';
}

function normalizedGeometryAttributeSignature(
  geometry: THREE.BufferGeometry,
): string {
  const signatures = Object.entries(geometry.attributes)
    .filter(([name]) => name !== 'color')
    .map(([name, attribute]) => attributeSignature(name, attribute));
  const color = geometry.getAttribute('color');
  signatures.push(color
    ? attributeSignature('color', color)
    : 'color:3:0:Float32Array');
  return signatures.sort().join(',');
}

function attributeSignature(
  name: string,
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
): string {
  return [
    name,
    attribute.itemSize,
    attribute.normalized ? 1 : 0,
    attribute.array.constructor.name,
  ].join(':');
}

function transformedGeometry(
  source: THREE.BufferGeometry,
  matrix: THREE.Matrix4,
): THREE.BufferGeometry {
  const geometry = source.clone();
  if (!geometry.getAttribute('color')) {
    const vertexCount = geometry.getAttribute('position').count;
    const colors = new Float32Array(vertexCount * 3);
    colors.fill(1);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
  geometry.applyMatrix4(matrix);
  return geometry;
}

/** Compose local transforms so moving the entire placed camp is a no-op. */
function matrixRelativeToAncestor(
  object: THREE.Object3D,
  ancestor: THREE.Object3D,
  target: THREE.Matrix4,
  chain: THREE.Object3D[],
): THREE.Matrix4 {
  chain.length = 0;
  let current: THREE.Object3D | null = object;
  while (current && current !== ancestor) {
    chain.push(current);
    current = current.parent;
  }
  if (current !== ancestor) {
    throw new Error('Founders camp color source must descend from its root.');
  }
  target.identity();
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    target.multiply(chain[index]!.matrix);
  }
  return target;
}

function visibleThroughRoot(
  object: THREE.Object3D,
  root: THREE.Object3D,
): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (!current.visible) return false;
    if (current === root) return true;
    current = current.parent;
  }
  return false;
}

function hasVisibleMaterial(mesh: THREE.Mesh): boolean {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return materials.some((material) => material.visible);
}

function colorDrawsForMesh(mesh: ColorSource): number {
  if (!mesh.layers.isEnabled(COLOR_LAYER)) return 0;
  if ((mesh as THREE.InstancedMesh).isInstancedMesh) {
    if ((mesh as THREE.InstancedMesh).count <= 0) return 0;
  }
  const geometry = mesh.geometry;
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  if (!Array.isArray(mesh.material) || geometry.groups.length === 0) {
    return materials[0]?.visible === true ? 1 : 0;
  }
  let draws = 0;
  for (const group of geometry.groups) {
    if (group.count <= 0) continue;
    if (materials[group.materialIndex ?? 0]?.visible === true) draws += 1;
  }
  return draws;
}

function geometryTriangles(geometry: THREE.BufferGeometry): number {
  return (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
}
