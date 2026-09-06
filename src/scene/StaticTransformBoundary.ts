import * as THREE from 'three';

const invalidators = new WeakMap<THREE.Object3D, () => void>();

/** A rigid authored subtree whose owning state synchronizer reports edits. */
export function installStaticTransformBoundary(root: THREE.Object3D): void {
  if (invalidators.has(root)) return;
  const update = root.updateMatrixWorld, previous = new THREE.Matrix4();
  let dirty = true;
  invalidators.set(root, () => { dirty = true; });
  root.updateMatrixWorld = function() {
    this.updateWorldMatrix(false, false);
    if (!dirty && previous.equals(this.matrixWorld)) return;
    update.call(this, true); previous.copy(this.matrixWorld); dirty = false;
  };
}

export function invalidateStaticTransformBoundary(root: THREE.Object3D): void {
  invalidators.get(root)?.();
}
