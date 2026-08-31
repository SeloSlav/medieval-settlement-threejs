import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  isPeopleRenderingEnabled,
  isWithinCrowdView,
  isWithinWorkAnimationRange,
  type CrowdViewState,
} from './crowdView.ts';
import {
  attachWorkerTool,
  disposeWorkerToolSources,
  isMilitaryEquipmentKind,
  loadWorkerToolSources,
  setWorkerToolCombatStance,
  setWorkerToolDropped,
  setWorkerToolVisible,
  type WorkerToolKind,
  type WorkerToolSources,
} from './workerTools.ts';
import {
  applyCompanyStandardBearerPose,
  applyCombatWeaponPose,
  bindCombatWeaponRig,
  combatWeaponReleaseOrigin,
  disposeCombatWeaponRig,
  resetCombatWeaponRig,
  resolveCombatWeaponPresentation,
  restoreCombatWeaponPose,
  type CombatWeaponAttackEvent,
  type CombatWeaponRig,
} from './combatWeaponAnimation.ts';
import { CombatProjectileRenderer } from './CombatProjectileRenderer.ts';
import { FallbackMilitaryEquipmentRenderer } from './FallbackMilitaryEquipmentRenderer.ts';
import {
  StrategicHumanoidRenderer,
  type StrategicHumanoidDiagnostic,
} from './StrategicHumanoidRenderer.ts';
import {
  BattlefieldWeaponDropRenderer,
  type BattlefieldWeaponDropDiagnostic,
  type BattlefieldWeaponDropOwnership,
} from './BattlefieldWeaponDropRenderer.ts';
import {
  CompanyStandardRenderer,
  type CompanyStandardDiagnostic,
  type CompanyStandardFaction,
  type CompanyStandardRenderAgent,
} from './CompanyStandardRenderer.ts';
import {
  createCompanyStandardTextures,
  type CompanyStandardTextureSet,
} from './companyStandardTextures.ts';
import { configureVillagerMaterialLighting } from './villagerMaterialLighting.ts';
import { locomotionAnimationTimeScale } from './locomotionAnimation.ts';
import type {
  ClericAnimationMode,
  ClericAuthoredAnimationName,
} from './clericBehaviors.ts';

/**
 * Covers a full 1,024-person settlement plus large hostile companies,
 * mercenaries, and retained casualties without dropping a visible person.
 * GPU cost remains bounded because every strategic body part is instanced.
 */
const MAX_INSTANCES = 2048;
const MAX_ANIMATED_VILLAGERS = 72;
/** Far strategic views switch the whole crowd to the bounded instanced tier. */
export const AUTHORED_RIG_DISABLE_ORBIT_DISTANCE = 112;
/** Hysteresis prevents skeletal rigs churning while the camera crosses a tier. */
export const AUTHORED_RIG_RESTORE_ORBIT_DISTANCE = 96;
/** Upper bound; higher-bone rigs automatically use fewer slots per shard. */
export const ANIMATED_RIGS_PER_SHARD = 8;
export const MAX_ANIMATED_SKELETON_BYTES = 15_872;
const MODEL_YAW_OFFSET = 0;

const MODEL_URLS = {
  man: '/assets/models/villagers/worker-male-common-01-v002.glb',
  woman: '/assets/models/villagers/worker-female-common-01-v001.glb',
  cleric: '/assets/models/villagers/cleric-monk-common-01-v001.glb',
  raider: '/assets/models/villagers/ottoman-raider-common-01-v001.glb',
} as const;

const TARGET_HEIGHTS = {
  man: 1.72,
  woman: 1.64,
  cleric: 1.72,
  raider: 1.74,
} as const;
const MODEL_GROUNDING_HEIGHT = 0.012;
const SEATED_SUPPORT_CONTACT_HEIGHTS = {
  man: 0.39052,
  woman: 0.37534,
} as const;

type VillagerSourceKey = keyof typeof MODEL_URLS;
export type VillagerModelVariant = Exclude<VillagerSourceKey, 'cleric' | 'raider'>;
export type VillagerRenderMode = ClericAnimationMode
  | 'idle'
  | 'walk'
  | 'sit'
  | 'rest'
  | 'talk'
  | 'pray'
  | 'chop'
  | 'mine'
  | 'gather'
  | 'plant'
  | 'sow'
  | 'fish'
  | 'tend'
  | 'build'
  | 'fight';

const CLAMPED_ACTION_MODES = new Set<VillagerRenderMode>([
  'sit',
  'rest',
  'hurt',
  'fall',
]);

type VillagerSource = {
  scene: THREE.Group;
  bounds: THREE.Box3;
  sourceHeight: number;
  targetHeight: number;
  clips: Record<VillagerRenderMode, THREE.AnimationClip>;
};

type AnimatedVillager = {
  id: string;
  variant: VillagerModelVariant;
  sourceKey: VillagerSourceKey;
  toolKind: WorkerToolKind | null;
  tool: THREE.Group | null;
  root: THREE.Group;
  model: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Record<VillagerRenderMode, THREE.AnimationAction>;
  mode: VillagerRenderMode;
  actionMode: VillagerRenderMode;
  combatRig: CombatWeaponRig | null;
  ownedMaterials: THREE.Material[];
  colorBindings: Array<{
    material: THREE.MeshStandardMaterial;
    sourceMaterialName: string;
  }>;
  skeleton: THREE.Skeleton;
};

type AnimatedBatchLayer = {
  mesh: THREE.SkinnedMesh;
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  materialName: string;
  sourceVertexCount: number;
  sourceDrawCount: number;
  slotColors: Uint32Array;
  initializedColors: Uint8Array;
  dirtyColors: Uint8Array;
};

type AnimatedVariantBatch = {
  variant: VillagerSourceKey;
  bonesPerRig: number;
  rigsPerShard: number;
  shards: Array<{
    skeleton: THREE.Skeleton;
    skeletonBytes: number;
    layers: AnimatedBatchLayer[];
  }>;
};

function variantsShareModelSource(
  a: VillagerSourceKey,
  b: VillagerSourceKey,
): boolean {
  return String(MODEL_URLS[a]) === String(MODEL_URLS[b]);
}

function uniqueAnimatedBatches(
  batches: Record<VillagerSourceKey, AnimatedVariantBatch>,
): AnimatedVariantBatch[] {
  return [...new Set(Object.values(batches))];
}

function uniqueSourceScenes(
  sources: Record<VillagerSourceKey, VillagerSource>,
): THREE.Group[] {
  return [...new Set(Object.values(sources).map((source) => source.scene))];
}

export function animatedRigsPerShard(bonesPerRig: number): number {
  if (!Number.isFinite(bonesPerRig) || bonesPerRig <= 0) return 1;
  const matrixBytesPerRig = Math.ceil(bonesPerRig)
    * 16
    * Float32Array.BYTES_PER_ELEMENT;
  return Math.max(
    1,
    Math.min(
      ANIMATED_RIGS_PER_SHARD,
      Math.floor(MAX_ANIMATED_SKELETON_BYTES / matrixBytesPerRig),
    ),
  );
}

export type CrowdRenderAgent = {
  id: string;
  slot: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  appearanceSeed: number;
  variant: VillagerModelVariant;
  presentation?: 'common' | 'cleric' | 'raider';
  mode: VillagerRenderMode;
  tunicColor: number;
  skinColor: number;
  hairColor: number;
  tool: WorkerToolKind | null;
  movementSpeed: number;
  active: boolean;
  /** One stable company identity is attached to its currently elected bearer. */
  companyStandard?: {
    id: string;
    faction: CompanyStandardFaction;
  };
  /** Explicit casualty detach event; never inferred from hurt/fall animation alone. */
  battlefieldWeaponDrop?: BattlefieldWeaponDropOwnership;
  combatAttackCooldown?: number;
  combatAttackSeconds?: number;
  combatLocomotion?: 'idle' | 'walk' | 'run';
  combatTargetDistance?: number;
  combatTargetX?: number;
  combatTargetY?: number;
  combatTargetZ?: number;
};

export function compareCrowdAnimationPriority(
  left: CrowdRenderAgent,
  right: CrowdRenderAgent,
  view?: CrowdViewState,
): number {
  const standardPriority = Number(Boolean(right.companyStandard))
    - Number(Boolean(left.companyStandard));
  if (standardPriority !== 0) return standardPriority;
  if (view) {
    const leftDx = left.x - view.centerX;
    const leftDz = left.z - view.centerZ;
    const rightDx = right.x - view.centerX;
    const rightDz = right.z - view.centerZ;
    const distancePriority = leftDx * leftDx + leftDz * leftDz
      - rightDx * rightDx - rightDz * rightDz;
    if (Math.abs(distancePriority) > 1e-8) return distancePriority;
  }
  return left.slot - right.slot || left.id.localeCompare(right.id, undefined, { numeric: true });
}

export type CrowdCombatAttackEvent = CombatWeaponAttackEvent & {
  agentId: string;
  x: number;
  y: number;
  z: number;
  targetX: number;
  targetY: number;
  targetZ: number;
};

export type SettlementCrowdRendererOptions = {
  parent: THREE.Group;
};

export function villagerHeightJitter(appearanceSeed: number): number {
  return 0.96 + ((appearanceSeed >>> 8) & 0xff) / 0xff * 0.08;
}

/**
 * Height of the posed butt/upper-thigh contact patch above the render root.
 * Values are measured from each configured model's sitting clip after normal
 * target-height scaling. The grounding term stays fixed at runtime; only the
 * model scale receives the deterministic height variation.
 */
export function seatedVillagerContactHeight(
  variant: VillagerModelVariant,
  appearanceSeed: number,
): number {
  return MODEL_GROUNDING_HEIGHT
    + (SEATED_SUPPORT_CONTACT_HEIGHTS[variant] - MODEL_GROUNDING_HEIGHT)
      * villagerHeightJitter(appearanceSeed);
}

/**
 * Renders the nearest 72 villagers with authored skeletal animations. Further
 * visible agents retain a complete eight-layer instanced humanoid silhouette,
 * which keeps hundred-person companies present without hundreds of mixers or
 * permanent capsule/pill proxies.
 */
export class SettlementCrowdRenderer {
  readonly ready: Promise<boolean>;
  private readonly group = new THREE.Group();
  private readonly animatedGroup = new THREE.Group();
  private readonly color = new THREE.Color();
  private readonly strategicHumanoids: StrategicHumanoidRenderer;
  private readonly fallbackMilitaryEquipment: FallbackMilitaryEquipmentRenderer;
  private readonly battlefieldWeaponDrops: BattlefieldWeaponDropRenderer;
  private readonly companyStandards: CompanyStandardRenderer;
  private readonly companyStandardTextures: CompanyStandardTextureSet | null;
  private readonly companyStandardAgents: CompanyStandardRenderAgent[] = [];
  private readonly companyStandardAgentPool: CompanyStandardRenderAgent[] = [];
  private readonly companyStandardGrip = new THREE.Vector3();
  private readonly animated = new Map<string, AnimatedVillager>();
  private readonly animatedPool = new Map<string, AnimatedVillager[]>();
  private idlePooledVisualCount = 0;
  private readonly visibleAgents: CrowdRenderAgent[] = [];
  private readonly animatedCandidates: CrowdRenderAgent[] = [];
  private readonly animatedIds = new Set<string>();
  private readonly combatProjectiles: CombatProjectileRenderer;
  private readonly pendingCombatAttackEvents: CrowdCombatAttackEvent[] = [];
  private readonly combatOrigin = new THREE.Vector3();
  private readonly combatTarget = new THREE.Vector3();
  private sources: Record<VillagerSourceKey, VillagerSource> | null = null;
  private toolSources: WorkerToolSources | null = null;
  private animatedBatches: Record<VillagerSourceKey, AnimatedVariantBatch> | null = null;
  private readonly latestAgents: CrowdRenderAgent[] = [];
  private lastView: CrowdViewState | undefined;
  private authoredRigsEnabled = true;
  private disposed = false;

  constructor(options: SettlementCrowdRendererOptions) {
    this.group.name = 'Villagers';
    this.animatedGroup.name = 'Animated villagers';
    this.group.add(this.animatedGroup);
    options.parent.add(this.group);
    this.combatProjectiles = new CombatProjectileRenderer(this.group);

    this.strategicHumanoids = new StrategicHumanoidRenderer(this.group, MAX_INSTANCES);
    this.fallbackMilitaryEquipment = new FallbackMilitaryEquipmentRenderer(this.group, MAX_INSTANCES);
    this.battlefieldWeaponDrops = new BattlefieldWeaponDropRenderer(this.group);
    this.companyStandardTextures = typeof document === 'undefined'
      ? null
      : createCompanyStandardTextures();
    this.companyStandards = new CompanyStandardRenderer({
      parent: this.group,
      capacity: 64,
      artwork: this.companyStandardTextures?.artwork,
    });
    this.ready = this.loadSources();
  }

  syncAgents(
    agents: readonly CrowdRenderAgent[],
    view?: CrowdViewState,
    dtSeconds = 0,
  ): void {
    // Keep the same shallow snapshot semantics as the original array copy, but
    // reuse its backing storage on every animation frame. loadSources() may
    // replay this owned buffer directly after its asynchronous handoff.
    if (agents !== this.latestAgents) {
      this.latestAgents.length = 0;
      for (const agent of agents) this.latestAgents.push(agent);
    }
    this.lastView = view;
    const dt = Math.min(0.08, Math.max(0, dtSeconds));
    const renderEnabled = isPeopleRenderingEnabled(view);
    if (this.group.visible !== renderEnabled) {
      this.group.visible = renderEnabled;
    }
    if (!renderEnabled) return;
    this.combatProjectiles.update(dt);

    const visibleAgents = this.visibleAgents;
    visibleAgents.length = 0;
    for (const agent of this.latestAgents) {
      if (agent.active && isWithinCrowdView(agent.x, agent.z, view)) {
        visibleAgents.push(agent);
      }
    }

    const animatedIds = this.pickAnimatedIds(visibleAgents, view);
    if (!this.sources) {
      this.strategicHumanoids.sync(visibleAgents, undefined, dt);
      this.fallbackMilitaryEquipment.sync(visibleAgents);
      this.battlefieldWeaponDrops.sync(visibleAgents, view);
      this.syncCompanyStandards(visibleAgents, view, dt);
      return;
    }

    this.syncAnimatedVillagers(visibleAgents, animatedIds, dt);
    this.updateAnimatedBatches(visibleAgents, animatedIds);
    this.strategicHumanoids.sync(visibleAgents, animatedIds, dt);
    this.fallbackMilitaryEquipment.sync(visibleAgents, animatedIds);
    this.battlefieldWeaponDrops.sync(visibleAgents, view);
    this.syncCompanyStandards(visibleAgents, view, dt);
  }

  beginFirstPlayableGpuPrewarm(): () => void {
    const changed: Array<{
      layer: AnimatedBatchLayer;
      visible: boolean;
      drawStart: number;
      drawCount: number;
    }> = [];
    if (!this.animatedBatches) return () => {};
    for (const batch of uniqueAnimatedBatches(this.animatedBatches)) {
      for (const shard of batch.shards) {
        for (const layer of shard.layers) {
          if (layer.mesh.visible) continue;
          changed.push({
            layer,
            visible: layer.mesh.visible,
            drawStart: layer.geometry.drawRange.start,
            drawCount: layer.geometry.drawRange.count,
          });
          layer.mesh.visible = true;
          layer.geometry.setDrawRange(0, layer.sourceDrawCount);
        }
      }
    }
    return () => {
      for (const state of changed) {
        state.layer.mesh.visible = state.visible;
        state.layer.geometry.setDrawRange(state.drawStart, state.drawCount);
      }
    };
  }

  drainCombatAttackEvents(target: CrowdCombatAttackEvent[] = []): CrowdCombatAttackEvent[] {
    target.length = 0;
    target.push(...this.pendingCombatAttackEvents);
    this.pendingCombatAttackEvents.length = 0;
    return target;
  }

  companyStandardDiagnostics(): CompanyStandardDiagnostic {
    return this.companyStandards.diagnostics();
  }

  battlefieldWeaponDropDiagnostics(): BattlefieldWeaponDropDiagnostic {
    return this.battlefieldWeaponDrops.diagnostics();
  }

  strategicHumanoidDiagnostics(): StrategicHumanoidDiagnostic {
    return this.strategicHumanoids.diagnostics();
  }

  dispose(): void {
    this.disposed = true;
    for (const id of this.animated.keys()) this.removeAnimatedVillager(id);
    for (const pool of this.animatedPool.values()) {
      for (const visual of pool) this.disposeAnimatedVillager(visual);
    }
    this.animatedPool.clear();
    this.idlePooledVisualCount = 0;

    if (this.animatedBatches) {
      for (const batch of uniqueAnimatedBatches(this.animatedBatches)) {
        for (const shard of batch.shards) {
          shard.skeleton.dispose();
          for (const layer of shard.layers) {
            layer.mesh.removeFromParent();
            layer.geometry.dispose();
            layer.material.dispose();
          }
        }
      }
      this.animatedBatches = null;
    }

    this.strategicHumanoids.dispose();
    this.fallbackMilitaryEquipment.dispose();
    this.battlefieldWeaponDrops.dispose();
    this.companyStandards.dispose();
    this.companyStandardTextures?.dispose();
    this.companyStandardAgents.length = 0;
    this.companyStandardAgentPool.length = 0;

    if (this.sources) {
      for (const scene of uniqueSourceScenes(this.sources)) {
        disposeModelResources(scene);
      }
    }
    this.sources = null;
    if (this.toolSources) disposeWorkerToolSources(this.toolSources);
    this.toolSources = null;
    this.combatProjectiles.dispose();
    this.pendingCombatAttackEvents.length = 0;
    this.group.removeFromParent();
  }

  private async loadSources(): Promise<boolean> {
    try {
      const manPromise = loadVillagerSource(
        MODEL_URLS.man,
        TARGET_HEIGHTS.man,
      );
      const womanPromise = variantsShareModelSource('man', 'woman')
        ? manPromise.then((source) => ({
            ...source,
            targetHeight: TARGET_HEIGHTS.woman,
          }))
        : loadVillagerSource(MODEL_URLS.woman, TARGET_HEIGHTS.woman);
      const clericPromise = loadVillagerSource(
        MODEL_URLS.cleric,
        TARGET_HEIGHTS.cleric,
      );
      const raiderPromise = loadVillagerSource(
        MODEL_URLS.raider,
        TARGET_HEIGHTS.raider,
        createRaiderClipSet,
      );
      const [man, woman, cleric, raider, tools] = await Promise.all([
        manPromise,
        womanPromise,
        clericPromise,
        raiderPromise,
        loadWorkerToolSources(),
      ]);
      if (this.disposed) {
        for (const scene of uniqueSourceScenes({ man, woman, cleric, raider })) {
          disposeModelResources(scene);
        }
        disposeWorkerToolSources(tools);
        return false;
      }
      this.sources = { man, woman, cleric, raider };
      this.toolSources = tools;
      this.battlefieldWeaponDrops.configureSources(tools);
      const manBatch = this.createAnimatedBatch('man', man);
      this.animatedBatches = {
        man: manBatch,
        woman: variantsShareModelSource('man', 'woman')
          ? manBatch
          : this.createAnimatedBatch('woman', woman),
        cleric: this.createAnimatedBatch('cleric', cleric),
        raider: this.createAnimatedBatch('raider', raider),
      };
      this.syncAgents(this.latestAgents, this.lastView);
      return true;
    } catch (error) {
      console.warn('[Villagers] Animated villager sources failed to load.', error);
      return false;
    }
  }

  private pickAnimatedIds(
    agents: readonly CrowdRenderAgent[],
    view?: CrowdViewState,
  ): Set<string> {
    const orbitDistance = view?.orbitDistance;
    if (orbitDistance === undefined) {
      this.authoredRigsEnabled = true;
    } else if (
      this.authoredRigsEnabled
      && orbitDistance >= AUTHORED_RIG_DISABLE_ORBIT_DISTANCE
    ) {
      this.authoredRigsEnabled = false;
    } else if (
      !this.authoredRigsEnabled
      && orbitDistance <= AUTHORED_RIG_RESTORE_ORBIT_DISTANCE
    ) {
      this.authoredRigsEnabled = true;
    }
    const animatedIds = this.animatedIds;
    animatedIds.clear();
    if (!this.authoredRigsEnabled) return animatedIds;

    const candidates = this.animatedCandidates;
    candidates.length = 0;
    for (const agent of agents) {
      if (isWithinWorkAnimationRange(agent.x, agent.z, view)) {
        candidates.push(agent);
      }
    }
    candidates.sort((a, b) => compareCrowdAnimationPriority(a, b, view));
    const count = Math.min(candidates.length, MAX_ANIMATED_VILLAGERS);
    for (let index = 0; index < count; index++) {
      animatedIds.add(candidates[index]!.id);
    }
    return animatedIds;
  }

  private syncAnimatedVillagers(
    agents: readonly CrowdRenderAgent[],
    animatedIds: ReadonlySet<string>,
    dt: number,
  ): void {
    // animatedIds is selected exclusively from agents, so membership proves
    // both that an id is still visible and that it remains animation-eligible.
    for (const id of this.animated.keys()) {
      if (!animatedIds.has(id)) this.removeAnimatedVillager(id);
    }

    for (const agent of agents) {
      if (!animatedIds.has(agent.id)) continue;
      const sourceKey = sourceKeyForAgent(agent);
      let visual = this.animated.get(agent.id);
      if (
        !visual
        || visual.variant !== agent.variant
        || visual.sourceKey !== sourceKey
        || visual.toolKind !== agent.tool
      ) {
        if (visual) this.removeAnimatedVillager(agent.id);
        visual = this.acquireAnimatedVillager(agent);
        this.animated.set(agent.id, visual);
      }

      visual.root.position.set(agent.x, agent.y, agent.z);
      visual.root.rotation.y = agent.yaw + MODEL_YAW_OFFSET;
      if (visual.combatRig) restoreCombatWeaponPose(visual.combatRig);
      const nextActionMode = combatBaseActionMode(agent);
      if (visual.mode !== agent.mode || visual.actionMode !== nextActionMode) {
        this.transition(visual, agent.mode, nextActionMode);
      }
      visual.actions.walk.setEffectiveTimeScale(
        locomotionAnimationTimeScale('walk', agent.movementSpeed),
      );
      visual.actions.run.setEffectiveTimeScale(
        locomotionAnimationTimeScale('run', agent.movementSpeed),
      );
      visual.actions.flee.setEffectiveTimeScale(
        locomotionAnimationTimeScale('flee', agent.movementSpeed),
      );
      if (dt > 0) visual.mixer.update(dt);
      this.applyCombatPresentation(visual, agent, dt);
      if (visual.tool) {
        setWorkerToolDropped(visual.tool, Boolean(agent.battlefieldWeaponDrop));
      }
      if (agent.companyStandard && visual.combatRig) {
        applyCompanyStandardBearerPose(visual.combatRig);
      }
    }
  }

  private syncCompanyStandards(
    agents: readonly CrowdRenderAgent[],
    view: CrowdViewState | undefined,
    dt: number,
  ): void {
    this.companyStandardAgents.length = 0;
    this.group.updateWorldMatrix(true, false);
    let index = 0;
    for (const agent of agents) {
      const assignment = agent.companyStandard;
      if (!assignment) continue;
      let standard = this.companyStandardAgentPool[index];
      if (!standard) {
        standard = {
          id: assignment.id,
          faction: assignment.faction,
          x: agent.x,
          y: agent.y,
          z: agent.z,
          yaw: agent.yaw,
          appearanceSeed: agent.appearanceSeed,
          active: true,
        };
        this.companyStandardAgentPool.push(standard);
      }
      standard.id = assignment.id;
      standard.faction = assignment.faction;
      standard.x = agent.x;
      standard.y = agent.y;
      standard.z = agent.z;
      standard.yaw = agent.yaw;
      standard.pitch = 0;
      standard.roll = 0;
      standard.appearanceSeed = agent.appearanceSeed;
      standard.active = agent.active;
      const animated = this.animated.get(agent.id);
      if (animated?.combatRig) {
        animated.combatRig.armBones.leftHand.getWorldPosition(this.companyStandardGrip);
        this.group.worldToLocal(this.companyStandardGrip);
        const grip = standard.gripPose ?? {
          x: 0,
          y: 0,
          z: 0,
        };
        grip.x = this.companyStandardGrip.x;
        grip.y = this.companyStandardGrip.y;
        grip.z = this.companyStandardGrip.z;
        grip.quaternion = undefined;
        standard.gripPose = grip;
      } else {
        standard.gripPose = undefined;
      }
      this.companyStandardAgents.push(standard);
      index += 1;
    }
    this.companyStandards.sync(this.companyStandardAgents, view, dt);
  }

  private createAnimatedVillager(agent: CrowdRenderAgent): AnimatedVillager {
    const sourceKey = sourceKeyForAgent(agent);
    const source = this.sources![sourceKey];
    const model = cloneSkinned(source.scene) as THREE.Group;
    const heightJitter = villagerHeightJitter(agent.appearanceSeed);
    const scale = source.targetHeight / source.sourceHeight * heightJitter;
    model.scale.setScalar(scale);
    model.position.y = -source.bounds.min.y * scale + 0.012;

    const ownedMaterials: THREE.Material[] = [];
    const colorBindings: AnimatedVillager['colorBindings'] = [];
    let skeleton: THREE.Skeleton | null = null;
    model.traverse((object) => {
      const mesh = object as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh) return;
      skeleton ??= mesh.skeleton;
      // The retained rig drives one aggregate SkinnedMesh per authored
      // material layer. Keeping these source shells hidden preserves exact
      // AnimationMixer/bone semantics without submitting them independently.
      mesh.visible = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
    });
    if (!skeleton) throw new Error(`Missing ${agent.variant} villager skeleton`);

    const root = new THREE.Group();
    root.name = `${sourceKey === 'cleric' ? 'Cleric' : sourceKey === 'raider' ? 'Ottoman raider' : agent.variant === 'woman' ? 'Woman' : 'Man'} villager ${agent.id}`;
    root.userData.villagerId = agent.id;
    root.userData.villagerGender = agent.variant;
    root.add(model);
    this.animatedGroup.add(root);

    const tool = agent.tool && this.toolSources
      ? attachWorkerTool(model, this.toolSources[agent.tool])
      : null;
    if (tool && agent.tool) {
      setWorkerToolVisible(tool, workerToolVisibleInMode(agent.tool, agent.mode));
      setWorkerToolDropped(tool, Boolean(agent.battlefieldWeaponDrop));
    }
    const combatRig = bindCombatWeaponRig(model, agent.tool, tool);

    const mixer = new THREE.AnimationMixer(model);
    const actions: Record<VillagerRenderMode, THREE.AnimationAction> = {
      idle: mixer.clipAction(source.clips.idle, model),
      walk: mixer.clipAction(source.clips.walk, model),
      sit: mixer.clipAction(source.clips.sit, model),
      rest: mixer.clipAction(source.clips.rest, model),
      talk: mixer.clipAction(source.clips.talk, model),
      pray: mixer.clipAction(source.clips.pray, model),
      chop: mixer.clipAction(source.clips.chop, model),
      mine: mixer.clipAction(source.clips.mine, model),
      gather: mixer.clipAction(source.clips.gather, model),
      plant: mixer.clipAction(source.clips.plant, model),
      sow: mixer.clipAction(source.clips.sow, model),
      fish: mixer.clipAction(source.clips.fish, model),
      tend: mixer.clipAction(source.clips.tend, model),
      build: mixer.clipAction(source.clips.build, model),
      fight: mixer.clipAction(source.clips.fight, model),
      relax: mixer.clipAction(source.clips.relax, model),
      look: mixer.clipAction(source.clips.look, model),
      wait: mixer.clipAction(source.clips.wait, model),
      laugh: mixer.clipAction(source.clips.laugh, model),
      greet: mixer.clipAction(source.clips.greet, model),
      sermon: mixer.clipAction(source.clips.sermon, model),
      agree: mixer.clipAction(source.clips.agree, model),
      bow: mixer.clipAction(source.clips.bow, model),
      carry: mixer.clipAction(source.clips.carry, model),
      hurt: mixer.clipAction(source.clips.hurt, model),
      fall: mixer.clipAction(source.clips.fall, model),
      flee: mixer.clipAction(source.clips.flee, model),
      run: mixer.clipAction(source.clips.run, model),
    };
    for (const [mode, action] of Object.entries(actions) as Array<
      [VillagerRenderMode, THREE.AnimationAction]
    >) {
      action.enabled = true;
      if (CLAMPED_ACTION_MODES.has(mode)) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      } else {
        action.setLoop(THREE.LoopRepeat, Number.POSITIVE_INFINITY);
      }
    }
    configureActionSpeeds(actions, agent.movementSpeed);
    const actionMode = combatBaseActionMode(agent);
    actions[actionMode].play();
    if (!CLAMPED_ACTION_MODES.has(actionMode)) {
      actions[actionMode].time =
        (agent.appearanceSeed % 997) / 997 * actions[actionMode].getClip().duration;
    }

    return {
      id: agent.id,
      variant: agent.variant,
      sourceKey,
      toolKind: agent.tool,
      tool,
      root,
      model,
      mixer,
      actions,
      mode: agent.mode,
      actionMode,
      combatRig,
      ownedMaterials,
      colorBindings,
      skeleton,
    };
  }

  private acquireAnimatedVillager(agent: CrowdRenderAgent): AnimatedVillager {
    const poolKey = animatedPoolKey(sourceKeyForAgent(agent), agent.tool);
    const pool = this.animatedPool.get(poolKey);
    const pooledVisual = pool?.pop();
    if (pooledVisual) this.idlePooledVisualCount -= 1;
    const visual = pooledVisual ?? this.createAnimatedVillager(agent);
    if (pooledVisual) this.resetPooledVillager(visual, agent);
    visual.root.visible = true;
    return visual;
  }

  private resetPooledVillager(
    visual: AnimatedVillager,
    agent: CrowdRenderAgent,
  ): void {
    const sourceKey = sourceKeyForAgent(agent);
    const source = this.sources![sourceKey];
    const scale = source.targetHeight / source.sourceHeight
      * villagerHeightJitter(agent.appearanceSeed);
    visual.id = agent.id;
    visual.variant = agent.variant;
    visual.sourceKey = sourceKey;
    visual.mode = agent.mode;
    visual.actionMode = combatBaseActionMode(agent);
    if (visual.combatRig) resetCombatWeaponRig(visual.combatRig);
    visual.root.name = `${sourceKey === 'cleric' ? 'Cleric' : sourceKey === 'raider' ? 'Ottoman raider' : agent.variant === 'woman' ? 'Woman' : 'Man'} villager ${agent.id}`;
    visual.root.userData.villagerId = agent.id;
    visual.root.userData.villagerGender = agent.variant;
    visual.model.scale.setScalar(scale);
    visual.model.position.y = -source.bounds.min.y * scale + MODEL_GROUNDING_HEIGHT;
    for (const binding of visual.colorBindings) {
      binding.material.color.setHex(
        resolvePartColor(binding.sourceMaterialName, agent),
      );
    }
    restartPooledVillagerActions(
      visual.mixer,
      visual.actions,
      visual.actionMode,
      agent.appearanceSeed,
      agent.movementSpeed,
    );
    if (visual.tool && visual.toolKind) {
      // Pool entries may have belonged to a casualty. Restore the hand mount
      // before applying the incoming owner's explicit detach state.
      setWorkerToolDropped(visual.tool, false);
      setWorkerToolVisible(visual.tool, workerToolVisibleInMode(
        visual.toolKind,
        agent.mode,
      ));
      setWorkerToolDropped(visual.tool, Boolean(agent.battlefieldWeaponDrop));
    }
  }

  private transition(
    visual: AnimatedVillager,
    nextMode: VillagerRenderMode,
    nextActionMode: VillagerRenderMode,
  ): void {
    if (visual.mode === nextMode && visual.actionMode === nextActionMode) return;
    if (visual.actionMode !== nextActionMode) {
      visual.actions[visual.actionMode].fadeOut(0.18);
      visual.actions[nextActionMode].reset().fadeIn(0.18).play();
    }
    if (visual.tool && visual.toolKind) {
      setWorkerToolVisible(visual.tool, workerToolVisibleInMode(
        visual.toolKind,
        nextMode,
      ));
    }
    visual.mode = nextMode;
    visual.actionMode = nextActionMode;
  }

  private applyCombatPresentation(
    visual: AnimatedVillager,
    agent: CrowdRenderAgent,
    dt: number,
  ): void {
    if (
      !visual.combatRig
      || !visual.tool
      || !agent.tool
      || agent.combatAttackCooldown === undefined
    ) {
      if (visual.combatRig?.family) resetCombatWeaponRig(visual.combatRig);
      if (visual.tool && agent.tool && isMilitaryEquipmentKind(agent.tool)) {
        const defaultPresentation = resolveCombatWeaponPresentation(agent.tool, Infinity);
        setWorkerToolCombatStance(
          visual.tool,
          defaultPresentation?.stance ?? 'melee',
        );
      }
      return;
    }
    const result = applyCombatWeaponPose(visual.combatRig, {
      tool: agent.tool,
      targetDistance: agent.combatTargetDistance ?? Infinity,
      attackCooldown: agent.combatAttackCooldown,
      attackSeconds: agent.combatAttackSeconds,
      dtSeconds: dt,
      logicalMode: agent.mode,
    });
    if (!result) return;
    setWorkerToolCombatStance(visual.tool, result.presentation.stance);
    if (!result.event) return;

    const targetX = agent.combatTargetX
      ?? agent.x + Math.sin(agent.yaw) * Math.max(2, agent.combatTargetDistance ?? 5);
    const targetY = agent.combatTargetY ?? agent.y + 1.05;
    const targetZ = agent.combatTargetZ
      ?? agent.z + Math.cos(agent.yaw) * Math.max(2, agent.combatTargetDistance ?? 5);
    const event: CrowdCombatAttackEvent = {
      ...result.event,
      agentId: agent.id,
      x: agent.x,
      y: agent.y,
      z: agent.z,
      targetX,
      targetY,
      targetZ,
    };
    if (this.pendingCombatAttackEvents.length >= 128) {
      this.pendingCombatAttackEvents.shift();
    }
    this.pendingCombatAttackEvents.push(event);
    if (result.event.type !== 'projectile-release' || !result.event.projectile) return;
    combatWeaponReleaseOrigin(visual.combatRig, this.combatOrigin);
    this.combatTarget.set(targetX, targetY, targetZ);
    this.group.localToWorld(this.combatTarget);
    this.combatProjectiles.spawnRelease(
      result.event.projectile,
      this.combatOrigin,
      this.combatTarget,
      agent.appearanceSeed ^ result.event.sequence,
    );
  }

  private removeAnimatedVillager(id: string): void {
    const visual = this.animated.get(id);
    if (!visual) return;
    if (visual.combatRig) resetCombatWeaponRig(visual.combatRig);
    visual.mixer.stopAllAction();
    visual.root.visible = false;
    if (visual.tool) setWorkerToolVisible(visual.tool, false);
    this.animated.delete(id);
    if (this.idlePooledVisualCount >= MAX_ANIMATED_VILLAGERS) {
      this.disposeAnimatedVillager(visual);
      return;
    }
    const poolKey = animatedPoolKey(visual.sourceKey, visual.toolKind);
    let pool = this.animatedPool.get(poolKey);
    if (!pool) {
      pool = [];
      this.animatedPool.set(poolKey, pool);
    }
    pool.push(visual);
    this.idlePooledVisualCount += 1;
  }

  private disposeAnimatedVillager(visual: AnimatedVillager): void {
    visual.mixer.stopAllAction();
    visual.mixer.uncacheRoot(visual.model);
    if (visual.combatRig) disposeCombatWeaponRig(visual.combatRig);
    for (const material of visual.ownedMaterials) material.dispose();
    visual.root.removeFromParent();
  }

  private createAnimatedBatch(
    variant: VillagerSourceKey,
    source: VillagerSource,
  ): AnimatedVariantBatch {
    source.scene.updateMatrixWorld(true);
    const sourceMeshes: THREE.SkinnedMesh[] = [];
    source.scene.traverse((object) => {
      const mesh = object as THREE.SkinnedMesh;
      if (mesh.isSkinnedMesh) sourceMeshes.push(mesh);
    });
    const sourceSkeleton = sourceMeshes[0]?.skeleton;
    if (!sourceSkeleton) throw new Error(`Missing ${variant} source skeleton`);
    const bonesPerRig = sourceSkeleton.bones.length;
    const rigsPerShard = animatedRigsPerShard(bonesPerRig);
    const skeletonBytes = bonesPerRig
      * rigsPerShard
      * 16
      * Float32Array.BYTES_PER_ELEMENT;
    if (skeletonBytes > MAX_ANIMATED_SKELETON_BYTES) {
      throw new Error(
        `${variant} villager skeleton shard requires ${skeletonBytes} bytes; `
          + `the cross-backend limit is ${MAX_ANIMATED_SKELETON_BYTES}`,
      );
    }
    const shards = Array.from(
      { length: Math.ceil(MAX_ANIMATED_VILLAGERS / rigsPerShard) },
      (_, shardIndex) => {
        const bones: THREE.Bone[] = [];
        const boneInverses: THREE.Matrix4[] = [];
        for (let slot = 0; slot < rigsPerShard; slot++) {
          bones.push(...sourceSkeleton.bones);
          boneInverses.push(...sourceSkeleton.boneInverses);
        }
        const skeleton = new THREE.Skeleton(bones, boneInverses);
        const layers = sourceMeshes.map((sourceMesh) => {
          const sourceMaterial = Array.isArray(sourceMesh.material)
            ? sourceMesh.material[0]
            : sourceMesh.material;
          if (!(sourceMaterial instanceof THREE.MeshStandardMaterial)) {
            throw new Error(
              `${variant}/${sourceMesh.name} requires one MeshStandardMaterial`,
            );
          }
          const geometry = createReplicatedSkinnedGeometry(
            sourceMesh.geometry,
            bonesPerRig,
            rigsPerShard,
          );
          const material = sourceMaterial.clone();
          material.name = `${sourceMaterial.name}: aggregate close villagers`;
          material.color.setHex(0xffffff);
          configureVillagerMaterialLighting(material);
          material.vertexColors = true;
          const mesh = new THREE.SkinnedMesh(geometry, material);
          mesh.name = `${variant} aggregate close villagers shard ${shardIndex}: ${sourceMaterial.name}`;
          mesh.bindMode = sourceMesh.bindMode;
          mesh.bind(skeleton, sourceMesh.bindMatrix);
          mesh.castShadow = false;
          mesh.receiveShadow = false;
          mesh.frustumCulled = false;
          mesh.visible = false;
          geometry.setDrawRange(0, 0);
          this.animatedGroup.add(mesh);
          return {
            mesh,
            geometry,
            material,
            materialName: sourceMaterial.name,
            sourceVertexCount: sourceMesh.geometry.getAttribute('position').count,
            sourceDrawCount: sourceMesh.geometry.index?.count
              ?? sourceMesh.geometry.getAttribute('position').count,
            slotColors: new Uint32Array(rigsPerShard),
            initializedColors: new Uint8Array(rigsPerShard),
            dirtyColors: new Uint8Array(rigsPerShard),
          } satisfies AnimatedBatchLayer;
        });
        return { skeleton, skeletonBytes, layers };
      },
    );
    return { variant, bonesPerRig, rigsPerShard, shards };
  }

  private updateAnimatedBatches(
    agents: readonly CrowdRenderAgent[],
    animatedIds: ReadonlySet<string>,
  ): void {
    const batches = this.animatedBatches;
    if (!batches) return;
    const counts: Record<VillagerSourceKey, number> = { man: 0, woman: 0, cleric: 0, raider: 0 };
    for (const batch of uniqueAnimatedBatches(batches)) {
      for (const shard of batch.shards) {
        for (const layer of shard.layers) layer.dirtyColors.fill(0);
      }
    }
    for (const agent of agents) {
      if (!animatedIds.has(agent.id)) continue;
      const visual = this.animated.get(agent.id);
      if (!visual) continue;
      const batch: AnimatedVariantBatch = batches[sourceKeyForAgent(agent)];
      const variantSlot = counts[batch.variant]++;
      if (variantSlot >= MAX_ANIMATED_VILLAGERS) continue;
      const shard = batch.shards[
        Math.floor(variantSlot / batch.rigsPerShard)
      ]!;
      const shardSlot = variantSlot % batch.rigsPerShard;
      const boneOffset = shardSlot * batch.bonesPerRig;
      for (let bone = 0; bone < batch.bonesPerRig; bone++) {
        shard.skeleton.bones[boneOffset + bone] = visual.skeleton.bones[bone]!;
        shard.skeleton.boneInverses[boneOffset + bone] =
          visual.skeleton.boneInverses[bone]!;
      }
      for (const layer of shard.layers) {
        const color = resolvePartColor(layer.materialName, agent);
        if (
          layer.initializedColors[shardSlot]
          && layer.slotColors[shardSlot] === color
        ) {
          continue;
        }
        layer.initializedColors[shardSlot] = 1;
        layer.slotColors[shardSlot] = color;
        layer.dirtyColors[shardSlot] = 1;
        this.color.setHex(color);
        const attribute = layer.geometry.getAttribute('color');
        const array = attribute.array;
        let offset = shardSlot * layer.sourceVertexCount * 3;
        const end = offset + layer.sourceVertexCount * 3;
        while (offset < end) {
          array[offset++] = this.color.r;
          array[offset++] = this.color.g;
          array[offset++] = this.color.b;
        }
      }
    }
    for (const batch of uniqueAnimatedBatches(batches)) {
      for (let shardIndex = 0; shardIndex < batch.shards.length; shardIndex++) {
        const shard = batch.shards[shardIndex]!;
        const count = Math.min(
          batch.rigsPerShard,
          Math.max(
            0,
            counts[batch.variant] - shardIndex * batch.rigsPerShard,
          ),
        );
        for (const layer of shard.layers) {
          layer.mesh.visible = count > 0;
          layer.geometry.setDrawRange(0, count * layer.sourceDrawCount);
          publishAnimatedColorRanges(layer, count);
        }
      }
    }
  }

}

function createReplicatedSkinnedGeometry(
  source: THREE.BufferGeometry,
  bonesPerRig: number,
  rigCount: number,
): THREE.BufferGeometry {
  const merged = new THREE.BufferGeometry();
  const sourceVertexCount = source.getAttribute('position').count;
  for (const [name, sourceAttribute] of Object.entries(source.attributes)) {
    if (sourceAttribute instanceof THREE.InterleavedBufferAttribute) {
      throw new Error(`Villager ${name} attribute must remain non-interleaved`);
    }
    const attribute = sourceAttribute as THREE.BufferAttribute;
    const itemCount = attribute.array.length;
    const ArrayType = attribute.array.constructor as {
      new(length: number): typeof attribute.array;
    };
    const values = new ArrayType(itemCount * rigCount);
    for (let slot = 0; slot < rigCount; slot++) {
      const targetOffset = slot * itemCount;
      values.set(attribute.array, targetOffset);
      if (name !== 'skinIndex') continue;
      const boneOffset = slot * bonesPerRig;
      for (let index = 0; index < itemCount; index++) {
        values[targetOffset + index] += boneOffset;
      }
    }
    const replicated = new THREE.BufferAttribute(
      values,
      attribute.itemSize,
      attribute.normalized,
    );
    replicated.setUsage(attribute.usage);
    merged.setAttribute(name, replicated);
  }
  const sourceIndex = source.index;
  if (sourceIndex) {
    const useUint32 = sourceVertexCount * rigCount > 65_535;
    const values = useUint32
      ? new Uint32Array(sourceIndex.count * rigCount)
      : new Uint16Array(sourceIndex.count * rigCount);
    for (let slot = 0; slot < rigCount; slot++) {
      const vertexOffset = slot * sourceVertexCount;
      const targetOffset = slot * sourceIndex.count;
      for (let index = 0; index < sourceIndex.count; index++) {
        values[targetOffset + index] = sourceIndex.getX(index) + vertexOffset;
      }
    }
    merged.setIndex(new THREE.BufferAttribute(values, 1));
  }
  const vertexCount = sourceVertexCount * rigCount;
  const colors = new THREE.Float32BufferAttribute(vertexCount * 3, 3);
  colors.setUsage(THREE.DynamicDrawUsage);
  merged.setAttribute('color', colors);
  return merged;
}

function publishAnimatedColorRanges(
  layer: AnimatedBatchLayer,
  slotCount: number,
): void {
  const attribute = layer.geometry.getAttribute('color') as THREE.BufferAttribute;
  attribute.clearUpdateRanges();
  let runStart = -1;
  for (let slot = 0; slot <= slotCount; slot++) {
    if (slot < slotCount && layer.dirtyColors[slot]) {
      if (runStart < 0) runStart = slot;
      continue;
    }
    if (runStart < 0) continue;
    attribute.addUpdateRange(
      runStart * layer.sourceVertexCount * attribute.itemSize,
      (slot - runStart) * layer.sourceVertexCount * attribute.itemSize,
    );
    runStart = -1;
  }
  if (attribute.updateRanges.length > 0) attribute.needsUpdate = true;
}

function configureActionSpeeds(
  actions: Record<VillagerRenderMode, THREE.AnimationAction>,
  movementSpeed: number,
): void {
  actions.walk.setEffectiveTimeScale(
    locomotionAnimationTimeScale('walk', movementSpeed),
  );
  actions.sit.setEffectiveTimeScale(1.15);
  actions.rest.setEffectiveTimeScale(0.72);
  actions.talk.setEffectiveTimeScale(0.82);
  actions.pray.setEffectiveTimeScale(0.72);
  actions.chop.setEffectiveTimeScale(1.08);
  actions.mine.setEffectiveTimeScale(0.9);
  actions.gather.setEffectiveTimeScale(0.92);
  actions.plant.setEffectiveTimeScale(0.78);
  actions.sow.setEffectiveTimeScale(0.94);
  actions.fish.setEffectiveTimeScale(0.82);
  actions.tend.setEffectiveTimeScale(0.9);
  actions.build.setEffectiveTimeScale(1.08);
  actions.fight.setEffectiveTimeScale(1.22);
  actions.relax.setEffectiveTimeScale(0.82);
  actions.look.setEffectiveTimeScale(0.86);
  actions.wait.setEffectiveTimeScale(0.82);
  actions.laugh.setEffectiveTimeScale(0.9);
  actions.greet.setEffectiveTimeScale(0.92);
  actions.sermon.setEffectiveTimeScale(0.82);
  actions.agree.setEffectiveTimeScale(0.9);
  actions.bow.setEffectiveTimeScale(0.78);
  actions.carry.setEffectiveTimeScale(0.9);
  actions.hurt.setEffectiveTimeScale(1);
  actions.fall.setEffectiveTimeScale(0.95);
  actions.flee.setEffectiveTimeScale(
    locomotionAnimationTimeScale('flee', movementSpeed),
  );
  actions.run.setEffectiveTimeScale(
    locomotionAnimationTimeScale('run', movementSpeed),
  );
}

export function restartPooledVillagerActions(
  mixer: THREE.AnimationMixer,
  actions: Record<VillagerRenderMode, THREE.AnimationAction>,
  mode: VillagerRenderMode,
  appearanceSeed: number,
  movementSpeed: number,
): void {
  mixer.stopAllAction();
  for (const action of Object.values(actions)) action.stop();
  configureActionSpeeds(actions, movementSpeed);
  const activeAction = actions[mode];
  activeAction.reset().play();
  if (!CLAMPED_ACTION_MODES.has(mode)) {
    activeAction.time = (appearanceSeed % 997) / 997
      * activeAction.getClip().duration;
  }
}

function sourceKeyForAgent(agent: CrowdRenderAgent): VillagerSourceKey {
  if (agent.presentation === 'cleric') return 'cleric';
  if (agent.presentation === 'raider') return 'raider';
  return agent.variant;
}

function animatedPoolKey(
  variant: VillagerSourceKey,
  tool: WorkerToolKind | null,
): string {
  return `${variant}:${tool ?? 'unarmed'}`;
}

async function loadVillagerSource(
  url: string,
  targetHeight: number,
  clipFactory?: (
    animations: readonly THREE.AnimationClip[],
  ) => Record<VillagerRenderMode, THREE.AnimationClip>,
): Promise<VillagerSource> {
  const gltf = await new GLTFLoader().loadAsync(url);
  const bounds = new THREE.Box3().setFromObject(gltf.scene);
  const sourceHeight = bounds.max.y - bounds.min.y;
  if (!Number.isFinite(sourceHeight) || sourceHeight <= 0.001) {
    throw new Error(`Invalid villager model bounds for ${url}`);
  }
  if (clipFactory) {
    return {
      scene: gltf.scene,
      bounds,
      sourceHeight,
      targetHeight,
      clips: clipFactory(gltf.animations),
    };
  }
  const idle = findAnimationClip(gltf.animations, 'idle');
  const walk = findAnimationClip(gltf.animations, 'walk');
  if (idle && walk && findAnimationClip(gltf.animations, 'standing_relax')) {
    const clips = findAnimationClip(gltf.animations, 'greet_04')
      && findAnimationClip(gltf.animations, 'laugh_01')
      ? createClericClipSet(gltf.animations)
      : createSemanticWorkerClipSet(gltf.animations);
    return {
      scene: gltf.scene,
      bounds,
      sourceHeight,
      targetHeight,
      clips,
    };
  }
  const sitting = findAnimationClip(gltf.animations, 'sitting');
  const swing = findAnimationClip(gltf.animations, 'swordslash');
  if (!idle || !walk || !sitting || !swing) {
    throw new Error(`Missing idle/walk/sitting/swing clips in ${url}`);
  }
  const sit = sitting.clone();
  sit.name = `${sitting.name}:ambient-sit`;
  const rest = createRestAnimationClip(sitting);
  const talk = createTalkAnimationClip(gltf.scene, idle);
  const pray = createPrayerAnimationClip(gltf.scene, idle);
  const chop = swing.clone();
  chop.name = `${swing.name}:worker-chop`;
  const mine = swing.clone();
  mine.name = `${swing.name}:worker-mine`;
  const plant = swing.clone();
  plant.name = `${swing.name}:worker-plant`;
  const build = swing.clone();
  build.name = `${swing.name}:worker-build`;
  const fight = swing.clone();
  fight.name = `${swing.name}:combat-fight`;
  const gather = createGatherAnimationClip(gltf.scene);
  const sow = createSowAnimationClip(gltf.scene);
  const fish = createFishingAnimationClip(gltf.scene);
  const tend = createTendAnimationClip(gltf.scene);
  return {
    scene: gltf.scene,
    bounds,
    sourceHeight,
    targetHeight,
    clips: {
      idle,
      walk,
      sit,
      rest,
      talk,
      pray,
      chop,
      mine,
      gather,
      plant,
      sow,
      fish,
      tend,
      build,
      fight,
      relax: idle,
      look: idle,
      wait: idle,
      laugh: talk,
      greet: talk,
      sermon: talk,
      agree: talk,
      bow: pray,
      carry: gather,
      hurt: fight,
      fall: rest,
      flee: walk,
      run: walk,
    },
  };
}

export function createSemanticWorkerClipSet(
  animations: readonly THREE.AnimationClip[],
): Record<VillagerRenderMode, THREE.AnimationClip> {
  const forMode = (sourceName: string, mode: VillagerRenderMode): THREE.AnimationClip => {
    const source = findAnimationClip(animations, sourceName);
    if (!source) throw new Error(`Missing ${sourceName} semantic worker clip`);
    const clip = source.clone();
    clip.name = `${source.name}:game-${mode}`;
    return clip;
  };

  return {
    idle: forMode('idle', 'idle'),
    walk: forMode('walk', 'walk'),
    sit: forMode('sit', 'sit'),
    // Both seated behavior states must end on the authored seated pose because
    // their world roots are aligned to benches and fireside supports.
    rest: forMode('sit', 'rest'),
    // V002 deliberately omits social gestures. Conversation and devotion keep
    // their gameplay states and facing, but use calm neutral authored motion.
    talk: forMode('standing_relax', 'talk'),
    pray: forMode('wait', 'pray'),
    chop: forMode('chop', 'chop'),
    mine: forMode('dig', 'mine'),
    gather: forMode('lift_heavy', 'gather'),
    plant: forMode('dig', 'plant'),
    sow: forMode('shovel', 'sow'),
    fish: forMode('wait', 'fish'),
    tend: forMode('shovel', 'tend'),
    build: forMode('chop', 'build'),
    fight: forMode('slash', 'fight'),
    relax: forMode('standing_relax', 'relax'),
    look: forMode('look_around', 'look'),
    wait: forMode('wait', 'wait'),
    laugh: forMode('standing_relax', 'laugh'),
    greet: forMode('standing_relax', 'greet'),
    sermon: forMode('standing_relax', 'sermon'),
    agree: forMode('standing_relax', 'agree'),
    bow: forMode('wait', 'bow'),
    carry: forMode('lift_heavy', 'carry'),
    hurt: forMode('hit_to_body_01', 'hurt'),
    fall: forMode('fall', 'fall'),
    flee: forMode('flee_01', 'flee'),
    run: forMode('run', 'run'),
  };
}

export const RAIDER_SOURCE_CLIP_BY_MODE = {
  idle: 'idle',
  walk: 'walk',
  sit: 'standing_relax',
  rest: 'standing_relax',
  talk: 'angry_01',
  pray: 'wait',
  chop: 'chop',
  mine: 'chop',
  gather: 'lift_heavy',
  plant: 'lift_heavy',
  sow: 'lift_heavy',
  fish: 'wait',
  tend: 'chop',
  build: 'chop',
  fight: 'slash',
  relax: 'standing_relax',
  look: 'look_around',
  wait: 'wait',
  laugh: 'cheer',
  greet: 'angry_01',
  sermon: 'angry_01',
  agree: 'cheer',
  bow: 'wait',
  carry: 'lift_heavy',
  hurt: 'hit_to_body_01',
  fall: 'fall',
  flee: 'flee_01',
  run: 'run',
} as const satisfies Record<VillagerRenderMode, string>;

export function createRaiderClipSet(
  animations: readonly THREE.AnimationClip[],
): Record<VillagerRenderMode, THREE.AnimationClip> {
  return Object.fromEntries(
    (Object.entries(RAIDER_SOURCE_CLIP_BY_MODE) as Array<
      [VillagerRenderMode, string]
    >).map(([mode, sourceName]) => {
      const source = findAnimationClip(animations, sourceName);
      if (!source) throw new Error(`Missing ${sourceName} semantic Ottoman raider clip`);
      const clip = source.clone();
      clip.name = `${source.name}:raider-${mode}`;
      return [mode, clip];
    }),
  ) as Record<VillagerRenderMode, THREE.AnimationClip>;
}

export const CLERIC_SOURCE_CLIP_BY_MODE = {
  idle: 'idle',
  walk: 'walk',
  sit: 'sit',
  rest: 'sit',
  talk: 'greet_01',
  pray: 'bow',
  chop: 'chop',
  mine: 'dig',
  gather: 'lift_heavy',
  plant: 'dig',
  sow: 'shovel',
  fish: 'wait',
  tend: 'shovel',
  build: 'chop',
  fight: 'slash',
  relax: 'standing_relax',
  look: 'look_around',
  wait: 'wait',
  laugh: 'laugh_01',
  greet: 'greet_01',
  sermon: 'greet_04',
  agree: 'agree',
  bow: 'bow',
  carry: 'lift_heavy',
  hurt: 'hit_to_body_01',
  fall: 'fall',
  flee: 'flee_01',
  run: 'run',
} as const satisfies Record<VillagerRenderMode, ClericAuthoredAnimationName>;

export function createClericClipSet(
  animations: readonly THREE.AnimationClip[],
): Record<VillagerRenderMode, THREE.AnimationClip> {
  return Object.fromEntries(
    (Object.entries(CLERIC_SOURCE_CLIP_BY_MODE) as Array<
      [VillagerRenderMode, ClericAuthoredAnimationName]
    >).map(([mode, sourceName]) => {
      const source = findAnimationClip(animations, sourceName);
      if (!source) throw new Error(`Missing ${sourceName} authored cleric clip`);
      const clip = source.clone();
      clip.name = `${source.name}:cleric-${mode}`;
      return [mode, clip];
    }),
  ) as Record<VillagerRenderMode, THREE.AnimationClip>;
}

/**
 * Keeps the pack's authored sitting transition but relaxes the upper body into
 * a visibly different fireside rest pose.
 */
function createRestAnimationClip(
  sitting: THREE.AnimationClip,
): THREE.AnimationClip {
  const clip = sitting.clone();
  clip.name = `${sitting.name}:ambient-rest`;
  const offsets = new Map<string, THREE.Euler>([
    ['Abdomen.quaternion', new THREE.Euler(0.2, 0, 0.05)],
    ['Torso.quaternion', new THREE.Euler(0.16, 0, -0.04)],
    ['Neck.quaternion', new THREE.Euler(-0.12, 0.06, 0)],
    ['UpperArmL.quaternion', new THREE.Euler(0.1, 0, -0.08)],
    ['UpperArmR.quaternion', new THREE.Euler(0.12, 0, 0.08)],
  ]);
  const pose = new THREE.Quaternion();
  const offset = new THREE.Quaternion();
  for (const track of clip.tracks) {
    const rotation = offsets.get(track.name);
    if (!rotation || !(track instanceof THREE.QuaternionKeyframeTrack)) continue;
    offset.setFromEuler(rotation);
    for (let index = 0; index < track.values.length; index += 4) {
      pose.fromArray(track.values, index).multiply(offset).normalize();
      pose.toArray(track.values, index);
    }
  }
  return clip.optimize();
}

/**
 * Builds a restrained conversational loop over the authored idle body motion.
 * Partners face one another in the behavior planner; this clip supplies the
 * asymmetrical hand and head gestures that make the exchange readable.
 */
function createTalkAnimationClip(
  scene: THREE.Object3D,
  idle: THREE.AnimationClip,
): THREE.AnimationClip {
  const controlledBones = new Set([
    'Abdomen',
    'Torso',
    'Neck',
    'UpperArmL',
    'LowerArmL',
    'UpperArmR',
    'LowerArmR',
  ]);
  const tracks = idle.tracks
    .filter((track) => !controlledBones.has(track.name.split('.')[0]!))
    .map((track) => track.clone());
  const duration = idle.duration;
  const times = [0, 0.16, 0.34, 0.52, 0.72, 0.86, 1].map(
    (fraction) => fraction * duration,
  );
  const gesture = [0, 0.2, 0.66, 0.25, 0.78, 0.18, 0];
  const answer = [0, -0.12, 0.16, -0.08, 0.12, -0.05, 0];

  const addRotation = (
    boneName: string,
    xScale: number,
    yScale = 0,
    zScale = 0,
  ): void => {
    const bone = scene.getObjectByName(boneName);
    if (!bone) return;
    const values: number[] = [];
    for (let index = 0; index < times.length; index += 1) {
      const poseOffset = new THREE.Quaternion().setFromEuler(new THREE.Euler(
        gesture[index]! * xScale,
        answer[index]! * yScale,
        gesture[index]! * zScale,
        'XYZ',
      ));
      const pose = bone.quaternion.clone().multiply(poseOffset).normalize();
      values.push(pose.x, pose.y, pose.z, pose.w);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(
      `${boneName}.quaternion`,
      times,
      values,
    ));
  };

  addRotation('Abdomen', 0.05, 0.22, 0.05);
  addRotation('Torso', 0.08, 0.3, 0.08);
  addRotation('Neck', -0.06, -0.48, -0.05);
  addRotation('UpperArmL', 0.12, 0.08, -0.16);
  addRotation('LowerArmL', 0.18, 0, -0.12);
  addRotation('UpperArmR', 0.42, -0.1, 0.34);
  addRotation('LowerArmR', 0.58, 0, 0.18);

  return new THREE.AnimationClip('Villager_Ambient_Talk', duration, tracks).optimize();
}

/**
 * Restrained standing devotion built from the source rig's idle pose. Hands
 * remain gathered near the chest while the head and torso make one slow,
 * frame-rate-independent mixer loop; there is deliberately no root motion.
 */
export function createPrayerAnimationClip(
  scene: THREE.Object3D,
  idle: THREE.AnimationClip,
): THREE.AnimationClip {
  const controlledBones = new Set([
    'Abdomen',
    'Torso',
    'Neck',
    'UpperArmL',
    'LowerArmL',
    'UpperArmR',
    'LowerArmR',
  ]);
  const tracks = idle.tracks
    .filter((track) => !controlledBones.has(track.name.split('.')[0]!))
    .map((track) => track.clone());
  const duration = Math.max(2.4, idle.duration);
  const times = [0, 0.25, 0.5, 0.75, 1].map((fraction) => fraction * duration);
  const breath = [0, 1, 0, -0.45, 0];

  const addRotation = (
    boneName: string,
    base: THREE.Euler,
    breathScale: THREE.Euler = new THREE.Euler(),
  ): void => {
    const bone = scene.getObjectByName(boneName);
    if (!bone) return;
    const values: number[] = [];
    for (let index = 0; index < times.length; index += 1) {
      const pulse = breath[index]!;
      const offset = new THREE.Quaternion().setFromEuler(new THREE.Euler(
        base.x + breathScale.x * pulse,
        base.y + breathScale.y * pulse,
        base.z + breathScale.z * pulse,
        'XYZ',
      ));
      const pose = bone.quaternion.clone().multiply(offset).normalize();
      values.push(pose.x, pose.y, pose.z, pose.w);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(
      `${boneName}.quaternion`,
      times,
      values,
    ));
  };

  const addQuaternionPose = (
    boneName: string,
    pose: THREE.Quaternion,
  ): void => {
    const values: number[] = [];
    for (let index = 0; index < times.length; index += 1) {
      values.push(pose.x, pose.y, pose.z, pose.w);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(
      `${boneName}.quaternion`,
      times,
      values,
    ));
  };

  scene.updateMatrixWorld(true);
  const torso = scene.getObjectByName('Torso');
  const neck = scene.getObjectByName('Neck');
  const armPose = new Map<string, THREE.Quaternion>();
  if (torso && neck) {
    const torsoWorld = torso.getWorldPosition(new THREE.Vector3());
    const neckWorld = neck.getWorldPosition(new THREE.Vector3());
    const sceneWorldQuaternion = scene.getWorldQuaternion(new THREE.Quaternion());
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(sceneWorldQuaternion);
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(sceneWorldQuaternion);
    const handCenter = torsoWorld.clone()
      .lerp(neckWorld, 0.42)
      .addScaledVector(forward, 0.28);

    const aimBone = (
      bone: THREE.Object3D,
      child: THREE.Object3D,
      targetWorld: THREE.Vector3,
    ): THREE.Quaternion => {
      const origin = bone.getWorldPosition(new THREE.Vector3());
      const desiredWorld = targetWorld.clone().sub(origin).normalize();
      const parentWorld = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
      const desiredParent = desiredWorld.applyQuaternion(parentWorld.invert());
      const boneAxis = child.position.clone().normalize();
      return new THREE.Quaternion()
        .setFromUnitVectors(boneAxis, desiredParent)
        .normalize();
    };

    for (const side of ['L', 'R'] as const) {
      const upper = scene.getObjectByName(`UpperArm${side}`);
      const lower = scene.getObjectByName(`LowerArm${side}`);
      const palm = scene.getObjectByName(`Palm${side}`);
      if (!upper || !lower || !palm || !upper.parent) continue;
      const originalUpper = upper.quaternion.clone();
      const originalLower = lower.quaternion.clone();
      const shoulder = upper.getWorldPosition(new THREE.Vector3());
      const upperLength = lower.getWorldPosition(new THREE.Vector3())
        .distanceTo(shoulder);
      const lowerLength = palm.getWorldPosition(new THREE.Vector3())
        .distanceTo(lower.getWorldPosition(new THREE.Vector3()));
      const sideSign = side === 'L' ? 1 : -1;
      const handTarget = handCenter.clone().addScaledVector(right, sideSign * 0.045);
      const shoulderToHand = handTarget.clone().sub(shoulder);
      const distance = Math.max(
        1e-4,
        Math.min(
          upperLength + lowerLength - 1e-4,
          shoulderToHand.length(),
        ),
      );
      const direction = shoulderToHand.normalize();
      const along = (
        upperLength * upperLength
        - lowerLength * lowerLength
        + distance * distance
      ) / (2 * distance);
      const bendDistance = Math.sqrt(Math.max(
        0,
        upperLength * upperLength - along * along,
      ));
      const preferredBend = right.clone().multiplyScalar(sideSign * 0.7)
        .add(new THREE.Vector3(0, -1, 0))
        .addScaledVector(forward, 0.12);
      const perpendicular = preferredBend
        .addScaledVector(direction, -preferredBend.dot(direction))
        .normalize();
      const elbowTarget = shoulder.clone()
        .addScaledVector(direction, along)
        .addScaledVector(perpendicular, bendDistance);

      const upperPose = aimBone(upper, lower, elbowTarget);
      upper.quaternion.copy(upperPose);
      upper.updateMatrixWorld(true);
      const lowerPose = aimBone(lower, palm, handTarget);
      lower.quaternion.copy(lowerPose);
      lower.updateMatrixWorld(true);
      armPose.set(`UpperArm${side}`, upperPose);
      armPose.set(`LowerArm${side}`, lowerPose);
      upper.quaternion.copy(originalUpper);
      lower.quaternion.copy(originalLower);
      upper.updateMatrixWorld(true);
    }
  }

  addRotation('Abdomen', new THREE.Euler(0.07, 0, 0), new THREE.Euler(0.012, 0, 0));
  addRotation('Torso', new THREE.Euler(0.09, 0, 0), new THREE.Euler(0.016, 0, 0));
  addRotation('Neck', new THREE.Euler(0.2, 0, 0), new THREE.Euler(0.025, 0, 0));
  for (const [boneName, pose] of armPose) addQuaternionPose(boneName, pose);

  return new THREE.AnimationClip(
    'Villager_Devotional_Prayer',
    duration,
    tracks,
  ).optimize();
}

/**
 * The CC0 villager pack has no harvesting clip, so build a small skeletal
 * crouch-and-reach cycle from the rig's own rest pose. This keeps feet planted
 * while the abdomen, torso, and arms bend toward low berry and mushroom props.
 */
function createGatherAnimationClip(scene: THREE.Object3D): THREE.AnimationClip {
  const times = [0, 0.32, 0.72, 1.02, 1.3, 1.62, 2.02, 2.4];
  const bend = [0, 0.2, 0.62, 0.74, 0.58, 0.73, 0.28, 0];
  const reach = [0, 0.12, 0.5, 0.7, 0.42, 0.68, 0.18, 0];
  const tracks: THREE.KeyframeTrack[] = [];

  const addRotation = (
    boneName: string,
    xScale: number,
    zScale = 0,
  ): void => {
    const bone = scene.getObjectByName(boneName);
    if (!bone) return;
    const values: number[] = [];
    for (let index = 0; index < times.length; index++) {
      const offset = new THREE.Quaternion().setFromEuler(new THREE.Euler(
        bend[index]! * xScale,
        0,
        reach[index]! * zScale,
        'XYZ',
      ));
      const pose = bone.quaternion.clone().multiply(offset).normalize();
      values.push(pose.x, pose.y, pose.z, pose.w);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(
      `${boneName}.quaternion`,
      times,
      values,
    ));
  };

  addRotation('Hips', 0.18);
  addRotation('Abdomen', 0.62);
  addRotation('Torso', 0.48);
  addRotation('Neck', -0.22);
  addRotation('UpperLegL', -0.28);
  addRotation('UpperLegR', -0.28);
  addRotation('LowerLegL', 0.36);
  addRotation('LowerLegR', 0.36);
  addRotation('UpperArmL', 0.5, -0.16);
  addRotation('UpperArmR', 0.5, 0.16);
  addRotation('LowerArmL', 0.34);
  addRotation('LowerArmR', 0.34);

  return new THREE.AnimationClip('Worker_Gather', 2.4, tracks).optimize();
}

/**
 * A semantic sowing cycle: the worker crouches to take a handful of seed,
 * rises with the left arm held like a pouch, then broadcasts it in a broad
 * right-handed sweep. The final keyframe returns every joint to the source
 * pose so transitions back to walking or hoe work do not retain a twist.
 */
function createSowAnimationClip(scene: THREE.Object3D): THREE.AnimationClip {
  const times = [0, 0.28, 0.64, 0.92, 1.18, 1.42, 1.7, 2.02, 2.3, 2.62, 2.92, 3.2];
  const bend = [0, 0.2, 0.7, 0.58, 0.24, 0.08, 0.02, 0.06, 0.16, 0.52, 0.22, 0];
  const twist = [0, 0.02, 0.06, 0.02, -0.16, -0.36, 0.24, 0.12, -0.12, 0.03, 0.04, 0];
  const cast = [0, 0.04, 0.12, 0.2, -0.15, -0.56, 0.82, 0.26, -0.3, -0.08, 0.14, 0];
  const rightPitch = [0, 0.12, 0.54, 0.42, 0.26, 0.5, 0.86, 0.4, 0.32, 0.5, 0.2, 0];
  const rightElbow = [0, 0.18, 0.7, 0.62, 0.46, 0.8, 0.16, 0.32, 0.58, 0.72, 0.28, 0];
  const leftPitch = [0, 0.14, 0.52, 0.6, 0.48, 0.42, 0.32, 0.44, 0.54, 0.6, 0.26, 0];
  const cradle = [0, -0.04, -0.12, -0.2, -0.32, -0.3, -0.24, -0.3, -0.28, -0.18, -0.08, 0];
  const tracks: THREE.KeyframeTrack[] = [];

  const addRotation = (
    boneName: string,
    rotationAt: (index: number) => readonly [number, number, number],
  ): void => {
    const bone = scene.getObjectByName(boneName);
    if (!bone) return;
    const values: number[] = [];
    for (let index = 0; index < times.length; index++) {
      const [x, y, z] = rotationAt(index);
      const offset = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(x, y, z, 'XYZ'),
      );
      const pose = bone.quaternion.clone().multiply(offset).normalize();
      values.push(pose.x, pose.y, pose.z, pose.w);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(
      `${boneName}.quaternion`,
      times,
      values,
    ));
  };

  addRotation('Hips', (index) => [bend[index]! * 0.18, twist[index]! * 0.16, 0]);
  addRotation('Abdomen', (index) => [bend[index]! * 0.62, twist[index]! * 0.36, 0]);
  addRotation('Torso', (index) => [bend[index]! * 0.44, twist[index]! * 0.58, -twist[index]! * 0.12]);
  addRotation('Neck', (index) => [-bend[index]! * 0.24, -twist[index]! * 0.24, 0]);
  addRotation('UpperLegL', (index) => [-bend[index]! * 0.3, 0, 0]);
  addRotation('UpperLegR', (index) => [-bend[index]! * 0.3, 0, 0]);
  addRotation('LowerLegL', (index) => [bend[index]! * 0.4, 0, 0]);
  addRotation('LowerLegR', (index) => [bend[index]! * 0.4, 0, 0]);
  addRotation('UpperArmL', (index) => [leftPitch[index]!, 0, cradle[index]!]);
  addRotation('LowerArmL', (index) => [leftPitch[index]! * 0.82, 0, cradle[index]! * 0.34]);
  addRotation('UpperArmR', (index) => [rightPitch[index]!, 0, cast[index]!]);
  addRotation('LowerArmR', (index) => [rightElbow[index]!, 0, cast[index]! * 0.2]);
  addRotation('PalmR', (index) => [0, cast[index]! * 0.34, cast[index]! * 0.12]);

  return new THREE.AnimationClip('Worker_Sow', 3.2, tracks).optimize();
}

/**
 * A quiet standing reach-and-check loop for processors, herders, beekeepers,
 * well keepers, and millers. It deliberately avoids a generic weapon swing:
 * these jobs read as tending equipment or handling stock in the yard.
 */
function createTendAnimationClip(scene: THREE.Object3D): THREE.AnimationClip {
  const times = [0, 0.38, 0.82, 1.2, 1.62, 2.08, 2.46];
  const reach = [0, 0.18, 0.54, 0.28, 0.62, 0.2, 0];
  const sway = [0, -0.08, 0.1, -0.05, 0.08, -0.04, 0];
  const tracks: THREE.KeyframeTrack[] = [];

  const addRotation = (
    boneName: string,
    xScale: number,
    zScale = 0,
  ): void => {
    const bone = scene.getObjectByName(boneName);
    if (!bone) return;
    const values: number[] = [];
    for (let index = 0; index < times.length; index++) {
      const offset = new THREE.Quaternion().setFromEuler(new THREE.Euler(
        reach[index]! * xScale,
        0,
        sway[index]! * zScale,
        'XYZ',
      ));
      const pose = bone.quaternion.clone().multiply(offset).normalize();
      values.push(pose.x, pose.y, pose.z, pose.w);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(
      `${boneName}.quaternion`,
      times,
      values,
    ));
  };

  addRotation('Hips', 0.08, 0.35);
  addRotation('Abdomen', 0.22, 0.5);
  addRotation('Torso', 0.28, 0.45);
  addRotation('Neck', -0.12, -0.2);
  addRotation('UpperArmL', 0.48, -0.7);
  addRotation('UpperArmR', 0.58, 0.7);
  addRotation('LowerArmL', 0.42);
  addRotation('LowerArmR', 0.5);

  return new THREE.AnimationClip('Worker_Tend', 2.46, tracks).optimize();
}

/**
 * The villager pack has no fishing clip. This restrained two-handed cast and
 * pull loop keeps the worker planted beside the water and reads clearly
 * without requiring a weapon-like swing.
 */
function createFishingAnimationClip(scene: THREE.Object3D): THREE.AnimationClip {
  const times = [0, 0.46, 0.92, 1.34, 1.82, 2.32, 2.8];
  const pull = [0, 0.16, 0.42, 0.2, 0.5, 0.18, 0];
  const cast = [0, -0.1, 0.16, -0.06, 0.12, -0.04, 0];
  const tracks: THREE.KeyframeTrack[] = [];

  const addRotation = (
    boneName: string,
    xScale: number,
    zScale = 0,
  ): void => {
    const bone = scene.getObjectByName(boneName);
    if (!bone) return;
    const values: number[] = [];
    for (let index = 0; index < times.length; index++) {
      const offset = new THREE.Quaternion().setFromEuler(new THREE.Euler(
        pull[index]! * xScale,
        0,
        cast[index]! * zScale,
        'XYZ',
      ));
      const pose = bone.quaternion.clone().multiply(offset).normalize();
      values.push(pose.x, pose.y, pose.z, pose.w);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(
      `${boneName}.quaternion`,
      times,
      values,
    ));
  };

  addRotation('Abdomen', 0.2, 0.28);
  addRotation('Torso', 0.24, 0.38);
  addRotation('Neck', -0.12);
  addRotation('UpperArmL', 0.7, -0.55);
  addRotation('UpperArmR', 0.7, 0.55);
  addRotation('LowerArmL', 0.64);
  addRotation('LowerArmR', 0.64);

  return new THREE.AnimationClip('Worker_Fish', 2.8, tracks).optimize();
}

function isWorkMode(
  mode: VillagerRenderMode,
): mode is 'chop' | 'mine' | 'gather' | 'plant' | 'sow' | 'fish' | 'tend' | 'build' | 'fight' {
  return mode === 'chop'
    || mode === 'mine'
    || mode === 'gather'
    || mode === 'plant'
    || mode === 'sow'
    || mode === 'fish'
    || mode === 'tend'
    || mode === 'build'
    || mode === 'fight';
}

export function workerToolVisibleInMode(
  kind: WorkerToolKind,
  mode: VillagerRenderMode,
): boolean {
  // Weapons and their secondary mounts belong to the combatant, not to a
  // particular animation. Keeping them visible lets the hand/body bones carry
  // the complete kit continuously through hit, fall, death, and recovery
  // transitions. A future drop must be represented as an explicit detach/drop
  // event rather than inferred from an animation name.
  if (isMilitaryEquipmentKind(kind)) return true;
  // Broadcast sowing needs two empty hands; the farm's hoe must not turn the
  // seed-casting gesture back into a generic tool swing.
  if (mode === 'sow') return false;
  return isWorkMode(mode);
}

/** Keeps ranged and polearm legs neutral while the post-mixer combat rig owns the strike. */
export function combatBaseActionMode(agent: CrowdRenderAgent): VillagerRenderMode {
  if (
    agent.mode !== 'fight'
    || !agent.tool
    || agent.combatAttackCooldown === undefined
  ) return agent.mode;
  if (agent.combatLocomotion === 'walk' || agent.combatLocomotion === 'run') {
    return agent.combatLocomotion;
  }
  const presentation = resolveCombatWeaponPresentation(
    agent.tool,
    agent.combatTargetDistance ?? Infinity,
  );
  return presentation?.neutralBaseClip ? 'wait' : 'fight';
}

function findAnimationClip(
  animations: readonly THREE.AnimationClip[],
  name: string,
): THREE.AnimationClip | undefined {
  return animations.find((clip) => {
    const normalized = clip.name.toLowerCase();
    return normalized === name ||
      normalized.endsWith(`|${name}`) ||
      normalized.endsWith(`_${name}`);
  });
}

function resolvePartColor(
  materialName: string,
  agent: CrowdRenderAgent,
): number {
  const normalized = materialName.toLowerCase();
  if (normalized.includes('skin')) return agent.skinColor;
  if (normalized.includes('hair')) {
    return normalized.endsWith('2')
      ? darkenHex(agent.hairColor, 0.82)
      : agent.hairColor;
  }
  if (normalized.includes('dress') || normalized === 'shirt') {
    return agent.tunicColor;
  }
  if (normalized.includes('shirt')) return darkenHex(agent.tunicColor, 0.78);
  if (normalized.includes('pants')) return darkenHex(agent.tunicColor, 0.56);
  if (normalized.includes('socks')) return 0x776d61;
  if (normalized.includes('shoes')) return 0x3d2b22;
  if (normalized.includes('eyes')) return 0x241e1a;
  return 0xffffff;
}

function darkenHex(hex: number, factor: number): number {
  const r = Math.round(((hex >> 16) & 0xff) * factor);
  const g = Math.round(((hex >> 8) & 0xff) * factor);
  const b = Math.round((hex & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}

function disposeModelResources(source: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  source.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    const materialsForMesh = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
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
