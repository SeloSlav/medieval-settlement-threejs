import * as THREE from 'three';
import { trailerClock } from '../app/trailerClock.ts';
import {
  deliveryLegRemainingMeters,
  deliveryTripHasVisibleCargo,
  deliveryTripTravelSpeed,
  deliveryWorkerPersonIdentity,
  isRegionalImportTrip,
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
  DELIVERY_OX_CART_FORMATION,
  disposeDeliveryCartWorkerSources,
  disposeDeliveryCartWorkerVisual,
  loadDeliveryCartWorkerSources,
  updateDeliveryCartWorkerVisual,
  type DeliveryCartWorkerSources,
  type DeliveryCartWorkerVisual,
} from './deliveryCartWorker.ts';
import type { Terrain } from '../terrain/Terrain.ts';
import type { OxFollowPose } from '../settlement/OxenRenderer.ts';
import { createTimberLogMesh, timberLogLayout } from '../forestry/TimberLogVisuals.ts';
import { timberLogDimensions } from '../forestry/forestry.ts';
import {
  samplePolylineXZ,
  type PointXZ,
  type PolylineSampleXZ,
} from '../utils/pathGeometry.ts';
import { resolveRoadAwareGroundY } from '../roads/RoadSurfaceSampling.ts';
import {
  DELIVERY_ROAD_SPEED_MULTIPLIER,
  surfaceAdjustedTravelSpeed,
} from '../roads/roadTravel.ts';
import type { CrowdViewState } from '../settlement/crowdView.ts';
import { hashStringSeed } from '../utils/random.ts';
import {
  pickVillagerModelVariant,
} from '../settlement/villagerPaths.ts';
import type { VillagerModelVariant } from '../settlement/SettlementCrowdRenderer.ts';
import type { GameSpeed } from '../world/gameSpeed.ts';
import {
  SIM_REALTIME_RATE,
  WORKFORCE_MOVEMENT_SPEED_MULTIPLIER,
} from '../generated/gameBalance.ts';
import { agentPacedDelta } from '../world/agentPacing.ts';
import {
  createSelectedAgentRoute,
  SELECTED_AGENT_ROUTE_Y_OFFSET,
  type SelectedAgentRoute,
  type SelectedAgentRoutePoint,
  updateSelectedAgentRoute,
} from '../scene/SelectedAgentRoute.ts';
import { advanceDeliveryDisplayProgress } from './deliveryPresentationMotion.ts';

type TripVisual = {
  mesh: THREE.Group;
  workers: DeliveryCartWorkerVisual[];
  routePolylineJson: string;
  polyline: PointXZ[];
  measuredPathDistance: number;
  pathDistance: number;
  serverProgress: number;
  displayProgress: number;
  phase: DeliveryTripPhase;
  travelSpeed: number;
  movementSpeed: number;
  serverX: number;
  serverZ: number;
  yaw: number;
  sampleScratch: PolylineSampleXZ;
};

type DeliveryAgentRendererOptions = {
  terrain: Terrain;
  parent: THREE.Group;
  getGameSpeed: () => GameSpeed;
  getRoadDeckY?: (x: number, z: number) => number | null;
  isOnRoadSurface?: (x: number, z: number) => boolean;
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
  private readonly isOnRoadSurface: ((x: number, z: number) => boolean) | null;
  private readonly group = new THREE.Group();
  private readonly visuals = new Map<string, TripVisual>();
  private readonly selectedRoute: SelectedAgentRoute;
  private readonly latestTrips = new Map<string, DeliveryTripState>();
  private readonly nextTripIds = new Set<string>();
  private readonly selectedRouteXzScratch: PointXZ[] = [];
  private readonly selectedRouteXzPool: PointXZ[] = [];
  private readonly selectedRoutePointScratch: SelectedAgentRoutePoint[] = [];
  private readonly selectedRouteSampleScratch: PolylineSampleXZ = { x: 0, z: 0, yaw: 0 };
  private selectedTripId: string | null = null;
  private cartSource: DeliveryCartModelSource | null = null;
  private workerSources: DeliveryCartWorkerSources | null = null;
  private disposed = false;

  constructor(options: DeliveryAgentRendererOptions) {
    this.getGameSpeed = options.getGameSpeed;
    this.terrain = options.terrain;
    this.getRoadDeckY = options.getRoadDeckY ?? null;
    this.isOnRoadSurface = options.isOnRoadSurface ?? null;
    this.group.name = 'Delivery agents';
    this.selectedRoute = createSelectedAgentRoute('Selected delivery destination route');
    this.group.add(this.selectedRoute);
    options.parent.add(this.group);
    void this.loadCartSource();
    void this.loadWorkerSources();
  }

  syncTrips(trips: Iterable<DeliveryTripState>): void {
    this.latestTrips.clear();
    this.nextTripIds.clear();
    for (const trip of trips) {
      this.latestTrips.set(trip.id, trip);
      this.nextTripIds.add(trip.id);

      const existing = this.visuals.get(trip.id);
      if (existing) {
        this.syncRoute(existing, trip);
        this.applyAuthoritativeTripState(existing, trip);
        this.ensureCartMesh(existing, trip);
        this.ensureWorkerCrew(existing, trip);
        continue;
      }

      const mesh = this.createCartMesh(trip);
      this.group.add(mesh);
      const polyline = decodeRoutePolyline(trip.routePolylineJson) ?? [];
      const measuredPathDistance = polyline.length >= 2
        ? this.measurePolyline(polyline)
        : 0;
      const visual: TripVisual = {
        mesh,
        workers: [],
        routePolylineJson: trip.routePolylineJson,
        polyline,
        measuredPathDistance,
        pathDistance: trip.pathDistance > 1e-6
          ? trip.pathDistance
          : measuredPathDistance,
        serverProgress: trip.progress,
        displayProgress: trip.progress,
        phase: trip.phase,
        travelSpeed: this.tripTravelSpeed(trip),
        movementSpeed: 0,
        serverX: trip.x,
        serverZ: trip.z,
        yaw: 0,
        sampleScratch: { x: 0, z: 0, yaw: 0 },
      };
      this.visuals.set(trip.id, visual);
      this.ensureWorkerCrew(visual, trip);
    }

    for (const id of this.visuals.keys()) {
      if (this.nextTripIds.has(id)) continue;
      this.removeTrip(id);
    }
    if (this.selectedTripId && !this.nextTripIds.has(this.selectedTripId)) {
      this.selectDeliveryAgent(null);
    }
  }

  /** Front-of-cart attachment used by the ox reserved on this delivery trip. */
  getOxFollowPose(tripId: string): OxFollowPose | null {
    const visual = this.visuals.get(tripId);
    const trip = this.latestTrips.get(tripId);
    if (!visual || !trip || !trip.oxId) return null;
    const yaw = visual.mesh.rotation.y;
    const forwardX = Math.sin(yaw);
    const forwardZ = Math.cos(yaw);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    return {
      x: visual.mesh.position.x
        + forwardX * DELIVERY_OX_CART_FORMATION.ox.z
        + rightX * DELIVERY_OX_CART_FORMATION.ox.x,
      y: visual.mesh.position.y - 0.05,
      z: visual.mesh.position.z
        + forwardZ * DELIVERY_OX_CART_FORMATION.ox.z
        + rightZ * DELIVERY_OX_CART_FORMATION.ox.x,
      yaw,
      moving: this.isVisualMoving(visual),
      movementSpeed: visual.movementSpeed,
      active: true,
    };
  }

  /** Remaining route shared by a selected cart worker or its attached ox. */
  getRemainingRoute(tripId: string): readonly SelectedAgentRoutePoint[] {
    const visual = this.visuals.get(tripId);
    if (!visual) {
      this.selectedRoutePointScratch.length = 0;
      return this.selectedRoutePointScratch;
    }
    return this.buildRemainingRoute(visual);
  }

  update(dt: number, _view?: CrowdViewState): void {
    const realDt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    const gameSpeed = trailerClock.active ? trailerClock.speed : this.getGameSpeed();
    const simulationDt = realDt * gameSpeed * SIM_REALTIME_RATE;
    const animationDt = agentPacedDelta(realDt, gameSpeed);
    for (const [tripId, visual] of this.visuals) {
      const currentSample = visual.polyline.length >= 2
        ? samplePolylineXZ(
            visual.polyline,
            this.phaseSampleDistance(visual),
            visual.sampleScratch,
          )
        : null;
      const onRoadSurface = this.isOnRoadSurface?.(
        currentSample?.x ?? visual.serverX,
        currentSample?.z ?? visual.serverZ,
      ) ?? false;
      const surfaceTravelSpeed = surfaceAdjustedTravelSpeed(
        visual.travelSpeed,
        onRoadSurface,
        DELIVERY_ROAD_SPEED_MULTIPLIER,
      );
      const effectiveTravelSpeed = surfaceTravelSpeed
        * (realDt > 0 ? simulationDt / realDt : 0);
      visual.displayProgress = advanceDeliveryDisplayProgress({
        displayProgress: visual.displayProgress,
        serverProgress: visual.serverProgress,
        pathDistance: visual.pathDistance,
        phase: visual.phase,
        effectiveTravelSpeed,
        deltaSeconds: realDt,
      });

      let x = visual.serverX;
      let z = visual.serverZ;
      let yaw = visual.yaw;

      if (visual.polyline.length >= 2 && visual.pathDistance > 1e-6) {
        const distance = this.phaseSampleDistance(visual);
        const sample = samplePolylineXZ(visual.polyline, distance, visual.sampleScratch);
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
      const moving = this.isVisualMoving(visual);
      visual.movementSpeed = moving ? surfaceTravelSpeed : 0;
      for (const worker of visual.workers) {
        updateDeliveryCartWorkerVisual(
          worker,
          animationDt,
          moving,
          surfaceTravelSpeed / WORKFORCE_MOVEMENT_SPEED_MULTIPLIER,
        );
      }
      if (this.selectedTripId === tripId) this.updateSelectedRoute(visual);
    }
  }

  applyTripStates(trips: Iterable<DeliveryTripState>): void {
    for (const trip of trips) {
      const visual = this.visuals.get(trip.id);
      if (!visual) continue;
      this.syncRoute(visual, trip);
      this.applyAuthoritativeTripState(visual, trip);
    }
  }

  private syncRoute(visual: TripVisual, trip: DeliveryTripState): void {
    if (visual.routePolylineJson !== trip.routePolylineJson) {
      const polyline = decodeRoutePolyline(trip.routePolylineJson) ?? [];
      visual.routePolylineJson = trip.routePolylineJson;
      visual.polyline = polyline;
      visual.measuredPathDistance = polyline.length >= 2
        ? this.measurePolyline(polyline)
        : 0;
    }
    visual.pathDistance = trip.pathDistance > 1e-6
      ? trip.pathDistance
      : visual.measuredPathDistance;
  }

  pickDeliveryAgent(
    clientX: number,
    clientY: number,
    camera: THREE.Camera,
    domElement: HTMLElement,
  ): DeliveryAgentInspection | null {
    if (!this.group.visible) return null;
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
    return deliveryTripTravelSpeed(trip);
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
    this.nextTripIds.clear();
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

  private isVisualMoving(visual: TripVisual): boolean {
    return visual.phase !== 'unloading'
      && visual.displayProgress < visual.pathDistance - 1e-4;
  }

  private measurePolyline(polyline: readonly PointXZ[]): number {
    let total = 0;
    for (let i = 0; i < polyline.length - 1; i++) {
      total += Math.hypot(polyline[i + 1].x - polyline[i].x, polyline[i + 1].z - polyline[i].z);
    }
    return total;
  }

  private ensureCartMesh(visual: TripVisual, trip: DeliveryTripState): void {
    const desiredName = trip.forestrySource && trip.cargoKind === 'timber'
      ? `Forestry ox haul ${trip.forestrySource.layoutIndex} ${trip.amount}`
      : trip.destinationKind === 'fire'
      ? fireBucketCarrierMeshName()
      : deliveryCartMeshName(
          trip.cargoKind,
          this.cartSource != null,
          isRegionalImportTrip(trip),
          deliveryTripHasVisibleCargo(trip),
        );
    if (visual.mesh.name === desiredName) return;
    const replacement = this.createCartMesh(trip);
    replacement.position.copy(visual.mesh.position);
    replacement.rotation.copy(visual.mesh.rotation);
    for (const worker of visual.workers) worker.root.removeFromParent();
    this.group.remove(visual.mesh);
    disposeDeliveryCartMesh(visual.mesh);
    for (const worker of visual.workers) replacement.add(worker.root);
    this.group.add(replacement);
    visual.mesh = replacement;
    this.ensureWorkerCrew(visual, trip);
  }

  private removeTrip(id: string): void {
    const visual = this.visuals.get(id);
    if (!visual) return;
    for (const worker of visual.workers) {
      disposeDeliveryCartWorkerVisual(worker);
    }
    visual.workers.length = 0;
    disposeDeliveryCartMesh(visual.mesh);
    visual.mesh.removeFromParent();
    this.visuals.delete(id);
  }

  private createCartMesh(trip: DeliveryTripState): THREE.Group {
    if (trip.forestrySource && trip.cargoKind === 'timber') {
      const root = new THREE.Group();
      root.name = `Forestry ox haul ${trip.forestrySource.layoutIndex} ${trip.amount}`;
      const placement = timberLogLayout(trip.forestrySource.layoutIndex);
      if (placement && trip.amount > 0) {
        const { radius, length } = timberLogDimensions(placement);
        const log = createTimberLogMesh(placement.species, radius, length);
        log.rotation.x = Math.PI/2;
        log.position.set(0, radius, -0.45);
        root.add(log);
        const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.025,0.025,1.5,6), new THREE.MeshStandardMaterial({ color: 0x8b7048, roughness: 1 }));
        rope.rotation.x = Math.PI/2;
        rope.position.set(0, radius+0.1, 1.1);
        root.userData.ownedCartMaterials = [rope.material];
        root.add(rope);
      }
      return root;
    }
    if (trip.destinationKind === 'fire') {
      return createFireBucketCarrierMesh();
    }
    return createDeliveryCartMesh(trip.cargoKind, {
      appearanceSeed: hashStringSeed(`delivery-cart:${trip.id}`),
      source: this.cartSource,
      regionalImport: isRegionalImportTrip(trip),
      loaded: deliveryTripHasVisibleCargo(trip),
    });
  }

  private ensureWorkerCrew(visual: TripVisual, trip: DeliveryTripState): void {
    const desiredCrewSize = Math.max(1, Math.floor(trip.deliveryWorkers));
    const desiredLeadRole = trip.oxId ? 'guide' : 'hauler';
    if (visual.workers[0] && visual.workers[0].role !== desiredLeadRole) {
      for (const worker of visual.workers) {
        disposeDeliveryCartWorkerVisual(worker);
      }
      visual.workers.length = 0;
    }
    while (visual.workers.length > desiredCrewSize) {
      const worker = visual.workers.pop();
      if (worker) disposeDeliveryCartWorkerVisual(worker);
    }
    if (!this.cartSource || !this.workerSources) return;
    while (visual.workers.length < desiredCrewSize) {
      const crewIndex = visual.workers.length;
      const worker = createDeliveryCartWorkerVisual(
        hashStringSeed(deliveryWorkerPersonIdentity(trip, crewIndex)),
        this.workerSources,
        crewIndex,
        Boolean(trip.oxId),
      );
      visual.workers.push(worker);
      visual.mesh.add(worker.root);
    }
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
      visible: this.group.visible && visual.mesh.visible,
    };
  }

  private updateSelectedRoute(visual: TripVisual): void {
    updateSelectedAgentRoute(this.selectedRoute, this.buildRemainingRoute(visual));
  }

  private buildRemainingRoute(
    visual: TripVisual,
  ): readonly SelectedAgentRoutePoint[] {
    if (visual.polyline.length < 2 || visual.pathDistance <= 1e-6) {
      this.selectedRoutePointScratch.length = 0;
      return this.selectedRoutePointScratch;
    }
    const sampleDistance = this.phaseSampleDistance(visual);
    const route = visual.phase === 'inbound'
      ? polylineToDistanceInto(
          visual.polyline,
          sampleDistance,
          this.selectedRouteXzScratch,
          this.selectedRouteXzPool,
          this.selectedRouteSampleScratch,
        )
      : polylineFromDistanceInto(
          visual.polyline,
          sampleDistance,
          this.selectedRouteXzScratch,
          this.selectedRouteXzPool,
          this.selectedRouteSampleScratch,
        );
    if (route.length < 2) {
      this.selectedRoutePointScratch.length = 0;
      return this.selectedRoutePointScratch;
    }
    const routePoints = this.selectedRoutePointScratch;
    for (let index = 0; index < route.length; index += 1) {
      const source = route[index];
      const point = routePoints[index] ?? { x: 0, y: 0, z: 0 };
      point.x = source.x;
      point.y = this.resolveGroundY(source.x, source.z) + SELECTED_AGENT_ROUTE_Y_OFFSET;
      point.z = source.z;
      routePoints[index] = point;
    }
    routePoints.length = route.length;
    return routePoints;
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
        if (visual) this.ensureWorkerCrew(visual, trip);
      }
    } catch (error) {
      console.warn('[Delivery carts] Rigged cart workers failed to load.', error);
    }
  }
}

function polylineFromDistanceInto(
  polyline: readonly PointXZ[],
  startDistance: number,
  result: PointXZ[],
  pool: PointXZ[],
  sampleTarget: PolylineSampleXZ,
): PointXZ[] {
  result.length = 0;
  const sample = samplePolylineXZ(polyline, startDistance, sampleTarget);
  if (!sample) return result;
  writePointXZ(result, pool, 0, sample.x, sample.z);
  let traversed = 0;
  for (let index = 0; index < polyline.length - 1; index++) {
    const start = polyline[index]!;
    const end = polyline[index + 1]!;
    traversed += Math.hypot(end.x - start.x, end.z - start.z);
    if (traversed > startDistance + 1e-5) {
      writePointXZ(result, pool, result.length, end.x, end.z);
    }
  }
  return result;
}

function polylineToDistanceInto(
  polyline: readonly PointXZ[],
  endDistance: number,
  result: PointXZ[],
  pool: PointXZ[],
  sampleTarget: PolylineSampleXZ,
): PointXZ[] {
  result.length = 0;
  const sample = samplePolylineXZ(polyline, endDistance, sampleTarget);
  if (!sample) return result;
  writePointXZ(result, pool, 0, polyline[0]!.x, polyline[0]!.z);
  let traversed = 0;
  for (let index = 0; index < polyline.length - 1; index++) {
    const start = polyline[index]!;
    const end = polyline[index + 1]!;
    traversed += Math.hypot(end.x - start.x, end.z - start.z);
    if (traversed >= endDistance - 1e-5) break;
    writePointXZ(result, pool, result.length, end.x, end.z);
  }
  const last = result[result.length - 1]!;
  if (Math.hypot(last.x - sample.x, last.z - sample.z) > 1e-5) {
    writePointXZ(result, pool, result.length, sample.x, sample.z);
  }
  return result.reverse();
}

function writePointXZ(
  result: PointXZ[],
  pool: PointXZ[],
  index: number,
  x: number,
  z: number,
): void {
  const point = pool[index] ?? { x: 0, z: 0 };
  point.x = x;
  point.z = z;
  pool[index] = point;
  result[index] = point;
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
