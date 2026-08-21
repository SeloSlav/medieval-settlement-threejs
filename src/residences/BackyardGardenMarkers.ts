import * as THREE from 'three';
import { backyardGardenPlacement } from './backyardPosition.ts';
import {
  createBackyardChickenModel,
  disposeBackyardChickenSource,
  loadBackyardChickenSource,
  removeBackyardChickenFallbacks,
  type BackyardChickenSource,
} from './backyardChickenAssets.ts';
import {
  createBackyardGoatModel,
  disposeBackyardGoatModel,
  disposeBackyardGoatSource,
  loadBackyardGoatSource,
  removeBackyardGoatFallbacks,
  type BackyardGoatSource,
} from './backyardGoatAssets.ts';
import {
  animateBackyardGardenMesh,
  createBackyardGardenMesh,
  disposeBackyardGardenMesh,
  syncBackyardGardenSeasonVisuals,
} from './backyardGardenMesh.ts';
import type { BackyardGardenState, BurgageZoneState, ResidenceState } from '../resources/types.ts';
import { hashStringSeed, mulberry32 } from '../utils/random.ts';
import type { BackyardPlantCatalog } from '../vegetation/seedthree/backyardPlantAssets.ts';
import type { CrowdViewState } from '../settlement/crowdView.ts';
import { isWithinCrowdView } from '../settlement/crowdView.ts';
import type { DeciduousFoliagePresentation } from '../world/deciduousFoliagePolicy.ts';

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
  private plants: BackyardPlantCatalog | null = null;
  private chickenSource: BackyardChickenSource | null = null;
  private goatSource: BackyardGoatSource | null = null;
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
        if (this.latestInput) this.syncReplayable(this.latestInput, true);
      },
      (error: unknown) => {
        console.warn('[Livestock] Animated hen-yard asset failed to load; retaining procedural birds.', error);
      },
    );

    void loadBackyardGoatSource().then(
      (source) => {
        if (this.disposed) {
          disposeBackyardGoatSource(source.scene);
          return;
        }
        this.goatSource = source;
        if (this.latestInput) this.syncReplayable(this.latestInput, true);
      },
      (error: unknown) => {
        console.warn('[Livestock] Sheep-derived CC0 goat visual failed to load; retaining procedural goats.', error);
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
      if (!garden) continue;

      const zone = zonesById.get(residence.zoneId);
      if (!zone) continue;

      const placement = backyardGardenPlacement(residence, zone);
      if (!placement) continue;

      nextIds.add(residence.id);
      let marker = this.meshes.get(residence.id);
      const visualKey = [
        garden.kind,
        placement.width.toFixed(2),
        placement.depth.toFixed(2),
        this.plants ? 'seedthree' : 'vegetation-pending',
        this.chickenSource ? 'animated-hens' : 'fallback-hens',
        this.goatSource ? 'animated-goats' : 'fallback-goats',
        garden.flowerLuxuryUpgraded ? 'luxury-flowers' : 'ordinary-flowers',
      ].join(':');
      if (force || !marker || marker.userData.visualKey !== visualKey) {
        if (marker) {
          this.disposeChickens(residence.id);
          this.disposeGoats(residence.id);
          this.root.remove(marker);
          disposeBackyardGardenMesh(marker);
        }
        marker = createBackyardGardenMesh(garden.kind, {
          width: placement.width,
          depth: placement.depth,
          seed: hashStringSeed(residence.id),
          plants: this.plants,
          flowerLuxuryUpgraded: garden.flowerLuxuryUpgraded,
        });
        marker.userData.visualKey = visualKey;
        this.root.add(marker);
        this.meshes.set(residence.id, marker);
        if (garden.kind === 'hen_yard' && this.chickenSource) {
          this.attachAnimatedChickens(
            residence.id,
            marker,
            placement.width,
            placement.depth,
            hashStringSeed(residence.id),
          );
        }
        if (garden.kind === 'goat_pen' && this.goatSource) {
          this.attachAnimatedGoats(
            residence.id,
            marker,
            placement.width,
            placement.depth,
            hashStringSeed(residence.id),
          );
        }
        marker.userData.backyardAnimalFallbacks = collectAnimalFallbacks(marker);
      }

      const y = input.getHeightAt(placement.x, placement.z);
      marker.userData.firstHarvestDay = garden.firstHarvestDay;
      marker.position.set(placement.x, y, placement.z);
      marker.rotation.y = placement.yaw;
      syncBackyardGardenSeasonVisuals(
        marker,
        garden.kind,
        input.month ?? 1,
        this.deciduousFoliage ?? undefined,
        Math.max(0, garden.firstHarvestDay - (input.totalDays ?? 0)),
      );
    }

    for (const [id, marker] of this.meshes) {
      if (nextIds.has(id)) continue;
      this.root.remove(marker);
      this.disposeChickens(id);
      this.disposeGoats(id);
      disposeBackyardGardenMesh(marker);
      this.meshes.delete(id);
    }
  }

  tick(dtSeconds: number, view?: CrowdViewState): void {
    const dt = Math.min(0.08, Math.max(0, dtSeconds));
    this.animationElapsedSeconds += dt;
    for (const marker of this.meshes.values()) {
      animateBackyardGardenMesh(marker, this.animationElapsedSeconds);
      const visible = isWithinCrowdView(marker.position.x, marker.position.z, view);
      const fallbacks = marker.userData.backyardAnimalFallbacks as THREE.Object3D[] | undefined;
      for (const fallback of fallbacks ?? []) fallback.visible = visible;
    }
    for (const [residenceId, visuals] of this.chickens) {
      const marker = this.meshes.get(residenceId);
      if (!marker) continue;
      const visible = isWithinCrowdView(marker.position.x, marker.position.z, view);
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
      const visible = isWithinCrowdView(marker.position.x, marker.position.z, view);
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
  }

  private attachAnimatedChickens(
    residenceId: string,
    marker: THREE.Group,
    width: number,
    depth: number,
    seed: number,
  ): void {
    if (!this.chickenSource) return;
    removeBackyardChickenFallbacks(marker);

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
    removeBackyardGoatFallbacks(marker);
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

  dispose(): void {
    this.disposed = true;
    this.latestInput = null;
    for (const id of this.chickens.keys()) this.disposeChickens(id);
    for (const id of this.goats.keys()) this.disposeGoats(id);
    for (const marker of this.meshes.values()) {
      disposeBackyardGardenMesh(marker);
    }
    this.meshes.clear();
    if (this.chickenSource) disposeBackyardChickenSource(this.chickenSource.scene);
    this.chickenSource = null;
    if (this.goatSource) disposeBackyardGoatSource(this.goatSource.scene);
    this.goatSource = null;
    this.root.removeFromParent();
  }
}

function collectAnimalFallbacks(marker: THREE.Object3D): THREE.Object3D[] {
  const fallbacks: THREE.Object3D[] = [];
  marker.traverse((object) => {
    if (object.name === 'HenFallback' || object.name === 'GoatFallback') {
      fallbacks.push(object);
    }
  });
  return fallbacks;
}

function sampleChickenPoint(width: number, depth: number, random: () => number): { x: number; z: number } {
  // Bias birds toward the open half of the run, away from the coop footprint.
  return {
    x: THREE.MathUtils.lerp(-width * 0.05, width * 0.38, random()),
    z: THREE.MathUtils.lerp(-depth * 0.18, depth * 0.34, random()),
  };
}
