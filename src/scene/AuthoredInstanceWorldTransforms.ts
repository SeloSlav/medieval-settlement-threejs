import * as THREE from 'three';

type Chain = { boundary: THREE.Object3D; nodes: THREE.Object3D[] };

/** Actor/model transforms move each frame; their shared evaluation root moves once. */
export class AuthoredInstanceWorldTransforms {
  private readonly chains = new WeakMap<THREE.Object3D, Chain>();
  private readonly prepared = new Set<THREE.Object3D>();

  reset(): void { this.prepared.clear(); }

  update(model: THREE.Object3D): void {
    let chain = this.chains.get(model);
    if (chain && chain.nodes.some((node, index) => node.parent !== (chain!.nodes[index + 1] ?? chain!.boundary))) {
      this.chains.delete(model); chain = undefined;
    }
    if (!chain) {
      const nodes: THREE.Object3D[] = [];
      let ancestor: THREE.Object3D | null = model;
      while (ancestor && ancestor.userData.authoredRigEvaluatorGroup !== true) {
        nodes.push(ancestor); ancestor = ancestor.parent;
      }
      if (!ancestor) { model.updateWorldMatrix(true, false); return; }
      chain = { boundary: ancestor, nodes }; this.chains.set(model, chain);
    }
    if (!this.prepared.has(chain.boundary)) {
      chain.boundary.updateWorldMatrix(true, false); this.prepared.add(chain.boundary);
    }
    for (let i = chain.nodes.length - 1; i >= 0; i--) chain.nodes[i]!.updateWorldMatrix(false, false);
  }
}
