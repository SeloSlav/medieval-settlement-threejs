import {
  APIARY_FOOD_PER_CYCLE,
  APIARY_HONEY_PER_CYCLE,
  APIARY_SEASON_END_MONTH,
  APIARY_SEASON_START_MONTH,
  BUILDING_STORAGE_CAPS,
  MARKET_SPECIALTY_EXPORT_PER_BROKER_PER_SECOND,
  SPECIALTY_EXPORT_GOLD_PER_ALE,
  SPECIALTY_EXPORT_GOLD_PER_CLOTH,
  SPECIALTY_EXPORT_GOLD_PER_HONEY,
  SPECIALTY_EXPORT_GOLD_PER_WINE,
  VINEYARD_FOOD_PER_CYCLE,
  VINEYARD_HARVEST_END_MONTH,
  VINEYARD_HARVEST_START_MONTH,
  VINEYARD_WINE_PER_CYCLE,
} from '../generated/gameBalance.ts';
import type { BuildingState } from '../resources/types.ts';
import { MONTH_NAMES } from '../world/gameCalendar.ts';

export const MARKETPLACE_SPECIALTY_EXPORT_POLICIES = [
  {
    value: 0,
    label: 'Any rate',
    minRate: 0,
    hint: 'Keep brokers moving even when regional buyers are well supplied.',
  },
  {
    value: 1,
    label: 'Fair 98%+',
    minRate: 0.98,
    hint: 'Hold stock during weak demand, then resume near the normal rate.',
  },
  {
    value: 2,
    label: 'Favorable 105%+',
    minRate: 1.05,
    hint: 'Wait for strong demand, accepting storage backpressure in exchange for better prices.',
  },
] as const;

export type MarketplaceSpecialtyExportPolicy =
  (typeof MARKETPLACE_SPECIALTY_EXPORT_POLICIES)[number];

export function marketplaceSpecialtyExportPolicy(
  value: number | undefined,
): MarketplaceSpecialtyExportPolicy {
  return MARKETPLACE_SPECIALTY_EXPORT_POLICIES.find((policy) => policy.value === value)
    ?? MARKETPLACE_SPECIALTY_EXPORT_POLICIES[0];
}

export function specialtyExportPolicyAllows(
  policyValue: number | undefined,
  marketRate: number,
): boolean {
  const policy = marketplaceSpecialtyExportPolicy(policyValue);
  return Number.isFinite(marketRate) && marketRate + 1e-9 >= policy.minRate;
}

export function monthInWindow(month: number, start: number, end: number): boolean {
  return start <= end
    ? month >= start && month <= end
    : month >= start || month <= end;
}

export function apiaryIsActive(month: number): boolean {
  return monthInWindow(month, APIARY_SEASON_START_MONTH, APIARY_SEASON_END_MONTH);
}

export function vineyardIsHarvesting(month: number): boolean {
  return monthInWindow(month, VINEYARD_HARVEST_START_MONTH, VINEYARD_HARVEST_END_MONTH);
}

export function specialtySeasonStatus(
  kind: BuildingState['kind'],
  month: number,
): { active: boolean; label: string } | null {
  if (kind === 'apiary') {
    return apiaryIsActive(month)
      ? { active: true, label: 'Bee forage season - April-September' }
      : { active: false, label: 'Hives dormant - production resumes in April' };
  }
  if (kind === 'vineyard') {
    return vineyardIsHarvesting(month)
      ? { active: true, label: 'Grape harvest - September-October' }
      : {
          active: false,
          label: `Vines tending - next harvest ${MONTH_NAMES[VINEYARD_HARVEST_START_MONTH - 1]}`,
        };
  }
  return null;
}

export type SeasonalProducerOutputBlocker = {
  commodity: 'food' | 'honey' | 'wine';
  label: string;
  stock: number;
  capacity: number;
  batch: number;
  room: number;
  missingRoom: number;
};

export function seasonalProducerOutputBlocker(
  building: BuildingState,
): SeasonalProducerOutputBlocker | null {
  const outputs = building.kind === 'apiary'
    ? [
        ['honey', 'Honey', building.honey, BUILDING_STORAGE_CAPS.apiary.honey, APIARY_HONEY_PER_CYCLE],
        ['food', 'Food', building.food, BUILDING_STORAGE_CAPS.apiary.food, APIARY_FOOD_PER_CYCLE],
      ] as const
    : building.kind === 'vineyard'
      ? [
          ['wine', 'Wine', building.wine, BUILDING_STORAGE_CAPS.vineyard.wine, VINEYARD_WINE_PER_CYCLE],
          ['food', 'Food', building.food, BUILDING_STORAGE_CAPS.vineyard.food, VINEYARD_FOOD_PER_CYCLE],
        ] as const
      : null;
  if (!outputs) return null;

  for (const [commodity, label, rawStock, rawCapacity, rawBatch] of outputs) {
    const stock = finiteNonnegative(rawStock);
    const capacity = finiteNonnegative(rawCapacity);
    const batch = finiteNonnegative(rawBatch);
    const room = Math.max(0, capacity - stock);
    if (room + 1e-6 < batch) {
      return {
        commodity,
        label,
        stock,
        capacity,
        batch,
        room,
        missingRoom: Math.max(0, batch - room),
      };
    }
  }
  return null;
}

export function marketplaceSpecialtyExportWorkers(building: BuildingState): number {
  return Math.max(
    0,
    Math.floor(building.assignedLabor) - (building.actionCooldown > 1e-6 ? 1 : 0),
  );
}

export function marketplaceSpecialtyExportRate(building: BuildingState): number {
  return marketplaceSpecialtyExportWorkers(building)
    * MARKET_SPECIALTY_EXPORT_PER_BROKER_PER_SECOND;
}

export type MarketplaceSpecialtyQueue = {
  units: number;
  goldValue: number;
  exportWorkers: number;
  unitsPerSecond: number;
  clearSeconds: number | null;
};

export function marketplaceSpecialtyQueue(
  building: BuildingState,
  marketRate = 1,
): MarketplaceSpecialtyQueue {
  const units = building.ale + building.honey + building.wine + (building.cloth ?? 0);
  const unitsPerSecond = marketplaceSpecialtyExportRate(building);
  const boundedRate = Number.isFinite(marketRate) ? Math.max(0, marketRate) : 0;
  return {
    units,
    goldValue:
      (
        building.ale * SPECIALTY_EXPORT_GOLD_PER_ALE
        + building.honey * SPECIALTY_EXPORT_GOLD_PER_HONEY
        + building.wine * SPECIALTY_EXPORT_GOLD_PER_WINE
        + (building.cloth ?? 0) * SPECIALTY_EXPORT_GOLD_PER_CLOTH
      ) * boundedRate,
    exportWorkers: marketplaceSpecialtyExportWorkers(building),
    unitsPerSecond,
    clearSeconds: units > 1e-6 && unitsPerSecond > 1e-6 ? units / unitsPerSecond : null,
  };
}

export type MarketplaceSpecialtyExportPlan = {
  policy: MarketplaceSpecialtyExportPolicy;
  marketRate: number;
  saleAllowed: boolean;
  rateShortfall: number;
};

export function marketplaceSpecialtyExportPlan(
  building: Pick<BuildingState, 'marketplaceSpecialtyExportPolicy'>,
  marketRate: number,
): MarketplaceSpecialtyExportPlan {
  const policy = marketplaceSpecialtyExportPolicy(building.marketplaceSpecialtyExportPolicy);
  return {
    policy,
    marketRate,
    saleAllowed: specialtyExportPolicyAllows(policy.value, marketRate),
    rateShortfall: Math.max(0, policy.minRate - marketRate),
  };
}

function finiteNonnegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
