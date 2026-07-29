import {
  CALENDAR_HOURS_PER_DAY,
  CALENDAR_SECONDS_PER_DAY,
  CALENDAR_WORK_END_HOUR,
  CALENDAR_WORK_START_HOUR,
  RESIDENCE_FOOD_PER_PERSON_PER_SEC,
  SMOKEHOUSE_FIREWOOD_PER_CYCLE,
  SMOKEHOUSE_FOOD_PER_CYCLE,
  SMOKEHOUSE_POTTERY_PER_CYCLE,
  SMOKEHOUSE_PRESERVED_FOOD_PER_CYCLE,
  SMOKEHOUSE_SALT_PER_CYCLE,
} from '../generated/gameBalance.ts';
import { fireDisabledBuildingIds, fireDisabledResidenceIds } from '../fires/fireIncident.ts';
import type { DeliveryTripState } from '../logistics/deliveryTrips.ts';
import { compareStableEntityIds } from '../logistics/roadLogistics.ts';
import { getNeedStock } from '../residences/residenceNeedState.ts';
import { getBuildingDefinition } from '../resources/buildings.ts';
import type { BuildingState, GameState, ResidenceState } from '../resources/types.ts';
import {
  productionRoadBranchKey,
  type ProductionRoadComponentResolver,
} from './settlementProduction.ts';
import { MARKETPLACE_SALT_IMPORT_LOT } from './marketplaceMaterialProcurementPolicy.ts';

/**
 * A month of substitute provisions is demanding enough to make autumn
 * stockpiling matter without pretending every prosperous household can store
 * an entire winter indoors.
 */
export const PRESERVATION_RESERVE_DAYS = 30;

const WORKDAY_SECONDS = CALENDAR_SECONDS_PER_DAY
  * (CALENDAR_WORK_END_HOUR - CALENDAR_WORK_START_HOUR)
  / CALENDAR_HOURS_PER_DAY;

export type PreservationReserveBranch = {
  key: string;
  residents: number;
  fallbackDemandPerDay: number;
  targetStock: number;
  preservedStock: number;
  preservedInTransit: number;
  projectedStock: number;
  shortfall: number;
  coverageDays: number;
  smokehouseOutputPerDay: number;
  productionDaysToTarget: number;
  freshFoodRequired: number;
  firewoodRequired: number;
  saltRequired: number;
  potteryRequired: number;
  saltStock: number;
  saltInTransit: number;
  potteryStock: number;
  potteryInTransit: number;
  saltImportLots: number;
  saltImportShortfall: number;
  potteryShortfall: number;
  staffedSmokehouses: number;
  staffedMarkets: number;
  standingSaltMarkets: number;
  selectedSaltTarget: number;
  firstResidenceId: string | null;
  firstSmokehouseId: string | null;
  firstMarketId: string | null;
};

export type SettlementPreservationReservePlan = {
  targetDays: number;
  tierThreeResidents: number;
  targetBranches: number;
  preparedBranches: number;
  shortBranches: number;
  branchesWithoutSmokehouse: number;
  branchesWithoutStandingSalt: number;
  targetStock: number;
  roadMatchedStock: number;
  roadMatchedShortfall: number;
  preservedStock: number;
  preservedInTransit: number;
  quarantinedPreservedStock: number;
  unmatchedPreservedStock: number;
  fallbackDemandPerDay: number;
  smokehouseOutputPerDay: number;
  productionDaysToTarget: number;
  freshFoodRequired: number;
  firewoodRequired: number;
  saltRequired: number;
  potteryRequired: number;
  saltStock: number;
  saltInTransit: number;
  potteryStock: number;
  potteryInTransit: number;
  saltImportLots: number;
  saltImportShortfall: number;
  potteryShortfall: number;
  staffedSmokehouses: number;
  staffedMarkets: number;
  standingSaltMarkets: number;
  selectedSaltTarget: number;
  firstExposedResidenceId: string | null;
  firstAttentionBuildingId: string | null;
  firstSaltMarketId: string | null;
  branches: ReadonlyMap<string, PreservationReserveBranch>;
};

export type SettlementPreservationReserveOptions = {
  sabbathObserved: boolean;
  roadComponentFor?: ProductionRoadComponentResolver;
  targetDays?: number;
};

type MutableBranch = Omit<
  PreservationReserveBranch,
  | 'targetStock'
  | 'projectedStock'
  | 'shortfall'
  | 'coverageDays'
  | 'productionDaysToTarget'
  | 'freshFoodRequired'
  | 'firewoodRequired'
  | 'saltRequired'
  | 'potteryRequired'
  | 'saltImportLots'
  | 'saltImportShortfall'
  | 'potteryShortfall'
> & {
  targetStock: number;
  projectedStock: number;
  shortfall: number;
  coverageDays: number;
  productionDaysToTarget: number;
  freshFoodRequired: number;
  firewoodRequired: number;
  saltRequired: number;
  potteryRequired: number;
  saltImportLots: number;
  saltImportShortfall: number;
  potteryShortfall: number;
};

export function computeSettlementPreservationReservePlan(
  state: GameState,
  options: SettlementPreservationReserveOptions,
): SettlementPreservationReservePlan {
  const targetDays = finitePositive(options.targetDays, PRESERVATION_RESERVE_DAYS);
  const fireDisabledBuildings = fireDisabledBuildingIds(state.fireIncidents.values());
  const fireDisabledResidences = fireDisabledResidenceIds(state.fireIncidents.values());
  const branches = new Map<string, MutableBranch>();
  let quarantinedPreservedStock = 0;

  const branchFor = (
    entity: Pick<BuildingState | ResidenceState, 'id' | 'x' | 'z'>,
    entityKind: 'building' | 'residence',
  ): MutableBranch => {
    const key = productionRoadBranchKey(
      options.roadComponentFor?.(entity) ?? null,
      entityKind,
      entity.id,
    );
    let branch = branches.get(key);
    if (!branch) {
      branch = emptyBranch(key);
      branches.set(key, branch);
    }
    return branch;
  };

  for (const building of state.buildings.values()) {
    const preserved = finiteStock(building.preservedFood);
    if (fireDisabledBuildings.has(building.id)) {
      quarantinedPreservedStock += preserved;
      continue;
    }
    if (building.constructionComplete === false) {
      continue;
    }
    const branch = branchFor(building, 'building');
    branch.preservedStock += preserved;
    branch.saltStock += finiteStock(building.salt);
    branch.potteryStock += finiteStock(building.pottery);

    if (building.assignedLabor <= 0) continue;
    if (building.kind === 'smokehouse') {
      const cycles = cyclesPerCalendarDay(
        building,
        options.sabbathObserved,
      );
      branch.smokehouseOutputPerDay += cycles
        * SMOKEHOUSE_PRESERVED_FOOD_PER_CYCLE;
      branch.staffedSmokehouses += 1;
      branch.firstSmokehouseId = earlierStableId(
        branch.firstSmokehouseId,
        building.id,
      );
    } else if (building.kind === 'marketplace') {
      const selectedTarget = finiteStock(building.marketplaceSaltTarget);
      branch.staffedMarkets += 1;
      branch.selectedSaltTarget += selectedTarget;
      if (selectedTarget > 1e-9) branch.standingSaltMarkets += 1;
      branch.firstMarketId = earlierStableId(branch.firstMarketId, building.id);
    }
  }

  for (const residence of state.residences.values()) {
    const preserved = finiteStock(getNeedStock(residence.needs, 'preservedFood'));
    if (fireDisabledResidences.has(residence.id)) {
      quarantinedPreservedStock += preserved;
      continue;
    }
    const branch = branchFor(residence, 'residence');
    branch.preservedStock += preserved;
    if (
      residence.abandoned
      || residence.tier < 3
      || residence.population <= 0
    ) {
      continue;
    }
    const residents = Math.max(0, residence.population);
    branch.residents += residents;
    branch.fallbackDemandPerDay += residents
      * RESIDENCE_FOOD_PER_PERSON_PER_SEC
      * WORKDAY_SECONDS;
    branch.firstResidenceId = earlierStableId(
      branch.firstResidenceId,
      residence.id,
    );
  }

  for (const trip of state.deliveryTrips.values()) {
    if (
      trip.cargoKind !== 'preservedFood'
      && trip.cargoKind !== 'salt'
      && trip.cargoKind !== 'pottery'
    ) {
      continue;
    }
    const amount = finiteStock(trip.amount);
    if (amount <= 1e-9) continue;
    const branch = deliveryBranch(
      trip,
      state,
      branchFor,
    );
    if (!branch) continue;
    if (trip.cargoKind === 'preservedFood') {
      branch.preservedInTransit += amount;
    } else if (trip.cargoKind === 'salt') {
      branch.saltInTransit += amount;
    } else {
      branch.potteryInTransit += amount;
    }
  }

  if (
    state.physicalFoundingSiteEnabled !== true
    && finiteStock(state.stockpile.preservedFood) > 1e-9
  ) {
    const key = 'legacy:treasury';
    const branch = branches.get(key) ?? emptyBranch(key);
    branch.preservedStock += finiteStock(state.stockpile.preservedFood);
    branches.set(key, branch);
  }

  let tierThreeResidents = 0;
  let targetBranches = 0;
  let preparedBranches = 0;
  let shortBranches = 0;
  let branchesWithoutSmokehouse = 0;
  let branchesWithoutStandingSalt = 0;
  let targetStock = 0;
  let roadMatchedStock = 0;
  let preservedStock = 0;
  let preservedInTransit = 0;
  let fallbackDemandPerDay = 0;
  let smokehouseOutputPerDay = 0;
  let productionDaysToTarget = 0;
  let freshFoodRequired = 0;
  let firewoodRequired = 0;
  let saltRequired = 0;
  let potteryRequired = 0;
  let saltStock = 0;
  let saltInTransit = 0;
  let potteryStock = 0;
  let potteryInTransit = 0;
  let saltImportLots = 0;
  let saltImportShortfall = 0;
  let potteryShortfall = 0;
  let staffedSmokehouses = 0;
  let staffedMarkets = 0;
  let standingSaltMarkets = 0;
  let selectedSaltTarget = 0;
  let firstExposedResidenceId: string | null = null;
  let firstAttentionBuildingId: string | null = null;
  let firstSaltMarketId: string | null = null;
  let weakestCoverage = Number.POSITIVE_INFINITY;

  const finalizedBranches = new Map<string, PreservationReserveBranch>();
  for (const [key, branch] of branches) {
    branch.targetStock = branch.fallbackDemandPerDay * targetDays;
    branch.projectedStock = branch.preservedStock + branch.preservedInTransit;
    branch.shortfall = Math.max(0, branch.targetStock - branch.projectedStock);
    branch.coverageDays = branch.fallbackDemandPerDay > 1e-9
      ? branch.projectedStock / branch.fallbackDemandPerDay
      : Number.POSITIVE_INFINITY;
    branch.productionDaysToTarget = branch.shortfall <= 1e-9
      ? 0
      : branch.smokehouseOutputPerDay > 1e-9
        ? branch.shortfall / branch.smokehouseOutputPerDay
        : Number.POSITIVE_INFINITY;

    const cyclesRequired = branch.shortfall
      / SMOKEHOUSE_PRESERVED_FOOD_PER_CYCLE;
    branch.freshFoodRequired = cyclesRequired * SMOKEHOUSE_FOOD_PER_CYCLE;
    branch.firewoodRequired = cyclesRequired * SMOKEHOUSE_FIREWOOD_PER_CYCLE;
    branch.saltRequired = cyclesRequired * SMOKEHOUSE_SALT_PER_CYCLE;
    branch.potteryRequired = cyclesRequired * SMOKEHOUSE_POTTERY_PER_CYCLE;
    const availableSalt = branch.saltStock + branch.saltInTransit;
    const availablePottery = branch.potteryStock + branch.potteryInTransit;
    branch.saltImportShortfall = Math.max(0, branch.saltRequired - availableSalt);
    branch.potteryShortfall = Math.max(0, branch.potteryRequired - availablePottery);
    branch.saltImportLots = branch.saltImportShortfall > 1e-9
      ? Math.ceil(branch.saltImportShortfall / MARKETPLACE_SALT_IMPORT_LOT)
      : 0;

    tierThreeResidents += branch.residents;
    targetStock += branch.targetStock;
    roadMatchedStock += Math.min(branch.targetStock, branch.projectedStock);
    preservedStock += branch.preservedStock;
    preservedInTransit += branch.preservedInTransit;
    fallbackDemandPerDay += branch.fallbackDemandPerDay;
    smokehouseOutputPerDay += branch.smokehouseOutputPerDay;
    freshFoodRequired += branch.freshFoodRequired;
    firewoodRequired += branch.firewoodRequired;
    saltRequired += branch.saltRequired;
    potteryRequired += branch.potteryRequired;
    saltStock += branch.saltStock;
    saltInTransit += branch.saltInTransit;
    potteryStock += branch.potteryStock;
    potteryInTransit += branch.potteryInTransit;
    saltImportLots += branch.saltImportLots;
    saltImportShortfall += branch.saltImportShortfall;
    potteryShortfall += branch.potteryShortfall;
    staffedSmokehouses += branch.staffedSmokehouses;
    staffedMarkets += branch.staffedMarkets;
    standingSaltMarkets += branch.standingSaltMarkets;
    selectedSaltTarget += branch.selectedSaltTarget;

    if (branch.targetStock > 1e-9) {
      targetBranches += 1;
      if (branch.shortfall <= 1e-9) {
        preparedBranches += 1;
      } else {
        shortBranches += 1;
        if (branch.smokehouseOutputPerDay <= 1e-9) {
          branchesWithoutSmokehouse += 1;
        }
        if (
          branch.saltImportShortfall > 1e-9
          && branch.standingSaltMarkets === 0
        ) {
          branchesWithoutStandingSalt += 1;
        }
        if (
          branch.coverageDays < weakestCoverage - 1e-9
          || (
            Math.abs(branch.coverageDays - weakestCoverage) <= 1e-9
            && branch.firstResidenceId !== null
            && (
              firstExposedResidenceId === null
              || compareStableEntityIds(
                branch.firstResidenceId,
                firstExposedResidenceId,
              ) < 0
            )
          )
        ) {
          weakestCoverage = branch.coverageDays;
          firstExposedResidenceId = branch.firstResidenceId;
          firstAttentionBuildingId = branch.firstSmokehouseId
            ?? branch.firstMarketId;
          firstSaltMarketId = branch.firstMarketId;
        }
      }
      productionDaysToTarget = Math.max(
        productionDaysToTarget,
        branch.productionDaysToTarget,
      );
    }

    finalizedBranches.set(key, { ...branch });
  }

  const roadMatchedShortfall = Math.max(0, targetStock - roadMatchedStock);
  return {
    targetDays,
    tierThreeResidents,
    targetBranches,
    preparedBranches,
    shortBranches,
    branchesWithoutSmokehouse,
    branchesWithoutStandingSalt,
    targetStock,
    roadMatchedStock,
    roadMatchedShortfall,
    preservedStock,
    preservedInTransit,
    quarantinedPreservedStock,
    unmatchedPreservedStock: Math.max(
      0,
      preservedStock + preservedInTransit - roadMatchedStock,
    ),
    fallbackDemandPerDay,
    smokehouseOutputPerDay,
    productionDaysToTarget,
    freshFoodRequired,
    firewoodRequired,
    saltRequired,
    potteryRequired,
    saltStock,
    saltInTransit,
    potteryStock,
    potteryInTransit,
    saltImportLots,
    saltImportShortfall,
    potteryShortfall,
    staffedSmokehouses,
    staffedMarkets,
    standingSaltMarkets,
    selectedSaltTarget,
    firstExposedResidenceId,
    firstAttentionBuildingId,
    firstSaltMarketId,
    branches: finalizedBranches,
  };
}

function emptyBranch(key: string): MutableBranch {
  return {
    key,
    residents: 0,
    fallbackDemandPerDay: 0,
    targetStock: 0,
    preservedStock: 0,
    preservedInTransit: 0,
    projectedStock: 0,
    shortfall: 0,
    coverageDays: Number.POSITIVE_INFINITY,
    smokehouseOutputPerDay: 0,
    productionDaysToTarget: 0,
    freshFoodRequired: 0,
    firewoodRequired: 0,
    saltRequired: 0,
    potteryRequired: 0,
    saltStock: 0,
    saltInTransit: 0,
    potteryStock: 0,
    potteryInTransit: 0,
    saltImportLots: 0,
    saltImportShortfall: 0,
    potteryShortfall: 0,
    staffedSmokehouses: 0,
    staffedMarkets: 0,
    standingSaltMarkets: 0,
    selectedSaltTarget: 0,
    firstResidenceId: null,
    firstSmokehouseId: null,
    firstMarketId: null,
  };
}

function cyclesPerCalendarDay(
  building: Pick<BuildingState, 'assignedLabor' | 'kind'>,
  sabbathObserved: boolean,
): number {
  if (building.kind !== 'smokehouse' || building.assignedLabor <= 0) return 0;
  const interval = getBuildingDefinition('smokehouse').harvestInterval;
  if (interval <= 1e-9) return 0;
  return WORKDAY_SECONDS
    * (sabbathObserved ? 6 / 7 : 1)
    * Math.max(0, building.assignedLabor)
    / interval;
}

function deliveryBranch(
  trip: DeliveryTripState,
  state: GameState,
  branchFor: (
    entity: Pick<BuildingState | ResidenceState, 'id' | 'x' | 'z'>,
    entityKind: 'building' | 'residence',
  ) => MutableBranch,
): MutableBranch | null {
  if (trip.phase === 'inbound') {
    const origin = state.buildings.get(trip.buildingId);
    return origin ? branchFor(origin, 'building') : null;
  }
  if (trip.targetBuildingId) {
    const target = state.buildings.get(trip.targetBuildingId);
    if (target) return branchFor(target, 'building');
  }
  if (trip.residenceId) {
    const target = state.residences.get(trip.residenceId);
    if (target) return branchFor(target, 'residence');
  }
  const origin = state.buildings.get(trip.buildingId);
  return origin ? branchFor(origin, 'building') : null;
}

function finiteStock(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;
}

function finitePositive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function earlierStableId(
  current: string | null,
  candidate: string | null,
): string | null {
  if (candidate === null) return current;
  if (current === null) return candidate;
  return compareStableEntityIds(candidate, current) < 0 ? candidate : current;
}
