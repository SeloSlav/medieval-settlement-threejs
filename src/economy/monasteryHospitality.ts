import {
  CALENDAR_DAYS_PER_MONTH,
  CALENDAR_MONTHS_PER_YEAR,
  MONASTERY_FEAST_HONEY,
  MONASTERY_FEAST_WINE,
  MONASTERY_HOSPITALITY_BONUS_GOLD_PER_DAY,
  MONASTERY_HOSPITALITY_HONEY_PER_DAY,
  MONASTERY_HOSPITALITY_WINE_PER_DAY,
  MONASTERY_PILGRIMAGE_GOLD_PER_DAY,
} from '../generated/gameBalance.ts';
import type { BuildingState } from '../resources/types.ts';

export const MONASTERY_FEASTS_PER_YEAR = 5;

export type MonasteryHospitalityPlan = {
  enabled: boolean;
  honeyRunwayDays: number;
  wineRunwayDays: number;
  supplyRatio: number;
  pilgrimageGoldPerDay: number;
  honeyPerDay: number;
  winePerDay: number;
  honeyPerYear: number;
  winePerYear: number;
};

function stockSupplyRatio(stock: number): number {
  return stock > 1e-6 ? 1 : 0;
}

export function monasteryHospitalityRunwayDays(
  stock: number,
  dailyUse: number,
): number {
  return dailyUse <= 1e-9
    ? Number.POSITIVE_INFINITY
    : Math.max(0, stock) / dailyUse;
}

export function monasteryHospitalityPlan(
  monastery: Pick<BuildingState, 'honey' | 'wine'>,
  enabled: boolean,
): MonasteryHospitalityPlan {
  const honeyPerDay = enabled ? MONASTERY_HOSPITALITY_HONEY_PER_DAY : 0;
  const winePerDay = enabled ? MONASTERY_HOSPITALITY_WINE_PER_DAY : 0;
  const supplyRatio = enabled
    ? (
        stockSupplyRatio(monastery.honey)
        + stockSupplyRatio(monastery.wine)
      ) * 0.5
    : 0;
  const daysPerYear = CALENDAR_DAYS_PER_MONTH * CALENDAR_MONTHS_PER_YEAR;
  return {
    enabled,
    honeyRunwayDays: monasteryHospitalityRunwayDays(monastery.honey, honeyPerDay),
    wineRunwayDays: monasteryHospitalityRunwayDays(monastery.wine, winePerDay),
    supplyRatio,
    pilgrimageGoldPerDay:
      MONASTERY_PILGRIMAGE_GOLD_PER_DAY
      + (enabled ? MONASTERY_HOSPITALITY_BONUS_GOLD_PER_DAY * supplyRatio : 0),
    honeyPerDay,
    winePerDay,
    honeyPerYear:
      honeyPerDay * daysPerYear
      + (enabled ? MONASTERY_FEAST_HONEY * MONASTERY_FEASTS_PER_YEAR : 0),
    winePerYear:
      winePerDay * daysPerYear
      + (enabled ? MONASTERY_FEAST_WINE * MONASTERY_FEASTS_PER_YEAR : 0),
  };
}

export function monasteryHospitalityStatusLabel(
  plan: MonasteryHospitalityPlan,
): string {
  if (!plan.enabled) return 'Disabled — specialty goods remain exportable';
  if (plan.supplyRatio >= 0.999) return 'Fully provisioned';
  if (plan.supplyRatio >= 0.499) return 'Partly provisioned — one specialty good missing';
  return 'Unprovisioned — baseline pilgrim income only';
}

export function formatHospitalityRunway(days: number): string {
  if (!Number.isFinite(days)) return 'No demand';
  if (days <= 1e-6) return 'Empty';
  return `${days.toFixed(days < 10 ? 1 : 0)} days`;
}
