import * as THREE from 'three';
import type { RoadEdge } from '../roads/RoadEdge.ts';
import { distancePointToPolylineXZ } from '../utils/pathGeometry.ts';

export function createHarvestStumpMesh(capacity: number): THREE.InstancedMesh {
  return createStumpInstancedMesh('Harvest stumps', Math.max(1, capacity));
}

export function updateHarvestStumpInstance(
  mesh: THREE.InstancedMesh,
  index: number,
  x: number,
  z: number,
  y: number,
  treeScale: number,
): void {
  if (index >= mesh.count) return;

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3(x, y, z);
  const stumpScale = 0.95 + treeScale * 0.35;
  const scaleVector = new THREE.Vector3(stumpScale, stumpScale * 0.62, stumpScale);
  const yaw = stumpHash(x, z) * 0.01;
  quaternion.setFromEuler(new THREE.Euler(0, yaw, 0));
  matrix.compose(position, quaternion, scaleVector);
  mesh.setMatrixAt(index, matrix);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
}

function createStumpInstancedMesh(name: string, capacity: number): THREE.InstancedMesh {
  const geometry = createStumpGeometry();
  const material = new THREE.MeshStandardMaterial({
    color: 0x6a5644,
    roughness: 0.96,
    metalness: 0,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.count = capacity;
  return mesh;
}

function createStumpGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(0.42, 0.52, 0.38, 8, 1, false);
  geometry.translate(0, 0.19, 0);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function stumpHash(x: number, z: number): number {
  return Math.abs(Math.floor(Math.sin(x * 127.1 + z * 311.7) * 43758.5453));
}

export function isUndergrowthNearAnyEdge(
  x: number,
  z: number,
  edges: RoadEdge[],
  margin: number,
): boolean {
  for (const edge of edges) {
    const path = edge.sampledPath.length >= 2 ? edge.sampledPath : edge.controlPoints;
    if (path.length < 2) continue;
    const distance = distancePointToPolylineXZ(x, z, path);
    if (distance <= edge.width * 0.5 + margin) return true;
  }
  return false;
}
