import * as THREE from 'three';
import { addMesh, timberMaterial } from '../buildings/buildingMaterials.ts';
import type { DeliveryCargoKind } from './deliveryTrips.ts';
import { cargoColor } from './deliveryTrips.ts';

const WHEEL_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0x3a2d22,
  roughness: 0.9,
  metalness: 0,
});

const CARGO_MATERIALS = new Map<DeliveryCargoKind, THREE.MeshStandardMaterial>();

function cargoMaterial(kind: DeliveryCargoKind): THREE.MeshStandardMaterial {
  let material = CARGO_MATERIALS.get(kind);
  if (!material) {
    const color = cargoColor(kind);
    material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.72,
      metalness: 0.04,
      emissive: color,
      emissiveIntensity: 0.06,
    });
    CARGO_MATERIALS.set(kind, material);
  }
  return material;
}

function addCargo(group: THREE.Group, kind: DeliveryCargoKind): void {
  const material = cargoMaterial(kind);

  switch (kind) {
    case 'firewood':
      addMesh(group, new THREE.BoxGeometry(0.9, 0.42, 0.55), material, new THREE.Vector3(0, 0.72, 0.05));
      addMesh(
        group,
        new THREE.CylinderGeometry(0.1, 0.1, 0.85, 6),
        timberMaterial('weathered'),
        new THREE.Vector3(-0.18, 0.78, 0.05),
        new THREE.Euler(0, 0, Math.PI * 0.5),
      );
      break;
    case 'water':
      addMesh(group, new THREE.CylinderGeometry(0.28, 0.3, 0.55, 10), material, new THREE.Vector3(0, 0.78, 0));
      addMesh(
        group,
        new THREE.TorusGeometry(0.3, 0.04, 6, 12),
        timberMaterial('dark'),
        new THREE.Vector3(0, 1.02, 0),
        new THREE.Euler(Math.PI * 0.5, 0, 0),
      );
      break;
    case 'food':
      addMesh(group, new THREE.BoxGeometry(0.62, 0.34, 0.48), material, new THREE.Vector3(-0.12, 0.7, 0));
      addMesh(group, new THREE.BoxGeometry(0.48, 0.28, 0.4), material, new THREE.Vector3(0.28, 0.76, 0.08));
      break;
    case 'grain':
      addMesh(group, new THREE.BoxGeometry(0.72, 0.38, 0.52), material, new THREE.Vector3(0, 0.72, 0));
      addMesh(group, new THREE.BoxGeometry(0.34, 0.22, 0.34), material, new THREE.Vector3(-0.22, 0.84, 0.12));
      break;
    case 'flour':
      addMesh(group, new THREE.BoxGeometry(0.58, 0.46, 0.42), material, new THREE.Vector3(0, 0.74, 0));
      addMesh(group, new THREE.BoxGeometry(0.36, 0.12, 0.36), material, new THREE.Vector3(0.18, 0.92, -0.08));
      break;
    case 'ale':
      addMesh(group, new THREE.CylinderGeometry(0.24, 0.26, 0.62, 10), material, new THREE.Vector3(0, 0.78, 0));
      addMesh(
        group,
        new THREE.TorusGeometry(0.24, 0.035, 6, 12),
        timberMaterial('dark'),
        new THREE.Vector3(0, 1.04, 0),
        new THREE.Euler(Math.PI * 0.5, 0, 0),
      );
      break;
    case 'preservedFood':
      addMesh(group, new THREE.BoxGeometry(0.56, 0.3, 0.44), material, new THREE.Vector3(-0.1, 0.72, 0));
      addMesh(group, new THREE.BoxGeometry(0.42, 0.24, 0.36), material, new THREE.Vector3(0.24, 0.78, 0.06));
      break;
    case 'honey':
      addMesh(group, new THREE.CylinderGeometry(0.22, 0.24, 0.48, 8), material, new THREE.Vector3(0, 0.76, 0));
      break;
    case 'wine':
      addMesh(group, new THREE.CylinderGeometry(0.18, 0.22, 0.58, 8), material, new THREE.Vector3(0, 0.78, 0));
      addMesh(group, new THREE.SphereGeometry(0.12, 8, 6), material, new THREE.Vector3(0, 1.08, 0));
      break;
    case 'timber':
      addMesh(
        group,
        new THREE.CylinderGeometry(0.11, 0.11, 0.82, 8),
        timberMaterial('weathered'),
        new THREE.Vector3(-0.2, 0.78, 0.04),
        new THREE.Euler(0, 0, Math.PI * 0.5),
      );
      addMesh(
        group,
        new THREE.CylinderGeometry(0.1, 0.1, 0.78, 8),
        timberMaterial('mid'),
        new THREE.Vector3(0.08, 0.8, -0.02),
        new THREE.Euler(0.08, 0.2, Math.PI * 0.5),
      );
      addMesh(
        group,
        new THREE.CylinderGeometry(0.095, 0.095, 0.74, 8),
        timberMaterial('light'),
        new THREE.Vector3(0.24, 0.76, 0.06),
        new THREE.Euler(-0.06, -0.15, Math.PI * 0.5),
      );
      break;
    case 'stone':
      addMesh(group, new THREE.DodecahedronGeometry(0.28, 0), material, new THREE.Vector3(-0.24, 0.72, 0.08));
      addMesh(group, new THREE.DodecahedronGeometry(0.24, 0), material, new THREE.Vector3(0.18, 0.74, -0.08));
      addMesh(group, new THREE.DodecahedronGeometry(0.2, 0), material, new THREE.Vector3(0.26, 0.91, 0.12));
      break;
    default: {
      const unreachable: never = kind;
      throw new Error(`Unknown cargo kind: ${unreachable}`);
    }
  }
}

export function createDeliveryCartMesh(kind: DeliveryCargoKind): THREE.Group {
  const group = new THREE.Group();
  group.name = `DeliveryCart:${kind}`;

  const frame = timberMaterial('mid');
  addMesh(group, new THREE.BoxGeometry(1.15, 0.14, 0.72), frame, new THREE.Vector3(0, 0.42, 0));
  addMesh(group, new THREE.BoxGeometry(0.12, 0.55, 0.72), frame, new THREE.Vector3(-0.48, 0.68, 0));
  addMesh(group, new THREE.BoxGeometry(0.12, 0.42, 0.72), frame, new THREE.Vector3(0.48, 0.62, 0));

  const wheelGeometry = new THREE.CylinderGeometry(0.22, 0.22, 0.12, 12);
  addMesh(
    group,
    wheelGeometry,
    WHEEL_MATERIAL,
    new THREE.Vector3(-0.42, 0.22, 0.34),
    new THREE.Euler(Math.PI * 0.5, 0, 0),
  );
  addMesh(
    group,
    wheelGeometry,
    WHEEL_MATERIAL,
    new THREE.Vector3(-0.42, 0.22, -0.34),
    new THREE.Euler(Math.PI * 0.5, 0, 0),
  );
  addMesh(
    group,
    wheelGeometry,
    WHEEL_MATERIAL,
    new THREE.Vector3(0.42, 0.22, 0.34),
    new THREE.Euler(Math.PI * 0.5, 0, 0),
  );
  addMesh(
    group,
    wheelGeometry,
    WHEEL_MATERIAL,
    new THREE.Vector3(0.42, 0.22, -0.34),
    new THREE.Euler(Math.PI * 0.5, 0, 0),
  );

  addCargo(group, kind);
  return group;
}
