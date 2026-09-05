import * as THREE from 'three';
import type { TimberLogState } from '../resources/types.ts';
import type { ForestTreePlacement } from '../props/forestPlacements.ts';
import { timberLogDimensions, treeFallDirection } from './forestry.ts';

const materials = new Map<string, THREE.Material | THREE.Material[]>();
const layouts = new Map<number, ForestTreePlacement>();
export function registerTimberLogLayout(index: number, placement: ForestTreePlacement): void { layouts.set(index, placement); }
export function timberLogLayout(index: number): ForestTreePlacement | undefined { return layouts.get(index); }
const logGeometry = new THREE.CylinderGeometry(0.86, 1, 1, 12, 1, false);
export function registerTimberLogMaterials(species: string, material: THREE.Material | THREE.Material[]): void {
  materials.set(species, material);
}
export function createTimberLogMesh(species: string, radius: number, length: number): THREE.Mesh {
  const mesh = new THREE.Mesh(logGeometry, materials.get(species));
  mesh.name = `Timber log · ${species}`;
  mesh.scale.set(radius, length, radius);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.sharedGeometry = true;
  mesh.userData.sharedMaterial = true;
  return mesh;
}

/** Material slots are the living tree's bark maps and the authored cut rings. */
export class TimberLogVisuals {
  readonly group = new THREE.Group();
  private readonly trees = new Map<number, THREE.Group>();
  private readonly height: (x: number, z: number) => number;
  constructor(height: (x: number, z: number) => number) {
    this.height = height;
    this.group.name = 'Physical forestry logs';
  }
  sync(layoutIndex: number, placement: ForestTreePlacement, logs: readonly TimberLogState[]): void {
    this.remove(layoutIndex);
    if (!logs.length) return;
    const root = new THREE.Group();
    root.name = `Forest log stock ${layoutIndex}`;
    const { radius, length } = timberLogDimensions(placement);
    const yaw = treeFallDirection(layoutIndex);
    logs.forEach((log, index) => {
      if (log.health > 0) {
        // Removing whole wood units shortens the actual trunk section.
        const remainingLength = length * log.health / log.maxHealth;
        const mesh = createTimberLogMesh(placement.species, radius, remainingLength);
        const dx = Math.sin(yaw) * remainingLength / 2;
        const dz = Math.cos(yaw) * remainingLength / 2;
        const a = new THREE.Vector3(log.x-dx, this.height(log.x-dx, log.z-dz)+radius, log.z-dz);
        const b = new THREE.Vector3(log.x+dx, this.height(log.x+dx, log.z+dz)+radius, log.z+dz);
        mesh.position.copy(a).add(b).multiplyScalar(0.5);
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), b.sub(a).normalize());
        mesh.userData.forestryLog = { layoutIndex, index, health: log.health, maxHealth: log.maxHealth };
        root.add(mesh);
      }
      for (let i=0; i<Math.min(12, log.firewood); i++) {
        const mesh = createTimberLogMesh(placement.species, radius * 0.35, 0.55);
        const x = log.x + Math.cos(yaw) * (0.7 + (i%3)*0.16);
        const z = log.z - Math.sin(yaw) * (0.7 + (i%3)*0.16);
        mesh.position.set(x, this.height(x,z) + 0.1 + Math.floor(i/3)*0.12, z);
        mesh.rotation.set(Math.PI/2, 0, -yaw);
        root.add(mesh);
      }
    });
    this.group.add(root);
    this.trees.set(layoutIndex, root);
  }
  remove(layoutIndex: number): void {
    this.trees.get(layoutIndex)?.removeFromParent();
    this.trees.delete(layoutIndex);
  }
  dispose(): void { this.group.clear(); this.trees.clear(); }
}
