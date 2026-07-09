import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { vertexColor } from 'three/tsl';
import type { Terrain } from '../terrain/Terrain.ts';
import type { RoadEdge } from '../roads/RoadEdge.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import { distancePointToPolylineXZ } from '../utils/pathGeometry.ts';
import {
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
  GRASS_EDGE_FADE_BAND,
  GRASS_STREAM_CHUNK_RADIUS,
  GRASS_STREAM_CHUNKS_PER_FRAME,
  GRASS_TUFTS_PER_CHUNK,
  grassBladeRevealOpacity,
} from './grassLodMath.ts';

export const GRASS_BLADES_ENABLED = true;

type TslNode = {
  rgb: TslNode;
};

export type GrassBladeField = {
  group: THREE.Group;
  syncRoadClearance: (network: RoadNetwork) => void;
  updateCameraState: (
    cameraPosition: THREE.Vector3,
    cameraTarget: THREE.Vector3,
    cameraDistance: number,
  ) => void;
  dispose: () => void;
};

const ROAD_CLEAR_MARGIN = 1.05;
const TAU = Math.PI * 2;
const MAX_STREAM_INSTANCES = (GRASS_STREAM_CHUNK_RADIUS * 2 + 1) ** 2 * GRASS_TUFTS_PER_CHUNK;
const SCATTER_ATTEMPTS = GRASS_TUFTS_PER_CHUNK + 14;
const MIN_TUFT_SPACING_SQ = 0.72 * 0.72;

/** Matches forest undergrowth — muted olive, not neon yellow-green. */
const BLADE_BASE = new THREE.Color(0x3a5032);
const BLADE_MID = new THREE.Color(0x4a6340);
const BLADE_TIP = new THREE.Color(0x566b48);

type GrassFieldContext = {
  terrain: Terrain;
  extent: number;
  forestCores: ReturnType<typeof createForestCores>;
  isBlockedAt?: (x: number, z: number) => boolean;
  roadEdges: RoadEdge[];
};

type StreamChunk = {
  chunkX: number;
  chunkZ: number;
};

export function createGrassBladeField(
  terrain: Terrain,
  options?: { isBlockedAt?: (x: number, z: number) => boolean },
): GrassBladeField {
  if (!GRASS_BLADES_ENABLED) {
    return createDisabledGrassBladeField();
  }

  const spawnConfig = createForestSpawnConfig(terrain.playableSize);
  const context: GrassFieldContext = {
    terrain,
    extent: spawnConfig.extent,
    forestCores: createForestCores(mulberry32(0x6a55b1ade), spawnConfig),
    isBlockedAt: options?.isBlockedAt,
    roadEdges: [],
  };

  const material = createGrassBladeMaterial();
  const geometry = createGrassTuftGeometry();
  const mesh = new THREE.InstancedMesh(geometry, material, MAX_STREAM_INSTANCES);
  mesh.name = 'Grass blade stream';
  mesh.count = 0;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = true;
  mesh.visible = false;

  const group = new THREE.Group();
  group.name = 'Grass blade field';
  group.add(mesh);

  let streamChunkX = Number.NaN;
  let streamChunkZ = Number.NaN;
  let streamDirty = true;
  let rebuildQueue: StreamChunk[] | null = null;
  let rebuildInstanceIndex = 0;
  let rebuildFocusX = 0;
  let rebuildFocusZ = 0;
  let lastMaterialOpacity = Number.NaN;

  const collectStreamChunks = (focusX: number, focusZ: number): StreamChunk[] => {
    const centerChunkX = Math.floor(focusX / GRASS_BLADE_CHUNK_SIZE);
    const centerChunkZ = Math.floor(focusZ / GRASS_BLADE_CHUNK_SIZE);
    const includeRadiusSq = (GRASS_BLADE_NEAR_RADIUS + GRASS_BLADE_CHUNK_SIZE * 0.6) ** 2;
    const chunks: StreamChunk[] = [];

    for (let dz = -GRASS_STREAM_CHUNK_RADIUS; dz <= GRASS_STREAM_CHUNK_RADIUS; dz++) {
      for (let dx = -GRASS_STREAM_CHUNK_RADIUS; dx <= GRASS_STREAM_CHUNK_RADIUS; dx++) {
        const chunkX = centerChunkX + dx;
        const chunkZ = centerChunkZ + dz;
        const chunkCenterX = (chunkX + 0.5) * GRASS_BLADE_CHUNK_SIZE;
        const chunkCenterZ = (chunkZ + 0.5) * GRASS_BLADE_CHUNK_SIZE;
        const toFocusX = chunkCenterX - focusX;
        const toFocusZ = chunkCenterZ - focusZ;
        if (toFocusX * toFocusX + toFocusZ * toFocusZ > includeRadiusSq) continue;
        chunks.push({ chunkX, chunkZ });
      }
    }

    return chunks;
  };

  const beginStreamRebuild = (focusX: number, focusZ: number): void => {
    rebuildQueue = collectStreamChunks(focusX, focusZ);
    rebuildInstanceIndex = 0;
    rebuildFocusX = focusX;
    rebuildFocusZ = focusZ;
    mesh.count = 0;
  };

  const finishStreamRebuild = (focusX: number, focusZ: number): void => {
    streamChunkX = Math.floor(focusX / GRASS_BLADE_CHUNK_SIZE);
    streamChunkZ = Math.floor(focusZ / GRASS_BLADE_CHUNK_SIZE);
    streamDirty = false;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  };

  const stepStreamRebuild = (): void => {
    if (!rebuildQueue) return;

    const budget = GRASS_STREAM_CHUNKS_PER_FRAME;
    const end = Math.min(rebuildQueue.length, budget);
    for (let index = 0; index < end; index++) {
      const { chunkX, chunkZ } = rebuildQueue[index]!;
      rebuildInstanceIndex = writeChunkInstances(
        mesh,
        rebuildInstanceIndex,
        chunkX,
        chunkZ,
        rebuildFocusX,
        rebuildFocusZ,
        context,
      );
    }

    rebuildQueue.splice(0, end);
    mesh.count = rebuildInstanceIndex;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    if (rebuildQueue.length === 0) {
      rebuildQueue = null;
      finishStreamRebuild(rebuildFocusX, rebuildFocusZ);
    }
  };

  return {
    group,
    syncRoadClearance(network: RoadNetwork) {
      context.roadEdges = [...network.edges.values()];
      streamDirty = true;
    },
    updateCameraState(_cameraPosition: THREE.Vector3, cameraTarget: THREE.Vector3, cameraDistance: number) {
      const zoomOpacity = grassBladeRevealOpacity(cameraDistance);
      const zoomVisible = zoomOpacity > 0.02;

      if (Math.abs(zoomOpacity - lastMaterialOpacity) > 0.008) {
        lastMaterialOpacity = zoomOpacity;
        material.opacity = zoomOpacity;
        const useTransparency = zoomOpacity < 0.995;
        if (material.transparent !== useTransparency) {
          material.transparent = useTransparency;
          material.depthWrite = !useTransparency;
          material.needsUpdate = true;
        }
      }

      mesh.visible = zoomVisible;
      if (!zoomVisible) {
        rebuildQueue = null;
        return;
      }

      const focusX = cameraTarget.x;
      const focusZ = cameraTarget.z;
      const centerChunkX = Math.floor(focusX / GRASS_BLADE_CHUNK_SIZE);
      const centerChunkZ = Math.floor(focusZ / GRASS_BLADE_CHUNK_SIZE);

      if (rebuildQueue) {
        const queueChunkX = Math.floor(rebuildFocusX / GRASS_BLADE_CHUNK_SIZE);
        const queueChunkZ = Math.floor(rebuildFocusZ / GRASS_BLADE_CHUNK_SIZE);
        if (streamDirty || centerChunkX !== queueChunkX || centerChunkZ !== queueChunkZ) {
          beginStreamRebuild(focusX, focusZ);
        }
        stepStreamRebuild();
        return;
      }

      const chunkChanged = centerChunkX !== streamChunkX || centerChunkZ !== streamChunkZ;
      if (streamDirty || chunkChanged) {
        beginStreamRebuild(focusX, focusZ);
        stepStreamRebuild();
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
    syncRoadClearance() {},
    updateCameraState() {},
    dispose() {},
  };
}

function chunkSeed(chunkX: number, chunkZ: number): number {
  return ((chunkX * 73856093) ^ (chunkZ * 19349663) ^ 0x6a55b1ade) >>> 0;
}

const writeMatrix = new THREE.Matrix4();
const writeQuaternion = new THREE.Quaternion();
const writePosition = new THREE.Vector3();
const writeScale = new THREE.Vector3();
const writeEuler = new THREE.Euler();
const writeColor = new THREE.Color();

function writeChunkInstances(
  mesh: THREE.InstancedMesh,
  startIndex: number,
  chunkX: number,
  chunkZ: number,
  focusX: number,
  focusZ: number,
  context: GrassFieldContext,
): number {
  const { terrain, extent, forestCores, isBlockedAt, roadEdges } = context;
  const rng = mulberry32(chunkSeed(chunkX, chunkZ));
  const chunkMinX = chunkX * GRASS_BLADE_CHUNK_SIZE;
  const chunkMinZ = chunkZ * GRASS_BLADE_CHUNK_SIZE;
  const chunkSpan = GRASS_BLADE_CHUNK_SIZE;
  const margin = chunkSpan * 0.08;
  let instanceIndex = startIndex;

  const localPlacements: { x: number; z: number }[] = [];
  const tuftTarget = GRASS_TUFTS_PER_CHUNK + Math.floor(rng() * 5);

  for (let attempt = 0; attempt < SCATTER_ATTEMPTS && localPlacements.length < tuftTarget; attempt++) {
    let x: number;
    let z: number;

    if (localPlacements.length > 0 && rng() < 0.28) {
      const anchor = localPlacements[Math.floor(rng() * localPlacements.length)]!;
      const clusterRadius = 0.55 + rng() * 0.95;
      const angle = rng() * TAU;
      x = anchor.x + Math.cos(angle) * clusterRadius;
      z = anchor.z + Math.sin(angle) * clusterRadius;
    } else {
      x = chunkMinX + margin + rng() * (chunkSpan - margin * 2);
      z = chunkMinZ + margin + rng() * (chunkSpan - margin * 2);
    }

    let tooClose = false;
    for (const placed of localPlacements) {
      const dx = x - placed.x;
      const dz = z - placed.z;
      if (dx * dx + dz * dz < MIN_TUFT_SPACING_SQ) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;

    if (!isInsidePlayableExtent(x, z, extent)) continue;
    if (isBlockedAt?.(x, z)) continue;
    if (isGrassNearAnyEdge(x, z, roadEdges)) continue;

    const toFocusX = x - focusX;
    const toFocusZ = z - focusZ;
    const focusDist = Math.hypot(toFocusX, toFocusZ);
    const edgeFade = smoothstep01(
      GRASS_BLADE_NEAR_RADIUS,
      GRASS_BLADE_NEAR_RADIUS - GRASS_EDGE_FADE_BAND,
      focusDist,
    );
    if (edgeFade <= 0.02) continue;

    localPlacements.push({ x, z });

    const density = forestDensityAt(x, z, forestCores, extent);
    const scale =
      THREE.MathUtils.lerp(0.82, 1.22, Math.pow(rng(), 0.82)) *
      THREE.MathUtils.lerp(0.9, 1.06, density) *
      edgeFade;
    const yaw = rng() * TAU;

    writePosition.set(x, terrain.getHeightAt(x, z), z);
    writeEuler.set(0, yaw, 0);
    writeQuaternion.setFromEuler(writeEuler);
    writeScale.set(scale, scale, scale);
    writeMatrix.compose(writePosition, writeQuaternion, writeScale);
    mesh.setMatrixAt(instanceIndex, writeMatrix);
    writeColor.setHSL(
      0.27 + (rng() - 0.5) * 0.035,
      0.36 + rng() * 0.12,
      0.27 + rng() * 0.08,
    );
    mesh.setColorAt(instanceIndex, writeColor);
    instanceIndex++;
  }

  return instanceIndex;
}

function smoothstep01(edge0: number, edge1: number, value: number): number {
  const t = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function createGrassBladeMaterial(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  material.name = 'Grass blade';
  material.side = THREE.DoubleSide;
  material.transparent = true;
  material.opacity = 0;
  material.alphaTest = 0.22;
  material.depthWrite = true;
  material.roughness = 0.94;
  material.metalness = 0;
  material.color.set(0x8a9480);
  material.colorNode = (vertexColor() as TslNode).rgb;
  return material;
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
    const height = 0.46 + (i % 4) * 0.095 + (i % 3) * 0.05;
    const halfWidth = 0.019 + (i % 2) * 0.006;
    const lean = 0.04 + (i % 3) * 0.02;
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
  const tipColor = BLADE_TIP.clone().lerp(baseColor, 0.42);
  const midColor = BLADE_MID.clone().lerp(baseColor, 0.62);

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
