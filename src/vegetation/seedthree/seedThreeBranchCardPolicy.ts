import * as branchCardApi from '@seedthree/core/branch-cards.js';

type SeedThreeBranchCardApi = typeof branchCardApi & {
  readonly BRANCH_CARD_BAKE_REVISION: number;
};

/**
 * Upstream SeedThree's atlas-content revision. Both cache layers include this
 * value so a new bake policy cannot restore an older, visually sparse atlas.
 */
export const SEEDTHREE_BRANCH_CARD_BAKE_REVISION = (
  branchCardApi as SeedThreeBranchCardApi
).BRANCH_CARD_BAKE_REVISION;

export const SEEDTHREE_BRANCH_CARD_CACHE_VERSION =
  `seedthree-cards-v2-b${SEEDTHREE_BRANCH_CARD_BAKE_REVISION}`;

export function seedThreePersistentBranchCardCacheKey(cacheKey: string): string {
  return `${SEEDTHREE_BRANCH_CARD_CACHE_VERSION}:${cacheKey}`;
}
