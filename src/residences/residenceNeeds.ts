import {
  RESIDENCE_FIREWOOD_CAPACITY,
  RESIDENCE_FOOD_CAPACITY,
  RESIDENCE_WATER_CAPACITY,
  SIM_TICK_SECONDS,
} from '../generated/gameBalance.ts';
import {
  formatResidenceServiceConsequence,
  residenceServiceState,
} from '../economy/residenceSatisfaction.ts';
import {
  effectiveResidenceSettleTicks,
  recoveryNeedsRequired,
  recoveryStockMin,
} from '../economy/chapelCommunity.ts';
import {
  formatFirewoodRunwayDays,
  residenceFirewoodRunwayDays,
} from '../logistics/firewoodLogistics.ts';
import {
  formatWaterRunwayDays,
  residenceWaterRunwayDays,
} from '../logistics/waterLogistics.ts';
import {
  formatSpecialtyRunwayDays,
  residenceClothRunwayDays,
  residenceShoesRunwayDays,
  residencePotteryRunwayDays,
} from '../logistics/specialtyLogistics.ts';
import type { ResidenceState } from '../resources/types.ts';
import {
  FOOD_PROGRESSION_SLOT_LABELS,
  foodProgressionStatus,
} from '../economy/foodInventory.ts';
import { householdFoodUnitsPerDayForTier } from '../economy/householdBillDemand.ts';
import {
  getNeed,
  requiredChapelTierForResidence,
  activeResidenceNeedKinds,
  type ResidenceNeedKind,
  type ResidenceNeedRecoveryStatus,
  type ResidenceNeedSupplyContext,
  type ResidenceCommunityContext,
  type ResidenceNeedsStatus,
  DEFAULT_RESIDENCE_COMMUNITY_CONTEXT,
} from './residenceNeedState.ts';

export type {
  ResidenceNeedKind,
  ResidenceNeedRecoveryStatus,
  ResidenceNeedSupplyContext,
  ResidenceCommunityContext,
  ResidenceNeedsStatus,
};
export {
  createDefaultNeeds,
  getNeed,
  getNeedStock,
  RESIDENCE_NEED_CATEGORIES,
  RESIDENCE_NEED_KINDS,
  activeResidenceNeedKinds,
  residenceNeedCategory,
} from './residenceNeedState.ts';

export function evaluateResidenceNeedRecovery(
  residence: ResidenceState,
  supply: ResidenceNeedSupplyContext,
  community: ResidenceCommunityContext = DEFAULT_RESIDENCE_COMMUNITY_CONTEXT,
): ResidenceNeedRecoveryStatus[] {
  return activeNeedKinds(residence)
    .filter((kind) => kind === 'food' || kind === 'water' || kind === 'firewood')
    .map((kind) => evaluateNeedRecovery(kind, residence, supply, community));
}

export function residenceRecoveryReady(
  statuses: readonly ResidenceNeedRecoveryStatus[],
  community: ResidenceCommunityContext = DEFAULT_RESIDENCE_COMMUNITY_CONTEXT,
): boolean {
  const required = recoveryNeedsRequired(community.hasChapelAccess, statuses.length);
  const foodReady = statuses.find((status) => status.kind === 'food')?.ready ?? false;
  return foodReady && statuses.filter((status) => status.ready).length >= required;
}

export function residenceNeedsStatus(
  residence: ResidenceState,
  _supply: ResidenceNeedSupplyContext = {
    servingLodgeId: null,
    servingWellId: null,
    servingFoodSupplierId: null,
  },
  community: ResidenceCommunityContext = DEFAULT_RESIDENCE_COMMUNITY_CONTEXT,
): ResidenceNeedsStatus {
  if (residence.tier === 0) {
    return {
      label: 'Cottage construction underway',
      state: 'idle',
    };
  }
  if (residence.population === 0) {
    return describeAwaitingSettlers(residence, community);
  }

  const deficitWarning = describeDeficitWarning(residence);
  if (deficitWarning) return deficitWarning;

  return describeActiveNeeds(residence);
}

function evaluateNeedRecovery(
  kind: ResidenceNeedKind,
  residence: ResidenceState,
  supply: ResidenceNeedSupplyContext,
  community: ResidenceCommunityContext,
): ResidenceNeedRecoveryStatus {
  const need = getNeed(residence.needs, kind);
  const threshold = recoveryStockMin(
    kind,
    community.hasChapelAccess,
    community.hasMonasteryCoverage,
  );
  switch (kind) {
    case 'firewood':
      return {
        kind,
        label: 'Firewood',
        ready: supply.servingLodgeId != null && need.stock + 1e-6 >= threshold,
        stock: need.stock,
        threshold,
        supplyAvailable: supply.servingLodgeId != null,
      };
    case 'water':
      return {
        kind,
        label: 'Water',
        ready: supply.servingWellId != null && need.stock + 1e-6 >= threshold,
        stock: need.stock,
        threshold,
        supplyAvailable: supply.servingWellId != null,
      };
    case 'food':
      return {
        kind,
        label: 'Food',
        ready: supply.servingFoodSupplierId != null && need.stock + 1e-6 >= threshold,
        stock: need.stock,
        threshold,
        supplyAvailable: supply.servingFoodSupplierId != null,
      };
    case 'preservedFood':
      return {
        kind,
        label: 'Cured provisions',
        ready: supply.servingPreservedFoodSupplierId != null && need.stock + 1e-6 >= threshold,
        stock: need.stock,
        threshold,
        supplyAvailable: supply.servingPreservedFoodSupplierId != null,
      };
    case 'ale':
      return {
        kind,
        label: 'Beverages',
        ready: supply.servingAleSupplierId != null && need.stock + 1e-6 >= threshold,
        stock: need.stock,
        threshold,
        supplyAvailable: supply.servingAleSupplierId != null,
      };
    case 'cloth':
      return {
        kind,
        label: 'Household textiles',
        ready: supply.servingClothSupplierId != null && need.stock + 1e-6 >= threshold,
        stock: need.stock,
        threshold,
        supplyAvailable: supply.servingClothSupplierId != null,
      };
    case 'shoes':
      return {
        kind,
        label: 'Footwear',
        ready: supply.servingShoesSupplierId != null && need.stock + 1e-6 >= threshold,
        stock: need.stock,
        threshold,
        supplyAvailable: supply.servingShoesSupplierId != null,
      };
    case 'pottery':
      return {
        kind,
        label: 'Household pottery',
        ready: supply.servingPotterySupplierId != null && need.stock + 1e-6 >= threshold,
        stock: need.stock,
        threshold,
        supplyAvailable: supply.servingPotterySupplierId != null,
      };
    case 'church':
      return {
        kind,
        label: 'Church access',
        ready: need.stock >= threshold,
        stock: need.stock,
        threshold,
        supplyAvailable: community.hasChapelAccess,
      };
    case 'foodVariety':
      return {
        kind,
        label: 'Food variety',
        ready: need.stock >= threshold,
        stock: need.stock,
        threshold,
        supplyAvailable: need.stock > 0,
      };
    case 'luxury':
      return {
        kind,
        label: 'Candles, luxury provisions, or flowers',
        ready: need.stock > 0,
        stock: need.stock,
        threshold: 1,
        supplyAvailable: need.stock > 0,
      };
    default: {
      const unhandled: never = kind;
      return unhandled;
    }
  }
}

function describeAwaitingSettlers(
  residence: ResidenceState,
  community: ResidenceCommunityContext,
): ResidenceNeedsStatus {
  const capacity = residence.populationCapacity;
  const settleTicks = effectiveResidenceSettleTicks(
    community.hasChapelAccess,
    community.sabbathObservance,
    community.hasMonasteryCoverage,
  );
  const settleSeconds = Math.max(
    1,
    Math.round((settleTicks - residence.settlementTicks) * SIM_TICK_SECONDS),
  );
  const chapelNote = community.hasChapelAccess
    ? community.hasMonasteryCoverage
      ? ' (parish + monastery coverage)'
      : ' (staffed church)'
    : '';
  return {
    label: capacity > 0
      ? `Awaiting settlers — first arrival in ~${formatShortDuration(settleSeconds)}${chapelNote}`
      : 'Vacant — awaiting settlers',
    state: 'idle',
  };
}

function describeDeficitWarning(
  residence: ResidenceState,
): ResidenceNeedsStatus | null {
  if (residence.tier === 0) return null;
  const unmetKinds = activeNeedKinds(residence)
    .filter((kind) => getNeed(residence.needs, kind).deficitTicks > 0)
  if (unmetKinds.length === 0) return null;

  const foodMissing = unmetKinds.includes('food');
  if (foodMissing) {
    return {
      label: 'Food shortage — hunger and malnutrition worsen until provisions arrive',
      state: 'warning',
    };
  }
  const survivalMissing = unmetKinds.filter(
    (kind) => kind === 'water' || kind === 'firewood',
  );
  if (survivalMissing.length > 0) {
    return {
      label: `Low ${survivalMissing.map((kind) => needLabel(kind).toLowerCase()).join(', ')} — illness risk is rising`,
      state: 'warning',
    };
  }

  const needLabelText = unmetKinds.map((kind) => needLabel(kind).toLowerCase()).join(', ');
  const service = residenceServiceState(residence);
  return {
    label: `Status shortage (${needLabelText}) — ${formatResidenceServiceConsequence(service)}`,
    state: 'warning',
  };
}

function describeActiveNeeds(residence: ResidenceState): ResidenceNeedsStatus {
  const warnings = activeNeedKinds(residence)
    .map((kind) => describeActiveNeed(kind, residence))
    .filter((status): status is ResidenceNeedsStatus => status != null);

  if (warnings.length === 0) {
    return { label: 'Needs met', state: 'active' };
  }

  return warnings.sort((a, b) => warningPriority(a) - warningPriority(b))[0];
}

function describeActiveNeed(
  kind: ResidenceNeedKind,
  residence: ResidenceState,
): ResidenceNeedsStatus | null {
  switch (kind) {
    case 'firewood': {
      const runwayDays = residenceFirewoodRunwayDays(residence);
      if (runwayDays == null) return null;
      if (runwayDays <= 0.25) {
        return {
          label: 'Out of firewood — awaiting delivery',
          state: 'warning',
        };
      }
      if (runwayDays < 1) {
        return {
          label: `Low firewood — ${formatFirewoodRunwayDays(runwayDays)} left`,
          state: 'warning',
        };
      }
      if (runwayDays < 3) {
        return {
          label: `Firewood low — ${formatFirewoodRunwayDays(runwayDays)} left`,
          state: 'warning',
        };
      }
      return {
        label: `Needs met — ${formatFirewoodRunwayDays(runwayDays)} of firewood`,
        state: 'active',
      };
    }
    case 'water': {
      const runwayDays = residenceWaterRunwayDays(residence);
      if (runwayDays == null) return null;
      if (runwayDays <= 0.25) {
        return {
          label: 'Out of water — awaiting well supply',
          state: 'warning',
        };
      }
      if (runwayDays < 1) {
        return {
          label: `Low water — ${formatWaterRunwayDays(runwayDays)} left`,
          state: 'warning',
        };
      }
      if (runwayDays < 3) {
        return {
          label: `Water low — ${formatWaterRunwayDays(runwayDays)} left`,
          state: 'warning',
        };
      }
      return null;
    }
    case 'food': {
      const runwayDays = residenceFoodRunwayDays(residence);
      if (runwayDays == null) return null;
      if (runwayDays <= 0.25) {
        return {
          label: 'Out of food — awaiting delivery',
          state: 'warning',
        };
      }
      if (runwayDays < 1) {
        return {
          label: `Low food — ${formatFoodRunwayDays(runwayDays)} left`,
          state: 'warning',
        };
      }
      if (runwayDays < 3) {
        return {
          label: `Food low — ${formatFoodRunwayDays(runwayDays)} left`,
          state: 'warning',
        };
      }
      return null;
    }
    case 'preservedFood':
      return getNeed(residence.needs, kind).stock <= 1e-6
        ? { label: 'Out of cured provisions — awaiting preservation supply', state: 'warning' }
        : null;
    case 'ale':
      return getNeed(residence.needs, kind).stock <= 1e-6
        ? { label: 'Out of beverages — awaiting Tavern service', state: 'warning' }
        : null;
    case 'cloth': {
      const runwayDays = residenceClothRunwayDays(residence);
      if (runwayDays == null) return null;
      if (runwayDays <= 0.25) {
        return {
          label: 'Out of household textiles — awaiting weaver supply',
          state: 'warning',
        };
      }
      if (runwayDays < 3) {
        return {
          label: `Household textiles low — ${formatSpecialtyRunwayDays(runwayDays)} left`,
          state: 'warning',
        };
      }
      return null;
    }
    case 'shoes': {
      const runwayDays = residenceShoesRunwayDays(residence);
      if (runwayDays == null) return null;
      if (runwayDays <= 0.25) {
        return {
          label: 'Out of footwear — awaiting cobbler supply',
          state: 'warning',
        };
      }
      if (runwayDays < 3) {
        return {
          label: `Footwear low — ${formatSpecialtyRunwayDays(runwayDays)} left`,
          state: 'warning',
        };
      }
      return null;
    }
    case 'pottery': {
      const runwayDays = residencePotteryRunwayDays(residence);
      if (runwayDays == null) return null;
      if (runwayDays <= 0.25) {
        return {
          label: 'Out of household pottery — awaiting kiln supply',
          state: 'warning',
        };
      }
      if (runwayDays < 3) {
        return {
          label: `Household pottery low — ${formatSpecialtyRunwayDays(runwayDays)} left`,
          state: 'warning',
        };
      }
      return null;
    }
    case 'church': {
      const requiredTier = requiredChapelTierForResidence(residence.tier);
      return getNeed(residence.needs, kind).stock + 1e-6 < requiredTier
        ? {
            label: `Church insufficient — Tier ${residence.tier} needs a level-${requiredTier} church`,
            state: 'warning',
          }
        : null;
    }
    case 'foodVariety': {
      const progression = foodProgressionStatus(
        residence,
        residence.population,
        residence.tier as 1 | 2 | 3 | 4,
      );
      const missing = progression.missingSlots
        .map((slot) => FOOD_PROGRESSION_SLOT_LABELS[slot].toLowerCase());
      return !progression.ready
        ? {
            label: `Food standard incomplete — ${progression.satisfiedSlots.length}/${progression.requiredSlots.length} goals; missing ${missing.join(', ')}`,
            state: 'warning',
          }
        : null;
    }
    case 'luxury':
      return getNeed(residence.needs, kind).stock <= 1e-6
        ? { label: 'Luxury comfort missing — supply market candles, honey or wine, or cultivate upgraded cut flowers', state: 'warning' }
        : null;
    default: {
      const unhandled: never = kind;
      return unhandled;
    }
  }
}

function needLabel(kind: ResidenceNeedKind): string {
  switch (kind) {
    case 'firewood':
      return 'Firewood';
    case 'water':
      return 'Water';
    case 'food':
      return 'Food';
    case 'ale':
      return 'Beverages';
    case 'preservedFood':
      return 'Cured provisions';
    case 'cloth':
      return 'Household textiles';
    case 'shoes':
      return 'Footwear';
    case 'pottery':
      return 'Household pottery';
    case 'church':
      return 'Church access';
    case 'foodVariety':
      return 'Food variety';
    case 'luxury':
      return 'Candles, luxury provisions, or flowers';
    default: {
      const unhandled: never = kind;
      return unhandled;
    }
  }
}

function warningPriority(status: ResidenceNeedsStatus): number {
  if (status.state === 'warning' && status.label.startsWith('Out of')) return 0;
  if (status.state === 'warning' && status.label.startsWith('Low')) return 1;
  if (status.state === 'warning') return 2;
  return 3;
}

function formatShortDuration(seconds: number): string {
  if (seconds >= 120) {
    const minutes = Math.max(1, Math.round(seconds / 60));
    return `~${minutes} min`;
  }
  return `~${Math.max(1, Math.round(seconds))}s`;
}

function activeNeedKinds(residence: ResidenceState): ResidenceNeedKind[] {
  return activeResidenceNeedKinds(residence.tier);
}

function residenceFoodRunwayDays(residence: ResidenceState): number | null {
  if (residence.population === 0) return null;
  const stock = getNeed(residence.needs, 'food').stock;
  const dailyUse = householdFoodUnitsPerDayForTier(residence.tier);
  if (dailyUse <= 1e-9) return null;
  return stock / dailyUse;
}

function formatFoodRunwayDays(days: number): string {
  if (days >= 2) return `${days.toFixed(1)} days`;
  const hours = Math.max(1, Math.round(days * 24));
  return `${hours}h`;
}

export { RESIDENCE_FIREWOOD_CAPACITY, RESIDENCE_WATER_CAPACITY, RESIDENCE_FOOD_CAPACITY };
