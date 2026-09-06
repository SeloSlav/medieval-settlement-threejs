import * as THREE from 'three';
import { StaticRenderBundle } from './StaticRenderBundle.ts';

/** Cache opaque draw commands; shaders and versioned instance data stay live. */
export function bundleRigidDraws(parent: THREE.Group): void {
  const byOrder = new Map<number, THREE.Mesh[]>();
  for (const child of parent.children) {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || mesh.children.length || Array.isArray(mesh.material)
      || mesh.material.transparent || mesh.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender) continue;
    const entries = byOrder.get(mesh.renderOrder) ?? [];
    entries.push(mesh); byOrder.set(mesh.renderOrder, entries);
  }
  for (const [order, entries] of byOrder) {
    if (entries.length < 4) continue;
    const group = new StaticRenderBundle();
    group.name = `${parent.name} cached opaque draws`; group.renderOrder = order;
    parent.add(group);
    for (const mesh of entries) group.add(mesh);
  }
}
