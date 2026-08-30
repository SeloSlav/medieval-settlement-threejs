import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildTree } from '@seedthree/core/tree.js';
import { WIND_DIR } from '@seedthree/core/wind.js';
import { loadSeedThreeSpeciesAssets } from './seedThreeAssets.ts';
import { seedThreeFruitUrl } from './seedThreeTextures.ts';
import { BACKYARD_PLANT_SPECIES, type BackyardPlantKind } from './backyardPlantPresets.ts';
import { createGorskiShrubPrototype } from './gorskiShrubPrototypes.ts';
import {
  createSeedThreeTreeBarkWindPosition,
  createSeedThreeTreeCardWindPosition,
} from './seedThreeFoliageWind.ts';

export type OrchardTreeKind = 'apple' | 'cherry' | 'pear';
export type OrchardShrubKind = 'aronia' | 'rosehip';
export type OrchardFruitKind = OrchardTreeKind | OrchardShrubKind;

export type BackyardSeasonalFoliageTintBinding = {
  color: { value: THREE.Color };
  amount: { value: number };
};

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
  pear: 3,
  aronia: 3,
  rosehip: 3,
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
const BACKYARD_TREE_BARK_POSITION_NODE = createSeedThreeTreeBarkWindPosition();
const BACKYARD_TREE_CARD_POSITION_NODE = createSeedThreeTreeCardWindPosition(true);
const BACKYARD_TREE_CROWN_POSITION_NODE = createSeedThreeTreeCardWindPosition(false);

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
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (!(mesh as THREE.InstancedMesh).isInstancedMesh) {
      if (
        !mesh.geometry.getAttribute('aWind')
        || !mesh.geometry.getAttribute('aStemCenter')
      ) {
        return;
      }
      for (const material of materials) {
        (material as THREE.Material & { positionNode?: unknown }).positionNode =
          BACKYARD_TREE_BARK_POSITION_NODE;
        material.userData.seedThreeWindClock = 'world-animation';
        material.needsUpdate = true;
      }
      return;
    }

    const foliage = mesh as THREE.InstancedMesh;
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
    const positionNode = foliage.geometry.userData.crownUnderlay === true
      ? BACKYARD_TREE_CROWN_POSITION_NODE
      : BACKYARD_TREE_CARD_POSITION_NODE;
    for (const material of materials) {
      (material as THREE.Material & { positionNode?: unknown }).positionNode = positionNode;
      material.userData.seedThreeWindClock = 'world-animation';
      material.needsUpdate = true;
    }
    foliage.userData.backyardFoliageWindNormalized = true;
  });
}

export function loadBackyardPlantCatalog(maxAnisotropy: number): Promise<BackyardPlantCatalog> {
  if (catalogPromise) return catalogPromise;

  catalogPromise = (async () => {
    const fruitPrototypes = await loadFruitPrototypes();
    const prototypes = new Map<BackyardPlantKind, THREE.LOD[]>();
    const seasonalFoliageBindings = new Map<
      OrchardFruitKind,
      BackyardSeasonalFoliageTintBinding[]
    >();
    for (const kind of ['apple', 'cherry', 'pear', 'aronia', 'rosehip', 'rose'] as const) {
      const species = BACKYARD_PLANT_SPECIES[kind];
      const assets = await loadSeedThreeSpeciesAssets(species, maxAnisotropy);
      if (kind === 'apple' || kind === 'cherry' || kind === 'pear') {
        seasonalFoliageBindings.set(kind, [
          { color: assets.leafTintColor, amount: assets.leafTintAmount },
          { color: assets.clusterTintColor, amount: assets.clusterTintAmount },
        ]);
      }
      const variants: THREE.LOD[] = [];
      for (let variant = 0; variant < VARIANT_COUNT[kind]; variant++) {
        const group = kind === 'aronia' || kind === 'rosehip'
          ? createOrchardShrub(kind, variant, assets)
          : buildTree(
            species,
            `backyard:${kind}:${variant}`,
            assets,
            GARDEN_LOD_OPTIONS,
          ).group;
        group.name = `SeedThree ${kind} prototype ${variant + 1}`;
        if (kind !== 'aronia' && kind !== 'rosehip') {
          normalizeBackyardPlantFoliageWind(group);
        }
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
        if (kind === 'apple' || kind === 'cherry' || kind === 'pear') {
          clone.userData.backyardSeasonalFoliageTintBindings = seasonalFoliageBindings.get(kind);
        }
        const fruitAnchors = source.userData.backyardFruitAnchors as number[][] | undefined;
        if (fruitAnchors) {
          clone.userData.backyardFruitAnchors = fruitAnchors.map((anchor) => [...anchor]);
        }
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
        const metadata = FRUIT_METADATA[kind];
        mesh.name = metadata.name;
        mesh.userData.fruitModel = metadata.fileName;
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
          const baseScale = metadata.scale;
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
  const entries = await Promise.all(
    (Object.keys(FRUIT_METADATA) as OrchardFruitKind[]).map(async (kind) => [
      kind,
      await loadFruitPrototype(FRUIT_METADATA[kind].fileName),
    ] as const),
  );
  return Object.fromEntries(entries) as Record<OrchardFruitKind, FruitPrototype>;
}

const FRUIT_METADATA: Record<OrchardFruitKind, {
  fileName: string;
  name: string;
  scale: number;
}> = {
  apple: { fileName: 'apple.glb', name: 'SeedThree apple GLB fruit', scale: 1.14 },
  cherry: { fileName: 'cherry_pair.glb', name: 'SeedThree cherry-pair GLB fruit', scale: 1 },
  pear: { fileName: 'pear.glb', name: 'SeedThree pear GLB fruit', scale: 1 },
  aronia: { fileName: 'aronia_cluster.glb', name: 'SeedThree aronia-cluster GLB fruit', scale: 1 },
  rosehip: { fileName: 'rosehip_cluster.glb', name: 'SeedThree rosehip-cluster GLB fruit', scale: 1 },
};

function createOrchardShrub(
  kind: OrchardShrubKind,
  variant: number,
  assets: Awaited<ReturnType<typeof loadSeedThreeSpeciesAssets>>,
): THREE.LOD {
  const prototype = createGorskiShrubPrototype(kind, variant);
  prototype.geometry.userData.prototypeTriangleCount = prototype.triangleCount;
  const branch = new MeshStandardNodeMaterial() as unknown as THREE.MeshStandardMaterial;
  branch.name = `SeedThree ${kind} branch material`;
  branch.map = assets.barkTexture;
  branch.normalMap = assets.barkNormal;
  branch.roughnessMap = assets.barkRoughness;
  branch.roughness = assets.barkRoughness ? 1 : 0.92;
  branch.metalness = 0;
  const foliage = new MeshStandardNodeMaterial() as unknown as THREE.MeshStandardMaterial;
  foliage.name = `SeedThree ${kind} foliage material`;
  foliage.map = assets.leafTexture;
  foliage.normalMap = assets.leafNormal;
  foliage.roughnessMap = assets.leafRoughness;
  foliage.roughness = assets.leafRoughness ? 1 : 0.91;
  foliage.metalness = 0;
  foliage.alphaTest = kind === 'aronia' ? 0.42 : 0.4;
  foliage.side = THREE.DoubleSide;
  foliage.forceSinglePass = true;
  foliage.normalScale.set(0.45, 0.45);
  foliage.userData.translucencyMap = assets.leafTranslucency;

  const mesh = new THREE.Mesh(prototype.geometry, [branch, foliage]);
  mesh.name = `SeedThree ${kind} dichotomous shrub`;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.userData.backyardSharedGeometry = true;
  mesh.userData.seedThreeGenerator = prototype.geometry.userData.seedThreeGenerator;
  mesh.userData.prototypeTriangleCount = prototype.triangleCount;

  const lod = new THREE.LOD();
  lod.addLevel(mesh, 0);
  lod.userData.backyardFruitAnchors = prototype.fruitAnchors.map(
    (anchor) => [anchor.x, anchor.y, anchor.z],
  );
  lod.userData.seedThreeGenerator = prototype.geometry.userData.seedThreeGenerator;
  lod.userData.prototypeTriangleCount = prototype.triangleCount;
  return lod;
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
