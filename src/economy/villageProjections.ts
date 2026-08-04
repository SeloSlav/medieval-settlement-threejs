import {
  BACKYARD_GARDEN_DEFINITIONS,
  BACKYARD_GARDEN_KINDS,
  CALENDAR_HOURS_PER_DAY,
  CALENDAR_SECONDS_PER_DAY,
  CALENDAR_WORK_END_HOUR,
  CALENDAR_WORK_START_HOUR,
  type BackyardGardenKind,
} from '../generated/gameBalance.ts';
import type { BuildingState, ResidenceState } from '../resources/types.ts';
import { totalChapelCofferGold } from '../resources/chapelCoffer.ts';
import { payableChapelTithePerDay } from './householdWealth.ts';
import { chapelTitheMultiplier } from './chapelUpgrade.ts';
import { gardenMarketActivity } from './gardenMarketActivity.ts';
import { taxedEconomicActivity } from './villageEconomy.ts';
import { residenceServiceState } from './residenceSatisfaction.ts';

export type BackyardGardenEconomyPerDay = {
  activity: number;
  assessedTax: number;
  tax: number;
  net: number;
  selfFood: number;
  marketFood: number;
};

export const BACKYARD_WORKDAY_SECONDS = CALENDAR_SECONDS_PER_DAY
  * (CALENDAR_WORK_END_HOUR - CALENDAR_WORK_START_HOUR)
  / CALENDAR_HOURS_PER_DAY;

export function backyardGardenEconomyPerDay(
  kind: BackyardGardenKind,
  population: number,
  taxRate: number,
  options: {
    seasonalMultiplier?: number;
    hasMarketAccess?: boolean;
    taxCollectionMultiplier?: number;
    serviceMultiplier?: number;
  } = {},
): BackyardGardenEconomyPerDay {
  const def = BACKYARD_GARDEN_DEFINITIONS[kind];
  const requestedSeasonalMultiplier = options.seasonalMultiplier ?? 1;
  const seasonalMultiplier = Number.isFinite(requestedSeasonalMultiplier)
    ? Math.max(0, requestedSeasonalMultiplier)
    : 0;
  const marketLinked = options.hasMarketAccess ?? true;
  const baseActivity = marketLinked
    ? gardenMarketActivity(def, population, BACKYARD_WORKDAY_SECONDS)
      * seasonalMultiplier
    : 0;
  const requestedServiceMultiplier = options.serviceMultiplier ?? 1;
  const serviceMultiplier = Number.isFinite(requestedServiceMultiplier)
    ? Math.max(0, Math.min(1, requestedServiceMultiplier))
    : 1;
  const { adjusted, tax: assessedTax } = taxedEconomicActivity(
    baseActivity * serviceMultiplier,
    taxRate,
  );
  const requestedCollectionMultiplier = options.taxCollectionMultiplier ?? 1;
  const collectionMultiplier = Number.isFinite(requestedCollectionMultiplier)
    ? Math.max(0, requestedCollectionMultiplier)
    : 0;
  const tax = assessedTax * Math.min(1, collectionMultiplier);
  const totalFood = def.foodPerPersonPerSec
    * Math.max(0, population)
    * BACKYARD_WORKDAY_SECONDS
    * seasonalMultiplier;
  // Without a staffed food stall the household keeps its full edible crop.
  // With one, the configured share stays in its pantry and the remainder is
  // offered to other households through the physical Marketplace pool.
  const selfShare = marketLinked
    ? Math.max(0, Math.min(1, def.foodSelfShare))
    : 1;
  const selfFood = totalFood * selfShare;
  const marketFood = marketLinked ? Math.max(0, totalFood - selfFood) : 0;
  return {
    activity: adjusted,
    assessedTax,
    tax,
    net: Math.max(0, adjusted - tax),
    selfFood,
    marketFood,
  };
}

export function backyardGardenActivityPerDay(kind: BackyardGardenKind, population: number): number {
  return gardenMarketActivity(
    BACKYARD_GARDEN_DEFINITIONS[kind],
    population,
    BACKYARD_WORKDAY_SECONDS,
  );
}

export function backyardGardenTaxPerDay(
  kind: BackyardGardenKind,
  population: number,
  taxRate: number,
): number {
  return backyardGardenEconomyPerDay(kind, population, taxRate).tax;
}

export function backyardGardenNetWealthPerDay(
  kind: BackyardGardenKind,
  population: number,
  taxRate: number,
): number {
  return backyardGardenEconomyPerDay(kind, population, taxRate).net;
}

export function estimateVillageGdpPerDay(
  gardens: Iterable<{ kind: BackyardGardenKind; residenceId: string }>,
  getResidence: (id: string) => ResidenceState | undefined,
): number {
  let total = 0;
  for (const garden of gardens) {
    const residence = getResidence(garden.residenceId);
    if (!residence || residence.population <= 0) continue;
    total += backyardGardenActivityPerDay(garden.kind, residence.population)
      * residenceServiceState(residence).economicMultiplier;
  }
  return total;
}

export function estimateVillageTaxPerDay(
  gardens: Iterable<{ kind: BackyardGardenKind; residenceId: string }>,
  getResidence: (id: string) => ResidenceState | undefined,
  taxRate: number,
): number {
  const gdp = estimateVillageGdpPerDay(gardens, getResidence);
  return taxedEconomicActivity(gdp, taxRate).tax;
}

export type HouseholdWealthSummary = {
  totalWealth: number;
  occupiedHomes: number;
  homesWithSavings: number;
};

export function summarizeHouseholdWealth(residences: Iterable<ResidenceState>): HouseholdWealthSummary {
  let totalWealth = 0;
  let occupiedHomes = 0;
  let homesWithSavings = 0;

  for (const residence of residences) {
    if (residence.population <= 0) {
      continue;
    }

    occupiedHomes += 1;
    totalWealth += residence.householdWealth;
    if (residence.householdWealth > 0.05) {
      homesWithSavings += 1;
    }
  }

  return { totalWealth, occupiedHomes, homesWithSavings };
}

export function estimateVillageHouseholdSavingsPerDay(
  gardens: Iterable<{ kind: BackyardGardenKind; residenceId: string }>,
  getResidence: (id: string) => ResidenceState | undefined,
  taxRate: number,
  isMarketplaceLinked: (residence: ResidenceState) => boolean,
): number {
  let total = 0;

  for (const garden of gardens) {
    const residence = getResidence(garden.residenceId);
    if (!residence || residence.population <= 0) {
      continue;
    }
    if (!isMarketplaceLinked(residence)) {
      continue;
    }

    total += backyardGardenEconomyPerDay(
      garden.kind,
      residence.population,
      taxRate,
      { serviceMultiplier: residenceServiceState(residence).economicMultiplier },
    ).net;
  }

  return total;
}

export function estimateVillageChapelTithePerDay(
  residences: Iterable<ResidenceState>,
  getServingChapel: (residence: ResidenceState) => BuildingState | null,
  sabbathObservance = false,
): number {
  let total = 0;
  for (const residence of residences) {
    if (residence.abandoned || residence.population <= 0) {
      continue;
    }

    const chapel = getServingChapel(residence);
    if (!chapel || chapel.assignedLabor <= 0) {
      continue;
    }

    total += payableChapelTithePerDay(
      residence.population,
      chapel.assignedLabor,
      residence.householdWealth,
      sabbathObservance,
      false,
      chapelTitheMultiplier(chapel.chapelTier),
    );
  }

  return total;
}

export { BACKYARD_GARDEN_KINDS, totalChapelCofferGold };
