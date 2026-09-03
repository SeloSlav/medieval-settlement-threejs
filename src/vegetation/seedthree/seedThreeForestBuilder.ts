import * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { buildTree, forestBarkMaterial } from '@seedthree/core/tree.js';
import {
  forestCardMaterial,
  setForestCardSnowCoverage,
  setForestCardSeason,
} from '@seedthree/core/branch-cards.js';
import { windSpeed } from '@seedthree/core/wind.js';
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
  partitionSeedThreeSelectionByStaticLod,
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
  applySeedThreeBarkSnow,
  applySeedThreeForestBarkMotion,
  applySeedThreeForestCardMotion,
  applySeedThreeOverviewBillboardFade,
  applySeedThreeWholeCardDormancy,
  createSeedThreeOverviewBarkFadeMaterial,
  createSeedThreeOverviewFadeMaterial,
  resolveSeedThreeForestCardMotion,
  setSeedThreeOverviewBillboardFadeOpacity,
  stabilizeSeedThreeForestCardMaterial,
} from './seedThreeForestMaterial.ts';
import { BASELINE_ORBIT_DISTANCE } from '../../camera/CameraCurves.ts';
import {
  updateSeedThreeOverviewBillboardFade,
  type SeedThreeOverviewBillboardFadeState,
} from './seedThreeOverviewBillboardFade.ts';
import {
  SEEDTHREE_FOREST_WIND_SPEED,
  shouldShowSeedThreeCrownUnderlay,
} from './seedThreeCanopyPresentation.ts';
import {
  runForestBucketUpdateChunk,
  type SeedThreeBucketSelection,
} from '@seedthree/core/forest-update-budget.js';
import type { DeciduousFoliagePresentation } from '../../world/deciduousFoliagePolicy.ts';
import { planSeedThreeForestInteractionWork } from './seedThreeForestInteraction.ts';

type SpeciesBucket = {
  preset: SeedThreePresetKey;
  slots: TreeSlot[];
  nearSet: InstancedLodSet;
  nearShadowSet: InstancedLodSet;
  overviewSet: InstancedLodSet;
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
  group: THREE.Group;
  overviewBillboardGroup: THREE.Group;
  placements: ForestTreePlacement[];
  buckets: SpeciesBucket[];
  slotByLayoutIndex: Array<{ bucketIndex: number; slotIndex: number } | null>;
  hiddenMatrix: THREE.Matrix4;
  visibilitySelector: ReturnType<typeof createForestLodSelector>;
  seasonalCardMaterials: THREE.Material[];
  snowCardMaterials: THREE.Material[];
  crownUnderlayMeshes: THREE.InstancedMesh[];
  crownUnderlayVisible: boolean;
  distantCanopyCardsEnabled: boolean;
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
  overviewBillboardFade: SeedThreeOverviewBillboardFadeState;
  ownedOverviewFadeMaterials: THREE.Material[];
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
  lod1Dist: 48,
  lod2Dist: 96,
  lod1Density: 0.88,
  lod2Density: 0.72,
  lod1Pct: 42,
  lod2Pct: 14,
};

const FOREST_NEAR_DISTANCE = 108;
// On steep maps, mountaintop trees can be physically close to the elevated orbit
// camera even at strategic zoom. Keep their foliage-thickening overview cards
// once their crown center rises into this camera-relative altitude band.
const FOREST_FIRST_PERSON_NEAR_DISTANCE = 132;
const FOREST_VISIBILITY_PADDING = 26;
const FOREST_UPDATE_BOOKKEEPING_HEADROOM_MS = 0.35;
const FOREST_CONTINUOUS_UPDATE_BUDGET_MS = 2.75;
const FOREST_MATRIX_WRITES_PER_CHUNK = 128;

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
    snowCardMaterials?: Set<THREE.Material>;
    canopyTint?: readonly [number, number, number];
    autumnColor?: readonly [number, number, number];
    toneVariation?: number;
    crownUnderlayMeshes?: THREE.InstancedMesh[];
    overviewCards?: boolean;
    ownedOverviewFadeMaterials?: Set<THREE.Material>;
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
      const sourceMaterial = applySeedThreeBarkSnow(
        applySeedThreeForestBarkMotion(
          forestBarkMaterial(mesh.material as THREE.Material),
        ),
      );
      const material = options.overviewCards === true
        ? createSeedThreeOverviewBarkFadeMaterial(sourceMaterial)
        : sourceMaterial;
      if (options.overviewCards === true) {
        options.ownedOverviewFadeMaterials?.add(material);
      }
      options.snowCardMaterials?.add(material);
      const im = new THREE.InstancedMesh(geo, material, groupCount);
      im.name = `${debugName} branches`;
      configureSeedThreeForestPassMesh(
        im,
        'color',
        castShadow,
      );
      // The color forest stays fully resident. The aggregate mesh bound is
      // intentionally not consulted; the GPU clips off-screen instances.
      im.frustumCulled = false;
      lodSet.branches = im;
    } else if ((child as THREE.Group).isGroup) {
      for (const cardsMesh of (child as THREE.Group).children) {
        const instanced = cardsMesh as THREE.InstancedMesh;
        if (!instanced.isInstancedMesh) continue;
        const crownUnderlay = instanced.geometry.userData.crownUnderlay === true;
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

        const sourceMaterial = instanced.material as THREE.Material;
        const baseForestMaterial = applySeedThreeForestCardMotion(
          stabilizeSeedThreeForestCardMaterial(
            (instanced.userData.shareMaterial
            ? instanced.material
            : forestCardMaterial(instanced.material as THREE.Material, {
                seasonalDeciduous: options.seasonalDeciduous,
                canopyTint: options.canopyTint,
                autumnColor: options.autumnColor,
                toneVariation: options.toneVariation,
              })) as THREE.Material,
          ),
          resolveSeedThreeForestCardMotion(
            options.overviewCards === true,
            crownUnderlay,
          ),
          sourceMaterial,
        );
        const fmat = crownUnderlay && options.overviewCards !== true
          ? createSeedThreeOverviewFadeMaterial(
              baseForestMaterial,
              options.seasonalDeciduous === true,
            )
          : baseForestMaterial;
        if (crownUnderlay && options.overviewCards !== true) {
          options.ownedOverviewFadeMaterials?.add(fmat);
        }
        if (options.overviewCards === true) {
          if (options.seasonalDeciduous) {
            applySeedThreeWholeCardDormancy(fmat);
          }
          applySeedThreeOverviewBillboardFade(fmat);
        }
        if (options.seasonalDeciduous) {
          options.seasonalCardMaterials?.add(fmat as THREE.Material);
        }
        options.snowCardMaterials?.add(fmat as THREE.Material);
        const im = new THREE.InstancedMesh(geo, fmat as THREE.Material, total) as THREE.InstancedMesh & {
          userData: Record<string, unknown>;
        };
        // Preserve the authored per-slot values before any gameplay visibility
        // compaction. Camera selection never owns color attributes.
        im.userData.seedThreeCanonicalThickness = geo
          .getAttribute('aThickness')
          .clone();
        im.name = `${debugName} cards`;
        // Crown underlays are large crossed canopy-fill quads. They improve the
        // color silhouette, but their baked alpha is not preserved by the
        // WebGPU shadow variant and turns into rectangular terrain shadows.
        const castsTreeSilhouette = castShadow && !crownUnderlay;
        configureSeedThreeForestPassMesh(
          im,
          'color',
          castsTreeSilhouette,
        );
        im.frustumCulled = false;
        im.userData.src = instanced;
        im.userData.k = cardsPerTree;
        im.userData.crownUnderlay = crownUnderlay;
        if (im.userData.crownUnderlay) options.crownUnderlayMeshes?.push(im);

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
  snowCardMaterials: Set<THREE.Material>,
  crownUnderlayMeshes: THREE.InstancedMesh[],
  ownedOverviewFadeMaterials: Set<THREE.Material>,
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
      castShadow: false,
      seasonalDeciduous,
      seasonalCardMaterials,
      snowCardMaterials,
      autumnColor,
      crownUnderlayMeshes,
      ownedOverviewFadeMaterials,
    },
  );
  const nearShadowSet = createSeedThreeExactShadowLodSet(
    nearSet,
    `${presetKey} exact shadow LOD2`,
  );
  const overviewSet = createInstancedLodSet(
    overviewLevel,
    slots,
    new Rng(`overview:${presetKey}`),
    `${presetKey} overview ${overviewLevel?.userData.lodName ?? 'LOD2'}`,
    {
      seasonalDeciduous,
      seasonalCardMaterials,
      snowCardMaterials,
      canopyTint: overviewTone.tint,
      autumnColor,
      toneVariation: overviewTone.variation,
      crownUnderlayMeshes,
      overviewCards: true,
      ownedOverviewFadeMaterials,
      castShadow: false,
    },
  );
  // The real LOD2 tree stays resident under every far-card slot. Zooming then
  // changes only one opacity uniform; no geometry swaps at the fade boundary.
  const colorSelection = createSeedThreeStableColorSlotSelection(slots);
  const shadowSelection = createSeedThreeStableRtsShadowSlotSelection(slots);
  const nearSlotIndices = colorSelection.near;
  const overviewSlotIndices = colorSelection.overview;
  writeSeedThreeLodMatrices(nearSet, slots, nearSlotIndices);
  writeSeedThreeLodMatrices(nearShadowSet, slots, shadowSelection.near);
  writeSeedThreeLodMatrices(overviewSet, slots, overviewSlotIndices);
  return {
    preset: presetKey,
    slots,
    nearSet,
    nearShadowSet,
    overviewSet,
    nearSlotIndices,
    overviewSlotIndices,
    nearViewSlotIndices: [...nearSlotIndices],
    overviewViewSlotIndices: [...overviewSlotIndices],
    nearViewSlotCount: nearSlotIndices.length,
    overviewViewSlotCount: overviewSlotIndices.length,
  };
}

/** Begin immutable species texture fetch/decode before terrain generation ends. */
export async function preloadSeedThreeForestAssets(maxAnisotropy: number): Promise<void> {
  if (preloadPromise) return preloadPromise;
  const requestGeneration = preloadGeneration;
  preloadStartedAtMs = performance.now();
  const request = Promise.all(GORSKI_KOTAR_PRESETS.flatMap((presetKey) => {
    const species = GORSKI_KOTAR_SPECIES[presetKey];
    if (!species) return [];
    return [
      loadSeedThreeSpeciesAssets(species, maxAnisotropy).then(() => undefined),
      preloadSeedThreeBranchCardCache(species, FOREST_LOD_OPTS.mobileTarget),
    ];
  })).then(() => {
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
  const overviewBillboardGroup = new THREE.Group();
  overviewBillboardGroup.name = 'SeedThree overview tree billboards';
  overviewBillboardGroup.visible = false;
  group.add(overviewBillboardGroup);

  const assetsByPreset = new Map<SeedThreePresetKey, SeedThreeSpeciesAssets>();
  const prototypeByPreset = new Map<SeedThreePresetKey, THREE.LOD>();
  const speciesStartupTimings: SeedThreeForestSpeciesStartupTiming[] = [];

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
    if (!branchCards) {
      console.warn('[SeedThree] no branch cards for', presetKey, '— foliage may be missing');
    }
    const prototypeBuildStartedAt = performance.now();
    const { group: prototype } = buildTree(species, `prototype:${presetKey}`, assets, {
      ...FOREST_LOD_OPTS,
      branchCards: branchCards ?? undefined,
    });
    prototypeByPreset.set(presetKey, prototype as THREE.LOD);
    speciesStartupTimings.push({
      preset: presetKey,
      assetWaitMs,
      branchCardsMs,
      prototypeBuildMs: performance.now() - prototypeBuildStartedAt,
    });
  }

  const placementStartedAt = performance.now();
  const placementsByPreset = new Map<SeedThreePresetKey, TreeSlot[]>();
  const visibilityItems: Array<{
    x: number;
    y: number;
    z: number;
    radius: number;
    forceOverview?: boolean;
  }> = Array.from(
    { length: placements.length },
    () => ({ x: 0, y: 0, z: 0, radius: 1 }),
  );
  const slotByLayoutIndex: Array<{ bucketIndex: number; slotIndex: number } | null> = Array.from(
    { length: placements.length },
    () => null,
  );

  for (let layoutIndex = 0; layoutIndex < placements.length; layoutIndex++) {
    const placement = placements[layoutIndex];
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
      authoredMatrix: matrix.clone(),
      matrix,
      pos: new THREE.Vector3(placement.x, rootY, placement.z),
      visibilityCenter,
      visibilityRadius,
      enabled: true,
      forceOverview: placement.edgeBand?.maximumDetail === 'overview-card'
        || placement.visualOnly === 'terrain-horizon'
        || Math.max(Math.abs(placement.x), Math.abs(placement.z)) >= terrain.generationSize * 0.44,
      overviewOnly: placement.visualOnly === 'terrain-horizon',
      seasonalDeciduous: gorskiKotarSpeciesIsDeciduous(placement.species),
    };
    visibilityItems[layoutIndex] = {
      x: visibilityCenter.x,
      y: visibilityCenter.y,
      z: visibilityCenter.z,
      radius: visibilityRadius,
      forceOverview: slot.forceOverview,
    };
    const bucket = placementsByPreset.get(preset) ?? [];
    bucket.push(slot);
    placementsByPreset.set(preset, bucket);
  }
  const placementMs = performance.now() - placementStartedAt;

  const bucketBuildStartedAt = performance.now();
  const buckets: SpeciesBucket[] = [];
  const seasonalCardMaterials = new Set<THREE.Material>();
  const snowCardMaterials = new Set<THREE.Material>();
  const crownUnderlayMeshes: THREE.InstancedMesh[] = [];
  const ownedOverviewFadeMaterials = new Set<THREE.Material>();

  for (const presetKey of GORSKI_KOTAR_PRESETS) {
    const slots = placementsByPreset.get(presetKey);
    if (!slots?.length) continue;
    const prototype = prototypeByPreset.get(presetKey);
    if (!prototype) continue;

    const bucketIndex = buckets.length;
    slots.forEach((slot, slotIndex) => {
      slotByLayoutIndex[slot.layoutIndex] = { bucketIndex, slotIndex };
    });

    const bucket = createSpeciesBucket(
      presetKey,
      slots,
      prototype,
      new Rng(`bucket:${presetKey}:${treeSeed}`),
      seasonalCardMaterials,
      snowCardMaterials,
      crownUnderlayMeshes,
      ownedOverviewFadeMaterials,
    );
    buckets.push(bucket);
    if (bucket.nearSet.branches) group.add(bucket.nearSet.branches);
    for (const cardMesh of bucket.nearSet.cards) {
      if (cardMesh.userData.crownUnderlay === true) overviewBillboardGroup.add(cardMesh);
      else group.add(cardMesh);
    }
    if (bucket.nearShadowSet.branches) group.add(bucket.nearShadowSet.branches);
    for (const cardMesh of bucket.nearShadowSet.cards) group.add(cardMesh);
    if (bucket.overviewSet.branches) overviewBillboardGroup.add(bucket.overviewSet.branches);
    for (const cardMesh of bucket.overviewSet.cards) overviewBillboardGroup.add(cardMesh);
  }

  // The fading canopy does not write depth. Composite it after transparent
  // river banks and road shoulders (orders 9–12), or those ground layers paint
  // straight strips through the crowns. Set each mesh's order: changing the
  // group's order would also move it above unrelated effects and UI overlays.
  // Opaque roads, terrain, and buildings still occlude it through depth testing.
  for (const mesh of overviewBillboardGroup.children) mesh.renderOrder = 13;

  // Start from a deterministic close-camera state so all three global modes
  // behave correctly before the first camera update (and never flash one frame).
  // Crown-fill cards share the overview crossfade group. Keep the meshes live;
  // their ancestor visibility and shared opacity uniform own the transition.
  const crownUnderlayVisible = true;
  for (const mesh of crownUnderlayMeshes) mesh.visible = crownUnderlayVisible;

  const visibilitySelector = createForestLodSelector(visibilityItems, {
    cellSize: 48,
    frustumPadding: FOREST_VISIBILITY_PADDING,
    nearDistance: FOREST_NEAR_DISTANCE,
    lodHysteresis: 14,
    minimumCameraMove: 2.25,
    minimumDirectionAngle: THREE.MathUtils.degToRad(1),
  });
  const nearTrees = buckets.reduce((count, bucket) => count + bucket.nearSlotIndices.length, 0);
  const overviewTrees = buckets.reduce(
    (count, bucket) => count + bucket.overviewSlotIndices.length,
    0,
  );
  const bucketBuildMs = performance.now() - bucketBuildStartedAt;
  const preloadDurationMs = preloadStartedAtMs === null
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
    const startup = (window as typeof window & {
      __medievalRoadStartup?: { seedThree?: SeedThreeForestStartupTiming };
    }).__medievalRoadStartup;
    if (startup) startup.seedThree = lastStartupTiming;
  }
  console.info('[Startup] SeedThree forest stages', lastStartupTiming);
  setSeedThreeOverviewBillboardFadeOpacity(0);
  return {
    group,
    overviewBillboardGroup,
    placements,
    buckets,
    slotByLayoutIndex,
    hiddenMatrix,
    visibilitySelector,
    seasonalCardMaterials: [...seasonalCardMaterials],
    snowCardMaterials: [...snowCardMaterials],
    crownUnderlayMeshes,
    crownUnderlayVisible,
    distantCanopyCardsEnabled: true,
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
    overviewBillboardFade: { enabled: false, opacity: 0 },
    ownedOverviewFadeMaterials: [...ownedOverviewFadeMaterials],
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
  const dirtySlots = forest.dirtyVisibilitySlotsByBucket.get(mapping.bucketIndex)
    ?? new Set<number>();
  dirtySlots.add(mapping.slotIndex);
  forest.dirtyVisibilitySlotsByBucket.set(mapping.bucketIndex, dirtySlots);
}

export function commitSeedThreeForestMatrices(forest: SeedThreeForestInstances): void {
  if (forest.visibilityDirty === false) return;
  let matrixWrites = 0;
  for (const [bucketIndex, dirtySlotIndices] of forest.dirtyVisibilitySlotsByBucket) {
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
    nearTrees += bucket.nearViewSlotIndices.reduce(
      (count, slotIndex) => count + (bucket.slots[slotIndex]?.enabled ? 1 : 0),
      0,
    );
    overviewTrees += bucket.overviewViewSlotIndices.reduce(
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
    const stabilizeInteractionBuffers = options.stabilizeDuringInteraction === true;
    const residentColorGuardCoversCriticalView =
      seedThreeColorSelectionCoversView(
        forest.buckets,
        forest.slotByLayoutIndex,
        selection.criticalViewIndices,
      );
    const residentShadowCoversDesiredUnion = !forest.shadowsEnabled || (
      seedThreeResidentSelectionCoversView(
        forest.buckets,
        forest.slotByLayoutIndex,
        selection.nearIndices,
      )
      && seedThreeResidentSelectionCoversView(
        forest.buckets,
        forest.slotByLayoutIndex,
        selection.overviewIndices,
      )
    );
    const residentPassesCoverRequiredWork =
      residentColorGuardCoversCriticalView
      // Directional-shadow overscan may trail while the camera is moving; it
      // must never force a color-buffer repack into an interaction frame.
      && (cameraInteractionActive || residentShadowCoversDesiredUnion);
    const interactionWork = planSeedThreeForestInteractionWork(
      previousCameraInteractionActive,
      cameraInteractionActive,
      residentPassesCoverRequiredWork,
    );
    const deferInteractionWork = stabilizeInteractionBuffers
      && interactionWork.deferWork;
    const discardCoveredInteractionWork = stabilizeInteractionBuffers
      && interactionWork.discardCoveredWork;
    // Publish the first resolved resident set atomically before the forest
    // reaches a render pass. First-person can begin with a spatial set, while
    // RTS intentionally retains its complete stable caster residency.
    const completeInteractionWorkImmediately = initialSelection
      || (stabilizeInteractionBuffers && interactionWork.completeImmediately);
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
            maxChunks: deferInteractionWork || discardCoveredInteractionWork
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
                !work.activeBucketJob
                || work.activeBucketJob.bucketIndex !== bucketIndex
                || !sameBucketSelection(work.activeBucketJob.desired, desired)
              ) {
                const writeColor = !sameIndices(
                  bucket.nearViewSlotIndices,
                  desired.viewNear,
                ) || !sameIndices(
                  bucket.overviewViewSlotIndices,
                  desired.viewOverview,
                );
                const writeShadow = forest.shadowsEnabled && !sameIndices(
                  bucket.nearSlotIndices,
                  desired.near,
                );
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
  return sameIndices(left.near, right.near)
    && sameIndices(left.overview, right.overview)
    && sameIndices(left.viewNear, right.viewNear)
    && sameIndices(left.viewOverview, right.viewOverview)
    && left.nearViewSlotCount === right.nearViewSlotCount
    && left.overviewViewSlotCount === right.overviewViewSlotCount;
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
  selection: {
    nearIndices: readonly number[];
    overviewIndices: readonly number[];
    viewIndices: readonly number[];
  },
  firstPersonActive: boolean,
): PassPartitionedBucketSelection[] {
  const desired = forest.buckets.map((bucket) => {
    // Color trees are a stable world layer. Keeping every LOD2 instance
    // resident prevents camera pans, turns, zooms, and first-person movement
    // from changing the live color-buffer identities.
    const color = createSeedThreeStableColorSlotSelection(bucket.slots);
    const rtsShadow = createSeedThreeStableRtsShadowSlotSelection(bucket.slots);
    return {
      // Strategic views keep the same committed tree caster identities across
      // every pan and zoom. Replacing this packed list after navigation made
      // the cached atlas visibly rebuild the entire forest shadow field.
      // First-person retains the smaller spatial set where its continuous
      // refresh policy already provides stable close shadow motion.
      near: firstPersonActive ? [] : rtsShadow.near,
      overview: firstPersonActive ? [] : rtsShadow.overview,
      viewNear: color.near,
      viewOverview: color.overview,
      nearViewSlotCount: color.near.length,
      overviewViewSlotCount: color.overview.length,
    };
  });
  if (!firstPersonActive) return desired;
  const staticLodPartition = partitionSeedThreeSelectionByStaticLod(
    selection,
    (layoutIndex) => {
      const mapping = forest.slotByLayoutIndex[layoutIndex];
      return mapping
        ? forest.buckets[mapping.bucketIndex]?.slots[mapping.slotIndex]?.forceOverview === true
        : false;
    },
    true,
  );
  for (const layoutIndex of staticLodPartition.nearIndices) {
    const mapping = forest.slotByLayoutIndex[layoutIndex];
    if (!mapping) continue;
    if (forest.buckets[mapping.bucketIndex]?.slots[mapping.slotIndex]?.overviewOnly) continue;
    desired[mapping.bucketIndex]?.near.push(mapping.slotIndex);
  }
  for (const layoutIndex of staticLodPartition.overviewIndices) {
    const mapping = forest.slotByLayoutIndex[layoutIndex];
    if (!mapping) continue;
    if (forest.buckets[mapping.bucketIndex]?.slots[mapping.slotIndex]?.overviewOnly) continue;
    desired[mapping.bucketIndex]?.overview.push(mapping.slotIndex);
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
      !mesh.isInstancedMesh
      || mesh.count <= 0
      || mesh.userData.seedThreeShadowOnly === true
      || !seedThreeMeshIsSubmitted(mesh, forest.group)
    ) return;
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
  const residentColor = emptySubmissionStats();
  const submittedColor = emptySubmissionStats();
  const criticalProjectedColor = emptySubmissionStats();
  const submittedPasses = {
    near: emptySubmissionStats(),
    crownUnderlay: emptySubmissionStats(),
    overview: emptySubmissionStats(),
  };
  const criticalNearByBucket = new Uint32Array(forest.buckets.length);
  const criticalOverviewByBucket = new Uint32Array(forest.buckets.length);
  let criticalColorTrees = 0;
  for (const layoutIndex of forest.visibilitySelector.criticalViewIndices) {
    const mapping = forest.slotByLayoutIndex[layoutIndex];
    if (!mapping) continue;
    const slot = forest.buckets[mapping.bucketIndex]?.slots[mapping.slotIndex];
    if (!slot?.enabled || slot.visibilityParent?.enabled === false) continue;
    criticalColorTrees += 1;
    criticalNearByBucket[mapping.bucketIndex] += 1;
    if (slot.forceOverview) criticalOverviewByBucket[mapping.bucketIndex] += 1;
  }
  let paddedColorTrees = 0;
  for (let bucketIndex = 0; bucketIndex < forest.buckets.length; bucketIndex += 1) {
    const bucket = forest.buckets[bucketIndex]!;
    paddedColorTrees += enabledSeedThreeTreeCount(
      bucket.slots,
      bucket.nearViewSlotIndices,
    );
    for (const mesh of lodSetMeshes(bucket.nearSet)) {
      accumulateSubmission(residentColor, mesh, mesh.count);
      const pass = mesh.userData.crownUnderlay === true
        ? submittedPasses.crownUnderlay
        : submittedPasses.near;
      if (seedThreeMeshIsSubmitted(mesh, forest.group)) {
        accumulateSubmission(submittedColor, mesh, mesh.count);
        accumulateSubmission(pass, mesh, mesh.count);
        accumulateSubmission(
          criticalProjectedColor,
          mesh,
          criticalNearByBucket[bucketIndex]! * seedThreeInstancesPerTree(mesh),
        );
      }
    }
    for (const mesh of lodSetMeshes(bucket.overviewSet)) {
      accumulateSubmission(residentColor, mesh, mesh.count);
      if (!seedThreeMeshIsSubmitted(mesh, forest.group)) continue;
      accumulateSubmission(submittedColor, mesh, mesh.count);
      accumulateSubmission(submittedPasses.overview, mesh, mesh.count);
      accumulateSubmission(
        criticalProjectedColor,
        mesh,
        criticalOverviewByBucket[bucketIndex]! * seedThreeInstancesPerTree(mesh),
      );
    }
  }
  return {
    paddedColorTrees,
    criticalColorTrees,
    residentColor,
    submittedColor,
    criticalProjectedColor,
    submittedPasses,
  };
}

function emptySubmissionStats(): SeedThreeForestSubmissionStats {
  return { draws: 0, triangles: 0, instances: 0 };
}

function lodSetMeshes(lodSet: InstancedLodSet): THREE.InstancedMesh[] {
  return [
    ...(lodSet.branches ? [lodSet.branches] : []),
    ...lodSet.cards,
  ];
}

function seedThreeInstancesPerTree(mesh: THREE.InstancedMesh): number {
  return Math.max(1, Number(mesh.userData.k) || 1);
}

function seedThreeMeshIsSubmitted(
  mesh: THREE.InstancedMesh,
  forestGroup: THREE.Group,
): boolean {
  if (mesh.count <= 0) return false;
  for (let object: THREE.Object3D | null = mesh; object; object = object.parent) {
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

function enabledSeedThreeTreeCount(
  slots: readonly TreeSlot[],
  selectedSlotIndices: readonly number[],
): number {
  let count = 0;
  for (const slotIndex of selectedSlotIndices) {
    const slot = slots[slotIndex];
    if (slot?.enabled && slot.visibilityParent?.enabled !== false) count += 1;
  }
  return count;
}

export function setSeedThreeForestShadows(forest: SeedThreeForestInstances, enabled: boolean): void {
  forest.shadowsEnabled = enabled;
  forest.group.traverse((object: THREE.Object3D) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = enabled && mesh.userData.neverCastShadow !== true;
  });
}

export function updateSeedThreeCrownUnderlayVisibility(
  forest: SeedThreeForestInstances,
  cameraDistance: number,
  firstPersonActive: boolean,
): boolean {
  const presentationVisible = shouldShowSeedThreeCrownUnderlay(
    forest.crownUnderlayVisible,
    cameraDistance,
    firstPersonActive,
  );
  const visible = forest.distantCanopyCardsEnabled && presentationVisible;
  const visibilityChanged = presentationVisible !== forest.crownUnderlayVisible
    || forest.crownUnderlayMeshes.some((mesh) => mesh.visible !== visible);
  if (!visibilityChanged) return false;
  forest.crownUnderlayVisible = presentationVisible;
  for (const mesh of forest.crownUnderlayMeshes) mesh.visible = visible;
  return true;
}

export function setSeedThreeDistantCanopyCardsEnabled(
  forest: SeedThreeForestInstances,
  enabled: boolean,
): void {
  forest.distantCanopyCardsEnabled = enabled;
  const visible = enabled && forest.crownUnderlayVisible;
  for (const mesh of forest.crownUnderlayMeshes) mesh.visible = visible;
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

export function updateSeedThreeForestOverviewBillboardFade(
  forest: SeedThreeForestInstances,
  cameraDistance: number,
  firstPersonActive: boolean,
  deltaSeconds: number,
): boolean {
  const previous = forest.overviewBillboardFade;
  const zoomPercent = Number.isFinite(cameraDistance) && cameraDistance > 0
    ? (BASELINE_ORBIT_DISTANCE / cameraDistance) * 100
    : 100;
  const next = updateSeedThreeOverviewBillboardFade(
    previous,
    zoomPercent,
    deltaSeconds,
    firstPersonActive,
  );
  forest.overviewBillboardFade = {
    enabled: next.enabled,
    opacity: next.opacity,
  };
  setSeedThreeOverviewBillboardFadeOpacity(next.opacity);
  const visibilityChanged = forest.overviewBillboardGroup.visible !== next.visible;
  forest.overviewBillboardGroup.visible = next.visible;
  forest.overviewBillboardGroup.userData.fadeEnabled = next.enabled;
  forest.overviewBillboardGroup.userData.fadeOpacity = next.opacity;
  forest.overviewBillboardGroup.userData.fadeTargetOpacity = next.targetOpacity;
  return visibilityChanged
    || previous.enabled !== next.enabled
    || Math.abs(previous.opacity - next.opacity) > 1e-4;
}

export function disposeSeedThreeForest(forest: SeedThreeForestInstances): void {
  forest.group.traverse((object: THREE.Object3D) => {
    const mesh = object as THREE.InstancedMesh;
    if (!mesh.isInstancedMesh) return;
    if (mesh.geometry.userData.forestClone) mesh.geometry.dispose();
    mesh.dispose();
  });
  for (const material of forest.ownedOverviewFadeMaterials) material.dispose();
}

export function createSeedThreeForestController(forest: SeedThreeForestInstances): SeedThreeForestController {
  return {
    hideTree: (layoutIndex) => setSeedThreeTreeVisible(forest, layoutIndex, false),
    showTree: (layoutIndex) => setSeedThreeTreeVisible(forest, layoutIndex, true),
    commit: () => commitSeedThreeForestMatrices(forest),
    updateCamera: (
      camera,
      cameraDistance,
      firstPersonActive,
      casterBounds,
      cameraInteractionActive,
      deltaSeconds = 1 / 60,
    ) => {
      // Color LOD2 trees remain resident across the whole world. The selector
      // now scopes only exact shadow casters; zoom changes only card opacity.
      const fadeChanged = updateSeedThreeForestOverviewBillboardFade(
        forest,
        cameraDistance,
        firstPersonActive,
        deltaSeconds,
      );
      const cameraUpdate = updateSeedThreeForestCamera(
        forest,
        camera,
        firstPersonActive,
        casterBounds,
        cameraInteractionActive,
      );
      return {
        presentationChanged: fadeChanged
          || cameraUpdate.selectionChanged
          || cameraUpdate.bucketCompactions > 0,
        shadowCastersChanged: cameraUpdate.shadowCastersChanged,
      };
    },
    getStructuralStats: () => getSeedThreeForestStructuralStats(forest),
    getProfileBreakdown: () => getSeedThreeForestProfileBreakdown(forest),
    setDeciduousFoliage: (presentation) =>
      setSeedThreeForestDeciduousFoliage(forest, presentation),
    setSnowCoverage: (coverage) =>
      setSeedThreeForestSnowCoverage(forest, coverage),
    setDistantCanopyCardsEnabled: (enabled) =>
      setSeedThreeDistantCanopyCardsEnabled(forest, enabled),
    setShadows: (enabled) => setSeedThreeForestShadows(forest, enabled),
    dispose: () => disposeSeedThreeForest(forest),
  };
}
