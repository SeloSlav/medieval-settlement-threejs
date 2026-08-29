import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  isAgentAnimalRenderingEnabled,
  isWithinCrowdView,
  isWithinWorkAnimationRange,
  type CrowdViewState,
} from './crowdView.ts';
import {
  attachWorkerTool,
  disposeWorkerToolSources,
  loadWorkerToolSources,
  type WorkerToolKind,
  type WorkerToolSources,
} from './workerTools.ts';

const MAX_INSTANCES = 1024;
const MAX_ANIMATED_VILLAGERS = 72;
/** Upper bound; higher-bone rigs automatically use fewer slots per shard. */
export const ANIMATED_RIGS_PER_SHARD = 8;
export const MAX_ANIMATED_SKELETON_BYTES = 15_872;
const MODEL_YAW_OFFSET = 0;
const NOMINAL_WALK_SPEED = 1.2;
const BODY_GEOMETRY = new THREE.CapsuleGeometry(0.22, 0.72, 4, 8);
const LEGS_GEOMETRY = new THREE.CapsuleGeometry(0.16, 0.34, 4, 8);
const HEAD_GEOMETRY = new THREE.SphereGeometry(0.19, 10, 10);

const MODEL_URLS = {
  man: '/assets/models/villagers/worker-male-common-01-v001.glb',
  // TEMP: use the labeled male worker for female villagers too. Replace this
  // URL when the dedicated female GLB and matching semantic clips are supplied.
  woman: '/assets/models/villagers/worker-male-common-01-v001.glb',
} as const;

const TARGET_HEIGHTS = {
  man: 1.72,
  woman: 1.64,
} as const;
const MODEL_GROUNDING_HEIGHT = 0.012;
const SEATED_SUPPORT_CONTACT_HEIGHTS = {
  man: 0.39382,
  // Same source pose as the temporary male-model alias, scaled to 1.64 m.
  woman: 0.37606,
} as const;

export type VillagerModelVariant = keyof typeof MODEL_URLS;
export type VillagerRenderMode =
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

type FallbackPartLayer = {
  mesh: THREE.InstancedMesh;
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
};

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
  toolKind: WorkerToolKind | null;
  tool: THREE.Group | null;
  root: THREE.Group;
  model: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Record<VillagerRenderMode, THREE.AnimationAction>;
  mode: VillagerRenderMode;
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
  variant: VillagerModelVariant;
  bonesPerRig: number;
  rigsPerShard: number;
  shards: Array<{
    skeleton: THREE.Skeleton;
    skeletonBytes: number;
    layers: AnimatedBatchLayer[];
  }>;
};

function variantsShareModelSource(
  a: VillagerModelVariant,
  b: VillagerModelVariant,
): boolean {
  return String(MODEL_URLS[a]) === String(MODEL_URLS[b]);
}

function uniqueAnimatedBatches(
  batches: Record<VillagerModelVariant, AnimatedVariantBatch>,
): AnimatedVariantBatch[] {
  return [...new Set(Object.values(batches))];
}

function uniqueSourceScenes(
  sources: Record<VillagerModelVariant, VillagerSource>,
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
  mode: VillagerRenderMode;
  tunicColor: number;
  skinColor: number;
  hairColor: number;
  tool: WorkerToolKind | null;
  movementSpeed: number;
  active: boolean;
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
 * Renders close villagers with their authored skeletal animations. Villagers
 * outside the close presentation range are culled instead of being replaced by
 * a low-detail bind-pose proxy.
 */
export class SettlementCrowdRenderer {
  readonly ready: Promise<boolean>;
  private readonly group = new THREE.Group();
  private readonly animatedGroup = new THREE.Group();
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly color = new THREE.Color();
  private readonly scale = new THREE.Vector3(1, 1, 1);
  private readonly fallbackBody: FallbackPartLayer;
  private readonly fallbackLegs: FallbackPartLayer;
  private readonly fallbackHead: FallbackPartLayer;
  private readonly animated = new Map<string, AnimatedVillager>();
  private readonly animatedPool = new Map<string, AnimatedVillager[]>();
  private idlePooledVisualCount = 0;
  private readonly visibleAgents: CrowdRenderAgent[] = [];
  private readonly animatedCandidates: CrowdRenderAgent[] = [];
  private readonly animatedIds = new Set<string>();
  private sources: Record<VillagerModelVariant, VillagerSource> | null = null;
  private toolSources: WorkerToolSources | null = null;
  private animatedBatches: Record<VillagerModelVariant, AnimatedVariantBatch> | null = null;
  private readonly latestAgents: CrowdRenderAgent[] = [];
  private lastView: CrowdViewState | undefined;
  private disposed = false;

  constructor(options: SettlementCrowdRendererOptions) {
    this.group.name = 'Villagers';
    this.animatedGroup.name = 'Animated villagers';
    this.group.add(this.animatedGroup);
    options.parent.add(this.group);

    this.fallbackBody = this.createFallbackLayer('Villager loading body', BODY_GEOMETRY);
    this.fallbackLegs = this.createFallbackLayer('Villager loading legs', LEGS_GEOMETRY);
    this.fallbackHead = this.createFallbackLayer('Villager loading head', HEAD_GEOMETRY);
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
    const renderEnabled = isAgentAnimalRenderingEnabled(view);
    if (this.group.visible !== renderEnabled) {
      this.group.visible = renderEnabled;
    }
    if (!renderEnabled) return;

    const visibleAgents = this.visibleAgents;
    visibleAgents.length = 0;
    for (const agent of this.latestAgents) {
      if (agent.active && isWithinCrowdView(agent.x, agent.z, view)) {
        visibleAgents.push(agent);
      }
    }

    const animatedIds = this.pickAnimatedIds(visibleAgents, view);
    if (!this.sources) {
      this.updateFallback(visibleAgents, animatedIds);
      return;
    }

    this.clearFallback();
    this.syncAnimatedVillagers(visibleAgents, animatedIds, dt);
    this.updateAnimatedBatches(visibleAgents, animatedIds);
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

    for (const layer of [this.fallbackBody, this.fallbackLegs, this.fallbackHead]) {
      layer.geometry.dispose();
      layer.material.dispose();
      layer.mesh.removeFromParent();
    }

    if (this.sources) {
      for (const scene of uniqueSourceScenes(this.sources)) {
        disposeModelResources(scene);
      }
    }
    this.sources = null;
    if (this.toolSources) disposeWorkerToolSources(this.toolSources);
    this.toolSources = null;
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
      const [man, woman, tools] = await Promise.all([
        manPromise,
        womanPromise,
        loadWorkerToolSources(),
      ]);
      if (this.disposed) {
        for (const scene of uniqueSourceScenes({ man, woman })) {
          disposeModelResources(scene);
        }
        disposeWorkerToolSources(tools);
        return false;
      }
      this.sources = { man, woman };
      this.toolSources = tools;
      const manBatch = this.createAnimatedBatch('man', man);
      this.animatedBatches = {
        man: manBatch,
        woman: variantsShareModelSource('man', 'woman')
          ? manBatch
          : this.createAnimatedBatch('woman', woman),
      };
      this.syncAgents(this.latestAgents, this.lastView);
      return true;
    } catch (error) {
      console.warn('[Villagers] Animated villager sources failed to load.', error);
      return false;
    }
  }

  private createFallbackLayer(
    name: string,
    geometry: THREE.BufferGeometry,
  ): FallbackPartLayer {
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.9,
      metalness: 0,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, MAX_INSTANCES);
    mesh.name = name;
    mesh.count = 0;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return { mesh, geometry, material };
  }

  private updateFallback(
    agents: readonly CrowdRenderAgent[],
    renderedIds: ReadonlySet<string>,
  ): void {
    let count = 0;
    let bodyColorsDirty = false;
    let legColorsDirty = false;
    let headColorsDirty = false;
    for (const agent of agents) {
      if (!renderedIds.has(agent.id)) continue;
      if (count >= MAX_INSTANCES) break;
      bodyColorsDirty = this.writeFallbackInstance(
        this.fallbackBody.mesh,
        count,
        agent,
        0.62,
        agent.tunicColor,
      ) || bodyColorsDirty;
      legColorsDirty = this.writeFallbackInstance(
        this.fallbackLegs.mesh,
        count,
        agent,
        0.22,
        darkenHex(agent.tunicColor, 0.55),
      ) || legColorsDirty;
      headColorsDirty = this.writeFallbackInstance(
        this.fallbackHead.mesh,
        count,
        agent,
        1.18,
        agent.skinColor,
      ) || headColorsDirty;
      count++;
    }
    this.commitFallbackLayer(this.fallbackBody, count, bodyColorsDirty);
    this.commitFallbackLayer(this.fallbackLegs, count, legColorsDirty);
    this.commitFallbackLayer(this.fallbackHead, count, headColorsDirty);
  }

  private commitFallbackLayer(
    layer: FallbackPartLayer,
    count: number,
    colorsDirty: boolean,
  ): void {
    layer.mesh.count = count;
    publishInstanceAttributePrefix(layer.mesh.instanceMatrix, count);
    if (colorsDirty && layer.mesh.instanceColor) {
      publishInstanceAttributePrefix(layer.mesh.instanceColor, count);
    }
  }

  private clearFallback(): void {
    this.fallbackBody.mesh.count = 0;
    this.fallbackLegs.mesh.count = 0;
    this.fallbackHead.mesh.count = 0;
  }

  private writeFallbackInstance(
    mesh: THREE.InstancedMesh,
    index: number,
    agent: CrowdRenderAgent,
    yOffset: number,
    hexColor: number,
  ): boolean {
    this.position.set(agent.x, agent.y + yOffset, agent.z);
    this.euler.set(0, agent.yaw, 0);
    this.quaternion.setFromEuler(this.euler);
    this.matrix.compose(this.position, this.quaternion, this.scale);
    mesh.setMatrixAt(index, this.matrix);
    this.color.setHex(hexColor);
    return writeInstanceColorIfChanged(mesh, index, this.color);
  }

  private pickAnimatedIds(
    agents: readonly CrowdRenderAgent[],
    view?: CrowdViewState,
  ): Set<string> {
    const candidates = this.animatedCandidates;
    candidates.length = 0;
    for (const agent of agents) {
      if (isWithinWorkAnimationRange(agent.x, agent.z, view)) {
        candidates.push(agent);
      }
    }
    if (view) {
      candidates.sort((a, b) => {
        const aDx = a.x - view.centerX;
        const aDz = a.z - view.centerZ;
        const bDx = b.x - view.centerX;
        const bDz = b.z - view.centerZ;
        return aDx * aDx + aDz * aDz - (bDx * bDx + bDz * bDz);
      });
    }
    const animatedIds = this.animatedIds;
    animatedIds.clear();
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
      let visual = this.animated.get(agent.id);
      if (
        !visual
        || visual.variant !== agent.variant
        || visual.toolKind !== agent.tool
      ) {
        if (visual) this.removeAnimatedVillager(agent.id);
        visual = this.acquireAnimatedVillager(agent);
        this.animated.set(agent.id, visual);
      }

      visual.root.position.set(agent.x, agent.y, agent.z);
      visual.root.rotation.y = agent.yaw + MODEL_YAW_OFFSET;
      if (visual.mode !== agent.mode) this.transition(visual, agent.mode);
      visual.actions.walk.setEffectiveTimeScale(
        1.06 * Math.max(0.65, agent.movementSpeed / NOMINAL_WALK_SPEED),
      );
      if (dt > 0) visual.mixer.update(dt);
    }
  }

  private createAnimatedVillager(agent: CrowdRenderAgent): AnimatedVillager {
    const source = this.sources![agent.variant];
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
    root.name = `${agent.variant === 'woman' ? 'Woman' : 'Man'} villager ${agent.id}`;
    root.userData.villagerId = agent.id;
    root.userData.villagerGender = agent.variant;
    root.add(model);
    this.animatedGroup.add(root);

    const tool = agent.tool && this.toolSources
      ? attachWorkerTool(model, this.toolSources[agent.tool])
      : null;
    if (tool && agent.tool) {
      tool.visible = workerToolVisibleInMode(agent.tool, agent.mode);
    }

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
    };
    for (const [mode, action] of Object.entries(actions) as Array<
      [VillagerRenderMode, THREE.AnimationAction]
    >) {
      action.enabled = true;
      if (mode === 'sit' || mode === 'rest') {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      } else {
        action.setLoop(THREE.LoopRepeat, Number.POSITIVE_INFINITY);
      }
    }
    configureActionSpeeds(actions, agent.movementSpeed);
    actions[agent.mode].play();
    if (agent.mode !== 'sit' && agent.mode !== 'rest') {
      actions[agent.mode].time =
        (agent.appearanceSeed % 997) / 997 * actions[agent.mode].getClip().duration;
    }

    return {
      id: agent.id,
      variant: agent.variant,
      toolKind: agent.tool,
      tool,
      root,
      model,
      mixer,
      actions,
      mode: agent.mode,
      ownedMaterials,
      colorBindings,
      skeleton,
    };
  }

  private acquireAnimatedVillager(agent: CrowdRenderAgent): AnimatedVillager {
    const poolKey = animatedPoolKey(agent.variant, agent.tool);
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
    const source = this.sources![agent.variant];
    const scale = source.targetHeight / source.sourceHeight
      * villagerHeightJitter(agent.appearanceSeed);
    visual.id = agent.id;
    visual.mode = agent.mode;
    visual.root.name = `${agent.variant === 'woman' ? 'Woman' : 'Man'} villager ${agent.id}`;
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
      agent.mode,
      agent.appearanceSeed,
      agent.movementSpeed,
    );
    if (visual.tool && visual.toolKind) {
      visual.tool.visible = workerToolVisibleInMode(
        visual.toolKind,
        agent.mode,
      );
    }
  }

  private transition(
    visual: AnimatedVillager,
    nextMode: VillagerRenderMode,
  ): void {
    if (visual.mode === nextMode) return;
    visual.actions[visual.mode].fadeOut(0.18);
    visual.actions[nextMode].reset().fadeIn(0.18).play();
    if (visual.tool && visual.toolKind) {
      visual.tool.visible = workerToolVisibleInMode(
        visual.toolKind,
        nextMode,
      );
    }
    visual.mode = nextMode;
  }

  private removeAnimatedVillager(id: string): void {
    const visual = this.animated.get(id);
    if (!visual) return;
    visual.mixer.stopAllAction();
    visual.root.visible = false;
    if (visual.tool) visual.tool.visible = false;
    this.animated.delete(id);
    if (this.idlePooledVisualCount >= MAX_ANIMATED_VILLAGERS) {
      this.disposeAnimatedVillager(visual);
      return;
    }
    const poolKey = animatedPoolKey(visual.variant, visual.toolKind);
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
    for (const material of visual.ownedMaterials) material.dispose();
    visual.root.removeFromParent();
  }

  private createAnimatedBatch(
    variant: VillagerModelVariant,
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
          material.roughness = 0.9;
          material.metalness = 0;
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
    const counts: Record<VillagerModelVariant, number> = { man: 0, woman: 0 };
    for (const batch of uniqueAnimatedBatches(batches)) {
      for (const shard of batch.shards) {
        for (const layer of shard.layers) layer.dirtyColors.fill(0);
      }
    }
    for (const agent of agents) {
      if (!animatedIds.has(agent.id)) continue;
      const visual = this.animated.get(agent.id);
      if (!visual) continue;
      const batch: AnimatedVariantBatch = batches[agent.variant];
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
    1.06 * Math.max(0.65, movementSpeed / NOMINAL_WALK_SPEED),
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
  if (mode !== 'sit' && mode !== 'rest') {
    activeAction.time = (appearanceSeed % 997) / 997
      * activeAction.getClip().duration;
  }
}

function writeInstanceColorIfChanged(
  mesh: THREE.InstancedMesh,
  index: number,
  color: THREE.Color,
): boolean {
  const attribute = mesh.instanceColor;
  if (!attribute) {
    mesh.setColorAt(index, color);
    return true;
  }
  const offset = index * attribute.itemSize;
  const array = attribute.array;
  const red = Math.fround(color.r);
  const green = Math.fround(color.g);
  const blue = Math.fround(color.b);
  if (
    array[offset] === red
    && array[offset + 1] === green
    && array[offset + 2] === blue
  ) return false;
  attribute.setXYZ(index, color.r, color.g, color.b);
  return true;
}

function animatedPoolKey(
  variant: VillagerModelVariant,
  tool: WorkerToolKind | null,
): string {
  return `${variant}:${tool ?? 'unarmed'}`;
}

function publishInstanceAttributePrefix(
  attribute: THREE.InstancedBufferAttribute,
  instanceCount: number,
): void {
  attribute.clearUpdateRanges();
  if (instanceCount <= 0) return;
  attribute.addUpdateRange(0, instanceCount * attribute.itemSize);
  attribute.needsUpdate = true;
}

async function loadVillagerSource(
  url: string,
  targetHeight: number,
): Promise<VillagerSource> {
  const gltf = await new GLTFLoader().loadAsync(url);
  const bounds = new THREE.Box3().setFromObject(gltf.scene);
  const sourceHeight = bounds.max.y - bounds.min.y;
  if (!Number.isFinite(sourceHeight) || sourceHeight <= 0.001) {
    throw new Error(`Invalid villager model bounds for ${url}`);
  }
  const idle = findAnimationClip(gltf.animations, 'idle');
  const walk = findAnimationClip(gltf.animations, 'walk');
  if (idle && walk && findAnimationClip(gltf.animations, 'standing_relax')) {
    return {
      scene: gltf.scene,
      bounds,
      sourceHeight,
      targetHeight,
      clips: createSemanticWorkerClipSet(gltf.animations),
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
    },
  };
}

function createSemanticWorkerClipSet(
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
    talk: forMode('greet_01', 'talk'),
    pray: forMode('bow', 'pray'),
    chop: forMode('chop', 'chop'),
    mine: forMode('dig', 'mine'),
    gather: forMode('lift_heavy', 'gather'),
    plant: forMode('dig', 'plant'),
    sow: forMode('shovel', 'sow'),
    fish: forMode('wait', 'fish'),
    tend: forMode('shovel', 'tend'),
    build: forMode('chop', 'build'),
    fight: forMode('slash', 'fight'),
  };
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
  // Broadcast sowing needs two empty hands; the farm's hoe must not turn the
  // seed-casting gesture back into a generic tool swing.
  if (mode === 'sow') return false;
  if (kind === 'spear') {
    return mode === 'idle'
      || mode === 'walk'
      || mode === 'build'
      || mode === 'fight';
  }
  return isWorkMode(mode);
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
