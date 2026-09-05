import * as THREE from 'three';

type State = { local: Float64Array; parent: THREE.Object3D | null; auto: boolean; worldAuto: boolean; world: Float64Array };

/** Avoid recomposing unchanged transforms while retaining a live scene topology. */
export function installSceneTransformCache(scene: THREE.Scene): void {
  const states = new WeakMap<THREE.Object3D, State>();
  const ordinaryUpdate = THREE.Object3D.prototype.updateMatrixWorld;
  const ordinaryLocal = THREE.Object3D.prototype.updateMatrix;
  const visit = (node: THREE.Object3D, force: boolean, root = false): void => {
    // Skinning bind modes and explicit rig/visibility boundaries keep their
    // original update semantics. They own their complete descendant evaluation.
    if ((!root && node.updateMatrixWorld !== ordinaryUpdate) || node.updateMatrix !== ordinaryLocal) {
      node.updateMatrixWorld(force);
      return;
    }
    let state = states.get(node);
    if (!state) {
      state = { local: new Float64Array(16).fill(NaN), parent: node.parent, auto: node.matrixAutoUpdate, worldAuto: node.matrixWorldAutoUpdate, world: new Float64Array(16).fill(NaN) };
      states.set(node, state); force = true;
    }
    if (state.parent !== node.parent || state.auto !== node.matrixAutoUpdate) {
      force = true; state.local.fill(NaN); state.parent = node.parent; state.auto = node.matrixAutoUpdate;
    }
    const local = state.local;
    let changed = false;
    if (node.matrixAutoUpdate) {
      const p = node.position, q = node.quaternion, s = node.scale;
      const pivot = (node as THREE.Object3D & { pivot?: THREE.Vector3 | null }).pivot;
      changed = local[0] !== p.x || local[1] !== p.y || local[2] !== p.z
        || local[3] !== q.x || local[4] !== q.y || local[5] !== q.z || local[6] !== q.w
        || local[7] !== s.x || local[8] !== s.y || local[9] !== s.z
        || local[10] !== (pivot?.x ?? 0) || local[11] !== (pivot?.y ?? 0) || local[12] !== (pivot?.z ?? 0);
      if (changed) {
        node.updateMatrix();
        local[0] = p.x; local[1] = p.y; local[2] = p.z;
        local[3] = q.x; local[4] = q.y; local[5] = q.z; local[6] = q.w;
        local[7] = s.x; local[8] = s.y; local[9] = s.z;
        local[10] = pivot?.x ?? 0; local[11] = pivot?.y ?? 0; local[12] = pivot?.z ?? 0;
      }
    } else {
      for (let i = 0; i < 16; i++) {
        const value = node.matrix.elements[i]!;
        if (local[i] !== value) changed = true;
        local[i] = value;
      }
    }
    force ||= changed || node.matrixWorldNeedsUpdate;
    if (state.worldAuto !== node.matrixWorldAutoUpdate) { force = true; state.worldAuto = node.matrixWorldAutoUpdate; }
    // Explicit external matrix writes are observable too, including restoration
    // of automatically owned world matrices on the next scene update.
    for (let i = 0; i < 16 && !force; i++) if (state.world[i] !== node.matrixWorld.elements[i]) force = true;
    if (node.matrixWorldAutoUpdate) {
      if (force) {
        if (node.parent) node.matrixWorld.multiplyMatrices(node.parent.matrixWorld, node.matrix);
        else node.matrixWorld.copy(node.matrix);
      }
    }
    if (force) state.world.set(node.matrixWorld.elements);
    node.matrixWorldNeedsUpdate = false;
    for (const child of node.children) visit(child, force);
  };
  scene.updateMatrixWorld = (force = false) => visit(scene, force, true);
}
