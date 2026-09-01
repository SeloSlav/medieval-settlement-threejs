import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type {
  BuildingState,
  LivestockHerdState,
  LivestockSpecies,
  PastureState,
} from '../resources/types.ts';
import type { CrowdViewState } from '../settlement/crowdView.ts';
import {
  isAgentAnimalRenderingEnabled,
  isWithinCrowdView,
} from '../settlement/crowdView.ts';
import { hashStringSeed, mulberry32 } from '../utils/random.ts';
import {
  neutralPastureHeadCapacity,
  pastureAreaHeadCapacity,
} from './pastureCapacity.ts';
import {
  AuthoredAnimalInstanceBatch,
  setAuthoredAnimalEvaluatorOnly,
} from '../scene/AuthoredAnimalInstanceBatch.ts';

type MotionMode = 'idle' | 'graze' | 'walk';
type HerdActivity = 'rest' | 'graze' | 'move';
type LivestockWorkService = 'shearing' | 'milking' | 'culling';
type WorkTripPhase = 'outbound' | 'service' | 'return';
type PointXZ = { x: number; z: number };

type AnimalSource = {
  scene: THREE.Group;
  bounds: THREE.Box3;
  sourceHeight: number;
  targetHeight: number;
  clips: {
    idle: THREE.AnimationClip;
    graze: THREE.AnimationClip;
    walk: THREE.AnimationClip;
  };
};

type AnimalVisual = {
  herdId: string;
  species: LivestockSpecies;
  index: number;
  modelKind: keyof typeof MODEL_URLS;
  root: THREE.Group;
  model: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Record<MotionMode, THREE.AnimationAction>;
  mode: MotionMode;
  x: number;
  z: number;
  u: number;
  v: number;
  velocityU: number;
  velocityV: number;
  yaw: number;
  speed: number;
  pasture: PastureState;
  workTrip: AnimalWorkTrip | null;
};

type HerdVisual = {
  id: string;
  species: LivestockSpecies;
  pasture: PastureState;
  animals: AnimalVisual[];
  random: () => number;
  activity: HerdActivity;
  activityTimer: number;
  anchorU: number;
  anchorV: number;
  targetU: number;
  targetV: number;
  velocityU: number;
  velocityV: number;
  heading: number;
};

type AnimalWorkTrip = {
  service: LivestockWorkService;
  phase: WorkTripPhase;
  path: PointXZ[];
  returnPath: PointXZ[];
  waypointIndex: number;
  delaySeconds: number;
  serviceSeconds: number;
  homeU: number;
  homeV: number;
  removeOnArrival: boolean;
};

type ReplayableLivestockInput = {
  pastures: PastureState[];
  herds: Map<string, LivestockHerdState>;
  buildings: Map<string, BuildingState>;
};

const MODEL_URLS = {
  cow: '/assets/models/livestock/quaternius-cow.glb',
  bull: '/assets/models/livestock/quaternius-bull.glb',
  sheep: '/assets/models/livestock/quaternius-sheep.glb',
  swine: '/assets/models/livestock/quaternius-pig.glb',
} as const;

const TARGET_HEIGHTS = {
  cow: 1.55,
  bull: 1.72,
  sheep: 0.92,
  swine: 0.78,
} as const;

const MIN_EDGE_MARGIN = 0.12;
const HERD_ANCHOR_MARGIN = 0.24;
const WORK_GATE_OFFSET_M = 1.15;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const TAU = Math.PI * 2;

export type CattleVisualKind = 'cow' | 'bull';

/**
 * One authoritative livestock head is one visible authored-model animal. The
 * renderer may batch and spatially cull those meshes, but its submitted actor
 * count remains exactly equal to the whole authoritative head count.
 */
export function livestockVisualHeadCount(
  species: LivestockSpecies,
  headCount: number,
): number {
  void species;
  return Number.isFinite(headCount) ? Math.max(0, Math.floor(headCount)) : 0;
}

/** Keeps cattle herds cow-heavy while adding one breeding bull once established. */
export function createCattleVisualDistribution(headCount: number): CattleVisualKind[] {
  const count = livestockVisualHeadCount('cattle', headCount);
  return Array.from({ length: count }, (_, index) => count >= 4 && index === 0 ? 'bull' : 'cow');
}

/**
 * General weighted parcel allocator retained for visual-planning callers.
 * Live livestock rendering does not use it: each replicated herd is rendered
 * only inside its own `pastureId` parcel.
 */
export function allocateLivestockVisualPastures<
  T extends Pick<PastureState, 'area' | 'averageSlopeDegrees' | 'moisture'>,
>(
  pastures: readonly T[],
  species: LivestockSpecies,
  visualCount: number,
): T[] {
  const count = Math.max(0, Math.floor(visualCount));
  if (count === 0 || pastures.length === 0) return [];

  const weights = pastures.map((pasture) => Math.max(
    0,
    species === 'swine'
      ? pastureAreaHeadCapacity(pasture, species)
      : neutralPastureHeadCapacity(pasture, species) ?? 0,
  ));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight <= 1e-9) {
    return Array.from({ length: count }, (_, index) => pastures[index % pastures.length]!);
  }

  const assignments: T[] = [];
  let pastureIndex = 0;
  let cumulativeWeight = weights[0]!;
  for (let index = 0; index < count; index += 1) {
    const targetWeight = ((index + 0.5) / count) * totalWeight;
    while (pastureIndex < pastures.length - 1 && targetWeight > cumulativeWeight) {
      pastureIndex += 1;
      cumulativeWeight += weights[pastureIndex]!;
    }
    assignments.push(pastures[pastureIndex]!);
  }
  return assignments;
}

/** Full authored-model animals for authoritative livestock herds at every zoom. */
export class LivestockVisuals {
  private readonly root = new THREE.Group();
  private readonly animals: AnimalVisual[] = [];
  private readonly departingAnimals: AnimalVisual[] = [];
  private readonly herdVisuals = new Map<string, HerdVisual>();
  private readonly getHeightAt: (x: number, z: number) => number;
  private readonly batches = new Map<keyof typeof MODEL_URLS, AuthoredAnimalInstanceBatch>();
  private sources: Record<keyof typeof MODEL_URLS, AnimalSource> | null = null;
  private latestInput: ReplayableLivestockInput | null = null;
  private lastSignature = '';
  private disposed = false;

  constructor(
    parent: THREE.Group,
    getHeightAt: (x: number, z: number) => number,
  ) {
    this.getHeightAt = getHeightAt;
    this.root.name = 'Animated livestock herds';
    parent.add(this.root);
    void this.loadSources();
  }

  sync(
    pastures: Iterable<PastureState>,
    herds: Map<string, LivestockHerdState>,
    buildings: Map<string, BuildingState> = new Map(),
  ): void {
    const previousInput = this.latestInput;
    const nextInput: ReplayableLivestockInput = {
      pastures: [...pastures],
      herds: new Map(herds),
      buildings: new Map(buildings),
    };
    if (previousInput) this.preserveAuthoritativeCullDepartures(previousInput, nextInput);
    this.latestInput = nextInput;
    this.rebuildIfNeeded();
    if (previousInput) this.startAuthoritativeHusbandryTrips(previousInput, nextInput);
  }

  tick(dtSeconds: number, view?: CrowdViewState): void {
    const dt = Math.min(0.08, Math.max(0, dtSeconds));
    const renderEnabled = isAgentAnimalRenderingEnabled(view);
    if (this.root.visible !== renderEnabled) {
      this.root.visible = renderEnabled;
    }
    if (!renderEnabled) return;

    for (const herd of this.herdVisuals.values()) this.tickHerd(herd, dt);

    for (const animal of this.animals) {
      if (animal.workTrip) this.tickWorkTrip(animal, dt);
      else this.tickPastureAnimal(animal, dt);
      const visible = isWithinCrowdView(animal.x, animal.z, view);
      animal.root.visible = visible;
      this.poseAnimal(animal);
      if (visible) animal.mixer.update(dt);
    }

    for (let index = this.departingAnimals.length - 1; index >= 0; index -= 1) {
      const animal = this.departingAnimals[index]!;
      const tripComplete = this.tickWorkTrip(animal, dt);
      const visible = isWithinCrowdView(animal.x, animal.z, view);
      animal.root.visible = visible;
      this.poseAnimal(animal);
      if (visible) animal.mixer.update(dt);
      if (!tripComplete) continue;
      this.departingAnimals.splice(index, 1);
      this.disposeAnimal(animal);
    }
    this.flushAuthoredBatches();
  }

  diagnostics(): Record<string, ReturnType<AuthoredAnimalInstanceBatch['diagnostics']>> {
    return Object.fromEntries(
      [...this.batches].map(([kind, batch]) => [kind, batch.diagnostics()]),
    );
  }

  dispose(): void {
    this.disposed = true;
    this.latestInput = null;
    this.clearAnimals();
    this.clearDepartingAnimals();
    for (const batch of this.batches.values()) batch.dispose();
    this.batches.clear();
    if (this.sources) {
      const scenes = new Set(Object.values(this.sources).map((source) => source.scene));
      for (const scene of scenes) disposeModelResources(scene);
    }
    this.sources = null;
    this.root.removeFromParent();
  }

  private async loadSources(): Promise<void> {
    try {
      const [cow, bull, sheep, swine] = await Promise.all([
        loadAnimalSource(MODEL_URLS.cow, TARGET_HEIGHTS.cow),
        loadAnimalSource(MODEL_URLS.bull, TARGET_HEIGHTS.bull),
        loadAnimalSource(MODEL_URLS.sheep, TARGET_HEIGHTS.sheep),
        loadAnimalSource(MODEL_URLS.swine, TARGET_HEIGHTS.swine),
      ]);
      if (this.disposed) {
        for (const source of [cow, bull, sheep, swine]) disposeModelResources(source.scene);
        return;
      }
      this.sources = { cow, bull, sheep, swine };
      this.createAuthoredBatches();
      this.rebuildIfNeeded(true);
    } catch (error) {
      console.warn('[Livestock] Animated CC0 farm animals failed to load.', error);
    }
  }

  private rebuildIfNeeded(force = false): void {
    if (!this.sources || !this.latestInput) return;
    const signature = buildSignature(this.latestInput);
    if (!force && signature === this.lastSignature) return;
    this.lastSignature = signature;
    this.clearAnimals();

    const pasturesById = new Map(
      this.latestInput.pastures.map((pasture) => [pasture.id, pasture]),
    );

    for (const herd of this.latestInput.herds.values()) {
      const pasture = pasturesById.get(herd.pastureId);
      // Horses are exact persistent entities rendered by VillagerRenderer so
      // the same animal can graze, be collected, mount a rider, and return.
      if (herd.species === 'horses' || !pasture || herd.headCount <= 0) continue;
      const herdVisual = this.createHerdVisual(herd, pasture);
      this.herdVisuals.set(herd.pastureId, herdVisual);
      const visualCount = livestockVisualHeadCount(herd.species, herd.headCount);
      const cattleDistribution = herd.species === 'cattle'
        ? createCattleVisualDistribution(visualCount)
        : null;
      for (let index = 0; index < visualCount; index++) {
        const modelKind = cattleDistribution?.[index] ?? resolveModelKind(herd.species);
        this.addAnimal(herd, pasture, index, modelKind, herdVisual, visualCount);
      }
    }
  }

  private createHerdVisual(
    herd: LivestockHerdState,
    pasture: PastureState,
  ): HerdVisual {
    const random = mulberry32(hashStringSeed(`${herd.pastureId}:herd-motion`));
    const anchor = samplePastureUv(random, HERD_ANCHOR_MARGIN);
    const activity: HerdActivity = random() < 0.58 ? 'rest' : 'graze';
    return {
      id: herd.pastureId,
      species: herd.species,
      pasture,
      animals: [],
      random,
      activity,
      activityTimer: herdActivityDuration(activity, herd.species, random),
      anchorU: anchor.u,
      anchorV: anchor.v,
      targetU: anchor.u,
      targetV: anchor.v,
      velocityU: 0,
      velocityV: 0,
      heading: random() * TAU,
    };
  }

  private addAnimal(
    herd: LivestockHerdState,
    pasture: PastureState,
    index: number,
    modelKind: keyof typeof MODEL_URLS,
    herdVisual: HerdVisual,
    visualCount: number,
  ): void {
    if (!this.sources) return;
    const source = this.sources[modelKind];
    const random = mulberry32(hashStringSeed(`${herd.pastureId}:${modelKind}:${index}`));
    const model = cloneSkinned(source.scene) as THREE.Group;
    const scale = (source.targetHeight / source.sourceHeight) * THREE.MathUtils.lerp(0.9, 1.08, random());
    model.scale.setScalar(scale);
    model.position.y = -source.bounds.min.y * scale + 0.018;
    configureModelMeshes(model);

    const root = new THREE.Group();
    root.name = `${modelKind === 'swine' ? 'Pig' : modelKind[0]!.toUpperCase() + modelKind.slice(1)} in pasture herd ${herd.pastureId}`;
    root.userData.livestockSpecies = herd.species;
    root.userData.herdBuildingId = herd.buildingId;
    root.userData.herdPastureId = herd.pastureId;
    root.add(model);
    setAuthoredAnimalEvaluatorOnly(model, this.batches.has(modelKind));
    this.root.add(root);

    const mixer = new THREE.AnimationMixer(model);
    const actions: Record<MotionMode, THREE.AnimationAction> = {
      idle: mixer.clipAction(source.clips.idle, model),
      graze: mixer.clipAction(source.clips.graze, model),
      walk: mixer.clipAction(source.clips.walk, model),
    };
    for (const action of Object.values(actions)) {
      action.setLoop(THREE.LoopRepeat, Number.POSITIVE_INFINITY);
      action.enabled = true;
    }
    actions.walk.setEffectiveTimeScale(modelKind === 'sheep' || modelKind === 'swine' ? 1.12 : 0.96);

    const uv = formationTargetUv(herdVisual, index, visualCount);
    const point = pasturePointAtUv(pasture, uv.u, uv.v);
    const initialMode: MotionMode = herdVisual.activity === 'graze' && index % 5 !== 0
      ? 'graze'
      : 'idle';
    const visual: AnimalVisual = {
      herdId: herd.pastureId,
      species: herd.species,
      index,
      modelKind,
      root,
      model,
      mixer,
      actions,
      mode: initialMode,
      x: point.x,
      z: point.z,
      u: uv.u,
      v: uv.v,
      velocityU: 0,
      velocityV: 0,
      yaw: random() * TAU,
      speed: herd.species === 'cattle' ? 0.72 : herd.species === 'sheep' ? 0.92 : 0.84,
      pasture,
      workTrip: null,
    };
    actions[initialMode].play();
    actions[initialMode].time = random() * Math.max(0.1, actions[initialMode].getClip().duration);
    root.position.set(point.x, this.getHeightAt(point.x, point.z), point.z);
    root.rotation.y = visual.yaw;
    herdVisual.animals.push(visual);
    this.animals.push(visual);
  }

  private tickHerd(herd: HerdVisual, dt: number): void {
    herd.activityTimer -= dt;
    if (herd.activity === 'move') {
      const stiffness = herd.species === 'sheep' ? 5.8 : herd.species === 'cattle' ? 3.2 : 4.4;
      const damping = herd.species === 'sheep' ? 4.7 : herd.species === 'cattle' ? 3.8 : 4.2;
      herd.velocityU += ((herd.targetU - herd.anchorU) * stiffness - herd.velocityU * damping) * dt;
      herd.velocityV += ((herd.targetV - herd.anchorV) * stiffness - herd.velocityV * damping) * dt;
      herd.anchorU += herd.velocityU * dt;
      herd.anchorV += herd.velocityV * dt;
      const remaining = Math.hypot(herd.targetU - herd.anchorU, herd.targetV - herd.anchorV);
      if (remaining < 0.006 || herd.activityTimer <= 0) {
        herd.anchorU = THREE.MathUtils.clamp(herd.anchorU, HERD_ANCHOR_MARGIN, 1 - HERD_ANCHOR_MARGIN);
        herd.anchorV = THREE.MathUtils.clamp(herd.anchorV, HERD_ANCHOR_MARGIN, 1 - HERD_ANCHOR_MARGIN);
        herd.velocityU = 0;
        herd.velocityV = 0;
        this.setHerdActivity(herd, herd.random() < 0.7 ? 'rest' : 'graze');
      }
      return;
    }

    if (herd.activityTimer > 0) return;
    if (herd.activity === 'rest' && herd.random() < 0.62) {
      this.setHerdActivity(herd, 'graze');
      return;
    }
    this.beginHerdMove(herd);
  }

  private setHerdActivity(herd: HerdVisual, activity: Exclude<HerdActivity, 'move'>): void {
    herd.activity = activity;
    herd.activityTimer = herdActivityDuration(activity, herd.species, herd.random);
  }

  private beginHerdMove(herd: HerdVisual): void {
    const target = samplePastureUv(herd.random, HERD_ANCHOR_MARGIN);
    herd.targetU = target.u;
    herd.targetV = target.v;
    herd.heading = Math.atan2(target.u - herd.anchorU, target.v - herd.anchorV);
    herd.activity = 'move';
    herd.activityTimer = herdActivityDuration('move', herd.species, herd.random);
  }

  private tickPastureAnimal(animal: AnimalVisual, dt: number): void {
    const herd = this.herdVisuals.get(animal.herdId);
    if (!herd) return;
    const target = formationTargetUv(herd, animal.index, herd.animals.length);
    const stiffness = herd.activity === 'move'
      ? animal.species === 'sheep' ? 8.2 : animal.species === 'cattle' ? 4.1 : 5.8
      : animal.species === 'sheep' ? 5.8 : animal.species === 'cattle' ? 2.8 : 4.2;
    const damping = animal.species === 'sheep' ? 5.6 : animal.species === 'cattle' ? 4.4 : 4.8;
    animal.velocityU += ((target.u - animal.u) * stiffness - animal.velocityU * damping) * dt;
    animal.velocityV += ((target.v - animal.v) * stiffness - animal.velocityV * damping) * dt;
    const previousX = animal.x;
    const previousZ = animal.z;
    animal.u = THREE.MathUtils.clamp(animal.u + animal.velocityU * dt, MIN_EDGE_MARGIN, 1 - MIN_EDGE_MARGIN);
    animal.v = THREE.MathUtils.clamp(animal.v + animal.velocityV * dt, MIN_EDGE_MARGIN, 1 - MIN_EDGE_MARGIN);
    const point = pasturePointAtUv(animal.pasture, animal.u, animal.v);
    animal.x = point.x;
    animal.z = point.z;
    const dx = animal.x - previousX;
    const dz = animal.z - previousZ;
    const planarSpeed = dt > 1e-6 ? Math.hypot(dx, dz) / dt : 0;
    if (planarSpeed > 0.14) {
      this.transition(animal, 'walk');
      animal.yaw = dampAngle(animal.yaw, Math.atan2(dx, dz), 8, dt);
    } else if (herd.activity === 'graze' && animal.index % 5 !== 0) {
      this.transition(animal, 'graze');
    } else {
      this.transition(animal, 'idle');
    }
  }

  private preserveAuthoritativeCullDepartures(
    previous: ReplayableLivestockInput,
    current: ReplayableLivestockInput,
  ): void {
    for (const herd of current.herds.values()) {
      const prior = previous.herds.get(herd.pastureId);
      const building = current.buildings.get(herd.buildingId);
      if (!prior || !isStaffedHusbandryBuilding(building)) continue;
      const culledHeads = livestockCullDepartureCount(
        prior,
        herd,
        previous.buildings.get(prior.buildingId),
        building,
      );
      if (culledHeads <= 0) continue;
      const pastureHerd = this.herdVisuals.get(herd.pastureId);
      const pasture = current.pastures.find((candidate) => candidate.id === herd.pastureId);
      if (!pastureHerd || !pasture || !building) continue;
      const candidates = pastureHerd.animals.filter((animal) => animal.workTrip === null);
      for (let index = 0; index < Math.min(culledHeads, candidates.length); index += 1) {
        const animal = candidates[candidates.length - 1 - index]!;
        removeArrayItem(this.animals, animal);
        removeArrayItem(pastureHerd.animals, animal);
        this.beginWorkTrip(animal, pasture, building, 'culling', index * 0.55, true);
        this.departingAnimals.push(animal);
      }
    }
  }

  private startAuthoritativeHusbandryTrips(
    previous: ReplayableLivestockInput,
    current: ReplayableLivestockInput,
  ): void {
    const pasturesById = new Map(current.pastures.map((pasture) => [pasture.id, pasture]));
    for (const herd of current.herds.values()) {
      const prior = previous.herds.get(herd.pastureId);
      const building = current.buildings.get(herd.buildingId);
      const pasture = pasturesById.get(herd.pastureId);
      if (!prior || !pasture || !isStaffedHusbandryBuilding(building) || !building) continue;
      if (
        herd.species === 'sheep'
        && (herd.lastShearingYear ?? 0) > (prior.lastShearingYear ?? 0)
      ) {
        this.startHerdService(herd.pastureId, pasture, building, 'shearing');
      }
      if (
        herd.species === 'cattle'
        && (herd.lastMilkingPeriod ?? 0) > (prior.lastMilkingPeriod ?? 0)
      ) {
        this.startHerdService(herd.pastureId, pasture, building, 'milking');
      }
    }
  }

  private startHerdService(
    herdId: string,
    pasture: PastureState,
    building: BuildingState,
    service: Exclude<LivestockWorkService, 'culling'>,
  ): void {
    const herd = this.herdVisuals.get(herdId);
    if (!herd) return;
    const animals = herd.animals.filter((animal) => (
      animal.workTrip === null
      && (service !== 'milking' || animal.modelKind === 'cow')
    ));
    const stagger = service === 'shearing' ? 0.16 : 0.48;
    animals.forEach((animal, index) => {
      this.beginWorkTrip(animal, pasture, building, service, index * stagger, false);
    });
  }

  private beginWorkTrip(
    animal: AnimalVisual,
    pasture: PastureState,
    building: BuildingState,
    service: LivestockWorkService,
    delaySeconds: number,
    removeOnArrival: boolean,
  ): void {
    const destination = { x: building.x, z: building.z };
    const path = pastureGateWaypoints(pasture, { x: animal.x, z: animal.z }, destination);
    animal.workTrip = {
      service,
      phase: 'outbound',
      path,
      returnPath: [...path].reverse(),
      waypointIndex: 1,
      delaySeconds,
      serviceSeconds: service === 'shearing' ? 5.2 : service === 'milking' ? 3.8 : 0,
      homeU: animal.u,
      homeV: animal.v,
      removeOnArrival,
    };
    animal.root.userData.livestockWorkService = service;
  }

  /** Returns true when a one-way cull trip has reached the staffed holding. */
  private tickWorkTrip(animal: AnimalVisual, dt: number): boolean {
    const trip = animal.workTrip;
    if (!trip) return false;
    if (trip.delaySeconds > 0) {
      trip.delaySeconds = Math.max(0, trip.delaySeconds - dt);
      this.transition(animal, 'idle');
      return false;
    }
    if (trip.phase === 'service') {
      trip.serviceSeconds -= dt;
      this.transition(animal, 'idle');
      if (trip.serviceSeconds > 0) return false;
      trip.phase = 'return';
      trip.path = trip.returnPath;
      trip.waypointIndex = 1;
      return false;
    }

    const target = trip.path[trip.waypointIndex];
    if (!target) {
      if (trip.phase === 'outbound' && trip.removeOnArrival) return true;
      if (trip.phase === 'outbound') {
        trip.phase = 'service';
        return false;
      }
      animal.u = trip.homeU;
      animal.v = trip.homeV;
      animal.velocityU = 0;
      animal.velocityV = 0;
      animal.workTrip = null;
      delete animal.root.userData.livestockWorkService;
      this.transition(animal, 'idle');
      return false;
    }
    const dx = target.x - animal.x;
    const dz = target.z - animal.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= 0.08) {
      animal.x = target.x;
      animal.z = target.z;
      trip.waypointIndex += 1;
      return false;
    }
    const step = Math.min(distance, animal.speed * dt);
    animal.x += dx / distance * step;
    animal.z += dz / distance * step;
    animal.yaw = dampAngle(animal.yaw, Math.atan2(dx, dz), 10, dt);
    this.transition(animal, 'walk');
    return false;
  }

  private poseAnimal(animal: AnimalVisual): void {
    animal.root.position.set(
      animal.x,
      this.getHeightAt(animal.x, animal.z),
      animal.z,
    );
    animal.root.rotation.y = animal.yaw;
  }

  private transition(animal: AnimalVisual, nextMode: MotionMode): void {
    if (animal.mode === nextMode) return;
    animal.actions[animal.mode].fadeOut(0.24);
    animal.actions[nextMode].reset().fadeIn(0.24).play();
    animal.mode = nextMode;
  }

  private clearAnimals(): void {
    for (const animal of this.animals) {
      this.disposeAnimal(animal);
    }
    this.animals.length = 0;
    this.herdVisuals.clear();
  }

  private clearDepartingAnimals(): void {
    for (const animal of this.departingAnimals) this.disposeAnimal(animal);
    this.departingAnimals.length = 0;
  }

  private disposeAnimal(animal: AnimalVisual): void {
    animal.mixer.stopAllAction();
    animal.mixer.uncacheRoot(animal.model);
    animal.root.removeFromParent();
  }

  private createAuthoredBatches(): void {
    if (!this.sources) return;
    const initialCapacity: Record<keyof typeof MODEL_URLS, number> = {
      cow: 64,
      bull: 16,
      sheep: 128,
      swine: 64,
    };
    for (const kind of Object.keys(MODEL_URLS) as Array<keyof typeof MODEL_URLS>) {
      try {
        this.batches.set(kind, new AuthoredAnimalInstanceBatch({
          parent: this.root,
          sourceRoot: this.sources[kind].scene,
          capacity: initialCapacity[kind],
          name: `${kind} exact-model livestock instances`,
        }));
      } catch (error) {
        // Keep the same authored clone visible if a future asset has geometry
        // the exact palette batch cannot yet express. Never substitute a proxy.
        console.warn(`[Livestock] ${kind} exact-model batching unavailable.`, error);
      }
    }
  }

  private flushAuthoredBatches(): void {
    const candidates = [...this.animals, ...this.departingAnimals];
    for (const [kind, batch] of this.batches) {
      const visible = candidates.filter(
        (animal) => animal.modelKind === kind && animal.root.visible,
      );
      batch.beginFrame(visible.length);
      for (const animal of visible) batch.submit(animal.model);
      batch.endFrame();
    }
  }
}

function buildSignature(input: ReplayableLivestockInput): string {
  const herds = [...input.herds.values()]
    .sort((a, b) => a.pastureId.localeCompare(b.pastureId))
    .map((herd) => `${herd.pastureId}:${herd.buildingId}:${herd.species}:${herd.headCount}`)
    .join('|');
  const pastures = [...input.pastures]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((pasture) => `${pasture.id}:${pasture.farmsteadId}:${pasture.corners.map((corner) => `${corner.x.toFixed(1)},${corner.z.toFixed(1)}`).join(';')}`)
    .join('|');
  return `${herds}#${pastures}`;
}

function resolveModelKind(
  species: LivestockSpecies,
): keyof typeof MODEL_URLS {
  if (species === 'sheep') return 'sheep';
  if (species === 'swine') return 'swine';
  return 'cow';
}

/**
 * Stable species-specific formation slot. Sheep pack tightly around the flock
 * center; cattle keep broader personal space and therefore read as a loose
 * herd instead of a woolly flock with a different model.
 */
export function livestockHerdFormationOffsetMeters(
  species: LivestockSpecies,
  index: number,
  count: number,
): PointXZ {
  const safeCount = Math.max(1, Math.floor(count));
  const safeIndex = THREE.MathUtils.clamp(Math.floor(index), 0, safeCount - 1);
  const spacing = species === 'sheep' ? 0.56 : species === 'cattle' ? 1.38 : 0.78;
  const radius = Math.sqrt(safeIndex + 0.42) * spacing;
  const angle = safeIndex * GOLDEN_ANGLE + (species === 'cattle' ? 0.46 : species === 'swine' ? 0.92 : 0);
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
}

/**
 * The only authored route out of a pasture: inside approach, centered gate,
 * outside release, then the staffed husbandry building.
 */
export function pastureGateWaypoints(
  pasture: PastureState,
  start: PointXZ,
  destination: PointXZ,
): PointXZ[] {
  const [a, b] = pasture.corners;
  const gate = {
    x: (a.x + b.x) * 0.5,
    z: (a.z + b.z) * 0.5,
  };
  const center = pasturePointAtUv(pasture, 0.5, 0.5);
  const centerDx = center.x - gate.x;
  const centerDz = center.z - gate.z;
  const centerDistance = Math.max(1e-6, Math.hypot(centerDx, centerDz));
  const inwardX = centerDx / centerDistance;
  const inwardZ = centerDz / centerDistance;
  return [
    { ...start },
    {
      x: gate.x + inwardX * WORK_GATE_OFFSET_M,
      z: gate.z + inwardZ * WORK_GATE_OFFSET_M,
    },
    gate,
    {
      x: gate.x - inwardX * WORK_GATE_OFFSET_M,
      z: gate.z - inwardZ * WORK_GATE_OFFSET_M,
    },
    { ...destination },
  ];
}

/**
 * Distinguishes a simulated autumn cull from a player sale. `lastCulled` is a
 * per-cycle result rather than a monotonic counter, so consecutive one-head
 * culls are confirmed by their recorded output or the physical store receipt.
 */
export function livestockCullDepartureCount(
  previous: Pick<LivestockHerdState, 'headCount' | 'lastCulled' | 'lastFoodOutput' | 'lastPreservedOutput'>,
  current: Pick<LivestockHerdState, 'headCount' | 'lastCulled' | 'lastFoodOutput' | 'lastPreservedOutput'>,
  previousBuilding?: Pick<BuildingState, 'meat' | 'preservedFood' | 'hides'>,
  currentBuilding?: Pick<BuildingState, 'meat' | 'preservedFood' | 'hides'>,
): number {
  const removedHeads = Math.max(0, previous.headCount - current.headCount);
  const reportedCull = Math.max(0, current.lastCulled);
  if (removedHeads <= 0 || reportedCull <= 0) return 0;
  const cullMarkerChanged = current.lastCulled !== previous.lastCulled;
  const cycleOutputChanged = (
    current.lastFoodOutput !== previous.lastFoodOutput
    || current.lastPreservedOutput !== previous.lastPreservedOutput
  );
  const physicalOutputArrived = Boolean(previousBuilding && currentBuilding && (
    (currentBuilding.meat ?? 0) > (previousBuilding.meat ?? 0)
    || currentBuilding.preservedFood > previousBuilding.preservedFood
    || (currentBuilding.hides ?? 0) > (previousBuilding.hides ?? 0)
  ));
  return cullMarkerChanged || cycleOutputChanged || physicalOutputArrived
    ? Math.min(removedHeads, reportedCull)
    : 0;
}

function samplePastureUv(
  random: () => number,
  margin = MIN_EDGE_MARGIN,
): { u: number; v: number } {
  return {
    u: THREE.MathUtils.lerp(margin, 1 - margin, random()),
    v: THREE.MathUtils.lerp(margin, 1 - margin, random()),
  };
}

function pasturePointAtUv(
  pasture: PastureState,
  u: number,
  v: number,
): PointXZ {
  const [a, b, c, d] = pasture.corners;
  const nearX = THREE.MathUtils.lerp(a.x, b.x, u);
  const nearZ = THREE.MathUtils.lerp(a.z, b.z, u);
  const farX = THREE.MathUtils.lerp(d.x, c.x, u);
  const farZ = THREE.MathUtils.lerp(d.z, c.z, u);
  return {
    x: THREE.MathUtils.lerp(nearX, farX, v),
    z: THREE.MathUtils.lerp(nearZ, farZ, v),
  };
}

function formationTargetUv(
  herd: HerdVisual,
  index: number,
  count: number,
): { u: number; v: number } {
  const offset = livestockHerdFormationOffsetMeters(herd.species, index, count);
  const [a, b, c] = herd.pasture.corners;
  const width = Math.max(1, Math.hypot(b.x - a.x, b.z - a.z));
  const depth = Math.max(1, Math.hypot(c.x - b.x, c.z - b.z));
  const cos = Math.cos(herd.heading);
  const sin = Math.sin(herd.heading);
  const offsetU = (offset.x * cos - offset.z * sin) / width;
  const offsetV = (offset.x * sin + offset.z * cos) / depth;
  return {
    u: THREE.MathUtils.clamp(herd.anchorU + offsetU, MIN_EDGE_MARGIN, 1 - MIN_EDGE_MARGIN),
    v: THREE.MathUtils.clamp(herd.anchorV + offsetV, MIN_EDGE_MARGIN, 1 - MIN_EDGE_MARGIN),
  };
}

function herdActivityDuration(
  activity: HerdActivity,
  species: LivestockSpecies,
  random: () => number,
): number {
  if (activity === 'move') {
    return species === 'cattle' ? 7 + random() * 7 : 5 + random() * 6;
  }
  if (activity === 'rest') {
    return species === 'cattle' ? 16 + random() * 22 : 12 + random() * 18;
  }
  return species === 'sheep' ? 12 + random() * 18 : 10 + random() * 16;
}

function isStaffedHusbandryBuilding(
  building: BuildingState | undefined,
): building is BuildingState {
  return building?.constructionComplete === true
    && building.assignedLabor > 0
    && (building.kind === 'pastoral_farmstead' || building.kind === 'swineherd');
}

function dampAngle(current: number, target: number, response: number, dt: number): number {
  let delta = (target - current + Math.PI) % TAU - Math.PI;
  if (delta < -Math.PI) delta += TAU;
  return current + delta * (1 - Math.exp(-response * dt));
}

function removeArrayItem<T>(items: T[], item: T): void {
  const index = items.indexOf(item);
  if (index >= 0) items.splice(index, 1);
}

async function loadAnimalSource(url: string, targetHeight: number): Promise<AnimalSource> {
  const gltf = await new GLTFLoader().loadAsync(url);
  const bounds = new THREE.Box3().setFromObject(gltf.scene);
  const sourceHeight = bounds.max.y - bounds.min.y;
  if (!Number.isFinite(sourceHeight) || sourceHeight <= 0.001) {
    throw new Error(`Invalid livestock model bounds for ${url}`);
  }
  return {
    scene: gltf.scene,
    bounds,
    sourceHeight,
    targetHeight,
    clips: resolveAnimationClips(gltf.animations, url),
  };
}

function resolveAnimationClips(
  animations: ReadonlyArray<THREE.AnimationClip>,
  url: string,
): AnimalSource['clips'] {
  const findClip = (...names: string[]): THREE.AnimationClip | undefined => animations.find((clip) => {
    const normalized = clip.name.toLowerCase();
    return names.some((name) => normalized === name || normalized.endsWith(`|${name}`));
  });
  const idle = findClip('idle', 'idle_1');
  const graze = findClip('eating', 'idle_eating', 'idle_headlow') ?? idle;
  const walk = findClip('walk');
  if (!idle || !graze || !walk) throw new Error(`Missing idle/graze/walk clips in ${url}`);
  return { idle, graze, walk };
}

function configureModelMeshes(model: THREE.Object3D): void {
  model.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
  });
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
