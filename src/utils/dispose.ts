import * as THREE from 'three';

export function disposeObject3D(object: THREE.Object3D, disposeMaterials = false): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry && !geometries.has(mesh.geometry)) {
      geometries.add(mesh.geometry);
      mesh.geometry.dispose();
    }
    if (!disposeMaterials) return;
    const material = mesh.material;
    const disposeMaterial = (candidate: THREE.Material): void => {
      if (materials.has(candidate)) return;
      materials.add(candidate);
      candidate.dispose();
    };
    if (Array.isArray(material)) material.forEach(disposeMaterial);
    else if (material) disposeMaterial(material);
  });
}

export function cloneXZ(point: THREE.Vector3): THREE.Vector3 {
  return new THREE.Vector3(point.x, point.y, point.z);
}
