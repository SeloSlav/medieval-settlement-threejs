import type * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';

/** Give each source material a stable shadow override and binding identity. */
export function installShadowOverrideCache(renderer: WebGPURenderer): void {
  type ShadowMaterial = THREE.Material & { isShadowPassMaterial?: boolean };
  type Entry = { clone: ShadowMaterial; sourceVersion: number; baseVersion: number; release(): void };
  type Renderer = {
    renderObject(object: THREE.Object3D, scene: THREE.Scene, camera: THREE.Camera, geometry: THREE.BufferGeometry, material: THREE.Material, ...args: unknown[]): void;
    dispose(): void;
  };
  const target = renderer as unknown as Renderer;
  const draw = target.renderObject, dispose = target.dispose;
  const byBase = new WeakMap<THREE.Material, WeakMap<THREE.Material, Entry>>();
  const owned = new Set<Entry>();
  target.renderObject = function(object, scene, camera, geometry, source, ...args) {
    const base = scene.overrideMaterial as ShadowMaterial | null;
    if (!base?.isShadowPassMaterial || !source.allowOverride) return draw.call(this, object, scene, camera, geometry, source, ...args);
    let entries = byBase.get(base);
    if (!entries) { entries = new WeakMap(); byBase.set(base, entries); }
    let entry = entries.get(source);
    if (!entry || entry.sourceVersion !== source.version || entry.baseVersion !== base.version) {
      entry?.release();
      const clone = base.clone() as ShadowMaterial; clone.isShadowPassMaterial = true;
      const release = () => {
        source.removeEventListener('dispose', release); base.removeEventListener('dispose', release);
        clone.dispose(); owned.delete(created); entries!.delete(source);
      };
      const created: Entry = { clone, sourceVersion: source.version, baseVersion: base.version, release };
      entry = created; entries.set(source, entry); owned.add(entry);
      source.addEventListener('dispose', release); base.addEventListener('dispose', release);
    }
    scene.overrideMaterial = entry.clone;
    try { draw.call(this, object, scene, camera, geometry, source, ...args); }
    finally { scene.overrideMaterial = base; }
  };
  target.dispose = function() {
    for (const entry of owned) entry.release();
    dispose.call(this);
  };
}
