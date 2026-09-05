import * as THREE from 'three';

/** Node materials capture the batch's transform and indirection textures. */
export function resizeBatchedMeshInstances(mesh: THREE.BatchedMesh, capacity: number): void {
  mesh.setInstanceCount(capacity);
  // Three replaces both textures on growth. Rebuild the node bindings before
  // rendering, otherwise sorted draw IDs read the retired texture as the camera
  // moves and individual wall/material batches disappear or jump between sites.
  for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
    material.needsUpdate = true;
  }
}
