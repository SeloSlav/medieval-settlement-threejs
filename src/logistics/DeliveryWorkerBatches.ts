import * as THREE from 'three';
import { AuthoredSkinnedInstanceBatch } from '../scene/AuthoredSkinnedInstanceBatch.ts';
import { configureVillagerMaterialLighting } from '../settlement/villagerMaterialLighting.ts';
import type { VillagerModelVariant } from '../settlement/SettlementCrowdRenderer.ts';
import type { DeliveryCartWorkerSources, DeliveryCartWorkerVisual } from './deliveryCartWorker.ts';

/** Exact AnimationMixer + hand-IK poses, submitted once per authored body layer. */
export class DeliveryWorkerBatches {
  private readonly batches: Record<VillagerModelVariant, AuthoredSkinnedInstanceBatch>;
  private readonly registered = new Map<DeliveryCartWorkerVisual, boolean>();
  private readonly previous: Record<VillagerModelVariant, DeliveryCartWorkerVisual[]> = { man: [], woman: [] };
  private readonly counts: Record<VillagerModelVariant, number> = { man: 0, woman: 0 };
  private readonly colors = new WeakMap<DeliveryCartWorkerVisual, THREE.Color[]>();
  constructor(parent: THREE.Group, sources: DeliveryCartWorkerSources) {
    const create = (variant: VillagerModelVariant) => {
      const materials = new Set<THREE.MeshStandardMaterial>();
      sources[variant].scene.traverse(object => {
        const mesh = object as THREE.SkinnedMesh;
        if (!mesh.isSkinnedMesh) return;
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          if ((material as THREE.MeshStandardMaterial).isMeshStandardMaterial) materials.add(material as THREE.MeshStandardMaterial);
        }
      });
      for (const material of materials) configureVillagerMaterialLighting(material);
      return new AuthoredSkinnedInstanceBatch({ parent, sourceRoot: sources[variant].scene,
        capacity: 8, name: `Exact delivery ${variant} workers`, castShadow: true, receiveShadow: true });
    };
    this.batches = { man: create('man'), woman: create('woman') };
  }
  reserve(capacity: number): void { for (const batch of Object.values(this.batches)) batch.reserve(capacity); }
  register(worker: DeliveryCartWorkerVisual): void {
    if (this.registered.has(worker)) return;
    const batch = this.batches[this.variant(worker)];
    batch.prepareCloneBinding(worker.model);
    const materials: THREE.Material[][] = [];
    worker.model.traverse(object => {
      const mesh = object as THREE.SkinnedMesh;
      if (mesh.isSkinnedMesh) materials.push(Array.isArray(mesh.material) ? mesh.material : [mesh.material]);
    });
    this.colors.set(worker, batch.materialSlots().map(slot =>
      (materials[slot.layerIndex][slot.materialIndex] as THREE.MeshStandardMaterial).color.clone()));
    this.registered.set(worker, worker.model.visible);
    worker.model.visible = false;
  }
  unregister(worker: DeliveryCartWorkerVisual): void {
    const visible = this.registered.get(worker);
    if (visible === undefined) return;
    worker.model.visible = visible; this.registered.delete(worker); this.colors.delete(worker);
  }
  begin(): void { this.counts.man = 0; this.counts.woman = 0; }
  add(worker: DeliveryCartWorkerVisual): void {
    const variant = this.variant(worker), slot = this.counts[variant]++, batch = this.batches[variant];
    batch.setFromCloneAt(slot, worker.model);
    if (this.previous[variant][slot] !== worker) {
      for (const [index, color] of this.colors.get(worker)!.entries()) batch.setMaterialColorAt(slot, index, color);
      this.previous[variant][slot] = worker;
    }
  }
  finish(): void {
    for (const variant of ['man', 'woman'] as const) {
      this.previous[variant].length = this.counts[variant];
      this.batches[variant].setCount(this.counts[variant]); this.batches[variant].commit();
    }
  }
  diagnostics() { return { man: this.batches.man.diagnostics(), woman: this.batches.woman.diagnostics() }; }
  dispose(): void {
    for (const [worker, visible] of this.registered) worker.model.visible = visible;
    this.registered.clear(); for (const batch of Object.values(this.batches)) batch.dispose();
  }
  private variant(worker: DeliveryCartWorkerVisual): VillagerModelVariant {
    return worker.root.userData.villagerGender as VillagerModelVariant;
  }
}
