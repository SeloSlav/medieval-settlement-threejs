import {
  CALENDAR_HOURS_PER_DAY,
  CALENDAR_SECONDS_PER_DAY,
  CALENDAR_WORK_END_HOUR,
  CALENDAR_WORK_START_HOUR,
  RESIDENCE_ALE_PER_PERSON_PER_SEC,
  RESIDENCE_CLOTH_PER_PERSON_PER_SEC,
  RESIDENCE_PRESERVED_FOOD_PER_PERSON_PER_SEC,
  RESIDENCE_POTTERY_PER_PERSON_PER_SEC,
} from '../generated/gameBalance.ts';
import { compareStableEntityIds } from '../logistics/roadLogistics.ts';
import type { ResidenceState } from '../resources/types.ts';
import type { SettlementGrowthPlan } from './settlementGrowth.ts';
import type {
  ProsperityRoadBranch,
  SettlementProductionCapacity,
} from './settlementProduction.ts';

export type ProsperityCommodity = 'preservedFood' | 'ale' | 'cloth' | 'pottery';

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
  roadPlan: ProsperityRoadPlan | null;
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
  roadBranchScoped: boolean;
  limitingKind: ProsperityCommodity;
  limitingLabel: string;
};

export type ProsperityRoadBranchPlan = ProsperityRoadBranch & {
  residentCapacity: number;
  limitingKind: ProsperityCommodity;
  limitingLabel: string;
  currentShortfallResidents: number;
  fullShortfallResidents: number;
};

export type ProsperityRoadPlan = {
  activeBranches: number;
  matchedBranches: number;
  currentResidentBranches: number;
  currentShortBranches: number;
  fullShortBranches: number;
  roadMatchedResidentCapacity: number;
  fragmentationResidentCapacity: number;
  currentShortfallResidents: number;
  fullShortfallResidents: number;
  firstExposedResidenceId: string | null;
  limitingKind: ProsperityCommodity;
  limitingLabel: string;
  branches: ReadonlyMap<string, ProsperityRoadBranchPlan>;
};

const WORKDAY_SECONDS = CALENDAR_SECONDS_PER_DAY
  * (CALENDAR_WORK_END_HOUR - CALENDAR_WORK_START_HOUR)
  / CALENDAR_HOURS_PER_DAY;

const PER_RESIDENT_PER_DAY: Record<ProsperityCommodity, number> = {
  preservedFood: RESIDENCE_PRESERVED_FOOD_PER_PERSON_PER_SEC * WORKDAY_SECONDS,
  ale: RESIDENCE_ALE_PER_PERSON_PER_SEC * WORKDAY_SECONDS,
  cloth: RESIDENCE_CLOTH_PER_PERSON_PER_SEC * WORKDAY_SECONDS,
  pottery: RESIDENCE_POTTERY_PER_PERSON_PER_SEC * WORKDAY_SECONDS,
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
    | 'potteryOutputPerDay'
    | 'potteryDemandPerDay'
  > & {
    prosperityRoadBranches?: ReadonlyMap<string, ProsperityRoadBranch> | null;
  },
  growth?: Pick<
    SettlementGrowthPlan,
    | 'additionalPreservedFoodPerDay'
    | 'additionalAlePerDay'
    | 'additionalClothPerDay'
    | 'additionalPotteryPerDay'
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
    prosperityChain(
      'pottery',
      'household pottery',
      production.potteryOutputPerDay,
      production.potteryDemandPerDay,
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
        safeRatio(growth.additionalPotteryPerDay, PER_RESIDENT_PER_DAY.pottery),
      ))
    : 0;
  const existingFullResidents = currentResidents + existingTierThreeVacancies;
  const installedResidentCapacity = wholeResidents(limiting.supportedResidents);
  const roadPlan = production.prosperityRoadBranches
    ? buildProsperityRoadPlan(
        production.prosperityRoadBranches,
        installedResidentCapacity,
        limiting.kind,
      )
    : null;
  const usableResidentCapacity = roadPlan?.roadMatchedResidentCapacity
    ?? installedResidentCapacity;
  const currentRoadShortfall = roadPlan?.currentShortfallResidents ?? 0;
  const fullRoadShortfall = roadPlan?.fullShortfallResidents ?? 0;
  const effectiveLimitingKind = roadPlan?.limitingKind ?? limiting.kind;

  return {
    currentResidents,
    existingTierThreeVacancies,
    existingFullResidents,
    installedResidentCapacity,
    currentHeadroomResidents: usableResidentCapacity - currentResidents,
    fullHousingHeadroomResidents: usableResidentCapacity - existingFullResidents,
    currentSustainable: currentResidents <= usableResidentCapacity
      && currentRoadShortfall === 0,
    fullExistingHousingSustainable: existingFullResidents <= usableResidentCapacity
      && fullRoadShortfall === 0,
    limitingKind: effectiveLimitingKind,
    limitingLabel: prosperityCommodityLabel(effectiveLimitingKind),
    chains,
    roadPlan,
  };
}

export function projectTierThreeUpgrade(
  plan: SettlementProsperityPlan,
  residence: Pick<ResidenceState, 'population' | 'abandoned'>,
  targetHouseCapacity: number,
  roadBranchKey?: string,
): TierThreeUpgradeProjection {
  const occupantsPromotedNow = residence.abandoned
    ? 0
    : wholeResidents(residence.population);
  const normalizedTargetCapacity = wholeResidents(targetHouseCapacity);
  const roadBranchScoped = plan.roadPlan !== null && roadBranchKey !== undefined;
  const branch = roadBranchScoped
    ? plan.roadPlan!.branches.get(roadBranchKey)
    : undefined;
  const currentResidents = roadBranchScoped
    ? branch?.currentResidents ?? 0
    : plan.currentResidents;
  const fullResidents = roadBranchScoped
    ? branch?.fullResidents ?? 0
    : plan.existingFullResidents;
  const residentCapacity = roadBranchScoped
    ? branch?.residentCapacity ?? 0
    : plan.installedResidentCapacity;
  const limitingKind = branch?.limitingKind ?? plan.limitingKind;
  const immediateResidents = currentResidents + occupantsPromotedNow;
  const fullPipelineResidents = fullResidents + normalizedTargetCapacity;
  return {
    occupantsPromotedNow,
    targetHouseCapacity: normalizedTargetCapacity,
    immediateResidents,
    fullPipelineResidents,
    immediateSustainable: immediateResidents <= residentCapacity,
    fullPipelineSustainable: fullPipelineResidents <= residentCapacity,
    immediateHeadroomResidents: residentCapacity - immediateResidents,
    immediateDemand: demandForResidents(occupantsPromotedNow),
    fullHouseDemand: demandForResidents(normalizedTargetCapacity),
    roadBranchScoped,
    limitingKind,
    limitingLabel: prosperityCommodityLabel(limitingKind),
  };
}

function buildProsperityRoadPlan(
  source: ReadonlyMap<string, ProsperityRoadBranch>,
  installedResidentCapacity: number,
  fallbackLimitingKind: ProsperityCommodity,
): ProsperityRoadPlan {
  const branches = new Map<string, ProsperityRoadBranchPlan>();
  let matchedBranches = 0;
  let currentResidentBranches = 0;
  let currentShortBranches = 0;
  let fullShortBranches = 0;
  let roadMatchedResidentCapacity = 0;
  let currentShortfallResidents = 0;
  let fullShortfallResidents = 0;
  let firstExposedResidenceId: string | null = null;
  let firstExposurePriority = -1;
  let firstExposureShortfall = 0;
  let limitingKind = fallbackLimitingKind;

  for (const [key, raw] of source) {
    const capacities = [
      {
        kind: 'preservedFood' as const,
        supported: safeRatio(
          raw.preservedFoodOutputPerDay,
          PER_RESIDENT_PER_DAY.preservedFood,
        ),
      },
      {
        kind: 'ale' as const,
        supported: safeRatio(raw.aleOutputPerDay, PER_RESIDENT_PER_DAY.ale),
      },
      {
        kind: 'cloth' as const,
        supported: safeRatio(raw.clothOutputPerDay, PER_RESIDENT_PER_DAY.cloth),
      },
      {
        kind: 'pottery' as const,
        supported: safeRatio(
          raw.potteryOutputPerDay,
          PER_RESIDENT_PER_DAY.pottery,
        ),
      },
    ];
    const limiting = capacities.reduce(
      (lowest, capacity) =>
        capacity.supported < lowest.supported ? capacity : lowest,
      capacities[0],
    );
    const residentCapacity = wholeResidents(limiting.supported);
    const currentResidents = wholeResidents(raw.currentResidents);
    const fullResidents = wholeResidents(raw.fullResidents);
    const currentShortfall = Math.max(0, currentResidents - residentCapacity);
    const fullShortfall = Math.max(0, fullResidents - residentCapacity);
    const branch: ProsperityRoadBranchPlan = {
      ...raw,
      currentResidents,
      fullResidents,
      residentCapacity,
      limitingKind: limiting.kind,
      limitingLabel: prosperityCommodityLabel(limiting.kind),
      currentShortfallResidents: currentShortfall,
      fullShortfallResidents: fullShortfall,
    };
    branches.set(key, branch);
    roadMatchedResidentCapacity += residentCapacity;
    if (residentCapacity > 0) matchedBranches += 1;
    if (currentResidents > 0) currentResidentBranches += 1;
    if (currentShortfall > 0) currentShortBranches += 1;
    if (fullShortfall > 0) fullShortBranches += 1;
    currentShortfallResidents += currentShortfall;
    fullShortfallResidents += fullShortfall;

    const exposurePriority = currentShortfall > 0
      ? 2
      : fullShortfall > 0
        ? 1
        : 0;
    const exposureShortfall = currentShortfall > 0
      ? currentShortfall
      : fullShortfall;
    const candidateId = raw.firstResidenceId;
    if (
      exposurePriority > 0
      && candidateId !== null
      && (
        exposurePriority > firstExposurePriority
        || (
          exposurePriority === firstExposurePriority
          && (
            exposureShortfall > firstExposureShortfall
            || (
              exposureShortfall === firstExposureShortfall
              && (
                firstExposedResidenceId === null
                || compareStableEntityIds(candidateId, firstExposedResidenceId) < 0
              )
            )
          )
        )
      )
    ) {
      firstExposurePriority = exposurePriority;
      firstExposureShortfall = exposureShortfall;
      firstExposedResidenceId = candidateId;
      limitingKind = limiting.kind;
    }
  }

  return {
    activeBranches: branches.size,
    matchedBranches,
    currentResidentBranches,
    currentShortBranches,
    fullShortBranches,
    roadMatchedResidentCapacity,
    fragmentationResidentCapacity: Math.max(
      0,
      installedResidentCapacity - roadMatchedResidentCapacity,
    ),
    currentShortfallResidents,
    fullShortfallResidents,
    firstExposedResidenceId: firstExposurePriority > 0
      ? firstExposedResidenceId
      : null,
    limitingKind,
    limitingLabel: prosperityCommodityLabel(limitingKind),
    branches,
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

function prosperityCommodityLabel(kind: ProsperityCommodity): string {
  if (kind === 'preservedFood') return 'preserved food';
  if (kind === 'pottery') return 'household pottery';
  return kind;
}

function demandForResidents(
  residents: number,
): Record<ProsperityCommodity, number> {
  return {
    preservedFood: residents * PER_RESIDENT_PER_DAY.preservedFood,
    ale: residents * PER_RESIDENT_PER_DAY.ale,
    cloth: residents * PER_RESIDENT_PER_DAY.cloth,
    pottery: residents * PER_RESIDENT_PER_DAY.pottery,
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
