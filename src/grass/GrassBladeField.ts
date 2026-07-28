import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { vertexColor } from 'three/tsl';
import { applyFoliageDoubleSideNormalsNode } from '../scene/foliageDoubleSideNormals.ts';
import {
  createSeedThreeGrassMaterial,
  createSeedThreeTuftVariants,
  disposeSeedThreeGrassTextureCache,
  loadSeedThreeGrassTextures,
  sampleSeedThreeGrassTint,
  type SeedThreeTuftVariant,
} from '../vegetation/seedthree/seedThreeGrass.ts';
import {
  createSeedThreeWildflowerGeometry,
  createSeedThreeWildflowerMaterial,
  disposeSeedThreeWildflowerTextureCache,
  loadSeedThreeWildflowerAtlas,
  SEEDTHREE_WILDFLOWER_VARIANTS,
} from '../vegetation/seedthree/seedThreeWildflowers.ts';
import type { Terrain } from '../terrain/Terrain.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import { RoadSpatialIndex } from '../roads/roadSpatialIndex.ts';
import { isPointInPolygon2, type Point2 } from '../utils/polygonGeometry.ts';
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
  GRASS_STREAM_BURST_CAP,
  GRASS_STREAM_CHUNK_RADIUS,
  GRASS_STREAM_SLOTS_PER_FRAME,
  GRASS_STREAM_SLOTS_PER_FRAME_FIRST_PERSON,
  GRASS_TUFT_SCATTER_ATTEMPTS,
  GRASS_TUFTS_PER_CHUNK,
  grassBladeLodOpacity,
  grassStreamNearRadius,
  resolveCloseGroundLod,
} from './grassLodMath.ts';

export const GRASS_BLADES_ENABLED = true;

type TslNode = {
  rgb: TslNode;
};

export type GrassBladeField = {
  group: THREE.Group;
  syncRoadClearance: (network: RoadNetwork) => void;
  syncPlacementClearance: (polygons: Iterable<Point2[]>) => void;
  setBuildInteractionActive: (active: boolean) => void;
  setRoadDraftActive: (active: boolean) => void;
  updateCameraState: (
    cameraPosition: THREE.Vector3,
    cameraTarget: THREE.Vector3,
    cameraDistance: number,
    firstPersonActive?: boolean,
  ) => void;
  dispose: () => void;
};

const ROAD_CLEAR_MARGIN = 1.05;
const TAU = Math.PI * 2;
const GRID_SIDE = GRASS_STREAM_CHUNK_RADIUS * 2 + 1;
const GRASS_SLOT_CAPACITY = GRASS_TUFTS_PER_CHUNK + 14;
const WILDFLOWER_SLOT_CAPACITY = 4;
const MAX_GRASS_STREAM_INSTANCES = GRID_SIDE * GRID_SIDE * GRASS_SLOT_CAPACITY;
const MAX_WILDFLOWER_STREAM_INSTANCES = GRID_SIDE * GRID_SIDE * WILDFLOWER_SLOT_CAPACITY;
const MIN_TUFT_SPACING_SQ = 0.26 * 0.26;
const MIN_MICRO_TUFT_SPACING_SQ = 0.16 * 0.16;
const MIN_WILDFLOWER_SPACING_SQ = 2.1 * 2.1;
/** Park culled tufts far below the world — zero-scale at origin alpha-tests into a visible orb. */
const HIDDEN_INSTANCE_Y = -4096;
const hiddenMatrix = new THREE.Matrix4().compose(
  new THREE.Vector3(0, HIDDEN_INSTANCE_Y, 0),
  new THREE.Quaternion(),
  new THREE.Vector3(0.001, 0.001, 0.001),
);

/** Muted olive — aligned with forest undergrowth. */
const BLADE_BASE = new THREE.Color(0x3a5032);
const BLADE_MID = new THREE.Color(0x4a6340);
const BLADE_TIP = new THREE.Color(0x566b48);

type GrassFieldContext = {
  terrain: Terrain;
  extent: number;
  terrainExtent: number;
  forestCores: ReturnType<typeof createForestCores>;
  isBlockedAt?: (x: number, z: number) => boolean;
  placementClearancePolygons: Point2[][];
  roadSpatialIndex: RoadSpatialIndex | null;
};

type PendingSlot = {
  gridIndex: number;
  worldChunkX: number;
  worldChunkZ: number;
  sortKey: number;
};

type SlotRecord = {
  worldChunkX: number;
  worldChunkZ: number;
  meshCounts: number[];
};

type GrassStreamMesh = {
  mesh: THREE.InstancedMesh;
  slotCapacity: number;
  variant?: SeedThreeTuftVariant;
  wildflowers?: true;
  tintAttr?: THREE.InstancedBufferAttribute;
  anchorAttr?: THREE.InstancedBufferAttribute;
};

export type GrassBladeFieldOptions = {
  isBlockedAt?: (x: number, z: number) => boolean;
  useSeedThreeClumps?: boolean;
  maxAnisotropy?: number;
};

export async function createGrassBladeField(
  terrain: Terrain,
  options?: GrassBladeFieldOptions,
): Promise<GrassBladeField> {
  if (!GRASS_BLADES_ENABLED) {
    return createDisabledGrassBladeField();
  }

  const spawnConfig = createForestSpawnConfig(terrain.playableSize, terrain.size);
  const context: GrassFieldContext = {
    terrain,
    extent: spawnConfig.extent,
    terrainExtent: spawnConfig.terrainExtent,
    forestCores: createForestCores(mulberry32(0x6a55b1ade), spawnConfig),
    isBlockedAt: options?.isBlockedAt,
    placementClearancePolygons: [],
    roadSpatialIndex: null,
  };

  const useSeedThreeClumps = options?.useSeedThreeClumps === true;
  let streamMeshes: GrassStreamMesh[];
  let displayMaterials: THREE.Material[];
  let disposeResources: () => void;

  if (useSeedThreeClumps) {
    const [textures, wildflowerAtlas] = await Promise.all([
      loadSeedThreeGrassTextures(options?.maxAnisotropy ?? 4),
      loadSeedThreeWildflowerAtlas(options?.maxAnisotropy ?? 4),
    ]);
    const variants = createSeedThreeTuftVariants();
    const grassMaterial = createSeedThreeGrassMaterial(textures);
    applyGrassDepthOffset(grassMaterial);
    streamMeshes = variants.map((variant, index) => {
      const geometry = variant.geometry;
      const tintAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_GRASS_STREAM_INSTANCES * 3), 3);
      const anchorAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_GRASS_STREAM_INSTANCES * 3), 3);
      geometry.setAttribute('aTint', tintAttr);
      geometry.setAttribute('aAnchorPos', anchorAttr);
      const mesh = new THREE.InstancedMesh(geometry, grassMaterial, MAX_GRASS_STREAM_INSTANCES);
      mesh.name = index === 0 ? 'SeedThree grass meadow' : 'SeedThree grass clump';
      mesh.count = 0;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      mesh.visible = false;
      return { mesh, slotCapacity: GRASS_SLOT_CAPACITY, variant, tintAttr, anchorAttr };
    });
    const wildflowerGeometry = createSeedThreeWildflowerGeometry(0.9);
    const wildflowerAnchorAttr = new THREE.InstancedBufferAttribute(
      new Float32Array(MAX_WILDFLOWER_STREAM_INSTANCES * 4),
      4,
    );
    wildflowerGeometry.setAttribute('aAnchorPos', wildflowerAnchorAttr);
    const wildflowerMaterial = createSeedThreeWildflowerMaterial(
      wildflowerAtlas,
      'Gorski Kotar wildflower atlas',
    );
    applyGrassDepthOffset(wildflowerMaterial);
    const wildflowerMesh = new THREE.InstancedMesh(
      wildflowerGeometry,
      wildflowerMaterial,
      MAX_WILDFLOWER_STREAM_INSTANCES,
    );
    wildflowerMesh.name = 'SeedThree streamed Gorski Kotar wildflowers';
    wildflowerMesh.count = 0;
    wildflowerMesh.castShadow = false;
    wildflowerMesh.receiveShadow = true;
    wildflowerMesh.frustumCulled = false;
    wildflowerMesh.renderOrder = 3;
    wildflowerMesh.visible = false;
    wildflowerMesh.userData.texturePath =
      '/assets/textures/vegetation/wildflowers/gorski-kotar-wildflower-atlas.png';
    streamMeshes.push({
      mesh: wildflowerMesh,
      slotCapacity: WILDFLOWER_SLOT_CAPACITY,
      wildflowers: true,
      anchorAttr: wildflowerAnchorAttr,
    });
    displayMaterials = [grassMaterial, wildflowerMaterial];
    disposeResources = () => {
      for (const entry of streamMeshes) entry.mesh.geometry.dispose();
      for (const material of displayMaterials) material.dispose();
      disposeSeedThreeGrassTextureCache();
      disposeSeedThreeWildflowerTextureCache();
    };
  } else {
    const grassMaterial = createGrassBladeMaterial();
    applyGrassDepthOffset(grassMaterial);
    const geometry = createGrassTuftGeometry();
    const mesh = new THREE.InstancedMesh(geometry, grassMaterial, MAX_GRASS_STREAM_INSTANCES);
    mesh.name = 'Grass blade stream';
    mesh.count = 0;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    mesh.visible = false;
    streamMeshes = [{ mesh, slotCapacity: GRASS_SLOT_CAPACITY }];
    displayMaterials = [grassMaterial];
    disposeResources = () => {
      geometry.dispose();
      grassMaterial.dispose();
    };
  }

  const group = new THREE.Group();
  group.name = useSeedThreeClumps ? 'SeedThree grass field' : 'Grass blade field';
  for (const entry of streamMeshes) group.add(entry.mesh);

  const slotRecords: SlotRecord[] = Array.from({ length: GRID_SIDE * GRID_SIDE }, () => ({
    worldChunkX: Number.NaN,
    worldChunkZ: Number.NaN,
    meshCounts: Array.from({ length: streamMeshes.length }, () => 0),
  }));

  let anchorChunkX = Number.NaN;
  let anchorChunkZ = Number.NaN;
  let needsFullStream = true;
  let roadClearanceDirty = false;
  let pendingSlots: PendingSlot[] = [];
  let lastMaterialOpacity = Number.NaN;
  let grassZoomVisible = false;
  let wasFirstPerson = false;
  let wasGrassVisible = false;
  let streamBurstPending = false;
  let streamNearRadius = GRASS_BLADE_NEAR_RADIUS;

  const chunkInStreamRange = (
    chunkX: number,
    chunkZ: number,
    focusX: number,
    focusZ: number,
    nearRadius = streamNearRadius,
  ): boolean => {
    const chunkCenterX = (chunkX + 0.5) * GRASS_BLADE_CHUNK_SIZE;
    const chunkCenterZ = (chunkZ + 0.5) * GRASS_BLADE_CHUNK_SIZE;
    const includeRadiusSq = (nearRadius + GRASS_BLADE_CHUNK_SIZE * 0.85) ** 2;
    const dx = chunkCenterX - focusX;
    const dz = chunkCenterZ - focusZ;
    return dx * dx + dz * dz <= includeRadiusSq;
  };

  const gridIndex = (localX: number, localZ: number): number => localZ * GRID_SIDE + localX;

  const worldChunkAt = (centerChunkX: number, centerChunkZ: number, localX: number, localZ: number) => ({
    chunkX: centerChunkX + localX - GRASS_STREAM_CHUNK_RADIUS,
    chunkZ: centerChunkZ + localZ - GRASS_STREAM_CHUNK_RADIUS,
  });

  const slotDistanceSq = (chunkX: number, chunkZ: number, focusX: number, focusZ: number): number => {
    const centerX = (chunkX + 0.5) * GRASS_BLADE_CHUNK_SIZE;
    const centerZ = (chunkZ + 0.5) * GRASS_BLADE_CHUNK_SIZE;
    const dx = centerX - focusX;
    const dz = centerZ - focusZ;
    return dx * dx + dz * dz;
  };

  const refreshMeshCount = (): void => {
    for (let meshIndex = 0; meshIndex < streamMeshes.length; meshIndex++) {
      let maxExclusive = 0;
      for (let gridIdx = 0; gridIdx < slotRecords.length; gridIdx++) {
        const count = slotRecords[gridIdx]!.meshCounts[meshIndex] ?? 0;
        if (count <= 0) continue;
        maxExclusive = Math.max(maxExclusive, gridIdx * streamMeshes[meshIndex]!.slotCapacity + count);
      }
      streamMeshes[meshIndex]!.mesh.count = maxExclusive;
    }
  };

  const regenerateSlot = (
    gridIdx: number,
    worldChunkX: number,
    worldChunkZ: number,
    focusX: number,
    focusZ: number,
  ): void => {
    const existing = slotRecords[gridIdx]!;
    if (existing.worldChunkX === worldChunkX && existing.worldChunkZ === worldChunkZ) {
      return;
    }

    for (const entry of streamMeshes) {
      clearSlotRange(entry.mesh, gridIdx * entry.slotCapacity, entry.slotCapacity);
    }
    if (!chunkInStreamRange(worldChunkX, worldChunkZ, focusX, focusZ)) {
      slotRecords[gridIdx] = {
        worldChunkX,
        worldChunkZ,
        meshCounts: Array.from({ length: streamMeshes.length }, () => 0),
      };
      return;
    }

    let meshCounts: number[];
    if (useSeedThreeClumps) {
      const grassEntries = streamMeshes.filter((entry) => entry.variant);
      const grassSlotStart = gridIdx * GRASS_SLOT_CAPACITY;
      const grassCounts = writeSeedThreeChunkInstances(
        grassEntries,
        grassSlotStart,
        worldChunkX,
        worldChunkZ,
        context,
        GRASS_SLOT_CAPACITY,
      );
      let grassCountIndex = 0;
      meshCounts = streamMeshes.map((entry) => {
        if (entry.variant) return grassCounts[grassCountIndex++] ?? 0;
        if (!entry.wildflowers) return 0;
        return writeSeedThreeWildflowerChunkInstances(
          entry,
          gridIdx * entry.slotCapacity,
          worldChunkX,
          worldChunkZ,
          context,
          entry.slotCapacity,
        );
      });
    } else {
      const entry = streamMeshes[0]!;
      const slotStart = gridIdx * entry.slotCapacity;
      meshCounts = [
        writeChunkInstances(
          entry.mesh,
          slotStart,
          worldChunkX,
          worldChunkZ,
          context,
          entry.slotCapacity,
        ) - slotStart,
      ];
    }
    slotRecords[gridIdx] = { worldChunkX, worldChunkZ, meshCounts };
  };

  const queueFullStream = (
    centerChunkX: number,
    centerChunkZ: number,
    focusX: number,
    focusZ: number,
    nearRadius: number,
  ): void => {
    pendingSlots = [];
    for (let localZ = 0; localZ < GRID_SIDE; localZ++) {
      for (let localX = 0; localX < GRID_SIDE; localX++) {
        const { chunkX, chunkZ } = worldChunkAt(centerChunkX, centerChunkZ, localX, localZ);
        if (!chunkInStreamRange(chunkX, chunkZ, focusX, focusZ, nearRadius)) continue;
        const gridIdx = gridIndex(localX, localZ);
        const existing = slotRecords[gridIdx]!;
        if (existing.worldChunkX === chunkX && existing.worldChunkZ === chunkZ) continue;
        pendingSlots.push({
          gridIndex: gridIdx,
          worldChunkX: chunkX,
          worldChunkZ: chunkZ,
          sortKey: slotDistanceSq(chunkX, chunkZ, focusX, focusZ),
        });
      }
    }
    pendingSlots.sort((a, b) => a.sortKey - b.sortKey);
    anchorChunkX = centerChunkX;
    anchorChunkZ = centerChunkZ;
    needsFullStream = false;
    roadClearanceDirty = false;
  };

  let buildInteractionActive = false;
  let roadDraftActive = false;
  let boundingSphereFrame = 0;

  const stepPendingSlots = (focusX: number, focusZ: number, firstPersonActive: boolean): void => {
    if (pendingSlots.length === 0) return;

    const steadyBudget = firstPersonActive
      ? GRASS_STREAM_SLOTS_PER_FRAME_FIRST_PERSON
      : GRASS_STREAM_SLOTS_PER_FRAME;
    const slotBudget = buildInteractionActive
      ? Math.max(2, Math.floor(steadyBudget * 0.4))
      : streamBurstPending
        ? Math.min(pendingSlots.length, GRASS_STREAM_BURST_CAP)
        : steadyBudget;
    const end = Math.min(slotBudget, pendingSlots.length);
    if (end <= 0) return;

    for (let index = 0; index < end; index++) {
      const slot = pendingSlots[index]!;
      regenerateSlot(slot.gridIndex, slot.worldChunkX, slot.worldChunkZ, focusX, focusZ);
    }
    pendingSlots.splice(0, end);
    if (streamBurstPending && pendingSlots.length === 0) {
      streamBurstPending = false;
    }
    refreshMeshCount();
    for (const entry of streamMeshes) {
      entry.mesh.instanceMatrix.needsUpdate = true;
      if (entry.mesh.instanceColor) entry.mesh.instanceColor.needsUpdate = true;
      if (entry.tintAttr) entry.tintAttr.needsUpdate = true;
      if (entry.anchorAttr) entry.anchorAttr.needsUpdate = true;
    }
    boundingSphereFrame++;
    const sphereInterval = buildInteractionActive ? 6 : firstPersonActive ? 5 : 3;
    if (boundingSphereFrame % sphereInterval === 0) {
      for (const entry of streamMeshes) entry.mesh.computeBoundingSphere();
    }
  };

  const shouldRecentreStream = (centerChunkX: number, centerChunkZ: number): boolean => {
    if (needsFullStream || roadClearanceDirty || !Number.isFinite(anchorChunkX)) return true;
    return centerChunkX !== anchorChunkX || centerChunkZ !== anchorChunkZ;
  };

  const markClearanceDirty = (): void => {
    pendingSlots = [];
    roadClearanceDirty = true;
    streamBurstPending = true;
    for (const record of slotRecords) {
      record.worldChunkX = Number.NaN;
      record.worldChunkZ = Number.NaN;
    }
  };

  return {
    group,
    syncRoadClearance(network: RoadNetwork) {
      context.roadSpatialIndex = RoadSpatialIndex.fromNetwork(network);
      markClearanceDirty();
    },
    syncPlacementClearance(polygons: Iterable<Point2[]>) {
      context.placementClearancePolygons = [...polygons].map((polygon) => [...polygon]);
      markClearanceDirty();
    },
    setBuildInteractionActive(active: boolean) {
      buildInteractionActive = active;
    },
    setRoadDraftActive(active: boolean) {
      roadDraftActive = active;
      if (active) pendingSlots = [];
    },
    updateCameraState(
      cameraPosition: THREE.Vector3,
      cameraTarget: THREE.Vector3,
      cameraDistance: number,
      firstPersonActive = false,
    ) {
      if (firstPersonActive && !wasFirstPerson) {
        needsFullStream = true;
        streamBurstPending = true;
      }
      wasFirstPerson = firstPersonActive;
      streamNearRadius = grassStreamNearRadius(firstPersonActive);

      const { grassOpacity } = resolveCloseGroundLod(cameraDistance, firstPersonActive);
      const displayOpacity = firstPersonActive ? 1 : grassBladeLodOpacity(grassOpacity);
      grassZoomVisible = displayOpacity > 0.02;

      if (
        !Number.isFinite(lastMaterialOpacity)
        || Math.abs(displayOpacity - lastMaterialOpacity) > 0.008
      ) {
        lastMaterialOpacity = displayOpacity;
        const useTransparency = displayOpacity < 0.995;
        for (const material of displayMaterials) {
          material.opacity = displayOpacity;
          if (material.transparent !== useTransparency) {
            material.transparent = useTransparency;
            material.depthWrite = !useTransparency;
            material.needsUpdate = true;
          }
        }
      }

      for (const entry of streamMeshes) entry.mesh.visible = grassZoomVisible;
      if (!grassZoomVisible) {
        pendingSlots = [];
        wasGrassVisible = false;
        streamBurstPending = false;
        return;
      }
      if (!wasGrassVisible) {
        needsFullStream = true;
        streamBurstPending = true;
      }
      wasGrassVisible = true;

      if (roadDraftActive) return;

      const focusX = firstPersonActive ? cameraPosition.x : cameraTarget.x;
      const focusZ = firstPersonActive ? cameraPosition.z : cameraTarget.z;
      const centerChunkX = Math.floor(focusX / GRASS_BLADE_CHUNK_SIZE);
      const centerChunkZ = Math.floor(focusZ / GRASS_BLADE_CHUNK_SIZE);

      if (shouldRecentreStream(centerChunkX, centerChunkZ)) {
        queueFullStream(centerChunkX, centerChunkZ, focusX, focusZ, streamNearRadius);
      }

      stepPendingSlots(focusX, focusZ, firstPersonActive);
    },
    dispose() {
      disposeResources();
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
    syncPlacementClearance() {},
    setBuildInteractionActive() {},
    setRoadDraftActive() {},
    updateCameraState() {},
    dispose() {},
  };
}

function clearSlotRange(mesh: THREE.InstancedMesh, startIndex: number, capacity: number): void {
  for (let index = 0; index < capacity; index++) {
    mesh.setMatrixAt(startIndex + index, hiddenMatrix);
  }
}

function chunkSeed(chunkX: number, chunkZ: number): number {
  return ((chunkX * 73856093) ^ (chunkZ * 19349663) ^ 0x6a55b1ade) >>> 0;
}

const writeMatrix = new THREE.Matrix4();
const writeQuaternion = new THREE.Quaternion();
const writePosition = new THREE.Vector3();
const writeScale = new THREE.Vector3();
const writeEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const writeColor = new THREE.Color();
const Y_AXIS = new THREE.Vector3(0, 1, 0);

function writeSeedThreeChunkInstances(
  streamMeshes: GrassStreamMesh[],
  startIndex: number,
  chunkX: number,
  chunkZ: number,
  context: GrassFieldContext,
  maxInstancesPerMesh = Number.POSITIVE_INFINITY,
): number[] {
  const { terrain, extent, terrainExtent, forestCores, roadSpatialIndex } = context;
  const rng = mulberry32(chunkSeed(chunkX, chunkZ));
  const chunkMinX = chunkX * GRASS_BLADE_CHUNK_SIZE;
  const chunkMinZ = chunkZ * GRASS_BLADE_CHUNK_SIZE;
  const chunkSpan = GRASS_BLADE_CHUNK_SIZE;
  const margin = chunkSpan * 0.02;
  const meshWriteIndices = streamMeshes.map(() => startIndex);
  const heightCache = new Map<number, number>();

  const heightAt = (x: number, z: number): number => {
    const key = (Math.round(x * 8) & 0xffff) | ((Math.round(z * 8) & 0xffff) << 16);
    const cached = heightCache.get(key);
    if (cached !== undefined) return cached;
    const sample = terrain.getHeightAt(x, z);
    heightCache.set(key, sample);
    return sample;
  };

  const localPlacements: { x: number; z: number; micro: boolean }[] = [];
  const tuftTarget = GRASS_TUFTS_PER_CHUNK + Math.floor(rng() * 14);

  const tryPlaceTuft = (micro: boolean): boolean => {
    if (streamMeshes.every((_, meshIndex) => meshWriteIndices[meshIndex]! - startIndex >= maxInstancesPerMesh)) {
      return false;
    }
    if (!micro && localPlacements.filter((p) => !p.micro).length >= tuftTarget) return false;

    let x: number;
    let z: number;
    if (localPlacements.length > 0 && rng() < 0.58) {
      const anchor = localPlacements[Math.floor(rng() * localPlacements.length)]!;
      const clusterRadius = micro ? 0.18 + rng() * 0.48 : 0.35 + rng() * 0.95;
      const angle = rng() * TAU;
      x = anchor.x + Math.cos(angle) * clusterRadius;
      z = anchor.z + Math.sin(angle) * clusterRadius;
    } else {
      x = chunkMinX + margin + rng() * (chunkSpan - margin * 2);
      z = chunkMinZ + margin + rng() * (chunkSpan - margin * 2);
    }

    const spacingSq = micro ? MIN_MICRO_TUFT_SPACING_SQ : MIN_TUFT_SPACING_SQ;
    for (const placed of localPlacements) {
      const dx = x - placed.x;
      const dz = z - placed.z;
      if (dx * dx + dz * dz < spacingSq) return false;
    }

    if (!isInsidePlayableExtent(x, z, extent)) return false;
    if (isGrassPlacementBlocked(x, z, context)) return false;
    if (isGrassNearAnyRoad(x, z, roadSpatialIndex)) return false;

    const variantIndex = rng() < (streamMeshes[0]?.variant?.share ?? 0.62) ? 0 : 1;
    const entry = streamMeshes[variantIndex];
    if (!entry?.variant || meshWriteIndices[variantIndex]! - startIndex >= maxInstancesPerMesh) return false;

    const density = forestDensityAt(x, z, forestCores, extent, terrainExtent);
    if (!micro) {
      if (density > 0.62 && rng() > 0.42) return false;
      if (density > 0.42 && rng() > 0.68) return false;
    } else if (density > 0.48 && rng() > 0.55) {
      return false;
    }

    localPlacements.push({ x, z, micro });

    const dry = Math.min(1, Math.max(0, (1 - density - 0.15) * 1.2)) + (rng() < 0.1 ? 0.3 : 0);
    const forestHeightMul = density > 0.38 ? THREE.MathUtils.lerp(0.78, 0.94, density) : 1;
    const heightMul =
      (micro ? THREE.MathUtils.lerp(0.42, 0.72, rng()) : THREE.MathUtils.lerp(0.55, 1.15, rng())) *
      forestHeightMul;
    const height =
      heightMul *
      THREE.MathUtils.lerp(0.9, 1.06, density) *
      entry.variant.tall;
    const widthScale = (height * THREE.MathUtils.lerp(micro ? 1.2 : 1.4, micro ? 1.6 : 2.1, rng())) / entry.variant.tall;

    const rootY = heightAt(x, z) + 0.04;
    composeSeedThreeTuftMatrix(x, z, rootY, height, widthScale, rng, writeMatrix, writeQuaternion, writePosition, writeScale);
    const instanceIndex = meshWriteIndices[variantIndex]!;
    entry.mesh.setMatrixAt(instanceIndex, writeMatrix);
    const tint = sampleSeedThreeGrassTint(rng, dry);
    entry.tintAttr?.setXYZ(instanceIndex, tint.x, tint.y, tint.z);
    entry.anchorAttr?.setXYZ(instanceIndex, x, rootY, z);
    meshWriteIndices[variantIndex] = instanceIndex + 1;
    return true;
  };

  for (let attempt = 0; attempt < GRASS_TUFT_SCATTER_ATTEMPTS; attempt++) {
    if (localPlacements.filter((p) => !p.micro).length >= tuftTarget) break;
    tryPlaceTuft(false);
  }

  const microTarget = Math.floor(tuftTarget * 0.42);
  for (let attempt = 0; attempt < GRASS_TUFT_SCATTER_ATTEMPTS && localPlacements.filter((p) => p.micro).length < microTarget; attempt++) {
    if (localPlacements.length < 3) break;
    tryPlaceTuft(true);
  }

  for (let meshIndex = 0; meshIndex < streamMeshes.length; meshIndex++) {
    const entry = streamMeshes[meshIndex]!;
    for (
      let pad = meshWriteIndices[meshIndex]!;
      pad < startIndex + maxInstancesPerMesh && Number.isFinite(maxInstancesPerMesh);
      pad++
    ) {
      entry.mesh.setMatrixAt(pad, hiddenMatrix);
    }
  }

  return meshWriteIndices.map((index) => index - startIndex);
}

function writeSeedThreeWildflowerChunkInstances(
  entry: GrassStreamMesh,
  startIndex: number,
  chunkX: number,
  chunkZ: number,
  context: GrassFieldContext,
  maxInstances: number,
): number {
  const { terrain, extent, terrainExtent, forestCores, roadSpatialIndex } = context;
  if (!entry.wildflowers || !entry.anchorAttr) return 0;

  const seed = (chunkSeed(chunkX, chunkZ) ^ 0x7f4a7c15) >>> 0;
  const rng = mulberry32(seed);
  const chunkMinX = chunkX * GRASS_BLADE_CHUNK_SIZE;
  const chunkMinZ = chunkZ * GRASS_BLADE_CHUNK_SIZE;
  const margin = GRASS_BLADE_CHUNK_SIZE * 0.08;
  const target = rng() < 0.16 ? 0 : 2 + Math.floor(rng() * 3);
  const localPlacements: Array<{ x: number; z: number }> = [];
  const paletteOffset = seed % SEEDTHREE_WILDFLOWER_VARIANTS.length;
  let instanceIndex = startIndex;

  for (let attempt = 0; attempt < target * 18 && localPlacements.length < target; attempt++) {
    let x: number;
    let z: number;
    if (localPlacements.length > 0 && rng() < 0.34) {
      const anchor = localPlacements[Math.floor(rng() * localPlacements.length)]!;
      const angle = rng() * TAU;
      const radius = THREE.MathUtils.lerp(1.9, 4.2, Math.pow(rng(), 0.7));
      x = anchor.x + Math.cos(angle) * radius;
      z = anchor.z + Math.sin(angle) * radius;
    } else {
      x = chunkMinX + margin + rng() * (GRASS_BLADE_CHUNK_SIZE - margin * 2);
      z = chunkMinZ + margin + rng() * (GRASS_BLADE_CHUNK_SIZE - margin * 2);
    }

    let tooClose = false;
    for (const placed of localPlacements) {
      const dx = x - placed.x;
      const dz = z - placed.z;
      if (dx * dx + dz * dz < MIN_WILDFLOWER_SPACING_SQ) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;
    if (!isInsidePlayableExtent(x, z, extent)) continue;
    if (isGrassPlacementBlocked(x, z, context)) continue;
    if (isGrassNearAnyRoad(x, z, roadSpatialIndex)) continue;

    const density = forestDensityAt(x, z, forestCores, extent, terrainExtent);
    const habitatChance =
      density < 0.1
        ? 0.68
        : density < 0.68
          ? 1
          : THREE.MathUtils.lerp(0.72, 0.28, THREE.MathUtils.smoothstep(density, 0.68, 1));
    if (rng() > habitatChance) continue;

    localPlacements.push({ x, z });
    const rootY = terrain.getHeightAt(x, z) + 0.045;
    const yaw = rng() * TAU;
    const leanDirection = rng() * TAU;
    const lean = THREE.MathUtils.lerp(0.015, 0.085, rng());
    writeEuler.set(Math.cos(leanDirection) * lean, yaw, Math.sin(leanDirection) * lean, 'YXZ');
    writeQuaternion.setFromEuler(writeEuler);
    writePosition.set(x, rootY, z);
    const placementVariant =
      (paletteOffset + localPlacements.length - 1) % SEEDTHREE_WILDFLOWER_VARIANTS.length;
    const variant = SEEDTHREE_WILDFLOWER_VARIANTS[placementVariant]!;
    const heightScale =
      THREE.MathUtils.lerp(variant.heightScale[0], variant.heightScale[1], Math.pow(rng(), 0.68))
      * THREE.MathUtils.lerp(1, 0.9, density);
    const widthScale = THREE.MathUtils.lerp(
      variant.widthScale[0],
      variant.widthScale[1],
      rng(),
    );
    writeScale.set(widthScale, heightScale, widthScale);
    writeMatrix.compose(writePosition, writeQuaternion, writeScale);

    if (instanceIndex < startIndex + maxInstances) {
      entry.mesh.setMatrixAt(instanceIndex, writeMatrix);
      entry.anchorAttr.setXYZW(
        instanceIndex,
        x,
        rootY,
        z,
        variant.atlasOffset[0],
      );
      instanceIndex++;
    }
  }

  for (let pad = instanceIndex; pad < startIndex + maxInstances; pad++) {
    entry.mesh.setMatrixAt(pad, hiddenMatrix);
  }
  return instanceIndex - startIndex;
}

function composeSeedThreeTuftMatrix(
  x: number,
  z: number,
  rootY: number,
  height: number,
  widthScale: number,
  rng: () => number,
  matrix: THREE.Matrix4,
  quaternion: THREE.Quaternion,
  position: THREE.Vector3,
  scaleVector: THREE.Vector3,
): void {
  const yaw = rng() * TAU;
  quaternion.setFromAxisAngle(Y_AXIS, yaw);
  position.set(x, rootY, z);
  scaleVector.set(widthScale, height, widthScale);
  matrix.compose(position, quaternion, scaleVector);
}

function writeChunkInstances(
  mesh: THREE.InstancedMesh,
  startIndex: number,
  chunkX: number,
  chunkZ: number,
  context: GrassFieldContext,
  maxInstances = Number.POSITIVE_INFINITY,
): number {
  const { terrain, extent, terrainExtent, forestCores, roadSpatialIndex } = context;
  const rng = mulberry32(chunkSeed(chunkX, chunkZ));
  const chunkMinX = chunkX * GRASS_BLADE_CHUNK_SIZE;
  const chunkMinZ = chunkZ * GRASS_BLADE_CHUNK_SIZE;
  const chunkSpan = GRASS_BLADE_CHUNK_SIZE;
  const margin = chunkSpan * 0.06;
  let instanceIndex = startIndex;
  const heightCache = new Map<number, number>();

  const heightAt = (x: number, z: number): number => {
    const key = (Math.round(x * 8) & 0xffff) | ((Math.round(z * 8) & 0xffff) << 16);
    const cached = heightCache.get(key);
    if (cached !== undefined) return cached;
    const sample = terrain.getHeightAt(x, z);
    heightCache.set(key, sample);
    return sample;
  };

  const localPlacements: { x: number; z: number; micro: boolean }[] = [];
  const tuftTarget = GRASS_TUFTS_PER_CHUNK + Math.floor(rng() * 9);

  for (let attempt = 0; attempt < GRASS_TUFT_SCATTER_ATTEMPTS && localPlacements.length < tuftTarget; attempt++) {
    if (instanceIndex - startIndex >= maxInstances) break;
    const micro = rng() < 0.42 && localPlacements.length > 2;
    let x: number;
    let z: number;

    if (localPlacements.length > 0 && rng() < 0.42) {
      const anchor = localPlacements[Math.floor(rng() * localPlacements.length)]!;
      const clusterRadius = micro ? 0.22 + rng() * 0.55 : 0.45 + rng() * 1.15;
      const angle = rng() * TAU;
      x = anchor.x + Math.cos(angle) * clusterRadius;
      z = anchor.z + Math.sin(angle) * clusterRadius;
    } else {
      x = chunkMinX + margin + rng() * (chunkSpan - margin * 2);
      z = chunkMinZ + margin + rng() * (chunkSpan - margin * 2);
    }

    const spacingSq = micro ? MIN_MICRO_TUFT_SPACING_SQ : MIN_TUFT_SPACING_SQ;
    let tooClose = false;
    for (const placed of localPlacements) {
      const dx = x - placed.x;
      const dz = z - placed.z;
      if (dx * dx + dz * dz < spacingSq) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;

    if (!isInsidePlayableExtent(x, z, extent)) continue;
    if (isGrassPlacementBlocked(x, z, context)) continue;
    if (isGrassNearAnyRoad(x, z, roadSpatialIndex)) continue;

    localPlacements.push({ x, z, micro });

    const density = forestDensityAt(x, z, forestCores, extent, terrainExtent);
    const sizeRoll = Math.pow(rng(), micro ? 1.1 : 0.72);
    const scale =
      THREE.MathUtils.lerp(micro ? 0.58 : 0.88, micro ? 0.92 : 1.32, sizeRoll) *
      THREE.MathUtils.lerp(0.9, 1.06, density);

    composeTuftMatrix(
      x,
      z,
      scale,
      rng,
      heightAt,
      writeMatrix,
      writeQuaternion,
      writePosition,
      writeScale,
      writeEuler,
    );
    mesh.setMatrixAt(instanceIndex, writeMatrix);
    writeColor.setHSL(
      0.27 + (rng() - 0.5) * 0.035,
      0.38 + rng() * 0.1,
      0.3 + rng() * 0.08,
    );
    mesh.setColorAt(instanceIndex, writeColor);
    instanceIndex++;
  }

  for (let pad = instanceIndex; pad < startIndex + maxInstances && Number.isFinite(maxInstances); pad++) {
    mesh.setMatrixAt(pad, hiddenMatrix);
  }

  return instanceIndex;
}

function composeTuftMatrix(
  x: number,
  z: number,
  scale: number,
  rng: () => number,
  heightAt: (x: number, z: number) => number,
  matrix: THREE.Matrix4,
  quaternion: THREE.Quaternion,
  position: THREE.Vector3,
  scaleVector: THREE.Vector3,
  euler: THREE.Euler,
): void {
  const yaw = rng() * TAU;
  const leanDir = rng() * TAU;
  const leanAmount = THREE.MathUtils.lerp(0.14, 0.42, Math.pow(rng(), 0.65));
  const tiltX = Math.cos(leanDir) * leanAmount;
  const tiltZ = Math.sin(leanDir) * leanAmount * 0.75;
  const roll = (rng() - 0.5) * 0.22;

  position.set(x, heightAt(x, z) + 0.04, z);
  euler.set(tiltX, yaw, tiltZ + roll);
  quaternion.setFromEuler(euler);
  const widthScale = scale * THREE.MathUtils.lerp(0.92, 1.14, rng());
  const heightScale = scale * THREE.MathUtils.lerp(0.96, 1.18, rng());
  scaleVector.set(widthScale, heightScale, widthScale);
  matrix.compose(position, quaternion, scaleVector);
}

function applyGrassDepthOffset(material: THREE.Material): void {
  material.polygonOffset = true;
  material.polygonOffsetFactor = -2;
  material.polygonOffsetUnits = -2;
}

function createGrassBladeMaterial(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  material.name = 'Grass blade';
  material.side = THREE.DoubleSide;
  material.transparent = true;
  material.opacity = 1;
  material.alphaTest = 0.15;
  material.depthWrite = true;
  material.roughness = 0.92;
  material.metalness = 0;
  material.color.set(0xffffff);
  material.colorNode = (vertexColor() as TslNode).rgb;
  applyFoliageDoubleSideNormalsNode(material);
  return material;
}

function isGrassPlacementBlocked(x: number, z: number, context: GrassFieldContext): boolean {
  if (context.isBlockedAt?.(x, z)) return true;
  return context.placementClearancePolygons.some((polygon) => isPointInPolygon2({ x, z }, polygon));
}

function isGrassNearAnyRoad(x: number, z: number, index: RoadSpatialIndex | null): boolean {
  if (!index) return false;
  return index.isNearAnyRoad(x, z, ROAD_CLEAR_MARGIN);
}

function createGrassTuftGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const bladeCount = GRASS_BLADES_PER_TUFT;
  for (let i = 0; i < bladeCount; i++) {
    const spread = (i / bladeCount) * TAU + (rngHash(i) - 0.5) * 0.55;
    const yaw = spread + (i % 2 === 0 ? 0.2 : -0.16);
    const height = 0.48 + (i % 4) * 0.1 + (i % 3) * 0.055;
    const halfWidth = 0.02 + (i % 2) * 0.007;
    const lean = 0.06 + (i % 3) * 0.035 + (i % 2) * 0.02;
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

function rngHash(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
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
