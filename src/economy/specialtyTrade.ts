import {
  APIARY_HONEY_PER_CYCLE,
  APIARY_BALANCED_HONEY_RESERVE,
  APIARY_BALANCED_YIELD_MULTIPLIER,
  APIARY_CONSERVATIVE_HONEY_RESERVE,
  APIARY_CONSERVATIVE_YIELD_MULTIPLIER,
  APIARY_EXTRACTIVE_HONEY_RESERVE,
  APIARY_EXTRACTIVE_YIELD_MULTIPLIER,
  APIARY_SEASON_END_MONTH,
  APIARY_SEASON_START_MONTH,
  BUILDING_STORAGE_CAPS,
  MARKET_SPECIALTY_EXPORT_PER_BROKER_PER_SECOND,
  SPECIALTY_EXPORT_GOLD_PER_ALE,
  SPECIALTY_EXPORT_GOLD_PER_CHEESE,
  SPECIALTY_EXPORT_GOLD_PER_CLOTH,
  SPECIALTY_EXPORT_GOLD_PER_HONEY,
  SPECIALTY_EXPORT_GOLD_PER_POTTERY,
  SPECIALTY_EXPORT_GOLD_PER_WINE,
  VINEYARD_GRAPES_PER_HARVEST_CYCLE,
  VINEYARD_BALANCED_GRAPE_RESERVE,
  VINEYARD_WINE_FIRST_GRAPE_RESERVE,
  VINEYARD_HARVEST_END_MONTH,
  VINEYARD_HARVEST_START_MONTH,
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

export type SpecialtyMarketFamily = 'drink' | 'provision' | 'wares';

export const SPECIALTY_MARKET_FAMILIES = [
  { id: 0, kind: 'drink', label: 'Drinks', goods: 'ale and wine' },
  { id: 1, kind: 'provision', label: 'Provisions', goods: 'honey and cheese' },
  { id: 2, kind: 'wares', label: 'Wares', goods: 'cloth and pottery' },
] as const;

export const APIARY_HARVEST_POLICIES = [
  {
    value: 0,
    label: 'Conservative',
    reserve: APIARY_CONSERVATIVE_HONEY_RESERVE,
    yieldMultiplier: APIARY_CONSERVATIVE_YIELD_MULTIPLIER,
    hint: 'Protect winter stores and colony health at the cost of current harvest.',
  },
  {
    value: 1,
    label: 'Balanced',
    reserve: APIARY_BALANCED_HONEY_RESERVE,
    yieldMultiplier: APIARY_BALANCED_YIELD_MULTIPLIER,
    hint: 'Keep a normal winter reserve while taking a full seasonal harvest.',
  },
  {
    value: 2,
    label: 'Extractive',
    reserve: APIARY_EXTRACTIVE_HONEY_RESERVE,
    yieldMultiplier: APIARY_EXTRACTIVE_YIELD_MULTIPLIER,
    hint: 'Take more honey now; a weak winter store can damage next year’s colony.',
  },
] as const;

export const VINEYARD_PRODUCTION_POLICIES = [
  {
    value: 0,
    label: 'Table grapes',
    reserve: Number.POSITIVE_INFINITY,
    hint: 'Keep every grape edible; do not begin new fermentation batches.',
  },
  {
    value: 1,
    label: 'Balanced',
    reserve: VINEYARD_BALANCED_GRAPE_RESERVE,
    hint: 'Protect a table-grape reserve, then ferment the surplus.',
  },
  {
    value: 2,
    label: 'Wine first',
    reserve: VINEYARD_WINE_FIRST_GRAPE_RESERVE,
    hint: 'Protect only a small table reserve and send most grapes to the cellar.',
  },
] as const;

export function apiaryHarvestPolicy(value: number | undefined) {
  return APIARY_HARVEST_POLICIES.find((policy) => policy.value === value)
    ?? APIARY_HARVEST_POLICIES[1];
}

export function vineyardProductionPolicy(value: number | undefined) {
  return VINEYARD_PRODUCTION_POLICIES.find((policy) => policy.value === value)
    ?? VINEYARD_PRODUCTION_POLICIES[1];
}

export type SpecialtyFamilyRates = Record<SpecialtyMarketFamily, number>;

export function specialtyFamilyForCommodity(
  commodity: 'ale' | 'wine' | 'honey' | 'cheese' | 'cloth' | 'pottery',
): SpecialtyMarketFamily {
  if (commodity === 'ale' || commodity === 'wine') return 'drink';
  if (commodity === 'honey' || commodity === 'cheese') return 'provision';
  return 'wares';
}

export function resolvedSpecialtyFamilyPolicy(
  familyPolicy: number | undefined,
  legacyPolicy: number | undefined,
): number {
  return familyPolicy === 255 || familyPolicy == null
    ? marketplaceSpecialtyExportPolicy(legacyPolicy).value
    : marketplaceSpecialtyExportPolicy(familyPolicy).value;
}

export type SeasonalProducerOutputBlocker = {
  commodity: 'honey' | 'grapes';
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
      ] as const
    : building.kind === 'vineyard'
      ? [
          ['grapes', 'Grapes', building.grapes ?? 0, BUILDING_STORAGE_CAPS.vineyard.food, VINEYARD_GRAPES_PER_HARVEST_CYCLE],
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
  aleUnits: number;
  honeyUnits: number;
  wineUnits: number;
  clothUnits: number;
  cheeseUnits: number;
  potteryUnits: number;
  units: number;
  goldValue: number;
  exportWorkers: number;
  unitsPerSecond: number;
  clearSeconds: number | null;
};

export function marketplaceSpecialtyQueue(
  building: BuildingState,
  marketRate: number | SpecialtyFamilyRates = 1,
): MarketplaceSpecialtyQueue {
  const units = building.ale + building.honey + building.wine + (building.cloth ?? 0)
    + (building.cheese ?? 0) + (building.pottery ?? 0);
  const unitsPerSecond = marketplaceSpecialtyExportRate(building);
  const rateFor = (family: SpecialtyMarketFamily): number => {
    const raw = typeof marketRate === 'number' ? marketRate : marketRate[family];
    return Number.isFinite(raw) ? Math.max(0, raw) : 0;
  };
  return {
    aleUnits: building.ale,
    honeyUnits: building.honey,
    wineUnits: building.wine,
    clothUnits: building.cloth ?? 0,
    cheeseUnits: building.cheese ?? 0,
    potteryUnits: building.pottery ?? 0,
    units,
    goldValue:
      (building.ale * SPECIALTY_EXPORT_GOLD_PER_ALE
        + building.wine * SPECIALTY_EXPORT_GOLD_PER_WINE) * rateFor('drink')
      + (building.honey * SPECIALTY_EXPORT_GOLD_PER_HONEY
        + (building.cheese ?? 0) * SPECIALTY_EXPORT_GOLD_PER_CHEESE) * rateFor('provision')
      + ((building.cloth ?? 0) * SPECIALTY_EXPORT_GOLD_PER_CLOTH
        + (building.pottery ?? 0) * SPECIALTY_EXPORT_GOLD_PER_POTTERY) * rateFor('wares'),
    exportWorkers: marketplaceSpecialtyExportWorkers(building),
    unitsPerSecond,
    clearSeconds: units > 1e-6 && unitsPerSecond > 1e-6 ? units / unitsPerSecond : null,
  };
}

export function formatMarketplaceSpecialtyQueue(
  queue: Pick<
    MarketplaceSpecialtyQueue,
    'aleUnits' | 'honeyUnits' | 'wineUnits' | 'clothUnits' | 'cheeseUnits' | 'potteryUnits' | 'units' | 'goldValue'
  >,
): string {
  const stored = [
    ['ale', queue.aleUnits],
    ['honey', queue.honeyUnits],
    ['wine', queue.wineUnits],
    ['cloth', queue.clothUnits],
    ['cheese', queue.cheeseUnits],
    ['pottery', queue.potteryUnits],
  ] as const;
  const readable = stored
    .filter(([, units]) => units > 1e-6)
    .map(([label, units]) => `${units.toFixed(1)} ${label}`);
  if (readable.length === 0) {
    return 'Empty - awaiting ale, honey, wine, cloth, cheese, or pottery carts';
  }
  return `${readable.join(' · ')} · ${queue.units.toFixed(1)} total · about ${queue.goldValue.toFixed(1)} gold`;
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
