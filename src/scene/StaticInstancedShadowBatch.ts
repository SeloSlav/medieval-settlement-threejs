import * as THREE from 'three';
import { TREE_SHADOW_CAST_LAYER } from './SceneLayers.ts';

type ShadowSource = THREE.Mesh<THREE.BufferGeometry, THREE.Material>;

type ShadowBatch = {
  mesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material>;
  sources: ShadowSource[];
  visibleSources: ShadowSource[];
};

/**
 * Replaces immutable single-mesh shadow submissions with exact instanced
 * submissions grouped only when geometry, material, and shadow state match.
 * The authored color meshes remain attached and ordered exactly as before.
 */
export class StaticInstancedShadowBatch {
  readonly group = new THREE.Group();
  private readonly sources: ShadowSource[];
  private readonly root: THREE.Object3D;
  private readonly batches: ShadowBatch[] = [];
  private readonly rootWorldInverse = new THREE.Matrix4();
  private readonly relativeMatrix = new THREE.Matrix4();

  constructor(
    root: THREE.Object3D,
    sources: readonly THREE.Mesh[],
    name: string,
  ) {
    this.root = root;
    this.group.name = name;
    this.group.userData.staticInstancedShadowBatch = true;
    this.sources = sources.filter((source): source is ShadowSource => (
      source.castShadow
      && !Array.isArray(source.material)
      && !(source as THREE.InstancedMesh).isInstancedMesh
      && source.geometry.getAttribute('position') !== undefined
    ));
    for (const source of this.sources) {
      source.userData.staticShadowBatchSource = true;
      source.castShadow = false;
    }
    root.add(this.group);
    this.createBatches();
    this.rebuild();
  }

  rebuild(): void {
    this.root.updateWorldMatrix(true, true);
    this.rootWorldInverse.copy(this.root.matrixWorld).invert();
    let sourceMeshCount = 0;
    let activeBatchCount = 0;
    for (const batch of this.batches) {
      const visibleSources = batch.sources.filter((source) => (
        visibleThroughRoot(source, this.root)
      ));
      const membershipChanged = !sameSources(batch.visibleSources, visibleSources);
      if (membershipChanged) {
        for (let index = 0; index < visibleSources.length; index += 1) {
          this.relativeMatrix.multiplyMatrices(
            this.rootWorldInverse,
            visibleSources[index]!.matrixWorld,
          );
          batch.mesh.setMatrixAt(index, this.relativeMatrix);
        }
        batch.mesh.count = visibleSources.length;
        if (visibleSources.length > 0) batch.mesh.instanceMatrix.needsUpdate = true;
        if (batch.mesh.frustumCulled) {
          batch.mesh.computeBoundingBox();
          batch.mesh.computeBoundingSphere();
        }
        batch.visibleSources = visibleSources;
      }
      sourceMeshCount += visibleSources.length;
      activeBatchCount += visibleSources.length > 0 ? 1 : 0;
    }
    this.group.userData.sourceMeshCount = sourceMeshCount;
    this.group.userData.batchCount = activeBatchCount;
  }

  dispose(): void {
    for (const batch of this.batches) {
      batch.mesh.removeFromParent();
      batch.mesh.dispose();
    }
    this.batches.length = 0;
    this.group.removeFromParent();
    for (const source of this.sources) source.castShadow = true;
  }

  private createBatches(): void {
    const entries = new Map<string, ShadowSource[]>();
    for (const source of this.sources) {
      const key = [
        source.geometry.uuid,
        source.material.uuid,
        source.renderOrder,
        source.frustumCulled ? 1 : 0,
        source.customDepthMaterial?.uuid ?? '',
        source.customDistanceMaterial?.uuid ?? '',
      ].join('|');
      const bucket = entries.get(key) ?? [];
      bucket.push(source);
      entries.set(key, bucket);
    }

    let batchIndex = 0;
    for (const bucket of entries.values()) {
      const first = bucket[0]!;
      const batch = new THREE.InstancedMesh(
        first.geometry,
        first.material,
        bucket.length,
      );
      batch.name = `${this.group.name} ${batchIndex + 1}`;
      batch.layers.set(TREE_SHADOW_CAST_LAYER);
      batch.castShadow = true;
      batch.receiveShadow = false;
      batch.renderOrder = first.renderOrder;
      batch.frustumCulled = first.frustumCulled;
      batch.customDepthMaterial = first.customDepthMaterial;
      batch.customDistanceMaterial = first.customDistanceMaterial;
      batch.userData.staticInstancedShadowBatch = true;
      batch.userData.sourceMeshCount = bucket.length;
      batch.count = 0;
      this.group.add(batch);
      this.batches.push({ mesh: batch, sources: bucket, visibleSources: [] });
      batchIndex += 1;
    }
  }
}

function sameSources(left: readonly ShadowSource[], right: readonly ShadowSource[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
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
