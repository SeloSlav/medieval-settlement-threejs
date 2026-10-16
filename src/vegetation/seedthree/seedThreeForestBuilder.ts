import * as THREE from 'three';
import { InstanceDrawCompaction } from '../../scene/InstanceDrawCompaction.ts';
import { GroupedInstanceDraws } from '../../scene/GroupedInstanceDraws.ts';
import { StaticRenderBundle } from '../../scene/StaticRenderBundle.ts';
import { setExactInstancePrototype } from '../../scene/ExactInstancePrototype.ts';
import {
  StorageInstancedBufferAttribute,
  type WebGPURenderer,
} from 'three/webgpu';
import { buildTree, forestBarkMaterial } from '@seedthree/core/tree.js';
import {
  forestCardMaterial,
  setForestCardSnowCoverage,
  setForestCardSeason,
} from '@seedthree/core/branch-cards.js';
import { windSpeed, windStrength } from '@seedthree/core/wind.js';
import {
  createForestLodSelector,
  selectForestLods,
} from '@seedthree/core/forest-lod.js';
import { Rng } from '@seedthree/core/rng.js';
import type { Terrain } from '../../terrain/Terrain.ts';
import type { ForestTreePlacement } from '../../props/forestPlacements.ts';
import type { HarvestStumpBarkSource } from '../../props/RoadStumps.ts';
import {
  autumnFoliageColorForPreset,
  GORSKI_KOTAR_PRESETS,
  gorskiKotarSpeciesIsDeciduous,
  resolveSeedThreePreset,
  seedThreeScaleForPreset,
  type SeedThreePresetKey,
} from './gorskiKotarSpecies.ts';
import { GORSKI_KOTAR_SPECIES } from './gorskiKotarPresets.ts';
import {
  getCachedSeedThreeSpeciesAssets,
  getSeedThreeSpeciesAssetStartupTimings,
  loadSeedThreeSpeciesAssets,
  type SeedThreeSpeciesAssets,
  type SeedThreeSpeciesAssetStartupTiming,
} from './seedThreeAssets.ts';

export function resolveSeedThreeHarvestStumpBark(
  gameplaySpecies: string,
): HarvestStumpBarkSource | null {
  const key = resolveSeedThreePreset(gameplaySpecies);
  const species = GORSKI_KOTAR_SPECIES[key];
  if (!species) return null;
  const assets = getCachedSeedThreeSpeciesAssets(species.name);
  if (!assets?.barkTexture) return null;
  return {
    key,
    name: species.name,
    map: assets.barkTexture,
    normalMap: assets.barkNormal,
    roughnessMap: assets.barkRoughness,
  };
}
import {
  ensureSeedThreeBranchCards,
  getSeedThreeBranchCardStartupTimings,
  preloadSeedThreeBranchCardCache,
  type SeedThreeBranchCardStartupTiming,
} from './seedThreeBranchCards.ts';
import type {
  SeedThreeForestController,
  SeedThreeForestProfileBreakdown,
  SeedThreeForestStructuralStats,
  SeedThreeForestSubmissionStats,
} from './seedThreeForestTypes.ts';
import {
  createSeedThreeBucketMatrixWriteJob,
  createSeedThreeExactShadowLodSet,
  createSeedThreeStableColorSlotSelection,
  createSeedThreeStableRtsShadowSlotSelection,
  configureSeedThreeForestPassMesh,
  patchSeedThreeLodSlotVisibility,
  runSeedThreeBucketMatrixWriteSlices,
  seedThreeColorSelectionCoversView,
  seedThreeResidentSelectionCoversView,
  writeSeedThreeLodMatrices,
  type SeedThreeBucketMatrixWriteJob,
  type SeedThreeInstancedLodSet as InstancedLodSet,
  type SeedThreeTreeSlot as TreeSlot,
} from './seedThreeForestCompaction.ts';
import {
  applySeedThreeAutumnColor,
  applySeedThreeBarkSnow,
  applySeedThreeForestBarkMotion,
  applySeedThreeForestCardMotion,
  applySeedThreeWholeCardDormancy,
  cloneSeedThreeForestMaterial,
  resolveSeedThreeForestCardMotion,
  stabilizeSeedThreeForestCardMaterial,
} from './seedThreeForestMaterial.ts';
import {
  SEEDTHREE_FOREST_WIND_SPEED,
  SEEDTHREE_FOREST_LOD_DISTANCES,
  selectSeedThreeTreeLod,
} from './seedThreeForestLod.ts';
import {
  runForestBucketUpdateChunk,
  type SeedThreeBucketSelection,
} from '@seedthree/core/forest-update-budget.js';
import type { DeciduousFoliagePresentation } from '../../world/deciduousFoliagePolicy.ts';
import { planSeedThreeForestInteractionWork } from './seedThreeForestInteraction.ts';

type SpeciesBucket = {
  preset: SeedThreePresetKey;
  horizonOnly: boolean;
  slots: TreeSlot[];
  nearSet: InstancedLodSet;
  nearShadowSet: InstancedLodSet;
  overviewSet: InstancedLodSet;
  farSet: InstancedLodSet;
  farSlotIndices: number[];
  colorLods: Int8Array;
  colorLodRevision: number;
  nearSlotIndices: number[];
  overviewSlotIndices: number[];
  nearViewSlotIndices: number[];
  overviewViewSlotIndices: number[];
  nearViewSlotCount: number;
  overviewViewSlotCount: number;
};

type PassPartitionedBucketSelection = SeedThreeBucketSelection & {
  viewNear: readonly number[];
  viewOverview: readonly number[];
  nearViewSlotCount: number;
  overviewViewSlotCount: number;
};

export type SeedThreeForestInstances = {
  renderer: WebGPURenderer;
  group: THREE.Group;
  placements: ForestTreePlacement[];
  buckets: SpeciesBucket[];
  slotByLayoutIndex: Array<{ bucketIndex: number; slotIndex: number } | null>;
  hiddenMatrix: THREE.Matrix4;
  visibilitySelector: ReturnType<typeof createForestLodSelector>;
  seasonalCardMaterials: THREE.Material[];
  snowCardMaterials: THREE.Material[];
  shadowsEnabled: boolean;
  deciduousFoliage: DeciduousFoliagePresentation;
  snowCoverage: number;
  renderStats: SeedThreeForestRenderStats;
  pendingLodWork: {
    desired: PassPartitionedBucketSelection[];
    pendingBucketIndices: number[];
    activeBucketJob: {
      bucketIndex: number;
      desired: PassPartitionedBucketSelection;
      job: SeedThreeBucketMatrixWriteJob;
    } | null;
  } | null;
  visibilityDirty: boolean;
  dirtyVisibilitySlotsByBucket: Map<number, Set<number>>;
  cameraInteractionActive: boolean;
  ownedLodMaterials: THREE.Material[];
  updateTelemetry: SeedThreeForestUpdateTelemetry;
  compactedDraws?: Array<InstanceDrawCompaction | GroupedInstanceDraws>;
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
  coverageImmediateUpdates: number;
  maxCoverageImmediateDurationMs: number;
  pendingBuckets: number;
  lastDurationMs: number;
  maxDurationMs: number;
};

export type SeedThreeForestBudgetedUpdateResult = {
  selectionChanged: boolean;
  shadowCastersChanged: boolean;
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

export type SeedThreeForestSpeciesStartupTiming = {
  preset: SeedThreePresetKey;
  assetWaitMs: number;
  branchCardsMs: number;
  prototypeBuildMs: number;
};

export type SeedThreeForestStartupTiming = {
  preloadStartedAtMs: number | null;
  preloadCompletedAtMs: number | null;
  preloadDurationMs: number;
  totalMs: number;
  placementMs: number;
  bucketBuildMs: number;
  species: SeedThreeForestSpeciesStartupTiming[];
  assets: SeedThreeSpeciesAssetStartupTiming[];
  branchCards: SeedThreeBranchCardStartupTiming[];
};

let preloadStartedAtMs: number | null = null;
let preloadCompletedAtMs: number | null = null;
let preloadPromise: Promise<void> | null = null;
let preloadGeneration = 0;
let lastStartupTiming: SeedThreeForestStartupTiming | null = null;

const FOREST_LOD_OPTS = {
  mobileTarget: true,
  meshQuality: 0.78,
  lod1Dist: SEEDTHREE_FOREST_LOD_DISTANCES[1],
  lod2Dist: SEEDTHREE_FOREST_LOD_DISTANCES[2],
  lod1Density: 0.88,
  lod2Density: 0.72,
  lod1Pct: 42,
  lod2Pct: 14,
};

const FOREST_NEAR_DISTANCE = 108;
const FOREST_FIRST_PERSON_NEAR_DISTANCE = 132;
const FOREST_VISIBILITY_PADDING = 26;
const FOREST_UPDATE_BOOKKEEPING_HEADROOM_MS = 0.35;
const FOREST_CONTINUOUS_UPDATE_BUDGET_MS = 2.75;
const FOREST_MATRIX_WRITES_PER_CHUNK = 128;

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
  return COMPOSE_MATRIX.compose(
    COMPOSE_POS,
    COMPOSE_QUAT,
    COMPOSE_SCALE,
  ).clone();
}

function findLodLevel(
  tree: THREE.LOD,
  lodName: string,
): THREE.Object3D | undefined {
  const levels = tree.levels as Array<{
    distance: number;
    object: THREE.Object3D;
  }>;
  return levels.find((level) => level.object.userData.lodName === lodName)
    ?.object;
}

function createInstancedLodSet(
  sourceLevel: THREE.Object3D | undefined,
  slots: TreeSlot[],
  rng: Rng,
  debugName: string,
  options: {
    seasonalDeciduous: boolean;
    autumnColor: readonly [number, number, number];
    seasonalCardMaterials: Set<THREE.Material>;
    snowCardMaterials: Set<THREE.Material>;
    ownedLodMaterials: Set<THREE.Material>;
    lod: number;
  },
): InstancedLodSet {
  const groupCount = slots.length;
  const lodSet: InstancedLodSet = { branches: null, cards: [] };
  if (!sourceLevel) return lodSet;
  for (const child of sourceLevel.children) {
    if (
      child.type === 'Mesh' &&
      !(child as THREE.InstancedMesh).isInstancedMesh
    ) {
      const source = child as THREE.Mesh;
      const geometry = source.geometry.clone();
      setExactInstancePrototype(geometry, source.geometry);
      geometry.userData.forestClone = true;
      for (const name of ['aWindVec', 'aAnchorPos'])
        geometry.setAttribute(
          name,
          new THREE.InstancedBufferAttribute(
            new Float32Array(groupCount * 3),
            3,
          ),
        );
      const material = applySeedThreeBarkSnow(
        applySeedThreeForestBarkMotion(
          forestBarkMaterial(source.material as THREE.Material),
        ),
      );
      options.snowCardMaterials.add(material);
      const mesh = new THREE.InstancedMesh(geometry, material, groupCount);
      mesh.name = debugName + ' branches';
      mesh.frustumCulled = false;
      configureSeedThreeForestPassMesh(mesh, 'color', false);
      lodSet.branches = mesh;
    } else if ((child as THREE.Group).isGroup)
      for (const object of child.children) {
        const source = object as THREE.InstancedMesh;
        if (!source.isInstancedMesh) continue;
        const k = source.count,
          total = k * groupCount,
          geometry = source.geometry.clone();
        setExactInstancePrototype(geometry, source.geometry);
        geometry.userData.forestClone = true;
        const thickness = new Float32Array(total);
        for (let i = 0; i < total; i++) thickness[i] = 0.4 + 0.6 * rng.next();
        geometry.setAttribute(
          'aThickness',
          new THREE.InstancedBufferAttribute(thickness, 1),
        );
        const rebuilt = new Set([
          'aThickness',
          'aTreeOrigin',
          'aWindVec',
          'aAnchorPos',
        ]);
        for (const name of ['aTreeOrigin', 'aWindVec', 'aAnchorPos'])
          geometry.setAttribute(
            name,
            new THREE.InstancedBufferAttribute(new Float32Array(total * 3), 3),
          );
        for (const [name, raw] of Object.entries(source.geometry.attributes)) {
          const attribute = raw as THREE.InstancedBufferAttribute;
          if (!attribute.isInstancedBufferAttribute || rebuilt.has(name))
            continue;
          const values = new Float32Array(total * attribute.itemSize);
          for (let i = 0; i < groupCount; i++)
            values.set(
              attribute.array.subarray(0, k * attribute.itemSize),
              i * k * attribute.itemSize,
            );
          geometry.setAttribute(
            name,
            new THREE.InstancedBufferAttribute(values, attribute.itemSize),
          );
        }
        const original = source.material as THREE.Material;
        const cached = stabilizeSeedThreeForestCardMaterial(
          (source.userData.shareMaterial
            ? original
            : forestCardMaterial(original, {
                seasonalDeciduous: options.seasonalDeciduous,
                autumnColor: options.autumnColor,
              })) as THREE.Material,
        );
        applySeedThreeAutumnColor(cached, options.autumnColor);
        const material =
          options.lod > 0 ? cloneSeedThreeForestMaterial(cached) : cached;
        if (options.lod > 0) options.ownedLodMaterials.add(material);
        applySeedThreeForestCardMotion(
          material,
          resolveSeedThreeForestCardMotion(
            original.userData.seedThreeNoFlutter === true,
          ),
        );
        if (options.lod > 0 && options.seasonalDeciduous)
          applySeedThreeWholeCardDormancy(material);
        if (options.seasonalDeciduous)
          options.seasonalCardMaterials.add(material);
        options.snowCardMaterials.add(material);
        const mesh = new THREE.InstancedMesh(geometry, material, total);
        mesh.name = debugName + ' cards';
        mesh.frustumCulled = false;
        configureSeedThreeForestPassMesh(mesh, 'color', false);
        mesh.userData.seedThreeCanonicalThickness = geometry
          .getAttribute('aThickness')
          .clone();
        mesh.userData.k = k;
        mesh.userData.src = source;
        mesh.userData.srcMatrices = new Float32Array(
          source.instanceMatrix.array.slice(0, k * 16),
        );
        mesh.userData.weights =
          (source.userData.windWeights as Float32Array | undefined)?.slice() ??
          null;
        lodSet.cards.push(mesh);
      }
  }
  for (const mesh of lodSetMeshes(lodSet))
    mesh.userData.seedThreeLod = options.lod;
  return lodSet;
}

function createSpeciesBucket(
  presetKey: SeedThreePresetKey,
  slots: TreeSlot[],
  prototype: THREE.LOD,
  rng: Rng,
  seasonalCardMaterials: Set<THREE.Material>,
  snowCardMaterials: Set<THREE.Material>,
  ownedLodMaterials: Set<THREE.Material>,
  horizonOnly = false,
): SpeciesBucket {
  const options = {
    seasonalDeciduous: slots.some((slot) => slot.seasonalDeciduous),
    autumnColor: autumnFoliageColorForPreset(presetKey),
    seasonalCardMaterials,
    snowCardMaterials,
    ownedLodMaterials,
  };
  const nearSet = horizonOnly
    ? { branches: null, cards: [] }
    : createInstancedLodSet(
        findLodLevel(prototype, 'LOD2'),
        slots,
        rng,
        presetKey + ' near LOD2',
        { ...options, lod: 0 },
      );
  const overviewSet = horizonOnly
    ? { branches: null, cards: [] }
    : createInstancedLodSet(
        findLodLevel(prototype, 'LOD3'),
        slots,
        new Rng('middle:' + presetKey),
        presetKey + ' middle LOD3',
        { ...options, lod: 1 },
      );
  const farSet = createInstancedLodSet(
    findLodLevel(prototype, 'LOD4'),
    slots,
    new Rng('far:' + presetKey),
    presetKey + ' far LOD4',
    { ...options, lod: 2 },
  );
  const nearShadowSet = horizonOnly
    ? { branches: null, cards: [] }
    : createSeedThreeExactShadowLodSet(
        nearSet,
        presetKey + ' exact shadow LOD2',
      );
  const color = createSeedThreeStableColorSlotSelection(slots),
    shadow = createSeedThreeStableRtsShadowSlotSelection(slots);
  const farSlotIndices = slots.map((_, index) => index);
  writeSeedThreeLodMatrices(nearSet, slots, color.near);
  writeSeedThreeLodMatrices(overviewSet, slots, color.overview);
  writeSeedThreeLodMatrices(farSet, slots, farSlotIndices);
  writeSeedThreeLodMatrices(nearShadowSet, slots, shadow.near);
  return {
    preset: presetKey,
    horizonOnly,
    slots,
    nearSet,
    overviewSet,
    farSet,
    nearShadowSet,
    farSlotIndices,
    colorLods: new Int8Array(slots.length).fill(-1),
    colorLodRevision: 0,
    nearSlotIndices: shadow.near,
    overviewSlotIndices: shadow.overview,
    nearViewSlotIndices: color.near,
    overviewViewSlotIndices: color.overview,
    nearViewSlotCount: color.near.length,
    overviewViewSlotCount: color.overview.length,
  };
}

/** Begin immutable species texture fetch/decode before terrain generation ends. */
export async function preloadSeedThreeForestAssets(
  maxAnisotropy: number,
): Promise<void> {
  if (preloadPromise) return preloadPromise;
  const requestGeneration = preloadGeneration;
  preloadStartedAtMs = performance.now();
  const request = Promise.all(
    GORSKI_KOTAR_PRESETS.flatMap((presetKey) => {
      const species = GORSKI_KOTAR_SPECIES[presetKey];
      if (!species) return [];
      return [
        loadSeedThreeSpeciesAssets(species, maxAnisotropy).then(
          () => undefined,
        ),
        preloadSeedThreeBranchCardCache(species, FOREST_LOD_OPTS.mobileTarget),
      ];
    }),
  ).then(() => {
    if (requestGeneration === preloadGeneration) {
      preloadCompletedAtMs = performance.now();
    }
  });
  preloadPromise = request;
  try {
    return await request;
  } catch (error) {
    // A transient texture/decode failure must remain retryable by the actual
    // forest build; never retain a permanently rejected preload promise.
    if (requestGeneration === preloadGeneration && preloadPromise === request) {
      preloadPromise = null;
    }
    throw error;
  }
}

export function resetSeedThreeForestPreloadState(): void {
  preloadGeneration += 1;
  preloadPromise = null;
  preloadStartedAtMs = null;
  preloadCompletedAtMs = null;
  lastStartupTiming = null;
}

export function getSeedThreeForestStartupTiming(): SeedThreeForestStartupTiming | null {
  if (!lastStartupTiming) return null;
  return {
    ...lastStartupTiming,
    species: lastStartupTiming.species.map((timing) => ({ ...timing })),
    assets: lastStartupTiming.assets.map((timing) => ({ ...timing })),
    branchCards: lastStartupTiming.branchCards.map((timing) => ({ ...timing })),
  };
}

const forestPrototypeCache = new WeakMap<
  WebGPURenderer,
  Map<
    SeedThreePresetKey,
    {
      prototype: THREE.LOD;
      assets: SeedThreeSpeciesAssets;
      branchCards: Awaited<ReturnType<typeof ensureSeedThreeBranchCards>>;
    }
  >
>();

export async function createSeedThreeForest(
  placements: ForestTreePlacement[],
  terrain: Pick<Terrain, 'getHeightAt' | 'generationSize'>,
  maxAnisotropy: number,
  treeSeed: number,
  renderer: WebGPURenderer,
): Promise<SeedThreeForestInstances> {
  const startupStartedAt = performance.now();
  // SeedThree uses one wind uniform for every connected vegetation material;
  // slowing it here keeps bark, cards, undergrowth, and grass phase-locked.
  windSpeed.value = SEEDTHREE_FOREST_WIND_SPEED;
  const rng = new Rng(`gorski-kotar:${treeSeed}`);
  const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  const group = new THREE.Group();
  group.name = 'SeedThree Gorski Kotar forest';
  // All visible tree rungs are opaque authored cutouts.
  const opaqueDraws = new StaticRenderBundle();
  opaqueDraws.name = 'Cached opaque SeedThree forest draws';
  group.add(opaqueDraws);
  const horizonForestGroup = new THREE.Group();
  horizonForestGroup.name = 'SeedThree permanent terrain-horizon forest';
  horizonForestGroup.userData.gameplay = false;
  horizonForestGroup.userData.terrainHorizon = true;
  group.add(horizonForestGroup);

  const assetsByPreset = new Map<SeedThreePresetKey, SeedThreeSpeciesAssets>();
  const prototypeByPreset = new Map<SeedThreePresetKey, THREE.LOD>();
  const speciesStartupTimings: SeedThreeForestSpeciesStartupTiming[] = [];
  const prototypeCache = forestPrototypeCache.get(renderer) ?? new Map();
  forestPrototypeCache.set(renderer, prototypeCache);

  // Texture fetch/decode is independent across species. Start every request
  // before the renderer-exclusive branch-card bakes so network and image
  // decode can overlap the first bake instead of forming a species-by-species
  // startup waterfall. Keep the bake/build loop ordered for deterministic GPU
  // atlas generation and exact seeded prototype geometry.
  const assetEntryPromises = GORSKI_KOTAR_PRESETS.map(async (presetKey) => {
    const species = GORSKI_KOTAR_SPECIES[presetKey];
    if (!species) return null;
    const assets = await loadSeedThreeSpeciesAssets(species, maxAnisotropy);
    return { presetKey, species, assets };
  });

  for (const entryPromise of assetEntryPromises) {
    const assetWaitStartedAt = performance.now();
    const entry = await entryPromise;
    if (!entry) continue;
    const assetWaitMs = performance.now() - assetWaitStartedAt;
    const { presetKey, species, assets } = entry;
    assetsByPreset.set(presetKey, assets);
    const branchCardsStartedAt = performance.now();
    const branchCards = await ensureSeedThreeBranchCards(
      renderer,
      species,
      assets,
      FOREST_LOD_OPTS.mobileTarget,
    );
    const branchCardsMs = performance.now() - branchCardsStartedAt;
    const cached = prototypeCache.get(presetKey);
    // Resource identity invalidates resets/rebakes in either game mode.
    if (cached?.assets === assets && cached.branchCards === branchCards) {
      prototypeByPreset.set(presetKey, cached.prototype);
      continue;
    }
    if (!branchCards) {
      console.warn(
        '[SeedThree] no branch cards for',
        presetKey,
        '— foliage may be missing',
      );
    }
    const prototypeBuildStartedAt = performance.now();
    const { group: prototype } = buildTree(
      species,
      `prototype:${presetKey}`,
      assets,
      {
        ...FOREST_LOD_OPTS,
        branchCards: branchCards ?? undefined,
      },
    );
    prototypeByPreset.set(presetKey, prototype as THREE.LOD);
    prototypeCache.set(presetKey, {
      prototype: prototype as THREE.LOD,
      assets,
      branchCards,
    });
    speciesStartupTimings.push({
      preset: presetKey,
      assetWaitMs,
      branchCardsMs,
      prototypeBuildMs: performance.now() - prototypeBuildStartedAt,
    });
  }

  const placementStartedAt = performance.now();
  const placementsByPreset = new Map<
    SeedThreePresetKey,
    {
      gameplay: TreeSlot[];
      horizon: TreeSlot[];
    }
  >();
  const visibilityItems: Array<{
    x: number;
    y: number;
    z: number;
    radius: number;
    forceOverview?: boolean;
  }> = Array.from({ length: placements.length }, () => ({
    x: 0,
    y: 0,
    z: 0,
    radius: 1,
  }));
  const slotByLayoutIndex: Array<{
    bucketIndex: number;
    slotIndex: number;
  } | null> = Array.from({ length: placements.length }, () => null);

  for (let layoutIndex = 0; layoutIndex < placements.length; layoutIndex++) {
    const placement = placements[layoutIndex];
    const preset = resolveSeedThreePreset(placement.species);
    const scale = seedThreeScaleForPreset(preset, placement.scale);
    const rootY = terrain.getHeightAt(placement.x, placement.z);
    const rotY = rng.range(0, Math.PI * 2);
    const matrix = composeTreeMatrix(
      placement.x,
      rootY - 0.15 * scale,
      placement.z,
      rotY,
      scale,
    );
    const speciesHeight =
      Number(GORSKI_KOTAR_SPECIES[preset]?.params?.scale ?? 20) * scale;
    const visibilityRadius = Math.max(5, speciesHeight * 0.58);
    const visibilityCenter = new THREE.Vector3(
      placement.x,
      rootY + speciesHeight * 0.5,
      placement.z,
    );
    const slot: TreeSlot = {
      layoutIndex,
      authoredMatrix: matrix.clone(),
      matrix,
      pos: new THREE.Vector3(placement.x, rootY, placement.z),
      visibilityCenter,
      visibilityRadius,
      enabled: true,
      forceOverview:
        placement.edgeBand?.maximumDetail === 'overview-card' ||
        placement.visualOnly === 'terrain-horizon' ||
        Math.max(Math.abs(placement.x), Math.abs(placement.z)) >=
          terrain.generationSize * 0.44,
      overviewOnly: placement.visualOnly === 'terrain-horizon',
      seasonalDeciduous: gorskiKotarSpeciesIsDeciduous(placement.species),
    };
    // Horizon cards are permanently resident color scenery and can never cast
    // a gameplay shadow. Park them together in one remote selector cell so a
    // dense outer forest adds constant O(1) camera-selection work.
    visibilityItems[layoutIndex] = slot.overviewOnly
      ? { x: 10_000_000, y: 0, z: 10_000_000, radius: 1, forceOverview: true }
      : {
          x: visibilityCenter.x,
          y: visibilityCenter.y,
          z: visibilityCenter.z,
          radius: visibilityRadius,
          forceOverview: slot.forceOverview,
        };
    const grouped = placementsByPreset.get(preset) ?? {
      gameplay: [],
      horizon: [],
    };
    (slot.overviewOnly ? grouped.horizon : grouped.gameplay).push(slot);
    placementsByPreset.set(preset, grouped);
  }
  const placementMs = performance.now() - placementStartedAt;

  const bucketBuildStartedAt = performance.now();
  const buckets: SpeciesBucket[] = [];
  const seasonalCardMaterials = new Set<THREE.Material>();
  const snowCardMaterials = new Set<THREE.Material>();
  const ownedLodMaterials = new Set<THREE.Material>();

  for (const presetKey of GORSKI_KOTAR_PRESETS) {
    const grouped = placementsByPreset.get(presetKey);
    if (!grouped) continue;
    const prototype = prototypeByPreset.get(presetKey);
    if (!prototype) continue;
    const slotGroups = [
      { slots: grouped.gameplay, horizonOnly: false },
      { slots: grouped.horizon, horizonOnly: true },
    ] as const;
    const storageLimit = (
      renderer.backend as unknown as {
        device: { limits: { maxStorageBufferBindingSize: number } };
      }
    ).device.limits.maxStorageBufferBindingSize;
    let cardsPerTree = 1;
    for (const name of ['LOD2', 'LOD3', 'LOD4'])
      findLodLevel(prototype, name)?.traverse((object) => {
        const mesh = object as THREE.InstancedMesh;
        if (mesh.isInstancedMesh)
          cardsPerTree = Math.max(cardsPerTree, mesh.count);
      });
    const maxTreesPerBucket = Math.max(
      1,
      Math.floor(storageLimit / (cardsPerTree * 64)),
    );
    for (const slotGroup of slotGroups)
      for (
        let start = 0;
        start < slotGroup.slots.length;
        start += maxTreesPerBucket
      ) {
        const { horizonOnly } = slotGroup;
        const slots = slotGroup.slots.slice(start, start + maxTreesPerBucket);
        if (!slots.length) continue;
        const bucketIndex = buckets.length;
        slots.forEach((slot, slotIndex) => {
          slotByLayoutIndex[slot.layoutIndex] = { bucketIndex, slotIndex };
        });

        const bucket = createSpeciesBucket(
          presetKey,
          slots,
          prototype,
          new Rng(
            `bucket:${presetKey}:${treeSeed}:${horizonOnly ? 'horizon' : 'gameplay'}`,
          ),
          seasonalCardMaterials,
          snowCardMaterials,
          ownedLodMaterials,
          horizonOnly,
        );
        buckets.push(bucket);
        for (const mesh of [
          ...lodSetMeshes(bucket.nearSet),
          ...lodSetMeshes(bucket.overviewSet),
        ])
          opaqueDraws.add(mesh);
        if (bucket.nearShadowSet.branches)
          opaqueDraws.add(bucket.nearShadowSet.branches);
        for (const cardMesh of bucket.nearShadowSet.cards)
          opaqueDraws.add(cardMesh);
        for (const mesh of lodSetMeshes(bucket.farSet))
          (horizonOnly ? horizonForestGroup : opaqueDraws).add(mesh);
      }
  }

  const visibilitySelector = createForestLodSelector(visibilityItems, {
    cellSize: 48,
    frustumPadding: FOREST_VISIBILITY_PADDING,
    nearDistance: FOREST_NEAR_DISTANCE,
    lodHysteresis: 14,
    minimumCameraMove: 2.25,
    minimumDirectionAngle: THREE.MathUtils.degToRad(1),
  });
  const nearTrees = buckets.reduce(
    (count, bucket) => count + bucket.nearSlotIndices.length,
    0,
  );
  const overviewTrees = buckets.reduce(
    (count, bucket) => count + bucket.overviewSlotIndices.length,
    0,
  );
  const bucketBuildMs = performance.now() - bucketBuildStartedAt;
  const preloadDurationMs =
    preloadStartedAtMs === null
      ? 0
      : (preloadCompletedAtMs ?? performance.now()) - preloadStartedAtMs;
  lastStartupTiming = {
    preloadStartedAtMs,
    preloadCompletedAtMs,
    preloadDurationMs,
    totalMs: performance.now() - startupStartedAt,
    placementMs,
    bucketBuildMs,
    species: speciesStartupTimings,
    assets: getSeedThreeSpeciesAssetStartupTimings(),
    branchCards: getSeedThreeBranchCardStartupTimings(),
  };
  if (typeof window !== 'undefined') {
    const startup = (
      window as typeof window & {
        __medievalRoadStartup?: { seedThree?: SeedThreeForestStartupTiming };
      }
    ).__medievalRoadStartup;
    if (startup) startup.seedThree = lastStartupTiming;
  }
  console.info('[Startup] SeedThree forest stages', lastStartupTiming);
  return {
    group,
    renderer,
    placements,
    buckets,
    slotByLayoutIndex,
    hiddenMatrix,
    visibilitySelector,
    seasonalCardMaterials: [...seasonalCardMaterials],
    snowCardMaterials: [...snowCardMaterials],
    shadowsEnabled: true,
    deciduousFoliage: {
      springFlush: 0,
      autumnColor: 0,
      dormancy: 0,
    },
    snowCoverage: 0,
    renderStats: {
      totalTrees: placements.length,
      visibleTrees: placements.length,
      nearTrees,
      overviewTrees,
      culledTrees: 0,
      revision: 0,
    },
    pendingLodWork: null,
    visibilityDirty: false,
    dirtyVisibilitySlotsByBucket: new Map(),
    cameraInteractionActive: false,
    ownedLodMaterials: [...ownedLodMaterials],
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
  if (slot.enabled === visible) return;
  if (visible) {
    if (slot.authoredMatrix) slot.matrix.copy(slot.authoredMatrix);
  } else {
    slot.authoredMatrix ??= slot.matrix.clone();
    slot.matrix.copy(forest.hiddenMatrix);
  }
  slot.enabled = visible;
  forest.visibilityDirty = true;
  const dirtySlots =
    forest.dirtyVisibilitySlotsByBucket.get(mapping.bucketIndex) ??
    new Set<number>();
  dirtySlots.add(mapping.slotIndex);
  forest.dirtyVisibilitySlotsByBucket.set(mapping.bucketIndex, dirtySlots);
}

export function commitSeedThreeForestMatrices(
  forest: SeedThreeForestInstances,
): void {
  if (forest.visibilityDirty === false) return;
  let matrixWrites = 0;
  for (const [
    bucketIndex,
    dirtySlotIndices,
  ] of forest.dirtyVisibilitySlotsByBucket) {
    const bucket = forest.buckets[bucketIndex];
    if (!bucket) continue;
    matrixWrites += patchSeedThreeLodSlotVisibility(
      bucket.nearSet,
      bucket.slots,
      bucket.nearViewSlotIndices,
      dirtySlotIndices,
    );
    matrixWrites += patchSeedThreeLodSlotVisibility(
      bucket.overviewSet,
      bucket.slots,
      bucket.overviewViewSlotIndices,
      dirtySlotIndices,
    );
    matrixWrites += patchSeedThreeLodSlotVisibility(
      bucket.farSet,
      bucket.slots,
      bucket.farSlotIndices,
      dirtySlotIndices,
    );
    matrixWrites += patchSeedThreeLodSlotVisibility(
      bucket.nearShadowSet,
      bucket.slots,
      bucket.nearSlotIndices,
      dirtySlotIndices,
    );
  }
  forest.pendingLodWork = null;
  forest.dirtyVisibilitySlotsByBucket.clear();
  forest.visibilityDirty = false;
  forest.updateTelemetry.matrixWrites += matrixWrites;
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
    bucket.slots.forEach((slot, index) => {
      if (slot.enabled) {
        if (bucket.colorLods[index] === 0) nearTrees++;
        else overviewTrees++;
      }
    });
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
  cameraInteractionActive = false,
): SeedThreeForestBudgetedUpdateResult {
  return updateSeedThreeForestCameraBudgeted(
    forest,
    camera,
    firstPersonActive,
    casterBounds,
    {
      maxBucketCompactions: Number.POSITIVE_INFINITY,
      maxUpdateDurationMs: FOREST_CONTINUOUS_UPDATE_BUDGET_MS,
      maxMatrixWritesPerChunk: FOREST_MATRIX_WRITES_PER_CHUNK,
      stabilizeDuringInteraction: true,
      cameraInteractionActive,
    },
  );
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
    stabilizeDuringInteraction?: boolean;
    cameraInteractionActive?: boolean;
  },
): SeedThreeForestBudgetedUpdateResult {
  const startedAt = performance.now();
  const cameraInteractionActive = options.cameraInteractionActive === true;
  const previousCameraInteractionActive = forest.cameraInteractionActive;
  forest.cameraInteractionActive = cameraInteractionActive;
  updateSeedThreeColorLods(forest, camera);
  const selection = selectForestLods(forest.visibilitySelector, camera, {
    nearDistance: firstPersonActive
      ? FOREST_FIRST_PERSON_NEAR_DISTANCE
      : FOREST_NEAR_DISTANCE,
    frustumPadding: firstPersonActive
      ? FOREST_VISIBILITY_PADDING + 8
      : FOREST_VISIBILITY_PADDING,
    casterBounds: forest.shadowsEnabled ? casterBounds : undefined,
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
    const desired = selectionsByBucket(forest, selection, firstPersonActive);
    forest.pendingLodWork = {
      desired,
      pendingBucketIndices: forest.pendingLodWork?.pendingBucketIndices ?? [],
      activeBucketJob: forest.pendingLodWork?.activeBucketJob ?? null,
    };
  }

  const work = forest.pendingLodWork;
  const initialSelection = selection.triggerReasons.includes('initial');
  let bucketCompactions = 0;
  let shadowCastersChanged = false;
  let matrixWrites = 0;
  let workChunks = 0;
  let matrixSliceBudgetStop: 'time-limit' | 'headroom-limit' | null = null;
  let coverageImmediate = false;
  let stopReason = work ? 'chunk-limit' : 'converged';
  if (work) {
    // Keep the resident visible prefix immutable throughout camera navigation.
    // On release, discard a redundant repack inside its guard or stream escaped
    // coverage through the normal bounded update budget.
    const stabilizeInteractionBuffers =
      options.stabilizeDuringInteraction === true;
    const residentColorGuardCoversCriticalView =
      seedThreeColorSelectionCoversView(
        forest.buckets,
        forest.slotByLayoutIndex,
        selection.criticalViewIndices,
      );
    const residentShadowCoversDesiredUnion =
      !forest.shadowsEnabled ||
      (seedThreeResidentSelectionCoversView(
        forest.buckets,
        forest.slotByLayoutIndex,
        selection.nearIndices,
      ) &&
        seedThreeResidentSelectionCoversView(
          forest.buckets,
          forest.slotByLayoutIndex,
          selection.overviewIndices,
        ));
    const residentPassesCoverRequiredWork =
      residentColorGuardCoversCriticalView &&
      // Directional-shadow overscan may trail while the camera is moving; it
      // must never force a color-buffer repack into an interaction frame.
      (cameraInteractionActive || residentShadowCoversDesiredUnion);
    const interactionWork = planSeedThreeForestInteractionWork(
      previousCameraInteractionActive,
      cameraInteractionActive,
      residentPassesCoverRequiredWork,
    );
    const deferInteractionWork =
      stabilizeInteractionBuffers && interactionWork.deferWork;
    const discardCoveredInteractionWork =
      stabilizeInteractionBuffers && interactionWork.discardCoveredWork;
    // Publish the first resolved resident set atomically before the forest
    // reaches a render pass. First-person can begin with a spatial set, while
    // RTS intentionally retains its complete stable caster residency.
    const completeInteractionWorkImmediately =
      initialSelection ||
      (stabilizeInteractionBuffers && interactionWork.completeImmediately);
    coverageImmediate = initialSelection || interactionWork.completeImmediately;
    if (discardCoveredInteractionWork) {
      work.pendingBucketIndices.length = 0;
      work.activeBucketJob = null;
      forest.pendingLodWork = null;
      stopReason = 'resident-retained';
    }
    const maxUpdateDurationMs = completeInteractionWorkImmediately
      ? Number.POSITIVE_INFINITY
      : deferInteractionWork || discardCoveredInteractionWork
        ? 0
        : Number.isFinite(options.maxUpdateDurationMs)
          ? Math.max(0, options.maxUpdateDurationMs!)
          : Number.POSITIVE_INFINITY;
    const selectorAndBookkeepingMs =
      performance.now() -
      startedAt +
      (Number.isFinite(maxUpdateDurationMs)
        ? FOREST_UPDATE_BOOKKEEPING_HEADROOM_MS
        : 0);
    const availableWorkMs = Number.isFinite(maxUpdateDurationMs)
      ? Math.max(0, maxUpdateDurationMs - selectorAndBookkeepingMs)
      : Number.POSITIVE_INFINITY;
    const currentSelections = forest.buckets.map((bucket) => ({
      near: bucket.nearSlotIndices,
      overview: bucket.overviewSlotIndices,
      viewNear: bucket.nearViewSlotIndices,
      viewOverview: bucket.overviewViewSlotIndices,
      nearViewSlotCount: bucket.nearViewSlotCount,
      overviewViewSlotCount: bucket.overviewViewSlotCount,
    }));
    const chunk = discardCoveredInteractionWork
      ? {
          completedBucketIndices: [] as number[],
          pendingBucketIndices: [] as number[],
          cancelledBucketIndices: [] as number[],
          chunks: 0,
          durationMs: 0,
          stopReason: 'converged',
        }
      : runForestBucketUpdateChunk(
          currentSelections,
          work.desired,
          work.pendingBucketIndices,
          {
            maxDurationMs: availableWorkMs,
            minimumChunkHeadroomMs: Number.isFinite(availableWorkMs) ? 0.12 : 0,
            maxChunks:
              deferInteractionWork || discardCoveredInteractionWork
                ? 0
                : Number.isFinite(maxUpdateDurationMs)
                  ? 1
                  : Number.POSITIVE_INFINITY,
            maxBucketCompletions: completeInteractionWorkImmediately
              ? Number.POSITIVE_INFINITY
              : options.maxBucketCompactions,
            now: () => performance.now(),
            applyBucketChunk: (bucketIndex, context) => {
              const bucket = forest.buckets[bucketIndex];
              const desired = work.desired[bucketIndex];
              if (!bucket || !desired) return true;
              if (
                !work.activeBucketJob ||
                work.activeBucketJob.bucketIndex !== bucketIndex ||
                !sameBucketSelection(work.activeBucketJob.desired, desired)
              ) {
                const writeColor =
                  !sameIndices(bucket.nearViewSlotIndices, desired.viewNear) ||
                  !sameIndices(
                    bucket.overviewViewSlotIndices,
                    desired.viewOverview,
                  );
                const writeShadow =
                  forest.shadowsEnabled &&
                  !sameIndices(bucket.nearSlotIndices, desired.near);
                // First-person camera updates may repack only the dedicated
                // shadow set. RTS uses stable caster identities.
                // Stable color attributes are realigned only if gameplay
                // visibility genuinely changes their own packed identities.
                const realignColorAttributes = writeColor;
                work.activeBucketJob = {
                  bucketIndex,
                  desired: {
                    near: [...desired.near],
                    overview: [...desired.overview],
                    viewNear: [...desired.viewNear],
                    viewOverview: [...desired.viewOverview],
                    nearViewSlotCount: desired.nearViewSlotCount,
                    overviewViewSlotCount: desired.overviewViewSlotCount,
                  },
                  job: createSeedThreeBucketMatrixWriteJob(
                    bucket.nearSet,
                    bucket.overviewSet,
                    bucket.slots,
                    desired.viewNear,
                    desired.viewOverview,
                    {
                      lodSet: bucket.nearShadowSet,
                      selectedSlotIndices: desired.near,
                      overviewSelectedSlotIndices: desired.overview,
                      writeColor,
                      writeShadow,
                      realignColorAttributes,
                      preserveDisabledSlots: true,
                    },
                  ),
                };
              }
              const activeBucketJob = work.activeBucketJob;
              if (!activeBucketJob) return false;
              const result = runSeedThreeBucketMatrixWriteSlices(
                activeBucketJob.job,
                {
                  deadlineMs: context.deadlineMs,
                  minimumChunkHeadroomMs: Number.isFinite(context.remainingMs)
                    ? 0.12
                    : 0,
                  maxMatrixWritesPerChunk:
                    options.maxMatrixWritesPerChunk ?? Number.POSITIVE_INFINITY,
                },
              );
              workChunks += result.chunks;
              matrixWrites += result.matrixWrites;
              matrixSliceBudgetStop =
                result.stopReason === 'time-limit' ||
                result.stopReason === 'headroom-limit'
                  ? result.stopReason
                  : null;
              if (!result.completed) return false;
              shadowCastersChanged ||= activeBucketJob.job.writeShadow;
              bucket.nearSlotIndices = [...desired.near];
              bucket.overviewSlotIndices = [...desired.overview];
              bucket.nearViewSlotIndices = [...desired.viewNear];
              bucket.overviewViewSlotIndices = [...desired.viewOverview];
              bucket.nearViewSlotCount = desired.nearViewSlotCount;
              bucket.overviewViewSlotCount = desired.overviewViewSlotCount;
              work.activeBucketJob = null;
              return true;
            },
          },
        );
    bucketCompactions = chunk.completedBucketIndices.length;
    stopReason = discardCoveredInteractionWork
      ? 'resident-retained'
      : deferInteractionWork
        ? 'interaction-deferred'
        : chunk.stopReason;
    if (chunk.stopReason === 'chunk-limit' && matrixSliceBudgetStop) {
      stopReason = matrixSliceBudgetStop;
    }
    work.pendingBucketIndices = chunk.pendingBucketIndices;
    if (
      work.activeBucketJob &&
      chunk.cancelledBucketIndices.includes(work.activeBucketJob.bucketIndex)
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
  forest.updateTelemetry.timeBudgetStops +=
    stopReason === 'time-limit' || stopReason === 'headroom-limit' ? 1 : 0;
  forest.updateTelemetry.coverageImmediateUpdates += coverageImmediate ? 1 : 0;
  if (coverageImmediate) {
    forest.updateTelemetry.maxCoverageImmediateDurationMs = Math.max(
      forest.updateTelemetry.maxCoverageImmediateDurationMs,
      durationMs,
    );
  }
  forest.updateTelemetry.pendingBuckets =
    forest.pendingLodWork?.pendingBucketIndices.length ?? 0;
  forest.updateTelemetry.lastDurationMs = durationMs;
  forest.updateTelemetry.maxDurationMs = Math.max(
    forest.updateTelemetry.maxDurationMs,
    durationMs,
  );
  return {
    selectionChanged: selection.changed,
    shadowCastersChanged,
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
  left: PassPartitionedBucketSelection,
  right: PassPartitionedBucketSelection,
): boolean {
  return (
    sameIndices(left.near, right.near) &&
    sameIndices(left.overview, right.overview) &&
    sameIndices(left.viewNear, right.viewNear) &&
    sameIndices(left.viewOverview, right.viewOverview) &&
    left.nearViewSlotCount === right.nearViewSlotCount &&
    left.overviewViewSlotCount === right.overviewViewSlotCount
  );
}

function sameIndices(
  left: readonly number[],
  right: readonly number[],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function selectionsByBucket(
  forest: SeedThreeForestInstances,
  selection: {
    nearIndices: readonly number[];
    overviewIndices: readonly number[];
    viewIndices: readonly number[];
  },
  firstPersonActive: boolean,
): PassPartitionedBucketSelection[] {
  const desired = forest.buckets.map((bucket) => {
    const color = createSeedThreeStableColorSlotSelection(bucket.slots),
      shadow = createSeedThreeStableRtsShadowSlotSelection(bucket.slots);
    return {
      near: firstPersonActive ? [] : shadow.near,
      overview: firstPersonActive ? [] : shadow.overview,
      viewNear: color.near,
      viewOverview: color.overview,
      nearViewSlotCount: color.near.length,
      overviewViewSlotCount: color.overview.length,
    };
  });
  if (firstPersonActive)
    for (const layoutIndex of [
      ...selection.nearIndices,
      ...selection.overviewIndices,
    ]) {
      const mapping = forest.slotByLayoutIndex[layoutIndex];
      if (!mapping) continue;
      if (
        !forest.buckets[mapping.bucketIndex]?.slots[mapping.slotIndex]
          ?.overviewOnly
      )
        desired[mapping.bucketIndex]!.near.push(mapping.slotIndex);
    }
  // Sparse harvest/falling patches use a binary search of caster identities.
  if (firstPersonActive)
    for (const bucket of desired) bucket.near.sort((left, right) => left - right);
  return desired;
}

function updateSeedThreeColorLods(
  forest: SeedThreeForestInstances,
  camera: THREE.Camera,
): void {
  camera.getWorldPosition(COMPOSE_POS);
  const zoom = (camera as THREE.PerspectiveCamera).zoom || 1;
  for (const bucket of forest.buckets) {
    let changed = false;
    bucket.slots.forEach((slot, index) => {
      const e = slot.matrix.elements;
      const distance =
        Math.hypot(
          e[12]! - COMPOSE_POS.x,
          e[13]! - COMPOSE_POS.y,
          e[14]! - COMPOSE_POS.z,
        ) / zoom;
      const next = selectSeedThreeTreeLod(
        distance,
        bucket.colorLods[index]!,
        slot.overviewOnly,
      );
      if (bucket.colorLods[index] !== next) {
        bucket.colorLods[index] = next;
        changed = true;
      }
    });
    if (changed) bucket.colorLodRevision++;
  }
  refreshSeedThreeRenderStats(forest);
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
    coverageImmediateUpdates: 0,
    maxCoverageImmediateDurationMs: 0,
    pendingBuckets: 0,
    lastDurationMs: 0,
    maxDurationMs: 0,
  };
}

export function getSeedThreeForestStructuralStats(
  forest: SeedThreeForestInstances,
): SeedThreeForestStructuralStats {
  let draws = 0;
  let triangles = 0;
  let instances = 0;
  forest.group.traverse((object: THREE.Object3D) => {
    const mesh = object as THREE.InstancedMesh;
    if (
      !mesh.isInstancedMesh ||
      mesh.userData.instanceCompactionSource === true ||
      mesh.count <= 0 ||
      mesh.userData.seedThreeShadowOnly === true ||
      !seedThreeMeshIsSubmitted(mesh, forest.group)
    )
      return;
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

export function getSeedThreeForestProfileBreakdown(
  forest: SeedThreeForestInstances,
): SeedThreeForestProfileBreakdown {
  const residentColor = emptySubmissionStats(),
    submittedColor = emptySubmissionStats(),
    criticalProjectedColor = emptySubmissionStats();
  const submittedPasses = {
    near: emptySubmissionStats(),
    middle: emptySubmissionStats(),
    far: emptySubmissionStats(),
  };
  const critical = forest.buckets.map(() => [0, 0, 0]);
  let criticalColorTrees = 0,
    paddedColorTrees = 0;
  for (const index of forest.visibilitySelector.criticalViewIndices) {
    const mapping = forest.slotByLayoutIndex[index];
    if (!mapping) continue;
    const bucket = forest.buckets[mapping.bucketIndex]!,
      slot = bucket.slots[mapping.slotIndex]!;
    if (!slot.enabled || slot.visibilityParent?.enabled === false) continue;
    criticalColorTrees++;
    const lod = bucket.colorLods[mapping.slotIndex]!;
    if (lod >= 0) critical[mapping.bucketIndex]![lod]!++;
  }
  forest.buckets.forEach((bucket, index) => {
    paddedColorTrees += bucket.slots.filter((slot) => slot.enabled).length;
    [bucket.nearSet, bucket.overviewSet, bucket.farSet].forEach((set, lod) => {
      const pass = [
        submittedPasses.near,
        submittedPasses.middle,
        submittedPasses.far,
      ][lod]!;
      for (const mesh of lodSetMeshes(set)) {
        accumulateSubmission(residentColor, mesh, mesh.count);
        if (!seedThreeMeshIsSubmitted(mesh, forest.group)) continue;
        accumulateSubmission(
          submittedColor,
          mesh,
          submittedInstanceCount(mesh),
        );
        accumulateSubmission(pass, mesh, submittedInstanceCount(mesh));
        accumulateSubmission(
          criticalProjectedColor,
          mesh,
          critical[index]![lod]! * seedThreeInstancesPerTree(mesh),
        );
      }
    });
  });
  return {
    residentColor,
    submittedColor,
    criticalProjectedColor,
    submittedPasses,
    paddedColorTrees,
    criticalColorTrees,
  };
}

function emptySubmissionStats(): SeedThreeForestSubmissionStats {
  return { draws: 0, triangles: 0, instances: 0 };
}

function lodSetMeshes(lodSet: InstancedLodSet): THREE.InstancedMesh[] {
  return [...(lodSet.branches ? [lodSet.branches] : []), ...lodSet.cards];
}

function seedThreeInstancesPerTree(mesh: THREE.InstancedMesh): number {
  return Math.max(1, Number(mesh.userData.k) || 1);
}

function submittedInstanceCount(mesh: THREE.InstancedMesh): number {
  return mesh.userData.compactedInstanceCount ?? mesh.count;
}

function seedThreeMeshIsSubmitted(
  mesh: THREE.InstancedMesh,
  forestGroup: THREE.Group,
): boolean {
  if (submittedInstanceCount(mesh) <= 0) return false;
  for (
    let object: THREE.Object3D | null = mesh;
    object;
    object = object.parent
  ) {
    if (!object.visible) return false;
    if (object === forestGroup) return true;
  }
  return false;
}

function accumulateSubmission(
  target: SeedThreeForestSubmissionStats,
  mesh: THREE.InstancedMesh,
  instanceCount: number,
): void {
  if (instanceCount <= 0) return;
  const geometryTriangles = mesh.geometry.index
    ? mesh.geometry.index.count / 3
    : mesh.geometry.attributes.position.count / 3;
  target.draws += 1;
  target.instances += instanceCount;
  target.triangles += Math.round(geometryTriangles * instanceCount);
}

export function setSeedThreeForestShadows(
  forest: SeedThreeForestInstances,
  enabled: boolean,
): void {
  forest.shadowsEnabled = enabled;
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
    forest.deciduousFoliage.springFlush === next.springFlush &&
    forest.deciduousFoliage.autumnColor === next.autumnColor &&
    forest.deciduousFoliage.dormancy === next.dormancy
  )
    return;
  forest.deciduousFoliage = next;
  for (const material of forest.seasonalCardMaterials) {
    setForestCardSeason(material, next);
  }
}

export function setSeedThreeForestSnowCoverage(
  forest: SeedThreeForestInstances,
  coverage: number,
): void {
  const next = THREE.MathUtils.clamp(
    Number.isFinite(coverage) ? coverage : 0,
    0,
    1,
  );
  if (forest.snowCoverage === next) return;
  forest.snowCoverage = next;
  for (const material of forest.snowCardMaterials) {
    setForestCardSnowCoverage(material, next);
  }
}

export function disposeSeedThreeForest(forest: SeedThreeForestInstances): void {
  for (const compaction of forest.compactedDraws ?? []) compaction.dispose();
  forest.group.traverse((object: THREE.Object3D) => {
    const mesh = object as THREE.InstancedMesh;
    if (!mesh.isInstancedMesh) return;
    if (mesh.geometry.userData.forestClone) mesh.geometry.dispose();
    mesh.dispose();
  });
  for (const material of forest.ownedLodMaterials) material.dispose();
}

export function createSeedThreeForestController(
  forest: SeedThreeForestInstances,
): SeedThreeForestController {
  const storageLimit =
    (
      forest.renderer.backend as unknown as {
        device?: { limits: { maxStorageBufferBindingSize: number } };
      }
    ).device?.limits.maxStorageBufferBindingSize ?? 0;
  // The selector already packs exact shadow prefixes. Upload their matrices
  // directly so harvest/falling edits reach shadows in the same frame as color,
  // without another compaction allocation or Three's deferred matrix mirror.
  // Oversized allocations retain vertex buffers, respecting the device limit.
  for (const bucket of forest.buckets)
    for (const mesh of [
      bucket.nearShadowSet.branches,
      ...bucket.nearShadowSet.cards,
    ]) {
      if (
        mesh &&
        mesh.instanceMatrix.array.byteLength <= storageLimit &&
        !(mesh.instanceMatrix instanceof StorageInstancedBufferAttribute)
      ) {
        mesh.instanceMatrix = new StorageInstancedBufferAttribute(
          mesh.instanceMatrix.array,
          16,
        );
      }
    }
  forest.compactedDraws ??= forest.buckets
    .flatMap((bucket) => {
      const color = [bucket.nearSet, bucket.overviewSet, bucket.farSet].flatMap(
        (set, lod) =>
          lodSetMeshes(set).map((mesh) => ({
            mesh,
            groupVisible: (group: number) => {
              const indices =
                lod === 0
                  ? bucket.nearViewSlotIndices
                  : lod === 1
                    ? bucket.overviewViewSlotIndices
                    : bucket.farSlotIndices;
              return bucket.colorLods[indices[group]!] === lod;
            },
            selectionVersion: () => bucket.colorLodRevision,
          })),
      );
      return [
        ...color,
        ...(bucket.nearShadowSet.branches
          ? [
              {
                mesh: bucket.nearShadowSet.branches,
                groupVisible: undefined,
                selectionVersion: undefined,
              },
            ]
          : []),
      ];
    })
    .filter(({ mesh }) => mesh.instanceMatrix.count > 0)
    .map(({ mesh, groupVisible, selectionVersion }) => {
      const wind = mesh.geometry.getAttribute('aWind');
      let maximumWeight = wind ? 0 : 1;
      if (wind)
        for (let i = 0; i < wind.count; i++)
          maximumWeight = Math.max(maximumWeight, Math.abs(wind.getX(i)));
      const vectors = mesh.geometry.getAttribute('aWindVec');
      let version = -1,
        maximumVector = 0;
      const thickness = mesh.geometry.getAttribute('aThickness');
      let maximumThickness = 0;
      if (thickness)
        for (let i = 0; i < thickness.count; i++)
          maximumThickness = Math.max(
            maximumThickness,
            Math.abs(thickness.getX(i)),
          );
      mesh.geometry.computeBoundingBox();
      const flutterBound = thickness
        ? Math.sqrt(2.36) *
          0.05 *
          maximumThickness *
          Math.max(0, mesh.geometry.boundingBox!.max.y)
        : 0;
      const padding = () => {
        if (vectors && version !== (vectors as THREE.BufferAttribute).version) {
          version = (vectors as THREE.BufferAttribute).version;
          maximumVector = 0;
          for (let i = 0; i < vectors.count; i++)
            maximumVector = Math.max(
              maximumVector,
              Math.hypot(vectors.getX(i), vectors.getY(i), vectors.getZ(i)),
            );
        }
        // Exact bound for the bark shader: its two sine weights sum to one.
        return (
          0.01 +
          Math.abs(windStrength.value) *
            (0.35 * maximumWeight * maximumVector + flutterBound)
        );
      };
      return mesh.userData.k &&
        !mesh.userData.seedThreeShadowOnly &&
        GroupedInstanceDraws.supports(mesh, forest.renderer)
        ? new GroupedInstanceDraws(mesh, forest.renderer, padding, groupVisible)
        : new InstanceDrawCompaction(mesh, padding, {
            skipCollapsed: true,
            instanceGroupSize: Math.max(1, Number(mesh.userData.k) || 1),
            groupVisible,
            selectionVersion,
          });
    });
  return {
    hideTree: (layoutIndex) =>
      setSeedThreeTreeVisible(forest, layoutIndex, false),
    showTree: (layoutIndex) =>
      setSeedThreeTreeVisible(forest, layoutIndex, true),
    setTreeTransform: (layoutIndex, worldDelta) => {
      const mapping = forest.slotByLayoutIndex[layoutIndex];
      if (!mapping) return;
      const bucket = forest.buckets[mapping.bucketIndex];
      const slot = bucket.slots[mapping.slotIndex];
      slot.matrix.multiplyMatrices(worldDelta, slot.authoredMatrix!);
      slot.enabled = true;
      const indices = [mapping.slotIndex];
      patchSeedThreeLodSlotVisibility(
        bucket.nearSet,
        bucket.slots,
        bucket.nearViewSlotIndices,
        indices,
      );
      patchSeedThreeLodSlotVisibility(
        bucket.overviewSet,
        bucket.slots,
        bucket.overviewViewSlotIndices,
        indices,
      );
      patchSeedThreeLodSlotVisibility(
        bucket.nearShadowSet,
        bucket.slots,
        bucket.nearSlotIndices,
        indices,
      );
      patchSeedThreeLodSlotVisibility(
        bucket.farSet,
        bucket.slots,
        bucket.farSlotIndices,
        indices,
      );
    },
    commit: () => commitSeedThreeForestMatrices(forest),
    updateCamera: (
      camera,
      _cameraDistance,
      firstPersonActive,
      casterBounds,
      cameraInteractionActive,
      _deltaSeconds = 1 / 60,
    ) => {
      const before = forest.buckets.reduce(
        (sum, bucket) => sum + bucket.colorLodRevision,
        0,
      );
      const cameraUpdate = updateSeedThreeForestCamera(
        forest,
        camera,
        firstPersonActive,
        casterBounds,
        cameraInteractionActive,
      );
      for (const compaction of forest.compactedDraws ?? []) {
        compaction.syncRenderState();
        // The exact shadow set already includes off-screen casters selected
        // against the light's receiver bounds. Only color uses the view frustum.
        compaction.prepare(
          compaction.draw.userData.seedThreeShadowOnly ? null : camera,
        );
      }
      return {
        presentationChanged:
          before !==
            forest.buckets.reduce(
              (sum, bucket) => sum + bucket.colorLodRevision,
              0,
            ) ||
          cameraUpdate.selectionChanged ||
          cameraUpdate.bucketCompactions > 0,
        shadowCastersChanged: cameraUpdate.shadowCastersChanged,
      };
    },
    getStructuralStats: () => getSeedThreeForestStructuralStats(forest),
    getProfileBreakdown: () => getSeedThreeForestProfileBreakdown(forest),
    setDeciduousFoliage: (presentation) =>
      setSeedThreeForestDeciduousFoliage(forest, presentation),
    setSnowCoverage: (coverage) =>
      setSeedThreeForestSnowCoverage(forest, coverage),
    setShadows: (enabled) => setSeedThreeForestShadows(forest, enabled),
    dispose: () => disposeSeedThreeForest(forest),
  };
}
