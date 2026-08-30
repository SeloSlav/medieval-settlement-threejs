import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import type { Terrain } from '../terrain/Terrain.ts';
import { sampleTerrainMeshAttributeX } from '../terrain/TerrainMeshHeight.ts';
import { mulberry32 } from '../utils/random.ts';
import { SpatialHash2D } from '../utils/SpatialHash2D.ts';
import type { ForestTreePlacement } from './forestPlacements.ts';
import { createForestFloorPlacementMask } from './ForestFloorPlacementMask.ts';

const TAU = Math.PI * 2;
const LOCAL_TWIG_AXIS = new THREE.Vector3(1, 0, 0);
const WORLD_UP = new THREE.Vector3(0, 1, 0);

export const FOREST_FLOOR_TWIG_BARK_PRESET_KEY = 'americanBeech';
export const FOREST_FLOOR_TWIG_BARK_FILES = {
  albedo: 'american_beech_albedo.png',
  normal: 'american_beech_normal.png',
  roughness: 'american_beech_roughness.png',
} as const;

export const FOREST_FLOOR_TWIG_SEED = 0x7a19_3f2d;
export const FOREST_FLOOR_TWIG_MIN_BLEND = 0.22;
export const FOREST_FLOOR_TWIG_MIN_SPACING = 0.72;
export const FOREST_FLOOR_TWIG_GROUND_CLEARANCE = 0.012;
export const FOREST_FLOOR_TWIG_RADIAL_SEGMENTS = 6;
export const FOREST_FLOOR_TWIG_TEXTURE_REPEAT_METERS = 0.19;
export const FOREST_FLOOR_TWIG_HIDDEN_Y = -10_000;
export const FOREST_FLOOR_TWIG_MAX_INSTANCES = 3_600;
export const FOREST_FLOOR_TWIG_TARGETS_PER_TREE = 0.46;
export const FOREST_FLOOR_TWIG_SCALE_RANGE = [0.94, 1.22] as const;
export const FOREST_FLOOR_TWIG_THICKNESS_RANGE = [0.94, 1.18] as const;
/** Maximum authored blocker sample offset from a twig placement center. */
export const FOREST_FLOOR_TWIG_BLOCKER_SAMPLE_REACH =
  1.65 * FOREST_FLOOR_TWIG_SCALE_RANGE[1] * 0.5;

type TwigPoint = readonly [x: number, verticalRadiusUnits: number, lateral: number];

export type ForestFloorTwigVariantSpec = {
  length: number;
  baseRadius: number;
  points: readonly TwigPoint[];
  radiusProfile: readonly number[];
};

/**
 * Authored centerlines keep the species-neutral litter identity stable. The
 * seed only chooses among these restrained broken-branch silhouettes and
 * varies their transforms; it never changes the underlying twig grammar.
 */
export const FOREST_FLOOR_TWIG_VARIANTS = [
  {
    length: 0.9,
    baseRadius: 0.031,
    points: [
      [-0.5, 0.15, 0],
      [-0.31, 0.02, 0.025],
      [-0.11, 0.12, -0.035],
      [0.12, 0.04, -0.012],
      [0.34, 0.16, 0.048],
      [0.5, 0.1, 0.028],
    ],
    radiusProfile: [1, 0.94, 0.84, 0.72, 0.56, 0.36],
  },
  {
    length: 1.25,
    baseRadius: 0.038,
    points: [
      [-0.5, 0.1, 0],
      [-0.34, 0.2, -0.042],
      [-0.13, 0.03, -0.018],
      [0.08, 0.12, 0.052],
      [0.31, 0.02, 0.032],
      [0.5, 0.16, -0.026],
    ],
    radiusProfile: [1, 0.96, 0.86, 0.74, 0.61, 0.42],
  },
  {
    length: 1.65,
    baseRadius: 0.046,
    points: [
      [-0.5, 0.13, 0],
      [-0.3, 0.02, 0.038],
      [-0.08, 0.18, 0.018],
      [0.14, 0.05, -0.058],
      [0.34, 0.14, -0.024],
      [0.5, 0.03, 0.034],
    ],
    radiusProfile: [1, 0.93, 0.82, 0.7, 0.55, 0.34],
  },
] as const satisfies readonly ForestFloorTwigVariantSpec[];

export const FOREST_FLOOR_TWIG_VARIANT_COUNT = FOREST_FLOOR_TWIG_VARIANTS.length;

export type ForestFloorTwigTextures = {
  albedo: THREE.Texture;
  normal: THREE.Texture;
  roughness: THREE.Texture;
  ownership: 'owned' | 'seedthree-shared';
};

export type ForestFloorTwigPlacement = {
  x: number;
  z: number;
  sourceTreeIndex: number;
  variantIndex: number;
  yaw: number;
  scale: number;
  thicknessScale: number;
  length: number;
  tint: readonly [r: number, g: number, b: number];
};

export type ForestFloorTwigPlacementOptions = {
  seed?: number;
  densityScale?: number;
  maxTwigs?: number;
  minimumForestBlend?: number;
  minimumSpacing?: number;
  isBlockedAt?: ForestFloorTwigBlocker;
};

export type ForestFloorTwigCreateOptions = ForestFloorTwigPlacementOptions & {
  sharedSeedThreeTextures?: boolean;
};

export type ForestFloorTwigBlocker = (x: number, z: number) => boolean;

export type ForestFloorTwigPrototypeStats = {
  variantIndex: number;
  instances: number;
  vertices: number;
  triangles: number;
};

export type ForestFloorTwigStats = {
  instances: number;
  drawCalls: number;
  prototypeVertices: number;
  submittedTriangles: number;
  maximumLength: number;
  seed: number;
  prototypes: ForestFloorTwigPrototypeStats[];
};

type ForestFloorTwigSlot = {
  mesh: THREE.InstancedMesh;
  instanceIndex: number;
};

export type ForestFloorTwigInstances = {
  group: THREE.Group;
  meshes: THREE.InstancedMesh[];
  placements: ForestFloorTwigPlacement[];
  placementIndicesByTree: number[][];
  textures: ForestFloorTwigTextures;
  material: THREE.MeshStandardMaterial;
  stats: ForestFloorTwigStats;
  setTreeActive: (treeIndex: number, active: boolean) => boolean;
  setPlacementActive: (placementIndex: number, active: boolean) => boolean;
  refreshBlockedMask: (
    isBlockedAt?: ForestFloorTwigBlocker,
    shouldEvaluate?: (placement: ForestFloorTwigPlacement, placementIndex: number) => boolean,
  ) => number;
  setSnowCoverage: (coverage: number) => boolean;
  setCloseDetailVisible: (visible: boolean) => boolean;
  commit: () => void;
  dispose: () => void;
};

const textureLoader = new THREE.TextureLoader();

export async function loadForestFloorTwigTextures(
  maxAnisotropy = 1,
  sharedSeedThreeTextures = false,
): Promise<ForestFloorTwigTextures> {
  if (sharedSeedThreeTextures) {
    const [{ loadSeedThreeSpeciesAssets }, { GORSKI_KOTAR_SPECIES }] = await Promise.all([
      import('../vegetation/seedthree/seedThreeAssets.ts'),
      import('../vegetation/seedthree/gorskiKotarPresets.ts'),
    ]);
    const preset = GORSKI_KOTAR_SPECIES[FOREST_FLOOR_TWIG_BARK_PRESET_KEY];
    if (!preset) throw new Error('Forest-floor twig beech bark preset is unavailable.');
    const assets = await loadSeedThreeSpeciesAssets(preset, maxAnisotropy);
    if (!assets.barkTexture || !assets.barkNormal || !assets.barkRoughness) {
      throw new Error('Forest-floor twigs require the complete shared beech bark PBR set.');
    }
    return {
      albedo: assets.barkTexture,
      normal: assets.barkNormal,
      roughness: assets.barkRoughness,
      ownership: 'seedthree-shared',
    };
  }

  const sources = await resolveForestFloorTwigBarkUrls();
  const results = await Promise.allSettled([
    loadTwigTexture(sources.albedo, true, maxAnisotropy),
    loadTwigTexture(sources.normal, false, maxAnisotropy),
    loadTwigTexture(sources.roughness, false, maxAnisotropy),
  ]);
  const loaded: THREE.Texture[] = [];
  let failed = false;
  let failureReason: unknown;
  for (const result of results) {
    if (result.status === 'fulfilled') loaded.push(result.value);
    else if (!failed) {
      failed = true;
      failureReason = result.reason;
    }
  }
  if (failed) {
    loaded.forEach((texture) => texture.dispose());
    throw failureReason;
  }
  return {
    albedo: loaded[0]!,
    normal: loaded[1]!,
    roughness: loaded[2]!,
    ownership: 'owned',
  };
}

export function disposeForestFloorTwigTextures(textures: ForestFloorTwigTextures): void {
  if (textures.ownership !== 'owned') return;
  textures.albedo.dispose();
  textures.normal.dispose();
  textures.roughness.dispose();
}

export function createForestFloorTwigMaterial(
  textures: ForestFloorTwigTextures,
): THREE.MeshStandardMaterial {
  const material = new MeshStandardNodeMaterial() as unknown as THREE.MeshStandardMaterial;
  material.name = 'Pale shared-beech forest-floor twigs';
  material.map = textures.albedo;
  material.normalMap = textures.normal;
  material.roughnessMap = textures.roughness;
  material.vertexColors = true;
  material.color.setHex(0xffffff);
  material.roughness = 1;
  material.metalness = 0;
  material.normalScale.set(0.48, 0.48);
  material.userData.barkPreset = FOREST_FLOOR_TWIG_BARK_PRESET_KEY;
  material.userData.textureOwnership = textures.ownership;
  return material;
}

/**
 * Emits a bent, tapered tube along an authored centerline. Every ring owns an
 * explicit duplicated UV seam; the two end caps own separate vertices so
 * their broken-end normals do not average into the bark skin.
 */
export function createForestFloorTwigGeometry(
  variantIndex: number,
  radialSegments = FOREST_FLOOR_TWIG_RADIAL_SEGMENTS,
): THREE.BufferGeometry {
  const variant = FOREST_FLOOR_TWIG_VARIANTS[variantIndex];
  if (!variant) throw new Error(`Unknown forest-floor twig variant ${variantIndex}.`);
  if (!Number.isInteger(radialSegments) || radialSegments < 3) {
    throw new Error('Forest-floor twig radialSegments must be an integer of at least 3.');
  }

  const centers = variant.points.map(([x, y, z]) => new THREE.Vector3(
    x * variant.length,
    y * variant.baseRadius,
    z * variant.length,
  ));
  const longitudinalDistances = centers.map(() => 0);
  for (let index = 1; index < centers.length; index++) {
    longitudinalDistances[index] = longitudinalDistances[index - 1]!
      + centers[index]!.distanceTo(centers[index - 1]!);
  }

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const ringStride = radialSegments + 1;
  const tangent = new THREE.Vector3();
  const radialUp = new THREE.Vector3();
  const radialSide = new THREE.Vector3();

  for (let ringIndex = 0; ringIndex < centers.length; ringIndex++) {
    const center = centers[ringIndex]!;
    if (ringIndex === 0) tangent.subVectors(centers[1]!, center);
    else if (ringIndex === centers.length - 1) {
      tangent.subVectors(center, centers[ringIndex - 1]!);
    } else {
      tangent.subVectors(centers[ringIndex + 1]!, centers[ringIndex - 1]!);
    }
    tangent.normalize();
    radialSide.crossVectors(WORLD_UP, tangent).normalize();
    radialUp.crossVectors(tangent, radialSide).normalize();
    const radius = variant.baseRadius * variant.radiusProfile[ringIndex]!;

    for (let radialIndex = 0; radialIndex <= radialSegments; radialIndex++) {
      const radialT = radialIndex / radialSegments;
      const angle = radialT * TAU;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      positions.push(
        center.x + radialUp.x * cos * radius + radialSide.x * sin * radius,
        center.y + radialUp.y * cos * radius + radialSide.y * sin * radius,
        center.z + radialUp.z * cos * radius + radialSide.z * sin * radius,
      );
      uvs.push(
        radialT,
        longitudinalDistances[ringIndex]! / FOREST_FLOOR_TWIG_TEXTURE_REPEAT_METERS,
      );
    }
  }

  for (let ringIndex = 0; ringIndex < centers.length - 1; ringIndex++) {
    const ringStart = ringIndex * ringStride;
    const nextRingStart = ringStart + ringStride;
    for (let radialIndex = 0; radialIndex < radialSegments; radialIndex++) {
      const a = ringStart + radialIndex;
      const b = nextRingStart + radialIndex;
      const c = a + 1;
      const d = b + 1;
      indices.push(a, b, c, b, d, c);
    }
  }

  appendTwigCap(
    positions,
    uvs,
    indices,
    centers[0]!,
    positions,
    0,
    radialSegments,
    true,
  );
  appendTwigCap(
    positions,
    uvs,
    indices,
    centers[centers.length - 1]!,
    positions,
    (centers.length - 1) * ringStride,
    radialSegments,
    false,
  );

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.name = `Bent tapered forest-floor twig variant ${variantIndex + 1}`;
  geometry.userData.seedThreeGenerator = 'forest-floor-bent-tapered-tube';
  geometry.userData.variantIndex = variantIndex;
  geometry.userData.ringCount = centers.length;
  geometry.userData.radialSegments = radialSegments;
  geometry.userData.textureRepeatMeters = FOREST_FLOOR_TWIG_TEXTURE_REPEAT_METERS;
  geometry.userData.triangleCount = indices.length / 3;
  return geometry;
}

export function createForestFloorTwigPlacements(
  trees: readonly ForestTreePlacement[],
  terrain: Terrain,
  options: ForestFloorTwigPlacementOptions = {},
): ForestFloorTwigPlacement[] {
  const seed = options.seed ?? FOREST_FLOOR_TWIG_SEED;
  const densityScale = Math.max(0, options.densityScale ?? 1);
  if (densityScale === 0 || trees.length === 0) return [];
  const minimumForestBlend = THREE.MathUtils.clamp(
    options.minimumForestBlend ?? FOREST_FLOOR_TWIG_MIN_BLEND,
    0,
    1,
  );
  const minimumSpacing = Math.max(
    0.05,
    options.minimumSpacing ?? FOREST_FLOOR_TWIG_MIN_SPACING,
  );
  const defaultMaximum = Math.min(
    FOREST_FLOOR_TWIG_MAX_INSTANCES,
    Math.max(1, Math.round(trees.length * FOREST_FLOOR_TWIG_TARGETS_PER_TREE * densityScale)),
  );
  const maxTwigs = Math.max(0, Math.floor(options.maxTwigs ?? defaultMaximum));
  const placementIndex = new SpatialHash2D<ForestFloorTwigPlacement>(minimumSpacing);
  const placements: ForestFloorTwigPlacement[] = [];
  const tintColor = new THREE.Color();

  for (let treeIndex = 0; treeIndex < trees.length && placements.length < maxTwigs; treeIndex++) {
    const tree = trees[treeIndex]!;
    const rng = mulberry32((seed ^ Math.imul(treeIndex + 1, 0x85eb_ca6b)) >>> 0);
    const forestBlend = sampleForestBlend(terrain, tree.x, tree.z);
    if (forestBlend < minimumForestBlend) continue;
    const primaryChance = THREE.MathUtils.clamp(
      THREE.MathUtils.lerp(0.18, 0.56, forestBlend) * densityScale,
      0,
      0.94,
    );
    const secondaryChance = THREE.MathUtils.clamp(
      THREE.MathUtils.lerp(0.015, 0.16, forestBlend) * densityScale,
      0,
      0.32,
    );
    const candidateCount = (rng() < primaryChance ? 1 : 0)
      + (forestBlend > 0.68 && rng() < secondaryChance ? 1 : 0);

    for (
      let candidateIndex = 0;
      candidateIndex < candidateCount && placements.length < maxTwigs;
      candidateIndex++
    ) {
      const yaw = rng() * TAU;
      const radialAngle = rng() * TAU;
      const radialDistance = THREE.MathUtils.lerp(
        0.64,
        twigCanopyRadius(tree) * 0.84 + 1.1,
        Math.sqrt(rng()),
      );
      const x = tree.x + Math.cos(radialAngle) * radialDistance;
      const z = tree.z + Math.sin(radialAngle) * radialDistance;
      if (placementIndex.hasPointWithin(x, z, minimumSpacing)) continue;
      if (sampleForestBlend(terrain, x, z) < minimumForestBlend * 0.72) continue;

      const variantIndex = Math.min(
        FOREST_FLOOR_TWIG_VARIANT_COUNT - 1,
        Math.floor(rng() * FOREST_FLOOR_TWIG_VARIANT_COUNT),
      );
      const scale = THREE.MathUtils.lerp(...FOREST_FLOOR_TWIG_SCALE_RANGE, rng());
      const thicknessScale = THREE.MathUtils.lerp(...FOREST_FLOOR_TWIG_THICKNESS_RANGE, rng());
      const length = FOREST_FLOOR_TWIG_VARIANTS[variantIndex]!.length * scale;
      if (twigIntersectsBlocker(x, z, yaw, length, options.isBlockedAt)) continue;

      tintColor.setHSL(
        0.075 + (rng() - 0.5) * 0.025,
        0.025 + rng() * 0.05,
        0.94 + (rng() - 0.5) * 0.08,
      );
      const placement: ForestFloorTwigPlacement = {
        x,
        z,
        sourceTreeIndex: treeIndex,
        variantIndex,
        yaw,
        scale,
        thicknessScale,
        length,
        tint: [tintColor.r, tintColor.g, tintColor.b],
      };
      placements.push(placement);
      placementIndex.add(placement);
    }
  }

  return placements;
}

export function composeForestFloorTwigMatrix(
  placement: ForestFloorTwigPlacement,
  terrain: Pick<Terrain, 'getHeightAt'>,
  target = new THREE.Matrix4(),
): THREE.Matrix4 {
  const halfLength = placement.length * 0.5;
  const directionX = Math.cos(placement.yaw);
  const directionZ = Math.sin(placement.yaw);
  const startY = terrain.getHeightAt(
    placement.x - directionX * halfLength,
    placement.z - directionZ * halfLength,
  );
  const endY = terrain.getHeightAt(
    placement.x + directionX * halfLength,
    placement.z + directionZ * halfLength,
  );
  const slopeDirection = new THREE.Vector3(
    directionX,
    (endY - startY) / Math.max(placement.length, 0.001),
    directionZ,
  ).normalize();
  const orientation = new THREE.Quaternion().setFromUnitVectors(
    LOCAL_TWIG_AXIS,
    slopeDirection,
  );
  const variant = FOREST_FLOOR_TWIG_VARIANTS[placement.variantIndex]!;
  const lift = FOREST_FLOOR_TWIG_GROUND_CLEARANCE
    + variant.baseRadius * placement.scale * placement.thicknessScale;
  const position = new THREE.Vector3(
    placement.x,
    terrain.getHeightAt(placement.x, placement.z) + lift,
    placement.z,
  );
  const scale = new THREE.Vector3(
    placement.scale,
    placement.scale * placement.thicknessScale,
    placement.scale * placement.thicknessScale,
  );
  return target.compose(position, orientation, scale);
}

export async function createForestFloorTwigInstances(
  trees: readonly ForestTreePlacement[],
  terrain: Terrain,
  maxAnisotropy: number,
  options: ForestFloorTwigCreateOptions = {},
): Promise<ForestFloorTwigInstances> {
  const [textures, placements] = await Promise.all([
    loadForestFloorTwigTextures(maxAnisotropy, options.sharedSeedThreeTextures),
    Promise.resolve(createForestFloorTwigPlacements(trees, terrain, options)),
  ]);
  const material = createForestFloorTwigMaterial(textures);
  const group = new THREE.Group();
  group.name = 'Close-detail textured forest-floor twigs';
  const meshes: THREE.InstancedMesh[] = [];
  const slots: ForestFloorTwigSlot[] = Array.from({ length: placements.length });
  const authoredMatrices = placements.map(() => new THREE.Matrix4());
  const dirtyInstances = new Map<THREE.InstancedMesh, Set<number>>();
  const placementVisible = placements.map(() => true);
  let snowCoverage = 0;
  const hiddenMatrix = new THREE.Matrix4().makeTranslation(0, FOREST_FLOOR_TWIG_HIDDEN_Y, 0);
  const prototypeStats: ForestFloorTwigPrototypeStats[] = [];

  for (let variantIndex = 0; variantIndex < FOREST_FLOOR_TWIG_VARIANT_COUNT; variantIndex++) {
    const variantPlacements = placements
      .map((placement, placementIndex) => ({ placement, placementIndex }))
      .filter(({ placement }) => placement.variantIndex === variantIndex);
    if (variantPlacements.length === 0) continue;

    const geometry = createForestFloorTwigGeometry(variantIndex);
    const mesh = new THREE.InstancedMesh(geometry, material, variantPlacements.length);
    mesh.name = `Textured forest-floor twig variant ${variantIndex + 1}`;
    mesh.count = variantPlacements.length;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.renderOrder = 2;
    // One forest-wide batch has a deliberately broad world bound. The parent
    // close-detail group is the useful culling unit and is toggled with ivy.
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const color = new THREE.Color();
    variantPlacements.forEach(({ placement, placementIndex }, instanceIndex) => {
      const matrix = composeForestFloorTwigMatrix(placement, terrain);
      mesh.setMatrixAt(instanceIndex, matrix);
      color.setRGB(...placement.tint);
      mesh.setColorAt(instanceIndex, color);
      authoredMatrices[placementIndex]!.copy(matrix);
      slots[placementIndex] = { mesh, instanceIndex };
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.setUsage(THREE.StaticDrawUsage);
      mesh.instanceColor.needsUpdate = true;
    }
    group.add(mesh);
    meshes.push(mesh);
    dirtyInstances.set(mesh, new Set());
    prototypeStats.push({
      variantIndex,
      instances: variantPlacements.length,
      vertices: geometry.getAttribute('position').count,
      triangles: (geometry.getIndex()?.count ?? 0) / 3,
    });
  }

  const placementMask = createForestFloorPlacementMask(
    placements,
    trees.length,
    (placementIndex, visible) => {
      const slot = slots[placementIndex];
      if (!slot) return;
      placementVisible[placementIndex] = visible;
      slot.mesh.setMatrixAt(
        slot.instanceIndex,
        visible && isTwigRetainedAboveSnow(placementIndex, snowCoverage)
          ? authoredMatrices[placementIndex]!
          : hiddenMatrix,
      );
      dirtyInstances.get(slot.mesh)?.add(slot.instanceIndex);
    },
  );

  return {
    group,
    meshes,
    placements,
    placementIndicesByTree: placementMask.placementIndicesByTree,
    textures,
    material,
    stats: {
      instances: placements.length,
      drawCalls: meshes.length,
      prototypeVertices: prototypeStats.reduce((sum, stats) => sum + stats.vertices, 0),
      submittedTriangles: prototypeStats.reduce(
        (sum, stats) => sum + stats.triangles * stats.instances,
        0,
      ),
      maximumLength: placements.reduce(
        (maximum, placement) => Math.max(maximum, placement.length),
        0,
      ),
      seed: options.seed ?? FOREST_FLOOR_TWIG_SEED,
      prototypes: prototypeStats,
    },
    setTreeActive: placementMask.setTreeActive,
    setPlacementActive: placementMask.setPlacementActive,
    refreshBlockedMask(
      isBlockedAt?: ForestFloorTwigBlocker,
      shouldEvaluate?: (placement: ForestFloorTwigPlacement, placementIndex: number) => boolean,
    ): number {
      return placementMask.refreshBlockedMask(
        (placement) => twigIntersectsBlocker(
          placement.x,
          placement.z,
          placement.yaw,
          placement.length,
          isBlockedAt,
        ),
        shouldEvaluate,
      );
    },
    setSnowCoverage(coverage: number): boolean {
      const next = THREE.MathUtils.clamp(
        Number.isFinite(coverage) ? coverage : 0,
        0,
        1,
      );
      if (Math.abs(next - snowCoverage) <= 1e-6) return false;
      snowCoverage = next;
      for (let placementIndex = 0; placementIndex < placements.length; placementIndex++) {
        const slot = slots[placementIndex];
        if (!slot) continue;
        const visible = placementVisible[placementIndex]
          && isTwigRetainedAboveSnow(placementIndex, snowCoverage);
        slot.mesh.setMatrixAt(
          slot.instanceIndex,
          visible ? authoredMatrices[placementIndex]! : hiddenMatrix,
        );
        dirtyInstances.get(slot.mesh)?.add(slot.instanceIndex);
      }
      return true;
    },
    setCloseDetailVisible(visible: boolean): boolean {
      if (group.visible === visible) return false;
      group.visible = visible;
      return true;
    },
    commit(): void {
      for (const [mesh, dirty] of dirtyInstances) {
        if (dirty.size === 0) continue;
        const instanceIndices = [...dirty].sort((a, b) => a - b);
        mesh.instanceMatrix.clearUpdateRanges();
        let rangeStart = instanceIndices[0]!;
        let rangeEnd = rangeStart;
        for (let index = 1; index < instanceIndices.length; index++) {
          const instanceIndex = instanceIndices[index]!;
          if (instanceIndex === rangeEnd + 1) {
            rangeEnd = instanceIndex;
            continue;
          }
          mesh.instanceMatrix.addUpdateRange(rangeStart * 16, (rangeEnd - rangeStart + 1) * 16);
          rangeStart = instanceIndex;
          rangeEnd = instanceIndex;
        }
        mesh.instanceMatrix.addUpdateRange(rangeStart * 16, (rangeEnd - rangeStart + 1) * 16);
        mesh.instanceMatrix.needsUpdate = true;
        dirty.clear();
      }
    },
    dispose(): void {
      for (const mesh of meshes) mesh.geometry.dispose();
      material.dispose();
      disposeForestFloorTwigTextures(textures);
      group.removeFromParent();
      group.clear();
    },
  };
}

function appendTwigCap(
  targetPositions: number[],
  targetUvs: number[],
  targetIndices: number[],
  center: THREE.Vector3,
  sidePositions: readonly number[],
  sourceRingStart: number,
  radialSegments: number,
  startCap: boolean,
): void {
  const centerIndex = targetPositions.length / 3;
  targetPositions.push(center.x, center.y, center.z);
  targetUvs.push(0.5, 0.5);
  const capRingStart = centerIndex + 1;
  for (let radialIndex = 0; radialIndex <= radialSegments; radialIndex++) {
    const sourceVertex = sourceRingStart + radialIndex;
    const sourceOffset = sourceVertex * 3;
    const x = sidePositions[sourceOffset]!;
    const y = sidePositions[sourceOffset + 1]!;
    const z = sidePositions[sourceOffset + 2]!;
    targetPositions.push(x, y, z);
    const radialT = radialIndex / radialSegments;
    const angle = radialT * TAU;
    targetUvs.push(0.5 + Math.cos(angle) * 0.48, 0.5 + Math.sin(angle) * 0.48);
  }
  for (let radialIndex = 0; radialIndex < radialSegments; radialIndex++) {
    const current = capRingStart + radialIndex;
    const next = current + 1;
    if (startCap) targetIndices.push(centerIndex, current, next);
    else targetIndices.push(centerIndex, next, current);
  }
}

async function loadTwigTexture(
  url: string,
  srgb: boolean,
  maxAnisotropy: number,
): Promise<THREE.Texture> {
  const texture = await textureLoader.loadAsync(url);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.anisotropy = Math.max(1, Math.min(16, maxAnisotropy));
  return texture;
}

async function resolveForestFloorTwigBarkUrls(): Promise<{
  albedo: string;
  normal: string;
  roughness: string;
}> {
  const { seedThreeBarkUrl } = await import(
    '../vegetation/seedthree/seedThreeTextures.ts'
  );
  const albedo = seedThreeBarkUrl(FOREST_FLOOR_TWIG_BARK_FILES.albedo);
  const normal = seedThreeBarkUrl(FOREST_FLOOR_TWIG_BARK_FILES.normal);
  const roughness = seedThreeBarkUrl(FOREST_FLOOR_TWIG_BARK_FILES.roughness);
  if (!albedo || !normal || !roughness) {
    throw new Error('Forest-floor twig beech bark URLs are unavailable.');
  }
  return { albedo, normal, roughness };
}

function twigIntersectsBlocker(
  x: number,
  z: number,
  yaw: number,
  length: number,
  isBlockedAt?: ForestFloorTwigBlocker,
): boolean {
  if (!isBlockedAt) return false;
  if (isBlockedAt(x, z)) return true;
  const halfLength = length * 0.5;
  const dx = Math.cos(yaw) * halfLength;
  const dz = Math.sin(yaw) * halfLength;
  return isBlockedAt(x - dx, z - dz) || isBlockedAt(x + dx, z + dz);
}

/**
 * Settled snow buries litter instead of bleaching every bark cylinder white.
 * A stable placement hash leaves a few raised twigs legible at full cover and
 * avoids reshuffling the visible cohort as the calendar advances.
 */
function isTwigRetainedAboveSnow(
  placementIndex: number,
  snowCoverage: number,
): boolean {
  const burial = THREE.MathUtils.smoothstep(snowCoverage, 0.12, 0.94);
  const retention = THREE.MathUtils.lerp(1, 0.08, burial);
  const hash = Math.imul((placementIndex + 1) >>> 0, 0x85eb_ca6b) >>> 0;
  return hash / 0x1_0000_0000 < retention;
}

function sampleForestBlend(terrain: Terrain, x: number, z: number): number {
  return THREE.MathUtils.clamp(
    sampleTerrainMeshAttributeX(
      terrain.mesh.geometry,
      'forestBlend',
      x,
      z,
      terrain.resolution,
      terrain.size,
    ),
    0,
    1,
  );
}

function twigCanopyRadius(tree: ForestTreePlacement): number {
  if (tree.form === 'broad') return 4.1 * tree.scale;
  if (tree.form === 'young' || tree.form === 'midstory') return 2.3 * tree.scale;
  return 3.3 * tree.scale;
}
