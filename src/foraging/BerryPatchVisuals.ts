import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import * as tsl from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Terrain } from '../terrain/Terrain.ts';
import type { RendererBackendKind } from '../scene/RendererBackend.ts';
import { supportsNodeMaterials } from '../scene/RendererBackend.ts';
import { chainMaterialShaderPatch } from '../scene/materialShaderPatch.ts';
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
import type { EnvironmentState } from '../world/seasonPolicy.ts';
import {
  BERRY_THICKET_MAX_SPACING,
  BERRY_THICKET_MIN_SPACING,
  MAX_RASPBERRIES_PER_CLUMP,
  RASPBERRY_CANE_HEIGHT_MULTIPLIER,
  berryClumpTargetCount,
  berryThicketRadiusScale,
  isBerryFruitVisible,
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

type BerryFruitPlacement = {
  nodeId: string;
  clumpIndex: number;
  fruitIndex: number;
  clump: BerryClumpPlacement;
  matrix: THREE.Matrix4;
  offsetX: number;
  offsetZ: number;
  heightAboveGround: number;
  visibilityNoise: number;
};

type RaspberryMaterialSet = {
  branch: THREE.Material;
  foliage: THREE.Material;
  fruit: THREE.Material;
  textures: THREE.Texture[];
};

export type BerryPatchEnvironment = Pick<
  EnvironmentState,
  'deciduousFoliage' | 'snowCoverage'
>;

export type BerryPatchVisuals = {
  group: THREE.Group;
  placements: ReadonlyArray<BerryClumpPlacement>;
  sync: (nodes: Iterable<ForagingNodeState>, month: number) => void;
  setEnvironment: (environment: BerryPatchEnvironment) => boolean;
  dispose: () => void;
};

const TAU = Math.PI * 2;
const textureLoader = new THREE.TextureLoader();
const gltfLoader = new GLTFLoader();

/**
 * Turns authoritative berry sites into instanced Rubus idaeus cane shrubs.
 * The skeleton/spray grammar is SeedThree's upstream shrub path. Raspberry
 * fruit uses one compacted instance buffer so individual berries disappear as
 * authoritative stock falls without multiplying draw calls.
 */
export async function createBerryPatchVisuals(
  terrain: Terrain,
  sites: ReadonlyArray<ForagingSite>,
  maxAnisotropy: number,
  rendererBackend: RendererBackendKind,
  seed: number,
  isBlockedAt?: (x: number, z: number) => boolean,
): Promise<BerryPatchVisuals> {
  const berrySites = sites.filter((site) => site.kind === 'berries');
  const rng = mulberry32(seed ^ 0xb3e771);
  const placements = createBerryClumpPlacements(berrySites, rng, isBlockedAt);
  const { geometry: fruitGeometry, material: fruitMaterial } = await loadRaspberryFruit();
  const [
    branchAlbedo,
    branchNormal,
    branchRoughness,
    foliageAlbedo,
    foliageNormal,
    foliageRoughness,
    foliageTranslucency,
  ] = await Promise.all([
    loadRequiredTexture(seedThreeBarkUrl('raspberry_cane_albedo.png'), true, maxAnisotropy),
    loadOptionalTexture(seedThreeBarkUrl('raspberry_cane_normal.png'), false, maxAnisotropy),
    loadOptionalTexture(seedThreeBarkUrl('raspberry_cane_roughness.png'), false, maxAnisotropy),
    loadRequiredTexture(seedThreeLeafUrl('raspberry_spray_albedo.png'), true, maxAnisotropy),
    loadOptionalTexture(seedThreeLeafUrl('raspberry_spray_normal.png'), false, maxAnisotropy),
    loadOptionalTexture(seedThreeLeafUrl('raspberry_spray_roughness.png'), false, maxAnisotropy),
    loadOptionalTexture(seedThreeLeafUrl('raspberry_spray_translucency.png'), false, maxAnisotropy),
  ]);
  const useNodeMaterials = supportsNodeMaterials(rendererBackend);
  const materials: RaspberryMaterialSet = {
    branch: createRaspberryBranchMaterial(
      branchAlbedo,
      branchNormal,
      branchRoughness,
      useNodeMaterials,
    ),
    foliage: createRaspberryFoliageMaterial(
      foliageAlbedo,
      foliageNormal,
      foliageRoughness,
      useNodeMaterials,
    ),
    fruit: fruitMaterial,
    textures: [branchAlbedo, foliageAlbedo, ...[
      branchNormal,
      branchRoughness,
      foliageNormal,
      foliageRoughness,
      foliageTranslucency,
    ].filter(
      (texture): texture is THREE.Texture => Boolean(texture),
    )],
  };
  materials.foliage.userData.translucencyMap = foliageTranslucency;

  const prototypes = Array.from({ length: GORSKI_SHRUB_VARIANT_COUNT }, (_, variant) => {
    const prototype = createGorskiShrubPrototype('raspberry', variant);
    prototype.geometry.userData.prototypeTriangleCount = prototype.triangleCount;
    return prototype;
  });

  const meshes = prototypes.map((prototype, prototypeIndex) => {
    const variantPlacements = placements.filter(
      (placement) => placement.prototypeIndex === prototypeIndex,
    );
    const capacity = Math.max(variantPlacements.length, 1);
    const mesh = new THREE.InstancedMesh(
      prototype.geometry,
      [materials.branch, materials.foliage],
      capacity,
    );
    mesh.name = `SeedThree real raspberry prototype ${prototypeIndex + 1}`;
    mesh.userData.fruitModel = 'raspberry_cluster.glb';
    mesh.userData.prototypeTriangleCount = prototype.triangleCount;
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
      const width = placement.scale * THREE.MathUtils.lerp(1.0, 1.18, rng());
      const height = placement.scale
        * THREE.MathUtils.lerp(0.9, 1.08, rng())
        * RASPBERRY_CANE_HEIGHT_MULTIPLIER;
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

  const { mesh: fruitMesh, placements: fruitPlacements } = createRaspberryFruitInstances(
    terrain,
    placements,
    prototypes,
    fruitGeometry,
    materials.fruit,
  );

  const group = new THREE.Group();
  group.name = 'Harvestable real raspberry resource patches';
  group.userData.berryPatchCenters = berrySites.map((site, index) => ({
    nodeId: `foraging-berries-${index}`,
    x: site.x,
    z: site.z,
  }));
  group.userData.seedThreeShrubSystem = true;
  group.userData.raspberryFruitModel = 'raspberry_cluster.glb';
  group.userData.raspberryFruitCapacity = fruitPlacements.length;
  group.userData.raspberryClumpCount = placements.length;
  group.userData.raspberryCaneHeightMultiplier = RASPBERRY_CANE_HEIGHT_MULTIPLIER;
  group.userData.berryThicketRadiusScales = berrySites.map(
    (site) => berryThicketRadiusScale(site.isRich === true),
  );
  group.add(...meshes, fruitMesh);

  const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  const workingMatrix = new THREE.Matrix4();
  const workingFruitMatrix = new THREE.Matrix4();
  const sync = (nodes: Iterable<ForagingNodeState>, month: number): void => {
    const byId = new Map(Array.from(nodes, (node) => [node.nodeId, node] as const));
    const seasonAvailable = isForagingHarvestAvailable('berries', month);
    const visibleClumps = new Set<BerryClumpPlacement>();
    placements.forEach((placement) => {
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
      // Harvesting removes berries, not the perennial raspberry crown. Keep
      // every authored cane clump resident through depletion and winter so the
      // resource never pops into bare ground when its stock reaches zero.
      visibleClumps.add(placement);
      workingMatrix.copy(placement.matrix);
      workingMatrix.setPosition(
        worldPosition.x,
        terrain.getHeightAt(worldPosition.x, worldPosition.z) + 0.045,
        worldPosition.z,
      );
      mesh.setMatrixAt(placement.meshIndex, workingMatrix);
    });
    for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true;

    let visibleFruitCount = 0;
    for (const fruit of fruitPlacements) {
      const node = byId.get(fruit.nodeId);
      if (
        !node
        || !visibleClumps.has(fruit.clump)
        || !isBerryFruitVisible(
          node.remaining,
          node.maxYield,
          seasonAvailable,
          fruit.visibilityNoise,
        )
      ) {
        continue;
      }
      const clumpPosition = resolveBerryClumpPosition(
        fruit.clump.originX,
        fruit.clump.originZ,
        fruit.clump.x,
        fruit.clump.z,
        node.x,
        node.z,
      );
      const fruitX = clumpPosition.x + fruit.offsetX;
      const fruitZ = clumpPosition.z + fruit.offsetZ;
      workingFruitMatrix.copy(fruit.matrix);
      workingFruitMatrix.setPosition(
        fruitX,
        terrain.getHeightAt(clumpPosition.x, clumpPosition.z) + 0.045 + fruit.heightAboveGround,
        fruitZ,
      );
      fruitMesh.setMatrixAt(visibleFruitCount, workingFruitMatrix);
      visibleFruitCount++;
    }
    fruitMesh.count = visibleFruitCount;
    fruitMesh.instanceMatrix.needsUpdate = true;
    group.userData.visibleRaspberryFruit = visibleFruitCount;
    group.userData.berryPatchCenters = berrySites.map((site, index) => {
      const nodeId = `foraging-berries-${index}`;
      const node = byId.get(nodeId);
      return { nodeId, x: node?.x ?? site.x, z: node?.z ?? site.z };
    });
  };

  const setEnvironment = (environment: BerryPatchEnvironment): boolean => {
    const springFlush = clampSeasonAmount(environment.deciduousFoliage.springFlush);
    const autumnColor = clampSeasonAmount(environment.deciduousFoliage.autumnColor);
    const dormancy = clampSeasonAmount(environment.deciduousFoliage.dormancy);
    const snowCoverage = clampSeasonAmount(environment.snowCoverage);
    let changed = false;
    changed = setMaterialUniform(
      materials.foliage,
      'raspberrySeasonalSpringFlush',
      springFlush,
    ) || changed;
    changed = setMaterialUniform(
      materials.foliage,
      'raspberrySeasonalAutumnColor',
      autumnColor,
    ) || changed;
    changed = setMaterialUniform(
      materials.foliage,
      'raspberrySeasonalDormancy',
      dormancy,
    ) || changed;
    changed = setMaterialUniform(
      materials.foliage,
      'raspberrySnowCoverage',
      snowCoverage,
    ) || changed;
    changed = setMaterialUniform(
      materials.branch,
      'raspberrySnowCoverage',
      snowCoverage,
    ) || changed;

    // At exact winter dormancy, skip the foliage material group completely.
    // The branch group in the same geometry remains visible and snow-covered.
    const foliageVisible = dormancy < 1;
    if (materials.foliage.visible !== foliageVisible) {
      materials.foliage.visible = foliageVisible;
      changed = true;
    }
    group.userData.raspberrySeason = {
      springFlush,
      autumnColor,
      dormancy,
      snowCoverage,
    };
    return changed;
  };

  setEnvironment({
    deciduousFoliage: { springFlush: 0, autumnColor: 0, dormancy: 0 },
    snowCoverage: 0,
  });

  return {
    group,
    placements,
    sync,
    setEnvironment,
    dispose: () => {
      for (const mesh of meshes) mesh.geometry.dispose();
      fruitMesh.geometry.dispose();
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

function createRaspberryFruitInstances(
  terrain: Terrain,
  clumps: ReadonlyArray<BerryClumpPlacement>,
  prototypes: ReadonlyArray<ReturnType<typeof createGorskiShrubPrototype>>,
  fruitGeometry: THREE.BufferGeometry,
  fruitMaterial: THREE.Material,
): { mesh: THREE.InstancedMesh; placements: BerryFruitPlacement[] } {
  fruitGeometry.computeBoundingBox();
  const fruitSize = fruitGeometry.boundingBox!.getSize(new THREE.Vector3());
  const sourceDiameter = Math.max(fruitSize.x, fruitSize.z, 0.001);
  const capacity = Math.max(clumps.length * MAX_RASPBERRIES_PER_CLUMP, 1);
  const mesh = new THREE.InstancedMesh(fruitGeometry, fruitMaterial, capacity);
  mesh.name = 'Depleting real raspberry fruit instances';
  mesh.userData.fruitModel = 'raspberry_cluster.glb';
  mesh.userData.sourceDiameterM = sourceDiameter;
  mesh.userData.targetDiameterM = [0.017, 0.022];
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;

  const placements: BerryFruitPlacement[] = [];
  const clumpPosition = new THREE.Vector3();
  const clumpQuaternion = new THREE.Quaternion();
  const clumpScale = new THREE.Vector3();
  const fruitPosition = new THREE.Vector3();
  const fruitQuaternion = new THREE.Quaternion();
  const fruitScale = new THREE.Vector3();
  const fruitMatrix = new THREE.Matrix4();

  for (const clump of clumps) {
    if (!clump.matrix) continue;
    clump.matrix.decompose(clumpPosition, clumpQuaternion, clumpScale);
    const anchors = prototypes[clump.prototypeIndex]!.fruitAnchors
      .slice(0, MAX_RASPBERRIES_PER_CLUMP);
    for (let fruitIndex = 0; fruitIndex < anchors.length; fruitIndex++) {
      const globalIndex = placements.length;
      fruitPosition.copy(anchors[fruitIndex]!).applyMatrix4(clump.matrix);
      fruitQuaternion.copy(clumpQuaternion).multiply(
        new THREE.Quaternion().setFromEuler(new THREE.Euler(
          (hash01(globalIndex * 3.1 + 0.7) - 0.5) * 0.18,
          hash01(globalIndex * 8.3 + 1.7) * TAU,
          (hash01(globalIndex * 6.7 + 5.2) - 0.5) * 0.12,
          'YXZ',
        )),
      );
      const targetDiameter = THREE.MathUtils.lerp(
        0.017,
        0.022,
        hash01(globalIndex * 5.7 + 4.2),
      );
      fruitScale.setScalar(targetDiameter / sourceDiameter);
      fruitMatrix.compose(fruitPosition, fruitQuaternion, fruitScale);
      const groundY = terrain.getHeightAt(clump.x, clump.z) + 0.045;
      placements.push({
        nodeId: clump.nodeId,
        clumpIndex: clump.clumpIndex,
        fruitIndex,
        clump,
        matrix: fruitMatrix.clone(),
        offsetX: fruitPosition.x - clump.x,
        offsetZ: fruitPosition.z - clump.z,
        heightAboveGround: fruitPosition.y - groundY,
        visibilityNoise: hash01(globalIndex * 11.73 + 9.1),
      });
    }
  }
  mesh.userData.capacity = placements.length;
  return { mesh, placements };
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
    const isRich = site.isRich === true;
    const targetCount = berryClumpTargetCount(isRich);
    const radiusScale = berryThicketRadiusScale(isRich);
    const patch: BerryClumpPlacement[] = [];
    let attempts = 0;
    while (patch.length < targetCount && attempts < targetCount * 24) {
      attempts++;
      const radius = patch.length === 0
        ? 0
        : Math.pow(rng(), 0.68) * BERRY_PATCH_RADIUS * radiusScale;
      const angle = rng() * TAU;
      const x = site.x + Math.cos(angle) * radius * THREE.MathUtils.lerp(0.72, 1, rng());
      const z = site.z + Math.sin(angle) * radius * THREE.MathUtils.lerp(0.78, 1.08, rng());
      if (isBlockedAt?.(x, z)) continue;
      if (!hasMinimumClumpDistance(
        patch,
        x,
        z,
        THREE.MathUtils.lerp(BERRY_THICKET_MIN_SPACING, BERRY_THICKET_MAX_SPACING, rng()),
      )) continue;
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
