import type * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import {
  BRANCH_CARD_CROWN_UNDERLAY_DEFAULTS,
  bakeBranchCards,
  disposeBranchCards,
  planBranchCardCrownUnderlay,
  type BranchCardsSet,
} from '@seedthree/core/branch-cards.js';
import type { SeedThreeSpeciesAssets, SeedThreeSpeciesPreset } from './seedThreeAssets.ts';
import {
  readSeedThreeBranchCards,
  writeSeedThreeBranchCards,
} from './seedThreeBranchCardCache.ts';
import { SEEDTHREE_BRANCH_CARD_BAKE_REVISION } from './seedThreeBranchCardPolicy.ts';

export type SeedThreeBranchCards = {
  byLevel: Map<string, BranchCardsSet>;
  variants: BranchCardsSet['variants'];
  centerUniform: { value: THREE.Vector3 };
};

export type SeedThreeBranchCardBuildOptions = {
  yieldBetweenCaptures?: () => Promise<void>;
  onRendererBusyChange?: (busy: boolean) => void;
};

export type SeedThreeBranchCardStartupTiming = {
  key: string;
  species: string;
  source: 'memory' | 'persistent' | 'baked' | 'unavailable';
  restoreMs: number;
  bakeMs: number;
  totalMs: number;
  persistenceQueued: boolean;
};

const CARD_RES = 512;
const CARD_VARIANTS = 3;
const cardCache = new Map<string, SeedThreeBranchCards>();
const cardBuildPromiseCache = new Map<string, Promise<SeedThreeBranchCards | null>>();
const cardRestorePromiseCache = new Map<string, Promise<SeedThreeBranchCards | null>>();
const persistentCacheCheckedKeys = new Set<string>();
const startupTimings = new Map<string, SeedThreeBranchCardStartupTiming>();
let persistenceQueue: Promise<void> = Promise.resolve();
const persistenceJobsByKey = new Map<string, Promise<void>>();
let cardCacheGeneration = 0;
let rendererBakeBarrier: Promise<void> = Promise.resolve();

export function seedThreeBranchCardCacheKey(
  species: SeedThreeSpeciesPreset,
  mobileTarget: boolean,
): string {
  const foliage = species.foliage ?? {};
  const crownUnderlay = planBranchCardCrownUnderlay(foliage, 1);
  return [
    species.name,
    foliage.size ?? '',
    foliage.leavesPerBranch ?? '',
    foliage.cardCoverage ?? '',
    `r${foliage.cardRadialPlanes ?? 1}`,
    `u${crownUnderlay.enabled ? 1 : 0}x${crownUnderlay.lateralScale}`,
    species.params?.levels ?? '',
    CARD_RES,
    CARD_VARIANTS,
    mobileTarget ? 'm' : 'd',
    `b${SEEDTHREE_BRANCH_CARD_BAKE_REVISION}`,
  ].join('|');
}

function leavesPerBranch(species: SeedThreeSpeciesPreset): number {
  const value = species.foliage?.leavesPerBranch;
  return typeof value === 'number' ? value : 1;
}

function skeletonLevels(species: SeedThreeSpeciesPreset): number {
  const value = species.params?.levels;
  return typeof value === 'number' ? value : 3;
}

export async function ensureSeedThreeBranchCards(
  renderer: WebGPURenderer,
  species: SeedThreeSpeciesPreset,
  assets: SeedThreeSpeciesAssets,
  mobileTarget: boolean,
  options: SeedThreeBranchCardBuildOptions = {},
): Promise<SeedThreeBranchCards | null> {
  if (species.foliageType === 'rosette') return null;
  if (!species.foliage || leavesPerBranch(species) <= 0) return null;

  const key = seedThreeBranchCardCacheKey(species, mobileTarget);
  const cached = cardCache.get(key);
  if (cached) {
    const prior = startupTimings.get(key);
    startupTimings.set(key, {
      key,
      species: species.name,
      source: prior?.source === 'persistent' ? 'persistent' : 'memory',
      restoreMs: prior?.restoreMs ?? 0,
      bakeMs: prior?.bakeMs ?? 0,
      totalMs: prior?.totalMs ?? 0,
      persistenceQueued: prior?.persistenceQueued ?? false,
    });
    return cached;
  }
  const pending = cardBuildPromiseCache.get(key);
  if (pending) return pending;

  const requestGeneration = cardCacheGeneration;
  const request = ensureSeedThreeBranchCardsUncached(
    renderer,
    species,
    assets,
    mobileTarget,
    options,
    key,
    requestGeneration,
  );
  cardBuildPromiseCache.set(key, request);
  try {
    return await request;
  } finally {
    if (cardBuildPromiseCache.get(key) === request) cardBuildPromiseCache.delete(key);
  }
}

async function ensureSeedThreeBranchCardsUncached(
  renderer: WebGPURenderer,
  species: SeedThreeSpeciesPreset,
  assets: SeedThreeSpeciesAssets,
  mobileTarget: boolean,
  options: SeedThreeBranchCardBuildOptions,
  key: string,
  requestGeneration: number,
): Promise<SeedThreeBranchCards | null> {
  const startedAt = performance.now();
  const restoreStartedAt = performance.now();
  const persisted = await restoreSeedThreeBranchCards(key, species.name);
  const restoreMs = performance.now() - restoreStartedAt;
  if (persisted) return persisted;
  if (requestGeneration !== cardCacheGeneration) return null;

  // Reserve the one renderer-exclusive bake lane before creating any capture
  // resources. This barrier deliberately survives cache disposal: a new world
  // waits for an old GPU bake to leave the shared renderer instead of starting
  // a second same-key (or cross-key) retargeting pass concurrently.
  const precedingBake = rendererBakeBarrier;
  let releaseBake!: () => void;
  const activeBake = new Promise<void>((resolve) => {
    releaseBake = resolve;
  });
  rendererBakeBarrier = precedingBake.then(() => activeBake, () => activeBake);
  await precedingBake.catch(() => undefined);
  try {
    if (requestGeneration !== cardCacheGeneration) return null;

    const maxLevel = skeletonLevels(species) - 1;
    const crownUnderlay = planBranchCardCrownUnderlay(species.foliage, 1);
    const jobs: Array<{
    key?: string;
    level: number;
    foliageOnly: boolean;
    preserveFoliageLayout?: boolean;
    maxRoots?: number;
    radialPlanes?: number;
    instanceCapacity?: number;
    variants?: number;
    size?: number;
    noFlutter?: boolean;
    }> = [
      { level: maxLevel, foliageOnly: true },
    ];
    if (crownUnderlay.enabled) {
      jobs.push({
      key: '0:underlay',
      level: 0,
      foliageOnly: true,
      preserveFoliageLayout: true,
      maxRoots: BRANCH_CARD_CROWN_UNDERLAY_DEFAULTS.maxRootCards,
      radialPlanes: BRANCH_CARD_CROWN_UNDERLAY_DEFAULTS.radialPlanes,
      instanceCapacity: BRANCH_CARD_CROWN_UNDERLAY_DEFAULTS.maxRootCards,
      variants: 1,
      size: Math.max(256, Math.round(CARD_RES / 2)),
      noFlutter: true,
      });
    }
    if (mobileTarget) {
      jobs.push({ level: maxLevel, foliageOnly: false });
      jobs.push({ level: Math.max(1, maxLevel - 1), foliageOnly: false });
    }
    const byLevel = new Map<string, BranchCardsSet>();
    const noFlutterByLevel = new Map<string, boolean>();
    const bakeStartedAt = performance.now();
    try {
      for (const job of jobs) {
      const jobKey = job.key ?? `${job.level}:${job.foliageOnly ? 'fol' : 'full'}`;
      if (byLevel.has(jobKey)) continue;
      const noFlutter = job.noFlutter ?? job.level < maxLevel;
      noFlutterByLevel.set(jobKey, noFlutter);
      const set = await bakeBranchCards(renderer, species, assets, {
        size: job.size ?? CARD_RES,
        variants: job.variants ?? CARD_VARIANTS,
        cardLevel: job.level,
        foliageOnly: job.foliageOnly,
        preserveFoliageLayout: job.preserveFoliageLayout,
        maxRoots: job.maxRoots,
        radialPlanes: job.radialPlanes,
        instanceCapacity: job.instanceCapacity,
        noFlutter,
        yield: options.yieldBetweenCaptures,
        onRendererBusyChange: options.onRendererBusyChange,
      });
      if (!set) throw new Error(`required branch-card bake "${jobKey}" returned no card set`);
      if (jobKey === '0:underlay') {
        for (const variant of set.variants) variant.geometry.userData.crownUnderlay = true;
      }
      byLevel.set(jobKey, set);
      }
    } catch (error) {
      disposeBranchCards({ byLevel });
      console.warn('[SeedThree] branch card bake failed:', species.name, error);
      startupTimings.set(key, {
      key,
      species: species.name,
      source: 'unavailable',
      restoreMs,
      bakeMs: performance.now() - bakeStartedAt,
      totalMs: performance.now() - startedAt,
      persistenceQueued: false,
      });
      return null;
    }

    const near = byLevel.get(`${maxLevel}:fol`) ?? byLevel.get(`${maxLevel}:full`);
    if (!near) return null;

    const cards: SeedThreeBranchCards = {
      byLevel,
      variants: near.variants,
      centerUniform: near.centerUniform,
    };

    if (requestGeneration !== cardCacheGeneration) {
      disposeBranchCards(cards);
      return null;
    }

    cardCache.set(key, cards);
    queueSeedThreeBranchCardPersistence(key, cards, noFlutterByLevel);
    startupTimings.set(key, {
    key,
    species: species.name,
    source: 'baked',
    restoreMs,
    bakeMs: performance.now() - bakeStartedAt,
    totalMs: performance.now() - startedAt,
    persistenceQueued: true,
    });
    if (cardCache.size > 8) {
      const [oldKey, old] = cardCache.entries().next().value!;
      if (oldKey !== key) {
        cardCache.delete(oldKey);
        disposeCardsAfterPersistence([old], persistenceQueue);
      }
    }

    return cards;
  } finally {
    releaseBake();
  }
}

/**
 * Restore immutable branch-card atlases while terrain is still being built.
 * This never starts a renderer bake, so all species can safely decode in
 * parallel without competing for the WebGPU render target.
 */
export async function preloadSeedThreeBranchCardCache(
  species: SeedThreeSpeciesPreset,
  mobileTarget: boolean,
): Promise<void> {
  if (species.foliageType === 'rosette') return;
  if (!species.foliage || leavesPerBranch(species) <= 0) return;
  const key = seedThreeBranchCardCacheKey(species, mobileTarget);
  await restoreSeedThreeBranchCards(key, species.name);
}

export function getSeedThreeBranchCardStartupTimings(): SeedThreeBranchCardStartupTiming[] {
  return [...startupTimings.values()].map((timing) => ({ ...timing }));
}

export function waitForSeedThreeBranchCardPersistence(): Promise<void> {
  return persistenceQueue;
}

async function restoreSeedThreeBranchCards(
  key: string,
  speciesName: string,
): Promise<SeedThreeBranchCards | null> {
  const cached = cardCache.get(key);
  if (cached) return cached;
  const pending = cardRestorePromiseCache.get(key);
  if (pending) return pending;
  if (persistentCacheCheckedKeys.has(key)) return null;

  const startedAt = performance.now();
  const requestGeneration = cardCacheGeneration;
  const request = (async () => {
    // A previous world may have queued this exact immutable key immediately
    // before disposal. Let that durable snapshot land before deciding the new
    // world has a cache miss and starting a redundant GPU bake.
    await persistenceJobsByKey.get(key);
    return readSeedThreeBranchCards(key);
  })().then((persisted) => {
    if (requestGeneration !== cardCacheGeneration) {
      if (persisted) disposeBranchCards(persisted);
      return null;
    }
    persistentCacheCheckedKeys.add(key);
    if (persisted) {
      cardCache.set(key, persisted);
      const durationMs = performance.now() - startedAt;
      startupTimings.set(key, {
        key,
        species: speciesName,
        source: 'persistent',
        restoreMs: durationMs,
        bakeMs: 0,
        totalMs: durationMs,
        persistenceQueued: false,
      });
    }
    return persisted;
  });
  cardRestorePromiseCache.set(key, request);
  try {
    return await request;
  } finally {
    if (cardRestorePromiseCache.get(key) === request) cardRestorePromiseCache.delete(key);
  }
}

function queueSeedThreeBranchCardPersistence(
  key: string,
  cards: SeedThreeBranchCards,
  noFlutterByLevel: ReadonlyMap<string, boolean>,
): void {
  // PNG encoding and IndexedDB writes are durable-cache work, not visual
  // readiness work. Serialize one species at a time, overlapped with the next
  // renderer-exclusive bake, instead of adding every write to first-play time.
  const job = persistenceQueue
    .catch((error: unknown) => {
      // A failed older cache job must never poison persistence for every later
      // species or create an unhandled rejection.
      console.warn('[SeedThree] previous branch-card persistence job failed:', error);
    })
    .then(() => writeSeedThreeBranchCards(key, cards, noFlutterByLevel))
    .catch((error: unknown) => {
      console.warn('[SeedThree] branch-card persistence job failed:', error);
    });
  persistenceQueue = job;
  persistenceJobsByKey.set(key, job);
  void job.finally(() => {
    if (persistenceJobsByKey.get(key) === job) persistenceJobsByKey.delete(key);
  }).catch(() => undefined);
}

function disposeCardsAfterPersistence(
  cards: readonly SeedThreeBranchCards[],
  barrier: Promise<void>,
): void {
  const release = () => {
    for (const cardSet of cards) disposeBranchCards(cardSet);
  };
  void barrier.then(release, release).catch((error: unknown) => {
    console.warn('[SeedThree] deferred branch-card disposal failed:', error);
  });
}

export function disposeSeedThreeBranchCardCache(): void {
  cardCacheGeneration += 1;
  const cardsToDispose = [...cardCache.values()];
  const pendingPersistenceAtDispose = persistenceQueue;
  cardCache.clear();
  cardBuildPromiseCache.clear();
  cardRestorePromiseCache.clear();
  persistentCacheCheckedKeys.clear();
  startupTimings.clear();
  // A queued PNG snapshot still reads the immutable card canvases. Keep only
  // those old resources alive until the queue position that existed at dispose
  // completes; a new world gets distinct cache objects and cannot be disposed
  // by this closure.
  disposeCardsAfterPersistence(cardsToDispose, pendingPersistenceAtDispose);
}
