import {
  CALENDAR_DAYS_PER_MONTH,
  RESIDENCE_ALE_UNITS_PER_MONTH,
  RESIDENCE_CLOTH_MONTHS_PER_UNIT,
  RESIDENCE_POTTERY_MONTHS_PER_UNIT,
  RESIDENCE_SHOES_MONTHS_PER_UNIT,
  RESIDENCE_WATER_UNITS_PER_DAY,
  SIM_TICK_SECONDS,
  WINTER_FIREWOOD_DEMAND_MULTIPLIER,
} from '../generated/gameBalance.ts';
import { fireDisabledResidenceIds } from '../fires/fireIncident.ts';
import {
  DEFAULT_RESIDENCE_COMMUNITY_CONTEXT,
  type ResidenceCommunityContext,
  type ResidenceNeedKind,
} from '../residences/residenceNeedState.ts';
import type { GameState, ResidenceState } from '../resources/types.ts';
import { wholeResourceUnits } from '../resources/resourceUnits.ts';
import { effectiveResidenceSettleTicks } from './chapelCommunity.ts';
import { residenceSettlementReadiness } from './residenceSettlement.ts';
import {
  householdFirewoodUnitsPerDay,
  householdFoodUnitsPerDay,
  householdFoodUnitsPerDayForTier,
} from './householdBillDemand.ts';

export type SettlementGrowthPlan = {
  vacantSlots: number;
  candidateHomes: number;
  progressingHomes: number;
  pausedHomes: number;
  firstArrivalHomes: number;
  fullHomes: number;
  fireDisabledHomes: number;
  fireDisabledResidents: number;
  fireDisabledHousingCapacity: number;
  fireDisabledVacantSlots: number;
  nextArrivalSeconds: number | null;
  waitingOnHomes: Record<ResidenceNeedKind, number>;
  firstPausedResidenceId: string | null;
  additionalGrossFoodPerDay: number;
  additionalFoodPerDay: number;
  additionalWaterPerDay: number;
  additionalWinterFirewoodPerDay: number;
  additionalPreservedFoodPerDay: number;
  additionalAlePerDay: number;
  additionalClothPerDay: number;
  additionalShoesPerDay: number;
  additionalPotteryPerDay: number;
};

const EMPTY_WAITING_COUNTS = (): Record<ResidenceNeedKind, number> => ({
  firewood: 0,
  water: 0,
  food: 0,
  preservedFood: 0,
  ale: 0,
  cloth: 0,
  shoes: 0,
  pottery: 0,
  church: 0,
  foodVariety: 0,
  luxury: 0,
});

export function computeSettlementGrowthPlan(input: {
  state: Pick<GameState, 'residences'>
    & Partial<Pick<GameState, 'fireIncidents'>>;
  communityForResidence?: (residence: ResidenceState) => ResidenceCommunityContext;
}): SettlementGrowthPlan {
  const communityForResidence = input.communityForResidence
    ?? (() => DEFAULT_RESIDENCE_COMMUNITY_CONTEXT);
  const waitingOnHomes = EMPTY_WAITING_COUNTS();
  const calendarDaysPerMonth = Math.max(
    1,
    wholeResourceUnits(CALENDAR_DAYS_PER_MONTH),
  );
  let vacantSlots = 0;
  let candidateHomes = 0;
  let progressingHomes = 0;
  let pausedHomes = 0;
  let firstArrivalHomes = 0;
  let fullHomes = 0;
  let fireDisabledHomes = 0;
  let fireDisabledResidents = 0;
  let fireDisabledHousingCapacity = 0;
  let fireDisabledVacantSlots = 0;
  let nextArrivalSeconds = Number.POSITIVE_INFINITY;
  let firstPausedResidenceId: string | null = null;
  let additionalGrossFoodPerDay = 0;
  let additionalFoodPerDay = 0;
  let additionalWaterPerDay = 0;
  let additionalWinterFirewoodPerDay = 0;
  let additionalPreservedFoodPerDay = 0;
  let additionalAlePerDay = 0;
  let additionalClothPerDay = 0;
  let additionalShoesPerDay = 0;
  let additionalPotteryPerDay = 0;
  const fireDisabled = fireDisabledResidenceIds(
    input.state.fireIncidents?.values() ?? [],
  );

  for (const residence of input.state.residences.values()) {
    if (residence.tier === 0) {
      continue;
    }
    if (fireDisabled.has(residence.id)) {
      fireDisabledHomes += 1;
      fireDisabledResidents += Math.max(0, residence.population);
      fireDisabledHousingCapacity += Math.max(0, residence.populationCapacity);
      fireDisabledVacantSlots += Math.max(
        0,
        residence.populationCapacity - residence.population,
      );
      continue;
    }
    const vacancies = Math.max(0, residence.populationCapacity - residence.population);
    if (vacancies === 0) {
      fullHomes += 1;
      continue;
    }

    vacantSlots += vacancies;
    candidateHomes += 1;
    // Filling more beds in an occupied residence does not create another
    // household bill. Only a first arrival activates this home's obligations.
    const establishesHousehold = residence.population === 0;
    const grossFoodPerDay = establishesHousehold
      ? householdFoodUnitsPerDayForTier(residence.tier)
      : 0;
    additionalGrossFoodPerDay += grossFoodPerDay;
    if (establishesHousehold && residence.tier >= 1) {
      additionalWinterFirewoodPerDay += householdFirewoodUnitsPerDay(
        WINTER_FIREWOOD_DEMAND_MULTIPLIER,
      );
      additionalWaterPerDay += wholeResourceUnits(RESIDENCE_WATER_UNITS_PER_DAY);
    }
    if (establishesHousehold && residence.tier >= 2) {
      additionalClothPerDay += 1
        / (calendarDaysPerMonth * Math.max(1, RESIDENCE_CLOTH_MONTHS_PER_UNIT));
      additionalAlePerDay += wholeResourceUnits(RESIDENCE_ALE_UNITS_PER_MONTH)
        / calendarDaysPerMonth;
    }
    if (establishesHousehold && residence.tier >= 3) {
      additionalShoesPerDay += 1
        / (calendarDaysPerMonth * Math.max(1, RESIDENCE_SHOES_MONTHS_PER_UNIT));
    }
    if (residence.tier >= 4) {
      const preservedFoodPerDay = establishesHousehold
        ? householdFoodUnitsPerDay(1)
        : 0;
      additionalPreservedFoodPerDay += preservedFoodPerDay;
      additionalFoodPerDay += Math.max(
        0,
        grossFoodPerDay - preservedFoodPerDay,
      );
      if (establishesHousehold) {
        additionalPotteryPerDay += 1
          / (calendarDaysPerMonth * Math.max(1, RESIDENCE_POTTERY_MONTHS_PER_UNIT));
      }
    } else {
      additionalFoodPerDay += grossFoodPerDay;
    }

    const community = communityForResidence(residence);
    const readiness = residenceSettlementReadiness(residence, community);
    if (!readiness.ready) {
      pausedHomes += 1;
      firstPausedResidenceId ??= residence.id;
      for (const buffer of readiness.waitingOn) {
        waitingOnHomes[buffer.kind] += 1;
      }
      continue;
    }

    progressingHomes += 1;
    if (readiness.firstArrival) firstArrivalHomes += 1;
    const requiredTicks = effectiveResidenceSettleTicks(
      community.hasChapelAccess,
      community.sabbathObservance,
      community.hasMonasteryCoverage,
    );
    const remainingTicks = Math.max(1, requiredTicks - residence.settlementTicks);
    nextArrivalSeconds = Math.min(nextArrivalSeconds, remainingTicks * SIM_TICK_SECONDS);
  }

  return {
    vacantSlots,
    candidateHomes,
    progressingHomes,
    pausedHomes,
    firstArrivalHomes,
    fullHomes,
    fireDisabledHomes,
    fireDisabledResidents,
    fireDisabledHousingCapacity,
    fireDisabledVacantSlots,
    nextArrivalSeconds: Number.isFinite(nextArrivalSeconds) ? nextArrivalSeconds : null,
    waitingOnHomes,
    firstPausedResidenceId,
    additionalGrossFoodPerDay,
    additionalFoodPerDay,
    additionalWaterPerDay,
    additionalWinterFirewoodPerDay,
    additionalPreservedFoodPerDay,
    additionalAlePerDay,
    additionalClothPerDay,
    additionalShoesPerDay,
    additionalPotteryPerDay,
  };
}
