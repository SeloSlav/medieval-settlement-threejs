import * as THREE from 'three';
import {
  disposeRockTextureSet,
  type RockTextureSet,
} from '../utils/propTextureLoad.ts';
import type { Terrain } from '../terrain/Terrain.ts';
import { createRockShadowGeometry } from '../props/ForestProps.ts';
import { TREE_SHADOW_CAST_LAYER } from '../scene/SceneLayers.ts';
import type { ResourceNodeState } from '../resources/types.ts';
import { surfaceRockCountForRemaining } from './quarryDepletion.ts';
import type { QuarryLayout, QuarrySite } from './QuarryLayout.ts';
import {
  setRockObstacleCollisionBounds,
  type RockObstacle,
} from '../utils/pathGeometry.ts';
import { SpatialHash2D } from '../utils/SpatialHash2D.ts';
import { unwrapTriangleUvSeams } from '../utils/boulderUv.ts';
import { disposeObject3D } from '../utils/dispose.ts';

const TAU = Math.PI * 2;

type QuarryRockPlacement = RockObstacle & {
  quarryId: string;
};

type QuarryRockBucket = {
  placements: QuarryRockPlacement[];
  rocks: THREE.InstancedMesh;
  shadows: THREE.InstancedMesh;
};

type QuarrySiteVisual = {
  quarryId: string;
  buckets: QuarryRockBucket[];
};

export type QuarrySystem = {
  layout: QuarryLayout;
  group: THREE.Group;
  /** Mutable-in-place so collision consumers retain one stable array reference. */
  rockPlacements: ReadonlyArray<RockObstacle>;
  finishDetails: () => Promise<void>;
  syncNodes: (nodes: Iterable<ResourceNodeState>) => boolean;
  isBlockedAt: (x: number, z: number) => boolean;
  isGrassBlockedAt: (x: number, z: number) => boolean;
  dispose: () => void;
};

export function createQuarrySystem(
  terrain: Terrain,
  layout: QuarryLayout,
  rockTextures: RockTextureSet<'quarry'>,
): QuarrySystem {
  const group = new THREE.Group();
  group.name = 'Stone deposits';

  const rockMaterial = createQuarryRockMaterial(rockTextures);
  const shadowMaterials = createPropShadowMaterials();
  const activePlacements: RockObstacle[] = [];
  const sites: QuarrySiteVisual[] = [];
  let latestNodes: ResourceNodeState[] = [];
  let detailsPromise: Promise<void> | null = null;
  let detailsReady = false;
  let disposed = false;

  const applyNodeState = (): boolean => {
    const byId = new Map(latestNodes.map((node) => [node.nodeId, node]));
    const nextActive: RockObstacle[] = [];
    let changed = false;

    for (const site of sites) {
      const node = byId.get(site.quarryId);
      for (const bucket of site.buckets) {
        const visibleCount = node
          ? surfaceRockCountForRemaining(
              bucket.placements.length,
              node.remaining,
              node.maxYield,
            )
          : bucket.placements.length;
        if (bucket.rocks.count !== visibleCount || bucket.shadows.count !== visibleCount) {
          bucket.rocks.count = visibleCount;
          bucket.shadows.count = visibleCount;
          changed = true;
        }
        nextActive.push(...bucket.placements.slice(0, visibleCount));
      }
    }

    if (changed || activePlacements.length !== nextActive.length) {
      activePlacements.splice(0, activePlacements.length, ...nextActive);
      return true;
    }
    return false;
  };

  const finishDetails = (): Promise<void> => {
    if (disposed) return Promise.resolve();
    if (detailsPromise) return detailsPromise;
    detailsPromise = (async () => {
      const rng = mulberry32(0x71a2e0d ^ 0x5151);
      const placements = createQuarryRockPlacements(layout, rng);
      const result = createQuarryRockMeshes(
        terrain,
        placements,
        rockMaterial,
        shadowMaterials,
        rng,
      );
      if (disposed) {
        disposeObject3D(result.group);
        return;
      }
      group.add(result.group);
      sites.push(...result.sites);
      activePlacements.splice(0, activePlacements.length, ...placements);
      detailsReady = true;
      applyNodeState();
    })();
    return detailsPromise;
  };

  const syncNodes = (nodes: Iterable<ResourceNodeState>): boolean => {
    latestNodes = [...nodes];
    return detailsReady ? applyNodeState() : false;
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    rockMaterial.dispose();
    disposeRockTextureSet(rockTextures);
    shadowMaterials.shadowCast.dispose();
    shadowMaterials.shadowDepth.dispose();
  };

  return {
    layout,
    group,
    rockPlacements: activePlacements,
    finishDetails,
    syncNodes,
    isBlockedAt: (x, z) => layout.isBlockedForProps(x, z),
    isGrassBlockedAt: (x, z) => layout.isBlockedForGrass(x, z),
    dispose,
  };
}

function createQuarryRockPlacements(layout: QuarryLayout, rng: () => number): QuarryRockPlacement[] {
  const placements: QuarryRockPlacement[] = [];
  const placementIndex = new SpatialHash2D<QuarryRockPlacement>(6);
  let largeIndex = 0;
  let smallIndex = 0;
  for (const site of layout.sites) {
    const quarryId = site.kind === 'large'
      ? `quarry-large-${largeIndex++}`
      : `quarry-small-${smallIndex++}`;
    createSiteRockPlacements(site, quarryId, placements, placementIndex, rng);
  }
  return placements;
}

function createSiteRockPlacements(
  site: QuarrySite,
  quarryId: string,
  placements: QuarryRockPlacement[],
  placementIndex: SpatialHash2D<QuarryRockPlacement>,
  rng: () => number,
): void {
  const targetCount =
    site.kind === 'large'
      ? 88 + Math.floor(rng() * 32)
      : 42 + Math.floor(rng() * 18);
  const startCount = placements.length;
  let attempts = 0;

  while (placements.length < startCount + targetCount && attempts < targetCount * 28) {
    attempts++;
    const angle = rng() * TAU;
    const radialT = Math.pow(rng(), site.kind === 'large' ? 0.68 : 0.72);
    const localX = Math.cos(angle) * site.radiusX * radialT * (0.82 + rng() * 0.36);
    const localZ = Math.sin(angle) * site.radiusZ * radialT * (0.82 + rng() * 0.36);
    const cos = Math.cos(site.rotation);
    const sin = Math.sin(site.rotation);
    const x = site.x + localX * cos - localZ * sin;
    const z = site.z + localX * sin + localZ * cos;

    const edgeBias = radialT;
    const rimChance = site.kind === 'large' ? edgeBias > 0.68 : edgeBias > 0.72;
    if (!rimChance && rng() < 0.38) continue;

    const scale =
      site.kind === 'large'
        ? THREE.MathUtils.lerp(0.65, 3.2, Math.pow(rng(), 1.28))
        : THREE.MathUtils.lerp(0.55, 2.6, Math.pow(rng(), 1.35));
    if (placementIndex.hasPointWithin(x, z, 1.8 + scale * 0.95)) continue;

    const placement = { quarryId, x, z, scale };
    placements.push(placement);
    placementIndex.add(placement);
  }
}

function createQuarryRockMeshes(
  terrain: Terrain,
  placements: QuarryRockPlacement[],
  material: THREE.Material,
  shadowMaterials: { shadowCast: THREE.MeshStandardMaterial; shadowDepth: THREE.MeshDepthMaterial },
  rng: () => number,
): { group: THREE.Group; sites: QuarrySiteVisual[] } {
  const group = new THREE.Group();
  group.name = 'Finite surface stone';
  if (placements.length === 0) return { group, sites: [] };

  const variants = [createBoulderGeometry(2.1), createBoulderGeometry(8.4), createBoulderGeometry(15.7)];
  const shadowGeometry = createRockShadowGeometry();
  const sitePlacements = new Map<string, QuarryRockPlacement[]>();
  for (const placement of placements) {
    const bucket = sitePlacements.get(placement.quarryId);
    if (bucket) bucket.push(placement);
    else sitePlacements.set(placement.quarryId, [placement]);
  }

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scaleVector = new THREE.Vector3();
  const sites: QuarrySiteVisual[] = [];

  for (const [quarryId, quarryPlacements] of sitePlacements) {
    const siteGroup = new THREE.Group();
    siteGroup.name = `${quarryId} surface rocks`;
    const variantBuckets = variants.map(() => [] as QuarryRockPlacement[]);
    quarryPlacements.forEach((placement, index) => {
      variantBuckets[index % variantBuckets.length].push(placement);
    });

    const buckets: QuarryRockBucket[] = [];
    variantBuckets.forEach((bucket, variantIndex) => {
      if (bucket.length === 0) return;
      const rocks = new THREE.InstancedMesh(variants[variantIndex], material, bucket.length);
      rocks.name = `${quarryId} boulders ${variantIndex + 1}`;
      rocks.castShadow = false;
      rocks.receiveShadow = true;
      const shadows = new THREE.InstancedMesh(shadowGeometry, shadowMaterials.shadowCast, bucket.length);
      shadows.name = `${quarryId} boulder shadows ${variantIndex + 1}`;
      shadows.layers.set(TREE_SHADOW_CAST_LAYER);
      shadows.castShadow = true;
      shadows.receiveShadow = false;
      shadows.customDepthMaterial = shadowMaterials.shadowDepth;

      bucket.forEach((rock, rockIndex) => {
        const y = terrain.getHeightAt(rock.x, rock.z);
        position.set(rock.x, y + rock.scale * 0.16, rock.z);
        quaternion.setFromEuler(new THREE.Euler((rng() - 0.5) * 0.24, rng() * TAU, (rng() - 0.5) * 0.24));
        scaleVector.set(
          rock.scale * (0.96 + rng() * 0.62),
          rock.scale * (0.42 + rng() * 0.28),
          rock.scale * (0.86 + rng() * 0.52),
        );
        matrix.compose(position, quaternion, scaleVector);
        setRockObstacleCollisionBounds(rock, variants[variantIndex], matrix);
        rocks.setMatrixAt(rockIndex, matrix);
        shadows.setMatrixAt(rockIndex, matrix);
      });

      rocks.instanceMatrix.needsUpdate = true;
      shadows.instanceMatrix.needsUpdate = true;
      siteGroup.add(rocks, shadows);
      buckets.push({ placements: bucket, rocks, shadows });
    });
    group.add(siteGroup);
    sites.push({ quarryId, buckets });
  }

  return { group, sites };
}

function createQuarryRockMaterial(rockTextures: RockTextureSet<'quarry'>): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    map: rockTextures.map,
    normalMap: rockTextures.normalMap,
    roughnessMap: rockTextures.roughnessMap,
    aoMap: rockTextures.aoMap,
    aoMapIntensity: 0.72,
    color: 0xffffff,
    roughness: 1,
    metalness: 0,
  });
  material.normalScale.set(0.64, 0.64);
  return material;
}

function createPropShadowMaterials(): {
  shadowCast: THREE.MeshStandardMaterial;
  shadowDepth: THREE.MeshDepthMaterial;
} {
  return {
    shadowCast: new THREE.MeshStandardMaterial({
      transparent: true,
      opacity: 0,
      colorWrite: false,
      depthWrite: false,
    }),
    shadowDepth: new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
    }),
  };
}

function createBoulderGeometry(seed: number): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(1, 2);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const uvs: number[] = [];
  const point = new THREE.Vector3();

  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i).normalize();
    const ridge =
      0.8 +
      stableSurfaceNoise(point, seed) * 0.32 +
      Math.sin(point.x * 6.8 + point.z * 3.9 + seed) * 0.07;
    point.multiplyScalar(ridge);
    point.y *= 0.48 + stableSurfaceNoise(point, seed + 4.1) * 0.18;
    if (point.y < -0.24) point.y = THREE.MathUtils.lerp(point.y, -0.28, 0.62);
    position.setXYZ(i, point.x, point.y, point.z);
    uvs.push(Math.atan2(point.z, point.x) / TAU + 0.5, point.y * 0.42 + 0.5);
  }

  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  unwrapTriangleUvSeams(geometry);
  geometry.setAttribute('uv1', geometry.getAttribute('uv').clone());
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function stableSurfaceNoise(point: THREE.Vector3, seed: number): number {
  const value = Math.sin(point.x * 127.1 + point.y * 311.7 + point.z * 74.7 + seed * 19.19) * 43758.5453123;
  return value - Math.floor(value);
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
