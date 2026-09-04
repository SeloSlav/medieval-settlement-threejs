import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { CombatAgentState } from '../security/combatAgents.ts';
import {
  AuthoredAnimalInstanceBatch,
  setAuthoredAnimalEvaluatorOnly,
} from '../scene/AuthoredAnimalInstanceBatch.ts';
import { isWithinAnimalCrowdView, type CrowdViewState } from './crowdView.ts';

export type AnimalCombatPose = Readonly<{
  id: string;
  faction: 'dog' | 'fox' | 'wolf';
  x: number;
  y: number;
  z: number;
  yaw: number;
  moveSpeed: number;
  status: CombatAgentState['status'];
}>;

type AnimalAsset = Readonly<{ scene: THREE.Group; animations: readonly THREE.AnimationClip[] }>;
type AnimalInstance = {
  root: THREE.Group;
  model: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  actionName: string;
  faction: AnimalCombatPose['faction'];
  yaw: number;
  bodyHeight: number;
};

const ANIMAL_TURN_RESPONSE = 12;
const ANIMAL_MAX_TURN_SPEED = 5.5;

const SOURCES: Record<AnimalCombatPose['faction'], string> = {
  dog: '/assets/models/wild-animals/quaternius-husky.gltf',
  fox: '/assets/models/wild-animals/quaternius-fox.gltf',
  wolf: '/assets/models/wild-animals/quaternius-wolf.gltf',
};
const TARGET_LENGTH: Record<AnimalCombatPose['faction'], number> = {
  dog: 1.45,
  fox: 1.12,
  wolf: 1.72,
};

export class AnimalCombatRenderer {
  readonly ready: Promise<boolean>;
  private readonly group = new THREE.Group();
  private readonly assets = new Map<AnimalCombatPose['faction'], AnimalAsset>();
  private readonly batches = new Map<AnimalCombatPose['faction'], AuthoredAnimalInstanceBatch>();
  private readonly instances = new Map<string, AnimalInstance>();

  constructor(parent: THREE.Group) {
    this.group.name = 'Selectable guard dogs and hostile wildlife';
    parent.add(this.group);
    this.ready = this.loadAssets();
  }

  sync(poses: readonly AnimalCombatPose[], view: CrowdViewState | undefined, dt: number, motionDt = dt, simulationRate = 1): void {
    const active = new Set<string>();
    for (const pose of poses) {
      if (!isWithinAnimalCrowdView(pose.x, pose.z, view)) continue;
      active.add(pose.id);
      let instance = this.instances.get(pose.id);
      if (!instance || instance.faction !== pose.faction) {
        if (instance) this.removeInstance(pose.id, instance);
        const created = this.createInstance(pose.id, pose.faction, pose.yaw);
        if (!created) continue;
        instance = created;
      }
      instance.root.position.set(pose.x, pose.y, pose.z);
      instance.yaw = smoothAnimalYaw(instance.yaw, pose.yaw, motionDt);
      instance.root.rotation.y = instance.yaw;
      const gaitSpeed = simulationRate > 0 ? pose.moveSpeed / simulationRate : 0;
      const nextAction = simulationRate > 0
        ? animalCombatAnimation(pose, instance.actionName, simulationRate)
        : instance.actionName;
      if (instance.actionName !== nextAction) {
        this.play(instance, nextAction, pose.status === 'downed');
      }
      // displayMoveSpeed is measured in real seconds. Convert back from the
      // paced animation delta so faster game speeds don't multiply feet twice.
      instance.mixer.timeScale = nextAction === 'Walk' || nextAction === 'Gallop'
        ? animalCombatLocomotionRate(nextAction, gaitSpeed) * (dt > 0 ? simulationRate * motionDt / dt : 0)
        : 1;
      instance.mixer.update(Math.max(0, dt));
    }
    for (const [id, instance] of this.instances) {
      if (!active.has(id)) this.removeInstance(id, instance);
    }
    this.flushAuthoredBatches();
  }

  dispose(): void {
    for (const [id, instance] of this.instances) this.removeInstance(id, instance);
    this.instances.clear();
    for (const batch of this.batches.values()) batch.dispose();
    this.batches.clear();
    this.group.removeFromParent();
  }

  diagnostics(): Record<string, ReturnType<AuthoredAnimalInstanceBatch['diagnostics']>> {
    return Object.fromEntries(
      [...this.batches].map(([faction, batch]) => [faction, batch.diagnostics()]),
    );
  }

  hasVisibleShadowCasters(): boolean {
    return this.group.visible && this.instances.size > 0;
  }

  getRenderedBodyHeight(id: string): number | null {
    const instance = this.instances.get(id);
    return this.group.visible && instance?.root.visible ? instance.bodyHeight : null;
  }

  private async loadAssets(): Promise<boolean> {
    try {
      const loader = new GLTFLoader();
      const entries = await Promise.all(
        (Object.entries(SOURCES) as Array<[AnimalCombatPose['faction'], string]>)
          .map(async ([faction, url]) => [faction, await loader.loadAsync(url)] as const),
      );
      for (const [faction, gltf] of entries) {
        const asset = assetFromGltf(gltf);
        this.assets.set(faction, asset);
        try {
          this.batches.set(faction, new AuthoredAnimalInstanceBatch({
            parent: this.group,
            sourceRoot: asset.scene,
            capacity: 16,
            name: `${faction} exact-model combat instances`,
            castShadow: true,
            receiveShadow: true,
          }));
        } catch (error) {
          // Exact individual clones remain active. This is a performance
          // fallback only; it never changes the model, material or animation.
          console.warn(`[Animal combat] ${faction} exact-model batching unavailable.`, error);
        }
      }
      return true;
    } catch (error) {
      console.warn('Guard-dog and wildlife models failed to load.', error);
      return false;
    }
  }

  private createInstance(
    id: string,
    faction: AnimalCombatPose['faction'],
    initialYaw: number,
  ): AnimalInstance | null {
    const asset = this.assets.get(faction);
    if (!asset) return null;
    const model = cloneSkinned(asset.scene) as THREE.Group;
    // Quaternius' quadrupeds are authored facing local +Z, which is also the
    // settlement renderer's forward direction. Flipping the model here made
    // its walk cycle travel tail-first even though steering yaw was correct.
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    const scale = TARGET_LENGTH[faction] / Math.max(0.01, size.x, size.z);
    model.scale.setScalar(scale);
    const root = new THREE.Group();
    root.name = `${faction} combat agent ${id}`;
    root.add(model);
    setAuthoredAnimalEvaluatorOnly(model, this.batches.has(faction));
    const mixer = new THREE.AnimationMixer(model);
    const actions = new Map<string, THREE.AnimationAction>();
    for (const clip of asset.animations) {
      actions.set(shortAnimationName(clip.name), mixer.clipAction(clip));
    }
    const instance: AnimalInstance = {
      root,
      model,
      mixer,
      actions,
      actionName: '',
      faction,
      yaw: initialYaw,
      bodyHeight: size.y * scale,
    };
    root.rotation.y = initialYaw;
    this.instances.set(id, instance);
    this.group.add(root);
    this.play(instance, 'Idle', false);
    return instance;
  }

  private play(instance: AnimalInstance, requested: string, once: boolean): void {
    const next = instance.actions.get(requested)
      ?? instance.actions.get(requested.startsWith('Idle') ? 'Idle' : 'Walk')
      ?? instance.actions.values().next().value;
    if (!next) return;
    const previous = instance.actions.get(instance.actionName);
    const preserveStride = (requested === 'Walk' || requested === 'Gallop')
      && (instance.actionName === 'Walk' || instance.actionName === 'Gallop');
    const phase = preserveStride && previous
      ? previous.time / previous.getClip().duration : 0;
    for (const action of instance.actions.values()) {
      if (action === next) continue;
      action.fadeOut(0.16);
    }
    next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(0.12);
    if (preserveStride) next.time = (phase % 1) * next.getClip().duration;
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    next.clampWhenFinished = once;
    next.play();
    instance.actionName = requested;
  }

  private removeInstance(id: string, instance: AnimalInstance): void {
    instance.mixer.stopAllAction();
    instance.root.removeFromParent();
    this.instances.delete(id);
  }

  private flushAuthoredBatches(): void {
    for (const [faction, batch] of this.batches) {
      const instances = [...this.instances.values()].filter(
        (instance) => instance.faction === faction && instance.root.visible,
      );
      batch.beginFrame(instances.length);
      for (const instance of instances) batch.submit(instance.model);
      batch.endFrame();
    }
  }
}

function smoothAnimalYaw(current: number, target: number, dt: number): number {
  const frameDt = Math.min(0.1, Math.max(0, dt));
  if (frameDt <= 0) return current;
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  const responsiveStep = delta * (1 - Math.exp(-frameDt * ANIMAL_TURN_RESPONSE));
  const maxStep = ANIMAL_MAX_TURN_SPEED * frameDt;
  const next = current + THREE.MathUtils.clamp(responsiveStep, -maxStep, maxStep);
  return Math.atan2(Math.sin(next), Math.cos(next));
}

function assetFromGltf(gltf: GLTF): AnimalAsset {
  gltf.scene.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    node.castShadow = true;
    node.receiveShadow = true;
  });
  return { scene: gltf.scene, animations: gltf.animations };
}

function shortAnimationName(name: string): string {
  return name.split('|').at(-1) ?? name;
}

export function animalCombatAnimation(pose: Pick<AnimalCombatPose, 'status' | 'moveSpeed'>, current = '', simulationRate = 1): string {
  if (pose.status === 'downed') return 'Death';
  if (pose.status === 'fighting') return 'Attack';
  if (pose.status === 'looting') return 'Eating';
  const speed = simulationRate > 0 ? pose.moveSpeed / simulationRate : 0;
  if (speed > (current === 'Gallop' ? 1.85 : 2.35)) return 'Gallop';
  if (speed > (current === 'Walk' ? 0.07 : 0.15)) return 'Walk';
  return pose.status === 'holding' ? 'Idle_2' : 'Idle';
}

export function animalCombatLocomotionRate(action: 'Walk' | 'Gallop', moveSpeed: number): number {
  const authoredSpeed = action === 'Gallop' ? 3.25 : 1.25;
  return THREE.MathUtils.clamp(Number.isFinite(moveSpeed) ? moveSpeed / authoredSpeed : 0, 0.1, 3);
}
