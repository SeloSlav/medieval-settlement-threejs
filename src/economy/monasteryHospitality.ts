import {
  CALENDAR_DAYS_PER_MONTH,
  CALENDAR_MONTHS_PER_YEAR,
  MONASTERY_FEAST_ALE,
  MONASTERY_FEAST_FOOD,
  MONASTERY_FEAST_HONEY,
  MONASTERY_FEAST_WINE,
  MONASTERY_HOSPITALITY_BONUS_GOLD_PER_DAY,
  MONASTERY_HOSPITALITY_HONEY_PER_DAY,
  MONASTERY_HOSPITALITY_WINE_PER_DAY,
  MONASTERY_PILGRIMAGE_GOLD_PER_DAY,
} from '../generated/gameBalance.ts';
import type { BuildingState } from '../resources/types.ts';
import { MONTH_NAMES, type GameClock } from '../world/gameCalendar.ts';

export const MONASTERY_FEASTS = [
  { name: 'Epiphany', month: 1, monthDay: 2 },
  { name: 'Saints Peter and Paul', month: 6, monthDay: 10 },
  { name: 'Assumption', month: 8, monthDay: 5 },
  { name: 'Exaltation of the Holy Cross', month: 9, monthDay: 5 },
  { name: 'Christmas', month: 12, monthDay: 9 },
] as const;

export const MONASTERY_FEASTS_PER_YEAR = MONASTERY_FEASTS.length;

export type MonasteryFeast = (typeof MONASTERY_FEASTS)[number];

export type NextMonasteryFeast = MonasteryFeast & {
  daysUntil: number;
};

export type MonasteryFeastReadiness = {
  ready: boolean;
  missingFood: number;
  missingAle: number;
  missingHoney: number;
  missingWine: number;
};

export type MonasteryFeastCommodity = 'food' | 'ale' | 'honey' | 'wine';

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
  feastFoodPerYear: number;
  feastAlePerYear: number;
};

function stockSupplyRatio(stock: number): number {
  return stock > 1e-6 ? 1 : 0;
}

export function monasteryFeastReserve(
  commodity: MonasteryFeastCommodity,
): number {
  switch (commodity) {
    case 'food':
      return MONASTERY_FEAST_FOOD;
    case 'ale':
      return MONASTERY_FEAST_ALE;
    case 'honey':
      return MONASTERY_FEAST_HONEY;
    case 'wine':
      return MONASTERY_FEAST_WINE;
  }
}

export function monasteryFeastSurplus(
  stock: number,
  reserve: number,
  enabled: boolean,
): number {
  const available = finiteStock(stock);
  return enabled ? Math.max(0, available - Math.max(0, reserve)) : available;
}

export function monasteryFeastRefillShortfall(
  stock: number,
  inbound: number,
  reserve: number,
  enabled: boolean,
): number {
  if (!enabled) return 0;
  return Math.max(
    0,
    Math.max(0, reserve) - finiteStock(stock) - finiteStock(inbound),
  );
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
  const dailyHoney = monasteryFeastSurplus(
    monastery.honey,
    MONASTERY_FEAST_HONEY,
    enabled,
  );
  const dailyWine = monasteryFeastSurplus(
    monastery.wine,
    MONASTERY_FEAST_WINE,
    enabled,
  );
  const supplyRatio = enabled
    ? (
        stockSupplyRatio(dailyHoney)
        + stockSupplyRatio(dailyWine)
      ) * 0.5
    : 0;
  const daysPerYear = CALENDAR_DAYS_PER_MONTH * CALENDAR_MONTHS_PER_YEAR;
  return {
    enabled,
    honeyRunwayDays: monasteryHospitalityRunwayDays(dailyHoney, honeyPerDay),
    wineRunwayDays: monasteryHospitalityRunwayDays(dailyWine, winePerDay),
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
    feastFoodPerYear:
      enabled ? MONASTERY_FEAST_FOOD * MONASTERY_FEASTS_PER_YEAR : 0,
    feastAlePerYear:
      enabled ? MONASTERY_FEAST_ALE * MONASTERY_FEASTS_PER_YEAR : 0,
  };
}

export function monasteryFeastReadiness(
  monastery: Pick<BuildingState, 'food' | 'ale' | 'honey' | 'wine'>,
): MonasteryFeastReadiness {
  const missingFood = Math.max(0, MONASTERY_FEAST_FOOD - finiteStock(monastery.food));
  const missingAle = Math.max(0, MONASTERY_FEAST_ALE - finiteStock(monastery.ale));
  const missingHoney = Math.max(0, MONASTERY_FEAST_HONEY - finiteStock(monastery.honey));
  const missingWine = Math.max(0, MONASTERY_FEAST_WINE - finiteStock(monastery.wine));
  return {
    ready:
      missingFood <= 1e-9
      && missingAle <= 1e-9
      && missingHoney <= 1e-9
      && missingWine <= 1e-9,
    missingFood,
    missingAle,
    missingHoney,
    missingWine,
  };
}

export function nextMonasteryFeast(
  clock: Pick<GameClock, 'month' | 'monthDay' | 'hour' | 'minute'>,
): NextMonasteryFeast {
  const daysPerYear = CALENDAR_DAYS_PER_MONTH * CALENDAR_MONTHS_PER_YEAR;
  const currentDay = (clock.month - 1) * CALENDAR_DAYS_PER_MONTH + clock.monthDay - 1;
  const currentHour = clock.hour + clock.minute / 60;
  let best: NextMonasteryFeast | null = null;
  for (const feast of MONASTERY_FEASTS) {
    const feastDay = (feast.month - 1) * CALENDAR_DAYS_PER_MONTH + feast.monthDay - 1;
    let dayDelta = feastDay - currentDay;
    if (dayDelta < 0 || (dayDelta === 0 && currentHour >= 12)) {
      dayDelta += daysPerYear;
    }
    const daysUntil = Math.max(0, dayDelta + (12 - currentHour) / 24);
    if (best === null || daysUntil < best.daysUntil) {
      best = { ...feast, daysUntil };
    }
  }
  // The fixed schedule is non-empty; retain a total fallback for type safety.
  return best ?? { ...MONASTERY_FEASTS[0], daysUntil: 0 };
}

export function formatNextMonasteryFeast(feast: NextMonasteryFeast): string {
  const month = MONTH_NAMES[feast.month - 1] ?? `Month ${feast.month}`;
  const timing = feast.daysUntil < 1 / 24
    ? 'due now'
    : feast.daysUntil < 1
      ? `in ${(feast.daysUntil * 24).toFixed(1)} hours`
      : `in ${feast.daysUntil.toFixed(feast.daysUntil < 10 ? 1 : 0)} days`;
  return `${feast.name} · ${feast.monthDay} ${month} at 12:00 · ${timing}`;
}

export function formatMonasteryFeastReadiness(
  readiness: MonasteryFeastReadiness,
): string {
  if (readiness.ready) {
    return `Ready · ${MONASTERY_FEAST_FOOD} food + ${MONASTERY_FEAST_ALE} ale + ${MONASTERY_FEAST_HONEY} honey + ${MONASTERY_FEAST_WINE} wine secured`;
  }
  const missing = [
    ['food', readiness.missingFood],
    ['ale', readiness.missingAle],
    ['honey', readiness.missingHoney],
    ['wine', readiness.missingWine],
  ] as const;
  return `Short ${missing
    .filter(([, amount]) => amount > 1e-9)
    .map(([commodity, amount]) => `${formatAmount(amount)} ${commodity}`)
    .join(' · ')}`;
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

function finiteStock(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function formatAmount(amount: number): string {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(1);
}
