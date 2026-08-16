import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Terrain } from '../terrain/Terrain.ts';
import type { RendererBackendKind } from '../scene/RendererBackend.ts';
import { mulberry32 } from '../props/forestField.ts';
import { sampleBerryPatchClumpScale } from '../vegetation/bilberryBushVisual.ts';
import {
  createGorskiShrubPrototype,
  GORSKI_SHRUB_VARIANT_COUNT,
} from '../vegetation/seedthree/gorskiShrubPrototypes.ts';
import {
  seedThreeBarkUrl,
  seedThreeFruitUrl,
  seedThreeLeafUrl,
} from '../vegetation/seedthree/seedThreeTextures.ts';
import type { ForagingSite } from './ForagingLayout.ts';
import { BERRY_PATCH_RADIUS } from './foragingYields.ts';
import type { ForagingNodeState } from '../resources/types.ts';
import { isForagingHarvestAvailable } from './foragingSeason.ts';
import {
  isBerryClumpVisible,
  resolveBerryClumpPosition,
} from './berryPatchPresentation.ts';

type BerryClumpPlacement = {
  nodeId: string;
  clumpIndex: number;
  originX: number;
  originZ: number;
  x: number;
  z: number;
  yaw: number;
  scale: number;
  prototypeIndex: number;
  meshIndex: number;
  matrix: THREE.Matrix4 | null;
};

type RaspberryMaterialSet = {
  branch: THREE.MeshStandardMaterial;
  foliage: THREE.MeshStandardMaterial;
  fruit: THREE.Material;
  textures: THREE.Texture[];
};

export type BerryPatchVisuals = {
  group: THREE.Group;
  placements: ReadonlyArray<BerryClumpPlacement>;
  sync: (nodes: Iterable<ForagingNodeState>, month: number) => void;
  dispose: () => void;
};

const TAU = Math.PI * 2;
const CLUMPS_PER_PATCH = 22;
const textureLoader = new THREE.TextureLoader();
const gltfLoader = new GLTFLoader();

/**
 * Turns authoritative berry sites into instanced Rubus idaeus cane shrubs.
 * The skeleton/spray grammar is SeedThree's upstream shrub path; the generated
 * raspberry GLB is baked into each reusable prototype at terminal anchors.
 */
export async function createBerryPatchVisuals(
  terrain: Terrain,
  sites: ReadonlyArray<ForagingSite>,
  maxAnisotropy: number,
  _rendererBackend: RendererBackendKind,
  seed: number,
  isBlockedAt?: (x: number, z: number) => boolean,
): Promise<BerryPatchVisuals> {
  const berrySites = sites.filter((site) => site.kind === 'berries');
  const rng = mulberry32(seed ^ 0xb3e771);
  const placements = createBerryClumpPlacements(berrySites, rng, isBlockedAt);
  const { geometry: fruitGeometry, material: fruitMaterial } = await loadRaspberryFruit();
  const [branchAlbedo, branchNormal, branchRoughness, foliageAlbedo] = await Promise.all([
    loadRequiredTexture(seedThreeBarkUrl('blackbrush_branch_albedo.png'), true, maxAnisotropy),
    loadOptionalTexture(seedThreeBarkUrl('blackbrush_branch_normal.png'), false, maxAnisotropy),
    loadOptionalTexture(seedThreeBarkUrl('blackbrush_branch_roughness.png'), false, maxAnisotropy),
    loadRequiredTexture(seedThreeLeafUrl('raspberry_spray_albedo.png'), true, maxAnisotropy),
  ]);
  const materials: RaspberryMaterialSet = {
    branch: new THREE.MeshStandardMaterial({
      name: 'SeedThree raspberry cane bark',
      map: branchAlbedo,
      normalMap: branchNormal,
      roughnessMap: branchRoughness,
      roughness: branchRoughness ? 1 : 0.92,
      metalness: 0,
    }),
    foliage: new THREE.MeshStandardMaterial({
      name: 'Generated Rubus idaeus leaf sprays',
      map: foliageAlbedo,
      roughness: 0.9,
      metalness: 0,
      alphaTest: 0.38,
      side: THREE.DoubleSide,
      transparent: false,
    }),
    fruit: fruitMaterial,
    textures: [branchAlbedo, foliageAlbedo, ...[branchNormal, branchRoughness].filter(
      (texture): texture is THREE.Texture => Boolean(texture),
    )],
  };
  materials.foliage.forceSinglePass = true;

  const prototypes = Array.from({ length: GORSKI_SHRUB_VARIANT_COUNT }, (_, variant) => {
    const prototype = createGorskiShrubPrototype('raspberry', variant);
    const geometry = bakeRaspberryFruitIntoPrototype(prototype.geometry, prototype.fruitAnchors, fruitGeometry);
    prototype.geometry.dispose();
    geometry.userData.prototypeTriangleCount = triangleCount(geometry);
    geometry.userData.fruitModel = 'raspberry_cluster.glb';
    return geometry;
  });
  fruitGeometry.dispose();

  const meshes = prototypes.map((geometry, prototypeIndex) => {
    const variantPlacements = placements.filter(
      (placement) => placement.prototypeIndex === prototypeIndex,
    );
    const capacity = Math.max(variantPlacements.length, 1);
    const mesh = new THREE.InstancedMesh(
      geometry,
      [materials.branch, materials.foliage, materials.fruit],
      capacity,
    );
    mesh.name = `SeedThree real raspberry prototype ${prototypeIndex + 1}`;
    mesh.userData.fruitModel = 'raspberry_cluster.glb';
    mesh.userData.prototypeTriangleCount = geometry.userData.prototypeTriangleCount;
    mesh.count = variantPlacements.length;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.renderOrder = 3;
    mesh.frustumCulled = false;

    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const tint = new THREE.Color();
    variantPlacements.forEach((placement, meshIndex) => {
      placement.meshIndex = meshIndex;
      const y = terrain.getHeightAt(placement.x, placement.z) + 0.045;
      const leanDirection = rng() * TAU;
      const lean = THREE.MathUtils.lerp(0.025, 0.1, rng());
      position.set(placement.x, y, placement.z);
      quaternion.setFromEuler(new THREE.Euler(
        Math.cos(leanDirection) * lean,
        placement.yaw,
        Math.sin(leanDirection) * lean * 0.7,
        'YXZ',
      ));
      const width = placement.scale * THREE.MathUtils.lerp(1.0, 1.22, rng());
      const height = placement.scale * THREE.MathUtils.lerp(0.9, 1.08, rng());
      scale.set(width, height, width);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(meshIndex, matrix);
      placement.matrix = matrix.clone();
      tint.setRGB(
        THREE.MathUtils.lerp(0.86, 1, rng()),
        THREE.MathUtils.lerp(0.88, 1, rng()),
        THREE.MathUtils.lerp(0.84, 0.98, rng()),
      );
      mesh.setColorAt(meshIndex, tint);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return mesh;
  });

  const group = new THREE.Group();
  group.name = 'Harvestable real raspberry resource patches';
  group.userData.berryPatchCenters = berrySites.map((site, index) => ({
    nodeId: `foraging-berries-${index}`,
    x: site.x,
    z: site.z,
  }));
  group.userData.seedThreeShrubSystem = true;
  group.userData.raspberryFruitModel = 'raspberry_cluster.glb';
  group.add(...meshes);

  const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  const workingMatrix = new THREE.Matrix4();
  const sync = (nodes: Iterable<ForagingNodeState>, month: number): void => {
    const byId = new Map(Array.from(nodes, (node) => [node.nodeId, node] as const));
    const seasonAvailable = isForagingHarvestAvailable('berries', month);
    placements.forEach((placement, index) => {
      const mesh = meshes[placement.prototypeIndex]!;
      const node = byId.get(placement.nodeId);
      if (!node || !placement.matrix) {
        mesh.setMatrixAt(placement.meshIndex, hiddenMatrix);
        return;
      }
      const worldPosition = resolveBerryClumpPosition(
        placement.originX,
        placement.originZ,
        placement.x,
        placement.z,
        node.x,
        node.z,
      );
      const visible = isBerryClumpVisible(
        placement.clumpIndex,
        node.remaining,
        node.maxYield,
        seasonAvailable,
        hash01(index * 7.31 + 21.7),
      );
      if (!visible) {
        mesh.setMatrixAt(placement.meshIndex, hiddenMatrix);
        return;
      }
      workingMatrix.copy(placement.matrix);
      workingMatrix.setPosition(
        worldPosition.x,
        terrain.getHeightAt(worldPosition.x, worldPosition.z) + 0.045,
        worldPosition.z,
      );
      mesh.setMatrixAt(placement.meshIndex, workingMatrix);
    });
    for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true;
    group.userData.berryPatchCenters = berrySites.map((site, index) => {
      const nodeId = `foraging-berries-${index}`;
      const node = byId.get(nodeId);
      return { nodeId, x: node?.x ?? site.x, z: node?.z ?? site.z };
    });
  };

  return {
    group,
    placements,
    sync,
    dispose: () => {
      for (const mesh of meshes) mesh.geometry.dispose();
      materials.branch.dispose();
      materials.foliage.dispose();
      materials.fruit.dispose();
      for (const texture of materials.textures) texture.dispose();
    },
  };
}

async function loadRaspberryFruit(): Promise<{ geometry: THREE.BufferGeometry; material: THREE.Material }> {
  const url = seedThreeFruitUrl('raspberry_cluster.glb');
  if (!url) throw new Error('Missing SeedThree raspberry fruit GLB');
  const gltf = await gltfLoader.loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  gltf.scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh) meshes.push(mesh);
  });
  if (meshes.length !== 1) {
    throw new Error(`raspberry_cluster.glb must contain one mesh (found ${meshes.length})`);
  }
  const source = meshes[0]!;
  const geometry = source.geometry.clone().applyMatrix4(source.matrixWorld);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const centerX = (box.min.x + box.max.x) * 0.5;
  const centerZ = (box.min.z + box.max.z) * 0.5;
  geometry.translate(-centerX, -box.max.y, -centerZ);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const sourceMaterial = Array.isArray(source.material) ? source.material[0]! : source.material;
  const material = sourceMaterial.clone();
  material.name = 'Generated raspberry_cluster.glb material';
  return { geometry, material };
}

function bakeRaspberryFruitIntoPrototype(
  prototype: THREE.BufferGeometry,
  anchors: ReadonlyArray<THREE.Vector3>,
  fruitGeometry: THREE.BufferGeometry,
): THREE.BufferGeometry {
  const clonedBase = prototype.clone();
  const base = clonedBase.index ? clonedBase.toNonIndexed() : clonedBase;
  if (base !== clonedBase) clonedBase.dispose();
  ensureMergeAttributes(base, false);
  const fruitPieces = anchors.slice(0, 4).map((anchor, index) => {
    const clonedPiece = fruitGeometry.clone();
    const piece = clonedPiece.index ? clonedPiece.toNonIndexed() : clonedPiece;
    if (piece !== clonedPiece) clonedPiece.dispose();
    const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      (hash01(index * 3.1 + 0.7) - 0.5) * 0.2,
      hash01(index * 8.3 + 1.7) * TAU,
      0,
    ));
    const scale = THREE.MathUtils.lerp(0.94, 1.14, hash01(index * 5.7 + 4.2));
    piece.applyMatrix4(new THREE.Matrix4().compose(
      anchor,
      quaternion,
      new THREE.Vector3(scale, scale, scale),
    ));
    ensureMergeAttributes(piece, true);
    return piece;
  });
  const fruit = mergeGeometries(fruitPieces, false);
  for (const piece of fruitPieces) piece.dispose();
  if (!fruit) {
    base.dispose();
    throw new Error('Unable to bake raspberry fruit geometry');
  }
  const baseCount = base.index?.count ?? base.getAttribute('position').count;
  const fruitCount = fruit.index?.count ?? fruit.getAttribute('position').count;
  const geometry = mergeGeometries([base, fruit], false);
  if (!geometry) {
    base.dispose();
    fruit.dispose();
    throw new Error('Unable to merge raspberry shrub and fruit');
  }
  geometry.clearGroups();
  for (const group of base.groups) geometry.addGroup(group.start, group.count, group.materialIndex);
  geometry.addGroup(baseCount, fruitCount, 2);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  base.dispose();
  fruit.dispose();
  return geometry;
}

function ensureMergeAttributes(geometry: THREE.BufferGeometry, fruit: boolean): void {
  const count = geometry.getAttribute('position').count;
  if (!geometry.getAttribute('uv')) {
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  }
  if (!geometry.getAttribute('color')) {
    const colors = new Float32Array(count * 3);
    colors.fill(1);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
  if (!geometry.getAttribute('aRootWeight')) {
    const weights = new Float32Array(count);
    weights.fill(fruit ? 0.85 : 0);
    geometry.setAttribute('aRootWeight', new THREE.BufferAttribute(weights, 1));
  }
}

async function loadRequiredTexture(
  url: string | undefined,
  srgb: boolean,
  maxAnisotropy: number,
): Promise<THREE.Texture> {
  const texture = await loadOptionalTexture(url, srgb, maxAnisotropy);
  if (!texture) throw new Error(`Missing raspberry shrub texture: ${url ?? 'unknown'}`);
  return texture;
}

async function loadOptionalTexture(
  url: string | undefined,
  srgb: boolean,
  maxAnisotropy: number,
): Promise<THREE.Texture | null> {
  if (!url) return null;
  const texture = await textureLoader.loadAsync(url);
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = Math.max(1, Math.min(16, maxAnisotropy));
  return texture;
}

function triangleCount(geometry: THREE.BufferGeometry): number {
  return (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
}

function hash01(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function createBerryClumpPlacements(
  sites: ReadonlyArray<ForagingSite>,
  rng: () => number,
  isBlockedAt?: (x: number, z: number) => boolean,
): BerryClumpPlacement[] {
  const placements: BerryClumpPlacement[] = [];
  sites.forEach((site, index) => {
    const nodeId = `foraging-berries-${index}`;
    const patch: BerryClumpPlacement[] = [];
    let attempts = 0;
    while (patch.length < CLUMPS_PER_PATCH && attempts < CLUMPS_PER_PATCH * 18) {
      attempts++;
      const radius = patch.length === 0 ? 0 : Math.sqrt(rng()) * BERRY_PATCH_RADIUS;
      const angle = rng() * TAU;
      const x = site.x + Math.cos(angle) * radius * THREE.MathUtils.lerp(0.72, 1, rng());
      const z = site.z + Math.sin(angle) * radius * THREE.MathUtils.lerp(0.78, 1.08, rng());
      if (isBlockedAt?.(x, z)) continue;
      if (!hasMinimumClumpDistance(patch, x, z, 1.25 + rng() * 0.65)) continue;
      patch.push({
        nodeId,
        clumpIndex: patch.length,
        originX: site.x,
        originZ: site.z,
        x,
        z,
        yaw: rng() * TAU,
        scale: sampleBerryPatchClumpScale(rng),
        prototypeIndex: Math.floor(rng() * GORSKI_SHRUB_VARIANT_COUNT),
        meshIndex: -1,
        matrix: null,
      });
    }
    placements.push(...patch);
  });
  return placements;
}

function hasMinimumClumpDistance(
  placements: ReadonlyArray<BerryClumpPlacement>,
  x: number,
  z: number,
  minDistance: number,
): boolean {
  const minDistanceSq = minDistance * minDistance;
  return placements.every((placement) => {
    const dx = placement.x - x;
    const dz = placement.z - z;
    return dx * dx + dz * dz >= minDistanceSq;
  });
}
