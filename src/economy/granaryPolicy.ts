import { BUILDING_STORAGE_CAPS } from '../generated/gameBalance.ts';
import { compareStableEntityIds } from '../logistics/roadLogistics.ts';
import type { BuildingState, GameState } from '../resources/types.ts';
import { breadGrainStock } from './cropGoods.ts';

export const GRANARY_GRAIN_RESERVE_MIN = 0;
export const GRANARY_GRAIN_RESERVE_MAX = BUILDING_STORAGE_CAPS.granary.grain ?? 420;
export const GRANARY_FRESH_FOOD_TARGET_DEFAULT_PERCENT = 75;

export const GRANARY_GRAIN_RESERVE_PRESETS = [
  { reserve: 0, label: 'Release all' },
  { reserve: 60, label: 'Small sowing reserve' },
  { reserve: 120, label: 'Village sowing reserve' },
  { reserve: 240, label: 'Long winter reserve' },
] as const;

export const GRANARY_FRESH_FOOD_TARGET_PRESETS = [
  {
    percent: 25,
    label: 'Local branch',
    hint: 'Limits collection-cart traffic and leaves most fresh food near its household territory.',
  },
  {
    percent: 50,
    label: 'Lean reserve',
    hint: 'Shelters a moderate buffer without tying up most of the granary or its cart.',
  },
  {
    percent: 75,
    label: 'Balanced',
    hint: 'Matches the original granary behavior and keeps substantial winter stock sheltered.',
  },
  {
    percent: 90,
    label: 'Deep reserve',
    hint: 'Maximizes sheltered stock while retaining headroom for incoming harvest carts.',
  },
] as const;

export function normalizeGranaryFreshFoodTargetPercent(
  percent: number | undefined,
): number {
  if (!Number.isFinite(percent)) return GRANARY_FRESH_FOOD_TARGET_DEFAULT_PERCENT;
  const rounded = Math.round(percent as number);
  return GRANARY_FRESH_FOOD_TARGET_PRESETS.some((preset) => preset.percent === rounded)
    ? rounded
    : GRANARY_FRESH_FOOD_TARGET_DEFAULT_PERCENT;
}

export function granaryFreshFoodTarget(capacity: number, percent: number | undefined): number {
  if (!Number.isFinite(capacity)) return 0;
  return Math.max(0, capacity)
    * normalizeGranaryFreshFoodTargetPercent(percent)
    / 100;
}

export type SettlementGranaryReserve = {
  granaries: number;
  grainStored: number;
  reserveTarget: number;
  protectedStock: number;
  reserveShortfall: number;
  processorAndTradeSurplus: number;
  firstShortGranaryId: string | null;
};

export function normalizeGranaryGrainReserve(reserve: number): number {
  if (!Number.isFinite(reserve)) return GRANARY_GRAIN_RESERVE_MIN;
  return Math.max(
    GRANARY_GRAIN_RESERVE_MIN,
    Math.min(GRANARY_GRAIN_RESERVE_MAX, Math.round(reserve)),
  );
}

/** Grain ordinary processors and foreign sales may take from this granary. */
export function granaryExportableGrain(
  stock: number,
  reserve: number,
): number {
  if (!Number.isFinite(stock)) return 0;
  return Math.max(0, stock - normalizeGranaryGrainReserve(reserve));
}

export function granaryProtectedGrain(
  stock: number,
  reserve: number,
): number {
  return Math.min(
    Math.max(0, Number.isFinite(stock) ? stock : 0),
    normalizeGranaryGrainReserve(reserve),
  );
}

export function computeSettlementGranaryReserve(
  state: GameState,
): SettlementGranaryReserve {
  let granaries = 0;
  let grainStored = 0;
  let reserveTarget = 0;
  let protectedStock = 0;
  let processorAndTradeSurplus = 0;
  let firstShortGranaryId: string | null = null;
  let firstShortCoverage = Number.POSITIVE_INFINITY;

  for (const building of state.buildings.values()) {
    if (building.kind !== 'granary' || building.constructionComplete === false) {
      continue;
    }
    granaries += 1;
    const stock = breadGrainStock(building);
    const reserve = normalizeGranaryGrainReserve(building.granaryGrainReserve ?? 0);
    grainStored += stock;
    reserveTarget += reserve;
    protectedStock += granaryProtectedGrain(stock, reserve);
    processorAndTradeSurplus += granaryExportableGrain(stock, reserve);
    if (reserve <= stock + 0.05) continue;
    const coverage = reserve > 1e-9 ? Math.min(1, stock / reserve) : 1;
    if (
      firstShortGranaryId === null
      || coverage < firstShortCoverage - 1e-9
      || (
        Math.abs(coverage - firstShortCoverage) <= 1e-9
        && compareStableEntityIds(building.id, firstShortGranaryId) < 0
      )
    ) {
      firstShortGranaryId = building.id;
      firstShortCoverage = coverage;
    }
  }

  return {
    granaries,
    grainStored,
    reserveTarget,
    protectedStock,
    reserveShortfall: Math.max(0, reserveTarget - protectedStock),
    processorAndTradeSurplus,
    firstShortGranaryId,
  };
}

export function granaryReserveLabel(building: Pick<
  BuildingState,
  | 'ryeGrain' | 'oatGrain' | 'maslinGrain' | 'granaryGrainReserve'
>): string {
  const reserve = normalizeGranaryGrainReserve(building.granaryGrainReserve ?? 0);
  const stock = breadGrainStock(building);
  const protectedStock = granaryProtectedGrain(stock, reserve);
  const exportable = granaryExportableGrain(stock, reserve);
  if (reserve <= 1e-6) {
    return `${Math.round(exportable)} grain releasable · no protected floor`;
  }
  return `${Math.round(protectedStock)} / ${Math.round(reserve)} protected · ${Math.round(exportable)} releasable`;
}
