import {
  CALENDAR_HOURS_PER_DAY,
  CALENDAR_SECONDS_PER_DAY,
  CALENDAR_WORK_END_HOUR,
  CALENDAR_WORK_START_HOUR,
  RESIDENCE_ALE_PER_PERSON_PER_SEC,
  RESIDENCE_CLOTH_PER_PERSON_PER_SEC,
  RESIDENCE_PRESERVED_FOOD_PER_PERSON_PER_SEC,
} from '../generated/gameBalance.ts';
import type { ResidenceState } from '../resources/types.ts';
import type { SettlementGrowthPlan } from './settlementGrowth.ts';
import type { SettlementProductionCapacity } from './settlementProduction.ts';

export type ProsperityCommodity = 'preservedFood' | 'ale' | 'cloth';

export type ProsperityChain = {
  kind: ProsperityCommodity;
  label: string;
  outputPerDay: number;
  demandPerDay: number;
  perResidentPerDay: number;
  supportedResidents: number;
  headroomPerDay: number;
};

export type SettlementProsperityPlan = {
  currentResidents: number;
  existingTierThreeVacancies: number;
  existingFullResidents: number;
  installedResidentCapacity: number;
  currentHeadroomResidents: number;
  fullHousingHeadroomResidents: number;
  currentSustainable: boolean;
  fullExistingHousingSustainable: boolean;
  limitingKind: ProsperityCommodity;
  limitingLabel: string;
  chains: readonly ProsperityChain[];
};

export type TierThreeUpgradeProjection = {
  occupantsPromotedNow: number;
  targetHouseCapacity: number;
  immediateResidents: number;
  fullPipelineResidents: number;
  immediateSustainable: boolean;
  fullPipelineSustainable: boolean;
  immediateHeadroomResidents: number;
  immediateDemand: Record<ProsperityCommodity, number>;
  fullHouseDemand: Record<ProsperityCommodity, number>;
};

const WORKDAY_SECONDS = CALENDAR_SECONDS_PER_DAY
  * (CALENDAR_WORK_END_HOUR - CALENDAR_WORK_START_HOUR)
  / CALENDAR_HOURS_PER_DAY;

const PER_RESIDENT_PER_DAY: Record<ProsperityCommodity, number> = {
  preservedFood: RESIDENCE_PRESERVED_FOOD_PER_PERSON_PER_SEC * WORKDAY_SECONDS,
  ale: RESIDENCE_ALE_PER_PERSON_PER_SEC * WORKDAY_SECONDS,
  cloth: RESIDENCE_CLOTH_PER_PERSON_PER_SEC * WORKDAY_SECONDS,
};

export function computeSettlementProsperityPlan(
  production: Pick<
    SettlementProductionCapacity,
    | 'tierThreeResidents'
    | 'preservedFoodOutputPerDay'
    | 'preservedFoodDemandPerDay'
    | 'aleOutputPerDay'
    | 'aleDemandPerDay'
    | 'clothOutputPerDay'
    | 'clothDemandPerDay'
  >,
  growth?: Pick<
    SettlementGrowthPlan,
    | 'additionalPreservedFoodPerDay'
    | 'additionalAlePerDay'
    | 'additionalClothPerDay'
  >,
): SettlementProsperityPlan {
  const chains = [
    prosperityChain(
      'preservedFood',
      'preserved food',
      production.preservedFoodOutputPerDay,
      production.preservedFoodDemandPerDay,
    ),
    prosperityChain(
      'ale',
      'ale',
      production.aleOutputPerDay,
      production.aleDemandPerDay,
    ),
    prosperityChain(
      'cloth',
      'cloth',
      production.clothOutputPerDay,
      production.clothDemandPerDay,
    ),
  ] as const;
  const limiting = chains.reduce(
    (lowest, chain) =>
      chain.supportedResidents < lowest.supportedResidents ? chain : lowest,
    chains[0],
  );
  const currentResidents = wholeResidents(production.tierThreeResidents);
  const existingTierThreeVacancies = growth
    ? wholeResidents(Math.max(
        safeRatio(
          growth.additionalPreservedFoodPerDay,
          PER_RESIDENT_PER_DAY.preservedFood,
        ),
        safeRatio(growth.additionalAlePerDay, PER_RESIDENT_PER_DAY.ale),
        safeRatio(growth.additionalClothPerDay, PER_RESIDENT_PER_DAY.cloth),
      ))
    : 0;
  const existingFullResidents = currentResidents + existingTierThreeVacancies;
  const installedResidentCapacity = wholeResidents(limiting.supportedResidents);

  return {
    currentResidents,
    existingTierThreeVacancies,
    existingFullResidents,
    installedResidentCapacity,
    currentHeadroomResidents: installedResidentCapacity - currentResidents,
    fullHousingHeadroomResidents: installedResidentCapacity - existingFullResidents,
    currentSustainable: currentResidents <= installedResidentCapacity,
    fullExistingHousingSustainable: existingFullResidents <= installedResidentCapacity,
    limitingKind: limiting.kind,
    limitingLabel: limiting.label,
    chains,
  };
}

export function projectTierThreeUpgrade(
  plan: SettlementProsperityPlan,
  residence: Pick<ResidenceState, 'population' | 'abandoned'>,
  targetHouseCapacity: number,
): TierThreeUpgradeProjection {
  const occupantsPromotedNow = residence.abandoned
    ? 0
    : wholeResidents(residence.population);
  const normalizedTargetCapacity = wholeResidents(targetHouseCapacity);
  const immediateResidents = plan.currentResidents + occupantsPromotedNow;
  const fullPipelineResidents = plan.existingFullResidents + normalizedTargetCapacity;
  return {
    occupantsPromotedNow,
    targetHouseCapacity: normalizedTargetCapacity,
    immediateResidents,
    fullPipelineResidents,
    immediateSustainable: immediateResidents <= plan.installedResidentCapacity,
    fullPipelineSustainable: fullPipelineResidents <= plan.installedResidentCapacity,
    immediateHeadroomResidents: plan.installedResidentCapacity - immediateResidents,
    immediateDemand: demandForResidents(occupantsPromotedNow),
    fullHouseDemand: demandForResidents(normalizedTargetCapacity),
  };
}

function prosperityChain(
  kind: ProsperityCommodity,
  label: string,
  outputPerDay: number,
  demandPerDay: number,
): ProsperityChain {
  const perResidentPerDay = PER_RESIDENT_PER_DAY[kind];
  const normalizedOutput = positive(outputPerDay);
  const normalizedDemand = positive(demandPerDay);
  return {
    kind,
    label,
    outputPerDay: normalizedOutput,
    demandPerDay: normalizedDemand,
    perResidentPerDay,
    supportedResidents: safeRatio(normalizedOutput, perResidentPerDay),
    headroomPerDay: normalizedOutput - normalizedDemand,
  };
}

function demandForResidents(
  residents: number,
): Record<ProsperityCommodity, number> {
  return {
    preservedFood: residents * PER_RESIDENT_PER_DAY.preservedFood,
    ale: residents * PER_RESIDENT_PER_DAY.ale,
    cloth: residents * PER_RESIDENT_PER_DAY.cloth,
  };
}

function safeRatio(value: number, divisor: number): number {
  if (!Number.isFinite(value) || value <= 0 || divisor <= 1e-9) return 0;
  return value / divisor;
}

function positive(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function wholeResidents(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value + 1e-6)) : 0;
}
