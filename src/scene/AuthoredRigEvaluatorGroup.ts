import * as THREE from 'three';

/**
 * CPU rigs are evaluated explicitly before their palette/attachment upload.
 * They must not be walked again by each color, depth and shadow render pass.
 * Keep normal ancestry for world transforms and inspection, while hiding only
 * this evaluation boundary from the renderer's scene projection.
 */
export class AuthoredRigEvaluatorGroup extends THREE.Group {
  constructor() {
    super();
    this.name = 'Authored rig evaluators (explicit updates)';
    this.visible = false;
    this.userData.authoredRigEvaluatorGroup = true;
  }

  override updateMatrixWorld(_force?: boolean): void {
    // The renderer already updated our parent. setFromCloneAt uses the separate
    // updateWorldMatrix API to propagate the complete posed rig on demand.
    super.updateWorldMatrix(false, false);
  }
}
