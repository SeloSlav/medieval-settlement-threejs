import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  AuthoredAnimalInstanceBatch,
  setAuthoredAnimalEvaluatorOnly,
  type AuthoredAnimalMaterialColor,
} from '../scene/AuthoredAnimalInstanceBatch.ts';
import { isWithinAnimalCrowdView, type CrowdViewState } from './crowdView.ts';

export type CavalryHorsePresentation = 'pasture' | 'hussar' | 'lancer' | 'archer' | 'ottoman';

export type CavalryHorsePose = Readonly<{
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  moveSpeed: number;
  activity: 'standing' | 'grazing' | 'walking';
  presentation: CavalryHorsePresentation;
  appearanceSeed: number;
}>;

type HorseMotionMode = 'idle' | 'eat' | 'walk';
type HorseSource = {
  scene: THREE.Group;
  bounds: THREE.Box3;
  sourceHeight: number;
  clips: Record<HorseMotionMode, THREE.AnimationClip>;
  materialColors: Map<string, THREE.Color>;
};
type HorseVisual = {
  root: THREE.Group;
  model: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Record<HorseMotionMode, THREE.AnimationAction>;
  mode: HorseMotionMode;
  appearanceSeed: number;
};

/** The authored saddle contact point above terrain, in metres. */
export const CAVALRY_SADDLE_HEIGHT = 1.08;

const HORSE_MODEL_URL = '/assets/models/horses/quaternius-horse.gltf';
const HORSE_TARGET_HEIGHT = 1.7;
const HORSE_WALK_SPEED = 1.35;
const HORSE_COAT_PALETTES = [
  { main: 0x5a3525, dark: 0x2b211c, light: 0x806047, hair: 0x211815 },
  { main: 0x372822, dark: 0x191412, light: 0x60463a, hair: 0x121010 },
  { main: 0x8b6a4d, dark: 0x49372d, light: 0xb09272, hair: 0x30241f },
  { main: 0xa88e69, dark: 0x554738, light: 0xc4ad88, hair: 0x3b3029 },
  { main: 0x59463b, dark: 0x28201d, light: 0x806a58, hair: 0x181515 },
] as const;

/** Animated Quaternius CC0 horses shared by pastures and mounted companies. */
export class CavalryHorseRenderer {
  readonly ready: Promise<boolean>;
  private readonly group = new THREE.Group();
  private readonly visuals = new Map<string, HorseVisual>();
  private source: HorseSource | null = null;
  private batch: AuthoredAnimalInstanceBatch | null = null;
  private disposed = false;

  constructor(parent: THREE.Group) {
    this.group.name = 'Quaternius pasture and mounted horses';
    parent.add(this.group);
    this.ready = this.loadSource();
  }

  sync(poses: readonly CavalryHorsePose[], view: CrowdViewState | undefined, dt: number): void {
    const active = new Set<string>();
    const frameDt = Math.max(0, Math.min(0.1, dt));
    for (const pose of poses) {
      if (!isWithinAnimalCrowdView(pose.x, pose.z, view)) continue;
      active.add(pose.id);
      let visual = this.visuals.get(pose.id);
      if (!visual) {
        const created = this.createVisual(pose);
        if (!created) continue;
        visual = created;
        this.visuals.set(pose.id, created);
      }
      visual.root.position.set(pose.x, pose.y, pose.z);
      visual.root.rotation.y = pose.yaw;

      const nextMode = horseMotionMode(pose);
      this.transition(visual, nextMode);
      visual.actions.walk.setEffectiveTimeScale(
        Math.max(0.68, Math.min(1.85, pose.moveSpeed / HORSE_WALK_SPEED)),
      );
      if (this.batch) this.batch.updateAnimation(visual.model, visual.mixer, frameDt);
      else visual.mixer.update(frameDt);
    }
    for (const [id, visual] of this.visuals) {
      if (active.has(id)) continue;
      this.removeVisual(visual);
      this.visuals.delete(id);
    }
    this.flushBatch();
  }

  diagnostics(): ReturnType<AuthoredAnimalInstanceBatch['diagnostics']> | null {
    return this.batch?.diagnostics() ?? null;
  }

  hasVisibleShadowCasters(): boolean {
    return this.group.visible && this.visuals.size > 0;
  }

  dispose(): void {
    this.disposed = true;
    for (const visual of this.visuals.values()) this.removeVisual(visual);
    this.visuals.clear();
    this.batch?.dispose();
    this.batch = null;
    if (this.source) disposeModelResources(this.source.scene);
    this.source = null;
    this.group.removeFromParent();
  }

  private async loadSource(): Promise<boolean> {
    try {
      const gltf = await new GLTFLoader().loadAsync(HORSE_MODEL_URL);
      const bounds = new THREE.Box3().setFromObject(gltf.scene);
      const sourceHeight = bounds.max.y - bounds.min.y;
      if (!Number.isFinite(sourceHeight) || sourceHeight <= 0.001) {
        throw new Error(`Invalid horse model bounds for ${HORSE_MODEL_URL}`);
      }
      const source: HorseSource = {
        scene: gltf.scene,
        bounds,
        sourceHeight,
        clips: resolveHorseClips(gltf.animations),
        materialColors: sourceMaterialColors(gltf.scene),
      };
      if (this.disposed) {
        disposeModelResources(gltf.scene);
        return false;
      }
      this.source = source;
      try {
        this.batch = new AuthoredAnimalInstanceBatch({
          parent: this.group,
          sourceRoot: gltf.scene,
          animations: Object.values(source.clips),
          capacity: 32,
          name: 'Quaternius horse exact-model instances',
          castShadow: true,
          receiveShadow: true,
        });
      } catch (error) {
        console.warn('[Cavalry horses] Exact-model batching unavailable; retaining exact rigs.', error);
      }
      return true;
    } catch (error) {
      console.warn('[Cavalry horses] Animated Quaternius horse failed to load.', error);
      return false;
    }
  }

  private createVisual(pose: CavalryHorsePose): HorseVisual | null {
    if (!this.source) return null;
    const model = cloneSkinned(this.source.scene) as THREE.Group;
    const scale = HORSE_TARGET_HEIGHT / this.source.sourceHeight;
    model.scale.setScalar(scale);
    model.position.y = -this.source.bounds.min.y * scale;
    configureHorseMeshes(model, pose.appearanceSeed, this.batch === null);

    const root = new THREE.Group();
    root.name = `Quaternius cavalry horse ${pose.id}`;
    root.userData.cavalryHorseId = pose.id;
    root.add(model);
    setAuthoredAnimalEvaluatorOnly(model, this.batch !== null);

    const mixer = new THREE.AnimationMixer(model);
    const actions: Record<HorseMotionMode, THREE.AnimationAction> = {
      idle: mixer.clipAction(this.source.clips.idle, model),
      eat: mixer.clipAction(this.source.clips.eat, model),
      walk: mixer.clipAction(this.source.clips.walk, model),
    };
    for (const action of Object.values(actions)) {
      action.enabled = true;
      action.setLoop(THREE.LoopRepeat, Infinity);
    }
    const mode = horseMotionMode(pose);
    actions[mode].play();
    actions[mode].time = (pose.appearanceSeed % 1000) / 1000
      * Math.max(0.1, actions[mode].getClip().duration);
    this.group.add(root);
    return {
      root,
      model,
      mixer,
      actions,
      mode,
      appearanceSeed: pose.appearanceSeed,
    };
  }

  private transition(visual: HorseVisual, nextMode: HorseMotionMode): void {
    if (visual.mode === nextMode) return;
    visual.actions[visual.mode].fadeOut(0.18);
    visual.actions[nextMode].reset().fadeIn(0.18).play();
    visual.mode = nextMode;
  }

  private removeVisual(visual: HorseVisual): void {
    visual.mixer.stopAllAction();
    visual.mixer.uncacheRoot(visual.model);
    if (!this.batch) disposeClonedModelMaterials(visual.model);
    visual.root.removeFromParent();
  }

  private flushBatch(): void {
    if (!this.batch) return;
    const visible = [...this.visuals.values()].filter((visual) => visual.root.visible);
    this.batch.beginFrame(visible.length);
    for (const visual of visible) {
      this.batch.submit(visual.model, this.horseMaterialColors(visual.appearanceSeed));
    }
    this.batch.endFrame();
  }

  private horseMaterialColors(seed: number): AuthoredAnimalMaterialColor[] {
    if (!this.batch || !this.source) return [];
    const palette = HORSE_COAT_PALETTES[seed % HORSE_COAT_PALETTES.length]!;
    const targetByName: Record<string, number> = {
      Main: palette.main,
      Main_Dark: palette.dark,
      Main_Light: palette.light,
      Hair: palette.hair,
      Hooves: 0x2e2923,
      Muzzle: 0x4d3528,
      Eye_White: 0xd8d2c7,
    };
    const sourceByName = this.source.materialColors;
    return this.batch.materialSlots().flatMap((slot) => {
      const target = targetByName[slot.name];
      const source = sourceByName.get(slot.name);
      if (target === undefined || !source) return [];
      const targetColor = new THREE.Color(target);
      return [{
        materialSlot: slot.index,
        color: new THREE.Color(
          targetColor.r / Math.max(1e-6, source.r),
          targetColor.g / Math.max(1e-6, source.g),
          targetColor.b / Math.max(1e-6, source.b),
        ),
      }];
    });
  }
}

function horseMotionMode(pose: CavalryHorsePose): HorseMotionMode {
  if (pose.activity === 'walking' && pose.moveSpeed > 0.15) return 'walk';
  if (pose.activity === 'grazing') return 'eat';
  return 'idle';
}

function resolveHorseClips(
  animations: readonly THREE.AnimationClip[],
): Record<HorseMotionMode, THREE.AnimationClip> {
  const find = (...names: string[]): THREE.AnimationClip | undefined => animations.find((clip) => {
    const normalized = clip.name.toLowerCase();
    return names.some((name) => normalized === name || normalized.endsWith(`|${name}`));
  });
  const idle = find('idle');
  const eat = find('eating', 'idle_headlow');
  const walk = find('walk');
  if (!idle || !eat || !walk) {
    throw new Error(`Missing Idle/Eating/Walk clips in ${HORSE_MODEL_URL}`);
  }
  return { idle, eat, walk };
}

function configureHorseMeshes(
  model: THREE.Object3D,
  seed: number,
  clonePaletteMaterials: boolean,
): void {
  const palette = HORSE_COAT_PALETTES[seed % HORSE_COAT_PALETTES.length]!;
  const targetByName: Record<string, number> = {
    Main: palette.main,
    Main_Dark: palette.dark,
    Main_Light: palette.light,
    Hair: palette.hair,
    Hooves: 0x2e2923,
    Muzzle: 0x4d3528,
    Eye_White: 0xd8d2c7,
  };
  model.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    mesh.frustumCulled = false;
    if (!clonePaletteMaterials) {
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      return;
    }
    const sources = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const materials = sources.map((source) => {
      const material = source.clone();
      if (material instanceof THREE.MeshStandardMaterial) {
        const color = targetByName[material.name];
        if (color !== undefined) material.color.setHex(color);
        material.metalness = 0;
        material.roughness = 0.88;
      }
      return material;
    });
    mesh.material = Array.isArray(mesh.material) ? materials : materials[0]!;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
}

function sourceMaterialColors(source: THREE.Object3D): Map<string, THREE.Color> {
  const colors = new Map<string, THREE.Color>();
  source.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (material instanceof THREE.MeshStandardMaterial && !colors.has(material.name)) {
        colors.set(material.name, material.color);
      }
    }
  });
  return colors;
}

function disposeClonedModelMaterials(model: THREE.Object3D): void {
  const materials = new Set<THREE.Material>();
  model.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      materials.add(material);
    }
  });
  for (const material of materials) material.dispose();
}

function disposeModelResources(source: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  source.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
}
