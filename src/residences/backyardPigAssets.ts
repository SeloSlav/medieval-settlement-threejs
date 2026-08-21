import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

export const BACKYARD_PIG_MODEL_PATH = '/assets/models/livestock/quaternius-pig.glb';

export type BackyardPigSource = {
  scene: THREE.Group;
  bounds: THREE.Box3;
  height: number;
  idle: THREE.AnimationClip;
  graze: THREE.AnimationClip;
};

export async function loadBackyardPigSource(): Promise<BackyardPigSource> {
  const gltf = await new GLTFLoader().loadAsync(BACKYARD_PIG_MODEL_PATH);
  const bounds = new THREE.Box3().setFromObject(gltf.scene);
  const height = bounds.max.y - bounds.min.y;
  const findClip = (...names: string[]): THREE.AnimationClip | undefined => gltf.animations.find((clip) => {
    const normalized = clip.name.toLowerCase();
    return names.some((name) => normalized === name || normalized.endsWith(`|${name}`));
  });
  const idle = findClip('idle', 'idle_1');
  const graze = findClip('eating', 'idle_eating', 'idle_headlow') ?? idle;
  if (!idle || !graze || height <= 0.001) {
    throw new Error('Pig GLB is missing its rigged idle/graze set.');
  }
  return { scene: gltf.scene, bounds, height, idle, graze };
}

export function createBackyardPigModel(
  source: BackyardPigSource,
  targetHeight: number,
): THREE.Group {
  const model = cloneSkinned(source.scene) as THREE.Group;
  const scale = targetHeight / source.height;
  model.scale.setScalar(scale);
  model.position.y = -source.bounds.min.y * scale + 0.015;
  model.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.userData.backyardSharedGeometry = true;
  });
  return model;
}

export function removeBackyardPigFallbacks(marker: THREE.Object3D): void {
  const fallbacks: THREE.Object3D[] = [];
  marker.traverse((object) => {
    if (object.name === 'PigFallback') fallbacks.push(object);
  });
  for (const fallback of fallbacks) {
    fallback.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
    fallback.removeFromParent();
  }
}

export function disposeBackyardPigSource(source: THREE.Object3D): void {
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
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
}
