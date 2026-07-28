import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  isWithinCrowdView,
  isWithinShadowRange,
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
const MODEL_YAW_OFFSET = 0;
const NOMINAL_WALK_SPEED = 1.2;
const BODY_GEOMETRY = new THREE.CapsuleGeometry(0.22, 0.72, 4, 8);
const LEGS_GEOMETRY = new THREE.CapsuleGeometry(0.16, 0.34, 4, 8);
const HEAD_GEOMETRY = new THREE.SphereGeometry(0.19, 10, 10);

const MODEL_URLS = {
  man: '/assets/models/villagers/quaternius-villager-man.glb',
  woman: '/assets/models/villagers/quaternius-villager-woman.glb',
} as const;

const TARGET_HEIGHTS = {
  man: 1.72,
  woman: 1.64,
} as const;

export type VillagerModelVariant = keyof typeof MODEL_URLS;
export type VillagerRenderMode =
  | 'idle'
  | 'walk'
  | 'sit'
  | 'rest'
  | 'talk'
  | 'chop'
  | 'mine'
  | 'gather'
  | 'plant'
  | 'fish'
  | 'tend'
  | 'build';

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

type ProxyLayer = {
  variant: VillagerModelVariant;
  mesh: THREE.InstancedMesh;
  material: THREE.MeshStandardMaterial;
  materialName: string;
  modelMatrix: THREE.Matrix4;
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
};

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

/**
 * Renders close villagers with their authored skeletal animations and all other
 * visible villagers as instanced, bind-pose copies of the same low-poly models.
 */
export class SettlementCrowdRenderer {
  private readonly group = new THREE.Group();
  private readonly animatedGroup = new THREE.Group();
  private readonly proxyGroup = new THREE.Group();
  private readonly matrix = new THREE.Matrix4();
  private readonly agentMatrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly color = new THREE.Color();
  private readonly scale = new THREE.Vector3(1, 1, 1);
  private readonly fallbackBody: FallbackPartLayer;
  private readonly fallbackLegs: FallbackPartLayer;
  private readonly fallbackHead: FallbackPartLayer;
  private readonly animated = new Map<string, AnimatedVillager>();
  private sources: Record<VillagerModelVariant, VillagerSource> | null = null;
  private toolSources: WorkerToolSources | null = null;
  private proxyLayers: ProxyLayer[] = [];
  private latestAgents: CrowdRenderAgent[] = [];
  private lastView: CrowdViewState | undefined;
  private elapsed = 0;
  private disposed = false;

  constructor(options: SettlementCrowdRendererOptions) {
    this.group.name = 'Villagers';
    this.animatedGroup.name = 'Animated Quaternius villagers';
    this.proxyGroup.name = 'Instanced Quaternius villager LOD';
    this.group.add(this.proxyGroup, this.animatedGroup);
    options.parent.add(this.group);

    this.fallbackBody = this.createFallbackLayer('Villager loading body', BODY_GEOMETRY);
    this.fallbackLegs = this.createFallbackLayer('Villager loading legs', LEGS_GEOMETRY);
    this.fallbackHead = this.createFallbackLayer('Villager loading head', HEAD_GEOMETRY);
    void this.loadSources();
  }

  syncAgents(
    agents: readonly CrowdRenderAgent[],
    view?: CrowdViewState,
    dtSeconds = 0,
  ): void {
    this.latestAgents = [...agents];
    this.lastView = view;
    const dt = Math.min(0.08, Math.max(0, dtSeconds));
    this.elapsed += dt;

    const visibleAgents = this.latestAgents.filter((agent) =>
      agent.active && isWithinCrowdView(agent.x, agent.z, view)
    );

    if (!this.sources) {
      this.updateFallback(visibleAgents);
      return;
    }

    this.clearFallback();
    const animatedIds = this.pickAnimatedIds(visibleAgents, view);
    this.syncAnimatedVillagers(visibleAgents, animatedIds, dt);
    this.updateProxyLayers(visibleAgents, animatedIds);
  }

  dispose(): void {
    this.disposed = true;
    for (const id of [...this.animated.keys()]) this.removeAnimatedVillager(id);

    for (const layer of this.proxyLayers) {
      layer.material.dispose();
      layer.mesh.removeFromParent();
    }
    this.proxyLayers = [];

    for (const layer of [this.fallbackBody, this.fallbackLegs, this.fallbackHead]) {
      layer.geometry.dispose();
      layer.material.dispose();
      layer.mesh.removeFromParent();
    }

    if (this.sources) {
      for (const source of Object.values(this.sources)) disposeModelResources(source.scene);
    }
    this.sources = null;
    if (this.toolSources) disposeWorkerToolSources(this.toolSources);
    this.toolSources = null;
    this.group.removeFromParent();
  }

  private async loadSources(): Promise<void> {
    try {
      const [man, woman, tools] = await Promise.all([
        loadVillagerSource(MODEL_URLS.man, TARGET_HEIGHTS.man),
        loadVillagerSource(MODEL_URLS.woman, TARGET_HEIGHTS.woman),
        loadWorkerToolSources(),
      ]);
      if (this.disposed) {
        disposeModelResources(man.scene);
        disposeModelResources(woman.scene);
        disposeWorkerToolSources(tools);
        return;
      }
      this.sources = { man, woman };
      this.toolSources = tools;
      this.proxyLayers = [
        ...this.createProxyLayers('man', man),
        ...this.createProxyLayers('woman', woman),
      ];
      this.syncAgents(this.latestAgents, this.lastView);
    } catch (error) {
      console.warn('[Villagers] Animated CC0 Quaternius villagers failed to load.', error);
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

  private updateFallback(agents: readonly CrowdRenderAgent[]): void {
    let count = 0;
    for (const agent of agents) {
      if (count >= MAX_INSTANCES) break;
      this.writeFallbackInstance(
        this.fallbackBody.mesh,
        count,
        agent,
        0.62,
        agent.tunicColor,
      );
      this.writeFallbackInstance(
        this.fallbackLegs.mesh,
        count,
        agent,
        0.22,
        darkenHex(agent.tunicColor, 0.55),
      );
      this.writeFallbackInstance(
        this.fallbackHead.mesh,
        count,
        agent,
        1.18,
        agent.skinColor,
      );
      count++;
    }
    for (const layer of [this.fallbackBody, this.fallbackLegs, this.fallbackHead]) {
      layer.mesh.count = count;
      layer.mesh.instanceMatrix.needsUpdate = true;
      if (layer.mesh.instanceColor) layer.mesh.instanceColor.needsUpdate = true;
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
  ): void {
    this.position.set(agent.x, agent.y + yOffset, agent.z);
    this.euler.set(0, agent.yaw, 0);
    this.quaternion.setFromEuler(this.euler);
    this.matrix.compose(this.position, this.quaternion, this.scale);
    mesh.setMatrixAt(index, this.matrix);
    this.color.setHex(hexColor);
    mesh.setColorAt(index, this.color);
  }

  private pickAnimatedIds(
    agents: readonly CrowdRenderAgent[],
    view?: CrowdViewState,
  ): Set<string> {
    const candidates = agents.filter((agent) =>
      isWorkMode(agent.mode)
        ? isWithinWorkAnimationRange(agent.x, agent.z, view)
        : isWithinShadowRange(agent.x, agent.z, view)
    );
    if (view) {
      candidates.sort((a, b) => {
        const aDx = a.x - view.centerX;
        const aDz = a.z - view.centerZ;
        const bDx = b.x - view.centerX;
        const bDz = b.z - view.centerZ;
        return aDx * aDx + aDz * aDz - (bDx * bDx + bDz * bDz);
      });
    }
    return new Set(
      candidates.slice(0, MAX_ANIMATED_VILLAGERS).map((agent) => agent.id),
    );
  }

  private syncAnimatedVillagers(
    agents: readonly CrowdRenderAgent[],
    animatedIds: ReadonlySet<string>,
    dt: number,
  ): void {
    const byId = new Map(agents.map((agent) => [agent.id, agent]));
    for (const id of [...this.animated.keys()]) {
      if (!animatedIds.has(id) || !byId.has(id)) this.removeAnimatedVillager(id);
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
        visual = this.createAnimatedVillager(agent);
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
    const heightJitter = 0.96 + ((agent.appearanceSeed >>> 8) & 0xff) / 0xff * 0.08;
    const scale = source.targetHeight / source.sourceHeight * heightJitter;
    model.scale.setScalar(scale);
    model.position.y = -source.bounds.min.y * scale + 0.012;

    const ownedMaterials: THREE.Material[] = [];
    model.traverse((object) => {
      const mesh = object as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const clones = materials.map((material) => {
        const clone = material.clone();
        const standard = clone as THREE.MeshStandardMaterial;
        if (standard.color) {
          standard.color.setHex(resolvePartColor(material.name, agent));
          standard.roughness = 0.9;
          standard.metalness = 0;
        }
        ownedMaterials.push(clone);
        return clone;
      });
      mesh.material = Array.isArray(mesh.material) ? clones : clones[0]!;
    });

    const root = new THREE.Group();
    root.name = `${agent.variant === 'woman' ? 'Woman' : 'Man'} villager ${agent.id}`;
    root.userData.villagerId = agent.id;
    root.userData.villagerGender = agent.variant;
    root.add(model);
    this.animatedGroup.add(root);

    const tool = agent.tool && this.toolSources
      ? attachWorkerTool(model, this.toolSources[agent.tool])
      : null;
    if (tool) tool.visible = isWorkMode(agent.mode);

    const mixer = new THREE.AnimationMixer(model);
    const actions: Record<VillagerRenderMode, THREE.AnimationAction> = {
      idle: mixer.clipAction(source.clips.idle, model),
      walk: mixer.clipAction(source.clips.walk, model),
      sit: mixer.clipAction(source.clips.sit, model),
      rest: mixer.clipAction(source.clips.rest, model),
      talk: mixer.clipAction(source.clips.talk, model),
      chop: mixer.clipAction(source.clips.chop, model),
      mine: mixer.clipAction(source.clips.mine, model),
      gather: mixer.clipAction(source.clips.gather, model),
      plant: mixer.clipAction(source.clips.plant, model),
      fish: mixer.clipAction(source.clips.fish, model),
      tend: mixer.clipAction(source.clips.tend, model),
      build: mixer.clipAction(source.clips.build, model),
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
    actions.walk.setEffectiveTimeScale(
      1.06 * Math.max(0.65, agent.movementSpeed / NOMINAL_WALK_SPEED),
    );
    actions.sit.setEffectiveTimeScale(1.15);
    actions.rest.setEffectiveTimeScale(0.72);
    actions.talk.setEffectiveTimeScale(0.82);
    actions.chop.setEffectiveTimeScale(1.08);
    actions.mine.setEffectiveTimeScale(0.9);
    actions.gather.setEffectiveTimeScale(0.92);
    actions.plant.setEffectiveTimeScale(0.78);
    actions.fish.setEffectiveTimeScale(0.82);
    actions.tend.setEffectiveTimeScale(0.9);
    actions.build.setEffectiveTimeScale(1.08);
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
    };
  }

  private transition(
    visual: AnimatedVillager,
    nextMode: VillagerRenderMode,
  ): void {
    if (visual.mode === nextMode) return;
    visual.actions[visual.mode].fadeOut(0.18);
    visual.actions[nextMode].reset().fadeIn(0.18).play();
    if (visual.tool) visual.tool.visible = isWorkMode(nextMode);
    visual.mode = nextMode;
  }

  private removeAnimatedVillager(id: string): void {
    const visual = this.animated.get(id);
    if (!visual) return;
    visual.mixer.stopAllAction();
    visual.mixer.uncacheRoot(visual.model);
    for (const material of visual.ownedMaterials) material.dispose();
    visual.root.removeFromParent();
    this.animated.delete(id);
  }

  private createProxyLayers(
    variant: VillagerModelVariant,
    source: VillagerSource,
  ): ProxyLayer[] {
    const layers: ProxyLayer[] = [];
    const modelScale = source.targetHeight / source.sourceHeight;
    source.scene.updateMatrixWorld(true);

    source.scene.traverse((object) => {
      const sourceMesh = object as THREE.SkinnedMesh;
      if (!sourceMesh.isSkinnedMesh) return;
      const sourceMaterial = Array.isArray(sourceMesh.material)
        ? sourceMesh.material[0]
        : sourceMesh.material;
      const material = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.9,
        metalness: 0,
      });
      const mesh = new THREE.InstancedMesh(
        sourceMesh.geometry,
        material,
        MAX_INSTANCES,
      );
      mesh.name = `${variant} villager LOD: ${sourceMaterial?.name ?? sourceMesh.name}`;
      mesh.count = 0;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.proxyGroup.add(mesh);

      const modelMatrix = new THREE.Matrix4()
        .makeTranslation(0, -source.bounds.min.y * modelScale + 0.012, 0)
        .multiply(new THREE.Matrix4().makeScale(modelScale, modelScale, modelScale))
        .multiply(sourceMesh.matrixWorld);
      layers.push({
        variant,
        mesh,
        material,
        materialName: sourceMaterial?.name ?? sourceMesh.name,
        modelMatrix,
      });
    });

    return layers;
  }

  private updateProxyLayers(
    agents: readonly CrowdRenderAgent[],
    animatedIds: ReadonlySet<string>,
  ): void {
    const proxyAgents = agents.filter((agent) => !animatedIds.has(agent.id));
    for (const layer of this.proxyLayers) {
      let count = 0;
      for (const agent of proxyAgents) {
        if (agent.variant !== layer.variant || count >= MAX_INSTANCES) continue;
        const walkCadence = Math.max(0.65, agent.movementSpeed / NOMINAL_WALK_SPEED);
        const phase = this.elapsed * 7.5 * walkCadence
          + (agent.appearanceSeed % 1024) * 0.07;
        const bob = agent.mode === 'walk' ? Math.sin(phase) * 0.018 : 0;
        this.position.set(agent.x, agent.y + bob, agent.z);
        this.euler.set(0, agent.yaw + MODEL_YAW_OFFSET, 0);
        this.quaternion.setFromEuler(this.euler);
        this.agentMatrix.compose(this.position, this.quaternion, this.scale);
        this.matrix.multiplyMatrices(this.agentMatrix, layer.modelMatrix);
        layer.mesh.setMatrixAt(count, this.matrix);
        this.color.setHex(resolvePartColor(layer.materialName, agent));
        layer.mesh.setColorAt(count, this.color);
        count++;
      }
      layer.mesh.count = count;
      layer.mesh.instanceMatrix.needsUpdate = true;
      if (layer.mesh.instanceColor) layer.mesh.instanceColor.needsUpdate = true;
    }
  }
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
  const sitting = findAnimationClip(gltf.animations, 'sitting');
  const swing = findAnimationClip(gltf.animations, 'swordslash');
  if (!idle || !walk || !sitting || !swing) {
    throw new Error(`Missing idle/walk/sitting/swing clips in ${url}`);
  }
  const sit = sitting.clone();
  sit.name = `${sitting.name}:ambient-sit`;
  const rest = createRestAnimationClip(sitting);
  const talk = createTalkAnimationClip(gltf.scene, idle);
  const chop = swing.clone();
  chop.name = `${swing.name}:worker-chop`;
  const mine = swing.clone();
  mine.name = `${swing.name}:worker-mine`;
  const plant = swing.clone();
  plant.name = `${swing.name}:worker-plant`;
  const build = swing.clone();
  build.name = `${swing.name}:worker-build`;
  const gather = createGatherAnimationClip(gltf.scene);
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
      chop,
      mine,
      gather,
      plant,
      fish,
      tend,
      build,
    },
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
): mode is 'chop' | 'mine' | 'gather' | 'plant' | 'fish' | 'tend' | 'build' {
  return mode === 'chop'
    || mode === 'mine'
    || mode === 'gather'
    || mode === 'plant'
    || mode === 'fish'
    || mode === 'tend'
    || mode === 'build';
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
