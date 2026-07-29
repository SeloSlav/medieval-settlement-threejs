import {
  CALENDAR_HOURS_PER_DAY,
  CALENDAR_SECONDS_PER_DAY,
  CALENDAR_WORK_END_HOUR,
  CALENDAR_WORK_START_HOUR,
  RESIDENCE_ALE_PER_PERSON_PER_SEC,
  RESIDENCE_CLOTH_PER_PERSON_PER_SEC,
  RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC,
  RESIDENCE_FOOD_PER_PERSON_PER_SEC,
  RESIDENCE_PRESERVED_FOOD_PER_PERSON_PER_SEC,
  RESIDENCE_PRESERVED_FOOD_WINTER_MULTIPLIER,
  RESIDENCE_POTTERY_PER_PERSON_PER_SEC,
  RESIDENCE_WATER_PER_PERSON_PER_SEC,
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
import { effectiveResidenceSettleTicks } from './chapelCommunity.ts';
import { residenceSettlementReadiness } from './residenceSettlement.ts';

export type SettlementGrowthPlan = {
  vacantSlots: number;
  candidateHomes: number;
  progressingHomes: number;
  pausedHomes: number;
  firstArrivalHomes: number;
  fullHomes: number;
  abandonedHomes: number;
  fireDisabledHomes: number;
  fireDisabledResidents: number;
  fireDisabledHousingCapacity: number;
  fireDisabledVacantSlots: number;
  nextArrivalSeconds: number | null;
  waitingOnHomes: Record<ResidenceNeedKind, number>;
  firstPausedResidenceId: string | null;
  additionalFoodPerDay: number;
  additionalWaterPerDay: number;
  additionalWinterFirewoodPerDay: number;
  additionalPreservedFoodPerDay: number;
  additionalAlePerDay: number;
  additionalClothPerDay: number;
  additionalPotteryPerDay: number;
};

const EMPTY_WAITING_COUNTS = (): Record<ResidenceNeedKind, number> => ({
  firewood: 0,
  water: 0,
  food: 0,
  preservedFood: 0,
  ale: 0,
  cloth: 0,
  pottery: 0,
});

export function computeSettlementGrowthPlan(input: {
  state: Pick<GameState, 'residences'>
    & Partial<Pick<GameState, 'fireIncidents'>>;
  communityForResidence?: (residence: ResidenceState) => ResidenceCommunityContext;
}): SettlementGrowthPlan {
  const communityForResidence = input.communityForResidence
    ?? (() => DEFAULT_RESIDENCE_COMMUNITY_CONTEXT);
  const waitingOnHomes = EMPTY_WAITING_COUNTS();
  const workdayFraction = Math.max(
    0,
    (CALENDAR_WORK_END_HOUR - CALENDAR_WORK_START_HOUR) / CALENDAR_HOURS_PER_DAY,
  );
  const workdaySeconds = CALENDAR_SECONDS_PER_DAY * workdayFraction;
  let vacantSlots = 0;
  let candidateHomes = 0;
  let progressingHomes = 0;
  let pausedHomes = 0;
  let firstArrivalHomes = 0;
  let fullHomes = 0;
  let abandonedHomes = 0;
  let fireDisabledHomes = 0;
  let fireDisabledResidents = 0;
  let fireDisabledHousingCapacity = 0;
  let fireDisabledVacantSlots = 0;
  let nextArrivalSeconds = Number.POSITIVE_INFINITY;
  let firstPausedResidenceId: string | null = null;
  let additionalFoodPerDay = 0;
  let additionalWaterPerDay = 0;
  let additionalWinterFirewoodPerDay = 0;
  let additionalPreservedFoodPerDay = 0;
  let additionalAlePerDay = 0;
  let additionalClothPerDay = 0;
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
    if (residence.abandoned) {
      abandonedHomes += 1;
      continue;
    }
    const vacancies = Math.max(0, residence.populationCapacity - residence.population);
    if (vacancies === 0) {
      fullHomes += 1;
      continue;
    }

    vacantSlots += vacancies;
    candidateHomes += 1;
    additionalFoodPerDay += vacancies * RESIDENCE_FOOD_PER_PERSON_PER_SEC * workdaySeconds;
    if (residence.tier >= 2) {
      additionalWaterPerDay += vacancies * RESIDENCE_WATER_PER_PERSON_PER_SEC * workdaySeconds;
      additionalWinterFirewoodPerDay += vacancies
        * RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC
        * CALENDAR_SECONDS_PER_DAY
        * WINTER_FIREWOOD_DEMAND_MULTIPLIER;
    }
    if (residence.tier >= 3) {
      additionalPreservedFoodPerDay += vacancies
        * RESIDENCE_PRESERVED_FOOD_PER_PERSON_PER_SEC
        * workdaySeconds
        * RESIDENCE_PRESERVED_FOOD_WINTER_MULTIPLIER;
      additionalAlePerDay += vacancies * RESIDENCE_ALE_PER_PERSON_PER_SEC * workdaySeconds;
      additionalClothPerDay += vacancies * RESIDENCE_CLOTH_PER_PERSON_PER_SEC * workdaySeconds;
      additionalPotteryPerDay += vacancies
        * RESIDENCE_POTTERY_PER_PERSON_PER_SEC
        * workdaySeconds;
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
    abandonedHomes,
    fireDisabledHomes,
    fireDisabledResidents,
    fireDisabledHousingCapacity,
    fireDisabledVacantSlots,
    nextArrivalSeconds: Number.isFinite(nextArrivalSeconds) ? nextArrivalSeconds : null,
    waitingOnHomes,
    firstPausedResidenceId,
    additionalFoodPerDay,
    additionalWaterPerDay,
    additionalWinterFirewoodPerDay,
    additionalPreservedFoodPerDay,
    additionalAlePerDay,
    additionalClothPerDay,
    additionalPotteryPerDay,
  };
}
