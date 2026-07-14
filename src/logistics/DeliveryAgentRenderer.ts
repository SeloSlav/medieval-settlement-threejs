import * as THREE from 'three';
import { disposeObject3D } from '../utils/dispose.ts';
import type { DeliveryTripState, DeliveryTripPhase } from '../logistics/deliveryTrips.ts';
import { decodeRoutePolyline } from '../logistics/routePolyline.ts';
import { createDeliveryCartMesh } from '../logistics/deliveryCartMesh.ts';
import type { Terrain } from '../terrain/Terrain.ts';
import { samplePolylineXZ, type PointXZ } from '../utils/pathGeometry.ts';
import { isWithinShadowRange, type CrowdViewState } from '../settlement/crowdView.ts';

const DISPLAY_BLEND_RATE = 14;

type TripVisual = {
  mesh: THREE.Group;
  polyline: PointXZ[];
  pathDistance: number;
  serverProgress: number;
  displayProgress: number;
  phase: DeliveryTripPhase;
  travelSpeed: number;
  serverX: number;
  serverZ: number;
  yaw: number;
};

type DeliveryAgentRendererOptions = {
  terrain: Terrain;
  parent: THREE.Group;
};

export class DeliveryAgentRenderer {
  private readonly terrain: Terrain;
  private readonly group = new THREE.Group();
  private readonly visuals = new Map<string, TripVisual>();

  constructor(options: DeliveryAgentRendererOptions) {
    this.terrain = options.terrain;
    this.group.name = 'Delivery agents';
    options.parent.add(this.group);
  }

  syncTrips(trips: Iterable<DeliveryTripState>): void {
    const nextIds = new Set<string>();
    for (const trip of trips) {
      nextIds.add(trip.id);
      const polyline = decodeRoutePolyline(trip.routePolylineJson) ?? [];
      const pathDistance = trip.pathDistance > 1e-6
        ? trip.pathDistance
        : polyline.length >= 2
          ? this.measurePolyline(polyline)
          : 0;

      const existing = this.visuals.get(trip.id);
      if (existing) {
        existing.polyline = polyline;
        existing.pathDistance = pathDistance;
        existing.serverProgress = trip.progress;
        existing.phase = trip.phase;
        existing.travelSpeed = this.tripTravelSpeed(trip);
        existing.serverX = trip.x;
        existing.serverZ = trip.z;
        this.ensureCartMesh(existing, trip);
        continue;
      }

      const mesh = createDeliveryCartMesh(trip.cargoKind);
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      this.group.add(mesh);
      this.visuals.set(trip.id, {
        mesh,
        polyline,
        pathDistance,
        serverProgress: trip.progress,
        displayProgress: trip.progress,
        phase: trip.phase,
        travelSpeed: this.tripTravelSpeed(trip),
        serverX: trip.x,
        serverZ: trip.z,
        yaw: 0,
      });
    }

    for (const id of this.visuals.keys()) {
      if (nextIds.has(id)) continue;
      this.removeTrip(id);
    }
  }

  update(dt: number, view?: CrowdViewState): void {
    for (const visual of this.visuals.values()) {
      if (visual.phase !== 'unloading') {
        visual.displayProgress += visual.travelSpeed * dt;
        const maxLead = Math.max(0.6, visual.travelSpeed * 0.35);
        if (visual.displayProgress > visual.serverProgress + maxLead) {
          visual.displayProgress = visual.serverProgress + maxLead;
        }
      }

      const blend = 1 - Math.exp(-dt * DISPLAY_BLEND_RATE);
      visual.displayProgress += (visual.serverProgress - visual.displayProgress) * blend;

      let x = visual.serverX;
      let z = visual.serverZ;
      let yaw = visual.yaw;

      if (visual.polyline.length >= 2 && visual.pathDistance > 1e-6) {
        const distance = this.phaseSampleDistance(visual);
        const sample = samplePolylineXZ(visual.polyline, distance);
        if (sample) {
          x = sample.x;
          z = sample.z;
          yaw = sample.yaw;
          visual.yaw = yaw;
        }
      }

      const y = this.terrain.getHeightAt(x, z) + 0.05;
      visual.mesh.position.set(x, y, z);
      visual.mesh.rotation.y = yaw;
      visual.mesh.castShadow = isWithinShadowRange(x, z, view);
    }
  }

  applyTripStates(trips: Iterable<DeliveryTripState>): void {
    for (const trip of trips) {
      const visual = this.visuals.get(trip.id);
      if (!visual) continue;
      visual.serverProgress = trip.progress;
      visual.phase = trip.phase;
      visual.travelSpeed = this.tripTravelSpeed(trip);
      visual.serverX = trip.x;
      visual.serverZ = trip.z;
      const polyline = decodeRoutePolyline(trip.routePolylineJson);
      if (polyline && polyline.length >= 2) {
        visual.polyline = polyline;
        visual.pathDistance = trip.pathDistance > 1e-6 ? trip.pathDistance : this.measurePolyline(polyline);
      }
    }
  }

  private tripTravelSpeed(trip: DeliveryTripState): number {
    const workers = Math.max(1, trip.deliveryWorkers);
    return trip.speedMps * workers * Math.max(1, trip.travelSpeedMultiplier);
  }

  dispose(): void {
    for (const id of [...this.visuals.keys()]) {
      this.removeTrip(id);
    }
    this.group.removeFromParent();
  }

  private phaseSampleDistance(visual: TripVisual): number {
    const progress = Math.max(0, Math.min(visual.displayProgress, visual.pathDistance));
    if (visual.phase === 'inbound') {
      return visual.pathDistance - progress;
    }
    if (visual.phase === 'unloading') {
      return visual.pathDistance;
    }
    return progress;
  }

  private measurePolyline(polyline: readonly PointXZ[]): number {
    let total = 0;
    for (let i = 0; i < polyline.length - 1; i++) {
      total += Math.hypot(polyline[i + 1].x - polyline[i].x, polyline[i + 1].z - polyline[i].z);
    }
    return total;
  }

  private ensureCartMesh(visual: TripVisual, trip: DeliveryTripState): void {
    if (visual.mesh.name === `DeliveryCart:${trip.cargoKind}`) return;
    const replacement = createDeliveryCartMesh(trip.cargoKind);
    replacement.position.copy(visual.mesh.position);
    replacement.rotation.copy(visual.mesh.rotation);
    replacement.castShadow = visual.mesh.castShadow;
    this.group.remove(visual.mesh);
    disposeObject3D(visual.mesh);
    this.group.add(replacement);
    visual.mesh = replacement;
  }

  private removeTrip(id: string): void {
    const visual = this.visuals.get(id);
    if (!visual) return;
    disposeObject3D(visual.mesh);
    visual.mesh.removeFromParent();
    this.visuals.delete(id);
  }
}
