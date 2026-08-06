import * as THREE from 'three';
import {
  createSeedThreeGrassMaterial,
  createSeedThreeTuftVariants,
  disposeSeedThreeGrassTextureCache,
  loadSeedThreeGrassTextures,
  sampleSeedThreeGrassTint,
  type SeedThreeTuftVariant,
} from '../vegetation/seedthree/seedThreeGrass.ts';
import type { RendererBackendKind } from '../scene/RendererBackend.ts';
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
  GRASS_BLADE_VISIBILITY_ENTER_OPACITY,
  GRASS_BLADE_VISIBILITY_EXIT_OPACITY,
  GRASS_STREAM_CHUNK_RADIUS,
  GRASS_TUFT_SCATTER_ATTEMPTS,
  GRASS_TUFTS_PER_CHUNK,
  grassBladeLodOpacity,
  grassStreamNearRadius,
  resolveCloseGroundLod,
} from './grassLodMath.ts';
import {
  coalesceStreamSlotRequests,
  resolveStreamVisibilityHysteresis,
  runStreamSlotUpdateChunk,
} from '@seedthree/core/stream-slot-budget.js';
import { applyGroundCoverShadowPolicy } from '@seedthree/core/ground-cover-shadows.js';
import {
  resolveGrassStreamSlotIndex,
  resolveGrassStreamViewTransition,
} from './grassStreamLifecycle.ts';
import {
  planGroundcoverAttributeUpdateRanges,
  resolveGroundcoverSlotRewrite,
  type GroundcoverSlotUpdate,
} from './groundcoverSlotUpdates.ts';

export const GRASS_BLADES_ENABLED = true;

export type GrassBladeField = {
  group: THREE.Group;
  getStreamTelemetry: (target?: GrassStreamTelemetry) => GrassStreamTelemetry;
  isStreamSettled: () => boolean;
  primeAndFreezeStream: (
    cameraPosition: THREE.Vector3,
    cameraTarget: THREE.Vector3,
    cameraDistance: number,
    firstPersonActive?: boolean,
  ) => void;
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

export type GrassStreamTelemetry = {
  mode: 'active' | 'priming-frozen' | 'frozen';
  maxUpdateDurationBudgetMs: number;
  updates: number;
  generationSubsteps: number;
  generationDurationMs: number;
  clearWriteSubsteps: number;
  clearWriteDurationMs: number;
  refreshCount: number;
  refreshDurationMs: number;
  gpuFlagUpdates: number;
  gpuUpdateRanges: number;
  bytesUploaded: number;
  boundsScans: number;
  completedSlots: number;
  cancelledSlots: number;
  pendingSlots: number;
  maxPendingSlots: number;
  lastUpdateDurationMs: number;
  maxUpdateDurationMs: number;
  converged: boolean;
};

const ROAD_CLEAR_MARGIN = 1.05;
const TAU = Math.PI * 2;
const GRID_SIDE = GRASS_STREAM_CHUNK_RADIUS * 2 + 1;
const GRASS_SLOT_CAPACITY = GRASS_TUFTS_PER_CHUNK + 14;
const WILDFLOWER_SLOT_CAPACITY = 8;
const MAX_GRASS_STREAM_INSTANCES = GRID_SIDE * GRID_SIDE * GRASS_SLOT_CAPACITY;
const MAX_WILDFLOWER_STREAM_INSTANCES = GRID_SIDE * GRID_SIDE * WILDFLOWER_SLOT_CAPACITY;
const MIN_TUFT_SPACING_SQ = 0.26 * 0.26;
const MIN_MICRO_TUFT_SPACING_SQ = 0.16 * 0.16;
const MIN_WILDFLOWER_SPACING_SQ = 0.62 * 0.62;
/** Park culled tufts far below the world — zero-scale at origin alpha-tests into a visible orb. */
const HIDDEN_INSTANCE_Y = -4096;
const hiddenMatrix = new THREE.Matrix4().compose(
  new THREE.Vector3(0, HIDDEN_INSTANCE_Y, 0),
  new THREE.Quaternion(),
  new THREE.Vector3(0.001, 0.001, 0.001),
);

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
  slotIndex: number;
  worldChunkX: number;
  worldChunkZ: number;
  sortKey: number;
};

type SlotRecord = {
  worldChunkX: number;
  worldChunkZ: number;
  meshCounts: number[];
};

type GeneratedGrassInstance = {
  matrix: THREE.Matrix4;
  tint: readonly [number, number, number];
  anchor: readonly [number, number, number];
};

type GeneratedWildflowerInstance = {
  matrix: THREE.Matrix4;
  anchor: readonly [number, number, number, number];
};

type GrassSlotGenerationJob = {
  request: PendingSlot;
  phase: 'generate' | 'commit';
  generationIterator: Generator<
    number,
    Array<GeneratedGrassInstance[] | GeneratedWildflowerInstance[]>,
    void
  >;
  generatedByMesh: Array<GeneratedGrassInstance[] | GeneratedWildflowerInstance[]>;
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
  maxAnisotropy?: number;
  rendererBackend?: RendererBackendKind;
  lodFadeMode?: GrassBladeLodFadeMode;
};

export type GrassBladeLodFadeMode =
  | 'continuous-alpha-coverage'
  | 'continuous-alpha-hash'
  | 'legacy-pipeline-cutover';

const GRASS_STREAM_UPDATE_BUDGET_MS = 2;
const GRASS_STREAM_MINIMUM_HEADROOM_MS = 0.2;
const GRASS_STREAM_MAX_SUBSTEPS = 8;

export async function createGrassBladeField(
  terrain: Terrain,
  options?: GrassBladeFieldOptions,
): Promise<GrassBladeField> {
  if (!GRASS_BLADES_ENABLED) {
    return createDisabledGrassBladeField();
  }

  const spawnConfig = createForestSpawnConfig(terrain.generationSize, terrain.size);
  const context: GrassFieldContext = {
    terrain,
    extent: spawnConfig.extent,
    terrainExtent: spawnConfig.terrainExtent,
    forestCores: createForestCores(mulberry32(0x6a55b1ade), spawnConfig),
    isBlockedAt: options?.isBlockedAt,
    placementClearancePolygons: [],
    roadSpatialIndex: null,
  };

  let streamMeshes: GrassStreamMesh[];
  let displayMaterials: THREE.Material[];
  let disposeResources: () => void;

  const [textures, wildflowerAtlas] = await Promise.all([
    loadSeedThreeGrassTextures(options?.maxAnisotropy ?? 4),
    loadSeedThreeWildflowerAtlas(options?.maxAnisotropy ?? 4),
  ]);
  const variants = createSeedThreeTuftVariants();
  const grassMaterial = createSeedThreeGrassMaterial(
    textures,
    options?.rendererBackend ?? 'webgpu',
  );
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
    applyGroundCoverShadowPolicy(mesh, { terrainReceivesShadow: true });
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    mesh.visible = false;
    mesh.userData.texturePath =
      '/assets/textures/vegetation/grass/close-meadow-tuft.png';
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
  applyGroundCoverShadowPolicy(wildflowerMesh, {
    terrainReceivesShadow: true,
  });
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

  const group = new THREE.Group();
  group.name = 'SeedThree grass field';
  for (const entry of streamMeshes) group.add(entry.mesh);
  group.userData.groundcoverSubmission = 'three-whole-field-instanced-meshes';
  const lodFadeMode =
    options?.lodFadeMode ?? 'continuous-alpha-coverage';
  group.userData.lodFadeMode = lodFadeMode;
  if (lodFadeMode === 'continuous-alpha-coverage') {
    // The renderer is created with 4x MSAA. Feeding the authored texture alpha
    // into its sample mask softens sub-pixel blade edges without a screen-space
    // dither pattern, so wind and close camera motion cannot make the cutout
    // sparkle from one frame to the next.
    for (const material of displayMaterials) {
      material.alphaTest = 0;
      material.alphaHash = false;
      material.alphaToCoverage = true;
      material.transparent = false;
      material.depthWrite = true;
      material.needsUpdate = true;
    }
  } else if (lodFadeMode === 'continuous-alpha-hash') {
    // A stable alpha-hash pipeline turns opacity into spatially stable
    // coverage. The previous transparent -> opaque switch at 0.995 opacity
    // changed the entire meadow in one frame even though the numeric LOD gate
    // itself was continuous.
    for (const material of displayMaterials) {
      // Alpha hash replaces the binary card cutout as well as blending. Leaving
      // alphaTest enabled would suppress the first 28% of the opacity ramp
      // before the hashed coverage had a chance to resolve it.
      material.alphaTest = 0;
      material.alphaHash = true;
      material.alphaToCoverage = false;
      material.transparent = false;
      material.depthWrite = true;
      material.needsUpdate = true;
    }
  }

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
  let streamNearRadius = GRASS_BLADE_NEAR_RADIUS;
  let activeSlotJob: GrassSlotGenerationJob | null = null;
  let frozenPrime: {
    cameraPosition: THREE.Vector3;
    cameraTarget: THREE.Vector3;
    cameraDistance: number;
    firstPersonActive: boolean;
  } | null = null;
  const streamTelemetry: GrassStreamTelemetry = {
    mode: 'active',
    maxUpdateDurationBudgetMs: GRASS_STREAM_UPDATE_BUDGET_MS,
    updates: 0,
    generationSubsteps: 0,
    generationDurationMs: 0,
    clearWriteSubsteps: 0,
    clearWriteDurationMs: 0,
    refreshCount: 0,
    refreshDurationMs: 0,
    gpuFlagUpdates: 0,
    gpuUpdateRanges: 0,
    bytesUploaded: 0,
    boundsScans: 0,
    completedSlots: 0,
    cancelledSlots: 0,
    pendingSlots: 0,
    maxPendingSlots: 0,
    lastUpdateDurationMs: 0,
    maxUpdateDurationMs: 0,
    converged: false,
  };

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

  const commitSlot = (job: GrassSlotGenerationJob): {
    cleared: number;
    written: number;
    update: GroundcoverSlotUpdate;
  } => {
    const { slotIndex, worldChunkX, worldChunkZ } = job.request;
    const record = slotRecords[slotIndex]!;
    const initialized = Number.isFinite(record.worldChunkX)
      && Number.isFinite(record.worldChunkZ);
    let cleared = 0;
    let written = 0;
    const dirtyInstanceCounts = Array.from(
      { length: streamMeshes.length },
      () => 0,
    );
    for (let meshIndex = 0; meshIndex < streamMeshes.length; meshIndex++) {
      const entry = streamMeshes[meshIndex]!;
      const startIndex = slotIndex * entry.slotCapacity;
      const generated = job.generatedByMesh[meshIndex] ?? [];
      const rewrite = resolveGroundcoverSlotRewrite(
        initialized,
        record.meshCounts[meshIndex] ?? 0,
        generated.length,
        entry.slotCapacity,
      );
      clearSlotRange(
        entry.mesh,
        startIndex + rewrite.clearStart,
        rewrite.clearCount,
      );
      cleared += rewrite.clearCount;
      for (let index = 0; index < generated.length; index++) {
        const instance = generated[index]!;
        const instanceIndex = startIndex + index;
        entry.mesh.setMatrixAt(instanceIndex, instance.matrix);
        if (entry.variant) {
          const grass = instance as GeneratedGrassInstance;
          entry.tintAttr?.setXYZ(instanceIndex, ...grass.tint);
          writeColor.setRGB(...grass.tint);
          entry.mesh.setColorAt(instanceIndex, writeColor);
          entry.anchorAttr?.setXYZ(instanceIndex, ...grass.anchor);
        } else if (entry.wildflowers) {
          const wildflower = instance as GeneratedWildflowerInstance;
          entry.anchorAttr?.setXYZW(instanceIndex, ...wildflower.anchor);
        }
        written += 1;
      }
      record.meshCounts[meshIndex] = generated.length;
      dirtyInstanceCounts[meshIndex] = rewrite.dirtyInstanceCount;
    }
    record.worldChunkX = worldChunkX;
    record.worldChunkZ = worldChunkZ;
    return {
      cleared,
      written,
      update: { slotIndex, dirtyInstanceCounts },
    };
  };

  const queueFullStream = (
    centerChunkX: number,
    centerChunkZ: number,
    focusX: number,
    focusZ: number,
    nearRadius: number,
  ): void => {
    const newestRequests: PendingSlot[] = [];
    for (let localZ = 0; localZ < GRID_SIDE; localZ++) {
      for (let localX = 0; localX < GRID_SIDE; localX++) {
        const { chunkX, chunkZ } = worldChunkAt(centerChunkX, centerChunkZ, localX, localZ);
        if (!chunkInStreamRange(chunkX, chunkZ, focusX, focusZ, nearRadius)) continue;
        const gridIdx = resolveGrassStreamSlotIndex(chunkX, chunkZ, GRID_SIDE);
        const existing = slotRecords[gridIdx]!;
        if (existing.worldChunkX === chunkX && existing.worldChunkZ === chunkZ) continue;
        newestRequests.push({
          slotIndex: gridIdx,
          worldChunkX: chunkX,
          worldChunkZ: chunkZ,
          sortKey: slotDistanceSq(chunkX, chunkZ, focusX, focusZ),
        });
      }
    }
    const coalesced = coalesceStreamSlotRequests(pendingSlots, newestRequests);
    pendingSlots = coalesced.pending;
    streamTelemetry.cancelledSlots += coalesced.cancelledSlotIndices.length;
    if (
      activeSlotJob
      && (
        coalesced.cancelledSlotIndices.includes(activeSlotJob.request.slotIndex)
        || !samePendingSlot(
          activeSlotJob.request,
          pendingSlots.find(
            (request) => request.slotIndex === activeSlotJob!.request.slotIndex,
          ),
        )
      )
    ) {
      activeSlotJob = null;
    }
    anchorChunkX = centerChunkX;
    anchorChunkZ = centerChunkZ;
    needsFullStream = false;
    roadClearanceDirty = false;
  };

  let buildInteractionActive = false;
  let roadDraftActive = false;
  const stepPendingSlots = (): void => {
    const updateStartedAt = performance.now();
    const changedSlots: GroundcoverSlotUpdate[] = [];
    const result = runStreamSlotUpdateChunk(pendingSlots, {
      maxDurationMs: GRASS_STREAM_UPDATE_BUDGET_MS,
      minimumHeadroomMs: GRASS_STREAM_MINIMUM_HEADROOM_MS,
      maxSubsteps: buildInteractionActive ? 2 : GRASS_STREAM_MAX_SUBSTEPS,
      now: () => performance.now(),
      applySubstep: (request, budget) => {
        if (!activeSlotJob || !samePendingSlot(activeSlotJob.request, request)) {
          activeSlotJob = {
            request: { ...request },
            phase: 'generate',
            generationIterator: generateSeedThreeSlotInstances(
              streamMeshes,
              request,
              context,
            ),
            generatedByMesh: [],
          };
        }
        if (activeSlotJob.phase === 'generate') {
          const startedAt = performance.now();
          let generated = 0;
          while (
            performance.now()
            < budget.deadlineMs - GRASS_STREAM_MINIMUM_HEADROOM_MS
          ) {
            const step = activeSlotJob.generationIterator.next();
            if (step.done) {
              activeSlotJob.generatedByMesh = step.value;
              activeSlotJob.phase = 'commit';
              break;
            }
            generated += step.value;
          }
          const durationMs = performance.now() - startedAt;
          streamTelemetry.generationSubsteps += 1;
          streamTelemetry.generationDurationMs += durationMs;
          return { completed: false, generated };
        }
        const startedAt = performance.now();
        const committed = commitSlot(activeSlotJob);
        const durationMs = performance.now() - startedAt;
        streamTelemetry.clearWriteSubsteps += 1;
        streamTelemetry.clearWriteDurationMs += durationMs;
        changedSlots.push(committed.update);
        activeSlotJob = null;
        return {
          completed: true,
          cleared: committed.cleared,
          written: committed.written,
        };
      },
    });
    pendingSlots = result.pending;
    if (changedSlots.length > 0) {
      const refreshStartedAt = performance.now();
      refreshMeshCount();
      streamTelemetry.refreshCount += 1;
      streamTelemetry.refreshDurationMs += performance.now() - refreshStartedAt;
      applyStreamMeshUpdateRanges(
        streamMeshes,
        changedSlots,
        streamTelemetry,
      );
    }
    const durationMs = performance.now() - updateStartedAt;
    streamTelemetry.updates += 1;
    streamTelemetry.completedSlots += result.completedSlotIndices.length;
    // An in-progress job remains at the head of `pendingSlots` until commit.
    streamTelemetry.pendingSlots = pendingSlots.length;
    streamTelemetry.maxPendingSlots = Math.max(
      streamTelemetry.maxPendingSlots,
      streamTelemetry.pendingSlots,
    );
    streamTelemetry.lastUpdateDurationMs = durationMs;
    streamTelemetry.maxUpdateDurationMs = Math.max(
      streamTelemetry.maxUpdateDurationMs,
      durationMs,
    );
    streamTelemetry.converged =
      streamTelemetry.pendingSlots === 0 && !needsFullStream;
    if (
      streamTelemetry.mode === 'priming-frozen'
      && streamTelemetry.converged
    ) {
      streamTelemetry.mode = 'frozen';
      frozenPrime = null;
    }
  };

  const shouldRecentreStream = (centerChunkX: number, centerChunkZ: number): boolean => {
    if (needsFullStream || roadClearanceDirty || !Number.isFinite(anchorChunkX)) return true;
    return centerChunkX !== anchorChunkX || centerChunkZ !== anchorChunkZ;
  };

  const markClearanceDirty = (): void => {
    pendingSlots = [];
    activeSlotJob = null;
    roadClearanceDirty = true;
    streamTelemetry.converged = false;
    for (const record of slotRecords) {
      record.worldChunkX = Number.NaN;
      record.worldChunkZ = Number.NaN;
    }
  };

  return {
    group,
    getStreamTelemetry(target) {
      if (!target) return { ...streamTelemetry };
      Object.assign(target, streamTelemetry);
      return target;
    },
    isStreamSettled() {
      return streamTelemetry.converged && streamTelemetry.mode !== 'priming-frozen';
    },
    primeAndFreezeStream(
      cameraPosition: THREE.Vector3,
      cameraTarget: THREE.Vector3,
      cameraDistance: number,
      firstPersonActive = false,
    ) {
      frozenPrime = {
        cameraPosition: cameraPosition.clone(),
        cameraTarget: cameraTarget.clone(),
        cameraDistance,
        firstPersonActive,
      };
      streamTelemetry.mode = 'priming-frozen';
      streamTelemetry.converged = false;
      pendingSlots = [];
      activeSlotJob = null;
      needsFullStream = true;
    },
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
      if (roadDraftActive === active) return;
      roadDraftActive = active;
      if (active && streamTelemetry.mode !== 'frozen') {
        pendingSlots = [];
        activeSlotJob = null;
        streamTelemetry.pendingSlots = 0;
        streamTelemetry.converged = false;
      }
    },
    updateCameraState(
      cameraPosition: THREE.Vector3,
      cameraTarget: THREE.Vector3,
      cameraDistance: number,
      firstPersonActive = false,
    ) {
      const streamCameraPosition = frozenPrime?.cameraPosition ?? cameraPosition;
      const streamCameraTarget = frozenPrime?.cameraTarget ?? cameraTarget;
      const streamFirstPerson = frozenPrime?.firstPersonActive ?? firstPersonActive;
      const previousFirstPerson = wasFirstPerson;
      wasFirstPerson = streamFirstPerson;
      streamNearRadius = grassStreamNearRadius(streamFirstPerson);

      const { grassOpacity } = resolveCloseGroundLod(cameraDistance, firstPersonActive);
      const displayOpacity = firstPersonActive ? 1 : grassBladeLodOpacity(grassOpacity);
      grassZoomVisible = resolveStreamVisibilityHysteresis(
        grassZoomVisible,
        displayOpacity,
        GRASS_BLADE_VISIBILITY_ENTER_OPACITY,
        GRASS_BLADE_VISIBILITY_EXIT_OPACITY,
      );
      group.userData.lodFadeOpacity = displayOpacity;
      group.userData.lodFadeVisible = grassZoomVisible;

      if (
        !Number.isFinite(lastMaterialOpacity)
        || Math.abs(displayOpacity - lastMaterialOpacity) > 0.008
      ) {
        lastMaterialOpacity = displayOpacity;
        for (const material of displayMaterials) {
          material.opacity = displayOpacity;
          if (lodFadeMode === 'legacy-pipeline-cutover') {
            const useTransparency = displayOpacity < 0.995;
            if (material.transparent !== useTransparency) {
              material.transparent = useTransparency;
              material.depthWrite = !useTransparency;
              material.needsUpdate = true;
            }
          }
        }
      }

      for (const entry of streamMeshes) entry.mesh.visible = grassZoomVisible;
      const settledViewTransition = resolveGrassStreamViewTransition({
        mode: streamTelemetry.mode,
        firstPersonActive: streamFirstPerson,
        wasFirstPersonActive: previousFirstPerson,
        grassVisible: grassZoomVisible,
        hasFrozenPrime: frozenPrime !== null,
      });
      if (settledViewTransition.invalidateForFirstPersonEntry) {
        needsFullStream = true;
        streamTelemetry.converged = false;
      }
      if (settledViewTransition.preserveFrozenState) {
        wasGrassVisible = grassZoomVisible;
        return;
      }
      if (settledViewTransition.clearInactiveStream) {
        pendingSlots = [];
        activeSlotJob = null;
        streamTelemetry.pendingSlots = 0;
        streamTelemetry.converged = false;
        wasGrassVisible = false;
        return;
      }
      if (grassZoomVisible && !wasGrassVisible && streamTelemetry.mode === 'active') {
        needsFullStream = true;
        streamTelemetry.converged = false;
      }
      wasGrassVisible = grassZoomVisible;

      if (roadDraftActive) return;

      const focusX = streamFirstPerson ? streamCameraPosition.x : streamCameraTarget.x;
      const focusZ = streamFirstPerson ? streamCameraPosition.z : streamCameraTarget.z;
      const centerChunkX = Math.floor(focusX / GRASS_BLADE_CHUNK_SIZE);
      const centerChunkZ = Math.floor(focusZ / GRASS_BLADE_CHUNK_SIZE);

      if (shouldRecentreStream(centerChunkX, centerChunkZ)) {
        queueFullStream(centerChunkX, centerChunkZ, focusX, focusZ, streamNearRadius);
      }

      stepPendingSlots();
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
  const telemetry: GrassStreamTelemetry = {
    mode: 'frozen',
    maxUpdateDurationBudgetMs: GRASS_STREAM_UPDATE_BUDGET_MS,
    updates: 0,
    generationSubsteps: 0,
    generationDurationMs: 0,
    clearWriteSubsteps: 0,
    clearWriteDurationMs: 0,
    refreshCount: 0,
    refreshDurationMs: 0,
    gpuFlagUpdates: 0,
    gpuUpdateRanges: 0,
    bytesUploaded: 0,
    boundsScans: 0,
    completedSlots: 0,
    cancelledSlots: 0,
    pendingSlots: 0,
    maxPendingSlots: 0,
    lastUpdateDurationMs: 0,
    maxUpdateDurationMs: 0,
    converged: true,
  };
  return {
    group,
    getStreamTelemetry(target) {
      if (!target) return { ...telemetry };
      Object.assign(target, telemetry);
      return target;
    },
    isStreamSettled() {
      return true;
    },
    primeAndFreezeStream() {},
    syncRoadClearance() {},
    syncPlacementClearance() {},
    setBuildInteractionActive() {},
    setRoadDraftActive() {},
    updateCameraState() {},
    dispose() {},
  };
}

function samePendingSlot(
  left: PendingSlot | null | undefined,
  right: PendingSlot | null | undefined,
): boolean {
  return !!left
    && !!right
    && left.slotIndex === right.slotIndex
    && left.worldChunkX === right.worldChunkX
    && left.worldChunkZ === right.worldChunkZ;
}

function applyStreamMeshUpdateRanges(
  streamMeshes: GrassStreamMesh[],
  changedSlots: readonly GroundcoverSlotUpdate[],
  telemetry: GrassStreamTelemetry,
): void {
  for (let meshIndex = 0; meshIndex < streamMeshes.length; meshIndex++) {
    const entry = streamMeshes[meshIndex]!;
    const attributes = [
      entry.mesh.instanceMatrix,
      entry.mesh.instanceColor,
      entry.tintAttr,
      entry.anchorAttr,
    ].filter((attribute): attribute is THREE.InstancedBufferAttribute => !!attribute);
    for (const attribute of attributes) {
      const bytesPerElement = attribute.array.BYTES_PER_ELEMENT;
      const plan = planGroundcoverAttributeUpdateRanges(
        changedSlots,
        meshIndex,
        entry.slotCapacity,
        attribute.itemSize,
        bytesPerElement,
      );
      if (plan.componentCount === 0) continue;
      attribute.clearUpdateRanges();
      for (const range of plan.ranges) {
        attribute.addUpdateRange(range.start, range.count);
      }
      attribute.needsUpdate = true;
      telemetry.gpuFlagUpdates += 1;
      telemetry.gpuUpdateRanges += plan.ranges.length;
      telemetry.bytesUploaded += plan.byteCount;
    }
  }
}

function clearSlotRange(mesh: THREE.InstancedMesh, startIndex: number, capacity: number): void {
  if (capacity <= 0) return;
  (mesh.instanceMatrix.array as Float32Array).set(
    hiddenMatrixBlock(capacity),
    startIndex * 16,
  );
}

const hiddenMatrixBlocks = new Map<number, Float32Array>();

function hiddenMatrixBlock(count: number): Float32Array {
  let block = hiddenMatrixBlocks.get(count);
  if (block) return block;
  block = new Float32Array(count * 16);
  for (let index = 0; index < count; index++) {
    block.set(hiddenMatrix.elements, index * 16);
  }
  hiddenMatrixBlocks.set(count, block);
  return block;
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

function* generateSeedThreeSlotInstances(
  streamMeshes: GrassStreamMesh[],
  request: PendingSlot,
  context: GrassFieldContext,
): Generator<
  number,
  Array<GeneratedGrassInstance[] | GeneratedWildflowerInstance[]>,
  void
> {
  const grassEntries = streamMeshes.filter((entry) => entry.variant);
  const grassInstances = yield* generateSeedThreeChunkInstances(
    grassEntries,
    request.worldChunkX,
    request.worldChunkZ,
    context,
    GRASS_SLOT_CAPACITY,
  );
  let grassCountIndex = 0;
  const generatedByMesh: Array<
    GeneratedGrassInstance[] | GeneratedWildflowerInstance[]
  > = [];
  for (const entry of streamMeshes) {
    if (entry.variant) {
      generatedByMesh.push(grassInstances[grassCountIndex++] ?? []);
    } else if (entry.wildflowers) {
      generatedByMesh.push(yield* generateSeedThreeWildflowerChunkInstances(
        entry,
        request.worldChunkX,
        request.worldChunkZ,
        context,
        entry.slotCapacity,
      ));
    } else {
      generatedByMesh.push([]);
    }
  }
  return generatedByMesh;
}

function* generateSeedThreeChunkInstances(
  streamMeshes: GrassStreamMesh[],
  chunkX: number,
  chunkZ: number,
  context: GrassFieldContext,
  maxInstancesPerMesh = Number.POSITIVE_INFINITY,
): Generator<number, GeneratedGrassInstance[][], void> {
  const { terrain, extent, terrainExtent, forestCores, roadSpatialIndex } = context;
  const rng = mulberry32(chunkSeed(chunkX, chunkZ));
  const chunkMinX = chunkX * GRASS_BLADE_CHUNK_SIZE;
  const chunkMinZ = chunkZ * GRASS_BLADE_CHUNK_SIZE;
  const chunkSpan = GRASS_BLADE_CHUNK_SIZE;
  const margin = chunkSpan * 0.02;
  const instancesByMesh = streamMeshes.map(() => [] as GeneratedGrassInstance[]);
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
  let standardPlacementCount = 0;
  let microPlacementCount = 0;
  const tuftTarget = GRASS_TUFTS_PER_CHUNK + Math.floor(rng() * 14);

  const tryPlaceTuft = (micro: boolean): boolean => {
    if (instancesByMesh.every((instances) => instances.length >= maxInstancesPerMesh)) {
      return false;
    }
    if (!micro && standardPlacementCount >= tuftTarget) return false;

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
    if (!entry?.variant || instancesByMesh[variantIndex]!.length >= maxInstancesPerMesh) return false;

    const density = forestDensityAt(x, z, forestCores, extent, terrainExtent);
    if (!micro) {
      if (density > 0.62 && rng() > 0.42) return false;
      if (density > 0.42 && rng() > 0.68) return false;
    } else if (density > 0.48 && rng() > 0.55) {
      return false;
    }

    localPlacements.push({ x, z, micro });
    if (micro) microPlacementCount += 1;
    else standardPlacementCount += 1;

    const dry = Math.min(1, Math.max(0, (1 - density - 0.15) * 1.2)) + (rng() < 0.1 ? 0.3 : 0);
    const forestHeightMul = density > 0.38 ? THREE.MathUtils.lerp(0.78, 0.94, density) : 1;
    const heightMul =
      (micro ? THREE.MathUtils.lerp(0.45, 0.72, rng()) : THREE.MathUtils.lerp(0.68, 1.08, rng())) *
      forestHeightMul;
    const height =
      heightMul *
      THREE.MathUtils.lerp(0.9, 1.06, density) *
      entry.variant.tall;
    const widthScale = (
      height
      * THREE.MathUtils.lerp(micro ? 0.55 : 0.7, micro ? 0.82 : 1.05, rng())
    ) / entry.variant.tall;

    const rootY = heightAt(x, z) + 0.04;
    composeSeedThreeTuftMatrix(x, z, rootY, height, widthScale, rng, writeMatrix, writeQuaternion, writePosition, writeScale);
    const tint = sampleSeedThreeGrassTint(rng, dry);
    instancesByMesh[variantIndex]!.push({
      matrix: writeMatrix.clone(),
      tint: [tint.x, tint.y, tint.z],
      anchor: [x, rootY, z],
    });
    return true;
  };

  for (let attempt = 0; attempt < GRASS_TUFT_SCATTER_ATTEMPTS; attempt++) {
    if (standardPlacementCount >= tuftTarget) break;
    yield tryPlaceTuft(false) ? 1 : 0;
  }

  const microTarget = Math.floor(tuftTarget * 0.42);
  for (
    let attempt = 0;
    attempt < GRASS_TUFT_SCATTER_ATTEMPTS && microPlacementCount < microTarget;
    attempt++
  ) {
    if (localPlacements.length < 3) break;
    yield tryPlaceTuft(true) ? 1 : 0;
  }

  return instancesByMesh;
}

function* generateSeedThreeWildflowerChunkInstances(
  entry: GrassStreamMesh,
  chunkX: number,
  chunkZ: number,
  context: GrassFieldContext,
  maxInstances: number,
): Generator<number, GeneratedWildflowerInstance[], void> {
  const { terrain, extent, terrainExtent, forestCores, roadSpatialIndex } = context;
  if (!entry.wildflowers || !entry.anchorAttr) return [];

  const seed = (chunkSeed(chunkX, chunkZ) ^ 0x7f4a7c15) >>> 0;
  const rng = mulberry32(seed);
  const chunkMinX = chunkX * GRASS_BLADE_CHUNK_SIZE;
  const chunkMinZ = chunkZ * GRASS_BLADE_CHUNK_SIZE;
  const margin = GRASS_BLADE_CHUNK_SIZE * 0.08;
  // Close meadow references read as overlapping runs of blooms rather than
  // isolated showcase plants. Six to eight five-stem colonies yields 30-40
  // flower heads in a viable 8 m chunk while retaining occasional quiet gaps.
  const target = rng() < 0.04 ? 0 : 6 + Math.floor(rng() * 3);
  const localPlacements: Array<{ x: number; z: number }> = [];
  const paletteOffset = seed % SEEDTHREE_WILDFLOWER_VARIANTS.length;
  const instances: GeneratedWildflowerInstance[] = [];

  for (let attempt = 0; attempt < target * 18 && localPlacements.length < target; attempt++) {
    yield 0;
    let x: number;
    let z: number;
    if (localPlacements.length > 0 && rng() < 0.78) {
      const anchor = localPlacements[Math.floor(rng() * localPlacements.length)]!;
      const angle = rng() * TAU;
      const radius = THREE.MathUtils.lerp(0.68, 1.9, Math.pow(rng(), 0.7));
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

    if (instances.length < maxInstances) {
      instances.push({
        matrix: writeMatrix.clone(),
        anchor: [x, rootY, z, variant.atlasOffset[0]],
      });
      yield 1;
    }
  }

  return instances;
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

function applyGrassDepthOffset(material: THREE.Material): void {
  material.polygonOffset = true;
  material.polygonOffsetFactor = -2;
  material.polygonOffsetUnits = -2;
}

function isGrassPlacementBlocked(x: number, z: number, context: GrassFieldContext): boolean {
  if (context.isBlockedAt?.(x, z)) return true;
  return context.placementClearancePolygons.some((polygon) => isPointInPolygon2({ x, z }, polygon));
}

function isGrassNearAnyRoad(x: number, z: number, index: RoadSpatialIndex | null): boolean {
  if (!index) return false;
  return index.isNearAnyRoad(x, z, ROAD_CLEAR_MARGIN);
}
