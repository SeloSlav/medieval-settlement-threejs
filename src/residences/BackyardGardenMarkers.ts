import * as THREE from 'three';
import { backyardGardenPlacement } from './backyardPosition.ts';
import {
  createBackyardChickenModel,
  disposeBackyardChickenSource,
  loadBackyardChickenSource,
  type BackyardChickenSource,
} from './backyardChickenAssets.ts';
import {
  createBackyardGoatModel,
  disposeBackyardGoatModel,
  disposeBackyardGoatSource,
  loadBackyardGoatSource,
  type BackyardGoatSource,
} from './backyardGoatAssets.ts';
import {
  createBackyardPigModel,
  disposeBackyardPigSource,
  loadBackyardPigSource,
  type BackyardPigSource,
} from './backyardPigAssets.ts';
import {
  animateBackyardGardenMesh,
  conformBackyardGroundSoilToTerrain,
  createBackyardGardenMesh,
  disposeBackyardGardenMesh,
  syncBackyardGardenSeasonVisuals,
} from './backyardGardenMesh.ts';
import {
  animateBackyardConstructionMesh,
  createBackyardConstructionMesh,
  disposeBackyardConstructionMesh,
  syncBackyardConstructionProgress,
} from './backyardConstructionMesh.ts';
import type { BackyardGardenState, BurgageZoneState, ResidenceState } from '../resources/types.ts';
import {
  BACKYARD_GARDEN_KINDS,
  type BackyardGardenKind,
} from '../generated/gameBalance.ts';
import { hashStringSeed, mulberry32 } from '../utils/random.ts';
import type { BackyardPlantCatalog } from '../vegetation/seedthree/backyardPlantAssets.ts';
import type { CrowdViewState } from '../settlement/crowdView.ts';
import { isWithinAnimalCrowdView } from '../settlement/crowdView.ts';
import type { DeciduousFoliagePresentation } from '../world/deciduousFoliagePolicy.ts';
import {
  AuthoredAnimalInstanceBatch,
  setAuthoredAnimalEvaluatorOnly,
} from '../scene/AuthoredAnimalInstanceBatch.ts';

type ChickenVisual = {
  root: THREE.Group;
  model: THREE.Group;
  mixer: THREE.AnimationMixer;
  idle: THREE.AnimationAction;
  walk: THREE.AnimationAction;
  walking: boolean;
  timer: number;
  x: number;
  z: number;
  targetX: number;
  targetZ: number;
  width: number;
  depth: number;
  random: () => number;
};

type GoatVisual = {
  root: THREE.Group;
  model: THREE.Group;
  mixer: THREE.AnimationMixer;
  idle: THREE.AnimationAction;
  graze: THREE.AnimationAction;
  grazing: boolean;
  timer: number;
  random: () => number;
};

type PigVisual = GoatVisual;

type GardenSyncInput = {
  residences: Iterable<ResidenceState>;
  zones: Iterable<BurgageZoneState>;
  gardens: Map<string, BackyardGardenState>;
  month?: number;
  totalDays?: number;
  getHeightAt: (x: number, z: number) => number;
};

type BackyardGardenMarkerOptions = {
  maxAnisotropy?: number;
  useSeedThree?: boolean;
};

type ReplayableGardenSyncInput = Omit<GardenSyncInput, 'residences' | 'zones'> & {
  residences: ResidenceState[];
  zones: BurgageZoneState[];
};

export class BackyardGardenMarkers {
  private readonly root = new THREE.Group();
  private readonly meshes = new Map<string, THREE.Group>();
  private readonly chickens = new Map<string, ChickenVisual[]>();
  private readonly goats = new Map<string, GoatVisual[]>();
  private readonly pigs = new Map<string, PigVisual[]>();
  private plants: BackyardPlantCatalog | null = null;
  private chickenSource: BackyardChickenSource | null = null;
  private goatSource: BackyardGoatSource | null = null;
  private pigSource: BackyardPigSource | null = null;
  private chickenBatch: AuthoredAnimalInstanceBatch | null = null;
  private goatBatch: AuthoredAnimalInstanceBatch | null = null;
  private pigBatch: AuthoredAnimalInstanceBatch | null = null;
  private latestInput: ReplayableGardenSyncInput | null = null;
  private deciduousFoliage: DeciduousFoliagePresentation | null = null;
  private animationElapsedSeconds = 0;
  private disposed = false;

  constructor(parent: THREE.Group, options: BackyardGardenMarkerOptions = {}) {
    this.root.name = 'Backyard gardens';
    parent.add(this.root);

    void loadBackyardChickenSource().then(
      (source) => {
        if (this.disposed) {
          disposeBackyardChickenSource(source.scene);
          return;
        }
        this.chickenSource = source;
        this.chickenBatch = this.createAnimalBatch(
          source.scene,
          'Backyard hen exact-model instances',
        );
        if (this.latestInput) this.syncReplayable(this.latestInput, true);
      },
      (error: unknown) => {
        console.warn('[Livestock] Animated hen-yard asset failed to load; the pen remains empty.', error);
      },
    );

    void loadBackyardGoatSource().then(
      (source) => {
        if (this.disposed) {
          disposeBackyardGoatSource(source.scene);
          return;
        }
        this.goatSource = source;
        this.goatBatch = this.createAnimalBatch(
          source.scene,
          'Backyard small-ruminant exact-model instances',
        );
        if (this.latestInput) this.syncReplayable(this.latestInput, true);
      },
      (error: unknown) => {
        console.warn('[Livestock] Sheep-derived CC0 goat visual failed to load; the pen remains empty.', error);
      },
    );

    void loadBackyardPigSource().then(
      (source) => {
        if (this.disposed) {
          disposeBackyardPigSource(source.scene);
          return;
        }
        this.pigSource = source;
        this.pigBatch = this.createAnimalBatch(
          source.scene,
          'Backyard pig exact-model instances',
        );
        if (this.latestInput) this.syncReplayable(this.latestInput, true);
      },
      (error: unknown) => {
        console.warn('[Livestock] Animated pig asset failed to load; the pen remains empty.', error);
      },
    );

    if (options.useSeedThree) {
      void import('../vegetation/seedthree/backyardPlantAssets.ts').then(
        ({ loadBackyardPlantCatalog }) => loadBackyardPlantCatalog(options.maxAnisotropy ?? 4),
      ).then(
        (plants) => {
          if (this.disposed) return;
          this.plants = plants;
          if (this.latestInput) this.syncReplayable(this.latestInput);
        },
        (error: unknown) => {
          console.warn('[SeedThree] backyard plant assets failed to load; tree vegetation will remain hidden.', error);
        },
      );
    }
  }

  syncGardens(input: GardenSyncInput): void {
    const replayable: ReplayableGardenSyncInput = {
      ...input,
      residences: Array.from(input.residences),
      zones: Array.from(input.zones),
    };
    this.latestInput = replayable;
    this.syncReplayable(replayable);
  }

  setDeciduousFoliage(presentation: DeciduousFoliagePresentation): void {
    this.deciduousFoliage = { ...presentation };
    const month = this.latestInput?.month ?? 1;
    for (const marker of this.meshes.values()) {
      if (marker.userData.backyardConstructionSite === true) continue;
      syncBackyardGardenSeasonVisuals(
        marker,
        marker.userData.gardenKind as BackyardGardenState['kind'],
        month,
        this.deciduousFoliage,
        Math.max(
          0,
          Number(marker.userData.firstHarvestDay ?? 0) - (this.latestInput?.totalDays ?? 0),
        ),
      );
    }
  }

  private syncReplayable(input: ReplayableGardenSyncInput, force = false): void {
    const zonesById = new Map<string, BurgageZoneState>();
    for (const zone of input.zones) {
      zonesById.set(zone.id, zone);
    }

    const nextIds = new Set<string>();
    for (const residence of input.residences) {
      const garden = input.gardens.get(residence.id);
      const projectKind = backyardProjectKind(residence);
      if (!garden && !projectKind) continue;

      const zone = zonesById.get(residence.zoneId);
      if (!zone) continue;

      const placement = backyardGardenPlacement(residence, zone);
      if (!placement) continue;

      nextIds.add(residence.id);
      let marker = this.meshes.get(residence.id);
      const kind = projectKind ?? garden!.kind;
      const projectActive = projectKind !== null;
      const visualKey = [
        projectActive ? 'construction' : 'complete',
        kind,
        placement.width.toFixed(2),
        placement.depth.toFixed(2),
        ...(projectActive
          ? []
          : [
              this.plants ? 'seedthree' : 'vegetation-pending',
              this.chickenSource ? 'authored-hens-ready' : 'authored-hens-pending',
              this.goatSource ? 'authored-goats-ready' : 'authored-goats-pending',
              this.pigSource ? 'authored-pigs-ready' : 'authored-pigs-pending',
              garden!.flowerLuxuryUpgraded ? 'luxury-flowers' : 'ordinary-flowers',
            ]),
      ].join(':');
      if ((force && !projectActive) || !marker || marker.userData.visualKey !== visualKey) {
        if (marker) {
          this.disposeChickens(residence.id);
          this.disposeGoats(residence.id);
          this.disposePigs(residence.id);
          this.root.remove(marker);
          disposeBackyardMarker(marker);
        }
        marker = projectActive
          ? createBackyardConstructionMesh(kind, {
              width: placement.width,
              depth: placement.depth,
              seed: hashStringSeed(residence.id),
            })
          : createBackyardGardenMesh(kind, {
              width: placement.width,
              depth: placement.depth,
              seed: hashStringSeed(residence.id),
              plants: this.plants,
              flowerLuxuryUpgraded: garden!.flowerLuxuryUpgraded,
            });
        marker.userData.visualKey = visualKey;
        this.root.add(marker);
        this.meshes.set(residence.id, marker);
        if (!projectActive && kind === 'chicken_pen' && this.chickenSource) {
          this.attachAnimatedChickens(
            residence.id,
            marker,
            placement.width,
            placement.depth,
            hashStringSeed(residence.id),
          );
        }
        if (!projectActive && kind === 'goat_pen' && this.goatSource) {
          this.attachAnimatedGoats(
            residence.id,
            marker,
            placement.width,
            placement.depth,
            hashStringSeed(residence.id),
          );
        }
        if (!projectActive && kind === 'pig_pen' && this.pigSource) {
          this.attachAnimatedPigs(
            residence.id,
            marker,
            placement.width,
            placement.depth,
            hashStringSeed(residence.id),
          );
        }
      }

      const y = input.getHeightAt(placement.x, placement.z);
      marker.position.set(placement.x, y, placement.z);
      marker.rotation.y = placement.yaw;
      if (projectActive) {
        syncBackyardConstructionProgress(marker, backyardConstructionProgress(residence));
      } else {
        marker.userData.firstHarvestDay = garden!.firstHarvestDay;
        const terrainConformanceKey = [
          placement.x.toFixed(3),
          y.toFixed(3),
          placement.z.toFixed(3),
          placement.yaw.toFixed(4),
        ].join(':');
        if (marker.userData.terrainConformanceKey !== terrainConformanceKey) {
          conformBackyardGroundSoilToTerrain(marker, input.getHeightAt);
          marker.userData.terrainConformanceKey = terrainConformanceKey;
        }
        syncBackyardGardenSeasonVisuals(
          marker,
          kind,
          input.month ?? 1,
          this.deciduousFoliage ?? undefined,
          Math.max(0, garden!.firstHarvestDay - (input.totalDays ?? 0)),
        );
      }
    }

    for (const [id, marker] of this.meshes) {
      if (nextIds.has(id)) continue;
      this.root.remove(marker);
      this.disposeChickens(id);
      this.disposeGoats(id);
      this.disposePigs(id);
      disposeBackyardMarker(marker);
      this.meshes.delete(id);
    }
  }

  tick(dtSeconds: number, view?: CrowdViewState): void {
    const dt = Math.min(0.08, Math.max(0, dtSeconds));
    this.animationElapsedSeconds += dt;
    for (const marker of this.meshes.values()) {
      if (marker.userData.backyardConstructionSite === true) {
        animateBackyardConstructionMesh(marker, this.animationElapsedSeconds);
      } else {
        animateBackyardGardenMesh(marker, this.animationElapsedSeconds);
      }
    }
    for (const [residenceId, visuals] of this.chickens) {
      const marker = this.meshes.get(residenceId);
      if (!marker) continue;
      const visible = isWithinAnimalCrowdView(marker.position.x, marker.position.z, view);
      for (const chicken of visuals) {
        chicken.root.visible = visible;
        if (!visible) continue;
        chicken.timer -= dt;
        if (chicken.timer <= 0) {
          if (chicken.walking || chicken.random() < 0.54) {
            chicken.walk.fadeOut(0.18);
            chicken.idle.reset().fadeIn(0.18).play();
            chicken.walking = false;
            chicken.timer = 1.5 + chicken.random() * 4;
          } else {
            const point = sampleChickenPoint(chicken.width, chicken.depth, chicken.random);
            chicken.targetX = point.x;
            chicken.targetZ = point.z;
            chicken.idle.fadeOut(0.18);
            chicken.walk.reset().fadeIn(0.18).play();
            chicken.walking = true;
            chicken.timer = 2 + chicken.random() * 4;
          }
        }
        if (chicken.walking) {
          const dx = chicken.targetX - chicken.x;
          const dz = chicken.targetZ - chicken.z;
          const distance = Math.hypot(dx, dz);
          if (distance < 0.08) {
            chicken.timer = 0;
          } else {
            const step = Math.min(distance, dt * 0.48);
            chicken.x += (dx / distance) * step;
            chicken.z += (dz / distance) * step;
            chicken.root.rotation.y = Math.atan2(dx, dz);
          }
        }
        chicken.root.position.set(chicken.x, 0, chicken.z);
        chicken.mixer.update(dt);
      }
    }
    for (const [residenceId, visuals] of this.goats) {
      const marker = this.meshes.get(residenceId);
      if (!marker) continue;
      const visible = isWithinAnimalCrowdView(marker.position.x, marker.position.z, view);
      for (const goat of visuals) {
        goat.root.visible = visible;
        if (!visible) continue;
        goat.timer -= dt;
        if (goat.timer <= 0) {
          const next = goat.grazing ? goat.idle : goat.graze;
          const previous = goat.grazing ? goat.graze : goat.idle;
          previous.fadeOut(0.25);
          next.reset().fadeIn(0.25).play();
          goat.grazing = !goat.grazing;
          goat.timer = 2.5 + goat.random() * 6;
        }
        goat.mixer.update(dt);
      }
    }
    for (const [residenceId, visuals] of this.pigs) {
      const marker = this.meshes.get(residenceId);
      if (!marker) continue;
      const visible = isWithinAnimalCrowdView(marker.position.x, marker.position.z, view);
      for (const pig of visuals) {
        pig.root.visible = visible;
        if (!visible) continue;
        pig.timer -= dt;
        if (pig.timer <= 0) {
          const next = pig.grazing ? pig.idle : pig.graze;
          const previous = pig.grazing ? pig.graze : pig.idle;
          previous.fadeOut(0.25);
          next.reset().fadeIn(0.25).play();
          pig.grazing = !pig.grazing;
          pig.timer = 2.5 + pig.random() * 6;
        }
        pig.mixer.update(dt);
      }
    }
    this.flushAuthoredBatches();
  }

  private attachAnimatedChickens(
    residenceId: string,
    marker: THREE.Group,
    width: number,
    depth: number,
    seed: number,
  ): void {
    if (!this.chickenSource) return;
    const count = Math.max(3, Math.min(6, Math.round(width * depth / 6)));
    const visuals: ChickenVisual[] = [];
    for (let index = 0; index < count; index++) {
      const random = mulberry32(seed ^ Math.imul(index + 1, 0x45d9f3b));
      const model = createBackyardChickenModel(
        this.chickenSource,
        0.45 * THREE.MathUtils.lerp(0.88, 1.08, random()),
      );
      const root = new THREE.Group();
      root.name = 'Rigged roaming hen';
      root.add(model);
      setAuthoredAnimalEvaluatorOnly(model, this.chickenBatch !== null);
      marker.add(root);
      const mixer = new THREE.AnimationMixer(model);
      const idle = mixer.clipAction(this.chickenSource.idle, model);
      const walk = mixer.clipAction(this.chickenSource.walk, model);
      idle.setLoop(THREE.LoopRepeat, Number.POSITIVE_INFINITY);
      walk.setLoop(THREE.LoopRepeat, Number.POSITIVE_INFINITY);
      walk.setEffectiveTimeScale(1.1);
      const walking = index % 3 === 0;
      (walking ? walk : idle).play();
      const point = sampleChickenPoint(width, depth, random);
      const target = sampleChickenPoint(width, depth, random);
      root.position.set(point.x, 0, point.z);
      root.rotation.y = random() * Math.PI * 2;
      visuals.push({
        root,
        model,
        mixer,
        idle,
        walk,
        walking,
        timer: 1 + random() * 4,
        x: point.x,
        z: point.z,
        targetX: target.x,
        targetZ: target.z,
        width,
        depth,
        random,
      });
    }
    this.chickens.set(residenceId, visuals);
  }

  private disposeChickens(residenceId: string): void {
    const visuals = this.chickens.get(residenceId);
    if (!visuals) return;
    for (const chicken of visuals) {
      chicken.mixer.stopAllAction();
      chicken.mixer.uncacheRoot(chicken.model);
      chicken.root.removeFromParent();
    }
    this.chickens.delete(residenceId);
  }

  private attachAnimatedGoats(
    residenceId: string,
    marker: THREE.Group,
    width: number,
    depth: number,
    seed: number,
  ): void {
    if (!this.goatSource) return;
    const visuals: GoatVisual[] = [];
    for (let index = 0; index < 3; index++) {
      const random = mulberry32(seed ^ Math.imul(index + 1, 0x27d4eb2d));
      const model = createBackyardGoatModel(
        this.goatSource,
        0.86 * THREE.MathUtils.lerp(0.9, 1.08, random()),
      );
      const root = new THREE.Group();
      root.name = 'Rigged backyard goat';
      root.position.set(
        THREE.MathUtils.lerp(-width * 0.18, width * 0.32, random()),
        0,
        THREE.MathUtils.lerp(-depth * 0.08, depth * 0.3, random()),
      );
      root.rotation.y = random() * Math.PI * 2;
      root.add(model);
      setAuthoredAnimalEvaluatorOnly(model, this.goatBatch !== null);
      marker.add(root);
      const mixer = new THREE.AnimationMixer(model);
      const idle = mixer.clipAction(this.goatSource.idle, model);
      const graze = mixer.clipAction(this.goatSource.graze, model);
      idle.setLoop(THREE.LoopRepeat, Number.POSITIVE_INFINITY);
      graze.setLoop(THREE.LoopRepeat, Number.POSITIVE_INFINITY);
      const grazing = index !== 0;
      (grazing ? graze : idle).play();
      visuals.push({ root, model, mixer, idle, graze, grazing, timer: 2 + random() * 5, random });
    }
    this.goats.set(residenceId, visuals);
  }

  private disposeGoats(residenceId: string): void {
    const visuals = this.goats.get(residenceId);
    if (!visuals) return;
    for (const goat of visuals) {
      goat.mixer.stopAllAction();
      goat.mixer.uncacheRoot(goat.model);
      goat.root.removeFromParent();
      disposeBackyardGoatModel(goat.model);
    }
    this.goats.delete(residenceId);
  }

  private attachAnimatedPigs(
    residenceId: string,
    marker: THREE.Group,
    width: number,
    depth: number,
    seed: number,
  ): void {
    if (!this.pigSource) return;
    const visuals: PigVisual[] = [];
    for (let index = 0; index < 3; index++) {
      const random = mulberry32(seed ^ Math.imul(index + 1, 0x165667b1));
      const model = createBackyardPigModel(
        this.pigSource,
        0.72 * THREE.MathUtils.lerp(0.9, 1.08, random()),
      );
      const root = new THREE.Group();
      root.name = 'Rigged backyard pig';
      root.position.set(
        THREE.MathUtils.lerp(-width * 0.16, width * 0.32, random()),
        0,
        THREE.MathUtils.lerp(-depth * 0.04, depth * 0.31, random()),
      );
      root.rotation.y = random() * Math.PI * 2;
      root.add(model);
      setAuthoredAnimalEvaluatorOnly(model, this.pigBatch !== null);
      marker.add(root);
      const mixer = new THREE.AnimationMixer(model);
      const idle = mixer.clipAction(this.pigSource.idle, model);
      const graze = mixer.clipAction(this.pigSource.graze, model);
      idle.setLoop(THREE.LoopRepeat, Number.POSITIVE_INFINITY);
      graze.setLoop(THREE.LoopRepeat, Number.POSITIVE_INFINITY);
      const grazing = index !== 0;
      (grazing ? graze : idle).play();
      visuals.push({ root, model, mixer, idle, graze, grazing, timer: 2 + random() * 5, random });
    }
    this.pigs.set(residenceId, visuals);
  }

  private disposePigs(residenceId: string): void {
    const visuals = this.pigs.get(residenceId);
    if (!visuals) return;
    for (const pig of visuals) {
      pig.mixer.stopAllAction();
      pig.mixer.uncacheRoot(pig.model);
      pig.root.removeFromParent();
    }
    this.pigs.delete(residenceId);
  }

  dispose(): void {
    this.disposed = true;
    this.latestInput = null;
    for (const id of this.chickens.keys()) this.disposeChickens(id);
    for (const id of this.goats.keys()) this.disposeGoats(id);
    for (const id of this.pigs.keys()) this.disposePigs(id);
    this.chickenBatch?.dispose();
    this.chickenBatch = null;
    this.goatBatch?.dispose();
    this.goatBatch = null;
    this.pigBatch?.dispose();
    this.pigBatch = null;
    for (const marker of this.meshes.values()) {
      disposeBackyardMarker(marker);
    }
    this.meshes.clear();
    if (this.chickenSource) disposeBackyardChickenSource(this.chickenSource.scene);
    this.chickenSource = null;
    if (this.goatSource) disposeBackyardGoatSource(this.goatSource.scene);
    this.goatSource = null;
    if (this.pigSource) disposeBackyardPigSource(this.pigSource.scene);
    this.pigSource = null;
    this.root.removeFromParent();
  }

  diagnostics(): Record<string, ReturnType<AuthoredAnimalInstanceBatch['diagnostics']> | null> {
    return {
      chicken: this.chickenBatch?.diagnostics() ?? null,
      goat: this.goatBatch?.diagnostics() ?? null,
      pig: this.pigBatch?.diagnostics() ?? null,
    };
  }

  private createAnimalBatch(
    sourceRoot: THREE.Object3D,
    name: string,
  ): AuthoredAnimalInstanceBatch | null {
    try {
      return new AuthoredAnimalInstanceBatch({
        parent: this.root,
        sourceRoot,
        capacity: 32,
        name,
      });
    } catch (error) {
      console.warn(`[Livestock] ${name} batching unavailable; retaining exact rigs.`, error);
      return null;
    }
  }

  private flushAuthoredBatches(): void {
    const submit = (
      batch: AuthoredAnimalInstanceBatch | null,
      visuals: Iterable<ChickenVisual | GoatVisual | PigVisual>,
    ): void => {
      if (!batch) return;
      const visible = [...visuals].filter((visual) => visual.root.visible);
      batch.beginFrame(visible.length);
      for (const visual of visible) batch.submit(visual.model);
      batch.endFrame();
    };
    submit(this.chickenBatch, [...this.chickens.values()].flat());
    submit(this.goatBatch, [...this.goats.values()].flat());
    submit(this.pigBatch, [...this.pigs.values()].flat());
  }
}

function backyardProjectKind(residence: ResidenceState): BackyardGardenKind | null {
  return BACKYARD_GARDEN_KINDS[(residence.backyardProjectKind ?? 0) - 1] ?? null;
}

function backyardConstructionProgress(residence: ResidenceState): {
  progress: number;
  assignedLabor: number;
  timberFill: number;
  stoneFill: number;
} {
  const progress = Math.max(0, Math.min(1, residence.upgradeProgress ?? 0));
  return {
    progress,
    assignedLabor: Math.max(0, residence.upgradeAssignedLabor ?? 0),
    timberFill: remainingMaterialFill(
      residence.upgradeRequiredTimber,
      residence.upgradeDeliveredTimber,
      progress,
    ),
    stoneFill: remainingMaterialFill(
      residence.upgradeRequiredStone,
      residence.upgradeDeliveredStone,
      progress,
    ),
  };
}

function remainingMaterialFill(
  requiredValue: number | undefined,
  deliveredValue: number | undefined,
  progress: number,
): number {
  const required = Math.max(0, requiredValue ?? 0);
  if (required <= 1e-6) return 0;
  const remaining = Math.max(0, (deliveredValue ?? 0) - required * progress);
  return Math.max(0, Math.min(1, remaining / required));
}

function disposeBackyardMarker(marker: THREE.Group): void {
  if (marker.userData.backyardConstructionSite === true) {
    disposeBackyardConstructionMesh(marker);
  } else {
    disposeBackyardGardenMesh(marker);
  }
}

function sampleChickenPoint(width: number, depth: number, random: () => number): { x: number; z: number } {
  // Bias birds toward the open half of the run, away from the coop footprint.
  return {
    x: THREE.MathUtils.lerp(-width * 0.05, width * 0.38, random()),
    z: THREE.MathUtils.lerp(-depth * 0.18, depth * 0.34, random()),
  };
}
