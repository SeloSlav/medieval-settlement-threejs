import * as THREE from 'three';

/** Retained topology for an immutable authored clone, including mounted tools. */
export class AuthoredRigWorldMatrices {
  private readonly nodes: THREE.Object3D[] = [];
  private readonly parents: number[] = [];
  private readonly localState: Float64Array;
  private readonly changed: Uint8Array;
  private readonly rootWorld = new THREE.Matrix4();
  private initialized = false;
  private readonly root: THREE.Object3D;

  constructor(root: THREE.Object3D) {
    this.root = root;
    const indices = new Map<THREE.Object3D, number>();
    root.traverse(node => {
      indices.set(node, this.nodes.length);
      this.parents.push(indices.get(node.parent!) ?? -1);
      this.nodes.push(node);
    });
    this.localState = new Float64Array(this.nodes.length * 16).fill(Number.NaN);
    this.changed = new Uint8Array(this.nodes.length);
  }

  update(): void {
    // Actor movement and arbitrary transforms above the cloned model retain
    // Three's normal API. Only its immutable descendant layout is cached.
    this.root.updateWorldMatrix(true, false);
    this.changed[0] = !this.initialized || !this.rootWorld.equals(this.root.matrixWorld) ? 1 : 0;
    this.rootWorld.copy(this.root.matrixWorld);
    for (let i = 1; i < this.nodes.length; i++) {
      const node = this.nodes[i]!;
      const offset = i * 16;
      const state = this.localState;
      let localChanged = false;
      if (node.matrixAutoUpdate) {
        const p = node.position, q = node.quaternion, s = node.scale;
        localChanged = state[offset] !== p.x || state[offset+1] !== p.y || state[offset+2] !== p.z
          || state[offset+3] !== q.x || state[offset+4] !== q.y || state[offset+5] !== q.z || state[offset+6] !== q.w
          || state[offset+7] !== s.x || state[offset+8] !== s.y || state[offset+9] !== s.z;
        if (localChanged) {
          node.updateMatrix();
          state[offset] = p.x; state[offset+1] = p.y; state[offset+2] = p.z;
          state[offset+3] = q.x; state[offset+4] = q.y; state[offset+5] = q.z; state[offset+6] = q.w;
          state[offset+7] = s.x; state[offset+8] = s.y; state[offset+9] = s.z;
        }
      } else {
        for (let component = 0; component < 16; component++) {
          const value = node.matrix.elements[component]!;
          localChanged ||= state[offset + component] !== value;
          state[offset + component] = value;
        }
      }
      const worldChanged = localChanged || node.matrixWorldNeedsUpdate || this.changed[this.parents[i]!] === 1;
      this.changed[i] = worldChanged ? 1 : 0;
      if (worldChanged) {
        if (node.matrixWorldAutoUpdate) node.matrixWorld.multiplyMatrices(node.parent!.matrixWorld, node.matrix);
        node.matrixWorldNeedsUpdate = false;
      }
    }
    this.initialized = true;
  }
}
