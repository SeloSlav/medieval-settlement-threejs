import {
  BACKYARD_GARDEN_DEFINITIONS,
  BACKYARD_FOOD_RESERVE_TIER1_DAYS,
  BACKYARD_FOOD_RESERVE_TIER2_DAYS,
  BACKYARD_FOOD_RESERVE_TIER3_DAYS,
  RESIDENCE_FOOD_CAPACITY,
  RESIDENCE_PRESERVED_FOOD_CAPACITY,
  SIM_TICK_SECONDS,
  type BackyardGardenKind,
} from '../generated/gameBalance.ts';
import type { EnvironmentState } from '../world/seasonPolicy.ts';
import { householdFoodPerDay } from './foodInventory.ts';
import { gardenMarketActivity } from './gardenMarketActivity.ts';

export type BackyardGardenTickEffects = {
  selfFood: number;
  marketFood: number;
  economicActivity: number;
};

export type BackyardGardenSeasonStatus = {
  multiplier: number;
  active: boolean;
  growing: boolean;
  harvestable: boolean;
  phase: BackyardGardenPhase;
  produceVisibility: 'none' | 'ripening' | 'harvest';
  label: string;
  harvestWindow: string;
};

export type BackyardGardenPhase =
  | 'dormant'
  | 'establishing'
  | 'flowering'
  | 'ripening'
  | 'harvest'
  | 'post_harvest'
  | 'year_round';

export type BackyardGardenPhenology = Omit<
  BackyardGardenSeasonStatus,
  'multiplier' | 'active'
> & {
  baseMultiplier: number;
};

export type BackyardGardenMarketChannel = 'food' | 'goods' | null;

export type BackyardFoodAllocation = {
  selfFood: number;
  marketFood: number;
};

export function backyardFoodReserveDays(tier: number): number {
  if (tier >= 3) return BACKYARD_FOOD_RESERVE_TIER3_DAYS;
  if (tier >= 2) return BACKYARD_FOOD_RESERVE_TIER2_DAYS;
  return BACKYARD_FOOD_RESERVE_TIER1_DAYS;
}

export function backyardFoodReserveTarget(tier: number, population: number): number {
  const requested = householdFoodPerDay(population)
    * backyardFoodReserveDays(tier);
  return Math.min(
    RESIDENCE_FOOD_CAPACITY + RESIDENCE_PRESERVED_FOOD_CAPACITY,
    requested,
  );
}

export function allocateBackyardFood(
  totalFood: number,
  hasMarketAccess: boolean,
  tier: number,
  population: number,
  currentFoodStock: number,
): BackyardFoodAllocation {
  const total = Number.isFinite(totalFood) ? Math.max(0, totalFood) : 0;
  if (!hasMarketAccess) return { selfFood: total, marketFood: 0 };
  const reserveGap = Math.max(
    0,
    backyardFoodReserveTarget(tier, population) - Math.max(0, currentFoodStock),
  );
  const selfFood = Math.min(total, reserveGap);
  return { selfFood, marketFood: Math.max(0, total - selfFood) };
}

/**
 * Backyard production reuses an already staffed Marketplace group. It never
 * reserves another table or depot worker of its own. Flowers have no saleable
 * stock, so they do not require a market channel at all.
 */
export function backyardGardenMarketChannel(
  kind: BackyardGardenKind,
): BackyardGardenMarketChannel {
  if (kind === 'flower_garden') return null;
  if (kind === 'herb_garden') return 'goods';
  return 'food';
}

function calendarMonth(month: number): number {
  if (!Number.isFinite(month)) return 1;
  return Math.min(12, Math.max(1, Math.floor(month)));
}

/** Calendar-owned growth and harvest phases shared by UI and garden visuals. */
export function backyardGardenPhenology(
  kind: BackyardGardenKind,
  month: number,
): BackyardGardenPhenology {
  const currentMonth = calendarMonth(month);
  const winter = currentMonth === 12 || currentMonth <= 2;

  switch (kind) {
    case 'apple_orchard':
    case 'cherry_orchard':
      if (winter || currentMonth === 11) {
        return {
          baseMultiplier: 0,
          growing: false,
          harvestable: false,
          phase: 'dormant',
          produceVisibility: 'none',
          label: 'Dormant wood — no fruit on the trees or in the harvest basket',
          harvestWindow: 'Fruit ripens in August; the household harvests in September',
        };
      }
      if (currentMonth <= 4) {
        return {
          baseMultiplier: 0,
          growing: true,
          harvestable: false,
          phase: 'flowering',
          produceVisibility: 'none',
          label: 'Spring blossom — pollination and fruit set, not harvestable yet',
          harvestWindow: 'Fruit ripens in August; the household harvests in September',
        };
      }
      if (currentMonth <= 7) {
        return {
          baseMultiplier: 0,
          growing: true,
          harvestable: false,
          phase: 'establishing',
          produceVisibility: 'none',
          label: 'Fruit setting — the annual crop is still developing',
          harvestWindow: 'Fruit ripens in August; the household harvests in September',
        };
      }
      if (currentMonth === 8) {
        return {
          baseMultiplier: 0,
          growing: true,
          harvestable: false,
          phase: 'ripening',
          produceVisibility: 'ripening',
          label: 'Fruit ripening on the trees — basket remains empty',
          harvestWindow: 'The household harvests the concentrated annual crop in September',
        };
      }
      if (currentMonth === 9) {
        return {
          baseMultiplier: 12,
          growing: false,
          harvestable: true,
          phase: 'harvest',
          produceVisibility: 'harvest',
          label: 'September harvest — concentrated annual crop',
          harvestWindow: 'Harvestable now; fruit and filled baskets clear after September',
        };
      }
      return {
        baseMultiplier: 0,
        growing: false,
        harvestable: false,
        phase: 'post_harvest',
        produceVisibility: 'none',
        label: 'Post-harvest — fruit and filled baskets have been cleared',
        harvestWindow: 'The next crop begins with spring blossom and returns next September',
      };

    case 'vegetable_garden':
      if (winter) {
        return {
          baseMultiplier: 0,
          growing: false,
          harvestable: false,
          phase: 'dormant',
          produceVisibility: 'none',
          label: 'Winter beds — cleared or dormant with no routine harvest',
          harvestWindow: 'Mixed sowings begin in March; harvests run from April into November',
        };
      }
      if (currentMonth === 3) {
        return {
          baseMultiplier: 0,
          growing: true,
          harvestable: false,
          phase: 'establishing',
          produceVisibility: 'none',
          label: 'Sowing and seedlings — mixed beds are not harvestable yet',
          harvestWindow: 'Early mixed vegetables begin in April',
        };
      }
      return {
        baseMultiplier: currentMonth <= 5
          ? 0.7
          : currentMonth <= 8
            ? 1
            : currentMonth <= 10
              ? 0.55
              : 0.25,
        growing: true,
        harvestable: true,
        phase: 'harvest',
        produceVisibility: 'harvest',
        label: currentMonth <= 5
          ? 'Early mixed harvest — only some rows are mature'
          : currentMonth <= 8
            ? 'Main mixed harvest — staggered rows are in production'
            : currentMonth <= 10
              ? 'Late mixed harvest — fewer rows remain productive'
              : 'Final hardy harvest — most beds are being cleared',
        harvestWindow: 'Different vegetables mature in staggered windows from April into November',
      };

    case 'herb_garden':
      if (winter) {
        return {
          baseMultiplier: 0,
          growing: false,
          harvestable: false,
          phase: 'dormant',
          produceVisibility: 'none',
          label: 'Winter rest — hardy rosemary and sage remain, but routine cutting stops',
          harvestWindow: 'Fresh cutting resumes in April; stored remedies remain usable indoors',
        };
      }
      if (currentMonth === 3) {
        return {
          baseMultiplier: 0,
          growing: true,
          harvestable: false,
          phase: 'establishing',
          produceVisibility: 'none',
          label: 'Perennial regrowth and spring sowing — not ready for routine cutting',
          harvestWindow: 'Mixed herb cutting begins in April',
        };
      }
      return {
        baseMultiplier: currentMonth <= 5
          ? 0.75
          : currentMonth <= 8
            ? 1
            : currentMonth <= 10
              ? 0.55
              : 0.2,
        growing: true,
        harvestable: true,
        phase: 'harvest',
        produceVisibility: 'harvest',
        label: currentMonth <= 5
          ? 'Spring herb cutting — perennial and biennial plants lead'
          : currentMonth <= 8
            ? 'Main herb cutting and drying season'
            : currentMonth <= 10
              ? 'Late herb cutting — reduced mixed yield'
              : 'Final hardy cuttings before winter rest',
        harvestWindow: 'Mixed herbs are cut from April into November, then remedies rely on stored stock',
      };

    case 'flower_garden': {
      const baseMultiplier = currentMonth <= 2 || currentMonth === 12
        ? 0
        : currentMonth <= 5
          ? 1.4
          : currentMonth <= 8
            ? 1
            : 0.35;
      return {
        baseMultiplier,
        growing: baseMultiplier > 0,
        harvestable: false,
        phase: baseMultiplier > 0 ? 'flowering' : 'dormant',
        produceVisibility: 'none',
        label: baseMultiplier > 0
          ? 'Flowering for pollinators and settlement attraction'
          : 'Winter dormancy — no active bloom',
        harvestWindow: 'No saleable harvest; bloom runs from spring through autumn',
      };
    }

    case 'hen_yard':
    case 'goat_pen':
      return {
        baseMultiplier: winter ? 0.75 : 1,
        growing: false,
        harvestable: true,
        phase: 'year_round',
        produceVisibility: 'harvest',
        label: winter
          ? 'Year-round husbandry — winter fodder reduces output to 75%'
          : 'Year-round husbandry — full warm-season output',
        harvestWindow: 'Collected throughout the year by the household',
      };

    case 'backyard_apiary': {
      const baseMultiplier = winter
        ? 0
        : currentMonth <= 5
          ? 0.8
          : currentMonth <= 8
            ? 1
            : 0.4;
      return {
        baseMultiplier,
        growing: baseMultiplier > 0,
        harvestable: baseMultiplier > 0,
        phase: baseMultiplier > 0 ? 'harvest' : 'dormant',
        produceVisibility: baseMultiplier > 0 ? 'harvest' : 'none',
        label: baseMultiplier > 0
          ? 'Small-hive honey flow and household harvest'
          : 'Winter hive dormancy — no honey harvest',
        harvestWindow: 'Honey flow runs from spring through autumn',
      };
    }
  }
}

/** Mirrors `server/src/backyard_garden_policy.rs`. */
export function backyardGardenSeasonalMultiplier(
  kind: BackyardGardenKind,
  month: number,
  environment: Pick<EnvironmentState, 'season' | 'weather'>,
): number {
  const base = backyardGardenPhenology(kind, month).baseMultiplier;
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
  const phenology = backyardGardenPhenology(kind, month);
  const multiplier = backyardGardenSeasonalMultiplier(
    kind,
    month,
    environment,
  );
  let label: string;
  if (environment.weather === 'drought' && multiplier > 1e-9) {
    label = `${phenology.label} · drought reduces output to ${Math.round(multiplier * 100)}%`;
  } else if (multiplier > 1e-9 && Math.abs(multiplier - 1) > 1e-9) {
    label = `${phenology.label} · ${Math.round(multiplier * 100)}% of baseline output`;
  } else {
    label = phenology.label;
  }
  return {
    ...phenology,
    multiplier,
    active: multiplier > 1e-9,
    label,
  };
}

export function computeBackyardGardenTickEffects(
  kind: BackyardGardenKind,
  population: number,
  hasMarketAccess: boolean,
  seconds = SIM_TICK_SECONDS,
  seasonalMultiplier = 1,
  remedyUnitsSold = 0,
  tier = 1,
  currentFoodStock = 0,
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
    ({ selfFood, marketFood } = allocateBackyardFood(
      totalFood,
      hasMarketAccess,
      tier,
      pop,
      currentFoodStock,
    ));
  }

  const economicActivity = hasMarketAccess
    ? gardenMarketActivity(
        marketFood,
        kind === 'herb_garden' ? remedyUnitsSold : 0,
      )
    : 0;

  return { selfFood, marketFood, economicActivity };
}
