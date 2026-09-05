import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  isPeopleRenderingEnabled,
  isWithinCrowdView,
  type CrowdViewState,
} from './crowdView.ts';
import {
  AuthoredSkinnedInstanceBatch,
  type AuthoredSkinnedInstanceBatchDiagnostic,
} from '../scene/AuthoredSkinnedInstanceBatch.ts';
import {
  ExactMountedAttachmentBatch,
  type ExactMountedAttachmentBatchDiagnostic,
} from './ExactMountedAttachmentBatch.ts';
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
  applyMilitaryCarryPose,
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
import { installMilitaryHandGrip } from './militaryHandGrip.ts';
import type {
  ClericAnimationMode,
  ClericAuthoredAnimationName,
} from './clericBehaviors.ts';

/** Initial allocation only; exact authored batches grow before omitting actors. */
const INITIAL_AUTHORED_BATCH_CAPACITY = 256;
/** Non-visible rig reuse is bounded independently from visible actor capacity. */
const MAX_IDLE_RIG_POOL = 256;
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
const STATIC_SEATED_POSE_MODES = new Set<VillagerRenderMode>(['sit', 'rest']);
const MIN_VILLAGER_ANIMATION_CADENCE = 0.96;
const MAX_VILLAGER_ANIMATION_CADENCE = 1.04;
const MIN_STATIC_SEATED_POSE_FRACTION = 0.58;
const MAX_STATIC_SEATED_POSE_FRACTION = 0.94;
const COMMON_SOCIAL_ACTION_MODES = ['talk', 'greet', 'agree', 'laugh'] as const;
const COMMON_STANDING_ACTION_MODES = ['relax', 'look', 'wait'] as const;

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
  skeleton: THREE.Skeleton;
  /** Last locomotion speed already published to the three authored leg cycles. */
  movementSpeed: number;
  /** Stable per-actor cadence multiplier; never sampled on the frame loop. */
  animationRateScale: number;
};

type AuthoredSlotAppearance = {
  agentId: string;
  tunicColor: number;
  skinColor: number;
  hairColor: number;
};

function variantsShareModelSource(
  a: VillagerSourceKey,
  b: VillagerSourceKey,
): boolean {
  return String(MODEL_URLS[a]) === String(MODEL_URLS[b]);
}

function uniqueAuthoredBatches(
  batches: Record<VillagerSourceKey, AuthoredSkinnedInstanceBatch>,
): AuthoredSkinnedInstanceBatch[] {
  return [...new Set(Object.values(batches))];
}

function uniqueSourceScenes(
  sources: Record<VillagerSourceKey, VillagerSource>,
): THREE.Group[] {
  return [...new Set(Object.values(sources).map((source) => source.scene))];
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
  /** Optional deterministic cadence variation. Ordinary villagers default to 1. */
  animationRateScale?: number;
  active: boolean;
  /** Uses the authored sitting lower-body pose at a horse saddle height. */
  mounted?: boolean;
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

export type VillagerRigPoolSeed = {
  id: string;
  appearanceSeed: number;
  variant: VillagerModelVariant;
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

export type AuthoredCrowdDiagnostic = {
  visibleAgents: number;
  evaluatedRigs: number;
  submittedInstances: number;
  proxyAgents: 0;
  batches: Readonly<Record<VillagerSourceKey, AuthoredSkinnedInstanceBatchDiagnostic>>;
  attachments: ExactMountedAttachmentBatchDiagnostic;
  standards: CompanyStandardDiagnostic;
  performance: {
    syncCpuMs: number;
    visibilityCpuMs: number;
    rigCpuMs: number;
    bodyBatchCpuMs: number;
    attachmentCpuMs: number;
    droppedWeaponCpuMs: number;
    standardCpuMs: number;
    mixerUpdates: number;
    locomotionRateRefreshes: number;
    appearanceColorWrites: number;
    appearanceColorReuses: number;
    activeRigCount: number;
    pooledRigCount: number;
  };
};

export function villagerHeightJitter(appearanceSeed: number): number {
  return 0.96 + ((appearanceSeed >>> 8) & 0xff) / 0xff * 0.08;
}

function mixAnimationSeed(appearanceSeed: number, salt: string): number {
  let hash = (appearanceSeed ^ 0x9e3779b9) >>> 0;
  for (let index = 0; index < salt.length; index += 1) {
    hash ^= salt.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  return (hash ^ (hash >>> 16)) >>> 0;
}

/** Stable, subtle cadence variation for villagers sharing the same authored clip. */
export function villagerAnimationCadenceScale(appearanceSeed: number): number {
  const unit = mixAnimationSeed(appearanceSeed, 'villager-cadence') / 0xffff_ffff;
  return THREE.MathUtils.lerp(
    MIN_VILLAGER_ANIMATION_CADENCE,
    MAX_VILLAGER_ANIMATION_CADENCE,
    unit,
  );
}

/**
 * Gives a standing civilian one stable conversational role. The authored
 * actions still start at a seeded phase and cadence, so a pair alternates
 * speaker/listener gestures instead of mirroring one loop.
 */
export function villagerSocialActionMode(
  appearanceSeed: number,
): (typeof COMMON_SOCIAL_ACTION_MODES)[number] {
  const index = mixAnimationSeed(appearanceSeed, 'civilian-social-role')
    % COMMON_SOCIAL_ACTION_MODES.length;
  return COMMON_SOCIAL_ACTION_MODES[index]!;
}

/** Uses the three calm standing takes shipped in each worker GLB. */
export function villagerStandingActionMode(
  appearanceSeed: number,
): (typeof COMMON_STANDING_ACTION_MODES)[number] {
  const index = mixAnimationSeed(appearanceSeed, 'civilian-standing-role')
    % COMMON_STANDING_ACTION_MODES.length;
  return COMMON_STANDING_ACTION_MODES[index]!;
}

/** Deterministic start phase for looping clips. Mode salting prevents an actor
 * from entering every semantic action at the same normalized pose. */
export function villagerAnimationStartTime(
  mode: VillagerRenderMode,
  appearanceSeed: number,
  duration: number,
): number {
  if (CLAMPED_ACTION_MODES.has(mode) || !Number.isFinite(duration) || duration <= 0) return 0;
  return mixAnimationSeed(appearanceSeed, `phase:${mode}`) / 0x1_0000_0000 * duration;
}

/**
 * Samples the late, already-seated portion of the one-shot sitting clip.
 * Keeping each actor on a stable authored frame avoids a synchronized terminal
 * pose without replaying the stand-to-sit transition or moving hips off their
 * bench/stump contact point.
 */
export function villagerStaticSeatedPoseTime(
  mode: VillagerRenderMode,
  appearanceSeed: number,
  duration: number,
): number | null {
  if (
    !STATIC_SEATED_POSE_MODES.has(mode)
    || !Number.isFinite(duration)
    || duration <= 0
  ) {
    return null;
  }
  const unit = mixAnimationSeed(appearanceSeed, `static-pose:${mode}`) / 0xffff_ffff;
  return duration * THREE.MathUtils.lerp(
    MIN_STATIC_SEATED_POSE_FRACTION,
    MAX_STATIC_SEATED_POSE_FRACTION,
    unit,
  );
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
 * Renders every visible person with the original rigged GLB geometry,
 * materials, textures and animation pose. CPU rigs evaluate gameplay-specific
 * motion while native-WebGPU storage palettes submit each source model in a
 * bounded number of instanced draws. Camera distance never changes asset class.
 */
export class SettlementCrowdRenderer {
  readonly ready: Promise<boolean>;
  private readonly group = new THREE.Group();
  private readonly animatedGroup = new THREE.Group();
  private readonly battlefieldWeaponDrops: BattlefieldWeaponDropRenderer;
  private readonly companyStandards: CompanyStandardRenderer;
  private readonly mountedAttachments: ExactMountedAttachmentBatch;
  private readonly companyStandardTextures: CompanyStandardTextureSet | null;
  private readonly companyStandardAgents: CompanyStandardRenderAgent[] = [];
  private readonly companyStandardAgentPool: CompanyStandardRenderAgent[] = [];
  private readonly companyStandardGrip = new THREE.Vector3();
  private readonly animated = new Map<string, AnimatedVillager>();
  private readonly animatedPool = new Map<string, AnimatedVillager[]>();
  private idlePooledVisualCount = 0;
  private readonly visibleAgents: CrowdRenderAgent[] = [];
  private readonly animatedIds = new Set<string>();
  private readonly combatProjectiles: CombatProjectileRenderer;
  private readonly pendingCombatAttackEvents: CrowdCombatAttackEvent[] = [];
  private readonly combatOrigin = new THREE.Vector3();
  private readonly combatTarget = new THREE.Vector3();
  private sources: Record<VillagerSourceKey, VillagerSource> | null = null;
  private toolSources: WorkerToolSources | null = null;
  private authoredBatches: Record<VillagerSourceKey, AuthoredSkinnedInstanceBatch> | null = null;
  private readonly authoredBatchList: AuthoredSkinnedInstanceBatch[] = [];
  private readonly authoredBatchRequired = new Map<AuthoredSkinnedInstanceBatch, number>();
  private readonly authoredBatchNextSlot = new Map<AuthoredSkinnedInstanceBatch, number>();
  private readonly authoredSlotAppearances = new Map<
    AuthoredSkinnedInstanceBatch,
    AuthoredSlotAppearance[]
  >();
  private readonly latestAgents: CrowdRenderAgent[] = [];
  private lastView: CrowdViewState | undefined;
  private disposed = false;
  private lastSyncCpuMs = 0;
  private lastVisibilityCpuMs = 0;
  private lastRigCpuMs = 0;
  private lastBodyBatchCpuMs = 0;
  private lastAttachmentCpuMs = 0;
  private lastDroppedWeaponCpuMs = 0;
  private lastStandardCpuMs = 0;
  private lastMixerUpdates = 0;
  private lastLocomotionRateRefreshes = 0;
  private lastAppearanceColorWrites = 0;
  private lastAppearanceColorReuses = 0;

  constructor(options: SettlementCrowdRendererOptions) {
    this.group.name = 'Villagers';
    this.animatedGroup.name = 'Animated villagers';
    this.group.add(this.animatedGroup);
    options.parent.add(this.group);
    this.mountedAttachments = new ExactMountedAttachmentBatch(this.animatedGroup, {
      initialCapacity: INITIAL_AUTHORED_BATCH_CAPACITY,
      name: 'Exact villager tools and military equipment',
    });
    this.combatProjectiles = new CombatProjectileRenderer(this.group);

    this.battlefieldWeaponDrops = new BattlefieldWeaponDropRenderer(this.group);
    this.companyStandardTextures = typeof document === 'undefined'
      ? null
      : createCompanyStandardTextures();
    this.companyStandards = new CompanyStandardRenderer({
      parent: this.group,
      capacity: 512,
      artwork: this.companyStandardTextures?.artwork,
    });
    this.ready = this.loadSources();
  }

  syncAgents(
    agents: readonly CrowdRenderAgent[],
    view?: CrowdViewState,
    dtSeconds = 0,
  ): void {
    const syncStartedAt = performance.now();
    this.lastMixerUpdates = 0;
    this.lastLocomotionRateRefreshes = 0;
    this.lastAppearanceColorWrites = 0;
    this.lastAppearanceColorReuses = 0;
    this.lastVisibilityCpuMs = 0;
    this.lastRigCpuMs = 0;
    this.lastBodyBatchCpuMs = 0;
    this.lastAttachmentCpuMs = 0;
    this.lastDroppedWeaponCpuMs = 0;
    this.lastStandardCpuMs = 0;
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
    if (!renderEnabled) {
      this.lastSyncCpuMs = performance.now() - syncStartedAt;
      return;
    }
    this.combatProjectiles.update(dt);

    const visibleAgents = this.visibleAgents;
    visibleAgents.length = 0;
    for (const agent of this.latestAgents) {
      if (agent.active && isWithinCrowdView(agent.x, agent.z, view)) {
        visibleAgents.push(agent);
      }
    }
    this.lastVisibilityCpuMs = performance.now() - syncStartedAt;

    const animatedIds = this.pickAnimatedIds(visibleAgents);
    if (!this.sources) {
      let phaseStartedAt = performance.now();
      this.battlefieldWeaponDrops.sync(visibleAgents, view);
      this.lastDroppedWeaponCpuMs = performance.now() - phaseStartedAt;
      phaseStartedAt = performance.now();
      this.syncCompanyStandards(visibleAgents, view, dt);
      this.lastStandardCpuMs = performance.now() - phaseStartedAt;
      this.lastSyncCpuMs = performance.now() - syncStartedAt;
      return;
    }

    let phaseStartedAt = performance.now();
    this.syncAnimatedVillagers(visibleAgents, animatedIds, dt);
    this.lastRigCpuMs = performance.now() - phaseStartedAt;
    phaseStartedAt = performance.now();
    this.updateAuthoredBatches(visibleAgents);
    this.lastBodyBatchCpuMs = performance.now() - phaseStartedAt;
    phaseStartedAt = performance.now();
    this.mountedAttachments.update();
    this.lastAttachmentCpuMs = performance.now() - phaseStartedAt;
    phaseStartedAt = performance.now();
    this.battlefieldWeaponDrops.sync(visibleAgents, view);
    this.lastDroppedWeaponCpuMs = performance.now() - phaseStartedAt;
    phaseStartedAt = performance.now();
    this.syncCompanyStandards(visibleAgents, view, dt);
    this.lastStandardCpuMs = performance.now() - phaseStartedAt;
    this.lastSyncCpuMs = performance.now() - syncStartedAt;
  }

  beginFirstPlayableGpuPrewarm(): {
    objects: readonly THREE.Object3D[];
    restore: () => void;
  } {
    const changed: Array<{
      mesh: THREE.InstancedMesh;
      visible: boolean;
      count: number;
    }> = [];
    if (!this.authoredBatches) return { objects: [], restore: () => {} };
    for (const batch of uniqueAuthoredBatches(this.authoredBatches)) {
      batch.group.traverse((object) => {
        const mesh = object as THREE.InstancedMesh;
        if (!mesh.isInstancedMesh || mesh.count > 0) return;
        changed.push({ mesh, visible: mesh.visible, count: mesh.count });
        mesh.visible = true;
        mesh.count = 1;
      });
    }
    return {
      // Compile the complete crowd presentation root against the live scene.
      // This includes every exact authored body batch plus any already-created
      // rigid equipment/standard layers, without walking terrain or woodland.
      objects: [this.group],
      restore: () => {
        for (const state of changed) {
          state.mesh.visible = state.visible;
          state.mesh.count = state.count;
        }
      },
    };
  }

  /**
   * Builds the otherwise first-use-only skinned clones and AnimationMixer
   * bindings while the loading screen is still opaque. A new settlement adds
   * all ten founders in one authoritative update; constructing every rig and
   * semantic action on that confirmation frame can block the main thread for
   * seconds even when the shared instanced draw shaders are already compiled.
   */
  async prepareUnarmedRigPool(
    seeds: readonly VillagerRigPoolSeed[],
    onProgress?: (completed: number, total: number) => void,
  ): Promise<number> {
    if (
      this.disposed
      || !this.sources
      || !this.authoredBatches
      || seeds.length === 0
    ) return 0;
    const authoredBatches = this.authoredBatches;

    const desiredByVariant = new Map<VillagerModelVariant, VillagerRigPoolSeed[]>();
    for (const seed of seeds) {
      const desired = desiredByVariant.get(seed.variant) ?? [];
      desired.push(seed);
      desiredByVariant.set(seed.variant, desired);
    }

    const missing: VillagerRigPoolSeed[] = [];
    for (const [variant, desired] of desiredByVariant) {
      const poolKey = animatedPoolKey(variant, null);
      const pooled = this.animatedPool.get(poolKey)?.length ?? 0;
      missing.push(...desired.slice(Math.min(pooled, desired.length)));
    }

    let created = 0;
    onProgress?.(0, missing.length);
    for (const seed of missing) {
      if (this.disposed || !this.sources || this.idlePooledVisualCount >= MAX_IDLE_RIG_POOL) {
        break;
      }
      const agent: CrowdRenderAgent = {
        id: `prewarmed-founder:${seed.id}`,
        slot: created,
        x: 0,
        y: 0,
        z: 0,
        yaw: 0,
        appearanceSeed: seed.appearanceSeed,
        variant: seed.variant,
        presentation: 'common',
        mode: 'idle',
        tunicColor: 0xffffff,
        skinColor: 0xffffff,
        hairColor: 0xffffff,
        tool: null,
        movementSpeed: 0,
        active: false,
      };
      const visual = this.createAnimatedVillager(agent);
      authoredBatches[seed.variant].prepareCloneBinding(visual.model);
      visual.mixer.stopAllAction();
      visual.root.visible = false;
      const poolKey = animatedPoolKey(seed.variant, null);
      const pool = this.animatedPool.get(poolKey) ?? [];
      if (!this.animatedPool.has(poolKey)) this.animatedPool.set(poolKey, pool);
      pool.push(visual);
      this.idlePooledVisualCount += 1;
      created += 1;
      onProgress?.(created, missing.length);

      // Let the opaque loading screen repaint between expensive rig clones.
      // The work stays serialized so it cannot race the live placement path.
      await nextPresentationFrame();
    }
    return created;
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

  hasVisibleShadowCasters(): boolean {
    return this.group.visible
      && this.visibleAgents.length > 0
      && this.authoredBatchList.some((batch) => batch.count > 0);
  }

  getRenderedBodyHeight(id: string): number | null {
    const visual = this.animated.get(id);
    if (!this.group.visible || !visual?.root.visible || !this.sources
      || !this.authoredBatches?.[visual.sourceKey].count) return null;
    return this.sources[visual.sourceKey].sourceHeight * visual.model.scale.y;
  }

  authoredCrowdDiagnostics(): AuthoredCrowdDiagnostic {
    const batches = this.authoredBatches;
    const diagnostics = {} as Record<
      VillagerSourceKey,
      AuthoredSkinnedInstanceBatchDiagnostic
    >;
    if (batches) {
      for (const key of Object.keys(batches) as VillagerSourceKey[]) {
        diagnostics[key] = batches[key].diagnostics();
      }
    }
    return {
      visibleAgents: this.visibleAgents.length,
      evaluatedRigs: this.animated.size,
      submittedInstances: this.authoredBatchList.reduce(
        (total, batch) => total + batch.diagnostics().count,
        0,
      ),
      proxyAgents: 0,
      batches: diagnostics,
      attachments: this.mountedAttachments.diagnostics(),
      standards: this.companyStandards.diagnostics(),
      performance: {
        syncCpuMs: this.lastSyncCpuMs,
        visibilityCpuMs: this.lastVisibilityCpuMs,
        rigCpuMs: this.lastRigCpuMs,
        bodyBatchCpuMs: this.lastBodyBatchCpuMs,
        attachmentCpuMs: this.lastAttachmentCpuMs,
        droppedWeaponCpuMs: this.lastDroppedWeaponCpuMs,
        standardCpuMs: this.lastStandardCpuMs,
        mixerUpdates: this.lastMixerUpdates,
        locomotionRateRefreshes: this.lastLocomotionRateRefreshes,
        appearanceColorWrites: this.lastAppearanceColorWrites,
        appearanceColorReuses: this.lastAppearanceColorReuses,
        activeRigCount: this.animated.size,
        pooledRigCount: this.idlePooledVisualCount,
      },
    };
  }

  dispose(): void {
    this.disposed = true;
    for (const id of this.animated.keys()) this.removeAnimatedVillager(id);
    for (const pool of this.animatedPool.values()) {
      for (const visual of pool) this.disposeAnimatedVillager(visual);
    }
    this.animatedPool.clear();
    this.idlePooledVisualCount = 0;

    if (this.authoredBatches) {
      for (const batch of uniqueAuthoredBatches(this.authoredBatches)) batch.dispose();
      this.authoredBatches = null;
    }
    this.authoredBatchList.length = 0;
    this.authoredBatchRequired.clear();
    this.authoredBatchNextSlot.clear();
    this.authoredSlotAppearances.clear();
    this.mountedAttachments.dispose();

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
      // The raider pack has no seated clip. Reuse the worker's authored seated
      // motion on its matching named skeleton, preserving the raider's proportions.
      raider.clips.sit = retargetSeatedClip(man, raider);
      raider.clips.rest = raider.clips.sit;
      // The reduced worker exports omit their original social takes, while the
      // compatible cleric rig still ships greet, agree, laugh, and broad-address
      // motion. Retarget those authored tracks onto both civilian bodies rather
      // than leaving every camp conversation in standing_relax.
      installWorkerSocialClips(cleric, man);
      if (woman.scene !== man.scene) installWorkerSocialClips(cleric, woman);
      this.sources = { man, woman, cleric, raider };
      this.toolSources = tools;
      this.battlefieldWeaponDrops.configureSources(tools);
      const manBatch = this.createAuthoredBatch('man', man);
      this.authoredBatches = {
        man: manBatch,
        woman: variantsShareModelSource('man', 'woman')
          ? manBatch
          : this.createAuthoredBatch('woman', woman),
        cleric: this.createAuthoredBatch('cleric', cleric),
        raider: this.createAuthoredBatch('raider', raider),
      };
      this.authoredBatchList.push(...uniqueAuthoredBatches(this.authoredBatches));
      for (const batch of this.authoredBatchList) {
        this.authoredBatchRequired.set(batch, 0);
        this.authoredBatchNextSlot.set(batch, 0);
        this.authoredSlotAppearances.set(batch, []);
      }
      this.syncAgents(this.latestAgents, this.lastView);
      return true;
    } catch (error) {
      console.warn('[Villagers] Animated villager sources failed to load.', error);
      return false;
    }
  }

  private pickAnimatedIds(
    agents: readonly CrowdRenderAgent[],
  ): Set<string> {
    const animatedIds = this.animatedIds;
    animatedIds.clear();
    for (const agent of agents) animatedIds.add(agent.id);
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
        this.transition(visual, agent.mode, nextActionMode, agent.appearanceSeed);
      }
      const animationRateScale = resolvedAnimationRateScale(
        agent.animationRateScale,
        agent.appearanceSeed,
      );
      if (visual.animationRateScale !== animationRateScale) {
        configureActionSpeeds(visual.actions, agent.movementSpeed, animationRateScale);
        visual.animationRateScale = animationRateScale;
        visual.movementSpeed = agent.movementSpeed;
        this.lastLocomotionRateRefreshes += 1;
      } else if (visual.movementSpeed !== agent.movementSpeed) {
        configureLocomotionActionSpeeds(
          visual.actions,
          agent.movementSpeed,
          animationRateScale,
        );
        visual.movementSpeed = agent.movementSpeed;
        this.lastLocomotionRateRefreshes += 1;
      }
      if (dt > 0) {
        visual.mixer.update(dt);
        this.lastMixerUpdates += 1;
      }
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
        animated.combatRig.armBones.leftHand.localToWorld(this.companyStandardGrip.set(.005, .0383, -.0071));
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
      this.mountedAttachments.registerTool(tool);
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
    const animationRateScale = resolvedAnimationRateScale(
      agent.animationRateScale,
      agent.appearanceSeed,
    );
    configureActionSpeeds(actions, agent.movementSpeed, animationRateScale);
    const actionMode = combatBaseActionMode(agent);
    const activeAction = actions[actionMode];
    activeAction.play();
    configureVillagerActionStart(activeAction, actionMode, agent.appearanceSeed);

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
      skeleton,
      movementSpeed: agent.movementSpeed,
      animationRateScale,
    };
  }

  private acquireAnimatedVillager(agent: CrowdRenderAgent): AnimatedVillager {
    const poolKey = animatedPoolKey(sourceKeyForAgent(agent), agent.tool);
    const pool = this.animatedPool.get(poolKey);
    const pooledVisual = pool?.pop();
    if (pooledVisual) this.idlePooledVisualCount -= 1;
    const visual = pooledVisual ?? this.createAnimatedVillager(agent);
    if (pooledVisual) this.resetPooledVillager(visual, agent);
    if (pooledVisual?.tool && !this.mountedAttachments.hasTool(pooledVisual.tool)) {
      this.mountedAttachments.registerTool(pooledVisual.tool);
    }
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
    visual.movementSpeed = agent.movementSpeed;
    visual.animationRateScale = resolvedAnimationRateScale(
      agent.animationRateScale,
      agent.appearanceSeed,
    );
    if (visual.combatRig) resetCombatWeaponRig(visual.combatRig);
    visual.root.name = `${sourceKey === 'cleric' ? 'Cleric' : sourceKey === 'raider' ? 'Ottoman raider' : agent.variant === 'woman' ? 'Woman' : 'Man'} villager ${agent.id}`;
    visual.root.userData.villagerId = agent.id;
    visual.root.userData.villagerGender = agent.variant;
    visual.model.scale.setScalar(scale);
    visual.model.position.y = -source.bounds.min.y * scale + MODEL_GROUNDING_HEIGHT;
    restartPooledVillagerActions(
      visual.mixer,
      visual.actions,
      visual.actionMode,
      agent.appearanceSeed,
      agent.movementSpeed,
      visual.animationRateScale,
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
    appearanceSeed: number,
  ): void {
    if (visual.mode === nextMode && visual.actionMode === nextActionMode) return;
    if (visual.actionMode !== nextActionMode) {
      const previousAction = visual.actions[visual.actionMode];
      const preserveStride = ['walk', 'run', 'flee'].includes(visual.actionMode)
        && ['walk', 'run', 'flee'].includes(nextActionMode);
      const stridePhase = previousAction.time / previousAction.getClip().duration;
      previousAction.fadeOut(0.18);
      const nextAction = visual.actions[nextActionMode].reset();
      configureVillagerActionStart(nextAction, nextActionMode, appearanceSeed);
      if (preserveStride) nextAction.time = (stridePhase % 1) * nextAction.getClip().duration;
      nextAction.fadeIn(0.18).play();
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
        if (visual.combatRig) applyMilitaryCarryPose(visual.combatRig, agent.tool, agent.mode);
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
    if (visual.tool) this.mountedAttachments.unregisterTool(visual.tool);
    this.animated.delete(id);
    if (this.idlePooledVisualCount >= MAX_IDLE_RIG_POOL) {
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
    if (visual.tool) this.mountedAttachments.unregisterTool(visual.tool);
    if (visual.combatRig) disposeCombatWeaponRig(visual.combatRig);
    visual.root.removeFromParent();
  }

  private createAuthoredBatch(
    variant: VillagerSourceKey,
    source: VillagerSource,
  ): AuthoredSkinnedInstanceBatch {
    // Keep the established outdoor response while retaining the authored PBR
    // asset itself. The instanced node materials borrow every source texture;
    // they do not bake, simplify, atlas, or replace the GLB material inputs.
    if (!source.scene.userData.villagerLightingConfigured) {
      source.scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        const materials = Array.isArray(mesh.material)
          ? mesh.material
          : mesh.material
            ? [mesh.material]
            : [];
        for (const material of materials) {
          if (material instanceof THREE.MeshStandardMaterial) {
            configureVillagerMaterialLighting(material);
          }
        }
      });
      source.scene.userData.villagerLightingConfigured = true;
    }
    return new AuthoredSkinnedInstanceBatch({
      parent: this.animatedGroup,
      sourceRoot: source.scene,
      capacity: INITIAL_AUTHORED_BATCH_CAPACITY,
      name: `${variant} exact authored crowd`,
      castShadow: true,
      receiveShadow: true,
    });
  }

  private updateAuthoredBatches(
    agents: readonly CrowdRenderAgent[],
  ): void {
    const batches = this.authoredBatches;
    if (!batches) return;

    // Count first so storage grows deliberately before any slot is written.
    // A shared source (for example an interim male/female asset) remains one
    // batch and receives one continuous, omission-free slot range.
    const required = this.authoredBatchRequired;
    for (const batch of this.authoredBatchList) required.set(batch, 0);
    for (const agent of agents) {
      if (!this.animated.has(agent.id)) continue;
      const batch = batches[sourceKeyForAgent(agent)];
      required.set(batch, (required.get(batch) ?? 0) + 1);
    }
    for (const [batch, count] of required) {
      batch.reserve(count);
      batch.setCount(count);
    }

    const nextSlot = this.authoredBatchNextSlot;
    for (const batch of this.authoredBatchList) nextSlot.set(batch, 0);
    for (const agent of agents) {
      const visual = this.animated.get(agent.id);
      if (!visual) continue;
      const batch = batches[sourceKeyForAgent(agent)];
      const slot = nextSlot.get(batch) ?? 0;
      nextSlot.set(batch, slot + 1);

      // This publishes the exact AnimationMixer pose and the clone's complete
      // source transform chain. It intentionally retains unusual authored rig
      // parents (including -90 degree axes or scale-100 import transforms).
      batch.setFromCloneAt(slot, visual.model);
      this.updateAuthoredSlotAppearance(batch, slot, agent);
    }
    for (const batch of required.keys()) batch.commit();
  }

  /**
   * Appearance is identity-stable while an actor occupies a batch slot. Avoid
   * rebuilding and uploading the same material colors every animation frame;
   * pose and transform palettes still update for every authored actor.
   */
  private updateAuthoredSlotAppearance(
    batch: AuthoredSkinnedInstanceBatch,
    slot: number,
    agent: CrowdRenderAgent,
  ): void {
    const appearances = this.authoredSlotAppearances.get(batch);
    if (!appearances) throw new Error('Missing exact authored batch appearance cache');
    let cached = appearances[slot];
    if (
      cached
      && cached.agentId === agent.id
      && cached.tunicColor === agent.tunicColor
      && cached.skinColor === agent.skinColor
      && cached.hairColor === agent.hairColor
    ) {
      this.lastAppearanceColorReuses += 1;
      return;
    }
    if (!cached) {
      cached = {
        agentId: agent.id,
        tunicColor: agent.tunicColor,
        skinColor: agent.skinColor,
        hairColor: agent.hairColor,
      };
      appearances[slot] = cached;
    } else {
      cached.agentId = agent.id;
      cached.tunicColor = agent.tunicColor;
      cached.skinColor = agent.skinColor;
      cached.hairColor = agent.hairColor;
    }
    for (const materialSlot of batch.materialSlots()) {
      batch.setMaterialColorAt(
        slot,
        materialSlot.index,
        resolvePartColor(materialSlot.name, agent),
      );
    }
    this.lastAppearanceColorWrites += 1;
  }

}

function nextPresentationFrame(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') return Promise.resolve();
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function configureActionSpeeds(
  actions: Record<VillagerRenderMode, THREE.AnimationAction>,
  movementSpeed: number,
  animationRateScale = 1,
): void {
  const rate = resolvedAnimationRateScale(animationRateScale);
  configureLocomotionActionSpeeds(actions, movementSpeed, rate);
  actions.sit.setEffectiveTimeScale(1.15 * rate);
  actions.rest.setEffectiveTimeScale(0.72 * rate);
  actions.idle.setEffectiveTimeScale(rate);
  actions.talk.setEffectiveTimeScale(0.82 * rate);
  actions.pray.setEffectiveTimeScale(0.72 * rate);
  actions.chop.setEffectiveTimeScale(1.08 * rate);
  actions.mine.setEffectiveTimeScale(0.9 * rate);
  actions.gather.setEffectiveTimeScale(0.92 * rate);
  actions.plant.setEffectiveTimeScale(0.78 * rate);
  actions.sow.setEffectiveTimeScale(0.94 * rate);
  actions.fish.setEffectiveTimeScale(0.82 * rate);
  actions.tend.setEffectiveTimeScale(0.9 * rate);
  actions.build.setEffectiveTimeScale(1.08 * rate);
  actions.fight.setEffectiveTimeScale(1.22 * rate);
  actions.relax.setEffectiveTimeScale(0.82 * rate);
  actions.look.setEffectiveTimeScale(0.86 * rate);
  actions.wait.setEffectiveTimeScale(0.82 * rate);
  actions.laugh.setEffectiveTimeScale(0.9 * rate);
  actions.greet.setEffectiveTimeScale(0.92 * rate);
  actions.sermon.setEffectiveTimeScale(0.82 * rate);
  actions.agree.setEffectiveTimeScale(0.9 * rate);
  actions.bow.setEffectiveTimeScale(0.78 * rate);
  actions.carry.setEffectiveTimeScale(0.9 * rate);
  actions.hurt.setEffectiveTimeScale(1);
  actions.fall.setEffectiveTimeScale(0.95);
}

function configureLocomotionActionSpeeds(
  actions: Record<VillagerRenderMode, THREE.AnimationAction>,
  movementSpeed: number,
  animationRateScale: number,
): void {
  actions.walk.setEffectiveTimeScale(
    locomotionAnimationTimeScale('walk', movementSpeed) * animationRateScale,
  );
  actions.flee.setEffectiveTimeScale(
    locomotionAnimationTimeScale('flee', movementSpeed) * animationRateScale,
  );
  actions.run.setEffectiveTimeScale(
    locomotionAnimationTimeScale('run', movementSpeed) * animationRateScale,
  );
}

function resolvedAnimationRateScale(
  value: number | undefined,
  appearanceSeed?: number,
): number {
  return Number.isFinite(value)
    ? THREE.MathUtils.clamp(value!, 0.9, 1.1)
    : Number.isFinite(appearanceSeed)
      ? villagerAnimationCadenceScale(appearanceSeed!)
      : 1;
}

export function restartPooledVillagerActions(
  mixer: THREE.AnimationMixer,
  actions: Record<VillagerRenderMode, THREE.AnimationAction>,
  mode: VillagerRenderMode,
  appearanceSeed: number,
  movementSpeed: number,
  animationRateScale = 1,
): void {
  mixer.stopAllAction();
  for (const action of Object.values(actions)) action.stop();
  configureActionSpeeds(actions, movementSpeed, animationRateScale);
  const activeAction = actions[mode];
  activeAction.reset().play();
  configureVillagerActionStart(activeAction, mode, appearanceSeed);
}

function configureVillagerActionStart(
  action: THREE.AnimationAction,
  mode: VillagerRenderMode,
  appearanceSeed: number,
): void {
  const duration = action.getClip().duration;
  const staticPoseTime = villagerStaticSeatedPoseTime(mode, appearanceSeed, duration);
  action.paused = staticPoseTime !== null;
  action.time = staticPoseTime ?? villagerAnimationStartTime(mode, appearanceSeed, duration);
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
  installMilitaryHandGrip(gltf.scene);
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

function retargetSeatedClip(source: VillagerSource, target: VillagerSource): THREE.AnimationClip {
  return retargetVillagerAnimationClip(
    source.scene,
    target.scene,
    source.clips.sit,
    'sit:mounted-raider',
  );
}

export function retargetVillagerAnimationClip(
  sourceScene: THREE.Object3D,
  targetScene: THREE.Object3D,
  sourceClip: THREE.AnimationClip,
  name: string,
): THREE.AnimationClip {
  const clip = sourceClip.clone();
  clip.name = name;
  const rotation = new THREE.Quaternion();
  const offset = new THREE.Quaternion();
  for (const track of clip.tracks) {
    const split = track.name.lastIndexOf('.');
    const boneName = track.name.slice(0, split);
    const property = track.name.slice(split + 1);
    const from = sourceScene.getObjectByName(boneName);
    const to = targetScene.getObjectByName(boneName);
    if (!from || !to) throw new Error(`Missing retarget-animation bone ${boneName}`);
    if (property === 'quaternion') {
      offset.copy(to.quaternion).multiply(from.quaternion.clone().invert());
      for (let i = 0; i < track.values.length; i += 4) {
        rotation.fromArray(track.values, i).premultiply(offset).normalize().toArray(track.values, i);
      }
    } else if (property === 'position') {
      const ratio = from.position.length() > 0.01 ? to.position.length() / from.position.length() : 1;
      for (let i = 0; i < track.values.length; i += 3) {
        track.values[i] = to.position.x + (track.values[i] - from.position.x) * ratio;
        track.values[i + 1] = to.position.y + (track.values[i + 1] - from.position.y) * ratio;
        track.values[i + 2] = to.position.z + (track.values[i + 2] - from.position.z) * ratio;
      }
    } else if (property === 'scale') {
      for (let i = 0; i < track.values.length; i += 3) {
        track.values[i] *= to.scale.x / from.scale.x;
        track.values[i + 1] *= to.scale.y / from.scale.y;
        track.values[i + 2] *= to.scale.z / from.scale.z;
      }
    }
  }
  return clip;
}

function installWorkerSocialClips(
  socialSource: VillagerSource,
  workerTarget: VillagerSource,
): void {
  const sourceModeByTarget = {
    // The broader greet_04 take reads as the principal speaker.
    talk: 'sermon',
    greet: 'greet',
    agree: 'agree',
    laugh: 'laugh',
  } as const satisfies Partial<Record<VillagerRenderMode, VillagerRenderMode>>;
  for (const [targetMode, sourceMode] of Object.entries(sourceModeByTarget) as Array<
    [keyof typeof sourceModeByTarget, (typeof sourceModeByTarget)[keyof typeof sourceModeByTarget]]
  >) {
    workerTarget.clips[targetMode] = retargetVillagerAnimationClip(
      socialSource.scene,
      workerTarget.scene,
      socialSource.clips[sourceMode],
      `${socialSource.clips[sourceMode].name}:worker-${targetMode}`,
    );
  }
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
    // The reduced worker file itself omits social gestures. This neutral clip
    // is replaced at source-load time by motion retargeted from the compatible
    // shipped cleric rig.
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
    flee: forMode('run', 'flee'),
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
  flee: 'run',
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
  flee: 'run',
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
    agent.mode === 'talk'
    && agent.presentation !== 'cleric'
    && agent.presentation !== 'raider'
  ) {
    return villagerSocialActionMode(agent.appearanceSeed);
  }
  if (agent.mounted && agent.mode !== 'fall') return 'sit';
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
