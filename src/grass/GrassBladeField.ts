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
  createSeedThreeWildflowerFootprintGeometries,
  createSeedThreeWildflowerVariantGeometries,
  createSeedThreeWildflowerMaterial,
  disposeSeedThreeWildflowerTextureCache,
  loadSeedThreeWildflowerAtlas,
  SEEDTHREE_WILDFLOWER_HEAD_SCALE,
  SEEDTHREE_WILDFLOWER_VARIANTS,
} from '../vegetation/seedthree/seedThreeWildflowers.ts';
import {
  estimateWildflowerSubmittedTriangles,
  resolveWildflowerGeometryLod,
  resolveWildflowerLodSubmission,
  WILDFLOWER_SLOT_CAPACITIES,
  WILDFLOWER_SPECIES_COUNT,
  WILDFLOWER_TOTAL_SLOT_CAPACITY,
  type WildflowerGeometryLod,
  type WildflowerGeometryLodSummary,
} from './wildflowerStreamBudget.ts';
import type { Terrain } from '../terrain/Terrain.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import { RoadSpatialIndex } from '../roads/roadSpatialIndex.ts';
import { isPointInPolygon2, type Point2 } from '../utils/polygonGeometry.ts';
import {
  isInsidePlayableExtent,
  mulberry32,
} from '../props/forestField.ts';
import { sampleTerrainMeshAttributeX } from '../terrain/TerrainMeshHeight.ts';
import {
  GRASS_BLADE_CHUNK_SIZE,
  GRASS_BLADE_NEAR_RADIUS,
  GRASS_BLADE_VISIBILITY_ENTER_OPACITY,
  GRASS_BLADE_VISIBILITY_EXIT_OPACITY,
  grassMicroTuftTargetForForestBlend,
  grassPlacementChanceForForestBlend,
  grassTuftTargetForForestBlend,
  wildflowerPlacementChanceForForestBlend,
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
  wildflowerMeshCount?: number;
  wildflowerLiveInstances?: number;
  wildflowerSubmittedInstances?: number;
  wildflowerLodCulledInstances?: number;
  wildflowerSubmittedTriangles?: number;
  wildflowerAllocatedInstances?: number;
  wildflowerCompactions?: number;
  wildflowerCompactionDurationMs?: number;
  wildflowerMaxCompactionDurationMs?: number;
  wildflowerCompactionBytesUploaded?: number;
  wildflowerGeometryLod?: WildflowerGeometryLodSummary;
  wildflowerDetailInstances?: number;
  wildflowerFootprintInstances?: number;
  wildflowerLodReclassifications?: number;
  wildflowerLodCompactions?: number;
  wildflowerLodGpuFlagUpdates?: number;
  wildflowerLodGpuUpdateRanges?: number;
  wildflowerLodCompactionBytesUploaded?: number;
  wildflowerMaxLodReclassificationsPerCompaction?: number;
};

const ROAD_CLEAR_MARGIN = 1.05;
const TAU = Math.PI * 2;
const GRID_SIDE = GRASS_STREAM_CHUNK_RADIUS * 2 + 1;
const GRASS_SLOT_CAPACITY = 240;
const MAX_GRASS_STREAM_INSTANCES = GRID_SIDE * GRID_SIDE * GRASS_SLOT_CAPACITY;
const MIN_TUFT_SPACING_SQ = 0.2 * 0.2;
const MIN_MICRO_TUFT_SPACING_SQ = 0.12 * 0.12;
const MIN_WILDFLOWER_STEM_SPACING_SQ = 0.13 * 0.13;
const DENSE_WILDFLOWER_SPACING_SQ = 0.18 * 0.18;
const PURPLE_WILDFLOWER_SPACING_SQ = 0.38 * 0.38;
const ACCENT_WILDFLOWER_SPACING_SQ = 0.2 * 0.2;
const WHITE_WILDFLOWER_INDEX = 0;
const PURPLE_WILDFLOWER_INDEX = 1;
const YELLOW_WILDFLOWER_INDEX = 2;
const ORANGE_WILDFLOWER_INDEX = 3;
const RED_WILDFLOWER_INDEX = 4;
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
  compactData: Array<CompactWildflowerSlotData | null>;
  wildflowerGeometryLod: WildflowerGeometryLod;
};

type CompactWildflowerSlotData = {
  matrices: Float32Array;
  anchors: Float32Array;
  count: number;
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
  wildflowerVariantIndex?: number;
  compactLivePrefix?: true;
  wildflowerDetailGeometry?: THREE.BufferGeometry;
  wildflowerFootprintGeometry?: THREE.BufferGeometry;
  wildflowerFootprintMesh?: THREE.InstancedMesh;
  wildflowerFootprintAnchorAttr?: THREE.InstancedBufferAttribute;
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
const WILDFLOWER_COMPACTION_COMMIT_BATCH = 8;
const WILDFLOWER_COMPACTION_MAX_LATENCY_MS = 100;
const WILDFLOWER_LOD_FOCUS_MINIMUM_MOVE_METERS = 1;

export async function createGrassBladeField(
  terrain: Terrain,
  options?: GrassBladeFieldOptions,
): Promise<GrassBladeField> {
  if (!GRASS_BLADES_ENABLED) {
    return createDisabledGrassBladeField();
  }

  const generationSize = Number.isFinite(terrain.generationSize)
    ? terrain.generationSize
    : Math.min(
        terrain.bounds.maxX - terrain.bounds.minX,
        terrain.bounds.maxZ - terrain.bounds.minZ,
      );
  const context: GrassFieldContext = {
    terrain,
    extent: generationSize * 0.5,
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
      '/assets/textures/vegetation/grass/close-meadow-tuft-greener.png';
    return { mesh, slotCapacity: GRASS_SLOT_CAPACITY, variant, tintAttr, anchorAttr };
  });
  const wildflowerGeometries = createSeedThreeWildflowerVariantGeometries(
    SEEDTHREE_WILDFLOWER_HEAD_SCALE,
  );
  const wildflowerFootprintGeometries =
    createSeedThreeWildflowerFootprintGeometries(
      SEEDTHREE_WILDFLOWER_HEAD_SCALE,
    );
  const wildflowerMaterial = createSeedThreeWildflowerMaterial(
    wildflowerAtlas,
    'Gorski Kotar wildflower atlas',
  );
  applyGrassDepthOffset(wildflowerMaterial);
  wildflowerGeometries.forEach((geometry, variantIndex) => {
    const footprintGeometry = wildflowerFootprintGeometries[variantIndex]!;
    const slotCapacity = WILDFLOWER_SLOT_CAPACITIES[variantIndex]!;
    const maxInstances = GRID_SIDE * GRID_SIDE * slotCapacity;
    const detailAnchorAttr = new THREE.InstancedBufferAttribute(
      new Float32Array(maxInstances * 4),
      4,
    );
    const footprintAnchorAttr = new THREE.InstancedBufferAttribute(
      new Float32Array(maxInstances * 4),
      4,
    );
    geometry.setAttribute('aAnchorPos', detailAnchorAttr);
    footprintGeometry.setAttribute('aAnchorPos', footprintAnchorAttr);
    const variant = SEEDTHREE_WILDFLOWER_VARIANTS[variantIndex]!;
    const detailMesh = new THREE.InstancedMesh(
      geometry,
      wildflowerMaterial,
      maxInstances,
    );
    detailMesh.name = `SeedThree streamed ${variant.label} detail`;
    detailMesh.count = 0;
    applyGroundCoverShadowPolicy(detailMesh, {
      terrainReceivesShadow: true,
    });
    detailMesh.frustumCulled = false;
    detailMesh.renderOrder = 3;
    detailMesh.visible = false;
    detailMesh.userData.texturePath =
      '/assets/textures/vegetation/wildflowers/gorski-kotar-wildflower-atlas-v2.png';
    detailMesh.userData.wildflowerVariant = variant.id;
    detailMesh.userData.slotCapacity = slotCapacity;
    detailMesh.userData.liveInstances = 0;
    detailMesh.userData.geometryLod = 'detail';

    const footprintMesh = new THREE.InstancedMesh(
      footprintGeometry,
      wildflowerMaterial,
      maxInstances,
    );
    footprintMesh.name = `SeedThree streamed ${variant.label} footprint`;
    footprintMesh.count = 0;
    applyGroundCoverShadowPolicy(footprintMesh, {
      terrainReceivesShadow: true,
    });
    footprintMesh.frustumCulled = false;
    footprintMesh.renderOrder = 3;
    footprintMesh.visible = false;
    footprintMesh.userData.texturePath = detailMesh.userData.texturePath;
    footprintMesh.userData.wildflowerVariant = variant.id;
    footprintMesh.userData.slotCapacity = slotCapacity;
    footprintMesh.userData.liveInstances = 0;
    footprintMesh.userData.geometryLod = 'footprint';
    streamMeshes.push({
      mesh: detailMesh,
      slotCapacity,
      wildflowerVariantIndex: variantIndex,
      compactLivePrefix: true,
      wildflowerDetailGeometry: geometry,
      wildflowerFootprintGeometry: footprintGeometry,
      wildflowerFootprintMesh: footprintMesh,
      wildflowerFootprintAnchorAttr: footprintAnchorAttr,
      anchorAttr: detailAnchorAttr,
    });
  });
  // Grass keeps fixed toroidal slots. Park only those sparse, low-poly tuft
  // buffers before first use; wildflowers use exact compact live prefixes.
  for (const entry of streamMeshes) {
    if (!entry.compactLivePrefix) {
      clearSlotRange(entry.mesh, 0, entry.mesh.instanceMatrix.count);
    }
  }
  displayMaterials = [grassMaterial, wildflowerMaterial];
  disposeResources = () => {
    const geometries = new Set<THREE.BufferGeometry>();
    for (const entry of streamMeshes) {
      geometries.add(entry.mesh.geometry);
      if (entry.wildflowerDetailGeometry) {
        geometries.add(entry.wildflowerDetailGeometry);
      }
      if (entry.wildflowerFootprintGeometry) {
        geometries.add(entry.wildflowerFootprintGeometry);
      }
      entry.mesh.dispose();
      entry.wildflowerFootprintMesh?.dispose();
    }
    for (const geometry of geometries) geometry.dispose();
    for (const material of displayMaterials) material.dispose();
    disposeSeedThreeGrassTextureCache();
    disposeSeedThreeWildflowerTextureCache();
  };

  const group = new THREE.Group();
  group.name = 'SeedThree grass field';
  for (const entry of streamMeshes) {
    group.add(entry.mesh);
    if (entry.wildflowerFootprintMesh) group.add(entry.wildflowerFootprintMesh);
  }
  group.userData.groundcoverSubmission =
    'two-grass-plus-ten-spatial-wildflower-lod-meshes';
  group.userData.wildflowerStream = {
    allocatedInstances: wildflowerGeometries.reduce(
      (total, _geometry, variantIndex) => (
        total + 2 * GRID_SIDE * GRID_SIDE * WILDFLOWER_SLOT_CAPACITIES[variantIndex]!
      ),
      0,
    ),
    logicalCapacity: GRID_SIDE * GRID_SIDE * WILDFLOWER_TOTAL_SLOT_CAPACITY,
    liveInstances: 0,
    detailInstances: 0,
    footprintInstances: 0,
    submittedInstances: 0,
    submittedTriangles: 0,
    lodCulledInstances: 0,
    geometryLod: 'footprint',
    species: SEEDTHREE_WILDFLOWER_VARIANTS.map((variant, variantIndex) => ({
      id: variant.id,
      liveInstances: 0,
      slotCapacity: WILDFLOWER_SLOT_CAPACITIES[variantIndex]!,
      trianglesPerInstance:
        (wildflowerGeometries[variantIndex]!.index?.count ?? 0) / 3,
      footprintTrianglesPerInstance:
        (wildflowerFootprintGeometries[variantIndex]!.index?.count ?? 0) / 3,
    })),
  };
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
    compactData: Array.from({ length: streamMeshes.length }, () => null),
    wildflowerGeometryLod: 'footprint',
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
  let wildflowerGeometryLod: WildflowerGeometryLodSummary = 'footprint';
  const wildflowerLodFocus = new THREE.Vector3(
    Number.POSITIVE_INFINITY,
    0,
    Number.POSITIVE_INFINITY,
  );
  let wildflowerLodRepackDirty = false;
  let wildflowerLodReclassificationsSinceRepack = 0;
  let streamNearRadius = GRASS_BLADE_NEAR_RADIUS;
  let activeSlotJob: GrassSlotGenerationJob | null = null;
  let compactRepackDirty = false;
  let compactCommitsSinceRepack = 0;
  let lastCompactRepackAtMs = performance.now();
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
    wildflowerMeshCount: 2 * WILDFLOWER_SPECIES_COUNT,
    wildflowerLiveInstances: 0,
    wildflowerSubmittedInstances: 0,
    wildflowerLodCulledInstances: 0,
    wildflowerSubmittedTriangles: 0,
    wildflowerAllocatedInstances:
      2 * GRID_SIDE * GRID_SIDE * WILDFLOWER_TOTAL_SLOT_CAPACITY,
    wildflowerCompactions: 0,
    wildflowerCompactionDurationMs: 0,
    wildflowerMaxCompactionDurationMs: 0,
    wildflowerCompactionBytesUploaded: 0,
    wildflowerGeometryLod,
    wildflowerDetailInstances: 0,
    wildflowerFootprintInstances: 0,
    wildflowerLodReclassifications: 0,
    wildflowerLodCompactions: 0,
    wildflowerLodGpuFlagUpdates: 0,
    wildflowerLodGpuUpdateRanges: 0,
    wildflowerLodCompactionBytesUploaded: 0,
    wildflowerMaxLodReclassificationsPerCompaction: 0,
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

  const updateWildflowerSpatialLods = (
    cameraPosition: THREE.Vector3,
  ): number => {
    if (!Number.isFinite(cameraPosition.x) || !Number.isFinite(cameraPosition.z)) {
      return 0;
    }
    const focusMovedSq = Number.isFinite(wildflowerLodFocus.x)
      ? wildflowerLodFocus.distanceToSquared(cameraPosition)
      : Number.POSITIVE_INFINITY;
    if (focusMovedSq < WILDFLOWER_LOD_FOCUS_MINIMUM_MOVE_METERS ** 2) return 0;
    wildflowerLodFocus.copy(cameraPosition);
    let reclassified = 0;
    for (const record of slotRecords) {
      if (!Number.isFinite(record.worldChunkX) || !Number.isFinite(record.worldChunkZ)) {
        continue;
      }
      const distance = Math.sqrt(slotDistanceSq(
        record.worldChunkX,
        record.worldChunkZ,
        cameraPosition.x,
        cameraPosition.z,
      ));
      const nextLod = resolveWildflowerGeometryLod(
        record.wildflowerGeometryLod,
        distance,
      );
      if (nextLod === record.wildflowerGeometryLod) continue;
      record.wildflowerGeometryLod = nextLod;
      reclassified += 1;
    }
    if (reclassified > 0) {
      compactRepackDirty = true;
      wildflowerLodRepackDirty = true;
      wildflowerLodReclassificationsSinceRepack += reclassified;
      streamTelemetry.wildflowerLodReclassifications =
        (streamTelemetry.wildflowerLodReclassifications ?? 0) + reclassified;
    }
    return reclassified;
  };

  const refreshWildflowerDiagnostics = (): void => {
    const wildflowerEntries = streamMeshes.filter(
      (entry) => entry.compactLivePrefix,
    );
    const speciesDetailInstances = wildflowerEntries.map((entry) => entry.mesh.count);
    const speciesFootprintInstances = wildflowerEntries.map(
      (entry) => entry.wildflowerFootprintMesh?.count ?? 0,
    );
    const speciesLiveInstances = speciesDetailInstances.map(
      (count, index) => count + (speciesFootprintInstances[index] ?? 0),
    );
    const liveInstances = speciesLiveInstances.reduce(
      (total, count) => total + count,
      0,
    );
    const detailInstances = speciesDetailInstances.reduce(
      (total, count) => total + count,
      0,
    );
    const footprintInstances = speciesFootprintInstances.reduce(
      (total, count) => total + count,
      0,
    );
    const lod = resolveWildflowerLodSubmission(
      liveInstances,
      grassZoomVisible,
    );
    const detailTrianglesPerInstance = wildflowerEntries.map(
      (entry) => (entry.wildflowerDetailGeometry?.index?.count ?? 0) / 3,
    );
    const footprintTrianglesPerInstance = wildflowerEntries.map(
      (entry) => (entry.wildflowerFootprintGeometry?.index?.count ?? 0) / 3,
    );
    const submittedTriangles = grassZoomVisible
      ? estimateWildflowerSubmittedTriangles(
          speciesDetailInstances,
          detailTrianglesPerInstance,
        ) + estimateWildflowerSubmittedTriangles(
          speciesFootprintInstances,
          footprintTrianglesPerInstance,
        )
      : 0;
    wildflowerGeometryLod = detailInstances > 0 && footprintInstances > 0
      ? 'mixed'
      : detailInstances > 0
        ? 'detail'
        : 'footprint';
    streamTelemetry.wildflowerLiveInstances = liveInstances;
    streamTelemetry.wildflowerSubmittedInstances = lod.submittedInstances;
    streamTelemetry.wildflowerLodCulledInstances = lod.culledInstances;
    streamTelemetry.wildflowerSubmittedTriangles = submittedTriangles;
    streamTelemetry.wildflowerGeometryLod = wildflowerGeometryLod;
    streamTelemetry.wildflowerDetailInstances = detailInstances;
    streamTelemetry.wildflowerFootprintInstances = footprintInstances;

    const diagnostic = group.userData.wildflowerStream as {
      liveInstances: number;
      detailInstances: number;
      footprintInstances: number;
      submittedInstances: number;
      submittedTriangles: number;
      lodCulledInstances: number;
      geometryLod: WildflowerGeometryLodSummary;
      species: Array<{
        liveInstances: number;
        trianglesPerInstance: number;
        detailInstances?: number;
        footprintInstances?: number;
      }>;
    };
    diagnostic.liveInstances = liveInstances;
    diagnostic.detailInstances = detailInstances;
    diagnostic.footprintInstances = footprintInstances;
    diagnostic.submittedInstances = lod.submittedInstances;
    diagnostic.submittedTriangles = submittedTriangles;
    diagnostic.lodCulledInstances = lod.culledInstances;
    diagnostic.geometryLod = wildflowerGeometryLod;
    for (let index = 0; index < diagnostic.species.length; index++) {
      diagnostic.species[index]!.liveInstances = speciesLiveInstances[index] ?? 0;
      diagnostic.species[index]!.detailInstances = speciesDetailInstances[index] ?? 0;
      diagnostic.species[index]!.footprintInstances =
        speciesFootprintInstances[index] ?? 0;
      diagnostic.species[index]!.trianglesPerInstance =
        (speciesDetailInstances[index] ?? 0) > 0
          ? detailTrianglesPerInstance[index] ?? 0
          : footprintTrianglesPerInstance[index] ?? 0;
    }
  };

  const repackCompactMesh = (
    entry: GrassStreamMesh,
    meshIndex: number,
  ): number => {
    const footprintMesh = entry.wildflowerFootprintMesh;
    const detailMatrixArray = entry.mesh.instanceMatrix.array as Float32Array;
    const detailAnchorArray = entry.anchorAttr?.array as Float32Array | undefined;
    const footprintMatrixArray = footprintMesh?.instanceMatrix.array as Float32Array | undefined;
    const footprintAnchorArray = entry.wildflowerFootprintAnchorAttr?.array as
      | Float32Array
      | undefined;
    if (!footprintMesh || !footprintMatrixArray || !footprintAnchorArray) {
      throw new Error('Spatial wildflower LOD requires a footprint mesh and anchor prefix.');
    }
    let detailCount = 0;
    let footprintCount = 0;
    for (const record of slotRecords) {
      const data = record.compactData[meshIndex];
      if (!data || data.count <= 0) continue;
      if (record.wildflowerGeometryLod === 'detail') {
        detailMatrixArray.set(data.matrices, detailCount * 16);
        detailAnchorArray?.set(data.anchors, detailCount * 4);
        detailCount += data.count;
      } else {
        footprintMatrixArray.set(data.matrices, footprintCount * 16);
        footprintAnchorArray.set(data.anchors, footprintCount * 4);
        footprintCount += data.count;
      }
    }
    if (
      detailCount > entry.mesh.instanceMatrix.count
      || footprintCount > footprintMesh.instanceMatrix.count
    ) {
      throw new Error(
        `Wildflower LOD prefixes ${detailCount}/${footprintCount} exceed allocation.`,
      );
    }
    entry.mesh.count = detailCount;
    entry.mesh.userData.liveInstances = detailCount;
    footprintMesh.count = footprintCount;
    footprintMesh.userData.liveInstances = footprintCount;

    const publishPrefix = (
      count: number,
      matrix: THREE.InstancedBufferAttribute,
      anchor: THREE.InstancedBufferAttribute | undefined,
    ): void => {
      if (count <= 0) return;
      const attributes = [matrix, anchor]
        .filter((attribute): attribute is THREE.InstancedBufferAttribute => !!attribute);
      for (const attribute of attributes) {
        attribute.clearUpdateRanges();
        attribute.addUpdateRange(0, count * attribute.itemSize);
        attribute.needsUpdate = true;
        streamTelemetry.gpuFlagUpdates += 1;
        streamTelemetry.gpuUpdateRanges += 1;
        if (wildflowerLodRepackDirty) {
          streamTelemetry.wildflowerLodGpuFlagUpdates =
            (streamTelemetry.wildflowerLodGpuFlagUpdates ?? 0) + 1;
          streamTelemetry.wildflowerLodGpuUpdateRanges =
            (streamTelemetry.wildflowerLodGpuUpdateRanges ?? 0) + 1;
        }
        streamTelemetry.bytesUploaded +=
          count * attribute.itemSize * attribute.array.BYTES_PER_ELEMENT;
        streamTelemetry.wildflowerCompactionBytesUploaded =
          (streamTelemetry.wildflowerCompactionBytesUploaded ?? 0)
          + count * attribute.itemSize * attribute.array.BYTES_PER_ELEMENT;
      }
    };
    publishPrefix(detailCount, entry.mesh.instanceMatrix, entry.anchorAttr);
    publishPrefix(
      footprintCount,
      footprintMesh.instanceMatrix,
      entry.wildflowerFootprintAnchorAttr,
    );
    return detailCount + footprintCount;
  };

  const refreshMeshCount = (repackCompact = false): void => {
    const compactionStartedAt = repackCompact ? performance.now() : 0;
    const lodDrivenRepack = repackCompact && wildflowerLodRepackDirty;
    const bytesBeforeRepack = streamTelemetry.wildflowerCompactionBytesUploaded ?? 0;
    for (let meshIndex = 0; meshIndex < streamMeshes.length; meshIndex++) {
      const entry = streamMeshes[meshIndex]!;
      if (entry.compactLivePrefix) {
        if (repackCompact) repackCompactMesh(entry, meshIndex);
        continue;
      }
      let maxExclusive = 0;
      for (let gridIdx = 0; gridIdx < slotRecords.length; gridIdx++) {
        const count = slotRecords[gridIdx]!.meshCounts[meshIndex] ?? 0;
        if (count <= 0) continue;
        maxExclusive = Math.max(maxExclusive, gridIdx * entry.slotCapacity + count);
      }
      entry.mesh.count = maxExclusive;
    }
    if (repackCompact) {
      const durationMs = performance.now() - compactionStartedAt;
      streamTelemetry.wildflowerCompactions =
        (streamTelemetry.wildflowerCompactions ?? 0) + 1;
      streamTelemetry.wildflowerCompactionDurationMs =
        (streamTelemetry.wildflowerCompactionDurationMs ?? 0) + durationMs;
      streamTelemetry.wildflowerMaxCompactionDurationMs = Math.max(
        streamTelemetry.wildflowerMaxCompactionDurationMs ?? 0,
        durationMs,
      );
      compactRepackDirty = false;
      compactCommitsSinceRepack = 0;
      lastCompactRepackAtMs = performance.now();
      if (lodDrivenRepack) {
        streamTelemetry.wildflowerLodCompactions =
          (streamTelemetry.wildflowerLodCompactions ?? 0) + 1;
        streamTelemetry.wildflowerLodCompactionBytesUploaded =
          (streamTelemetry.wildflowerLodCompactionBytesUploaded ?? 0)
          + Math.max(
            0,
            (streamTelemetry.wildflowerCompactionBytesUploaded ?? 0)
              - bytesBeforeRepack,
          );
        streamTelemetry.wildflowerMaxLodReclassificationsPerCompaction = Math.max(
          streamTelemetry.wildflowerMaxLodReclassificationsPerCompaction ?? 0,
          wildflowerLodReclassificationsSinceRepack,
        );
        wildflowerLodRepackDirty = false;
        wildflowerLodReclassificationsSinceRepack = 0;
      }
    }
    refreshWildflowerDiagnostics();
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
    let compactDataChanged = false;
    for (let meshIndex = 0; meshIndex < streamMeshes.length; meshIndex++) {
      const entry = streamMeshes[meshIndex]!;
      const generated = job.generatedByMesh[meshIndex] ?? [];
      if (entry.compactLivePrefix) {
        const wildflowers = generated as GeneratedWildflowerInstance[];
        record.compactData[meshIndex] = encodeCompactWildflowerSlot(wildflowers);
        record.meshCounts[meshIndex] = wildflowers.length;
        written += wildflowers.length;
        compactDataChanged = true;
        continue;
      }
      const startIndex = slotIndex * entry.slotCapacity;
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
        }
        written += 1;
      }
      record.meshCounts[meshIndex] = generated.length;
      dirtyInstanceCounts[meshIndex] = rewrite.dirtyInstanceCount;
    }
    record.worldChunkX = worldChunkX;
    record.worldChunkZ = worldChunkZ;
    const slotLod = Number.isFinite(wildflowerLodFocus.x)
      ? resolveWildflowerGeometryLod(
          'footprint',
          Math.sqrt(slotDistanceSq(
            worldChunkX,
            worldChunkZ,
            wildflowerLodFocus.x,
            wildflowerLodFocus.z,
          )),
        )
      : 'footprint';
    if (record.wildflowerGeometryLod !== slotLod) {
      record.wildflowerGeometryLod = slotLod;
      wildflowerLodRepackDirty = true;
      wildflowerLodReclassificationsSinceRepack += 1;
      streamTelemetry.wildflowerLodReclassifications =
        (streamTelemetry.wildflowerLodReclassifications ?? 0) + 1;
    }
    if (compactDataChanged) {
      compactRepackDirty = true;
      compactCommitsSinceRepack += 1;
    }
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
    const desiredSlotIndices = new Set<number>();
    for (let localZ = 0; localZ < GRID_SIDE; localZ++) {
      for (let localX = 0; localX < GRID_SIDE; localX++) {
        const { chunkX, chunkZ } = worldChunkAt(centerChunkX, centerChunkZ, localX, localZ);
        if (!chunkInStreamRange(chunkX, chunkZ, focusX, focusZ, nearRadius)) continue;
        const gridIdx = resolveGrassStreamSlotIndex(chunkX, chunkZ, GRID_SIDE);
        desiredSlotIndices.add(gridIdx);
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
    let compactSlotsInvalidated = false;
    for (let gridIdx = 0; gridIdx < slotRecords.length; gridIdx++) {
      if (desiredSlotIndices.has(gridIdx)) continue;
      const record = slotRecords[gridIdx]!;
      let recordChanged = false;
      for (let meshIndex = 0; meshIndex < streamMeshes.length; meshIndex++) {
        if (!streamMeshes[meshIndex]!.compactLivePrefix) continue;
        if ((record.meshCounts[meshIndex] ?? 0) <= 0) continue;
        record.meshCounts[meshIndex] = 0;
        record.compactData[meshIndex] = null;
        recordChanged = true;
      }
      if (recordChanged) {
        record.worldChunkX = Number.NaN;
        record.worldChunkZ = Number.NaN;
        record.wildflowerGeometryLod = 'footprint';
        compactSlotsInvalidated = true;
      }
    }
    if (compactSlotsInvalidated) {
      compactRepackDirty = true;
      refreshMeshCount(true);
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
    const shouldFlushCompactPrefix = compactRepackDirty && (
      pendingSlots.length === 0
      || compactCommitsSinceRepack >= WILDFLOWER_COMPACTION_COMMIT_BATCH
      || performance.now() - lastCompactRepackAtMs
        >= WILDFLOWER_COMPACTION_MAX_LATENCY_MS
    );
    if (changedSlots.length > 0) {
      const refreshStartedAt = performance.now();
      refreshMeshCount(shouldFlushCompactPrefix);
      streamTelemetry.refreshCount += 1;
      streamTelemetry.refreshDurationMs += performance.now() - refreshStartedAt;
      applyStreamMeshUpdateRanges(
        streamMeshes,
        changedSlots,
        streamTelemetry,
      );
    } else if (shouldFlushCompactPrefix) {
      const refreshStartedAt = performance.now();
      refreshMeshCount(true);
      streamTelemetry.refreshCount += 1;
      streamTelemetry.refreshDurationMs += performance.now() - refreshStartedAt;
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
      streamTelemetry.pendingSlots === 0
      && !needsFullStream
      && !compactRepackDirty;
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
      updateWildflowerSpatialLods(cameraPosition);
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

      for (const entry of streamMeshes) {
        entry.mesh.visible = grassZoomVisible;
        if (entry.wildflowerFootprintMesh) {
          entry.wildflowerFootprintMesh.visible = grassZoomVisible;
        }
      }
      if (
        wildflowerLodRepackDirty
        && performance.now() - lastCompactRepackAtMs
          >= WILDFLOWER_COMPACTION_MAX_LATENCY_MS
      ) {
        refreshMeshCount(true);
      }
      refreshWildflowerDiagnostics();
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
    wildflowerMeshCount: 0,
    wildflowerLiveInstances: 0,
    wildflowerSubmittedInstances: 0,
    wildflowerLodCulledInstances: 0,
    wildflowerSubmittedTriangles: 0,
    wildflowerAllocatedInstances: 0,
    wildflowerCompactions: 0,
    wildflowerCompactionDurationMs: 0,
    wildflowerMaxCompactionDurationMs: 0,
    wildflowerCompactionBytesUploaded: 0,
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
    if (entry.compactLivePrefix) continue;
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

function encodeCompactWildflowerSlot(
  instances: readonly GeneratedWildflowerInstance[],
): CompactWildflowerSlotData {
  const matrices = new Float32Array(instances.length * 16);
  const anchors = new Float32Array(instances.length * 4);
  for (let index = 0; index < instances.length; index++) {
    const instance = instances[index]!;
    matrices.set(instance.matrix.elements, index * 16);
    anchors.set(instance.anchor, index * 4);
  }
  return { matrices, anchors, count: instances.length };
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

function sampleForestFloorBlend(
  context: GrassFieldContext,
  x: number,
  z: number,
): number {
  return THREE.MathUtils.clamp(
    sampleTerrainMeshAttributeX(
      context.terrain.mesh.geometry,
      'forestBlend',
      x,
      z,
      context.terrain.resolution,
      context.terrain.size,
    ),
    0,
    1,
  );
}

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
  const wildflowerEntries = streamMeshes.filter(
    (entry) => entry.compactLivePrefix,
  );
  const grassInstances = yield* generateSeedThreeChunkInstances(
    grassEntries,
    request.worldChunkX,
    request.worldChunkZ,
    context,
    GRASS_SLOT_CAPACITY,
  );
  const wildflowerInstances = yield* generateSeedThreeWildflowerChunkInstances(
    request.worldChunkX,
    request.worldChunkZ,
    context,
    wildflowerEntries.map((entry) => entry.slotCapacity),
  );
  let grassCountIndex = 0;
  let wildflowerCountIndex = 0;
  const generatedByMesh: Array<
    GeneratedGrassInstance[] | GeneratedWildflowerInstance[]
  > = [];
  for (const entry of streamMeshes) {
    if (entry.variant) {
      generatedByMesh.push(grassInstances[grassCountIndex++] ?? []);
    } else if (entry.compactLivePrefix) {
      generatedByMesh.push(
        wildflowerInstances[wildflowerCountIndex++] ?? [],
      );
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
  const { terrain, extent, roadSpatialIndex } = context;
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
  const baseTuftTarget = GRASS_TUFTS_PER_CHUNK + Math.floor(rng() * 14);
  const chunkCenterX = chunkMinX + chunkSpan * 0.5;
  const chunkCenterZ = chunkMinZ + chunkSpan * 0.5;
  const forestSampleOffset = chunkSpan * 0.25;
  const chunkForestBlend = (
    sampleForestFloorBlend(context, chunkCenterX, chunkCenterZ)
    + sampleForestFloorBlend(context, chunkCenterX - forestSampleOffset, chunkCenterZ - forestSampleOffset)
    + sampleForestFloorBlend(context, chunkCenterX + forestSampleOffset, chunkCenterZ - forestSampleOffset)
    + sampleForestFloorBlend(context, chunkCenterX - forestSampleOffset, chunkCenterZ + forestSampleOffset)
    + sampleForestFloorBlend(context, chunkCenterX + forestSampleOffset, chunkCenterZ + forestSampleOffset)
  ) / 5;
  const tuftTarget = grassTuftTargetForForestBlend(baseTuftTarget, chunkForestBlend);

  const tryPlaceTuft = (micro: boolean): boolean => {
    if (instancesByMesh.every((instances) => instances.length >= maxInstancesPerMesh)) {
      return false;
    }
    if (!micro && standardPlacementCount >= tuftTarget) return false;

    let x: number;
    let z: number;
    // Keep a little local affinity, but let most tufts fill the complete
    // chunk. The former 58% clustering bias made broad bare-soil corridors
    // even when the total tuft budget was healthy.
    if (localPlacements.length > 0 && rng() < 0.34) {
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

    const density = sampleForestFloorBlend(context, x, z);
    if (rng() > grassPlacementChanceForForestBlend(density)) return false;

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
      * THREE.MathUtils.lerp(micro ? 0.6 : 0.75, micro ? 0.86 : 1.1, rng())
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

  // Fine underfill closes remaining meadow gaps with shorter, thinner geometry.
  // It fades out with the terrain forest mask so woodland keeps visible soil.
  // In open terrain, 192 full tufts plus this cohort is approximately 2.35x
  // the previous 96 + 42% close-meadow population.
  const microTarget = grassMicroTuftTargetForForestBlend(
    tuftTarget,
    chunkForestBlend,
  );
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
  chunkX: number,
  chunkZ: number,
  context: GrassFieldContext,
  maxInstancesByVariant: readonly number[],
): Generator<number, GeneratedWildflowerInstance[][], void> {
  const { terrain, extent, roadSpatialIndex } = context;

  const seed = (chunkSeed(chunkX, chunkZ) ^ 0x7f4a7c15) >>> 0;
  const rng = mulberry32(seed);
  const chunkMinX = chunkX * GRASS_BLADE_CHUNK_SIZE;
  const chunkMinZ = chunkZ * GRASS_BLADE_CHUNK_SIZE;
  const patchMargin = GRASS_BLADE_CHUNK_SIZE * 0.075;
  const patchCellSpan = (GRASS_BLADE_CHUNK_SIZE - patchMargin * 2) * 0.5;
  // Manor Lords-style meadow color is organized rather than confetti-scattered.
  // Three or four quadrant-stratified colonies prevent accidental patch
  // overlap and spread the doubled flower population across the whole chunk;
  // white/yellow still lead, purple ranges through them, and warm accents stay
  // as readable singles or pairs.
  const patchRoll = rng();
  const patchCount = patchRoll < 0.01 ? 0 : patchRoll < 0.38 ? 3 : 4;
  const localPlacements: Array<{ x: number; z: number; variantIndex: number }> = [];
  const cohorts: Array<{
    centerX: number;
    centerZ: number;
    radius: number;
    count: number;
    variantIndex: number;
    sameSpeciesSpacingSq: number;
    radialPower: number;
  }> = [];
  const instancesByVariant = Array.from(
    { length: WILDFLOWER_SPECIES_COUNT },
    () => [] as GeneratedWildflowerInstance[],
  );
  const patchCellOffset = seed & 3;

  for (let patchIndex = 0; patchIndex < patchCount; patchIndex++) {
    const patchCell = (patchIndex + patchCellOffset) & 3;
    const cellX = patchCell & 1;
    const cellZ = patchCell >> 1;
    const centerX = chunkMinX + patchMargin
      + (cellX + THREE.MathUtils.lerp(0.18, 0.82, rng())) * patchCellSpan;
    const centerZ = chunkMinZ + patchMargin
      + (cellZ + THREE.MathUtils.lerp(0.18, 0.82, rng())) * patchCellSpan;
    const denseVariantIndex = (seed + patchIndex) % 2 === 0
      ? WHITE_WILDFLOWER_INDEX
      : YELLOW_WILDFLOWER_INDEX;
    cohorts.push({
      centerX,
      centerZ,
      radius: THREE.MathUtils.lerp(0.58, 0.96, rng()),
      count: 18 + Math.floor(rng() * 7),
      variantIndex: denseVariantIndex,
      sameSpeciesSpacingSq: DENSE_WILDFLOWER_SPACING_SQ,
      radialPower: 0.78,
    });
    cohorts.push({
      centerX,
      centerZ,
      radius: THREE.MathUtils.lerp(1.08, 1.78, rng()),
      count: 5 + Math.floor(rng() * 4),
      variantIndex: PURPLE_WILDFLOWER_INDEX,
      sameSpeciesSpacingSq: PURPLE_WILDFLOWER_SPACING_SQ,
      radialPower: 0.5,
    });

    const appendAccentCohort = (variantIndex: number, chance: number): void => {
      if (rng() > chance) return;
      const angle = rng() * TAU;
      const distance = THREE.MathUtils.lerp(0.25, 1.15, rng());
      cohorts.push({
        centerX: centerX + Math.cos(angle) * distance,
        centerZ: centerZ + Math.sin(angle) * distance,
        radius: 0.14,
        count: rng() < 0.68 ? 1 : 2,
        variantIndex,
        sameSpeciesSpacingSq: ACCENT_WILDFLOWER_SPACING_SQ,
        radialPower: 1,
      });
    };
    appendAccentCohort(ORANGE_WILDFLOWER_INDEX, 0.82);
    appendAccentCohort(RED_WILDFLOWER_INDEX, 0.58);
  }

  for (const cohort of cohorts) {
    for (
      let flowerIndex = 0;
      flowerIndex < cohort.count
        && instancesByVariant[cohort.variantIndex]!.length
          < (maxInstancesByVariant[cohort.variantIndex] ?? 0);
      flowerIndex++
    ) {
      let placed = false;
      for (let attempt = 0; attempt < 20 && !placed; attempt++) {
        yield 0;
        const angle = rng() * TAU;
        const radius = cohort.radius * Math.pow(rng(), cohort.radialPower);
        const x = cohort.centerX + Math.cos(angle) * radius;
        const z = cohort.centerZ + Math.sin(angle) * radius;

        let tooClose = false;
        for (const existing of localPlacements) {
          const dx = x - existing.x;
          const dz = z - existing.z;
          const distanceSq = dx * dx + dz * dz;
          if (
            distanceSq < MIN_WILDFLOWER_STEM_SPACING_SQ
            || (
              existing.variantIndex === cohort.variantIndex
              && distanceSq < cohort.sameSpeciesSpacingSq
            )
          ) {
            tooClose = true;
            break;
          }
        }
        if (tooClose) continue;
        if (!isInsidePlayableExtent(x, z, extent)) continue;
        if (isGrassPlacementBlocked(x, z, context)) continue;
        if (isGrassNearAnyRoad(x, z, roadSpatialIndex)) continue;

        const density = sampleForestFloorBlend(context, x, z);
        const habitatChance = wildflowerPlacementChanceForForestBlend(density);
        if (rng() > habitatChance) continue;

        localPlacements.push({ x, z, variantIndex: cohort.variantIndex });
        const rootY = terrain.getHeightAt(x, z) + 0.045;
        const yaw = rng() * TAU;
        const leanDirection = rng() * TAU;
        const lean = THREE.MathUtils.lerp(0.015, 0.085, rng());
        writeEuler.set(Math.cos(leanDirection) * lean, yaw, Math.sin(leanDirection) * lean, 'YXZ');
        writeQuaternion.setFromEuler(writeEuler);
        writePosition.set(x, rootY, z);
        const variant = SEEDTHREE_WILDFLOWER_VARIANTS[cohort.variantIndex]!;
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

        instancesByVariant[cohort.variantIndex]!.push({
          matrix: writeMatrix.clone(),
          anchor: [x, rootY, z, variant.atlasOffset[0]],
        });
        placed = true;
        yield 1;
      }
    }
  }

  return instancesByVariant;
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
