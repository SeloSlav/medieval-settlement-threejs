import * as THREE from 'three';
import type { BuildingTerrainSource } from '../buildings/BuildingTerrainLayout.ts';
import { pointWithinBuildingSiteClearance } from '../buildings/BuildingTerrainLayout.ts';
import { TREE_SHADOW_CAST_LAYER } from '../scene/SceneLayers.ts';
import { createRockShadowGeometry } from '../props/ForestProps.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import { collectRoadRemovedRockIndices } from '../roads/roadRockClearance.ts';
import type { Terrain } from '../terrain/Terrain.ts';
import type { Point2 } from '../utils/polygonGeometry.ts';
import { SpatialHash2D } from '../utils/SpatialHash2D.ts';
import { distancePointToPolygon2 } from '../utils/polygonGeometry.ts';
import {
  setRockObstacleCollisionBounds,
  type RockObstacle,
} from '../utils/pathGeometry.ts';
import type { RiverField } from './RiverField.ts';
import {
  computeShoreStoneTint,
  computeShoreStoneVisualScale,
  computeShoreStoneVisualVariation,
} from './riverShoreStoneAppearance.ts';
import { PlacementClearanceSpatialIndex } from '../placement/PlacementClearanceSpatialIndex.ts';
import { unwrapTriangleUvSeams } from '../utils/boulderUv.ts';

type RockShadowMaterials = {
  shadowCast: THREE.MeshStandardMaterial;
  shadowDepth: THREE.MeshDepthMaterial;
};

type StonePlacement = {
  x: number;
  z: number;
  scale: number;
};

type ShoreStoneInstance = {
  placement: StonePlacement;
  mesh: THREE.InstancedMesh;
  shadowMesh: THREE.InstancedMesh;
  instanceIndex: number;
  visualMatrix: THREE.Matrix4;
};

export type RiverShoreStoneField = {
  group: THREE.Group;
  readonly placements: ReadonlyArray<RockObstacle>;
  syncPlacementClearance: (
    buildings: Iterable<BuildingTerrainSource>,
    farmFieldPolygons: Iterable<Point2[]>,
  ) => void;
  syncRoadClearance: (network: RoadNetwork | null) => void;
};

const TAU = Math.PI * 2;

export function createRiverShoreStones(
  terrain: Terrain,
  riverField: RiverField,
  material: THREE.Material,
  shadowMaterials: RockShadowMaterials,
  rng: () => number,
): RiverShoreStoneField {
  const group = new THREE.Group();
  group.name = 'River shore stones';
  const placements = createShoreStonePlacements(riverField, rng);
  if (placements.length === 0) {
    return {
      group,
      placements,
      syncPlacementClearance: () => {},
      syncRoadClearance: () => {},
    };
  }

  const variants = [createBoulderGeometry(1.3), createBoulderGeometry(7.7), createBoulderGeometry(13.2)];
  const shadowGeometry = createRockShadowGeometry();
  const buckets = variants.map(() => [] as StonePlacement[]);
  const instances: ShoreStoneInstance[] = [];
  placements.forEach((placement, index) => buckets[index % buckets.length].push(placement));

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const visualQuaternion = new THREE.Quaternion();
  const yawQuaternion = new THREE.Quaternion();
  const upAxis = new THREE.Vector3(0, 1, 0);
  const scaleVector = new THREE.Vector3();
  const visualPosition = new THREE.Vector3();
  const visualScaleVector = new THREE.Vector3();
  const stoneTint = new THREE.Color();

  buckets.forEach((bucket, variantIndex) => {
    if (bucket.length === 0) return;
    const mesh = new THREE.InstancedMesh(variants[variantIndex], material, bucket.length);
    mesh.name = `River shore boulders ${variantIndex + 1}`;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    const shadowMesh = new THREE.InstancedMesh(shadowGeometry, shadowMaterials.shadowCast, bucket.length);
    shadowMesh.name = `River shore boulder shadows ${variantIndex + 1}`;
    shadowMesh.layers.set(TREE_SHADOW_CAST_LAYER);
    // Hundreds of sub-pixel rock shadows merged into a dark dotted contour at
    // overview zoom. The stones retain their material shading and still
    // receive the world shadow atlas without this redundant shadow pass.
    shadowMesh.castShadow = false;
    shadowMesh.visible = false;
    shadowMesh.receiveShadow = false;
    shadowMesh.customDepthMaterial = shadowMaterials.shadowDepth;
    bucket.forEach((rock, rockIndex) => {
      const y = terrain.getHeightAt(rock.x, rock.z);
      position.set(rock.x, y + rock.scale * 0.14, rock.z);
      quaternion.setFromEuler(new THREE.Euler((rng() - 0.5) * 0.22, rng() * TAU, (rng() - 0.5) * 0.22));
      scaleVector.set(
        rock.scale * (0.92 + rng() * 0.55),
        rock.scale * (0.38 + rng() * 0.24),
        rock.scale * (0.82 + rng() * 0.48),
      );
      matrix.compose(position, quaternion, scaleVector);
      // Preserve the original collision bounds exactly; the following
      // world-position-driven scale/tint is presentation-only.
      setRockObstacleCollisionBounds(rock, variants[variantIndex], matrix);
      const visualScale = computeShoreStoneVisualScale(rock.x, rock.z);
      const variation = computeShoreStoneVisualVariation(rock.x, rock.z);
      visualPosition.copy(position);
      visualPosition.x += variation.offsetX;
      visualPosition.y -= rock.scale * variation.sink;
      visualPosition.z += variation.offsetZ;
      yawQuaternion.setFromAxisAngle(upAxis, variation.yaw);
      visualQuaternion.copy(quaternion).multiply(yawQuaternion);
      visualScaleVector.set(
        scaleVector.x * visualScale * variation.aspect,
        scaleVector.y * visualScale * variation.height,
        scaleVector.z * visualScale / variation.aspect,
      );
      const visualMatrix = new THREE.Matrix4().compose(
        visualPosition,
        visualQuaternion,
        visualScaleVector,
      );
      mesh.setMatrixAt(rockIndex, visualMatrix);
      shadowMesh.setMatrixAt(rockIndex, visualMatrix);
      const tint = computeShoreStoneTint(rock.x, rock.z);
      stoneTint.setRGB(
        tint,
        tint * 0.99,
        tint * 0.96,
      );
      mesh.setColorAt(rockIndex, stoneTint);
      instances.push({
        placement: rock,
        mesh,
        shadowMesh,
        instanceIndex: rockIndex,
        visualMatrix,
      });
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    shadowMesh.instanceMatrix.needsUpdate = true;
    group.add(mesh, shadowMesh);
  });

  const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  let roadRemoved = new Set<number>();
  let placementRemoved = new Set<number>();
  let removed = new Set<number>();
  const allRockPlacements = instances.map((instance) => instance.placement);
  let activePlacements: ReadonlyArray<RockObstacle> = [...allRockPlacements];

  const applyClearance = (nextRemoved: Set<number>): void => {
    if (indexSetsEqual(nextRemoved, removed)) return;

    for (let index = 0; index < instances.length; index++) {
      if (nextRemoved.has(index) === removed.has(index)) continue;
      const instance = instances[index];
      const instanceMatrix = nextRemoved.has(index) ? hiddenMatrix : instance.visualMatrix;
      instance.mesh.setMatrixAt(instance.instanceIndex, instanceMatrix);
      instance.shadowMesh.setMatrixAt(instance.instanceIndex, instanceMatrix);
      instance.mesh.instanceMatrix.needsUpdate = true;
      instance.shadowMesh.instanceMatrix.needsUpdate = true;
    }

    removed = nextRemoved;
    activePlacements = instances
      .filter((_, index) => !nextRemoved.has(index))
      .map((instance) => instance.placement);
  };

  return {
    group,
    get placements() {
      return activePlacements;
    },
    syncPlacementClearance(buildings, farmFieldPolygons) {
      const buildingList = [...buildings];
      const farmFields = [...farmFieldPolygons];
      const clearanceIndex = new PlacementClearanceSpatialIndex(buildingList, [], farmFields);
      const nextPlacementRemoved = new Set<number>();

      for (let index = 0; index < instances.length; index++) {
        const placement = instances[index].placement;
        const clearRadius = placement.scale * 1.35 + 0.35;
        const overlapsBuilding = clearanceIndex.someBuildingNear(
          placement.x,
          placement.z,
          clearRadius,
          (building) =>
            pointWithinBuildingSiteClearance(
              placement.x,
              placement.z,
              building,
              clearRadius,
            ),
        );
        const overlapsFarmField = clearanceIndex.someFarmFieldNear(
          placement.x,
          placement.z,
          clearRadius,
          (polygon) => distancePointToPolygon2(placement, polygon) <= clearRadius,
        );
        if (overlapsBuilding || overlapsFarmField) nextPlacementRemoved.add(index);
      }

      placementRemoved = nextPlacementRemoved;
      applyClearance(indexSetUnion(roadRemoved, placementRemoved));
    },
    syncRoadClearance(network) {
      roadRemoved = collectRoadRemovedRockIndices(allRockPlacements, network);
      applyClearance(indexSetUnion(roadRemoved, placementRemoved));
    },
  };
}

function indexSetsEqual(left: ReadonlySet<number>, right: ReadonlySet<number>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function indexSetUnion(left: ReadonlySet<number>, right: ReadonlySet<number>): Set<number> {
  if (left.size === 0) return new Set(right);
  if (right.size === 0) return new Set(left);
  const union = new Set(left);
  for (const index of right) union.add(index);
  return union;
}

function createShoreStonePlacements(riverField: RiverField, rng: () => number): StonePlacement[] {
  const placements: StonePlacement[] = [];
  const placementIndex = new SpatialHash2D<StonePlacement>(3);
  const { resolution, startX, startZ, stepX, stepZ } = riverField;

  for (let gridZ = 0; gridZ < resolution; gridZ++) {
    for (let gridX = 0; gridX < resolution; gridX++) {
      const i = gridZ * resolution + gridX;
      const mask = riverField.riverMask[i];
      if (mask >= 0.48) continue;

      const shore = riverField.shoreDistance[i];
      if (shore < 0.55 || shore > 5.4) continue;

      const wx = startX + gridX * stepX;
      const wz = startZ + gridZ * stepZ;
      const jitterX = (rng() - 0.5) * stepX * 0.72;
      const jitterZ = (rng() - 0.5) * stepZ * 0.72;
      const x = wx + jitterX;
      const z = wz + jitterZ;
      if (riverField.isWaterAt(x, z)) continue;

      const scale = THREE.MathUtils.lerp(0.42, 1.35, Math.pow(rng(), 1.55));
      // Populate every eligible bank segment. Spatial separation still avoids
      // overlap, but there are no stochastic or pre-cut crossing holes.
      if (placementIndex.hasPointWithin(x, z, 0.72 + scale * 0.38)) continue;
      const placement = { x, z, scale };
      placements.push(placement);
      placementIndex.add(placement);
    }
  }

  return placements;
}

function createBoulderGeometry(seed: number): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(1, 2);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const uvs: number[] = [];
  const point = new THREE.Vector3();

  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i).normalize();
    const ridge =
      0.82 + stableSurfaceNoise(point, seed) * 0.28 + Math.sin(point.x * 7.1 + point.z * 3.3 + seed) * 0.06;
    point.multiplyScalar(ridge);
    point.y *= 0.5 + stableSurfaceNoise(point, seed + 4.1) * 0.16;
    if (point.y < -0.24) point.y = THREE.MathUtils.lerp(point.y, -0.28, 0.58);
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
