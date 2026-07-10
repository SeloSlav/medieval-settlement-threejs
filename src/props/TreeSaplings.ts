import * as THREE from 'three';

export function createTreeSaplingMesh(capacity: number): THREE.InstancedMesh {
  const geometry = createSaplingGeometry();
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.88,
    metalness: 0,
    vertexColors: true,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, capacity));
  mesh.name = 'Tree saplings';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.count = capacity;
  return mesh;
}

export function updateTreeSaplingInstance(
  mesh: THREE.InstancedMesh,
  index: number,
  x: number,
  z: number,
  groundY: number,
  growthProgress: number,
  isConifer: boolean,
): void {
  if (index >= mesh.count) return;

  const scale = saplingVisualScale(growthProgress);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3(x, groundY, z);
  const scaleVector = new THREE.Vector3(scale, scale, scale);
  const yaw = saplingYaw(x, z);
  quaternion.setFromEuler(new THREE.Euler(0, yaw, 0));
  matrix.compose(position, quaternion, scaleVector);
  mesh.setMatrixAt(index, matrix);

  const trunk = new THREE.Color(isConifer ? 0x5a4638 : 0x6a5644);
  const foliage = new THREE.Color(isConifer ? 0x3f6848 : 0x4f7a42);
  mesh.setColorAt(index, trunk.lerp(foliage, 0.38));

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

export function saplingVisualScale(growthProgress: number): number {
  const t = THREE.MathUtils.clamp(growthProgress, 0, 1);
  const eased = t * t * (3 - 2 * t);
  return THREE.MathUtils.lerp(0.16, 0.92, eased);
}

function createSaplingGeometry(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.07, 0.1, 0.72, 6, 1, false);
  trunk.translate(0, 0.36, 0);

  const foliage = new THREE.ConeGeometry(0.34, 0.82, 7, 1, false);
  foliage.translate(0, 1.02, 0);

  return mergeGeometries([trunk, foliage]);
}

function mergeGeometries(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = new THREE.BufferGeometry();
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];

  for (const geometry of parts) {
    const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
    const norm = geometry.getAttribute('normal') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      normals.push(norm.getX(i), norm.getY(i), norm.getZ(i));
      colors.push(1, 1, 1);
    }
  }

  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  merged.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  merged.computeBoundingSphere();
  return merged;
}

function saplingYaw(x: number, z: number): number {
  return (Math.abs(Math.floor(Math.sin(x * 127.1 + z * 311.7) * 43758.5453)) % 628) * 0.01;
}
