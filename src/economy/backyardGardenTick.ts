import {
  BACKYARD_GARDEN_DEFINITIONS,
  FOOD_SALE_GOLD_PER_UNIT,
  SIM_TICK_SECONDS,
  type BackyardGardenKind,
} from '../generated/gameBalance.ts';
import type { EnvironmentState } from '../world/seasonPolicy.ts';
import { gardenMarketActivity } from './gardenMarketActivity.ts';

export type BackyardGardenTickEffects = {
  selfFood: number;
  marketFood: number;
  economicActivity: number;
};

export type BackyardGardenSeasonStatus = {
  multiplier: number;
  active: boolean;
  label: string;
};

/** Mirrors `server/src/backyard_garden_policy.rs`. */
export function backyardGardenSeasonalMultiplier(
  kind: BackyardGardenKind,
  month: number,
  environment: Pick<EnvironmentState, 'season' | 'weather'>,
): number {
  let base: number;
  switch (kind) {
    case 'apple_orchard':
    case 'cherry_orchard':
      base = month === 9 ? 12 : 0;
      break;
    case 'vegetable_garden':
    case 'herb_garden':
      base = environment.season === 'spring' || environment.season === 'summer'
        ? 1
        : environment.season === 'autumn'
          ? 0.55
          : 0;
      break;
    case 'flower_garden':
      base = environment.season === 'spring'
        ? 1.4
        : environment.season === 'summer'
          ? 1
          : environment.season === 'autumn'
            ? 0.35
            : 0;
      break;
    case 'hen_yard':
    case 'goat_pen':
      base = environment.season === 'winter' ? 0.75 : 1;
      break;
    case 'backyard_apiary':
      base = environment.season === 'spring'
        ? 0.8
        : environment.season === 'summer'
          ? 1
          : environment.season === 'autumn'
            ? 0.4
            : 0;
      break;
  }
  return environment.weather === 'drought'
    && kind !== 'hen_yard'
    && kind !== 'goat_pen'
    && kind !== 'apple_orchard'
    && kind !== 'cherry_orchard'
    ? base * 0.55
    : base;
}

export function backyardGardenSeasonStatus(
  kind: BackyardGardenKind,
  month: number,
  environment: Pick<EnvironmentState, 'season' | 'weather'>,
): BackyardGardenSeasonStatus {
  const multiplier = backyardGardenSeasonalMultiplier(
    kind,
    month,
    environment,
  );
  let label: string;
  if (kind === 'apple_orchard' || kind === 'cherry_orchard') {
    label = month === 9
      ? 'September harvest - 12x concentrated daily yield'
      : 'Dormant crop - harvest returns in September';
  } else if (kind === 'hen_yard') {
    label = environment.season === 'winter'
      ? 'Winter laying - 75% of warm-season output'
      : 'Year-round laying - full output';
  } else if (kind === 'goat_pen') {
    label = environment.season === 'winter'
      ? 'Winter fodder limits the alternating milk and meat yield to 75%'
      : 'Alternates milk and meat each day';
  } else if (kind === 'backyard_apiary') {
    label = multiplier <= 1e-9
      ? 'Hives are dormant for winter'
      : `Small-hive honey flow - ${Math.round(multiplier * 100)}% of summer output`;
  } else if (multiplier <= 1e-9) {
    label = 'Dormant for winter - output resumes in spring';
  } else if (environment.weather === 'drought') {
    label = `Drought stress - ${Math.round(multiplier * 100)}% of baseline output`;
  } else if (kind === 'flower_garden' && environment.season === 'spring') {
    label = 'Spring bloom - 140% market output';
  } else if (environment.season === 'autumn') {
    label = `Late season - ${Math.round(multiplier * 100)}% of baseline output`;
  } else {
    label = 'Growing season - full output';
  }
  return { multiplier, active: multiplier > 1e-9, label };
}

export function computeBackyardGardenTickEffects(
  kind: BackyardGardenKind,
  population: number,
  hasMarketAccess: boolean,
  seconds = SIM_TICK_SECONDS,
  seasonalMultiplier = 1,
  remedyUnitsSold = 0,
): BackyardGardenTickEffects {
  const def = BACKYARD_GARDEN_DEFINITIONS[kind];
  const pop = Math.max(0, population);
  const outputMultiplier = Number.isFinite(seasonalMultiplier)
    ? Math.max(0, seasonalMultiplier)
    : 0;

  let selfFood = 0;
  let marketFood = 0;
  if (def.foodPerPersonPerSec > 0) {
    const totalFood = def.foodPerPersonPerSec * pop * seconds * outputMultiplier;
    const selfShare = hasMarketAccess
      ? Math.max(0, Math.min(1, def.foodSelfShare))
      : 1;
    selfFood = totalFood * selfShare;
    marketFood = hasMarketAccess ? Math.max(0, totalFood - selfFood) : 0;
  }

  const economicActivity = hasMarketAccess
    ? gardenMarketActivity(def, pop, seconds) * outputMultiplier
      + gardenMarketActivity(
        def,
        0,
        0,
        kind === 'herb_garden' ? remedyUnitsSold : 0,
      )
    : 0;

  return { selfFood, marketFood, economicActivity };
}

export function foodSaleGoldFromSelfShare(
  foodPerPersonPerSec: number,
  foodSelfShare: number,
  population: number,
  seconds: number,
): number {
  const totalFood = foodPerPersonPerSec * population * seconds;
  const soldFood = totalFood * (1 - foodSelfShare);
  return soldFood * FOOD_SALE_GOLD_PER_UNIT;
}
