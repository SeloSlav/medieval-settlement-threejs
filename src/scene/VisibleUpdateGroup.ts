import * as THREE from 'three';

/** Dormant visual subtrees are evaluated on demand or when made visible again. */
export class VisibleUpdateGroup extends THREE.Group {
  private skipped = false;
  override updateMatrixWorld(force?: boolean): void {
    if (!this.visible) {
      super.updateWorldMatrix(false, false);
      this.skipped = true;
      return;
    }
    super.updateMatrixWorld(force || this.skipped);
    this.skipped = false;
  }
}
