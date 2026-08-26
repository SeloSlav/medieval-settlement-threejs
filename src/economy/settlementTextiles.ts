import {
  BUILDING_STORAGE_CAPS,
  CALENDAR_DAYS_PER_MONTH,
  CALENDAR_MONTHS_PER_YEAR,
  SHEEP_SHEARING_END_MONTH,
  SHEEP_WOOL_PER_SHEARING_PER_HEAD,
  SPINNING_RETTING_WOOL_PER_CYCLE,
  SPINNING_RETTING_FLAX_PER_CYCLE,
  SPINNING_RETTING_YARN_PER_CYCLE,
  WEAVER_CLOTH_PER_CYCLE,
  WEAVER_YARN_PER_CYCLE,
} from '../generated/gameBalance.ts';
import {
  fireDisabledBuildingIds,
  fireDisabledResidenceIds,
} from '../fires/fireIncident.ts';
import { compareStableEntityIds } from '../logistics/roadLogistics.ts';
import { getNeedStock } from '../residences/residenceNeedState.ts';
import type { GameState } from '../resources/types.ts';
import type { GameClock } from '../world/gameCalendar.ts';
import {
  canStoreFullSheepClip,
  projectedSheepFleece,
} from './livestockPolicy.ts';
import {
  productionRoadBranchKey,
  type ProductionRoadComponentResolver,
  type ProsperityRoadBranch,
  type SettlementProductionCapacity,
} from './settlementProduction.ts';

export const TEXTILE_PLAN_DAYS_PER_YEAR =
  CALENDAR_DAYS_PER_MONTH * CALENDAR_MONTHS_PER_YEAR;
export const TEXTILE_RESERVE_WARNING_DAYS = 14;

export type TextileAttentionKind =
  | 'fire'
  | 'storage'
  | 'staffing'
  | 'flock'
  | 'missed-window';

export type SettlementTextileRoadBranch = {
  sheepHoldings: number;
  projectedAnnualWool: number;
  flaxStock: number;
  yarnStock: number;
  linenStock: number;
  securedAnnualWool: number;
  annualSpinnerIntermediateCapacity: number;
  annualWeaverWoolCapacity: number;
  annualWeaverClothCapacity: number;
  annualClothPotential: number;
  annualHouseholdClothDemand: number;
  coveredHouseholdClothDemand: number;
  annualHouseholdClothShortfall: number;
  annualExportableClothSurplus: number;
  currentHouseholdClothDemandPerDay: number;
  householdClothStock: number;
  supplierClothStock: number;
  householdClothInTransit: number;
  serviceableClothStock: number;
  currentClothRunwayDays: number;
  hasStockedSupplier: boolean;
  firstWoolBuildingId: string | null;
  firstFlaxBuildingId: string | null;
  firstSpinnerBuildingId: string | null;
  firstResidenceId: string | null;
};

export type SettlementTextileRoadPlan = {
  activeBranches: number;
  fleeceBranches: number;
  flaxBranches: number;
  spinnerBranches: number;
  loomBranches: number;
  matchedBranches: number;
  exposedHouseholdBranches: number;
  projectedAnnualWool: number;
  flaxStock: number;
  yarnStock: number;
  linenStock: number;
  roadMatchedAnnualClothPotential: number;
  fragmentationClothPotential: number;
  annualHouseholdClothDemand: number;
  coveredHouseholdClothDemand: number;
  annualHouseholdClothShortfall: number;
  annualExportableClothSurplus: number;
  householdBranches: number;
  stockedSupplierBranches: number;
  unservedHouseholdBranches: number;
  reserveWarningBranches: number;
  serviceableClothStock: number;
  worstHouseholdClothRunwayDays: number;
  firstReserveExposedResidenceId: string | null;
  firstExposedResidenceId: string | null;
  firstImbalancedBuildingId: string | null;
  branches: ReadonlyMap<string, SettlementTextileRoadBranch>;
};

export type SettlementTextilePlan = {
  sheepHoldings: number;
  staffedSheepHoldings: number;
  fireDisabledSheepHoldings: number;
  sheepHeadCount: number;
  productiveSheepHeads: number;
  shornHoldings: number;
  pendingHoldings: number;
  readyPendingHoldings: number;
  storageBlockedHoldings: number;
  staffingBlockedHoldings: number;
  flockBlockedHoldings: number;
  missedHoldings: number;
  projectedAnnualWool: number;
  securedAnnualWool: number;
  annualWoolAtRisk: number;
  woolStock: number;
  woolInTransit: number;
  flaxStock: number;
  flaxInTransit: number;
  yarnStock: number;
  yarnInTransit: number;
  linenStock: number;
  linenInTransit: number;
  clothStock: number;
  clothInTransit: number;
  householdClothStock: number;
  supplierClothStock: number;
  householdClothInTransit: number;
  fireDisabledSpinners: number;
  fireDisabledWeavers: number;
  fireDisabledProsperousHomes: number;
  fireQuarantinedClothStock: number;
  serviceableHouseholdClothStock: number;
  unavailableHouseholdClothStock: number;
  annualSpinnerIntermediateCapacity: number;
  annualWeaverWoolCapacity: number;
  annualWeaverClothCapacity: number;
  annualClothPotential: number;
  annualHouseholdClothDemand: number;
  annualClothBalance: number;
  woolCapacitySurplus: number;
  clothReserveRunwayDays: number;
  firstAttentionBuildingId: string | null;
  firstAttentionKind: TextileAttentionKind | null;
  roadPlan: SettlementTextileRoadPlan | null;
};

type TextileProduction = Pick<
  SettlementProductionCapacity,
  | 'clothWoolPerDay'
  | 'spinnerIntermediateCapacityPerDay'
  | 'weaverClothCapacityPerDay'
  | 'clothOutputPerDay'
  | 'clothDemandPerDay'
> & Partial<Pick<
  SettlementProductionCapacity,
  'tierTwoPlusResidents' | 'prosperityRoadBranches'
>>;

const ATTENTION_PRIORITY: Record<TextileAttentionKind, number> = {
  fire: 5,
  storage: 4,
  staffing: 3,
  flock: 2,
  'missed-window': 1,
};

function positive(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;
}

function earlierStableId(current: string | null, candidate: string): string {
  return current === null || compareStableEntityIds(candidate, current) < 0
    ? candidate
    : current;
}

function textileRoadBranch(
  branches: Map<string, SettlementTextileRoadBranch>,
  key: string,
  source?: ProsperityRoadBranch,
  annualDemandPerResident = 0,
): SettlementTextileRoadBranch {
  let branch = branches.get(key);
  if (branch) return branch;
  const annualSpinnerIntermediateCapacity =
    positive(source?.textileIntermediateOutputPerDay) * TEXTILE_PLAN_DAYS_PER_YEAR;
  const annualWeaverClothCapacity =
    positive(source?.clothOutputPerDay) * TEXTILE_PLAN_DAYS_PER_YEAR;
  branch = {
    sheepHoldings: 0,
    projectedAnnualWool: 0,
    flaxStock: 0,
    yarnStock: 0,
    linenStock: 0,
    securedAnnualWool: 0,
    annualSpinnerIntermediateCapacity,
    annualWeaverWoolCapacity: annualSpinnerIntermediateCapacity
      * SPINNING_RETTING_WOOL_PER_CYCLE
      / SPINNING_RETTING_YARN_PER_CYCLE,
    annualWeaverClothCapacity,
    annualClothPotential: 0,
    annualHouseholdClothDemand:
      positive(source?.tierTwoPlusResidents ?? source?.currentResidents)
      * annualDemandPerResident,
    coveredHouseholdClothDemand: 0,
    annualHouseholdClothShortfall: 0,
    annualExportableClothSurplus: 0,
    currentHouseholdClothDemandPerDay:
      positive(source?.tierTwoPlusResidents ?? source?.currentResidents)
      * annualDemandPerResident
      / TEXTILE_PLAN_DAYS_PER_YEAR,
    householdClothStock: 0,
    supplierClothStock: 0,
    householdClothInTransit: 0,
    serviceableClothStock: 0,
    currentClothRunwayDays: Number.POSITIVE_INFINITY,
    hasStockedSupplier: false,
    firstWoolBuildingId: null,
    firstFlaxBuildingId: null,
    firstSpinnerBuildingId: null,
    firstResidenceId: source?.firstClothResidenceId ?? source?.firstResidenceId ?? null,
  };
  branches.set(key, branch);
  return branch;
}

function createTextileRoadBranches(
  production: TextileProduction,
): Map<string, SettlementTextileRoadBranch> | null {
  if (production.prosperityRoadBranches == null) return null;
  const annualDemandPerResident = positive(production.tierTwoPlusResidents) > 1e-9
    ? positive(production.clothDemandPerDay)
      * TEXTILE_PLAN_DAYS_PER_YEAR
      / positive(production.tierTwoPlusResidents)
    : 0;
  const branches = new Map<string, SettlementTextileRoadBranch>();
  for (const [key, source] of production.prosperityRoadBranches) {
    textileRoadBranch(branches, key, source, annualDemandPerResident);
  }
  return branches;
}

function buildTextileRoadPlan(
  source: Map<string, SettlementTextileRoadBranch>,
  hypotheticalAnnualClothPotential: number,
): SettlementTextileRoadPlan {
  const branches = new Map<string, SettlementTextileRoadBranch>();
  let fleeceBranches = 0;
  let flaxBranches = 0;
  let spinnerBranches = 0;
  let loomBranches = 0;
  let matchedBranches = 0;
  let exposedHouseholdBranches = 0;
  let projectedAnnualWool = 0;
  let flaxStock = 0;
  let yarnStock = 0;
  let linenStock = 0;
  let roadMatchedAnnualClothPotential = 0;
  let annualHouseholdClothDemand = 0;
  let coveredHouseholdClothDemand = 0;
  let annualHouseholdClothShortfall = 0;
  let annualExportableClothSurplus = 0;
  let householdBranches = 0;
  let stockedSupplierBranches = 0;
  let unservedHouseholdBranches = 0;
  let reserveWarningBranches = 0;
  let serviceableClothStock = 0;
  let worstHouseholdClothRunwayDays = Number.POSITIVE_INFINITY;
  let firstReserveExposedResidenceId: string | null = null;
  let firstReserveExposureScore = Number.POSITIVE_INFINITY;
  let firstExposedResidenceId: string | null = null;
  let firstExposureCoverage = Number.POSITIVE_INFINITY;
  let firstExposureShortfall = 0;
  let firstImbalancedBuildingId: string | null = null;
  let firstImbalance = 0;

  for (const [key, branch] of source) {
    const intermediateFromRawFibre = (
      branch.projectedAnnualWool + branch.flaxStock
    )
      * SPINNING_RETTING_YARN_PER_CYCLE
      / SPINNING_RETTING_FLAX_PER_CYCLE;
    const spunIntermediate = Math.min(
      branch.annualSpinnerIntermediateCapacity,
      intermediateFromRawFibre,
    );
    const clothFromAvailableIntermediate = (
      branch.yarnStock + branch.linenStock + spunIntermediate
    )
      * WEAVER_CLOTH_PER_CYCLE
      / WEAVER_YARN_PER_CYCLE;
    branch.annualClothPotential = Math.min(
      branch.annualWeaverClothCapacity,
      clothFromAvailableIntermediate,
    );
    branch.coveredHouseholdClothDemand = Math.min(
      branch.annualClothPotential,
      branch.annualHouseholdClothDemand,
    );
    branch.annualHouseholdClothShortfall = Math.max(
      0,
      branch.annualHouseholdClothDemand - branch.coveredHouseholdClothDemand,
    );
    branch.annualExportableClothSurplus = Math.max(
      0,
      branch.annualClothPotential - branch.annualHouseholdClothDemand,
    );
    branch.serviceableClothStock = branch.householdClothStock
      + branch.supplierClothStock
      + branch.householdClothInTransit;
    branch.currentClothRunwayDays =
      branch.currentHouseholdClothDemandPerDay > 1e-9
        ? branch.serviceableClothStock
          / branch.currentHouseholdClothDemandPerDay
        : Number.POSITIVE_INFINITY;

    const relevant = branch.sheepHoldings > 0
      || branch.flaxStock > 1e-9
      || branch.yarnStock > 1e-9
      || branch.linenStock > 1e-9
      || branch.annualSpinnerIntermediateCapacity > 1e-9
      || branch.annualWeaverClothCapacity > 1e-9
      || branch.annualHouseholdClothDemand > 1e-9;
    if (!relevant) continue;
    branches.set(key, branch);
    projectedAnnualWool += branch.projectedAnnualWool;
    flaxStock += branch.flaxStock;
    yarnStock += branch.yarnStock;
    linenStock += branch.linenStock;
    roadMatchedAnnualClothPotential += branch.annualClothPotential;
    annualHouseholdClothDemand += branch.annualHouseholdClothDemand;
    coveredHouseholdClothDemand += branch.coveredHouseholdClothDemand;
    annualHouseholdClothShortfall += branch.annualHouseholdClothShortfall;
    annualExportableClothSurplus += branch.annualExportableClothSurplus;

    if (branch.currentHouseholdClothDemandPerDay > 1e-9) {
      householdBranches += 1;
      serviceableClothStock += branch.serviceableClothStock;
      worstHouseholdClothRunwayDays = Math.min(
        worstHouseholdClothRunwayDays,
        branch.currentClothRunwayDays,
      );
      if (branch.hasStockedSupplier) {
        stockedSupplierBranches += 1;
      } else {
        unservedHouseholdBranches += 1;
      }
      const reserveWarning =
        branch.currentClothRunwayDays < TEXTILE_RESERVE_WARNING_DAYS;
      if (reserveWarning) reserveWarningBranches += 1;
      const reserveExposed = reserveWarning || !branch.hasStockedSupplier;
      const reserveExposureScore = reserveExposed
        ? Math.min(
            branch.currentClothRunwayDays / TEXTILE_RESERVE_WARNING_DAYS,
            branch.hasStockedSupplier ? Number.POSITIVE_INFINITY : 1,
          )
        : Number.POSITIVE_INFINITY;
      const candidateId = branch.firstResidenceId;
      if (
        candidateId !== null
        && (
          reserveExposureScore < firstReserveExposureScore - 1e-9
          || (
            Math.abs(
              reserveExposureScore - firstReserveExposureScore,
            ) <= 1e-9
            && (
              firstReserveExposedResidenceId === null
              || compareStableEntityIds(
                candidateId,
                firstReserveExposedResidenceId,
              ) < 0
            )
          )
        )
      ) {
        firstReserveExposureScore = reserveExposureScore;
        firstReserveExposedResidenceId = candidateId;
      }
    }

    if (branch.projectedAnnualWool > 1e-9) fleeceBranches += 1;
    if (branch.flaxStock > 1e-9) flaxBranches += 1;
    if (branch.annualSpinnerIntermediateCapacity > 1e-9) spinnerBranches += 1;
    if (branch.annualWeaverClothCapacity > 1e-9) loomBranches += 1;
    if (
      (
        (
          branch.annualSpinnerIntermediateCapacity > 1e-9
          && (branch.projectedAnnualWool > 1e-9 || branch.flaxStock > 1e-9)
        )
        || branch.yarnStock > 1e-9
        || branch.linenStock > 1e-9
      )
      && branch.annualWeaverClothCapacity > 1e-9
    ) {
      matchedBranches += 1;
    }

    if (branch.annualHouseholdClothShortfall > 0.05) {
      exposedHouseholdBranches += 1;
      const coverage = branch.annualHouseholdClothDemand > 1e-9
        ? branch.coveredHouseholdClothDemand
          / branch.annualHouseholdClothDemand
        : 1;
      const candidateId = branch.firstResidenceId;
      if (
        candidateId !== null
        && (
          coverage < firstExposureCoverage - 1e-9
          || (
            Math.abs(coverage - firstExposureCoverage) <= 1e-9
            && (
              branch.annualHouseholdClothShortfall > firstExposureShortfall + 1e-9
              || (
                Math.abs(
                  branch.annualHouseholdClothShortfall - firstExposureShortfall,
                ) <= 1e-9
                && (
                  firstExposedResidenceId === null
                  || compareStableEntityIds(
                    candidateId,
                    firstExposedResidenceId,
                  ) < 0
                )
              )
            )
          )
        )
      ) {
        firstExposureCoverage = coverage;
        firstExposureShortfall = branch.annualHouseholdClothShortfall;
        firstExposedResidenceId = candidateId;
      }
    }

    const strandedClipPotential = Math.max(
      0,
      clothFromAvailableIntermediate - branch.annualClothPotential,
    );
    if (
      (branch.firstWoolBuildingId !== null || branch.firstFlaxBuildingId !== null)
      && (
        strandedClipPotential > firstImbalance + 1e-9
        || (
          Math.abs(strandedClipPotential - firstImbalance) <= 1e-9
          && strandedClipPotential > 0.05
          && (
            firstImbalancedBuildingId === null
            || compareStableEntityIds(
              branch.firstWoolBuildingId ?? branch.firstFlaxBuildingId!,
              firstImbalancedBuildingId,
            ) < 0
          )
        )
      )
    ) {
      firstImbalance = strandedClipPotential;
      firstImbalancedBuildingId =
        branch.firstWoolBuildingId ?? branch.firstFlaxBuildingId;
    }
  }

  return {
    activeBranches: branches.size,
    fleeceBranches,
    flaxBranches,
    spinnerBranches,
    loomBranches,
    matchedBranches,
    exposedHouseholdBranches,
    projectedAnnualWool,
    flaxStock,
    yarnStock,
    linenStock,
    roadMatchedAnnualClothPotential,
    fragmentationClothPotential: Math.max(
      0,
      hypotheticalAnnualClothPotential - roadMatchedAnnualClothPotential,
    ),
    annualHouseholdClothDemand,
    coveredHouseholdClothDemand,
    annualHouseholdClothShortfall,
    annualExportableClothSurplus,
    householdBranches,
    stockedSupplierBranches,
    unservedHouseholdBranches,
    reserveWarningBranches,
    serviceableClothStock,
    worstHouseholdClothRunwayDays,
    firstReserveExposedResidenceId,
    firstExposedResidenceId,
    firstImbalancedBuildingId,
    branches,
  };
}

function shouldReplaceAttention(
  kind: TextileAttentionKind,
  buildingId: string,
  currentKind: TextileAttentionKind | null,
  currentBuildingId: string | null,
): boolean {
  if (currentKind === null || currentBuildingId === null) return true;
  if (ATTENTION_PRIORITY[kind] !== ATTENTION_PRIORITY[currentKind]) {
    return ATTENTION_PRIORITY[kind] > ATTENTION_PRIORITY[currentKind];
  }
  return compareStableEntityIds(buildingId, currentBuildingId) < 0;
}

/**
 * Annualized sheep-to-cloth plan using current flock condition, staffing, and
 * installed weaving labor. Current physical stores are reported separately so
 * already-woven cloth is never counted again as prospective annual output.
 */
export function computeSettlementTextilePlan(input: {
  state: Pick<
    GameState,
    'stockpile' | 'buildings' | 'livestockHerds' | 'residences' | 'deliveryTrips'
  > & Partial<Pick<GameState, 'fireIncidents' | 'physicalFoundingSiteEnabled'>>;
  clock: Pick<GameClock, 'month' | 'year'>;
  production: TextileProduction;
  roadComponentFor?: ProductionRoadComponentResolver;
}): SettlementTextilePlan {
  let sheepHoldings = 0;
  let staffedSheepHoldings = 0;
  let fireDisabledSheepHoldings = 0;
  let sheepHeadCount = 0;
  let productiveSheepHeads = 0;
  let shornHoldings = 0;
  let pendingHoldings = 0;
  let readyPendingHoldings = 0;
  let storageBlockedHoldings = 0;
  let staffingBlockedHoldings = 0;
  let flockBlockedHoldings = 0;
  let missedHoldings = 0;
  let projectedAnnualWool = 0;
  let securedAnnualWool = 0;
  let firstAttentionBuildingId: string | null = null;
  let firstAttentionKind: TextileAttentionKind | null = null;
  const roadBranches = input.roadComponentFor
    ? createTextileRoadBranches(input.production)
    : null;
  const fireDisabledBuildings = fireDisabledBuildingIds(
    input.state.fireIncidents?.values() ?? [],
  );
  const fireDisabledResidences = fireDisabledResidenceIds(
    input.state.fireIncidents?.values() ?? [],
  );

  const recordAttention = (kind: TextileAttentionKind, buildingId: string): void => {
    if (
      shouldReplaceAttention(
        kind,
        buildingId,
        firstAttentionKind,
        firstAttentionBuildingId,
      )
    ) {
      firstAttentionKind = kind;
      firstAttentionBuildingId = buildingId;
    }
  };

  for (const herd of input.state.livestockHerds.values()) {
    if (herd.species !== 'sheep') continue;
    const building = input.state.buildings.get(herd.buildingId);
    if (
      !building
      || building.kind !== 'pastoral_farmstead'
      || building.constructionComplete === false
    ) {
      continue;
    }

    const roadBranch = roadBranches && input.roadComponentFor
      ? textileRoadBranch(
          roadBranches,
          productionRoadBranchKey(
            input.roadComponentFor(building),
            'building',
            building.id,
          ),
        )
      : null;
    sheepHoldings += 1;
    if (roadBranch) {
      roadBranch.sheepHoldings += 1;
      roadBranch.firstWoolBuildingId = earlierStableId(
        roadBranch.firstWoolBuildingId,
        building.id,
      );
    }
    sheepHeadCount += Math.max(0, herd.headCount);
    const projectedFleece = projectedSheepFleece(herd);
    productiveSheepHeads += projectedFleece
      / Math.max(1e-9, SHEEP_WOOL_PER_SHEARING_PER_HEAD);
    const shornThisYear = (herd.lastShearingYear ?? 0) === input.clock.year;
    if (fireDisabledBuildings.has(building.id)) {
      const blockedAnnualWool = shornThisYear
        ? positive(herd.lastWoolOutput)
        : projectedFleece;
      fireDisabledSheepHoldings += 1;
      projectedAnnualWool += blockedAnnualWool;
      if (roadBranch) roadBranch.projectedAnnualWool += blockedAnnualWool;
      if (shornThisYear) {
        shornHoldings += 1;
      } else if (input.clock.month > SHEEP_SHEARING_END_MONTH) {
        missedHoldings += 1;
      } else {
        pendingHoldings += 1;
      }
      recordAttention('fire', building.id);
      continue;
    }
    if (building.assignedLabor > 0) staffedSheepHoldings += 1;

    if (shornThisYear) {
      const storedClip = positive(herd.lastWoolOutput);
      shornHoldings += 1;
      projectedAnnualWool += storedClip;
      securedAnnualWool += storedClip;
      if (roadBranch) {
        roadBranch.projectedAnnualWool += storedClip;
        roadBranch.securedAnnualWool += storedClip;
      }
      continue;
    }

    projectedAnnualWool += projectedFleece;
    if (roadBranch) roadBranch.projectedAnnualWool += projectedFleece;
    if (input.clock.month > SHEEP_SHEARING_END_MONTH) {
      missedHoldings += 1;
      recordAttention('missed-window', building.id);
      continue;
    }

    pendingHoldings += 1;
    const woolCapacity = BUILDING_STORAGE_CAPS.pastoral_farmstead.wool ?? 0;
    const woolRoom = Math.max(0, woolCapacity - positive(building.wool));
    if (building.assignedLabor <= 0) {
      staffingBlockedHoldings += 1;
      recordAttention('staffing', building.id);
    } else if (projectedFleece <= 1e-6) {
      flockBlockedHoldings += 1;
      recordAttention('flock', building.id);
    } else if (!canStoreFullSheepClip(projectedFleece, woolRoom)) {
      storageBlockedHoldings += 1;
      recordAttention('storage', building.id);
    } else {
      readyPendingHoldings += 1;
      securedAnnualWool += projectedFleece;
      if (roadBranch) roadBranch.securedAnnualWool += projectedFleece;
    }
  }

  const includeLegacyLedger = input.state.physicalFoundingSiteEnabled !== true;
  let woolStock = includeLegacyLedger ? positive(input.state.stockpile.wool) : 0;
  let flaxStock = includeLegacyLedger ? positive(input.state.stockpile.flax) : 0;
  let yarnStock = includeLegacyLedger ? positive(input.state.stockpile.yarn) : 0;
  let linenStock = includeLegacyLedger ? positive(input.state.stockpile.linen) : 0;
  let clothStock = includeLegacyLedger ? positive(input.state.stockpile.cloth) : 0;
  let householdClothStock = 0;
  let supplierClothStock = 0;
  let householdClothInTransit = 0;
  let fireDisabledSpinners = 0;
  let fireDisabledWeavers = 0;
  let fireDisabledProsperousHomes = 0;
  let fireQuarantinedClothStock = 0;
  for (const building of input.state.buildings.values()) {
    woolStock += positive(building.wool);
    const buildingFlax = positive(building.flax);
    flaxStock += buildingFlax;
    const buildingYarn = positive(building.yarn);
    const buildingLinen = positive(building.linen);
    yarnStock += buildingYarn;
    linenStock += buildingLinen;
    if (
      buildingFlax > 1e-9
      && !fireDisabledBuildings.has(building.id)
      && roadBranches
      && input.roadComponentFor
    ) {
      const branch = textileRoadBranch(
        roadBranches,
        productionRoadBranchKey(
          input.roadComponentFor(building),
          'building',
          building.id,
        ),
      );
      branch.flaxStock += buildingFlax;
      branch.firstFlaxBuildingId = earlierStableId(
        branch.firstFlaxBuildingId,
        building.id,
      );
    }
    if (
      (buildingYarn > 1e-9 || buildingLinen > 1e-9)
      && !fireDisabledBuildings.has(building.id)
      && roadBranches
      && input.roadComponentFor
    ) {
      const branch = textileRoadBranch(
        roadBranches,
        productionRoadBranchKey(
          input.roadComponentFor(building),
          'building',
          building.id,
        ),
      );
      branch.yarnStock += buildingYarn;
      branch.linenStock += buildingLinen;
    }
    if (
      building.kind === 'spinning_retting_house'
      && building.constructionComplete !== false
      && building.assignedLabor > 0
    ) {
      if (fireDisabledBuildings.has(building.id)) {
        fireDisabledSpinners += 1;
      } else if (roadBranches && input.roadComponentFor) {
        const branch = textileRoadBranch(
          roadBranches,
          productionRoadBranchKey(
            input.roadComponentFor(building),
            'building',
            building.id,
          ),
        );
        branch.firstSpinnerBuildingId = earlierStableId(
          branch.firstSpinnerBuildingId,
          building.id,
        );
      }
    }
    const buildingCloth = positive(building.cloth);
    clothStock += buildingCloth;
    if (
      building.kind === 'weaver'
      && building.constructionComplete !== false
      && building.assignedLabor > 0
    ) {
      if (fireDisabledBuildings.has(building.id)) {
        fireDisabledWeavers += 1;
        fireQuarantinedClothStock += buildingCloth;
        continue;
      }
      supplierClothStock += buildingCloth;
      if (roadBranches && input.roadComponentFor) {
        const branch = textileRoadBranch(
          roadBranches,
          productionRoadBranchKey(
            input.roadComponentFor(building),
            'building',
            building.id,
          ),
        );
        branch.supplierClothStock += buildingCloth;
        if (buildingCloth > 1e-9) branch.hasStockedSupplier = true;
      }
    }
  }
  for (const residence of input.state.residences.values()) {
    const residenceCloth = positive(getNeedStock(residence.needs, 'cloth'));
    clothStock += residenceCloth;
    if (!residence.abandoned && residence.population > 0 && residence.tier >= 2) {
      if (fireDisabledResidences.has(residence.id)) {
        fireDisabledProsperousHomes += 1;
        fireQuarantinedClothStock += residenceCloth;
        continue;
      }
      householdClothStock += residenceCloth;
      if (roadBranches && input.roadComponentFor) {
        const branch = textileRoadBranch(
          roadBranches,
          productionRoadBranchKey(
            input.roadComponentFor(residence),
            'residence',
            residence.id,
          ),
        );
        branch.householdClothStock += residenceCloth;
        branch.firstResidenceId = earlierStableId(
          branch.firstResidenceId,
          residence.id,
        );
      }
    }
  }

  let woolInTransit = 0;
  let flaxInTransit = 0;
  let yarnInTransit = 0;
  let linenInTransit = 0;
  let clothInTransit = 0;
  for (const trip of input.state.deliveryTrips.values()) {
    if (trip.phase === 'inbound') continue;
    if (trip.cargoKind === 'wool') woolInTransit += positive(trip.amount);
    if (trip.cargoKind === 'flax') flaxInTransit += positive(trip.amount);
    if (trip.cargoKind === 'yarn' || trip.cargoKind === 'linen') {
      const intermediate = positive(trip.amount);
      if (trip.cargoKind === 'yarn') yarnInTransit += intermediate;
      else linenInTransit += intermediate;
      const target = trip.destinationKind === 'building'
        && trip.targetBuildingId !== null
        ? input.state.buildings.get(trip.targetBuildingId)
        : undefined;
      if (
        target
        && !fireDisabledBuildings.has(target.id)
        && roadBranches
        && input.roadComponentFor
      ) {
        const branch = textileRoadBranch(
          roadBranches,
          productionRoadBranchKey(
            input.roadComponentFor(target),
            'building',
            target.id,
          ),
        );
        if (trip.cargoKind === 'yarn') branch.yarnStock += intermediate;
        else branch.linenStock += intermediate;
      }
    }
    if (trip.cargoKind === 'cloth') {
      const tripCloth = positive(trip.amount);
      clothInTransit += tripCloth;
      const residence = trip.destinationKind === 'residence'
        && trip.residenceId !== null
        ? input.state.residences.get(trip.residenceId)
        : undefined;
      if (
        residence
        && !residence.abandoned
        && residence.population > 0
        && residence.tier >= 2
      ) {
        if (fireDisabledResidences.has(residence.id)) {
          fireQuarantinedClothStock += tripCloth;
          continue;
        }
        householdClothInTransit += tripCloth;
        if (roadBranches && input.roadComponentFor) {
          const branch = textileRoadBranch(
            roadBranches,
            productionRoadBranchKey(
              input.roadComponentFor(residence),
              'residence',
              residence.id,
            ),
          );
          branch.householdClothInTransit += tripCloth;
          branch.firstResidenceId = earlierStableId(
            branch.firstResidenceId,
            residence.id,
          );
        }
      }
    }
  }
  woolStock += woolInTransit;
  flaxStock += flaxInTransit;
  yarnStock += yarnInTransit;
  linenStock += linenInTransit;
  clothStock += clothInTransit;

  const annualSpinnerIntermediateCapacity =
    positive(input.production.spinnerIntermediateCapacityPerDay)
    * TEXTILE_PLAN_DAYS_PER_YEAR;
  const annualWeaverWoolCapacity = annualSpinnerIntermediateCapacity
    * SPINNING_RETTING_WOOL_PER_CYCLE
    / SPINNING_RETTING_YARN_PER_CYCLE;
  const annualWeaverClothCapacity =
    positive(input.production.weaverClothCapacityPerDay)
    * TEXTILE_PLAN_DAYS_PER_YEAR;
  const intermediateFromRawFibre = (projectedAnnualWool + flaxStock)
    * SPINNING_RETTING_YARN_PER_CYCLE
    / SPINNING_RETTING_FLAX_PER_CYCLE;
  const spunIntermediate = Math.min(
    annualSpinnerIntermediateCapacity,
    intermediateFromRawFibre,
  );
  const clothFromAvailableIntermediate = (
    yarnStock + linenStock + spunIntermediate
  )
    * WEAVER_CLOTH_PER_CYCLE
    / WEAVER_YARN_PER_CYCLE;
  const annualClothPotential = Math.min(
    annualWeaverClothCapacity,
    clothFromAvailableIntermediate,
  );
  const annualHouseholdClothDemand =
    positive(input.production.clothDemandPerDay) * TEXTILE_PLAN_DAYS_PER_YEAR;
  const roadPlan = roadBranches === null
    ? null
    : buildTextileRoadPlan(roadBranches, annualClothPotential);
  const aggregateServiceableHouseholdClothStock = householdClothStock
    + supplierClothStock
    + householdClothInTransit;
  const serviceableHouseholdClothStock = roadPlan === null
    ? aggregateServiceableHouseholdClothStock
    : roadPlan.serviceableClothStock;
  const clothReserveRunwayDays = roadPlan !== null
    && roadPlan.householdBranches > 0
    ? roadPlan.worstHouseholdClothRunwayDays
    : input.production.clothDemandPerDay > 1e-9
      ? serviceableHouseholdClothStock / input.production.clothDemandPerDay
      : Number.POSITIVE_INFINITY;

  return {
    sheepHoldings,
    staffedSheepHoldings,
    fireDisabledSheepHoldings,
    sheepHeadCount,
    productiveSheepHeads,
    shornHoldings,
    pendingHoldings,
    readyPendingHoldings,
    storageBlockedHoldings,
    staffingBlockedHoldings,
    flockBlockedHoldings,
    missedHoldings,
    projectedAnnualWool,
    securedAnnualWool,
    annualWoolAtRisk: Math.max(0, projectedAnnualWool - securedAnnualWool),
    woolStock,
    woolInTransit,
    flaxStock,
    flaxInTransit,
    yarnStock,
    yarnInTransit,
    linenStock,
    linenInTransit,
    clothStock,
    clothInTransit,
    householdClothStock,
    supplierClothStock,
    householdClothInTransit,
    fireDisabledSpinners,
    fireDisabledWeavers,
    fireDisabledProsperousHomes,
    fireQuarantinedClothStock,
    serviceableHouseholdClothStock,
    unavailableHouseholdClothStock: Math.max(
      0,
      clothStock - serviceableHouseholdClothStock,
    ),
    annualSpinnerIntermediateCapacity,
    annualWeaverWoolCapacity,
    annualWeaverClothCapacity,
    annualClothPotential,
    annualHouseholdClothDemand,
    annualClothBalance: annualClothPotential - annualHouseholdClothDemand,
    woolCapacitySurplus: Math.max(
      0,
      projectedAnnualWool + flaxStock - annualWeaverWoolCapacity,
    ),
    clothReserveRunwayDays,
    firstAttentionBuildingId,
    firstAttentionKind,
    roadPlan,
  };
}

export function textileChainBalanceLabel(plan: SettlementTextilePlan): string {
  const rawFibre = plan.projectedAnnualWool + plan.flaxStock;
  const readyIntermediate = plan.yarnStock + plan.linenStock;
  if (rawFibre <= 1e-9 && readyIntermediate <= 1e-9) {
    return plan.annualHouseholdClothDemand <= 1e-9
      ? 'No prosperous-house demand or raw textile supply'
      : 'Raw fibre missing · raise sheep or secure a flax harvest';
  }
  if (plan.annualSpinnerIntermediateCapacity <= 1e-9 && readyIntermediate <= 1e-9) {
    return 'Fibre processing missing · build and staff a Spinning & Retting House';
  }
  if (plan.annualWeaverClothCapacity <= 1e-9) {
    return 'Weaving missing · yarn and linen cannot become clothing';
  }
  if (
    plan.roadPlan !== null
    && plan.roadPlan.fragmentationClothPotential > 0.05
  ) {
    return plan.roadPlan.annualHouseholdClothShortfall > 0.05
      ? 'Road-limited · connect raw fibre, spinning, weaving, and prosperous homes'
      : 'Split textile chain · connect fibre processors and Weaver branches before export';
  }
  if (plan.annualHouseholdClothDemand <= 1e-9) {
    return 'No prosperous-house demand · annual clothing can be exported';
  }
  if (plan.woolCapacitySurplus > 0.05) {
    return 'Spinning-limited · add fibre-processing labor before more sheep or flax';
  }
  if (
    plan.annualSpinnerIntermediateCapacity + readyIntermediate
    > plan.annualWeaverClothCapacity + 0.05
  ) {
    return 'Weaving-limited · add Weaver labor to use available yarn and linen';
  }
  if (plan.annualClothBalance < -0.05) {
    return 'Raw-fibre-limited · household demand exceeds secured wool and flax';
  }
  return 'Household clothing covered · remaining clothing can be exported';
}
