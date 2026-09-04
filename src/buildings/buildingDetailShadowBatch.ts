import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TREE_SHADOW_CAST_LAYER } from '../scene/SceneLayers.ts';
import {
  BUILDING_DETAIL_SHADOW_CASTER_FLAG,
} from './buildingShadowProxy.ts';

export const BUILDING_DETAIL_CASTER_BATCH_FLAG =
  'buildingDetailCasterBatch';
export const BUILDING_DETAIL_CASTER_BATCH_SOURCE_FLAG =
  'buildingDetailCasterBatchSource';

type DetailCaster = THREE.Mesh<THREE.BufferGeometry, THREE.Material>;

type DetailCasterBucket = {
  readonly sources: DetailCaster[];
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  /** Reused numeric snapshot; refresh allocates nothing after initial growth. */
  readonly signature: number[];
  sourceDraws: number;
  sourceTriangles: number;
};

export type BuildingDetailCasterBatchStats = {
  readonly sourceDraws: number;
  readonly batchDraws: number;
  readonly sourceTriangles: number;
  readonly batchTriangles: number;
  readonly rejectedSources: number;
};

const installedBatches = new WeakMap<THREE.Object3D, BuildingDetailCasterBatches>();

/**
 * Installs exact shadow-only merged geometry for authored, immutable building
 * details. Color continues to use every original mesh/material. The shadow
 * copy bakes the same object and instance transforms into identical vertex
 * attributes and preserves material identity, sidedness, alpha cutouts,
 * clipping, and custom depth/distance materials.
 */
export function installBuildingDetailCasterBatches(
  root: THREE.Object3D,
  name: string,
): BuildingDetailCasterBatchStats {
  const existing = installedBatches.get(root);
  if (existing) return existing.getStats();
  const batches = new BuildingDetailCasterBatches(root, name);
  installedBatches.set(root, batches);
  return batches.getStats();
}

/** Rebuilds only buckets whose authored visibility/count/transform changed. */
export function refreshBuildingDetailCasterBatches(root: THREE.Object3D): boolean {
  return installedBatches.get(root)?.refresh() ?? false;
}

export function getBuildingDetailCasterBatchStats(
  root: THREE.Object3D,
): BuildingDetailCasterBatchStats | null {
  return installedBatches.get(root)?.getStats() ?? null;
}

class BuildingDetailCasterBatches {
  private readonly root: THREE.Object3D;
  private readonly group = new THREE.Group();
  private readonly buckets: DetailCasterBucket[] = [];
  private readonly instanceMatrix = new THREE.Matrix4();
  private readonly sourceRelativeMatrix = new THREE.Matrix4();
  private readonly relativeMatrix = new THREE.Matrix4();
  private readonly relativeChain: THREE.Object3D[] = [];
  private rejectedSources = 0;

  constructor(root: THREE.Object3D, name: string) {
    this.root = root;
    this.group.name = name;
    this.group.userData[BUILDING_DETAIL_CASTER_BATCH_FLAG] = true;

    const entries = new Map<string, DetailCaster[]>();
    root.traverse((object) => {
      const source = object as DetailCaster;
      if (
        !source.isMesh
        || source.userData[BUILDING_DETAIL_SHADOW_CASTER_FLAG] !== true
      ) {
        return;
      }
      if (!isMergeableCaster(source)) {
        this.rejectedSources += 1;
        return;
      }
      const key = casterBatchKey(source);
      const bucket = entries.get(key) ?? [];
      bucket.push(source);
      entries.set(key, bucket);
    });

    let batchIndex = 0;
    for (const sources of entries.values()) {
      const first = sources[0]!;
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), first.material);
      mesh.name = `${name} ${batchIndex + 1}`;
      mesh.layers.set(TREE_SHADOW_CAST_LAYER);
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      mesh.renderOrder = first.renderOrder;
      mesh.frustumCulled = first.frustumCulled;
      mesh.customDepthMaterial = first.customDepthMaterial;
      mesh.customDistanceMaterial = first.customDistanceMaterial;
      mesh.userData[BUILDING_DETAIL_SHADOW_CASTER_FLAG] = true;
      mesh.userData[BUILDING_DETAIL_CASTER_BATCH_FLAG] = true;
      this.group.add(mesh);
      this.buckets.push({
        sources,
        mesh,
        signature: [],
        sourceDraws: 0,
        sourceTriangles: 0,
      });
      for (const source of sources) {
        source.castShadow = false;
        source.userData[BUILDING_DETAIL_SHADOW_CASTER_FLAG] = false;
        source.userData[BUILDING_DETAIL_CASTER_BATCH_SOURCE_FLAG] = true;
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
    for (let bucketIndex = 0; bucketIndex < this.buckets.length; bucketIndex += 1) {
      const bucket = this.buckets[bucketIndex]!;
      if (!this.updateBucketSignature(bucket)) continue;
      this.rebuildBucket(bucket);
      changed = true;
    }
    return changed;
  }

  getStats(): BuildingDetailCasterBatchStats {
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
    return {
      sourceDraws,
      batchDraws,
      sourceTriangles,
      batchTriangles,
      rejectedSources: this.rejectedSources,
    };
  }

  private updateBucketSignature(bucket: DetailCasterBucket): boolean {
    const values = bucket.signature;
    let cursor = 0;
    let changed = false;
    for (let sourceIndex = 0; sourceIndex < bucket.sources.length; sourceIndex += 1) {
      const source = bucket.sources[sourceIndex]!;
      const visible = visibleThroughRoot(source, this.root);
      const visibilityValue = visible ? 1 : 0;
      if (values[cursor] !== visibilityValue) changed = true;
      values[cursor] = visibilityValue;
      cursor += 1;
      if (!visible) continue;
      source.updateWorldMatrix(true, false);
      // The merged caster geometry is stored relative to the building root.
      // Moving or rotating a whole building therefore cannot invalidate it.
      // Hashing world matrices here made authoritative adoption of the
      // prewarmed founders' camp rebuild every shadow bucket on the click.
      matrixRelativeToAncestor(
        source,
        this.root,
        this.relativeMatrix,
        this.relativeChain,
      );
      const relativeElements = this.relativeMatrix.elements;
      for (let elementIndex = 0; elementIndex < 16; elementIndex += 1) {
        const value = relativeElements[elementIndex]!;
        if (values[cursor] !== value) changed = true;
        values[cursor] = value;
        cursor += 1;
      }
      if ((source as THREE.InstancedMesh).isInstancedMesh) {
        const instanced = source as THREE.InstancedMesh;
        if (values[cursor] !== instanced.count) changed = true;
        values[cursor] = instanced.count;
        cursor += 1;
        for (let index = 0; index < instanced.count; index += 1) {
          instanced.getMatrixAt(index, this.instanceMatrix);
          const instanceElements = this.instanceMatrix.elements;
          for (let elementIndex = 0; elementIndex < 16; elementIndex += 1) {
            const value = instanceElements[elementIndex]!;
            if (values[cursor] !== value) changed = true;
            values[cursor] = value;
            cursor += 1;
          }
        }
      }
    }
    if (values.length !== cursor) changed = true;
    values.length = cursor;
    return changed;
  }

  private rebuildBucket(bucket: DetailCasterBucket): void {
    const transformed: THREE.BufferGeometry[] = [];
    let sourceDraws = 0;
    let sourceTriangles = 0;
    for (const source of bucket.sources) {
      if (!visibleThroughRoot(source, this.root)) continue;
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
          this.relativeMatrix
            .multiplyMatrices(this.sourceRelativeMatrix, this.instanceMatrix);
          transformed.push(source.geometry.clone().applyMatrix4(this.relativeMatrix));
        }
      } else {
        sourceDraws += 1;
        sourceTriangles += triangles;
        transformed.push(source.geometry.clone().applyMatrix4(this.sourceRelativeMatrix));
      }
    }

    const previousGeometry = bucket.mesh.geometry;
    if (transformed.length === 0) {
      bucket.mesh.visible = false;
      bucket.sourceDraws = 0;
      bucket.sourceTriangles = 0;
      return;
    }
    const merged = transformed.length === 1
      ? transformed[0]!
      : mergeGeometries(transformed, false);
    if (merged && transformed.length > 1) {
      preserveGeometryGroups(merged, transformed);
    }
    if (transformed.length > 1) {
      for (const geometry of transformed) geometry.dispose();
    }
    if (!merged) {
      throw new Error('Exact building-detail caster geometry failed to merge.');
    }
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    bucket.mesh.geometry = merged;
    bucket.mesh.visible = true;
    bucket.sourceDraws = sourceDraws;
    bucket.sourceTriangles = sourceTriangles;
    previousGeometry.dispose();
  }
}

/**
 * Compose the authored local chain directly. Cancelling two world matrices is
 * algebraically equivalent, but rotation/translation round-off changes the
 * last few bits and defeats the exact no-op signature used during placement.
 */
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
    throw new Error('Building detail caster must descend from its batching root.');
  }
  target.identity();
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    target.multiply(chain[index]!.matrix);
  }
  return target;
}

function isMergeableCaster(source: DetailCaster): boolean {
  const geometry = source.geometry;
  const material = source.material as THREE.Material & {
    displacementMap?: THREE.Texture | null;
  };
  return !(source as THREE.SkinnedMesh).isSkinnedMesh
    && !(source as THREE.BatchedMesh).isBatchedMesh
    && !Array.isArray(source.material)
    && source.onBeforeShadow === THREE.Object3D.prototype.onBeforeShadow
    && source.onAfterShadow === THREE.Object3D.prototype.onAfterShadow
    && material.displacementMap == null
    && geometry.getAttribute('position') !== undefined
    && Object.keys(geometry.morphAttributes).length === 0
    && Object.values(geometry.attributes).every(
      (attribute) => !(attribute as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute,
    )
    && geometry.drawRange.start === 0
    && geometry.drawRange.count === Infinity;
}

function casterBatchKey(source: DetailCaster): string {
  return [
    source.material.uuid,
    source.renderOrder,
    source.frustumCulled ? 1 : 0,
    source.customDepthMaterial?.uuid ?? '',
    source.customDistanceMaterial?.uuid ?? '',
    source.geometry.index ? 1 : 0,
    Object.entries(source.geometry.attributes)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, attribute]) => [
        name,
        attribute.itemSize,
        attribute.normalized ? 1 : 0,
        attribute.array.constructor.name,
      ].join(':'))
      .join(';'),
  ].join('|');
}

function visibleThroughRoot(object: THREE.Object3D, root: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (!current.visible) return false;
    if (current === root) return true;
    current = current.parent;
  }
  return false;
}

function geometryTriangles(geometry: THREE.BufferGeometry): number {
  return (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
}

/** BufferGeometry groups are inert for one material, but retain the metadata. */
function preserveGeometryGroups(
  merged: THREE.BufferGeometry,
  sources: readonly THREE.BufferGeometry[],
): void {
  merged.clearGroups();
  let offset = 0;
  for (const source of sources) {
    for (const group of source.groups) {
      merged.addGroup(
        offset + group.start,
        group.count,
        group.materialIndex,
      );
    }
    offset += source.index?.count ?? source.getAttribute('position').count;
  }
}
