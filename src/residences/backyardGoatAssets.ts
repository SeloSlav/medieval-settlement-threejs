import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

/** CC0 Quaternius Farm Animal Pack source used for the runtime goat variant. */
export const BACKYARD_GOAT_SOURCE_MODEL_PATH = '/assets/models/livestock/quaternius-sheep.glb';

export type BackyardGoatSource = {
  scene: THREE.Group;
  bounds: THREE.Box3;
  height: number;
  idle: THREE.AnimationClip;
  graze: THREE.AnimationClip;
};

export async function loadBackyardGoatSource(): Promise<BackyardGoatSource> {
  const gltf = await new GLTFLoader().loadAsync(BACKYARD_GOAT_SOURCE_MODEL_PATH);
  const bounds = new THREE.Box3().setFromObject(gltf.scene);
  const height = bounds.max.y - bounds.min.y;
  const findClip = (...names: string[]): THREE.AnimationClip | undefined => gltf.animations.find((clip) => {
    const normalized = clip.name.toLowerCase();
    return names.some((name) => normalized === name || normalized.endsWith(`|${name}`));
  });
  const idle = findClip('idle', 'idle_1');
  const graze = findClip('eating', 'idle_eating', 'idle_headlow') ?? idle;
  if (!idle || !graze || height <= 0.001) {
    throw new Error('Sheep-derived goat source is missing its idle/graze rig.');
  }
  return { scene: gltf.scene, bounds, height, idle, graze };
}

export function createBackyardGoatModel(
  source: BackyardGoatSource,
  targetHeight: number,
): THREE.Group {
  const model = cloneSkinned(source.scene) as THREE.Group;
  const scale = targetHeight / source.height;
  model.scale.set(scale * 0.86, scale * 1.03, scale * 0.82);
  model.position.y = -source.bounds.min.y * scale + 0.015;
  model.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const sourceMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const goatMaterials = sourceMaterials.map((sourceMaterial) => {
      const material = sourceMaterial.clone();
      if ('color' in material && material.color instanceof THREE.Color) {
        material.color.multiply(new THREE.Color(0x9a8064));
      }
      material.userData.backyardGoatVariant = true;
      return material;
    });
    mesh.material = Array.isArray(mesh.material) ? goatMaterials : goatMaterials[0]!;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.userData.backyardSharedGeometry = true;
  });

  const root = new THREE.Group();
  root.name = 'Animated sheep-derived CC0 goat';
  root.add(model);
  const hornMaterial = new THREE.MeshStandardMaterial({ color: 0x6e624e, roughness: 0.86 });
  for (const side of [-1, 1]) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.24, 7), hornMaterial);
    horn.name = 'Procedural goat horn';
    horn.position.set(side * 0.1, targetHeight * 0.82, targetHeight * 0.28);
    horn.rotation.set(side * 0.32, 0, side * -0.38);
    horn.castShadow = false;
    horn.receiveShadow = false;
    root.add(horn);
  }
  const beard = new THREE.Mesh(
    new THREE.ConeGeometry(0.055, 0.22, 7),
    new THREE.MeshStandardMaterial({ color: 0x51463a, roughness: 0.95 }),
  );
  beard.name = 'Procedural goat beard';
  beard.position.set(0, targetHeight * 0.55, targetHeight * 0.34);
  root.add(beard);
  return root;
}

export function removeBackyardGoatFallbacks(marker: THREE.Object3D): void {
  const fallbacks: THREE.Object3D[] = [];
  marker.traverse((object) => {
    if (object.name === 'GoatFallback') fallbacks.push(object);
  });
  for (const fallback of fallbacks) {
    fallback.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
    fallback.removeFromParent();
  }
}

export function disposeBackyardGoatModel(model: THREE.Object3D): void {
  model.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (material.userData.backyardGoatVariant || object.name.includes('goat')) material.dispose();
    }
    if (!mesh.userData.backyardSharedGeometry) mesh.geometry.dispose();
  });
}

export function disposeBackyardGoatSource(source: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  source.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (material) materials.add(material);
    }
  });
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
}
