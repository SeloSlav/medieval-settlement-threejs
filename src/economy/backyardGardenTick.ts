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
  if (kind === 'flower_garden'
    || kind === 'orchard'
    || kind === 'vegetable_garden'
    || kind === 'animal_pen') return null;
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
  daysUntilFirstHarvest = 0,
): BackyardGardenPhenology {
  const currentMonth = calendarMonth(month);
  const winter = currentMonth === 12 || currentMonth <= 2;

  switch (kind) {
    case 'orchard':
      return {
        baseMultiplier: 0,
        growing: false,
        harvestable: false,
        phase: 'establishing',
        produceVisibility: 'none',
        label: 'Prepared orchard — awaiting a planting choice',
        harvestWindow: 'Choose a fruit tree or berry-bush specialization',
      };
    case 'animal_pen':
      return {
        baseMultiplier: 0,
        growing: false,
        harvestable: false,
        phase: 'establishing',
        produceVisibility: 'none',
        label: 'Completed enclosure — awaiting a livestock choice',
        harvestWindow: 'Choose chickens, goats, or pigs for this pen',
      };
    case 'vegetable_garden':
      return {
        baseMultiplier: 0,
        growing: false,
        harvestable: false,
        phase: 'establishing',
        produceVisibility: 'none',
        label: 'Prepared beds — awaiting a seed choice',
        harvestWindow: 'Choose cabbage, carrot, or beetroot seed for every bed',
      };
    case 'apple_orchard':
    case 'cherry_orchard':
    case 'pear_orchard':
    case 'aronia_orchard':
    case 'rosehip_orchard': {
      const def = BACKYARD_GARDEN_DEFINITIONS[kind];
      const crop = def.label;
      const windowLabel = def.harvestStartMonth === def.harvestEndMonth
        ? monthLabel(def.harvestStartMonth)
        : `${monthLabel(def.harvestStartMonth)}–${monthLabel(def.harvestEndMonth)}`;
      if (daysUntilFirstHarvest > 0) {
        return {
          baseMultiplier: 0,
          growing: true,
          harvestable: false,
          phase: 'establishing',
          produceVisibility: 'none',
          label: `${crop} establishing — ${Math.ceil(daysUntilFirstHarvest)} days until first harvest maturity`,
          harvestWindow: `First productive ${windowLabel} window after establishment`,
        };
      }
      if (winter) {
        return {
          baseMultiplier: 0,
          growing: false,
          harvestable: false,
          phase: 'dormant',
          produceVisibility: 'none',
          label: 'Dormant wood — no fruit on the trees or in the harvest basket',
          harvestWindow: `${crop} harvest window: ${windowLabel}`,
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
          harvestWindow: `${crop} harvest window: ${windowLabel}`,
        };
      }
      if (currentMonth > def.harvestEndMonth) {
        return {
          baseMultiplier: 0,
          growing: false,
          harvestable: false,
          phase: 'post_harvest',
          produceVisibility: 'none',
          label: `${crop} post-harvest — fruit and filled baskets have been cleared`,
          harvestWindow: `The next annual crop returns during ${windowLabel}`,
        };
      }
      const ripeningMonth = def.harvestStartMonth - 1;
      if (currentMonth !== ripeningMonth
        && !(currentMonth >= def.harvestStartMonth && currentMonth <= def.harvestEndMonth)) {
        return {
          baseMultiplier: 0,
          growing: true,
          harvestable: false,
          phase: 'establishing',
          produceVisibility: 'none',
          label: 'Fruit setting — the annual crop is still developing',
          harvestWindow: `${crop} harvest window: ${windowLabel}`,
        };
      }
      if (currentMonth === ripeningMonth) {
        return {
          baseMultiplier: 0,
          growing: true,
          harvestable: false,
          phase: 'ripening',
          produceVisibility: 'ripening',
          label: 'Fruit ripening on the trees — basket remains empty',
          harvestWindow: `The household harvests during ${windowLabel}`,
        };
      }
      if (currentMonth >= def.harvestStartMonth && currentMonth <= def.harvestEndMonth) {
        const windowMonths = Math.max(1, def.harvestEndMonth - def.harvestStartMonth + 1);
        return {
          baseMultiplier: 12 / windowMonths * def.yieldEfficiency,
          growing: false,
          harvestable: true,
          phase: 'harvest',
          produceVisibility: 'harvest',
          label: `${crop} harvest — ${Math.round(def.yieldEfficiency * 100)}% species efficiency`,
          harvestWindow: `Harvestable now during ${windowLabel}`,
        };
      }
      return {
        baseMultiplier: 0,
        growing: false,
        harvestable: false,
        phase: 'post_harvest',
        produceVisibility: 'none',
        label: 'Post-harvest — fruit and filled baskets have been cleared',
        harvestWindow: `The next annual crop returns during ${windowLabel}`,
      };
    }

    case 'cabbage_garden':
    case 'carrot_garden':
    case 'beetroot_garden': {
      const def = BACKYARD_GARDEN_DEFINITIONS[kind];
      const crop = kind === 'cabbage_garden'
        ? 'Cabbage'
        : kind === 'carrot_garden'
          ? 'Carrot'
          : 'Beetroot';
      const window = `${monthLabel(def.harvestStartMonth)}–${monthLabel(def.harvestEndMonth)}`;
      if (daysUntilFirstHarvest > 0) {
        return {
          baseMultiplier: 0,
          growing: !winter,
          harvestable: false,
          phase: winter ? 'dormant' : 'establishing',
          produceVisibility: 'none',
          label: winter
            ? `${crop} beds dormant — ${Math.ceil(daysUntilFirstHarvest)} maturity days remain`
            : `${crop} crop establishing — ${Math.ceil(daysUntilFirstHarvest)} days until first maturity`,
          harvestWindow: `First harvest during the next ${window} window after maturity`,
        };
      }
      if (winter) {
        return {
          baseMultiplier: 0,
          growing: false,
          harvestable: false,
          phase: 'dormant',
          produceVisibility: 'none',
          label: `${crop} beds cleared for winter`,
          harvestWindow: `${crop} harvest window: ${window}`,
        };
      }
      if (currentMonth < def.harvestStartMonth) {
        return {
          baseMultiplier: 0,
          growing: true,
          harvestable: false,
          phase: 'establishing',
          produceVisibility: 'none',
          label: `${crop} rows growing — not harvestable yet`,
          harvestWindow: `${crop} harvest begins in ${monthLabel(def.harvestStartMonth)}`,
        };
      }
      if (currentMonth > def.harvestEndMonth) {
        return {
          baseMultiplier: 0,
          growing: false,
          harvestable: false,
          phase: 'post_harvest',
          produceVisibility: 'none',
          label: `${crop} harvest complete — beds being cleared`,
          harvestWindow: `The next ${crop.toLowerCase()} crop returns during ${window}`,
        };
      }
      return {
        baseMultiplier: def.yieldEfficiency,
        growing: false,
        harvestable: true,
        phase: 'harvest',
        produceVisibility: 'harvest',
        label: `${crop} succession harvest — ${Math.round(def.yieldEfficiency * 100)}% crop efficiency`,
        harvestWindow: `Harvestable now during ${window}`,
      };
    }

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

    case 'chicken_pen':
    case 'goat_pen':
    case 'pig_pen': {
      const def = BACKYARD_GARDEN_DEFINITIONS[kind];
      const product = kind === 'chicken_pen'
        ? 'Egg collection'
        : kind === 'goat_pen'
          ? 'Milk collection'
          : 'Pork harvest';
      const window = def.harvestStartMonth === def.harvestEndMonth
        ? monthLabel(def.harvestStartMonth)
        : `${monthLabel(def.harvestStartMonth)}–${monthLabel(def.harvestEndMonth)}`;
      if (daysUntilFirstHarvest > 0) {
        return {
          baseMultiplier: 0,
          growing: true,
          harvestable: false,
          phase: 'establishing',
          produceVisibility: 'none',
          label: `Breeding stock maturing — ${Math.ceil(daysUntilFirstHarvest)} days until first collection`,
          harvestWindow: `${def.gestationDays}-day husbandry cycle · first ${window} window after maturity`,
        };
      }
      if (!monthInWindow(currentMonth, def.harvestStartMonth, def.harvestEndMonth)) {
        return {
          baseMultiplier: 0,
          growing: false,
          harvestable: false,
          phase: 'dormant',
          produceVisibility: 'none',
          label: `${def.label} between production windows`,
          harvestWindow: `${product}: ${window} · every ${def.productionIntervalDays} days while in season`,
        };
      }
      const baseMultiplier = (winter ? 0.75 : 1) * def.yieldEfficiency;
      return {
        baseMultiplier,
        growing: false,
        harvestable: true,
        phase: 'harvest',
        produceVisibility: 'harvest',
        label: `${product} active every ${def.productionIntervalDays} days${winter ? ' · winter output reduced' : ''}`,
        harvestWindow: `${product}: ${window}`,
      };
    }

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
  if (environment.weather !== 'drought') return base;
  if (kind === 'chicken_pen' || kind === 'goat_pen' || kind === 'pig_pen') return base;
  if (kind === 'apple_orchard' || kind === 'cherry_orchard' || kind === 'pear_orchard') return base * 0.9;
  if (kind === 'aronia_orchard') return base * 0.75;
  if (kind === 'rosehip_orchard') return base * 0.85;
  if (kind === 'orchard' || kind === 'animal_pen') return 0;
  return base * 0.55;
}

export function backyardGardenSeasonStatus(
  kind: BackyardGardenKind,
  month: number,
  environment: Pick<EnvironmentState, 'season' | 'weather'>,
  daysUntilFirstHarvest = 0,
): BackyardGardenSeasonStatus {
  const phenology = backyardGardenPhenology(kind, month, daysUntilFirstHarvest);
  const multiplier = daysUntilFirstHarvest > 0
    ? 0
    : backyardGardenSeasonalMultiplier(kind, month, environment);
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

function monthLabel(month: number): string {
  return ['?', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][month] ?? '?';
}

function monthInWindow(month: number, startMonth: number, endMonth: number): boolean {
  return startMonth <= endMonth
    ? month >= startMonth && month <= endMonth
    : month >= startMonth || month <= endMonth;
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
