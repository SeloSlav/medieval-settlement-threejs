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
import {
  allocateBackyardFood,
  splitBackyardOrchardHarvest,
} from './backyardGardenTick.ts';
import { edibleFoodStock } from './foodInventory.ts';
import { taxedEconomicActivity } from './villageEconomy.ts';

export type BackyardGardenEconomyPerDay = {
  activity: number;
  assessedTax: number;
  tax: number;
  net: number;
  selfFood: number;
  marketFood: number;
};

export const BACKYARD_WORKDAY_SECONDS = CALENDAR_SECONDS_PER_DAY;

export function backyardGardenEconomyPerDay(
  kind: BackyardGardenKind,
  population: number,
  taxRate: number,
  options: {
    seasonalMultiplier?: number;
    hasMarketAccess?: boolean;
    taxCollectionMultiplier?: number;
    remedyUnitsSold?: number;
    tier?: number;
    currentFoodStock?: number;
  } = {},
): BackyardGardenEconomyPerDay {
  const def = BACKYARD_GARDEN_DEFINITIONS[kind];
  const requestedSeasonalMultiplier = options.seasonalMultiplier ?? 1;
  const seasonalMultiplier = Number.isFinite(requestedSeasonalMultiplier)
    ? Math.max(0, requestedSeasonalMultiplier)
    : 0;
  const marketLinked = options.hasMarketAccess ?? true;
  const grossHarvest = def.foodPerPersonPerSec
    * Math.max(0, population)
    * BACKYARD_WORKDAY_SECONDS
    * seasonalMultiplier;
  const jamTarget = def.jamPerPersonPerSec
    * Math.max(0, population)
    * BACKYARD_WORKDAY_SECONDS
    * seasonalMultiplier;
  const harvest = splitBackyardOrchardHarvest(grossHarvest, jamTarget);
  const totalFood = harvest.freshFruit + harvest.jam;
  const { selfFood, marketFood } = allocateBackyardFood(
    totalFood,
    marketLinked,
    options.tier ?? 1,
    population,
    options.currentFoodStock ?? 0,
  );
  const baseActivity = marketLinked
    ? gardenMarketActivity(
        marketFood,
        kind === 'herb_garden' ? options.remedyUnitsSold ?? 0 : 0,
      )
    : 0;
  const { adjusted, tax: assessedTax } = taxedEconomicActivity(
    baseActivity,
    taxRate,
  );
  const requestedCollectionMultiplier = options.taxCollectionMultiplier ?? 1;
  const collectionMultiplier = Number.isFinite(requestedCollectionMultiplier)
    ? Math.max(0, requestedCollectionMultiplier)
    : 0;
  const tax = assessedTax * Math.min(1, collectionMultiplier);
  return {
    activity: adjusted,
    assessedTax,
    tax,
    net: Math.max(0, adjusted - tax),
    selfFood,
    marketFood,
  };
}

export function backyardGardenActivityPerDay(
  kind: BackyardGardenKind,
  population: number,
  tier = 1,
  currentFoodStock = 0,
): number {
  const def = BACKYARD_GARDEN_DEFINITIONS[kind];
  const grossHarvest = def.foodPerPersonPerSec
    * Math.max(0, population)
    * BACKYARD_WORKDAY_SECONDS;
  const jamTarget = def.jamPerPersonPerSec
    * Math.max(0, population)
    * BACKYARD_WORKDAY_SECONDS;
  const harvest = splitBackyardOrchardHarvest(grossHarvest, jamTarget);
  const totalFood = harvest.freshFruit + harvest.jam;
  return gardenMarketActivity(
    allocateBackyardFood(totalFood, true, tier, population, currentFoodStock).marketFood,
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
    total += backyardGardenActivityPerDay(
      garden.kind,
      residence.population,
      residence.tier,
      edibleFoodStock(residence),
    );
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
      {
        tier: residence.tier,
        currentFoodStock: edibleFoodStock(residence),
      },
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
