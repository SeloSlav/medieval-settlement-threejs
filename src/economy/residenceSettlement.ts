import {
  CALENDAR_HOURS_PER_DAY,
  CALENDAR_SECONDS_PER_DAY,
  CALENDAR_WORK_END_HOUR,
  CALENDAR_WORK_START_HOUR,
  CHAPEL_RECOVERY_STOCK_MULTIPLIER,
  MONASTERY_RECOVERY_STOCK_MULTIPLIER,
  RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC,
  RESIDENCE_SETTLEMENT_BUFFER_DAYS,
  RESIDENCE_WATER_PER_PERSON_PER_SEC,
} from '../generated/gameBalance.ts';
import {
  activeResidenceNeedKinds,
  DEFAULT_RESIDENCE_COMMUNITY_CONTEXT,
  getNeed,
  type ResidenceCommunityContext,
  type ResidenceNeedKind,
} from '../residences/residenceNeedState.ts';
import type { ResidenceState } from '../resources/types.ts';
import { householdFoodPerDay } from './foodInventory.ts';

export type ResidenceSettlementVitalNeedKind = 'food' | 'firewood' | 'water';

export type ResidenceSettlementBuffer = {
  kind: ResidenceSettlementVitalNeedKind;
  label: string;
  stock: number;
  required: number;
  shortfall: number;
  ready: boolean;
};

export type ResidenceSettlementReadiness = {
  firstArrival: boolean;
  ready: boolean;
  buffers: ResidenceSettlementBuffer[];
  waitingOn: ResidenceSettlementBuffer[];
};

const NEED_LABELS: Record<ResidenceNeedKind, string> = {
  firewood: 'firewood',
  water: 'water',
  food: 'food',
  preservedFood: 'preserved food',
  ale: 'ale',
  cloth: 'household textiles',
  shoes: 'footwear',
  pottery: 'household pottery',
  church: 'church access',
  foodVariety: 'food variety',
  luxury: 'honey, wine, luxury preserves, or flowers',
};

/**
 * Established households need only a fraction of one ordinary day's vital
 * demand before another settler can arrive. The buffer therefore stays
 * reachable through the same market issues that sustain the household.
 */
export function residenceSettlementBufferMin(
  kind: ResidenceSettlementVitalNeedKind,
  population: number,
  community: ResidenceCommunityContext = DEFAULT_RESIDENCE_COMMUNITY_CONTEXT,
): number {
  const householdPopulation = Math.max(1, population);
  const workdaySeconds = CALENDAR_SECONDS_PER_DAY
    * Math.max(0, CALENDAR_WORK_END_HOUR - CALENDAR_WORK_START_HOUR)
    / Math.max(1, CALENDAR_HOURS_PER_DAY);
  const dailyDemand = kind === 'food'
    ? householdFoodPerDay(householdPopulation)
    : kind === 'firewood'
      ? householdPopulation
        * RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC
        * CALENDAR_SECONDS_PER_DAY
      : householdPopulation * RESIDENCE_WATER_PER_PERSON_PER_SEC * workdaySeconds;
  let threshold = dailyDemand * Math.max(0, RESIDENCE_SETTLEMENT_BUFFER_DAYS);
  if (community.hasChapelAccess) {
    threshold *= CHAPEL_RECOVERY_STOCK_MULTIPLIER;
  }
  if (community.hasChapelAccess && community.hasMonasteryCoverage) {
    threshold *= MONASTERY_RECOVERY_STOCK_MULTIPLIER;
  }
  return Math.max(0, threshold);
}

/**
 * The first settler establishes the delivery claim for a vacant residence.
 * Later arrivals wait until survival needs hold a population-scaled fraction
 * of one ordinary day. Status goods never block a safe home.
 */
export function residenceSettlementReadiness(
  residence: ResidenceState,
  community: ResidenceCommunityContext = DEFAULT_RESIDENCE_COMMUNITY_CONTEXT,
): ResidenceSettlementReadiness {
  if (residence.tier === 0) {
    return {
      firstArrival: false,
      ready: false,
      buffers: [],
      waitingOn: [],
    };
  }
  const firstArrival = residence.population === 0;
  const buffers = activeResidenceNeedKinds(residence.tier)
    .filter(
      (kind): kind is ResidenceSettlementVitalNeedKind =>
        kind === 'food' || kind === 'water' || kind === 'firewood',
    )
    .map(
      (kind): ResidenceSettlementBuffer => {
        const stock = Math.max(0, getNeed(residence.needs, kind).stock);
        const required = residenceSettlementBufferMin(
          kind,
          residence.population,
          community,
        );
        const shortfall = Math.max(0, required - stock);
        return {
          kind,
          label: NEED_LABELS[kind],
          stock,
          required,
          shortfall,
          ready: shortfall <= 1e-6,
        };
      },
    );
  const waitingOn = firstArrival ? [] : buffers.filter((buffer) => !buffer.ready);

  return {
    firstArrival,
    ready: firstArrival || waitingOn.length === 0,
    buffers,
    waitingOn,
  };
}
