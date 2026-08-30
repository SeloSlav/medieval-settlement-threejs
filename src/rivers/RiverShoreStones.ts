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
  computeShoreStoneClusterDensity,
  computeShoreStoneMoss,
  computeShoreStoneTalusMoss,
  computeShoreStoneTint,
  computeShoreStoneVisualScale,
  computeShoreStoneVisualVariation,
} from './riverShoreStoneAppearance.ts';
import { PlacementClearanceSpatialIndex } from '../placement/PlacementClearanceSpatialIndex.ts';
import { unwrapTriangleUvSeams } from '../utils/boulderUv.ts';
import {
  createRiverChannelRockPlacements,
  getRiverChannelRockContactRadius,
} from './RiverChannelRocks.ts';
import { getStillWaterSurfaceY } from './RiverWaterLevel.ts';

type RockShadowMaterials = {
  shadowCast: THREE.MeshStandardMaterial;
  shadowDepth: THREE.MeshDepthMaterial;
};

type StonePlacement = RockObstacle & {
  kind: 'bank' | 'channel';
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
  const bankPlacements = createShoreStonePlacements(riverField, rng);
  const channelPlacements: StonePlacement[] = createRiverChannelRockPlacements(riverField)
    .map((placement) => ({
      x: placement.x,
      z: placement.z,
      scale: placement.scale,
      kind: 'channel',
    }));
  const placements = [...bankPlacements, ...channelPlacements];
  if (placements.length === 0) {
    return {
      group,
      placements,
      syncPlacementClearance: () => {},
      syncRoadClearance: () => {},
    };
  }

  const variants = [createBoulderGeometry(1.3), createBoulderGeometry(7.7), createBoulderGeometry(13.2)];
  const variantPlanarRadii = variants.map(getGeometryMaxPlanarRadius);
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
      const geometry = variants[variantIndex];
      const bounds = geometry.boundingBox!;
      const localHeight = Math.max(0.1, bounds.max.y - bounds.min.y);
      if (rock.kind === 'channel') {
        // Yaw preserves the shared circular water-contact footprint exactly.
        quaternion.setFromAxisAngle(upAxis, rng() * TAU);
      } else {
        quaternion.setFromEuler(new THREE.Euler(
          (rng() - 0.5) * 0.34,
          rng() * TAU,
          (rng() - 0.5) * 0.34,
        ));
      }
      let channelContactRadius: number | null = null;
      if (rock.kind === 'channel') {
        const waterSurface = getStillWaterSurfaceY(terrain, riverField, rock.x, rock.z);
        const waterDepth = Math.max(0.08, waterSurface - y);
        const emergence = 0.5 + Math.min(1.2, rock.scale * (0.34 + rng() * 0.18));
        const submergedSkirt = Math.min(
          waterDepth,
          0.38 + Math.min(0.52, rock.scale * 0.22),
        );
        const targetHeight = emergence + submergedSkirt;
        const targetRadius = getRiverChannelRockContactRadius(rock.scale);
        channelContactRadius = targetRadius;
        const channelLocalRadius = variantPlanarRadii[variantIndex];
        scaleVector.set(
          targetRadius / channelLocalRadius,
          targetHeight / localHeight,
          targetRadius / channelLocalRadius,
        );
        // Render the water-worn crown and a short submerged skirt. The full
        // bed-to-surface ellipsoid looked like a dark floating sphere through
        // Kupa's clear water; the implied boulder continues into the bed while
        // this broad crown owns the visible contact and foam silhouette.
        position.set(
          rock.x,
          waterSurface - submergedSkirt - bounds.min.y * scaleVector.y,
          rock.z,
        );
      } else {
        position.set(rock.x, y + rock.scale * 0.14, rock.z);
        scaleVector.set(
          rock.scale * (0.92 + rng() * 0.55),
          rock.scale * (0.38 + rng() * 0.24),
          rock.scale * (0.82 + rng() * 0.48),
        );
      }
      matrix.compose(position, quaternion, scaleVector);
      const sampledVisualScale = computeShoreStoneVisualScale(rock.x, rock.z);
      const visualScale = rock.kind === 'channel'
        ? 1
        : sampledVisualScale;
      const variation = computeShoreStoneVisualVariation(rock.x, rock.z);
      visualPosition.copy(position);
      if (rock.kind === 'bank') visualPosition.x += variation.offsetX;
      visualPosition.y -= rock.scale * variation.sink * (rock.kind === 'channel' ? 0.12 : 1);
      if (rock.kind === 'bank') visualPosition.z += variation.offsetZ;
      yawQuaternion.setFromAxisAngle(upAxis, variation.yaw);
      visualQuaternion.copy(quaternion).multiply(yawQuaternion);
      // The shared contact radius owns visible geometry, collision, and foam.
      // Keep channel crowns radially symmetric; bank stones retain full shape
      // variation where no hydrodynamic contact envelope must line up.
      const channelAspect = 1;
      visualScaleVector.set(
        scaleVector.x * visualScale * (
          rock.kind === 'channel' ? channelAspect : variation.aspect
        ),
        scaleVector.y * visualScale * (
          rock.kind === 'channel' ? 0.94 + variation.height * 0.05 : variation.height
        ),
        scaleVector.z * visualScale / (
          rock.kind === 'channel' ? channelAspect : variation.aspect
        ),
      );
      const visualMatrix = new THREE.Matrix4().compose(
        visualPosition,
        visualQuaternion,
        visualScaleVector,
      );
      setRockObstacleCollisionBounds(rock, variants[variantIndex], visualMatrix);
      if (channelContactRadius !== null) rock.collisionRadius = channelContactRadius;
      mesh.setMatrixAt(rockIndex, visualMatrix);
      shadowMesh.setMatrixAt(rockIndex, visualMatrix);
      const tint = computeShoreStoneTint(rock.x, rock.z);
      const shoreMoisture = rock.kind === 'channel'
        ? 1
        : 1 - THREE.MathUtils.clamp(
            riverField.sampleShoreDistance(rock.x, rock.z) / 5.4,
            0,
            1,
          );
      const mossSample = rock.kind === 'channel'
        ? computeShoreStoneMoss(rock.x, rock.z)
        : computeShoreStoneTalusMoss(rock.x, rock.z);
      const moss = mossSample
        * (0.28 + shoreMoisture * 0.72);
      if (rock.kind === 'channel') {
        stoneTint.setRGB(
          tint * (1 - moss * 0.1),
          tint * (0.98 + moss * 0.015),
          tint * (0.93 - moss * 0.13),
        );
      } else {
        // Pale carbonate remains the base identity; coherent moss colonies
        // darken all three channels together while biasing green over red/blue.
        stoneTint.setRGB(
          tint * (1 - moss * 0.34),
          tint * (0.98 - moss * 0.16),
          tint * (0.93 - moss * 0.43),
        );
      }
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
        if (placement.kind === 'channel') continue;
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
      const bankInstanceIndices: number[] = [];
      const bankRockPlacements: StonePlacement[] = [];
      instances.forEach((instance, instanceIndex) => {
        if (instance.placement.kind !== 'bank') return;
        bankInstanceIndices.push(instanceIndex);
        bankRockPlacements.push(instance.placement);
      });
      const removedBankIndices = collectRoadRemovedRockIndices(bankRockPlacements, network);
      roadRemoved = new Set(
        [...removedBankIndices].map((bankIndex) => bankInstanceIndices[bankIndex]),
      );
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

      const clusterDensity = computeShoreStoneClusterDensity(x, z);
      const waterlineBias = 1 - THREE.MathUtils.smoothstep(shore, 0.55, 5.4);
      const placementChance = THREE.MathUtils.clamp(
        clusterDensity * (0.44 + waterlineBias * 0.34),
        0,
        0.78,
      );
      const placementRoll = rng();
      if (clusterDensity < 0.08 || placementRoll > placementChance) continue;

      const sizeRoll = rng();
      const scale = sizeRoll < 0.72
        ? THREE.MathUtils.lerp(0.34, 0.88, Math.pow(sizeRoll / 0.72, 1.35))
        : THREE.MathUtils.lerp(
            0.88,
            1.62,
            Math.pow((sizeRoll - 0.72) / 0.28, 0.72),
          );
      // Spatial separation keeps each coherent gravel bar readable.
      if (placementIndex.hasPointWithin(x, z, 0.72 + scale * 0.38)) continue;
      const placement: StonePlacement = { x, z, scale, kind: 'bank' };
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
  smoothDuplicatePositionNormals(geometry);
  writeCarbonateMossVertexColors(geometry, seed);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * IcosahedronGeometry is non-indexed so its default normals are faceted. Keep
 * the UV-owned duplicate vertices, but give coincident corners one shared,
 * area-weighted normal. This changes shading only: topology, silhouette,
 * instance counts, collision bounds, and draw ownership remain identical.
 */
function smoothDuplicatePositionNormals(geometry: THREE.BufferGeometry): void {
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  const normals = geometry.getAttribute('normal') as THREE.BufferAttribute;
  const accumulated = new Map<string, THREE.Vector3>();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const faceNormal = new THREE.Vector3();
  const keyForIndex = (index: number): string => [
    Math.round(positions.getX(index) * 100_000),
    Math.round(positions.getY(index) * 100_000),
    Math.round(positions.getZ(index) * 100_000),
  ].join(':');

  for (let triangle = 0; triangle < positions.count; triangle += 3) {
    a.fromBufferAttribute(positions, triangle);
    b.fromBufferAttribute(positions, triangle + 1);
    c.fromBufferAttribute(positions, triangle + 2);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    faceNormal.crossVectors(ab, ac);
    for (let corner = 0; corner < 3; corner += 1) {
      const key = keyForIndex(triangle + corner);
      let sum = accumulated.get(key);
      if (!sum) {
        sum = new THREE.Vector3();
        accumulated.set(key, sum);
      }
      sum.add(faceNormal);
    }
  }

  for (let index = 0; index < positions.count; index += 1) {
    const sum = accumulated.get(keyForIndex(index));
    if (!sum || sum.lengthSq() < 1e-12) continue;
    sum.normalize();
    normals.setXYZ(index, sum.x, sum.y, sum.z);
  }
  normals.needsUpdate = true;
  geometry.userData.riverStoneNormalContract = 'area-weighted-coincident-corners-v1';
}

function getGeometryMaxPlanarRadius(geometry: THREE.BufferGeometry): number {
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  let radius = 0.1;
  for (let index = 0; index < positions.count; index += 1) {
    radius = Math.max(radius, Math.hypot(positions.getX(index), positions.getZ(index)));
  }
  return radius;
}

function writeCarbonateMossVertexColors(
  geometry: THREE.BufferGeometry,
  seed: number,
): void {
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  const normals = geometry.getAttribute('normal') as THREE.BufferAttribute;
  const colors = new Float32Array(positions.count * 3);
  const point = new THREE.Vector3();
  const normal = new THREE.Vector3();

  for (let index = 0; index < positions.count; index += 1) {
    point.fromBufferAttribute(positions, index);
    normal.fromBufferAttribute(normals, index);
    const mineral = 0.92 + stableSurfaceNoise(point, seed + 21.4) * 0.08;
    const patch = stableSurfaceNoise(point, seed + 44.7);
    const upward = THREE.MathUtils.smoothstep(normal.y, 0.22, 0.88);
    const dampCrevice = THREE.MathUtils.smoothstep(-point.y, -0.38, 0.18);
    const moss = Math.min(
      0.72,
      THREE.MathUtils.smoothstep(patch, 0.42, 0.76)
        * (upward * 0.56 + dampCrevice * 0.34),
    );
    colors[index * 3] = THREE.MathUtils.lerp(mineral, 0.42, moss);
    colors[index * 3 + 1] = THREE.MathUtils.lerp(mineral * 0.985, 0.58, moss);
    colors[index * 3 + 2] = THREE.MathUtils.lerp(mineral * 0.94, 0.3, moss);
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

function stableSurfaceNoise(point: THREE.Vector3, seed: number): number {
  const value = Math.sin(point.x * 127.1 + point.y * 311.7 + point.z * 74.7 + seed * 19.19) * 43758.5453123;
  return value - Math.floor(value);
}
