import { recoveryStockMin } from './chapelCommunity.ts';
import {
  activeResidenceNeedKinds,
  DEFAULT_RESIDENCE_COMMUNITY_CONTEXT,
  getNeed,
  type ResidenceCommunityContext,
  type ResidenceNeedKind,
} from '../residences/residenceNeedState.ts';
import type { ResidenceState } from '../resources/types.ts';

export type ResidenceSettlementBuffer = {
  kind: ResidenceNeedKind;
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
};

/**
 * The first settler establishes the delivery claim for a vacant residence.
 * Later arrivals wait until all needs active at the current tier hold the same
 * minimum stock used by authoritative abandonment recovery.
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
  const buffers = activeResidenceNeedKinds(residence.tier).map(
    (kind): ResidenceSettlementBuffer => {
      const stock = Math.max(0, getNeed(residence.needs, kind).stock);
      const required = Math.max(
        0,
        recoveryStockMin(
          kind,
          community.hasChapelAccess,
          community.hasMonasteryCoverage,
        ),
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
