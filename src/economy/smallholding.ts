import { SMALLHOLDING_BACKYARD_PRODUCTIVITY_MULTIPLIER } from '../generated/gameBalance.ts';
import type { ResidenceState } from '../resources/types.ts';

type SmallholdingResidence = Pick<
  ResidenceState,
  'population' | 'sickPopulation' | 'smallholding'
>;

export function isSmallholding(
  residence: Pick<ResidenceState, 'smallholding'>,
): boolean {
  return residence.smallholding === true;
}

/** Healthy residents permanently committed to this household's backyard. */
export function smallholdingDedicatedResidents(
  residence: SmallholdingResidence,
): number {
  if (!isSmallholding(residence)) return 0;
  const population = Math.max(0, Math.floor(residence.population));
  const sick = Math.min(
    population,
    Math.max(0, Math.floor(residence.sickPopulation ?? 0)),
  );
  return population - sick;
}

export function smallholdingBackyardProductivityMultiplier(
  residence: Pick<ResidenceState, 'smallholding'>,
): number {
  return isSmallholding(residence)
    ? Math.max(1, SMALLHOLDING_BACKYARD_PRODUCTIVITY_MULTIPLIER)
    : 1;
}
