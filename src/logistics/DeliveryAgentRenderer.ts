import * as THREE from 'three';
import { disposeObject3D } from '../utils/dispose.ts';
import type { DeliveryTripState } from '../logistics/deliveryTrips.ts';
import { cargoColor } from '../logistics/deliveryTrips.ts';
import type { Terrain } from '../terrain/Terrain.ts';

const TICK_BLEND_SEC = 0.2;

type TripVisual = {
  mesh: THREE.Mesh;
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  blend: number;
};

type DeliveryAgentRendererOptions = {
  terrain: Terrain;
  parent: THREE.Group;
};

export class DeliveryAgentRenderer {
  private readonly terrain: Terrain;
  private readonly group = new THREE.Group();
  private readonly visuals = new Map<string, TripVisual>();
  private readonly geometry = new THREE.SphereGeometry(0.55, 14, 10);
  private readonly materials = new Map<string, THREE.MeshStandardMaterial>();

  constructor(options: DeliveryAgentRendererOptions) {
    this.terrain = options.terrain;
    this.group.name = 'Delivery agents';
    options.parent.add(this.group);
  }

  syncTrips(trips: Iterable<DeliveryTripState>): void {
    const nextIds = new Set<string>();
    for (const trip of trips) {
      nextIds.add(trip.id);
      const existing = this.visuals.get(trip.id);
      if (existing) {
        existing.fromX = existing.toX;
        existing.fromZ = existing.toZ;
        existing.toX = trip.x;
        existing.toZ = trip.z;
        existing.blend = 0;
        this.updateMaterial(existing.mesh, trip);
        continue;
      }

      const mesh = new THREE.Mesh(this.geometry, this.materialFor(trip));
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      this.group.add(mesh);
      this.visuals.set(trip.id, {
        mesh,
        fromX: trip.x,
        fromZ: trip.z,
        toX: trip.x,
        toZ: trip.z,
        blend: 1,
      });
    }

    for (const id of this.visuals.keys()) {
      if (nextIds.has(id)) continue;
      this.removeTrip(id);
    }
  }

  update(dt: number): void {
    for (const visual of this.visuals.values()) {
      visual.blend = Math.min(1, visual.blend + dt / TICK_BLEND_SEC);
      const t = smoothstep(visual.blend);
      const x = THREE.MathUtils.lerp(visual.fromX, visual.toX, t);
      const z = THREE.MathUtils.lerp(visual.fromZ, visual.toZ, t);
      const y = this.terrain.getHeightAt(x, z) + 0.75;
      visual.mesh.position.set(x, y, z);
    }
  }

  dispose(): void {
    for (const id of [...this.visuals.keys()]) {
      this.removeTrip(id);
    }
    this.geometry.dispose();
    for (const material of this.materials.values()) {
      material.dispose();
    }
    this.materials.clear();
    this.group.removeFromParent();
  }

  private removeTrip(id: string): void {
    const visual = this.visuals.get(id);
    if (!visual) return;
    disposeObject3D(visual.mesh);
    visual.mesh.removeFromParent();
    this.visuals.delete(id);
  }

  private materialFor(trip: DeliveryTripState): THREE.MeshStandardMaterial {
    const key = trip.cargoKind;
    let material = this.materials.get(key);
    if (!material) {
      material = new THREE.MeshStandardMaterial({
        color: cargoColor(trip.cargoKind),
        roughness: 0.55,
        metalness: 0.05,
        emissive: cargoColor(trip.cargoKind),
        emissiveIntensity: 0.12,
      });
      this.materials.set(key, material);
    }
    return material;
  }

  private updateMaterial(mesh: THREE.Mesh, trip: DeliveryTripState): void {
    const material = this.materialFor(trip);
    if (mesh.material !== material) {
      mesh.material = material;
    }
  }
}

function smoothstep(t: number): number {
  const x = THREE.MathUtils.clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}
