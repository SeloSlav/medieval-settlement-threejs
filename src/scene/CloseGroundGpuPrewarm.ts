import type * as THREE from 'three';

export type CloseGroundGpuPrewarm = {
  objects: readonly THREE.Object3D[];
  restore: () => void;
};

/**
 * Expose the exact live ground-cover meshes for startup compilation and one
 * covered post-processing submission. Hidden/empty meshes are otherwise absent
 * from Three's render list until the player first crosses 200% zoom.
 *
 * One instance is enough to create pipelines and upload each full backing
 * buffer. Do not clone meshes, change materials, generate a meadow, or rewrite
 * instance data: all of those can miss the live cache key or alter the field.
 * The owner must suspend ground-cover camera updates until restore().
 */
export function beginCloseGroundGpuPrewarm(
  roots: readonly THREE.Object3D[],
): CloseGroundGpuPrewarm {
  const objects = [...new Set(roots)];
  const snapshots = new Map<THREE.Object3D, {
    visible: boolean;
    frustumCulled: boolean;
    count?: number;
  }>();
  for (const root of objects) {
    root.traverse(object => {
      if (snapshots.has(object)) return;
      const mesh = object as THREE.InstancedMesh;
      snapshots.set(object, {
        visible: object.visible,
        frustumCulled: object.frustumCulled,
        count: mesh.isInstancedMesh ? mesh.count : undefined,
      });
      object.visible = true;
      object.frustumCulled = false;
      if (mesh.isInstancedMesh) mesh.count = Math.min(1, mesh.instanceMatrix.count);
    });
  }
  return {
    objects,
    restore() {
      for (const [object, saved] of snapshots) {
        object.visible = saved.visible;
        object.frustumCulled = saved.frustumCulled;
        if (saved.count !== undefined) (object as THREE.InstancedMesh).count = saved.count;
      }
      snapshots.clear();
    },
  };
}
