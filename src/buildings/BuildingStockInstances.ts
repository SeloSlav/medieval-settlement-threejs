import * as THREE from 'three';
import { geometryEqualsGeometry, geometryFingerprint } from '../scene/geometryIdentity.ts';

type Mesh = THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
type Part = { source: Mesh; marker: THREE.Group; layers: number; batch: Batch; relative: THREE.Matrix4 };
type Batch = { mesh: THREE.InstancedMesh; parts: Set<Part>; capacity: number };

/** Exact rigid stock pieces retain their authored visibility and transform owners. */
export class BuildingStockInstances {
  readonly group = new THREE.Group();
  private readonly entries = new Map<string, Part[]>();
  private readonly batches = new Map<string, Batch[]>();
  private readonly chain: THREE.Object3D[] = [];

  constructor(parent: THREE.Group) { this.group.name = 'Exact building stock instances'; parent.add(this.group); }

  register(id: string, marker: THREE.Group): void {
    this.remove(id);
    const parts: Part[] = [];
    marker.traverse(object => {
      const source = object as Mesh;
      if (!source.isMesh || Array.isArray(source.material) || (source as THREE.InstancedMesh).isInstancedMesh
        || source.layers.mask === 0 || source.material.transparent || !source.material.visible
        || source.userData.buildingDetailCasterBatch || source.userData.buildingStaticCollisionProxy
        || Object.keys(source.geometry.morphAttributes).length || source.children.length
        || source.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender) return;
      let node: THREE.Object3D | null = source;
      let stock = false;
      while (node && node !== marker) {
        if (/Stock|Segment|FirewoodPile|Coffer|Chest/.test(node.name)) stock = true;
        node = node.parent;
      }
      if (!stock) return;
      const key = [source.material.uuid, source.castShadow, source.receiveShadow, source.layers.mask,
        source.renderOrder, source.customDepthMaterial?.uuid, source.customDistanceMaterial?.uuid,
        geometryFingerprint(source.geometry)].join('|');
      const candidates = this.batches.get(key) ?? [];
      let batch = candidates.find(candidate => geometryEqualsGeometry(source.geometry, candidate.mesh.geometry));
      if (!batch) {
        const mesh = new THREE.InstancedMesh(source.geometry.clone(), source.material, 8);
        mesh.name = 'Instanced building stock'; mesh.count = 0;
        mesh.castShadow = source.castShadow; mesh.receiveShadow = source.receiveShadow;
        mesh.layers.mask = source.layers.mask; mesh.renderOrder = source.renderOrder;
        mesh.customDepthMaterial = source.customDepthMaterial;
        mesh.customDistanceMaterial = source.customDistanceMaterial;
        mesh.userData.buildingDetailShadowCaster = source.userData.buildingDetailShadowCaster;
        batch = { mesh, parts: new Set(), capacity: 8 };
        candidates.push(batch); this.batches.set(key, candidates); this.group.add(mesh);
      }
      const part = { source, marker, layers: source.layers.mask, batch, relative: new THREE.Matrix4() };
      parts.push(part); batch.parts.add(part); source.layers.mask = 0;
    });
    this.entries.set(id, parts);
  }

  remove(id: string): void {
    for (const part of this.entries.get(id) ?? []) {
      part.source.layers.mask = part.layers;
      part.batch.parts.delete(part);
    }
    this.entries.delete(id);
  }

  flush(): void {
    for (const [key, candidates] of this.batches) {
      for (let b = candidates.length - 1; b >= 0; b--) {
        const batch = candidates[b]!;
        if (!batch.parts.size) {
          batch.mesh.removeFromParent(); batch.mesh.dispose(); batch.mesh.geometry.dispose();
          candidates.splice(b, 1); continue;
        }
        if (batch.capacity < batch.parts.size) {
          const old = batch.mesh;
          batch.capacity = 2 ** Math.ceil(Math.log2(batch.parts.size));
          batch.mesh = new THREE.InstancedMesh(old.geometry, old.material, batch.capacity);
          batch.mesh.name = old.name; batch.mesh.castShadow = old.castShadow; batch.mesh.receiveShadow = old.receiveShadow;
          batch.mesh.layers.mask = old.layers.mask; batch.mesh.renderOrder = old.renderOrder;
          batch.mesh.customDepthMaterial = old.customDepthMaterial; batch.mesh.customDistanceMaterial = old.customDistanceMaterial;
          batch.mesh.userData = { ...old.userData }; old.removeFromParent(); old.dispose(); this.group.add(batch.mesh);
        }
        let count = 0, changed = false;
        const array = batch.mesh.instanceMatrix.array;
        for (const part of batch.parts) {
          this.chain.length = 0;
          let node: THREE.Object3D | null = part.source, visible = true;
          while (node && node !== part.marker.parent) {
            if (!node.visible) { visible = false; break; }
            this.chain.push(node); node = node.parent;
          }
          if (!visible) continue;
          part.relative.identity();
          for (let i = this.chain.length - 1; i >= 0; i--) {
            const ancestor = this.chain[i]!;
            if (ancestor.matrixAutoUpdate) ancestor.updateMatrix();
            part.relative.multiply(ancestor.matrix);
          }
          for (let i = 0; i < 16; i++) {
            const value = Math.fround(part.relative.elements[i]!);
            if (array[count * 16 + i] !== value) { array[count * 16 + i] = value; changed = true; }
          }
          count++;
        }
        if (count !== batch.mesh.count) changed = true;
        batch.mesh.count = count;
        if (changed) {
          batch.mesh.instanceMatrix.needsUpdate = true;
          batch.mesh.computeBoundingBox(); batch.mesh.computeBoundingSphere();
        }
      }
      if (!candidates.length) this.batches.delete(key);
    }
  }

  dispose(): void {
    for (const id of this.entries.keys()) this.remove(id);
    this.flush(); this.group.removeFromParent();
  }
}
