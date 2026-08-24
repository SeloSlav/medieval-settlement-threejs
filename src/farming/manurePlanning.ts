import {
  CATTLE_MANURE_COLLECTION_AUTUMN_MULTIPLIER,
  CATTLE_MANURE_COLLECTION_SPRING_MULTIPLIER,
  CATTLE_MANURE_COLLECTION_SUMMER_MULTIPLIER,
  CATTLE_MANURE_COLLECTION_WINTER_MULTIPLIER,
  CATTLE_MANURE_PER_SUPPLIED_HEAD_PER_CYCLE,
  FARM_MANURE_FERTILITY_BONUS,
  FARM_MANURE_PER_SQUARE_METER,
} from '../generated/gameBalance.ts';
import type { FarmFieldState } from '../resources/types.ts';
import { wholeResourceUnits } from '../resources/resourceUnits.ts';
import type { Season } from '../world/seasonPolicy.ts';

export type FarmsteadManurePlan = {
  activeFields: number;
  required: number;
  applied: number;
  remaining: number;
  onsite: number;
  inbound: number;
  covered: number;
  shortfall: number;
  coverageRatio: number;
};

export function fieldManureRequirement(
  field: Pick<FarmFieldState, 'area'>,
): number {
  const raw = Math.max(0, field.area) * Math.max(0, FARM_MANURE_PER_SQUARE_METER);
  return raw > 0 ? Math.ceil(raw - 1e-6) : 0;
}

export function fieldManureApplied(
  field: Pick<FarmFieldState, 'area' | 'manureApplied'>,
): number {
  return Math.min(
    fieldManureRequirement(field),
    wholeResourceUnits(field.manureApplied),
  );
}

export function fieldManureRemaining(
  field: Pick<FarmFieldState, 'area' | 'manureApplied'>,
): number {
  return Math.max(0, fieldManureRequirement(field) - fieldManureApplied(field));
}

export function fieldManureFertilityBonus(
  field: Pick<FarmFieldState, 'area' | 'manureApplied'>,
): number {
  const required = fieldManureRequirement(field);
  if (required <= 1e-9) return 0;
  return Math.max(0, FARM_MANURE_FERTILITY_BONUS)
    * Math.min(1, fieldManureApplied(field) / required);
}

export function buildFarmsteadManurePlan(
  fields: Iterable<FarmFieldState>,
  onsiteStock: number,
  inboundStock = 0,
): FarmsteadManurePlan {
  let activeFields = 0;
  let required = 0;
  let applied = 0;
  for (const field of fields) {
    if (field.priority <= 0) continue;
    activeFields += 1;
    required += fieldManureRequirement(field);
    applied += fieldManureApplied(field);
  }
  const remaining = Math.max(0, required - applied);
  const onsite = wholeResourceUnits(onsiteStock);
  const inbound = wholeResourceUnits(inboundStock);
  const covered = Math.min(required, applied + onsite + inbound);
  const shortfall = Math.max(0, required - covered);
  return {
    activeFields,
    required,
    applied,
    remaining,
    onsite,
    inbound,
    covered,
    shortfall,
    coverageRatio: required > 1e-9 ? covered / required : 1,
  };
}

export function cattleManureCollectionMultiplier(season: Season): number {
  switch (season) {
    case 'spring':
      return CATTLE_MANURE_COLLECTION_SPRING_MULTIPLIER;
    case 'summer':
      return CATTLE_MANURE_COLLECTION_SUMMER_MULTIPLIER;
    case 'autumn':
      return CATTLE_MANURE_COLLECTION_AUTUMN_MULTIPLIER;
    case 'winter':
      return CATTLE_MANURE_COLLECTION_WINTER_MULTIPLIER;
  }
}

export function cattleManurePerCycle(
  suppliedHealthyHeads: number,
  season: Season,
): number {
  return Math.max(0, suppliedHealthyHeads)
    * Math.max(0, CATTLE_MANURE_PER_SUPPLIED_HEAD_PER_CYCLE)
    * Math.max(0, cattleManureCollectionMultiplier(season));
}
