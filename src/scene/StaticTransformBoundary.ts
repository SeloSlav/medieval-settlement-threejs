import * as THREE from 'three';

const invalidators = new WeakMap<THREE.Object3D, () => void>();
const retainedOnly = new WeakSet<THREE.Object3D>();
const dynamicRenderSubtrees = new WeakSet<THREE.Object3D>();
const dynamicTransformSubtrees = new WeakSet<THREE.Object3D>();

/** A particle/effect owner can add visible descendants between state updates. */
export function retainDynamicRenderSubtree(root: THREE.Object3D): void {
  dynamicRenderSubtrees.add(root);
}

/** Register moving children before installation, or invalidate their owner afterward. */
export function retainDynamicTransformSubtree(root: THREE.Object3D): void {
  dynamicTransformSubtrees.add(root);
  retainDynamicRenderSubtree(root);
}

function collectDynamicTransforms(root: THREE.Object3D, result: THREE.Object3D[]): void {
  for (const child of root.children) {
    if (dynamicTransformSubtrees.has(child)) result.push(child);
    else collectDynamicTransforms(child, result);
  }
}

export function isRetainedRenderSubtree(root: THREE.Object3D): boolean {
  return retainedOnly.has(root);
}

function classifyRenderSubtrees(root: THREE.Object3D): boolean {
  if (dynamicRenderSubtrees.has(root)) { retainedOnly.delete(root); return true; }
  const object = root as THREE.Mesh & THREE.Light & THREE.Line & THREE.Points & THREE.Sprite & THREE.LOD;
  let renderable = ((object.isMesh || object.isLine || object.isPoints || object.isSprite) && root.layers.mask !== 0)
    || !!object.isLight || !!object.isLOD
    || root.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender;
  for (const child of root.children) renderable = classifyRenderSubtrees(child) || renderable;
  if (renderable) retainedOnly.delete(root); else retainedOnly.add(root);
  return renderable;
}

/** State synchronizers report rigid edits; registered animated islands stay live. */
export function installStaticTransformBoundary(root: THREE.Object3D): void {
  if (invalidators.has(root)) return;
  const update = root.updateMatrixWorld, previous = new THREE.Matrix4();
  let dirty = true;
  const animated: THREE.Object3D[] = [];
  invalidators.set(root, () => { dirty = true; });
  root.updateMatrixWorld = function() {
    this.updateWorldMatrix(false, false);
    if (!dirty && previous.equals(this.matrixWorld)) {
      for (const island of animated) island.updateMatrixWorld();
      return;
    }
    if (dirty) {
      classifyRenderSubtrees(this);
      animated.length = 0;
      collectDynamicTransforms(this, animated);
    }
    update.call(this, true); previous.copy(this.matrixWorld); dirty = false;
  };
}

export function invalidateStaticTransformBoundary(root: THREE.Object3D): void {
  invalidators.get(root)?.();
}
