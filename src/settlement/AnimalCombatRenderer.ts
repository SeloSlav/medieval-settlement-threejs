import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { CombatAgentState } from '../security/combatAgents.ts';
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
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  actionName: string;
  faction: AnimalCombatPose['faction'];
};

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
  private readonly instances = new Map<string, AnimalInstance>();

  constructor(parent: THREE.Group) {
    this.group.name = 'Selectable guard dogs and hostile wildlife';
    parent.add(this.group);
    this.ready = this.loadAssets();
  }

  sync(poses: readonly AnimalCombatPose[], view: CrowdViewState | undefined, dt: number): void {
    const active = new Set<string>();
    for (const pose of poses) {
      if (!isWithinAnimalCrowdView(pose.x, pose.z, view)) continue;
      active.add(pose.id);
      let instance = this.instances.get(pose.id);
      if (!instance || instance.faction !== pose.faction) {
        if (instance) this.removeInstance(pose.id, instance);
        const created = this.createInstance(pose.id, pose.faction);
        if (!created) continue;
        instance = created;
      }
      instance.root.position.set(pose.x, pose.y, pose.z);
      instance.root.rotation.y = pose.yaw;
      const nextAction = animationForPose(pose);
      if (instance.actionName !== nextAction) {
        this.play(instance, nextAction, pose.status === 'downed');
      }
      instance.mixer.update(Math.max(0, dt));
    }
    for (const [id, instance] of this.instances) {
      if (!active.has(id)) this.removeInstance(id, instance);
    }
  }

  dispose(): void {
    for (const [id, instance] of this.instances) this.removeInstance(id, instance);
    this.instances.clear();
    this.group.removeFromParent();
  }

  private async loadAssets(): Promise<boolean> {
    try {
      const loader = new GLTFLoader();
      const entries = await Promise.all(
        (Object.entries(SOURCES) as Array<[AnimalCombatPose['faction'], string]>)
          .map(async ([faction, url]) => [faction, await loader.loadAsync(url)] as const),
      );
      for (const [faction, gltf] of entries) this.assets.set(faction, assetFromGltf(gltf));
      return true;
    } catch (error) {
      console.warn('Guard-dog and wildlife models failed to load.', error);
      return false;
    }
  }

  private createInstance(id: string, faction: AnimalCombatPose['faction']): AnimalInstance | null {
    const asset = this.assets.get(faction);
    if (!asset) return null;
    const model = cloneSkinned(asset.scene) as THREE.Group;
    model.rotation.y = Math.PI;
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    const scale = TARGET_LENGTH[faction] / Math.max(0.01, size.x, size.z);
    model.scale.setScalar(scale);
    const root = new THREE.Group();
    root.name = `${faction} combat agent ${id}`;
    root.add(model);
    const mixer = new THREE.AnimationMixer(model);
    const actions = new Map<string, THREE.AnimationAction>();
    for (const clip of asset.animations) {
      actions.set(shortAnimationName(clip.name), mixer.clipAction(clip));
    }
    const instance: AnimalInstance = { root, mixer, actions, actionName: '', faction };
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
    for (const action of instance.actions.values()) {
      if (action === next) continue;
      action.fadeOut(0.16);
    }
    next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(0.12);
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

function animationForPose(pose: AnimalCombatPose): string {
  if (pose.status === 'downed') return 'Death';
  if (pose.status === 'fighting') return 'Attack';
  if (pose.status === 'looting') return 'Eating';
  if (pose.moveSpeed > 2.1) return 'Gallop';
  if (pose.moveSpeed > 0.12) return 'Walk';
  return pose.status === 'holding' ? 'Idle_2' : 'Idle';
}
