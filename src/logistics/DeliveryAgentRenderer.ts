import * as THREE from 'three';
import {
  deliveryLegRemainingMeters,
  deliveryWorkerPersonIdentity,
  type DeliveryTripState,
  type DeliveryTripPhase,
} from '../logistics/deliveryTrips.ts';
import { decodeRoutePolyline } from '../logistics/routePolyline.ts';
import {
  createDeliveryCartMesh,
  createFireBucketCarrierMesh,
  deliveryCartMeshName,
  disposeDeliveryCartMesh,
  disposeDeliveryCartModelSource,
  loadDeliveryCartModelSource,
  fireBucketCarrierMeshName,
  type DeliveryCartModelSource,
} from '../logistics/deliveryCartMesh.ts';
import {
  createDeliveryCartWorkerVisual,
  disposeDeliveryCartWorkerSources,
  disposeDeliveryCartWorkerVisual,
  loadDeliveryCartWorkerSources,
  updateDeliveryCartWorkerVisual,
  type DeliveryCartWorkerSources,
  type DeliveryCartWorkerVisual,
} from './deliveryCartWorker.ts';
import type { Terrain } from '../terrain/Terrain.ts';
import { samplePolylineXZ, type PointXZ } from '../utils/pathGeometry.ts';
import { resolveRoadAwareGroundY } from '../roads/RoadSurfaceSampling.ts';
import { isWithinShadowRange, type CrowdViewState } from '../settlement/crowdView.ts';
import { hashStringSeed } from '../utils/random.ts';
import {
  pickVillagerModelVariant,
} from '../settlement/villagerPaths.ts';
import type { VillagerModelVariant } from '../settlement/SettlementCrowdRenderer.ts';
import type { GameSpeed } from '../world/gameSpeed.ts';

const DISPLAY_BLEND_RATE = 14;
const DELIVERY_ROUTE_COLOR = 0xff5ea8;
const DELIVERY_ROUTE_Y_OFFSET = 0.24;

type TripVisual = {
  mesh: THREE.Group;
  worker: DeliveryCartWorkerVisual | null;
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
  getGameSpeed: () => GameSpeed;
  getRoadDeckY?: (x: number, z: number) => number | null;
};

export type DeliveryAgentInspection = {
  tripId: string;
  personIdentity: string;
  modelVariant: VillagerModelVariant;
  trip: DeliveryTripState;
  remainingMeters: number | null;
  position: { x: number; y: number; z: number };
  visible: boolean;
};

export class DeliveryAgentRenderer {
  private readonly getGameSpeed: () => GameSpeed;
  private readonly terrain: Terrain;
  private readonly getRoadDeckY: ((x: number, z: number) => number | null) | null;
  private readonly group = new THREE.Group();
  private readonly visuals = new Map<string, TripVisual>();
  private readonly selectedRoute: THREE.Line<
    THREE.BufferGeometry,
    THREE.LineDashedMaterial
  >;
  private latestTrips = new Map<string, DeliveryTripState>();
  private selectedTripId: string | null = null;
  private cartSource: DeliveryCartModelSource | null = null;
  private workerSources: DeliveryCartWorkerSources | null = null;
  private disposed = false;

  constructor(options: DeliveryAgentRendererOptions) {
    this.getGameSpeed = options.getGameSpeed;
    this.terrain = options.terrain;
    this.getRoadDeckY = options.getRoadDeckY ?? null;
    this.group.name = 'Delivery agents';
    this.selectedRoute = createSelectedDeliveryRoute();
    this.group.add(this.selectedRoute);
    options.parent.add(this.group);
    void this.loadCartSource();
    void this.loadWorkerSources();
  }

  syncTrips(trips: Iterable<DeliveryTripState>): void {
    const tripList = [...trips];
    this.latestTrips = new Map(tripList.map((trip) => [trip.id, trip]));
    const nextIds = new Set<string>();
    for (const trip of tripList) {
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
        this.applyAuthoritativeTripState(existing, trip);
        this.ensureCartMesh(existing, trip);
        continue;
      }

      const mesh = this.createCartMesh(trip);
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      this.group.add(mesh);
      const visual: TripVisual = {
        mesh,
        worker: null,
        polyline,
        pathDistance,
        serverProgress: trip.progress,
        displayProgress: trip.progress,
        phase: trip.phase,
        travelSpeed: this.tripTravelSpeed(trip),
        serverX: trip.x,
        serverZ: trip.z,
        yaw: 0,
      };
      this.visuals.set(trip.id, visual);
      this.ensureWorker(visual, trip);
    }

    for (const id of this.visuals.keys()) {
      if (nextIds.has(id)) continue;
      this.removeTrip(id);
    }
    if (this.selectedTripId && !nextIds.has(this.selectedTripId)) {
      this.selectDeliveryAgent(null);
    }
  }

  update(dt: number, view?: CrowdViewState): void {
    const gameSpeed = this.getGameSpeed();
    for (const [tripId, visual] of this.visuals) {
      const effectiveTravelSpeed = visual.travelSpeed * gameSpeed;
      if (visual.phase !== 'unloading') {
        visual.displayProgress += effectiveTravelSpeed * dt;
        const maxLead = Math.max(0.6, effectiveTravelSpeed * 0.35);
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

      const y = this.resolveGroundY(x, z) + 0.05;
      visual.mesh.position.set(x, y, z);
      visual.mesh.rotation.y = visual.phase === 'inbound'
        ? yaw + Math.PI
        : yaw;
      if (visual.worker) {
        updateDeliveryCartWorkerVisual(
          visual.worker,
          dt,
          visual.phase !== 'unloading',
          effectiveTravelSpeed,
        );
      }
      const castShadow = isWithinShadowRange(x, z, view);
      visual.mesh.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.isMesh) mesh.castShadow = castShadow;
      });
      if (this.selectedTripId === tripId) this.updateSelectedRoute(visual);
    }
  }

  applyTripStates(trips: Iterable<DeliveryTripState>): void {
    for (const trip of trips) {
      const visual = this.visuals.get(trip.id);
      if (!visual) continue;
      this.applyAuthoritativeTripState(visual, trip);
      const polyline = decodeRoutePolyline(trip.routePolylineJson);
      if (polyline && polyline.length >= 2) {
        visual.polyline = polyline;
        visual.pathDistance = trip.pathDistance > 1e-6 ? trip.pathDistance : this.measurePolyline(polyline);
      }
    }
  }

  pickDeliveryAgent(
    clientX: number,
    clientY: number,
    camera: THREE.Camera,
    domElement: HTMLElement,
  ): DeliveryAgentInspection | null {
    const bounds = domElement.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return null;

    let nearest: { distance: number; inspection: DeliveryAgentInspection } | null = null;
    for (const [tripId, visual] of this.visuals) {
      const trip = this.latestTrips.get(tripId);
      if (!trip || !visual.mesh.visible) continue;
      const feet = projectWorldPoint(
        visual.mesh.position.x,
        visual.mesh.position.y + 0.08,
        visual.mesh.position.z,
        camera,
        bounds,
      );
      const head = projectWorldPoint(
        visual.mesh.position.x,
        visual.mesh.position.y + 1.9,
        visual.mesh.position.z,
        camera,
        bounds,
      );
      if (!feet || !head) continue;

      const projectedHeight = Math.hypot(feet.x - head.x, feet.y - head.y);
      const hitRadius = Math.min(36, Math.max(14, projectedHeight * 0.48));
      const distance = distanceToScreenSegment(
        clientX,
        clientY,
        feet.x,
        feet.y,
        head.x,
        head.y,
      );
      if (distance > hitRadius || (nearest && distance >= nearest.distance)) continue;
      nearest = { distance, inspection: this.describeTrip(trip, visual) };
    }
    return nearest?.inspection ?? null;
  }

  inspectDeliveryAgent(tripId: string): DeliveryAgentInspection | null {
    const trip = this.latestTrips.get(tripId);
    const visual = this.visuals.get(tripId);
    return trip && visual ? this.describeTrip(trip, visual) : null;
  }

  selectDeliveryAgent(tripId: string | null): void {
    this.selectedTripId = tripId && this.visuals.has(tripId) ? tripId : null;
    this.selectedRoute.visible = false;
    if (!this.selectedTripId) return;
    const visual = this.visuals.get(this.selectedTripId);
    if (visual) this.updateSelectedRoute(visual);
  }

  private tripTravelSpeed(trip: DeliveryTripState): number {
    const workers = Math.max(1, trip.deliveryWorkers);
    return trip.speedMps * workers * Math.max(1, trip.travelSpeedMultiplier);
  }

  dispose(): void {
    this.disposed = true;
    for (const id of [...this.visuals.keys()]) {
      this.removeTrip(id);
    }
    if (this.cartSource) disposeDeliveryCartModelSource(this.cartSource);
    if (this.workerSources) disposeDeliveryCartWorkerSources(this.workerSources);
    this.cartSource = null;
    this.workerSources = null;
    this.latestTrips.clear();
    this.selectedRoute.geometry.dispose();
    this.selectedRoute.material.dispose();
    this.group.removeFromParent();
  }

  private applyAuthoritativeTripState(
    visual: TripVisual,
    trip: DeliveryTripState,
  ): void {
    const phaseChanged = visual.phase !== trip.phase;
    const progressRestarted = trip.progress + 1e-6 < visual.serverProgress;
    visual.serverProgress = trip.progress;
    visual.phase = trip.phase;
    visual.travelSpeed = this.tripTravelSpeed(trip);
    visual.serverX = trip.x;
    visual.serverZ = trip.z;
    if (phaseChanged || progressRestarted) {
      visual.displayProgress = trip.progress;
    }
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
    const desiredName = trip.destinationKind === 'fire'
      ? fireBucketCarrierMeshName()
      : deliveryCartMeshName(trip.cargoKind, this.cartSource != null);
    if (visual.mesh.name === desiredName) return;
    const replacement = this.createCartMesh(trip);
    replacement.position.copy(visual.mesh.position);
    replacement.rotation.copy(visual.mesh.rotation);
    replacement.castShadow = visual.mesh.castShadow;
    visual.worker?.root.removeFromParent();
    this.group.remove(visual.mesh);
    disposeDeliveryCartMesh(visual.mesh);
    if (visual.worker) replacement.add(visual.worker.root);
    this.group.add(replacement);
    visual.mesh = replacement;
    this.ensureWorker(visual, trip);
  }

  private removeTrip(id: string): void {
    const visual = this.visuals.get(id);
    if (!visual) return;
    if (visual.worker) {
      disposeDeliveryCartWorkerVisual(visual.worker);
      visual.worker = null;
    }
    disposeDeliveryCartMesh(visual.mesh);
    visual.mesh.removeFromParent();
    this.visuals.delete(id);
  }

  private createCartMesh(trip: DeliveryTripState): THREE.Group {
    if (trip.destinationKind === 'fire') {
      return createFireBucketCarrierMesh();
    }
    return createDeliveryCartMesh(trip.cargoKind, {
      appearanceSeed: hashStringSeed(`delivery-cart:${trip.id}`),
      source: this.cartSource,
    });
  }

  private ensureWorker(visual: TripVisual, trip: DeliveryTripState): void {
    if (visual.worker || !this.cartSource || !this.workerSources) return;
    visual.worker = createDeliveryCartWorkerVisual(
      hashStringSeed(deliveryWorkerPersonIdentity(trip)),
      this.workerSources,
    );
    visual.mesh.add(visual.worker.root);
  }

  private describeTrip(
    trip: DeliveryTripState,
    visual: TripVisual,
  ): DeliveryAgentInspection {
    const personIdentity = deliveryWorkerPersonIdentity(trip);
    return {
      tripId: trip.id,
      personIdentity,
      modelVariant: pickVillagerModelVariant(hashStringSeed(personIdentity)),
      trip,
      remainingMeters: deliveryLegRemainingMeters(
        visual.pathDistance,
        visual.displayProgress,
        visual.phase,
      ),
      position: {
        x: visual.mesh.position.x,
        y: visual.mesh.position.y,
        z: visual.mesh.position.z,
      },
      visible: visual.mesh.visible,
    };
  }

  private updateSelectedRoute(visual: TripVisual): void {
    if (visual.polyline.length < 2 || visual.pathDistance <= 1e-6) {
      this.selectedRoute.visible = false;
      return;
    }
    const sampleDistance = this.phaseSampleDistance(visual);
    const route = visual.phase === 'inbound'
      ? polylineToDistance(visual.polyline, sampleDistance)
      : polylineFromDistance(visual.polyline, sampleDistance);
    if (route.length < 2) {
      this.selectedRoute.visible = false;
      return;
    }
    const points = route.map((point) => new THREE.Vector3(
      point.x,
      this.resolveGroundY(point.x, point.z) + DELIVERY_ROUTE_Y_OFFSET,
      point.z,
    ));
    this.selectedRoute.geometry.setFromPoints(points);
    this.selectedRoute.computeLineDistances();
    this.selectedRoute.visible = true;
  }

  private resolveGroundY(x: number, z: number): number {
    return resolveRoadAwareGroundY(
      this.terrain.getHeightAt(x, z),
      this.getRoadDeckY?.(x, z) ?? null,
    );
  }

  private async loadCartSource(): Promise<void> {
    try {
      const source = await loadDeliveryCartModelSource();
      if (this.disposed) {
        disposeDeliveryCartModelSource(source);
        return;
      }
      this.cartSource = source;
      for (const [id, trip] of this.latestTrips) {
        const visual = this.visuals.get(id);
        if (visual) this.ensureCartMesh(visual, trip);
      }
    } catch (error) {
      console.warn('[Delivery carts] CC0 Quaternius cart failed to load.', error);
    }
  }

  private async loadWorkerSources(): Promise<void> {
    try {
      const sources = await loadDeliveryCartWorkerSources();
      if (this.disposed) {
        disposeDeliveryCartWorkerSources(sources);
        return;
      }
      this.workerSources = sources;
      for (const [id, trip] of this.latestTrips) {
        const visual = this.visuals.get(id);
        if (visual) this.ensureWorker(visual, trip);
      }
    } catch (error) {
      console.warn('[Delivery carts] Rigged cart workers failed to load.', error);
    }
  }
}

function createSelectedDeliveryRoute(): THREE.Line<
  THREE.BufferGeometry,
  THREE.LineDashedMaterial
> {
  const material = new THREE.LineDashedMaterial({
    color: DELIVERY_ROUTE_COLOR,
    dashSize: 1.1,
    gapSize: 0.72,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    depthTest: false,
  });
  const line = new THREE.Line(new THREE.BufferGeometry(), material);
  line.name = 'Selected delivery destination route';
  line.renderOrder = 14;
  line.visible = false;
  line.frustumCulled = false;
  return line;
}

function polylineFromDistance(
  polyline: readonly PointXZ[],
  startDistance: number,
): PointXZ[] {
  const sample = samplePolylineXZ(polyline, startDistance);
  if (!sample) return [];
  const result: PointXZ[] = [{ x: sample.x, z: sample.z }];
  let traversed = 0;
  for (let index = 0; index < polyline.length - 1; index++) {
    const start = polyline[index]!;
    const end = polyline[index + 1]!;
    traversed += Math.hypot(end.x - start.x, end.z - start.z);
    if (traversed > startDistance + 1e-5) {
      result.push({ x: end.x, z: end.z });
    }
  }
  return result;
}

function polylineToDistance(
  polyline: readonly PointXZ[],
  endDistance: number,
): PointXZ[] {
  const sample = samplePolylineXZ(polyline, endDistance);
  if (!sample) return [];
  const prefix: PointXZ[] = [{ x: polyline[0]!.x, z: polyline[0]!.z }];
  let traversed = 0;
  for (let index = 0; index < polyline.length - 1; index++) {
    const start = polyline[index]!;
    const end = polyline[index + 1]!;
    traversed += Math.hypot(end.x - start.x, end.z - start.z);
    if (traversed >= endDistance - 1e-5) break;
    prefix.push({ x: end.x, z: end.z });
  }
  const last = prefix[prefix.length - 1]!;
  if (Math.hypot(last.x - sample.x, last.z - sample.z) > 1e-5) {
    prefix.push({ x: sample.x, z: sample.z });
  }
  return prefix.reverse();
}

function projectWorldPoint(
  x: number,
  y: number,
  z: number,
  camera: THREE.Camera,
  bounds: DOMRect,
): { x: number; y: number } | null {
  const projected = new THREE.Vector3(x, y, z).project(camera);
  if (
    !Number.isFinite(projected.x)
    || !Number.isFinite(projected.y)
    || !Number.isFinite(projected.z)
    || projected.z < -1
    || projected.z > 1
  ) return null;
  return {
    x: bounds.left + (projected.x * 0.5 + 0.5) * bounds.width,
    y: bounds.top + (-projected.y * 0.5 + 0.5) * bounds.height,
  };
}

function distanceToScreenSegment(
  pointX: number,
  pointY: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): number {
  const segmentX = endX - startX;
  const segmentY = endY - startY;
  const lengthSq = segmentX * segmentX + segmentY * segmentY;
  if (lengthSq <= 0.0001) return Math.hypot(pointX - startX, pointY - startY);
  const t = Math.min(1, Math.max(
    0,
    ((pointX - startX) * segmentX + (pointY - startY) * segmentY) / lengthSq,
  ));
  return Math.hypot(
    pointX - (startX + segmentX * t),
    pointY - (startY + segmentY * t),
  );
}
