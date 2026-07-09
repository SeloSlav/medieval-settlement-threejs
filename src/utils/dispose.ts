import * as THREE from 'three';

export function disposeObject3D(object: THREE.Object3D, disposeMaterials = false): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    if (!disposeMaterials) return;
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else if (material) material.dispose();
  });
}

export function cloneXZ(point: THREE.Vector3): THREE.Vector3 {
  return new THREE.Vector3(point.x, point.y, point.z);
}
