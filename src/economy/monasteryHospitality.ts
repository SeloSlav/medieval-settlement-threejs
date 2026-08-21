import {
  CALENDAR_DAYS_PER_MONTH,
  CALENDAR_MONTHS_PER_YEAR,
  MONASTERY_FEAST_ALE,
  MONASTERY_FEAST_FOOD,
  MONASTERY_FEAST_HONEY,
  MONASTERY_HOSPITALITY_BONUS_GOLD_PER_DAY,
  MONASTERY_HOSPITALITY_HONEY_PER_DAY,
  MONASTERY_HOSPITALITY_WINE_PER_DAY,
  MONASTERY_PILGRIMAGE_GOLD_PER_DAY,
} from '../generated/gameBalance.ts';
import type { BuildingState } from '../resources/types.ts';
import { MONTH_NAMES, type GameClock } from '../world/gameCalendar.ts';
import { edibleFoodStock, type FoodInventoryLike } from './foodInventory.ts';
import { monasteryGuesthouseMultiplier } from '../buildings/monasteryEstate.ts';

export const MONASTERY_FEASTS = [
  { name: 'Epiphany', month: 1, monthDay: 6 },
  { name: 'Saints Peter and Paul', month: 6, monthDay: 29 },
  { name: 'Assumption', month: 8, monthDay: 15 },
  { name: 'Exaltation of the Holy Cross', month: 9, monthDay: 14 },
  { name: 'Christmas', month: 12, monthDay: 25 },
] as const;

export const MONASTERY_FEASTS_PER_YEAR = MONASTERY_FEASTS.length;

export type MonasteryFeast = (typeof MONASTERY_FEASTS)[number];

export type NextMonasteryFeast = MonasteryFeast & {
  daysUntil: number;
};

export type MonasteryFeastReadiness = {
  ready: boolean;
  missingFood: number;
  missingHoney: number;
  missingDrink: number;
  drinkMix: string;
};

export type MonasteryFeastCommodity = 'food' | 'drink' | 'honey';

export type MonasteryHospitalityPlan = {
  enabled: boolean;
  honeyRunwayDays: number;
  drinkRunwayDays: number;
  supplyRatio: number;
  pilgrimageGoldPerDay: number;
  honeyPerDay: number;
  drinkPerDay: number;
  honeyPerYear: number;
  drinkPerYear: number;
  feastFoodPerYear: number;
  feastDrinkPerYear: number;
  prestigeMultiplier: number;
  commonTableMultiplier: number;
  mixedCellar: boolean;
  drinkMix: string;
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
    case 'drink':
      return MONASTERY_FEAST_ALE;
    case 'honey':
      return MONASTERY_FEAST_HONEY;
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

export function monasteryHospitalityRunwayDays(
  stock: number,
  dailyUse: number,
): number {
  return dailyUse <= 1e-9
    ? Number.POSITIVE_INFINITY
    : Math.max(0, stock) / dailyUse;
}

export function monasteryHospitalityPlan(
  monastery: Pick<BuildingState, 'honey' | 'ale' | 'cider' | 'wine' | 'monasteryExtensions' | 'monasteryServiceFunding'>,
  enabled: boolean,
): MonasteryHospitalityPlan {
  const honeyPerDay = enabled ? MONASTERY_HOSPITALITY_HONEY_PER_DAY : 0;
  const drinkPerDay = enabled ? MONASTERY_HOSPITALITY_WINE_PER_DAY : 0;
  const dailyHoney = monasteryFeastSurplus(
    monastery.honey,
    MONASTERY_FEAST_HONEY,
    enabled,
  );
  const drinks = [
    ['ale', finiteStock(monastery.ale)],
    ['cider', finiteStock(monastery.cider ?? 0)],
    ['wine', finiteStock(monastery.wine)],
  ] as const;
  const totalDrink = drinks.reduce((sum, [, stock]) => sum + stock, 0);
  const dailyDrink = monasteryFeastSurplus(totalDrink, MONASTERY_FEAST_ALE, enabled);
  const availableDrinks = drinks.filter(([, stock]) => stock > 1e-6);
  const drinkMix = availableDrinks.map(([label]) => label).join(' + ') || 'none';
  const total = Math.max(1e-9, totalDrink);
  const aleShare = drinks[0][1] / total;
  const wineShare = drinks[2][1] / total;
  const mixedCellar = availableDrinks.length >= 2;
  const prestigeMultiplier = 1 + 0.25 * wineShare + (mixedCellar ? 0.1 : 0);
  const commonTableMultiplier = 1 + 0.25 * aleShare;
  const supplyRatio = enabled
    ? (
        stockSupplyRatio(dailyHoney)
        + stockSupplyRatio(dailyDrink)
      ) * 0.5
    : 0;
  const daysPerYear = CALENDAR_DAYS_PER_MONTH * CALENDAR_MONTHS_PER_YEAR;
  return {
    enabled,
    honeyRunwayDays: monasteryHospitalityRunwayDays(dailyHoney, honeyPerDay),
    drinkRunwayDays: monasteryHospitalityRunwayDays(dailyDrink, drinkPerDay),
    supplyRatio,
    pilgrimageGoldPerDay:
      (
        MONASTERY_PILGRIMAGE_GOLD_PER_DAY
        + (enabled ? MONASTERY_HOSPITALITY_BONUS_GOLD_PER_DAY * supplyRatio * prestigeMultiplier : 0)
      ) * monasteryGuesthouseMultiplier(
        monastery.monasteryExtensions,
        monastery.monasteryServiceFunding,
      ),
    honeyPerDay,
    drinkPerDay,
    honeyPerYear:
      honeyPerDay * daysPerYear
      + (enabled ? MONASTERY_FEAST_HONEY * MONASTERY_FEASTS_PER_YEAR : 0),
    drinkPerYear:
      drinkPerDay * daysPerYear
      + (enabled ? MONASTERY_FEAST_ALE * MONASTERY_FEASTS_PER_YEAR : 0),
    feastFoodPerYear:
      enabled ? MONASTERY_FEAST_FOOD * MONASTERY_FEASTS_PER_YEAR : 0,
    feastDrinkPerYear:
      enabled ? MONASTERY_FEAST_ALE * MONASTERY_FEASTS_PER_YEAR : 0,
    prestigeMultiplier,
    commonTableMultiplier,
    mixedCellar,
    drinkMix,
  };
}

export function monasteryFeastReadiness(
  monastery: Pick<BuildingState, 'ale' | 'cider' | 'honey' | 'wine'> & FoodInventoryLike,
): MonasteryFeastReadiness {
  const mealStock = Math.max(0, edibleFoodStock(monastery) - finiteStock(monastery.honey));
  const missingFood = Math.max(0, MONASTERY_FEAST_FOOD - mealStock);
  const missingHoney = Math.max(0, MONASTERY_FEAST_HONEY - finiteStock(monastery.honey));
  const drinks = [
    ['ale', finiteStock(monastery.ale)],
    ['cider', finiteStock(monastery.cider ?? 0)],
    ['wine', finiteStock(monastery.wine)],
  ] as const;
  const drinkStock = drinks.reduce((sum, [, stock]) => sum + stock, 0);
  const missingDrink = Math.max(0, MONASTERY_FEAST_ALE - drinkStock);
  const drinkMix = drinks.filter(([, stock]) => stock > 1e-6).map(([label]) => label).join(' + ') || 'none';
  return {
    ready:
      missingFood <= 1e-9
      && missingHoney <= 1e-9
      && missingDrink <= 1e-9,
    missingFood,
    missingHoney,
    missingDrink,
    drinkMix,
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
    return `Ready · ${MONASTERY_FEAST_FOOD} food + ${MONASTERY_FEAST_HONEY} honey + ${MONASTERY_FEAST_ALE} any estate drink secured (${readiness.drinkMix})`;
  }
  const missing = [
    ['food', readiness.missingFood],
    ['honey', readiness.missingHoney],
    ['estate drink', readiness.missingDrink],
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
