import * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { buildTree, forestBarkMaterial } from '@seedthree/core/tree.js';
import {
  forestCardMaterial,
  setForestCardSeason,
} from '@seedthree/core/branch-cards.js';
import {
  createForestLodSelector,
  selectForestLods,
} from '@seedthree/core/forest-lod.js';
import { Rng } from '@seedthree/core/rng.js';
import type { Terrain } from '../../terrain/Terrain.ts';
import type { ForestTreePlacement } from '../../props/forestPlacements.ts';
import {
  autumnFoliageColorForPreset,
  GORSKI_KOTAR_PRESETS,
  gorskiKotarSpeciesIsDeciduous,
  resolveSeedThreePreset,
  seedThreeScaleForPreset,
  type SeedThreePresetKey,
} from './gorskiKotarSpecies.ts';
import { GORSKI_KOTAR_SPECIES } from './gorskiKotarPresets.ts';
import { loadSeedThreeSpeciesAssets, type SeedThreeSpeciesAssets } from './seedThreeAssets.ts';
import { ensureSeedThreeBranchCards } from './seedThreeBranchCards.ts';
import type { SeedThreeForestController } from './seedThreeForestTypes.ts';
import {
  createSeedThreeBucketMatrixWriteJob,
  runSeedThreeBucketMatrixWriteSlices,
  writeSeedThreeLodMatrices,
  type SeedThreeBucketMatrixWriteJob,
  type SeedThreeInstancedLodSet as InstancedLodSet,
  type SeedThreeTreeSlot as TreeSlot,
} from './seedThreeForestCompaction.ts';
import { stabilizeSeedThreeForestCardMaterial } from './seedThreeForestMaterial.ts';
import {
  runForestBucketUpdateChunk,
  type SeedThreeBucketSelection,
} from '@seedthree/core/forest-update-budget.js';
import { yieldToMain } from '../../utils/yieldToMain.ts';
import type { DeciduousFoliagePresentation } from '../../world/deciduousFoliagePolicy.ts';

type SpeciesBucket = {
  preset: SeedThreePresetKey;
  slots: TreeSlot[];
  nearSet: InstancedLodSet;
  overviewSet: InstancedLodSet;
  nearSlotIndices: number[];
  overviewSlotIndices: number[];
};

export type SeedThreeForestInstances = {
  group: THREE.Group;
  placements: ForestTreePlacement[];
  buckets: SpeciesBucket[];
  slotByLayoutIndex: Array<{ bucketIndex: number; slotIndex: number } | null>;
  hiddenMatrix: THREE.Matrix4;
  visibilitySelector: ReturnType<typeof createForestLodSelector>;
  seasonalCardMaterials: THREE.Material[];
  deciduousFoliage: DeciduousFoliagePresentation;
  renderStats: SeedThreeForestRenderStats;
  pendingLodWork: {
    desired: SeedThreeBucketSelection[];
    pendingBucketIndices: number[];
    activeBucketJob: {
      bucketIndex: number;
      desired: SeedThreeBucketSelection;
      job: SeedThreeBucketMatrixWriteJob;
    } | null;
  } | null;
  updateTelemetry: SeedThreeForestUpdateTelemetry;
};

export type SeedThreeForestUpdateTelemetry = {
  selectorCalls: number;
  selectorEvaluations: number;
  selectorSkips: number;
  triggerReasons: Record<string, number>;
  selectionChanges: number;
  bucketCompactions: number;
  maxBucketCompactionsPerUpdate: number;
  workChunks: number;
  matrixWrites: number;
  timeBudgetStops: number;
  pendingBuckets: number;
  lastDurationMs: number;
  maxDurationMs: number;
};

export type SeedThreeForestBudgetedUpdateResult = {
  selectionChanged: boolean;
  selectorSkipped: boolean;
  triggerReasons: readonly string[];
  bucketCompactions: number;
  workChunks: number;
  matrixWrites: number;
  stopReason: string;
  pendingBuckets: number;
  durationMs: number;
};

export type SeedThreeForestRenderStats = {
  totalTrees: number;
  visibleTrees: number;
  nearTrees: number;
  overviewTrees: number;
  culledTrees: number;
  revision: number;
};

const FOREST_LOD_OPTS = {
  mobileTarget: true,
  meshQuality: 0.78,
  lod1Dist: 48,
  lod2Dist: 96,
  lod1Density: 0.88,
  lod2Density: 0.72,
  lod1Pct: 42,
  lod2Pct: 14,
};

const FOREST_NEAR_DISTANCE = 108;
const FOREST_FIRST_PERSON_NEAR_DISTANCE = 132;
const FOREST_VISIBILITY_PADDING = 26;
const FOREST_UPDATE_BOOKKEEPING_HEADROOM_MS = 0.35;

const OVERVIEW_CANOPY_TONE: Record<
  SeedThreePresetKey,
  { tint: readonly [number, number, number]; variation: number }
> = {
  americanBeech: { tint: [0.78, 0.86, 0.72], variation: 0.07 },
  whiteOak: { tint: [0.75, 0.84, 0.68], variation: 0.08 },
  redMaple: { tint: [0.72, 0.83, 0.67], variation: 0.08 },
  sweetgum: { tint: [0.76, 0.86, 0.66], variation: 0.07 },
  douglasFir: { tint: [0.44, 0.59, 0.49], variation: 0.08 },
  loblolly: { tint: [0.4, 0.55, 0.44], variation: 0.09 },
  pine: { tint: [0.47, 0.61, 0.45], variation: 0.09 },
};

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const COMPOSE_POS = new THREE.Vector3();
const COMPOSE_QUAT = new THREE.Quaternion();
const COMPOSE_SCALE = new THREE.Vector3();
const COMPOSE_MATRIX = new THREE.Matrix4();

function composeTreeMatrix(
  x: number,
  y: number,
  z: number,
  rotY: number,
  scale: number,
): THREE.Matrix4 {
  COMPOSE_QUAT.setFromAxisAngle(Y_AXIS, rotY);
  COMPOSE_POS.set(x, y, z);
  COMPOSE_SCALE.setScalar(scale);
  return COMPOSE_MATRIX.compose(COMPOSE_POS, COMPOSE_QUAT, COMPOSE_SCALE).clone();
}

function findLodLevel(tree: THREE.LOD, lodName: string): THREE.Object3D | undefined {
  const levels = tree.levels as Array<{ distance: number; object: THREE.Object3D }>;
  return levels.find((level) => level.object.userData.lodName === lodName)?.object;
}

function createInstancedLodSet(
  sourceLevel: THREE.Object3D | undefined,
  slots: TreeSlot[],
  rng: Rng,
  debugName: string,
  options: {
    includeBranches?: boolean;
    castShadow?: boolean;
    seasonalDeciduous?: boolean;
    seasonalCardMaterials?: Set<THREE.Material>;
    canopyTint?: readonly [number, number, number];
    autumnColor?: readonly [number, number, number];
    toneVariation?: number;
  } = {},
): InstancedLodSet {
  const groupCount = slots.length;
  const lodSet: InstancedLodSet = { branches: null, cards: [] };
  if (!sourceLevel) return lodSet;
  const includeBranches = options.includeBranches ?? true;
  const castShadow = options.castShadow ?? true;

  for (const child of sourceLevel.children) {
    const instancedChild = child as THREE.InstancedMesh;
    if (includeBranches && child.type === 'Mesh' && !instancedChild.isInstancedMesh) {
      const mesh = child as THREE.Mesh;
      const geo = mesh.geometry.clone();
      geo.userData.forestClone = true;
      geo.setAttribute('aWindVec', new THREE.InstancedBufferAttribute(new Float32Array(groupCount * 3), 3));
      geo.setAttribute('aAnchorPos', new THREE.InstancedBufferAttribute(new Float32Array(groupCount * 3), 3));
      const im = new THREE.InstancedMesh(geo, forestBarkMaterial(mesh.material as THREE.Material), groupCount);
      im.name = `${debugName} branches`;
      im.castShadow = castShadow;
      im.receiveShadow = true;
      im.userData.neverCastShadow = !castShadow;
      // SeedThree performs conservative per-tree culling and compacts the live
      // instances; the aggregate mesh bound is intentionally not consulted.
      im.frustumCulled = false;
      lodSet.branches = im;
    } else if ((child as THREE.Group).isGroup) {
      for (const cardsMesh of (child as THREE.Group).children) {
        const instanced = cardsMesh as THREE.InstancedMesh;
        if (!instanced.isInstancedMesh) continue;
        const cardsPerTree = instanced.count;
        const total = cardsPerTree * groupCount;
        const geo = instanced.geometry.clone();
        geo.userData.forestClone = true;
        const thickness = new Float32Array(total);
        for (let t = 0; t < total; t++) thickness[t] = 0.4 + 0.6 * rng.next();
        geo.setAttribute('aThickness', new THREE.InstancedBufferAttribute(thickness, 1));
        geo.setAttribute('aTreeOrigin', new THREE.InstancedBufferAttribute(new Float32Array(total * 3), 3));
        geo.setAttribute('aWindVec', new THREE.InstancedBufferAttribute(new Float32Array(total * 3), 3));
        geo.setAttribute('aAnchorPos', new THREE.InstancedBufferAttribute(new Float32Array(total * 3), 3));

        const rebuilt = new Set([
          'aThickness',
          'aTreeOrigin',
          'aWindVec',
          'aAnchorPos',
        ]);
        for (const [name, attr] of Object.entries(instanced.geometry.attributes)) {
          const instancedAttr = attr as THREE.InstancedBufferAttribute;
          if (!instancedAttr.isInstancedBufferAttribute || rebuilt.has(name)) continue;
          const arr = new Float32Array(total * instancedAttr.itemSize);
          for (let slot = 0; slot < groupCount; slot++) {
            arr.set(
              instancedAttr.array.subarray(0, cardsPerTree * instancedAttr.itemSize),
              slot * cardsPerTree * instancedAttr.itemSize,
            );
          }
          geo.setAttribute(name, new THREE.InstancedBufferAttribute(arr, instancedAttr.itemSize));
        }

        const fmat = stabilizeSeedThreeForestCardMaterial(
          (instanced.userData.shareMaterial
            ? instanced.material
            : forestCardMaterial(instanced.material as THREE.Material, {
                seasonalDeciduous: options.seasonalDeciduous,
                canopyTint: options.canopyTint,
                autumnColor: options.autumnColor,
                toneVariation: options.toneVariation,
              })) as THREE.Material,
        );
        if (options.seasonalDeciduous) {
          options.seasonalCardMaterials?.add(fmat as THREE.Material);
        }
        const im = new THREE.InstancedMesh(geo, fmat as THREE.Material, total) as THREE.InstancedMesh & {
          userData: Record<string, unknown>;
        };
        im.name = `${debugName} cards`;
        im.castShadow = castShadow;
        im.receiveShadow = true;
        im.frustumCulled = false;
        im.userData.neverCastShadow = !castShadow;
        im.userData.src = instanced;
        im.userData.k = cardsPerTree;

        const snap = new Float32Array(cardsPerTree * 16);
        const cardMatrix = new THREE.Matrix4();
        for (let j = 0; j < cardsPerTree; j++) {
          instanced.getMatrixAt(j, cardMatrix);
          snap.set(cardMatrix.elements, j * 16);
        }
        im.userData.srcMatrices = snap;
        im.userData.weights = (instanced.userData.windWeights as Float32Array | undefined)?.slice() ?? null;
        lodSet.cards.push(im);
      }
    }
  }

  return lodSet;
}

function createSpeciesBucket(
  presetKey: SeedThreePresetKey,
  slots: TreeSlot[],
  prototype: THREE.LOD,
  rng: Rng,
  seasonalCardMaterials: Set<THREE.Material>,
): SpeciesBucket {
  const nearLevel = findLodLevel(prototype, 'LOD2');
  // LOD4's crossed whole-limb cards read as flat green triangles from the
  // settlement camera. LOD3 retains real primary branches and overlapping
  // terminal-twig cards, spending available headroom on a volumetric silhouette.
  const overviewLevel = findLodLevel(prototype, 'LOD3')
    ?? findLodLevel(prototype, 'LOD4')
    ?? nearLevel;
  const overviewTone = OVERVIEW_CANOPY_TONE[presetKey];
  const seasonalDeciduous = slots.some((slot) => slot.seasonalDeciduous);
  const autumnColor = autumnFoliageColorForPreset(presetKey);
  const nearSet = createInstancedLodSet(
    nearLevel,
    slots,
    rng,
    `${presetKey} near LOD2`,
    {
      seasonalDeciduous,
      seasonalCardMaterials,
      autumnColor,
    },
  );
  const overviewSet = createInstancedLodSet(
    overviewLevel,
    slots,
    new Rng(`overview:${presetKey}`),
    `${presetKey} overview ${overviewLevel?.userData.lodName ?? 'LOD2'}`,
    {
      seasonalDeciduous,
      seasonalCardMaterials,
      canopyTint: overviewTone.tint,
      autumnColor,
      toneVariation: overviewTone.variation,
    },
  );
  const nearSlotIndices = slots.map((_, index) => index);
  const overviewSlotIndices: number[] = [];
  writeSeedThreeLodMatrices(nearSet, slots, nearSlotIndices);
  writeSeedThreeLodMatrices(overviewSet, slots, overviewSlotIndices);
  return {
    preset: presetKey,
    slots,
    nearSet,
    overviewSet,
    nearSlotIndices,
    overviewSlotIndices,
  };
}

export async function createSeedThreeForest(
  placements: ForestTreePlacement[],
  terrain: Terrain,
  maxAnisotropy: number,
  treeSeed: number,
  renderer: WebGPURenderer,
): Promise<SeedThreeForestInstances> {
  const rng = new Rng(`gorski-kotar:${treeSeed}`);
  const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  const group = new THREE.Group();
  group.name = 'SeedThree Gorski Kotar forest';

  const assetsByPreset = new Map<SeedThreePresetKey, SeedThreeSpeciesAssets>();
  const prototypeByPreset = new Map<SeedThreePresetKey, THREE.LOD>();

  for (const presetKey of GORSKI_KOTAR_PRESETS) {
    const species = GORSKI_KOTAR_SPECIES[presetKey];
    if (!species) continue;
    const assets = await loadSeedThreeSpeciesAssets(species, maxAnisotropy);
    assetsByPreset.set(presetKey, assets);
    const branchCards = await ensureSeedThreeBranchCards(
      renderer,
      species,
      assets,
      FOREST_LOD_OPTS.mobileTarget,
    );
    if (!branchCards) {
      console.warn('[SeedThree] no branch cards for', presetKey, '— foliage may be missing');
    }
    const { group: prototype } = buildTree(species, `prototype:${presetKey}`, assets, {
      ...FOREST_LOD_OPTS,
      branchCards: branchCards ?? undefined,
    });
    prototypeByPreset.set(presetKey, prototype as THREE.LOD);
    await yieldToMain();
  }

  const placementsByPreset = new Map<SeedThreePresetKey, TreeSlot[]>();
  const visibilityItems: Array<{ x: number; y: number; z: number; radius: number }> = Array.from(
    { length: placements.length },
    () => ({ x: 0, y: 0, z: 0, radius: 1 }),
  );
  const slotByLayoutIndex: Array<{ bucketIndex: number; slotIndex: number } | null> = Array.from(
    { length: placements.length },
    () => null,
  );

  placements.forEach((placement, layoutIndex) => {
    const preset = resolveSeedThreePreset(placement.species);
    const scale = seedThreeScaleForPreset(preset, placement.scale);
    const rootY = terrain.getHeightAt(placement.x, placement.z);
    const rotY = rng.range(0, Math.PI * 2);
    const matrix = composeTreeMatrix(placement.x, rootY - 0.15 * scale, placement.z, rotY, scale);
    const speciesHeight = Number(GORSKI_KOTAR_SPECIES[preset]?.params?.scale ?? 20) * scale;
    const visibilityRadius = Math.max(5, speciesHeight * 0.58);
    const visibilityCenter = new THREE.Vector3(
      placement.x,
      rootY + speciesHeight * 0.5,
      placement.z,
    );
    const slot: TreeSlot = {
      layoutIndex,
      matrix,
      pos: new THREE.Vector3(placement.x, rootY, placement.z),
      visibilityCenter,
      visibilityRadius,
      enabled: true,
      seasonalDeciduous: gorskiKotarSpeciesIsDeciduous(placement.species),
    };
    visibilityItems[layoutIndex] = {
      x: visibilityCenter.x,
      y: visibilityCenter.y,
      z: visibilityCenter.z,
      radius: visibilityRadius,
    };
    const bucket = placementsByPreset.get(preset) ?? [];
    bucket.push(slot);
    placementsByPreset.set(preset, bucket);
  });

  const buckets: SpeciesBucket[] = [];
  const seasonalCardMaterials = new Set<THREE.Material>();

  for (const presetKey of GORSKI_KOTAR_PRESETS) {
    const slots = placementsByPreset.get(presetKey);
    if (!slots?.length) continue;
    const prototype = prototypeByPreset.get(presetKey);
    if (!prototype) continue;

    const bucketIndex = buckets.length;
    slots.forEach((slot, slotIndex) => {
      slotByLayoutIndex[slot.layoutIndex] = { bucketIndex, slotIndex };
    });

    buckets.push(createSpeciesBucket(
      presetKey,
      slots,
      prototype,
      new Rng(`bucket:${presetKey}:${treeSeed}`),
      seasonalCardMaterials,
    ));
  }

  for (const bucket of buckets) {
    if (bucket.nearSet.branches) group.add(bucket.nearSet.branches);
    for (const cardMesh of bucket.nearSet.cards) group.add(cardMesh);
    if (bucket.overviewSet.branches) group.add(bucket.overviewSet.branches);
    for (const cardMesh of bucket.overviewSet.cards) group.add(cardMesh);
  }

  const visibilitySelector = createForestLodSelector(visibilityItems, {
    cellSize: 48,
    frustumPadding: FOREST_VISIBILITY_PADDING,
    nearDistance: FOREST_NEAR_DISTANCE,
    lodHysteresis: 14,
    minimumCameraMove: 2.25,
    minimumDirectionAngle: THREE.MathUtils.degToRad(1),
  });
  return {
    group,
    placements,
    buckets,
    slotByLayoutIndex,
    hiddenMatrix,
    visibilitySelector,
    seasonalCardMaterials: [...seasonalCardMaterials],
    deciduousFoliage: {
      springFlush: 0,
      autumnColor: 0,
      dormancy: 0,
    },
    renderStats: {
      totalTrees: placements.length,
      visibleTrees: placements.length,
      nearTrees: placements.length,
      overviewTrees: 0,
      culledTrees: 0,
      revision: 0,
    },
    pendingLodWork: null,
    updateTelemetry: createSeedThreeUpdateTelemetry(),
  };
}

export function setSeedThreeTreeVisible(
  forest: SeedThreeForestInstances,
  layoutIndex: number,
  visible: boolean,
): void {
  const mapping = forest.slotByLayoutIndex[layoutIndex];
  if (!mapping) return;
  const bucket = forest.buckets[mapping.bucketIndex];
  if (!bucket) return;
  const slot = bucket.slots[mapping.slotIndex];
  if (!slot) return;
  slot.enabled = visible;
}

export function commitSeedThreeForestMatrices(forest: SeedThreeForestInstances): void {
  for (const bucket of forest.buckets) {
    writeSeedThreeLodMatrices(bucket.nearSet, bucket.slots, bucket.nearSlotIndices);
    writeSeedThreeLodMatrices(bucket.overviewSet, bucket.slots, bucket.overviewSlotIndices);
  }
  forest.pendingLodWork = null;
  refreshSeedThreeRenderStats(forest);
}

function refreshSeedThreeRenderStats(forest: SeedThreeForestInstances): void {
  let totalTrees = 0;
  let nearTrees = 0;
  let overviewTrees = 0;
  for (const bucket of forest.buckets) {
    totalTrees += bucket.slots.reduce(
      (count, slot) => count + (slot.enabled ? 1 : 0),
      0,
    );
    nearTrees += bucket.nearSlotIndices.reduce(
      (count, slotIndex) => count + (bucket.slots[slotIndex]?.enabled ? 1 : 0),
      0,
    );
    overviewTrees += bucket.overviewSlotIndices.reduce(
      (count, slotIndex) => count + (bucket.slots[slotIndex]?.enabled ? 1 : 0),
      0,
    );
  }
  const visibleTrees = nearTrees + overviewTrees;
  forest.renderStats = {
    totalTrees,
    visibleTrees,
    nearTrees,
    overviewTrees,
    culledTrees: Math.max(0, totalTrees - visibleTrees),
    revision: forest.renderStats.revision,
  };
}

export function updateSeedThreeForestCamera(
  forest: SeedThreeForestInstances,
  camera: THREE.Camera,
  firstPersonActive: boolean,
  casterBounds: { minX: number; maxX: number; minZ: number; maxZ: number },
): boolean {
  const result = updateSeedThreeForestCameraBudgeted(
    forest,
    camera,
    firstPersonActive,
    casterBounds,
    { maxBucketCompactions: Number.POSITIVE_INFINITY },
  );
  return result.selectionChanged || result.bucketCompactions > 0;
}

export function updateSeedThreeForestCameraBudgeted(
  forest: SeedThreeForestInstances,
  camera: THREE.Camera,
  firstPersonActive: boolean,
  casterBounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  options: {
    maxBucketCompactions: number;
    maxUpdateDurationMs?: number;
    maxMatrixWritesPerChunk?: number;
    minimumCameraMove?: number;
    minimumDirectionAngle?: number;
    minimumProjectionChange?: number;
    minimumCasterBoundsChange?: number;
  },
): SeedThreeForestBudgetedUpdateResult {
  const startedAt = performance.now();
  const selection = selectForestLods(forest.visibilitySelector, camera, {
    nearDistance: firstPersonActive
      ? FOREST_FIRST_PERSON_NEAR_DISTANCE
      : FOREST_NEAR_DISTANCE,
    frustumPadding: firstPersonActive
      ? FOREST_VISIBILITY_PADDING + 8
      : FOREST_VISIBILITY_PADDING,
    casterBounds,
    // Matches the directional-shadow fitter's broad-canopy horizontal margin.
    casterPadding: 14,
    ...(options.minimumCameraMove === undefined
      ? {}
      : { minimumCameraMove: options.minimumCameraMove }),
    ...(options.minimumDirectionAngle === undefined
      ? {}
      : { minimumDirectionAngle: options.minimumDirectionAngle }),
    ...(options.minimumProjectionChange === undefined
      ? {}
      : { minimumProjectionChange: options.minimumProjectionChange }),
    ...(options.minimumCasterBoundsChange === undefined
      ? {}
      : { minimumCasterBoundsChange: options.minimumCasterBoundsChange }),
  });
  forest.updateTelemetry.selectorCalls += 1;
  forest.updateTelemetry.selectorEvaluations += selection.skipped ? 0 : 1;
  forest.updateTelemetry.selectorSkips += selection.skipped ? 1 : 0;
  for (const reason of selection.triggerReasons) {
    forest.updateTelemetry.triggerReasons[reason] =
      (forest.updateTelemetry.triggerReasons[reason] ?? 0) + 1;
  }
  if (selection.changed) {
    forest.updateTelemetry.selectionChanges += 1;
    forest.pendingLodWork = {
      desired: selectionsByBucket(forest, selection),
      pendingBucketIndices: forest.pendingLodWork?.pendingBucketIndices ?? [],
      activeBucketJob: forest.pendingLodWork?.activeBucketJob ?? null,
    };
  }

  const work = forest.pendingLodWork;
  let bucketCompactions = 0;
  let matrixWrites = 0;
  let workChunks = 0;
  let matrixSliceBudgetStop: 'time-limit' | 'headroom-limit' | null = null;
  let stopReason = work ? 'chunk-limit' : 'converged';
  if (work) {
    const maxUpdateDurationMs = Number.isFinite(options.maxUpdateDurationMs)
      ? Math.max(0, options.maxUpdateDurationMs!)
      : Number.POSITIVE_INFINITY;
    const selectorAndBookkeepingMs = performance.now() - startedAt
      + (Number.isFinite(maxUpdateDurationMs)
        ? FOREST_UPDATE_BOOKKEEPING_HEADROOM_MS
        : 0);
    const availableWorkMs = Number.isFinite(maxUpdateDurationMs)
      ? Math.max(0, maxUpdateDurationMs - selectorAndBookkeepingMs)
      : Number.POSITIVE_INFINITY;
    const currentSelections = forest.buckets.map((bucket) => ({
      near: bucket.nearSlotIndices,
      overview: bucket.overviewSlotIndices,
    }));
    const chunk = runForestBucketUpdateChunk(
      currentSelections,
      work.desired,
      work.pendingBucketIndices,
      {
        maxDurationMs: availableWorkMs,
        minimumChunkHeadroomMs: Number.isFinite(availableWorkMs) ? 0.12 : 0,
        maxChunks: Number.isFinite(maxUpdateDurationMs)
          ? 1
          : Number.POSITIVE_INFINITY,
        maxBucketCompletions: options.maxBucketCompactions,
        now: () => performance.now(),
        applyBucketChunk: (bucketIndex, context) => {
          const bucket = forest.buckets[bucketIndex];
          const desired = work.desired[bucketIndex];
          if (!bucket || !desired) return true;
          if (
            !work.activeBucketJob
            || work.activeBucketJob.bucketIndex !== bucketIndex
            || !sameBucketSelection(work.activeBucketJob.desired, desired)
          ) {
            work.activeBucketJob = {
              bucketIndex,
              desired: {
                near: [...desired.near],
                overview: [...desired.overview],
              },
              job: createSeedThreeBucketMatrixWriteJob(
                bucket.nearSet,
                bucket.overviewSet,
                bucket.slots,
                desired.near,
                desired.overview,
              ),
            };
          }
          const result = runSeedThreeBucketMatrixWriteSlices(
            work.activeBucketJob.job,
            {
              deadlineMs: context.deadlineMs,
              minimumChunkHeadroomMs: Number.isFinite(context.remainingMs)
                ? 0.12
                : 0,
              maxMatrixWritesPerChunk: options.maxMatrixWritesPerChunk
                ?? Number.POSITIVE_INFINITY,
            },
          );
          workChunks += result.chunks;
          matrixWrites += result.matrixWrites;
          matrixSliceBudgetStop = result.stopReason === 'time-limit'
            || result.stopReason === 'headroom-limit'
            ? result.stopReason
            : null;
          if (!result.completed) return false;
          bucket.nearSlotIndices = [...desired.near];
          bucket.overviewSlotIndices = [...desired.overview];
          work.activeBucketJob = null;
          return true;
        },
      },
    );
    bucketCompactions = chunk.completedBucketIndices.length;
    stopReason = chunk.stopReason;
    if (chunk.stopReason === 'chunk-limit' && matrixSliceBudgetStop) {
      stopReason = matrixSliceBudgetStop;
    }
    work.pendingBucketIndices = chunk.pendingBucketIndices;
    if (
      work.activeBucketJob
      && chunk.cancelledBucketIndices.includes(work.activeBucketJob.bucketIndex)
    ) {
      work.activeBucketJob = null;
    }
    if (work.pendingBucketIndices.length === 0) forest.pendingLodWork = null;
  }

  if (bucketCompactions > 0) refreshSeedThreeRenderStats(forest);
  if (selection.changed) forest.renderStats.revision = selection.revision;
  const durationMs = performance.now() - startedAt;
  forest.updateTelemetry.bucketCompactions += bucketCompactions;
  forest.updateTelemetry.maxBucketCompactionsPerUpdate = Math.max(
    forest.updateTelemetry.maxBucketCompactionsPerUpdate,
    bucketCompactions,
  );
  forest.updateTelemetry.workChunks += workChunks;
  forest.updateTelemetry.matrixWrites += matrixWrites;
  forest.updateTelemetry.timeBudgetStops += stopReason === 'time-limit'
    || stopReason === 'headroom-limit'
    ? 1
    : 0;
  forest.updateTelemetry.pendingBuckets =
    forest.pendingLodWork?.pendingBucketIndices.length ?? 0;
  forest.updateTelemetry.lastDurationMs = durationMs;
  forest.updateTelemetry.maxDurationMs = Math.max(
    forest.updateTelemetry.maxDurationMs,
    durationMs,
  );
  return {
    selectionChanged: selection.changed,
    selectorSkipped: selection.skipped,
    triggerReasons: [...selection.triggerReasons],
    bucketCompactions,
    workChunks,
    matrixWrites,
    stopReason,
    pendingBuckets: forest.updateTelemetry.pendingBuckets,
    durationMs,
  };
}

function sameBucketSelection(
  left: SeedThreeBucketSelection,
  right: SeedThreeBucketSelection,
): boolean {
  return sameIndices(left.near, right.near)
    && sameIndices(left.overview, right.overview);
}

function sameIndices(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function selectionsByBucket(
  forest: SeedThreeForestInstances,
  selection: { nearIndices: readonly number[]; overviewIndices: readonly number[] },
): SeedThreeBucketSelection[] {
  const desired = forest.buckets.map(() => ({
    near: [] as number[],
    overview: [] as number[],
  }));
  for (const layoutIndex of selection.nearIndices) {
    const mapping = forest.slotByLayoutIndex[layoutIndex];
    if (mapping) desired[mapping.bucketIndex]?.near.push(mapping.slotIndex);
  }
  for (const layoutIndex of selection.overviewIndices) {
    const mapping = forest.slotByLayoutIndex[layoutIndex];
    if (mapping) desired[mapping.bucketIndex]?.overview.push(mapping.slotIndex);
  }
  return desired;
}

function createSeedThreeUpdateTelemetry(): SeedThreeForestUpdateTelemetry {
  return {
    selectorCalls: 0,
    selectorEvaluations: 0,
    selectorSkips: 0,
    triggerReasons: {},
    selectionChanges: 0,
    bucketCompactions: 0,
    maxBucketCompactionsPerUpdate: 0,
    workChunks: 0,
    matrixWrites: 0,
    timeBudgetStops: 0,
    pendingBuckets: 0,
    lastDurationMs: 0,
    maxDurationMs: 0,
  };
}

export function getSeedThreeForestStructuralStats(forest: SeedThreeForestInstances): {
  draws: number;
  triangles: number;
  instances: number;
  trees: SeedThreeForestRenderStats;
  ecology: {
    counts: {
      anchors: number;
      saplings: number;
      understory: number;
      deadwood: number;
      litter: number;
    };
    draws: number;
    instances: number;
    triangles: number;
  };
} {
  let draws = 0;
  let triangles = 0;
  let instances = 0;
  forest.group.traverse((object: THREE.Object3D) => {
    const mesh = object as THREE.InstancedMesh;
    if (!mesh.isInstancedMesh || mesh.count <= 0) return;
    draws++;
    instances += mesh.count;
    const geometryTriangles = mesh.geometry.index
      ? mesh.geometry.index.count / 3
      : mesh.geometry.attributes.position.count / 3;
    triangles += geometryTriangles * mesh.count;
  });
  return {
    draws,
    triangles: Math.round(triangles),
    instances,
    trees: { ...forest.renderStats },
    ecology: {
      counts: {
        anchors: 0,
        saplings: 0,
        understory: 0,
        deadwood: 0,
        litter: 0,
      },
      draws: 0,
      instances: 0,
      triangles: 0,
    },
  };
}

export function setSeedThreeForestShadows(forest: SeedThreeForestInstances, enabled: boolean): void {
  forest.group.traverse((object: THREE.Object3D) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = enabled && mesh.userData.neverCastShadow !== true;
  });
}

export function setSeedThreeForestDeciduousFoliage(
  forest: SeedThreeForestInstances,
  presentation: DeciduousFoliagePresentation,
): void {
  const next = {
    springFlush: THREE.MathUtils.clamp(
      Number.isFinite(presentation.springFlush) ? presentation.springFlush : 0,
      0,
      1,
    ),
    autumnColor: THREE.MathUtils.clamp(
      Number.isFinite(presentation.autumnColor) ? presentation.autumnColor : 0,
      0,
      1,
    ),
    dormancy: THREE.MathUtils.clamp(
      Number.isFinite(presentation.dormancy) ? presentation.dormancy : 0,
      0,
      1,
    ),
  };
  if (
    forest.deciduousFoliage.springFlush === next.springFlush
    && forest.deciduousFoliage.autumnColor === next.autumnColor
    && forest.deciduousFoliage.dormancy === next.dormancy
  ) return;
  forest.deciduousFoliage = next;
  for (const material of forest.seasonalCardMaterials) {
    setForestCardSeason(material, next);
  }
}

export function disposeSeedThreeForest(forest: SeedThreeForestInstances): void {
  forest.group.traverse((object: THREE.Object3D) => {
    const mesh = object as THREE.InstancedMesh;
    if (!mesh.isInstancedMesh) return;
    if (mesh.geometry.userData.forestClone) mesh.geometry.dispose();
    mesh.dispose();
  });
}

export function createSeedThreeForestController(forest: SeedThreeForestInstances): SeedThreeForestController {
  return {
    hideTree: (layoutIndex) => setSeedThreeTreeVisible(forest, layoutIndex, false),
    showTree: (layoutIndex) => setSeedThreeTreeVisible(forest, layoutIndex, true),
    commit: () => commitSeedThreeForestMatrices(forest),
    updateCamera: (camera, firstPersonActive, casterBounds) =>
      updateSeedThreeForestCamera(forest, camera, firstPersonActive, casterBounds),
    getStructuralStats: () => getSeedThreeForestStructuralStats(forest),
    setDeciduousFoliage: (presentation) =>
      setSeedThreeForestDeciduousFoliage(forest, presentation),
    setShadows: (enabled) => setSeedThreeForestShadows(forest, enabled),
    dispose: () => disposeSeedThreeForest(forest),
  };
}
