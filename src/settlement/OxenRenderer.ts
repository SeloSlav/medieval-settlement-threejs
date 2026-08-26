import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { SIM_REALTIME_RATE } from '../generated/gameBalance.ts';
import type { DeliveryTripState } from '../logistics/deliveryTrips.ts';
import { resolveRoadAwareGroundY } from '../roads/RoadSurfaceSampling.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import type { BuildingState } from '../resources/types.ts';
import { getBuildingDefinition } from '../resources/buildings.ts';
import {
  SELECTED_AGENT_ROUTE_Y_OFFSET,
  type SelectedAgentRoutePoint,
} from '../scene/SelectedAgentRoute.ts';
import type { GameSpeed } from '../world/gameSpeed.ts';
import type { CrowdViewState } from './crowdView.ts';
import {
  isAgentAnimalRenderingEnabled,
  isWithinCrowdView,
} from './crowdView.ts';
import {
  assignStableOxen,
  stableOxRestPose,
  type StableOxAssignment,
  type StableOxLike,
} from './stableOxen.ts';
import { advanceOxFollowPosition } from './oxFollowMotion.ts';

const OX_MODEL_URL = '/assets/models/livestock/quaternius-bull.glb';
const OX_TARGET_HEIGHT = 1.72;
const OX_WALK_SPEED = 1.05;
const OX_YOKE_BACK_CONTACT_Y = 1.69;
const OX_YOKE_BAR_HEIGHT = 0.13;
const OX_YOKE_BOW_LENGTH = 0.68;
const WORKER_SIDE_OFFSET = 1.35;
const WORKER_BACK_OFFSET = 0.55;
const OX_COAT_PALETTES = [
  { main: 0x74472c, light: 0xb69a74 },
  { main: 0x815033, light: 0xc0a481 },
  { main: 0x65402b, light: 0xa98e70 },
] as const;

type OxMotionMode = 'idle' | 'eat' | 'walk';

type OxSource = {
  scene: THREE.Group;
  bounds: THREE.Box3;
  sourceHeight: number;
  clips: Record<OxMotionMode, THREE.AnimationClip>;
};

export type OxFollowPose = Readonly<{
  x: number;
  y: number;
  z: number;
  yaw: number;
  moving: boolean;
  active: boolean;
}>;

export type OxInspection = {
  oxId: string;
  portraitVariant: 'ox';
  name: string;
  initials: string;
  eyebrow: string;
  occupation: string;
  activity: string;
  activityState: 'active' | 'ready';
  workplaceLabel: string;
  workplace: string;
  householdLabel: string;
  household: string;
  crewLabel: string;
  crew: string;
  paceLabel: string;
  pace: string;
  position: { x: number; y: number; z: number };
  route: SelectedAgentRoutePoint[];
  visible: boolean;
};

type OxVisual = {
  ox: StableOxLike;
  root: THREE.Group;
  model: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Record<OxMotionMode, THREE.AnimationAction>;
  mode: OxMotionMode;
  assignment: StableOxAssignment | null;
  tripId: string | null;
  x: number;
  z: number;
  yaw: number;
};

export type OxenRendererOptions = {
  parent: THREE.Group;
  getGameSpeed: () => GameSpeed;
  getHeightAt: (x: number, z: number) => number;
  getRoadDeckY?: (x: number, z: number) => number | null;
  getWorkerPose: (buildingId: string, workerSlot: number) => OxFollowPose | null;
  getDeliveryPose?: (tripId: string) => OxFollowPose | null;
  getWorkerRoute?: (
    buildingId: string,
    workerSlot: number,
  ) => readonly SelectedAgentRoutePoint[];
  getDeliveryRoute?: (tripId: string) => readonly SelectedAgentRoutePoint[];
};

type OxenSyncInput = {
  oxen: Iterable<StableOxLike>;
  buildings: ReadonlyMap<string, BuildingState>;
  deliveryTrips: Iterable<DeliveryTripState>;
  disabledBuildingIds: ReadonlySet<string>;
  roadNetwork: RoadNetwork | null;
};

/** Animated draft animals that rest in authored stable bays and follow crews. */
export class OxenRenderer {
  readonly ready: Promise<boolean>;
  private readonly root = new THREE.Group();
  private readonly visuals = new Map<string, OxVisual>();
  private readonly getGameSpeed: () => GameSpeed;
  private readonly getHeightAt: (x: number, z: number) => number;
  private readonly getRoadDeckY: ((x: number, z: number) => number | null) | null;
  private readonly getWorkerPose: OxenRendererOptions['getWorkerPose'];
  private readonly getDeliveryPose: NonNullable<OxenRendererOptions['getDeliveryPose']>;
  private readonly getWorkerRoute: NonNullable<OxenRendererOptions['getWorkerRoute']>;
  private readonly getDeliveryRoute: NonNullable<OxenRendererOptions['getDeliveryRoute']>;
  private readonly yokeMaterial = new THREE.MeshStandardMaterial({
    color: 0x6b492b,
    roughness: 0.9,
    metalness: 0,
  });
  private readonly harnessMaterial = new THREE.MeshStandardMaterial({
    color: 0x30251d,
    roughness: 0.96,
    metalness: 0,
  });
  private readonly yokeBarGeometry = new THREE.BoxGeometry(
    1.92,
    OX_YOKE_BAR_HEIGHT,
    0.16,
  );
  private readonly yokeBowGeometry = new THREE.CylinderGeometry(
    0.035,
    0.035,
    OX_YOKE_BOW_LENGTH,
    7,
  );
  private source: OxSource | null = null;
  private latestInput: OxenSyncInput | null = null;
  private disposed = false;

  constructor(options: OxenRendererOptions) {
    this.getGameSpeed = options.getGameSpeed;
    this.getHeightAt = options.getHeightAt;
    this.getRoadDeckY = options.getRoadDeckY ?? null;
    this.getWorkerPose = options.getWorkerPose;
    this.getDeliveryPose = options.getDeliveryPose ?? (() => null);
    this.getWorkerRoute = options.getWorkerRoute ?? (() => []);
    this.getDeliveryRoute = options.getDeliveryRoute ?? (() => []);
    this.root.name = 'Stable draft oxen';
    options.parent.add(this.root);
    this.ready = this.loadSource();
  }

  sync(input: OxenSyncInput): void {
    this.latestInput = {
      oxen: [...input.oxen],
      buildings: new Map(input.buildings),
      deliveryTrips: [...input.deliveryTrips],
      disabledBuildingIds: new Set(input.disabledBuildingIds),
      roadNetwork: input.roadNetwork,
    };
    this.reconcile();
  }

  /** Deterministic lineup/debug evidence without exposing mutable visuals. */
  getVisualCount(): number {
    return this.visuals.size;
  }

  pickOx(
    clientX: number,
    clientY: number,
    camera: THREE.Camera,
    domElement: HTMLElement,
  ): OxInspection | null {
    if (!this.root.visible) return null;
    const bounds = domElement.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return null;

    let nearest: { distance: number; inspection: OxInspection } | null = null;
    for (const visual of this.visuals.values()) {
      if (!visual.root.visible) continue;
      const distance = projectedOxHitDistance(
        clientX,
        clientY,
        visual.root.position.x,
        visual.root.position.y,
        visual.root.position.z,
        camera,
        bounds,
      );
      if (distance == null || (nearest && distance >= nearest.distance)) continue;
      const inspection = this.describeOx(visual);
      if (inspection) nearest = { distance, inspection };
    }
    return nearest?.inspection ?? null;
  }

  inspectOx(oxId: string): OxInspection | null {
    const visual = this.visuals.get(oxId);
    return visual ? this.describeOx(visual) : null;
  }

  tick(dtSeconds: number, view?: CrowdViewState): void {
    const renderEnabled = isAgentAnimalRenderingEnabled(view);
    if (this.root.visible !== renderEnabled) {
      this.root.visible = renderEnabled;
    }
    if (!renderEnabled || !this.latestInput) return;

    const realDt = Math.min(0.08, Math.max(0, dtSeconds));
    const simulationDt = realDt * this.getGameSpeed() * SIM_REALTIME_RATE;
    for (const visual of this.visuals.values()) {
      const stable = this.latestInput.buildings.get(visual.ox.stableId);
      if (!stable || stable.kind !== 'stable') {
        visual.root.visible = false;
        continue;
      }

      const target = this.targetPose(visual, stable);
      const visible = isWithinCrowdView(visual.x, visual.z, view)
        || isWithinCrowdView(target.x, target.z, view);
      visual.root.visible = visible;
      if (!visible) continue;

      let moving = target.moving;
      if (target.attached) {
        visual.x = target.x;
        visual.z = target.z;
        visual.yaw = target.yaw;
      } else {
        const dx = target.x - visual.x;
        const dz = target.z - visual.z;
        const distance = Math.hypot(dx, dz);
        moving = moving || distance > 0.16;
        if (distance > 1e-6 && simulationDt > 0) {
          advanceOxFollowPosition(
            visual,
            target.x,
            target.z,
            OX_WALK_SPEED * simulationDt,
          );
          visual.yaw = Math.atan2(dx, dz);
        } else if (distance <= 0.16) {
          visual.yaw = target.yaw;
        }
      }

      const desiredMode: OxMotionMode = moving
        ? 'walk'
        : visual.assignment || visual.tripId
          ? 'idle'
          : visual.ox.slot % 2 === 0
            ? 'eat'
            : 'idle';
      this.transition(visual, desiredMode);

      const y = target.attached
        ? target.y
        : resolveRoadAwareGroundY(
            this.getHeightAt(visual.x, visual.z),
            this.getRoadDeckY?.(visual.x, visual.z) ?? null,
          ) + target.groundOffset;
      visual.root.position.set(visual.x, y, visual.z);
      visual.root.rotation.y = visual.yaw;

      visual.mixer.update(simulationDt);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const visual of this.visuals.values()) this.removeVisual(visual);
    this.visuals.clear();
    if (this.source) disposeModelResources(this.source.scene);
    this.source = null;
    this.latestInput = null;
    this.yokeBarGeometry.dispose();
    this.yokeBowGeometry.dispose();
    this.yokeMaterial.dispose();
    this.harnessMaterial.dispose();
    this.root.removeFromParent();
  }

  private async loadSource(): Promise<boolean> {
    try {
      const gltf = await new GLTFLoader().loadAsync(OX_MODEL_URL);
      const bounds = new THREE.Box3().setFromObject(gltf.scene);
      const sourceHeight = bounds.max.y - bounds.min.y;
      if (!Number.isFinite(sourceHeight) || sourceHeight <= 0.001) {
        throw new Error(`Invalid draft-ox model bounds for ${OX_MODEL_URL}`);
      }
      const clips = resolveClips(gltf.animations);
      if (this.disposed) {
        disposeModelResources(gltf.scene);
        return false;
      }
      this.source = { scene: gltf.scene, bounds, sourceHeight, clips };
      this.reconcile();
      return true;
    } catch (error) {
      console.warn('[Stable oxen] Animated CC0 bull failed to load.', error);
      return false;
    }
  }

  private reconcile(): void {
    if (!this.source || !this.latestInput) return;
    const oxen = [...this.latestInput.oxen].sort((left, right) =>
      left.stableId.localeCompare(right.stableId)
      || left.slot - right.slot
      || left.id.localeCompare(right.id));
    const nextIds = new Set(oxen.map((ox) => ox.id));
    const assignments = assignStableOxen(
      oxen,
      this.latestInput.buildings,
      this.latestInput.deliveryTrips,
      this.latestInput.disabledBuildingIds,
    );
    const tripsByOxId = new Map<string, DeliveryTripState>();
    for (const trip of this.latestInput.deliveryTrips) {
      if (trip.oxId) tripsByOxId.set(trip.oxId, trip);
    }

    for (const ox of oxen) {
      let visual = this.visuals.get(ox.id);
      if (!visual) {
        const created = this.createVisual(ox);
        if (!created) continue;
        visual = created;
        this.visuals.set(ox.id, created);
      }
      visual.ox = ox;
      visual.assignment = assignments.get(ox.id) ?? null;
      visual.tripId = tripsByOxId.get(ox.id)?.id ?? null;
      visual.root.userData.stableId = ox.stableId;
      visual.root.userData.stableSlot = ox.slot;
      visual.root.userData.assignmentBuildingId = visual.assignment?.buildingId;
      visual.root.userData.deliveryTripId = visual.tripId ?? undefined;
    }

    for (const [id, visual] of this.visuals) {
      if (nextIds.has(id)) continue;
      this.removeVisual(visual);
      this.visuals.delete(id);
    }
  }

  private createVisual(ox: StableOxLike): OxVisual | null {
    if (!this.source || !this.latestInput) return null;
    const stable = this.latestInput.buildings.get(ox.stableId);
    if (!stable || stable.kind !== 'stable') return null;
    const rest = stableOxRestPose(stable, ox.slot, this.latestInput.roadNetwork);
    const model = cloneSkinned(this.source.scene) as THREE.Group;
    const scale = OX_TARGET_HEIGHT / this.source.sourceHeight;
    model.scale.setScalar(scale);
    model.position.y = -this.source.bounds.min.y * scale + 0.018;
    configureModelMeshes(model, ox.slot);

    const root = new THREE.Group();
    root.name = `Draft ox ${ox.id}`;
    root.userData.oxId = ox.id;
    root.add(model);
    root.add(this.createYoke());
    this.root.add(root);

    const mixer = new THREE.AnimationMixer(model);
    const actions: Record<OxMotionMode, THREE.AnimationAction> = {
      idle: mixer.clipAction(this.source.clips.idle, model),
      eat: mixer.clipAction(this.source.clips.eat, model),
      walk: mixer.clipAction(this.source.clips.walk, model),
    };
    for (const action of Object.values(actions)) {
      action.setLoop(THREE.LoopRepeat, Number.POSITIVE_INFINITY);
      action.enabled = true;
    }
    actions.walk.setEffectiveTimeScale(0.96);
    const initialMode: OxMotionMode = ox.slot % 2 === 0 ? 'eat' : 'idle';
    actions[initialMode].play();
    actions[initialMode].time = (ox.slot * 1.7) % Math.max(
      0.1,
      actions[initialMode].getClip().duration,
    );
    const y = resolveRoadAwareGroundY(
      this.getHeightAt(rest.x, rest.z),
      this.getRoadDeckY?.(rest.x, rest.z) ?? null,
    ) + rest.localGroundOffset;
    root.position.set(rest.x, y, rest.z);
    root.rotation.y = rest.yaw;
    return {
      ox,
      root,
      model,
      mixer,
      actions,
      mode: initialMode,
      assignment: null,
      tripId: null,
      x: rest.x,
      z: rest.z,
      yaw: rest.yaw,
    };
  }

  private createYoke(): THREE.Group {
    const yoke = new THREE.Group();
    yoke.name = 'Draft ox oak yoke and leather bows';
    const barCenterY = OX_YOKE_BACK_CONTACT_Y + OX_YOKE_BAR_HEIGHT * 0.5;
    const bowCenterY = barCenterY + OX_YOKE_BAR_HEIGHT * 0.5
      - OX_YOKE_BOW_LENGTH * 0.5;
    const bar = new THREE.Mesh(this.yokeBarGeometry, this.yokeMaterial);
    bar.name = 'Draft ox oak yoke';
    bar.position.set(0, barCenterY, 0.18);
    bar.castShadow = false;
    bar.receiveShadow = false;
    yoke.add(bar);
    for (const x of [-0.48, 0.48]) {
      const bow = new THREE.Mesh(this.yokeBowGeometry, this.harnessMaterial);
      bow.name = 'Draft ox leather yoke bow';
      bow.position.set(x, bowCenterY, 0.2);
      bow.castShadow = false;
      bow.receiveShadow = false;
      yoke.add(bow);
    }
    return yoke;
  }

  private targetPose(
    visual: OxVisual,
    stable: BuildingState,
  ): {
    x: number;
    y: number;
    z: number;
    yaw: number;
    moving: boolean;
    attached: boolean;
    groundOffset: number;
  } {
    if (visual.tripId) {
      const tripPose = this.getDeliveryPose(visual.tripId);
      if (tripPose?.active) {
        return {
          ...tripPose,
          moving: tripPose.moving,
          attached: true,
          groundOffset: 0,
        };
      }
    }
    if (visual.assignment) {
      const workerPose = this.getWorkerPose(
        visual.assignment.buildingId,
        visual.assignment.workerSlot,
      );
      if (workerPose?.active) {
        const forwardX = Math.sin(workerPose.yaw);
        const forwardZ = Math.cos(workerPose.yaw);
        const rightX = Math.cos(workerPose.yaw);
        const rightZ = -Math.sin(workerPose.yaw);
        const side = visual.ox.slot % 2 === 0 ? 1 : -1;
        return {
          x: workerPose.x + rightX * WORKER_SIDE_OFFSET * side
            - forwardX * WORKER_BACK_OFFSET,
          y: workerPose.y,
          z: workerPose.z + rightZ * WORKER_SIDE_OFFSET * side
            - forwardZ * WORKER_BACK_OFFSET,
          yaw: workerPose.yaw,
          moving: workerPose.moving,
          attached: false,
          groundOffset: 0,
        };
      }
    }
    const rest = stableOxRestPose(stable, visual.ox.slot, this.latestInput?.roadNetwork ?? null);
    return {
      x: rest.x,
      y: this.getHeightAt(rest.x, rest.z) + rest.localGroundOffset,
      z: rest.z,
      yaw: rest.yaw,
      moving: false,
      attached: false,
      groundOffset: rest.localGroundOffset,
    };
  }

  private describeOx(visual: OxVisual): OxInspection | null {
    const input = this.latestInput;
    if (!input) return null;
    const stable = input.buildings.get(visual.ox.stableId);
    if (!stable || stable.kind !== 'stable') return null;
    let trip: DeliveryTripState | null = null;
    if (visual.tripId) {
      for (const candidate of input.deliveryTrips) {
        if (candidate.id !== visual.tripId) continue;
        trip = candidate;
        break;
      }
    }
    const assignmentBuilding = visual.assignment
      ? input.buildings.get(visual.assignment.buildingId) ?? null
      : null;
    const postedBuilding = visual.ox.assignedBuildingId
      ? input.buildings.get(visual.ox.assignedBuildingId) ?? null
      : null;
    const workerPose = visual.assignment
      ? this.getWorkerPose(
          visual.assignment.buildingId,
          visual.assignment.workerSlot,
        )
      : null;
    const activeAssignment = visual.assignment !== null && workerPose?.active === true;
    const active = trip !== null || activeAssignment;
    const assignmentLabel = assignmentBuilding
      ? getBuildingDefinition(assignmentBuilding.kind).label
      : null;
    const postedLabel = postedBuilding
      ? getBuildingDefinition(postedBuilding.kind).label
      : null;
    const tripOrigin = trip
      ? input.buildings.get(trip.buildingId) ?? null
      : null;
    const tripOriginLabel = tripOrigin
      ? getBuildingDefinition(tripOrigin.kind).label
      : null;
    const isPostedAssignment = visual.ox.assignedBuildingId != null;
    const activity = trip
      ? `Hauling with the ${tripOriginLabel ?? 'delivery'} cart crew`
      : activeAssignment
        ? `Assisting the crew at ${assignmentLabel ?? 'a workplace'}`
        : postedLabel
          ? `Waiting at the stable for work at ${postedLabel}`
          : 'Resting in its stable bay between automatic assignments';
    const workplace = trip
      ? `${tripOriginLabel ?? 'Delivery route'} · cart team`
      : assignmentLabel
        ? `${assignmentLabel} · ${isPostedAssignment ? 'posted' : 'automatic'}`
        : postedLabel
          ? `${postedLabel} · posted`
          : 'Automatic assistance pool';

    return {
      oxId: visual.ox.id,
      portraitVariant: 'ox',
      name: `Draft Ox · Bay ${visual.ox.slot + 1}`,
      initials: 'OX',
      eyebrow: 'Stable draft ox',
      occupation: 'Draught animal',
      activity,
      activityState: active ? 'active' : 'ready',
      workplaceLabel: trip ? 'Current route' : 'Posting',
      workplace,
      householdLabel: 'Stable',
      household: `${getBuildingDefinition(stable.kind).label} · Bay ${visual.ox.slot + 1}`,
      crewLabel: 'Team',
      crew: trip
        ? 'Ox-drawn cart crew'
        : visual.assignment
          ? `Paired with worker ${visual.assignment.workerSlot + 1}`
          : 'Unpaired',
      paceLabel: 'Walking pace',
      pace: `${OX_WALK_SPEED.toFixed(1)} m/s`,
      position: {
        x: visual.root.position.x,
        y: visual.root.position.y,
        z: visual.root.position.z,
      },
      route: this.inspectionRoute(visual, stable),
      visible: this.root.visible && visual.root.visible,
    };
  }

  private inspectionRoute(
    visual: OxVisual,
    stable: BuildingState,
  ): SelectedAgentRoutePoint[] {
    const deliveryPose = visual.tripId
      ? this.getDeliveryPose(visual.tripId)
      : null;
    const workerPose = visual.assignment
      ? this.getWorkerPose(
          visual.assignment.buildingId,
          visual.assignment.workerSlot,
        )
      : null;
    const followedRoute = visual.tripId && deliveryPose?.active
      ? this.getDeliveryRoute(visual.tripId)
      : visual.assignment && workerPose?.active
        ? this.getWorkerRoute(
            visual.assignment.buildingId,
            visual.assignment.workerSlot,
          )
        : [];
    const start = {
      x: visual.root.position.x,
      y: visual.root.position.y + SELECTED_AGENT_ROUTE_Y_OFFSET,
      z: visual.root.position.z,
    };
    if (followedRoute.length >= 2) {
      return [start, ...followedRoute.slice(1).map((point) => ({ ...point }))];
    }

    const target = this.targetPose(visual, stable);
    if (target.attached || Math.hypot(target.x - visual.x, target.z - visual.z) < 0.2) {
      return [];
    }
    const targetY = resolveRoadAwareGroundY(
      this.getHeightAt(target.x, target.z),
      this.getRoadDeckY?.(target.x, target.z) ?? null,
    ) + target.groundOffset + SELECTED_AGENT_ROUTE_Y_OFFSET;
    return [start, { x: target.x, y: targetY, z: target.z }];
  }

  private transition(visual: OxVisual, nextMode: OxMotionMode): void {
    if (visual.mode === nextMode) return;
    visual.actions[visual.mode].fadeOut(0.2);
    visual.actions[nextMode].reset().fadeIn(0.2).play();
    visual.mode = nextMode;
  }

  private removeVisual(visual: OxVisual): void {
    visual.mixer.stopAllAction();
    visual.mixer.uncacheRoot(visual.model);
    disposeClonedModelMaterials(visual.model);
    visual.root.removeFromParent();
  }
}

function projectedOxHitDistance(
  clientX: number,
  clientY: number,
  x: number,
  y: number,
  z: number,
  camera: THREE.Camera,
  bounds: DOMRect,
): number | null {
  const feet = projectWorldPoint(x, y + 0.08, z, camera, bounds);
  const shoulder = projectWorldPoint(x, y + OX_TARGET_HEIGHT, z, camera, bounds);
  if (!feet || !shoulder) return null;
  const projectedHeight = Math.hypot(feet.x - shoulder.x, feet.y - shoulder.y);
  const hitRadius = Math.min(34, Math.max(13, projectedHeight * 0.46));
  const distance = distanceToScreenSegment(
    clientX,
    clientY,
    feet.x,
    feet.y,
    shoulder.x,
    shoulder.y,
  );
  return distance <= hitRadius ? distance : null;
}

function projectWorldPoint(
  x: number,
  y: number,
  z: number,
  camera: THREE.Camera,
  bounds: DOMRect,
): { x: number; y: number } | null {
  const projected = new THREE.Vector3(x, y, z).project(camera);
  if (projected.z < -1 || projected.z > 1) return null;
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
  const t = Math.min(
    1,
    Math.max(
      0,
      ((pointX - startX) * segmentX + (pointY - startY) * segmentY) / lengthSq,
    ),
  );
  return Math.hypot(
    pointX - (startX + segmentX * t),
    pointY - (startY + segmentY * t),
  );
}

function resolveClips(
  animations: ReadonlyArray<THREE.AnimationClip>,
): Record<OxMotionMode, THREE.AnimationClip> {
  const find = (...names: string[]): THREE.AnimationClip | undefined => animations.find((clip) => {
    const normalized = clip.name.toLowerCase();
    return names.some((name) => normalized === name || normalized.endsWith(`|${name}`));
  });
  const idle = find('idle', 'idle_1');
  const eat = find('eating', 'idle_eating', 'idle_headlow') ?? idle;
  const walk = find('walk');
  if (!idle || !eat || !walk) {
    throw new Error(`Missing idle/eating/walk clips in ${OX_MODEL_URL}`);
  }
  return { idle, eat, walk };
}

function configureModelMeshes(model: THREE.Object3D, slot: number): void {
  const palette = OX_COAT_PALETTES[
    Math.abs(Math.floor(slot)) % OX_COAT_PALETTES.length
  ]!;
  model.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const cloned = materials.map((source) => {
      const material = source.clone();
      if (material instanceof THREE.MeshStandardMaterial) {
        const color = material.name === 'Main'
          ? palette.main
          : material.name === 'Main_Light'
            ? palette.light
            : material.name === 'Muzzle'
              ? 0x8c5a42
              : material.name === 'Hooves'
                ? 0x35271f
                : material.name === 'Eye_White'
                  ? 0xded4bd
                  : material.name === 'Horns'
                    ? 0xc1ad7c
                    : null;
        if (color !== null) material.color.setHex(color);
        material.metalness = 0;
        material.roughness = 0.9;
      }
      return material;
    });
    mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0]!;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
  });
}

function disposeClonedModelMaterials(model: THREE.Object3D): void {
  const materials = new Set<THREE.Material>();
  model.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materialList = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materialList) materials.add(material);
  });
  for (const material of materials) material.dispose();
}

function disposeModelResources(source: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  source.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    const materialsForMesh = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materialsForMesh) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
}
