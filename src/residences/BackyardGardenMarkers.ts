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
  animateBackyardGardenMesh,
  createBackyardGardenMesh,
  disposeBackyardGardenMesh,
} from './backyardGardenMesh.ts';
import type { BackyardGardenState, BurgageZoneState, ResidenceState } from '../resources/types.ts';
import { hashStringSeed, mulberry32 } from '../utils/random.ts';
import type { BackyardPlantCatalog } from '../vegetation/seedthree/backyardPlantAssets.ts';
import type { CrowdViewState } from '../settlement/crowdView.ts';
import { isWithinCrowdView } from '../settlement/crowdView.ts';

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

type GardenSyncInput = {
  residences: Iterable<ResidenceState>;
  zones: Iterable<BurgageZoneState>;
  gardens: Map<string, BackyardGardenState>;
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
  private plants: BackyardPlantCatalog | null = null;
  private chickenSource: BackyardChickenSource | null = null;
  private latestInput: ReplayableGardenSyncInput | null = null;
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
      ].join(':');
      if (force || !marker || marker.userData.visualKey !== visualKey) {
        if (marker) {
          this.disposeChickens(residence.id);
          this.root.remove(marker);
          disposeBackyardGardenMesh(marker);
        }
        marker = createBackyardGardenMesh(garden.kind, {
          width: placement.width,
          depth: placement.depth,
          seed: hashStringSeed(residence.id),
          plants: this.plants,
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
      }

      const y = input.getHeightAt(placement.x, placement.z);
      marker.position.set(placement.x, y, placement.z);
      marker.rotation.y = residence.yaw;
    }

    for (const [id, marker] of this.meshes) {
      if (nextIds.has(id)) continue;
      this.root.remove(marker);
      this.disposeChickens(id);
      disposeBackyardGardenMesh(marker);
      this.meshes.delete(id);
    }
  }

  tick(dtSeconds: number, view?: CrowdViewState): void {
    const dt = Math.min(0.08, Math.max(0, dtSeconds));
    this.animationElapsedSeconds += dt;
    for (const marker of this.meshes.values()) {
      animateBackyardGardenMesh(marker, this.animationElapsedSeconds);
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

  dispose(): void {
    this.disposed = true;
    this.latestInput = null;
    for (const id of this.chickens.keys()) this.disposeChickens(id);
    for (const marker of this.meshes.values()) {
      disposeBackyardGardenMesh(marker);
    }
    this.meshes.clear();
    if (this.chickenSource) disposeBackyardChickenSource(this.chickenSource.scene);
    this.chickenSource = null;
    this.root.removeFromParent();
  }
}

function sampleChickenPoint(width: number, depth: number, random: () => number): { x: number; z: number } {
  // Bias birds toward the open half of the run, away from the coop footprint.
  return {
    x: THREE.MathUtils.lerp(-width * 0.05, width * 0.38, random()),
    z: THREE.MathUtils.lerp(-depth * 0.18, depth * 0.34, random()),
  };
}
