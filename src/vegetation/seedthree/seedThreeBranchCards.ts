import type * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import {
  bakeBranchCards,
  disposeBranchCards,
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

const CARD_RES = 512;
const CARD_VARIANTS = 3;
const cardCache = new Map<string, SeedThreeBranchCards>();

export function seedThreeBranchCardCacheKey(
  species: SeedThreeSpeciesPreset,
  mobileTarget: boolean,
): string {
  const foliage = species.foliage ?? {};
  return [
    species.name,
    foliage.size ?? '',
    foliage.leavesPerBranch ?? '',
    foliage.cardCoverage ?? '',
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
  if (cached) return cached;
  const persisted = await readSeedThreeBranchCards(key);
  if (persisted) {
    cardCache.set(key, persisted);
    return persisted;
  }

  const maxLevel = skeletonLevels(species) - 1;
  const jobs: Array<{ level: number; foliageOnly: boolean }> = [
    { level: maxLevel, foliageOnly: true },
  ];
  if (mobileTarget) {
    jobs.push({ level: maxLevel, foliageOnly: false });
    jobs.push({ level: Math.max(1, maxLevel - 1), foliageOnly: false });
  }
  const byLevel = new Map<string, BranchCardsSet>();
  const noFlutterByLevel = new Map<string, boolean>();
  try {
    for (const job of jobs) {
      const jobKey = `${job.level}:${job.foliageOnly ? 'fol' : 'full'}`;
      if (byLevel.has(jobKey)) continue;
      const noFlutter = job.level < maxLevel;
      noFlutterByLevel.set(jobKey, noFlutter);
      const set = await bakeBranchCards(renderer, species, assets, {
        size: CARD_RES,
        variants: CARD_VARIANTS,
        cardLevel: job.level,
        foliageOnly: job.foliageOnly,
        noFlutter,
        yield: options.yieldBetweenCaptures,
        onRendererBusyChange: options.onRendererBusyChange,
      });
      if (set) byLevel.set(jobKey, set);
    }
  } catch (error) {
    disposeBranchCards({ byLevel });
    console.warn('[SeedThree] branch card bake failed:', species.name, error);
    return null;
  }

  const near = byLevel.get(`${maxLevel}:fol`) ?? byLevel.get(`${maxLevel}:full`);
  if (!near) return null;

  const cards: SeedThreeBranchCards = {
    byLevel,
    variants: near.variants,
    centerUniform: near.centerUniform,
  };

  cardCache.set(key, cards);
  await writeSeedThreeBranchCards(key, cards, noFlutterByLevel);
  if (cardCache.size > 8) {
    const [oldKey, old] = cardCache.entries().next().value!;
    if (oldKey !== key) {
      cardCache.delete(oldKey);
      disposeBranchCards(old);
    }
  }

  return cards;
}

export function disposeSeedThreeBranchCardCache(): void {
  for (const cards of cardCache.values()) {
    disposeBranchCards(cards);
  }
  cardCache.clear();
}
