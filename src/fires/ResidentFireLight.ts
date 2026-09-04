import * as THREE from 'three';
import { fireEffectFromRoot, updateFireEffect, type FireEffect } from './FireEffect.ts';

/** Keeps a prepared fire's light identity in the scene while its model is
 * detached. Adding/removing a light invalidates every lit WebGPU render object,
 * including terrain and woodland, not just the fire's own shaders. */
export class ResidentFireLight {
  private readonly effect: FireEffect;
  private readonly anchor = new THREE.Object3D();
  private readonly position = new THREE.Vector3();
  private readonly root: THREE.Group;
  private readonly parent: THREE.Group;

  constructor(root: THREE.Group, parent: THREE.Group) {
    this.root = root;
    this.parent = parent;
    const effect = fireEffectFromRoot(root);
    if (!effect) throw new Error('Resident light requires a registered fire effect.');
    this.effect = effect;
    this.anchor.name = 'Resident fire light anchor';
    this.anchor.position.copy(effect.light.position);
    root.add(this.anchor);
    parent.add(effect.light);
    this.sync();
  }

  sync(): void {
    let attached = false;
    for (let object: THREE.Object3D | null = this.root; object; object = object.parent) {
      if (!object.visible) break;
      if (object === this.parent) { attached = true; break; }
    }
    const light = this.effect.light;
    if (!attached || !this.effect.active) {
      light.intensity = 0;
      return;
    }
    // Position and intensity are uniforms: restoring the camp never changes
    // the lighting shader signature. Preserve the authored flicker/attenuation.
    this.anchor.getWorldPosition(this.position);
    this.parent.worldToLocal(this.position);
    light.position.copy(this.position);
    updateFireEffect(this.effect, 0);
  }

  dispose(): void {
    this.anchor.removeFromParent();
    this.effect.light.removeFromParent();
  }
}
