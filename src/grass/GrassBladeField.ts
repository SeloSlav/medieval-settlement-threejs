import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { vertexColor } from 'three/tsl';
import type { Terrain } from '../terrain/Terrain.ts';
import type { RoadEdge } from '../roads/RoadEdge.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import { distancePointToPolylineXZ } from '../utils/pathGeometry.ts';
import {
  CENTRAL_CLEARING_RADIUS,
  createForestCores,
  createForestSpawnConfig,
  forestDensityAt,
  isInsidePlayableExtent,
  mulberry32,
} from '../props/forestField.ts';
import {
  GRASS_BLADE_CHUNK_SIZE,
  GRASS_BLADE_NEAR_RADIUS,
  GRASS_BLADES_PER_TUFT,
  GRASS_TUFTS_PER_CHUNK_MAX,
  GRASS_TUFTS_PER_CHUNK_MIN,
  grassBladeRevealOpacity,
} from './grassLodMath.ts';

export const GRASS_BLADES_ENABLED = true;

type TslNode = {
  rgb: TslNode;
};

export type GrassBladePlacement = {
  x: number;
  z: number;
  scale: number;
  yaw: number;
  meshIndex: number;
};

type GrassChunk = {
  mesh: THREE.InstancedMesh;
  centerX: number;
  centerZ: number;
};

export type GrassBladeField = {
  group: THREE.Group;
  chunks: GrassChunk[];
  placements: GrassBladePlacement[];
  syncRoadClearance: (network: RoadNetwork) => void;
  updateCameraState: (cameraPosition: THREE.Vector3, cameraDistance: number) => void;
  dispose: () => void;
};

const ROAD_CLEAR_MARGIN = 1.05;
const TAU = Math.PI * 2;

const BLADE_BASE = new THREE.Color(0x4a7c32);
const BLADE_MID = new THREE.Color(0x5e943f);
const BLADE_TIP = new THREE.Color(0x72ad4c);

const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

export function createGrassBladeField(
  terrain: Terrain,
  options?: { isBlockedAt?: (x: number, z: number) => boolean },
): GrassBladeField {
  if (!GRASS_BLADES_ENABLED) {
    return createDisabledGrassBladeField();
  }

  const rng = mulberry32(0x6a55b1ade);
  const spawnConfig = createForestSpawnConfig(terrain.playableSize);
  const forestCores = createForestCores(rng, spawnConfig);
  const placements = createGrassPlacements(rng, terrain, spawnConfig.extent, forestCores, options?.isBlockedAt);
  const material = createGrassBladeMaterial();
  const geometry = createGrassTuftGeometry();
  const groupedPlacements = bucketPlacementsByChunk(placements);
  const chunks = buildGrassChunks(groupedPlacements, terrain, geometry, material, rng);

  const group = new THREE.Group();
  group.name = 'Grass blade field';
  for (const chunk of chunks) group.add(chunk.mesh);

  const baseMatrices = new Map<number, THREE.Matrix4>();
  for (const chunk of chunks) {
    const placementIndices = chunk.mesh.userData.placementIndices as number[];
    for (let index = 0; index < chunk.mesh.count; index++) {
      const matrix = new THREE.Matrix4();
      chunk.mesh.getMatrixAt(index, matrix);
      baseMatrices.set(placementIndices[index], matrix);
    }
  }

  const removed = new Set<number>();

  return {
    group,
    chunks,
    placements,
    syncRoadClearance(network: RoadNetwork) {
      const edges = [...network.edges.values()];
      const nextRemoved = new Set<number>();

      for (let index = 0; index < placements.length; index++) {
        const { x, z } = placements[index];
        if (isGrassNearAnyEdge(x, z, edges)) nextRemoved.add(index);
      }

      for (const chunk of chunks) {
        const mesh = chunk.mesh;
        const placementIndices = mesh.userData.placementIndices as number[];
        let changed = false;

        for (let index = 0; index < mesh.count; index++) {
          const placementIndex = placementIndices[index];
          const shouldRemove = nextRemoved.has(placementIndex);
          if (shouldRemove === removed.has(placementIndex)) continue;
          mesh.setMatrixAt(index, shouldRemove ? hiddenMatrix : baseMatrices.get(placementIndex)!);
          changed = true;
        }

        if (changed) {
          mesh.instanceMatrix.needsUpdate = true;
          mesh.computeBoundingSphere();
        }
      }

      removed.clear();
      for (const index of nextRemoved) removed.add(index);
    },
    updateCameraState(cameraPosition: THREE.Vector3, cameraDistance: number) {
      const zoomOpacity = grassBladeRevealOpacity(cameraDistance);
      const zoomVisible = zoomOpacity > 0.02;
      material.opacity = zoomOpacity;
      material.transparent = zoomOpacity < 0.995;

      const nearRadiusSq = GRASS_BLADE_NEAR_RADIUS * GRASS_BLADE_NEAR_RADIUS;
      for (const chunk of chunks) {
        const dx = chunk.centerX - cameraPosition.x;
        const dz = chunk.centerZ - cameraPosition.z;
        const nearEnough = dx * dx + dz * dz <= nearRadiusSq;
        chunk.mesh.visible = zoomVisible && nearEnough;
      }
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

function createDisabledGrassBladeField(): GrassBladeField {
  const group = new THREE.Group();
  group.name = 'Grass blade field (disabled)';
  group.visible = false;
  return {
    group,
    chunks: [],
    placements: [],
    syncRoadClearance() {},
    updateCameraState() {},
    dispose() {},
  };
}

function bucketPlacementsByChunk(placements: GrassBladePlacement[]): Map<string, GrassBladePlacement[]> {
  const grouped = new Map<string, GrassBladePlacement[]>();
  for (const placement of placements) {
    const key = chunkKey(placement.x, placement.z);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(placement);
    else grouped.set(key, [placement]);
  }
  return grouped;
}

function buildGrassChunks(
  groupedPlacements: Map<string, GrassBladePlacement[]>,
  terrain: Terrain,
  geometry: THREE.BufferGeometry,
  material: MeshStandardNodeMaterial,
  rng: () => number,
): GrassChunk[] {
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scaleVector = new THREE.Vector3();
  const color = new THREE.Color();
  const euler = new THREE.Euler();
  const chunks: GrassChunk[] = [];

  for (const [key, bucket] of groupedPlacements) {
    if (bucket.length === 0) continue;
    const mesh = new THREE.InstancedMesh(geometry, material, bucket.length);
    mesh.name = `Grass blades ${key}`;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;

    let centerX = 0;
    let centerZ = 0;

    bucket.forEach((placement, index) => {
      composeGrassMatrix(placement, terrain, matrix, quaternion, position, scaleVector, euler);
      mesh.setMatrixAt(index, matrix);
      centerX += placement.x;
      centerZ += placement.z;
      color.setHSL(
        0.32 + (rng() - 0.5) * 0.04,
        0.72 + rng() * 0.1,
        0.42 + rng() * 0.1,
      );
      mesh.setColorAt(index, color);
    });

    mesh.userData.placementIndices = bucket.map((placement) => placement.meshIndex);
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.visible = false;

    chunks.push({
      mesh,
      centerX: centerX / bucket.length,
      centerZ: centerZ / bucket.length,
    });
  }

  return chunks;
}

function chunkKey(x: number, z: number): string {
  const chunkX = Math.floor(x / GRASS_BLADE_CHUNK_SIZE);
  const chunkZ = Math.floor(z / GRASS_BLADE_CHUNK_SIZE);
  return `${chunkX},${chunkZ}`;
}

function createGrassBladeMaterial(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  material.name = 'Grass blade';
  material.side = THREE.DoubleSide;
  material.transparent = true;
  material.opacity = 0;
  material.alphaTest = 0.2;
  material.depthWrite = true;
  material.roughness = 0.88;
  material.metalness = 0;
  material.color.set(0xffffff);
  material.colorNode = (vertexColor() as TslNode).rgb;
  return material;
}

function createGrassPlacements(
  rng: () => number,
  terrain: Terrain,
  extent: number,
  forestCores: ReturnType<typeof createForestCores>,
  isBlockedAt?: (x: number, z: number) => boolean,
): GrassBladePlacement[] {
  const placements: GrassBladePlacement[] = [];
  const half = terrain.playableSize * 0.5;
  const chunkCount = Math.ceil(terrain.playableSize / GRASS_BLADE_CHUNK_SIZE);
  const gridSide = Math.ceil(Math.sqrt(GRASS_TUFTS_PER_CHUNK_MAX));

  for (let chunkX = 0; chunkX < chunkCount; chunkX++) {
    for (let chunkZ = 0; chunkZ < chunkCount; chunkZ++) {
      const chunkMinX = -half + chunkX * GRASS_BLADE_CHUNK_SIZE;
      const chunkMinZ = -half + chunkZ * GRASS_BLADE_CHUNK_SIZE;
      const tuftCount =
        GRASS_TUFTS_PER_CHUNK_MIN +
        Math.floor(rng() * (GRASS_TUFTS_PER_CHUNK_MAX - GRASS_TUFTS_PER_CHUNK_MIN + 1));
      const cellSize = GRASS_BLADE_CHUNK_SIZE / gridSide;
      let placed = 0;

      for (let slot = 0; slot < gridSide * gridSide && placed < tuftCount; slot++) {
        const gridX = slot % gridSide;
        const gridZ = Math.floor(slot / gridSide);
        const x = chunkMinX + (gridX + 0.5 + (rng() - 0.5) * 0.62) * cellSize;
        const z = chunkMinZ + (gridZ + 0.5 + (rng() - 0.5) * 0.62) * cellSize;

        if (!isInsidePlayableExtent(x, z, extent)) continue;
        if (Math.hypot(x, z) < CENTRAL_CLEARING_RADIUS + rng() * 4) continue;
        if (isBlockedAt?.(x, z)) continue;

        const density = forestDensityAt(x, z, forestCores, extent);
        const spawnChance = THREE.MathUtils.lerp(0.94, 0.99, density);
        if (rng() > spawnChance) continue;

        const scale =
          THREE.MathUtils.lerp(0.98, 1.42, Math.pow(rng(), 0.68)) *
          THREE.MathUtils.lerp(0.94, 1.12, density);
        placements.push({
          x,
          z,
          scale,
          yaw: rng() * TAU,
          meshIndex: placements.length,
        });
        placed++;
      }
    }
  }

  return placements;
}

function composeGrassMatrix(
  placement: GrassBladePlacement,
  terrain: Terrain,
  matrix: THREE.Matrix4,
  quaternion: THREE.Quaternion,
  position: THREE.Vector3,
  scaleVector: THREE.Vector3,
  euler: THREE.Euler,
): void {
  position.set(placement.x, terrain.getHeightAt(placement.x, placement.z), placement.z);
  euler.set(0, placement.yaw, 0);
  quaternion.setFromEuler(euler);
  scaleVector.set(placement.scale, placement.scale, placement.scale);
  matrix.compose(position, quaternion, scaleVector);
}

function isGrassNearAnyEdge(x: number, z: number, edges: RoadEdge[]): boolean {
  for (const edge of edges) {
    const path = edge.sampledPath.length >= 2 ? edge.sampledPath : edge.controlPoints;
    if (path.length < 2) continue;
    if (distancePointToPolylineXZ(x, z, path) <= edge.width * 0.5 + ROAD_CLEAR_MARGIN) {
      return true;
    }
  }
  return false;
}

/** Thin tapered blades in a loose tuft — reads as individual stalks, not flat cards. */
function createGrassTuftGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const bladeCount = GRASS_BLADES_PER_TUFT;
  for (let i = 0; i < bladeCount; i++) {
    const yaw = (i / bladeCount) * TAU + (i % 2 === 0 ? 0.16 : -0.12);
    const height = 0.44 + (i % 4) * 0.1 + (i % 3) * 0.055;
    const halfWidth = 0.017 + (i % 2) * 0.005;
    const lean = 0.045 + (i % 3) * 0.022;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const leanX = cos * lean;
    const leanZ = sin * lean;
    const shade = i % 3 === 0 ? BLADE_TIP : i % 2 === 0 ? BLADE_MID : BLADE_BASE;

    appendTaperedBlade(
      positions,
      normals,
      colors,
      indices,
      cos,
      sin,
      leanX,
      leanZ,
      halfWidth,
      height,
      shade,
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

function appendTaperedBlade(
  positions: number[],
  normals: number[],
  colors: number[],
  indices: number[],
  cos: number,
  sin: number,
  leanX: number,
  leanZ: number,
  halfWidth: number,
  height: number,
  baseColor: THREE.Color,
): void {
  const base = positions.length / 3;
  const tipColor = BLADE_TIP.clone().lerp(baseColor, 0.35);
  const midColor = BLADE_MID.clone().lerp(baseColor, 0.55);

  const verts = [
    { x: -halfWidth * cos, y: 0, z: -halfWidth * sin, c: baseColor },
    { x: halfWidth * cos, y: 0, z: halfWidth * sin, c: baseColor },
    { x: leanX * 0.35, y: height * 0.55, z: leanZ * 0.35, c: midColor },
    { x: leanX, y: height, z: leanZ, c: tipColor },
  ];

  for (const v of verts) {
    positions.push(v.x, v.y, v.z);
    normals.push(cos * 0.35, 0.92, sin * 0.35);
    colors.push(v.c.r, v.c.g, v.c.b);
  }

  indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
}
