import type { ForagingNodeState } from '../resources/types.ts';
import { GAME_MIN_BREEDING_POPULATION } from '../generated/gameBalance.ts';
import { FISH_SHOAL_MAX_YIELD } from './foragingYields.ts';

export const HARVEST_RESERVE_PERCENT_MAX = 90;
export const HARVEST_RESERVE_PRESETS = [
  { label: 'Open harvest', percent: 0 },
  { label: 'Keep quarter', percent: 25 },
  { label: 'Keep half', percent: 50 },
] as const;

export function normalizeHarvestReservePercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.min(
    HARVEST_RESERVE_PERCENT_MAX,
    Math.max(0, Math.round(percent)),
  );
}

export function protectedWildStock(
  kind: ForagingNodeState['kind'],
  maxYield: number,
  percent: number,
): number {
  if (kind !== 'game' && kind !== 'fish') return 0;
  const capacity = Math.max(0, maxYield);
  const policyFloor = capacity
    * normalizeHarvestReservePercent(percent)
    / 100;
  const renewableFloor = kind === 'game'
    ? GAME_MIN_BREEDING_POPULATION
    : kind === 'fish' && capacity > FISH_SHOAL_MAX_YIELD
      ? 2
      : 0;
  return Math.max(policyFloor, Math.min(renewableFloor, capacity));
}

export function harvestableWildStock(
  node: Pick<ForagingNodeState, 'kind' | 'remaining' | 'maxYield'>,
  percent: number,
): number {
  return Math.max(
    0,
    node.remaining - protectedWildStock(node.kind, node.maxYield, percent),
  );
}

export function isWildStockHarvestable(
  node: Pick<ForagingNodeState, 'kind' | 'remaining' | 'maxYield'>,
  percent: number,
): boolean {
  return harvestableWildStock(node, percent) > 1e-6;
}
