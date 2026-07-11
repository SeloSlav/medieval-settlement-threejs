import {
  BACKYARD_GARDEN_DEFINITIONS,
  BACKYARD_GARDEN_KINDS,
  type BackyardGardenKind,
} from '../generated/gameBalance.ts';
import type { BuildingState, ResidenceState } from '../resources/types.ts';
import { totalChapelCofferGold } from '../resources/chapelCoffer.ts';
import { payableChapelTithePerDay } from './householdWealth.ts';
import { gardenMarketActivity, SECONDS_PER_DAY } from './gardenMarketActivity.ts';
import { taxedEconomicActivity } from './villageEconomy.ts';

export type BackyardGardenEconomyPerDay = {
  activity: number;
  tax: number;
  net: number;
};

export function backyardGardenEconomyPerDay(
  kind: BackyardGardenKind,
  population: number,
  taxRate: number,
): BackyardGardenEconomyPerDay {
  const activity = gardenMarketActivity(BACKYARD_GARDEN_DEFINITIONS[kind], population, SECONDS_PER_DAY);
  const { adjusted, tax } = taxedEconomicActivity(activity, taxRate);
  return {
    activity: adjusted,
    tax,
    net: Math.max(0, adjusted - tax),
  };
}

export function backyardGardenActivityPerDay(kind: BackyardGardenKind, population: number): number {
  return gardenMarketActivity(BACKYARD_GARDEN_DEFINITIONS[kind], population, SECONDS_PER_DAY);
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
  getResidence: (id: string) => { abandoned: boolean; population: number } | undefined,
): number {
  let total = 0;
  for (const garden of gardens) {
    const residence = getResidence(garden.residenceId);
    if (!residence || residence.abandoned || residence.population <= 0) continue;
    total += backyardGardenActivityPerDay(garden.kind, residence.population);
  }
  return total;
}

export function estimateVillageTaxPerDay(
  gardens: Iterable<{ kind: BackyardGardenKind; residenceId: string }>,
  getResidence: (id: string) => { abandoned: boolean; population: number } | undefined,
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
    if (residence.abandoned || residence.population <= 0) {
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
    if (!residence || residence.abandoned || residence.population <= 0) {
      continue;
    }
    if (!isMarketplaceLinked(residence)) {
      continue;
    }

    total += backyardGardenNetWealthPerDay(garden.kind, residence.population, taxRate);
  }

  return total;
}

export function estimateVillageChapelTithePerDay(
  residences: Iterable<ResidenceState>,
  getServingChapel: (residence: ResidenceState) => BuildingState | null,
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
    );
  }

  return total;
}

export { BACKYARD_GARDEN_KINDS, totalChapelCofferGold };
