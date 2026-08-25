import {
  CHAPEL_RECOVERY_STOCK_MULTIPLIER,
  MONASTERY_RECOVERY_STOCK_MULTIPLIER,
  RESIDENCE_SETTLEMENT_BUFFER_DAYS,
  RESIDENCE_WATER_UNITS_PER_DAY,
} from '../generated/gameBalance.ts';
import {
  activeResidenceNeedKinds,
  DEFAULT_RESIDENCE_COMMUNITY_CONTEXT,
  getNeed,
  type ResidenceCommunityContext,
  type ResidenceNeedKind,
} from '../residences/residenceNeedState.ts';
import type { ResidenceState } from '../resources/types.ts';
import { wholeResourceUnits } from '../resources/resourceUnits.ts';
import {
  householdFirewoodUnitsPerDay,
  householdFoodUnitsPerDayForTier,
} from './householdBillDemand.ts';

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
 * Settlement readiness mirrors the server's discrete household bills. The
 * authored fractional horizon is converted to an attainable whole-unit lot;
 * population does not multiply food, firewood, or water obligations.
 */
export function residenceSettlementBufferMin(
  kind: ResidenceSettlementVitalNeedKind,
  tier: ResidenceState['tier'],
  community: ResidenceCommunityContext = DEFAULT_RESIDENCE_COMMUNITY_CONTEXT,
): number {
  const dailyDemand = kind === 'food'
    ? householdFoodUnitsPerDayForTier(tier)
    : kind === 'firewood'
      ? householdFirewoodUnitsPerDay()
      : wholeResourceUnits(RESIDENCE_WATER_UNITS_PER_DAY);
  let threshold = dailyDemand * Math.max(0, RESIDENCE_SETTLEMENT_BUFFER_DAYS);
  if (community.hasChapelAccess) {
    threshold *= CHAPEL_RECOVERY_STOCK_MULTIPLIER;
  }
  if (community.hasChapelAccess && community.hasMonasteryCoverage) {
    threshold *= MONASTERY_RECOVERY_STOCK_MULTIPLIER;
  }
  return wholeResourceCost(threshold);
}

/**
 * The first settler establishes the delivery claim for a vacant residence.
 * Later arrivals wait until survival needs hold their market-aligned bill
 * buffers. Status goods never block a safe home.
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
        const stock = wholeResourceUnits(getNeed(residence.needs, kind).stock);
        const required = residenceSettlementBufferMin(
          kind,
          residence.tier,
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

function wholeResourceCost(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.ceil(value - 1e-6);
}
