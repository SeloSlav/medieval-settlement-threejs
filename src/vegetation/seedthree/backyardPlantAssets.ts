import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildTree } from '@seedthree/core/tree.js';
import { WIND_DIR } from '@seedthree/core/wind.js';
import { loadSeedThreeSpeciesAssets } from './seedThreeAssets.ts';
import { seedThreeFruitUrl } from './seedThreeTextures.ts';
import { BACKYARD_PLANT_SPECIES, type BackyardPlantKind } from './backyardPlantPresets.ts';

export type OrchardFruitKind = 'apple' | 'cherry';

export type BackyardPlantCatalog = {
  clone(kind: BackyardPlantKind, variant: number): THREE.LOD;
  createFruitInstances(
    kind: OrchardFruitKind,
    positions: ReadonlyArray<THREE.Vector3>,
    variant: number,
  ): THREE.InstancedMesh;
};

type FruitPrototype = {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
};

const VARIANT_COUNT: Record<BackyardPlantKind, number> = {
  apple: 3,
  cherry: 3,
  rose: 2,
};

const GARDEN_LOD_OPTIONS = {
  meshQuality: 0.72,
  lod1Dist: 20,
  lod2Dist: 42,
  lod1Pct: 52,
  lod2Pct: 20,
  lod1Density: 0.9,
  lod2Density: 0.72,
  lod2Prune: 0.18,
};

let catalogPromise: Promise<BackyardPlantCatalog> | null = null;
const fruitLoader = new GLTFLoader();

function markSharedPrototypeGeometry(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.userData.backyardSharedGeometry = true;
  });
}

/**
 * SeedThree's source leaf matrices pre-compensate wind for the old r184
 * pre-instance position pipeline. Three r185 exposes the post-instance local
 * position to positionNode, so that inverse leaf scale turns a 20 cm sway into
 * several metres on small orchard leaves and rose foliage. Rebuild the vector
 * in plant/object space, matching the forest instance path.
 */
export function normalizeBackyardPlantFoliageWind(root: THREE.Object3D): void {
  root.traverse((object) => {
    const foliage = object as THREE.InstancedMesh;
    if (!foliage.isInstancedMesh) return;
    const windVector = foliage.geometry.getAttribute('aWindVec');
    const weights = foliage.geometry.userData.windWeights;
    if (
      !(windVector instanceof THREE.InstancedBufferAttribute)
      || !(weights instanceof Float32Array)
    ) {
      return;
    }

    for (let index = 0; index < windVector.count; index++) {
      const weight = weights[index] ?? 0;
      windVector.setXYZ(
        index,
        WIND_DIR.x * weight,
        WIND_DIR.y * weight,
        WIND_DIR.z * weight,
      );
    }
    windVector.needsUpdate = true;
    foliage.userData.backyardFoliageWindNormalized = true;
  });
}

export function loadBackyardPlantCatalog(maxAnisotropy: number): Promise<BackyardPlantCatalog> {
  if (catalogPromise) return catalogPromise;

  catalogPromise = (async () => {
    const fruitPrototypes = await loadFruitPrototypes();
    const prototypes = new Map<BackyardPlantKind, THREE.LOD[]>();
    for (const kind of ['apple', 'cherry', 'rose'] as const) {
      const species = BACKYARD_PLANT_SPECIES[kind];
      const assets = await loadSeedThreeSpeciesAssets(species, maxAnisotropy);
      const variants: THREE.LOD[] = [];
      for (let variant = 0; variant < VARIANT_COUNT[kind]; variant++) {
        const { group } = buildTree(
          species,
          `backyard:${kind}:${variant}`,
          assets,
          GARDEN_LOD_OPTIONS,
        );
        group.name = `SeedThree ${kind} prototype ${variant + 1}`;
        normalizeBackyardPlantFoliageWind(group);
        markSharedPrototypeGeometry(group);
        variants.push(group);
      }
      prototypes.set(kind, variants);
    }

    return {
      clone(kind: BackyardPlantKind, variant: number): THREE.LOD {
        const variants = prototypes.get(kind);
        if (!variants?.length) throw new Error(`Missing backyard plant prototype: ${kind}`);
        const source = variants[Math.abs(variant) % variants.length]!;
        const clone = source.clone(true) as THREE.LOD;
        clone.name = `SeedThree backyard ${kind}`;
        markSharedPrototypeGeometry(clone);
        return clone;
      },
      createFruitInstances(
        kind: OrchardFruitKind,
        positions: ReadonlyArray<THREE.Vector3>,
        variant: number,
      ): THREE.InstancedMesh {
        const prototype = fruitPrototypes[kind];
        const mesh = new THREE.InstancedMesh(prototype.geometry, prototype.material, positions.length);
        mesh.name = kind === 'apple' ? 'SeedThree apple GLB fruit' : 'SeedThree cherry-pair GLB fruit';
        mesh.userData.fruitModel = kind === 'apple' ? 'apple.glb' : 'cherry_pair.glb';
        mesh.userData.fruitCount = positions.length;
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        const matrix = new THREE.Matrix4();
        const quaternion = new THREE.Quaternion();
        const scale = new THREE.Vector3();
        for (let index = 0; index < positions.length; index++) {
          const yaw = hash01(index * 9.17 + variant * 3.11) * Math.PI * 2;
          const tilt = (hash01(index * 4.73 + variant * 7.07) - 0.5) * 0.24;
          quaternion.setFromEuler(new THREE.Euler(tilt, yaw, tilt * 0.35, 'YXZ'));
          const baseScale = kind === 'apple' ? 1.14 : 1.0;
          const variedScale = baseScale * THREE.MathUtils.lerp(0.9, 1.12, hash01(index * 6.19 + 2.7));
          scale.setScalar(variedScale);
          matrix.compose(positions[index]!, quaternion, scale);
          mesh.setMatrixAt(index, matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        return mesh;
      },
    };
  })().catch((error) => {
    catalogPromise = null;
    throw error;
  });

  return catalogPromise;
}

async function loadFruitPrototypes(): Promise<Record<OrchardFruitKind, FruitPrototype>> {
  const [apple, cherry] = await Promise.all([
    loadFruitPrototype('apple.glb'),
    loadFruitPrototype('cherry_pair.glb'),
  ]);
  return { apple, cherry };
}

async function loadFruitPrototype(fileName: string): Promise<FruitPrototype> {
  const url = seedThreeFruitUrl(fileName);
  if (!url) throw new Error(`Missing SeedThree fruit asset: ${fileName}`);
  const gltf = await fruitLoader.loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  const sourceMeshes: THREE.Mesh[] = [];
  gltf.scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh) sourceMeshes.push(mesh);
  });
  if (sourceMeshes.length !== 1) {
    throw new Error(`SeedThree fruit ${fileName} must contain one baked mesh (found ${sourceMeshes.length})`);
  }
  const source = sourceMeshes[0]!;
  const geometry = source.geometry.clone().applyMatrix4(source.matrixWorld);
  geometry.computeBoundingBox();
  const center = geometry.boundingBox!.getCenter(new THREE.Vector3());
  geometry.translate(-center.x, -center.y, -center.z);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.backyardSharedGeometry = true;
  const sourceMaterial = Array.isArray(source.material) ? source.material[0]! : source.material;
  const material = sourceMaterial.clone();
  if (material instanceof THREE.MeshStandardMaterial) {
    material.roughness = Math.max(0.72, material.roughness);
    material.metalness = 0;
  }
  material.name = `SeedThree baked ${fileName} material`;
  return { geometry, material };
}

function hash01(value: number): number {
  const hash = Math.sin(value * 12.9898) * 43758.5453;
  return hash - Math.floor(hash);
}
